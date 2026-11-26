---
id: SPEC-439
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
**Status:** specifying - spec only, nothing built. Code citations below were re-read against `origin/main` at 0274f0a9 (2026-11-27); line numbers rot, so re-check by symbol name before building.

## Context

`renderReviewSignals` (`packages/shared/src/review-signals.ts:260`) emits a fixed three-signal set for every PR: (1) root-cause <-> change, (2) regression distinguishes, (3) gate green. Signals 1-2 encode bug-fix (RCDD) semantics: signal 1 fails with "no root cause stated" on empty `rootCause` (`rootCauseSignal`, `:107-113`), signal 2 fails with "no regression test named" (`regressionSignal`, `:146-155`). `ReviewSignalsInput` (`:52`) carries no change-type discriminator and no caller supplies one.

Consequence 1 (cosmetic): a chore/rename PR (#590, landing #534) renders two red ❌ for evidence that is inapplicable by definition.

Consequence 2 (functional): `allReviewSignalsGreen` (`packages/minspec/src/lib/auto-merge.ts:349`) is `rootCauseGreen && regressionGreen && gateGreen`, and `decideAutoMerge` in consequence-hybrid mode forces `root-cause` / `regression-unproven` into `failed[]` (`:437-438`). So chore/docs/refactor PRs can never be auto-merge-eligible.

The render is **not** an honesty violation - ❌ truthfully says "evidence absent". The defect is that the signal vocabulary is fix-only and applied to every type.

## Scope sentence

Select the review-signal set from the PR's change type, keeping the `fix` set exactly as today, and make the auto-merge predicates consume the same selected set so renderer and gate cannot drift.

## Functional requirements

- **FR-1 Change-type input.** `ReviewSignalsInput` gains an optional `changeType` (`fix | feat | chore | refactor | docs | build | ci | style | test | perf | unknown`), derived from the Conventional-Commit type of the PR title (see Decisions needed D1 for the source). Absent / unparseable / unrecognised ⇒ `unknown`.
- **FR-2 Deny-by-default.** `unknown` and every type without a defined set (initially `feat`, `refactor`, `build`, `ci`, `style`, `test`, `perf`) resolve to the **fix triad (today's behaviour, unchanged)**, and the header says so (FR-6): "type `feat`: no dedicated set yet, evaluated as fix". The fix-shaped ❌ on those PRs is deliberate and stays until their sets ship (backlog line, see Follow-ups); it is not the misleading render this spec removes, because the header now names why. A type can only ever *swap in* a set; it can never remove a requirement without that type's own set being fully evidenced. Missing type must never be the cheaper path.
- **FR-3 Signal sets per type.** A single table (one source of truth, in `packages/shared`) maps type -> ordered signals {id, label, evaluator}. Candidate content (final content settled under D2):
  - `fix`: root-cause <-> change; regression distinguishes (red->green); gate green. Unchanged.
  - `chore`: no executable-source logic change (FR-5 path-class check passes); gate green.
  - `refactor`: **no set in the first build** - see D3; stays on the fix triad until a mechanical behaviour-equivalence witness exists.
  - `docs`: links/refs resolve; no non-doc path touched; gate green.
  - `feat`: acceptance criteria covered; happy-path + primary-failure test; gate green.
  - `build` / `ci`: pipeline green on a representative run; reversible; gate green.
- **FR-4 Every set evaluates mechanically where it can.** Each non-fix signal must be derived from the diff / gate / test results by deterministic code, not from agent prose, mirroring how `gate` and `changedFiles` are already derived (not self-reported). A signal that cannot be computed renders ⚠️ UNVERIFIED, never ✅ (never claim an unproven check).
- **FR-5 Type is verified, not trusted.** A PR claiming `chore` or `docs` must pass a mechanical *path-class* check against its diff, and a claim the diff contradicts is evaluated as the fix triad, visibly: the block states "type `chore` claimed, diff disagrees - evaluated as fix".
  - `docs`: every changed path is a doc path (`*.md`, `docs/**`, `specs/**`).
  - `chore`: every changed path is a non-executable path (config, lockfile, doc, test fixture) OR a pure rename (git similarity 100%, no content change). **Any content change to an executable source file** (`packages/*/src/**` non-test, `scripts/**`) fails the check.
  - Why path-class and not an exports diff: a bug fix usually changes internal logic and rarely an export, so "exports unchanged" would pass exactly the PR that needs the regression requirement, and retitling `fix:` to `chore:` would be a one-word bypass of the highest-consequence gate (SPEC-024). Path-class closes it because a logic fix necessarily changes executable source content. Cost: a legitimate non-rename chore that edits source (a dependency bump touching an import) evaluates as fix and shows the fix-shaped ❌; that is the safe direction.
- **FR-6 Renderer shows the type.** The block header names the evaluated type and which set applied, so a reader sees *why* regression is absent (inapplicable) vs missing.
- **FR-7 Auto-merge parity.** `allReviewSignalsGreen` and the `failed[]` mapping in `decideAutoMerge` consume the **same** selected set the renderer used (shared function, not a parallel list). A non-fix PR is eligible iff its own set is all-green AND the existing consequence/blast conditions (DR-033, DR-058 #490 affirmative low-blast signal) still hold. Type-awareness relaxes *which evidence is demanded*, never the blast gate.
- **FR-8 Callers.** One shared pure function in `packages/shared` (`deriveChangeType(prTitle, diffEntries)` returning the evaluated type and any "claimed, diff disagrees" note) is the only deriver; both callers invoke it and neither reads the type from the agent.
  - Dispatch path: `scripts/dispatch-issue.sh` builds `SIGNALS_INPUT` with `jq` in the parent (`$prose + {changedFiles, gate}`, near `:2955`) before any gate run; the parent computes `changeType` there from the PR title and `git diff --name-status -M origin/main...HEAD`, and the `jq` merge puts `changeType` **after** `$prose` and deletes any `changeType` key in the agent file, so the agent file cannot supply or override it.
  - Gate path: `scripts/auto-merge-gate.ts` `loadReviewSignals` parses the agent file as `ReviewSignalsInput`; it must likewise discard any `changeType` from the file and set it from `deriveChangeType` before `decideAutoMerge` and `renderReviewSignals`.
  - Both paths read the same inputs (title + diff), so renderer and gate see the same type; AC-5 plus a new AC-8 pin it.
- **FR-9 Back-compat.** Input without `changeType` renders byte-identically to today.

## Acceptance criteria

- **AC-1** A `chore` PR with green gate whose diff is only non-executable paths or pure renames renders no ❌ and no "no root cause stated" / "no regression test named" text (FR-3). Verified on a fixture mirroring #590.
- **AC-2** A `fix` PR and an input with no `changeType` render byte-identically to the pre-change snapshot (FR-2, FR-9).
- **AC-3** A PR titled `chore:` whose diff changes the content of any executable source file (including an internal-logic-only bug fix that changes no export) is evaluated as `fix`, and the block says so (FR-5). A `docs:` PR touching a non-doc path likewise.
- **AC-4** An unrecognised or malformed type string evaluates as the fix triad (FR-2).
- **AC-5** **T0 parity test:** for every type in the table and every combination of signal verdicts, renderer all-green === auto-merge `allReviewSignalsGreen` (extends the existing renderer<->predicate parity test in `auto-merge.test.ts`). Adding a type to the table without covering it fails the test.
- **AC-6** A non-fix, all-green PR with a *high-blast* consequence signal still holds in `decideAutoMerge` (FR-7).
- **AC-7** An uncomputable non-fix signal renders ⚠️ and does not count green (FR-4).
- **AC-8** A `changeType` key present in the agent's `.review-signals.json` is ignored by both the dispatch path and the gate path; both derive the same type from the same title+diff (FR-8).

## Invariants the change must not break

- **No silent gate (constitution 2):** a missing/errored type witness fails closed to the stricter fix set, visibly (FR-2, FR-5). No `|| true` around the type derivation.
- **Offline (constitution 1):** type derivation and set evaluation are pure and local.
- **#180 honesty:** nothing renders ✅ for evidence not produced; inapplicable signals are *omitted with the reason stated*, not rendered as passing. Types with no dedicated set keep today's render on purpose (FR-2), with the header naming why.
- **DR-033 / DR-058 deny-by-default** blast gate is untouched.
- Machinery path: `packages/shared`, `packages/minspec/src/lib/auto-merge.ts`, `scripts/` are gate machinery - the implementing PR needs human `--admin` merge.

## Decisions needed (Clarify)

- **D1 - Source of the change type.**
  - (a) **PR title Conventional-Commit prefix** **(rec)** - already enforced by the commit convention, available to both the dispatcher and the gate. Cost: a title is author-editable, so it must lean on FR-5's diff consistency check or it is a bypass.
  - (b) Branch/commit-type of the first commit - harder to retitle, but squash merges lose it and agents write mixed commit types.
  - (c) A label (`type:chore`) - explicit, but needs a second producer and drift against the title.
- **D2 - Initial scope of types.**
  - (a) **Ship `fix` (unchanged) + `chore` + `docs` only** **(rec)** - covers the motivating case (#590 is a chore/rename) and the lowest-risk class; everything else, including `refactor`, stays on the fix triad via FR-2. Cost: `feat`/`refactor`/`build`/`ci` PRs still show the fix-shaped ❌ until a follow-up.
  - (b) All five sets now - complete, but `feat` "acceptance criteria covered" and `ci` "representative run" have no known mechanical evaluator, so they would ship as permanent ⚠️ or as honour-system prose (what FR-4 forbids).
- **D3 - Is "no behaviour change" mechanically definable for `refactor`?** An exports/public-API diff does not close the relabel bypass (a fix changing only internals passes it), so it cannot gate a `refactor` set. Options: (a) **defer `refactor` entirely; `chore` uses the FR-5 path-class check** **(rec)** - deterministic and bypass-closed; cost: refactors keep the fix-shaped ❌ and are never auto-merge-eligible until a witness exists; (b) require unchanged test files plus green gate for `refactor`; cost: legitimate refactors that update tests (#534-style) fail it, and "tests unchanged" still does not prove internals equivalent.
- **D4 - Should type-awareness ship before auto-merge is switched on?** Rendering-only first (FR-1..FR-6, FR-9) then the gate (FR-7, FR-8) is lower risk; doing both together avoids a window where the render and predicate disagree. **(rec)** one PR with the parity test (AC-5) as the guard. Cost: a larger machinery diff for one human read.

## Out of scope

Changing the consequence analyzers or blast classification; the `ready-to-merge` native path (DR-061); inventing new change types beyond Conventional Commits.

## Follow-ups (tracked)

- backlog: 2026-11-27 - SPEC-439 deferred type sets (`feat`, `refactor`, `build`, `ci`) need mechanical evaluators before they can leave the fix triad (source: SPEC-439 D2/D3); line added to `docs/backlog.md` in this PR.
