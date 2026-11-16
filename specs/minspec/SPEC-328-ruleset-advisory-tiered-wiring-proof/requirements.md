---
id: SPEC-328
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a shared repo must carry
aspects: [governance, ruleset, init, fail-visible, no-deadlock]
depends_on: []
relates_to: ["#620", "#564", "#619", "#796", "SPEC-033", "DR-050"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: tests only (`packages/minspec/tests/ruleset-advisor.test.ts`); the
  production wiring already exists (see Finding). None of the test work is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-328: Prove the tiered required-check wiring in the init-time ruleset advisory

Issue: #620 (wire `resolveTieredRequiredChecks` into the init-time ruleset advisory). Parents: #564 (tiered resolver), #619 (its PR). Design basis: DR-050 (read-only config probes run autonomously; mutations need a click), SPEC-033 FR-3 (branch-protection provisioning, symmetric).

## Finding (checked against main, not inferred)

The issue states the resolver is "tested-but-unwired". On main that is no longer true:

- `packages/minspec/src/commands/init.ts:782` `resolveWantedChecks()` probes `.github/workflows/ai-review.yml` and `ready-to-merge.yml` on disk, reads `package.json` scripts, calls `probeReviewerConfigured()` (line 797), then `resolveTieredRequiredChecks()` with `detectCodeChecks(scripts)` and the user's `minspec.ruleset.requiredChecks` (lines 798-804).
- `offerRulesetAdvisory` (line 905) uses it whenever `deps.requiredChecks` is not injected (line 980), and compares the wanted set to the ruleset symmetrically (create when absent, add-missing when present).
- It landed with #796 (commit bade1c096, "vsix Init/Refresh provisions the full producible check set, symmetrically").

So the production wiring is done; #620's stated work is already delivered. The residual defect is a **proof gap**: every test that drives `offerRulesetAdvisory` through the real `resolveWantedChecks` path uses a fixture folder with no scaffolded workflows and no `package.json` (`ruleset-advisor.test.ts` ~lines 661-700 and ~846-870 land on "validation only"). The positive path that this issue exists to activate - workflows present + reviewer secrets present => `ai-review` and `ready-to-merge` become wanted and are offered - is tested only at the pure-resolver level, and via the injected `requiredChecks` override that bypasses `resolveWantedChecks`. A regression in the fs probe (wrong file name, wrong path) or the arg order into the resolver would pass every current test.

## Functional requirements

- **FR-1 Positive path through the real probe.** A test drives `offerRulesetAdvisory` with NO injected `requiredChecks`, against a real temp folder containing `.github/workflows/ai-review.yml` and `ready-to-merge.yml`, with the secrets GET returning all of `REVIEWER_SECRETS`. The create/add offer must name `ai-review` and `ready-to-merge`, and the resulting POST/PUT payload must contain them.
- **FR-2 Each Tier-A gate stays closed.** With the same folder, each of these omits both Tier-A checks from the wanted set: any one of the three reviewer secrets missing; a secrets GET that fails or returns non-JSON; a workflow file absent (that check alone omitted).
- **FR-3 Tier-B from package.json.** With a temp `package.json` whose `scripts` define `lint`, `test`, `build`, those become wanted; a script that is absent is not wanted; an unparseable or missing `package.json` yields none and does not throw.
- **FR-4 Existing-ruleset symmetry.** A ruleset requiring only `MinSpec SDD validation`, with FR-1's fixture, produces the add-missing offer listing exactly the missing contexts; a ruleset already requiring the full set is silent.
- **FR-5 No production change unless a test exposes a defect.** If FR-1..FR-4 pass against current code, no `src/` edit is made. If one fails, the fix lands with its root cause (mechanism plus the missing gate) per DR-003.

## Acceptance criteria

- AC-1: FR-1..FR-4 each map to at least one named test that fails when the corresponding `resolveWantedChecks` input is broken (mutation check: rename `ai-review.yml` in the probe, or drop `reviewerConfigured`, and the matching test goes red).
- AC-2: `npm test`, `npm run validate`, `npm run lint` pass.
- AC-3: Issue #620 is closed referencing #796 as the wiring and this spec's tests as the proof.

## Invariants the change must not break

- Offline-first: the only network read is the existing user-`gh` GET of the repo's own secret NAMES, no new egress (CLAUDE.md invariant 1; DR-050 Amendment 2026-07-16).
- No silent gate / no deadlock: a Tier-A or Tier-B check is never required unless the repo can produce it (#559); an errored probe fails closed to "not required", and the advisory stays visible (docs link / toast), never best-effort-silent about a failed create.
- Blast radius: the advisory only acts in a repo that opted in with `.minspec/` (invariant 3); tests must not widen this.
- Mutation stays click-gated (DR-050): no ruleset write without the user choosing Create/Add.

## Decisions needed (Clarify)

1. **Scope of #620.** Options: (a) **(rec)** this tests-only spec, close #620 as delivered by #796 - costs a small test PR for something that already works, but closes the exact proof gap; (b) close #620 as already done with no further work - zero cost, but leaves the positive path unproven end-to-end, so a probe regression would ship silently; (c) re-open design of the wiring - not supported by the evidence above.
2. **Verify the premise before building.** I believe the wiring is complete from reading `init.ts` and the test fixtures; I did not run the suite on this dispatch (specify only). The implementer should run FR-1 first: if it passes unmodified, the work is tests only.
