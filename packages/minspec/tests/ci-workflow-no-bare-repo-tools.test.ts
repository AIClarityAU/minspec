// T3 regression for #3563: the e2e job failed in under a minute on every run with
// `tsc: command not found` (exit 127). Its "Compile e2e tests" step called a BARE
// `tsc`. A workflow `run:` step resolves commands from the runner image's PATH, not
// from node_modules/.bin, so a bare repo tool works only while the image happens to
// ship a global copy. ubuntu-latest moving from ubuntu-24.04 to ubuntu-26.04 (no
// global TypeScript) broke it with no repo change.
//
// The rule this pins: no `run:` command in a workflow may start with a binary that the
// repo provides through its own devDependencies. Call it through `npm run`/`npx`, which
// use the repo-pinned version from node_modules/.bin.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

/** Binaries the repo installs itself (devDependencies of root + every package). */
function repoToolBins(): Set<string> {
  const manifests = [path.join(repoRoot, 'package.json')];
  const pkgs = path.join(repoRoot, 'packages');
  for (const d of fs.readdirSync(pkgs)) {
    const p = path.join(pkgs, d, 'package.json');
    if (fs.existsSync(p)) manifests.push(p);
  }
  // Package name -> the binary it puts on node_modules/.bin, where they differ.
  const binOf: Record<string, string[]> = {
    typescript: ['tsc', 'tsserver'],
    '@vscode/vsce': ['vsce'],
    '@vscode/test-cli': ['vscode-test'],
  };
  const bins = new Set<string>();
  for (const m of manifests) {
    const pkg = JSON.parse(fs.readFileSync(m, 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
      if (name.startsWith('@types/')) continue;
      for (const b of binOf[name] ?? [name.replace(/^@[^/]+\//, '')]) bins.add(b);
    }
  }
  return bins;
}

interface RunCommand {
  file: string;
  line: number;
  text: string;
}

/** Every shell command line inside a `run:` value (inline or block scalar). */
function runCommands(file: string, src: string): RunCommand[] {
  const out: RunCommand[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length;
    const value = m[2].trim();
    if (value && !/^[|>][-+]?\s*(#.*)?$/.test(value)) {
      out.push({ file, line: i + 1, text: value });
      continue;
    }
    // Block scalar: take following lines indented deeper than the key.
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') continue;
      if (l.length - l.trimStart().length <= keyIndent) break;
      out.push({ file, line: j + 1, text: l.trim() });
    }
  }
  return out;
}

/** First word of each command segment on a shell line (split on && || ; |). */
function leadingWords(cmd: string): string[] {
  if (cmd.startsWith('#')) return [];
  return cmd
    .split(/&&|\|\||;|\|/)
    .map((seg) => seg.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))
    .map((seg) => seg.split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

function bareRepoToolCalls(): string[] {
  const bins = repoToolBins();
  const hits: string[] = [];
  for (const f of fs.readdirSync(workflowsDir).filter((n) => /\.ya?ml$/.test(n))) {
    const src = fs.readFileSync(path.join(workflowsDir, f), 'utf8');
    for (const c of runCommands(f, src)) {
      for (const w of leadingWords(c.text)) {
        if (bins.has(w)) hits.push(`${c.file}:${c.line}: bare \`${w}\` in "${c.text}"`);
      }
    }
  }
  return hits;
}

describe('#3563 workflows never call a repo tool bare', () => {
  it('knows tsc is a repo tool (control: the detector is not vacuous)', () => {
    expect(repoToolBins().has('tsc')).toBe(true);
    expect(leadingWords('tsc -p tsconfig.test.json')).toEqual(['tsc']);
    expect(leadingWords('npx tsc -p x && FOO=1 vitest run')).toEqual(['npx', 'vitest']);
    const parsed = runCommands('x.yml', '      - name: a\n        run: tsc -p t\n      - run: |\n          echo\n          tsc\n');
    expect(parsed.map((c) => c.text)).toEqual(['tsc -p t', 'echo', 'tsc']);
  });

  it('every workflow run: step calls repo tools via npm run / npx', () => {
    expect(bareRepoToolCalls()).toEqual([]);
  });

  it('e2e job still runs the e2e suite (pretest:e2e compiles the tests)', () => {
    const ci = fs.readFileSync(path.join(workflowsDir, 'ci.yml'), 'utf8');
    const job = /\n {2}e2e:\n([\s\S]*?)(?=\n {2}[A-Za-z_-]+:\n)/.exec(ci)?.[1] ?? '';
    expect(job).toMatch(/run: xvfb-run -a npm run test:e2e/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/minspec/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['pretest:e2e']).toMatch(/tsc -p tsconfig\.test\.json/);
  });
});
