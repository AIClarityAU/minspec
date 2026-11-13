---
id: SPEC-317
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the spec-to-build hand-off
aspects: [dispatch, approval, routing, visibility, fail-closed]
depends_on: []
relates_to: ["#3350", "#3348", "#3351", "#3282", "#1084", "#983", "DR-076", "DR-108", "DR-119", "SPEC-296"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `scripts/lib/delegated-approval-caller.ts` (or a sibling router it calls),
  `scripts/drain-inbox.sh`, `scripts/approve-issue.sh` (shared verdict writer), and new tests.
  None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-317: A signed-off spec routes its waiting issue to a build, and an approved spec with no build path is visible every cycle

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3350](https://github.com/AIClarityAU/minspec/issues/3350). Nothing is built until this spec
> is approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> Follows the #3348 fix (#3351 review): a specify-only run now leaves its issue open, labelled
> `agent-done` + `awaiting-spec-signoff` (`scripts/dispatch-issue.sh:3013-3040`). Nothing consumes
> that label. Per the issue, 48 approved specs wait on this route.

## Problem

After a human signs off a spec, no step turns the waiting issue into a build. The issue sits
with `agent-done` (which countermands dispatch) and `awaiting-spec-signoff`; the only exit is a
human running `scripts/approve-issue.sh`, which is interactive-only by design (#1084). Worse,
if the issue is lost, closed, or never linked, an approved spec has no build path and nothing
says so: a silent gate (constitution invariant 2).

## Functional requirements

- **FR1 - Find the waiting issue.** When an approval is recorded (by the delegated-approval
  caller or by the editor's Approve Spec), the router finds the open issue that (a) carries
  `awaiting-spec-signoff` and (b) was referenced by the merged spec PR for that spec. The link
  is read from the spec PR's recorded issue reference, never guessed from titles or label alone.
  Zero or more than one match is a named, visible outcome, never a silent pick.
- **FR2 - Release the hold.** For exactly that issue, remove `agent-done`, `awaiting-spec-signoff`
  and `hold:specify`.
- **FR3 - Route to a build.** Write a verdict record with hold `none` bound to the issue body's
  sha256, plus `agent-ready`, in the same shape `approve-issue.sh` writes, so
  `dispatch-ready-check.sh` accepts it by the same path as any other build verdict. The router
  holds no dispatch policy of its own.
- **FR4 - Honour #3282.** Triage sends a build issue naming an already-approved spec to the
  specify queue as `built-spec`. The router's build verdict must survive that rule: it must be
  written after sign-off, and re-triage of the same body must not undo it. The router never
  routes an issue whose named spec is `done`.
- **FR5 - Idempotent and ordered.** Running twice on one approval is a no-op. Labels and the
  verdict record are applied so that a crash between steps leaves the issue still findable
  (`awaiting-spec-signoff` is removed last, after the verdict is written).
- **FR6 - Fail closed, loudly.** If labels, the PR reference, the issue body or the open-issue
  list cannot be read in full, the router routes nothing for that spec and reports the spec by
  name. A failed label write is surfaced, not swallowed with `|| true`.
- **FR7 - Visible gate.** A drain-cycle check in `scripts/drain-inbox.sh` prints every spec whose
  status is `planning` or `implementing` that no open issue or open PR names, one line per spec,
  every cycle. A check that cannot read specs, issues or PRs prints that it could not, and
  does not report "none".
- **FR8 - Router and gate agree.** The "names a spec" predicate used by FR1/FR7 is one shared
  function, so the router and the visible gate cannot drift (duplicate predicates drift).

## Acceptance criteria

1. A merged spec PR plus a recorded approval turns its `awaiting-spec-signoff` issue into one
   that `dispatch-ready-check.sh` accepts, with no `agent-done` / `hold:specify` left.
2. An issue with no spec PR reference, or two candidates, is left untouched and named in output.
3. A `done` spec's issue is never routed (FR4).
4. A spec in `planning` with no issue or PR naming it appears in the drain output; naming it in an
   open issue removes it. A forced read failure prints an error, not an empty list.
5. Re-running after success changes nothing.
6. Tests cover each FR with a mutation-sensitive fixture (vary count of candidates, not only content).

## Invariants the change must not break

- Invariant 1 (offline): MinSpec the extension makes no network call; the router is dev-time
  `scripts/` tooling like the caller.
- Invariant 2 (no silent gate): FR6 and FR7.
- Invariant 3 (blast radius): runs only in a repo with `.minspec/`.
- `hold: human`, `info`, `unknown` are never released (DR-072 section 3 as enforced by
  `dispatch-ready-check.sh --may-approve`); the router refuses an issue whose last verdict has
  any of those.
- The verdict is bound to the body hash: an edited issue goes stale, as in #983.

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

1. **Who may mint the build verdict?** `approve-issue.sh` deliberately refuses non-TTY and bot
   actors so the pipeline cannot forge the human keystroke.
   - **(rec) Router writes a distinct record kind** (e.g. `minspec-spec-signoff/1`) naming the
     approval it derives from, which `dispatch-ready-check.sh` accepts only when that approval
     is a current, passing sidecar on main. Authority comes from the human's spec sign-off, and
     is not a borrowed identity. Cost: new record type and a reader change in the dispatch gate
     (machinery, human-merged).
   - Reuse `minspec-human-approval/1` as the bot. Cost: re-opens exactly the forgery #1084
     closed; rejected.
   - Leave the final step human (router only prompts). Cost: 48 specs stay waiting and the
     tenet-1 goal is not met.

   **Recorded selection: the recommended option,** the router writes a distinct record kind (e.g. `minspec-spec-signoff/1`) naming the approval it derives from. An agent session copied this document's (rec) option; no human chose this item.
2. **Delegated approvals** (DR-108/DR-119, bot-recorded) vs human Approve Spec: should both
   route? **(rec) Both**, since both are valid sign-off; cost: delegated routes depend on
   SPEC-296's merge lane being live.

   **Recorded selection: the recommended option,** both delegated and human sign-offs route. An agent session copied this document's (rec) option; no human chose this item.
3. **Where does the router run?** **(rec)** As a step of the drain cycle, reconciling by state
   (finds all waiting issues each cycle), not as an event hook on the approval; cost: build
   starts up to one cycle late. An event hook is faster but misses approvals recorded while
   it was down.

   **Recorded selection: the recommended option,** the router runs as a step of the drain cycle, reconciling by state. An agent session copied this document's (rec) option; no human chose this item.
4. **Backlog of 48:** route automatically on first run, or require a one-time dry-run report
   first? **(rec) Dry-run report first**; cost: one extra cycle.

   **Recorded selection: the recommended option,** a dry-run report first for the backlog. An agent session copied this document's (rec) option; no human chose this item.
