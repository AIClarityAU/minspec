---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — the Tier-0 contract already reserves this field; this spec is the missing fs-adapter half
aspects: [signpost, next-task, fs-adapter, prose-parsing, tier-0]
relates_to: [SPEC-012, SPEC-010, DR-085, "#227", "#1436"]
# `SpecNode.hasUnresolvedOpenQuestions` and the `answer-OQ` generator already exist in
# packages/shared/src/next-task.ts (built under #227); artifact-graph.ts and spec-validator.ts
# are owned by SPEC-012/#40 respectively for other fields/rules. This spec adds ONE new
# computation (the OQ parser) to an existing file and exports an existing-but-private
# predicate from another; neither file is created, so `implements:` covers only the new test.
implements: [packages/minspec/tests/open-question-detection.test.ts]
affects:
  - packages/minspec/src/lib/artifact-graph.ts
  - packages/minspec/src/lib/spec-validator.ts
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: The fs-adapter must compute `hasUnresolvedOpenQuestions`, or `answer-OQ` stays dead code

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1463](https://github.com/AIClarityAU/minspec/issues/1463)** — `answer-OQ` is
a declared next-task node kind with a full generator in the resolver
(`packages/shared/src/next-task.ts`), and it never fires in the shipped extension because
nothing ever sets the field it gates on.

## One-Sentence Scope

Add the fs-adapter computation of `SpecNode.hasUnresolvedOpenQuestions` to
`buildArtifactGraph` (`artifact-graph.ts`), reusing — not re-implementing — the
tracked-via-issue exemption the dangling-park-ref linter (`spec-validator.ts`, #40) already
enforces, so a spec carrying a genuinely unanswered Open Question surfaces as a signpost
node instead of silently never doing so.

## Context

### What the issue reports, verified against this repo's current `HEAD`

The issue's mechanism claim checks out exactly as stated:

- `packages/shared/src/next-task.ts:100` declares `SpecNode.hasUnresolvedOpenQuestions?:
  boolean` as part of the Tier-0 contract, with a doc comment saying the field is "computed
  by the fs-adapter." The header's own DEFERRED list (`next-task.ts:35-39`) says the same
  thing: `'answer-OQ'` (#227) "IS implemented in this slice" at the resolver level, but
  "parsing the Clarify/Open-Questions prose into that boolean … remains the fs-adapter's job
  and is NOT yet built there."
- The in-flight generator (`next-task.ts:790-819`) reads `if (!s.hasUnresolvedOpenQuestions)
  continue;` for every spec, and the terminal-coherence check (`next-task.ts:490`,
  `:518`) reads the same field for both `SpecNode` and `AdrNode`.
- `buildArtifactGraph`'s spec loop (`artifact-graph.ts:538-551`) builds every other
  documented `SpecNode` field — `id`, `status`, `tier`, `phase`, `epic`, `approvalState`,
  `goalRank`, `priority`, and (#1436) `implementHole` — but never assigns
  `hasUnresolvedOpenQuestions`. Grepping the file for the field name returns nothing. The
  same is true of the ADR loop (`artifact-graph.ts:554-571`) for `AdrNode`.
- Net effect: the field is `undefined` for every real spec and ADR, both loops in
  `next-task.ts` that gate on it always skip, and `'answer-OQ'` — a node kind the resolver,
  its tests, and DR-085 all treat as real — has never once been emitted outside a hand-built
  fixture.

### `answer-OQ` is not obsoleted by DR-085 — it is the one sibling DR-085 keeps

[DR-085](../../../docs/decisions/DR-085.md) (accepted 2026-08-19) restricts the signpost to
acts "the human can complete from the editor, without delegating," and on that test
`phase-action` is scheduled to leave the signpost while `spec-approve`, `adr-accept`,
`epic-promote`, and **`answer-OQ`** explicitly stay (DR-085 §1). Resolving an open question
by editing the spec's own prose is exactly the from-the-editor act DR-085 requires, so this
work is not at risk of being built against a node kind about to be removed — it is the one
of the five `NodeKind` values DR-085 names as correctly staying, and today it is the only one
of those four that never fires.

### `answer-OQ` was never written into SPEC-012's own text

Unlike `phase-action` — which SPEC-012's original State Model table (requirements.md:90)
already listed before #1436 built it — `'answer-OQ'` and `hasUnresolvedOpenQuestions`
appear nowhere in SPEC-012's body; they exist only in code comments under a different issue
number (#227). SPEC-012's own frontmatter header states the established convention for a
spec that only touches `next-task.ts`/`artifact-graph.ts` without redefining SPEC-012's own
requirements: declare `affects:`, as SPEC-040/041/046/059 already do, rather than editing
SPEC-012's body. This spec follows that precedent rather than amending SPEC-012, and does
not attempt to retroactively document `answer-OQ`'s original #227 design — only the missing
fs-adapter half (#1463) is in scope here.

### The corpus's real Open-Questions prose does not match a simple reading of the issue

The issue names "parsing Clarify-section `- [ ]` boxes and `OQ-N` prose." Grepping every spec
in this repo for a checkbox line (`- [ ]` / `- [x]`) anywhere under an `## Open questions` or
`## Clarify` heading returns **zero** matches — no spec in this corpus uses checkboxes for
Open Questions; `- [ ]` is an Acceptance-Criteria convention, not an OQ one. What the corpus
actually uses, read across a sample of specs with real Open-Questions sections:

| Spec | Convention observed |
|---|---|
| SPEC-010 (`implementing`) | Resolved items struck through (`~~…~~`) with "**Resolved by …**" inline; heading kept permanently "for record," explicitly still `## Open questions` on a non-terminal spec. |
| SPEC-012 (`implementing`) | A separate "**Resolved questions**" heading for closed items (`OQ1`/`OQ2`/`OQ3`), a distinct "## Open questions" heading for the two still open (`OQ4`/`OQ5`), each explicitly tagged `*(Open — plan phase.)*`. |
| SPEC-013 (`implementing`) | `## Open questions` heading present with a single bullet, **`- **None blocking.**`** — no `OQ-N` label at all. |
| SPEC-014 (`implementing`) | **Two items genuinely still open** (`FR-OQ1`, `FR-OQ2`), each tagged `*(Open — plan phase.)*`, **not** struck through. Critically, `FR-OQ1`'s own bullet contains the word "resolved" mid-sentence — *"Presentation resolved: Google-Docs conversation pane … **Still open: the re-anchor algorithm.**"* — while the item as a whole remains unresolved. |
| SPEC-017 (no `## Open questions` heading) | Resolutions recorded instead in a `## Clarify` table (`FR-OQ1`…`FR-OQ6`), with no corresponding struck-through bullet anywhere — the original questions were never written as a separate list at all. |
| SPEC-029 (`status: done`) | All three `FR-OQN` items struck through with "**Resolved: …**"; heading note says "*All three resolved in Clarify … none remain blocking Plan.*" |

Two concrete failure cases this surfaces for ANY naive heuristic:

1. **A bare keyword match on "resolved" false-negatives on SPEC-014.** `FR-OQ1`'s bullet
   contains "resolved" in its first clause while the overall item is open — a detector that
   treats "the bullet contains 'resolved'" as sufficient would silently classify a currently
   `implementing` spec's genuinely open question as resolved, reproducing this issue's own
   defect class one layer down.
2. **A bare heading-presence match false-positives on SPEC-010, SPEC-012, SPEC-013, and
   SPEC-029.** All four keep an `## Open questions` heading on an `implementing` (or `done`)
   spec with fully-resolved content underneath — a detector that fires on "the heading exists
   and isn't empty" would flood the signpost with already-closed questions, which is worse
   than today's silent miss for a *"never-wrong"* surface (CLAUDE.md Evidence Discipline).

This is exactly the ambiguity [Decisions needed](#decisions-needed-clarify) DQ-1 exists to
resolve before Plan — guessing a regex here risks building the "two prose parsers that
disagree" failure the issue itself warns against, just with one parser instead of two.

## Functional Requirements

- **FR-1 — Compute the flag in the fs-adapter, for every discovered spec, mirroring the
  #1436 seam.** `buildArtifactGraph`'s spec loop (`artifact-graph.ts:538-551`) MUST set
  `hasUnresolvedOpenQuestions` for every spec it builds, the same way it already sets
  `implementHole` unconditionally and lets the resolver decide which specs act on it
  (`next-task.ts` already gates on `status === 'implementing'` and terminal status; this spec
  does not change that gating, only supplies its missing input). The source text lives
  entirely inside the spec's own primary file — `ParsedSpec.sections` already maps every
  `## heading` to its body (`spec.ts:257-296`); no sibling-file split (the `tasks.md`
  pattern `readImplementHole` handles) applies here, since no spec in this corpus keeps Open
  Questions in a separate file.
- **FR-2 — One predicate for "parked with a tracking link," reused, not duplicated.** The
  "neither answered nor parked-with-a-tracking-link" exemption MUST be the same check
  `spec-validator.ts`'s dangling-park-ref lint (#40) already applies (`ISSUE_LINK_RE` /
  `hasDanglingParkRef`'s link-window logic, `spec-validator.ts:642-663`), exported or
  factored into a shared helper rather than re-implemented a second time. Today that
  predicate is a private, unexported function; this FR requires making it (or an equivalent
  shared primitive) importable from `artifact-graph.ts` without copying its regex. This is
  the issue's own explicit ask ("reusing that linter's existing predicate… is the point; two
  prose parsers that disagree is how this drifts") and is unconditionally required under
  every DQ-1 answer below.
- **FR-3 — The exact "unresolved OQ" textual heuristic is resolved at Plan against named,
  real fixtures, not guessed at Specify.** Whichever heuristic [DQ-1](#decisions-needed-clarify)
  selects MUST be pinned against, at minimum: SPEC-014's `FR-OQ1`/`FR-OQ2` as a required
  true-positive (a currently-`implementing` spec with a real unanswered question MUST be
  detected), and SPEC-010/SPEC-012/SPEC-013/SPEC-029's existing resolved sections as required
  true-negatives (none of them may newly appear on the signpost once this ships). A design
  that cannot explain its answer on all five is not ready for Plan.
- **FR-4 — Honest degradation favors the quiet failure, not the loud one.** Unlike
  `readImplementHole` (where "wrong in the harmless direction" means defaulting to *visible*
  on an unparseable task list, #1436), this field feeds a human-facing signpost node where
  over-firing is the more expensive mistake: an approval or DR-accept node that outranks a
  false "answer-OQ" on severity/tie-break terms gets pushed down for no real reason, and a
  "never-wrong" signpost that cries wolf trains the human to stop trusting it (the
  dangling-park-ref linter's own stated precision-over-recall design,
  `spec-validator.ts:636-640`, is the precedent to follow). On any unparseable or ambiguous
  Open-Questions section, the computed flag MUST default to `false` (no unresolved OQ),
  never fabricate `true` from uncertainty.
- **FR-5 — The terminal-coherence half activates for free, and both halves need a real
  regression fixture.** `next-task.ts`'s `detectIncoherence` already reads
  `hasUnresolvedOpenQuestions` for a `done`/`archived` spec (`:490`) and a non-`proposed` DR
  (`:518`); once FR-1 ships, both the in-flight `answer-OQ` node AND this terminal-corruption
  check become live from real data simultaneously, because they share one input. Both paths
  MUST gain at least one fixture-backed regression test exercised through
  `buildArtifactGraph` + the resolver together (not only the resolver's existing hand-built
  `ArtifactGraph` fixtures in `packages/shared/tests/next-task.test.ts`), the same end-to-end
  shape `artifact-graph-realdata.test.ts` / `artifact-graph-fidelity.test.ts` already use for
  `implementHole`.
- **FR-6 — `INV-PA-OQ-ORDER` becomes reachable from real data; a real-corpus fixture must
  exercise it.** `packages/shared/tests/next-task.test.ts`'s `INV-PA-OQ-ORDER` test (pinning
  "an unanswered open question outranks implementing against it") today exercises the tie
  only through hand-built fixtures, by the test's own comment. Once a real spec can carry
  both `hasUnresolvedOpenQuestions: true` and a live `implementHole` at the same time, this
  spec's acceptance bar MUST include at least one fixture proving the real `buildArtifactGraph`
  output preserves that ordering — not just the resolver-level unit test already in place.

## Invariants (must not break)

- **INV-1 — Tier-0 purity (constitution invariant 1, DR-004).** The new parser is pure
  filesystem-text-in → boolean-out, same as `readImplementHole`: no network, no `vscode`
  import, no LLM. `packages/shared/src/next-task.ts` itself is untouched — it already
  declares and consumes the field; this spec only supplies the fs-adapter half.
- **INV-2 — Single predicate for the park exemption (issue's own stated goal).** No second,
  independently-maintained issue-link regex is introduced. A change to what counts as "a
  real tracking link" in one place is visible in both consumers by construction (FR-2).
- **INV-3 — Fail-quiet on ambiguity (FR-4).** The flag is never `true` on a parse path the
  implementation itself is not confident in. This is the mirror image of
  `readImplementHole`'s `unterminatedFence → missing-tasks` choice, deliberately inverted
  because the cost asymmetry runs the other way for a human-facing node (see FR-4).
- **INV-4 — `INV-PA-OQ-ORDER` holds (#1436).** A spec carrying both an unresolved OQ and an
  implement hole continues to rank `answer-OQ` ahead of `phase-action` once both are
  reachable from real data (FR-6).
- **INV-5 — No change to `NodeKind`, severity classes, or `next-task.ts`'s public contract.**
  This spec is additive to the fs-adapter only; the resolver core's types, gating, and
  ranking rules (SPEC-012 FR-1/FR-2) are unmodified.

## Acceptance Criteria

- [ ] **Flag computed for every spec.** `buildArtifactGraph` sets
      `hasUnresolvedOpenQuestions` (never leaves it `undefined`) for every spec it discovers,
      verified by a test asserting the field is a defined boolean on a representative fixture
      set. (FR-1)
- [ ] **One predicate, imported not copied.** `artifact-graph.ts`'s OQ parser calls the same
      exported park-ref/tracking-link predicate `spec-validator.ts` uses for its dangling-park
      lint; no second issue-link regex exists in the diff. (FR-2, INV-2)
- [ ] **SPEC-014 is detected as a true positive.** Run against this repo's own
      `specs/minspec/SPEC-014-review-webview/requirements.md` (or an equivalent fixture
      reproducing its exact `FR-OQ1`/`FR-OQ2` shape), the computed flag is `true`. (FR-3)
- [ ] **SPEC-010/012/013/029's resolved sections are true negatives.** Fixtures reproducing
      each spec's actual Open-Questions prose (struck-through-resolved, `None blocking.`,
      resolved-questions-plus-separate-open-heading) all compute `false`. (FR-3, FR-4)
- [ ] **Unparseable input degrades to `false`, never `true`.** A deliberately malformed or
      empty Open-Questions section yields `hasUnresolvedOpenQuestions: false`, with a test
      asserting the direction explicitly (not merely that it doesn't throw). (FR-4, INV-3)
- [ ] **Terminal-coherence fires on real data.** A fixture spec with `status: done`/`archived`
      and a genuinely unresolved OQ produces the `coherence.terminal-with-open-oq` violation
      end-to-end through `buildArtifactGraph` + the resolver, not only via the resolver's
      existing hand-built `ArtifactGraph` fixtures. (FR-5)
- [ ] **`INV-PA-OQ-ORDER` proven on real data.** A fixture spec carrying both a live
      `implementHole` and `hasUnresolvedOpenQuestions: true`, built through
      `buildArtifactGraph`, ranks `answer-OQ` ahead of `phase-action`. (FR-6, INV-4)
- [ ] **No Tier-0 regression.** `invariants.test.ts`'s network/import allowlist gains no new
      entry from this work. (INV-1)

## Decisions needed (Clarify)

- **DQ-1 — What exact textual heuristic counts as "an unresolved Open Question"?** The
  corpus evidence above (Context) rules out both extremes — a bare keyword match on
  "resolved" (false-negatives on SPEC-014) and bare heading-presence (false-positives on
  SPEC-010/012/013/029). Candidate options:
  - **(A) OQ-id-labelled bullet, resolved only by an explicit end-of-bullet marker or
    strikethrough.** Require a bullet matching an `OQ-`/`FR-OQ`/`AC-OQ`-shaped label
    (covering every labelled-bullet convention observed), then treat it as resolved only if
    the bullet is wrapped in `~~…~~` OR its *last* sentence/clause contains an explicit
    resolution marker (`Resolved:`, `RESOLVED`, `→ **Resolved`, or similar — exact phrase set
    pinned at Plan against the fixtures). The SPEC-014 counter-example (mid-bullet "resolved"
    with the final clause "Still open…") is why the marker must anchor to the *end* of the
    bullet, not anywhere in it. *Cost:* the phrase set is itself a small, curated vocabulary
    that can miss a future author's new phrasing (false negative — the safe direction per
    FR-4, but still a real maintenance surface).
  - **(B) Heading-presence with an explicit "closed" sentinel list.** Fire whenever an
    Open-Questions-shaped heading exists UNLESS its body matches one of a small set of
    closed-whole-section sentinels ("None blocking", "none remain", "all … resolved",
    heading text itself saying "resolved"). *Cost:* coarser than (A) — cannot handle a
    heading with a MIX of resolved and genuinely-open items (SPEC-012's own shape, OQ1-3
    resolved under one heading, OQ4-5 open under a separate one) without also requiring
    per-bullet logic, so in practice (B) collapses into (A) for the real corpus and is listed
    mainly to rule it out explicitly.
  - **(C) New machine-readable marker, prose parsing retired.** Require open questions to
    carry a structured per-item marker (e.g., a sibling `open_questions:` frontmatter list,
    or a dedicated `status: open|resolved` inline tag with a fixed grammar) instead of free
    prose. *Cost:* a corpus-wide migration of every existing Open-Questions section (the
    exact "costly to refactor" shape SPEC-012 already flags for its own FR-13 edge
    vocabulary) and a new authoring convention going forward; eliminates ambiguity but at a
    price well beyond this issue's stated scope.
  - *Recommendation:* **(A)**, pinned against the five named fixtures (FR-3) at Plan. It
    needs no corpus migration (unlike (C)), and unlike (B) it is precise enough to survive
    SPEC-012 and SPEC-014's actual mixed-resolution shapes without quietly degrading into (A)
    anyway. *Cost:* the curated marker-phrase vocabulary will need occasional extension as
    new phrasing appears in the corpus — the same ongoing-precision cost the dangling-park-
    ref linter already accepts for the same reason (`spec-validator.ts:636-640`).

- **DQ-2 — Does this spec's scope include the identical gap on the ADR side
  (`AdrNode.hasUnresolvedOpenQuestions`, also never set by `buildArtifactGraph`'s ADR loop,
  `artifact-graph.ts:554-571`)?** The issue names only `SpecNode` and the spec loop; grepping
  every DR in `docs/decisions/` for an `## Open question` heading today returns zero matches,
  so the ADR-side gap is real but currently inert (no live DR would be affected either way).
  *Recommendation:* **no — leave it explicitly out of scope here** (see
  [Out of Scope](#out-of-scope)) and file it as its own follow-up, consistent with this
  project's detection-≠-integration triage rule and this issue's own stated scope. *Cost:*
  the same defect persists, latent, for DRs until a human files and a session picks up that
  follow-up — low urgency given zero live instances, but a real gap deferred, not closed.
  **Not filed as a GitHub issue by this dispatch** — the agent producing this spec is not
  permitted to run `gh`/network commands; a human needs to file it (see Traceability).

## Out of Scope

- **The ADR-side gap** (`AdrNode.hasUnresolvedOpenQuestions`) — named and recommended as a
  separate follow-up in DQ-2, not built here.
- **Retroactively documenting `answer-OQ`'s original #227 design in SPEC-012's own body** —
  this spec supplies the missing fs-adapter half only, under `affects:`, per the precedent
  SPEC-012's own header already states for specs that touch `next-task.ts`/`artifact-graph.ts`
  without redefining SPEC-012's requirements.
- **Any change to `next-task.ts`'s resolver core** — its gating, severity classes, and
  `NodeKind` set are unchanged (INV-5); this spec only supplies the input it already declares.
- **Status-bar / explorer UI changes** — `answer-OQ`'s consumption by the existing signpost
  surfaces was already wired under #227; this spec does not touch rendering.
- **DR-085's `phase-action` removal** — a separate, already-tracked, unapplied SPEC-012
  amendment (DR-085 Follow-ups); unrelated to this fix beyond sharing the same resolver file.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Guessing a single regex at Specify time instead of raising DQ-1.** Rejected on the
  concrete evidence above: a plausible-looking keyword or heading-presence rule each fail on
  real, named specs in this corpus (SPEC-014 false-negative; SPEC-010/012/013/029
  false-positive). Shipping a guess here is exactly the "two prose parsers that disagree"
  risk the issue itself warns against, one layer removed — a wrong heuristic adopted without
  a human read is worse than the current silent miss, because a noisy or wrong signpost node
  erodes trust in a "never-wrong" surface (CLAUDE.md Evidence Discipline) rather than merely
  omitting one.
- **Amending SPEC-012's own body to add `answer-OQ` to its State Model table and FR list.**
  Rejected — SPEC-012's own frontmatter header already states the convention for a
  downstream spec that only touches its owned files: declare `affects:`, matching
  SPEC-040/041/046/059. SPEC-012 also already carries one pending, unapplied DR-085
  amendment (node-kind table, FR-8, `INV — Two Queues`); layering a second concurrent edit
  onto the same document risks conflating two unrelated amendments in one approval.
- **Folding the ADR-side gap (DQ-2) into this spec's own FRs.** Rejected for now — zero DRs
  in this corpus currently carry an `## Open question` heading, so there is no live defect to
  close today, and the issue's own stated scope is `SpecNode` only; expanding scope here
  without a human confirm would violate this project's own scope-expansion triage rule
  (CLAUDE.md, "extend to X" trigger).

## Traceability

- **Issue:** [#1463](https://github.com/AIClarityAU/minspec/issues/1463) — "answer-OQ never
  fires — the fs-adapter never sets hasUnresolvedOpenQuestions."
- **Sibling, same pattern, already landed:** #1436 (`implementHole` / `phase-action`'s
  fs-adapter half) — the `topoFloorBlock` per-artifact dedup fix it shipped is the
  prerequisite that makes this issue's tie (FR-6, `INV-PA-OQ-ORDER`) observable at all once
  this ships.
- **Original resolver-level design, not re-litigated here:** #227 (`answer-OQ` generator +
  `hasUnresolvedOpenQuestions` contract field in `next-task.ts`).
- **Confirms `answer-OQ` stays on the signpost:**
  [DR-085](../../../docs/decisions/DR-085.md) §1 (membership test: dischargeable from the
  editor, without delegating).
- **Owns the resolver core and the fs-adapter's existing conventions (split/single-file
  layout, `implementHole` precedent):**
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md).
- **Owns the predicate this spec reuses:** `spec-validator.ts`'s dangling-park-ref lint, #40.
- **Tier-0 / offline-core invariant:** constitution invariant 1, [DR-004](../../../docs/decisions/DR-004.md).
- **ADR-side follow-up, not filed by this dispatch (no network access):** DQ-2 recommends a
  human file a new issue for `AdrNode.hasUnresolvedOpenQuestions` before it is picked up.
