import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Terminal-lifecycle agreement between the approve picker and the Specs tree
 * (issue #440 — "Alt+A approve picker offers terminal (done/archived) specs;
 * tree excludes them").
 *
 * The bug: "is this spec awaiting approval?" was answered in three places by
 * two different predicates. `commands/approve.ts` (`pickSpec`) and
 * `commands/approve-active.ts` (`isPending`) tested only the APPROVAL status
 * (`!== 'approved'`); `views/spec-tree-provider.ts` also tested the LIFECYCLE
 * status (its `terminal` predicate). A `done`/`archived`/`superseded` spec with
 * no approval record was therefore offered by both pickers while the tree
 * refused to expose any approve action on it.
 *
 * Measured live: SPEC-007 (`status: done`) was offered and got approved; SPEC-056
 * (`status: superseded`, a spec whose own body says it "should not be planned or
 * implemented") was still being offered.
 *
 * Tier: T0 for the all-statuses agreement invariant, T3 for the two reproductions.
 */

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/ws' } }],
    openTextDocument: vi.fn(),
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/tmp/ws' } })),
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })),
  },
  commands: { executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: string;
    id?: string;
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
}));

vi.mock('../src/lib/spec-catalog', () => ({ listSpecs: vi.fn() }));

vi.mock('../src/lib/approval', () => ({
  approveSpec: vi.fn(),
  revokeApproval: vi.fn(() => true),
  getApprovalStatus: vi.fn(() => 'unapproved'),
  gitConfigEmail: vi.fn(() => 'tester@example.com'),
}));

import * as vscode from 'vscode';
import { approveSpecCommand, revokeApprovalCommand } from '../src/commands/approve';
import { listSpecs } from '../src/lib/spec-catalog';
import { getApprovalStatus } from '../src/lib/approval';
import type { ApprovalStatus } from '../src/lib/approval';
import { SpecNode, SpecTreeProvider, SpecGroupNode } from '../src/views/spec-tree-provider';
import { SPEC_STATUSES } from '../src/lib/spec-vocabulary';
import type { SpecStatus } from '../src/lib/spec-vocabulary';
import type { SpecSummary } from '../src/lib/spec-manager';

const ROOT = '/tmp/ws';

function summary(id: string, status: SpecStatus): SpecSummary {
  return {
    id,
    title: `${id} title`,
    tier: 'T2',
    status,
    currentPhase: 'specify',
    filePath: `${ROOT}/specs/minspec/${id}/requirements.md`,
    phasesDone: 0,
    phasesTotal: 4,
    hasDesignFile: false,
    hasTasksFile: false,
  } as unknown as SpecSummary;
}

/**
 * The SHIPPED when-clause regex that gates the tree's Approve action, read out of
 * package.json rather than copied — so this gate cannot drift from the contribution
 * it is asserting about.
 */
function treeApproveClauseRegex(): RegExp {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
  ) as { contributes: { menus: Record<string, { command?: string; when?: string }[]> } };
  const entry = (pkg.contributes.menus['view/item/context'] ?? []).find(
    (e) => e.command === 'minspec.approveSpec' && (e.when ?? '').includes('viewItem'),
  );
  if (!entry?.when) throw new Error('no view/item/context when-clause for minspec.approveSpec');
  const m = entry.when.match(/viewItem\s*=~\s*\/(.+)\/\s*$/);
  if (!m) throw new Error(`cannot extract viewItem regex from: ${entry.when}`);
  return new RegExp(m[1]);
}

/** Does the Specs tree expose an Approve action on this spec's row? */
function treeOffersApprove(spec: SpecSummary, approval: ApprovalStatus): boolean {
  const node = new SpecNode(spec, approval);
  return treeApproveClauseRegex().test(String(node.contextValue));
}

/** Does the approve QuickPick offer this spec? */
async function pickerOffersApprove(
  spec: SpecSummary,
  approval: ApprovalStatus,
): Promise<boolean> {
  vi.clearAllMocks();
  vi.mocked(getApprovalStatus).mockReturnValue(approval);
  vi.mocked(listSpecs).mockReturnValue([spec]);
  vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
  await approveSpecCommand(undefined);
  const calls = (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) return false; // list was empty → emptyMessage path
  const items = calls[calls.length - 1][0] as { spec: SpecSummary }[];
  return items.some((i) => i.spec.id === spec.id);
}

// The classification this fix introduces. Held here as a literal on purpose: the
// invariant below compares it against BOTH surfaces, so a surface that disagrees
// with the shared predicate fails even if the predicate itself were changed.
const TERMINAL: readonly SpecStatus[] = ['done', 'archived', 'superseded'];

describe('#440 — terminal-lifecycle specs must not be offered for approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
  });

  // ── T3 reproductions, from the two specs the founder reported ───────────────

  it('does not offer a `done` spec with no approval record (SPEC-007 shape)', async () => {
    expect(await pickerOffersApprove(summary('SPEC-007', 'done'), 'unapproved')).toBe(false);
  });

  it('does not offer a `superseded` spec with no approval record (SPEC-056 shape)', async () => {
    expect(await pickerOffersApprove(summary('SPEC-056', 'superseded'), 'unapproved')).toBe(false);
  });

  it('does not offer an `archived` spec with no approval record', async () => {
    expect(await pickerOffersApprove(summary('SPEC-099', 'archived'), 'unapproved')).toBe(false);
  });

  // Control: the filter must not be vacuous — a live spec is still offered.
  it('still offers a non-terminal unapproved spec', async () => {
    expect(await pickerOffersApprove(summary('SPEC-100', 'implementing'), 'unapproved')).toBe(true);
  });

  it('still offers a non-terminal STALE spec (re-approval path is untouched)', async () => {
    expect(await pickerOffersApprove(summary('SPEC-101', 'implementing'), 'stale')).toBe(true);
  });

  // ── T0 invariant: the two surfaces agree for EVERY status in the closed set ──
  // Iterating SPEC_STATUSES is the asymmetry guard: adding a status to the
  // vocabulary without classifying it fails here rather than silently defaulting.
  it('tree and approve picker agree on every SpecStatus in the closed set', async () => {
    const disagreements: string[] = [];
    for (const status of SPEC_STATUSES) {
      const spec = summary('SPEC-500', status);
      const tree = treeOffersApprove(spec, 'unapproved');
      const picker = await pickerOffersApprove(spec, 'unapproved');
      if (tree !== picker) {
        disagreements.push(`${status}: tree=${tree} picker=${picker}`);
      }
      const expected = !TERMINAL.includes(status);
      if (tree !== expected || picker !== expected) {
        disagreements.push(
          `${status}: expected approvable=${expected} but tree=${tree} picker=${picker}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  // ── The tree's own internal asymmetry: `superseded` was documented terminal
  //    in STATUS_GROUPS but omitted from the `terminal` predicate. ────────────
  it('treats `superseded` as terminal on the tree row, like done/archived', () => {
    for (const status of TERMINAL) {
      const node = new SpecNode(summary('SPEC-500', status), 'unapproved');
      expect(String(node.contextValue), `contextValue for status=${status}`).toMatch(
        /^specNode\.terminal( |$)/,
      );
    }
  });

  it('keeps a `superseded` spec out of the Needs Re-Approval group', () => {
    const specs = [summary('SPEC-056', 'superseded'), summary('SPEC-100', 'implementing')];
    const provider = new SpecTreeProvider(ROOT, () => specs, () => 'stale');
    provider.epicGrouping.set(false);
    const group = provider
      .getChildren(undefined)
      .find((n): n is SpecGroupNode => n instanceof SpecGroupNode && n.kind === 'needsReapproval');
    expect(group).toBeDefined();
    expect(group!.specs.map((s) => s.id)).toEqual(['SPEC-100']);
  });

  // ── No deadlock: the filter governs the two PICKERS only. The explicit
  //    "I have this exact spec, approve it" path stays open, so a terminal spec
  //    whose approval record ever DOES need refreshing is still reachable. ────
  it('still approves a terminal spec when one is passed explicitly (picker bypassed)', async () => {
    for (const status of TERMINAL) {
      vi.clearAllMocks();
      vi.mocked(getApprovalStatus).mockReturnValue('stale');
      vi.mocked(listSpecs).mockReturnValue([summary('SPEC-007', status)]);

      // readSpecFile will throw on this fake path — harmless. The assertion is
      // only that the filtered QuickPick was never consulted, i.e. the explicit
      // per-artifact path is not subject to the terminal filter.
      await approveSpecCommand({ spec: summary('SPEC-007', status) });

      expect(
        vscode.window.showQuickPick,
        `passing a ${status} spec explicitly must bypass the picker`,
      ).not.toHaveBeenCalled();
    }
  });

  it('drops a terminal spec whose approval is STALE from the picker, by design', async () => {
    // A stale record on a terminal spec is deliberately NOT an action item: the
    // tree already shows no warning glyph on such a row and the Needs-Re-Approval
    // group already excludes it (SPEC-029 — "a terminal spec never enters the
    // Needs-Re-Approval group either"). The pickers now agree with that, and the
    // explicit path above is the escape hatch.
    expect(await pickerOffersApprove(summary('SPEC-007', 'done'), 'stale')).toBe(false);
  });

  // ── Revoke must NOT gain the filter: an accidentally-approved terminal spec
  //    has to remain undoable (SPEC-007 is in exactly that state today). ──────
  it('revoke still offers an approved terminal spec so the approval is undoable', async () => {
    vi.clearAllMocks();
    vi.mocked(getApprovalStatus).mockReturnValue('approved');
    vi.mocked(listSpecs).mockReturnValue([summary('SPEC-007', 'done')]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

    await revokeApprovalCommand(undefined);

    const calls = (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const items = calls[0][0] as { spec: SpecSummary }[];
    expect(items.map((i) => i.spec.id)).toEqual(['SPEC-007']);
  });
});
