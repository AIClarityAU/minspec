---
id: SPEC-234
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a hold label that comes off with no record makes the signpost lie about whether a human gate stands
aspects: [hitl, human-gate, labels, no-silent-gate, blast-radius, determinism, audit-trail]
depends_on: [DR-066, DR-072]  # no silent gate; a content-class hold is never liftable by approval
relates_to: ["#2113", "#1750", "#1857", "#1816", "#1847", "#1870", "#1741", "#983", "#1113", SPEC-209, DR-086]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns (a new workflow, a pure predicate
  module, and edits to the in-repo hold-label writers) is decided at Plan, after
  Decisions D1 to D3. Declare implements:/affects: before approval mints a hash.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-234: Removing a `hold:*` label always leaves a record, and an unexplained removal does not stand

Triggered by: #2113 (on #1750, `hold:human` was removed on 2026-09-05 by
`minspec-sdd[bot]` and no comment was left).
Rests on: [DR-066](../../../docs/decisions/DR-066.md) (no silent gate) and
[DR-072](../../../docs/decisions/DR-072.md) §3 (a `hold:human` is never liftable by an
approval).

**No new DR.** Every choice below is a repo-local workflow plus a pure predicate. Deleting
the workflow file undoes it in minutes, so it does not pass the ADR filter (a choice that
cannot be undone in under a day). One exception: if Clarify D6 decides to ship this
workflow to adopters as a scaffolded template, that is a change to what MinSpec ships,
and Plan must mint a DR for it.

## In plain terms

A `hold:*` label means "a human must decide this before automation goes on". When triage
puts one on, it leaves a comment saying why. When anything takes one off, nothing is
written. So from outside, a correct release of the gate and an accidental one look the
same: the label is just gone.

This spec makes every removal of a `hold:*` label write a visible record on the issue or
pull request, saying who removed it and whether they gave a reason. If they gave no
reason, the label goes back on (subject to Decision D1).

## Root-cause diagnosis (read from code at `3d3f9914`, 2026-10-27)

**Mechanism.** GitHub records a label removal only as a timeline event. Nothing in this
repo listens for the `unlabeled` event on issues in order to record it, and the in-repo
writers that remove `hold:*` labels do not name the removed label in any comment:

| writer | removes | comment that names the removed `hold:*`? |
|---|---|---|
| `scripts/triage-inbox.sh:309-326` (re-triage supersede) | every `hold:*` except the new one, plus `needs-review` when the new decision is `agent-ready` / `agent-ready-specify` (`:288-289`) | **no**. The triage comment (`:264`) names the NEW hold only |
| `scripts/backfill-hold-labels.sh:90-94` | every `hold:*` except the wanted one | **no comment at all**, and the removal ends in `|| true` |
| `scripts/approve-issue.sh:276-282` | the labels in `CLEAR_LABELS` | yes. The approval comment names the lifted `hold:<x>` (`:247`) |
| GitHub UI / any API caller | anything | whatever they choose to write, often nothing |

**Missing gate.** Nothing checks that a `hold:*` removal was explained. Per the RCDD rule,
correcting the label on #1750 by hand fixes the data and leaves this gap open.

**Which writer removed the label on 2026-09-05?** Not known. That is a claim I have not
checked: the git host is out of reach on this dispatch. The removed pair (`hold:human` +
`needs-review`) is exactly what the `agent-ready` arm of `triage-inbox.sh` removes
(`:288`, `:309-316`). But that path posts a triage comment first (`:264`), and the issue
reports no comment. So either the comment was missed in the read, or a different writer did
it. FR-0 requires the answer before Plan.

**Where the missing record costs something (cited):**

- **Pull requests: a merge gate.** `docs-lane.yml:155-170` refuses to arm auto-merge while
  any `^hold:` label is present. `ready-to-merge.yml:8` requires no `hold:*`.
  `alta-self-merge.yml:15` requires no `hold:*`. `docs-lane.yml:22` and
  `ready-to-merge.yml:96` both re-run on `unlabeled`. So a silent strip on a PR **releases
  a merge gate in the same event**. #1741 measured an 8-second gap between applying a hold
  and the lane arming. This is the sharper half of the defect, even though #2113 was
  found on an issue.
- **Issues: advisory to anything that reads labels.** The dispatcher does not read the
  label. `dispatch-ready-check.sh:764-768` reads the `hold:` field of the verdict record
  and refuses anything other than `none` / `specify`. So the issue's claim that the drain
  sees the issue as dispatchable once the label is gone does not hold for the drain. It
  does hold for label-reading sessions and chief-of-staff sweeps, and for any human
  scanning the board. Also, `needs-review` (removed in the same event on #1750) IS a
  countermanding label at dispatch (`dispatch-ready-check.sh:685-687`).

## Functional requirements

- **FR-0 (precondition for Plan, no code).** Pull the timeline of #1750 around
  2026-09-05T05:54:10Z and name the writer that removed `hold:human` + `needs-review`.
  Cite either the workflow run or the script line. If that writer is in this repo, its fix
  is in scope under FR-5. If it is not, record that.
- **FR-1 Every removal is recorded.** When a label matching `^hold:` is removed from an
  issue or pull request (scope per D3), one record comment is posted on that item within
  the same workflow run. It states: the label, the removing actor's login, the actor's type
  from the event payload (`User` / `Bot`), the event time, and the result of FR-2
  (`explained` with a link to the reason comment, or `unexplained`). The record carries a
  fixed, machine-greppable marker line so a consumer can find it without parsing prose.
- **FR-2 One deterministic "explained" predicate.** A removal counts as explained exactly
  when the rule chosen in D2 matches. The predicate is a pure function of (removal event,
  the item's comment list), has no network access, and is unit-tested on fixtures.
  Anything that consumes it calls it; nothing copies it. This follows "duplicated
  predicates drift".
- **FR-3 An unexplained removal does not stand** (if D1 = revert). The label is put back on
  by the App identity, and the FR-1 record says it was put back and how to remove it
  properly, giving the exact comment form D2 accepts.
- **FR-4 Bounded, no flapping.** For each (item, label), the guard puts the label back at
  most once in any 24-hour window. A second unexplained removal inside that window is
  recorded only. It is NOT put back. The item gets `needs-human-review` and the record says
  automation stopped fighting a repeated removal. Putting a label back is a `labeled`
  event, so it cannot re-trigger the `unlabeled` handler. This property must be tested,
  not assumed.
- **FR-5 In-repo writers explain themselves.** Every script in this repo that removes a
  `hold:*` label (today `triage-inbox.sh`, `backfill-hold-labels.sh` and
  `approve-issue.sh`, plus whatever FR-0 finds) posts a comment naming each removed
  `hold:*` label **before** it removes the label, in the form FR-2 accepts. Writers that
  follow the rules are then never reverted. A removal whose comment write failed does not
  proceed, so the `|| true` at `backfill-hold-labels.sh:94` goes for `hold:*`.
- **FR-6 PR merge lanes do not act during the gap.** If an unexplained `hold:*` removal on
  a PR is followed, in the same burst of events, by a merge lane arming, the guard disarms
  auto-merge on that PR and says so in the FR-1 record. The alternative is for the lanes
  to call the FR-2 predicate on their own `unlabeled` runs. Plan chooses between the two.
  Remaining risk, stated: a merge that has already completed cannot be undone. The guard
  makes it visible and nothing more.
- **FR-7 Fail closed and visibly.** If the guard cannot read the comment list, cannot
  post the record, or cannot put the label back, the run goes **red**: no `|| true` on any
  of those writes. An error while reading comments is treated as `unexplained`, never as
  `explained`.

## Invariants (must not break)

- **INV-1 Offline core (constitution invariant 1).** This is CI machinery for this repo
  only. Nothing is added to `packages/minspec` and the extension makes no new network
  call. The FR-2 predicate is pure.
- **INV-2 No silent gate (invariant 2 / DR-066).** The guard's own load-bearing writes are
  never `|| true` (FR-7). The guard is a **second witness**. It does not replace the gates
  that read labels: `docs-lane`, `ready-to-merge` and `alta-self-merge` keep their own hold
  checks unchanged.
- **INV-3 Blast radius (invariant 3).** The workflow lives in this repo's `.github/` and is
  not scaffolded into adopters unless D6 says so. If it is, the template must check for
  `.minspec/` at the repo root first.
- **INV-4 DR-072 §3 unchanged.** Explaining a removal records it. It is never an approval.
  An explained removal of `hold:human` does not make an issue dispatchable, because the
  verdict record still governs (`dispatch-ready-check.sh:764-768`).
- **INV-5 Bot attribution.** Every write the guard makes uses the App installation token
  (`minspec-sdd[bot]`), the same as `approve-on-label.yml`. No write is made under a
  human's account.
- **INV-6 Identity gap not claimed closed.** The record states the actor's login and type
  as GitHub reports them. It does not claim that a removal was done by a human, because
  #1816 (a human act has no witness) is still open.

## Acceptance criteria

- **AC-1** Fixture: an `unlabeled` event for `hold:human` with no matching comment. The
  predicate returns `unexplained`, one record is planned, and one re-label is planned
  (if D1 = revert).
- **AC-2** Fixture: a comment that matches the D2 rule, from the same actor, inside the
  window. The predicate returns `explained`, a record is planned, and no re-label is
  planned.
- **AC-3** Fixtures at the edges of the window: same actor one second outside the window,
  a different actor inside the window, and a comment that names a different `hold:*`. All
  three return `unexplained`. Mutation check: deleting any single clause of the predicate
  makes at least one of AC-1 to AC-3 fail.
- **AC-4** Flap bound: a second unexplained removal of the same (item, label) inside 24h
  plans a record plus `needs-human-review` and no re-label.
- **AC-5** Fail closed: a comment-list read that errors gives `unexplained`, and the job
  step exits non-zero. A test reads the workflow file and asserts that no record or
  re-label write ends in `|| true`.
- **AC-6** Each in-repo writer from FR-5, run against a stubbed `gh`, posts a comment
  naming the removed label before the removal call, and does not proceed when the comment
  call fails.
- **AC-7** The workflow does nothing (no record, no write) on `unlabeled` events for labels
  that do not match `^hold:`.
- **AC-8** FR-0's answer is written into the Plan with a citation.

## Decisions needed (Clarify)

- **D1: Revert, or record only?**
  `a` **revert unexplained removals and record them (rec)**. An unexplained release of the
  gate does not stand, which is what #2113 asks for. Cost: a new write path on an event
  that fires often, plus the risk of fighting a legitimate actor. FR-4's once-per-24h bound
  limits that risk without removing it.
  `b` record only. There is no flapping, but on a PR the merge lane has already acted on
  the removal by the time anyone reads the record.
- **D2: What counts as a reason?**
  `a` **a comment by the same actor that contains the exact label name, posted at most 30
  minutes before the removal (rec)**. It is deterministic and it is what a careful human
  already does. Cost: in the UI the human must comment first and then remove. Doing it in
  the other order gets one revert, and then the second removal is explained.
  `b` a structured line such as `hold-release: hold:human — <reason>`. Cost: more ceremony,
  and humans will forget the syntax.
  `c` any comment by anyone in the window. Cost: weak, because an unrelated comment
  launders the removal.
- **D3: Scope.**
  `a` **both issues and pull requests (rec)**. On PRs a `hold:*` label is a merge gate (see
  diagnosis), so leaving PRs out would leave the sharper half open. Cost: PR label events
  are frequent, so this means more workflow runs.
  `b` issues only, as #2113 is literally framed.
- **D4: Exempt Bot-type actors?**
  `a` **no exemption (rec)**. The removal on #1750 was by a bot, and FR-5 lets in-repo bots
  explain themselves cheaply. Cost: an external bot that strips labels would be reverted
  once, then left alone and flagged.
  `b` exempt `minspec-sdd[bot]`. This recreates the exact hole on #1750.
- **D5: The opposite failure, a hold that outlives its decision** (#1750 still carries
  `hold:human` after the founder answered it).
  `a` **out of scope here, to be filed as its own issue (rec)**. Detecting "the human
  answered" is a separate decision family, sitting next to #1857 and SPEC-209. Cost: the
  stale label on #1750 stays wrong until that issue lands or someone fixes it by hand.
  `b` fold it in. This doubles the spec.
- **D6: Ship to adopters?**
  `a` **this repo only (rec)**. The defect was measured here, and shipping it would need a
  DR plus the `.minspec/` check. Cost: adopters keep the same blind spot.
  `b` scaffold as a template.

## Alternatives rejected (DR-086 §4)

- **Fix the label on #1750 by hand and stop there.** That fixes the data and leaves the
  gate missing: the RCDD tell.
- **Fold this into #1750.** That issue is about what an approval produces. This one is
  about whether removing a hold can be seen.
- **Fold this into #1857 / SPEC-209.** That work adds a field a consumer can read. This one
  guards an event. The fixes differ, and they are cross-linked here.
- **Make the dispatcher read `hold:*` labels.** The dispatcher is already bound to the
  verdict record (`dispatch-ready-check.sh:764-768`), which is stronger than a label. Also
  reading the label would add a second source of truth that can drift.
- **Use the git host's own audit log.** It is not visible on the item, and it is not
  readable by the sessions and sweeps that read labels.

## Follow-ups (tracked)

- D5 (`a`): "a `hold:*` label that outlives its human decision". To be filed at Clarify if
  D5 = `a`. Not filed by this dispatch, which may not make network calls.
- FR-0's answer may name an out-of-repo writer. If so, file it against the repo that owns
  that writer.
- The identity gap underneath: #1816 (existing).
