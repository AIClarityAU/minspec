import * as vscode from 'vscode';
import { loadSession } from '../lib/session';
import {
  createParkingLotEntry,
  parkTopic,
  commentOnIssue,
  getRepoFromRemote,
  type ParkingLotEntry,
  type ParkResult,
} from '../lib/parking-lot';

/** Options for {@link parkCommand}. */
export interface ParkCommandOptions {
  /**
   * Bypass the dedup gate and create a new issue/entry even when a matching one
   * already exists (issue #136). Wired to the `MinSpec: Park Topic (force)`
   * command. When false (default), a dedup hit prompts the user to choose
   * between opening / commenting on / force-creating.
   */
  readonly force?: boolean;
}

/** The choice offered on a dedup hit. */
type DedupAction = 'open' | 'comment' | 'force';

/**
 * Park a topic — creates a GitHub issue or appends to local parking-lot.md.
 * Auto-fills session scope from active session if available.
 *
 * On a dedup hit (a matching open issue already exists) the user is offered a
 * quick-pick: open the existing issue, add a comment to it, or force-create a
 * new one anyway (issue #136). Pass `{ force: true }` to skip the dedup gate
 * entirely — the `MinSpec: Park Topic (force)` command does this.
 */
export async function parkCommand(opts: ParkCommandOptions = {}): Promise<void> {
  const force = opts.force === true;

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  // Step 1: Title
  const title = await vscode.window.showInputBox({
    prompt: 'Title for the parked topic',
    placeHolder: 'e.g., Consider caching strategy for spec lookups',
    ignoreFocusOut: true,
  });
  if (!title) return; // Cancelled

  // Step 2: Body/context
  const body = await vscode.window.showInputBox({
    prompt: 'Additional context (optional)',
    placeHolder: 'Why this came up, relevant details...',
    ignoreFocusOut: true,
  });
  // body can be empty, that's fine

  // Step 3: Labels
  const labelInput = await vscode.window.showInputBox({
    prompt: 'Labels (comma-separated, defaults to "idea,inbox")',
    placeHolder: 'idea,inbox',
    value: 'idea,inbox',
    ignoreFocusOut: true,
  });
  const labels = labelInput
    ? labelInput.split(',').map(l => l.trim()).filter(l => l.length > 0)
    : ['idea', 'inbox'];

  // Auto-fill session scope
  const session = loadSession(folder);
  const sessionScope = session
    ? `${session.scope} (${session.project}, ${session.type})`
    : 'No active session';

  const entry = createParkingLotEntry(title, body || '', sessionScope, labels);

  // Show progress while attempting GitHub issue creation
  const result = await park(folder, entry, force);

  if (result.deduped) {
    // A matching open issue / parking-lot entry already existed (issue #24).
    // Rather than silently reusing, let the user choose what to do (issue #136).
    await handleDedupHit(folder, entry, result);
    return;
  }

  notifyCreated(result);
}

/** Run parkTopic inside the standard progress notification. */
function park(
  folder: string,
  entry: ParkingLotEntry,
  force: boolean,
): Thenable<ParkResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: force ? 'MinSpec: Force-parking topic...' : 'MinSpec: Parking topic...',
      cancellable: false,
    },
    async () => parkTopic(folder, entry, { force }),
  );
}

/**
 * A matching topic already exists. Offer the user a choice (issue #136):
 *   - open existing  → open the issue in the browser
 *   - comment        → append the new context as a comment on the existing issue
 *   - force          → create a new issue anyway (re-park with force)
 * Cancelling the quick-pick leaves the existing issue untouched.
 */
async function handleDedupHit(
  folder: string,
  entry: ParkingLotEntry,
  result: ParkResult,
): Promise<void> {
  const target = result.method === 'github' ? result.url : result.filePath;

  interface ActionPick extends vscode.QuickPickItem {
    action: DedupAction;
  }

  const picks: ActionPick[] = [
    {
      label: '$(link-external) Open existing',
      description: target,
      action: 'open',
    },
    {
      label: '$(comment) Comment on existing',
      description: 'Append this context to the existing issue',
      action: 'comment',
    },
    {
      label: '$(add) Create new anyway (force)',
      description: 'Bypass dedup and file a separate issue',
      action: 'force',
    },
  ];

  const choice = await vscode.window.showQuickPick(picks, {
    title: 'MinSpec: This topic is already parked',
    placeHolder: `Already parked — ${target}`,
    ignoreFocusOut: true,
  });
  if (!choice) return; // Cancelled — leave the existing issue as-is.

  switch (choice.action) {
    case 'open':
      if (result.method === 'github' && result.url) {
        await vscode.env.openExternal(vscode.Uri.parse(result.url));
      } else if (result.filePath) {
        const doc = await vscode.workspace.openTextDocument(result.filePath);
        await vscode.window.showTextDocument(doc);
      }
      return;

    case 'comment':
      await commentOnExisting(folder, entry, result);
      return;

    case 'force': {
      const forced = await park(folder, entry, true);
      notifyCreated(forced);
      return;
    }
  }
}

/** Add the entry's context as a comment on the existing GitHub issue. */
async function commentOnExisting(
  folder: string,
  entry: ParkingLotEntry,
  result: ParkResult,
): Promise<void> {
  if (result.method !== 'github' || !result.url) {
    // File-fallback dedup has no issue to comment on — open the file instead.
    if (result.filePath) {
      const doc = await vscode.workspace.openTextDocument(result.filePath);
      await vscode.window.showTextDocument(doc);
    }
    return;
  }

  const repo = await getRepoFromRemote(folder);
  if (!repo) {
    vscode.window.showErrorMessage(
      'MinSpec: Could not determine the GitHub repo to comment on.',
    );
    return;
  }

  const commentBody = [
    '_Re-parked via MinSpec — same topic surfaced again._',
    '',
    `**Session scope:** ${entry.sessionScope}`,
    '',
    entry.body || '(no additional context)',
  ].join('\n');

  const ok = await commentOnIssue(result.url, commentBody, repo);
  if (ok) {
    vscode.window.showInformationMessage(
      `MinSpec: Commented on existing issue — ${result.url}`,
    );
  } else {
    vscode.window.showErrorMessage(
      `MinSpec: Failed to comment on ${result.url}.`,
    );
  }
}

/** Notify the user that a fresh issue / file entry was created. */
function notifyCreated(result: ParkResult): void {
  if (result.method === 'github') {
    vscode.window.showInformationMessage(
      `MinSpec: Created GitHub issue — ${result.url}`,
    );
  } else {
    vscode.window.showInformationMessage(
      `MinSpec: Saved to ${result.filePath}`,
    );
  }
}
