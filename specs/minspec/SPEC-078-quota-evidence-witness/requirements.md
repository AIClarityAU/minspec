---
id: SPEC-078
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (the silent-gate incident family); SPEC-054/SPEC-071 use it for the same gate-signal integrity class
aspects: [ci, ai-review, quota, evidence, silent-gate, retry]
relates_to: [DR-063, DR-079, SPEC-054, SPEC-071, SPEC-074, "#1630", "#1086", "#1204"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance, FRONTMATTER_GUIDANCE in slash-commands.ts). Approval advances
# `plan` to `in-progress`, the state `validateOwnership` fires on, and canonical.ts strips only
# `status`/`phases` from the hash, so declaring after approval would stale the sign-off.
# NEW, not yet created: the pinning-test file FR-8 requires. FR-8 is unconditional, so this
# holds under every DQ answer. Same shape as SPEC-074, whose single-classifier test AC-8 cites.
implements: [packages/minspec/tests/quota-evidence-witness.test.ts]
# Modified, not owned (one owner per file); all three exist on main. review-branch.sh (FR-1..3)
# and ai-review-retry.yml (FR-6) are in no spec's `implements:`; ai-review.yml (FR-4) is
# SPEC-031's. DQ-3 Option B would add scripts/review-decide.sh (also SPEC-031's) here; the
# recommended Option A does not. ci-review-templates.ts is left out, as SPEC-065/069/070 leave
# it: it embeds generated copies of these files (scripts/gen-ci-templates.mjs), never hand-edited.
affects: [scripts/review-branch.sh, .github/workflows/ai-review.yml, .github/workflows/ai-review-retry.yml]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — `ai-review-retry` must see the quota evidence the reviewer actually observed (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **#2178** — *"ai-review-retry declines to retry a quota-blocked PR whose run
log contains the quota diagnostic."* It does not dispute **#1630** (the no-evidence guard:
an unevidenced block may be a genuine crash, so do not loop it). The guard is right; the
evidence marker it is fed is wrong.

**Id note.** `SPEC-075` (#1698 validator corpora), `SPEC-076` (#1816 human-decision
witness) and `SPEC-077` (#1922 idle-session wakes) are claimed on other branches in this
checkout's remote refs, so this is `SPEC-078`. Those refs may be stale; if the id collides
at review time, renumber.

## One-Sentence Scope

Make the `evidence: captured | NONE` marker that `ai-review-retry.yml` trusts reflect the
quota diagnostic `scripts/review-branch.sh` actually observed on every voter that blocked,
by construction rather than by three separately maintained code paths agreeing by luck, and
make a decline visible on the PR itself.

## Context — how the marker is produced and consumed (read from code, not inferred)

The issue's own root-cause paragraph was explicitly unverified ("I did not read the retry's
extraction code"). Reading it resolves that guess: the retry does **not** read a check-run
field or an artifact. It reads a **PR comment**:

- **Consumer.** `.github/workflows/ai-review-retry.yml:89-90` takes the *last*
  `evidence: (NONE|captured)` match across the PR's comments; `NONE` → decline, apply
  `needs-human-review`, print the two log lines #2178 quotes (`:91-106`). A missing marker
  retries (fail-safe for pre-#1635 comments, `:85-88`).
- **Comment builder.** `.github/workflows/ai-review.yml:682` extracts the
  `REVIEW_UNAVAILABLE_BEGIN…END` block from `$REVIEWER_OUT` only and posts it in a
  `<details>` section; that block contains the `evidence:` line.
- **Producer.** `scripts/review-branch.sh` `emit_unavailable()` (`:304-332`) writes
  `evidence: captured` iff a local `grep -iE 'limit|quota|reset|try again|429|overload'`
  (`:306`) finds a line in the text it was handed, else `evidence: NONE`.

The job-log line `subscription quota hit — failing over to PAYG API` that #2178 counted four
times is printed by `review-branch.sh` itself to stderr (`:391`). It goes to the job log
only. It is never part of the text `emit_unavailable` examines, so it cannot, today, turn
the marker to `captured`. That is the literal answer to "the evidence exists; the retry
cannot see it."

Three mechanisms, each sufficient on its own, can make the marker say `NONE` while the
script has already decided on observed evidence that the failure is quota:

### Finding C — the PAYG failover overwrites the evidence it was triggered by (most likely cause of #2172)

- `quota_failure()` (`:359-365`) classifies the **subscription** attempt's streams as quota.
- With `AI_REVIEW_FAILOVER=payg` and a key present (`:390`), `run_reviewer payg` (`:392`)
  runs a second attempt. `run_reviewer` **reassigns** the globals `AGENT_OUT` and
  `AGENT_ERR` (`:233`, `:250`).
- When PAYG also yields no verdict, `emit_unavailable "$(quota_detail)"` (`:400`) is
  handed `quota_detail()` (`:369`), which reads those globals — i.e. the **PAYG attempt's**
  streams. The subscription streams that proved quota are gone.
- The PAYG attempt's failure text is never classified. If it was empty, or carried a
  phrase outside the local grep (e.g. `Credit balance is too low`, the PAYG failure already
  recorded in this file's own comment at `:239-246`), the marker reads
  `evidence: NONE (reason is inferred, not observed)` — which is false: the reason *was*
  observed, on the attempt before.
- #2178's log shows exactly this path on all four voters: `subscription quota hit — failing
  over to PAYG API`, then `PAYG failover also produced no verdict`, then `UNAVAILABLE`.
  *Inferred, not observed:* this spec did not read #2172's posted comment or run logs (no
  network on this dispatch), so which PAYG text was present is unknown. The path match is
  exact; the stream contents are not verified.

A secondary consequence: the marker also says `reason: quota` for the combined outcome even
though the second failure (PAYG) was never shown to be quota. A PAYG misconfiguration
(bad key, no credit) is not transient and will not heal on the hourly retry. See DQ-3.

### Finding A — two different "is this quota" predicates in the same script

- `quota_failure()` uses the shared, unit-tested classifier `isQuotaExhaustion` /
  `isQuotaExhaustionStrict` (`.github/scripts/ai-review-guard.js:240-274`) to decide the
  failure is quota.
- `emit_unavailable()` decides `captured` vs `NONE` with its own local grep (`:306`). That
  list omits phrasings the shared classifier accepts: `too many requests`,
  `insufficient credit`, `session limit`, and so on. A failure that the shared classifier
  calls quota but that contains none of the six local substrings enters `emit_unavailable`
  and still prints `NONE`.
- Nothing pins the two together. `.github/scripts/ai-review-guard.test.js` tests the
  classifier; `packages/minspec/tests/review-branch-verdict-beats-quota.test.ts` tests
  routing; no test asserts that classifier-positive text yields `evidence: captured`.

### Finding B — the posted marker describes the `reviewer` voter only

- `ai-review.yml` runs up to four voters (`reviewer`, `security`, `architect`, `skeptic`;
  `$REVIEWER_OUT` / `$SECURITY_OUT` / `$ARCHITECT_OUT` / `$SKEPTIC_OUT`, `:511-537`) and sets
  `FINAL=ai-review:blocked` when any required voter blocks (`:608`).
- The comment builder reads `$REVIEWER_OUT` alone (`:682`; the reset-time parse at
  `:669` likewise). When a non-`reviewer` voter is the one that blocked with evidence and
  `reviewer` passed, the posted comment carries no `evidence:` line from the blocking voter.
  Today that happens to fail *safe* (no marker → retry), but it also loses the reset time
  (#1204) and the human-readable diagnostic. #1086 already records a mixed-verdict panel
  in this repo, so this is a live shape, not a hypothetical.
- Not the cause of #2172: there all four voters blocked, including `reviewer`.

## Functional Requirements

- **FR-1 (evidence is the classifying attempt's evidence).** The text `emit_unavailable`
  judges MUST include the streams of the attempt that `quota_failure()` classified as quota.
  A later attempt (the PAYG failover) MUST NOT replace them. The PAYG attempt's streams may
  be added, labelled as such, but never substituted. *(Closes Finding C.)*

- **FR-2 (one predicate).** Whether the marker says `captured` MUST be decided by the same
  shared classifier that decided the failure is quota (`isQuotaExhaustion` for stderr,
  `isQuotaExhaustionStrict` for decoded stdout, matching `quota_failure()`'s per-stream
  rule), or by a rule that provably cannot contradict it. The local grep at `:306` may still
  choose *which lines to show a human*, but it MUST NOT decide `captured` vs `NONE`.
  *(Closes Finding A.)*

- **FR-3 (the script's own observation counts).** When `review-branch.sh` reaches
  `emit_unavailable` through `quota_failure()` returning true, the marker MUST NOT claim
  `NONE (reason is inferred, not observed)`: by construction the classifier observed quota
  text. `NONE` remains correct only for a path that reaches the unavailable marker without
  a classifier match. On today's code `emit_unavailable` has exactly one caller
  (`review-branch.sh:400`), reached only when `quota_failure()` is true, and a failure with
  both streams empty never gets there (the classifier returns false on empty text, so it
  takes the fail-closed crash branch at `:404-409`). So after FR-1–FR-3, `review-branch.sh`
  would never emit `NONE`, and the retry's `NONE` guard becomes defence in depth for older
  comments and future callers. Plan phase MUST re-check this caller list and keep the `NONE`
  arm (it is what a future caller that has no classifier match must emit).

- **FR-4 (panel-wide marker).** When `FINAL=ai-review:blocked`, the posted comment MUST
  carry the unavailable block (including `evidence:` and any reset time) from **every**
  voter that emitted one, not `$REVIEWER_OUT` alone. The retry's aggregation rule across
  voters is DQ-2.

- **FR-5 (retry mechanism unchanged unless Clarify says otherwise).** The retry keeps
  reading a PR-comment marker (`ai-review-retry.yml:89-90`). FR-1–FR-4 fix what feeds it.
  Reading the job log instead is the issue's other proposed direction; it is rejected as
  the default because job logs expire and are a second fetch per PR per tick, while the
  comment is durable and already read. DQ-4 records it.

- **FR-6 (visible decline).** When the retry declines, the PR itself MUST carry a
  human-readable reason — which voter(s), that no quota diagnostic was captured, that the
  block is treated as a possible crash, and what a human does next (re-run, or inspect the
  run). The `needs-human-review` label alone does not say why. A line in the retry job's
  `$GITHUB_STEP_SUMMARY` is required in addition. Cadence is DQ-1.

- **FR-7 (the #1630 guard is preserved, not widened).** A block where no voter's
  classifying attempt carried any classifier-positive text MUST still produce `NONE`,
  still decline, still apply `needs-human-review`. This spec corrects false `NONE`s; it
  does not make a genuine crash retry-able.

- **FR-8 (pinning tests).** Each finding gets a test that is red on today's code and green
  after the fix, and that fails again if either end of the producer/consumer contract
  moves (the issue's proposed fix 2).

## Acceptance Criteria

- **AC-1 (Finding C, the reported case).** Fixture: subscription attempt's stderr contains
  `Claude AI usage limit reached`; `AI_REVIEW_FAILOVER=payg`, key set; PAYG attempt exits
  non-zero with empty stdout and stderr `Credit balance is too low`. Expected: marker
  `evidence: captured`, detail includes the subscription limit line. Today: `evidence: NONE`
  (red).
- **AC-2 (Finding C, PAYG empty).** Same, with PAYG writing nothing on either stream.
  Expected `captured`. Today `NONE`.
- **AC-3 (Finding A).** Fixture, no failover: stderr contains only `Too Many Requests` (or
  only `insufficient credit`). The shared classifier accepts it; the local grep does not.
  Expected `captured`. Today `NONE`.
- **AC-4 (Finding B).** Workflow-level fixture: `reviewer` passes; `security` emits an
  unavailable block with `evidence: captured` and a reset time. Expected: the posted comment
  contains that voter's `evidence: captured` and its `<!-- ai-review-reset: … -->` marker.
- **AC-5 (retry positive).** Given a comment carrying the corrected `captured` marker, the
  retry's decision step takes the retry branch, not the "Not retrying" branch.
- **AC-6 (retry negative, #1630).** A fixture with no classifier-positive text on either
  stream of any voter's classifying attempt, reaching the unavailable path by whatever route
  FR-3's enumeration leaves, still yields `NONE`, declines, applies `needs-human-review`.
  If FR-3's enumeration finds no such route remains, this AC is instead: a genuine non-quota
  crash still reaches the fail-closed branch (`:404-409`) and never the unavailable marker.
- **AC-7 (visible decline).** After a decline, the PR carries a comment (or the DQ-1
  equivalent) stating the reason in words, and the retry run's step summary names the PR.
  Asserted on the emitted comment body / summary text, not on log lines.
- **AC-8 (no predicate drift).** A test fails if the `captured`/`NONE` decision stops
  going through the shared classifier module — the same shape SPEC-074 uses for its
  single-classifier guarantee.

## Invariants

- **INV-1 (constitution 2, no silent gate).** A declined retry is visible on the PR, never
  only in a workflow log. The `ready-to-merge` gate reads `blocked` as not-passed, so an
  unexplained, never-retried block is a silently wedged required check.
- **INV-2 (#1630 preserved).** An unevidenced block still declines and summons a human.
- **INV-3 (single source of truth).** One classifier decides both "is this quota" and "was
  quota evidence captured". No second keyword list may decide either.
- **INV-4 (fail direction).** A marker the retry cannot parse, or a missing marker, still
  means *retry* (`ai-review-retry.yml:85-88`). No change here may make silence mean "give up".
- **INV-5 (constitution 3, blast radius).** `ai-review-retry.yml` is scaffolded into
  adopter repos (its own comment, `:94-102`). Any new label, comment, or summary line must be
  created on demand inside the repo the workflow runs in, exactly as `needs-human-review` is
  today, and must touch nothing outside it.
- **INV-6 (constitution 1, offline).** No new network call is introduced in MinSpec's
  extension; all changes are in CI scripts that already call the git host.

## Decisions needed (Clarify)

### DQ-1 — Decline notice: once per block, or every hourly tick?

- **Option A — once, on transition (rec).** Post the explanatory comment only when the PR
  does not already carry `needs-human-review` (or an idempotency marker such as
  `<!-- ai-review-retry-declined: <run-id> -->` keyed on the blocked run). *Cost:* if a
  human removes the label without acting, no reminder fires; the `ai-review:blocked` label
  still shows.
- **Option B — every tick.** Maximally visible. *Cost:* an hourly comment for days on one
  PR trains readers to ignore the bot, which defeats FR-6.

### DQ-2 — Retry decision when voters disagree on evidence

With FR-4, one comment can carry several `evidence:` lines. Today the retry takes the
*last* match.

- **Option A — retry iff every blocked voter is `captured` (rec).** Conservative: a single
  voter that crashed silently still summons a human, which is what #1630 protects. *Cost:*
  one silent voter holds up a PR whose other three voters plainly hit quota; a human
  re-runs it.
- **Option B — retry iff any blocked voter is `captured`.** Recovers more quota outages
  automatically. *Cost:* a genuine crash on one voter rides the retry loop as long as
  another voter keeps hitting quota — the exact hiding #1630 exists to prevent.
- **Option C — emit one aggregated marker line** computed by the workflow under rule A or
  B, and keep the retry's "last match" extraction unchanged. Orthogonal to A/B; *(rec)*
  as the mechanism, since it keeps the retry's parsing untouched. *Cost:* the aggregation
  rule lives in `ai-review.yml`, one more place to keep aligned with the retry.

### DQ-3 — What the marker says when subscription hit quota and PAYG failed for a non-quota reason

- **Option A — `reason: quota`, `evidence: captured`, PAYG failure shown in detail (rec).**
  The subscription window will reset; the retry is useful. *Cost:* a broken PAYG setup
  (bad key, no credit) keeps failing silently on every retry until someone reads the
  detail.
- **Option B — distinct reason, e.g. `reason: quota+failover-failed`,** so the retry can
  still retry but the decline/notice text (FR-6) also flags the failover as broken.
  *Cost:* a new marker value that `review-decide.sh`, the comment builder, and the retry
  must all learn; larger change.
- Recorded rejected option: treat the PAYG failure as a crash (`changes`). It blames the
  dev's code for an infrastructure outage, which DR-063's `blocked`/`changes` split exists
  to prevent.

### DQ-4 — Should the retry also read the blocked run's log as a second witness?

- **Option A — no; fix the producer (rec).** Comment is durable, already fetched, and
  FR-1–FR-3 make it correct. *Cost:* if the producer regresses again, only FR-8's tests
  catch it; there is no independent runtime witness.
- **Option B — yes, as a fallback when the marker says `NONE`.** An independent second
  witness, in the spirit of constitution invariant 2's "no single producer". *Cost:* one
  extra log download per declined PR per tick; logs expire (retention), so the fallback
  silently stops working on old blocks; grep-over-log re-creates a second predicate that
  can drift (INV-3).

## Why no new DR

The DR-359 filter asks whether the choice costs more than a day to undo. Every change here
is a revertable diff to two CI scripts and one workflow, reusing the existing classifier and
the existing comment marker. DR-063 (`blocked` vs `changes`) and DR-079 (verdict out of
band) are the governing precedents and are applied, not changed. `docs/decisions/INDEX.md`
has no entry for evidence-marker construction. If Clarify picks DQ-3 Option B (a new marker
value that three consumers must learn), revisit this.

## Out of scope

- Changing the retry's cadence, per-tick cap (`head -25`), or reset-time handling (#1204)
  beyond carrying the reset marker for non-`reviewer` voters (FR-4).
- Changing `isQuotaExhaustion` / `isQuotaExhaustionStrict` themselves.
- Re-running or unblocking #2172 / #2120 — operational, not part of this spec.

## Test plan (for the Plan phase to place)

1. AC-1/AC-2/AC-3: `review-branch.sh` fixtures with a stubbed `claude` that writes set text
   to each stream per attempt; the existing harness in
   `packages/minspec/tests/review-branch-verdict-beats-quota.test.ts` already stubs the CLI.
2. AC-4: workflow-step fixture for the comment builder with four vote outputs.
3. AC-5/AC-6/AC-7: retry-step fixture with a stubbed `gh` returning set comment bodies.
4. AC-8: single-classifier assertion, SPEC-074's shape.
Every test is run red against the pre-fix code before the fix lands.

New test file (owned by this spec, declared under `implements:`):
`packages/minspec/tests/quota-evidence-witness.test.ts`.
