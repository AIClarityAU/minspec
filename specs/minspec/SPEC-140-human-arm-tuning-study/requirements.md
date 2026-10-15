---
id: SPEC-140
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the signpost is only never-wrong if the human review it assumes is real; this measures whether shorter review leaks errors
aspects: [trust, measurement, telemetry, just-enough-human, review, pre-registration, tier-0, opt-in]
depends_on: [SPEC-017, DR-042, DR-029]  # SPEC-017 supplies M1 (rework, built) and M3 (engaged time, NOT built); DR-042 point 5 decided the study is two-armed; DR-029 section 6 is the LLM arm this pairs with
relates_to: [SPEC-013, SPEC-038, SPEC-018, DR-003, DR-004, DR-012, DR-034, DR-043, "#301", "#127", "#128", "#300"]
# Ownership declared in Specify, before approval mints a hash (SPEC-051). Both files are
# NEW and are needed under every answer to the Clarify questions below: the study is a pure
# function over records the glue hands it, wherever the glue and the display end up living.
implements: [packages/shared/src/human-arm-study.ts, packages/shared/tests/human-arm-study.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-140: The human side of the "just enough human" tuning study - does shorter review, at a given tier, leak more errors?

**Triggered by:** [#301](https://github.com/AIClarityAU/minspec/issues/301) (parked from the
review-telemetry audit, DR-042 decision point 5).
**Rests on:** [DR-042](../../../docs/decisions/DR-042.md) (outcome metrics before engagement;
point 5 says the study must have two arms),
[DR-029](../../../docs/decisions/DR-029.md) section 6 (the anticipation-rate study, the LLM arm),
[SPEC-017](../SPEC-017-trust-dashboard/requirements.md) (M1 char-rework %, M3 engaged reading
time, FR-9 the proxy trap).
**No new DR.** DR-042 point 5 already made the decision that a human arm is required; this
spec designs it. Every choice below can be undone in under a day: the study only reads
records that other specs write, and it changes no stored format (the under-a-day ADR filter).

## In plain terms

MinSpec wants to ask the human to read less at each tier (T1 one-sentence spec up to T4
full ceremony). Before anyone shortens review, we need evidence that shorter review does
not let more mistakes through. Today we measure only the LLM half: did the self-audit
foresee the bug? This spec adds the human half. For each tier it pairs how deeply the spec
was reviewed with how much went wrong afterwards, using rules fixed in advance. It reports
only per-tier totals. It never judges one review, never names a reviewer, and never
changes a tier's ceremony by itself.

## One-Sentence Scope

Define a pre-registered, opt-in, offline, aggregate-only analysis that joins per-approval
review depth (SPEC-017 M3 engaged time, plus approve latency) to downstream error rate
(SPEC-017 M1 rework, plus escaped bugs attributed by RCDD fix commits) per tier, and
reports whether shortening review at that tier is supported by evidence.

## Context (measured 2026-10-15 on this branch's base)

- **M1 rework % is built.** `packages/minspec/src/lib/trust-metrics.ts` computes it over
  `reworkPct` from `@aiclarity/shared` (SPEC-017 frontmatter: M1, M2 and the chart host
  are built). The issue's blocker "SPEC-017 M1 must exist first" is already met.
- **M3 engaged time is NOT built.** `reviewStart` is reserved with no writer:
  `packages/minspec/src/lib/approval.ts:58` ("RESERVED for M3 … NOT populated"), `:69`, and
  `:603` (the write omits it). No engagement setting exists. **The real blocker is M3, not M1.**
- **The "foreseen y/n" RCDD tag is NOT collected.** The issue says it is "already collected
  per DR-029 §6". It is not. `git log --all -i --grep=foreseen` returns zero commits,
  `.githooks/commit-msg` has no foreseen, anticipation or appendix prompt, and no spec in
  `specs/` defines the tag (grep for `anticipat` and `foreseen`). DR-029 lists the study as
  "*Issue/SPEC to file*". What does exist is the root-cause line: 550 commits on this
  branch's history carry `Root cause:` (enforced by `.githooks/commit-msg`, DR-003).
- **Spec ownership of files exists.** Specs declare the files they own in `implements:`
  (SPEC-038, `status: done`). A fix commit's changed files can therefore be mapped to the
  spec that owns them without any new tagging.
- **The SPEC-013 deterministic floor is unbuilt.** SPEC-013 is `implementing` with
  `implements: none` and a reason stating its central mechanism (section registry, per-FR
  disposition, the core-end divider) has no implementation.
- **The approval ledger is committed and content-free.** Per-approvable sidecars sit under
  `.minspec/approvals/` (DR-034/SPEC-022), carrying `specHash`, `tier`, `approvedAt`,
  `approvedBy` and `baselineBlob` (`approval.ts:55-69`).

## Terms

- **Approval event** - one record in `.minspec/approvals/`: approvable path, `tier`,
  `approvedAt`, `specHash`, baseline. The unit of analysis.
- **Review depth** - how much engaged attention preceded the approval event (X axis).
- **Error rate** - what went wrong with the approved content afterwards (Y axis).
- **Window W** - how long after `approvedAt` downstream errors count towards that approval.
- **Shallow / deep half** - within one tier, the approval events below / at-or-above the
  median of review-depth density.
- **Tune-down support** - the study's only verdict, per tier: `supported`, `not supported`
  or `insufficient data`.

## Functional Requirements

### Variables - pre-registered, hash-locked

- **FR-1 (pre-registration lives in this spec, locked by its approval).** The study's
  variables, window, minimum sample, margin and decision rule MUST be read from the
  `## Pre-registration` section of this spec, not from code constants or settings. Approving
  this spec (DR-012) hash-locks them; editing them makes the approval stale. Every report
  MUST print the `specHash` of the pre-registration it ran against.
- **FR-2 (refuse to run on an unlocked pre-registration).** If this spec is not approved,
  or its approval is stale, the report MUST NOT produce a verdict. It MUST say visibly why:
  "pre-registration not locked: SPEC-140 is <status>". Silently falling back to defaults is
  forbidden (constitution invariant 2).
- **FR-3 (X axis - review-depth density).** For each approval event with M3 data, review
  depth MUST be computed as SPEC-017 FR-7a engaged milliseconds divided by thousands of
  approved-body characters (the M1 baseline length). Dividing by length stops long specs
  from looking deeply reviewed simply because they are long.
- **FR-4 (X axis - approve latency, secondary).** Approve latency MUST be recorded as a
  second, separately reported X variable, with the definition settled in Clarify (D2). It
  MUST NOT be combined with FR-3 into one score.
- **FR-5 (Y axis - rework).** Error rate Y1 MUST be SPEC-017 M1 rework % of the approval's
  baseline, measured at `approvedAt + W` (or at the next approval of the same approvable, if
  sooner). Taken from the existing M1 function. Not re-implemented.
- **FR-6 (Y axis - escaped bugs, attributed by file ownership).** Error rate Y2 MUST be the
  count of escaped bugs attributed to the approval within W, per thousand approved-body
  characters. An escaped bug is a commit on the default branch whose subject is `fix:` /
  `fix(scope):` / `fix!:` and whose body has a `Root cause:` line (the DR-003 hook's own
  grammar). It is attributed to every approvable whose `implements:` list (SPEC-038) contains
  a file the fix changed, and whose most recent approval before the fix falls inside W.
- **FR-7 (Y axis - foreseen and escaped, only when the tag exists).** When a fix commit
  carries the DR-029 foreseen tag (not collected today, see Context), Y3 MUST count
  escaped bugs that the appendix had foreseen. That is the most direct human-side signal:
  the warning was on the page and the review approved anyway. While no commit carries the
  tag, Y3 MUST be reported as "not collected", never as zero.
- **FR-8 (strata).** Every statistic MUST be computed separately per tier T1 to T4, read
  from the approval event's own `tier` field. Tiers are never pooled into one verdict.

### The decision rule

- **FR-9 (per-tier effect S_T).** For each tier T, S_T MUST be the shallow-half error rate
  minus the deep-half error rate, reported separately for Y1 and Y2, with a 95% interval
  from a bootstrap. The bootstrap uses a fixed seed taken from the pre-registration, so the
  same inputs always give the same numbers.
- **FR-10 (tune-down support).** Tier T is `supported` for tune-down only when, for both Y1
  and Y2: each half has at least N_min approval events, AND the upper end of S_T's interval
  is at or below the margin delta. If either half is under N_min, the verdict MUST be
  `insufficient data (shallow n=a, deep n=b, need N_min)`. Otherwise it is `not supported`.
  The verdict is non-inferiority: "shallow is not worse by more than delta". It is not
  "shallow is better".
- **FR-11 (the SPEC-013 floor precondition).** A `supported` verdict MUST carry the line
  "advisory only until the SPEC-013 deterministic floor is built" while SPEC-013's
  `implements:` is `none`. The issue's skim-safe precondition is stated in the report, not
  enforced by hiding the number.

### Honesty about what was and was not counted

- **FR-12 (every exclusion is counted, by reason).** The report MUST list how many approval
  events were left out and why: no M3 data (opt-in off), no baseline, legacy record,
  approvable owns no files (Y2 cannot attribute). It MUST also give the number of fix
  commits that matched no owning spec ("unattributed fixes: n"). No input is dropped
  silently (constitution invariant 2).
- **FR-13 (aggregate only - no per-approval or per-person output).** The study MUST emit only
  per-tier aggregates: counts, medians, S_T, intervals, verdict. It MUST NOT emit, store or
  display any per-approval depth or error value, any approvable's name next to a depth value,
  or `approvedBy`. The SPEC-017 FR-9 scatter is SPEC-017's surface; this study adds none.
- **FR-14 (no standalone engagement result).** No output of the study may be a function of
  review depth alone (MUST NOT). Every number that involves X is a difference in error rate between
  depth halves (SPEC-017 FR-9 proxy trap, DR-042 point 4).

### Consent, tier and scope

- **FR-15 (off by default, behind M3's own opt-in).** The study MUST run only when the
  SPEC-017 FR-8 engagement opt-in is on. It adds no capture of its own. With the opt-in off,
  the report says "human-arm study off: engagement capture is not enabled" and computes
  nothing.
- **FR-16 (offline, pure core).** The analysis MUST be a pure function in
  `packages/shared/src/human-arm-study.ts` (no `vscode`, no network, no clock, no filesystem).
  The caller passes it approval events, M1 values, M3 values, fix commits and the parsed
  pre-registration. Reading git and files is the caller's job, as in SPEC-017 FR-12.
- **FR-17 (never changes ceremony).** No code path may change any tier's ceremony (MUST NOT), section
  set, phase requirements or classifier output based on the study. A `supported` verdict is
  evidence for a human-written DR, nothing more.

## Pre-registration

*Locked by this spec's approval (FR-1). The values marked "proposed" are the Clarify
defaults (D3); the human confirms or changes them before approving.*

| Item | Value |
|---|---|
| Unit | approval event in `.minspec/approvals/` with tier T1-T4 |
| X1 primary | engaged ms per 1,000 approved-body chars (FR-3) |
| X2 secondary | approve latency, definition per D2 (FR-4) |
| Y1 | M1 rework % at `approvedAt + W` or next approval (FR-5) |
| Y2 | escaped `fix:` + `Root cause:` commits per 1,000 chars, attributed by `implements:` (FR-6) |
| Y3 | foreseen-and-escaped count, only once the tag exists (FR-7) |
| Split | median of X1 within tier, ties to the deep half |
| W | 90 days (proposed) |
| N_min | 20 approval events per half (proposed) |
| delta, Y1 | 5 percentage points of rework (proposed) |
| delta, Y2 | 0.5 escaped bugs per 1,000 chars (proposed) |
| Interval | 95%, percentile bootstrap, 10,000 resamples, seed 301 (proposed) |
| Hypothesis | for tier T, shallow review is no worse than deep review by more than delta on both Y1 and Y2 |
| Not tested | causation. This is observational. Depth is not randomised (see Risks R2) |

## Costly to Refactor

1. **The pre-registration values (W, N_min, delta, split).** They are cheap to change in
   code but expensive in credibility. Changing them after data has been seen turns a
   pre-registered study into a search for a good-looking result. FR-1 makes any change void
   the approval, so the change shows up. *Check: the values are settled in Clarify before
   approval, not after the first report.*
2. **Attribution by `implements:` (FR-6).** If attribution later moves to an explicit tag on
   fix commits, every historical Y2 number shifts. *Check: D4 settled before the first report.*

Nothing else is costly: no stored format is added and the study can be deleted without a
migration.

## Acceptance Criteria

- [ ] **AC-1 (FR-1, FR-2).** With SPEC-140 `specifying` or stale, the report prints
  "pre-registration not locked" and no verdict. Once approved, the report prints its `specHash`.
- [ ] **AC-2 (FR-3, FR-8).** A fixture with two T2 approvals of 2,000 and 8,000 chars, both
  read for 4 minutes, gives depth densities 120,000 and 30,000 ms per 1,000 chars.
- [ ] **AC-3 (FR-6).** A `fix:` commit with `Root cause:` that changes a file listed in
  SPEC-X `implements:`, 10 days after SPEC-X's approval, counts once towards SPEC-X's Y2. The
  same commit without `Root cause:` counts nowhere. A fix that changes only unowned files
  raises "unattributed fixes" by one.
- [ ] **AC-4 (FR-7).** With no tagged commits, Y3 reads "not collected", not 0.
- [ ] **AC-5 (FR-9, FR-10).** For a fixture of 19 shallow and 30 deep T3 events, T3 reads
  `insufficient data (shallow n=19, deep n=30, need 20)`. With 20/30 and a known effect, the
  interval and verdict match a hand-computed value, and two runs give identical output.
- [ ] **AC-6 (FR-11).** A `supported` verdict carries the SPEC-013 advisory line while
  SPEC-013 has `implements: none`.
- [ ] **AC-7 (FR-12).** Every excluded event and unattributed fix appears in the counts by
  reason. Inputs = included + excluded for every tier.
- [ ] **AC-8 (FR-13, FR-14).** A T0 test feeds records with distinct approvers and spec
  names and asserts that no output string or field contains an approver email, an
  approvable path, or a per-event depth value. A second T0 test asserts that every exported
  numeric field involving X is a difference of error rates.
- [ ] **AC-9 (FR-15).** With the SPEC-017 opt-in off, the report says the study is off and
  computes nothing.
- [ ] **AC-10 (FR-16).** `human-arm-study.ts` imports no `vscode`, `http`, `https`, `net`,
  `fs`, `child_process` or `fetch` (T0 import ban, as SPEC-017's).
- [ ] **AC-11 (FR-17).** A T0 test asserts that no module under `packages/minspec/src` that
  sets tier ceremony, section registry or classifier output imports `human-arm-study`.

## Out of Scope

- **Building M3.** Engaged-time capture, its opt-in and its storage are SPEC-017 FR-7 to FR-8.
  This spec waits for them.
- **Collecting the foreseen y/n tag.** That is the LLM arm (DR-029 section 6). FR-7 only
  reads it once it exists. Filing it is a follow-up (D5).
- **Pooling across users.** Contributing anonymous aggregates is #128 (Tier-1). Local only here.
- **Acting on the verdict.** Lowering a tier's ceremony needs its own DR (FR-17).
- **A per-review "was this read?" view.** Rejected by FR-13/FR-14 and SPEC-017's proxy trap.

## Invariants (must not break)

- **INV-1 Offline (constitution 1).** No network call. Inputs come from the local repo and
  local M3 records.
- **INV-2 No silent gate (constitution 2).** A missing input, unlocked pre-registration or
  small sample produces a visible message, never a quiet default or a missing row.
- **INV-3 Blast radius (constitution 3).** Runs only in a repo with `.minspec/` and with the
  SPEC-017 opt-in on. Writes nothing outside the report it displays.
- **INV-4 No standalone engagement verdict (DR-042 point 4, SPEC-017 FR-9).** FR-14, T0-tested.
- **INV-5 Aggregate and content-free (SPEC-017 FR-8).** FR-13, T0-tested. No spec text, no
  approver identity, no per-approval value leaves the pure function.
- **INV-6 Advisory only.** FR-17. The study never changes ceremony.

## Decisions needed (Clarify)

Each question names the recommended option **(rec)** and what that option costs.

- **D1 - Where the study's glue and report live.** The issue says telemetry belongs in
  Tier-1 agent-execute, "never core". SPEC-017 FR-8 already places opt-in, local,
  content-free engagement capture in core, and DR-004's Tier-0 rule bans network, not local
  analysis.
  - `a` **(rec)** Pure function in `packages/shared` (FR-16), glue and display in
    `packages/minspec` next to the SPEC-017 dashboard. Network-free, so DR-004 holds. *Cost:*
    core gains a study surface, and the issue's "never core" wording is overridden, which needs
    the founder's explicit agreement.
  - `b` Glue and display in agent-execute. *Cost:* the study cannot run without the Tier-1
    extension, though it needs no network, and it depends on SPEC-019's substrate, which is
    also unbuilt.
- **D2 - Approve latency definition (FR-4).**
  - `a` **(rec)** Time from the commit that last changed the approvable's body to
    `approvedAt`. Computed from git alone, so it exists even with the opt-in off. *Cost:* it
    measures queue delay as much as review. A spec waiting a week while the founder is away
    reads as "deeply reviewed".
  - `b` `approvedAt − reviewStart` wall clock. *Cost:* SPEC-017 R7 already calls this noise
    (a tab open at lunch), and it duplicates X1 badly.
  - `c` Drop X2 entirely. *Cost:* the issue asked for it, and the study loses its only
    X variable that works without opt-in.
- **D3 - Pre-registration numbers (W, N_min, delta, seed).** Proposed values are in the
  table. **(rec)** accept them as proposed. *Cost:* with one solo user, T4 approvals may
  never reach 20 per half, so T4 may stay `insufficient data` permanently. That is the honest
  answer, but it means the study may never license tuning T4 down. Lowering N_min reaches
  verdicts sooner at the price of intervals too wide to trust.
- **D4 - Bug attribution (FR-6).**
  - `a` **(rec)** By `implements:` file ownership (SPEC-038). Needs no new tagging and works
    on all 550 existing root-caused fixes. *Cost:* a fix in a file no spec owns is
    unattributed, and a fix in a file that two specs share counts towards both. FR-12 counts
    the first case, and the second inflates Y2 for shared files.
  - `b` An explicit `Spec: SPEC-NNN` line on fix commits, added to the RCDD hook. *Cost:*
    one more line to type per fix, a hook change (a machinery PR), and no history before it.
- **D5 - The foreseen tag (FR-7).** It does not exist, so DR-029's LLM arm is unbuilt too.
  **(rec)** File it as its own issue under DR-029 and keep Y3 dormant here. *Cost:* the
  most direct human signal (foreseen but escaped) stays unavailable until that issue lands.
  ➡️ Filing that issue is a human or follow-up dispatch step. This Specify-only run may not
  call `gh`.
- **D6 - Is SPEC-013 a hard blocker or an advisory line?** The issue lists it under "Blocked
  on".
  - `a` **(rec)** Advisory line on a `supported` verdict (FR-11). The study collects
    evidence now, and the slow, passive data accumulates while SPEC-013 is built. *Cost:* a
    `supported` T2 result could be read as licence to skim before any floor exists, which is
    the R4 risk in DR-029.
  - `b` Suppress any verdict until SPEC-013 ships. *Cost:* the result is hidden even though
    the data is fine, and the reader cannot see why.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Too few events.** Solo dogfood yields few approvals per tier, so most tiers stay `insufficient data` for months. | FR-10 says so plainly with the counts. It never rounds a small sample up to a verdict. |
| R2 | **Confounding.** Hard specs get deep review and also get more bugs, so deep review appears to "cause" errors. Shallow-is-fine would then be an artefact. | Stratify by tier (FR-8) and normalise by length (FR-3). The pre-registration states the study is observational and not causal. **This confound biases towards tune-down** (deep looks worse, so shallow looks fine), which is the main reason a `supported` verdict stays advisory (FR-11, FR-17) and needs a human-written DR. |
| R3 | **Co-authored specs.** A fast approval of a spec the human wrote is not a skim (SPEC-017 proxy trap). | Inherits SPEC-017's handling. Not separable without an authorship signal, so it is named as a limit, not hidden. |
| R4 | **Post-hoc tuning of the numbers.** | FR-1/FR-2: values live in a hash-locked section, and every report prints the hash it ran against. |
| R5 | **Proxy creep.** A later change adds a "shallowest reviews" list. | FR-13/FR-14 plus the T0 tests AC-8. |
| R6 | **Attribution noise** from shared files (D4 `a`). | Counted and named in the report. D4 `b` remains available if the noise proves large. |

## Test plan (for the Plan phase to place)

Pure-function fixture tests in `packages/shared/tests/human-arm-study.test.ts` cover
AC-2 to AC-8 and AC-10. The pre-registration lock (AC-1), the opt-in (AC-9) and the
ceremony-isolation import test (AC-11) are glue-level tests, placed by Plan once D1 settles
which package hosts the glue.

## Follow-ups (tracked)

- LLM-arm foreseen y/n tag (DR-029 section 6). **Not yet filed**, see D5. Must be filed
  before this spec is approved (DR-023 forward rule).
- M3 engaged-time capture: covered by SPEC-017 FR-7 to FR-8 (unbuilt). No new issue.
- Pooled cross-user aggregates: #128.
- Skim-claim activation: #127. It consumes the LLM arm, and once both arms clear it may also
  cite this study.
