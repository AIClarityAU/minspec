---
id: SPEC-232
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is the ranker's input layer)
aspects: [issue-ranking, blocking-relations, gh-bot, no-silent-gate, blast-radius]
depends_on: []
relates_to: ["#2200", "#2196", "#2194", "#2184", "#54", "#55"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1 and D2.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-232: A blocking relation is recorded at the moment it is discovered, so the issue ranker's first term has data

> **This is a SPECIFICATION ONLY.** Written for issue #2200. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The issue ranker (#2196, `scripts/lib/issue-rank.ts`) ranks "unblocks the most" first. It can
only count edges someone wrote down. Measured at build time over 879 open issues: 4 body
declarations, 1 edge with both ends open (#55 waits on #54), 0 uses of GitHub's native
blocked-by relation. The two real blockers of 2026-09-28 (#2194 before #2190/#2193; #2184
blocking the drain) lived only in a supervising session's context. This spec adds the write
side: a cheap, attributed way to record a blocker when it is found.

## Root cause (mechanism + missing gate)

No step in dispatch or the chief-of-staff path records a blocking relation when one is
discovered, and nothing prompts or checks for it. The ranker (read side) exists; the write
side does not. The most valuable edges are discovered mid-work, where only session context
holds them. (Numbers above are from the issue; re-measure at Plan: *I believe* they still
hold, unverified.)

## Requirements

- **FR-1 Record helper.** `scripts/lib/gh-bot.sh` provides a helper that records
  "issue B is blocked by issue A" through the mechanism chosen in D1, taking two issue
  numbers on the target repo. Writes carry the bot identity (existing `gh` function path).
- **FR-2 Idempotent.** Recording an edge that already exists is a success no-op, not an error
  and not a duplicate.
- **FR-3 Fail visible.** If the write is refused (permission, unknown issue, network), the
  helper exits non-zero with the reason on stderr. No `|| true`; callers must not swallow it
  (constitution invariant 2).
- **FR-4 Input validation.** Reject self-edges, non-numeric or non-positive numbers, and
  (where cheaply detectable) an edge that would form a 2-cycle with an existing edge.
- **FR-5 Call sites.** The dispatch path and the chief-of-staff path invoke the helper when a
  blocker is found (D3 fixes the exact trigger). Prose-only "remember to record" is not
  acceptable (enforce, don't trust the model).
- **FR-6 Ranker agrees.** An edge recorded by the helper is counted by the ranker with no
  ranker change; an acceptance test proves round trip (record, fetch, rank).
- **FR-7 Offline.** Sourcing the helper does no network call; only an invocation writes
  (matches the lazy-mint rule in `gh-bot.sh`).
- **FR-8 Measurable.** A reproducible count of open edges by source (body vs native) can be
  printed, so adoption is observed rather than assumed.

## Acceptance criteria

- AC-1 Given two open issues, the helper makes the ranker's blocked/unblocks counts change
  accordingly, with the issue body unchanged under the native option.
- AC-2 Re-running the helper with the same pair changes nothing and exits 0.
- AC-3 With a token lacking write access, exit is non-zero, stderr names the cause, no edge exists.
- AC-4 Self-edge and non-numeric input exit non-zero without any network call.
- AC-5 A test fails if a dispatch/CoS call site is removed (call sites are asserted, not only
  documented).
- AC-6 Under the body option (D1-b), recording leaves a verdict record that does not force
  re-triage (see D2).

## Invariants this must not break

- Offline core: no network call without invocation (constitution 1).
- No silent gate: refusal is loud; no swallowed error (constitution 2).
- Blast radius: helper acts only in a repo carrying `.minspec/` (constitution 3).
- Bot attribution: all writes go through `gh-bot.sh` (`scripts/check-gh-bot-attribution.sh`).
- Body-hash keyed triage verdicts must not be silently staled by a recording.

## Decisions needed (Clarify)

**D1 - Where is the edge stored?**
- (a) **GitHub native blocked-by (rec)**: visible in UI, machine-readable, ranker already reads
  it. Cost: unverified that the App token may write issue dependencies; if not, the App's
  permission must be extended, which is an outward-facing change only the founder can grant.
  A permission probe is the first Plan task.
- (b) `Blocked by #N` line in the blocked issue's body: no new permission. Cost: body edit
  stales the body-hash triage verdict and triggers re-triage (see D2).
- (c) Native with body fallback when the write is refused: works either way. Cost: two stores
  can drift, and the fallback hides the permission gap unless it logs loudly.

**D2 - If body is ever used, how to avoid re-triage?** Options: exclude the declaration line
from the body hash (touches the hash definition, a high-blast-radius gate), or accept
re-triage. Recommendation: accept re-triage and avoid D1-b where possible. Cost: one wasted
triage pass per recorded edge.

**D3 - What triggers recording?** (a) Explicit helper call by the dispatching or CoS session
(rec; simple, cost: still relies on the session calling it, so FR-5's test only proves the
call site exists). (b) Automatic detection from agent output such as "blocked by #N". Cost:
false edges from prose, the very failure `issue-rank.ts` already guards against.

## Out of scope

Changing ranker weights; backfilling historical edges (file separately if wanted); editing
the ranker's parser.
