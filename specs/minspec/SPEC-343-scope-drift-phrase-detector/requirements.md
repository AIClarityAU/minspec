---
id: SPEC-343
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - FR-7 Session Enforcer lives here; this extends it with phrase detection
aspects: [session-discipline, scope-drift, status-bar, codelens, config, tier-0, nagging]
relates_to: [SPEC-001, DR-004, DR-050, DR-066, DR-074, "#15"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-343: Phrase-based scope-drift detector (status bar + CodeLens)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#15](https://github.com/AIClarityAU/minspec/issues/15)** - *"ship
scope-drift detector as a first-class MinSpec command."* The issue was parked from a
session whose own scope had drifted, and proposes productizing the text-trigger
detection that today exists only as local, repo-specific plumbing
(`scripts/hooks/scope-check.sh`) and CLAUDE.md prose (Triage Rule 2), so that any team
using the extension — not just this monorepo's Claude Code sessions — gets the same
guardrail.

**Id note.** Originally drafted as `SPEC-097`, which collided with the approved
watcher-config-source spec; renumbered to `SPEC-343` (`SPEC-342` was the highest id on
`origin/main` at renumbering, 2026-11-16). If the id collides at review time, renumber.

## One-Sentence Scope

Add a second, phrase-based scope-drift detector — a status-bar indicator plus a
`minspec.checkScopeDrift` command and a configurable trigger-phrase list — that watches
text the user is actually exposed to inside VS Code (the active text editor; **not** an
AI chat panel, per DQ-1) and, on a match, offers the same Park / Add-to-Scope choice the
existing file-path drift warning already offers, without blocking or auto-filing
anything.

## Context - what exists today (read from this worktree, not inferred)

### FR-7 "Session Enforcer" already ships a file-path drift detector

`specs/minspec/requirements.md` FR-7 ("Session Discipline") is `status: implementing`
at the product level, and its three line items are checked done in
`specs/minspec/tasks.md:137-139`. The code backs that up:

- **Session state** persists in `.minspec/session.json` via `saveSession`/`loadSession`
  (`packages/minspec/src/lib/session.ts:22-73`), with a `fileAllowlist` field
  (`:14`, `:90-122`) — a list of relative paths/directories, not text patterns.
- **The command** `MinSpec: Declare Session Scope` (`packages/minspec/package.json:113`,
  registered `packages/minspec/src/extension.ts:437`) asks scope/project/type and an
  initial file allowlist (`packages/minspec/src/commands/session.ts`).
- **The detector** is `handleFileSaveDriftCheck` (`packages/minspec/src/extension.ts:1074-1089`):
  on every text-document save, it loads the session and calls `isFileInScope`
  (`session.ts:90-122`) against the **saved file's path**. A path outside the allowlist
  calls `showDriftWarning`.
- **The warning** (`extension.ts:1112-1157`) is a one-shot `vscode.window.showWarningMessage`
  with three choices — **Park as Issue**, **Add to Scope**, **Dismiss** — already wired to
  `createParkingLotEntry` / `parkTopic` (`lib/parking-lot.ts`) and `addToScope` /
  `saveSession` (`lib/session.ts`). No status-bar item or CodeLens is involved; the
  warning does not persist once dismissed.

So the parking-lot UX the issue asks for ("Park as issue?") is not new — it already
exists for one trigger (file path). What does not exist for any trigger today is a
**persistent indicator** (issue: "status-bar item flips to a warning state") or a
**CodeLens / inline suggestion**, and no trigger today looks at **text content** rather
than a file path.

### Phrase-based detection already exists, but only outside the extension

`scripts/hooks/scope-check.sh` (34-65) is a Claude-Code `UserPromptSubmit` hook: it
reads the prompt JSON envelope from stdin, lower-cases it, and greps it against a fixed
bash array of extended-regex fragments (`integrate with`, `also support`, `expand to`,
`extend to`, `make it work with`, `while you're at it`, `+ any other`, `what other`,
etc. — `:37-50`), printing a non-blocking advisory line when one matches. It requires
`.claude/.session-scope` to exist (`:23-26`) and is installed per-repo through
`.claude/settings.json`'s hook registration (not part of the VS Code extension build).
CLAUDE.md's own Triage Rule 2 lists an overlapping but not identical phrase set. Neither
is read by, or shared with, `packages/minspec/src`. This spec's trigger list (FR-3)
should converge with these rather than inventing a third wording, but convergence is
prose synchronization across two repos-worth of surfaces (this repo's hook, this repo's
CLAUDE.md, and the extension's new default), which this spec treats as a one-time seed,
not an ongoing sync mechanism (Out of Scope).

### The issue's proposed input source does not exist as a readable surface

The issue asks the detector to watch "the active editor / chat input (where exposed via
APIs)". VS Code's public extension API (`vscode` namespace, checked against the
`@types/vscode` surface this package already depends on,
`packages/minspec/package.json` `engines.vscode`) exposes the content of **text
editors and documents** (`workspace.onDidChangeTextDocument`,
`window.activeTextEditor`) and lets an extension **host its own** chat participant
(`vscode.chat.createChatParticipant`), but exposes no API to **read the input box or
transcript of another extension's chat UI**, GitHub Copilot Chat's panel, or a
terminal-hosted CLI agent (which is how Claude Code itself runs — a terminal process,
not a VS Code chat participant). `scope-check.sh` works today only because Claude Code's
own harness pipes prompt text to a hook it controls; nothing in that pipe is reachable
from inside a VS Code extension process. This is a hard platform constraint, not a
missing permission, so it is not a thing Plan can design around — it bounds what FR-3
can watch (DQ-1).

## Functional Requirements

- **FR-1 - A second detector, additive to FR-7's.** This feature MUST be a new,
  independent check and MUST NOT replace, narrow, or change the behaviour of the
  existing file-path drift detector (`handleFileSaveDriftCheck`,
  `extension.ts:1074-1089`) or its warning (`:1112-1157`). Both can fire independently
  for the same save.

- **FR-2 - `minspec.checkScopeDrift` command.** A command, contributed and registered
  the way other MinSpec commands are (`package.json` `contributes.commands`,
  registered in `extension.ts`), that runs the phrase scan (FR-3) against the current
  active text editor's full document text on demand (a manual run rescans everything, but
  still omits matches the user has already dismissed, per FR-5a) and reports the result the same way
  automatic detection does (FR-5). Running it with no active session (`loadSession`
  returns `null`) MUST say so and do nothing else — it MUST NOT prompt to declare one
  (constitution principle 4, no nagging).

- **FR-3 - Trigger-phrase scan.** The scan is a pure function
  `scanForDrift(text: string, triggers: readonly string[]): DriftMatch[]`, where each
  `DriftMatch` is `{ phrase, line, lineText }` (`phrase` = the trigger entry that
  matched, `line` = 1-based line number, `lineText` = that line, trimmed). It lower-cases
  `text`, matches each trigger case-insensitively, skips input shorter than the same
  minimum length `scope-check.sh:52-57` skips, and returns matches in document order with
  no duplicates per (phrase, line). It does no I/O, reads no setting, and never throws on
  an invalid trigger (FR-4a): the caller supplies the already-validated list. Matching
  shape (substring or simple regex fragment, case-insensitive, short-input skip) is the
  one `scope-check.sh:52-57` already validates, not new semantics. The automatic path
  runs it at least once beyond the manual command (DQ-2 decides where/when) and, per
  FR-5a, only ever *reports* matches that are new or changed.

- **FR-4 - Configurable triggers, seeded from the existing lists.** `minspec.scopeDrift.triggers`
  (array of string, default seeded from the union of `scope-check.sh:38-50` and
  CLAUDE.md Triage Rule 2's verb list, deduplicated) lets a user add or remove phrases,
  following the existing settings style (`minspec.ruleset.requiredChecks`,
  `package.json:543-549`, is the closest precedent: array of string, empty-safe,
  described as additive). A `minspec.scopeDrift.enabled` boolean (default `true`,
  following `minspec.autoBootstrap.enabled`'s shape, `package.json:466-470`) turns the
  automatic path off without removing the manual command.

- **FR-4a - Trigger entry semantics and failure handling.** Each
  `minspec.scopeDrift.triggers` entry is an **extended-regex fragment**, matched
  case-insensitively, exactly as `scope-check.sh` treats its array entries (a plain
  phrase such as `also support` is a valid fragment that matches itself; the seeded
  defaults include fragments like `include .{1,40} too` and `\+ any other`). Entries are
  compiled once per settings change, not per scan. An entry that fails to compile is
  **skipped and named in an explicit error state**: the status-bar item shows an error
  indicator whose tooltip lists the bad entry (INV-2), valid entries keep working, and no
  exception escapes the save handler. Pathological patterns are bounded by a fixed
  per-scan input cap (the scan examines at most the first 200,000 characters of a
  document and says so in the tooltip when it truncates) and a maximum trigger length
  (500 characters; longer entries are rejected like uncompilable ones). Acceptance
  criteria below cover an invalid entry and an over-cap document.

- **FR-5 - Status-bar indicator.** A new status-bar item (added to
  `packages/minspec/src/views/status-bar.ts`, alongside `MinSpecNextTaskStatusBar` /
  `MinSpecScaffoldCommitStatusBar` / `MinSpecTidyPrimaryStatusBar`, `:112`, `:172`, `:230`)
  shows a neutral state when no trigger has fired since the session was declared (or
  no session is active) and a warning state after a match, with the matched phrase(s)
  in its tooltip. Clicking it offers the same three choices FR-7's warning already
  offers — Park as Issue / Add to Scope / Dismiss — reusing `createParkingLotEntry` /
  `parkTopic` / `addToScope` / `saveSession` exactly as `showDriftWarning`
  (`extension.ts:1112-1157`) does, so the two detectors share one resolution path. The
  indicator MUST clear back to neutral on Dismiss, Add to Scope, or declaring a new
  session, and MUST persist its last-known state across a VS Code window reload for the
  same session. `SessionState` (`packages/minspec/src/lib/session.ts:8` onward) has **no
  field for this today**, so persisting it means **adding one optional field,
  `scopeDrift`, to the `.minspec/session.json` schema** (shape in FR-5a), with
  back-compat: `loadSession` of an older file lacking the field MUST behave as an empty
  `scopeDrift`, and `saveSession` MUST NOT drop it. It is the same file, so no new store
  appears outside the opted-in folder's `.minspec/` (constitution invariant 3).

- **FR-5a - New text only; a dismissed match never returns.** The automatic scan MUST NOT
  re-raise a match the user has already resolved. `scopeDrift` in session.json holds
  `{ active: DriftMatch[], dismissed: string[] }`, where each `dismissed` entry is a
  stable key of the match, `sha256(phrase + "\n" + normalized lineText)` (lower-cased,
  whitespace-collapsed, **not** the line number, so unrelated edits above it do not
  resurrect it). On each automatic scan the full document is scanned, then every match
  whose key is in `dismissed` is dropped; the indicator turns to warning only if at least
  one match remains. Dismiss and Add to Scope append the keys of all `active` matches to
  `dismissed` and clear `active`; declaring a new session resets both lists. Edit that
  changes a matched line's text yields a new key and may raise again; re-saving unchanged
  text never does (INV-4). The manual command applies the same filter.

- **FR-6 - CodeLens suggestion.** When a trigger has fired for the document currently
  shown in an editor, a CodeLens line above the match (via a provider registered the
  way `MinSpecCodeLensProvider` is, `codelens-provider.ts:34`, `extension.ts:356-357`)
  reads "MinSpec: possible scope drift — Park as issue?" and runs the same resolution
  command FR-5's click runs. It is additive to, not a replacement for, the status-bar
  item (someone who never opens the matching file still sees the status bar).

- **FR-7 - No new network path.** Nothing here calls `gh` except through the existing,
  already-consented `parkTopic` path a user reaches by clicking Park as Issue — the
  same one the file-path detector already uses. No autonomous network call is added
  (constitution invariant 1, DR-050).

- **FR-8 - Advisory only, never a gate.** Matching a trigger MUST NOT block a save, an
  edit, a command, or any CI/merge-gating check — this is a UI nag surface only, with no
  required-check counterpart. (constitution principle 4; this also means invariant 2's
  "no silent gate" does not apply here, because nothing here is a gate.)

## Acceptance Criteria

- [ ] With an active session and `minspec.scopeDrift.enabled` at its default, typing (or
      pasting) a sentence containing a configured trigger phrase into the active editor,
      per DQ-2's chosen moment, flips the status-bar item to its warning state with the
      matched phrase in the tooltip. (FR-3, FR-5)
- [ ] Clicking the status-bar item in its warning state offers Park as Issue / Add to
      Scope / Dismiss; each choice behaves identically to the existing file-path
      warning's choices and returns the indicator to neutral. (FR-5)
- [ ] A CodeLens reading "MinSpec: possible scope drift — Park as issue?" appears above
      the matched line in the open editor and triggers the same resolution. (FR-6)
- [ ] Running `MinSpec: Check Scope Drift` with the editor showing text that matches a
      trigger reports the match the same way; with no match, or no open editor, it says
      so and changes nothing. (FR-2)
- [ ] Running it with no active session declared says so and does not prompt to declare
      one. (FR-2)
- [ ] Setting `minspec.scopeDrift.enabled` to `false` stops the automatic scan; the
      manual command still works. (FR-4)
- [ ] Adding a phrase to `minspec.scopeDrift.triggers` makes a previously-unmatched
      sentence containing it match; removing a default phrase stops it matching. (FR-4)
- [ ] After Dismiss, saving the same unchanged file again leaves the indicator neutral;
      after Dismiss and a reload of the window, the same save still leaves it neutral;
      editing the matched line's text so it still matches raises it again. (FR-5a)
- [ ] A session.json written before this feature (no `scopeDrift` field) loads without
      error and behaves as an empty state; saving it back keeps any `scopeDrift` present.
      (FR-5)
- [ ] An uncompilable `minspec.scopeDrift.triggers` entry shows the error indicator
      naming that entry, other entries still match, and the save is not interrupted; a
      document over the scan cap is scanned up to the cap and the tooltip says so.
      (FR-4a)
- [ ] The existing file-path drift warning (saving a file outside the session's
      `fileAllowlist`) still fires exactly as before, independent of this feature's
      state. (FR-1)
- [ ] No `gh` process, and no other new network-reaching call, runs before the user
      clicks Park as Issue. (FR-7)
- [ ] No match ever blocks a keystroke, a save, a command, or shows as a required/CI
      check result. (FR-8)

## Invariants (must not break)

- **INV-1 - Offline core, consent before network (constitution invariant 1, DR-004,
  DR-050).** No new socket, no new child-process allowlist entry, no autonomous `gh`
  call. The only network path is the existing, user-clicked Park as Issue flow.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** Does not apply in the
  sense of "this feature must not hide a gate failure" because this feature gates
  nothing (FR-8); it does apply in the sense that the status-bar item must never claim
  "neutral" while a scan actually errored — an exception inside the scan MUST surface as
  an explicit error state, not a silently-cleared neutral one.
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** No new file outside
  `.minspec/` of an opted-in folder; indicator state is persisted in a new
  optional `scopeDrift` field of `.minspec/session.json` (FR-5, FR-5a), not stored
  separately. No machine-wide or org-wide write.
- **INV-4 - No nagging (constitution principle 4).** No modal, no toast that reappears
  on every keystroke. The status bar and CodeLens are both passive, dismissible
  surfaces the user looks at when they choose to; neither interrupts typing. A match the user already
  dismissed is never re-raised by a later scan of unchanged text (FR-5a).
- **INV-5 - FR-7 (file-path drift) is unaffected.** See FR-1 and its acceptance
  criterion.

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost, as this repo's convention
requires. The requirements above are written under the recommended option; approving
this spec accepts them.

### DQ-1 - What text does the detector watch, given VS Code exposes no chat-input API?

The issue's own wording hedges this ("where exposed via APIs"), and the Context section
above found no such API for an externally-hosted chat panel or a terminal-run CLI agent
like Claude Code.

- **Option A - active text editor documents only (rec).** `workspace.onDidChangeTextDocument`
  / `window.activeTextEditor`, the same surface the existing CodeLens provider and
  file-save detector already read. *Cost:* this detector never sees a prompt typed into
  Claude Code's own terminal session, Copilot Chat, or any other out-of-process
  assistant — exactly the case that parked issue #15 itself. For that case,
  `scripts/hooks/scope-check.sh` remains the only working detector, and stays
  repo-local plumbing rather than becoming a shipped MinSpec capability (the issue's
  stated goal only partly achieved).
- **Option B - also author a `vscode.chat` participant so MinSpec's own chat surface
  can watch its own input.** *Cost:* only catches a conversation routed through
  MinSpec's own participant, not Claude Code (terminal-based), not Copilot Chat, not
  Cursor — i.e. it still misses the motivating case, for a materially larger build (a
  new chat participant, its own activation surface, and upkeep as the chat API
  evolves).
- **Option C - hold this spec until VS Code or the relevant agent exposes a read API for
  third-party chat input.** *Cost:* indefinite; no such API is known to exist or be
  planned, and the already-working bash-hook path (outside this extension) would sit
  idle in the meantime for no gain.

### DQ-2 - When does the automatic scan run?

- **Option A - on save, alongside the existing file-path check (rec).** Reuses
  `handleFileSaveDriftCheck`'s call site (`extension.ts:1074` onward) as the hook point;
  one listener, two independent checks. *Cost:* misses drift visible only in unsaved
  text (a long comment or TODO typed but not yet saved).
- **Option B - on every text change (`onDidChangeTextDocument`), debounced.** *Cost:* a
  debounce window and its tuning become a new surface to get wrong (too eager reads as
  nagging — INV-4 — too lazy reads as broken), and running a regex scan on a large file
  on every keystroke is the kind of per-keystroke cost constitution constraint 3
  ("activation stays cheap") warns against generalising.
- **Option C - manual command only (FR-2), no automatic path.** *Cost:* the issue
  explicitly asks for an ambient status-bar indicator and inline CodeLens, which needs
  *something* automatic to feed it; Option C would ship only half the issue (FR-2, none
  of FR-5/FR-6's automatic trigger) unless the human prefers a smaller first cut.

### DQ-3 - Trigger-list ownership: one canonical list, or three independently maintained copies?

Today there are already two near-duplicate phrase lists (`scope-check.sh:38-50`,
CLAUDE.md Triage Rule 2). This spec adds a third (`minspec.scopeDrift.triggers`'
default).

- **Option A - seed once from the union, let the three drift independently afterwards
  (rec).** Matches this repo's own stated position that MinSpec's VS Code surface and
  this monorepo's Claude-Code-specific hook are different products at different tiers
  (CLAUDE.md "Agent Dispatch" section: dispatch is dev-time plumbing for *this*
  monorepo, not something MinSpec ships). *Cost:* three lists that can say different
  things about what counts as scope drift, with no enforcement tying them together —
  exactly the "prose rule, not a gate" pattern constitution principle 8 warns about,
  accepted here because the three lists serve three different audiences (this
  monorepo's Claude Code sessions, this monorepo's CLAUDE.md readers, and every
  adopting team's VS Code setting).
- **Option B - make `@aiclarity/shared` the single source and have `scope-check.sh`
  read it.** *Cost:* `@aiclarity/shared` is Tier-0 and must not import `vscode` or do
  network (constitution constraint 1); a bash script reading a TypeScript module's
  exported array needs a build step or a generated JSON artifact, which is new
  machinery for a list of a dozen strings, and ties this monorepo's dev-time hook to
  the extension's release cadence.

## Clarify selections (recorded by an agent 2026-10-02, ratified only by approval of this spec)

Recorded without a live conversation. Each is the option marked **(rec)** above; the
requirements are written under these selections, so approving this spec ratifies them and
changing one means editing the named requirements first.

- **DQ-1:** Option A, active text editor documents only. (FR-2, FR-3)
- **DQ-2:** Option A, scan on save beside the existing file-path check. (FR-3, FR-5a)
- **DQ-3:** Option A, seed once from the union and let the three lists drift. (FR-4)

## Why no new DR

The recommended options (DQ-1 Option A, DQ-2 Option A, DQ-3 Option A) add one new
config surface and two new passive UI elements, reuse the existing consent path for
network access (Park as Issue, already covered by DR-050), and store no new state
outside `.minspec/session.json`. Under the reversibility filter (can it be undone in
under a day), removing the command, the status-bar item, and the two settings is a
revertable diff with no migration. A decision record becomes necessary only if Plan
later chooses DQ-1 Option B (a chat participant) or DQ-2 Option B (a live-typing scan),
because either widens the surface this spec deliberately keeps narrow; neither is the
recommended path, so none is written here.

## Out of Scope

- **Reading chat/agent input that is not a VS Code text editor.** DQ-1. Tracked as the
  reason `scripts/hooks/scope-check.sh` stays necessary; no new issue filed because the
  constraint is a platform limit, not a missing feature to build.
- **Auto-blocking or auto-filing.** The issue's own "Out of scope" already excludes
  auto-blocking; this spec adds that no trigger auto-files an issue without the user
  clicking Park as Issue (FR-7, FR-8).
- **Cross-IDE ports (Cursor, Codium).** The issue defers this; nothing here is
  VS-Code-API-specific enough to block it later, but no work is done for it now.
- **A single canonical trigger-list source shared by the bash hook, CLAUDE.md, and the
  extension setting.** DQ-3 Option B, deferred.
- **Telemetry of any kind.** Not proposed by the issue or this spec; INV-1 already
  forbids it structurally (no new network path).

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Folding this into FR-7 / SPEC-001 directly instead of a new spec.** Rejected:
  FR-7 is `status: implementing` with its listed items already shipped and checked off
  (`tasks.md:137-139`); reopening it to add an unrelated input source (text content
  versus file path) and two new UI surfaces would mix a shipped, closed item with new,
  unapproved scope in one hash-locked document.
- **Making the detector read VS Code's chat panel content directly, as the issue's
  prose suggests, without flagging the API gap.** Rejected: no such API exists today;
  specifying it as if it did would produce acceptance criteria Plan could not implement,
  the exact "artifact-existence ≠ feature-existence" failure this repo's evidence
  discipline exists to catch.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** a scan-matching unit test against the seeded default
  trigger list and a custom list (FR-3, FR-4); a status-bar state-transition test
  (neutral → warning → neutral via each of the three choices, FR-5); a CodeLens-provider
  test asserting the lens appears only on a matched line (FR-6).
- **Regression:** the existing file-path drift tests (`handleFileSaveDriftCheck`,
  `showDriftWarning` and their test file) MUST still pass unmodified, proving FR-1.
- **Not vacuous:** a mutant that removes the trigger-list lower-casing, and one that
  removes the `fileAllowlist`-vs-phrase-scan independence, each shown to turn a test red.

## Traceability

- **Issue:** [#15](https://github.com/AIClarityAU/minspec/issues/15).
- **Builds on:** `specs/minspec/requirements.md` FR-7 (Session Discipline, file-path
  drift — unaffected, see FR-1), itself part of `SPEC-001`.
- **Local precedent this productizes:** `scripts/hooks/scope-check.sh` (phrase list and
  matching shape), CLAUDE.md Triage Rule 2 (the verb list prose already names).
- **Governing decisions:** [DR-004](../../../docs/decisions/DR-004.md) (tiered network
  consent), [DR-050](../../../docs/decisions/DR-050.md) (gh shelling on explicit
  consent), [DR-066](../../../docs/decisions/DR-066.md) (no silent gate — scoped here to
  INV-2's narrower reading, since this feature is not itself a gate),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius / `.minspec/` as the only
  store).
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition that
  would require it.
