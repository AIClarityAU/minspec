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
/** A decision item: `**D1.`, `- **DQ-2 —`, `### DQ-1 (…)`, `Q3:` at the start of a line. */
const ITEM = /^\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?\**(?:D|DQ|Q|OQ)-?\d+\b/;
/** "ALL RESOLVED", "All four questions are RESOLVED", "all answered". */
const ALL_RESOLVED = /\ball\b[^.\n]{0,40}\b(?:resolved|answered|decided)\b/i;

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
    if (ALL_RESOLVED.test(sec)) continue;
    for (const line of sec.split('\n')) {
      if (!ITEM.test(line)) continue;
      const label = /(?:D|DQ|Q|OQ)-?\d+/.exec(line)?.[0];
      if (label !== undefined && !items.includes(label)) items.push(label);
    }
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
