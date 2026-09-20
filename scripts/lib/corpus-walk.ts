/**
 * Corpus walk that cannot report an empty corpus after a read failure (#1999).
 *
 * Two dev-time tools walked `specs/` and `docs/decisions/` with a recursive `readdirSync`
 * wrapped in `catch { return [] }` — `safeGlob` in `validate-frontmatter.ts` and
 * `walkMarkdownFiles` in `facts.ts`. The comment on the first said it "tolerates a missing
 * directory", which is the only case it was written for; what both implemented was *any*
 * filesystem error at *any* depth means the corpus is empty. Every consumer reads an empty
 * list as a clean corpus.
 *
 * Measured 2026-09-21: one `chmod 000` directory under `specs/` made `npm run validate`
 * miss a genuine duplicate `id: SPEC-070`, exit 0, print `Frontmatter validation passed.`,
 * and emit 60 false `dangling SPEC reference` warnings about specs that exist. The FATAL
 * collision rules (17 and 18) printed nothing at all: their own catch blocks promise to
 * fail "VISIBLY" per constitution invariant 2, but the throw was eaten one frame below
 * them, so that path was unreachable for exactly the error it was written for.
 *
 * The rule here: a missing ROOT is tolerated (an optional corpus location that genuinely
 * does not exist on this branch); every other error propagates to the caller, which is
 * where the decision about how loudly to fail belongs. That includes an `ENOENT` at depth
 * — a directory vanishing mid-walk is a concurrent-session race (#168), not an absence,
 * and silently returning the files gathered so far is the same false-clean signal.
 *
 * `shellScripts()` in `check-swallowed-gate-signal.ts` already models this ("Throws rather
 * than skipping on an IO error"); this is that discipline applied to the corpus walkers.
 *
 * The reader is injectable so the decision logic is testable without a filesystem — a
 * `chmod 000` fixture is inert when the suite runs as root, which is how this class of
 * test passes vacuously in a container CI.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The subset of `fs.Dirent` this walk needs. */
export interface DirEntry {
  readonly name: string;
  isDirectory(): boolean;
}

export type DirReader = (dir: string) => readonly DirEntry[];

const defaultReader: DirReader = (dir) => readdirSync(dir, { withFileTypes: true });

/**
 * True when `err` is this exact directory being absent, as opposed to unreadable, gone
 * mid-walk, or any other IO failure. Keyed on `err.path` so a missing subdirectory deeper
 * in the tree is never mistaken for an absent root.
 */
export function isMissingRoot(err: unknown, root: string): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  return e?.code === 'ENOENT' && e.path === root;
}

/**
 * Every file under `dir` whose name ends in `ext`, recursively.
 *
 * Throws on ANY read failure, including a missing `dir`. Symlinked directories are not
 * followed (`isDirectory()` is false for a symlink), preserving the previous behaviour.
 */
export function walkFilesByExt(dir: string, ext: string, read: DirReader = defaultReader): string[] {
  const results: string[] = [];
  for (const entry of read(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFilesByExt(full, ext, read));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

/**
 * `walkFilesByExt` for a corpus root that may legitimately not exist on this branch.
 *
 * Returns `[]` when `dir` itself is absent and ONLY then. Every other error — a permission
 * failure, a subdirectory removed mid-walk, EMFILE — propagates, so the caller decides
 * whether to warn or fail rather than being handed a silently empty corpus.
 */
export function walkOptionalRoot(dir: string, ext: string, read: DirReader = defaultReader): string[] {
  try {
    return walkFilesByExt(dir, ext, read);
  } catch (err) {
    if (isMissingRoot(err, dir)) return [];
    throw err;
  }
}
