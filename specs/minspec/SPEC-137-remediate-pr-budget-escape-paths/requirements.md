---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (remediation's runaway guard is its bounded-autonomy layer)
relates_to: [DR-060, DR-003, SPEC-062, SPEC-044]
implements: [scripts/remediate-pr.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — remediate-pr.sh: every exit path is charged to a budget, and an unwritable ledger fails closed (Requirements)

> Materializes **[#1012](https://github.com/AIClarityAU/minspec/issues/1012)** —
> *"remediate-pr.sh has three budget-escape paths that post no marker."* Rests on
> **DR-060 §4 "Bounded autonomy"** (two independent budgets, counted from marker
> comments). No new DR: every choice here is a same-day-reversible edit to one script,
> below the DR-359 ADR filter.

## One-Sentence Scope

Make `scripts/remediate-pr.sh` charge every exit that did not clear the PR's gate to one
of its budgets, and stop (label `needs-human-review`) whenever it cannot record that
charge, so DR-060 §4's claim "never a loop" holds on every path.

## Context (grounded, with `file:line` evidence)

The marker comment is the **only** durable budget state (`post_marked_comment`,
`scripts/remediate-pr.sh:459`; counters at `:708-709`). Any exit that posts no marker
spends nothing, and the next drain sweep re-dispatches the same PR. Current exits:

| # | Exit path | Where | Marker today |
|---|---|---|---|
| E1 | Agent exited 0, HEAD unchanged ("no new commit") | agent loop, `cleanup; exit 0` | **none** |
| E2 | Agent path push failure (`WARNING: push failed … worktree left`) | agent loop, `exit 0` | **none** |
| E3 | Rebase-only push failure (`left for a human.`) | rebase-only branch | **none** |
| E4 | `gh pr comment` fails inside `post_marked_comment` (`2>/dev/null \|\| true`) | `:459-464` | the marker was meant to post; it silently did not |
| — | Agent crash | `CRASH_MARKER` | crash budget (ok) |
| — | ESCALATE after retry, egress quarantine, rebase conflict | `ATTEMPT_MARKER` | attempt budget (ok) |

E1–E3 are pre-existing; E4 is the best-effort ledger. Neither the label nor a marker is
written on E1–E3, so a deterministic no-op agent or a branch that always rejects the push
is retried every sweep, unboundedly. E4 is worse: it silently un-bounds *every* marker
path, including the ones that look covered (a persistent comment failure — rate limit,
5xx, lost write permission — means no cap is ever approached). This is constitution
invariant 2 (*no silent gate*): a load-bearing gate signal written with a swallowed
error.

Two sub-cases of E3 are not escapes and stay as they are: "Already up to date" (nothing
to push, PR not behind, classifier will not re-select it) and the rebase **conflict**
branch (already posts `ATTEMPT_MARKER`).

## Functional Requirements

- **FR-1 (no-commit is charged).** When the agent exits 0 without adding a commit (E1),
  post a marker comment before exiting. The comment says the agent produced no change.
- **FR-2 (push failure is charged).** When a push fails on either path (E2, E3), post a
  marker comment before exiting. The agent-path comment keeps the worktree location; the
  worktree is still left for inspection as today (E2) — only the marker is new.
- **FR-3 (which budget).** E1–E3 are charged per the option chosen under Decision D1.
  Whatever the choice, the marker used is one of the existing isolated markers or a new
  one added to `assert_markers_isolated` (`:277`) so no marker is equal to or a substring
  of another, and `cap_hit_summary` (`:358`) names the exhausted budget truthfully.
- **FR-4 (ledger writes are witnessed).** `post_marked_comment` returns non-zero when
  `gh pr comment` fails, instead of swallowing it. Every caller that relies on the marker
  as budget state handles the failure per FR-5; the one caller for which the comment is
  informational only (the capped notice, `:724`, itself gated by `cap_notice_decision`)
  may continue best-effort **provided** the `needs-human-review` label was already
  applied before it (it is, `:721`).
- **FR-5 (fail closed).** If a budget-charging marker cannot be written, the script
  labels the PR `needs-human-review`, prints a visible error on stderr naming the PR and
  the failed write, and stops. It does not proceed to the next side effect on that path.
- **FR-6 (label failure is also visible).** If the label write in FR-5 also fails, the
  script exits non-zero (not 0) with the error on stderr, so the drain sweep's own
  accounting sees a failed PR rather than a clean one. See D2 for whether a second
  witness is required.
- **FR-7 (ordering on success path).** The success path posts its attempt marker only
  after a successful push (unchanged). If that post fails (FR-5) the push has already
  landed; the PR is labelled and the loop stops, so at most one un-ledgered attempt can
  occur per PR.
- **FR-8 (no behaviour change elsewhere).** Dry-run, skip, classify and cap paths,
  the `--count-markers`/`--check-markers`/`--cap-hit-summary` seams, and every currently
  charged exit are unchanged in output and budget accounting.

## Acceptance Criteria

- **AC-1.** With a fake agent that exits 0 and commits nothing, a second sweep over the
  same PR sees the charge counted by the guard; after the cap is reached the PR is
  labelled `needs-human-review` and the agent is **not** launched again.
- **AC-2.** With `git push` stubbed to fail, on the agent path and on the rebase-only
  path separately, each run leaves exactly one new marker and repeated sweeps converge
  to the cap-hit label instead of repeating.
- **AC-3.** With `gh pr comment` stubbed to fail: the script adds `needs-human-review`,
  writes an error to stderr, and does not launch the agent on a following sweep (the
  label is a second witness only if D2 selects it; otherwise the failure is visible via
  exit status).
- **AC-4.** With label write also failing, exit status is non-zero (FR-6).
- **AC-5.** Existing marker-isolation and counting tests still pass unchanged; a new
  case proves any newly added marker is isolated from the existing ones.
- **AC-6 (mutation).** Reverting each of FR-1, FR-2 (both paths) and FR-4 independently
  turns at least one test red — tests must vary a fixture axis (cap value, number of
  prior markers), not only code.

## Invariants (must not be broken)

- **INV-1 (constitution 2, no silent gate).** No budget-charging write is swallowed; a
  failed write fails closed and visibly.
- **INV-2 (constitution 3).** Behaviour changes only inside `scripts/remediate-pr.sh`,
  which runs only in a repo that opted in (`.minspec/`).
- **INV-3 (isolation).** One comment body still ends with at most one marker; markers
  stay pairwise non-nested (`assert_markers_isolated`).
- **INV-4 (agent is credential-free).** All new writes are the parent script's; the agent
  environment and tool list are untouched.
- **INV-5.** Remediation still never merges and never mutates `ai-review:*` labels.

## Out of scope

Changing the budget sizes; moving state out of marker comments; the remote-sweep driver
and drain scheduling.

## Decisions needed (Clarify)

- **D1 — which budget do E1–E3 charge?**
  - **(a) Crash budget (rec)** — neither path produced a fix, which is exactly what the
    crash budget already means; no new marker, no new env var, `cap_hit_summary` text
    unchanged. Cost: the crash budget's description ("agent crashed") becomes inaccurate
    for push rejections, so comment text and DR-060 §4 wording need a sweep, and a
    flaky-push PR can burn crash quota that a later real crash would have used.
  - **(b) Third budget** (`MINSPEC_REMEDIATE_MAX_STALLS` + new marker) — precise
    semantics, independent quota. Cost: a third marker to isolate, count, document and
    test, a new env var, and DR-060 §4 amended from "two" to "three" budgets.
  - **(c) Attempt budget** — simplest, but a push failure then spends quota meant for
    genuine fixes. Not recommended.
- **D2 — second witness for a dead ledger.** Constitution invariant 2 forbids a required
  check hinging on one producer. Comment write and label write are both `gh` writes by the
  same token, so a lost write permission kills both.
  - **(a) Non-zero exit + stderr only (rec)** — cheap; the drain log shows it. Cost: if
    the drain ignores a child's exit status the PR is still re-dispatched each sweep, so
    this must be checked against how the drain treats a non-zero child before accepting.
  - **(b) Local per-PR stall counter** (a file under the drain state dir, keyed by PR and
    head SHA) as an independent second witness. Cost: new state store alongside the
    "marker comment is the only state" design, and per-machine rather than per-PR.
- **D3 — E2 worktree retention.** Keep leaving the worktree for inspection (today), or
  clean up since the charge is now recorded. Recommend keep (a human may need the
  unpushed commit); cost is leaked worktree directories until a human clears them.
