---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - this is the substrate incremental re-review is built on
aspects: [reviewer, verdict-store, cache-key, tier-0, offline, no-silent-gate, never-wrong]
depends_on: [SPEC-031]
relates_to: [SPEC-031, DR-079, DR-003, "#653", "#453"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). New: the pure
# lookup module and its test. Modified: review-pr.sh (record write) and shared index
# (export), .gitignore (machine-local store).
implements: [packages/shared/src/verdict-store.ts, packages/shared/tests/verdict-store.test.ts]
affects: [packages/shared/src/index.ts, scripts/review-pr.sh, .gitignore]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Keyed verdict store - a cached review pass is valid only for the exact bytes, rubric and voter that produced it

## In plain terms

Today every AI re-review re-runs from scratch and remembers nothing. Incremental
re-review (#453) needs to ask "did voter V already pass *these exact bytes* under
*this exact rubric*?". This spec adds only the memory and the question: a small
machine-local record of each verdict, and one pure function that answers the question
and says "no" whenever the answer is not provably yes. Nothing consumes it yet.

**Issue:** [#653](https://github.com/AIClarityAU/minspec/issues/653) - prerequisite for
[#453](https://github.com/AIClarityAU/minspec/issues/453) (voter-skip, delta re-scoping).
**Design rests on:** SPEC-031 (the reviewer), DR-079 (verdict travels out of band as a
structured object - the record is written from that object, never parsed from prose).

## Scope

One sentence: record every voter verdict under a three-part key, and provide a pure,
fail-closed lookup; skip/delta *consumption* is out of scope (stays in #453).

## The gate this closes (RCDD)

Bad state made un-representable: a cached "pass" that no longer corresponds to what
was reviewed. Mechanism: a store keyed on less than all of (reviewed bytes, rubric
version, voter) returns a pass produced for different bytes (content drift) or by a
different reviewer (rubric drift) - the app-pin bug class, a silent bypass. The gate is
the key plus the lookup's fail-closed rule (FR-3, FR-4), not the data.

## Functional requirements

- **FR-1 Record shape.** A verdict record is
  `{ voterId, roleVersion, bytesHash, verdict, headSha, reviewedAt }`. `verdict` is the
  gate's two values (`pass` | `changes`). `headSha` and `reviewedAt` are provenance
  only and are never part of the key.
- **FR-2 Key components.**
  - `bytesHash` = hash of the exact text fed to the voter (the diff/section text after
    any truncation), not the PR number or head SHA.
  - `roleVersion` = hash of the content of the voter's role file (e.g.
    `scripts/roles/reviewer.md`), so any edit to a rubric invalidates its old passes.
  - `voterId` = stable name of the voter (role plus any model/profile discriminator
    the plan fixes; see Decisions needed).
  - The hash function and its hex encoding are one exported function, so writer and
    reader cannot disagree.
- **FR-3 Lookup.** `findValidVerdict(store, voterId, bytesHash, roleVersion) ->
  Verdict | null` in `@aiclarity/shared`: pure, deterministic, no `vscode`, no
  network, no clock, no LLM. Returns the record only when all three components are
  present and strictly equal.
- **FR-4 Fail closed on missing and malformed.** A stored record lacking any key
  component, with an empty/non-string component, or with an unrecognised `verdict`
  never satisfies a lookup. A lookup argument that is empty/undefined returns `null`
  (never matches an empty stored component). A malformed store returns `null`, never
  throws into the caller's pass path.
- **FR-5 Only pass is reusable; newest wins.** If several records match, the most
  recent `reviewedAt` decides; if the deciding record is `changes`, the result is that
  `changes` record (a later failure supersedes an earlier pass). Result is
  deterministic for a given store (tie-break defined in plan).
- **FR-6 Storage.** Machine-local and gitignored (same posture as `.minspec/auto-drain`
  and the proposed `.minspec/review-coverage` in #453), not committed `config.json`.
  Exact path decided in plan. A cached pass is machine state, not shared ground truth.
- **FR-7 Write on every verdict.** `review-pr.sh` appends a record for every voter
  verdict it obtains from the structured output (DR-079), including `changes`. A
  failed write is surfaced as a visible warning and never changes the label decision;
  the store is advisory to the label (nothing consumes it in this spec).
- **FR-8 Unparseable verdicts are not recorded.** A run with no clean verdict (the
  fail-closed-to-changes path) and a truncated-diff run (forced `changes` by the
  truncation backstop, #427) record nothing as a reusable pass; a truncated run's
  `bytesHash` must not equal the full diff's.

## Acceptance criteria (tests first, T0/T1)

1. Content drift: same `(voterId, roleVersion)`, different `bytesHash` -> `null`.
2. Rubric drift: same `bytesHash`, different `roleVersion` -> `null`.
3. Voter mismatch: same bytes and rubric, different `voterId` -> `null`.
4. Exact match on all three -> the stored verdict.
5. Asymmetry: a record missing `roleVersion` (likewise `bytesHash`, `voterId`) never
   satisfies a lookup, even when the other two match; same for empty-string values.
6. Empty/undefined lookup arguments -> `null` even if a stored record has empty fields.
7. Malformed store (not an array/object, junk entries) -> `null`, no throw.
8. Newer `changes` supersedes older `pass` for the same key (FR-5).
9. Editing a role file changes `roleVersion`; editing one byte of the diff changes
   `bytesHash`; identical input hashes identically (determinism).
10. `review-pr.sh` writes one record per obtained verdict and none on the no-verdict or
    truncation paths (FR-7, FR-8).

## Invariants this must not break

- **INV-1 Offline (constitution 1).** No network; pure module.
- **INV-2 No silent gate (constitution 2).** Missing/errored/malformed witness yields
  `null` (no reuse) visibly - never a pass; write failures warn, not `|| true`.
- **INV-3 Blast radius (constitution 3).** The store lives under `.minspec/` and is
  created only in a repo that opted in.
- **INV-4 Never a false pass.** No code path turns absence, mismatch, or parse error
  into a reusable pass.
- **INV-5 Label unchanged.** This spec does not alter how `ai-review:pass|changes` is
  decided (review-decide.sh) or add any consumer of the store.

## Out of scope

Voter-skip, delta/closure re-scoping, store expiry/pruning policy beyond what plan
needs to bound growth, multi-machine sharing (#453).

## Decisions needed (Clarify)

1. **Store format.** (a) JSON-lines append log **(rec)** - append is race-tolerant with
   concurrent sessions, trivially greppable; cost: needs periodic pruning and
   last-wins read logic. (b) single JSON file - simpler read; cost: concurrent
   writers clobber each other (the repo already hit multi-writer overwrites).
2. **Hash.** (a) sha256 hex **(rec)** - collision-safe, matches the repo's other hashes;
   cost: none material. (b) git blob hash - already available in shell; cost: ties
   the key to git object format and does not cover text with a header.
3. **`voterId` granularity.** (a) role name only **(rec)**, keeps skip useful across
   model upgrades; cost: a pass by a weaker model is reused for a stronger one.
   (b) role + model id - strictest; cost: every model bump invalidates all passes.
4. **Is a cached `changes` ever reusable?** (a) lookup returns any matching verdict
   and the consumer (#453) decides **(rec)**; cost: consumer must be disciplined to
   only skip on `pass`. (b) lookup returns passes only; cost: loses the FR-5
   supersede signal inside the pure function.
5. **Retention.** Bound by count or age, or leave to #453? Rec: bound by count in
   plan; cost: a very old pass is silently forgotten (safe direction).
