---
id: SPEC-083
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — spend authorised by a misclassified transient is the same silent-gate/spend-control family as SPEC-078's evidence witness
aspects: [ci, ai-review, quota, payg, spend, silent-gate, retry, tier-0]
relates_to: [DR-063, DR-079, DR-084, SPEC-074, SPEC-078, "#1499"]
---

# MinSpec — PAYG failover must require genuine subscription exhaustion, not any retry-able signal (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes **#1499** — *"PAYG failover fires on any transient signal, not just genuine
subscription exhaustion — burns paid tokens on conditions that would clear by themselves."*

## One-Sentence Scope

Give the PAYG-failover decision in `scripts/review-branch.sh` and
`scripts/review-approvable.sh` a narrow, CLI-exhaustion-only predicate distinct from the
broad `isQuotaExhaustion`/`isQuotaExhaustionStrict` retry-vs-crash classifier those same
functions also feed, add a bounded same-token retry ahead of it, and record which signal
authorised every dollar spent — so a transient 429/overload never buys an opus PAYG run
that waiting a few seconds would have gotten for free.

## Context — confirmed from code, not inferred

The issue's central claim was read against the current tree and holds exactly as stated:

- **Both failover call sites gate on the same over-broad signal.** `review-branch.sh:386`
  (`if quota_failure; then … if [[ "${AI_REVIEW_FAILOVER:-wait}" == "payg" …`) and the
  structurally identical block in `review-approvable.sh:293-303` both authorise
  `run_reviewer payg` purely on `quota_failure()` returning true — the exact same boolean
  that governs whether the run is classified `blocked` (retry-able) instead of `changes`
  (a crash). There is no third, narrower state.
- **`quota_failure()`'s predicate is the wrong shape for a spend decision.**
  `quota_failure()` (`review-branch.sh:359-365`, mirrored in `review-approvable.sh:276-282`)
  calls `is_quota($AGENT_ERR)` (→ `isQuotaExhaustion`, loose) when stderr is non-empty, else
  `is_quota_strict(agent_stdout_text)` (→ `isQuotaExhaustionStrict`, tight-for-prose but
  still transient-inclusive). Both exported predicates
  (`.github/scripts/ai-review-guard.js:314-344`) match `overloaded`, `429`,
  `too many requests`, `rate.?limit(ed)?`, and `try again (later|in)` — conditions the
  functions' own docstrings describe as "an exhausted subscription quota / rate-limit /
  overload" as one bucket, correct for their original and only caller
  (`render_verdict`'s sibling decision of `blocked` vs `changes`). Nothing between that
  boolean and `run_reviewer payg` re-narrows it to "the subscription window is actually
  gone."
- **The cost multiplies structurally, not hypothetically.** `review-branch.sh` /
  `review-approvable.sh` are invoked once per role by `.github/workflows/ai-review.yml`
  (`reviewer`, `security`, `architect`, `skeptic`, all `--model opus`,
  `ai-review.yml:511-537`). A provider-wide overload blip is, by construction, likely to
  hit all four calls in the same run, so one misclassified transient can authorise up to
  four PAYG opus reviews of one diff — and the same failure repeats on every push while
  `AI_REVIEW_FAILOVER=payg` stays set.
- **The fallback this pre-empts already exists and already resolves genuine transients
  for free.** `ai-review-retry.yml` re-runs the review automatically once the window
  resets (SPEC-078's subject). For true exhaustion (hours until reset), paying is a
  reasonable trade against a stall. For a 30-second overload, paying buys nothing the
  retry workflow would not have delivered for free within the hour.
- **No attribution exists today.** Neither call site records which matched pattern, which
  stream, or which role triggered a PAYG run — only a free-text log line
  (`"review-branch.sh: subscription quota hit — failing over to PAYG API (role=$ROLE)"`,
  `:391`) that says WHETHER failover fired, never WHY. This is why the issue can only
  report a suspicion ("spend is running down faster than genuinely quota-blocked reviews
  account for") rather than a measurement — the same gap SPEC-078's Finding C independently
  documents for the evidence marker fed to the retry, one layer downstream of this one.
- **`AI_REVIEW_FAILOVER` is currently parked off.** `ai-review.yml:284` reads the repo
  variable; per the issue, it is set to `off-was-payg-disabled-2026-08-13` (previously
  `payg`), so failover is inert on this repo until this spec (or a narrower fix) lands.
  This spec's changes are inert-but-shippable under the current config and only take
  effect once a human re-enables the variable.
- **Two call sites, not one.** The issue's code excerpt names only `review-branch.sh`. Both
  scripts define their own copies of `quota_failure`, `is_quota`, `is_quota_strict`,
  `emit_unavailable`, and the PAYG-gating `if` — `review-branch.sh` reviews a PR branch
  diff, `review-approvable.sh` reviews a spec/DR/approvable document. A fix that touches
  only one leaves the other spending unattributed and unretried. FR-1/FR-2/FR-3 apply to
  both.
- **Adjacent, not the same bug.** `review-branch.sh:200-207`'s ambient-`ANTHROPIC_API_KEY`
  hazard (a key present in the environment wins over the subscription token even on the
  path that never calls `run_reviewer payg`) and scroogellm's `fix/payg-failover-wiring`
  (scroogellm#135) are the same *theme* — PAYG reached by a path nobody intended — but a
  different mechanism and a different repo. Out of scope here; noted so a reviewer does
  not conflate the two.

## Functional Requirements

- **FR-1 (a third, narrower predicate — exhaustion only).** Add a new exported predicate to
  `.github/scripts/ai-review-guard.js` — e.g. `isSubscriptionExhausted(text)` — that matches
  ONLY the CLI's own stated-exhaustion sentences: `usage limit reached`,
  `reached your (usage )?limit`, `weekly limit`, `session limit`, `5-?hour limit`, and a
  bare `resets? (at|in)` clause *only* when co-located with one of those limit phrases (a
  bare "resets at" with no limit phrase is ambiguous — see DQ-2). It MUST NOT match
  `overloaded`, `429`, `too many requests`, `rate.?limit(ed)?`, or `try again (later|in)` on
  their own — the issue's explicit exclusion list. `isQuotaExhaustion` and
  `isQuotaExhaustionStrict` are UNCHANGED (still the correct, broader predicate for
  `blocked` vs `changes`); this is a third function, not a narrowing of the existing two,
  so SPEC-078's retry-evidence contract is undisturbed.

- **FR-2 (failover gates on the narrow predicate, not the broad one).** In both
  `review-branch.sh` and `review-approvable.sh`, the `AI_REVIEW_FAILOVER == payg` branch
  MUST additionally require `isSubscriptionExhausted` on the same text `quota_failure()`
  already classified as quota (the stderr that was non-empty, or the decoded stdout when it
  was not — mirroring `quota_failure()`'s own stream selection so the two checks judge the
  SAME text). A `quota_failure()` true but `isSubscriptionExhausted` false MUST fall through
  to FR-3's retry, never straight to `run_reviewer payg`.

- **FR-3 (retry the subscription before reaching for the card).** When `quota_failure()` is
  true and `isSubscriptionExhausted` is false (a transient: overload/429/rate-limit/"try
  again"), retry the SAME subscription-token attempt with a bounded backoff before either
  falling to PAYG or emitting `REVIEW_UNAVAILABLE`. Attempt count, backoff schedule, and
  what counts as an "attempt" for this purpose are Clarify (DQ-1) — the requirement is that
  some bounded retry happens on-token first; an unbounded retry, or none at all, both fail
  this FR (unbounded risks the same multi-hour stall PAYG failover exists to avoid; none
  reproduces today's behaviour for the common case).

- **FR-4 (PAYG is reachable by TWO routes, both logged distinctly).** After FR-2/FR-3, a
  PAYG run is authorised either by (a) `isSubscriptionExhausted` true on the first
  classification, or (b) the FR-3 retry itself exhausting its budget while
  `quota_failure()` stays true. Both remain valid reasons to fail over (the issue does not
  ask to remove PAYG failover for a transient that *won't* clear in the retry budget — only
  to stop reaching for it on the FIRST signal). The two routes MUST be distinguishable in
  the FR-5 log line.

- **FR-5 (attributable spend — one machine-readable line per failover).** Every time either
  script actually invokes `run_reviewer payg`, it MUST emit one structured, greppable line
  (stderr, alongside the existing prose log) carrying at minimum: which predicate/route
  authorised it (FR-4's (a) or (b)), the matched pattern or a redacted excerpt, the role,
  and the PR number / approvable id + SHA already available in scope. Format (a `k=v`
  logfmt-style stderr line vs. a JSON object vs. a new sidecar log file) is Clarify (DQ-3).
  This is what turns "spend is running down faster than expected" from a suspicion into a
  measurement, per the issue's explicit ask.

- **FR-6 (single source of truth, no drift).** `review-branch.sh` and `review-approvable.sh`
  MUST call the SAME `isSubscriptionExhausted` export, the same way SPEC-074's AC-6 and
  SPEC-078's AC-8 already require for the existing classifiers. No second, hand-rolled
  exhaustion regex may exist in either script or diverge between them.

- **FR-7 (non-quota and genuine-crash paths unchanged).** Anything that is not
  `quota_failure()` true today still takes the existing fail-closed crash path
  (`ai-review:changes`), unchanged. This spec only narrows WHEN money may be spent inside
  the already-quota-classified branch; it does not touch the non-quota branch.

## Acceptance Criteria

- **AC-1 (the reported case — overload blip, PAYG withheld).** Fixture: subscription
  attempt's stderr is `Overloaded` (or contains `429` / `too many requests` /
  `rate limit exceeded` / `try again later`) with `AI_REVIEW_FAILOVER=payg` and a key
  present. Expected: `isSubscriptionExhausted` is false, FR-3's on-token retry fires
  (assert the retry attempt, not just the absence of PAYG), and `run_reviewer payg` is NOT
  called unless the retry budget is exhausted. Today: `run_reviewer payg` fires
  immediately (red).
- **AC-2 (genuine exhaustion, PAYG fires on the first signal).** Fixture: stderr is
  `Claude AI usage limit reached · resets 1pm (Australia/Sydney)`. Expected:
  `isSubscriptionExhausted` true, `run_reviewer payg` called without exhausting the FR-3
  retry budget, FR-5's line records route (a).
- **AC-3 (transient persists past the retry budget → PAYG via route (b)).** Fixture: every
  retry attempt's stderr is `Overloaded`. Expected: after the bounded retry budget, PAYG
  still fires (the issue does not ask to remove failover for a transient that never
  clears), and FR-5's line records route (b), distinguishably from AC-2.
- **AC-4 (transient clears inside the retry budget → no PAYG, no spend).** Fixture: first
  attempt `429`, retry attempt returns a schema-valid verdict. Expected: the verdict from
  the retry is used, `run_reviewer payg` never called, no FR-5 line emitted (nothing was
  spent).
- **AC-5 (both call sites, not one).** AC-1 and AC-2 are each run against BOTH
  `review-branch.sh` and `review-approvable.sh`'s equivalent harness fixtures; behaviour
  matches in both.
- **AC-6 (FR-6, no drift).** A test asserts both scripts resolve `isSubscriptionExhausted`
  to the same `require(...)` target, the same shape SPEC-074's AC-6 / SPEC-078's AC-8 use.
- **AC-7 (existing blocked/changes classification undisturbed).** `isQuotaExhaustion` /
  `isQuotaExhaustionStrict` fixtures already exercised by
  `packages/minspec/tests/review-branch-verdict-beats-quota.test.ts` and
  `.github/scripts/ai-review-guard.test.js` are unchanged and still pass — this spec adds a
  function, it does not edit the two it builds alongside.
- **AC-8 (T0 decision table — the issue's ask #4).** A table fixture covering at minimum: an
  overload blip, a bare 429, a genuine "usage limit reached", a genuine "session limit …
  resets …", and a hard crash with no recognizable text — each mapped to its expected path
  (`subscription-retry` / `payg` / `blocked` / `fail-closed`) — exists as an executable test,
  not prose, and is the thing both AC-1–AC-4 draw their fixtures from.

## Invariants

- **INV-1 (constitution #2, no silent gate).** A PAYG spend is never authorised without a
  visible, attributable reason (FR-5); a retry-able transient that clears on its own must
  never silently cost money. Conversely, genuine exhaustion must still fail over — this
  spec narrows WHEN PAYG fires, it does not add a new way for the gate to stall silently.
- **INV-2 (single source of truth, DR-063's own precedent repeated).** Exactly as DR-063
  split `blocked` from `changes` once, into a tested shared module rather than a local
  regex per caller, this spec's new predicate lives in `.github/scripts/ai-review-guard.js`
  and is exported once, consumed identically by both scripts (FR-6).
- **INV-3 (constitution #3, blast radius).** This changes CI review scripts and a shared
  Node module inside this repo's own dispatch/review pipeline. No network call, extension
  behaviour, or adopter-repo default changes; `AI_REVIEW_FAILOVER` stays opt-in per repo,
  currently parked off on this repo.
- **INV-4 (bounded retry, not unbounded).** FR-3's retry MUST have a fixed, finite budget
  (count and/or wall-clock cap) — an unbounded on-token retry loop would reproduce the
  multi-hour stall PAYG failover exists to shorten, defeating the feature for the case it
  legitimately serves (AC-3 depends on the budget being reachable within one CI job's
  timeout).

## Decisions needed (Clarify)

### DQ-1 — Retry budget: how many attempts, what backoff, counted against what clock?

The issue asks for "a bounded backoff retry on the same token for the transient class,
then `blocked` if it persists" but does not specify the numbers.

- **Option A — small fixed count with short exponential backoff (rec)**, e.g. 2–3 attempts,
  base delay ~5–15s, doubling, capped well inside the CI job's own timeout (`ai-review.yml`
  presumably has one; Plan phase must read it). *Cost:* a transient that takes longer than
  the capped window to clear still reaches PAYG (route (b)) or `blocked` — acceptable per
  the issue's own "then `blocked` if it persists," but the exact cutoff is a judgment call
  with no measured data behind it yet.
- **Option B — adaptive, informed by any reset/retry-after hint the CLI's text carries**
  (`parseResetInstant`/`try again in Ns` already parsed elsewhere, e.g.
  `ai-review-guard.js`'s reset-instant extraction). *Cost:* materially more design surface —
  reusing `parseResetInstant` for a SECONDS-scale wait rather than its current
  hours-scale reset-instant use, inside a synchronous bash retry loop rather than an
  across-workflow-run retry. Likely right long-term, but bigger than this spec's stated
  scope (ask #2 says "bounded backoff", not "parse the exact hint").

Recommendation: **Option A** for this spec; note Option B as a natural follow-up once FR-5's
logging gives real data on how often the transient class persists past a fixed budget.

### DQ-2 — Is a bare "resets at/in" (no limit phrase) exhaustion or transient?

`isQuotaExhaustion`/`isQuotaExhaustionStrict` count a bare `resets? (at|in)` as quota on
its own. The CLI uses reset-time phrasing for genuine subscription-limit messages
("`5-hour limit reached … resets 8:40am`"), but a rate-limit/overload response could
plausibly also carry a "resets" or "try again in" clause without ever saying "limit".

- **Option A — require co-location with a limit phrase (rec, as drafted in FR-1).** A bare
  "resets at 3pm" with no `limit`/`quota` word does NOT count as exhaustion; it retries on
  FR-3 like any other transient. *Cost:* if the CLI has an exhaustion phrasing that states
  only a reset time without ever using the word "limit" (unconfirmed — not observed in any
  fixture read for this spec), that case would be misrouted to the retry path rather than
  PAYG, delaying failover by one retry budget rather than skipping it — the safer
  direction to be wrong in, since it costs time, not money.
- **Option B — treat any `resets? (at|in)` as exhaustion, matching today's loose
  classifiers exactly.** *Cost:* this is close to reproducing the bug this spec exists to
  fix — `isQuotaExhaustion`'s docstring already treats `resets? (at|in)` as one of its
  broad-bucket phrases, grouped with `overloaded`/`429`, not as exhaustion-specific.

Recommendation: **Option A.** Named explicitly because FR-1's wording depends on it and a
human should confirm rather than have it default silently.

### DQ-3 — Attribution format for FR-5's log line

- **Option A — a single structured stderr line (`k=v` logfmt), alongside the existing
  prose (rec).** Matches this codebase's existing convention of prose-plus-diagnostics on
  stderr (e.g. `emit_unavailable`'s detail lines); cheap to grep/count across CI logs
  without a new artifact. *Cost:* CI job logs expire on GitHub's retention window, same
  limitation SPEC-078 DQ-4 already names for a different log — a retrospective count
  needs the logs pulled before they age out, or a second durable sink.
- **Option B — a durable sidecar file/PR comment**, so the count survives log expiry and
  can be queried without re-fetching job logs (the issue's own complaint — "this can only
  be reported as a suspicion" — is partly a durability problem, not only a
  what-gets-logged problem). *Cost:* a new artifact type, a decision about where it lives
  (issue comment? repo-local file, and if so is it committed — raising the same "who
  commits CI-generated state" question DR-066's family already covers elsewhere?), and who
  aggregates it into a count.

Recommendation: **Option A** for this spec's scope (attribution exists at all, where today
it does not); Option B is a natural DR-066-family follow-up once Option A shows real
volume, the same staging SPEC-078 used for its own evidence-durability question.

## Why no new DR

DR-359's filter asks whether the choice costs more than a day to undo. Every change here
is a revertible diff to two CI scripts and one shared, already-tested Node module: a new
exported predicate alongside two existing ones, a re-ordered conditional, a bounded retry
loop, and a new log line. DR-063 (the `blocked`/`changes` split, and the precedent that a
classification disagreement gets a new predicate in the shared module rather than a
caller-local patch) and DR-084 (the pipeline can jam on shared quota; paying is sometimes
the right trade) are the governing precedents and are applied here, not revised.
`docs/decisions/INDEX.md` has no existing entry for "when may PAYG failover spend money" as
a question distinct from "is this retry-able." If Clarify's DQ-3 later picks Option B (a
new durable, possibly committed artifact), that may cross DR-359's line and should be
revisited then.

## Out of scope

- The ambient-`ANTHROPIC_API_KEY`-wins-over-subscription hazard at `review-branch.sh:200-207`
  and scroogellm#135 (`fix/payg-failover-wiring`) — same theme, different mechanism,
  different repo for the latter.
- SPEC-078's evidence-marker-for-the-retry work (what `ai-review-retry.yml` reads from the
  PR comment) — downstream of this spec's decision, not redone here. FR-5's new log line is
  additive to, not a replacement for, SPEC-078's marker fix.
- Re-enabling `AI_REVIEW_FAILOVER=payg` on this repo — an operational decision for a human
  once this spec is built and approved, not part of this spec.

## Test plan (for the Plan phase to place)

1. AC-1–AC-4, AC-8: fixtures against a stubbed `claude` CLI per attempt, following the
   existing harness shape in
   `packages/minspec/tests/review-branch-verdict-beats-quota.test.ts`; extend or sibling
   that file for `review-approvable.test.ts`'s equivalent (AC-5).
2. AC-6: single-classifier assertion, the shape SPEC-074's AC-6 / SPEC-078's AC-8 already
   use.
3. AC-7: run the existing `ai-review-guard.test.js` / `review-branch-verdict-beats-quota.
   test.ts` suites unmodified and confirm they still pass after FR-1's addition.
4. New unit tests for `isSubscriptionExhausted` in `.github/scripts/ai-review-guard.test.js`,
   covering FR-1's explicit inclusion and exclusion lists directly (not only through the
   bash-level fixtures).

Every test is run red against the pre-fix code before the fix lands.
