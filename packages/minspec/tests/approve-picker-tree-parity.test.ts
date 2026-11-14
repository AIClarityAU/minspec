/**
 * Two-surface parity for "which specs are offered for approval" (#440).
 *
 * The Specs tree and the approve QuickPick each decide, independently, whether a
 * spec still needs approving. They disagreed: the picker filtered only on
 * APPROVAL status, the tree gated on a hand-enumerated `done || archived`
 * lifecycle predicate that silently omitted `superseded`. A `done` or
 * `superseded` spec with no approval record therefore ghosted into the Alt+A
 * list while the tree showed it no approval action at all.
 *
 * T0 (invariant): the two predicates agree for EVERY status x approval pair, and
 *                 every SPEC_STATUSES member is explicitly classified terminal
 *                 or active (the asymmetry gate — a new status must be decided,
 *                 not silently default to "active").
 * T3 (regression): SPEC-007's pre-approval shape (`done`, unapproved) and
 *                 SPEC-056's shape (`superseded`, unapproved).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  TreeItem: class {
    label: string; collapsibleState: number; id?: string; description?: string;
    iconPath?: unknown; command?: unknown; contextValue?: string; tooltip?: string;
    accessibilityInformation?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label; this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); },
  ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  window: {
    showErrorMessage: vi.fn(), showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(), showQuickPick: vi.fn(),
    showTextDocument: vi.fn(), activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/ws' } }],
    openTextDocument: vi.fn(),
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/tmp/ws' } })),
    getConfiguration: () => ({ get: (_k: string, d?: unknown) => d }),
  },
  commands: { executeCommand: vi.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  SPEC_STATUSES,
  TERMINAL_SPEC_STATUSES,
  isTerminalSpecStatus,
} from '../src/lib/spec-vocabulary';
import type { SpecStatus } from '../src/lib/spec-vocabulary';
import { SpecNode } from '../src/views/spec-tree-provider';
import type { SpecSummary } from '../src/lib/spec-manager';
import type { ApprovalStatus } from '../src/lib/approval';

/** Non-terminal statuses, derived so a new status is classified by the terminal set. */
const ACTIVE_SPEC_STATUSES = SPEC_STATUSES.filter((st) => !isTerminalSpecStatus(st));

const APPROVAL_STATES: ApprovalStatus[] = ['unapproved', 'approved', 'stale'];

function makeSpec(status: SpecStatus): SpecSummary {
  return {
    id: 'SPEC-999', title: 'Fixture', tier: 'T2', status,
    currentPhase: 'specify', filePath: '/tmp/ws/specs/SPEC-999/requirements.md',
    phasesDone: 0, phasesTotal: 1,
  } as SpecSummary;
}

/**
 * The Explorer's OWN gate, read from the shipped `package.json` rather than
 * retyped — a copy here would keep passing if the contributed `when` clause
 * drifted. This is the exact regex VS Code evaluates against `viewItem`.
 */
function approveMenuRegex(): RegExp {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
  ) as { contributes: { menus: Record<string, { command: string; when: string }[]> } };
  const entry = pkg.contributes.menus['view/item/context'].find(
    (m) => m.command === 'minspec.approveSpec',
  );
  if (!entry) throw new Error('no view/item/context entry for minspec.approveSpec');
  const m = /viewItem =~ \/(.+?)\/\s*$/.exec(entry.when);
  if (!m) throw new Error(`could not extract viewItem regex from when: ${entry.when}`);
  return new RegExp(m[1]);
}

/** Does the Explorer offer "Approve Spec" on this row? Real SpecNode, real regex. */
function treeOffersApprove(status: SpecStatus, approval: ApprovalStatus): boolean {
  const node = new SpecNode(makeSpec(status), approval);
  return approveMenuRegex().test(node.contextValue!);
}

/**
 * What the approve QuickPick offers (commands/approve.ts include filter): not already
 * approved, and not terminal. The picker's predicate is an inline closure, so this
 * states its contract; approve-terminal-lifecycle.test.ts exercises the closure itself.
 */
function pickerOffers(status: SpecStatus, approval: ApprovalStatus): boolean {
  return approval !== 'approved' && !isTerminalSpecStatus(status);
}

describe('approve picker <-> Specs tree parity (#440)', () => {
  it('T0: every spec status is explicitly classified terminal or active', () => {
    const union = [...TERMINAL_SPEC_STATUSES, ...ACTIVE_SPEC_STATUSES];
    // No status may be left unclassified (the asymmetry that let `superseded`
    // default to "active" when SPEC-017 added it).
    expect([...union].sort()).toEqual([...SPEC_STATUSES].sort());
    // And none may be claimed by both sets.
    expect(new Set(union).size).toBe(union.length);
  });

  it('T0: `superseded` is terminal, like `done` and `archived`', () => {
    expect(isTerminalSpecStatus('superseded')).toBe(true);
    expect(isTerminalSpecStatus('done')).toBe(true);
    expect(isTerminalSpecStatus('archived')).toBe(true);
    expect(isTerminalSpecStatus('specifying')).toBe(false);
  });

  it('T0: picker and tree agree for every status x approval pair', () => {
    const disagreements: string[] = [];
    for (const status of SPEC_STATUSES) {
      for (const approval of APPROVAL_STATES) {
        const picker = pickerOffers(status, approval);
        const tree = treeOffersApprove(status, approval);
        if (picker !== tree) {
          disagreements.push(`${status}/${approval}: picker=${picker} tree=${tree}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('T0: no terminal spec is ever offered for approval by either surface', () => {
    for (const status of TERMINAL_SPEC_STATUSES) {
      for (const approval of APPROVAL_STATES) {
        expect(pickerOffers(status, approval)).toBe(false);
        expect(treeOffersApprove(status, approval)).toBe(false);
      }
    }
  });

  it('T3: a `done` spec with no approval record is not offered (SPEC-007)', () => {
    expect(pickerOffers('done', 'unapproved')).toBe(false);
    expect(treeOffersApprove('done', 'unapproved')).toBe(false);
  });

  it('T3: a `superseded` spec with no approval record is not offered (SPEC-056)', () => {
    expect(pickerOffers('superseded', 'unapproved')).toBe(false);
    expect(treeOffersApprove('superseded', 'unapproved')).toBe(false);
  });

  it('an active, unapproved spec IS still offered by both surfaces', () => {
    for (const status of ACTIVE_SPEC_STATUSES) {
      expect(pickerOffers(status, 'unapproved')).toBe(true);
      expect(treeOffersApprove(status, 'unapproved')).toBe(true);
      // ...and a stale one still needs re-approval.
      expect(pickerOffers(status, 'stale')).toBe(true);
      expect(treeOffersApprove(status, 'stale')).toBe(true);
      // ...while an already-approved one does not.
      expect(pickerOffers(status, 'approved')).toBe(false);
      expect(treeOffersApprove(status, 'approved')).toBe(false);
    }
  });
});
