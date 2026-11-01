---
id: SPEC-222
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the unattended merge actors (DR-061 native arm, SPEC-024 consequence-hybrid) live here
aspects: [auto-merge, merge-gate, governance, dr-acceptance, no-silent-gate, ready-to-merge, shipped-template]
depends_on: [DR-029, DR-061, DR-063, DR-086]  # DR-029 acceptance is a separate human act; DR-061 native auto-merge; DR-063 awaiting-approval; DR-086 stop classes
relates_to: [SPEC-024, SPEC-031, SPEC-034, DR-094, "#2019", "#1956", "#2014", "#1847", "#2124", "#1614", "#833"]
implements: none
implements_reason: >-
  Every change lands in existing machinery files (ready-to-merge.yml and its guard
  script, both shipped templates) that no spec owns; owning a shared, parity-managed
  workflow from a defect spec would freeze it for every other change to the merge gate.
affects: [.github/workflows/ready-to-merge.yml, .github/scripts/ai-review-guard.js, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-222: A change whose governing decision is still `proposed` cannot merge unattended

Triggered by: #2019 (auto-merge armed on #1956 while its governing DR-094 was `proposed`).
Design rests on DR-029 (acceptance is a separate human act), DR-061 (native auto-merge),
DR-063 (`awaiting-approval`), and DR-086 §2.2 (`approval-or-acceptance` stop class).

## In plain terms

A pull request can carry code **and** the decision record that authorises that code. If
the record still says `status: proposed`, the founder has not yet said yes. Today nothing
mechanical notices that: the merge gate (`ready-to-merge`) looks only at the AI review
label and `hold:*` labels. So a code change that is not yet permitted can read as "ready"
and, once auto-merge is armed by anyone, merge itself.

This spec makes the merge gate read the decision records **in the pull request's own diff**
and refuse to go green while any of them is not `accepted` and the pull request also
changes something other than docs. A pull request that only *proposes* a decision is not
affected - proposing is allowed to land.

## One-Sentence Scope

Make the required `ready-to-merge` check fail, with a named reason, while a pull request
that changes non-docs paths also adds or modifies a decision record whose `status:` is not
`accepted`, and keep `awaiting-approval` off such a pull request.

## Context - what the code does today (read from this worktree's base, not inferred)

1. **The two in-repo arm sites already withhold this PR shape.** `scripts/dispatch-issue.sh:1529`
   (DR-061 native `--auto`) runs only after `autonomy_may_merge` admits it, and
   `autonomy_stop_classes_for_paths` (`scripts/dispatch-issue.sh:465`) yields
   `approval-or-acceptance` for any path matching `DOCS_CORPUS_RE`
   (`scripts/lib/docs-corpus.sh`: `^(specs/|docs/|...)`), which `mayProceed`
   (`scripts/lib/autonomy.ts:148`) denies regardless of autonomy. `docs-lane.yml` refuses
   any changed `status:` line under `docs/decisions/` or `specs/` (#1847, #2124). Both guards
   were present on 2026-09-21 (`d0eb865a`, 2026-09-02; `fd032cbb`, 2026-07-17).
2. **So #1956 was armed by an actor outside those code paths.** #1956 touched
   `docs/decisions/DR-094.md` and `specs/minspec/SPEC-034-*` (`git show --stat f7a31d23`), so
   both in-repo arm sites would have refused it. The issue says `app/minspec-sdd` armed it.
   That App token is held by every session and drain process, so any of them can run
   `gh pr merge --auto` by hand, and so can a human in the GitHub UI. *Which* process armed
   it cannot be determined offline (unverified). **Conclusion: a gate placed on the arming
   step covers only the actors someone remembered to gate. The merge gate is the one point
   every merge path passes through** (native auto-merge, a plain human keystroke, a re-armed
   latch). The only way past it is a deliberate `--admin`.
3. **The instance merged before acceptance anyway.** `f7a31d23` (#1956) landed on `main` at
   2026-09-30T15:12:15Z with `status: proposed` in its own tree
   (`git show f7a31d23:docs/decisions/DR-094.md`). DR-094 was accepted about 11 hours later
   in `f4e6cbcf` (#2314, 2026-10-01T01:54:21Z, by the founder). The committer is `GitHub`, so
   whether that merge was an auto-merge or a human keystroke is not knowable from git
   (unverified). Either way, disarming the instance did not hold the class. That is the
   evidence that this needs a merge-side gate, not only an arm-side one.
4. **`ready-to-merge` is the single writer of a required status** (`.github/workflows/ready-to-merge.yml:3-16`).
   It goes green iff there is a verified `ai-review:pass`, no `ai-review:changes`, and no
   `hold:*`. It checks out the **trusted base** (self-forge defence). It also owns the
   `awaiting-approval` label sync (`ready-to-merge.yml:428`, DR-063 / SPEC-031 FR-9a).
5. **`ready-to-merge.yml` is a shipped template** (`packages/minspec/src/lib/template-registry.ts:2593`,
   body embedded in `ci-review-templates.ts`, byte-pinned by `ci-stack-portability`). Any
   change reaches adopters on refresh. Adopters configure their decisions directory
   (`.minspec/config.json` `decisionsDir`, here `docs/decisions`).
6. **DR status vocabulary on `main`:** 106 `accepted`, 0 `proposed`, 3 `superseded` (DR-107 to DR-110 are all `accepted` now)
   (`grep -h -m1 '^status:' docs/decisions/DR-*.md | sort | uniq -c`).

## Functional Requirements

- **FR-1 - Decision-pending predicate (pure).** A pure function `decisionPending(files, decisionsDir, readStatus)`
  returns the list of decision-record paths that hold the PR, and why. A path holds the PR iff **all**
  of these are true:
  - (a) it is a file directly under `decisionsDir` whose name matches `DR-<digits>.md`;
  - (b) the PR adds or modifies it (a deletion is out of scope, see Out of Scope);
  - (c) its `status:` at the **PR head commit** is not `accepted`.
  A status that is missing, unreadable, unparseable, or duplicated counts as **not accepted**
  (fail closed, invariant 2). The function returns the *reason* for each path (`proposed`,
  `superseded`, `missing`, `unreadable`, ...) so the gate can name it.
- **FR-2 - Code-bearing qualifier.** The hold applies only when the PR also changes at least
  one path **outside** the docs corpus (the same `DOCS_CORPUS_RE` single source of truth,
  `scripts/lib/docs-corpus.sh` / its `.ts` twin). A docs-only PR that proposes or edits a DR
  is **not** held by this gate. Those PRs are already human-merged (point 1 above), and
  proposing a decision is allowed to land as `proposed`. *See DQ-2.*
- **FR-3 - Merge gate.** `ready-to-merge` posts **FAILURE** when FR-1 returns a non-empty
  list under FR-2. The status description names the first holding DR and its status, for
  example `decision pending: DR-094 is proposed - accept it (DR-029) or split the code out`.
  The rule order is the existing gate order with this rule added. Any reason to fail wins,
  and this rule can never turn a red gate green.
- **FR-4 - Witness failure fails closed and visibly.** If the changed-file list or any
  holding candidate's head content cannot be read (for example an API error; the rule reads
  file content at the head SHA, not the `.patch`, so an omitted patch is not a gap), the gate posts FAILURE naming
  `decision status unreadable: <path>`. It must not be swallowed with `|| true` or an empty
  catch (invariant 2). The changed-file list read is paginated, and a truncated list is
  treated as unreadable.
- **FR-5 - `awaiting-approval` stays off.** Because FR-3 makes the gate red, the existing
  sync (`ready-to-merge.yml:428`) already clears `awaiting-approval`. This FR is a
  **test obligation**: a decision-pending PR must never carry `awaiting-approval`. *DQ-3
  asks whether to also add a distinct `awaiting-decision` label.*
- **FR-6 - Arming a held PR is harmless.** FR-3 is a required check, so an auto-merge latch
  armed by *any* actor cannot complete while it is red. No arm-site change is required for
  correctness. The dispatch arm site already withholds this shape (Context point 1), and
  that remains the second, independent witness for the in-repo actor.
- **FR-7 - Adopter portability.** The predicate reads `decisionsDir` from the **base**
  checkout's `.minspec/config.json`, defaulting to `docs/decisions` when the key is absent.
  It must not hardcode this repo's path. An adopter without a decisions directory has the
  rule as a no-op (no file can match (a)), never as a failure. The embedded template in
  `ci-review-templates.ts` is regenerated, not hand-edited.
- **FR-8 - Re-evaluation.** The rule is re-evaluated on every event `ready-to-merge`
  already listens to. In particular `synchronize` covers an acceptance commit pushed to the
  PR, or a branch update that pulls in an acceptance from `main`. So the gate turns green
  without a manual re-run once the head carries `status: accepted`.
- **FR-9 - Self-forge defence preserved.** The new logic runs from the base-pinned
  `ai-review-guard.js`. PR head content is read as **data** (API contents or blob at head
  SHA) and never executed or `require`d.

## Costly to Refactor

- The **predicate's input contract** (`files: {path, status: added|modified|removed|renamed}[]`,
  `readStatus(path) -> string | Error`) is exported from the shipped guard script. Adopters'
  refreshed copies depend on its shape, so changing it later means a template-version bump.

## Acceptance Criteria

- **AC-1 (FR-1, FR-3)** - A PR adding `packages/x.ts` and a fixture `docs/decisions/DR-NNN.md` with
  `status: proposed` gets `ready-to-merge` = failure, and the description names the fixture DR id and
  `proposed`.
- **AC-2 (FR-1)** - The same PR with `status: accepted` at head is not held by this rule.
  Other rules still apply.
- **AC-3 (FR-2)** - A docs-only PR adding a fixture `DR-NNN.md` `status: proposed` is not held by this
  rule.
- **AC-4 (FR-1)** - A code PR that modifies a DR whose head `status:` is missing, appears
  twice, or reads `Accepted ` (with a case or whitespace variant) is held, unless DQ-4
  admits normalisation. Each case is its own test.
- **AC-5 (FR-4)** - An injected failure of the files read, and separately of the content
  read, produces failure with the `unreadable` description. A test asserts there is no
  `|| true` and no empty `catch` on either path. That test is a mutation probe: deleting
  the failure branch must make it fail.
- **AC-6 (FR-5)** - On a decision-pending PR with a verified `ai-review:pass` and auto-merge
  unarmed, `awaiting-approval` is absent after the gate runs.
- **AC-7 (FR-7)** - With `decisionsDir: "decisions"` in base config, `decisions/DR-NNN.md`
  proposed + code is held and `docs/decisions/DR-NNN.md` is not. With the key absent,
  `docs/decisions` is used.
- **AC-8 (FR-8)** - The status flips from failure to success on a `synchronize` whose head
  changes only the DR's `status:` to `accepted`. This is tested at the predicate level with
  two head states.
- **AC-9 (FR-9)** - No new `require`, `import` or `eval` reaches a PR-head path. This
  extends the existing self-forge test.
- **AC-10 (FR-7)** - `ci-stack-portability` stays green, so the embedded template equals
  the working file.
- **AC-11 (regression for #1956)** - A fixture built from #1956's file list
  (`git show --stat f7a31d23`) with DR-094 at `status: proposed` is held. The test must be
  red on the base branch.

## Invariants (must not break)

- **Constitution 1 (offline):** No change to the extension's runtime. The gate runs in the
  adopter's own CI, which is the existing `ready-to-merge` surface, and adds no new
  outbound endpoint beyond the GitHub API calls that workflow already makes.
- **Constitution 2 (no silent gate):** Every witness read fails closed and visibly (FR-4).
  This rule is independent of the dispatch arm-site withhold, so neither depends on a single
  producer.
- **Constitution 3 (blast radius):** The change ships only through the existing
  `ready-to-merge.yml` template, to repos that opted in via `.minspec/`. It is a no-op where
  no decisions directory exists (FR-7).
- **`ready-to-merge` single writer:** No second workflow posts the `ready-to-merge` context
  (`ready-to-merge.yml:15`).
- **Monotonic strictness:** This rule can only add a failure. It never makes a red gate
  green and never removes `hold:*` or `ai-review:changes` handling.
- **DR-029:** Nothing in this change writes a DR `status:`. Acceptance remains a human act.

## Decisions needed (Clarify)

All 6 decisions are answered, not ratified: an agent session selected on 2026-10-25, for each, the option this document already recommended. No human chose them, and no delegation covers authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may overturn it.

- **DQ-1 - Where the hold binds.**
  **Recorded selection: Option a,** the spec's reason is that the required merge gate covers every actor, including ad-hoc auto-merge and a human keystroke on a misread review.
  - `a` **(rec)** In the required `ready-to-merge` merge gate (this spec as written). It
    covers every actor, including ad-hoc `gh pr merge --auto` and a human keystroke made on
    a misread review. **Cost:** a human who wants to merge such a PR must accept the DR
    first, or use `--admin`. It also touches machinery that ships to adopters, so the
    implementation PR needs a founder `--admin` merge (machinery hold).
  - `b` Only at the arm step (the issue's rec). **Cost:** both in-repo arm sites already
    withhold this shape (Context point 1), so this adds almost nothing. #1956 was armed
    outside them, and it merged before acceptance anyway (Context point 3).
  - `c` Both `a` and an explicit arm-site check. **Cost:** a duplicate predicate that can
    drift (the *dup predicates drift* lesson) for no coverage beyond `a`.
- **DQ-2 - Docs-only PRs.**
  **Recorded selection: Option a,** the spec's reason is that proposing a DR must be able to land.
  - `a` **(rec)** Exempt them (FR-2). Proposing a DR must be able to land. **Cost:** a
    docs-only PR that *relaxes a spec criterion* plus its proposed DR (a spec AC edit with
    no code) is not held by this gate. It still relies on the existing docs/** arm withhold,
    the docs-lane `status:` refusal, and the human keystroke.
  - `b` Hold any PR whose diff carries a non-accepted DR. **Cost:** every DR-proposal PR
    goes red and needs `--admin`, so `--admin` becomes routine and loses its meaning.
- **DQ-3 - A distinct label.**
  **Recorded selection: Option a,** the spec recommends no new label; the red status description is the signal.
  - `a` **(rec)** None. The red status description is the signal and `awaiting-approval`
    simply stays off. **Cost:** the "your turn" queue does not show these PRs. They are
    found by filtering on a red `ready-to-merge`.
  - `b` Add `awaiting-decision` (the issue's third option). **Cost:** a second label owner
    and a convention that can drift from the gate.
- **DQ-4 - Status matching.**
  **Recorded selection: Option a,** the spec recommends exact status: accepted matching, since a second accepted spelling may not be honoured by other readers.
  - `a` **(rec)** Exact `status: accepted` on the frontmatter line. Anything else holds.
    **Cost:** a hand-typed `Accepted` holds until it is fixed, which costs one edit.
  - `b` Case- and whitespace-insensitive matching. **Cost:** a second accepted spelling
    that other readers (the validator, INDEX) may not honour.
- **DQ-5 - DRs cited but not in the diff.** A code PR could implement a DR that is already
  on `main` as `proposed` without touching its file. FR-1 cannot see that.
  **Recorded selection: Option a,** the spec recommends out of scope for v1 with a follow-up, since scanning prose would make prose a gate input.
  - `a` **(rec)** Out of scope for v1. File it as a follow-up. **Cost:** the gap stays open.
    No DRs are `proposed` on this tree today, so it is small, but it is real.
  - `b` Also scan the PR title and body for `DR-NNN` and hold if the base tree's copy is not
    `accepted`. **Cost:** an incidental mention of a proposed DR holds an unrelated PR, and
    prose becomes a gate input.
- **DQ-6 - The review-side false claim.** The issue's second option makes ai-review flag a
  proposed DR as blocking, so a review summary cannot call it "human-accepted".
  **Recorded selection: Option a,** the spec's reason is that under DQ-1 (a) a prose misstatement can no longer move a merge, so it is filed separately.
  - `a` **(rec)** Out of scope here and filed separately. **Cost:** a review can still
    misstate DR status in prose, but under `a` of DQ-1 that misstatement can no longer move
    a merge.
  - `b` Fold it in. **Cost:** it widens this spec into the review prompt and the panel.

## Limitations, stated plainly

- `--admin` still bypasses the gate by design. This is a governance gate, not a security
  boundary against a repo admin.
- FR-1 reads the frontmatter `status:` only. DR-086-style dispositions written in a
  `## Status` section or an amendment heading (#2124's known gaps) are not read. A DR that
  carries `status: accepted` in frontmatter while an amendment is proposed passes.
- Renames are treated as modifications of the new path (see AC fixtures in Plan).

## Why no new DR

Placing the rule in `ready-to-merge` is a workflow edit that one revert undoes in well under
a day (the under-a-day ADR filter). It applies existing decisions (DR-029, DR-086 §2.2) and makes no
new architectural choice. If Clarify picks DQ-3 `b` (a new label vocabulary), revisit this.

## Out of Scope

- Changes to the arm sites (`dispatch-issue.sh`, `docs-lane.yml`). They already withhold.
- A DR *deletion* in a code PR. It is not an authorisation, so it is not held.
- The ai-review prompt and panel (DQ-6), and DR citations not in the diff (DQ-5). Both
  need tracking issues, which **this dispatch could not file** (it has no network
  permission). The human or dispatcher should file them, or they leak.
- Any change to who may accept a DR.

## Alternatives considered and rejected

- **Arm-step-only gate** (issue's rec): rejected as DQ-1 `b`. See Context points 2 and 3.
- **Read status from the merge ref instead of head:** rejected. A CONFLICTING PR has no merge
  ref, so the witness would be absent on exactly the PRs that most need a human. FR-8's
  `synchronize` re-evaluation handles acceptance that arrives from `main`.
- **A new separate required check:** rejected. It needs a ruleset edit that only the founder
  can make (the App lacks `admin:write`), and a ruleset PUT replaces the whole required set.
  Extending the existing required check needs neither.

## Test plan (for the Plan phase to place)

- Predicate unit tests in the guard's existing test file cover AC-1 to AC-4, AC-7, AC-8 and
  AC-11.
- Workflow-level fake-`github` tests cover AC-5, AC-6 and AC-9.
- AC-11 is shown red-then-green against the base branch, with a mutation of the FR-4
  failure branch.

## Traceability

- Issue: #2019. Instance: #1956 (`f7a31d23`). Acceptance: #2314 (`f4e6cbcf`).
- Related: #2014 (`allow_update_branch`), #1847 and #2124 (docs-lane status refusal), #1614
  (autonomy gate in arm sites), #833 (docs/** arm withhold).
