---
id: SPEC-075
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a sanctioned "MinSpec: Refresh Harness Files" run tripping the very gate it exists to keep green is DR-066's silent-gate family arriving through the front door
aspects: [ci, scaffold, managed-region, parity, drift, silent-gate, cross-repo, tier-0]
relates_to: [DR-090, DR-092, DR-074, DR-066, DR-050, SPEC-068, SPEC-063, SPEC-033]
# Ownership declared now, in Specify, per SPEC-038 FR-3 / SPEC-071's precedent — declaring
# after approval would edit the file the canonical hash covers and stale a human sign-off
# for free. Only the one FR that is true under EVERY answer in "Decisions needed" below is
# claimed here (FR-2's cross-producer equality test); everything that depends on which way
# DQ-1 resolves is left to `affects:` or unclaimed until Clarify/Plan settle it.
implements: [packages/minspec/tests/managed-region-parity-equality.test.ts]
# `template-registry.ts` is owned by many specs already (SPEC-063, SPEC-068, #1486's own
# history) for other regions; this spec only touches the ai-review-workflow entry and the
# `localizeMachineryPathsComment` transform, so it is declared `affects:`, not `implements:`.
affects: [packages/minspec/src/lib/template-registry.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-075: The region a refresh writes must not fail the adopter's own parity check

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1884](https://github.com/AIClarityAU/minspec/issues/1884)** — a
sanctioned **MinSpec: Refresh Harness Files** run writes an `ai-review.yml` managed
region that a consuming repo's own `minspec-ci-parity` check can never accept, measured on
`AIClarityAU/scroogellm`'s 2026-09-09 refresh (that repo's PR #156).

## One-Sentence Scope

Close the byte-level divergence between what `renderManagedBlock('ai-review-workflow')`
writes into an adopting repo and what that repo's `minspec-ci-parity` check accepts as
canonical, without re-opening the false-coverage-claim defect ([#1486](https://github.com/AIClarityAU/minspec/issues/1486), [DR-090](../../../docs/decisions/DR-090.md)) the write-side rewrite exists to prevent.

## Context

### What the issue reports, verified against this repo's current `HEAD`

The issue's mechanism claim checks out. Two producers exist for one comparison, and they
disagree:

1. **The write side**, `packages/minspec/src/lib/template-registry.ts:2162`:
   `content: localizeMachineryPathsComment(AI_REVIEW_WORKFLOW)`. (The issue cites `:1942`;
   the file has moved since the 2026-09-09 measurement — `:2162` is the current line, read
   fresh for this spec.) `localizeMachineryPathsComment` (`:2110-2153`) is a deliberate,
   tested, comment-only rewrite: it replaces the `# MACHINERY_PATHS_RE` explainer block so
   a consuming repo is told the truth about which alternations apply locally, instead of
   inheriting MinSpec's own vantage (`packages/minspec/tests/machinery-comment-localization.test.ts`
   pins this behaviourally — byte-diff of every non-comment line, character-identical
   classifier pattern, throws rather than silently no-ops on a restructured upstream
   block). This rewrite is the fix for #1486 and the applied instance of
   [DR-090](../../../docs/decisions/DR-090.md) — *prose inside a managed file is shipped
   code; it must hold in the repo that receives it, or name MinSpec as its subject.*
2. **The compare side**, `minspec-ci-parity.yml`'s `MINSPEC_RAW` fetch and byte-compare
   (reported by the issue at `scroogellm/.github/workflows/minspec-ci-parity.yml`, not
   independently re-read here — this spec's evidence bar for a file outside this
   repository is the issue's own report, marked as such, not a first-hand grep).

No test in this repository compares `renderManagedBlock()`'s output for `ai-review.yml`
against anything resembling what a downstream parity check would accept — confirmed by
reading `machinery-comment-localization.test.ts` in full: every assertion in it is about
the *shipped* copy's own shape (no MinSpec-only test path, no bare `#1284`, comment-only
diff against the on-disk source), never about a *third* artifact. That gap is real and is
this spec's FR-2.

### Correction to the issue's premise — `minspec-ci-parity.yml` is not a MinSpec artifact today

The issue states the compare side is "`minspec-ci-parity.yml`, **which MinSpec also
ships**." That claim does not hold up against this repo's own code, checked three ways
(the Evidence Discipline bar — code, not a plausible inference from an adjacent true
fact):

- `MANAGED_REGION_TEMPLATES` in `template-registry.ts` (the exhaustive list of every
  managed-region file MinSpec scaffolds) has **no** entry whose `outputPath` is
  `.github/workflows/minspec-ci-parity.yml` — grepped in full for this spec (25 entries,
  none named `ci-parity`).
- [DR-092](../../../docs/decisions/DR-092.md) (accepted 2026-09-26, three days before this
  issue names its own PR trigger) states outright: *"the downstream `minspec-ci-parity`
  job (present in sealbox; **not** produced by this repo — repo-wide grep finds it only in
  prose…)"* — and records, as one of its own unfiled follow-ups, *"(d) the cross-repo
  correction to sealbox's `minspec-ci-parity` remedy text, which today advises the action
  that causes the drift"* (see [Traceability](#traceability) — related, not absorbed, by
  this spec).
- [SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md)'s own Out of
  Scope section says the same thing independently: *"Correcting the downstream
  `minspec-ci-parity` remedy text. That job lives in a consuming repo, not here."*

One corpus inconsistency surfaced while checking this: **SPEC-063**'s clean-uninstall
inventory (`requirements.md:49`) lists `minspec-ci-parity` in a table row labelled
"MinSpec-generated," alongside files that genuinely are. Per the grep above, that row is
currently wrong. Flagged here, not corrected here — SPEC-063 is a different spec's
document and fixing its inventory is out of this issue's scope (CLAUDE.md's
detection-≠-integration triage rule); a human reading this spec should treat SPEC-063's
row as stale pending its own fix, not as counter-evidence to the grep above.

**Why this correction matters for the fix, not just for accuracy:** the issue's
recommended Option 1 ("teach parity about the localization… ideally by making
`localizeMachineryPathsComment` the single definition both consume") reads, on its face,
like a same-repo change. It is not. If `minspec-ci-parity.yml` stays a file each adopter
hand-authors (or hand-copies from another adopter — unconfirmed which), "both consume the
single definition" requires either (a) MinSpec starts shipping and owning that file for
the first time, which is new scaffolding scope with its own migration and blast-radius
questions, or (b) MinSpec publishes the transform for each adopter's hand-authored copy to
import, which is a cross-repo coordination cost with no existing distribution mechanism.
Neither is free, and the issue's own stated cost for Option 1 does not price either in.
This is exactly what [Decisions needed](#decisions-needed-clarify) DQ-1 is for.

### Why this is a silent-gate incident, not a cosmetic drift

`minspec-ci-parity` exists specifically to stop a stale review stack from deadlocking
every PR behind a required check (constitution invariant 2, [DR-066](../../../docs/decisions/DR-066.md)).
When the sanctioned remedy for staleness — *MinSpec: Refresh Harness Files* — is the thing
that trips this particular gate, an adopter learns that parity red after a refresh is
normal, and routinely merging past it (or disabling it) is how a gate stops being a gate.
That is invariant 2's failure mode arriving through the front door, which is why this
spec's tier floor is set where SPEC-068/SPEC-071 set theirs: the fix reaches other
people's repositories and their merge gating, not just this one.

## Functional Requirements

- **FR-1 — One transform, never two hand-synced copies.** Wherever the fix lands, the
  write side (this repo's `localizeMachineryPathsComment`) and whatever logic ends up
  deciding what a downstream parity check accepts for `ai-review.yml` MUST consume the
  *same* transform definition — never a second, independently written copy that can drift
  from the first the instant either changes. This is the same discipline DR-063 already
  established for the ai-review label family and SPEC-074 FR-1/INV-3 restated for the
  dispatch-quota classifier: a hand-rolled second copy of a tested rule is the specific bug
  class being closed, not an acceptable implementation detail.

- **FR-2 — A repo-local equality test closes the gap regardless of which DQ-1 option is
  chosen.** A new test (`packages/minspec/tests/managed-region-parity-equality.test.ts`)
  asserts, for every entry of `MANAGED_REGION_TEMPLATES`, that `renderManagedBlock(tpl)`
  produces exactly the bytes this repo intends a downstream parity check to accept for
  that entry. Today's silent gap — nothing in this repo compares `renderManagedBlock()`
  output against the artifact meant to mirror it — is what let the divergence for
  `ai-review.yml` ship unnoticed while the other nine tracked files (per the issue's own
  local replication, reported not independently re-verified here) stayed identical. This
  requirement holds unconditionally: it is true under every answer to DQ-1 below, because
  it only asserts internal self-consistency of what this repo *intends* to ship, not
  anything about a specific downstream file's current bytes.

- **FR-3 — The fix must not re-open #1486/DR-090 by default.** Any option that removes or
  weakens `localizeMachineryPathsComment` (the issue's "drop the localization" option) MUST
  say so explicitly and MUST re-litigate DR-090's finding — that the un-localized comment
  asserts a coverage guarantee (a named local test) that is false in every consuming
  repo — rather than silently reverting it as a side effect of chasing parity green. A fix
  that trades a loud parity failure for a quiet false claim in every adopter's
  `ai-review.yml` is not a net improvement to invariant 2's intent.

- **FR-4 — The fix does not silently duplicate DR-092's unfiled follow-up (d).** DR-092
  already named "the cross-repo correction to sealbox's `minspec-ci-parity` remedy text" as
  an unfiled follow-up touching the same downstream file. This spec's resolution MUST
  either fold that follow-up in explicitly (with its own FR/AC) or cross-link it and state
  why it stays separate — never proceed as if it does not exist, which would produce two
  uncoordinated fixes converging on one file in two different repos' governance.

- **FR-5 — Blast radius stays opt-in (constitution invariant 3).** Whatever DQ-1 resolves
  to, nothing this spec ships changes behaviour in a repo, org, or machine-wide config that
  did not opt in via `.minspec/` at its root. If the fix brings `minspec-ci-parity.yml`
  under MinSpec's own scaffolding for the first time (DQ-1 Option D), that is itself a
  first-time claim of ownership over a file every current adopter hand-authored — a
  narrower, file-level opt-in question this spec does not answer for the human by default
  (see DQ-1/DQ-2).

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, [DR-066](../../../docs/decisions/DR-066.md)).**
  The fix itself must not become a new instance of the class it closes: no
  `continue-on-error`, no swallowed exit code, and no "known-drift, skip this one" allowlist
  entry that would mask a *real*, future divergence the same way this one shipped unnoticed.
- **INV-2 — Blast radius (constitution invariant 3, [DR-074](../../../docs/decisions/DR-074.md)).**
  Nothing this spec ships changes behaviour in a repo that has not opted in via `.minspec/`.
- **INV-3 — No false coverage claim survives (DR-090).** The shipped `ai-review.yml`
  comment must continue to say only what is true from the *receiving* repo's vantage. This
  does not forbid choosing to drop the localization (FR-3 already covers that path); it
  forbids arriving there as an unexamined side effect.
- **INV-4 — Offline core (constitution invariant 1, DR-004).** FR-2's equality test is
  Tier-0 and makes no network call — it compares two in-repo-computable values. Any design
  that has MinSpec's own build, validate, or extension runtime make the same raw-content
  fetch `minspec-ci-parity.yml` performs today would cross into network territory covered
  by [DR-050](../../../docs/decisions/DR-050.md) (explicit-consent gh/CLI shelling) and is
  not authorised by this spec; it would need its own consent framing if proposed at Plan.

## Acceptance Criteria

- [ ] **The premise is stated correctly.** The spec (and anything built from it) treats
      `minspec-ci-parity.yml` as living outside this repository today, not as a MinSpec
      template — verified against `MANAGED_REGION_TEMPLATES` having no matching
      `outputPath`. (Context, FR-1)
- [ ] **Single source of truth.** No second, hand-written copy of the localization/parity
      transform exists after the fix; a test would fail if one were introduced. (FR-1)
- [ ] **Equality test exists and is meaningful.** `managed-region-parity-equality.test.ts`
      iterates every `MANAGED_REGION_TEMPLATES` entry (not just `ai-review.yml`) and fails
      if `renderManagedBlock(tpl)` diverges from the intended-canonical bytes for that
      entry. (FR-2)
- [ ] **#1486/DR-090 is not silently reverted.** If the chosen option removes or weakens
      `localizeMachineryPathsComment`, the spec's Plan phase carries an explicit statement
      re-examining DR-090's original finding, not just a parity-green result. (FR-3)
- [ ] **DR-092 follow-up (d) is accounted for.** The Plan or Clarify record explicitly
      states whether this spec absorbs DR-092's unfiled remedy-text follow-up or leaves it
      separate, with a reason either way. (FR-4)
- [ ] **No unscoped blast radius.** Any change reaching adopter repos is gated on
      `.minspec/` presence and, if it is a first-time ownership claim over a
      previously-adopter-authored file, is named as such for the human rather than shipped
      as an ordinary managed-region update. (FR-5, INV-2)
- [ ] **No new network call in core.** `managed-region-parity-equality.test.ts` and any
      other Tier-0 code this spec adds perform no fetch; `invariants.test.ts`'s
      network/child-process allowlist gains no new entry from this work without a
      corresponding DR. (INV-4)

## Decisions needed (Clarify)

- **DQ-1 — Which fix, given the corrected ownership picture?** The issue names three
  options; the ownership correction above changes their real cost.
  - **(A) Teach the compare path about the localization.** As the issue frames it, this
    assumes MinSpec can edit "the compare path" directly — it cannot, today, because that
    path lives in each adopter's own hand-authored file. Making (A) real requires either
    (A1) MinSpec starts shipping `minspec-ci-parity.yml` as a managed-region template for
    the first time (converges with Option D below), or (A2) MinSpec publishes the
    transform for each adopter's existing hand-authored copy to import, with no existing
    distribution mechanism for that today. *Cost:* both sub-options are real, uncosted new
    scope beyond what the issue's "pair it with a test" framing implies.
  - **(B) Drop the localization.** Ship the un-localized comment everywhere; parity
    compares raw bytes and passes by construction. *Cost:* re-opens the #1486/DR-090 defect
    (FR-3) — every adopting repo's `ai-review.yml` again names paths and a test that do not
    exist there, silently, with no local hint that the pattern is unguarded.
  - **(C) Exempt `ai-review.yml` from parity.** Cheapest to write in the issue's framing,
    but per the ownership correction, MinSpec cannot make this change centrally at all — it
    would require a hand-edit to every adopter's own `minspec-ci-parity.yml`, is not
    enforceable or consistent across adopters, and removes the one automated check on the
    most consequential scaffolded file in the stack. Not recommended, same as the issue's
    own conclusion, now for an additional reason.
  - **(D) Bring `minspec-ci-parity.yml` under MinSpec ownership as a new
    `MANAGED_REGION_TEMPLATES` entry**, generated so its embedded canonical always matches
    this repo's own `localizeMachineryPathsComment` output (FR-1, single source of truth by
    construction — this is (A1) named explicitly as its own option). *Cost:* the largest
    blast radius of the four — every current adopter's hand-authored copy would need
    reconciling with the new managed region on their next refresh (itself gated by
    SPEC-068's not-yet-built direction check, see DQ-4), and it is the first time MinSpec
    would claim ownership of a file adopters wrote themselves rather than one MinSpec
    always authored.
  - *Recommendation:* **(D), with (B) as the cheap fallback if the migration cost in (D) is
    judged too high for now.** (D) is the only option that makes FR-1's "one transform"
    true by construction rather than by cross-repo promise; (B) is the only option that
    needs zero cross-repo coordination and is fully reversible, at the cost of reopening a
    named, already-fixed defect. (A2) and (C) are dominated — costed above but not
    recommended.

- **DQ-2 — Does DQ-1 Option D need its own DR before Plan?** Taking ownership of a file
  every adopter currently hand-authors, and rewriting it on a future refresh, is the exact
  shape DR-092 was written to govern for *existing* MinSpec-owned files — doing it for a
  file that has never been MinSpec-owned is a new, outward-facing, hard-to-reverse-in-a-day
  commitment (the DR-359 ADR filter this project applies). *Recommendation:* **yes, a DR is
  required before Plan completes if and only if DQ-1 resolves to (D) or (A1)/(A2).** If
  DQ-1 resolves to (B), no DR is needed — record that explicitly at Clarify rather than
  leaving the absence implicit (mirrors SPEC-071 DQ-7's convention). *Cost:* one more
  approval step gates the highest-blast-radius option, which is the point, not overhead to
  avoid.

- **DQ-3 — Fold with DR-092's unfiled follow-up (d), or keep separate and cross-link?**
  Both touch `minspec-ci-parity.yml`'s governance; they are different specific defects (a
  remedy-text wording problem that recommends a self-defeating action, versus a
  byte-comparison logic mismatch that fails regardless of remedy wording).
  *Recommendation:* **keep separate, cross-linked (as this spec already does in
  Traceability), and let a human decide at the point (d) is finally filed whether the two
  issues should be worked by the same PR.** *Cost:* two related fixes land on two
  schedules; the alternative — blocking this spec on filing and scoping (d) first — delays
  a fix for a defect that is measured and live today.

- **DQ-4 — Sequencing against SPEC-068.** If DQ-1 resolves to (D)/(A1), shipping a *new*
  managed-region entry into adopters that currently hand-author the file is exactly the
  kind of harness-refresh write DR-092/SPEC-068 exists to gate — but SPEC-068 is
  `plan: in-progress`, not built. *Recommendation:* **sequence this spec's implementation
  of DQ-1's Option D behind SPEC-068 landing** (first-adoption/first-scaffold writes are
  the two cases SPEC-068 §1 deliberately leaves ungated, and a brand-new
  `minspec-ci-parity.yml` entry for a repo that never had a MinSpec-authored one is exactly
  a first scaffold — so this may turn out to need no sequencing at all; confirm which case
  applies at Plan before assuming either way). *Cost:* if sequencing does turn out to be
  required, this fix waits on an unrelated spec's schedule.

## Out of Scope

- **Filing or resolving DR-092's follow-up (d)** (the remedy-text correction) as its own
  deliverable — named and cross-linked (DQ-3), not built here.
- **Repairing `scroogellm` PR #156** or any other adopter's already-landed workaround —
  operational cleanup in another repository, not a deliverable of this spec.
- **Building SPEC-068's harness-refresh direction gate.** Referenced as a sequencing
  dependency (DQ-4), not re-specified here.
- **Any new network call from MinSpec's core/extension runtime.** INV-4 rules this out
  regardless of which DQ-1 option is chosen; a design that needs one must get its own
  consent framing at Plan.
- **Correcting SPEC-063's stale "MinSpec-generated" row for `minspec-ci-parity`.** Flagged
  as a corpus inconsistency in Context; fixing another spec's document is out of this
  issue's scope.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Accepting the issue's premise that `minspec-ci-parity.yml` is MinSpec-shipped, and
  specifying Option 1 as a same-repo fix.** Rejected on evidence: grepping
  `MANAGED_REGION_TEMPLATES` for a matching `outputPath` returns nothing, and both
  DR-092 and SPEC-068 independently state the opposite of the issue's premise. Building a
  spec on an unverified plausible-inference claim is exactly the failure class this
  project's Evidence Discipline rule exists to prevent.
- **Folding this spec into SPEC-068.** Rejected — SPEC-068's own Out of Scope section
  explicitly excludes "correcting the downstream `minspec-ci-parity` remedy text," and this
  issue's defect (byte-comparison logic) is not that same defect (remedy wording) anyway.
- **Silently editing SPEC-063's stale inventory row while writing this spec.** Rejected —
  out of this issue's declared scope (CLAUDE.md detection-≠-integration rule); flagged
  instead so a human can decide whether to fix it separately.
- **Treating FR-2's equality test as sufficient on its own, with no DQ-1 resolution.**
  Rejected — a self-consistency test proves this repo's intended output is internally
  stable; it cannot, by itself, make any downstream adopter's actual `minspec-ci-parity.yml`
  agree with that output. FR-2 is necessary, not sufficient, which DQ-1 exists to close.

## Traceability

- **Issue:** [#1884](https://github.com/AIClarityAU/minspec/issues/1884) — "ai-review.yml:
  the region Refresh writes can never pass minspec-ci-parity in an adopting repo," filed
  from the session that landed `AIClarityAU/scroogellm` PR #156.
- **Sibling defect, same file, unfiled:** [DR-092](../../../docs/decisions/DR-092.md)
  follow-up (d) — the `minspec-ci-parity` *remedy text* recommends the refresh action that
  (for other managed files) causes the exact drift SPEC-068 exists to gate. Related to, not
  absorbed by, this spec (DQ-3).
- **The rule this fix must not break:** [DR-090](../../../docs/decisions/DR-090.md) —
  prose inside a managed file is shipped code and must hold in the receiving repo's
  vantage; originating issue [#1486](https://github.com/AIClarityAU/minspec/issues/1486).
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) (constitution invariant 3).
- **No silent gate:** [DR-066](../../../docs/decisions/DR-066.md) (constitution
  invariant 2) — why a refresh-caused parity failure matters more than a comment diff.
- **Network posture, if DQ-1 leans toward a fetch-based design:**
  [DR-050](../../../docs/decisions/DR-050.md).
- **Adjacent, explicitly out-of-scope-for-it:**
  [SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md) — its own text
  excludes this correction; cited here as the sequencing dependency for DQ-1 Option D
  (DQ-4).
- **Corpus inconsistency surfaced, not fixed, by this spec:**
  [SPEC-063](../SPEC-063-clean-uninstall/requirements.md) `requirements.md:49` lists
  `minspec-ci-parity` as "MinSpec-generated"; this spec's own grep of
  `MANAGED_REGION_TEMPLATES` shows that is not currently true.
- **DR for this spec:** none yet, by design — DQ-2 states the exact condition (DQ-1
  resolving to Option D or A) under which one becomes required before Plan completes.
