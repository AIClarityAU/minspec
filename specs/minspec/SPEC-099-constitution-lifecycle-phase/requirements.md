---
id: SPEC-099
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the phase ladder is the methodology, so adding a phase belongs here
relates_to: [DR-024, SPEC-025, SPEC-065, SPEC-006, SPEC-012, "#19"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-099: Promote constitution to a first-class lifecycle phase

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, resolves the Clarify decisions below, and approves it through the normal
> spec-approval gate before any code changes.

**Meta note.** This spec is itself governed by today's five-phase model (`specify` →
`clarify` → `plan` → `tasks` → `implement`), not by the six-phase model it proposes — FR-1
has not shipped, so this file's own `phases:` block correctly carries no `constitution` key.

Materializes **[#19](https://github.com/AIClarityAU/minspec/issues/19)** — *"constitution
is a file ... parsed by classifier but never appears in `PHASES` ... or lifecycle state
machine. No `minspec constitution` command. No T4 update prompt."*

**Id note.** `SPEC-098` is the highest id reachable from this worktree's `.git` (every
local branch across the many concurrent `agent/issue-*` worktrees sharing it, checked
2026-10-02 — see `scripts/lib/spec-id-collision.ts` for why ids collide under concurrent
creation). This is therefore `SPEC-099`. If it collides at review time, renumber.

**Tier note.** The issue's own dispatch labelled this "T3/T4" and the issue body says
T3. Tracing the change (below) finds it touches the completeness gate (DR-012), the
classify-time toast, the spec panel's stepper, `spec-progress.ts`, and twelve files that
consume `PHASES` (`Phase` is a closed string-literal union — widening it is a type-level
change every exhaustive consumer must be checked against), plus a DR-012-style
enforcement decision (DQ-1) that applies to every future T3/T4 spec in the repo. The
predicted tier is an upward-only floor (CLAUDE.md), so this is **T4**.

## One-Sentence Scope

Make `constitution` a real phase in the `Phase` type and the tier→phase mapping (skip
T1/T2, reference T3, create/update T4), add a `minspec constitution` command that opens
`.minspec/constitution.md` and validates it, add a dismissible T4 classify-time prompt,
and let the existing phase-stepper UI render it — closing the gap between
`requirements.md` FR-2's six-phase table and the five-phase `PHASES` array the code
actually ships.

## Context — what the code does today

- **The drift, exactly.** `requirements.md`'s own FR-2 mapping table (`specs/minspec/requirements.md:59-67`)
  lists "Constitution" as a row with Skip/Skip/Reference/Create-update across T1-T4. The
  `Phase` type and `PHASES` array (`packages/minspec/src/lib/config.ts:8`, `:11`) hold only
  `['specify', 'clarify', 'plan', 'tasks', 'implement']`. `DEFAULT_CONFIG.phaseMappings`
  (`config.ts:127-142`) has no `constitution` entry in any tier's `requiredPhases` or
  `optionalPhases`. This is the literal doc/code drift the issue names.
- **The constitution is real, parsed, and partly tooled already.** `parseConstitution`
  (`packages/minspec/src/lib/constitution.ts:128-140`) extracts `invariants` / `principles`
  / `constraints` from `.minspec/constitution.md`. SPEC-025 (`status: implementing`) already
  built a generator pipeline — `constitutionShowPromptCommand`, `constitutionProposeCommand`,
  `constitutionCompactCommand` (`packages/minspec/src/commands/constitution.ts`), registered
  as `minspec.constitutionShowPrompt` / `minspec.constitutionPropose` /
  `minspec.constitutionCompact` (`packages/minspec/package.json:84-92`) — and an emptiness
  nudge, `isAllTemplate` / `evaluateConstitution`
  (`packages/minspec/src/lib/constitution-nudge.ts:69-84`, `:132-150`), fired once per
  project after the first spec exists (SPEC-025 FR-6). None of that is a *phase*: nothing
  ties it to a spec's tier or to the lifecycle state machine, and there is no command that
  just opens the file and checks it (the three existing commands all *generate* content).
- **`PHASES` is a closed array consumed in twelve files**, found by searching
  `packages/minspec/src` for `PHASES` / `requiredPhases` / `optionalPhases`:
  `lifecycle.ts`, `spec.ts`, `spec-catalog.ts`, `spec-layout.ts`, `spec-manager.ts`,
  `spec-progress.ts`, `spec-validator.ts`, `scaffold.ts`, `classifier.ts`, `config.ts`,
  and the two views `frontmatter-completion.ts` and `spec-panel-html.ts`. The stepper the
  issue asks for already exists and already derives from `PHASES`
  (`spec-panel-html.ts:93`, `:166`, rendered inside `<section class="phase-stepper">`) — it
  needs no new UI code, only a new array element (FR-5).
- **The completeness gate already enforces "required" phases, the same way the issue's
  table implies.** `checkAcceptanceCriteria` reads `config.phaseMappings[tier].requiredPhases`
  and requires a non-empty `## <Phase>` section for each one, at **error** severity for
  T3/T4 — this is what blocks `MinSpec: Approve Spec` today for a missing Plan or Tasks
  section (`packages/minspec/src/lib/spec-validator.ts:1005-1014`, DR-012). Clarify is
  "Required" for T3/T4 in the very same FR-2 table the issue cites, and that word means
  exactly this blocking check — not a toast. So "Constitution: Reference (T3) / Create-update
  (T4)" in that table is either going to mean the same enforced thing, or the table is
  making a promise the code still won't keep. That tension is DQ-1.
- **Backward compatibility is better than it looks, verified, not assumed.** `PHASES` is
  iterated by `createInitialPhases`, `getCurrentPhase`, and `allRequiredDone`
  (`packages/minspec/src/lib/lifecycle.ts:37-81`). All three test `phases[phase] ===
  'pending'` or `=== 'in-progress'`; a key that is simply **absent** (`undefined`) fails
  both comparisons and is silently skipped. So the ~98 specs already on disk, none of which
  will carry a `constitution` key, are **not** flagged as having a pending phase and are
  **not** blocked from `allRequiredDone` by this change, in these three functions. This is
  checked, not inferred (CLAUDE.md evidence discipline) — it does not cover the other nine
  `PHASES`-consuming files, which is why FR-6 requires an explicit pass over all twelve
  before this ships, not an assumption that the pattern holds everywhere.
- **`phases:` is outside the approval hash, confirmed.** `canonicalSpecHash`
  (`packages/minspec/src/lib/approval.ts:338`) excludes the lifecycle fields `status` /
  `phases` from the canonical bytes it hashes (`approval.ts:6`). So neither adding
  `constitution` to new specs' `phases:` block nor (if DQ-2 chooses it) backfilling it into
  old ones can stale an existing approval. This removes what would otherwise be the
  scariest part of this change.
- **DR-024 (Fork B) does not block this.** DR-024 marks the *scalar* `tier` → risk-*profile*
  migration as accepted-direction-only, gated on reach validation (#91) clearing, and
  explicitly not executed. The T1-T4 scalar model and `phaseMappings` this spec edits are
  "the live, operative model until then" (`specs/minspec/requirements.md:16-20`). This spec
  edits the live model, not the gated one.
- **The classify-time toast already has the shape FR-4 needs.** The T4 path
  (`predictedTier === applyFloor(result.tier)`, `packages/minspec/src/commands/classify.ts:87`)
  already drives a non-modal toast with persisting buttons
  (`classify.ts:130-139`); the raise-tier button is the closest existing analogue
  (`classify.ts:171-180`). FR-4 adds a sibling action, not a new toast.

## Functional Requirements

- **FR-1 — `constitution` joins the `Phase` type and `PHASES`, first.** `packages/minspec/src/lib/config.ts:8`
  and `:11` gain `'constitution'` as the first element: `PHASES = ['constitution',
  'specify', 'clarify', 'plan', 'tasks', 'implement']`. `DEFAULT_CONFIG.phaseMappings`
  (`config.ts:127-142`) gains, per the FR-2 table already in `requirements.md:59-67`:
  - **T1** — `constitution` appears in neither `requiredPhases` nor `optionalPhases` (fully
    skipped, no UI surface at all — matches the table's bare "Skip").
  - **T2** — `optionalPhases` only (mirrors how `clarify` is optional for T2 today), so a
    user who wants to can still touch it.
  - **T3** — `requiredPhases` (the table's "Reference").
  - **T4** — `requiredPhases` (the table's "Create/update").
  T3 and T4 share the same enforcement mechanism (FR-2); what differs between "Reference"
  and "Create/update" is convention in the section's content, exactly as "Lightweight
  (approach sentence)" vs "Full design + ADR entry" already differ for Plan without any
  separate code path (`requirements.md:59-67`).

- **FR-2 — The completeness gate treats `constitution` like any other required phase.**
  No new logic: `checkAcceptanceCriteria` (`spec-validator.ts:1005-1014`) already loops
  `config.phaseMappings[tier].requiredPhases` and requires a non-empty `## <Phase>`
  section. Adding `constitution` to T3/T4's `requiredPhases` (FR-1) makes a T3/T4 spec with
  no `## Constitution` section fail completeness at **error** severity, blocking `MinSpec:
  Approve Spec`, the same way a missing `## Plan` does today (DR-012). Whether this actually
  ships enabled is **DQ-1** — FR-1's table assignment is written either way; DQ-1 decides
  whether `requiredPhases` for T3/T4 is used to gate (this FR) or left unused by the gate
  (nudge-only, FR-4).

- **FR-3 — `minspec constitution` command: open and validate, not generate.** A new command
  (id must not collide with the three existing `minspec.constitution*` ids, e.g.
  `minspec.constitutionOpen`) that:
  - opens `.minspec/constitution.md` in the editor (scaffolding it first via the existing
    `scaffold()` path if the project has opted in but the file is missing — never creating
    `.minspec/` itself, per invariant 3 / the opt-in marker rule, SPEC-096);
  - runs a new validator distinct from SPEC-025's `isAllTemplate` (which answers one
    whole-document yes/no). The new check is **per-section**: using `parseConstitution`
    (`constitution.ts:128-140`), each of `## Invariants`, `## Principles`, `## Constraints`
    MUST be present as a heading and MUST contain at least one list item (the issue's
    "sections present, no empty invariants"). Missing/empty sections are reported together,
    not one-at-a-time;
  - surfaces the result as a non-modal toast (HITL convention — never a focus-stealing
    modal for an advisory), offering `minspec.constitutionPropose` (the existing seed/LLM
    path) as the fix action rather than duplicating generation logic.

- **FR-4 — Dismissible T4 classify-time prompt.** When `classify.ts` resolves
  `predictedTier === 'T4'` (`classify.ts:87`), the existing toast (`classify.ts:103-139`)
  gains a sibling action — "Update constitution?" — alongside the raise-tier button,
  opening `minspec.constitutionPropose` (reuse, not a new generation path). Dismissing it:
  - never blocks the classify flow itself (constitution principle: no nagging);
  - MUST NOT be read as satisfying FR-2's completeness requirement by itself — dismissing
    the toast means "not now," and if DQ-1 enables the hard gate, the spec still needs its
    `## Constitution` section before `Approve Spec` will pass. The two are independent: one
    is a same-minute nudge, the other is an approval-time floor (also DQ-1);
  - persists a per-workspace "don't ask again" using the same mechanism the existing
    persisting buttons use (`classify.ts:130-139`), so the prompt is a one-time tour, not a
    standing nag (CLAUDE.md "one-time prompt" convention).

- **FR-5 — Lifecycle UI needs no new code, only the new array element.** `spec-panel-html.ts:93`'s
  `phaseStepsHtml` already maps `PHASES` into the stepper; FR-1 alone makes Constitution
  render as the first step for every spec going forward. This FR is the acceptance
  criterion that confirms that (AC below), not new implementation.

- **FR-6 — Explicit backward-compatibility pass over all twelve `PHASES` consumers.**
  `lifecycle.ts`'s three core functions are already verified safe for an absent key (see
  Context). Before this ships, the same check (does an absent `phases.constitution` key
  render/compute correctly, not as a false "pending") MUST be performed and recorded for
  the remaining nine: `spec.ts`, `spec-catalog.ts`, `spec-layout.ts`, `spec-manager.ts`,
  `spec-progress.ts`, `scaffold.ts`, `classifier.ts`, `frontmatter-completion.ts`, and
  `spec-panel-html.ts`'s own progress-percentage math (which divides by `PHASES.length` and
  will silently start dividing by 6 instead of 5 for every existing spec — correct once the
  array changes, but it is a visible, repo-wide UI change on day one and must be called out
  in the PR, not discovered by a user). This is a Plan-phase task list, not optional
  follow-up.

- **FR-7 — No corpus migration required by the hash.** `phases:` is excluded from
  `canonicalSpecHash` (`approval.ts:6`, `:338`) — confirmed, not assumed. Whether a
  migration happens anyway for UX reasons (so old specs show Constitution as `done` rather
  than absent in the stepper) is **DQ-2**; it is not forced by approval-safety.

## Acceptance Criteria

- [ ] `Phase` and `PHASES` include `'constitution'` as element 0; `TIERS.map(t =>
      DEFAULT_CONFIG.phaseMappings[t])` matches FR-1's skip/optional/required assignment
      exactly for T1-T4. (FR-1)
- [ ] A T3 or T4 spec with every other required section present but no `## Constitution`
      heading fails `checkAcceptanceCriteria` at `error` severity — only if DQ-1 resolves to
      the enforced option; otherwise this AC is replaced by "the gate is unaffected,
      recorded in a code comment pointing at this spec." (FR-2, DQ-1)
- [ ] Running the new command in a project with a template-only (never-authored)
      `.minspec/constitution.md` reports all three sections missing content; running it
      against a constitution with a populated `## Invariants` but empty `## Constraints`
      reports only the latter. (FR-3)
- [ ] Classifying a T4-sized change shows the existing toast with the new action present;
      dismissing it leaves the spec's completeness state unchanged (if DQ-1 = enforced, the
      spec still needs its own `## Constitution` section to pass Approve). (FR-4)
- [ ] A fresh spec created after this ships renders six stepper steps, Constitution first;
      a spec on disk before this ships, with no `constitution` key, renders in the stepper
      (DQ-2 decides done/neutral vs. a new pending dot — either is acceptable, a
      silently-wrong visual state is not) and does not regress its displayed status
      (`new`/`specifying`/`implementing`/etc.). (FR-5, FR-6)
- [ ] Each of the nine files in FR-6 has a one-line recorded check (comment or test) of its
      behaviour against an absent `constitution` key, before merge. (FR-6)
- [ ] An existing approved T3/T4 spec's approval is still valid (hash unchanged) after
      `constitution` is added to `PHASES`, verified by computing `canonicalSpecHash` before
      and after on an unmodified file. (FR-7)

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2).** If DQ-1 enables enforcement, a
  missing `## Constitution` section fails visibly at `Approve Spec`, the same message shape
  as a missing Plan/Tasks section — never a quiet skip. If DQ-1 does not enable enforcement,
  the FR-2 table's "Required" wording for T3/T4 must be corrected in the same change so the
  spec does not keep making a promise the code does not keep (the exact drift class #19
  reports).
- **INV-2 — User override always wins (issue's own stated invariant, consistent with
  constitution principle 2).** The T4 classify-time prompt (FR-4) is always dismissible and
  never blocks classification.
- **INV-3 — Ceremony proportional to tier (issue's own stated invariant).** T1 carries zero
  surface area for this feature — no command visibility change, no toast, no stepper
  difference beyond the inert extra step.
- **INV-4 — Tier-0 / offline (constitution invariant 1).** The new command and validator are
  pure filesystem + parsing, no network, no LLM call — generation stays delegated to
  SPEC-025's existing Tier-1 seam (constitution.ts commands), not rebuilt here.
- **INV-5 — Approval integrity unaffected (DR-012).** No existing approval goes stale from
  this change (FR-7).
- **INV-6 — MinSpec's blast radius (constitution invariant 3).** Nothing here reads or
  writes `.minspec/` in a project that lacks the opt-in marker; FR-3's command resolves the
  folder and checks the marker exactly as the three existing constitution commands do.

## Decisions needed (Clarify)

### DQ-1 — Does "Reference (T3) / Create-update (T4)" actually gate anything?

- **Option A — enforce it, via the existing DR-012 mechanism (rec).** `constitution` joins
  `requiredPhases` for T3/T4 for real; `checkAcceptanceCriteria` blocks Approve on a missing
  `## Constitution` section, exactly like Plan/Tasks do today. *Cost:* every future T3/T4
  spec — and, retroactively in spirit, this repo's own stated methodology — needs one more
  section; a human reviewing a T3/T4 spec now checks one more box. It also means DQ-2's
  answer matters more, because an enforced-but-silently-wrong rendering for old specs is a
  visible regression, not a cosmetic one.
- **Option B — nudge only; `requiredPhases`/`optionalPhases` entries exist but the
  completeness gate does not consult them for this phase.** *Cost:* the FR-2 table's
  "Required" for T3/T4 becomes aspirational prose again, with a different phase name — the
  same shape of drift #19 was filed to close, just moved one level down. If chosen, FR-2
  must be deleted and the mapping table's wording corrected in the same change (INV-1).

### DQ-2 — Backfill the ~98 existing specs, or rely on absent-key tolerance?

- **Option A — no migration; rely on the verified absent-key tolerance (rec).** Matches the
  DR-053 v2 precedent ("record now, reformat later... don't mass-rewrite"). *Cost:* FR-6's
  full nine-file check becomes load-bearing rather than defensive — if even one of those
  nine treats `undefined` differently from the three already checked, an old spec's stepper
  or progress bar renders wrong, silently, until someone notices.
- **Option B — a one-time backfill script writes `constitution: done` into every spec whose
  tier required it and whose phase already reached `implement`, else `skipped`.** Safe
  w.r.t. approval (FR-7), but *cost:* a ~98-file mechanical diff, reviewed by a human, that
  can collide with every in-flight PR touching those same files' frontmatter (the same
  sequencing cost SPEC-096's DQ-6 named for a smaller set).

### DQ-3 — Validator severity for FR-3's new check

- **Option A — `warn`, with the same future-ratchet shape as `ownershipDeclaration`
  (rec).** (`config.ts:52-60` is the precedent: start lenient, flip to `error` once the
  corpus is known-clean.) *Cost:* ignorable indefinitely, same tension that field's own
  comment names.
- **Option B — `error` from day one.** *Cost:* this spec was written without reading every
  adopter's or this repo's own `.minspec/constitution.md` content, so an immediate hard
  failure risks blocking on content nobody has audited yet.

## Out of Scope

- **Rebuilding constitution generation.** SPEC-025's proposer, seed fallback, and
  compaction are consumed (FR-3, FR-4), not reimplemented.
- **The DR-024 / Fork-B risk-profile migration.** This spec edits the live T1-T4 scalar
  model; the risk-profile successor is still gated on #91.
- **Enforcing invariants as gates** (constitution *content* becoming a lint rule over the
  rest of the codebase) — that is #270 (named in SPEC-025), unrelated to this spec's
  "did the spec reference/update the document" check.
- **A richer "Reference" vs "Create/update" content check.** FR-2 relies on the existing
  non-empty-section rule; teaching the gate to tell a reference from an update is future
  work if DQ-1 = Option A reveals the plain check is too weak in practice.

## Why no new DR

The change is additive to a type union and a config default, reversible by removing
`'constitution'` from `PHASES` and the mapping table (under a day), and the scariest-looking
part — frontmatter shape changing under ~98 already-approved specs — is confirmed safe
against the approval hash (FR-7). DQ-1's enforced option extends an *existing* DR-012
mechanism rather than creating a new one. A DR becomes necessary only if DQ-1 is decided
some third way not enumerated here (e.g., a wholly new enforcement path outside DR-012), or
if DQ-2 is resolved as a migration that turns out to need a new per-project store — neither
is this spec's recommended path.

## Traceability

- **Issue:** [#19](https://github.com/AIClarityAU/minspec/issues/19).
- **Governing decisions:** [DR-024](../../../docs/decisions/DR-024.md) (confirms the live
  T1-T4 model this spec edits), [DR-012](../../../docs/decisions/DR-012.md) (the
  completeness-gate mechanism FR-2 reuses).
- **Specs this touches:** [SPEC-025](../SPEC-025-constitution-proposer/requirements.md)
  (generation logic, consumed not rebuilt), [SPEC-065](../SPEC-065-solo-mode-ceremony-cut/requirements.md)
  (precedent for a tier/ceremony spec's Clarify-decision shape), [SPEC-006](../SPEC-006-stub-completeness-gate/requirements.md)
  (the completeness gate FR-2 extends), [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)
  (another `PHASES` consumer in FR-6's list).
- **Follow-ups filed from this spec:** none yet — DQ-1/DQ-2/DQ-3 are resolved by approving
  this spec with a chosen option, not by a separate issue.
