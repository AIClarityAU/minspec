/**
 * issue-rank.ts — rank dispatchable issues by what they are worth, not when they
 * arrived (#2196). PURE: no fs, no network, no clock. The IO shell is
 * scripts/rank-issues.ts; the proof is packages/minspec/tests/issue-rank.test.ts.
 *
 * The drain used to dispatch in `sort -un` order — lowest issue number first, i.e.
 * arrival order. Dispatch cost varies 28-fold (28k to 778k billed tokens across 46
 * measured dispatches), so arrival order spends the budget on whatever is oldest.
 *
 * ── The order (founder-approved on #2196, 2026-09-28), strictly lexicographic ──
 *   1. unblocks — how many other OPEN issues this one unblocks, transitively. DESC.
 *   2. spec rank — the signpost's STRUCTURAL position of the spec (or epic) the
 *      issue explicitly serves. ASC; an issue that serves none sorts after every
 *      linked one (that is a real signal, not a gap to paper over).
 *   3. tier — quick wins, as a tiebreaker only, never the lead term. ASC.
 *   4. issue number — ASC. The old behaviour, demoted to the final tiebreak. GitHub
 *      assigns numbers monotonically, so this IS creation order.
 * Lexicographic, never a weighted score: a score would let enough of a lower term
 * outvote a higher one, which is exactly what the approved ordering rules out.
 *
 * ── What counts as an edge — explicit declarations ONLY ──────────────────────
 * Measured on the open corpus (#2196): 12% of issues declare a blocking relation,
 * 75% merely cite another issue. A citation is not an edge; inferring edges from
 * citations would manufacture an authoritative-looking wrong graph. So an issue with
 * no declaration unblocks 0 and FALLS THROUGH to term 2 — it is not ranked as
 * unimportant. The accepted forms are documented on `parseDeclaredBlockers`. The
 * second edge source is GitHub's native issue dependency (Issue.blockedBy), which the
 * shell fetches in the same paged query.
 *
 * ── Status-blind ─────────────────────────────────────────────────────────────
 * The spec term never reads a spec's `status:`. SPEC-021, SPEC-033 and SPEC-063 all
 * self-report `implementing` with no implementation, so status is not evidence.
 * `structuralOrder` takes only the structural dials the signpost sorts on.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A precise triage tier, or a READY-CLASS range when only the class is known.
 * `agent-ready` is a full build (triaged T1/T2); `agent-ready-specify` is a
 * specify-only dispatch of a T3/T4 (#1169, DR-076).
 */
export type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T1-T2' | 'T3-T4';

/** One OPEN issue as the fetch returned it. */
export interface IssueRecord {
  number: number;
  title: string;
  body: string;
  labels: readonly string[];
  /** GitHub-native "blocked by" relations (issue numbers), when the fetch included them. */
  blockedBy?: readonly number[];
}

/**
 * The signpost's structural order, flattened to positions (0 = first). Specs sort by
 * their epic's `order:`, then goal rank, then priority, then id — the dials of
 * `compareRanked` in packages/shared/src/next-task.ts, minus its status-derived
 * severity class. Each epic also gets a slot of its own directly after its specs, so
 * an issue linked only to an epic ranks after that epic's specs and before the next
 * epic's.
 */
export interface StructuralOrder {
  size: number;
  /** Normalised spec id (`SPEC-012`) → position. */
  spec: ReadonlyMap<string, number>;
  /** Lower-cased epic id AND slug → the epic's own slot. */
  epic: ReadonlyMap<string, { position: number; id: string }>;
}

export interface RankContext {
  /** Every OPEN issue number. Only these count toward `unblocks` or carry edges. */
  open: ReadonlySet<number>;
  /** The fetched open issues — the edge source, candidates or not. */
  issues: readonly IssueRecord[];
  order: StructuralOrder;
  /** A precise tier when one is known; overrides the ready-class proxy. */
  tiers?: ReadonlyMap<number, Tier>;
}

export interface RankedIssue {
  number: number;
  /** Distinct OPEN issues reachable through declared blocking edges, excluding itself. */
  unblocks: number;
  unblocked: readonly number[];
  /** Open issues this one itself waits on. Informational — it never affects rank. */
  waitsOn: readonly number[];
  specRank: number | null;
  /** The explicit link that produced `specRank` (`SPEC-012` / `EPIC-009`). */
  link: string | null;
  tier: Tier | null;
  /** False when the candidate was not among the fetched open issues. */
  hasData: boolean;
  reasons: { unblocks: string; spec: string; tier: string; number: string };
}

// ─── The declaration grammar ─────────────────────────────────────────────────

// Mirrors BLOCKED_BY_LINE_RE in .github/scripts/ai-review-guard.js — as HARDENED by
// PR #2135 (#2134), not as it stands on main today. That pattern had three distinct
// quadratic-backtracking mechanisms: `*` in two adjacent quantifiers, `\s` in two
// adjacent quantifiers, and `\s` crossing line ends under the `m` flag so every line
// start became an anchor doing unbounded work. Issue bodies are public, attacker-
// writable input and this parses EVERY open issue, so the same care applies:
//   - leading decoration is ONE bounded quantifier, `[\s>*_-]{0,64}`;
//   - the text is split into lines FIRST (on every CommonMark line ending) and each
//     regex runs on one line with no `m` flag, so each line anchors once;
//   - every regex matches a PREFIX only and ends in a literal or `\b` — never a
//     trailing `(.*)$`. A fourth mechanism, found in review of this file's first
//     draft and specific to running WITHOUT the `m` flag (the guard uses `m`, where
//     `$` also matches before `\r`/U+2028, so it does not have this one): `.` does
//     not match `\r` or U+2028 while `\s` does, so `\s*:?\s*(.*)$` on a line with an
//     embedded `\r` cannot reach `$` and backtracks over every split of the
//     whitespace run — measured CUBIC, 3s at 2,000 spaces. The remainder of the line
//     is taken by `slice`, not by a capture group;
//   - the ref run is read by a hand-written scanner, not a regex, because the natural
//     regex for "refs separated by commas/and/whitespace" puts two `\s*` side by side.
// The timing tests in issue-rank.test.ts vary the input alphabet per mechanism.
const DECL_LINE_RE = /^[\s>*_-]{0,64}(?:blocked\s+by|depends\s+on)\b/i;
const DECL_HEADING_RE = /^#{1,6}[ \t]+(?:blocked[ \t]+by|depends[ \t]+on)\b/i;
const ANY_HEADING_RE = /^#{1,6}(?:[ \t]|$)/;
const LIST_ITEM_RE = /^[ \t]{0,8}(?:[-*+]|\d{1,3}[.)])[ \t]/;
const LINE_END_RE = /\r\n|\r|\n/;

/**
 * After a declaring phrase: closing bold, spaces, one optional colon, and closing bold
 * again — so both `**Blocked by** #1` and `**Blocked by:** #1` read. Linear scan.
 */
function afterDeclaration(rest: string): string {
  let i = 0;
  const skip = (c: string) => {
    while (rest[i] === c) i++;
  };
  skip('*');
  while (rest[i] === ' ' || rest[i] === '\t') i++;
  if (rest[i] === ':') i++;
  skip('*');
  return rest.slice(i);
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t';
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/**
 * The LEADING run of `#N` refs in `s`, separated by commas, `and`, or whitespace.
 * Scanning stops at the first token that is none of those, so a trailing explanation
 * ("Blocked by #1225 — merged as proposed in #1246") cannot smuggle in a second
 * blocker. Linear: every character is visited at most once.
 */
function leadingRefs(s: string): number[] {
  const out: number[] = [];
  let i = 0;
  const n = s.length;
  for (;;) {
    const mark = i;
    while (i < n && isSpace(s[i])) i++;
    if (out.length > 0) {
      if (s[i] === ',') {
        i++;
      } else if (s.slice(i, i + 3).toLowerCase() === 'and' && !/[A-Za-z0-9_]/.test(s[i + 3] ?? '')) {
        i += 3;
      }
      while (i < n && isSpace(s[i])) i++;
    }
    if (s[i] !== '#' || !isDigit(s[i + 1] ?? '')) {
      i = mark;
      break;
    }
    i++;
    const start = i;
    while (i < n && isDigit(s[i])) i++;
    // `#12abc` is not a ref (mirrors the `\b` after `#\d+` in the guard).
    if (/[A-Za-z0-9_]/.test(s[i] ?? '')) break;
    out.push(Number(s.slice(start, i)));
  }
  return out;
}

/**
 * Issue numbers a body DECLARES as blockers. Sorted, de-duplicated.
 *
 * Accepted forms (case-insensitive):
 *
 *   1. A declaring LINE — `Blocked by` or `Depends on`, at the start of a line after
 *      optional markdown decoration (`- `, `> `, `**`), optional colon, then refs:
 *          Blocked by #1225
 *          Blocked by: #1225, #1179
 *          - **Blocked by** #53 (calibration single-writer decision)
 *          Depends on #1002 (hold reason must be machine-readable first)
 *
 *   2. A declaring HEADING — `## Blocked by` / `## Depends on` (any level, any trailing
 *      text), then list items up to the next heading or thematic break (`---`):
 *          ## Blocked by (all must close)
 *          - #489 — Signal-1 root cause is agent-self-reported
 *          - #490 — ...
 *
 * In both forms only the LEADING ref run counts (see `leadingRefs`), so prose never
 * mints an edge: "blocked by a stale cache; see #1225", "#1225 was blocked by design",
 * "Depends on the seam landing first (#12)", "Depends on / extends #448" all yield
 * nothing. Cross-repo refs (`owner/repo#N`) are not local edges and yield nothing.
 *
 * Differences from the PR-body guard, each measured on the open corpus (#2196):
 *   - `Depends on` is accepted. The guard rejects it because PR bodies say "depends
 *     on" as narrative — but narrative never LEADS with a ref, and the leading-ref rule
 *     already rejects it (#258 "Depends on the SPEC-012 resolver", #450 "Depends on /
 *     extends #448"), while #1004 "Depends on #1002" is a genuine declaration.
 *   - The heading form is accepted: #55 and #499 declare their blockers that way and
 *     the line form alone misses all four edges.
 *   - `Blocks #N`, `Prerequisite for #N` are NOT accepted: zero line-anchored uses in
 *     the corpus, so a grammar for them would be a guess. The forward direction is
 *     covered by GitHub's native relation, which the shell fetches.
 */
export function parseDeclaredBlockers(body: string | null | undefined): number[] {
  const found = new Set<number>();
  let inSection = false;
  for (const line of String(body ?? '').split(LINE_END_RE)) {
    if (ANY_HEADING_RE.test(line)) {
      inSection = DECL_HEADING_RE.test(line);
      continue;
    }
    if (inSection && isThematicBreak(line)) {
      inSection = false;
      continue;
    }
    const decl = DECL_LINE_RE.exec(line);
    if (decl) {
      for (const n of leadingRefs(afterDeclaration(line.slice(decl[0].length)))) found.add(n);
      continue;
    }
    if (inSection) {
      const item = LIST_ITEM_RE.exec(line);
      if (item) for (const n of leadingRefs(line.slice(item[0].length))) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** `---`, `***`, `___` (spaces allowed between). Linear: no regex over the line. */
function isThematicBreak(line: string): boolean {
  const compact = line.replace(/[ \t]/g, '');
  if (compact.length < 3) return false;
  const c = compact[0];
  if (c !== '-' && c !== '*' && c !== '_') return false;
  for (const ch of compact) if (ch !== c) return false;
  return true;
}

// ─── Explicit issue → spec/epic links ────────────────────────────────────────

const SPEC_ID_RE = /\bSPEC-(\d{1,6})\b/gi;
const EPIC_LABEL_RE = /^epic:(.+)$/i;

/** `SPEC-12`, `spec-0012` → `SPEC-012` (the signpost's id shape). */
export function normaliseSpecId(id: string): string | null {
  const m = /^SPEC-(\d{1,6})$/i.exec(id.trim());
  return m ? `SPEC-${String(Number(m[1])).padStart(3, '0')}` : null;
}

/**
 * The spec/epic links an issue DECLARES: every SPEC id in the TITLE (the repo's
 * convention is `feat(SPEC-063): ...`), and every `epic:<id-or-slug>` label. A SPEC id
 * in the BODY is a citation, not a link, and is never read. Triage verdict records and
 * the issue templates carry no spec field, so these are the only explicit forms.
 */
export function explicitLinks(issue: Pick<IssueRecord, 'title' | 'labels'>): { specs: string[]; epics: string[] } {
  const specs: string[] = [];
  for (const m of issue.title.matchAll(SPEC_ID_RE)) {
    const id = normaliseSpecId(m[0]);
    if (id && !specs.includes(id)) specs.push(id);
  }
  const epics: string[] = [];
  for (const label of issue.labels) {
    const m = EPIC_LABEL_RE.exec(label);
    const ref = m?.[1].trim().toLowerCase();
    if (ref && !epics.includes(ref)) epics.push(ref);
  }
  return { specs, epics };
}

// ─── Tier ────────────────────────────────────────────────────────────────────

/**
 * The quick-win proxy from the ready class. No per-issue cost estimate exists before
 * dispatch, and the precise tier lives in the triage verdict record (a comment), so the
 * label is the proxy: `agent-ready` → T1-T2, `agent-ready-specify` → T3-T4. Both or
 * neither → unknown. A hand-set label can lie (#983) — acceptable for an ORDER, which
 * is not a gate; dispatch-issue.sh still re-validates the verdict record.
 */
export function tierFromLabels(labels: readonly string[]): Tier | null {
  const full = labels.includes('agent-ready');
  const specify = labels.includes('agent-ready-specify');
  if (full === specify) return null;
  return full ? 'T1-T2' : 'T3-T4';
}

/**
 * Sort key for term 3 (lower = quicker win). A range sorts at its midpoint. UNKNOWN
 * sorts at 2.5 — the midpoint of the whole T1..T4 scale, i.e. its expected value when
 * nothing is known — so it is neither favoured (it follows every T1/T2 and T1-T2) nor
 * buried (it precedes every T3/T4 and T3-T4).
 */
export function tierKey(tier: Tier | null): number {
  switch (tier) {
    case 'T1':
      return 1;
    case 'T1-T2':
      return 1.5;
    case 'T2':
      return 2;
    case 'T3':
      return 3;
    case 'T3-T4':
      return 3.5;
    case 'T4':
      return 4;
    default:
      return 2.5;
  }
}

// ─── Structural order (status-blind) ─────────────────────────────────────────

/** The status-free subset of the signpost's ArtifactGraph this reads. */
export interface StructuralGraph {
  epics: readonly { id: string; order?: number; goalRank?: number; priority?: number }[];
  specs: readonly { id: string; epic?: string; goalRank?: number; priority?: number }[];
}

const ID_RE = /^([A-Z]+)-(\d+)$/i;

/** Mirror of next-task.ts `compareIds` (not exported there): prefix, then number. */
function compareIds(a: string, b: string): number {
  const ma = ID_RE.exec(a);
  const mb = ID_RE.exec(b);
  if (ma && mb) {
    const pa = ma[1].toUpperCase();
    const pb = mb[1].toUpperCase();
    if (pa !== pb) return pa < pb ? -1 : 1;
    const na = Number(ma[2]);
    const nb = Number(mb[2]);
    if (na !== nb) return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const INF = Number.POSITIVE_INFINITY;

/**
 * Flatten the signpost's structural dials into positions. The key per spec is
 * (its epic's `order`, goalRank, priority, id) — next-task.ts `compareRanked` without
 * its leading `classRank`, which is derived from status and so excluded here. An
 * epic's own slot sorts after every spec sharing its `order` value. The argument type
 * has no `status` field on purpose: passing a real ArtifactGraph works, and nothing
 * here can read what it does not declare.
 *
 * `slugs` maps epic id → slug so an `epic:<slug>` label resolves as well as
 * `epic:EPIC-009`.
 */
export function structuralOrder(graph: StructuralGraph, slugs?: ReadonlyMap<string, string>): StructuralOrder {
  const epicOrder = new Map<string, number>();
  for (const e of graph.epics) epicOrder.set(e.id.toUpperCase(), e.order ?? INF);

  interface Slot {
    kind: 0 | 1; // 0 = spec, 1 = epic slot (after its specs)
    id: string;
    epicOrder: number;
    goalRank: number;
    priority: number;
  }
  const slots: Slot[] = [];
  for (const s of graph.specs) {
    const id = normaliseSpecId(s.id);
    if (!id) continue;
    slots.push({
      kind: 0,
      id,
      epicOrder: s.epic ? (epicOrder.get(s.epic.toUpperCase()) ?? INF) : INF,
      goalRank: s.goalRank ?? INF,
      priority: s.priority ?? INF,
    });
  }
  for (const e of graph.epics) {
    slots.push({ kind: 1, id: e.id.toUpperCase(), epicOrder: e.order ?? INF, goalRank: INF, priority: INF });
  }
  slots.sort((a, b) => {
    if (a.epicOrder !== b.epicOrder) return a.epicOrder < b.epicOrder ? -1 : 1;
    if (a.kind !== b.kind) return a.kind - b.kind;
    if (a.goalRank !== b.goalRank) return a.goalRank < b.goalRank ? -1 : 1;
    if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
    return compareIds(a.id, b.id);
  });

  const spec = new Map<string, number>();
  const epic = new Map<string, { position: number; id: string }>();
  slots.forEach((slot, position) => {
    if (slot.kind === 0) {
      if (!spec.has(slot.id)) spec.set(slot.id, position);
      return;
    }
    const entry = { position, id: slot.id };
    epic.set(slot.id.toLowerCase(), entry);
    const slug = slugs?.get(slot.id) ?? slugs?.get(slot.id.toLowerCase());
    if (slug) epic.set(slug.toLowerCase(), entry);
  });
  return { size: slots.length, spec, epic };
}

// ─── The blocking graph ──────────────────────────────────────────────────────

export interface BlockingGraph {
  /** blocker → issues it blocks (both OPEN). */
  next: ReadonlyMap<number, ReadonlySet<number>>;
  /** blocked → its OPEN blockers. */
  prev: ReadonlyMap<number, ReadonlySet<number>>;
  /** Distinct edges, and how many each source contributed (an edge can come from both). */
  edgeCount: number;
  fromBody: number;
  fromNative: number;
}

/**
 * Every declared blocker → blocked edge between OPEN issues. An edge needs both ends
 * open: a closed blocker is already done, and a closed blocked issue is not waiting.
 * Records not in `ctx.open` are ignored (a stale record cannot contribute an edge).
 */
export function blockingGraph(ctx: Pick<RankContext, 'open' | 'issues'>): BlockingGraph {
  const next = new Map<number, Set<number>>();
  const prev = new Map<number, Set<number>>();
  let edgeCount = 0;
  let fromBody = 0;
  let fromNative = 0;
  const seen = new Set<number>();
  for (const rec of ctx.issues) {
    if (!ctx.open.has(rec.number) || seen.has(rec.number)) continue;
    seen.add(rec.number);
    const body = new Set(parseDeclaredBlockers(rec.body));
    const native = new Set(rec.blockedBy ?? []);
    for (const blocker of new Set([...body, ...native])) {
      if (blocker === rec.number || !ctx.open.has(blocker)) continue;
      if (body.has(blocker)) fromBody++;
      if (native.has(blocker)) fromNative++;
      if (!next.has(blocker)) next.set(blocker, new Set());
      if (!prev.has(rec.number)) prev.set(rec.number, new Set());
      next.get(blocker)!.add(rec.number);
      prev.get(rec.number)!.add(blocker);
      edgeCount++;
    }
  }
  return { next, prev, edgeCount, fromBody, fromNative };
}

/** Distinct OPEN issues reachable from `start`, excluding `start`. Cycle-safe (visited set). */
function reachable(start: number, graph: BlockingGraph): number[] {
  const visited = new Set<number>([start]);
  const queue = [start];
  const out: number[] = [];
  while (queue.length > 0) {
    const n = queue.shift() as number;
    for (const m of graph.next.get(n) ?? []) {
      if (visited.has(m)) continue;
      visited.add(m);
      out.push(m);
      queue.push(m);
    }
  }
  return out.sort((a, b) => a - b);
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

const refs = (ns: readonly number[]): string => ns.map((n) => `#${n}`).join(', ');

function tierReason(tier: Tier | null, explicit: boolean): string {
  if (tier === null) return 'unknown (mid-way: after T1-T2, before T3-T4)';
  if (explicit) return `${tier} (triage verdict)`;
  return tier === 'T1-T2' ? 'T1-T2 (agent-ready)' : 'T3-T4 (agent-ready-specify)';
}

/** The total order: unblocks DESC, spec rank ASC (none last), tier ASC, number ASC. */
export function compareRanked(a: RankedIssue, b: RankedIssue): number {
  if (a.unblocks !== b.unblocks) return b.unblocks - a.unblocks;
  const sa = a.specRank ?? INF;
  const sb = b.specRank ?? INF;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ta = tierKey(a.tier);
  const tb = tierKey(b.tier);
  if (ta !== tb) return ta - tb;
  return a.number - b.number;
}

/**
 * Rank `candidates` (the dispatchable set). The output is exactly the de-duplicated
 * candidate set — a candidate missing from `ctx.issues` is ranked with no data (0
 * unblocks, no link, unknown tier) and a reason saying so; it never vanishes.
 */
export function rankIssues(candidates: readonly number[], ctx: RankContext): RankedIssue[] {
  const graph = blockingGraph(ctx);
  const byNumber = new Map<number, IssueRecord>();
  for (const rec of ctx.issues) if (ctx.open.has(rec.number) && !byNumber.has(rec.number)) byNumber.set(rec.number, rec);

  const ranked = [...new Set(candidates)].map((number): RankedIssue => {
    const rec = byNumber.get(number);
    const hasData = rec !== undefined;

    const unblocked = hasData ? reachable(number, graph) : [];
    const waitsOn = [...(graph.prev.get(number) ?? [])].sort((a, b) => a - b);
    let unblocksReason: string;
    if (!hasData) {
      unblocksReason = '0 — not in the fetched open issues (closed, or not returned)';
    } else if (unblocked.length > 0) {
      unblocksReason = `unblocks ${unblocked.length}: ${refs(unblocked)}`;
    } else {
      unblocksReason = '0 — no open issue waits on it; falls through';
    }
    if (waitsOn.length > 0) unblocksReason += `; itself waits on ${refs(waitsOn)}`;

    let specRank: number | null = null;
    let link: string | null = null;
    let specReason: string;
    if (!rec) {
      specReason = 'none — no data';
    } else {
      const { specs, epics } = explicitLinks(rec);
      const unknown: string[] = [];
      for (const id of specs) {
        const pos = ctx.order.spec.get(id);
        if (pos === undefined) unknown.push(id);
        else if (specRank === null || pos < specRank) [specRank, link] = [pos, id];
      }
      for (const ref of epics) {
        const e = ctx.order.epic.get(ref);
        if (!e) unknown.push(`epic:${ref}`);
        else if (specRank === null || e.position < specRank) [specRank, link] = [e.position, e.id];
      }
      if (specRank !== null) {
        specReason = `${link} (${specRank + 1} of ${ctx.order.size})`;
      } else if (unknown.length > 0) {
        specReason = `none — ${unknown.join(', ')} not in the structural order`;
      } else {
        specReason = 'none — no SPEC-NNN in the title, no epic: label';
      }
    }

    const explicitTier = ctx.tiers?.get(number);
    const tier = explicitTier ?? (rec ? tierFromLabels(rec.labels) : null);

    return {
      number,
      unblocks: unblocked.length,
      unblocked,
      waitsOn,
      specRank,
      link,
      tier,
      hasData,
      reasons: {
        unblocks: unblocksReason,
        spec: specReason,
        tier: tierReason(tier, explicitTier !== undefined),
        number: `#${number}`,
      },
    };
  });
  return ranked.sort(compareRanked);
}
