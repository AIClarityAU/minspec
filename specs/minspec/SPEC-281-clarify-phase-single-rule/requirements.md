---
id: SPEC-281
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - prose that states a gate must agree with what the gate does
aspects: [docs, sdd-phases, no-silent-gate, offline]
depends_on: []
relates_to: [SPEC-001, "#2709", "#3059", "#1480"]
implements: none
implements_reason: >-
  Specify phase only. Files owned are decided at Plan, after Decision D1 (which rule is the
  single rule) is answered; D1 changes which of five places is the odd one out.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-281: One stated rule for when the Clarify phase is required

> **This is a SPECIFICATION ONLY.** Written for issue #2709. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Ask "must a T3 spec go through Clarify?" and the repository answers yes in some places and
no in others. A reader cannot tell whether skipping Clarify is a breach, and nothing checks
that Clarify ran, so the prose is the only statement of the rule and it contradicts itself.

## What the repository says today (re-read 2026-10-28, `origin/main` 804a899d)

The issue named three places; reading them found five, in three camps. The line numbers in
the issue (`CLAUDE.md:271`, `CLAUDE.md:27`) have drifted; current ones are given.

| # | Place | T2 | T3 | T4 |
|---|---|---|---|---|
| 1 | `specs/minspec/requirements.md:74` (FR-2 table, the owning spec) | optional | **required** | required + stakeholder review |
| 2 | `CLAUDE.md:223` "Per SDD FR-2: Clarify phase required for T3-T4" | n/a | **required** | required |
| 3 | `CLAUDE.md:36-37` tier table | no clarify listed | **no clarify listed** (specify, plan, tasks, implement) | "all phases" |
| 4 | `packages/minspec/src/lib/slash-commands.ts:144` ("Required for T4, optional for T2/T3, skipped for T1") | optional | **optional** | required |
| 5 | `packages/minspec/src/lib/config.ts:158-160` (`requiredPhases`/`optionalPhases`, the only executable form) | optional | **optional** | required |

`packages/minspec/src/commands/example.ts:144` repeats row 4's wording to adopters in the
generated example spec.

So: the owning spec and `CLAUDE.md:223` say T3 requires Clarify. The shipped command, the
example spec, the config defaults and the `CLAUDE.md` tier table all say it does not. The
disagreement is at **T3** only; T1, T2 and T4 agree everywhere. FR-2 also adds "stakeholder
review" at T4, which no other place mentions.

What does enforce something today (cited, not inferred):
- `scripts/lib/clarify-open.ts` refuses delegated approval of a spec whose
  "Decisions needed (Clarify)" section still has an open item (#3059). It fires on any spec
  that *has* such a section, whatever its tier. It does not check that a T3/T4 spec *has*
  one, or that `phases.clarify` is not `pending`.
- `spec-validator.ts` (`validateOwnership`) keys off `plan` phase state, not clarify.

Nothing asserts the per-tier rule itself.

## Requirements

- **FR-1 — One owning statement.** The rule "which tiers require, allow, or skip Clarify"
  is stated once, in `specs/minspec/requirements.md` FR-2, as the owner. The FR-2 table row
  and one short sentence are the authoritative text.
- **FR-2 — Other places point or are generated.** Rows 2 and 3 (`CLAUDE.md`) and the
  example spec text (`example.ts:144`) either link to FR-2 or are derived from the same
  source as the executable rule. No place restates a tier-to-Clarify mapping in its own words.
- **FR-3 — Executable form agrees.** `config.ts` defaults and the slash-command body
  (`slash-commands.ts:144`) express exactly the FR-2 rule. Which side moves depends on D1.
- **FR-4 — Drift is caught by a check, not by memory.** A check fails when the tier-to-Clarify
  mapping in `config.ts`, the slash command, and the example text disagree. It fails visibly
  (constitution invariant 2); an unreadable source is a failure, not a pass.
- **FR-5 — Enforcement, if D2 says so.** A T3/T4 spec whose rule is "required" cannot be
  approved while its clarification is unresolved. "Unresolved" reuses the existing
  `clarify-open.ts` predicate rather than a second one, so two witnesses cannot drift.
- **FR-6 — Offline.** No network call in any check or generator (invariant 1).
- **FR-7 — Adopter blast radius.** Anything shipped into an adopter repo (the slash command,
  example spec, config defaults) changes only on a MinSpec upgrade, only inside repos with
  `.minspec/` (invariant 3). An adopter's existing `config.json` overrides are not rewritten.

## Acceptance Criteria

- [ ] **One answer** — grepping the repo for a tier-to-Clarify statement finds FR-2 plus only
  links or generated text; no place gives a different answer for any tier. (FR-1, FR-2)
- [ ] **Code and prose agree** — `config.ts` defaults, the slash command and FR-2 give the
  same required/optional/skip result for each of T1-T4. (FR-3)
- [ ] **Drift fails visibly** — changing the T3 setting in one place only makes the check
  fail with a message naming both places. (FR-4)
- [ ] **No silent pass** — a source the check cannot read fails it rather than skipping.
  (FR-4)
- [ ] **Gate parity (if D2 = enforce)** — a T3 spec with open Clarify decisions is refused
  approval by the same predicate delegated approval uses. (FR-5)
- [ ] **Adopters untouched** — no rewrite of an adopter's `config.json`. (FR-7)

## Invariants this change must not break

- Core functionality works offline (constitution invariant 1).
- No silent gate: the new check fails closed and visibly (invariant 2).
- Blast radius is the opted-in project (invariant 3).
- The tier stays an upward-only floor: a user may always raise ceremony. Making Clarify
  required at a tier must not lower any other tier's ceremony.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

**D1. Which rule is the single rule for T3?**
- **(rec) A — T3 Clarify is optional, T4 required.** Matches the three executable/shipped
  surfaces (config, slash command, example spec) and the `CLAUDE.md` tier table. Only FR-2
  and `CLAUDE.md:223` change, both prose. *Cost:* T3 specs can skip Clarify, so a T3 spec
  with an ambiguity reaches approval unless the author flags it; this softens what FR-2
  and the dispatch note promised.
- **B — T3 Clarify is required.** Matches the owning spec and `CLAUDE.md:223`. *Cost:* the
  config default, slash command, example spec and tier table all change, and every in-flight
  T3 spec without a Clarify section is suddenly non-conforming; it also adds ceremony
  against core tenet 2 (minimise tokens) unless D2 keeps the check cheap.
- **C — Required only when the spec has open questions** (Clarify becomes a consequence of
  content, not of tier). *Cost:* changes the tier model that FR-1/FR-2 are built on
  (DR-024 defers that); larger than this issue and likely a separate T4 decision.

**Recorded selection: Option A,** T3 Clarify is optional, T4 required. An agent session copied this document's (rec) option; no human chose this item.

**D2. Should a check assert the rule, and how far?**
- **(rec) A — Drift check only (FR-4), no new approval gate.** Cheap, deterministic, closes
  the "three answers" defect. *Cost:* still nothing proves Clarify ran on a required tier.
- **B — Drift check plus approval gate (FR-4 and FR-5).** Closes the enforcement gap using
  the existing `clarify-open.ts` predicate. *Cost:* if D1 = B, every T3 spec now needs a
  Clarify section to be approved, which adds a human read per spec (tenet 1) and could block
  legitimate T3 specs that have nothing to clarify unless an explicit "no open questions"
  form is allowed.

**Recorded selection: Option A,** a drift check only (FR-4), no new approval gate. An agent session copied this document's (rec) option; no human chose this item.

**D3. Is "stakeholder review" at T4 (FR-2 table) part of the rule?**
- **(rec) A — Drop the phrase from FR-2.** MinSpec is solo-first (DR-075/DR-076) and nothing
  implements or checks it. *Cost:* loses a team-mode hook; restore it when the parked
  `mode: team` profile lands.
- **B — Keep it as team-mode-only text, labelled so.** *Cost:* another sentence that nothing
  checks, the same kind of unverified prose this spec is removing.

**Recorded selection: Option A,** drop the "stakeholder review" phrase from FR-2. An agent session copied this document's (rec) option; no human chose this item.

## Out of scope

Changing the tier taxonomy (DR-024, #91); other phases' per-tier rules (they agree today);
building anything before approval.

## Follow-ups (tracked)

None beyond this spec.
