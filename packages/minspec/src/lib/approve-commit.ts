/**
 * Commit-on-approve — the durable half of "committed ground truth" (SPEC-022,
 * FR-1). Approving/accepting an approvable writes the doc's status flip and (for
 * specs) the attributed sidecar record; this module makes those writes a real
 * `git commit` so an approval is never left sitting uncommitted in the working
 * tree (the SPEC-023 nuisance — see project memory `project_alt_a_no_autocommit`).
 *
 * Gated by the `minspec.commitOnApprove` setting (default on), read by the
 * command layer — this Tier-0 module stays vscode-free (fs + path + git only,
 * matching `approval.ts`).
 *
 * NEVER-WRONG invariants (load-bearing; DR-003 addendum, project memory
 * `feedback_commit_sweeps_prestaged`):
 *   1. Pathspec-safety. The commit stages/commits ONLY the exact approval paths,
 *      via `git commit -- <paths>` (a partial commit) with GIT_LITERAL_PATHSPECS
 *      set — a bare `git commit` would bundle whatever ANOTHER concurrent session
 *      pre-staged, and a path containing a git glob metachar ([ ] * ?) would
 *      otherwise match a FOREIGN sibling. Do NOT drop the literal-pathspecs env or
 *      the `--` separator, and do NOT "simplify" to `git add -A` / bare commit.
 *   2. Never a false 'committed'. In detached HEAD the commit is unreferenced and
 *      a later checkout silently discards it (losing the approval) — so we refuse
 *      to commit there and return 'detached-head', never 'committed'.
 *   3. No stranded staging. `git add` touches the SHARED index; if the commit then
 *      fails, we `git reset` those exact paths so a failed approval never leaves
 *      files pre-staged for another session's bare commit to sweep up.
 *   4. Resolve the DESTINATION before writing (#1064). Since #1041 the scaffolded
 *      pre-commit hook refuses a commit on the push-protected default branch — a
 *      commit there could never be pushed. Committing anyway produced the
 *      stranding family (#1064 Accept ADR, #1022 Alt+A approve, #874 advance):
 *      files written, commit refused, tree left dirty with NO signal. So on the
 *      default branch we refuse UP FRONT with 'protected-branch', staging
 *      nothing, and let the command layer offer a branch. The refusal must fire
 *      on EXACTLY the commits the hook refuses, no more: it runs first, so a
 *      condition the hook would have allowed (a documented opt-out, an
 *      in-progress merge) but this refuses is a false block with no escape.
 *      Unknown destination (detached, no origin/HEAD, no remote) FAILS OPEN —
 *      unchanged behaviour, never a block. See {@link resolveBranchDestination}.
 *
 * ASYNC + bounded: git runs off the extension-host thread (async execFile) with a
 * timeout, so a slow user pre-commit hook can't freeze the UI on every Alt+A.
 *
 * Best-effort and NEVER rejects: every failure (not a repo, hook rejection, git
 * absent, timeout) degrades to a typed result the caller surfaces as an advisory
 * — the approval record is already written on disk, so a failed commit only means
 * the user commits it themselves, never that the approval is lost.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** Max time (ms) any single git invocation may run — bounds a hung pre-commit hook. */
const GIT_TIMEOUT_MS = 30_000;

/** Fallback default-branch names, in the #1041 hook's order. Keep in sync with it. */
const CONVENTIONAL_DEFAULT_BRANCHES = ['main', 'master', 'trunk'] as const;

/**
 * Git-dir entries marking an operation already in progress. The hook exempts all
 * of these: a commit made mid-merge/cherry-pick/revert/rebase is how a branch
 * legitimately LANDS on the default branch, not authored work being stranded.
 */
const IN_PROGRESS_MARKERS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const;
const IN_PROGRESS_DIRS = ['rebase-merge', 'rebase-apply'] as const;

/** Outcome of a commit-on-approve attempt. Never an exception — always one of these. */
export type CommitApprovalOutcome =
  | 'committed' //         the paths were committed
  | 'not-a-repo' //        rootDir is not inside a git work tree — nothing to do
  | 'detached-head' //     HEAD is detached — refused (a commit here would be orphaned/lost)
  | 'nothing-to-commit' // no given path exists, or none differs from HEAD
  | 'protected-branch' //  HEAD is the push-protected default branch — refused BEFORE staging (#1064)
  | 'failed'; //           git errored (e.g. a pre-commit hook rejected) — files un-staged again

export interface CommitApprovalResult {
  readonly outcome: CommitApprovalOutcome;
  /** Repo-relative paths that were staged/committed (present on 'committed'). */
  readonly paths?: string[];
  /** Error detail incl. git/hook stderr (present on 'failed'). */
  readonly error?: string;
  /** Current + default branch names (present on 'protected-branch'), so the
   *  command layer can name the branch it is refusing to commit onto. */
  readonly branch?: { readonly current: string; readonly default: string };
}

/**
 * Minimal git surface, injectable so tests can drive a stub instead of shelling
 * out. `run` resolves stdout as a string and REJECTS on a non-zero git exit
 * (matching `execFile`), which the commit flow catches. A synchronous stub that
 * returns a string is also accepted (each call is awaited).
 */
export type GitRun = (args: readonly string[]) => Promise<string> | string;

/**
 * Default git runner rooted at `rootDir`. GIT_LITERAL_PATHSPECS=1 disables glob/
 * magic pathspec interpretation for EVERY invocation (invariant 1). stderr is
 * captured so a hook rejection carries its reason into the failure result.
 */
export function defaultGitRun(rootDir: string): GitRun {
  return async (args) => {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: rootDir,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
    });
    return stdout.toString();
  };
}

/** Human-readable error, preferring the git/hook stderr when present. */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    if (stderr) return stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/**
 * Commit exactly `absPaths` (those that exist) into a single commit with
 * `message`, restricted by literal pathspec so no other staged content is swept
 * in and no glob metachar matches a foreign file.
 *
 * @param rootDir  the git work-tree root (also the cwd for git)
 * @param absPaths absolute paths of the approval doc + record (missing ones are skipped)
 * @param message  the commit subject (conventional; never `fix:` so the RCDD gate stays quiet)
 * @param run      injectable git runner (defaults to a real one rooted at rootDir)
 */
export async function commitApproval(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
  run: GitRun = defaultGitRun(rootDir),
): Promise<CommitApprovalResult> {
  // 1. Repo guard — outside a work tree there is nothing to commit into.
  try {
    if ((await run(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
      return { outcome: 'not-a-repo' };
    }
  } catch {
    return { outcome: 'not-a-repo' };
  }

  // 2. Detached-HEAD guard (invariant 2). `symbolic-ref -q HEAD` exits non-zero
  //    (rejects) when HEAD is not on a branch. A commit made there is unreferenced
  //    and a later checkout discards it — so refuse and NEVER claim 'committed'.
  try {
    const ref = (await run(['symbolic-ref', '-q', 'HEAD'])).trim();
    if (!ref) return { outcome: 'detached-head' };
  } catch {
    return { outcome: 'detached-head' };
  }

  // 3. Keep only paths that exist on disk, made repo-relative. A path that
  //    resolves outside the repo (shouldn't happen) is dropped, never committed.
  const rel = absPaths
    .filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    })
    .map((p) => path.relative(rootDir, p))
    .filter((p) => p.length > 0 && !p.startsWith('..' + path.sep) && p !== '..');
  if (rel.length === 0) return { outcome: 'nothing-to-commit' };

  // 3b. Net-change probe, BEFORE the destination guard. `git status` is
  //     read-only — it stages nothing, so this does not weaken invariant 4
  //     (the point of which is that a REFUSAL leaves the shared index
  //     untouched, not that no git command may run first).
  //
  //     Ordering matters for truthfulness. A re-approve that changed neither
  //     the doc nor the record is a no-op; if the destination guard ran first
  //     it would answer 'protected-branch' and the command layer would warn
  //     "approval written but NOT committed — files left in your working tree"
  //     about a commit that was never going to happen and files that do not
  //     differ from HEAD. Refusing a no-op is also strictly MORE than the hook
  //     refuses, which invariant 4 forbids.
  //
  //     `--untracked-files=all` because a brand-new sidecar is untracked and
  //     would otherwise read as "no change" — the inverse false answer.
  //     Advisory: if status fails we fall through to the post-add check below,
  //     which is the pre-existing behaviour.
  try {
    const status = (
      await run(['status', '--porcelain', '--untracked-files=all', '--', ...rel])
    ).trim();
    if (!status) return { outcome: 'nothing-to-commit', paths: rel };
  } catch {
    // fall through — step 5 still catches the no-change case after staging
  }

  // 3c. Destination guard (invariant 4, #1064). MUST come before any `git add`
  //     so a refusal leaves the shared index untouched. Fails open: when the
  //     default branch cannot be determined we proceed exactly as before.
  const branch = await resolveBranchDestination(run);
  if (branch && branch.current === branch.default) {
    return { outcome: 'protected-branch', branch };
  }

  // 4. Stage exactly these paths (this is what makes a NEW untracked sidecar
  //    committable by the pathspec commit below).
  try {
    await run(['add', '--', ...rel]);
  } catch (err) {
    return { outcome: 'failed', error: describeError(err) };
  }

  // 5. If nothing among these paths actually differs from HEAD (e.g. a re-approve
  //    that changed neither the doc nor the record), skip — `git commit --` would
  //    otherwise fail "nothing to commit". `diff --quiet` REJECTS (exit 1) when
  //    there ARE staged changes for these pathspecs; unstage first so the shared
  //    index is left clean.
  let hasStagedChange = false;
  try {
    await run(['diff', '--cached', '--quiet', '--', ...rel]);
  } catch {
    hasStagedChange = true;
  }
  if (!hasStagedChange) {
    await unstage(run, rel);
    return { outcome: 'nothing-to-commit', paths: rel };
  }

  // 6. Partial commit — ONLY these literal pathspecs. Never bundles another
  //    session's pre-staged files (invariant 1).
  try {
    await run(['commit', '-m', message, '--', ...rel]);
    return { outcome: 'committed', paths: rel };
  } catch (err) {
    // Invariant 3: a failed commit must not leave our paths staged in the shared
    // index for another session's bare commit to sweep up. Unstage them again.
    await unstage(run, rel);
    return { outcome: 'failed', error: describeError(err) };
  }
}

/** `git config --get <key>`, or '' when unset (git exits 1) or unreadable. */
async function gitConfig(run: GitRun, key: string): Promise<string> {
  try {
    return (await run(['config', '--get', key])).trim();
  } catch {
    return '';
  }
}

/**
 * Current + default branch names, or `null` when this commit would NOT be
 * refused by the hook — either because the destination cannot be determined, or
 * because the user has opted out (fail open in both cases).
 *
 * MIRRORS the #1041 pre-commit hook's `minspec_branch_guard()` — not just its
 * default-branch RESOLUTION but its whole GUARD CONTRACT. Mirroring only half of
 * it is worse than not mirroring at all: this guard runs BEFORE the hook, so any
 * condition under which the hook would have allowed the commit and this one
 * refuses is a false refusal the user cannot escape by any documented means.
 * The first revision of this fix shipped exactly that. The hook's clauses, in
 * its order (`template-registry.ts`):
 *
 *   1. `MINSPEC_GATE_OFF=1` — the whole hook exits 0, so nothing is refused.
 *   2. `MINSPEC_ALLOW_MAIN=1` — the one-shot documented bypass.
 *   3. `minspec.allowCommitOnDefaultBranch=true` — the per-repo opt-out.
 *   4. an operation already in progress (merge / cherry-pick / revert / rebase)
 *      — that is how a branch legitimately LANDS on the default branch.
 *   5. detached HEAD — no branch name, nothing to strand work on.
 *   6. `origin/HEAD` when present — a LOCAL ref, so the check stays offline.
 *   7. when absent AND a `remote.origin.url` exists, the CURRENT branch is
 *      treated as default only if its NAME is in `minspec.protectedBranches`
 *      (space-separated; REPLACES the `main master trunk` default rather than
 *      extending it). The hook's own comment records that origin/HEAD was
 *      "absent in both repos this guard was written for" — the fallback is the
 *      COMMON path, not the edge case.
 *
 * Note (7) tests the current branch's NAME. Picking the first conventional
 * branch that merely EXISTS locally would diverge: on `master` with a stale
 * local `main`, that yields default=`main` ≠ current, so the graceful
 * `'protected-branch'` refusal never fires and the commit degrades to a raw
 * hook rejection — the `'failed'` stranding this fix exists to end.
 *
 * With no remote at all there is nothing to push to, so no branch can be
 * push-protected — the hook does not guard, and neither do we.
 *
 * Any change here must be mirrored in the hook (and vice versa); they are two
 * halves of one rule, and `approve-commit-hook-parity.test.ts` drives one
 * scenario table through BOTH so a divergence fails a test rather than a user.
 *
 * @param run injectable git runner
 * @param env process environment (injectable so tests need not mutate the real one)
 */
export async function resolveBranchDestination(
  run: GitRun,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ current: string; default: string } | null> {
  // (1-3) Documented bypasses. Each one means the hook would ALLOW this commit,
  //       so refusing here would over-block a sanctioned opt-out.
  if (env.MINSPEC_GATE_OFF === '1') return null;
  if (env.MINSPEC_ALLOW_MAIN === '1') return null;
  if ((await gitConfig(run, 'minspec.allowCommitOnDefaultBranch')) === 'true') return null;

  // (4) An operation already in progress. Read the git dir from git itself
  //     (absolute, so it does not depend on this process's cwd).
  try {
    const gitDir = (await run(['rev-parse', '--absolute-git-dir'])).trim();
    if (!gitDir) return null;
    for (const marker of IN_PROGRESS_MARKERS) {
      if (fs.existsSync(path.join(gitDir, marker))) return null;
    }
    for (const dir of IN_PROGRESS_DIRS) {
      if (fs.existsSync(path.join(gitDir, dir))) return null;
    }
  } catch {
    return null; // cannot locate the git dir — exactly the hook's `return 0`
  }

  // (5) Detached HEAD. `symbolic-ref -q --short HEAD` exits non-zero there.
  let current: string;
  try {
    current = (await run(['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
  } catch {
    return null;
  }
  if (!current) return null;

  // (6) origin/HEAD, the authoritative answer when it exists.
  try {
    const ref = (await run(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])).trim();
    const def = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
    if (def) return { current, default: def };
  } catch {
    // fall through to the hook's fallback
  }

  // (7) No origin/HEAD. Only meaningful when a remote exists — with no remote
  //     nothing is push-protected (the hook's own reasoning).
  if (!(await gitConfig(run, 'remote.origin.url'))) return null;

  const configured = await gitConfig(run, 'minspec.protectedBranches');
  const candidates = configured
    ? configured.split(/\s+/).filter(Boolean)
    : [...CONVENTIONAL_DEFAULT_BRANCHES];
  // The current branch's NAME decides — never "the first of these that exists".
  return candidates.includes(current) ? { current, default: current } : null;
}

/**
 * True when `absPath` has no committed version at HEAD — i.e. staging it next
 * would add it as a brand-new file (`git diff --cached --diff-filter=A`), not
 * modify an existing one. A path outside `rootDir`, or a repo with no HEAD
 * commit yet, both count as untracked (nothing to compare against).
 *
 * Used by ADR acceptance (issue #577) to detect a DR that was created but
 * never committed, before its status is flipped to a terminal value.
 */
export async function isUntrackedAtHead(
  rootDir: string,
  absPath: string,
  run: GitRun = defaultGitRun(rootDir),
): Promise<boolean> {
  const rel = path.relative(rootDir, absPath);
  if (rel.length === 0 || rel.startsWith('..' + path.sep) || rel === '..') return true;
  try {
    await run(['cat-file', '-e', `HEAD:${rel}`]);
    return false;
  } catch {
    return true;
  }
}

/** Best-effort unstage of exactly `rel` (never throws — index-clean is advisory). */
async function unstage(run: GitRun, rel: readonly string[]): Promise<void> {
  try {
    await run(['reset', '-q', '--', ...rel]);
  } catch {
    // ignore — reset is a best-effort cleanup; the commit result already stands.
  }
}
