import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode ---
vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
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
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    id: string;
    constructor(id: string) { this.id = id; }
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    parse: (s: string) => ({ toString: () => s }),
  },
}));

// --- Mock lib/backlog ---
// Only the three functions that would start a process are replaced; the rest of the
// module (the epic-label parser the grouping uses) is the real one. This file tests the
// provider's own logic. That the real functions start no process until asked is proved
// at the child-process boundary, in backlog-consent.test.ts.
const mockFetchIssues = vi.fn((..._args: unknown[]): Promise<BacklogIssue[]> => Promise.resolve([]));
const mockSortBacklog = vi.fn((issues: BacklogIssue[]): BacklogIssue[] => issues);
const mockIsGhAvailable = vi.fn(() => Promise.resolve(true));

vi.mock('../src/lib/backlog', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/backlog')>()),
  fetchIssues: (...args: unknown[]) => mockFetchIssues(...args),
  sortBacklog: (issues: BacklogIssue[]) => mockSortBacklog(issues),
  isGhAvailable: () => mockIsGhAvailable(),
}));

import {
  BACKLOG_ROW,
  BacklogGroupNode,
  BacklogIssueNode,
  BacklogTreeProvider,
  formatLoadedAt,
} from '../src/views/backlog-view';
import { EpicGroupNode } from '../src/views/epic-grouping';
import type { BacklogIssue, IssueLifecycleLabel } from '../src/lib/backlog';
import type { EpicSummary } from '../src/lib/epic-manager';

// --- Helpers ---

function makeIssue(overrides: Partial<BacklogIssue> = {}): BacklogIssue {
  return {
    number: 1,
    title: 'Test issue',
    url: 'https://github.com/test/repo/issues/1',
    labels: [],
    state: 'OPEN',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lifecycleLabel: null,
    priorityLabel: null,
    wsjfScore: null,
    ...overrides,
  };
}

// =============================================================================
// BacklogGroupNode
// =============================================================================

describe('BacklogGroupNode', () => {
  it('creates an expanded group with correct label and description', () => {
    const issues = [makeIssue(), makeIssue({ number: 2 })];
    const node = new BacklogGroupNode(
      { label: 'Inbox', lifecycleLabel: 'inbox' as IssueLifecycleLabel, defaultExpanded: true },
      issues,
    );

    expect(node.label).toBe('Inbox');
    expect(node.collapsibleState).toBe(2); // Expanded
    expect(node.issues).toEqual(issues);
    expect(node.description).toBe('(2)');
    expect(node.contextValue).toBe('backlogGroup');
  });

  it('creates a collapsed group when defaultExpanded is false', () => {
    const node = new BacklogGroupNode(
      { label: 'Unlabeled', lifecycleLabel: null, defaultExpanded: false },
      [],
    );

    expect(node.collapsibleState).toBe(1); // Collapsed
    expect(node.description).toBe('(0)');
  });

  it('has accessibility information', () => {
    const node = new BacklogGroupNode(
      { label: 'Triaged', lifecycleLabel: 'triaged' as IssueLifecycleLabel, defaultExpanded: true },
      [makeIssue()],
    );

    expect(node.accessibilityInformation).toEqual({
      label: 'Triaged issues group, 1 items',
      role: 'treeitem',
    });
  });
});

// =============================================================================
// BacklogIssueNode
// =============================================================================

describe('BacklogIssueNode', () => {
  it('constructs with basic issue data', () => {
    const issue = makeIssue({ number: 42, title: 'Fix bug' });
    const node = new BacklogIssueNode(issue);

    expect(node.label).toBe('#42: Fix bug');
    expect(node.collapsibleState).toBe(0); // None
    expect(node.contextValue).toBe('backlogIssueNode');
    expect(node.issue).toBe(issue);
  });

  it('shows priority and WSJF in description', () => {
    const issue = makeIssue({ priorityLabel: 'P1', wsjfScore: 42 });
    const node = new BacklogIssueNode(issue);

    expect(node.description).toBe('P1 · WSJF:42');
  });

  it('shows priority only when no WSJF score', () => {
    const issue = makeIssue({ priorityLabel: 'P2' });
    const node = new BacklogIssueNode(issue);

    expect(node.description).toBe('P2');
  });

  it('shows WSJF only when no priority', () => {
    const issue = makeIssue({ wsjfScore: 10 });
    const node = new BacklogIssueNode(issue);

    expect(node.description).toBe('WSJF:10');
  });

  it('has undefined description when no priority or WSJF', () => {
    const issue = makeIssue();
    const node = new BacklogIssueNode(issue);

    expect(node.description).toBeUndefined();
  });

  it('uses sync icon for wip lifecycle', () => {
    const issue = makeIssue({ lifecycleLabel: 'wip' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('sync');
  });

  it('uses robot icon for agent-ready lifecycle', () => {
    const issue = makeIssue({ lifecycleLabel: 'agent-ready' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('robot');
  });

  it('uses flame icon for P1 priority', () => {
    const issue = makeIssue({ priorityLabel: 'P1' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('flame');
  });

  it('uses arrow-up icon for P2 priority', () => {
    const issue = makeIssue({ priorityLabel: 'P2' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('arrow-up');
  });

  it('uses arrow-down icon for P3 priority', () => {
    const issue = makeIssue({ priorityLabel: 'P3' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('arrow-down');
  });

  it('uses checklist icon for triaged lifecycle', () => {
    const issue = makeIssue({ lifecycleLabel: 'triaged' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('checklist');
  });

  it('uses inbox icon for inbox lifecycle', () => {
    const issue = makeIssue({ lifecycleLabel: 'inbox' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('inbox');
  });

  it('uses issue-opened icon for unlabeled issues', () => {
    const issue = makeIssue();
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('issue-opened');
  });

  it('uses check icon for done lifecycle', () => {
    const issue = makeIssue({ lifecycleLabel: 'done' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('check');
  });

  it('lifecycle label takes precedence over priority for icon (wip > P1)', () => {
    const issue = makeIssue({ lifecycleLabel: 'wip', priorityLabel: 'P1' });
    const node = new BacklogIssueNode(issue);

    expect((node.iconPath as { id: string }).id).toBe('sync');
  });

  it('has command to open issue URL', () => {
    const issue = makeIssue({ url: 'https://github.com/test/repo/issues/42' });
    const node = new BacklogIssueNode(issue);

    expect((node.command as { command: string }).command).toBe('vscode.open');
  });

  it('builds tooltip with all available info', () => {
    const issue = makeIssue({
      number: 5,
      title: 'Add auth',
      state: 'OPEN',
      lifecycleLabel: 'triaged',
      priorityLabel: 'P1',
      wsjfScore: 30,
      labels: ['feat', 'triaged', 'P1'],
    });
    const node = new BacklogIssueNode(issue);
    const tooltip = node.tooltip as string;

    expect(tooltip).toContain('#5: Add auth');
    expect(tooltip).toContain('State: OPEN');
    expect(tooltip).toContain('Lifecycle: triaged');
    expect(tooltip).toContain('Priority: P1');
    expect(tooltip).toContain('WSJF: 30');
    expect(tooltip).toContain('Labels: feat, triaged, P1');
  });

  it('omits lifecycle/priority/wsjf from tooltip when absent', () => {
    const issue = makeIssue({ number: 1, title: 'Basic', labels: [] });
    const node = new BacklogIssueNode(issue);
    const tooltip = node.tooltip as string;

    expect(tooltip).toContain('#1: Basic');
    expect(tooltip).toContain('State: OPEN');
    expect(tooltip).not.toContain('Lifecycle:');
    expect(tooltip).not.toContain('Priority:');
    expect(tooltip).not.toContain('WSJF:');
    expect(tooltip).not.toContain('Labels:');
  });

  it('has accessibility information', () => {
    const issue = makeIssue({ number: 3, title: 'Fix', priorityLabel: 'P2', lifecycleLabel: 'inbox' });
    const node = new BacklogIssueNode(issue);

    expect(node.accessibilityInformation).toEqual({
      label: 'Issue 3: Fix, priority P2, inbox',
      role: 'treeitem',
    });
  });
});

// =============================================================================
// BacklogTreeProvider
// =============================================================================

describe('BacklogTreeProvider', () => {
  let provider: BacklogTreeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BacklogTreeProvider('/tmp/test');
  });

  it('constructs with a workspace root', () => {
    expect(provider).toBeDefined();
  });

  it('refresh() fires the event emitter', () => {
    provider.refresh();
    expect((provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire).toHaveBeenCalled();
  });

  it('refreshIfStale() fires when no prior refresh has happened', () => {
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire;
    provider.refreshIfStale();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('refreshIfStale() skips when recent refresh is fresher than maxAgeMs', () => {
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire;
    provider.refresh();
    fire.mockClear();
    provider.refreshIfStale(30_000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('refreshIfStale() fires again once cache exceeds maxAgeMs', () => {
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire;
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      provider.refresh();
      fire.mockClear();
      now += 60_000;
      provider.refreshIfStale(30_000);
      expect(fire).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalNow;
    }
  });

  it('getTreeItem returns the element itself', () => {
    const issue = makeIssue();
    const node = new BacklogIssueNode(issue);
    expect(provider.getTreeItem(node)).toBe(node);
  });

  it('getChildren returns message when workspace root is empty', async () => {
    const emptyProvider = new BacklogTreeProvider('');
    const children = await emptyProvider.getChildren();

    expect(children).toHaveLength(1);
    expect((children[0] as { label: string }).label).toBe('No workspace folder open');
  });

  it('getChildren returns issue nodes when element is a group', async () => {
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 })];
    const group = new BacklogGroupNode(
      { label: 'Inbox', lifecycleLabel: 'inbox' as IssueLifecycleLabel, defaultExpanded: true },
      issues,
    );

    const children = await provider.getChildren(group);

    expect(children).toHaveLength(2);
    expect(children[0]).toBeInstanceOf(BacklogIssueNode);
    expect(children[1]).toBeInstanceOf(BacklogIssueNode);
  });

  it('getChildren returns empty for leaf nodes (BacklogIssueNode)', async () => {
    const node = new BacklogIssueNode(makeIssue());
    const children = await provider.getChildren(node);

    expect(children).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Root rendering (SPEC-085). A render draws the state the provider holds; only
  // the gesture - refresh({ contactGitHub: true }) - fetches.
  // ---------------------------------------------------------------------------

  describe('root rendering', () => {
    interface Row {
      label: string;
      description?: string;
      contextValue?: string;
      tooltip?: string;
      iconPath?: { id: string };
      command?: { command: string; title: string };
      accessibilityInformation?: { label: string; role?: string };
    }

    const fire = (): ReturnType<typeof vi.fn> =>
      (provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire;

    const rows = async (): Promise<Row[]> => (await provider.getChildren()) as unknown as Row[];

    const gesture = (): Promise<void> => provider.refresh({ contactGitHub: true });

    /** A promise the test settles by hand, to hold a fetch in flight. */
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    beforeEach(() => {
      mockFetchIssues.mockReset();
      mockFetchIssues.mockResolvedValue([]);
      mockSortBacklog.mockReset();
      mockSortBacklog.mockImplementation(issues => issues);
      mockIsGhAvailable.mockReset();
      mockIsGhAvailable.mockResolvedValue(true);
    });

    // ----- not loaded ---------------------------------------------------------

    it('before a gesture, shows the single not-loaded row and fetches nothing', async () => {
      const children = await rows();

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe(BACKLOG_ROW.notLoaded);
      expect(children[0].label).toBe('Backlog not loaded');
      expect(mockFetchIssues).not.toHaveBeenCalled();
      expect(mockIsGhAvailable).not.toHaveBeenCalled();
    });

    it('the not-loaded row names GitHub and gh, and runs the Refresh Backlog command', async () => {
      const [row] = await rows();

      expect(row.description).toBe("Select to list this repository's issues from GitHub using your gh CLI");
      expect(row.command?.command).toBe('minspec.refreshBacklog');
      // The tooltip names the command by its palette title, so the keyboard route is discoverable.
      expect(row.tooltip).toContain('MinSpec: Refresh Backlog (contacts GitHub through your gh CLI)');
      expect(row.iconPath?.id).toBe('cloud-download');
      expect(row.accessibilityInformation?.label).toBe(
        "Backlog not loaded. Select to list this repository's issues from GitHub using your gh CLI",
      );
    });

    it('re-rendering, refresh() and refreshIfStale() never fetch', async () => {
      await rows();
      await provider.refresh();
      provider.refreshIfStale(0);
      const children = await rows();

      expect(children[0].contextValue).toBe(BACKLOG_ROW.notLoaded);
      expect(mockFetchIssues).not.toHaveBeenCalled();
    });

    // ----- the gesture --------------------------------------------------------

    it('the gesture fetches open issues for the workspace root, once', async () => {
      await gesture();

      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
      expect(mockFetchIssues).toHaveBeenCalledWith('/tmp/test', { state: 'open' });
    });

    it('the gesture runs no gh availability probe (DQ-2)', async () => {
      await gesture();
      await rows();

      expect(mockIsGhAvailable).not.toHaveBeenCalled();
    });

    it('only contactGitHub: true is a gesture', async () => {
      await provider.refresh({});
      await provider.refresh({ contactGitHub: false });
      await provider.refresh(undefined);

      expect(mockFetchIssues).not.toHaveBeenCalled();
    });

    it('a gesture with no workspace root fetches nothing', async () => {
      const noRoot = new BacklogTreeProvider('');

      await noRoot.refresh({ contactGitHub: true });

      expect(mockFetchIssues).not.toHaveBeenCalled();
      expect(((await noRoot.getChildren()) as unknown as Row[])[0].label).toBe('No workspace folder open');
    });

    it('shows a loading row while the fetch is in flight, and fires a change before and after', async () => {
      const pending = deferred<BacklogIssue[]>();
      mockFetchIssues.mockReturnValue(pending.promise);
      fire().mockClear();

      const inFlight = gesture();

      expect(fire()).toHaveBeenCalledTimes(1);
      const during = await rows();
      expect(during).toHaveLength(1);
      expect(during[0].contextValue).toBe(BACKLOG_ROW.loading);
      expect(during[0].label).toBe('Loading issues from GitHub...');

      pending.resolve([makeIssue({ number: 1, lifecycleLabel: 'inbox' })]);
      await inFlight;

      expect(fire()).toHaveBeenCalledTimes(2);
      expect((await rows())[0].contextValue).toBe(BACKLOG_ROW.loadedAt);
    });

    it('a second gesture while one is in flight joins it instead of fetching again', async () => {
      const pending = deferred<BacklogIssue[]>();
      mockFetchIssues.mockReturnValue(pending.promise);

      const first = gesture();
      const second = gesture();
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);

      pending.resolve([]);
      await Promise.all([first, second]);
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);

      // Once it has settled, a new gesture is a new fetch.
      await gesture();
      expect(mockFetchIssues).toHaveBeenCalledTimes(2);
    });

    // ----- loaded -------------------------------------------------------------

    it('loaded: the loaded-at row comes first, then the issues grouped by lifecycle label', async () => {
      const issues = [
        makeIssue({ number: 1, lifecycleLabel: 'inbox' }),
        makeIssue({ number: 2, lifecycleLabel: 'inbox' }),
        makeIssue({ number: 3, lifecycleLabel: 'triaged' }),
        makeIssue({ number: 4, lifecycleLabel: null }),
      ];
      mockFetchIssues.mockResolvedValue(issues);

      await gesture();
      const children = await provider.getChildren();

      expect((children[0] as unknown as Row).contextValue).toBe(BACKLOG_ROW.loadedAt);
      // Inbox (2), Triaged (1), Unlabeled (1); empty groups are left out.
      const groups = children.slice(1) as BacklogGroupNode[];
      expect(groups.map(g => g.label)).toEqual(['Inbox', 'Triaged', 'Unlabeled']);
      expect(groups.map(g => g.issues.length)).toEqual([2, 1, 1]);
    });

    it('loaded: an open issue labelled done lands in "Done, still open", not dropped (#2460)', async () => {
      const issues = [
        makeIssue({ number: 1, lifecycleLabel: 'inbox' }),
        makeIssue({ number: 2, lifecycleLabel: 'done', state: 'OPEN' }),
      ];
      mockFetchIssues.mockResolvedValue(issues);

      await gesture();
      const children = await provider.getChildren();

      // Before #2460's fix the done-labelled issue matched no group, and the pane showed
      // Inbox alone with issue 2 dropped. The loaded-at row comes first; the groups follow.
      const groups = children.slice(1) as BacklogGroupNode[];
      expect(groups.map(g => g.label)).toEqual(['Inbox', 'Done, still open']);

      const doneGroup = groups.find(g => g.label === 'Done, still open');
      expect(doneGroup?.issues.map(i => i.number)).toEqual([2]);
      // Collapsed by default: a rare state that should not compete with the active groups.
      expect(doneGroup?.collapsibleState).toBe(1); // Collapsed
    });

    it('loaded: issues are sorted with sortBacklog before they are grouped', async () => {
      const fetched = [makeIssue({ number: 1, lifecycleLabel: 'wip' }), makeIssue({ number: 2, lifecycleLabel: 'wip' })];
      mockFetchIssues.mockResolvedValue(fetched);
      mockSortBacklog.mockImplementation(issues => [...issues].reverse());

      await gesture();
      const children = await provider.getChildren();

      expect(mockSortBacklog).toHaveBeenCalledWith(fetched);
      const group = children[1] as BacklogGroupNode;
      expect(group.label).toBe('Work in Progress');
      expect(group.issues.map(i => i.number)).toEqual([2, 1]);
    });

    it('loaded: the loaded-at row says when, that it does not refresh itself, and how to reload', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date(2026, 0, 5, 9, 7, 59));
        mockFetchIssues.mockResolvedValue([makeIssue({ lifecycleLabel: 'inbox' })]);

        await gesture();
        const [marker] = await rows();

        expect(marker.label).toBe('Loaded 2026-01-05 09:07');
        expect(marker.description).toBe('not refreshed automatically');
        expect(marker.tooltip).toContain('MinSpec: Refresh Backlog (contacts GitHub through your gh CLI)');
        // Not a gesture: FR-2 names exactly two, and this row is neither.
        expect(marker.command).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('loaded: later renders and refresh() reuse the held list and keep it', async () => {
      const issues = [makeIssue({ number: 1, lifecycleLabel: 'inbox' })];
      mockFetchIssues.mockResolvedValue(issues);
      await gesture();
      const first = await provider.getChildren();

      await provider.getChildren();
      await provider.refresh();
      provider.refreshIfStale(0);
      const later = await provider.getChildren();

      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
      expect((later[1] as BacklogGroupNode).issues).toEqual((first[1] as BacklogGroupNode).issues);
    });

    it('loaded: a new gesture replaces the held list', async () => {
      mockFetchIssues.mockResolvedValueOnce([makeIssue({ number: 1, lifecycleLabel: 'inbox' })]);
      await gesture();
      mockFetchIssues.mockResolvedValueOnce([makeIssue({ number: 9, lifecycleLabel: 'triaged' })]);
      await gesture();

      const children = await provider.getChildren();
      const groups = children.slice(1) as BacklogGroupNode[];
      expect(groups.map(g => g.label)).toEqual(['Triaged']);
      expect(groups[0].issues.map(i => i.number)).toEqual([9]);
    });

    it('loaded: refresh() re-draws the held issues under the current grouping without fetching', async () => {
      const epic: EpicSummary = {
        id: 'EPIC-001',
        slug: 'consent',
        title: 'Consent',
        status: 'active',
        order: 1,
        filePath: '/tmp/test/docs/epics/EPIC-001-consent.md',
      };
      const grouped = new BacklogTreeProvider('/tmp/test', () => [epic]);
      mockFetchIssues.mockResolvedValue([
        makeIssue({ number: 1, lifecycleLabel: 'inbox', labels: ['inbox', 'epic:consent'] }),
        makeIssue({ number: 2, lifecycleLabel: 'triaged', labels: ['triaged'] }),
      ]);
      await grouped.refresh({ contactGitHub: true });

      // Grouping is on by default: epic groups, read from the (injected) local epic list.
      const byEpic = await grouped.getChildren();
      expect(byEpic.slice(1).every(node => node instanceof EpicGroupNode)).toBe(true);

      // The toggle flips the flag and calls refresh(): same issues, lifecycle groups, no fetch.
      grouped.epicGrouping.set(false);
      await grouped.refresh();
      const byLifecycle = await grouped.getChildren();

      expect(byLifecycle.slice(1).every(node => node instanceof BacklogGroupNode)).toBe(true);
      expect((byLifecycle.slice(1) as BacklogGroupNode[]).flatMap(g => g.issues.map(i => i.number)).sort()).toEqual([1, 2]);
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
    });

    // ----- loaded, zero issues ------------------------------------------------

    it('zero issues: the loaded-at row, then "No open issues found", and no refetch on the next render', async () => {
      mockFetchIssues.mockResolvedValue([]);

      await gesture();
      const first = await rows();
      const second = await rows();

      expect(first.map(r => r.contextValue)).toEqual([BACKLOG_ROW.loadedAt, BACKLOG_ROW.empty]);
      expect(first[1].label).toBe('No open issues found');
      expect(second.map(r => r.label)).toEqual(first.map(r => r.label));
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
    });

    // ----- could not load -----------------------------------------------------

    it('failure: shows the reason, and never the zero-issue row (#2247)', async () => {
      mockFetchIssues.mockRejectedValue(new Error('gh command timed out'));

      await gesture();
      const children = await rows();

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe(BACKLOG_ROW.failed);
      expect(children[0].label).toBe('Could not load issues: gh command timed out');
      expect(children[0].label).not.toBe('No open issues found');
      expect(children[0].tooltip).toContain('Nothing is retried automatically');
      expect(children[0].command).toBeUndefined();
    });

    it('failure: a rejection that is not an Error is shown as its text', async () => {
      mockFetchIssues.mockRejectedValue('plain string reason');

      await gesture();

      expect((await rows())[0].label).toBe('Could not load issues: plain string reason');
    });

    it('failure: a reason that spans lines is one line in the row and whole in the tooltip', async () => {
      const reason = 'gh issue list failed: Command failed: gh issue list\nno git remotes found\n';
      mockFetchIssues.mockRejectedValue(new Error(reason));

      await gesture();
      const [row] = await rows();

      expect(row.label).toBe('Could not load issues: gh issue list failed: Command failed: gh issue list no git remotes found');
      expect(row.tooltip).toContain('Command failed: gh issue list\nno git remotes found');
    });

    it('failure: an empty reason still reads as a failure, not as a blank row', async () => {
      mockFetchIssues.mockRejectedValue('');

      await gesture();
      const [row] = await rows();

      expect(row.contextValue).toBe(BACKLOG_ROW.failed);
      expect(row.label).toBe('Could not load issues: no reason was reported');
    });

    it('failure: later renders and ambient triggers keep the failure and do not retry', async () => {
      mockFetchIssues.mockRejectedValue(new Error('network unreachable'));
      await gesture();

      await rows();
      await provider.refresh();
      provider.refreshIfStale(0);
      const children = await rows();

      expect(children[0].contextValue).toBe(BACKLOG_ROW.failed);
      expect(mockFetchIssues).toHaveBeenCalledTimes(1);
    });

    it('failure then success: a new gesture clears the failure', async () => {
      mockFetchIssues.mockRejectedValueOnce(new Error('network unreachable'));
      await gesture();
      mockFetchIssues.mockResolvedValueOnce([makeIssue({ number: 7, lifecycleLabel: 'inbox' })]);
      await gesture();

      const children = await rows();
      expect(children.map(r => r.contextValue)).not.toContain(BACKLOG_ROW.failed);
      expect(children[0].contextValue).toBe(BACKLOG_ROW.loadedAt);
    });

    it('the status rows have pairwise different context values', () => {
      const values = Object.values(BACKLOG_ROW);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});

// =============================================================================
// formatLoadedAt
// =============================================================================

describe('formatLoadedAt', () => {
  it('formats local time as YYYY-MM-DD HH:MM', () => {
    expect(formatLoadedAt(new Date(2026, 9, 2, 14, 2, 30))).toBe('2026-10-02 14:02');
  });

  it('zero-pads month, day, hour and minute', () => {
    expect(formatLoadedAt(new Date(2026, 0, 5, 9, 7, 0))).toBe('2026-01-05 09:07');
  });

  it('handles midnight and the last minute of the year', () => {
    expect(formatLoadedAt(new Date(2027, 0, 1, 0, 0, 0))).toBe('2027-01-01 00:00');
    expect(formatLoadedAt(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59');
  });
});
