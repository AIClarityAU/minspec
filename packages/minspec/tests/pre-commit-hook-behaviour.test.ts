/**
 * #1277 (option 3) — T0: `.githooks/pre-commit` judged by what it DOES.
 *
 * WHY THIS EXISTS. `core.hooksPath` is an absolute path to the primary checkout, so every
 * worktree runs the primary's hooks rather than its own. A hook change therefore cannot be
 * exercised by committing from a worktree — the copy you edited is not the copy that runs.
 * That is #1277, and it is very likely why #1263 (a false-refusal bug in the sibling
 * pre-push hook) survived: the fix path and the verification path never met.
 *
 * The durable mitigation is to stop depending on which copy git would run. This suite
 * INVOKES THE HOOK FILE DIRECTLY in a temp repo, so its verdict is about the hook's
 * behaviour and nothing else.
 *
 * It complements, rather than replaces, pre-commit-protected-branch.test.ts, whose
 * decisive-lines assertions bind the .githooks twin to the generated template (DR-077
 * Decision 6 accepts that substring binding as proportionate). Substring equality proves
 * the two copies AGREE; it cannot prove either one is CORRECT. This proves the behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const HOOK = path.resolve(__dirname, '../../../.githooks/pre-commit');

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** Run the hook exactly as git would: cwd = repo, staged index already prepared. */
function runHook(env: Record<string, string> = {}): { code: number; err: string } {
  const r = spawnSync('bash', [HOOK], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

function write(rel: string, body: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-'));
  git('init', '-q', '-b', 'main');
  // Identity in the REPO, not per-command: any git operation the hook itself performs
  // inherits it, and a CI runner carries no global identity (learned in #1263).
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  // Make `main` resolvable as the default branch the guard protects.
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('#1277 pre-commit protected-branch guard — behaviour', () => {
  it('REFUSES a commit on the default branch', () => {
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '-A');
    const { code } = runHook();
    expect(code).not.toBe(0);
  });

  it('ALLOWS the same commit on a feature branch', () => {
    git('checkout', '-q', '-b', 'feature');
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '-A');
    const { code, err } = runHook();
    expect(err).not.toMatch(/refus/i);
    expect(code).toBe(0);
  });

  it('honours the documented MINSPEC_ALLOW_MAIN escape', () => {
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '-A');
    expect(runHook({ MINSPEC_ALLOW_MAIN: '1' }).code).toBe(0);
  });

  it('FAILS OPEN on a detached HEAD, where there is no branch to judge', () => {
    // The guard's contract is to refuse a known-bad destination, never to block work whose
    // destination it cannot determine — the same fail-open property #1263 restored to the
    // pre-push sibling.
    git('checkout', '-q', '--detach');
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '-A');
    expect(runHook().code).toBe(0);
  });
});

describe('#1277 pre-commit DR-029 born-proposed gate — behaviour', () => {
  const ACCEPTED = '---\nid: DR-999\ntitle: T\nstatus: accepted\n---\n\n# T\n';
  const PROPOSED = '---\nid: DR-999\ntitle: T\nstatus: proposed\n---\n\n# T\n';

  // The hook runs THREE gates. A bare temp repo also trips the `validate` gate, because a
  // DR that is not in INDEX.md is a real index-drift failure. Disabling that unrelated gate
  // is what isolates the one under test — without it, every case below would exit non-zero
  // and the "refuses" assertions would pass for the wrong reason. (Found by this suite:
  // the first draft asserted only the exit code and was green for exactly that reason.)
  const ISOLATE = { DR_INDEX_GATE_OFF: '1' };

  it('REFUSES a newly-added DR born `accepted` — and says so', () => {
    git('checkout', '-q', '-b', 'feature');
    write('docs/decisions/DR-999.md', ACCEPTED);
    git('add', '-A');
    const { code, err } = runHook(ISOLATE);
    expect(code).not.toBe(0);
    // Assert WHICH gate refused. An exit code alone cannot tell the DR-029 gate from any
    // other refusal, which is how a test like this goes vacuously green.
    expect(err).toMatch(/DR-029 gate/);
  });

  it('ALLOWS a newly-added DR born `proposed`', () => {
    git('checkout', '-q', '-b', 'feature');
    write('docs/decisions/DR-999.md', PROPOSED);
    git('add', '-A');
    const { code, err } = runHook(ISOLATE);
    expect(err).not.toMatch(/DR-029 gate/);
    expect(code).toBe(0);
  });

  it('honours the documented ADR_BORN_GATE_OFF escape', () => {
    git('checkout', '-q', '-b', 'feature');
    write('docs/decisions/DR-999.md', ACCEPTED);
    git('add', '-A');
    const { code, err } = runHook({ ...ISOLATE, ADR_BORN_GATE_OFF: '1' });
    expect(err).not.toMatch(/DR-029 gate/);
    expect(code).toBe(0);
  });

  it('ADR_BORN_GATE_OFF scopes to the DR gate ONLY, not the whole hook (#1040)', () => {
    // The regression this guards: the bypass was once a whole-hook `exit 0`, so setting it
    // silently disabled the protected-branch guard too — a silent gate, which constitution
    // invariant 2 forbids. On the default branch it must STILL refuse, and specifically for
    // the BRANCH reason, not incidentally for some other gate.
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '-A');
    const { code, err } = runHook({ ADR_BORN_GATE_OFF: '1', DR_INDEX_GATE_OFF: '1' });
    expect(code).not.toBe(0);
    expect(err).toMatch(/branch|main/i);
  });
});
