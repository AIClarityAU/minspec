import { describe, it, expect, vi } from 'vitest';

/**
 * T3 regression — AIClarityAU/minspec#549. In a multi-root workspace the Specs
 * and Decisions tree views only ever scanned ONE folder: both providers were
 * built with a single `workspaceRoot` string (resolveTargetFolderNonInteractive
 * picks exactly one folder) and `getChildren` read only that root, so specs/DRs
 * living in every OTHER workspace folder were invisible — the whole point of a
 * combined workspace (Scrooge + SealBox + MinSpec) was defeated.
 *
 * The fix aggregates across `vscode.workspace.workspaceFolders`: in multi-root
 * mode each folder gets its own top-level group whose children are that folder's
 * normal rollup/status/epic groups (grouping stays per-folder so epic ids from
 * different products never collide). Single-root mode is unchanged — covered
 * byte-identically by spec-tree-provider.test.ts / adr-tree-provider.test.ts,
 * whose vscode mocks expose no workspaceFolders and so exercise the fallback.
 *
 * These tests are deliberately structure-agnostic: they walk the tree and assert
 * that LEAF specs/DRs from BOTH folders surface. Before the fix only the primary
 * root's items appear, so the root-b assertions fail (they do not error) — a
 * genuine red test, not an import-time break on the new folder node type.
 */

// ─── vscode mock — TWO workspace folders (the crux #549 never handled) ──────────
vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: string;
    resourceUri?: unknown;
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
    constructor(id: string) {
      this.id = id;
    }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: '/tmp/root-a' } },
      { uri: { fsPath: '/tmp/root-b' } },
    ],
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

import { SpecTreeProvider, SpecNode } from '../src/views/spec-tree-provider';
import type { SpecSummary, SpecTreeNode } from '../src/views/spec-tree-provider';
import { AdrTreeProvider, AdrNode } from '../src/views/adr-tree-provider';
import type { AdrTreeNode, ListAdrsFn } from '../src/views/adr-tree-provider';
import type { AdrSummary } from '../src/lib/adr-manager';

const ROOT_A = '/tmp/root-a';
const ROOT_B = '/tmp/root-b';

function makeSpec(overrides: Partial<SpecSummary> = {}): SpecSummary {
  return {
    id: 'SPEC-001',
    title: 'Alpha',
    tier: 'T2',
    status: 'implementing',
    currentPhase: 'implement',
    filePath: '/tmp/root-a/specs/SPEC-001.md',
    phasesDone: 1,
    phasesTotal: 2,
    ...overrides,
  } as SpecSummary;
}

function makeAdr(overrides: Partial<AdrSummary> = {}): AdrSummary {
  return {
    id: 'DR-001',
    title: 'Alpha decision',
    status: 'accepted',
    date: '2026-07-06',
    filePath: '/tmp/root-a/docs/decisions/DR-001.md',
    ...overrides,
  } as AdrSummary;
}

/** Walk the whole tree and collect every SpecNode leaf, structure-agnostic. */
function allSpecNodes(p: SpecTreeProvider): SpecNode[] {
  const out: SpecNode[] = [];
  const walk = (el?: SpecTreeNode): void => {
    for (const child of p.getChildren(el)) {
      if (child instanceof SpecNode) out.push(child);
      else walk(child);
    }
  };
  walk(undefined);
  return out;
}

/** Walk the whole tree and collect every AdrNode leaf, structure-agnostic. */
function allAdrNodes(p: AdrTreeProvider): AdrNode[] {
  const out: AdrNode[] = [];
  const walk = (el?: AdrTreeNode): void => {
    for (const child of p.getChildren(el)) {
      if (child instanceof AdrNode) out.push(child);
      else walk(child);
    }
  };
  walk(undefined);
  return out;
}

// =============================================================================

describe('multi-root aggregation — Specs pane (#549)', () => {
  const specsByRoot: Record<string, SpecSummary[]> = {
    [ROOT_A]: [makeSpec({ id: 'SPEC-001', title: 'Alpha', filePath: `${ROOT_A}/specs/SPEC-001.md` })],
    [ROOT_B]: [makeSpec({ id: 'SPEC-900', title: 'Bravo', filePath: `${ROOT_B}/specs/SPEC-900.md` })],
  };
  // Seeded with root-a to mimic resolveTargetFolderNonInteractive picking one
  // folder — the live workspaceFolders must win over this seed.
  const build = () =>
    new SpecTreeProvider(
      ROOT_A,
      (root: string) => specsByRoot[root] ?? [],
      () => 'unapproved',
      () => [], // no epics → status lanes (keeps the assert about leaves simple)
    );

  it('surfaces specs from EVERY workspace folder, not just the primary root', () => {
    const ids = allSpecNodes(build()).map(n => n.spec.id);
    expect(ids).toContain('SPEC-001'); // root-a (was already visible)
    expect(ids).toContain('SPEC-900'); // root-b (invisible before #549 fix)
  });

  it('top level groups by folder name in multi-root mode', () => {
    const labels = build()
      .getChildren(undefined)
      .map(n => String((n as { label?: unknown }).label ?? ''));
    // Folder-named top-level nodes (basename), not the single-root Progress/lanes.
    expect(labels.some(l => l.includes('root-a'))).toBe(true);
    expect(labels.some(l => l.includes('root-b'))).toBe(true);
  });

  it('a spec keeps its own folder-scoped rows (root-b spec resolves under root-b)', () => {
    const bravo = allSpecNodes(build()).find(n => n.spec.id === 'SPEC-900');
    expect(bravo).toBeDefined();
    expect(bravo!.spec.filePath.startsWith(ROOT_B)).toBe(true);
  });
});

describe('multi-root aggregation — Decisions pane (#549)', () => {
  const adrsByRoot: Record<string, AdrSummary[]> = {
    [ROOT_A]: [makeAdr({ id: 'DR-001', filePath: `${ROOT_A}/docs/decisions/DR-001.md` })],
    [ROOT_B]: [makeAdr({ id: 'DR-050', filePath: `${ROOT_B}/docs/decisions/DR-050.md` })],
  };
  const build = () =>
    new AdrTreeProvider(
      ROOT_A,
      ((root: string) => adrsByRoot[root] ?? []) as ListAdrsFn,
      () => [], // no epics → status groups
    );

  it('surfaces ADRs from EVERY workspace folder, not just the primary root', () => {
    const ids = allAdrNodes(build()).map(n => n.adr.id);
    expect(ids).toContain('DR-001'); // root-a
    expect(ids).toContain('DR-050'); // root-b (invisible before #549 fix)
  });

  it('top level groups by folder name in multi-root mode', () => {
    const labels = build()
      .getChildren(undefined)
      .map(n => String((n as { label?: unknown }).label ?? ''));
    expect(labels.some(l => l.includes('root-a'))).toBe(true);
    expect(labels.some(l => l.includes('root-b'))).toBe(true);
  });
});
