---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — same epic as SPEC-005/SPEC-010/SPEC-012/SPEC-014/SPEC-022, which this spec composes
depends_on: [SPEC-012]  # the FR-15 deterministic→LLM-escalation repair ladder this spec's FR-2 calls, not reimplements
relates_to: [SPEC-005, SPEC-010, SPEC-014, SPEC-022, DR-012, "#104", "#93", "#103"]
implements: none
implements_reason: >-
  Specified, not built. FR-1 (no confirmation dialog on approve) is already shipped and pinned
  by a dedicated regression test — see Context — so this spec claims no credit for it; it
  exists to scope the remaining, unbuilt part of issue #104 (opinionated fix-first instead of
  advisory-only warnings). Nothing under `packages/minspec/src` references a repair ladder
  called from `approve.ts`; `grep -r "repair" packages/minspec/src/commands/approve.ts` has no
  hits. No `implements:` claim until Plan assigns owned files (DQ-4 decides whether this spec
  or SPEC-012 owns the ladder module).
affects: [packages/minspec/src/commands/approve.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: Approve — opinionated fix-first, not warning/approve-anyway

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the Decisions below, and approves it through the normal spec-approval
> gate before any code changes. Each decision carries a **recommended** option under
> [Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-03-ratified-only-by-approval-of-this-spec);
> approving this spec as written accepts those recommendations. Picking a different option
> changes only the requirements that decision names.

Materializes **[#104](https://github.com/AIClarityAU/minspec/issues/104)** —
*"redesign approve flow — no confirm dialog, opinionated fix-first (not warning/approve-anyway),
shift-left detection."* The issue bundles three changes; the trace below (read from the
current checkout, not inferred) finds the first already shipped, the third already fully
specified elsewhere, and only the second — opinionated fix-first — genuinely unbuilt. This
spec scopes that remainder; it does not re-litigate the other two.

## One-Sentence Scope

When **Approve Spec** finds a validator *warning* on an otherwise-complete spec, it repairs
the gap through the existing SPEC-012 FR-15 ladder (deterministic repair, confirm-before-write;
else offer LLM-escalation repair, confirm-before-write; never author section content silently)
and only then approves — replacing today's "approve now, mention the gap afterward" with
"fix the gap, show the fix, approve the now-complete spec."

## Context — what the code does today (read from this checkout, not inferred)

### Part 1 of #104 ("no confirm dialog") — already shipped

`approveSpecCommand` (`packages/minspec/src/commands/approve.ts:220`) runs the completeness
checks (`:272-325`), then goes straight to `recordApproval` (`:384`) with **no** intervening
confirmation modal. The comment at `:365-369` names this explicitly: *"Complete — approve
directly. Selecting 'Approve Spec' and picking this spec IS the explicit act (DR-012); a
second confirmation modal is redundant friction (#104)."* A dedicated regression test pins it:
`packages/minspec/tests/approve-action.test.ts:419` — *"approves a complete spec directly,
with no confirmation modal"*. The companion ask in the issue — move the "editing revokes
approval" note to a first-approve-only hint — is also shipped, at `approve.ts:441-451`
(gated on a `Memento` key, `minspec.approveRevokeHintShown`), with the same `#104` citation in
the comment at `:441`. **Nothing in this spec changes either of these.** They are recorded
here only so Acceptance Criteria can assert they stay intact.

### Part 2 of #104 ("opinionated fix-first, not warning/approve-anyway") — the gap

There is no "approve anyway" button anywhere in the codebase (`grep -rn "[Aa]pprove [Aa]nyway"
packages/` — zero hits) — so the specific escape-hatch dialog the issue describes does not
exist to remove. What does exist, and is the actual gap: a validator *warning* on an otherwise
complete spec never triggers a fix. `approveSpecCommand` runs `validateSpec`
(`approve.ts:272-277`), splits violations into `errors` (block approval, `:278`, `:281-294`)
and `warnings` (never block, `:279`), approves (`:384`), and only **afterward** surfaces the
warnings as a non-modal advisory toast (`:419-439`). This is deliberate and tested —
`approve-action.test.ts:434`, *"surfaces warnings as a non-modal advisory after approving
(never an approve-anyway gate)"* — asserting in its own name the thing #104 asks to change:
approval proceeds with the gap still open, and the toast only narrates it. Nothing adds the
missing section, scaffolds the missing file, or offers to. That is this spec's one piece of
new ground.

### Part 3 of #104 ("shift-left: detect + fix at generation") — already fully specified

[SPEC-010](../SPEC-010-signpost-correctness/requirements.md) FR-9 through FR-16 already
specify exactly this: a save-time completeness check on every `specs/**` save (FR-9), routed
by authorship — agent saves auto-bounce in-loop, human saves get a non-blocking "Fix with AI"
offer (FR-10) — with detection staying deterministic and only repair ever invoking an LLM
(FR-12), dirty-editor safety (FR-14), and one shared L1 checker consumed by the editor, the
commit hook, CI, and agent dispatch alike (FR-16). **None of it is built** —
`specs/minspec/SPEC-010-signpost-correctness/requirements.md:9-15`'s own
`implements_reason` records zero hits for any of its symbols across `packages/minspec/src`,
`packages/shared/src`, and `.githooks`. This spec does not re-specify shift-left; it only
states, in FR-3 below, how approve-time repair relates to it once SPEC-010 ships (a backstop,
never the primary path).

### The named hard dependency — re-examined, not re-stated

The issue blocks auto-fix on `#93` ("split-layout model") and `#103` ("tier-default") landing
first, citing [scrooge#2](SCR#2 — scroogellm's own tracker) as the motivating unsafe case:
*"on today's model [auto-fix] would auto-insert phantom `## Plan` sections into split-layout
design docs."* Both named issues have, in fact, landed:

- **`#93`** — `spec-validator.ts:994-1053` already skips every single-file, in-body
  phase-section and aspect-artifact check for a split-layout spec (`SPLIT_LAYOUT_TYPES =
  {requirements, design, tasks}`), scoping aspect-artifact checks to the `design` file only
  (`:1038-1039`) and leaving cross-file phase-file coverage to a separate, explicitly-warned
  rule (`split-coverage.<type>.missing`, `:1188-1190`). This is the comment's own label —
  `// Split-layout (#93): …` recurs at `:994`, `:1027`, `:1031`.
- **`#103`** — `fix(#103): warn when a primary spec silently defaults to tier T2`
  (commit `de1e286f`, present in this checkout's history) landed the tier-default warning the
  issue names.

So the premise that motivated the block — *an unsafe completeness model* — is narrower than
it reads in the issue. But landing #93/#103 does not, by itself, make it safe to have a
deterministic rung **author prose into a missing section**: an empty or templated `## Plan`
stub would pass the same completeness check that flags its absence today, which is the
[SPEC-006](../SPEC-006-stub-completeness-gate/requirements.md) stub-gate anti-pattern applied
to spec content instead of code — a hollow placeholder that satisfies a check while hiding the
gap is worse than the check firing honestly. FR-2 and DQ-1 below resolve this the other way:
not by waiting on #93/#103 (already satisfied), but by never letting the *deterministic* rung
write section content at all. This is this spec's own inference, not the issue's — flagged as
such in DQ-3, for a human to confirm or override.

## Functional Requirements

- **FR-1 (baseline — already shipped, protect it).** Approve continues to approve a complete
  spec with no confirmation modal, and to show the "editing revokes approval" tip only on a
  developer's first approval (both `approve.ts:365-369`, `:441-451`). This spec adds no new
  modal here. (Regression-pinned by `approve-action.test.ts:419`.)
- **FR-2 (opinionated fix-first replaces advisory-only warnings).** When `validateSpec`
  returns a *warning* (never an *error* — errors already refuse approval, `approve.ts:281-294`,
  unchanged) on an otherwise-complete spec, and that warning's rule is on the **repairable
  allowlist** (DQ-1), `approveSpecCommand` MUST, before recording approval:
  1. Run the SPEC-012 FR-15 ladder for that warning: try a deterministic repair first; if none
     applies, offer to escalate to an LLM repair (the same `claude -p` / agent-dispatch
     consent path as SPEC-010 FR-10/FR-12 — never an in-extension network call, per
     constitution invariant 1).
  2. Present the resulting change for **confirm-before-write** (SPEC-012 FR-15; SPEC-010
     FR-14's dirty-editor safety applies identically) — never auto-apply silently
     (constitution invariant 2; SPEC-005 FR-3's offer-never-silent pattern, applied to spec
     content instead of structure).
  3. On confirm, apply the change, re-run `validateSpec`, and proceed to approve the
     now-complete spec in the same command invocation (one user action, not two round trips
     through the picker).
  4. On decline, fall back to **today's** behavior for that warning — approve, show it as a
     non-modal advisory (`approve.ts:419-439`) — never a blocking "fix or cancel" gate
     (constitution invariant 2 reads both directions: no silent gate, but also no gate where
     none exists today).
  A warning whose rule is **not** on the allowlist (DQ-1) is unaffected by this FR — it keeps
  today's advisory-only path exactly as is.
- **FR-3 (approve-time repair is the backstop, not the primary path).** Once
  [SPEC-010](../SPEC-010-signpost-correctness/requirements.md)'s save-time check (FR-9) ships,
  most of the gaps FR-2 would otherwise catch are expected to be caught and offered at save
  time instead, per the issue's own "ideally the gap is caught + repaired at specify/plan
  generation" framing. FR-2 MUST NOT be removed once SPEC-010 ships — it is the last-resort
  catch for a spec authored or edited outside the editor's save hook (e.g. a hand-pushed
  branch, a different tool) — but it MUST reuse the same detection the save-time check uses
  (SPEC-010 FR-16's shared L1 checker), not a second, approve-local notion of "complete."
- **FR-4 (no second repair-ladder implementation).** `approveSpecCommand` is a **caller** of
  the SPEC-012 FR-15 ladder, the same way SPEC-010 FR-16 makes the editor save hook, the
  commit hook, CI, and agent dispatch four callers of one shared L1 checker. This spec does
  not implement a second deterministic-repair/LLM-escalation engine inside `approve.ts`; see
  DQ-4.

## Decisions needed (Clarify)

Genuine forks a human must settle before Plan. None is guessed into the requirements above
without being named here.

### DQ-1 — What goes on the "repairable" allowlist FR-2 reacts to?

**Recommended: Option B.**

- **Option A — allow the deterministic rung to author a placeholder for a missing section**
  (e.g. an empty `## Plan` with a `<!-- TODO -->` body), so FR-2's step 1 can resolve
  mechanically for the common "whole section missing" case without ever reaching the LLM
  rung. *Cost:* this is exactly the SPEC-006 stub-gate anti-pattern turned on spec content —
  a hollow section satisfies the same check that flagged its absence, so the gap becomes
  invisible instead of advisory. It also reopens the phantom-section risk the issue's hard
  dependency named, independent of whether #93/#103 landed.
- **Option B — the deterministic rung may only fix warnings that need no authored content at
  all** (e.g. a dangling `epic:` ref that resolves unambiguously to the repo's one matching
  epic, or a `status`/`phases` mirror drift already covered by SPEC-022 FR-4's `deriveStatus`).
  Every warning whose fix is "write prose/content into a missing or thin section" — including
  `section.<phase>.empty`, the four `ASPECT_RULES` warnings, and `split-coverage.<type>.missing`
  — routes to the **LLM-escalation rung only**, confirm-before-write, never the deterministic
  one. *Cost:* FR-2 leans on the LLM rung for the issue's headline case ("noticed the spec is
  missing X — adding it first"), so FR-2's value is gated on agent-dispatch being available
  and consented to (Tier 1) — a Tier-0-only workspace sees no behavior change from FR-2 beyond
  today's advisory, which stays correct per FR-2 step 4.

### DQ-2 — What renders the confirm-before-write diff in v1?

**Recommended: Option A.**

- **Option A — reuse the existing modal-detail idiom** (`approve.ts:284-293`'s pattern: a
  message plus a `detail` string) to show a plain-text before/after for the proposed repair,
  shipping independently of [SPEC-014](../SPEC-014-review-webview/requirements.md)'s review
  webview. *Cost:* the diff is plain text, not SPEC-014's rich change-highlighted view the
  issue envisioned; FR-2's `{before, after}` pair is written as a stable contract so swapping
  in SPEC-014's renderer later needs no FR-2 rework.
- **Option B — block FR-2's implementation on SPEC-014 landing.** *Cost:* SPEC-014 is itself
  specified-not-built, T4, with no implementation date (`specs/minspec/SPEC-014-review-webview/requirements.md:9-16`'s
  own absence-verified `implements_reason`); this defers the issue's main ask indefinitely.

### DQ-3 — Is the #93/#103 hard dependency actually cleared?

**Recommended: Option A.**

- **Option A — yes, conditioned on DQ-1 Option B.** The Context section above traces #93 and
  #103 as landed in this checkout; the specific unsafe case scroogellm#2 named (phantom
  `## Plan` insertion into a split-layout design doc) is foreclosed structurally once the
  deterministic rung is barred from authoring section content (DQ-1 Option B), independent of
  the two issues. *Cost:* this is this spec's own inference about what "the completeness model
  is correct" was gesturing at, not a re-read of the two linked GitHub issues' own closing
  comments (no network access from this dispatch) — a human who tracked #93/#103 to closure
  should confirm this reading matches theirs before Plan.
- **Option B — treat the dependency as still open** and gate FR-2's implementation on an
  explicit human sign-off that #93/#103 are closed, independent of this spec's trace. *Cost:*
  re-does work this spec already did from the checkout; only worth it if Option A's inference
  is wrong.

### DQ-4 — Does this spec or SPEC-012 own the repair-ladder module?

**Recommended: Option A.**

- **Option A — SPEC-012 owns the ladder; this spec owns only the `approve.ts` call site.**
  FR-4 already states this; Plan for this spec sequences behind SPEC-012 FR-15 landing (this
  spec's `depends_on`). *Cost:* this spec cannot reach Implement until SPEC-012 does, which is
  itself unbuilt — a longer critical path, but the alternative is the exact drift SPEC-010
  FR-16 was written to prevent ("one checker → one verdict everywhere").
- **Option B — build a standalone, approve-local ladder now** and reconcile with SPEC-012's
  later. *Cost:* near-certain divergence between two "detect → deterministic → LLM →
  confirm" implementations, and a rewrite once SPEC-012 ships — the risk FR-4 exists to avoid.

## Clarify selections (recorded by an agent 2026-10-03; ratified only by approval of this spec)

This repository runs with `"autonomy": "act"` (`.minspec/config.json`), under which an agent
proceeds on a stated recommendation and records the alternatives it did not take (DR-086 §2/§4)
rather than asking. Approving a T4 spec is on that policy's stop list (approval-or-acceptance),
so nothing here stands in for a human's approval: the **Recommended** lines above are the
proposal, and approving this spec with them in place — or changing one first — is what
ratifies or overrides them. No human had approved this spec as of this commit
(`status: specifying`, `clarify: pending`).

- DQ-1 → **Option B** (no authored content on the deterministic rung).
- DQ-2 → **Option A** (plain-text diff now; SPEC-014 is a drop-in upgrade later).
- DQ-3 → **Option A** (#93/#103 cleared, conditioned on DQ-1 Option B) — **flagged for human
  confirmation**, since it rests on this dispatch's own reading of closed issues it could not
  re-open over the network, not on re-reading #93/#103's own resolution.
- DQ-4 → **Option A** (SPEC-012 owns the ladder; Plan for this spec sequences behind it).

## Acceptance Criteria

- [ ] **(FR-1)** `approve-action.test.ts:419` ("no confirmation modal") and the first-approve-only
  hint behavior (`approve.ts:441-451`) remain green and unchanged by this spec's implementation.
- [ ] **(FR-2)** For a warning whose rule is on the DQ-1 allowlist, Approve runs the repair
  ladder, shows confirm-before-write, and — on confirm — applies the fix and approves the
  resulting complete spec in one command invocation; on decline, falls back to today's
  non-modal advisory with approval still proceeding.
- [ ] **(FR-2)** For a warning whose rule is NOT on the allowlist, behavior is byte-for-byte
  today's: approve, then non-modal advisory. `approve-action.test.ts:434`'s existing assertion
  ("never an approve-anyway gate") continues to pass for this class of warning; it is revised,
  not deleted, to scope its claim to the non-allowlisted case once FR-2 ships.
- [ ] **(FR-2/invariant)** No deterministic repair ever authors section prose; every repair that
  writes content routes through the LLM-escalation rung with confirm-before-write.
  (DQ-1 Option B.)
- [ ] **(FR-3)** Approve-time repair and SPEC-010's save-time check share one detection
  function (SPEC-010 FR-16) — no second "is this spec complete" predicate is introduced.
- [ ] **(FR-4)** `approve.ts` contains no standalone deterministic-repair/LLM-escalation
  engine; it calls the SPEC-012 FR-15 ladder.

## Invariants (must not break)

- **INV-1 (no silent write).** No automated change to a spec's content is ever written
  without an explicit confirm — the deterministic rung and the LLM rung both
  confirm-before-write (constitution invariant 2; SPEC-005 FR-3; SPEC-012 FR-15).
- **INV-2 (no Tier-0 network call).** Any LLM-escalation repair is dispatched through the
  existing agent-dispatch/consent path (SPEC-010 FR-10/FR-12), never an in-extension network
  call (constitution invariant 1).
- **INV-3 (errors still refuse; warnings still never block on decline).** FR-2 changes what
  happens when a user *accepts* a repair offer; it does not change that a validator *error*
  still refuses approval outright (`approve.ts:281-294`, untouched), nor make a *declined*
  repair into a new blocking gate (constitution invariant 2, both directions).
- **INV-4 (one detector, every caller agrees).** Approve-time completeness and save-time
  completeness (SPEC-010) are never allowed to diverge on whether a given spec is "complete" —
  SPEC-010 FR-16's shared L1 checker is the single source either consults.

## Why no new DR

Every requirement above composes decisions already on the register (DR-012's approval-as-
human-act, SPEC-005's offer-never-silent, SPEC-012's FR-15 ladder, SPEC-010's shared-detector
principle, constitution invariants 1 and 2) rather than making a new one. The one genuinely
new call — DQ-1's "deterministic rung never authors content" rule — is a scoping decision
inside this spec's own FR-2, reversible by editing the allowlist, not a cross-cutting
architectural commitment; it does not clear the DR-359 ADR filter (undoable well inside a day).
If Plan finds DQ-4 Option B necessary after all (a standalone ladder, not a SPEC-012 call), that
would be the point to reconsider — a second repair-ladder implementation is the kind of choice
that is expensive to unwind once callers exist.

## Out of scope

- **Rebuilding SPEC-012's repair ladder or SPEC-010's save-time checker.** This spec is a
  caller of both, once they ship (FR-3, FR-4, DQ-4).
- **SPEC-014's review-webview change-highlight rendering.** DQ-2 ships a plain-text diff for
  v1; adopting SPEC-014's renderer is that spec's own scope, not re-specified here.
- **Re-litigating #93/#103's own resolution.** DQ-3 records this spec's inference from the
  current checkout; confirming or overriding it against the two issues' actual close reasons
  is a human (or a dispatch with network/`gh` access) action, not this spec's.
- **Any change to the confirm-dialog removal or first-approve-hint behavior (FR-1).** Already
  shipped under #104; this spec only guards it with an acceptance criterion.

## Traceability

- **Triggered by** [#104](https://github.com/AIClarityAU/minspec/issues/104).
- **Part 1 (no confirm dialog) and the first-approve-hint** — already shipped, see Context;
  this spec adds no requirement for either beyond FR-1's regression guard.
- **Part 2 (opinionated fix-first)** — this spec's FR-2, the genuinely new scope.
- **Part 3 (shift-left)** — fully owned by
  [SPEC-010](../SPEC-010-signpost-correctness/requirements.md) FR-9..FR-16; this spec's FR-3
  states only the backstop relationship.
- **Depends on** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) FR-15 (the repair
  ladder FR-2 calls) and relates to [SPEC-005](../SPEC-005-auto-structure-repair/requirements.md)
  (the offer-never-silent pattern it follows) and
  [SPEC-014](../SPEC-014-review-webview/requirements.md) (DQ-2's future diff renderer).
- **Amends no DR.** Applies [DR-012](../../../docs/decisions/DR-012.md) (approval as explicit
  human act) and [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (canonical hash /
  derived status) as already written.
- Relates to [#93](https://github.com/AIClarityAU/minspec/issues/93) and
  [#103](https://github.com/AIClarityAU/minspec/issues/103) (re-examined in Context/DQ-3) and
  scroogellm's SCR#2 (the motivating unsafe-auto-fix case, cross-project ref per
  `.minspec/project-prefixes.md`).
