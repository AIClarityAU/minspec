---
id: SPEC-272
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a validator warning that stays on every run teaches readers to skip the validator
aspects: [validator, warning-triage, status-annotation, implement-evidence, no-silent-gate]
depends_on: []
relates_to: ["#2621", "#2255", "#1955", "#1912", "#1751", "SPEC-004", "SPEC-011", "SPEC-015", "SPEC-095", "SPEC-038"]
implements: none
implements_reason: >-
  Specify phase only. The work edits four existing specs' own files plus (maybe) a validator
  rule; which of those this spec owns is decided at Plan, after Decisions D1-D2.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-272: Triage the four new `npm run validate` warnings, per spec

Issue: #2621 (four specs gain new non-blocking validate warnings after the implement-evidence and status-line gates landed).

## Context

Two machinery fixes merged 2026-10-09 tightened validation: the implement-evidence check (#2255; `validateImplementEvidence`, wired as Rule 22 in `scripts/validate-frontmatter.ts`) and the status-line gate (#1955/#1912; `validateStatusAnnotation`, Rule 23). The issue asked that the list be re-measured on main first. **Re-measured** on `ba6c71a8` (`npm run validate`, exit 0): the list is **correct, four warnings**:

| Spec | Rule | Message (verbatim) |
|---|---|---|
| SPEC-095 | `implement-evidence` | "Spec claims phases.implement: in-progress but declared implements: path(s) do not exist on disk: packages/minspec/tests/text-io-inventory.test.ts." |
| SPEC-004 | `status-annotation` | "The `status:` frontmatter line carries an inline `#` comment." |
| SPEC-011 | `status-annotation` | same |
| SPEC-015 | `status-annotation` | same |

Both rules ship at `warn` (FR-7 ratchet, `scripts/validate-frontmatter.ts` Rule 22 and Rule 23 comments), so none blocks. The issue's own instruction governs: each warning is either real drift in the spec or a rule too strict for a legitimate state; decide per spec, no bulk waiver.

## Findings (verdict per spec, from the code, not from the warning text)

- **SPEC-004, SPEC-011, SPEC-015 — real drift; the rule is right.** Each has `status: implementing  # <rationale>` on the status line. `validateStatusAnnotation` (`packages/minspec/src/lib/spec-validator.ts:913`) flags a top-level `status:` line with an unquoted inline `#`; the reason is that the status writers rebuild the whole line from the value alone (`/^status[ \t]*:[ \t]*.*$/m`), so the rationale is destroyed on the next status write. This is a real hazard, not a false positive: the comment is lost on `implementing -> done`. The rationale in each is a build-evidence note ("harness built + run (n=120...)", "built: epic-backfill.ts (478 lines...) + 40 tests pass", "built: lifecycle status lanes shipped ... 98 tests pass") — exactly the kind of claim that goes stale.
- **SPEC-095 — real drift, but a legitimate transient state; the rule's behaviour is intended.** `phases.implement: in-progress`, and `packages/minspec/tests/text-io-inventory.test.ts` (FR-10) is task 6.5 in its `tasks.md:151`, unchecked. `text-io.ts` and `text-round-trip.test.ts` exist. The rule (Rule 22, #1751) deliberately requires every declared `implements:` path to exist while implement is `in-progress`/`done`; the file is genuinely unbuilt. The warning is therefore *true*, and the right fix is to build task 6.5 (a build item, outside this spec), not to silence it. Whether the warning may sit there until then is Decision D1.

## Functional requirements

- **FR-1 — Each annotated status line is cleaned.** For SPEC-004, SPEC-011, SPEC-015 the `status:` line is rewritten to carry its value only (`status: implementing`). The inline rationale moves into the spec body as prose (a short "Status note" under the H1 or an existing status section), and any claim in it is re-verified against code before being kept (Evidence Discipline, CLAUDE.md), not copied across.
- **FR-2 — No orphan left behind.** After FR-1 the three specs also produce no `status.orphan-comment` or `frontmatter.prose-line` finding (`spec-validator.ts:845`, `:949`); moving the note must land in the body, not in a frontmatter comment line or `>` line (the #1955 hole).
- **FR-3 — Approval is not staled.** Before editing, confirm for each of the three specs whether the status-line edit changes the canonical approval hash (`specHash()`); record the computed before/after value, not an inference. If a hash changes, the spec is re-approved through the normal gate on its own PR (never a borrowed approval).
- **FR-4 — SPEC-095 disposition is explicit and tracked.** SPEC-095's warning is resolved per Decision D1, and the chosen path is recorded on SPEC-095's PR or issue so the warning has an owner and an exit condition.
- **FR-5 — No rule is loosened by this spec's default.** The validator rules are left unchanged unless a spec is shown to be a *false positive*; none of the four is (Findings). If D2 selects a rule change, it carries its own failing-first test.
- **FR-6 — Post-condition measured.** After the fixes, `npm run validate` on the merged tree reports no `status-annotation` finding for any spec and either no `implement-evidence` finding (D1 option A/B) or exactly the one accepted for SPEC-095 (D1 option C), with the count stated in the PR.

## Acceptance criteria

- AC-1: `npm run validate` exit 0, and the warnings for SPEC-004/011/015 are gone (FR-1, FR-2, FR-6).
- AC-2: `git diff` for each of the three shows the `status:` line changed to value-only and the rationale present in the body, no frontmatter comment added after `status:` (FR-1, FR-2).
- AC-3: Computed `specHash()` before/after is quoted for each of the three (FR-3).
- AC-4: SPEC-095's warning is either gone or has a linked owner + exit condition (FR-4).
- AC-5: No new warning of any rule appears in `npm run validate` relative to the pre-change run, other than those removed (FR-6).

## Invariants this change must not break

- No silent gate (invariant 2): no warning is "fixed" by suppressing, filtering, or downgrading the rule, and `statusLineAnnotation`/`implementEvidence` stay at their configured severity.
- Offline (invariant 1): no network calls added.
- Blast radius (invariant 3): edits stay inside this repo's own specs/validator; nothing shipped to adopters changes behaviour unless D2 selects a rule change.
- Evidence Discipline: any "built / works / N tests pass" text carried into a body note is re-verified, not relocated unverified.

## Out of scope

- Flipping `statusLineAnnotation` or `implementEvidence` from `warn` to `error` (the FR-7 ratchet flip is a separate decision gated on a clean corpus; this spec is a step toward it, not the flip).
- Building SPEC-095 task 6.5 itself.
- The unrelated pre-existing warnings (`split-coverage`, `ref-check` for SPEC-011/015) seen in the same run.

## Decisions needed (Clarify)

**D1 — SPEC-095's `text-io-inventory.test.ts` warning.**
- **A (rec) — Build task 6.5, warning clears on its own.** True state is "unbuilt"; the warning is accurate and clears when FR-10's test lands. Cost: the warning persists on every run until then, which is the very "skip the validator's output" habit the issue warns about; mitigated only if 6.5 is scheduled soon.
- **B — Narrow SPEC-095's `phases.implement` back to `pending`** until 6.5 is ready. Honest if no implement work counts, but SPEC-095 has shipped `text-io.ts` and a test, so `pending` would understate real progress (a false signpost the other way).
- **C — Leave it and accept one standing warning** with a recorded exit condition. Cheapest now; the cost is a known-red line normalising warnings.
- Removing the path from `implements:` is **not offered**: the file's own comment says adding/removing a path after approval edits hashed bytes and stales the sign-off, and it would hide a deliverable rather than finish it.

**D2 — Should the evidence rule tolerate declared-but-unbuilt files while a spec is `in-progress`?**
- **A (rec) — No change.** Rule 22 exists precisely to catch a spec claiming active implementation without owned files (SPEC-065, #1751). Cost: any multi-task spec with a late-phase file warns throughout implementation.
- **B — Allow missing files when `tasks.md` has an unchecked task naming that path.** Removes the transient noise; cost: a new coupling between two files, a new parser, and a way for a stale unchecked task to mask a genuinely abandoned file (a silent-gate risk under invariant 2).

**D3 — Where do the three moved status notes live?**
- **A (rec) — One short "Status note" paragraph in each body, claims re-verified.** Cost: three body edits to spec text.
- **B — Drop the notes.** Least text; cost: loses the pointer from each spec to the findings that drove DR-021/022/024 (SPEC-004), a record worth keeping.
