---
id: SPEC-070
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-070 is T4.)
# status and phases mirror requirements.md exactly as it stands. This file has no approval
# record of its own: only requirements.md is signed, so these two fields describe and never
# seal. requirements.md's own `phases:` is deliberately not advanced in this plan PR, so the
# plan PR touches no signed file.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval that cannot say what it covered is a false signpost
relates_to: [DR-096, DR-088, DR-034, DR-090, SPEC-017, SPEC-038, SPEC-051, SPEC-066, "#1800", "#1976", "#2008", "#3265", "#3283"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-070 - Tasks

The contract is [requirements.md](requirements.md); the mechanisms are in
[design.md](design.md). This file only orders the work into pieces small enough for one agent
run each, and says what an outside observer checks to call each one done. Where a task says
"mechanism: design section N", the design's text is the specification and this file does not
restate it.

**The order is load-bearing.** It is the design's slice order (design section 2), and every
task merges on its own with `main` green. The one rule the order exists to keep: nothing that
widens the hash (task 8.3) may merge before the witness is written (slice 5), seeded (slice 6)
and fails closed when absent (slice 7). The FR-1 latch from task 1.4 and 1.5 enforces that
mechanically; it is not left to the reader.

**Path convention, and why it matters for this spec in particular.** Only the 14 paths in
requirements.md's `implements:` and `affects:` appear here in backticks. Every other file is
named in plain text. The spec gate reads every backticked path in this file that resolves to
an existing source file as owned by SPEC-070 (the fuzzy arm of `declared_impl_files` in
`scripts/hooks/spec-gate.py`), and requirements.md keeps its declaration deliberately narrow
so that shared, high-traffic files (the validator, the facts CLI, the generated templates,
other specs' test suites) are never frozen for every other session. A backtick here would undo
that.

## Corrections to the design, found while writing these tasks

The design was written at HEAD `03a9c570`; these tasks were written at `c2f53d74`. Four things
moved, and each task below already applies the correction:

1. **The validator rule numbers the design uses are taken.** The design calls the FR-8.3
   corpus witness gate "Rule 20" and the FR-1 latch "Rule 21" (21a and 21b). Rules 20 to 24
   now exist in scripts/validate-frontmatter.ts for other specs, and Rule 20 is used twice.
   The builder takes the next free numbers at build time and names the spec in the comment
   (`SPEC-070 FR-8.3`, `SPEC-070 FR-1`). Below they are "the witness rule" and "the latch
   rule".
2. **Every line number the design cites has moved.** Locate by symbol (`declared_impl_files`,
   `owned_file_set`, `stripLifecycle`, `isValidRecord`, `normalizeRecord`, `hashLockReminder`,
   `_sidecar_fields`), never by the design's `:NNN`.
3. **Every count has moved.** The design measured 64 sidecars; there are 95 at `c2f53d74`
   (`find .minspec/approvals -name '*.json' | wc -l`), and 0 carry `ownedAtApproval`. Each
   task that depends on a population re-measures it at its own commit with the commands in
   requirements.md "Tests to Pass", as the spec requires, and quotes no number forward.
4. **AC-24 has no mechanism in the design** (the design's section 6 stops at AC-23). It is
   assigned to task 8.5 below.

The design's section 9 lists seven criteria "still refuted after the second adversarial
pass". The one in the FR-1 latch was closed in the design itself; the other six are given a
concrete fixture here: AC-6 in 5.2, AC-11 in 4.3, AC-16 in 8.1, AC-18's positive half in 7.2,
AC-19's creation half in 4.4, AC-22 clause 3 in 9.3.

## 0 - Preconditions (already satisfied at `c2f53d74`)

- [x] **0.1** The three once-untracked approval sidecars (SPEC-066, SPEC-067, SPEC-070) are
  committed (#2029, #2030, #2031, merged 2026-09-22).
- [x] **0.2** Slice 2 (the truthful reader, FR-3): #1976, the block-form list truncation fix,
  merged 2026-09-25. Its witness, packages/minspec/tests/ownership-list-parity.test.ts, is on
  `main`. Task 2.1 confirms AC-4 against it.
- [x] **0.3** The amendment batch (#2101, DR-096) is re-approved: the requirements.md sidecar
  records `approvedAt` 2026-09-30T22:07:36Z, and its `specHash` equals
  `python3 scripts/hooks/canonical.py --hash` run on requirements.md at `c2f53d74`. The
  design's "re-approval is a hard precondition for slice 8" is met.

## 1 - The canonical hygiene, the frozen basis and the FR-1 latch (pre-strip)

- [ ] **1.1** Blank-line terminator in both canonicalizer twins. `packages/shared/src/canonical.ts`
  and `scripts/hooks/canonical.py`: a blank line inside a stripped block is kept verbatim in
  the canonical output but no longer ends the block; the block ends at the first non-indented,
  non-blank line. Regenerate packages/minspec/src/lib/ci-review-templates.ts with
  `node scripts/gen-ci-templates.mjs`, never by hand. Add a fixture of a `phases:` block with a
  blank line inside it to the existing golden loop (packages/minspec/tests/fixtures/canonical/,
  read by packages/minspec/tests/canonical.test.ts) and a case to
  packages/shared/tests/canonical.test.ts.
  *Satisfies:* FR-2 (canonical hygiene, design section 2 slice 1 detail), INV-5.
  *Done when:* TS, Python and decoded `CANONICAL_PY` agree on the new fixture (the existing
  parity suite, packages/minspec/tests/canonical-parity.test.ts, stays green); and every
  `specs/**/*.md` hash is unchanged between the merge base and the head (computed with both
  twins; the PR body prints the count, which must be 0). A non-zero count stops the task:
  report it, do not proceed.
- [ ] **1.2** The frozen pre-strip hasher. Create `scripts/lib/canonical-pre-ownership-strip.ts`
  exporting `preStripSpecHash(raw)`: a verbatim copy of `stripLifecycle`, `canonicalizeSpec`,
  `specHash` and the four module-level regexes they read, as they stand after 1.1. It must not
  import `@aiclarity/shared` (FR-9.2) and must not be minted from requirements.md's `h_new`
  measurement shadow. Commit, beside each of AC-2's four fixtures in
  packages/minspec/tests/fixtures/canonical/, a `<name>.prestrip-sha256` file holding the
  64-hex literal `preStripSpecHash` gives for it (design section 6, AC-2).
  *Satisfies:* FR-9.2, FR-1, INV-4.
  *Test:* `packages/minspec/tests/rehash-ownership-strip.test.ts` (created here) asserts each
  golden literal, and that `preStripSpecHash(raw) === specHash(raw)` for every file under
  `specs/`, with a guard that the corpus walked is non-empty.
  *Done when:* both assertions are green and the frozen file imports nothing from the shared
  package (asserted in the same test by reading its import lines).
- [ ] **1.3** AC-2's three-way hash harness. Extend packages/minspec/tests/canonical.test.ts
  and packages/shared/tests/canonical.test.ts with the four named fixtures of design section 6
  AC-2 (all five keys, inline and block forms) and the harness: TypeScript hash, Python hash,
  and the hash of the decoded `CANONICAL_PY` all equal sha256 of the committed `.expected`
  canonical string. The control half (`status:` and `phases:` behaviour unchanged) is asserted
  now; the ownership half (all three differ from `.prestrip-sha256` exactly on the ownership
  keys) is written so that before task 8.3 it asserts equality with the golden literal, and
  task 8.3 flips it.
  *Satisfies:* AC-2 (control half and harness), INV-5.
  *Done when:* green on `main`, and a deliberately broken copy of one twin (strip one more key
  in the Python copy only, in a scratch run) turns it red. The red output is quoted in the PR
  body.
- [ ] **1.4** The FR-1 latch, vitest witness. In `packages/minspec/tests/ownership-witness-corpus.test.ts`
  (created here): the `stripIsLive(key)` probe pinned by the five-cell truth table, the three
  predicates `producerWritesWitness`, `gateReadsSnapshot` and `noOldBasisRecord`, and the four
  unconditional controls (null workspace, omitting producer, wrong reason, disagreeing basis).
  Mechanism: design section 6, AC-1 (its first part, before 6.1). The guarded block holds
  only the three calls and their `expect`s; half 1's workspace declares a non-empty structured
  set.
  *Satisfies:* FR-1, AC-1 (vitest witness, armed at task 8.3), INV-1.
  *Done when:* the truth table reads `status` and `phases` true, the three ownership keys
  false; all four controls are green; the guarded block is not entered (the probe is false)
  and the test says so in its title, so a reader cannot take a skipped body for a pass.
- [ ] **1.5** The FR-1 latch, validator witness. Add the latch rule (the design's Rule 21a and
  21b, next free numbers, FATAL) to scripts/validate-frontmatter.ts, reading the tracked
  sidecar tree as raw JSON keyed on the sidecar's location, never through `listRecords`.
  Mechanism: design sections 6.1 to 6.3. It carries its own counter of records examined and
  fails visibly when that is 0.
  *Satisfies:* FR-1, AC-1 (second, independent witness in the `lint:` job), INV-1.
  *Test:* the failing test of design section 6.4, in
  `packages/minspec/tests/ownership-witness-corpus.test.ts`, run against a fixture corpus
  (the validator's root is `process.cwd()`), plus a zero-record fixture that must fail.
  *Done when:* `npm run validate` is green on the live corpus and the rule reports a non-zero
  count; every case of section 6.3's five-case table produces the verdict the table names.

## 2 - The truthful reader (FR-3), already merged

- [ ] **2.1** Confirm AC-4 at the build commit: a spec declaring seven paths in block form
  resolves all seven in both the Python gate and the TypeScript validator, or is rejected with
  an actionable error. If packages/minspec/tests/ownership-list-parity.test.ts has no
  seven-item block case, add one there.
  *Satisfies:* AC-4, FR-3.
  *Done when:* the seven-item case is green, and fails when the gate's inline `fm_value`
  pattern is reverted to `\s*` in a scratch run (quoted in the PR body).

## 3 - The owned-set oracle (FR-5)

- [ ] **3.1** Create `packages/minspec/src/lib/owned-set.ts` with `structuredOwnedSet(frontmatter)`
  and `ownedSets(cwd, specPath, frontmatter)` returning `{ structured, full }`. Its own
  tokenizer, which keeps inline comment tokens exactly as the gate's `fm_value` does, and must
  not call `fmListField`. Normalisation follows design section 3 "Snapshot normalisation",
  steps 1 to 14, reusing `OWNED_SRC_EXT_PATTERN` and `OWNED_INFRA_PREFIXES` from
  packages/minspec/src/lib/ownership-path-rules.ts. No network, no vscode import (Tier 0).
  The file's header comment records the accepted inline-comment asymmetry between
  `fmListField` and `fm_value` and its consequence (design section 3), which is where FR-5's
  "closed or explicitly accepted" is discharged.
  *Satisfies:* FR-5.
  *Test:* `packages/minspec/tests/owned-set-parity.test.ts` (created here), fixture half: the
  seven named fixtures of AC-7 (inline comment on an ownership line, `implements: none`, a
  non-existent declared path, a `../` escape, an infra-prefix path, a non-source extension,
  the fuzzy `tasks.md` backtick arm), each compared with Python `owned_file_set` through one
  `importlib` subprocess (design section 7 rejects adding a CLI arm to the hook), plus named
  cases pinning the three engine divergences as design section 3 decides them.
  *Done when:* every fixture's TS set equals the Python set, and no test asserts order.
- [ ] **3.2** Corpus parity. In the same test file, compare `ownedSets` with `owned_file_set`
  for every T3/T4 spec file in the corpus, naming the symmetric difference on failure; add the
  separate pin that `structured` and `full` differ on
  specs/minspec/SPEC-017-trust-dashboard/requirements.md (structured empty, full set
  re-measured at the build commit, design measured 22).
  *Satisfies:* AC-7, INV-5.
  *Done when:* green on the live corpus with a non-empty count of specs compared, and the
  test fails when `python3` is absent rather than skipping (the existing parity suite's
  whole-corpus `it.skip` is the pattern not to copy).

## 4 - Inert drift machinery (FR-6, FR-7, OQ-5)

Every "after approval" fixture in this slice is a **state** fixture (design section 2,
"Slice 4 detail"): the post-edit spec is written first and the sidecar minted against those
bytes with `python3 scripts/hooks/canonical.py --hash`, with `ownedAtApproval` set to the
pre-edit set. Tests drive the real hook through `spawnSync`, following the hermetic pattern of
packages/minspec/tests/spec-gate.test.ts. Empty hook stdout is a failure, never a pass.

- [ ] **4.1** `declared_impl_files` in `scripts/hooks/spec-gate.py` gains one keyword argument,
  `include_fuzzy=True`, guarding only the fuzzy `tasks.md` block. No existing call site
  changes.
  *Satisfies:* FR-5 (structured set from the gate), groundwork for FR-7.
  *Test:* `packages/minspec/tests/ownership-drift-gate.test.ts` (created here): for every
  T3/T4 spec in the corpus, the default call returns exactly what it returned before (compared
  against the base-branch copy of the hook loaded from `git show`), and
  `include_fuzzy=False` equals 3.1's `structured` set.
  *Done when:* both green, and the existing spec-gate suite is unchanged and green.
- [ ] **4.2** Drift evaluation and the union freeze. One function in `scripts/hooks/spec-gate.py`
  returning a discriminated verdict (OQ-1: `ownership-drifted` now; `ownership.witness.missing`
  and `approval-quarantined` arms reserved for 7.1 and 8.1); for a record carrying a
  well-formed `ownedAtApproval` that differs from the current structured set, the freeze is the
  union of the snapshot and the current set; archived specs excluded via the gate's existing
  `explicit_terminal` value with a comment naming the hole (OQ-5). Its own accumulator and
  deny path. A record without `ownedAtApproval` is left exactly as today (absence fails closed
  only in 7.1).
  *Satisfies:* FR-6, AC-8, AC-9, AC-20.
  *Test:* `packages/minspec/tests/ownership-drift-gate.test.ts`: AC-8 (snapshot one path,
  spec now `implements: none`, a write to that path is DENIED), AC-9 (an added path freezes
  old and new, nothing outside the union), AC-20 (record stale through a body edit, then
  `implements: none`, the snapshot paths are still denied; sequence form from day one).
  *Done when:* all three green, AC-8 is red against a digest-scoped freeze in a scratch run
  (quoted in the PR body), and the deny reason names `ownership-drifted`.
- [ ] **4.3** Reach and per-record evaluation. Move the `owned_file_set` call above the phase
  band `continue`, so drift is evaluated for every record, including phaseless specs; the
  `seen_ids` dedup does not move. Mechanism: design section 6, AC-10 and AC-11.
  *Satisfies:* FR-7, AC-10, AC-11.
  *Test:* `packages/minspec/tests/ownership-drift-gate.test.ts`: AC-10, a spec with no
  `phases:` block whose snapshot differs from its declaration, denied through the real hook.
  AC-11's main clause (the fixture the design lacked): one spec id with two sibling files, each
  with its own approved sidecar, shaped on SPEC-051's real siblings (re-measure their owned
  counts; the spec measured 7, 2 and 2). Sibling A's snapshot drifts, sibling B's matches. A
  write to a path only A's union owns is denied naming A; a write to a path only B declares is
  not denied. AC-11's companions: the dedup is unmoved, and the blocking set for a corpus
  fixture holding an unapproved in-band sibling and an out-of-band sibling is byte-identical
  before and after this change.
  *Done when:* all green; the readdir-order caveat of design section 7 holds (the probe fails
  outright when it cannot build the hazardous order).
- [ ] **4.4** AC-19, the creation half (the design gave it no fixture). Fixture: an approved
  spec whose snapshot equals its structured set, and whose `tasks.md` names, in backticks, a
  path that does not yet exist. Create that file through the real hook with no frontmatter
  edit. Assert no `ownership-drifted` verdict and a blocking set identical to before.
  Anti-vacuity: the same fixture with that path added to `implements:` (state form) DOES
  produce `ownership-drifted`, proving the probe can see drift at all.
  *Satisfies:* AC-19 (creation half).
  *Test and done when:* both halves green in `packages/minspec/tests/ownership-drift-gate.test.ts`.

## 5 - The witness is written (FR-4, FR-4.6)

- [ ] **5.1** The record shape. Add `ownedAtApproval`, `implementsReasonAtApproval`,
  `rehashedAt`, `rehashedFrom`, `quarantinedHash` and `QUARANTINE_SENTINEL` to
  `packages/minspec/src/lib/approval.ts` exactly as design section 3 "The record" gives them;
  one `isValidRecord` arm and one `normalizeRecord` branch per field in
  `packages/minspec/src/lib/approval-store.ts`, with absence staying valid.
  *Satisfies:* FR-4 (read side), AC-5.
  *Test:* `packages/minspec/tests/owned-at-approval.test.ts` (created here): `writeRecord` then
  `readRecord` preserves a non-empty `ownedAtApproval`, asserted with a value that is defined
  on both sides; every sidecar in the live tree still reads back (the back-compat property).
  Extend the `rec()` fixture in packages/minspec/tests/approval-store.test.ts.
  *Done when:* green, and run through `npx tsc --noEmit` on the test file (tests sit outside
  every tsconfig include, so the build will not catch a missing field).
- [ ] **5.2** The producer. `approveSpec` writes `ownedAtApproval = structuredOwnedSet(fm)` and
  `implementsReasonAtApproval` (trimmed raw text, absent when empty, OQ-9: recorded, never
  denied on).
  *Satisfies:* FR-4 (write side), AC-6, OQ-9.
  *Test:* `packages/minspec/tests/owned-at-approval.test.ts`, running the real `approveSpec`
  on a temp workspace, asserting on the sidecar's raw file text. The discrimination fixture the
  design lacked: the spec declares, in block form, two real owned paths and then a bareword and
  a wrong-extension path. Three named assertions report which failure mode a red is: "constant
  empty" (the set is non-empty), "raw untokenised strings" (the bareword and the wrong-extension
  path are absent), "pre-FR-3 truncation" (the second block item is present). The whole set
  equals `structuredOwnedSet` for that spec. Re-run AC-9's release probe from 4.2 against a
  sidecar written by this real producer.
  *Done when:* all green, and each named assertion goes red alone against its own deliberately
  wrong producer in a scratch run.
- [ ] **5.3** The other read funnels keep the field: scripts/migrate-approvals.ts,
  packages/minspec/src/lib/approval-pr.ts and scripts/facts.ts each round-trip a record
  carrying a non-empty `ownedAtApproval` without dropping it (FR-4.5).
  *Satisfies:* FR-4 (FR-4.5).
  *Test:* one case per funnel, added to `packages/minspec/tests/owned-at-approval.test.ts`.
  *Done when:* all three green; a grep for `normalizeRecord`-style whitelist constructors in
  those three files finds none left that omits the field.
- [ ] **5.4** The trusted provenance block. `scripts/approval-provenance.py` reports an
  `ownedAtApproval` change explicitly and never emits the bare "only metadata such as
  approvedAt changed" line for it; regenerate `APPROVAL_PROVENANCE_PY` with
  `node scripts/gen-ci-templates.mjs`.
  *Satisfies:* FR-4.6, AC-21.
  *Test:* packages/minspec/tests/approval-provenance.test.ts: a PR rewriting the snapshot to
  `[]` and `implements:` to `none` reports the snapshot change; a genuinely metadata-only change
  still reports as metadata-only.
  *Done when:* both green.
- [ ] **5.5** Ship the producer. Rebuild the `.vsix` from the merge commit of 5.2
  (`npm run package` in packages/minspec) and say in the PR that the editor needs it installed
  before any further `MinSpec: Approve Spec` run: an approval taken on an older build mints a
  record without the witness, which slice 7 makes un-committable. Installing is host-only
  (the editor is VSCodium); the container cannot do it.
  *Satisfies:* design section 2 slice 5, operational.
  *Done when:* the `.vsix` is built and its bundle contains the literal `ownedAtApproval`
  (grep the string, not a symbol name; the bundle is minified).

## 6 - The seeded corpus (FR-9.10, seed mode)

- [ ] **6.1** The migration scaffold. Create `scripts/rehash-ownership-strip.ts`: root from
  `process.cwd()` only (design section 5 item 4), walking the sidecar tree as raw JSON (never
  `byId`, never `readRecord`), classifying each record (fresh or stale under each basis), a
  machine-readable JSON run report plus a human table, real exit codes, no bare `catch {}`.
  Wire `npm run migrate:ownership-hash` in package.json. No writes yet.
  *Satisfies:* FR-9 (structure), INV-1.
  *Test:* `packages/minspec/tests/rehash-ownership-strip.test.ts`, against a hermetic fixture
  corpus: classification counts, and a non-zero exit with a named reason on an unreadable
  sidecar.
  *Done when:* green; a dry run on the live tree prints its classification and writes nothing
  (`git status` clean afterwards).
- [ ] **6.2** Seed mode. Pre-flight, all aborts, never reports: `--expect-seed N` matches the
  classified count; for every record to seed, the TS structured set equals the Python gate's,
  symmetric difference named on failure; at least one seeded set non-empty; `migrated: true`
  count is 0 before and after; AC-15's seed form (the two bases agree on a known record, and the
  classified population is non-zero); abort and name it if any of the three OQ-6 sidecars
  classifies as a quarantine candidate. Writes preserve the raw bytes a library round-trip
  destroys; idempotency keys on `hasOwnProperty('ownedAtApproval')` and nothing else.
  Post-write: re-read the whole tree and run the real gate; drift is zero for every seeded
  record. Mechanism: design section 5, items 5 to 10.
  *Satisfies:* FR-9.10, AC-15 (seed mode), AC-17 (seed mode), AC-18 (negative half), INV-2,
  INV-3.
  *Test:* `packages/minspec/tests/rehash-ownership-strip.test.ts`: each abort has a fixture
  that trips it; a second run writes nothing and exits 0; a run interrupted after N writes
  and resumed completes the rest; for every sidecar in the fixture tree, the field is present
  if and only if the record was old-fresh (iterating the tree, not the run's own list).
  *Done when:* all green, each abort quoted red once in the PR body.
- [ ] **6.3** Run the seed on the live corpus. Data-only PR: the changed `.minspec/approvals`
  sidecars, nothing else. Re-measure the population with requirements.md's classification
  command first and pass it as `--expect-seed`. The PR body carries the JSON run report and
  the one command a reviewer runs to re-derive it.
  *Satisfies:* FR-9.10, INV-4.
  *Done when:* the run exits 0, `git diff --stat` touches only sidecars, every sidecar's
  `specHash` is byte-unchanged, and the gate reports zero drift on the whole tree.

## 7 - Absence fails closed (FR-8)

- [ ] **7.1** The gate denies a missing or malformed witness. In `scripts/hooks/spec-gate.py`,
  an approved record without a well-formed `ownedAtApproval` (absent, a bare string, `null`,
  `{}`, or an array holding a non-string) resolves `ownership.witness.missing`, denies, and the
  reason names the missing witness. The TypeScript reader in
  `packages/minspec/src/lib/approval-store.ts` classifies the same files the same way.
  Mechanism: design section 6, AC-12 and AC-13.
  *Precondition:* the day-one witness-missing population on the live tree is measured at 0 and
  the count is in the PR body (task 6.3 merged).
  *Satisfies:* FR-8.1, FR-8.2, AC-12, AC-13, INV-1.
  *Test:* `packages/minspec/tests/ownership-drift-gate.test.ts`: AC-12 in both directions (the
  spec still declaring its paths, and rewritten to `implements: none`), state form; AC-13 one
  fixture per malformed shape, Python and TS verdicts compared.
  *Done when:* all green; a warn-only or passing outcome fails each case.
- [ ] **7.2** The witness rule. A FATAL rule (the design's Rule 20, next free number) in
  scripts/validate-frontmatter.ts: an approved record without a well-formed `ownedAtApproval`
  is an error; it counts what it examined and fails visibly on 0.
  *Satisfies:* FR-8.3, AC-14, AC-18 (positive half, the half the design moved here and never
  wrote).
  *Test:* `packages/minspec/tests/ownership-witness-corpus.test.ts`: AC-14 on a fixture corpus
  (fails with one witness-less approved record, passes when seeded); AC-18 positive, on the
  live tree: zero approved records resolve `ownership.witness.missing`, and every seeded
  `ownedAtApproval` equals `structuredOwnedSet` for its spec at this commit.
  *Done when:* all green and `npm run validate` reports the rule with a non-zero count.
- [ ] **7.3** AC-19's mirror: a spec with an empty structured set and a non-empty fuzzy set
  (SPEC-017's real shape) seeded with `[]` is not a missing witness and does not drift.
  *Satisfies:* AC-19 (mirror).
  *Test and done when:* green in `packages/minspec/tests/ownership-drift-gate.test.ts`, with
  an anti-vacuity half asserting that fixture's full set is non-empty.

## 8 - The basis change (FR-2, rehash mode, FR-11)

- [ ] **8.1** Rehash mode, merged inert. In `scripts/rehash-ownership-strip.ts`: the two-bases
  pre-flight (at least one known record classifies differently, AC-15 rehash form), the
  new-basis liveness abort, `rehashedAt` and `rehashedFrom` written, `migrated` untouched, the
  quarantine write path behind `--expect-quarantine N` (sentinel hash, real hash moved to
  `quarantinedHash`, `approvedBy` and `approvedAt` byte-preserved), the improve exemption keyed
  on `rehashedAt`, and the per-mode status-vector assertion. Before 8.3 the live run aborts on
  the two-bases check, which is the designed behaviour. Mechanism: design section 5.
  *Satisfies:* FR-9, AC-15 (rehash), AC-16, AC-17 (rehash), INV-2, INV-3.
  *Test:* `packages/minspec/tests/rehash-ownership-strip.test.ts`, with the "new" hasher
  injected as a test-only parameter (never exported as a minting basis, as AC-1's
  disagreeing-basis control does). AC-16 with all three cohorts, including the one the design
  lacked: a fixture tree holding a record added-after-approval (quarantined, non-approving
  through both `resolveStatus` and the Python gate), a genuinely stale record (untouched), and a
  record already carrying `rehashedAt` (reported as already migrated, not touched). The report
  names the three distinctly. AC-17: a second run reports 0 quarantine candidates and writes
  nothing; a resumed run never overwrites `rehashedFrom`.
  *Done when:* all green, and the live dry run aborts naming the two-bases check.
- [ ] **8.2** The adopter-facing verdicts. In `scripts/approval-provenance.py`: OQ-2(i), when
  the head record's `rehashedFrom` equals the base hash, emit the truthful re-stamp line instead
  of "was ALREADY STALE at base"; OQ-2(ii) (accepted 2026-09-25), the third verdict
  `PRE-STRIP BASIS - matches under the pre-ownership-strip hash; re-approve to move it forward`,
  using a pre-strip Python hasher shipped as a new managed template (registered in
  packages/minspec/src/lib/template-registry.ts, membership-count pin moved). Regenerate the
  templates. Before 8.3 the verdict never fires on live data, because both bases agree.
  *Satisfies:* FR-11, OQ-2.
  *Test:* packages/minspec/tests/approval-provenance.test.ts with an ownership-bearing fixture
  hashed by the pre-strip copy: the third verdict, never green; a re-stamped record: the
  re-stamp line, not the false staleness line.
  *Done when:* green; packages/minspec/tests/managed-script-dependencies.test.ts green with the
  new template counted.
- [ ] **8.3** The strip, atomic. One PR: widen the strip in `packages/shared/src/canonical.ts`
  and `scripts/hooks/canonical.py` to the five keys (`status`, `phases`, `implements`,
  `affects`, `implements_reason`; block keys `phases`, `implements`, `affects`,
  `implements_reason`), with the bare-key branch on the `phases:` model, not the `status:` one;
  correct both files' docstrings to the five-key set; regenerate the templates; run
  `npm run migrate:ownership-hash` in rehash mode with the re-measured `--expect-quarantine`
  and commit the re-stamped sidecars; flip 1.3's ownership half. The FR-1 latch from 1.4 and
  1.5 arms in this merged state and must be green.
  *Satisfies:* FR-2, AC-1 (armed), AC-2 (ownership half), AC-3, INV-3, INV-5.
  *Test:* AC-3 (a bare `implements:` key over indented children leaves no orphan child line;
  red against a `status:`-branch implementation) in packages/minspec/tests/canonical.test.ts
  and packages/shared/tests/canonical.test.ts; canonical-parity green; the latch's vitest and
  validator witnesses green with the probe true.
  *Done when:* CI is green on the merged state, the latch reports zero old-basis approved
  records, zero newly-stale approved sidecars, and the PR body carries the run report and its
  one-command re-derivation. Merges through the repo's merge funnel; a human reads the run
  report (design section 2 slice 8).
- [ ] **8.4** The sequence-form re-runs. Now that an ownership edit is hash-neutral, re-run AC-8,
  AC-9 and AC-12's second direction as genuine sequences: mint the sidecar, rewrite
  `implements:`, assert the canonical hash is byte-identical across the rewrite and the verdict
  and freeze scope are unchanged from the state-form result.
  *Satisfies:* AC-8, AC-9, AC-12 (sequence form, design section 2 slice 4 detail).
  *Test and done when:* green in `packages/minspec/tests/ownership-drift-gate.test.ts`.
- [ ] **8.5** What adopters receive. AC-23: in the managed-template scaffold harness
  (packages/minspec/tests/managed-script-dependencies.test.ts), execute the scaffolded
  `canonical.py --hash` on an ownership-bearing fixture and require it to equal the shipped
  TypeScript `specHash` and differ from `preStripSpecHash`; in
  packages/minspec/tests/approval-provenance.test.ts, run the scaffolded provenance copy against
  a temporary git repository holding an old-basis record and assert the `PRE-STRIP BASIS`
  verdict exactly. No scaffolded spec-gate is asserted, because none ships. AC-24 (no design
  mechanism existed): read `scripts/hooks/canonical.py`'s docstring as `renderManagedFile`
  emits it, and assert it names the five-key set and makes no claim false in a repo holding
  only the scaffolded files (or attributes it to the minspec repo in DR-090 section 2's form).
  This is a check written here, since SPEC-066's prose-vantage gate is not built.
  *Satisfies:* FR-11, AC-23, AC-24, INV-6.
  *Done when:* all green, each asserting on executed or rendered output, never on file
  existence.

## 9 - The prose catches up (FR-10, OQ-4 ordering (ii), accepted 2026-09-23)

- [ ] **9.1** The free correction. `hashLockReminder` in `packages/minspec/src/lib/approval-store.ts`
  stops saying that editing anything other than `status`/`phases` voids the approval; update
  its two pins in packages/minspec/tests/spec-manager.test.ts in the same change (the "ANY edit
  voids" negative keeps holding; the `status` and `phases` positive becomes the five-key
  wording).
  *Satisfies:* FR-10, AC-22 (first clause).
  *Done when:* both pins green with the new wording, and a newly approved spec's reminder
  carries no two-key claim.
- [ ] **9.2** The non-spec sites. Correct the two-key strip-set claims in the comments of
  packages/minspec/src/lib/spec.ts and scripts/facts.ts (comment-only, one line each), confirm
  8.3 already corrected both canonicalizer docstrings, and amend DR-034 at its strip-set line
  by an amendment to that record, not an edit to SPEC-070.
  *Satisfies:* FR-10, AC-22 (the unconditional half).
  *Test:* a case in `packages/minspec/tests/ownership-witness-corpus.test.ts` running
  requirements.md's non-spec grep and asserting no surviving two-key claim at the six named
  sites.
  *Done when:* green; the grep's output is in the PR body.
- [ ] **9.3** The census rule, made able to fail (AC-22 clause 3; the design gave it a
  warn-only line). Check in an elected-file manifest (a plain list of the approved spec files
  the plan elects to correct, chosen per OQ-4 ordering (ii): files whose two-key claim the
  strip makes literally false). Add a FATAL rule to scripts/validate-frontmatter.ts: for every
  manifest entry, requirements.md's frontmatter-site and body-site predicates find no two-key
  claim; anti-vacuity, the manifest is non-empty and every entry exists. The census over
  approved files not in the manifest stays a warn line that shrinks as files are re-approved.
  *Satisfies:* FR-10, AC-22 (clause 3).
  *Test:* `packages/minspec/tests/ownership-witness-corpus.test.ts`, on a fixture corpus:
  red with one elected file still carrying the claim, red on an empty manifest, green when
  corrected.
  *Done when:* green on the fixture corpus. On the live tree the rule is red until 9.4 lands,
  so 9.3 and 9.4 merge together or the rule lands with an empty-manifest exemption removed in
  9.4; the builder picks one and says which in the PR.
- [ ] **9.4** Correct the elected spec files. Each correction stales that spec's approval, so
  each one needs the founder's re-approval; no agent mints it (INV-2). Fix both wordings in
  any file already being edited (OQ-4 refinement), never laundered through the migration
  commit.
  *Satisfies:* FR-10, AC-22 (elected lists empty).
  *Done when:* 9.3's rule is green on the live tree, and each changed spec's approval is
  re-taken by the founder.
- [ ] **9.5** Correct SPEC-070's own requirements.md last, then the founder re-approves it.
  *Satisfies:* FR-10.
  *Done when:* the census reports SPEC-070 clean and its sidecar hash matches again.

## Verify (every task)

- [ ] `npm test`, `npm run lint`, `npm run build` and `npm run validate` green at the task's
  head; CI runs `npx vitest run`, not `npm test`, so a `pretest` hook is not a gate.
- [ ] Any task that changed packages/minspec/src rebuilds the `.vsix`.

## Follow-ups (tracked)

- The TypeScript arm for the swallowed-gate-signal lint (design section 9): #2008. Until it
  lands, the latch rule and the witness rule carry their own examined-record counters.
- The accepted inline-comment asymmetry between the validator's and the gate's tokenizers:
  recorded in `packages/minspec/src/lib/owned-set.ts`'s header by task 3.1.
- The engine divergences, the OQ-6 reachability question and the OQ-8 batched-ack affordance
  for the #1649 backfill: #3283.
