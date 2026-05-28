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
const mockFetchIssues = vi.fn(() => Promise.resolve([]));
const mockSortBacklog = vi.fn((issues: unknown[]) => issues);
const mockIsGhAvailable = vi.fn(() => Promise.resolve(true));

vi.mock('../src/lib/backlog', () => ({
  fetchIssues: (...args: unknown[]) => mockFetchIssues(...args),
  sortBacklog: (...args: unknown[]) => mockSortBacklog(...args),
  isGhAvailable: (...args: unknown[]) => mockIsGhAvailable(...args),
}));

import { BacklogGroupNode, BacklogIssueNode, BacklogTreeProvider } from '../src/views/backlog-view';
import type { BacklogIssue, IssueLifecycleLabel, PriorityLabel } from '../src/lib/backlog';

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

  it('getChildren root: shows message when gh CLI not available', async () => {
    mockIsGhAvailable.mockResolvedValue(false);

    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect((children[0] as { label: string }).label).toBe('GitHub CLI (gh) not available or not authenticated');
  });

  it('getChildren root: shows message when no open issues found', async () => {
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockResolvedValue([]);
    mockSortBacklog.mockReturnValue([]);

    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect((children[0] as { label: string }).label).toBe('No open issues found');
  });

  it('getChildren root: groups issues by lifecycle label', async () => {
    const issues = [
      makeIssue({ number: 1, lifecycleLabel: 'inbox' }),
      makeIssue({ number: 2, lifecycleLabel: 'inbox' }),
      makeIssue({ number: 3, lifecycleLabel: 'triaged' }),
      makeIssue({ number: 4, lifecycleLabel: null }),
    ];
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockResolvedValue(issues);
    mockSortBacklog.mockReturnValue(issues);

    const children = await provider.getChildren();

    // Should have 3 groups: Inbox (2), Triaged (1), Unlabeled (1)
    expect(children).toHaveLength(3);
    const groups = children as BacklogGroupNode[];

    const inboxGroup = groups.find(g => g.label === 'Inbox');
    expect(inboxGroup?.issues).toHaveLength(2);

    const triagedGroup = groups.find(g => g.label === 'Triaged');
    expect(triagedGroup?.issues).toHaveLength(1);

    const unlabeledGroup = groups.find(g => g.label === 'Unlabeled');
    expect(unlabeledGroup?.issues).toHaveLength(1);
  });

  it('getChildren root: filters out empty groups', async () => {
    const issues = [makeIssue({ number: 1, lifecycleLabel: 'wip' })];
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockResolvedValue(issues);
    mockSortBacklog.mockReturnValue(issues);

    const children = await provider.getChildren();

    // Only WIP group should appear
    expect(children).toHaveLength(1);
    expect((children[0] as { label: string }).label).toBe('Work in Progress');
  });

  it('getChildren root: shows error message when fetch fails', async () => {
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockRejectedValue(new Error('network error'));

    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect((children[0] as { label: string }).label).toBe('Failed to fetch issues from GitHub');
  });

  it('getChildren root: uses cached issues on subsequent calls', async () => {
    const issues = [makeIssue({ number: 1, lifecycleLabel: 'inbox' })];
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockResolvedValue(issues);
    mockSortBacklog.mockReturnValue(issues);

    // First call fetches
    await provider.getChildren();
    expect(mockFetchIssues).toHaveBeenCalledTimes(1);

    // Second call uses cache
    await provider.getChildren();
    expect(mockFetchIssues).toHaveBeenCalledTimes(1);
  });

  it('getChildren root: clears cache after refresh()', async () => {
    const issues = [makeIssue({ number: 1, lifecycleLabel: 'inbox' })];
    mockIsGhAvailable.mockResolvedValue(true);
    mockFetchIssues.mockResolvedValue(issues);
    mockSortBacklog.mockReturnValue(issues);

    await provider.getChildren();
    expect(mockFetchIssues).toHaveBeenCalledTimes(1);

    provider.refresh();
    await provider.getChildren();
    expect(mockFetchIssues).toHaveBeenCalledTimes(2);
  });

  it('getChildren root: returns cached error on subsequent calls', async () => {
    mockIsGhAvailable.mockResolvedValue(false);

    const children1 = await provider.getChildren();
    const children2 = await provider.getChildren();

    // Both return the same error message
    expect((children1[0] as { label: string }).label).toBe('GitHub CLI (gh) not available or not authenticated');
    expect((children2[0] as { label: string }).label).toBe('GitHub CLI (gh) not available or not authenticated');

    // isGhAvailable only called once because error cached on first call
    expect(mockIsGhAvailable).toHaveBeenCalledTimes(1);
  });
});
