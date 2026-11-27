/**
 * The two corpus rules of `scripts/validate-frontmatter.ts` that used to live inline in
 * the script: Rule 1+3+4 (domain docs) and Rule 2 (spec `id:`). They are exported here so
 * the script and the headless core (SPEC-136 FR-3) call ONE body, with the script's
 * messages unchanged. Pure and offline (constitution invariant 1): content in, messages out.
 */

/**
 * Flat `key: value` frontmatter reader. `\r?\n`, not `\n` — a CRLF checkout must still match
 * the anchor; a bare `\n` silently returns `{}` on every CRLF file, which every
 * frontmatter-bearing rule then reads as "no frontmatter" (#2465, invariant 2).
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
  }
  return fm;
}

/** Rule 1 + 3 + 4: the failure messages for one `docs/domain/*.md` file; `[]` when clean. */
export function domainDocFailures(content: string): string[] {
  const fm = parseFrontmatter(content);
  const out: string[] = [];
  if (fm['type'] !== 'domain') out.push('missing `type: domain` frontmatter');
  if (/^- \[ \]/m.test(content)) out.push('task checklists (- [ ]) not allowed in domain docs');
  if (/acceptance criteria/i.test(content)) out.push('acceptance criteria not allowed in domain docs');
  return out;
}

/** Rule 2: the failure message for a spec file without a well-formed `id: SPEC-NNN`, else null. */
export function specIdFailure(content: string): string | null {
  const id = parseFrontmatter(content)['id'];
  return !id || !/^SPEC-\d+$/.test(id) ? 'missing or invalid `id: SPEC-NNN` frontmatter' : null;
}

/**
 * The shipped Python validator's DR `id:` rule: the failure message for a decision record
 * without a well-formed `id: DR-NNN`, else null. `validate-frontmatter.ts` has no such rule
 * (#2297), so only the headless core calls this one, to find what `validate.py` finds
 * (SPEC-136 FR-3). Quotes and a trailing comment are tolerated the way `validate.py` does.
 */
export function drIdFailure(content: string): string | null {
  const raw = parseFrontmatter(content)['id'];
  let id = (raw ?? '').split('#', 1)[0].trim();
  if (id.length >= 2 && id[0] === id[id.length - 1] && (id[0] === '"' || id[0] === "'")) id = id.slice(1, -1);
  if (!id) return 'missing `id: DR-NNN` frontmatter';
  return /^DR-\d+$/.test(id) ? null : `invalid \`id: DR-NNN\` frontmatter (got \`${id}\`)`;
}
