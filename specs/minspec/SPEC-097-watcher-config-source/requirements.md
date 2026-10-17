---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — specsDir/decisionsDir/epicsDir are the paths the whole spec/ADR/epic discovery pipeline resolves against; a watcher that disagrees with that pipeline about where they are is a core-engine defect, not a view-layer cosmetic
aspects: [config-resolution, file-watcher, multi-root, no-silent-gate, activation, bug-hunt]
relates_to: ["#153", "#123"]
implements: [packages/minspec/tests/extension-watcher-config-source.test.ts]
affects: [packages/minspec/src/extension.ts, packages/minspec/tests/extension-extra.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: File watchers read the same directory config every other command reads (Requirements)

> **This is a SPECIFICATION ONLY.** No code or test is created by the dispatch that
> produced this document. A human reads it, resolves the Clarify question below, and
> approves it through the normal spec-approval gate before anything is built. The
> question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-03-ratified-only-by-approval-of-this-spec)**;
> the human resolves it by approving this spec with that in place, or by changing it first.

Materializes the one still-open item from **[#153](https://github.com/AIClarityAU/minspec/issues/153)**
(*"bug-hunt: remaining confirmed bugs (2026-06-04) — parser, validator, multi-root, misc"*):

> extension.ts:243/276 — watchers derive dir from VS Code setting, not `.minspec/config.json` → desync.

## Why this is the only item left to specify

#153 tracked 29 bugs from a 2026-06-04 read-only bug-hunt (the 3 HIGH + the dollar-corruption
class were split out as #149–#152, out of scope here). Re-checking every remaining item
against the current `origin/main`-tracking branch (HEAD `350c6fa4`) before writing this spec,
28 of the 29 are already fixed, each as a direct, narrowly-scoped commit carrying its own
RCDD root cause and a failing-first test — no Specify phase needed because each was mechanical
and single-file:

| Cluster | Status | Evidence |
|---|---|---|
| spec.ts parser (quoted enum scalars, empty `title:`, CRLF frontmatter, product/type round-trip) | Fixed | `c5cc982b`, `3253c606`, `e08d481d`, `e32b989d` — all tagged `#153.1`–`#153.4` in `packages/minspec/src/lib/spec.ts` comments and `spec.test.ts` |
| spec-validator false pos/neg (ascii-box, checkbox-acceptance fallback, ux dead clause, api/data over-match) | Fixed | `9c1ec7b3`, `b2aed646`, `e58a1f09`, `f11f1415` — tagged `#153.1`–`#153.4` in `spec-validator.ts` / `spec-validator.test.ts` |
| multi-root: `approve.ts` / `validate.ts` bare `workspaceFolders[0]` | Fixed | both now call `folderForFile(...) ?? resolveTargetFolder()` (`approve.ts:228-229,463-464`; `validate.ts:28-29`) |
| multi-root: `example.ts` first-folder + load-time date | Fixed | `821cd718` — `generateExampleCommand` now calls `resolveTargetFolder()` (`example.ts:16`) |
| misc: `git-analyzer.ts` docstring + root `package.json` pathspec | Fixed | `99d7177b` |
| misc: `merge-refresh.ts` duplicate-section drop | Fixed | `d8401a75` |
| misc: `init.ts` silent partial write | Fixed | `80a79aae` |
| misc: `spec-manager.ts` `buildSummary` omits `product` | Fixed | `99d7177b` |
| misc: `epic-manager.ts` / `adr-manager.ts` no-frontmatter slug/title | Fixed | `99d7177b` |
| **misc: `extension.ts` watcher dir source** | **Open** | this spec |

Each fixed row is cited by commit, not by issue-closed state alone (Evidence Discipline —
*artifact-existence ≠ feature-existence*): the commit message, the `#153.N` code/test tags,
and the current source were all read, not inferred from a closed label.

## One-Sentence Scope

Make the three directory-scoped file watchers `activate()` creates (specs, decisions, epics)
resolve their watched directory the same way every other directory-aware command does —
`.minspec/config.json` as the base, an explicit VS Code setting as an override — instead of
reading only the VS Code setting with a hard-coded default that shadows the config file.

## Context — the defect, measured

`packages/minspec/src/extension.ts` creates three `FileSystemWatcher`s whose base directory
comes straight from a VS Code setting read with a literal default, never from
`.minspec/config.json`:

```ts
// extension.ts:519
const specsDir = vscode.workspace.getConfiguration('minspec').get<string>('specsDir', 'specs');
// extension.ts:541
const decisionsDir = vscode.workspace.getConfiguration('minspec').get<string>('decisionsDir', 'docs/decisions');
// extension.ts:627
const epicsDir = vscode.workspace.getConfiguration('minspec').get<string>('epicsDir', 'docs/epics');
```

`vscode.workspace.getConfiguration(...).get(key, fallback)` returns `fallback` whenever the
*user or workspace settings.json* has no explicit value for that key — it never consults
`.minspec/config.json` at all. `.minspec/config.json` is the project's own declared source of
truth for these three paths (`packages/minspec/src/lib/config.ts:44-46`, `MinspecConfig.specsDir`
/ `decisionsDir` / `epicsDir`), and every other directory-aware command in the codebase reads it
first and treats the VS Code setting as an *override*, via the established pattern:

```ts
// packages/minspec/src/commands/example.ts:19-23 (same shape in classify.ts,
// active-spec.ts, epic-manager.ts, adr-manager.ts)
const config = loadConfig(folder);
const vscodeConfig = vscode.workspace.getConfiguration('minspec');
const finalConfig = applyVSCodeOverrides(config, {
  specsDir: vscodeConfig.get('specsDir'),   // no default — undefined falls through to config.json
});
```

`applyVSCodeOverrides` (`config.ts:214-226`) merges with `overrides.specsDir ?? config.specsDir`
— the override wins only when the VS Code setting is *explicitly* set; otherwise the loaded
`.minspec/config.json` value wins. The watcher call sites skip `loadConfig` entirely and pass a
literal default straight into `.get()`, so a project that customised `specsDir` in
`.minspec/config.json` but never touched the VS Code setting gets watchers pinned to the
hard-coded default (`'specs'`, `'docs/decisions'`, `'docs/epics'`) while every read/write
command elsewhere in the extension (spec discovery, validation, approval, the example-spec
generator, classify) correctly resolves the configured path. The watcher silently watches the
wrong directory: edits under the real `specsDir` never fire `onSpecsChanged`, so the spec tree,
the spec panel, and the next-task resolver (`extension.ts:528` `refreshNextTask()`) all go
stale with no error, no warning, nothing in the Output channel — a config-source desync, not a
config-read failure, so there is no exception to surface and no log line that would hint at it.

Three watchers are affected; a fourth config-shaped directory (`.minspec/` itself, for
`traceabilityWatcher` and `approvalsWatcher`, `extension.ts:585`, `:608`) is not — those two use
a literal `.minspec/...` pattern with no configurable directory, so they are out of scope by
construction, not by omission.

## Functional Requirements

- **FR-1 (watchers resolve through `loadConfig` + `applyVSCodeOverrides`, not a raw `.get()`
  default).** The specs, decisions, and epics watcher setup in `extension.ts` MUST resolve
  their base directory the same way `example.ts`/`classify.ts`/`active-spec.ts` do: load
  `.minspec/config.json` via `loadConfig(workspaceRoot)`, then apply the VS Code setting as an
  override using `applyVSCodeOverrides`, passing the setting to `.get(key)` **without** a
  default argument so an unset setting falls through to the config value rather than shadowing
  it.

- **FR-2 (explicit VS Code setting still wins).** When a workspace or user `settings.json`
  explicitly sets `minspec.specsDir` (or `decisionsDir` / `epicsDir`), that value MUST still
  take effect for the corresponding watcher, matching the existing override precedence used by
  every other command. This FR exists so FR-1 cannot be satisfied by simply deleting the VS
  Code read.

- **FR-3 (default behaviour is unchanged when neither source customises a path).** With no
  `.minspec/config.json` present (or one that does not declare a given key) and no VS Code
  setting set, each watcher MUST watch the same default directory it watches today (`specs`,
  `docs/decisions`, `docs/epics`). This is the common case and MUST NOT regress.

- **FR-4 (no new silent failure mode).** `loadConfig` already fails closed to
  `DEFAULT_CONFIG` on a missing or unreadable `.minspec/config.json` (`config.ts:179-192`) —
  this spec MUST rely on that existing behaviour rather than adding a second, watcher-local
  try/catch that could diverge from it (constitution invariant 2 — one failure-handling path,
  not two that can disagree).

- **FR-5 (a regression test that fails against today's code).** A new test MUST construct the
  three watchers (directly, or via `activate()` with the existing mock harness in
  `extension-extra.test.ts`) with `.minspec/config.json` declaring a non-default value for
  `specsDir`, `decisionsDir`, and `epicsDir`, no VS Code setting set, and assert that the
  `RelativePattern` each watcher is constructed with targets the **configured** directory, not
  the hard-coded literal default. The existing `loadConfig` mock in `extension-extra.test.ts`
  (`:226`, currently `{ specsDir: 'specs' }` only) MUST be extended to return `decisionsDir` and
  `epicsDir` too, so the mock itself cannot hide the other two watchers' behaviour the way a
  partial mock hid the unreachable branch in #2329/SPEC-085's `backlog-view.test.ts:412`.

## Acceptance Criteria

- [ ] With `.minspec/config.json` declaring `specsDir: "requirements"` and no VS Code
      `minspec.specsDir` setting, the spec watcher's pattern targets `requirements/**/*.md`,
      not `specs/**/*.md`. (FR-1, FR-5)
- [ ] Same check for `decisionsDir` and `epicsDir`. (FR-1, FR-5)
- [ ] With an explicit VS Code `minspec.specsDir` setting AND a different
      `.minspec/config.json` value, the VS Code setting's directory is the one watched. (FR-2)
- [ ] With neither source set, all three watchers target today's defaults
      (`specs`, `docs/decisions`, `docs/epics`) — unchanged from current behaviour. (FR-3)
- [ ] The new test is shown to fail against the pre-fix code (`extension.ts:519,541,627` as
      measured above) before the fix lands. (FR-5)
- [ ] No new `try`/`catch` is added around the directory resolution in `extension.ts`; it
      relies on `loadConfig`'s existing fail-closed-to-default behaviour. (FR-4)

## Invariants (must not break)

- **INV-1 (constitution invariant 1 — offline core).** `loadConfig` and `applyVSCodeOverrides`
  are both pure filesystem/config reads already used elsewhere in this codebase; this change
  adds no network call and no new dependency.
- **INV-2 (constitution invariant 2 — no silent gate).** The fix must not introduce a new path
  where a config read failure is swallowed into a default with no visible signal beyond what
  `loadConfig` already does today (see FR-4). It also *removes* an existing silent-divergence
  mode (watcher disagrees with every other command about where `specsDir` is, with no error),
  which is the defect's own shape.
- **INV-3 (one resolution path per directory).** After this fix, every command and every
  watcher that needs `specsDir`/`decisionsDir`/`epicsDir` MUST resolve it through the same
  `loadConfig` + `applyVSCodeOverrides` pair — no second, watcher-only resolution helper.

## Clarify selections (recorded by an agent 2026-10-03; ratified only by approval of this spec)

This repository runs with `"autonomy": "act"` (`.minspec/config.json`), under which an agent
proceeds on a stated recommendation and records the alternative on the spec rather than
blocking on it (DR-086 §2/§4). The question below carries a **Recorded selection** line naming
the option this document already assumes; approving this spec as written ratifies it.

### CQ-1 — Does this spec also fix the single-`workspaceRoot` limitation shared by *every*
watcher `activate()` creates (the multi-root parent issue, #123)?

**Recorded selection: Option A**, fix only the config-source bug #153 names; leave the
single-root watcher-wiring limitation where it already lives.

- **Option A — config source only (rec).** All three watchers (and every sibling watcher in
  `activate()`) are already scoped to one `workspaceRoot` chosen once at activation — a
  pre-existing, much wider limitation that applies equally to the git watcher, the
  traceability watcher, and the approvals watcher, none of which #153 named. Fixing it means
  re-wiring watcher *lifecycle* per folder (create/dispose as folders are added/removed), which
  is a different mechanism change, not a one-line config-source swap. *Cost:* a multi-root
  workspace where a non-primary folder customises `specsDir` in its own `.minspec/config.json`
  still only gets watchers scoped to the primary folder's root — unchanged from today, and
  explicitly out of scope below.
- **Option B — fix both in one spec.** *Cost:* conflates a narrow, mechanical, already-proven
  fix pattern (FR-1–FR-5 above, which mirror five existing call sites) with an open-ended
  per-folder watcher-lifecycle redesign that has no existing call site to copy from — the kind
  of scope creep the triage rule "detection ≠ integration" exists to catch. It would also make
  this spec's own `relates_to: ["#123"]` a false "implements", when #123's bootstrap-offer half
  is already handled elsewhere (`extension.ts:665-692`, `runBootstrap` per folder) and its
  watcher half is untouched by either.

## Out of Scope

- **Per-folder watcher lifecycle for multi-root workspaces (#123's watcher half).** CQ-1.
- **The `traceabilityWatcher` and `approvalsWatcher` patterns** (`extension.ts:585`, `:608`) —
  both watch a literal `.minspec/...` path with no configurable directory, so there is no
  config-source bug to fix there.
- **Adding a new `.minspec/config.json` key or changing `MinspecConfig`'s shape.** `specsDir`,
  `decisionsDir`, and `epicsDir` already exist; this spec wires three more read sites to them.
- **Re-litigating the override precedence itself** (VS Code setting wins when explicit,
  `.minspec/config.json` wins otherwise). That precedence is the existing, already-shipped
  behaviour of `applyVSCodeOverrides`; this spec applies it, not redesigns it.

## Why no new DR

This spec makes no new design choice — it applies an existing, already-shipped resolution
pattern (`loadConfig` + `applyVSCodeOverrides`, used by five existing call sites) to three more
call sites that had skipped it. Under the reversibility filter (DR-359: can it be undone in
under a day?) this is a same-day-revertable diff to one file plus one test file, with no new
public contract, setting, or config key. CQ-1 Option B, if ever selected instead, would likely
need its own spec (a per-folder watcher lifecycle is not a same-day revert) — but that is not
the option this spec recommends or assumes.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `extension-watcher-config-source.test.ts` (FR-5), shown red
  against current `extension.ts`.
- **Existing test that changes:** `extension-extra.test.ts`'s `loadConfig` mock (`:226`) gains
  `decisionsDir` and `epicsDir` fields so the other two watchers aren't exercised against an
  incomplete mock config.

## Traceability

- **Issue:** [#153](https://github.com/AIClarityAU/minspec/issues/153) — the last open item of
  29; see the table above for the other 28.
- **Adjacent, not absorbed:** [#123](https://github.com/AIClarityAU/minspec/issues/123)
  (multi-root bootstrap-offer epic; this spec's CQ-1 explains why its watcher-lifecycle half
  stays separate).
- **Governing decisions:** none directly on point; see "Why no new DR".
- **DR for this spec:** none, by design.
