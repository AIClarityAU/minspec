import * as vscode from 'vscode';
import { listSpecs, type SpecSummary } from '../views/spec-tree-provider';
import { readSpecFile } from '../lib/spec';
import { loadConfig } from '../lib/config';
import { validateSpec } from '../lib/spec-validator';
import { epicRefSet } from '../lib/epic-manager';

interface SpecNodeLike {
  readonly spec?: SpecSummary;
}

/**
 * Command: Check a spec's completeness and report violations.
 * Read-only — does not change approval state.
 */
export async function validateSpecCommand(node?: SpecNodeLike): Promise<void> {
  const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rootDir) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  let spec = node?.spec;
  if (!spec) {
    const specs = listSpecs(rootDir);
    if (specs.length === 0) {
      vscode.window.showInformationMessage('MinSpec: No specs found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      specs.map((s) => ({ label: `${s.id}: ${s.title}`, description: s.tier, spec: s })),
      { placeHolder: 'Select a spec to check', ignoreFocusOut: true },
    );
    if (!picked) return;
    spec = picked.spec;
  }

  let result;
  try {
    result = validateSpec(readSpecFile(spec.filePath), loadConfig(rootDir), epicRefSet(rootDir));
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Cannot read ${spec.id} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (result.violations.length === 0) {
    vscode.window.showInformationMessage(
      `MinSpec: ✓ ${spec.id} is complete${result.effectiveAspects.length ? ` (aspects: ${result.effectiveAspects.join(', ')})` : ''}.`,
    );
    return;
  }

  const errors = result.violations.filter((v) => v.severity === 'error');
  const warnings = result.violations.filter((v) => v.severity === 'warning');
  const lines = result.violations.map(
    (v) => `${v.severity === 'error' ? '✗' : '⚠'} ${v.message}\n   ↳ ${v.fixHint}`,
  );

  const header = result.complete
    ? `${spec.id}: complete, ${warnings.length} warning(s)`
    : `${spec.id}: incomplete — ${errors.length} blocker(s), ${warnings.length} warning(s)`;

  await vscode.window.showInformationMessage(header, { modal: true, detail: lines.join('\n\n') });
}
