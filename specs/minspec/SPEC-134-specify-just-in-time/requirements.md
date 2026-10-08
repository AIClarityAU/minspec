---
id: SPEC-134
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - when a spec may be written, what its frontmatter must state, and the gates that check both
aspects: [specify, dependency-graph, validator, signpost, freshness, backlog, drain, review-panel, tier-0, offline, no-silent-gate, rcdd]
depends_on: [SPEC-012, SPEC-038, DR-069, DR-034]  # SPEC-012 owns the resolver and the edge model; SPEC-038 the owned-file lists the freshness check reads; DR-069 the `planning` status the second pile is defined on; DR-034 the approval records and derived status both piles read
relates_to: [SPEC-041, SPEC-061, SPEC-059, SPEC-064, SPEC-070, SPEC-076, SPEC-085, DR-019, DR-066, DR-074, DR-086, DR-088, "#2584", "#2196", "#48", "#803", "#2055", "#2323", "#2609", "#2610", "#2611"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3; the
# shipped `/minspec-specify` guidance). All eight files are NEW and are needed under every
# answer to the open questions below: the two pure modules (FR-8, FR-16), the headless
# entry point (FR-13) and the tests that pin the gate, the computation, the freshness
# predicate, the opening rule and the producer inventory.
implements: [packages/shared/src/specify-ready.ts, packages/shared/src/spec-freshness.ts, packages/shared/tests/specify-ready.test.ts, packages/shared/tests/spec-freshness.test.ts, scripts/specify-ready.ts, packages/minspec/tests/dependency-statement-gate.test.ts, packages/minspec/tests/spec-opening-rule.test.ts, packages/minspec/tests/spec-producer-inventory.test.ts]
# Modified, not owned. Each of these has an owner already or is shared; this spec changes
# them and claims none. The role prompt and the generated template that embeds it are review
# machinery (FR-22). Under OQ-1 Option B or C the backfill list leaves the design and the 49
# spec files it would otherwise spare are edited instead.
affects: [packages/shared/src/next-task.ts, packages/shared/src/index.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/slash-commands.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/commands/example.ts, packages/minspec/src/commands/status.ts, packages/minspec/src/views/backlog-view.ts, packages/minspec/src/views/spec-tree-provider.ts, packages/minspec/src/lib/ci-review-templates.ts, scripts/validate-frontmatter.ts, scripts/dispatch-issue.sh, scripts/drain-inbox.sh, scripts/triage-decide.sh, scripts/roles/approvable-reviewer.md, scripts/roles/triage.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-134: Specify just in time - a spec is written when its work is next, says what it depends on, and is checked for freshness before it is built

## In plain terms

A spec is written only when its work is next: first open epic or pinned by you, dependencies
being built, at most five awaiting your approval, and a second cap on approved specs nobody
has started. Every spec must say what it depends on, "nothing" included; the 49 that do not
are backfilled without touching your approvals. Before a build, a spec is checked against
what changed since it was written. Cost: the drain idles by design, and some builds gain a
refresh step. Left out: the graph view. Riskiest assumption: agent-written dependency lists
are accurate.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, checks the three questions under
> **[Open questions for the founder](#open-questions-for-the-founder-recommended-answers-recorded-by-an-agent-2026-10-09-ratified-only-by-approval-of-this-spec)**,
> and approves it through the normal spec-approval gate before any code changes. Every
> requirement below is written under each question's recommended answer, so approving the
> spec as it stands accepts those three answers and leaves no question open. Choosing a
> different answer changes only the requirements that question names.

Materializes **[#2584](https://github.com/AIClarityAU/minspec/issues/2584)** - *"specify just
in time - the dependency graph decides when a spec may be written, and a spec is checked for
freshness before it is built."* The founder adopted it on 2026-10-07, in these words:

> adopt 2584. RCDD to prevent gaps in dependency data (and backfill). surely we can prevent
> stalling by allowing a short queue of up to say 5 pending approvals?

So this spec carries the proposal as written and two riders. **Rider 1:** dependency data
becomes a gate, found at its root cause, and the existing specs are backfilled (FR-1 to
FR-7). **Rider 2:** the limit is a short queue of pending approvals, up to five, so spec
writing does not stall on one unread spec (FR-11), counted apart from the approved specs
nobody has started.

**Id note.** `SPEC-134` is the highest claimed id plus one. Claimed ids were read on
2026-10-09 across `origin/main` at `901fea36` (highest: 096), the heads of all 35 open pull
requests (highest: 130), all 260 remote-tracking branches, 189 of them
`origin/agent/issue-*` where the parked drafts live (highest: 133), the 564 local branches
and the 81 worktrees on disk. No gate checks spec ids across pull requests: Rule 18 in
`scripts/validate-frontmatter.ts` reads one tree, and #2055 (the id allocator is blind to
unmerged branches) tracks the gap. If the id collides at review time, renumber.

**Tier note.** Triage recorded T4 (complete ceremony). Classified on mechanical scope, the
change crosses two packages and the dev-time scripts: 8 new files and 18 existing ones,
which is past the 15-file mark the classifier uses for its top tier
(`packages/minspec/src/lib/git-analyzer.ts:34-39`). The predicted tier is an upward-only
floor, so this is T4.

**Scope note.** The decision recorded on the issue says one spec covers the extension part.
The proposal also has two parts that live outside the extension: a duty for the review
panel (its point 4) and the drain following the rule (its point 5). They are here as one
requirement each (FR-22, FR-14), because a rule with three homes and one specification
cannot drift, and each can be lifted out without changing the others.

**Written under its own rule.** Measured against FR-9 on the day it was written: its epic
is the lowest-ordered open one (EPIC-003, SDD Core Methodology, `order: 1`); its four
dependencies are an approved spec that is done (SPEC-038, spec-to-code ownership), two
accepted decision records, and SPEC-012 (the next-task resolver), which is approved but has
no phase map, so its build state is not recorded (FR-10). The approval queue holds 14 (one
spec on `main` and 13 drafts in open pull requests), over the limit of five, and a pin does
not lift that limit (FR-9). So the drain would not have written this spec. A session wrote
it on the founder's direct instruction, which is the route INV-7 keeps open: the rule binds
the drain, not a person.

## One-Sentence Scope

Make "may this spec be written yet" and "is this spec still fresh enough to build" two
deterministic, offline answers computed in one place, require every spec to state what it
depends on so those answers rest on recorded data, require every T3 or T4 spec to open with
the decision in plain terms, and have the drain, the validator and the editor all read the
same computation.

## Context - what the code and the corpus do today (read from `origin/main` 901fea36, not inferred)

Counts below were produced by the repository's own functions (`deriveStatus`,
`getApprovalStatus`, `buildArtifactGraph`, `specHash`) run over a clean checkout of that
commit, not by reading status lines.

### How far ahead the specs are

| Measure | Count |
|---|---|
| Primary spec files (76 `SPEC-NNN` directories and the core spec) | 77 |
| Hold a current approval | 75 |
| Approved, build not started (derived `planning`) | 41 |
| Approved, build state not recorded (no `phases:` block, derived `new`) | 24 |
| Build started (derived `implementing`) | 6 |
| Done (derived `done`) | 4 |
| No current approval, awaiting it (SPEC-075, validate the corpus from config) | 1 |
| No current approval, superseded (SPEC-056, explain affordance) | 1 |
| Open pull requests that add a spec directory, not on `main` | 13 |
| Closed pull requests labelled `parked` (drafts set aside, branches kept) | 76 |

The literal `status:` lines say something else: 32 `implementing`, 39 `planning`. They
disagree with the derived status on 27 specs. 24 of those are the specs with no phase map:
`deriveStatus` returns `new` when every phase is pending
(`packages/minspec/src/lib/lifecycle.ts:139`), and a spec with no `phases:` block parses as
all pending. Their literal lines read `implementing` (23) or `done` (1). That drift is the
subject of SPEC-059 (status mirror drift gate) and SPEC-061 (phaseless approval writer); it
is not repaired here, and FR-10 and FR-11 are written so that it cannot be miscounted.

### Root cause of the missing dependency data (rider 1)

Measured: 28 of the 77 specs carry a `depends_on:` key, two of them as an explicit empty
list; 49 carry none. The graph holds 57 dependency edges, 38 to decision records and 19 to
specs, and none dangles.

**Root cause:** every route by which a spec comes to exist leaves the dependency statement
out, and no check on any surface requires one, because the accepted design defined an absent
key as "no dependency".

What produces the gap:

- **The dispatch prompt.** `scripts/dispatch-issue.sh:825-827` lists the frontmatter a
  spec-writing agent must set: `id`, `type`, `status`, `tier`, `product`, `epic`,
  `relates_to`. `depends_on` is not on it. The issue attributes its 90 drafts to the drain,
  which writes specs through this prompt. #2323 (the same prompt omits `implements:`) is
  the same shape.
- **The Specify guidance.** `FRONTMATTER_GUIDANCE`
  (`packages/minspec/src/lib/slash-commands.ts:81-100`) names `status`, `tier` and
  `implements`. It does not mention dependencies.
- **`createSpec`.** `packages/minspec/src/lib/spec-manager.ts:371-379` builds the
  frontmatter of a new spec with no such key. The function also has no caller: no command
  in the extension creates a spec (#2611, filed from this spec), so there is no creation
  step that could ask.

What fails to reject it:

- **The reader equates absent with empty.** `parseEdgeArray`
  (`packages/minspec/src/lib/artifact-graph.ts:115-124`) returns no edges when the key does
  not match, the same value it returns for `depends_on: []`. A block-form YAML list also
  fails the match (`:116`), so it reads as no dependency too. All 28 statements today are
  inline lists.
- **The approve-time validator skips the field.**
  `packages/minspec/src/lib/spec-validator.ts:482` records that `depends_on` is "not
  validated here".
- **The commit and CI validator never reads it.** `scripts/validate-frontmatter.ts` has no
  occurrence of `depends_on`. The same file fails a spec with no `epic:` (`:209-216`), which
  is the precedent for the missing direction.
- **The resolver checks only the present direction.** A dependency whose target does not
  exist is reported as corruption (`packages/shared/src/next-task.ts:348-359`). A spec that
  states nothing is not reported. That is the asymmetry DR-003 (root-cause-driven debugging)
  names: a value is validated when present and never required.
- **The decision allowed it.** DR-019 (deterministic next-task graph) records the edges as
  "backward compatible", with "absent = no cross-cutting edge, so existing epics/specs/ADRs
  need no migration" (`docs/decisions/DR-019.md:132-134`). This spec changes that
  consequence for specs; #2609 (DR-019 addendum) tracks the record.

### What "being built" can be read from

The resolver cannot tell an approved spec nobody has started from one being built: the
adapter maps `planning` to the resolver's `implementing`
(`packages/minspec/src/lib/artifact-graph.ts:66-78`), and `gateCleared` treats a dependency
as cleared once it is approved (`packages/shared/src/next-task.ts:271-284`). Both are right
for ordering approvals. Neither answers "is this being built", so the readiness computation
must read the derived status before that mapping (FR-10).

### What already exists and is reused

- **The graph and its floor.** `floorDependsOn` (defined at
  `packages/shared/src/next-task.ts:1094`, called at `:1186`) already ranks a blocked item
  below its blocker. With statements on 28 of 77 specs it rarely binds.
- **Epic order.** All ten epics carry `order:`; all ten are `active`.
- **Issue edges.** `parseDeclaredBlockers` (`scripts/lib/issue-rank.ts:225`) reads only
  explicit "blocked by" and "depends on" declarations plus GitHub's own blocked-by relation,
  and `explicitLinks` (`:341`) reads the epic or spec an issue serves. Its header records
  that 12 percent of open issues declared a blocking relation when it was written (`:22`,
  not re-measured here).
- **The spec-writing switch.** `MINSPEC_DRAIN_SPECIFY` (`scripts/drain-inbox.sh:1130`) turns
  the drain's spec writing on or off as a whole. It has no notion of which issue is next.
- **Owned-file lists.** `implements:` and `affects:` (SPEC-038) are the files a spec names.
- **A headless reader.** `scripts/next-task.ts` (SPEC-076, headless signpost reader) is the
  model for exposing a pure computation to a script.

### Why the backfill is not free by default

`depends_on:` is inside the bytes an approval signs. `stripLifecycle` removes exactly
`status` and `phases` (`packages/shared/src/canonical.ts:60-83`). Verified with a control on
SPEC-096 (only Initialize creates the marker): adding `depends_on: []` changes `specHash`
from `1b3c314a5ff4` to `6c9ddc674cb9`, and editing `status:` leaves it unchanged. 48 of the
49 specs with no statement hold a current approval, 46 of them at T3 or T4. Writing the line
into those files voids 48 signatures. OQ-1 is that choice.

## Terms

- **Spec** - a primary spec file: the `requirements.md` of a split-layout directory or a
  single-file spec, as `discoverSpecs` selects it
  (`packages/minspec/src/lib/artifact-graph.ts:228`). Sibling `design.md` and `tasks.md`
  files are not specs for any rule here.
- **Dependency statement** - what a spec or an issue records about what it depends on. It
  has three readings: some targets, explicitly none, or not stated.
- **Candidate** - something the rule is asked about: an issue with no spec yet, or a spec
  with no current approval.
- **Pin** - a recorded request to specify one candidate now (FR-9).
- **Approval queue** - specs that exist and hold no current approval. **Unbuilt pile** -
  specs that hold a current approval and whose build has not started.
- **Baseline** - the commit a spec was written against, or last refreshed against.

## Functional Requirements

### A. Every spec says what it depends on (rider 1)

- **FR-1 - The statement, and its "nothing".** A spec's dependency statement is the
  `depends_on:` key in its frontmatter, written as an inline list of ids of this project's
  specs, decision records or epics. `depends_on: []` MUST mean "depends on nothing" and MUST
  be accepted as a complete statement. An absent key MUST mean "not stated" on every surface
  that reads it, and MUST NOT be read as "depends on nothing" by any rule in this spec.

- **FR-2 - One gate, three findings, both directions.** One exported function MUST report,
  for a spec: `dependency.missing` (no statement), `dependency.unreadable` (the key is
  present but is not an inline list, for example a block-form list or a bare word) and
  `dependency.unknown-target` (an entry that resolves to no spec, decision record or epic).
  `validateSpec` (`packages/minspec/src/lib/spec-validator.ts:899`, the approve gate and
  Check Spec Completeness) and `scripts/validate-frontmatter.ts` (the commit hook and CI)
  MUST both call that one function, as they do `checkAcceptanceCriteria` (`:678`), so the
  rule cannot differ between surfaces. If the function cannot run, the validator MUST say it
  validated nothing, as Rules 16 to 19 do.

- **FR-3 - Severity is a setting, so nobody's project turns red on upgrade.** The severity
  of FR-2's findings MUST come from one project setting that defaults to `warn`, following
  `ownershipDeclaration` (`.minspec/config.json:57`). This repository MUST set it to `error`
  in the same change that lands the backfill of FR-6, so `main` is green before and after.

- **FR-4 - Every producer writes the statement.** Each route that produces a new spec MUST
  write or instruct a dependency statement, with `[]` named as the answer for "nothing":
  the dispatch prompt (`scripts/dispatch-issue.sh:820-836`), the Specify guidance
  (`packages/minspec/src/lib/slash-commands.ts:81-100`), `createSpec` and the example spec
  (`packages/minspec/src/commands/example.ts:68`). A test MUST hold the list of producers
  and fail when a producer omits it, and MUST fail when it finds no producer to check.

- **FR-5 - Readers tell "none" from "not stated".** The graph adapter MUST expose, for each
  spec, which of the three readings its statement has. The edges it passes to the resolver
  MUST stay exactly as they are today for every statement that exists (INV-6).

- **FR-6 - The backfill.** Every spec on `main` MUST end with a dependency statement, each
  carrying one line of evidence: the sentence or reference in the spec it was derived from,
  or, for "nothing", that no blocker is named. A spec with no current approval takes the
  statement in its frontmatter. A spec with a current approval takes it in one committed
  backfill list, outside its signed text, so that no approval is voided (OQ-1, INV-5). The
  gate of FR-2 MUST treat a list entry as that spec's statement, MUST report a spec that has
  a statement in both places, and MUST report a list entry for a spec that was not approved
  when the backfill landed. When a listed spec is next re-approved its statement MUST move
  into its frontmatter in the same change and its entry MUST be deleted, so the list only
  shrinks.

- **FR-7 - Issues carry a statement too.** An issue's dependency statement is an explicit
  declaration in the grammar `parseDeclaredBlockers` already reads, extended with an
  explicit "none". An issue with no declaration MUST read "not stated". The triage gate that
  emits the ready labels (`scripts/triage-decide.sh:175-196`) MUST NOT emit
  `agent-ready-specify` for an issue with no statement, and the triage prompt MUST ask for
  one. Existing issues are not edited in bulk: one gains its statement the next time it is
  triaged.

### B. Ready to specify

- **FR-8 - One computation.** One pure function in `@aiclarity/shared` MUST answer, for a
  candidate, `ready` or `not-ready` with every reason that applies, taken from a closed list:
  `no-epic`, `epic-not-current`, `no-dependency-statement`, `dependency-not-built`,
  `approval-queue-full`, `unbuilt-pile-full`. It also returns notes that do not change the
  answer, from a second closed list: `pinned` and `dependency-has-no-phase-map`. It MUST
  import nothing from `vscode`, the filesystem or the network, and its inputs are handed to
  it by adapters. The editor, the
  validator, the headless entry point and the drain MUST all call it, and none may hold a
  second copy of any condition (INV-4).

- **FR-9 - The four conditions, and the pin.** A candidate is `ready` when all of these
  hold:
  - (a) its epic is the current epic: the one with the lowest `order:` among epics whose
    status is `proposed` or `active`. An epic with no `order:` sorts last;
  - (b) it has a dependency statement and every target in it is done or being built
    (FR-10);
  - (c) the approval queue is below its limit;
  - (d) the unbuilt pile is below its limit.

  A pin replaces (a) and (d). It never replaces (b) or (c). A pin is a label on the issue,
  its name read from project config, and any account with write access may apply it. Every
  surface that acts on a pin MUST name the issue and the account that applied it.

  When the current epic has no unfinished spec and, where issue data is loaded, no open
  issue, every surface MUST say so and name the act that moves on (marking the epic done).
  None may advance to the next epic by itself.

- **FR-10 - "Done or being built".** A target is satisfied when: a spec holds a current
  approval and derives `implementing` or `done`; a decision record is `accepted`; an epic is
  `active` or `done`; an issue is closed, or is served by a spec that satisfies the spec
  rule. A spec that derives `planning` is not satisfied. The computation MUST read the
  derived status before the adapter maps `planning` to `implementing`. A spec that holds a
  current approval but has no phase map has no recorded build state: it MUST count as
  satisfied, and every result that relied on it MUST carry the note
  `dependency-has-no-phase-map` naming it. That is a deliberate fail-open on 24 specs whose
  literal status is `implementing` or `done`; the alternative holds back every candidate
  that depends on the core specs until SPEC-061's subject is repaired.

- **FR-11 - Two piles, counted apart (rider 2).** The computation MUST return three counts:
  the approval queue (no current approval, not archived or superseded), the unbuilt pile
  (current approval, derived `planning`) and the no-phase-map bucket (current approval, no
  phase map). The bucket counts toward neither limit and MUST be shown beside them. Each
  limit is read from project config and defaults to five. Each count MUST name the
  population it was taken over: the working tree alone, or the working tree plus spec
  drafts in open pull requests, meaning open pull requests that add a primary spec file.
  The two piles MUST NOT be summed into one number anywhere.

- **FR-12 - What the editor shows.** All of it is advice; none of it refuses.
  - The Backlog panel, once the user has loaded it (SPEC-085, Backlog fetch consent), marks
    each issue `ready` or lists its reasons. Before it is loaded it shows nothing about
    readiness, and never `ready`.
  - A spec with no current approval for which (a) or (b) fails is marked "written early",
    with the reason, in the Specs pane and as a warning from Check Spec Completeness and the
    corpus validator. It is never an error. The approve flow shows the same note without
    stealing focus and proceeds.
  - Show SDD Status shows the two piles and the no-phase-map bucket.
  - Nothing here runs at activation, opens a toast unasked or contacts the network.

- **FR-13 - A headless entry point.** `scripts/specify-ready.ts` MUST print the same answer
  as JSON for a project root, given optional issue records and an optional count of drafts
  in open pull requests. It MUST refuse a root with no `.minspec/` by name, as SPEC-076 FR-2
  does, emit the same bytes for the same inputs, and make no network call itself.

- **FR-14 - The drain follows the rule.** The drain MUST write a spec only for an issue the
  computation calls `ready`, counting drafts in open pull requests in the approval queue,
  and MUST ask again after each spec it writes, so one cycle cannot pass a limit. Each cycle
  MUST print how many issues
  it held back under each reason, and MUST word a cycle that wrote nothing because of the
  rule as waiting by design, distinct from a failure. If the computation fails or returns
  anything but an answer for each issue it was given, the drain MUST write no spec that
  cycle and say so. When a `ready` issue already has a parked draft, the drain MUST reopen
  that draft and refresh it, and MUST NOT claim a second id.

### C. Fresh before build

- **FR-15 - Every spec has a baseline.** A spec written after this ships MUST record the
  commit it was written against, and the producers of FR-4 MUST instruct it. A spec with no
  recorded baseline, which is every spec today, reads a derived one: the last commit that
  changed its canonical content. Every surface MUST mark a derived baseline as derived. The
  record MUST be committed with the project and MUST live outside the spec's signed text and
  outside its approval record, so that moving it neither voids nor rewrites a sign-off.

- **FR-16 - Stale, fresh or unknown.** For a spec that derives `planning` (approved, build
  not started), one pure function MUST return `stale` when, since the baseline, a
  file named in its `implements:` or `affects:` changed, or the canonical hash of a
  `depends_on` target differs (the same `specHash` approvals use). It returns `fresh` when
  neither happened, and `unknown` when local git history cannot answer (a shallow clone, a
  baseline commit that is not present, an untracked spec). `unknown` MUST never be shown or
  treated as `fresh`. A `stale` result MUST list what changed. Only local git is read.

- **FR-17 - The next task is "refresh", not "build".** For a `stale` spec the Next Task
  signpost MUST show a refresh task that names the changed files and targets, in place of
  the build action it shows today, never beside it. For `unknown` it MUST say freshness
  could not be checked, and why. The task is authoring work and MUST NOT carry an Approve
  control. The adapter computes the result and the resolver only consumes it, as it does
  `implementHole`. No git process runs at activation.

- **FR-18 - A build does not start on a stale spec.** The drain MUST NOT dispatch a build
  for a spec that reads `stale` or `unknown`, and MUST say which and why. A change that
  moves a spec's `phases.implement` out of `pending` while the spec read `stale` or
  `unknown` at the parent commit MUST be reported by the commit-time and CI validators, by
  spec id and changed file, at the severity of FR-3. That check compares two commits, which
  the corpus validator does not do today; how it obtains the parent is a Plan decision. A
  spec whose build had started before this ships is not examined.

- **FR-19 - What a refresh records.** A refresh ends one of two ways. If the spec's text
  changes, the approval reads stale by the existing hash rule and the spec joins the
  approval queue. If nothing needs changing, the baseline moves to the current commit and
  the record gains who moved it, when, and one line of reason for each changed file or
  target; the approval is untouched. An agent session MAY record the second outcome (OQ-3).

### D. The opening carries the decision

- **FR-20 - The opening is required.** A T3 or T4 spec with no current approval MUST open
  with a section whose heading begins "In plain terms", placed first after the title. It is
  one paragraph of at most 120 words that says what changes for the reader and carries three
  labelled statements: `Cost:`, `Left out:` and `Riskiest assumption:`. One exported
  function, called from the same two places as FR-2's, reports `opening.missing`,
  `opening.misplaced`, `opening.too-long` and `opening.incomplete` (a label absent, or
  empty), at the severity of FR-3. The rule MUST
  NOT apply to a spec while it holds a current approval, because adding a section to signed
  text would void the signature.

- **FR-21 - Every producer writes the opening.** The producers of FR-4 MUST write or
  instruct the opening section, and the same inventory test covers it.

- **FR-22 - The panel checks the opening against the body.** The review panel's
  instructions (`scripts/roles/approvable-reviewer.md`, and the generated copy in
  `packages/minspec/src/lib/ci-review-templates.ts`) MUST direct a reviewer to return a
  blocking finding when a spec's opening omits something its body requires of the reader, or
  contradicts the body. Approval still binds to the whole text.

## Costly to Refactor

Ranked by what is hardest to undo.

1. **`depends_on` becomes required, and `[]` means "nothing".** Why costly: once the
   validator demands it, every spec and every producer carries it, and statements written
   under the rule stay in signed text. What to check: an absent key and a block-form list
   are both reported, never read as "nothing" (FR-1, FR-2).
2. **The backfill list as a second home (OQ-1 Option A).** Why costly: two places hold the
   same kind of fact until the list empties, and every reader must merge them. What to
   check: a spec with a statement in both places, or in neither, is reported (FR-6).
3. **The reason list of FR-8.** Why costly: the editor, the headless output, the drain and
   later the graph view all read it. What to check: it is closed, and a new reason is added
   in one place.
4. **A new kind of signpost task (FR-17).** Why costly: `NodeKind` is a closed list
   (`packages/shared/src/next-task.ts:169`), and the comment above it (`:166-168`) records
   that SPEC-014 (review webview) forbids an Approve control on authoring work. What to
   check: whether refresh is a new kind or a variant of `phase-action` is settled in Plan,
   before any surface renders it.
5. **Where the baseline lives (FR-15).** Why costly: a frontmatter key would have to leave
   the approval hash, which changes both hash twins (`packages/shared/src/canonical.ts` and
   `scripts/hooks/canonical.py`) and needs a decision record. What to check: Plan keeps it
   outside signed text.
6. **The triage statement and the role prompts (FR-7, FR-22).** Why costly: both are review
   and dispatch machinery, embedded in a generated template that adopters receive. What to
   check: `node scripts/gen-ci-templates.mjs` is run, and the change merges as machinery.

## Acceptance Criteria

- [ ] A spec with no `depends_on:` key is reported `dependency.missing` by Check Spec
      Completeness, by the approve gate and by `npm run validate`, in the same words.
      (FR-1, FR-2)
- [ ] `depends_on: []` passes on all three, and a block-form list is reported
      `dependency.unreadable`. (FR-1, FR-2)
- [ ] With the setting absent the findings are warnings; this repository's setting is
      `error`, and `npm run validate` is green on the commit before the backfill and on the
      commit after it. (FR-3, FR-6)
- [ ] Removing the dependency instruction from any one producer turns the inventory test
      red, and so does a run in which it finds no producer. (FR-4, FR-21)
- [ ] After the backfill every spec on `main` has exactly one statement with its evidence
      line, and the `specHash` of every spec that was approved before it is unchanged.
      (FR-6, INV-5)
- [ ] For an issue with no declaration the answer includes `no-dependency-statement`; with
      "none" declared it does not. (FR-7, FR-8)
- [ ] A candidate in the second-lowest open epic reads `epic-not-current`; the same
      candidate pinned does not, and the output names the pin's issue and account. (FR-9)
- [ ] A candidate that depends on a spec deriving `planning` reads `dependency-not-built`;
      on one deriving `implementing` it does not; on an approved spec with no phase map it
      does not, and the result names that spec. (FR-10)
- [ ] With five specs awaiting approval a sixth candidate reads `approval-queue-full`,
      pinned or not; the three counts are shown separately and never summed. (FR-9, FR-11)
- [ ] The editor's answer, the headless output and the drain's decision agree for the same
      inputs, and a test fails if any of them holds its own copy of a condition.
      (FR-8, FR-13, FR-14)
- [ ] A drain cycle that writes nothing because a limit is reached says it is waiting by
      design and gives the count under each reason; a cycle in which the computation fails
      writes no spec and says so. (FR-14)
- [ ] After a file in a spec's `affects:` changes, the signpost for that approved, unbuilt
      spec reads "refresh" and names the file; in a shallow clone it reads "freshness could
      not be checked", never fresh. (FR-16, FR-17)
- [ ] Hand-editing a stale spec's phase map to start its build is reported by the validator;
      after a recorded refresh the same edit is not. (FR-18, FR-19)
- [ ] A no-change refresh leaves the approval record byte-identical and the spec approved.
      (FR-15, FR-19, INV-5)
- [ ] An unapproved T4 spec with no opening, with the opening second, with 121 words, or
      with `Cost:` missing is reported under the matching finding; an approved spec with no
      opening is not reported. (FR-20)
- [ ] No test or command introduced here contacts the network, and nothing new runs at
      activation. (FR-12, INV-1)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1).** The computation, the gate and the
  freshness check read the filesystem and local git only. Issue data reaches the editor only
  through the Backlog panel's existing consent gesture; the drain is the only caller that
  brings network data.
- **INV-2 - No silent gate (constitution invariant 2).** A statement that is not stated, a
  `depends_on:` key that cannot be read and a freshness that is unknown are each a named
  result. None is ever rendered as "none", `ready` or `fresh`. The one deliberate fail-open,
  a dependency with no phase map (FR-10), is named in every result it touches and counted
  in its own bucket. A check that cannot run says it checked nothing.
- **INV-3 - Blast radius (constitution invariant 3).** Everything written is inside the
  project. New findings ship as warnings, so an adopter's build does not fail on upgrade.
- **INV-4 - One implementation.** Exactly one definition of each condition exists. Two
  answers to "may this be specified" would diverge, and the wrong one would be believed.
- **INV-5 - No approval is voided or rewritten by this change.** The backfill and the
  baseline record leave every existing `specHash` and every approval record as they are.
- **INV-6 - Existing ordering is unchanged.** The resolver's ranking, `gateCleared`, the
  floor and the `planning` to `implementing` mapping behave as today for every edge that
  exists today.
- **INV-7 - Advice in the editor, a rule in the drain.** No editor surface refuses to write,
  validate or approve a spec because it is early. Only the drain acts on the answer.
- **INV-8 - No nagging (constitution principles 2 and 4).** No toast at activation and no
  repeated prompt. A note appears in answer to something the user did.
- **INV-9 - Boundaries (constitution constraints 1 to 3).** `@aiclarity/shared` stays free
  of `vscode`, filesystem and network imports; git reads live in the adapter.

## Open questions for the founder (recommended answers recorded by an agent 2026-10-09; ratified only by approval of this spec)

Each question carries a **Recorded selection** line naming the option this document
recommends. An agent session wrote those lines on 2026-10-09; the founder has not chosen
them. This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which
an agent proceeds on a stated recommendation and leaves the options it did not take on
record (DR-086, autonomy as a second axis). Approving a T3 or T4 spec is on that record's
stop list (`scripts/lib/autonomy.ts:68-71`), so nothing here stands in for the approval: the
lines propose, and approving this spec ratifies them. An approval covers this section,
because the hash covers the body, so changing a selection afterwards voids it.

### OQ-1 - How do 48 approved specs get their dependency statement?

**Recorded selection: Option A,** one committed list outside the specs' signed text.

- **Option A - a backfill list (rec).** As FR-6 specifies. *Cost:* agent-written statements
  for 48 approved specs take effect with no human reading them one by one, which DR-019
  lists as a step every edge needs (`docs/decisions/DR-019.md:156-158`), and those specs
  keep their statement in a second place until each is next re-approved.
- **Option B - edit the 48 specs and re-approve each.** Every edge is accepted by a
  signature. *Cost:* 48 approvals, five at a time under FR-11, and while each is void the
  owned files of a T3 or T4 spec whose plan has started are frozen
  (`scripts/hooks/spec-gate.py:6-7`, `:55`).
- **Option C - take `depends_on` out of the signed text,** as DR-088 (ownership leaves the
  hash) did for `implements:`. *Cost:* it changes what a signature covers, needs its own
  decision record, and re-hashes the 27 approved specs that already carry the line. Tracked
  as #2610 (should the dependency key leave the hash).

Under B or C, FR-6's list and its three checks are removed and INV-5 is restated.

### OQ-2 - How large is the second limit, and does today's pile count against it?

**Recorded selection: Option A,** five, counting the 41 already there, with a pin lifting
it.

- **Option A - five, counting today's pile (rec).** As FR-9 (d) and FR-11 specify. *Cost:*
  the drain writes no spec you did not pin until 37 of the 41 approved specs have had their
  build started, been archived or been superseded.
- **Option B - five, counting only specs approved from now on.** Spec writing resumes at
  once. *Cost:* 41 approved specs sit outside the count, which is the hidden pile the
  separate count was meant to expose.
- **Option C - show the count, enforce no limit yet.** *Cost:* nothing stops the pile
  growing, which is the state the proposal starts from.

Under B or C only condition (d) of FR-9 changes.

### OQ-3 - Who may record "refreshed, nothing needed changing"?

**Recorded selection: Option A,** an agent session may.

- **Option A - an agent may (rec).** As FR-19 specifies. *Cost:* no human checks the
  judgement that a change did not matter, and a wrong one builds from a stale spec, which
  is the failure the check exists to prevent. The record names who made it and why.
- **Option B - only you.** *Cost:* each of the 41 approved specs needs an act from you
  before its build can start, since every one of them predates this rule.

Under B, FR-19's last sentence is reversed and the act joins the stop list of DR-086, a
change that record reserves to a human (`scripts/lib/autonomy.ts`, the class
`edits-the-autonomy-rules`).

## Decision records

No new record is needed for the mechanism under the recommended answers: it adds a validator
rule behind a setting, a pure computation and one committed list, and each can be removed in
under a day. Two things do touch the register. DR-019's recorded consequence that an absent
key needs no migration stops being true for specs, and needs an addendum once this is
approved (#2609). And OQ-1 Option C, or a baseline kept in frontmatter, would change the
approval hash; neither may reach Plan without its own record (#2610).

## Out of Scope

- **The graph view.** #48 (unified next-task graph surface) and its draft in pull request
  #2512 are where the frontier would be drawn. FR-8's result is shaped for it; nothing is
  drawn here.
- **Repairing specs with no phase map.** SPEC-061 (phaseless approval writer). FR-10 and
  FR-11 only keep them from being miscounted.
- **Literal status lines that disagree with derived status.** SPEC-059 (status mirror drift
  gate).
- **Whether an approval is still valid after a dependency changed.** SPEC-041
  (cross-artifact approval staleness). FR-16 asks a different question, against a different
  baseline, with the same hash.
- **Whether the edges are accurate.** #803 (prose-link linter and edge provenance). FR-6's
  evidence line is the only check here, and it is why the opening names accuracy as the
  riskiest assumption.
- **Dependency statements on decision records and epics.** None of the 101 decision records
  or 10 epics declares one today, and no rule here asks them to.
- **A cross-pull-request check for spec ids.** #2055 (the id allocator is blind to unmerged
  branches).
- **A command that creates a spec.** #2611 (no command calls `createSpec`).
- **Editing existing issues in bulk** to add statements (FR-7 adds them at triage).
- **The drain's quota gate and its spec-writing switch.** Both shipped and unchanged.

## What this costs

- The drain will write nothing for long stretches, on purpose, and that will look like a
  stall. FR-14's wording is the only thing that tells the two apart.
- An issue with no dependency statement is never ready, pinned or not, and one with no epic
  is ready only when pinned. Triage has to record both, and until it does the ready set is
  small.
- Every approved spec written before this rule reads stale on first check, so each gains a
  refresh before its build.
- The backfill is agent-written. A wrong statement misorders work until someone notices.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **One combined limit.** Rejected on the issue: a full unbuilt pile would stop all spec
  writing, and an empty one would hide a growing approval queue.
- **Keep "absent means none" and add a lint.** Rejected: it is the weak point the founder
  asked to remove, and a warning joins about 180 others that `npm run validate` prints.
- **Infer dependencies from citations.** Rejected: 75 percent of issues cite another issue
  and 12 percent declare a blocker (`scripts/lib/issue-rank.ts:22-23`); a citation is not an
  edge.
- **Refuse to create or approve an early spec.** Rejected: the proposal asks for a warning
  with an override, and a human at the keyboard is the override.
- **A pin only a human account may set.** Rejected: the founder steers through agent
  sessions that write as the App identity, so an identity test would refuse his own pins.
  FR-9 makes the pin visible instead.
- **Advance to the next epic when the current one has no unfinished spec.** Rejected:
  offline, an epic with fifty open issues and no spec left looks finished.
- **Treat a spec with no phase map as not built.** Rejected in FR-10, with its cost stated.
- **Have a model judge readiness or freshness.** Rejected: DR-019 keeps the model out of the
  signpost, and the same reasoning applies.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `dependency-statement-gate.test.ts` (FR-1 to FR-3, shown
  red on today's corpus), `specify-ready.test.ts` (FR-8 to FR-11),
  `spec-freshness.test.ts` (FR-16) and `spec-producer-inventory.test.ts` (FR-4, FR-21).
- **Agreement:** one fixture run through the editor path, the headless entry point and the
  drain's call, asserting the same answer (INV-4).
- **Backfill:** `specHash` of every approved spec before and after, compared whole, not by
  prefix (INV-5).
- **Not vacuous:** each condition of FR-9 and each finding of FR-2 and FR-20 is removed one
  at a time and the suite is shown to turn red, with a clean control run. Fixtures vary the
  number of specs and of producers, not only the code.
- **Under CI's shape:** the tests run through `npx vitest run`, which is what CI runs
  (`.github/workflows/ci.yml:184`), and the gate through `npm run validate` (`:86`).

## Traceability

- **Issue:** [#2584](https://github.com/AIClarityAU/minspec/issues/2584), with the founder's
  decision recorded in its first comment.
- **Follow-ups filed from this spec:** #2609 (DR-019 addendum), #2610 (should the
  dependency key leave the hash), #2611 (no command calls `createSpec`).
- **Same shape, earlier:** #2323 (the dispatch prompt omits `implements:`), #137 (the
  symmetric frontmatter validator).
- **Governing decisions:** [DR-019](../../../docs/decisions/DR-019.md) (deterministic
  next-task graph), [DR-034](../../../docs/decisions/DR-034.md) (approval foundation),
  [DR-069](../../../docs/decisions/DR-069.md) (the `planning` status),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius),
  [DR-086](../../../docs/decisions/DR-086.md) (acting on a recommendation),
  [DR-088](../../../docs/decisions/DR-088.md) (ownership leaves the hash).
- **Specs this builds on:** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)
  (next-task resolver), [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md)
  (spec-to-code ownership),
  [SPEC-076](../SPEC-076-headless-signpost-reader/requirements.md) (headless signpost
  reader), [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) (Backlog fetch
  consent).
- **DR for this spec:** none under the recommended answers; see "Decision records".
