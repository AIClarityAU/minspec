import * as vscode from 'vscode';
import * as path from 'path';
import { createEpic, writeEpicIndex, setEpicStatus } from '../lib/epic-manager';
import type { EpicSummary } from '../lib/epic-manager';
import { resolveTargetFolder, folderForFile } from '../lib/resolve-folder';
import { commitApprovalIfEnabled } from './commit-on-approve';
import { declaredTier } from './adr';
import {
  assertHumanApprover,
  canonicalSpecHash,
  gitConfigEmail,
  specRelPath,
} from '../lib/approval';
import type { Tier } from '../lib/config';
import { sidecarPath, writeRecord } from '../lib/approval-store';

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
    const folder = folderForFile(epic.filePath);
    // Accepting an epic is a human act: gate on the approver identity BEFORE any
    // write, exactly as Accept Decision does (#2993).
    let approver: string | undefined;
    if (folder) {
      approver = gitConfigEmail(folder);
      assertHumanApprover(approver);
    }
    setEpicStatus(epic.filePath, 'active');
    // Hash-locked sidecar (`.minspec/approvals/<epic path>.json`), hashed AFTER the
    // flip so it covers the committed bytes. Records the acceptance as a
    // human-attributed, hash-locked artifact, like Accept Decision (#2993).
    // Epics declare no `tier:`, but the store's reader rejects a record without
    // one, so fall back to 'T1' (an epic is not tier-classified work).
    let sidecarAbs: string | undefined;
    if (folder && approver !== undefined) {
      const hash = canonicalSpecHash(epic.filePath);
      if (hash === null) throw new Error(`cannot read ${epic.id} to hash its acceptance`);
      const tier = (declaredTier(epic.filePath) ?? 'T1') as Tier;
      const rel = specRelPath(folder, epic.filePath);
      writeRecord(folder, {
        specPath: rel,
        specHash: hash,
        approvedAt: new Date().toISOString(),
        approvedBy: approver,
        tier,
        migrated: false,
        baselineBlob: '',
      });
      sidecarAbs = sidecarPath(folder, rel);
    }
    if (folder) {
      try { writeEpicIndex(folder); } catch { /* index regen best-effort */ }
    }
    // Commit-on-approve: accepting an epic commits the flipped doc + the
    // regenerated epic INDEX in one pathspec-safe commit (SPEC-022 FR-1), gated
    // by `minspec.commitOnApprove`. Suffix folds the outcome into the toast.
    let suffix = '';
    if (folder) {
      const indexPath = path.join(path.dirname(epic.filePath), 'INDEX.md');
      suffix = (
        await commitApprovalIfEnabled(
          folder,
          sidecarAbs ? [epic.filePath, indexPath, sidecarAbs] : [epic.filePath, indexPath],
          `chore(accept): ${epic.id} activated`,
        )
      ).suffix;
    }
    vscode.window.showInformationMessage(`MinSpec: ${epic.id} → active${suffix}`);
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
