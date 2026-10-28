/**
 * Stranded protected-branch detection (SPEC-057) — an independent second witness
 * to the #1064/#1115 commit-time guard (constitution invariant #2).
 *
 * When the checkout is ON its protected default branch and that branch carries
 * local commits its upstream does not have, the probe reports the count and the
 * leading commits. It re-reads git state itself every call (INV-4): it never
 * consults whether `commitApprovalIfEnabled` ran, so a stale build, an
 * uninstalled hook or a documented bypass cannot silence it.
 *
 * Invariants:
 *   - INV-1: no checkout/switch/merge/rebase/reset anywhere. Recovery only creates
 *     and pushes a NEW ref at the current SHA (via approve-push's `push-new-branch`).
 *   - INV-2: detection is local-only (no network). Only the recovery push is
 *     network, and only when the caller's `pushOnApprove` setting allows it.
 *   - INV-3: never throws; any uncertainty yields `null` ("no signal").
 *   - INV-5: never writes `status:`, a sidecar, or an approval record.
 *
 * Tier-0: fs/git only, no vscode import — the command layer owns the notification.
 */

import { resolveBranchDestination, type GitRun } from './approve-commit';
import { pushApproval, type PushApprovalResult } from './approve-push';

/** Max leading commits reported (FR-1c). */
export const MAX_LEADING_COMMITS = 5;

export interface StrandedCommit {
  readonly sha: string;
  readonly subject: string;
}

export interface StrandedSignal {
  /** The protected default branch the checkout is on. */
  readonly branch: string;
  /** Commits ahead of the upstream (or `origin/<default>`). */
  readonly ahead: number;
  /** HEAD's full SHA — the idempotency key for FR-7. */
  readonly headSha: string;
  /** Up to {@link MAX_LEADING_COMMITS} commits, newest first. */
  readonly commits: readonly StrandedCommit[];
}

async function tryRun(run: GitRun, args: readonly string[]): Promise<string | null> {
  try {
    return String(await run(args));
  } catch {
    return null;
  }
}

function parseCount(out: string | null): number | null {
  if (out === null) return null;
  const t = out.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * Probe for commits stranded ahead on the protected default branch. Resolves to
 * `null` ("no signal") when the branch is not protected, nothing is ahead, or
 * git state cannot be determined. Never rejects (INV-3).
 */
export async function probeStrandedBranch(
  run: GitRun,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StrandedSignal | null> {
  try {
    // FR-1a: reuse the commit-time guard's branch resolution so the two never
    // disagree on which branch is protected (R3). Only the branch MATCH is
    // reused; the ahead count below is a fresh read (INV-4).
    const dest = await resolveBranchDestination(run, env);
    if (!dest || dest.current !== dest.default) return null; // OQ-2 / AC-7

    // Upstream if configured, else origin/<default>.
    let range = '@{u}..HEAD';
    let ahead = parseCount(await tryRun(run, ['rev-list', '--count', range]));
    if (ahead === null) {
      range = `origin/${dest.default}..HEAD`;
      ahead = parseCount(await tryRun(run, ['rev-list', '--count', range]));
    }
    if (ahead === null || ahead <= 0) return null;

    const headSha = (await tryRun(run, ['rev-parse', 'HEAD']))?.trim() ?? '';
    if (!headSha) return null;

    const log = await tryRun(run, [
      'log',
      `--max-count=${MAX_LEADING_COMMITS}`,
      '--format=%h%x09%s',
      range,
    ]);
    const commits: StrandedCommit[] = (log ?? '')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(0, MAX_LEADING_COMMITS)
      .map((l) => {
        const tab = l.indexOf('\t');
        return tab < 0
          ? { sha: l.trim(), subject: '' }
          : { sha: l.slice(0, tab).trim(), subject: l.slice(tab + 1).trim() };
      });

    return { branch: dest.current, ahead, headSha, commits };
  } catch {
    return null; // fail open — advisory, never a gate
  }
}

/**
 * FR-7: remembers the last-notified HEAD SHA and ahead-count per workspace.
 * Re-notifies when either changes; stays quiet for an identical repeat.
 * `clear()` is for "probe returned no signal" so a later re-stranding re-shows.
 */
export class StrandedNotifyTracker {
  private last: { headSha: string; ahead: number } | null = null;

  /** True (and records) when this signal has not already been shown. */
  shouldNotify(signal: StrandedSignal): boolean {
    if (this.last && this.last.headSha === signal.headSha && this.last.ahead === signal.ahead) {
      return false;
    }
    this.last = { headSha: signal.headSha, ahead: signal.ahead };
    return true;
  }

  clear(): void {
    this.last = null;
  }
}

export type PushOnApprove = 'never' | 'prompt' | 'always';

export interface StrandedAdvisory {
  readonly message: string;
  /** Whether to offer the "Save on a branch and push" action (FR-5). */
  readonly offerPush: boolean;
  /** `always` ⇒ the standing setting is the consent; otherwise a click is. */
  readonly pushWithoutClick: boolean;
}

/**
 * PURE. Compose the advisory text and consent shape from a signal and the
 * `minspec.pushOnApprove` setting. `never` still yields an advisory (visibility
 * only) but offers no push (FR-5, INV-2).
 */
export function buildStrandedAdvisory(
  signal: StrandedSignal,
  pushOnApprove: PushOnApprove,
): StrandedAdvisory {
  const noun = signal.ahead === 1 ? 'commit' : 'commits';
  const lead = signal.commits.map((c) => `${c.sha} ${c.subject}`.trim()).join('; ');
  const more = signal.ahead > signal.commits.length ? `; +${signal.ahead - signal.commits.length} more` : '';
  let message = `'${signal.branch}' has ${signal.ahead} local ${noun} not on its remote: ${lead}${more}.`;
  if (pushOnApprove === 'never') {
    message += ' Push them from a new branch by hand (git branch <name> HEAD && git push -u origin <name>).';
  }
  return {
    message,
    offerPush: pushOnApprove !== 'never',
    pushWithoutClick: pushOnApprove === 'always',
  };
}

/**
 * FR-5: save the stranded commits on a NEW branch at the current SHA and push it.
 * Delegates to approve-push's `push-new-branch` plan (current branch treated as
 * protected) — no checkout/switch/merge/rebase/reset (INV-1). The caller must
 * already hold consent per {@link buildStrandedAdvisory}.
 */
export function pushStrandedBranch(
  rootDir: string,
  signal: StrandedSignal,
  run?: GitRun,
  now?: Date,
): Promise<PushApprovalResult> {
  return pushApproval(
    rootDir,
    { protectedBranches: [signal.branch], slug: 'stranded', now },
    run,
  );
}
