import * as vscode from 'vscode';
import * as path from 'path';
import { listAdrs } from '../lib/adr-manager';
import type { AdrSummary, AdrStatus } from '../lib/adr-manager';
import { allWorkspaceRoots } from '../lib/resolve-folder';
import { EpicGroupingState, EpicGroupNode, buildEpicGroups } from './epic-grouping';
import type { ListEpicsFn } from './epic-grouping';
import { TreeExpansionMemory } from './tree-expansion-memory';

// ─── Status grouping ────────────────────────────────────────────────────────

interface StatusGroup {
  readonly label: string;
  readonly statuses: AdrStatus[];
  readonly defaultExpanded: boolean;
}

const STATUS_GROUPS: StatusGroup[] = [
  { label: 'Proposed', statuses: ['proposed'], defaultExpanded: true },
  { label: 'Accepted', statuses: ['accepted'], defaultExpanded: true },
  { label: 'Deprecated / Superseded', statuses: ['deprecated', 'superseded'], defaultExpanded: false },
];

// ─── Tree node classes ──────────────────────────────────────────────────────

export class AdrGroupNode extends vscode.TreeItem {
  public readonly adrs: AdrSummary[];

  constructor(group: StatusGroup, adrs: AdrSummary[], root = '') {
    const collapsibleState = group.defaultExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(group.label, collapsibleState);

    this.adrs = adrs;
    // Root-namespaced expansion key ([[tree-expansion-memory]]) — stable label,
    // not the count badge, so multi-root (#549) lanes never collide.
    this.id = `${root}::status:${group.label}`;
    this.description = `(${adrs.length})`;
    this.contextValue = 'adrGroup';
    this.accessibilityInformation = {
      label: `${group.label} decisions group, ${adrs.length} items`,
      role: 'treeitem',
    };
  }
}

/**
 * Map an ADR status to a ThemeIcon id.
 */
function statusIcon(status: AdrStatus): string {
  switch (status) {
    case 'proposed': return 'question';
    case 'accepted': return 'check';
    case 'deprecated': return 'warning';
    case 'superseded': return 'arrow-swap';
    default: return 'circle-outline';
  }
}

export class AdrNode extends vscode.TreeItem {
  constructor(public readonly adr: AdrSummary) {
    super(`${adr.id}: ${adr.title}`, vscode.TreeItemCollapsibleState.None);

    this.description = adr.date;
    this.iconPath = new vscode.ThemeIcon(statusIcon(adr.status));

    // Click opens the ADR file
    this.command = {
      command: 'vscode.open',
      title: 'Open ADR',
      arguments: [vscode.Uri.file(adr.filePath)],
    };

    // Status-suffixed contextValue gates menus: inline ✓ Accept shows only on
    // proposed ADRs (`adrNode.proposed`); Set Status shows on all (`adrNode.*`).
    this.contextValue = `adrNode.${adr.status}`;
    this.tooltip = `${adr.id}: ${adr.title}\nStatus: ${adr.status}\nDate: ${adr.date}`;
    this.accessibilityInformation = {
      label: `${adr.id}: ${adr.title}, status ${adr.status}, date ${adr.date}`,
      role: 'treeitem',
    };
  }
}

// ─── TreeDataProvider ───────────────────────────────────────────────────────

/**
 * Top-level per-folder group, shown ONLY in a multi-root workspace (#549).
 * Mirrors SpecFolderNode: its children are that folder's ordinary status/epic
 * groups, computed against the folder's OWN root. Single-root workspaces render
 * no folder tier — the tree is byte-identical to before.
 */
export class AdrFolderNode extends vscode.TreeItem {
  constructor(public readonly root: string) {
    const name = path.basename(root) || root;
    super(name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `folder::${root}`; // stable expansion key ([[tree-expansion-memory]])
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'adrFolder';
    this.tooltip = root;
    this.accessibilityInformation = {
      label: `${name} workspace folder`,
      role: 'treeitem',
    };
  }
}

/** Function signature for listing ADRs — allows dependency injection in tests */
export type ListAdrsFn = (rootDir: string, vscodeOverrides?: { decisionsDir?: string }) => AdrSummary[];

export type AdrTreeNode = AdrFolderNode | AdrGroupNode | EpicGroupNode<AdrSummary> | AdrNode;

export class AdrTreeProvider implements vscode.TreeDataProvider<AdrTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AdrTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  /** Coalesce refresh bursts (issue #154). See refresh(). */
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private static readonly REFRESH_DEBOUNCE_MS = 120;
  private readonly _listAdrs: ListAdrsFn;
  private readonly _listEpics?: ListEpicsFn;
  /** Per-panel "group by epic" toggle (FR-7), default on. */
  public readonly epicGrouping = new EpicGroupingState(true);
  /** Remembers group expand/collapse across reloads; wired in extension.ts. */
  private _expansion?: TreeExpansionMemory;
  setExpansionMemory(memory: TreeExpansionMemory): void {
    this._expansion = memory;
  }

  constructor(
    private workspaceRoot: string,
    listAdrsFn?: ListAdrsFn,
    listEpicsFn?: ListEpicsFn,
  ) {
    this._listAdrs = listAdrsFn ?? listAdrs;
    this._listEpics = listEpicsFn;
  }

  /**
   * Rebuild the tree, coalescing bursts into a single rebuild (issue #154).
   * Epic/ADR commands fire this alongside the spec-tree refresh; like the spec
   * tree, each fire synchronously re-reads+parses every DR (`listAdrs`) on the
   * extension-host thread, so an uncoalesced burst stalls the UI under memory
   * pressure. getChildren reads fresh, so one trailing fire reflects latest state.
   */
  refresh(): void {
    if (this._refreshTimer !== undefined) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._onDidChangeTreeData.fire(undefined);
    }, AdrTreeProvider.REFRESH_DEBOUNCE_MS);
  }

  getTreeItem(element: AdrTreeNode): vscode.TreeItem {
    this._expansion?.apply(element);
    return element;
  }

  getChildren(element?: AdrTreeNode): AdrTreeNode[] {
    if (!element) {
      const roots = this.roots();
      if (roots.length === 0) return [];
      // Single-root (the common case): render the folder's groups directly —
      // byte-identical to the pre-#549 behavior.
      if (roots.length === 1) return this.rootChildren(roots[0]);
      // Multi-root: one expandable group per folder (#549), each listing its own
      // decisions and its own epics.
      return roots.map(root => new AdrFolderNode(root));
    }

    if (element instanceof AdrFolderNode) {
      return this.rootChildren(element.root);
    }

    if (element instanceof AdrGroupNode) {
      return element.adrs.map(adr => new AdrNode(adr));
    }

    if (element instanceof EpicGroupNode) {
      return element.members.map(adr => new AdrNode(adr));
    }

    return [];
  }

  /**
   * The workspace roots to scan. Live `workspaceFolders` win (multi-root, #549);
   * the ctor `workspaceRoot` is the single-root fallback for activation-time
   * construction and unit tests whose vscode mock exposes no workspaceFolders.
   * Read fresh every call so refresh() after onDidChangeWorkspaceFolders re-scans.
   *
   * `allWorkspaceRoots()` returns `undefined` (fall back to the ctor seed) only
   * when the live API has no folder list at all; it returns `[]` — rendered as
   * an empty tree, no fallback — when the API is live and genuinely reports
   * zero folders (every folder removed at runtime). Collapsing those two cases
   * via `live.length > 0 ? live : fallback` briefly re-rendered the removed
   * folder's stale DRs after the last live folder vanished (#574).
   */
  private roots(): string[] {
    const live = allWorkspaceRoots();
    if (live !== undefined) return live;
    return this.workspaceRoot ? [this.workspaceRoot] : [];
  }

  /** The status/epic groups for ONE folder — what getChildren(undefined)
   *  returned before #549; multi-root calls it once per folder. */
  private rootChildren(root: string): AdrTreeNode[] {
    const allAdrs = this.listAll(root);
    const epicGroups = this.epicGrouping.enabled ? this.getEpicGroups(root, allAdrs) : null;
    return epicGroups ?? this.getStatusGroups(allAdrs, root);
  }

  private listAll(root: string): AdrSummary[] {
    const decisionsDir = vscode.workspace
      .getConfiguration('minspec')
      .get<string>('decisionsDir');
    return this._listAdrs(
      root,
      decisionsDir ? { decisionsDir } : undefined,
    );
  }

  private getStatusGroups(allAdrs: AdrSummary[], root = ''): AdrGroupNode[] {
    return STATUS_GROUPS.map(group => {
      const groupAdrs = allAdrs.filter(a => group.statuses.includes(a.status));
      return new AdrGroupNode(group, groupAdrs, root);
    });
  }

  private getEpicGroups(root: string, allAdrs: AdrSummary[]): EpicGroupNode<AdrSummary>[] | null {
    return buildEpicGroups(
      root,
      allAdrs,
      a => a.epic,
      a => a.status === 'accepted',
      this._listEpics,
    );
  }
}
