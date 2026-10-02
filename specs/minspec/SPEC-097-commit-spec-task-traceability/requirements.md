---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - the Traceability Convention (CLAUDE.md) is this epic's content; this spec gives commit<->spec/task linkage a tool-assisted surface instead of leaving it to memory
aspects: [traceability, commit-message, status-bar, git-integration, advisory-only, solo-mode, ceremony]
relates_to: [DR-003, DR-037, DR-059, DR-066, DR-075, DR-076, SPEC-038, SPEC-040, SPEC-059, "#45"]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: Commit <-> spec/task traceability — an authoring aid and an advisory, neither a new blocking gate

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question below carries an agent-recorded selection
> under **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#45](https://github.com/AIClarityAU/minspec/issues/45)** — a session parked
this mid another commit-strategy conversation, asking "should the auto-commit/traceability
way of working be offered as a minspec ext feature?" The issue's own body already splits the
answer: **auto-commit cadence** (commit per logical group, no live diff review) is harness/
agent behaviour, not something an editor extension can see or control, so it is out of scope
here on the filer's own reasoning, not re-argued in this spec. **Traceability enforcement**
(commit <-> spec task <-> decision record) is the on-brand SDD part, and is what this spec
specifies.

**Plausible-inference flag (Evidence Discipline, CLAUDE.md).** The issue's body says this is
"already partly in flight via scripts/hooks/spec-gate.*". Read, not inferred: `spec-gate.py`
(traced below, "What already exists") enforces doc-before-*code*, i.e. it blocks an *edit* to
a file an unapproved T3/T4 spec declares as its own — a different mechanism from "does this
*commit* reference a spec task," which nothing in the codebase checks today. The issue's claim
is not wrong in spirit (both are traceability-adjacent, both live in `scripts/hooks/`) but it
is not the same gate, and this spec does not extend `spec-gate.py` for that reason — see
"What already exists" and DQ-1.

## One-Sentence Scope

Give commit-message authoring a spec-aware helper and give the status bar a spec-ownership
advisory — both read-only, both non-blocking, neither one more required check in a message
path that already carries two (RCDD, DR-059's deferred-work gate) — and explicitly park the
issue's third candidate (a commit-msg gate that warns or blocks on an un-mapped commit) behind
a Clarify decision this spec does not resolve on its own, because the data it would gate on
does not exist yet (see DQ-1).

## Context — what the code does today (read, not inferred; `file:line` cited)

### What already exists

- **The Traceability Convention is prose-only.** CLAUDE.md states the convention — "Commits
  reference issue: `feat(#N): description`" — and MinSpec's own scaffolded template repeats it
  for adopters: *"Commits name the work item they serve ... in whatever commit convention this
  project follows, e.g. `feat(SPEC-012): description` or `fix(#42): description`"*
  (`packages/minspec/src/lib/template-registry.ts:391`). Nothing reads or writes that prefix —
  it is a convention a human (or an agent) follows by habit, same as this repo's own CLAUDE.md
  copy of it.
- **Two commit-time gates already exist, both blocking, both in `.githooks/commit-msg`
  (68 lines).** The RCDD root-cause gate (DR-003): a `fix:`-typed subject must carry a `Root
  cause:` line in the body (`.githooks/commit-msg:36-62`). That is the *only* gate this
  monorepo's own hook currently runs — the deferred-work gate DR-059 describes (and that the
  scaffolded template installs into adopter projects, `template-registry.ts:1626-1652`,
  `:553-564` of its prose) is **not present** in this repo's own `.githooks/commit-msg`. That
  gap is pre-existing, orthogonal to this issue, and out of scope here (see "Out of Scope");
  it matters only as a fact this spec must not misstate: a *third* gate added here would be
  competing with one shipped gate in this repo's own hook today, not two.
- **`spec-gate.py` is a different mechanism from what the issue asks for.** It is a VS Code
  `PreToolUse` hook (session-local, `scripts/hooks/spec-gate.py`, invoked via
  `spec-gate.sh`) that denies an `Edit`/`Write`/`MultiEdit` tool call to a file inside an
  unapproved T3/T4 spec's declared `implements:`/`affects:` set (`spec-gate.py:457-626`,
  especially `owned_match` at `:444-454`). It fires on an **edit to a file**, before the edit
  happens, scoped to **whichever files a spec's frontmatter already names**. It has no
  concept of a commit, a commit message, or a task — `git` only appears in it to resolve the
  canonical `.minspec/` directory (`canonical_minspec_dir`, `:253-279`) and to read approval
  sidecars. It is also session-local (a Claude Code hook), not a repository-portable `git`
  hook, so it has no equivalent for a human committing from a plain terminal or another
  editor — the same gap DR-037 named for the commit-time gates and fixed by scaffolding them
  as real `.githooks/`.
- **There is no stable task identifier anywhere in the codebase.** The parsed task shape is
  `TaskItem { readonly text: string; readonly done: boolean }`
  (`packages/minspec/src/lib/spec.ts:31-35`) — no `id` field. The newer split-layout
  `tasks.md` files number tasks in free-form prose inside the checkbox line itself, e.g.
  `- [x] **1.1** Create packages/minspec/src/lib/spec-catalog.ts; ...`
  (`specs/minspec/SPEC-040-import-boundaries/tasks.md:16`) — that `1.1` is bold Markdown text
  the task's own author chose, not a value any parser extracts or that any validator holds
  unique. Grepping `packages/minspec/src/lib` for a structured task-id convention
  (`task-`, `taskId`) finds none. A feature that binds a commit to "task N" of the active spec
  has nothing machine-readable to bind to today.
- **"Active spec" is already a shared primitive.** `findActiveSpec(rootDir)`
  (`packages/minspec/src/lib/active-spec.ts:11-64`) picks the most likely in-progress spec
  (status `specifying`/`planning`/`implementing`) and is the single implementation shared by
  the status bar (`views/status-bar.ts`) and the status-bar click command
  (`commands/status.ts`) "so the two never disagree about what the active spec is"
  (`active-spec.ts:15`). Any new surface in this spec reuses this function rather than
  re-deriving "which spec is active."
- **A drift warning already exists, but it is keyed to the session-scope sentence, not to a
  spec's declared ownership.** `handleFileSaveDriftCheck` / `showDriftWarning`
  (`packages/minspec/src/extension.ts:994-1049`) fires on file save when the saved path falls
  outside the free-text sentence recorded by **MinSpec: Declare Session Scope**
  (`isFileInScope`, session scope, not a spec). It is file-save-triggered, not commit-triggered
  or status-bar-resident, and it has no awareness of a spec's `implements:`/`affects:` list at
  all. This spec's status-bar advisory (FR-2) is a **different signal** — keyed to the active
  spec's declared file ownership, not to the session's own sentence — and must not be
  confused with, duplicate, or replace this existing check (see "Out of Scope").
- **No VS Code Git-extension integration exists in this codebase.** Searching
  `packages/minspec/src` for `vscode.git`, `GitExtension`, or an SCM input-box write finds
  nothing. `git` is invoked today only by spawning the `git` CLI (`execFileSync`/`spawn`,
  governed by `CHILD_PROCESS_ALLOWLIST`, `packages/minspec/tests/invariants.test.ts:115-216`).
  Writing into the Source Control input box (FR-1) is new API surface for this codebase, not
  an extension of an existing pattern — named explicitly because it changes the shape of the
  risk review the Plan phase owes it (DQ-3).
- **Commit authorship inside the extension already exists for one narrow case.**
  `packages/minspec/src/commands/commit-on-approve.ts` composes and runs a `git commit` after
  an Approve action, when `minspec.commitOnApprove` is on (referenced in
  `template-registry.ts:435`). It is a full commit (stage + commit), triggered by an approval
  event, not an authoring aid for a commit the human is about to type by hand — a different
  shape from FR-1, which only *prefills a suggestion* and performs no `git` write itself.

### Why this is T4, and why the issue's three candidates are not treated as one FR each

The issue's own body lists three "candidate scope" items without picking among them. Per
CLAUDE.md's Triage Rule 2 (scope-expansion trigger — "also support X" / an un-confirmed
multi-item ask), that is confirmed-or-split, not silently built as three FRs. Tracing above
also surfaces a genuine data gap (no task id exists) that blocks one of the three candidates
outright until a Clarify decision resolves what "a spec task" even means for this purpose.
Between the file surfaces touched (a VS Code SCM API integration, a status-bar extension, the
scaffolded hook-template prose adopters receive, and the tests pinning each) and the open
Clarify decisions whose answers change which files are built, this crosses into T4 — the
predicted tier (T3/T4, per the dispatch header) is an upward-only floor, and the genuine
decisions below are exactly the Clarify-phase content a T3 spec could skip.

## Functional Requirements

Scoped under DQ-1's recommended option: build the two non-blocking aids now; the issue's third
candidate (a commit-msg gate keyed to spec tasks) is NOT specified here — see DQ-1 for why,
and "Out of Scope" for where it goes next.

- **FR-1 — Commit-message helper (the issue's first candidate).** A new palette command (name:
  **MinSpec: Suggest Commit Message from Active Spec**) that:
  - Resolves the active spec via `findActiveSpec` (reused, not re-derived).
  - When no active spec exists, shows a message saying so and does nothing else — never
    writes a guess.
  - Composes a suggested Conventional-Commit subject of the form `type(ref): ` where `ref` is
    the active spec's id, optionally followed by `/` and the first unchecked task's own
    inline label when one can be read under DQ-2's recommended option (e.g.
    `feat(SPEC-012/1.1): `); when the spec has no split-layout `tasks.md`, or no unchecked
    task is found there, `ref` is the spec id alone (`feat(SPEC-012): `) — degrading, never
    failing.
  - `type` defaults to `feat`; the command never attempts to infer `fix` vs `feat` vs `chore`
    from spec content (MinSpec does not make that judgement call anywhere else either — the
    RCDD gate only checks a *human-chosen* `fix:` subject, it does not choose one). The human
    edits the prefilled text before committing.
  - Writes the suggestion under DQ-3's recommended surface, and never submits, stages, or
    commits anything itself — the suggestion is text the human can still change or discard.
  - Is invocable from the Command Palette and (DQ-4) optionally also from the status bar's
    advisory (FR-2) as a one-click action when that advisory is showing.

- **FR-2 — Status-bar ownership advisory (the issue's third candidate, narrowed).** Extends
  the existing MinSpec status bar (`views/status-bar.ts`, `commands/status.ts`) so that, when
  the active spec declares a non-empty `implements:`/`affects:` set (the SPEC-038 convention;
  parsed the same way `spec-gate.py`'s `declared_impl_files` does — reimplemented in
  TypeScript here, since the extension runtime does not shell to the Python hook) **and**
  `git status --porcelain` lists a tracked or staged path that is **not** in that set, the
  status bar surfaces an advisory under DQ-5's recommended placement. The advisory:
  - Is read-only with respect to git and the spec: it runs no `git add`/`commit`, and it
    never edits the spec's `implements:`/`affects:` list on the human's behalf.
  - Is strictly additive to, and explicitly distinct from, the existing session-scope drift
    warning (`extension.ts:994-1049`) — this spec does not touch that function, and the two
    signals may both be visible at once for the same file for two different reasons (outside
    the session's sentence; outside the spec's declared ownership). Neither supersedes the
    other.
  - Degrades silently (shows nothing) when the active spec declares no ownership set at all
    (the common case before SPEC-038's convention is adopted project-wide, and the documented
    "declares nothing -> blocks/advises nothing" behaviour `spec-gate.py:405-406` already
    establishes for the sibling mechanism) — never invents an ownership set to advise against.
  - Is advisory only: it never blocks a commit, a save, or any command. It is unaffected by
    `MINSPEC_GATE_OFF` (there is nothing to turn off — it is not a gate).

- **FR-3 — Harness-template prose stays accurate.** `template-registry.ts:391` and the
  surrounding "Decision records materialize their follow-ups" section already describe the
  commit-naming convention as something a human/agent follows "in whatever commit convention
  this project follows." Once FR-1 exists, the scaffolded README/CLAUDE.md prose MUST gain one
  sentence naming the new palette command as the tool-assisted way to do what that paragraph
  already asks for, so the documentation does not describe a manual habit the tool can now
  do for you without saying so.

- **FR-4 — CHANGELOG entry.** `packages/minspec/CHANGELOG.md` MUST gain an entry naming both
  user-visible additions: the new command (FR-1) and the new status-bar advisory (FR-2),
  following the convention `SPEC-096 FR-12` already established for this repo.

## Acceptance Criteria

- [ ] With an active spec that has a split-layout `tasks.md` carrying at least one unchecked
      task, running **MinSpec: Suggest Commit Message from Active Spec** produces
      `feat(SPEC-NNN/<label>): ` under DQ-3's chosen surface, where `<label>` is the first
      unchecked task's own inline numeric label read verbatim. (FR-1, DQ-2)
- [ ] With an active spec that has no split-layout `tasks.md` (or none unchecked), the same
      command produces `feat(SPEC-NNN): ` — spec id alone, never an error, never a fabricated
      task reference. (FR-1)
- [ ] With no active spec resolvable in the workspace, the command shows an explanatory
      message and writes nothing anywhere. (FR-1)
- [ ] With an active spec declaring `implements: [a.ts]` and a workspace with `a.ts` committed
      clean but `b.ts` modified and untracked by that spec, the status bar shows the FR-2
      advisory; with only `a.ts` modified, it does not. (FR-2)
- [ ] With an active spec declaring no `implements:`/`affects:` at all, the status bar shows
      no FR-2 advisory regardless of what `git status --porcelain` lists. (FR-2)
- [ ] The existing session-scope drift warning (file-save triggered) still fires on its own
      existing fixture set, unmodified by this change, proving FR-2 is additive and not a
      replacement. (FR-2, "Out of Scope")
- [ ] Neither FR-1 nor FR-2 runs a `git commit`, `git add`, or any mutating `git`/`gh`
      invocation; a code-level test enumerating child-process calls introduced by this change
      confirms only read-only `git` invocations (`status`, none for FR-1 unless DQ-3 chooses
      the Git-extension API path, which is in-process, not a spawned process).
- [ ] `CHANGELOG.md` and the scaffolded template prose (FR-3, FR-4) each carry the entries
      this spec requires, in the same change.

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** No network call. `git status`
  is local-only; the VS Code Git-extension API (if DQ-3 selects it) is in-process, not a
  spawned process, and adds no entry to `CHILD_PROCESS_ALLOWLIST`.
- **INV-2 — No silent gate (constitution invariant 2, DR-066) — does not apply to FR-1/FR-2,
  and that is the point.** Neither FR-1 nor FR-2 is a required or merge-gating check, so
  invariant 2's obligations (visible failure, no `|| true`, independent second witness) do not
  bind them — they bind nothing here because nothing here gates anything. If a future
  amendment (DQ-1's Option B, not selected) adds a blocking gate, invariant 2 binds it in
  full at that time; this spec is written so that promotion is additive to FR-1/FR-2, not a
  rewrite of them.
- **INV-3 — Blast radius (constitution invariant 3, DR-086/DR-074).** `template-registry.ts`'s
  scaffolded output (FR-3) only reaches a project that already opted in (`.minspec/` present);
  this spec adds no new writer and no new opt-in surface.
- **INV-4 — Two existing signals stay independent (see Context, Out of Scope).** The
  session-scope drift warning and this spec's FR-2 advisory read different inputs (a
  free-text sentence vs. a spec's declared file set) and must not be merged into one
  check or one message — merging them would silently drop whichever one a future editor
  forgot to re-derive.
- **INV-5 — No third blocking commit-msg gate is added by this spec.** `.githooks/commit-msg`
  and the scaffolded template's hook content are unmodified by FR-1/FR-2 (FR-3's edit is to
  prose, not to a hook script).

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

### DQ-1 — Build which of the issue's three candidates now?

**Recorded selection: Option A** — build the commit-message helper and the status-bar
advisory now (FR-1, FR-2); do not specify the blocking/warning commit-msg gate in this spec.

- **Option A — build the two non-blocking aids; park the gate (rec).** The gate candidate
  ("warn/block commits not mapped to a spec task") needs a *task* identifier to map against,
  and none exists machine-readably today (Context, "no stable task identifier"). Building a
  gate against DQ-2's regex-extracted label would bind enforcement to prose formatting no
  validator currently holds stable — exactly the kind of premature commitment DR-086's
  "evidence-incomplete" stop class exists for. Separately, this repo's *own* commit-msg hook
  already runs one blocking gate (RCDD); the scaffolded template adopters receive runs two
  (RCDD + DR-059's deferred-work gate); DR-075/DR-076's solo-mode ceremony-cut direction keeps
  model-defending gates but is explicitly about *cutting* ceremony elsewhere — adding a third
  mandatory per-commit check for bookkeeping this tool cannot yet verify cleanly runs against
  that direction, not with it. *Cost:* the issue's literal ask ("warn/block") is not built;
  anyone who commits work with no spec reference still can, same as today.
- **Option B — build all three now, gate included (warn-only or blocking).** *Cost:* commits
  to a task-identification scheme (DQ-2) before either non-blocking aid has been used long
  enough to know whether people even want task-level granularity versus spec-level; adds
  friction with no measured false-positive rate, the same evidence-incomplete concern DR-073's
  own D1 names for a different gate in this same methodology area.

### DQ-2 — What is "a spec task" for FR-1 to reference?

**Recorded selection: Option A** — reuse the bold inline numeric label already written in
`tasks.md` prose (e.g. `1.1`), read by a regex over the raw Markdown, read-only.

- **Option A — regex-extract the existing inline label (rec).** No schema change, no new
  frontmatter, no migration. *Cost:* fragile to renumbering/reformatting (a task whose label
  is restyled silently stops matching the regex, degrading FR-1 to spec-id-only rather than
  failing loudly — acceptable because FR-1 is advisory, not acceptable if DQ-1 is later
  revisited to Option B); older single-file specs with no split-layout `tasks.md` have no such
  label at all, so FR-1 degrades to the spec id alone for every spec written before the
  split-layout convention.
- **Option B — mint a structured `<!-- task: T1.1 -->` anchor convention, parsed
  deterministically and validated for uniqueness.** *Cost:* a new authoring convention every
  existing `tasks.md` would need retrofitted to benefit, a validator to keep ids unique across
  a file, and ceremony added for a feature this spec deliberately keeps non-blocking (DQ-1).
  Worth revisiting if DQ-1 is ever reopened to Option B, where a gate needs something sturdier
  than a regex to key off.

### DQ-3 — Where does the commit-message helper write its suggestion?

**Recorded selection: Option A** — the built-in Git extension's Source Control input box,
via its exported API (`vscode.git`, `GitExtension.getAPI(1)`), falling back to Option B's
behaviour when the API is unavailable, no repository is open, or more than one repository is
open with no way to disambiguate which one the human is about to commit to.

- **Option A — write into the SCM input box, with the described fallback (rec).** Lands the
  suggestion exactly where the human is about to type, matching the issue's own framing
  ("inject ... from active spec"). *Cost:* this is new API surface for this codebase (Context)
  — the Plan phase owes a concrete risk read on the Git extension's activation timing and on
  multi-root-workspace / multiple-repository ambiguity before this ships, and the fallback
  path (Option B) must be genuinely exercised, not a theoretical branch nobody tests.
- **Option B — open an untitled scratch document holding the suggested text; the human copies
  it in by hand.** *Cost:* an extra manual step every time, but zero new API surface and no
  repository-resolution ambiguity. Selected as the always-on fallback under Option A regardless
  of which option the human picks as primary.

### DQ-4 — Does the status-bar advisory (FR-2) offer a one-click path into FR-1?

**Recorded selection: Option A** — yes, clicking the advisory both opens the existing detail
view (matching today's status-bar click behaviour, `commands/status.ts`) and offers the FR-1
command as a follow-on action.

- **Option A — one click surfaces both the detail and the FR-1 action (rec).** Connects the
  two aids without forcing a second palette search. *Cost:* couples FR-1 and FR-2 at the UI
  layer; if DQ-1 is ever revisited and one of the two is removed, the other's click handler
  needs a follow-up edit.
- **Option B — keep the two fully independent; the status bar only opens its existing detail
  view.** *Cost:* a human who sees the FR-2 advisory and wants FR-1's suggestion has to find
  the palette command separately — no real cost beyond discoverability.

### DQ-5 — Where does the FR-2 advisory appear?

**Recorded selection: Option A** — folded into the existing MinSpec status-bar item's tooltip
(hover text) and click-through detail, not a second status-bar entry.

- **Option A — fold into the existing item (rec).** One status-bar item stays one item;
  avoids icon-crowding the status bar with a second MinSpec entry. *Cost:* less glanceable
  than a dedicated icon — a human has to hover or click to learn an advisory is live, rather
  than seeing it from across the room.
- **Option B — a second, dedicated status-bar item that only appears when the advisory is
  live.** *Cost:* one more thing permanently competing for status-bar space conceptually,
  even though it is hidden when there is nothing to say; some VS Code status-bar real estate
  is already crowded project-to-project.

## Why no new DR

Every recommended option above is a same-day-reversible choice about one new command, one
status-bar extension, and prose/changelog text — no new store, no new setting that widens a
consent surface, no schema change (DQ-2's Option A is explicitly read-only/regex, chosen partly
*because* it needs no schema), and no change to an existing gate (INV-5). Per the DR-359
(parent register, mmo-platform) ADR filter — "would this be expensive to reverse, or does the
obvious alternative hide a reason not visible in the code?" — none of these clear that bar. A
DR becomes necessary only if a future revisit of DQ-1 lands on Option B (a new blocking gate,
which *would* need one, the same way DR-059 recorded the reversal for the deferred-work gate)
or if DQ-2 is revisited to Option B (a new authoring convention with a validator) — this spec
does not select either, so neither is minted here.

## Out of Scope

- **The commit-msg gate itself** (warn or block on a commit not mapped to a spec task).
  DQ-1. Not specified here. Whoever next picks this up should file it as its own issue once a
  task-identification scheme (DQ-2, or its Option B if DQ-1 is reopened) has evidence behind
  it from FR-1/FR-2's actual use — this spec does not fabricate that issue number itself
  (CLAUDE.md's evidence discipline: never narrate an unrun action).
- **Auto-commit cadence** (commit per logical group, no live diff review). Out of scope per
  the issue's own framing — harness/agent behaviour an editor extension cannot see or control,
  not re-argued here.
- **Fixing this repo's own `.githooks/commit-msg` to match the scaffolded template's
  deferred-work gate** (Context — the two have drifted). A real, separately-diagnosable gap,
  not something this spec's scope covers or should quietly absorb.
- **Replacing or merging the session-scope drift warning
  (`extension.ts:994-1049`) with FR-2.** INV-4 keeps them independent; a future spec could
  reconsider presenting them together, but that is a UX decision this spec does not make.
- **Inferring commit `type` (`feat`/`fix`/`chore`) from spec content.** FR-1 always suggests
  `feat`; the human edits it. MinSpec makes no such judgement call anywhere else in the
  codebase today (RCDD only checks a type the human already chose).
- **A setting to disable FR-2's advisory independently of the rest of the status bar.** Not
  requested by the issue and not required to satisfy it; MinSpec's existing status bar has no
  comparable per-signal toggle today, so adding one here would be new surface the Plan phase
  would need to justify on its own, not inherited from this issue.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Extending `spec-gate.py` to also check commit messages.** Rejected in the Context section
  above and not revisited in Decisions: that hook is session-local (a Claude Code `PreToolUse`
  hook), has no concept of a commit today, and already does a different job (freezing *edits*
  to a spec's declared files) well. Bolting a second, unrelated responsibility onto it risks
  the exact "freezes unrelated work" regression #426 already fixed once in that file
  (`spec-gate.py:11-33`).
- **Building the structured task-anchor convention (DQ-2 Option B) up front, "to do it right
  the first time."** Rejected for now: it adds ceremony (a new convention, a uniqueness
  validator, a retrofit of every existing `tasks.md`) in service of a gate (DQ-1's Option B)
  this spec does not build. Revisit together if DQ-1 is reopened.
- **Skipping FR-2 and shipping FR-1 alone.** Rejected: the issue explicitly named a
  status-bar signal as one of its three candidates, and FR-2 is the one candidate that
  reuses existing, already-shipped machinery (SPEC-038's `implements:`/`affects:`
  convention, the existing status-bar item) almost entirely as data, not as new mechanism —
  a cheap, genuinely additive win alongside FR-1.

## Test plan (for the Plan phase to place)

- **Unit, FR-1:** active spec with unchecked split-layout task -> labelled suggestion;
  active spec with no `tasks.md` or none unchecked -> spec-id-only suggestion; no active
  spec -> message, no write. Each against a real temp workspace fixture, not a mock of
  `findActiveSpec`'s internals.
- **Unit, FR-2:** the TypeScript re-implementation of `declared_impl_files`/`owned_match`
  (parity-pinned against `spec-gate.py`'s behaviour on shared fixtures, the same parity
  discipline `spec-validator.ts:788` already uses for `isValidOwnedPath`) — a file inside the
  declared set never trips the advisory; a file outside it does; an empty declared set never
  trips it.
- **Regression control:** the existing session-scope drift-warning tests pass unmodified,
  proving FR-2 did not fold into or replace that path (INV-4).
- **Not vacuous:** each of FR-1/FR-2's "shows nothing" branches (no active spec; no declared
  ownership) is exercised by a fixture that would show *something* if the guard were removed,
  per this repo's established "mutant-per-branch" discipline (SPEC-096 FR-9/FR-10's pattern).

## Traceability

- **Issue:** [#45](https://github.com/AIClarityAU/minspec/issues/45) — parked automatically
  (DR-360, the parent register's parking-lot policy) from a commit-strategy session.
- **Governing decisions:** [DR-003](../../../docs/decisions/DR-003.md) (RCDD — the gate this
  spec deliberately does not add a third sibling to), [DR-037](../../../docs/decisions/DR-037.md)
  (why commit-time gates are scaffolded `.githooks/`, not session-local), [DR-059](../../../docs/decisions/DR-059.md)
  (the deferred-work gate — the closest precedent for *if* a future gate is ever built here),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate — scoped out for FR-1/FR-2,
  INV-2), [DR-075](../../../docs/decisions/DR-075.md) / [DR-076](../../../docs/decisions/DR-076.md)
  (solo-mode ceremony-cut — the direction DQ-1's recommendation follows).
- **Specs this touches:** [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) (the
  `implements:`/`affects:` convention FR-2 reads), [SPEC-040](../SPEC-040-import-boundaries/requirements.md)
  (the `tasks.md` split-layout format DQ-2 reads labels from), [SPEC-059](../SPEC-059-status-mirror-drift-gate/requirements.md)
  (a neighbouring status-bar-adjacent spec, not modified by this one).
- **Follow-ups:** the parked gate candidate (DQ-1, "Out of Scope") has no issue number yet —
  filing it is a step for whoever next revisits DQ-1 with real usage evidence, not an action
  this dispatch takes.
- **DR for this spec:** none — see "Why no new DR".
