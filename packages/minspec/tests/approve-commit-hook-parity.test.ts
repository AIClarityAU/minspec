/**
 * T0 parity — the TS commit-destination guard and the #1041 pre-commit hook must
 * decide EVERY commit the same way.
 *
 * They are two halves of one rule (#1064). The TS guard runs FIRST, before any
 * `git add`, so the two failure modes are not symmetric:
 *
 *   • TS refuses where the hook would allow → a FALSE BLOCK. The user set a
 *     documented opt-out (`MINSPEC_ALLOW_MAIN`, `minspec.allowCommitOnDefaultBranch`)
 *     or is mid-merge, and their approval is refused anyway with no escape —
 *     the hook never gets to say yes. This is the regression the first two
 *     revisions of #1089 shipped.
 *   • TS allows where the hook refuses → the guard is INERT: the commit proceeds,
 *     the hook rejects it, and the result degrades to `'failed'` with files left
 *     staged — the exact stranding #1064 exists to end.
 *
 * A source-text assertion ("both files contain the string X") cannot catch
 * either: it passes against a guard whose conditions are right and whose LOGIC
 * is wrong. So this drives one scenario table through BOTH implementations
 * against real temp repositories, and asserts the outcomes agree:
 *
 *     hook blocks  ⟺  commitApproval returns 'protected-branch'
 *     hook allows  ⟺  commitApproval returns 'committed'
 *
 * The second half is what makes the test strong. When the TS guard wrongly
 * allows, the real hook fires during `commitApproval`'s own `git commit` and the
 * outcome is `'failed'`, not `'committed'` — so the divergence is observable
 * without this test needing to know WHICH side is wrong.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, MINSPEC_HOOKS_DIR, renderManagedFile } from '../src/lib/template-registry';
import { commitApproval, defaultGitRun } from '../src/lib/approve-commit';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const PRE_COMMIT = `${MINSPEC_HOOKS_DIR}/pre-commit`;
const hookText = () => renderManagedFile(MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === PRE_COMMIT)!);

/** How a scenario shapes its repo before either implementation is asked. */
interface Scenario {
  readonly name: string;
  /** Branch the repo is created on. */
  readonly branch?: string;
  /** origin/HEAD target; `null` leaves it unset (the common real-world shape). */
  readonly originHead?: string | null;
  /** Create a `remote.origin.url`? A repo with no remote can push nowhere. */
  readonly remote?: boolean;
  /** Extra local branches to create (never checked out). */
  readonly alsoBranches?: readonly string[];
  /** `git config` keys to set. */
  readonly config?: Readonly<Record<string, string>>;
  /** Env vars in force for BOTH implementations. */
  readonly env?: Readonly<Record<string, string>>;
  /** Git-dir entries to create, modelling an operation in progress. */
  readonly gitDirFiles?: readonly string[];
  readonly gitDirDirs?: readonly string[];
  /** Expected shared decision. */
  readonly blocked: boolean;
  /**
   * Expected `commitApproval` outcome, when it is NOT the default implied by
   * `blocked` ('protected-branch' when blocked, 'committed' otherwise). Set only
   * where git itself — not the guard — prevents the commit; see the merge and
   * cherry-pick cases.
   */
  readonly tsOutcome?: 'committed' | 'failed';
  /** Why this case exists — kept in the failure output. */
  readonly because: string;
}

function git(dir: string, args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: cleanEnv() });
}

/** Ambient MinSpec bypasses stripped — a scenario opts in explicitly. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.MINSPEC_GATE_OFF;
  delete base.MINSPEC_ALLOW_MAIN;
  return { ...base, ...extra };
}

/** A temp repo shaped by `s`, with the rendered hook installed. */
function makeRepo(s: Scenario): string {
  const branch = s.branch ?? 'main';
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-parity-')));

  git(dir, ['init', '-b', branch, '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  if (s.remote !== false) git(dir, ['config', 'remote.origin.url', 'https://example.invalid/repo.git']);

  // Seed history with the hook NOT yet installed, so setup can never be blocked.
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(dir, ['add', 'seed.txt']);
  git(dir, ['commit', '-q', '-m', 'seed', '--no-verify']);

  for (const b of s.alsoBranches ?? []) git(dir, ['branch', b]);

  const originHead = s.originHead === undefined ? branch : s.originHead;
  if (originHead !== null) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    git(dir, ['update-ref', `refs/remotes/origin/${originHead}`, head]);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${originHead}`]);
  }

  for (const [k, v] of Object.entries(s.config ?? {})) git(dir, ['config', k, v]);

  const gitDir = path.join(dir, '.git');
  const hookPath = path.join(gitDir, 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, hookText());
  fs.chmodSync(hookPath, 0o755);
  return dir;
}

/**
 * (Re-)create the in-progress markers a scenario asks for.
 *
 * Must run before EACH half, not once at setup: a successful `git commit` with
 * MERGE_HEAD present completes the merge and DELETES the marker, so the hook
 * probe would otherwise consume the very state the TS half is meant to see —
 * and the parity test would report a divergence that does not exist.
 */
function applyInProgressState(dir: string, s: Scenario): void {
  const gitDir = path.join(dir, '.git');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  for (const f of s.gitDirFiles ?? []) fs.writeFileSync(path.join(gitDir, f), `${head}\n`);
  for (const d of s.gitDirDirs ?? []) fs.mkdirSync(path.join(gitDir, d), { recursive: true });
}

/** Does the HOOK refuse a plain authored commit here? */
function hookBlocks(dir: string, s: Scenario): boolean {
  const file = 'by-hook.txt';
  fs.writeFileSync(path.join(dir, file), 'hook probe\n');
  const env = cleanEnv(s.env ?? {});
  execFileSync('git', ['add', file], { cwd: dir, stdio: 'pipe', env });
  try {
    execFileSync('git', ['commit', '-m', 'chore(test): hook probe'], { cwd: dir, stdio: 'pipe', env });
    return false;
  } catch {
    return true;
  } finally {
    // Leave the index clean either way, so the TS half starts from the same state.
    try {
      execFileSync('git', ['reset', '-q', '--', file], { cwd: dir, stdio: 'pipe', env });
    } catch {
      /* best effort */
    }
    fs.rmSync(path.join(dir, file), { force: true });
  }
}

const SCENARIOS: readonly Scenario[] = [
  // ── the guard must fire ────────────────────────────────────────────────────
  {
    name: 'authored commit on the default branch (origin/HEAD set)',
    blocked: true,
    because: 'the case the whole guard exists for',
  },
  {
    name: 'default branch with NO origin/HEAD (the real-repo shape)',
    originHead: null,
    blocked: true,
    because: "origin/HEAD was absent in both repos this guard was written for",
  },
  {
    name: 'on `master` while a stale local `main` also exists',
    branch: 'master',
    originHead: null,
    alsoBranches: ['main'],
    blocked: true,
    because:
      'picking the first conventional branch that EXISTS yields main ≠ master, so the guard would go inert exactly here',
  },
  {
    name: 'custom protected name via minspec.protectedBranches',
    branch: 'delivery',
    originHead: null,
    config: { 'minspec.protectedBranches': 'delivery release' },
    blocked: true,
    because: 'the hook honours a configured list; a guard that hardcodes main/master/trunk would not',
  },
  {
    name: 'origin/HEAD names a non-conventional default branch',
    branch: 'delivery',
    originHead: 'delivery',
    blocked: true,
    because: 'origin/HEAD outranks the name list in both directions',
  },

  // ── the guard must stay out of the way ─────────────────────────────────────
  {
    name: 'a feature branch',
    branch: 'fix/thing',
    originHead: 'main',
    blocked: false,
    because: 'ordinary work must be untouched',
  },
  {
    name: 'MINSPEC_ALLOW_MAIN=1 on the default branch',
    env: { MINSPEC_ALLOW_MAIN: '1' },
    blocked: false,
    because: 'the documented one-shot bypass — refusing here is a false block with no escape',
  },
  {
    name: 'minspec.allowCommitOnDefaultBranch=true',
    config: { 'minspec.allowCommitOnDefaultBranch': 'true' },
    blocked: false,
    because: 'the documented per-repo opt-out',
  },
  {
    name: 'MINSPEC_GATE_OFF=1 (whole hook off)',
    env: { MINSPEC_GATE_OFF: '1' },
    blocked: false,
    because: 'with the hook disabled entirely, nothing downstream may refuse in its name',
  },
  {
    name: 'mid-merge on the default branch',
    gitDirFiles: ['MERGE_HEAD'],
    blocked: false,
    // The GUARD must not fire here — and it doesn't. The commit still cannot
    // land, because git refuses a *partial* (pathspec) commit mid-merge:
    // `fatal: cannot do a partial commit during a merge.` That is git's rule,
    // not MinSpec's, and commit-on-approve is pathspec-only by invariant 1
    // (a bare commit would sweep another session's staged files). Asserting
    // 'committed' here would be asserting something git forbids. Known
    // limitation, tracked at #1112.
    tsOutcome: 'failed',
    because: 'a merge commit is how a branch legitimately LANDS on main — the guard must not claim otherwise',
  },
  {
    name: 'mid-cherry-pick on the default branch',
    gitDirFiles: ['CHERRY_PICK_HEAD'],
    blocked: false,
    tsOutcome: 'failed', // same git restriction as merge (#1112)
    because: 'same reasoning as merge',
  },
  {
    name: 'mid-revert on the default branch',
    gitDirFiles: ['REVERT_HEAD'],
    blocked: false,
    because: 'same reasoning as merge',
  },
  {
    name: 'a configured list REPLACES the defaults rather than extending them',
    branch: 'main',
    originHead: null,
    config: { 'minspec.protectedBranches': 'delivery' },
    blocked: false,
    because: 'opting a project into custom names must be able to opt `main` OUT',
  },
  {
    name: 'no remote at all, on main',
    originHead: null,
    remote: false,
    blocked: false,
    because: 'nothing to push to means nothing can be push-protected — scratch repos must not be bricked',
  },
  {
    name: 'unconventional branch name, no origin/HEAD',
    branch: 'delivery',
    originHead: null,
    blocked: false,
    because: 'unknown destination fails OPEN — never-wrong rule',
  },
];

const tempDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('commit-destination guard — parity with the #1041 pre-commit hook', () => {
  it.each(SCENARIOS)('$name', async (s) => {
    const dir = makeRepo(s);
    tempDirs.push(dir);

    // 1. What does the HOOK do? (real commit, real hook)
    applyInProgressState(dir, s);
    expect(hookBlocks(dir, s), `hook expectation wrong for: ${s.because}`).toBe(s.blocked);

    // 2. What does the TS guard do, given the same repo and the same env?
    //    stubEnv reaches both halves: the guard reads process.env, and
    //    defaultGitRun spreads process.env into every git child.
    vi.stubEnv('MINSPEC_GATE_OFF', s.env?.MINSPEC_GATE_OFF ?? '');
    vi.stubEnv('MINSPEC_ALLOW_MAIN', s.env?.MINSPEC_ALLOW_MAIN ?? '');
    applyInProgressState(dir, s);

    const approval = path.join(dir, 'approval.txt');
    fs.writeFileSync(approval, 'approved\n');
    const result = await commitApproval(dir, [approval], 'chore(test): approval', defaultGitRun(dir));

    if (s.blocked) {
      // Refused UP FRONT — never 'failed', which would mean it staged, tried,
      // and let the hook reject it (the stranding this fix ends).
      expect(result.outcome, `TS guard should refuse: ${s.because}`).toBe('protected-branch');
      expect(result.branch?.current).toBeTruthy();
    } else {
      // The hook allowed it, so the guard must not refuse. Normally that means
      // the commit lands ('committed'); the only sanctioned exception is a case
      // where GIT itself forbids the pathspec commit, declared per-scenario.
      expect(result.outcome, `TS guard should allow: ${s.because}`).toBe(s.tsOutcome ?? 'committed');
      expect(result.outcome, 'a false block — the hook allowed this commit').not.toBe('protected-branch');
    }
  });

  it('refusing stages NOTHING — the shared index is untouched', async () => {
    // Invariant 3 + invariant 4 together: another concurrent session's bare
    // commit must not find our approval pre-staged after a refusal.
    const dir = makeRepo({ name: 'x', blocked: true, because: 'index hygiene' });
    tempDirs.push(dir);
    vi.stubEnv('MINSPEC_GATE_OFF', '');
    vi.stubEnv('MINSPEC_ALLOW_MAIN', '');

    const approval = path.join(dir, 'approval.txt');
    fs.writeFileSync(approval, 'approved\n');
    const result = await commitApproval(dir, [approval], 'chore(test): approval', defaultGitRun(dir));

    expect(result.outcome).toBe('protected-branch');
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: dir,
      encoding: 'utf8',
      env: cleanEnv(),
    }).trim();
    expect(staged).toBe('');
  });

  it('a no-op re-approve on the default branch is silent, not a protected-branch warning', async () => {
    // The guard must refuse no MORE than the hook does. A re-approve that
    // changed neither the doc nor the record is a no-op — there is no commit to
    // refuse, so answering 'protected-branch' would make the command layer warn
    // "approval written but NOT committed — files left in your working tree"
    // about files that are identical to HEAD. False on both halves.
    const dir = makeRepo({ name: 'x', blocked: true, because: 'no-op re-approve' });
    tempDirs.push(dir);
    vi.stubEnv('MINSPEC_GATE_OFF', '');
    vi.stubEnv('MINSPEC_ALLOW_MAIN', '');

    // Commit the approval first (on a branch, so the guard is not in the way),
    // then return to the default branch with the file matching HEAD exactly.
    const approval = path.join(dir, 'approval.txt');
    fs.writeFileSync(approval, 'approved\n');
    git(dir, ['switch', '-q', '-c', 'tmp/seed-approval']);
    git(dir, ['add', '--', 'approval.txt']);
    git(dir, ['commit', '-q', '-m', 'chore(test): seed approval', '--no-verify']);
    git(dir, ['switch', '-q', 'main']);
    git(dir, ['merge', '-q', '--ff-only', 'tmp/seed-approval']);

    const result = await commitApproval(dir, [approval], 'chore(test): approval', defaultGitRun(dir));
    expect(result.outcome).toBe('nothing-to-commit');
  });

  it('a CHANGED approval on the default branch is still refused', async () => {
    // The companion to the case above: the no-op probe must not swallow a real
    // change and let it through to a hook rejection.
    const dir = makeRepo({ name: 'x', blocked: true, because: 'real change still guarded' });
    tempDirs.push(dir);
    vi.stubEnv('MINSPEC_GATE_OFF', '');
    vi.stubEnv('MINSPEC_ALLOW_MAIN', '');

    const approval = path.join(dir, 'approval.txt');
    fs.writeFileSync(approval, 'approved\n');
    const result = await commitApproval(dir, [approval], 'chore(test): approval', defaultGitRun(dir));
    expect(result.outcome).toBe('protected-branch');
  });

  it('detached HEAD reports detached-head, not protected-branch', async () => {
    // Ordering matters: the detached guard runs first, so the user gets the
    // accurate reason. The hook allows detached commits, so a 'protected-branch'
    // here would also be a false block.
    const dir = makeRepo({ name: 'x', blocked: false, because: 'detached' });
    tempDirs.push(dir);
    git(dir, ['checkout', '-q', '--detach']);
    vi.stubEnv('MINSPEC_GATE_OFF', '');
    vi.stubEnv('MINSPEC_ALLOW_MAIN', '');

    const approval = path.join(dir, 'approval.txt');
    fs.writeFileSync(approval, 'approved\n');
    const result = await commitApproval(dir, [approval], 'chore(test): approval', defaultGitRun(dir));
    expect(result.outcome).toBe('detached-head');
  });
});
