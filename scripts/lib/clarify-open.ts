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
 * its HEADING line says ALL of them are resolved/answered/decided, or each item's own block
 * records a selection (see SELECTION). Body prose never closes a section.
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
 * `**Recorded selection: Option (a),** ...`, `**Resolved: Option A.**`, `RESOLVED 2026-08-23 - Option A`,
 * `RESOLVED: (d).`, `→ RESOLVED: out of scope`, `**Recorded answer: yes, ...**`.
 * Who made the selection is deliberately not judged here (policy for DR-119's owner).
 *
 * The keyword alone is not a record (#3701 review). It counts only when it
 * - opens a clause: line start, or after `.` `!` `;` `:` `]` `|` `>` `→`, or after a dash that has whitespace before it
 *   (`-` `–` `—`; never a hyphen inside a word or an option label's `)`), markdown
 *   emphasis allowed. So "Not yet decided:", "To be decided", "What is decided here:", "gets
 *   chosen" and "Status: NOT RESOLVED" never count, wherever they sit, the label line included;
 * - is followed by a separator (`:`, `—`, `–`, ` - `), a parenthetical (`(2026-07-12, founder):`)
 *   or an ISO date, and then a value. Only the upper-case status stamp `RESOLVED` may be
 *   followed directly by a word (`RESOLVED for the declaration`). A bare keyword never counts;
 * - carries a value that is not a placeholder (TBD, pending, open, not yet, none, `?`) and is
 *   not a question (a sentence-ending `?`, outside code spans, before the first full stop). A
 *   separator ending its line takes its value from the next line (`**Recorded selection:**`
 *   wrapped).
 */
const KEYWORD = /\b(?:recorded\s+(?:selection|answer)|resolved|selected|chosen|decided)\b/gi;
const CLAUSE_START = /(?:^|[.!;:\]|>→]|\s[-–—])[\s*_]*$/;
const SEPARATOR = /^[*_\s]*(?::|—|–|-(?=\s)|\d{4}-\d{2}-\d{2}\b)/;
const PAREN = /^[*_\s]*\(([^)\n]*)\)[*_\s]*(?::|—|–|-(?=\s))?/;
const PLACEHOLDER = /^(?:tbd|tbc|pending|open|unresolved|undecided|not\s+yet|none\b|n\/a|\?)/i;

function isValue(text: string): boolean {
  const v = text.replace(/^[*_\s,]+/, '');
  if (v === '' || PLACEHOLDER.test(v)) return false;
  // A question is not an answer: no sentence-ending `?` (code spans aside) before the first full stop.
  return !/^[^.]*\?(?=[\s*_)]|$)/.test(v.replace(/`[^`]*`/g, '``'));
}

/** `line` plus, when a separator ends it, the line after: the value of a wrapped record. */
function recordsSelection(line: string, next = ''): boolean {
  for (const m of line.matchAll(KEYWORD)) {
    const at = m.index ?? 0;
    if (!CLAUSE_START.test(line.slice(0, at))) continue;
    const tail = line.slice(at + m[0].length);
    const sep = SEPARATOR.exec(tail);
    if (sep) {
      const rest = tail.slice(sep[0].length);
      if (isValue(/^[*_\s]*$/.test(rest) ? next : rest)) return true;
      continue;
    }
    const paren = PAREN.exec(tail);
    if (paren) {
      if (isValue(paren[1]) && isValue(tail.slice(paren[0].length))) return true;
      continue;
    }
    if (m[0] === 'RESOLVED' && /^\s+\S/.test(tail) && isValue(tail)) return true;
  }
  return false;
}

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
      if (block.some((l, i) => recordsSelection(l, block[i + 1]))) answered.add(label);
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

/**
 * The Clarify PHASE must be recorded as finished (#3102). The text heuristic above only
 * sees decision items it can recognise; a spec with no detectable decision text and
 * `phases.clarify: pending` slipped past it. SDD FR-2 requires Clarify for T3-T4, and a
 * delegated approval has no human to notice it never happened, so the phase field itself
 * is checked, as a second witness beside the text.
 */
const CLARIFY_RECORDED = new Set(['done', 'skipped']);

function frontmatterBlock(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return [];
  const end = lines.indexOf('---', 1);
  return end === -1 ? [] : lines.slice(1, end);
}

/** `phases.clarify` as written (comment stripped), or undefined when absent. */
export function clarifyPhase(content: string): string | undefined {
  const fm = frontmatterBlock(content);
  const start = fm.findIndex((l) => /^phases:\s*(#.*)?$/.test(l));
  if (start === -1) return undefined;
  for (let i = start + 1; i < fm.length && /^\s+\S/.test(fm[i]); i++) {
    const m = /^\s+clarify:\s*["']?([A-Za-z-]+)["']?\s*(?:#.*)?$/.exec(fm[i]);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

/**
 * One-line refusal detail when a T3/T4 spec's Clarify phase is not recorded done/skipped,
 * or undefined. T1/T2 never required Clarify, so they are not judged here. Fail closed:
 * a T3/T4 spec with no readable `phases.clarify` is refused.
 */
export function clarifyPhaseDetail(content: string, tier: string | undefined): string | undefined {
  if (tier !== 'T3' && tier !== 'T4') return undefined;
  const phase = clarifyPhase(content);
  if (phase !== undefined && CLARIFY_RECORDED.has(phase)) return undefined;
  return `${tier} spec has phases.clarify: ${phase ?? '(absent)'}; the Clarify phase must be done or skipped before approval`;
}
