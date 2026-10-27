---
id: SPEC-241
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the unattended merge actors and the ready-to-merge merge gate live here (same epic as SPEC-222)
aspects: [ready-to-merge, docs-lane, governance, auto-merge, no-silent-gate, second-witness, parity, shipped-template]
depends_on: [DR-029, DR-072, DR-086, DR-111]  # DR-029 acceptance is a human act; DR-072 §3 hold labels; DR-086 §2 acceptance/approval always stop; DR-111 Alt-A self-merge must keep working
relates_to: ["#2157", "#1870", "#1964", "#1847", "#2124", "#1973", "#1968", "#1741", SPEC-217, SPEC-222]
implements: none
implements_reason: >-
  A defect spec. Every change lands in existing machinery files (ready-to-merge.yml, its
  base-pinned guard script, and their tests) that are shared, parity-pinned and shipped as
  templates; owning any of them from here would freeze it for every other change to the
  merge gate.
affects: [.github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, .github/workflows/ready-to-merge.yml, packages/minspec/src/lib/ci-review-templates.ts, packages/minspec/tests/governance-lane-eligibility.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-241: Every docs-lane refusal has an independent second witness in `ready-to-merge`, starting with the governance status transition

Triggered by: #2157 (the docs-lane governance status-transition refusal has one witness
where the `hold:*` refusal has two). Mirrors the hold witness added by #1870 / merged as
#1964. Rests on constitution invariant 2 (no required check hinges on a single producer),
DR-029 (DR acceptance is a separate human act), DR-086 §2 (DR acceptance and T3/T4 spec
approval always stop and ask), DR-072 §3 (hold labels) and DR-111 (founder Alt-A
self-merge, which this change must not break).

## In plain terms

`docs-lane.yml` arms GitHub auto-merge on docs-only pull requests. It refuses to arm - and
revokes an earlier arming - for four reasons. One of them is a changed `status:` line in a
DR or spec, because that is a DR acceptance or a spec approval, and those are human acts.

That refusal lives **only** in docs-lane, and docs-lane only runs while the `docs-lane`
label is on the pull request. Remove the label after the lane has armed, push a status
change, and nothing re-checks: the earlier arming stands and the ratification merges with
no human keystroke. The `hold:*` refusal had the same shape and was given a second witness
in the required `ready-to-merge` check (#1870). The status refusal was not.

This spec gives the status refusal the same second witness, and adds a test over the
**set** of docs-lane refusals so a future refusal cannot ship with only one witness again.

## One-Sentence Scope

Make the required `ready-to-merge` check fail, with a named reason, while auto-merge is
armed on a pull request whose diff carries a governance status transition (by docs-lane's
own predicate), and add a test that fails whenever a docs-lane refusal reason has neither a
`ready-to-merge` witness nor an explicit, justified waiver.

## Verified current state (read from this worktree's base, not inferred)

1. **docs-lane has four refusal reasons**, each a distinct `🚫 **docs-lane…**` comment
   banner followed by `exit 1`: non-docs path (`docs-lane.yml:140-146`), outward-facing doc
   (`:147-153`), `hold:*` label (`:282-286`), governance status transition (`:287-291`).
   The other `exit 1`s (`:121-130`, `:164-167`, `:238-242`) are witness-read failures, not
   refusal reasons. Every non-zero exit revokes an earlier arming through the EXIT trap
   (`:98`, #1968).
2. **docs-lane is gated on its label**: `if: contains(github.event.pull_request.labels.*.name, 'docs-lane')`
   (`docs-lane.yml:36`). With the label removed, the job does not run, so
   `revoke_any_arming` (`:65-87`) is never reached.
3. **docs-lane now HAS a concurrency group** - `cancel-in-progress: true` (`docs-lane.yml:29-31`).
   The issue's "there is no `concurrency:` group" is stale for docs-lane; #1973 was about
   `ready-to-merge`, which now also has one (`ready-to-merge.yml:110-113`,
   `cancel-in-progress: false`). The cancellation path is still real, and arguably sharper:
   an `unlabeled` event starts a new docs-lane run in the same group, which cancels the
   in-flight refusal run, and the new run's job is then skipped by the `if:`. I believe the
   workflow-level `concurrency` cancel happens before the job-level `if:` is evaluated
   (unverified - confirm in Plan).
4. **The hold second witness**: `HOLD_RE = /^hold:/` (`.github/scripts/ai-review-guard.js:1769`),
   applied inside `decideStatus` (`:1786-1787`), reported first in the description
   (`:1796-1806`), exported (`:2203`), and pinned lock-step to docs-lane's `hold_pattern`
   by `ai-review-guard.test.js:1671-1681`.
5. **No status-transition witness in the guard**: `grep -niE 'status.?transition|governance.?status|STATUS_TRANSITION' .github/scripts/ai-review-guard.js`
   returns nothing on this tree.
6. **The predicate already has a TypeScript mirror**: `GOVERNANCE_PATH_PATTERN`
   (`packages/minspec/src/lib/governance-transition.ts:48`), `STATUS_TRANSITION_PATTERN`
   (`:81`), `patchHasStatusTransition` (`:123`), pinned to the workflow literals by
   `packages/minspec/tests/governance-lane-eligibility.test.ts`. A shell twin exists at
   `scripts/lib/governance-transition.sh`. The guard is CommonJS loaded from the trusted
   **base** checkout (`ready-to-merge.yml:144-195`) and cannot `require` the TypeScript
   module, so a third copy of the two pattern strings is unavoidable; it must be pinned the
   way `HOLD_RE` is.
7. **`ready-to-merge` today ignores arming state for the verdict.** It reads
   `pr.auto_merge` from the webhook payload only for the `awaiting-approval` label sync
   (`ready-to-merge.yml:512-520`). Its triggers are
   `[opened, synchronize, reopened, labeled, unlabeled]` (`:96`); `auto_merge_enabled` /
   `auto_merge_disabled` are not among them.
8. **A bot merges status-transition PRs legitimately (DR-111).** `alta-self-merge.yml`
   squash-merges, as `minspec-sdd[bot]`, a founder PR that carries only an Alt-A approval
   (a frontmatter `status:` change plus its record) once **every required check is green**
   (`alta-self-merge.yml:1-18`). It merges through the merge API, not by arming auto-merge.
   A witness that turned `ready-to-merge` red on **every** status transition would
   therefore make DR-111 unreachable, and would also redden every new-spec PR (an all-`+`
   patch with `+status: specifying` matches the predicate - see `docs-lane.yml:232-236`).
   This is why the witness below is scoped to the **arming**, which is exactly the act
   docs-lane refuses.

## Functional Requirements

- **FR-1 - Status-transition predicate in the guard (pure).** `ai-review-guard.js` exports
  `GOVERNANCE_PATH_RE` and `STATUS_TRANSITION_RE` plus a pure
  `governanceStatusTransitions(entries)` that returns the governance paths which carry - or
  may carry - a transition, arm for arm with docs-lane's loop (`docs-lane.yml:243-271`):
  - (a) path matches `GOVERNANCE_PATH_RE` and an added/removed line of its patch matches
    `STATUS_TRANSITION_RE` (applied per `\n`-split line, as `patchHasStatusTransition` does);
  - (b) path matches and its patch is absent, empty or not a string → included, reason
    `no patch` (an absent witness is an unknown, never a "no").
  Non-governance paths are never included.
- **FR-2 - Lock-step pinning.** The two pattern sources in FR-1 are asserted equal to
  docs-lane's `govern='…'` literal and its `grep -qE '…'` literal (read out of
  `docs-lane.yml`), and to `GOVERNANCE_PATH_PATTERN` / `STATUS_TRANSITION_PATTERN` in
  `governance-transition.ts`. The guard test also runs its regexes and the workflow's ERE
  under `grep -E` over a shared fixture matrix (the #2124 forms: frontmatter, `**Status:`,
  `> **Status:`, `*Status:`, table cell, indented literal, lower/upper case) and asserts
  the engines agree case by case. If SPEC-217 lands first and the governed path set
  becomes config-derived, the witness must derive it from the same base-branch source,
  and this FR's pin moves with it - whichever spec lands second carries that change.
- **FR-3 - Arming read, fresh and fail-closed.** On every run, `ready-to-merge` reads the
  PR's current auto-merge state through the API (not the event payload, which a queued
  run under `cancel-in-progress: false` may carry stale). A read failure, after the
  existing `withRetry` budget (#3015), makes the gate post FAILURE with
  `auto-merge state unreadable - fail closed`. No `|| true`, no empty `catch`.
- **FR-4 - Files read only when armed, fail-closed.** Only when auto-merge is armed (per
  FR-3), `ready-to-merge` reads the paginated PR file list with patches. A read failure,
  or a list at GitHub's file-list ceiling (3000 entries - treat as truncated), posts
  FAILURE with `governance diff unreadable - fail closed`. Reading files only when armed
  keeps the extra API cost off the common path (rate limit, #3015).
- **FR-5 - The verdict.** `decideStatus` accepts `autoMergeArmed` and
  `governanceTransitions`. When armed **and** the transition list is non-empty, the state
  is `failure`. Reason order: `hold:*` stays first (it cannot be cleared by acting); this
  reason is second, ahead of the review-provenance outcomes, worded with the reason first
  and paths last so `truncate()` costs only paths, e.g.
  `governance status transition with auto-merge armed - disarm it; a human merges this (DR-029, DR-086 §2): docs/decisions/DR-NNN.md`.
  The rule only adds failure: it never turns a red gate green.
- **FR-6 - Re-evaluate on arming.** `ready-to-merge.yml` adds `auto_merge_enabled` and
  `auto_merge_disabled` to its `pull_request` types, so an arming made by any actor after
  the last run is judged, and a disarm clears the red without a manual re-run. I believe
  both are valid `pull_request` activity types (unverified - confirm against GitHub's
  event docs in Plan).
- **FR-7 - Refusal-set test (the property, not the instance).** A test extracts every
  docs-lane refusal reason from `docs-lane.yml` - each distinct `🚫 **docs-lane…**`
  banner - and requires each one to appear in a registry that maps it to **either**
  (i) a named `ready-to-merge` witness (an exported guard symbol) plus a behavioural
  fixture under which `decideStatus` returns `failure`, **or** (ii) an explicit waiver
  string stating why no second witness is needed. It fails when: a banner is not in the
  registry; a registry entry names a banner no longer in the workflow; a named witness
  symbol is not exported; a witnessed reason's fixture does not produce `failure`. It
  also asserts the extraction found **at least four** banners, so an extraction regex that
  silently matches nothing cannot pass vacuously.
- **FR-8 - Registry contents at ship time.** `held` → `HOLD_RE` (existing).
  `governance status transition` → FR-1/FR-5. `docs-lane misuse` (non-docs path) →
  waiver: a non-docs PR is ordinary code, reviewed by ai-review and subject to the normal
  merge gates and machinery hold, and arming a code PR is a sanctioned act (DR-061), so the
  lane's refusal guards lane semantics, not a human-reserved act. `outward-facing docs` →
  per DQ-2 (rec: a witness, by the same armed-plus-path pattern as FR-5, keyed on
  `OUTWARD_DOC_PATTERN`).
- **FR-9 - Self-forge defence preserved.** All new logic runs from the base-pinned
  `ai-review-guard.js`. Patches are read as API data and never executed or `require`d.
- **FR-10 - Template parity.** `ready-to-merge.yml` and the guard are shipped templates;
  the embedded copies in `ci-review-templates.ts` are regenerated, not hand-edited, and
  the existing parity test stays green.

## Acceptance Criteria

- **AC-1 (FR-1, FR-5)** - Armed, `docs/decisions/DR-NNN.md` patch `-status: proposed` /
  `+status: accepted`, verified `ai-review:pass`: `ready-to-merge` = failure, description
  names the path.
- **AC-2 (FR-5, DR-111)** - The same PR **unarmed** is not held by this rule (an Alt-A
  self-merge and a human keystroke still work).
- **AC-3 (FR-1)** - Each #2124 form (`**Status: …**`, `> **Status: superseded**`,
  `*Status: accepted*`, a table-cell status) under `specs/` or `docs/decisions/` is held
  when armed; an indented `  status:` inside a fenced block is not; a `status:` change in
  `CLAUDE.md` or `.minspec/approvals/**` is not.
- **AC-4 (FR-1)** - Armed, governance file with no `.patch` → held, reason names `no patch`.
- **AC-5 (FR-3, FR-4)** - Injected failure of the arming read, and separately of the files
  read, each yield failure with its named description; a mutation probe that deletes the
  failure branch makes the test fail.
- **AC-6 (FR-6)** - Disarming emits a run whose status no longer carries this reason
  (predicate level: two arming states, same diff).
- **AC-7 (FR-2)** - Changing one character of either pattern in any one of the three
  places (workflow, TypeScript, guard) fails the parity test.
- **AC-8 (FR-7)** - Adding a fifth `🚫 **docs-lane: x**` banner to a fixture copy of the
  workflow, with no registry entry, fails the refusal-set test; deleting the
  `governance status transition` registry entry fails it; replacing the witness's
  `failure` with `success` in `decideStatus` fails it.
- **AC-9 (regression for #2157)** - A fixture modelling the issue's sequence (armed while
  clean; `docs-lane` label removed; status-transition commit pushed, so docs-lane does not
  run) is red on `ready-to-merge`. The test must be red on the base branch.
- **AC-10 (FR-5)** - With both a `hold:*` label and an armed transition, the description
  leads with the hold.

## Invariants (must not break)

- **Constitution 1 (offline):** no extension runtime change; the check runs in the
  adopter's own CI on the GitHub API calls that workflow already makes, plus one arming
  read and (only when armed) one file-list read.
- **Constitution 2 (no silent gate):** every new read fails closed and visibly (FR-3,
  FR-4); the status refusal gains its independent second witness; FR-7 makes "one
  witness" a test failure rather than an invisible state.
- **Constitution 3 (blast radius):** ships only through the existing `ready-to-merge.yml`
  template to repos that opted in via `.minspec/`; a repo without governance paths never
  matches FR-1 (a no-op, not a failure).
- **`ready-to-merge` single writer** (`ready-to-merge.yml:15-16`): no second workflow posts
  the context.
- **Monotonic strictness:** this only adds failure; `hold:*`, `ai-review:changes` and
  provenance handling are unchanged.
- **DR-111:** an unarmed, founder Alt-A approval PR's `ready-to-merge` outcome is
  unchanged by this spec (AC-2).
- **DR-029:** nothing here writes a `status:`; acceptance remains a human act.

## Decisions needed (Clarify)

- **DQ-1 - What the witness keys on.**
  - `a` **(rec)** Armed **and** transition (this spec as written). Mirrors exactly the act
    docs-lane refuses, keeps DR-111 self-merge and new-spec PRs green. **Cost:** it does
    not stop a direct, non-auto merge of a status transition by an automated actor holding
    the App token (`gh pr merge` without `--auto`) once the other checks are green.
    docs-lane never covered that path either, so this is not a regression, but it is a
    real residual hole - see DQ-4.
  - `b` Any transition, unconditionally (the literal reading of "mirror the hold pattern").
    **Cost:** reddens every new-spec and new-DR PR (all-`+` patches match) and every Alt-A
    approval PR, so DR-111 self-merge stops working and `--admin` becomes routine.
- **DQ-2 - The outward-facing refusal also has one witness.** The same label-removal
  sequence lets an armed PR acquire a `README`/`CHANGELOG`/`sites/**` change and merge;
  no required check reads `OUTWARD_DOC_PATTERN` (it is consumed by
  `scripts/auto-merge-gate.ts` and docs-lane only).
  - `a` **(rec)** Witness it here, by the FR-5 pattern (armed + outward path → failure).
    **Cost:** scope grows past the issue's ask (one more pattern pinned in a third place);
    a human who arms their own README PR must disarm and merge by hand.
  - `b` Register it as a waiver in FR-7 and leave the fix for later. **Cost:** repeats the
    instance-not-property mistake this issue diagnoses - the waiver records the hole but
    keeps it open, and `sites/**` deploys on merge.
- **DQ-3 - Arming by a human.** Under DQ-1 `a`, a founder who arms auto-merge on their own
  approval PR also goes red.
  - `a` **(rec)** Hold regardless of who armed. **Cost:** one disarm + one click for the
    founder in that case. The App token is shared by every session and drain process, so
    "who armed" is not a reliable human signal (SPEC-222 Context point 2).
  - `b` Exempt arming by a non-bot identity (`auto_merge.enabled_by.type != 'Bot'`).
    **Cost:** a session that falls back to a human credential (the `GH_TOKEN` fallback
    failure in this repo's history) arms as "human" and passes.
- **DQ-4 - The direct-merge path (security finding, outside docs-lane's scope).** Any
  automated actor with merge rights can merge a status-transition PR directly once
  `ready-to-merge` is green; only DR-111's judge is meant to do that.
  - `a` **(rec)** Out of scope here; the dispatcher or founder files a follow-up issue
    (this dispatch has no network permission to file one). **Cost:** the hole stays open
    until then; it pre-dates this spec.
  - `b` Fold it in, e.g. make the witness hold every transition unless DR-111's
    `alta-approval-only` judge would accept the PR. **Cost:** couples the merge gate to
    the Alt-A judge, a much larger change to machinery that ships to adopters.

## Limitations, stated plainly

- `--admin` bypasses the gate by design; this is a governance gate, not a boundary
  against a repo admin.
- The predicate is docs-lane's, so it inherits #2124's known gaps (a `## Status` section
  body, a disposition only in an amendment heading). This spec adds a witness, not
  coverage.
- During an Actions outage, an arming made after the last `ready-to-merge` run is not
  re-judged; the required status keeps its last value, so the PR is held only if that
  value was already red. FR-6 closes the ordinary race, not an outage.

## Why no new DR

Adding a reason to `decideStatus` and two trigger types is a workflow edit one revert
undoes in well under a day (the under-a-day ADR filter). It applies existing decisions
(constitution invariant 2, DR-029, DR-086 §2, DR-111) without a new architectural choice.

## Out of Scope

- Any change to `docs-lane.yml`'s own refusal logic.
- Widening the status predicate (#2124) or making its paths config-driven (SPEC-217) - FR-2
  only keeps the witness aligned with whichever lands.
- The direct-merge path (DQ-4 `a`) and SPEC-222's proposed-DR-with-code hold.

## Follow-ups (tracked)

- DQ-4 `a` needs a GitHub issue; this dispatch could not file one (no network
  permission). The human or dispatcher must file it, or it leaks.

## Alternatives considered and rejected

- **Put the second witness in another workflow, not `ready-to-merge`.** Rejected: only a
  required check gates every merge path, and `ready-to-merge` is the single writer of the
  one required context the hold witness already uses.
- **`require` `governance-transition.ts` from the guard.** Rejected: the guard is
  CommonJS loaded from the base checkout with no build step; a compiled import adds a
  build dependency to the self-forge-defended path. A pinned third copy is the
  established pattern (`HOLD_RE`).
- **Use the webhook payload's `auto_merge`.** Rejected for the verdict (FR-3): a queued
  run may carry a stale payload; the payload stays acceptable for the advisory
  `awaiting-approval` label.
