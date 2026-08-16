import * as vscode from 'vscode';
import { findActiveSpec, summarizeActiveSpec } from '../lib/active-spec';
import { buildLabel } from '../lib/build-provenance';

/**
 * Status bar click handler.
 *
 * Wired to real workspace state (not a hardcoded stub): it resolves the same
 * active spec the status bar displays via the shared `findActiveSpec`. When an
 * active spec exists it opens that spec file and shows a tier | phase | progress
 * summary. When none exists it falls back to the initialize-prompt message.
 *
 * EVERY path also reports the running build (#1549). It is appended rather than
 * given its own command because the question it answers — *which build am I on?* —
 * is only ever asked while something else looks wrong, and a separate command is one
 * nobody thinks to run at that moment. Including it on the no-spec paths is the point:
 * a freshly-initialized project has no active spec, and that is exactly when an
 * adopter is most likely to be running a build that predates the fix they are looking
 * for.
 *
 * Returns an async handler so it can be registered directly as a command.
 */
export function statusCommand(
  workspaceRoot: string,
): () => Promise<void> {
  return async (): Promise<void> => {
    const build = buildLabel();

    if (!workspaceRoot) {
      vscode.window.showInformationMessage(
        `MinSpec: No active spec. Run "MinSpec: Initialize SDD Structure" to get started. (${build})`,
      );
      return;
    }

    const specPath = await findActiveSpec(workspaceRoot);
    if (!specPath) {
      vscode.window.showInformationMessage(
        `MinSpec: No active spec. Run "MinSpec: Initialize SDD Structure" to get started. (${build})`,
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
        `MinSpec: ${summary.id} — ${summary.tier} | ${summary.phase} | ${summary.progress} (${build})`,
      );
    } else {
      // No parseable summary is still a status answer, and it must not swallow the
      // build identity — that would restore the blind spot on the one path where a
      // malformed spec is the thing being diagnosed.
      vscode.window.showInformationMessage(`MinSpec: active spec found. (${build})`);
    }
  };
}
