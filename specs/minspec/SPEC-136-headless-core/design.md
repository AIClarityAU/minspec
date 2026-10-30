---
id: SPEC-136
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-136 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this makes them reachable where no editor runs
relates_to: [SPEC-001, SPEC-076, SPEC-096, SPEC-139, DR-014, DR-037, DR-056, DR-066, DR-074, "#248", "#3291", "#562", "#2263", "#2297", "#2702", "#2708"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-136 - Design: one headless core, two ways in

Plan for [requirements.md](requirements.md). The contract is that file; this one says how
to build it. Citations of "today" are against `origin/main` at `a3a4a3e8`, the commit this
plan was written on. New code is named by symbol, because its line numbers will move.
Where a mapping below was read from imports and comments rather than run, it says so; the
task that builds it re-checks it.

## Approach in one paragraph

A new private workspace package, `packages/core` (`@aiclarity/minspec-core`), holds one
table of operations (`operations.ts`) and two thin ways in generated from it: a command line
(`cli.ts`) and a stdio tool server (`tool-server.ts`). Every operation is a few lines of
wiring that calls the library function the extension or this repo's validator already
calls; no operation holds a rule. The package imports `packages/minspec/src/lib/*` and
`packages/shared/src/*` where they sit (the way `scripts/facts.ts:54-69` and
`scripts/next-task.ts:48-53` already do), and esbuild bundles both entries into one
CommonJS file that needs only Node. Tests build that bundle themselves (CI runs
`npx vitest`, never `npm test`, so a `pretest` build would not run) and drive it as a child
process, which is how the boundary properties (no network, only `git`, no socket, nothing
outside the project, nothing written by the four checks) are observed rather than asserted
from source. The build order is a vertical slice: `hash` through the command line first,
then the other checks, then the tool server, then `approve`, then the two delivery paths.

## What the plan relies on (read at a3a4a3e8)

| Fact | Where |
|---|---|
| Spec hash | `specHash` - `packages/shared/src/canonical.ts:126` |
| Derived status | `deriveStatus` - `packages/minspec/src/lib/lifecycle.ts:133`; approval verdict from `getApprovalStatus` - `approval.ts:499` |
| Next action (SPEC-076's pair) | `buildArtifactGraph` - `artifact-graph.ts:490`, `resolveNextTask` - `packages/shared/src/next-task.ts:1196` |
| Per-spec validation | `validateSpec` - `spec-validator.ts:1157`; the options the editor passes are assembled in `packages/minspec/src/commands/validate.ts:49-70` (`knownEpicRefs`, `approvalState`, `explicitTerminal`, `siblingShardFiles`, `pathExists`) |
| Hook activation | `ensureHooksPath` - `scaffold.ts`, a private function (its doc comment at `:1084`, the `git config --local core.hooksPath` writes at `:1097`, `:1107`). Not exported today |
| Approval | `approveSpec` - `approval.ts:523` (opt-in and approver gates inside it); the editor's sequence around it is `packages/minspec/src/commands/approve.ts:239-392` |
| Opt-in marker | `hasOptInMarker` / `notOptedInMessage` / `assertOptedIn` - `opt-in.ts:57`, `:69`, `:107` |
| Editor-bound library files | `active-adr.ts`, `active-spec.ts`, `approval-diff.ts`, `diagnostics.ts`, `presence.ts`, `resolve-folder.ts` import `vscode` (grep of `from 'vscode'` in `packages/minspec/src/lib/`) |
| esbuild | root devDependency `^0.28.0`; the extension's only bundler call is `scripts/build-extension.sh` |
| Test discovery | `vitest.config.*` includes `packages/*/tests/**/*.test.ts`, and aliases `@aiclarity/shared` to its source, so `packages/core/tests` is picked up with no config change |
| Validate workflow | `.github/workflows/minspec-validate.yml` is a managed region rendered from `template-registry.ts` (`:1060`, `:1114-1122`); its third branch is `npx --no-install @aiclarity/minspec-validator`, never published (#248) |

## Architecture

```
packages/core/
  package.json          @aiclarity/minspec-core, private, no runtime dependencies
  tsconfig.json         noEmit typecheck; includes src/, tests/
  build.mjs             buildCore({ outfile, metafile }) -> esbuild, one CJS file
  src/operations.ts     OPERATIONS table + result envelope + the wiring per operation
  src/cli.ts            argv -> table -> envelope on stdout -> exit code
  src/tool-server.ts    newline-delimited JSON-RPC 2.0 on stdin/stdout -> same table
  tests/*.test.ts       the five owned tests (FR-1, FR-2/FR-3/FR-11/FR-26, FR-6/FR-7,
                        FR-4/FR-8/FR-10/FR-12/FR-17, FR-19/FR-20/FR-25)
dist/minspec-core.cjs   build output; not committed in this repo
```

Both entries are bundled into the same file: `minspec-core.cjs` with `serve` as its first
argument runs the tool server, anything else runs the command line. One file means one
version string and one thing to carry (FR-13, FR-16).

### The operation table (`operations.ts`)

```ts
type Effect = 'read-only' | 'git-config' | 'approval';

interface Operation {
  name: 'validate' | 'hash' | 'status' | 'next' | 'activate' | 'approve';
  summary: string;                     // one line, shown by --list and tools/list
  input: JsonSchemaObject;             // hand-written; the CLI parses flags against it
  effect: Effect;                      // FR-6 / FR-7 / FR-26 all read this one field
  run(ctx: CoreContext, args: Record<string, unknown>): Promise<Outcome>;
}

// Derived, never stored: a tool cannot be listed without a declaration (FR-26).
const toolAnnotations = (op: Operation) => ({
  readOnlyHint: op.effect === 'read-only',
  destructiveHint: op.effect !== 'read-only',
});
// Derived, never stored: approve can never become a tool (FR-20).
const offeredAsTool = (op: Operation) => op.effect !== 'approval';
```

`effect` is the single source for three requirements. FR-7's guard is "exactly one entry
has `effect: 'approval'` and it is `approve`"; FR-20's is "`offeredAsTool` is false for it";
FR-26's is "annotations are computed from `effect`". Because none of the three is a second
field, none can drift from the others.

### The result envelope (FR-9, FR-16, FR-18)

```ts
interface CoreResult<T = unknown> {
  schema: 'minspec-core/0';            // 0 = unstable (Costly to Refactor 1, Risk 5)
  coreVersion: string;                 // package version + build commit, e.g. 0.0.1+a3a4a3e8
  operation: string;
  root: string;                        // absolute project root the call ran in
  authority: 'advice';                 // FR-18: a core result never claims to be the merge gate
  outcome: 'pass' | 'fail' | 'refused' | 'error';
  data?: T;                            // per-operation payload
  findings?: Finding[];                // validate only
  refusal?: { code: RefusalCode; message: string };
  error?: { message: string; file?: string };
}
```

Exit codes: `pass` 0, `fail` 1, `refused` 2, `error` 3. Every non-pass outcome exits
non-zero (FR-9). `authority` is a constant: the core cannot tell where it is running, and
the only merge gate is a required check's conclusion on GitHub, not a field in this
envelope (BND-3). In CI the workflow job's exit code is what gates, and it is the core's
exit code.

`coreVersion` is injected at build time with esbuild `define`, the way
`scripts/build-extension.sh` stamps the extension: `<package.json version>+<short sha>`,
with `-dirty` appended when `packages/`, `scripts/` are dirty. A bundle with no stamp
reports `0.0.0+unstamped` rather than guessing.

### Root and the opt-in refusal (FR-8, FR-17)

The root is `--root <dir>` or the current directory. It is not searched for upwards: a
hook runs at the top of the work tree already, and walking up could land on a different
project. Every operation calls one `requireOptedIn(root)` before its own work, which
returns `refused` / `not-a-minspec-project` with `notOptedInMessage(root)` when
`hasOptInMarker(root)` is false. The tool server fixes its root once, at start; no tool
takes a path argument outside the project (spec paths are resolved and rejected if they
leave the root), so the model cannot point the core elsewhere.

### The operations

| Operation | Calls | Payload | Effect |
|---|---|---|---|
| `hash` | `specHash(readFile(spec))` | `{ spec, hash, approvedHash?, approval }` (`approval` from `getApprovalStatus`) | read-only |
| `status` | `listSpecs`, then per spec `getApprovalStatus` + `explicitTerminalOf` + `deriveStatus` | `[{ id, path, literal, derived, approval }]` | read-only |
| `next` | `resolveNextTask(buildArtifactGraph(root))`, `formatNextTaskLabel` | the `NextTask` or `null`, plus the label | read-only |
| `validate` | per spec: `validateSpec` with the editor's option assembly; then the corpus rules (table below) | `findings[]`, each `{ file, rule, severity, message, fixHint? }` | read-only |
| `activate` | `ensureHooksPath(root)`, exported from `scaffold.ts` | `{ hooksPath, previous }` | git-config |
| `approve` | the editor's lib sequence (below) | `{ spec, record, status }` | approval |

`validate` fails (`outcome: 'fail'`) on any `error`-severity finding and passes with
warnings. A spec file that cannot be read is an `error` finding naming the file, never a
skip (FR-9, AC "Fails loudly"). An empty corpus in a project with `.minspec/` is a pass with
zero findings, because that is a true statement about it; a corpus root that exists and
cannot be listed is an `error`.

### `validate`: the corpus rules (FR-3)

FR-3 asks Plan to list which rules of `scripts/validate-frontmatter.ts` go behind the core
and to name each one left out. The mapping is read from that script's imports and rule
comments at `a3a4a3e8`; it was not run. Task 7 re-reads each row against the code.

| Script rule | Function the core calls | Behind the core? |
|---|---|---|
| 1+3+4 domain docs (`type: domain`, no checklists, no acceptance criteria) | inline in the script today (`:113-134`) | Yes, after task 7 moves the inline body into an exported function the script then calls. The Python validator checks `type: domain`, so FR-3 needs it |
| 2+5 spec `id:` | `validateSpec` (believed to check `id`; task 7 verifies, else the same extraction as rule 1) | Yes |
| 2+5 epic gate as FATAL | - | **Left out.** The script's comment calls it "a project-policy gate for THIS repo"; the shipped extension keeps epics soft (DR-013 FR-9), and the core gives the extension's warning via `validateSpec` |
| 6 DR sequence health | `validateDrSequence` (`adr-manager.ts`) | Yes (warn) |
| 7 split-layout coverage | `validateSplitLayoutCoverage` | Yes (warn) |
| 8 INDEX status vs DR status | `validateDrIndexStatus` | Yes |
| 9 dangling references | `checkReferences` (`reference-checker.ts`) | Yes (warn) |
| 10 orphaned approval sidecars | `listOrphanedRecords` (`approval-store.ts`) | Yes (warn) |
| 11, 11b status line | `checkStatusParity`, `inspectStatusLine`, `inspectAllStatusClaims` (`status-parity.ts`) | Yes |
| 12 generated CI templates fresh | `scripts/gen-ci-templates.mjs` | **Left out.** It checks MinSpec's own generator output, which exists only in this repository |
| 13 acceptance criteria, 15 ownership, 22 implement evidence, 23 status annotation | `validateSpec` (`checkAcceptanceCriteria`, `validateOwnership`, `validateImplementEvidence`, `validateStatusAnnotation`) | Yes |
| 14 managed-region markers | `checkManagedRegionMarkers` (`scaffold.ts`) | Yes |
| 16 and its advisory twin | `validateDrAmendments`, `validatePendingDrAmendments` | Yes |
| 17 DR id collision (offline half) | `checkDeclaredDrIds` (`scripts/lib/dr-id-collision.ts`) | Yes. Also covers the Python validator's DR `id:` missing/invalid check |
| 18 spec id collision | `checkDeclaredSpecIds` (`scripts/lib/spec-id-collision.ts`) | Yes |
| 19 forbidden integrity words (DR-087) | inline constant `FORBIDDEN_CLAIM_WORDS` (`:915`) | **Left out.** A wording policy of this repository's register; carrying it would make the core hold a rule it does not share with the extension (FR-2) |
| 20 `## In plain terms` (#2921) | `drsMissingPlainTerms` (`scripts/lib/dr-required-sections.ts`) | Yes (warn). The Python validator warns on it too |
| 20 doubled frontmatter (#2467) | `detectDoubledFrontmatter` (`adr-manager.ts`) | Yes (warn) |
| 21 generated harness file | to be read in task 7 | Yes if it is a call to an exported function; otherwise left out, with the reason written into this table in the same pull request |
| 24 known limit in product source | inline | **Left out.** It reads MinSpec's own `packages/` source, not a project's specs |

Severities are the script's: the core reports a finding at the severity the script's call
site gives it. Two functions live under `scripts/lib/`; the core imports them where they
are, as the script does. Moving them into a package is not this spec's work.

The Python validator's checks (`template-registry.ts`, the `VALIDATE_PY` body) are: spec
`id:` missing or malformed; ownership declaration errors and warnings; DR `id:` missing or
malformed; DR `## In plain terms`; domain `type: domain`; an unreadable file. Every one maps
to a "Yes" row above. The test for FR-3 is that mapping run, not read (Testing).

### `approve` (FR-19, FR-20, FR-7)

The core repeats the lib calls the editor makes, in the editor's order, with the editor's
UI removed:

1. `requireOptedIn(root)` (SPEC-096 FR-6).
2. Resolve the spec by `--spec <path|id>`; refuse `already-approved` when
   `getApprovalStatus` says approved, and refuse a terminal status (`isTerminalSpecStatus`)
   - the editor's picker filter (`commands/approve.ts`, the `include:` predicate).
3. `validateSpec` with the approve command's options (`knownEpicRefs`, `siblingShardFiles`,
   `pathExists`); refuse `incomplete` with the error findings.
4. `assertOwnershipDeclaredForAdvance(file, parsed)`; refuse `not-ready-for-advance`.
5. `checkApprover(gitConfigEmail(root), parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES))`;
   refuse `approver-denied`. There is no `minspec.approverEmail` setting outside the
   editor, so the address is the clone's `git config user.email`, as `gitConfigEmail`
   already reads it.
6. If the literal status is `new` or `specifying`, `advanceSpecToImplementing(file)`.
7. `approveSpec(root, file, tier, email)`.

It does not commit, and it does not enqueue a phase advance: the editor's
commit-on-approve and phase-advance queue are editor preferences, and the queue writes a
record FR-25 forbids. Whether ZCode's button commits is the plugin spec's choice (SPEC-139).
What `approve` writes is therefore exactly what steps 6 and 7 write: the spec's `status:`
and `phases:` lines, its sidecar under `.minspec/approvals/`, and the baseline blob and
`refs/minspec/snapshots/*` ref `mintBaseline` (`approval.ts:142`) writes into `.git`.

**The duplicated sequence is a stated risk.** The core and `commands/approve.ts` now hold
the same seven calls in two places; so do the core and `commands/validate.ts` for the
option assembly. Extracting each into one library function both call would remove that,
but edits two command files this spec does not own. It is tracked as #3291 (one orchestration for validate and approve), and until then `operations-parity.test.ts` pins the core's verdicts to the
library's for the same fixture.

### The tool server (FR-10, FR-11, FR-26)

Hand-written, no dependency. MCP's stdio transport is newline-delimited JSON-RPC 2.0 on
stdin/stdout; the server answers `initialize`, `ping`, `tools/list` and `tools/call`,
ignores `notifications/initialized`, and returns JSON-RPC `-32601` for anything else.
`tools/list` is `OPERATIONS.filter(offeredAsTool)` with `annotations` from
`toolAnnotations`; `tools/call` runs the same `run` the command line runs and returns the
envelope as JSON text content, with `isError: true` for any non-pass outcome. Logging goes
to stderr only; stdout carries protocol frames and nothing else. It imports no `net`,
`http`, `https`, `tls` or `dgram`, and there is no HTTP or SSE mode to switch on.

The protocol version string it answers with is pinned in `tool-server.ts` and recorded in
the test; which revision ZCode speaks is measurement 4, so the exact string is believed,
not verified, until then.

### Delivery (FR-13, FR-14, FR-15)

Two paths, because two different places need the file.

- **Into ZCode (FR-14).** A GitHub release asset on this repository,
  `minspec-core-<version>.cjs` plus its sha256, attached by a release step. Nothing on
  the host is shared with the container; the plugin (SPEC-139) fetches it from GitHub.
- **Into an adopter's CI (FR-15).** The extension's scaffold writes the bundle to
  `.minspec/bin/minspec-core.cjs` in the adopter's repository, from a copy shipped inside
  the vsix, and the validate workflow template's third branch becomes
  `node .minspec/bin/minspec-core.cjs validate` when that file exists. It moves ahead of the
  Python branch, since FR-3 makes it the higher-fidelity of the two. The "no validator ran"
  branch stays the last arm and still exits 1. #562 and #2263 are read before the template
  changes (FR-15 says so).

**Alternatives rejected for adopter CI.** *Download the release asset in the workflow,
pinned by sha256*: a network fetch inside a required check, and every release would have
to edit the pinned hash in a machinery template, which needs a human merge each time.
*Publish `@aiclarity/minspec-validator` to npm*: the founder chose no public package yet
(answered 2026-10-13). The cost of the chosen path: a generated file of some hundreds of
kilobytes committed in every adopter's repository, refreshed when the extension updates,
and one more file that runs on whatever machine pulls it (the #2708 class).

## Files

Owned by this spec (`implements:`): `packages/core/src/operations.ts`, `cli.ts`,
`tool-server.ts` and the five tests. Modified, owned elsewhere (`affects:`):
`template-registry.ts` (the workflow template, task 14), `scaffold.ts` (export
`ensureHooksPath`, task 10; write the bundle, task 15), root `package.json` (typecheck
entry, task 3).

Not declared in requirements.md, and why each is still needed:

| File | Task | Why |
|---|---|---|
| `packages/core/package.json`, `tsconfig.json`, `build.mjs` | 3 | A workspace package needs a manifest and a typecheck config; the build helper is shared by the tests and the release step so there is one bundler call, as `build-extension.sh` is for the extension |
| `scripts/validate-frontmatter.ts` and one new `scripts/lib/` file | 7 | Moves the inline domain-doc rule into a function both callers use, with no change in behaviour, so the core does not hold a copy (FR-2) |
| `packages/minspec/src/lib/ci-review-templates.ts` or the rendered `.github/workflows/minspec-validate.yml` | 14 | Whatever the repository's generator re-renders when the template changes; regenerated, never hand-edited |
| `scripts/build-extension.sh`, `packages/minspec/.vscodeignore` (or its `files:`) | 15 | The vsix must carry the bundle for the scaffold to copy |
| A release workflow under `.github/workflows/` | 16 | FR-14's GitHub build; workflow files are machinery, so this pull request needs a human merge |
| `docs/decisions/DR-NNN.md` (two) and `docs/decisions/INDEX.md` | 1, 2 | The decision records requirements.md says are owed |

Dropping or adding a declared path is an amendment to requirements.md and needs a fresh
approval; this plan does not do that. The undeclared rows follow the SPEC-080 plan's
precedent of naming them here.

## Invariants, and how each is tested

| Invariant | Test | How |
|---|---|---|
| INV-1 offline (FR-4) | `boundary.test.ts` | Each operation runs as a child process of the built bundle with a `--require` trap that records, to the original stderr fd before throwing, any call to `net`/`tls`/`http`/`https`/`dgram`/`dns`/`fetch`, and any `child_process` call whose program is not `git`. The test fails on any record. Recording before throwing matters: a library `catch` could swallow the throw, and the test would then pass on a fault |
| INV-2 no silent gate (FR-9, FR-15, FR-18) | `operations-parity.test.ts`, `boundary.test.ts`, task 14's template test | An unreadable spec is `error` with the file named and exit 3; refusal exits 2; the workflow's last arm still exits 1; `authority` is the constant `advice` |
| INV-3 blast radius (FR-8, FR-17) | `boundary.test.ts` | A folder without `.minspec/` is refused with exit 2 for every operation. The trap also records any `fs` call whose resolved path is outside the root and the bundle's own path; `HOME` is an empty temp directory that must still be empty afterwards |
| INV-4 the VM boundary (FR-10, FR-19 to FR-25) | `boundary.test.ts`, `vm-approval.test.ts` | No socket is bound (the trap covers `net.Server.prototype.listen` and `dgram`); `approve` is absent from `tools/list` and `tools/call approve` is refused; `approve` writes only its allowed set and no session, presence, heartbeat or queue path. FR-21, FR-23 and the container half of FR-22 are not code properties: measurements 8, 11 and 12 |
| INV-5 tier map (DR-014) | `no-editor-import.test.ts` | Nothing is added to `packages/shared`; the core is its own package and the test checks the bundle's import graph |

Each trap and each scan has a negative control in the same file: a planted `fetch`, a
planted `spawn('gh')`, a planted read of `/etc/hostname`, a planted `vscode` import, a
planted second `approval` effect. A test that cannot go red proves nothing.

## Testing

- **`no-editor-import.test.ts` (FR-1, FR-13, INV-5).** Builds with `buildCore` into a temp
  dir with `metafile: true` and `vscode` marked external, so a reachable import shows up in
  the metafile instead of failing the build; asserts no input imports `vscode`. Copies the
  single output file into an empty temp dir with no `node_modules` and runs `--version`
  and `hash` there. Control: a fixture entry that imports `diagnostics.ts` is reported.
- **`operations-parity.test.ts` (FR-2, FR-3, FR-11, FR-26).** (a) For a fixture project,
  each operation's payload equals the library function's direct result. (b) The command
  line's `--list` and `tools/list` name the same operations, less `approve` on the tool
  side; every operation is reachable one way or both, and a test-only extra table entry
  shows the check fails. (c) The same call through the command line and through
  `tools/call` gives deep-equal envelopes. (d) Every listed tool has annotations; every
  `effect` other than `read-only` is `destructiveHint: true`. (e) FR-3: a fixture corpus
  with one planted instance of each Python validator finding is run through
  `python3 validate.py` (rendered from `VALIDATE_PY`) and through the core; every Python
  `FAIL`/`WARN` line has a core finding on the same file. If `python3` is absent the test
  fails with a message saying so; it does not skip.
- **`read-only.test.ts` (FR-6, FR-7).** Snapshots every file under the fixture root,
  including `.git/config`, by content hash; runs `validate`, `hash`, `status`, `next`;
  the snapshot is identical. `activate` changes exactly `core.hooksPath` in the local
  config. FR-7: exactly one table entry has `effect: 'approval'` and it is `approve`;
  control adds a second and the check fails.
- **`boundary.test.ts` (FR-4, FR-8, FR-10, FR-12, FR-17).** The trap harness above, for
  every operation including the tool server across one full session. FR-12: every
  occurrence of `minspec-core` in the strings `template-registry.ts` renders sits inside a
  workflow or hook template, never in prose meant for a person.
- **`vm-approval.test.ts` (FR-19, FR-20, FR-25, the host-side half of FR-22 and FR-24).**
  In a fixture git repo with a human `user.email`: `approve` succeeds in one call, the
  spec's derived status reads approved straight after, and the changed paths are exactly
  the allowed set. With a bot address it is refused before any write. `approve` is not in
  `tools/list`. Host side: the core has no operation that reads an approval from anything
  but the working tree (no ref or remote argument exists in any `input` schema).

## Build order

1. The two decision records (tasks 1, 2). The command-line record is the one
   requirements.md says is owed before Plan; it is first so no code lands without it.
2. Package, bundle and the FR-1 test (task 3), then `hash` end to end (task 4). This is
   the vertical slice: one check, one way in, built, stamped, tested.
3. `status` and `next` (5), `validate` per spec (6), its corpus rules (7), the FR-3 Python
   comparison (8), the read-only and one-approval-path tests (9), `activate` (10).
4. The tool server (11), then the boundary harness across both ways in (12).
5. `approve` (13), last among operations, after the boundary tests exist to watch it.
6. Delivery: the workflow template (14, machinery, human merge), the scaffold copy (15),
   the release asset (16, machinery, human merge).
7. The founder's measurements (17), which no task blocks on but three acceptance criteria
   wait for.

## Design decisions and the rejected alternatives

- **A package that imports the library where it sits, not a move.** Moving 71 files into
  a package would be DR-014's work and #54's; the scripts already import them in place.
  Cost: the core's typecheck reaches into `packages/minspec/src/lib`, so a change there
  can break the core's build. That is wanted: it is the same code.
- **Hand-written protocol, not the MCP SDK.** Requirements allow one dependency; the SDK
  also ships HTTP and SSE transports FR-10 forbids, and a bundle that carries them makes
  "no port" a property of which code path runs rather than of what exists. Cost: the
  server tracks the protocol by hand; four methods is small enough.
- **One bundle for both ways in.** Two bundles would need two version stamps and a test
  that they match. Cost: the tool server's process loads the command-line code it does
  not use.
- **Root is fixed, not searched upwards.** Cost: a caller in a subdirectory must pass
  `--root`. Searching upwards could select a parent project that opted in when the
  current one did not, which is exactly the refusal FR-8 exists for.
- **`approve` does not commit.** Cost: in ZCode the approval sits in the working tree
  until something commits it. Committing would put a second policy (which paths, which
  author) inside the core; the plugin owns that choice.

## Follow-ups (tracked)

- One orchestration for validate and approve: `commands/validate.ts`, `commands/approve.ts`
  and `scripts/validate-frontmatter.ts` each assemble the same library calls the core
  does: #3291 (one editor-free orchestration for validate and approve).
- The command-line decision record and the VM-boundary decision record: tasks 1 and 2.
- The founder's measurements: task 17.
- The ZCode plugin shell: SPEC-139 (#2702).
