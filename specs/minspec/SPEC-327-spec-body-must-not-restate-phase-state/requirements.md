---
id: SPEC-327
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the specify-to-approve flow whose output this keeps self-consistent
aspects: [specify, approval, validation, review, false-signpost, fail-visible]
depends_on: []
relates_to: ["#3691", "#3680", "#3681", "#3682", "SPEC-213", "SPEC-217", "SPEC-227", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: `packages/minspec/src/lib/spec-validator.ts` (one new body check beside
  `validateStatusClaims`), the specify prompt/spec template, and tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-327: A spec body never restates lifecycle state the approval command owns

Issue: #3691 (spec body prose restates phase state, so a founder approval makes the spec contradict itself and the sign-off PR fails review).
Related records: DR-003 (RCDD, root cause is mechanism plus the missing gate).

## Problem

The spec writer puts lifecycle state into body prose (for example "so the clarify phase stays pending", "the evidence gap stays open"). MinSpec: Approve Spec then changes only the frontmatter (`status`, `phases.*`). The body now disagrees with the frontmatter, and the ai-review Skeptic voter blocks the sign-off PR as a false signpost. Measured 2026-11-12: #3680 (SPEC-213), #3681 (SPEC-217) and #3682 (SPEC-227) carry `ai-review:changes` for this reason alone. Editing the body on the sign-off branch changes the spec bytes and voids the approval hash, so the sign-off cannot land as approved without a re-approval.

Root cause (mechanism): the specify step writes state that the approval command owns and later changes into body prose, and no gate rejects body text that restates frontmatter lifecycle fields. The data fix (edit three specs) alone would leave the gate missing, so this spec adds the gate (DR-003 asymmetry check).

## Functional requirements

- **FR-1 Prompt and template forbid it.** The specify prompt and the spec template state that the body never names a `status` value or a `phases.<x>` value, nor says a phase "stays/remains pending/open/in progress/done". The body explains *why* a gap is open; which phase value follows is the frontmatter's job.
- **FR-2 Validator flags it.** A spec validation check scans the body (never the frontmatter block) and reports a violation for: (a) `phases.<phase>` or `phases: <phase>` followed within the same sentence by a lifecycle value (`pending`, `in-progress`, `done`, `skipped`); (b) the phrase "`<phase>` phase/stage stays|remains|is still `<value>`" for the five phase names; (c) `status` followed by a lifecycle status value in the same sentence as "stays|remains|is currently". Each violation reports the line and quotes the matched text.
- **FR-3 Runs before approval.** The check runs in `npm run validate` and in the Approve Spec pre-flight, so the author sees it while editing is still free and the approval hash is not yet taken.
- **FR-4 No false positives on quoted state.** Matches inside fenced code blocks and inline code spans that quote a frontmatter example, and inside a `## Acceptance criteria` or Given/When/Then line describing the approval command's own behaviour, are not flagged (a spec about approval must be able to describe it). See Decision 2 for the exact exemption.
- **FR-5 Severity.** Initially a warning on existing specs and an error on newly authored specs, using the existing severity pattern of `validateFrontmatterProse`. Decision 1 fixes the rollout.
- **FR-6 Existing corpus.** The check reports on the whole corpus without rewriting any spec. Specs already approved are not re-hashed or demoted by it.
- **FR-7 Stuck sign-offs.** The three stuck sign-offs (#3680, #3681, #3682) are resolved by the path chosen in Decision 3, and that decision is put to the founder once.

## Acceptance criteria

- **AC-1** Given a body containing "so `phases.clarify` stays `pending`", the validator reports one violation naming the line.
- **AC-2** Given a body that says "the evidence gap is open because X is unmeasured" (no phase or status value), the validator reports nothing.
- **AC-3** Given the same phrase inside a fenced code block, the validator reports nothing.
- **AC-4** Given a frontmatter-only `phases.clarify: pending`, the validator reports nothing (frontmatter is never scanned).
- **AC-5** Given the bodies of SPEC-213, SPEC-217 and SPEC-227 as they stand on the sign-off branches, the validator reports the passages the Skeptic cited (requirements.md ~L202-203, DQ-3 ~L237-240 of SPEC-217).
- **AC-6** Tests assert AC-1..AC-5 by calling the validator on fixture strings, and assert that the specify prompt contains the FR-1 rule.

## Invariants (must not break)

- **INV-1** No silent gate: a flagged body is reported visibly, never skipped on a parse error (constitution invariant 2). An unparseable body fails closed with a message.
- **INV-2** Approval hash stability: the check reads the spec and never rewrites it, so no existing approval hash changes.
- **INV-3** Offline (constitution invariant 1); active only in a repo with `.minspec/` (invariant 3).
- **INV-4** The approval command still changes frontmatter only; this spec does not make it edit the body.

## Out of scope

Having Approve Spec rewrite body prose (rejected: changes the bytes it just hashed). Reviewer-side relaxation of the Skeptic voter (a different gate; the body really would be a false signpost).

## Decisions needed (Clarify)

Recorded selections: each of the 4 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

1. **Rollout severity.** (a) Warning on the corpus, error only for specs authored after the check lands **(rec)**: no existing spec is blocked; cost: the authored-after boundary needs a stable marker (spec id above a threshold), one more rule to maintain. (b) Error everywhere: simplest; cost: any currently-matching approved spec fails `npm run validate` until edited, and editing voids its approval.

   **Recorded selection: Option (a),** warning on the corpus, error only for specs authored after the check lands. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
2. **How strict is the exemption.** (a) Exempt code fences, inline code, and acceptance-criteria lines **(rec)**: lets approval-related specs describe the command; cost: a writer can hide a claim inside a code span. (b) Exempt only fences: stricter; cost: specs about approval (such as this one, which quotes `phases.clarify` in Problem prose) must paraphrase.

   **Recorded selection: Option (a),** exempt code fences, inline code and acceptance-criteria lines. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
3. **Landing #3680-#3682.** (a) Fix the prose on main first via a normal spec PR, then the founder re-approves each **(rec)**: tree stays consistent and review passes; cost: three re-approvals and a delay. (b) Merge the sign-offs as-is with an `--admin` override of `ai-review:changes`: fastest; cost: three specs land with a self-contradicting body, the exact false signpost this spec exists to stop.

   **Recorded selection: Option (a),** fix the prose on main first via a normal spec PR, then each spec is re-approved; this selection approves nothing on those specs. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
4. **Detection by regex or by reading.** (a) Regex over a fixed phrase set **(rec)**: deterministic, offline, cheap; cost: misses novel wording ("is yet to start"). (b) Add an LLM-reviewer rule: catches wording drift; cost: model-trusted and non-deterministic, against the "enforce, don't trust" rule.

   **Recorded selection: Option (a),** a regex over a fixed phrase set. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
