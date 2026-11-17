---
id: SPEC-308
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a lifecycle claim must be backed by evidence
aspects: [lifecycle, status, signpost, never-wrong, tier-0, validator]
depends_on: [SPEC-038, SPEC-064]
relates_to: [SPEC-015, SPEC-026, SPEC-027, SPEC-031, SPEC-034, SPEC-059, DR-003, DR-069]
implements: [packages/minspec/src/lib/phase-order.ts, packages/minspec/tests/phase-order.test.ts]
affects:
  - packages/minspec/src/lib/spec-validator.ts
  - packages/minspec/src/lib/config.ts
  - scripts/validate-frontmatter.ts
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Phase-claim honesty gates: order check, and a status/implementation claim that must be backed by code (Requirements)

> Traces to **[#818](https://github.com/AIClarityAU/minspec/issues/818)** — four past-Clarify
> specs never implemented (SPEC-026/027/034 falsely `implementing`, SPEC-031 `specifying`),
> plus SPEC-015's phase anomaly. Same family as SPEC-002 / #692 (artifact-existence ≠
> feature-existence, DR-003 Evidence Discipline).

## One-Sentence Scope

A spec may not claim a later lifecycle phase than its earlier phases support: add the missing **phase-order** check (plan/tasks/implement done while an earlier required phase is absent or pending), and decide whether the existing **implementation-evidence** check (`implement.claimed-without-evidence`) ratchets to error — without re-doing the data fixes and status derivation that already landed.

## Context — what is already true on `main` (verified 2026-11-12, read from code)

Evidence discipline: the issue was filed 2026-07-16; much of its fix direction has since shipped. The spec is deliberately scoped to the **remaining** gap.

| Issue item | State now | Evidence |
|---|---|---|
| SPEC-026/027/034/031 falsely `implementing`/`specifying` | **Data already honest.** Each reads `status: planning`, `implement: pending`. | `specs/minspec/SPEC-026…/requirements.md`, `-027`, `-031`, `-034` frontmatter |
| Root cause: `status:` minted from {phases, approval} with nothing checking code existence | **Partly closed.** `deriveStatus` returns `implementing` only when `phases.implement` is `in-progress`/`done`; otherwise `planning` (#886, DR-069, SPEC-064). | `packages/minspec/src/lib/lifecycle.ts:133-146` |
| "implementing/done must be backed by declared+existing owned code" | **Built, severity `warn`.** `implement.claimed-without-evidence` fires when `phases.implement` is `in-progress`/`done` and a declared `implements:` path is missing on disk. Default `implementEvidence: 'warn'`. | `spec-validator.ts:1087-1118`; `config.ts:69,173` |
| `implements:` required for T3/T4 in the build path | **Built, ratcheted to error here** (SPEC-038). Trigger is plan `in-progress`/`done`, not clarify-done (Slice-2 finding). | `spec-validator.ts:1002-1050` |
| Literal `status:` drifting from derived | **Built, warning.** | `spec-validator.ts:1318-1345` |
| SPEC-015 phase anomaly (plan/tasks `done`, no `clarify` entry, `implement: in-progress`) | **Still present.** No rule compares phases to each other. | `specs/minspec/SPEC-015-status-lanes/requirements.md` frontmatter; grep of `spec-validator.ts` finds no phase-order rule |

Two genuine gaps remain:

1. **No phase-order check (validator-asymmetry class, #137).** `phases:` entries are each validated alone; nothing asserts that a later phase is not ahead of an earlier one. SPEC-015 sits at plan `done` / tasks `done` / implement `in-progress` with `clarify` absent.
2. **The evidence check is advisory, and blind to `implements: none`.** At `warn` a false claim still merges; and a spec with `implements: none` and `implement: in-progress` has no path to check, so it can claim implementation with no evidence at all (SPEC-015 is exactly this shape, though its code does exist as modifications to shared files).

## Functional Requirements

- **FR-1 — Phase-order rule.** A new validator rule `phase.order` fires on a primary requirements spec when any phase in `plan`, `tasks`, `implement` is `in-progress` or `done` while a **required** earlier phase (per the tier's `phaseMappings.requiredPhases`, in `PHASES` order) is `pending` or **absent**. `skipped` counts as satisfied. The message names the offending later phase and the earlier phase it outruns.
- **FR-2 — Absent vs pending are both missing.** A phase key that is missing from `phases:` is treated as `pending` for FR-1 (SPEC-015's `clarify` is absent, not `pending`).
- **FR-3 — Optional phases are exempt.** Phases listed in `optionalPhases` for the spec's tier are not "required earlier phases". (Interaction with T3's Clarify — see Decision D-1.)
- **FR-4 — Shared helper, no duplicate predicate.** The ordering predicate lives in one pure module (`phase-order.ts`, no `vscode`/network imports) consumed by the validator, so the corpus validator and any lifecycle writer cannot disagree about what "ahead of" means.
- **FR-5 — Severity ratchet for FR-1.** `phase.order` ships as `warning` and is flipped to `error` by a single config key once the corpus is clean, mirroring SPEC-038 FR-7 (warn → fix data → error). The flip is recorded when SPEC-015 and any other offender are repaired; never a flag day.
- **FR-6 — Repair the known offender.** SPEC-015's frontmatter is corrected to the true phase history per Decision D-1 (this is spec data, edited under the normal approval flow; it must not silently re-approve — hash/approval impact is checked at implementation).
- **FR-7 — Evidence check handles the `none` escape.** For a spec with `implements: none` whose `phases.implement` is `in-progress`/`done`, the evidence rule (or a sibling) requires a non-empty `implements_reason:` AND an `affects:` list whose paths exist on disk, else it emits `implement.claimed-without-evidence` (Decision D-2 for whether this is in scope). This closes the "claim implementation with nothing checkable" hole without penalising genuinely code-less specs, which stay at `implement: pending`/`skipped`.
- **FR-8 — Evidence severity ratchet.** Decision D-3 determines whether `implementEvidence` flips from `warn` to `error` in this repo's `.minspec/config.json` as part of this work. The default for adopters stays `warn` (invariant 3: nothing ships behaviour change to a repo that did not opt in).
- **FR-9 — No silent gate.** A failure to read the config key, or an unparseable `phases:` block, makes the rule fail visibly (a violation), never skip silently (constitution invariant 2).

## Acceptance Criteria

- **AC-1** — A T3 spec with `plan: done`, `tasks: done`, `implement: in-progress` and no `clarify` key produces `phase.order` naming `clarify` (given Decision D-1 = Clarify required for T3).
- **AC-2** — The same spec with `clarify: done` (or `skipped`) produces no `phase.order`.
- **AC-3** — A spec with all phases `pending` or only `specify: done` produces nothing.
- **AC-4** — A T2 spec (Clarify optional) with `plan: done` and no `clarify` produces nothing (FR-3).
- **AC-5** — Symmetry (#137): tests assert both directions — a later phase ahead of an earlier one fails; a monotone spec passes — and run against the real `PHASES` order, not a copy.
- **AC-6** — Severity: with the config key unset the finding is `warning`; with it set to `error` it is `error`.
- **AC-7** — After repair, `npm run validate` reports zero `phase.order` findings across `specs/`.
- **AC-8** — (If D-2 in scope) a spec with `implements: none`, `implement: in-progress` and no existing `affects:` path produces `implement.claimed-without-evidence`; with an existing `affects:` path it passes.
- **AC-9** — Regression for the originating class: a fixture spec declaring `implements:` of non-existent files with `implement: in-progress` is flagged (already covered by the #1751 tests; this spec must not weaken them).

## Out of Scope

- Re-deriving or rewriting statuses of SPEC-026/027/031/034 — already honest (`planning`).
- Changing `deriveStatus` or the `planning` lifecycle status (SPEC-064/DR-069).
- Adding code to implement SPEC-026/027/031/034 themselves; they stay unbuilt until separately prioritised.
- Drift detection of declared paths after refactors (#643).
- Any change to the spec-gate (`spec-gate.py`); `getSpecStatus` stays a freeze-gate twin (DR-069 §3).

## Invariants

- **INV-1 (constitution #1 — offline).** Pure frontmatter + filesystem existence; no network.
- **INV-2 (constitution #2 — no silent gate).** FR-9; the new rule is not best-effort and has an independent witness (the validator test plus the corpus `npm run validate` run).
- **INV-3 (constitution #3 — blast radius).** Severity defaults to `warn` for adopters; the error flip is this repo's own config only.
- **INV-4 (symmetry — #137).** Missing-direction and present-but-wrong are both tested.
- **INV-5 (Tier-0 purity).** No `vscode`/network imports in the new module.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Many existing specs skipped Clarify legitimately; a naive rule floods the corpus. | Measure first (a count of `phase.order` hits at implementation), ship as warning, repair, then flip (FR-5). |
| R2 | Treating `clarify` as required for T3 contradicts `phaseMappings` where it is optional. | Decision D-1. |
| R3 | Editing SPEC-015 voids its approval hash if frontmatter is hashed beyond `status`/`phases`. | `canonical.ts` strips `status` and `phases`; verify before editing (computed, not assumed). |

## Decisions needed (Clarify)

- **D-1 — What is SPEC-015's true clarify state, and is Clarify required for T3?** SDD says Clarify is required for T3–T4, but `phaseMappings` lists it as *optional* for T3 in config.
  - **(rec) A: honour the config.** `phase.order` treats only `requiredPhases` as mandatory; for SPEC-015 record `clarify: skipped` (it was a small, fully-decided rename). Cost: T3 specs can still skip Clarify silently, so the check only catches contradictory states, not the SDD "Clarify required" rule.
  - B: require Clarify for T3/T4 in the rule regardless of config. Cost: contradicts the config the project already ships and floods the corpus (R1); needs a config/SDD reconciliation first.
  - C: mark SPEC-015 `clarify: done` retroactively. Cost: a false history claim — the very class this issue is about.
- **D-2 — Is the `implements: none` evidence hole (FR-7) in this spec or a follow-up?** (rec) In: it is the same root cause and a few lines. Cost: widens blast radius to specs currently using `none` with `implement: in-progress` (needs a measured count first); if large, split out.
- **D-3 — Flip `implementEvidence` to `error` in this repo now?** (rec) Yes, but only after current hits are repaired — `npm run validate` on 2026-11-12 still shows one (SPEC-095: `packages/minspec/tests/text-io-inventory.test.ts` missing while `implement: in-progress`), so the flip is gated on fixing that first, matching how SPEC-038 ratcheted. Cost: any in-flight spec PR that claims `implement: in-progress` before its files land turns red; the author must stage the claim after the code.
