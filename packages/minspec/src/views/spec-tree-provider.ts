import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveAndValidate } from '../lib/config';
import { allWorkspaceRoots } from '../lib/resolve-folder';
import { parseSpec } from '../lib/spec';
import type { SpecFrontmatter, SpecStatus } from '../lib/spec';
import type { Phase, MinspecConfig } from '../lib/config';
import type { ApprovalStatus } from '../lib/approval';

/**
 * Approval lookup, injected so the provider has no hard runtime dependency on
 * the approval module (keeps unit tests that mock only `vscode` clean, and
 * mirrors the ListSpecsFn injection pattern). extension.ts wires the real one.
 */
// Path-keyed since SPEC-022 (FR-1): approval ground truth is keyed by the spec's
// repo-relative path, not its id, so the lookup no longer takes a specId.
export type ApprovalLookupFn = (rootDir: string, specFilePath: string) => ApprovalStatus;
import { getApprovalStatus } from '../lib/approval';
import type { SpecSummary } from '../lib/spec-manager';
import { isSpecKitDirEntry, readSpecKitDir } from '../lib/spec-layout';
import { EpicGroupingState, EpicGroupNode, buildEpicGroups } from './epic-grouping';
import type { ListEpicsFn } from './epic-grouping';
import { TreeExpansionMemory } from './tree-expansion-memory';
export type { SpecSummary };

/**
 * Scan the specs directory and return summaries for all specs.
 *
 * Recurses into product/feature subfolders (e.g. `specs/minspec/SPEC-007-epic-grouping/`)
 * — monorepos nest specs under a product dir, which the old top-level-only scan
 * missed entirely. Still handles flat files and spec-kit directories. Multiple
 * files sharing one `id` (a spec split across requirements/design/tasks) collapse
 * to a single entry, preferring the canonical requirements.md/spec.md.
 */
export function listSpecs(rootDir: string): SpecSummary[] {
  const config = loadConfig(rootDir);
  const specsDir = resolveAndValidate(rootDir, config.specsDir);

  if (!fs.existsSync(specsDir)) {
    return [];
  }

  // id → {summary, rank}. Lower rank wins as the representative file.
  const byId = new Map<string, { summary: SpecSummary; rank: number }>();
  const rankOf = (name: string): number =>
    name === 'requirements.md' ? 0
      : name === 'spec.md' ? 1
        : name === 'design.md' ? 2
          : 3;

  // id → which phase-file roles it OWNS, keyed by the role file's OWN
  // frontmatter id — never by directory co-location. A flat directory can
  // hold several independently-numbered specs (this repo's own
  // specs/minspec/{requirements,design,tasks}.md are SPEC-001/002/003, not
  // three shards of one spec), so "design.md exists next to me" is not the
  // same claim as "design.md is MY design phase". Populated inline as the
  // walk below parses each candidate file anyway — no extra fs pass.
  const rolesById = new Map<string, { design: boolean; tasks: boolean }>();
  const addRole = (id: string, role: 'design' | 'tasks'): void => {
    const roles = rolesById.get(id) ?? { design: false, tasks: false };
    roles[role] = true;
    rolesById.set(id, roles);
  };

  const consider = (fm: SpecFrontmatter, displayPath: string): void => {
    if (!fm.id) return;
    const { done, total } = phaseProgress(fm, config);
    const summary: SpecSummary = {
      id: fm.id,
      title: fm.title,
      tier: fm.tier,
      status: fm.status,
      currentPhase: deriveCurrentPhase(fm),
      filePath: displayPath,
      phasesDone: done,
      phasesTotal: total,
      epic: fm.epic,
      product: fm.product,
    };
    const rank = rankOf(path.basename(displayPath));
    const prev = byId.get(fm.id);
    if (!prev || rank < prev.rank) byId.set(fm.id, { summary, rank });

    const base = path.basename(displayPath).toLowerCase();
    if (base === 'design.md' || base === 'plan.md') addRole(fm.id, 'design');
    if (base === 'tasks.md') addRole(fm.id, 'tasks');
  };

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      try {
        if (stat.isFile() && entry.endsWith('.md')) {
          consider(parseSpec(fs.readFileSync(fullPath, 'utf-8')).frontmatter, fullPath);
        } else if (stat.isDirectory() && isSpecKitDirEntry(entry)) {
          // Spec-kit dir: merge shards, don't recurse into it. Unlike the flat
          // walk above, plan.md/tasks.md here have no frontmatter id of their
          // own to key by (mergeSpecKitShards folds them into one spec) — the
          // directory itself is scoped to a single spec by construction, so a
          // plain existence check is safe (no cross-spec collision is possible).
          const specMd = path.join(fullPath, 'spec.md');
          if (fs.existsSync(specMd)) {
            const fm = readSpecKitDir(fullPath).frontmatter;
            consider(fm, specMd);
            if (fm.id) {
              if (fs.existsSync(path.join(fullPath, 'plan.md'))) addRole(fm.id, 'design');
              if (fs.existsSync(path.join(fullPath, 'tasks.md'))) addRole(fm.id, 'tasks');
            }
          }
        } else if (stat.isDirectory()) {
          walk(fullPath); // product / feature subfolder
        }
      } catch {
        // Skip unparseable entries
      }
    }
  };
  walk(specsDir);

  const summaries = [...byId.values()].map(({ summary }) => {
    const roles = rolesById.get(summary.id);
    return { ...summary, hasDesignFile: roles?.design ?? false, hasTasksFile: roles?.tasks ?? false };
  });
  // Sort by ID for stable ordering
  summaries.sort((a, b) => a.id.localeCompare(b.id));
  return summaries;
}

/**
 * Derive the current active phase from frontmatter phase statuses.
 * Returns the first in-progress phase, or first pending phase, or null if all done/skipped.
 */
/**
 * Count completed (done/skipped) required phases for a spec's tier.
 * "Required" comes from config.phaseMappings so progress reflects ceremony:
 * a T1 spec is 100% at specify-done, a T4 needs all five phases.
 */
function phaseProgress(fm: SpecFrontmatter, config: MinspecConfig): { done: number; total: number } {
  const required = config.phaseMappings[fm.tier]?.requiredPhases ?? ['specify'];
  let done = 0;
  for (const phase of required) {
    const st = fm.phases[phase];
    if (st === 'done' || st === 'skipped') done++;
  }
  return { done, total: required.length };
}

function deriveCurrentPhase(fm: SpecFrontmatter): Phase | null {
  const phases: Phase[] = ['specify', 'clarify', 'plan', 'tasks', 'implement'];

  // First check for in-progress
  for (const phase of phases) {
    if (fm.phases[phase] === 'in-progress') return phase;
  }
  // Then check for first pending
  for (const phase of phases) {
    if (fm.phases[phase] === 'pending') return phase;
  }
  return null;
}

// --- Status grouping ---

interface StatusGroup {
  readonly label: string;
  readonly statuses: SpecStatus[];
  readonly defaultExpanded: boolean;
}

// Lifecycle-named lanes (SPEC-015). Order is render order (INV-2); the union of
// statuses must cover every SpecStatus exactly once (INV-1) so no spec vanishes.
// `new` folds into Specifying (pre-authoring). Active lanes expand, terminal
// lanes collapse. Approval is orthogonal (DR-012) — shown via the row icon, not
// a lane here.
export const STATUS_GROUPS: StatusGroup[] = [
  { label: 'Specifying', statuses: ['new', 'specifying'], defaultExpanded: true },
  { label: 'Implementing', statuses: ['implementing'], defaultExpanded: true },
  { label: 'Done', statuses: ['done'], defaultExpanded: false },
  { label: 'Archived', statuses: ['archived'], defaultExpanded: false },
  // `superseded` (SPEC-017 / #162) is an explicit terminal like `archived` —
  // its own collapsed terminal lane (the forced SPEC-015 INV-1 lane decision,
  // not left partial). Renders after Archived (terminal lanes trail active ones).
  { label: 'Superseded', statuses: ['superseded'], defaultExpanded: false },
];

// --- Tree node classes ---

export class SpecGroupNode extends vscode.TreeItem {
  public readonly specs: SpecSummary[];
  /**
   * 'needsReapproval' identifies the SPEC-029 pinned, cross-cutting group so
   * getChildren can route its rows to the diff command (FR-7) without a new
   * contextValue on the GROUP itself (menus keyed off contextValue today are
   * unaffected — see spec-tree-provider's SpecNode.contextValue for the
   * per-ROW `specNode.stale` value this feature adds instead).
   */
  public readonly kind: 'status' | 'needsReapproval';
  /**
   * The workspace folder this group's specs came from. Carried so the lazy
   * getChildren(group) → toSpecNode path resolves each spec's approval against
   * its OWN folder in a multi-root workspace (#549). Single-root construction
   * leaves it as the sole workspace root; direct construction defaults to ''.
   */
  public readonly root: string;

  constructor(group: StatusGroup, specs: SpecSummary[], kind: 'status' | 'needsReapproval' = 'status', root = '') {
    const collapsibleState = group.defaultExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(group.label, collapsibleState);

    this.specs = specs;
    this.kind = kind;
    this.root = root;
    // Root-namespaced expansion key ([[tree-expansion-memory]]); the label (not
    // the count) is the stable discriminator, and the needsReapproval group gets
    // its own key since it and a status lane can share a label edge-case-free.
    this.id = `${root}::${kind === 'needsReapproval' ? 'needsReapproval' : `status:${group.label}`}`;
    this.description = `(${specs.length})`;
    this.contextValue = 'specGroup';
    this.accessibilityInformation = {
      label: `${group.label} specs group, ${specs.length} items`,
      role: 'treeitem',
    };
  }
}

/**
 * Map a spec status to a ThemeIcon id.
 */
function statusIcon(status: SpecStatus): string {
  switch (status) {
    case 'new': return 'circle-outline';
    case 'specifying': return 'sync';
    case 'implementing': return 'sync';
    case 'done': return 'check';
    case 'archived': return 'archive';
    case 'superseded': return 'arrow-swap'; // mirrors ADR superseded glyph
    default: return 'circle-outline';
  }
}

/** Render an N/M progress as a compact unicode meter, e.g. \u25b0\u25b0\u25b0\u25b1\u25b1. */
function progressMeter(done: number, total: number): string {
  if (total <= 0) return '';
  const filled = Math.round((done / total) * 5);
  return '\u25b0'.repeat(filled) + '\u25b1'.repeat(5 - filled);
}

/**
 * SPECS-pane row label is a width-constrained, display-only rendering — the
 * authoritative `SPEC-NNN` id and full title always survive in the tooltip and
 * accessibility label (never-wrong: no information is destroyed, only abbreviated).
 *
 * `compressSpecId`: `SPEC-015` -> `015` (it IS the specs pane; the prefix is
 * redundant). Any id not matching `SPEC-<digits>` passes through unchanged.
 */
export function compressSpecId(id: string): string {
  const m = /^SPEC-(\d+)$/i.exec(id);
  return m ? m[1] : id;
}

/**
 * `stripProductPrefix`: drop a leading `MinSpec — ` / `ScroogeLLM -- ` product
 * prefix from a spec's H1 title. Only strips when the leading token equals the
 * spec's `product` slug (case-insensitive) — so unrelated titles like
 * `Add rate limiting` are never touched. Tolerates any of the separators specs
 * use in the wild (em/en dash, double or single hyphen). Used only under epic
 * grouping, where the epic header already implies the product (DR-013 / SPEC-007).
 */
export function stripProductPrefix(title: string, product?: string): string {
  if (!product) return title;
  const m = /^(\S+)\s*(?:—|–|--|-)\s+(.*)$/.exec(title);
  if (m && m[1].toLowerCase() === product.toLowerCase()) return m[2];
  return title;
}

export class SpecNode extends vscode.TreeItem {
  constructor(
    public readonly spec: SpecSummary,
    public readonly approval: ApprovalStatus = 'unapproved',
    /**
     * True when this row renders under an epic group: the epic header implies
     * the product, so the redundant `MinSpec — ` title prefix is stripped to
     * reclaim width. Status-lane rows pass false (two products would otherwise
     * collapse to identical text). The id is compressed regardless.
     */
    epicGrouped = false,
    /**
     * True only for the row rendered under the SPEC-029 "Needs Re-Approval"
     * group (dual-listed alongside the same spec's normal lifecycle-lane row,
     * which always keeps diffOnClick=false). Routes the click to the diff
     * command instead of the plain file (FR-7) — every other property below
     * (icon/description/tooltip/contextValue) is computed identically either
     * way, so FR-3 holds by construction, not a parallel code path.
     */
    diffOnClick = false,
  ) {
    const displayTitle = epicGrouped ? stripProductPrefix(spec.title, spec.product) : spec.title;
    super(`${compressSpecId(spec.id)}: ${displayTitle}`, vscode.TreeItemCollapsibleState.None);

    const phaseLabel = spec.currentPhase ?? 'complete';
    const pct = spec.phasesTotal > 0 ? Math.round((spec.phasesDone / spec.phasesTotal) * 100) : 100;
    const meter = progressMeter(spec.phasesDone, spec.phasesTotal);
    const terminal = spec.status === 'done' || spec.status === 'archived';

    // Approval state shows on the ALWAYS-VISIBLE left icon, not the description.
    // The description is dimmed + truncated-first, so a trailing badge vanished
    // at normal pane widths. Terminal specs (done/archived) are past the gate, so
    // they keep their status icon and show no approval marker.
    //   approved \u2192 \ud83d\udd12 (lock = content sealed; editing voids it). NOT \u2714 \u2014 a check
    //   misreads as "done" on a spec that is only approved-to-build (signpost-lie).
    //   stale \u2192 \u26a0 warning. otherwise \u2192 status icon.
    const iconId =
      terminal ? statusIcon(spec.status)
        : approval === 'approved' ? 'lock'
          : approval === 'stale' ? 'warning'
            : statusIcon(spec.status);
    this.iconPath = new vscode.ThemeIcon(iconId);

    // Description keeps a plain-text approval word (no glyph \u2014 icon carries it)
    // so wide panes / quick scans still read it; it truncating when narrow is now
    // harmless because the icon is authoritative.
    const approvalTag =
      terminal ? ''
        : approval === 'approved' ? ' \u00b7 approved'
          : approval === 'stale' ? ' \u00b7 stale' : '';
    this.description = `${spec.tier} \u00b7 ${meter} ${pct}% \u00b7 ${phaseLabel}${approvalTag}`;

    // diffOnClick (SPEC-029 FR-7): the Needs-Re-Approval row opens the diff
    // command instead of the plain file. The command handler accepts a plain
    // string path (this shape) OR a SpecNode (the context-menu invocation
    // shape) — see approval-diff.ts.
    this.command = diffOnClick
      ? {
          command: 'minspec.showChangesSinceApproval',
          title: 'Show Changes Since Approval',
          arguments: [spec.filePath],
        }
      : {
          command: 'vscode.open',
          title: 'Open Spec',
          arguments: [vscode.Uri.file(spec.filePath)],
        };

    // Context value drives menu visibility. Terminal specs (done/archived) are
    // past the DR-012 approve-before-implement gate, so they expose no approval
    // action at all. Otherwise the suffix encodes approval state so Revoke shows
    // only on approved specs, and (SPEC-029) 'specNode.stale' scopes the
    // "Show Changes Since Approval" menu entry to stale specs only — see the
    // package.json when-clauses, which widen the classify/approveSpec clauses
    // to also match specNode.stale so those actions are NOT lost on this row.
    const base = terminal
      ? 'specNode.terminal'
      : approval === 'approved' ? 'specNode.approved'
      : approval === 'stale' ? 'specNode.stale'
      : 'specNode';

    // Space-separated flags (not dot-suffixed, so they stay distinguishable from
    // the approval suffix above) gate "View Design"/"View Tasks": only offered
    // when this spec OWNS a design/tasks phase-file (spec.hasDesignFile/
    // hasTasksFile — computed once in listSpecs()'s directory walk, keyed by
    // each candidate file's own frontmatter id, not by directory co-location;
    // see SpecSummary's doc comment). Reading it here (rather than re-deriving
    // via fs.existsSync per node per render) avoids both a redundant fs pass
    // and the cross-spec collision a bare "sibling file exists" check risked.
    const flags = [spec.hasDesignFile && 'hasDesign', spec.hasTasksFile && 'hasTasks'].filter(Boolean).join(' ');
    this.contextValue = flags ? `${base} ${flags}` : base;

    const approvalLine =
      approval === 'approved' ? 'Approval: \ud83d\udd12 approved (content-bound) \u2014 sealed to this content, not yet built'
        : approval === 'stale' ? 'Approval: \u26a0 STALE \u2014 spec edited since approval, re-approve required'
          : 'Approval: \u2014 not approved';
    this.tooltip = `${spec.id}: ${spec.title}\nTier: ${spec.tier}\nStatus: ${spec.status}\nPhase: ${phaseLabel}\nProgress: ${spec.phasesDone}/${spec.phasesTotal} required phases (${pct}%)\n${approvalLine}`;

    this.accessibilityInformation = {
      label: `${spec.id}: ${spec.title}, tier ${spec.tier}, ${pct} percent complete, status ${spec.status}, phase ${phaseLabel}, ${approval}`,
      role: 'treeitem',
    };
  }
}

/**
 * Synthetic roll-up shown at the top of the tree: epic-level progress across
 * all non-archived specs.
 */
export class RollupNode extends vscode.TreeItem {
  constructor(specs: SpecSummary[]) {
    super('Progress', vscode.TreeItemCollapsibleState.None);
    const active = specs.filter((s) => s.status !== 'archived');
    const totalReq = active.reduce((n, s) => n + s.phasesTotal, 0);
    const doneReq = active.reduce((n, s) => n + s.phasesDone, 0);
    const doneSpecs = active.filter((s) => s.status === 'done').length;
    const pct = totalReq > 0 ? Math.round((doneReq / totalReq) * 100) : 0;

    this.description = `${active.length} spec(s) \u00b7 ${progressMeter(doneReq, totalReq)} ${pct}% \u00b7 ${doneSpecs} done`;
    this.iconPath = new vscode.ThemeIcon('graph');
    this.contextValue = 'rollupNode';
    this.tooltip = `Epic progress\n${active.length} active spec(s)\n${doneReq}/${totalReq} required phases complete (${pct}%)\n${doneSpecs} spec(s) fully done`;
    this.accessibilityInformation = {
      label: `Overall progress: ${pct} percent, ${doneSpecs} of ${active.length} specs done`,
      role: 'treeitem',
    };
  }
}

/**
 * Top-level per-folder group, shown ONLY in a multi-root workspace (#549). Its
 * children are that folder's ordinary tree (rollup + Needs-Re-Approval + status
 * or epic groups), computed against the folder's OWN root — so epic ids from
 * different products in the combined workspace never collide. A single-root
 * workspace renders no folder tier at all; the tree is byte-identical to before.
 */
export class SpecFolderNode extends vscode.TreeItem {
  constructor(public readonly root: string) {
    const name = path.basename(root) || root;
    super(name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `folder::${root}`; // stable expansion key ([[tree-expansion-memory]])
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'specFolder';
    this.tooltip = root;
    this.accessibilityInformation = {
      label: `${name} workspace folder`,
      role: 'treeitem',
    };
  }
}

// --- TreeDataProvider ---

/** Function signature for listing specs — allows dependency injection in tests */
export type ListSpecsFn = (rootDir: string) => SpecSummary[];

export type SpecTreeNode = SpecFolderNode | RollupNode | SpecGroupNode | EpicGroupNode<SpecSummary> | SpecNode;

export class SpecTreeProvider implements vscode.TreeDataProvider<SpecTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SpecTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  /** Coalesce refresh bursts (issue #154). See refresh(). */
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private static readonly REFRESH_DEBOUNCE_MS = 120;
  private readonly _listSpecs: ListSpecsFn;
  private readonly _approvalOf: ApprovalLookupFn;
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
    listSpecsFn?: ListSpecsFn,
    approvalFn?: ApprovalLookupFn,
    listEpicsFn?: ListEpicsFn,
  ) {
    this._listSpecs = listSpecsFn ?? listSpecs;
    // Default to the REAL lookup, mirroring listSpecs above (DR-012). A prior
    // `() => 'unapproved'` stub default meant production (extension.ts) — which
    // constructs with no approvalFn — never read approvals.json, so approval
    // badges never appeared and no refresh could surface them.
    this._approvalOf = approvalFn ?? getApprovalStatus;
    this._listEpics = listEpicsFn;
  }

  /**
   * Rebuild the tree, coalescing bursts into a single rebuild (issue #154).
   *
   * Approving a spec mutates two watched files (the spec `.md` and
   * `approvals.json`) AND calls refresh explicitly — so one approval otherwise
   * fires 4-5 rebuilds in quick succession, each a synchronous re-read+parse of
   * every spec (`listSpecs`) on the extension-host thread. Under memory pressure
   * those reads stall on swap-in and the UI freezes. Collapsing a burst to one
   * trailing rebuild removes the redundant work no matter how many call-sites
   * (commands + file watchers) fire. getChildren reads fresh from disk, so the
   * single trailing fire always reflects the latest state.
   */
  refresh(): void {
    if (this._refreshTimer !== undefined) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._onDidChangeTreeData.fire(undefined);
    }, SpecTreeProvider.REFRESH_DEBOUNCE_MS);
  }

  getTreeItem(element: SpecTreeNode): vscode.TreeItem {
    this._expansion?.apply(element);
    return element;
  }

  getChildren(element?: SpecTreeNode): SpecTreeNode[] {
    if (!element) {
      const roots = this.roots();
      if (roots.length === 0) return [];
      // Single-root (the common case): render the folder's tree directly, with
      // no folder tier — byte-identical to the pre-#549 behavior.
      if (roots.length === 1) return this.rootChildren(roots[0]);
      // Multi-root: one expandable group per folder (#549). Each folder's own
      // subtree lists that folder's specs (and its own epics), so nothing from a
      // non-primary folder is dropped and epic ids never collide across products.
      return roots.map(root => new SpecFolderNode(root));
    }

    if (element instanceof SpecFolderNode) {
      return this.rootChildren(element.root);
    }

    if (element instanceof SpecGroupNode) {
      return element.specs.map(spec => this.toSpecNode(element.root, spec, false, element.kind === 'needsReapproval'));
    }

    if (element instanceof EpicGroupNode) {
      // Under an epic group the product is implied → strip the redundant title prefix.
      return element.members.map(spec => this.toSpecNode(element.root, spec, true));
    }

    // SpecFolderNode is handled above; RollupNode and SpecNode are leaves.
    return [];
  }

  /**
   * The workspace roots to scan. Live `workspaceFolders` win (multi-root, #549);
   * the ctor `workspaceRoot` is the single-root fallback for activation-time
   * construction and for unit tests whose vscode mock exposes no workspaceFolders.
   * Read fresh every call so a refresh() after onDidChangeWorkspaceFolders picks
   * up an added/removed folder with no cached root to go stale.
   *
   * `allWorkspaceRoots()` returns `undefined` (fall back to the ctor seed) only
   * when the live API has no folder list at all; it returns `[]` — rendered as
   * an empty tree, no fallback — when the API is live and genuinely reports
   * zero folders (every folder removed at runtime). Collapsing those two cases
   * via `live.length > 0 ? live : fallback` briefly re-rendered the removed
   * folder's stale specs after the last live folder vanished (#574).
   */
  private roots(): string[] {
    const live = allWorkspaceRoots();
    if (live !== undefined) return live;
    return this.workspaceRoot ? [this.workspaceRoot] : [];
  }

  /**
   * The ordinary tree for ONE root: rollup, the SPEC-029 pinned Needs-Re-Approval
   * group (cross-cutting — rendered regardless of epic-grouping mode), then either
   * epic groups or status groups. This is exactly what getChildren(undefined)
   * returned before #549; multi-root just calls it once per folder.
   */
  private rootChildren(root: string): SpecTreeNode[] {
    const allSpecs = this._listSpecs(root);
    const out: SpecTreeNode[] = [];
    if (allSpecs.length > 0) out.push(new RollupNode(allSpecs));
    const needsReapproval = this.getNeedsReapprovalGroup(root, allSpecs);
    if (needsReapproval) out.push(needsReapproval);
    const epicGroups = this.epicGrouping.enabled ? this.getEpicGroups(root, allSpecs) : null;
    out.push(...(epicGroups ?? this.getStatusGroups(root, allSpecs)));
    return out;
  }

  /** Approval lookup with the established best-effort degrade (shared by
   *  toSpecNode and getNeedsReapprovalGroup — one try/catch, not two to drift). */
  private safeApproval(root: string, spec: SpecSummary): ApprovalStatus {
    try {
      return this._approvalOf(root, spec.filePath);
    } catch {
      return 'unapproved'; // best-effort — default to unapproved
    }
  }

  /** Build a SpecNode tagged with its current approval status. */
  private toSpecNode(root: string, spec: SpecSummary, epicGrouped = false, diffOnClick = false): SpecNode {
    return new SpecNode(spec, this.safeApproval(root, spec), epicGrouped, diffOnClick);
  }

  private getStatusGroups(root: string, allSpecs: SpecSummary[]): SpecGroupNode[] {
    return STATUS_GROUPS.map(group => {
      const groupSpecs = allSpecs.filter(s => group.statuses.includes(s.status));
      return new SpecGroupNode(group, groupSpecs, 'status', root);
    });
  }

  /**
   * SPEC-029 FR-1/FR-2/FR-4: cross-cutting group of every stale spec, additive
   * to STATUS_GROUPS (INV — Orthogonal axes — no SpecStatus value is added,
   * STATUS_GROUPS is untouched). Live-derived on every call (FR-2 — no
   * persisted state). The terminal guard is load-bearing: getApprovalStatus is
   * purely hash-based and would otherwise resolve 'stale' for a done/archived
   * spec whose sidecar hash drifted post-terminal — mirrors SpecNode's own
   * `terminal` predicate so such a spec never enters this group (matching
   * requirements.md's Failure-Modes: "a terminal spec never enters the
   * Needs-Re-Approval group either").
   */
  private getNeedsReapprovalGroup(root: string, allSpecs: SpecSummary[]): SpecGroupNode | null {
    const stale = allSpecs.filter(
      s => s.status !== 'done' && s.status !== 'archived' && this.safeApproval(root, s) === 'stale',
    );
    if (stale.length === 0) return null; // FR-4: non-empty-only
    return new SpecGroupNode(
      { label: 'Needs Re-Approval', statuses: [], defaultExpanded: true },
      stale,
      'needsReapproval',
      root,
    );
  }

  private getEpicGroups(root: string, allSpecs: SpecSummary[]): EpicGroupNode<SpecSummary>[] | null {
    return buildEpicGroups(
      root,
      allSpecs,
      s => s.epic,
      s => s.status === 'done',
      this._listEpics,
    );
  }
}
