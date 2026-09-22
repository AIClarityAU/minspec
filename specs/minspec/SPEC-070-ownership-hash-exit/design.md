---
id: SPEC-070
type: design
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a shipped file asserting a false fact is a false signpost
---

# SPEC-070 - Ownership leaves the hash, an approved-set snapshot carries the alarm (Design)

> Plan artifact for [SPEC-070](./requirements.md), following the `design.md` convention (SPEC-004, SPEC-022, SPEC-038).
>
> **Judges disagreed on the winning draft**: the sequencing-safety lens picked the sequencing draft, the AC-coverage and honesty lenses both picked the invariant draft. The spine below is the **sequencing draft's order** - which the AC-coverage judge endorsed while voting against it ("take Draft 1's slice order and graft Draft 2's harnesses into it") - because only that order never leaves a written snapshot unenforced, with the invariant draft's test harnesses grafted in and the migration-risk draft's early blank-line fix, per-record idempotency marker and new-basis-liveness abort taken wholesale. Every fatal flaw the three judges named is repaired below rather than restated, and the repairs are called out inline as **[fix]**. The adversarial holes are NOT all repaired: two verification rounds ran, the first found 24 uncovered criteria and 17 false `file:line` citations and those were repaired, the second left seven criteria still refuted. They are listed in section 9 under "Still refuted after the second adversarial pass". The one that was in this document's own central FR-1 latch has since been closed: a third round produced three independent corrections, refuted all three, and composed the surviving clauses into the latch in section 6.
>
> **Provenance of every number and every citation here.** All counts were measured by me at HEAD `03a9c570`, first-hand, not quoted forward from the spec (which requires exactly that at requirements.md:866-867) and not inherited from a sibling draft. Every `file:line` was opened at that HEAD before it was written; an earlier round of this document shipped 17 citations that did not survive that check, and the ranges below are the corrected ones. Where a claim is inferred rather than executed, it says so in the same sentence. Note that `origin/main` has since advanced to `77aae68a`; the implementation re-measures at its own commit.

---

## 1. Approach

Ownership leaves the canonical hash in exactly one commit, and every artifact that has to survive that commit is built, seeded and proven **before** it, while the hash is still an independent witness for the snapshot: mint the frozen pre-strip hasher while "pre-strip" is simply "now", arm the drift machinery while the snapshot population is provably zero (measured: `grep -rl '"ownedAtApproval"' .minspec/approvals --include='*.json' | wc -l` returns **0** of **64**), write the producer, seed the corpus under the still-live basis, make absence fail closed over an already-seeded corpus, and only then widen the strip and re-stamp.

The ordering is not intended but enforced, by an execution probe landed in the first slice and asserted by two independent witnesses in two CI jobs. I verified both jobs and both steps carry no `if:`: job `lint:` at `.github/workflows/ci.yml:68` with `Validate frontmatter` / `npm run validate` at `:85-86`, and job `test:` at `:154` with `Test with coverage` / `npx vitest run --coverage ...` at `:183-184`. The `if:` conditions that do exist in those jobs belong to other steps - `Lint` carries `if: needs.paths.outputs.docs_only != 'true'` at `:82`, and `Generate badge JSON` carries a branch condition at `:187`. That distinction is load-bearing here: slice 8's PR is data plus canonicalizer, and a sidecar-only follow-up would be a docs-only change, so the one step that skips on docs-only is deliberately not one of the two witnesses.

The single deviation from the sequencing draft is that **seeding and arming FR-8 are two merges, not one** - **[fix]** for the sequencing judge's fatal flaw, which was that the merge making a missing witness fail closed was the same merge that removed missing witnesses.

---

## 2. Slices

Preconditions that gate the whole plan, both measured at HEAD:

- ~~**Commit the three untracked approval sidecars.**~~ **DONE** - #2029, #2030 and #2031 merged 2026-09-22T07:38Z, so all three are on `main` and this precondition is satisfied. Kept here because the reasoning below is what made it a precondition, and the same hazard returns for any future approval that sits unmerged: `find .minspec/approvals -name '*.json'` returns **64**; `git ls-files '.minspec/approvals/*.json'` returns **61**. The delta is SPEC-066/067/070's sidecars, currently untracked. SPEC-070 is in-band (`plan: in-progress`, so `phase_intent_status` puts it in the implementation range and the band `continue` at `scripts/hooks/spec-gate.py:500-501` does not skip it), so on any checkout that cannot see the untracked file its record reads unapproved and **all 14 of its declared paths freeze** - including `packages/minspec/src/lib/owned-set.ts`, the first file this plan creates. (Measured: SPEC-070's structured declaration resolves to 14 paths.) This also explains the three drafts' disagreeing censuses: they counted a different tree.
- ➡️ **Batch the requirements.md corrections into one edit and re-approve immediately.** Four are needed and all four are verified defects (section 8). Any such edit stales SPEC-070 and freezes those 14 paths until re-approved, so it is one edit, not four.

| # | Slice | Goal | Files | ACs | Starts when |
|---|---|---|---|---|---|
| 1 | **Canonical hygiene, the frozen basis, and the FR-1 latch** | Settle the blank-line block terminator while it costs 0 hash moves; mint the pre-strip hasher while it still equals the live one; land the ordering gate, green and non-vacuously, before the act it polices | `packages/shared/src/canonical.ts`, `scripts/hooks/canonical.py`, `packages/minspec/src/lib/ci-review-templates.ts` (**regenerated**, never hand-edited), `packages/minspec/tests/fixtures/canonical/`, `packages/shared/tests/canonical.test.ts`, `packages/minspec/tests/canonical.test.ts`, `scripts/lib/canonical-pre-ownership-strip.ts`, `scripts/validate-frontmatter.ts` (Rule 21), `packages/minspec/tests/ownership-witness-corpus.test.ts` | **AC-1** (lands green pre-strip, arms at slice 8); **AC-2** control half plus the three-way harness | Sidecars committed. Nothing else |
| 2 | **The truthful reader** - land #1976 | No snapshot is ever computed by a parser that truncates a block-form list to its first item | *(no new work)* `scripts/hooks/spec-gate.py`, `packages/minspec/src/lib/spec-validator.ts`, `scripts/facts.ts`, `packages/minspec/tests/ownership-list-parity.test.ts` | **AC-4** | **IN FLIGHT**: PR **#1976** on `fix/1961-block-form-list-truncation`, open, `ai-review:pass`, unmerged (PR state as given to this Plan, not re-read from the git host). I verified the branch locally at `947917ee`: 1 commit ahead of this document's HEAD `03a9c570` and 8 behind it, so it needs a rebase - and further behind whenever `origin/main` has advanced past that commit (it is 1 ahead / 17 behind `origin/main` at `77aae68a`). ➡️ Human merge keystroke, never `--admin` |
| 3 | **The owned-set oracle** (FR-5) | One TypeScript function that agrees with `owned_file_set` on the whole corpus and exposes the structured and full sets separately | `packages/minspec/src/lib/owned-set.ts`, `packages/minspec/tests/owned-set-parity.test.ts` | **AC-7** incl. the structured-vs-full pin | Slice 2 on `main` (may be *built* earlier against the post-#1976 tokenizer; it may not *merge* earlier, because AC-7 is corpus-wide parity and would be red) |
| 4 | **Inert drift machinery** (FR-6, FR-7, OQ-5) | Evaluate drift per record, above the phase band, with its own accumulator and deny path, while the snapshot population is zero | `scripts/hooks/spec-gate.py`, `packages/minspec/tests/ownership-drift-gate.test.ts` | **AC-8, AC-9, AC-10, AC-11, AC-19** (creation half), **AC-20** | Slice 3 |
| 5 | **The witness is written** (FR-4 + FR-4.6) | `ownedAtApproval` produced by the real `approveSpec` with the right *value*, surviving every read funnel and visible to the merge-gating provenance block | `packages/minspec/src/lib/approval.ts`, `packages/minspec/src/lib/approval-store.ts`, `scripts/approval-provenance.py`, `packages/minspec/src/lib/ci-review-templates.ts` (regenerated), `scripts/migrate-approvals.ts`, `packages/minspec/src/lib/approval-pr.ts`, `scripts/facts.ts`, `packages/minspec/tests/owned-at-approval.test.ts`, `packages/minspec/tests/approval-store.test.ts`, `packages/minspec/tests/approval-provenance.test.ts` | **AC-5, AC-6, AC-21**, plus AC-9's release probe re-run against the real producer | Slices 2 and 3. **Operational:** the producer ships inside the extension, so the `.vsix` is rebuilt in this slice and ➡️ the founder installs it (the editor is VSCodium, the CLI is `codium`, and there is no CLI in this container). An approval taken on a stale build mints a witness-less record that slice 7 makes un-committable |
| 6 | **The seeded corpus** (FR-9.10, seed mode) | Every old-fresh record carries the witness, written at the last moment the hash can independently prove it right. Data only | `scripts/rehash-ownership-strip.ts`, `packages/minspec/tests/rehash-ownership-strip.test.ts`, `package.json`, `.minspec/approvals/**/*.json` | **AC-18** negative half, **AC-17** (seed-mode idempotency and resume). AC-18's POSITIVE half moves to slice 7 - **[fix]** for the sequencing hole: its mechanism is Rule 20 plus the `ownership.witness.missing` verdict, and neither exists until slice 7, so slice 7 re-runs it rather than slice 6 asserting a check that cannot exist yet | Slice 5 (the seed must write the same value the producer writes) and slice 4 (so every snapshot is enforced the moment it exists) |
| 7 | **Absence fails closed** (FR-8, all three clauses) | A missing or malformed witness is non-approving at the gate and un-committable in the corpus, over a corpus that is already fully seeded | `scripts/hooks/spec-gate.py`, `scripts/validate-frontmatter.ts` (Rule 20), `packages/minspec/tests/ownership-witness-corpus.test.ts`, `packages/minspec/tests/ownership-drift-gate.test.ts` | **AC-12, AC-13, AC-14, AC-19** (SPEC-017 mirror) | Slice 6, with the day-one witness-missing population **measured** at zero before the merge rather than asserted inside it. **[fix]** for the sequencing judge's fatal flaw |
| 8 | **The basis change** (FR-2 + rehash mode + FR-11) | Ownership leaves the hash, every old-basis record is re-stamped in the same merged state, and the FR-1 latch's assertions arm | `packages/shared/src/canonical.ts`, `scripts/hooks/canonical.py`, `packages/minspec/src/lib/ci-review-templates.ts` (regenerated), `scripts/approval-provenance.py`, `scripts/rehash-ownership-strip.ts`, `packages/shared/tests/canonical.test.ts`, `packages/minspec/tests/canonical.test.ts`, `packages/minspec/tests/canonical-parity.test.ts`, `packages/minspec/tests/managed-script-dependencies.test.ts`, `packages/minspec/tests/approval-provenance.test.ts`, `.minspec/approvals/**/*.json` | **AC-1** (armed), **AC-2** (ownership half), **AC-3, AC-15, AC-16, AC-17** (rehash), **AC-23** | Slices 1, 6, 7 all on `main`. ➡️ Human merge on a run report the reviewer can re-derive in one command |
| 9 | **The prose catches up** (FR-10) | Remove every statement the change makes literally false, at the lowest human re-approval cost, never laundered through the migration commit | `packages/minspec/src/lib/approval-store.ts`, `packages/minspec/tests/spec-manager.test.ts`, `scripts/facts.ts`, `scripts/validate-frontmatter.ts`, a checked-in elected-file manifest, the approved spec files the census names, `specs/minspec/SPEC-070-.../requirements.md` (last) | **AC-22** | Slice 8, plus ➡️ the OQ-4 decision and the human re-approvals that follow. INV-2 forbids an agent minting any of them |

### Slice 1 detail (canonical hygiene and the frozen basis)

- **Blank-line terminator: FIX, and fix it here.** Today a block ends at the first non-indented line and a blank line is not indented (`INDENTED_LINE_RE = /^[ \t]+/`, `packages/shared/src/canonical.ts:48`, with the comment at `:65-66` stating it outright: "A blank line is NOT indented -> ends block"). The rule adopted is the migration-risk draft's placement with the invariant draft's precise formulation, because the naive version is a second invisible basis change: **a blank line inside a stripped block is kept verbatim in the canonical output but does not terminate the block; the block ends at the first non-indented, non-blank line.**

  Re-measured here at HEAD `03a9c570` over the 104 `.md` files under `specs/`: **0** hashes move under today's two-key strip, **2** move under the widened five-key strip - `specs/minspec/SPEC-025-constitution-proposer/requirements.md` and `specs/minspec/SPEC-060-build-provenance-stamp/requirements.md`, both carrying a folded `implements_reason: >-` (each at `:15`) with a blank line inside it (SPEC-025 `:19`, SPEC-060 `:18`). The two key sets are the spec's own (requirements.md:959-960: `KEYS = ('status','phases','implements','affects','implements_reason')`, `BLOCK = ('phases','implements','affects','implements_reason')`). Re-measure as 0 before landing; anything non-zero stops the slice.

  Doing it here keeps **AC-2's control clean of the change it controls**: a `phases:` block containing a blank line hashes differently before and after this fix (true by construction of the rule, not a measurement), so landing it inside slice 8 would entangle the control with the widening and make the run report unable to attribute a moved hash to one cause or the other.

  ➡️ **Honest residual, stated as already-shipped rather than pending** - **[fix]** for the INV-6 sequencing finding. `scripts/hooks/canonical.py` is a managed template (`packages/minspec/tests/managed-script-dependencies.test.ts:131` asserts it lands in a freshly scaffolded tree), and this slice regenerates `CANONICAL_PY` with it. So slice 1 ships an **adopter-visible canonical-form change** eight slices before OQ-2 answers the adopter question it belongs to. Local blast radius is 0, measured; an adopter's is unmeasurable from here. This is a deliberate choice, not an oversight, and OQ-2's decision text below presents it to the founder as **already in adopters' hands**, so the decision on OQ-2(ii) is taken with that fact visible rather than implied.

- **The frozen copy is minted after the blank-line fix, in the same commit, before the corpus pin.** `scripts/lib/canonical-pre-ownership-strip.ts` is a verbatim copy of the hasher as it stands at HEAD - the private helper `stripLifecycle` (`packages/shared/src/canonical.ts:60-83`), `canonicalizeSpec` (`:89-123`) and `specHash` (`:126-128`), together with the four module-level regexes they read (`FRONTMATTER_RE` `:41`, `STATUS_LINE_RE` `:44`, `PHASES_LINE_RE` `:46`, `INDENTED_LINE_RE` `:48`) - exported as `preStripSpecHash(raw)`, pinned two ways: hardcoded 64-hex golden digests for a fixture set, and a corpus assertion that `preStripSpecHash(raw) === specHash(raw)` for every file under `specs/`. That equality can only be written while it is true, and on the day the strip lands it inverts to "equal iff the spec carries none of the five stripped keys" - the same function validated on both sides of the change. It is explicitly **not** minted from the spec's `h_new` measurement shadow (forbidden at requirements.md:1006-1007) and **not** an import of `@aiclarity/shared` (FR-9.2; `scripts/migrate-approvals.ts:42` is the anti-pattern).

  The symbol names above matter because FR-2 rule 1 cites the same `:60-83` range as `stripLifecycle` (requirements.md:226); an earlier draft labelled that range `canonicalizeSpec`/`specHash`, which left one range under two names across the two documents.

- **The FR-1 latch and validator Rule 21** land here. Their mechanisms are section 6, AC-1.
- **AC-2's three-way hash harness and its four committed fixtures** land here. Mechanism: section 6, AC-2.

### Slice 4 detail (the reach move, and the shape every "after approval" fixture must take)

- **The hoist.** `files = owned_file_set(cwd, sp, fm)` moves from `scripts/hooks/spec-gate.py:510` to immediately after `phases = parse_phases(fm)` at `:474`, above the band `continue` at `:501`. Mechanism and proof of value-preservation: section 6, AC-10.
- **One additive parameter, no split.** `declared_impl_files(cwd, fm, spec_dir_abs, include_fuzzy=True)` gains one keyword argument guarding only the fuzzy block at `:366-373`. Every existing call site keeps its exact signature and value. This is required by AC-7's structured-set parity as well as by AC-10, and it is new work the earlier slice-4 scope did not name.
- **Every "after approval" criterion is a STATE fixture before slice 8 and a SEQUENCE fixture at slice 8.** AC-8, AC-9, AC-12 (second direction) and AC-20 all describe a spec edited *after* approval. Before the strip lands, `canonicalize_spec` removes exactly `status` and `phases` (`scripts/hooks/canonical.py:32-33`, `_strip_lifecycle` at `:37-53`), so any `implements:` rewrite moves the hash and the record resolves `stale` at `spec-gate.py:480-481`, not `approved`. A slice-4 or slice-7 test that performs the edit literally is asserting against the wrong verdict, and its deny reason reads "approval stale - spec edited since approval" (`_blocker_reason`, `spec-gate.py:301-302`) rather than the verdict the AC names. No draft noticed this.
  - **Pre-strip (slices 4 and 7): state form.** The fixture writes the post-edit spec first and mints the sidecar against those bytes - `python3 scripts/hooks/canonical.py --hash <spec>`, the CLI at `canonical.py:88-94` - with `ownedAtApproval` set to the pre-edit set (AC-8, AC-9) or omitted entirely (AC-12). The record then resolves `approved` and the state under test is exactly the one the AC describes. What this form does **not** prove is that the edit happened after the signature; say so rather than letting a reader assume otherwise.
  - **Slice 8: sequence form.** Once the strip is live the `implements:` edit is hash-neutral, so each of these tests re-runs as a genuine sequence: mint the sidecar, rewrite `implements:`, then assert (i) the canonical hash is **byte-identical across the rewrite** and (ii) the verdict and freeze scope are unchanged. Assertion (i) is also the cheapest available witness that the strip actually widened, and it goes red on any merged state where slice 8's `canonical.py` change is missing - a second, independent reading of the FR-1 latch that costs nothing extra.
  - **AC-20 is the one member of the family that is sequence-form from day one** and needs no slice-8 re-run: its subject is a record that has already *gone* stale through a body edit, and a body edit moves the hash under both bases.

### If #1976 does not land

FR-3 is a binding precondition on any snapshot *write*, so the stop line is between slices 3 and 4 on one side and slices 5+ on the other. Slices 1 and 4 may proceed (slice 4 is inert by construction - zero snapshots exist - and its fixtures use inline form). Slice 3 may be built but not merged, because AC-7 is corpus-wide TS/Python parity and a correct TypeScript twin is red against the truncating gate.

**Slices 5 onward are hard-blocked**: the first snapshot write is permanent and signed, and I verified the defect is still live on `main` - `scripts/hooks/spec-gate.py:113` is `m = re.search(r'^' + re.escape(key) + r':\s*(.+?)\s*$', text, re.M)`, where `\s*` crosses the newline, so `fm_list`'s inline arm (`:128-133`) matches `- a` for a block-form list and returns at `:133`, before the block branch at `:134-146` is ever reached. Executed at HEAD rather than read: for a two-item block list, `fm_value(fm, 'implements')` returns `'- packages/a.ts'` and `fm_list` returns `['-', 'packages/a.ts']`.

If the merge keystroke stays unavailable, the unblocking move is to rebase and re-open the same reviewed patch from an up-to-date base - still a human merge, never `--admin`, never OQ-3 option (b), which the spec closes on its own terms.

---

## 3. Data shapes, exactly

### The record

```ts
// packages/minspec/src/lib/approval.ts - the existing interface is at :60-69 (8 fields).
export const QUARANTINE_SENTINEL = 'quarantined' as const; // never a 64-hex digest

export interface ApprovalRecord {
  readonly specPath: string;
  readonly specHash: string;        // or QUARANTINE_SENTINEL - see below
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly tier: Tier;
  readonly migrated: boolean;
  readonly baselineBlob: string;
  readonly reviewStart?: string;

  /** FR-4 + FR-5. The resolved STRUCTURED owned set (`implements:` + `affects:`, merged)
   *  at approve time: repo-relative POSIX, deduped, sorted. NEVER the fuzzy tasks.md arm.
   *  Absent OR malformed = no witness (FR-8.1). Present-and-empty `[]` is a real, distinct
   *  third state: "the signature covered a spec that declared nothing". */
  readonly ownedAtApproval?: readonly string[];

  /** OQ-9, pending founder. The trimmed `implements_reason:` text at approve time, for the
   *  `implements: none` cohort whose owned sets are permanently empty. Recorded for INV-4
   *  reconstructibility; it does NOT arm a PreToolUse deny. */
  readonly implementsReasonAtApproval?: string;

  /** FR-9.5. Written only by the migration. Also the FR-9.4 improve-exemption key. */
  readonly rehashedAt?: string;
  readonly rehashedFrom?: string;

  /** FR-9.4. Holds the record's original hash when `specHash` is the sentinel. */
  readonly quarantinedHash?: string;
}
```

`isValidRecord` (`packages/minspec/src/lib/approval-store.ts:96-112`) gains one arm per field, **absence staying VALID** - the file's own warning at `:89-94` records that a required-string check "would silently drop every existing approval", and the live population proves it: **0 of 64** sidecars carry `ownedAtApproval` today.

```ts
(r.ownedAtApproval === undefined ||
  (Array.isArray(r.ownedAtApproval) && r.ownedAtApproval.every((x) => typeof x === 'string'))) &&
(r.implementsReasonAtApproval === undefined || typeof r.implementsReasonAtApproval === 'string') &&
(r.rehashedAt === undefined || typeof r.rehashedAt === 'string') &&
(r.rehashedFrom === undefined || typeof r.rehashedFrom === 'string') &&
(r.quarantinedHash === undefined || typeof r.quarantinedHash === 'string')
```

Every one of these also needs its own conditional branch in `normalizeRecord` (`:121-136`): it is a whitelist constructor rebuilding from 7 named fields (`:124-130`) plus one conditional `reviewStart` spread (`:132-134`), with **no `...r`**, so a field validated and not listed there is discarded one function after it validates, with no error - and `readRecord` is `isValidRecord(parsed) ? normalizeRecord(parsed) : undefined` (`:153`), with no `readRawRecord` anywhere in the repo (grep returns 0). Absent must normalise to **absent**, never to `[]` - `[]` is a signed state and inventing it mints a witness. Contrast `baselineBlob`, which `:130` deliberately coerces absent to `''`; copying that pattern here is the forged-witness shape.

### Snapshot normalisation

The stored value is produced by `structuredOwnedSet(frontmatter)` and must reproduce `consider()` (`scripts/hooks/spec-gate.py:341-359`) step for step, storing the **post-transform** string, because the gate applies no `normpath` and set equality is on the raw stored string:

1. Tokenize `implements:` then `affects:` and **merge into one flat set** (OQ-7), matching the gate's merge into its single accumulator (`declared_impl_files`, `spec-gate.py:306-374`; the structured loop is `:361-364`), through the post-#1976 tokenizer.
2. `strip` -> strip `"` -> strip `'` -> `strip` (`spec-gate.py:342`). **Not `.trim()`**: Python's `str.strip()` and JS `.trim()` differ in both directions and this is the *first* step, so neither side is the fail-safe one. Use an explicit Python-equivalent character class.
3. Reject if empty or if the token contains no `/` (`:343`). This runs **before** the backslash conversion, which is load-bearing: `packages\a.ts` is rejected, `a/b\c.ts` is not.
4. `p = token.replace(/\\/g, '/')` (`:345`).
5. Strip exactly **one** leading `./` (`:346-347`). (`././a.ts` -> `./a.ts`, which can then never match a relpath - dead weight, faithfully reproduced.)
6. Reject if `p` starts with `/` or `../`, or any segment is `..` (`:349`).
7. Reject the infra prefixes, **case-sensitive** (`:351` against `_INFRA_PREFIXES` at `:296`: `node_modules/ out/ dist/ coverage/ .git/`).
8. Reject unless the source-extension pattern matches the end (`:353` against `_SRC_EXT_RE` at `:293-295`), reusing `OWNED_SRC_EXT_PATTERN` (`packages/minspec/src/lib/ownership-path-rules.ts:23`) and `OWNED_INFRA_PREFIXES` (`:30`) rather than re-spelling them, so the existing string-equality pin at `packages/minspec/tests/ownership-path-parity.test.ts:46` (`expect(OWNED_SRC_EXT_PATTERN).toBe(gateSrcExtPattern())`) keeps covering them and that file - owned by SPEC-038, outside this allowlist - is never edited.
9. **No** existence check. Structured tokens are `require_exists=False` (`:361-364`), so the existence filter at `:357` never applies to them.
10. **No** `normpath`, **no** lowercasing, **no** collapse of `//` or `/./`, **no** trailing-slash handling. `packages//a.ts` and `packages/./a.ts` are stored unchanged, exactly as the gate stores them.
11. Dedup **exact-case**. `owned_match` folds case only at match time, in a throwaway set (`:391-401`), so `packages/A.ts` and `packages/a.ts` are two members; lowercasing on insert would shrink the TypeScript set relative to Python.
12. Sort ascending for **diff stability only**. Every comparison is set membership: `Array.prototype.sort()` is UTF-16 code-unit order and Python's `sorted()` is codepoint order, and they differ above the BMP. No test may assert order.
13. `none` is **not** special-cased. `implements: none` yields one token with no `/`, which dies at step 3. The gate has no `'none'` comparison anywhere, and adding one would break set equality for `implements: [none, packages/a.ts]`.
14. The fuzzy `tasks.md` backtick arm (`:366-373`, `_CODE_SPAN_RE` at `:297`) is **excluded, always**. `ownedSets().full` includes it; `.structured` never does.

### The three engine divergences, decided rather than deferred

**Non-ASCII tokens are accepted, not rejected** - **[fix]** for the migration-risk draft's fatal flaw, which designed a permanent TS-only divergence into the very function AC-7 exists to prove equal and then relied on today's zero population to keep the test green. Three engine divergences exist: Python `re.I` folds U+017F into the pattern's `s` where JS `/i` does not; `str.strip()` vs `.trim()`; `$` before a trailing newline. Only the first can *widen* Python relative to TypeScript, so the TypeScript twin tests `p` **and** `p.replace(/ſ/g, 's')` against the same pattern string, which widens TS to match Python without touching the pattern and therefore without breaking the string-equality pin at `ownership-path-parity.test.ts:46`.

The other two are accepted, fail-closed under the drift comparison (they can only manufacture spurious drift and an over-wide freeze, never a silent release), and filed as a sibling of the same engine-divergence class. Measured at HEAD: of **466** structured tokens in the corpus, **6 are non-ASCII** - all U+2014 em-dashes the tokenizer lifts out of trailing prose, in SPEC-040 (x2), SPEC-044, SPEC-046, SPEC-051 and SPEC-062 - and **zero** of them reach the extension pattern, because none contains a `/` and every one dies at normalisation step 3. Zero corpus hits *on the divergence*, not zero non-ASCII tokens. The U+017F divergence is executed, not assumed: Python `re.search(pattern, 'a.ſh', re.I)` matches and the identical JS `/i` regex does not.

**The inline-comment divergence FR-5 names first is closed for the pair AC-7 compares, and explicitly accepted for the pair it does not** - **[fix]**. FR-5 requires two known Node/Python divergences to be "closed or explicitly accepted" (requirements.md:363-364). The three engine-level ones are closed above; the *first one the spec names* (`:365-370`) was unmentioned by every draft, and it lands inside the very function AC-7 exists to prove equal.

*What it is, verified.* The gate's inline arm is `fm_value` (`scripts/hooks/spec-gate.py:112-114`), which does no comment handling at all, so `implements: packages/a/src/x.ts # see packages/b/src/y.ts` tokenizes at `:130` to `['packages/a/src/x.ts', '#', 'see', 'packages/b/src/y.ts']`. `#` and `see` die at the no-slash filter (`:343`), and **`packages/b/src/y.ts` survives every filter and enters the owned set**. The validator's twin `fmListField` (`packages/minspec/src/lib/spec-validator.ts:736-768`) takes its inline value from `rawFrontmatterField` (`:428-437`), which calls `stripInlineComment` at `:435`, and yields only `packages/a/src/x.ts`. The asymmetry is deliberate and documented at `:739-743` ("Deliberately fail-safe vs the gate's `fm_value` (which keeps comment tokens)").

*It is inline-arm-only, which no draft said.* Both block arms strip a trailing comment with the identical `(?:#.*)?$` construct - `spec-gate.py:137` and `:141` against `spec-validator.ts:753` and `:754`. A block-form ownership list diverges on nothing.

*It survives #1976.* That PR replaces `\s*` with `[ \t]*` in both tokenizers and touches neither comment path - read on `fix/1961-block-form-list-truncation` at `947917ee`, where the two changed lines are exactly `m = re.search(r'^' + re.escape(key) + r':[ \t]*(.+?)\s*$', text, re.M)` and ``const lineRe = new RegExp(`^${key}[ \t]*:[ \t]*(.*)$`, 'm');``. The line numbers above move when it lands; the divergence does not.

*The decision: `owned-set.ts` writes its own tokenizer and KEEPS comment tokens. It MUST NOT call `fmListField`.* Reuse is the obvious move and it is the wrong one: the FR-5 function's entire contract is equality with `owned_file_set`, and a narrower snapshot on a comment-carrying spec is exactly the permanent false `ownership-drifted` FR-5 predicts - the snapshot omits `packages/b/src/y.ts`, the gate's current set contains it, set inequality is drift forever, and the FR-6 union freeze widens on every edit. With zero corpus hits today the corpus half of AC-7 is green either way, which is precisely why this had to be decided in the design and pinned by a fixture rather than discovered later.

*What is NOT changed, and why that still satisfies FR-5.* `spec-validator.ts`'s `fmListField` keeps stripping comments. The divergence is **closed** for the pair AC-7 compares (`ownedSets()` against `owned_file_set`, both keeping comment tokens) and **explicitly accepted, with its consequence named**, for the pair AC-7 does not compare (`fmListField` against `fm_value`), where the asymmetry stays deliberately fail-safe, feeds no freeze and no snapshot, and can only make `validateOwnership` under-count a comment path rather than emit a false violation. Reversing it would undo a documented #812 decision inside a shared validator this spec deliberately leaves undeclared (requirements.md:1036-1041). The residual is one sentence: a spec whose ownership line carries a path-shaped comment has that path frozen by the gate and uncounted by the validator, before this change and after it. ➡️ That residual needs a filed follow-up issue, per DR-023's forward rule; a prose-only consequence is a leak.

### `implementsReasonAtApproval`

`trim()` the raw frontmatter value; store `undefined` when the key is absent or the trimmed value is empty. No case folding, no whitespace collapsing, no unfolding of YAML folded scalars - the raw text as the frontmatter reader returns it, so a reader can diff it against the current file without a second parser.

### Quarantine

`specHash` becomes `QUARANTINE_SENTINEL`; the real hash moves to `quarantinedHash`; `approvedBy` and `approvedAt` are preserved byte-for-byte. This is non-approving through **the only mechanism either reader has**: `resolveStatus` compares nothing but the hash (`packages/minspec/src/lib/approval.ts:483-490`, the comparison at `:489`) and the Python gate does `rec.get("specHash") == cur` (`spec-gate.py:478`) after a shape check that accepts any string (`:276-278`, literally `if not isinstance(rec.get("specHash"), str): return None`). A sentinel can never equal a sha256 digest. Because the record stays readable, `_blocker_reason` (`spec-gate.py:300-303`) gains a quarantined branch, since today it would say "approval stale - spec edited since approval", which for a quarantined record is false.

---

## 4. Open Questions

**OQ-1 - one verdict or two? Answer: two verdict strings, one code path. Designer's call.**
`ownership-drifted` and `ownership.witness.missing` (plus `approval-quarantined`) come from one function returning a discriminated union, so they sit in one if/else and cannot drift apart structurally. They share the snapshot predicate, the union computation and the `owned_match` pass; only the reason string and the freeze scope differ.

**OQ-2 - what do adopters get? SPLIT. One half ships, one half is PENDING FOUNDER, and one adopter-visible change has ALREADY shipped by the time the question is asked.**

The three drafts all answered this in the design's own voice with a basis-aware provenance verdict; the honesty judge is right that doing so contradicts an approved spec, so it splits:

- **(i) The `was_stale` falsehood, designer's call, ships in slice 8 - narrowed, because the original formulation had no mechanism.** `scripts/approval-provenance.py:202` computes `was_stale = old_hash != spec_hash(spec_at_base)`. It hashes BASE's spec with HEAD's hasher, so the re-stamp PR's own merge-gating review block would report all of its records as "was ALREADY STALE at base" (`:203-207`), which is false. The earlier fix - "treat a record as not-stale-at-base if it matches **either** basis at base" - is **[fix]**ed here because it is not buildable: the script's only hasher is `from canonical import spec_hash` (`:50`), the frozen copy this design creates is TypeScript, a scaffolded `canonical-pre-strip.py` would add a managed template and move the count pin at `packages/minspec/tests/managed-region-enumeration.test.ts:93` (`expect(MANAGED_REGION_TEMPLATES.length).toBe(30)`), and an inline third canonicalizer is a fourth twin under INV-5 with parity coverage nobody budgeted.

  **The buildable form: suppress the claim, do not re-verdict it, and key the suppression on data the record already carries.** When the head record carries `rehashedFrom` **and** `rehashedFrom == old_hash`, the staleness question is not decidable by this tool (it holds one hasher and the other basis is gone), so it emits a truthful line naming the re-stamp instead of the false one - and emits nothing else, leaving the `MATCHES`/`MISMATCH` verdict at `:184-187` untouched. `_sidecar_fields` (`:100-110`, today returning only `(specPath, specHash)`) is the single extension point; `new_raw` is already in hand at `:156-159`. For an adopter, who has no re-stamp and therefore no record carrying `rehashedFrom`, the behaviour is byte-identical to today, which is what keeps it inert under INV-6 and leaves AC-23's documented behaviour unchanged.

- ➡️ **(ii) The head verdict, PENDING FOUNDER.** The recommendation is a third verdict - a record valid under the frozen pre-strip basis reports `PRE-STRIP BASIS - matches under the pre-ownership-strip hash; re-approve to move it forward`, distinct from MATCHES and never green - rather than `MISMATCH - a real finding`. **The cost, named because a recommendation without one is advocacy:** it needs a second basis inside a Python script, which is the same unbuildable requirement (i) just retreated from, so accepting (ii) means accepting a managed `canonical-pre-strip.py` template, a moved count pin and a fourth twin under INV-5; and it changes what MinSpec ships into every opted-in adopter repo, contradicting the last paragraph of **FR-11** (requirements.md:625-631) and **AC-23** (`:827-832`). Amending an approved spec's FR and AC is a human act, and reversibility in this repo does not reverse what already shipped into adopters. **Assumed meanwhile so work is not blocked:** build only (i); slice 8's AC-23 assertion is written against FR-11 **as it stands today** (`MISMATCH - a real finding`), so the slice ships either way. If the founder declines (ii), OQ-2 resolves as option **(c)**, accept the break and document it, which needs no further code.

- ➡️ **(iii) Already shipped, stated so the decision is informed.** The blank-line terminator fix (slice 1) regenerates `CANONICAL_PY` and therefore changes the canonical form every adopter scaffolds. Locally it moves 0 hashes, measured; in an adopter repo it moves the hash of any spec with a blank line inside a stripped block, with no gate, no snapshot and no migration. The founder is deciding (ii) with (i) and this already in adopters' hands.

Options (a) and (b) are rejected outright in section 7.

**OQ-3 - fix the parser or mandate inline form? Answer: option (a). Designer's call; the only human act is the merge keystroke.**
This resolves the pair the spec forbids the Plan choosing both of (requirements.md:271, "**Option (b) is incompatible with OQ-4's recommended ordering and the Plan must not choose both.**"): taking (a) closes (b), which would refuse SPEC-058/059/060/061's block-form `affects:` (`:272-276`) and therefore refuse the re-approvals OQ-4 ordering (ii) requires. Note that the spec assigns the choice itself to Clarify (`:269`), and Clarify is `done`; this Plan records the choice and its consequence rather than reopening it. The work is already built and reviewed as #1976; the Plan's FR-3 task is rebase, re-review, merge - not "write a parser fix".

➡️ **OQ-4 - who pays for the prose correction? Recommendation: ordering (ii). PENDING FOUNDER - the spec says so in its own words at requirements.md:1108-1109 ("A human must confirm they accept that, because the alternative is 19 re-reads").**
Migrate first, then correct, and correct only the claims the change makes **literally false**. **Refinement at zero extra human cost:** for a file already being corrected, fix **both** wordings in the same edit, since one edit stales the approval whether it changes one line or two - which drops the knowingly-retained-false population without buying a single extra re-approval.

**Free corrections, costing no re-approval:** `hashLockReminder` (`packages/minspec/src/lib/approval-store.ts:50-58` - `:54-55` becomes incomplete and `:56`, "Editing anything else here, or the body, voids the approval", becomes FALSE), its two pins at `packages/minspec/tests/spec-manager.test.ts:946` (`expect(src).not.toMatch(/ANY edit voids/i)`, which must keep holding) and `:948` (`expect(src).toContain('`status` and `phases`')`, which the widened strip falsifies), the hardcoded claim at `scripts/facts.ts:318` (`console.log(' (none - no status:/phases: block present)')`), and the frontmatter comments in `specs/minspec/design.md:5` and `specs/minspec/tasks.md:5`, which both say "Editing voids approval (hash in .minspec/approvals.json -> stale)", naming the *legacy* store that `spec-manager.test.ts:940-941` already pins against. Both those records are stale under both bases (measured: the three stale records at HEAD are `specs/minspec/SPEC-007-epic-grouping/requirements.md`, `specs/minspec/design.md`, `specs/minspec/tasks.md`), so correcting them costs **nothing** - and, measured, neither matches the spec's own `LOCK` census predicate at requirements.md:924, so correcting them moves the AC-22 census by **zero**. They are corrected because they are free and false, not to make a number go down.

**Re-derived at HEAD with the spec's own predicates** (requirements.md:924-926), rather than quoting the spec's figures forward: **17** frontmatter reminder sites (**15** approved), of which **12** carry the old "ANY edit voids" wording (**11** approved); **11** body-prose sites (**8** approved); union **25** files, **20** approved. The spec's 23/19 was measured at `719878d6`; the drift is licensed at requirements.md:866-867.

**The cost of the recommendation:** the older "ANY edit voids approval" wording survives in the remaining approved files until each is next re-approved for its own reasons, and it is already wrong today and becomes more wrong. Against that, it gets three things instead of a re-read each: made un-creatable going forward by the corrected reminder, made visible and auto-shrinking by a census line in `npm run validate`, and tracked on #1510 (which `approval-store.ts:47-48` already records as the open half). **Assumed meanwhile:** slices 1-8 proceed; slice 9 does not start until the decision lands.

**OQ-5 - does drift freeze an ARCHIVED spec? Answer: exclude explicitly, with two additions. Designer's call.**
Excluded at the drift check using the `explicit_terminal` value the gate already computes at `spec-gate.py:487-488` (`literal_status` at `:487`, `explicit_terminal` at `:488`; the comment explaining them is at `:485-486`), with a comment naming the hole. The justification is stronger than the OQ assumes: archiving **already** releases a spec's entire owned set today, via `phase_intent_status` and the band `continue` at `:499-501`, so excluding archived preserves the status quo rather than opening a new one. Two additions: the hole is a **validator WARN** when an archived spec's snapshot differs from its current structured set, so it is visible in `npm run validate`; and it is **not** named in the deny message, which would teach the bypass to the person being denied.

➡️ **OQ-6 - the three unreachable sidecars. PENDING FOUNDER, because the recommendation here INVERTS the spec's, and the spec's own text calls its recommendation "an explicit, human-authorized exception, not a rule" (requirements.md:1130-1131).**
The three are `specs/minspec/design.md`, `specs/minspec/tasks.md` (both measured stale under both bases) and `specs/agent-execute/SPEC-019-execution-substrate/design.md` (measured approved and old-fresh). **Recommendation: do NOT retire them.** Treatment, stated per record so it cannot contradict itself the way two drafts' answers did: **seed** the SPEC-019 record exactly like any other old-fresh record, and leave the two stale ones untouched and unseeded - FR-9.10's licence (requirements.md:552-555) forbids seeding a non-old-fresh record, and FR-8.3 fires only on *approved* records, so the two stale ones never reach the missing-witness trigger.

**Why, measured:** zero records would improve under the two bases today, so none of the three is a quarantine candidate, and the permanent-dead-end that retirement exists to avoid is never purchased - while its cost, destroying three genuine `approvedBy`/`approvedAt` sign-offs that FR-9.4 protects everywhere else, is paid immediately. The "no human exit" hazard is nil for the seeded one: `specs/agent-execute/SPEC-019-execution-substrate/design.md` declares neither `implements:` nor `affects:` (read, frontmatter `:1-6`), so its seeded value is `[]`, and an empty snapshot against an empty current structured set is explicitly not drift (FR-6.3). **The cost of the recommendation:** three sidecars stay in the tree that no `MinSpec: Approve Spec` run can ever refresh, so they accumulate as permanent Rule 10 warnings (`scripts/validate-frontmatter.ts:437-451`; `listOrphanedRecords` at `:446`, the `warn` at `:447`) and the reachability question stays open rather than being closed by deletion.

**Assumed meanwhile:** keep Rule 10's existing non-fatal warn, file the reachability question as its own issue, and add the fail-closed escalation: if the migration ever classifies one of the three as a quarantine candidate, the run aborts and names it for a human rather than writing a permanent non-approving state with no exit. **Re-decide only if** the migration's classify pass flags one of the three as would-improve. That same record also grounds the "carry `tier` forward verbatim" rule: its sidecar stores `"tier": "T4"` while its spec file carries no `tier:` key at all (both read at HEAD), so recomputing would silently downgrade a T4 sign-off.

**OQ-7 - does the snapshot record which key a path came from? Answer: no. Designer's call.**
Snapshot the merged structured set only, matching the gate's own flat merge exactly (`spec-gate.py:361-364` into the single `files` accumulator returned at `:374`). Two fields would invite a per-key comparison, which is the collapsed-predicate slip, and they double the six-site surface. The stated cost stands with one correction: for pre-strip records the per-key provenance is recoverable from git history (the keys are still in the hashed bytes today), so "unrecoverable" is too strong; it becomes unrecoverable for records minted after slice 8.

**OQ-8 - what is the batched ack? Answer: build nothing here. Designer's call.**
FR-9.10 makes the day-one population zero and re-approval is already the stronger per-record exit, named in the deny reason. Filed as the affordance the #1649 backfill will need, with the constraints recorded: per-record rows the human reads, one write, a keyboard path on the list, no select-all.

➡️ **OQ-9 - does the sidecar record `implements_reason`? Recommendation: record it, do NOT deny on it. PENDING FOUNDER.**
`implementsReasonAtApproval?: string` lands in slice 5 either way; only the gate-deny arm is deferred, and adding it later is small and reversible. **This declines the spec's own recommendation**, so the founder decides rather than the designer.

**Why, and what it costs:** measured at HEAD `03a9c570`, of the **38** in-band T3/T4 spec files, **14** declare `implements: none`, and **9 of those 14** have a completely empty full owned set - so `owned_match(rel, set())` can never match and a deny has nothing to block. The remaining **5** would freeze their fuzzy `tasks.md` paths on a *prose* edit, which is the noise class that trains people to ack without reading - and that same ack is what AC-8's removal alarm depends on. (The spec's "13 of the 34" at requirements.md:409, repeated at `:1186`, is 14 of 38 at this HEAD; licensed drift, not a defect.) The cost of not denying is a documented hole: a signed `implements: none` justification can be rewritten with neither the hash nor the drift check noticing, caught only by a validator error and the merge-gating provenance block's substantive-field diff. **Assumed meanwhile:** record and report, do not deny.

---

## 5. Riskiest step and its mitigation

**The corpus seeding write (slice 6): one automated pass placing a machine-computed witness under every human signature in the tree, which the gate then enforces forever.**

Not the basis change, and the discriminator is **detectability, not reversibility**. An incorrect re-stamp stays detectable forever: `rehashedFrom` plus the committed frozen hasher lets anyone recompute the old basis and check the licence. An incorrect **seed** is not detectable after the strip, because nothing else records what the signature covered - that is FR-1's irreversibility argument applied to the *value* rather than to the ordering. Both failure modes are silent: a **wider** snapshot is a false freeze across the corpus, discovered as a mass block the next morning; a **narrower** one under-covers permanently, under a human's name, with no later reader able to tell it from a correct one.

Mitigation is a stack, not a step:

1. **Run it before the strip.** Pre-strip, old-basis freshness is a live, recomputable fact, so a wrong seed is both detectable (compare the snapshot against the still-hashed declaration) and correctable (re-run; seeding is idempotent). FR-1 permits this explicitly.
2. **The parser lands first.** Seeding through the truncating reader signs a set the author never declared, and the FR-6 union then reads the missing items as ownership *removal* on the next parser fix.
3. **Drift is already armed** (slice 4), so a snapshot that disagrees with the current structured set announces itself the moment it is written instead of sitting inert for two merges. This is the spine's single biggest advantage over the two seed-first drafts.
4. **The root contract, stated - [fix].** `scripts/rehash-ownership-strip.ts` derives its root from `process.cwd()` and from nothing else, exactly as `scripts/validate-frontmatter.ts:42` does (`const ROOT = process.cwd();`). That is what makes a hermetic fixture corpus possible at all, and without it AC-15, AC-16, AC-17 and AC-18 have no writable test. In particular the run never resolves `.minspec` through `git rev-parse --git-common-dir` (which escapes a fixture created inside a worktree into the real repo) and never reads the gitignored `.minspec/approvals.json`.
5. **Pre-flight aborts, never reports.** `--expect-seed N` must match the classified count; the TypeScript structured set must equal the Python gate's set for **every** record it will seed, with the symmetric difference named on failure; at least one seeded set must be non-empty (anti-vacuity); the `migrated: true` count must be 0 before and after (measured 0 of 64 at HEAD, and DR-034's ratchet requires it). A seeder that agrees with itself proves nothing - the independent witness is the gate that will enforce the value.
6. **Post-write verification through the real gate, over the whole tree rather than over the run's own list.** Re-read every sidecar, recompute drift by running `scripts/hooks/spec-gate.py` itself, and assert it is zero for every seeded record. Plus the AC-18 negative: for **every** sidecar in the tree, `hasOwnProperty('ownedAtApproval')` must hold **iff** that record was classified old-fresh in the pre-flight. Iterating the run's own record list cannot catch a wrongly-seeded record, because a wrongly-seeded record is inside that list.
7. **Write mechanics that preserve what a library round-trip destroys.** Iterate the sidecar **tree**, never `byId` (`representativeById`, `scripts/migrate-approvals.ts:219-229`, collapses 3 of the committed sidecars out of reach - measured: the three non-`requirements.md` sidecars are `specs/agent-execute/SPEC-019-execution-substrate/design.md`, `specs/minspec/design.md`, `specs/minspec/tasks.md`); parse **raw JSON**, never through `readRecord`/`normalizeRecord` - verified hazard: **4** of 64 sidecars omit `baselineBlob` on disk and `normalizeRecord` coerces absent to `''` (`packages/minspec/src/lib/approval-store.ts:130`), converting "legacy, never had a baseline" into the documented "both mint paths failed" state; carry `tier` forward verbatim; text-level edit preserving unknown keys and key order, temp-file-and-rename, with a per-file delta whitelist that aborts and restores on any unexpected byte.
8. **Idempotency keyed on a per-record marker, never on file existence** - the precedent's bug (`scripts/migrate-approvals.ts:118-120`, `hasSidecar` returning `written.has(specRel) || existsSync(sidecarPath(specRel))`). Rehash mode keys on `rehashedAt`. **Seed mode keys on `Object.prototype.hasOwnProperty.call(rec, 'ownedAtApproval')` and on nothing else** - **[fix]**: measured, **31** of the **61** old-fresh records seed to `[]` and **30** seed non-empty, so a marker written as `if (!rec.ownedAtApproval?.length)` re-seeds half the corpus on every run, through the exact `[]`-is-not-absent trap this design identifies one section earlier.
9. **Real exit codes and a wired entry point.** `npm run migrate:ownership-hash`, a machine-readable JSON run report plus a human table, no bare `catch {}` anywhere. The precedent has no `process.exit`, no `throw`, six bare catches, and is wired into nothing, so a partial run there is indistinguishable from a clean one.
10. **Status-vector assertion, stated separately per mode - [fix].** In **seed mode** the vector must be element-wise identical before and after, which holds trivially because seeding touches no hash and is therefore a real check only of "the run wrote nothing it should not have". In **rehash mode** (slice 8, the basis change, which is the slice INV-2 and INV-3 actually police) it cannot be identical by construction: a quarantine's whole purpose is to move a record from approving to non-approving. The rehash-mode form is: **the status vector is identical except for exactly the records the operator declared via `--expect-quarantine`, each of which must move approved -> non-approving, and no record anywhere may move in the improving direction.** The quarantine set is an explicit allowlist keyed by `specPath`, so an unexpected improvement is a hard failure rather than an unexplained vector diff.

➡️ **AC-15 needs one clause from the founder, flagged rather than absorbed.** AC-15's text is about "the migration's pre-flight" without qualification, and this migration has two modes. The **rehash mode** discharges AC-15 literally: at least one known record must classify differently under `preStripSpecHash` and `specHash`, or the run dies. The **seed mode** runs pre-strip, when the two bases are byte-identical, so a literal two-bases assertion there would abort and seed nothing. Its pre-flight carries the **polarity-inverted** proof of equal force: `preStripSpecHash(raw) === specHash(raw)` for every corpus file, aborting if not, which proves the frozen copy has not drifted from the basis the records were actually minted under and which inverts into the two-bases proof the day slice 8 lands. Same function, same fixtures, opposite polarity, both executable. The recommendation is a one-clause AC-15 amendment stating that each mode proves it is not comparing an artifact to itself; **the cost** is that it amends an approved acceptance criterion, which is a human act. **Assumed meanwhile:** build both proofs, which is strictly more than either reading requires, so nothing is blocked.

**The third abort no draft but one had, kept: new-basis liveness.** In rehash mode the shipped hasher must differ from the frozen one on at least one corpus file, or the run dies - which catches the re-stamp executing in a merged state where the strip never actually widened.

**Quarantine is a real written path, not only an abort** - **[fix]** for the sequencing draft's internal contradiction, which wrote a quarantine record in its data shapes and aborted instead of writing it in its risk section, leaving AC-16 with no artifact to read. Both hold: the default is abort-and-escalate, and the write executes when the operator passes `--expect-quarantine N` matching the classified count.

**Residual, stated rather than hidden.** Every layer above polices whether the run happened, whether the two bases differ, and whether the value equals the gate's. None can prove the human would still have approved the re-stamped bytes - nothing can, which is why INV-3 forbids any status improving across the basis change.

---

## 6. Acceptance criteria: the mechanism that can fail, criterion by criterion

### AC-1 (FR-1) - a probe pinned by a truth table, and a body proven red before it is ever trusted green

**[fix]** for the dead-latch finding. The earlier formulation gated all three execution halves behind `if (stripIsLive('implements'))`, which is false from slice 1 through slice 7 and flips only in slice 8, and defended it with a control pair that exercises the *probe* and never runs one line of the guarded *body*. AC-1's own words are "Asserted by executing all three halves" (requirements.md:720), and a branch that has never executed cannot be shown to fail. Both halves of that are repaired, separately.

**The probe, pinned by a five-cell truth table rather than a single control pair.** `stripIsLive(key) = specHash(fixtureWithKeyValueA) === specHash(fixtureWithKeyValueB)` - execution-only, per AC-1. `stripLifecycle` (`packages/shared/src/canonical.ts:60-83`) recognises exactly two keys: `PHASES_LINE_RE` sets `inPhasesBlock = true` (`:73-76`) and `STATUS_LINE_RE` merely `continue`s (`:77-79`). So today the table is `status` TRUE, `phases` TRUE, `implements` FALSE, `affects` FALSE, `implements_reason` FALSE; after slice 8 all five are TRUE. Asserting all five in both merged states proves what one pair could not: the probe can go true on a **scalar** key (`status`) *and* on a **block** key with indented children (`phases`), which is the shape all three ownership keys take. No simulated or second hasher is introduced anywhere - a second live basis is the state section 7 rejects under DR-012.

**The body: three named predicates, each falsifiable before the guard can flip.** The three halves stop being inline `expect`s and become local predicates in `packages/minspec/tests/ownership-witness-corpus.test.ts`, each returning `{ ok: boolean; detail: string }`:

- `producerWritesWitness(ws, expected: readonly string[])` - runs the real `approveSpec` against a hermetic temp workspace (precedent: `packages/minspec/tests/approve-baseline.test.ts:471`, `approveSpec(tmp, specPath, 'T3', 'test@minspec.test')`), re-reads the sidecar's raw text, and is `ok` only if the parsed `ownedAtApproval` is a non-empty array of strings deep-equal to `expected`. It takes `expected` as an argument rather than importing `structuredOwnedSet`, so the predicate is complete in slice 1 - before `owned-set.ts` exists (slice 3).
- `gateReadsSnapshot(ws)` - drives the real hook via `spawnSync('bash', [hookPath], { input, cwd, env })` (precedent: `packages/minspec/tests/spec-gate.test.ts:84-89`, with the hermetic-by-construction contract at `:1-15`) and is `ok` only if the decision is `deny` **and** the raw reason names the ownership verdict. Empty stdout - which that helper reports as `{ decision: null, raw }` at `:93-94` - is `ok: false`, never a pass.
- `noOldBasisRecord(root, { old = preStripSpecHash, shipped = specHash })` - walks the tracked sidecar tree **raw**, never through `listRecords`, because `readRecord` returns `isValidRecord(parsed) ? normalizeRecord(parsed) : undefined` (`packages/minspec/src/lib/approval-store.ts:153`) and a dropped record is exactly what this half must see. `ok` only if no record satisfies `rec.specHash === old(raw) && rec.specHash !== shipped(raw)`.

**Unconditional controls, from slice 1, never consulting the probe.**

1. **Null-workspace control, all three predicates.** Each returns `ok === false` against an empty temp dir - no spec, no sidecar, no hook state. A `() => true` stub, a predicate that swallows its own exception into a pass, and a predicate whose assertion was deleted all fail this. It is slice-independent: no slice makes an empty workspace pass.
2. **Omitting-producer control.** `producerWritesWitness` returns `ok === false` on a sidecar written directly by `writeRecord` with no `ownedAtApproval`. Slice-independent - no slice makes an absent field a non-empty array.
3. **Wrong-reason control.** `gateReadsSnapshot` returns `ok === false` on the same fixture with `ownedAtApproval` removed. This stays red **through slice 7 and after**, because slice 7 makes that state deny with `ownership.witness.missing`, a different verdict - which is precisely why the predicate asserts the reason string and not merely that a deny happened.
4. **Disagreeing-basis control.** `noOldBasisRecord` is executed in slice 1 against a deliberately-disagreeing hasher pair over a synthetic sidecar, and must report the violation. This is the one place an argument is injected, and the reason is structural: before slice 8 the two bases are byte-identical on every input, so the comparison is unsatisfiable against the real pair and cannot be executed at all otherwise. The injected pair never touches a record, is never exported, and is not a minting basis.

**These controls are one-directional, and that is the safe direction, stated rather than glossed.** They can prove a predicate is not stuck-**true**; they cannot prove it is not stuck-**false**. A stuck-false predicate fails the slice-8 arming loudly and freezes the merge - a false red, never a false green. The true direction is nevertheless proven before slice 8, in each AC's own suite: `gateReadsSnapshot`'s deny is AC-8's assertion in slice 4, and `producerWritesWitness`'s non-empty equal set is AC-6's assertion in slice 5. By the time the guard flips, every predicate has run green and red at least once, in different slices.

**The guarded block therefore contains nothing but the three calls and their `expect`s.** All logic lives in the predicates. One further pin, because a careless fixture would make the latch permanently red: half 1's workspace MUST declare a **non-empty** structured set. AC-1's failure is `approveSpec` *not writing* the field; a legitimately empty `[]` is a signed third state (section 3) and is AC-19's mirror, not this latch's business.

**Two witnesses, two jobs, and the vitest one carries all three halves** (constitution invariant 2 forbids a required check hinging on one producer). The vitest witness runs in `Test with coverage` (`.github/workflows/ci.yml:183-184`, job `test:` at `:154`); validator Rule 21 runs in `Validate frontmatter` (`:85-86`, job `lint:` at `:68`). Neither step carries an `if:` at job or step level. The two are genuinely independent for the failure that matters: Rule 21 does not consult the probe at all - it compares against `preStripSpecHash` directly - so a merge that widened the strip and broke the probe in one commit disarms the vitest latch and not the validator.

**Validator Rule 21 (FATAL), two clauses, both over the tracked sidecar tree read raw** - never through `listRecords`, because `readRecord` drops a record that fails `isValidRecord` (`approval-store.ts:153`) and a rule built on it is structurally blind to exactly the sidecars it exists to catch. The earlier formulation - "no tracked approved record is fresh under `preStripSpecHash` and stale under the shipped hasher" - is **[fix]**ed here: it detects a record left on the old basis and is silent on a record the re-stamp wrote with a wrong digest, which is stale under *both* hashers, satisfies the old predicate, and merges green while being precisely the newly-stale sidecar AC-1's closing sentence forbids (requirements.md:721).

**The latch below replaces the refuted 21a/21b pair.** The earlier version did not fire on a wrong-digest
re-stamp, which two reviewers correctly called the silent-gate shape constitution invariant 2 forbids. Three
corrected designs were produced independently and all three were refuted (15, 9 and 17 escapes); what follows
is composed from the clauses that survived, and the residual that no byte-local rule can close is named at the
end with the separate witness that closes it.

**Taken: none of the three survives intact. 21a is composed from the raw-parse/forbidden-shape formulation the second and third candidates share (corrected to key on the sidecar's location, not the record's own `specPath`), and 21b keeps only the first candidate's polarity inversion (`rehashedFrom` as antecedent, `specHash` as consequent) while dropping every new record field, because a raw-byte pin is disarmed by the same wrong-read that disarms the anchor and buys nothing the anchor does not already give.**

---

### 6.1 Rule 21a (FATAL) - approval-record basis

**Domain.** Rule 21a (the old-basis latch) walks `<ROOT>/.minspec/approvals/` recursively for `*.json` and `JSON.parse`s each file. Three exclusions are forbidden, each for a verified reason:

- **No freshness filter.** `resolveStatus` decides `approved` by hash equality alone (`packages/minspec/src/lib/approval.ts:483-489`, the comparison at `:489`), so a record left on the old basis is `stale` by construction. Defining the domain over approved records makes 21a's own FATAL state unreachable from its own iteration set. That, not the wrong-digest hole, is the defect in `design.md:294`.
- **No store reader.** `readRecord` returns `undefined` for anything failing `isValidRecord` (`approval-store.ts:148-153`), `listRecords` drops it the same way (`:195`), and `normalizeRecord` is a whitelist constructor with no spread (`:121-136`) that would erase `rehashedAt`/`rehashedFrom` one function after a successful read. A rule built on any of the three is structurally blind to its own quarry.
- **No git.** `lint:` checks out with no `fetch-depth` (`.github/workflows/ci.yml:68`, `:72`); only the `paths:` job sets `fetch-depth: 0` (`:40-42`). A filesystem walk also lets the fixture-corpus harness work, since its tmpdir is not a repo. In CI the on-disk set is the tracked set; measured at HEAD `43d010bf`, `find` and `git ls-files` both return 64.

**Subject selection.** The spec under test is the file named by the sidecar's **location** (`.minspec/approvals/<rel>.json` implies `<rel>`), never by the record's internal `specPath`. Both consumers key on location and never read that field: `sidecarPath` composes it from the caller's path (`approval-store.ts:79-82`, used at `:148-149`) and `read_record` joins `approvals/<rel_spec_path>.json` and shape-checks only `specHash` (`scripts/hooks/spec-gate.py:262-278`). A rule that classified against `R.specPath` would judge a different file from the one the gate approves.

**Admission, four outcomes.** For each file at `.minspec/approvals/<rel>.json`:

1. Unparseable, not an object, or no string `specHash` and no string `quarantinedHash`: **FATAL**, `unreadable approval sidecar (Rule 21a reads raw JSON; a sidecar it cannot read is a defect, not a skip)`. Measured 0 of 64.
2. `R.specPath` present and not equal to `<rel>`: **FATAL**, `sidecar location and record specPath disagree`. Measured 0 of 64. This is what makes reading either field safe afterwards, and nothing checks it today (`isValidRecord` tests `typeof` only, `approval-store.ts:96-112`; `listOrphanedRecords` tests `classifyApprovablePath(rec.specPath)` only, `:239-242`).
3. `<rel>` does not resolve to an existing file: counted and named as `orphaned`, **warn**, not fatal. Rule 10 is deliberately non-fatal for already-committed drift (`scripts/validate-frontmatter.ts:437-451`) and escalating it would red a correct state: a spec directory renumbered with its sidecar git-moved alongside keeps a live, hash-matching approval that only Rule 21a would reject.
4. Otherwise classify, below.

**Classification.** Let `S` be the spec file's raw bytes, `H_new = specHash` (shipped, `packages/shared/src/canonical.ts:126-128`) and `H_old = preStripSpecHash` (the slice-1 frozen copy). Let `D` be `R.specHash`, or `R.quarantinedHash` when FR-9.4 has moved the digest out (`requirements.md:504-505` permits `specHash` **absent**; a rule that FATALs on a non-string `specHash` is a permanent red on every quarantined record).

Exactly one shape is forbidden:

```
D === H_old(S) && D !== H_new(S)     ->  FATAL
```

message: `approval sidecar still carries an old-basis hash: it verifies under the frozen pre-ownership-strip hasher and not under the shipped one, which is the state FR-1 exists to prevent`.

Everything else is legal, including `D === H_new(S)` (live) and `D` matching neither (stale under both bases). Stating this as one forbidden shape rather than as a list of permitted states is what removes the iteration-set escape: there is no admission predicate for a defect to fall out of.

**Anti-vacuity.** One line every run: `Rule 21a: N sidecars - F live, S stale under both bases, O old-basis, X orphaned`. FATAL with `Rule 21a validated NOTHING this run` when `N === 0` while the approvals tree holds at least one `.json`, following Rule 17 (`scripts/validate-frontmatter.ts:317`), Rule 18 (`:355`) and Rule 19 (`:721`, `:727`).

**No swallowed catch.** 21a's exception arm calls `fail()`, not `warn()`. Rules 16-19 all warn on an unrunnable check and the file says outright that this fails OPEN (`:705-718`). ➡️ **Recommended (rec): fail closed here**, because Rule 21 is one of AC-1's two witnesses and constitution invariant 2 requires an errored witness to fail the gate closed (`.minspec/constitution.md:8`). **Cost of that recommendation:** an unreadable `.minspec/approvals/` wedges every commit instead of warning, and Rule 21 becomes the only rule in a 742-line file behaving that way. Nothing lints the alternative: `scripts/check-swallowed-gate-signal.ts` walks `.sh` only (`:56`, `:67`), which is why Rule 12's own swallow-block (`validate-frontmatter.ts:553-556`) is invisible to it.

---

### 6.2 Rule 21b (FATAL) - re-stamp integrity

Rule 21b (the wrong-digest clause) applies to every record in 21a's domain that carries any of `rehashedAt`, `rehashedFrom`, **regardless of which 21a class it is in**. No new record field is introduced; FR-9.5's two fields (`requirements.md:516`, interface at `:655-659`) are sufficient.

- **21b.1 (completeness and shape; decay-free; trusts no digest).** Presence of **either** field requires **both**: `rehashedFrom` matching `/^[0-9a-f]{64}$/` and `rehashedAt` parsing as ISO-8601. FATAL otherwise, `incomplete re-stamp provenance`. Keying on presence-of-**any** is load-bearing: a rule keyed on `rehashedFrom` alone is disarmed by dropping that one field, and `rehashedAt` is also FR-9.4's improve-exemption key (`requirements.md:509-515`), so a half-written pair silently re-arms quarantine on the next run. `isValidRecord` checks `typeof === 'string'` only (`approval-store.ts:96-112`) and `spec-gate.py:277` does the same, so `""`, `"undefined"` and a truncated digest are schema-valid on both sides today.

- **21b.2 (the integrity clause; total at the re-stamp merged state; decays to silence).**

  ```
  IF  R.rehashedFrom === H_old(S)          // the anchor: S is, to collision resistance,
                                           // the bytes this record was re-stamped from
  THEN D === H_new(S)                      // MUST hold
  ```

  FATAL otherwise, message naming the sidecar, `expected <H_new(S)>`, `found <D>`, and the sentence `rehashedFrom matches preStripSpecHash of the spec at head, so the spec has not moved since the re-stamp and the correct specHash is computable`.

  The antecedent is `rehashedFrom`; the consequent is `D`. That inversion is the whole clause. `D` is the only field either reader consumes (`approval.ts:489`; `spec-gate.py:277`, verdict at `:478-483`), so a rule that validates `rehashedFrom` and skips `D` has the polarity backwards.

- **21b.3 (census; the anti-silence half).** `Rule 21b: D records carry re-stamp provenance, A of them still anchored to head bytes, A-K verified`. **Warn**, not fatal, when `D > 0 && A === 0`: `A` decays legitimately as specs are edited, so a fatal there is a guaranteed future red. The hard equality `A === D` is asserted once, in slice 8's corpus test, where it is checkable rather than asserted (below).

**Deleted, not relaxed: the reverse direction.** The design's current clause (`design.md:299`, "if the record is in state 1, `R.rehashedFrom` MUST equal `preStripSpecHash(S)`") and the correction it proposes at `:305-307` (the same equality with no state guard) are both **permanently red on the workflow AC-9 requires** (`requirements.md:761`). Measured on a fixture carrying `implements:`, with the real `specHash` as `H_old` and a faithful five-key widened canonicalizer as `H_new`:

| fixture | `H_old` | `H_new` |
|---|---|---|
| base | `53a1c33a6cc4` | `1da76ab91efe` |
| add a second path to `implements:` | `2600a9b3e410` | `1da76ab91efe` **unchanged** |
| edit one body word | `d11c277f464c` | `b2d585a548e8` |

Post-strip, an ownership-only edit leaves `H_new` fixed (the record stays live and approved, which is the entire point of FR-6's drift machinery) and moves `H_old`. Both the current clause and the proposed correction then FATAL forever on a record nobody has done anything wrong to. That also falsifies the design's own residual paragraph (`design.md:319`, "once the bytes move, the record drops into 21a state 2"): after an ownership-only edit the bytes have moved and the record is still in state 1.

**Also deleted: non-degeneracy (`rehashedFrom !== specHash`).** FR-9.3's licence is old-freshness (`requirements.md:492-494`), and measured at HEAD, 22 of the 61 old-fresh records sit on specs the widened strip does not move, so a correct re-stamp of those writes `rehashedFrom === specHash`. The clause would red 22 correct records at the exact merge slice 8 must land. Their anchors still work (`H_old(S) === H_new(S) === D`), so nothing is lost by dropping it.

---

### 6.3 The five cases, and what the latch reports for each

| # | Case | What the rule reports | Correct? |
|---|---|---|---|
| 1 | Wrong-digest re-stamp, `rehashedFrom` correct, spec bytes unmoved | 21b.2 FATAL. Anchor matches so the clause is armed; consequent fails. 21a is silent, correctly: the garbage digest matches neither basis and is indistinguishable from the three legitimately stale records | **Yes** |
| 2 | The three stale-under-both records at HEAD | Silent. 21a's forbidden shape needs `D === H_old(S)`, false for all three. 21b's domain is empty for them permanently: measured, the key union across all 64 sidecars is exactly `approvedAt, approvedBy, baselineBlob, migrated, specHash, specPath, tier`, and FR-9.3 re-stamps only old-fresh records, so a stale record never acquires provenance | **Yes** |
| 3 | 21a's iteration set | Domain is every `*.json` under `.minspec/approvals/`, raw-parsed, keyed on location. Freshness is the rule's output, never its input. A record left on the old basis is FATAL; the count is reported and a zero count is FATAL | **Yes** |
| 4 | The trap: `rehashedFrom` correct, `specHash` garbage | FATAL, by 21b.2, because `rehashedFrom` is the antecedent and `D` the consequent. The trap's own rule (the bare equality) is not present, so its false red on the ownership-only edit is not inherited either | **Yes**, both halves |
| 5 | Re-stamped spec legitimately edited afterwards | Silence, per record. The anchor `rehashedFrom === H_old(S)` goes false the instant the bytes move, so 21b.2 stops applying rather than failing. 21a puts the record in stale-under-both, legal. 21b.1 keeps running forever. The census reports `A` shrinking | **Yes.** Silence is safe: when `D !== H_new(S)` the record resolves `stale` (`approval.ts:489`) and contributes to `blocking` (`spec-gate.py:512-513`), so the only state in which 21b.2 is silent is a state in which the record approves nothing |
| R | **Residual: correlated error.** The migration reads the wrong bytes `S_wrong` (wrong file, wrong revision, a normalized buffer) and computes **both** digests from them in one pass, as FR-9.3/FR-9.5 specify | **Green, and wrong.** `rehashedFrom = H_old(S_wrong) !== H_old(S)`, so 21b.2 is silent; `D = H_new(S_wrong)` matches neither basis, so 21a is silent; 21b.1 passes because both values are well-formed | **No.** See below |

**The residual, stated plainly.** Any arming condition for a wrong-digest check is a value the buggy producer wrote, so the dominant migration defect disarms its own detector. This is not specific to the anchor: a `sha256`-of-raw-bytes pin fails identically under a pairing bug, and it additionally decays on edits neither hasher sees (measured: a trailing-whitespace edit and a `status:`-value edit each move the raw digest while leaving both canonical digests fixed). No byte-local, git-free standing rule can close it, because after the bytes move a wrong digest and an ordinarily-stale record are the same object.

**Where it is closed instead, and this must be in the Plan rather than implied by Rule 21.** At the re-stamp merged state the check is available with **no trusted field at all**, because `S` is unmoved: slice 8 changes no path under `specs/`, a property slice 8's PR already asserts directly (`design.md:299`). So slice 8's corpus test (vitest, `test:` job at `.github/workflows/ci.yml:154`, `:183-184`, a different job from Rule 21's `lint:` at `:68`, `:85-86`, which is invariant 2's second-witness clause) asserts over the live corpus:

- zero records classify `old-basis`;
- every record carrying provenance is live under the shipped hasher, i.e. `A === D`;
- the set of stale-under-both records is **exactly** `specs/minspec/SPEC-007-epic-grouping/requirements.md`, `specs/minspec/design.md`, `specs/minspec/tasks.md`, named.

That triple is total at that commit and catches the correlated-error case outright. It cannot be a standing rule: the stale-both set grows with ordinary spec editing, and a standing enumeration would have to be amended by whoever edits a spec, which taxes the exact workflow the repo runs on. One operational consequence worth naming: the assertion is evaluated on the PR **merge result** (`pull_request`, `ci.yml:3-5`), so a spec edited on `main` after the migration ran makes it red. That red is correct under AC-1's closing sentence (`requirements.md:721`, a re-stamped record whose spec then moved **is** newly stale in the merged state) and its fix is to re-run the migration on the merge result. The re-stamp commit is not rebasable.

**Partial independent coverage of the pairing sub-case, hedged.** If the migration mis-pairs record and file, FR-9.10 seeds `ownedAtApproval` from the same wrong read (`requirements.md:543-555`, value at `:548`), so FR-6's drift comparison denies at the gate and Rule 20 sees a witness that does not match the declaration. That is a genuine second subsystem catching it, but it depends on the two specs' owned sets differing and on the seeding pass reading the same bytes as the re-stamp pass. I have not verified either property against an implementation that does not yet exist; treat it as a likely mitigation, not a gate.

---

### 6.4 The failing test

**File:** `packages/minspec/tests/validate-frontmatter-restamp-integrity.test.ts`, assigned to slice 8, because before it `preStripSpecHash` is a verbatim copy pinned equal to the shipped hasher and no fixture built from real bytes can make the two bases disagree.

**Harness.** Drive the real CLI as a subprocess; the script has top-level side effects including `process.exit(1)`. Precedent: `packages/minspec/tests/validate-frontmatter-claim-words.test.ts:26-27` (`REPO_ROOT`/`SCRIPT_PATH`), `:33` (`TSX_BIN` resolved absolutely, with the comment explaining that `npx` would try to fetch `tsx` and break the offline invariant), `:42-45` (`spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' })`), `:47-54` (`withTmp`). Works because `scripts/validate-frontmatter.ts:42` is `const ROOT = process.cwd()`.

**Fixture shape.** Copy `packages/minspec/tests/validate-frontmatter-acceptance-criteria.test.ts:24-47` verbatim and add one frontmatter key. That `writeFixture` is a live, currently-green fixture whose sibling case asserts `expect(status).toBe(0)` at `:76`, so the exit-code polarity is established by a passing test rather than by my reasoning. It already clears every unrelated rule: `## Acceptance Criteria` satisfies Rule 13 (`validate-frontmatter.ts:559-577` via `checkAcceptanceCriteria`, `spec-validator.ts:671-685`, triggered by `requiresAcceptanceCriteria` at `:387-389`); `phases.plan: pending` makes `validateOwnership` return `[]` at `spec-validator.ts:792-796` so Rule 15 is inert; no `docs/epics/` keeps the epic arm inert (`validate-frontmatter.ts:218`); `id: SPEC-001` satisfies `:214`; a `status:` value with no body status line keeps Rule 11 quiet.

The one addition:

```
implements: packages/x/src/a.ts
```

This is not decoration. It is what makes the two bases disagree at all; a fixture carrying only `status:`/`phases:` is stripped identically by both hashers and every clause below is unfalsifiable on it.

Sidecar at `<tmp>/.minspec/approvals/specs/demo/requirements.md.json`, carrying the seven-key shape measured across all 64 live records plus FR-9.5's two. **Every digest is computed in the test from the fixture's own bytes**, never a committed literal.

**A. The failing test.**

```ts
rehashedFrom = preStripSpecHash(raw)                      // correct anchor
specHash     = specHash(raw.replace('prose here', 'x'))   // a real 64-hex digest of a
                                                          // real perturbation: neither
                                                          // H_new(raw) nor H_old(raw)
```

```ts
expect(record.specHash).toMatch(/^[0-9a-f]{64}$/);          // well-formed, so this
expect(record.specHash).not.toBe(specHash(raw));            // discriminates a WRONG
expect(preStripSpecHash(raw)).not.toBe(specHash(raw));      // digest, not a malformed one
const { status, output } = runValidate(dir);
expect(status).not.toBe(0);
expect(output).toContain('Rule 21b');
expect(output).toContain('specs/demo/requirements.md.json');
expect(output).toContain('rehashedFrom matches preStripSpecHash');
expect(output).toContain(specHash(raw));                    // expected digest printed
expect(output).toContain(record.specHash);                  // found digest printed
expect(output).not.toContain('Rule 21a');                   // specificity control
```

**What it reports before the fix exists.** `rehashedAt`, `rehashedFrom` and `preStripSpecHash` appear nowhere under `packages/`, `scripts/` or `.minspec/`; `isValidRecord` does not reject unknown keys (`approval-store.ts:96-112`); the only approval-touching validator rule is Rule 10, warn-only (`validate-frontmatter.ts:437-451`). So today the fixture exits 0 with `Frontmatter validation passed` and both the status and the message assertions fail. It also exits 0 under the design's current 21b (the record is not live, so the state guard skips it) and under the proposed correction (`rehashedFrom` is correct, so the bare equality passes). Three-way red, green only against 21b.2.

**Companions.** Per the precedent's own warning at `validate-frontmatter-claim-words.test.ts:98-103`, the green cases assert on Rule 21's message and census line, not bare exit codes, so an unrelated rule cannot turn them red for a reason that has nothing to do with Rule 21. One case keeps `expect(status).toBe(0)` as the crash canary.

- **B. Correct re-stamp, bytes unmoved.** `specHash = H_new(raw)`, `rehashedFrom = H_old(raw)`. `expect(output).not.toContain('Rule 21')`, plus `expect(output).toMatch(/1 records carry re-stamp provenance, 1 of them still anchored/)`. This is the crash canary and the one case that also asserts `status === 0`.
- **C. Decay.** Fixture B, then append a line to the body. `not.toContain('Rule 21')` and `toMatch(/0 of them still anchored/)`. **Red against the design's proposed correction**; this is the assertion that discriminates the two.
- **D. Ownership-only edit.** Fixture B, then rewrite `implements:` to name two paths. Assert first that `specHash(after) === specHash(before)` (the edit really is hash-neutral, which doubles as a live reading that the strip has landed), then `not.toContain('Rule 21')`. **Red against the design's current 21b and against the proposed correction.** Highest-value fixture in the set.
- **E. Old-basis record.** `specHash = preStripSpecHash(raw)`, no provenance fields. `status !== 0`, `toContain('Rule 21a')`, `toContain('old-basis hash')`. Red against any shipped-fresh iteration set, which skips it.
- **F. Stale under both stays legal.** `specHash = '0'.repeat(64)`, no provenance. `not.toContain('Rule 21')`.
- **G. 21b.1 shapes.** Four one-line variants of B: `rehashedFrom: ""`, `rehashedFrom: "undefined"`, `rehashedAt` removed with `rehashedFrom` kept, `rehashedFrom` removed with `rehashedAt` kept. Each asserts `status !== 0` plus `incomplete re-stamp provenance`.
- **H. Location/`specPath` disagreement and orphan.** A sidecar at `specs/demo/requirements.md.json` whose internal `specPath` names a different file: `status !== 0`, `toContain('sidecar location and record specPath disagree')`. A sidecar whose spec file is absent: `not.toContain('Rule 21a')` in the fatal sense, and `toMatch(/1 orphaned/)`.
- **I. Anti-vacuity controls.** Empty `.minspec/approvals/`: `toMatch(/Rule 21a: 0 sidecars/)` with no fatal. A tree of two records whose reported count is 0: `status !== 0`, `Rule 21a validated NOTHING this run`.

**Slice-1 companion, so no clause ships unfalsifiable while the two bases are still identical.** `classifyRecord(rec, raw, { old, shipped })` is a pure function returning a discriminated union (`live | stale-both | old-basis | restamp-inconsistent | incomplete-provenance | path-mismatch | orphaned | unreadable`), unit-tested against a deliberately disagreeing injected hasher pair across all four `(D === H_new, rehashedFrom === H_old)` rows plus the four shape variants, then wired to `(preStripSpecHash, specHash)` in the validator. The injected pair is never exported and never mints a record. This does not substitute for fixture A: an injected pair proves the predicate, never the wiring.

**Slice-8 merged-state assertion**, in `packages/minspec/tests/ownership-witness-corpus.test.ts`, run with `cwd: REPO_ROOT`: zero `old-basis`, zero `restamp-inconsistent`, `A === D`, and the `stale-both` set exactly the three named paths. This is the witness that covers the residual, and it belongs to slice 8's PR, not to the standing rule.

---

### 6.5 Cost of the latch

1. **The residual is real and Rule 21 does not close it.** A migration that reads the wrong bytes and derives both digests from them merges green past every clause. Rule 21's standing coverage is: the old-basis case, totally and forever (21a); malformed and half-written provenance, totally and forever (21b.1); and a wrong digest **only while the anchor still matches head bytes** (21b.2). The report must print `A of D still anchored` so a reader sees coverage shrinking rather than reading a bare green as total. Nothing here discharges AC-1's closing sentence on its own; the slice-8 corpus assertion does, at one commit.

2. **21b.2's decay is forensic, not protective, and it terminates cleanly.** After the spec moves, the validator cannot distinguish a wrong-digest record from an ordinarily stale one. Both resolve `stale`, both freeze their owned files at the gate, and the human clears both by re-approving. Re-approval **erases** the provenance rather than reporting it: `approveSpec` builds a fresh record literal (`approval.ts:581-589`) from `specHash(raw)` at `:568`, never reading the prior sidecar, and `writeRecord` is a whole-file overwrite (`approval-store.ts:160-164`). FR-9.5 pins the same from the other side (`requirements.md:655-656`, written only by the migration). So each record's 21b window opens at the re-stamp and closes permanently at its next approval; the domain shrinks monotonically to empty. What is lost is the audit trail: nothing records that a migration wrote a bad digest six months ago. If that matters, the place for it is the migration's run report (FR-9.8 already requires a signal a check can read), not a standing rule.

3. **The `specPath`/location FATAL is a new red surface.** Measured 0 of 64 at HEAD so it lands green, but a sidecar copied along with a spec directory, or a partial rename, now reds the build until the JSON is hand-corrected. I took the red rather than a skip-and-report, because skip-and-report reintroduces exactly the iterate-past defect 21a exists to remove. The orphan case went the other way, to warn, because there the fatal would red a **correct** state.

4. **Zero new record fields.** Both raw-byte-pin candidates cost a new field across FR-4's six sites (interface, `isValidRecord`, `normalizeRecord`, `approveSpec` which must not write it, both literals in `scripts/migrate-approvals.ts`, and `scripts/approval-provenance.py`) and buy only an arming condition that the same wrong read disarms. Rejecting them is the single largest cost saving here and costs nothing the anchor does not already give.

5. **21b.1's hex clause binds anything that mints a sidecar.** Any test or script writing a placeholder digest must use a real 64-lowercase-hex string. Measured 64 of 64 live records conform; fixtures elsewhere in the suite may not and will red on the slice that lands this.

6. **Runtime.** One spec read plus two digests per record, on every `npm run validate`: the pre-commit hook and `.github/workflows/ci.yml:85-86`. Rule 20 needs the same read and one of the same digests, so the two must share one pass over the tree; specifying them as independent walks doubles the cost for no gain. Note that the pre-commit gate is baseline-differential (`.githooks/pre-commit:386-388` diffs current FAIL lines against the HEAD baseline and blocks only what the commit introduces, `:401`), so a new FATAL from Rule 21 blocks the commit that introduces it. That is why no clause here may red on an ordinary spec edit, and why the enumerated stale-both set is a slice-8 assertion rather than a standing rule.

7. **Follow-ups this surfaces.** `design.md:319`'s residual paragraph is false for the ownership-only-edit case and needs correcting whether or not this pair is adopted. `scripts/check-swallowed-gate-signal.ts` walks `.sh` only (`:56`, `:67`), so a swallowed catch inside a TypeScript validator rule is visible to a prose paragraph and to nothing else. Both want issues; this was a read-only run and neither is filed.

**Rule 21's own falsifiability, because a dead predicate one job over is the same defect as a dead latch.** Before slice 8 the two hashers are byte-identical on every input, so 21a's fatal state is unsatisfiable and the rule iterates records while being incapable of firing - and its "validated NOTHING" arm would not notice, because it *is* validating. So the predicate is extracted as a pure function taking its hasher pair, `classifyBasis(rec, raw, { old, shipped })`, unit-tested red in slice 1 against a deliberately-disagreeing pair and wired to `(preStripSpecHash, specHash)` in the validator. Its end-to-end red through the real `npm run validate` arrives with slice 8 and is asserted there against a fixture corpus with `spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: fixtureDir })` - the AC-14 mechanism, which works because `scripts/validate-frontmatter.ts:42` is `const ROOT = process.cwd()`.

**Residual, stated rather than hidden.** 21b relaxes for any record whose spec file is legitimately edited after the re-stamp: the anchor stops matching, so the clause stops applying rather than failing. AC-1 is a statement about *the merged state* and the latch is total in it; outside it, it is a per-record property that decays as specs are edited, by design.

**[corrected]** An earlier version of this paragraph said "once the bytes move ... the record drops into 21a state 2". That is FALSE for the one edit this spec exists to make cheap. Post-strip the ownership keys are outside the canonical form, so an ownership-only edit does not move `specHash` at all: the record stays fresh under the shipped hasher and stays in state 1, while `preStripSpecHash(S)` moves. Measured on a fixture: the ownership-only edit left the new-basis digest fixed at `1da76ab91efe` while the old-basis digest moved from `53a1c33a6cc4` to `2600a9b3e410`. Both the refuted 21b and the "obvious fix" of dropping its state guard go permanently RED on exactly the AC-9 workflow (requirements.md:784-786, adding a path to `implements:` on an approved spec). The latch above avoids it because the anchor is `rehashedFrom`, not the freshness state.

*(A merge-base-aware variant was rejected, verified rather than assumed: the `lint:` and `test:` jobs check out with `actions/checkout@v5` and no `fetch-depth` (`.github/workflows/ci.yml:72`, `:158`), so neither has a base to compare against; only the `paths:` job sets `fetch-depth: 0` (`:40-42`). Putting the check in `approval-provenance.py` was rejected for a stronger reason: `scripts/review-branch.sh:108` invokes it as `python3 ... 2>/dev/null || true`, marked `swallow-ok` as an optional note that changes no verdict - a load-bearing gate signal written with a swallowed error is the state constitution invariant 2 forbids.)*

### AC-2 (FR-2) - four named fixtures, golden pre-strip digests, and all three hashes anchored to the canonical STRING

**[fix]**. The earlier draft named the fixture directory and never its contents, and built a three-way harness that proves only that the three hashes agree *with each other* - green if none of them moved. AC-2 requires more: all three must differ from the pre-change hash **exactly on the ownership keys** (requirements.md:722-725), which is a two-sided claim needing a negative control.

**Four committed pairs in `packages/minspec/tests/fixtures/canonical/`.** The existing golden loop at `packages/minspec/tests/canonical.test.ts:101-107` auto-discovers every `*.input` (`:92-95`), asserts `canonicalizeSpec(input) === expected` at `:105`, and carries its own `names.length > 0` control at `:97-99` - so a new pair is picked up with no wiring, and its `.expected` pins the canonical **string**, not merely a digest. The directory README already records that the `.input`/`.expected` extensions exist so the `specs/**/*.md` corpus walker never sees them.

| pair | shape | what it discriminates |
|---|---|---|
| `ownership-five-keys-inline` | all five keys in scalar/inline form: `status: implementing`, `phases: {specify: done, plan: in-progress}`, `implements: packages/a/src/x.ts, packages/a/src/y.ts`, `affects: [packages/b/src/z.ts]`, `implements_reason: because` | the strip reaches all five on the simple form |
| `ownership-five-keys-block` | the same five keys in **block form over indented children**: `status:` alone over `  implementing`, `phases:` over `  specify: done`, `implements:`/`affects:` over `  - ...` items, `implements_reason: >-` over a folded block | AC-3's trap. Under a `status:`-branch implementation the child lines survive as orphans (FR-2's normative trap, requirements.md:248-252) and `.expected` pins their absence as a string, so the fixture is red against the wrong branch on the canonical **form**, not only on a digest |
| `ownership-block-internal-blank` | an `implements:` block **and** a `phases:` block each carrying a blank line *between two indented children* | the blank-line rule this slice adopts. **The existing `phases-blank-terminated` pair does NOT discriminate it** - read at HEAD: its blank line is followed by `epic: EPIC-002`, a non-indented line, so both the old rule and the new produce the identical output it already pins. Its green must not be read as the blank-line fix being pinned |
| `ownership-absent-control` | no ownership key anywhere; `status:` and `phases:` in both forms, including a `phases:` block with an internal blank line and further children | AC-2's control clause. Without it, "all three differ from the pre-change hash" is satisfied by *any* canonicalizer change whatever |

**Golden pre-change digests, committed as literals.** In slice 1, **after** the blank-line fix and in the same commit, `preStripSpecHash` is run over the four fixtures and each result is committed beside its `.input` as `<name>.prestrip-sha256` - a literal 64-hex line, not a call, so slice 8 compares against a frozen number that cannot drift with the function it is measuring. Ordering is load-bearing: minting the literals before the blank-line fix would bake the pre-fix form into the reference and entangle AC-2's control with a change it does not control. (`.prestrip-sha256` is invisible to the golden loop, which filters on `.input` at `canonical.test.ts:94`.)

**The three-way harness, per fixture, in `packages/minspec/tests/canonical.test.ts`.**

1. `tsHash = specHash(input)`.
2. `srcHash` = `execFileSync('python3', [<repo>/scripts/hooks/canonical.py, '--hash', <input path>], { encoding: 'utf-8' }).trim()` - the `--hash` CLI at `scripts/hooks/canonical.py:88-94`, the call shape `packages/minspec/tests/canonical-parity.test.ts:52-56` already uses.
3. `embedHash` - import `CANONICAL_PY` from `packages/minspec/src/lib/ci-review-templates.ts:3209` (a `decode(...)` call evaluated eagerly at import; `decode` at `:25`), write it to a temp file, run the same `--hash` invocation against it. It needs no shebang (`stripShebang: true`, `scripts/gen-ci-templates.mjs:136-139`) and imports nothing outside the stdlib.
4. **Agreement:** all three equal.
5. **Anchored to the canonical STRING, not only to each other:** all three equal `sha256hex(readFileSync('<name>.expected'))`. Both twins define the digest as sha256 over the utf-8 canonical form (`packages/shared/src/canonical.ts:126-128`; `scripts/hooks/canonical.py:83-85`), so the golden `.expected` is a shared anchor that pins the two Python arms' canonical **form** with no `--canonical` CLI arm added to `canonical.py`, which would change a managed template and change what every adopter receives. It also discharges FR-2's "a fixture MUST pin whichever is chosen, **in both twins**" (requirements.md:258-259) for every pair in the directory automatically, which matters because `scripts/hooks/test_canonical.py` - the other consumer of these pairs - is in no CI harness (INV-5).
6. **Basis move, positive** (slice 8): for the three ownership-carrying fixtures, each of the three hashes differs from that fixture's `.prestrip-sha256` literal.
7. **Basis move, negative - AC-2's "exactly" half** (slice 8): for `ownership-absent-control`, each of the three hashes **equals** its literal.

Before slice 8, clause 6 inverts and clause 7 holds: all three equal the literal for all four fixtures, which is the frozen copy's corpus pin restated on the fixtures. The same assertions, opposite polarity, in both merged states.

**On "no test executes the embed", corrected.** No test ever **invokes** the embed to produce a hash - though one does load it. `packages/minspec/tests/managed-script-dependencies.test.ts:134-148` spawns `python3` on the scaffolded `scripts/approval-provenance.py`, which executes `from canonical import spec_hash` at load (`scripts/approval-provenance.py:50`) against the scaffolded `scripts/hooks/canonical.py`, rendered from the embed (`packages/minspec/src/lib/template-registry.ts:2203-2206`, `name: 'canonical-hasher-python'` / `outputPath: 'scripts/hooks/canonical.py'` / `content: CANONICAL_PY`). So that test witnesses "the embed imports cleanly", never "the embed computes the same hash". The only test naming `CANONICAL_PY` (`packages/minspec/tests/canonical-parity.test.ts:25`) binds that name to the path of the **source** `scripts/hooks/canonical.py` and runs *that* via `execFileSync` at `:53`. And `packages/minspec/tests/ci-review-templates-gen.test.ts:18-26` byte-compares the whole generated file against a fresh render, which witnesses *the embed matches its source* and not *the embed computes the same hash*. Hence the machinery above.

**The harness fails, never skips, when `python3` is absent**: `canonical-parity.test.ts:66-71` collapses its entire corpus into one `it.skip` and returns before the per-file loop is registered, and that is the precedent this must not copy.

### AC-3 (FR-2, the branch trap)

`ownership-five-keys-block` above is the fixture, and it is red against a `status:`-branch implementation on the canonical **string**, not only on a digest. Verified in both twins: `phases` opens a block (`packages/shared/src/canonical.ts:73-76`) while `status` merely continues (`:77-79`); the Python twin is identical (`scripts/hooks/canonical.py:47-49` vs `:50-51`). All three new keys are block-capable, so the `status:` branch would leave every block-form ownership item's child lines inside the hash - the widening would silently fail for exactly the specs it matters most for.

### AC-4 (FR-3)

Discharged by #1976, already built and reviewed, which carries `packages/minspec/tests/ownership-list-parity.test.ts` (verified present on the branch at `947917ee`). The Plan's task is rebase, re-review, merge.

### AC-5 (FR-4, round-trip) - the read side, in the test AC-5 is assigned to

**[fix]**: the earlier mechanism read the written file, `JSON.parse`d it and asserted `hasOwnProperty` + `length > 0` + deep equality. That is a **write-side** assertion and AC-5 is a **read-side** one (requirements.md:731-736); it stays green even when `normalizeRecord` discards the field, which is the headline hazard this design documents. `normalizeRecord` (`approval-store.ts:121-136`) is a whitelist constructor over seven named fields (`:124-130`) plus one conditional `reviewStart` spread (`:132-134`) with **no `...r`**, and `readRecord` is `isValidRecord(parsed) ? normalizeRecord(parsed) : undefined` (`:153`) - so a field can pass validation and be dropped one function later, silently.

The read side therefore lands in `packages/minspec/tests/owned-at-approval.test.ts` (the file AC-5 is assigned to, requirements.md:848-850, and on the allowlist at `:1015`):

```ts
const OWNED = ['packages/a/src/x.ts', 'packages/b/src/y.ts'] as const;

it('writeRecord -> readRecord preserves a non-empty ownedAtApproval', () => {
  writeRecord(tmp, rec(SPEC_REL, { ownedAtApproval: [...OWNED] }));
  const back = readRecord(tmp, SPEC_REL);
  expect(back).toBeDefined();
  expect(back?.ownedAtApproval).toEqual([...OWNED]); // literal on BOTH sides
  expect(back?.ownedAtApproval?.length).toBe(2);     // never 0, never undefined
});
```

Both clauses are load-bearing. `toEqual` treats an `undefined`-valued key as absent, so `expect(back?.ownedAtApproval).toEqual(r.ownedAtApproval)` is green when `normalizeRecord` drops the field *and* the fixture never set it - the vacuous pass AC-5 names in its own words. The literal right-hand side removes the shared-`undefined` mode; the `length` clause removes the empty-array one; and neither depends on `rec()`.

**The second, independent witness - named here because the placement is invisible and nothing enforces it.** `rec()` at `packages/minspec/tests/approval-store.test.ts:25-36` is a fixed literal (7 fields) plus `...overrides` at `:34`. Adding a non-empty `ownedAtApproval` to the **literal body** - not through `overrides` - arms the pre-existing round trip at `:84-88`, whose assertion is `expect(readRecord(tmp, specRel)).toEqual(r)` (`:87`): with the field in the literal, `r` carries a real array and a `normalizeRecord` that drops it turns `:87` red. Put the value in `overrides` instead and `:87` still passes with the field dropped on both sides, and nothing in the repo notices. There is no gate for this, so it is recorded here and backstopped by the `length` assertion above, which lives in AC-5's own test.

**The back-compat negative, in the same file:** a record built with the field omitted round-trips with the key still **absent** - `expect('ownedAtApproval' in (back as object)).toBe(false)`, not `toBeUndefined()`. Absent and present-as-`undefined` are different on-disk states and `[]` is a signed third state; this is the assertion that keeps `normalizeRecord` from copying the `baselineBlob` pattern at `:130`, which deliberately coerces absent to `''` and is the forged-witness shape here.

### AC-6 (FR-4, producer - the value, not the key)

Temp workspace; spec declares two real owned paths, one **bareword** (no `/`, dies at normalisation step 3) and one **wrong-extension** path (dies at step 8). Run the real `approveSpec`. Assert on the **raw file text**, following `packages/minspec/tests/approval-store.test.ts:95-100` (verified: it reads `fs.readFileSync(sidecarPath(tmp, specRel), 'utf-8')` at `:97` and asserts on the text at `:98-99`; the spec cites the surrounding `:94-99`) and explicitly **not** `packages/minspec/tests/approve-baseline.test.ts:467-476`, whose only assertion is `expect(readBack?.baselineBlob).toBe(record.baselineBlob)` at `:475` and is green when both sides are absent. Read the file text, assert it contains `"ownedAtApproval"`, `JSON.parse` it directly rather than through `readRecord`, and assert the array **deep-equals** `structuredOwnedSet`'s output for that spec and has exactly two members. A producer writing `[]`, the raw untokenized strings, or a pre-#1976 set all fail.

### AC-7 (FR-5) - two roots, because the corpus can only witness what the corpus contains

**[fix]**: the earlier design specified one `importlib` subprocess dumping `{specPath: sorted(owned set)}` "for the whole corpus", and that harness cannot reach a single one of AC-7's seven named fixtures - they are synthetic shapes, not corpus entries, and the fuzzy arm needs a sibling `tasks.md` no corpus entry supplies. This matters more than usual because the corpus is the population this design elsewhere proves is free of every edge case (zero non-ASCII hits on the divergence, zero inline-comment hits): the fixtures **are** the non-vacuous half.

**No gate change is needed for either root - verified, not assumed.** `owned_file_set(cwd, sp, fm)` (`scripts/hooks/spec-gate.py:377-388`) is a pure function of its three arguments, delegating to `declared_impl_files(cwd, fm, os.path.dirname(sp))` (`:306-374`), and `main()` is behind `if __name__ == "__main__":` (`:563-564`), so `importlib`-loading the module executes nothing and reads no stdin. Passing `cwd=<fixture root>` and `sp=<fixture root>/specs/FX/requirements.md` puts the whole resolution inside the fixture tree, including the fuzzy `tasks.md` read (`:366-373`) and its existence check (`:357`). No CLI arm is added to the gate; its stdin/argv path stays byte-identical.

- **Run A - corpus.** `cwd = REPO_ROOT`, every T3/T4 spec under `specs/`.
- **Run B - fixtures.** A hermetic temp tree built by the test with `mkdtempSync` + `writeFileSync`, **never committed**: a committed `.md` fixture under `specs/` would join the real corpus, and one outside it still has to dodge every corpus walker - the reason `packages/minspec/tests/fixtures/canonical/README.md` gives for its own extensions. Seven spec directories, one shape each:

| fixture | shape | expected, in both twins | arm exercised |
|---|---|---|---|
| `inline-comment` | `implements: packages/a/src/x.ts # see packages/b/src/y.ts` | `{packages/a/src/x.ts, packages/b/src/y.ts}` - the comment path **is** owned | the section 3 decision |
| `implements-none` | `implements: none` | `{}` - `none` has no `/` and dies at `:343`; the gate has no `'none'` comparison anywhere | no-slash reject |
| `nonexistent-path` | `implements: packages/ghost/src/nope.ts`, file absent | `{packages/ghost/src/nope.ts}` - structured tokens are `require_exists=False` (`:361-364`), creation-blocking | existence filter NOT applied |
| `parent-escape` | `implements: ../outside/src/x.ts` | `{}` | reject at `:349` |
| `infra-prefix` | `implements: node_modules/pkg/index.js` | `{}` | reject at `:351` against `_INFRA_PREFIXES` (`:296`), case-sensitive |
| `non-source-ext` | `implements: packages/a/docs/notes.txt` | `{}` | reject at `:353` by `_SRC_EXT_RE` (`:293-295`) |
| `fuzzy-tasks` | no `implements:`/`affects:`; sibling `tasks.md` backticking `packages/a/src/real.ts` (written) and `packages/a/src/ghost.ts` (not written) | `.full = {packages/a/src/real.ts}`, `.structured = {}` | `_CODE_SPAN_RE` (`:297`) plus the existence filter at `:357`, which applies to the fuzzy arm only |

**Both set pairs are compared, not only the full one.** AC-7's main clause compares the full sets, but the set actually **signed** into `ownedAtApproval` and driving the FR-6 drift comparison is the structured one, and comparing only the full pair leaves the signed set with no Python parity witness at all. FR-6 already forces a Python structured-only computation into existence - it must compare the snapshot against "the spec's current **structured** owned set" (requirements.md:377-379) - so `declared_impl_files` gains `include_fuzzy=True` in slice 4 and the dumper emits **two** sets per spec; runs A and B each assert both pairs. This asserts more than AC-7 requires and needs no amendment: ceremony is upward-only.

**Three anti-vacuity clauses, because a normalizer that rejects everything passes naive parity.**

1. The fixture dump is non-empty and names all seven fixtures.
2. At least one token is **accepted** and at least one **rejected** per filter arm. The table supplies a rejection for each of `:343`, `:349`, `:351`, `:353` and an acceptance for the comment path, the non-existent structured path and the existing fuzzy path.
3. The union of all accepted paths across the seven fixtures is asserted as a literal set, so "both sides returned `{}`" can never be a pass.

**AC-7's separate structured-vs-full pin.** A named `it()` asserts `ownedSets(SPEC-017).structured` is exactly `[]` while `.full` is non-empty and equals the Python `owned_file_set` for the same file. Measured at HEAD: SPEC-017's structured set is **0** and its full set is **22**, and **3** of its files are in SPEC-070's own `affects:` list - which is why snapshotting the full set would deadlock this very spec. The full-set count is re-measured at the Plan's commit; the spec's "22" is not quoted forward, it is re-derived and happens to agree.

**The harness fails, never skips, when `python3` is absent**, unless an explicit local-dev opt-out env var is set (`canonical-parity.test.ts:66-71` is the precedent not to copy; there is no `python3` setup step in `.github/workflows/ci.yml`, so availability is an implicit runner-image property). This test is the precondition for a corpus-wide signed write, so a skip is the difference between proving parity and assuming it (INV-1).

### AC-8 (FR-6, removal direction)

Approved spec with `ownedAtApproval: ["packages/x/src/a.ts"]`, frontmatter rewritten to `implements: none`, the real hook must **deny** a write to `packages/x/src/a.ts`. Built as a **state** fixture in slice 4 per the rule in section 2: the sidecar is minted against the **post-edit** bytes with `python3 scripts/hooks/canonical.py --hash <spec>`, or the record resolves `stale` and the deny fires for the wrong reason - it would land in `blocking` at `spec-gate.py:512-513` with the empty `owned_file_set` computed at `:510`, produce an empty `matched` at `:519-520`, and **allow**. Re-run as a sequence fixture in slice 8.

### AC-9 (FR-6, addition direction) - release and the negative half, both given mechanisms

Four probes on one fixture, all through the real hook. The record carries `ownedAtApproval: ["packages/x/src/a.ts"]`; the spec's current `implements:` names `a.ts` and `b.ts`; `c.ts` exists in the workspace and is named by neither the declaration, nor the snapshot, nor `tasks.md`.

1. write `a.ts` (snapshot only) -> **deny**;
2. write `b.ts` (declaration only) -> **deny**. Together these are AC-9's "both the old and the new path";
3. write `c.ts` -> **allow**. This is AC-9's "freezes nothing outside the union", which the earlier design named only for AC-19's creation case;
4. **the ack.** Rewrite the sidecar's `ownedAtApproval` to `["packages/x/src/a.ts", "packages/x/src/b.ts"]` and re-mint `specHash` with `python3 scripts/hooks/canonical.py --hash <spec>` (`canonical.py:88-94`); probes 1 and 2 must both flip to **allow**. Without this probe AC-9's "until acked" has no assertion at all, because slice 4 ships no producer.

Probe 4's hand-built ack is deliberately weaker than the real thing, so it does not remain the only witness: **slice 5 re-runs probes 1, 2 and 4 with the real `approveSpec` as the ack**, asserting that the value the producer writes is the value that releases the freeze. That binds AC-9's release to the producer rather than to a hand-edited file, and it catches a producer writing a correctly-shaped but wrong-valued snapshot - the same failure class AC-6 exists for, observed from the gate's side.

### AC-10 (FR-7, reach) - the hoist, stated as a code move rather than as an intention

Measured first, on the shipped hook: a T4 spec with **no `phases:` block**, `status: implementing`, `implements:` naming a real existing file, and no sidecar does **not** block a write to that file - `allow`. The mechanism is `phase_intent_status({}, None)` returning `"new"` (`spec-gate.py:201-230`; `_all_pending` at `:178-179` reads every phase as `pending` when the map is empty), so the loop hits `continue` at `:501` before any owned set exists. That `continue` is nine lines above the owned-set call at `:510`. 30 of the 31 skipped T3/T4 FILES being phaseless (re-measured at HEAD `03a9c570` through the gate's own functions; by spec id it is 23 of 24). The spec states 17 of 18 at requirements.md:765, measured at `719878d6` - quoted forward it would breach requirements.md:866-867, which requires the Plan to re-run its own measurements is the census the digest design died on; this is the mechanism underneath it.

Two moves, both above the `continue` at `:501`.

1. **`owned_file_set` is hoisted.** `files = owned_file_set(cwd, sp, fm)` moves from `:510` to immediately after `phases = parse_phases(fm)` (`:474`). The two existing readers (`:512-513` and `:514-516`) read the hoisted local, unchanged. This is a pure hoist and provably value-preserving: `owned_file_set` (`:377-388`) and `declared_impl_files` (`:306-374`) read only `cwd`, `fm`, the spec's own directory and the filesystem - no loop-carried state, no mutation of anything the loop owns. The cost is one extra `tasks.md` read per **out-of-band** T3/T4 spec, and nothing else changes.
2. **The structured-only subset comes from an additive, default-preserving parameter - not from the split this design rejects.** `declared_impl_files(cwd, fm, spec_dir_abs, include_fuzzy=True)` gains one keyword argument that guards only the fuzzy block at `:366-373`. Every existing call site keeps its exact signature and its exact value, which is what AC-11's byte-identical companion requires; the structured half is `include_fuzzy=False`, which performs **no I/O at all**, because the only I/O in the function is the `tasks.md` read it skips. This is not "refactoring `declared_impl_files` into split functions": the function, its name, its default behaviour and its return type are unchanged. It is also the only way this design's own sentence - "the structured half is computed above the band into a local" - can be made true, because `owned_file_set` returns the merged set and nothing else in the module exposes the structured half.

AC-10's test drives the **real hook** (`spawnSync('bash', [hookPath], ...)`, the precedent at `packages/minspec/tests/spec-gate.test.ts:84-89`) against a phaseless fixture whose record is approved and whose `ownedAtApproval` differs from its current structured set, and asserts a deny naming the drift verdict. **Anti-vacuity control in the same test:** the identical fixture with the snapshot equal to the current structured set must return `allow`. Without that control the deny is attributable to the spec merely having become visible to the gate, which is a different and much weaker fact than the one AC-10 asserts.

### AC-11 (FR-7, per-record evaluation) - both companions given executable witnesses

**The differential harness, named.** The "before" value comes from a **frozen copy of the gate**, not from a hand-written expected list authored by the same change and not from a git ref (a ref is unavailable in a shallow CI clone). `packages/minspec/tests/fixtures/spec-gate-pre-fr7.py` is a verbatim copy of `scripts/hooks/spec-gate.py` taken at the start of slice 4 and committed alongside it - the same freeze-a-copy device slice 1 uses for `canonical-pre-ownership-strip.ts`, for the same reason: an assertion about "before" can only be written while "before" still exists. It must **not** carry a frozen `canonical.py`. The gate resolves its hasher by `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` followed by `import canonical` (`spec-gate.py:88-89`), so the harness stages the frozen gate into a tempdir **together with a copy of the live `scripts/hooks/canonical.py`**. Both arms then share one basis, and slice 8's widening applies to both - which is what stops this assertion going red for a reason that has nothing to do with FR-7.

**What is compared.** `blocking` is a local and is not observable directly. The harness makes it observable by probing: for a fixture with a known, finite candidate-path vector it sends one envelope per path through each arm and compares the full `(decision, reason)` vectors. The reason names each blocking spec through `_blocker_reason` (`:300-303`), so the vectors distinguish `not approved` from `approval stale` per spec id. Two fixture conditions are required or the comparison is not about `blocking` at all:

- **No post-change-only deny sources.** Every approved record in the fixture carries a well-formed `ownedAtApproval` equal to its current structured set, so neither the FR-6 drift path nor the FR-8 witness path contributes and the only deny source in either arm is `blocking`.
- **At most one spec owns each probed path**, so the reason string holds exactly one name and the comparison cannot turn on `blocking`'s iteration order.

**The dedup companion, made non-vacuous rather than order-dependent.** The `seen_ids` dedup at `:505-507` sits **below** the band, so an out-of-band sibling never reaches it; moving it above would let that sibling claim the id and drop an in-band sibling's `blocking` contribution - fail-open under constitution invariant 2. Whether that failure is *observable* depends on which sibling `glob.glob` yields first (`:450`, unsorted), so a naive fixture passes for the wrong reason roughly half the time. The harness closes that with the anti-vacuity shape used elsewhere here: it first runs a probe that prints the actual `glob.glob` order for the materialised fixture and **asserts the hazardous order (out-of-band sibling first) was observed**, re-materialising under different names for a bounded number of attempts and **failing the test outright if it cannot produce that order**. Only then does it assert the in-band sibling's deny. A test that cannot reach the state it polices must fail, not pass.

The design deliberately does **not** add `sorted()` to the glob to make this deterministic: sorting changes the order of names inside a multi-blocker deny reason, which is the very string the differential compares, and it is a behavioural change to the gate in the slice whose companion assertion is "byte-identical".

### AC-12 (FR-8, absence) - the second direction, opened and settled

I drove the real hook rather than reasoning about it. The claim that this AC is unsatisfiable is **confirmed for the degenerate fixture and refuted as an absolute**, and the difference between the two is one file in the fixture.

*What is confirmed.* Both `deny(...)` calls (`spec-gate.py:530-536` and `:538-545`) sit inside `if matched:` at `:522`; `matched` is `owned_match(rel, fil)` over `blocking` (`:519-520`); and every `blocking` entry carries the set returned by `owned_file_set` at `:510` (appended at `:512-513`). `implements: none` contributes nothing, because the token has no `/` and dies inside `consider` at `:343`. Measured on the **shipped, unmodified** hook against a hermetic temp repo: a T4 spec in the implementing band with `implements: none`, **no `tasks.md`**, and **no sidecar at all** - verdict `unapproved`, the hardest non-approving verdict the gate has - returns `permissionDecision: allow` for a write to a real source file in that workspace. An empty owned set makes the verdict label irrelevant, so a `witness-missing` verdict appended to `blocking` inherits the same dead end. FR-8 clause 2 concedes this in its own words (requirements.md:460-462).

*What is refuted.* The freeze scope is the **full** owned set, not the structured one - FR-5 states it normatively (requirements.md:342: "The full `owned_file_set` - structured plus fuzzy - remains the gate's **freeze scope**") - and the fuzzy `tasks.md` arm (`:366-373`) runs unconditionally, with no guard on what the structured arm produced. Adding one line to that same fixture's `tasks.md` naming an **existing** source file flipped the same hook from `allow` to `deny` (measured, same tempdir, one file added; a `tasks.md` token naming a non-existent file was correctly excluded by the `require_exists` filter at `:357-358`).

*End-to-end proof of the resolution.* I then simulated the post-slice-8 world entirely outside the repo: a copy of `canonical.py` with `implements`/`affects`/`implements_reason` added to the strip through the `phases:` branch, and a copy of `spec-gate.py` appending `(sid, "witness-missing", files)` to `blocking` for an approved record failing the FR-8.1 predicate. Sequence: mint the sidecar with the widened hash and **no** `ownedAtApproval`, then rewrite `implements:` to `none`. The canonical hash was byte-identical across the rewrite, so the record still resolved **approved** - the AC's own precondition, which is unobtainable before the strip. A write to the `tasks.md`-named file was **denied** with a reason naming the missing witness; a write to a real file in neither set was **allowed**; and with `tasks.md` removed the identical state returned `allow`.

**The design takes (a): the AC-12(2) fixture's `tasks.md` backticks one existing real source file, so the full set is non-empty.** Three consequences are normative.

1. **The missing-witness freeze scope is a value, not a rhetorical position: the current FULL owned set** - structured union fuzzy, computed above the phase band per AC-10. Reconciled against FR-8.2 in one sentence: FR-8.2 forbids "the current declaration taken as the whole set", and this is not that set - in the fixture the declaration is empty and the entire freeze comes from the fuzzy arm, a signal `implements:` does not control. The test asserts the scope by probing a path vector (fuzzy-named -> deny, unrelated existing file -> allow), so the scope is an assertion rather than prose.
2. **The residual is named and routed, not hidden.** A spec whose *full* set is empty and whose record carries no witness cannot be denied by any write-gate, because there is no file to deny. That is the case FR-8.2 concedes and routes to clause 3. The same test therefore also asserts the FR-8.3 validator rule fires at **error** level on that exact corpus state, so the uncoverable half of clause 2 is covered by clause 3 rather than by an assertion that cannot fail. Both halves live in one test file so the routing is visible to a reader of the suite rather than only to a reader of this document.
3. **The fixture must not be confusable with the SPEC-017 shape.** SPEC-017's structured set is empty and its fuzzy set is not (measured: 0 and 22), and AC-19's mirror requires that a record seeded `[]` in that shape is **not** a missing witness. The AC-12(2) fixture is distinguished from it only by the **absence of the witness key**, not by the shape of its sets. The two cases therefore run over the same fuzzy-arm shape in the same file and differ in exactly one field, which makes the discriminator explicit and stops either test passing for the other's reason.

The first direction (spec still declaring its paths, no snapshot) is the straightforward half and uses the state-form fixture from section 2.

### AC-13 (FR-8, malformed) - the Python predicate written out, and the twin clause bound to a subject that exists

*The predicate, positively stated.*

```python
v = rec.get("ownedAtApproval")
witness_ok = isinstance(v, list) and all(isinstance(x, str) for x in v)
```

Anything else - absent, JSON `null`, `"packages/x/a.ts"`, `{}`, `[1]` - is a **missing witness**. No coercion anywhere, and in particular not `set(rec.get("ownedAtApproval") or [])`, which requirements.md:452-454 already identifies as turning a bare string into single characters `owned_match`'s lower-casing can never match. Run over all six shapes: `None`, `"packages/x/a.ts"`, `{}` and `[1]` are all False; `[]` and `["a/b.ts"]` are both True. `[]` being **True** is load-bearing rather than incidental: AC-19's mirror requires a record seeded `[]` to be a valid witness that does not drift, and a predicate written as truthiness rather than as type would silently fail that and freeze SPEC-017's shape.

*Which of AC-13's four shapes are distinguishable.* `rec.get("ownedAtApproval")` returns `None` for both an absent key and a JSON `null`. The **verdict** is identical for both, so the predicate needs no membership test; the four fixtures AC-13 names remain four distinct inputs, and the `null` fixture and an absent-key fixture are asserted for the same outcome rather than for different ones. Where the distinction is needed - Rule 20's report line, which must name which shape it found - use `"ownedAtApproval" in rec`, which does separate them.

*The TypeScript twin, and the one place the twins deliberately differ.* `isValidRecord` (`approval-store.ts:96-112`) gains the clause printed in section 3, modelled on the `baselineBlob` clause at `:108` whose comment at `:106-107` records why absent must stay valid. The same applies here with a measured population: **0 of 64** sidecars carry the field at HEAD, so requiring it would drop the entire corpus. The consequence is a deliberate, stated asymmetry:

| value | Python gate | TypeScript |
|---|---|---|
| well-formed list (incl. `[]`) | approving | record kept, resolves normally |
| malformed (`null`, bare string, `{}`, `[1]`) | missing witness -> non-approving | `isValidRecord` false -> `readRecord` returns `undefined` (`approval-store.ts:153`) -> `resolveStatus` returns `'unapproved'` (`approval.ts:487`) -> non-approving |
| **absent** | missing witness -> non-approving | record kept -> resolves `approved` |

AC-13's subject is the **malformed** row, where the twins agree, so AC-13's twin clause is satisfiable exactly as written. The **absent** row is AC-12's subject, is Python-only by design, and is made unreachable in the corpus by FR-8.3 plus FR-9.10 rather than by teaching `isValidRecord` to drop 61 legacy records. Stating this asymmetry is required, because the obvious implementation of FR-8.1 - make the field mandatory in `isValidRecord` - does exactly that and is the `baselineBlob` trap repeating.

*"Same freeze scope", bound to a real TypeScript subject.* There is no TypeScript freeze: `grep -rn permissionDecision --include='*.ts' packages/ scripts/` outside tests returns nothing, so the only deny surface in the repo is `spec-gate.py:530-536` / `:538-545`. The clause is therefore bound to the FR-5 function instead. For each malformed fixture the test asserts (i) both twins are **non-approving for the same spec file**, and (ii) `owned-set.ts`'s **full** set for that fixture equals the freeze scope the Python hook actually applied, read back from the probe vector of allowed and denied paths. Assertion (ii) has a genuine TypeScript subject, reuses AC-7's mechanism, and can fail. The alternative reading of AC-13 - identical internal classification - is not adopted, because it would require weakening `isValidRecord` away from the shape the spec's own Contract fixes at requirements.md:662-668. Flagged because the spec's wording admits both readings.

One mechanical trap the TypeScript assertions must avoid: `normalizeRecord` is a whitelist constructor with no `...r`, so `ownedAtApproval` is invisible to every `readRecord` consumer until it is added there. The test must read the field through a record that has passed the **extended** `normalizeRecord`, never assume a round-trip carries unknown keys.

### AC-14 (FR-8.3, the corpus gate) - Rule 20's predicate, and its fail-visible directions

The harness is the strongest part of this criterion and is unchanged: `spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: fixtureDir, encoding: 'utf-8' })`, which works because `scripts/validate-frontmatter.ts:42` is `const ROOT = process.cwd()`, following the precedent at `packages/minspec/tests/validate-frontmatter-claim-words.test.ts:42-43` (`const result = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' });`, with `TSX_BIN` resolved by absolute path at `:33` for the offline reason its own comment gives). The script exits 1 on errors (`:737-738`), so a fixture-corpus test can genuinely fail. And **Rule 20 reads the sidecar tree raw, never via `listRecords`**, because `isValidRecord` drops a malformed record, so a `listRecords`-based rule is structurally blind to exactly the sidecars it exists to catch.

**The gap, and its repair - [fix].** Rule 20's subject is an *approved* record lacking a witness, and the validator has no notion of approved-ness: it computes no spec hash at all (its only approval import is `listOrphanedRecords` at `:34`, used by Rule 10 at `:446`). So the predicate must be stated, not assumed:

- **Approved-ness.** For each tracked sidecar, read `specPath` and `specHash` from **raw JSON**; read the spec file; approved iff `specHash === specHash(<spec bytes>)` under the **shipped** hasher, imported from `@aiclarity/shared` (the import resolves from `scripts/`, as `scripts/migrate-approvals.ts:42` demonstrates). Shipped is the correct basis here: Rule 20 asks "is this record live now", not "which basis minted it" - that is Rule 21a's question.
- **The fail-visible direction, which is the whole point.** A spec file that is **absent or unreadable** is a **FATAL** for that sidecar, naming it, never a `continue`. Skipping is the asymmetry that stranded SPEC-004 (the validator flagged dangling refs and never missing ones), and INV-1 forbids it here explicitly. The rule does not wrap its body in the Rule 12 shape at `:553-556`.
- **The malformed shape is named in the failure text** using `"ownedAtApproval" in rec` so absent and `null` are reported distinctly, even though both produce the same verdict.
- **Anti-vacuity, for Rule 20 as well as Rule 21 - [fix] for the INV-1 residual.** A module-level counter increments per evaluated record, and the rule fails with "Rule 20 validated NOTHING this run" when that count is zero while the sidecar tree is non-empty, following `scripts/validate-frontmatter.ts:317`, `:355`, `:721`, `:727`. This is the part that does not depend on anyone remembering a prose rule: `scripts/check-swallowed-gate-signal.ts` walks `.sh` files only (`:56`, `:67`), so no lint can see a swallowed TypeScript catch. ➡️ Widening that lint to `.ts` is out of scope here and must be filed, or this paragraph is the only thing holding the line.

**Falsifiability, by construction.** At HEAD, 0 of 64 sidecars on disk carry the field (verified: `grep -rl '"ownedAtApproval"'` returns 0). Rule 20's population is TRACKED sidecars, and `git ls-files '.minspec/approvals/*.json'` returns 61, of which 58 are fresh - so Rule 20 is red for **58** records today, not 61. It becomes 61 only once section 2's first precondition commits the three untracked SPEC-066/067/070 sidecars - which is exactly why it lands in slice 7, after slice 6 seeds. Its red-then-green transition across slices 6 and 7 is its own liveness proof; the fixture-corpus test then pins both directions permanently: the malformed/absent corpus errors and exits 1, and the same corpus with a well-formed witness passes.

### AC-15 (FR-9, pre-flight) - the abort half made falsifiable by data alone

AC-15 is assigned to slice 8, and that assignment is what makes both aborts reachable: at slice 8 the shipped hasher is widened and the frozen `preStripSpecHash` is not, so the two bases genuinely differ and a fixture corpus can be built on either side of that difference. The two hashers differ on a file exactly when its frontmatter carries one of the **three new** keys - **not five**. `status` and `phases` are stripped identically by both hashers (`scripts/hooks/canonical.py:32-33`, `_strip_lifecycle` at `:37-53`), so a corpus full of them proves nothing. That precision is what makes the fixtures below actually trip.

- **Rehash-mode two-bases abort.** Fixture corpus A: every spec carries `status:` and `phases:` and **none** carries any of the three new keys; every sidecar is fresh. No record classifies differently under the two bases, so the pre-flight must abort with a non-zero exit and the two-bases message, writing nothing. **Anti-vacuity control:** corpus A plus one spec carrying `implements: packages/x/src/a.ts` with an old-basis-fresh sidecar - that record is fresh under `preStripSpecHash` and stale under the shipped `specHash`, the pre-flight proceeds, and the run writes. The two fixtures differ by one frontmatter line, so a pre-flight that is stuck-aborting fails the control and one that is stuck-passing fails the abort.
- **Seed-mode equality abort.** Seed mode's pre-flight asserts `preStripSpecHash(raw) === specHash(raw)` for every corpus file. Fixture corpus B is corpus A plus one spec carrying `implements:` - post-slice-8 the two hashers disagree on that file, so seed mode must abort. This is not a manufactured trigger: it is exactly the state seed mode must refuse, because seeding is licensed only by old-basis freshness (requirements.md:552-555) and old-basis freshness is unprovable once the strip has landed. Control: corpus A, where the equality holds and seed mode proceeds.
- **Seed-mode anti-vacuity abort, reachable in every era.** A corpus in which every old-fresh record's structured set is empty trips "at least one seeded set must be non-empty". Control: the same corpus plus one spec declaring a real path. This abort needs no strip and is the falsifiability proof for any **slice-6** run of the seed pre-flight.

**Residual, stated.** Before slice 8 the seed-mode equality check cannot be driven into abort by data, because `preStripSpecHash` is a verbatim copy of the live hasher at that moment and the two agree on every possible input. No injection seam is added to manufacture a failure - an injectable hasher is a second minting basis with its own blast radius, and a pre-flight that can be told what to conclude is not a gate. Slice 6's falsifiability rests on the anti-vacuity abort instead. This is a narrower claim than "AC-15 is discharged in slice 6", and it is the honest one. ➡️ The AC-15 amendment requested in section 5 is still required and is not removed by any of the above.

### AC-16 (FR-9, refusal) - the three-cohort fixture that makes the report half falsifiable

The mechanism half is sound and I re-confirmed its three load-bearing facts. A sentinel string in `specHash` passes `isValidRecord` (`approval-store.ts:101` requires only `typeof r.specHash === 'string'`) and passes the Python shape check (`spec-gate.py:276-278`, the same `isinstance(..., str)` test), while the equality comparison at `:478` can never be satisfied by a non-digest - so the record is non-approving in both twins and stays **visible** to every standing check. That is also why FR-9.4's other option, leaving `specHash` absent, is rejected: it fails `isValidRecord` at `:101` and the shape check at `:276-278`, making the quarantine invisible to the corpus rule and to the run's own idempotency read.

What was missing is the report half. "Classifies it distinctly from 'already migrated' and from 'genuinely stale'" (requirements.md:792-798) is satisfied by any report with three named buckets when two of them are empty by construction - and on a first run there are no `rehashedAt` records at all, so they are. The fixture is therefore **three cohorts, all non-empty, each asserted individually**:

| cohort | construction | expected bucket |
|---|---|---|
| quarantine candidate | approve a spec with no ownership lines, then add `implements:` - stale under the frozen old basis, fresh under the shipped one (the improve signature) | `quarantined` |
| already migrated | a record pre-seeded with `rehashedAt`, the FR-9.4 exemption (requirements.md:509-515) | `skipped (already re-stamped)` |
| genuinely stale | a record stale under **both** bases - edit the body, which is hashed either way | `stale, not re-stamped` |

Assertions: each record lands in its own bucket; **all three buckets are non-empty**; the run exits 0 with `--expect-quarantine 1` and non-zero when the count does not match. Then AC-16's own clauses on the written record: `resolveStatus` returns a non-approving value (`approval.ts:483-490`), the real Python hook denies a write to a file the record owns, and `approvedBy`/`approvedAt` are byte-identical to their pre-run values.

One verdict-class note the test must pin so it does not assert the wrong reason for the right decision: a quarantine candidate is **not old-fresh**, so FR-9.10 does not seed it and it carries no `ownedAtApproval` (AC-18: "a record that was not old-fresh carries no seeded value"). Its gate verdict after quarantine is therefore the ordinary `stale` verdict (`_blocker_reason`, `spec-gate.py:301-302`) and its freeze is the current full owned set - **not** the FR-8 missing-witness verdict. Asserting the witness verdict here would go green today and rot the moment the two verdicts diverge in message or scope.

### AC-17 (FR-9, idempotency and the improve exemption)

- **Root contract, without which this AC has no test at all - [fix].** Section 5 item 4: the migration is cwd-rooted, and `packages/minspec/tests/rehash-ownership-strip.test.ts` drives it with `spawnSync(TSX_BIN, [SCRIPT], { cwd: fixtureDir, encoding: 'utf-8' })` over a temp tree holding a handful of specs plus hand-written sidecars, following `validate-frontmatter-claim-words.test.ts:33` and `:42-43`. The same gap silently blocked AC-15, AC-16 and AC-18, all four of which the spec assigns to this one file (requirements.md:1020).
- **Clause 1** (second run reports 0 quarantine candidates, writes nothing, exits 0): build a fully re-stamped fixture tree, run twice, assert the second run's report counts and that every sidecar's **raw bytes** are unchanged (`readFileSync` string equality, so key order and formatting are covered, not just parsed equality). The FR-9.4 `rehashedAt` exemption is what makes this pass rather than quarantining every re-stamped record.
- **Clause 2, rehash mode** (resume never overwrites `rehashedFrom`): interrupt after N writes by running with a cap, resume, assert the remainder completes and that the first N records' `rehashedFrom` values are byte-identical to their post-first-run values.
- **Clause 2, seed mode - [fix].** Seeding writes no `rehashedAt` (the 22-plus fresh-under-both records are seeded and never re-stamped; requirements.md:556-558 says bolting seeding onto the re-stamp cannot reach them), so slice 6's resume needs its own marker: **seed mode skips a record iff `Object.prototype.hasOwnProperty.call(rec, 'ownedAtApproval')`**, never a truthiness or length test, so a seeded `[]` is indistinguishable from a seeded non-empty set to the resume path. Regression: seed a fixture whose classified structured set is empty, re-run, assert the file's bytes are unchanged. Measured exposure if this is got wrong: **31** of the **61** old-fresh records seed to `[]`, so a length-based marker re-writes half the corpus on every run while the report claims it wrote nothing.

### AC-18 (FR-9.10, seeding)

- **Positive half:** re-run the FR-8.3 corpus check over the fixture corpus (zero approved records resolve `ownership.witness.missing`) plus a direct comparison of every seeded value against the FR-5 function's output at the migration commit.
- **Negative half - [fix], nothing in the earlier design asserted it.** The three checks previously offered all miss it: `--expect-seed N` constrains the *classified* count, not the bytes written; the post-write pass iterates the records the run believes it seeded, so a wrongly-seeded record is inside the iteration rather than caught by it; and the status vector cannot see it at all, because adding a key to a stale record's sidecar leaves its status stale (`resolveStatus` compares nothing but the hash, `approval.ts:483-490`). The assertion is therefore over the **whole sidecar tree**: for every sidecar, `hasOwnProperty('ownedAtApproval')` must hold **iff** that record was classified old-fresh in the pre-flight. Pinned in `rehash-ownership-strip.test.ts` with a fixture corpus containing at least one stale record, asserting that record's **raw JSON text** still lacks the key.
- **The live exposure is concrete:** measured at HEAD there are exactly three stale records - `specs/minspec/SPEC-007-epic-grouping/requirements.md`, `specs/minspec/design.md`, `specs/minspec/tasks.md` - and OQ-6's answer turns on two of them being left untouched and unseeded. A seeder that seeds one of them passes every other check named here.

### AC-19 (FR-5/FR-6, the fuzzy arm must not arm drift)

Split across two slices, because it is two separate failures: the creation half (a file named in a `tasks.md` backtick, no frontmatter edit, must not drift or freeze) lands with the gate rewrite in slice 4; the SPEC-017 mirror (empty structured declaration plus non-empty fuzzy set, seeded `[]`, is not a missing witness and does not drift) lands with FR-8 in slice 7, since it needs both the seed and the witness verdict to be falsifiable. The mirror shares its fixture shape with AC-12(2) and differs from it in exactly one field, per AC-12 consequence 3.

### AC-20 (FR-6, stale-then-remove)

Sequence-form from day one, as section 2 records: edit the body so the record goes stale under both bases, then rewrite `implements:` to `none`, then assert the gate still denies writes to the paths in `ownedAtApproval`. Red against a union rule scoped to approved records only - which is the alternative section 7 rejects.

### AC-21 (FR-4.6, the trusted provenance block)

Home: `packages/minspec/tests/approval-provenance.test.ts` (verified to exist; it drives the real script against real temporary git repositories - `:20` resolves `SCRIPT`, `:30-32` is the `report()` helper that runs it via `execFileSync('python3', [SCRIPT, base, head], { cwd, encoding: 'utf-8' })`, and `:22-28` is the `git()` helper that builds those repos). The spec's Tests-to-Pass assigns AC-21 to nothing and omits the file from its extend-list; this design assigns it, which needs no allowlist change because existing suites are deliberately undeclared.

**Two** assertions, because the second is the control that stops the fix being an unconditional suppression: a PR rewriting a sidecar's `ownedAtApproval` to `[]` and the spec's `implements:` to `none` (post-strip, so `specHash` is unchanged and the change rides the auto-merge docs lane - `.minspec/approvals/` is inside `DOCS_CORPUS_RE`, `scripts/lib/docs-corpus.sh:26`) reports the ownership-snapshot change explicitly and does **not** emit the bare line at `scripts/approval-provenance.py:196` (`'  previous record:   same specHash (only metadata such as approvedAt changed)'`); **and** a genuinely metadata-only change still reports as metadata-only. `_sidecar_fields` at `:100-110` (today returning only `(specPath, specHash)`) gains `ownedAtApproval` and `implementsReasonAtApproval` as substantive fields - the same extension point OQ-2(i) uses for `rehashedFrom`.

### AC-22 (FR-10) - a pin that is red on the UNCORRECTED reminder, and an elected set bound mechanically

**[fix]** on both clauses the earlier design left unenforced.

- **Clause 1 had no assertion that could fail in the uncorrected direction.** `packages/minspec/tests/spec-manager.test.ts:946` is `expect(src).not.toMatch(/ANY edit voids/i)` and the line it would have to catch, `approval-store.ts:56`, reads "Editing anything else here, or the body, voids the approval" - which does not match that regex, so the existing pin is already green on the false text and stays green if nobody corrects it. `:948` is `expect(src).toContain('`status` and `phases`')`, a change-detector that goes red only *after* someone corrects the reminder. The slice-9 edit therefore adds a **positive** pin that is red on today's text: `expect(src).not.toMatch(/anything else[^.]*voids/i)`, plus a `toContain` on the corrected five-key wording, replacing `:948`'s two-key `toContain`. `:946` stays as-is and must keep holding.
- **Clause 3's "elected" set is bound mechanically, not by intention.** Slice 9 writes the elected file list into a checked-in manifest that the new validator census rule reads, and the census is **FATAL over exactly that list** and warn-level over the remainder. Then clause 3 is a check that goes red when a listed file is left uncorrected, instead of a number a human reads. Without the manifest, correcting four of five elected sites and stopping is invisible.
- **The two free legacy sites are corrected and counted at zero, stated so nobody reads a moved number that did not move.** `specs/minspec/design.md:5` and `specs/minspec/tasks.md:5` both carry "Editing voids approval (hash in .minspec/approvals.json -> stale)", both records are stale under both bases so correcting them costs no re-approval, and measured against the spec's own `LOCK` predicate (requirements.md:924) **neither matches**, so the AC-22 census does not move when they are fixed.
- **Re-derived census at HEAD** (section 4, OQ-4): 17 frontmatter sites / 15 approved; 12 carrying the old wording / 11 approved; 11 body sites / 8 approved; union 25 / 20 approved. The elected subset is OQ-4's decision and therefore ➡️ pending.

### AC-23 (FR-11) - the negative clause, and the positive clause given a home and a behaviour

- **Negative clause** (unchanged, already well-specified): `packages/minspec/tests/managed-script-dependencies.test.ts:118-149` renders every `MANAGED_REGION_TEMPLATES` entry into a temp root (`:121-125`) and already asserts `scripts/approval-provenance.py` and `scripts/hooks/canonical.py` exist there (`:130-131`). It gains `expect(fs.existsSync(path.join(root, 'scripts/hooks/spec-gate.py'))).toBe(false)`. That assertion **can fail** - it goes red the day anyone adds a spec-gate template. The membership-count pin at `packages/minspec/tests/managed-region-enumeration.test.ts:93` (`expect(MANAGED_REGION_TEMPLATES.length).toBe(30)`) cannot fail on what AC-23 forbids, which is why the count pin alone was insufficient. Backing: `grep -c 'spec-gate' packages/minspec/src/lib/template-registry.ts` returns **0**.
- **Positive clause, half one: "widened" asserted by behaviour, not by existence - [fix].** In the same scaffold harness, run `python3 <root>/scripts/hooks/canonical.py --hash <AC-2 five-key fixture>` (the CLI at `scripts/hooks/canonical.py:88-94`) and assert the digest **equals** `sha256hex(<fixture>.expected)` and **differs from** `<fixture>.prestrip-sha256`. Two `existsSync` calls cannot say anything about widening; this can, and it is red against a merged state where the embed was not regenerated.
- **Positive clause, half two: the documented provenance behaviour, with a named home - [fix].** `report()` at `packages/minspec/tests/approval-provenance.test.ts:30-32` is generalised to take the script path (default `SCRIPT` at `:20`). The AC-23 test scaffolds the managed set into a temp git repo, mints a sidecar whose `specHash` is the **old-basis** digest computed in TypeScript by `preStripSpecHash`, and runs the **scaffolded** `scripts/approval-provenance.py` against it. The scaffolded copy imports its sibling `hooks/canonical.py` at load (`scripts/approval-provenance.py:49-50`), so the widened scaffolded hasher is the one under test. The assertion is that it reports exactly what FR-11 documents today: `MISMATCH - a real finding` (requirements.md:625-631). That is the assertion that goes red if OQ-2(ii) is ever built without amending FR-11 and AC-23 - which is the point of writing it against the spec as it stands rather than against the recommendation.
- **The OQ-2(i) suppression must not disturb this.** An adopter record carries no `rehashedFrom`, so the `was_stale` narrowing is inert for the AC-23 fixture, and the test asserts that too: the fixture's report contains no re-stamp line.

---

## 7. Alternatives rejected

Recorded because under DR-086 section 4 this list is the only review path for decisions nobody watched being made.

**Sequencing**

- **One atomic PR containing seeding, strip, re-stamp and arming** - the literal reading of FR-1. The spec forbids intent-as-enforcement in terms, a mega-PR is unreviewable, and the moment anyone splits it there is no gate left. FR-1's own words permit "an earlier merged state".
- **Seeding first, arming later** (both rival drafts' order). It leaves a multi-merge stretch where a witness exists and enforces nothing, and makes the arming slice's day-one-zero claim a re-measured number that a concurrent `implements:` edit can invalidate between measurement and merge.
- **Seeding and arming FR-8 in one merge** (the sequencing draft's own flaw). The merge that makes a missing witness fail closed would be the same merge that removes missing witnesses, resting its safety on an artifact landed inside itself. Split into slices 6 and 7.
- **A grep or source-text guard for FR-1.** AC-1 requires assertion by executing all three halves; a text guard passes on a renamed constant and fails on a reworded comment.
- **A single FR-1 witness.** Constitution invariant 2 forbids a required check hinging on one producer that one permission or config gap can disable. Two witnesses, two unconditional jobs.
- **Guarding the FR-1 body behind the probe with only a probe-level control pair.** Rejected in AC-1 above: a body that never executes cannot be shown to fail.
- **Preserving the blank-line block terminator, or fixing it inside slice 8.** Preserving means any spec that blank-separates an ownership list keeps part of its ownership inside the hash, making the change's headline claim conditionally false; fixing it inside the re-stamp slice makes its hash moves indistinguishable from the strip's in the run report **and** entangles AC-2's control with the change it controls. The naive fix (blank line becomes part of the block and is dropped) was also rejected: it would change the canonical form of every spec with a blank line after its `phases:` block, a second invisible basis change riding inside this one.

**Open questions**

- **OQ-2 (b), a hasher-version or config flag.** Two live minting bases in both twins, which is exactly the "two canonical forms" state DR-012 exists to avoid, plus a config surface with its own blast-radius questions; and a flag defaulting to old means the strip never reaches adopters until someone flips it.
- **OQ-2 (a), an adopter-side migration.** Ships a corpus-rewriting script that rewrites human sign-offs into repos MinSpec cannot test against, and adds a managed template, moving the pinned membership count at `managed-region-enumeration.test.ts:93`.
- **OQ-2 (i) as originally worded, "matches either basis at base".** Not buildable: `scripts/approval-provenance.py`'s only hasher is `from canonical import spec_hash` (`:50`), used at `:182` and `:202`. Replaced by the `rehashedFrom` suppression, which needs no second basis.
- **A scaffolded `scripts/hooks/canonical-pre-strip.py` to give the provenance tool a second basis.** A new managed template moves the count pin, and a third Python canonicalizer is a fourth twin under INV-5 with parity coverage this spec does not budget.
- **OQ-6's retirement of the three unreachable sidecars.** Measured: zero records would improve, so none is a quarantine candidate and the permanent dead end the retirement exists to avoid is never purchased, while its cost - destroying three genuine `approvedBy`/`approvedAt` sign-offs that FR-9.4 protects everywhere else - is paid immediately. (Recommendation only; the founder decides, since it inverts the spec's own.)
- **OQ-9's gate-deny on an `implements_reason` change.** Measured: 9 of the 14 in-band `implements: none` files own nothing at all, so the deny has nothing to block, and the other 5 would freeze fuzzy `tasks.md` paths on a prose edit. Wrong instrument; the alarm moves to the validator and the provenance block.
- **OQ-8's batched-ack command in this spec.** Day-one population is zero, re-approval is already the stronger per-record exit, and a bulk affordance over an approval-adjacent record with no user yet is the bulk-approve shape this repo rejects.
- **Also stripping `#` comment lines from the hash** - which would make the entire FR-10 correction wave free, permanently. A third basis change outside DR-088's decision, and it would let a human's signed rationale be rewritten silently.

**Data and gate**

- **Snapshotting the FULL owned set.** Mints a witness for paths no signature covered (`tasks.md` is outside the hashed bytes), fires on ordinary implementation progress, and deadlocks SPEC-017, whose structured set is 0 and full set is 22 - and 3 of SPEC-017's files are in this spec's own `affects:` list.
- **Using one set for both the comparison and the freeze.** Compare structured, freeze `union(snapshot, full)`. Using the full set to compare reproduces the SPEC-017 deadlock; using the structured set to freeze narrows the freeze below what the gate blocks today. Both are one-character mistakes and AC-19 catches both.
- **Scoping the drift path to approved records** (`if approval == 'approved'`). Two ordinary edits would then release the approved set - stale the record, then rewrite `implements:` to `none`. The trigger binds on snapshot **presence**; AC-20 pins it.
- **`set(rec.get("ownedAtApproval") or [])` in the Python consumer.** Turns a bare string into a set of single characters that `owned_match`'s lower-casing can never match (`spec-gate.py:391-401`) - the empty freeze again, reached through a malformed witness.
- **Making `ownedAtApproval` required in `isValidRecord`.** It would drop all 61 legacy records, which is the `baselineBlob` trap the file's own comment at `approval-store.ts:106-107` records. Absence is handled at the gate, not by dropping the record.
- **Quarantine by a `quarantined: true` marker beside an untouched `specHash`.** Both readers compare only the hash, so the record still resolves approved in both twins while looking handled. AC-16 explicitly fails this shape.
- **Quarantine by deleting `specHash`.** Non-approving, but `isValidRecord` then drops the record (`:101`) and the Python shape check returns None (`spec-gate.py:276-278`), so the quarantine becomes invisible to every standing check including the corpus rule and the run's own idempotency read. Invisible is worse than stale.
- **Storing `implements` and `affects` as separate arrays.** The gate merges them into one indistinguishable flat set, so the provenance would be unusable by the snapshot's only consumer, and it doubles the six-site surface.
- **Order-sensitive comparison of `ownedAtApproval`.** JS `.sort()` is UTF-16 code-unit order and Python's `sorted()` is codepoint order; they differ above the BMP.
- **Lowercasing on insert.** The gate dedups exact-case and folds only at match time, so lowercasing would shrink the TypeScript set relative to Python.
- **`.trim()` in the TypeScript normalizer.** Python's `str.strip()` and JS `trim()` differ in both directions and the trim is the first step of `consider()` (`spec-gate.py:342`), so neither side is fail-safe.
- **Reusing `fmListField` in `owned-set.ts`.** It strips inline comments (`spec-validator.ts:435`) where the gate's `fm_value` keeps them, which would arm a permanent false `ownership-drifted` on any comment-carrying ownership line. Section 3 decides this explicitly and pins it with a fixture.
- **Rejecting non-ASCII ownership tokens in `owned-set.ts` only.** It designs a permanent TypeScript/Python divergence into the function AC-7 exists to prove equal, makes AC-7 pass vacuously for the exact class it was widened to cover, and arms a permanent false `ownership-drifted` the day anyone writes a non-ASCII path. Replaced by the U+017F widening, which changes no pattern string and therefore keeps `ownership-path-parity.test.ts:46` holding.
- **Moving the `seen_ids` dedup** (`spec-gate.py:505-507`) above the phase band. It would let an out-of-band sibling claim a spec id and then be dropped, removing an in-band unapproved sibling's contribution to `blocking` - fail-open under constitution invariant 2. It stays exactly where it is, and AC-11's companion assertion pins the gate's blocking set byte-identical before and after.
- **Adding `sorted()` to the gate's `glob.glob` to make AC-11's dedup probe deterministic.** It changes the order of names inside a multi-blocker deny reason, which is the exact string AC-11's differential compares, inside the slice whose companion assertion is "byte-identical".
- **Widening `phase_intent_status` to achieve FR-7's reach.** It is a deliberate freeze-gate carrying its own do-not-align warning. The reach comes from **placement** - evaluating drift above the band - never from changing what the band means.
- **Refactoring `declared_impl_files` into split functions on the Python side.** AC-11's companion assertion requires the blocking set byte-identical across the FR-7 change; refactoring the producer of that set inside the same slice puts the assertion's own subject in motion. An additive `include_fuzzy=True` keyword preserves every existing call site's value exactly, which is a different thing.
- **Editing `packages/minspec/src/lib/ownership-path-rules.ts` to share the normalizer.** Owned by SPEC-038 and outside this allowlist; declaring it would freeze shared core for every concurrent session. `owned-set.ts` imports its two exported constants (`:23`, `:30`) instead, and a property test pins the predicates equivalent.
- **Adding an `--owned-set` CLI arm to `spec-gate.py`, or a `--canonical` arm to `canonical.py`.** One `importlib` subprocess keeps the hook's stdin/argv path byte-identical, and the `.expected` golden anchors the canonical string without changing a managed template that every adopter receives.
- **Letting the parity harness self-skip when `python3` is absent.** A silent gate on the precondition for a corpus-wide write.
- **Copying Rule 12's swallowed `catch {}`** for the new validator rules. Its whole body is swallowed with a "stay silent" comment at `validate-frontmatter.ts:553-556` and the DR-066 lint cannot see it (`check-swallowed-gate-signal.ts:67` tests `path.endsWith('.sh')`).
- **Repairing Rule 12 here.** Named Out of Scope by the spec. The design leans instead on the second, independent, merge-gating witness for the generated embeds.
- **A `listRecords`-based Rule 20 or Rule 21.** `readRecord` drops a record failing `isValidRecord` (`approval-store.ts:153`), so a rule built on it is blind to exactly the malformed sidecars it exists to catch. Both rules read the tree raw.
- **A merge-base-aware Rule 21.** The `lint:` and `test:` jobs check out with no `fetch-depth` (`.github/workflows/ci.yml:72`, `:158`); only the `paths:` job sets `fetch-depth: 0` (`:40-42`).
- **Putting the FR-1 corpus check in `approval-provenance.py`.** `scripts/review-branch.sh:108` invokes it with `2>/dev/null || true`, marked `swallow-ok` as an optional note that changes no verdict.
- **Extending `scripts/migrate-approvals.ts`.** It imports the shipped `specHash` (`:42`), keys idempotency on file presence (`:118-120`), and hides sidecars behind `representativeById` (`:219-229`). A line-pinned catalogue of anti-patterns, not a template.
- **Minting the frozen hasher from the spec's `h_new` measurement shadow.** Forbidden at requirements.md:1006-1007, and it would make the two-bases proof circular.
- **Copying the `status:` branch for the three new strip keys.** Verified in both twins: `phases` opens a block (`canonical.ts:73-76`) while `status` merely continues (`:77-79`). All three new keys are block-capable, so the `status:` branch would leave every block-form ownership item's child lines inside the hash. AC-3 is red against that implementation and green against the `phases:` one.
- **Making the merge gate read the migration's written run report.** A report is an artifact, and a gate fed by its own artifact is the failure FR-9.2 names (requirements.md:483-491). The gate is a recomputation over the live corpus; the report is for humans and the PR body.
- **Declaring `ci-review-templates.ts`, `validate-frontmatter.ts`, `spec-validator.ts`, `migrate-approvals.ts` or any existing test suite in this spec's `implements:`/`affects:`.** An `affects:` path freezes exactly as hard as an `implements:` one: declaring the generated file would block the regeneration FR-2 requires, and declaring shared validator core or another spec's tests would freeze them for every concurrent session. The allowlist stays as the spec wrote it; `approval-pr.ts` and `scripts/facts.ts` are edited in slice 5 and remain undeclared for the same reason (requirements.md:1030-1044).

---

## 8. Spec defects found while planning

SPEC-070 is **APPROVED**. Every item below is a proposed amendment for the founder to accept or refuse; none is assumed, and none is applied by this design. All four are in `specs/minspec/SPEC-070-ownership-hash-exit/requirements.md`, and per the precondition in section 2 they should be batched into **one** edit, because each edit stales the approval and freezes this spec's 14 declared paths until it is re-approved.

**1. `:411` refers to "OQ-10", which does not exist.**
Evidence: the Open Questions section begins at `:1046` and its entries run OQ-1..OQ-9, at `:1048`, `:1059`, `:1077`, `:1092`, `:1112`, `:1121`, `:1133`, `:1141`, `:1152`. There is no OQ-10.
Amendment: change "is OQ-10" to "is OQ-9" at `:411`. The intended referent is unambiguous - OQ-9 at `:1152` is "Does the sidecar also record `implements_reason`?", exactly the question `:411` describes.

**2. `:228` and `:232` (repeated at `:1034`) cite line numbers inside a generated file, and both have rotted.**
Evidence: `:228` cites `packages/minspec/src/lib/ci-review-templates.ts:3072` for `CANONICAL_PY` and `:232` cites `:2899` for `APPROVAL_PROVENANCE_PY`. At HEAD `03a9c570` those exports are at `:3209` and `:3036`; `:3072` and `:2899` are mid-stream base64 chunk lines.
Amendment: replace both line cites with the symbol names - "`CANONICAL_PY` in `packages/minspec/src/lib/ci-review-templates.ts`" and "`APPROVAL_PROVENANCE_PY`" - with no `:NNN`. That file is generated, so any line cite there rots on every source edit; naming the symbol is stable.

**3. `:618-622` carries three rotted cites into `packages/minspec/src/lib/template-registry.ts`.**
Evidence, all opened at HEAD: the spec cites `:2186-2196` with `name: 'canonical-hasher-python'`, but `:2185-2198` is the **approval-provenance-script** entry (its comment `:2186-2191`, `name:` at `:2192`); the canonical-hasher-python entry is `:2199-2209` with `name:` at `:2203`. The spec cites `:2187-2189` as the registry stating the load-time import; that comment is at `:2200-2202`. The spec cites `:2172-2185` for the `approval-provenance.py` entry; that entry is `:2185-2198`.
Amendment: replace all three with the `name:` values (`'canonical-hasher-python'`, `'approval-provenance-script'`) and drop the line ranges. The substantive dependency chain the passage describes is intact and verified: `scripts/approval-provenance.py:50` does `from canonical import spec_hash` at load, and the spec's cite of that line is exact.

**4. AC-15 is unsatisfiable as literally written for one of the migration's two modes.**
Evidence: AC-15 (`:788-791`) requires the pre-flight to prove it computes on two bases, asserting "that at least one known record classifies differently under each". Seed mode runs pre-strip (FR-9.10 requires exactly that, and FR-1 licenses it), when `preStripSpecHash` is a verbatim copy of the live hasher and the two agree on every possible input - so a literal two-bases assertion there aborts and seeds nothing, which contradicts FR-9.10.
Amendment: add one clause to AC-15 stating that **each mode proves it is not comparing an artifact to itself**: rehash mode by the two-bases divergence, seed mode by the polarity-inverted equality proof plus the anti-vacuity abort (section 6, AC-15). This is the only defect of the four that changes an acceptance criterion rather than a citation, and section 5 already flags it with its cost.

*Two further numbers in the spec are stale but are NOT defects, because the spec licenses re-measurement at requirements.md:866-867 and this Plan re-measures rather than quoting forward: `:409` and `:1186` say "13 of the 34 in-band T3/T4 spec files declare `implements: none`" where HEAD measures 14 of 38, and FR-9.10 `:556-559` says "All 58 old-fresh records ... 27 seeded non-empty, 31 seeded `[]`" where HEAD measures 61 old-fresh, 30 non-empty, 31 `[]`.*

---

## 9. What this design does not yet discharge

Listed so the next reader does not re-derive any of it.

**Pending the founder (work continues under the stated assumption in every case):**

- ➡️ **OQ-4, the prose-correction ordering.** The spec itself says a human must confirm the cost (requirements.md:1108-1109). Recommendation (ii) with its cost named in section 4. Assumed meanwhile: slices 1-8 proceed; slice 9 does not start until the decision lands.
- ➡️ **OQ-6, the three unreachable sidecars.** This design **inverts** the spec's recommendation, and the spec's own text calls retirement "an explicit, human-authorized exception, not a rule" (`:1130-1131`). Recommendation: do not retire; seed SPEC-019's record, leave the two stale ones untouched. Cost named in section 4. Assumed meanwhile: do not retire, and abort the migration if any of the three ever classifies as a quarantine candidate.
- ➡️ **OQ-2(ii), the adopter-facing head verdict.** Recommendation and cost in section 4. Assumed meanwhile: build only (i); AC-23 is asserted against FR-11 as it stands today.
- ➡️ **OQ-9, denying on an `implements_reason` change.** Recommendation declines the spec's own. Assumed meanwhile: record and report, do not deny.
- ➡️ **The AC-15 amendment** (section 8 item 4) and the three citation amendments (section 8 items 1-3), batched into one edit and re-approved immediately.

**Follow-ups that must be filed, or they are prose-only leaks (DR-023's forward rule). This design was produced read-only and filed none of them:**

- ➡️ The accepted gate-versus-validator inline-comment asymmetry (`fm_value` keeps comment tokens, `fmListField` strips them). FR-5 requires it "closed or explicitly accepted"; the acceptance now lives only in section 3 of this design.
- ➡️ Widening `scripts/check-swallowed-gate-signal.ts` beyond `.sh` (`:56`, `:67`), without which no lint can see a swallowed catch in a TypeScript validator rule. Out of scope here; Rules 20 and 21 carry their own counters instead.
- ➡️ The two accepted engine divergences (`str.strip()` vs `.trim()`, `$` before a trailing newline), as siblings of the same class as #1668 and #1960.
- ➡️ The OQ-6 reachability question (three sidecars no `MinSpec: Approve Spec` run can refresh), and the OQ-8 batched-ack affordance for the #1649 backfill.

**Residuals inside decisions already taken:**

- **Rule 21b's totality is a property of the re-stamp merged state only.** After a legitimate edit the anchor stops matching and the clause goes silent rather than red. Correct against AC-1, which speaks about the merged state, but a decaying per-record property afterwards. Note the correction in section 6: an ownership-only edit does NOT move `specHash` post-strip, so the record stays in state 1 - the earlier claim that it "drops into state 2" was false for precisely the AC-9 workflow.
- **AC-12's genuinely uncoverable case.** A spec with an empty *full* owned set and no witness cannot be denied by any write-gate. Routed to FR-8.3 (clause 3) and asserted there; the write-gate half of clause 2 is uncoverable for that shape by construction, and the design says so rather than asserting something that cannot fail.
- **AC-11's dedup probe depends on a readdir order the test can steer but not guarantee.** It fails outright rather than passing when it cannot materialise the hazardous order; it does not make the order deterministic, for the reason in section 7.
- **The FR-1 controls are one-directional.** They prove no predicate is stuck-true; a stuck-false predicate is caught by the slice-8 arming as a loud false red, never a false green.
- **Slice 1 ships an adopter-visible canonical-form change before OQ-2 resolves.** Deliberate, with zero local movement measured and adopter movement unmeasurable from here; surfaced to the founder in OQ-2(iii) as already-shipped.

**Still refuted after the second adversarial pass.** Seven criteria carry a mechanism the verifiers
could not accept. Written out here rather than summarised, because the first attempt at this section
pasted truncated verifier output and had to be removed:

- **AC-1's closing clause** ("the merged state must contain zero newly-stale approved sidecars",
  requirements.md:721). **Now closed** - section 6 carries a replacement latch, composed from the clauses that
  survived three independent corrections being adversarially refuted. The wrong-digest re-stamp is FATAL by
  21b.2 (`rehashedFrom` is the antecedent, the digest the consequent), 21a's domain is every sidecar raw-parsed
  and keyed on location so freshness is the output and never the input, and the three legitimately
  stale-under-both records stay silent. One residual is named there and is NOT closed by Rule 21: a correlated
  pairing bug, where the migration reads one spec and writes another record, produces a self-consistent pair no
  byte-local git-free standing rule can refute. It is closed instead by slice 8's corpus assertion in the `test:`
  job, a different job from Rule 21's `lint:`, which is invariant 2's second-witness clause rather than a
  coincidence of scheduling.
- **AC-6's discrimination requirement.** AC-6 names three failure modes the assertion must tell apart -
  a constant `[]`, the raw untokenised `implements:` strings, and a set resolved before the FR-3 parser
  fix. The design asserts set equality against the FR-5 function, which fails all three, but it does not
  state a fixture that distinguishes them, so a reader cannot tell which mode a red is reporting.
- **AC-11's main clause.** The design covers only the companion differential harness; the criterion's
  own requirement - two sibling files of one spec id, each evaluated independently for drift - has no
  stated fixture.
- **AC-16's "already migrated" cohort.** The quarantine mechanism is verified sound; the three-cohort
  fixture is missing its third cohort.
- **AC-18's positive half.** Reassigned to slice 7 above. The reassignment is stated; the slice-7
  re-run is not yet written as an assertion.
- **AC-19's creation half.** The one criterion in its range with neither a fixture construction nor an
  anti-vacuity clause, and it is assigned to the slice the design itself calls inert.
- **AC-22's clause 3.** The elected-site census is discharged by a warn-level line in `npm run validate`,
  which cannot fail, with no stated predicate and no anti-vacuity counter - in a design that requires
  both of every other new validator rule.

None of these blocks starting slice 1. Slices 4, 6, 7 and 9 each carry one, and Tasks should close them
before the slice that owns them, not after.

**Claims in this document that are not first-hand observations, marked so a reader knows what to spot-check:**

- **PR #1976's state** ("open, `ai-review:pass`, unmerged") is a git-host fact given to this Plan, not re-read from the host. What is verified and local: the branch tip is `947917ee`, it is 1 ahead / 8 behind `03a9c570` and 1 ahead / 17 behind `origin/main` at `77aae68a`, `packages/minspec/tests/ownership-list-parity.test.ts` exists on it, and its two tokenizer hunks change no comment path.
- **"A `phases:` block containing a blank line hashes differently before and after the blank-line fix"** is true by construction of the proposed rule, not a measurement. What was measured is the corpus consequence: 0 moves under the two-key strip, 2 under the five-key strip.
- **"Adopters receive a canonical-form change whose blast radius is unmeasurable in their repos"** is exactly that - unmeasurable from here, and stated rather than estimated.
- **Every count in this document was measured at HEAD `03a9c570`.** `origin/main` has since advanced. The implementation re-measures at its own commit, using the spec's own commands (requirements.md:866-926), and this design quotes none of its numbers forward.

---
