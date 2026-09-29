/**
 * orphaned-docstring.ts — pure detection for a doc comment detached from its declaration.
 *
 * THE DEFECT. Inserting a new function between an existing `/** … *\/` block and the
 * `export function` it describes silently re-parents that block onto whatever now follows
 * it, and leaves the original declaration undocumented. Both halves compile, lint clean,
 * and pass the full suite, so nothing rejects it.
 *
 * Measured in #1955: two validator functions were inserted between `validateOwnership`'s
 * SPEC-038/#460 doc block and its declaration. The ownership doc became a dangling block
 * above ANOTHER function's docstring, and `validateOwnership` — a load-bearing gate
 * function — was left with none. It survived typecheck, lint, 6110 passing tests and a
 * four-voter review panel on the commit that introduced it.
 *
 * THE SIGNAL. Two doc blocks back to back: a line that is exactly `*\/` immediately
 * followed by a line opening `/**`. A declaration takes exactly one doc block, so a second
 * one stacked directly on top of the first means the first no longer has an owner.
 *
 * This is deliberately the ADJACENCY symptom rather than the general property ("every
 * top-level doc block is followed by a declaration"). The general form needs an allowlist
 * for decorators, overloads and licence headers; this form needs none, and measured on
 * this repo it is 5-for-5 true positives with zero false positives across 455 files. #2009
 * records the trade.
 */

/** One detached doc block: the `*\/` that closes it, and what displaced it. */
export interface OrphanedDocstring {
  /** Repo-relative path, as passed in. */
  readonly file: string;
  /** 1-indexed line of the closing `*\/` whose block lost its declaration. */
  readonly line: number;
  /** First line of the doc block that displaced it, trimmed, for the message. */
  readonly displacedBy: string;
}

/**
 * Every doc block in `text` that is immediately followed by another doc block.
 *
 * Pure: no IO, no repo knowledge. `file` is carried through for reporting only.
 */
export function findOrphanedDocstrings(text: string, file: string): OrphanedDocstring[] {
  const lines = text.split('\n');
  const out: OrphanedDocstring[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    // Exactly `*/` — not `} */` or a `*/` trailing code, both of which are ordinary.
    if (lines[i].trim() !== '*/') continue;
    const next = lines[i + 1].trim();
    if (!next.startsWith('/**')) continue;
    out.push({ file, line: i + 1, displacedBy: next.slice(0, 72) });
  }
  return out;
}

/**
 * Pre-existing instances, by file, with the count each file is known to carry.
 *
 * A COUNT rather than line numbers on purpose: line numbers rot on the next edit to the
 * file, and a stale waiver either fails a clean file or silences a real one. A count is
 * stable under drift and still fails closed — a fifth orphan in a file known to have two
 * is a new defect and reddens the build.
 *
 * These five are genuine, each one a doc block whose owning function still exists further
 * down the same file. They are NOT fixed here: reattaching a block means deciding which
 * declaration it describes in code this change does not otherwise touch, and guessing
 * wrong replaces an orphaned doc with a WRONG one, which is the worse failure in a
 * codebase whose thesis is that the artifact never lies. Tracked separately; this gate
 * stops the fifth.
 */
export const KNOWN_ORPHANED_DOCSTRINGS: ReadonlyMap<string, number> = new Map([
  ['packages/minspec/src/commands/commit-on-approve.ts', 1],
  ['packages/minspec/src/lib/adr-manager.ts', 2],
  ['packages/minspec/src/lib/scaffold.ts', 1],
  ['scripts/lib/swallowed-gate-signal.ts', 1],
]);

/** Human-readable one-liner for a finding. */
export function formatOrphanedDocstring(f: OrphanedDocstring): string {
  return (
    `${f.file}:${f.line} — doc block is followed directly by another doc block, ` +
    `so it has no declaration.\n    displaced by: ${f.displacedBy}\n` +
    `    Move it to the declaration it describes, or delete it if that declaration is gone.`
  );
}
