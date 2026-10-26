/**
 * dr-index-splice.ts — apply ONE decision's INDEX entry onto a base INDEX (#2912).
 *
 * `regenerateDrIndex` rebuilds the whole register from every DR file in the shared
 * checkout, so that INDEX.md carries every other uncommitted status change too.
 * Approval recovery used to copy it wholesale, so accepting DR-107/108/109 in one
 * sitting put all three rows in each of the three PRs. This module takes the
 * target's entry from the working-tree INDEX and splices only it into the base
 * (origin/main) INDEX. Pure string work: no fs, no vscode, no git.
 */

const ENTRY_START = /^## \[(DR-\d+)\b/;
const END_MARKER = '<!-- minspec:dr-index:end -->';

interface Parsed {
  readonly head: string[];
  readonly entries: Array<{ id: string; lines: string[] }>;
  readonly tail: string[];
}

function parse(text: string): Parsed {
  const lines = text.split('\n');
  const endIdx = lines.findIndex((l) => l.trim() === END_MARKER);
  const bodyEnd = endIdx === -1 ? lines.length : endIdx;
  const head: string[] = [];
  const entries: Array<{ id: string; lines: string[] }> = [];
  let cur: { id: string; lines: string[] } | null = null;
  for (let i = 0; i < bodyEnd; i++) {
    const m = ENTRY_START.exec(lines[i]);
    if (m) {
      cur = { id: m[1], lines: [lines[i]] };
      entries.push(cur);
    } else if (cur) cur.lines.push(lines[i]);
    else head.push(lines[i]);
  }
  return { head, entries, tail: lines.slice(bodyEnd) };
}

function idNum(id: string): number {
  return parseInt(id.slice(3), 10);
}

/** Trim trailing blank lines so entries re-join with exactly one blank line. */
function trimmed(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * Return `baseIndex` with only `drId`'s entry replaced (or inserted in id order)
 * from `workingIndex`. Returns null when the working INDEX has no entry for the
 * id — the caller then falls back to its previous behaviour rather than guess.
 * Line endings of `baseIndex` are preserved.
 */
export function spliceDrIndexEntry(baseIndex: string, workingIndex: string, drId: string): string | null {
  const crlf = baseIndex.includes('\r\n');
  const base = parse(baseIndex.replace(/\r\n/g, '\n'));
  const work = parse(workingIndex.replace(/\r\n/g, '\n'));
  const src = work.entries.find((e) => e.id === drId);
  if (!src) return null;
  const entry = { id: drId, lines: trimmed(src.lines) };
  const at = base.entries.findIndex((e) => e.id === drId);
  if (at !== -1) base.entries[at] = entry;
  else {
    const next = base.entries.findIndex((e) => idNum(e.id) > idNum(drId));
    if (next === -1) base.entries.push(entry);
    else base.entries.splice(next, 0, entry);
  }
  const out = [...trimmed(base.head)];
  for (const e of base.entries) {
    out.push('', ...trimmed(e.lines));
  }
  // head already ends with its own spacing; collapse the leading '' if head is empty
  const body = out[0] === '' ? out.slice(1) : out;
  const text = [...body, ...base.tail].join('\n');
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}
