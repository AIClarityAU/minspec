---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
aspects: [ai-review, backfill, auto-drain, no-silent-gate, offline, blast-radius]
relates_to: [SPEC-031, DR-047, DR-081, DR-076, SPEC-062]  # SPEC-031 ships the forward reviewer and defers backfill here (its line ~258) · DR-047 bounded author loop · DR-081 approval-record exemption · SPEC-062 autonomous drain
---

# MinSpec - Backfill scan: re-review "done" work that never got an ai-review verdict (Requirements)

> **SPECIFICATION ONLY.** No code, script or test is created by the dispatch that produced
> it. A human reads it, resolves the Clarify questions, and approves it before anything is
> built.

Materializes **#455** (AIClarityAU/minspec): *"backfill scan - re-review 'done' issues/PRs
that never got ai-review:pass + auto-dispatch fix"*. Rests on **DR-047** (independent review
across every Approvable; §1 bounded author loop, default 2 cycles then `agent-escalated`).
SPEC-031 shipped the forward-going reviewer and explicitly left backfill as "its own run";
this is that run. Related: #342/#418 (`review-pr.sh`), #362 (earlier backfill note), #417/#419
(forward-gate hardening), #390 (`ready-to-merge` required), #199/#412 (merge eligibility).

## One-Sentence Scope

A standing, opt-in sweep run from the existing `drain-inbox.sh` session-start pattern finds
issues and PRs that are done or merged yet carry **no** `ai-review:*` verdict, runs
`review-pr.sh` on each, and on `ai-review:changes` dispatches the bounded fix loop to the
author agent - recording coverage only, never deciding merge.

## Context

DR-047 began as a manual retroactive audit of merged PRs that found 7 live defects
(#344-349) a human had rubber-stamped. Nothing sweeps for that gap today: `review-pr.sh`
runs only when invoked, and the forward gate cannot see work that predates it or slipped
past it. Distinct from `ai-review:changes` left unresolved - that already ran.

> Scope note: the issue title says "sealbox", but `review-pr.sh`, `dispatch-issue.sh` and
> `drain-inbox.sh` live in this repo's `scripts/`; this spec targets those. See DQ-1.

## Functional Requirements

- **FR-1 Candidate query.** The scan lists (a) issues labelled `agent-done` with no
  `ai-review:*` label, and (b) PRs - open or merged within a configurable window - with
  neither `ai-review:pass` nor `ai-review:changes`. A PR bearing `ai-review:changes` is
  never a candidate (it ran). Approval-record PRs exempt under DR-081 are not candidates.
- **FR-2 Coverage evidence, not label alone.** A candidate is "covered" only when a
  `review-pr.sh`-posted findings comment exists, since labels are hand-addable (#397). A
  `ai-review:pass` label with no findings comment is a candidate (flagged "label without
  witness"). *(See DQ-3.)*
- **FR-3 Review.** For each candidate run `review-pr.sh <n>` using whatever coverage mode
  is configured; this spec defines no coverage mode of its own.
- **FR-4 Fix dispatch.** On `ai-review:changes`, dispatch the `dev` role via
  `dispatch-issue.sh` to the author agent, bounded to 2 cycles, then label `agent-escalated`
  (DR-047 §1). A human-authored artifact with no author agent escalates straight to the
  human; the scan never dispatches a fix onto human work.
- **FR-5 Merged PRs.** A merged PR cannot be amended: a `changes` verdict on one files a
  follow-up fix issue (linked to the PR) rather than pushing to it, and that issue then
  enters FR-4. *(See DQ-2.)*
- **FR-6 Cadence and opt-in.** Runs from the `drain-inbox.sh` session-start hook, gated by
  a separate opt-in pref (gitignored, machine-local, like `.minspec/auto-drain`). No new
  daemon; candidates processed sequentially under the subscription-quota constraint, with a
  per-run cap on reviews.
- **FR-7 Idempotence.** Re-running never re-reviews a candidate that now carries a verdict,
  and never double-dispatches a fix for the same artifact+cycle.
- **FR-8 Visible failure.** A review that errors, times out or is truncated leaves the
  candidate uncovered and reports it in the run summary; it is never silently counted as
  pass (`review-pr.sh`'s truncation backstop stands).
- **FR-9 Opt-in blast radius.** The scan runs only where `.minspec/` exists and the pref is
  set; it ships nothing to adopter repos.

## Acceptance Criteria

- **AC-1** Fixture set (agent-done issue without verdict; PR with `changes`; PR with
  `pass`+comment; PR with `pass` label only; merged PR without verdict): the query returns
  exactly the first, fourth, fifth.
- **AC-2** `changes` verdict on an agent-authored artifact dispatches a fix; after 2 cycles
  still `changes` -> `agent-escalated`, no third dispatch.
- **AC-3** Human-authored artifact with `changes` -> escalated, no dispatch.
- **AC-4** Pref absent -> the session-start hook performs zero network and zero review calls.
- **AC-5** Second run over the same state performs no review and no dispatch.
- **AC-6** Reviewer failure for one candidate does not stop the rest, and appears in the
  summary as uncovered.
- **AC-7** The scan never merges, labels `ready-to-merge`, or approves anything.

## Invariants (must not break)

1. **Offline/consent** - no network call without the explicit opt-in pref (constitution 1).
2. **No silent gate** - failures visible; not best-effort `|| true` (constitution 2).
3. **Blast radius** - only repos with `.minspec/` that opted in (constitution 3).
4. **Reviewer has no tools; the credentialed parent applies labels** - unchanged from
   `review-pr.sh`; the scan adds no path for an injected "pass".
5. **No merge decisions** - coverage onto record only.

## Out of scope

Per-dev coverage pref / adversarial panel design (separate issue; consumed once it lands);
auto-merge (#199/#412); forward-gate provenance (#417/#419/#428).

## Decisions needed (Clarify)

- **DQ-1 Where does it live?** (a) **(rec)** a new `scripts/` helper called from
  `drain-inbox.sh`, in this repo - cost: grows an already very large script's surface.
  (b) in SealBox/`agent-execute` as the issue title says - cost: cross-repo, and the
  runners it needs are here.
- **DQ-2 Merged PRs.** (a) **(rec)** file a follow-up fix issue - cost: issue noise.
  (b) report only, no dispatch - cost: defects found but unfixed. (c) open a revert PR -
  cost: too aggressive for an advisory sweep.
- **DQ-3 What counts as coverage?** (a) **(rec)** findings comment exists (label alone
  insufficient) - cost: pre-#397 passes get re-reviewed once, spending quota. (b) label
  alone - cost: forgeable, repeats the hole.
- **DQ-4 Backfill window and cap.** Default look-back (suggest 30 days) and per-run cap
  (suggest 5). Larger window = fuller coverage but heavier first run on quota.
- **DQ-5 Author-agent identification.** How the scan recognises an agent-authored artifact
  (branch prefix `agent/`, or a label) - needs the human's choice of the authoritative
  signal.

## Follow-ups (tracked)

None beyond DQ resolution; the coverage-mode dependency is the separate per-dev panel issue
named in #455.
