import * as vscode from 'vscode';
import { listSpecs, type SpecSummary } from '../views/spec-tree-provider';
import { readSpecFile } from '../lib/spec';
import { loadConfig } from '../lib/config';
import { validateSpec } from '../lib/spec-validator';
import { epicRefSet } from '../lib/epic-manager';
import { getApprovalStatus } from '../lib/approval';
import type { ExplicitTerminal } from '../lib/lifecycle';
import { folderForFile, resolveTargetFolder } from '../lib/resolve-folder';

interface SpecNodeLike {
  readonly spec?: SpecSummary;
}

/**
 * Command: Check a spec's completeness and report violations.
 * Read-only — does not change approval state.
 */
export async function validateSpecCommand(node?: SpecNodeLike): Promise<void> {
  // Multi-root safe: a tree-node click carries the spec's file path, so pin the
  // root to the folder actually containing it; otherwise prompt the user
  // (harvest316/minspec#373). Previously used `workspaceFolders?.[0]`,
  // silently validating folder [0]'s specs regardless of which project was
  // right-clicked.
  const rootDir = node?.spec?.filePath
    ? folderForFile(node.spec.filePath) ?? (await resolveTargetFolder())
    : await resolveTargetFolder();
  if (!rootDir) return;

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
    const parsed = readSpecFile(spec.filePath);
    // SPEC-022 (INV-4): feed the validator the approval verdict + explicit
    // terminal so it can assert the literal `status:` mirror == derived status and
    // warn on drift. `archived` is the explicit-terminal human act read from the
    // literal status; everything else is derived from {phases, approval}.
    const approvalState = getApprovalStatus(rootDir, spec.filePath);
    const explicitTerminal: ExplicitTerminal =
      parsed.frontmatter.status === 'archived' ? 'archived' : undefined;
    result = validateSpec(
      parsed,
      loadConfig(rootDir),
      epicRefSet(rootDir),
      approvalState,
      explicitTerminal,
    );
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
