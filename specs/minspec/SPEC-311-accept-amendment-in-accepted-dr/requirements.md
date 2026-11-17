---
id: SPEC-311
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a human act needs a witness the agent cannot forge
aspects: [approval, dr-acceptance, extension-command, no-silent-gate]
relates_to: [SPEC-251, SPEC-290, SPEC-041, DR-065, DR-056, DR-062, "#3017", "#3016", "#2861", "#2992", "#2628"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-311: One step to accept an amendment inside an already-accepted DR

Issue: #3017 (one-step extension act to accept an amendment inside an already-accepted DR). Triggered by #3016 (amendment acceptance provenance path).

## In plain terms

The #3016 provenance path accepts an amendment written into an *already-accepted* DR when the
DR's acceptance record (`.minspec/approvals/<DR path>.json`) is re-written in the same change
(SPEC-290). The extension has no single act that writes that record for an accepted DR:

- **MinSpec: Accept ADR** hides accepted DRs from its pick and, when invoked on an accepted
  node, shows "already accepted" and writes nothing (`acceptAdrCommand`,
  `packages/minspec/src/commands/adr.ts:369`).
- **Set Status -> accepted** on an accepted DR returns early because the value is unchanged
  (`adr.ts` `setAdrStatusCommand`, `picked.value === resolved.status`).

So today the founder must Set Status -> `proposed`, then Accept ADR. That demotes the DR for a
moment, and the intermediate `proposed` state can be committed by mistake. With DR-065
amendments queued (#2861, #2992, #2628) this will be done repeatedly.

## Functional requirements

- **FR-1 Re-accept entry point.** The extension offers one act that, for a DR whose status is
  already `accepted`, re-writes its acceptance record over the DR's current canonical hash.
  The DR's `status` is never changed, at any point (no transient `proposed`).
- **FR-2 Only when needed.** The act applies only when the DR's current canonical hash differs
  from the hash in its existing record (or the record is absent). If the hash already matches,
  it writes nothing and says so ("no unaccepted amendment").
- **FR-3 Same identity gate.** It runs the same approver-identity gate as a status acceptance
  (`assertHumanApprover` on the git email, SPEC-041 Slice 1 / DR-056 / DR-062) BEFORE any write.
  A denied identity leaves DR and record bytes untouched.
- **FR-4 Same record.** It writes the same `ApprovalRecord` shape through the same `writeRecord`
  path, with `approvedBy` = the verified approver and a fresh `approvedAt`, so the review-side
  witness (`scripts/approval-provenance.py`) needs no change.
- **FR-5 Same commit-on-approve.** It commits the DR, the record, and the regenerated register
  INDEX in one pathspec-safe commit, honouring the same commit-on-approve setting as Accept ADR
  (SPEC-022 FR-1).
- **FR-6 Shared preconditions.** Frontmatter and Rule 16 pre-checks that apply to a status
  acceptance (#3106 unprepared amendment targets) apply here unchanged.
- **FR-7 Discoverable.** The command appears in the Command Palette and the DR tree context
  menu only for accepted DRs with an unaccepted amendment (FR-2 predicate), and its pick lists
  only such DRs, with a clear empty message otherwise.
- **FR-8 No agent path.** No agent-reachable surface (script, CI step, hook) invokes it; it is
  an interactive human act only.

## Acceptance criteria

1. Given an accepted DR edited after acceptance, the act writes a record whose `specHash` equals
   the DR's canonical hash, status stays `accepted`, and one commit holds DR + record + INDEX.
2. Given an accepted DR whose hash matches its record, the act writes nothing and shows an
   informational message.
3. Given a denied approver identity, no file changes.
4. `git log` of the flow never contains a commit with the DR at `proposed`.
5. Accept ADR on a `proposed` DR and Set Status behave exactly as before (regression).
6. The record written verifies under the #3016 amendment-acceptance path in the review witness.

## Invariants the change must not break

- Offline: no network call (constitution invariant 1).
- No silent gate: a failed write or denied identity is surfaced visibly, never swallowed
  (invariant 2).
- Blast radius: acts only in a repo with `.minspec/` (invariant 3).
- Approver identity cannot be minted by an agent (SPEC-041 / DR-056).

## Non-goals

- Changing what the review witness verifies (SPEC-290).
- Amending specs (non-DR approvables).
- Detecting *which* edits are legitimate amendments; the human reads the diff.

## Decisions needed (Clarify)

Recorded selections: each of the 2 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

1. **Surface.** (rec) **A new "Accept Amendment" command**, because the name states the act and
   Accept ADR keeps its simple contract; cost: one more command and menu entry to maintain.
   Alternative: let **Accept ADR re-accept** when the hash drifted; cost: one command doing two
   acts, so a click meant as a first acceptance cannot be told from a re-acceptance by its label.
   Alternative: keep the two-step and document it; cost: two clicks per amendment and a
   committable intermediate `proposed` state.

   **Recorded selection: the recommended option,** a new "Accept Amendment" command. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
2. **Confirmation.** (rec) Show a non-modal toast over the visible diff-vs-record before writing
   (HITL approval UX); cost: one extra click. Alternative: write immediately; cost: an
   accidental click accepts an unread amendment.

   **Recorded selection: the recommended option,** a non-modal toast over the visible diff-vs-record before writing. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
