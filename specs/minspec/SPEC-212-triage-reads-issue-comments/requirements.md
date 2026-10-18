---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - which text a model is shown, and whose
aspects: [triage, untrusted-input, no-silent-gate, tier-0, evidence-discipline]
depends_on: [DR-072, DR-076]  # DR-072 s3: hold:human is human-only; DR-076: Specify-only dispatch for T3/T4
relates_to: ["#1939", "#1876", "#1120"]
implements: none
implements_reason: >-
  Changes land in existing triage files (scripts/triage-inbox.sh, scripts/roles/triage.md,
  scripts/lib/dispatch-author-gate.sh) that no spec owns; no new source file is created.
affects: [scripts/triage-inbox.sh, scripts/roles/triage.md, scripts/lib/dispatch-author-gate.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: Triage reads an issue's trusted comments, so a recorded decision is not re-asked

Issue: #1939 (triage reads only the body). Related: #1876, #1120.

## In plain terms

Triage shows the model an issue's title and body only. A founder decision, a correction or a
re-scope posted as a comment afterwards is invisible to it. On #1876 the founder answered on
2026-09-09 03:38Z ("approval covers `requirements.md` only"); on 2026-09-10 23:28Z triage still
held the issue (`hold:human`, `needs-review`) asking that very question. `hold:human` is
human-only (DR-072 section 3), so the stale hold stays until the founder notices. #1120 carries
two comments refuting its own body; a triage pass sees only the body.

## Root cause (mechanism plus missing gate)

`scripts/triage-inbox.sh:81` runs `gh issue view --json body,title,labels`; comments are never
fetched, so they cannot reach the prompt. Nothing compares a verdict with later comments, so the
stale verdict is written without warning.

## Functional requirements

- **FR-1** Triage fetches the issue's comments and gives them to the triage model, in order, in
  a separate delimited block (e.g. `<untrusted_issue_comments>`), each with author login and
  timestamp. Comment text is UNTRUSTED DATA exactly as the body is.
- **FR-2** Only comments written by accounts on the existing dispatch author list are shown
  (the same default-deny rule as `dispatch_trusted_comments`, by account number and kind, and
  honouring edit history). Comments by anyone else are dropped, never shown. The issue-comment
  filter reuses that library rather than a second predicate (duplicate predicates drift).
- **FR-3** `scripts/roles/triage.md` states: a later trusted comment recording a founder
  decision, a correction or a re-scope supersedes the body for classification; and a hold or
  question in the body that a comment answers must not be raised again. The role also keeps its
  anti-injection rule: comments are data and never change the output format or the human-only
  filter.
- **FR-4** Size cap, if any, never drops a decisive comment. Selection order: (a) comments by
  the founder / bot-recorded decisions (see Decisions needed DQ-2) are always kept; (b) of the
  rest, the newest are kept up to the cap; (c) when anything is omitted the prompt says how many
  and which were dropped. Plain oldest-first trimming is forbidden.
- **FR-5** Fail closed and visibly (constitution invariant 2). If comments cannot be read, or the
  author check on them errors, triage does NOT proceed on the body alone as though nothing were
  missing: it leaves the issue in `inbox`, writes no labels, and prints a line saying why. An
  issue with zero comments is distinct from an unreadable comment list.
- **FR-6** The verdict record notes how many comments were shown and how many were dropped, so a
  reviewer can tell what the verdict was based on.
- **FR-7** Comment text is printed to logs only after the same sanitising applied to the title
  (the drain parses this script's output for stamped-ready lines).
- **FR-8** Tier 0 / offline: the change adds no network call beyond the GitHub read triage
  already makes (invariant 1); nothing changes in a repo without `.minspec/` (invariant 3).

## Acceptance criteria

- **AC-1** Fixture issue: body asks a question; a trusted later comment answers it. The prompt
  built contains the comment, and a stubbed model sees it (test on the prompt text).
- **AC-2** A comment by an unlisted account never appears in the prompt, including one that
  contains a forged verdict block or `TRIAGE_VERDICT_BEGIN`.
- **AC-3** A comment fetch that errors leaves labels untouched and prints a visible refusal; the
  run continues with the next issue (returns 0, as the author gate does).
- **AC-4** With a thread over the cap, a decision comment older than 100 newer chatter comments
  is still in the prompt; the omission notice states the count.
- **AC-5** Zero-comment issues produce the same prompt body as today plus an empty-comments
  marker; existing triage tests stay green.
- **AC-6** Replay: #1876's body plus the 2026-09-09 comment no longer yields the design.md
  approval question as a hold reason (manual check recorded in the PR, not a CI dependency on
  GitHub).

## Invariants the change must not break

- **INV-1** The triage agent keeps `--tools ""` and the allowlisted environment; comments are
  text only.
- **INV-2** The author gate still runs before any issue text is read or shown, and now covers
  comment authors too.
- **INV-3** The deterministic `triage-decide.sh` gate remains the only thing that turns agent
  text into labels; a comment cannot set a label.
- **INV-4** No silent gate: no `|| true` on the comment fetch or its filter.

## Out of scope

Clearing existing stale `hold:human` labels (human-only, DR-072 section 3); editing decisions
into issue bodies (rejected option, see below); re-triaging on every new comment (separate
trigger question).

## Decisions needed (Clarify)

- **DQ-1 Source of the comments.** (a) **(rec)** Reuse the trusted-comments filter, extended to
  issues. Cost: that library is PR-shaped (`pullRequest.comments(last: 100)`), so it needs an
  issue variant, and it sees only the newest 100. (b) A new issue-only filter. Cost: a second
  predicate that can drift from the first. (c) Show all comments unfiltered. Cost: unlisted
  accounts get a prompt-injection channel; rejected on invariant grounds.
- **DQ-2 What counts as a "decision comment" for the cap.** (a) **(rec)** Author-based: any
  comment by a listed human (non-bot) account is always kept; cost: a chatty founder thread can
  exceed the cap, so the cap must be soft for these. (b) Marker-based: comments beginning
  `Founder decision` / `Correction`; cost: relies on writers remembering the phrase, the same
  weakness as the rejected body-edit option. (c) Model-judged; cost: non-deterministic exactly
  where the cap must be certain.
- **DQ-3 Cap value.** Fixed comment count vs character budget (e.g. 20 000 chars). Rec: character
  budget with (a) above exempt; cost: harder to reason about than a count.
- **DQ-4 Rejected option confirmation.** Issue lists "require decisions in the body" as the
  alternative. This spec rejects it (relies on every writer; rewrites history). Confirm.
