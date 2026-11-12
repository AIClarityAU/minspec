/**
 * SPEC-080 T0 - the pre-commit hook's code-quality stage (Stage 4) and the
 * Stage-3 control-flow change it depends on.
 *
 * Each task in specs/minspec/SPEC-080-pre-commit-code-quality-stage/tasks.md adds
 * its own `describe` block here; no task deletes another task's cases.
 *
 * Harness (design.md, *Test plan*): render `PRE_COMMIT_HOOK` with
 * `renderManagedFile`, write it into a fresh `git init` fixture as
 * `.minspec/hooks/pre-commit`, stage fixture files, and run the hook with `sh`
 * under a caller-controlled `PATH`. `pathWithout(tool)` drops every PATH entry
 * holding that tool, and asserts `command -v <tool>` then fails, so an "absent"
 * case can never pass vacuously because the tool was still reachable.
 *
 * Every hook run sets `npm_config_offline=true` and an empty `npm_config_cache`,
 * so the hook's `npx --no-install` probes can never reach the network
 * (invariant 1) and the Node validator tier stays unreachable unless a case
 * makes it reachable on purpose.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const PRE_COMMIT = '.minspec/hooks/pre-commit';
const VALIDATE_PY = '.minspec/hooks/validate.py';

const byPath = (p: string) => {
  const t = MANAGED_REGION_TEMPLATES.find((tpl) => tpl.outputPath === p);
  if (!t) throw new Error(`no managed-region template for ${p}`);
  return t;
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let repo: string;
let scratch: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function write(rel: string, body: string, mode?: number): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mode !== undefined) fs.chmodSync(p, mode);
}

function stage(rel: string, body: string): void {
  write(rel, body);
  git('add', '--', rel);
}

/** The pre-commit hook exactly as MinSpec scaffolds it. */
function renderHook(): string {
  return renderManagedFile(byPath(PRE_COMMIT));
}

/** Is `tool` resolvable as a command under `pathEnv`? */
function resolvable(tool: string, pathEnv: string): boolean {
  const r = spawnSync('sh', ['-c', `command -v ${tool}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: pathEnv },
  });
  return r.status === 0;
}

/**
 * `pathEnv` with every entry that holds an executable named `tool` removed.
 * Asserts the tool is then unresolvable: an "absent" case built on a PATH that
 * still reaches the tool would pass for the wrong reason.
 */
function pathWithout(tool: string, pathEnv: string = process.env.PATH ?? ''): string {
  const kept = pathEnv.split(path.delimiter).filter((dir) => {
    if (!dir) return false;
    try {
      fs.accessSync(path.join(dir, tool), fs.constants.X_OK);
      return false;
    } catch {
      return true;
    }
  });
  const out = kept.join(path.delimiter);
  if (resolvable(tool, out)) {
    throw new Error(`pathWithout(${tool}): still resolvable after filtering PATH`);
  }
  return out;
}

/** Base PATH for every case: gitleaks removed so Stage 2 is a fixed, offline advisory. */
function basePath(): string {
  return pathWithout('gitleaks');
}

interface HookRun {
  code: number;
  err: string;
}

/**
 * Install `body` as the fixture's `.minspec/hooks/pre-commit` and run it with `sh`,
 * as git would. Installed in place because the hook reads `validate.py` from its
 * own directory.
 */
function runInstalled(
  body: string,
  pathEnv: string = basePath(),
  extraEnv: Record<string, string> = {},
): HookRun {
  write(PRE_COMMIT, body, 0o755);
  const npmCache = fs.mkdtempSync(path.join(scratch, 'npm-cache-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: pathEnv,
    MINSPEC_GATE_OFF: '',
    ...extraEnv,
    // Last, so no caller can turn the network back on (INV-3, tasks.md 5.1).
    npm_config_offline: 'true',
    npm_config_cache: npmCache,
  };
  hookRunEnvs.push(env);
  const r = spawnSync('sh', [path.join(repo, PRE_COMMIT)], {
    cwd: repo,
    encoding: 'utf8',
    env,
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

/** Every environment a hook ran under in this file; INV-3 asserts over all of them. */
const hookRunEnvs: NodeJS.ProcessEnv[] = [];

/** The comment line Stage 4 starts at (tasks.md 2.1); the INV-5 cut point. */
const STAGE4_ANCHOR = '# ── Stage 4: code-quality checks (SPEC-080)';

/**
 * The rendered hook with `echo STAGE3_DONE >&2` inserted where Stage 3 ends - the
 * task-1 control (tasks.md 1.2). If Stage 3 still exited from inside a tier, the
 * sentinel would never print; if the hook's exit still read `$?`, the inserted
 * `echo` would change the hook's exit status.
 *
 * Before Stage 4 existed, "where Stage 3 ends" was the hook's final `exit` line.
 * Since task 2 it is the Stage-4 anchor, because the hook now ends with Stage 4's
 * combine, which exits early on a Stage-3 failure by design.
 */
function withSentinel(hook: string): string {
  const lines = hook.split('\n');
  let at = lines.findIndex((l) => l.startsWith(STAGE4_ANCHOR));
  if (at < 0) {
    lines.forEach((l, i) => {
      if (/^exit\b/.test(l)) at = i;
    });
  }
  if (at < 0) throw new Error('rendered hook has neither a Stage-4 anchor nor a top-level exit line');
  lines.splice(at, 0, 'echo STAGE3_DONE >&2');
  return lines.join('\n');
}

function python3Available(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-spec080-repo-'));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-spec080-scratch-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  write('README.md', 'seed\n');
  git('add', 'README.md');
  git('commit', '-q', '--no-verify', '-m', 'seed');
  // A feature branch, so the protected-branch guard (Stage 0) is not under test.
  git('checkout', '-q', '-b', 'feature');
  write(PRE_COMMIT, renderHook(), 0o755);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures for Stage 3 (AC-5, AC-9)
// ---------------------------------------------------------------------------

/** AC-5: a staged spec with no `id:` - Stage 3 (shell tier) refuses it. */
function fixtureRefusedSpec(): void {
  stage('specs/demo/requirements.md', '---\ntype: requirements\nstatus: draft\n---\n# Demo\n');
}

/** AC-9, shell tier: a `minspec:managed:` marker outside `.minspec/hooks/` only warns. */
function fixtureShellWarn(): void {
  stage('notes/leak.md', '# notes\n<!-- minspec:managed:something -->\n');
}

/**
 * AC-9, python tier: a T3 spec whose `plan` is `in-progress` and which declares no
 * `implements:`, with a config that does not set `ownershipDeclaration: error`.
 * validate.py prints a WARN and lets the commit through.
 */
function fixturePythonWarn(): void {
  write(VALIDATE_PY, renderManagedFile(byPath(VALIDATE_PY)), 0o755);
  write('.minspec/config.json', '{}\n');
  stage(
    'specs/demo/requirements.md',
    [
      '---',
      'id: SPEC-001',
      'type: requirements',
      'status: planning',
      'tier: T3',
      'phases:',
      '  specify: done',
      '  clarify: done',
      '  plan: in-progress',
      '---',
      '# Demo',
      '',
    ].join('\n'),
  );
}

const SHELL_REFUSAL = /specs\/demo\/requirements\.md missing `id: SPEC-NNN` frontmatter/;
const SHELL_WARNING = /notes\/leak\.md contains a `minspec:managed:` marker outside the hooks dir/;
const PYTHON_WARNING = /WARN specs\/demo\/requirements\.md: .*implements/;

// ---------------------------------------------------------------------------
// Task 1 - Stage 3 records its verdict instead of exiting (FR-6, INV-5; AC-5, AC-9)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 1: Stage 3 records its verdict instead of exiting (FR-6, INV-5)', () => {
  it('harness non-vacuity: pathWithout removes the tool, and the Node tier is unreachable', () => {
    const p = basePath();
    expect(resolvable('gitleaks', p)).toBe(false);
    // `sh` and `git` must survive the filtering, or every case below is meaningless.
    expect(resolvable('sh', p)).toBe(true);
    expect(resolvable('git', p)).toBe(true);
  });

  it('AC-5: a staged spec with no `id:` is still refused', () => {
    fixtureRefusedSpec();
    const r = runInstalled(renderHook());
    expect(r.err).toMatch(SHELL_REFUSAL);
    expect(r.code).not.toBe(0);
  });

  it('AC-9 (shell tier): a `minspec:managed:` marker outside the hooks dir warns and the commit succeeds', () => {
    fixtureShellWarn();
    const r = runInstalled(renderHook());
    expect(r.err).toMatch(SHELL_WARNING);
    expect(r.code).toBe(0);
  });

  it.skipIf(!python3Available())(
    'AC-9 (python tier): a T3 spec past Clarify with no `implements:` warns and the commit succeeds',
    () => {
      fixturePythonWarn();
      const r = runInstalled(renderHook());
      expect(r.err).toMatch(PYTHON_WARNING);
      expect(r.err).not.toMatch(/^FAIL /m);
      expect(r.code).toBe(0);
    },
  );

  it('the hook ends by exiting with the captured Stage-3 code, not a bare `$?`', () => {
    const lines = renderHook().split('\n');
    // Since task 2 the captured Stage-3 code is combined with Stage 4's: Stage 3's
    // own non-zero code wins, otherwise Stage 4's verdict stands (design.md).
    // Comment lines (the managed-region end marker) are not code.
    const tail = lines.filter((l) => l.trim() !== '' && !l.startsWith('#')).slice(-2);
    expect(tail).toEqual([
      '[ "$minspec_stage3_rc" -ne 0 ] && exit "$minspec_stage3_rc"',
      'exit "$minspec_stage4_rc"',
    ]);
    // No tier may exit on its own any more: every `exit $?` inside Stage 3 is gone.
    const stage3 = renderHook().split('# ── Stage 3:')[1] ?? '';
    expect(stage3).not.toMatch(/^\s*exit \$\?/m);
  });

  describe('control: a sentinel inserted before the final `exit` runs on every fixture and keeps the exit status', () => {
    const cases: Array<{
      name: string;
      setup: () => void;
      expectCode: (c: number) => void;
      line: RegExp;
      needsPython?: boolean;
    }> = [
      {
        name: 'AC-5 refused spec (shell tier)',
        setup: fixtureRefusedSpec,
        expectCode: (c) => expect(c).not.toBe(0),
        line: SHELL_REFUSAL,
      },
      {
        name: 'AC-9 shell-tier warning',
        setup: fixtureShellWarn,
        expectCode: (c) => expect(c).toBe(0),
        line: SHELL_WARNING,
      },
      {
        name: 'AC-9 python-tier warning',
        setup: fixturePythonWarn,
        expectCode: (c) => expect(c).toBe(0),
        line: PYTHON_WARNING,
        needsPython: true,
      },
    ];

    for (const c of cases) {
      it.skipIf(c.needsPython === true && !python3Available())(c.name, () => {
        c.setup();
        const plain = runInstalled(renderHook());
        const sentinel = runInstalled(withSentinel(renderHook()));
        // Stage 3 actually ran in both, so the comparison cannot pass vacuously.
        expect(plain.err).toMatch(c.line);
        expect(sentinel.err).toMatch(c.line);
        // Execution reaches the end of the hook after Stage 3, on every outcome.
        expect(sentinel.err).toContain('STAGE3_DONE');
        // The sentinel changes nothing else: same verdict, same Stage-3 output.
        expect(sentinel.code).toBe(plain.code);
        c.expectCode(plain.code);
        expect(sentinel.err.replace(/^STAGE3_DONE\n/m, '')).toBe(plain.err);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Stage-4 harness: stub tools, the tsc wrapper, the derived Stage-3-only hook
// ---------------------------------------------------------------------------

const QUALITY_LINE = /^.*MinSpec quality:.*$/gm;

/** Every `MinSpec quality:` roster line in `err`. */
function rosterLines(err: string): string[] {
  return err.match(QUALITY_LINE) ?? [];
}

/** `err` with every `MinSpec quality:` line (and the bypass line a block adds) removed. */
function withoutRoster(err: string): string {
  return err
    .split('\n')
    .filter((l) => !l.includes('MinSpec quality:'))
    .join('\n');
}

/**
 * The INV-5 baseline (design.md, *The INV-5 control*): the rendered hook cut at the
 * Stage-4 anchor, with `exit "$minspec_stage3_rc"` appended - the hook as it would
 * be if Stage 4 did not exist.
 */
function stage3OnlyHook(): string {
  const hook = renderHook();
  const at = hook.indexOf(STAGE4_ANCHOR);
  if (at < 0) throw new Error('rendered hook has no Stage-4 anchor');
  return `${hook.slice(0, at)}exit "$minspec_stage3_rc"\n`;
}

type StubMode = 'lint' | 'fail3' | 'sentinel';

/**
 * A stub tool in its own directory. `lint`: append argv and every non-flag
 * argument's content to `log`, print a fake finding and exit 1 when an argument
 * file contains STAGE4_BAD, else exit 0. `fail3`: exit 3 with no finding, as a
 * tool that failed to run. `sentinel`: create `<log>` and exit 0.
 */
function stubTool(dir: string, tool: string, mode: StubMode, log: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const body =
    mode === 'fail3'
      ? '#!/bin/sh\necho "stub tool failure" >&2\nexit 3\n'
      : mode === 'sentinel'
        ? `#!/bin/sh\n: > '${log}'\nexit 0\n`
        : [
            '#!/bin/sh',
            `log='${log}'`,
            'echo "ARGV $*" >> "$log"',
            'if [ -f .shellcheckrc ]; then echo "RC $(cat .shellcheckrc)" >> "$log"; fi',
            'bad=0',
            'for a in "$@"; do',
            '  case "$a" in -*) continue ;; esac',
            '  echo "FILE $a" >> "$log"',
            '  cat "$a" >> "$log"',
            '  if grep -q STAGE4_BAD "$a"; then echo "$a:1:1: error: fake finding STAGE4_BAD"; bad=1; fi',
            'done',
            'exit $bad',
            '',
          ].join('\n');
  const p = path.join(dir, tool);
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
}

/** The monorepo's own TypeScript compiler, exposed as `tsc` through a one-line wrapper. */
function tscWrapper(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const tscJs = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const p = path.join(dir, 'tsc');
  fs.writeFileSync(p, `#!/bin/sh\nexec '${process.execPath}' '${tscJs}' "$@"\n`);
  fs.chmodSync(p, 0o755);
}

/** A PATH with `dir` first, over the base PATH minus each tool in `absent`. */
function pathWith(dir: string | null, absent: string[] = []): string {
  let p = basePath();
  for (const t of absent) p = pathWithout(t, p);
  return dir ? `${dir}${path.delimiter}${p}` : p;
}

function readLog(log: string): string {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
}

/**
 * Tools the real-tool cases need: skipped when absent.
 *
 * tasks.md 6.2 wants an absent tool to FAIL under CI instead, so CI can never go
 * green on a case that only skipped. That needs CI to install the tools first
 * (task 6.1, a .github/workflows/ci.yml step), which this change could not carry:
 * the bot's App token has no `workflows` permission. Until 6.1 lands, failing under
 * CI would turn every pull request red on a missing actionlint, so the cases skip
 * and 6.1, 6.2 and 7.1 stay unchecked in tasks.md (#3675).
 */
function realTool(tool: string): { has: boolean; skip: boolean } {
  const has = resolvable(tool, process.env.PATH ?? '');
  return { has, skip: !has };
}

const CLEAN_SH = '#!/bin/sh\necho clean\n';
const BAD_SH = '#!/bin/sh\necho STAGE4_BAD\n';
const CLEAN_WF = 'name: ok\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src/**/*.ts'] });

// ---------------------------------------------------------------------------
// Task 2 - Stage 4 with the shellcheck check (FR-1 to FR-5, FR-8, FR-10; AC-3, AC-6, AC-11, AC-12)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 2: Stage 4 runs shellcheck on the staged scripts', () => {
  let stubs: string;
  let log: string;
  beforeEach(() => {
    stubs = path.join(scratch, 'stubs');
    log = path.join(scratch, 'tool.log');
    stubTool(stubs, 'shellcheck', 'lint', log);
  });

  it('AC-3: no script, workflow or TypeScript staged: no roster line, and the verdict equals the Stage-3-only hook', () => {
    stage('notes/a.md', '# notes\n');
    const full = runInstalled(renderHook(), pathWith(stubs));
    const base = runInstalled(stage3OnlyHook(), pathWith(stubs));
    expect(rosterLines(full.err)).toEqual([]);
    expect(full.code).toBe(base.code);
    expect(full.code).toBe(0);
    expect(readLog(log)).toBe('');
  });

  it('AC-3: a staged .py next to pyproject.toml is not a Stage-4 input in v1', () => {
    stage('pyproject.toml', '[project]\nname = "x"\n');
    stage('app/main.py', 'print("STAGE4_BAD")\n');
    const full = runInstalled(renderHook(), pathWith(stubs));
    const base = runInstalled(stage3OnlyHook(), pathWith(stubs));
    expect(rosterLines(full.err)).toEqual([]);
    expect(full.code).toBe(base.code);
    expect(full.code).toBe(0);
  });

  it('AC-6: Stage 3 passes, shellcheck finds a staged error: refused, finding printed before the roster line', () => {
    stage('scripts/bad.sh', BAD_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/scripts\/bad\.sh:1:1: error: fake finding STAGE4_BAD/);
    expect(rosterLines(r.err)).toEqual(['✗ MinSpec quality: shellcheck BLOCKED the commit - its findings are above.']);
    expect(r.err.indexOf('fake finding')).toBeLessThan(r.err.indexOf('MinSpec quality:'));
    expect(r.err).toContain('Bypass (rare): MINSPEC_GATE_OFF=1 git commit ...');
  });

  it('a clean staged script passes with exactly one roster line', () => {
    stage('scripts/ok.sh', CLEAN_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual(['✓ MinSpec quality: shellcheck passed (1 staged file).']);
  });

  it('AC-11: MINSPEC_GATE_OFF=1 lets AC-6 through with no Stage-4 output; QUALITY_GATE_OFF=1 changes nothing', () => {
    stage('scripts/bad.sh', BAD_SH);
    const off = runInstalled(renderHook(), pathWith(stubs), { MINSPEC_GATE_OFF: '1' });
    expect(off.code).toBe(0);
    expect(rosterLines(off.err)).toEqual([]);
    expect(readLog(log)).toBe('');
    const other = runInstalled(renderHook(), pathWith(stubs), { QUALITY_GATE_OFF: '1' });
    expect(other.code).toBe(1);
    expect(rosterLines(other.err)).toEqual(['✗ MinSpec quality: shellcheck BLOCKED the commit - its findings are above.']);
  });

  it('AC-12: the STAGED content is judged - bad staged, fixed in the working copy: refused', () => {
    stage('scripts/x.sh', BAD_SH);
    write('scripts/x.sh', CLEAN_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(1);
    expect(r.err).toContain('fake finding STAGE4_BAD');
  });

  it('AC-12: clean staged, bad in the working copy: succeeds', () => {
    stage('scripts/x.sh', CLEAN_SH);
    write('scripts/x.sh', BAD_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    expect(readLog(log)).not.toContain('STAGE4_BAD');
    expect(readLog(log)).toContain('echo clean');
  });

  it('FR-8: shellcheck runs at error severity', () => {
    stage('scripts/ok.sh', CLEAN_SH);
    runInstalled(renderHook(), pathWith(stubs));
    expect(readLog(log)).toMatch(/^ARGV .*--severity=error/m);
  });

  it('a staged path with a space reaches the tool, and a deleted script does not', () => {
    stage('scripts/gone.sh', CLEAN_SH);
    git('commit', '-q', '--no-verify', '-m', 'add gone');
    git('rm', '-q', 'scripts/gone.sh');
    stage('scripts/with space.sh', CLEAN_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    expect(readLog(log)).toContain('FILE ./scripts/with space.sh');
    expect(readLog(log)).not.toContain('gone.sh');
    expect(rosterLines(r.err)).toEqual(['✓ MinSpec quality: shellcheck passed (1 staged file).']);
  });

  it('D5: the STAGED .shellcheckrc is materialized beside the scripts, and is not linted itself', () => {
    stage('.shellcheckrc', 'shell=sh\n');
    write('.shellcheckrc', 'shell=bash\n');
    stage('scripts/ok.sh', CLEAN_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    // The stub runs at the materialized tree's root and logs the rc file it finds there.
    expect(readLog(log)).toContain('RC shell=sh');
    expect(readLog(log)).not.toContain('shell=bash');
    expect(readLog(log)).not.toContain('FILE ./.shellcheckrc');
  });

  it('INV-2: shellcheck absent gives exactly one skip line naming it, and the commit succeeds', () => {
    stage('scripts/bad.sh', BAD_SH);
    const r = runInstalled(renderHook(), pathWith(null, ['shellcheck']));
    expect(r.code).toBe(0);
    const lines = rosterLines(r.err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^⚠ MinSpec quality: shellcheck SKIPPED - not installed \(https:\/\/\S+\)\.$/);
  });

  it('FR-3: a resolvable shellcheck that fails to run (exit 3) blocks', () => {
    stubTool(stubs, 'shellcheck', 'fail3', log);
    stage('scripts/ok.sh', CLEAN_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(1);
    expect(r.err).toContain('stub tool failure');
    expect(rosterLines(r.err)).toEqual(['✗ MinSpec quality: shellcheck BLOCKED the commit - its findings are above.']);
  });

  it('D2/FR-6: Stage 3 failing and Stage 4 blocking report both, and the exit is Stage 3\'s own code', () => {
    fixtureRefusedSpec();
    stage('scripts/bad.sh', BAD_SH);
    const r = runInstalled(renderHook(), pathWith(stubs));
    const base = runInstalled(stage3OnlyHook(), pathWith(stubs));
    expect(r.err).toMatch(SHELL_REFUSAL);
    expect(r.err).toContain('fake finding STAGE4_BAD');
    expect(r.code).toBe(base.code);
    expect(r.code).not.toBe(0);
  });

  describe('INV-5 control: Stage 3\'s verdict and output are identical with and without Stage 4', () => {
    const cases: Array<{ name: string; setup: () => void; line: RegExp; needsPython?: boolean }> = [
      { name: 'AC-5 refused spec', setup: fixtureRefusedSpec, line: SHELL_REFUSAL },
      { name: 'AC-9 shell-tier warning', setup: fixtureShellWarn, line: SHELL_WARNING },
      { name: 'AC-9 python-tier warning', setup: fixturePythonWarn, line: PYTHON_WARNING, needsPython: true },
    ];
    for (const c of cases) {
      it.skipIf(c.needsPython === true && !python3Available())(c.name, () => {
        c.setup();
        // A clean staged script with a passing stub, so Stage 4 really runs.
        stage('scripts/ok.sh', CLEAN_SH);
        const full = runInstalled(renderHook(), pathWith(stubs));
        const base = runInstalled(stage3OnlyHook(), pathWith(stubs));
        expect(full.err).toMatch(c.line);
        expect(base.err).toMatch(c.line);
        expect(rosterLines(full.err)).toEqual(['✓ MinSpec quality: shellcheck passed (1 staged file).']);
        expect(rosterLines(base.err)).toEqual([]);
        expect(full.code).toBe(base.code);
        expect(withoutRoster(full.err)).toBe(base.err);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Task 3 - The actionlint check (FR-5 workflows, FR-8 actionlint)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 3: Stage 4 runs actionlint on the staged top-level workflows', () => {
  let stubs: string;
  let log: string;
  beforeEach(() => {
    stubs = path.join(scratch, 'stubs');
    log = path.join(scratch, 'tool.log');
    stubTool(stubs, 'actionlint', 'lint', log);
  });

  it('a bad staged workflow is refused; a clean one passes with one roster line', () => {
    stage('.github/workflows/ci.yml', `${CLEAN_WF}# STAGE4_BAD\n`);
    const bad = runInstalled(renderHook(), pathWith(stubs));
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('fake finding STAGE4_BAD');
    expect(rosterLines(bad.err)).toEqual(['✗ MinSpec quality: actionlint BLOCKED the commit - its findings are above.']);

    stage('.github/workflows/ci.yml', CLEAN_WF);
    const ok = runInstalled(renderHook(), pathWith(stubs));
    expect(ok.code).toBe(0);
    expect(rosterLines(ok.err)).toEqual(['✓ MinSpec quality: actionlint passed (1 staged file).']);
  });

  it('FR-8: argv carries -shellcheck= and -pyflakes=', () => {
    stage('.github/workflows/ci.yml', CLEAN_WF);
    runInstalled(renderHook(), pathWith(stubs));
    const argv = readLog(log).split('\n').find((l) => l.startsWith('ARGV ')) ?? '';
    expect(argv.split(' ')).toEqual(expect.arrayContaining(['-shellcheck=', '-pyflakes=']));
    expect(argv).not.toContain('-config-file');
  });

  it('D6: a staged .github/actionlint.yaml is passed by -config-file, and its STAGED content is what the tool reads', () => {
    stage('.github/actionlint.yaml', 'self-hosted-runner:\n  labels: [staged-label]\n');
    write('.github/actionlint.yaml', 'self-hosted-runner:\n  labels: [working-copy-label]\n');
    stage('.github/workflows/ci.yml', CLEAN_WF);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    const logText = readLog(log);
    expect(logText).toMatch(/^ARGV .*-config-file \.github\/actionlint\.yaml/m);
    expect(logText).toContain('staged-label');
    expect(logText).not.toContain('working-copy-label');
  });

  it('a nested .github/workflows/sub/x.yml alone produces no Stage-4 output', () => {
    stage('.github/workflows/sub/x.yml', `${CLEAN_WF}# STAGE4_BAD\n`);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([]);
    expect(readLog(log)).toBe('');
  });

  it('INV-2: actionlint absent gives exactly one skip line', () => {
    stage('.github/workflows/ci.yml', CLEAN_WF);
    const r = runInstalled(renderHook(), pathWith(null, ['actionlint']));
    expect(r.code).toBe(0);
    const lines = rosterLines(r.err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^⚠ MinSpec quality: actionlint SKIPPED - not installed \(https:\/\/\S+\)\.$/);
  });

  it('checks run in the fixed order shellcheck, then actionlint', () => {
    stubTool(stubs, 'shellcheck', 'lint', log);
    stage('scripts/ok.sh', CLEAN_SH);
    stage('.github/workflows/ci.yml', CLEAN_WF);
    const r = runInstalled(renderHook(), pathWith(stubs));
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([
      '✓ MinSpec quality: shellcheck passed (1 staged file).',
      '✓ MinSpec quality: actionlint passed (1 staged file).',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Task 4 - The typecheck (FR-2, FR-5, FR-8 tsc; AC-1, AC-4, AC-10, AC-12)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 4: Stage 4 typechecks the staged tree with tsc', () => {
  let stubs: string;
  let log: string;
  beforeEach(() => {
    stubs = path.join(scratch, 'stubs');
    log = path.join(scratch, 'tool.log');
    tscWrapper(stubs);
  });

  /** tsc on PATH only through the wrapper, never a real one. */
  const tscPath = () => `${stubs}${path.delimiter}${pathWithout('tsc', basePath())}`;

  it('AC-1: a staged type error is refused, and the output names the file, the line and `error TS`', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const n: number = 1;\nexport const s: number = "x";\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/src\/a\.ts\(2,14\): error TS2322/);
    expect(rosterLines(r.err)).toEqual(['✗ MinSpec quality: tsc BLOCKED the commit - its findings are above.']);
    // The --listFiles lines are not printed.
    expect(r.err).not.toMatch(/^\/.*lib\.[a-z0-9.]*d\.ts$/m);
  });

  it('a clean staged file passes and the roster says how many staged files were typechecked', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const n: number = 1;\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([
      '✓ MinSpec quality: tsc passed (typechecked 1 of 1 staged TypeScript files).',
    ]);
  });

  it('AC-12: bad staged, fixed in the working copy: refused', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const s: number = "x";\n');
    write('src/a.ts', 'export const s: number = 1;\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(1);
    expect(r.err).toContain('error TS2322');
  });

  it('AC-12: clean staged, bad in the working copy: succeeds', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const s: number = 1;\n');
    write('src/a.ts', 'export const s: number = "x";\n');
    write('src/untracked.ts', 'export const u: number = "x";\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([
      '✓ MinSpec quality: tsc passed (typechecked 1 of 1 staged TypeScript files).',
    ]);
  });

  it('AC-4: no tsc anywhere (npx cache empty): exactly one skip line naming tsc, and the commit succeeds', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const s: number = "x";\n');
    const r = runInstalled(renderHook(), pathWithout('tsc', basePath()));
    expect(r.code).toBe(0);
    const lines = rosterLines(r.err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '⚠ MinSpec quality: tsc SKIPPED - not installed (npm i -D typescript, https://www.typescriptlang.org/download).',
    );
  });

  it('AC-10: clean script with shellcheck, clean TypeScript with no tsc: one pass line, one skip line, twice', () => {
    stubTool(stubs, 'shellcheck', 'lint', log);
    fs.rmSync(path.join(stubs, 'tsc'));
    const p = `${stubs}${path.delimiter}${pathWithout('tsc', basePath())}`;
    const expected = [
      '✓ MinSpec quality: shellcheck passed (1 staged file).',
      '⚠ MinSpec quality: tsc SKIPPED - not installed (npm i -D typescript, https://www.typescriptlang.org/download).',
    ];
    stage('tsconfig.json', TSCONFIG);
    stage('scripts/ok.sh', CLEAN_SH);
    stage('src/a.ts', 'export const n = 1;\n');
    const first = runInstalled(renderHook(), p);
    expect(first.code).toBe(0);
    expect(rosterLines(first.err)).toEqual(expected);

    git('commit', '-q', '--no-verify', '-m', 'first');
    stage('scripts/ok.sh', `${CLEAN_SH}echo again\n`);
    stage('src/a.ts', 'export const n = 2;\n');
    const second = runInstalled(renderHook(), p);
    expect(second.code).toBe(0);
    expect(rosterLines(second.err)).toEqual(expected);
  });

  it('the non-vacuity witness: a solution-style tsconfig.json ("files": []) reports "0 of N"', () => {
    // A solution-style root with one referenced project: `tsc -p` (not `-b`) on it
    // compiles nothing and exits 0. An EMPTY references list is TS18002 instead.
    stage('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './pkg' }] }));
    stage('pkg/tsconfig.json', JSON.stringify({ compilerOptions: { composite: true, types: [] }, include: ['*.ts'] }));
    stage('pkg/p.ts', 'export const p = 1;\n');
    stage('src/a.ts', 'export const s: number = "x";\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([
      '✓ MinSpec quality: tsc passed (typechecked 0 of 2 staged TypeScript files).',
    ]);
  });

  it('FR-2/FR-5: a staged .ts with no tsconfig.json in the index (only in the working copy) produces no output', () => {
    write('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const s: number = "x";\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(0);
    expect(rosterLines(r.err)).toEqual([]);
  });

  it('D7: dependencies are linked in, and a shell whose ln -s cannot make a link BLOCKS with the cause named', () => {
    stage('tsconfig.json', TSCONFIG);
    stage('package.json', '{"name":"fixture","private":true}\n');
    stage('src/a.ts', 'export const n: number = 1;\n');
    fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
    // Real ln: the link is made and the typecheck passes.
    const linked = runInstalled(renderHook(), tscPath());
    expect(linked.code).toBe(0);
    expect(rosterLines(linked.err)).toEqual([
      '✓ MinSpec quality: tsc passed (typechecked 1 of 1 staged TypeScript files).',
    ]);
    // An ln that copies, like Git for Windows without native symlinks.
    fs.writeFileSync(path.join(stubs, 'ln'), '#!/bin/sh\n[ "$1" = "-s" ] && shift\ncp -R "$1" "$2"\n');
    fs.chmodSync(path.join(stubs, 'ln'), 0o755);
    const copied = runInstalled(renderHook(), tscPath());
    expect(copied.code).toBe(1);
    expect(rosterLines(copied.err)).toEqual([
      '✗ MinSpec quality: tsc BLOCKED the commit - this shell cannot create symbolic links (ln -s did not make a link), so the staged tree cannot reach node_modules.',
    ]);
  });

  it('a staged type error resolved through a linked dependency is judged against that dependency', () => {
    stage('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], moduleResolution: 'node', module: 'commonjs' }, include: ['src/**/*.ts'] }));
    stage('package.json', '{"name":"fixture","private":true}\n');
    write('node_modules/dep/package.json', '{"name":"dep","types":"index.d.ts"}\n');
    write('node_modules/dep/index.d.ts', 'export declare const v: number;\n');
    stage('src/a.ts', 'import { v } from "dep";\nexport const s: string = v;\n');
    const r = runInstalled(renderHook(), tscPath());
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/src\/a\.ts\(2,14\): error TS2322/);
  });
});

// ---------------------------------------------------------------------------
// Task 5 - The deferral and no-config guards (FR-7, FR-8, FR-9; AC-2, AC-7, AC-8, INV-3, INV-7)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 5: what Stage 4 does NOT do', () => {
  const DEFERRED = ['jscpd', 'madge', 'knip', 'ts-prune', 'eslint', 'radon', 'ruff'];

  it('AC-2: no v2 metric tool runs or is named, even with near-duplicate staged files', () => {
    const stubs = path.join(scratch, 'stubs');
    const sentinels = path.join(scratch, 'sentinels');
    fs.mkdirSync(sentinels, { recursive: true });
    for (const t of DEFERRED) stubTool(stubs, t, 'sentinel', path.join(sentinels, `${t}.ran`));
    stubTool(stubs, 'shellcheck', 'lint', path.join(scratch, 'tool.log'));
    tscWrapper(stubs);
    const dup = 'export function f(a: number): number {\n  const b = a * 2;\n  const c = b + 1;\n  return c - a;\n}\n';
    stage('tsconfig.json', TSCONFIG);
    stage('src/one.ts', dup);
    stage('src/two.ts', dup.replace('function f', 'function g'));
    stage('scripts/one.sh', `${CLEAN_SH}echo dup\n`);
    stage('scripts/two.sh', `${CLEAN_SH}echo dup\n`);
    stage('pyproject.toml', '[project]\nname = "x"\n');
    stage('app/one.py', 'def f(a):\n    return a * 2\n');
    stage('app/two.py', 'def g(a):\n    return a * 2\n');
    const r = runInstalled(renderHook(), `${stubs}${path.delimiter}${pathWithout('tsc', basePath())}`);
    expect(r.code).toBe(0);
    // Non-vacuity: Stage 4 did run.
    expect(rosterLines(r.err)).toHaveLength(2);
    expect(fs.readdirSync(sentinels)).toEqual([]);
    for (const t of DEFERRED) expect(r.err).not.toContain(t);
  });

  it('AC-7: a codeQuality config marking every check non-blocking and disabled changes nothing', () => {
    const stubs = path.join(scratch, 'stubs');
    stubTool(stubs, 'shellcheck', 'lint', path.join(scratch, 'tool.log'));
    tscWrapper(stubs);
    const off = { blocking: false, enabled: false };
    stage(
      '.minspec/config.json',
      JSON.stringify({ codeQuality: { shellcheck: off, actionlint: off, tsc: off, typecheck: off } }),
    );
    stage('tsconfig.json', TSCONFIG);
    stage('src/a.ts', 'export const s: number = "x";\n');
    stage('scripts/bad.sh', BAD_SH);
    const r = runInstalled(renderHook(), `${stubs}${path.delimiter}${pathWithout('tsc', basePath())}`);
    expect(r.code).toBe(1);
    expect(rosterLines(r.err)).toEqual([
      '✗ MinSpec quality: shellcheck BLOCKED the commit - its findings are above.',
      '✗ MinSpec quality: tsc BLOCKED the commit - its findings are above.',
    ]);
  });

  const sc = realTool('shellcheck');
  it.skipIf(sc.skip)('INV-7: a script whose only finding is a shellcheck WARNING commits with no finding printed', () => {
        stage('scripts/warn.sh', '#!/bin/sh\nx="a b"\necho $x\n');
    const r = runInstalled(renderHook(), basePath());
    expect(r.code).toBe(0);
    expect(r.err).not.toContain('SC2086');
    expect(rosterLines(r.err)).toEqual(['✓ MinSpec quality: shellcheck passed (1 staged file).']);
  });

  it('AC-8: the extension declares none of the tools as a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
    expect(declared.length).toBeGreaterThan(0);
    for (const t of ['shellcheck', 'actionlint', 'jscpd', 'madge', 'knip', 'ts-prune']) {
      expect(declared).not.toContain(t);
    }
  });

  afterAll(() => {
    // INV-3: every hook run in this file ran with npm offline and an empty cache.
    expect(hookRunEnvs.length).toBeGreaterThan(0);
    for (const env of hookRunEnvs) {
      expect(env.npm_config_offline).toBe('true');
      expect(env.npm_config_cache).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 6.2 - Real tools (AC-6, AC-12 against real shellcheck and actionlint)
// ---------------------------------------------------------------------------

describe('SPEC-080 task 6: Stage 4 against the real tools (skipped when absent until CI installs them, task 6.1)', () => {
  const sc = realTool('shellcheck');
  const al = realTool('actionlint');

  it.skipIf(sc.skip)('AC-6 (real shellcheck): an `if then` syntax error is refused, naming the file', () => {
        stage('scripts/broken.sh', '#!/bin/sh\nif then\n  echo x\nfi\n');
    const r = runInstalled(renderHook(), basePath());
    expect(r.code).toBe(1);
    expect(r.err).toContain('scripts/broken.sh');
    expect(rosterLines(r.err)).toEqual(['✗ MinSpec quality: shellcheck BLOCKED the commit - its findings are above.']);
  });

  it.skipIf(sc.skip)('AC-12 (real shellcheck): staged content is judged, both directions', () => {
        stage('scripts/x.sh', '#!/bin/sh\nif then\nfi\n');
    write('scripts/x.sh', CLEAN_SH);
    expect(runInstalled(renderHook(), basePath()).code).toBe(1);
    stage('scripts/x.sh', CLEAN_SH);
    write('scripts/x.sh', '#!/bin/sh\nif then\nfi\n');
    expect(runInstalled(renderHook(), basePath()).code).toBe(0);
  });

  it.skipIf(al.skip)('AC-6 (real actionlint): a workflow with an unknown key is refused', () => {
        stage('.github/workflows/ci.yml', `${CLEAN_WF}    bogus-key: 1\n`);
    const r = runInstalled(renderHook(), basePath());
    expect(r.code).toBe(1);
    expect(r.err).toContain('.github/workflows/ci.yml');
    expect(rosterLines(r.err)).toEqual(['✗ MinSpec quality: actionlint BLOCKED the commit - its findings are above.']);

    stage('.github/workflows/ci.yml', CLEAN_WF);
    const ok = runInstalled(renderHook(), basePath());
    expect(ok.code).toBe(0);
    expect(rosterLines(ok.err)).toEqual(['✓ MinSpec quality: actionlint passed (1 staged file).']);
  });
});
