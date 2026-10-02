---
id: SPEC-100
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — frontmatter-declared ownership/contract signals (sibling of SPEC-038)
aspects: [traceability, contract-driven-development, frontmatter, validation, ui, codelens, tier-0]
relates_to: [SPEC-038, SPEC-056, "DR-359 (parent register, mmo-platform)", "#23"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the
# shipped `/minspec-specify` guidance). Declaring after approval would edit the bytes the
# canonical hash covers and stale the sign-off. All five files are NEW; none exists today.
implements: [packages/minspec/src/lib/cdd-links.ts, packages/minspec/tests/cdd-links.test.ts, packages/minspec/tests/cdd-frontmatter-validate.test.ts, packages/minspec/tests/spec-panel-cdd-links.test.ts, packages/minspec/tests/codelens-cdd-reverse-map.test.ts]
# Modified, not owned. No spec lists these under `implements:` today (grepped across
# specs/*/SPEC-*/requirements.md); `spec.ts`'s `SpecFrontmatter` interface is extended with
# three new optional fields, `spec-validator.ts` gains one new validator function (parallel
# to `validateOwnership`, SPEC-038), and the two UI files render what `cdd-links.ts` parses.
affects: [packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/views/spec-panel-html.ts, packages/minspec/src/views/spec-panel.ts, packages/minspec/src/views/codelens-provider.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-100: Link CDD contracts and T0/T1 tests to spec frontmatter

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question below carries an agent-recorded selection
> under **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.

Materializes **[#23](https://github.com/AIClarityAU/minspec/issues/23)**.

## One-Sentence Scope

A spec may declare `contracts:`, `invariant_tests:` and `file_allowlist:` in frontmatter; the Active Spec panel renders them as clickable links, a CodeLens on an open file reverse-maps it to the spec(s) whose `file_allowlist` names it, and the corpus validator warns — never blocks — on a malformed entry, with every field optional and absence producing no behaviour change.

## Context

### What the issue is naming, and what already exists under a different name

The issue cites "Global CLAUDE.md DR-359 (Contract-Driven Development)" as the source of T0-T4
test tiers, contract artifacts, and file allowlists for agent tasks. DR-359 lives in the
parent register (`~/code/mmo-platform/docs/decisions.md`), outside this repo's own
`DR-001`-sequential register (DR-053 cross-project convention), and is not readable from this
checkout. This spec treats the issue body's own restatement of DR-359's shape (T0-T4 tiers,
TypeScript-type/Zod-schema contract artifacts, file allowlists) as the authoritative scope
for what to materialize — it does not assert anything about DR-359's text beyond that.

Two mechanisms already in this corpus are adjacent enough that a reviewer will ask why this
isn't "just use the existing field":

- **`implements:` / `affects:` (SPEC-038, `packages/minspec/src/lib/spec-validator.ts:791`
  `validateOwnership`).** A spec declares the code it owns; the local PreToolUse spec-gate
  blocks Edit/Write to an owned, unapproved path. This is **human-authored, approval-gated,
  per-spec code ownership** — its consumer is the spec-gate, and it already enforces (blocks,
  not warns).
- **`traceability.ts` (`packages/minspec/src/lib/traceability.ts`).** A separate store
  (`findRequirementsForFile`, `:228`; `findCodeForRequirement`, `:258`) backing the **Link
  Code to Spec Requirement** command, keyed by explicit code-location-to-requirement links a
  human draws after the fact, not by frontmatter.

Neither is the dispatch-time agent file allowlist the issue actually means: that allowlist is
today **prose in `scripts/roles/*.md`** (this very file's own "File allowlist" section) **and
hardcoded per-role logic in `scripts/dispatch-issue.sh`** (the specify-only scope guard this
dispatch runs under, `dispatch-issue.sh:756`-`772`). No spec declares its own narrower scope
today — a spec can only inherit whatever its dispatched role allows. `contracts:` and
`invariant_tests:` have no existing analogue at all: nothing in the corpus links a spec to a
TypeScript-type/Zod-schema file or to the specific test file that pins an invariant, as
opposed to `implements:`'s undifferentiated file list.

### Where the new fields would render

`spec-panel-html.ts` (564 lines) has no section today for `implements:`/`affects:` or any
other frontmatter-declared file list — grepped for `implements`/`affects`/`Traceability`,
nothing renders. `codelens-provider.ts` (555 lines) has two providers
(`MinSpecCodeLensProvider`, `:34`; `MinSpecSpecFileLensProvider`, `:103`) and no reverse
file-to-spec mapping of any kind. Both are genuinely new surfaces, not extensions of a
pattern that already renders this shape of data.

## Functional Requirements

- **FR-1 — Three new optional frontmatter fields.** `SpecFrontmatter`
  (`packages/minspec/src/lib/spec.ts:40`) gains three fields, all optional, all absent by
  default:
  - `contracts:` — a list of `{ path: string, type: string }` entries, each naming a
    repo-relative contract artifact (a TypeScript type module or a Zod schema file) and its
    kind.
  - `invariant_tests:` — a list of repo-relative test file paths.
  - `file_allowlist:` — a list of repo-relative paths or glob patterns naming the files an
    agent dispatched against this spec may create or edit.

  None of the three is required by any tier or phase. A spec that declares none of them is
  unaffected in every way this spec changes (INV-1).

- **FR-2 — `file_allowlist:` is independent of `implements:`/`affects:`, with one
  consistency check.** `file_allowlist` is not derived from, and does not replace,
  `implements:`/`affects:` (DQ-1): it answers a different question (what may an agent *touch
  while dispatched on this spec*, not what this spec's *approved build* owns). The validator
  (FR-5) warns, never errors, when `file_allowlist` names a path that falls under neither
  `implements:` nor `affects:` **and** is not itself an ancestor directory of one — a spec
  that widens an agent's write scope beyond what it has declared owning is worth a human's
  attention, never a block.

- **FR-3 — Path and pattern validity.** Every `contracts[].path` and every
  `invariant_tests[]` entry MUST be a repo-relative path that does not escape the repo root,
  validated with the same `isEscapingPath` check SPEC-038 already uses
  (`packages/minspec/src/lib/ownership-path-rules.ts:70`). `file_allowlist[]` entries follow
  the same rule, except a glob (`*`, `**`) is permitted (unlike `implements:`/`affects:`,
  which SPEC-038 FR-1 deliberately restricts to explicit paths for the spec-gate's exact-match
  matcher — `file_allowlist` has no such matcher to satisfy, so DQ-1's independence extends to
  this).

- **FR-4 — `contracts[].type` is a closed vocabulary.** Valid values: `typescript`, `zod`.
  An unrecognised value is a validator warning (FR-5), not silently accepted and not an error
  (DQ-3).

- **FR-5 — Validator warnings, never errors, never required.** A new function parallel to
  `validateOwnership` (`spec-validator.ts:791`) — e.g. `validateCddLinks` — runs unconditionally
  (no tier/phase gate, unlike SPEC-038's FR-3/FR-6) and emits `warning`-severity
  `ValidationViolation`s only, for: an escaping or malformed path in any of the three fields
  (FR-3), an unrecognised `contracts[].type` (FR-4), a `file_allowlist` entry outside
  `implements:`/`affects:` (FR-2), and a declared `contracts[].path` or `invariant_tests[]`
  entry that does not exist on disk (a dangling reference — matching the symmetry principle
  of #137/DR-003, applied here as a non-blocking signal since these fields carry no
  gate-arming consequence the way `implements:` does). **No missing-direction check**: unlike
  SPEC-038, a spec that declares none of the three fields produces zero violations (INV-1
  — this is the opt-in half of the symmetry argument, deliberately asymmetric from SPEC-038
  because these fields have no corresponding "this spec owns nothing" default to assert).

- **FR-6 — Active Spec panel renders the three fields.** `spec-panel-html.ts` gains a new
  section, shown only when at least one of the three fields is non-empty, listing:
  each `contracts[]` entry as a clickable link (opening the file) labelled with its path and
  `type`; each `invariant_tests[]` entry as a clickable link; `file_allowlist[]` entries as
  plain text (globs are not file links). A path that does not exist on disk renders as
  inactive text with the validator's warning, not as a broken link.

- **FR-7 — CodeLens reverse mapping.** A file open in the editor whose repo-relative path
  matches an entry (literal or glob) in some spec's `file_allowlist` gets a CodeLens reading
  "This file is in SPEC-NNN's file allowlist" (one per matching spec, multiple specs
  producing multiple CodeLenses), clicking through to that spec's requirements file. This is
  new provider logic in `codelens-provider.ts`, not an extension of either existing provider's
  current trigger condition (DQ-4 decides which file; see below).

- **FR-8 — Backward compatible (literal).** A spec file with none of the three fields parses,
  validates, renders and is unaffected by every behaviour this spec adds — `SpecFrontmatter`'s
  new fields are optional with no default-filling, `validateCddLinks` returns `[]`, the panel
  section does not render, and no CodeLens from FR-7 appears for files not named anywhere.

- **FR-9 — Spec Kit compatibility preserved.** No validator rule added by this spec rejects a
  spec file for an *unrecognised* frontmatter key (the existing validator has no such
  allowlist-of-keys check — confirmed by reading `scripts/validate-frontmatter.ts` end to end,
  not inferred), so a spec with none of the three keys, authored by plain Spec Kit, continues
  to pass unchanged.

## Out of scope (not what the issue's prose implies on a careless read)

- **Enforcing `file_allowlist` against an agent's actual edits.** The issue's UI bullet reads
  "Validator warns if agent edits file outside allowlist" — but the corpus validator
  (`npm run validate`) runs against specs and code *at rest*; it has no notion of which edits
  a given dispatch made; it carries no git diff. Building that check means diffing a dispatch's
  branch against its base and consulting the spec it was dispatched for, which is a capability
  that belongs next to `scripts/dispatch-issue.sh`'s existing scope guard
  (`dispatch-issue.sh:756`-`772`, today hardcoded per-role) or a CI step on the PR diff — not
  the Tier-0, no-network, no-git-plumbing corpus validator this spec's `validateCddLinks`
  lives in. Per CLAUDE.md's own triage rule ("Detection ≠ integration"): declaring the field
  and validating its shape is detection-sized; diffing live agent edits against it is a new
  integration surface. DQ-2 names this and recommends filing it as a follow-up rather than
  silently dropping it.
- **Representing DR-359's T0-T4 test tiers as a frontmatter enum.** The issue's own `## Scope`
  code block does not ask for a tier field — only `contracts:`, `invariant_tests:`,
  `file_allowlist:`. Adding a fourth field to model T0-T4 would be scope the issue did not
  request; if wanted, it is a follow-up, not folded in here.
- **Any change to the SPEC-038 spec-gate matcher or its blocking behaviour.** `file_allowlist`
  is additive and advisory; it does not arm or disarm the gate `implements:`/`affects:` feed.
- **Auto-deriving `contracts:`/`invariant_tests:`/`file_allowlist:` from `implements:` or from
  git history.** Human/agent-authored at Specify time, same as `implements:` (SPEC-038 OQ-5
  precedent: explicit lists, not inference).

## Acceptance Criteria

- **AC-1** — A spec with no `contracts:`, `invariant_tests:` or `file_allowlist:` passes
  `npm run validate` with zero new violations, and the Active Spec panel shows no new section
  for it. (FR-1, FR-5, FR-6, FR-8)
- **AC-2** — A spec declaring `contracts: [{path: "packages/shared/src/contracts/auth.ts",
  type: typescript}]`, `invariant_tests: ["tests/auth/invariants.test.ts"]` and
  `file_allowlist: ["packages/auth/**", "packages/shared/src/contracts/auth.ts"]` passes
  validation with zero errors (warnings allowed only if the paths do not exist in the fixture).
  (FR-1, FR-3, FR-4)
- **AC-3** — The same spec with `contracts[].type: "yaml"` (not in the FR-4 vocabulary)
  produces exactly one warning naming the field and the bad value, and still passes (exit 0).
  (FR-4, FR-5)
- **AC-4** — A `file_allowlist` entry absent from both `implements:` and `affects:` and not an
  ancestor of either produces exactly one warning naming FR-2, on a spec that otherwise has no
  violations. (FR-2, FR-5)
- **AC-5** — Opening a file matching a literal `file_allowlist` entry shows the FR-7 CodeLens
  naming that spec; opening a file matching nothing shows none; opening a file matched by two
  specs' `file_allowlist` shows two CodeLenses. (FR-7)
- **AC-6** — The Active Spec panel, given the AC-2 fixture, renders three clickable links (one
  per `contracts`/`invariant_tests` entry — `file_allowlist` entries render as text per FR-6)
  that each open the named file when clicked; a declared path that does not exist on disk
  renders inactive with the dangling-reference warning visible, not as a silently broken link.
  (FR-6)
- **AC-7** — A pre-existing spec in the corpus with none of the three fields is unaffected:
  `npm run validate` emits the same violation count before and after this change for every
  spec that does not declare any of the three fields. (FR-8, INV-5)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1).** No network call. `validateCddLinks`,
  the panel rendering and the CodeLens provider are filesystem-only.
- **INV-2 — No silent gate (constitution invariant 2).** Every `validateCddLinks` violation
  is `warning`-severity and visibly reported by the same channel every other validator
  warning uses (`npm run validate` output) — never swallowed, never silently downgraded to
  nothing. Because nothing here blocks a commit or a merge, this spec creates no new
  *load-bearing* gate; it must not be promoted to a blocking check without a new DR, since
  that would change invariant-2's "required check" analysis.
- **INV-3 — Blast radius (constitution invariant 3).** All five new files and all five
  touched files live under `packages/minspec/`; nothing is written outside a workspace that
  has already opted in, and no new `.minspec/` write is introduced.
- **INV-4 — Backward compatible.** Restates FR-8 as a standing invariant for every future
  change to this area: a spec that never adopts these fields must never regress.
- **INV-5 — Spec Kit compatibility.** Restates FR-9: an external Spec Kit consumer that does
  not know these three keys continues to parse and round-trip a spec file unchanged.
- **INV-6 — `implements:`/`affects:` unchanged.** This spec adds no field to, and changes no
  validation behaviour of, SPEC-038's `implements:`/`affects:` pair. `validateOwnership`
  (`spec-validator.ts:791`) is untouched.

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`); each question below
carries a recommended option and its cost, and the requirements above are written under the
recommended option. Approving this spec as written ratifies every "Recorded selection" below;
changing an option first changes only the requirements it names.

### DQ-1 — Does `file_allowlist:` reuse `implements:`/`affects:`, or stand alone?

**Recorded selection: Option A,** stand alone, with the FR-2 consistency warning as the only
coupling.

- **Option A — independent field, warn on mismatch (rec).** `implements:`/`affects:` answer
  "what does this spec's approved build own" and feed a blocking gate; `file_allowlist`
  answers "what may a dispatched agent touch while working this spec" and feeds nothing
  blocking (yet — see DQ-2). Conflating them would mean every spec-gate ownership change also
  edits dispatch scope and vice versa, which are different concerns with different audiences
  (a human reviewer approving code ownership; a dispatcher scoping an agent's blast radius).
  *Cost:* most specs will declare near-identical lists in both places, which reads as
  duplication until a spec actually needs them to differ (e.g. a security-sensitive spec
  narrowing `file_allowlist` below what it owns, or widening it to let an agent touch a
  generated file it doesn't "own").
- **Option B — `file_allowlist` defaults to `implements: + affects:` and may only narrow, never
  widen.** *Cost:* needs a merge/override rule in the parser (`cdd-links.ts`) that doesn't
  exist in any sibling field today, and forecloses the widening case DQ-1 Option A's cost
  note names (a generated file an agent must touch but the spec doesn't own).

### DQ-2 — What (if anything) checks that an agent's actual edits stayed inside `file_allowlist`?

**Recorded selection: Option A,** ship the field and its shape-validation now; file the
diff-based enforcement as a separate follow-up issue, not built here.

- **Option A — shape-only now, enforcement follow-up (rec).** FR-5's warnings are static
  (malformed path, mismatch with `implements:`/`affects:`) and need no diff. The issue's literal
  ask ("validator warns if agent edits file outside allowlist") needs a git diff and a
  dispatch-to-spec link that the Tier-0 corpus validator does not have and should not grow —
  `scripts/dispatch-issue.sh` already enforces a *role*-level file allowlist this same way
  (`dispatch-issue.sh:756`-`772`, with its own scope guard over the committed diff); teaching
  it to additionally consult a *spec's* `file_allowlist` is a natural follow-up once this field
  exists to read, but it touches `scripts/`, which this Specify-only dispatch's own file
  allowlist does not permit editing. *Cost:* the issue's UI bullet is not delivered in full by
  this spec alone; a reader who stops at the issue title may expect live enforcement and find
  only a warning on malformed data.
- **Option B — build the diff-based check now, in this spec.** *Cost:* requires editing
  `scripts/dispatch-issue.sh` or adding a new CI script, which is a second, larger, differently
  T-tiered body of work (reading a PR's diff, resolving which spec a dispatch ran against,
  deciding severity) that this spec's `implements:`/`affects:` list does not scope for, and
  that a Specify-phase dispatch is not permitted to touch regardless (file allowlist:
  `specs/**` only).

### DQ-3 — Is `contracts[].type` a closed vocabulary or free text?

**Recorded selection: Option A,** closed vocabulary (`typescript` | `zod`), warn on anything
else.

- **Option A — closed vocabulary, warn on unknown (rec).** The issue's own example uses
  `type: typescript`; DR-359's restatement in the issue body names exactly two contract
  artifact kinds ("TypeScript types / Zod schemas"). A closed, warned vocabulary catches a
  typo (`typescrpt`) without blocking a spec that uses a third kind the field's author didn't
  anticipate. *Cost:* a legitimate future contract kind (e.g. JSON Schema) produces a nuisance
  warning until FR-4's vocabulary is extended.
- **Option B — free text, no validation.** *Cost:* a typo in `type:` is invisible; the Active
  Spec panel (FR-6) would render whatever string is there with no way to flag it as wrong.

### DQ-4 — Which existing CodeLens provider, if either, hosts the FR-7 reverse mapping?

**Recorded selection: Option A,** a new method on `MinSpecCodeLensProvider`
(`codelens-provider.ts:34`), not a third provider class.

- **Option A — extend `MinSpecCodeLensProvider` (rec).** It already resolves "what spec is
  active for this file" for its existing lenses (read, not re-derived here); FR-7's reverse
  mapping is one more lens type registered the same way. *Cost:* the provider's existing
  lenses are keyed off the *active* spec; FR-7 must scan *every* spec's `file_allowlist`
  for the open file, which is a different (corpus-wide) query shape the class doesn't perform
  today and Plan must design for, likely a small index built once per workspace load rather
  than a per-file corpus scan on every CodeLens refresh.
- **Option B — a new, third provider class.** *Cost:* a third class duplicates the
  provider-registration boilerplate `MinSpecSpecFileLensProvider` (`:103`) already carries,
  for a feature closely related to what `MinSpecCodeLensProvider` already does on the same
  kind of file.

## Why no new DR

The recommended options are additive (two optional frontmatter fields plus a third list,
one new warn-only validator function, two new UI surfaces) and every part is revertable in
under a day: removing the three fields from `SpecFrontmatter`, deleting `validateCddLinks`'s
call site, and removing the panel section and CodeLens registration each undo cleanly with no
migration. A decision record becomes necessary only if DQ-2 resolves to Option B (new
scripts/CI enforcement surface) — a change to `scripts/dispatch-issue.sh`'s trust boundary is
exactly the kind of thing DR-008 (dispatch security) already governs, and widening it should
amend or extend that record rather than proceed silently. This spec must not advance to Plan
on DQ-2 Option B without first checking DR-008 and, if it changes that record's assumptions,
writing a new DR.

## Dependencies

- **SPEC-038** (`implements:`/`affects:` spec-gate ownership) — DQ-1's independence decision is
  made relative to it; `validateOwnership` and `isEscapingPath`/`isValidOwnedPath` are reused
  or mirrored, not duplicated from scratch.
- **`DR-359` (parent register, mmo-platform)** — the Contract-Driven Development record the
  issue cites; not independently readable from this repo, treated per Context above.
- **`#137`** (the symmetric-validator primitive) — FR-5's dangling-reference check is an
  instance of its missing/invalid symmetry, applied at warning severity since these fields
  carry no gate-arming consequence.
- **DR-008** (dispatch security) — the record DQ-2 Option B would need to extend, named so
  Plan does not silently widen dispatch trust without it.

## Traceability

- **Issue:** [#23](https://github.com/AIClarityAU/minspec/issues/23).
- **Governing/related decisions:** `DR-359` (parent register, mmo-platform; Contract-Driven
  Development, as restated in the issue body).
- **Specs this touches:** [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md)
  (`implements:`/`affects:`, left unchanged per INV-6; DQ-1 reasons against merging into it),
  [SPEC-056](../SPEC-056-explain-affordance/requirements.md) (prior art for an "explain this"
  CodeLens affordance, read for UI precedent — not modified).
- **Follow-ups this spec expects to be filed (DQ-2 Option A):** diff-based enforcement of
  `file_allowlist` against an agent's actual committed changes, wired into
  `scripts/dispatch-issue.sh`'s existing scope guard or a new CI check. Not filed yet — filing
  it is this dispatch's own follow-up once this spec is read, since a Specify-only dispatch's
  file allowlist does not include `scripts/` or `.github/` and the GitHub issue tracker is a
  write this dispatch has not been authorized to make either.
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition
  (DQ-2 Option B) that would require one.
