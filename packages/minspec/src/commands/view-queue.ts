import * as path from 'path';
import * as vscode from 'vscode';
import { listQueuedRequests } from '../lib/phase-advance-queue';

/**
 * `minspec.viewQueue` (#737) — list the pending phase-advance requests and
 * open the spec a chosen one is about. Read-only and offline: it only reads
 * `.minspec/queue/`; draining stays with the downstream consumer (DR-057), and
 * MinSpec itself never runs an LLM.
 */
export async function viewQueueCommand(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('MinSpec: no workspace folder.');
    return;
  }
  const requests = listQueuedRequests(workspaceRoot);
  if (requests.length === 0) {
    vscode.window.showInformationMessage('MinSpec: no phase-advance requests are queued.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    requests.map((r) => ({
      label: r.specPath,
      description: r.requestedAt ? `requested ${r.requestedAt}` : 'requested (time unknown)',
    })),
    {
      title: `MinSpec: ${requests.length} queued phase-advance request${requests.length === 1 ? '' : 's'}`,
      placeHolder: 'Waiting for a consumer (drain loop / agent-execute). Pick one to open its spec.',
    },
  );
  if (!picked) return;
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(workspaceRoot, ...picked.label.split('/'))),
  );
  await vscode.window.showTextDocument(doc);
}
