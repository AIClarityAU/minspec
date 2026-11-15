---
id: SPEC-307
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables (same epic as SPEC-031, which owns the awaiting-approval signal this decouples from)
aspects: [reviewer, hitl, labels, fail-closed, signpost, no-silent-gate]
depends_on: [SPEC-031]
relates_to: ["#816", SPEC-031, DR-060, DR-061, DR-063]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns is decided at Plan, after Decisions D1 to D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
---

# SPEC-307 — Retire the eager `needs-human-review` on `ai-review:changes`

Issue: #816 (retire eager needs-human-review on ai-review:changes). Rationale: DR-063
(the `awaiting-approval` queue signal, decoupled from the AI-failure path); loop it
decouples from: DR-060 (auto-remediation) and DR-061 (native auto-merge).

## Problem

`needs-human-review` was applied at t=0 on any `ai-review:changes`. That conflated two human
states: *AI failed, robots remediate first* and *AI passed, human approves*. A reviewer
filtering "my turn" could not tell them apart (PR #782 was the specimen).

**Root cause.** The eager label predates the DR-060/061 remediation loop; when remediation
was added, "non-pass means summon a human now" was never revisited. The missing gate is a
single tested decision seam for "is a human genuinely the next actor".

## Current state (verified against the tree, not assumed)

The issue body describes the pre-change state. Reading the code at this commit, the main
retirement has **already landed**:

- `.github/scripts/ai-review-guard.js:2086` `shouldSummonHumanReview` is the pure seam: machinery PR → summon;
  `ai-review:blocked` → never; normal `ai-review:changes` → summon only when
  `remediationAvailable !== true` (deny-by-default fallback for repos without the dispatch lane);
  pass → never.
- `.github/workflows/ai-review.yml` (~L1507-1562) calls the seam; the probe is the presence of `scripts/remediate-pr.sh`.
- `scripts/remediate-pr.sh` applies `needs-human-review` at cap / escalate / quarantine / conflict (e.g. L949-958, L1009-1011, L1084-1086).
- Tests lock the seam: `.github/scripts/ai-review-guard.test.js` (L880+).

**Still not matching the issue's intent** (the real scope of this spec):

1. The fail-closed backstop (`ai-review.yml` ~L1606-1617) still applies `needs-human-review` unconditionally, by deliberate comment ("workflow error, no verdict to remediate from"). Issue item 1 named it.
2. Item 3 (rename the exhaustion label to `needs-human-fix`) is undone. `needs-human-review` is referenced by ~68 files (scripts, tests, workflows, fixtures), including `dispatch-ready-check.sh`'s blocking list.
3. Nothing proves the *outcome* the issue wants: a normal `changes` PR on a remediation-enabled repo carries no human-queue label until exhaustion. The seam is unit-tested; the workflow wiring around it is not asserted end to end.

## Functional requirements

- **FR-1 — Normal `ai-review:changes` never summons at t=0 where remediation exists.** Preserve the current seam behaviour; it is the contract. The workflow step and the seam must keep agreeing (single source: the guard module).
- **FR-2 — `needs-human-review` (or its successor name, D1) means only "automation exhausted or a human is structurally required".** Allowed writers: `remediate-pr.sh` exhaustion paths, the machinery-PR summon (kept: a gate cannot certify itself, #596), and the writers in D2.
- **FR-3 — Fail-closed backstop policy.** Per D2: either keep the eager label on a workflow *error* (no verdict exists) or replace it with a distinct signal. Whichever is chosen, the backstop stays fail-closed: the red status, `ai-review:changes` and `exit 1` must not depend on any label call (invariant 2).
- **FR-4 — Optional rename.** Per D1. If renamed, every reader and writer moves in one change, with a migration for PRs already carrying the old label (see AC-5).
- **FR-5 — No-remediator fallback is kept.** A repo without `scripts/remediate-pr.sh` keeps the eager summon (liveness), as today.
- **FR-6 — Wiring test.** A test asserts, from `ai-review.yml` as written, that the `SUMMON_HUMAN` step feeds `LABEL`, `IS_MACHINERY` and the `REMEDIATION_AVAILABLE` probe into the seam and that no other unconditional `--add-label "needs-human-review"` exists outside the documented backstop/exhaustion writers (a drift guard: a new eager writer fails the suite).

## Acceptance criteria

- AC-1 — Normal `ai-review:changes` PR, remediation lane present: no `needs-human-review`, no human reviewer requested at t=0.
- AC-2 — Same PR after the remediation cap is hit: `needs-human-review` (or successor) present, via `remediate-pr.sh`.
- AC-3 — Machinery PR, either verdict: label present (unchanged).
- AC-4 — `ai-review:blocked`: never labelled.
- AC-5 — If D1 renames: no open PR is left holding the old label with nothing reading it; `dispatch-ready-check.sh` blocks on both names during the transition.
- AC-6 — A label API failure in any of these paths leaves the verdict label, the red status and `exit 1` unchanged.
- AC-7 — `awaiting-approval` never coexists with `ai-review:changes` (SPEC-031 INV-8) — regression check only.

## Invariants this change must not break

- Constitution invariant 2 (no silent gate): `ready-to-merge` stays red independently for every un-passed or machinery PR; this label is advisory and retiring it must never let anything merge early.
- Constitution invariant 3 (blast radius): `ai-review.yml` is scaffolded into consuming repos. Behaviour there must not change without opt-in — hence FR-5's probe, and any rename must not alter a consumer's labels unasked.
- SPEC-031 INV-8: `awaiting-approval` remains the single positive "my turn" signal and is untouched here.
- Machinery PRs are never self-certified: `ai-review.yml`, `ai-review-guard.js` and `remediate-pr.sh` are machinery, so the implementing PR is human-merge-only.

## Out of scope

The `awaiting-approval` applier (SPEC-031 FR-9a). Changing the remediation cap or its semantics (DR-060).

## Decisions needed (Clarify)

- **D1 — Rename `needs-human-review` to `needs-human-fix`?**
  - (a) **Keep the name** *(rec)*: ~68 files reference it, including dispatch gating and fixtures. With eager application gone the name is no longer misleading; a rename buys disambiguation from `awaiting-approval` that the polarity change already delivers. Cost: the word "review" still reads like an approval prompt to a new reader.
  - (b) Rename: unambiguous. Cost: a large cross-file change on gate machinery, a transition window with two names, and breakage risk in consumers' dashboards and saved searches.
- **D2 — Fail-closed backstop (workflow errored, no verdict).**
  - (a) **Keep eager** *(rec)*: with no verdict nothing can remediate, so a human genuinely is next. Cost: contradicts the issue's literal item 1; a flaky workflow (token mint, install) summons the human for infra noise.
  - (b) Drop the label, rely on the red status and `ai-review-retry`: queue stays clean. Cost: an errored run sits silently red with no human signal if retry also fails, which edges toward a silent gate.
  - (c) Apply only after one automatic re-run also errors: best of both, but adds state and a new workflow path.
- **D3 — Is item 1 closed by what already shipped?** If D1(a) and D2(a) are chosen, the remaining work is FR-6 plus tidying the issue's stale description; the issue could close after the wiring test lands. Alternatively keep it open for D1(b)/D2(b).
