---
id: SPEC-068
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-068 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - "marker-bounded updates that never surprise-write"
relates_to: [DR-092, DR-089, DR-066, DR-003, SPEC-043, SPEC-060, SPEC-063, "#1095", "#1835", "#3269"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-068 - Design: the harness refresh direction gate

Plan for [requirements.md](requirements.md). The contract is that file; this one says how
to build it. Citations of "today" are against `origin/main` at `a799afcc`, the commit this
plan was written on. requirements.md cites line numbers from 2026-09-06; several have moved,
and the table below gives the current ones. New code is named by symbol, because its line
numbers will move. Where a fact below was read rather than run, it says so; the task that
builds on it re-checks it.

## Approach in one paragraph

A new vscode-free module, `harness-provenance.ts`, owns four things: the two source
constants (`TEMPLATE_EPOCH`, `TEMPLATE_EPOCH_DIGEST`), the corpus digest that the constants
must match, the read and write of the tracked record `.minspec/harness-provenance.json`,
and one pure function, `decideDirection`, that turns (bundle epoch, record) into one of
four verdicts. `refreshHarnessFiles` calls `decideDirection` once, before its first
content write, and threads one boolean, `hold`, into every write that can replace existing
MinSpec-owned content: the Markdown merge's single "take the template body" branch, the
managed-region splice, and the AGENTS.md slash-command section. Creation and heading
appends never consult it. A held run reports one notice naming every held path and both
epochs, records a sentinel instead of the bundle's hash for each held entry in the drift
baseline, and leaves the record alone. The digest check is one function called from
`npm run validate` (CI's required `lint` job), from a vitest case (CI's required `test`
job) and from the package script, so a template edit without an epoch bump goes red on
every surface that ships a bundle.

## What the plan relies on (read at a799afcc)

| Fact | Where |
|---|---|
| Refresh entry point; first content write is the `TEMPLATE_NAMES` loop | `refreshHarnessFiles` - `packages/minspec/src/lib/scaffold.ts:1821`; loop at `:1921-1946` |
| Markdown create-if-missing (FR-8 exempt) | `scaffold.ts:1926-1929` |
| Markdown merge; the only branch that replaces an existing heading's body with the template's | `mergeFile` - `merge-refresh.ts:711`; the branch is `merge-refresh.ts:1051-1054` ("proven unmodified ... use new template"). Every other existing-heading branch pushes `existingBody` (`:885`, `:983`, `:1015`, `:1046`) |
| Markdown heading append (FR-8 exempt) | `merge-refresh.ts:1057-1060` ("New section in template") |
| Managed-region create / re-scaffold of a deleted file (FR-8 exempt) | `scaffold.ts:1226-1229` (refresh), `generateManagedRegionTemplates` `:888` (scaffold) |
| Managed-region splice (the second write path) | `refreshManagedRegionTemplates` - `scaffold.ts:1207`; write at `:1275-1278` |
| Marker auto-heal: re-adds markers around a body byte-identical to the running template, so it changes no content | `tryAutoHealManagedRegion` - `scaffold.ts:1143`; called at `:1262-1266` |
| Consent-gated whole-file overwrite from a warning action | `rescaffoldManagedRegionFile` - `scaffold.ts:1294`; called from `init.ts:1478` |
| AGENTS.md slash-command section, rewritten in place when it differs | `generateSlashCommandShims` - `slash-commands.ts:378`, write at `:409-416`; body from `buildAgentsSlashCommandSection()` (no arguments, so project-independent) |
| Drift baseline re-stamped unconditionally | `saveTemplateBaseline(rootDir, computeTemplateBaseline())` - `scaffold.ts:1965` (refresh) and `:1743` (Initialize); `saveTemplateBaseline` - `merge-refresh.ts:1477` |
| Template corpus walker | `computeTemplateBaseline` - `template-registry.ts:867` (raw `TEMPLATES` sections plus each `MANAGED_REGION_TEMPLATES` rendered block) |
| Drift read | `hasHarnessDrift` - `auto-bootstrap.ts:105`; `harnessDriftSignature` - `:158`. Both iterate only the CURRENT baseline's keys and skip a key whose recorded value is falsy |
| Auto-bootstrap refresh step | `BOOTSTRAP_STEPS` `kind: 'refresh'` - `auto-bootstrap.ts:644-659`; no `alwaysAction`, no `commandArg`; executed by `runBootstrap` via `executeCommand(step.commandId, rootDir, step.commandArg)` (`:969`, `:979`) |
| Interactive refresh command; its second parameter is the one bootstrap's `commandArg` lands in | `initRefreshCommand(folderArg, deps)` - `packages/minspec/src/commands/init.ts:1536`; registered at `extension.ts:381-390` |
| Hold notice precedent (one notice per refresh, never per file) | `preservedWithoutBaselineMessage` / the `preservedNotices` block, `scaffold.ts:2021-2059` |
| Ignore list the record must stay out of | `MINSPEC_GITIGNORE_ENTRIES` - `scaffold.ts:287` |
| Build SHA (diagnostic only) | `buildSha()` - `build-provenance.ts:35` |
| Validate entry and its CI site | root `package.json` `validate` = `npx tsx scripts/validate-frontmatter.ts`; `ci.yml` step "Validate frontmatter" in the `lint` job |
| Required checks on `main` | `lint`, `test`, `MinSpec SDD validation`, `ai-review`, `ready-to-merge`, `build` (read from `/rules/branches/main` on 2026-10-28) |
| Package script | `packages/minspec/package.json` `prepackage` = `npm run supply-chain:check`, `package` = `npm run build && vsce package --no-dependencies` |
| Highest validate rule number | Rule 24 (`scripts/validate-frontmatter.ts:1060`) |

## Clarify decisions taken

requirements.md's five DQs each carry a recommendation, and `phases.clarify` is `done` in
the approved file. This plan takes every recommendation. The rejected option for each is
recorded here, because under the project's `act` autonomy nobody sees it live.

| DQ | Taken | Rejected, and why |
|---|---|---|
| DQ-1 package gate | **Yes**: `prepackage` runs the same check | No package gate: leaves the one moment before a bundle exists unguarded. The cost (a third site) is held down by calling `checkTemplateEpoch`, never restating it |
| DQ-2 override lifetime | **Persisted**: the override writes the record with the bundle's epoch | Per invocation: every refresh in an adopter re-asks forever, which teaches clicking through. The confirmation text carries the weight instead (see *The override*) |
| DQ-3 hold granularity | **Per write target**: Markdown per heading, managed region per file, AGENTS slash section as one target | Whole-refresh hold: would also hold heading appends and file creation, which FR-8 exempts |
| DQ-4 epoch arithmetic | **Increment by one** | Date-derived integer: two bumps on one day collide, and order would come from the clock, which DR-092 rejected as the ordering key |
| DQ-5 migration path | **None**: every adopter takes the override once | Silent stamp when bytes match: an unproven inference that would mint the record without a human, the fail-open direction DR-092 §4 refuses |

## Architecture

### The constants and the digest (FR-1, FR-2)

```ts
// harness-provenance.ts
export const TEMPLATE_EPOCH = 1;
export const TEMPLATE_EPOCH_DIGEST = '<64 hex>';

export interface TemplateCorpus {
  readonly baseline: GeneratedHashes;      // computeTemplateBaseline()
  readonly agentsSlashSection: string;     // buildAgentsSlashCommandSection()
}
export function liveTemplateCorpus(): TemplateCorpus;
export function templateCorpusDigest(corpus: TemplateCorpus): string;   // sha256, hex
export interface TemplateEpochCheck {
  readonly ok: boolean;
  readonly epoch: number;
  readonly recordedDigest: string;
  readonly computedDigest: string;
  readonly message: string;                // remedy text when !ok, '' when ok
}
export function checkTemplateEpoch(
  corpus?: TemplateCorpus,
  recorded?: { epoch: number; digest: string },
): TemplateEpochCheck;
```

The digest is SHA-256 over a canonical serialisation: output paths sorted, headings sorted
within each path, one `path\0heading\0hash\n` line per entry, then the AGENTS slash section
body after a fixed separator line. Sorting makes it independent of object key order, so a
refactor that reorders `TEMPLATES` does not force a bump.

The AGENTS slash section is in the digest because it is the third write path below, and its
body is generated in code, not in `TEMPLATES`. Leaving it out would let that section move
with no epoch change, which is the INV-4 failure in a smaller place.

`checkTemplateEpoch`'s failure message names both digests and the fix: "templates
changed - set `TEMPLATE_EPOCH` to <epoch+1> and `TEMPLATE_EPOCH_DIGEST` to <computed> in
packages/minspec/src/lib/harness-provenance.ts". The first version ships `TEMPLATE_EPOCH = 1`.

**Layout rule.** Each constant sits alone on one line, adjacent, in exactly the
`export const NAME = value;` form. Two branches that both bump the epoch from 41 to 42 for
different template changes then write different digest lines, and git refuses the second
merge as a conflict. A test pins the layout so this property cannot be lost by reformatting.

### The record (FR-3)

```ts
export const HARNESS_PROVENANCE_FILENAME = 'harness-provenance.json';
export interface HarnessProvenance {
  readonly templateEpoch: number;                              // load-bearing
  readonly writtenBy: { readonly version: string; readonly buildSha: string };  // diagnostic
  readonly writtenAt: string;                                  // ISO 8601, diagnostic
}
export type ProvenanceRead =
  | { readonly state: 'present'; readonly record: HarnessProvenance }
  | { readonly state: 'absent' }
  | { readonly state: 'unreadable'; readonly reason: string };
export function readHarnessProvenance(rootDir: string): ProvenanceRead;
export function writeHarnessProvenance(
  rootDir: string,
  epoch: number,
  writtenBy: { version: string; buildSha: string },
): void;
```

`readHarnessProvenance` returns `unreadable` for invalid JSON, a non-object, or a
`templateEpoch` that is not a positive safe integer. The diagnostic fields are optional on
read; a record missing them is still `present`. `writeHarnessProvenance` calls
`assertOptedIn` first, so it can never create `.minspec/` (constitution invariant 3), and
writes JSON with two-space indent and a trailing newline. It never runs git: the file is
committed by the human with the rest of the refresh, through the existing post-refresh
commit offer.

`version` comes from the caller. `refreshHarnessFiles` takes it as an option so the lib
stays vscode-free; `initRefreshCommand` passes the extension's `packageJSON.version`, and
any other caller gets `'unknown'`. `buildSha` is `buildSha()`.

### The verdict (FR-4, INV-2)

```ts
export type DirectionVerdict =
  | { readonly kind: 'ahead'; readonly bundle: number; readonly repo: number }
  | { readonly kind: 'level'; readonly bundle: number }
  | { readonly kind: 'behind'; readonly bundle: number; readonly repo: number }
  | { readonly kind: 'unknown'; readonly bundle: number; readonly reason: 'absent' | 'unreadable'; readonly detail?: string };
export function decideDirection(read: ProvenanceRead, bundleEpoch?: number): DirectionVerdict;
export function holdsWrites(v: DirectionVerdict): boolean;   // behind | unknown
```

Pure: it takes the already-read record, so the verdict table is tested without a
filesystem. `bundleEpoch` defaults to `TEMPLATE_EPOCH`.

### The hold, at each write path (FR-4, FR-8, INV-1, INV-3)

`refreshHarnessFiles(rootDir, options?)` gains:

```ts
export interface RefreshOptions {
  readonly writtenByVersion?: string;
  /** Only honoured when the verdict is `unknown` (FR-6). */
  readonly overrideUnknown?: { readonly confirmedTargets: readonly string[] };
}
```

The verdict is computed right after `assertOptedIn`, before `writeScaffoldDefaults`.
`hold = holdsWrites(verdict) && !overrideAccepted`. A hold target is a string
`<outputPath>` or `<outputPath>#<heading>`; the list of them is the unit the report, the
baseline and the override all share.

| Write | Under `hold` |
|---|---|
| Markdown file absent | Written (FR-8) |
| `mergeFile` heading absent from disk (append) | Written (FR-8) |
| `mergeFile` existing heading, proven unmodified, template body differs (`:1051-1054`) | Existing body kept; heading reported in a new `MergeResult.directionHeld` |
| `mergeFile` existing heading, any other branch | Unchanged: those branches already keep the existing body |
| Managed-region file absent | Written (FR-8) |
| Managed-region auto-heal | Written: it restores markers around a body equal to the running template, so no managed content moves |
| Managed-region splice where `updated !== original` | Not written; `outputPath` held |
| AGENTS.md slash section where the file exists and the injected text differs | Not written; target `AGENTS.md#minspec:agents-slash-section` held. Done in `scaffold.ts` by calling `generateSlashCommandShims` with `agents: false` for that run, so `slash-commands.ts` is not edited |
| `rescaffoldManagedRegionFile` | Refused under `hold`: returns `false` with the same hold notice, so the warning action cannot bypass the gate |
| Config defaults, `.gitignore`/`.gitattributes` backfill, constitution seeding, Claude hook registration, legacy-shim removal, `core.hooksPath` | Unchanged. None replaces MinSpec-owned template content with older template content |

`mergeFile` gains a fourth parameter, `options?: { holdReplacements?: boolean }`. The
default is `false`, so every existing caller and every existing test is untouched. Under
the hold, the manifest recorder needs no change: the kept body is what disk holds, and it
was proven to be MinSpec's own earlier output, which is exactly what the manifest records.

INV-3 holds by construction: `hold` only ever turns a write into a keep. No branch reads
`verdict.kind === 'ahead'` as permission; DR-089's authorship decisions run exactly as
today and the hold applies after them.

### The notice (FR-5)

One `ManagedRegionWarning` per held refresh, new `kind: 'direction-held'`, with
`outputPaths` listing every held target and a new optional field `direction` carrying the
verdict. It is placed first in the returned list, ahead of `preservedNotices`, because it
explains every other notice in a held run. `refreshSummaryMessage` (`init.ts`) gains a
branch so the toast says templates were held, never "Refreshed harness files."

Message text, by verdict:

- **behind**: "MinSpec held N harness updates. This project's harness files were written by
  template epoch R; the installed MinSpec carries epoch B, which is older. Writing would
  revert them. Update the MinSpec extension, then run Refresh Harness Files again. Held:
  <targets>."
- **unknown**: "MinSpec held N harness updates. This project has no readable
  .minspec/harness-provenance.json (<absent | unreadable: detail>), so MinSpec cannot tell
  whether its templates (epoch B) are newer than the files on disk. Run MinSpec: Refresh
  Harness Files and choose Review and write to see the list and confirm once. Held:
  <targets>."

A refresh with zero held targets raises no notice, whatever the verdict: nothing was
withheld, so there is nothing to act on (DQ-5: no record is minted for it either).

### The record write after a refresh (FR-3, DQ-2)

| Verdict | Record after the run |
|---|---|
| ahead | Written with the bundle epoch |
| level | Untouched |
| behind | Untouched |
| unknown, held | Untouched |
| unknown, override accepted | Written with the bundle epoch |

Written last, after `recordVerifyAndSaveManifest`, so a throw earlier in the refresh leaves
the old record in place.

`generateHarnessFiles` (Initialize) writes the record only when no record exists and every
Markdown and managed-region target was created by this run, which is the first-adoption
case. If any target already existed it writes nothing, so an Initialize re-run with a stale
bundle cannot mint a record for content it did not write; the next refresh is then
`unknown`, the fail-closed state.

### The drift baseline under a hold (FR-7)

`saveTemplateBaseline` is still called, with `computeTemplateBaseline()` overlaid: for each
held target, the recorded value becomes `HELD_BASELINE_SENTINEL` (`'held:direction-gate'`).
Markdown targets overlay `baseline[path][heading]`; managed-region targets overlay
`baseline[path][tpl.name]`; the AGENTS slash target is stored under
`baseline['AGENTS.md']['minspec:agents-slash-section']`.

The sentinel never equals a SHA-256 hex string, so the existing loop in `hasHarnessDrift`
reads `recorded !== now` and returns true for every Markdown and managed target. The AGENTS
key is not in `computeTemplateBaseline()`, so the loop never visits it. One exported helper,
`baselineHasHeldEntry(baseline)`, returns true when any recorded value is the sentinel, and
both `hasHarnessDrift` and `harnessDriftSignature` call it, so all three target kinds keep
the signal true. The signature adds a `held` line keyed by the held targets, so a dismissed
prompt re-asks when the held set changes and not otherwise.

The bootstrap prompt text ("Harness templates updated since last refresh") is left as is.
Clicking it runs the refresh, which raises the hold notice that explains the state.

### The override (FR-6, DQ-2)

Interactive command only. `initRefreshCommand`:

1. Calls `refreshHarnessFiles(folder, { writtenByVersion })`.
2. If the result carries a `direction-held` notice whose verdict is `unknown`, and
   `deps.origin !== 'auto-bootstrap'`, it writes the held target list to the MinSpec output
   channel (shown without taking focus) and shows a non-modal warning: "MinSpec cannot
   confirm these N harness files are older than its templates. Writing replaces MinSpec's
   sections in them and records epoch B in .minspec/harness-provenance.json, so later
   refreshes will not ask again. The list is in the MinSpec output panel." with actions
   `Review and write` and `Keep files`.
3. `Review and write` calls `refreshHarnessFiles(folder, { writtenByVersion,
   overrideUnknown: { confirmedTargets } })`.

Inside `refreshHarnessFiles` the override is accepted only if the verdict is still
`unknown` **and** a dry computation of the targets that would be held equals
`confirmedTargets` as a set. Otherwise the run holds again and the notice says the list
changed since it was confirmed. The dry computation is a pure pass over the same inputs
(render, `mergeFile` with `holdReplacements: true`, splice comparison) that writes nothing;
it is the same code the real pass uses, called with a `dryRun` flag, so the two cannot
disagree.

`behind` never offers an override: the fix is updating the extension.

### Auto-bootstrap cannot override (FR-6)

The refresh step in `BOOTSTRAP_STEPS` gains `commandArg: { origin: 'auto-bootstrap' }`.
`runBootstrap` already passes `commandArg` as the command's second argument, which is
`initRefreshCommand`'s `deps`. `deps.origin` is added to that type. With it set, step 2
above shows the hold notice and stops: no `Review and write` action exists on that path.

### The epoch gate on every surface (FR-2, INV-4, DQ-1)

| Surface | Call | Required on `main`? |
|---|---|---|
| `npm run validate` | Rule 25 in `scripts/validate-frontmatter.ts`: `checkTemplateEpoch()`; `fail(...)` with its message when `!ok`. No `try { } catch { stay silent }`: a throw is itself a failure (the Rule 12 / #871 shape) | yes, CI `lint` |
| vitest | `harness-provenance.test.ts`: `expect(checkTemplateEpoch().ok).toBe(true)` on the live corpus | yes, CI `test` |
| packaging | `scripts/check-template-epoch.ts`, run from `prepackage` after the supply-chain check | n/a, local and release |
| merge order | `scripts/check-template-epoch.ts --base <ref>` in a new workflow (below) | advisory until added to the ruleset |

The two required surfaces are independent witnesses with one implementation: a
`core.hooksPath` gap cannot disable either, and each is in a different required job.

**Merge-order check (Risks row 2, DR-092 §2).** The layout rule makes the common collision a
git conflict. It does not catch a branch that resolves that conflict by keeping main's
epoch with a new digest. `check-template-epoch.ts --base origin/main` reads the base's two
constants from `git show <ref>:packages/minspec/src/lib/harness-provenance.ts` by regex and
fails when the head digest differs from the base digest but the head epoch is not exactly
base + 1, or when the head epoch is below the base epoch. It runs in
`.github/workflows/template-epoch-order.yml`, on every pull request to `main`, with no
`paths:` filter, exiting 0 when the file is unchanged, modelled on
`.github/workflows/dr-id-collision.yml`. Git is used here because this is a repo script,
not the extension; FR-9 covers the extension's refresh path.

### Tier 0 (FR-9, INV-5)

`harness-provenance.ts` imports only `fs`, `path`, `crypto`, `merge-refresh.ts`,
`template-registry.ts`, `slash-commands.ts`, `opt-in.ts` and `build-provenance.ts`. The test
mocks `child_process`, `http`, `https`, `net` and `dns` so every export throws, then runs
`decideDirection` over a real record read, `checkTemplateEpoch`, and a held
`refreshHarnessFiles` on a temp directory with no `.git`. The held refresh is the full path
FR-9 names. `refreshHarnessFiles` itself still calls git in `ensureHooksPath`,
`recordExecutableBitInIndex` and the gitignore untrack step, all best-effort today; the test
stubs only those three by module mock and asserts the direction verdict and hold are
unchanged when they throw, so the gate's answer does not depend on git.

## Files

| File | Change | In requirements.md? |
|---|---|---|
| `packages/minspec/src/lib/harness-provenance.ts` | new | `implements` |
| `packages/minspec/tests/harness-provenance.test.ts` | new | `implements` |
| `packages/minspec/tests/harness-refresh-direction.test.ts` | new | `implements` |
| `packages/minspec/src/lib/merge-refresh.ts` | `mergeFile` option + `directionHeld` | `affects` |
| `packages/minspec/src/lib/scaffold.ts` | verdict, holds, notice, baseline overlay, record writes | `affects` |
| `packages/minspec/src/lib/auto-bootstrap.ts` | sentinel helper, `commandArg` origin | `affects` |
| `packages/minspec/src/commands/init.ts` | override flow, summary toast, `deps.origin` | `affects` |
| `scripts/validate-frontmatter.ts` | Rule 25 | `affects` |
| `.github/workflows/ci.yml` | **no change needed**: its `lint` job already runs `npm run validate`, and `test` already runs vitest. Listed in `affects` at Specify; this plan found no edit is required | `affects` |
| `scripts/check-template-epoch.ts` | new: package gate and merge-order mode | not listed. Needed for DQ-1 and the Risks row; a script calling `checkTemplateEpoch`, no rule of its own |
| `packages/minspec/package.json` | `prepackage` runs the script | not listed. DQ-1 |
| `.github/workflows/template-epoch-order.yml` | new | not listed. Risks row 2 / DR-092 §2 |

`slash-commands.ts`, `template-registry.ts` and `build-provenance.ts` are read, not edited.

## Invariants, and how each is tested

| Invariant | Test |
|---|---|
| INV-1 stale bundle never replaces newer content | `harness-refresh-direction.test.ts`: the sealbox regression (a managed region carrying a block the bundle's template lacks, record at epoch bundle+1); every managed file byte-identical after refresh. Run first against unchanged code to see it red |
| INV-2 unknown fails closed | same file: absent record, unreadable JSON, `templateEpoch: "42"`, `templateEpoch: -1` each hold exactly like behind |
| INV-3 additive to DR-089 | same file: the DR-089 preservation fixtures from `merge-refresh.test.ts` re-run with verdict `ahead` give byte-identical output to today; plus a property case: under `holdReplacements`, `mergeFile`'s output differs from `existing` only by appended headings |
| INV-4 epoch cannot silently fail to move | `harness-provenance.test.ts`: `checkTemplateEpoch` red on a corpus with one template body changed and the old digest; green on the live corpus. The validate surface is proved end to end once, by hand, in task 2's pull request (edit a template in a scratch copy, run `npm run validate`, quote the red line) |
| INV-5 no network | the module-mock test in *Tier 0* |
| INV-6 no `.minspec/`, no change | `refreshHarnessFiles` and `writeHarnessProvenance` both throw `NotOptedInError` in a folder without `.minspec/` and leave it empty |

Every new check carries a negative control in the same test that shows it can go red.

## Build order

A vertical slice first: constants and record, then the verdict, then the hold in the one
write path that caused #1095 (the managed-region splice), then the other paths, then the
signals that keep a hold visible, then the human override, then the extra gate surfaces.
tasks.md follows that order.

## Design decisions and the rejected alternatives

- **Thread one boolean into the existing write sites** rather than a second "planner" pass
  that decides every write up front. A planner would be cleaner in the abstract but would
  restate `mergeFile`'s decisions, the duplicate-predicate drift this repo has paid for
  before. The dry run for the override reuses the real pass with a flag for the same reason.
- **Sentinel in the baseline** rather than leaving the held entries at their prior value.
  The prior value can equal the running bundle's hash (a second machine whose last refresh
  used the same stale bundle), which would read as no drift while a hold is live.
- **Git merge conflict plus a base comparison** for epoch collisions, rather than an
  append-only epoch-to-digest ledger in source. The ledger needs the same base comparison to
  catch an edited history line, so it adds a second structure without removing the check.
- **AGENTS slash section gated and digested.** requirements.md names two write paths; a
  third exists. Leaving it ungated would leave INV-1 false for one section of one file.

## Follow-ups (tracked)

- **SPEC-063** (clean uninstall inventory) gains the `.minspec/harness-provenance.json` row.
  Its owner is SPEC-063, already named in DR-092 *Follow-ups*; no code inventory exists to
  edit yet (grep of `packages/minspec/src` at a799afcc finds none).
- **Correcting sealbox's `minspec-ci-parity` remedy text** is cross-repo and Out of Scope in
  requirements.md; DR-092 *Follow-ups* item (d) carries it.
- **Making `template-epoch-order` a required check** is a ruleset edit, a founder act, the
  same step `dr-id-collision.yml` documents in its header. The workflow's header says so.
- **Rollback behaviour** (an older bundle meeting the record) cannot be changed by this spec
  and is stated in DR-092 *Consequences*; no task.
