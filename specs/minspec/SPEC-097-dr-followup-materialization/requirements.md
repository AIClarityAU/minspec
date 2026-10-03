---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-023 (this spec's decision) lives here
aspects: [traceability, decision-records, validator, template, soft-gate, tier-0, dogfood]
relates_to: [DR-023, DR-026, DR-013, SPEC-013, "#86", "#87"]
implements: none
implements_reason: >-
  Specify-phase artifact. No module owns the new predicate or the new validator rule yet —
  both are unbuilt (FR-2, FR-3). Ownership is declared at Plan/Clarify, per SPEC-038 FR-1/FR-2
  (declaring now, before approval, would edit bytes the canonical hash will cover).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: DR follow-ups get a real template section and a soft validator rule, so "Follow-ups (tracked)" stops being typed from memory

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#87](https://github.com/AIClarityAU/minspec/issues/87), which the deterministic triage
> gate classified T3/T4 and authorised Specify-phase-only (DR-076/#1169) — so this spec is
> the gate, not the fix. A human reads it, resolves the **Decisions needed (Clarify)**
> questions below, and approves it through the normal spec-approval gate before any code
> changes.

Materializes **[DR-023](../../../docs/decisions/DR-023.md)** (accepted 2026-06-01):
*"Every DR must materialize its surfaced work as tracked artifacts — a `SPEC-NNN` or a
GitHub issue `#` — at DR-creation time. Prose-only follow-ups are not allowed to stand."*
DR-023's own trigger was [#86](https://github.com/AIClarityAU/minspec/issues/86) (the
DR-022 positioning follow-up, which nearly evaporated and was only tracked because it was
noticed by hand). DR-023 names its own materialization as
[#87](https://github.com/AIClarityAU/minspec/issues/87) — this spec — so building it is the
decision dogfooding itself.

## One-Sentence Scope

Give the **Create ADR** template a real `## Follow-ups (tracked)` section (it has none
today), add one shared, reusable predicate for "this line names a tracked `SPEC-NNN` or
issue `#`, or is an explicit `None`", and wire that predicate into one new **soft** (warn,
never fail) validator rule scoped to DRs numbered after DR-023 itself — so the convention
the prose and 77 of 101 existing DRs already follow by hand gains a template default and a
visible check, without retrofitting history or blocking anything.

## Context — what exists today, read from `origin/main`

### The template does not have the section DR-023 requires

`generateAdrContent` (`packages/minspec/src/lib/adr-manager.ts:547-580`) is the only place
**Create ADR** (`minspec.createAdr`, `packages/minspec/src/commands/adr.ts:62-107`) gets its
body from. Its five sections today are `Context`, `Decision`, `Costly to Refactor`,
`In plain terms — what this changes for you`, `Consequences` — no `Follow-ups` heading
anywhere in the function. Every DR that carries one today (see below) typed it from the
CLAUDE.md prose convention, not from a scaffold. DR-023 itself (Decision §1) says the ADR
template "gains" the section; it never did.

### The convention already works by hand, and already drifts

Measured across `docs/decisions/DR-*.md` (100 files):

- **77 of 100** carry some form of a Follow-ups heading. **24** carry none —
  `DR-001`, `002`, `004`, `006`–`021`, `026`, `028`, `030`, `055`, `058` — every one of them
  **at or before `DR-030`** except three: `DR-055`, `DR-058` (which in fact *do* carry the
  section, just under a different heading text — see next point) and the genuine gaps,
  `DR-026`, `DR-028`, `DR-030` (grepped for `follow` case-insensitively: zero hits in any of
  the three).
- **The heading text already varies.** Three distinct strings are in use:
  `## Follow-ups (tracked)` (the plain form, DR-023's own), `## Follow-ups (tracked · DR-023)`
  (`DR-055`), and `## Follow-ups (tracked — DR-023)` (`DR-058`). A predicate that matches the
  literal string would read the last two as absent — the exact "heading/predicate drift"
  SPEC-013 names as its R1 (`specs/minspec/SPEC-013-risk-section-policy/requirements.md:326`)
  for a different section family. This spec's predicate (FR-2) must not repeat that mistake.

So the gap is not "nobody follows the convention" — the opposite: unprompted discipline
already produced 77/100. The gap is that nothing *defaults* it (so new DRs start from a
blank template and must be remembered) and nothing *checks* it (so a miss, like the three
genuine ones above, is invisible until noticed by hand — DR-023's own Context problem,
recurring one level up).

### An existing, narrower precedent — and why this spec doesn't reuse it

`spec-validator.ts:222` already defines a `hasSection(s, names)` helper
(`^##+\s*(names)\b`, case-insensitive, prefix-tolerant), but it is scoped to a different
section family (mockup/API/acceptance-criteria names for specs) and is a presence check
only — it does not know about referencing a `SPEC-NNN`/`#NNN`. SPEC-013 separately proposes
a much larger registry-driven `hasSection` for a *different*, still largely unbuilt,
cross-cutting-section mechanism (Risks/Consequences/Assumptions/…, `status: implementing`
but its own frontmatter records most of that registry as unimplemented). This spec is
narrower than either: one predicate, one section, DR bodies only, no registry, no two-zone
document, no lifecycle. It borrows `hasSection`'s prefix-tolerant matching style (useful
given the heading drift just measured) without taking a dependency on either file.

### Validator precedent for a scoped, non-retrofitting soft rule

`scripts/validate-frontmatter.ts` already carries this exact shape twice: the soft `epic:`
rule (DR-013 §4, mirrored by SPEC-013 FR-6's own citation of it) and Rule 6's DR-sequence
warning (`scripts/validate-frontmatter.ts:275`) — both `warn()`, never `fail()`, both
present without retrofitting every existing record. The file also already has a repeated,
load-bearing discipline this spec must follow: when a check's own machinery cannot run (a
read/parse error), it says so out loud rather than reporting a quiet pass — Rule 17, Rule 18
and Rule 19 each warn an explicit "validated NOTHING this run" on their catch path
(`scripts/validate-frontmatter.ts:328`, `:366`, `:779`), per constitution invariant 2 ("no
load-bearing gate signal is written with a swallowed error").

## Why no new DR

The decision is already made and accepted: **DR-023**. This spec implements it; it makes no
choice DR-023 did not already make, except the two narrow, reversible-in-minutes
implementation questions under **Decisions needed (Clarify)** below (which trigger point,
and which filing mechanism) — neither rises to the ADR filter (undoable in well under a
day: a trigger point is a wiring choice, and DR-026 already governs the offer-never-silent
shape either way).

## Functional Requirements

- **FR-1 (the template gains the section).** `generateAdrContent`
  (`adr-manager.ts:547-580`) MUST emit a `## Follow-ups (tracked)` section as its new final
  section (after `Consequences`), with scaffold guidance matching DR-023 Decision §1: each
  line links a `SPEC-NNN` or a GitHub issue `#`; an explicit `None` is a valid answer. No
  other template (`specify`/`plan` scaffolds) is in scope — DR-023 names ADRs only.

- **FR-2 (one shared predicate, prefix-tolerant).** A single function MUST decide, given a
  DR's raw body text: (a) whether a `Follow-ups` heading is present at all — matched by
  **prefix**, `^##+\s*Follow-ups\b` (case-insensitive), so the three heading variants
  measured in Context (plain, `· DR-023`, `— DR-023`) all count as present, never a
  literal-string match; and (b) for each bulleted line beneath it, whether that line
  references a `SPEC-\d+` id, a GitHub issue `#\d+`, or is the explicit literal `None`
  (whole-line or sentence-leading, case-insensitive). This is the **sole** implementation —
  FR-3 and FR-4 both consume it; neither may re-derive the check independently
  (no-predicate-drift, mirroring SPEC-013's INV-single-predicate for a different family).

- **FR-3 (soft validator rule, scoped forward from DR-023).** `validate-frontmatter.ts`
  gains one new non-fatal rule: for every `docs/decisions/DR-NNN.md` with numeric id
  **greater than 23**, run FR-2's predicate over the body. Missing heading, or a heading
  present with zero referenced/`None` lines beneath it, MUST `warn()` naming the file — never
  `fail()`; only DR-012 approval blocks (DR-023 Decision §3). DRs numbered 23 and below are
  exempt (DR-023 Decision §2: "existing DRs are not retrofitted en masse") — the cutoff is
  the id number, not a date field, because it is deterministic and requires no new frontmatter.
  If the rule's own read/parse step fails, it MUST warn that it validated nothing that run
  (the Rule 17/18/19 discipline cited in Context) rather than passing silently.

- **FR-4 (Create-ADR flow optionally offers to file).** Per DR-023 Decision §2, MinSpec MUST
  offer (DR-026 offer-never-silent: visible, one-click, never automatic) to create the
  missing tracking artifact for each FR-2-flagged line on a DR the author is actively
  working on. The trigger point and the filing mechanism are genuine open questions — see
  **Decisions needed (Clarify)** DQ-1 and DQ-2. Whichever trigger and mechanism Clarify
  selects, the offer MUST reuse FR-2's predicate to decide which lines qualify (no second
  implementation) and MUST NOT write to GitHub without the user completing the write
  themselves (invariant 1: no network call without explicit consent).

- **FR-5 (no retrofit, no new block).** This spec's own diff MUST NOT edit the body of any
  existing `docs/decisions/DR-NNN.md` to add or reword a Follow-ups section — including the
  three genuine gaps found in Context (`DR-026`, `DR-028`, `DR-030`) and the two
  heading-variant DRs (`DR-055`, `DR-058`), which stay exactly as written. FR-3's validator
  rule MUST remain advisory indefinitely for every id — there is no future "promote to
  fail()" clause in this spec; that would be a new decision, not this one.

## Acceptance Criteria

- **AC-1.** A freshly created ADR (`minspec.createAdr`) contains a `## Follow-ups (tracked)`
  heading with scaffold guidance text, positioned after `Consequences`. *(FR-1)*
- **AC-2.** FR-2's predicate returns "present" for a body using any of the three measured
  heading variants, and returns "absent" for a body with no `Follow-ups`-prefixed heading at
  all. *(FR-2)*
- **AC-3.** FR-2's predicate flags a Follow-ups section whose only line is prose with no
  `SPEC-NNN`, no `#NNN`, and no `None`; it does not flag one whose line is exactly `None` or
  names either ref form. *(FR-2)*
- **AC-4.** Running the validator over a fixture `docs/decisions/DR-030.md`-shaped file (no
  Follow-ups heading, id > 23) produces a `warn()` naming the file; the process exits
  **zero**. *(FR-3)*
- **AC-5.** Running the validator over a fixture shaped like `DR-002` (no Follow-ups
  heading, id ≤ 23) produces **no** warning for this rule. *(FR-3, FR-5)*
- **AC-6.** A corpus-wide run over the real `docs/decisions/` as it stands today warns on
  exactly `DR-026`, `DR-028`, `DR-030` for this rule (the three genuine, in-scope gaps
  measured in Context) and on no others. *(FR-3)*
- **AC-7.** Forcing FR-3's read step to throw produces a visible "validated nothing this
  run" warning, not a silent pass. *(FR-3)*
- **AC-8.** The diff for this spec's implementation touches no `docs/decisions/DR-NNN.md`
  file numbered 1 through 30 inclusive, nor `DR-055.md`, nor `DR-058.md`. *(FR-5)*
- **AC-9.** Whatever DQ-1/DQ-2 select: triggering the offer on a DR whose Follow-ups section
  has an unreferenced line surfaces a visible, one-click, non-automatic prompt; declining it
  changes nothing on disk and makes no network call. *(FR-4)*

## Invariants

- **INV-1 (advisory only).** This rule never exits non-zero and never blocks a commit or
  merge; only DR-012 approval blocks (constitution invariant 2's "no silent gate" cuts the
  other way here — the rule must still *warn visibly*, it just must never escalate to fail).
- **INV-2 (no silent gate on the gate itself).** FR-3's own failure-to-run reports itself
  (Rule 17/18/19 discipline); it never reads as a clean pass when it did not actually check
  anything.
- **INV-3 (offline, Tier 0).** No network call, no subprocess beyond what FR-4's chosen
  mechanism already requires consent for; `hasSection`/FR-2 is pure string matching.
- **INV-4 (single predicate).** Exactly one implementation of "does this line carry a
  tracked ref" exists in the codebase; FR-3 and FR-4 both call it.
- **INV-5 (no retrofit).** No existing DR body is edited by this spec or by FR-3's rule
  (which only reads and warns, never writes).

## Decisions needed (Clarify)

### DQ-1 (trigger) — when does the "offer to file" (FR-4) fire?

DR-023's own text — "filed ... when the DR is written" and "the Create ADR flow ... offers
to file" — does not resolve to one mechanical trigger. The blank file `createAdr` produces
has no Follow-ups *content* yet to scan (the section is an empty scaffold at that point,
FR-1), so firing the offer at file-creation time has nothing to check.

- **`a` — on the `proposed → accepted` status transition (rec).** `setAdrStatus`
  (`adr-manager.ts:777`) is the one place in the lifecycle where the DR's body is both
  finished (an author does not accept an unfinished decision) and about to become durable
  record. **Cost:** a DR that sits in `proposed` indefinitely (or is authored and accepted in
  one LLM pass, skipping an intermediate edit) never gets a *second*, separate nudge — the
  offer and the acceptance happen in the same gesture, which this spec treats as correct,
  not a gap.
- **`b` — a standalone, on-demand command** ("MinSpec: Materialize DR Follow-ups") the
  author/agent invokes explicitly, any time. **Cost:** a new palette entry nobody remembers
  to run is exactly DR-023's original failure mode one layer up — an unused affordance is
  not meaningfully different from no affordance, per DR-023's own rejection of "rely on
  human/agent discipline."
- **`c` — at `createAdr` (file-creation) time.** Rejected outright, not merely costed: the
  section is empty at that moment (FR-1 scaffold only), so there is nothing yet to offer.

### DQ-2 (mechanism) — how does "offers to file" actually file?

- **`a` — open a pre-filled GitHub "New issue" URL in the system browser
  (`vscode.env.openExternal`), title/body populated from the DR's context (rec).** MinSpec
  itself makes no GitHub write; the user's own click in their own browser submits it, which
  is the narrowest reading of invariant 1 ("no network call without explicit user
  consent") — the call is the user's, not MinSpec's. No new dependency, no `gh` requirement.
  **Cost:** one extra manual step (the user must actually click "Submit" in the browser);
  MinSpec cannot confirm the issue was filed, so it cannot link back to a number
  automatically — the author pastes it into the DR by hand afterward, same as every DR in
  Context did before this spec existed.
- **`b` — shell out to `gh issue create`, consent-gated like the Backlog panel's read-only
  `gh` calls** (`specs/minspec/SPEC-085-backlog-fetch-consent/requirements.md`). **Cost:**
  SPEC-085's precedent is a *read* (`gh issue list`); this would be MinSpec's first
  *write* to an external service, a materially larger step for invariant 1 than anything
  shipped today, needs its own consent UX design (not reusable off SPEC-085 as-is), and
  takes a new hard dependency on the `gh` CLI being installed and authenticated.

Either answer is reversible in well under a day (a command wiring change, not a stored
contract), so neither needs its own DR regardless of which is picked (see **Why no new
DR**).

## Out of Scope

- **Retrofitting any existing DR's body** — `DR-026`, `DR-028`, `DR-030` (genuine gaps) and
  every other DR lacking or varying the heading. DR-023 Decision §2 rejects a retrofit wave;
  a human noticing one of the three genuine gaps and filing/linking it by hand (exactly as
  `#86` and `#87` were) remains the path, now with a warning instead of silence.
- **Promoting the rule to `fail()` at any tier or any future date.** Not this decision
  (FR-5); DR-023 Decision §3 fixes it as advisory, full stop.
- **Any non-ADR template** (`specify`/`plan` scaffolds, DR-023 names ADRs only).
- **SPEC-013's cross-cutting section registry** (Risks/Consequences/Assumptions/…) — a
  separate, larger, still-largely-unbuilt mechanism this spec deliberately does not extend,
  depend on, or block on (Context).
- **A richer "file on behalf of the user" write capability** (DQ-2 option `b`'s full
  consent/auth design) beyond whichever of DQ-2's two options Clarify selects.

## Alternatives considered

- **Hard-block DRs lacking the section.** Rejected — DR-023 Decision §3 and constitution
  invariant 2 both reserve blocking for DR-012 approval alone; this would be a new,
  un-decided escalation.
- **Backfill the 24 gapped/varied DRs as part of this change.** Rejected — DR-023's own
  Consequences explicitly accepts "existing DRs are not retrofitted en masse" as the chosen
  trade-off; redoing that call here would be relitigating an accepted decision, not
  implementing it.
- **Reuse or extend SPEC-013's `hasSection` registry instead of a standalone predicate.**
  Rejected for now — that mechanism is itself largely unbuilt (Context) and scoped to a
  different section family; taking a dependency on unbuilt infrastructure to ship a small,
  already-decided, already-77%-adopted convention would trade a two-line string match for a
  cross-spec coupling. Revisit if/when SPEC-013's registry actually ships.
- **Exact-string heading match instead of prefix match.** Rejected — `DR-055`/`DR-058`
  measured in Context prove the heading already varies; an exact match would immediately
  misreport two compliant DRs as gaps.

## Test (for the Plan phase to place)

- FR-2's predicate: table-driven unit tests over the three measured heading variants (both
  present and absent cases) and over lines carrying `SPEC-NNN`, `#NNN`, `None`, and bare
  prose with no anchor.
- FR-3: a fixture-based validator test asserting `warn()` fires for an id-24+ DR missing the
  section, does not fire for an id-≤23 DR missing it, and that a forced read error produces
  the explicit "validated nothing" warning (not a silent pass) — mirroring the existing
  Rule 17/18/19 test shape already in the suite.
- FR-1: a template-content test asserting `generateAdrContent`'s output contains the new
  heading in the correct position, exercised the same way existing `adr-manager.ts` template
  tests check section order today.
- FR-4: deferred to whichever DQ-1/DQ-2 answer Clarify records — the test shape depends on
  the trigger and mechanism chosen.
- **Control, required by constitution invariant 2's spirit even for an advisory rule:**
  AC-6 above is itself a real-corpus control — the new rule must name exactly the three
  known genuine gaps on the actual `docs/decisions/` tree, not a fixture that could pass
  vacuously by checking nothing.

## Traceability

- **Issue:** [#87](https://github.com/AIClarityAU/minspec/issues/87) (this spec).
- **Decision implemented:** [DR-023](../../../docs/decisions/DR-023.md) (accepted
  2026-06-01) — Decision §1 (template section), §3 (soft validator rule), §2 (Create-ADR
  flow offer).
- **Sibling instance:** [#86](https://github.com/AIClarityAU/minspec/issues/86) (the
  DR-022 positioning follow-up that triggered DR-023).
- **Related, not depended on:** [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)
  (a larger, separate, still-largely-unbuilt cross-cutting-section mechanism; see
  Alternatives considered).
- **DR for this spec:** none — see "Why no new DR."

## Follow-ups (tracked)

*Dogfooding DR-023's own rule on the spec that builds it.*

- **The three genuine gap DRs** (`DR-026`, `DR-028`, `DR-030`) and the two heading-variant
  DRs (`DR-055`, `DR-058`, which should probably converge on the plain heading once a
  predicate exists to check it) are not touched here (Out of Scope) — a human who wants them
  closed should do it by hand, same as `#86`/`#87`, or → file issue for a mechanical
  backfill chore once FR-3 ships and can confirm the list. None filed yet by this dispatch
  (Specify-phase only; no `gh`/network access from this session).
- **DQ-1/DQ-2** are this spec's own open questions, not deferred work — they block Plan, not
  a future spec.
