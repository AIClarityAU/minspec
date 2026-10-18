---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the epic DR-104 (verdict carry) is filed under
aspects: [ci, ai-review, staleness, reuse, provenance, quota, no-silent-gate, security]
depends_on: [DR-104]  # accepted 2026-10-13 (#2701); this spec states the contract that decision put in force
relates_to: [DR-097, DR-066, DR-054, SPEC-078, "#1688", "#359", "#1654", "#1672", "#1840", "#1394", "#2588", "#2640", "#2714", "#2635", "#2636", "#1897"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both owned files
# EXIST on main (landed in #2640 and #2714) and are claimed by no other spec (checked by grep
# over specs/ on 2026-10-18). Modified, not owned: the guard, the two workflows and the review
# script are shared with other ai-review specs (SPEC-078 lists review-branch.sh and
# ai-review.yml under affects:), so this spec never takes them over.
implements: [packages/minspec/tests/ai-review-verdict-carry.test.ts, packages/minspec/tests/ai-review-verdict-carry-glue.test.ts]
affects: [.github/scripts/ai-review-guard.js, .github/workflows/ai-review.yml, .github/workflows/ready-to-merge.yml, scripts/review-branch.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - carry an ai-review pass across a push that changes nothing the voters are given (Requirements)

> **SPECIFICATION ONLY.** The dispatch that produced this file wrote no code. A human reads
> it, answers the questions under **Decisions needed (Clarify)**, and approves it through the
> normal spec-approval gate.

Materializes **#1688** - *"a branch update re-runs the whole panel on an unchanged diff -
strict + staleness guard"*. The design decision is **DR-104** (verdict carry across a
byte-identical push; `status: accepted`, 2026-10-13, #2701). This spec does not re-decide
it. It states, as numbered requirements a test can check, the contract DR-104 put in force,
and it adds the requirements a security read of that contract found missing.

## Where this stands - read this first

**The carry is already built and wired on `main`. This spec is written after the fact.**
Observed in this worktree at `418515d8` (origin/main, 2026-10-18 03:22 UTC), not inferred:

| What | Where |
|---|---|
| Decision logic: `planVerdictCarry`, `decideVerdictCarry`, `latestHeadRound`, `wholeCheckRunListing`, `reviewPanelKey`, `renderRoundRecord`/`parseRoundRecord`, `renderCarriedComment`, `carriedLabelFault` | `.github/scripts/ai-review-guard.js:839-1263` (#2640) |
| The staleness guard's one exception (`headRound`) | `.github/scripts/ai-review-guard.js:1328` `decideStalenessStrip` |
| The single definition of "what the voters are given" | `scripts/review-branch.sh:152` `REVIEW_INPUT`, printed by `--print-input` at `:157` |
| The workflow step that calls the seam | `.github/workflows/ai-review.yml:333` (step `carry`), consumed at `:604` (#2714) |
| The staleness caller that passes `headRound` | `.github/workflows/ready-to-merge.yml:232-268` |
| Tests | `packages/minspec/tests/ai-review-verdict-carry.test.ts`, `ai-review-verdict-carry-glue.test.ts`, `review-churn-carry.test.ts` |

DR-104's own banner (written before #2714) says the carry is not live until
`ai-review.yml` calls `planVerdictCarry`. It now does (`ai-review.yml:403`). Whether a carry
has yet fired on a real pull request was **not** checked: this dispatch has no network
access, and #2636 is the issue that measures it.

So the job of this spec is three things:

1. Give the shipped behaviour a requirements contract (FR-1 to FR-10) that the existing
   tests are traced to, so a later edit to the guard has something to be checked against
   other than its own comments.
2. Record the security reading the issue asked for - *"the exemption MUST be decided by
   comparing actual tree/blob hashes against the reviewed SHA, never by trusting the event
   type, the actor, or the commit message"* - against what was built (the threat table
   below).
3. Specify the one gap that reading found (FR-11, binary content) and put its fix to the
   human (DQ-1).

## In plain terms

`main` will not merge a pull request that is behind it. Updating a pull request from `main`
is a push, and every push used to throw away the AI review's pass and run all four reviewers
again on a change they had already read. On #1672 that was one full panel out of four spent
on nothing.

Now, when the text the reviewers would be shown is byte-for-byte what they were shown last
time, and the reviewer itself has not changed, the last pass is carried to the new commit
instead. The pull request says so in four places: a comment, the `ai-review:carried` label,
the check, and the commit status. Anything else - one byte different, a failed round, a
re-run - reviews in full.

What you give up, as DR-104 records it: on a carried commit no reviewer read your change next
to what `main` gained. The build and tests on the updated commit are the only check for that.

## Functional requirements

### The contract as built (FR-1 to FR-10)

- **FR-1 - Content decides, nothing else.** Whether a verdict is carried is decided only by
  comparing two sha256 hashes computed by the trusted base checkout from git objects
  (FR-2, FR-3). No commit count, commit subject, actor, label, event payload text or "this
  was a branch update" signal may influence the decision. `github.event.before` is used only
  to find *where* the previous round is, never to decide *whether* it applies.
  *(Built: `decideVerdictCarry` takes no such input, `ai-review-guard.js:1094`.)*

- **FR-2 - The input hash.** The hash is over the exact bytes the voters are given:
  `REVIEW_INPUT` in `review-branch.sh`, which is the defanged three-dot diff plus the
  approval-provenance block. The prompt and the hash read one variable, so the two cannot
  drift. The `Base:`/`Head:` lines are outside it, on purpose. `git patch-id` is not used,
  because it ignores whitespace.

- **FR-3 - The reviewer hash.** The hash is over the blob ids, at the **base** commit, of
  every path in `PANEL_KEY_PATHS` (the workflow, the guard, the review scripts, the four role
  prompts) plus the raw coverage setting. A required path missing from the listing yields no
  key, and no key never carries.

- **FR-4 - Only a pass is carried.** Only a round that recorded
  `review-round:v1:pass:<input>:<panel>:<reviewed sha>` on its check run can be carried from.
  `ai-review:changes` and `ai-review:blocked` are never recorded and never carried. A record
  with an unknown version or verdict does not parse. Two records in one output do not parse.

- **FR-5 - Which earlier round.** The previous head's **latest** `ai-review` check run, by
  timestamp, chosen from a check-run listing shown to be the whole list (`total_count`
  present, equal to the number returned, and below one full page). That run must be
  completed, posted by an allowlisted reviewer identity, concluded `success` or `neutral`,
  and carry a readable pass record. A newer same-name check from any other app makes the
  round unusable; it is not skipped over.

- **FR-6 - When a carry is even considered.** Only on `synchronize`, only on
  `run_attempt == 1`, only when the previous head and the new head are both real, distinct
  commits. Opened, reopened and re-run rounds always review. A re-run is the documented way
  to get fresh eyes.

- **FR-7 - Fail toward reviewing.** Every refusal, every error in the carry step, an empty or
  unreadable input, and a base guard that predates `planVerdictCarry` resolve to "run the full
  panel", and write a one-line reason to the run log. The carry step can never fail the run
  or cost a review (`continue-on-error`, no `set -e`, empty file on any failed command).

- **FR-8 - A carry is visible.** A carried round posts a comment whose heading and first line
  say it is not a fresh review, names the commit carried from and the commit the voters last
  actually read, says what a carry does not cover, and says how to get a fresh review. It adds
  `ai-review:carried` (a disclosure label, not in `VERDICT_LABELS`), and the check-run title
  and summary and the commit status say carried. The labels are re-read after writing; a
  missing or left-over `ai-review:carried` fails the step. A carry whose comment cannot be
  rendered is not a carry.

- **FR-9 - A chain points at the one real review.** A carried round records the commit the
  voters actually read (`reviewedSha`), not its own head, so a run of base updates always
  names the round that did the reading.

- **FR-10 - The staleness guard keeps its job.** `decideStalenessStrip` stands down in exactly
  one case: the allowlisted reviewer has already recorded a completed pass round on the very
  head being pushed. In every other case a push strips `ai-review:pass` exactly as #359
  required. A real change therefore still voids the verdict until its own full round passes.

### What the security reading adds (FR-11, FR-12)

- **FR-11 - Binary content must be bound, or a carry must refuse it.** The input hash must
  change whenever the head's content for any changed path changes, including binary files.
  Today it does not, fully: for a binary file `git diff` prints no content, only an
  `index <old>..<new>` line with **abbreviated** blob ids and `Binary files ... differ`
  (observed on a scratch repository: 7 hex characters; this repository's local abbreviation
  is 9). So two different binary blobs whose ids share that prefix give byte-identical review
  input. How to close it is DQ-1.

- **FR-12 - The carry trusts nothing the merge gate does not already trust.** The identities
  and records a carry accepts must be a subset of what `verifyHeadPassCheckRun` already
  accepts for the merge gate (same check name, same allowlist, same most-recent-wins). A
  change to the carry that widens this - another app, another check name, a label as
  evidence - is out of contract.

## Threat reading - can the carry smuggle content past a pass?

The issue named the risk: *"the diff didn't change" is exactly the argument an attacker wants
a merge gate to accept*. Each row below was traced against the code cited above; the verdict
column says whether the carry widens exposure compared with running the panel fresh.

| # | Attempt | What stops it | Wider than a fresh review? |
|---|---|---|---|
| T1 | Push a commit whose message or author mimics `gh pr update-branch` | Nothing reads message, author or event kind (FR-1) | No |
| T2 | A "merge from base" that also edits a file, or resolves a conflict differently | The three-dot diff from the new merge base then differs, so the input hash differs | No |
| T3 | Force-push a different change, then force-push back to the passed one | `before` is the intermediate head; its latest round is not a completed pass of the same input | No |
| T4 | Push a new change and push the old one again before the new round finishes | Concurrency cancels the in-flight round; the intermediate head has no completed round | No |
| T5 | Change a role prompt or review script on `main`, then update the PR | Reviewer hash is read at the base and changes (FR-3) | No |
| T6 | Change the reviewer files inside the PR | Those files are read at the base, not the head; the PR's edits to them are in the diff and so in the input hash. Machinery status is recomputed per head and is never carried | No |
| T7 | Borrow a pass recorded on the same commit by another PR, against another base | Carry still needs the input hash at *this* base to equal the recorded one, and the reviewer hash to match; equal hashes mean equal reviewed text | No |
| T8 | Truncate or corrupt the check-run listing so an older pass looks latest | Listing must be provably whole (FR-5) | No |
| T9 | Text that the defang step rewrites (variants of the container tags) | The fresh panel sees the same rewritten text, so the carried and fresh inputs are equally lossy | No |
| T10 | **Swap a binary file for another whose blob id shares the printed prefix** | **Nothing today** (FR-11) | **Not for the panel** - it never sees binary bytes either. **Yes for the claim**: the carried comment says the input was byte-identical, which a reader takes to mean the content was |
| T11 | A defect that exists only next to what the base gained (#1394 class) | Not stopped; accepted in DR-104 Decision 6. Build and tests on the new head are the check | Yes, by decision |

T10 rests on a prefix collision. Grinding a SHA-1 prefix of 36 to 40 bits by padding a binary
is cheap on one GPU (I believe minutes to hours, unverified - no benchmark was run). It needs
an author who can push to the pull request's head, and it gains nothing a fresh review would
have caught, which is why this is a requirement and a Clarify item rather than a reason to
reverse DR-104.

## Acceptance criteria

Each criterion names the requirement it proves. "Exists" means a test for it was **not**
looked up line by line by this dispatch; the plan phase traces each to a test or adds one.

- **AC-1 (FR-1).** `decideVerdictCarry` and `planVerdictCarry` given identical hashes and a
  valid pass round carry regardless of any extra commit-subject, actor or event-kind field
  passed in; given different input hashes they refuse regardless of those fields.
- **AC-2 (FR-2).** Changing one whitespace byte inside a hunk changes the input hash. A base
  update that changes only the `Base:`/`Head:` commit ids does not.
- **AC-3 (FR-3).** Changing the blob of any one `PANEL_KEY_PATHS` entry at the base, or the
  coverage value, refuses the carry. A listing missing a required path yields no key. A test
  pins `PANEL_KEY_PATHS` to the paths `review-branch.sh` reads (DR-104, Costly to Refactor 3).
- **AC-4 (FR-4).** A round recording `changes`, `blocked`, an unknown verdict, an unknown
  version, a truncated record, or two records is never carried from.
- **AC-5 (FR-5).** A listing with no `total_count`, a count unequal to the runs returned, or a
  full page of 100 refuses. A later non-pass round, or a later same-name round from another
  app, beats an earlier pass.
- **AC-6 (FR-6).** `opened`, `reopened`, `run_attempt` of 2 or more, an all-zeros `before`,
  and `before == head` each refuse.
- **AC-7 (FR-7).** With each of the three gathered files empty in turn, with a guard module
  that has no `planVerdictCarry`, and with the decision script exiting non-zero after it has
  written outputs, the review step runs the full panel. The last case asks whether a
  duplicate `carry=` key in `$GITHUB_OUTPUT` resolves to the later `carry=no` - I believe it
  does, unverified; the test must observe it, not assume it.
- **AC-8 (FR-8).** A carried round's comment contains the "NOT a fresh review" line and both
  commit ids, contains no verdict block, and drops a `fromUrl` that is not a plain GitHub URL.
  `carriedLabelFault` reports both the missing and the left-over label.
- **AC-9 (FR-9).** Carrying from a round that was itself carried records the original
  `reviewedSha`.
- **AC-10 (FR-10).** `decideStalenessStrip` strips on `synchronize` with no `headRound`, with
  an incomplete one, and with a completed non-pass; it stands down only for a completed pass
  on the current head.
- **AC-11 (FR-11).** Two heads differing only in the bytes of a binary file never carry from
  one to the other, whichever DQ-1 option is chosen. The fixture must make the two blob ids
  share the abbreviated prefix the diff prints (for example by forcing a short `core.abbrev`
  in the fixture repository), so the test cannot go green on a fixture where the prefixes
  already differ.
- **AC-12 (FR-12).** A test asserts that every round `latestHeadRound` accepts would also be
  accepted by `verifyHeadPassCheckRun` for the same listing and allowlist.

## Invariants this must not break

- **Constitution 2 - no silent gate.** The carry is an optimisation, never a gate signal: its
  failure modes all end in a full review, each with a logged reason (FR-7). The disclosure
  label is re-read and a mismatch fails visibly (FR-8). The required `ai-review` check and
  `ready-to-merge` keep their independent witnesses; nothing here lets a carried label stand
  in for the per-head witness `ready-to-merge` checks.
- **Constitution 3 - blast radius.** The shipped templates carry this default-on (DR-104
  Decision 8). It acts only inside a repository that installed the ai-review workflow, which
  is itself under the `.minspec/` opt-in. No setting is added.
- **Constitution 1 - offline.** Unaffected: this is CI machinery, and the one network read
  (the previous head's check runs) happens in the repository's own Actions run, not in the
  extension.
- **`strict` stays on.** Turning off the up-to-date requirement was rejected by the issue and
  by DR-104; the carry leans on the build and tests that `strict` forces onto the updated head.
- **Machinery still needs a human.** A carry never touches `machinery-review-required`; a pull
  request changing the reviewer still merges only by a human.
- **Credentials.** The App token reaches only the one `gh api` read in the carry step and is
  unset before the review script and git run (`ai-review.yml:355-356`). The inference token is
  not in that step.

## Decisions needed (Clarify)

**DQ-1 - How to close the binary gap (FR-11).**

- **A (rec) - Print full blob ids: `git diff --full-index` in `review-branch.sh`.** One line;
  the prompt and the hash keep their single definition, and a binary swap now changes the
  input hash at full SHA-1 or SHA-256 strength. It costs no carries in practice: a base change
  to the same file already changes the abbreviated index line today. *Cost:* the prompt changes
  for every diff, and because `review-branch.sh` is in `PANEL_KEY_PATHS` every open pull
  request is reviewed once in full on its next push after this lands; each changed file adds
  about 60 bytes to what the voters read.
- **B - Refuse a carry when the input contains a `Binary files ... differ` line.** Leaves the
  prompt alone. *Cost:* a second rule about the input, in the guard, that has to keep matching
  git's wording; and pull requests that touch binaries never carry.
- **C - Accept it and say so in the carried comment.** *Cost:* the comment's "byte-for-byte
  identical" wording stays true of the text and misleading about the content.

**DQ-2 - Does #1688 close when this spec is approved, or when #2636 reports?** DR-104 lists
#1688 only as "the workflow edit that makes this live", which #2714 landed.
- **A (rec) - Close #1688 when the FR-11 fix lands; leave measurement to #2636.** *Cost:* the
  issue that measured the waste closes before anyone has measured the saving.
- **B - Keep #1688 open until #2636's first sample.** *Cost:* an open issue whose code is done.

**DQ-3 - Should a carried pass be sampled by re-running it?** DR-104's reversal trigger is a
carried round that re-runs to anything but a pass, and the only way to see one is to re-run
some carried rounds. That is #2636's scope.
- **A (rec) - Leave it to #2636, not this spec.** *Cost:* until #2636 is built, the miss rate
  DR-104 says cannot be ruled out below about 1 in 10 stays unmeasured.
- **B - Add a sampling requirement here.** *Cost:* spends panel quota the carry exists to save,
  and duplicates #2636.

## Out of scope

- **#1654** - *what* gets reviewed (a generated approval sidecar needs no panel). Independent,
  as the issue says.
- **#2635** - the two no-op shapes the carry still reviews: hunks moved by a base change to
  the same file, and a push after a round that never completed.
- Per-voter reuse on one commit (DR-097, `selectVotersToRun`) - unchanged.
- Turning off `strict`, and rebasing instead of merging - both rejected in the issue and in
  DR-104 (a rebase rewrites every SHA, so the guard sees new commits either way).

## Follow-ups (tracked)

- **FR-11 / DQ-1** - built under this spec once approved; no separate issue.
- **#2635** - moved-hunk and incomplete-round shapes.
- **#2636** - measure the carry live, sample carried rounds, teach the churn report to tell a
  carried round from a reviewed one.
- **#2637** - the machinery check-run summary still says the label is forced to `changes`.
- **DR-104 banner** - its "nothing calls any of it yet" note predates #2714. Rewording an
  accepted record is a human act, so this spec does not edit it. It is folded into this
  spec's Plan phase as a task (reword DR-104's "where the code is" banner now that
  `ai-review.yml` calls `planVerdictCarry`, #2714), not a separate issue.
- **Spec id** - SPEC-141 is the highest on disk plus one. Open pull requests could not be read
  from this dispatch, so a clash with an in-flight spec is possible; the reviewer should check.
