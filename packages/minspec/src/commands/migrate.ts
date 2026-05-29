import * as vscode from 'vscode';
import { migrateLayout } from '../lib/spec-manager';
import type { SpecsLayout } from '../lib/config';

/**
 * Interactive layout migration command.
 *
 * Prompts the user to pick a target layout (flat vs. spec-kit), runs the
 * migration, then writes the new value into VS Code workspace settings so
 * the choice persists across sessions.
 */
export async function migrateLayoutCommand(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: 'flat',
        description: 'specs/SPEC-NNN-slug.md (one file per spec)',
      },
      {
        label: 'spec-kit',
        description: 'specs/NNN-slug/{spec,plan,tasks}.md — strict Spec Kit compat',
      },
    ],
    { placeHolder: 'Choose target spec storage layout' },
  );
  if (!pick) return;

  const target = pick.label as SpecsLayout;
  const result = migrateLayout(workspaceRoot, target);

  if (!result.success) {
    vscode.window.showErrorMessage(
      `MinSpec: Migration failed${result.warning ? ` — ${result.warning}` : ''}`,
    );
    return;
  }

  await vscode.workspace
    .getConfiguration('minspec')
    .update('specsLayout', target, vscode.ConfigurationTarget.Workspace);

  vscode.window.showInformationMessage(
    `MinSpec: Migrated ${result.migrated} spec${result.migrated === 1 ? '' : 's'} to ${target} layout.`,
  );
}
