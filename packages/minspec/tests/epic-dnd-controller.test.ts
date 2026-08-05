/**
 * T2 — Feature tests: epic drag-and-drop reorder controller (#261 / DR-039).
 *
 * `EpicReorderDragAndDropController` is the mouse affordance that rewrites
 * `epic.order` when one epic header is dragged onto another. The reorder *math*
 * is `applyEpicReorder`'s (unit-tested in epic-manager tests); everything this
 * class owns is guard logic — which nodes may be dragged, which may be dropped
 * onto, which MIME carries the payload, and what happens when the persist
 * fails. That guard logic had zero branch coverage, so every one of those
 * decisions was unverified. These tests cover the decisions, not the math.
 *
 * Shape note: the controller is exercised through its real collaborators
 * wherever the collaborator IS the decision. `epicIdOf` guards on
 * `node instanceof EpicGroupNode`, so the nodes here are genuine
 * `EpicGroupNode`s — a hand-rolled stand-in would satisfy no `instanceof` and
 * the tests would pass against an empty method. Only `applyEpicReorder` is
 * stubbed, because it writes epic frontmatter and the INDEX to disk.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ─────────────────────────────────────────────────────────────
// Mirrors epic-grouping.test.ts / adr-tree-provider.test.ts. The TreeItem /
// TreeItemCollapsibleState / ThemeIcon / Uri surface is what EpicGroupNode's
// constructor touches (we build real ones); DataTransferItem and
// window.showErrorMessage are the controller's own vscode dependencies.
vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: string;
    accessibilityInformation?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    id: string;
    constructor(id: string) { this.id = id; }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  DataTransferItem: class {
    value: unknown;
    constructor(value: unknown) { this.value = value; }
  },
  window: { showErrorMessage: vi.fn() },
}));

// ─── Mock lib deps ───────────────────────────────────────────────────────────
// `applyEpicReorder` rewrites epic frontmatter and regenerates the epic INDEX on
// disk — stub it to keep these tests hermetic (constitution invariant 1) and so
// we can assert exactly which (root, moved, target) triple the controller
// derived from the gesture. `listEpics` / `groupByEpic` / `NO_EPIC` are unused
// by the controller but ARE imported by epic-grouping, which we load for real;
// a factory mock replaces the whole module, so they must be present.
vi.mock('../src/lib/epic-manager', () => ({
  applyEpicReorder: vi.fn(() => []),
  listEpics: vi.fn(() => []),
  groupByEpic: vi.fn(() => new Map()),
  NO_EPIC: '(no epic)',
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { EpicReorderDragAndDropController } from '../src/views/epic-dnd-controller';
import { EpicGroupNode } from '../src/views/epic-grouping';
import { applyEpicReorder } from '../src/lib/epic-manager';
import type { EpicSummary, EpicOrderAssignment } from '../src/lib/epic-manager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WS = '/ws';

function epicSummary(id: string): EpicSummary {
  return {
    id,
    slug: id.toLowerCase(),
    title: `Title ${id}`,
    status: 'active',
    order: 1,
    filePath: `${WS}/docs/epics/${id}.md`,
  };
}

/** A registered-epic group header — the only node kind the controller acts on. */
function epicHeader(id: string): EpicGroupNode<unknown> {
  const e = epicSummary(id);
  return new EpicGroupNode(`${e.title} (${id})`, [], '0/0', false, e, WS, id);
}

/**
 * The synthetic "(no epic)" bucket: a real EpicGroupNode carrying NO epic. It
 * is the node that distinguishes `instanceof EpicGroupNode` from
 * `instanceof EpicGroupNode && node.epic` — an implementation that dropped the
 * second half would treat this group as draggable and reorder nothing.
 */
function noEpicHeader(): EpicGroupNode<unknown> {
  return new EpicGroupNode('(no epic)', [], '0/3', true, undefined, WS);
}

/**
 * A leaf spec row. It deliberately carries an `epic` property shaped like an
 * EpicSummary: a duck-typed `epicIdOf` (`node.epic?.id`) would happily drag
 * `EPIC-999` off this leaf. The `instanceof` guard is what stops it, and this
 * shape is what lets the test tell the difference.
 */
interface SpecLeaf { readonly id: string; readonly epic: { readonly id: string } }
const specLeaf: SpecLeaf = { id: 'SPEC-001', epic: { id: 'EPIC-999' } };

type PaneNode = EpicGroupNode<unknown> | SpecLeaf;

/**
 * Map-backed stand-in for vscode.DataTransfer. Real storage rather than a pair
 * of spies, so a handleDrag → handleDrop round-trip genuinely proves the MIME
 * the drag writes is the one the drop reads. Two independent single-sided tests
 * would both stay green if those two constants ever drifted apart.
 */
function fakeDataTransfer() {
  const store = new Map<string, vscode.DataTransferItem>();
  const dt = {
    store,
    set: (mime: string, item: vscode.DataTransferItem) => { store.set(mime, item); },
    get: (mime: string) => store.get(mime),
  };
  return dt as unknown as vscode.DataTransfer & { readonly store: Map<string, vscode.DataTransferItem> };
}

// The controller ignores the cancellation token entirely; VS Code always passes one.
const token = {} as vscode.CancellationToken;

function assignment(id: string, order: number): EpicOrderAssignment {
  return { id, filePath: `${WS}/docs/epics/${id}.md`, order };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let onReordered: ReturnType<typeof vi.fn>;
let controller: EpicReorderDragAndDropController<PaneNode>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the persist succeeded but changed no orders. Tests that care about
  // the refresh callback override this explicitly.
  vi.mocked(applyEpicReorder).mockReturnValue([]);
  onReordered = vi.fn();
  controller = new EpicReorderDragAndDropController<PaneNode>(WS, onReordered);
});

/** What handleDrag actually parked on the transfer, under the declared drag MIME. */
function draggedPayload(dt: ReturnType<typeof fakeDataTransfer>): unknown {
  return dt.store.get(controller.dragMimeTypes[0])?.value;
}

// =============================================================================
// handleDrag — what may be picked up
// =============================================================================

describe('EpicReorderDragAndDropController.handleDrag', () => {
  it('parks the dragged epic id on the transfer under the declared drag MIME', () => {
    const dt = fakeDataTransfer();

    controller.handleDrag([epicHeader('EPIC-002')], dt, token);

    expect(draggedPayload(dt)).toBe('EPIC-002');
    // Exactly one entry: the controller must not scatter the id under other keys.
    expect(dt.store.size).toBe(1);
  });

  it('puts nothing on the transfer when a spec leaf is dragged', () => {
    const dt = fakeDataTransfer();

    controller.handleDrag([specLeaf], dt, token);

    // A populated transfer here would mean the leaf's look-alike `epic` field
    // was read — i.e. the instanceof guard is gone.
    expect(dt.store.size).toBe(0);
  });

  it('puts nothing on the transfer when the synthetic "(no epic)" group is dragged', () => {
    const dt = fakeDataTransfer();

    controller.handleDrag([noEpicHeader()], dt, token);

    expect(dt.store.size).toBe(0);
  });

  it('takes the first draggable epic when the selection mixes leaves and headers', () => {
    const dt = fakeDataTransfer();

    // Reorder is one-at-a-time, and the leading node is NOT draggable: the
    // controller must skip it rather than give up on the whole selection.
    controller.handleDrag([specLeaf, epicHeader('EPIC-003'), epicHeader('EPIC-004')], dt, token);

    expect(draggedPayload(dt)).toBe('EPIC-003');
  });
});

// =============================================================================
// handleDrop — what the gesture is turned into
// =============================================================================

describe('EpicReorderDragAndDropController.handleDrop', () => {
  it('round-trips a real drag: dropping EPIC-005 onto EPIC-002 reorders moved→target', async () => {
    const dt = fakeDataTransfer();

    controller.handleDrag([epicHeader('EPIC-005')], dt, token);
    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    // Argument order is load-bearing: (root, moved, target). Swapping the last
    // two moves the wrong epic, and the tree still refreshes, so nothing else
    // would notice.
    expect(applyEpicReorder).toHaveBeenCalledWith(WS, 'EPIC-005', 'EPIC-002');
  });

  it('reads the payload from the MIME it publicly declares in dropMimeTypes', async () => {
    const dt = fakeDataTransfer();
    // VS Code decides whether to even offer the drop from dropMimeTypes. If that
    // array named a MIME the implementation does not read, drops would silently
    // never arrive in the real pane.
    dt.set(controller.dropMimeTypes[0], new vscode.DataTransferItem('EPIC-007'));

    await controller.handleDrop(epicHeader('EPIC-001'), dt, token);

    expect(applyEpicReorder).toHaveBeenCalledWith(WS, 'EPIC-007', 'EPIC-001');
  });

  it('refreshes the tree when the reorder actually changed epic orders', async () => {
    vi.mocked(applyEpicReorder).mockReturnValue([assignment('EPIC-005', 1), assignment('EPIC-002', 2)]);
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    expect(onReordered).toHaveBeenCalledTimes(1);
  });

  it('does NOT refresh when the reorder wrote nothing', async () => {
    // applyEpicReorder returns [] for a move that lands where it already was.
    // Firing the refresh anyway would rebuild the whole tree — and collapse
    // expansion state — for a gesture that changed nothing.
    vi.mocked(applyEpicReorder).mockReturnValue([]);
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    expect(applyEpicReorder).toHaveBeenCalledTimes(1);
    expect(onReordered).not.toHaveBeenCalled();
  });

  it('ignores a payload published under a foreign MIME', async () => {
    const dt = fakeDataTransfer();
    // A drag originating outside this pane (explorer file drag, another view).
    // The private MIME is what keeps those from rewriting epic order.
    dt.set('text/uri-list', new vscode.DataTransferItem('EPIC-005'));

    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
    expect(onReordered).not.toHaveBeenCalled();
  });

  it('ignores a transfer carrying an empty payload under the right MIME', async () => {
    const dt = fakeDataTransfer();
    // Distinct from the foreign-MIME case: here the entry EXISTS and only its
    // value is empty, so the item-present path runs and the emptiness check has
    // to catch it. An empty movedId would reach applyEpicReorder as ''.
    dt.set(controller.dropMimeTypes[0], new vscode.DataTransferItem(''));

    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
  });

  it('ignores a drop onto a spec leaf', async () => {
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    await controller.handleDrop(specLeaf, dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
    expect(onReordered).not.toHaveBeenCalled();
  });

  it('ignores a drop onto the synthetic "(no epic)" group', async () => {
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    // The NO_EPIC bucket has no epic doc to reorder against; dropping there is
    // a no-op rather than a move to position 1.
    await controller.handleDrop(noEpicHeader(), dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
  });

  it('ignores a drop onto empty space (no target node at all)', async () => {
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    await controller.handleDrop(undefined, dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
  });

  it('ignores an epic dropped onto itself', async () => {
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    // Self-drop is the commonest accidental gesture (grab, wobble, release).
    // Without the identity check it reaches applyEpicReorder, whose insert-index
    // lookup runs against a list the moved epic was just spliced out of.
    await controller.handleDrop(epicHeader('EPIC-005'), dt, token);

    expect(applyEpicReorder).not.toHaveBeenCalled();
    expect(onReordered).not.toHaveBeenCalled();
  });
});

// =============================================================================
// handleDrop — persist failure
// =============================================================================

describe('EpicReorderDragAndDropController.handleDrop — failure handling', () => {
  it('surfaces a failed persist to the user and leaves the tree alone', async () => {
    vi.mocked(applyEpicReorder).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    // Must resolve, not reject: VS Code awaits handleDrop, and an escaping
    // rejection becomes an unhandled-promise notification with no explanation
    // of what the user's drag actually did.
    await expect(controller.handleDrop(epicHeader('EPIC-002'), dt, token)).resolves.toBeUndefined();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('EACCES: permission denied'),
    );
    // Half the epics may have been rewritten before the throw, but the caller's
    // refresh is deliberately skipped — the error message is the signal.
    expect(onReordered).not.toHaveBeenCalled();
  });

  it('renders a non-Error throw through String() rather than "[object Object]"', async () => {
    // fs/plugin code can reject with a bare string; `err.message` would be
    // undefined and the notification would read "failed to reorder epics — ".
    vi.mocked(applyEpicReorder).mockImplementation(() => {
      throw 'epic index is locked';
    });
    const dt = fakeDataTransfer();
    controller.handleDrag([epicHeader('EPIC-005')], dt, token);

    await controller.handleDrop(epicHeader('EPIC-002'), dt, token);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('epic index is locked'),
    );
  });
});
