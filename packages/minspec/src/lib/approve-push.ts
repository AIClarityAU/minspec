/**
 * Push an approval commit to the remote, so an Alt+A sign-off cannot be stranded
 * on one machine.
 *
 * Why this exists: commit-on-approve (SPEC-022 FR-1) commits the approval doc +
 * record but never pushes. Approvals are made on `main`, `main` is protected
 * (PR + CI required), and so a plain `git push` is REJECTED — which is exactly why
 * the records pile up locally and get recovered by hand later. Three separate
 * duplicate recovery PRs were opened for the same two records on 2026-07-27.
 *
 * OFFLINE INVARIANT (constitution #1 — "no network calls without explicit user
 * consent"). A push IS a network call, so it never happens implicitly:
 *   • `never`  — no network, ever (the pre-existing behaviour).
 *   • `prompt` — DEFAULT. Commit stays local; the user is offered a push and must
 *                click. The click is the explicit consent.
 *   • `always` — the user set this deliberately; the setting itself is the consent.
 * Nothing here runs unless the caller has already resolved that setting, and the
 * decision seam below is pure, so the offline path is provably network-free.
 *
 * PROTECTED-BRANCH HANDLING. On a protected branch we do NOT try (and fail) to push,
 * and we do NOT rewrite the user's branch. We create a new branch pointing at the
 * SAME commit and push that, leaving the working checkout untouched — a
 * non-destructive operation on a shared checkout (rule #8). The approval is then
 * safe on the remote, which is the actual harm being prevented; the leftover local
 * commit is identical in content, so a later `git pull --rebase` drops it by
 * patch-id without conflict.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000; // a push is network-bound; more headroom than a commit

/** Minimal git surface, injectable so tests drive a stub instead of the network. */
export type GitRun = (args: readonly string[]) => Promise<string> | string;

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

/** How the approval commit should reach the remote. */
export type PushPlanKind =
  | 'push-current' //    the current branch is pushable — push it
  | 'push-new-branch' // the current branch is protected — push a new branch at the same commit
  | 'skip'; //           nothing safe to do (detached HEAD, or no branch)

export interface PushPlan {
  readonly kind: PushPlanKind;
  /** The branch to create+push, for 'push-new-branch'. */
  readonly newBranch?: string;
  /** Why this plan was chosen — surfaced to the user, never invented at the call site. */
  readonly reason: string;
}

export interface DecidePushInput {
  /** Current branch name; '' when HEAD is detached. */
  readonly branch: string;
  /** Branches that reject a direct push. Configured, not probed — no network. */
  readonly protectedBranches: readonly string[];
  /** Branch name to use when the current branch is protected. */
  readonly newBranchName: string;
}

/**
 * PURE. Decide how to get the approval commit to the remote.
 *
 * Deliberately does NOT consider whether an upstream exists: `git push -u origin
 * <branch>` handles both cases, and probing for one is an extra failure mode for no
 * decision value.
 */
export function decidePushPlan(input: DecidePushInput): PushPlan {
  const branch = input.branch.trim();
  if (!branch) {
    // commitApproval already refuses on detached HEAD, so there should be no commit
    // to push. Fail closed rather than guess a target.
    return { kind: 'skip', reason: 'HEAD is detached — no branch to push' };
  }
  const isProtected = input.protectedBranches.some((b) => b.trim() === branch);
  if (isProtected) {
    return {
      kind: 'push-new-branch',
      newBranch: input.newBranchName,
      reason: `'${branch}' is protected — pushing the approval on '${input.newBranchName}' for a PR instead`,
    };
  }
  return { kind: 'push-current', reason: `pushing '${branch}' to origin` };
}

/**
 * PURE. Build the "open a PR" URL for a pushed branch from the origin remote URL.
 *
 * Handles the SSH (`git@host:owner/repo.git`), HTTPS, and scp-less forms, and strips
 * a trailing `.git`. Returns undefined for anything it cannot parse with confidence —
 * a wrong URL is worse than none, because the user would follow it.
 */
export function compareUrlFor(remoteUrl: string, branch: string): string | undefined {
  const url = remoteUrl.trim();
  if (!url) return undefined;
  // git@github.com:owner/repo(.git)  |  ssh://git@github.com/owner/repo(.git)
  // https://github.com/owner/repo(.git)
  const m =
    /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url) ??
    /^ssh:\/\/[^@]+@([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ??
    /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (!m) return undefined;
  const [, host, slug] = m;
  if (!host || !slug || slug.split('/').length < 2) return undefined;
  return `https://${host}/${slug}/compare/${encodeURIComponent(branch)}?expand=1`;
}

/**
 * A branch name for an approval pushed off a protected branch. Deterministic given
 * `now`, so it is testable.
 *
 * The stamp keeps MILLISECONDS deliberately: truncating to whole seconds would let
 * two approvals in the same second derive the same branch, and `git branch` would
 * then fail the second one. Millisecond precision makes the "no collision" property
 * true rather than merely likely.
 */
export function approvalBranchName(slug: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\./g, '');
  const safe =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'record';
  return `approvals/${safe}-${stamp}`;
}

export type PushApprovalOutcome =
  | 'pushed' //         the current branch was pushed
  | 'pushed-branch' //  a new branch was created + pushed (current branch protected)
  | 'skipped' //        nothing to do (detached HEAD)
  | 'not-a-repo'
  | 'failed';

export interface PushApprovalResult {
  readonly outcome: PushApprovalOutcome;
  readonly branch?: string;
  /** PR-open URL, present on 'pushed-branch' when the remote URL was parseable. */
  readonly compareUrl?: string;
  readonly error?: string;
}

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
 * Push the just-made approval commit. Never throws — always resolves to a result,
 * because a push failure must be SURFACED, never swallowed into a success toast
 * (the approval is on disk either way, and the user has to know it is not remote).
 */
export async function pushApproval(
  rootDir: string,
  opts: { readonly protectedBranches: readonly string[]; readonly slug: string; readonly now?: Date },
  run: GitRun = defaultGitRun(rootDir),
): Promise<PushApprovalResult> {
  let branch = '';
  try {
    if ((await run(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
      return { outcome: 'not-a-repo' };
    }
    branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch === 'HEAD') branch = ''; // detached
  } catch {
    return { outcome: 'not-a-repo' };
  }

  const plan = decidePushPlan({
    branch,
    protectedBranches: opts.protectedBranches,
    newBranchName: approvalBranchName(opts.slug, opts.now ?? new Date()),
  });
  if (plan.kind === 'skip') return { outcome: 'skipped', error: plan.reason };

  if (plan.kind === 'push-current') {
    try {
      await run(['push', '-u', 'origin', branch]);
      return { outcome: 'pushed', branch };
    } catch (err) {
      return { outcome: 'failed', branch, error: describeError(err) };
    }
  }

  // Protected branch: create a branch AT THE CURRENT COMMIT and push that. The
  // checkout is never switched and no ref the user is on is rewritten.
  const newBranch = plan.newBranch as string;
  try {
    await run(['branch', newBranch, 'HEAD']);
  } catch (err) {
    return { outcome: 'failed', branch: newBranch, error: describeError(err) };
  }
  try {
    await run(['push', '-u', 'origin', `${newBranch}:${newBranch}`]);
  } catch (err) {
    // Leave no half-made local branch behind on a failed push.
    try {
      await run(['branch', '-D', newBranch]);
    } catch {
      /* best-effort cleanup; the push error is what matters */
    }
    return { outcome: 'failed', branch: newBranch, error: describeError(err) };
  }
  let compareUrl: string | undefined;
  try {
    compareUrl = compareUrlFor((await run(['remote', 'get-url', 'origin'])).trim(), newBranch);
  } catch {
    compareUrl = undefined; // a missing URL degrades the toast, never the push
  }
  // Delete the LOCAL branch now that the remote has it. Under `always` every Alt+A on
  // a protected branch would otherwise leave a permanent throwaway ref, and the branch
  // list would fill with `approvals/…` within a day. The remote branch (and its PR) is
  // the artefact that matters; the commit is also still reachable from the local
  // protected branch, so nothing is lost. Best-effort: failing to tidy up must never
  // downgrade a push that already succeeded.
  try {
    await run(['branch', '-D', newBranch]);
  } catch {
    /* the ref lingers locally; harmless, and the push is what was asked for */
  }
  return { outcome: 'pushed-branch', branch: newBranch, compareUrl };
}
