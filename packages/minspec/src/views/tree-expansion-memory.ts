import * as vscode from 'vscode';

/**
 * Remembers a tree view's per-group expand/collapse state across window reloads.
 *
 * Why this exists: VS Code preserves a TreeView's expansion state *within* a
 * session (keyed on `TreeItem.id`), but a `TreeDataProvider` re-supplies each
 * node's `collapsibleState` on the first render after a window reload — so the
 * provider's hardcoded default (e.g. "Done lane collapsed, Specifying expanded")
 * wins and every user toggle is forgotten. This class persists the user's
 * *explicit* toggles to `workspaceState` and hands them back so the provider can
 * seed each group's `collapsibleState` from the remembered value, not the default.
 *
 * One instance per panel (Specs / Decisions / Backlog); the workspaceState key
 * namespaces them, so node ids need only be unique within a single view.
 *
 * Only groups the user has actually toggled are stored — a node with no recorded
 * state keeps whatever default the provider built it with, so changing a lane's
 * default expansion later still applies to anyone who never touched it.
 */
export class TreeExpansionMemory {
  /** id → true (user-expanded) / false (user-collapsed). Absent → use default. */
  private state: Record<string, boolean>;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly key: string,
  ) {
    this.state = { ...memento.get<Record<string, boolean>>(key, {}) };
  }

  /**
   * Override a tree item's `collapsibleState` with the remembered value, in place.
   * No-op when the item is a leaf (`None`), carries no `id`, or the user has never
   * toggled it — in those cases the provider's default stands. Call from the
   * provider's `getTreeItem`.
   */
  apply(item: vscode.TreeItem): void {
    if (!item.id) return;
    const current = item.collapsibleState;
    if (current === undefined || current === vscode.TreeItemCollapsibleState.None) return;
    const remembered = this.state[item.id];
    if (remembered === undefined) return;
    item.collapsibleState = remembered
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  /**
   * Record a user toggle and persist it. Called from the view's
   * `onDidExpandElement` / `onDidCollapseElement`. A no-op write is skipped so we
   * don't churn workspaceState on redundant events.
   */
  async record(id: string | undefined, expanded: boolean): Promise<void> {
    if (!id) return;
    if (this.state[id] === expanded) return;
    this.state[id] = expanded;
    await this.memento.update(this.key, this.state);
  }
}
