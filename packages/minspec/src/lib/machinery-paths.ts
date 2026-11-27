/**
 * machinery-paths.ts — the ONE canonical "machinery" path set (#1758).
 *
 * "A gate cannot certify a change to itself" (#596): every path here is code that
 * DECIDES whether some other change is allowed — directly, or by generating the thing
 * that decides — so it cannot certify itself. Three separate consumers each needed this
 * set and each grew its own copy:
 *
 *   1. `.github/workflows/ai-review.yml` — the `grep -qE` guard that forces
 *      SELF_EDIT_KIND=machinery, overriding the combined verdict to `changes` so a
 *      machinery PR never earns a SHA-bound `ai-review:pass` witness.
 *   2. `scripts/dispatch-issue.sh` (`MACHINERY_PATH_RE`) — the constitution invariant-2
 *      INDEPENDENT SECOND WITNESS: dispatch declines to arm native auto-merge on a
 *      machinery PR, independently of anything ai-review does, so a regression/outage/
 *      permission gap in (1) alone cannot let a machinery PR merge unwitnessed.
 *   3. `scripts/auto-merge-gate.ts` (`BOUNDARY_DIR_PREFIXES` + the single-file check
 *      below) — imports this module directly, so for this TypeScript consumer the
 *      "shared definition" is enforced by the import graph, not just a test.
 *
 * A shell regex embedded in a YAML step and a bash variable cannot literally `import`
 * this module — there is no cross-language import for either. Both instead carry a
 * HAND-COPIED rendering of `buildMachineryRegexSource()`'s output, and
 * `packages/minspec/tests/machinery-paths.test.ts` pins each copy to that output
 * character-for-character: any hand-edit that drifts from this module fails that test,
 * rather than depending on someone remembering to update three files in lock-step (the
 * exact failure mode #1758 diagnosed — a reconciliation commit, 01369b6b, updated (1)
 * and shipped a test that only read (1), leaving (2) narrower and the second witness
 * inert for two paths).
 *
 * MEMBERSHIP TEST for anything added here: does this code decide whether some other
 * change is allowed — directly, or by generating the thing that decides? If yes it
 * belongs in one of the two sets below.
 *
 * THE INVERSE TEST, and why it needs its own list (#2018). `scripts/` is a DIRECTORY
 * prefix, so it admits files that fail the membership test outright — a report
 * generator, a read-only oracle. Those are classified machinery, so their PRs earn no
 * SHA-bound witness and wait on a human keystroke that decides nothing.
 * {@link MACHINERY_CARVE_OUTS} is the explicit, per-file exemption for them, and it is
 * deliberately a hand-maintained allowlist rather than a cleverer prefix: deny-by-default
 * is the safer failure direction and the prefix rule gets that for free, so every entry
 * is a STANDING PROMISE that the named file never grows a gating role. That promise is
 * not left to memory — `packages/minspec/tests/machinery-carve-outs.test.ts` fails if a
 * carved path is ever referenced from a workflow, a git hook or another script, and fails
 * if a carved path stops existing (a rename must not leave a dead exemption that a later
 * file at the same path silently inherits).
 */

/**
 * Directory prefixes that are machinery wherever they occur (deny-by-default:
 * matched by prefix on the POSIX-normalized, repo-relative path).
 *
 *   .github/    — review/merge workflows and their scripts (ai-review.yml,
 *                 .github/scripts/ai-review-guard.js, …).
 *   scripts/    — dispatch, review, remediation, the issue lease, role prompts.
 *   .githooks/  — pre-commit (protected-branch #1041, RCDD DR-003), pre-push
 *                 (workflow-file protection #1120), commit-msg. This repo runs
 *                 `core.hooksPath=.githooks`.
 *   .circleci/, .buildkite/, .husky/ — this repo does not use these providers today,
 *                 but `scripts/auto-merge-gate.ts`'s CI/build boundary detector (#422)
 *                 already treats them as machinery-class (arbitrary code at CI/commit
 *                 time); folding them in here closes that gap rather than leaving it
 *                 as a standing three-way disagreement. Zero-cost while unused: no
 *                 path under these prefixes exists in this repo, so they never match.
 */
export const MACHINERY_DIR_PREFIXES: readonly string[] = [
  '.github/',
  'scripts/',
  '.githooks/',
  '.circleci/',
  '.buildkite/',
  '.husky/',
];

/**
 * Individual files that are machinery despite not living under a machinery directory —
 * both under `packages/minspec/src/lib/`, both GENERATORS of machinery rather than
 * machinery themselves:
 *
 *   template-registry.ts    — generates the `.minspec/hooks/pre-commit` gate every
 *                              MinSpec-initialised project runs. Blast radius strictly
 *                              larger than `.githooks/` (this repo only).
 *   ci-review-templates.ts  — holds the verbatim ai-review workflow, review-decide.sh
 *                              and ai-review-guard.js shipped to every consuming repo.
 *                              Largest blast radius of anything in this set: a PR
 *                              touching only this file changes the review gate for
 *                              every downstream project.
 *   machinery-paths.ts      — THIS FILE (#2018). It passes the membership test in the
 *                              affirmative: it decides what counts as a gate, so it
 *                              decides-by-generating exactly as the two above do, and it
 *                              is upstream of both. Leaving it exempt meant a PR
 *                              NARROWING the machinery set was certifiable by the
 *                              machinery it narrows — the #596 self-certification hole in
 *                              its purest form. Stated cost, accepted when this landed:
 *                              every future narrowing of the set is human-merge-only,
 *                              including the PR that introduced this line.
 */
export const MACHINERY_SINGLE_FILES: readonly string[] = [
  'packages/minspec/src/lib/template-registry.ts',
  'packages/minspec/src/lib/ci-review-templates.ts',
  'packages/minspec/src/lib/machinery-paths.ts',
];

/**
 * EXEMPTIONS from {@link MACHINERY_DIR_PREFIXES} — exact repo-relative paths that sit
 * under a machinery directory but fail the membership test: they decide nothing, and
 * nothing that decides reads them (#2018).
 *
 *   scripts/facts.ts              — the read-only facts oracle (#1050). Reachable only
 *                                   as `npm run facts` (package.json), a developer
 *                                   convenience; no workflow, hook or script consumes it.
 *   scripts/review-churn-report.sh — the ai-review churn instrument (#1840). Reports on
 *                                   review history; nothing reads its output.
 *
 * WHAT AN ENTRY HERE COSTS. Deny-by-default is the safer failure direction and the
 * directory prefix gets it for free, so each line here trades that away for one file.
 * The risk is not the file as it is today — it is the file two years from now, wired
 * into CI by someone who never read this comment, still carrying an exemption. That is
 * why the promise is enforced rather than written down: see the rot guards named in this
 * module's header.
 *
 * SEEDED ONLY WITH PATHS THAT EXIST ON `main`. A file a PR is still introducing carries
 * its own carve-out entry in that PR, so the existence assertion holds at every commit
 * rather than only at the tip. `scripts/lib/corpus-walk.ts` is therefore absent here and
 * belongs in #2005, the PR that adds it.
 *
 * CONSTRAINTS every entry must satisfy (enforced by {@link buildMachineryCarveOutRegexSource}
 * and by the test suite, not by review alone):
 *   • it lies under a {@link MACHINERY_DIR_PREFIXES} prefix — an exemption for a path that
 *     was never machinery is a dead line that reads as a live decision;
 *   • it is not also in {@link MACHINERY_SINGLE_FILES} — a path cannot be both;
 *   • the file exists in the tree;
 *   • no workflow, git hook or other script references it.
 */
export const MACHINERY_CARVE_OUTS: readonly string[] = [
  'scripts/facts.ts',
  'scripts/review-churn-report.sh',
];

/** Escape a literal string for embedding in a regex alternative. */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The shared stem directory `MACHINERY_SINGLE_FILES` entries must live under, so the
 * regex can group them as `dir/(stemA|stemB)\.ts$` — the same construction
 * ai-review.yml originally used, kept so `buildMachineryRegexSource()`'s output is a
 * minimal, readable diff from what the two hand-copies already carried.
 */
const SINGLE_FILE_DIR = 'packages/minspec/src/lib/';

function singleFileStem(f: string): string {
  if (!f.startsWith(SINGLE_FILE_DIR) || !f.endsWith('.ts')) {
    throw new Error(
      `machinery-paths: ${f} does not fit the shared-stem "${SINGLE_FILE_DIR}<stem>.ts" pattern ` +
        `buildMachineryRegexSource() assumes — add a differently-shaped alternative if this is intentional.`,
    );
  }
  return f.slice(SINGLE_FILE_DIR.length, -'.ts'.length);
}

/**
 * Build the POSIX-ERE pattern SOURCE that `.github/workflows/ai-review.yml`'s
 * `grep -qE` guard and `scripts/dispatch-issue.sh`'s `MACHINERY_PATH_RE` must both
 * carry, character for character. Each directory prefix is independently `^`-anchored
 * (rather than grouped under one outer `^(...)`), matching dispatch's original
 * convention and keeping every alternative individually greppable/testable.
 */
export function buildMachineryRegexSource(): string {
  const dirAlts = MACHINERY_DIR_PREFIXES.map((p) => `^${escapeForRegex(p)}`);
  const stems = MACHINERY_SINGLE_FILES.map((f) => escapeForRegex(singleFileStem(f)));
  const fileAlt = `^${escapeForRegex(SINGLE_FILE_DIR)}(${stems.join('|')})\\.ts$`;
  return [...dirAlts, fileAlt].join('|');
}

/**
 * Build the POSIX-ERE pattern SOURCE for the carve-out FILTER (#2018) — one fully
 * anchored literal alternative per {@link MACHINERY_CARVE_OUTS} entry.
 *
 * WHY A SECOND PATTERN AND NOT A SMARTER FIRST ONE. POSIX ERE has no negative lookahead,
 * and two of the three consumers of `buildMachineryRegexSource()` are `grep -qE` in shell
 * (`.github/workflows/ai-review.yml`, `scripts/dispatch-issue.sh`), so "match `^scripts/`
 * EXCEPT these two paths" cannot be written as a pattern tweak. The alternative — emitting
 * a character-by-character negation of each carved literal into the machinery alternation
 * — produces a pattern that is quadratic in path length, unreadable, and HAND-COPIED
 * character-for-character into two files. Unreadability lands precisely where the #1758
 * divergence already happened once. So the carve-out is a SEPARATE `grep -vE` stage that
 * runs BEFORE the machinery test, and both patterns stay individually human-checkable.
 *
 * THROWS on an empty set rather than returning `''`. `grep -vE ''` matches every line, so
 * an empty pattern deletes the entire change set and silently disarms the machinery
 * classification in both shell consumers — a fail-OPEN on a load-bearing gate (constitution
 * invariant 2). If the last carve-out is ever removed, remove the filter stage from both
 * consumers in the same change instead of shipping an empty pattern.
 */
export function buildMachineryCarveOutRegexSource(
  carveOuts: readonly string[] = MACHINERY_CARVE_OUTS,
): string {
  assertCarveOutsWellFormed(carveOuts);
  return carveOuts.map((f) => `^${escapeForRegex(f)}$`).join('|');
}

/**
 * Structural validation of a carve-out list. Pure — it checks the SHAPE of the list,
 * never the filesystem; existence and the no-consumer promise are asserted by
 * `packages/minspec/tests/machinery-carve-outs.test.ts`, which can read the tree.
 *
 * The list is a PARAMETER (defaulting to the real one) so each refusal can be exercised
 * against a list that actually violates it. A validator whose rejections are only ever
 * asserted by reading its own source text is a validator nobody has run.
 */
export function assertCarveOutsWellFormed(
  carveOuts: readonly string[] = MACHINERY_CARVE_OUTS,
): void {
  if (carveOuts.length === 0) {
    throw new Error(
      'machinery-paths: MACHINERY_CARVE_OUTS is empty, so the generated filter pattern would ' +
        "be '' — and `grep -vE ''` filters away the WHOLE change set, disarming the machinery " +
        'classification in ai-review.yml and dispatch-issue.sh. Remove the grep -vE stage from ' +
        'both consumers instead of emitting an empty pattern (#2018).',
    );
  }
  const seen = new Set<string>();
  for (const f of carveOuts) {
    // Shape before membership: a malformed path would otherwise be rejected for the wrong
    // reason ("lies under no machinery prefix"), sending the reader after the wrong fix.
    if (f !== f.replace(/\\/g, '/') || f.startsWith('./') || f.endsWith('/') || f === '') {
      throw new Error(
        `machinery-paths: "${f}" is not a POSIX-normalized repo-relative FILE path — the filter ` +
          'compares fully-anchored literals, so any other form silently matches nothing.',
      );
    }
    if (seen.has(f)) {
      throw new Error(`machinery-paths: ${f} is listed twice in MACHINERY_CARVE_OUTS.`);
    }
    seen.add(f);
    if (MACHINERY_SINGLE_FILES.includes(f)) {
      throw new Error(
        `machinery-paths: ${f} is in BOTH MACHINERY_SINGLE_FILES and MACHINERY_CARVE_OUTS — ` +
          'a path cannot be machinery and exempt from machinery at the same time.',
      );
    }
    if (!MACHINERY_DIR_PREFIXES.some((p) => f.startsWith(p))) {
      throw new Error(
        `machinery-paths: ${f} is in MACHINERY_CARVE_OUTS but lies under no machinery directory ` +
          'prefix, so it was never machinery and the exemption is dead — it reads as a live ' +
          'decision while changing nothing. Remove it, or fix the path.',
      );
    }
  }
}

/**
 * Is `rawPath` machinery per the canonical set above? Pure, dependency-free predicate —
 * `scripts/auto-merge-gate.ts` imports this directly (real, import-graph-enforced
 * sharing for its consumer); the bash/YAML consumers are instead pinned by
 * `packages/minspec/tests/machinery-paths.test.ts` against `buildMachineryRegexSource()`.
 */
export function isMachineryPath(rawPath: string): boolean {
  const p = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  // #2018 — the carve-out is tested FIRST and by exact path. First because an exemption
  // that ran after the prefix scan could never fire; exact because the shell consumers'
  // filter pattern is fully anchored (`^…$`), and a predicate that classified more
  // loosely than the regex would reintroduce the #1758 three-way disagreement in the one
  // consumer that imports rather than hand-copies.
  if (MACHINERY_CARVE_OUTS.includes(p)) return false;
  for (const prefix of MACHINERY_DIR_PREFIXES) {
    if (p === prefix.slice(0, -1) || p.startsWith(prefix)) return true;
  }
  return MACHINERY_SINGLE_FILES.includes(p);
}
