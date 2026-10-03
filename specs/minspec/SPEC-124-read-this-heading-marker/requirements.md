---
id: SPEC-124
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a per-heading "read this carefully" signal is a finer-grained signpost than the existing Zone-A/B split, and it is already a named, approved dependency of SPEC-018 FR-13
aspects: [convention, signpost, attention, ux, authoring, tier-0, cross-package]
relates_to: [DR-029, SPEC-013, SPEC-018, DR-033, SPEC-024, "#180", "#127", "#173", "#183"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance). All three files are NEW and required under the recommended
# DQ-3 selection below: the shared predicate (FR-1/FR-5) is needed regardless of which way DQ-3
# resolves, because SPEC-018 FR-13 already depends on it existing; the lint test is needed only
# under the recommended "build now" branch. Choosing a different DQ-3 option edits this spec
# anyway (its own precedent, SPEC-095's reasoning).
implements: [packages/shared/src/attention-glyph.ts, packages/shared/tests/attention-glyph.test.ts, packages/minspec/tests/heading-glyph-lint.test.ts]
# Modified, not owned. spec-validator.ts is a shared validator surface many specs touch
# (SPEC-040, SPEC-046, SPEC-047, SPEC-051, SPEC-059 all list it under affects:, never
# implements:) and this spec follows that precedent. review-signals.ts and its test are
# #180's existing, already-built renderer (packages/shared/src/review-signals.ts:271) — no
# spec claims them under implements: today — and this spec only prepends the glyph to its one
# hard-coded heading (FR-6). index.ts is the shared-package barrel every new module touches.
affects: [packages/minspec/src/lib/spec-validator.ts, packages/shared/src/review-signals.ts, packages/shared/tests/review-signals.test.ts, packages/shared/src/index.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-124: A 👁 heading prefix is the one signal for "read this carefully," replacing ad hoc MUST READ / SKIM text

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded recommendation; the
> requirements below are written under each one's recommended option, so approving the spec
> as it stands accepts those recommendations and leaves no question open. Choosing a
> different option changes only the requirements that decision names.

Materializes **[#185](https://github.com/AIClarityAU/minspec/issues/185)** — *"add an eye
icon (👁) prefix on every heading a human reviewer should read carefully... replacing the
current inline MUST READ / SKIM text in headings... apply going forward; no backfill."*

**Id note.** `git log --all` in this worktree (fetched from `origin` today) finds `SPEC-097`
through `SPEC-123` already claimed by commit messages on open branches/pull requests not yet
merged to `main` (highest on disk: `SPEC-096`); none above `SPEC-123`. This checks every
fetched remote branch, not every open pull request (no `gh`/network access in this dispatch),
so this is a lower bound, not a guarantee. This spec claims `SPEC-124`. If it collides at
review time, renumber.

## One-Sentence Scope

Define one deterministic signal — a `👁` prefix on a `##`/`###` heading, glossed inline on its
first use per document — that marks a section a human reviewer should read carefully, replacing
the ad hoc "MUST READ"/"SKIM" heading text the issue names; ship the shared predicate both of
its two already-named consumers need (SPEC-018 FR-13's attention-marking, and #180's existing
review-signal renderer); and add an advisory (never-blocking) lint that flags a residual
literal "MUST READ"/"SKIM" heading.

## Context

### The literal text the issue names does not exist in this repo today

`grep -rn "MUST READ" --include=*.md .` and the case-sensitive `\bSKIM\b` equivalent, run
across the whole worktree (excluding `node_modules`), return **zero** hits — in `specs/`,
`docs/`, `packages/`, and `scripts/`. So "replacing the current inline MUST READ / SKIM text"
has nothing committed to rewrite; whatever text the issue is describing lived only in PR
bodies, chat, or other ephemeral surfaces this repo's history doesn't carry. Per this repo's
own evidence-discipline rule (CLAUDE.md "Evidence Discipline"), this spec states that plainly
rather than inferring a backfill target that cannot be grepped. Combined with the issue's own
"no backfill" instruction, this spec's job narrows to: establish the convention going forward,
and give the two features that already name it (below) something real to consume.

### This is not a new idea — two approved specs already depend on it by number

- **SPEC-018** (the approvable custom editor; **approved**, hash recorded at
  `.minspec/approvals/specs/minspec/SPEC-018-spec-custom-editor`) names this issue **by number**
  four times in its own body. Its FR-13 ("attention-marking + dim non-essential") reads: *"align
  with the read-this eye-icon mechanism, #185, and the Zone-A / core-end divider convention
  from SPEC-013"* (`specs/minspec/SPEC-018-spec-custom-editor/requirements.md:199`), and its
  open question FR-OQ4 is **resolved-deferred**: *"v1 uses only the existing deterministic
  signals (no new heuristic, R8)"* (`:619-620`). SPEC-018 also lists this issue under its own
  `## Follow-ups (tracked)` (`:665`). So SPEC-018 does not need to be asked whether it wants
  this signal — it already committed to consuming it, by number, before this spec existed.
- **#180** — the PR self-report renderer DR-033 names as the auto-merge backstop — is already
  **built**: `packages/shared/src/review-signals.ts`'s `renderReviewSignals` emits one
  hard-coded heading, `## Review signals (auto-built · #180)` (`review-signals.ts:271`), which
  is precisely the shape of section a reviewer must read before merging — the canonical
  "MUST READ" heading this repo already produces on every auto-built PR. No spec claims this
  file under `implements:` (searched every `specs/*/requirements.md`), so it is free to modify.

**What this means for scope.** This spec is not proposing a convention in the abstract — it is
specifying the one piece SPEC-018 FR-13 is missing, and applying it to the one concrete
heading #180 already renders. Both consumers need the same deterministic predicate (SPEC-013's
own FR-1/FR-2 precedent: "one module holds the predicate... there MUST remain exactly one
definition"), so this spec's central artifact is that shared module, not prose alone.

### Where the shared predicate must live, and why

`packages/shared` is this monorepo's Tier-0 boundary — "contract types, no vscode/network"
(this repo's CLAUDE.md, Project Overview table) — and is already the layer both consumers sit
on or beside: `review-signals.ts` lives there and is explicitly Tier-0 ("no `vscode`, no
network... `scripts/render-review-signals.mjs` consumes it", `review-signals.ts:24-26`);
`packages/minspec/src/lib` already imports from `@aiclarity/shared` (e.g.
`import type { TrustChartModel } from '@aiclarity/shared';`,
`packages/minspec/src/views/spec-panel.ts:8`). The dependency runs one way — `minspec` imports
`shared`, never the reverse — so a predicate `review-signals.ts` must call cannot live inside
`packages/minspec`. It MUST live in `packages/shared/src`, exported through the package's public
barrel (`packages/shared/src/index.ts`, whose own docstring forbids deep imports: *"Consumers
import from the package name... never from deep source paths"*).

### The existing Zone-A/B split is a different grain, not a competitor

[DR-029](../../../docs/decisions/DR-029.md) and
[SPEC-013](../SPEC-013-risk-section-policy/requirements.md) already split a document into a
read-first Zone A and a skim-appendix Zone B via a `minspec:core-end` divider — but
**measured**, that mechanism is itself unbuilt: zero hits for `SECTION_REGISTRY`,
`minspec:core-end`, or `coreHash` across `packages/minspec/src` and `packages/shared/src`
(SPEC-013's own Context section records the same count at its own time of writing, and it is
unchanged). SPEC-013 also explicitly withholds any "skim-safe" trust claim until a validation
study, **[#127](https://github.com/AIClarityAU/minspec/issues/127)**. This spec does not
depend on Zone A/B landing, and does not make the #127 trust claim either — a `👁` heading is a
narrower, per-heading signal inside *any* document (including a PR body, which has no
core-end divider at all), not a restatement of the document-level split. SPEC-018 FR-13 cites
both signals as independent inputs to the same emphasis feature, and this spec only owns one of
them.

### The glyph already has a working precedent in this repo's own conventions

This repo's CLAUDE.md already runs a first-use-gloss rule for a fixed, predefined identifier:
*"Gloss what is predefined. When an identifier is fixed and numeric (`Phase 2`, `Slice 3`,
`T3`), append a short reminder of what it covers the first time it appears..."* (CLAUDE.md,
"Naming waves, phases, and batches"), and it already uses two other glyphs the same way (`➡️`
for a human action item, `💲` for the Scrooge model-fit advisory) — each a single visible
character that front-loads a read-signal, explained once per surface. `👁` is the same shape of
device applied to a new identifier; FR-1 below reuses the existing gloss-on-first-use rule
rather than inventing a second mechanism for the same problem (e.g. a standalone legend block).

### A precise, byte-level definition, because SPEC-018 promised "no new heuristic"

The glyph "👁" the issue's own title uses is U+1F441 EYE, one codepoint, no variation selector
(confirmed by codepoint inspection of the issue text). Some input methods append U+FE0F
(VARIATION SELECTOR-16) after an emoji to force a colour rendering; if the predicate and every
author's keystrokes do not agree on whether that trailing codepoint is present, detection
silently breaks — exactly the "mechanism claims need the same bar" failure class this repo's
own CLAUDE.md names. FR-1/FR-5 pin this explicitly so SPEC-018 FR-13's "no new heuristic"
promise is actually met by a predicate that cannot drift between its two call sites.

## Why no new DR

Every requirement below is reversible in under a day: a prose-and-glyph convention, one new
Tier-0 module with no external dependents yet, a one-line prefix on an existing rendered
heading, and an advisory (non-blocking) warning rule. None of it is a schema, a public
contract an adopter depends on, or anything that cannot be reverted as a plain diff. Per this
repo's ADR filter (reversibility-in-under-a-day), that rules out a new Decision Record.

## Functional Requirements

- **FR-1 — The marker, and its gloss.** A heading a human reviewer should read carefully is
  written as an ATX heading (`##` or `###` only — mirroring the heading levels SPEC-013 FR-2's
  `hasSection` already scans) whose text begins with the literal glyph `👁` (U+1F441, with or
  without a trailing U+FE0F), followed by required whitespace, e.g. `## 👁 Decisions needed
  (Clarify)`. The **first** such heading in a document MUST carry a short inline gloss
  immediately after the heading text on the same line (e.g. `## 👁 Decisions needed (Clarify)
  — 👁 = read this section carefully`); every later `👁` heading in the **same** document MUST
  NOT repeat the gloss. This is CLAUDE.md's existing gloss-on-first-use rule (see Context)
  applied to this glyph, not a second mechanism. A `#` (H1, the document title) MUST NOT carry
  the glyph — it marks a section within a document, not the whole document.

- **FR-2 — Retires the literal text, forward-only.** A heading authored under this convention
  after this spec is approved MUST NOT contain the literal strings "MUST READ" or "SKIM" (any
  case). No existing document is edited to add, remove, or convert a heading under this spec —
  per the issue's own instruction and because the Context section found nothing committed to
  convert.

- **FR-3 — One shared predicate, Tier-0.** `packages/shared/src/attention-glyph.ts` MUST export
  the canonical glyph as a named constant and a pure, dependency-free predicate that decides
  whether a given heading's text carries the marker, treating the glyph with or without a
  trailing U+FE0F as the same marker (Context). It MUST import nothing beyond what
  `packages/shared` already permits (no `vscode`, no network, no Node-only API beyond what the
  rest of `packages/shared/src` already uses) — this is the Tier-0 boundary both of this
  predicate's named consumers (SPEC-018 FR-13, FR-6 below) sit on or beside. It MUST be the
  **only** place either consumer implements this check (SPEC-013 FR-1's "one module, one
  predicate" precedent).

- **FR-4 — SPEC-018's dependency is satisfied by number, not by this spec building SPEC-018.**
  This spec does not modify `specs/minspec/SPEC-018-spec-custom-editor/requirements.md` — it is
  **approved** (hash recorded), and editing its body would stale a human sign-off for a feature
  this dispatch was never asked to touch. FR-3's module is the thing SPEC-018 FR-13 already
  names as missing (Context); once this spec is approved and FR-3 ships, SPEC-018's own
  Implement work can import it with no further design question on this side. See DQ-4 for how
  the two get connected in practice, since neither spec's approval obligates the other's build
  order.

- **FR-5 — Advisory lint for the residual text (FR-2's check).** `spec-validator.ts` MUST gain
  one new `warning`-severity `ValidationViolation` (reusing the existing `Severity` /
  `ValidationViolation` machinery, `spec-validator.ts:36`) that fires when a spec body contains
  a `##`/`###` heading whose text contains the literal strings "MUST READ" or "SKIM" (any
  case), scoped to `specs/**` only (DQ-3). It MUST NOT change `npm run validate`'s exit code —
  a warning only, never a block, consistent with this repo's existing closed-set frontmatter
  checks (`spec-validator.ts:0b`, all `warning`) and with DR-026's offer-never-silent posture.
  It checks FR-2's "no literal text" rule only; it does NOT mechanically verify FR-1's
  first-use-gloss placement (a style nicety, left to human review — "just enough human").

- **FR-6 — #180's existing renderer adopts the marker.** `packages/shared/src/review-signals.ts`
  MUST prefix its one hard-coded heading with the marker and its first-use gloss:
  `## 👁 Review signals (auto-built · #180) — 👁 = read this section carefully` (line 271
  today). This is the first, concrete production use of FR-1's convention — the section a
  human reviewer is specifically meant to read before merging a PR. The existing
  `packages/shared/tests/review-signals.test.ts` assertions are substring (`toContain`) checks
  on other parts of the output (none asserts the literal heading text), so they are unaffected;
  a new assertion pins the prefixed heading.

- **FR-7 — Composes with, does not replace, the Zone-A/B split.** Nothing in this spec changes
  SPEC-013's section registry, the `minspec:core-end` divider, or DR-029's tier-scaled
  self-audit family, whether or not they are built. A `👁` heading MAY appear inside Zone A,
  inside Zone B, or in a document with no zones at all (a PR body). This spec makes no
  "skim-safe" trust claim (that stays gated on #127, per SPEC-013).

## Acceptance Criteria

- [ ] A spec, DR, or PR body authored after this spec's approval that marks a heading
      carefully-read uses `## 👁 ...` / `### 👁 ...` and never the literal strings "MUST READ"
      or "SKIM". (FR-1, FR-2)
- [ ] The first `👁` heading in such a document carries the inline gloss; a second `👁` heading
      in the same document does not repeat it. (FR-1)
- [ ] `hasAttentionGlyph` (or equivalent name settled at Plan) in
      `packages/shared/src/attention-glyph.ts` returns true for a heading text starting with
      `👁` with or without a trailing U+FE0F, and false for a heading with the glyph anywhere
      other than the start, or with a different eye-shaped emoji (e.g. 👀). (FR-3)
- [ ] `packages/shared/src/index.ts` exports the new module through the public barrel; no
      consumer imports its deep source path. (FR-3)
- [ ] `heading-glyph-lint.test.ts` is shown to fail against a fixture spec containing a literal
      "MUST READ" heading before the rule exists, and to pass (emitting exactly one `warning`,
      zero change to the overall exit code) after it lands. (FR-5)
- [ ] `renderReviewSignals`'s output heading reads
      `## 👁 Review signals (auto-built · #180) — 👁 = read this section carefully`; every
      existing `review-signals.test.ts` assertion still passes unmodified. (FR-6)
- [ ] `specs/minspec/SPEC-018-spec-custom-editor/requirements.md` is byte-identical before and
      after this spec's approval — no edit, no hash change. (FR-4)
- [ ] No existing committed document gains, loses, or converts a `👁` heading as a result of
      this spec (no backfill). (FR-2)

## Invariants

- **INV-1 — Offline, Tier-0 (constitution invariant 1).** The predicate and the lint are pure,
  local, and add no dependency, no subprocess, and no network call. `packages/shared` stays
  import-clean of `vscode`.
- **INV-2 — No silent gate, applied correctly (constitution invariant 2).** FR-5's check is
  explicitly advisory by design and says so in its own rule — it is not a required or
  merge-gating check, so warn-only is not the failure mode invariant 2 forbids (that invariant
  targets a check that is *supposed* to gate but fails open; this one never claims to gate).
  Should a future decision promote it to blocking, that promotion needs its own review of this
  invariant, not a quiet severity bump.
- **INV-3 — Blast radius (constitution invariant 3).** Nothing here is scaffolded into an
  adopter's repo: `attention-glyph.ts` and the `spec-validator.ts` warning are this monorepo's
  own authoring tooling, not a managed template `scripts/*`/`template-registry.ts` ships to
  adopters (DQ-3 keeps it that way under the recommended option). An adopter who has never
  opted in sees no behaviour change.
- **INV-4 — One owner per file (this repo's ownership convention).** `attention-glyph.ts` and
  its test are owned here; `spec-validator.ts`, `review-signals.ts`, its test, and the shared
  barrel are modified, not claimed.

## Decisions needed (Clarify)

### DQ-1 — Which headings qualify for `👁`?

- **a — author discretion, with named anchor-cases (rec).** Any heading the author judges a
  human must read carefully, with this repo's `## Decisions needed (Clarify)` heading and a
  DR's `## Decision` heading as the expected, usual case. *Cost:* a discretionary signal can be
  over-applied — every heading gets `👁`, which defeats "skim the rest" — and nothing
  deterministic catches that inflation, the same anti-gaming gap DR-029 names for the
  self-audit appendix and never closes either.
- **b — a closed, fixed list of heading names this spec enumerates.** *Cost:* rigid — a
  genuinely important ad hoc heading (e.g. one risky paragraph in a DR) gets no signal, and
  extending the list later means editing this spec again.

### DQ-2 — Hard replace, or soft-prefer?

- **a — hard replace (rec, FR-2 as written).** New headings use `👁`, never the literal
  "MUST READ"/"SKIM" strings. *Cost:* enforcement rests on FR-5's advisory lint and session
  memory — a prose rule a model must remember, the exact drift class this repo's CLAUDE.md
  names ("Enforce, don't trust the model").
- **b — soft-prefer, no sunset.** `👁` is recommended but the literal text stays tolerated
  indefinitely. *Cost:* two competing conventions coexist with no end date, which is the drift
  the issue was filed to stop.

### DQ-3 — Where does the lint live, and is it built now?

- **a — build now, inside `spec-validator.ts`'s existing warning channel, `specs/**` only
  (rec, FR-5 as written).** Reuses existing infrastructure, Tier-0, no new adopter-facing
  surface. *Cost:* `docs/decisions/**` (DRs) and PR bodies get no automated check at all — the
  convention there stays prose-trusted, the same gap FR-2 itself names.
- **b — extend the shipped `.minspec/hooks/validate.py` template** (`template-registry.ts`'s
  `VALIDATE_PY`, the mechanism SPEC-075 wires to `.minspec/config.json`'s declared corpora) so
  every adopter's pre-commit hook gets the same advisory nudge, covering both `specs` and
  `docs/decisions`. *Cost:* a MinSpec-house-style rule starts shipping into every adopter's
  repo on their next harness refresh — disproportionate for a convention this issue scopes to
  *this* repo's own practice, and raises the same invariant-3 blast-radius question SPEC-085
  and SPEC-096 raise for other shipped writers.
- **c — defer the lint to a separate follow-up issue; this spec ships only FR-1/FR-3/FR-4/FR-6.**
  *Cost:* nothing catches a slip back into literal "MUST READ"/"SKIM" text until a human
  notices, and this dispatch has no network access to file that follow-up issue itself — a
  human would need to.

### DQ-4 — How does SPEC-018 actually pick this up, given it is approved and unbuilt?

- **a — non-binding now; a human amends SPEC-018 (or files a tracked follow-up) once SPEC-018
  enters its own Plan/Implement (rec).** This spec does not touch SPEC-018's body (FR-4).
  *Cost:* the connection has no owner or deadline until someone remembers to make it — a
  second prose-trusted link, the same shape of risk as DQ-2.
- **b — amend SPEC-018 now, in this dispatch.** Not a real alternative: SPEC-018 carries a
  recorded approval hash, and this dispatch's own scope is issue #185's spec only — editing
  another approved spec's body is out of its file allowlist regardless of merit. Recorded here
  only so the reason it is not taken is on the record.

## Out of Scope

- **A VS Code `HoverProvider` over every `.md` file.** SPEC-018's custom editor is an
  intentionally scoped, opt-in surface over approvable paths only — *"not a global Ctrl-P /
  all-markdown hijack"* (`SPEC-018:…What this is NOT`). This spec does not reopen that boundary;
  a plain-text editor shows the visible gloss (FR-1), never a hover.
- **Backfilling any existing document's headings.** Explicit in the issue; also, per Context,
  there is nothing committed matching the literal text to convert.
- **SPEC-018's own build** (the hover render, the dim/emphasis toggle). FR-4 defines the
  contract; building the render is SPEC-018's Implement phase, not this spec's.
- **Extending the shipped `validate.py` template to adopters.** DQ-3 option b, not taken under
  the recommendation.
- **Re-opening or amending SPEC-018's approved body.** DQ-4.
- **Any "skim-safe" trust claim.** Stays gated on the #127 validation study per SPEC-013; this
  spec's `👁` is a read-this signal, not a permission to skip reading the rest.

## Alternatives considered and rejected

- **A single Zone-A/B-style document-level marker instead of per-heading glyphs.** Rejected:
  the issue explicitly asks for per-heading granularity, and SPEC-013's divider already covers
  the document-level split (Context) — a second document-level marker would duplicate it rather
  than fill the gap.
- **An HTML-comment gloss (`<!-- 👁 = ... -->`), invisible outside a renderer that interprets
  it.** Rejected: the issue explicitly asks for a *visible* plain-markdown fallback ("where
  possible... fall back to a one-line legend"); an HTML comment renders invisibly everywhere
  plain markdown does, which satisfies no surface the issue cares about.
- **A separate top-of-document legend block, once per document.** Considered, but this repo's
  CLAUDE.md already has a working first-use-gloss rule for exactly this shape of problem
  (Context); reusing it avoids a second, redundant mechanism.
- **Inventing a brand-new predicate location inside `packages/minspec`.** Rejected per the
  dependency-direction evidence in Context: `review-signals.ts` (Tier-0, `packages/shared`)
  cannot import from `packages/minspec`, and it is one of this predicate's two named consumers.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `packages/shared/tests/attention-glyph.test.ts` (FR-3) —
  the glyph-with/without-U+FE0F cases, the non-match cases (wrong position, a different
  eye-shaped emoji), and the heading-level scope (`##`/`###` only, never `#`). Shown red against
  a stub, green once the predicate lands.
- **T0:** `packages/minspec/tests/heading-glyph-lint.test.ts` (FR-5) — a fixture spec with a
  literal "MUST READ" heading, shown to produce the new warning and leave the exit code
  unchanged.
- **Existing test that changes:** `packages/shared/tests/review-signals.test.ts` gains one
  assertion for FR-6's prefixed heading; no existing assertion in that file needs to change
  (Context).

## Traceability

- **Issue:** [#185](https://github.com/AIClarityAU/minspec/issues/185).
- **Consumers (already named, by number, before this spec existed):**
  [SPEC-018](../SPEC-018-spec-custom-editor/requirements.md) FR-13/FR-OQ4 (approved, unbuilt);
  [#180](https://github.com/AIClarityAU/minspec/issues/180) /
  `packages/shared/src/review-signals.ts` (built, wired into
  [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md)'s auto-merge backstop per
  [DR-033](../../../docs/decisions/DR-033.md) §3).
- **Composes with, does not duplicate:**
  [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) (Zone-A/B split, itself unbuilt),
  [DR-029](../../../docs/decisions/DR-029.md) (self-audit appendix policy),
  [#127](https://github.com/AIClarityAU/minspec/issues/127) (the "skim instead of read"
  validation study this spec does not rely on),
  [#173](https://github.com/AIClarityAU/minspec/issues/173) and
  [#183](https://github.com/AIClarityAU/minspec/issues/183) (per-dev surfacing, named by the
  issue as related, not materially touched by this spec's scope).
- **DR for this spec:** none, by design; see "Why no new DR."

## Follow-ups (tracked)

- **SPEC-018 amendment to actually build FR-13's hover/emphasis render of this marker** — not
  filed as a GitHub issue by this dispatch (no network access); a human should file it, or fold
  it into SPEC-018's own next Plan/Implement pass, per DQ-4.
- **DQ-3 option c (a residual-text lint for `docs/decisions/**` and PR bodies)** — if DQ-3's
  recommendation (option a, specs-only) is accepted, DR and PR-body coverage stays an open gap;
  tracking it as its own issue is also a human action this dispatch cannot take.
