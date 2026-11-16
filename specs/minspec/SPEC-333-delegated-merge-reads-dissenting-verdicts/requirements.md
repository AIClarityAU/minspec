---
id: SPEC-333
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; the delegated merge lane is part of the drain (SPEC-062)
aspects: [drain, delegated-merge, ai-review, fail-closed, security]
depends_on: []
relates_to: ["#3750", "#3287", "#3586", "#2981", "DR-121", "DR-119", "DR-112", "DR-108", "SPEC-062", "SPEC-130"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: the shared review judge in scripts/lib/delegated-approval.ts,
  the delegated merge judge in scripts/lib/delegated-merge.ts, and the --delegated-spec-merge seam in
  scripts/dispatch-issue.sh. None of it is built.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-333: The delegated merge lane refuses a head that any trusted verdict calls `changes`

Issue: #3750. Incident: #3287 (SPEC-130 (checkbox-state hash exit) plan pull request).
Rests on: DR-121 (plan artifacts merge on AI review once their spec is approved), DR-119
(the delegated-approval merge lane), DR-112 (the bot merges once a second independent AI
review agrees), DR-108 section 2 (an agent may tighten a delegation, never widen one).

## Problem

#3287 was merged by `minspec-sdd[bot]` through the DR-121 plan arm at 2026-11-14T20:36:28Z,
at head `6b2ec60278db5193e89c7b002593f59939d87940`. At 20:26:33Z, ten minutes earlier, an
independent DR-112 second review of that same head was posted on the pull request with
`VERDICT: changes` (job rv-3287-6b2ec602-6af8c2de). The merge went ahead on the panel's
`ai-review:pass` comment from 20:13:17Z. (Timestamps and sha are from the issue; not
re-read here, because this dispatch makes no network call.)

### Mechanism (read from code at `94a01043`)

- The merge judge `planDelegatedMerge` (`scripts/lib/delegated-merge.ts:224-346`) reads
  exactly one verdict: `judgeHeadReviewPass(review)` at `:303`.
- `judgeHeadReviewPass` (`scripts/lib/delegated-approval.ts:264-318`) treats as "the
  latest AI review comment" only comments whose author is `REVIEWER_LOGIN` and whose body
  matches `REVIEW_HEADING`, `/^## 🤖 AI review — \`ai-review:([a-z-]+)\`/`
  (`delegated-approval.ts:79`, filter at `:285`). Every other comment is dropped before
  the sort, so it cannot be "latest".
- So a verdict in any other format, which includes the DR-112 second review, is invisible
  to the judge however recent it is and whatever it says. I believe the second review's
  body does not start with that heading (the issue quotes it as `VERDICT: changes`); this
  is inferred, not observed, because the comment is not readable offline.
- By design the delegated lane never *requires* a second verdict: DR-112 section 2's
  DR-119 amendment says its condition (b) "does not apply" to that lane, and DR-121 s2.4
  inherits DR-119's pins. That is intended. The defect is narrower: when a second verdict
  *does* exist and dissents, nothing reads it.
- The spec arm has the same blind spot plus a second window: it arms GitHub native
  auto-merge (`mergeMode: 'auto'`, `dispatch-issue.sh:956`), which stays armed, so a
  dissent posted after arming is never consulted at all.
- The post-merge approval path (`scripts/lib/delegated-approval-caller.ts`) calls the same
  `judgeHeadReviewPass`, so it would record a delegated spec approval over the same
  dissent.

Root cause, mechanism plus missing gate: the judge establishes that *a* pass exists on the
head and never establishes that *no* trusted verdict on that head disagrees. This is the
"absent witness read as a pass" shape that constitution invariant 2 forbids, applied to a
witness that is present but filtered out. No test pins the dissent case, so nothing went
red.

### Consequence still on `main`

Two findings from the ignored review, checked against
`specs/minspec/SPEC-130-checkbox-state-hash-exit/` at `94a01043`:

1. `tasks.md` task 5.1 (lines 132-136) claims "AC FR-1 (all three, extension side)" but
   tests editing and adding a criterion, not removing one. FR-1's acceptance criterion
   (`requirements.md:295`) names removal. The matching plan text is `design.md:240-241`.
2. `tasks.md` task 5.2 (lines 138-143) tests tick, a text change and `[~]` on the gate
   side, but not untick, adding a criterion, or removing one. Matching text:
   `design.md:242-245`. Task 7.1 must name a test for every part of the criterion.

## Functional requirements

- **FR-1 One reader for every verdict on the head.** The shared judge in
  `delegated-approval.ts` reads every recognised verdict comment on the pull request
  (FR-3), not only panel comments, and binds each to the head sha it names. Both callers,
  the delegated merge judge and the post-merge approval caller, get the new reading through
  that one function, so the two still cannot disagree on what a pass on a head is.
- **FR-2 Dissent refuses.** If any recognised verdict from a trusted author (FR-4) names the
  judged head sha and its verdict is anything but `pass`, the judge refuses with reason
  `head-verdict-dissents`, naming the comment URL, its author and its verdict. This holds
  whatever the comment's position relative to the panel pass, subject to Clarify item 1.
  A new head clears it, because a verdict binds to one sha.
- **FR-3 A machine-readable verdict marker.** A verdict is recognised by a single marker line
  defined in this repo, of the form
  `<!-- minspec-verdict v1 sha=<40-hex> verdict=<pass|changes|blocked> source=<panel|second-review> job=<id> -->`
  (exact grammar fixed in the plan). The panel's existing heading stays recognised as a
  panel verdict. The grammar is written once, in `scripts/lib/`, and the second-review
  producer emits it. That producer is the chief-of-staff runner under `~/.claude/scripts/`,
  outside this repo, so the build files the runner change as its own issue on the repo
  that versions it, and FR-2 must not rely on it until that change ships (see Clarify
  item 4).
- **FR-4 Trusted authors only.** A verdict counts for FR-2 only when its comment author is
  on a fixed allowlist (at least `minspec-sdd[bot]`; the list is fixed in the plan). A
  marker from any other author is ignored for the decision and reported in the judge's
  detail, so a stray commenter can neither pass nor block a merge. See Clarify item 2.
- **FR-5 Unreadable fails closed.** A comment from a trusted author that carries the marker
  but does not parse, or names a sha that is not 40 hex, refuses with reason
  `head-verdict-unreadable` (invariant 2). A comment-list read failure already throws and
  denies (`gatherReviewEvidence`, `delegated-approval.ts:338`); that stays.
- **FR-6 Read at the moment of the merge.** For a direct merge (`mergeMode: 'direct'`), the
  verdicts are read in the same invocation that runs
  `gh pr merge --squash --match-head-commit <sha>`, after every other check, so the window
  between the last read and the merge is seconds. The judge's JSON output carries the time
  of its comment read.
- **FR-7 No armed merge outlives a dissent.** A dissent posted after the spec arm has armed
  native auto-merge must stop that merge. The mechanism is Clarify item 3.
- **FR-8 Visible in the drain log.** Every refusal under FR-2, FR-4 and FR-5 appears in the
  drain log line for that pull request with its reason, like the existing `plan-*` reasons.
- **FR-9 Post-merge audit of this class.** A read-only check lists every pull request merged
  by the delegated lane whose merged head carried a trusted dissenting verdict posted before
  the merge time, so a recurrence (or a pre-fix case like #3287) is visible. It reports; it
  reverts nothing.
- **FR-10 Remediate SPEC-130's plan.** A separate plan pull request on SPEC-130 adds: to
  task 5.1, the removal case; to task 5.2, untick (allowed), add a criterion (denied) and
  remove a criterion (denied); and the same cases to `design.md:240-245`. That pull request
  is ordinary plan work under DR-121, not part of this spec's build, and SPEC-130's task 5
  is not started before it merges.

## Acceptance criteria

- **AC-1 (FR-2, regression for #3287).** A fixture with the panel pass comment at
  20:13:17Z and a trusted second-review `changes` marker at 20:26:33Z, both on
  `6b2ec602...`, with every other DR-121 condition met: the judge refuses with
  `head-verdict-dissents` and names the second comment. Negative control: the same fixture
  without the second comment is admitted (`arm: true`). Mutant: drop the dissent check and
  AC-1 goes red.
- **AC-2 (FR-2 sha binding).** A `changes` marker naming an *earlier* head does not refuse
  the current head; one naming the current head does. Mutant: compare sha prefixes or skip
  the sha comparison and one case goes red.
- **AC-3 (FR-2 order).** A dissent posted *before* the panel pass on the same head still
  refuses (or, if Clarify item 1 picks otherwise, the chosen rule is tested both ways).
- **AC-4 (FR-4).** A well-formed `changes` marker from a non-allowlisted login does not
  refuse and appears in the detail; a well-formed `pass` marker from the same login does
  not count as a pass either.
- **AC-5 (FR-5).** A trusted comment with a malformed marker refuses with
  `head-verdict-unreadable`; the same comment with the marker fixed is read normally.
- **AC-6 (FR-1).** The post-merge approval caller refuses to record a delegated approval
  over the AC-1 fixture, with the same reason, through the shared function (one test per
  caller).
- **AC-7 (FR-7).** With the mechanism chosen in Clarify item 3, a dissent posted after a
  spec pull request is armed leads to no merge of that head (simulated `gh`; assert no
  merge call was recorded, or that `--disable-auto` was recorded).
- **AC-8 (FR-9).** Run read-only against the live repo, the audit lists #3287 (expected
  hit), or states why it cannot see it.
- **AC-9 (FR-10).** SPEC-130's `tasks.md` tasks 5.1 and 5.2 name every case of FR-1's
  criterion on each side, and `design.md` matches.
- **AC-10 (tests are real).** Every new test file is typechecked by `tsc` (tests sit
  outside the tsconfig includes) and run under `npx vitest`, as CI runs it.

## Invariants this must not break

- **Constitution invariant 2 (no silent gate).** FR-2, FR-5 and FR-7 fail closed and
  visibly; no read of a verdict is wrapped in a swallowed error.
- **Constitution invariant 1 (offline core).** All of this is dev-time machinery under
  `scripts/`; nothing ships in the extension, and the extension makes no new network call.
- **Constitution invariant 3 (blast radius).** The lane still acts only in repos with
  `.minspec/` and still refuses memory-fabric by name.
- **DR-108 section 2.** This change only tightens the delegated lane: every pull request it
  refuses today it still refuses. Nothing here admits a pull request that is refused now.
- **DR-121 and DR-119 pins** (bot author, labels, CI green on the head, merge pinned with
  `--match-head-commit`, never `--admin`) are unchanged.
- **DR-112.** The second review stays optional for the delegated lane; this spec does not
  make it required, only binding when present.

## Out of scope

- Making a second independent review mandatory for delegated merges (a widening of process
  cost and a DR-112/DR-119 decision, not this bug).
- Reverting #3287: its content is a plan, and FR-10 corrects it forward.
- The runner-side code that posts the second review, beyond emitting the FR-3 marker.

## Security review of the design (role: security)

- **A01 Broken access control / spoofed verdicts.** Recognising verdicts by text alone would
  let any commenter on a public repo block (or, if `pass` markers counted, unblock) a
  merge. FR-4 limits both directions to allowlisted authors; the author login is read from
  the GitHub API, not from the comment body.
- **A04 Insecure design / fail-open.** The incident is a fail-open read: a filter dropped a
  witness. FR-5 makes a malformed trusted witness deny; AC-1's negative control and mutant
  stop the test from passing vacuously.
- **A08 Integrity.** Verdicts bind to the full 40-character sha (FR-2, AC-2), never a prefix
  and never the branch name, and the merge itself stays pinned with `--match-head-commit`.
- **TOCTOU.** A verdict posted between the read and the merge call is not caught by the
  judge; FR-6 bounds it to seconds for direct merges, FR-7 removes the open-ended window for
  armed merges, and FR-9 makes any miss visible after the fact.
- No secret, token or credential is read, stored or logged by anything specified here.

## Decisions needed (Clarify)

1. **Does a later panel pass on the same head override an earlier dissent?**
   `a` **(rec)** No: any trusted dissent on the head refuses until the head moves or the
   *same source* posts a later `pass` on that head. Cost: a stale or wrong second review
   holds a pull request until someone re-runs that review or pushes. `b` Only verdicts
   newer than the panel pass count (the issue's minimum wording). Cost: re-running the panel
   on an unchanged head silently overrides an independent reviewer, which reopens #3287.
2. **Who is trusted to dissent?** `a` **(rec)** Only the allowlist (FR-4), with untrusted
   markers reported but not acted on. Cost: a real human `changes` comment without the bot
   identity does not block; a human uses `hold:*` for that, which already refuses. `b` Any
   author can block, only allowlisted authors can pass. Cost: anyone who can comment on a
   public pull request can stall the drain.
3. **How FR-7 stops an armed spec merge.** `a` **(rec)** Move the spec arm to direct mode,
   like plans: merge only once every check is finished and green, with no native
   auto-merge. Cost: a spec pull request waits until the next drain cycle after its checks
   finish, instead of merging the moment they do. `b` Keep native auto-merge and re-judge
   every armed pull request each drain cycle, disarming on dissent. Cost: a merge can still
   land inside one drain cycle after a dissent, and the disarm step is new machinery whose
   own failure must be made visible.
4. **Legacy free-text verdicts.** Until the runner emits the FR-3 marker, should a trusted
   comment containing a `VERDICT: changes` line also refuse? `a` **(rec)** Yes, as a
   transitional rule: a trusted comment matching `^VERDICT:\s*(\S+)` together with a full
   40-hex sha in the same comment counts; a trusted `VERDICT:` comment with no sha refuses
   as unreadable. Cost: a second parser to delete once the marker lands, and the free-text
   form must be confirmed against a real comment body before the plan fixes it (not
   observable from this offline dispatch). `b` Marker only. Cost: the lane stays blind to
   second reviews until the runner change ships.
5. **Record the tightening in a decision record?** `a` **(rec)** No new DR: the change is a
   tightening (DR-108 section 2 allows it), reversible in under a day, and this spec is its
   record. Cost: DR-121 section 2's list of conditions no longer names every condition the
   code checks. `b` Amend DR-121 section 2.4. Cost: a founder acceptance for a change that
   only adds a refusal.
