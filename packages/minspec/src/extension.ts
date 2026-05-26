import * as vscode from 'vscode';
import { initCommand } from './commands/init';
import { classifyCommand } from './commands/classify';
import { statusCommand } from './commands/status';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('minspec.init', initCommand),
    vscode.commands.registerCommand('minspec.classify', classifyCommand),
    vscode.commands.registerCommand('minspec.status', statusCommand),
  );
}

export function deactivate(): void {}
