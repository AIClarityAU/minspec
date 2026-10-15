---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core - init/onboarding scaffolding
aspects: [init, coverage, honest-signpost, scaffold, onboarding]
relates_to: ["#920", "#918", "#553", SPEC-042, SPEC-033, DR-003]
---

# SPEC-137 - Scaffolded projects: the coverage seed must not promise enforcement MinSpec does not scaffold

Issue: #920 (bug: init strings promise "CI fails below it" in a project with no vitest/CI gate).

## Problem (corrected premise)

The issue as filed says "nothing reads" `.minspec/config.json` `coverage.minimumPercentage`. **That is wrong for this repo** and SPEC-042's Clarify already recorded the correction: the repo-root `vitest.config.ts:11` calls `loadConfig(rootDir).coverage.minimumPercentage` and feeds it to `coverage.thresholds` (statements/branches/functions/lines); `scripts/test-all.sh:153` runs `vitest run --coverage` on it (shipped by `7fa94f9`, #553). The original grep was scoped to `packages/*/src` and missed the repo-root build config.

**What survives (the narrowed defect).** A project that runs `MinSpec: Initialize SDD Structure` inherits the *seed* (`scaffold()` writes `coverage.minimumPercentage: 80`; `setCoverageMinimum`, `config.ts`, persists the dev's pick) but **not** the consumer: MinSpec scaffolds no `vitest.config.ts` and no test/coverage CI workflow (scaffolded workflows are governance only: `ai-review.yml`, `ai-review-retry.yml`, `minspec-validate.yml`, `ready-to-merge.yml`). The strings below nonetheless speak as if enforcement exists in *that* project:

- `init.ts:1201` placeholder: "Minimum code coverage to enforce for this project (CI fails below it)"
- `init.ts:1223` toast: "coverage gate set to N% (enforced by vitest thresholds in CI)"
- `init.ts:87` and `init.ts:1183` comments: "CI/vitest read it" / "the file `vitest.config.ts` ... read"
- `packages/minspec/package.json:556` setting description: "The value CI and vitest actually enforce lives in .minspec/config.json"

(Line numbers measured at spec time on this branch; the issue's `785/802/824/529` have drifted.)

**Root cause (mechanism + missing gate, for the Plan phase to confirm).** The write half shipped to every scaffolded project; the read/enforce half exists only in this monorepo's own build config, so strings written from the monorepo's vantage are true here and false in an adopter. Missing gate: no test pins that a string claiming enforcement is only emitted when a consumer of the value exists in the target project (G-1 never-wrong; DR-003 artifact-existence != feature-existence).

## Functional requirements

- **FR-1 (no unconditional enforcement claim).** No user-facing string emitted by `MinSpec: Initialize` (placeholder, toast, setting description) may state or imply that the coverage minimum is enforced, unless FR-2 holds for the target project at the moment the string is shown.
- **FR-2 (claim is gated on a detected consumer).** "Enforced" wording is permitted only when the target workspace contains a consumer of `.minspec/config.json` `coverage.minimumPercentage`: a vitest config whose thresholds are derived from it, or a CI step doing the same. Detection is an offline file read (invariant 1) and is a pure function with a table test. Absent a consumer, the strings use the honest form: MinSpec records the value in `.minspec/config.json` for the project's own vitest/CI to read, and does not itself enforce it.
- **FR-3 (setting description).** The `minspec.coverage.minimumPercentage` description states that the value is a convention recorded in `.minspec/config.json`; enforcement exists only where the project wires a consumer. It must not say "CI and vitest actually enforce".
- **FR-4 (comments).** Stale "CI/vitest read it" comments in `init.ts` are corrected in the same change (sweep: grep the old terms).
- **FR-5 (regression pin).** A test fails if a literal enforcement claim ("CI fails below it", "enforced by vitest thresholds") is reachable in a fixture project with no consumer, and passes in a fixture with one.
- **FR-6 (no scope creep).** Whichever Decision DQ-1 picks, SPEC-042's coverage field framing (FR-11/AC-9: non-enforced seed) is unchanged.

## Acceptance criteria

- **AC-1 (FR-1, FR-2).** Init into an empty folder: placeholder and toast contain no "CI fails" / "enforced" wording; they say the value is recorded for the project's own tooling.
- **AC-2 (FR-2).** Init into a fixture whose `vitest.config.ts` reads `coverage.minimumPercentage` from `.minspec/config.json`: the enforced wording may appear.
- **AC-3 (FR-3).** `package.json` description contains no "actually enforce"; a test reads the manifest string.
- **AC-4 (FR-5).** Reverting any one string to the old text turns the pin red (mutation check).
- **AC-5 (DQ-1 Option A only).** In a scaffolded project, `vitest run --coverage` below the threshold exits non-zero and at/above exits zero; the minimum is read from `.minspec/config.json`.

## Invariants that must not break

1. Offline, no network (invariant 1): consumer detection reads local files only.
2. No silent gate (invariant 2): if a consumer is scaffolded (Option A) its failure is visible; the detector must not swallow read errors into "enforced". An unreadable file means "no consumer" (honest wording), never "enforced".
3. Blast radius (invariant 3): nothing is written to a repo without `.minspec/`; Option A scaffolds files only inside an init the user explicitly ran.
4. Evidence discipline: no string claims behaviour without a code consumer.

## Out of scope

- Changing this repo's own `vitest.config.ts` gate (already works).
- Surfacing/cutting the coverage field on the onboarding page (SPEC-042 FR-OQ1, resolved: keep, framed as a seed).

## Decisions needed (Clarify)

- **DQ-1: honest strings (B) or scaffold a real gate (A)?**
  - **Option B (rec): make the strings honest** (FR-1 to FR-5 only). Smallest blast radius; fits T3. Cost: a scaffolded project still has no coverage gate, so the onboarding question "what minimum?" asks for a value nothing consumes; we are knowingly shipping a seed with no reader.
  - **Option A: scaffold a `vitest.config.ts` (or CI step) that reads the value.** Makes the original strings true. Cost: MinSpec would then own a test-runner config in adopters' repos, which may already have one or use jest/pytest (collision, wrong-stack assumption), plus a new managed-region/drift surface (SPEC-043) and a CI workflow touching branch-ruleset required checks (SPEC-033); materially larger than T3 and arguably invariant-3-adjacent. If chosen, split into a follow-up spec and keep B's honesty as the interim.
  - **Option C: hybrid** - B now, and A only when a vitest config is detected to extend (never create one). Cost: two code paths and a detector that must track vitest config shapes.
- **DQ-2: drop the onboarding prompt itself until a consumer exists?** Rec: keep it (cheap, records team policy per SPEC-042); cost: asks a question with no effect on a fresh project.
