import * as vscode from 'vscode';
import {
  classifyPrimary,
  tidyRedundantPaths,
  otherLiveSessionsHere,
  type PrimaryClassification,
} from '../lib/tidy-primary';

/**
 * `minspec.tidyPrimary` — the one-keystroke half of #1162. Classification
 * (read-only, no network) lives in `lib/tidy-primary.ts`; this command is the
 * confirm-then-mutate surface: it never discards anything without the paths
 * listed and a human confirming, and it refuses while `otherLiveSessionsHere`
 * reports another live session sharing this exact checkout (a peer mid-edit
 * could be relying on state this pass would discard, even though the
 * classification itself is correct at this instant).
 *
 * CAVEAT (#1714): that peer check currently fails OPEN — a corrupt or
 * unreadable session record, or a missing `.minspec/sessions` dir, reads as
 * "nobody else here" rather than "can't tell", unlike DR-065 §1's
 * `isCheckoutOccupied`. Filed, not yet fixed; do not read "refuses" above as
 * airtight until it is.
 */
export async function tidyPrimaryCommand(
  workspaceRoot: string,
  sessionId?: string,
): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('MinSpec: no workspace folder to tidy.');
    return;
  }

  const before = classifyPrimary(workspaceRoot);
  if (!before) {
    vscode.window.showWarningMessage('MinSpec: not a git checkout — nothing to tidy.');
    return;
  }
  if (before.note === 'off-default-branch') {
    vscode.window.showInformationMessage(
      `MinSpec: primary is on '${before.branch}', not ${before.defaultBranch} — tidy only classifies the default branch.`,
    );
    return;
  }
  if (before.note === 'missing-origin-ref') {
    vscode.window.showInformationMessage(
      `MinSpec: no origin/${before.defaultBranch} ref locally — run a fetch first (MinSpec never fetches on its own).`,
    );
    return;
  }
  if (before.redundant.length === 0) {
    vscode.window.showInformationMessage(
      before.orphans.length > 0
        ? `MinSpec: primary is clean of redundant paths (${before.orphans.length} unlanded path(s) remain — land those from their owning worktree).`
        : 'MinSpec: primary is clean — nothing to tidy.',
    );
    return;
  }

  const peers = otherLiveSessionsHere(workspaceRoot, workspaceRoot, sessionId);
  if (peers === null) {
    // #1714: couldn't positively confirm zero peers (missing/unreadable
    // sessions dir, or a corrupt record) — fail closed rather than risk a
    // silent discard on a checkout another session might be using.
    vscode.window.showWarningMessage(
      "MinSpec: couldn't confirm nobody else is working in this checkout (a session record is missing or unreadable) — tidy refuses rather than risk it. Try again once it's readable.",
    );
    return;
  }
  if (peers.length > 0) {
    vscode.window.showWarningMessage(
      `MinSpec: ${peers.length} other live session${peers.length === 1 ? ' is' : 's are'} working in this checkout right now — tidy refuses while it's shared. Try again once they've parked.`,
    );
    return;
  }

  const list = before.redundant.map((c) => `  ${c.path}`).join('\n');
  const choice = await vscode.window.showWarningMessage(
    `MinSpec: discard ${before.redundant.length} redundant path(s)? Their content is already provably on origin/${before.defaultBranch} — nothing is lost; a later sync outside this extension can bring those exact bytes back.\n\n${list}`,
    { modal: true },
    'Tidy',
  );
  if (choice !== 'Tidy') return; // cancelled — leave everything untouched

  const result = tidyRedundantPaths(
    workspaceRoot,
    before.redundant.map((c) => c.path),
  );

  reportResult(result, before);
}

function reportResult(
  result: { removed: string[]; skipped: { path: string; reason: string }[] },
  before: PrimaryClassification,
): void {
  const orphanNote =
    before.orphans.length > 0
      ? ` ${before.orphans.length} unlanded path(s) remain — land those from their owning worktree.`
      : '';
  if (result.skipped.length === 0) {
    vscode.window.showInformationMessage(
      `MinSpec: tidied ${result.removed.length} redundant path(s).${orphanNote}`,
    );
    return;
  }
  const reasons = result.skipped.map((s) => `  ${s.path}: ${s.reason}`).join('\n');
  vscode.window.showWarningMessage(
    `MinSpec: tidied ${result.removed.length} path(s); ${result.skipped.length} skipped:\n${reasons}${orphanNote}`,
  );
}
