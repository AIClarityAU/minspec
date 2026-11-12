/**
 * Delegation citations in spec bodies (#3463, split from #3411).
 *
 * A spec that says an act was done "under delegation DLG-001" claims that delegation's
 * authority for that act. `.minspec/delegations.json` lists what each delegation `covers`;
 * nothing read the claim, so 25 specs said Clarify selections were recorded under DLG-001
 * (which covers only spec-approval and engineering-dr-acceptance) and only some ai-review
 * panels caught it.
 *
 * Pure text predicate. A sentence is a CITATION when it names a delegation id after
 * "under" ("under delegation DLG-001", "under DLG-001"). Its act is read from the
 * sentence with parentheticals removed (a parenthetical names the record, e.g. "the
 * delegated-approval record", not the act). The citation is WRONG when the sentence's act
 * is one no `covers` entry licenses. Covered acts are mapped to words below; an
 * unrecognised sentence is not flagged (a wrong FATAL is worse than a miss), so the map
 * is deliberately about the acts that actually occur: recording/selecting/answering.
 */

export interface Delegation {
  readonly id: string;
  readonly covers: readonly string[];
}

export interface CitationFinding {
  readonly line: number;
  readonly delegation: string;
  readonly act: string;
  readonly sentence: string;
}

/** Words that name an act, per `covers` entry. Every other act word is uncovered. */
const COVERED_ACT_WORDS: Readonly<Record<string, RegExp>> = {
  'spec-approval': /\b(?:approv\w*|ratif\w*)\b/i,
  'engineering-dr-acceptance': /\b(?:accept\w*)\b/i,
};

/** Acts that no current `covers` entry licenses: authoring a Clarify answer. */
const UNCOVERED_ACT = /\b(?:recorded|record|selected|selection|chose|chosen|answered|decided|resolved)\b/i;

const CITES = /\bunder\s+(?:the\s+)?(?:delegation\s+)?(DLG-\d+)\b/i;
/** Disclaimers state the delegation did NOT do the act; they are not citations of authority. */
const NEGATED = /\b(?:no|none|not|never|neither|nor|without)\b/i;

function stripParens(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, ' ');
  } while (s !== prev);
  return s;
}

/** Findings for one spec body against the known delegations. */
export function findWrongDelegationCitations(
  content: string,
  delegations: readonly Delegation[],
): CitationFinding[] {
  const byId = new Map(delegations.map(d => [d.id.toUpperCase(), d]));
  const out: CitationFinding[] = [];
  const lines = content.split('\n');
  let para: Array<{ text: string; line: number }> = [];
  let inFence = false;

  const flush = (): void => {
    if (para.length === 0) return;
    const joined = para.map(p => p.text.trim()).join(' ');
    const startLine = para[0].line;
    para = [];
    for (const raw of joined.split(/(?<=[.!?])\s+/)) {
      const cite = CITES.exec(raw);
      if (!cite) continue;
      const sentence = stripParens(raw);
      const m = CITES.exec(sentence);
      if (!m) continue;
      const d = byId.get(m[1].toUpperCase());
      const covered = (d?.covers ?? []).some(c => COVERED_ACT_WORDS[c]?.test(sentence));
      const act = UNCOVERED_ACT.exec(sentence);
      if (covered || !act || NEGATED.test(sentence)) continue;
      out.push({ line: startLine, delegation: m[1].toUpperCase(), act: act[0].toLowerCase(), sentence: raw.trim() });
    }
  };

  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (l.trim() === '') flush();
    else para.push({ text: l, line: i + 1 });
  });
  flush();
  return out;
}

/**
 * Specs the #3411 correction note lists (docs/corrections/2026-10-31-dlg-001-clarify-citation.md).
 * Their text cannot change (the approval hash binds it), so they are exempt BY ID, never by
 * pattern. Every entry is a hole in the gate; do not add a spec here that is not in the note.
 */
export const CORRECTED_SPECS: readonly string[] = [
  'SPEC-203', 'SPEC-204', 'SPEC-208', 'SPEC-209', 'SPEC-210', 'SPEC-214', 'SPEC-215', 'SPEC-231',
  'SPEC-240', 'SPEC-241', 'SPEC-242', 'SPEC-243', 'SPEC-245', 'SPEC-246', 'SPEC-247', 'SPEC-248',
  'SPEC-249', 'SPEC-250', 'SPEC-251', 'SPEC-252', 'SPEC-253', 'SPEC-254', 'SPEC-256', 'SPEC-257',
];

/** True when a spec file path sits under a directory named for an exempt spec id. */
export function isCorrectedSpec(relPath: string): boolean {
  return relPath
    .split('/')
    .some(seg => CORRECTED_SPECS.some(id => seg === id || seg.startsWith(`${id}-`)));
}
