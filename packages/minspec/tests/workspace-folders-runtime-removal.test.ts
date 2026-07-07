import { describe, it, expect, vi } from 'vitest';

/**
 * T3 regression — AIClarityAU/minspec#574 (non-blocking finding from the #549
 * ai-review, PR #572). `roots()` in SpecTreeProvider / AdrTreeProvider used
 * `allWorkspaceRoots().length > 0 ? live : ctorFallback`, which cannot tell
 * "the workspace API has no folder list at all" (unit-test mocks / activation
 * races — the ctor seed IS the right answer) apart from "the API is live and
 * genuinely reports zero folders" (every folder removed at runtime — an empty
 * tree is the right answer). Both collapsed to the same `live.length === 0`
 * branch, so removing the last live folder briefly re-rendered the REMOVED
 * folder's stale specs/DRs from the ctor-seeded root instead of an empty tree.
 *
 * The fix: `allWorkspaceRoots()` returns `undefined` for "no API" and `[]` for
 * "API live, zero folders" — see lib/resolve-folder.ts. This test mutates
 * `vscode.workspace.workspaceFolders` from a live single-folder array down to
 * `[]` (mirroring `onDidChangeWorkspaceFolders` removing the last folder) and
 * asserts the tree goes empty rather than falling back to the ctor root.
 */

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
    constructor(id: string) {
      this.id = id;
    }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/root-a' } }],
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

import * as vscode from 'vscode';
import { allWorkspaceRoots } from '../src/lib/resolve-folder';
import { SpecTreeProvider, SpecNode } from '../src/views/spec-tree-provider';
import type { SpecSummary, SpecTreeNode } from '../src/views/spec-tree-provider';
import { AdrTreeProvider, AdrNode } from '../src/views/adr-tree-provider';
import type { AdrTreeNode } from '../src/views/adr-tree-provider';
import type { AdrSummary } from '../src/lib/adr-manager';

const ROOT_A = '/tmp/root-a';

type MutableWorkspace = { workspaceFolders: { uri: { fsPath: string } }[] | undefined };

function setLiveFolders(...paths: string[]): void {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = paths.map(p => ({ uri: { fsPath: p } }));
}
function setNoWorkspaceApi(): void {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = undefined;
}

function makeSpec(overrides: Partial<SpecSummary> = {}): SpecSummary {
  return {
    id: 'SPEC-001',
    title: 'Alpha',
    tier: 'T2',
    status: 'implementing',
    currentPhase: 'implement',
    filePath: `${ROOT_A}/specs/SPEC-001.md`,
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
    filePath: `${ROOT_A}/docs/decisions/DR-001.md`,
    ...overrides,
  } as AdrSummary;
}

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

describe('allWorkspaceRoots() distinguishes "no API" from "API live, zero folders" (#574)', () => {
  it('returns undefined when the live API exposes no folder list at all', () => {
    setNoWorkspaceApi();
    expect(allWorkspaceRoots()).toBeUndefined();
  });

  it('returns [] when the live API is present and genuinely reports zero folders', () => {
    setLiveFolders();
    expect(allWorkspaceRoots()).toEqual([]);
  });

  it('returns the live folder list when non-empty', () => {
    setLiveFolders(ROOT_A);
    expect(allWorkspaceRoots()).toEqual([ROOT_A]);
  });
});

describe('SpecTreeProvider.roots() empties out, not falls back, when the last live folder is removed (#574)', () => {
  it('renders an empty tree once workspaceFolders drops to [], never the stale ctor root', () => {
    setLiveFolders(ROOT_A);
    const provider = new SpecTreeProvider(
      ROOT_A,
      (root: string) => (root === ROOT_A ? [makeSpec()] : []),
      () => 'unapproved',
      () => [],
    );
    // Sanity: with a live folder present, the ctor root's spec renders.
    expect(allSpecNodes(provider).map(n => n.spec.id)).toContain('SPEC-001');

    // The last folder is removed at runtime — the live API now reports [].
    setLiveFolders();
    expect(allSpecNodes(provider)).toEqual([]);
  });
});

describe('AdrTreeProvider.roots() empties out, not falls back, when the last live folder is removed (#574)', () => {
  it('renders an empty tree once workspaceFolders drops to [], never the stale ctor root', () => {
    setLiveFolders(ROOT_A);
    const provider = new AdrTreeProvider(
      ROOT_A,
      (root: string) => (root === ROOT_A ? [makeAdr()] : []),
      () => [],
    );
    expect(allAdrNodes(provider).map(n => n.adr.id)).toContain('DR-001');

    setLiveFolders();
    expect(allAdrNodes(provider)).toEqual([]);
  });
});
