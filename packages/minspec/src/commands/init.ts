import * as vscode from 'vscode';
import { scaffold, generateHarnessFiles, refreshHarnessFiles } from '../lib/scaffold';
import { resolveTargetFolder } from '../lib/resolve-folder';

export async function initCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;
  scaffold(folder);
  generateHarnessFiles(folder);
  vscode.window.showInformationMessage(
    'MinSpec: Initialized .minspec/ and generated harness files.',
  );
}

export async function initRefreshCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;
  refreshHarnessFiles(folder);
  vscode.window.showInformationMessage(
    'MinSpec: Refreshed harness files (user edits preserved).',
  );
}
