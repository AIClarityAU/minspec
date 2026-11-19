/**
 * Epic-id uniqueness (#396) — the third register beside DR (Rule 17) and spec (Rule 18).
 *
 * Two sessions each allocating `max+1` for a new epic produce the same `EPIC-NNN`. The
 * dangling-ref check only proves an id RESOLVES; a duplicate still resolves, to whichever
 * file was read first. This is the symmetric primitive: ids must also be UNIQUE.
 *
 * Pure: no fs, no network, no vscode. Tier-0 (constitution invariant 1).
 */

export interface EpicFile {
  readonly file: string;
  readonly content: string;
}

export interface EpicIdDefect {
  readonly id: string;
  /** Sorted, repo-relative. */
  readonly files: string[];
  readonly message: string;
}

/** Canonicalise `EPIC-1` / `EPIC-001` to `EPIC-001`; undefined if not an epic id. */
export function canonicalEpicId(raw: string): string | undefined {
  const m = raw.match(/^EPIC-(\d+)$/);
  if (!m) return undefined;
  return `EPIC-${(m[1].replace(/^0+/, '') || '0').padStart(3, '0')}`;
}

/** The top-level `id:` of a frontmatter block, if it declares one. */
export function declaredEpicId(content: string): string | undefined {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return undefined;
  const m = block[1].match(/^id:[ \t]*(\S+)[ \t]*\r?$/m);
  return m ? m[1] : undefined;
}

/**
 * Every epic id claimed by more than one file. Empty array == clean.
 * Only files whose basename starts `EPIC-` are considered (INDEX.md is derived). A file's
 * id is its frontmatter `id:` when it is an epic id, else the id in its filename.
 */
export function checkDeclaredEpicIds(files: readonly EpicFile[]): EpicIdDefect[] {
  const byId = new Map<string, string[]>();
  for (const { file, content } of files) {
    const base = file.replace(/\\/g, '/').split('/').pop() ?? '';
    const fromName = base.match(/^(EPIC-\d+)/);
    if (!fromName) continue;
    const declared = declaredEpicId(content);
    const canonical =
      (declared !== undefined ? canonicalEpicId(declared) : undefined) ??
      canonicalEpicId(fromName[1]);
    if (canonical === undefined) continue;
    byId.set(canonical, [...(byId.get(canonical) ?? []), file]);
  }
  const defects: EpicIdDefect[] = [];
  for (const [id, claimants] of byId) {
    if (claimants.length < 2) continue;
    const sorted = [...claimants].sort();
    defects.push({
      id,
      files: sorted,
      message:
        `${id} is claimed by ${sorted.length} epic files (${sorted.join(', ')}). ` +
        'An epic id is the register\'s primary key — a spec `epic:` ref cannot tell them apart. ' +
        'Renumber all but the earliest claim.',
    });
  }
  return defects.sort((a, b) => a.id.localeCompare(b.id));
}
