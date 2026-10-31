/**
 * Closed-set rule for decision-record frontmatter (#1641).
 *
 * `CLOSED_SET_FIELDS` (spec-validator.ts) asserts both directions — required implies
 * present, present implies valid — for SPECS only. A DR `status:` was only ever compared
 * against INDEX.md (Rule 8), never against a legal value set, so an illegal status or a
 * drifted field name was unreachable by the validator. This is the DR twin.
 *
 * Pure and offline (constitution invariant 1). The status set mirrors `AdrStatus`
 * (adr-manager.ts:15).
 */
import { DR_EXEMPT_FILENAMES } from './dr-required-sections';

export const DR_LEGAL_STATUSES: readonly string[] = ['proposed', 'accepted', 'deprecated', 'superseded'];

/**
 * Append-only field-name aliases: legacy spelling -> canonical spelling. This table IS
 * the migration record — add a row when a spelling is retired, never delete one, and
 * never write a one-off migration script instead.
 */
export const DR_FIELD_ALIASES: Readonly<Record<string, string>> = {
  'approved-by': 'approved_by',
};

export interface DrFrontmatterDefect {
  file: string;
  message: string;
}

/** Top-level `key: value` pairs of the leading frontmatter block, trailing `# comment` stripped. */
function readFrontmatter(content: string): Map<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)[ \t]*:(.*)$/);
    if (!m) continue;
    fm.set(m[1], m[2].replace(/(^|\s)#.*$/, '').trim().replace(/^["']|["']$/g, ''));
  }
  return fm;
}

export function checkDrFrontmatterClosedSet(
  files: ReadonlyArray<{ file: string; content: string }>,
): DrFrontmatterDefect[] {
  const defects: DrFrontmatterDefect[] = [];
  for (const { file, content } of files) {
    if (DR_EXEMPT_FILENAMES.has(file.split(/[\\/]/).pop() ?? file)) continue;
    const fm = readFrontmatter(content);
    if (!fm) {
      defects.push({ file, message: 'decision record has no frontmatter block' });
      continue;
    }
    const status = fm.get('status');
    if (status === undefined || status === '') {
      defects.push({ file, message: `required field \`status\` is missing (legal: ${DR_LEGAL_STATUSES.join(' | ')})` });
    } else if (!DR_LEGAL_STATUSES.includes(status)) {
      defects.push({ file, message: `status \`${status}\` is not legal (legal: ${DR_LEGAL_STATUSES.join(' | ')})` });
    }
    for (const [legacy, canonical] of Object.entries(DR_FIELD_ALIASES)) {
      if (fm.has(legacy)) {
        defects.push({ file, message: `field \`${legacy}\` is a retired spelling; use \`${canonical}\`` });
      }
    }
  }
  return defects;
}
