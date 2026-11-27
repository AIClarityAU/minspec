---
id: SPEC-463
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-003  # SDD Core Methodology - scaffolded CI review stack is a core adopter write path
relates_to: ["#1076", "#1026", "#1017", "#871", "#1959", "AIClarityAU/sealbox#32"]
implements: none
implements_reason: >-
  Specify phase only. Candidate files, decided at Plan: packages/minspec/tests/managed-script-dependencies.test.ts,
  scripts/review-branch.sh (the swallowed-failure site).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A scaffolded `approval-provenance.py` must run, and fail visibly when it cannot (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built until a
> human resolves **Decisions needed (Clarify)** and approves it.

Source issue: #1076 (split out of #1026, where shipping the script was reverted).

## Finding: most of #1076 is already built on main

The issue's four to-do items were checked against the code, not the issue prose (evidence discipline):

| #1076 item | State on main | Evidence |
|---|---|---|
| 1. Ship `canonical.py` alongside the script | **Done** — shipped as a second managed template | `scripts/gen-ci-templates.mjs:129-141` (`APPROVAL_PROVENANCE_PY`, `CANONICAL_PY`); `packages/minspec/src/lib/template-registry.ts:3045-3060` |
| 2. Register both in `CI_STACK` | **Done** | `packages/minspec/tests/managed-region-templates.test.ts:365-366` |
| 3. Preamble `#!/usr/bin/env python3`, no trailing newline | **Done** | `managed-region-templates.test.ts:319` (`PY_SHEBANG`), used as `preamble:` on both entries |
| 4. Test that the scaffolded script *runs* | **Partly done** — a load-only check exists | `packages/minspec/tests/managed-script-dependencies.test.ts:118-150` |

So the original defect (dead-on-arrival import) is closed. Two residual gaps remain, and they are what
this spec covers.

## Residual gaps

- **G1 — the run test proves import, not function.** The existing test invokes the scaffolded script with
  no arguments and asserts only that it reaches its `Usage` message. A scaffolded copy whose hash logic,
  git plumbing or output format diverged from the repo's copy would still pass. "It loads" is a proxy for
  "it produces the provenance facts".
- **G2 — the failure is still silent in the consumer.** `scripts/review-branch.sh:130` runs
  `python3 approval-provenance.py ... 2>/dev/null || true`, so any future import or runtime failure in a
  scaffolded repo again yields an empty provenance block with no signal — the exact failure mode #1076
  describes. This conflicts in spirit with constitution invariant 2 (no silent gate: no load-bearing gate
  signal written with a swallowed error). The line is annotated `swallow-ok` on the argument that the note
  is optional and "changes no verdict"; #1017 shows it does change reviewer verdicts (false "forged
  sign-off" blocks), so that argument deserves a deliberate decision rather than inheritance.

## Functional requirements

- **FR-1** A test SHALL scaffold the managed set into an empty directory (as the existing test does) and
  run the scaffolded `approval-provenance.py` against a small real git fixture containing an approval
  sidecar change, asserting the emitted facts (backed re-approval vs. mismatch) match what the repo's own
  copy emits for the same fixture.
- **FR-2** The FR-1 test SHALL fail if any managed file the script needs at runtime is absent from the
  scaffolded tree (it must not rely on files present only in MinSpec's own checkout; run it with the
  fixture's `cwd` outside the repo).
- **FR-3** The FR-1 test SHALL include an anti-vacuity assertion (the output is non-empty and contains a
  provenance fact), so an empty-output pass is impossible.
- **FR-4** Per the Clarify decision below, a failure of `approval-provenance.py` to run in
  `review-branch.sh` SHALL be made visible (outcome of DQ-1), without changing behaviour in repos that do
  not carry the script.
- **FR-5** No new template, dependency or network call is introduced; the scaffolded set remains
  stdlib-only and offline.

## Acceptance criteria

- **AC-1** With `canonical.py` removed from the scaffolded tree, the FR-1 test fails (mutation check).
- **AC-2** With the scaffolded script's hash call altered, the FR-1 test fails (it proves function, not load).
- **AC-3** Per DQ-1's outcome, a forced provenance failure is observable in the review run's output rather
  than producing an empty block indistinguishably from "no sidecar in range".
- **AC-4** `npm test`, `npm run validate` and `npm run lint` pass.

## Invariants this must not break

- Invariant 1 (offline): no network calls.
- Invariant 2 (no silent gate): G2 is exactly this; the change must not add a new swallowed error.
- Invariant 3 (blast radius): scaffolding remains confined to `.minspec/`-opted-in repos; the fix must not
  alter repos that lack the script (the existing `-f` existence guard stays).
- The #1026 lesson: a managed script's runtime dependencies must themselves be managed templates
  (`managed-script-dependencies.test.ts` stays green).

## Decisions needed (Clarify)

- **DQ-1 — How loud should a provenance failure be in `review-branch.sh`?**
  - **A (rec)** Distinguish "script absent" (silent, current guard) from "script present but failed": on
    failure, inject an explicit `PROVENANCE UNAVAILABLE: <exit code>` line into the TRUSTED block so the
    reviewer knows the facts are missing rather than absent. Cost: the reviewer sees a new line and may
    hedge on sidecar-only PRs when the script is genuinely broken — which is the honest outcome; slight
    prompt-size increase.
  - **B** Keep `|| true`, rely on FR-1's test alone. Cost: a runtime-only failure (e.g. no `python3` on
    the CI runner, git too old) still degrades silently in adopters; the test cannot see their runners.
  - **C** Fail the review run. Cost: an optional evidence note could block every adopter PR; disproportionate.
- **DQ-2 — Close #1076 as already-satisfied apart from FR-1/FR-4?** **(rec)** Yes: link this spec from the
  issue and close it when FR-1 and DQ-1's outcome land. Cost: none material; the alternative (leaving it
  open) keeps a misleading "not shipped" signal.

## Follow-ups (tracked)

None beyond #1076 itself.
