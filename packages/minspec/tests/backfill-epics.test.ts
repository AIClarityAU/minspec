import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────
//
// Rename-in-flow (#218) adds a keyboard step to the Tweak surface: after the
// drop multi-select, a single-select QuickPick of the kept NEW epics lets you
// pick one and edit its title in an InputBox; the slug is re-derived and every
// mapping that pointed at the old slug is repointed at the new one. These tests
// drive that path end-to-end through `backfillEpicsCommand`.

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showTextDocument: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    withProgress: vi.fn((_opts: unknown, task: () => unknown) => task()),
  },
  workspace: {
    openTextDocument: vi.fn(() => Promise.resolve({})),
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => false),
      update: vi.fn(() => Promise.resolve()),
    })),
  },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
}));

// ─── Mock lib deps ─────────────────────────────────────────────────────────

vi.mock('../src/lib/epic-backfill', () => ({
  proposeHeuristic: vi.fn(),
  proposeAI: vi.fn(),
  isClaudeAvailable: vi.fn(),
  applyBackfill: vi.fn(),
  renderProposalMarkdown: vi.fn(() => '# Proposal'),
}));

vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolder: vi.fn(),
}));

// Real slugify is tiny + pure; mock it so the test owns the exact mapping and
// stays decoupled from spec-manager internals. Mirrors the production rule
// (lowercase, non-alphanumeric → hyphens, trimmed).
vi.mock('../src/lib/spec-manager', () => ({
  slugify: vi.fn((title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  ),
}));

// listEpics is consulted for slug-collision checks against already-registered
// epics. Default: empty registry (no collisions).
vi.mock('../src/lib/epic-manager', () => ({
  listEpics: vi.fn(() => []),
}));

// ─── Imports ───────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { backfillEpicsCommand } from '../src/commands/backfill-epics';
import {
  proposeHeuristic,
  proposeAI,
  isClaudeAvailable,
  applyBackfill,
  renderProposalMarkdown,
  type BackfillProposal,
} from '../src/lib/epic-backfill';
import { resolveTargetFolder } from '../src/lib/resolve-folder';
import { listEpics } from '../src/lib/epic-manager';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeProposal(epicCount: number, mappingCount: number): BackfillProposal {
  const epics = Array.from({ length: epicCount }, (_, i) => ({
    slug: `epic-${i}`,
    title: `Epic ${i}`,
    rationale: 'auto',
  }));
  // All mappings point at the first epic (epic-0).
  const mappings = Array.from({ length: mappingCount }, (_, i) => ({
    artifactId: `SPEC-00${i}`,
    kind: 'spec' as const,
    filePath: `/tmp/specs/SPEC-00${i}.md`,
    epicSlug: `epic-0`,
    confidence: 0.9,
    rationale: 'auto',
  }));
  return { epics, mappings, source: 'heuristic' } as BackfillProposal;
}

const FOLDER = '/tmp/test-workspace';

/**
 * A QuickPick mock that plays back a queued sequence of selections. The drop
 * multi-select returns an array; the rename single-select returns one item (or
 * the Done sentinel / undefined). Each `showQuickPick` call shifts one entry.
 */
function queueQuickPick(
  responses: Array<(items: any[]) => unknown>, // eslint-disable-line @typescript-eslint/no-explicit-any
): void {
  let n = 0;
  vi.mocked(vscode.window.showQuickPick).mockImplementation((async (items: unknown) => {
    const fn = responses[n++];
    return fn ? fn(items as any[]) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  }) as never);
}

const DONE_SENTINEL = (items: any[]) => items.find((it) => it.rename === 'done'); // eslint-disable-line @typescript-eslint/no-explicit-any
const KEEP_ALL = (items: any[]) => items.filter((it) => it.ref); // eslint-disable-line @typescript-eslint/no-explicit-any

// =============================================================================
// Rename-in-flow tests (#218)
// =============================================================================

describe('backfillEpicsCommand() — Tweak rename-in-flow (#218)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTargetFolder).mockResolvedValue(FOLDER);
    vi.mocked(proposeHeuristic).mockReturnValue(makeProposal(2, 3));
    vi.mocked(isClaudeAvailable).mockResolvedValue(false);
    vi.mocked(renderProposalMarkdown).mockReturnValue('# Proposal');
    vi.mocked(listEpics).mockReturnValue([]);
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({} as vscode.TextDocument);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue(
      undefined as unknown as vscode.TextEditor,
    );
  });

  // INVARIANT (T0): renaming an epic rewrites BOTH title and slug on the epic,
  // AND repoints every mapping that referenced the old slug — no orphaned
  // mappings (an orphan would be silently dropped at apply).
  it('rewrites the epic title+slug and repoints all mappings to the new slug', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never) // open Tweak
      .mockResolvedValueOnce('Apply' as never); // apply after tweak

    queueQuickPick([
      KEEP_ALL, // drop step: keep everything
      // rename step: pick epic-0 (the one all mappings point at)
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      DONE_SENTINEL, // rename step again: finish
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Auth & Sessions' as never);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    const applied = vi.mocked(applyBackfill).mock.calls[0][1];
    const renamed = applied.epics.find((e) => e.title === 'Auth & Sessions');
    expect(renamed).toBeDefined();
    expect(renamed!.slug).toBe('auth-sessions');
    // Every mapping that was on epic-0 now points at the new slug — none orphaned.
    expect(applied.mappings).toHaveLength(3);
    for (const m of applied.mappings) {
      expect(m.epicSlug).toBe('auth-sessions');
    }
    expect(applyBackfill).toHaveBeenCalledWith(FOLDER, expect.anything());
  });

  // The rename InputBox is pre-filled with the current title (keyboard-friendly:
  // edit-in-place rather than retype).
  it('pre-fills the rename InputBox with the current epic title', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([
      KEEP_ALL,
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      DONE_SENTINEL,
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Renamed' as never);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Epic 0' }),
    );
  });

  // Cancelling the InputBox (Esc) leaves the epic untouched and returns to the
  // rename picker — no partial rename.
  it('leaves the epic untouched when the rename InputBox is cancelled', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([
      KEEP_ALL,
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      DONE_SENTINEL,
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined); // Esc
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    const applied = vi.mocked(applyBackfill).mock.calls[0][1];
    expect(applied.epics.find((e) => e.slug === 'epic-0')).toBeDefined();
    expect(applied.epics.find((e) => e.title === 'Epic 0')).toBeDefined();
    for (const m of applied.mappings) expect(m.epicSlug).toBe('epic-0');
  });

  // Picking "Done" immediately (or Esc on the rename picker) applies the kept
  // proposal with no rename — the existing drop-only behaviour is preserved.
  it('applies without renaming when the rename picker is finished immediately', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([KEEP_ALL, DONE_SENTINEL]);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    const applied = vi.mocked(applyBackfill).mock.calls[0][1];
    expect(applied.epics.find((e) => e.slug === 'epic-0')).toBeDefined();
  });

  // Esc on the rename picker (undefined) also finishes cleanly.
  it('finishes the rename loop when the rename picker is dismissed (Esc)', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([KEEP_ALL, () => undefined]); // drop kept all; rename picker Esc
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(applyBackfill).toHaveBeenCalled();
  });

  // INVARIANT: a new slug that collides with an ALREADY-REGISTERED epic is
  // rejected (the InputBox validateInput returns a message), so the rename does
  // not silently merge the proposed epic into an unrelated existing one.
  it('rejects a rename whose slug collides with a registered epic', async () => {
    vi.mocked(listEpics).mockReturnValue([
      { id: 'EPIC-009', slug: 'billing', title: 'Billing', status: 'active', order: 1, filePath: '/x' },
    ] as never);
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);

    let captured: ((v: string) => string | undefined | null) | undefined;
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce((async (opts: unknown) => {
      captured = (opts as { validateInput?: (v: string) => string | undefined | null })
        .validateInput;
      return undefined; // user cancels after seeing the error
    }) as never);

    queueQuickPick([
      KEEP_ALL,
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      DONE_SENTINEL,
    ]);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(captured).toBeTypeOf('function');
    // 'Billing' slugifies to 'billing' → collides with the registered epic.
    expect(captured!('Billing')).toBeTruthy();
    // A fresh, non-colliding title validates fine.
    expect(captured!('Fresh Name')).toBeFalsy();
  });

  // INVARIANT: a new slug that collides with ANOTHER proposed epic is rejected.
  it('rejects a rename whose slug collides with another proposed epic', async () => {
    // proposal has epic-0 ("Epic 0") and epic-1 ("Epic 1"); rename epic-0 to
    // "Epic 1" → slug 'epic-1' collides with the sibling.
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);

    let captured: ((v: string) => string | undefined | null) | undefined;
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce((async (opts: unknown) => {
      captured = (opts as { validateInput?: (v: string) => string | undefined | null })
        .validateInput;
      return undefined;
    }) as never);

    queueQuickPick([
      KEEP_ALL,
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      DONE_SENTINEL,
    ]);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(captured).toBeTypeOf('function');
    expect(captured!('Epic 1')).toBeTruthy(); // collides with sibling proposed epic
    // Renaming to its OWN current title is allowed (slug unchanged).
    expect(captured!('Epic 0')).toBeFalsy();
    // Empty / slug-less input is rejected.
    expect(captured!('   ')).toBeTruthy();
    expect(captured!('!!!')).toBeTruthy(); // slugifies to '' → rejected
  });

  // Existing (already-registered) epics in the proposal are NOT offered for
  // rename-in-flow: applyBackfill prefers the registry's canonical title and
  // never renames on disk, so an in-flow "rename" of an existing epic would
  // silently no-op. Only NEW proposed epics appear in the rename picker.
  it('omits existing (id-bearing) epics from the rename picker', async () => {
    const proposal = makeProposal(2, 3);
    // Mark epic-0 as existing (has an id).
    (proposal.epics[0] as { id?: string }).id = 'EPIC-005';
    vi.mocked(proposeHeuristic).mockReturnValue(proposal);

    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);

    let renamePickItems: any[] | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    queueQuickPick([
      KEEP_ALL,
      (items) => {
        renamePickItems = items;
        return items.find((it) => it.rename === 'done');
      },
    ]);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 1, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(renamePickItems).toBeDefined();
    const renamable = renamePickItems!.filter((it) => it.epic);
    // Only epic-1 (new) is renamable; epic-0 (existing) is omitted.
    expect(renamable).toHaveLength(1);
    expect(renamable[0].label).toContain('Epic 1');
  });

  // When every kept epic is existing, the rename picker is skipped entirely
  // (nothing renamable) — straight to Apply, drop-only behaviour intact.
  it('skips the rename picker when no kept epic is renamable', async () => {
    const proposal = makeProposal(1, 2);
    (proposal.epics[0] as { id?: string }).id = 'EPIC-005';
    vi.mocked(proposeHeuristic).mockReturnValue(proposal);

    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([KEEP_ALL]); // only the drop step is shown
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 0, artifactsTagged: 2, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    // Only one QuickPick (the drop step); no rename picker, no input box.
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  // Dismissing the DROP QuickPick still keeps the original proposal untouched —
  // the rename step is only reached once a drop selection is made.
  it('keeps the original proposal and skips rename when the drop picker is dismissed', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([() => undefined]); // drop picker dismissed
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    // Original proposal applied unchanged.
    const applied = vi.mocked(applyBackfill).mock.calls[0][1];
    expect(applied.epics).toHaveLength(2);
    expect(applied.mappings).toHaveLength(3);
  });

  // Two renames in one Tweak session both stick.
  it('supports renaming multiple epics in a single Tweak session', async () => {
    vi.mocked(vscode.window.showInformationMessage)
      .mockResolvedValueOnce('Tweak…' as never)
      .mockResolvedValueOnce('Apply' as never);
    queueQuickPick([
      KEEP_ALL,
      (items) => items.find((it) => it.epic?.slug === 'epic-0'),
      (items) => items.find((it) => it.epic?.slug === 'epic-1'),
      DONE_SENTINEL,
    ]);
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('First Renamed' as never)
      .mockResolvedValueOnce('Second Renamed' as never);
    vi.mocked(applyBackfill).mockReturnValueOnce({ epicsCreated: 2, artifactsTagged: 3, skipped: 0 });

    await backfillEpicsCommand(FOLDER);

    const applied = vi.mocked(applyBackfill).mock.calls[0][1];
    expect(applied.epics.find((e) => e.slug === 'first-renamed')).toBeDefined();
    expect(applied.epics.find((e) => e.slug === 'second-renamed')).toBeDefined();
    // epic-0's mappings followed the rename.
    for (const m of applied.mappings) expect(m.epicSlug).toBe('first-renamed');
  });
});
