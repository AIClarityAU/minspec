---
id: SPEC-212
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-212 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - a cross-file agreement check on the spec-set is part of the methodology's validator
relates_to: [SPEC-022, SPEC-059, DR-003, "#277", "#439", "#972", "#3662"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-212 - Design: one status per spec-set (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the three recorded Clarify selections: DQ-1 option A (police agreement, every
file keeps `status`), DQ-2 option A (a sibling ahead is not flagged), DQ-3 option A
(warning, with the backfill so `main` starts clean). Citations of "today" are against
`origin/main` `9c84f799`. New code is named by symbol, because its line numbers will move.
The task list is [tasks.md](tasks.md).

## Approach in one paragraph

A new pure function in `spec-validator.ts`, `validateSpecSetStatusAgreement`, takes the raw
text of each file in one `SPEC-NNN-*/` directory, reads each file's LITERAL `status:` line
with the module's existing `rawFrontmatterField`, and warns when `design.md` or `tasks.md`
ranks strictly below `requirements.md` on the existing `LIFECYCLE_RANK` order, when a
terminal `requirements.md` has a sibling that does not carry the same terminal, or when any
file's status cannot be read. A new fs reader in `spec-layout.ts`,
`readSpecSetStatusFiles`, assembles that input from disk beside the existing
`readShardIdFiles`. Two surfaces call the same pair: the extension's **MinSpec: Validate
Spec** command (through a new `validateSpec` option) and a new non-fatal Rule 27 in
`scripts/validate-frontmatter.ts` (`npm run validate`, the commit/CI path). The same change
backfills the 15 sibling files that lag today, so the rule lands with zero standing
findings.

## What Plan measured that the spec did not know

Each was run against `9c84f799`, not inferred.

1. **The lag is wider than the spec's table.** A literal-`status:` sweep of every
   `specs/*/SPEC-*/` directory finds 15 lagging sibling files in 11 spec-sets (the spec's
   table, taken at `7905665a`, lists 6 files in 5 sets). The full list is FR-4's backfill
   set in *Backfill* below.
2. **No backfill target carries an approval record.** Only three sibling documents in the
   whole repo have their own sidecar: `specs/minspec/design.md`, `specs/minspec/tasks.md`
   (SPEC-001's flat set) and `specs/agent-execute/SPEC-019-execution-substrate/design.md`.
   None of the 15 is among them; each set's sidecar is `requirements.md.json`, keyed on
   `requirements.md`'s canonical hash. So the backfill edits no approved file. AC-6's
   hash check is still run, on all 15 files, as a control (task 4.2).
3. **`status` really is outside the canonical hash.** `stripLifecycle`
   (`packages/shared/src/canonical.ts`, called from `specHash`) drops the `status:` line and
   the `phases:` block before hashing. Task 4.2 proves it on the real files by computing
   `specHash()` before and after, not by citing this.
4. **#277's rule does not run anywhere today.** `validateStatusMonotonicity`
   (`status.cross-artifact.regression`) has callers only in `tests/spec-validator.test.ts`;
   neither `validateSpec`, `commands/validate.ts` nor `scripts/validate-frontmatter.ts`
   calls it. FR-5's "separate rule" requirement is unaffected (SPEC-212 neither wires nor
   changes it), but a reader must not assume the derived-status mirror check is live.
   Filed as #3662 (status monotonicity rule never runs).
5. **Neither adjacent rule overlaps, read in code.** `status.cross-artifact.regression`
   compares DERIVED status (`deriveFileStatus` calls `deriveStatus(phases, approval,
   terminal)`), parent behind child. `status.mirror-drift` (`validateSpec`, section 0c)
   compares one file's literal line with that same file's derived status. Body/frontmatter
   status parity (`status-parity.ts`, Rule 11) compares two readouts inside one file. None
   compares one file's literal `status:` with a sibling's literal `status:`.
6. **The parser hides an absent status.** `parseSpec` coerces an absent or unknown
   `status:` to `new`, so a reader built on `parseSpec(...).frontmatter.status` could never
   satisfy AC-5. The rule reads the raw line instead.
7. **The backfill trips no other rule.** Two targets (SPEC-029, SPEC-038 `design.md`) carry
   a body `**Status:** Plan (SDD Plan phase)` line. `Plan` is not a recognised status word,
   so `status-parity.ts` treats it as free-form and reports nothing whatever the
   frontmatter says. Task 4.3 re-runs `npm run validate` to prove it.
8. **Baseline.** `npm run validate` on `9c84f799` passes with 546 non-fatal warnings.

## Interaction with SPEC-059

Measured point 5 holds for what each rule compares, but the two rules still disagreed on
their INPUT: which approval record an unsigned `design.md` / `tasks.md` is derived from.
`status.mirror-drift` (live in `validateSpec` section 0c, fed by the **MinSpec: Validate
Spec** command) derived each shard from its OWN record, and SPEC-059's plan (design.md,
*Which files*) keeps that for its corpus rule. An unsigned shard then derives at most
`specifying`, while FR-2 asks it to carry an approved requirements.md's `planning` or
later. Every shard of an approved set would draw one warning from one rule or the other,
and the backfill below would leave inline comments claiming the shard's status is the
unsigned-derived value.

SPEC-059's design records this tension ("Known tension, not resolved here") and leaves the
reconciliation to whichever spec lands second, naming the simplest one: derive a shard from
its parent's approval record. SPEC-212 lands second and takes that option.

- **Rule.** An unsigned `design.md` or `tasks.md` in a `SPEC-NNN-*/` directory that has a
  `requirements.md` is derived from requirements.md's approval record (approved, stale or
  unapproved), with its own `phases:`. A shard WITH its own record (SPEC-001's flat set,
  SPEC-019's `design.md`) keeps it. One shared helper decides this,
  `specSetApprovalSubject` in `spec-layout.ts`; `commands/validate.ts` uses it before
  calling `getApprovalStatus`.
- **No over-claim.** A shard reads as approved only when its spec-set's requirements.md
  is approved and current. An unapproved or stale parent still derives `specifying`, so
  the backfill raises no shard in a set without a current approval record. Each backfill
  target's parent was checked: all ten sets' `requirements.md` resolve `approved`.
- **Measured effect.** Of the 15 backfilled shards, the 6 that carry a `phases:` block
  (SPEC-042 `tasks.md`, SPEC-059 both, SPEC-064 `design.md`, SPEC-211 both) derived
  `specifying` from their own record and now derive `planning`, equal to their literal, so
  both rules are clean on them. The other 9 have no `phases:` block and derive `new`
  whichever record is used: that drift predated this change (their literal was
  `specifying` or `implementing`) and is SPEC-059 FR-4's no-phases case, not changed here.
- **Binding on SPEC-059's corpus rule.** When SPEC-059 builds its corpus pass it must call
  the same helper, or the two surfaces split again. Its *Which files* paragraph and its
  task 2.2 case "an unsigned `design.md` shard with `status: planning` ... is reported"
  predate this reconciliation; that case is correct only for a shard whose parent is not
  approved. SPEC-059's Known tension paragraph already hands this choice to the second
  spec, so this records the choice; amending SPEC-059's plan text is left to its builder.
- Rejected: comparing SPEC-212's rule against each shard's own derived status. That makes
  every shard of an approved set `specifying`, which is the lag FR-2 (approved) forbids.
  Rejected: exempting SPEC-059's shards. It would hide the same conflict on every other set.

## Architecture

### The rule: `validateSpecSetStatusAgreement` (FR-2, FR-3, FR-5)

Lives in `packages/minspec/src/lib/spec-validator.ts`, in a new section directly after
`validateStatusMonotonicity`, so the two status models sit side by side.

```ts
/** One file of a SPEC-NNN-*/ set, as read from disk (FR-1). */
export interface SpecSetStatusFile {
  /** Basename: 'requirements.md' | 'design.md' | 'tasks.md'. */
  readonly fileName: string;
  /** The file's text after prepareText (LF), or undefined when the read failed. */
  readonly raw: string | undefined;
  /** The read error's message, when raw is undefined. */
  readonly readError?: string;
}

export interface SpecSetStatusResult {
  /** true when the set has no requirements.md (FR-1): nothing is asserted. */
  readonly notApplicable: boolean;
  readonly violations: ValidationViolation[]; // always severity 'warning' (DQ-3)
}

export function validateSpecSetStatusAgreement(
  files: readonly SpecSetStatusFile[],
): SpecSetStatusResult;
```

Pure: no filesystem, no clock. Steps:

1. Keep only `requirements.md`, `design.md`, `tasks.md` (a new exported constant
   `SPEC_SET_STATUS_FILE_NAMES`). No `requirements.md` entry → `notApplicable: true`, no
   violations (FR-1, AC-4).
2. Read each kept file's literal status with a small helper, `literalStatusOf(f)`, which
   returns one of: `{ kind: 'ok', status }`, `{ kind: 'unreadable', reason }`. The reason
   is one of: the read failed (`readError`), the file has no frontmatter block, the
   `status:` line is absent, or its value (after `rawFrontmatterField`'s inline-comment
   strip) is not in `SPEC_STATUSES`. A file whose status cannot be read yields one
   `status.spec-set.unreadable` warning naming the file and the reason (FR-3, AC-5,
   invariant 2). This includes `requirements.md` itself: with no readable parent status
   nothing can be compared, so the function returns after reporting it.
3. Parent ranked (`LIFECYCLE_RANK[parent]` defined): each readable sibling whose rank is
   defined and strictly below the parent's yields one `status.spec-set.lag` warning (FR-2,
   AC-1, AC-3). A sibling at or above the parent passes (DQ-2). A sibling in a terminal
   (`archived`, `superseded`) under a ranked parent is unranked and passes: it is not
   behind on the lane, and FR-2 states the terminal rule only for a terminal
   requirements.md.
4. Parent terminal (`archived` or `superseded`, unranked): each readable sibling whose
   literal status differs from the parent's yields `status.spec-set.lag` (FR-2's terminal
   clause).

Each `status.spec-set.lag` message names the sibling file and both values; the fix hint
names the exact edit (FR-3): `Set design.md's "status:" to "implementing" to match
requirements.md. Status is excluded from the approval hash, so this edit never voids an
approval. (DQ-1 recorded option A: every file keeps status; removing it from siblings is a
separate spec.)` The rule doc comment states the split FR-5 requires, in one paragraph:
this rule compares LITERAL `status:` lines (the signpost a reader sees);
`status.cross-artifact.regression` compares DERIVED status and runs the opposite
direction; `status.mirror-drift` compares one file with its own derivation.

`LIFECYCLE_RANK` is reused, not copied, so FR-2's order and #277's order cannot drift. Its
comment header (which still reads `new < specifying < implementing < done`) gains
`planning`, matching the map it sits above.

### The reader: `readSpecSetStatusFiles` (FR-1, FR-5)

Lives in `packages/minspec/src/lib/spec-layout.ts`, directly after `readShardIdFiles`.

```ts
export function readSpecSetStatusFiles(dirPath: string): SpecSetStatusFile[];
```

- Returns `[]` unless `path.basename(dirPath)` matches `/^SPEC-\d+-/` (FR-1: a spec-set is a
  `SPEC-NNN-*/` directory; a flat single-file spec, or `specs/minspec/` holding SPEC-001's
  flat set, is never grouped) and `requirements.md` exists in it.
- For each of `SPEC_SET_STATUS_FILE_NAMES` that exists, reads it with `readDocumentText`
  (`text-io.ts`, so a CRLF checkout reads as LF and `FRONTMATTER_BLOCK_RE` still matches).
  A read that throws becomes `{ fileName, raw: undefined, readError: message }`: reported
  downstream, never swallowed (contrast `readShardIdFiles`, whose `catch {}` is acceptable
  only because its rule skips id-less files by design).

### Surface 1: the extension command (FR-5)

`packages/minspec/src/lib/spec-validator.ts`: `ValidateSpecOptions` gains
`specSetStatusFiles?: readonly SpecSetStatusFile[]`, documented in the same
no-false-positive pattern as `siblingShardFiles` (omit → the check is skipped).
`validateSpec` pushes `validateSpecSetStatusAgreement(...).violations` in a new numbered
step beside step 5 (shard-id consistency).

`packages/minspec/src/commands/validate.ts` passes
`specSetStatusFiles: readSpecSetStatusFiles(path.dirname(spec.filePath))`, beside
`siblingShardFiles`.

### Surface 2: the commit/CI path (FR-5)

`scripts/validate-frontmatter.ts` gains **Rule 27 (non-fatal, #972, SPEC-212)**, placed
after Rule 7 (the other dir-level split-layout rule). It lists `specsDir` with
`listCorpus('Rule 27', specsDir, '.md', false)`, takes the set of distinct
`dirname(file)` values, and for each runs
`validateSpecSetStatusAgreement(readSpecSetStatusFiles(dir))` inside
`eachFile('Rule 27', dirs, false, ...)`, emitting
`warn(\`spec-set-status ${relative(ROOT, dir)}: ${v.message}\`)`. Both functions are the same
ones the command calls (Goal G-6, the Rule 13 pattern: one rule, every surface), imported
from `../packages/minspec/src/lib/spec-validator` and `../packages/minspec/src/lib/spec-layout`.

## Decisions (recorded alternatives)

- **D1 Logic in existing modules, no new source file.** The spec is `implements: none`
  ("owned files are decided at Plan"). Putting the rule beside `validateStatusMonotonicity`
  and the reader beside `readShardIdFiles` keeps `implements: none` true, as SPEC-059 does
  for the same two modules, so this Plan needs no requirements.md edit and no re-approval.
  Rejected: a new owned `spec-set-status.ts` module. Cleaner ownership, but it would make
  `implements: none` false, and changing `implements:` alters the canonical hash, which
  voids the approval.
- **D2 Raw literal, not parsed frontmatter.** Measured point 6. Rejected: reading
  `parseSpec(...).frontmatter.status`, which reports an absent status as `new` and so can
  never make AC-5 pass.
- **D3 Validate command only, not Approve.** Approving `requirements.md` is the act that
  opens the lag, so at approve time the pre-approval set is normally in agreement and a
  warning there would describe the state the approval is about to change. Rejected: wiring
  it into `commands/approve.ts`, which would put a warning about the old state in front of
  the approver. Bumping siblings on approval is Out of scope in the spec.
- **D4 Two rule ids, both warnings.** `status.spec-set.lag` (a real lag) and
  `status.spec-set.unreadable` (no witness). Separate ids let a reader, and a later
  severity flip, treat "behind" and "cannot tell" differently. Both warn per DQ-3.
  Rejected: one id for both, which would hide which of the two a warning is.
- **D5 A terminal sibling under a ranked parent passes.** FR-2 defines the terminal rule
  only for a terminal requirements.md, and DQ-2 says ahead is not flagged. Today no set is
  in this shape (sweep, point 1).

## Backfill (FR-4, AC-6)

Each file's `status:` line becomes its `requirements.md` status. No other line changes; no
`phases:` block is edited (FR-4 asks for the status only).

| File (under `specs/minspec/`) | today | becomes |
|---|---|---|
| `SPEC-029-approval-staleness-ux/design.md` | implementing | done |
| `SPEC-029-approval-staleness-ux/tasks.md` | implementing | done |
| `SPEC-038-spec-code-ownership/design.md` | specifying | done |
| `SPEC-038-spec-code-ownership/tasks.md` | specifying | done |
| `SPEC-041-cross-artifact-staleness/design.md` | specifying | implementing |
| `SPEC-042-onboarding-checklist/design.md` | specifying | planning |
| `SPEC-042-onboarding-checklist/tasks.md` | specifying | planning |
| `SPEC-043-harness-refresh-manifest-consistency/design.md` | specifying | implementing |
| `SPEC-046-po-only-auto-approve/design.md` | specifying | planning |
| `SPEC-059-status-mirror-drift-gate/design.md` | specifying | planning |
| `SPEC-059-status-mirror-drift-gate/tasks.md` | specifying | planning |
| `SPEC-064-planning-lifecycle-status/design.md` | specifying | planning |
| `SPEC-076-headless-signpost-reader/design.md` | specifying | planning |
| `SPEC-211-shipped-guard-test-parity/design.md` | specifying | planning |
| `SPEC-211-shipped-guard-test-parity/tasks.md` | specifying | planning |

The table is a snapshot. The builder regenerates the list from Rule 27's own output at
build time (task 4.1), because sets change between this Plan and the build: any new lag on
`main` is fixed too, and a row that no longer lags is skipped.

## Files

| File | Change | Owned by |
|---|---|---|
| `packages/minspec/src/lib/spec-validator.ts` | rule, types, constant, option, `validateSpec` step | modifies, not owns (as SPEC-059) |
| `packages/minspec/src/lib/spec-layout.ts` | `readSpecSetStatusFiles`, `specSetApprovalSubject` | modifies, not owns |
| `packages/minspec/src/commands/validate.ts` | pass the option; derive an unsigned shard from its parent's record | modifies, not owns |
| `scripts/validate-frontmatter.ts` | Rule 27 | modifies, not owns (as SPEC-059) |
| `packages/minspec/tests/spec-set-status-agreement.test.ts` | new: T0 pure-rule cases + reader cases | test file |
| `packages/minspec/tests/validate-frontmatter-spec-set-status.test.ts` | new: Rule 27 subprocess cases | test file |
| `packages/minspec/tests/validate-command.test.ts` | the option is passed | test file |
| the 15 sibling files in *Backfill* | one `status:` line each | spec data |

Nothing under `.github/` or `.githooks/` changes, so no task needs a machinery merge.

## Risks

- **R1 The warning is ignored.** DQ-3's stated cost. Mitigation: the backfill leaves zero
  `spec-set-status` warnings on `main`, so the next one is new signal; task 4.3 asserts the
  count is zero. Escalation to error waits on approve-time sibling bumping (Out of scope).
- **R2 A concurrent pull request re-introduces a lag.** Every approval of a split-layout
  set does this by design until siblings are bumped. Accepted: that is the warning's job.
- **R3 Backfill conflicts with open pull requests editing the same 15 files.** The edits are
  one line each; a conflict is resolved by keeping the other side's body and this side's
  `status:` value. Task 4.1 lists open pull requests touching those paths first.

## Follow-ups (tracked)

- #3662 (status monotonicity rule never runs): #277's `validateStatusMonotonicity` has no
  production caller (measured point 4). Wire or delete; SPEC-212 does neither.
- Approve-time sibling bump, and later escalation to error: Out of scope in requirements.md;
  no follow-up filed, because nothing in the next 30 days depends on it.
