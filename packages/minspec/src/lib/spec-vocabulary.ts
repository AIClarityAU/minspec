/**
 * spec-vocabulary.ts — the closed sets and the frontmatter tokenizer, extracted so
 * they can be shared WITHOUT an import cycle (#1446).
 *
 * WHY THIS MODULE EXISTS. `spec-validator.ts` needs `SPEC_STATUSES`, `SPEC_TYPES` and
 * `stripInlineComment`, and used to value-import them from `./spec`. That single edge
 * made `spec.ts → spec-validator.ts` impossible, because it would have closed a runtime
 * cycle — which is why SPEC-051's ownership guard could be wired into `approveSpec` but
 * not into `advanceSpecToImplementing`, the function that actually writes
 * `phases.plan: in-progress`. The guard was therefore absent from the exact writer the
 * bug ran through, and the workaround on the table was a lazy `require` that would have
 * kept `check-import-cycles.ts` green while leaving the cycle genuinely present.
 *
 * This is a LEAF: it imports nothing. Two frozen arrays and a pure string function, none
 * of which had any reason to live beside the parser other than history. `spec.ts`
 * re-exports all three, so every existing import site keeps working unchanged and the
 * diff stays narrow — only `spec-validator.ts` is repointed here, because it is the one
 * import that has to move for the cycle to open.
 *
 * KEEP IT A LEAF. Adding an import to this file re-closes the edge it exists to open.
 */

/**
 * Closed set of spec lifecycle statuses. Frozen deliberately: adding a status here
 * forces a decision everywhere it matters.
 */
export const SPEC_STATUSES = [
  'new',
  'specifying',
  'planning',
  'implementing',
  'done',
  'archived',
  'superseded',
] as const;

/** Lifecycle status of the entire spec. */
export type SpecStatus = (typeof SPEC_STATUSES)[number];

/**
 * Split-layout phase-file kinds. A spec split across sibling files carries one of these
 * in its `type:` frontmatter (one phase per file); a single-file spec carries no `type`
 * at all.
 *
 * NOTE: `type` is a closed-set field but NOT a required one — single-file specs
 * legitimately omit it (their absence IS the single-file signal). Requiring it would
 * mis-flag every single-file spec.
 */
export const SPEC_TYPES = ['requirements', 'design', 'tasks'] as const;

/** A split-layout phase-file kind. */
export type SpecType = (typeof SPEC_TYPES)[number];

/**
 * Strip a trailing ` # comment` from a frontmatter scalar, honouring quoted values.
 *
 * Deliberately fail-safe versus the spec-gate's `fm_value` (which keeps comment tokens):
 * a quoted scalar returns its inner text verbatim, so an inner `#` is literal and never
 * treated as a comment.
 */
export function stripInlineComment(value: string): string {
  const v = value.trim();
  // A matched quoted scalar: strip the surrounding quotes (need ≥2 chars so a lone
  // quote isn't treated as a matched pair). Inner `#` is literal — no comment strip.
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  const m = v.match(/\s#/);
  return m && m.index !== undefined ? v.slice(0, m.index).trim() : v;
}

/**
 * Read an `epic:` frontmatter value, discarding the cosmetic inline title comment
 * `formatEpicRef` appends. Returns undefined for absent/blank.
 *
 * Lives here for the same reason as `stripInlineComment`: it is a pure frontmatter
 * tokenizer with no dependencies, and `spec-validator` needs it. Left in
 * `epic-manager` it kept a cycle alive (spec -> guard -> spec-validator ->
 * epic-manager -> spec-manager -> spec-layout -> spec). `epic-manager` re-exports it,
 * so existing import sites are unchanged.
 */
export function epicRefValue(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const hash = raw.indexOf('#');
  const ref = (hash === -1 ? raw : raw.slice(0, hash)).trim();
  return ref === '' ? undefined : ref;
}
