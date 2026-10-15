---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the fan-out multiplies a network action, so SPEC-085's consent model is the governing constraint
aspects: [backlog, multi-root, gh-cli, consent, network, silent-gate]
relates_to: [SPEC-085, DR-004, DR-050, "#573", "#549"]
affects: [packages/minspec/src/views/backlog-view.ts, packages/minspec/src/extension.ts, packages/minspec/tests/backlog-view.test.ts, packages/minspec/tests/backlog-consent.test.ts]
phases:
  specify: in-progress
---

# SPEC-137: The Backlog panel shows every workspace folder's issues in a multi-root workspace

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the Clarify questions, and approves it through the normal spec-approval gate.

Issue: #573 (fix: Backlog pane only scans one folder in a multi-root workspace). Follow-up
of #549 (multi-root aggregation for the Specs/DRs trees, which deliberately left Backlog out).

## One-Sentence Scope

In a multi-root workspace the Backlog panel lists the open issues of every workspace folder's
repository, grouped per folder, with each folder's load succeeding or failing on its own, and
without ever contacting GitHub outside the user's Backlog gesture (SPEC-085).

## Context - what the code does today (read from the tree, not inferred)

- `BacklogTreeProvider` takes one `workspaceRoot` string
  (`packages/minspec/src/views/backlog-view.ts:287`, constructed at `extension.ts:155`).
- `loadFromGitHub()` runs `fetchIssues(this.workspaceRoot, { state: 'open' })` for that one
  folder only (`backlog-view.ts:352`); `buildGroups` resolves epics against the same single
  root (`:416`).
- The provider holds a single `BacklogLoadState` (`not-loaded | loading | failed | loaded`) and
  a single `inFlight` promise, so there is nowhere to hold "folder A loaded, folder B failed".
- `SpecTreeProvider` / `AdrTreeProvider` already enumerate folders through
  `allWorkspaceRoots()` (`lib/resolve-folder.ts:106`) and render a folder tier only when more
  than one root exists (`spec-tree-provider.ts:363-378`, `SpecFolderNode`, #549).
- `onDidChangeWorkspaceFolders` already calls `backlogTreeProvider.refreshIfStale()`
  (`extension.ts:253-257`), which only re-renders and starts no `gh` (SPEC-085 FR-1/FR-4).

**Why this is not a copy of #549.** Specs/DRs aggregate local files. Backlog aggregates GitHub
issues through `gh`, one process per repository. That adds three things the tree fix did not
face: (1) a network action multiplied by folder count, under SPEC-085's rule that a gesture
authorises a fetch; (2) partial failure (one repo signed out, rate limited, or not a GitHub
repo while others succeed); (3) several folders that may map to the same repository.

## Functional Requirements

- **FR-1 - Every folder is read.** The provider obtains its folder set from
  `allWorkspaceRoots()` at load and render time, not from a constructor-captured string. A
  folder added or removed after construction is honoured by the next gesture and render
  (mirrors the live-roots behaviour of the Specs/DRs providers).

- **FR-2 - Single-root is byte-identical.** With exactly one workspace folder the panel renders
  and behaves exactly as it does today: no folder tier, same rows, same states, same single
  `gh` process per gesture.

- **FR-3 - Folder tier in multi-root.** With two or more folders the root level is one
  `BacklogFolderNode` per folder (label = folder name, as `SpecFolderNode`). Each folder's
  children are that folder's own load-state row or its issue groups (lifecycle or epic
  grouping, FR-7), so issue numbers and epic slugs from different repos never merge.

- **FR-4 - Consent is preserved (SPEC-085 FR-1, FR-2, FR-4 hold unchanged).** No `gh` process
  starts before a Backlog gesture; render, visibility, focus, folder-change and sibling
  commands still only re-render. One gesture may start one `gh issue list` per folder (see
  DQ-1 for what the user is told). A workspace-folder change never fetches, including for a
  newly added folder, which shows its own not-loaded row until the next gesture.

- **FR-5 - Per-folder state, no cross-folder masking.** Each folder holds its own
  `BacklogLoadState`. A failure in one folder is shown as that folder's failed row with its
  classified reason and MUST NOT blank, replace, or hide another folder's loaded issues, and a
  folder that failed MUST NOT read as "no issues" (constitution invariant 2).

- **FR-6 - Bounded fan-out.** Fetches for the folders of one gesture run with a bounded
  concurrency (value fixed in Plan; DQ-2 sets the policy). A repeat gesture while any folder's
  fetch is in flight joins those fetches rather than starting duplicates (extends the existing
  single-`inFlight` join to per folder).

- **FR-7 - Epic grouping per folder.** The "group by epic" toggle applies inside each folder
  using that folder's own root for epic resolution (`buildEpicGroups(root, ...)`), never the
  primary folder's.

- **FR-8 - Non-repository folders degrade visibly.** A folder that is not a GitHub repository,
  or where `gh` cannot resolve one, shows that folder's failed row with the classified reason
  from `fetchIssues` (`#2247`); it does not abort the other folders' fetches.

- **FR-9 - Provider reads all folders (the gate the issue's root cause names).** A test asserts
  that a data-surface tree provider enumerates every workspace folder, closing the gap that the
  `workspaceFolders?.[0]` ban (#123/#373) leaves open. Scope of that test (Backlog only vs all
  three providers) is DQ-4.

## Acceptance Criteria

- [ ] Two folders, gesture run: `fetchIssues` is called once per folder with that folder's
      path; both folders' issues appear under their own folder nodes. (FR-1, FR-3)
- [ ] One folder: tree shape and `gh` call count are identical to the pre-change snapshot.
      (FR-2)
- [ ] Folder B's `fetchIssues` rejects while A's resolves: A shows its issues, B shows a failed
      row with the reason; neither is empty. (FR-5, FR-8)
- [ ] Before any gesture, with three folders, zero `gh` processes are started by render,
      visibility, focus and `onDidChangeWorkspaceFolders`. (FR-4)
- [ ] A folder added after load shows a not-loaded row and starts no process until the next
      gesture; a removed folder's state is dropped. (FR-1, FR-4)
- [ ] A second gesture during an in-flight multi-folder load starts no additional processes.
      (FR-6)
- [ ] With epic grouping on, each folder resolves epics from its own root. (FR-7)
- [ ] The all-folders enumeration test fails when a provider reads only `[0]` or a cached
      root. (FR-9)

## Invariants (must not break)

1. Core works offline; no network without explicit consent (constitution 1). The only route to
   `gh` remains the single `minspec.refreshBacklog` gesture (SPEC-085 FR-2, pinned by
   `backlog-consent.test.ts`).
2. No silent gate (constitution 2). A per-folder failure is visible and never rendered as an
   empty list; one folder's failure never hides another's data.
3. Blast radius (constitution 3). No behaviour change in single-root workspaces (FR-2).
4. `refresh` / `refreshIfStale` remain the provider's public surface (two activation suites pin
   them; SPEC-085 comment at `backlog-view.ts:302`).

## Decisions needed (Clarify)

**DQ-1 - How does one gesture authorise N fetches?**
- (a) **(rec)** One gesture loads all folders. The command title/tooltip and the not-loaded row
  state the count ("lists issues for N workspace folders from GitHub using `gh`"). Cost: a
  six-folder workspace spends six `gh` calls on one click and can hit rate limits sooner.
- (b) One gesture loads one folder (per-folder row/button). Cost: N clicks to see everything;
  most conservative on consent, worst usability; more surface to pin in the consent test.

**DQ-2 - Concurrency policy.**
- (a) **(rec)** Bounded parallel (small fixed cap, e.g. 3). Cost: a constant to choose and test.
- (b) Strictly sequential. Cost: total latency grows linearly; simplest failure ordering.
- (c) Unbounded parallel. Cost: process burst and rate-limit risk on large workspaces.

**DQ-3 - Folders resolving to the same repository.**
- (a) **(rec)** Fetch per folder as-is, no de-duplication. Cost: duplicate issues and duplicate
  calls if two folders are worktrees/clones of one repo; but no remote-parsing logic and
  matches "one repo per folder" in the issue.
- (b) De-duplicate by resolved `owner/name`. Cost: needs a remote lookup (another process or
  parse) before the fetch, widening FR-1's "no process" reasoning and adding a failure mode.

**DQ-4 - Scope of the FR-9 enumeration test.**
- (a) **(rec)** Backlog, Specs and DRs providers all asserted. Cost: touches tests of already
  shipped #549 behaviour; may surface a latent gap in them.
- (b) Backlog only. Cost: leaves the class-level asymmetry the issue names partly open.

## Out of Scope

- Cross-folder merged/flat issue list or cross-repo sorting.
- Changing SPEC-085's consent model, or adding auto-refresh/caching beyond `refreshIfStale`.
- Persisting loaded state across window reloads.
- Issue-creation or other `gh` commands in multi-root.

## Alternatives considered and rejected

- **Flat merged list** across folders: issue numbers collide across repos and epic slugs
  mix; per-folder tier matches #549.
- **Fetch on folder add**: violates SPEC-085 FR-1/FR-4 (ambient trigger fetching).
