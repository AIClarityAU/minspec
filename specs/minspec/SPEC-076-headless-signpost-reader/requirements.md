---
id: SPEC-076
type: requirements
status: planning
tier: T2
product: minspec
epic: EPIC-002  # Signpost Integrity — the never-wrong next-action promise this reader must not weaken
relates_to: [SPEC-012, DR-019, DR-074]  # SPEC-012/DR-019 own the resolver this reader reuses; DR-074 is the blast-radius invariant that makes the `.minspec/` refusal mandatory
implements: [scripts/next-task.ts, packages/minspec/tests/headless-signpost.test.ts]
affects: [package.json]  # one npm-script line; no dependency change
phases:
  specify: done
  plan: done
---

# Headless signpost reader — one next action per project, with no editor

> **Read-only.** This adds a way to ASK the existing signpost a question from a
> terminal. It computes nothing new, writes nothing, and makes no network call.

Materializes **#2182**, from the founder's instruction of 2026-09-26 — *"write a headless
way for COS to access the minspec signpost."* Sibling of **#1948** (*"No headless path to create a
DR"*), which is the same class one step further: a capability reachable only through the
Command Palette, so no agent session can use it. #1948 is the **write** half and stays
out of scope here; this spec is the **read** half.

## One-Sentence Scope

Expose the existing next-task signpost to a terminal with no editor and no workspace, as
`npm run next-task -- <root>...`, which prints one JSON answer per project root by calling
the same `buildArtifactGraph` + `resolveNextTask` pair the Command Palette calls, and which
refuses any root lacking a `.minspec/` marker instead of reporting it as having nothing to do.

## Context

### Why there is no headless path today

MinSpec ships as a VS Code extension with no CLI and no `bin` entry (measured: no `"bin"`
key in any `packages/*/package.json` or the root). The signpost is reachable only from the
palette, through `packages/minspec/src/commands/next-task.ts:26`:

    return resolveNextTask(buildArtifactGraph(workspaceRoot));

That single line is the whole computation. Both halves are already editor-free:

- **`resolveNextTask`** — `packages/shared/src/next-task.ts:1174`, returning the `NextTask`
  declared at `:164-170`. The module has **zero import statements** of any kind (measured),
  which is what its own docstring asserts as a Tier-0 invariant: *"no `vscode`, no `fs`, no
  network, no `Date`, no `Math.random`, no LLM."*
- **`buildArtifactGraph`** — `packages/minspec/src/lib/artifact-graph.ts:489`, taking a
  plain `rootDir: string`. It imports `fs`, `path` and six sibling lib modules, and **no
  `vscode`**. Measured over the full transitive closure of its imports: **16 modules, zero
  `vscode` imports, runtime or type-only.**

So the blocker was never a dependency on the editor host. It was purely that nothing but a
palette command ever called the pair. `npm run facts` (root `package.json` → `npx tsx
scripts/facts.ts`) has **zero** references to either symbol (measured).

### The design is already precedented, so no code moves

Three scripts already reach into package sources exactly the way this one needs to:

- `scripts/check-import-cycles.ts:25` → `../packages/minspec/src/lib/import-cycle-check`
- `scripts/migrate-approvals.ts:40-41` → `../packages/minspec/src/lib/spec`, `.../approval`
- `scripts/facts.ts:54` → `../packages/shared/src/canonical`

`facts.ts` is the closest model and settles one detail: it imports shared's **source**, not
the built `@aiclarity/shared` package. That matters because the workspace package resolves
via `main: out/index.js`, which is absent until `npm run build --workspace=@aiclarity/shared`
has run. Importing source keeps the reader working on a fresh checkout with no build step.

### Measured: it already works, across every project on this machine

A probe calling the two functions under `npx tsx`, against six roots, with nothing moved
and nothing added:

| root | graph (epics/specs/ADRs) | resolved next task |
|---|---|---|
| MinSpecPro | 10 / 67 / 93 | `phase-action: SPEC-042` (blocked-ready) |
| sealbox | 1 / 2 / 4 | `spec-approve: SPEC-001` |
| scroogellm | 1 / 1 / 13 | `adr-accept: DR-007` |
| ColdForge | 0 / 1 / 1 | `spec-approve: SPEC-001` |
| LeadForge | 0 / 2 / 4 | `spec-approve: SPEC-001` |
| memory-fabric | 1 / 1 / 1 | `spec-approve: SPEC-001` |

This spec is therefore about the **contract and the failure modes**, not about whether the
computation is reachable. It is.

### The one real defect the probe found

The same probe was pointed at `/tmp`, a directory with no `.minspec/` and no `specs/`. It
returned, with no error:

    OK  /tmp  epics=0 specs=0 adrs=0  next=NULL

`null` is also the correct, legitimate answer for a real MinSpec project with nothing
pending. **The two are indistinguishable**, and a supervisor reading the second as the first
concludes "that project is clear" about a repo MinSpec was never installed in.

The mechanism is not a bug in either function; it is an absent check. `loadConfig`
(`packages/minspec/src/lib/config.ts:139-140`) treats a missing `.minspec/config.json` as
"use defaults" rather than "not a MinSpec project", and `buildArtifactGraph` never looks for
`.minspec/` at all — reasonably, since its only caller until now was a command that could
only run inside an initialized workspace. Reading N arbitrary roots removes that guarantee,
so the check has to exist at the new entry point.

This is why FR-2 is the load-bearing requirement of this spec rather than a detail. It is
constitution invariant 2 (a missing witness must fail closed and visibly, never pass quietly)
and invariant 3 (`.minspec/` *is* the opt-in marker and the blast radius) in the same line.

### Why T2, and why that is not a shortcut

Classified on **mechanical scope**, per the repo's own two-axis classifier
(`packages/minspec/src/lib/classifier.ts` — `classify()` takes the max `tierContribution`
over all signals, and DR-021 records that difficulty is *orthogonal* to what it measures):

- **Scope axis — 3 files.** One new script, one new test file, one npm-script line. No
  existing logic is modified, no code moves between packages, and zero dependencies are
  added. `.minspec/config.json` sets `thresholds.t1Max: 3`, `t2Max: 7`.
- **Consequence axis — no T3 signal fires.** No deletion, no migration, no destructive
  schema op, no concurrency primitive. `isPublicSurface`
  (`consequence-analyzers.ts:139-149`) recognises only `index.*`, `main.*` and
  `package.json`, so `scripts/next-task.ts` is not a public surface by the repo's own
  predicate — and per CLAUDE.md the `scripts/` path is dev-time tooling that does **not**
  ship inside the extension. The `package.json` touch adds no dependency.

An earlier read of this work guessed T3 on the grounds that it "crosses a package boundary
and adds a public surface." Both were checked and neither holds: the two boundaries it uses
are already exercised by the three scripts cited above, so no new boundary is created, and
it adds no public surface under `isPublicSurface`. Raising to T3 anyway would be raising on
"this feels important", which is exactly the difficulty-for-scope substitution DR-021 removed.

The tier is load-bearing rather than cosmetic, because two separate gates key on it:
`scripts/lib/autonomy.ts:62-70` reserves *"T3/T4 spec approval and DR acceptance"* as human
acts an agent cannot sign, and `scripts/hooks/spec-gate.py` freezes implementation code only
for a **T3/T4** spec that derives to implementing while unapproved. At T2 neither applies, so
this spec is implemented in the same change that introduces it. If a reader concludes the
tier is wrong, the remedy is to raise it and re-gate — ceremony ratchets up, never down
(`applyFloor`, `classifier.ts`).

## Functional Requirements

- **FR-1 (reuse, never re-derive).** The entry point MUST obtain its answer by calling
  `buildArtifactGraph(root)` from `packages/minspec/src/lib/artifact-graph.ts` and
  `resolveNextTask(graph)` from `packages/shared/src/next-task.ts` — the same two functions
  `packages/minspec/src/commands/next-task.ts:26` calls. It MUST NOT contain any ranking, severity, ordering or
  status-derivation logic of its own. *Rationale: #1948's own option analysis names the cost
  of a second entry point — "the CLI becomes a surface that can drift from the palette
  command unless one calls the other." Two implementations of "what is next" would diverge,
  and the wrong one would be authoritative.*

- **FR-2 (refuse a root that never opted in).** Before building a graph, the reader MUST
  verify that `<root>/.minspec/` exists as a directory. A root without it MUST be reported as
  an explicit, named failure (`not-a-minspec-project`) and MUST NOT be reported as a resolved
  answer of any kind — in particular never as `task: null`. A root that does have the marker
  but whose graph resolves to no pending task MUST be reported as a success carrying
  `task: null`, so "nothing to do" and "not a MinSpec project" are distinguishable in the
  output without inference.

- **FR-3 (N roots, one invocation, independent outcomes).** The entry point MUST accept one
  or more root paths as positional arguments and emit one result object per root, in the
  order given. With no arguments it MUST default to a single root: the current working
  directory. A failing root MUST NOT abort the run or suppress any other root's answer —
  every requested root MUST appear in the output exactly once. *Rationale: one process
  amortizes the TypeScript compile once instead of N times, and per-root isolation is what
  stops one unreadable project from silencing five good answers (invariant 2 — a missing
  witness must not stop evaluation).*

- **FR-4 (measure the working tree, and say so).** The reader MUST measure the same thing the
  editor pane measures: the **working tree** on disk. It MUST NOT read spec content or
  approval records from `origin/main` or any other git ref. Because these checkouts are
  shared and routinely dirty, each successful result MUST also report the tree state it
  measured — the current `HEAD` short sha and whether the tree is dirty — so a supervisor can
  tell a clean-tree answer from one that reflects another session's half-finished work.

- **FR-5 (JSON on stdout, diagnostics on stderr).** On stdout the reader MUST emit a single
  JSON document and nothing else, so it is safe to pipe. Every human-readable diagnostic,
  including each failure explanation, MUST go to stderr. Each failure MUST be visible in both
  places: as a structured entry in the JSON and as a line on stderr.

- **FR-6 (exit code carries the verdict).** Exit `0` only when every requested root produced
  a resolved answer. Exit `1` when at least one root failed. Exit `2` on a usage error. The
  reader MUST NOT exit `0` with an empty result set — zero resolved roots is a usage error,
  not a quiet success.

- **FR-7 (byte-deterministic for a fixed input).** For the same roots in the same on-disk
  state, two runs MUST produce byte-identical stdout. In particular the document MUST NOT
  embed a wall-clock timestamp or any other value that varies between runs. *Rationale: the
  resolver's own Tier-0 invariant is "same graph → identical NextTask"; a timestamp in the
  envelope would make the surface non-reproducible for no gain, and a supervisor that diffs
  two readings to detect change could no longer do so.*

- **FR-8 (offline, and no editor).** The reader MUST make no network call, and MUST be
  runnable with no editor, no extension host and no workspace open — invoked as an
  `npm run` target over `npx tsx`, mirroring `npm run facts`. It MUST introduce no new
  runtime or development dependency.

## Acceptance Criteria

- **AC-1 (FR-2, the measured defect).** A root with no `.minspec/` directory produces a
  result whose failure code is `not-a-minspec-project`, a non-zero exit, and a stderr line
  naming the root. It does not produce `task: null`.
- **AC-2 (FR-2, the other side).** A root that HAS `.minspec/` but resolves to no pending
  task produces a success result with `task: null` and `ok: true`, and — when it is the only
  root — exit `0`. AC-1 and AC-2 together are the discrimination this spec exists to add, so
  a test asserting one without the other does not satisfy this criterion.
- **AC-3 (FR-3).** Given three roots where the middle one lacks `.minspec/`, the output
  carries three results in the given order, the two valid roots carry their own answers, and
  the exit code is `1`.
- **AC-4 (FR-1, no drift).** A test asserts the script obtains its answer from
  `resolveNextTask` and `buildArtifactGraph` and holds no ordering/severity logic of its own,
  so an inlined reimplementation fails the build. Mirrors the shared-predicate assertion
  pattern SPEC-074 AC-6 uses.
- **AC-5 (FR-5/FR-6).** On a run with one good and one bad root, stdout parses as JSON with
  no leading or trailing non-JSON text, and the failure appears on stderr as well as in the
  parsed document.
- **AC-6 (FR-7).** Two consecutive runs over identical roots produce identical stdout bytes.
- **AC-7 (FR-4).** A successful result reports the measured `HEAD` short sha and a boolean
  dirty flag for that root.
- **AC-8 (FR-1, agreement with the pane).** For a given root, the script's resolved
  `kind` and `targetId` equal what `resolveNextTask(buildArtifactGraph(root))` returns when
  called directly in-process — the property that makes this a view of the signpost rather
  than a second opinion.

## Invariants

- **INV-1 (constitution #1 — offline).** No network call, directly or transitively. The
  reader touches the filesystem and, for FR-4 only, local git.
- **INV-2 (constitution #2 — no silent gate).** No root is ever silently dropped, and no
  failure is ever reported as an answer. `null` means exactly "this MinSpec project has
  nothing pending" and never "this is not a MinSpec project", never "an error occurred", and
  never "the root was skipped".
- **INV-3 (constitution #3 — blast radius).** The reader is read-only: it creates, modifies
  and deletes nothing in any root it is pointed at, and `.minspec/` presence is what
  authorizes it to answer for a repo at all. Being read-only is also what keeps G-7's
  editor-native write-time enforcement claim intact — this adds a reader, not a second
  writer, and MinSpec still has no CLI that can advance a phase.
- **INV-4 (single source of truth).** Exactly one implementation of "what is next" exists in
  the repo. If the resolver needs to change, it changes in `packages/shared/src/next-task.ts`
  and both surfaces move together.
- **INV-5 (no editor dependency creeps in).** Nothing the reader imports may pull in
  `vscode`, transitively included. The 16-module closure measured above is the current state;
  a test keeps it true.

## Decisions needed (Clarify)

### DQ-1 (shape) — N roots in one process, versus N invocations

- **Option A — one invocation takes N roots (rec).** As specified in FR-3. *Cost:* the
  output envelope becomes a container with per-root success and failure rather than a single
  answer, so a consumer must iterate and check each entry instead of reading one object —
  slightly more work for the single-project case, which is the common case for a human.
- **Option B — one root per invocation, called N times by the caller.** Simpler output, one
  answer per run. *Cost:* pays the `tsx` TypeScript compile once per root, and pushes
  aggregation and partial-failure handling onto every caller, which is where it would be
  reimplemented inconsistently.

Recommendation: **Option A**, with the single-root case preserved by defaulting to the
working directory when no argument is given, so the extra structure is the only cost.

### DQ-2 (semantics) — working tree versus `origin/main`

Settled as FR-4 rather than left open, because the divergence has to be deliberate. The
extension judges approval against the **working tree**: `getApprovalStatus`
(`packages/minspec/src/lib/approval.ts:493`) hashes the spec file read from disk and reads
its sidecar from disk. A headless reader measuring `origin/main` would answer a *different
question* than the pane does, and the two would disagree exactly when the tree is dirty.

- **Option A — working tree (rec, specified).** The headless answer equals what the founder
  would see on opening the editor. *Cost:* on a shared, routinely-dirty checkout the answer
  reflects whatever is on disk, including another session's uncommitted work, so the
  supervisor can act on a state no one has committed. FR-4's reported tree state is the
  mitigation, and it is a disclosure rather than a fix.
- **Option B — `origin/main`.** A stable, shared reading independent of local mess. *Cost:*
  it would make the signpost say two different things on two surfaces, which is the
  never-wrong defect G-4 exists to prevent, and it would need network access or at least a
  fetched ref, putting pressure on invariant 1.

## Test

New test file, owned by this spec: `packages/minspec/tests/headless-signpost.test.ts`.

T0 invariant tests, written before the implementation:

1. AC-1 — a root with no `.minspec/` fails as `not-a-minspec-project`, non-zero exit (INV-2).
2. AC-2 — a root with `.minspec/` and nothing pending succeeds with `task: null` (INV-2).
3. AC-3 — a mixed batch of three roots reports three results in order, exit `1` (FR-3).
4. AC-4 — no second ranking implementation in the script (INV-4).
5. AC-5 — stdout is pure JSON; the failure also reaches stderr.
6. AC-6 — two runs are byte-identical (FR-7).
7. AC-8 — the script's answer equals the in-process resolver's answer for the same root.
8. INV-5 — the reader's import closure contains no `vscode`.
9. FR-5 regression (T3) — a document larger than the 64KB pipe buffer is not truncated.
   Added after the first implementation was found to end with `process.exit(main(...))`,
   which discards a still-buffered stdout write: a 200-root run emitted exactly 65536 bytes
   of unparseable JSON. Case 5 above did not catch it because it asserted the right property
   on the wrong axis - it varied the code but never the OUTPUT SIZE the defect lived on.
