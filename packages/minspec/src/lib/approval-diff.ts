/**
 * Approval-staleness diff view — SPEC-029.
 *
 * Sources and renders "what changed since approval" for a stale spec, reusing
 * SPEC-017's already-minted body-only git-blob baseline (`ApprovalRecord.baselineBlob`
 * / `recoverBaseline`) and SPEC-022's committed approval sidecars
 * (`getApprovalRecord`). No new data model, no new persisted state — every value
 * is re-derived on demand (INV — no fabricated diff; nothing to go stale, nothing
 * to dispose).
 *
 * Tier-0: `vscode` (types + the content-provider/command surface) + `fs` + the
 * two existing pure functions from `./approval` / `@aiclarity/shared` — zero new
 * npm dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getApprovalRecord, recoverBaseline, recoverBaselineFromHistory } from './approval';
import { getSpecBodyOnly } from '@aiclarity/shared';
import type { SpecNode } from '../views/spec-tree-provider';

export type DiffSide = 'approved' | 'current';

/**
 * Re-derive one side's text on demand — nothing is cached. `'current'` reads +
 * body-extracts the live file (`undefined` on any read failure — deleted,
 * permissions, etc.). `'approved'` resolves the committed sidecar and recovers
 * its pinned baseline, falling back to a git-history reconstruction (#701) when
 * that blob is unrecoverable (legacy `baselineBlob === ''`, or a pruned/missing/
 * cross-machine blob). `undefined` only when there is no record, or neither the
 * blob nor any committed version reproduces the approved hash.
 *
 * `getApprovalRecord` takes the ABSOLUTE spec path and relativizes internally
 * (SPEC-029 Opus review SEV-1) — do NOT pre-relativize with `specRelPath`, or
 * the lookup misses for every spec (double-relativize resolves against the
 * process cwd, not the workspace root) and the diff can never open.
 */
export function resolveDiffSide(rootDir: string, specFilePath: string, side: DiffSide): string | undefined {
  if (side === 'current') {
    try {
      return getSpecBodyOnly(fs.readFileSync(specFilePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }
  const record = getApprovalRecord(rootDir, specFilePath);
  if (!record) return undefined;
  // Prefer the SPEC-017 minted blob; fall back to reconstructing the approved
  // body from git history (#701) when the blob is unrecoverable — a legacy
  // pre-baseline record (baselineBlob '') or a per-machine blob that never
  // reached this clone (DR-043). Both branches return the SAME body-only
  // boundary, so the diff's two sides stay comparable. Both never throw.
  return recoverBaseline(rootDir, record) ?? recoverBaselineFromHistory(rootDir, record);
}

const SCHEME = 'minspec-approval-diff';

function encodePath(p: string): string {
  return Buffer.from(p, 'utf-8').toString('base64url');
}

function decodePath(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf-8');
}

/**
 * Stateless `TextDocumentContentProvider` for the `minspec-approval-diff:`
 * scheme. URI shape: `minspec-approval-diff:/<side>/<base64url(specFilePath)>`.
 * Nothing is stored per-URI, so there is nothing to dispose when the diff tab
 * closes — VS Code's normal virtual-document lifecycle handles it.
 *
 * `?? ''` is reachable only if VS Code re-requests content after the tab is
 * already open (e.g. a manual "Revert File") — `showChangesSinceApproval`
 * gates BOTH sides before ever opening a URI, so this feature's own code never
 * triggers that fallback.
 */
export class ApprovalDiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly rootDir: string) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const [, side, encoded] = uri.path.split('/'); // '' / side / encodedPath
    const specFilePath = decodePath(encoded);
    return resolveDiffSide(this.rootDir, specFilePath, side as DiffSide) ?? '';
  }
}

function buildDiffUri(side: DiffSide, specFilePath: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}:/${side}/${encodePath(specFilePath)}`);
}

/**
 * `minspec.showChangesSinceApproval` — FR-5/FR-6/FR-7/FR-8.
 *
 * Reached three ways, normalized here:
 *  - FR-7 tree click (Needs-Re-Approval row): `arg` is the spec's file path (string).
 *  - FR-5 context menu: VS Code delivers the selected `SpecNode` as `arg`.
 *  - FR-5 command palette, no arg: falls back to the active editor's document.
 *
 * `rootDir` is injected by the registration closure (extension.ts), never a
 * passed command argument.
 */
export async function showChangesSinceApproval(rootDir: string, arg?: SpecNode | string): Promise<void> {
  const specFilePath: string | undefined =
    typeof arg === 'string' ? arg
      : arg && typeof arg === 'object' && 'spec' in arg ? (arg as SpecNode).spec.filePath
        : vscode.window.activeTextEditor?.document.uri.fsPath;

  const degrade = (message: string): void => {
    void vscode.window.showInformationMessage(message);
  };

  if (!specFilePath) {
    degrade('No spec selected — open or select a spec to show its changes since approval.');
    return;
  }

  // FR-8: gate the APPROVED side before opening anything.
  const approved = resolveDiffSide(rootDir, specFilePath, 'approved');
  if (approved === undefined) {
    degrade('Baseline unavailable for this spec — cannot show what changed; re-approving will restore diffing for future edits.');
    return;
  }

  // SEV-3 fix: gate the CURRENT side too — the file can be deleted/unreadable
  // between the stale-flagged render and the click (a real TOCTOU window).
  // Without this a false "everything deleted" diff would render.
  const current = resolveDiffSide(rootDir, specFilePath, 'current');
  if (current === undefined) {
    degrade('This spec file is no longer readable — cannot show what changed.');
    return;
  }

  const record = getApprovalRecord(rootDir, specFilePath)!; // present — `approved` above required it
  const approvedUri = buildDiffUri('approved', specFilePath);
  const currentUri = buildDiffUri('current', specFilePath);
  const label = path.basename(path.dirname(specFilePath));
  await vscode.commands.executeCommand(
    'vscode.diff',
    approvedUri,
    currentUri,
    `${label}: Approved (${record.approvedAt}) ↔ Current`,
  );
}
