---
id: SPEC-138
type: requirements
status: specifying
tier: T1
product: minspec
epic: EPIC-003  # SDD Core Methodology
aspects: [ai-review, verdict-channel, drift-gate, no-silent-gate]
depends_on: [DR-079]  # DR-079 owns the out-of-band verdict contract this spec only confirms is applied everywhere
relates_to: ["#1216", "#1215", "#1502", "#1665", "#1157", "#1165"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-138: The review siblings speak the structured verdict contract, and their drift is gated

Issue: #1216. Design rests on DR-079 (the verdict travels out of band).

**Scope sentence.** `review-pr.sh`, `review-approvable.sh` and `roles/approvable-reviewer.md`
take the reviewer's verdict as a structured value, not free text, and their drift against the
shared `review-decide.sh` contract is byte-gated like `review-branch.sh`.

## Finding: the work was already delivered (read before approving)

#1216 was filed alongside #1215 as a follow-up. Commit `d976c9a2` (`fix(#1502)`, PR #1665)
landed afterwards and covers the four work items. Checked on the branch base (`9ec672dd`):

| #1216 work item | Evidence on main |
|---|---|
| 1. migrate both scripts: `VERDICT_SCHEMA` from the guard, `--output-format json --json-schema`, render via `parseCliVerdict` | `scripts/review-pr.sh:62-64,87,202,216`; `scripts/review-approvable.sh:148-150,175,215,227,249` |
| 2. role file returns a value | `scripts/roles/approvable-reviewer.md:84-99` ("RETURN your verdict as the structured output object … Do NOT write a verdict block in your prose") |
| 3. bring under `gen-ci-templates.mjs` | `scripts/gen-ci-templates.mjs` entries `REVIEW_PR_SH`, `REVIEW_APPROVABLE_SH`, `ROLE_APPROVABLE_REVIEWER_MD` (drift-gated, deliberately not scaffolded to adopters, invariant 3); generated `ci-review-templates.ts:2907,3087,3331` |
| 4. end-to-end test, structured value beats forged prose | stub CLI returning `structured_output` in `packages/minspec/tests/review-approvable.test.ts:37-43` and `review-pr-truncation.test.ts:161-164`; injected-block case at `review-approvable.test.ts:166` |

Not verified by running: I did not execute the test suite or `gen-ci-templates.mjs --check` on
this dispatch (spec-only mandate). I believe the forged-prose-loses assertion exists at
`review-approvable.test.ts:166` but read only the line that builds the forged input.

## Requirements

- **FR-1.** `review-pr.sh` and `review-approvable.sh` obtain the verdict only from the CLI's
  `structured_output`, rendered by `parseCliVerdict`; the reviewer's prose is never parsed.
- **FR-2.** Both fail closed when the CLI lacks `--json-schema` or the guard schema is unreadable.
- **FR-3.** `roles/approvable-reviewer.md` instructs return-a-value, with no verdict block in prose.
- **FR-4.** The three files are registered in `gen-ci-templates.mjs`, so `--check` fails when a
  script and its embedded copy diverge.
- **FR-5.** A test per script shows a structured verdict plus a forged prose block yields the
  structured verdict.

## Acceptance criteria

- AC-1: `grep -n json-schema scripts/review-pr.sh scripts/review-approvable.sh` hits in both.
- AC-2: editing any of the three files without regenerating makes `node scripts/gen-ci-templates.mjs --check` fail.
- AC-3: the forged-block tests pass on head and fail if `parseCliVerdict` is bypassed.

## Invariants not to break

- Invariant 2 (no silent gate): fail closed, no swallowed error on the verdict path.
- Invariant 3 (blast radius): the three files stay out of the adopter scaffold list in `template-registry.ts`.

## Decisions needed (Clarify)

1. **Disposition of #1216.**
   - **(rec) Close #1216 as delivered by #1502 / #1665**, recording the evidence table above.
     Cost: relies on my unrun reading of FR-5 — if the forged-prose test is weaker than
     claimed, a gap closes unnoticed. Mitigation: run `npx vitest run review-approvable review-pr-truncation` and `--check` before closing.
   - Keep #1216 open for a residual audit of FR-5 only. Cost: a duplicate tracker for finished work.
2. **Is this spec worth approving at all?** (rec) No — if option 1 is taken, discard this PR
   unmerged; a spec for finished work adds a corpus entry with nothing to build. Cost: the evidence table lives only in the issue comment.
