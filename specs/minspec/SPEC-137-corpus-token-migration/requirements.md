---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - one addressable reference grammar across the corpus
aspects: [references, migration, traceability, tier-0, offline, no-silent-gate, never-wrong]
depends_on: [DR-053, SPEC-022]  # DR-053 is the accepted grammar being applied; SPEC-022 owns the approval hash a body rewrite would void
relates_to: [DR-027, DR-032, DR-023, DR-003, SPEC-021, SPEC-035, SPEC-014, "#681", "#679", "#396", "#58"]
# Ownership is declared at Plan time: the migration tool and its tests are new files whose
# paths depend on Decision D-2 (where the dual-read resolver lives). None claimed here.
phases:
  specify: in-progress
---

# SPEC-137: Migrate the corpus to DR-053's paragraph-addressable token grammar

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and settles **Decisions needed (Clarify)** below. Every requirement is written under
> each decision's recommended option; choosing otherwise changes only what that decision names.

Materializes **[#681](https://github.com/AIClarityAU/minspec/issues/681)** - *chore(DR-053 v2):
migrate corpus to paragraph-addressable token grammar.* The design is already decided in
[DR-053](../../../docs/decisions/DR-053.md) (accepted 2026-07-14): `PROJECT/APPROVABLE/PARAGRAPH`
(`MIN/SP19/FR3`), 3-letter project codes, no zero-pad, `SP`/`DR`/`EP`, the §3 paragraph-type table,
allocate-once ids (§3.1). This spec decides only **how the existing corpus is rewritten to it
without breaking anything that reads the corpus today.**

## Why this is not "just a find-and-replace"

Verified at this commit (not inferred):

- **Approvals hash the body.** `packages/shared/src/canonical.ts` strips only the `status`/`phases`
  lifecycle keys; any other frontmatter or body edit changes the spec hash and voids the approval
  (SPEC-022 FR-3). A blanket re-tokenise of body text therefore *un-approves every approved spec
  it touches*. A reference rewrite is not a "substantive change", yet the gate cannot tell.
- **The issue's own examples collide with live identifiers.** `SPEC-014` is simultaneously a prose
  ref, a frontmatter `id:`, a directory name (`SPEC-014-review-webview/`), and a lookup key in
  validators, hooks and the Python hash twin. About 660 files outside `node_modules` contain a
  `SPEC-NNN` token; only a subset are prose refs.
- **The shipped resolver is v1-only.** `packages/shared/src/project-prefix.ts` still parses
  `<PREFIX>-SPEC-019` (dash grammar). Rewriting the corpus before #679 lands leaves refs no code resolves.
- **Unlabeled rows have no stamp syntax.** DR-053 says Consequences get `CQ`, Follow-ups `FU`,
  `Costly #N` becomes `CR`n, deviations `DV` - but not *where in the markdown the id is written*.

## Functional requirements

- **FR-1 - Identifiers are never rewritten.** The following keep their current `SPEC-NNN` / `DR-NNN` /
  `EPIC-NNN` form: frontmatter `id:`, directory and file names, and frontmatter reference keys
  (`depends_on`, `relates_to`, `supersedes`, `implements`, `affects`) unless Decision D-3 says otherwise.
  Only *prose references* in document bodies are candidates.
- **FR-2 - Closed-vocabulary rewrite.** A reference is rewritten only if it matches the DR-053 §4
  closed vocabulary (project codes from `.minspec/project-prefixes.md`; `SP|DR|EP`; the §3
  paragraph codes) with longest-match ordering (`RD` before `R`, `NFR` before `FR`). Anything else -
  file paths, URLs, dates, `Apple M1`, `Windows SP1`, a bare `R1` in prose - is left alone.
- **FR-3 - Mapping rules.** `FR-3`->`FR3`, `SPEC-014`->`SP14`, `SPEC-014 FR-3`->`SP14/FR3`,
  `DR-053`->`DR53`, `EPIC-002`->`EP2`, `OQ-n`/`FR-OQ-n`->`OQn`, `Costly #N`->`CRn`; zero-padding
  dropped; cross-project refs carry the 3-letter code (`MS-SPEC-019`->`MIN/SP19`). Issue/PR refs
  keep GitHub-native `#N` / `SCR#204` (DR-053 §2) and are not touched.
- **FR-4 - Store the fullest unambiguous form (DR-053 §7).** A ref that names another document is
  written with its approvable segment; a bare `FR3` is written only where it is *inside* the document it
  addresses. The tool never elides a segment the reader would need.
- **FR-5 - Stamp unlabeled rows.** Per Decision D-4, Consequences bullets get `CQ`n, Follow-ups
  `FU`n, `Costly #N` rows `CR`n, methodology-fit deviations `DV`n, Alternatives `AL`n. Numbers are
  allocate-once, monotonic per document per type, never reused (DR-053 §3.1); on re-run an existing
  stamp is never renumbered (idempotence, FR-9).
- **FR-6 - Dual-read during transition.** Until the sweep completes, the resolver and every
  detector that reads refs accept both old and new forms and resolve both to the same target.
  Old-form support is removed only by a separate, later change after a measured-zero check (FR-12).
  This depends on #679 (module v1->v2); see D-2.
- **FR-7 - Approved artifacts.** Per Decision D-1, a rewrite never leaves an approval silently
  stale. Whatever the option, the tool computes `specHash` before and after for each file and
  **reports** every file whose hash changed; it never edits an approval record, and it never
  writes an approval as an agent identity.
- **FR-8 - Clean-tree, branch-only run.** The tool refuses to run on a dirty tree or on `main`,
  and writes only on a branch (approvables go branch + PR). It supports `--dry-run`, which prints
  per-file counts and the full diff and writes nothing.
- **FR-9 - Idempotent and reversible.** A second run on its own output changes nothing. The sweep
  is delivered as reviewable, path-disjoint commits (specs / DRs / docs / other) so any slice reverts alone.
- **FR-10 - Fail visibly (constitution invariant 2).** An unparseable reference, an unknown project
  code, or an ambiguous match is reported with file and line and counted in the summary; the tool
  exits non-zero when any are unresolved. Unknown codes stay advisory per DR-053 §5 (never a silent
  drop, never a hard error on the *corpus* - they are left unchanged and listed).
- **FR-11 - Egress guard first.** The DR-032 / SPEC-021 egress stripper learns the v2 grammar
  *before* any rewrite lands (DR-053 risk R4), otherwise new-form internal refs leak into user output.
- **FR-12 - Verification.** After the sweep a check counts residual old-form refs using the gate's
  own regex (not `grep -c`, which counts lines) and every remaining one must be in the documented
  exemption set (FR-1 identifiers, quoted historical text, code fences).
- **FR-13 - Offline (invariant 1).** Pure local text transform; no network, no LLM.
- **FR-14 - Scope.** The tool rewrites `specs/**`, `docs/**`, `README*`, `CLAUDE.md`, and
  `.minspec/**` prose. It does not rewrite `packages/**` source or tests (code comments cite ids by
  convention and are validated by their own tests), nor `node_modules`, nor generated files.

## Acceptance criteria

- **AC-1** On a fixture corpus containing every FR-3 mapping, `--dry-run` writes nothing and its diff
  equals what a real run then produces byte-for-byte.
- **AC-2** Re-running on the output changes zero bytes (FR-9).
- **AC-3** Negative fixtures - `Apple M1`, `Windows SP1`, `R1` in prose, `specs/minspec/SPEC-014-.../`
  paths, a `SPEC-014` inside a URL or code fence, a frontmatter `id: SPEC-014` - are byte-unchanged (FR-1, FR-2).
- **AC-4** A fixture approved spec whose body is rewritten is reported as hash-changed; the approval
  file is untouched (FR-7). Under D-1 option A the file is not rewritten at all.
- **AC-5** Old-form and new-form refs to the same target resolve identically in the resolver (FR-6).
- **AC-6** Existing numbered stamps survive a run unchanged; an inserted row takes the next free
  number, a deleted row leaves a gap (FR-5, DR-053 §3.1).
- **AC-7** Unknown project code is listed, left unchanged, exit non-zero (FR-10).
- **AC-8** `npm test`, `npm run validate` and `npm run lint` pass on the migrated tree; no spec
  that was approved before the sweep is stale after it except those D-1 explicitly lists.

## Invariants this must not break

- Constitution 1 (offline), 2 (no silent gate: a skipped or unresolved ref is visible, never swallowed),
  3 (blast radius: the tool runs only in repos with `.minspec/`).
- **Never-wrong / DR-003 evidence discipline:** a rewritten ref must resolve to the same target as
  before; the sweep must not turn a true signpost into a lying one.
- **DR-053 §3.1:** ids are handles, not ordinals.
- **SPEC-022 FR-3:** approval records are not edited by migration, and no approval is minted for a human.

## Decisions needed (Clarify)

**D-1 - Approved specs: rewrite their bodies or leave them?** (the load-bearing one)
- **A (rec): leave hash-approved bodies and approved DRs untouched; migrate only unapproved
  artifacts, non-approvable docs, and anything newly written.** Dual-read (FR-6) stays permanently for
  the frozen set. Cost: the corpus never becomes fully uniform, so the old-form support cannot be
  deleted and a reader still sees two forms in old approved specs.
- B: rewrite everything, then the founder re-approves each voided spec (about 70 reads). Cost: a
  large human queue for zero semantic change; also exactly the bulk-approve the founder refuses.
- C: add a "reference-only change" exemption to the canonical hash so ref rewrites do not void
  approvals. Cost: weakens the hash contract and needs byte-identical Node/Python twins (SPEC-022 INV-2);
  it is a gate change and would itself need a spec.

**D-2 - Sequencing and where dual-read lives.** DR-053 makes #679 (resolver v1->v2) a hard
predecessor to runtime use, and the egress-guard v2 (FR-11) a predecessor to migration. **(rec)** Land
#679 and egress-guard v2 first, then this. Cost: this work waits behind two other changes. The
alternative (migrate first, resolver after) leaves unresolvable refs in the interim.

**D-3 - Frontmatter reference keys** (`depends_on`, `relates_to`, ...). **(rec)** leave in `SPEC-NNN`
form (FR-1): they are machine identifiers read by validators and the Python twin, and editing them
voids approvals even though they are not prose. Cost: frontmatter keeps the long form forever.
Alternative: migrate them with the validators taught both forms - bigger blast radius.

**D-4 - Stamp syntax for unlabeled rows.** DR-053 defines the codes but not the in-document form.
Options: **(rec)** a visible leading label (`- CQ1: ...`, `FU2`) - greppable and readable; cost: it
changes the rendered prose of every such row. Or a trailing/invisible marker (`<!-- id:CQ1 -->`) -
no visible change, but invisible ids rot unseen and are not typeable by a reader.

**D-5 - Open questions in DR-053 that gate the stamp rules.** OQ3 (plain-paragraph `P`n handle),
OQ4 (does a resolved `OQ3` become `D3`/`RD3` or stay `OQ3`) and OQ5 (constitution goals/invariants:
`MIN/G3` vs a `CON` pseudo-approvable) are still listed open in DR-053 although the DR is accepted.
FR-3/FR-5 here assume **OQ3: typed set only, OQ4: stays `OQn`-resolved, OQ5: named `INV-<slug>`,
`G-<n>` unchanged**. **(rec)** confirm those three before building; cost: a wrong guess means a
re-tokenise (DR-053 "Costly to Refactor"). Also confirm OQ1: the joiner stays `/`.

## Out of scope

Teaching `project-prefix` the v2 grammar (#679); SPEC-035 lozenge rendering; the duplicate-id gate
(#396); rewriting code comments in `packages/**`; any change to approval hashing (that is D-1 option C).

## Follow-ups (tracked)

- #679 - resolver v1->v2, hard predecessor (D-2).
- Egress-guard v2 (DR-053 follow-up) - hard predecessor (FR-11); the issue is named in DR-053 but its number is not recorded there, so Plan must look it up and cite it.
- #396 - duplicate-id gate must tolerate gaps (FR-5).
