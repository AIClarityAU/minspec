---
id: SPEC-087
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a "specify missing" warning on a written spec, and a phase marked done with nothing behind it, are the same lie told in opposite directions
aspects: [validation, governance, lifecycle, tier-0]
depends_on: [DR-012, DR-069]  # DR-012 owns the completeness floor this spec repairs; DR-069 fixes WHEN approval happens, which decides what approval can demand
relates_to: [DR-034, DR-076, DR-003, SPEC-013, SPEC-015, SPEC-022, SPEC-051, SPEC-061, SPEC-064, "#109", "#93", "#111", "#1317", "#1603"]
# Ownership declared now, in Specify, following SPEC-079's precedent — only the two files
# that are new under EVERY answer in "Decisions needed" are claimed. Everything else is an
# existing module modified in place and owned by other specs, so it is `affects:`.
implements:
  - packages/minspec/src/lib/phase-evidence.ts
  - packages/minspec/tests/phase-evidence.test.ts
affects:
  - packages/minspec/src/lib/spec-validator.ts
  - packages/minspec/src/commands/approve.ts
  - packages/minspec/src/commands/validate.ts
  - scripts/validate-frontmatter.ts
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-087: A phase the lifecycle calls done must have something written behind it

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#109](https://github.com/AIClarityAU/minspec/issues/109)** — "phase-completeness
detection is heading-name-brittle", parked from the SPEC-015 (status lanes) session and
listed in that spec's own follow-ups
([SPEC-015 `requirements.md:310-312`](../SPEC-015-status-lanes/requirements.md)).

## One-Sentence Scope

Replace the validator's literal-heading phase check with one deterministic **phase-evidence
detector** that recognises written phase content wherever this repo and its adopters
really put it, and make a required phase that the lifecycle map claims complete — but
that has nothing written behind it — an **error at every tier**, evaluated at the moment
the claim is made rather than all at once at approval.

## Context

### What the issue reports, and what is true at `HEAD` `f4e6cbcf`

The issue was filed when approving SPEC-015 printed *Required "specify" section is missing
or empty* over a spec with full requirements. Two things have changed since, and one has
not. Every claim below was measured on this checkout; the probe ran the real
`parseSpec` + `validateSpec` against real and synthetic specs.

**Still true — the detector only knows five words.** A heading becomes phase content only
when its lowercased text is exactly a phase name
([`spec.ts:273-274`](../../../packages/minspec/src/lib/spec.ts#L273)), and rule 1 of the
validator reads nothing else
([`spec-validator.ts:1004-1018`](../../../packages/minspec/src/lib/spec-validator.ts#L1004)).
Measured misses: `## Context` + `## Requirements` (house style), `## Plan: approach`
(suffix), `## Plan ` with a trailing space, and `### Specify` (level). Across the corpus the literal headings are nearly
unused — 11 occurrences in 117 spec files, 9 of them `## Clarify`.

**Changed — the false warning now reaches only three files, because the check stopped
running for the other 114.** Split-layout files (any file with a `type:`) skip rule 1
entirely ([`spec-validator.ts:1001-1004`](../../../packages/minspec/src/lib/spec-validator.ts#L1001),
the #93 split-layout fix). 114 of 117 spec files carry `type:`. The three that do not
still reproduce the issue exactly:

| File | Tier | Rule 1 verdict today | Reality |
|---|---|---|---|
| `SPEC-039-push-docs-lane-command/requirements.md` | T2 | `section.specify.empty` + `section.plan.empty` (warnings) | has `## Context`, `## Functional Requirements`, `## Invariants`, `## Delivery` |
| `SPEC-039-push-docs-lane-command/design.md` | T2 | same two warnings | a design file |
| `SPEC-050-silent-approval-pr/design.md` | T2 | same two warnings | a design file |

**Changed — and worse: for the 114 typed files nothing checks content at all.** The skip
replaced a false alarm with no alarm. Measured on a synthetic `type: requirements` file
whose body is a title and nothing else:

| Tier | `complete` | Violations |
|---|---|---|
| T1 (one-sentence spec) | `true` | none |
| T2 (spec + plan) | `true` | none |
| T3 (full spec cycle) | `false` | `acceptance.missing` only |
| T4 (complete ceremony) | `false` | `acceptance.missing` only |

So an empty T1 or T2 requirements file is approvable today with no warning of any kind.
That is the issue's "gate too lax" problem in its current, stronger form.

### Two defects the issue does not name

**The literal check is trivially satisfied.** A single-file spec with `## Specify`,
`## Plan`, `## Tasks`, `## Implement`, `## Clarify` each containing the one word `TBD`
validates `complete: true` with zero violations at T3 and T4. Presence of a heading is
not evidence that a phase was written.

**The literal check demands phases that cannot exist yet.** Rule 1 iterates every
`requiredPhases` entry for the tier
([`config.ts:111-114`](../../../packages/minspec/src/lib/config.ts#L111)), so an untyped
house-style T3 spec is refused approval for `section.tasks.empty` and
`section.implement.empty` — it must contain a non-empty `## Implement` section before a
human may approve it *for* implementation. Approval happens at the end of the
specify/clarify band and is what *opens* the build band
([`phasesForApproval`, `lifecycle.ts:199-210`](../../../packages/minspec/src/lib/lifecycle.ts#L199)),
so this demand is unsatisfiable in the order the lifecycle prescribes.

### The directory-level backstop is a warning nobody is shown

The #111 (split-layout coverage) fix added `validateSplitLayoutCoverage`, which notices a
split spec directory with no `design.md` / `tasks.md`. It is warning-only by design, and
it has exactly one caller: the CI script
([`validate-frontmatter.ts:255`](../../../scripts/validate-frontmatter.ts#L255)). Neither
the Approve command nor the Validate command calls it (the only `validateSpec` callers are
[`approve.ts:244`](../../../packages/minspec/src/commands/approve.ts#L244) and
[`validate.ts:57`](../../../packages/minspec/src/commands/validate.ts#L57)), although its
own docstring names "the validate command" as a caller
([`spec-validator.ts:1145-1146`](../../../packages/minspec/src/lib/spec-validator.ts#L1145)).
In CI it produces 95 of the 176 non-fatal warnings `npm run validate` prints today (43
"missing its design.md", 52 "missing its tasks.md"). Almost all of them describe specs
that have simply not reached that phase yet — true, harmless, and loud enough to bury the
few that matter.

### Why the issue's proposed policy cannot be adopted as written

The issue asks that *any* missing required phase block approval at every tier, on the
premise that "approval = ready-to-implement". That premise was true when the issue was
filed and is no longer. DR-069 (the `planning` lifecycle status) made approval the gate
*out of* Specify/Clarify and *into* Plan: an approved spec whose implement phase has not
started derives `planning`
([`deriveStatus`, `lifecycle.ts:133-146`](../../../packages/minspec/src/lib/lifecycle.ts#L133)).
The corpus reflects it: 23 spec directories hold only `requirements.md` and carry
`status: planning` — approved, with no plan written, by design. A rule requiring the plan
at approval would have refused every one of them, and would oblige the author to write a
design before the human has read the requirements it is a design *for*.

The user's question — "why would I approve an incomplete spec?" — still deserves a real
answer. It is: you should never be able to approve one whose **specification** is
unwritten, and nothing should be able to claim a **plan** or **task breakdown** is done
when it is not. Those are two gates at two moments, not one gate at approval.

### The seam that already exists

Approval already re-validates the spec in the state approval would *create*, and refuses
on any error that state introduces
([`violationsIntroducedByApproval`, `spec-validator.ts:868-897`](../../../packages/minspec/src/lib/spec-validator.ts#L868),
called at [`approve.ts:274`](../../../packages/minspec/src/commands/approve.ts#L274) and,
for every non-UI caller, at the library boundary through
[`ownership-advance-guard.ts:58-97`](../../../packages/minspec/src/lib/ownership-advance-guard.ts#L58)).
That guard throws on *any* newly-introduced error, not only ownership ones. A rule gated on
the phase map therefore reaches every approval path with no new wiring: approval marks
`specify` and `clarify` done, the rule asks for their evidence, and an unwritten
specification is refused before anything is written to disk.

## Functional Requirements

### The detector

- **FR-1 — One detector, one verdict per phase.** A single pure function is the only place
  phase content is recognised. It returns, for each of `specify`, `clarify`, `plan`,
  `tasks`, one of: `evidenced`, `absent`, `unattributable`, or `not-evaluated`. The
  validator, the Approve command, the Validate command and the CI script all consume this
  one function; none may re-derive the answer (see [Contract](#contract)).

- **FR-2 — Evidence by file type first.** A file whose `type:` is `requirements`,
  `design`, or `tasks` is evidence for `specify`, `plan`, or `tasks` respectively when its
  body is substantive (FR-5). The file *is* its phase — the model the #93 fix already
  adopted — so no particular heading is required inside it.

- **FR-3 — Evidence by heading alias second.** In any file, typed or not, a level-2
  heading whose normalised text (FR-4) appears in the alias table is evidence for that
  phase when its section body is substantive. This is what lets a T2 spec carry its plan
  as `## Approach` inside `requirements.md`, and what makes untyped files work at all. The
  table is data in one place; its initial rows are the headings measured in this corpus
  plus the two families the issue names:

  | Phase | Recognised headings (normalised) |
  |---|---|
  | `specify` | specify · context · problem · requirements · functional requirements · scope · one-sentence scope · summary |
  | `clarify` | clarify · decisions needed · resolved decisions · decisions · open questions |
  | `plan` | plan · approach · design · architecture |
  | `tasks` | tasks · task breakdown |

  In an **untyped** file, substantive text before the first level-2 heading also counts as
  `specify` evidence — a T1 spec is by definition one sentence and may have no headings.

- **FR-4 — Heading normalisation.** Before lookup a heading is trimmed, lower-cased, has
  internal whitespace collapsed, and loses any trailing parenthetical and anything from the
  first `:` or spaced dash onward. `## Plan ` (trailing space), `## SPECIFY`,
  `## Plan: approach`, `## Decisions needed (Clarify)` and
  `## Resolved Decisions (Clarify)` all resolve; an unrelated heading that merely contains
  a phase word (`## Planned follow-ups`) does not, because matching is whole-heading after
  normalisation, never substring.

- **FR-5 — "Substantive" is defined, small, and shared.** A body is substantive when at
  least one line survives after removing blank lines, heading lines of any level, HTML
  comments, and placeholder lines. Placeholder lines are (a) every placeholder MinSpec's
  own scaffolds emit — read from the scaffold source rather than retyped, e.g. the
  `- [ ] _Add the first task._` line `buildTasksMdContent` writes
  ([`scaffold.ts:149-152`](../../../packages/minspec/src/lib/scaffold.ts#L149)) — and (b) a
  line that is only `TBD`, `TODO`, or an ellipsis, ignoring list markers, emphasis and
  case. The word `None` is **not** a placeholder: it is a valid, explicit answer (the
  DR-023 follow-ups convention). The detector judges whether something was written, never
  whether it is good.

- **FR-6 — `unattributable` is an honest third answer.** When no file in the set is typed
  and no heading anywhere in it is in the alias table, yet substantive content exists under
  headings MinSpec does not recognise, each phase without evidence is `unattributable`,
  not `absent`. MinSpec cannot tell which phase that prose belongs to and must say so
  instead of asserting it is missing. As soon as the document uses any recognised heading
  or any `type:`, it is speaking MinSpec's vocabulary and an unevidenced phase is `absent`.

- **FR-7 — `not-evaluated` when the caller cannot see the siblings.** `plan` and `tasks`
  may live in sibling files. A caller that supplies only one file gets `not-evaluated` for
  any phase that file does not itself evidence, except `specify` and `clarify`, which are
  always decidable from the primary file alone (clarify lives inside the requirements
  artifact — [`spec-validator.ts:1116-1119`](../../../packages/minspec/src/lib/spec-validator.ts#L1116)).
  A caller that supplies the sibling set — even an empty one — gets a definite answer for
  every phase. `not-evaluated` never produces a violation and is never rendered as a pass.

### The rule

- **FR-8 — Evidence must back the phase map.** A phase is **claimed** when its
  `phases:` entry is `done`, or when any later phase is `in-progress` or `done`. For each
  phase the tier requires
  ([`config.ts:111-114`](../../../packages/minspec/src/lib/config.ts#L111)) that is claimed
  and not `skipped`:
  - `absent` → **error**, at every tier, rule id `phase-evidence.<phase>.absent`;
  - `unattributable` → **warning**, at every tier, rule id
    `phase-evidence.<phase>.unattributable`, with a message that states what is true
    ("has content MinSpec cannot attribute to a phase") and never the words "missing or
    empty";
  - `evidenced` / `not-evaluated` → nothing.

  A phase that is not yet claimed produces nothing, at any tier: an unwritten plan on a
  spec still being specified is work in progress, not a defect. `implement` is not an
  evidence-checked phase — its witness is code, not prose, and belongs to the
  implement-hole tally in
  [`artifact-graph.ts`](../../../packages/minspec/src/lib/artifact-graph.ts) and to the
  in-flight phase-claim drift work ([#1518](https://github.com/AIClarityAU/minspec/issues/1518)).

- **FR-9 — The rule replaces rule 1; it does not sit beside it.** `section.<phase>.empty`
  and its split-layout skip are removed. The new rule runs identically for typed, untyped,
  single-file and split-layout specs — layout changes where evidence is looked for, never
  whether the check runs.

- **FR-10 — Approval refuses an unwritten specification, on every path.** Because approval
  simulates the post-approval phase map before writing (the #1317 seam), FR-8 makes
  approval refuse — at T1 through T4 alike — when `specify` is `absent`, and when
  `clarify` is `absent` at a tier that requires it (T4) and it is not `skipped`. The
  refusal names the phase, the file, and the three ways out: write the content, use a
  recognised heading or `type:`, or record a deliberate skip with a reason. No new call
  site is added to reach the library boundary; the existing guard already throws on any
  newly-introduced error.

- **FR-11 — The extension's own surfaces see the siblings.** The Approve and Validate
  commands pass the spec directory's sibling files to the detector so `plan` and `tasks`
  are definite there, exactly as they already pass sibling files for the shard-id check
  ([`approve.ts:248`](../../../packages/minspec/src/commands/approve.ts#L248),
  [`validate.ts:63`](../../../packages/minspec/src/commands/validate.ts#L63)).

- **FR-12 — The corpus is checked in CI by the same function.** `npm run validate` runs
  FR-8 over every spec directory with full sibling context, calling the same detector — not
  a second implementation (the #654 acceptance-criteria lesson recorded at
  [`validate-frontmatter.ts:600-607`](../../../scripts/validate-frontmatter.ts#L600)).
  Its severity on that surface is **DQ-3**.

- **FR-13 — One fact, one report.** Where FR-8 evaluates a phase for a directory (its
  requirements file carries a `phases:` block), the `split-coverage.<type>.missing` warning
  is not also emitted for that phase. For a directory with no `phases:` block the existing
  warning is unchanged, so no signal is lost where the new rule cannot speak. The
  inaccurate "callers" sentence in `validateSplitLayoutCoverage`'s docstring is corrected
  in the same change.

- **FR-14 — The decision record is brought back to true.** DR-012 (the approval-gate
  decision) §2 states that required-phase sections "must be non-empty" and that severity is
  "tier-scaled (error for T3/T4, warning for T2)". Once DQ-1 is resolved, a dated addendum
  to DR-012 records the replacement rule and links this spec. It is an addendum to the
  existing record, not a new number — see [Decision record](#decision-record).

## Contract

The cross-boundary shape, stated so the validator, the two commands and the CI script can
be written against it independently. Types only — placement of everything except the two
`implements:` files is a Plan-phase matter.

```ts
import type { Phase } from './config';

/** The phases whose witness is written prose. `implement` is deliberately excluded (FR-8). */
export type EvidencePhase = Exclude<Phase, 'implement'>;

export type PhaseEvidenceVerdict =
  | 'evidenced'        // substantive content attributable to this phase was found
  | 'absent'           // the set speaks MinSpec's vocabulary and has nothing for this phase
  | 'unattributable'   // content exists, but under headings MinSpec cannot map (FR-6)
  | 'not-evaluated';   // siblings were not supplied and this file cannot decide alone (FR-7)

/** One file, reduced to what the detector reads. Built from an existing ParsedSpec. */
export interface PhaseEvidenceSource {
  /** Basename, used only in messages. */
  readonly file: string;
  /** Lower-cased `type:` frontmatter; '' when absent. */
  readonly type: string;
  /** Text between the frontmatter and the first level-2 heading. */
  readonly preamble: string;
  /** Level-2 heading text to section body, in document order (ParsedSpec.sections). */
  readonly sections: ReadonlyMap<string, string>;
}

export interface PhaseEvidenceReport {
  readonly verdict: Readonly<Record<EvidencePhase, PhaseEvidenceVerdict>>;
  /** Where the evidence was found — lets a message cite file and heading. */
  readonly witness: Readonly<Partial<Record<EvidencePhase, { file: string; heading: string | null }>>>;
}

/**
 * Pure. No filesystem, no network, no clock.
 * `siblings === undefined` means "the caller could not look" (FR-7);
 * `siblings === []` means "the caller looked and there are none".
 */
export declare function detectPhaseEvidence(
  primary: PhaseEvidenceSource,
  siblings?: readonly PhaseEvidenceSource[],
): PhaseEvidenceReport;

/** True when the lifecycle map asserts `phase` is complete (FR-8). `skipped` is never claimed. */
export declare function isPhaseClaimed(
  phases: Readonly<Record<Phase, 'pending' | 'in-progress' | 'done' | 'skipped'>>,
  phase: EvidencePhase,
): boolean;
```

`ValidateSpecOptions` gains one omit-to-skip field carrying the sibling sources, following
the convention that interface already documents ("a caller without a given resolver gets no
false positive/negative from that check",
[`spec-validator.ts:696`](../../../packages/minspec/src/lib/spec-validator.ts#L696)).

## Invariants (must not break)

- **INV-1 — Offline and deterministic (constitution invariant 1).** The detector is pure:
  no network, no model call, no filesystem, no clock. The same bytes always give the same
  verdict.
- **INV-2 — No silent gate (constitution invariant 2).** `not-evaluated` is never shown as
  a pass, and on the CI surface — where full sibling context is always available — it must
  be unreachable. The library guard's existing announced fail-open on its *own*
  infrastructure error
  ([`ownership-advance-guard.ts:52-56,77-84`](../../../packages/minspec/src/lib/ownership-advance-guard.ts#L52))
  is unchanged and is not widened.
- **INV-3 — Blast radius (constitution invariant 3).** Nothing here writes to an adopter's
  files, and the rule only ever evaluates specs in a repo that carries `.minspec/`.
- **INV-4 — Never a false "missing".** `absent` is never returned for `specify` on a file
  with `type: requirements` and a substantive body, nor for any phase with a substantive
  section under an aliased heading. Over this repository's whole spec corpus the detector
  returns zero `absent` and zero `unattributable` verdicts for `specify`.
- **INV-5 — The parser is untouched.** `parseSpec` / `writeSpec` round-trip behaviour and
  the meaning of `ParsedSpec.phaseSections` do not change. The spec panel
  ([`spec-panel-html.ts`](../../../packages/minspec/src/views/spec-panel-html.ts)) and the
  single-file task tally
  ([`artifact-graph.ts:431`](../../../packages/minspec/src/lib/artifact-graph.ts#L431))
  read `phaseSections` and must behave exactly as before; the detector is a separate read
  over `sections`.
- **INV-6 — No approval is voided.** The canonical hash, the approval sidecars and every
  existing approval record are untouched. No spec approved today becomes unapproved.
- **INV-7 — One implementation.** Exactly one detector and one alias table exist. The
  validator, Approve, Validate and the CI script import them; a second copy of the heading
  table or the substantive test is a defect.
- **INV-8 — The freeze-gate twin is not touched.** `getSpecStatus` and its Python twin
  `phase_intent_status` decide the source-edit freeze range and are deliberately different
  from `deriveStatus`
  ([`lifecycle.ts:163-171`](../../../packages/minspec/src/lib/lifecycle.ts#L163)). This spec
  changes neither.
- **INV-9 — A deliberate skip is respected.** A phase recorded `skipped` is never claimed
  and never produces a violation.
- **INV-10 — The tasks.md offer still works.** The scaffold offer for a missing `tasks.md`
  (#225, [`auto-bootstrap.ts:318,624`](../../../packages/minspec/src/lib/auto-bootstrap.ts#L318))
  has its own detection and must keep firing after FR-13 quietens the duplicate warning.

## Acceptance Criteria

- [ ] **House-style specs are recognised.** An untyped spec with `## Context` and
  `## Requirements` and no literal phase heading yields `specify: evidenced` and no
  phase-evidence violation at T1, T2, T3 and T4. *(FR-3, INV-4)*
- [ ] **The three live false warnings are gone.** `SPEC-039/requirements.md`,
  `SPEC-039/design.md` and `SPEC-050/design.md` produce no `specify`-missing or
  `plan`-missing finding. *(FR-2, FR-3, FR-9)*
- [ ] **An empty specification cannot be approved at any tier.** A `type: requirements`
  file whose body is only a title is refused by the Approve command at T1, T2, T3 and T4,
  with a message naming `specify`; nothing is written to the spec or the sidecar. The same
  file passed to the library `approveSpec` throws. *(FR-8, FR-10)*
- [ ] **Placeholders are not evidence.** A section containing only `TBD`, and a `tasks.md`
  that is exactly what `buildTasksMdContent` scaffolds, are both `absent`; a section
  containing only `None` is `evidenced`. *(FR-5)*
- [ ] **Approval no longer demands the build band.** An untyped house-style T3 spec with a
  substantive specification and no plan, tasks or implement content is approvable; the
  findings `section.tasks.empty` and `section.implement.empty` no longer exist. *(FR-8,
  FR-9)*
- [ ] **A claimed plan needs a plan.** A T2 spec with `plan: done` and neither a
  substantive `design.md` nor an aliased plan heading reports
  `phase-evidence.plan.absent` as an error; the same spec with `plan: in-progress` reports
  nothing; the same spec with `plan: skipped` reports nothing. *(FR-8, INV-9)*
- [ ] **A later phase claims the earlier one.** A T3 spec with `plan: in-progress`,
  `implement: in-progress` and no plan evidence reports `phase-evidence.plan.absent`.
  *(FR-8)*
- [ ] **Foreign vocabulary is not called missing.** An untyped spec whose only headings are
  unrecognised ones with substantive bodies yields `unattributable`, a warning, and a
  message that does not contain "missing or empty"; it remains approvable. *(FR-6)*
- [ ] **Normalisation matrix.** `## Plan ` , `## SPECIFY`, `## Plan: approach`,
  `## Decisions needed (Clarify)` resolve to their phase; `## Planned follow-ups` and
  `### Specify` do not. *(FR-4)*
- [ ] **Single-file callers are not falsely blocked.** With siblings omitted, a
  `type: requirements` file with `plan: done` yields `plan: not-evaluated` and no
  violation; with an empty sibling list supplied it yields `absent`. *(FR-7, INV-2)*
- [ ] **Corpus is clean for `specify`.** Run over every spec directory in this repository,
  the detector returns no `absent` and no `unattributable` for `specify`. *(INV-4)*
- [ ] **CI uses the same function.** `scripts/validate-frontmatter.ts` imports the detector;
  a mutation that breaks the detector turns both the unit suite and the CI rule red.
  *(FR-12, INV-7)*
- [ ] **No double report.** `npm run validate` prints no `split-coverage` line for a
  directory whose requirements file carries a `phases:` block, and still prints it for one
  that does not. *(FR-13)*
- [ ] **Parser untouched.** The existing `spec.test.ts`, `spec-panel.test.ts` and
  `spec-layout.test.ts` suites pass unmodified. *(INV-5)*
- [ ] **DR-012 carries the addendum.** *(FR-14)*

## Decisions needed (Clarify)

- **DQ-1 — When may MinSpec demand a phase?** This is the methodology change the issue
  flagged as possibly needing a decision record.
  - **(A) Evidence backs the phase map — demanded when the claim is made. (rec)**
    Approval demands the specification (and Clarify at T4); a plan or task breakdown is
    demanded the moment the map says it is done or a later phase has started. Fits the
    lifecycle DR-069 already decided and the 23 approved-without-a-plan directories in the
    corpus. *Cost:* a spec can still be approved with no plan — by design — and the plan
    check is only as good as the phase map: a spec that never advances its map, or one of
    the 24 requirements files with no `phases:` block at all, is not caught by it. That
    gap is real and is listed under Out of Scope with its tracking.
  - **(B) Everything required, at approval — the issue as written.** *Cost:* contradicts
    DR-069 and `phasesForApproval`, would have refused 23 existing approvals, forces a
    design to be written before the requirements it serves have been read, and needs a new
    decision record superseding part of DR-069.
  - **(C) Fix detection only; leave severity tier-scaled.** *Cost:* an empty T1 or T2
    specification stays approvable, which is the half of the issue the user actually asked
    about.

- **DQ-2 — What happens to a spec written entirely in headings MinSpec does not know?**
  - **(A) Report `unattributable` as a warning (FR-6 as written). (rec)** *Cost:* a
    single-file spec in a wholly foreign vocabulary can never be hard-blocked by this rule,
    so for those specs the gate stays advisory.
  - **(B) Add a `phaseHeadingAliases` map to `.minspec/config.json`** so an adopter teaches
    MinSpec their headings and gets the full gate. *Cost:* a new public configuration
    surface to support indefinitely, and one more thing the adopter-shipped Python validator
    would have to mirror.
  - **(C) Treat unrecognised as `absent`.** *Cost:* this is the issue's original defect
    promoted from a wrong warning to a wrong refusal, in repos whose headings we have never
    seen.

- **DQ-3 — How hard does the corpus rule bite in CI (FR-12)?** An approximation by file
  existence finds two specs whose map already claims a phase with no sibling file for it:
  SPEC-015 (status lanes — `tasks: done`, no `tasks.md`) and SPEC-025 (constitution
  proposer — `plan: done` and `tasks: done`, neither file). The real detector may clear
  either through an aliased heading; the implementer measures before choosing.
  - **(A) Fatal in this repository's `npm run validate`, after those specs are reconciled
    in the same change. (rec)** *Cost:* reconciling means correcting two specs' phase maps
    or adding their missing files, and adopters do not get the corpus rule at all — the
    validator MinSpec ships to them is a separate Python twin
    ([`template-registry.ts:1665-1695`](../../../packages/minspec/src/lib/template-registry.ts#L1665))
    that this option does not touch, so adopters are gated at approval inside the extension
    only.
  - **(B) Warning in CI.** *Cost:* it joins 176 existing non-fatal warnings, which this
    repo has already recorded as the place findings go to be ignored
    ([`validate-frontmatter.ts:286-289`](../../../scripts/validate-frontmatter.ts#L286)).
  - **(C) Fatal here and ported to the shipped Python validator.** *Cost:* a line-for-line
    twin plus a parity test, and a new fatal rule arriving in every adopter's CI on their
    next harness refresh, able to redden a main branch over drift that predates it.

## Decision record

No new decision record is minted by this dispatch, deliberately.

- **Dedup check.** `docs/decisions/INDEX.md` was searched for "approval gate", "phase
  complet", "heading alias" and "Required … section". The in-force record for this
  decision is DR-012 (the approval-gate decision — content-hash approval, tier-aware
  completeness); DR-069 (the `planning` status) and DR-034 (derived status) constrain it.
  No record covers heading recognition.
- **Reversibility.** The rule is a detector plus a severity mapping; it migrates no data
  and touches no approval record (INV-6). Reverting is a code revert, well under a day, so
  the irreversibility filter does not require a record.
- **What is required instead.** The change makes DR-012 §2's wording untrue, so FR-14
  requires a dated addendum to DR-012 once DQ-1 is answered. Writing it now would record a
  decision the human has not yet made. If DQ-1 resolves to option (B), that *is* a
  supersession of part of DR-069 and a new record becomes mandatory before Plan completes;
  its number must come from the collision gate, not from the files on disk.

## Out of Scope

- **Specs with no `phases:` block.** 24 of 70 requirements files carry none; the parser
  defaults every phase to `pending`, so FR-8 has no claim to check. Approval still works
  for them (the simulation supplies the map). The missing-block gap itself belongs to
  SPEC-061 (the phaseless approval writer) and is named in
  [`spec-gate.py:59`](../../../scripts/hooks/spec-gate.py#L59).
- **Evidence for `implement`.** Code, not prose — see FR-8.
- **Unresolved clarify questions.** FR-8 checks that Clarify was written, not that every
  question was answered; open-question surfacing is the next-task resolver's job.
- **Making the Validate command preview what Approve would refuse.** Validate reports the
  state the spec is in; Approve also checks the state it is entering. Closing that
  difference for the signpost is in-flight work,
  [#1603](https://github.com/AIClarityAU/minspec/issues/1603).
- **Level-3 headings and fenced code.** Sections split on level-2 headings only, and the
  parser's splitter does not skip fenced code blocks, so a heading-shaped line quoted
  inside a fence is read as a heading. Both are inherited from `parseSpec` and left alone
  under INV-5. The fence case is a possible false `evidenced`; **unfiled** — the dispatch
  that wrote this spec may not open issues.
- **The three untyped files' missing `type:`.** FR-3 makes them validate correctly as they
  are. Whether a `design.md` with no `type: design` should itself be flagged is a separate
  closed-set question for the #137 frontmatter gate; **unfiled**, same reason.
- **A configurable alias map**, unless DQ-2 resolves to (B).
- **The adopter-shipped Python validator**, unless DQ-3 resolves to (C).
- **Judging quality.** Whether a written section is any good remains the human's read
  (DR-076, the solo-mode ceremony decision, keeps exactly that read).

## Alternatives considered and rejected

- **Treat frontmatter `phases.<p>: done` as the evidence** (one of the issue's two
  suggestions). Rejected: the phase map is the *claim* being checked. Using it as its own
  witness is the plausible-inference-is-not-observation failure the evidence discipline
  names, and it would make the gate pass for exactly the specs it exists to catch.
- **Teach `parseSpec` the aliases so `phaseSections` fills in.** Rejected: `phaseSections`
  is also the spec panel's write-back model and the single-file task tally's input. Aliasing
  there changes what the panel rewrites and what counts as a task section — a far wider
  blast radius than a validator rule needs (INV-5).
- **Keep literal headings and migrate the corpus to them.** Rejected: 117 files, most of
  them approved, would need body edits that void their approvals, to make documents conform
  to a detector rather than the reverse; and adopters' specs would still not conform.
- **Fuzzy or model-assisted classification of headings.** Rejected: not deterministic and
  not offline (INV-1).
- **Keep `section.<phase>.empty` and only widen the split-layout skip.** Rejected: it
  leaves the empty-typed-file hole (the T1/T2 table above) and the one-word-`TBD` pass.
- **Recognise level-3 headings.** Rejected for now: level-3 content already counts toward
  its parent section's body, and matching it independently would need a second splitter.

## Risks

| Risk | Likelihood · Impact | Mitigation |
|---|---|---|
| The alias table is too generous — `## Summary` or `## Scope` alone satisfies `specify` on a spec with no requirements | Med · Low | The detector answers "was something written", not "is it complete" (FR-5); T3/T4 still need acceptance criteria through the existing, separate rule; the human read remains the quality gate. |
| The alias table is too narrow for an adopter's vocabulary | Med · Med | FR-6 degrades to a truthful warning instead of a refusal; `type:` on the file is always available as an explicit escape; DQ-2 (B) is the upgrade path. |
| A new error blocks an approval that worked yesterday | Low · High | INV-4's corpus test; INV-6; the refusal names three ways out (FR-10); measured today, all 70 existing spec directories' requirements files carry at least one of Context / Requirements / Functional Requirements / Problem, and 69 of them are typed. |
| `skipped` becomes the cheap way round the gate | Low · Med | A skip requires a non-empty reason through the lifecycle API ([`lifecycle.ts:290-299`](../../../packages/minspec/src/lib/lifecycle.ts#L290)) and is visible in frontmatter. A hand-edited `skipped` is not prevented here — the phase map is outside the canonical hash — and that is stated, not solved. |
| Quietening `split-coverage` (FR-13) hides a real gap | Low · Med | It is suppressed only where FR-8 speaks for the same phase with a stronger verdict; directories without a `phases:` block keep the warning (INV-10 keeps the scaffold offer). |
| Callers forget to pass siblings and the plan check silently never runs | Med · Med | INV-2: the CI surface must be unable to produce `not-evaluated`, pinned by a test; FR-11 names both extension callers. |
| Two specs edit `spec-validator.ts` rule ordering at once | Med · Low | The detector lives in its own module; the validator change is the removal of one block and the addition of one call. In-flight neighbours: #1603 (approval legality in the signpost) and #1518 (phase-claim drift). |

## Suggested delivery order

Named, not numbered, and each independently shippable:

1. **The detector slice** — the pure module, the alias table, the substantive test, and
   the full unit matrix including the corpus check (FR-1 to FR-7; INV-1, INV-4, INV-7).
   Changes no behaviour.
2. **The rule-swap slice** — rule 1 replaced by FR-8 inside `validateSpec`, sibling
   context passed by Approve and Validate (FR-8 to FR-11, FR-13). This is where approval
   behaviour changes.
3. **The corpus-gate slice** — the CI rule at the severity DQ-3 chooses, the two measured
   specs reconciled, and the DR-012 addendum (FR-12, FR-14).

## Traceability

- **Issue:** [#109](https://github.com/AIClarityAU/minspec/issues/109) — phase-completeness
  detection is heading-name-brittle.
- **Where it was parked from:** [SPEC-015](../SPEC-015-status-lanes/requirements.md)
  (status lanes), `requirements.md:300-312`.
- **The gate being repaired:** [DR-012](../../../docs/decisions/DR-012.md) (approval gate
  with tier-aware completeness), §2.
- **Why approval cannot demand the plan:** [DR-069](../../../docs/decisions/DR-069.md)
  (the `planning` status) and its implementing spec
  [SPEC-064](../SPEC-064-planning-lifecycle-status/requirements.md).
- **Status is derived, never read from the literal line:**
  [DR-034](../../../docs/decisions/DR-034.md) (committed approval ground truth) /
  [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (approval foundation).
- **The seam this rule rides:** #1317 (validate the state approval creates) and
  [SPEC-051](../SPEC-051-ownership-before-approval/requirements.md) (ownership before
  approval), which put that check at the library boundary.
- **Prior partial fixes this spec subsumes:** #93 (split-layout skip), #111 (split-layout
  coverage warning), #153 (the `## Requirements` fallback for acceptance criteria).
- **Sibling with a similarly named but different predicate:**
  [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) (risk-section policy) FR-2
  specifies a `hasSection` for the Risks / Consequences family. It is unbuilt (that spec's
  own `implements_reason`), concerns cross-cutting sections rather than phases, and is not
  absorbed here; if both are built, FR-5's substantive test is the natural shared piece.
- **Root-cause framing:** [DR-003](../../../docs/decisions/DR-003.md) (root-cause-driven
  development) — the false warning was first "fixed" by skipping the check for typed files
  (#93), which removed the symptom and the gate together. This spec restores the gate.
- **Spec id.** This spec's id is one above the highest spec number visible in this
  checkout's base branch and locally-known remote branches (number 086, on an unmerged
  branch). Open pull requests newer than those refs are invisible offline, so the id is a
  best reading, not a guarantee — at least twenty unmerged branches currently all claim
  number 080.
