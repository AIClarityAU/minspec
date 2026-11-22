---
id: SPEC-378
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a required check must exist and be visible, and not depend on timing it does not control
aspects: [ready-to-merge, commit-status, ci-gate, replay, staleness, fail-closed]
relates_to: ["#1211", "#1204", "#1176", "#1688", "#1973", "SPEC-182", "SPEC-304"]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist; the fix-shape choice under
  "Decisions needed (Clarify)" is unanswered.
---

# SPEC-378: `ready-to-merge` verdicts are bound to the state they evaluated, so a replayed run cannot regress a green gate (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads it,
> answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#1211](https://github.com/AIClarityAU/minspec/issues/1211). Same family as #1204 (a
required gate whose correctness depends on timing it does not control). No DR exists for this yet; one
is warranted only if the Clarify answer moves the gate off commit statuses (see Decision 1).

## Root cause (mechanism, not state)

Bad state: PR #1176 was `ai-review:pass`, checks green, yet `BLOCKED`, because a `ready-to-merge`
**failure** status sat newer than the passing ones.

- **Mechanism.** `.github/workflows/ready-to-merge.yml` reads the PR's labels from the **event
  payload** (`pr.labels`, `labels = (pr.labels || []).map(...)`) and posts the verdict with
  `repos.createCommitStatus` on `pr.head.sha`. The payload is a snapshot taken when the event fired.
  I believe (unverified in this checkout; confirm in Plan) that `gh run rerun` replays the *original*
  event payload, so a rerun of an old run re-decides from labels that no longer hold ("needs
  ai-review:pass") and posts that as a **new** status. Commit statuses are last-write-wins per
  context, so the stale verdict replaces the accurate one purely by arriving last.
- **Gate that was missing.** Nothing ties a posted verdict to the state it was derived from, and
  nothing refuses a write whose inputs are older than the PR's current state. The existing
  `concurrency` group (#1973) only serialises runs; it orders them by arrival, not by freshness. The
  SHA-bound witnesses (`ai-review/pass`, `ai-review` check-run) are *read* by the gate but the gate's
  own output carries no equivalent binding.
- **Why it is a gate defect, not an operator error.** Re-running an old run is routine debugging, and
  `drain-inbox.sh` auto-remediation re-runs runs too, so it is reachable with no human involved.
  It fails closed (good) but names the wrong reason ("needs ai-review:pass" after a pass), which
  misdirects.

## Functional requirements

- **FR1 — Verdict is decided from live state.** The `ready-to-merge` job MUST derive the label set
  (and head SHA) it decides on from the pull request as it is **at write time**, not from the event
  payload, whenever the run is a replay (`github.run_attempt > 1`). For a first attempt the payload
  is fresh by construction and MAY be used as today (see Decision 2).
- **FR2 — Stale writes are refused, visibly.** If the head SHA the run was started for no longer
  equals the PR's live head SHA, the run MUST NOT present old-head state as the PR's current verdict, and
  MUST say so in the job log (`core.notice`/summary), never silently succeed.
- **FR3 — Never leave the gate unwritten.** FR1/FR2 MUST NOT produce a state where the required
  context is never posted for the live head. The #1973 rule stands: a skipped write is only safe
  because a fresh evaluation exists or is triggered for the live head; where none is guaranteed, the
  run MUST evaluate live state and post it rather than skip (fail closed = a status is always written).
- **FR4 — Verdict records its inputs.** The posted status `description` (or check-run output) MUST
  carry a compact record of what was evaluated — at minimum the head SHA and the `ai-review:*` label
  state read — so a stale verdict is distinguishable from a fresh one by inspection.
- **FR5 — Reason text is truthful.** A failure description MUST NOT state a cause (e.g. "needs
  ai-review:pass") that live state contradicts. A replayed run that finds a live pass posts the live
  verdict (green), not the replayed one.
- **FR6 — Provenance and self-forge guards unchanged.** The base-pinned checkout, allowlist
  provenance (`verifyPassProvenance`), SHA-bound witness, staleness strip (#359/#1688), and
  fail-closed-on-guard-missing behaviours MUST be preserved byte-for-byte in effect. FR1 only changes
  *where the label snapshot comes from* on replay.
- **FR7 — Operator mitigation is documented.** The runbook for unsticking a PR MUST state: re-run the
  **newest** run of a workflow, never an older one, and how to spot a shadowing status
  (`GET /commits/<sha>/statuses`, newest first). Location is a Plan decision (candidate:
  `docs/claude-md-details.md`); this FR stands even if FR1–FR6 are declined.
- **FR8 — Regression test distinguishes the bug.** A test MUST fail on the current code and pass after:
  a replayed run (`run_attempt = 2`) with a payload whose labels lack `ai-review:pass`, against a live
  PR that has a verified pass, must yield a success verdict (or no write), never failure. The decision
  logic SHOULD be extracted into `.github/scripts/ai-review-guard.js` (pure, testable) rather than
  living only in the workflow script.

## Acceptance criteria

1. Replay of an old-payload run on a PR whose live state is `ai-review:pass` + verified: final
   `ready-to-merge` status is success; no newer failure exists on that SHA.
2. Replay on a PR whose live state genuinely lacks a pass: status is failure, description names the
   live cause.
3. Replay after the head moved: no status is written against the new head from old-head state;
   the log says why.
4. First-attempt runs for every existing trigger (`opened/synchronize/reopened/labeled/unlabeled`)
   behave identically to today (existing `ai-review-guard.test.js` cases unchanged and green).
5. A failed live-state read posts failure (fail closed) with a description naming the read error,
   never green and never silent.
6. The post-fix status description lets a reader tell which SHA/labels it evaluated (FR4).

## Invariants the change must not break

- **No silent gate (constitution invariant 2).** No swallowed error on the gate path; a missing or
  errored witness fails closed and visibly; the required context is always eventually written.
- **Self-forge defence.** Guard code still comes from the trusted base commit; no PR-controlled input
  reaches a shell; the live read goes through the REST API as data.
- **Single writer.** `ready-to-merge` stays posted by one workflow/job; no second poster is added.
- **Offline core (invariant 1) / blast radius (invariant 3).** CI-only; nothing here changes
  extension behaviour or any repo without `.minspec/`.
- **Required-check contract.** Whatever name/type branch rules require today keeps being satisfied
  during and after rollout (see Decision 1).

## Decisions needed (Clarify)

1. **Status vs check-run for the gate** (issue suggestion 3).
   - **(a) Keep the commit status; fix inputs (FR1–FR5)** — **(rec)**. Smallest change; the required
     check and every reader of the status keep working. Cost: last-write-wins remains a latent
     property, so correctness rests on every writer reading live state.
   - **(b) Move to a check-run.** Rollup is keyed per run, structurally removing last-write-wins.
     Cost: changes the required-check contract in the ruleset (a founder-held change), risks a
     status/check-run name collision of exactly the shadowing kind this issue reports during
     transition, and needs the `checks: write` permission plus a DR.

   **Recorded selection: the recommended option,** (a), keep the commit status and fix its inputs (FR1-FR5). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
2. **Live re-read scope.** **(a) only when `run_attempt > 1`** **(rec)** — first attempts unchanged,
   least API spend; cost: a *first-attempt* run delayed in the #1973 queue still reads a payload that
   may be old. **(b) always** — closes that too; cost: one extra `pulls.get` per run and a behavioural
   change to every event, widening the regression surface.
   **Recorded selection: the recommended option,** (a), live re-read only when `run_attempt > 1`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
3. **On a head mismatch (FR2): skip or re-evaluate?** **(a) skip + log** (issue suggestion 2) —
   simplest; cost: relies on a later event for the live head, which #1973 notes is not guaranteed.
   **(b) evaluate and post against the live head** **(rec)** — always writes, fail-closed; cost: a
   replay then does real work on a SHA it was not started for.
   **Recorded selection: the recommended option,** (b), evaluate and post against the live head. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
4. **Should drain auto-remediation be restricted to the newest run?** Out of this spec's allowlist
   (scripts), so it is *not* required here; say whether to file it as a follow-up.

## Follow-ups (tracked)

- Drain auto-remediation rerunning only the newest run: #1211 (decide in Decision 4; file separately if yes).
