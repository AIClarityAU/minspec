/**
 * Required-section check for decision records (#2921).
 *
 * The `## In plain terms` section is what the founder reads to accept a DR. It
 * exists only in the generator template (adr-manager.ts), so a DR written by hand
 * bypassed it and no gate noticed. This is the gate: WARN first (the existing
 * corpus is not backfilled yet), flip to fatal once it is. The Python twin lives
 * in template-registry.ts (`DR_PLAIN_TERMS_RE`) and must stay in step.
 * Pure, offline (constitution invariant 1).
 */

/** Files in the decisions dir that are not records (mirrors validate.py DR_EXEMPT_FILENAMES). */
export const DR_EXEMPT_FILENAMES: ReadonlySet<string> = new Set(['INDEX.md', 'README.md']);

const PLAIN_TERMS_HEADING = /^#{1,6}[ \t]+In plain terms\b/im;

/** True when the markdown carries an `In plain terms` heading outside the frontmatter. */
export function hasPlainTermsSection(content: string): boolean {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  return PLAIN_TERMS_HEADING.test(body);
}

/** Basenames of DR files missing the section; exempt files are skipped. */
export function drsMissingPlainTerms(
  files: ReadonlyArray<{ file: string; content: string }>,
): string[] {
  return files
    .filter(({ file }) => !DR_EXEMPT_FILENAMES.has(file.split(/[\\/]/).pop() ?? file))
    .filter(({ content }) => !hasPlainTermsSection(content))
    .map(({ file }) => file);
}
