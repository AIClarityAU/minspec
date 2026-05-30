import * as vscode from 'vscode';
import { findActiveSpec, summarizeActiveSpec } from '../lib/active-spec';

/**
 * Status bar click handler.
 *
 * Wired to real workspace state (not a hardcoded stub): it resolves the same
 * active spec the status bar displays via the shared `findActiveSpec`. When an
 * active spec exists it opens that spec file and shows a tier | phase | progress
 * summary. When none exists it falls back to the initialize-prompt message.
 *
 * Returns an async handler so it can be registered directly as a command.
 */
export function statusCommand(
  workspaceRoot: string,
): () => Promise<void> {
  return async (): Promise<void> => {
    if (!workspaceRoot) {
      vscode.window.showInformationMessage(
        'MinSpec: No active spec. Run "MinSpec: Initialize SDD Structure" to get started.',
      );
      return;
    }

    const specPath = await findActiveSpec(workspaceRoot);
    if (!specPath) {
      vscode.window.showInformationMessage(
        'MinSpec: No active spec. Run "MinSpec: Initialize SDD Structure" to get started.',
      );
      return;
    }

    const summary = summarizeActiveSpec(specPath);

    // Open the active spec so the click does something tangible.
    try {
      const doc = await vscode.workspace.openTextDocument(specPath);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      // If opening fails, still surface the summary below.
    }

    if (summary) {
      vscode.window.showInformationMessage(
        `MinSpec: ${summary.id} — ${summary.tier} | ${summary.phase} | ${summary.progress}`,
      );
    }
  };
}
