---
id: SPEC-372
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-005  # Auto Structure Repair — auto-bootstrap prompts (DR-006)
aspects: [auto-bootstrap, preferences, workspaceState, persistence, tier-0, consent]
relates_to: ["#908", "#892", DR-006, DR-078, DR-074, DR-071, SPEC-050]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist; the storage-boundary choice under
  "Decisions needed (Clarify)" is unanswered.
---

# SPEC-372: Auto-bootstrap "Don't ask again" answers survive git operations and re-clones (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#908](https://github.com/AIClarityAU/minspec/issues/908). Rationale lives in
[DR-006](../../../docs/decisions/DR-006.md) (the detect-and-offer system, which put dismissals in
`.minspec/preferences.json`) and [DR-078](../../../docs/decisions/DR-078.md) (which later made that
file the one project-local store for MinSpec-written preferences).

## Root cause (mechanism, not state)

The bad state is "the user answered *Don't ask again*, and the prompt came back".

- **Mechanism (reported case).** `.minspec/preferences.json` was committed by accident. Any
  working-tree git operation (`reset --hard`, `restore`, `checkout`, branch switch) rewrote it to
  its committed baseline and discarded the fresh answer. The record is in `.minspec/` — a
  repo path, so git can touch it.
- **Gate that was missing, now present (this checkout).** The file is gitignored
  (`.gitignore:93`) and scaffolded into adopters' `.gitignore` (`packages/minspec/src/lib/scaffold.ts:312`).
  So the *tracked* case is already closed for repos that carry the entry. Re-measure in Plan: a repo
  scaffolded before that entry existed, or one that already tracks the file, still has the defect, and
  nothing in the extension detects "preferences.json is tracked".
- **Residual (design).** A prompt answer is machine-local UI state, but it lives in a directory a
  user may wipe: `git clean -x`/`-fdx`, a fresh clone, deleting `.minspec/`. The sibling nudges
  already use `context.workspaceState` (`packages/minspec/src/extension.ts:858-863`, `:895-928`), and
  the pre-opt-in path of the *same* prompts already uses it
  (`auto-bootstrap.ts:342-366`, `PRE_OPT_IN_MEMORY_KEY_PREFIX`). So the code has two stores for one
  answer, split only by whether `.minspec/` exists.

> Citations are from reading the files on this branch; the Plan phase must re-verify each before
> relying on it (per the repo's mechanism-claims rule).

## Scope

**In scope:** the per-prompt answer records of the auto-bootstrap steps — the `skip*Prompt`
booleans and `answeredSignatures` in `BootstrapPreferences`
(`packages/minspec/src/lib/preferences.ts`).

**Not in scope until a decision below says otherwise:** `advancePhaseOnApprove`,
`autoBackfillUseAi`, `autoClassifyOnCommit`, and SPEC-050's standing push consent. DR-078 §1 and
DR-071 chose the project file for those *because they are consents with a project blast radius*, which
is a different property from a dismissed toast.

## Functional requirements

- **FR-1.** After the change, "Don't ask again" and the recorded answered-signature for every
  auto-bootstrap step are stored in VS Code `workspaceState` for the folder, not in
  `.minspec/preferences.json`. They survive `git reset --hard`, `git restore`, `git checkout`, branch
  switch, `git clean -x`, and deletion of `.minspec/`.
- **FR-2.** Keys are per folder (absolute root as suffix), as `PRE_OPT_IN_MEMORY_KEY_PREFIX` already
  does, because `workspaceState` is shared by every folder of a multi-root workspace; declining in one
  folder must not silence another.
- **FR-3.** One store only. The opted-in/not-opted-in split in `loadBootstrapPreferences`
  (`auto-bootstrap.ts`) for *prompt answers* collapses to a single `workspaceState` record, so an
  answer given before opt-in is still honoured after it. The "delete the pre-opt-in entry" step
  (`clearPreOptInMemory`, #2367) is retired or repurposed accordingly.
- **FR-4.** One-time read-migration. On first read for a folder with no `workspaceState` record, if
  `.minspec/preferences.json` carries any prompt-answer keys, copy them into `workspaceState`, then
  mark the migration done so it runs once. Migration is read-only on the file (see FR-5), and never
  runs in a folder that has not opted in (invariant 3).
- **FR-5.** MinSpec stops **writing** prompt-answer keys to `preferences.json`. Existing keys in the
  file are left in place (not deleted): deleting would be a write MinSpec was not asked to make, and
  leaving them is harmless once FR-4 has run.
- **FR-6.** Answers never create a file or directory in the folder (the #2355 property is kept and
  now holds for every folder, opted in or not).
- **FR-7.** A `workspaceState` write failure or a missing `workspaceState` (test stub, headless
  host) degrades to "prompt returns next activation"; it never throws out of the activation path and
  never falls back to writing into the repo.
- **FR-8.** Docs follow the code: the `minspec.autoBootstrap.enabled` description
  (`packages/minspec/package.json:486`), the CHANGELOG, the `preferences.ts` and `auto-bootstrap.ts`
  headers, and DR-006's "Don't ask again" bullet are updated so none still says the answer lives in
  `.minspec/preferences.json`.
- **FR-9.** (Depends on the Clarify decision.) DR-078 is annotated so a reader of §1 learns that
  prompt-dismissals moved while consents did not.

## Acceptance criteria

- **AC-1.** Answer "Don't ask again" to the classify prompt, run `git reset --hard` and
  `git clean -fdx`, reactivate: the prompt does not return.
- **AC-2.** Same in a repo where `preferences.json` is *tracked* with a baseline lacking the answer:
  the prompt does not return after `git checkout .`.
- **AC-3.** Multi-root: declining in folder A leaves folder B's prompts offered.
- **AC-4.** A folder with an existing `preferences.json` holding `skipClassifyPrompt: true` and no
  `workspaceState` record: first activation migrates, the prompt stays suppressed, `preferences.json`
  is byte-identical afterwards.
- **AC-5.** A folder with no `.minspec/`: answering any prompt creates no file or directory.
- **AC-6.** A fresh clone on the same machine/workspace id still has the answer; a different
  machine does not (documented limitation, not a defect).
- **AC-7.** Source-scan test: no auto-bootstrap code path calls `savePreferences` with a prompt-answer
  key.

## Invariants the change must not break

- **INV-1 (constitution 1, offline).** No network call; `workspaceState` is local.
- **INV-2 (constitution 3, blast radius).** Nothing is written outside the project's own scope.
  `workspaceState` is per-workspace, not machine-wide; `globalState` would be machine-wide and is
  excluded here (see Decisions).
- **INV-3.** `answeredSignatures` stays keyed by the unique `skipPrefKey`, never `kind`, so the three
  `kind: 'backfill'` steps never cross-suppress (#883), and merge-not-replace semantics are kept.
- **INV-4 (constitution 2, no silent gate).** Migration failure (unparseable file) is visible in the
  output channel and falls back to "prompts return", not to silently dropping a forever-skip.
- **INV-5.** `DR-078` consents and `invariant3-project-local-prefs.test.ts` still pass unchanged.

## Decisions needed (Clarify)

1. **Does this contradict DR-078, and what do we do about it?** DR-078 §1 names
   `.minspec/preferences.json` the ONE place MinSpec persists a preference; this spec moves a class of
   preference out.
   - **A (rec): amend DR-078 with a dated note** splitting *consents* (stay project-file) from *UI
     dismissals* (workspaceState). Cost: a second persistence store to explain; DR-078's "one place"
     headline stops being literally true.
   - **B: supersede with a new DR.** Cleaner trail; cost: DR-number allocation and review for what is
     a narrow carve-out.
   - **C: keep the file, add a tracked-file detector** (warn/untrack when `preferences.json` is
     tracked). Cost: leaves the `git clean -x` / fresh-clone loss in place, i.e. fixes only the case
     that already has a gitignore gate.

   **Recorded selection: the recommended option,** A, amend DR-078 with a dated note splitting consents (stay project-file) from UI dismissals (workspaceState). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
2. **`workspaceState` vs `globalState`.** The issue title says globalState, its body says
   workspaceState. **Rec: `workspaceState`** (per-workspace, matches the constitution-nudge pattern,
   respects invariant 3). Cost: the answer is re-asked once per distinct workspace/clone location,
   which is the very annoyance for a user with many worktrees (each worktree path is a separate
   workspace). `globalState` keyed by remote URL would fix that but is machine-wide state.
   **Recorded selection: the recommended option,** `workspaceState`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
3. **Which keys move?** Rec: only the prompt dismissals (FR-1). Cost: `autoClassifyOnCommit` — the
   *"Always classify"* answer — stays in the file and is still lost on `git clean -x`. Moving it too
   widens scope into DR-078 consent territory (its guard reads it ahead of the VS Code setting).
   **Recorded selection: the recommended option,** only the prompt dismissals (FR-1) move. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
4. **Migration cleanup.** Rec: leave old keys in the file (FR-5). Cost: stale data lingers; deleting
   it is a write MinSpec makes into a file the user may track.
   **Recorded selection: the recommended option,** leave old keys in the file (FR-5). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
