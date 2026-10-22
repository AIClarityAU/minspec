/**
 * constitution-compaction.ts — SPEC-025 FR-8 (offer to compact).
 *
 * A PURE function that strips the DRAFT scaffolding from a constitution: the
 * `DRAFT:` markers and the review-time provenance lines/blockquotes (FR-7), and
 * tightens whitespace — meaning-preserving (the rule text survives; only the
 * scaffolding is removed). Returns the compacted markdown plus a diff-summary so
 * the caller can require human confirmation (FR-8: never silent). A constitution
 * with no DRAFT/provenance returns `unchanged: true` (no silent rewrite).
 *
 * Pure logic, no vscode dependency.
 */

import { prepareText, restoreLineEndings } from './text-io';

/** Result of compacting a constitution (FR-8). */
export interface CompactionResult {
  readonly compacted: string;
  readonly strippedDraftMarkers: number;
  readonly strippedProvenance: number;
  /** True when nothing was stripped (no DRAFT/provenance) — no silent rewrite. */
  readonly unchanged: boolean;
}

/** A provenance blockquote line (review-time only). */
function isProvenanceLine(line: string): boolean {
  return line.trim().startsWith('> _proposed because');
}

/**
 * Strip a leading `DRAFT:` from a list item's text, returning [newLine, wasStripped].
 * Preserves the bullet/number prefix and indentation; only removes the marker.
 */
function stripDraftMarker(line: string): [string, boolean] {
  // Match indentation + bullet/number + optional space + DRAFT:
  const m = line.match(/^(\s*(?:[-*]|\d+\.)\s+)DRAFT:\s*(.*)$/);
  if (!m) return [line, false];
  return [`${m[1]}${m[2]}`, true];
}

/**
 * Compact a constitution (FR-8). Strips DRAFT markers + provenance lines and
 * tightens runs of blank lines. Meaning-preserving: rule text is retained.
 *
 * Works on the LF form of `content`, and `compacted` is given back the line endings
 * `content` had (SPEC-095 FR-2/FR-3). On CRLF text the DRAFT-marker pattern
 * (`(.*)$`, no multiline flag) matched nothing, so the markers were left in place.
 */
export function compactConstitution(content: string): CompactionResult {
  if (typeof content !== 'string' || content.length === 0) {
    return { compacted: content ?? '', strippedDraftMarkers: 0, strippedProvenance: 0, unchanged: true };
  }

  const text = prepareText(content);
  let strippedDraftMarkers = 0;
  let strippedProvenance = 0;
  const out: string[] = [];

  for (const line of text.split('\n')) {
    if (isProvenanceLine(line)) {
      strippedProvenance++;
      continue; // drop the provenance blockquote entirely
    }
    const [stripped, wasStripped] = stripDraftMarker(line);
    if (wasStripped) strippedDraftMarkers++;
    out.push(stripped);
  }

  // Tighten: collapse 3+ blank lines to a single blank line, trim trailing space.
  let compacted = out.join('\n').replace(/\n{3,}/g, '\n\n');
  // Preserve a single trailing newline if the original had one.
  compacted = compacted.replace(/\s+$/, '') + (text.endsWith('\n') ? '\n' : '');

  const unchanged = strippedDraftMarkers === 0 && strippedProvenance === 0;
  // Never silently rewrite: if nothing was stripped, return the original verbatim.
  return {
    compacted: unchanged ? content : restoreLineEndings(compacted, content),
    strippedDraftMarkers,
    strippedProvenance,
    unchanged,
  };
}
