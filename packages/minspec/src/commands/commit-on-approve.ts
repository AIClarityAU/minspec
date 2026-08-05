import * as vscode from 'vscode';
import { commitApproval, isUntrackedAtHead, type CommitApprovalResult } from '../lib/approve-commit';
import { pushApproval, type PushApprovalResult } from '../lib/approve-push';
import { recoverProtectedBranchApproval, type RecoverResult } from '../lib/approval-recover';

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
 *   ' · commit failed — approval saved …'     — git/hook rejected; approval on disk, uncommitted, unstaged
 *
 * Never rejects (delegates to `commitApproval`, which never rejects). A failed or
 * refused commit is surfaced (never-wrong: the user must know the approval is
 * uncommitted), with the full git/hook stderr logged for diagnosis.
 */
/** Offer labels — worded to match #1054's harness-commit offer, so the two
 *  destination guards read as one behaviour rather than two dialects. */
const SHOW_FILES_ACTION = 'Show me the files';
/** #1115 — the consent click that authorizes recovery's network step. */
const RECOVER_ACTION = 'Save it on a branch';
const OPEN_PR_ACTION = 'Open PR';

/**
 * #1115 — try to rescue an approval the destination guard refused, by committing it
 * on a side branch and pushing. Returns the toast suffix on success, or `undefined`
 * to mean "fall back to the honest warning" (consent withheld, or recovery failed).
 *
 * CONSENT (constitution invariant #1). Recovery pushes, so it is gated on the SAME
 * `minspec.pushOnApprove` setting that governs every other approval push — not a new
 * one. `never` ⇒ no network, ever, and no prompt. `prompt` ⇒ one click, which is the
 * consent. `always` ⇒ the user set it deliberately; the setting is the consent.
 * Reusing the existing tri-state matters: a second consent surface for the same
 * network act is how a user ends up believing they have opted out when they have not.
 *
 * Never throws — `recoverProtectedBranchApproval` is typed-result-only, and anything
 * unexpected degrades to `undefined` (the pre-#1115 behaviour).
 */
async function recoverOnProtectedBranch(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
  current: string,
  baseBranch: string | undefined,
): Promise<{ suffix: string } | undefined> {
  const mode = pushOnApproveMode();
  if (mode === 'never') return undefined;
  if (mode === 'prompt') {
    // Non-modal (project preference: never steal focus from the artifact being
    // approved). Names the destination, so the click is informed consent.
    const choice = await vscode.window.showWarningMessage(
      `Approval written but NOT committed: '${current}' is the default branch. ` +
        `Save it on a branch and push, so the sign-off is not stranded here?`,
      RECOVER_ACTION,
      'Not now',
    );
    if (choice !== RECOVER_ACTION) return undefined;
  }

  const slug = (absPaths[0] ?? message).split(/[\\/]/).slice(-2).join('-').replace(/\.[a-z]+$/i, '');
  let res: RecoverResult;
  try {
    // baseBranch MUST be the branch the guard actually refused, not a hardcoded
    // 'main'. The destination guard fires on whatever `origin/HEAD` resolves to —
    // and its fallback list is `main master trunk` — so on a `master`- or
    // `trunk`-default repo, defaulting to `main` would `fetch origin main`, fail,
    // and silently degrade to the honest warning. Recovery would be inert for a
    // whole class of repos while appearing to be built. Caught in review on #1255.
    res = await recoverProtectedBranchApproval(rootDir, absPaths, message, { slug, baseBranch });
  } catch (err) {
    // Defensive: the seam documents never-throws, but relying on that transitively
    // would let a future change there break an approval toast that has nothing to
    // do with recovery (the same reasoning as pushApprovalIfEnabled's guard).
    console.warn(`MinSpec: approval recovery threw — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  if (res.outcome !== 'recovered') {
    // Every non-success falls back to the honest warning, with the reason logged.
    // NOT surfaced as a success suffix: the files really are still only local.
    console.warn(`MinSpec: approval recovery ${res.outcome} — ${res.error ?? 'no detail'}`);
    return undefined;
  }

  // Success. Non-blocking: the operation is COMPLETE, so the notification carries a
  // convenience action, never one required to finish the job.
  if (res.compareUrl) {
    const url = res.compareUrl;
    void vscode.window
      .showInformationMessage(`Approval saved on '${res.branch}' and pushed.`, OPEN_PR_ACTION)
      .then((c) => {
        if (c === OPEN_PR_ACTION) void vscode.env.openExternal(vscode.Uri.parse(url));
      });
  }
  return { suffix: ` · committed on ${res.branch} and pushed` };
}

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
      // #1064: the default branch is push-protected, so a commit there could never
      // be pushed and #1041's hook refuses it. NOTHING was staged. The defect this
      // closes is the SILENCE — the maintainer saw the doc read `accepted` and
      // reasonably believed it had landed. So say plainly what happened, what
      // state the files are in, and what to do; never a bare console.warn.
      //
      // #1115 — RECOVERY IS NOW ATTEMPTED, in a throwaway worktree off origin/main.
      // The comment that stood here said auto-recovery belonged in SPEC-050. That
      // was wrong in an instructive way: SPEC-050 fires on `pushed-branch`, which
      // is produced by `pushApproval` — and `pushApproval` only ever runs from the
      // `committed` arm above. On a repo where `main` IS the default branch, this
      // arm returns first, so SPEC-050's payload was unreachable for exactly the
      // case it was supposed to cover. Measured 2026-08-05: six ratifications
      // stranded in one sitting while SPEC-050 was "the fix".
      //
      // Recovery still never moves the shared checkout's HEAD (rule #8 / DR-051
      // §4a) — approval-recover.ts copies into a separate worktree with a separate
      // index, and this arm still stages nothing in the primary.
      const current = result.branch?.current ?? 'the default branch';
      const recovery = await recoverOnProtectedBranch(
        rootDir,
        absPaths,
        message,
        current,
        result.branch?.current,
      );
      if (recovery) return { ...recovery, result };

      // Fallback — unchanged: consent withheld, or recovery failed. Say plainly what
      // happened and what state the files are in; never a bare console.warn.
      void vscode.window.showWarningMessage(
        `Approval written but NOT committed: '${current}' is the default branch, ` +
          `so a commit there could not be pushed. Your files are saved in the working ` +
          `tree — commit them on a branch to keep them.`,
        SHOW_FILES_ACTION,
      ).then((choice) => {
        if (choice === SHOW_FILES_ACTION) void vscode.commands.executeCommand('workbench.view.scm');
      });
      return {
        suffix: ` · NOT committed (on ${current} — files left in your working tree)`,
        result,
      };
    }
    case 'detached-head':
      // A commit here would be orphaned by the next checkout — refuse and say so.
      return { suffix: ' · not committed (detached HEAD — switch to a branch)', result };
    case 'failed':
      // Log the detail (incl. hook stderr); keep the toast short. The approval
      // record is already on disk — only the git commit failed.
      //
      // Says "in your working tree", NOT "files staged": `commitApproval`
      // unstages these exact paths on failure (invariant 3), so the files are
      // deliberately NOT left in the index. The old wording described the
      // behaviour before that invariant existed and had become false.
      console.warn(`MinSpec: commit-on-approve failed — ${result.error ?? 'git error'}`);
      return { suffix: ' · commit failed — approval saved in your working tree (see console)', result };
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

/**
 * Branches the REMOTE will reject a direct push to — used only by the push step.
 *
 * ⚠️ This is NOT the list the commit-destination guard uses. `minspec.protectedBranches`
 * currently names TWO separate settings: this VS Code array (default
 * `['main','master']`), and a git config string (default `main master trunk`) read
 * by the #1041 pre-commit hook and by {@link resolveBranchDestination}. A shell hook
 * cannot read VS Code settings, which is how the split arose. Setting one does not
 * set the other, and their defaults disagree over `trunk`.
 *
 * Do not "unify" these by pointing one at the other in passing — that changes a
 * published setting's meaning and needs its own decision. Tracked at #1111.
 */
function protectedBranches(): string[] {
  return vscode.workspace
    .getConfiguration('minspec')
    .get<string[]>('protectedBranches', ['main', 'master', 'trunk']);
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
