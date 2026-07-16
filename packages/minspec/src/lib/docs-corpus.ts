/**
 * docs-corpus — the single, pure definition of "which repo paths may ride the
 * docs-lane" (SPEC-039 INV-2). This is the Tier-0 heart of the never-wrong
 * guarantee for `MinSpec: Push docs via lane`: a non-docs path must NEVER be
 * pushed onto a lane that auto-merges without human review.
 *
 * The corpus MUST stay identical, character for character, to the two other
 * enforcers so the client, the CLI helper, and the server all agree:
 *   - `.github/workflows/docs-lane.yml` — the server-side gate (`allowed=...`)
 *     that re-checks every file and fails the auto-merge if a non-docs path slips
 *     through (the authority; this module is only the client-side fast reject).
 *   - `scripts/push-docs.sh` — the CLI sibling (`CORPUS=...`).
 * If you change the corpus here, change it in BOTH of those, or the three
 * disagree and the never-wrong property is lost.
 *
 * TIER-0 PURITY (load-bearing): this module imports NOTHING — no `fs`, no
 * `child_process`, no `vscode`, no network. It is a pure predicate over a string,
 * so INV-1 (the pure corpus helper does zero I/O) holds by construction and the
 * predicate is unit-testable in complete isolation.
 */

/**
 * Human-readable description of the docs corpus, for confirmation UI and docs.
 * Each entry corresponds to one alternative in {@link DOCS_CORPUS_REGEX}. This
 * is a display aid ONLY — {@link isDocsCorpusPath} is the authoritative matcher,
 * never this list.
 */
export const DOCS_CORPUS = [
  'specs/**',
  'docs/**',
  '.minspec/approvals/**',
  '*.md (top-level only)',
] as const;

/**
 * The corpus matcher, mirroring `docs-lane.yml`'s `allowed` and `push-docs.sh`'s
 * `CORPUS` exactly: a repo-relative, forward-slash path is in the corpus iff it
 *   - is under `specs/`, or
 *   - is under `docs/`, or
 *   - is under `.minspec/approvals/`, or
 *   - is a top-level markdown file (`[^/]+\.md$` — NO slash, so a NESTED `.md`
 *     such as `packages/x/y.md` is deliberately NOT in the corpus).
 */
export const DOCS_CORPUS_REGEX = /^(specs\/|docs\/|\.minspec\/approvals\/|[^/]+\.md$)/;

/**
 * True iff `rel` — a repo-relative path — belongs to the docs corpus and may
 * ride the docs-lane.
 *
 * Normalizes Windows separators to `/` so the same predicate holds cross-platform
 * (git's own porcelain output is always forward-slash, but a hand-built caller
 * path might not be). Rejects, as defense-in-depth beyond the workflow regex,
 * anything that could escape the repo — an absolute path or one containing a `..`
 * segment — so a crafted path can never satisfy `^specs/` yet resolve elsewhere.
 * (git never emits such paths; the workflow re-verifies server-side regardless.)
 */
export function isDocsCorpusPath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('/')) return false; // absolute — never repo-relative docs
  if (p.split('/').includes('..')) return false; // parent-escape — refuse
  return DOCS_CORPUS_REGEX.test(p);
}
