---
epic: EPIC-005  # Auto Structure Repair
id: SPEC-005
type: requirements
tier: T3
# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: specifying
product: minspec
relates_to: [DR-006, DR-011, DR-004, DR-074, "#139", "#140", "#39", "#2355", "#1251"]
implements: none
implements_reason: >-
  Specified, not built, and by its own design it creates no new source file. Every FR is an
  additive edit to `auto-bootstrap.ts`, which DR-006 created in 062d2723 (2026-05-28) — before
  this spec's first commit 5b6ec1bc (2026-05-30) — and which no spec's `implements:` claims.
  Verified unbuilt at 27661a68: `isMinspecInitialized` is still the bare `.minspec/` existence
  check (auto-bootstrap.ts:73-75, delegating to `hasOptInMarker`, preferences.ts:159-161), there
  is one `runBootstrap` call site (extension.ts:649), and there are zero hits for any
  structure-repair or required-artifact symbol. The required-artifact set (#139) is specified in
  this revision (FR-1a to FR-1h) and waits on two Clarify decisions; the watcher debounce (#140)
  is still open and marked pin-before-implement. There is no design.md/tasks.md, so no new
  module path is decided. Declares its owned files at implementation, per the SPEC-034
  precedent.
affects:
  - packages/minspec/src/lib/auto-bootstrap.ts
  - packages/minspec/src/lib/template-registry.ts
  - packages/minspec/tests/auto-bootstrap.test.ts
---

# MinSpec — Auto-Structure-Repair (Requirements)

**Date:** 2026-05-30 (amended 2026-10-01 for [#139](https://github.com/AIClarityAU/minspec/issues/139), the required-artifact set)
**Status:** Specifying (SDD Specify phase — this revision changes the body, so the 2026-09-09 approval no longer covers it)
**Decision:** [DR-006 addendum](../../../docs/decisions/DR-006.md) (integrity-deep detection and reactive repair)
**Triggered by:** session request — "auto-fix the SDD structure whenever needed"

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this revision. It
> answers one open question of this spec — *which artifacts are "required"* (issue #139) — and
> changes nothing else in substance. A human reads
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** and re-approves through the
> normal spec-approval gate before any code changes. FR-1a to FR-1h are written under each
> decision's recommended option, so approving the spec as it stands accepts those
> recommendations; choosing another option changes only the requirements that decision names.

---

## Context

The detect-and-offer auto-bootstrap system (DR-006 detect-and-offer setup,
`src/lib/auto-bootstrap.ts`) already offers `init` / `refresh` / `classify` on activation.
Two gaps make it fall short of "whenever needed":

- **A — shallow detection:** `isMinspecInitialized()` checks only that `.minspec/`
  exists. A partial structure (dir present, `config.json`/`constitution.md`
  missing) reports initialized → no repair offered.
- **B — activation-only:** detection fires once at startup; mid-session breakage
  is never re-detected.

### What the code does today, read at `27661a68` (not inferred)

These are the facts the required-artifact decision rests on. Each was read from source or
measured on disk on 2026-10-01.

1. **`isMinspecInitialized()` is now the opt-in marker, not a health check.** It delegates to
   `hasOptInMarker()` (`auto-bootstrap.ts:73-75`, `preferences.ts:159-161`), the single
   definition of constitution invariant 3's marker ("the opt-in marker is `.minspec/` at the
   repo root"). The preference store refuses to write without it (`preferences.ts:196`), the
   session-presence heartbeat gates every write on it (`presence.ts:484-486`), and the
   bootstrap chooses between the project file and the editor's per-workspace memory with it
   (`auto-bootstrap.ts:345`, `:367`). This landed with #2355 (declining to opt in must not opt
   the folder in), after this spec was first approved. The spec's earlier sentence
   "`isMinspecInitialized()` is replaced by the FR-1 integrity check" would, if built as
   written, turn a folder with a damaged `.minspec/` into a folder that "has not opted in".
2. **The template registry has five outputs** (`template-registry.ts:62-77`): `CLAUDE.md`,
   `AGENTS.md`, `.cursorrules`, `.minspec/constitution.md`, `.minspec/labels.md`.
   `generateHarnessFiles` writes every one that is absent, unconditionally
   (`scaffold.ts:1407-1420`), and so does refresh (`scaffold.ts:1580-1583`).
3. **The registry has already grown once after projects were initialized.**
   `.minspec/labels.md` was added on 2026-08-06 (commit `2e1ef349`, #1251 issue label
   vocabulary). Nothing delivers a newly added template to an existing project: the drift
   detector skips a path that is absent on disk and a path with no recorded baseline
   (`auto-bootstrap.ts:116-121`), so a new template never raises the refresh offer by itself.
4. **Three of the five are another tool's files, and their presence is a signal MinSpec
   reads.** `detectTools` treats "`CLAUDE.md` exists" as "this project uses Claude Code" and
   "`.cursorrules` exists" as "uses Cursor" (`tool-detector.ts:28-36`); the slash-command
   shims are written only for a detected tool (`template-registry.ts:2187`, `:2200`).
   Deleting one of these files is therefore how a project says it does not use that tool.
5. **MinSpec itself never reads `labels.md`.** The template says so in its own first
   paragraph (`template-registry.ts:81-84`): documentation and a copy-paste script.
6. **MinSpec does read the other two.** A missing `config.json` silently becomes
   `DEFAULT_CONFIG` (`config.ts:140-144`), discarding a custom specs directory, coverage
   minimum and ownership setting without a word. A missing `constitution.md` renders the
   harness with no invariants (`template-engine.ts:140-146`).
7. **A click on "Initialize" is remembered under the constant `'uninit'`.** The init step's
   signature is that constant (`auto-bootstrap.ts:609`), it is recorded on the primary action
   (`:942`, `:813-818`), and a step whose current signature equals the recorded one is
   skipped (`:901-904`). Every project initialized through the toast therefore holds
   `answeredSignatures.skipInitPrompt = 'uninit'` in its `.minspec/preferences.json`.
8. **Builds before #2355 wrote "Don't ask again" into the folder.** That created a
   `.minspec/` holding only `preferences.json` with `skipInitPrompt: true` — a folder whose
   owner explicitly declined MinSpec, and which the gap-A fix would otherwise report as a
   broken project.

**Measured population (authoring machine, 2026-10-01; counts only, project names withheld).**
19 folders carry `.minspec/`:

| Candidate required set | Folders that would report *incomplete* | Why |
|---|---|---|
| `.minspec/` + `config.json` + `constitution.md` (DQ-1 option A) | 1 of 19 | the one declined folder from fact 8, which FR-1h keeps silent, so **0 offers** |
| the above + every `TEMPLATE_OUTPUT_PATHS` entry (DQ-1 option C) | 16 of 19 | 15 real projects lack only `labels.md` (fact 3), plus the declined folder |

All 18 real projects have `CLAUDE.md`, `AGENTS.md` and `.cursorrules`, so this sample cannot
separate option A from option B. It is one person's machine, where harness files are never
deleted by hand; it shows the size of the `labels.md` effect, not how adopters behave. This
repository's own checkout is one of the 15 (`.minspec/labels.md` is absent and untracked).

## Requirements

- **FR-1 (integrity detection).** Detection MUST treat the structure as
  incomplete when any *required artifact* is missing, not merely when `.minspec/`
  is absent. The required set, how it is defined, and how it may change are FR-1a to FR-1h.
  - **FR-1a (the required set, pinned).** Exactly three paths, relative to the workspace
    folder, checked in this order:
    1. `.minspec/`
    2. `.minspec/config.json`
    3. `.minspec/constitution.md`

    No other path is required. `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
    `.minspec/labels.md` and every managed-region output (CI workflows, git hooks, Claude
    hooks, slash-command shims) are **optional**: their absence never makes a structure
    incomplete. "Missing" means the path does not exist. A path that exists but is empty,
    unparseable or the wrong kind of entry is *present*; that is corrupt-artifact repair
    ([#39](https://github.com/AIClarityAU/minspec/issues/39)), out of scope here. *(DQ-1.)*
  - **FR-1b (why these three — the membership test).** A path belongs in the required set
    only if both hold: (i) MinSpec's own offline code reads it as an input to its own
    behaviour, and silently behaves differently without it; and (ii) its absence cannot be
    a deliberate, supported choice by the project. `config.json` and `constitution.md`
    pass both (Context fact 6). The three tool files fail (ii) — absence is the supported
    way to say "not this tool" (fact 4). `labels.md` fails (i) (fact 5). Managed-region
    outputs fail (ii) where tool-gated, and already have their own repair on refresh
    (`scaffold.ts:1617-1623`). Any later proposal to add a path is judged against this test.
  - **FR-1c (one definition, beside the registry, exhaustive).** The required set MUST be
    one exported constant in `template-registry.ts`, next to `TEMPLATE_OUTPUT_PATHS`.
    Every `TemplateName` MUST carry an explicit `required` or `optional` classification in
    a structure that is exhaustive over `TemplateName`, so that adding a template name
    without classifying it fails the build. The two non-template members (`.minspec/`,
    `.minspec/config.json`) are listed in the same constant. Detection (FR-1), the watcher's
    path list (FR-2) and the offer message (FR-1f) all read this constant; no second list
    of required paths may exist. See [Contract](#contract-indicative-names).
  - **FR-1d (the set does not grow by accident).** A newly added template is classified
    `optional`. Moving any path from optional to required is a change to FR-1a: it needs an
    amendment to this spec that states which already-initialized projects will see a
    one-time offer because of it, and re-approval. A test MUST pin the required set to the
    literal list in FR-1a and name this requirement in its failure message, so a
    one-line change to the classification cannot ship unnoticed. Moving a path from
    required to optional removes offers and needs no such ceremony.
  - **FR-1e (opted in is not the same as complete).** `isMinspecInitialized()` and
    `hasOptInMarker()` keep their current meaning — "`.minspec/` exists" — and every
    existing caller. Integrity is a separate predicate. A folder whose `.minspec/` exists
    but lacks a required artifact is **opted in and incomplete**: its preferences are still
    read from and written to `.minspec/preferences.json`, the presence heartbeat still
    runs, and the refresh, classify and backfill steps are evaluated exactly as today.
    This supersedes the earlier wording that the integrity check *replaces*
    `isMinspecInitialized()`.
  - **FR-1f (which offer, and what it says).** When `.minspec/` is absent, the existing
    init offer is shown, unchanged in message, preference key and signature. When
    `.minspec/` exists and at least one required artifact is missing, a repair offer is
    shown instead; its message MUST name each missing path and MUST NOT say the project
    "isn't initialized". At most one of the two offers is eligible for a folder at a time.
  - **FR-1g (an answer is remembered per missing set).** The repair offer's state signature
    MUST be derived from the sorted list of missing required paths, so answering or
    dismissing it suppresses it until that list changes. It MUST NOT equal the init
    offer's `'uninit'` (Context fact 7 — the offer would otherwise be pre-answered in every
    project initialized through the toast). The init offer's signature for an absent
    `.minspec/` MUST stay `'uninit'`, so nobody who already dismissed that toast is asked
    again by this change.
  - **FR-1h (a declined folder stays declined).** `skipInitPrompt: true` in
    `.minspec/preferences.json` MUST suppress the repair offer as well as the init offer,
    and "Don't ask again" on the repair offer MUST write that same key. Accepting either
    offer runs the same `minspec.init`, so a recorded "don't offer that here" covers both;
    this adds no preference key and no consent surface (FR-5). It is what keeps the
    folders of Context fact 8 silent.
- **FR-2 (reactive trigger).** A debounced watcher on `.minspec/**` and required
  harness paths MUST re-run detection on delete/change and surface the existing
  offer toast when a required artifact goes missing mid-session. Under FR-1a every required
  path lies inside `.minspec/`, so "required harness paths" adds no path outside it.
- **FR-3 (offer, never silent).** Repair is offered via the existing toast
  (`[Fix] / [Not now] / [Don't ask again]`); it MUST NOT auto-write without a
  user action. No new silent-apply setting.
- **FR-4 (idempotent repair).** Accepting the offer runs `minspec.init`, which
  writes only absent files (existing `scaffold()` / `generateHarnessFiles()`
  semantics). MUST NOT overwrite or merge existing user files. `minspec.init` creates
  every absent harness file, not only the required ones that were reported missing
  *(DQ-2)*.
- **FR-5 (consent reuse).** Honors existing per-check `preferences.json`
  dismissals and the `minspec.autoBootstrap.enabled` master toggle. No new
  consent surface.
- **FR-6 (silent marker-bounded refresh — DR-011 Layer 2).** Once the project is
  initialized, the refresh path MAY re-sync MinSpec's own `minspec:*` marker
  sections **without a toast**, because the merge only ever rewrites content
  between markers (invariant #6). Any change that would alter content OUTSIDE a
  marker, and the initial missing-structure offer, still prompt. Gated by
  `minspec.autoBootstrap.enabled`.

### Contract (indicative names)

The shape FR-1c requires. Names are indicative and the Plan phase may rename them; the
properties are the contract: one constant, exhaustive over `TemplateName`, a pure
file-existence function, no `vscode` import, no network.

```ts
// template-registry.ts, beside TEMPLATE_OUTPUT_PATHS
export type ArtifactRequirement = 'required' | 'optional';

/** Exhaustive: adding a TemplateName without an entry here does not compile (FR-1c). */
export const TEMPLATE_REQUIREMENT: Record<TemplateName, ArtifactRequirement>;

/** Workspace-relative paths, in FR-1a order. The only list of required artifacts. */
export const REQUIRED_ARTIFACTS: readonly string[];

// auto-bootstrap.ts
/** Required paths that do not exist, in FR-1a order. Empty means complete. Pure fs. */
export function missingRequiredArtifacts(rootDir: string): string[];
```

`isMinspecInitialized(rootDir)` is unchanged (FR-1e).

## Costly to Refactor (Zone A)

Seams where a wrong early choice is expensive to unwind, ranked:

1. **The "required artifact" set definition (FR-1).** Whatever list drives the integrity
   check becomes the de-facto contract for "complete." The cost is one-directional: adding
   a path later means every already-initialized project that lacks it reports incomplete
   and gets a repair toast, while removing a path only removes toasts. That asymmetry is
   why FR-1a starts from the smallest defensible set and FR-1d puts a gate on growth.
   Pinned by FR-1a to FR-1h, subject to DQ-1.
2. **The watcher glob + debounce contract (FR-2).** The `.minspec/**` + harness
   path watcher and its debounce/dedupe-vs-activation behavior are wired into
   extension activation. Getting the dedupe wrong (toast both at startup *and*
   on the first watcher event) trains users to dismiss, then `[Don't ask again]`
   (FR-5) silently kills the feature — hard to walk back once dismissals persist
   in `preferences.json`.
3. **The marker-boundary predicate (FR-6, invariant #6).** The rule that decides
   "change is fully inside `minspec:*` markers → silent" vs "touches outside →
   prompt" guards the non-destructive invariant. If it ever mis-classifies an
   outside-marker change as inside, FR-6 silently rewrites user content — the one
   thing FR-3/FR-4 promise never happens. This predicate is the blast core.

## Invariants (must hold)

- **INV — Tier 0 (DR-004 tier model):** detection + repair are pure file-system; no AI, no
  network.
- **INV #5 (user override wins):** every offer dismissible; master toggle exits.
- **INV (non-destructive):** repair never overwrites or deletes user content.
- **INV — opt-in marker (constitution invariant 3, DR-074 blast radius):** `.minspec/` at
  the workspace root remains the one opt-in marker, with one definition
  (`hasOptInMarker`). Integrity detection never makes an opted-in folder read as not opted
  in, never writes into a folder that lacks the marker, and — being detection — never
  creates it (FR-1e).
- **INV — a recorded "no" is not re-asked:** no folder whose owner already answered
  "Don't ask again" to the init offer, or dismissed it in its current state, is prompted
  again because of this spec (FR-1g, FR-1h).

## Acceptance Criteria (Zone A)

Definition-of-done; each item traces an FR/invariant in this spec:

- [ ] With `.minspec/` present but `config.json` OR `constitution.md` absent, detection
      reports *incomplete* and the repair offer appears (FR-1, FR-1a — fixes Context gap
      **A**, the `isMinspecInitialized()` shallow check).
- [ ] With all three required paths present and each of `CLAUDE.md`, `AGENTS.md`,
      `.cursorrules`, `.minspec/labels.md` and a managed-region output absent in turn,
      detection reports *complete* and no repair offer appears (FR-1a, FR-1b).
- [ ] The required set is one exported constant; a `TemplateName` added without a
      classification fails the build, and a test fails, naming FR-1d, when the constant
      differs from FR-1a's literal list (FR-1c, FR-1d).
- [ ] In a folder with `.minspec/` present and `config.json` absent,
      `isMinspecInitialized()` is still true, a recorded answer lands in
      `.minspec/preferences.json`, and the presence heartbeat still writes (FR-1e, INV
      opt-in marker).
- [ ] The repair offer's message contains each missing path and does not contain the init
      offer's "isn't initialized" wording; with `.minspec/` absent the init offer is
      byte-identical to today's (FR-1f).
- [ ] With `answeredSignatures.skipInitPrompt = 'uninit'` on disk and `config.json` then
      deleted, the repair offer still appears; after it is dismissed it does not reappear
      until the set of missing paths changes (FR-1g).
- [ ] A `.minspec/` containing only `preferences.json` with `skipInitPrompt: true` produces
      no offer of any kind (FR-1h, INV recorded "no").
- [ ] Deleting a required artifact mid-session re-surfaces the offer toast
      without a window reload, via the debounced `.minspec/**` watcher (FR-2 —
      fixes Context gap **B**).
- [ ] No repair is ever written without a user action on
      `[Fix] / [Not now] / [Don't ask again]`; no new silent-apply setting exists
      (FR-3).
- [ ] Accepting `[Fix]` runs `minspec.init` and writes only absent files; a
      hand-edited existing `config.json`/`constitution.md` is byte-identical
      afterward (FR-4 + INV non-destructive).
- [ ] A prior `[Don't ask again]` dismissal in `preferences.json`, and
      `minspec.autoBootstrap.enabled = false`, each suppress the offer (FR-5 +
      INV #5).
- [ ] A `minspec:*` marker-bounded refresh re-syncs silently; a change touching
      content outside any marker still prompts (FR-6 + invariant #6).
- [ ] Detection and repair perform zero AI/network calls — verifiable by code
      path, pure `fs` only (INV Tier 0 / DR-004).

## Decisions needed (Clarify)

Two decisions. Each carries a recommendation and its cost; the requirements above assume
the recommended option in both.

### DQ-1 — Which harness files are required?

`.minspec/`, `config.json` and `constitution.md` are already fixed by the DR-006 addendum.
The open part is its phrase "required harness files".

- **Option A — none beyond the constitution (rec).** The required set is the three paths
  of FR-1a. It is the only option under which no existing project is prompted on upgrade
  (0 offers across the 19 measured folders), and it is the cheap direction to be wrong in:
  a path can be promoted later through FR-1d, whereas a path required too early has
  already prompted everyone. *Cost:* a `CLAUDE.md`, `AGENTS.md` or `.cursorrules` deleted
  by accident is never offered back by this feature. The assistant silently loses its SDD
  instructions until someone runs Refresh or Initialize by hand (both recreate an absent
  harness file, `scaffold.ts:1580-1583`, `:1407-1420`), and the refresh offer will not
  prompt for it either (Context fact 3).
- **Option B — a tool's file is required when the project shows other evidence of that
  tool.** For example `CLAUDE.md` is required when `.claude/` exists, `.cursorrules` when
  `.cursor/` exists. Catches the accidental deletion option A misses. *Cost:* the evidence
  is not independent — MinSpec itself writes `.claude/commands/`, `.claude/hooks/` and
  `.cursor/rules/spec-kit-commands.mdc` (`template-registry.ts:2119-2121`), so a project
  that deliberately dropped a tool keeps tripping the check until it also removes
  directories MinSpec created. I believe both tools also accept their instructions at
  other paths (`.claude/CLAUDE.md`; `.cursor/rules/` in place of `.cursorrules`), which
  would make a correctly configured project read as broken; that belief is unverified.
  `AGENTS.md` has no such evidence at all, so it stays optional and the rule is uneven.
  Changes FR-1a, FR-1b and the second acceptance criterion; adds a conditional-membership
  rule to FR-1c.
- **Option C — every `TEMPLATE_OUTPUT_PATHS` entry.** No second classification to
  maintain: the registry is the list. *Cost:* 16 of the 19 measured folders are prompted
  on upgrade, 15 of them solely for `labels.md`, a file MinSpec never reads; accepting
  that offer for one missing file also recreates any tool file the project had deleted,
  which switches that tool's slash-command shims back on (Context fact 4); and every
  template added from then on becomes a prompt in every project. Replaces FR-1a to FR-1d
  with "derive from the registry" and drops the growth gate.

### DQ-2 — What may `[Fix]` write?

A consequence of DQ-1 option A or B, where the detected set is narrower than what
`minspec.init` creates.

- **Option A — keep `minspec.init` as the repair (rec).** No new write path; FR-4 and the
  DR-006 addendum ("no new write logic") stand as approved. *Cost:* the offer reports
  `config.json` missing and the click also recreates every other absent harness file,
  including an optional one the project removed on purpose — for instance `.cursorrules`
  comes back and the Cursor shim with it. The repair is additive and never overwrites,
  but it is wider than the message that prompted it.
- **Option B — a targeted repair that writes only the missing required paths.** The click
  does exactly what the message said. *Cost:* a second writer for `config.json` and the
  constitution alongside `scaffold()` and `generateHarnessFiles()`, which is the
  duplicated write logic the DR-006 addendum rejected; it needs that addendum amended
  before Plan, and it must reproduce the constitution seeding and manifest recording that
  `generateHarnessFiles` performs after writing (`scaffold.ts:1422-1473`) or leave them
  inconsistent. Changes FR-4 and its acceptance criterion.

## Assumptions

- `scaffold()` / `generateHarnessFiles()` already have write-only-if-absent
  semantics, so FR-4 idempotency is a reuse, not new code. Verified for the template loop
  (`scaffold.ts:1407-1420`) and for `config.json` (`scaffold.ts:322-338`).
- The existing offer toast (`[Fix] / [Not now] / [Don't ask again]`) and the
  `minspec.autoBootstrap.enabled` toggle from DR-006 are present and re-usable;
  FR-3/FR-5 add no new consent surface. Throughout this spec that bracketed shorthand
  means: the primary action, dismissing the toast, and "Don't ask again". The shipped
  toast has no separate "Not now" button — closing it is the "not now"
  (`auto-bootstrap.ts:906-912`).
- `minspec:*` marker sections are well-formed (paired open/close markers) in any
  file FR-6 touches; malformed markers fall under Out-of-scope corrupt-artifact
  repair (#39), not here.

## Test-thought

Verified by driving the file system, not mocks: delete each required artifact
(`config.json`, `constitution.md`) and assert the offer surfaces at activation (FR-1) and
on mid-session delete via the watcher (FR-2); delete each *optional* file and assert
nothing surfaces (FR-1a); then accept `[Fix]` and assert a pre-edited user file is
byte-unchanged (FR-4 + non-destructive INV).

## Consequences

**Positive:**
- Closes the two named gaps from Context — partial-structure false-"initialized"
  (A, FR-1) and activation-only detection (B, FR-2) — so "whenever needed"
  becomes true.
- FR-6 removes nagging for pure marker re-syncs while preserving the prompt for
  any outside-marker change, keeping invariant #6 intact.
- Under FR-1a no existing project is prompted when the feature ships, and adding a
  harness template later cannot prompt anyone unless FR-1d's amendment says so.

**Negative:**
- A new always-on `.minspec/**` watcher adds a small steady-state cost and a
  debounce/dedupe burden (Open question) that activation-only code avoided.
- Under FR-1a a missing tool file (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) is outside
  this feature: no offer is made for it (DQ-1 option A's cost).
- The repair writes more than the offer names (DQ-2 option A's cost).

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Marker mis-classification silently rewrites user content.** FR-6's inside-vs-outside-marker predicate tags an outside-marker change as *inside* → silent overwrite, breaking invariant #6 and FR-3's never-silent promise. | Low · High | The marker-boundary predicate is the named blast core (Costly #3); silent path is taken only when provably inside paired `minspec:*` markers, else prompt (FR-3); T0 test asserting an outside-marker edit always prompts. |
| R2 | **Watcher toast-storm trains dismissal.** FR-2's watcher races activation-time detection → double toast for one missing file → user hits `[Don't ask again]` (FR-5), which persists in `preferences.json` and kills the feature. | Med · Med | Debounce + dedupe-vs-activation (Costly #2 / the named Open question); collapse the activation check and the first watcher event into a single offer. |
| R3 | **Retroactive false-incomplete.** Broadening "initialized" (FR-1) makes already-initialized projects report incomplete and surface a repair toast they did nothing to earn. | Low · Low under FR-1a (0 of 19 measured folders prompted); High · Med under DQ-1 option C (16 of 19) | FR-1a's minimal set; FR-1d's gate on growth and its pinning test; FR-1h for declined folders; idempotent repair (FR-4) writes only absent files, so accepting is non-destructive (INV non-destructive). |
| R4 | **Stale dismissal masks real breakage.** A prior `[Don't ask again]` (FR-5) suppresses a later, genuinely-missing-artifact offer. FR-1h widens this: a "Don't ask again" given to the init offer by an older build also silences repair. | Med · Low | By design (consent reuse, INV #5) — the user can still run Initialize from the Command Palette; consent is never auto-overridden. Accepted residual. |
| R5 | **Tier-0 leak.** A future repair convenience reaches for AI/network, breaking the air-gap. | Low · High | INV Tier-0 (DR-004); repair is pure `fs` reuse of `scaffold()`/`generateHarnessFiles()`; no `http`/`https`/`fetch` import (testable by code path). |
| R6 | **Opt-in and completeness get merged.** An implementation changes `isMinspecInitialized()` instead of adding a predicate, so an incomplete project loses its preference file, heartbeat and every later bootstrap step. | Med · High (the earlier text of this spec asked for exactly that) | FR-1e, the opt-in-marker invariant, and the fourth acceptance criterion. |
| R7 | **The repair offer is born pre-answered.** It reuses the init step's constant signature, which every toast-initialized project has already recorded, so it never shows and the feature is silently inert. | Med · Med | FR-1g and its acceptance criterion, which seeds the recorded `'uninit'` before deleting an artifact. |

## Failure-Modes / Edge-Cases

1. **Toast storm / double-fire (FR-2).** Watcher event races the activation-time
   detection → two toasts for one missing file. Debounce + dedupe-vs-activation
   must collapse them (named Open question).
2. **Marker mis-classification (FR-6).** Predicate wrongly tags an
   outside-marker change as inside → silent rewrite of user content, violating
   invariant #6 and FR-3. The Costly-to-Refactor blast core.
3. **`[Don't ask again]` then real breakage (FR-5).** A prior dismissal in
   `preferences.json` suppresses a later genuinely-missing-artifact offer; by
   design (consent reuse) the user must re-enable, no auto-override.
4. **Bulk delete of `.minspec/` (FR-1/FR-2).** Whole dir removed mid-session →
   should degrade to the same "missing-structure offer" as a fresh project, not
   error. The preference file goes with the directory, so this is the init offer of
   FR-1f, answered through the editor's per-workspace memory.
5. **Repairing a missing `config.json` is treated as a first init.** `initCommand` decides
   "first init" by the absence of `config.json` (`init.ts:1236`), so accepting the repair
   re-runs the coverage-minimum question and the GitHub-extension tip (`init.ts:1269-1275`).
   The Plan phase decides whether that is wanted; it must not happen by oversight.
6. **A recreated `config.json` is the default one, not the lost one.** `scaffold()` writes
   `DEFAULT_CONFIG` plus a re-resolved project name (`scaffold.ts:322-338`). A custom specs
   directory or coverage minimum is not recoverable from disk, so the offer and its
   success message must say "created", never "restored".
7. **Fresh clone or new worktree.** None of the three required paths is in the list
   MinSpec gitignores (`scaffold.ts:275-312` holds only machine-local state), so a clone
   of a healthy project that committed its scaffold is complete. A required set that included any gitignored path would
   prompt on every clone; FR-1b's test is applied with that in mind.

## Test / Verification Strategy

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 / FR-1a | T0 | Invariant: with `.minspec/` present but a required artifact absent, detection returns *incomplete* (one case per artifact in the required set); with each optional file absent in turn, *complete*. |
| FR-1c / FR-1d | T0 | The exported required set equals FR-1a's literal list; the failure message names FR-1d. Exhaustiveness over `TemplateName` is a compile-time property of `src/`, checked by the build, not by a test file (test files are outside the typecheck). |
| FR-1e | T0 | Invariant: for a folder with `.minspec/` and no `config.json`, `isMinspecInitialized()` is true and a saved preference lands in `.minspec/preferences.json`. |
| FR-1f | T2 | Message for the repair offer lists the missing paths; the init offer's message, key and signature are unchanged from the current build. |
| FR-1g | T0 | Seed `answeredSignatures.skipInitPrompt = 'uninit'`; delete `config.json`; the offer is eligible. Dismiss; not eligible. Delete `constitution.md` too; eligible again. |
| FR-1h | T0 | A `.minspec/` holding only `preferences.json` `{ "skipInitPrompt": true }` yields no offer. |
| FR-2 | T2 | Delete a required file mid-session → watcher fires (after debounce) → offer toast surfaces; no window reload needed. |
| FR-3 | T0 | Invariant: no fs write occurs on detection or on `[Not now]`/`[Don't ask again]`; write happens only after `[Fix]`. |
| FR-4 | T0 | Invariant: pre-seed a hand-edited `config.json`; run repair; assert byte-identical + only absent files created. |
| FR-5 | T2 | With dismissal recorded in `preferences.json` OR `autoBootstrap.enabled=false`, offer is suppressed. |
| FR-6 | T0 | Invariant: marker-bounded diff → silent; outside-marker diff → prompt (table the predicate against both). |

## Alternatives Considered

- **Periodic polling instead of an fs watcher (FR-2).** Rejected — wastes cycles,
  adds latency between breakage and offer, and still needs the same dedupe; a
  debounced watcher is event-driven and cheaper.
- **Auto-apply repair silently when artifacts are missing (vs FR-3 offer).**
  Rejected — violates INV #5 (user override wins) and the non-destructive intent;
  the product's "offer, never silent" stance is the whole point.
- **Deep-validate artifact *contents* (parse `config.json`, lint constitution).**
  Rejected for this spec — that is corrupt-artifact repair, explicitly parked as
  [#39](https://github.com/AIClarityAU/minspec/issues/39); scope here is
  additive/missing-only.
- **Required = whatever this project's own manifest says MinSpec generated**
  (`.minspec/generated-hashes.json` or `template-baseline.json`). Attractive because a
  template added later could never alarm an older project. Rejected — both files are
  gitignored machine-local state (`scaffold.ts:288-289`), absent in every fresh clone and
  worktree, so the same project would be complete on one machine and incomplete on
  another.
- **Change `isMinspecInitialized()` to mean "complete"** (the earlier text of this spec).
  Rejected — it is the opt-in marker predicate with callers that gate writes on it
  (Context fact 1); see FR-1e and R6.
- **A separate "Don't ask again" key for the repair offer.** Rejected — it would ignore the
  refusal already recorded in declined folders (Context fact 8) and add a preference key
  to a schema DR-006 names as costly to change, for a click that runs the same command.
- **Treat a `.minspec/` that holds only `preferences.json` as not opted in.** Rejected — it
  would give constitution invariant 3's marker a second, content-dependent definition.
  FR-1h reaches the same silence without touching the marker.

## Dependencies & Blast-Radius

- **`src/lib/auto-bootstrap.ts`** (DR-006) — gains the FR-1 integrity predicate and the
  repair offer beside the existing steps; `isMinspecInitialized()` is **kept as is**
  (FR-1e); the offer toast and `autoBootstrap.enabled` gate are reused. Changing the
  integrity check changes when *every* project sees the offer.
- **`scaffold()` / `generateHarnessFiles()`** — FR-4 depends on their
  write-only-if-absent semantics; if they ever start overwriting, the
  non-destructive invariant breaks here.
- **`src/lib/template-registry.ts`** — gains the required/optional classification and the
  required-set constant (FR-1c). `TEMPLATE_OUTPUT_PATHS` is no longer the source of the
  required list by itself: adding an entry to it re-scopes nothing until the entry is
  classified, and classifying it `required` is gated by FR-1d.
- **`.minspec/preferences.json` + `minspec.autoBootstrap.enabled`** — FR-5
  consent; shape changes break dismissal honoring. This spec adds no key (FR-1h).
- **Callers of `isMinspecInitialized()` / `hasOptInMarker()`** — `presence.ts:485`,
  `preferences.ts:196`, `packages/minspec/src/commands/classify.ts:130`, and the
  bootstrap steps
  (`auto-bootstrap.ts:102`, `:155`, `:204`, `:345`, `:367`, `:601-728`). None changes
  behaviour (FR-1e).

## Rollback / Reversibility

Reversible. The feature is gated by `minspec.autoBootstrap.enabled` (FR-5), so it
can be disabled per-user with no code change. Code-wise, the new watcher (FR-2)
and the FR-1 integrity predicate are additive to `auto-bootstrap.ts`; reverting
restores activation-only detection on the `.minspec/` marker alone. No schema or
on-disk migration is introduced (FR-4 only writes absent files; FR-1h adds no preference
key), so there is nothing to un-migrate. **ADR-filter:** undoable in well under a day → no
new DR beyond the existing DR-006 addendum / DR-011 reference. The required set itself is
reversible in the cheap direction only: shrinking it is a one-line change that removes
offers, while growing it prompts existing projects and cannot be un-prompted — which FR-1d
gates rather than forbids. A decision-record change is needed in exactly one case: DQ-2
option B, which contradicts the DR-006 addendum's "no new write logic" and must amend it
before Plan.

## Follow-ups (tracked)

- **Required-artifact set** — specified in this revision as FR-1a to FR-1h. Tracked at
  [#139](https://github.com/AIClarityAU/minspec/issues/139), which closes when DQ-1 and
  DQ-2 are answered and this spec is re-approved (distinct from #39, which is
  corrupt-artifact repair, not the missing-set definition).
- Watcher debounce interval + dedupe-vs-activation decision (Open question,
  drives FR-2 + Failure-Mode 1 toast-storm). Tracked at
  [#140](https://github.com/AIClarityAU/minspec/issues/140);
  pin before implement.
- Failure-modes 5 and 6 (first-init prompts on repair; "created", not "restored") are
  owned by this spec's Plan phase and must be answered in its `design.md`.
- `docs/epics/EPIC-005-structure-repair.md` still lists the required-harness-files set as
  an open question and names `isMinspecInitialized` as the code this spec changes. It
  needs correcting once this revision is approved. **Not yet filed as an issue** — the
  dispatch that wrote this revision may edit only `specs/` and has no network access.
- Dangling "parked as a separate issue" reference lint already tracked at
  [#40](https://github.com/AIClarityAU/minspec/issues/40).

## Coverage Map

| Mechanism / concern | FR |
|---|---|
| Integrity detection (partial structure ⇒ incomplete) | FR-1 |
| Which paths are required, and why | FR-1a, FR-1b |
| Single definition; gate on growth | FR-1c, FR-1d |
| Opt-in marker stays separate from completeness | FR-1e |
| Offer selection, message, per-state memory | FR-1f, FR-1g |
| A declined folder stays silent | FR-1h |
| Mid-session reactive re-detection (watcher) | FR-2 |
| Offer-only, no silent write | FR-3 |
| Idempotent / non-destructive repair | FR-4 |
| Consent + master-toggle reuse | FR-5 |
| Marker-bounded silent refresh (invariant #6) | FR-6 |
| Tier-0 purity (no AI/network) | INV Tier 0 / DR-004 |

## Out of scope

- Repairing *corrupt* artifacts (invalid `config.json`, malformed constitution).
  Additive/missing-only. Corrupt-file repair parked as
  [#39](https://github.com/AIClarityAU/minspec/issues/39).
  (A lint to catch future dangling "parked as a separate issue" references with
  no link is tracked as
  [#40](https://github.com/AIClarityAU/minspec/issues/40).)
- Any change to the consent model or new silent-apply behavior.
- Delivering a newly added optional template (such as `labels.md`) to existing projects.
  That is a harness-refresh concern (Context fact 3), not structure repair; this spec
  only guarantees such a file is never reported as breakage.
- Removing the `.minspec/` folders that older builds created in projects that declined
  (Context fact 8). FR-1h keeps them silent; cleaning them up is not repair.

## Open questions

- Watcher debounce interval + dedupe against the activation-time run
  ([#140](https://github.com/AIClarityAU/minspec/issues/140)).

The required-harness-files question that stood here is answered by FR-1a to FR-1h and put
to the human as DQ-1 and DQ-2 above.

## Revision record

- **2026-10-01, for [#139](https://github.com/AIClarityAU/minspec/issues/139) (pin the
  required-artifact set).** Added the code-state and measurement block to Context; FR-1a
  to FR-1h and the indicative contract; two invariants; seven acceptance criteria; DQ-1
  and DQ-2; risks R6 and R7; failure-modes 5 to 7; four rejected alternatives. Corrected
  three statements that were no longer true of the code: that the integrity check
  *replaces* `isMinspecInitialized()` (it is the opt-in marker since #2355); that
  `TEMPLATE_OUTPUT_PATHS` is the source of the required list; and the reading of
  `[Not now]` as a button. Issue links moved from `harvest316/minspec` to
  `AIClarityAU/minspec`. FR-2 to FR-6 are unchanged in substance. Status returned from
  `implementing` to `specifying`: the body changed, so the approval recorded 2026-09-09
  no longer matches, and both open questions were marked pin-before-leaving-Specify.
