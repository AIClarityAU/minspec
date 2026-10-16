---
id: SPEC-137
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — same epic as SPEC-069, whose gap this closes
aspects: [ai-review, approval, no-silent-gate, fail-visible, tier-0]
relates_to: [SPEC-069, SPEC-031, DR-081, DR-003, "#1029", "#1025", "#517", "#700"]
implements: []
affects: [scripts/review-branch.sh, scripts/approval-provenance.py]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A sidecar PR whose provenance facts could not be computed is "unverified", never "forged" (Requirements)

Issue: **[#1029](https://github.com/AIClarityAU/minspec/issues/1029)** — approval-sidecar-only PRs
get a false "stale or forged sign-off" block. No new DR: this applies the accepted
[DR-081](../../../docs/decisions/DR-081.md) direction and invariant 2 (no silent gate); nothing
here is hard to undo in a day.

## Why a new spec, and why so small (read this first)

I checked before writing. **Most of #1029 is already built or already specified**, so this spec
deliberately covers only the residue:

| #1029 asked for | State | Evidence |
|---|---|---|
| Deterministic pre-step: for each changed sidecar, recompute `specHash()` at PR head, report MATCH/STALE as a fact | **Built** (#1026, for #1025) | `scripts/approval-provenance.py` emits `VERDICT: MATCHES` / `MISMATCH`; `scripts/review-branch.sh` injects it as the trusted `<approval_provenance>` block (`review-branch.sh:118-137`) |
| Distinguish legitimate re-approval over an already-stale predecessor from a forged hash | **Built** | `approval-provenance.py` (the "ALREADY STALE at base" branch) |
| Stop LLM voters judging the shape at all | **Specified, not built** | SPEC-069 (status `planning`) FR-3 / AC "#1029 does not recur": exempt pure-sidecar PRs behind a deterministic `approval-integrity` check |
| Secondary: an un-computed case degrades to `info`, not `blocking` | **Neither** — this spec | see below |

SPEC-069 has a recorded approval, and editing it would stale that approval, so the gap is
specified here instead of by amending it.

## The residual gap (mechanism + missing gate)

`review-branch.sh` runs the provenance step as
`python3 approval-provenance.py … 2>/dev/null || true` (`review-branch.sh:126`, annotated
`swallow-ok`). If the script fails (missing `python3`, a git error, a malformed sidecar), the
captured text is empty, the `<approval_provenance>` block is **omitted entirely**, and the
reviewers are back to exactly the #1029 input: a sidecar in the diff, no way to see the spec edit
that moved the hash. Nothing tells them the witness was missing, and the reviewer prompt
(`review-branch.sh:160-175`) has no rule for "a sidecar changed but no provenance block was
supplied". So a witness error silently reverts to the false `blocking` finding. Two defects:
the **missing witness is invisible** (invariant 2), and the **prompt has no safe default** for it.

Also unreached by SPEC-069: a PR that changes a sidecar **plus** other files is not exempt
(SPEC-069 FR-2), so it still takes the panel and still depends on this block.

## One-Sentence Scope

When a PR changes an approval sidecar and the deterministic provenance witness cannot be
produced, the review says so explicitly and instructs reviewers to treat staleness/forgery as
unverified (`info`), never `blocking`.

## Functional Requirements

- **FR-1 — Witness failure is visible.** When the diff changes any `.minspec/approvals/**/*.json`
  and `approval-provenance.py` exits non-zero or prints nothing, `review-branch.sh` MUST inject an
  `<approval_provenance>` block stating `WITNESS UNAVAILABLE` with the reason (exit code / stderr
  first line), not omit the block. The failure is also written to the script's stderr so the
  workflow log shows it.
- **FR-2 — Prompt default for an un-computed case.** The reviewer prompt MUST state: a changed
  sidecar with no `VERDICT: MATCHES`/`MISMATCH` line is **unverified**; report a hash/`approvedAt`
  change with no spec edit in the diff as `info` ("could not verify — recompute the hash"), and
  MUST NOT mark it `blocking`, because the spec edit may have landed in an earlier PR.
- **FR-3 — A computed MISMATCH stays blocking.** FR-2 changes only the uncomputed case. A
  `VERDICT: MISMATCH` (and the forged-over-stale-predecessor branch) remains a real, blocking
  finding, with computed-vs-stored values shown, as today.
- **FR-4 — MATCH is not re-litigated.** With `VERDICT: MATCHES`, reviewers MUST NOT raise
  staleness or forgery. Provenance of the approver (`approvedBy` against a human identity) is a
  separate axis (#517) and is unchanged.
- **FR-5 — No change for non-sidecar PRs.** A diff touching no sidecar produces no block and no
  new prompt text beyond what exists today.
- **FR-6 — Fail visible, still not fatal to the review.** An unavailable witness MUST NOT abort the
  review (the panel still runs); it MUST NOT be swallowed silently. The existing `|| true` is
  replaced by an explicit exit-status branch with a reasoned annotation.

## Invariants (must not break)

1. **No silent gate (invariant 2).** A missing or errored witness is reported, never an empty
   string that looks like "nothing to say".
2. **Offline (invariant 1).** The witness uses local git and the in-repo hasher only; no network.
3. **Trusted channel integrity.** The block stays inside the defanged `<approval_provenance>`
   delimiters; diff-supplied text cannot forge it (`review-branch.sh:112-115`).
4. **Never downgrade a real finding.** A MISMATCH must not become `info` through FR-2.

## Acceptance Criteria

- [ ] Forced witness failure (stub `python3` to exit 1) on a sidecar-only diff: the prompt contains
      `WITNESS UNAVAILABLE` and the reason; stderr names the failure. (FR-1, FR-6)
- [ ] Same fixture: the prompt carries the FR-2 `info`-not-`blocking` instruction. (FR-2)
- [ ] A sidecar-only PR whose spec edit landed in an earlier commit, witness working: block says
      `MATCHES`; prompt carries no downgrade instruction needed. (FR-4; regression for #1029)
- [ ] Genuine stale sidecar, witness working: block says `MISMATCH`, unchanged text. (FR-3)
- [ ] Diff with no sidecar: prompt byte-identical to today's. (FR-5)
- [ ] The review still completes when the witness is unavailable. (FR-6)
- [ ] The behaviour is asserted on the assembled prompt, not on the absence of a string, with a
      control case proving the assertion can fail.

## Decisions needed (Clarify)

- **D-1 — Is this worth building before SPEC-069?** (a) **Build now (rec)** — small, closes a
  silent-gate path today; cost: some prompt text becomes dead weight once SPEC-069 exempts
  pure-sidecar PRs (it still serves mixed PRs). (b) **Defer to SPEC-069** — no duplicate work;
  cost: SPEC-069 is `planning` and the false-block path stays open until it ships.
- **D-2 — Severity of an unverified case.** (a) `info` (rec; matches #1029's own proposal) — cost:
  a real forgery is not blocked by the LLM panel when the witness is down (the human-approver
  gate in #517 still applies). (b) `needs-human` / non-pass without `blocking` — cost: a witness
  outage stalls every sidecar PR.
- **D-3 — Close #1029?** If D-1 is (b), #1029 stays open and tracks SPEC-069 FR-3; if (a), close on
  this spec's implementation.

## Follow-ups (tracked)

- [SPEC-069](../SPEC-069-approval-record-deterministic-witness/requirements.md) — the primary
  fix for pure-sidecar PRs (#1029 listed there as an acceptance criterion).
- [#517](https://github.com/AIClarityAU/minspec/issues/517) — approver provenance (the real forgery concern).
- Id check: SPEC-137 is max-on-disk plus one; open PRs are not visible from this checkout, so a
  collision is possible — re-check at approval.
