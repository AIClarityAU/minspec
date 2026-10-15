---
id: SPEC-138
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry (same epic as SPEC-033)
aspects: [ci, scaffold, required-checks, per-language, detection, tier-b, no-silent-gate, tier-0]
relates_to: [SPEC-033, SPEC-071, DR-050, DR-066, DR-037, "#622", "#564", "#559", "#619"]
---

# SPEC-138: Portable `ci.yml` scaffold with per-language code-check generation (Slice 4 of #564)

> Materializes [#622](https://github.com/AIClarityAU/minspec/issues/622). Follows #564
> (Tier-B *detection* shipped; `ci.yml` scaffolding skipped) and #559 (the
> permanent-pending trap). No new DR proposed; rests on DR-050 (read-only probe,
> consent-gated mutation) and DR-066 (no silent gate).
>
> **Relationship to the parked draft for #564's remainder** (commit `5a19cdda`, branch
> `agent/issue-564`, also numbered SPEC-137 — id collides with several other parked
> drafts; the collision gate decides final numbering). That draft scaffolds a
> `package.json`-only `ci.yml` (`npm run lint|test|build`). **This spec generalises it**
> to non-npm languages and supersedes its FR-1 if both are approved. Decision DQ-1 asks
> whether to merge them.

## One-Sentence Scope

Generate a repo-agnostic `.github/workflows/ci.yml` whose `lint`/`test`/`build` jobs are
derived from what the target repo really is (npm scripts, or the language's standard
commands), so a Tier-B check is required only if a job that reports it exists and does real work.

## Problem (verified against code, 2026-10-16)

- `detectCodeChecks` (`packages/minspec/src/lib/ruleset-advisor.ts:378`) detects only
  non-blank `package.json` scripts named `lint`/`test`/`build`. Python, Go, Rust, etc.
  repos always detect as "none", so Tier B is never required for them.
- No template emits `ci.yml`; minspec's own `.github/workflows/ci.yml` is monorepo-specific
  (packages/*, vitest, coverage) and would deadlock elsewhere.
- The detector's own comment (`ruleset-advisor.ts:373-376`) records the deeper gap: a
  script that exists but certifies nothing (e.g. `test` with zero test files).
- Root cause (mechanism + missing gate): Tier-B *requirement* is computed from repo
  detection while the *producer* (a CI job) is not generated from the same detection, so
  requirement and producer can diverge. The missing gate is a single source of truth
  that both the generator and the resolver read.

## Functional requirements

- **FR-1 — Language/command detection, pure.** A pure function (no fs/network; callers
  probe and pass facts in, like `detectCodeChecks`) maps repo facts (manifest files
  present, parsed `package.json` scripts, lockfiles) to, per check
  (`lint`/`test`/`build`), either a concrete command + toolchain setup, or *absent*.
  Initial ecosystems: Node (npm scripts; package manager from lockfile), Python
  (`pyproject.toml`/`requirements.txt`), Go (`go.mod`), Rust (`Cargo.toml`). Others ⇒ absent.
- **FR-2 — Only real commands.** A check is detected only when its command is
  unambiguous (e.g. `go test ./...`, `cargo test`, `npm run lint`). A language default
  that depends on an unconfigured tool (e.g. `ruff`/`flake8` with no config) is absent,
  not guessed. Absence ⇒ not generated ⇒ not required (#559 rule).
- **FR-3 — Generate jobs only for detected checks.** The scaffolded `ci.yml` contains one
  job per detected check, job name equal to the context (`lint`, `test`, `build`),
  `pull_request` trigger, pinned action versions, no minspec-monorepo literals
  (packages/*, vitest, coverage badge). No job is emitted for an absent check, so no
  skipped-green job exists. (Contrast with the parked draft's skip-green; see DQ-1.)
- **FR-4 — One source of truth for resolver and generator.** The set of contexts the
  generated file reports is the same value that feeds `resolveTieredRequiredChecks`'s
  `codeChecks` input — never two hand-kept lists. A test fails if they diverge.
- **FR-5 — Scaffolding is not requiring.** Writing `ci.yml` never itself adds a required
  context; the existing consent-gated ruleset step does, and only for contexts in FR-4.
- **FR-6 — Refresh re-detects.** Init/Refresh recompute detection; a check that appears
  later (new script, new language manifest) is added by Refresh through the managed-region
  contract (DR-037); a check that disappears is removed from the file **and flagged**
  as a now-stale required context for the SPEC-071 drift witness, never silently left
  required-but-unproduced.
- **FR-7 — Never clobber an owned CI file.** If `ci.yml` exists without MinSpec managed
  markers, skip and warn (visible), do not overwrite or append. (Aligns with parked draft DQ-3.)
- **FR-8 — Failure is visible.** An unreadable/malformed manifest yields "not detected"
  with a surfaced reason, never a thrown crash or a silent "none" (DR-066).
- **FR-9 — Opt-in only.** Nothing is written unless `.minspec/` exists at the repo root.

## Invariants (must not break)

- **INV-1 Offline (constitution 1):** detection reads local files only; no network.
- **INV-2 No silent gate (constitution 2):** no required context lacks a producer
  (FR-4/FR-6); no swallowed error (FR-8); no `|| true` in generated steps — a failing
  command fails the job.
- **INV-3 Blast radius (constitution 3):** FR-7 and FR-9; repos that did not opt in are untouched.
- **INV-4:** `MinSpec SDD validation` stays always-required and independent of this feature.

## Acceptance criteria

- **AC-1** `package.json` with `lint` and `build` scripts only → jobs `lint`, `build`; required set gains exactly those.
- **AC-2** `go.mod` only → job `test` (`go test ./...`) and `build` (`go build ./...`); no `lint`.
- **AC-3** `Cargo.toml` → `test`, `build`; `pyproject.toml` with no configured linter → no `lint` job.
- **AC-4** Repo with no recognised manifest (sealbox-shaped) → no code-check jobs, required set unchanged, nothing pending forever.
- **AC-5** Unmarked pre-existing `ci.yml` → untouched, warning shown.
- **AC-6** Removing the `test` script then Refresh → job removed and stale-required-context flagged.
- **AC-7** Parity test: generated job names == resolver `codeChecks` keys for every fixture above.
- **AC-8** Generated YAML passes the repo's actionlint check for each ecosystem fixture.

## Out of scope

Reviewer secrets/App activation (parked draft for #564); coverage/badges; matrix builds;
monorepo multi-package layout detection; ecosystems beyond FR-1; proving a test suite is
non-empty (DQ-3); ruleset drift detection itself (SPEC-071).

## Decisions needed (Clarify)

- **DQ-1 — Merge with the parked #564-remainder draft or keep separate?**
  (A) **(rec)** Keep this spec as the generator/detector and let that draft shrink to
  reviewer activation only; cost: both must be edited so FR-1 there is dropped, and the
  skip-green behaviour it recommends is replaced by generate-only-if-detected.
  (B) Approve that draft's npm-only `ci.yml` first, extend later; cost: a template rewrite
  and a window where non-npm repos get a `ci.yml` that reports nothing.
- **DQ-2 — Which ecosystems ship first?** (A) **(rec)** Node, Python, Go, Rust as in FR-1;
  cost: four command tables to maintain and keep correct. (B) Node only plus an extension
  point; cost: the issue's "per-language" goal is deferred.
- **DQ-3 — Handle "script exists but certifies nothing"?** (A) **(rec)** No: document it,
  keep the existing detector caveat; cost: a `test` job can be green over zero tests.
  (B) Add a cheap probe (test-file glob per ecosystem); cost: more heuristics, false negatives
  that drop a legitimately-required check.
- **DQ-4 — Python lint default.** (A) **(rec)** Absent unless a linter config is present;
  cost: many Python repos get no `lint` check. (B) Default to `ruff check`; cost: may
  fail on repos not configured for it, which then blocks every PR once required.
- **DQ-5 — Tier.** Predicted T3 (new template, detector, resolver wiring, four ecosystems).

## Follow-ups (tracked)

- Parked #564 remainder draft needs its FR-1 reconciled with this spec — tracked by DQ-1, #564.
- Spec-id collision across parked drafts — resolved by the collision gate at PR time.
