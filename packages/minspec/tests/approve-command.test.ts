import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/ws' } }],
    openTextDocument: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

// listSpecs scans the workspace — mock it wholesale (also avoids loading the
// provider's heavy import chain). parseSpec stays REAL so the id-from-editor
// resolution is genuinely exercised.
vi.mock('../src/views/spec-tree-provider', () => ({
  listSpecs: vi.fn(),
}));

vi.mock('../src/lib/approval', () => ({
  approveSpec: vi.fn(),
  revokeApproval: vi.fn(() => true),
  getApprovalStatus: vi.fn(() => 'none'),
}));

// ─── Imports ───────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import {
  approveSpecCommand,
  revokeApprovalCommand,
} from '../src/commands/approve';
import { listSpecs } from '../src/views/spec-tree-provider';
import { revokeApproval } from '../src/lib/approval';
import type { SpecSummary } from '../src/views/spec-tree-provider';

// ─── Helpers ───────────────────────────────────────────────────────────────

function summary(id: string, title: string): SpecSummary {
  return {
    id,
    title,
    tier: 'T2',
    status: 'specifying',
    currentPhase: 'specify',
    filePath: `/tmp/ws/specs/minspec/${id}/spec.md`,
    phasesDone: 0,
    phasesTotal: 4,
  } as unknown as SpecSummary;
}

/** Point the active editor at an in-memory document with the given text. */
function setActiveDoc(text: string | undefined): void {
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor =
    text === undefined ? undefined : { document: { getText: () => text } };
}

const SPEC_002_DESIGN = `---
id: SPEC-002
title: Review Webview
tier: T2
status: specifying
---
# Review Webview
A non-canonical file of the spec (design.md), not its representative path.
`;

/** Grab the items array passed to the most recent showQuickPick call. */
function quickPickItems(): { label: string; description: string; spec: SpecSummary }[] {
  const calls = (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0];
}

// =============================================================================

describe('approve command — default to open spec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSpecs).mockReturnValue([
      summary('SPEC-001', 'First'),
      summary('SPEC-002', 'Review Webview'),
      summary('SPEC-003', 'Third'),
    ]);
  });

  afterEach(() => setActiveDoc(undefined));

  it('floats the spec open in the active editor to the top and marks it', async () => {
    // design.md of SPEC-002 is open — its id, not its file path, must resolve.
    setActiveDoc(SPEC_002_DESIGN);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined); // user cancels

    await approveSpecCommand(undefined);

    const items = quickPickItems();
    expect(items[0].spec.id).toBe('SPEC-002'); // default = open spec, regardless of list order
    expect(items[0].description).toContain('· open'); // visibly marked as the open one
    // Only the open spec is marked.
    expect(items.filter((i) => i.description.includes('· open'))).toHaveLength(1);
  });

  it('preserves natural order and marks nothing when no spec is open', async () => {
    setActiveDoc(undefined);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

    await approveSpecCommand(undefined);

    const items = quickPickItems();
    expect(items.map((i) => i.spec.id)).toEqual(['SPEC-001', 'SPEC-002', 'SPEC-003']);
    expect(items.some((i) => i.description.includes('· open'))).toBe(false);
  });

  it('does not mark when the open file is not a spec (no id frontmatter)', async () => {
    setActiveDoc('# Just a readme\nno frontmatter here');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

    await approveSpecCommand(undefined);

    const items = quickPickItems();
    expect(items.map((i) => i.spec.id)).toEqual(['SPEC-001', 'SPEC-002', 'SPEC-003']);
    expect(items.some((i) => i.description.includes('· open'))).toBe(false);
  });

  it('skips the quick-pick entirely when invoked from a tree node', async () => {
    const node = { spec: summary('SPEC-003', 'Third') };
    setActiveDoc(SPEC_002_DESIGN);

    // readSpecFile will throw on the fake path → harmless error path; we only
    // assert the picker was bypassed (node context wins over the open editor).
    await approveSpecCommand(node);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('revoke shares the same default-to-open behavior', async () => {
    setActiveDoc(SPEC_002_DESIGN);
    // User accepts the highlighted default (first item).
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
      async (items: unknown) =>
        (items as { spec: SpecSummary }[])[0],
    );

    await revokeApprovalCommand(undefined);

    const items = quickPickItems();
    expect(items[0].spec.id).toBe('SPEC-002');
    expect(revokeApproval).toHaveBeenCalledWith('/tmp/ws', 'SPEC-002');
  });
});
