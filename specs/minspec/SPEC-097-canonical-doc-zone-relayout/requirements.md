---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-005  # Auto Structure Repair
relates_to: [SPEC-013, SPEC-005, DR-029, DR-012, DR-034, "#167"]
implements: none
implements_reason: >-
  Specify phase only. This dispatch is scoped to the Specify phase by the triage gate
  (DR-076 / #1169); no code, test, or script exists yet. The migration tool this spec
  describes (FR-1 through FR-6) has zero implementation: no symbol for a Zone
  re-layout, a divider inserter, or a DR-zone order exists anywhere in `scripts/` or
  `packages/*/src` today (checked by grep across both).
---

# MinSpec — Canonical Zone Re-Layout for the Existing Spec + DR Corpus

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A
> human reads it, resolves the **Decisions needed** below, and approves it through
> the normal spec-approval gate before any code or corpus edit happens.

Materializes **[#167](https://github.com/AIClarityAU/minspec/issues/167)** —
*"chore: re-layout existing specs + DRs to canonical Zone order + place core-end
divider (SPEC-013 FR-8)"*. Decision rests on [DR-029](../../../docs/decisions/DR-029.md)
§2 (two-zone document) and its materialization in
[SPEC-013](../SPEC-013-risk-section-policy/requirements.md) FR-8 (canonical Zone A
order + the `<!-- minspec:core-end -->` divider, "actually placed in the file").

## One-Sentence Scope

Mechanically re-layout the bodies of existing `specs/**/requirements.md` files (and,
pending a Decisions-needed resolution below, `docs/decisions/DR-*.md` files) into the
canonical Zone A order SPEC-013 FR-8 already specifies, placing the
`<!-- minspec:core-end -->` divider as a real line in each spec body — no content
rewriting, no requirement/decision-text changes.

## Context

[SPEC-013](../SPEC-013-risk-section-policy/requirements.md) FR-8 defines the canonical
spec layout: Zone A (`scope → Context → Requirements/FRs → Costly to Refactor →
Acceptance Criteria → Out-of-Scope → Open Questions → Invariants`), then a literal
`<!-- minspec:core-end -->` divider, then the Zone B self-audit appendix (B1 "skim" /
B2 "please read", fixed family order). FR-8's own text says this divider "today lives
only as prose — zero docs render it," and names "the inconsistent section order this
fixes" as the symptom. That diagnosis was accurate when FR-8 was written but is now
**partially stale** (Evidence Discipline, CLAUDE.md) — checked directly against the
corpus on this branch, not re-asserted from the issue text:

- **One spec is already fully conformant.**
  [SPEC-035](../SPEC-035-approvable-ref-lozenges/requirements.md) places a literal
  `<!-- minspec:core-end -->` divider at line 202, with Zone A in exactly FR-8's order
  (`One-Sentence Scope → Context → Functional Requirements → Costly to Refactor →
  Acceptance Criteria → Out of Scope → Open Questions → Invariants`, divider, then
  `Risks & Mitigations → Dependencies`). So "zero docs render it" is false as of this
  reading; the corpus is **inconsistent**, not **uniformly unfixed**.
- **SPEC-013 itself is not conformant.** Its own body only *mentions* the divider in
  prose (11 hits, all inside FR/INV/AC text) — it never places the literal HTML
  comment. Its headings run `Context → Requirements → Costly to Refactor → Invariants
  → Acceptance Criteria → Risks & Mitigations → Assumptions → Test-thought → Coverage
  Map → Consequences → Failure-Modes/Edge-Cases → Test/Verification Strategy →
  Alternatives Considered → Dependencies & Blast-Radius → Rollback/Reversibility → Out
  of scope → Resolved design decisions → Open questions → Follow-ups (tracked)` — Zone
  A's `Out-of-Scope`/`Open Questions` land *after* the entire Zone B family, and
  `Invariants` lands *before* `Acceptance Criteria` instead of last in Zone A.
- **SPEC-005** (the issue's proposed implementation home) has no divider at all and
  interleaves Zone A and Zone B freely (`Costly to Refactor (Zone A)` label with no
  divider; `Invariants` before `Acceptance Criteria`; `Out of scope`/`Open questions`
  at the very end, after `Follow-ups (tracked)` and `Coverage Map`).
- **The scope is far larger than the issue states.** The issue's title says "13 specs
  + 30 DRs"; this checkout holds **74 specs** under `specs/minspec/` +
  `specs/agent-execute/` and **100 DRs** under `docs/decisions/` (`ls -d
  specs/*/SPEC-*/ | wc -l`; `ls docs/decisions/DR-*.md | wc -l`, run on this branch).
  A quick survey of a *recent* spec, SPEC-095 (authored 2026-10-02, well after FR-8),
  shows the same drift: no divider, headings include `Why no new DR`, `Out of Scope`,
  `Alternatives considered and rejected`, `Test plan`, `Traceability` in an order FR-8
  does not define at all. **Non-conformance is not a backlog of 13 old stragglers —
  it looks closer to universal**, including specs written after FR-8 existed. See
  Decisions needed DQ-1.
- **A large share of the spec corpus is hash-locked.** `.minspec/approvals/specs/`
  holds an approval record for roughly **69 of the 74 specs** on disk (counted via
  `find .minspec/approvals/specs -maxdepth 2 -type d | wc -l` minus the two product
  roots). `specHash()` (`packages/shared/src/canonical.ts:89-128`) hashes the
  frontmatter-minus-lifecycle **plus the entire body verbatim** — reordering a body
  section changes the hash and stales the approval (DR-012), same as any other
  substantive edit. **Only `status`/`phases` are exempt.** Re-laying-out an approved
  spec's body therefore requires re-approval, not just a mechanical commit. See
  Decisions needed DQ-2.
- **DRs have no analogous hash-lock** — `.minspec/approvals/` holds only a `specs/`
  subtree, no `decisions/` subtree, and `docs/decisions/INDEX.md` names no DR approval
  hash mechanism. Reordering a DR body is a plain content edit with no approval-
  staleness consequence.
- **FR-8 does not define a DR layout.** Its canonical order is written in spec
  vocabulary (`Requirements/FRs`, `Acceptance Criteria`, `Out-of-Scope`) — sections DRs
  mostly don't have. Reading the actual DR corpus (`DR-098.md`, `DR-100.md`) and the DR
  scaffold template (`adr-manager.ts:555-576`) shows a **third, different order** in
  each: the template writes `Context → Decision → Costly to Refactor → In plain terms
  → Consequences`; the two most recent DRs on disk instead open with `In plan terms`
  *before* `Context`, then `Decision → (optional sections) → Alternatives rejected →
  Costly to Refactor → Consequences → (Risks) → Follow-ups (tracked) → Status` — and
  neither carries a `<!-- minspec:core-end -->` divider anywhere in the corpus. There
  is no ratified canonical DR order to re-layout *to*. See Decisions needed DQ-3.

## Requirements

### Tool + scope

- **FR-1 (migration is a script, not a hand-edit).** A deterministic script (or an
  extension to an existing one, per DQ-4) reads a `requirements.md`/`DR-NNN.md` file,
  parses its `## `-level headings and their body spans, and re-emits the same spans in
  the canonical order for that doc kind — never altering heading text, body prose,
  code fences, tables, or any byte inside a span. It is idempotent: running it twice
  produces no further diff after the first run.
- **FR-2 (spec Zone A order, exact).** For `specs/**/requirements.md`, Zone A emits in
  the order already fixed by SPEC-013 FR-8: `(title/One-Sentence Scope) → Context →
  Requirements → Costly to Refactor → Acceptance Criteria → Out-of-Scope → Open
  Questions → Invariants`. A file missing one of these headings skips that slot
  (FR-8 does not mandate every heading exist, only the relative order of the ones
  that do).
- **FR-3 (divider placement).** The tool inserts (or, if present only in prose,
  additionally places) a literal `<!-- minspec:core-end -->` line immediately after
  the last Zone A heading's body and before the first Zone B heading, for every file
  that has at least one Zone B heading. A file with no recognized Zone B heading gets
  no divider (nothing to delimit).
- **FR-4 (Zone B family order).** Headings in SPEC-013's self-audit family (`Risks &
  Mitigations, Assumptions, Test-thought, Consequences, Failure-Modes/Edge-Cases,
  Test/Verification Strategy, Alternatives Considered, Dependencies & Blast-Radius,
  Rollback/Reversibility`) re-order among themselves into that fixed sequence, after
  the divider.
- **FR-5 (unregistered headings are preserved, not dropped, and not silently
  reordered past Zone A/B boundary).** A heading the registry does not name (e.g.
  `Coverage Map`, `Follow-ups (tracked)`, `Resolved design decisions`, `Traceability`,
  `Delivery slices`, `Test plan`, `Why no new DR`, `Clarify selections`) keeps its
  content and lands in Zone B, after the registry-family headings, in its **original
  relative order** against the other unregistered headings in that file (stable sort —
  never invented sequencing for headings FR-8 is silent on). Per invariant 2 (no
  silent gate / no silently-dropped content): the tool must list every heading it
  moved and every heading it left untouched in its own run output, not swallow either
  outcome.
- **FR-6 (DR layout — gated on DQ-3).** No DR file is re-laid-out until Decisions
  needed DQ-3 names a ratified canonical DR order (a DR or a SPEC-013 amendment to
  adopt one) — this spec's acceptance does not itself create that order. FR-1's script
  is written doc-kind-aware so the spec re-layout (FR-2–FR-5) can ship independently
  of DR re-layout.

## Costly to Refactor

- **The divider's byte position inside every spec it touches.** Once placed, it is a
  structural contract other tooling will parse (FR-8's own `coreHash`, FR-10
  freshness, a future validator). Placing it wrong now (e.g. before `Invariants`
  instead of after, per a misreading of FR-8) means re-touching every migrated file a
  second time, and each touch is a hash-staling edit on an approved spec. *Check:
  dry-run the exact line-split against SPEC-035's already-conformant file and diff
  against zero before applying to any other file.*
- **The approval-staleness blast radius this spec's own execution creates.** Approving
  *this* spec authorizes a migration that, if it touches hash-locked specs, mass-
  invalidates ~69 existing approvals in one pass — a one-way move (DR-359 ADR filter:
  not reversible in under a day, since each requires a human re-approval act, not a
  revert). *Check: DQ-2's answer is recorded and acted on before any approved spec's
  body is touched.*

## Acceptance Criteria

- [ ] **AC-1.** Running the tool against the current `specs/minspec/` +
  `specs/agent-execute/` corpus produces a diff that touches **only** `## `-heading
  blank-line boundaries, heading placement, and the one inserted divider line per
  file — `git diff --stat` shows line churn consistent with moved blocks, and a
  word-level diff (`git diff -w` or equivalent) over any single file's Zone A/B
  headings' *body text* is empty.
  - **AC-1.1.** SPEC-035, already conformant, produces a **zero-line diff** (idempotence
    proof, FR-1).
- [ ] **AC-2.** Every file the tool touches keeps an unchanged `specHash()` input
  **or** the run output names it as a hash-staling touch and the plan for re-approval
  (DQ-2's answer) is applied before merge — never a silent stale.
- [ ] **AC-3.** The tool's own run output enumerates, per file: headings found,
  headings moved and to what position, and any heading it could not place
  (unrecognized AND ambiguous — e.g. two `## Context` headings) — the last case fails
  the run for that file rather than guessing (invariant 2).
- [ ] **AC-4.** No DR file is modified by this spec's shipped FR set unless DQ-3 is
  resolved with a ratified order first (FR-6).

## Out-of-Scope

- Changing any requirement, decision, or prose *content* — this is layout only.
- Building FR-8's enforcement mechanism (the `hasSection` predicate wiring,
  `coreHash`, the validator's parse of the divider) — that is SPEC-013's own,
  separately tracked, unbuilt mechanism; this spec only places the bytes SPEC-013
  already specified the shape of.
- Re-approving any spec this migration stales — re-approval is a human act (DR-012);
  this spec's Plan phase schedules *when* that act happens, not this spec itself.
- Defining a new canonical DR order — DQ-3 asks whether to do that at all; if the
  answer is yes, that belongs in a DR or a SPEC-013 amendment, not invented here.

## Open Questions

- Should the migration run as one corpus-wide commit, or batched per-epic /
  per-approval-status so a reviewer can diff a manageable slice at a time? Leaning
  batched, given ~69 approved specs are in scope for DQ-2's "include" branch — tracked
  for the Plan phase once DQ-1/DQ-2 are answered.

## Invariants

- **INV-1 (content-preserving).** No requirement text, decision text, acceptance
  criterion, or invariant changes meaning or wording as a result of this migration —
  only position. (Mirrors constitution invariant 2's "no silent gate" in spirit: a
  layout tool that also rewrites prose would be an unreviewable silent content
  change.)
- **INV-2 (no new hash-lock bypass).** The migration does not touch `status`/`phases`
  to dodge `specHash()` staleness (`canonical.ts:24-26` exempts only those two keys
  on purpose) — a body reorder is a real edit and is let be seen as one.
- **INV-3 (Tier-0).** The migration tool is pure file-system text transform — no AI,
  no network call (constitution invariant 1).

## Decisions needed (Clarify)

- **DQ-1 — Scope: all 74 specs / 100 DRs, or the subset the issue actually meant?**
  The issue was filed against "13 specs + 30 DRs"; the corpus today is 74 specs + 100
  DRs (Context, above), and a spot-check shows non-conformance is widespread, not a
  bounded 13-item backlog. Options: **(a) full corpus** — re-layout everything
  non-conformant, highest consistency, highest review burden and highest approval-
  staleness blast radius (DQ-2); **(b) only specs/DRs that existed when the issue was
  filed** — honors the issue's original, smaller intent, but leaves the *majority* of
  the corpus (including SPEC-095, written after FR-8) inconsistent, so the symptom the
  issue reports recurs almost immediately; **(c) only non-hash-locked specs (status:
  `planning`/`specifying`) + all DRs** — sidesteps DQ-2's re-approval cost entirely,
  but a spec very likely re-approves again before reaching `done` anyway (most specs
  here cycle through several review rounds), so deferring costs little. **Recommend
  (c)** — it gets the win (consistent corpus for every doc still being actively
  reviewed) without forcing ~69 unrelated re-approvals as a side effect of a layout
  chore; its cost is that already-`implementing`/`done` specs (SPEC-013 itself
  included) stay inconsistent until their next substantive edit, which could be a long
  wait for an inactive one.
- **DQ-2 — Approved/hash-locked specs: re-layout now (forces re-approval) or leave
  alone?** `specHash()` covers the full body; reordering stales ~69 approvals in one
  pass if included. Options: **(a) include, batch re-approval** — single consistent
  sweep, but asks for ~69 individual re-approval acts (DR-012 is a human act, not
  scriptable) in a short window, which both this repo's and the general CLAUDE.md's
  "no self-approval, no borrowed identity" rule means nobody but the human approver
  can discharge; **(b) exclude hash-locked specs from this migration entirely** — ties
  to DQ-1(c); zero re-approval cost, but those specs stay as-is. **Recommend (b)**,
  same reasoning as DQ-1(c) — the cost of 69 forced re-approvals for a pure-layout
  chore is disproportionate to the benefit, and DR-012's hash-lock exists precisely to
  make an approver re-look at a changed body, which a cosmetic reorder would summon for
  no substantive reason.
- **DQ-3 — Is there a canonical DR layout at all, and if so what is it?** FR-8 is
  spec-shaped and does not name a DR order; the DR scaffold template and the two most
  recent DRs on disk already disagree with each other (Context-first vs. "In plain
  terms"-first). Options: **(a) ratify "In plain terms" first** (matches the two most
  recent hand-authored DRs — may be the de facto current preference) **(b) ratify the
  scaffold's Context-first order** (matches what new DRs are actually scaffolded with
  today, so zero drift going forward) **(c) decline to define one — DRs stay
  unordered, this spec covers specs only**. **Recommend (c)** — minting a DR-ordering
  rule as a side effect of a spec-layout chore is exactly the kind of under-specified
  decision DR-023's "file the issues for any follow-up not covered by a spec" rule
  warns against; if a DR order is wanted, it deserves its own DR (which can then cite
  this spec's FR-6 as the trigger), not an inline guess here. Cost: DRs keep drifting
  layout until someone does that follow-up work.
- **DQ-4 — Implementation home: extend SPEC-005, or a standalone one-off script?**
  The issue raises this explicitly and asks to "decide at triage." SPEC-005's own FR-4
  ("writes only absent files, MUST NOT overwrite existing user files") is written
  against a different failure mode (missing scaffolding) than this spec's (existing,
  present content in the wrong order) — extending it would need a new FR carving out
  an explicit overwrite exception next to a FR that currently forbids exactly that.
  SPEC-005 is itself hash-locked (`status: implementing`, approval on disk) — adding an
  FR stales *that* approval too, one more re-approval act on top of whatever DQ-2
  decides. Options: **(a) extend SPEC-005** — keeps one spec owning "repair the SDD
  structure," but stales SPEC-005's approval and must carefully scope the new FR so it
  doesn't contradict FR-4's existing promise; **(b) standalone one-off script** (e.g.
  `scripts/relayout-doc-zones.ts`, following the `migrate-approvals.ts` precedent
  already in `scripts/`) — zero interaction with SPEC-005's approval, and "one-off
  migration script with no owning spec" is an established pattern in this repo.
  **Recommend (b)** — a one-off, run-once corpus migration is a worse fit for a spec
  that frames itself as an always-on repair *mechanism* (SPEC-005's "Done" bar is a
  debounced watcher that re-fires), and keeping it standalone avoids stacking a second
  re-approval onto DQ-2's open question. Cost: no spec owns the script long-term, so if
  the corpus drifts out of canonical order again later, there's no standing mechanism
  (watcher/validator) catching it — only FR-8's own (separately tracked, unbuilt)
  enforcement would.
