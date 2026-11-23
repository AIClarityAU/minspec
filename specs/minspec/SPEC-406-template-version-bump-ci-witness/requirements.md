---
id: SPEC-406
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
aspects: [provenance, packaging, silent-gate, ci, templates]
depends_on: []
relates_to: ["#1549", "#1533", "#1989", "SPEC-060", "DR-069", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface: a CI
  job or step in `.github/workflows/`, a change to `scripts/lib/template-version-bump.ts`, and
  tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-406: The template-version-bump gate gets a second, CI witness

> **SPECIFICATION ONLY.** Written for issue #1549 (shipped gate/template fixes are
> indistinguishable from the broken build). Nothing is built until this is approved and the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved. No new decision record.

## Why a residual spec, not a full one

Issue #1549 asks for two things. Measured on `main` at `7ed83316`:

| Ask | State | Where |
|---|---|---|
| 1. Stamp the build (sha, surface in status) | Sha stamp shipped; `buildLabel()` reaches the status-bar click. Timestamp and an on-demand About surface are NOT shipped. | **SPEC-060** FR-1, FR-2 (its design.md "What already shipped" table) |
| 2. Gate the bump on template change | A **local-only** gate exists: `scripts/check-template-version-bump.ts`, wired into `.githooks/pre-push` and `npm run check:template-version` (#1989). Its own header says "LOCAL ONLY: CI does not run it, and `TEMPLATE_VERSION_GATE_OFF=1` skips the hook, so it is not an enforced merge gate." | `scripts/lib/template-version-bump.ts` |

Part 1 is already owned by SPEC-060 and is not respecified here. This spec covers the
remaining hole in part 2: the gate has one witness that one env var disables, which
constitution invariant 2 forbids for a required check ("no required check hinges on a single
producer ... provide an independent second witness").

## Functional requirements

- **FR-1 (CI witness).** A CI check MUST run the same decision function
  (`checkTemplateVersionBump`) against the PR's merge-base and head, and MUST fail the PR when a
  file in the shipped-template set changed and `packages/minspec/package.json` `version` did not.
  It MUST NOT reimplement the rule; the hook and CI share one function so they cannot drift.
- **FR-2 (fail closed, visibly).** If CI cannot determine the base or read either version, the
  check MUST fail with a message naming what was unreadable. A missing base ref, a shallow clone
  or a git error is never a pass (invariant 2).
- **FR-3 (offline).** The check reads local git objects only; no network call (invariant 1).
- **FR-4 (scope).** The check runs only in this repository's workflows. It ships nothing to an
  adopter and does not touch the scaffold (invariant 3).
- **FR-5 (trigger set matches what ships).** The trigger file list MUST be derived from, or
  pinned by a test against, the set of sources whose output the scaffold renders. The issue
  names `scaffold.ts`; the current list (`template-registry.ts`, `ci-review-templates.ts`,
  `hook-templates.ts`, `slash-commands.ts`, `ownership-path-rules.ts`) does not include it. Plan
  MUST settle whether `scaffold.ts` belongs (see Decision 2) and add a drift test.
- **FR-6 (bypass is visible).** `TEMPLATE_VERSION_GATE_OFF=1` stays a local convenience only. CI
  has no equivalent env bypass; a deliberate exemption is a visible PR label or a recorded
  reason, never a silent skip (Decision 3).

## Acceptance criteria

- **AC-1.** A fixture PR editing `template-registry.ts` with an unchanged version fails the CI
  check; the same PR with a bumped version passes.
- **AC-2.** A fixture with an unresolvable base ref fails the check (does not pass).
- **AC-3.** A PR touching no trigger file passes without a bump.
- **AC-4.** A test fails if the hook's and CI's trigger set differ.
- **AC-5.** The check makes no network call (grep/test pinned, as for SPEC-060 FR-6).

## Invariants this must not break

1. **Offline** - local git only.
2. **No silent gate** - a failed or undeterminable run fails the check; CI is the independent
   second witness to the hook.
3. **Blast radius** - this repo's CI only; nothing shipped to adopters changes.

Also: the gate must not hash-stale any approved spec (it edits none).

## Decisions needed (Clarify)

1. **Is the CI check required for merge?**
   - **(rec) Required.** Without it the gate stays advisory and a stale-template release is
     possible again. Cost: a docs-or-comment-only edit to a template source needs a version
     bump or an exemption, and a required-check change needs a human `--admin` ruleset edit
     (machinery PR).
   - Advisory (non-required). No merge friction; cost: it is the same single-witness hole in
     practice, since nobody is forced to read it.

   **Recorded selection: the recommended option,** required. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
2. **Trigger granularity.** The issue's own recommendation is to trigger on *rendered* output,
   not source files.
   - **(rec) Keep the file list, add `scaffold.ts`, and add a drift test.** Cheap, offline,
     deterministic. Cost: comment-only edits to those files still demand a bump, inflating the
     version stream.
   - Render the scaffold corpus at base and head and compare bytes. Exact, no false positives.
     Cost: a scaffold-render harness must be built and kept deterministic, which is a
     materially bigger change and a new drift surface of its own.

   **Recorded selection: the recommended option,** keep the file list, add `scaffold.ts`, and add a drift test. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
3. **Exemption mechanism for a justified no-bump.**
   - **(rec) A `no-version-bump` PR label that the check reads and prints loudly.** Visible and
     auditable. Cost: a label is an agent-writable bypass; a reviewer must read it.
   - No exemption. Cost: forces needless bumps on pure refactors.

   **Recorded selection: the recommended option,** a `no-version-bump` PR label that the check reads and prints loudly. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
4. **Where does the timestamp/About surface of part 1 live?** Recorded selection pending: it is
   SPEC-060 FR-2/DQ-1, so this spec defers to it and will not duplicate it. Confirm that split.

   **Recorded selection: confirmed - it lives in SPEC-060 (FR-2/DQ-1) and this spec does not duplicate it. Recorded by agent 2026-11-23 under founder decision, queue item clarsel (2026-11-17), DR-123; sign-off ratifies it.**

## Follow-ups (tracked)

- Part 1 remainder (UTC build timestamp, `MinSpec: About MinSpec`): SPEC-060 FR-2 / #1549.
