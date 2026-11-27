---
id: SPEC-465
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (the dispatch gate's trust boundary)
aspects: [triage-verdict, human-approval, trust-boundary, provenance, no-silent-gate]
depends_on: []
relates_to: ["#1105", "#983", "#1084", "#1104", "#1113", "#1169", "#1355", "#397", "#1243", SPEC-245, DR-072, DR-105, DR-076]  # #1105 this issue · #983 triage record · #1084/#1104 approval record · #1113 label-flip approval · #1355 bot-attributed writes · SPEC-245 ranker reads the same records
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Likely candidates:
  scripts/dispatch-ready-check.sh (the reader and the trusted-comment filter), scripts/lib/dispatch-author-gate.sh
  (the account list), scripts/approve-on-label.sh (label-path record), scripts/approve-issue.sh, scripts/dispatch-issue.sh,
  scripts/backfill-hold-labels.sh, scripts/retriage-unrecorded.sh, and their tests.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-465: Bind each verdict record to the account that wrote its comment

> **This is a SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076, the solo-mode
> ceremony record / #1169) for issue #1105. Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

Design rests on DR-072 (the human-approval exit; §5 and §5a are its trust-boundary sections)
and DR-105 (the dispatch author list; decision 4 names this residual).

## Problem

Two record kinds decide whether the dispatcher may start an agent on an issue:

| Record kind (`gate:` value) | Who should write it | Written today by |
|---|---|---|
| `minspec-triage-verdict/1` | the triage gate (the pipeline's App) | `scripts/triage-inbox.sh:315`, posting through the `gh-bot` wrapper armed at `scripts/triage-inbox.sh:70` (#1355), so new records are App-authored |
| `minspec-human-approval/1` | a human | CLI path: `scripts/approve-issue.sh:246`, under the person's own `gh` · label path: `scripts/approve-on-label.sh` under the App installation token (`.github/workflows/approve-on-label.yml:27-29`), so **these comments are App-authored** |

The issue body says the gap is that the reader sees only joined text. That stopped being fully
true after #1113 and DR-105, and the spec has to start from the code as it is now:

- `--trusted-comment-bodies` (`scripts/dispatch-ready-check.sh:471-525`) already filters by
  author before it joins. It keeps a comment when the author's **account** is on the list in
  `scripts/lib/dispatch-author-gate.sh` (the App `Bot:299695933`, the founder `User:4125483`,
  `User:318474157`), **or** when its `authorAssociation` is `OWNER`/`MEMBER`/`COLLABORATOR`
  (`:505-510`).
- It then **joins the bodies**, so the author is gone by the time the reader runs.
  `newest_record` (`:259-308`) picks the newest record of *either* kind, and the reader
  (`:711-810`) applies no rule linking a record's kind to the account that posted it.

What is still open, each checked against the code:

1. **A triage record counts from any admitted account, not only the App.** The founder, a
   listed human account, or any non-listed `COLLABORATOR`/`MEMBER`/`OWNER` can post a
   `hold: none` triage record and it counts. A test pins this as open:
   `packages/minspec/tests/dispatch-author-gate.test.ts:1104-1111`
   (`STILL OPEN (#1105)`).
2. **`approvedBy` is a claim the comment makes about itself.** The reader refuses empty or bot
   values (`:800-805`), but nothing checks that `approvedBy` names the account that posted the
   comment. Anything that can post as the App (the App posts the label-path approvals) or as an
   admitted human can name any human.
3. **Anything holding the App token can write a human approval that counts.** That is the
   direction #1105 exists to close. Today the only thing that makes the label path's
   App-authored approval legitimate is `--verify-label-event`, a check its *writer* runs once
   (`scripts/approve-on-label.sh:26-30`). The reader cannot tell a verified label-path approval
   from any other App-authored approval record.
4. **Found while writing this spec: the reader never compares an approval with the triage
   record it replaces.** An approval record carries its own `human_only: no` and `hold: none`
   (`:619-631`). The reader judges only the newest record (`:711`). It never checks that the
   triage verdict the approval claims to replace had a hold a human may lift. `may-approve`
   runs only inside the two writers (`approve-issue.sh:168`, `approve-on-label.sh:263`). A
   hand-made approval record therefore releases a `hold: human` issue, which DR-072 §3 says no
   approval may do. See D4.

What this spec does **not** fix, stated plainly so nobody reads it as closed: in a container
whose `gh` is the maintainer's account, binding a record to its author cannot tell "the human
ran it" from "an agent ran it with the human's `gh`". #1104's TTY and typed-confirmation
checks cover that direction. Author binding covers the other one: automation that holds only
the bot token can never write a human approval that counts.

## Scope

In: the rule linking each record kind to the account that posted it, and where that rule is
enforced; every reader of these records; sequencing and the measurement of existing records
before the triage half is enforced; the label-path approval's new proof of who approved.

Out: what a triage verdict decides (`triage-decide.sh`); the author list's membership
(DR-105); which holds a human may lift (DR-072 §3, unchanged); fencing marker text an agent
wrote (#1243, already built); a human-side identity check stronger than TTY plus typed
confirmation (impossible without a second credential, see Problem).

## Functional requirements

- **FR-1 — Each record kind has an author rule.** One table in the tested seam
  (`dispatch-ready-check.sh`, beside `RECORD_SCHEMA`/`RECORD_SCHEMA_HUMAN`) names which
  accounts may post each kind. The kind (account type) and the number are compared, never the
  login (the same rule as DR-105):
  - `minspec-triage-verdict/1`: only the pipeline App (`Bot:299695933`).
  - `minspec-human-approval/1`: **either** (a) a `User` account on the author list whose
    current login equals the record's `approvedBy` (case-insensitive). That is the CLI path.
    **Or** (b) the App, but only when FR-4's label-event proof checks out. That is the label
    path. Nothing else counts.
- **FR-2 — The author survives to the reader, and a comment cannot fake it.** The reader must
  learn which account posted the comment each record came from. A comment body must not be able
  to claim an author. The default proposal is the **envelope marked by a random value** from the
  issue (D1, option a). The filter wraps each admitted comment between
  `<nonce>-AUTHOR <Kind>:<id> <login>` and `<nonce>-END`, where `<nonce>` is ≥128 bits from
  `/dev/urandom` generated once per run. The reader takes the nonce as an argument and gives each
  record the author of the envelope it sits in. If any admitted comment body contains the nonce
  string, the filter refuses that run (no answer, non-zero exit), even though the chance of it
  is negligible. A record that crosses an envelope boundary, or sits outside every envelope,
  belongs to no author and is not a candidate.
- **FR-3 — Choose the newest record first, then check its author. A winner that fails the
  check refuses dispatch, so an older record never takes its place.** The candidates are the
  records in admitted comments, as today. The newest by `verdictAt` wins, as today. Then the
  winner must pass FR-1 for its kind. If it fails, the reader refuses with a new code,
  `record-author`, and a reason naming the kind, the comment's account and the rule. Why the
  check is not applied before selection: a stricter record posted later by the wrong account
  (for example a hand-written `hold: human`) would then be skipped, and an older `hold: none`
  would win. That fails open. Refusing fails closed and visibly (invariant 2, no silent gate).
  The cost: an admitted account that posts a wrong-author record holds the issue until it is
  re-triaged or re-approved. Admitted accounts can already hold an issue with a label, so this
  adds no new veto.
- **FR-4 — The label-path approval carries proof of the human's GitHub action, and the reader
  re-checks that proof.** `approve-on-label.sh` adds the node id of the `labeled` timeline
  event it verified to the approval record, as a new field `labelEvent:`. The reader accepts an
  App-authored approval only when it finds all of the following:
  1. a `labelEvent` is present;
  2. looking that event up on GitHub returns a `LabeledEvent` on **this** issue;
  3. its label is `agent-ready`;
  4. its actor is a `User` account on the author list;
  5. that actor's login equals `approvedBy`;
  6. the event's `createdAt` is no later than the record's `verdictAt` and at most `W` earlier
     (D3).

  The lookup is a GitHub read, like the one DR-105 decision 4 already allows the filter to
  make. If the read fails, the filter gives no answer (status 75, nothing written to the issue,
  offered again next cycle), as `dispatch-issue.sh:1195-1202` already handles. A read that fails
  is never treated as a refusal, and never as approval.
- **FR-5 — Every reader uses this one rule.** `dispatch-issue.sh`, `approve-issue.sh`,
  `approve-on-label.sh`, `backfill-hold-labels.sh`, `retriage-unrecorded.sh` and the SPEC-245
  ranker (when built) all get author-checked records through the same entry points. None of them
  keeps its own copy of the rule. A test lists every caller of `--trusted-comment-bodies` and
  `--newest-record` in `scripts/`, and fails when a caller skips the author check.
- **FR-6 — Enforce in stages, measure first.** Three stages, each its own pull request:
  - **Stage 1, the approval side:** FR-1 for approvals, FR-2 and FR-4.
  - **Stage 2, a read-only measurement:** a script reports, for every open issue with
    `agent-ready` or `agent-ready-specify`, the account behind its newest triage record and
    whether Stage 3 would refuse it.
  - **Stage 3, the triage side:** FR-1 for triage records, plus re-triage of every issue Stage 2
    flagged.

  Stage 3 may merge only alongside Stage 2's output from the same day. It is not measured here:
  this dispatch has no network. Records posted before #1355, or under
  `MINSPEC_GH_BOT_ALLOW_HUMAN=1` (`scripts/lib/gh-bot.sh:366,383`), are founder-authored, and I
  believe there are such records, unverified.
- **FR-7 — The approval writers reject a run that will fail the check.** `approve-issue.sh`
  refuses when the authenticated account is not a `User` on the author list. Its record would
  fail FR-1, so posting it would leave a comment that looks like an approval and does nothing.
  `approve-on-label.sh` refuses (and removes the label, as its other refusals do) when it
  cannot obtain the verified event's node id.
- **FR-8 — Retire the pinned "STILL OPEN" test.** The three tests at
  `dispatch-author-gate.test.ts:1104-1111` are reversed: a triage record from a non-listed
  collaborator, member or owner now gives `record-author`. The `#1105` lines in
  `dispatch-ready-check.sh` (`:54-57`, `:467`), `approve-issue.sh:53-56`,
  `approve-on-label.sh:33-36`, DR-072 §4 and §5a ("What this does NOT close") and DR-105
  decision 4 are rewritten in the same change to say what is now closed and what is not.
  A comment left stale would point readers at a gap that no longer exists, or hide one that does.
- **FR-9 — Surface the refusal.** `record-author` (and `approval-unverified` from FR-4, if
  kept as its own code) joins the codes the dispatcher posts to the issue, with a label and one
  comment (`dispatch-ready-check.sh:146`). The comment says what fixes it: re-triage for a
  triage record, or re-approve with `scripts/approve-issue.sh <N>` for an approval.

## Acceptance criteria

- **AC-1** A triage record posted by the founder account (`User:4125483`), with a correct
  `bodyHash`, `verdictAt` and `hold: none`, gives `not-ready [record-author]`. The same record
  posted by `Bot:299695933` gives `ready`.
- **AC-2** A triage record from a non-listed `COLLABORATOR`, `MEMBER` or `OWNER` gives
  `record-author`. These are the three tests reversed by FR-8.
- **AC-3** A human-approval record posted by `User:4125483` with `approvedBy: harvest316` is
  accepted. The same record with `approvedBy: someone-else` gives `record-author`.
- **AC-4** A human-approval record posted by the App with no `labelEvent` gives
  `record-author`. With a `labelEvent` whose event (a) does not exist, (b) belongs to another
  issue, (c) names another label, (d) was made by the App or a non-listed account, (e) has an
  actor login other than `approvedBy`, or (f) falls outside the time window, it is refused,
  one fixture per case. With a matching event, it is accepted.
- **AC-5** If the event lookup fails (fixture: the read exits non-zero), the filter exits 75
  and the dispatcher writes nothing to the issue.
- **AC-6** A comment body that contains a hand-made `<x>-AUTHOR Bot:299695933 minspec-sdd`
  line around a record does not change that record's author. Fixtures: a guessed nonce, an
  empty nonce, and the real nonce leaking into a body (filter refuses).
- **AC-7** A newer wrong-author `hold: human` triage record beside an older App `hold: none`
  record gives `record-author`, not `ready`. This is the fail-closed check in FR-3.
- **AC-8** The FR-5 coverage test fails when a fixture caller pipes `--trusted-comment-bodies`
  into `--newest-record` without the author check.
- **AC-9** Mutation check: deleting the author check in FR-1 or FR-3 turns at least AC-1, AC-3,
  AC-4 and AC-7 red. Vary the number of comments and their order: the newest record must be
  first in at least one fixture and last in another.
- **AC-10** If D4 (a) is chosen: an approval record with a current `bodyHash`, whose newest
  App-authored triage record holds `hold: human` (or `info`/`unknown`, or `human_only: yes`), is
  refused.

## Invariants this must not break

- **Invariant 2, no silent gate.** Every new refusal is visible (FR-9). A lookup that fails
  gives no answer, never a pass (FR-4). The nonce clash fails closed (FR-2). No new
  `|| true` on a write the gate depends on.
- **Invariant 1, offline.** This is dev-time pipeline code that already reads GitHub, and none
  of it ships in the extension. The FR-4 read is the only new network call, and it happens only
  for App-authored approvals.
- **Invariant 3, blast radius.** Only this repo's scripts change. Nothing ships to adopters.
- **DR-072 §3 is unchanged.** `APPROVABLE_HOLDS` is still `tier specify`. `human`/`info`/
  `unknown` stay absolute, and D4 (a) makes the reader enforce that too.
- **DR-105:** accounts are matched by kind and number, never by login. No environment variable
  or flag adds an account or turns the check off.
- **#1169:** the `ready` / `ready-specify` output and the rule that `decision` must agree with
  `hold` are untouched.
- The `bodyHash` staleness check and the newest-`verdictAt` selection with its future-date
  check (DR-072 §5a) keep working as they do now.

## Decisions needed (Clarify)

- **D1 — How the author reaches the reader.**
  - (a) **(rec)** Envelope marked by a per-run random value (FR-2), so the reader stays the one
    tested seam that judges records. Cost: a new argument on every reader call, and a parse rule
    for the envelope that must hold up against crafted bodies (AC-6).
  - (b) Filter by author before joining, once per kind: `--trusted-comment-bodies --kind
    triage|approval`, and the reader takes two source files. Simpler parsing, and the issue's
    concern that the decision would move into an untested dispatcher no longer applies, because
    the filter is already in the tested script. Cost: choosing the newest record across two
    files moves a second rule into every caller, and that is where FR-3's fail-closed ordering
    is easiest to lose.
- **D2 — What counts for the label path (FR-4).**
  - (a) **(rec)** The record carries the event's node id, and the reader looks that one event up.
    It binds the approval to a single action GitHub recorded. Cost: approvals made through the
    label path before this change carry no `labelEvent` and stop counting until someone re-labels
    (count unmeasured), plus one GitHub read per dispatch of such an issue.
  - (b) The reader searches the timeline for any matching `labeled` event in the window, with no
    new field. Cost: weaker. A process with the App token can reuse a real earlier label action
    by the founder, for example one the label path refused because the hold was `human`, if D4 is
    not taken.
  - (c) Retire the label path. Approvals come only from the CLI, and FR-1(b) is deleted. Cost:
    removes the founder's one-click approval (#1113), which goes against core tenet 1.
- **D3 — The time window `W` for FR-4 (6).** (a) **(rec)** 15 minutes: the label path normally
  posts within one workflow run. Cost: a runner queue longer than 15 minutes refuses a genuine
  approval, and the founder has to re-label. (b) 24 hours: fewer refusals in that case, but a
  wider window for reusing a real label action.
- **D4 — Does the reader check an approval against the triage record it replaces?** (Problem
  item 4.)
  - (a) **(rec)** Yes, in this spec. The reader also finds the newest triage record that passes
    the author check. It requires that record's `hold` to be in `APPROVABLE_HOLDS`, its
    `human_only` to be `no`, and the approval's `supersedes` to equal that `hold`. It uses the
    same `--may-approve` function the writers call, so writers and reader cannot drift. Cost:
    widens #1105 past author binding, though it is the same reader and about 20 lines. An
    approval also stops counting if no App-authored triage record exists, which is only possible
    for issues whose triage record predates the App.
  - (b) Split it into its own issue. It keeps this spec narrow. Cost: until it lands, a
    hand-made approval from an admitted human releases a `hold: human` issue.
- **D5 — Keep the association arm for admission?** (a) **(rec)** Keep it as a candidate source.
  Under FR-3, a non-listed collaborator's record can then only cause a visible refusal, never a
  pass. Cost: such an account can hold an issue until it is re-triaged. (b) Drop it: admit
  listed accounts only. Cost: a record from a collaborator who is not listed is silently skipped,
  which is the fail-open ordering FR-3 rejects.

## Alternatives rejected

- **Interleaving `<!-- author: X -->` text markers.** Anyone can write a comment body, so the
  marker can be forged (#1105, DR-072 Alternatives).
- **Comparing the comment's login with `approvedBy` and nothing else.** A login is a name,
  and someone else can take it (DR-105). The account kind and number decide, and the login
  check is extra.
- **Trusting any `*[bot]` author for triage records.** That would trust `github-actions[bot]`,
  `dependabot[bot]` and every App installed later (DR-072 §5).
- **Applying the author check before choosing the newest record.** That fails open (FR-3).

## Follow-ups (tracked)

- **#1105**: this spec. FR-8 closes the residual text in DR-072 §4 and §5a and in DR-105
  decision 4 when it is built.
- **#397**: the family of record and label provenance this belongs to. Not closed by this
  spec (who applied a role label stays unchecked, DR-105).
- **SPEC-245** (ranker reads the verdict tier): its ranker must call the entry points FR-5
  names, not a copy of the rule.
- If D4 (b) is chosen, a new issue must be filed for the reader's check against the replaced
  triage record before this spec is approved. Otherwise that item is a follow-up that lives only
  in prose.
