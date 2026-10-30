---
id: SPEC-079
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-079 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-090, DR-092, DR-074, DR-066, SPEC-228, SPEC-068, "#1884", "#1486", "#3251"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-079 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md), including its *Decisions taken*; the
contract is [requirements.md](requirements.md), which no task edits.

Rules for every task:

- **Task 1 blocks every other task.** Tasks 2-6 start only once task 1's decision record is
  on `main`. Task 5, the first write that reaches adopter repos (the ownership claim the DR
  governs), also waits until the founder has accepted that record. No task accepts it.
- Write the task's test first, run it against the unchanged code, and paste the red output
  into the pull request. A test that is green before the change is not done.
- Never touch `localizeMachineryPathsComment` or `LOCALIZED_MACHINERY_COMMENT` (FR-3);
  `packages/minspec/tests/machinery-comment-localization.test.ts` stays unchanged and green.
- Any change to `template-registry.ts` that alters a `rendered` entry's `content` is
  followed by `npx tsx scripts/gen-parity-canonical.ts` (from task 2 on), and any change to
  a CI-review source file by `node scripts/gen-ci-templates.mjs` as well; commit the
  regenerated files in the same pull request. Never hand-edit them.
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before
  calling a task done.
- Tasks 2-6 touch `packages/minspec/src/lib/template-registry.ts`, `scripts/` or
  `.github/`, so their pull requests are review machinery and merge by a human.
- No network call in any code or test this spec adds (INV-4); task 4's shell test fetches
  with `file://` only.

## 1 - Decision record: MinSpec owns `minspec-ci-parity.yml` (DQ-1 (D), DQ-2; shared with SPEC-228)

- [ ] **1.1** `docs/decisions/DR-NNN.md` (number from the collision gate,
  `scripts/check-dr-id-collision.ts`, never from the files on disk) and
  `docs/decisions/INDEX.md` - `status: proposed`. Before drafting, search `main` and open
  pull requests for a DR already covering SPEC-228's or this spec's ownership of the parity
  workflow; if one exists, stop and reuse it. Record: MinSpec ships
  `.github/workflows/minspec-ci-parity.yml` as a managed template (founder, queue item c228,
  2026-10-28: "All three (Recommended) - managed template, scaffold parity job, one shared
  DR"); it is the first file MinSpec claims that adopters wrote by hand; how a hand-written
  copy is met (left untouched, named as a first claim, replaced only by the consent-gated
  Re-scaffold, design.md *Taking over a hand-written copy*); repos with `.minspec/` and no
  copy get one on refresh (SPEC-228 DQ-3 (a)); the canonical for a localized region is a
  generated file on `main` (design.md *The parity declaration*); every later change to the
  workflow reaches an adopter only through a human-pushed refresh; no sequencing on SPEC-068
  (design.md DQ-4 row). Cite SPEC-079, SPEC-228, #1884, #2060, #3251, DR-090, DR-092, DR-074.
  `## Follow-ups (tracked)` lists SPEC-079 and SPEC-228, and DR-092 follow-up (d) as
  superseded in any adopter that takes the managed copy.
  *Done when:* `npm run validate` passes and the record carries `## In plain terms`.

## 2 - Every template declares its parity canonical; the localized one is generated (FR-1, FR-2; AC 2, 3)

- [ ] **2.1** `packages/minspec/tests/managed-region-parity-equality.test.ts` (new) - the
  five checks in design.md, *The equality test*: every entry resolves to exactly one kind;
  each `source` region equals this repo's file at `outputPath` (leading `#!` line dropped);
  each `rendered` region equals the committed file at its `path`; the excluded names and
  reasons are pinned; `parityEntries()` has 16 rows and the `ai-review.yml` row's
  `canonicalPath` is `parity-canonical/.github/workflows/ai-review.yml`. Regions are taken
  from `renderManagedBlock(tpl)` by the marker extraction, byte-compared.
- [ ] **2.2** `packages/minspec/src/lib/template-registry.ts` - `ParityCanonical`,
  `PARITY_CANONICAL_DIR`, `ParityEntry`, the optional `parity` field,
  `parityCanonicalOf` with the defaults, `parityEntries`; declare `rendered` on
  `ai-review-workflow` and `excluded` (with the design's reason) on `validate-workflow`,
  `pre-commit-hook`, `commit-msg-hook`, `validate-py`.
- [ ] **2.3** `scripts/gen-parity-canonical.ts` (new) - `generateParityCanonical(repoRoot)`
  (pure) and the CLI with `--check`; run it to write
  `parity-canonical/.github/workflows/ai-review.yml` and commit that file.
  *Done when:* 2.1 is green, and the pull request shows each of these mutations red, with
  the failing line: `ai-review-workflow` declared `source` (the #1884 divergence, inside this
  repo); a fake unconditional entry whose content matches no file; one byte changed in the
  generated canonical.

## 3 - The canonical cannot go stale, and no second copy of the transform can appear (FR-1; AC 2)

- [ ] **3.1** `packages/minspec/tests/parity-canonical-staleness.test.ts` (new) - over a temp
  copy of the repo's relevant files: the validate check reports the canonical's path and both
  regenerate commands when one byte of it is changed, and when it is deleted; and it fails
  (does not pass) when the generator module cannot load. The FR-1 guard: scan `scripts/`,
  `.github/`, `packages/*/src` and `parity-canonical/` for the line `# INHERITED FROM MINSPEC`
  and allow only `packages/minspec/src/lib/template-registry.ts` and files under
  `parity-canonical/`; prove it red by adding the line to a temp file under `scripts/`.
- [ ] **3.2** `scripts/validate-frontmatter.ts` - the staleness check over
  `generateParityCanonical`, beside the `gen-ci-templates` check, failing closed on a load
  error, its message naming `npx tsx scripts/gen-parity-canonical.ts` and
  `node scripts/gen-ci-templates.mjs`.
  *Done when:* 3.1 is green and `npm run validate` is green on the unchanged tree.

## 4 - The parity workflow is rendered from the parity table (FR-1, FR-2; INV-1, INV-3, INV-4)

- [ ] **4.1** `packages/minspec/tests/ci-parity-workflow.test.ts` (new) - render with
  `parityEntries()`, extract the compare step's `run:` block, and run it with `bash` in a temp
  adopter tree built by `renderManagedFile` for every row, `MINSPEC_RAW=file://<repo root>`.
  Cases from design.md, *Testing*: all rows pass (`ai-review.yml` included); the control,
  with the `ai-review.yml` row's canonical set to `.github/workflows/ai-review.yml`, fails
  naming that file; one edited region fails with `DRIFT`; a missing local file and a missing
  canonical each exit non-zero with an `::error::` line. Text checks: `on.pull_request.paths`
  holds every row's `outputPath` and the workflow's own path; the job carries
  `if: github.repository != 'AIClarityAU/minspec'`; the text has no `|| true`, no
  `continue-on-error`, no `gen-ci-templates.mjs SOURCES`; the remedy line names updating the
  extension before the refresh.
- [ ] **4.2** `packages/minspec/src/lib/ci-parity-workflow.ts` (new) -
  `renderCiParityWorkflow(rows)` per design.md, *The managed parity workflow*. Not yet
  registered: no adopter receives it in this task.
  *Done when:* 4.1 is green, and the pull request pastes the control case's red output.

## 5 - Register the parity workflow as a managed template (DQ-1 (D), FR-5; AC 1, 6)

Waits for the founder's acceptance of task 1's record.

- [ ] **5.1** `packages/minspec/tests/managed-region-enumeration.test.ts` - count 31 to 32
  and `.github/workflows/minspec-ci-parity.yml` pinned; and
  `managed-region-parity-equality.test.ts` - `parityEntries()` 17 rows, the new row
  `rendered` at `parity-canonical/.github/workflows/minspec-ci-parity.yml`.
- [ ] **5.2** `packages/minspec/src/lib/template-registry.ts` - the `ci-parity-workflow`
  entry after `CI_REVIEW_STACK_TEMPLATES`, its `content` rendered from the registry's
  descriptors (no cycle, design.md), `parity: rendered`, no `condition`. Regenerate
  `parity-canonical/.github/workflows/minspec-ci-parity.yml`. Write MinSpec's own
  `.github/workflows/minspec-ci-parity.yml` with `renderManagedFile` and commit it.
  If `readme-manifest-parity.test.ts` or any doc test that lists managed files goes red, update
  the file it names in the same pull request.
  *Done when:* 5.1 is green, `ci-parity-workflow.test.ts` is green over the 17 rows, and
  `managed-region-self-application.test.ts` is green.

## 6 - A hand-written copy is named as a first claim, never overwritten silently (FR-5, INV-2; AC 6)

- [ ] **6.1** `packages/minspec/tests/ci-parity-first-claim.test.ts` (new) - a fixture repo
  with `.minspec/` and a hand-written, markerless `.github/workflows/minspec-ci-parity.yml`
  (the sealbox shape, inlined as a fixture): `refreshHarnessFiles` leaves the file
  byte-identical and returns a `missing-markers` warning whose message contains the
  `firstClaim` sentence. A fixture with the file absent gets the managed file. A fixture
  without `.minspec/` is refused before any write and the tree is unchanged. One other
  template's missing-markers message is asserted unchanged.
- [ ] **6.2** `packages/minspec/src/lib/template-registry.ts` - the optional `firstClaim`
  field, set on `ci-parity-workflow` only; `packages/minspec/src/lib/scaffold.ts` -
  `missingMarkersMessage` takes the template and appends `firstClaim` when set; its callers
  pass the template.
  *Done when:* 6.1 is green and every existing test matching on the missing-markers text is
  unchanged and green.
