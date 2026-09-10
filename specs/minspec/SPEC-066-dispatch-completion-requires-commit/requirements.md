---
id: SPEC-066
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — "agent completed" over a repo the agent never changed is the pipeline's own signpost lying
relates_to: [DR-003, DR-033, DR-076, SPEC-044, SPEC-062, SPEC-057]
implements: [scripts/dispatch-issue.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Dispatch completion requires a commit: a pushed, PR-less, un-reviewed branch must never read "done" (Requirements)

> Materializes **[#1674](https://github.com/AIClarityAU/minspec/issues/1674)** —
> *"an agent that commits nothing is reported as completed — empty branch pushed, PR
> impossible, review verdict discarded."* Sibling of **#1652** and **#1656**, named in
> #1674's own footer as "three ways an issue leaves the pipeline in a state its labels
> misdescribe." No DR underlies this design and none is minted by it: per the DR-359 ADR
> filter, every choice below is a same-day-reversible change to one script
> (`scripts/dispatch-issue.sh`), not an irreversible architectural commitment.

## One-Sentence Scope

After the dev/security/reviewer agent process exits inside `scripts/dispatch-issue.sh`,
assert the branch actually gained a commit **before** any credentialed/network op runs
(push, PR create, `agent-done` labelling, or the "Agent completed" line) — on zero commits,
publish nothing and say so; and whenever an independent-reviewer verdict is computed but no
PR exists to carry it, post that verdict to the issue instead of discarding it — so the
pipeline can never call a no-op "done" nor drop a computed gate signal on the floor
(constitution invariant #2, no silent gate).

## Context (grounded, with `file:line` evidence)

- **The completion path currently asserts nothing about commits.** `dispatch-issue.sh`
  worktrees are cut with `git worktree add -b "$BRANCH" "$WORKTREE" origin/main`
  ([`:703`](../../../scripts/dispatch-issue.sh#L703)) — the branch's base is `origin/main` at
  creation time. After the agent process exits, the parent runs the egress guard and (in
  specify-only mode) the scope guard, then unconditionally pushes:
  `git -C "$WORKTREE" push -u origin "$BRANCH"` ([`:1607`](../../../scripts/dispatch-issue.sh#L1607)).
  Nothing between the agent exiting and this push asks `git rev-list --count
  origin/main..HEAD`. The one `rev-list --count` call in the file
  ([`:406`](../../../scripts/dispatch-issue.sh#L406)) measures how far the *checkout* is
  *behind* `origin/main` before the run starts — an unrelated staleness guard — not whether
  the branch gained anything by the time the run ends.
- **`git push -u origin "$BRANCH"` succeeds even with zero commits ahead**, because the
  branch is a brand-new ref on `origin` — pushing a branch whose tip equals `origin/main`
  still creates that ref successfully. The push exit code cannot distinguish "real work
  landed" from "nothing changed," which is exactly why #1674's observed run printed no
  push failure at all.
- **PR creation is the first point that notices, and it degrades to a guess.**
  `gh pr create` ([`:1024-1025`](../../../scripts/dispatch-issue.sh#L1024)) is run with
  `2>/dev/null || true`, discarding whatever `gh` actually said. When it produces no PR
  number, the parent emits `"WARNING: no PR for $BRANCH (create failed?) — AI review
  verdict: $combined (not posted)"` ([`:1029`](../../../scripts/dispatch-issue.sh#L1029)) —
  `(create failed?)` is a parenthesised guess, not a diagnosis; the actual cause in #1674's
  case (zero commits, so GitHub has nothing to open a PR against) is never named, and the
  real `gh` stderr that would have said so is thrown away by the redirect.
- **The independent reviewer's verdict is computed and then dropped.** `run_reviewer_stage`
  computes `combined` (`ai-review:pass` / `ai-review:changes`, DR-033 §6) and builds
  `review_body` to post as a PR review — but only reaches that post if `pr_num` is non-empty
  ([`:1007-1030`](../../../scripts/dispatch-issue.sh#L1007)). When `pr_num` is empty, the
  function logs the WARNING above and `return 0`s — `combined` and `review_body` are never
  written anywhere else. A verdict that says `ai-review:changes` (the correct read on #1506,
  per #1674's own report) reaches nobody. That is exactly the shape constitution invariant #2
  forbids: a computed gate signal, swallowed.
- **The completion signpost is unconditional on this path.** Once past the push, the parent
  strips `agent-running`/`agent-ready`, adds `agent-done`
  ([`:1985-1986`](../../../scripts/dispatch-issue.sh#L1985)), and unconditionally prints
  `"Agent completed issue #$ISSUE (role: $ROLE). Worktree: $WORKTREE"`
  ([`:1987`](../../../scripts/dispatch-issue.sh#L1987)) — there is no branch of this code that
  reaches `1987` without having reached the label/print regardless of whether the branch
  carries any commit.
- **A structurally identical guard already exists for a different publish-blocking
  condition and is the template this spec follows.** The egress guard
  (`run_egress_guard` / `quarantine_publish`,
  [`:1147-1172`](../../../scripts/dispatch-issue.sh#L1147)) and the specify-only scope guard
  (`specify_scope_report` / `hold_specify_scope`,
  [`:1189-1213`](../../../scripts/dispatch-issue.sh#L1189)) are both `elif` siblings in the
  **same** `if` chain that gates the push at `:1607` — "impossible to reach the push without
  having passed both," per the comment at
  [`:1155-1157`](../../../scripts/dispatch-issue.sh#L1155). Neither publishes anything on
  trip; both label `needs-human-review`, comment the reason, and leave the worktree intact
  for inspection. This spec's zero-commit guard is a third sibling in that same chain, not a
  new mechanism.
- **`needs-human-review` already countermands re-dispatch.**
  `dispatch-ready-check.sh` refuses to treat an issue as `agent-ready` while any of
  `needs-review, needs-info, needs-human-review, agent-quarantined, agent-done,
  agent-escalated` is present ([`:635`](../../../scripts/dispatch-ready-check.sh#L635)). A new
  label minted for this failure class inherits no countermand protection on its own — it must
  co-occur with `needs-human-review` (or be added to that list) or a re-drain could pick the
  issue straight back up, exactly the failure #1674 is about.

## Functional Requirements

- **FR-1 (commit-count gate).** Immediately after the agent process exits and before any
  credentialed/network op (push, `gh pr create`, `gh issue edit`, `gh issue comment`), compute
  `git -C "$WORKTREE" rev-list --count origin/main.."$BRANCH"` (the same `origin/main` base the
  worktree was cut from, `:703`). A count of **zero is a hard failure**, checked as a sibling
  `elif` in the existing egress-guard / specify-only-scope-guard chain (`:1147-1213`) — so it
  is structurally impossible to reach the push at `:1607` with zero commits, the same guarantee
  that chain already gives the other two guards.
- **FR-2 (no publish on zero commits).** On the FR-1 trip: no `git push`, no `gh pr create`,
  no `agent-done` label, and no "Agent completed" line. The worktree is left intact (matching
  `hold_specify_scope`/`quarantine_publish`) so a human can inspect exactly what the agent
  wrote.
- **FR-3 (name the real cause — dirty vs. clean).** The FR-1 trip path determines and reports
  which of the two distinct faults occurred, using `git -C "$WORKTREE" status --porcelain`:
  **dirty** (the worktree has uncommitted changes — the agent wrote real work and failed to
  commit it) vs. **clean** (no changes at all — the agent did nothing). These are different
  faults with different remediation, per #1674's own framing, and the report (stderr log line
  + issue comment) must say which one applies, never a generic "no commits."
- **FR-4 (visible, non-`agent-done` signpost).** The issue is labelled to reflect that the run
  did **not** complete: `agent-running` is removed, `agent-done` is **not** applied, and the
  issue receives a comment stating plainly that the agent produced no commit, which of FR-3's
  two cases applies, and where the worktree is. The exact re-dispatch/hold label policy is
  **Decision D1** below — this FR fixes only the "must not silently read as complete" half,
  not whether the issue re-queues itself or waits for a human.
- **FR-5 (real reason, not a guess, on PR-create failure).** Capture `gh pr create`'s actual
  stderr (currently discarded via `2>/dev/null`, `:1024-1025`) instead of throwing it away. The
  `(create failed?)` guess at `:1029` is replaced by the real cause: given FR-1, a `pr_num`
  still empty after `gh pr create` at this point in the flow can no longer be the zero-commit
  case (that already returned at FR-2, before this code runs) — so the warning names whatever
  `gh` actually reported (rate limit, permissions, transient API error), never a guess.
- **FR-6 (a computed verdict is never discarded — invariant #2).** When `run_reviewer_stage`
  computes `combined` and `review_body` but `pr_num` is empty, post that verdict as an issue
  comment (through the same egress-scan gate `review_body` already passes at
  [`:1954-1968`](../../../scripts/dispatch-issue.sh#L1954), so an injected-diff-steered
  verdict is withheld the same way there too) instead of only logging the WARNING and
  returning. This is a distinct residual case from FR-1 through FR-4: it fires only when
  commits exist (the branch pushed, `run_reviewer_stage` was reached) and `gh pr create`
  itself failed for some other reason.

## Invariants (must not be broken)

- **INV-1 (no silent gate — constitution #2).** Neither "the branch has no commits" nor "a
  review verdict was computed" may end a run silently. Both are reported: the first blocks
  publish outright (FR-1/FR-2); the second is redirected to the issue rather than dropped
  (FR-6).
- **INV-2 (structural, not best-effort, gating).** FR-1's check lives in the same `if`/`elif`
  chain as the egress guard and the specify-only scope guard — a chain already documented as
  "impossible to reach the push below without having passed both" (`:1155-1157`). The new
  guard must preserve that property for all three siblings, not add a separate `|| true`-style
  check that could be skipped.
- **INV-3 (independent second witness, not a rewrite of the first).** This spec does not
  change how or when the agent commits — that remains entirely up to the dispatched agent. It
  adds a check the PARENT runs on the agent's output, so a broken/confused/short-circuited
  agent process is caught regardless of what it did or didn't do.
- **INV-4 (a positive result is unaffected).** A normal run — agent commits, branch pushes,
  `gh pr create` succeeds — must be byte-identical in behaviour to today: still pushes, still
  opens a PR, still labels `agent-done`, still prints "Agent completed." FR-1 is purely
  additive on the zero-count branch.
- **INV-5 (Tier-0 / no new network surface).** This spec adds no new `gh`/network call beyond
  the ones the dispatcher already makes (an issue comment on the existing FR-6 path uses the
  same `gh issue comment` primitive already used elsewhere in this file); `git rev-list` and
  `git status --porcelain` are local-only.

## Decisions needed (Clarify)

- **D1 — Hold for a human, or re-queue for automatic retry, on a zero-commit completion?**
  #1674's own proposed fix says *"Label the issue so it is visibly unfinished and
  re-dispatchable"* — i.e., let the drain pick it up again automatically. But every existing
  sibling in the same guard chain (`quarantine_publish`, `hold_specify_scope`) does the
  opposite: both apply `needs-human-review`, which `dispatch-ready-check.sh:635` uses to
  **countermand** re-dispatch until a human clears it (re-triage via
  `scripts/triage-inbox.sh <N>`, per `hold_specify_scope`'s own comment text). These two
  intents are in direct tension, and this spec does not resolve it on the filer's behalf.
  - **Option A — reuse the existing hold pattern (`needs-human-review`, countermanded,
    worktree left for inspection).** *Pro:* zero new machinery; identical, already-tested
    shape to the other two guards in the same chain; fails toward safety if the zero-commit
    case turns out to be a systematic agent/prompt bug rather than a one-off flake (no risk of
    silently burning repeated agent runs on the same broken issue). *Con:* directly contradicts
    the issue's stated "re-dispatchable" ask; a genuinely transient flake now costs a human a
    look instead of self-healing.
  - **Option B — re-add `agent-ready`/`agent-ready-specify` (whichever this run used) so the
    drain retries automatically**, capped by an attempt counter to prevent an infinite silent
    retry loop on a systemic failure (the counter mechanism does not exist yet and would be new
    surface). *Pro:* matches the issue's explicit wording; self-healing for the (plausibly
    common) transient-flake case, in the spirit of the autonomous drain (SPEC-062). *Con:* new
    state to build (an attempt counter/backoff) with no evidence yet on how often this actually
    fires — DR-086's "evidence-incomplete" stop class applies directly; a bug that reliably
    reproduces the zero-commit condition would silently spend agent runs in a loop with nobody
    told until the counter trips, which is its own smaller version of the exact "silent" failure
    #1674 reports.
  **Recommendation:** Option A. Its cost is a real one — it does not give the filer the
  "re-dispatchable" behaviour they asked for — but every comparable guard in this file already
  fails this way, there is no attempt-counter mechanism to safely bound Option B today, and a
  human cost of "look once, then re-triage" is cheap next to another silent-completion
  incident. Revisit once Option B's retry-counter groundwork exists and this failure's real
  base rate is known.
- **D2 — A new label for this specific failure class, or fold it into `needs-human-review`
  alone?** `agent-quarantined` is precedent for minting a cause-specific label alongside
  `needs-human-review` (egress-guard trips get their own label; scope-guard trips do not).
  - **Option A — mint `agent-no-commit` (or similar), always paired with
    `needs-human-review`** so it inherits the existing countermand protection
    (`dispatch-ready-check.sh:635` would need this label added to its list, or the pairing with
    `needs-human-review` alone already suffices without a list edit). *Pro:* triage/dashboard
    can query this exact failure class the way `agent-quarantined` already lets egress trips be
    queried; matches an existing precedent in the same file. *Con:* one more label to register
    and document; only useful if this failure recurs often enough to want to track it
    separately from other holds.
  - **Option B — no new label; the issue comment text (FR-3's dirty/clean distinction) is the
    only place the specific cause lives**, matching `hold_specify_scope`'s own shape (no
    bespoke label beyond `needs-human-review`). *Pro:* no vocabulary growth for a detail the
    comment body already carries in full. *Con:* cannot be queried/filtered as a label; a human
    or dashboard has to read comment text to find this failure class in bulk.
  **Recommendation:** Option B to start (match the closer precedent — `hold_specify_scope`,
  which is the same *scope-guard*-shaped hold this spec's FR-1 most resembles, not the
  egress-guard's security-incident shape that justified `agent-quarantined`). Cost: if this
  failure turns out to recur often, a human has to grep comment text rather than filter a
  label until someone mints one later.

## Acceptance Criteria

- **AC-1 (FR-1, FR-2).** A worktree/branch fixture with zero commits ahead of `origin/main`
  (mechanical `git worktree add` + no commit) causes the completion path to print no "Agent
  completed" line, run no `git push`, run no `gh pr create`, and apply no `agent-done` label —
  asserted against the dispatcher's completion routine in isolation (stubbed `git`/`gh`).
- **AC-2 (INV-4, negative case).** The identical harness with one real commit on the branch
  still pushes, still opens a PR, still labels `agent-done`, and still prints "Agent
  completed" — proving AC-1's guard does not regress the normal path.
- **AC-3 (FR-3).** Two zero-commit fixtures — one with uncommitted worktree changes present,
  one with a fully clean worktree — produce distinguishable output (log line and/or issue
  comment) naming "dirty" vs. "clean" respectively; a single generic "no commits" message
  fails this criterion.
- **AC-4 (FR-4, D1).** On the zero-commit path, `agent-running` is removed and `agent-done` is
  never applied; whichever label policy D1 resolves to (hold or re-queue) is asserted
  explicitly, not left as an accidental side effect of label-removal ordering.
- **AC-5 (FR-5).** A fixture where `gh pr create` fails for a reason OTHER than zero commits
  (e.g., a stubbed non-zero exit with captured stderr) surfaces that captured stderr in the
  warning, not the literal string `(create failed?)`.
- **AC-6 (FR-6).** A fixture with real commits (branch pushes) where `gh pr create`/`gh pr
  list` both stub to "no PR", combined with a stubbed reviewer verdict, asserts the verdict
  text is posted via `gh issue comment` to the issue rather than only appearing in a stderr
  WARNING — the distinguishing regression test named in #1674's own "Test" section, third
  bullet.
- **AC-7 (INV-2).** A structural/lint-level check (or a code-reading test) confirms the FR-1
  guard is a sibling `elif` in the same chain as `run_egress_guard`/`specify_scope_report`,
  not a separate `if` reachable around it.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | `git rev-list --count origin/main.."$BRANCH"` misreports if the worktree's `origin/main` ref is stale (fetched before the agent ran, further commits landed on main meanwhile) | Reuse the SAME `origin/main` ref the rest of the file already measures against (`:1191`, `:1849`) rather than a fresh fetch — consistent with how every other three-dot comparison in this script already works; a genuinely stale `origin/main` is the pre-existing staleness class SPEC-057/`:406` covers, not new risk this spec introduces |
| R2 | D1 resolving to "hold" (Option A) leaves a transient one-off agent flake stuck for a human that a retry would have silently fixed | Named explicitly in D1; the recommendation accepts this cost pending real base-rate evidence |
| R3 | FR-6's issue-comment path could itself be steered by a prompt-injected diff into echoing something sensitive from the (read-only) reviewer's context | FR-6 explicitly routes through the SAME egress-scan gate `review_body` already passes before a PR-review post (`:1954-1968`) — no new unscanned publish channel is created |

## Traceability

- **Issue:** [#1674](https://github.com/AIClarityAU/minspec/issues/1674) — this spec's
  trigger, itself found while shepherding [#1506](https://github.com/AIClarityAU/minspec/issues/1506).
- **Siblings named by #1674:** [#1652](https://github.com/AIClarityAU/minspec/issues/1652),
  [#1656](https://github.com/AIClarityAU/minspec/issues/1656) — "three ways an issue leaves
  the pipeline in a state its labels misdescribe." Not covered here; each is its own dispatch.
- **Template guards this spec extends (same file, same chain):** `run_egress_guard` /
  `quarantine_publish` (`:1147-1172`), `specify_scope_report` / `hold_specify_scope`
  (`:1189-1213`).
- **Countermand mechanism this spec's labelling must respect:**
  [`scripts/dispatch-ready-check.sh:635`](../../../scripts/dispatch-ready-check.sh#L635).
- **Owning umbrella:** [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  (this file's declared owner — this spec modifies `scripts/dispatch-issue.sh`, it does not
  take over ownership of it); sibling autonomous-pipeline work at
  [SPEC-062](../SPEC-062-autonomous-pr-drain/requirements.md).
- **Constitution:** invariant #2 (no silent gate) is this spec's core rationale, cited
  directly in Context and FR-6.
- **No DR filed.** Per the DR-359 ADR filter, D1/D2 are same-day-reversible script-behaviour
  choices, not irreversible architecture — if either later needs revisiting, a normal PR
  suffices.
