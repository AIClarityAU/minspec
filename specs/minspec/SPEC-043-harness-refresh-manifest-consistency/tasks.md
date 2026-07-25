---
id: SPEC-043
type: tasks
# 🔒 Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: implementing  # Tasks phase complete; Implement phase done (PR open)
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — derived-state truthfulness (harness-refresh hash manifest)
depends_on: [SPEC-043]  # this spec's own requirements + Plan
---

# SPEC-043 — Task Breakdown

Ordered per [design.md](./design.md) §Slice plan. **Order is load-bearing: Slice 1 before
Slice 2** (requirements R2 — the gate must not land before the fix that makes it green). Each
group ends suite-green (INV-5) before the next starts. Traces to
[#890](https://github.com/AIClarityAU/minspec/issues/890) (surfaced by sealbox PR #21).

> **Precondition:** run in a worktree off `origin/main` (rule #8). All `lib/**` changes keep
> Tier-0 purity (no vscode/network — INV-4). The merge DECISION path in `mergeFile` is untouched
> (INV-5); only the hash RECORDING changes.

## Group 1 — Slice 1: consistency by construction (FR-1, FR-2, FR-4, FR-6)

- [x] **1.1** Add `sectionHashesFromMarkdown(content)` to `merge-refresh.ts` — `parseSections` →
  `hashSection` per section, **first-occurrence-wins** for duplicate headings (mirrors the
  preserve-pass rule at :216-218). This is the one shared recording path (D2).
- [x] **1.2** `scaffold.ts` `refreshHarnessFiles`: drop the in-loop `allHashes[...] = newHashes`
  recording (:854) and the file-absent `buildSectionHashes` recording (:847); keep `mergeFile` +
  `fs.writeFileSync(merged)` and the merge-decision `oldHashes` reads unchanged (INV-5). The
  loaded manifest becomes DECISION input only (`priorHashes`), never the recorded manifest.
- [x] **1.3** `scaffold.ts` `generateHarnessFiles`: drop the `buildSectionHashes` recording
  (:766-767); keep the create-if-absent writes.
- [x] **1.4** `scaffold.ts` `seedConstitution` (D8): stop feeding the manifest — drop the
  `buildSectionHashes(parseSections(merged))` re-hash (:71); it keeps WRITING `constitution.md`,
  the final-disk pass records it through the shared first-wins helper.
- [x] **1.5** Reorder both write paths so the manifest is recorded and `saveHashes` runs **LAST**
  — after `seedConstitution` **and** `generateSlashCommandShims` (D7/FR-6). Add
  `recordVerifyAndSaveManifest(rootDir)`: for each present `TEMPLATE_OUTPUT_PATHS` file record
  `sectionHashesFromMarkdown(disk)`; prune keys not in the tracked set (FR-3a); then persist.
- [x] **1.6** T0/T1/T3 tests (`tests/merge-refresh-890.test.ts`): INV-1 (manifest == hash(disk)
  incl. AGENTS.md post-injection), INV-2 (refresh-vs-refresh, zero bumps), AC-1/sealbox #21
  (internal `\n\n\n` — red on pre-normalization recording), AC-7 (AGENTS.md guidance — red on
  pre-injection recording), the `sectionHashesFromMarkdown` truth-table.
- [x] **1.7** ✅ Checkpoint: `npx vitest run` green; existing `merge-refresh*`/`scaffold` tests
  stay green (INV-5). This slice ALONE fixes the bug.

## Group 2 — Slice 2: fail-closed self-check (FR-3, FR-3a, INV-3)

- [x] **2.1** Add `verifyGeneratedHashesConsistent(rootDir, hashes)` + `ManifestInconsistency` to
  `merge-refresh.ts`: re-read each present tracked file, compare recorded vs on-disk section
  hashes, return violations. Absent file → skip (FR-3a). Deterministic, offline (INV-4).
- [x] **2.2** `scaffold.ts`: call the gate inside `recordVerifyAndSaveManifest` **after** the
  final-disk recording and **before** the moved `saveHashes`; a non-empty result THROWS a
  descriptive error → nothing persisted, last-good manifest intact (D4). `init.ts` renders the
  thrown error via its existing try/catch — no `init.ts` change (D3).
- [x] **2.3** T0 gate tests: `verifyGeneratedHashesConsistent` returns `[]` on a fresh tree, flags
  a drifted section, skips an absent-file entry (AC-8); the write-path guard does not clobber the
  last-good manifest on an injected mismatch (AC-3).
- [x] **2.4** ✅ Checkpoint: full `packages/minspec` suite green.

## Notes / deviations

- **Pre-existing constitution-proposer non-idempotence (out of scope, filed separately).** A
  fresh-tmp refresh grows a DRAFT `Honor CLAUDE.md` principle every run (constitution ↔
  `principles`-context feedback), so a naive refresh-vs-refresh over a bare scaffold is not a
  fixed point. Verified identical on pre-change `main`, so it is orthogonal to this spec (which
  is about the hash MANIFEST being a faithful function of disk). INV-2/INV-4 tests neutralize it
  with a human-content constitution — the exact "no content-changing write path" precondition the
  invariant is stated against. Follow-up issue filed for the seeder loop.
