import * as vscode from 'vscode';
import { pickFolderPath } from './workspace';

/**
 * Resolve the workspace folder a write-command should target. Multi-root safe:
 * prefers the active editor's folder, else prompts the user to pick one.
 *
 * Surfaces the "no folder open" error itself. Returns undefined on no-folder OR
 * on a cancelled pick — callers should `if (!folder) return;` with no extra
 * message. Replaces `workspaceFolders?.[0]`, which silently targeted the first
 * folder in a multi-root workspace (harvest316/minspec#123).
 */
export async function resolveTargetFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return undefined;
  }
  const activeFsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  const resolved = pickFolderPath(
    folders.map(f => f.uri.fsPath),
    activeFsPath,
  );
  if (resolved) return resolved;

  // Multiple folders and no active-file match → ask which project.
  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: 'MinSpec: select the project for this command',
  });
  return picked?.uri.fsPath;
}
