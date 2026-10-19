---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a derived register must be byte-stable so a dirty signpost always means something
aspects: [dr-index, determinism, no-silent-gate, tier-0, offline]
relates_to: ["#2063", "#220", "#191", "#2912", SPEC-095]
implements: none
implements_reason: >-
  Defect spec: every change lands in existing files (adr-manager.ts, dr-index-splice.ts and their
  tests) that no spec owns; owning them would freeze them for unrelated changes.
affects: [packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/dr-index-splice.ts, packages/minspec/tests/adr-manager.test.ts, packages/minspec/tests/dr-index-splice.test.ts, docs/decisions/INDEX.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: DR INDEX regeneration is byte-stable

Issue: #2063 (`docs/decisions/INDEX.md` drifts by whitespace, so a STOPLIST path is permanently dirty). No DR yet; see Decisions needed.

## Scope (one sentence)

Running the DR-index writer against a clean tree must leave `git status` clean, and a test must fail when the committed `docs/decisions/INDEX.md` differs from what the writer produces.

## Problem

The issue reports a whitespace-only diff on `docs/decisions/INDEX.md` in the shared checkout (two blank lines around DR-092's status line, `auto=000000000000` placeholder on that entry). Because `docs/decisions/` is a STOPLIST path no automatic path may commit it, so it stays dirty and fires `STOPLIST-DIRTY` every supervisor tick, training readers to ignore the alert.

### What is known (read at this worktree's HEAD)

- The per-entry renderer `renderDrEntry` emits heading, blank, meta line, blank, open marker, summary, close marker (`packages/minspec/src/lib/adr-manager.ts:1054-1062`). Entries are joined with exactly one blank line (`adr-manager.ts:1082`), and the block is wrapped in the `minspec:dr-index` markers (`adr-manager.ts:1109`).
- `regenerateDrIndex` writes the file (`adr-manager.ts:1150-1175`), and is triggered from `commands/adr.ts:306` and `extension.ts:557` (a watcher with a self-trigger guard).
- A second, independent writer exists: `spliceDrIndexEntry` (`dr-index-splice.ts:59`) re-joins entries from parsed lines and trims trailing blanks (`dr-index-splice.ts:48-52`). It is used by approval recovery (#2912).
- At this HEAD, DR-092's entry in `docs/decisions/INDEX.md` has the blank lines the renderer emits and a real hash, so the reported drift is not reproducible from this file alone. I believe, unverified, that the committed copy at `43d010bf` lacked those blanks and the working-tree writer added them.

### Root cause: NOT established

The issue says so explicitly and this spec does not guess. Candidate writers, by the evidence above: (a) `regenerateDrIndex` output differing from a copy produced by `spliceDrIndexEntry` or a hand edit, (b) the placeholder `auto=000000000000` indicating an entry created outside `renderDrEntry` (which always records a computed fingerprint, `adr-manager.ts:1031`), (c) an external formatter. Task 1 settles which, with a reproduction.

## Functional requirements

- **FR-1 (identify).** Reproduce the drift: from a clean checkout of the commit that showed it, run each candidate writer and record which one yields the two-blank-line diff. The writer is named in #2063 with a `file:line` citation. The root-cause statement names the mechanism and the gate that failed to catch it (RCDD, DR-003).
- **FR-2 (idempotent writer).** `regenerateDrIndex` and `spliceDrIndexEntry` must produce byte-identical entry text for the same DR. Running either against a tree whose INDEX was produced by the other changes nothing.
- **FR-3 (one-time normalisation).** The committed `docs/decisions/INDEX.md` is brought to the writer's canonical bytes in a single commit, by the writer, not by hand. No DR text, status, summary or link changes in that commit.
- **FR-4 (gate).** A test (and, if cheap, the existing pre-commit/CI INDEX gate at `.githooks/pre-commit:392`) regenerates the INDEX from the committed DR files and fails when it differs from the committed INDEX in whitespace as well as status. It fails closed and visibly (constitution invariant 2); a missing or erroring writer is a failure, not a pass.
- **FR-5 (placeholder).** An entry whose recorded `auto=` fingerprint is the all-zero placeholder is either impossible to produce or reported by the gate. The gate must say which DR.
- **FR-6 (alert).** After FR-3, a clean checkout with no DR change raises no `STOPLIST-DIRTY` from this file. (Observed outside this repo; verified manually once, not asserted in code.)

## Acceptance criteria

1. #2063 names the writer with `file:line`.
2. On a clean tree, regenerate then `git status --porcelain docs/decisions/INDEX.md` prints nothing, run twice.
3. Splice-then-regenerate and regenerate-then-splice both leave the file unchanged (property test over every DR id).
4. The new test is red against the pre-fix writer or INDEX and green after, both runs recorded.
5. `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants the change must not break

- INV-1 Offline, Tier 0: pure file work, no network (constitution 1).
- INV-2 No silent gate: no swallowed error, no `|| true` on the new check (constitution 2).
- INV-3 Curated summaries survive regeneration (#191): a hand-edited summary keeps its text and recorded fingerprint.
- INV-4 CRLF round-trip is preserved (SPEC-095; `dr-index-splice.ts` keeps the base's line endings).
- INV-5 Content outside the `minspec:dr-index` markers is never touched.
- INV-6 `docs/decisions/` stays a STOPLIST path; nothing here makes it auto-committable.

## Decisions needed (Clarify)

- **DQ-1 Canonical direction.** The committed form and the writer disagree; which wins?
  - (a) **(rec)** The writer's form (blank lines around meta). Cost: one INDEX-wide normalising commit that touches every entry that differs, so a large diff to review for zero content change.
  - (b) The committed form. Cost: changes `renderDrEntry` output for every adopter repo with an existing INDEX, so their next regen churns once.
- **DQ-2 Gate placement.** (a) **(rec)** A vitest test only; cannot be bypassed by hook-off env vars, but runs only in CI/local test. (b) Also extend the pre-commit INDEX gate; catches earlier but adds latency and a second bypass (`DR_INDEX_GATE_OFF`).
- **DQ-3 DR needed?** Choosing DQ-1(b) changes shipped output for adopters and is arguably not undoable in a day, so it warrants a DR; DQ-1(a) does not. Decide after DQ-1.
