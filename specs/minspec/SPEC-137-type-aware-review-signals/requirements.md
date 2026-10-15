---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the review block feeds the auto-merge gate
aspects: [review-signals, auto-merge, change-type, conventional-commits, no-silent-gate, deny-by-default]
relates_to: [SPEC-024, DR-033, DR-058, DR-061, DR-003, "#180", "#598", "#590", "#534", "#490"]  # SPEC-024 consumes the signals; DR-033/058 consequence-hybrid; DR-003 RCDD
---

# MinSpec - Type-Aware Review Signals (Requirements)

**Triggered by:** #598 - "review-signals block hard-codes the RCDD (fix-only) triad". Origin: #180 (auto-built review signals). Consumer: SPEC-024 (auto-merge eligibility).
**Status:** specifying - spec only, nothing built. Code citations below were read from the tree at spec time.

## Context

`renderReviewSignals` (`packages/shared/src/review-signals.ts:233-267`) emits a fixed three-signal set for every PR: (1) root-cause <-> change, (2) regression distinguishes, (3) gate green. Signals 1-2 encode bug-fix (RCDD) semantics: signal 1 fails with "no root cause stated" on empty `rootCause` (`:104-107`), signal 2 fails with "no regression test named" (`:143-150`). `ReviewSignalsInput` (`:45-83`) carries no change-type discriminator and no caller supplies one.

Consequence 1 (cosmetic): a chore/rename PR (#590, landing #534) renders two red ❌ for evidence that is inapplicable by definition.

Consequence 2 (functional): `allReviewSignalsGreen` (`packages/minspec/src/lib/auto-merge.ts:282-284`) is `rootCauseGreen && regressionGreen && gateGreen`, and `decideAutoMerge` in consequence-hybrid mode forces `root-cause` / `regression-unproven` into `failed[]` (`:347-349`). So chore/docs/refactor PRs can never be auto-merge-eligible.

The render is **not** an honesty violation - ❌ truthfully says "evidence absent". The defect is that the signal vocabulary is fix-only and applied to every type.

## Scope sentence

Select the review-signal set from the PR's change type, keeping the `fix` set exactly as today, and make the auto-merge predicates consume the same selected set so renderer and gate cannot drift.

## Functional requirements

- **FR-1 Change-type input.** `ReviewSignalsInput` gains an optional `changeType` (`fix | feat | chore | refactor | docs | build | ci | style | test | perf | unknown`), derived from the Conventional-Commit type of the PR title (see Decisions needed D1 for the source). Absent / unparseable / unrecognised ⇒ `unknown`.
- **FR-2 Deny-by-default.** `unknown` and `feat`-without-a-defined-set resolve to the **fix triad (today's behaviour, unchanged)**. A type can only ever *swap in* a set; it can never remove a requirement without that type's own set being fully evidenced. Missing type must never be the cheaper path.
- **FR-3 Signal sets per type.** A single table (one source of truth, in `packages/shared`) maps type -> ordered signals {id, label, evaluator}. Candidate content (final content settled under D2):
  - `fix`: root-cause <-> change; regression distinguishes (red->green); gate green. Unchanged.
  - `chore` / `refactor`: no behaviour change (exports/public-API diff empty); tests updated and still green (not a new regression); gate green.
  - `docs`: links/refs resolve; no non-doc path touched; gate green.
  - `feat`: acceptance criteria covered; happy-path + primary-failure test; gate green.
  - `build` / `ci`: pipeline green on a representative run; reversible; gate green.
- **FR-4 Every set evaluates mechanically where it can.** Each non-fix signal must be derived from the diff / gate / test results by deterministic code, not from agent prose, mirroring how `gate` and `changedFiles` are already derived (not self-reported). A signal that cannot be computed renders ⚠️ UNVERIFIED, never ✅ (never claim an unproven check).
- **FR-5 Type is verified, not trusted.** A PR claiming `chore`/`docs`/`refactor` must pass a cheap mechanical *consistency check* against its diff (e.g. `docs` ⇒ only doc paths; `chore`/`refactor` ⇒ public exports unchanged, no new behaviour tests required). A claim the diff contradicts (a `chore:` title touching `src/` logic with no exports change is fine; a `chore:` that alters exported signatures is not) falls back to the fix triad, visibly: the block states "type `chore` claimed, diff disagrees - evaluated as fix". Otherwise relabelling a bug-fix as `chore` would be a one-word bypass of the regression requirement on the highest-consequence gate (SPEC-024).
- **FR-6 Renderer shows the type.** The block header names the evaluated type and which set applied, so a reader sees *why* regression is absent (inapplicable) vs missing.
- **FR-7 Auto-merge parity.** `allReviewSignalsGreen` and the `failed[]` mapping in `decideAutoMerge` consume the **same** selected set the renderer used (shared function, not a parallel list). A non-fix PR is eligible iff its own set is all-green AND the existing consequence/blast conditions (DR-033, DR-058 #490 affirmative low-blast signal) still hold. Type-awareness relaxes *which evidence is demanded*, never the blast gate.
- **FR-8 Callers.** `scripts/dispatch-issue.sh` (`:504-543`) and `scripts/auto-merge-gate.ts` (`:674-685`) pass the derived type through; the type is computed by the gate (verified authority, INV-3 overlay), not self-reported by the agent in `.review-signals.json`.
- **FR-9 Back-compat.** Input without `changeType` renders byte-identically to today.

## Acceptance criteria

- **AC-1** A `chore` PR with green gate and empty exports diff renders no ❌ and no "no root cause stated" / "no regression test named" text (FR-3). Verified on a fixture mirroring #590.
- **AC-2** A `fix` PR and an input with no `changeType` render byte-identically to the pre-change snapshot (FR-2, FR-9).
- **AC-3** A PR titled `chore:` whose diff changes an exported signature or touches code outside the type's allowed paths is evaluated as `fix`, and the block says so (FR-5).
- **AC-4** An unrecognised or malformed type string evaluates as the fix triad (FR-2).
- **AC-5** **T0 parity test:** for every type in the table and every combination of signal verdicts, renderer all-green === auto-merge `allReviewSignalsGreen` (extends the existing renderer<->predicate parity test in `auto-merge.test.ts`). Adding a type to the table without covering it fails the test.
- **AC-6** A non-fix, all-green PR with a *high-blast* consequence signal still holds in `decideAutoMerge` (FR-7).
- **AC-7** An uncomputable non-fix signal renders ⚠️ and does not count green (FR-4).

## Invariants the change must not break

- **No silent gate (constitution 2):** a missing/errored type witness fails closed to the stricter fix set, visibly (FR-2, FR-5). No `|| true` around the type derivation.
- **Offline (constitution 1):** type derivation and set evaluation are pure and local.
- **#180 honesty:** nothing renders ✅ for evidence not produced; inapplicable signals are *omitted with the reason stated*, not rendered as passing.
- **DR-033 / DR-058 deny-by-default** blast gate is untouched.
- Machinery path: `packages/shared`, `packages/minspec/src/lib/auto-merge.ts`, `scripts/` are gate machinery - the implementing PR needs human `--admin` merge.

## Decisions needed (Clarify)

- **D1 - Source of the change type.**
  - (a) **PR title Conventional-Commit prefix** **(rec)** - already enforced by the commit convention, available to both the dispatcher and the gate. Cost: a title is author-editable, so it must lean on FR-5's diff consistency check or it is a bypass.
  - (b) Branch/commit-type of the first commit - harder to retitle, but squash merges lose it and agents write mixed commit types.
  - (c) A label (`type:chore`) - explicit, but needs a second producer and drift against the title.
- **D2 - Initial scope of types.**
  - (a) **Ship `fix` (unchanged) + `chore`/`refactor` + `docs` only** **(rec)** - covers the motivating case and the lowest-risk class; everything else stays on the fix triad via FR-2. Cost: `feat`/`build`/`ci` PRs still show the fix-shaped ❌ until a follow-up.
  - (b) All five sets now - complete, but `feat` "acceptance criteria covered" and `ci` "representative run" have no known mechanical evaluator, so they would ship as permanent ⚠️ or as honour-system prose (what FR-4 forbids).
- **D3 - Is "no behaviour change" mechanically definable for `refactor`/`chore`?** Exports/public-API diff is cheap but misses internal behaviour change; snapshot-equal tests are stronger but need infra that may not exist. Options: (a) exports-diff only **(rec)** - cheap and deterministic, cost: a refactor altering internal behaviour passes this signal and relies on the green gate and tests; (b) require unchanged test files plus green gate in addition, cost: legitimate renames that update tests (#534-style) would fail.
- **D4 - Should type-awareness ship before auto-merge is switched on?** Rendering-only first (FR-1..FR-6, FR-9) then the gate (FR-7, FR-8) is lower risk; doing both together avoids a window where the render and predicate disagree. **(rec)** one PR with the parity test (AC-5) as the guard. Cost: a larger machinery diff for one human read.

## Out of scope

Changing the consequence analyzers or blast classification; the `ready-to-merge` native path (DR-061); inventing new change types beyond Conventional Commits.

## Follow-ups (tracked)

None beyond D2(a)'s deferral of `feat`/`build`/`ci` sets - to be filed as an issue when D2 is decided.
