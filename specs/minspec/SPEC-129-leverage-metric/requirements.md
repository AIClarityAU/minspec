---
id: SPEC-129
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the epic that already carries the trust-measurement layer (SPEC-017 trust dashboard, DR-042 outcome-before-engagement); this is a sibling measurement, not a new theme
goal: G-3
aspects: [measurement, human-telemetry, consent, opt-in, tier-0, offline, proxy-trap, accessibility]
relates_to: [DR-042, DR-078, DR-074, DR-004, DR-075, DR-066, DR-086, SPEC-017, SPEC-018, SPEC-038, SPEC-086, SPEC-096, "#219", "#301"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3; this
# repo runs `ownershipDeclaration: error`, `.minspec/config.json`). All files are NEW and are
# needed under every answer in "Decisions needed (Clarify)". The names are a proposal: if
# Plan prefers others, rename here BEFORE approval, because renaming afterwards edits the
# bytes the approval hash covers.
implements: [packages/shared/src/leverage.ts, packages/shared/tests/leverage.test.ts, packages/minspec/src/lib/leverage-recorder.ts, packages/minspec/src/lib/leverage-output.ts, packages/minspec/src/commands/leverage.ts, packages/minspec/tests/leverage-recorder.test.ts, packages/minspec/tests/leverage-consent-invariant.test.ts]
# Modified, not owned: the command and status-bar registration, the manifest, the listing,
# and the two inventory tests that must learn about the new module (the spawn allowlist at
# `packages/minspec/tests/invariants.test.ts:134`, and the directory-creation inventory
# SPEC-096 FR-9 specifies).
affects: [packages/minspec/src/extension.ts, packages/minspec/src/views/status-bar.ts, packages/minspec/src/lib/preferences.ts, packages/minspec/package.json, packages/minspec/README.md, packages/minspec/CHANGELOG.md, packages/minspec/tests/invariants.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-129: Leverage metric - output per observed human hour, per artifact (opt-in)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> decision names.

Materializes **[#219](https://github.com/AIClarityAU/minspec/issues/219)** - *"output-per-human-hour
leverage metric, per-artifact (issue/DR/SPEC/EPIC) - opt-in"*.

**Id note.** Every spec number up to 128 is claimed, most of the recent ones by branches
that have not merged. Checked on 2026-10-03 across every local
and remote-tracking ref in this clone and the `specs/` directory of every local worktree;
open pull requests on the forge were not checked, because this dispatch has no network. If
the id collides at review time, renumber.

**Tier note.** Triage placed this at T3 or T4. The change is one new shared module, three
new extension modules, three new test files and seven modified files, with no schema
migration and no change to an existing store, so T3 (full spec cycle). The predicted tier
is an upward-only floor; Plan may raise it.

## One-Sentence Scope

When a developer turns it on for a project, MinSpec records how long the editor window was
in active use, per day and per artifact, as content-free totals in a self-ignored local
directory, and a palette command shows lines shipped per observed active hour for each
issue, spec, epic and decision record - never as a verdict, never with a cost figure, never
over the network, and with nothing recorded while it is off.

## Context

### What the issue asks, and what has changed since it was filed

The issue asks for a leverage figure - output shipped per hour of human activity, broken
down by issue, decision record, spec and epic - tracked in the background, off by default,
opt-in and auditable, forward-only, and kept apart from any cost figure.

Two things in the issue's framing no longer hold, and the spec is written against the
current state:

- **The Scrooge argument is retired.** The founder's original note wanted a figure that
  would make "a compelling argument to add scrooge". Portfolio monetization is closed and
  ScroogeLLM is shelved as a product ([DR-075](../../../docs/decisions/DR-075.md) decisions
  1 to 3), and goal G-5 (top of funnel into Scrooge) is retired
  (`.minspec/constitution.md:42-46`). What remains is the reason the issue itself gives:
  goal G-3 (just enough human, `.minspec/constitution.md:36-38`), and the human-side arm of
  the tuning study that DR-042 (outcome metrics before engagement) decision 5 requires and
  tracks as #301.
- **The cross-repo attribution hook has no sender here.** The issue proposes reusing
  `X-Scrooge-Tag`. In this repository that string appears only in two decision records
  (`docs/decisions/DR-048.md:81`, `docs/decisions/DR-049.md:93`); no source file sends it,
  and the ScroogeLLM bridge module is gone (`packages/minspec/src/lib/bridge.ts` does not
  exist at `350c6fa4`; SPEC-086, remove the ScroogeLLM upsell, deleted it). The two issue
  numbers the issue cites for it (minspec #145, scroogellm #26) were not read: no network.

### What already exists, read at `350c6fa4`

- **No human-activity capture of any kind.** The extension listens to active-editor
  changes for navigation memory (`packages/minspec/src/extension.ts:75`,
  `packages/minspec/src/lib/active-spec.ts:156`, `active-adr.ts:64`), to window focus only
  to refresh trees (`extension.ts:236-245`), and to document changes only for diagnostics
  (`packages/minspec/src/lib/diagnostics.ts:239`). A search of `packages/minspec/src` for
  `onDidChangeTextEditorSelection` and `onDidChangeTextEditorVisibleRanges` finds nothing.
- **A reserved, unwritten timing field.** `ApprovalRecord.reviewStart` is declared and
  marked reserved for SPEC-017's third signal, time-to-approve
  (`packages/minspec/src/lib/approval.ts:58`, `:69`, `:603`). SPEC-017's own frontmatter
  records that signal as not built
  (`specs/minspec/SPEC-017-trust-dashboard/requirements.md:19-24`).
- **The outcome metric this must sit beside is built.** Rework percentage is computed by
  `computeSpecRework` (`packages/minspec/src/lib/trust-metrics.ts:45`). DR-042's ordering
  rule - no engagement capture before the rework metric exists - is therefore met.
- **The opt-in rule and the one directory operation.** `hasOptInMarker`, `assertOptedIn`
  and `ensureDirectory` live in `packages/minspec/src/lib/opt-in.ts` (`:57`, `:107`,
  `:162`); `ensureDirectory` cannot create `.minspec/` (SPEC-096, only Initialize creates
  the opt-in marker, FR-2).
- **The one store MinSpec itself may write a preference to** is `.minspec/preferences.json`
  ([DR-078](../../../docs/decisions/DR-078.md) decision 1;
  `packages/minspec/src/lib/preferences.ts:5-12`), gitignored by the scaffold
  (`packages/minspec/src/lib/scaffold.ts:276-298`).
- **A window-level activity signal exists in the editor API.** `WindowState` carries
  `focused` and `active`, the second documented as "Whether the window has been interacted
  with recently. This will change immediately on activity, or after a short time of user
  inactivity" (read in `@types/vscode` 1.120.0, `index.d.ts`, `interface WindowState`). The
  extension's engine floor is `^1.90.0` (`packages/minspec/package.json:25`). I believe
  `active` is present at that floor, **unverified** - Plan must confirm against the 1.90
  typings before relying on it (FR-3).
- **Three status-bar items exist**, all left-aligned at priorities 97 to 99
  (`packages/minspec/src/views/status-bar.ts:105-229`).

### What is already decided and binds this spec

- **DR-042 decision 4:** "No standalone engagement verdict" is a Tier-0 invariant; time is
  displayed only paired with the rework outcome. SPEC-017 FR-9 and its invariant *Outcome
  over proxy* encode the same rule. DQ-1 below exists because a leverage ratio shows time
  beside *output*, which that sentence did not anticipate.
- **DR-042 decision 3:** no global interception of file opens. This spec intercepts
  nothing; it reads one boolean the editor already publishes.
- **SPEC-017 FR-8:** recording time about the human is opt-in, visible in the UI, and
  content-free - "never text, never keystrokes".
- **SPEC-004's lesson, restated in SPEC-017 "The proxy trap":** a size measure that looks
  rigorous is not a difficulty or value measure. Lines changed is a size measure. The
  report says so on its face (FR-12).

### What cannot be measured, stated before the requirements rely on it

The extension sees one editor window. It does not see time spent in a browser on the
forge, in a terminal outside the editor, on another machine, or thinking away from the
keyboard. The recorded time is therefore a **lower bound** on human time, and any ratio
built on it is an **upper bound** on leverage. Every surface in this spec calls the
denominator "observed active hours", never "human hours", and the report says which way
the error runs (FR-12).

## Functional Requirements

"The folder" is a workspace folder that has opted in to MinSpec (`hasOptInMarker` is true).
"Recording" is the capture of FR-3 to FR-6. "An artifact" is a spec, a decision record or
an epic. Names of commands, files and fields are proposals for Plan unless a requirement
says a name MUST appear.

### Consent

- **FR-1 - Off by default, on only by the developer's own act, per folder.** Recording is
  off in every folder until the developer runs **MinSpec: Turn Leverage Recording On** for
  that folder (DQ-3). The command MUST, before turning anything on, show what will be
  recorded (FR-5), where it is kept (FR-6), what is never recorded (FR-4), and how to turn
  it off and delete it (FR-9), and MUST turn recording on only on an explicit confirmation.
  The consent is stored in `.minspec/preferences.json` and nowhere else. It MUST NOT be
  readable from a committed file, a workspace setting or a machine-wide setting, so one
  developer's choice is never imposed on another (DR-078 decisions 1 and 2), and in a
  folder that has not opted in the command shows the refusal SPEC-096 FR-8 specifies and
  writes nothing.

- **FR-2 - Never offered, never nagged.** Nothing offers recording: no toast at
  activation, no step in the setup prompt, no walkthrough step, no prompt after any other
  command. The only route in is the palette command of FR-1. (Constitution principle 4;
  the issue's "not surfaced prominently".)

### Capture

- **FR-3 - The signal is the window's own activity state.** While recording is on, the
  folder accrues time only while the editor window is both focused and active, as the
  editor reports through its window state (DQ-2). The recorder MUST NOT register a listener
  on text-selection changes, visible-range changes, document changes, typing, or any
  per-keystroke or per-scroll event, and MUST NOT count events of any kind. If the running
  editor does not provide the activity field, turning recording on MUST fail with a message
  saying so; it MUST NOT fall back to focus alone, which would count a focused window left
  open over lunch.

- **FR-4 - What is never recorded.** No text, no file name or path, no keystroke, cursor
  position, scroll position or selection, no event count, no clock time finer than the day
  (DQ-4), no branch name, no identity of the developer, and nothing about any folder other
  than the one being recorded.

- **FR-5 - What is recorded.** Per UTC day, a total of active seconds for each attribution
  key that was current while time accrued, plus the dates recording was turned on and off.
  An attribution key is at most one artifact id and at most one issue number, resolved at
  the moment of capture and stored as ids only:
  - **Artifact.** When the active editor shows a file belonging to a spec (any file in the
    spec's own folder, or a path the spec lists under `implements:`), a decision record
    file, or an epic file, the artifact id is that spec, decision record or epic. A path
    that two specs both claim, or that resolves to nothing, yields no artifact id.
  - **Issue.** When the checkout's current branch name carries an issue number in the one
    pattern this spec fixes (DQ-7), the issue number is that number; otherwise none.
  - **Neither.** Time with no artifact and no issue accrues to an explicit *unattributed*
    key. It is kept, not dropped: the report's total must add up.

  The two dimensions are independent. A day's total per dimension never exceeds the day's
  overall total, and totals are never summed across dimensions.

- **FR-6 - Where it is kept.** Under `.minspec/leverage/` in the folder (DQ-5), created
  through `ensureDirectory` (so it can never create `.minspec/`, SPEC-096 FR-2). The
  directory MUST ignore itself: the recorder writes a `.gitignore` inside it that excludes
  everything in it, and MUST refuse to write a total if that file is missing or has been
  changed, saying so once. This makes "never committed" hold in a project initialized
  before this feature existed, without depending on Refresh Harness Files having rewritten
  the root `.gitignore`. The files are plain JSON a person can read, and each carries a
  first field stating in words what the file is and that MinSpec never transmits it.

- **FR-7 - Several windows, one human.** Only a focused window accrues, so one hour at the
  keyboard is never recorded twice. Two windows open on the same folder MUST NOT lose each
  other's totals: no window rewrites a file another window writes. A crash or a killed
  window may lose at most the time since the last flush, and the flush period MUST be
  stated in the consent text. A multi-root window records each folder separately and only
  folders where recording is on; time with no active editor in a multi-root window is not
  recorded, because it cannot be assigned to a folder.

- **FR-8 - Off means absent.** With recording off in every open folder the feature
  registers no listener and no timer, creates no file and no directory, and reads nothing
  from `.minspec/leverage/`. Activation does no work for this feature beyond reading the
  preference it already reads (constitution constraint 3). Turning recording off stops
  accrual at once, flushes what was accrued, and removes the indicator of FR-10.

### Audit and control

- **FR-9 - The developer can see and delete everything.** Three palette commands, each
  available whether recording is on or off: **MinSpec: Turn Leverage Recording Off**;
  **MinSpec: Open Leverage Data**, which reveals the stored files themselves, not a
  rendering of them; and **MinSpec: Delete Leverage Data**, which removes
  `.minspec/leverage/` for the folder after one confirmation and says what it removed.
  Deleting does not turn recording off, and the message says whether it is still on.

- **FR-10 - A visible indicator while recording.** Whenever the focused window has a
  folder with recording on, a status-bar item says so in words, and it is absent
  otherwise. It shows no figure - not time, not a ratio, not a count. Activating it offers
  the commands of FR-9 and FR-11. If a write fails, the item changes to say recording is
  failing and why, and stays that way until a write succeeds or recording is turned off:
  a recorder that silently stopped would make every later figure a lie (constitution
  invariant 2 in spirit; INV-5).

### The report

- **FR-11 - One on-demand report.** **MinSpec: Show Leverage Report** opens a read-only
  document. Nothing computes or displays the figures at any other time: not the status
  bar, not a tree view, not a badge, not the Trust Dashboard pane, not a file written into
  the repository. The report is computed when asked for, from the stored totals and from
  local git history, and it works with recording currently off as long as stored totals
  exist.

- **FR-12 - What the report says about itself.** Before any figure, in plain words: the
  period covered and the days within it on which recording was on; that the hours are
  *observed active hours in this editor window* and are a lower bound; that the ratio is
  therefore an upper bound; that "lines changed" is a measure of size, not of value or
  difficulty; and that nothing before the first day of recording is or can be included.
  The report MUST NOT contain the words "productivity" or "efficiency", a score, a grade,
  a target, a colour or icon that marks a row as good or bad, an ordering that ranks rows
  from worst, or any comparison between people.

- **FR-13 - Rows and columns.** One table per kind - issues, specs, epics, decision
  records - plus one overall line. Each row shows the artifact, observed active hours,
  lines changed (FR-14), the ratio where FR-15 allows one, and, for a spec that has a
  rework figure, that figure from `computeSpecRework` on the same row (DQ-1). An epic row
  is the sum of the rows of the specs whose `epic:` names it, plus time on the epic's own
  file. The unattributed time is its own row in each table, so each table's hours sum to
  the overall hours for that dimension.

- **FR-14 - Output is lines shipped, from local git only.** "Lines changed" is lines added
  plus lines deleted in commits reachable from the repository's default branch, dated on
  or after the first day of recording, counted by local `git` with no network access
  (DQ-6). Binary files count as zero.
  - A spec's lines are those in the paths its `implements:` lists. A spec with no
    `implements:` shows no output and no ratio, and says why.
  - An issue's lines are those of commits whose subject cites it in the form the
    repository's traceability convention uses (`feat(#N):`, `fix(#N):` and the like).
  - A decision record has no output measure. Its row shows hours only.
  - If the default branch cannot be determined offline, the report shows hours, shows no
    output and no ratio for any row, and says which lookup failed. It MUST NOT substitute
    the current branch without saying so.

- **FR-15 - No ratio from a denominator known to be incomplete.** A row shows a ratio only
  when recording was on for every day from the row's first counted commit to its last. A
  row whose work began before recording started, or spans a day recording was off, is
  marked *partial*, shows its hours and its lines, and shows no ratio. Hours of zero show
  no ratio. Raw hours and raw lines are always shown, so a reader can always see what a
  ratio was made from.

- **FR-16 - No backfill and no baseline.** Nothing estimates, imports or infers human time
  for any day before recording was first turned on, and the report offers no "before
  MinSpec" or "before recording" comparison, although git history would allow the output
  half of one. (The issue: forward-only, "no uninstall reason".)

- **FR-17 - No cost.** The feature and its report read, store and show no token count, no
  price, no model name and no figure from any cost tool, and no later change may add one
  to this report. Cost belongs to a separate measure (the issue: "Keep it SEPARATE from
  any cost metric"). The attribution keys use the ids the repository already uses
  (`SPEC-NNN`, `DR-NNN`, `EPIC-NNN`, `#N`), which is all a later join would need.

### Words and tests

- **FR-18 - The listing tells the truth.** `packages/minspec/README.md` MUST gain a short
  section stating what FR-4 and FR-5 state, that it is off by default, the four commands,
  and the lower-bound caveat. `packages/minspec/CHANGELOG.md` gains an entry. Neither may
  describe the feature as measuring productivity.

- **FR-19 - A pinning test for consent and absence.**
  `packages/minspec/tests/leverage-consent-invariant.test.ts` MUST show, on real temp
  folders and through the handlers `activate()` registers: with recording off, no
  listener or timer is registered for this feature and `.minspec/leverage/` does not exist
  after simulated activity; with no opt-in marker, the turn-on command refuses and creates
  nothing; a workspace or user setting cannot turn recording on; declining the
  confirmation records nothing; and it MUST scan the recorder's source for the event
  subscriptions FR-3 forbids and fail if one appears. Each case carries a control proving
  the recorder does write when it should, so a pass cannot come from a dead recorder.

- **FR-20 - Contract tests.** `packages/minspec/tests/leverage-recorder.test.ts` pins FR-3
  to FR-8 (accrual only while focused and active, the day boundary, the self-ignoring
  directory and the refusal when it is tampered with, two writers, the failing-write
  indicator state). `packages/shared/tests/leverage.test.ts` pins FR-13 to FR-16 on fixed
  inputs: the sums, the partial rule, the zero-hours rule, the unattributed row, and that
  no output of the report function contains a forbidden word or a ranking.

## Contract (cross-boundary shapes)

The pure model lives in `@aiclarity/shared` (no `vscode`, no network, no `fs` - constitution
constraint 1), as `rework.ts` and `trust-model.ts` do. The recorder and the git reader live
in the extension. Field names are a proposal; the properties in the comments are the
contract.

```ts
/** One stored file's content. One writer per file (FR-7). */
export interface LeverageDayFile {
  readonly about: string;            // plain words: what this is, that it is never transmitted (FR-6)
  readonly version: 1;
  readonly day: string;              // UTC calendar day, YYYY-MM-DD. Nothing finer (FR-4)
  readonly totals: readonly LeverageTotal[];
}

export interface LeverageTotal {
  readonly artifact?: string;        // 'SPEC-012' | 'DR-042' | 'EPIC-002'. An id, never a path (FR-4, FR-5)
  readonly issue?: number;           // from the branch pattern only (DQ-7)
  readonly activeSeconds: number;    // integer, >= 0. Both keys absent = unattributed
}

/** Recording switched on or off, by day. Lets the report apply FR-15. */
export interface LeverageCoverage {
  readonly on: readonly string[];    // UTC days with recording on for the whole or part of the day
  readonly firstDay: string | null;
}

export type LeverageRowKind = 'issue' | 'spec' | 'epic' | 'dr' | 'unattributed';

export interface LeverageRow {
  readonly kind: LeverageRowKind;
  readonly id: string;
  readonly activeSeconds: number;
  readonly linesChanged: number | null;   // null = no output measure for this row (FR-14)
  readonly partial: boolean;              // FR-15
  readonly ratioLinesPerHour: number | null; // null whenever partial, hours are zero, or lines are null
  readonly reworkPct: number | null;      // specs only, from computeSpecRework (FR-13)
  readonly note?: string;                 // why a value is absent, in words
}
```

## Acceptance Criteria

- [ ] In a freshly initialized folder, after an hour of simulated editor activity,
      `.minspec/leverage/` does not exist and no listener or timer for this feature is
      registered. (FR-1, FR-8, FR-19)
- [ ] Turning recording on shows the consent text and records nothing until confirmed;
      cancelling leaves the folder byte-identical. In a folder with no `.minspec/` the
      command refuses and creates nothing. (FR-1, FR-19)
- [ ] A committed `.vscode/settings.json` or a user setting cannot turn recording on.
      (FR-1, FR-19)
- [ ] With recording on, time accrues only while the window is focused and active; a
      focused window with no interaction stops accruing when the editor reports it
      inactive. (FR-3, FR-20)
- [ ] The recorder's source contains no subscription to selection, visible-range,
      document-change or typing events, and the pinning test fails when one is added.
      (FR-3, FR-19)
- [ ] A stored file contains only a day, artifact ids, issue numbers and second totals: no
      path, no text, no time of day. (FR-4, FR-5, FR-20)
- [ ] `git status` in the folder shows nothing under `.minspec/leverage/` in a project
      whose root `.gitignore` has no entry for it; removing the inner `.gitignore` makes
      the recorder refuse to write and the indicator say so. (FR-6, FR-10)
- [ ] Two windows on one folder each keep their totals. (FR-7, FR-20)
- [ ] The indicator is present exactly when the focused window has a recording folder,
      and shows no figure. (FR-10)
- [ ] Open Leverage Data reveals the stored files; Delete Leverage Data removes them and
      reports whether recording is still on. (FR-9)
- [ ] The report opens only from its command, states the lower-bound and size caveats
      before any figure, and contains no forbidden word, score or ranking. (FR-11, FR-12,
      FR-20)
- [ ] A spec whose first counted commit predates recording, or spans an off day, is marked
      partial and has no ratio; its hours and lines are still shown. (FR-15, FR-20)
- [ ] Each table's hours sum to the overall hours for its dimension, with the unattributed
      row included. (FR-5, FR-13, FR-20)
- [ ] With no determinable default branch the report shows hours only and names the
      failed lookup. (FR-14)
- [ ] The report contains no token, price or model figure. (FR-17)
- [ ] The README section and the changelog entry are in the same change. (FR-18)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1, DR-004).** No network call. The git
  reader runs local `git` only, only when the report command is run, and is added to the
  spawn allowlist (`packages/minspec/tests/invariants.test.ts:134`) and not to the
  network-consent allowlist (`:274`). The recorder spawns nothing.
- **INV-2 - Blast radius (constitution invariant 3, DR-074, SPEC-096).** Everything is
  written inside the opted-in folder's `.minspec/`, through `ensureDirectory`. Nothing in
  editor storage, user settings, or the home directory.
- **INV-3 - Consensual, content-free human telemetry (SPEC-017 FR-8, DR-042).** Off by
  default; on only by the developer's own confirmed act; visible while on; ids and day
  totals only.
- **INV-4 - Measure leverage, not the person.** No count of keystrokes, scrolls, clicks or
  events exists anywhere in the feature, in memory or on disk. The developer is
  keyboard-first for accessibility reasons; a figure that rewards or penalizes input
  volume is forbidden, and FR-3 makes one impossible to compute from what is captured.
- **INV-5 - No silent failure of the recorder (constitution invariant 2, DR-066).** A
  failed write, a tampered ignore file or a missing activity signal is shown, never
  swallowed. A report over an incomplete record says it is incomplete (FR-15).
- **INV-6 - Outcome over proxy (SPEC-017 invariant, DR-042 decision 4).** No verdict,
  threshold, flag, badge or warning is derived from time, from the ratio, or from lines
  changed. Nothing here writes to a spec, an approval record or `reviewStart`.
- **INV-7 - Separate from cost (the issue; FR-17).**
- **INV-8 - No nagging, cheap activation (constitution principle 4, constraint 3).**
  FR-2, FR-8.
- **INV-9 - Tier-0 boundary (constitution constraint 1).** The shared module imports
  neither `vscode` nor `fs` nor anything that reaches the network.

## Decisions needed (Clarify)

Each decision carries a recommendation and what the recommendation costs. The requirements
above assume the recommended option in every case. No option has been selected by a human;
this repository runs with `"autonomy": "act"` (`.minspec/config.json`), under which an
agent proceeds on a stated recommendation and records the options it did not take
(DR-086 decisions 2 and 4), and approval of a T3 spec is on that decision's stop list, so
approving this spec is what ratifies them.

### DQ-1 - May time be shown beside output, when DR-042 says "only beside rework"?

DR-042 decision 4 makes it a Tier-0 invariant that time "is only ever displayed paired
with rework outcome". A leverage report shows hours beside lines changed. Most rows -
every issue, every epic, every spec not yet approved - have no rework figure.

- **Option A - read DR-042 decision 4 as a ban on review-depth verdicts, and show hours as
  a denominator with rework on the same row wherever it exists (rec).** FR-12, FR-13,
  INV-6. The rule's stated purpose is to stop a false "you skimmed this"; this report
  carries no verdict, threshold or ranking, and it states the lower-bound caveat first.
  *Cost:* it narrows a Tier-0 invariant by interpretation, and a table with a small number
  of hours next to a spec is one careless edit away from the accusation the rule exists to
  prevent. If this option is chosen, DR-042 MUST gain a dated addendum recording the
  reading before Plan starts - an update to the existing record, not a new one - and that
  edit needs its own approval.
- **Option B - obey the sentence as written: show hours and a ratio only on rows that
  have a rework figure.** *Cost:* that leaves approved specs only. No issue, epic or
  decision-record breakdown, which is most of what the issue asks for.
- **Option C - record, but build no report until SPEC-017's third signal (time crossed
  with rework) is built.** *Cost:* the data sits unread, and an unread store can be wrong
  for months with nobody noticing.

### DQ-2 - What counts as "human activity"?

- **Option A - the window's own focused-and-active state, and nothing else (rec).** FR-3.
  One boolean the editor already publishes. It covers typing, navigating, scrolling and
  the integrated terminal alike without the extension observing any of them, so there is
  nothing to weaponize: no keystroke or scroll count exists to misuse. *Cost:* the idle
  timeout is the editor's, not ours, and cannot be tuned or even read; whether the field
  exists at the engine floor is unverified; and it cannot say *which* kind of activity
  occurred, so SPEC-017's review-start timestamp cannot be derived from it.
- **Option B - sample selection, visible-range and document-change events and strip idle
  gaps over a threshold, as SPEC-017 FR-7a describes.** *Cost:* it registers listeners on
  exactly the keystroke-adjacent events the issue says not to weaponize, misses all time
  in the integrated terminal (where an agent-driven workflow spends much of it), and adds
  a threshold someone has to choose and defend.
- **Option C - focus alone.** *Cost:* a focused window over lunch counts as an hour of
  work; SPEC-017 "The proxy trap" rejects this by name.

### DQ-3 - Where does the consent live?

The issue says "settings text + status surfacing".

- **Option A - `.minspec/preferences.json`, switched by a palette command; no contributed
  setting (rec).** FR-1. Per developer and per project, never committed, which is what
  DR-078 decided for the same class of personal choice. A contributed workspace-scoped
  setting could be committed in `.vscode/settings.json` and would then switch recording on
  for every contributor who opens the project. *Cost:* nothing appears in the Settings UI,
  so "settings text" is met by the consent text, the README and the status indicator
  rather than by a setting; someone looking in Settings for the switch will not find one.
- **Option B - a contributed setting restricted to user scope (`"scope": "application"`),
  default off.** I believe that scope cannot be set from a workspace file, **unverified**.
  *Cost:* one switch turns recording on in every opted-in project on the machine, and the
  consent text of FR-1 has no moment to be shown.
- **Option C - an ordinary workspace-scoped setting.** *Cost:* committable, so it can
  impose human telemetry on a co-contributor. Not recommended under any reading.

### DQ-4 - How fine is the record?

- **Option A - one total per day per key (rec).** FR-4, FR-5. The file cannot be read as a
  timeline of when the developer was at the keyboard. *Cost:* permanent for the past: a
  question that needs finer data (time before versus after an approval on the same day,
  which is what SPEC-017's third signal needs) can never be answered for days already
  recorded, because human activity is forward-only.
- **Option B - intervals with start and end times.** *Cost:* the store becomes a
  minute-by-minute log of one person's working pattern, kept on disk in a project
  directory. It is the more useful record and the more dangerous one.

### DQ-5 - Where is it stored, given worktrees?

- **Option A - `.minspec/leverage/` in the checkout, self-ignoring (rec).** FR-6. Visible
  in the Explorer, inside the opt-in marker, no new kind of location. *Cost:* each
  worktree has its own `.minspec/`, so time recorded in a worktree window is lost when the
  worktree is removed, and a report covers one checkout. In this repository, where most
  review happens in the primary checkout, that under-counts further; the report's
  lower-bound statement covers it but does not fix it.
- **Option B - under the repository's git common directory, shared by all worktrees.**
  Never committed by construction and survives worktree removal. *Cost:* a second place
  MinSpec writes outside `.minspec/`, invisible in the Explorer and so less auditable,
  absent in a folder that is not a git repository, and it needs a decision record because
  it widens DR-078 decision 3.

### DQ-6 - What is "output"?

- **Option A - lines added plus deleted on the default branch, attributed by `implements:`
  for specs and by commit subject for issues; decision records get hours only (rec).**
  FR-14. It is what the issue asks for, and it is recomputable from files. *Cost:* lines
  changed is a size measure - the proxy SPEC-004 was written about - and agent-written
  volume inflates it by design, so the figure rises with verbosity as easily as with
  value. An issue's count takes whole commits, so a lockfile update lands in it. A spec
  without `implements:` shows nothing.
- **Option B - count artifacts advanced instead of lines (specs approved, specs done,
  issues closed by a merged commit) per observed hour.** *Cost:* not what the issue asked
  for; the numbers are small integers, so per-artifact rows are mostly "1"; and "issue
  closed" is not readable offline.
- **Option C - both, side by side.** *Cost:* two numerators invite picking whichever
  flatters, and double the report.

### DQ-7 - How is human time attributed to an issue?

An issue is not a file, and the session record carries spec ids, not issue numbers
(`packages/minspec/src/lib/session.ts:9-21`). No code today derives an issue from a branch
name (searched `packages/minspec/src` for `issue-`, `agent/issue`, `issueFromBranch`,
`branchIssue`: no match).

- **Option A - from the branch name, by one fixed pattern: a path segment `issue-<N>` or a
  final segment beginning `<N>-` (rec).** FR-5. Read from the checkout's `HEAD` file, no
  process spawned; only the number is stored. *Cost:* it is a naming convention, not a
  fact. A project with other branch names gets every hour unattributed in the issue
  table, a branch named for a year or a version (`release/2026-q4`) is misread as an issue,
  and time spent reviewing on `main` attributes to no issue.
- **Option B - issues show output only; hours are never attributed to an issue.**
  *Cost:* no leverage figure per issue, which the issue names first in its list.
- **Option C - give an issue the hours of every artifact that cites it.** *Cost:*
  ambiguous and double-counting: SPEC-096 cites eight issues in `relates_to`.

### DQ-8 - One build or two?

- **Option A - two slices: the recorder and its controls first (FR-1 to FR-10, FR-18 to
  FR-20 in part), the report second (FR-11 to FR-17) (rec).** Human time cannot be
  backfilled, so every week the recorder is not running is a week no report can ever
  cover, while the output half is recoverable from git at any time. *Cost:* until the
  second slice lands the data has no reader except Open Leverage Data, and this is
  Phase 2 (Public-ready - polish) work that the constitution ranks below any unmet
  Phase 1 (Dogfood-ready) item, so the first slice competes with blockers.
- **Option B - one build.** *Cost:* recording starts later, and that time is not
  recoverable.
- **Option C - park the issue.** DR-075 decision 1 narrows scope to the enforcement core
  plus daily solo use, and this is neither a gate nor a guardrail. *Cost:* DR-042
  decision 5's human-side arm (#301) stays without a denominator.

## Why no new DR

Under the recommended options nothing here is hard to undo: the store is a local,
self-ignored directory the developer can delete with one command, the consent is one key
in an existing gitignored file, no existing schema changes, and no file format is read by
anything outside this feature. The reversibility filter (can it be undone in under a day)
is met. Two answers would change that, and the spec must not proceed to Plan on either
without the record named: **DQ-1 Option A** needs a dated addendum to
[DR-042](../../../docs/decisions/DR-042.md) (an update to the in-force record, per the
register's dedup rule, not a new number); **DQ-5 Option B** needs a new decision record
because it adds a store outside `.minspec/`. `docs/decisions/INDEX.md` was searched for
"leverage", "human-hour", "telemetry", "activity", "engagement" and "opt-in"; DR-042 is the
only in-force record on measuring the human, and none covers a leverage ratio.

## Out of Scope

- **Any cost or token figure, and any join to ScroogeLLM data.** The cost half was filed
  on the scroogellm repository according to the issue (not read). ScroogeLLM is shelved
  as a product (DR-075). FR-17 keeps the ids joinable and goes no further.
- **Sending `X-Scrooge-Tag`.** No sender exists in this repository (Context).
- **SPEC-017's third signal (time-to-approve, `reviewStart`, the rework-by-time
  scatter).** Not built by this spec and not fed by it under DQ-4 Option A. If DQ-4
  resolves to Option B, whether SPEC-017 reuses this recorder is a question for that
  spec's Plan.
- **A baseline or any retroactive human-time figure.** FR-16.
- **Charts, trends, the Trust Dashboard pane, a status-bar figure.** FR-11.
- **Team or multi-developer views.** Team mode is parked (DR-075 decision 4). The store
  holds no identity (FR-4), and nothing aggregates across developers.
- **Time outside the editor window.** Not observable; stated, not estimated.
- **Excluding generated or lock files from lines changed.** Named as a cost in DQ-6; a
  later refinement if the figure proves unusable.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 decision 4).

- **Tokens per line of code, the founder's first idea.** Rejected here: it is a cost
  measure, and the issue itself moves it to the scroogellm side so that MinSpec's
  token-volume increase never reads as "cost exploded".
- **Storing the active file's path and resolving the artifact when the report runs.**
  Rejected: the store would be a browsing history of the project. Resolving to an id at
  capture loses the ability to re-attribute later and is worth that.
- **Recording in editor storage (`globalState` / `workspaceState`).** Rejected: not
  readable or deletable by the developer without the extension, which fails "auditable",
  and DR-078 decision 3 names the project-local store.
- **Relying on a root `.gitignore` entry added by the scaffold.** Rejected as the only
  protection: a project initialized before this feature has no such entry until Refresh
  runs, and until then a routine `git add` would commit a record of a person's activity.
  The self-ignoring directory (FR-6) holds without it.
- **Showing the ratio in the status bar or the Specs pane.** Rejected: the issue says not
  surfaced prominently, and an always-visible per-spec ratio is the standing verdict
  DR-042 forbids.
- **A minimum-hours floor below which no ratio is shown.** Rejected: any floor is a
  threshold someone must pick, and raw hours and lines are always shown beside the ratio
  (FR-15), so a reader can discount a tiny denominator themselves.
- **Offering recording from the setup prompt.** Rejected: constitution principles 2 and 4;
  consent to being timed should not arrive as one more button in a list.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `leverage-consent-invariant.test.ts` (FR-19), shown red
  against a deliberately wrong recorder (one that writes while off, one that subscribes to
  selection events) and green against the right one; `packages/shared/tests/leverage.test.ts`
  (FR-20) on fixed inputs.
- **Not vacuous:** each guard is removed one at a time - the consent check, the marker
  check, the focused-and-active condition, the self-ignore check, the partial rule, the
  forbidden-word check - and the suite is shown to turn red, with a clean control run.
  Fixtures vary the number of days, keys and windows, not only the code under test.
- **Engine floor:** the recorder is typechecked against the 1.90 typings, not only the
  installed ones (Context: the activity field at the floor is unverified).
- **Existing tests that change:** the spawn allowlist in `invariants.test.ts` gains the
  git reader; the directory-creation inventory SPEC-096 FR-9 specifies gains the recorder
  if that test has landed when this is built; the command-classification test SPEC-096
  FR-10 specifies must classify the five new commands.

## Traceability

- **Issue:** [#219](https://github.com/AIClarityAU/minspec/issues/219).
- **Governing decisions:** [DR-042](../../../docs/decisions/DR-042.md) (outcome metrics
  before engagement; no standalone engagement verdict),
  [DR-078](../../../docs/decisions/DR-078.md) (the project-local preference store),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius and the opt-in marker),
  [DR-004](../../../docs/decisions/DR-004.md) (tiered network consent),
  [DR-075](../../../docs/decisions/DR-075.md) (solo-first; monetization closed),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-086](../../../docs/decisions/DR-086.md) (acting on a recommendation, and recording
  what was not taken).
- **Specs this sits beside:** [SPEC-017](../SPEC-017-trust-dashboard/requirements.md)
  (trust dashboard; the rework figure this report shows, and the opt-in rule it follows),
  [SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md) (the one directory
  operation and the refusal message), SPEC-038 (ownership declared in Specify),
  [SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md) (why there is no bridge
  to reuse).
- **Follow-ups this spec surfaces, NOT yet filed** - this dispatch has no network access,
  so they are listed for whoever publishes it and are repeated in the dispatch summary:
  1. If DQ-1 resolves to Option A: the DR-042 addendum.
  2. Verify `WindowState.active` at engine floor 1.90, or raise the floor (Plan input).
  3. Whether SPEC-017's third signal should reuse this recorder (only if DQ-4 resolves to
     Option B).
- **Related, not absorbed:** #301 (human-side arm of the tuning study, DR-042 decision 5),
  which this would supply a denominator for.
- **DR for this spec:** none under the recommended options; see "Why no new DR".
