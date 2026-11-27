// Tier-0 leaf util (no imports). Re-homed from spec-manager.ts — SPEC-040 FR-6 / #988.


/**
 * Convert a title to a URL-friendly slug.
 * Lowercase, non-alphanumeric → hyphens, collapsed, trimmed, max 50 chars.
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-$/, '');
  }

  return slug;
}
