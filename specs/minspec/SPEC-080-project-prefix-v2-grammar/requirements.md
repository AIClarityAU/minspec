---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a reference grammar that resolves wrong, or not at all, is a false/missing signpost
relates_to: [DR-053, SPEC-035, SPEC-034]
implements: none
implements_reason: specification only — no code, script, or test is created by this dispatch. `implements`/`affects` is left undeclared per SPEC-038 FR-3/SPEC-071's precedent until Plan settles which of the Decisions-needed options is chosen; the file is known (`packages/shared/src/project-prefix.ts` + its test) but the exact function-signature shape is not, so declaring now would risk a Plan-time edit staling an early approval for free.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: `@aiclarity/shared`'s `project-prefix` module speaks DR-053 v2

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#679](https://github.com/AIClarityAU/minspec/issues/679)** —
`packages/shared/src/project-prefix.ts` still speaks **DR-053 v1** (2-letter codes,
dash joiner, approvable-level only); [DR-053](../../../docs/decisions/DR-053.md) v2
(accepted 2026-07-14) replaces that grammar and the module has not followed. DR-053's own
Status section names this module update as a **hard predecessor to any runtime use** of
the already-flipped `.minspec/project-prefixes.md` table — the table is 3-letter today,
the module still joins with a dash, and nothing stops `formatCrossRef` from emitting
`MIN-SPEC-019`: a chimera in **neither** register.

## One-Sentence Scope

Change `project-prefix.ts`'s regexes, types, and formatting functions from the v1 grammar
(`MS-SPEC-019`, 2-letter, dash-joined, approvable-only) to the DR-053 v2 grammar
(`MIN/SP19`, 3-letter, slash-joined, paragraph-addressable down to `MIN/SP19/FR3`), so the
module reads **both** forms during the migration window (dual-read; DR-053 Status) and
never emits an interim form that belongs to neither.

## Context

### What exists today, verified against this repo's `HEAD`

- `project-prefix.ts:86-90` — the regexes are 2-5-letter-prefix-tolerant but **dash**-only
  (`CROSS_SDD_RE`, `^(${PREFIX})-(SPEC|DR|EPIC)-(\d+)$`) and **issue** refs join on `#`
  (`CROSS_ISSUE_RE`). `RefKind` is `'SPEC' | 'DR' | 'EPIC' | 'ISSUE'` — the **full** SDD
  word, never the v2 short code (`SP`/`DR`/`EP`).
- `suggestPrefixDeterministic` (`:223-237`) emits **2** letters (`minspec → MI`).
- There is **no paragraph segment** anywhere in the module — no third-segment type, no
  elision handling, no notion of "the document this ref appears in" to resolve an elided
  reference against.
- `.minspec/project-prefixes.md` was **already** edited to the v2 3-letter codes
  (`MIN`/`SCR`/`SEA`/`MMO`, no 2-letter rows retained) — this is the table DR-053's own
  Consequences section calls out as the **latent chimera risk**: nothing wires this table
  to a resolver today (confirmed: no `fs` read of this path exists outside the two files
  grepped below), so the mismatch has not yet produced a wrong answer, but it will the
  moment any caller reads the table and calls `formatCrossRef`.
- **No production consumer exists yet.** `grep -rl` across `packages/` for
  `project-prefix|formatCrossRef|resolveRef|parsePrefixTable|suggestPrefixDeterministic|isCrossProjectRef`
  returns five source hits (build output under `out/` excluded): `project-prefix.ts`/
  `.test.ts` themselves, `packages/shared/src/index.ts`'s barrel re-export, one unrelated
  string-literal hit in `dispatch-automerge-doc-exclusion.test.ts` (a doc-exclusion list
  citing the **file path** `.minspec/project-prefixes.md`, not the API), and one more
  coincidental hit in `managed-script-dependencies.test.ts` — that file declares its own
  local `resolveRef(outputPath, ref)` helper for resolving script-dependency paths, same
  name, unrelated module, not an import of `project-prefix.ts`. None of the five is a real
  caller. The intended consumer, SPEC-035 (lozenges/hover cards), is `plan: in-progress`
  and explicitly **queued, not now** — so this change has **no production call site to
  break**, which lowers the bar for reshaping the API surface (new params, new return
  variants) relative to a module with live callers.
- **v1-form refs already exist in the corpus**, so dual-read is not theoretical:
  `specs/minspec/SPEC-035-approvable-ref-lozenges/design.md` measures and cites
  `MS-SPEC-019`, `SC-DR-007`, `MS#500`, `SC#26` as real tokens its own future detector must
  handle. The corpus migration to the v2 form is [#681](https://github.com/AIClarityAU/minspec/issues/681),
  explicitly **deferred and separate** from this issue.

### The issue body's approvable-code list is stale against DR-053's own accepted text

The dispatching issue (filed before DR-053's 6-lens adversarial review landed) asks for an
approvable segment of `SP|DR|EP|PR|IS` and a paragraph set of
`FR|OQ|R|AC|INV|AL|CR|CQ|FU|M|G|RD|DV`. Checked against the **accepted** DR-053 text
(the authoritative source — Evidence Discipline bars treating a stale issue body as
current):

- **OQ2 is RESOLVED in DR-053 §2, in the opposite direction from the issue.** Issues/PRs
  keep **GitHub-native `#N`** (`#500` intra-project, `SCR#204` cross-project) — `IS`/`PR`
  letter-codes were considered and **rejected** (loses GitHub autolinking, costs keystrokes,
  adds an issue-vs-PR mislabel mode). This spec follows DR-053, not the issue body: the
  approvable segment is `SP|DR|EP` (+ the `RF`-paragraph's PR-approvable wrinkle below),
  never `IS`/`PR` as approvable letter codes.
- **The paragraph type table is bigger than the issue lists.** DR-053 §3's accepted table
  has 20 codes, not 13 — the issue's list omits `NFR AS CT DP TV FM D CL RF`. This spec
  specifies against the full accepted table.

### A real irregularity in the accepted grammar that the module must still parse correctly

Three details in DR-053 §3/§4, read closely, do not fit the plain `TYPE+number` pattern
every other paragraph code uses, and the module's regex/parsing design must account for
all three rather than silently mis-tokenising them:

1. **`INV` is named, not numbered** — `INV-<slug>` (e.g. `INV-live-status-deterministic`),
   explicitly to avoid false-negatifying every real invariant under a numeric-only grammar.
2. **`G` (constitution goal) appears in prose as `G-1`/`G-N`** (dash before the digits) —
   DR-053 §4 groups it with `INV` as "named/non-plain-numbered," which reads as "also
   irregular," but the goal **number** is still numeric, unlike `INV`'s slug. Whether `G`'s
   paragraph-segment form keeps the dash (`G-3`) or drops it to match the plain pattern
   (`G3`, consistent with `FR3`/`R1`) is not stated outright — see **DQ-2**.
3. **Longest-match ordering matters for correctness, not just style.** `RD` must be tried
   before `R` and `NFR` before `FR`/`R`, or `RD1` mis-tokenises as `R` + stray `D1`, and
   `NFR3` as `FR3`'s wrong neighbour `N` + `FR3`. Any regex alternation (or equivalent
   trie/switch) the module builds for the paragraph-type segment MUST order candidates
   longest-first; this is a correctness requirement, not an optimization.

### The `RF`/`PR` wrinkle

DR-053 §3's `RF` (review finding) row gives the worked example `MIN/PR451/RF3` — a form
that puts the **GitHub PR number directly in the APPROVABLE segment as `PR451`**, not as
`#451` with the paragraph segment somehow hung off a `#`-joined token. This appears to
cut against §2's "issues/PRs keep `#N`, not letter codes" resolution, for the specific case
where a paragraph needs to address *into* a PR. DR-053 does not reconcile this itself. This
spec surfaces it as **DQ-3** rather than guessing a resolution the DR text does not commit
to.

### The legacy-prefix dual-read gap

`.minspec/project-prefixes.md` was overwritten **in place** to 3-letter codes — it carries
**no** `MS`/`SC`/`SB` rows alongside `MIN`/`SCR`/`SEA`/`MMO`. A v1-form ref written against
the old table (`MS-SPEC-019`, `SC#26`) is syntactically still a valid v1 token, but
resolving it against *this* table today would find no `MS` row at all and fall through to
`unknown-prefix` — which is advisory and non-fatal (DR-053 §5, never a hard failure) but is
a **worse** answer than "resolves correctly to minspec" for a ref that was written in good
faith under the grammar that was current when it was written. Whether the table should
carry both old and new rows for the migration window, or whether a v1 ref going
`unknown-prefix` until [#681](https://github.com/AIClarityAU/minspec/issues/681) migrates
it is the accepted interim cost, is **DQ-1**.

## Functional Requirements

- **FR-1 — 3-letter project codes.** `suggestPrefixDeterministic` emits a **3**-letter
  deterministic fallback code (not 2), using the same taken-set collision-avoidance
  algorithm the current 2-letter version uses, scaled to the extra character, so a batch
  of new projects does not collapse onto one code (DR-053 §1 seed: `MIN`/`SCR`/`SEA`/`MMO`).
- **FR-2 — Slash-joined SDD cross-project refs, short approvable codes.** A cross-project
  SDD reference token has the v2 shape `<PROJECT>/<SP|DR|EP><digits, no leading zeros>`
  (`MIN/SP19`, `SCR/DR7`) — replacing the v1 `<PREFIX>-<SPEC|DR|EPIC>-<padded digits>`
  shape as the module's canonical **emitted** form. The module's internal/local id
  representation (`SPEC-019`, matching this repo's own frontmatter/filename convention)
  is unaffected — FR-2 changes only the crossing-the-wire token shape, never the local id
  string the rest of the corpus already keys on.
- **FR-3 — Cross-project issue/PR refs keep `#`, gain the 3rd letter.** `<PROJECT>#<digits>`
  (`SCR#204`) — same joiner as today, only the prefix length changes. No `IS`/`PR` letter
  code is introduced for a plain issue/PR reference (OQ2, resolved against the issue body's
  stale ask — see Context).
- **FR-4 — Paragraph segment, closed vocabulary, longest-match.** The module can parse and
  resolve a third segment of the shape `<TYPE><digits>` for every code in DR-053 §3's full
  table (`FR NFR OQ D CL RD R AC AS CT DP TV FM INV AL CR CQ FU M G DV RF` — 20 codes, not
  the issue's 13), with `INV` taking a named slug instead of digits, and type-code matching
  ordered so no shorter code (`R`, `FR`) ever consumes a longer code's prefix (`RD`, `NFR`)
  by accident (see Context's longest-match note). `G`'s plain-numbered-vs-dashed shape is
  **DQ-2**.
- **FR-5 — Elision resolves against caller-supplied context, never guesses.** A 1-segment
  (`FR3`), 2-segment (`SP19/FR3`), or 3-segment (`MIN/SP19/FR3`) input all resolve to the
  same semantic identity once the elided segments are known. Because this module is pure
  (no notion of "the document currently being read"), the **caller** must supply whatever
  context an elided form needs to resolve (e.g. "this ref appears inside `minspec`'s
  `SPEC-19`") — the module itself never infers an elided segment from anything but that
  supplied context, and an elided ref with insufficient context resolves the same way an
  unknown prefix does today: advisory, never a thrown exception, never a silent wrong
  guess. The exact parameter shape threaded through `resolveRef` (or a new function) for
  this context is a Plan-level design detail; the invariant this FR fixes is **never guess
  an elided segment from the token's own text**.
- **FR-6 — Dual-read: v1 and v2 both parse, correctly, without cross-contamination.** Both
  `MS-SPEC-019` (v1: 2-letter, dash, full word) and `MIN/SP19` (v2: 3-letter, slash, short
  code) resolve correctly during the migration window named in DR-053's Status section. The
  module must **reject**, not silently normalize, a chimera that mixes a v1-length prefix
  with a v2 joiner or vice versa (`MIN-SPEC-019`, `MS/SP19`) — DR-053's own named "interim
  chimera" risk (R3) — by treating it as a non-match (parses as `null`/not-a-reference)
  rather than guessing which grammar the author meant.
- **FR-7 — `formatCrossRef` emits v2 by default; v1 emission is not silently dropped from
  the surface without a decision.** Because v1 refs already exist in the corpus and the
  migration ([#681](https://github.com/AIClarityAU/minspec/issues/681)) has not run, a
  caller may still have a legitimate reason to render a v1-form ref during the transition
  (e.g. a tool diffing an unmigrated file against its own prior output). Whether that stays
  reachable (a version parameter, a second exported function, or dropped outright because
  nothing calls it today — see Context's no-consumer finding) is **DQ-4**.
- **FR-8 — Never-fail-loud holds for every new surface.** An unresolvable prefix, an
  unrecognised paragraph-type code, and a syntactically-almost-but-not-quite-valid token
  (the FR-6 chimera case) all resolve advisory (`unknown-prefix` or `null`), consistent
  with the existing contract — none of this spec's additions may introduce a thrown
  exception path the v1 module did not have (DR-053 §5; constitution invariant 2's sibling
  concern — a crash is a different flavor of unhelpful than a silent wrong answer, but
  still not what a Tier-0 "resolve or say advisory" contract promises).

## Invariants (must not break)

- **INV-1 — Tier-0, pure (constitution invariant 1).** No `fs`, no `vscode`, no network, no
  LLM call added to `project-prefix.ts`. Reading `.minspec/project-prefixes.md` off disk
  stays the caller's job (the extension's fs adapter), exactly as it is today.
- **INV-2 — Never fail loud (DR-053 §5, carried from v1).** An unknown code — project,
  approvable, or (new) paragraph type — resolves to an advisory result, never a thrown
  exception, never a silent drop that looks identical to success.
- **INV-3 — Ids are handles, not positions (DR-053 §3.1).** This module does not allocate
  or renumber paragraph ids — that is an authoring-time concern elsewhere. Nothing in this
  spec's FRs may introduce code that re-derives a paragraph number from textual position;
  the module only ever **parses** a number the author/tool already stamped.
- **INV-4 — No chimera accepted as valid (DR-053 Consequences, R3).** A token mixing a v1
  prefix-length with a v2 joiner (or the reverse) is never treated as a resolvable
  reference of either version (FR-6).
- **INV-5 — Local ids are untouched.** `SPEC-019`/`DR-053`/`EPIC-002`-style local,
  intra-repo ids (used everywhere in this corpus's frontmatter, filenames, and prose)
  keep their existing full-word, padded, dash form. This spec changes only the
  **cross-project reference token** shape, never what a bare local id looks like.

## Acceptance Criteria

- [ ] **3-letter suggestion.** `suggestPrefixDeterministic('minspec')` returns a 3-letter
      code; the taken-set collision walk still produces a free code when the first
      candidate collides. (FR-1)
- [ ] **v2 SDD cross-ref round-trips.** A v2-form token (`MIN/SP19`) resolves to the same
      semantic identity (`project: minspec`, kind `SPEC`, num `19`) that the current v1
      token (`MS-SPEC-019`) resolves to against the matching table rows, and
      `formatCrossRef`'s v2 output round-trips back through the resolver. (FR-2, FR-7)
- [ ] **v2 issue cross-ref.** `SCR#204` resolves to `project: scrooge`, kind `ISSUE`,
      num `204`. (FR-3)
- [ ] **Paragraph segment, full table.** Every code in DR-053 §3 (not just the issue's
      13-code subset) parses when appended as a third segment, including the `INV-<slug>`
      named form. (FR-4)
- [ ] **Longest-match holds.** `RD1` parses as type `RD` num `1`, never type `R` +
      leftover; `NFR3` parses as type `NFR` num `3`, never `FR3` with a stray `N`. (FR-4)
- [ ] **Elision resolves only with supplied context.** A bare `FR3` with no context
      supplied by the caller does not silently resolve to any specific document; given a
      context identifying the enclosing approvable, it resolves to that approvable's FR3.
      (FR-5)
- [ ] **Dual-read, both directions.** Each of the real v1 tokens measured in
      `SPEC-035-approvable-ref-lozenges/design.md` (`MS-SPEC-019`, `SC-DR-007`, `MS#500`,
      `SC#26`) still parses correctly post-change, alongside their v2 equivalents. (FR-6)
- [ ] **Chimera rejected.** `MIN-SPEC-019` (3-letter + dash) and `MS/SP19` (2-letter +
      slash) both resolve as non-references (not as a cross-project match of either
      flavor). (FR-6, INV-4)
- [ ] **No new throw path.** Every new input shape added by this spec (paragraph segment,
      elision, dual-read) that is malformed resolves advisory, with a test asserting
      `resolveRef`/the new entry point does not throw. (FR-8, INV-2)
- [ ] **Local ids unchanged.** Existing local-id test cases (`SPEC-019` resolves `local`,
      kind `SPEC`, num `19`) still pass byte-for-byte post-change. (INV-5)
- [ ] **`npm test` and `npm run validate` pass** with the updated
      `packages/shared/tests/project-prefix.test.ts` covering every new FR/AC above —
      the test file explicitly named in the issue as needing its MS/SC/SB-fixture,
      `MS-SPEC-019`-only assertions widened, not replaced wholesale (dual-read, FR-6).

## Decisions needed (Clarify)

- **DQ-1 — Does the prefix table carry legacy 2-letter aliases during the migration
  window, or does a v1-written ref go `unknown-prefix` until #681 migrates it?**
  `.minspec/project-prefixes.md` currently has no `MS`/`SC`/`SB` rows at all.
  - **(A) Add legacy alias rows** (`MS → minspec`, etc.), kept until #681 lands, then
    removed. *Cost:* a second code path (or duplicate `byPrefix` entries) that must be
    explicitly retired, another thing #681's migration PR must remember to clean up.
  - **(B) Leave the table 3-letter-only; a v1-written ref resolves `unknown-prefix`
    (advisory, never fatal) until #681 rewrites it in place.** *Cost:* any tool reading
    the corpus between now and #681 landing sees existing v1 refs as unresolved, which is
    a worse (but non-fatal, per DR-053 §5) answer than resolving them correctly.
  - *Recommendation:* **(B).** DR-053's own Status section already accepts "write refs in
    whichever form is clearest and don't mass-rewrite" as the interim state; adding
    alias rows is scope this module-update issue did not ask for and creates a second
    cleanup step for #681. Advisory degradation is the contract DR-053 §5 already
    promises for exactly this situation.
- **DQ-2 — Does the paragraph segment's `G` (constitution goal) code keep the dashed
  `G-<n>` shape prose already uses, or normalize to the plain `G<n>` every other numbered
  code uses?** DR-053 §4 names `G` alongside `INV` as "named, not numbered" but `G`'s
  identifier is still numeric, unlike `INV`'s slug.
  - *Recommendation:* **normalize to `G<n>`** (plain, matching `FR3`/`R1`/every other
    numbered code) and treat `INV` as the sole slug-named exception; keeping two
    different numbered-code shapes (`FR3` vs `G-3`) buys no clarity and complicates the
    longest-match regex for no reason. *Cost:* existing prose already writes `G-1`/`G-N`
    with a dash (per DR-053 §3's own text) — normalizing the paragraph-segment form means
    that prose convention and the addressable-ref form diverge, which needs a one-line
    callout wherever `G` is next documented.
- **DQ-3 — How does the `RF`/PR-approvable form (`MIN/PR451/RF3`) reconcile with §2's
  "issues/PRs keep `#N`, no letter codes"?** DR-053's own worked example contradicts its
  own §2 resolution for this one case, and this spec does not have standing to resolve a
  DR-053 textual inconsistency on its own.
  - *Recommendation:* **escalate to a DR-053 addendum before Plan**, rather than this
    spec picking a reading. The `RF` type's first real consumer
    ([#465](https://github.com/AIClarityAU/minspec/issues/465)) is itself not yet built,
    so there is no urgency forcing a guess now. *Cost:* this spec's Plan phase cannot
    finalize the APPROVABLE-segment grammar for PR-scoped paragraphs until the addendum
    lands — scoped as a dependency, not a blocker for the rest of FR-4's paragraph table
    (every other paragraph type is approvable-scoped to `SP`/`DR`/`EP`, which §2 does not
    contradict).
- **DQ-4 — Does `formatCrossRef` keep a v1-emission path at all?** No production code
  calls `formatCrossRef` today (Context).
  - *Recommendation:* **drop v1 emission from the public surface; keep v1 *parsing* only
    (FR-6).** Emission is forward-looking (a tool choosing what to write), and nothing
    needs to write v1 going forward once this spec ships — only *reading* historical v1
    text (dual-read) is load-bearing. *Cost:* if a not-yet-identified caller does need to
    emit v1 during the transition, it has to re-derive the dash-joined form itself rather
    than calling a shared function — judged unlikely given zero current consumers.

## Out of Scope

- **Corpus migration to v2 token forms** ([#681](https://github.com/AIClarityAU/minspec/issues/681)) —
  rewriting the `MS-SPEC-019`/`SC#26`-style refs already in `specs/`/`docs/` to v2 form.
  This spec only makes the module **able** to read and emit both; it does not touch the
  corpus.
- **The egress-guard v2 teach-in** (DR-053 Consequences, R4) — the DR-032/SPEC-021
  internal-ref stripper learning the v2 grammar so new-form refs don't leak into user
  output. Named as a DR-053 follow-up, tracked separately, not this module.
- **SPEC-035's lozenge/hover-card render** — the consumer of this module's output;
  `plan: in-progress`, queued, not re-specified here.
- **Tier-1 LLM-assisted unknown-prefix suggestion** ([#614](https://github.com/AIClarityAU/minspec/issues/614)) —
  this spec covers only the deterministic Tier-0 fallback (FR-1), not an LLM-backed nicer
  suggestion.
- **The duplicate-paragraph-id uniqueness gate** ([#396](https://github.com/AIClarityAU/minspec/issues/396)) —
  a corpus-wide check that two documents don't stamp the same handle; this spec's module
  only parses/resolves a token already stamped, it does not allocate or de-duplicate ids.
- **Resolving DR-053's own `RF`/§2 textual inconsistency** (DQ-3) — flagged for
  escalation, not resolved by this spec.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees rejected options
live (DR-086 §4).

- **Guessing a resolution for the issue body's `IS`/`PR` approvable-code ask instead of
  following DR-053's accepted OQ2 resolution.** Rejected — Evidence Discipline treats the
  issue body as untrusted/potentially-stale input, and DR-053's accepted text (dated after
  the issue, following an explicit adversarial review) is the authoritative source for
  what the grammar actually is.
- **Silently resolving DQ-2/DQ-3 one way inside this spec rather than flagging them.**
  Rejected — DQ-3 in particular is a genuine inconsistency inside an *already-accepted* DR;
  a Specify-phase spec guessing at it risks baking a wrong reading into Plan/Tasks before a
  human has seen the conflict.
- **Treating this as requiring a new DR.** Rejected for now — DR-053 already made every
  grammar-shape decision this spec operationalizes; what remains (DQ-1/DQ-2/DQ-4) are
  implementation-detail choices on an as-yet-unconsumed Tier-0 module, reversible well
  within a day (the DR-359 ADR filter), so no new DR is minted here. DQ-3 is the one item
  that may force a DR-053 **addendum** (not a new DR) if the escalation in DQ-3 surfaces a
  real grammar change — that is DR-053's own register to amend, not a new decision record.

## Traceability

- **Issue:** [#679](https://github.com/AIClarityAU/minspec/issues/679) — `project-prefix`
  module v1→v2 update, filed as a DR-053 follow-up and named there as a **hard
  predecessor** to any runtime use of the already-3-letter `.minspec/project-prefixes.md`
  table.
- **Decision this spec operationalizes:** [DR-053](../../../docs/decisions/DR-053.md) —
  accepted 2026-07-14, v2 grammar, 6-lens adversarial review addendum.
- **Consumer, queued:** [SPEC-035](../SPEC-035-approvable-ref-lozenges/requirements.md) —
  the lozenge/hover-card renderer; its own text already measures the real v1 refs this
  spec's FR-6 dual-read requirement must keep parsing.
- **Sibling follow-up, separate:** [#681](https://github.com/AIClarityAU/minspec/issues/681) —
  corpus migration, explicitly out of scope here.
- **Sibling follow-up, separate:** egress-guard v2 teach-in (DR-053 Consequences R4),
  tracked under DR-053's own Follow-ups.
- **Blast radius:** constitution invariant 1 (offline core, INV-1) and invariant 2
  (no silent gate, INV-2/FR-8) — this module ships inside `@aiclarity/shared`,
  which both MinSpec packages depend on; a thrown exception or a silently-wrong resolution
  here would surface wherever a future consumer calls it.
