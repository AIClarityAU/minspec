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
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn((_key: string) => undefined) })),
  },
}));

import * as vscode from 'vscode';
import { AdrGroupNode, AdrNode, AdrTreeProvider } from '../src/views/adr-tree-provider';
import type { AdrSummary, AdrStatus } from '../src/lib/adr-manager';
import type { ListAdrsFn } from '../src/views/adr-tree-provider';

// --- Helpers ---

function makeAdr(overrides: Partial<AdrSummary> = {}): AdrSummary {
  return {
    id: 'DR-001',
    title: 'Use vitest for testing',
    status: 'accepted',
    date: '2026-05-20',
    filePath: '/tmp/test/docs/decisions/DR-001.md',
    ...overrides,
  };
}

// =============================================================================
// AdrGroupNode
// =============================================================================

describe('AdrGroupNode', () => {
  it('creates an expanded group with correct label and description', () => {
    const adrs = [makeAdr(), makeAdr({ id: 'DR-002' })];
    const node = new AdrGroupNode(
      { label: 'Accepted', statuses: ['accepted'], defaultExpanded: true },
      adrs,
    );

    expect(node.label).toBe('Accepted');
    expect(node.collapsibleState).toBe(2); // Expanded
    expect(node.adrs).toEqual(adrs);
    expect(node.description).toBe('(2)');
    expect(node.contextValue).toBe('adrGroup');
  });

  it('creates a collapsed group when defaultExpanded is false', () => {
    const node = new AdrGroupNode(
      { label: 'Deprecated / Superseded', statuses: ['deprecated', 'superseded'], defaultExpanded: false },
      [],
    );

    expect(node.collapsibleState).toBe(1); // Collapsed
    expect(node.description).toBe('(0)');
  });

  it('has accessibility information', () => {
    const adrs = [makeAdr()];
    const node = new AdrGroupNode(
      { label: 'Proposed', statuses: ['proposed'], defaultExpanded: true },
      adrs,
    );

    expect(node.accessibilityInformation).toEqual({
      label: 'Proposed decisions group, 1 items',
      role: 'treeitem',
    });
  });
});

// =============================================================================
// AdrNode
// =============================================================================

describe('AdrNode', () => {
  it('constructs with basic ADR data', () => {
    const adr = makeAdr({ id: 'DR-005', title: 'Use monorepo' });
    const node = new AdrNode(adr);

    expect(node.label).toBe('DR-005: Use monorepo');
    expect(node.collapsibleState).toBe(0); // None
    expect(node.description).toBe('2026-05-20');
    expect(node.contextValue).toBe('adrNode.accepted');
    expect(node.adr).toBe(adr);
  });

  it('suffixes contextValue with status to gate menus', () => {
    expect(new AdrNode(makeAdr({ status: 'proposed' })).contextValue).toBe('adrNode.proposed');
    expect(new AdrNode(makeAdr({ status: 'superseded' })).contextValue).toBe('adrNode.superseded');
  });

  it('has command to open ADR file', () => {
    const adr = makeAdr({ filePath: '/tmp/test/docs/DR-001.md' });
    const node = new AdrNode(adr);

    expect((node.command as { command: string }).command).toBe('vscode.open');
    expect((node.command as { title: string }).title).toBe('Open ADR');
  });

  it('uses question icon for proposed status', () => {
    const adr = makeAdr({ status: 'proposed' });
    const node = new AdrNode(adr);

    expect((node.iconPath as { id: string }).id).toBe('question');
  });

  it('uses check icon for accepted status', () => {
    const adr = makeAdr({ status: 'accepted' });
    const node = new AdrNode(adr);

    expect((node.iconPath as { id: string }).id).toBe('check');
  });

  it('uses warning icon for deprecated status', () => {
    const adr = makeAdr({ status: 'deprecated' });
    const node = new AdrNode(adr);

    expect((node.iconPath as { id: string }).id).toBe('warning');
  });

  it('uses arrow-swap icon for superseded status', () => {
    const adr = makeAdr({ status: 'superseded' });
    const node = new AdrNode(adr);

    expect((node.iconPath as { id: string }).id).toBe('arrow-swap');
  });

  it('builds tooltip with id, title, status, and date', () => {
    const adr = makeAdr({ id: 'DR-003', title: 'API design', status: 'proposed', date: '2026-01-15' });
    const node = new AdrNode(adr);

    expect(node.tooltip).toBe('DR-003: API design\nStatus: proposed\nDate: 2026-01-15');
  });

  it('has accessibility information', () => {
    const adr = makeAdr({ id: 'DR-010', title: 'Auth flow', status: 'accepted', date: '2026-03-01' });
    const node = new AdrNode(adr);

    expect(node.accessibilityInformation).toEqual({
      label: 'DR-010: Auth flow, status accepted, date 2026-03-01',
      role: 'treeitem',
    });
  });
});

// =============================================================================
// AdrTreeProvider
// =============================================================================

describe('AdrTreeProvider', () => {
  let mockListAdrs: ReturnType<typeof vi.fn>;
  let provider: AdrTreeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdrs = vi.fn(() => []);
    provider = new AdrTreeProvider('/tmp/test', mockListAdrs as ListAdrsFn);
  });

  it('constructs with workspace root and optional listAdrsFn', () => {
    expect(provider).toBeDefined();
  });

  it('refresh() fires the event emitter', () => {
    provider.refresh();
    expect((provider as unknown as { _onDidChangeTreeData: { fire: ReturnType<typeof vi.fn> } })._onDidChangeTreeData.fire).toHaveBeenCalled();
  });

  it('getTreeItem returns the element itself', () => {
    const adr = makeAdr();
    const node = new AdrNode(adr);
    expect(provider.getTreeItem(node)).toBe(node);
  });

  it('getChildren returns empty when workspace root is empty', () => {
    const emptyProvider = new AdrTreeProvider('', mockListAdrs as ListAdrsFn);
    const children = emptyProvider.getChildren();

    expect(children).toEqual([]);
  });

  it('getChildren returns status groups at root level', () => {
    mockListAdrs.mockReturnValue([
      makeAdr({ id: 'DR-001', status: 'proposed' }),
      makeAdr({ id: 'DR-002', status: 'accepted' }),
      makeAdr({ id: 'DR-003', status: 'deprecated' }),
    ]);

    const children = provider.getChildren();

    // All 3 groups should be returned (Proposed, Accepted, Deprecated/Superseded)
    expect(children).toHaveLength(3);
    const labels = children.map(c => (c as { label: string }).label);
    expect(labels).toContain('Proposed');
    expect(labels).toContain('Accepted');
    expect(labels).toContain('Deprecated / Superseded');
  });

  it('getChildren returns AdrNode children for a group element', () => {
    const adrs = [makeAdr({ id: 'DR-001' }), makeAdr({ id: 'DR-002' })];
    const group = new AdrGroupNode(
      { label: 'Accepted', statuses: ['accepted'], defaultExpanded: true },
      adrs,
    );

    const children = provider.getChildren(group);

    expect(children).toHaveLength(2);
    expect(children[0]).toBeInstanceOf(AdrNode);
    expect(children[1]).toBeInstanceOf(AdrNode);
  });

  it('getChildren returns empty for AdrNode (leaf)', () => {
    const node = new AdrNode(makeAdr());
    const children = provider.getChildren(node);

    expect(children).toEqual([]);
  });

  it('groups ADRs correctly by status', () => {
    mockListAdrs.mockReturnValue([
      makeAdr({ id: 'DR-001', status: 'proposed' }),
      makeAdr({ id: 'DR-002', status: 'proposed' }),
      makeAdr({ id: 'DR-003', status: 'accepted' }),
    ]);

    const children = provider.getChildren() as AdrGroupNode[];

    const proposedGroup = children.find(g => g.label === 'Proposed');
    expect(proposedGroup?.adrs).toHaveLength(2);

    const acceptedGroup = children.find(g => g.label === 'Accepted');
    expect(acceptedGroup?.adrs).toHaveLength(1);

    // Deprecated/Superseded group still returned (with 0 items from STATUS_GROUPS)
    const depGroup = children.find(g => g.label === 'Deprecated / Superseded');
    expect(depGroup?.adrs).toHaveLength(0);
  });

  it('groups both deprecated and superseded into the same group', () => {
    mockListAdrs.mockReturnValue([
      makeAdr({ id: 'DR-001', status: 'deprecated' }),
      makeAdr({ id: 'DR-002', status: 'superseded' }),
    ]);

    const children = provider.getChildren() as AdrGroupNode[];

    const depGroup = children.find(g => g.label === 'Deprecated / Superseded');
    expect(depGroup?.adrs).toHaveLength(2);
  });

  it('passes decisionsDir config to listAdrs', () => {
    const mockGet = vi.fn((_key: string) => 'custom-decisions');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: mockGet } as unknown as vscode.WorkspaceConfiguration);

    provider.getChildren();

    expect(mockListAdrs).toHaveBeenCalledWith('/tmp/test', { decisionsDir: 'custom-decisions' });
  });

  it('passes undefined overrides when no decisionsDir configured', () => {
    const mockGet = vi.fn((_key: string) => undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: mockGet } as unknown as vscode.WorkspaceConfiguration);

    provider.getChildren();

    expect(mockListAdrs).toHaveBeenCalledWith('/tmp/test', undefined);
  });

  it('returns all groups even when some have zero ADRs', () => {
    mockListAdrs.mockReturnValue([
      makeAdr({ id: 'DR-001', status: 'accepted' }),
    ]);

    const children = provider.getChildren() as AdrGroupNode[];

    // All 3 groups are returned, even empty ones
    expect(children).toHaveLength(3);
    const proposedGroup = children.find(g => g.label === 'Proposed');
    expect(proposedGroup?.adrs).toHaveLength(0);
  });
});
