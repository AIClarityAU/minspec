---
id: SPEC-232
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness - docs-lane push ergonomics
aspects: [docs-lane, label-producer, no-silent-gate, duplicate-predicate]
depends_on: []
relates_to: ["#2094", "#2078", "#2158", "#1847", SPEC-039, SPEC-050]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D1.
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-232: "Push docs via lane" only labels a PR `docs-lane` when the lane will accept it

> **This is a SPECIFICATION ONLY.** Written for issue #2094. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## Context

The `docs-lane` workflow auto-merges docs-only PRs. It has two arming preconditions: every
changed path is in the docs corpus, and (since #1847) no changed `status:` line under
`docs/decisions/` or `specs/` (a *governance status transition*, a human act per DR-029 and
DR-086 §2). A PR failing the second precondition is refused with `exit 1`.

Three producers mint the `docs-lane` label. Observed in the tree on current main:

| Producer | Corpus check | Eligibility (status-transition) check |
|---|---|---|
| `commands/commit-on-approve.ts:825-826` via `laneRefusal` / `laneLabelsFor` (`lib/approval-pr.ts:440-499`) | yes | **yes** (fixed by #2078) |
| `scripts/push-docs.sh` (bash) | yes | **yes** (fixed by #2158, `lib/governance-transition.sh`) |
| `commands/push-docs-lane.ts:378` (`labels: [DOCS_LANE_LABEL]`) | yes (`isDocsCorpusPath`, `:224`) | **no** |

So #2094's claim holds, with drifted line numbers (the issue cites `:365`; the literal is now at
`:378`). The command passes the label as a literal once the corpus filter has passed. A working
tree where a DR's or spec's `status:` line changed, pushed with other docs edits, opens a PR the
lane is guaranteed to refuse: a permanent manufactured red, the same harm #2078 measured on
#2071, #2072 and #2073. `docs-lane` is not a required check, so nothing is mechanically blocked;
the cost is a red that trains readers to ignore a gate.

The producer's own header already admits the gap (`lib/approval-pr.ts:396-397`: "NOT the only
place the label is minted — `push-docs-lane.ts` passes a literal").

Root cause (mechanism plus missing gate): `push-docs-lane.ts` was rewired onto the shared
`openPullRequest` seam (SPEC-050 FR-4) as a *pure refactor*, so it kept its literal label and
never adopted the eligibility predicate that #2078 later added beside the seam. Nothing pins
"every call site of `openPullRequest` that passes the lane label routes through `laneRefusal`",
so a new or old producer can bypass it unnoticed.

## Functional Requirements

- **FR-1** Before opening the PR, `pushDocsLane` decides the lane label from
  `laneRefusal(paths, diffs)` over the exact set of paths it commits (additions, modifications
  and deletions), not from a literal. The label is applied if and only if the result is `eligible`.
- **FR-2** The diff evidence for governance files comes from the same evidence function the
  approval flow uses (`branchDiffEntries`), computed against the commit actually being pushed
  (the temp worktree branch vs `origin/main`), not against the primary checkout's working tree.
- **FR-3** Fail closed, visibly. If the changed set or any governance diff cannot be
  determined (`unproven`, `unproven-governance`), no label is applied and the user is told why;
  the command never assumes eligible on a missing witness (constitution invariant 2).
- **FR-4** When the label is withheld, behaviour follows Decision D1. Whatever D1 chooses, the
  surfaced reason is `laneRefusalSentence(refusal)`, never the old hard-coded "not docs-only"
  wording, which is false for a status transition.
- **FR-5** The PR body's lane note ("auto-merges once green") is only written when the label
  is applied. A PR without the label must not claim to auto-merge.
- **FR-6** Unchanged: consent gate before any network (FR-3 of SPEC-039), primary HEAD/index
  never moved, no non-docs path pushed, worktree cleaned in `finally`, ENOENT/auth/network
  outcome classification. The server-side re-check in `docs-lane.yml` stays; this change only
  withholds a label, it never relaxes the lane.
- **FR-7** A pin test fails if any call site passes the lane label to `openPullRequest` other
  than via `laneLabelsFor`/`laneRefusal` output (closes the "no test pins the producers together"
  gap; shape per Decision D2).

## Acceptance Criteria

- **AC-1** Working tree changes one DR `status:` line plus one unrelated doc: the command opens
  a PR with no `docs-lane` label (or declines, per D1), and the reason shown names the status
  transition.
- **AC-2** Working tree changes only a non-governance doc (e.g. `CLAUDE.md`, a skill): the PR
  is still labelled `docs-lane`, with no extra git call beyond today's.
- **AC-3** Working tree changes a spec body but not its `status:` line: labelled `docs-lane`.
- **AC-4** Governance diff unreadable (git error, or over the `MAX_GOVERNANCE_DIFFS` cap): no
  label, reason shown, no throw out of the command.
- **AC-5** A brand-new DR or spec (all-`+` patch containing `+status: proposed`) is treated as
  a transition, matching the lane's documented behaviour (`docs-lane.yml` ~`:232`).
- **AC-6** `tests/push-docs-lane.test.ts` existing cases pass; any case that asserted the
  literal label for a governance fixture is updated deliberately and named in the PR.
- **AC-7** FR-7's pin test is red on current main (literal at `:378`) and green after the change.
- **AC-8** Deleting a governance file (`git rm`'d path) is handled: a deletion's diff contains
  no `+status:`/`-status:`-only ambiguity that crashes the evidence step; the outcome is
  eligible or refused, never an exception.

## Invariants the change must not break

- **Constitution 1 (offline):** the extra `git diff` calls are local; no new network call.
- **Constitution 2 (no silent gate):** a missing or errored witness withholds the label and says
  so; no `|| true` on the decision path; the workflow's server-side check remains the second witness.
- **Constitution 3 (blast radius):** no change to repos that have not opted in (`.minspec/`).
- **SPEC-050 INV-2:** the label is only ever minted by the single predicate.
- **SPEC-039 FR-5:** primary checkout HEAD and index untouched.

## Out of scope

- `commit-on-approve.ts` and `scripts/push-docs.sh` (already carry the check; see table).
- Changing the lane's refusal rule or `docs-lane.yml` (Decision D3 only asks whether to make
  the refusal neutral instead; that is the #2078 option the founder did not take for the other producers).
- Any implementation, in this dispatch.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

**D1 — What does the command do when the label is withheld?**

**Recorded selection: Option (a),** open the PR without the label, as the approval flow does,
with the reason in the toast and PR body.

- **(a) Open the PR without the label (rec).** Same as the approval flow: human merges with one
  keystroke; the reason is in the toast and PR body. Cost: the user asked for "push via lane" and
  gets a PR that is not on the lane; a mixed status-change plus docs push needs a manual merge
  unless they split it.
- (b) Decline before any network and tell the user to split the status change into its own PR.
  Cost: the user must do the split by hand; nothing is pushed, so a blocked push is the only outcome.
- (c) Auto-split into two PRs (eligible docs on the lane, transition files unlabelled). Cost: a
  new multi-PR flow, partial-failure handling, and it breaks SPEC-039's one-command-one-PR contract.

**D2 — How are the producers kept in sync?**

**Recorded selection: Option (a),** call `laneRefusal` at the call site, plus a
source-text/parity pin test.

- **(a) Call `laneRefusal` at the call site, plus a source-text/parity pin test (rec).** Smallest
  change; reuses the existing seam and `governance-lane-eligibility.test.ts` containment. Cost: the
  pin test is a textual guard, which passes vacuously if the call is renamed (a known weakness).
- (b) Make `openPullRequest` itself derive the label from paths+diffs so callers cannot pass a
  literal. Strongest (drift becomes unrepresentable). Cost: changes a shared seam SPEC-050 froze as
  a pure refactor and touches `commit-on-approve.ts`'s wiring and tests; larger blast radius for T2.

**D3 — Should the lane's refusal become neutral instead?** (#2078's option b.) Recommend **no**:
#2078 already shipped option a for two producers, and a neutral refusal would weaken a gate whose
point is that ratification is a human act. Cost of "no": the third producer needs this fix too.

**Recorded selection: Option (no),** the lane's refusal does not become neutral, because that
would weaken a gate whose point is that ratification is a human act.
