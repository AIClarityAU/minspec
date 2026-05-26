import * as vscode from 'vscode';
import { scaffold } from '../lib/scaffold';

export async function initCommand(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }
  scaffold(folder);
  vscode.window.showInformationMessage('MinSpec: Initialized .minspec/ in workspace.');
}
