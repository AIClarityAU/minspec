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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
function runInstalled(body: string, pathEnv: string = basePath()): HookRun {
  write(PRE_COMMIT, body, 0o755);
  const npmCache = fs.mkdtempSync(path.join(scratch, 'npm-cache-'));
  const r = spawnSync('sh', [path.join(repo, PRE_COMMIT)], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: pathEnv,
      npm_config_offline: 'true',
      npm_config_cache: npmCache,
      MINSPEC_GATE_OFF: '',
    },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

/**
 * The rendered hook with `echo STAGE3_DONE >&2` inserted before its final `exit`
 * line - the task-1 control (tasks.md 1.2). If Stage 3 still exited from inside a
 * tier, the sentinel would never print; if the final `exit` still read `$?`, the
 * inserted `echo` would change the hook's exit status.
 */
function withSentinel(hook: string): string {
  const lines = hook.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (/^exit\b/.test(l)) last = i;
  });
  if (last < 0) throw new Error('rendered hook has no top-level exit line');
  lines.splice(last, 0, 'echo STAGE3_DONE >&2');
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
    const exits = lines.filter((l) => /^exit\b/.test(l));
    expect(exits[exits.length - 1]).toBe('exit "$minspec_stage3_rc"');
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
