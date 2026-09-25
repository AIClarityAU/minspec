/**
 * T0 — the gate's frontmatter tokenizer must see EVERY declared ownership path.
 *
 * Root cause this pins (#1961): `fm_value` matched `^key:\s*(.+?)\s*$` under `re.M`.
 * `\s` matches newlines, so on a BLOCK-form key -
 *
 *     implements:
 *       - packages/a.ts
 *       - packages/b.ts
 *
 * - the `\s*` before the capture consumed the line break plus the indentation and
 * returned the first LIST ITEM as if it were an inline value. `fm_list` tests that
 * result first, so it took the inline branch, tokenized `['-', 'packages/a.ts']`,
 * and its correct block-form branch was unreachable dead code. Every path after the
 * first silently left the owned set: the gate never froze it.
 *
 * Why no existing test caught it: `spec-gate.test.ts`'s `writeSpecIn` helper emits
 * the INLINE form (`implements: [a, b]`), and `ownership-path-parity.test.ts` pins
 * `_SRC_EXT_RE` and `_INFRA_PREFIXES` textually but nothing pinned the tokenizer.
 * The fixtures used the shape that worked.
 *
 * Deliberately NO yaml dependency. Asserting against a real YAML parser would be a
 * stronger pin in principle, but neither `js-yaml` nor `pyyaml` is a declared
 * dependency here, and a parser missing in CI turns this into a false green. The
 * expectations below are written out literally instead.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { validateSpec } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { loadConfig } from '../src/lib/config';
import { buildTasksMdContent } from '../src/lib/scaffold';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const GATE_PY = path.resolve(__dirname, '../../../scripts/hooks/spec-gate.py');
const HOOK = path.resolve(__dirname, '../../../scripts/hooks/spec-gate.sh');

/** Tokens the gate's own `fm_list` yields for `key` in a frontmatter block. */
function fmList(frontmatter: string, key: string): string[] {
  const src = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("sg", ${JSON.stringify(GATE_PY)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'fm = sys.stdin.read()',
    `print(json.dumps(m.fm_list(fm, ${JSON.stringify(key)})))`,
  ].join('\n');
  const res = spawnSync('python3', ['-c', src], { input: frontmatter, encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`fm_list probe failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

/** The raw inline scalar the gate's `fm_value` yields, or null. */
function fmValue(frontmatter: string, key: string): string | null {
  const src = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("sg", ${JSON.stringify(GATE_PY)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `print(json.dumps(m.fm_value(sys.stdin.read(), ${JSON.stringify(key)})))`,
  ].join('\n');
  const res = spawnSync('python3', ['-c', src], { input: frontmatter, encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`fm_value probe failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

describe('fm_value does not cross a newline (#1961 mechanism)', () => {
  it('returns null for a block-form key rather than its first list item', () => {
    const fm = 'id: SPEC-999\nimplements:\n  - packages/a.ts\n  - packages/b.ts\nother: x';
    // The regression: this returned '- packages/a.ts'.
    expect(fmValue(fm, 'implements')).toBeNull();
  });

  it('still reads a genuine inline scalar', () => {
    const fm = 'id: SPEC-999\ntier: T3\nstatus: implementing';
    expect(fmValue(fm, 'tier')).toBe('T3');
    expect(fmValue(fm, 'status')).toBe('implementing');
  });

  it('returns null for a valueless scalar key instead of the next line', () => {
    // Same newline-crossing read, on the callers (`id`/`tier`/`status`) that were
    // latently exposed whenever their value was empty.
    const fm = 'tier:\nid: SPEC-999';
    expect(fmValue(fm, 'tier')).toBeNull();
  });
});

describe('fm_list tokenizes every authored ownership path', () => {
  const cases: Array<{ name: string; fm: string; key: string; expected: string[] }> = [
    {
      name: 'block form, three items (the #1961 regression)',
      fm: 'id: S\nimplements:\n  - packages/a.ts\n  - packages/b.ts\n  - packages/c.ts\nother: x',
      key: 'implements',
      expected: ['packages/a.ts', 'packages/b.ts', 'packages/c.ts'],
    },
    {
      name: 'block form, single item',
      fm: 'id: S\nimplements:\n  - packages/a.ts\nother: x',
      key: 'implements',
      expected: ['packages/a.ts'],
    },
    {
      name: 'block form with trailing per-item comments',
      fm: 'id: S\naffects:\n  - packages/a.ts  # FR-1\n  - packages/b.ts  # FR-2\nother: x',
      key: 'affects',
      expected: ['packages/a.ts', 'packages/b.ts'],
    },
    {
      name: 'block form terminated by a following key',
      fm: 'id: S\nimplements:\n  - packages/a.ts\n  - packages/b.ts\nphases:\n  specify: done',
      key: 'implements',
      expected: ['packages/a.ts', 'packages/b.ts'],
    },
    {
      name: 'inline bracket form still works',
      fm: 'id: S\nimplements: [packages/a.ts, packages/b.ts]\nother: x',
      key: 'implements',
      expected: ['packages/a.ts', 'packages/b.ts'],
    },
    {
      name: 'inline bare form still works',
      fm: 'id: S\nimplements: packages/a.ts, packages/b.ts\nother: x',
      key: 'implements',
      expected: ['packages/a.ts', 'packages/b.ts'],
    },
    {
      name: 'the `none` escape survives tokenizing',
      fm: 'id: S\nimplements: none\nimplements_reason: >-\n  because\n',
      key: 'implements',
      expected: ['none'],
    },
    {
      name: 'absent key yields nothing',
      fm: 'id: S\nother: x',
      key: 'implements',
      expected: [],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(fmList(c.fm, c.key)).toEqual(c.expected);
    });
  }

  it('never emits a bare list dash as a token', () => {
    // '-' is not a path, so downstream `consider()` drops it silently — which is
    // exactly how the truncation stayed invisible. Assert the tokenizer itself.
    const fm = 'id: S\nimplements:\n  - packages/a.ts\n  - packages/b.ts\n';
    expect(fmList(fm, 'implements')).not.toContain('-');
  });
});

describe('the gate freezes every path a block-form spec declares', () => {
  function gateEnv(): NodeJS.ProcessEnv {
    return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
  }

  function runGate(ws: string, relPath: string): string | null {
    const envelope = {
      tool_name: 'Edit',
      cwd: ws,
      tool_input: { file_path: relPath, old_string: 'a', new_string: 'b' },
    };
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify(envelope),
      cwd: ws,
      env: gateEnv(),
      encoding: 'utf-8',
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code !== 'EPIPE') throw res.error;
    const raw = (res.stdout ?? '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw).hookSpecificOutput.permissionDecision;
    } catch {
      return null;
    }
  }

  it('denies an edit to the SECOND and THIRD declared paths, not only the first', () => {
    const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fmlist-gate-'));
    try {
      const opts = { cwd: ws, env: gateEnv(), stdio: 'ignore' as const };
      execFileSync('git', ['init', '-q'], opts);
      execFileSync('git', ['config', 'user.email', 'gate-test@example.com'], opts);
      execFileSync('git', ['config', 'user.name', 'gate-test'], opts);
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts);
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], opts);

      // BLOCK form — the shape `spec-gate.test.ts`'s helper never emits.
      const specPath = path.join(ws, 'specs', 'SPEC-900-x.md');
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(
        specPath,
        '---\n' +
          'id: SPEC-900\n' +
          'title: X\n' +
          'tier: T3\n' +
          'status: implementing\n' +
          'implements:\n' +
          '  - src/one.ts\n' +
          '  - src/two.ts\n' +
          '  - src/three.ts\n' +
          'phases:\n' +
          '  specify: done\n' +
          '  clarify: skipped\n' +
          '  plan: in-progress\n' +
          '  tasks: pending\n' +
          '  implement: pending\n' +
          '---\n# SPEC-900\nbody\n',
      );

      // Unapproved and mid-implementation: every declared path must be frozen.
      for (const rel of ['src/one.ts', 'src/two.ts', 'src/three.ts']) {
        expect(runGate(ws, rel), `${rel} should be denied`).toBe('deny');
      }
      // An undeclared sibling is correctly NOT gated — the freeze stays scoped.
      expect(runGate(ws, 'src/unrelated.ts')).not.toBe('deny');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('still denies every path when the same spec declares them inline', () => {
    // Parity: block and inline forms must freeze the same set. Guards against a
    // fix that repairs block form by breaking the inline branch.
    const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fmlist-gate-'));
    try {
      const opts = { cwd: ws, env: gateEnv(), stdio: 'ignore' as const };
      execFileSync('git', ['init', '-q'], opts);
      execFileSync('git', ['config', 'user.email', 'gate-test@example.com'], opts);
      execFileSync('git', ['config', 'user.name', 'gate-test'], opts);
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts);
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], opts);

      const specPath = path.join(ws, 'specs', 'SPEC-901-x.md');
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(
        specPath,
        '---\n' +
          'id: SPEC-901\n' +
          'title: X\n' +
          'tier: T3\n' +
          'status: implementing\n' +
          'implements: [src/one.ts, src/two.ts, src/three.ts]\n' +
          'phases:\n' +
          '  specify: done\n' +
          '  clarify: skipped\n' +
          '  plan: in-progress\n' +
          '  tasks: pending\n' +
          '  implement: pending\n' +
          '---\n# SPEC-901\nbody\n',
      );

      for (const rel of ['src/one.ts', 'src/two.ts', 'src/three.ts']) {
        expect(runGate(ws, rel), `${rel} should be denied`).toBe('deny');
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('the live corpus has no silently-truncated ownership list', () => {
  it('every block-form implements:/affects: key tokenizes to its authored length', () => {
    // Corpus-level guard: catches a spec authored in block form under a future
    // regression, without re-encoding the parser's own logic in the assertion.
    const repoRoot = path.resolve(__dirname, '../../..');
    const src = [
      'import importlib.util, json, re, glob, os',
      `spec = importlib.util.spec_from_file_location("sg", ${JSON.stringify(GATE_PY)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'bad = []',
      'for p in glob.glob("specs/**/*.md", recursive=True):',
      '    raw = open(p, encoding="utf-8").read()',
      '    mm = re.match(r"^---\\n(.*?)\\n---", raw, re.S)',
      '    if not mm: continue',
      '    fm = mm.group(1)',
      '    lines = fm.split("\\n")',
      '    for key in ("implements", "affects"):',
      '        for i, l in enumerate(lines):',
      '            if not re.match(r"^%s[ \\t]*:[ \\t]*(?:#.*)?$" % key, l): continue',
      '            authored = 0',
      '            for c in lines[i+1:]:',
      '                if re.match(r"^[ \\t]*-[ \\t]*\\S", c): authored += 1',
      '                elif re.match(r"^[ \\t]*$", c): continue',
      '                else: break',
      '            got = len(m.fm_list(fm, key))',
      '            if got != authored: bad.append([p, key, authored, got])',
      '            break',
      'print(json.dumps(bad))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', src], { cwd: repoRoot, encoding: 'utf-8' });
    if (res.status !== 0) throw new Error(`corpus probe failed: ${res.stderr}`);
    expect(JSON.parse(res.stdout.trim())).toEqual([]);
  });
});

describe('the TS twins parse block form too (#1976 review)', () => {
  // The Python gate was only half the defect. `rawFrontmatterField`
  // (spec-validator.ts) and `rawField` (facts.ts) carried the SAME
  // newline-crossing idiom, so `validateOwnership` - invariant #2's second
  // witness - validated only the first declared path while reporting clean.
  //
  // Asserted through the public `validateSpec` surface rather than by exporting
  // the tokenizer: the observable consequence is what matters, and six
  // phase-gated specs declare spec-validator.ts, so its public API is not
  // widened for a test's convenience.
  function ownershipViolations(implementsBlock: string[]): string[] {
    const raw = [
      '---',
      'id: SPEC-998',
      'type: requirements',
      'tier: T3',
      'product: minspec',
      'status: implementing',
      ...implementsBlock,
      'phases:',
      '  specify: done',
      '  clarify: done',
      '  plan: in-progress',
      '  tasks: pending',
      '  implement: pending',
      '---',
      '',
      '# SPEC-998',
      '',
      'body',
    ].join('\n');
    const repoRoot = path.resolve(__dirname, '../../..');
    const parsed = parseSpec(raw) as unknown as { filePath: string };
    parsed.filePath = 'specs/minspec/SPEC-998-x/requirements.md';
    const res = validateSpec(parsed as never, loadConfig(repoRoot), {}) as unknown as Record<string, Array<{ rule?: string }>>;
    const all = [...(res.errors ?? []), ...(res.warnings ?? []), ...(res.violations ?? [])];
    return all
      .map((v: { rule?: string }) => String(v.rule ?? ''))
      .filter((r: string) => r.startsWith('ownership.'));
  }

  it('sees a path-escape on the SECOND item of a block-form list', () => {
    // Pre-fix this returned [] — the escape on item 2 was invisible.
    const rules = ownershipViolations([
      'implements:',
      '  - packages/minspec/src/lib/ok.ts',
      '  - ../escaped.ts',
    ]);
    expect(rules).toContain('ownership.implements.invalid');
  });

  it('accepts a wholly valid block-form list with no violation', () => {
    const rules = ownershipViolations([
      'implements:',
      '  - packages/minspec/src/lib/a.ts',
      '  - packages/minspec/src/lib/b.ts',
    ]);
    expect(rules).toEqual([]);
  });

  it('still honours the inline `none` escape', () => {
    const rules = ownershipViolations(['implements: none', 'implements_reason: >-', '  because']);
    expect(rules).toEqual([]);
  });

  it('still reports a declaration that is genuinely missing', () => {
    // Control: proves the probe can fail. Without it, an always-[] bug in this
    // helper would make the two "no violation" cases pass vacuously.
    expect(ownershipViolations([])).toContain('ownership.implements.missing');
  });
});

describe('scaffold.ts copies a single frontmatter line, never two (#1976 review)', () => {
  it('does not swallow the next line when a key has no value', () => {
    // The fourth copy of the idiom. A valueless `status:` used to capture
    // `status:\nproduct: minspec`, which buildTasksMdContent then wrote verbatim
    // into the scaffolded frontmatter - duplicating a key and malforming the file.
    const requirements = [
      '---', 'id: SPEC-1', 'status:', 'product: minspec', 'epic: EPIC-002  # Signpost',
      '---', '', '# X', '',
    ].join('\n');
    const out = buildTasksMdContent(requirements);
    const fm = out.split('---')[1] ?? '';
    // Under the bug `rawFrontmatterLine('status')` returned `status:\nproduct: minspec`,
    // which was pushed as ONE entry - and the loop then emitted `product:` again from
    // its own iteration. Duplication is the distinguishing signal; the raw text of the
    // correct and buggy outputs is otherwise line-for-line similar.
    const keys = fm
      .split('\n')
      .map((l) => l.split(':')[0].trim())
      .filter((k) => k.length > 0);
    expect(keys).toEqual([...new Set(keys)]);
    expect(keys.filter((k) => k === 'product')).toHaveLength(1);
    // The inline `# Title` comment the corpus relies on is still preserved.
    expect(fm).toContain('epic: EPIC-002  # Signpost');
  });
});

describe('no multi-line regex reads a key with `\\s*` after the colon (#1961)', () => {
  // PROPERTY pin, replacing the per-file list this test carried first. I enumerated
  // the copies three times - at three, four and five - and was wrong each time,
  // because a list only covers what its author already knows. The invariant is:
  //
  //   a regex carrying the `m` flag must not use `\\s*` straight after a colon.
  //
  // `\\s` matches newlines in both JS and Python, so under `m` a valueless key
  // (`product:`) crosses the line break and captures the NEXT line. Line-scoped
  // matchers - spec.ts, epic-manager.ts, adr-manager.ts - test an already-split
  // single line and carry no `m` flag, so the rule excludes them by construction
  // rather than by allowlist. There are deliberately NO exemptions: an exemption
  // list is the same failure mode as the file list this replaces.
  //
  // Validated against the pre-fix tree: this detector reports 15 sites on the
  // commit before the fix, and 0 after.
  it('reports no occurrences anywhere in src/, scripts/ or .githooks/', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const files = execFileSync(
      'git',
      ['ls-files', '*.ts', '*.py', '*.mjs', '.githooks/*'],
      { cwd: repoRoot, encoding: 'utf-8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((f) => /^(packages\/[^/]+\/src|scripts|\.githooks)\//.test(f));

    const hits: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(repoRoot, f), 'utf-8');
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|#|\*)/.test(line)) return; // comment line
        const mFlagged = f.endsWith('.py')
          ? /re\.(M|MULTILINE)/.test(line)
          : /\/[gimsuy]*m[gimsuy]*(?=[.,;)\s\]}]|$)/.test(line) ||
            /['"][gimsuy]*m[gimsuy]*['"]\s*\)/.test(line);
        if (!mFlagged) return;
        if (/:\\{0,2}s\*/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    expect(hits, `newline-crossing key regex:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the detector itself is not vacuous', () => {
    // A detector that reports clean because it is broken is the exact false green
    // this suite exists to prevent. Feed it the shapes it must catch.
    const mustCatch = [
      "const FM = /^product:\\s*([^\\s#]+)/m;",
      "const m = raw.match(/^aspects:\\s*(.+)$/m);",
      "const owner = /^id:\\s*(\\S+)/m.exec(block)?.[1];",
      "const re = new RegExp(`^${key}\\\\s*:\\\\s*(.*)$`, 'm');",
      "if (!/^status:\\s*accepted\\s*$/m.test(body)) continue;",
    ];
    const mustIgnore = [
      "const match = trimmed.match(/^(\\w[\\w-]*)\\s*:\\s*(.+)$/);", // line-scoped, no m flag
      "const json = /\"message\"\\s*:\\s*\"([^\"]+)\"/.exec(haystack);", // no m flag
      "const FM = /^product:[ \\t]*([^\\s#]+)/m;", // already fixed
    ];
    const detect = (line: string): boolean => {
      const mFlagged =
        /\/[gimsuy]*m[gimsuy]*(?=[.,;)\s\]}]|$)/.test(line) ||
        /['"][gimsuy]*m[gimsuy]*['"]\s*\)/.test(line);
      return mFlagged && /:\\{0,2}s\*/.test(line);
    };
    for (const l of mustCatch) expect(detect(l), `should flag: ${l}`).toBe(true);
    for (const l of mustIgnore) expect(detect(l), `should ignore: ${l}`).toBe(false);
  });
});
