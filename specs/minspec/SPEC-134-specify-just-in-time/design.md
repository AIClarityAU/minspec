---
id: SPEC-134
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-134 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - when a spec may be written, what its frontmatter must state, and the gates that check both
relates_to: [SPEC-012, SPEC-038, SPEC-076, SPEC-085, SPEC-059, SPEC-061, DR-019, DR-066, DR-069, DR-086, DR-088, "#2584", "#2609", "#2610", "#2611", "#3252"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-134 - Design: specify just in time

Plan for [requirements.md](requirements.md), built under the three recorded selections that
approval ratified (OQ-1 option A, a backfill list; OQ-2 option A, five counting today's pile;
OQ-3 option A, an agent may record a no-change refresh). Citations of "today" are against
`origin/main` `c2f53d74`, the commit this plan was written on. New code is cited by symbol,
because its line numbers move.

## Approach in one paragraph

Two pure modules go into `@aiclarity/shared`: `specify-ready.ts` owns every reading of a
dependency statement (spec frontmatter, backfill list, issue body) and the one readiness
computation, and `spec-freshness.ts` owns the stale / fresh / unknown verdict. Neither imports
`vscode`, `fs`, `child_process` or the network. Every place that needs an answer builds the
input in an adapter and calls the function: the graph adapter (`artifact-graph.ts`) for the
editor, `validateSpec` and `scripts/validate-frontmatter.ts` for the gates, a new headless
`scripts/specify-ready.ts` for the drain. The gate ships at `warn` behind one setting; the
backfill lands in batches while it warns, and the last batch flips this repository to
`error`. Freshness travels to the resolver as a field on the spec node, exactly as
`implementHole` does, and turns the existing implement `phase-action` into a refresh task.
The drain and triage changes come last, after the editor and validator agree, because they
are machinery and because the drain's stale-build hold must not land before the refresh
record it reads exists.

## Re-measurement at c2f53d74 (what changed since the spec was written)

The spec measured `901fea36` on 2026-10-09. The corpus has more than doubled since. Measured
on this tree with `getApprovalStatus` from `packages/minspec/src/lib/approval.ts` over every
primary spec file (`specs/minspec/requirements.md`, and each `SPEC-*/requirements.md` under
`specs/minspec` and `specs/agent-execute`):

| Quantity | Spec (901fea36) | Plan (c2f53d74) |
|---|---|---|
| Primary spec files | 77 | 161 |
| Hold a current approval | 75 | 84 |
| No current approval | 2 | 77 |
| Literal `status: planning` | 39 | 48 |
| Approved, no `phases:` block | 24 | 24 |
| Carry `depends_on:` (of which `[]`) | 28 (2) | 95 (36) |
| No `depends_on:`, approved (go to the backfill list) | 48 | 50 |
| No `depends_on:`, unapproved (take it in frontmatter) | 1 | 16 |
| Unapproved T3/T4 whose first section is not "In plain terms" | not measured | 17 |

The 16 unapproved specs with no `depends_on:` at c2f53d74: SPEC-082, 097, 109, 127, 143,
207, 218, 225, 226, 228, 242, 247, 250, 251, 255, 258. The 17 unapproved T3/T4 specs whose
first `## ` section is not "In plain terms": SPEC-081, 082, 087, 090, 097, 098, 109, 127,
204, 207, 218, 245, 258, 271, 272, 274, 276. Both lists are a starting point; the tasks that
use them re-measure first.

Two consequences for the plan, neither a change to a requirement:

- **The FR-20 flip has real work in it.** When this repository moves to `error` (FR-3), the
  17 unapproved T3/T4 specs without the opening turn `main` red unless they gain one first.
  They are unapproved, so editing them voids nothing. The openings-and-flip task group
  carries them.
- **The approval queue is already far past five** (77 unapproved, most `specifying` drafts
  on `main`). Under the ratified OQ-2 selection that means the drain writes no unpinned spec
  for a long time. That is the stated cost of the spec ("What this costs"), not a defect;
  the drain's wording (FR-14) is what keeps it from reading as a stall.

The literal-versus-derived drift (SPEC-059) and the 24 phaseless approved specs (SPEC-061)
are unchanged and stay out of scope; FR-10's note and FR-11's third bucket count them.

The drain gained a second spec-writing brake after the spec was written:
`MINSPEC_DRAIN_SPECIFY_MAX_HELD` (#2939, `scripts/drain-inbox.sh:1557`) pauses spec writing
while ten or more drain pull requests wait on a human. It stays. FR-14's rule runs after it,
per issue, and the two print separate lines.

## Architecture

```
            packages/shared (Tier 0, pure)
  ┌───────────────────────────────────────────────────────────────┐
  │ specify-ready.ts                                              │
  │   readSpecStatement(fmBlock)          FR-1, FR-5              │
  │   readBackfillList(json)              FR-6                    │
  │   parseDeclaredBlockers / explicitLinks  (moved, unchanged)   │
  │   readIssueStatement(body, nativeBlockedBy)   FR-7            │
  │   computeSpecifyReady(input)          FR-8 .. FR-11           │
  │ spec-freshness.ts                                             │
  │   assessFreshness(input)              FR-16                   │
  │ next-task.ts  SpecNode.freshness → refresh phase-action FR-17 │
  └───────────────────────────────────────────────────────────────┘
        ▲ inputs built by adapters, never a second condition
  ┌─────────────┬──────────────────┬──────────────────┬────────────┐
  │artifact-    │ spec-validator   │ validate-        │ scripts/   │
  │graph.ts     │ checkDependency- │ frontmatter.ts   │ specify-   │
  │readiness-   │ Statement,       │ (commit hook, CI)│ ready.ts   │
  │Inputs, git  │ checkSpecOpening │ same two fns,    │ (headless) │
  │freshness    │ (approve gate,   │ FR-18 two-commit │            │
  │reader       │ Check Spec       │ check            │            │
  │             │ Completeness)    │                  │            │
  └──────┬──────┴──────────────────┴──────────────────┴─────┬──────┘
         │ editor: Specs pane, Show SDD Status, Backlog,     │ drain-inbox.sh,
         │ Next Task (advice only, INV-7)                    │ triage-decide.sh
```

`scripts/lib/issue-rank.ts` keeps exporting `parseDeclaredBlockers` and `explicitLinks` by
re-export, so `scripts/rank-issues.ts` and the drain's ranking do not change (INV-6 for
issues). The grammar moves rather than being copied because the Backlog panel runs in the
extension bundle, which cannot import from `scripts/`, and a second copy is exactly what
INV-4 forbids.

## Data shapes (the contract every task builds against)

```ts
// packages/shared/src/specify-ready.ts

/** FR-1 / FR-5: the three readings, plus the unreadable case FR-2 names. */
export type DependencyStatement =
  | { kind: 'targets'; ids: string[]; source: 'frontmatter' | 'backfill' }
  | { kind: 'none'; source: 'frontmatter' | 'backfill' }      // `depends_on: []`
  | { kind: 'not-stated' }
  | { kind: 'unreadable'; raw: string };                      // block list, bare word

/** FR-6: one entry of .minspec/dependency-backfill.json. */
export interface BackfillEntry {
  spec: string;            // SPEC-NNN
  depends_on: string[];    // [] means "nothing"
  evidence: string;        // one line: the sentence or ref it came from, or "no blocker named"
  specHash: string;        // full specHash of the approved text when the entry was written
}

export type NotReadyReason =
  | 'no-epic' | 'epic-not-current' | 'no-dependency-statement'
  | 'dependency-not-built' | 'approval-queue-full' | 'unbuilt-pile-full';
export type ReadyNote = 'pinned' | 'dependency-has-no-phase-map';

export interface Pin { label: string; issue: number; appliedBy: string }

export interface Candidate {
  ref: string;                       // an issue ('#2584') or a spec id ('SPEC-NNN')
  epic: string | null;
  statement: DependencyStatement;
  pin?: Pin;                         // only passed when the adapter read who applied it
}

export interface SpecFact {          // one per primary spec, from the adapter
  id: string;
  derivedStatus: 'new' | 'specifying' | 'planning' | 'implementing' | 'done'
               | 'archived' | 'superseded';   // BEFORE the planning→implementing map
  approval: 'approved' | 'stale' | 'unapproved';
  hasPhaseMap: boolean;
  epic: string | null;
}

export interface ReadyInput {
  candidates: Candidate[];
  specs: SpecFact[];
  epics: { id: string; status: string; order: number | null }[];
  adrs: { id: string; status: string }[];
  issues?: { number: number; state: 'OPEN' | 'CLOSED'; servedBy: string[] }[];
  limits: { approvalQueue: number; unbuiltPile: number };
  population: 'working-tree' | 'working-tree+open-pr-drafts';
  openPrDrafts: number;              // 0 unless population says otherwise
}

export interface ReadyResult {
  candidate: string;
  answer: 'ready' | 'not-ready';
  reasons: { reason: NotReadyReason; detail: string }[];   // every one that applies
  notes: { note: ReadyNote; detail: string }[];
}

export interface ReadyReport {
  results: ReadyResult[];
  counts: { approvalQueue: number; unbuiltPile: number; noPhaseMap: number;
            population: ReadyInput['population'] };
  currentEpic: { id: string } | { exhausted: string; act: string } | null;
}

export function computeSpecifyReady(input: ReadyInput): ReadyReport;
```

```ts
// packages/shared/src/spec-freshness.ts

export interface FreshnessInput {
  spec: string;
  baseline: { commit: string; derived: boolean } | null;  // null: none could be read
  changedOwnedFiles: string[] | null;   // implements ∪ affects changed since baseline; null = git could not answer
  targetHashes: { id: string; atBaseline: string | null; now: string | null }[] | null;
  unknownWhy?: string;                  // 'shallow clone', 'baseline commit not present', 'untracked spec', 'not checked'
}

export type Freshness =
  | { state: 'fresh'; baseline: { commit: string; derived: boolean } }
  | { state: 'stale'; baseline: { commit: string; derived: boolean };
      changedFiles: string[]; changedTargets: string[] }
  | { state: 'unknown'; why: string };

export function assessFreshness(input: FreshnessInput): Freshness;
```

`unknown` is returned whenever any input is `null` or `unknownWhy` is set; there is no code
path from a missing input to `fresh` (INV-2). A target present now and absent at baseline is a
changed target; a target absent now is left to the dependency gate's
`dependency.unknown-target`, and freshness reads `unknown` for it rather than guess.

## Dependency statements (FR-1 to FR-7)

**Reading a spec's statement.** `readSpecStatement` matches `^depends_on:` in the frontmatter
block. An inline list, with an optional trailing `# comment`, is `targets` or `none`. The key
followed by nothing on the line (the YAML block-list form), a bare scalar, or an unclosed
bracket is `unreadable` with the raw value. No key is `not-stated`. The graph adapter's
`parseEdgeArray` keeps producing exactly the edges it produces today (INV-6); it does not
call the new reader for edges, and a test compares the edge list on the live corpus before
and after. The adapter adds the statement as a separate field.

**The gate.** `checkDependencyStatement(spec, ctx)` in `spec-validator.ts`, exported beside
`checkAcceptanceCriteria`, returns these findings:

| Rule id | When |
|---|---|
| `dependency.missing` | no frontmatter statement and no valid backfill entry |
| `dependency.unreadable` | the key is present and `readSpecStatement` says `unreadable` |
| `dependency.unknown-target` | an id resolves to no spec, decision record or epic in `ctx.knownRefs` |
| `dependency.backfill-duplicate` | a frontmatter statement and a backfill entry both exist |
| `dependency.backfill-unapproved` | an entry whose `specHash` is not both the spec's current hash and its approval record's hash: the spec was not approved when the entry was written, or has been edited or re-approved since, so the statement must move into frontmatter and the entry be deleted |
| `dependency.backfill-unknown-spec` | an entry naming no spec |

`ctx` carries the known refs, the spec's backfill entry if any, its current `specHash` and
its approval record's `specHash`. `validateSpec` builds `ctx` from the options it already
takes (`knownArtifactRefs`, `approvalState`) plus two new optional ones; the two editor
callers (`commands/approve.ts`, `commands/validate.ts`) pass them. A caller that cannot read
the backfill file passes `backfillUnreadable: true`, and the gate returns one
`dependency.backfill-unreadable` finding instead of reading every approved spec as missing.
Severity comes from `config.dependencyStatement` (`warn` default, `error` here after the
backfill), mapped exactly as `validateOwnership` maps `ownershipDeclaration`.

`scripts/validate-frontmatter.ts` gains one rule that calls the same function for every
primary spec (sibling `design.md` and `tasks.md` are never checked, per the spec's Terms).
Its `catch` prints `dependency-statement: validated nothing (<error>)` as a FAIL at `error`
and a WARN at `warn`, never silent (INV-2, FR-2's last sentence).

**The backfill list.** `.minspec/dependency-backfill.json`, a JSON array of `BackfillEntry`,
sorted by spec id. It sits outside every signed text, so INV-5 holds by construction, and a
task checks it by computing `specHash` of every approved spec before and after, compared
whole. The list only shrinks: `dependency.backfill-unapproved` fires the moment a listed spec
is edited or re-approved, so the move into frontmatter happens in the change that touched the
spec. The approve flow does not move it automatically: approval writes the sidecar, and
moving text into signed bytes after hashing would stale what was just signed. The finding's
fix hint names both edits.

**Producers (FR-4, FR-15, FR-21).** Four producers change their text, each naming `[]` as
"nothing", the "In plain terms" opening with its three labels, and the freshness record:
`FRONTMATTER_GUIDANCE` in `slash-commands.ts`, `createSpec` in `spec-manager.ts` (writes
`depends_on: []` with a comment telling the author to replace it, and the opening section as
a stub with empty labels so the gate reports it until filled), the example spec in
`commands/example.ts`, and the dispatch prompt in `scripts/dispatch-issue.sh` (today at
`:1376-1378`). `spec-producer-inventory.test.ts` holds the producer list as data, reads each
producer's text, and fails when one omits any of the three instructions, or when the list
resolves to zero producers.

**Issues (FR-7).** `parseDeclaredBlockers` and `explicitLinks` move from
`scripts/lib/issue-rank.ts` to `specify-ready.ts` byte for byte, with the module's existing
tests still passing unchanged through the re-export. `readIssueStatement(body,
nativeBlockedBy)` adds one form: a line `Depends on: none` (or `Blocked by: none`), in the
same line-anchored, fence-aware grammar, outside fenced blocks. Declared blockers or a native
relation give `targets`; the none line gives `none`; neither gives `not-stated`. A body with
both a none line and blockers reads `targets` and the drain prints the contradiction.

## Ready to specify (FR-8 to FR-11, FR-13)

`computeSpecifyReady` evaluates each candidate against all four conditions and returns every
failing reason, never the first only:

1. **Current epic.** Lowest `order:` among epics with status `proposed` or `active`; no
   `order:` sorts last, ties break by id. No epic on the candidate is `no-epic`; another epic
   is `epic-not-current`. A pin replaces this condition (and condition 4) and adds the note
   `pinned` with the issue and account.
2. **Dependencies.** `not-stated` or `unreadable` is `no-dependency-statement`. Each target is
   satisfied by FR-10's table: spec approved and derived `implementing` or `done`, or approved
   with no phase map (satisfied, plus the note `dependency-has-no-phase-map` naming it);
   decision record `accepted`; epic `active` or `done`; issue closed or served by a satisfied
   spec. Anything else, including derived `planning`, is `dependency-not-built` naming the
   target and its state. A target that resolves to nothing is `dependency-not-built` with
   detail `unknown`, never satisfied.
3. **Approval queue.** Specs with no current approval, not archived or superseded, plus
   `openPrDrafts`, at or above `limits.approvalQueue` is `approval-queue-full`. A pin does not
   lift it.
4. **Unbuilt pile.** Approved specs deriving `planning` at or above `limits.unbuiltPile` is
   `unbuilt-pile-full`. Phaseless approved specs count in `noPhaseMap` only.

`currentEpic` is `{ exhausted, act }` when the current epic has no spec that is not done or
archived and, when `issues` is present, no open issue serving it; `act` reads "mark EPIC-NNN
done". The function never picks the next epic (FR-9's last paragraph).

`derivedStatus` is read in the adapter from `deriveStatus` in `lifecycle.ts`, before
`SPEC_STATUS_MAP` folds `planning` into `implementing` (FR-10). The resolver's own input is
built exactly as today.

**Settings.** `config.ts` gains `dependencyStatement: 'warn' | 'error'` (default `warn`) and
`specifyReady: { pinLabel, approvalQueueLimit, unbuiltPileLimit }` (defaults `specify-now`,
5, 5). A limit that is not a whole number is read as 0, which makes nothing ready, and the
surfaces say so; the drain's existing knobs do the same.

**Headless (FR-13).** `scripts/specify-ready.ts --root <dir> [--issues <file.json>]
[--open-pr-drafts <n>] [--freshness <SPEC-id>...]` (plus `--issue-statement`, which reads
one issue body on stdin and prints its reading, for triage) reads the root through the same adapter
the editor uses, refuses a root without `.minspec/` by name (copying the check in
`scripts/next-task.ts`), prints one JSON document with stable key order, and spawns nothing
but local `git` for `--freshness`. The issues file is the drain's own `gh` output shape
(`number, title, labels, body, state` plus `pinnedBy` where the drain read it), so the
headless script never touches the network itself.

**Agreement (INV-4).** One fixture tree with three issues and five specs is run through the
adapter-plus-function path the editor uses, through `scripts/specify-ready.ts`, and through
the drain's helper with `gh` stubbed; the three answers must be equal. A source scan in the
same test fails if any of `drain-inbox.sh`, `backlog-view.ts`, `spec-tree-provider.ts`,
`status.ts` or `validate-frontmatter.ts` contains one of the reason ids as a literal outside
a message table, which is the cheapest check that nobody reimplemented a condition.

## Editor surfaces (FR-12)

All advice; nothing refuses (INV-7) and nothing runs at activation (INV-8).

- **Specs pane.** For a spec with no current approval, `spec-tree-provider.ts` asks the
  computation about the spec as a candidate. If `epic-not-current`, `no-epic`,
  `no-dependency-statement` or `dependency-not-built` applies, the item's description gains
  "written early" and its tooltip lists the reasons. Queue and pile reasons are not shown
  here, because they describe the next spec, not one already written. The computation runs
  when the tree refreshes, which is already user- or file-change-driven.
- **Check Spec Completeness and the corpus validator.** The same early reasons become one
  warning, `specify.written-early`, never an error at any setting.
- **Approve flow.** The same note appears as a non-modal warning, the form `approve.ts`
  already uses for its other notes (its `showWarningMessage` calls without `modal`); the
  flow proceeds.
- **Show SDD Status.** A "Spec piles" section: approval queue, unbuilt pile, no-phase-map
  bucket, each with its limit and the population (`working tree`), on three lines, never
  summed.
- **Backlog panel.** After the consented load (SPEC-085), each issue node shows `ready` or
  its reasons. The fetch adds `body` to the fields it already requests, and for issues
  carrying the pin label it reads the latest `labeled` event's actor in the same consented
  call sequence. An actor that cannot be read means the pin is not passed, and the node says
  "pin ignored: who applied it could not be read". Before the load the panel shows nothing
  about readiness.

## Freshness (FR-15 to FR-19)

**The record.** One file per spec, `.minspec/freshness/<SPEC-NNN>.json`:
`{ "writtenAgainst": "<sha>", "refreshes": [ { "from": "<sha>", "to": "<sha>", "by": "<identity>", "at": "<ISO time>", "reasons": { "<file or target>": "<one line>" } } ] }`.
One file per spec, not one shared file, because agents write these in parallel pull requests
and a shared file conflicts on every pair. The record is outside the spec's signed text and
outside `.minspec/approvals/`, so writing it never voids or rewrites a sign-off (FR-15,
INV-5). The term is "written against" on purpose: approval records already use
`baselineBlob` for the approved bytes, a different thing.

**Derived baseline.** With no record, the adapter walks `git log --format=%H --
<requirements.md>` newest first, computes `specHash` of each version with `git show`, and
takes the newest commit whose version hashes equal to the current file and whose parent's
does not. That is "the last commit that changed its canonical content" and ignores
lifecycle-only commits, which `stripLifecycle` removes from the hash. The walk is capped at
200 commits; past the cap, or with no history, the result is `unknown` with the reason.

**Inputs.** `git diff --name-only <baseline> <head>` intersected with the spec's
`implements:` and `affects:`, and `specHash` of each `depends_on` target's primary file at
the baseline and now. A shallow clone (`git rev-parse --is-shallow-repository`), a baseline
commit missing from the object store, or a spec file git does not track each set
`unknownWhy`. Results are cached per (spec path, HEAD sha) for the life of the adapter call.

**Only for `planning`.** The adapter computes freshness only for specs deriving `planning`.
Specs in any other state get no `freshness` field, and the resolver treats an absent field as
today.

**The signpost (FR-17).** Refresh is a variant of `phase-action`, not a new `NodeKind`. The
implement-hole loop in `next-task.ts` already emits `phase-action` for these specs, and
SPEC-014 FR-13 already forbids an Approve control on that kind, so the variant inherits the
guarantee every renderer already enforces. When `s.freshness` is `stale`, the loop emits the
refresh imperative ("Refresh SPEC-NNN: `<first changed item>` and N more changed since it was
written") with rule `pending.freshness-stale` in place of the implement imperative; for
`unknown`, "Check SPEC-NNN is still fresh: <why>" with rule `pending.freshness-unknown`.
Ranking terms are untouched (INV-6). A spec deriving `planning` with no task hole, which emits
nothing today, emits the refresh node when stale or unknown, because a stale approved spec is
work the human can act on.

**Activation.** `extension.ts:285` computes the next task once at activation for the status
bar. That call passes no git reader, and the adapter sets every `planning` spec to
`{ state: 'unknown', why: 'not checked yet' }`, so the status bar never shows a build action
as if fresh. The Next Task command and the debounced recompute after a file change pass the
reader. No git process runs at activation (FR-17, INV-8).

**A refresh (FR-19).** If the spec's text changes, nothing new happens: the approval goes
stale by the hash rule and the spec joins the approval queue. If nothing needs changing, the
author (human or agent, OQ-3) appends a `refreshes` entry and moves `writtenAgainst`. The
validator rule `freshness.record` checks the record's shape: `to` is a commit in local
history, `by` and `at` are present, and `reasons` has one non-empty line for exactly the
changed files and targets between `from` and `to` (computed by the same freshness function).
A record it cannot check (shallow clone) is a named warning.

**The build hold.** Two sides:

- **The drain** (FR-18 first sentence). Before dispatching an `agent-ready` issue whose
  `explicitLinks` names a spec deriving `planning`, the drain asks
  `scripts/specify-ready.ts --freshness SPEC-NNN` and holds the issue on `stale` or
  `unknown`, printing which and why. A failed call holds the issue too.
- **The validators** (FR-18 second sentence). The parent commit comes from
  `MINSPEC_VALIDATE_PARENT`, default `HEAD`. In the pre-commit hook `HEAD` is the parent of
  the commit being made, which is right. In CI the checkout is the pull request's merge
  commit, so the validate job sets `MINSPEC_VALIDATE_PARENT=HEAD^1` (the base tip) with
  `fetch-depth: 2`. The rule `freshness.build-started-stale` reads each spec's
  `phases.implement` at the parent with `git show`; for every spec that was `pending` there
  and is not pending now, it computes freshness as of the parent and reports `stale` or
  `unknown` by spec id and changed file, at `dependencyStatement` severity. When `CI` is set
  and `MINSPEC_VALIDATE_PARENT` is not, or the parent is missing, it prints that the check did
  not run and why. Specs whose implement had already started at the parent are never examined,
  which is FR-18's last sentence.

## The opening (FR-20 to FR-22)

`checkSpecOpening(spec, approvalState, config)` in `spec-validator.ts`, called from the same
two places as the dependency gate. It applies only to a primary T3 or T4 spec with no current
approval. The first `## ` heading after the `# ` title must begin "In plain terms"
(`opening.missing` if no such heading exists, `opening.misplaced` if it exists but is not
first). Its first paragraph, up to the next blank line, is at most 120 words by whitespace
split, with Markdown links counted by their text (`opening.too-long`), and must contain
`Cost:`, `Left out:` and `Riskiest assumption:` each followed by non-empty text before the
next label or the end (`opening.incomplete`, naming the label). The spec's own opening is
the fixture's positive control.

The panel's duty (FR-22) is one paragraph added to `scripts/roles/approvable-reviewer.md`,
then `node scripts/gen-ci-templates.mjs` regenerates `ci-review-templates.ts`. It is machinery
and merges on that path.

## Triage (FR-7)

`scripts/triage-decide.sh` reads the triage agent's verdict block and emits
`agent-ready-specify` at its rule 3 (`:175`, T3/T4 and `decision: agent-ready`). It has no
view of the issue body today. It gains one argument, `--dependency-statement
targets|none|not-stated`, which `scripts/triage-inbox.sh` fills by running
`readIssueStatement` over the issue body through `scripts/specify-ready.ts --issue-statement`
(never by the model, so the label cannot rest on a model's reading). Rule 3 then requires
`targets` or `none`; with `not-stated`, or the argument absent or garbled, it emits
`needs-info` with the existing hold `info`, fail-closed like `human_only` (#345). The triage
prompt (`scripts/roles/triage.md`) is told to ask for the statement in its comment and to
offer `Depends on: none` as the form for "nothing". Rules 1, 2 and 4 to 6 are unchanged.

## Task sizing and order

Each task in [tasks.md](tasks.md) is one agent run: one concern, a few files, its own test,
green on landing. The order is chosen so that no task lands a red required check on `main`:

- **Pure modules** first, with their T0 suites (no caller yet, nothing can break).
- **Settings and adapter**, then **the gates at `warn`**, including the opening check
  (output grows by warnings only).
- **Producers**, so new specs stop adding to the backfill while it is under way.
- **The openings** for unapproved T3/T4 specs, still at `warn`; then **the backfill** in
  batches, whose last batch sets `dependencyStatement` to `error` in `.minspec/config.json`
  in the same commit, as FR-3 requires.
- **Editor surfaces and the headless script.**
- **Freshness**: the signpost, the record check, the validator's two-commit rule.
- **Machinery last**: triage, drain spec writing, drain build hold, the panel duty.

The drain's build hold lands after the record and the refresh path exist, so that no approved
spec is held with no way to clear it. SPEC-134's own build issues are unaffected by the hold,
because the first of them moves SPEC-134 out of `planning`.

## Alternatives considered and rejected

Recorded because this plan was written under `"autonomy": "act"` with no live conversation
(DR-086 section 4).

- **Refresh as a new `NodeKind`** (the spec's Costly-to-refactor item 4). Rejected: every
  renderer and the SPEC-014 no-Approve guard would need a new case; the `phase-action` variant
  inherits both, and the closed `NodeKind` list stays closed.
- **One shared freshness file.** Rejected: parallel agent pull requests would conflict on it
  every time. One file per spec conflicts only when two changes refresh the same spec.
- **Freshness record in frontmatter.** Rejected by the spec (Costly-to-refactor item 5): it
  would have to leave the hash, which needs a decision record (#2610's sibling question).
- **Copying the issue grammar into the extension.** Rejected under INV-4; the move with a
  re-export costs one task and changes no behaviour.
- **Computing freshness at activation in the background.** Rejected: FR-17 says no git
  process at activation, and a delayed spawn is still a spawn the user did not ask for. The
  cost is one "not checked yet" label until the first command or edit.
- **A fetch-depth 0 CI checkout for the two-commit rule.** Rejected: depth 2 is enough for
  `HEAD^1` on a merge ref, and a full clone costs every CI run.
- **Moving a backfill entry into frontmatter inside the approve command.** Rejected: it would
  edit signed bytes after hashing them.
- **Honouring a pin whose applier could not be read.** Rejected: FR-9 requires the account
  be named, so an unnamed pin is shown and not acted on.

## Verification

- T0 suites red before the implementation exists (each task records its red run in the pull
  request body), green after, through `npx vitest run` as CI runs it.
- Not vacuous: each FR-9 condition and each FR-2 and FR-20 finding removed one at a time in a
  scratch copy turns its suite red, beside a clean control; fixtures vary the number of specs
  and producers, not only the code.
- INV-5: `specHash` of every approved spec compared whole before and after each backfill
  batch; every approval record byte-identical.
- INV-6: the graph adapter's edge list and `resolveNextTask` output on the live corpus are
  identical before and after the adapter and resolver tasks, for every spec not deriving
  `planning`.
- `npm run validate` green on the commit before the flip and on the flip commit.

## Dependency budget

None. Everything uses Node's `child_process` for local git (adapter and scripts only),
existing `specHash`, existing `deriveStatus` and existing `gh` calls in the drain.

## Out of scope

As the spec lists. Also not here: the DR-019 addendum (#2609), whether `depends_on` leaves
the hash (#2610), and a command that creates a spec (#2611); each is already tracked.
