---
id: SPEC-197
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - approval validity
aspects: [approval, staleness, dependency-graph, tier-0, offline, never-wrong, hitl, no-silent-gate]
depends_on: [SPEC-041, DR-062, SPEC-012]  # SPEC-041 builds the whole-doc upstreamDeps record and the upstream-stale state this narrows; DR-062 section 6 is the decision this materializes; SPEC-012 R2 (risk row 2, the prose-link linter + opt-in edge suggester) is the convention the anchors derive from
relates_to: [SPEC-022, SPEC-029, DR-034, DR-053, DR-019, "#862", "#803", "#679", "#643", "#147"]
# Ownership declared in Specify (SPEC-038). Both owned files are NEW and are needed under
# every answer to the Clarify questions below: the pure extract/resolve/hash module and its
# test. The modified files are the SPEC-041 seams this extends (none of which carry
# upstreamDeps yet - grep for `upstreamDeps` in packages/ returns zero hits on 2026-10-16).
implements: [packages/shared/src/section-anchor.ts, packages/shared/tests/section-anchor.test.ts]
affects: [packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/reference-checker.ts, packages/minspec/src/lib/approval-diff.ts, packages/minspec/src/views/spec-tree-provider.ts, packages/shared/src/canonical.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Section-anchored dependency fingerprints (Requirements)

> Materializes **[DR-062](../../../docs/decisions/DR-062.md) section 6** (the "later,
> mostly-auto-derived refinement" of whole-doc fingerprints). Triggered by
> [#862](https://github.com/AIClarityAU/minspec/issues/862). Deliberately scoped **out of**
> [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (cross-artifact staleness),
> whose design D6 defers the precise cross-diff to this issue.
>
> **Hard sequencing:** this spec narrows a record SPEC-041 creates. SPEC-041 is `implementing`
> with its tasks in progress and **no `upstreamDeps` code exists yet** (zero hits for
> `upstreamDeps` / `upstream-stale` under `packages/`, checked 2026-10-16). Nothing here may be
> built before SPEC-041's Slice 2 (`upstreamDeps` + `upstream-stale`) has landed.

## One-Sentence Scope

When a dependent approvable B cites specific sections of an upstream target A in its own prose,
fingerprint **those sections** of A (derived automatically from B's existing citations - no new
authoring convention) alongside SPEC-041's whole-doc fingerprint, so that an edit to an
unrelated part of A no longer marks B `upstream-stale`, while any doubt about which section B
relied on falls back to SPEC-041's whole-doc behaviour.

## In plain terms

SPEC-041 says: "you approved B while A looked like *this*; A has changed, so re-check B." It
compares the **whole** of A. A DR that ten specs depend on gets a typo fixed in its
Consequences section, and all ten specs need a re-approval keystroke - although none of them
relied on that section. That noise is the staleness-fatigue risk SPEC-041 records as its R3.

This spec makes the comparison finer **only where B's own text already says what it relied
on.** B already writes `DR-062 §6` or `SPEC-012 R2` in its prose (measured below). Those
citations become the fingerprint. Where B gives no such hint, or the hint cannot be resolved
cleanly, nothing changes: the whole-doc check from SPEC-041 still applies.

## Context (measured 2026-10-16 on this branch's base)

- **The whole-doc primitive this extends is specified but not built.** SPEC-041 FR-1 defines
  `upstreamDeps: [{ ref, hash }]` in the approval record; SPEC-041 design D6 says a precise
  "B relied on this section" diff "needs section anchors and is deferred to #862". Grep of
  `packages/` for `upstreamDeps` and `upstream-stale`: **0 files**.
- **The citations already exist in prose.** Across `specs/` and `docs/decisions/`:
  - `<ID> §N` form (e.g. `DR-062 §6`): **323** occurrences.
  - `<ID> <typed paragraph>` form (e.g. `SPEC-012 R2`, `SPEC-041 FR-1`): **347** occurrences.
  - Markdown link to a heading anchor (`DR-NNN.md#some-heading`): **4** occurrences.
- **How dependency edges are cited today (heuristic count, overstates "bare").** Of the 88
  `depends_on` edges to a `DR`/`SPEC`/`EPIC` id across the 39 specs that declare one:
  1 is cited **only** with a section anchor; 22 are cited **both** with an anchor and bare;
  57 are cited **only** bare; 8 are never cited in the body at all. The count treats a link
  path such as `(../DR-062.md)` as a bare citation, so the true "anchored only" number is
  somewhat higher - but the shape is clear, and it decides **DQ-1** below.
- **Section numbering is common but not universal in DRs.** 34 of 103 `docs/decisions/DR-*.md`
  files have numbered `## N.` / `### N.` headings, which is what a `§N` citation resolves against.
- **Reusable machinery.**
  - The reference extractor: [`extractReferences` reference-checker.ts:117](../../../packages/minspec/src/lib/reference-checker.ts#L117)
    already parses the `SPEC-NNN` / `DR-NNN` / `EPIC-NNN` id grammar and `path#Lnn` /
    `path:nn` file:line citations. It **drops section suffixes** today (it de-duplicates by id),
    so anchor capture is an extension of it, not something it already does.
  - The canonical hash: [canonical.ts](../../../packages/shared/src/canonical.ts) - EOL
    normalization, link collapse to `](RELLINK)`, trailing-whitespace strip, sha256. It hashes
    a **whole file**; it has no section-span entry point.
  - DR-053 v2 typed paragraph ids (`FR`, `R`, `AC`, `INV`, `OQ`, ...): **accepted, not shipped**
    ([#679](https://github.com/AIClarityAU/minspec/issues/679) lands the grammar). DR-053 section
    3.1 makes those ids **allocate-once, never renumbered** - a stable handle, unlike a heading.
  - No GitHub-style heading-slug function exists in `packages/` (grep for slug helpers finds only
    repo-slug and filename-slug functions).
- **The SPEC-012 R2 prose-link linter is not built.** SPEC-012 records it as the R2
  mitigation ("not yet a SPEC"); [#803](https://github.com/AIClarityAU/minspec/issues/803)
  tracks the symmetric half. Grep for `prose-link` / `proseLink` in `packages/` and `scripts/`:
  0 hits. This spec **shares its extraction pass** with that linter rather than inventing a
  second grammar; it does not build the linter's rules.

## Terms

- **Target (A)** - an approvable named in B's `depends_on`.
- **Dependent (B)** - the approvable whose approval snapshots fingerprints of its targets.
- **Anchored citation** - a mention of A in B's body that names a part of A: `A §N[.M]`,
  `A <TYPE>-N` / `A <TYPE>N` (a DR-053 typed paragraph code), `A/<TYPE>N` (DR-053 v2 slash
  form, once #679 ships), or a Markdown link to `A`'s file with a `#heading-slug` fragment.
- **Bare citation** - a mention of A in B's body that names no part of A.
- **Section span** - the exact lines of A an anchor resolves to (defined in FR-3).
- **Section fingerprint** - the canonical hash of one section span (FR-4).
- **Whole-doc fingerprint** - SPEC-041's `upstreamDeps[i].hash`, unchanged by this spec.

## Functional Requirements

- **FR-1 (anchor extraction, auto-derived).** A pure, Tier-0 function extracts, for each
  `depends_on` target of B, the set of anchored citations of that target in B's body (the text
  after B's frontmatter). It reuses the id grammar of `extractReferences` (one id grammar in
  the codebase, not two) and adds anchor capture for the four citation forms in **Terms**.
  B's `depends_on` inline comments (the `# ...` text after the list) are **not** a citation
  source - they are frontmatter, and the frontmatter is not prose (DR-062 section 6: edges stay
  in frontmatter, anchors derive from prose).
- **FR-2 (no hand-authored anchors).** This spec adds **no new frontmatter field and no new
  citation syntax**. The only way to anchor a dependency is to cite the section in prose, which
  authors already do (Context). An author who wants whole-doc reliance writes nothing new.
  Rationale: hand-authored optional edges rot (DR-062 section 6: `supersedes:`/`goal:` had zero
  corpus uses).
- **FR-3 (anchor resolution to a span).** A pure function resolves one anchor against A's
  current text to exactly one section span:
  - `§N` / `§N.M` → the heading whose text begins with `N.` / `N.M` / `§N` (any heading
    level); the span runs from that heading line up to, not including, the next heading of the
    same or higher level, or end of file.
  - Typed paragraph (`FR-3`, `R2`, `AC-1`, `INV-...`, ...) → the single heading, list item,
    or table row that **defines** that id (the id in bold or at the start of the item / first
    cell). A list item's span includes its indented continuation lines; a table row's span is
    that row plus the table's header row (a column rename changes what the row means).
  - `#heading-slug` → the heading whose GitHub-style slug equals the fragment; span as for `§N`.
- **FR-4 (section fingerprint).** A section fingerprint is the sha256 of the span after the
  **same** normalization steps the whole-doc canonical hash applies to body text (EOL to `\n`,
  relative links collapsed to `](RELLINK)`, trailing whitespace stripped, trailing newline run
  collapsed to one). One normalization implementation, shared with
  [canonical.ts](../../../packages/shared/src/canonical.ts) - not a copy. The target's
  frontmatter minus the lifecycle keys (`status`, `phases`) is **always** fingerprinted
  alongside the sections (an edit to A's id, title, tier or edges is never "elsewhere").
- **FR-5 (fail toward whole-doc).** If any anchored citation of A in B **does not resolve, or
  resolves to more than one span** (duplicate numbering, duplicate slug, an id defined twice),
  the whole edge B→A falls back to whole-doc for that approval: no `sections` are recorded for
  A, and SPEC-041's whole-doc comparison governs. The fallback is **visible** - the approval
  record notes why (FR-6 `fallback`), and the FR-9 report lists it. It never narrows on a guess.
- **FR-6 (record extension, additive).** SPEC-041's `UpstreamDep` gains optional fields:
  ```ts
  interface UpstreamDep {
    ref: string;   // SPEC-041 - unchanged
    hash: string;  // SPEC-041 whole-doc canonical hash - ALWAYS still recorded
    sections?: { anchor: string; hash: string }[]; // FR-4; absent means whole-doc reliance
    frontmatterHash?: string;                       // FR-4; present whenever sections is
    fallback?: 'no-anchor' | 'bare-citation' | 'unresolved' | 'ambiguous'; // FR-5 / DQ-1 reason
  }
  ```
  `anchor` is stored in its canonical form (`§6`, `R2`, `FR-1`, `#slug`). Written **once, by
  the human approving B**, in the same approve path that writes SPEC-041's `upstreamDeps`.
  Absent fields mean exactly SPEC-041's behaviour (backward-compatible).
- **FR-7 (derivation on read).** For an edge that recorded `sections`, B is `upstream-stale`
  through A when **any** of: a recorded section hash no longer matches the current span; a
  recorded anchor no longer resolves, or now resolves ambiguously; the frontmatter hash
  changed. If A's whole-doc hash changed but every recorded section and the frontmatter still
  match, B is **not** `upstream-stale` through A; what B shows instead is **DQ-2**. For an edge
  with no `sections`, SPEC-041 FR-3 applies unchanged. Pure function of
  `(record, A's current text)` - no LLM, no network.
- **FR-8 (precise cross-diff - closes SPEC-041 D6).** For a B that is `upstream-stale` through a
  sectioned edge, the review surface (SPEC-029's diff view, as extended by SPEC-041 FR-6) shows a
  diff **scoped to the drifted sections** of A, between the approved-against text and A's
  current text. The approved-against text comes from local git history: the version of A's file
  at the commit that added or last changed B's approval record. It is used **only if**
  re-fingerprinting that historical span reproduces the recorded section hash exactly; otherwise
  the surface says plainly *"approved-against text not available - showing A's current
  section"*. Never shows a baseline it has not verified against the recorded hash. Local git
  only, no network.
- **FR-9 (shared extraction report - the SPEC-012 R2 seam).** The same extraction pass yields,
  per `depends_on` edge of B, one of: **anchored** (the anchors recorded), **whole-doc** (with
  the FR-5 / DQ-1 reason), or **uncited** (the edge names A but B's body never mentions A).
  The report is advisory and surfaces in the approval preview so the human approving B can see
  which edges were narrowed before signing off. The **uncited** case is exactly #803's
  "edge with no textual basis"; this spec reports it and leaves the rule to #803.
- **FR-10 (one re-ack path).** Clearing a sectioned `upstream-stale` uses SPEC-041's re-approve
  path (its design D5: Alt+A re-snapshots `upstreamDeps`). Re-approving re-runs FR-1..FR-6, so
  anchors added or removed in B's prose since the last approval take effect then - never in the
  background.

## Invariants (must not break)

- **INV-1 (never narrower without evidence).** A section-scoped comparison is used for an edge
  only when every anchored citation of that target in B resolved to exactly one span at approve
  time. Every doubt (unresolved, ambiguous, no anchors, and - per DQ-1 - bare mentions) yields
  the whole-doc comparison. The failure direction is always "asks for a re-check it did not
  need", never "reads approved when the relied-on text changed" (a false `approved` is the
  worst defect in a never-wrong signpost).
- **INV-2 (derived, never mutating a sign-off).** Inherited from SPEC-041 INV-1: deriving
  staleness performs zero writes to any approval record; `sections` / `frontmatterHash` are
  written only by the human approve path.
- **INV-3 (deterministic, Tier-0, offline).** Extraction, resolution, fingerprinting and
  derivation are pure functions of file text (FR-8 adds a local `git show`, no network).
  No LLM anywhere in the path; the opt-in LLM edge *suggester* of SPEC-012 R2 may propose
  `depends_on` edges for a human to accept, but never anchors and never a verdict
  (DR-019). Constitution invariant 1.
- **INV-4 (whole-doc hash always recorded).** `upstreamDeps[i].hash` is recorded for every edge,
  sectioned or not, so a later change to the section rules can always fall back to SPEC-041
  semantics from an existing record without a re-approval.
- **INV-5 (one grammar, one normalization).** The id grammar is the one in `extractReferences`;
  the normalization is the one in `canonical.ts`. A second copy of either can drift from the
  first and hash the same text two ways; `canonical.ts` already needs a dedicated parity test
  to hold its one existing twin (`scripts/hooks/canonical.py`) in step.
- **INV-6 (fallback is visible).** A fallback to whole-doc is recorded with its reason (FR-6)
  and shown (FR-9). Constitution invariant 2: no gate signal degrades silently.

## Decisions needed (Clarify)

**DQ-1 - Does a bare mention of A in B, next to anchored ones, still mean "B relied on all of A"?**
This decides whether the feature does anything. Measured on the corpus (Context): of 88
`depends_on` edges, only about 1 is cited with anchors **only**; 22 are cited with anchors
**and** bare (typically a bare "Traces to DR-062" line in the header plus `DR-062 §1` in the
requirements).

- **a.** Any bare mention forces whole-doc for that edge. Safest; but on today's corpus it
  narrows roughly 1 edge in 88, so it removes almost none of the noise it exists to remove.
- **b.** Anchored mentions win; bare mentions are ignored once at least one anchor exists.
  Narrows about 23 of 88 edges; risk: B relied on a part of A it never anchored, A changes
  there, and B stays `approved` (a false negative - the never-wrong failure direction).
- **c. (rec)** Anchored mentions win, **except** a bare mention inside B's normative content
  (a functional requirement, invariant, acceptance criterion, or decision item - identified by
  the DR-053 typed-paragraph codes FR-3 already parses) forces whole-doc. Header, context,
  traceability and out-of-scope lines don't. **Cost:** a more complex rule to explain and test,
  and it still trusts that an author who relied on an un-anchored part of A mentioned A
  somewhere normative; a reliance stated only in Context is missed.

**DQ-2 - What does B show when A changed only outside the sections B cites?**

- **a. (rec)** B stays `approved`, with a visible, non-gating note on its tree entry: *"DR-062
  changed outside the sections this cites (§6) - no re-approval needed"*, dismissed by
  re-approving or automatically when A next matches. It does not join the resolver's
  `gateCleared`-false set. **Cost:** a new informational marker in the tree that is not a state,
  one more thing for a human to learn; and the human sees a reassurance that rests on DQ-1's
  rule being right.
- **b.** B is `approved`, silently. Cheapest; but the human never learns that A moved, so a
  wrong anchor (INV-1 breached by a bug) is invisible.
- **c.** B stays `upstream-stale` but sorts below whole-doc staleness. Changes almost nothing
  from SPEC-041 - the re-approval keystroke is still demanded, which is the noise this spec
  exists to remove.

**DQ-3 - Anchor kind when DR-053 paragraph ids ship (#679).** Heading text gets edited; DR-053
typed ids are allocate-once and never renumbered (DR-053 section 3.1).

- **a. (rec)** Resolve all three forms now (`§N`, typed id, `#slug`), and when #679 ships, add
  the DR-053 slash form; prefer the typed id when a section is reachable both ways. **Cost:**
  three resolvers to test now, and `§N` anchors still break when a DR's sections are renumbered
  - which INV-1 turns into a whole-doc fallback (noise, not a false `approved`).
- **b.** Wait for #679 and anchor only on typed ids. One stable resolver; but most of today's
  323 `§N` citations - the DR side of the graph, which dominates `depends_on` (DR-062 section 1)
  - get no narrowing until DRs gain typed ids.

**DQ-4 - Does the FR-8 precise diff ride in this spec or a follow-up?** SPEC-041 D6 deferred
it here. **(rec) Keep it here** - without it, a sectioned `upstream-stale` still says only "A
changed, review A", and the human has to find the section by hand. **Cost:** FR-8 adds a local
git history read to an otherwise pure feature and is the largest single piece; splitting it would
let the narrowing (FR-1..FR-7) ship a slice earlier.

None of these needs a new DR on its own: DR-062 section 6 already decides "auto-derived, edges
stay in frontmatter, anchored on SPEC-012 R2". A Clarify answer that moved the edge source of
truth into prose, or added a frontmatter anchor field, **would** need its own DR (DR-062
section 6 says so).

## Acceptance Criteria

- **AC-1 (FR-1, FR-2).** Given B with `depends_on: [DR-062]` and body text citing `DR-062 §6`
  and `DR-062 §1`, extraction returns exactly `{§1, §6}` for DR-062. Text in B's frontmatter
  (including `depends_on` comments) contributes nothing. No new frontmatter field is read.
- **AC-2 (FR-3).** On a fixture DR with headings `## 1. X`, `### 1.1 Y`, `## 2. Z`: `§1` spans
  `## 1. X` through the line before `## 2. Z` (including `1.1`); `§1.1` spans only `### 1.1 Y`
  to the line before `## 2. Z`. A typed id `R2` resolves to its single table row plus header;
  `FR-3` to its list item including continuation lines; a `#slug` to its heading's section.
- **AC-3 (FR-5, INV-1, INV-6).** An anchor with no match, and an anchor matching two headings,
  each produce an edge with no `sections`, the reason recorded in `fallback`, and the edge
  listed as whole-doc in the FR-9 report.
- **AC-4 (FR-4, INV-5).** For a fixture span, the section fingerprint equals the sha256 the
  `canonical.ts` normalization produces for that span text; a test fails if the two
  normalizations are separate implementations that diverge on a link-collapse or EOL case.
- **AC-5 (FR-7).** B approved with sections `{§6}` of A: editing A's `§2` leaves B not
  `upstream-stale` (and shows the DQ-2 outcome); editing A's `§6` makes B `upstream-stale`;
  deleting or renumbering `§6` makes B `upstream-stale`; editing A's frontmatter `title`
  makes B `upstream-stale`; editing only A's `status` does not.
- **AC-6 (INV-2, INV-3).** Around a derivation run, every approval record is byte-identical;
  the derive path reaches no network and no LLM; N runs on a fixed fixture give a
  byte-identical verdict.
- **AC-7 (FR-6, INV-4).** A record written by this spec still carries the whole-doc `hash`;
  dropping the `sections` field from it yields exactly SPEC-041's verdict. A SPEC-041 record
  with no `sections` derives exactly as before.
- **AC-8 (FR-8).** When the historical span re-fingerprints to the recorded hash, the diff shows
  only the drifted section(s). When it does not (history rewritten, record committed after A
  moved), the surface shows the "not available" message and no diff.
- **AC-9 (FR-9).** The approval preview for B lists each `depends_on` edge as anchored (with
  anchors), whole-doc (with reason), or uncited.
- **AC-10 (DQ-1 as resolved).** A fixture pinning whichever DQ-1 rule Clarify chooses: a B with
  `§6` plus a bare mention in the chosen "forces whole-doc" location records no sections; a B
  with `§6` plus a bare mention elsewhere records `{§6}`.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **False `approved` through a missed reliance** - B relied on a part of A it never anchored. | INV-1; DQ-1 chooses how strict; INV-4 keeps the whole-doc hash so DQ-2 option a can still show that A moved; FR-9 shows the human, at approve time, which edges were narrowed. |
| R2 | **Heading renumbering in A breaks `§N` anchors.** | Resolves to fallback, never to a wrong span (INV-1): the cost is one re-approval, the status quo under SPEC-041. DQ-3 moves to never-renumbered DR-053 ids when #679 ships. |
| R3 | **Building on an unbuilt base.** SPEC-041's `upstreamDeps` does not exist yet. | Hard sequencing note at the top; Plan must not start until SPEC-041 Slice 2 has merged; FR-6 is written as an extension of SPEC-041's contract, not a parallel one. |
| R4 | **Two copies of the citation grammar** (this spec and the #803 linter) drift apart. | FR-1 / FR-9 / INV-5: one extraction pass serves both; #803 consumes its output. |
| R5 | **Historical baseline shows text the approver never saw** (working tree at approve time differed from the commit). | FR-8 uses a baseline only when it reproduces the recorded hash exactly; otherwise it says so. |
| R6 | **Spec-gate twin.** `canonical.ts` has a byte-identical Python twin (`scripts/hooks/canonical.py`) for the session spec-gate. | SPEC-041 keeps `upstream-stale` advisory (its Clarify FR-OQ4), so the session hook has no reason to read section fingerprints and this spec adds no Python twin (unverified against code: SPEC-041 is not built yet - Plan must confirm). If DR-062 section 3's commit/CI gate (#861) later reads section fingerprints, it must reuse this module or extend the twin and its parity test. |

## Out of Scope

- Building SPEC-041 itself (whole-doc `upstreamDeps`, `upstream-stale`, ADR/epic records, the
  reverse index, the toast) - this spec only narrows it.
- The SPEC-012 R2 / #803 linter rules (edge with no prose; prose with no edge) and edge
  provenance. FR-9 supplies their input and nothing more.
- Approvable-to-code anchors (DR-062 leg B, [#643](https://github.com/AIClarityAU/minspec/issues/643)
  - symbol-anchored, not section-anchored) and line-citation content checks
  ([#147](https://github.com/AIClarityAU/minspec/issues/147)).
- Shipping DR-053 v2's paragraph grammar or migrating the corpus to it (#679, #681).
- Fingerprinting `relates_to` or `supersedes` targets (SPEC-041 Clarify FR-OQ2: `depends_on` only).
- The commit/CI implement-gate (DR-062 section 3, [#861](https://github.com/AIClarityAU/minspec/issues/861)).

## Alternatives considered and rejected

- **Hand-authored anchors in frontmatter** (`depends_on: [DR-062#6]`). Rejected by DR-062 section
  6: optional hand-authored edges rot (zero corpus uses of `supersedes:`/`goal:`), and it would
  be a second, out-of-sync statement of what the prose already says.
- **Move edges into prose (prose as the edge source of truth).** Rejected here; DR-062 section 6
  requires its own DR for that.
- **Have an LLM judge which sections B relied on.** Rejected: puts an LLM in the approval
  decision path (DR-019, DR-062 section 4). The opt-in suggester may propose edges for a human;
  it never sets anchors.
- **Paragraph-level hashing of every paragraph of A, diffed against B's whole text.** Rejected:
  without a citation it cannot know which paragraph mattered, so it either narrows on a guess
  (INV-1 breach) or degenerates to whole-doc.
- **Store A's old section bytes in the approval record** for the FR-8 diff. Rejected: bloats the
  committed sidecar and duplicates content git already holds; FR-8 reads git history and
  verifies it against the recorded hash instead.

## Traceability

- **Issue:** [#862](https://github.com/AIClarityAU/minspec/issues/862).
- **Decision:** [DR-062](../../../docs/decisions/DR-062.md) section 6 (this spec); section 1
  (the whole-doc primitive it narrows). [DR-053](../../../docs/decisions/DR-053.md) section 3 /
  3.1 (typed paragraph ids and their stability). [DR-019](../../../docs/decisions/DR-019.md) (LLM
  never in the decision path).
- **Depends on:** [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (design D5,
  D6), [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) R2.
- **Extends:** [SPEC-029](../SPEC-029-approval-staleness-ux/requirements.md) (diff view).
- **Siblings:** [#803](https://github.com/AIClarityAU/minspec/issues/803) (symmetric linter),
  [#679](https://github.com/AIClarityAU/minspec/issues/679) (DR-053 grammar),
  [#643](https://github.com/AIClarityAU/minspec/issues/643) (leg B),
  [#861](https://github.com/AIClarityAU/minspec/issues/861) (commit/CI gate).
