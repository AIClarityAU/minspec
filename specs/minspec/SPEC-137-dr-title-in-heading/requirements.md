---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - decisions and specs should be read and parsed the same way
aspects: [decision-records, frontmatter, title, heading, template, backfill, tier-0, offline]
relates_to: ["#663", SPEC-095, DR-003, DR-023, DR-053]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Decision-record title lives in the `# ` heading, not the frontmatter

Issue: #663 (feat: move DR title from frontmatter to `# ` heading, SPEC conformity).
Specified, not built. No DR rests on this yet; a DR is warranted only if the Clarify answer
below picks the hard-cutover option (see Decisions needed).

## Scope sentence

A decision record (`docs/decisions/DR-NNN.md`) carries its human title in a single
`# DR-NNN: <title>` heading line, as specs already do, and no longer in a frontmatter
`title:` field; the ADR template, the readers, and the existing records are brought into line.

## Observed state (measured against this checkout)

- Specs carry their title in the first `# ` heading; `spec.ts` falls back to that H1 when
  frontmatter has no `title:` (`packages/minspec/src/lib/spec.ts:121-122, 304-306`).
- The ADR template writes the title **twice**: `title: <t>` in frontmatter and
  `# DR-NNN: <t>` as the heading (`packages/minspec/src/lib/adr-manager.ts:546-556`). The two
  copies can drift: DR-099's frontmatter title and heading differ in wording today.
- The ADR list reads the title from frontmatter only: `title: (fm.title as string) ?? ''`
  (`adr-manager.ts:1427`). A DR with no `title:` lists with an empty title. Only
  frontmatter-less files use an H1 (`deriveAdrTitle`, `adr-manager.ts:626`).
- `scripts/lib/dr-id-collision.ts` treats `title` as an identity field (`DR_IDENTITY_FIELDS`,
  line 424) and reads it via `frontmatterField` (line 111).
- 104 files in `docs/decisions/`; 13 have no `# DR-` heading
  (DR-001..006, 008, 009, 011, 100, 103..105), of which at least DR-001 has frontmatter `title:`
  and no heading.

## Functional requirements

- **FR-1 Template.** `generateAdrContent` emits no `title:` frontmatter line; the title appears
  only in `# DR-NNN: <title>`.
- **FR-2 Reader.** The ADR list/summary derives `title` from the first `# ` heading, stripping the
  `DR-NNN:` / `DR-NNN —` prefix (reusing the `deriveAdrTitle` logic). During transition a
  frontmatter `title:` is still accepted as a fallback when no heading exists.
- **FR-3 Single source.** When both heading and `title:` exist, the heading wins; no code path
  reads the frontmatter value in preference to the heading.
- **FR-4 Collision gate.** `check-dr-id-collision` identity comparison reads the title from the
  heading (same derivation as FR-2), so a swapped title is still detected after backfill. Identity
  fields stay `id`, `title`, `triggered_by`.
- **FR-5 Backfill.** A one-shot, idempotent migration, per record: if the `# DR-NNN:` heading is
  absent, create it from frontmatter `title:`; then remove the `title:` line. Where heading and
  frontmatter text differ, the heading text is kept and the difference is listed in the run report
  (nothing is silently overwritten). Re-running changes nothing. Edits are text-level on the
  frontmatter block only (no YAML re-serialisation), preserving CRLF/BOM per SPEC-095.
- **FR-6 Frontmatter rules.** The documented DR frontmatter field list and any validator that
  names `title` as required or expected for DRs drop it; a validator flags a DR with no
  `# DR-NNN:` heading (new gate, so a missing title cannot pass silently).
- **FR-7 Index.** `docs/decisions/INDEX.md` and any generated listing show the same titles as
  before the migration (titles unchanged, only their source moves).
- **FR-8 Docs.** Guidance text that tells authors to put `title:` in DR frontmatter (README,
  harness/skill templates) is updated.

## Acceptance criteria

- AC-1: Creating an ADR produces a file whose frontmatter has no `title:` and whose first `# `
  line is `# DR-NNN: <title>`.
- AC-2: For all 104 existing DRs after backfill, the list title equals the pre-backfill list
  title, except where Clarify decides a heading is authoritative (FR-5 report names each).
- AC-3: No file in `docs/decisions/` has a frontmatter `title:` after backfill; every file has a
  `# DR-NNN:` heading whose id matches its `id:`.
- AC-4: Running backfill twice yields a zero-diff second run.
- AC-5: A DR with a heading but no `title:` lists correctly, in the ADR list and in the collision
  gate; a DR with `title:` but no heading still lists (transition fallback) and the new validator
  flags it.
- AC-6: Backfill leaves every approval-hashed or accepted DR's `status:`, `date:` and body
  bytes unchanged apart from the title line and heading.

## Invariants that must not break

- Offline, Tier 0: pure local file edits, no network (constitution invariant 1).
- No silent gate: the new heading validator fails visibly; the collision gate must not stop
  evaluating a record whose title now lives in the heading (invariant 2).
- Blast radius: only this repo's `docs/decisions/` and the shipped template; an adopter's
  existing DRs are not rewritten without running the backfill command (invariant 3). Readers
  keep the frontmatter fallback so unmigrated adopter DRs still list.
- Line endings and BOM preserved (SPEC-095).
- DR ids, filenames, and cross-references unchanged.

## Decisions needed (Clarify)

1. **Fallback after cutover.** (a) **Keep the frontmatter `title:` fallback permanently
   (rec)** - adopters with unmigrated DRs keep working; cost: two accepted shapes forever and a
   reader branch to maintain. (b) Hard cutover, heading required - one shape; cost: unmigrated
   adopter DRs list with a wrong title until migrated, and this is hard to reverse across
   installed copies, so it would warrant a DR.
2. **Heading vs frontmatter disagreement (e.g. DR-099).** (a) Heading wins, frontmatter text
   discarded **(rec)** - matches FR-3; cost: the human-edited frontmatter wording is lost on a
   few records. (b) Frontmatter wins and the heading is rewritten - preserves the field the
   index uses today; cost: rewrites body text of accepted decisions.
3. **Does the backfill touch accepted DRs' bytes?** Accepted decisions are conventionally
   immutable. (a) Yes, title line only, reported in one commit **(rec)** - needed for AC-3; cost:
   a diff across ~100 historical records that reviewers must trust is title-only. (b) Backfill
   only `proposed` DRs and leave accepted ones on the fallback - smaller diff; cost: the
   frontmatter `title:` field never fully disappears and AC-3 fails.
4. **Ship the backfill as** a one-off script under `scripts/` **(rec)** (cost: adopters get no
   migration) or a MinSpec palette command (cost: new extension surface, larger T-tier).
