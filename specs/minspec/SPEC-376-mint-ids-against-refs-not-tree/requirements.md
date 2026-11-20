---
id: SPEC-376
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; a duplicate artifact id is that problem
aspects: [id-allocation, collision, git-refs, offline, tier-0, commit-gate, no-silent-gate]
depends_on: [SPEC-227]
relates_to: ["#1143", "#1107", "#1226", "#137", SPEC-122, SPEC-227, SPEC-297, DR-053, DR-074]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist; the overlap with SPEC-122 under
  "Decisions needed (Clarify)" is unanswered.
---

# SPEC-376: Mint DR and spec numbers against git refs, not the working tree (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#1143](https://github.com/AIClarityAU/minspec/issues/1143). Rests on, and does not
change, [DR-074](../../../docs/decisions/DR-074.md) (blast radius: the opt-in marker is `.minspec/`).
No new decision record: nothing here is hard to undo in a day.

## One-Sentence Scope

Make `nextAdrNumber` and `nextSpecId` take the highest number over the working tree **and every
local git ref** (so a stale checkout or a concurrent branch is seen), and add a commit-time check
that refuses a newly added `DR-NNN` / `SPEC-NNN` that another ref already carries at a different
path, all offline, degrading visibly and never blocking when no ref exists.

## Root cause (mechanism, not state)

*Symptom:* #1107 minted `DR-072`, already merged by #1104; found only as an add/add conflict.

*Mechanism (read at this checkout):*

- `nextAdrNumber` (`packages/minspec/src/lib/adr-manager.ts:103-120`) is `readdirSync(decisionsDir)`
  then max plus one. `nextSpecId` (`packages/minspec/src/lib/spec-manager.ts:212-225`) is the same
  over `collectSpecs(specsDir)`. Both read one working tree. That is correct only when the tree is
  the whole world; a checkout behind `origin/main`, or a second open branch, makes it wrong.
- *Missing gate:* nothing validates a minted id against any other ref at mint **or** commit time.
  `validateDrSequence` and `checkDeclaredDrIds` (`scripts/lib/dr-id-collision.ts`) see one tree.
  The cross-PR CI check (`scripts/check-dr-id-collision.ts`) exists but is advisory (not a
  required check, per CLAUDE.md), runs after the PR is open, and the editor path never consults it.

## Context - what is already specified (this spec must not duplicate it)

- **SPEC-227** (status `planning`) specifies an offline reader of claimed **spec** ids across the
  working tree, every worktree and every local and remote-tracking ref, and `nextSpecId` using it.
  Its reader module (`packages/shared/src/claimed-spec-ids.ts`) is not built.
- **SPEC-122** (status `specifying`, T4) specifies the same for DR and epic registers **plus** an
  atomic reservation store, work claims and a commit-time backstop (its FR-1, FR-2, FR-9).
  Nothing from it is built.
- **#1226 / `scripts/lib/dr-id-collision.ts`** already shipped the dev-time CI half for DRs.

#1143 therefore asks for a strict subset of SPEC-122 plus SPEC-227. This spec is the **small,
first-shippable slice** of that subset: refs-aware minting and the commit-time refusal, with no
reservation store, no work claims, no write inside `.git/`. See DQ-1 for whether it should exist
at all.

## Functional Requirements

- **FR-1 (taken set).** For the DR register the taken set is the union of the working tree's
  `<decisionsDir>/DR-NNN*.md` names and the same names under every ref in `refs/heads/` and
  `refs/remotes/`, read with `git ls-tree` / `git for-each-ref`. Keys are file names, not
  frontmatter (matching `check-dr-id-collision.ts`, which keys on file names for the same reason).
  The candidate is the highest number in the union plus one.
- **FR-2 (spec register reuses SPEC-227).** `nextSpecId` uses the SPEC-227 reader as its taken set
  (product scoping, `spec-manager.ts:203-217`, preserved). If the SPEC-227 reader is not yet
  built when this is planned, Plan builds it per SPEC-227 FR-1 to FR-6 rather than a second reader;
  the DR reader is that reader parameterised by register.
- **FR-3 (no network).** Minting runs only local git plumbing and filesystem reads. It never runs
  `git fetch`. The issue's one-liner includes `git fetch origin -q`; that is a network call and
  needs consent (constitution invariant 1), so it is **not** done implicitly. Instead the allocator
  reports the age of its remote view (SPEC-227 FR-6: the newest remote-tracking ref update) so a
  stale view is stated, not hidden. An explicit, user-invoked "refresh remote view" action may
  fetch; it is never a side effect of creating a record.
- **FR-4 (visible degradation, never failure).** No git, not a repository, a shallow clone, or no
  remote-tracking refs: fall back to the working tree alone, as today, and say what was not read
  (SPEC-227 FR-5). Minting never throws and never blocks on a missing ref source.
- **FR-5 (blast radius).** Ref reading happens only in a repo carrying `.minspec/` at its root
  (DR-074); elsewhere the extension behaves exactly as before.
- **FR-6 (commit-time refusal).** The shipped pre-commit gate refuses a commit that **adds** a
  `DR-NNN` or `SPEC-NNN` (number absent from the commit's parent) when any other ref already
  carries that number at a **different path**. The refusal names the holder ref and path and the
  next free number per FR-1/FR-2. The same number at the same path on another ref is the same
  artifact, not a collision; a rename of the commit's own artifact is not a collision. Bypass:
  `MINSPEC_ID_GATE_OFF=1`, matching `RCDD_GATE_OFF` / `SECRET_GATE_OFF`.
- **FR-7 (fail closed, visibly).** If the gate cannot enumerate refs in a repo that has them, it
  fails the commit and names what it could not read. It never passes silently (constitution
  invariant 2). A repo with no refs other than the current branch passes, and says so.
- **FR-8 (one definition of taken).** The mint and the gate share one implementation, or two held
  together by a parity test. Duplicated predicates drift.
- **FR-9 (existing gates stay).** The single-tree validator rules, the cross-PR CI check and
  SPEC-297's publish-time guard are unchanged; they are the independent witness for what local
  refs cannot see (a second clone, a branch never fetched).
- **FR-10 (declared-id mismatch).** A new DR whose frontmatter `id:` disagrees with its file name
  is already caught by `checkDeclaredDrIds`; the gate relies on that pairing and does not re-key on
  frontmatter.

## Acceptance Criteria

- **AC-1.** Fixture: tree at `DR-071`, another local branch carries `DR-072`. `nextAdrNumber`
  returns 73, not 72. (Distinguishing test for #1107's concurrent-branch case.)
- **AC-2.** Fixture: remote-tracking `origin/main` carries `DR-072`, the working tree is behind.
  Returns 73. (The stale-checkout case.)
- **AC-3.** No git repository: returns tree max plus one, and reports the unread sources; no throw.
- **AC-4.** No `git fetch` is executed by minting (assert on the spawned command list).
- **AC-5.** Commit adding `DR-072.md` while another ref holds `DR-072-other.md`: refused, naming
  the ref and path and `DR-073`. Same path on another ref: allowed. Rename of own artifact: allowed.
- **AC-6.** Unreadable ref enumeration in a repo that has refs: non-zero exit, names the failure.
- **AC-7.** The same fixtures run against the gate and the mint, asserting the same taken set.
- **AC-8.** In a repo without `.minspec/`, no git command is spawned by either path.

## Invariants (must not break)

- **INV-1 (offline).** No network call without consent (constitution 1); see FR-3.
- **INV-2 (no silent gate).** FR-7; no `|| true` on the gate's signal (constitution 2).
- **INV-3 (blast radius).** FR-5 (constitution 3).
- **INV-4 (only skips).** Seeing more refs can only raise the candidate; it never hands out a number
  the tree-only allocator would have refused.

## Decisions needed (Clarify)

### DQ-1 - Build this slice, or fold #1143 into SPEC-122 and SPEC-227?

- **A - build this slice (rec).** Ships the refs-aware mint and commit refusal now; closes the
  #1143 failure without the reservation store. *Cost:* two overlapping specs; SPEC-122's FR-1 and
  FR-9 become partly satisfied by this one and must be trimmed on approval, or the three drift.
- **B - fold in; close #1143 against SPEC-122.** One spec, one design. *Cost:* SPEC-122 is T4 and
  unbuilt, with its own unanswered clarifications (including writing inside `.git/`), so the
  #1107 defect stays live for an unknown time.

### DQ-2 - Does the gate block or warn?

- **A - block with the named bypass (rec).** *Cost:* a stale local branch holding a number makes a
  session skip it, leaving visible holes in the register.
- **B - warn only.** *Cost:* an agent that does not read the warning commits the duplicate; this is
  the prose-rule shape the issue is about.

### DQ-3 - Is a fetch ever offered?

- **A - never implicit; staleness is only reported (rec).** *Cost:* a never-fetched checkout still
  mints a stale number; the CI check and FR-6 catch it later, not at mint.
- **B - offer a one-time consented fetch in the create command.** *Cost:* a network prompt on a
  routine action; needs its own consent record.

## Out of Scope

Reservation store, work claims, epic register, dispatcher changes (SPEC-122, SPEC-227, SPEC-297);
renumbering tools; making `dr-id-collision` a required CI check.

## Traceability

Issue [#1143](https://github.com/AIClarityAU/minspec/issues/1143); incident #1107 (DR-072 clash with
#1104); precedent #1226 (DR-077 claimed twice); validator-asymmetry class #137; overlaps SPEC-122,
SPEC-227.
