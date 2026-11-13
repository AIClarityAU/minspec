/**
 * Open Clarify questions in a spec (#3059, same gap class as #1480).
 *
 * A spec whose "Decisions needed (Clarify)" section still holds an unanswered decision is
 * not ready to approve: the approval bounces at re-review and costs a re-approval cycle.
 * Delegated approval (DLG-001, DR-108) has no human reading the spec, so it must refuse
 * visibly rather than admit one.
 *
 * Pure text predicate, shared by the delegated-approval CLI and its caller so the two
 * witnesses cannot drift. Fail closed: a section that lists decision items is OPEN unless
 * it says, in its heading or body, that ALL of them are resolved/answered/decided.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const DECISIONS_NEEDED = /decisions?\s+needed/i;
/** A decision item: `**D1.`, `- **DQ-2 —`, `### DQ-1 (…)`, `Q3:`, or a letter label `### DQ-A` (#3230), at the start of a line. */
const ITEM = /^\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?\**(?:D|DQ|Q|OQ)(?:-?\d+|-[A-Z])\b/;
/**
 * A numbered decision with a bold lead, `1. **Where the gate lives.**` (SPEC-225). Missed
 * before, so a spec whose decisions were a numbered list read as having none open.
 */
const NUMBERED_ITEM = /^\s*(\d+)[.)]\s+\*\*/;
/**
 * Legacy escape, HEADING LINE ONLY (`## Decisions needed (Clarify) — ALL RESOLVED 2026-08-14`).
 * Body prose never closes a section (#3699): a sentence saying "all N decisions were decided"
 * describes a state, it does not record one, and anyone can write it.
 */
const ALL_RESOLVED = /\ball\b[^.\n]{0,40}\b(?:resolved|answered|decided)\b/i;
/**
 * A per-decision record: the item's own block carries a selection line, e.g.
 * `**Recorded selection: Option (a),** ...`, `**Resolved: Option A.**`, `RESOLVED 2026-08-23 - Option A`, `RESOLVED: (d).`.
 * Who made the selection is deliberately not judged here (policy for DR-119's owner).
 */
const SELECTION =
  /\b(?:recorded\s+selection|resolved|selected|chosen|decided)\b\s*(?:[:*(]|\w+\s*[:*])|\bnot a choice\b/i;
const SELECTION_UPPER = /\bRESOLVED\b/;

export interface ClarifyVerdict {
  readonly open: boolean;
  /** Item labels still open, e.g. `D1`, `DQ-2`. Empty when `open` is false. */
  readonly items: readonly string[];
}

/** Every "Decisions needed" section's text (heading line included), by heading level. */
function sections(content: string): string[] {
  const lines = content.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = HEADING.exec(lines[i]);
    if (!h || !DECISIONS_NEEDED.test(h[2])) continue;
    const level = h[1].length;
    const body = [lines[i]];
    let fence = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j])) fence = !fence;
      const nh = fence ? null : HEADING.exec(lines[j]);
      // A sub-heading that is itself a decision item stays inside the section.
      if (nh && nh[1].length <= level && !ITEM.test(lines[j])) break;
      body.push(lines[j]);
    }
    out.push(body.join('\n'));
  }
  return out;
}

export function findOpenClarify(content: string): ClarifyVerdict {
  const items: string[] = [];
  for (const sec of sections(content)) {
    const lines = sec.split('\n');
    if (ALL_RESOLVED.test(lines[0])) continue;
    // Split into per-item blocks; an item is open unless its own block records a selection.
    // A label restated later (summary list, then a detail heading) is one decision: answered
    // if any of its blocks records a selection.
    const seen: string[] = [];
    const answered = new Set<string>();
    let label: string | undefined;
    let block: string[] = [];
    const flush = (): void => {
      if (label === undefined) return;
      if (!seen.includes(label)) seen.push(label);
      if (block.some((l) => SELECTION.test(l) || SELECTION_UPPER.test(l))) answered.add(label);
    };
    for (const line of lines.slice(1)) {
      const l = ITEM.test(line) ? /(?:D|DQ|Q|OQ)(?:-?\d+|-[A-Z])\b/.exec(line)?.[0] : NUMBERED_ITEM.exec(line)?.[1];
      if (l !== undefined) {
        flush();
        label = l;
        block = [line];
      } else block.push(line);
    }
    flush();
    for (const l of seen) if (!answered.has(l) && !items.includes(l)) items.push(l);
  }
  return { open: items.length > 0, items };
}

/** One-line refusal detail, or undefined when nothing is open. */
export function openClarifyDetail(content: string): string | undefined {
  const v = findOpenClarify(content);
  return v.open
    ? `open Clarify decision(s) under "Decisions needed": ${v.items.join(', ')}; answer them before approval`
    : undefined;
}
