---
id: SPEC-073
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-073 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - "agent completed" over a repo the agent never changed is the pipeline's own signpost lying
relates_to: [DR-003, DR-033, DR-076, SPEC-044, SPEC-062, SPEC-057, "#1674", "#3386", "#3452", "#2561"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-073 - Design: dispatch completion requires a commit

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
ef84097b, the commit this plan was written on. New code is cited by symbol, because its line
numbers move. requirements.md took its line numbers on an older tree; the map below gives
where each one is now.

## Approach in one paragraph

One new function, `commit_gate_report`, asks the pinned worktree how many commits the branch
holds beyond `origin/main` and, when the answer is not a positive number, prints why and
returns 0 (the same convention as `specify_scope_report`). It becomes a third sibling in the
`if`/`elif` chain at `scripts/dispatch-issue.sh:2518-2525`, between the egress guard and the
specify-only scope guard. On a trip, `hold_no_commit` labels the issue `needs-human-review`,
removes `agent-running` and `agent-ready`, posts a comment that names the cause, and publishes
nothing else. Separately, `run_reviewer_stage` keeps what `gh pr create` said on stderr and,
when no pull request exists, posts the already-scanned verdict on the issue. No new label,
counter, dependency or network call.

## Decisions

The two questions requirements.md left open, each chosen by the planning agent on its
recommendation; not a founder decision. Both can be undone by a normal pull request in under
a day, and neither contradicts an approved sentence: FR-4 and AC-4 leave D1 open by name, and
D2 touches no requirement.

### D1 - On a zero-commit completion: hold for a human (Option A)

Chosen by the planning agent on its recommendation; not a founder decision.

Apply `needs-human-review`, which `scripts/dispatch-ready-check.sh:688` already treats as a
countermand, and leave the worktree in place.

**Why.** Holding adds no human work over what happens today. A zero-commit run is stamped
`agent-done` now, and `reconcile_done_issues` then strips that stamp and adds
`needs-human-review` because no merged pull request exists (`scripts/drain-inbox.sh:1405-1408`).
So the issue already ends at this label, only later and with no reason attached. Option A
reaches the same state at once and says why. It also matches both guards in the same chain.

**Rejected: Option B (re-add `agent-ready`, capped by an attempt counter).** It needs a counter
that does not exist, and its value depends on how often a zero-commit run is a passing flake,
which is unmeasured: the drain log's reconcile line also fires for issues whose pull request
is open but unmerged, so it cannot separate the two. It also could not retry today, because
the branch left by the first attempt makes the next dispatch fail (finding 5 below).

**Rejected: one in-process retry** (not an option in requirements.md, weighed here because
`ESCALATE_RETRIED` shows a bounded retry needs no stored counter, `scripts/dispatch-issue.sh:2426`).
It spends a full agent run on every trip with no base rate to justify it, and in the dirty case
it would have to discard or build over the first attempt's uncommitted work.

**Cost.** A passing flake waits for a person instead of curing itself, in a pile of 464 open
`needs-human-review` issues (counted 2026-10-31) that the founder does not triage. Revisit when
#3452 (branch collision on re-dispatch) is fixed and the rate of these holds has been counted.

### D2 - No new label; the comment carries the cause (Option B)

Chosen by the planning agent on its recommendation; not a founder decision.

`needs-human-review` alone, with dirty or clean named in the comment and the log.

**Why.** `hold_specify_scope` is the closer precedent: a non-security hold with no bespoke label
(`scripts/dispatch-issue.sh:2005-2018`). `agent-quarantined` exists for a security incident,
which this is not. Nothing today would query a new label.

**Rejected: Option A (mint `agent-no-commit`).** One more name to register and document, for a
query nobody has asked for yet.

**Cost.** Finding this failure class in bulk means searching comment text. The comment opens with
a fixed heading so that search is exact, and a label can be added later if the count justifies it.

## What Plan found that the spec did not know

Each was checked against the code on this tree. None changes a requirement.

1. **It is not built.** The chain still has two siblings (`scripts/dispatch-issue.sh:2518-2525`),
   the guess still reads `(create failed?)` (`:1778`) and the only `rev-list --count` measures
   how far the checkout is behind (`:945`). #3386 (build carrier for this spec) is open.
2. **Line numbers moved.** See the map below.
3. **A specify-only zero-commit run is already held, under a false cause.**
   `specify_scope_stray` treats an empty change set as a violation (`:632-634`), so that run
   reaches `hold_specify_scope`, whose comment is headed "the diff left the spec corpus". The new
   guard therefore goes before the scope guard, or FR-3's cause would never be reported there.
4. **FR-1's `git -C "$WORKTREE"` predates the worktree pin.** The worktree's `.git` file is
   writable by the agent, and every later git operation now goes through `agent_worktree_git`,
   which names the directory pinned before the agent started (`scripts/lib/agent-worktree.sh:181`).
   A bare `git -C` would follow a rewritten `.git` to a copy holding whatever commits the agent
   likes, so the guard would be defeated by the thing it checks. `agent_worktree_git` runs the same
   `rev-list` and `status` with that pin added.
5. **A held issue cannot simply be re-dispatched.** `worktree add -b` at `:1413` refuses a branch
   that exists, and each run's worktree path is unique, so the cleanup at `:1390-1394` does not
   fire. Measured on a two-worktree fixture: `fatal: a branch named 'agent/issue-1' already exists`,
   exit 255. #3452 (branch collision on re-dispatch) tracks this. `hold_specify_scope`'s "re-triage
   to try again" hits the same wall; the new comment does not repeat it (P4).
6. **Launcher files do not make a clean run read dirty.** `.agent.log`, `.agent-summary.md` and
   `.review-signals.json` sit in the worktree and are ignored (`.gitignore:16`, `:54`, `:55`), so
   plain `status --porcelain` is correct for FR-3. A test pins this, because a change to the ignore
   list would otherwise turn every clean report into "dirty" with nothing failing.
7. **A read-only role always trips the guard.** `scripts/roles/reviewer.md:14` forbids commits, and
   the one-sentence scope names the reviewer role with no exemption. So a `role:reviewer` run holds,
   and its `.agent-summary.md` stays in the worktree, because the scope says "publish nothing".
   Today none is waiting: 34 open `role:reviewer` issues, 0 of them `agent-ready` (counted
   2026-10-31). This plan builds what the scope says; the hold comment names the summary's path.
8. **R1 is harmless in both directions.** A two-dot count asks which commits the branch has that
   `origin/main` lacks. A concurrent fetch advancing `origin/main` cannot add to or remove from
   that count while the agent's commits are unmerged, and because `worktree add -b` refuses an
   existing branch, a positive count can only come from this run. A test covers the moved ref. No
   fetch is added, which also keeps INV-5.
9. **Existing tests use a stub agent that commits nothing.** `runDispatch` in
   `packages/minspec/tests/helpers/agent-launch-harness.ts` starts one, so
   `dispatch-env-allowlist.test.ts`, `dispatch-author-gate.test.ts` and `agent-launch-sites.test.ts`
   will reach the hold, not the completion path. I believe their current assertions on write counts
   still hold, unverified; the wiring task runs them and gives the stub a commit wherever a test
   really meant a completed run.

### Line map (requirements.md to `origin/main` ef84097b)

| Spec cite | Now | What |
|---|---|---|
| `:406` | `:945` | staleness `rev-list --count` |
| `:703` | `:1413` | `worktree add -b` |
| `:983-1003` | `:1738-1752` | `review_body` egress scan |
| `:1021-1031` | `:1770-1780` | PR lookup, create, discard |
| `:1147-1176` | `:1950-1981` | `run_egress_guard`, `quarantine_publish` |
| `:1189-1213` | `:1994-2018` | `specify_scope_report`, `hold_specify_scope` |
| `:1606-1608` | `:2520-2522` | "impossible to reach the push" comment |
| `:1614` | `:2528` | the push |
| `:1985-1987` | `:2961-2968` | `agent-done` and "Agent completed" |
| `dispatch-ready-check.sh:635` | `:688` | the countermand list |

## Plan-level choices

Implementation choices inside what requirements.md allows, chosen by the planning agent on its
recommendation; not founder decisions.

### P1 - Chain order: egress guard, commit gate, scope guard

The egress guard stays first: a zero-commit run can still leave a secret in `.agent-summary.md`,
and that must keep its stronger `agent-quarantined` outcome. It runs clean on an empty range
(`scripts/lib/agent-egress.sh` tolerates zero added lines). The scope guard goes last, by finding
3. The scan is local, so FR-1's "before any credentialed/network op" still holds on the path past it.

Rejected: commit gate first, which would stop scanning the summary on these runs and lose the
security signal. Rejected: commit gate last, which finding 3 rules out.

`packages/minspec/tests/dispatch-specify-only.test.ts:158` allows at most 600 characters of code
between `run_egress_guard` and `specify_scope_report`. The new `elif` fits. Keep it that way
rather than widening the test.

### P2 - Three outcomes, and an error never reads as zero

| `rev-list` | `status --porcelain` | Result |
|---|---|---|
| positive number | not asked | return 1, nothing printed, publish continues |
| `0` | empty | trip: **clean**, the agent changed nothing |
| `0` | non-empty | trip: **dirty**, the agent wrote work and did not commit it |
| `0` | errors | trip: zero commits, worktree state unreadable. Never says clean |
| errors or not a number | not asked | trip: commit count unreadable, publish withheld |

Invariant 2 of the constitution requires the last two rows: an errored witness fails closed and
visibly. The trip message says "no commit on `<branch>`", which stays true if an agent committed
to some other branch. Only `$BRANCH` is pushed, so that is what is counted.

Rejected: `|| echo 0` as at `:945`, which would report an unreadable repository as a no-op agent.

### P3 - `agent_worktree_git`, by finding 4

Rejected: the literal `git -C "$WORKTREE"`. A test rewrites `.git` to a copy holding extra commits
and asserts the count still reads the pinned directory.

### P4 - The hold comment carries no text the agent wrote

Fixed heading, the cause from P2, the branch, the worktree path, the path of `.agent-summary.md` if
one exists, and how to retry. No file names and no summary text. On a zero-commit run nothing the
egress guard scanned covers uncommitted file names, and the scope says "publish nothing". File names
go to the dispatch log on stderr only.

The retry text is honest about finding 5: the worktree and the local branch must be removed before a
re-triage can dispatch again, and in the dirty case the work must be saved first. It re-reads #3452
when built, in case that fix has changed the steps.

Rejected: listing dirty file names as `hold_specify_scope` lists strays. Those strays come from a
committed diff the egress guard scanned; these would not be scanned.

### P5 - The hold's own writes cannot fail silently

`hold_no_commit` calls `gh_bot_refresh` first: a build can outlive the token (#1355, token expiry
during a build), and the sibling holds do not refresh. The label edit and the comment each print a
WARNING on failure instead of `2>/dev/null || true`, so a failed signpost still leaves a line naming
the issue and its cause. `gh label create` stays best-effort, as in the siblings, because a failed
create is seen when the edit fails. It removes `agent-running,agent-ready`, as the escalation path
does and for the same reason (`:2498-2506`, #2641, escalation keeping its place in the queue).

Its last line must not contain "Agent completed": AC-1 looks for that text.

### P6 - FR-5 keeps `gh pr create`'s stderr, and only in the log

`create_err=$(gh pr create ... 2>&1 >/dev/null) || create_rc=$?` keeps both under `set -e`. The warning
then says one of: `gh pr create` failed with this exit status and this text; or it reported success and
the lookup still finds no pull request. Neither contains `(create failed?)`.

That text never goes in an issue comment. The scan at `:1738-1752` has already run by this point, so
adding it would put unscanned text in the comment and undo R3's mitigation.

### P7 - FR-6 posts the scanned body

When `pr_num` is empty: `gh issue comment` with a fixed heading naming `$combined`, then `$review_body`,
which is the scanned text or the neutral withheld notice. `gh_bot_refresh` has already run at `:1758`.
On a failed post, the WARNING keeps today's wording, verdict and `(not posted)`, so the verdict is never
lost silently. The return stays 0, so the reviewer stage still never throws.

A `REVIEW_VERDICT_BEGIN` block in an issue comment gates nothing: the readers of that marker read
pull-request comments and agent output, not issue comments (`scripts/dispatch-ready-check.sh:383-386`).

## Invariants and how each is proved

| Invariant | Proof |
|---|---|
| INV-1 no silent gate | AC-1, AC-3 and AC-6, plus P5's failed-write cases |
| INV-2 structural gating | AC-7 runs on comment-stripped source, plus the real run in AC-1 |
| INV-3 parent-side witness | the agent fixture acts only in its worktree; P3's redirected `.git` case |
| INV-4 normal run unchanged | AC-2, landed green before the guard exists |
| INV-5 no new network surface | AC-1 asserts the exact set of `gh` writes on a trip |

## Files

| File | Change |
|---|---|
| `scripts/dispatch-issue.sh` | the only production file, as `implements:` says |
| `packages/minspec/tests/dispatch-commit-gate-report.test.ts` | new: the function's outcomes |
| `packages/minspec/tests/dispatch-commit-gate.test.ts` | new: the real dispatcher, AC-1 to AC-7 |
| `packages/minspec/tests/helpers/agent-worktree-harness.ts` | fixture agent that does not commit, or leaves work uncommitted |
| `packages/minspec/tests/helpers/agent-launch-harness.ts` | stub `gh` answers for `pr list` and a failing `pr create` |

Dependency budget: 0 new dependencies.

## Not in this plan

- **Fixing re-dispatch of a held issue.** #3452 (branch collision on re-dispatch) owns it.
- **Worktrees left by holds.** FR-2 requires them; #2561 (worktree leak) owns the disk cost.
- **`agent-done` after a failed push or a failed `gh pr create`.** `:2950-2952` says this stamp is written
  on every path, and `reconcile_done_issues` corrects it. requirements.md limits FR-2 and FR-4 to zero
  commits, so FR-6 adds a comment and leaves the label alone.
- **#1652 (labels before worktree provision).** Named as a sibling by the spec and left to its own issue.
- **Exempting read-only roles.** Finding 7: the scope names them.

## Risks

| Risk | Mitigation |
|---|---|
| A run that rightly changes nothing (already fixed, or a review) now holds | Same end state as today through the reconciler (D1), now with a stated cause. The hold names any summary's path |
| The next editor of `.gitignore` makes clean read dirty | Finding 6's pinned test |
| A long build's dead token drops the hold's signpost | P5 refreshes first and warns on failure |
| Stub agents in existing tests stop reaching completion and a test passes for the wrong reason | Finding 9: the wiring task reads each such test and gives the stub a commit where completion was meant |
