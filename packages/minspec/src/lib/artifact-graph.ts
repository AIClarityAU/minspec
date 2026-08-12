/**
 * Artifact-Graph fs adapter — SPEC-012 signpost wiring (the fs/vscode-free Node
 * layer that feeds the Tier-0 resolver in `@aiclarity/shared`).
 *
 * Reads the REAL workspace (epics, specs, ADRs, approval sidecars, the
 * constitution Goals list, and cross-cutting frontmatter edges) and maps it onto
 * the resolver's `ArtifactGraph` shape. It is a PURE MAPPING LAYER:
 *
 *   - It CONSUMES the resolver (`resolveNextTask` etc. live in @aiclarity/shared);
 *     no severity / coherence / cycle logic is reimplemented here (INV-CONSUME).
 *   - It NEVER imports `vscode` (Tier-1 fs layer, not a UI surface).
 *   - It DERIVES every spec's status via the project's OWN `deriveStatus`
 *     (DR-034) — NEVER the literal `status:` frontmatter line, which is a mirror
 *     cache that can drift (SPEC-022). Feeding the literal would re-introduce the
 *     #112/#148 stale-status class of bug the approval foundation closed.
 *     (INV-FIDELITY.)
 *   - Missing dirs / empty workspace ⇒ an empty (but well-formed) graph, never a
 *     throw (INV-DEGRADE); the command layer degrades on top of that.
 *
 * Edges (FR-13: `depends_on` / `supersedes` / `relates_to`) are passed through
 * FAITHFULLY, including danglers — the resolver detects danglers as corruption;
 * the adapter must not pre-filter (it would hide a real "state unclear").
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ArtifactGraph,
  EpicNode,
  SpecNode,
  AdrNode,
  Edge,
  EdgeKind,
  ImplementHole,
  EpicStatus as ResolverEpicStatus,
  SpecStatus as ResolverSpecStatus,
  AdrStatus as ResolverAdrStatus,
  ApprovalState as ResolverApprovalState,
} from '@aiclarity/shared';

import { loadConfig, resolveAndValidate } from './config';
import { listEpics, epicRefValue, resolveEpic, type EpicStatus } from './epic-manager';
import { listAdrs, type AdrStatus } from './adr-manager';
import { parseSpec, type ParsedSpec, type SpecStatus } from './spec';
import { getCurrentPhase } from './lifecycle';
import { deriveStatus, type ExplicitTerminal } from './lifecycle';
import { getApprovalStatus, type ApprovalStatus } from './approval';

// ───────────────────────────────────────────────────────────────────────────
// Status-enum mapping tables — STRICT 1:1 (INV-FIDELITY).
//
// All three enums are already identical in name + meaning between this package
// and the resolver's Tier-0 redeclarations. The maps are the identity, but they
// are declared explicitly with `satisfies Record<RealEnum, ResolverEnum>` so a
// FUTURE enum drift fails to compile (a test, not a silent mis-coercion).
// ───────────────────────────────────────────────────────────────────────────

const EPIC_STATUS_MAP = {
  proposed: 'proposed',
  active: 'active',
  done: 'done',
  abandoned: 'abandoned',
} satisfies Record<EpicStatus, ResolverEpicStatus>;

const SPEC_STATUS_MAP = {
  new: 'new',
  specifying: 'specifying',
  // DR-069 (#886): 'planning' (approved, pre-implement) maps to the resolver's
  // 'implementing' — an approved-planning spec IS in-flight, so every resolver seam
  // (answer-OQ, isAdvancing, spec-ahead-of-epic, flooring) treats it exactly as before.
  // This mapping is behaviour-neutral for next-task and MUST stay 'implementing'.
  planning: 'implementing',
  implementing: 'implementing',
  done: 'done',
  archived: 'archived',
  superseded: 'superseded',
} satisfies Record<SpecStatus, ResolverSpecStatus>;

const ADR_STATUS_MAP = {
  proposed: 'proposed',
  accepted: 'accepted',
  deprecated: 'deprecated',
  superseded: 'superseded',
} satisfies Record<AdrStatus, ResolverAdrStatus>;

const APPROVAL_STATE_MAP = {
  approved: 'approved',
  stale: 'stale',
  unapproved: 'unapproved',
} satisfies Record<ApprovalStatus, ResolverApprovalState>;

// ───────────────────────────────────────────────────────────────────────────
// Frontmatter readers — array edges + goal ref.
//
// The lightweight YAML parsers in spec.ts / epic-manager.ts do NOT parse arrays,
// and `SpecFrontmatter` carries no `goal` field, so both are read here with
// dedicated regexes against the RAW frontmatter block (mirroring `readArtifactEpic`).
// ───────────────────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const EDGE_KINDS: readonly EdgeKind[] = ['depends_on', 'supersedes', 'relates_to'];

/** Extract the leading `---`…`---` frontmatter block from raw file content, or ''. */
function frontmatterBlock(content: string): string {
  const m = content.replace(/\r\n?/g, '\n').match(FRONTMATTER_RE);
  return m ? m[1] : '';
}

/**
 * Parse a `kind: [A, B, C]` inline-array frontmatter line into `Edge[]` from
 * `fromId`. The value may carry a trailing inline `# comment` after the `]`,
 * which is dropped (the regex stops at the first `]`). Empty/absent ⇒ no edges.
 */
function parseEdgeArray(fmBlock: string, kind: EdgeKind, fromId: string): Edge[] {
  const re = new RegExp(`^${kind}:\\s*\\[([^\\]]*)\\]`, 'm');
  const m = fmBlock.match(re);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((to) => ({ kind, from: fromId, to }));
}

/** All cross-cutting edges declared in one artifact's frontmatter block. */
function edgesFrom(fmBlock: string, fromId: string): Edge[] {
  const out: Edge[] = [];
  for (const kind of EDGE_KINDS) out.push(...parseEdgeArray(fmBlock, kind, fromId));
  return out;
}

/** The raw `goal:` ref (e.g. `G-2`) from a frontmatter block, inline-comment-stripped, or null. */
function goalRefOf(fmBlock: string): string | null {
  const m = fmBlock.match(/^goal:\s*([^\s#]+)/m);
  return m ? m[1].trim() : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Constitution Goals → goal-rank map (DR-039).
//
// `## Goals` is a numbered list whose ORDER is importance. Each item names a
// stable id `G-N`; the rank is the LIST position (1-based) — read from the leading
// `N.` rather than re-deriving from the id, so a mis-numbered id can't lie. A
// `goal: G-N` ref on an artifact resolves to that rank; absent/unknown ⇒ undefined
// (the resolver substitutes +Infinity — lowest precedence in that tie-break term).
// ───────────────────────────────────────────────────────────────────────────

const CONSTITUTION_REL = '.minspec/constitution.md';
const GOAL_ID_IN_GOALS_RE = /^\s*(\d+)\.\s+\*\*\s*(G-\d+)\b/;

/** Build `G-N → rank` from the constitution's `## Goals` section. Missing file ⇒ empty map. */
function buildGoalRankMap(rootDir: string): Map<string, number> {
  const map = new Map<string, number>();
  const file = path.join(rootDir, ...CONSTITUTION_REL.split('/'));
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch {
    return map; // no constitution ⇒ no goal ranks (degrade, never throw)
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let inGoals = false;
  for (const line of lines) {
    if (/^##\s+Goals\s*$/i.test(line)) {
      inGoals = true;
      continue;
    }
    if (inGoals && /^##\s+/.test(line)) break; // next H2 ends the Goals section
    if (!inGoals) continue;
    const m = line.match(GOAL_ID_IN_GOALS_RE);
    if (m) {
      const rank = Number(m[1]);
      const id = m[2];
      if (Number.isFinite(rank) && !map.has(id)) map.set(id, rank);
    }
  }
  return map;
}

/** Resolve a frontmatter `goal:` ref to its rank, or undefined when absent/unknown. */
function goalRankOf(fmBlock: string, goalRanks: Map<string, number>): number | undefined {
  const ref = goalRefOf(fmBlock);
  if (!ref) return undefined;
  return goalRanks.get(ref);
}

// ───────────────────────────────────────────────────────────────────────────
// Spec discovery — recursive walk + split-layout dedupe.
//
// Deliberately NOT shared with `lib/spec-catalog`'s recursive `listSpecs`: that
// returns `SpecSummary`, a pane-shaped projection which drops both the parsed
// body and the raw frontmatter block. The graph needs the whole `ParsedSpec`
// per spec — `parsed.raw` is what `frontmatterBlock` re-reads below to resolve
// the `goal:`/`epic:` refs `SpecSummary` never carries — so it walks once here.
// Beware the near-namesake: the top-level-only scan this comment once cited as
// the reason for the walk is `listSpecsShallow` (`lib/spec-manager`), renamed
// out of the way by SPEC-040 FR-4; `listSpecs` is the recursive one and does
// reach the real repo's nested `specs/<product>/<feature>/requirements.md`.
//
// The walk dedupes split-layout siblings (`requirements.md` / `design.md` /
// `tasks.md` sharing one id) by id, taking the `specify`-phase file that OWNS
// approval as the canonical node:
//   requirements.md  ▸  spec.md  ▸  (first seen)
// ───────────────────────────────────────────────────────────────────────────

interface DiscoveredSpecFile {
  readonly filePath: string;
  readonly parsed: ParsedSpec;
  readonly fileName: string;
}

/** Canonical-file precedence within a split-layout id group (lower = preferred). */
function specFileRank(fileName: string): number {
  const lower = fileName.toLowerCase();
  if (lower === 'requirements.md') return 0;
  if (lower === 'spec.md') return 1;
  if (lower === 'design.md') return 2;
  if (lower === 'tasks.md') return 3;
  return 4;
}

/**
 * Walk the specs dir recursively, parse every `.md` carrying a frontmatter `id`,
 * and return one canonical `ParsedSpec` per spec id (split-layout deduped). The
 * returned map is id → discovered file (carrying the path the human should open).
 */
function discoverSpecs(rootDir: string): Map<string, DiscoveredSpecFile> {
  const byId = new Map<string, DiscoveredSpecFile>();
  let specsDir: string;
  try {
    const config = loadConfig(rootDir);
    specsDir = resolveAndValidate(rootDir, config.specsDir);
  } catch {
    return byId;
  }
  if (!fs.existsSync(specsDir)) return byId;

  const stack = [specsDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      let parsed: ParsedSpec;
      try {
        parsed = parseSpec(fs.readFileSync(full, 'utf-8'));
      } catch {
        continue; // unparseable — skip
      }
      const id = parsed.frontmatter.id;
      if (!id) continue;
      const candidate: DiscoveredSpecFile = { filePath: full, parsed, fileName: entry.name };
      const existing = byId.get(id);
      if (!existing || specFileRank(entry.name) < specFileRank(existing.fileName)) {
        byId.set(id, candidate);
      }
    }
  }
  return byId;
}

// ───────────────────────────────────────────────────────────────────────────
// Implement-phase hole (#1436) — the `phase-action` node source.
//
// The resolver is Tier-0 and may not touch a filesystem, so the "is this spec's
// implement phase finished?" question is answered HERE and travels to it as
// `SpecNode.implementHole` — the same seam `hasUnresolvedOpenQuestions` uses.
// This computes a HOLE, never a severity or an ordering: that stays in the
// resolver (INV-CONSUME).
// ───────────────────────────────────────────────────────────────────────────

/**
 * A task line. Leading whitespace is allowed so an indented sub-task counts,
 * matching what `spec.ts`'s `parseTasks` already does (it trims before testing
 * its own `TASK_RE`, so the two agree on indentation).
 *
 * The one deliberate WIDENING over `spec.ts` is `[~]` (in progress), which that
 * regex does not match at all. A spec whose last task is underway would
 * otherwise read as finished, and the human would be told they are clear
 * mid-task. Counting it as open is the honest reading. #1465 tracks converging
 * the two into a single shared predicate.
 */
const TASK_LINE_RE = /^\s*- \[([ xX~])\]\s+(.+?)\s*$/;

/**
 * A fenced code block delimiter, capturing the fence character and its run
 * length. Both matter: per CommonMark a fence is closed only by a fence of the
 * SAME character that is at least as long, so a `~~~` inside a ``` block, or a
 * 3-backtick fence inside a 4-backtick block, is literal text and must not
 * close anything. Tracking only "saw a fence, flip a boolean" mis-pairs those
 * and can leave the flag stuck, hiding every task after it — which would put
 * the signpost right back to reading "clear" while work is pending (#1436).
 */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Longest `nextItem` handed to the resolver; the imperative is a ONE-LINE surface. */
const NEXT_ITEM_MAX = 80;

/**
 * Reduce a markdown task line to plain readable text: unwrap links, drop
 * emphasis marks, collapse whitespace, then clip to one line's worth.
 *
 * Emphasis is stripped only OUTSIDE inline-code spans. The text inside
 * backticks is almost always the identifier or path the human has to act on
 * (`snake_case_name`, `packages/**\/*.test.ts`), and blanket-stripping `*` and
 * `_` renames it to something that does not exist. Clipping walks code POINTS,
 * not UTF-16 units, so it can never split a surrogate pair and emit a lone
 * half. Pure and deterministic.
 */
function taskItemText(raw: string, softWrapped = false): string {
  // Split on backticks: even indices are outside code spans, odd are inside.
  const clean = raw
    .split('`')
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_]/g, '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const points = Array.from(clean);
  if (points.length > NEXT_ITEM_MAX) {
    return `${points.slice(0, NEXT_ITEM_MAX - 1).join('').trimEnd()}…`;
  }
  // A soft-wrapped item continues on the next source line. Say so, rather than
  // presenting the first line as if it were the whole task.
  return softWrapped ? `${clean}…` : clean;
}

/** Tally of open/total task items, plus the first open item's text. */
interface TaskTally {
  total: number;
  remaining: number;
  nextItem?: string;
  /** A fence was still open at EOF, so anything after it was swallowed. */
  unterminatedFence?: boolean;
}

/**
 * Count checkbox lines in a markdown body, ignoring fenced code blocks.
 * Checkbox-shaped lines inside a fence are documentation examples, not work.
 */
function tallyTaskLines(body: string): TaskTally {
  const lines = body.split('\n');
  let fence: string | undefined; // the OPEN fence's marker, or undefined
  const tally: TaskTally = { total: 0, remaining: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      if (fence === undefined) {
        fence = f[1];
        continue;
      }
      // Close only on the same character, at least as long as the opener.
      if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const m = TASK_LINE_RE.exec(line);
    if (!m) continue;
    tally.total++;
    if (m[1] === 'x' || m[1] === 'X') continue;
    tally.remaining++;
    if (tally.nextItem === undefined) {
      // Peek: an indented, non-checkbox, non-blank next line continues this item.
      const nxt = lines[i + 1];
      const softWrapped =
        nxt !== undefined &&
        /^\s+\S/.test(nxt) &&
        !TASK_LINE_RE.test(nxt) &&
        !FENCE_RE.test(nxt);
      tally.nextItem = taskItemText(m[2], softWrapped);
    }
  }
  if (fence !== undefined) tally.unterminatedFence = true;
  return tally;
}

/**
 * The spec's implement-phase hole, or `undefined` when there is none.
 *
 * Reads BOTH layouts MinSpec supports, because the extension ships into repos
 * this monorepo's own conventions do not describe (constitution invariant 3):
 *   - SPLIT layout — a sibling `tasks.md` next to the canonical spec file.
 *   - SINGLE-FILE layout — a `## Tasks` / `## Implement` section in the spec
 *     itself, already parsed into `phaseSections` by `parseSpec`.
 * Split wins when both exist; the sections are the fallback, so a single-file
 * spec is never mislabelled as having no task list at all.
 *
 * An unreadable `tasks.md` degrades to `missing-tasks` rather than throwing
 * (INV-DEGRADE): the human is still pointed at the right spec.
 */
function readImplementHole(disc: DiscoveredSpecFile): ImplementHole | undefined {
  let tally: TaskTally = { total: 0, remaining: 0 };

  const tasksPath = path.join(path.dirname(disc.filePath), 'tasks.md');
  let splitBody: string | undefined;
  try {
    if (fs.existsSync(tasksPath)) {
      const raw = fs.readFileSync(tasksPath, 'utf-8');
      // OWNERSHIP. Sharing a directory is not the same as owning the file. A
      // flat layout can put several specs' canonical files side by side (this
      // repo does exactly that at specs/<product>/), and attributing a
      // neighbour's task list to this spec would report someone else's progress
      // as its own. Claim the file only when its `id:` says so; a tasks.md with
      // no id at all is still accepted, since the scaffolder's output and older
      // hand-written lists predate the convention.
      const owner = /^id:\s*(\S+)/m.exec(frontmatterBlock(raw))?.[1];
      if (owner === undefined || owner === disc.parsed.frontmatter.id) splitBody = raw;
    }
  } catch {
    /* unreadable — fall through to the single-file sections, then missing-tasks */
  }

  if (splitBody !== undefined) {
    tally = tallyTaskLines(splitBody);
  } else {
    // Single-file layout: whichever phase section carries the checkboxes.
    for (const phase of ['tasks', 'implement'] as const) {
      const body = disc.parsed.phaseSections[phase]?.body;
      if (body === undefined) continue;
      const t = tallyTaskLines(body);
      tally = {
        total: tally.total + t.total,
        remaining: tally.remaining + t.remaining,
        nextItem: tally.nextItem ?? t.nextItem,
        // Carry the flag through the merge. Dropping it here would let a
        // single-file spec whose open tasks are swallowed by an unterminated
        // fence report "no hole" — the same false all-clear the split branch
        // guards against, just one layout over.
        unterminatedFence: tally.unterminatedFence || t.unterminatedFence,
      };
    }
  }

  // No task list anywhere — or one with no items in it. Either way the spec is
  // being implemented with nothing tracking that work.
  if (tally.total === 0) return { kind: 'missing-tasks' };
  // An unterminated fence swallowed the rest of the file, so "nothing left
  // open" is not something we actually know. Reporting no hole here would put
  // a green tick on a spec whose remaining work is simply unreadable, which is
  // the exact failure #1436 exists to remove. Report it as untracked instead:
  // wrong in the harmless direction, and it points at the file to fix.
  if (tally.remaining === 0 && tally.unterminatedFence) return { kind: 'missing-tasks' };
  if (tally.remaining === 0) return undefined; // every item checked → no hole
  return {
    kind: 'unchecked-tasks',
    remaining: tally.remaining,
    total: tally.total,
    nextItem: tally.nextItem,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public adapter API.
// ───────────────────────────────────────────────────────────────────────────

/**
 * An index from artifact id → the file path a human should open to act on it.
 * Built alongside the graph so the command/status-bar layer can reveal a target
 * without re-walking the tree. Corruption nodes may point at a dangling id with
 * no entry here — the caller skips the open in that case (never throws).
 */
export function artifactFileIndex(rootDir: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const e of listEpics(rootDir)) index.set(e.id, e.filePath);
  for (const a of listAdrs(rootDir)) index.set(a.id, a.filePath);
  for (const [id, disc] of discoverSpecs(rootDir)) index.set(id, disc.filePath);
  return index;
}

/**
 * Build the resolver's `ArtifactGraph` from the real workspace at `rootDir`.
 * Pure mapping over the existing readers + the project's own `deriveStatus`.
 * Missing dirs ⇒ empty arrays (INV-DEGRADE). Never throws on a well-formed call;
 * the caller still wraps it in try/catch for defense-in-depth.
 */
export function buildArtifactGraph(rootDir: string): ArtifactGraph {
  const goalRanks = buildGoalRankMap(rootDir);
  const edges: Edge[] = [];

  // Load epics ONCE; reuse for EpicNode[] and for canonicalising membership refs.
  const epicSummaries = listEpics(rootDir);

  // MinSpec allows `epic:` refs in EITHER id form (`EPIC-004`) or kebab-slug form
  // (`telemetry`) — `resolveEpic` accepts both, case-insensitively. The Tier-0
  // resolver indexes epics by `id` ONLY, so a slug ref would look like a dangling
  // ref and the signpost would confidently report "state unclear" for a valid
  // spec. Canonicalise to the resolved epic's id here; keep the raw stripped ref
  // when genuinely unresolvable so real danglers still surface as corruption.
  const canonicalEpic = (ref: string | undefined): string | undefined => {
    if (ref === undefined) return undefined;
    return resolveEpic(ref, epicSummaries)?.id ?? epicRefValue(ref);
  };

  // ── Epics ──────────────────────────────────────────────────────────────
  const epics: EpicNode[] = [];
  for (const e of epicSummaries) {
    let fmBlock = '';
    try {
      fmBlock = frontmatterBlock(fs.readFileSync(e.filePath, 'utf-8'));
    } catch {
      /* unreadable — no edges/goal for this epic */
    }
    edges.push(...edgesFrom(fmBlock, e.id));
    epics.push({
      id: e.id,
      status: EPIC_STATUS_MAP[e.status],
      order: e.order,
      goalRank: goalRankOf(fmBlock, goalRanks),
      priority: undefined,
    });
  }

  // ── Specs ──────────────────────────────────────────────────────────────
  const specs: SpecNode[] = [];
  for (const [id, disc] of discoverSpecs(rootDir)) {
    const fm = disc.parsed.frontmatter;
    const fmBlock = frontmatterBlock(disc.parsed.raw);

    // CRITICAL (INV-FIDELITY): derive, never read the literal `status:` line.
    const approvalState: ApprovalStatus = getApprovalStatus(rootDir, disc.filePath);
    const explicitTerminal: ExplicitTerminal = fm.status === 'archived' ? 'archived' : undefined;
    const derived: SpecStatus = deriveStatus(fm.phases, approvalState, explicitTerminal);

    edges.push(...edgesFrom(fmBlock, id));
    specs.push({
      id,
      status: SPEC_STATUS_MAP[derived],
      tier: fm.tier,
      phase: getCurrentPhase(fm.phases) ?? undefined,
      epic: canonicalEpic(fm.epic),
      approvalState: APPROVAL_STATE_MAP[approvalState],
      goalRank: goalRankOf(fmBlock, goalRanks),
      priority: undefined,
      // #1436 phase-action source. Computed for every spec; the resolver decides
      // which ones it acts on (only approved + implementing specs qualify), so
      // the gate stays in ONE place rather than being half-encoded here.
      implementHole: readImplementHole(disc),
    });
  }

  // ── ADRs ───────────────────────────────────────────────────────────────
  const adrs: AdrNode[] = [];
  for (const a of listAdrs(rootDir)) {
    let fmBlock = '';
    try {
      fmBlock = frontmatterBlock(fs.readFileSync(a.filePath, 'utf-8'));
    } catch {
      /* unreadable — no edges/goal for this ADR */
    }
    edges.push(...edgesFrom(fmBlock, a.id));
    adrs.push({
      id: a.id,
      status: ADR_STATUS_MAP[a.status],
      epic: canonicalEpic(a.epic), // canonicalise id|slug → EPIC-NNN (see canonicalEpic)
      goalRank: goalRankOf(fmBlock, goalRanks),
      priority: undefined,
    });
  }

  // Omit `edges` entirely when none found (the resolver handles absent).
  const graph: ArtifactGraph = { epics, specs, adrs };
  if (edges.length > 0) (graph as { edges?: Edge[] }).edges = edges;
  return graph;
}
