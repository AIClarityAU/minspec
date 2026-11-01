---
id: SPEC-245
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (the issue ranker orders its queue)
aspects: [ranking, triage-verdict, trust-boundary, no-silent-gate, offline]
depends_on: []
relates_to: ["#2198", "#2196", "#983", "#1084", "#1113", "#1169", DR-072, DR-076]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-245: The issue ranker reads the tier from the trusted triage verdict, not from the ready-class label

> **This is a SPECIFICATION ONLY.** Written for issue #2198. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## Problem

The issue ranker (`scripts/rank-issues.ts`, pure core `scripts/lib/issue-rank.ts`, #2196) orders
candidates by: unblocks (desc), spec/epic structural rank, then **tier** (term 3, quick wins first),
then issue number.

The tier it uses comes from `tierFromLabels` (`scripts/lib/issue-rank.ts:372`): `agent-ready` maps to
`T1-T2`, `agent-ready-specify` maps to `T3-T4`. The pure core already prefers an exact tier when
`ctx.tiers` supplies one (`issue-rank.ts:627-628`), but the shell never supplies it, so the label
stand-in is always used.

The stand-in is wrong for one known group: a T3/T4 issue a human approved (`scripts/approve-issue.sh`,
`minspec-human-approval/1`, lifting a `tier`/`specify` hold per DR-072 §3) carries `agent-ready`, so it
ranks as a quick win. 9 open issues sit on `hold:tier` at the time of writing (measured by the issue's
author, not re-measured here); each joins that group on approval.

The exact tier lives only in the verdict record, a comment on the issue. The trust rules that decide
which record counts (trusted comment author, newest `verdictAt`) live in `scripts/dispatch-ready-check.sh`
(`--trusted-comment-bodies`, `--newest-record`, and the reader's schema/field checks). Re-implementing
them in the ranker would create a second copy of a trust decision, which is the duplicate-predicate drift
class this repo has been bitten by.

## Scope

In: a loader that supplies `ctx.tiers` to the ranker from the same verdict-selection code the dispatch gate
uses; a loud labelled fallback to the label stand-in when no trusted verdict exists.

Out: changing the ranking order or the pure core's comparison; changing what the dispatch gate admits or
refuses; changing the verdict record grammar; ranking by anything other than tier.

## Functional requirements

- **FR-1 Exact tier when a trusted verdict exists.** For every ranked candidate with a trusted, well-formed
  verdict record (triage `minspec-triage-verdict/1` or human `minspec-human-approval/1`), the ranker's tier
  is that record's `tier` value, passed through `ctx.tiers`. The ranking core's comparison is unchanged.
- **FR-2 One copy of the trust decision.** The selection of which comment bodies are trusted and which
  record is newest is performed by the code `dispatch-ready-check.sh` already uses, factored so the ranker
  and the dispatch gate both call it. No second implementation of the trusted-author rule, the
  newest-`verdictAt` rule, or the record field parser may exist in the ranker.
- **FR-3 Tier-only read; no gate semantics.** The ranker reads only the `tier` field. It does not re-decide
  dispatchability: a stale `bodyHash`, an unlifted hold, or a bot approver does not change what the ranker
  *shows*, and the dispatch gate remains the sole authority on whether to build (#983). Ranking is an order,
  not a gate.
- **FR-4 Loud fallback.** When no trusted verdict exists for a candidate (no record, untrusted authors only,
  malformed record, unrecognised tier value), the ranker falls back to `tierFromLabels` AND reports it: the
  per-row tier reason says the tier is a label stand-in and why, and the run's summary states the count of
  fallback rows. A fallback is never silent.
- **FR-5 Source is visible per row.** The tier reason distinguishes `(triage verdict)`, `(human approval)`
  and `(label stand-in: <reason>)`, so a reader can see which rows were not measured.
- **FR-6 Verdict fetch failure is not a silent fallback.** If fetching comments for a candidate fails
  (network, auth, rate limit), the ranker states the failure and treats that candidate as fallback with the
  reason `verdict fetch failed`. If fetching fails for all candidates it exits non-zero rather than printing
  an all-fallback table that looks like a normal ranking (invariant 2).
- **FR-7 Bounded cost.** Comments are fetched for candidates only (not every open issue), in a bounded number
  of requests (batched, or paginated GraphQL with the existing `NESTED` limits, see Decision D2). The
  ranker's existing pure-core / thin-shell split is kept: the loader is the shell; the pure core stays
  unit-testable offline.
- **FR-8 Approved-T3/T4 outranked correctly.** A candidate labelled `agent-ready` whose newest trusted
  record says `T3` or `T4` sorts with T3/T4, after an `agent-ready` candidate whose record says `T1` or `T2`,
  all else equal.

## Acceptance criteria

- **AC-1** (FR-1, FR-8) Two `agent-ready` candidates tied on unblocks and spec rank, one with a trusted
  record `tier: T4`, one `T2`: the T2 sorts first, and the T4 row's tier reason says `T4 (human approval)`
  or `T4 (triage verdict)`.
- **AC-2** (FR-2) A test forges a record by an untrusted author with `tier: T1` on a T4 issue: the ranker
  shows the trusted record's tier (or the fallback), never the forged one. The same fixture, run through
  `dispatch-ready-check.sh`'s own entry points, yields the same selection (shared code, proven by one
  fixture driving both).
- **AC-3** (FR-2) A quoted older record inside a later comment does not win over the newest `verdictAt`
  (the #1113 case) in the ranker's selection.
- **AC-4** (FR-4, FR-5) A candidate with no trusted record falls back to the label tier and its row reads
  `label stand-in` with a reason; the summary line counts fallbacks.
- **AC-5** (FR-6) A simulated comment-fetch failure on one candidate yields a stated fallback for that row;
  on all candidates yields exit non-zero with a message naming the failure.
- **AC-6** (FR-3) A record with a mismatched `bodyHash` still supplies its tier to the ranker, and the
  dispatch gate still refuses it (`stale-verdict`) — the two stay independent.
- **AC-7** (FR-1) Factoring does not change `dispatch-ready-check.sh` behaviour: its existing test suite
  passes unmodified.

## Invariants this must not break

- **Offline core (invariant 1).** The pure ranking core and the record parsing make no network call; only
  the existing `gh`-calling shell does, as it does today. No new network consumer is introduced beyond
  fetching comments through the same `gh` path.
- **No silent gate (invariant 2).** The fallback is loud (FR-4); fetch failure is visible (FR-6); the
  ranker is not a gate and must not become a second, weaker one (FR-3).
- **Blast radius (invariant 3).** Dev-time `scripts/` of this monorepo only; nothing ships to an adopter.
- **Trust boundary (#983, DR-072, #1113).** A label stays a stamp, never the verdict; the trusted-author
  and newest-record rules keep exactly one implementation.
- **Dispatch gate unchanged.** `dispatch-ready-check.sh`'s outputs, exit codes and refusal codes are
  byte-identical after the factoring.

## Decisions needed (Clarify)

All 4 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

- **D1 — Where the shared parsing lives.**
  **Recorded selection: Option (a),** add a `--tier` style entry point to
  `dispatch-ready-check.sh` and have the ranker shell call it, so one file owns the grammar.
  - (a) **(rec)** Add a `--tier` style entry point to `dispatch-ready-check.sh` (it already hosts
    `--trusted-comment-bodies`, `--newest-record`, `--render-*`, `--may-approve`), and have the ranker shell
    call it. One file owns the grammar; costs a subprocess per candidate and keeps the bash script growing.
  - (b) Extract the selection into a sourced `scripts/lib/*.sh` used by both. Cleaner file boundary; costs a
    larger refactor of a security-sensitive script, which FR-2/AC-7 then must prove byte-identical.
  - (c) Port the selection to TypeScript. Natural for the ranker; costs a second implementation of a trust
    decision, which this spec exists to avoid. Not recommended.
- **D2 — How comments are fetched.**
  **Recorded selection: Option (a),** extend the ranker's existing paginated GraphQL query with
  `comments` (author type, association, body) for candidates.
  - (a) **(rec)** Extend the ranker's existing paginated GraphQL query with `comments` (author type,
    association, body) for candidates: one query path, bounded. Costs larger payloads and a GraphQL shape
    that differs from the `gh issue view --json comments` shape `--trusted-comment-bodies` expects, so an
    adapter is needed and must be tested for equivalence.
  - (b) One `gh issue view <N> --json comments` per candidate. Same shape the gate already consumes; costs N
    requests (88 ready issues were pending at the time of writing) and rate-limit exposure.
- **D3 — Fallback policy when the label and a trusted record disagree on class.** E.g. label `agent-ready`
  but record `tier: T4` (the target case) is the *correct* outcome of FR-1. The open question is a record
  that says `T1` while the label is `agent-ready-specify`.
  **Recorded selection: Option (a),** trust the record's tier unconditionally, since ranking is
  an order, not a gate.
  - (a) **(rec)** Trust the record's tier unconditionally (ranking is an order, not a gate); costs nothing
    extra, but a stale record could mis-order one row until re-triage.
  - (b) Mark such rows `disagrees` in the reason and keep the record's tier. Costs one more reason string
    and a test.
- **D4 — Does a re-triage record superseding a human approval change the tier source?** The newest
  `verdictAt` wins by the gate's own rule. Confirm the ranker should inherit that rule verbatim even when a
  later triage record (lower authority than a human approval) is newer. Recommendation: yes, inherit
  verbatim — a divergence would be a second trust rule; cost: a later automated re-triage can mask the
  human's tier statement in the ranking display (not in dispatch, which uses the same rule).
  **Recorded selection: Option (yes),** the ranker inherits the gate's newest-`verdictAt` rule
  verbatim, so there is no second trust rule.

## Follow-ups (tracked)

None beyond the decisions above. The 9 `hold:tier` issues need no data change; they re-rank when approved.
