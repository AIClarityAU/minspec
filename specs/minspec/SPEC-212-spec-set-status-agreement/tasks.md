---
id: SPEC-212
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-212 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - a cross-file agreement check on the spec-set is part of the methodology's validator
relates_to: [SPEC-059, "#277", "#972", "#3662"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-212 - Tasks

The order below is the order of work. Tasks 1 to 3 are one pull request (the rule cannot
land without its backfill, or it ships red-flagged on `main`; see task 4). Task 4 may be
the same pull request or a stacked one, but the rule's pull request does not merge before
the backfill is on its branch. Each task names the requirement IDs it satisfies, the files
it touches and the test that proves it. The plan is [design.md](design.md); the contract
is [requirements.md](requirements.md), which no task edits.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` before the
  code that turns it green.
- No file under `.github/`, `.githooks/` or `.minspec/` changes. No machinery merge is
  needed.
- `implements: none` stays true: no new file under `packages/*/src/` (design.md, D1).
- The two new rule ids are `status.spec-set.lag` and `status.spec-set.unreadable`, both
  `severity: 'warning'` (DQ-3).
- Before calling a task done, run `npx vitest run packages/minspec/tests` from the repo
  root (CI's shape: `npx vitest`, not `npm test`), then `npm run validate` and
  `npm run lint`.

## 1 - The pure rule (FR-1, FR-2, FR-3, FR-5; AC-1 to AC-5)

- [x] **1.1** `packages/minspec/tests/spec-set-status-agreement.test.ts` (new) - T0 cases
  against `validateSpecSetStatusAgreement`, built from in-memory `SpecSetStatusFile`
  fixtures (a `fm(status)` helper renders a minimal frontmatter block):
  - AC-1: requirements `implementing`, design `specifying` → one `status.spec-set.lag`
    warning whose message contains `design.md`, `implementing` and `specifying`.
  - AC-2: all three `planning` → no violations; all three `done` → no violations.
  - AC-3: requirements `planning`, tasks `new` → one lag warning naming `tasks.md`.
  - AC-4: a set with no `requirements.md` entry → `notApplicable: true`, no violations;
    an empty array → the same.
  - AC-5, four cases, each one `status.spec-set.unreadable` naming the file: design with no
    `status:` line; design with `status: draft`; design with no frontmatter block; design
    with `raw: undefined, readError: 'EACCES'` (the message carries the error text).
  - Unreadable `requirements.md` → one unreadable warning naming `requirements.md`, and no
    lag warning for any sibling.
  - DQ-2: requirements `planning`, tasks `implementing` → no violations.
  - FR-2 terminal: requirements `archived`, design `done` → one lag warning; requirements
    `superseded`, both siblings `superseded` → none.
  - D5: requirements `implementing`, design `archived` → none.
  - An inline comment on a status line (`status: planning  # note`) reads as `planning`.
  - Severity: every violation in every case above is `'warning'`.
  *Done when:* the file runs RED on `origin/main` (import of the missing export fails),
  observed once before 1.2.
- [x] **1.2** `packages/minspec/src/lib/spec-validator.ts` - add `SpecSetStatusFile`,
  `SpecSetStatusResult`, `SPEC_SET_STATUS_FILE_NAMES`, the private `literalStatusOf`, and
  `validateSpecSetStatusAgreement` in a new section after `validateStatusMonotonicity`,
  exactly as design.md, *The rule*, specifies. Reuse `LIFECYCLE_RANK`,
  `rawFrontmatterField`, `FRONTMATTER_BLOCK_RE` and `SPEC_STATUS_SET`; copy none of them.
  The section's doc comment states the literal-versus-derived split (FR-5) and names both
  neighbouring rules. Fix the `LIFECYCLE_RANK` header comment so its order includes
  `planning`. *Done when:* 1.1 is green.

## 2 - The reader (FR-1, FR-3)

- [x] **2.1** `packages/minspec/tests/spec-set-status-agreement.test.ts` - a second
  `describe` against `readSpecSetStatusFiles` on temp-directory fixtures:
  - a fixture directory named `SPEC-` + a number + `-probe` (e.g. nine-hundred) with all three files → three entries, `raw` populated;
  - the same directory with no `requirements.md` → `[]`;
  - a directory not named `SPEC-NNN-*` (e.g. `specs/minspec/` style, holding
    `requirements.md` + `design.md`) → `[]`;
  - a CRLF `design.md` → its `raw` has no `\r`, and fed to the rule it reads its status
    (no unreadable warning);
  - an unreadable `design.md` (a dangling symlink) → an entry with `raw: undefined` and a
    non-empty `readError`, and fed to the rule, an unreadable warning. Prove the fault
    took: assert `fs.readFileSync` on the path throws before asserting the reader's
    output, so the case cannot pass vacuously.
  *Done when:* RED before 2.2, green after.
- [x] **2.2** `packages/minspec/src/lib/spec-layout.ts` - add `readSpecSetStatusFiles`
  after `readShardIdFiles` (design.md, *The reader*): `SPEC-NNN-` basename and
  `requirements.md` gate, `readDocumentText` for each present file, a thrown read captured
  as `readError`. Import `SPEC_SET_STATUS_FILE_NAMES` and the type from
  `./spec-validator` (the type import already exists for `ShardIdFile`; check
  `scripts/check-import-cycles.ts` stays green, since `spec-layout.ts` already imports from
  `spec-validator.ts` and not the reverse). *Done when:* 2.1 is green.

## 3 - Both surfaces (FR-5)

- [x] **3.1** `packages/minspec/tests/validate-command.test.ts` - mock
  `readSpecSetStatusFiles` beside the existing `readShardIdFiles` mock, and add a case
  asserting `validateSpec` receives `specSetStatusFiles` equal to the mock's return for
  the spec's directory (the shape of the existing `readShardIdFiles` case). Add one
  `validateSpec` case to `spec-set-status-agreement.test.ts`: with `specSetStatusFiles`
  holding a lagging set, the result carries the `status.spec-set.lag` warning and
  `complete` stays `true`; without the option, no such warning.
- [x] **3.2** `packages/minspec/src/lib/spec-validator.ts` - add `specSetStatusFiles` to
  `ValidateSpecOptions` (doc comment in the `siblingShardFiles` no-false-positive pattern)
  and push the rule's violations in `validateSpec` beside step 5.
  `packages/minspec/src/commands/validate.ts` - pass
  `specSetStatusFiles: readSpecSetStatusFiles(path.dirname(spec.filePath))`.
  `packages/minspec/src/commands/approve.ts` is NOT changed (design.md, D3).
  *Done when:* 3.1 is green.
- [ ] **3.3** `packages/minspec/tests/validate-frontmatter-spec-set-status.test.ts` (new) -
  subprocess cases against `scripts/validate-frontmatter.ts`, using the harness shape of
  `validate-frontmatter-annotation-skip.test.ts` (absolute `tsx` from
  `node_modules/.bin`, temp repo cwd): a fixture with one lagging fixture set (a `SPEC-` + number + `-probe` directory)
  prints a `WARN spec-set-status specs/<that directory>:` line naming `design.md` and still
  exits 0; an agreeing set prints no `spec-set-status` line; an unreadable sibling prints
  an unreadable line rather than nothing. Control: the agreeing fixture with its
  `design.md` status edited to lag flips to one warning, so the "no line" case is not
  passing because the rule never ran.
- [ ] **3.4** `scripts/validate-frontmatter.ts` - add Rule 27 after Rule 7 (design.md,
  *Surface 2*), with the rule comment naming #972 and SPEC-212 and stating it is the same
  pair of functions the command calls. *Done when:* 3.3 is green.

## 4 - Backfill so the rule ships clean (FR-4; AC-6)

- [ ] **4.1** Run `npm run validate 2>&1 | grep 'spec-set-status'` on the branch. Its lines
  are the backfill list; compare with design.md, *Backfill*, and follow the run, not the
  table. Before editing, list open pull requests that touch those paths
  (`gh pr list --repo AIClarityAU/minspec --state open --json number,files`) and note any
  overlap in the pull request body (design.md, R3).
- [ ] **4.2** Before editing, record `specHash()` (`@aiclarity/shared`) of every file in
  the list and of each set's `requirements.md`. Edit only the `status:` line of each
  listed sibling to its `requirements.md` value. Recompute: every hash is unchanged, and
  `getApprovalStatus` for each set's `requirements.md` is unchanged. Put the before/after
  table in the pull request body (AC-6).
- [ ] **4.3** `npm run validate` passes, prints zero `spec-set-status` lines, and its
  non-fatal warning count is the pre-backfill count minus the backfilled files (measured,
  not assumed: the count before task 4.2 and after are both in the pull request body).
  *Done when:* AC-6 holds and the full suite is green.

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 1.1, 1.2, 2.1, 2.2 |
| FR-2 | 1.1, 1.2 |
| FR-3 | 1.1, 1.2, 2.1, 3.3 |
| FR-4 | 4.1, 4.2, 4.3 |
| FR-5 | 1.2, 3.1, 3.2, 3.3, 3.4 |
| AC-1 to AC-5 | 1.1 (2.1 for AC-5 via disk) |
| AC-6 | 4.2, 4.3 |
