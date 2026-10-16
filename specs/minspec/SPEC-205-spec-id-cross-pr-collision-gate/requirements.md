---
id: SPEC-205
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a duplicate spec id makes every id-keyed lookup answer about the wrong file
aspects: [validation, governance, tier-0, ci, silent-gate, id-uniqueness]
depends_on: [SPEC-001]
relates_to: [DR-066, "#1327", "#1418", "#1226", "#168", "#560"]
implements: [scripts/check-spec-id-collision.ts, scripts/lib/spec-id-cross-pr.ts, .github/workflows/spec-id-collision.yml]
affects: [scripts/lib/spec-id-collision.ts, scripts/validate-frontmatter.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-205: Spec ids are collision-checked across main and every open PR, not only inside one checkout

Issue: #1327 (a duplicate `SPEC-051` reached open PR #1302).

## One-Sentence Scope

Add the cross-PR half of the spec-id uniqueness gate - a CI check keyed on spec directory names, the twin of `dr-id-collision.yml` - so a spec id that exists only on `main` or in another open PR cannot be merged a second time.

## Context (measured, not inferred)

- **The offline half already exists.** `scripts/validate-frontmatter.ts` Rule 18 (fatal, #1418) calls `checkDeclaredSpecIds` from `scripts/lib/spec-id-collision.ts`: two spec directories declaring one `id:`, or a declared `id:` disagreeing with its directory name. The issue text predates it, so its proposed fix item 1 is **done**; this spec must not re-do it.
- **The cross-PR half does not exist for specs.** `.github/workflows/` holds `dr-id-collision.yml` and no spec equivalent; `scripts/check-dr-id-collision.ts` handles decision records only. This is the gap that let #1302 through: a branch-local `validate` cannot see an id that lives only on `main` or in a sibling PR (Rule 17's own comment states the same blind spot for DRs).
- **Root cause (mechanism + missing gate).** Spec creation computes `max(existing SPEC-NNN) + 1` against the local checkout; concurrent worktree sessions (#168) each compute it correctly and cannot see each other. Rule 18 catches only collisions visible inside one tree. Nothing compares a PR against base plus the other open PRs.
- Branch listing at authoring time (offline `git ls-tree` of remote refs) shows ids well above 190 claimed on unmerged branches while `main` tops out at SPEC-136, so concurrent claims are the normal state, not a rare race.

## Functional Requirements

1. **FR-1 (cross-PR check).** A new CI workflow, `spec-id-collision`, runs on every pull request to `main` and fails when a spec directory this PR adds claims a `SPEC-NNN` id already held by the base branch or by any other open PR.
2. **FR-2 (keyed on directory names).** The check derives claimed ids from `specs/<product>/SPEC-NNN-<slug>/` directory names in base and in each open PR's changed-file list, not from file contents, because a PR's frontmatter is not cheaply readable across every open PR. Rule 18's mismatch half is what makes directory names a sound key and is relied on, not re-implemented.
3. **FR-3 (decision logic is pure and shared in shape).** The verdict function is pure (no fs, no network), lives under `scripts/lib/`, mirrors `dr-id-collision.ts`'s input/verdict shape, and is unit-tested; only the thin script touches `gh`.
4. **FR-4 (names the fix).** On failure the message names every colliding id, its holder (base or PR number), and the next free id (max across base and all open PRs, plus one), so the fix is one rename.
5. **FR-5 (fail closed, visibly).** Any inability to establish that no collision exists - `gh` missing or erroring, an unrecognised response shape, an empty base listing while the checkout holds specs the PR does not add - exits non-zero with a message. No path exits 0 without a comparison having been made (constitution invariant 2).
6. **FR-6 (no `paths:` filter).** The workflow has no `paths:` filter; on a PR that adds no spec it exits 0 cheaply. A filter would leave the check unreported and unsatisfiable once required (#560 silent-gate class, DR-066).
7. **FR-7 (offline stays offline).** The network lives only in the CI script and workflow, never in `packages/` (invariant 1). Rule 18 stays unchanged and offline.
8. **FR-8 (approval-store aliasing, scoped).** See Decisions needed D-2; the default is that no sidecar-specific check is added.

## Acceptance Criteria

- AC-1: Given base holding `SPEC-051-a/` and a PR adding `SPEC-051-b/`, the check fails and names `SPEC-051`, the base as holder, and the next free id.
- AC-2: Given two open PRs each adding a directory with the same id, the later-evaluated PR fails naming the other PR number.
- AC-3: A PR adding no spec directory exits 0 after one listing call.
- AC-4: `gh` unavailable, non-JSON output, or an empty base listing against a populated checkout each exit non-zero (one test per branch).
- AC-5: A PR that only edits files inside an existing spec directory does not "claim" its id and does not collide with itself.
- AC-6: The workflow file has no `paths:` key (asserted by test, not by reading).
- AC-7: Replaying #1302's situation (same id, different slug, one on base) fails the check; the pure function has a mutation-sensitive test for the base-held and PR-held arms separately.

## Decisions needed (Clarify)

- **D-1: make the check required on `main`?** Options: **(a, rec)** add `spec-id-collision` to the `main` ruleset required checks - closes the gap, cost: a founder-only ruleset change, and a PUT replaces the whole ruleset (a retyped payload can drop other required checks); **(b)** leave advisory like `dr-id-collision` today - zero setup, cost: an advisory failure is exactly what #1302 shipped past. A workflow cannot make itself gating; this is a human step either way.
- **D-2: extend to the approval sidecar (issue item 3)?** Sidecars live at `.minspec/approvals/specs/<product>/SPEC-NNN-<slug>/requirements.md.json`, keyed by directory path, which already carries the id and slug. Two specs with different slugs therefore get different sidecar paths; the aliasing happens in id-keyed lookups (`facts approval SPEC-NNN`, per Rule 18's comment), which a directory-name check already prevents upstream. Options: **(a, rec)** no sidecar-specific check - it would duplicate FR-1/Rule 18; cost: an orphan sidecar for a renumbered spec stays undetected (I believe this is separate drift, unverified); **(b)** add a check that every sidecar's directory exists and its id matches - catches orphans, cost: a new fatal rule over 82 sidecars needing a clean-corpus pass first and scope beyond this issue.
- **D-3: one workflow or extend `dr-id-collision.yml`?** **(a, rec)** separate workflow and script - independent failure, independent required-check name, cost: duplicated `gh` plumbing; **(b)** generalise the DR script over both corpora - less duplication, cost: a regression in one gate disables both (a single producer, invariant 2).

## Invariants (must hold)

1. Core functionality works offline: no network call from `packages/` (constitution invariant 1).
2. No silent gate: errors and missing witnesses fail closed and visibly (invariant 2, FR-5, FR-6).
3. Blast radius: the workflow ships only in this repo; nothing is added to adopter templates by this spec (invariant 3).
4. Rule 18 and the existing DR gates keep their behaviour; the existing spec corpus stays green.

## Out of scope

- Re-implementing Rule 18 (#1418, shipped).
- Serialising id allocation or changing how `max+1` is computed.
- Renumbering existing specs.
- Making the ruleset change itself (human step, D-1).

## Risks

- Rate/size of listing every open PR's files: mitigated by the same approach `dr-id-collision` uses; Plan phase should measure it at ~400 open branches.
- A PR's id decaying after it waits (as #1209 did for DRs): the check re-runs on `synchronize`, but not when base moves; Plan should decide whether a base-move re-run is needed.
