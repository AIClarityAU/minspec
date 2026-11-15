---
id: SPEC-254
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its dispatch-context layer)
aspects: [dispatch, context-budget, token-cost, no-silent-gate, subscription-billing]
depends_on: []
relates_to: ["#2225", "#912", "#1239", "#927"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D1.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-254: Drain dispatches do not load project CLAUDE.md and auto-memory ambiently, and a first-call size check makes a regression visible

> **This is a SPECIFICATION ONLY.** Written for issue #2225. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The #912 fix passes the role file as `--system-prompt-file` so a dispatched agent starts
light. The issue reports that on current Claude Code that only removes the global
`~/.claude/CLAUDE.md`; the project `CLAUDE.md` and auto-memory `MEMORY.md` still arrive as a
first-turn `instructions` attachment (about 45.7K chars, about 14.7K tokens per dispatch, about
14% of drain spend). Nothing noticed, because nothing measures what a dispatch starts with.

## Root-cause diagnosis

Stated by the issue, **not yet verified by this spec** (marked per the evidence-discipline rule):

- The comment at `scripts/dispatch-issue.sh:1128-1155` claims `--system-prompt-file` means
  ambient CLAUDE.md/memory are "not auto-loaded". I believe that is now false for the project
  file and memory, because Claude Code moved them into a first-turn attachment, unverified
  against a changelog.
- Missing gate: no check compares a dispatch's first-call context to a budget, so the fix went
  inert silently (a fourth leak of the shape in #1239; #927 would inherit the same half-effect).
- Evidence offered: 134 transcripts (2026-09-21..30, Claude Code 2.1.278/2.1.283), the latest
  three each with a 45,678-char attachment (`Project` 22,982 + `AutoMem` 20,190). Start date of
  the regression is unknown.

Plan must first reproduce this on the installed Claude Code (FR-1) before any switch is built.

## Functional requirements

- **FR-1 Measure first.** A deterministic probe reports, for a given `claude -p` invocation
  shape, whether the project CLAUDE.md and auto-memory are present in the first turn and the
  first-call input-token count. It reads the session transcript or usage record, not prose.
- **FR-2 Stop the load.** The dispatch invocation uses a subscription-safe mechanism that
  prevents the project CLAUDE.md and auto-memory from loading. Candidates are in D1.
- **FR-3 Auth/billing neutral.** The mechanism MUST NOT force `ANTHROPIC_API_KEY` (so not
  `--bare`; DR-016/017 subscription default).
- **FR-4 First-call budget assertion.** After the first model call of a dispatch, the
  dispatcher compares first-call context tokens to a configured ceiling. Over the ceiling it
  fails visibly: a logged line and a non-zero signal the drain surfaces, never a swallowed
  error. An unreadable usage record also fails closed and visibly, not as a pass.
- **FR-5 Content stays reachable.** The agent can still read CLAUDE.md on demand (the role
  prompt's read step remains valid); nothing the dispatch needs is lost.
- **FR-6 Kill-switch.** The existing `MINSPEC_DISPATCH_SLIM_CONTEXT=0` restore path keeps
  working; a separate switch must not be needed to disable the new mechanism.
- **FR-7 Comment truth.** The stale comment and log line in `dispatch-issue.sh` are corrected
  to state what is and is not suppressed, citing the measurement.
- **FR-8 Shared with #927.** The mechanism is a reusable helper so `remediate-pr.sh` can adopt
  it without re-deriving it.

## Invariants (must not break)

- Offline core: no network call introduced for the check (constitution invariant 1).
- No silent gate: the budget check fails closed and visibly (invariant 2); a second witness
  (transcript-derived size) backs the primary one so one missing field cannot disable it.
- Blast radius: only dispatched worktrees and drain scripts change; no user or machine-wide
  Claude Code config is edited (invariant 3). Any `--settings` file is per-dispatch.
- Subscription OAuth billing is unchanged.

## Acceptance criteria

- AC-1 On the installed Claude Code, a dispatch's first-turn context contains neither project
  `CLAUDE.md` nor `MEMORY.md` content; first-call tokens drop by roughly 14K versus the
  baseline measured in FR-1.
- AC-2 A fixture transcript whose first turn carries a 45K-char `instructions` attachment makes
  the assertion fail visibly; a slim fixture passes; a malformed or empty usage record fails
  closed.
- AC-3 No `ANTHROPIC_API_KEY` is set or required by the dispatch path.
- AC-4 `MINSPEC_DISPATCH_SLIM_CONTEXT=0` still restores the pre-#912 shape.
- AC-5 The FR-7 comment no longer claims more than the measurement shows.

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

**D1 — How to stop the load.**

**Recorded selection: Option (a),** a per-dispatch `--settings` file plus env that disables
auto-memory and excludes the project CLAUDE.md.

- **(a) (rec) Per-dispatch `--settings` file plus env** disabling auto-memory and excluding the
  project CLAUDE.md. Cost: which keys exist is unverified and undocumented settings can change
  between Claude Code releases; FR-4 is what makes such a change visible.
- (b) Accept the load and drop the role prompt's "Read CLAUDE.md" step. Cost: about 14.7K
  tokens per dispatch remain; removes only the double payment.
- (c) `--bare`. Rejected: forces `ANTHROPIC_API_KEY`, breaking FR-3.

**D2 — Budget ceiling and failure action.** Ceiling value (suggest the measured slim baseline
plus a margin, set at Plan from FR-1) and whether over-budget aborts the dispatch or only
flags it. **(rec)** flag-and-label first, abort once the baseline is stable. Cost: a regression
still spends tokens until the label is acted on.

**Recorded selection: Option (flag-and-label first),** an over-budget dispatch is flagged and
labelled first, and aborted only once the baseline is stable; the ceiling (the measured slim
baseline plus a margin) is set at Plan from FR-1.

**D3 — Does the invariant content need to reach the agent?** If CLAUDE.md is no longer
ambient, the agent depends on reading it. **(rec)** keep the explicit read (FR-5). Cost: the
agent pays for the file once, on demand, instead of never.

**Recorded selection: Option (keep the explicit read),** keep the explicit read of CLAUDE.md
(FR-5), so the agent pays for the file once, on demand.

## Alternatives rejected

- Do nothing: the cost recurs on every dispatch and the gap stays invisible.
- Rely on prose in the comment: prose cannot detect a Claude Code release changing behaviour.

## Follow-ups (tracked)

- #927 (remediate-pr.sh slim context) adopts the FR-8 helper once built.
- #1239 (dispatch context budget): FR-4 may be its fourth instance; Plan decides whether to fold.
