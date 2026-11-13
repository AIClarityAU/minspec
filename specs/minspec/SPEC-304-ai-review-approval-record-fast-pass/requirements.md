---
id: SPEC-304
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - docs-lane ergonomics (same epic as SPEC-039)
aspects: [ai-review, docs-lane, token-economy, fail-closed, approval-record]
depends_on: []
relates_to: ["#789", "#575", "#781", "SPEC-024", "SPEC-039", "SPEC-296", "DR-111", "DR-119"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `.github/workflows/ai-review.yml`, one new pure judge under `scripts/lib/`, new tests. None claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-304: ai-review posts a deterministic pass for a docs-lane pull request that carries only an approval record

> **SPECIFICATION ONLY.** Written for issue [#789](https://github.com/AIClarityAU/minspec/issues/789).
> Nothing is built until this spec is approved and the [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.

## In plain terms

A pull request that only lands an approval record (`.minspec/approvals/**`, which the human already
decided in the editor) still runs the full model-based `ai-review` panel (`ai-review.yml`, which runs
`scripts/review-branch.sh` with a model). That spends tokens to re-read a hash and a name. This spec adds
a pure, no-model check to the same workflow: when the diff is provably nothing but approval-record
sidecars (plus, if Clarify allows, a status-only flip of the artifact they approve), the workflow posts the
same `ai-review:pass` label and `ai-review/pass` witness a model pass would, without calling the model.
Any doubt falls through to the full review. Substantive doc bodies always get the full review.

## Context (measured by reading the code at base; line numbers rot, Plan re-reads)

- `ai-review.yml` posts the label AS the `minspec-sdd[bot]` App and a SHA-bound `ai-review/pass` commit
  status (and an `ai-review` check-run); `ready-to-merge` requires that witness. Its voters run via
  `review-branch.sh` (model) and the verdict is reduced by `review-decide.sh` (pure, fail-closed).
- The workflow already has a precedent for skipping model work on a PR shape: docs-only PRs skip the
  security voter, and a carry-forward path re-uses a prior pass on an unchanged head.
- `docs-lane.yml` enforces the docs path corpus (`DOCS_CORPUS_RE`, `scripts/lib/docs-corpus.sh`) and arms
  auto-merge for `docs-lane`-labelled PRs; it explicitly relies on `ai-review` still gating.
- `scripts/lib/alta-approval-only.ts` (DR-111) already contains a pure judge proving a PR carries only
  approval records (modes, add/modify only, `readRecord` shape, `specHash` equality, artifact differs only
  in `status:`/`phases:`). It is the natural source of the shape rules, but it also encodes the founder-author
  rule, which this spec does not need (see FR-3 and Clarify D2).

## Functional requirements

- **FR-1 (scope: docs-lane only).** The fast-pass is considered only for a pull request that carries the
  `docs-lane` label, is open, same-repo (no fork), non-draft, and targets the default branch.
- **FR-2 (diff shape, strict).** Eligible only when the `base...head` diff is non-empty and EVERY entry is
  an add or modify of a regular file (mode 100644; no rename, delete, symlink, submodule) whose path matches
  `.minspec/approvals/<path>.json`. Any other path makes the PR ineligible. Status-flip of artifacts is
  governed by Clarify D1; absent a decision, FR-2 is sidecar-only.
- **FR-3 (record integrity).** Each sidecar parses through the repo's own record reader, carries no key
  outside the known record shape, names its own path as `specPath`, and its `specHash` equals `specHash()`
  of the artifact it names AS IT STANDS ON THE HEAD. Unreadable, unparseable, or missing artifact is
  ineligible (fail closed). This is the check that makes "the approved text is what was approved" a
  deterministic fact instead of a model opinion.
- **FR-4 (output equals a model pass).** On eligibility the workflow emits exactly what a clean model pass
  emits: the `ai-review:pass` label, the SHA-bound `ai-review/pass` status and `ai-review` check-run on the
  exact head SHA judged, all posted by the App token. The review comment states plainly that the pass was
  deterministic, names the rule, and lists the files judged. It never reads as a model verdict.
- **FR-5 (no model call).** On the fast-pass path no `claude`/model process is started and no model token
  is spent. A test asserts the model entry point is not invoked when the judge says eligible.
- **FR-6 (fail closed to full review).** Any judge error, missing input, API read failure, truncated file
  list (pagination), or ineligible shape falls through to the existing full review unchanged. The fast-pass
  can only ever remove a model call, never a gate, and never produce a pass the full review would have
  withheld on the same eligible shape.
- **FR-7 (head-bound).** The judgement binds to the head SHA it read; a later push re-runs the judge from
  scratch (no carry-over of a fast-pass to a different head except via the existing carry-forward rules).
- **FR-8 (existing holds win).** Held labels (`ai-review:changes`, `ai-review:blocked`, `hold:*`,
  `needs-human-review`) and machinery detection (`.github/` or `scripts/` touched) are evaluated first; a
  machinery PR is never fast-passed (it is ineligible by FR-2 anyway, since those paths are not sidecars).
- **FR-9 (judge placement and trust).** The judge runs from the BASE checkout (the trusted control plane
  the workflow already uses), never from PR-head code, so a PR cannot rewrite the judge to forge a pass.
- **FR-10 (observability).** Each run records which path was taken (fast-pass, or full review with the
  reason it was ineligible) in the job summary, so a quiet week is distinguishable from a dead rule.

## Acceptance criteria

- **AC-1** A docs-lane PR adding one valid `.minspec/approvals/specs/x.json` whose hash matches the head
  artifact: label, status and check-run are `pass` on that head SHA, the model entry point is never invoked.
- **AC-2** Same PR with the hash off by one byte: not fast-passed; full review runs.
- **AC-3** Sidecar plus any edit to a spec/DR body (outside Clarify D1's allowance): full review runs.
- **AC-4** Sidecar plus a `.github/` or `scripts/` file: full review runs, machinery hold unchanged.
- **AC-5** A rename, delete, symlink, mode change, extra JSON key, wrong `specPath`, or a PR without the
  `docs-lane` label: full review runs.
- **AC-6** A file-list read that fails or is paginated past the limit: full review runs, with the reason
  in the summary.
- **AC-7** A push after a fast-pass re-evaluates; a body edit pushed onto a fast-passed PR loses the pass
  and gets the full review.
- **AC-8** A judge crash (thrown exception) is visible in the run and falls through to full review; it never
  yields a pass and never silently skips the review step.
- **AC-9** The pass comment names itself as deterministic and does not claim a model reviewed the diff.

## Invariants (must not break)

- **INV-1 (constitution #2, no silent gate).** The fast-pass is a second producer for the same witness, not a
  bypass: every error path is visible and falls to the full review (FR-6, FR-10, AC-8). No `|| true` on the
  judge or on posting the witness.
- **INV-2 (constitution #1, offline).** The judge makes no network call; only the workflow's existing
  GitHub API reads (the file list, labels) are used, as today.
- **INV-3 (constitution #3, blast radius).** Nothing changes for a repo without `.minspec/`; the rule applies
  only inside this repo's workflow and the opt-in docs-lane label.
- **INV-4 (provenance).** The pass is still posted only by the App token from this workflow run, never
  hand-addable, so existing provenance checks on `ai-review:pass` still hold.
- **INV-5 (single corpus).** The approval-record path rule must not become a fifth copy of the docs corpus
  regex that can drift (see the lock-step note in `scripts/lib/docs-corpus.sh`); Plan reuses or pins it.
- **INV-6 (docs-lane unchanged).** `docs-lane.yml` path enforcement and outward-facing-doc refusal are not
  loosened; this spec only removes a model call after those gates' preconditions.

## Out of scope

- Auto-merging approval PRs (that is DR-111 / SPEC-296).
- Fast-passing any substantive doc body, README/CHANGELOG, or non-docs-lane PR.
- Changing the full review's prompts, voters, or verdict reduction.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1: may a status-only flip of the approved artifact ride along?** The issue says "or trivial status
  flips". Approval PRs from the editor normally also flip `status:`/`phases:` in the artifact.
  - **(rec) A: yes, reuse the DR-111 rule** (artifact already on base, differs only in the frontmatter
    `status:` line and `phases:` block, byte-identical otherwise). Covers the real approval PR shape, so the
    saving actually lands. Cost: the judge must byte-compare base vs head, a larger fail-closed surface than
    sidecar-only, and a bug there would pass a body edit unreviewed.
  - B: sidecar-only. Smallest surface and trivially safe. Cost: the editor's approval PRs usually include the
    status flip, so the fast-pass would rarely fire and the token saving is mostly lost.

  **Recorded selection: Option A,** yes, a status-only flip of the approved artifact rides along under the DR-111 rule. An agent session copied this document's (rec) option; no human chose this item.
- **D2: does the author matter?** DR-111 requires a founder-authored PR; DR-119 lets the bot author
  approvals. Because the pass here only replaces a model read of a hash match, and merge authority stays with
  docs-lane/other gates:
  - **(rec) A: no author check**; the diff-shape and hash proof are the whole claim. Cost: any contributor
    with write access can get a free pass on a forged-but-self-consistent sidecar (hash matches, body
    unchanged), i.e. a fabricated approval is not caught by this layer; it must be caught by the approval
    gate (SPEC-022/045), which this spec does not re-implement.
  - B: require the sidecar's approver to be a founder email (DR-111 rule). Closes that hole here. Cost: the
    bot-authored delegated approvals (DR-119) never fast-pass, and a second identity list must be kept in sync.

  **Recorded selection: Option A,** no author check; a forged but self-consistent sidecar is left to the approval gate (SPEC-022/045), as that option's cost states. An agent session copied this document's (rec) option; no human chose this item.
- **D3: reuse by import or new judge?** `alta-approval-only.ts` imports from `packages/`. Options: (rec) A a
  new small judge that shares the record and hash helpers but not the author rules, cost: two judges with
  overlapping shape rules can drift (INV-5), mitigate with a shared-fixture test; or B refactor the DR-111
  judge into composable guards, cost: touches a merge-gating file and enlarges this PR's blast radius.

  **Recorded selection: Option A,** a new small judge that shares the record and hash helpers but not the author rules, with a shared-fixture test. An agent session copied this document's (rec) option; no human chose this item.
