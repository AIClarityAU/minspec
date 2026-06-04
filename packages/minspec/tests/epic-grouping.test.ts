/**
 * T2 — Feature Tests: epic-grouping stub decoration (#85)
 *
 * buildEpicGroups must append a `(stub)` suffix to a registered epic's badge
 * when the epic doc is still a stub (empty/placeholder Goal or Artifacts), and
 * must NOT touch the badge of a filled-in epic. Advisory only — the contextValue
 * / icon / collapsible behaviour (the blocking-relevant surface) is unchanged.
 */

import { describe, it, expect, vi } from 'vitest';

// --- Mock vscode (mirrors adr-tree-provider.test.ts) ---
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
  ThemeIcon: class {
    id: string;
    constructor(id: string) { this.id = id; }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import { buildEpicGroups } from '../src/views/epic-grouping';
import type { EpicSummary } from '../src/lib/epic-manager';

interface Item { id: string; epic?: string; done?: boolean }
const refOf = (i: Item) => i.epic;
const isTerminal = (i: Item) => i.done === true;

function epic(over: Partial<EpicSummary>): EpicSummary {
  return {
    id: 'EPIC-001', slug: 'alpha', title: 'Alpha', status: 'active',
    order: 1, filePath: '/e/EPIC-001.md', ...over,
  };
}

describe('buildEpicGroups — stub decoration (#85)', () => {
  it('appends "(stub)" to a populated stub epic\'s badge', () => {
    const epics = [epic({ isStub: true })];
    const items: Item[] = [
      { id: 'SPEC-001', epic: 'EPIC-001', done: true },
      { id: 'SPEC-002', epic: 'EPIC-001', done: false },
    ];
    const nodes = buildEpicGroups('/ws', items, refOf, isTerminal, () => epics)!;
    const node = nodes.find(n => n.epic?.id === 'EPIC-001')!;
    expect(node.description).toBe('1/2 (stub)');
  });

  it('appends "(stub)" after the status word for a member-less stub epic', () => {
    const epics = [epic({ status: 'proposed', isStub: true })];
    const nodes = buildEpicGroups('/ws', [] as Item[], refOf, isTerminal, () => epics)!;
    const node = nodes.find(n => n.epic?.id === 'EPIC-001')!;
    expect(node.description).toBe('proposed (stub)');
  });

  it('does NOT decorate a filled-in (non-stub) epic — badge unchanged', () => {
    const epics = [epic({ isStub: false })];
    const items: Item[] = [{ id: 'SPEC-001', epic: 'EPIC-001', done: true }];
    const nodes = buildEpicGroups('/ws', items, refOf, isTerminal, () => epics)!;
    const node = nodes.find(n => n.epic?.id === 'EPIC-001')!;
    expect(node.description).toBe('1/1');
    expect(String(node.description)).not.toContain('stub');
  });

  it('treats an epic with isStub undefined as non-stub (no decoration)', () => {
    const epics = [epic({})]; // isStub omitted
    const nodes = buildEpicGroups('/ws', [] as Item[], refOf, isTerminal, () => epics)!;
    const node = nodes.find(n => n.epic?.id === 'EPIC-001')!;
    expect(String(node.description)).not.toContain('stub');
  });

  it('never decorates the (no epic) bucket even when an item is unresolved', () => {
    const epics = [epic({ isStub: true })];
    const items: Item[] = [{ id: 'SPEC-009', epic: 'ghost' }]; // unresolved → NO_EPIC
    const nodes = buildEpicGroups('/ws', items, refOf, isTerminal, () => epics)!;
    const noEpic = nodes.find(n => n.epic === undefined)!;
    expect(String(noEpic.description)).not.toContain('stub');
  });

  it('stub decoration does not change contextValue (advisory, never blocking)', () => {
    const epics = [epic({ status: 'proposed', isStub: true })];
    const nodes = buildEpicGroups('/ws', [] as Item[], refOf, isTerminal, () => epics)!;
    const node = nodes.find(n => n.epic?.id === 'EPIC-001')!;
    expect(node.contextValue).toBe('epicGroup.proposed'); // unchanged by stub state
  });
});
