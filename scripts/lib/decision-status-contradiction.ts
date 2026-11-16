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
  /\bstill\s+[*_]*open\b|\bremains?\s+[*_]*open\b|\bDecision\s+needed\s*[—–:-]/i;
/** `RESOLVED 2026-09-05 — x`, `resolved 2026-09-05`, `D1 RESOLVED`, `**Resolved:** x`. */
const RESOLVED_MARKER = /\bRESOLVED\b|\bresolved\s+\d{4}-\d{2}-\d{2}\b|\bresolved\s*:/;
/** A line that opens a decision block: `**D1.`, `- **OQ2 —`, `### D3 (…)`. Sets the block's id. */
const BLOCK_START = /^\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?[*_]*((?:D|OQ|PQ)-?\d+)\b/;
const HEADING = /^#{1,6}\s/;

export interface DecisionContradiction {
  readonly id: string;
  /** 1-indexed line of the first open marker naming `id`. */
  readonly openLine: number;
  /** 1-indexed line of the first resolution marker naming `id`. */
  readonly resolvedLine: number;
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
    const isResolved = RESOLVED_MARKER.test(line);
    const isOpen = OPEN_MARKER.test(line);
    // A line carrying both says the decision moved ("was open, now RESOLVED"): resolved wins,
    // never a self-contradiction.
    if (isResolved) {
      // A bare `RESOLVED <date> — x` line belongs to the decision block it sits in.
      const ids = own.length > 0 ? own : blockId ? [blockId] : [];
      for (const id of ids) if (!resolved.has(id)) resolved.set(id, i + 1);
    } else if (isOpen) {
      for (const id of own) if (!open.has(id)) open.set(id, i + 1);
    }
  }
  const out: DecisionContradiction[] = [];
  for (const [id, openLine] of open) {
    const resolvedLine = resolved.get(id);
    if (resolvedLine !== undefined) out.push({ id, openLine, resolvedLine });
  }
  return out;
}
