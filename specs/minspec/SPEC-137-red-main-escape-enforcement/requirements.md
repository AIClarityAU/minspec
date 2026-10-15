---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a merge-gating check that did not gate is an invariant-2 (no silent gate) defect
aspects: [silent-gate, branch-protection, required-checks, pre-commit, t0-gate, break-glass]
relates_to: ["#779", "#778", "#743", "#160", "#179", "#509", "#575", "#688", DR-060, DR-066, DR-081, SPEC-039]
---

# SPEC-137: A known-red state must not reach `main` (the parent-register-refs escape)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the Clarify questions, and approves it before any code changes.

Issue: #779. Data fix already landed: #778 (the two bare parent refs in DR-060).

## Problem

`packages/minspec/tests/parent-register-refs.test.ts` (the #160/#179 bare `DR-3xx`
attribution gate) caught two bare parent-register refs in DR-060 - but only AFTER
#743 merged (commit 7b82c46). `main` went red and every open PR's `test` check broke.
A check that fires after the merge is a detector, not a gate (constitution invariant 2).

The issue offers two candidate causes and does not choose between them:

- **(a)** `test` is not in `main`'s required-status-check set at merge time, or a path
  routes around it (the `docs-lane` auto-merge path, #575, and the docs-only
  classification in `.github/workflows/ci.yml` are the two docs-PR-specific
  mechanisms to inspect: DR-060 is a docs-corpus file and this test scans `docs/`).
- **(b)** #743 was merged while red via `--admin` break-glass.

**This spec does not assert which.** Picking one from the issue text would be
plausible-inference, not observation (CLAUDE.md evidence discipline). Establishing it is
FR-1, and the remaining requirements are conditioned on its result.

Note: `main-red-watch.yml` (#1394) already files an issue when `main` goes red. That is
a detector and is not changed by this spec; it is the reason this escape was visible.

## Functional requirements

- **FR-1 - Determine the escape path by observation.** Before any change, record in the
  Plan which of (a) / (b) / another path let #743 merge: read `main`'s ruleset
  (`/rules/branches/main`, not classic protection), the check runs and conclusions on
  #743's head SHA, who/what merged it and whether a bypass was used, and whether the
  `docs-lane` label was present. The finding cites those values, not inference.
- **FR-2 - `test` (or an equivalent that runs this suite) is required for every
  docs-corpus PR.** A PR touching only `docs/**` must not be able to merge with the
  `test` job red or unreported. A skipped-but-green report is acceptable only if the
  skipped work does not include the T0 gates that scan the docs corpus.
- **FR-3 - Required means required on every lane.** The `docs-lane` auto-merge path and
  the normal merge path are gated by the same check set (no lane merges on a subset).
- **FR-4 - Authoring-time catch.** The bare parent-register check fails at commit time
  for an added or changed file in its scan roots, so the author sees it before pushing,
  as the RCDD `commit-msg` gate does. The pre-commit gate shares the test's detection
  logic (one implementation, imported, not a second regex) so the two cannot drift.
  Like the existing gitleaks gate it is optional-by-design for missing tooling only; a
  detected violation fails closed, with file, line and the fix in the message.
- **FR-5 - Break-glass is bounded.** If FR-1 finds (b), `--admin`/bypass merges of a PR
  with a red required check are limited to the cases already permitted for machinery
  PRs (cf. #509), and a bypass merge of a red non-machinery PR is visible (a comment or
  issue naming the red check and the actor), never silent.
- **FR-6 - Gate-effectiveness probe.** A deterministic check (script or test) asserts
  that the required-check set on `main` contains the checks this repo relies on to block
  a known-bad state, and fails visibly if the read errors or the set is short. A missing
  or errored read fails closed (invariant 2), never passes.

## Acceptance criteria

- AC-1 (FR-1): the Plan names the actual escape path with cited ruleset/run/merge data.
- AC-2 (FR-2, FR-3): a test PR adding a bare `DR-3xx` to a `docs/` file, with and without
  the `docs-lane` label, cannot merge (red `test`, merge blocked).
- AC-3 (FR-4): staging the same file and running the pre-commit hook exits non-zero
  naming file and line; staging an attributed ref exits zero.
- AC-4 (FR-4): a test asserts the hook and `parent-register-refs.test.ts` call the same
  exported detector.
- AC-5 (FR-6): with a required-check set missing `test`, the probe exits non-zero; with
  the API read failing, it exits non-zero.
- AC-6: no regression to RCDD gate, branch guard, or gitleaks gate in `.githooks/pre-commit`.

## Invariants this must not break

1. Offline core (invariant 1): the pre-commit check is local, no network. FR-6 reads the
   GitHub API only in CI/dev tooling, never in the shipped extension's core path.
2. No silent gate (invariant 2): every new check fails visibly; no `|| true` on a
   load-bearing signal; no single producer for the required check.
3. Blast radius (invariant 3): the hook and any template change affect only repos with
   `.minspec/`; adopters are not changed by this repo's own `.githooks`.
4. Specs stay out of the parent-register scan (`specs/` is approval-hash-bound; the
   existing exclusion in the test is unchanged).

## Out of scope

- Changing `strict` on the ruleset (separate, see #1394 discussion).
- Reworking `main-red-watch`.
- Editing ruleset directly from an agent: ruleset changes are a human/admin act.

## Decisions needed (Clarify)

**DQ-1 - Where does the fix for the escape live if FR-1 finds `test` already required?**
- **Option A (rec):** fix the specific lane/classification that let it through (FR-2/3).
  Cost: depends on FR-1; may be a workflow change, which this repo treats as machinery
  needing human `--admin` merge.
- Option B: add a second independent witness job (e.g. a dedicated `docs-gates` required
  check running only the docs-scanning T0 tests). Cost: new required surface (cf. DR-081's
  `approval-integrity`) and a ruleset edit by a human; more robust against single-producer
  failure.

**DQ-2 - Pre-commit scope (FR-4).**
- **Option A (rec):** run only the parent-register detector on staged files in its scan
  roots (fast). Cost: other docs T0 gates still only catch at CI.
- Option B: run the whole docs-scanning T0 test subset at commit. Cost: slower commits,
  more friction, easier to bypass habitually.

**DQ-3 - Ruleset ownership of FR-6.** Probe needs a token able to read rulesets.
- **Option A (rec):** run it in an existing scheduled/dev workflow, reporting via issue
  like `main-red-watch`. Cost: detection is periodic, not per-PR.
- Option B: per-PR required check. Cost: another required check that hinges on a token
  an agent identity may lack (a permission gap could disable it - invariant 2).

**DQ-4 - Break-glass policy (FR-5)** applies only if FR-1 finds a bypass merge.
- **Option A (rec):** visible-record requirement only. Cost: does not prevent the bypass.
- Option B: forbid bypass for red non-machinery PRs via ruleset (no bypass actor).
  Cost: removes the founder's emergency lever (#509 tension).
