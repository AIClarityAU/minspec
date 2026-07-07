import * as vscode from 'vscode';
import { commitApproval, isUntrackedAtHead, type CommitApprovalResult } from '../lib/approve-commit';

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
export async function commitApprovalIfEnabled(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
): Promise<{ suffix: string; result?: CommitApprovalResult }> {
  if (!commitOnApproveEnabled()) return { suffix: '' };
  const result = await commitApproval(rootDir, absPaths, message);
  switch (result.outcome) {
    case 'committed':
      return { suffix: ' · committed', result };
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
