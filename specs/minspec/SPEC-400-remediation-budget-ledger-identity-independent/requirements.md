---
id: SPEC-400
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; the remediation runaway guard is scripts/remediate-pr.sh
aspects: [drain, remediation, runaway-guard, silent-gate, fail-closed, identity]
depends_on: []
relates_to: ["#1013", "#965", "#1012", "DR-060", "SPEC-387"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  the counting and identity section of `scripts/remediate-pr.sh` (count_markers_json,
  resolve_author_identity, the runaway-guard block) and its existing test file(s). None of
  it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-400: The remediation budget ledger survives a change of posting identity

> **This is a SPECIFICATION ONLY.** Written for issue
> [#1013](https://github.com/AIClarityAU/minspec/issues/1013) (an operator or PAT change
> silently resets both remediation caps). Nothing is built until this spec is approved,
> after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> No decision record yet: the choice is a counting rule in dev-time tooling, undoable in
> well under a day (DR-359 ADR filter). If Clarify picks a marker payload format (D1
> option b), that format outlives its first comment and may warrant one. The existing
> guard's rationale is in **DR-060** (verified only by grep that it mentions the marker
> scheme; I did not re-read it end to end).

## One-Sentence Scope

When the account posting remediation marker comments on a pull request differs from the
account that posted the earlier ones, the runaway guard either still charges the earlier
markers to the budgets or stops visibly and hands the PR to a human, and never recounts an
already-exhausted PR from zero.

## Context: what exists today, and the gap

Read on this branch's base, in `scripts/remediate-pr.sh`:

- **Two budgets, counted from comments.** `ATTEMPT_MARKER` (cap `MAX_ATTEMPTS`) and
  `CRASH_MARKER` (cap `MAX_CRASHES`) are HTML-comment markers appended as a body's last
  line by `post_marked_comment` (~line 809). The ledger is the PR's comment list. There is
  no other store.
- **The count is author-filtered.** `count_markers_json` (~line 544) charges a comment only
  when the marker is terminal text of the body AND the comment's login (lower-cased,
  `[bot]` stripped) is in the allowlist. An empty allowlist counts nothing (#3592).
- **The allowlist is the current identity.** In the runaway-guard block (~line 1099)
  `AUTHOR_ALLOW` is `resolve_author_identity` (`gh api user` login, or `minspec-sdd[bot]`
  on an App token's 403) plus optional `MINSPEC_REMEDIATE_AUTHOR_LOGINS`. The env var only
  widens an established identity.

**The defect, stated as mechanism (RCDD, DR-003).** The ledger's key is the *current
posting identity*, resolved fresh each run, while the entries were written under whatever
identity was current *then*. Nothing records which identities wrote the ledger, and no
gate compares the two. When they differ, every earlier marker fails the author filter,
`ATTEMPTS` and `CRASHES` read 0, and a PR that already hit both caps gets a fresh set of
runs. Nothing is logged: the run proceeds as "Attempt 1/N". That is the un-bounding
direction, and a silent one (constitution invariant 2, no silent gate). Realistic triggers
named in the issue: operator machine swap, PAT rotated to another account, App token vs
user token.

**Why the author filter itself stays.** It exists so a human or the reviewer bot quoting a
marker cannot spend a budget (#965, #3592). This spec keeps that protection. It changes
what is considered "ours", not whether authorship matters.

## Functional requirements

- **FR1: Detect an unrecognised marker author.** On each guarded run, besides the filtered
  counts, the guard computes for each marker the count of terminal-position marker
  comments by authors NOT in the allowlist ("foreign marker comments"). This uses the
  comment JSON already read (no extra API call).
- **FR2: Never silently recount from zero.** If foreign marker comments exist, the guard
  takes the action D1 selects. Under no option may it proceed as if the PR had a clean
  ledger while foreign marker comments are present and unexplained.
- **FR3: Visible when it triggers.** Whatever D1 selects, the run prints one line to stderr
  naming the marker class, the count of foreign comments, and the foreign login(s), and
  any comment or label the run posts names the same facts, so the human can see the
  identity change was the cause.
- **FR4: Stopping fails closed for the bounded paths.** If D1 selects stop-and-hand-over,
  the PR gets `needs-human-review` through the same path the unresolved-identity case uses
  today (the `gh label` / `gh pr edit` branch, or `dlg_to_human` for delegated paths), and
  no agent runs.
- **FR5: Existing allowlist behaviour is unchanged.** A comment by a login in the
  allowlist is counted exactly as today; a marker not in terminal position is never
  counted by any rule here; the empty-allowlist rule (#3592) is untouched.
- **FR6: Human and bot quotes still do not spend a budget.** Whatever rule D1 selects must
  keep a human's or the reviewer bot's comment that merely ends with a marker string from
  charging a budget, or must stop visibly rather than silently over- or under-count (see
  D1 trade-offs; this is the hard constraint).
- **FR7: Cap notice dedup unaffected.** `cap_notice_decision` keeps its own rule (over-count
  is the unsafe direction there); this spec does not change when the one-shot capped notice
  posts.
- **FR8: No new network call and no new store.** The ledger stays the PR's comments
  (invariant 1; no stateful store, as the code comment at ~line 1067 requires).

## Acceptance criteria

- **AC1** (FR1, FR2). Fixture: a PR with MAX_ATTEMPTS terminal ATTEMPT_MARKER comments by
  `old-op`, current identity `new-op`, no env var. The run does NOT report "Attempt 1/N"
  and does not start an agent. Red on the base, which does.
- **AC2** (FR3). The same fixture prints a stderr line containing `old-op`, the marker
  class and the count.
- **AC3** (FR4). The same fixture, on the non-delegated path, adds `needs-human-review`;
  on a `dlg-rerun` / `DLG_RED_UPDATE` path it calls `dlg_to_human`. Neither path runs an
  agent.
- **AC4** (FR5). A PR whose markers are all by the current identity counts and caps
  exactly as before (existing tests unchanged and green).
- **AC5** (FR6). A human-authored comment ending in the attempt marker, on a PR with zero
  genuine attempts, does not push the PR toward its cap under the chosen D1 option (or
  stops visibly, if the option cannot tell it apart; the spec states which).
- **AC6** (FR2, mixed). Markers by both the current identity and a foreign login: the
  current identity's are counted; the foreign ones trigger FR2 rather than being dropped.
- **AC7** (FR8). No `gh` verb beyond those the guard block already uses appears in the
  diff; a test asserts the `gh` call set is unchanged on a run that triggers FR2.
- **AC8** (boundary). Zero foreign comments, and exactly one foreign comment, each tested:
  one is enough to trigger.

## Invariants this change must not break

1. Constitution 2, no silent gate: a recount from zero never happens quietly; a stop is
   visible on stderr and on the PR.
2. Constitution 1, offline core: no new network call (FR8).
3. #3592: an unprovable author is never charged, and an empty allowlist counts nothing.
4. #3037 / #3054: identity resolution accepts only a login-shaped value and only the
   positive installation-token rejection as "this is the App".
5. The two budgets stay independent (a crash never spends an attempt, and the reverse).
6. Markers are only emitted by `post_marked_comment`, sanitised, terminal-position.

## Out of scope

- Other ways a PR escapes its budget (#1012). This spec covers identity change only.
- Changing the default caps, or the rerun budget's semantics.
- Cross-PR ledgers (a branch re-opened as a new PR).

## Decisions needed (Clarify)

### D1: How should an identity change be handled?

- **(a) Detect and stop (rec).** Foreign terminal-marker comments trigger stop-and-hand-over
  (FR4). Smallest change, no format change, works on PRs already carrying markers. Cost:
  it cannot tell a genuine old identity from a human who pasted a marker at the end of a
  comment, so a quote can hand a PR to a human early (a safe-direction false stop; visible
  by FR3). It also stops a PR for a legitimate identity change that the operator would
  have wanted to continue.
- **(b) Structured payload in the marker.** The marker carries a signed or structured
  payload (for example run id, class, ordinal), counted regardless of login. Fully
  identity-independent. Cost: a signature needs a secret that itself survives the operator
  change (else the same problem moves), an unsigned payload is forgeable by anyone who
  can comment, and every existing PR's old-format markers need a fallback rule anyway.
- **(c) Persist the accepted login set.** Each marker comment also records the login
  set accepted at the time, and the guard unions the sets. Cost: a writer-side identity
  claim is just text a commenter can forge, and it adds a format change like (b).
- **(d) Count foreign markers too, behind an env opt-in.** Widening
  `MINSPEC_REMEDIATE_AUTHOR_LOGINS` is today's manual mitigation; making it the only path
  keeps the silent reset. Not recommended on its own.

**Recorded selection: the recommended option,** (a), detect and stop. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.

### D2: After a stop under (a), how does the operator continue?

- **(a) Add the old login to `MINSPEC_REMEDIATE_AUTHOR_LOGINS` (rec).** Existing, already
  documented lever; the FR3 line tells them which login to add. Cost: manual, per
  machine.
- **(b) A one-shot `--accept-author <login>` flag.** Cost: a new interface to maintain.

**Recorded selection: the recommended option,** (a), add the old login to `MINSPEC_REMEDIATE_AUTHOR_LOGINS`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.

## Follow-ups (tracked)

- #1012 other budget-escape paths. Sibling of this issue; tracked there.
- #965 separate crash counter. Merged precursor (history only).
