---
id: SPEC-142
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; this is the order its dispatch queue is walked in
aspects: [drain, dispatch-order, ranker, signpost, backlog, dev-time, no-silent-gate, blast-radius]
depends_on: [SPEC-012]  # SPEC-012 (next-task resolver) owns the structural dials the ranker's spec term mirrors
relates_to: [SPEC-062, SPEC-074, SPEC-076, SPEC-134, DR-076, DR-086, "#420", "#2196", "#2197", "#2641", "#406"]
# Modified, not owned by any other spec. #2196 shipped the ranker with no owning spec;
# this spec changes these four files and creates none. All four exist today.
affects: [scripts/lib/issue-rank.ts, scripts/rank-issues.ts, packages/minspec/tests/issue-rank.test.ts, packages/minspec/tests/issue-rank-cli.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-142: A declared value signal for the drain's dispatch order

> **Most of #420 has already shipped.** The automated drain no longer picks ready issues
> in GitHub API order. It ranks them (#2196). This spec covers only what that ranker
> still cannot express: an issue's **value** ("a major blocker", "big financial impact")
> when the issue declares no blocking edge and serves no spec.

Materializes **#420** ("auto-dispatch ignores DAG priority resolver"). Tier: T3 (full
spec cycle: specify, plan, tasks, implement). That tier is the triage floor this dispatch
was given and is not lowered here, even though the mechanical scope is four existing
files (see "Why T3").

## One-Sentence Scope

Add one explicit, label-declared value term to the drain's issue ranker
(`scripts/lib/issue-rank.ts`). Unlabelled issues stay neutral, so an issue a human or
agent marks high-value or low-value moves ahead of or behind otherwise equal work. The
ranker stays lexicographic, status-blind and set-preserving, and the drain keeps its
loud numeric-order fallback.

## Context

### What #420 asked for, and what has already landed

#420 (filed 2026-07-03) found that `scripts/drain-inbox.sh` dispatched `agent-ready`
issues "in whatever order the GitHub API happens to return", with no priority read. That
is **no longer true** at this commit:

- **The drain ranks before it dispatches.** `run_cycle` pipes the whole ready set
  (`agent-ready` and `agent-ready-specify`, `scripts/drain-inbox.sh:1433`) through
  `scripts/rank-issues.ts` (`:1487-1516`). It adopts the ranked order only when the
  ranker exits 0 *and* returns exactly the set it was given. Otherwise it dispatches in
  numeric order and prints a `WARNING` saying so (`:1507-1512`).
- **The read is uncapped and the cap applies after ranking** (#2197, `:1185-1200`). The
  cap counts dispatches that start (#2641). So a high-ranked old issue is always a
  candidate, and the order decides which issues get the `_dispatch_cap` slots (default 30).
  A usage-limit signal pauses the cycle partway, and the breaker can halt it (`:1745-1751`). The order is therefore what
  spends the budget, which is the cost #420 worried about.
- **The order** (founder-approved on #2196, 2026-09-28; `scripts/lib/issue-rank.ts:10-19`)
  is strictly lexicographic, never a weighted score:
  1. **unblocks**: how many other open issues this one transitively unblocks, highest first.
  2. **spec rank**: the structural position of the spec or epic the issue explicitly
     serves. It comes from the signpost's own fs adapter, `buildArtifactGraph`
     (`scripts/rank-issues.ts:229`), sorted on the dials of the resolver's comparator
     (epic `order:`, goal rank, `priority:`, id). Lowest first; an issue serving no spec
     sorts last on this term.
  3. **tier**: lowest first, as a tiebreak only.
  4. **issue number**: lowest first.
- **The comparator copy is pinned.** `structuralOrder` copies the resolver's
  `compareRanked` without its status-derived class, and a test holds the copy to the
  original (`packages/minspec/tests/issue-rank.test.ts:252-255`).

So the fs adapter #420 said was missing exists (`buildArtifactGraph`, also used by the
SPEC-076 headless signpost reader), and the drain's dispatch order already uses the same
structural priority as the human signpost.

### Why the ranker does not call `resolveNextTask` directly, and this spec does not change that

#420's first proposed fix was to "call `resolveNextTask`/`resolvePipeline`". #2196
rejected that on purpose: the resolver's lead sort key is a class derived from spec
`status:`. The ranker's header records that `status:` is not evidence, because SPEC-021,
SPEC-033 and SPEC-063 all self-reported `implementing` with no implementation
(`scripts/lib/issue-rank.ts:31-35`). The resolver also returns one next *artifact*, not
an order over *issues*. This spec keeps that decision (INV-3).

### The residual gap: value has no input

Only two inputs can lift an issue in the order: a **declared blocking edge** (term 1) and
the **spec it serves** (term 2). The phrase in #420, *"a major blocker (or big financial
impact) issue"*, has two halves:

- **Major blocker.** Covered by term 1 *only when declared*. The ranker reads only
  explicit "blocked by" / "depends on" declarations and GitHub's native `blockedBy`. It
  never reads citations (`issue-rank.ts:21-30`): at #2196, 12% of open issues declared a
  blocking relation and 75% merely cited one. An undeclared blocker ranks as unblocking 0.
- **Big financial impact.** **Not covered at all.** No issue-level field carries value.
  An issue serving no spec has no term-2 signal either. `--explain` counts these
  spec-less candidates (`scripts/rank-issues.ts:274-275`), but nothing can rank one above
  another except tier and number. How many of the current ready set are spec-less has
  **not been measured** for this spec (no network on this dispatch). Measuring it is the
  first task of the plan (see AC-8).

There is also no way to say "do this next" without editing an epic's `order:` or
inventing a blocking edge. Both distort the shared signpost to change one queue position.

### Why a label, and why it costs no new request

`OPEN_ISSUES_QUERY` already fetches every open issue's labels in the same paged GraphQL
call (`scripts/rank-issues.ts:73-87`, `labels(first: 100)`). A label-declared term adds
no request, no field and no credential, only a parse of data already in memory. A body
marker (as with blocking declarations) was the alternative; see "Rejected alternatives".

### Why T3

Classified on mechanical scope: four existing files, no new module, no schema, no
dependency. On scope alone that is T2 (spec and plan). It stays T3 for two reasons:

- The dispatch triage gave this issue a T3/T4 floor, and the ceremony floor only goes up.
- The change amends an order the founder approved on #2196, which is a human decision
  however small the diff.

## Functional Requirements

- **FR-1 (one declared value term).** The ranker MUST read a per-issue **value class**
  from labels in a fixed vocabulary: `value:high` and `value:low`. The exact label names
  are DQ-3; this text uses the recommended ones. An issue with neither label has the
  **neutral** class. The value class MUST come only from those labels. It MUST NOT be
  inferred from title or body words ("urgent", "blocker", "$", "P0") or from any other
  label, for the same reason the ranker refuses to infer edges from citations.

- **FR-2 (unlabelled is neutral, not lowest).** The three classes sort `high`, then
  `neutral`, then `low`. An unlabelled issue MUST sort exactly where it would sort today
  relative to other unlabelled issues. *Rationale: if unlabelled sorted after every
  labelled issue, a `value:low` label would move an issue up, which inverts the label's
  meaning.*

- **FR-3 (placement in the lexicographic order).** The value class is a new key in
  `compareRanked` (`scripts/lib/issue-rank.ts:563`). Where it sits relative to *unblocks*
  is DQ-1. Whatever DQ-1 selects, the order MUST stay **strictly lexicographic**: no
  weighted score, no combination of terms (INV-2).

- **FR-4 (conflicting labels resolve upward, visibly).** An issue carrying both value
  labels MUST rank as `high`. The ranker MUST emit a stderr note naming the issue and both
  labels. *Rationale: the failure #420 fears is a real blocker left waiting. A wrong
  `high` costs one early dispatch; a wrong `low` can starve an issue for many cycles.*

- **FR-5 (`--explain` shows the term and who set it).** The `--explain` table
  (`renderExplain`, `scripts/rank-issues.ts:244`) MUST show each candidate's value class
  in its own column, in the column position matching its sort position. Its summary MUST
  count how many candidates carry each class. Under DQ-2 Option B it MUST also show
  whether a bot or a human applied the label, when that is known.

- **FR-6 (inflation is reported, never auto-corrected).** When more than a threshold
  share of the candidate set is `value:high` (DQ-4 sets the threshold; the recommendation
  is 25%), the ranker MUST print a stderr warning naming the share. It MUST still rank
  normally. *Rationale: a high label everyone carries ranks nothing. The warning makes
  that visible. Silently ignoring labels past a quota would be a hidden gate.*

- **FR-7 (set-preserving contract unchanged).** The ranker's output MUST stay exactly the
  de-duplicated input set (`rankIssues` docstring, `issue-rank.ts:575-578`). It MUST
  still exit non-zero with nothing on stdout on any failure (`rank-issues.ts:11-13`). A
  malformed, unknown or conflicting value label MUST NEVER drop, duplicate or block a
  candidate. It affects position only.

- **FR-8 (no new request, no new credential).** The value class MUST be read from the
  labels already returned by `OPEN_ISSUES_QUERY`. If DQ-2 Option B needs the label's
  setter, that data MUST come from the same paged query (a field added to it), not from a
  per-issue follow-up call. The ranker MUST NOT make one request per candidate.

- **FR-9 (the drain's call site is unchanged).** `scripts/drain-inbox.sh` MUST need no
  edit. Its contract with the ranker (numbers on stdin, the same set reordered on stdout,
  a non-zero exit on failure, numeric fallback with a `WARNING`) already carries a new
  term. A change that needs a drain edit is out of this spec's scope and goes back to
  Clarify.

## Contract

The pure module's types grow by one field. Shape only; names are settled in Plan.

```ts
/** FR-1: the declared value class. Absent label → 'neutral'. */
export type ValueClass = 'high' | 'neutral' | 'low';

export interface RankedIssue {
  // ...existing fields (number, unblocks, specRank, tier, reasons)...
  value: ValueClass;
  /** FR-4: true when both value labels were present and resolved upward. */
  valueConflict: boolean;
}

/** Sort key: lower sorts first. high=0, neutral=1, low=2. */
export function valueKey(v: ValueClass): number;
```

`compareRanked` gains one comparison, at the position DQ-1 selects. Nothing else in the
type surface changes.

## Acceptance Criteria

- **AC-1 (FR-1, FR-2: neutral is neutral).** On a fixture whose candidates carry no value
  label, the ranked output is byte-identical to the output before this change. This is the
  regression guard that the term is inert until someone uses it.
- **AC-2 (FR-1: explicit only).** A candidate titled "URGENT blocker: $50k at risk" with
  no value label ranks as `neutral`.
- **AC-3 (FR-2: low sorts down, not up).** Two candidates equal on every other term: the
  `value:low` one sorts after the unlabelled one, and the `value:high` one sorts before it.
- **AC-4 (FR-3: placement).** A fixture pins the DQ-1 selection: a `value:high` candidate
  that unblocks 0, against an unlabelled candidate that unblocks 2. The asserted order is
  whatever DQ-1 selects, and the test names the DQ-1 option in its title, so changing the
  placement later means visibly changing the test.
- **AC-5 (FR-4).** A candidate with both labels ranks as `high`, and stderr names the
  issue and both labels.
- **AC-6 (FR-6).** A candidate set that is more than the threshold share `value:high`
  produces the stderr warning with the share, and the output is still the full ranked set.
- **AC-7 (FR-7).** A property test over random candidate sets with random value labels,
  including unknown ones such as `value:urgent`, asserts the output is a permutation of
  the input every time.
- **AC-8 (measured baseline before build).** Before implementation, the plan records,
  from one `--explain` run against the live ready set: how many candidates are spec-less,
  and how many unblock 0. If both are near zero, the gap this spec closes is small, and
  that measurement goes back to the founder under DQ-0 before code is written.
- **AC-9 (FR-9, INV-6).** `packages/minspec/tests/drain-issue-rank.test.ts` passes
  unmodified, and the comparator-parity block in
  `packages/minspec/tests/issue-rank.test.ts:252` passes unmodified.

## Invariants

- **INV-1 (order is not a gate).** The ranker changes *which issue goes first*, never
  *whether an issue goes*. Every candidate in is a candidate out (FR-7). The drain's
  numeric fallback on ranker failure stays loud (constitution invariant 2: no load-bearing
  signal is swallowed; a degraded order is announced, never presented as ranked).
- **INV-2 (lexicographic, never weighted).** As approved on #2196 (`issue-rank.ts:17-19`):
  no amount of a lower term may outvote a higher one.
- **INV-3 (status-blind).** No term reads a spec's `status:` (`issue-rank.ts:31-35`). The
  value term reads labels only.
- **INV-4 (explicit declarations only).** Edges, spec links and now value come only from
  declarations. Nothing is inferred from prose.
- **INV-5 (single structural order).** The spec term still comes from
  `buildArtifactGraph` and the resolver's dials. This spec adds no second copy of "what is
  next" (SPEC-076 INV-4).
- **INV-6 (blast radius, constitution invariant 3).** Everything here is dev-time tooling
  under `scripts/` and does not ship in the extension (CLAUDE.md "Agent Dispatch"). The
  label vocabulary exists only in this repository. No adopter's repo, labels or dispatch
  behaviour change.
- **INV-7 (offline core, constitution invariant 1).** The extension makes no new network
  call. The ranker's existing GraphQL read is dev-time and gains no extra request (FR-8).

## Non-goals

- **Quota-aware selection** (harvest316/scroogellm#43 token-cost estimation, #44
  quota-ramp backoff). #420 itself calls priority ordering "the more foundational piece";
  the quota layer builds on top and is tracked there.
- **Ranking the inbox before triage.** `drain-inbox.sh:1385` triages every inbox issue
  each cycle with no cap. Each triage is one classification call
  (`scripts/triage-inbox.sh:366`), so order matters there only when a cycle is cut
  short, and an untriaged issue has no tier or ready label to rank on yet. Not changed.
- **Re-validating stale `agent-ready` stamps.** That is #406, a different gap (whether an
  issue is still ready, not which ready issue goes first).
- **Whether a specify dispatch may run at all.** That is SPEC-134 (specify just in time).
  This spec only orders what is already allowed to run.
- **Creating the labels on GitHub.** Creating `value:high` / `value:low` in the repository
  is an outward act left to the implementation PR's human merge. The ranker treats an
  absent label as neutral, so nothing breaks before the labels exist.

## Rejected alternatives

Recorded per DR-086 §4, because under `autonomy: act` this record is the only review path.

- **Call `resolveNextTask` from the drain (#420's first suggestion).** Rejected; see
  Context. It reintroduces the status-derived class #2196 excluded as non-evidence, and
  it answers "the one next artifact", not "an order over N issues".
- **A numeric `priority:` field on issues, mirroring spec frontmatter.** Issues have no
  frontmatter. A body-parsed number invites false precision. A three-way class says what
  a human can actually judge (above, normal, below) and cannot be gamed by picking 0.1.
- **A body marker (`Value: high`) instead of a label.** It would match how blocking
  edges are declared. Rejected because labels are visible and filterable in GitHub's own
  list views, need no body-parse grammar, and the label setter is recorded by GitHub
  (needed for DQ-2 Option B). A body edit records only "edited".
- **Inferring value from words like "blocker" or "$".** Rejected under INV-4: it would
  produce a confident-looking wrong order, the failure #2196 already measured for edges.

## Decisions needed (Clarify)

### DQ-0 (scope): build the value term, or close #420 as delivered by #2196

- **Option A: build it (rec).** *Cost:* a new label vocabulary someone must apply for it
  to do anything, and an amendment to the order you approved on #2196.
- **Option B: close #420 as satisfied by #2196; withdraw this spec.** *Cost:* "big
  financial impact" stays inexpressible. A spec-less, non-blocking issue can only be
  lifted by editing an epic's `order:` or inventing a blocking edge, which bends the
  shared signpost to move one queue item.

Recommendation: **A**, subject to the AC-8 measurement. If that measurement shows almost
no spec-less candidates, B becomes the better answer.

### DQ-1 (placement): where the value term sits in the order

- **Option A: first, above *unblocks* (rec).** A deliberate "this matters most" beats an
  inferred count. *Cost:* a wrong `value:high` jumps a real declared blocker chain, and it
  replaces the lead term you approved on #2196.
- **Option B: second, after *unblocks*, before *spec rank*.** The #2196 lead term stays
  as approved. *Cost:* a `value:high` issue still waits behind every issue that unblocks
  even one other, so "big financial impact" loses to any small declared dependency.
- **Option C: high-only override first; low after *spec rank*.** Asymmetric: `high` leads
  everything; `low` only breaks ties among same-spec work. *Cost:* the most complex rule
  to read in `--explain`, and the two labels behave differently.

Recommendation: **A**. The term is inert on unlabelled issues (AC-1), so it only
reorders what someone explicitly marked, and FR-6 makes overuse visible.

### DQ-2 (authority): who may set a value label for it to count

- **Option A: humans only.** The ranker reads the label's setter from the same GraphQL
  query and ignores bot-applied labels. *Cost:* triage here is automated
  (`scripts/triage-inbox.sh`), so the term works only as often as a human hand-labels
  issues, which in practice may be rarely.
- **Option B: anyone, with the setter shown in `--explain` (rec).** Agents (triage, a
  supervising session) and humans may set it; `--explain` says which applied it. *Cost:*
  model judgement enters the order. Agents tend to mark everything important, and FR-6's
  warning detects that but does not stop it.
- **Option C: the triage agent sets it as a structured output field.** One producer, one
  place to audit. *Cost:* adds a field to the triage prompt and its parser
  (`scripts/triage-inbox.sh`), widening this spec's file scope. A human can still not
  override without editing a label, which brings back Option B anyway.

Recommendation: **B**. Under A the feature is nearly inert. B keeps the label honest by
showing who set it, rather than by restricting who may.

### DQ-3 (vocabulary): the label names

- **Option A: `value:high` / `value:low` (rec).** Names the thing being judged. *Cost:*
  new words; nobody in this repo uses a `value:` prefix yet.
- **Option B: `priority:high` / `priority:low`.** Familiar. *Cost:* collides in meaning
  with spec frontmatter `priority:`, which is a fine numeric dial with lower meaning more
  urgent. Two different `priority` concepts in one ranker is a reading trap.

### DQ-4 (threshold): the inflation warning share (FR-6)

- **Option A: 25% of the candidate set (rec).** *Cost:* arbitrary; with a small ready set
  (fewer than 8 candidates) two labels trip it.
- **Option B: no warning.** *Cost:* the first sign of inflation is a queue that ranks
  nothing, noticed late.

## Test

Changes to existing test files only (both listed under `affects:`):

1. `issue-rank.test.ts`: AC-1 (unlabelled fixture byte-identical), AC-2, AC-3, AC-4,
   AC-5, AC-7 (permutation property).
2. `issue-rank-cli.test.ts`: FR-5 (`--explain` column and per-class counts), AC-6
   (inflation warning on stderr, full set on stdout).
3. Unchanged and must still pass (AC-9): `drain-issue-rank.test.ts`, and the
   comparator-parity block at `issue-rank.test.ts:252`.

Write the invariant tests (AC-1 and AC-7) first.

## Traceability

- Triggered by: #420
- Builds on: #2196 (ranker), #2197 (fetch uncapped, cap after ranking), #2641 (cap counts
  started dispatches)
- Related, not duplicate: #406 (stale ready stamps), SPEC-134 (specify just in time),
  SPEC-076 (headless signpost reader)
- Decision record: none. Every choice here is undone in under a day by reverting four
  files; the labels are inert if the code is removed. The decision-record filter (a DR only
  for a choice that cannot be undone in under a day) does not trigger.

## Follow-ups (tracked)

None filed by this spec. The quota-aware layer is already tracked as
harvest316/scroogellm#43 and #44. Label creation on GitHub happens in the implementation
PR (Non-goals). If DQ-0 resolves to Option B, the follow-up is closing #420 against
#2196, which the founder does on reading this.
