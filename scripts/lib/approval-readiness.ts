/**
 * Approval readiness of a spec body: is it safe to ASK for an approval of this text now?
 *
 * Why (RCDD, 2026-11-14): the founder's 2026-11-12 approvals of SPEC-213, SPEC-217 and
 * SPEC-227 were asked for while each body still declared itself unfinished ("`phases.clarify`
 * stays `pending`", "the spec is not ready to approve", "FR-10 needs rewriting in Clarify
 * before Plan"). He approved; review then refused the sign-offs (#3680-#3682) because the
 * body contradicted the approved frontmatter; fixing the body (#3696) changed the hashed
 * bytes and voided his approvals, so he signed a second time. The pre-flight that should have
 * held the asks was a model reading a prose checklist, and nothing deterministic sat between
 * "the spec says it is not finished" and "ask the founder to sign it".
 *
 * Any wording this module flags makes an approval self-defeating: either the approved body
 * becomes a false signpost the moment the frontmatter flips, or a known edit is still owed and
 * will void the approval when it lands. Editing an UNAPPROVED spec is free, so the remedy is
 * always "fix the body first, then ask".
 *
 * Scope boundary: SPEC-327 (specifying) specifies a corpus-wide validator for lifecycle prose
 * in spec bodies. This module is narrower: it answers one question at ask time, for one spec,
 * and also covers deferred-edit markers and self-declared not-ready text, which SPEC-327 does
 * not. When SPEC-327 lands, its validator should be called from here so the two cannot drift
 * (follow-up tracked on #3691, SPEC-327's issue).
 *
 * What it cannot see: a requirement that silently contradicts a recorded Clarify selection
 * with no marker in the text. That needs reading, not a regex; the deferred-edit rule catches
 * the case where the author who recorded the selection said the edit was still owed (the
 * SPEC-227 FR-10 case).
 *
 * Pure text predicate, offline, never writes.
 */

import { findOpenClarify } from './clarify-open';

export type ReadinessRule = 'open-clarify' | 'self-declared-not-ready' | 'pending-phase-prose' | 'deferred-edit';

export interface ReadinessProblem {
  readonly rule: ReadinessRule;
  /** 1-based line in the file (frontmatter counted) where the match starts. */
  readonly line: number;
  /** The matched text (or, for open-clarify, the open item labels). */
  readonly text: string;
}

const PHASE = '(?:specify|clarify|plan|tasks|implement)';
const OPEN_VALUE = '(?:pending|open|in[- ]progress|unresolved)';
const STAYS = '(?:stays|remains|stay|remain|is\\s+still|is\\s+left)';

const RULES: ReadonlyArray<{ rule: ReadinessRule; re: RegExp }> = [
  // "the spec is not ready to approve", "not yet ready for approval"
  { rule: 'self-declared-not-ready', re: /\bnot\s+(?:yet\s+)?ready\s+(?:to\s+(?:be\s+)?approv\w*|for\s+(?:its\s+)?approval)/gi },
  // "`phases.clarify` stays `pending`"
  { rule: 'pending-phase-prose', re: new RegExp(`\\bphases?\\.${PHASE}\\b[^.;:]{0,40}?\\b${STAYS}\\s+${OPEN_VALUE}\\b`, 'gi') },
  // "Clarify stays open", "This section stays open", "the clarify phase remains pending"
  {
    rule: 'pending-phase-prose',
    re: new RegExp(`\\b(?:${PHASE}(?:\\s+(?:phase|section|stage))?|this\\s+section)\\s+${STAYS}\\s+${OPEN_VALUE}\\b`, 'gi'),
  },
  // "Clarify is pending". Never a bare "Clarify pending": that is also the title of issue
  // #3104, cited in SPEC-296 (corpus survey 2026-11-14).
  { rule: 'pending-phase-prose', re: /\bclarify\s+is\s+pending\b/gi },
  // "This spec is unapproved", "this spec is not yet approved". Only THIS spec: "some spec is
  // unapproved" (SPEC-314) describes another spec and stays true after approval.
  { rule: 'pending-phase-prose', re: /\bthis\s+spec(?:ification)?\s+is\s+(?:still\s+)?(?:unapproved|not\s+(?:yet\s+)?approved)\b/gi },
  // "FR-10 needs rewriting", "FR-10 therefore needs rewriting", "AC-2 must be updated"
  {
    rule: 'deferred-edit',
    re: /\b(?:FR|NFR|AC|INV)-?\d+\b[^.;]{0,50}?\b(?:still\s+)?(?:needs?|must\s+be|has\s+to\s+be|is\s+to\s+be)\s+(?:re-?writ\w*|rework\w*|amend\w*|updat\w*|chang\w*|edit\w*)/gi,
  },
  // "needs rewriting in Clarify before Plan"
  { rule: 'deferred-edit', re: /\b(?:needs?|requires?)\s+(?:a\s+)?re-?writ\w*\s+(?:in|during|before)\s+(?:clarify|plan|approval)\b/gi },
  // "this record does not edit FR-10"
  { rule: 'deferred-edit', re: /\bdoes\s+not\s+(?:yet\s+)?(?:edit|rewrite|amend|update)\s+(?:FR|NFR|AC|INV)-?\d+/gi },
];

/** Same length as the input, so offsets still map to lines; masked text never matches. */
function mask(s: string): string {
  return s.replace(/[^\n]/g, ' ');
}

/**
 * The body with frontmatter, fenced code and quoted examples blanked out (line count kept),
 * and inline-code backticks blanked so "`phases.clarify` stays `pending`" reads as prose.
 */
function scannable(content: string): string {
  const lines = content.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
    const stop = end === -1 ? lines.length - 1 : end;
    for (; i <= stop; i++) lines[i] = '';
  }
  let fence = false;
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fence = !fence;
      lines[i] = '';
      continue;
    }
    if (fence) lines[i] = '';
  }
  let text = lines.join('\n');
  // Quoted examples: straight or curly double quotes, may wrap one line. A spec about this
  // rule must be able to quote the wording it forbids.
  text = text.replace(/"[^"\n]*(?:\n[^"\n]*)?"/g, mask).replace(/“[^”]*”/g, mask);
  return text.replace(/`/g, ' ');
}

export function bodyReadinessProblems(content: string): ReadinessProblem[] {
  const text = scannable(content);
  // Collapse line breaks into spaces (same length) so a phrase wrapped across lines matches,
  // but never across a blank line (paragraph break).
  const flat = text.replace(/\n(?!\s*\n)/g, ' ');
  const lineAt = (offset: number): number => text.slice(0, offset).split('\n').length;
  const out: ReadinessProblem[] = [];
  const seen = new Set<string>();
  for (const { rule, re } of RULES) {
    for (const m of flat.matchAll(re)) {
      const line = lineAt(m.index ?? 0);
      const key = `${rule}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rule, line, text: m[0].replace(/\s+/g, ' ').trim() });
    }
  }
  const clarify = findOpenClarify(content);
  if (clarify.open) {
    const at = content.split('\n').findIndex((l) => /^#{1,6}\s+.*decisions?\s+needed/i.test(l));
    out.push({ rule: 'open-clarify', line: at + 1, text: `no recorded selection for ${clarify.items.join(', ')}` });
  }
  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Statuses at which a spec is still waiting for its approval. Anything later is already approved. */
const ASKABLE_STATUS = new Set(['new', 'specifying']);

export interface ReadinessInput {
  /** Frontmatter `status:` value as read now (pre-flight check 4: re-read at ask time). */
  readonly status: unknown;
  /** What the Approve Spec command itself would refuse with (`specNotApprovable`), or undefined. */
  readonly notApprovable: string | undefined;
  readonly content: string;
}

export interface ReadinessVerdict {
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export function readinessVerdict(input: ReadinessInput): ReadinessVerdict {
  const reasons: string[] = [];
  if (!ASKABLE_STATUS.has(String(input.status))) {
    reasons.push(`status: ${String(input.status)} is already past the approval gate; do not ask again`);
  }
  if (input.notApprovable) reasons.push(`approve-command: ${input.notApprovable}`);
  for (const p of bodyReadinessProblems(input.content)) reasons.push(`line ${p.line} ${p.rule}: ${p.text}`);
  return { ready: reasons.length === 0, reasons };
}
