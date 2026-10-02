---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — a second phase model (reproduce→diagnose→fix→harden) alongside specify→clarify→plan→tasks→implement, both governed by the same tier/phase machinery this epic owns
aspects: [bug-lifecycle, phase-gate, frontmatter, closed-set, sidebar, rcdd, no-silent-gate, tier-0, new-surface, offline]
relates_to: [DR-003, SPEC-075, SPEC-054, SPEC-013, "#22"]
# No existing `implements:` claims any of these — grepped across every
# specs/*/SPEC-*/requirements.md in this checkout. All four are NEW; none exist yet because
# this is a Specify-phase-only dispatch (DR-076 / #1169). Exact module boundaries are a
# Plan-phase decision once the Clarify questions below are answered; these names are a
# starting shape, not a commitment.
implements: [packages/shared/src/bug-vocabulary.ts, packages/minspec/src/lib/bug-validator.ts, packages/minspec/tests/bug-phase-gate.test.ts, packages/minspec/tests/bug-validator-root-cause.test.ts]
# Existing files this spec's implementation will touch but does not own. `template-registry.ts`,
# `extension.ts` and `package.json` already carry no single `implements:` owner for the same
# reason SPEC-086 records (many specs add one command/template each); `validate.py` is owned by
# SPEC-075's generalisation work (specifying, not yet built) — see CQ-3 below for why this spec
# cannot simply wait on it. `.githooks/commit-msg` is the live RCDD gate (DR-003) this spec's
# CQ-2 must reconcile with, not silently duplicate.
affects: [packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/src/lib/template-registry.ts, .minspec/hooks/validate.py, .minspec/config.json, .githooks/commit-msg, packages/minspec/src/views/spec-tree-provider.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A first-class Bug lifecycle (reproduce → diagnose → fix → harden), parallel to the spec lifecycle and gated the same way (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#22](https://github.com/AIClarityAU/minspec/issues/22), which the deterministic triage gate
> classified `T3` and authorised Specify-phase-only (DR-076 / #1169) — so the spec is the gate,
> not the fix. A human reads it, answers the Clarify questions below, and approves it through
> the normal spec-approval gate before anything is built.

## One-Sentence Scope

Give bug-fix work its own first-class lifecycle — a `bugs/BUG-NNN-slug.md` record carrying
`reproduce → diagnose → fix → harden` phases (DR-003's four-phase protocol, today prose-only in
`CLAUDE.md`), a phase gate that blocks `fix` until a `root_cause` field is filled in, a closed
`severity` vocabulary, and a sidebar surface — so that bug work is visible to MinSpec's own
tier/phase machinery instead of living only in commit-message convention.

## Context

### The gap, as #22 states it and as the code confirms it

SDD's phase model (`specify → clarify → plan → tasks → implement`) is built for feature work:
`.minspec/config.json`'s `phaseMappings` (read at `.minspec/config.json:16-39` in this
checkout) maps each tier to a subset of those five phases, and `SPEC_TYPES` —
`['requirements', 'design', 'tasks']` (`packages/shared`'s `spec-vocabulary.ts:91`, re-exported
by `packages/minspec/src/lib/spec.ts`) — is the closed set every spec file's `type:` frontmatter
is checked against. Nothing in that machinery models *fixing* something that already shipped.

DR-003 ([Root-Cause-Driven Debugging](../../../docs/decisions/DR-003.md), née "Bug Session
Protocol" — renamed 2026-05-29, same gates) already defines the four-phase shape this spec
turns into a tracked artifact:

```
Phase 1 — Reproduce (no code changes)
Phase 2 — Diagnose  (no code changes)
Phase 3 — Fix       (T3 regression test first, then the fix)
Phase 4 — Harden    (close the coverage gap the bug exposed)
```

Today that protocol is enforced in exactly one place: `.githooks/commit-msg`
(installed via `core.hooksPath=.githooks`), which rejects a `fix:`/`fix(scope):`/`fix!:` commit
whose body lacks a `Root cause:` line (read at `.githooks/commit-msg:44-60` in this checkout).
That is a **commit-time**, **after-the-fact** check — it fires once, on the commit that happens
to carry the fix, and says nothing about whether Phase 1 (Reproduce) or Phase 2 (Diagnose)
happened first, whether a regression test existed before the fix, or whether Phase 4 (Harden)
ever ran. There is no file, no state machine, no sidebar row, and no validator for a bug the way
there is for a spec — exactly the gap #22 names.

### Why this is a new corpus, not a new spec `type:`

The issue's own sketch (`type: bug` frontmatter) reads naturally but collides with a closed set
that already means something else. `SPEC_TYPES` (`requirements | design | tasks`,
`spec-vocabulary.ts:91`) is the **phase-file** type inside one spec directory — it tells
`spec-layout.ts` and `scaffold.ts` which sibling file within `specs/SPEC-NNN-slug/` it is
reading, not what *kind* of work the spec represents. A bug record is not a phase file inside a
spec directory at all: `bugs/BUG-NNN-slug.md` is a different corpus, at a different root,
validated by a different rule (`root_cause` required, no `id: SPEC-NNN` required). Reusing the
token `type: bug` on a file that also needs `SPEC_TYPES`' three values to keep their current
meaning is the overload CQ-1 below exists to resolve explicitly, rather than by accident of a
shared key name.

### The validator this needs doesn't exist for any corpus but two, yet

`.minspec/hooks/validate.py` enforces exactly two hard-coded corpora today (read at
`.minspec/hooks/validate.py:92` in this checkout): `specs/**/*.md` → `id: SPEC-NNN`, and
`docs/domain/*.md` → `type: domain`. [SPEC-075](../SPEC-075-validate-corpus-from-config/requirements.md)
(status `specifying`, not yet built) is the in-flight generalisation that would let a project
declare a third corpus — `bugs/` plus its own required-frontmatter rule — through
`.minspec/config.json` instead of editing the managed hook body. SPEC-075 not having landed is
load-bearing for this spec's CQ-3: building the `root_cause` gate as a *pre-commit* check either
depends on that still-`specifying` work landing first, or hard-codes a third corpus into
`validate.py` today, which is the exact pattern SPEC-075 is written to retire. Both are live
options below; neither can be decided silently.

### Why this sits under EPIC-003, not a new epic

EPIC-003's own goal line is "the tier classifier (T1–T4), **the phase model**
(specify → clarify → plan → tasks → implement), frontmatter contracts, and the validation/
approval gates" (`docs/epics/EPIC-003-sdd-core.md:13-16`). A second, parallel phase model for
bug work governed by the same tier/validation machinery is squarely that charter, not a new
domain — consistent with DR-037 (the pre-commit harness) and SPEC-054 (gate-signal correctness)
both sitting under this same epic.

### Prior art this spec must reuse, not duplicate

- **`SPEC_STATUSES`'s closed-set pattern** (`spec-vocabulary.ts:28-34`, frozen deliberately "so
  adding a status forces a decision everywhere it matters") is the shape `severity` and the new
  bug-phase enum should copy, not reinvent with a different enforcement style.
- **The commit-msg RCDD gate** (DR-003 / `.githooks/commit-msg`) already encodes "no `fix` lands
  without a documented root cause." This spec's `root_cause` field is the same fact, at a
  different layer (file state vs. commit message) — CQ-2 below is about not minting a second,
  independently-drifting authority for one fact, the lesson DR-003's own Addendum (2026-06-01)
  already paid for once when a root-cause *sentence* satisfied a gate while restating the bad
  state instead of naming its cause.
- **The Command Palette convention.** `CLAUDE.md`'s Commands section is explicit: "MinSpec is a
  VS Code extension, not a CLI... never write, suggest, or attempt a `minspec` shell command."
  #22's `minspec bug new <title>` is therefore read here as a Command Palette entry (e.g.
  `MinSpec: New Bug`), registered the same way `minspec.createAdr` and `minspec.createEpic`
  already are (`extension.ts:404,410`) — not a literal shell command. This is stated as a
  requirement below, not a Clarify question, because the project's own documented command model
  already answers it.

## Functional Requirements

- **FR-1 (a bug record is a new corpus, not a spec).** A bug record lives at
  `bugs/BUG-NNN-slug.md`, numbered independently of `SPEC-NNN` (its own sequential id space,
  mirroring `DR-NNN`'s separate register). It MUST NOT be created inside `specs/`, and MUST NOT
  require or accept `SPEC_TYPES`' `requirements|design|tasks` values in whatever field names its
  kind (see CQ-1).

- **FR-2 (closed phase enum: reproduce, diagnose, fix, harden).** Bug-record frontmatter MUST
  carry a phase field restricted to DR-003's four values, enforced as a closed set the same way
  `SPEC_STATUSES` is (`spec-vocabulary.ts:28`), not a free-text field. *Rationale: a free-text
  phase is unenforceable by construction — exactly the "enforce, don't trust the model" gap
  constitution Principle 8 exists to close.*

- **FR-3 (closed severity enum).** Bug-record frontmatter MUST carry `severity`, restricted to
  `low | med | high | critical`, enforced closed. No severity value may be written that is not
  in the set; the validator rejects an unrecognised value rather than passing it through.

- **FR-4 (root-cause phase gate, fails closed).** A command or validator path that advances a
  bug record's phase from `diagnose` to `fix` MUST reject the transition when the record's
  `root_cause` field is empty or absent, and the rejection MUST be visible (a surfaced error, not
  a silently-skipped write) — constitution invariant 2, no silent gate. *This is the T0
  invariant #22 asks for, stated as a transition rule rather than a one-shot file check, because
  a file can be hand-edited to carry `root_cause` without ever having gone through `diagnose`;
  Plan phase must decide whether that hand-edit path also needs covering (see CQ-2's options).*

- **FR-5 (Phase 1–2 source-edit warning, not enforcement).** While a bug record is in
  `reproduce` or `diagnose`, a source-file edit under the project's code paths MUST trigger a
  **non-blocking** advisory, mirroring `.githooks/commit-msg`'s own advisory-not-gate precedent
  for mislabeled fix commits. *Per #22's own Invariants section, this is deliberately informational
  only — it does not join FR-4's hard gate.*

- **FR-6 (T3 regression test required before fix → harden).** Advancing a bug record from `fix`
  to `harden` MUST require a named regression test reference on the record (mirroring this
  project's own `.review-signals.json` `regressionTest` convention used by agent dispatch).
  Absence of that reference fails the transition visibly, same as FR-4.

- **FR-7 (Command Palette surface, not a CLI).** The creation command is a VS Code command
  (e.g. `minspec.createBug`, named at Plan phase following the `minspec.createAdr` /
  `minspec.createEpic` precedent at `extension.ts:404,410`), invoked via the Command Palette.
  #22's literal `minspec bug new <title>` phrasing is non-normative; no shell entry point is
  created. *Rationale: `CLAUDE.md` Commands section — already a project invariant, not a design
  choice this spec makes.*

- **FR-8 (sidebar visibility).** The existing Explorer surface gains a way to see open bug
  records distinctly from specs — exact mechanism (new top-level view vs. a group inside the
  existing Spec Explorer tree) is CQ-4 below, but the requirement itself — a bug in
  `reproduce`/`diagnose`/`fix`/`harden` must be discoverable without opening the file — is not
  optional for a tier this new.

- **FR-9 (validator wiring, mechanism per CQ-3).** `bugs/*.md` MUST be validated the same way
  `specs/**/*.md` and `docs/domain/*.md` already are — i.e. a missing or malformed required
  field fails the validator run, not a silent pass. *Which validator (Python pre-commit hook,
  TypeScript extension-side check, or both) is CQ-3; that the check exists and fails closed is
  not optional (invariant 2).*

- **FR-10 (offline, Tier 0).** No part of the bug lifecycle — creation, phase-gate checks,
  validation, sidebar rendering — makes a network call. All of it ships inside the Tier-0
  `aiclarity.minspec` extension. *Constitution invariant 1.*

## Acceptance Criteria

- **AC-1.** Creating a bug via the Command Palette produces exactly one new file at
  `bugs/BUG-NNN-slug.md` with `phase: reproduce` and the closed-set `severity` field required
  (no default silently assumed — the command prompts for it).
- **AC-2.** Attempting to advance a bug record with an empty `root_cause` from `diagnose` to
  `fix` is rejected, with a message naming the missing field; the record's `phase` is unchanged
  on disk after the rejected attempt.
- **AC-3.** The same attempt with `root_cause` filled in succeeds and the record's `phase`
  becomes `fix`.
- **AC-4.** Editing a tracked source file while a bug record's `phase` is `reproduce` or
  `diagnose` produces a visible warning and does NOT block the edit or the save.
- **AC-5.** Attempting to advance `fix` → `harden` without a regression-test reference is
  rejected the same way AC-2 is; supplying one succeeds.
- **AC-6.** An unrecognised `severity` value (e.g. `severity: urgent`) fails validation with a
  message naming the offending file and value — not a silent pass, not a crash.
- **AC-7.** The sidebar surface shows at least one open bug record, distinguishable from spec
  rows, without requiring the file to be open in an editor.
- **AC-8.** `npm run validate` on a fixture repo containing one well-formed and one
  `root_cause`-less bug record exits non-zero and names the bad file — mirroring SPEC-075's AC-2
  shape for the equivalent spec case.

## Invariants

- **INV-1 (no silent gate — constitution invariant 2).** Every phase-transition rejection (FR-4,
  FR-6) and every validator failure (FR-9) surfaces visibly. None may be satisfied by a swallowed
  error, a `|| true`-shaped bypass, or a check that silently stops evaluating.
- **INV-2 (closed sets, not free text).** `phase` and `severity` are each a frozen, enumerable
  set (FR-2, FR-3), following `SPEC_STATUSES`'s existing pattern rather than inventing a
  differently-enforced vocabulary.
- **INV-3 (offline, Tier 0 — constitution invariant 1).** No network call anywhere in this
  feature (FR-10).
- **INV-4 (blast radius — constitution invariant 3).** Nothing here changes behaviour outside a
  repo that has opted in via `.minspec/` at its root; the bug lifecycle ships inside the same
  Tier-0 extension and activates only where MinSpec is already installed.
- **INV-5 (one fact, one gate — the lesson this spec must not re-break).** `root_cause` must not
  become a second, independently-drifting authority alongside the existing `.githooks/commit-msg`
  RCDD gate for the same underlying fact. CQ-2 resolves which one is authoritative; whichever
  answer is chosen, the other must defer to it rather than silently re-judging the same question
  (echoing DR-003's own Addendum: a root-cause *sentence* satisfying a gate is not proof the
  *mechanism* was named).

## Decisions needed (Clarify)

### CQ-1 (shape) — the frontmatter field naming the record's kind

- **`a` — a new field, e.g. `kind: bug` (rec).** Leaves `type:` meaning exactly what it means
  today (`SPEC_TYPES`'s phase-file discriminator) and gives bug records their own key.
  **Cost:** one more frontmatter key to document and to teach the validator, on top of
  `type`/`status`/`tier`/`severity`/`phase`.
- **`b` — reuse `type: bug`.** Matches #22's literal wording with zero new key.
  **Cost:** overloads a token three existing call sites (`spec-layout.ts`, `scaffold.ts`,
  `spec-validator.ts`) already key off for a different meaning inside `specs/`; a future reader
  of `type:` across the two corpora has to know which meaning applies by *directory*, not by the
  key itself — the same "two authorities, one name" shape INV-5 flags for `root_cause`.

### CQ-2 (mechanism) — root-cause authority: frontmatter field vs. the existing commit-msg gate

- **`a` — frontmatter `root_cause` is authoritative; the commit-msg gate is taught to read it
  (rec).** A `fix:` commit on a branch with an open bug record checks that record's
  `root_cause` instead of (or in addition to) re-parsing the commit body for a `Root cause:`
  line. One fact, one place it is judged.
  **Cost:** couples the commit-msg hook to bug-record state, which it has never read before;
  needs a defined fallback for a `fix:` commit with no associated bug record (today's existing
  behaviour must keep working unchanged for that case — mirrors SPEC-075 FR-1's "default is
  continuity" rule).
- **`b` — the two gates stay fully independent.** Smallest change; ships without touching
  `.githooks/commit-msg` at all.
  **Cost:** reintroduces exactly the drift INV-5 names — a record can carry a `root_cause` that
  satisfies FR-4 while the commit that actually ships the fix carries a different, unrelated
  `Root cause:` sentence (or none, if `RCDD_GATE_OFF=1` bypassed it), and nothing notices the
  disagreement. This is the option DR-003's Addendum already paid once to learn is dangerous, in
  a different shape (a sentence satisfying a gate without being a real cause); recommended
  **against** for that reason.

### CQ-3 (mechanism, needs a DR if `b` is chosen) — where `bugs/` validation runs

- **`a` — hard-code `bugs/` as a third corpus directly in `.minspec/hooks/validate.py` now
  (rec).** Ships without waiting on SPEC-075; the same pattern `specs/` and `docs/domain/`
  already use at `validate.py:92` today.
  **Cost:** adds a third hard-coded corpus to the exact file SPEC-075 exists to stop hard-coding
  into; when SPEC-075 lands, `bugs/` has to be migrated into its config-driven form as a tracked
  follow-up (not silent — SPEC-075's own AC-1 continuity requirement would need a fixture
  covering this corpus too).
- **`b` — block on SPEC-075 landing first.** Zero throwaway work in `validate.py`.
  **Cost:** this spec's FR-9 (pre-commit validation) cannot ship until a separate, currently
  `specifying`, not-yet-approved spec is built — an open-ended dependency with no date, which
  stalls #22 for a decision this spec does not control. Marked "needs a DR if chosen" because
  deliberately sequencing one feature behind another not-yet-accepted spec is a
  hard-to-reverse-in-under-a-day scheduling commitment (DR-359 ADR filter), not a Plan-phase
  detail.
- **`c` — validate only inside the TypeScript extension (editor-side), skip the Python hook
  entirely for v1.** No pre-commit coverage gap waiting on SPEC-075; the phase-gate commands
  (FR-4, FR-6) already run inside the extension and can enforce `root_cause`/regression-test
  presence at write time, independent of any git hook.
  **Cost:** a bug record edited outside the extension (a raw text edit, or a commit from another
  tool) bypasses the check entirely until SPEC-075 or option `a` eventually adds hook coverage —
  a real but bounded gap, since FR-4/FR-6 still gate the *transition* through the extension's own
  commands.

### CQ-4 (shape) — sidebar mechanism for the "Bugs" group

- **`a` — a new top-level view container (new activity-bar entry).** Full isolation from the
  Spec Explorer; its own `TreeDataProvider`, no shared code path with `spec-tree-provider.ts`.
  **Cost:** new `package.json` `contributes.views`/`viewsContainers` entries, a new icon, and a
  second tree-rendering implementation to keep in sync with the first as both evolve.
- **`b` — a group inside the existing Spec Explorer tree, alongside the epic-grouping toggle
  (rec).** Follows the EPIC-001 (Explorer Epic Grouping) precedent already shipped; reuses
  `spec-tree-provider.ts`'s existing grouping machinery instead of forking a second tree.
  **Cost:** couples bug-record rendering to the spec tree's existing (already non-trivial)
  grouping logic, and a toggle users must discover (`minspec.specExplorer.toggleEpicGrouping`'s
  sibling) rather than an always-visible separate panel.

## Test

Forward-looking only — none of these exist yet (Specify phase). Once Plan/Tasks resolve the
Clarify questions above:

- `packages/minspec/tests/bug-phase-gate.test.ts` — drives the phase-transition commands (FR-4,
  FR-5, FR-6) against fixture bug records, one per acceptance criterion (AC-2 through AC-5),
  asserting both the rejection message and that on-disk state is unchanged after a rejected
  transition (AC-2's "phase unchanged on disk" clause is the control — a gate that rejects the
  *call* but still writes the file would pass a shallower test).
- `packages/minspec/tests/bug-validator-root-cause.test.ts` — the `bugs/*.md` validator path
  (FR-9, AC-6, AC-8), including a control fixture with a `bugs/` directory that is empty, so the
  suite cannot pass by never finding a file to validate (the same vacuous-pass shape
  SPEC-075's Test section guards against).
- Whichever of CQ-2/CQ-3's chosen options touches `.githooks/commit-msg` or `validate.py` needs
  its own fixture-repo test in the same style as SPEC-075's planned
  `validate-py-corpus-config.test.ts`, run against the real template bytes, not a paraphrase of
  them.
