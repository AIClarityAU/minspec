---
id: SPEC-264
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval voided by recording progress is a false "needs re-approval" signpost
aspects: [approval, hash, flat-layout, single-file-spec, implement-phase, shipped-guidance, spec-gate, tier-0]
depends_on: [SPEC-130]
relates_to: [SPEC-130, DR-102, DR-034, DR-012, DR-069, SPEC-022, SPEC-262, "#2711", "#224", "#225"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns is decided at Plan, after Decisions D1-D3
  are answered; every candidate file is listed under Context.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-264: Recording progress in an approved single-file spec does not void its approval

> **SPECIFICATION ONLY.** Written for issue
> [#2711](https://github.com/AIClarityAU/minspec/issues/2711) (ticking a task checkbox
> inside an approved single-file spec stales the approval). Nothing is built until a human
> approves this spec through the normal spec-approval gate.

**Most of #2711 is already specified.** The tick itself is the defect
[SPEC-130](../SPEC-130-checkbox-state-hash-exit/requirements.md) (checkbox state leaves the
approval hash) fixes, resting on [DR-102](../../../docs/decisions/DR-102.md) (accepted).
SPEC-130 is approved (delegated, commit `e0e50ed9`, #3033) and **not built**:
`canonicalizeSpec` still has no checkbox step (`packages/shared/src/canonical.ts:89-123`).
SPEC-130 is not edited here, because editing its body would void that approval.

This spec covers only what SPEC-130 leaves open for the single-file layout: the
**non-tick** writes that MinSpec's own shipped commands make to an approved single-file
spec, and a witness that the voip-sms-inbox shape is fixed end to end once SPEC-130 lands.

## One-Sentence Scope

Make every write that MinSpec's shipped Plan, Tasks and Implement guidance tells an agent
to make, after approval, either leave an approved single-file spec's hash unchanged or land
outside the approved file, and make the gate name the cause when such a spec does go stale.

## Context - answers to the issue's "to establish first" (read at `804a899d`, not inferred)

- **The canonical form ignores no checkbox in any layout.** `canonicalizeSpec`
  (`packages/shared/src/canonical.ts:89-123`) normalizes line endings, drops `status` and
  `phases`, collapses relative links and trims whitespace. It has no checkbox step, and it
  is a pure string transform with no notion of layout. The split layout avoids the defect
  only because its `tasks.md` is usually not the approved file; when it is approved, a tick
  stales it too (SPEC-130's measurement: 1 approved `tasks.md` sidecar in this repo).
- **The single-file layout is supported, and it is the default.**
  `SpecsLayout = 'flat' | 'spec-kit'` (`packages/minspec/src/lib/config.ts:35`), default
  `specsLayout: 'flat'` (`config.ts:155`); the flat shape is `<specsDir>/SPEC-NNN-slug.md`
  (`packages/minspec/src/lib/spec-layout.ts:14-15`), which is voip-sms-inbox's
  `specs/SPEC-004-*.md`. `scaffold.ts:224-225` states that single-file specs "embed their
  Tasks phase in-file". It is not a local variant of that project.
- **Approval lands before the build-band phases.** The command is "Approve a spec for
  implementation" (`packages/minspec/src/commands/approve.ts:219`). `phasesForApproval`
  marks `specify` and `clarify` done and sets the first pending of `plan` / `tasks` /
  `implement` to in-progress (`packages/minspec/src/lib/lifecycle.ts:199-210`). So in the
  single-file layout, Plan, Tasks and Implement content is commonly written into a file
  that is already approved.
- **MinSpec's own guidance tells the agent to write into that file.**
  - Plan: "Update the Plan section of the active spec"
    (`packages/minspec/src/lib/slash-commands.ts:154`).
  - Tasks: "Break the plan into ... checkboxes"; "MinSpec tracks progress from these
    checkboxes" (`slash-commands.ts:160-161`).
  - Implement: "Pick the next unchecked task in the active spec's Tasks section. Implement
    it, update the checkbox, and add a brief implementation note to the Implement section"
    (`slash-commands.ts:178`; same text in `.claude/commands/minspec-implement.md:10`).
  - The scaffolded example spec has an `## Implement` section reading "Track implementation
    notes here", inviting PR links, decisions and gotchas
    (`packages/minspec/src/commands/example.ts:211-220`).
  - Checklist: "Add or update a `## Checklist` section in the active spec ... Check off
    ones the spec already satisfies" (`slash-commands.ts:186`).
- **What SPEC-130 fixes and what it leaves.** SPEC-130 FR-1 makes every `[x]`/`[X]` to
  `[ ]` change on a task-list line in the body hash-neutral, under any heading. That covers
  the tick in voip-sms-inbox PR 143 (`- [ ] **T-03 Migration 0004.**`). It does **not**
  cover an implementation note, a Plan section, a new task line, or a `[~]` marker; each of
  those is a body edit and stales the approval, which is correct for SPEC-130 and is the
  gap here.
- **Adopter reach.** An adopter gets SPEC-130 and this change only after installing the new
  extension and running *Refresh Harness Files* (the Python twin ships through
  `ci-review-templates.ts`). Not measured in any adopter repository.

## Functional Requirements

- **FR-1 (the voip-sms-inbox shape, end to end).** A test MUST build a flat single-file
  spec with frontmatter, a requirements body and a `## Tasks` section holding
  `- [ ] **T-03 Migration 0004.**`, approve it through the same code path the extension
  uses, tick that line, and assert the spec resolves `approved` in the extension
  **and** `scripts/hooks/spec-gate.py` does not report it stale. This test is written in
  this spec's implementing change and goes green only once SPEC-130 is built; it MUST NOT
  be marked skipped or expected-fail to land early (constitution invariant 2).

- **FR-2 (no shipped instruction voids approval by itself).** After this change, no text
  MinSpec ships (slash-command bodies in `slash-commands.ts`, the generated
  `.claude/commands/minspec-*.md`, the example spec in `example.ts`, and the authoring
  guidance SPEC-130 FR-9 adds) may instruct an agent to make a non-tick edit to an
  **approved** single-file spec as a routine phase step. Where the instruction moves to is
  D1 and D2.

- **FR-3 (the gate names the cause).** When an approved single-file spec reads `stale`,
  and every changed line since approval sits under a heading of the build band (`## Plan`,
  `## Tasks`, `## Implement`, `## Checklist`), the stale message in the extension and in
  `spec-gate.py` MUST say so in one added sentence naming the heading(s) and pointing to
  where that content belongs under D1/D2. The verdict stays `stale`: this changes the
  message, never the hash or the verdict. Severity of the approval-time signal is D3.

- **FR-4 (the cause is computed, not guessed).** FR-3's "every changed line" MUST be
  computed against the approved body baseline the review diff already uses
  (`getSpecBodyOnly`, `canonical.ts:144`), not inferred from heading presence alone. If the
  baseline is unavailable the message MUST say the cause is unknown rather than name a
  heading.

- **FR-5 (split layout unchanged).** Nothing in this change alters behaviour for a spec in
  the `spec-kit` layout or the split `type: requirements|design|tasks` convention.

- **FR-6 (wording discipline).** No new text may call the hash, the gate or a tick
  "verified". A tick is a claim made by whoever ticked it (SPEC-130 FR-10, DR-087).

## Acceptance Criteria

- [ ] (FR-1) With SPEC-130 built, the voip-shape test passes in both the extension path and
      `spec-gate.py`; with SPEC-130's step removed from either twin, it fails.
- [ ] (FR-1) Editing the text of T-03 (not its tick) in the same fixture makes the spec
      `stale` in both.
- [ ] (FR-2) A test asserts no shipped command body or example-spec section contains an
      instruction to write notes, plans or tasks into an approved single-file spec, and fails
      on the current `slash-commands.ts:178` text.
- [ ] (FR-3) An approved single-file fixture with an added `## Implement` note reads `stale`
      with the build-band sentence naming `## Implement`; a fixture with an edited
      requirement reads `stale` without it.
- [ ] (FR-4) With the review baseline removed, the message says the cause is unknown.
- [ ] (FR-5) The existing split-layout and spec-kit test suites pass unchanged.

## Invariants (must not break)

- **INV-1 (offline; constitution invariant 1).** Everything added is local string work; no
  network call.
- **INV-2 (no silent gate; constitution invariant 2).** No edit to an approved file becomes
  invisible to the hash beyond what SPEC-130 already decides. FR-3 adds text to a failing
  verdict and never turns `stale` into a pass. FR-1 fails rather than skips.
- **INV-3 (blast radius; constitution invariant 3).** Changed guidance reaches another
  repository only through *Refresh Harness Files* in a repository with `.minspec/`.
- **INV-4 (twin parity; SPEC-022).** If FR-3 is implemented in both the extension and
  `spec-gate.py`, both compute the same heading set from the same input.
- **INV-5 (SPEC-130 untouched).** This change neither edits SPEC-130 nor alters the
  canonical form.

## Decisions needed (Clarify)

### D1 - Where does an Implement-phase note go when the spec is an approved single file?

- **Option A - the commit message and pull request body (rec).** The implement command and
  example spec stop asking for an in-file note; the note travels with the change it
  describes, which is where a reviewer reads it. **Cost: the spec file no longer carries
  its own build log, so someone reading the spec alone sees ticks but not why.**
- **Option B - a non-hashed sidecar** (for example `.minspec/progress/<spec>.md`). Cost: a
  new file type to scaffold, ship and keep in sync, and a reader must know to look there.
- **Option C - convert the spec to the split layout on the first post-approval note.**
  Cost: a layout migration moves the approved file, and the approval sidecar is keyed by
  path, so this needs the re-stamp machinery SPEC-070 (ownership leaves the hash) builds.

### D2 - What about Plan and Tasks content written after approval?

- **Option A - guidance says: in the single-file layout, write Plan and Tasks before
  approving; after approval, changing them is a re-approval by design (rec).** Plan and
  task text are part of what the human should sign. **Cost: in the default layout, the
  human approves later in the cycle, or re-approves once per Plan/Tasks edit.**
- **Option B - Plan and Tasks after approval go to sibling files** (the split layout).
  Cost: same as D1 Option C.
- **Option C - leave the guidance as is; FR-3's message is the only change.** Cost: every
  post-approval Plan or Tasks edit keeps voiding the approval, which is the rubber-stamp
  re-approval #2711 is about.

### D3 - Should approving a single-file spec say anything up front?

- **Option A - no; FR-3's stale message is enough (rec).** Cost: the author learns the rule
  after the first stale, not before.
- **Option B - a one-time non-modal notice on the first approval of a single-file spec,
  stating which later edits will need re-approval.** Cost: one more one-time prompt, and
  its wording becomes managed prose to keep true.

## Out of Scope

- The tick itself, the checkbox grammar, migration of existing approvals: SPEC-130.
- Markers other than ticked/unticked (`[~]`): SPEC-130 keeps them hashed; not reopened.
- voip-sms-inbox's own migration-numbering check that counts unticked tasks as open
  claims. It is that project's test; it works as intended once a tick no longer stales.
- Where progress lives for a split-layout spec with no `tasks.md`: #225.
- SPEC-262 (signpost never says "clear" while work remains): related flat-layout signpost
  work, separate.

## Why no decision record

No choice here is made yet: D1-D3 are open. The irreversible part of #2711, the hash change,
is already recorded in DR-102. If D1 or D2 lands on an option that moves files or adds a
sidecar type (D1 B/C, D2 B), the Plan phase writes a decision record for it.

## Follow-ups (tracked)

- Build SPEC-130 (the tick fix #2711 needs first): SPEC-130, #224.

## Traceability

- **Issue:** [#2711](https://github.com/AIClarityAU/minspec/issues/2711).
- **Depends on:** [SPEC-130](../SPEC-130-checkbox-state-hash-exit/requirements.md) and
  [DR-102](../../../docs/decisions/DR-102.md).
- **Builds on:** DR-034 / SPEC-022 (approval and the canonical form), DR-012 (the spec gate),
  DR-069 (status derived from approval and phases).
- **Id note:** `SPEC-264` is one above the highest id on any local or remote-tracking ref
  this checkout sees (263, on three agent branches, not on `main`). Open pull requests were not readable
  offline; renumber if it collides.
