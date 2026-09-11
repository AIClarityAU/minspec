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
   ordering the API contradicts (FR-1, AC-1). Non-comment references wait on PQ2.
2. **Pin the absences** with T0 tests that can fail, each scan with a meta test fed the
   pre-fix text (AC-1 to AC-4).
3. **Record** that #897 is blocked on #374, and read it back (AC-5).

AC-6 holds vacuously and says so: nothing below adds an import or a resolver.

## FR coverage

| FR | What this design does |
|---|---|
| FR-1 | Comment sweep (firm, AC-1). Non-comment references: PQ2. |
| FR-2 | Nothing to build: no surface kept or added claims the active spec; the on-click message already carries the id (`packages/minspec/src/commands/status.ts:55-56`, `summary.id`). |
| FR-3 | Nothing to build; AC-3's tests pin that no status-bar item follows focus. |
| FR-4 | No title influence (DQ-3 = defer); AC-4's tests pin the config-write sites. |
| FR-5 | The deferral is recorded (requirements.md DQ-3); AC-5 checks the tracker. |
| FR-6 | No code added; AC-6 vacuous. |

## Components, by path

No new file. Paths under `packages/minspec/`.

| File | Change | Serves |
|---|---|---|
| `src/views/status-bar.ts` | Comments only. Header `:1-11` rewritten to say what the file holds (one left-aligned item per class; higher priority renders further left), with no tier/phase/progress format. `:112` becomes `99, // leftmost MinSpec item; a higher priority renders further left`; `:170` becomes `98, // just right of the next-task signpost (priority 99)`; `:228` becomes `97, // just right of the harness-commit recovery item (priority 98)`. | FR-1, AC-1 |
| `src/commands/status.ts` | Comment `:6-9`: the `minspec.status` command handler, with no status-bar claim. | FR-1, AC-1 |
| `src/lib/active-spec.ts` | Comments `:13-15`, `:79-80`: drop the claim that a status-bar watcher or status-bar click consumes it. | FR-1, AC-1 |
| `src/lib/spec-progress.ts` | Comments `:8-10`, `:21`: drop the status-bar consumer claim. The `StatusBarSpec` name stays; its header `:12-14` records why. | FR-1, AC-1 |
| `src/extension.ts` | Comment `:903-905`: "the shared `fromFrontmatter` (`packages/minspec/src/lib/spec-progress.ts:34`)" in place of "the same way the status bar does". | FR-1, AC-1 |
| `src/test/views.test.ts` | Comments `:8`, `:59-61`, `:68-72`: the test checks that `minspec.status` is registered, nothing more. | FR-1, AC-1 |
| `tests/status-bar.test.ts` | New `describe` blocks: AC-1 scan, AC-2 count pin, AC-3 static scan. | AC-1, AC-2, AC-3 |
| `tests/extension.test.ts` | One new `it` in `describe('activate()')` (:407). | AC-3 |
| `tests/invariant3-project-local-prefs.test.ts` | Two new `it`s and one meta `it` in `describe('INVARIANT 3 …')` (:36). No existing assertion changes. | AC-4 |
| Only if PQ2 is answered (a), which is NOT decided: `packages/minspec/README.md:121-125`, `packages/minspec/package.json:613`, `packages/minspec/media/walkthrough/explore-sidebar.md:17-24`, `packages/minspec/src/commands/example.ts:197-198`, `packages/minspec/src/test/views.test.ts:58`, `:65` | See PQ2. | FR-1 |

requirements.md's `implements_reason` names only `status-bar.ts` and its test; AC-1's
"anywhere under `packages/minspec/src`" reaches the other source files above, and every edit
there is a comment or a test.

## Contracts (the tests)

```ts
// tests/status-bar.test.ts - added, local helpers (same walk as invariant3-project-local-prefs.test.ts:27-34)
function tsFiles(dir: string): string[];              // every *.ts under dir, recursive
function commentText(src: string): string;            // `//` tails and `/* ... */` bodies only
function codeText(src: string): string;               // src with those comments removed
function badPriorityComments(src: string): string[];  // each line matching
//   /\b(\d+)\s*,\s*\/\/\s*just (left|right) of\b[^(]*\(priority (\d+)\)/
// where `left` has N <= M, or `right` has N >= M
```

- **AC-1**, over `tsFiles(src/)`: `commentText` contains neither `$(shield) MinSpec` nor
  `per-spec progress item`, and `badPriorityComments` is empty for every file. **Meta:**
  `badPriorityComments` flags `99, // just left of the per-spec progress item (priority 100)`
  and `98, // just left of the next-task signpost (priority 99)`, and passes
  `98, // just right of the next-task signpost (priority 99)`.
- **AC-2**, over `tsFiles(src/)`: the `createStatusBarItem(` occurrences in `codeText` number
  exactly `AC2_PINNED.length`, all in `views/status-bar.ts`; the pairings are the existing
  per-class tests (:81-85, :258-262, and :134-138 for the tidy-primary item). **`AC2_PINNED`
  is PQ1's answer.** Under AC-2 as approved it has two entries and the test is red on
  `d43f235a` (three sites).
- **AC-3, static:** `codeText` of `src/views/status-bar.ts` contains neither `activeTextEditor`
  nor `onDidChangeActiveTextEditor`.
- **AC-3, behavioural** (`tests/extension.test.ts`): fake timers; `activate(makeMockContext())`;
  `await vi.advanceTimersByTimeAsync(1000)` to flush the initial debounced paints; clear
  `update` on `mockNextTaskStatusBar`, `mockScaffoldCommitStatusBar`, `mockTidyPrimaryStatusBar`
  (:17-19); call every handler captured by the `onDidChangeActiveTextEditor` mock (:97) with a
  fake spec-file editor and with `undefined`; advance 1000 ms (past the 300 ms debounces at
  `extension.ts:248`, `:274`, `:299`); assert no `update` call on any of the three.
  **Non-vacuity:** at least one handler was captured (`extension.ts:75` registers one).
- **AC-4** (`tests/invariant3-project-local-prefs.test.ts`), over `sourceFiles(SRC_DIR)` minus
  `src/test/` (the bundle is built from `src/extension.ts` alone,
  `scripts/build-extension.sh:73`, `:76`, and no production file imports from `src/test/`),
  comments stripped as `:55` does. `configWriteSites(text): number` counts (i)
  `getConfiguration(…)` followed across whitespace by `.update(`, and (ii) `X.update(` where `X`
  is bound in the same file by `const|let|var X = …getConfiguration(`. The per-file site list,
  sorted, equals `['commands/classify.ts', 'commands/migrate.ts', 'extension.ts']`, each entry
  carrying a comment naming its gate (classify.ts:171, migrate.ts:31, auto-bootstrap.ts:711).
  A new site fails the pin whatever its target; adding one is a reviewed diff that must name
  its gate. Second `it`: no string literal in the same file set holds `.vscode` as a path
  segment, i.e. no match for ``/(['"`])(?:[^'"`\n]*[\/\\])?\.vscode(?=[\/\\'"`])/``; the
  near-misses `init.ts:1028` and `:1035` (`GitHub.vscode-pull-request-github`) and
  `constitution-context.ts:270` (`engines.vscode.`) do not match. **Meta:** `configWriteSites`
  counts a chained sample, a variable-bound sample, and
  `cfg.update('window.title', '${rootName}', true)`; the path regex matches `'.vscode'` and
  `'.vscode/settings.json'` and not `'GitHub.vscode-pull-request-github'`. The existing Global
  scan (:48-67) is
  unchanged; its blindness to a boolean `true` target is #1944, not this spec.

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

1. T0 tests first. AC-1 is red on `d43f235a` (four sites). AC-3 and AC-4 assert absences that
   already hold, so their meta tests are what show each scan can fire. AC-2 waits on PQ1.
2. Comment sweep; AC-1 goes green.
3. PQ2 edits, only if answered (a).
4. AC-5 tracker write and read-back.

## Plan Questions

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
  the defect EPIC-002 exists to prevent. **NOT decided - needs the founder via Clarify.**

## What this design does NOT do

- No runtime logic, no status-bar item, no title feature (DQ-3 = defer, carried by #897).
- No edit to requirements.md; PQ1 and PQ2 go through Clarify.
- No change to the existing invariant-3 Global scan; its gap is #1944.
- No change to how `workspaceRoot` is resolved (`extension.ts:112`): it is fixed at
  activation, so AC-3's "recomputed" condition does not apply, and no FR asks for it.
- No rename of `StatusBarSpec`; no edit to other specs, DRs or `CHANGELOG.md` (records, not
  signposts).
- No CI, merge-gate or machinery change; no DR (DQ-5).

## Risks

- **A source scan can pass vacuously.** Every scan has a meta test fed the text it must reject.
- **The behavioural AC-3 test covers only handlers registered during `activate()`.** A handler
  registered later is not exercised; the static half covers `status-bar.ts` alone.
- **AC-5 is point-in-time.** The drain reconciler can re-close #897 afterwards; that mechanism
  is #1628 (reconciler re-closes reopened issues).

## Follow-ups (tracked)

- **#1944** (invariant-3 scan misses a boolean `true` target, open): found here, not needed
  for AC-4.
- **#1628** (reconciler re-closes reopened issues, open): the path by which AC-5's fail state
  can recur.
- **#897** (title feature, open) and **#374** (worktree/session naming, open): the deferred
  feature and its dependency.
