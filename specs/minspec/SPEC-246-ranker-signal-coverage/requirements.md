---
id: SPEC-246
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (the issue ranker orders its dispatch queue)
aspects: [issue-ranking, drain, dispatch-order, observability, no-silent-gate, offline, blast-radius]
depends_on: []
relates_to: ["#2212", "#2196", "#2201", "#2197", "#2200", "#2198", "#420", SPEC-232, SPEC-142, SPEC-245, SPEC-134, DR-076, DR-086]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D4.
  Expected (unverified until Plan): scripts/lib/issue-rank.ts, scripts/rank-issues.ts,
  scripts/drain-inbox.sh and their tests.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-246: The issue ranker says how much of its order came from real signal, so a ranker with no input data is never mistaken for a working one

> **This is a SPECIFICATION ONLY.** Written for issue #2212. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The drain orders its ready issues with the issue ranker (#2196, built; #2201, merged). The
ranker sorts on four terms in strict order: what an issue unblocks, the spec or epic it
serves, its tier, and finally its issue number. On 2026-09-30 the issue measured it over 140
`agent-ready` candidates: one blocking edge across 891 open issues, a spec or epic link on
8 candidates, and the same tier on all 140. So 132 of 140 were ordered by issue number alone,
which is oldest first, the order #2196 was built to replace.

The ranker did nothing wrong. It ranked correctly on input that does not exist. The defect is
that **nobody can tell**. The drain prints `dispatch order ranked by value (#2196)` whether the
order came from real signal or fell all the way through to the issue number.

This spec does three things:

1. **Report the signal, every run (FR-1 to FR-6).** The ranker counts how many candidates each
   term actually separated, and the drain's log line says it. This is the core of the spec and
   needs no decision beyond D1's warning threshold.
2. **Give the spec/epic term more to work with (FR-7 to FR-9, conditional on D3).** The issue
   names the 132 issues with no spec and no `epic:` label as the larger gap.
3. **Backfill existing blocking edges (FR-10 to FR-12, conditional on D2).** Recording new
   edges going forward is already specified by SPEC-232 (record a blocker when found), which
   puts backfill out of its own scope. This spec decides whether the old backlog gets one.

## Root cause (mechanism + missing gate)

- **Mechanism (data).** No step in triage, dispatch or the chief-of-staff path writes a blocking
  relation (SPEC-232's root cause), and no step writes an `epic:` label or a title-head
  `SPEC-NNN` for an issue that serves one. `explicitLinks` (`scripts/lib/issue-rank.ts:341`)
  reads only those two forms, by design: it errs toward missing a link rather than inventing
  one (`scripts/lib/issue-rank.ts:330-339`).
- **Missing gate (observability).** The ranker computes edge counts but prints them only under
  `--explain` (`scripts/rank-issues.ts:370-381`). The drain calls it without `--explain`
  (`scripts/drain-inbox.sh:1818`), so on success the only line in the drain log is the
  unconditional `dispatch order ranked by value` (`scripts/drain-inbox.sh:1832`). Nothing
  compares how much of the order each term decided, so "ranked by value" and "sorted by number"
  produce the same log.
- **A stale premise in the code.** The ranker's header says 12% of open issues declare a
  blocking relation (`scripts/lib/issue-rank.ts:22`). SPEC-134 (specify just in time) cites the
  same figure. SPEC-232 records 4 body declarations across 879 open issues at build time, and
  #2212 measured 1 edge with both ends open across 891. *I believe* the 12% counts a looser
  phrase match than `parseDeclaredBlockers` accepts. I have not checked this. Either way, the
  comment reads as the ranker's working signal, and that signal is about 1%. FR-6 corrects it.

## One-sentence scope

Make the issue ranker report, on every successful run and in the drain log, how many
candidates each ranking term actually separated. Then, as D2 and D3 decide, add a source of
spec/epic links and a backfill of blocking edges. The ranking order, its stdout contract and
its fallback behaviour stay as they are.

## Contract (pure core)

The coverage figures are computed in the pure core (`scripts/lib/issue-rank.ts`, no fs, network
or clock), so they are unit-testable without a fetch. Proposed shape. Plan may rename it but
must keep every field:

```ts
/** How much of a ranked order each term actually decided. Computed from rankIssues' output. */
export interface SignalCoverage {
  /** Candidates ranked (equals the input set size). */
  candidates: number;
  /** Candidates with unblocks > 0. */
  withUnblocks: number;
  /** Candidates with specRank !== null (an explicit SPEC or epic link in the structural order). */
  withSpecLink: number;
  /** Candidates whose tier came from an exact source (ctx.tiers), not the ready-class label. */
  withExactTier: number;
  /**
   * Candidates whose position is decided by issue number alone: they share their
   * (unblocks, specRank, tierKey) tuple with at least one other candidate.
   */
  byNumberAlone: number;
  /** Blocking edges among open issues, by source (already computed by blockingGraph). */
  edges: { total: number; fromBody: number; fromNative: number };
}

export function signalCoverage(ranked: readonly RankedIssue[], graph: BlockingGraph): SignalCoverage;
```

## Requirements

### Report the signal (unconditional)

- **FR-1 Coverage is computed.** `signalCoverage` returns the fields above for any ranked list,
  including an empty one (all zeros) and a list of one (`byNumberAlone` = 0).
- **FR-2 Every successful run reports it on stderr.** On every exit-0 run, with or without
  `--explain`, `rank-issues.ts` writes exactly one line beginning `rank-issues: SIGNAL:` to
  stderr. The line carries every field of `SignalCoverage`, and `byNumberAlone` also appears as
  a percentage of `candidates`. Example (wording settled at Plan, field set fixed here):
  `rank-issues: SIGNAL: ranked 140; unblocks>0: 0; spec/epic link: 8; exact tier: 0; ordered by issue number alone: 132 (94%); edges: 1 (1 body, 0 native)`.
  The line is not written when the run fails, because a failed run reports its error instead.
- **FR-3 stdout is untouched.** Without `--explain`, stdout stays exactly the reordered input
  set, one number per line. The drain's set-equality check (`scripts/drain-inbox.sh:1827`) and
  SPEC-142's callers depend on that.
- **FR-4 Low signal is marked as a warning.** When the coverage crosses the threshold D1
  chooses, the line begins `rank-issues: WARNING: low signal:` instead of `rank-issues:
  SIGNAL:`, with the same fields. Low signal never changes the exit code and never changes the
  order. The ranking is not a gate (`scripts/drain-inbox.sh:1801`), and a number-ordered
  queue is still complete. The defect being fixed is the silence, not the order.
- **FR-5 The drain log states the source of the order.** The drain's success line no longer
  claims `ranked by value` unconditionally. It carries the ranker's `byNumberAlone` count and
  share, or else the SIGNAL line sits next to it in the log with nothing between them and the
  success line drops the words "by value". Plan picks the mechanism: parse stderr, add a
  dedicated output, or reword. Whichever it picks, a reader of the drain log alone can tell an
  order decided by real signal from one decided by issue number.
- **FR-6 `--explain` and the header agree with measurement.** `--explain` prints the same
  coverage figures as FR-2, so the table and the stderr line can never disagree. The header
  comment's "12% declare a blocking relation" (`scripts/lib/issue-rank.ts:22`) is re-measured
  with the parser's own grammar and restated with its date and method, or removed. The same
  change re-checks SPEC-134's rejection rationale, which cites that figure
  (`specs/minspec/SPEC-134-specify-just-in-time/requirements.md`, alternatives section). If the
  figure is wrong, the change files a note against SPEC-134 rather than editing an approvable
  this spec does not own.

### Spec/epic link coverage (only if D3 is (a) or (b))

- **FR-7 A link source exists.** D3's chosen step writes an `epic:<id>` label (or a title-head
  `SPEC-NNN`) on issues that serve one. It uses only the forms `explicitLinks` already reads, so
  the ranker needs no parser change.
- **FR-8 Links are attributed and reversible.** Every label the mechanism writes goes through
  the bot identity (`scripts/lib/gh-bot.sh`), and the triage verdict or a comment records why.
  Removing the label removes the link.
- **FR-9 Nothing false is promoted silently.** A link the mechanism is unsure of is not written.
  The spec term promotes a linked issue over every unlinked one, so a false link costs more than
  a missing one (`scripts/lib/issue-rank.ts:336-338`).

### Blocking-edge backfill (only if D2 is (b) or (c))

- **FR-10 Proposals, never writes.** A dev-time script lists candidate edges among open issues.
  For each one it gives both numbers and the exact evidence line from the body. It writes
  nothing to GitHub.
- **FR-11 Confirmed edges go through SPEC-232's helper.** An edge enters the graph only through
  the record helper SPEC-232 specifies (FR-1 there), so there is one write path and one
  attribution. SPEC-232 must be built first. If it is not, this group waits.
- **FR-12 Citations are not candidates on their own.** A bare `#N` mention is not proposed. Only
  phrasing a reader would take as an ordering claim is proposed ("after #N", "needs #N first",
  "blocks #N", "prerequisite for #N"). The ranker's header records that 75% of issues cite
  another issue, so citation-derived proposals would bury the real ones
  (`scripts/lib/issue-rank.ts:22-26`).

## Acceptance criteria

- **AC-1** Given candidates that all have `unblocks` 0, no spec link and the same label tier,
  `signalCoverage` reports `withUnblocks` 0, `withSpecLink` 0, and `byNumberAlone` equal to
  `candidates`.
- **AC-2** Given 3 candidates where one unblocks another and two serve different specs,
  `byNumberAlone` is 0.
- **AC-3** A non-`--explain` run with fake IO writes the same stdout bytes as before this change
  for the same input, and writes exactly one stderr line beginning `rank-issues: SIGNAL:` or
  `rank-issues: WARNING: low signal:`.
- **AC-4** A run whose fetch fails exits non-zero, writes nothing to stdout and writes no
  SIGNAL line.
- **AC-5** A drain cycle run against a stub ranker that reports 100% by number alone writes a
  log in which the success line does not claim the order is by value without qualification. A
  test greps the log for the count.
- **AC-6** The `--explain` coverage figures and the stderr line come from one `signalCoverage`
  call. A test changes one input and sees both outputs change together.
- **AC-7** A mutation that makes `signalCoverage` always return `byNumberAlone: 0` fails at
  least one test. The coverage line must not pass vacuously.
- **AC-8 (D2 b/c only)** The proposal script on a fixture body containing "see #12" proposes
  nothing, and on "needs #12 first" proposes 12 as a blocker and quotes that line.
- **AC-9 (D3 a/b only)** An issue labelled by the mechanism ranks in the spec/epic group under
  `--explain` with no change to `explicitLinks`.

## Invariants this must not break

- **Offline core (constitution 1).** Coverage is computed from data the ranker already fetched.
  It adds no network call. The pure core stays free of fs, network and clock.
- **No silent gate (constitution 2).** The ranker keeps failing loudly with nothing on stdout.
  The drain keeps its loud numeric fallback on non-zero exit or set mismatch
  (`scripts/drain-inbox.sh:1823-1829`). The new line is never written with a swallowed error.
- **Blast radius (constitution 3).** All of this is dev-time tooling in this repo. Nothing ships
  in the extension. Labels and edges are written only on the repo the drain targets.
- **The #2196 order is unchanged.** It stays lexicographic, set-preserving and status-blind,
  with terms in the founder-approved order, unless D4 decides otherwise with founder sign-off.
- **Explicit-only links and edges.** Inference never feeds the ranker directly. Anything
  inferred passes a confirmation step before it becomes a label or an edge.
- **Bot attribution.** Every GitHub write goes through `scripts/lib/gh-bot.sh`.

## Decisions needed (Clarify)

**D1 - When does the coverage line become a WARNING?**
- (a) **When more than half of the candidates are ordered by issue number alone, or no
  candidate has `unblocks` > 0 (rec).** Both are facts the line already carries. With the
  2026-09-30 corpus this warns, which is correct. Cost: under today's data it warns on every
  cycle until D2 or D3 adds signal, and a warning that never clears gets ignored, so it is only
  worth having if D2 or D3 lands soon after.
- (b) Never warn. Always print the neutral SIGNAL line. Cost: the reader has to do the
  arithmetic, and the "ranked by value" impression is weakened but not removed.
- (c) A configurable threshold (env var). Cost: one more dial with no measured basis for any
  value.

**D2 - Backfill blocking edges for the existing open backlog?**
- (a) **No backfill. Record edges forward only, through SPEC-232, and watch FR-2's
  `withUnblocks` count (rec).** Cost: the existing ~890 open issues stay edge-less, so term 1
  stays inert for the old backlog until those issues close or someone records an edge while
  working them.
- (b) A proposal script (FR-10 to FR-12) whose output the founder confirms. Cost: founder time
  on a list that could run to hundreds of rows. That contradicts tenet 1 (make the founder's
  job smaller), and he does not triage issues.
- (c) The same proposal script, confirmed by an agent session that must quote the evidence
  line. Cost: the edges become model-judged, which is the authoritative-looking wrong graph the
  ranker's header warns about. A false edge promotes an issue above everything without one.

**D3 - Where do spec/epic links for the ~132 unlinked issues come from?**
- (a) **Triage proposes an `epic:` label as part of its existing verdict on new or re-triaged
  issues, written only when it names a single epic (rec).** There are ten epics, so the
  choice is coarse and one wrong label costs a limited jump. Cost: the label is model-judged,
  and the existing open backlog gets links only as issues are re-triaged.
- (b) As (a), plus a one-time sweep over the open backlog. Cost: about 130 model calls (the
  share of the weekly budget is not measured here; measure at Plan before running), and every
  label in the sweep is model-judged at once.
- (c) No link source. Accept number order for unlinked issues and rely on SPEC-142's value
  label for the ones that matter. Cost: oldest-first stays the effective order for most of the
  queue.

**D4 - Keep `unblocks` as the first term?**
- (a) **Keep the #2196 order (rec).** It is founder-approved, and an empty first term costs
  nothing: it falls through. Once FR-2 is built, its counts are the evidence for revisiting
  the order. Cost: if the first term stays empty, the order rests on term 2 in practice
  while the code and docs still describe term 1 as primary.
- (b) Move the spec/epic term first. Cost: it reverses a founder-approved order without
  measured evidence that the result is better, and it needs his sign-off.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Fall back to numeric order and exit non-zero when signal is low.** Rejected. The order would
  be the same, the drain would print a misleading "ranker FAILED", and a real ranker fault would
  look the same as a data gap.
- **Infer edges from citations inside the ranker.** Rejected for the reason in the ranker's own
  header (`scripts/lib/issue-rank.ts:22-26`): a citation is not an edge.
- **Write the coverage to stdout in place of, or alongside, the number list.** Rejected. It
  breaks the one-number-per-line contract the drain's set check relies on (FR-3).
- **Fold this into SPEC-232 (record blocking relations).** Rejected. SPEC-232 owns the write
  path for new edges and puts backfill and ranker changes out of its scope. This spec owns the
  read-side report and the backfill decision, and its FR-11 reuses SPEC-232's helper rather
  than adding a second write path.
- **Fold this into SPEC-142 (dispatch value signal).** Rejected. SPEC-142 adds a new ranking
  term. This spec measures the existing terms and adds none.

## Out of scope

- The drain's queue-read and dispatch cap (`MINSPEC_DRAIN_QUEUE_LIMIT`, #2197).
- Reading the exact tier from the triage verdict (SPEC-245, #2198). FR-2's `withExactTier`
  only reports it.
- A value label as a new ranking term (SPEC-142, #420).
- The missing `@aiclarity/shared` workspace symlink that stopped the ranker in one checkout.
  The issue says it was filed separately, and its number is not known here.

## Follow-ups (tracked)

None beyond the sibling specs and issues named above. Each D-option that adds work is already
specified in this spec's own FR groups.
