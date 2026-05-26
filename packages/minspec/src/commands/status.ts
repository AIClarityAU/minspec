import * as vscode from 'vscode';

export function statusCommand(): void {
  vscode.window.showInformationMessage(
    'MinSpec: No active spec. Run "MinSpec: Initialize SDD Structure" to get started.',
  );
}
