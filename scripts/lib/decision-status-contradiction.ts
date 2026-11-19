/**
 * `decision.status-contradiction` (#1812): one document that marks the SAME decision id
 * both open and resolved.
 *
 * A spec states a decision's status in several registers on purpose (frontmatter comment,
 * normative FR body, Clarify block, DR note), so resolving a decision in one place leaves
 * the others stale. ai-review caught it twice in consecutive PRs (#1658, #1797), each time
 * post-push. This is the deterministic, local backstop for the mechanically detectable case.
 *
 * Deliberately NOT a general consistency checker. It matches only this repo's own
 * conventional markers, scoped to decision ids (`D<n>`, `OQ<n>`, `PQ<n>`). A contradiction
 * phrased outside those forms is missed; ai-review stays the backstop for the rest.
 *
 * Pure text predicate. Fenced code blocks are ignored.
 */

const ID = /\b(?:D|OQ|PQ)-?\d+\b/g;
const normId = (s: string): string => s.replace('-', '');

/** `D2/D3/D4 remain open`, `D1 ... still **open**`, `D1 is still open`, `Decision needed — D1`. */
const OPEN_MARKER =
  /\bstill\s+[*_]*open\b|\bremains?\s+[*_]*open\b|\bDecision\s+needed\s*[—–:-]/gi;
/** `RESOLVED 2026-09-05 — x`, `resolved 2026-09-05`, `D1 RESOLVED`, `**Resolved:** x`. */
const RESOLVED_MARKER =
  /\bRESOLVED\b|\b(?:resolved|Resolved)\s+\d{4}-\d{2}-\d{2}\b|\b(?:resolved|Resolved)[*_]*\s*:/g;
/**
 * A line that DEFINES a decision block: `**D1.`, `- **OQ2 —`, `### D3 (…)`, `D1:`. Sets the
 * block's id. Prose that merely starts with an id (`D1 is still open.`) does not open a block.
 */
const BLOCK_START =
  /^\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?[*_]*((?:D|OQ|PQ)-?\d+)(?=[*_]*\s*(?:[.:—–(-]|$))/;
const HEADING = /^#{1,6}\s/;

export interface DecisionContradiction {
  readonly id: string;
  /** 1-indexed line of the first open marker naming `id`. */
  readonly openLine: number;
  /** 1-indexed line of the first resolution marker naming `id`. */
  readonly resolvedLine: number;
}

interface Pos {
  readonly start: number;
  readonly end: number;
}

function positions(re: RegExp, line: string): Pos[] {
  return [...line.matchAll(re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

function idsIn(line: string): string[] {
  return [...line.matchAll(ID)].map((m) => normId(m[0]));
}

export function findDecisionContradictions(content: string): DecisionContradiction[] {
  const open = new Map<string, number>();
  const resolved = new Map<string, number>();
  let inFence = false;
  let blockId: string | undefined;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const start = BLOCK_START.exec(line);
    if (start) blockId = normId(start[1]);
    else if (HEADING.test(line)) blockId = undefined;

    const own = idsIn(line);
    const resolvedAt = positions(RESOLVED_MARKER, line);
    const openAt = positions(OPEN_MARKER, line);
    if (resolvedAt.length === 0 && openAt.length === 0) continue;
    const record = (map: Map<string, number>, id: string): void => {
      if (!map.has(id)) map.set(id, i + 1);
    };
    if (new Set(own).size <= 1) {
      // Single id (or none): a line carrying both says the decision moved ("was open, now
      // RESOLVED"): resolved wins, never a self-contradiction.
      if (resolvedAt.length > 0) {
        // A bare `RESOLVED <date> — x` line belongs to the decision block it sits in.
        const ids = own.length > 0 ? own : blockId ? [blockId] : [];
        for (const id of ids) record(resolved, id);
      } else {
        for (const id of own) record(open, id);
      }
      continue;
    }
    // Several ids on one line: each id takes the status marker nearest to it, so a summary
    // like `D1 RESOLVED 2026-09-01; D2/D3 remain open` keeps D1 resolved and D2/D3 open.
    // `;` separates independent clauses, so a marker never reaches across one.
    const clauseOf = (pos: number): number => line.slice(0, pos).split(';').length;
    for (const m of line.matchAll(ID)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      const dist = (p: { start: number; end: number }): number =>
        p.end <= at ? at - p.end : p.start >= end ? p.start - end : 0;
      const nearest = (ps: Pos[]): number =>
        Math.min(...ps.filter((p) => clauseOf(p.start) === clauseOf(at)).map(dist), Infinity);
      const r = nearest(resolvedAt);
      const o = nearest(openAt);
      if (r === Infinity && o === Infinity) continue;
      record(r <= o ? resolved : open, normId(m[0]));
    }
  }
  const out: DecisionContradiction[] = [];
  for (const [id, openLine] of open) {
    const resolvedLine = resolved.get(id);
    if (resolvedLine !== undefined) out.push({ id, openLine, resolvedLine });
  }
  return out;
}
