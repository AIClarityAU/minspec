/**
 * Does a spec carry every line of a founder answer? (SPEC-033 D-11 incident, 2026-11-26.)
 *
 * A founder answer reaches a spec through a runner-queue item, and that item can grow after
 * it is filed: the proxy appends a later line as an `update` record. A reader that sees only
 * the first record, or only some fields, drops the later lines silently. These helpers read
 * EVERY record of the item, take each quote marked verbatim, and report which ones the spec
 * does not contain. Pure text functions, no I/O; the CLI is scripts/check-founder-words.ts.
 */

export type QueueRecord = Record<string, unknown>;

/** Every record of `key`, in file order: the `add` and each later update or answer. */
export function itemRecords(jsonl: string, key: string): QueueRecord[] {
  const out: QueueRecord[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a torn line is not this item's record
    }
    if (rec && typeof rec === 'object' && (rec as QueueRecord).key === key) out.push(rec as QueueRecord);
  }
  return out;
}

/** Fields of a record that may hold the founder's words. */
const FIELDS = ['text', 'detail', 'note', 'rec', 'steps'] as const;

const CLOSERS: Record<string, string> = { "'": "'", '"': '"', '“': '”', '‘': '’' };

/** `verbatim` then up to 40 characters with no colon or newline, a colon, then an opening quote. */
const MARKER = /\bverbatim\b[^:\n]{0,40}:\s*(['"“‘])/gi;

/**
 * A closing quote ends the quote only when what follows cannot continue a word, so the
 * apostrophe in "don't" does not end a single-quoted quote.
 */
function closeAt(s: string, from: number, closer: string): number {
  for (let i = s.indexOf(closer, from); i !== -1; i = s.indexOf(closer, i + 1)) {
    const next = s[i + 1];
    if (next === undefined || /[\s.,;:)\]!?]/.test(next)) return i;
  }
  return -1;
}

/** Each quote marked verbatim across every record, de-duplicated, in first-seen order. */
export function extractVerbatimQuotes(records: QueueRecord[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rec of records) {
    for (const f of FIELDS) {
      const v = rec[f];
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(MARKER)) {
        const start = (m.index ?? 0) + m[0].length;
        const end = closeAt(v, start, CLOSERS[m[1]]);
        if (end === -1) continue;
        const q = v.slice(start, end).trim();
        if (q && !seen.has(q)) {
          seen.add(q);
          out.push(q);
        }
      }
    }
  }
  return out;
}

/** Straight quotes, no blockquote markers, single spaces: line wrapping never hides a match. */
export function normalise(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The quotes `spec` does not contain, compared after `normalise`. Case is kept: verbatim means verbatim. */
export function missingQuotes(spec: string, quotes: string[]): string[] {
  const body = normalise(spec);
  return quotes.filter((q) => !body.includes(normalise(q)));
}
