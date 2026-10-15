---
id: SPEC-189
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - code-change safety; sibling of SPEC-040 (import boundaries), which set the layer rules this spec adds one layer to
aspects: [architecture, activation, commands, manifest, refactor, merge-conflicts, tier-0]
depends_on: [SPEC-040]  # the layer rules (eslint.config.mjs) the new features/ layer must be written into
relates_to: [SPEC-086, SPEC-096, SPEC-136, DR-064, DR-074, "#694", "#690", "#830"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). These three files
# are NEW and are needed under every answer to the Clarify questions below: the contract
# every feature module receives, the one helper that turns a table into registrations, and
# the test that pins the partition of commands across features. The per-feature module files
# (`packages/minspec/src/features/<feature>.ts`) are finalised at Plan, when the grouping in
# FR-2 is fixed; Plan adds them here before approval of the plan.
implements: [packages/minspec/src/features/activation-context.ts, packages/minspec/src/features/register-commands.ts, packages/minspec/tests/feature-registry.test.ts]
# Modified, not owned. extension.ts shrinks to the composer (FR-1). eslint.config.mjs gains
# the features/ layer (FR-8; SPEC-040 owns the file). extension-extra.test.ts keeps its
# manifest parity test and gains the menu/keybinding half (FR-6).
affects: [packages/minspec/src/extension.ts, eslint.config.mjs, packages/minspec/tests/extension-extra.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-189: Each feature registers itself - `activate()` becomes a short list of feature calls

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or accepts the recommendations under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> decision names.

Materializes **[#694](https://github.com/AIClarityAU/minspec/issues/694)** - *"declarative
command registry - break the extension.ts/package.json change-amplification hub."*

**Id note.** `SPEC-189` is one above the highest spec id found across `origin/main`
(`5f792386`) and all 370 remote-tracking branches in this clone on 2026-10-16 (the highest number found there is 188). Open pull requests not mirrored in a local ref are invisible offline; if the id
collides at review time, renumber.

**Tier note.** Triage estimated T3/T4. This spec moves code across ~16 new files and shrinks
one, but changes no user-visible behaviour (INV-1) and crosses no network, opt-in or
approval boundary, so it is written at **T3**. Raise it if Clarify picks codegen (DQ-2
option B), which adds a build-time generator that every release depends on.

## One-Sentence Scope

Split the 696-line `activate()` in `packages/minspec/src/extension.ts` into per-feature
registration modules that each declare their commands in a table, so that adding a command
to an existing feature no longer edits `extension.ts`, while every registered command, view,
provider, watcher and context key stays exactly as it is today.

## Context - what the code does today (read from `origin/main` `5f792386`, not inferred)

The issue was filed on 2026-07-13. Its numbers have moved; the shape of the problem has not.

| Measure | Issue (2026-07-13) | Now (`5f792386`) | How measured |
|---|---|---|---|
| `extension.ts` length | 868 lines | 1,086 lines | `wc -l` |
| `activate()` length | 548 lines | 696 lines (`extension.ts:65`-`:760`) | first column-0 `}` after `:65` |
| `registerCommand` calls in `activate()` | 42 | 44 (all inside `extension.ts:369`-`:530`) | grep, multi-line calls counted by hand (`minspec.init`, `minspec.initRefresh`) |
| `contributes.commands` | 71 | 44 | `package.json` - SPEC-086 removed the ScroogeLLM commands |
| Commits touching `extension.ts` since 2026-07-13 | - | 18 | `git log --since=2026-07-13` |
| ...of which also touch `packages/minspec/package.json` | P = 0.50 | 8 of 18 (P = 0.44) | `git show --name-only` per commit |
| Median files per such commit | 6 | 9.5 (range 2-71) | same; commits are squash merges, so this is per pull request |

So the hub is still the hub: every pull request that adds, removes or rewires a command,
a tree view, a watcher or a status bar edits the same 696-line function, and the parallel
agent workflow this repo runs on (around fifteen concurrent sessions) turns that into merge
conflicts on one file.

What already exists and is **kept**:

- **Manifest parity is already gated.** `packages/minspec/tests/extension-extra.test.ts:551` (SPEC-086 FR-4,
  FR-7) runs `activate()` and asserts the registered command ids equal
  `contributes.commands` both ways. Today the two sides agree (44 = 44). The issue's
  "manifest and code can drift" risk is therefore already closed for command ids; it is
  open only for `menus` and `keybindings`, which reference 27 command ids with no test that
  they name a contributed command (none dangle today - checked by script).
- **Activation tests drive the real `activate()`.** `packages/minspec/tests/extension.test.ts`,
  `packages/minspec/tests/extension-extra.test.ts`, `packages/minspec/tests/commands-opt-in-invariant.test.ts` (SPEC-096
  FR-10) and `packages/minspec/tests/backlog-consent.test.ts` capture handlers through a mocked
  `vscode.commands.registerCommand` and invoke them as the palette does. Any design here
  must keep that seam.
- **Layer rules.** `eslint.config.mjs:8-11` (SPEC-040, DR-064) fixes four layers:
  `lib`, `views`, `commands`, and `extension.ts -> anything`. Loosening the set is a DR-064
  amendment (`eslint.config.mjs:13`).

What makes the split non-trivial (the coupling a naive cut would break):

- **Cross-feature refreshes.** File watchers inside `activate()` refresh several features at
  once: a decision-record change refreshes the ADR tree **and** the next-task status bar
  (`extension.ts:562`, `:564`); a spec change refreshes the spec tree, the next-task status
  bar and both code-lens providers (`:593`-`:594`, `:615`-`:617`, `:632`-`:634`).
- **Cross-feature closures.** `minspec.init` and `minspec.initRefresh` call
  `refreshScaffoldCommitStatusBar()` and `syncSessionIdEnvVar()` (`extension.ts:374`-`:388`),
  which belong to the scaffold status bar and the session-presence code respectively;
  `minspec.tidyPrimary` reads `presence.sessionId` (`:395`).
- **Order-sensitive startup.** `trackActiveSpecEditor` / `trackActiveAdrEditor` run first
  (`:66`-`:67`); the presence heartbeat is started before any command (`:125`-`:127`); the
  next-task status-bar paint is individually `try`-guarded (`:282`) because a throw there
  would kill every `registerCommand` lexically after it - the Alt+A dead-key investigation
  (2026-09-25, regression test at `packages/minspec/tests/extension.test.ts:467`) is the evidence that one
  throw in `activate()` silently disables unrelated features.
- **Non-command helpers living in `extension.ts`.** `surfaceBuildSkewAdvisory` (`:773`),
  `surfaceConstitutionProposeNudge` (`:817`), `resolveSpecFrontmatter` (`:873`),
  `injectContextCommand` (`:912`), `removeContextCommand` (`:974`),
  `handleFileSaveDriftCheck` (`:1001`), `showDriftWarning` (`:1039`).

Relation to **SPEC-136** (headless core, `specifying`): SPEC-136 builds a table of
*editor-free operations* in a new `packages/core`. This spec builds a table of *editor
registrations* inside `packages/minspec`. They do not overlap in files. A later change may
have a feature module's handler call a SPEC-136 operation; nothing here depends on that.
(SPEC-136 line 202 quotes `extension.ts` at 11,037 lines; the file is 1,086 lines at
`5f792386` - that figure is SPEC-136's to correct, not this spec's.)

## Functional Requirements

- **FR-1 - `activate()` is a composer.** `activate(context)` MUST build one
  `ActivationContext` (FR-3) and then call each feature's `register<Feature>(ctx)` in a
  fixed, explicit order, and do nothing else. It MUST contain no call to
  `vscode.commands.registerCommand`, `vscode.window.createTreeView`,
  `vscode.workspace.createFileSystemWatcher`, `vscode.languages.register*`, or
  `vscode.window.createStatusBarItem`, and no string literal equal to a contributed command
  id. The non-command helpers listed in Context move to the feature that uses them, or to
  `commands/` / `lib/` where they already fit the layer rules.

- **FR-2 - Per-feature registration modules.** Each feature lives in
  `packages/minspec/src/features/<feature>.ts` and exports one
  `register<Feature>(ctx: ActivationContext): void`. A feature owns everything it
  registers: its commands, tree views, providers, watchers, status bars and context keys.
  The indicative grouping (final in Plan; every one of today's 44 ids lands in exactly one):

  | Feature | Command ids today |
  |---|---|
  | scaffold | `init`, `initRefresh`, `commitHarnessRefresh` (+ scaffold-commit status bar, auto-bootstrap) |
  | primary-checkout | `tidyPrimary` (+ tidy-primary status bar) |
  | constitution | `constitutionShowPrompt`, `constitutionCompact`, `constitutionPropose` (+ propose nudge) |
  | classify | `classify` |
  | progress | `status`, `nextTask` (+ next-task status bar) |
  | explorer | `refreshTree`, `specExplorer.toggleEpicGrouping`, `adrExplorer.toggleEpicGrouping`, `backlog.toggleEpicGrouping` (+ three tree views, expansion memory) |
  | decisions | `createAdr`, `regenerateDrIndex`, `acceptAdr`, `setAdrStatus` (+ decisions watcher) |
  | epics | `createEpic`, `regenerateEpicIndex`, `acceptEpic`, `backfillEpics` (+ epics watcher) |
  | backlog | `scoreWsjf`, `triageIssue`, `refreshBacklog` |
  | traceability | `goToSpec`, `goToCode`, `linkToSpec` (+ code lenses, traceability watcher, reference diagnostics) |
  | session | `declareScope`, `park`, `parkForce`, `injectContext`, `removeContext` (+ presence heartbeat, session-id env var) |
  | authoring | `generateExample`, `migrateLayout` |
  | approval | `approveSpec`, `revokeApproval`, `showChangesSinceApproval`, `approveActive` (+ approvals watcher, `minspec.markdownPreviewActive` context key, most-recently-viewed tracking) |
  | validation | `validateSpec` (+ save-time drift check) |
  | docs-lane | `pushDocsLane` |
  | spec-panel | `viewDesign`, `viewTasks`, `showSpecPanel` |

  (All ids carry the `minspec.` prefix; 44 in total.)

- **FR-3 - The `ActivationContext` contract.** `features/activation-context.ts` MUST export
  the one type every feature receives. Indicative shape (names final in Plan):

  ```ts
  export interface ActivationContext {
    readonly extension: vscode.ExtensionContext; // subscriptions, globalState, workspaceState
    readonly workspaceRoot: string;              // resolveTargetFolderNonInteractive(), resolved once (#123)
    readonly sessionId: string;                  // from the presence manager (SPEC-026 FR-11)
    readonly events: ActivationEvents;           // DQ-3: how features ask each other to refresh
  }
  ```

  A feature module MUST NOT import another feature module. Everything one feature needs from
  another passes through `ActivationContext` (enforced by FR-8).

- **FR-4 - Commands are declared in a table.** Each feature MUST declare its commands as a
  `readonly CommandRegistration[]` (`{ id: string; handler: (...args: any[]) => unknown }`)
  and register them through the single helper `registerCommands(ctx, table)` in
  `features/register-commands.ts`, which calls `vscode.commands.registerCommand` for each row
  and pushes the disposable to `ctx.extension.subscriptions`. That helper is the only
  `registerCommand` call site in `packages/minspec/src` outside `src/test/**`. The table is
  exported so the partition test (FR-7) can read it without activating.

- **FR-5 - One feature's throw does not disable the others.** `activate()` MUST call each
  `register<Feature>` inside its own guard. A throw from one feature MUST NOT prevent any
  later feature from registering, and MUST be surfaced visibly, never swallowed
  (constitution invariant 2): it is written to the MinSpec output channel with the feature
  name and stack, and one error notification names the feature that failed to start. (DQ-4
  covers whether that notification is shown in a folder without `.minspec/`.) This replaces
  today's ad-hoc per-call guards such as `extension.ts:282`; it does not remove guards a
  feature needs internally.

- **FR-6 - The manifest stays hand-authored and is checked, not generated.**
  `packages/minspec/package.json` `contributes` remains the single authored source of command
  ids, titles, menus and keybindings (DQ-2). The existing parity test
  (`packages/minspec/tests/extension-extra.test.ts:551`) MUST stay green unchanged, and gains a second
  assertion: every `command` named in `contributes.menus.*` and `contributes.keybindings`
  is a contributed command id.

- **FR-7 - Partition test.** `packages/minspec/tests/feature-registry.test.ts` MUST assert, from the exported
  tables and without activating: no command id appears in two features' tables; the union of
  all tables equals `contributes.commands`; and every feature module in `src/features/`
  (other than `activation-context.ts` and `register-commands.ts`) is called from
  `activate()` exactly once. A control case MUST show the test failing when a row is
  duplicated or dropped (a passing test that cannot fail proves nothing).

- **FR-8 - The `features` layer in the layer rules.** `eslint.config.mjs` MUST gain a
  `features` layer with: `features -> { commands, views, lib, @aiclarity/shared, vscode }`;
  no `features/<a>.ts` may import `features/<b>.ts` except `activation-context.ts` and
  `register-commands.ts`; and `lib`, `views` and `commands` MUST NOT import `features`.
  `extension.ts` keeps `-> anything`. The SPEC-040 runtime-cycle gate MUST stay green. This
  is a tightening (one new layer, more rules), recorded as a DR-064 amendment in Plan (DQ-1).

- **FR-9 - Behaviour is byte-for-byte the same.** After the change, a full activation in the
  existing test harness MUST produce the same set of: registered command ids; created tree
  view ids; registered providers (code lens, completion, diagnostics) and their selectors;
  file-watcher glob patterns; `setContext` keys; and status bars. Startup order constraints
  MUST hold: active-editor tracking first, the presence heartbeat started before any command
  registers, and the session-id env var sync gated on opt-in exactly as today (#2356).

- **FR-10 - Lands incrementally.** The migration MUST be possible one feature per pull
  request, with every intermediate state green: the parity test (FR-6) and the activation
  tests hold at each step because a feature not yet moved is still registered inline in
  `activate()`. FR-1's "no inline registration" assertion and FR-7's "union equals manifest"
  assertion switch on in the last step (DQ-5).

- **FR-11 - The new-command recipe is written down.** A short section in
  `packages/minspec/README.md` (exact place fixed at Plan) MUST state the footprint of
  adding a command to an existing feature: `package.json` (`contributes.commands`, and menus
  or keybindings if any), the feature module's table, the handler file, and its test - and
  that `extension.ts` is not on the list.

## Acceptance Criteria

- [ ] `activate()` in `extension.ts` is under 80 lines and contains none of the calls or
      literals FR-1 bans; a grep test pins it. (FR-1)
- [ ] Every one of the 44 contributed command ids appears in exactly one feature table;
      `packages/minspec/tests/feature-registry.test.ts` passes, and fails in its control cases (duplicated
      row, dropped row, feature module not called). (FR-2, FR-4, FR-7)
- [ ] `registerCommand` appears in exactly one file under `packages/minspec/src` outside
      `src/test/**`: `features/register-commands.ts`. (FR-4)
- [ ] With a feature's `register` stubbed to throw, every other feature's commands are still
      registered, the output channel holds the feature name and stack, and exactly one error
      notification was shown. The Alt+A regression test (`packages/minspec/tests/extension.test.ts:467`) still
      passes. (FR-5)
- [ ] `packages/minspec/tests/extension-extra.test.ts:551` passes unchanged; its new menu/keybinding
      assertion passes and fails when a menu names an uncontributed id. (FR-6)
- [ ] `npm run lint` fails on a fixture where `features/a.ts` imports `features/b.ts`, and
      on one where `lib/` imports `features/`; `npm run check:cycles` passes. (FR-8)
- [ ] A before/after activation snapshot (command ids, tree view ids, provider selectors,
      watcher globs, `setContext` keys, status-bar count) is identical. The snapshot test is
      written and green on the pre-refactor code first. (FR-9)
- [ ] `packages/minspec/tests/extension.test.ts`, `packages/minspec/tests/extension-extra.test.ts`,
      `packages/minspec/tests/commands-opt-in-invariant.test.ts`, `packages/minspec/tests/backlog-consent.test.ts` and
      `packages/minspec/tests/presence-opt-in-invariant.test.ts` pass without edits to their assertions
      (edits to imports or mock setup are allowed and listed in the PR). (FR-9)
- [ ] The rebuilt `.vsix` installs and every palette command, keybinding (Alt+A, Alt+N,
      Ctrl+K Ctrl+P) and tree view works by hand in a folder with `.minspec/`; in a folder
      without it, nothing new is written or shown (invariant 3). (FR-9)

## Invariants (must not break)

- **INV-1 - No behaviour change.** This is a structural refactor. No command is added,
  removed, renamed or retitled; no prompt, toast, write or network call changes.
- **INV-2 - Offline (constitution invariant 1).** No new network call; the registry is
  in-process code.
- **INV-3 - No silent gate (constitution invariant 2).** A feature that fails to start is
  reported visibly (FR-5). Isolation must not become swallowing.
- **INV-4 - Blast radius (constitution invariant 3, DR-074).** Every opt-in guard in today's
  `activate()` (presence heartbeat, session-id env var, decisions INDEX regeneration, auto-
  bootstrap) moves with its feature unchanged; SPEC-096's opt-in test passes.
- **INV-5 - Layer rules (SPEC-040).** No existing layer rule is loosened; the runtime-cycle
  gate stays green.
- **INV-6 - Test seam.** Handlers are still captured through
  `vscode.commands.registerCommand`, so activation tests keep invoking commands the way the
  palette does.

## Decisions needed (Clarify)

### DQ-1 - Where do feature modules live?

- **A (rec)** - a new `src/features/` layer with its own rules (FR-8). Clear home, and the
  "features never import each other" rule is enforceable. *Cost:* changes the layer set,
  which `eslint.config.mjs:13` says is a DR-064 amendment - one more layer every contributor
  must learn.
- **B** - put them in `src/commands/register-*.ts`. No layer change. *Cost:* `commands/` may
  import `commands/`, so feature-to-feature imports cannot be banned without a filename-based
  rule, and the directory mixes handlers with wiring.

### DQ-2 - Generate `contributes.commands` from the code, or keep checking it?

- **A (rec)** - keep `package.json` hand-authored; check it (FR-6). Drift for command ids is
  already gated (`packages/minspec/tests/extension-extra.test.ts:551`); FR-6 closes the menus/keybindings
  half. *Cost:* adding a command still touches `package.json` as well as the feature table -
  two places, kept honest by a test, not by construction. That co-change is inherent: the
  title, menu placement and keybinding are manifest data VS Code reads before any code runs.
- **B** - the feature tables carry title, menus and keybindings, and a generator writes
  `contributes` into `package.json` (committed, with a CI check that it is current). One
  source of truth. *Cost:* a generator in the release path, `package.json` becomes a derived
  file that `vsce`, the command-reference gate (`packages/minspec/tests/command-reference-gate.test.ts`) and
  SPEC-086's tests read, and every hand edit to `contributes` is overwritten - a new failure
  mode for a gain the parity test already delivers. Raises the tier to T4.

### DQ-3 - How do features ask each other to refresh?

- **A (rec)** - a small typed event set on `ActivationContext` (`specsChanged`,
  `decisionsChanged`, `epicsChanged`, `approvalsChanged`, `optInChanged`): the watcher's owner
  fires, consumers subscribe. Registration order stops mattering for refresh wiring. *Cost:*
  one indirection - "what refreshes when a spec changes?" is answered by grepping
  subscribers, not by reading one watcher body.
- **B** - named refresh hooks on `ActivationContext` (`refreshNextTask()`,
  `refreshCodeLens()`, ...), filled in by the owning feature. Direct and greppable. *Cost:*
  late-bound - a feature that calls a hook before its owner registered gets a no-op, which is
  an order dependency the type system does not see.

### DQ-4 - Does FR-5's error notification show in a folder without `.minspec/`?

- **A (rec)** - yes. A feature failing to start is an extension defect, not a MinSpec
  behaviour in the project; hiding it would be a silent failure (invariant 2), and VS Code
  already shows a notification when `activate()` throws today. *Cost:* an installed-but-not-
  opted-in user can see a MinSpec error toast - but only when MinSpec is broken, which they
  already can today.
- **B** - output channel only when not opted in. *Cost:* the failure is invisible to the one
  user who has not opted in yet, and arguably reads as an invariant-3 carve-out of invariant 2.

### DQ-5 - Sequencing against in-flight work

- **A (rec)** - one feature per pull request, smallest-coupling first (docs-lane,
  authoring, classify, backlog), cross-coupled features (scaffold, session, progress,
  traceability) last; FR-1/FR-7's strict assertions switch on in the final pull request.
  Each step conflicts with only the in-flight pull requests touching that feature's lines.
  *Cost:* about a dozen pull requests, and `extension.ts` is half-migrated for their
  duration.
- **B** - one pull request. *Cost:* conflicts with every in-flight pull request that touches
  `extension.ts` at once - the exact merge-conflict cost #694 exists to remove - and a single
  ~1,000-line diff to review.

## Why no new DR

Every choice here can be undone in under a day: feature modules can be inlined back into
`activate()` mechanically, and DQ-2 A keeps the manifest exactly as authored today. The one
architectural record touched is DR-064 (layer set), which FR-8 amends rather than replaces;
Plan writes that amendment if DQ-1 A is chosen. If Clarify picks DQ-2 B (codegen), that is a
build-pipeline decision a DR should record, and Plan creates it.

## Out of Scope

- Lazy activation (per-command `activationEvents`, dynamic `import()` of feature modules).
  `activationEvents` is `[]` today and VS Code infers it from `contributes`; changing load
  timing is a behaviour change (INV-1). Can follow as its own issue once features are modules.
- Moving any check into SPEC-136's headless core.
- Relocating the seven `lib/` files that value-import `vscode` (#830).
- Any change to command titles, palette wording, menus or keybindings.

## Alternatives considered and rejected

- **Keep `activate()` and only extract handler bodies.** Already largely done - handlers
  live in `src/commands/` (20 files). The remaining 696 lines are wiring, which is what
  conflicts. Rejected: does not touch the hub.
- **Read the command list from `package.json` at runtime and look handlers up by id.**
  Makes the manifest the registry with no generator. Rejected: a missing handler becomes a
  runtime lookup failure instead of a test failure, and handler closures still need the
  feature context, so the wiring problem remains.
- **Decorators / reflection-based registration.** Rejected: needs `experimentalDecorators`
  or metadata at runtime in an esbuild bundle, and hides registration from grep.

## Test plan (for the Plan phase to place)

1. Write the FR-9 activation snapshot test against today's code and see it green - it is the
   regression oracle for every later step.
2. Add FR-6's menus/keybindings assertion (green today; control: a fixture naming a fake id).
3. Per migrated feature: the snapshot and parity tests stay green with no assertion edits.
4. Final step: FR-1 grep test, FR-7 partition test with its three control cases, FR-5
   throw-isolation test, FR-8 lint fixtures.
5. Rebuild the `.vsix` and exercise it by hand (last AC).

## Traceability

- Issue: [#694](https://github.com/AIClarityAU/minspec/issues/694)
- Layer rules: SPEC-040 / DR-064 (`eslint.config.mjs`)
- Manifest parity test: SPEC-086 FR-4, FR-7 (`packages/minspec/tests/extension-extra.test.ts:551`)
- Opt-in guards that move with their features: SPEC-096, DR-074, #2328, #2356, #2461
- Sibling table of editor-free operations: SPEC-136

## Follow-ups (tracked)

None filed by this spec. Lazy activation (Out of Scope) is a candidate issue once the
modules exist; it is not filed now because nothing in this spec defers work to it.
