---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - reviewing is part of the methodology; this cuts the reading cost
aspects: [approvable, template, validator, review, delta, no-silent-gate]
depends_on: [DR-047]  # DR-047: every approvable is independently AI-reviewed - that reviewer is the manifest's only trusted verifier
relates_to: [SPEC-013, SPEC-018, SPEC-035, DR-053, "#689", "#679", "#167", "#185"]
implements: none
implements_reason: >-
  Specify only. No code exists for a delta manifest: no template, validator rule or reviewer
  check mentions it. Owned files are declared at Plan, per the SPEC-034 precedent.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Delta manifest - every generated approvable opens with only what the LLM added beyond the request

Issue: #689 (echo-vs-delta). Rationale rests on DR-047 (independent review of every approvable).

## In plain terms

Most of a generated spec or decision record repeats the request back. The founder reads
all of it to find the few paragraphs that are new and might be wrong. This spec makes every
generated approvable start with a short list of only the new decisions, assumptions and
open questions the model added, each pointing at its paragraph. You read the list and the
paragraphs it points to, and skim the rest. The author's own list is not trusted: the
independent reviewer checks that it is complete.

## One-Sentence Scope

Every generated approvable (spec requirements, DR) opens with a `## Delta manifest` section
listing only the decisions, assumptions and open questions added beyond the triggering
request, each citing its paragraph; a validator gates its presence and shape, and the
DR-047 reviewer gates its completeness.

## Context (measured, from the 2026-07-13 malleability audit - as reported in #689, not re-measured here)

- 30 hash-approved docs = 96,879 words in 48 days (about 7-8 hours of careful reading); median about 2,400 words per doc.
- In the one directly measurable case the founder's verbatim request was 3.9% of the resulting approvable (75 of 1,907 words, SPEC-035 requirements).
- Existing mechanisms do not do this: SPEC-018 FR-13 attention-dim and #185 eye-icon dim by convention, not by provenance of what the model added. SPEC-013 defines a Zone A / Zone B layout (approved, unbuilt) but no provenance rule for what goes in Zone A.

## Functional Requirements

- **FR-1 (manifest section).** An approvable of a covered type (FR-8) MUST contain a `## Delta manifest` section as its first section after frontmatter, title and any "In plain terms" block.
- **FR-2 (entry shape).** Each manifest entry has a kind (`decision` | `assumption` | `open-question`), one sentence, and a citation to the paragraph that carries it (an anchor to a heading or FR/AC id; DR-053 v2 paragraph refs once #679 ships, heading text until then).
- **FR-3 (delta only).** The manifest lists ONLY content not stated in the triggering request. Restatements of the request, boilerplate and derived mechanical detail are excluded. A document with nothing new states `No delta beyond the request.` explicitly - an empty section is invalid.
- **FR-4 (presence gate).** The spec validator fails (not warns) a covered approvable that lacks the section, has a malformed entry, or cites a paragraph that does not exist in the document. Fails closed and visibly (constitution invariant 2).
- **FR-5 (authoring surface).** The spec and DR templates and the specify/plan prompts instruct the author to produce the manifest, and to record the triggering request source (issue number or quoted request) so the reviewer has a baseline.
- **FR-6 (completeness is reviewer-verified).** The DR-047 independent reviewer MUST check that the manifest covers the document's novel content: it reads the baseline request and the document, and flags (a) novel decisions/assumptions/open questions absent from the manifest and (b) entries that restate the request. A completeness finding blocks per the existing review gating; the validator never claims completeness.
- **FR-7 (untrusted self-report).** No tooling, badge or approval surface may present the manifest as verified on the author's word alone. Until the reviewer has run on the current document bytes it is shown as unverified.
- **FR-8 (coverage and opt-in).** Covered types are spec `requirements.md` and DRs, applying only in projects with `.minspec/` at the root (invariant 3). Documents approved before this spec ships are not retroactively failed (grandfathered by approval record, not by date).
- **FR-9 (Zone A fit).** Where SPEC-013's two-zone layout exists, the manifest belongs in Zone A. This spec does not depend on that layout and builds no renderer.

## Acceptance Criteria

- **AC-1.** Fixture covered doc with no manifest: validator exits non-zero naming the file and FR-1.
- **AC-2.** Fixture with an entry citing a nonexistent heading: validator fails naming the entry.
- **AC-3.** Fixture whose manifest is the literal `No delta beyond the request.`: passes the validator.
- **AC-4.** Fixture with an empty manifest section: fails.
- **AC-5.** Reviewer-prompt test: given a doc with a novel decision absent from the manifest, the review prompt template instructs the reviewer to emit a blocking completeness finding (prompt text asserted; model behaviour is out of test scope).
- **AC-6.** In a repo with no `.minspec/`, no template, hook or validator behaviour changes.
- **AC-7.** An already-approved doc without a manifest is not failed.

## Invariants (must not break)

1. Offline, no network call (constitution invariant 1).
2. Fail closed and visible; no `|| true` on the gate; the reviewer check is a second independent witness to the validator, not a replacement (invariant 2).
3. Blast radius is `.minspec/` projects only (invariant 3).
4. Editing an approved document still voids approval via the existing hash rules; this spec adds no new hashing.

## Decisions needed (Clarify)

1. **Where the baseline request lives.** Options: (a) **(rec)** a `request:` frontmatter field naming the issue/quote - cheap and checkable; cost: one more frontmatter field to keep truthful, and a quote can be paraphrased by the author. (b) the reviewer fetches the linked issue - no author trust, but needs network, which conflicts with invariant 1 offline.
2. **Section vs. frontmatter for the manifest.** (a) **(rec)** Markdown section - human-readable at the top, reuses the Zone A slot; cost: parsing prose is looser than structured data. (b) frontmatter list - strictly machine-checkable; cost: the founder reads frontmatter poorly and it bloats the header.
3. **Strictness of FR-4 for DRs.** (a) **(rec)** same failing gate for DRs and specs; cost: short DRs gain a tiny mandatory section. (b) specs only first; cost: DRs, also read in full, stay unaddressed.
4. **Reviewer-completeness blocking.** (a) **(rec)** blocking, as the point is trust in skimming; cost: LLM-judged recall misses can false-block and add review noise. (b) advisory; cost: skimming is then unsafe.

## Out of Scope

- A renderer or UI for the manifest (SPEC-013 / SPEC-018 / SPEC-035 follow-on).
- Per-paragraph novelty or risk ranking (richer later layer, needs a renderer).
- Deterministically proving completeness (impossible without trusting a model; the reviewer is the witness).
- Migrating existing approved documents.

## Traceability

- Issue: #689. DR rationale: DR-047. Related: SPEC-013 (Zone A), #679 (paragraph refs), #167 (Zone backfill).
