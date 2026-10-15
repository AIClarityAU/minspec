---
id: SPEC-137
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-003  # SDD Core Methodology - the keystone spec's own inventory must be correct
relates_to: [SPEC-001, SPEC-007, SPEC-022, "#441", "#438", "#439", "#472"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137 — Core SDD spec shards share one id (close out #441)

Issue: [#441](https://github.com/AIClarityAU/minspec/issues/441). Parent finding: #438 (the same defect on SPEC-007). Gate: #439.

## One-Sentence Scope

Finish collapsing the core SDD spec's `requirements.md` / `design.md` / `tasks.md` into one spec (`SPEC-001`), so the shard-id guard no longer grandfathers `specs/minspec` and no stale `SPEC-002` / `SPEC-003` reference points at a phantom.

## Observed state (verified on this branch's tree, not inferred)

- `specs/minspec/requirements.md`, `design.md` and `tasks.md` **all already carry `id: SPEC-001`** (frontmatter line 3 of each). The issue's table (SPEC-001/002/003) is out of date: the three ids were set to `SPEC-001` by commit `b3b1f0d3` (#472), `git log -S"id: SPEC-001"` on `design.md` and `tasks.md`.
- The three approval records `.minspec/approvals/specs/minspec/{requirements,design,tasks}.md.json` are keyed by file path (`specPath`), one record per shard. They are not keyed by id, so the id change needs no merge of records.
- The CI guard `INV-SHARD-ID` (`packages/minspec/tests/invariants.test.ts`, ~line 1010) still holds `KNOWN_MISNUMBERED = new Set(['specs/minspec'])`, with a comment saying to remove it when #441 lands. Its comment still describes divergent ids SPEC-001/002/003, which is no longer true.
- Not yet checked, and part of FR-2: whether prose or tests elsewhere still use `SPEC-002` / `SPEC-003` to mean the core design/tasks shards. A grep shows many hits in `packages/minspec/tests/*.test.ts`, `specs/minspec/design.md`, `DR-013.md`, `CLAUDE.md:236` and others; most may be fixture ids or other specs and are unclassified.

## Functional Requirements

- **FR-1 — Resolve the open question as one spec.** The three files are shards of ONE spec, `SPEC-001` (`type:` requirements/design/tasks, shared `epic: EPIC-003`). No renumbering to a new id.
- **FR-2 — Audit remaining `SPEC-002` / `SPEC-003` references.** Classify every hit (code, tests, docs, DRs, approvals) as: (a) meant the core design/tasks shard → repoint to `SPEC-001`; (b) a fixture or example id, unrelated → leave; (c) historical record (e.g. the dated CLAUDE.md evidence note) → leave, since rewriting history is wrong. The classification is recorded in the PR body.
- **FR-3 — Remove the grandfather entry.** Delete `KNOWN_MISNUMBERED` and its `specs/minspec` entry from `INV-SHARD-ID`; the guard then covers every directory. The guard must still fail on a fresh divergent-id fixture (a negative control is kept or added).
- **FR-4 — No approval churn beyond what the tree requires.** Approval records stay per-file. If any record is stale against its file, that is reported, not silently re-minted; re-approval is a human act.
- **FR-5 — Inventory correctness.** After the change `listSpecs` returns exactly one spec for `specs/minspec` root files, and no `SPEC-002` / `SPEC-003` entry exists from that directory.

## Acceptance Criteria

- **AC-1:** `npm test` passes with `KNOWN_MISNUMBERED` removed (FR-3).
- **AC-2:** A test builds a temp spec dir with divergent shard ids and asserts the guard reports it (negative control).
- **AC-3:** A `listSpecs` test (or existing one extended) over the real `specs/minspec` root asserts a single `SPEC-001` and no `SPEC-002` / `SPEC-003` from that dir.
- **AC-4:** The PR body lists every `SPEC-002` / `SPEC-003` hit with its (a)/(b)/(c) class.
- **AC-5:** `npm run validate` passes.

## Invariants that must not break

- Offline, Tier 0: no network calls (constitution invariant 1).
- No silent gate: removing the allowlist makes the guard stricter, never quieter (invariant 2).
- Blast radius: only this repo's own corpus and tests change; nothing shipped to adopters changes (invariant 3).
- Approved artifacts are not edited without re-approval; this spec edits no body of SPEC-001 unless FR-2 case (a) requires it, and that is flagged for a human re-approve.

## Decisions needed (Clarify)

1. **Is the work already done enough to close #441 now?** Options: (a) **(rec)** land FR-2/FR-3 as a small cleanup PR then close, costs one small PR for a guard that is purely a test-file edit; (b) close #441 as already fixed by #472 and leave the stale allowlist, costs a guard that silently exempts `specs/minspec` forever (an invariant-2 smell).
2. **FR-2 case (a) hits inside the approved `SPEC-001` body or `design.md`.** If any exist, fixing them voids that file's approval. Options: (a) **(rec)** fix and re-approve, costs one human approval read; (b) leave and note, costs a known-wrong cross-reference.
3. **Spec id.** `SPEC-137` was the next free id on this tree; open pull requests may have claimed it. Confirm against the collision gate before approval.

## Follow-ups (tracked)

None beyond #441.
