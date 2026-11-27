---
id: SPEC-380
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — two parsers answering one question drift into a false signpost
aspects: [blocked-by, parity, redos, machinery, single-source, tier-0]
relates_to: ["#2199", "#2196", "#2135", "#1247", SPEC-371]
implements:
  - .github/scripts/ai-review-guard.js
  - .github/scripts/ai-review-guard.test.js
  - scripts/lib/issue-rank.ts
  - packages/minspec/tests/issue-rank.test.ts
  - packages/minspec/src/lib/ci-review-templates.ts
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-380: One blocked-by grammar, imported by both the ai-review guard and the issue ranker (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under *Decisions needed (Clarify)*, and approves it before code
> changes.

Materializes [#2199](https://github.com/AIClarityAU/minspec/issues/2199): the "blocked by"
grammar exists twice with nothing keeping the copies in step.

## Root cause (measured, not inferred)

Two independent implementations answer "which issue numbers does this text declare as blockers?":

- `BLOCKED_BY_LINE_RE` + `BLOCKED_BY_REFS_RE` + `ISSUE_REF_RE` + `parseBlockedBy`
  (`.github/scripts/ai-review-guard.js:292`, `:304`, `:305`, `:1926`) — PR bodies; CommonJS;
  accepts only `Blocked by`.
- `DECL_LINE_RE`, `DECL_HEADING_RE`, `parseDeclaredBlockers`
  (`scripts/lib/issue-rank.ts:136`, `:137`, `:240`) — issue bodies; TypeScript; also accepts
  `Depends on`, a `## Blocked by` heading plus its one list, and skips fenced code.

The ranker's copy was written to mirror the guard's (including the #2135 quadratic-backtracking
bound `{0,64}`), but nothing enforces that. The mechanism of drift is two hand-maintained
regexes; the missing gate is any test or structure that fails when they diverge. A second ReDoS
fix to one copy would not reach the other. (Colon-inside-bold, `**Blocked by:** #N`, is named
in the issue as an accepted form; whether the current ranker regexes already cover it is to be
confirmed by the first test, not assumed here — I believe it is handled via `afterDeclaration`,
unverified.)

## Scope

One shared grammar module, imported by both consumers, with one decision recorded on which
forms apply to PR bodies. Out of scope: changing how either consumer *uses* the parsed
numbers (label application, ranking), and new grammar forms nobody has measured (`Blocks #N`,
`Prerequisite for #N`).

## Functional requirements

- **FR1.** A single module owns the declaration grammar: the line pattern, heading pattern,
  leading-ref-run pattern, ref extraction, and fence handling. Neither consumer keeps its own
  copy of any of those patterns.
- **FR2.** `parseBlockedBy` (guard) and `parseDeclaredBlockers` (ranker) are thin wrappers over
  the shared parser. Their public names, signatures, and return shape (sorted, de-duplicated
  numbers; empty array for null/undefined) are unchanged.
- **FR3.** The set of accepted forms is a parameter of ONE shared definition, not two grammars:
  the shared parser takes an options object (e.g. which declaration keywords and whether
  heading sections are honoured), and each consumer's choice is a named constant in the
  consumer. Same input + same options => same output, by construction.
- **FR4.** The #2135 bounded-quantifier protection survives: every user-text-facing pattern in
  the shared module keeps the `{0,64}` bounds, and the ReDoS regression inputs from
  `ai-review-guard.test.js` run against the shared module.
- **FR5.** Fixed-input parity test: a table of bodies (every form in the issue-rank and guard
  docstrings, plus prose negatives such as "blocked by a stale cache; see #1225") is run
  through both wrappers under the SAME options, asserting identical output. Under each
  consumer's real options, the expected difference is asserted explicitly, so an accidental
  widening of either fails.
- **FR6.** The decision on extra forms for PR bodies (see Decisions needed) is recorded in the
  shared module's header comment and in the consumer's option constant.
- **FR7.** The shared module is delivered wherever the guard runs. The guard is shipped
  verbatim to consuming repos (`ci-review-templates.ts`) and invoked by
  `.github/workflows/ai-review.yml` via `GUARD_JS`; a guard that `require`s a file that is not
  shipped alongside it must fail visibly (invariant 2), never fall back to a stale inline copy.
- **FR8.** Because `.github/**` is machinery, the change is declared as needing the human merge
  path; the PR body states this.

## Acceptance criteria

- **AC1.** `grep` for the line/heading/ref regex literals finds each in exactly one file.
- **AC2.** Changing the shared module's line pattern changes both consumers' behaviour in one
  edit (demonstrated by a mutation: loosen it, both suites' parity rows fail).
- **AC3.** All existing `ai-review-guard.test.js` and issue-rank tests pass unmodified, except
  for rows added to record the Decision outcome.
- **AC4.** The ReDoS inputs from #2135 complete in the same time bound as before, in the shared
  module.
- **AC5.** A consuming repo's installed guard either has its shared module present or exits
  non-zero with a message naming the missing file; verified by a test that deletes it.
- **AC6.** `npm test`, `npm run validate`, `npm run lint` pass; CI's `node --test` step for the
  guard still passes with no TypeScript toolchain (see Decision 1).

## Invariants this must not break

- **Invariant 2 (no silent gate):** a missing shared module, or a parser throwing, must fail the
  guard visibly, not degrade to "no blockers declared" (which would silently drop a
  `blocked-by` label).
- **Invariant 3 (blast radius):** the shipped guard template changes behaviour in consuming
  repos only if they re-sync it; nothing is written to a repo without the `.minspec/` marker.
- **Invariant 1 (offline):** pure text-in/numbers-out; no network.
- Existing behaviour of `parseBlockedBy` outputs for all current inputs, unless Decision 2
  explicitly widens it.

## Decisions needed (Clarify)

1. **Module language and shipping shape.** The guard is plain CommonJS run by `node` in CI
   (no build step) and copied verbatim to consumers; the ranker is TypeScript.
   - **(a) CommonJS `.js` module in `.github/scripts/`, `require`d by the guard, imported by the
     TS ranker** *(rec)* — TS already imports guard JS (`scripts/auto-merge-gate.ts`), so the
     direction is proven; works without a build. Cost: the consumer template bundle must now
     ship two files, and the install/sync path must be extended.
   - **(b) TypeScript module, compiled/inlined into the guard at template-build time** — types
     for free. Cost: the guard in `.github/scripts/` becomes a generated artifact, adding a
     build gate and a drift check on top of what this issue removes.
   - **(c) Keep guard self-contained; add only a parity test** — smallest, ships nothing new.
     Cost: two copies remain; the test catches divergence but a ReDoS fix still needs two edits.

   **Recorded selection: the recommended option,** (a), CommonJS `.js` module in `.github/scripts/`, `require`d by the guard, imported by the TS ranker. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
2. **Should PR bodies accept `Depends on`, the heading form, and colon-inside-bold?**
   - **(a) No — keep the guard's current narrow grammar** *(rec)* — the extra forms were
     measured only on issue bodies; PR bodies use "depends on" as narrative more often, and the
     guard's label gates merge flow. Cost: the same sentence can still count in one place and not
     the other, now an explicit, tested option difference rather than accident.
   - **(b) Yes — one grammar everywhere** — no divergence at all. Cost: needs a corpus
     measurement over PR bodies first (not done), and risks false `blocked-by` labels.
   - **(c) Accept only colon-inside-bold** (a punctuation variant, not a new keyword) — low risk.
     Cost: a half-measure; still two option sets.

   **Recorded selection: the recommended option,** (a), no: keep the guard's current narrow grammar for PR bodies. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
3. **Recording.** Does the shared-module choice (1) meet the DR-359 filter (not undoable in
   under a day)? I believe not (a refactor), so no DR is proposed; say if you want one.
   **Recorded selection: the recommended option,** no DR, the position the spec states (the shared-module choice is a refactor, undoable in under a day). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.

## Follow-ups (tracked)

None — the PR-body corpus measurement, if Decision 2(b) is chosen, becomes a task inside this
spec's plan rather than a separate issue.
