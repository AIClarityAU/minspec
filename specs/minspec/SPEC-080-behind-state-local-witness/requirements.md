---
id: SPEC-080
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (the silent-gate incident family); this spec is the one FR (#1705's own item 4) that shipped fixes so far have not closed
aspects: [ci, gates, silent-gate, second-witness, merge-state, pr-drain, pr-shepherd, offline, determinism]
relates_to: [DR-066, SPEC-044]
# scripts/remediate-pr.sh and scripts/lib/shepherd-pr.sh are already SPEC-044's owned
# surface (implements: in specs/minspec/SPEC-044-coordinated-self-completing-sessions/
# requirements.md:12). This spec modifies both but does not take primary ownership,
# so it declares affects:, not implements:, per the SPEC-038/SPEC-079 convention.
affects: [scripts/remediate-pr.sh, scripts/lib/shepherd-pr.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: A local, non-lazy witness for "is this PR behind main" — closing #1705's item 4

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes the still-open remainder of
**[#1705](https://github.com/AIClarityAU/minspec/issues/1705)** — "an UNRESOLVED merge
state is classified `skip-clean` — the whole PR queue wedges BEHIND under a strict
ruleset (invariant 2)." Governed by
**[DR-066](../../../docs/decisions/DR-066.md)** (constitution invariant 2, "no silent
gate," clause 3: *"no required check hinges on a single producer that one
permission/config gap can disable — provide an independent second witness"*).

## One-Sentence Scope

Give `classify_pr`'s BEHIND determination a second, **locally computable** witness — a
`git merge-base`/ancestry check against `origin/main` that cannot itself return
`UNKNOWN` — so the PR drain's rebase decision no longer rests solely on GitHub's
lazily-computed `mergeStateStatus` field, without touching the three items #1705 already
shipped a fix for.

## Context — what #1705 already closed, verified against this repo's current `HEAD`

The issue's "Fix" section listed four items. Per Evidence Discipline (this repo's
CLAUDE.md), each is checked against the actual code and commit history, not inferred
from the issue being filed:

1. **"Poll until resolved."** ✅ **Shipped.** `scripts/remediate-pr.sh:444-476` re-reads
   `mergeable`/`mergeStateStatus` once, after a bounded sleep
   (`MINSPEC_REMEDIATE_UNKNOWN_RETRY_SLEEP`), before classifying — landed in
   `fix(#1705): an unresolved merge state is not a clean PR` (`f2c9f88c`) and hardened
   against an unvalidated retry-knob in `fix(#1705): bound the merge-state re-read loop
   against a knob bash cannot read` (`50bf3f2e`).
2. **"Add an explicit `UNKNOWN` arm to `classify_pr`."** ✅ **Shipped, then hardened
   twice more.** `scripts/remediate-pr.sh:153-155` gives `UNKNOWN` its own non-terminal
   `retry-unknown` token, ranked before the `BEHIND` arm (`:143-155` — read in full for
   this spec). `skip-clean` is reached only from the **closed allow-list**
   `CLEAN|BLOCKED|UNSTABLE|HAS_HOOKS|DRAFT` (`:169-173`); anything else returns
   `skip-unhandled-state` (`:178`). This item shipped in the same two commits as (1) and
   was independently re-broken and re-fixed twice more after this issue was filed —
   `fix(#1803): stop asserting health on an UNKNOWN or unrecognised merge state (#1813)`
   (`9bec668d`, `45b69000`) gave `shepherd_decide` (`scripts/lib/shepherd-pr.sh`) matching
   arms so the vocabulary widening didn't strand the other consumer, and
   `fix(#1813): stop capturing BLOCKED/UNSTABLE as an "unhandled" merge state`
   (`8635237f`) corrected an over-reach in the allow-list that had briefly stopped the
   creator-shepherd polling its own healthy, still-`BLOCKED` PR.
3. **"T3 regression test against the pure `--classify` seam."** ✅ **Shipped and
   extended.** `packages/minspec/tests/remediate-pr-classify.test.ts:97-98` pins the
   filed repro verbatim: `classify('agent/issue-1511', 'MERGEABLE', 'UNKNOWN', '', 'no',
   'no')` must not return `skip-clean` (it returns `retry-unknown`, asserted at
   `:101-102`). `packages/minspec/tests/shepherd-decide.test.ts` carries the sibling
   coverage for `shepherd_decide`'s two new tokens.
4. **"Consider a second witness for BEHIND-ness that does not depend on the lazy
   field."** ❌ **Not shipped.** Grepped `scripts/remediate-pr.sh`,
   `scripts/lib/shepherd-pr.sh`, and `scripts/drain-inbox.sh` for `merge-base`,
   `rev-list`, or any local ancestry check gating the `BEHIND` classification — none
   exists. The only local `merge-base` use in the pipeline
   (`scripts/drain-inbox.sh:525`) is unrelated: it fast-forwards a *dormant developer
   checkout* to `origin/main`, not a PR-branch classification. `classify_pr`'s BEHIND
   arm (`scripts/remediate-pr.sh:167-168`) still reads the single `merge_state`
   parameter sourced from one `gh pr view` field. This spec is scoped to this one
   remaining item.

**This is not a re-diagnosis of a live incident.** Items 1-3 closed the specific
failure the issue reproduced (an unresolved `UNKNOWN` masquerading as `skip-clean`); the
2026-08-28 log line the issue quotes predates all four fix commits above and is not
current evidence of a live defect. Item 4 is a **hardening** the issue itself only asked
the fix to *"consider"** — DR-066 clause 3's general principle (no required check
hinges on a single disableable producer) applied specifically to the one classification
arm (`BEHIND`) that still has exactly one producer today.

### Why clause 3 still applies even though clauses 1-2 are closed

`retry-unknown`/`skip-unhandled-state` correctly stop an *unresolved* witness from
asserting health. They do **not** help when GitHub's field resolves to `BEHIND`
**incorrectly**, or stays `MERGEABLE`/`BEHIND` for days because nothing ever prompts a
fresh computation (the original incident's queue-wide symptom — 7 of 7 PRs stuck — was
plausibly this shape too, not only the `UNKNOWN` shape, per the issue's own evidence:
`#1701` returned `UNKNOWN` five times in a row, meaning GitHub's background job had
not even *started* resolving it across multiple polls). `git merge-base --is-ancestor
<branch> origin/main` is a **local, synchronous, non-lazy** computation: it either
proves the branch is a strict ancestor of `origin/main` (behind) or it doesn't, on the
spot, with no server-side background job and no `UNKNOWN` state to fall into. That is a
qualitatively different kind of witness from a second `gh pr view` poll — DR-066 clause 3
asks for a producer that a *different* failure mode (not just "hasn't computed yet") can't
also take down.

### A pre-existing best-effort fetch this spec's new witness must not inherit

`scripts/remediate-pr.sh:652`: `git fetch origin main -q 2>/dev/null || true` — a
swallowed-error fetch, on the pipeline's happy path today (it runs only after an action
is already chosen, immediately before building the remediation worktree, so a silently
failed fetch there just risks a stale `origin/main` for an agent that will re-fetch
inside its own worktree anyway). If this spec's new local witness reuses that pattern
for the fetch it depends on, the witness becomes exactly the single-disableable-producer
shape DR-066 clause 3 forbids — a failed, swallowed fetch would silently leave the
witness computing ancestry against a stale `origin/main`, indistinguishable from a
fresh one. **FR-3**/**INV-2** below require the new witness's own fetch to fail visibly,
not silently degrade to stale data. (This existing line is flagged, not fixed here — it
sits on the already-shipped items' code path, out of this spec's scope; a human may
choose to fold a one-line fix into this spec's implementation as a drive-by, but it is
not a Functional Requirement of this spec.)

## Functional Requirements

- **FR-1 — A local ancestry witness for BEHIND-ness.** Add a pure(-ish — it shells to
  `git`, but takes no PR number or gh state) helper, callable independently of
  `classify_pr`, that answers: given a branch ref and `origin/main` (or the ruleset's
  actual base, if not always `main` — see DQ-3), is the branch a strict ancestor of the
  base (behind), the same commit (current), or neither (ahead/diverged/needs a fetch)?
  Implemented via `git merge-base --is-ancestor <branch> origin/<base>` plus an
  equality check, after an explicit, non-swallowed `git fetch origin <base>`.

- **FR-2 — The new witness corroborates; it does not silently replace GitHub's field.**
  `classify_pr`'s existing vocabulary and priority order (conflicts before checks before
  review before BEHIND before clean) stay intact for every case the two witnesses agree
  on. This spec does not ask classify_pr to stop reading `mergeStateStatus` — DQ-1 below
  is exactly the question of what to do on disagreement, and every option on the table
  keeps `mergeStateStatus` as at least one of the two inputs.

- **FR-3 — The witness's own fetch fails visibly (DR-066 clause 1).** The `git fetch`
  FR-1's witness depends on must propagate its exit status to the caller rather than
  being swallowed (`|| true`); a failed fetch must be distinguishable, in the classifier
  output and the drain's log, from "fetch succeeded, branch is not behind." A witness
  that silently degrades to stale data on its own fetch failure is not an independent
  witness — it is the same failure mode with an extra step.

- **FR-4 — Disagreement between the two witnesses is logged, never silently resolved in
  the direction that looks clean.** Whatever DQ-1 resolves to, if GitHub's field and the
  local ancestry check disagree about whether the branch is behind, that disagreement
  itself must be visible in the drain's log output — not merged into a single boolean
  with no trace of which producer said what.

- **FR-5 — Both consumers of the vocabulary stay in parity.** `classify_pr`
  (`scripts/remediate-pr.sh`) and `shepherd_decide` (`scripts/lib/shepherd-pr.sh`) are
  two independent consumers of the same classification vocabulary (already true today,
  per `shepherd-pr.sh`'s own header comment: *"this file never re-implements
  classify_pr"*). #1803/#1813/#1729 each had to be fixed twice — once per consumer —
  because a vocabulary change landed in one without the other. Any new token or changed
  BEHIND-arm behavior this spec introduces MUST ship with matching coverage in both
  `remediate-pr-classify.test.ts` and `shepherd-decide.test.ts` in the same change, not
  as a follow-up.

- **FR-6 — Regression test at the pure seam.** A new test (or an extension of
  `remediate-pr-classify.test.ts`) exercises the new local-witness helper and the
  updated `classify_pr` call path against fixtures for: branch strictly behind (local
  witness agrees with GitHub `BEHIND`), branch strictly behind while GitHub still reads
  `UNKNOWN`/`CLEAN` (the disagreement case #1705's original incident plausibly was), and
  branch not behind while GitHub reads `BEHIND` (stale-field case). None of the three
  may resolve to a bare `skip-clean` with no record of the local check having run.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, DR-066).** The new witness must
  itself satisfy all three DR-066 clauses: no best-effort load-bearing write/read
  (FR-3), absence/failure fails closed and visibly (FR-3/FR-4), and it exists
  specifically to give the BEHIND determination a second producer (clause 3, this
  spec's whole point) — it must not become a *third* single point of failure sitting
  silently alongside the first.
- **INV-2 — `--classify` stays a pure, network-free seam.** `remediate-pr.sh --classify`
  (the testable seam documented at the top of the file) takes its inputs as arguments
  and makes no `gh`/`git` calls itself. If FR-1's local witness needs a fresh fetch, that
  fetch happens at the **call site** (same pattern as the existing `MERGE_STATE`
  re-poll, `scripts/remediate-pr.sh:450-476`), and the witness's boolean result is
  passed into `classify_pr` as a new argument — never a hidden git shell-out inside the
  pure function itself. This preserves the file's own documented contract and the
  existing unit-test suite's ability to exercise `classify_pr` with zero `gh`/`git`
  availability.
- **INV-3 — No regression on items 1-3.** Every existing assertion in
  `remediate-pr-classify.test.ts` and `shepherd-decide.test.ts` for `CLEAN`, `BLOCKED`,
  `UNSTABLE`, `HAS_HOOKS`, `DRAFT`, `UNKNOWN` (→ `retry-unknown`), and any
  never-before-seen value (→ `skip-unhandled-state`) continues to pass unmodified in
  intent — this spec adds a new input dimension (the local witness) to the BEHIND arm
  specifically, not a rewrite of the already-hardened fallthrough logic.
- **INV-4 — Blast radius (constitution invariant 3, DR-074).** `remediate-pr.sh` /
  `shepherd-pr.sh` are dev-time pipeline scripts for this monorepo, per the originating
  issue's own "Blast radius" section — nothing here reaches an adopting repo's
  `.minspec/`-gated surface, so invariant 3 is not engaged (restated, not re-litigated,
  from the issue).

## Acceptance Criteria

- [ ] **Local witness exists and is independently callable.** A helper computes
      ancestor/behind/current/error for a branch against a base ref via `git
      merge-base`, with no dependency on `gh pr view` or `mergeStateStatus`. (FR-1)
- [ ] **`--classify`'s pure contract is unchanged.** The seam still takes only
      arguments — no new `gh`/`git` call added inside `classify_pr` itself; the new
      boolean/enum is threaded in as an additional parameter, mirroring how
      `live_nonself_claim` was added as an optional 7th argument. (INV-2)
- [ ] **Fetch failure is visible, not swallowed.** A fixture where the witness's `git
      fetch` fails produces a distinct, logged outcome — never silently treated as
      "not behind." (FR-3, INV-1)
- [ ] **Disagreement is logged.** A fixture where GitHub's field and the local witness
      disagree produces a log line naming both values, regardless of which one the
      classification ultimately follows. (FR-4)
- [ ] **Both consumers ship together.** The same PR that changes `classify_pr`'s BEHIND
      handling also updates `shepherd_decide` if the vocabulary changes, with tests in
      both `remediate-pr-classify.test.ts` and `shepherd-decide.test.ts`. (FR-5)
- [ ] **Three-fixture regression suite passes.** Behind+agree, behind+GitHub-disagrees,
      not-behind+GitHub-says-BEHIND all produce a result that is not a bare, unlogged
      `skip-clean`. (FR-6)
- [ ] **Existing suite is green, unmodified in intent.** `remediate-pr-classify.test.ts`
      and `shepherd-decide.test.ts`'s pre-existing cases for CLEAN/BLOCKED/UNSTABLE/
      HAS_HOOKS/DRAFT/UNKNOWN/never-seen values still pass. (INV-3)

## Decisions needed (Clarify)

- **DQ-1 — On disagreement, which witness wins?** Three shapes are possible once both
  witnesses exist:
  - **(A) Local witness is authoritative for "behind."** If `git merge-base
    --is-ancestor` proves the branch strictly behind `origin/main`, classify as BEHIND
    (→ `rebase-only`) regardless of what GitHub's field says — including overriding a
    GitHub `CLEAN`/`UNKNOWN` read. *Cost:* a local witness computed at classify-time can
    itself be a half-second stale relative to a push that just landed on `origin/main`
    between the fetch and the classification; false-positive BEHIND triggers one extra,
    harmless mechanical merge rather than a stuck queue.
  - **(B) GitHub's field is authoritative; local witness is corroboration/logging only.**
    Classification behavior is unchanged from today; the local witness only feeds FR-4's
    disagreement log, which a human (or a future spec) reads to decide whether to act.
    *Cost:* does not, by itself, unstick a queue where GitHub's field is wrong or stuck —
    it only makes the staleness *visible* sooner than a human noticing PRs aging.
  - **(C) Local witness only breaks a tie when GitHub's field is `UNKNOWN` or
    `skip-unhandled-state`** (i.e., it becomes a positive resolution path for the cases
    items 2/3 already made safe-but-inert), leaving a GitHub-reported `BEHIND`/`CLEAN`
    untouched. *Cost:* narrower — does not address the "GitHub says CLEAN/BEHIND but is
    wrong or stale for days" shape, only the "GitHub can't tell us yet" shape, which
    items 2/3 already prevent from asserting false health (they just leave it retrying
    rather than resolving it).
  - *Recommendation:* **(C)**, with (A) as the natural follow-on if (C) proves
    insufficient in practice. (C) gives `retry-unknown`/`skip-unhandled-state` — states
    that today just mean "try again next sweep" — an immediate, deterministic resolution
    path instead of waiting on GitHub's background job or another sweep cycle, without
    ever contradicting a GitHub value that DID resolve. (A) is the stronger fix for the
    original queue-wedge symptom but means the pipeline sometimes acts opposite to what
    the PR's own GitHub UI displays, which is a bigger trust/predictability cost to take
    on without first seeing whether (C) alone is enough.

- **DQ-2 — Where does the fetch for the local witness happen, and how often?** The
  existing `MERGE_STATE` re-poll only fires when GitHub already returned `UNKNOWN`
  (conditional, once). The local witness could be computed (a) only when
  `mergeStateStatus` is `UNKNOWN`/unrecognised (cheapest, matches DQ-1 Option C), (b)
  every sweep for every automation-branch PR (most coverage, adds a `git fetch` + local
  clone/worktree cost per PR per sweep), or (c) only for PRs that have already been
  `skip-clean`/`retry-unknown` for more than N sweeps (amortizes cost, adds a
  sweep-count threshold to track). *Recommendation:* **(a)**, matching DQ-1's
  recommended scope — the sweep already has a conditional branch for `UNKNOWN`
  (`scripts/remediate-pr.sh:450`); this only widens what happens inside it. *Cost:*
  narrower coverage than (b)/(c) — a GitHub field that reads `BEHIND` (not `UNKNOWN`)
  incorrectly, i.e. the "stuck for days" shape rather than the "hasn't resolved yet"
  shape, is not covered by (a) alone; if the human wants that shape covered too, DQ-1
  Option A plus DQ-2 Option (b) is the combination that does it, at the added per-sweep
  fetch cost.

- **DQ-3 — Is the base always `main`?** Today's ruleset/config assumes `origin/main`
  throughout the pipeline (`scripts/remediate-pr.sh:652`, `scripts/drain-inbox.sh`'s
  `origin/HEAD` resolution at `:507-508`). This spec's FR-1 should reuse whichever base
  the existing pipeline already resolves rather than hard-coding `main` a second time.
  *Recommendation:* thread the already-resolved base through (`drain-inbox.sh` already
  computes it via `symbolic-ref --short refs/remotes/origin/HEAD`), not re-derive it;
  *cost:* none identified — this is a reuse-not-reinvent question, not a genuine
  trade-off, included here so Plan does not silently hard-code `main` a second time in
  the codebase.

## Out of Scope

- **Re-litigating or re-touching items 1-3.** Verified shipped and hardened (Context);
  this spec's tests must not regress them (INV-3), but no FR here modifies that logic.
- **The pre-existing swallowed `git fetch … || true` at `scripts/remediate-pr.sh:652`.**
  Flagged in Context as a pattern the new witness must not copy; fixing that specific
  line is not a Functional Requirement of this spec (a human may choose to fold it in
  as a drive-by at Plan/Implement, but it is not required for this spec's acceptance).
- **Changing which mergeStateStatus values are treated as transient
  (`BLOCKED`/`UNSTABLE`/`HAS_HOOKS`/`DRAFT`).** `fix(#1813)` already tuned this
  allow-list after an over-reach; this spec does not reopen that classification.
- **A new required CI check or ruleset change.** This spec's witness lives inside the
  drain/shepherd's own classification logic, not GitHub's ruleset configuration.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Treating #1705 as fully closed and declining to spec anything.** Rejected on
  evidence: the issue's own "Fix" section names four items, and a full-repo grep for
  `merge-base`/`rev-list`-based BEHIND detection in the pipeline scripts returns
  nothing — item 4 is genuinely unbuilt, not merely undocumented.
- **Re-diagnosing the 2026-08-28 incident as still live.** Rejected — the log line the
  issue quotes predates the two `#1705` fix commits (`f2c9f88c`, `50bf3f2e`, both dated
  2026-08-30) by two days; treating it as current evidence would be exactly the
  "plausible-inference ≠ observation" mistake this repo's Evidence Discipline rule
  warns against.
- **Making the local witness authoritative outright (DQ-1 Option A) as the only
  option presented.** Rejected as a *default* — it is a real, viable option and is
  named, but overriding a GitHub-reported value the UI also displays is a bigger
  behavioral/trust change than the narrower Option C, which this spec recommends
  starting with; a human may still choose A at Clarify.

## Traceability

- **Issue:** [#1705](https://github.com/AIClarityAU/minspec/issues/1705) — "an
  UNRESOLVED merge state is classified `skip-clean`" — items 1-3 shipped in `f2c9f88c`,
  `50bf3f2e`; item 4 (second witness for BEHIND-ness) is this spec's entire scope.
- **Follow-on hardening, same file, already merged:** `fix(#1803)`/`fix(#1813)`
  (`9bec668d`, `45b69000`, `8635237f`) and `fix(#1729)` (`686f063c`) — closed related
  but distinct gaps in the same classification vocabulary; cited in Context as evidence
  the two-consumer parity risk (FR-5) is not hypothetical.
- **The invariant this spec exists to satisfy:**
  [DR-066](../../../docs/decisions/DR-066.md) (constitution invariant 2) clause 3 —
  independent second witness for a single-producer signal.
- **Owning spec for the files this spec modifies:**
  [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  (`implements:` `scripts/remediate-pr.sh`) — this spec declares `affects:`, not
  `implements:`, per SPEC-038's ownership convention.
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) (constitution
  invariant 3) — not engaged; restated from the issue's own "Blast radius" section.
- **DR for this spec:** none. The design choice at DQ-1/DQ-2 is a bash-script behavior
  change fully reversible within a day (swap which witness is authoritative, or the
  sweep condition, is a small diff with no external contract or migration) — it does
  not meet the DR-359 ADR filter this project applies to `docs/decisions/`. Recorded
  explicitly here, mirroring SPEC-079 DQ-2's convention, rather than leaving the
  absence implicit.
