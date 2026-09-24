/**
 * governance-transition — the client-side mirror of `.github/workflows/docs-lane.yml`'s
 * GOVERNANCE STATUS-TRANSITION gate (#1847), so the producer of the `docs-lane` label
 * knows the lane's ELIGIBILITY rule and not merely its path corpus (#2078).
 *
 * WHY THIS EXISTS. `docs-corpus.ts` answers "may this path ride the lane?". That was
 * the whole question until #1847 added a second refusal keyed on what the change DOES:
 * a `docs-lane` PR whose diff changes a `status:` line under `docs/decisions/` or
 * `specs/` is a DR acceptance or a spec approval — a human act (DR-029, DR-086 §2) —
 * and the lane refuses it with `exit 1`. The label producer never learned that rule, so
 * it kept labelling the one PR class it creates (an approval commit IS a status
 * transition plus its sidecar) onto a lane guaranteed to refuse. The result was a
 * permanent manufactured red on the founder's own approval artefacts — #2071 (DR-092
 * acceptance), #2072 (SPEC-068 approval), #2073 (SPEC-069 approval), run 35783197257.
 * `docs-lane` is not a required check, so nothing was mechanically blocked; the defect
 * is that a product whose claim is that its signposts do not lie was shipping a
 * signpost that always lies.
 *
 * THE DUPLICATED-PREDICATE RISK, NAMED. The refusal is bash embedded in a GitHub
 * Actions `run:` block; this is TypeScript inside a Tier-0 extension. There is no
 * artefact both can execute, so ONE shared implementation is not available — which is
 * exactly the drift this repo keeps getting bitten by. The mitigation is the same one
 * `ownership-path-rules.ts` and `auto-merge-gate.ts`'s `OUTWARD_DOC_PATTERN` use:
 * the two pattern STRINGS below are lock-step-pinned to the literals in the workflow
 * by `tests/governance-lane-eligibility.test.ts`, which reads them out of
 * `docs-lane.yml` itself and additionally runs the workflow's own EREs through real
 * `grep -E` / bash `[[ =~ ]]` over a shared fixture matrix, asserting the two engines
 * agree case by case. A text assertion alone would go green on an inverted `if`;
 * running both is what makes this a gate rather than a comment.
 *
 * TIER-0 PURITY (load-bearing, same posture as `docs-corpus.ts`): this module imports
 * NOTHING — no `fs`, no `child_process`, no `vscode`, no network. Every export is a
 * pure function of its arguments, so the eligibility question is decidable offline
 * (constitution invariant #1) and unit-testable with no host.
 */

/**
 * `docs-lane.yml`'s `govern='…'` — the path prefixes whose `status:` line is a
 * GOVERNANCE RATIFICATION. Kept as a STRING, not only as a compiled regex, because the
 * parity test compares characters with the workflow's literal; a `RegExp`'s `.source`
 * would drift the moment one side escaped a `/` the other did not need to.
 *
 * Deliberately NARROWER than the docs corpus. `CLAUDE.md`, `skills/**\/*.md` and
 * `.minspec/approvals/**` are corpus but not governance, so a `status:` line in one of
 * them is not a ratification and must NOT cost the label — over-refusing here would
 * strip the lane from ordinary docs PRs, which is this fix's own failure mode.
 */
export const GOVERNANCE_PATH_PATTERN = '^(docs/decisions/|specs/)';

/** Compiled {@link GOVERNANCE_PATH_PATTERN}. */
export const GOVERNANCE_PATH_REGEX = new RegExp(GOVERNANCE_PATH_PATTERN);

/**
 * `docs-lane.yml`'s `grep -qE '^[+-]status:'` — an ADDED or REMOVED line whose content
 * begins `status:`.
 *
 * Matched per diff LINE (see {@link patchHasStatusTransition}) rather than with JS's
 * `m` flag: `grep` splits on `\n` alone, while JS multiline `^` also follows `\r`,
 * ` ` and ` `. Anchoring by hand keeps the two engines answering identically
 * on a patch containing any of those.
 *
 * As in the workflow, this is deliberately coarse — it matches a `status:` line quoted
 * inside a fenced block or in body prose, not only frontmatter. Over-refusing costs one
 * human merge keystroke; under-refusing lets a ratification auto-merge. Telling
 * frontmatter from body text would mean tracking position within each hunk, i.e. a
 * second predicate for the two sides to disagree about.
 */
export const STATUS_TRANSITION_PATTERN = '^[+-]status:';

/** Compiled {@link STATUS_TRANSITION_PATTERN}, applied to ONE diff line at a time. */
export const STATUS_TRANSITION_REGEX = new RegExp(STATUS_TRANSITION_PATTERN);

/**
 * One file's entry in a pull request's diff, in the shape the lane's own gate reads it
 * (`[.filename, .patch]`). `patch` is optional because GitHub omits `.patch` for very
 * large diffs — and the local producer likewise cannot always obtain one. That absence
 * is an UNKNOWN, never a "no"; see {@link governanceStatusTransitions}.
 */
export interface DiffEntry {
  /** Repo-relative, forward-slash path. Windows separators are normalized on read. */
  readonly path: string;
  /** Unified-diff text for this file, when it could be obtained. */
  readonly patch?: string;
}

/** Normalize a caller path to the forward-slash form both enforcers reason over. */
function toPosix(rel: string): string {
  return rel.replace(/\\/g, '/');
}

/**
 * True iff `rel` sits under a path prefix whose `status:` line is a governance
 * ratification — i.e. iff the lane's status gate could fire on it.
 */
export function isGovernancePath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  return GOVERNANCE_PATH_REGEX.test(toPosix(rel));
}

/**
 * True iff `patch` contains an added or removed `status:` line — the workflow's
 * `grep -qE '^[+-]status:'`, line by line so no regex-engine difference can separate
 * the two answers.
 */
export function patchHasStatusTransition(patch: string): boolean {
  if (typeof patch !== 'string' || patch.length === 0) return false;
  return patch.split('\n').some((line) => STATUS_TRANSITION_REGEX.test(line));
}

/**
 * The governance files in `entries` that carry — or MAY carry — a status transition,
 * mirroring the workflow's loop arm for arm.
 *
 * Three ways an entry lands in the result, and only the first is a positive
 * observation:
 *   1. its patch contains an added/removed `status:` line;
 *   2. its patch is ABSENT (`undefined`) — the workflow's `[ -z "$patch_b64" ]` arm,
 *      written there because an absent witness is an unknown, not a clean file;
 *   3. its patch is the EMPTY STRING. `--name-only` said the file changed, so an empty
 *      diff for it means the diff was not really obtained. Same unknown, same answer.
 *
 * Non-empty result ⇒ the lane will refuse ⇒ the label must not be minted. Entries
 * outside {@link isGovernancePath} are ignored, exactly as the workflow's
 * `[[ "$fname" =~ $govern ]] || continue` ignores them.
 */
export function governanceStatusTransitions(entries: readonly DiffEntry[]): string[] {
  if (!Array.isArray(entries)) return [];
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string') continue;
    const path = toPosix(entry.path);
    if (!isGovernancePath(path)) continue;
    if (typeof entry.patch !== 'string' || entry.patch.length === 0) {
      hits.push(`${path} (no patch available — treated as a transition)`);
      continue;
    }
    if (patchHasStatusTransition(entry.patch)) hits.push(path);
  }
  return hits;
}
