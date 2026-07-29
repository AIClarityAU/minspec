import * as vscode from 'vscode';
import * as path from 'path';
import {
  commitApproval,
  commitApprovalOnNewBranch,
  isUntrackedAtHead,
  type CommitApprovalResult,
} from '../lib/approve-commit';
import { approvalBranchName, pushApproval, type PushApprovalResult } from '../lib/approve-push';

/**
 * Bridge between the approve/accept commands and the Tier-0 {@link commitApproval}
 * helper. Reads the `minspec.commitOnApprove` setting and folds the commit outcome
 * into a short suffix the caller appends to its own success toast — so an approval
 * produces ONE message stating both the approval and whether it was committed
 * (SPEC-022 FR-1; project memory `project_alt_a_no_autocommit`).
 */

/** Is auto-commit-on-approve enabled? Default on (opt-out via settings). */
export function commitOnApproveEnabled(): boolean {
  return vscode.workspace.getConfiguration('minspec').get<boolean>('commitOnApprove', true);
}

/**
 * Commit the approval paths when the setting is on, returning a toast suffix.
 *
 *   ''                                        — setting off, not a repo, or no net change
 *   ' · committed'                            — the doc (+ record) were committed
 *   ' · not committed (detached HEAD)'        — refused so the approval isn't lost on next checkout
 *   ' · commit failed — files staged'         — git/hook rejected; approval on disk, uncommitted
 *
 * Never rejects (delegates to `commitApproval`, which never rejects). A failed or
 * refused commit is surfaced (never-wrong: the user must know the approval is
 * uncommitted), with the full git/hook stderr logged for diagnosis.
 */
/** Offer labels — worded to match #1054's harness-commit offer, so the two
 *  destination guards read as one behaviour rather than two dialects. */
const BRANCH_COMMIT_ACTION = 'Commit on a new branch';
const LEAVE_IN_TREE_ACTION = 'Leave in working tree';

export async function commitApprovalIfEnabled(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
): Promise<{ suffix: string; result?: CommitApprovalResult }> {
  if (!commitOnApproveEnabled()) return { suffix: '' };
  const result = await commitApproval(rootDir, absPaths, message);
  switch (result.outcome) {
    case 'committed': {
      // Push from HERE, not from each caller: spec-approve, ADR-accept and
      // epic-accept all funnel through this helper, so wiring it once means no
      // approval path can silently miss it as new ones are added.
      const slug = (result.paths?.[0] ?? message).replace(/\.[a-z]+$/i, '');
      const { suffix: pushSuffix } = await pushApprovalIfEnabled(rootDir, slug);
      return { suffix: ` · committed${pushSuffix}`, result };
    }
    case 'protected-branch': {
      // #1064: the default branch is push-protected, so a commit there could
      // never be pushed and #1041's hook refuses it. Nothing was staged. Offer
      // the one-click recovery instead of failing silently — the whole defect
      // was that the maintainer believed the approval had landed when it had not.
      const current = result.branch?.current ?? 'the default branch';
      const choice = await vscode.window.showWarningMessage(
        `Approval written, but '${current}' is the default branch — a commit there cannot be pushed. Commit it on a new branch instead?`,
        BRANCH_COMMIT_ACTION,
        LEAVE_IN_TREE_ACTION,
      );
      if (choice !== BRANCH_COMMIT_ACTION) {
        return {
          suffix: ` · NOT committed (on ${current} — files left in your working tree)`,
          result,
        };
      }
      const slug = (absPaths[0] ?? message).replace(/\.[a-z]+$/i, '');
      const branched = await commitApprovalOnNewBranch(
        rootDir,
        approvalBranchName(path.basename(slug), new Date()),
        absPaths,
        message,
      );
      if (branched.outcome !== 'committed') {
        console.warn(`MinSpec: branch-commit failed — ${branched.error ?? 'git error'}`);
        return {
          suffix: ` · NOT committed (branch attempt failed — files left in your working tree)`,
          result: branched,
        };
      }
      const { suffix: pushSuffix } = await pushApprovalIfEnabled(rootDir, slug);
      return {
        suffix: ` · committed on ${branched.createdBranch}${pushSuffix}`,
        result: branched,
      };
    }
    case 'detached-head':
      // A commit here would be orphaned by the next checkout — refuse and say so.
      return { suffix: ' · not committed (detached HEAD — switch to a branch)', result };
    case 'failed':
      // Log the detail (incl. hook stderr); keep the toast short. The approval
      // record is already on disk — only the git commit failed.
      console.warn(`MinSpec: commit-on-approve failed — ${result.error ?? 'git error'}`);
      return { suffix: ' · commit failed — files staged (see console)', result };
    default:
      // 'not-a-repo' | 'nothing-to-commit' — no net change worth reporting.
      return { suffix: '', result };
  }
}

/** How aggressively an approval commit should be pushed. Default `prompt`. */
export type PushOnApproveMode = 'never' | 'prompt' | 'always';

export function pushOnApproveMode(): PushOnApproveMode {
  const v = vscode.workspace.getConfiguration('minspec').get<string>('pushOnApprove', 'prompt');
  return v === 'never' || v === 'always' ? v : 'prompt';
}

function protectedBranches(): string[] {
  return vscode.workspace
    .getConfiguration('minspec')
    .get<string[]>('protectedBranches', ['main', 'master']);
}

/**
 * Push the approval commit, so a sign-off cannot be stranded on one machine
 * (the Alt+A stranding bug: commit-on-approve commits but never pushes, approvals
 * are made on protected `main`, and a direct push there is rejected).
 *
 * OFFLINE INVARIANT (constitution #1). A push is a network call, so:
 *   • `never`  — returns immediately; no git, no network.
 *   • `prompt` — DEFAULT. Shows a NON-MODAL notification and pushes only if the user
 *                clicks. The click is the explicit consent. Dismissing is a no-op,
 *                and the approval is already safely committed locally either way.
 *   • `always` — the user set this deliberately; the setting is the consent.
 *
 * Never rejects: a push failure is surfaced in the suffix, never swallowed, because
 * the user must know the record is still local-only.
 */
export async function pushApprovalIfEnabled(
  rootDir: string,
  slug: string,
): Promise<{ suffix: string; result?: PushApprovalResult }> {
  const mode = pushOnApproveMode();
  if (mode === 'never') return { suffix: '' };

  if (mode === 'prompt') {
    // Non-modal (project preference: never steal focus from the artifact being
    // approved). `showInformationMessage` with actions is notification-area only.
    const choice = await vscode.window.showInformationMessage(
      'Approval committed locally. Push it so the sign-off is not stranded on this machine?',
      'Push',
      'Not now',
    );
    if (choice !== 'Push') return { suffix: ' · not pushed' };
  }

  // Defensive guard so "never rejects" is a LOCAL guarantee, not one borrowed from
  // pushApproval. `commitApprovalIfEnabled` documents never-rejects and now awaits this
  // function; relying on the seam's contract transitively means a future change there
  // could silently break an approval toast that has nothing to do with pushing.
  let result: PushApprovalResult;
  try {
    result = await pushApproval(rootDir, { protectedBranches: protectedBranches(), slug });
  } catch (err) {
    console.warn(`MinSpec: push-on-approve threw — ${err instanceof Error ? err.message : String(err)}`);
    return { suffix: ' · push failed — still local only (see console)' };
  }
  switch (result.outcome) {
    case 'pushed':
      return { suffix: ' · pushed', result };
    case 'pushed-branch': {
      // The branch is on the remote; opening the PR is one click. Offer it rather
      // than opening a browser unasked.
      if (result.compareUrl) {
        const url = result.compareUrl;
        void vscode.window
          .showInformationMessage(
            `Approval pushed on '${result.branch}' (this branch is protected, so it needs a PR).`,
            'Open PR',
          )
          .then((c) => {
            if (c === 'Open PR') void vscode.env.openExternal(vscode.Uri.parse(url));
          });
      }
      return { suffix: ` · pushed on ${result.branch} (open a PR)`, result };
    }
    case 'failed':
      console.warn(`MinSpec: push-on-approve failed — ${result.error ?? 'git error'}`);
      return { suffix: ' · push failed — still local only (see console)', result };
    default:
      // 'skipped' | 'not-a-repo' — nothing was pushable; the commit path already
      // reported the relevant condition.
      return { suffix: '', result };
  }
}

/**
 * Give `filePath` its OWN commit right now, if (and only if) it has no
 * committed version at HEAD — used before an ADR acceptance (issue #577).
 *
 * `applyStatus` (commands/adr.ts) flips a DR's frontmatter to a terminal
 * status (e.g. `accepted`) BEFORE the accept commit runs. If the DR was
 * created but never committed, that accept commit would stage it as a
 * brand-new ADDED file already claiming the terminal status — exactly what
 * the DR-029 born-proposed pre-commit gate (`.githooks/pre-commit`) exists to
 * reject (a DR must be born `proposed`/`draft`; acceptance is a separate,
 * later act). Committing the file's CURRENT (pre-flip) content here first
 * turns the later accept commit into a legitimate Modify instead of the
 * file's first-ever commit.
 *
 * The git hook is the actual arbiter, not this function: if the pre-flip
 * content isn't a validly-born DR, the hook rejects this commit too and the
 * caller's own commit attempt fails exactly as it would without this helper —
 * no gate logic is duplicated here.
 *
 * No-op (returns undefined, no git call) when the setting is off or the file
 * already has a HEAD version.
 */
export async function commitBornIfUntracked(
  rootDir: string,
  filePath: string,
  message: string,
): Promise<CommitApprovalResult | undefined> {
  if (!commitOnApproveEnabled()) return undefined;
  if (!(await isUntrackedAtHead(rootDir, filePath))) return undefined;
  const result = await commitApproval(rootDir, [filePath], message);
  if (result.outcome === 'failed') {
    console.warn(`MinSpec: born commit failed — ${result.error ?? 'git error'}`);
  }
  return result;
}
