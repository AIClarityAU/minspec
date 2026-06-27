import * as vscode from 'vscode';
import { EpicGroupNode } from './epic-grouping';
import { applyEpicReorder } from '../lib/epic-manager';

/**
 * Drag-and-drop reorder for `epic.order` in the specs explorer pane (#261 / DR-039).
 *
 * Epic reorder is *low-frequency*, so the amended keyboard-first rule permits a
 * mouse/DnD affordance here. Dragging one epic header onto another rewrites
 * `epic.order` for the affected epics (dense 1..N) and regenerates the epic
 * INDEX — all via `applyEpicReorder`, which is the unit-tested pure-logic path.
 *
 * Registered PROGRAMMATICALLY through `createTreeView`'s `dragAndDropController`
 * option (NOT package.json) so the contribution stays internal and the reorder
 * never leaks into the extension's declared surface.
 *
 * Only registered-epic group headers participate: the synthetic NO_EPIC group
 * and the leaf spec rows carry no `epic` and are silently ignored — dragging
 * them, or dropping onto them, is a no-op.
 */
export class EpicReorderDragAndDropController<TNode>
implements vscode.TreeDragAndDropController<TNode> {
  /** Private MIME so drags only resolve within this pane. */
  private static readonly MIME = 'application/vnd.minspec.epic';

  readonly dropMimeTypes = [EpicReorderDragAndDropController.MIME];
  readonly dragMimeTypes = [EpicReorderDragAndDropController.MIME];

  /**
   * @param workspaceRoot the repo root passed to `applyEpicReorder`
   * @param onReordered   called after a successful persist so the caller can
   *                      refresh the tree (the file watcher also fires, but an
   *                      explicit refresh makes the move feel immediate)
   */
  constructor(
    private readonly workspaceRoot: string,
    private readonly onReordered: () => void,
  ) {}

  /** Returns the dragged node's epic id, or undefined for non-epic rows. */
  private static epicIdOf(node: unknown): string | undefined {
    return node instanceof EpicGroupNode && node.epic ? node.epic.id : undefined;
  }

  handleDrag(
    source: readonly TNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): void {
    // Reorder is one-at-a-time; take the first draggable epic header.
    const movedId = source
      .map(EpicReorderDragAndDropController.epicIdOf)
      .find((id): id is string => id !== undefined);
    if (!movedId) return; // dragging a spec leaf / NO_EPIC group — nothing to carry
    dataTransfer.set(
      EpicReorderDragAndDropController.MIME,
      new vscode.DataTransferItem(movedId),
    );
  }

  async handleDrop(
    target: TNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const item = dataTransfer.get(EpicReorderDragAndDropController.MIME);
    const movedId = item ? String(item.value) : undefined;
    if (!movedId) return;

    const targetId = EpicReorderDragAndDropController.epicIdOf(target);
    if (!targetId || targetId === movedId) return; // dropped on a leaf / itself / nowhere

    try {
      const changed = applyEpicReorder(this.workspaceRoot, movedId, targetId);
      if (changed.length > 0) this.onReordered();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `MinSpec: failed to reorder epics — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
