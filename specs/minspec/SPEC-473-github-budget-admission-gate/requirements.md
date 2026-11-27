---
id: SPEC-473
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [gh-bot, rate-limit, admission-gate, drain, triage, fail-closed]
relates_to: ["#4109", "#4102", "#4103", "#4062", SPEC-054]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-473: GitHub-budget admission gate for bulk `gh-bot` callers

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through
> the normal spec-approval gate before any code changes. Requirements are written under each
> question's recommended option.

Materializes **#4109** (*no GitHub-budget admission gate - bulk callers exhaust the App's
shared 5000/hour GraphQL budget*), the root cause behind **#4102** (GraphQL limit strands
pushed agent branches) and **#4103** (strand outlasts the #4062 re-auth retry). No DR exists
for this; none is proposed (the gate is reversible in under a day).

## Problem

Every caller acting as the minspec-sdd App (installation 144283146) draws on ONE hourly
GraphQL budget of 5000 points. Nothing admits or throttles GitHub spend: the existing
admission gates (`drain-inbox.sh --quota-cap`, jobs' stop checks) measure **Claude** quota.
Measured (issue #4109): ~196 calls/min after the 19:16Z reset (about 11,700/hour, over twice
the budget). The refusal is the primary budget (HTTP 200, `X-Ratelimit-Resource: graphql`,
`Remaining: 0`, `code: graphql_rate_limit`), not the secondary limit. REST `/rate_limit`
read `used 1276` for the same token at the same second, so REST is the **wrong witness**.

## Scope

In: a budget-admission function in `scripts/lib/gh-bot.sh`, and its use by the bulk callers
named in FR-5. Out: the chief-of-staff runner's per-tick `pr view` fan-out (tracked outside
this repo; lives in `~/.claude`), reducing per-call cost, and the #4102/#4103 branch-stranding
recovery itself (this spec removes their cause; it does not re-spec them).

## Functional requirements

- **FR-1 Read the right counter.** A new `gh_bot_budget_check` reads the budget with the
  GraphQL query `query { rateLimit { remaining resetAt } }` via `gh_bot_graphql_read`. It
  MUST NOT consult REST `/rate_limit`.
- **FR-2 Floor.** Remaining below a floor (default 1000, overridable by env
  `GH_BOT_BUDGET_FLOOR`) means *defer*; at or above means *admit*.
- **FR-3 Unreadable defers.** A reading that cannot be obtained or parsed (command failure,
  empty or non-JSON output, `remaining` or `resetAt` missing or non-numeric/unparseable,
  GraphQL `errors` present) MUST defer, never admit. An unreadable reading carries no
  `resetAt`, so the caller uses a bounded fallback wait (FR-4).
- **FR-4 Defer until reset.** On defer the check reports the reason, remaining and
  `resetAt` on stderr, and exits with a distinct non-zero status. A caller defers its unit
  of work until `resetAt` (plus a small skew margin) rather than retrying into the wall;
  with no `resetAt` it waits a bounded fallback interval, then re-reads. No admit-by-timeout.
- **FR-5 Consulted by bulk callers.** Before each unit of work: `scripts/triage-inbox.sh`
  (per issue), and the drain's PR sweep and dispatch loop in `scripts/drain-inbox.sh`
  (per PR swept, per dispatch).
- **FR-6 Cheap probe.** The probe itself costs 1 point; a caller reuses a reading for a
  short TTL (default 60s) so the check does not become a new top consumer.
- **FR-7 Visible.** Every defer is logged with a distinct, greppable line. A drain cycle
  cut short by deferral says so in its cycle summary, so it is never read as "queue empty"
  (cf. #1855).
- **FR-8 Offline seam.** Tests and offline runs stub the reading through an env seam (as
  other `gh-bot.sh` seams do); the library never touches the network at source time.

## Acceptance criteria

- **AC-1 (T0)** Stubbed reading under the floor: the bulk caller defers and does not start
  the unit (FR-2, FR-4).
- **AC-2 (T0)** Unreadable reading (each of: command error, empty output, malformed JSON,
  missing field, GraphQL `errors`): the caller defers (FR-3).
- **AC-3 (T0)** Healthy reading: the caller proceeds (FR-2).
- **AC-4** A reading exactly at the floor admits; one below defers (boundary).
- **AC-5** No code path in the gate calls REST `/rate_limit` (FR-1).
- **AC-6** A second check within the TTL issues no new probe; after the TTL it does (FR-6).
- **AC-7** Each defer emits the greppable line and the drain summary reports it (FR-7).

## Invariants this change must not break

- **Constitution invariant 2 (no silent gate):** an errored or missing witness fails
  closed and visibly; the gate has no `|| true` on its reading, and a single producer
  failing never admits.
- **Constitution invariant 1:** no network call at source time; the probe only runs when a
  bulk caller is already doing GitHub work.
- **Read/write classification (#1411):** the probe uses `gh_bot_graphql_read` and must
  not trigger a write-identity mint.
- A failed read is never an empty queue (#1855); deferral is reported as deferral.

## Decisions needed (Clarify)

1. **Wait vs. exit on defer** (callers with long sweeps).
   - (a) **(rec)** Sleep until `resetAt` inside the caller, capped (e.g. 65 min). Keeps
     sweeps self-completing; cost: a sleeping process holds a drain/worktree slot and a
     timed-out job can orphan it (the exact failure that started #4109).
   - (b) Exit with the deferral status and let the next scheduled cycle resume. Simple and
     leak-free; cost: relies on a next cycle existing, so one-shot triage sweeps stop
     midway until re-run.
2. **Floor default.** (a) **(rec)** 1000, as the issue states; cost: one big unit already
   in flight may still overshoot. (b) Per-caller floors sized to the unit's worst-case cost;
   more precise, more config to keep aligned.
3. **Should the CoS runner share the gate?** Out of this repo today. (a) **(rec)** Leave
   it, track outside; cost: its ~2,300 calls/hour keep eating the shared budget the gate
   protects. (b) Publish the function for it to source; couples `~/.claude` to this lib.

## Open items for Plan (not decisions)

- Where the TTL cache lives (env var vs. tmp file shared across subshells).
- Exact exit-status number and the cycle-summary wording.
- Whether the guard in `gh-bot.test.js` needs a new seam entry for the probe.
