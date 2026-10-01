import * as vscode from 'vscode';
import {
  fetchIssues,
  sortBacklog,
  extractEpicSlug,
} from '../lib/backlog';
import type { BacklogIssue, IssueLifecycleLabel } from '../lib/backlog';
import { EpicGroupingState, EpicGroupNode, buildEpicGroups } from './epic-grouping';
import type { ListEpicsFn } from './epic-grouping';
import { TreeExpansionMemory } from './tree-expansion-memory';

// ─── Lifecycle grouping ─────────────────────────────────────────────────────

interface LifecycleGroup {
  readonly label: string;
  readonly lifecycleLabel: IssueLifecycleLabel | null;
  readonly defaultExpanded: boolean;
}

const LIFECYCLE_GROUPS: LifecycleGroup[] = [
  { label: 'Inbox', lifecycleLabel: 'inbox', defaultExpanded: true },
  { label: 'Triaged', lifecycleLabel: 'triaged', defaultExpanded: true },
  { label: 'Agent-Ready', lifecycleLabel: 'agent-ready', defaultExpanded: true },
  { label: 'Work in Progress', lifecycleLabel: 'wip', defaultExpanded: true },
  { label: 'Unlabeled', lifecycleLabel: null, defaultExpanded: false },
];

// ─── Tree node classes ──────────────────────────────────────────────────────

export class BacklogGroupNode extends vscode.TreeItem {
  public readonly issues: BacklogIssue[];

  constructor(group: LifecycleGroup, issues: BacklogIssue[]) {
    const collapsibleState = group.defaultExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(group.label, collapsibleState);

    this.issues = issues;
    // Stable expansion key ([[tree-expansion-memory]]); single-root pane, so the
    // lifecycle label alone is unambiguous (the count badge stays out of the id).
    this.id = `lifecycle:${group.label}`;
    this.description = `(${issues.length})`;
    this.contextValue = 'backlogGroup';
    this.accessibilityInformation = {
      label: `${group.label} issues group, ${issues.length} items`,
      role: 'treeitem',
    };
  }
}

/**
 * Map lifecycle/priority to a ThemeIcon id.
 */
function issueIcon(issue: BacklogIssue): string {
  if (issue.lifecycleLabel === 'wip') return 'sync';
  if (issue.lifecycleLabel === 'agent-ready') return 'robot';
  if (issue.priorityLabel === 'P1') return 'flame';
  if (issue.priorityLabel === 'P2') return 'arrow-up';
  if (issue.priorityLabel === 'P3') return 'arrow-down';
  if (issue.lifecycleLabel === 'triaged') return 'checklist';
  if (issue.lifecycleLabel === 'inbox') return 'inbox';
  return 'issue-opened';
}

export class BacklogIssueNode extends vscode.TreeItem {
  constructor(public readonly issue: BacklogIssue) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    // Build description from priority + WSJF
    const parts: string[] = [];
    if (issue.priorityLabel) parts.push(issue.priorityLabel);
    if (issue.wsjfScore !== null) parts.push(`WSJF:${issue.wsjfScore}`);
    this.description = parts.join(' · ') || undefined;

    this.iconPath = new vscode.ThemeIcon(issueIcon(issue));

    // Click opens the issue URL in the browser
    this.command = {
      command: 'vscode.open',
      title: 'Open Issue',
      arguments: [vscode.Uri.parse(issue.url)],
    };

    this.contextValue = 'backlogIssueNode';
    this.accessibilityInformation = {
      label: `Issue ${issue.number}: ${issue.title}${issue.priorityLabel ? `, priority ${issue.priorityLabel}` : ''}${issue.lifecycleLabel ? `, ${issue.lifecycleLabel}` : ''}`,
      role: 'treeitem',
    };

    // Build tooltip
    const tooltipParts = [
      `#${issue.number}: ${issue.title}`,
      `State: ${issue.state}`,
    ];
    if (issue.lifecycleLabel) tooltipParts.push(`Lifecycle: ${issue.lifecycleLabel}`);
    if (issue.priorityLabel) tooltipParts.push(`Priority: ${issue.priorityLabel}`);
    if (issue.wsjfScore !== null) tooltipParts.push(`WSJF: ${issue.wsjfScore}`);
    if (issue.labels.length > 0) tooltipParts.push(`Labels: ${issue.labels.join(', ')}`);
    this.tooltip = tooltipParts.join('\n');
  }
}

// ─── Status rows: the panel's own state, drawn as rows inside the view ───────

/**
 * `contextValue` of each status row. One value per state, so no two states can look
 * alike to code (SPEC-085 FR-5): a failed fetch can never be drawn as the zero-issue row.
 */
export const BACKLOG_ROW = {
  notLoaded: 'backlogNotLoaded',
  loading: 'backlogLoading',
  loadedAt: 'backlogLoadedAt',
  empty: 'backlogEmpty',
  failed: 'backlogFailed',
  message: 'backlogMessage',
} as const;

/** The command a Backlog gesture runs. Activating the not-loaded row runs it too. */
const REFRESH_COMMAND = 'minspec.refreshBacklog';

/**
 * That command's palette title, as package.json contributes it. Named in the row
 * tooltips so the keyboard route (the Command Palette) is discoverable from the view;
 * `backlog-consent.test.ts` fails if this drifts from the manifest.
 */
const REFRESH_COMMAND_TITLE = 'MinSpec: Refresh Backlog (contacts GitHub through your gh CLI)';

interface StatusRow {
  readonly label: string;
  readonly contextValue: string;
  readonly description?: string;
  readonly tooltip?: string;
  /** A codicon id. */
  readonly icon?: string;
  readonly command?: vscode.Command;
}

class MessageNode extends vscode.TreeItem {
  constructor(row: StatusRow) {
    super(row.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = row.contextValue;
    if (row.description) this.description = row.description;
    if (row.tooltip) this.tooltip = row.tooltip;
    if (row.icon) this.iconPath = new vscode.ThemeIcon(row.icon);
    if (row.command) this.command = row.command;
    this.accessibilityInformation = {
      label: [row.label, row.description].filter(Boolean).join('. '),
      role: 'treeitem',
    };
  }
}

/**
 * When a list was loaded, as `YYYY-MM-DD HH:MM` in local time. An absolute time on
 * purpose: "5 minutes ago" is only right at the instant it is drawn, and this panel is
 * drawn far less often than time passes. No locale, so it reads the same everywhere.
 */
export function formatLoadedAt(when: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
  return `${date} ${two(when.getHours())}:${two(when.getMinutes())}`;
}

/** FR-3: the one row shown before any gesture. It names the network action and offers it. */
function notLoadedRow(): MessageNode {
  return new MessageNode({
    label: 'Backlog not loaded',
    description: "Select to list this repository's issues from GitHub using your gh CLI",
    contextValue: BACKLOG_ROW.notLoaded,
    icon: 'cloud-download',
    tooltip:
      'This pane has not contacted GitHub. Selecting this row lists this repository\'s open issues ' +
      'with one "gh issue list" call, run by your own gh CLI under your own sign-in.\n\n' +
      `It runs the command "${REFRESH_COMMAND_TITLE}", which is also the button in this view's title bar. ` +
      'The list is loaded only when you ask for it and is never refreshed automatically.',
    command: { command: REFRESH_COMMAND, title: 'Load the Backlog from GitHub' },
  });
}

function loadingRow(): MessageNode {
  return new MessageNode({
    label: 'Loading issues from GitHub...',
    contextValue: BACKLOG_ROW.loading,
    icon: 'loading~spin',
  });
}

/** FR-4: a loaded list says when it was loaded, so a stale list is not read as current. */
function loadedAtRow(loadedAt: Date): MessageNode {
  const when = formatLoadedAt(loadedAt);
  return new MessageNode({
    label: `Loaded ${when}`,
    description: 'not refreshed automatically',
    contextValue: BACKLOG_ROW.loadedAt,
    icon: 'history',
    tooltip:
      `This list was loaded from GitHub at ${when} and has not changed since. ` +
      `MinSpec does not refresh it on its own. Run "${REFRESH_COMMAND_TITLE}" to load it again.`,
  });
}

function emptyRow(): MessageNode {
  return new MessageNode({
    label: 'No open issues found',
    contextValue: BACKLOG_ROW.empty,
    icon: 'check',
  });
}

/** FR-5: could not load, with the reason. Never the zero-issue row. */
function failedRow(reason: string): MessageNode {
  // A reason can span lines when it carries gh's own output. A tree row is one line, so
  // the label gets the reason on one line and the tooltip keeps it as it arrived.
  const oneLine = reason.replace(/\s+/g, ' ').trim() || 'no reason was reported';
  return new MessageNode({
    label: `Could not load issues: ${oneLine}`,
    contextValue: BACKLOG_ROW.failed,
    icon: 'warning',
    tooltip:
      `${reason.trim() || oneLine}\n\nNothing is retried automatically. Run "${REFRESH_COMMAND_TITLE}" to try again.`,
  });
}

// ─── TreeDataProvider ───────────────────────────────────────────────────────

type BacklogNode = BacklogGroupNode | EpicGroupNode<BacklogIssue> | BacklogIssueNode | MessageNode;

/** Options for {@link BacklogTreeProvider.refresh}. */
export interface BacklogRefreshOptions {
  /**
   * `true` ONLY for the Backlog gesture (SPEC-085 FR-2): the user ran
   * `minspec.refreshBacklog` from the palette, the view-title button, or the not-loaded
   * row. It authorises exactly one `gh issue list`. Every other caller omits it and gets
   * a re-render from memory.
   */
  readonly contactGitHub?: boolean;
}

/** What the panel holds. `getChildren` draws exactly this and nothing else (SPEC-085 FR-5). */
type BacklogLoadState =
  | { readonly kind: 'not-loaded' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly issues: BacklogIssue[]; readonly loadedAt: Date }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * The Backlog pane.
 *
 * CONSENT (constitution invariant 1, SPEC-085). This provider contacts GitHub only when
 * the user asks it to. Drawing the view starts no process: {@link getChildren} renders
 * the state the provider already holds and has no call that can reach `gh`. The one
 * route to the network is {@link refresh} handed `{ contactGitHub: true }`, which only
 * the `minspec.refreshBacklog` registration in extension.ts passes. Before this, the
 * fetch lived inside the render, so every re-render and every ambient trigger (view
 * visible, window focus, folder change, three unrelated commands) ran `gh` unasked.
 *
 * Nothing is remembered across a window reload: each gesture authorises one load, and
 * the next one has to be asked for again (DQ-1).
 */
export class BacklogTreeProvider implements vscode.TreeDataProvider<BacklogNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BacklogNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** What the panel holds. Only {@link loadFromGitHub} moves it. */
  private state: BacklogLoadState = { kind: 'not-loaded' };
  /** The fetch a gesture started that has not settled yet. */
  private inFlight: Promise<void> | undefined;
  /** When a re-render was last requested; what {@link refreshIfStale} limits against. */
  private lastRenderRequestAt = 0;
  private readonly _listEpics?: ListEpicsFn;
  /** Per-panel "group by epic" toggle (FR-7), default on. */
  public readonly epicGrouping = new EpicGroupingState(true);
  /** Remembers group expand/collapse across reloads; wired in extension.ts. */
  private _expansion?: TreeExpansionMemory;
  setExpansionMemory(memory: TreeExpansionMemory): void {
    this._expansion = memory;
  }

  constructor(private workspaceRoot: string, listEpicsFn?: ListEpicsFn) {
    this._listEpics = listEpicsFn;
  }

  /**
   * Re-render the tree from memory. Starts no process and discards nothing (FR-4): the
   * sibling commands, the epic-grouping toggle and {@link refreshIfStale} all land here,
   * and a loaded list, a zero-issue result and a failure all stay exactly as they were.
   *
   * Handed `{ contactGitHub: true }` - the Backlog gesture, and only that - it instead
   * runs the one `gh issue list` the gesture authorised. The returned promise settles
   * when that fetch does; it resolves at once for a re-render and never rejects, because
   * a failed fetch becomes the could-not-load state.
   *
   * The gesture is an argument on this method, and not a method of its own, because two
   * activation suites pin `refresh` and `refreshIfStale` as the provider's whole
   * surface. `backlog-consent.test.ts` pins that extension.ts passes the argument from
   * exactly one place.
   */
  refresh(options?: BacklogRefreshOptions): Promise<void> {
    if (options?.contactGitHub === true) return this.loadFromGitHub();
    this.rerender();
    return Promise.resolve();
  }

  /**
   * Re-render unless one was already requested within `maxAgeMs`. Used by the
   * visibility, window-focus and folder-change triggers, so a burst of them (several
   * folders added at once) draws the view once. It never fetches: there is nothing left
   * here to protect `gh` from, because an ambient trigger no longer reaches it.
   */
  refreshIfStale(maxAgeMs = 30_000): void {
    if (Date.now() - this.lastRenderRequestAt < maxAgeMs) return;
    this.rerender();
  }

  private rerender(): void {
    this.lastRenderRequestAt = Date.now();
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * The one place this provider starts a process: a single `gh issue list`, reached only
   * through {@link refresh} with the gesture argument.
   *
   * No `gh auth status` probe runs first (SPEC-085 DQ-2). The list call is its own probe:
   * `fetchIssues` rejects with a classified reason when `gh` is missing, signed out,
   * offline, rate limited, timed out or returns unparsable output (#2247).
   *
   * A gesture that arrives while one is in flight joins it, so a double click is one
   * process. With no workspace folder there is no repository to list and nothing starts;
   * `gh` would otherwise run in the extension host's own working directory.
   */
  private loadFromGitHub(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.workspaceRoot) {
      this.rerender();
      return Promise.resolve();
    }

    this.state = { kind: 'loading' };
    this.rerender();

    const load = (async (): Promise<void> => {
      try {
        const issues = await fetchIssues(this.workspaceRoot, { state: 'open' });
        // A zero-issue result is an ordinary loaded state. Treating "empty" as "absent"
        // is what made the old code run gh again on every render.
        this.state = { kind: 'loaded', issues: sortBacklog(issues), loadedAt: new Date() };
      } catch (err) {
        // Held as a failure with its reason, never as an empty list (invariant 2).
        this.state = { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
      }
      this.inFlight = undefined;
      this.rerender();
    })();
    this.inFlight = load;
    return load;
  }

  getTreeItem(element: BacklogNode): vscode.TreeItem {
    this._expansion?.apply(element);
    return element;
  }

  async getChildren(element?: BacklogNode): Promise<BacklogNode[]> {
    if (!this.workspaceRoot) {
      return [new MessageNode({ label: 'No workspace folder open', contextValue: BACKLOG_ROW.message })];
    }

    if (!element) {
      return this.renderRoot();
    }

    if (element instanceof BacklogGroupNode) {
      return element.issues.map(issue => new BacklogIssueNode(issue));
    }

    if (element instanceof EpicGroupNode) {
      return element.members.map(issue => new BacklogIssueNode(issue));
    }

    return [];
  }

  /**
   * Draw the held state. Synchronous, and with no call that can reach a process, so
   * "rendering the view starts no `gh`" (FR-1) holds by construction and not by a check.
   */
  private renderRoot(): BacklogNode[] {
    const state = this.state;
    switch (state.kind) {
      case 'not-loaded':
        return [notLoadedRow()];
      case 'loading':
        return [loadingRow()];
      case 'failed':
        return [failedRow(state.reason)];
      case 'loaded':
        return [
          loadedAtRow(state.loadedAt),
          ...(state.issues.length === 0 ? [emptyRow()] : this.buildGroups(state.issues)),
        ];
    }
  }

  private buildGroups(issues: BacklogIssue[]): (BacklogGroupNode | EpicGroupNode<BacklogIssue>)[] {
    if (this.epicGrouping.enabled) {
      const epicGroups = buildEpicGroups(
        this.workspaceRoot,
        issues,
        issue => extractEpicSlug(issue.labels) ?? undefined,
        issue => issue.state.toLowerCase() === 'closed',
        this._listEpics,
      );
      if (epicGroups) return epicGroups;
    }
    return LIFECYCLE_GROUPS.map(group => {
      const groupIssues = issues.filter(issue => {
        if (group.lifecycleLabel === null) {
          // "Unlabeled" group: issues with no lifecycle label
          return issue.lifecycleLabel === null;
        }
        return issue.lifecycleLabel === group.lifecycleLabel;
      });
      return new BacklogGroupNode(group, groupIssues);
    }).filter(group => group.issues.length > 0);
  }
}
