---
id: SPEC-229
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent dispatches must not hand out one spec id twice, and a refused push must say why
aspects: [drain, dispatch, spec-id, collision, allocator, push-failure, no-silent-gate, concurrency]
depends_on: [DR-066, DR-067]  # DR-066: a gate fails closed and visibly; DR-067: the work-item claim lease the reservation rides on
relates_to: [SPEC-044, DR-003, "#2794", "#1418", "#1226", "#267", "#2724", "#168"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038, the spec-code
# ownership spec, FR-1 to FR-3). All five owned files are NEW. If the Plan phase folds the
# CI witness into the existing DR collision check instead of a new script (DQ-2), that
# choice edits this list, and so edits this spec, before approval.
implements: [scripts/lib/spec-id-allocator.ts, scripts/next-spec-id.ts, scripts/check-spec-id-collision.ts, scripts/lib/push-report.sh, packages/minspec/tests/spec-id-allocator.test.ts]
# Modified, not owned.
affects: [scripts/dispatch-issue.sh, scripts/drain-inbox.sh, scripts/lib/spec-id-collision.ts, .github/workflows/spec-id-collision.yml]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-229: The drain hands out spec ids that no open draft already holds, and a refused push says why

Issue: #2794 (drain push rejected "(failed)" for spec-only branches that both took SPEC-137).

## In plain terms

When the drain writes a spec, the agent picks the spec number itself. It looks only at
`main` in its own checkout, and it has no network, so it cannot see the drafts other
dispatches have already opened. Every draft written before the previous one merges
therefore picks the same number. Between 2026-10-14 and 2026-10-16, 83 commits on remote
branches each added a SPEC-137 directory; on 2026-10-19 nine open drafts all took SPEC-212 (#2956, #2958, #2959,
#2962, #2963, #2965, #2967, #2968, #2969, now closed and labelled `parked`). Earlier
pile-ups parked 35 and 76 drafts. Each clash throws away a spec write.

Separately, when GitHub refuses a push the drain prints GitHub's one word, `(failed)`,
then labels the issue `agent-done` and says "Agent completed". The work is left in
`/tmp`, which does not survive a container restart.

This spec asks for two things: (A) the dispatcher, not the agent, picks the number, from
`main` plus every open pull request plus every parked draft, and checks it again just
before pushing; and (B) a refused push is retried when the failure is transient, is never
reported as success, and when it finally fails it says why and keeps the work somewhere
durable.

## One-Sentence Scope

Move spec-id choice for drain dispatches out of the agent prompt into a deterministic
allocator that sees the base branch, every open PR and every parked draft, re-checks before
push, and is backed by a CI cross-PR spec-id check; and make a rejected push retry if
transient, never count as completion, and report its class, git's verbatim lines and a
durable copy of the work.

## Context - what the code does today (read from `origin/main` dcfbfc7a)

### Where the spec id comes from

- The specify-only prompt tells the agent to write `id: SPEC-NNN` as "the next unused
  number" (`scripts/dispatch-issue.sh:1173`). That is the whole allocator: a sentence to a
  model.
- The same prompt forbids `git push`, `git remote`, `gh` and any network command
  (`scripts/dispatch-issue.sh:1196`). The agent can only see its own worktree, which is
  branched from `origin/main`. Agents say so in their own summaries: #684 "I picked
  `SPEC-137` as the next after `SPEC-136` on main. I couldn't see open PRs or remote
  branches offline"; #735 "137 was the next free number on this base, so another open PR
  may have claimed it" (drain log `/tmp/minspec-drain-inbox.log`, lines 6614-6620, 7713).
- Drafts stay as open PRs (spec PRs wait for a human read), so `main` does not move
  between dispatches. Serial dispatches collide just as concurrent ones do; concurrency
  only makes it faster. The drain's own header already names this class for files
  (`scripts/drain-inbox.sh:362-366`, "each agent branches from origin/main and cannot see
  an unmerged sibling").

### What should have refused the duplicate, and why it did not

- `scripts/lib/spec-id-collision.ts` (from #1418) checks spec-id duplicates and
  path/`id:` mismatches, but only inside ONE tree: it is called from
  `scripts/validate-frontmatter.ts:50`, which sees the PR's own checkout. A draft that
  reuses an id held by another open PR passes it.
- DR ids have a cross-PR check: `scripts/check-dr-id-collision.ts`, run by
  `.github/workflows/dr-id-collision.yml:73`, computes "next free id" across the base
  branch and every open PR (`scripts/lib/dr-id-collision.ts`). Spec ids have no
  equivalent. This is the asymmetry: the gate exists for one id family and not the other.

### What happens when a push is refused

- The publish push is `agent_worktree_git push -u origin "$BRANCH" 2>&1`
  (`scripts/dispatch-issue.sh:2163`). It is tried once. git's output goes to the log, and
  nothing reads or classifies it.
- On failure the `else` prints `WARNING: push failed for $BRANCH - review worktree
  manually` (`scripts/dispatch-issue.sh:2547`), and execution then FALLS THROUGH to the
  completion block: `--add-label "agent-done"` and `Agent completed issue #N`
  (`scripts/dispatch-issue.sh:2551-2552`), then `shepherd_own_pr`, which finds no PR and
  says "nothing to shepherd" (drain log line 7729). A failed publish is recorded as
  success.
- The remediation push (`scripts/dispatch-issue.sh:1736-1738`) sends git's output to
  `/dev/null`, so even the word `(failed)` is lost on that path.
- The work stays in `/tmp/minspec-agent/issue-N-<session>` (`scripts/dispatch-issue.sh:22`).
  The four rejected drafts are still there today (#523, #684, #735, #847); their issues
  now carry `needs-human-review`.

### What the rejection itself was (diagnosis, partial)

The issue guessed that a push-time rule rejects a duplicate spec id. The evidence refutes
that:

- The repo has one ruleset, `MinSpec required status checks`, and it targets only the
  default branch (`~DEFAULT_BRANCH`: required checks, non-fast-forward, deletion). No push
  rule covers `agent/*` branches. Organisation rulesets could not be read (HTTP 403 for
  the App), so an org-level push rule is unverified, but see the next point.
- 83 commits that each add a `SPEC-137` directory reached remote branches between
  2026-10-14 and 2026-10-16 (counted with `git log --remotes --diff-filter=A --
  'specs/*/SPEC-137*'`), among them #502, #506, #540, #663, #736, #818, #974 and #993 from
  the same drain run. A rule keyed on the id or the path would have refused them too.
- Four pushes out of about 200 in that log were refused (#523, #684, #735, #847). All four
  happened to be SPEC-137 drafts, but SPEC-137 was the id most drafts took that day, so the
  overlap is not evidence of a cause. In two of the four (#523, #735) the line just before
  is another dispatch's push completing.

`[remote rejected] ... (failed)` is the text GitHub's receive side sends when it gives no
reason. git prints only what the server sends, so the drain could not have printed more.
The cause of these four rejections is **not determined**. The spec therefore does not
pretend to remove it; it requires the drain to retry the transient class and to report and
preserve the rest (FR-9 to FR-14).

## Root cause

**Half A (duplicate ids).** The spec id is chosen by the offline agent following the
prompt sentence "the next unused number" against a checkout of `main` alone, so every draft
dispatched before the previous one merges computes the same max-plus-one; and the only
spec-id gate (`spec-id-collision.ts` via `validate-frontmatter.ts`) checks one tree, while
the cross-PR check exists only for DR ids.

**Half B (silent push failure).** The dispatcher pushes once, does not classify git's
result, and its failure branch falls through to the completion labels and message, so a
refused push is recorded as `agent-done` with nothing but GitHub's bare `(failed)`, and the
work is left in a directory that does not survive a restart.

## Functional Requirements

### A. Spec-id allocation

**FR-1 - One allocator, pure core.** A pure function (no fs, no network, no vscode) takes a
set of observed ids, each tagged with where it was seen, and returns the next free spec id:
one more than the highest id observed in any source. Ids compare by number (`SPEC-52`
equals `SPEC-052`, reusing `canonicalSpecId` from `spec-id-collision.ts`). Output keeps the
corpus's three-digit minimum padding.

**FR-2 - Sources.** The dispatcher feeds the allocator every SPEC id found in:

1. the base branch tree: directory names under `specs/` and every declared `id:`;
2. every OPEN pull request: its title, its head branch name, and every changed file path;
3. every pull request labelled `parked`, open or closed: the same three fields (a parked
   draft is resumed later under its own id, so its id stays taken);
4. every reservation currently held on this host (FR-4).

**FR-3 - Read to exhaustion or fail closed.** Each remote source is read with pagination
to the end. If any source errors, times out, or returns a page count that cannot be
confirmed complete, the allocator returns no id. The dispatch then does not start the agent;
it leaves the issue's ready label in place with a visible reason in the log and the drain's
cycle summary (DR-066: a missing witness fails closed and visibly). It never falls back to
"base branch only".

**FR-4 - Reservation.** Allocation and reservation happen under one host-wide lock, so two
dispatches on this host cannot receive the same id. A reservation records the id, the issue
and the claim session. It is released when the PR for that branch exists (the id is then
visible through source 2), or when the dispatch ends without publishing. A reservation
whose claim lease has expired (SPEC-044, DR-067) counts as released.

**FR-5 - The number is given, not chosen.** The dispatcher computes and reserves the id
BEFORE launching the agent and writes it into the prompt as a fixed value ("use SPEC-NNN").
The phrase "the next unused number" is removed. If the issue already has a spec (the
prompt's existing "UPDATE it - do not mint a second id" path), no id is allocated.

**FR-6 - The agent's output must match.** Before publishing, the dispatcher checks that the
diff adds spec directories carrying only the allocated id, and that their declared `id:`
equals it. Any other new spec id is a refusal: nothing is pushed, and the reason names both
ids.

**FR-7 - Re-check immediately before push.** Directly before the push, the dispatcher
re-reads sources 1 to 3. If the allocated id is now held by anything other than this
dispatch, it renumbers to a fresh id (DQ-3 decides renumber versus hold): it renames the
spec directory, rewrites the `id:` line and every occurrence of the old id inside that
directory, commits that as a separate commit, and re-checks once more. If the old id also
appears in a changed file outside the spec directory, it does not edit that file; it holds
the publish with a reason naming the file.

**FR-8 - Independent CI witness.** A check runs on every pull request, with no `paths:`
filter, and reports any spec id the PR adds that is already held by the base branch or by
another open PR, plus the next free id across both. It mirrors the DR collision check's
shape (`scripts/check-dr-id-collision.ts`). It is the second witness required by
constitution invariant 2: the drain allocator is one producer, and spec ids created outside
the drain (a human session, the extension's Create Spec command) never pass through it.
Whether it gates merge is DQ-2.

### B. Push failure

**FR-9 - One push function, output captured.** Every dispatcher push (the publish push at
`dispatch-issue.sh:2163` and the remediation push at `:1736-1738`) goes through one
function that keeps git's exit code and its full output, and never sends either to
`/dev/null`.

**FR-10 - Classify.** The function classifies a failed push into exactly one of:
`transient` (`[remote rejected] ... (failed)` with no further text, HTTP 5xx, connection
reset or timeout), `stale` (non-fast-forward, `fetch first`, ref already exists),
`permission` (HTTP 403, missing `workflows` permission), `rule` (repository rule violation,
`GH013`, push protection), or `unknown` (anything else). Classification is a pure function
over git's text, tested on recorded outputs.

**FR-11 - Retry only the transient class.** A `transient` failure is retried with bounded
backoff: at most 3 further attempts, at most 120 seconds in total. Every other class is not
retried.

**FR-12 - A failed publish is never completion.** When the publish push finally fails, the
dispatcher does not add `agent-done`, does not print "Agent completed", and does not run
the shepherd. It adds a label that names the failure (DQ-5) and `needs-human-review`,
removes `agent-running`, and exits with a code its caller can tell apart from success.

**FR-13 - Say why.** The same failure posts one issue comment and one log block carrying:
the class, git's verbatim output lines (with any URL credentials stripped), the branch, the
local commit SHA, the number of attempts, and the durable copy's location (FR-14). For
`unknown` and for a `transient` that exhausted its retries, the comment says plainly that
GitHub gave no reason.

**FR-14 - Keep the work.** Before posting, the dispatcher writes a git bundle of the branch
to a host-mounted directory outside `/tmp` (DQ-4), and the comment cites its path.

**FR-15 - Count it.** The drain's cycle summary counts failed publishes by class, so a run
of rejections is visible without reading per-issue logs.

## Acceptance Criteria

- **AC-1** Given sources whose highest id is SPEC-211 on base and SPEC-212 in an open PR
  title, the allocator returns SPEC-213.
- **AC-2** Given a closed PR labelled `parked` whose changed paths include
  `specs/minspec/SPEC-228-x/requirements.md` and nothing higher elsewhere, the allocator
  returns SPEC-229.
- **AC-3** Given ids written `SPEC-52`, `SPEC-052` and `SPEC-0052`, they count as one id.
- **AC-4** If the open-PR source returns an error, or a page set that cannot be confirmed
  complete, the allocator returns no id, the agent is not launched, and the log names the
  source that failed.
- **AC-5** Two allocations run concurrently on one host with the same sources return two
  different ids.
- **AC-6** A dispatch whose re-check finds its id now held by another open PR publishes
  under a new id (if DQ-3 picks renumber); the pushed tree has the new directory name, the
  new `id:`, and no remaining occurrence of the old id inside that directory.
- **AC-7** A dispatch whose agent wrote a spec id other than the one it was given pushes
  nothing, and the reason names both ids.
- **AC-8** The CI check, run on a PR that adds `SPEC-212` while another open PR also adds
  `SPEC-212`, reports the collision and the next free id.
- **AC-9** With git stubbed to print `! [remote rejected] b -> b (failed)` and exit 1 on
  every attempt, the dispatcher tries 4 times in total, then: no `agent-done` label, no
  "Agent completed" line, a `needs-human-review` label, a comment containing the class
  `transient` and git's verbatim rejected line, and a bundle file at the cited path that
  `git bundle verify` accepts.
- **AC-10** With git stubbed to fail once with `(failed)` and then succeed, the publish
  completes normally and is reported once as completed.
- **AC-11** With git stubbed to print a non-fast-forward rejection, the dispatcher does not
  retry and reports class `stale`.
- **AC-12** The remediation push path, given a stubbed failure, logs git's output rather
  than discarding it.

## Invariants (T0 - tests written before implementation)

- **INV-1 (no two drafts share an id).** For any set of sources and any sequence of
  allocations through the allocator with its reservations, every returned id is distinct
  and greater than every id observed in any source. Property test, varying source count,
  sizes and id padding.
- **INV-2 (monotone).** Adding an observation to any source never lowers the result.
- **INV-3 (missing witness fails closed).** An errored or incomplete source yields no id,
  never a lower one. Constitution invariant 2.
- **INV-4 (failure is never success).** A publish push that finally fails can never be
  followed by `agent-done` or "Agent completed" in the same dispatch. Constitution
  invariant 2.
- **INV-5 (Tier 0 core).** `scripts/lib/spec-id-allocator.ts` and the FR-10 classifier
  import no network, filesystem or vscode module. The network reads live only in the
  dev-time dispatcher wrapper. Constitution invariant 1.
- **INV-6 (blast radius).** The allocator and the CI check read and write only this repo
  and its pull requests. Constitution invariant 3.
- **INV-7 (existing claim invariants hold).** The SPEC-044 claim, lease and claim-unique
  worktree path behaviour is unchanged; the reservation uses the claim, it does not replace
  it.

## Decisions needed (Clarify)

- **DQ-1 - How far the reservation reaches.**
  - **(a) (rec)** Host-wide lock plus the FR-7 pre-push re-check, with the FR-8 CI check
    behind it. Cost: two different hosts dispatching at the same moment can still race in
    the seconds between re-check and push; the CI check then reports it, but someone must
    act on that report.
  - (b) Reserve on GitHub by creating a ref such as `refs/heads/spec-id/SPEC-NNN`; ref
    creation is atomic, so a second creator is refused. Cost: one extra remote write per
    draft, ref clutter, and a cleanup duty when drafts are parked or closed.
- **DQ-2 - Does the CI spec-id check gate merge?**
  - **(a) (rec)** Advisory, like the DR collision check, with the drain reading its result
    before asking for a merge. Cost: a collision created outside the drain can still merge
    if no one reads the report.
  - (b) Required check. Cost: needs a ruleset edit (founder-only), and any outage of the
    check blocks every merge.
- **DQ-3 - When the pre-push re-check finds the id taken.**
  - **(a) (rec)** Renumber automatically (FR-7). Cost: the renumber edit is mechanical but
    is still an automated rewrite of a spec the human has not yet read; a mistake in it
    reaches the reader.
  - (b) Hold and report. Cost: every late collision becomes a human or re-dispatch step,
    which is the waste this spec exists to remove.
- **DQ-4 - Where stranded work is kept.**
  - **(a) (rec)** A git bundle per failed publish under a host-mounted directory such as
    `~/code/.minspec-stranded/`. Cost: disk use grows until someone prunes it; needs a
    retention rule.
  - (b) Move the whole worktree out of `/tmp`. Cost: worktrees carry `node_modules` and are
    much larger.
- **DQ-5 - Label for a failed publish.**
  - **(a) (rec)** A new `push-failed` label beside `needs-human-review`. Cost: one more
    label for the drain's countermand set to know about.
  - (b) `needs-human-review` alone. Cost: a failed push looks the same as every other
    human hold in the queue.

## Why no new DR

The allocator follows the DR collision check's existing rule (max over base and every open
PR, plus one), and the push changes apply DR-066 as written. Choosing DQ-1 (b) would add a
new remote write pattern and would need a DR.

## Out of Scope

- The extension's own Create Spec command, which is Tier 0 and offline and keeps its local
  max-plus-one; the FR-8 CI check covers ids it creates.
- Minting ids at merge (#267). See Alternatives.
- Recovering the four drafts already stranded in `/tmp` (#523, #684, #735, #847). Their id,
  SPEC-137, is now taken on `main`, so any recovery renumbers them.
- Same-file collisions between drafts (`scripts/drain-inbox.sh:362-366`).
- Removing whatever made GitHub refuse those four pushes; it is undetermined (see Context).

## Alternatives considered and rejected

- **Tell the agent to check open PRs.** The agent has no network and no credentials by
  design (`dispatch-issue.sh:1196`), and a prompt instruction is the model-trust this spec
  removes.
- **Mint ids at merge (#267, draft #2724 parked).** One serialisation point, but a draft
  needs a stable id while it is read and approved, and renumbering after approval would
  change bytes the approval covers. I believe the approval hash covers the `id:` line;
  unverified. Kept as the long-term option for multi-clone teams.
- **Rely on the CI check alone.** It catches the collision only after the spec has been
  written, which is the wasted write this spec exists to stop; it stays as the second
  witness, not the only one.
- **Retry every push failure.** Retrying `stale`, `permission` or `rule` cannot succeed and
  only delays the report.

## Traceability

- Issue: #2794. Prior gate for one-tree spec ids: #1418. DR cross-PR gate: #1226.
- Claim and lease: SPEC-044, DR-067. Fail-closed rule: DR-066. RCDD: DR-003.
