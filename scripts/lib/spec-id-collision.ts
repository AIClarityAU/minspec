/**
 * Spec-id uniqueness — the missing half of a pair (#1418).
 *
 * DR ids have had a collision gate since #1226 (Rule 17 + `dr-id-collision.yml`). Spec ids
 * had none, and on 2026-08-07 **five** specs simultaneously declared `id: SPEC-052`:
 * push-work-via-branch, explain-affordance, gate-signal-linter, spec-id-in-tab-title and
 * stranded-branch-detection.
 *
 * Why that is worse than untidy: an approval sidecar is keyed by PATH, but everything a
 * human reads is keyed by ID. With the collision live, `npm run facts -- approval SPEC-052`
 * resolved to whichever directory it walked first, reported `UNAPPROVED`, and was **right
 * about that file** — while the maintainer's real approval sat on a different SPEC-052. Two
 * true statements about different files, presented as one answer about "SPEC-052". That is
 * the false-signpost class the never-wrong invariant exists to prevent.
 *
 * Root cause is a lost update, not carelessness: spec creation hands out
 * `max(existing) + 1` computed against the local checkout. Concurrent worktree sessions
 * (#168 — the normal mode here) each compute the same next number, each correctly, neither
 * able to see the other. Serialising creation is not on offer, so the collision has to be
 * caught rather than avoided.
 *
 * Two defects, mirroring the DR gate:
 *   - `duplicate`  — two spec directories declaring one `id:`.
 *   - `mismatch`   — a spec whose declared `id:` disagrees with its own directory name.
 *
 * The mismatch half is load-bearing, not cosmetic. Any cheap cross-PR check must key on
 * DIRECTORY NAMES (a PR's frontmatter is not cheaply readable across every open PR), so a
 * spec free to declare an id its directory does not carry would walk straight past it —
 * exactly the reasoning recorded for the DR gate's filename half.
 *
 * Pure: no fs, no network, no vscode. Tier-0 (constitution invariant 1).
 */

/** One spec's primary file: repo-relative path plus its raw bytes. */
export interface SpecFile {
  readonly file: string;
  readonly content: string;
}

export interface SpecIdDefect {
  readonly kind: 'duplicate' | 'mismatch';
  /** Repo-relative paths involved; `files[0]` is the one to blame in the message. */
  readonly files: string[];
  readonly message: string;
}

/** `specs/<product>/SPEC-052-slug/requirements.md` → `SPEC-052`. */
export function specIdFromPath(file: string): string | undefined {
  const m = file.replace(/\\/g, '/').match(/\/(SPEC-(\d+))[^/]*\//);
  return m ? canonicalSpecId(m[2]) : undefined;
}

/** Zero-pad to the corpus's 3-digit convention so `SPEC-52` and `SPEC-052` compare equal. */
export function canonicalSpecId(num: string): string {
  const n = num.replace(/^0+/, '') || '0';
  return `SPEC-${n.padStart(3, '0')}`;
}

/** The top-level `id:` of a frontmatter block, if it declares one. */
export function declaredSpecId(content: string): string | undefined {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return undefined;
  const m = block[1].match(/^id:\s*(\S+)\s*$/m);
  return m ? m[1] : undefined;
}

/**
 * Returns every spec-id defect in the corpus. Empty array == clean.
 *
 * Only files whose PATH carries a `SPEC-NNN` directory are considered — anything else is
 * not a spec and is skipped rather than guessed at.
 */
export function checkDeclaredSpecIds(files: SpecFile[]): SpecIdDefect[] {
  const defects: SpecIdDefect[] = [];
  /** canonical id → directories claiming it */
  const byId = new Map<string, string[]>();

  for (const { file, content } of files) {
    const fromPath = specIdFromPath(file);
    if (fromPath === undefined) continue; // not a spec file

    const declared = declaredSpecId(content);

    // A declared id that is not a SPEC id at all (`id: DR-004`, `id: 52`) is a mismatch,
    // not an absence: the file claims an identity, and it is the wrong one.
    if (declared !== undefined) {
      const declaredNum = declared.match(/^SPEC-(\d+)$/);
      const canonical = declaredNum ? canonicalSpecId(declaredNum[1]) : undefined;

      if (canonical === undefined) {
        defects.push({
          kind: 'mismatch',
          files: [file],
          message: `declares \`id: ${declared}\`, which is not a SPEC id, but lives in a ${fromPath} directory. The id and the directory must agree — a cross-PR check keys on the directory name and cannot see frontmatter.`,
        });
        continue;
      }

      if (canonical !== fromPath) {
        defects.push({
          kind: 'mismatch',
          files: [file],
          message: `declares \`id: ${declared}\` but lives in a ${fromPath} directory. Rename the directory or fix the id so they agree — a cross-PR check keys on the directory name and cannot see frontmatter.`,
        });
        continue;
      }

      byId.set(canonical, [...(byId.get(canonical) ?? []), file]);
    }
    // An ABSENT `id:` is Rule 2's business (every spec must declare one), not this rule's.
    // Reporting it here too would double-report a single defect.
  }

  for (const [id, claimants] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (claimants.length < 2) continue;
    defects.push({
      kind: 'duplicate',
      files: claimants,
      message: `${claimants.length} specs declare \`id: ${id}\` — ${claimants.join(', ')}. A spec id is the corpus's primary key: with two records under one id, an id-keyed lookup (the next-task resolver, the tree, \`facts approval\`) answers about whichever it walks first and silently misreports the others. Renumber all but one; keep the id on the APPROVED spec if there is one, since its approval sidecar is path-keyed and renaming its directory would strand the signature.`,
    });
  }

  return defects;
}
