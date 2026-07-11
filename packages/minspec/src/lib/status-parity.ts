/**
 * Deterministic body↔frontmatter status parity (#626).
 *
 * The #362 backfill found ~20-29 approvables whose frontmatter `status:` disagrees with
 * the body status line — because status-correction / re-approval commits flip the
 * frontmatter field to match the approval record and leave the prose header stale, and
 * nothing checked the two agree. This is the recurring VALIDATOR-ASYMMETRY class:
 * present-and-valid is checked, but cross-representation PARITY of the same fact is not.
 * In a never-wrong-signpost product, two disagreeing status readouts in one file is the
 * worst defect class.
 *
 * This is a pure, deterministic check (no LLM). It extracts the leading RECOGNISED status
 * token from the body status line and compares it to the frontmatter status. It is
 * deliberately CONSERVATIVE: a body line whose leading token is not a recognised status
 * word (free-form prose like "Clarify complete — awaiting Approve") yields NO finding, so
 * it can never false-positive — a false validator error would block a legitimate commit,
 * which the never-wrong invariant forbids.
 *
 * Body status conventions:
 *   - spec: a `**Status:** <word> …` line (the `<word>` may be followed by free prose).
 *   - DR:   a `## Status` heading, then the first non-empty line's leading word.
 */

/** Which artifact family — decides the recognised status vocabulary. */
export type ArtifactKind = 'spec' | 'dr';

/** SPEC_STATUSES (spec.ts) — the closed spec status enum. */
const SPEC_STATUS_WORDS: ReadonlySet<string> = new Set([
  'new',
  'specifying',
  'implementing',
  'done',
  'archived',
  'superseded',
]);

/** AdrStatus (adr-manager.ts) — the closed DR status enum. */
const DR_STATUS_WORDS: ReadonlySet<string> = new Set([
  'proposed',
  'accepted',
  'deprecated',
  'superseded',
]);

function statusWords(kind: ArtifactKind): ReadonlySet<string> {
  return kind === 'spec' ? SPEC_STATUS_WORDS : DR_STATUS_WORDS;
}

export interface BodyStatus {
  /** The recognised leading status token, lowercased. */
  readonly token: string;
  /** 1-based line number of the body status line (for the diagnostic). */
  readonly line: number;
}

/**
 * Extract the body status line's leading RECOGNISED status token, or null when there is
 * no body status line, or its leading token is not a recognised status word (free-form).
 * Returning null on an unrecognised token is what makes the parity check false-positive
 * free.
 */
export function bodyStatusToken(content: string, kind: ArtifactKind): BodyStatus | null {
  const lines = content.split('\n');
  const words = statusWords(kind);

  if (kind === 'spec') {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\*\*Status:\*\*\s*([A-Za-z]+)/);
      if (m) {
        const token = m[1].toLowerCase();
        return words.has(token) ? { token, line: i + 1 } : null;
      }
    }
    return null;
  }

  // DR: the `## Status` section — the first non-empty line after the heading.
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Status\b/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j].trim();
        if (!line) continue;
        const m = line.match(/^([A-Za-z]+)/);
        if (!m) return null;
        const token = m[1].toLowerCase();
        return words.has(token) ? { token, line: j + 1 } : null;
      }
      return null;
    }
  }
  return null;
}

export interface StatusParityFinding {
  /** frontmatter `status:` value (lowercased). */
  readonly frontmatter: string;
  /** the body line's recognised status token (lowercased). */
  readonly body: string;
  /** 1-based line of the body status line. */
  readonly line: number;
}

/**
 * Returns a parity finding when the body's recognised status token disagrees with the
 * frontmatter status; otherwise null. Null (consistent / not comparable) when: frontmatter
 * status is empty, there is no body status line, or the body's leading token is free-form
 * (unrecognised). Never throws.
 */
export function checkStatusParity(
  content: string,
  frontmatterStatus: string | undefined,
  kind: ArtifactKind,
): StatusParityFinding | null {
  // Frontmatter values may carry a trailing `# inline comment` (e.g.
  // `status: implementing  # harness built …`) — strip it and take the leading token,
  // so a status that AGREES but is annotated never false-positives.
  const fm = (frontmatterStatus ?? '')
    .replace(/\s*#.*$/, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0] ?? '';
  if (!fm) return null;
  const body = bodyStatusToken(content, kind);
  if (!body) return null;
  if (body.token === fm) return null;
  return { frontmatter: fm, body: body.token, line: body.line };
}
