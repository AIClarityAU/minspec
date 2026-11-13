---
id: SPEC-297
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; two drain PRs taking one spec id is that problem
aspects: [spec-id, allocation, concurrency, dispatch, no-silent-gate, fail-closed, ci-gate]
depends_on: [DR-066, DR-076]  # DR-066 fail-closed gates; DR-076 solo-mode ceremony (model-defending gates stay)
relates_to: [SPEC-227, "#3236", "#3164", "#3378", "#1327", "#1418", "#2055", "#3199", "#3201", "#3202", "#3203", "#3205"]
implements: none
implements_reason: >-
  Which files this spec owns is fixed at Plan. Expected shape only: scripts/dispatch-issue.sh
  (publish-time guard and fallback), scripts/lib/spec-id-claims.ts (reuse), a new guard test.
  SPEC-227 owns the allocator and cross-PR gate; this spec adds no second allocator.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-297: A drain PR cannot be published under a spec id another PR or `main` already holds

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3236](https://github.com/AIClarityAU/minspec/issues/3236). Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Five drain pull requests (#3199, #3201, #3202, #3203, #3205) each added a spec under a number
that `main` or a sibling PR already held, and failed the required validation check with
"Spec id duplicate". The numbers were fixed by hand (SPEC-275 to SPEC-279).

The allocator half of this is already specified in SPEC-227 and partly shipped
(`scripts/next-spec-id.ts`, #3164). It hands a Specify dispatch a number computed over `main`,
every open PR, every local ref and a per-machine claim. What is still missing is that nothing
**checks the result before the PR is published**: the number reaches the agent as prose, the
agent may write a different one, and the lookup failing silently degrades to the old blind
wording. This spec closes that gap by enforcing the number instead of trusting the prompt.

## One-Sentence Scope

Before the dispatcher publishes a Specify-only branch, verify every spec id the diff adds is
either the id reserved for this dispatch or already held by an existing spec of this issue, and
refuse to publish otherwise; and make an allocator failure stop the dispatch instead of
falling back to a blind read.

## Context - what the code does today (read at `origin/main` `719ba037`, 2026-11-12)

I believe the following, each checked in the cited file:

- The reserved id is computed in `scripts/dispatch-issue.sh:1479-1488` and only embedded in the
  prompt text (`SPEC_ID_TEXT`). Nothing later compares the diff's id with it.
- When the lookup fails, `dispatch-issue.sh:1486-1487` prints a warning and **keeps going** with
  "the next unused number" - the agent then reads its own worktree, which is exactly the blind
  read that produced the duplicates. That is a fail-open on a gate (constitution invariant 2).
- The scope guard `specify_scope_stray` (`dispatch-issue.sh:631`) checks paths are inside the
  spec corpus. It does not look at ids.
- The PR-time cross-PR check runs inside the `dr-id-collision` job (#1327), which is advisory:
  it is not in `main`'s required set, so a duplicate surfaces only when the required
  `MinSpec SDD validation` job fails on the merge ref (Rule 18, one tree).
- Claims are per machine (`next-spec-id.ts` header, "LIMIT").

### Root cause (mechanism plus missing gate)

The mechanism is allocation by prose: the id is a suggestion in a prompt, so an agent that
ignores it, miscounts, or ran when the lookup had failed picks one from its own checkout.
The missing gate is at the one deterministic point between agent exit and publish; the existing
guard there is path-only.

I have not re-derived which of the five original PRs predate #3164; the claim that some were
allocated before the allocator landed is **unverified**, and the Plan phase should check it
because it decides whether FR-1 alone would have prevented them.

## Functional Requirements

- **FR-1 (publish-time id guard).** After a Specify-only agent exits and before any push, the
  dispatcher computes the spec ids the committed diff **adds** (new `SPEC-NNN` directories under
  `specs/`, and any changed `id:` frontmatter). Each must be (a) the id reserved for this
  dispatch, or (b) an id whose directory already existed on the branch's base for this same
  issue. Anything else refuses publication, exactly as `specify_scope_stray` does.
- **FR-2 (re-check against the live set).** The guard also re-reads `main` and open PRs
  (reusing `lib/spec-id-claims.ts` and `lib/open-pr-spec-claims.ts`) and refuses if the id is
  held there by a different PR, since a sibling can publish while this agent runs.
- **FR-3 (fail closed on allocator failure).** If `next-spec-id.ts` exits non-zero or prints
  anything but `SPEC-<digits>`, the Specify dispatch does not launch the agent; the issue is
  returned to the queue with a visible reason. The blind fallback wording is removed.
- **FR-4 (visible refusal).** A refusal names the offending id, who holds it, and the next free
  id, and is recorded where the dispatcher records other publish refusals. No `|| true`, no
  swallowed error.
- **FR-5 (no id reuse).** Ids already taken by hand-renumbering (SPEC-275 to SPEC-279) and any
  other id present on `main` or an open PR are never offered again. This follows from the
  allocator's max-plus-one and is stated so a test pins it.
- **FR-6 (existing duplicates).** The issue lists about 10 further open PRs said to share ids.
  The Plan phase must re-measure which are still open and still duplicated at that time (the
  list in the issue is stale by the time this is read) and file or perform the renumbers
  through the normal PR path; this spec does not renumber them.

## Acceptance Criteria

- **AC-1.** A fixture diff adding `SPEC-263-x` while `main` holds SPEC-263 is refused; the
  refusal text contains `SPEC-263` and the next free id.
- **AC-2.** A fixture diff adding exactly the reserved id passes.
- **AC-3.** A fixture diff adding an id held by a different open PR is refused (FR-2).
- **AC-4.** With `next-spec-id.ts` stubbed to exit 1, the dispatcher does not start an agent and
  exits non-zero with a visible message (FR-3). The test fails against the current fallback.
- **AC-5.** A diff that edits an existing spec of this issue under its own id passes.
- **AC-6.** If the guard's own lookup errors, publication is refused, not allowed.

## Invariants (must not break)

1. Offline core (constitution invariant 1): all of this is dev-time dispatch machinery in
   `scripts/`; nothing is added to the Tier-0 extension.
2. No silent gate (invariant 2): the guard fails closed on a missing or errored witness.
3. Blast radius (invariant 3): applies to this repo's dispatcher only.
4. SPEC-227's allocator, claim files, and Rule 18 are unchanged; this is a second witness.

## Out of Scope

- A second allocator, or changing claim semantics (SPEC-227).
- Cross-machine claims (still a stated limit in `next-spec-id.ts`).
- Making `dr-id-collision` a required check (SPEC-227 DQ-3 owns that choice).
- Dispatch paths that are not Specify-only.

## Decisions needed (Clarify)

Recorded selections: each of the 2 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

### DQ-1 - On a guard refusal, retry or hand to a human?

- **(a) (rec) Renumber and re-run once automatically**, then refuse if still failing. Cost: a
  rewrite of ids and `id:` references inside the agent's own spec is itself a mechanical edit
  that could mis-rewrite a cross-reference; needs a test over SPEC-NNN mentions.
- **(b) Refuse and route the issue to a human.** Cost: every collision becomes human work,
  against tenet 1 (make the founder's job smaller).

**Recorded selection: Option (a),** renumber and re-run once automatically, then refuse if the guard still fails. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### DQ-2 - Should an allocator failure stop the dispatch (FR-3)?

- **(a) (rec) Yes, return to queue.** Cost: an allocator or network outage idles Specify
  dispatches until it recovers.
- **(b) Keep the blind fallback, rely on FR-1 at publish.** Cost: wasted agent tokens on a spec
  that will be refused (tenet 2), though no wrong id can be published.

**Recorded selection: Option (a),** yes, an allocator failure stops the dispatch and returns the issue to the queue. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

Neither option has been chosen by a human.

## Traceability

Issue #3236. Related: SPEC-227 (allocator and cross-PR gate), #3164 and #3378 (allocator
shipped), #1327 (CI check inside `dr-id-collision`), #1418 (Rule 18). No new DR: the guard is
reversible in under a day.
