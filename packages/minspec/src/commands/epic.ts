import * as vscode from 'vscode';
import { createEpic, writeEpicIndex, setEpicStatus } from '../lib/epic-manager';
import type { EpicSummary } from '../lib/epic-manager';
import { resolveTargetFolder, folderForFile } from '../lib/resolve-folder';

/** Tree node carrying the epic this group represents (from EpicGroupNode). */
interface EpicNodeLike {
  readonly epic?: EpicSummary;
}

/**
 * Command: Accept a proposed epic (inline ✓ on hover). Flips status
 * proposed → active in one click, mirroring Accept Decision for ADRs.
 */
export async function acceptEpicCommand(node?: EpicNodeLike): Promise<void> {
  const epic = node?.epic;
  if (!epic?.filePath) {
    vscode.window.showErrorMessage('MinSpec: No epic selected.');
    return;
  }
  if (epic.status === 'active') {
    vscode.window.showInformationMessage(`MinSpec: ${epic.id} already active.`);
    return;
  }
  try {
    setEpicStatus(epic.filePath, 'active');
    const folder = folderForFile(epic.filePath);
    if (folder) {
      try { writeEpicIndex(folder); } catch { /* index regen best-effort */ }
    }
    vscode.window.showInformationMessage(`MinSpec: ${epic.id} → active`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MinSpec: Failed to accept epic — ${message}`);
  }
}

/**
 * Command: Create a new Epic.
 * Prompts for a title (and optional slug), writes docs/epics/EPIC-NNN.md with
 * sequential numbering, regenerates the epic INDEX, and opens the file.
 * Mirrors the Create ADR flow (DR-013 / SPEC-007 FR-2).
 */
export async function createEpicCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;

  const title = await vscode.window.showInputBox({
    prompt: 'Title for the Epic',
    placeHolder: 'e.g., Telemetry & RUM',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) return 'Title is required';
      if (value.trim().length > 120) return 'Title must be 120 characters or fewer';
      return null;
    },
  });
  if (!title) return; // Cancelled

  // Optional slug override; blank → derived from the title by createEpic.
  const slug = await vscode.window.showInputBox({
    prompt: 'Epic slug (used for the GitHub `epic:<slug>` label) — leave blank to derive from the title',
    placeHolder: 'e.g., telemetry',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (value && !/^[a-z0-9][a-z0-9-]*$/.test(value.trim())) {
        return 'Slug must be lowercase alphanumeric with hyphens (e.g. auth-revamp)';
      }
      return null;
    },
  });
  // `slug` may be undefined (escape) — treat the same as blank.

  try {
    const epic = createEpic(folder, title.trim(), slug?.trim() || undefined);
    try {
      writeEpicIndex(folder);
    } catch {
      // Index regen is best-effort; the epic file was already written.
    }

    const doc = await vscode.workspace.openTextDocument(epic.filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`MinSpec: Created ${epic.id} — ${epic.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MinSpec: Failed to create epic — ${message}`);
  }
}

/**
 * Command: Regenerate the epic INDEX.md (preserving user content outside the
 * minspec:epic-index markers).
 */
export async function regenerateEpicIndexCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;
  try {
    const result = writeEpicIndex(folder);
    const doc = await vscode.workspace.openTextDocument(result.filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
      `MinSpec: Regenerated epic INDEX (${result.count} epic${result.count === 1 ? '' : 's'}).`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MinSpec: Failed to regenerate epic INDEX — ${message}`);
  }
}
