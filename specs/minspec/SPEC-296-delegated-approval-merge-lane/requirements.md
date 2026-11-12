---
id: SPEC-296
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - same epic as DR-119 (the delegated-approval merge lane record)
aspects: [merge, approval, delegation, bot, fail-closed, strict, governance, tripwire]
depends_on: []
relates_to: ["#3379", "#3084", "#3104", "#3380", "#3036", "#3039", "#3212", "#3528", "DR-070", "DR-086", "DR-108", "DR-111", "DR-112", "DR-119"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `scripts/alta-self-merge.ts`, one new judge under `scripts/lib/`, and new tests. None of
  it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-296: A check on main merges a pull request that carries only one delegated spec approval, one at a time

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3379](https://github.com/AIClarityAU/minspec/issues/3379). Nothing is built until this spec
> is approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> Design rests on **DR-119** (delegated approvals land through a lane of their own, `status:
> accepted` on main, PR #3499). A choice that record makes is recorded here as decided and is
> not reopened. Sections cited as "the record's section N" are DR-119's.

## In plain terms

The bot records a spec approval under its own name after an AI reviewer passed the spec, then
the approval pull request waits for the founder's merge, because no rule lets anything else merge
it. This spec builds the check DR-119 decided on: it runs from `main`, proves a pull request
carries one approval and nothing else, proves the approved text is what the reviewer passed,
requires CI green on the exact commit, and merges with no founder keystroke and no model. It works
through them one at a time, because under the strict ruleset each merge puts the rest behind.

What this costs: a wrong approval the AI reviewer missed reaches `main` with no human look. That
risk was accepted in DR-119 and is not reopened here.

## Measured state (base fe4682c9, 2026-11-02 about 03:20 UTC, read-only)

Line numbers rot; Plan re-reads them.

**The gap is live.** #3084 (green delegated-approval pull requests have no merger but the founder)
shows closed at 2026-10-31T03:40:33Z, the same second #3381 (the decision record) merged, yet nothing
that merges these exists. `judgeApprovalOnly` still denies a bot author
(`scripts/lib/alta-approval-only.ts:298`). #3379 says it blocks closing #3084, so this spec treats
that closure as premature and does not depend on it.

**The record's 24 pull requests are mostly gone.** Of the 24 in the record's Context table, measured
2026-10-30: 16 are merged, every one by `harvest316`, between 2026-10-31T05:45Z and 2026-11-02T03:04Z,
including #3357, which the table refused for a red `test`. Three are closed unmerged (#3362, #3088,
#3090). Five are open (#3374, #3085, #3087, #3089, #3091).

**So the 2026-10-30 replay does not survive as a live test.** The table names pull request numbers
and one base (`f686cb25`), but no head per pull request, and merged pull requests now fail
"open" by construction. The issue's "replay the 24" test is therefore kept as fixtures of the classes
the table names (FR-15), and today's open set is measured below instead.

**Open delegated-approval pull requests today: 33.** I ran the record's section 1 conditions over them,
read-only, using the repo's own predicates (`checkApprovalActor`, `judgeHeadReviewPass`,
`openClarifyDetail`, `specNotApprovable`, `stripLifecycleStrict`, `specHash`). Every one is behind
`main`, so this is section 2's screening judgement and not a merge judgement.

| Count | Pull requests | Outcome |
|---|---|---|
| 28 | #3374, #3401, #3402, #3421, #3443 to #3447, #3476 to #3479, #3507 to #3511, #3516 to #3520, #3522 to #3526 | Pass every condition evaluated |
| 1 | #3085 | Refused: `hold:human` alone |
| 2 | #3087, #3091 | Refused: `hold:human`; Clarify also open on `main` |
| 1 | #3089 | Refused: `hold:human`, `ai-review:changes`, Clarify open, the record's hash is not the base's or the head's, and the verdict is not on the pull request that last changed the spec (#3125) |
| 1 | #3480 | Refused: `ai-review:changes`, `ai-review` check failed |

Limits of that run: it did not evaluate the merge-commit overlap rule in section 1 item 2; item 10 was
read on the current behind heads, and the update makes new ones; `specNotApprovable` read config and
epics from a checkout one commit behind the base.

Every record carries exactly `RECORD_KEYS` plus `actor`, `basis`, `act`, `author`, `verdictBy`. Every
pull request moves its spec from `specifying` to `planning`. Each diff is two files.

**Other facts the build depends on:**

- Repeat-fix share today: 4.4% (8 of 180, `readRepeatFixShare` at fe4682c9) against the 13% tripwire.
  DLG-001 has `reviewBy: 2027-01-17`; past that date section 1 item 7 refuses every pull request until
  the delegation is renewed.
- `readPrFacts` (`scripts/alta-self-merge.ts`) reads `user.login` and not `user.type`, so item 2 needs a
  new read. The seam's own test fixture has a `minspec-sdd[bot]` login with no `type`.
- `readContentPullRequest` (`scripts/lib/content-pr.ts`) skips commits that do not change `specHash()`, so
  a `status:` or `phases:` sweep such as #3419 is not mistaken for the content change in item 9.
- On one measured head (#3373), the `CI` workflow finished last: 8.5 minutes, 02:58:14 to 03:06:44. `Secret
  scan`, `DR id collision` and `docs-lane` also run on these heads, are not in the workflow's
  `workflow_run` list, and finished earlier there. `ai-review` carried in 22 seconds.
- `alta-self-merge` ran 228 times in the 24 hours to 03:20 UTC. The App's core limit is 5000 calls an
  hour, shared with every agent session (4586 left when read).
- `delete_branch_on_merge` is true. The default squash message is `COMMIT_MESSAGES`, and the merge API
  accepts `commit_message`.
- `delegated-approval-caller.ts:499-505` reports an error every run for a `dlg-approve/*` branch with no
  open pull request, and otherwise re-creates a deterministic branch. So the refused-update path must
  delete the branch, as the record says.

## Two premises in the record that the build must not lean on

Both are measured or flagged here, and neither changes a decision the record makes.

**"GitHub refuses a stale merge" (the record's section 2; "the ruleset still decides", its Cost section).**
The App reads `current_user_can_bypass: pull_requests_only` on ruleset 18352261, since queue item mr112 of
2026-10-27. `--admin` is a flag of the `gh` client, and this lane calls the REST merge endpoint, which has no
such flag. I believe, unverified, that a bypass actor's REST merge is not refused for a behind or red head;
only a real merge could test that. What does hold server-side is the head pin: `sha=` refuses a moved head
(DR-112's section on enforcement). So the judge proves up-to-date and green itself, and FR-10 and FR-11 do
not assume GitHub would catch a miss.

**"GitHub refuses an update when `main` has moved a workflow file" (the record's section 2).** A measurement of
2026-09-28 found `PUT .../update-branch` succeeded under the App token on three pull requests (#2125, #2188,
#2166) whose base had moved workflow files: the `workflows` scope gates `git push`, not this endpoint. That
reading is one session's note, not re-run here. So the refused-update path stays, as decided, and FR-9 keys
it on the response actually returned, never on a prediction from the file list. The endpoint's
`Updating pull request branch.` reply is an acknowledgement and not a result.

## Decided by DR-119 (recorded, not asked)

- A separate lane in the repo, not a carve-out for the runner's helper, and not a widened approval-only judge.
- Serial, oldest first, one per merge; no batching, no merge queue, no `strict` change, no native auto-merge.
- No second-reviewer model per approval: section 1 items 6 and 9 replace it.
- It lives in `scripts/alta-self-merge.ts` plus a new judge in `scripts/lib/`. No workflow file changes and no
  `~/.claude` change. The runner's helper keeps refusing these.
- Stays the founder's: memory-fabric, plan artifacts, any decision record, the constitution,
  `.minspec/delegations.json`, DR-086, the bot-merge record, `--admin`, and any `hold:*` pull request.
- #3104 (Clarify pending with no decision text detected) is an inherited hole, named under the record's Cost.

## Functional requirements

### The judge

**FR-1. A pure judge holding every condition.** A new module in `scripts/lib/` exposes one judge over facts
and a git byte reader, with no other input and no network. It holds all eleven conditions of the record's section 1
as written, and returns `eligible` only when every guard passes. Any unreadable or unexpected input returns a
refusal marked as an error. It does not throw.

**FR-2. The run-level conditions.** Before any pull request is judged, the lane reads from the base tip object,
not the checkout: `docs/decisions/DR-119.md` `status:` (item 1) and the tripwire (FR-12).

- The repo must be `AIClarityAU/minspec`, and memory-fabric is refused by a hard-coded name.
- A readable status other than `accepted` is a green run that merges nothing and says why in its summary.
  An unreadable status is red.

**FR-3. Author and commits (item 2).** Author type `Bot` and login `minspec-sdd[bot]`, keyed on type as #3212
requires. Open, not draft, from this repo, targeting the default branch. Every non-merge commit attributed to
that account. No merge commit touches a file the pull request changes. The commit listing's length equals the
pull request's own count, as `judgeApprovalOnly` already requires. The branch name is never read as evidence.

**FR-4. Labels (item 3).** `ai-review:pass`; no `ai-review:changes`, `ai-review:blocked`, `needs-human-review`
(per D2) or `hold:*`; no comment carrying `<!-- minspec-shepherd-handoff -->`. Labels are read at judgement time.

**FR-5. The diff, the text and the hash (items 4, 5, 6).** Exactly two raw-diff entries, both regular files: the
record `.minspec/approvals/specs/<project>/SPEC-NNN-<slug>/requirements.md.json` and that spec's
`requirements.md`, modified. With `stripLifecycleStrict` applied, base and head are byte-identical. Base status is
`new` or `specifying`; head status is `planning` or `implementing`. The record's `specHash` equals `specHash()` of
the spec on the base tip being merged onto, and on the head.

**FR-6. Record, delegation, approvable, verdict (items 7, 8, 9).**

- Known keys only: `RECORD_KEYS` plus the five delegated keys. `approvedBy` and `actor` are the bot, `basis` is
  `delegation:<id>`, `act` is `spec-approval`, the tier matches the spec.
- `checkApprovalActor` passes against the base's `.minspec/delegations.json`, and the record must classify as
  `delegated`, because a record with no actor fields classifies as `founder-legacy` with no failures.
- `openClarifyDetail` and `specNotApprovable` both pass on the base's text.
- `verdictBy` is on the pull request `readContentPullRequest` names. That pull request is merged,
  `judgeHeadReviewPass` passes on its head sha, the URL it returns is the record's `verdictBy`, and `specHash()` of
  the spec at that sha equals the record's. The lane re-reads this evidence and trusts no field of the record for it.
- Every witness reads one base sha. `specNotApprovable` reads config, epics and shards from a directory, so a run
  whose checkout is not at the judged base gives it a tree materialised at that sha, or waits. Plan chooses which.

**FR-7. Dispatch, with the founder's lane unchanged.** In `runOne`, a pull request whose author is type `Bot` and login
`minspec-sdd[bot]` goes to the new judge. Every other pull request goes to `judgeApprovalOnly` with the same inputs and
the same outcomes as today. A founder pull request is judged even when the lane is off or its tripwire is tripped, and
a tripped lane's red exit does not change that pull request's outcome.

### The queue (the record's section 2)

**FR-8. One at a time.** Every run of the workflow, whichever pull request fired it, after judging that pull request:

1. Lists open pull requests by the bot, oldest first, and drops any the list's own fields refuse (author, draft, base,
   labels) before reading anything else about them.
2. Finds any candidate **in flight**: up to date with `main` (the base tip is an ancestor of the head, proven from the
   objects, because the list call does not report merge state), passing every condition except item 10, with a
   check not finished or a required check absent. If an up-to-date candidate is finished and passes everything, the lane
   merges it (FR-10) and goes to step 3 on a re-read base.
3. If nothing is in flight, updates the oldest candidate that passes every condition except being up to date and item 10
   (`PUT .../update-branch`). For a behind pull request, items 4 and 5 are judged on its own change from the merge base,
   and items 5 and 6 compare with the base tip. The update is not treated as done until a later run sees the new head.

A candidate that fails a condition is skipped by name in the outcome lines, which the workflow already writes to the run
summary, and blocks nothing. A candidate overtaken during CI is behind again, and is updated again. Two racing runs may
spend one extra CI round. The in-flight ceiling is D1.

**FR-9. Update refused.** The lane reads `update-branch`'s actual response. On a refusal whose message names the missing
permission, it closes that pull request with a comment naming the response, deletes its branch, and takes the next
candidate in the same run. Any other failure (401, 5xx, rate limit, an unrecognised body) turns the run red and closes
nothing. Plan captures the refusal's exact text from a real response or, with none available, ships with an empty allowlist,
so that every refusal is red until one is seen. A conflict is not this path: the pull request is skipped by name.

### The merge

**FR-10. Merge, pinned (item 11).** Before the merge call: re-read the base tip and require it to equal the judged base;
re-read the required checks of the ruleset and every latest check on the head (item 10). The call is the merge API by squash,
with `sha=<judged head>`, `commit_title` carrying the pull request's title and number, and `commit_message` carrying the
trailer of FR-12. Never `--admin`, never auto-merge, never a force-push. Item 10 reuses `failingRequiredChecks` for the
required set, and adds the rule that every other latest check, by name and App, and every latest commit status, finished
SUCCESS, SKIPPED or NEUTRAL (status: `success`). Zero checks refuses.

**FR-11. Verify after the merge, and record it.** After a merge the lane reads the squash commit and requires its first
parent to be the judged base and its diff to be exactly the two judged paths. A mismatch cannot be undone by this lane: the
run goes red and comments on the pull request naming both shas. One audit comment on each merge names the record, the head, the
base and the verdict, and a failed comment is red, as it is today.

### The tripwire

**FR-12. Lane merges are identifiable from `main`.** Each lane merge writes a trailer, `Delegated-Approval-Lane: <judged head
sha>`, in the squash message. "Lane-merged" means a first-parent commit on `main` carrying it. So the 16 approvals the founder
merged are not counted, as the record's wording requires.

**FR-13. Tripwire.** Run-level, red, refusing every lane merge, when either holds:

1. The repeat-fix share is above 13% or unknown (`evaluateDelegation`).
2. Two or more distinct lane-merged approvals were undone by a first-parent commit dated in the last 30 days. A shallow or
   unreadable history is red.

An approval is **undone** by a commit that does any of these:

- reverts its lane merge, named by `This reverts commit <sha>` or by a subject `Revert "<its subject>"`;
- deletes its record, and leaves no record for that spec id anywhere under `.minspec/approvals/` at that commit;
- re-writes its record so that the record no longer parses, or its `specHash` no longer equals `specHash()` of the spec at that
  commit, or the spec's status is back at `new` or `specifying`.

An approval is **not undone** by a re-approval or any other re-write that leaves a valid approval in place, whoever made it,
or by a layout move that carries the record and the spec together under the same spec id. This is the definition the build note on
#3379 asks for: the record's wording counts every re-write, which would turn a legitimate re-approval into a stopped lane.
One approval counts once, however many of these a commit or a later commit does, so a revert that also deletes the record is one.

Removing a spec along with its record counts as undone. The record's wording counts a deletion, and the cost of a false count is a
stopped lane rather than a wrong merge. A spec later edited, without its record being touched, is not counted: the record's
tripwire reads record changes and reverts only.

### Cost and tests

**FR-14. Bounded reads.** Evidence reads happen only for candidates actually examined, and a run stops examining at its first
actionable candidate. Heads for the up-to-date test come from one batched `git fetch`, not one API call each. A test counts stub
calls: a run with no candidate after the list makes at most 4 core API calls beyond what it does today, and a run that judges one
candidate at most 40. Both numbers are starting values, set against the App's shared 5000 an hour at about 10 runs an hour on
average; Plan re-measures them.

**FR-15. Fixtures for the record's classes.** Offline fixtures, with fixture git objects and a stub `gh`, cover each class the
record's table names, with the same refusal reason: the 16 eligible shape; a failed `test` on the head (#3357); a record hash broken
by a body `**Status:**` rewrite (#3362); `hold:human` alone (#3085); Clarify open (#3087, #3089, #3091); text `main` changed since
(#3088, #3089, #3090). No test reads live GitHub.

**FR-16. Read-only rehearsal.** Without `--merge`, the script makes no write of any kind: no merge, update, close, delete or comment.
It prints what it would do. The run that ships this spec's build reports one rehearsal over the then-open pull requests, with any
difference from the table above explained by name.

## Acceptance criteria

- **AC-1.** Each of the eleven conditions has a T0 (invariant) test and a mutant that removes its guard and turns that test red. A
  surviving mutant fails this criterion.
- **AC-2.** `git diff --exit-code origin/main -- scripts/lib/alta-approval-only.ts packages/minspec/tests/alta-approval-only.test.ts
  .github/workflows .minspec/delegations.json .minspec/constitution.md docs/decisions/DR-086.md docs/decisions/DR-112.md` is empty on the build's pull request.
- **AC-3.** Every existing case in `packages/minspec/tests/alta-self-merge.test.ts` passes unmodified. New cases are additions.
- **AC-4.** A fixture founder pull request gets the same outcome with the lane on, off, and tripped, and a tripped run with an eligible
  founder pull request merges it and still exits red.
- **AC-5.** Queue fixtures show: no in-flight and three candidates updates only the oldest; one in flight writes nothing; a finished
  green one is merged and the next is updated in the same run; a behind candidate that fails a condition is skipped by name and the
  next is taken; a held up-to-date pull request with pending checks is not counted as in flight.
- **AC-6.** An `update-branch` refusal whose message is on the allowlist closes and deletes, and takes the next. A 401, a 5xx, a rate-limit
  403 and an unknown body each close nothing and exit red.
- **AC-7.** Every API or git failure, at each read and write of the lane, in a parametrised test, exits non-zero and writes nothing after
  the failure. A decline exits 0.
- **AC-8.** A merge call is made only with `sha=` the judged head, and never when the re-read base differs. A fixture squash commit with the
  wrong parent or a third path turns the run red and comments.
- **AC-9.** Tripwire fixtures on a real git history: a delegated re-approval and a founder re-approval over a lane record count 0; a layout move
  counts 0; a deletion counts 1; a revert that also deletes counts 1; a founder-merged delegated record deleted counts 0; two distinct undone
  approvals are red; one is not; two outside 30 days are not; a shallow clone is red.
- **AC-10.** With the record at `deprecated` on the base, a run merges nothing and exits 0, naming why; with its frontmatter unreadable it
  exits non-zero. Mutants of both go red.
- **AC-11.** The call-count test of FR-14 passes.
- **AC-12.** FR-16's rehearsal is reported on the build's pull request and writes nothing, shown by a stub `gh` that fails on any write.

## Invariants this must not break

1. `judgeApprovalOnly` and its tests are byte-identical before and after (#3379).
2. No change to any workflow file, `.minspec/delegations.json`, the constitution, DR-086 or the bot-merge record (#3379). The stale header
   comment in `alta-self-merge.yml` stays for the founder's later push, per the record's "Text to change".
3. Never `--admin`, auto-merge or force. Every merge is bound with `sha=<judged head>` (#3379).
4. No silent gate (constitution invariant 2): a run errors red, never green, on anything unreadable. A decline is green only when every fact it
   rests on was read.
5. Blast radius (constitution invariant 3): this is dev-time machinery in `scripts/`, runs only in this repo, ships nothing in the extension,
   and makes the extension no network call (constitution invariant 1).
6. Nothing from a pull request is executed: heads are fetched as data, and the judge is `main`'s, as the workflow's trust boundary requires.
7. The bot is never recorded as the founder, and the founder never as the bot. Audit comments name `minspec-sdd[bot]` as the merger.

## Decisions needed (Clarify)

All 2 decisions are answered with the option this document recommends. These are the agent's
recommended selections, recorded by an agent session (minspec-sdd[bot]) on 2026-11-12 under the
founder's decision on queue item c1106au (outside this repo) that agent-recorded recommended Clarify
selections count as Clarify done for T3 specs. That decision is cited as context, not as consent
recorded here: no human chose any single option, and DLG-001 made none of them (it covers approval
only). They bind once this spec is approved. FR-4 and FR-8 are written to them.

**D1 - What if an in-flight pull request's checks never finish?** The record defines in flight as up to date with checks not finished, and it
says a pull request failing a condition never blocks the rest, but it does not say what happens to a check that hangs. Nothing would fire and nothing would be red.

- **(a) A ceiling of 45 minutes** **(rec)**: a head whose committer date is older than that, and still unfinished, stops counting as in flight and is
  skipped by name. If it later finishes, it is judged normally. About five times the 8.5 minutes measured on one head. **Cost:** a genuinely slow head can have a
  second pull request updated beside it, which costs at most one extra CI round.
- (b) A ceiling that turns the run red and stops the lane. Visible, but one hung check stops every approval.
- (c) No ceiling. Cheapest to build, and it is a silent stall.

**Recorded selection: Option (a)** - agent's recommended selection (c1106au).

**D2 - Does `needs-human-review` refuse?** Section 1 item 3 names a hand-off comment and does not name this label, which `ai-review.yml` and the shepherd both apply
when asking for a human. Today only #3089 has it, and #3089 is refused anyway.

- **(a) Refuse on the label** **(rec)**: it can only refuse more than the record does, and it stops the lane from taking a pull request an automation has handed to a human. **Cost:** a stale
  label strands one pull request until someone removes it, visible by name in the run summary.
- (b) Read only what the record names. Less to maintain, and it merges a pull request whose label is asking for a human.

**Recorded selection: Option (a)** - agent's recommended selection (c1106au).

## Rejected alternatives (DR-086 section 4)

Choices this spec makes that the record left open. The record's own rejections are in the record.

- **Keep the 24 pull requests as a live replay.** Rejected: 19 are no longer open and the table holds no heads (see Measured state).
- **Count every delegated-record deletion, with no trailer.** Rejected: the record says lane-merged, and the 16 founder-merged records would then count.
- **Identify lane merges from `merged_by` through the API.** Rejected: the record reads the tripwire from `main`'s history, and git cannot see that field.
- **Pre-judge a refused update from the changed-files list.** Rejected: measured wrong once (see the second premise).
- **Trust GitHub to refuse a behind or red merge.** Rejected: unverified for a bypass actor (see the first premise).
- **Judge all candidates each run for a full summary.** Rejected: about 12 calls for each of 33 at about 10 runs an hour would take most of a shared 5000.

## Out of scope

- `.github/workflows/alta-self-merge.yml`'s header comment: the founder's push, per the record.
- The drain's remediation of red approval pull requests (#3036), post-merge audit of bot merges (#3039), the body `**Status:**` rewrite (#3380, fix open as #3407), and the Clarify hole (#3104).
- Changing the caller, `delegated-merge.ts`, the runner's helper, or `cos.py`.
- Re-opening #3084. Its closure is reported to the runner and is not this spec's work.

## Follow-ups (tracked)

- #3528 - `pr-drive` leaves `dlg-approve/*` to the lane once it ships.
- #3104, #3380, #3036, #3039 - as named by the record.
