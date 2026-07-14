/**
 * Constitution parser — extracts invariants, principles, and constraints
 * from .minspec/constitution.md.
 * Pure logic, no vscode dependency.
 */

/** Parsed constitution sections */
export interface Constitution {
  readonly invariants: string[];
  readonly principles: string[];
  readonly constraints: string[];
}

/** Empty constitution (no rules defined) */
export const EMPTY_CONSTITUTION: Constitution = {
  invariants: [],
  principles: [],
  constraints: [],
};

/**
 * Extract list items from a markdown section body.
 * Supports both numbered lists (1. item) and bullet lists (- item / * item).
 * Skips HTML comments (<!-- ... -->).
 *
 * A list item may WRAP across several physical lines (the corpus hard-wraps
 * long invariants at ~90 cols). Those continuation lines are joined back into
 * the owning item with a single space, so the full item text is preserved —
 * not just its first physical line (#705: the earlier per-line parser dropped
 * every continuation, truncating multi-line invariants mid-sentence). An item
 * ends at the next list marker, a blank line, or a heading/comment.
 */
function extractListItems(body: string): string[] {
  const items: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) {
      items.push(current.trim());
      current = null;
    }
  };
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    // Blank line, comment, or heading closes the current item.
    if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('#')) {
      flush();
      continue;
    }
    // Numbered list: "1. item text"
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      flush();
      current = numberedMatch[1].trim();
      continue;
    }
    // Bullet list: "- item" or "* item"
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flush();
      current = bulletMatch[1].trim();
      continue;
    }
    // Otherwise this is a wrapped continuation of the current item.
    if (current !== null) {
      current += ' ' + trimmed;
    }
    // (A stray non-list line before any marker is ignored, as before.)
  }
  flush();
  return items;
}

/**
 * The lead sentence of a constitution item, for the harness mirrors that
 * summarize the constitution (CLAUDE.md / AGENTS.md / .cursorrules). The
 * constitution itself keeps the full text — these mirrors show only the lead
 * sentence plus a pointer back to it (#705).
 *
 * Prefers a bold lead ("**Title.**", the corpus convention); otherwise the
 * first sentence up to a terminator followed by whitespace or end-of-string.
 * Falls back to the full text when the item carries no sentence terminator, so
 * a mirror never emits a dangling half-sentence.
 */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const boldLead = trimmed.match(/^\*\*[\s\S]+?[.!?]\*\*/);
  if (boldLead) return boldLead[0];
  const sentence = trimmed.match(/^[\s\S]+?[.!?](?=\s|$)/);
  if (sentence) return sentence[0];
  return trimmed;
}

/**
 * Parse sections from markdown content delimited by ## headings.
 * Returns a map of heading (lowercased) → body text.
 */
function parseSectionsLower(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      sections.set(currentHeading.toLowerCase(), currentBody.join('\n'));
    }
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Parse a constitution markdown file into structured data.
 * Extracts items from ## Invariants, ## Principles, and ## Constraints sections.
 */
export function parseConstitution(content: string): Constitution {
  if (!content || !content.trim()) {
    return EMPTY_CONSTITUTION;
  }

  const sections = parseSectionsLower(content);

  return {
    invariants: extractListItems(sections.get('invariants') ?? ''),
    principles: extractListItems(sections.get('principles') ?? ''),
    constraints: extractListItems(sections.get('constraints') ?? ''),
  };
}
