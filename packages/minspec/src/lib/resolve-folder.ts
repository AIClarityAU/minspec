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

/**
 * Non-interactive target-folder resolution for ACTIVATION-time code (the file
 * watchers and the module-level `workspaceRoot` in `extension.ts`, the
 * conformance watcher in `bridge.ts`). These run when no user is present, so
 * they MUST NOT pop a quick-pick — `resolveTargetFolder()` is the wrong tool
 * here. Resolution order:
 *   1. the workspace folder containing the active editor's file (multi-root
 *      safe via longest-prefix match), else
 *   2. the first workspace folder, else
 *   3. '' (no folder open — callers already treat '' as "skip"/inert).
 *
 * Replaces the bare `workspaceFolders?.[0]` activation sites that silently
 * targeted the first folder regardless of the active editor
 * (harvest316/minspec#123).
 */
export function resolveTargetFolderNonInteractive(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const activeFsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  return (
    pickFolderPath(
      folders.map(f => f.uri.fsPath),
      activeFsPath,
    ) ??
    folders[0]?.uri.fsPath ??
    ''
  );
}

/**
 * Resolve the workspace folder that CONTAINS a specific file. For contextual
 * operations acting on a known file (status changes, index regens) the target
 * is the file's own folder — never an interactive pick. Falls back to the first
 * workspace folder when the file is outside every folder.
 */
export function folderForFile(filePath: string): string | undefined {
  return (
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  );
}
