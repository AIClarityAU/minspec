---
id: SPEC-055
type: design
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-012, SPEC-026, SPEC-040, DR-019, DR-075, DR-076]
implements: none
implements_reason: Plan document. requirements.md declares no implements or affects list and gives its reason there; this design names the files Implement edits and adds no ownership of its own. No tier field here on purpose - only requirements.md carries the tier, per the SPEC-044 design-frontmatter note.
---

# MinSpec - Spec identity signpost: sweep what the retired per-spec status item left behind (Plan)

**Date:** 2026-09-12, against origin/main `d43f235a`.
**Status:** Plan (SDD Plan phase). This document does not change the spec's `status:`.
**Reads:** [requirements.md](requirements.md), APPROVED. `npm run facts -- hash SPEC-055`
reports `verdict: APPROVED` (stored = computed = `1cf24a62…`). FR-1..FR-6, AC-1..AC-6,
INV-1..INV-5 and DQ-1..DQ-5 are settled there and are not re-litigated. This is HOW, not
WHAT or WHY.
**Dependency budget:** zero new npm dependencies, zero new files.
**Re-checked:** 2026-10-31 against origin/main `ef84097b`: still `verdict: APPROVED`, same hash.
[Decisions](#decisions) and [Drift since the draft](#drift-since-the-draft) are from that
re-check; where they differ from the `d43f235a` measurements below, they win.

## Decisions

Each choice below was chosen by the planning agent on its recommendation; not a founder
decision. Each can be undone in under a day, and none changes a sentence in requirements.md.

| Question | Choice | Why | Rejected |
|---|---|---|---|
| PQ2 - does FR-1's sweep reach past comments? | **(a)**, on what is still stale on `ef84097b`: the "Status Bar" section of `media/walkthrough/explore-sidebar.md`, the "sidebar and status bar" sentence in `src/commands/example.ts`, and the test title and message in `src/test/views.test.ts`. | FR-1 says MUST remove "every stale reference", and INV-1 bars a surface asserting what is not there. DQ-2's "the remaining work is the comment sweep" describes what was known on 2026-08-14 and restricts nothing. The cost named in PQ2 has shrunk: the README and `package.json` sites were already fixed, so no README section goes and no asset is orphaned. | (b) comments only: the walkthrough and every generated example keep describing an item that does not exist, the defect EPIC-002 exists to prevent. |
| PQ3 - pin config-write sites? | **(a)**, per-file counts in `AC4_PINNED`, plus the pin on `.vscode` paths below. | AC-4's fail clause needs a test that can fire, and source text cannot show reachability. A correctly gated new site costs one reviewed line in the pin; a silent write that passes every test costs an invariant-3 breach. The pin only ever adds a failure, so it contradicts no sentence of AC-4. | (b) no pin: a silent Workspace write passes every test, so AC-4's fail clause is unenforced. |
| PQ4 - static AC-3 scan of `status-bar.ts`? | **(a)**, scan `codeText` of `src/views/status-bar.ts` for both identifiers. | The behavioural test mocks all three classes, so it cannot see a focus-keyed `text` set inside one. The file holds neither identifier today, so a permitted non-text use, which has no current instance, costs one reviewed edit of the test. | (b) behavioural test alone: blind inside the classes, the place the defect would return. |

**PQ1 stays open.** AC-2's approved text pins two items and main creates three, so every
option either edits that text or tests something other than it. No task here takes it; task
4.1 in [tasks.md](tasks.md) is blocked on it, and nothing else is. Until it is answered the
spec cannot reach `done`, because AC-2 stays false. One cost PQ1 did not name: while
requirements.md is edited and unapproved, `scripts/hooks/spec-gate.py` treats this T3 spec as
stale, so it blocks `Edit`/`Write` in every session on each existing source file backticked in
tasks.md, `src/extension.ts` among them. Option (a) is one sitting: amend and re-approve
together.

## Drift since the draft

Measured on `ef84097b`:

- **PQ1's facts stand.** Three `createStatusBarItem` calls, now `status-bar.ts:111`, `:169`,
  `:227`. The stale comments are now `:113`, `:171`, `:229`; the header is still `:1-11`.
- **Part of PQ2's list is already gone.** `packages/minspec/README.md:181-183` now describes
  the three real items truthfully. The `package.json` sentence "The status bar tracks your
  active spec at a glance." and the `status-bar.png` link no longer exist, and
  `media/screenshots/status-bar.png` is absent. `package.json:603` and README:171 describe the
  next-task signpost, which exists: not stale, no edit.
- **Moved:** `explore-sidebar.md:30-36`, `example.ts:208-209`, and the comment at
  `extension.ts:943` ("the same way the status bar does").
- **A fourth config-write site.** `packages/minspec/src/commands/getting-started.ts:75`, added by SPEC-042's
  Getting Started page: `config().update(…, ConfigurationTarget.Workspace)`, reached only from
  `writeSetting` calls in `packages/minspec/src/views/getting-started-webview.ts:174` and `:204`, from webview
  click messages. Its call form is one `configWriteSites` as first drafted would not count.
  The contract below covers it.
- **`StatusBarSpec` is gone.** #2218 renamed it to `SpecProgressView` under #994. The header
  of `spec-progress.ts:12-16` records that and stays. `status-bar.ts` no longer imports from
  `lib/spec-progress`, so "the status bar and the active-spec summary both import them"
  (`spec-progress.ts:8-9`) is itself stale and joins the sweep, as does "passed to the status
  bar for display" (`:23`).
- **Focus handlers unchanged:** still `extension.ts:77`, `active-spec.ts:156`, `active-adr.ts:64`.
  `recordApprovableView` feeds only Alt+A's picker.
- **#1628 is closed**, so its entry under Risks and Follow-ups no longer names an open path. I
  did not test whether the reconciler still re-closes reopened issues.
- **#897 still has `blockedBy` count 0** and carries the `hold:specify` label, which fits the
  deferral. Every task pull request here says `Refs #897`, never `Closes`.

## What this Plan designs against (measured on `d43f235a`)

1. **Three status-bar items, not two.** `packages/minspec/src/views/status-bar.ts` calls
   `createStatusBarItem` at :110 (priority 99, `minspec.nextTask`), :168 (98,
   `minspec.commitHarnessRefresh`) and :226 (97, `minspec.tidyPrimary`; class
   `MinSpecTidyPrimaryStatusBar` at :222, wired at `extension.ts:278-301`). The third landed in
   `f97abb46` (#1712, keep the primary checkout clean) on 2026-08-29; the approval sidecar
   records `approvedAt` 2026-08-19. AC-2 is false today - PQ1.
2. **AC-1's offenders moved and grew.** The header `:1-11` and `:112` are where AC-1 says;
   AC-1's `:166` is now `:170`; a fourth reversed comment sits at `:228`
   (`97, // just left of the harness-commit recovery item (priority 98)`). AC-1's "anywhere
   under `packages/minspec/src`" covers it. Direction per the `vscode` typings: "Higher values
   mean the item should be shown more to the left" (line 11640 of the vendored `@types/vscode`
   declarations).
3. **More comments describe the removed item** (all under `packages/minspec/src`, so AC-1
   applies): `packages/minspec/src/commands/status.ts:6-9` ("Status bar click handler", "the active spec the
   status bar displays"); `packages/minspec/src/lib/active-spec.ts:13-15` ("the status bar watcher (in
   extension.ts)") and `:79-80`; `packages/minspec/src/lib/spec-progress.ts:8-10` and `:21`;
   `extension.ts:903-905` ("the same way the status bar does"); `packages/minspec/src/test/views.test.ts:8`,
   `:59-61`, `:68-72`.
4. **Non-comment references to the removed item exist** in shipped files - PQ2.
5. **No status bar follows focus.** The three `onDidChangeActiveTextEditor` handlers are
   `extension.ts:75` (`recordApprovableView`), `packages/minspec/src/lib/active-spec.ts:156` (`rememberSpecEditor`)
   and `packages/minspec/src/lib/active-adr.ts:64` (`rememberAdrEditor`); none updates a status-bar item. The status
   bars' `workspaceRoot` is a `const` set once at `extension.ts:112` by
   `resolveTargetFolderNonInteractive` (`packages/minspec/src/lib/resolve-folder.ts:49-60`), which reads the active
   editor at activation only.
6. **Configuration writes.** Three production sites, all `ConfigurationTarget.Workspace`,
   each behind a user choice: `packages/minspec/src/commands/classify.ts:176-178` inside
   `else if (choice === AUTO_CLASSIFY)` (:171); `packages/minspec/src/commands/migrate.ts:43-45` after
   `if (!pick) return;` (:31); `extension.ts:620-629` (`enableAutoClassify`), whose only caller
   is `packages/minspec/src/lib/auto-bootstrap.ts:714-715` inside
   `if (step.alwaysAction && choice === step.alwaysAction)` (:711). No non-comment line outside
   `src/test/` names a `.vscode` path. `grep -rn 'window\.title' packages/minspec/src` returns 0.
7. **Existing coverage to reuse.** `tests/status-bar.test.ts` pins each class's priority and
   command (:81-85, :134-138, :258-262). `packages/minspec/tests/invariant3-project-local-prefs.test.ts:48-67`
   fails on any `ConfigurationTarget.Global` write and owns the walker `sourceFiles` (:27-34).
8. **The tracker.** #897 (title feature) is OPEN; `gh issue view 897 --json blockedBy` returns
   `totalCount: 0`; its body says only "Relates to #374".

## Approach

Under DQ-2 = leave removed and DQ-3 = defer, SPEC-055 ships no runtime logic. Implement does
three things:

1. **Sweep** every comment that describes a status-bar item that is not created, or states an
   ordering the API contradicts (FR-1, AC-1), and the non-comment references PQ2's decision
   names.
2. **Pin the absences** with T0 tests that can fail, each scan with a meta test fed the
   pre-fix text (AC-1 to AC-4).
3. **Record** that #897 is blocked on #374, and read it back (AC-5).

AC-6 holds vacuously and says so: nothing below adds an import or a resolver.

## FR coverage

| FR | What this design does |
|---|---|
| FR-1 | Comment sweep (AC-1) and the non-comment references left on `ef84097b` (PQ2 decision). |
| FR-2 | Nothing to build: no surface kept or added claims the active spec; the on-click message already carries the id (`packages/minspec/src/commands/status.ts:55-56`, `summary.id`). |
| FR-3 | Nothing to build; AC-3's tests pin that no status-bar item follows focus. |
| FR-4 | No title influence (DQ-3 = defer); AC-4's tests pin the config-write sites. |
| FR-5 | The deferral is recorded (requirements.md DQ-3); AC-5 checks the tracker. |
| FR-6 | No code added; AC-6 vacuous. |

## Components, by path

No new file. Paths under `packages/minspec/`. Line numbers are `ef84097b`'s; key edits and
tests on the text, not the number.

| File | Change | Serves |
|---|---|---|
| `src/views/status-bar.ts` | Comments only. Header `:1-11` rewritten to say what the file holds (one left-aligned item per class; higher priority renders further left), with no tier/phase/progress format. `:113` becomes `99, // leftmost MinSpec item; a higher priority renders further left`; `:171` becomes `98, // just right of the next-task signpost (priority 99)`; `:229` becomes `97, // just right of the harness-commit recovery item (priority 98)`. | FR-1, AC-1 |
| `src/commands/status.ts` | Comment `:6-9`: the `minspec.status` command handler, with no status-bar claim. | FR-1, AC-1 |
| `src/lib/active-spec.ts` | Comments `:13-15`, `:79-80`: drop the claim that a status-bar watcher or status-bar click consumes it. | FR-1, AC-1 |
| `src/lib/spec-progress.ts` | Comments `:8-10`, `:23`: drop the status-bar consumer claim. | FR-1, AC-1 |
| `src/extension.ts` | Comment `:943-945`: "the shared `fromFrontmatter` (`src/lib/spec-progress.ts`)" in place of "the same way the status bar does". | FR-1, AC-1 |
| `src/test/views.test.ts` | Comments `:8`, `:59-61`, `:68-72`, the title `:58` and the message `:65`: the test checks that `minspec.status` is registered, nothing more. | FR-1, AC-1, PQ2 |
| `media/walkthrough/explore-sidebar.md` | Delete the `## Status Bar` section (`:30-36`). The signpost paragraph at `:9-13` stays; it is true. | FR-1, PQ2 |
| `src/commands/example.ts` | `:208-209`, in the generated example: "The sidebar updates automatically as you check items off." | FR-1, PQ2 |
| `tests/status-bar.test.ts` | New `describe` blocks: AC-1 scan, AC-3 static scan, the PQ2 copy check, and (blocked on PQ1) the AC-2 count pin. | AC-1, AC-2, AC-3, FR-1 |
| `tests/extension.test.ts` | One new `it` in `describe('activate()')` (:408). | AC-3 |
| `tests/invariant3-project-local-prefs.test.ts` | New `it`s and a meta `it` in `describe('INVARIANT 3 …')`. No existing assertion changes. | AC-4 |

requirements.md's `implements_reason` names only `status-bar.ts` and its test; AC-1's
"anywhere under `packages/minspec/src`" reaches the other source files above, and every edit
there is a comment or a test.

## Contracts (the tests)

```ts
// tests/status-bar.test.ts - added, local helpers (same walk as invariant3-project-local-prefs.test.ts:27-34)
function tsFiles(dir: string): string[];              // every *.ts under dir, recursive
function commentText(src: string): string;            // text of every comment range the TS compiler reports
function codeText(src: string): string;               // src with those ranges removed
function badPriorityComments(src: string): string[];  // each line matching
//   /\b(\d+)\s*,\s*\/\/\s*just (left|right) of\b[^(]*\(priority (\d+)\)/
// where `left` has N < M, or `right` has N > M
```

- **Helpers.** Comment ranges come from the `typescript` compiler already in the tree (root
  `package.json:37`; imported at `packages/minspec/src/lib/import-cycle-check.ts:49`):
  `ts.getLeadingCommentRanges`/`getTrailingCommentRanges` at each token of
  `ts.createSourceFile(…)` (JSDoc nodes not descended). Not a regex: a `/*` inside a `//`
  comment (`extension.ts:551`, `:636`) or a string opens no block. **Meta:** for
  `const g = '/* in a string */'; // watches refs/heads/*` then a line
  `vscode.window.createStatusBarItem(`, `commentText` holds `refs/heads/*` and not
  `in a string`, and `codeText` holds `/* in a string */` and `createStatusBarItem(`.

- **AC-1**, over `tsFiles(src/)`: `commentText` contains neither `$(shield) MinSpec` nor
  `per-spec progress item`, and `badPriorityComments` is empty for every file. **Meta:**
  `badPriorityComments` flags `99, // just left of the per-spec progress item (priority 100)`
  and `98, // just left of the next-task signpost (priority 99)`, and passes
  `98, // just right of the next-task signpost (priority 99)`. The same scan holds the retired
  phrases this sweep removes, so the other source files cannot drift back: `status bar watcher`,
  `status-bar click`, `Status bar click handler`, `the status bar displays`,
  `the status bar uses`, `the status bar does`, `the status bar and the`,
  `passed to the status bar`. Other mentions of a status bar under `src/` name items that exist
  and are left alone.
- **AC-2**, over `tsFiles(src/)`: the `createStatusBarItem(` occurrences in `codeText` number
  exactly `AC2_PINNED.length`; the pairings are the existing
  per-class tests (:81-85, :258-262, and :134-138 for the tidy-primary item). **`AC2_PINNED`
  is PQ1's answer.** Under AC-2 as approved it has two entries and the test is red on
  `ef84097b` (three sites).
- **AC-3, static** (`tests/status-bar.test.ts`): `codeText` of `src/views/status-bar.ts`
  contains neither `activeTextEditor` nor `onDidChangeActiveTextEditor`. **Meta:** the check
  fails on a sample holding either identifier in code, and passes when it appears only in a
  comment.
- **AC-3, behavioural** (`tests/extension.test.ts`): fake timers; `activate(makeMockContext())`;
  `await vi.advanceTimersByTimeAsync(1000)` to flush the initial debounced paints; clear
  `update` on `mockNextTaskStatusBar`, `mockScaffoldCommitStatusBar`, `mockTidyPrimaryStatusBar`
  (:17-19); call every handler captured by the `onDidChangeActiveTextEditor` mock (:97) with a
  fake spec-file editor and with `undefined`; advance 1000 ms (past the 300 ms debounces in
  `activate()`); assert no `update` call on any of the three.
  **Non-vacuity:** at least one handler was captured (`extension.ts:77` registers one).
- **AC-4** (`tests/invariant3-project-local-prefs.test.ts`), over `sourceFiles(SRC_DIR)` minus
  `src/test/` (the bundle is built from `src/extension.ts` alone,
  `scripts/build-extension.sh:73`, `:76`, and no production file imports from `src/test/`),
  comments stripped as the existing Global scan does. `configWriteSites(text): number` counts
  (i) `getConfiguration(…)` followed across whitespace by `.update(`, (ii) `X.update(` where `X`
  is bound in the same file by `const|let|var X = …getConfiguration(`, and (iii) `X().update(`
  where `X` is bound in the same file by `const|let|var X = () => …getConfiguration(`. The map
  of relative path to count, over files with a non-zero count, equals `AC4_PINNED` =
  `{ 'commands/classify.ts': 1, 'commands/getting-started.ts': 1, 'commands/migrate.ts': 1, 'extension.ts': 1 }`,
  so a second site in a pinned file changes the map too. **Meta:** `configWriteSites` counts 1
  for a chained sample, 1 for
  `const cfg = vscode.workspace.getConfiguration(); cfg.update('window.title', '${rootName}', true)`,
  1 for `const c = () => vscode.workspace.getConfiguration('x'); c().update('k', 1)`, and 3 for
  the three joined. **The `.vscode` half of AC-4:** over the same files and stripping,
  non-comment lines matching `/\.vscode[\\/'"]/` are pinned to the one on `ef84097b`,
  `packages/minspec/src/lib/onboarding-settings.ts:73`, a description string that writes nothing. Its meta test feeds
  `path.join(root, '.vscode', 'settings.json')`. The existing Global scan is unchanged; its
  blindness to a boolean `true` target is #1944, not this spec.

**AC-5 is an Implement step, not a suite test**, because it needs the network. As the bot, add
#374 (worktree/session naming) as a "blocked by" dependency of #897; then read back
`gh issue view 897 --repo AIClarityAU/minspec --json state,blockedBy` (expect `OPEN` and #374)
and `grep -rn 'window\.title' packages/minspec/src` (expect 0), and paste both outputs into the
Implement PR body.

## Invariants

- **INV-1:** served by the sweep; no comment is left naming a surface that does not exist.
- **INV-2:** served by the AC-4 tests.
- **INV-3:** no added code reads the network; AC-5's read is a one-time step, not a test.
- **INV-4:** no resolver added.
- **INV-5:** vacuous; no title action ships, so none can fail.

## Build order

[tasks.md](tasks.md) holds the runs; the order is:

1. T0 tests first. AC-1 is red on `ef84097b` (four sites). AC-3 and AC-4 assert absences that
   already hold, so their meta tests are what show each scan can fire. AC-2 waits on PQ1.
2. Comment sweep; AC-1 goes green.
3. PQ2 edits.
4. AC-5 tracker write and read-back.

## Plan Questions

The options as first posed, on `d43f235a`. PQ2, PQ3 and PQ4 are answered under
[Decisions](#decisions); PQ1 is open.

- **PQ1 - AC-2 pins two items; `d43f235a` creates three.** The tidy-primary item
  (`status-bar.ts:222-261`, priority 97, `minspec.tidyPrimary`) landed after approval, so
  AC-2's own fail clause ("a third `createStatusBarItem` call appears … without this criterion
  being updated") has fired. **(a) (rec)** Amend AC-2 in Clarify to pin three items (99
  `minspec.nextTask`, 98 `minspec.commitHarnessRefresh`, 97 `minspec.tidyPrimary`) and
  re-approve requirements.md. *Cost:* the edit voids the hash-locked sign-off, so the founder
  re-reads and re-approves, and AC-2 waits for it. **(b)** Test only the two named pairings and
  ignore the rest. *Cost:* the test passes on the state AC-2 says fails, a criterion that cannot
  fail, which the 2026-08-14 AC rewrite (requirements.md:72-77) exists to remove. **(c)** Delete
  the tidy-primary item. *Cost:* removes shipped #1162 behaviour (keep the primary checkout
  clean) that no FR here touches. **NOT decided - needs the founder via Clarify.**
- **PQ2 - Does FR-1's "every stale reference" reach past comments?** FR-1 says "every stale
  reference"; DQ-2 says "the remaining work is the comment sweep"; AC-1 checks comments only.
  Shipped non-comment references: `packages/minspec/README.md:121-125` (a "Status Bar" section - tier, phase,
  progress, "Click it to open the active spec panel" - holding the only link to
  `media/screenshots/status-bar.png`); `packages/minspec/package.json:613` (walkthrough step
  `minspec.walkthrough.sidebar`, "The status bar tracks your active spec at a glance.");
  `packages/minspec/media/walkthrough/explore-sidebar.md:17-24` (a "Status Bar" section - spec ID, tier badge,
  phase); `packages/minspec/src/commands/example.ts:197-198` (text written into a user's example spec, blamed to
  2026-05-26, the day the item was added in `ce1738b8`); `packages/minspec/src/test/views.test.ts:58`, `:65` (test
  title and the assertion message "(status bar click target)"). **(a) (rec)** Fix them all:
  delete the two "Status Bar" sections and the walkthrough sentence, drop "and status bar" from
  the example text, retitle the views test to what it checks. *Cost:* user-facing copy changes
  that DQ-2's wording did not describe; the README then documents no status-bar item at all
  (documenting the next-task signpost is not asked for), and `status-bar.png` becomes an
  unreferenced asset. **(b)** Comments only. *Cost:* the README, the walkthrough and every
  generated example keep describing an item that does not exist - a lying signpost to users,
  the defect EPIC-002 exists to prevent. **Answered under [Decisions](#decisions), on a shorter list.**
- **PQ3 - AC-4's pin is stricter than AC-4's fail clause.** AC-4 fails only on a new site "not
  reachable only from a user choice", and DQ-4 records user-gated Workspace writes as
  legitimate. Reachability cannot be read from source text, so a count pin fails on every new
  site, gated or not. **(a) (rec)** Pin per-file counts (`AC4_PINNED`): a new site fails until a
  reviewed diff updates the pin, the pattern AC-2 uses. *Cost:* a correctly user-gated site also
  goes red and needs a pin edit, which AC-4's narrower wording does not ask for. **(b)** No pin;
  keep only the existing Global scan. *Cost:* a silent Workspace write passes every test, so
  AC-4's fail clause goes unenforced. **Answered under [Decisions](#decisions).**
- **PQ4 - A static AC-3 scan is stricter than AC-3's fail clause.** AC-3 fails only when a
  status-bar item's text is recomputed from `window.activeTextEditor` or inside an
  `onDidChangeActiveTextEditor` handler (requirements.md:92-95). A scan for either identifier
  also fails on uses that set no text, e.g. `if (!vscode.window.activeTextEditor) item.hide()`,
  which AC-3 permits; as in PQ3, source text cannot show what a value is derived from.
  **(a) (rec)** Scan: `codeText` of `src/views/status-bar.ts` contains neither identifier (it
  has none on `d43f235a`), so any use fails until a reviewed diff updates the test. *Cost:* a
  permitted non-text use also goes red, which AC-3's wording does not ask for. **(b)** No scan;
  the behavioural test alone. *Cost:* that test cannot see inside the status-bar classes,
  because `packages/minspec/tests/extension.test.ts:233-238` mocks all three, so a focus-keyed `text` set inside
  a class passes it. **Answered under [Decisions](#decisions).**

## What this design does NOT do

- No runtime logic, no status-bar item, no title feature (DQ-3 = defer, carried by #897).
- No edit to requirements.md by any task; PQ1, if answered (a), goes through Clarify.
- No change to the existing invariant-3 Global scan; its gap is #1944.
- No change to how `workspaceRoot` is resolved (`extension.ts:112`): it is fixed at
  activation, so AC-3's "recomputed" condition does not apply, and no FR asks for it.
- No edit to other specs, DRs or `CHANGELOG.md` (records, not signposts).
- No CI, merge-gate or machinery change; no DR (DQ-5).

## Risks

- **A source scan can pass vacuously.** Every scan has a meta test fed the text it must reject.
- **The behavioural AC-3 test covers only handlers registered during `activate()`.** A handler
  registered later is not exercised; the static scan covers `status-bar.ts` only.
- **AC-5 is point-in-time.** Something can re-close #897 afterwards; the known mechanism was
  #1628 (reconciler re-closes reopened issues), now closed.

## Follow-ups (tracked)

- **#1944** (invariant-3 scan misses a boolean `true` target, open): found here, not needed
  for AC-4.
- **#1628** (reconciler re-closes reopened issues, closed): the path by which AC-5's fail state
  could recur.
- **#897** (title feature, open) and **#374** (worktree/session naming, open): the deferred
  feature and its dependency.
