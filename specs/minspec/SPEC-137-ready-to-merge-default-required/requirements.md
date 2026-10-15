---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - this is the "enforce it everywhere" tail of that epic
aspects: [ruleset, required-checks, ready-to-merge, ai-review, no-silent-gate, blast-radius, no-deadlock]
depends_on: [SPEC-031]  # SPEC-031 productizes the per-type reviewer; this spec only changes what the ruleset offer does once a reviewer exists
relates_to: [DR-050, DR-047, DR-063, DR-033, "#390", "#365", "#350", "#559", "#560", "#564"]
---

# Make `ready-to-merge` a default required check in the ruleset offer - Requirements

**Date:** 2026-10-15
**Triggered by:** [#390](https://github.com/AIClarityAU/minspec/issues/390) (circle-back, deferred until the reviewer ships in the vsix).
**Design rests on:** DR-050 (Tier-0 `gh` boundary; "ready-to-merge must NOT be required until the reviewer is wired"), DR-047 / SPEC-031 (reviewer across all approvables).

## Scope sentence

Once a project has a working reviewer, the ruleset offer requires `ready-to-merge` by default instead of only when the user hand-adds it - and never on a project that cannot produce the check.

## Current state (verified against code, 2026-10-15)

- `DEFAULT_REQUIRED_CHECK_CONTEXTS` is `['MinSpec SDD validation']` only; `ready-to-merge` is deliberately excluded (`packages/minspec/src/lib/ruleset-advisor.ts:63-80`). (Issue text says `lint`+`test`; that was the pre-#559 default and is stale.)
- `resolveTieredRequiredChecks` already adds `ready-to-merge` and `ai-review` when the workflow is scaffolded AND `reviewerConfigured` is true (`ruleset-advisor.ts:412-440`), where `reviewerConfigured` comes from `probeReviewerConfigured` (secret NAMES only, DR-050 Amendment 2026-07-16).
- So the "detect a configured reviewer and include it" option from the issue is already partly built. **What remains unverified by me:** whether the init/refresh caller actually passes the probe result into the tiered resolver on every path, and whether SPEC-031's reviewer is shipped to the vsix (SPEC-031 is `status: planning`, so I believe it is not; unverified). FR-1 makes the plan confirm both before anything changes.

## Functional requirements

- **FR-1 Establish the gap.** Before any change, the Plan phase records, with `file:line`, (a) every call site that builds the required-check set for create AND refresh, (b) whether each uses `resolveTieredRequiredChecks` with a real probe, and (c) which reviewer pieces SPEC-031 has shipped. If (b) already holds everywhere, this spec reduces to FR-4/FR-5 (docs + tests) and no behaviour change.
- **FR-2 Default inclusion is conditional, never unconditional.** `ready-to-merge` is in the offered required set by default iff its workflow is scaffolded AND the reviewer is configured/producible. It is never put in `DEFAULT_REQUIRED_CHECK_CONTEXTS` as a static member (see Decision D1).
- **FR-3 No deadlock.** A repo with no reviewer (no secrets / no workflow) gets the same ruleset as today. The #559/#560 protection and `required-checks-default-parity.test.ts` stay green.
- **FR-4 Visible, not silent.** When the reviewer is not configured, the offer states that `ready-to-merge` was left out and why, and how to enable it (the `minspec.ruleset.requiredChecks` setting or configuring the reviewer). When it is included, the offer lists it. (Invariant 2: no silent gate.)
- **FR-5 Refresh path.** An existing ruleset created before the reviewer was wired is offered the addition on refresh once the reviewer is configured; it is an offer the user accepts, not a silent edit of their ruleset (consent, invariant 1; blast radius, invariant 3).
- **FR-6 Opt-out.** A user can remove `ready-to-merge` from the set without it being re-added on every refresh (Decision D2).
- **FR-7 Offline.** The decision stays pure; the only network read is the existing DR-050 read-only probe. No new network call.

## Acceptance criteria

- AC-1 (FR-2/3): resolver test - reviewer configured + workflow scaffolded -> `ready-to-merge` present; reviewer absent -> absent; workflow absent -> absent.
- AC-2 (FR-3): parity test asserts `DEFAULT_REQUIRED_CHECK_CONTEXTS` and the `package.json` setting default contain no reviewer-gated check.
- AC-3 (FR-1): Plan artifact contains the call-site table with `file:line`.
- AC-4 (FR-4): offer text for the reviewer-absent case names the omitted check and the enabling step.
- AC-5 (FR-5/6): refresh with reviewer newly configured proposes the addition; a recorded opt-out suppresses it.
- AC-6: a project without `.minspec/` receives no change (invariant 3).

## Invariants this must not break

1. Offline core: no new network call (CLAUDE.md invariant 1).
2. No silent gate / no deadlock: never require a check the repo cannot produce (invariant 2; DR-050; #559/#560).
3. Blast radius: nothing changes in a repo without `.minspec/` (invariant 3); existing rulesets are only changed by an accepted offer.

## Decisions needed (Clarify)

- **D1 - how "default" is realised.**
  - (a) **(rec)** Keep conditional inclusion (FR-2): include when reviewer is configured. Cost: "default" means "default where producible"; a project that has the workflow but not the secrets still gets no gate, so enforcement is not universal.
  - (b) Static member of the default constant, once SPEC-031 is in the vsix. Cost: re-opens the #559 deadlock for any project whose reviewer secrets are unset, and `bypass_actors: 0` means `--admin` cannot rescue it.
- **D2 - where an opt-out is recorded.** (a) **(rec)** Workspace setting listing excluded checks; cost: a second setting alongside `requiredChecks`. (b) Treat absence in the live ruleset as opt-out; cost: indistinguishable from "never offered".
- **D3 - trigger.** The issue says "when EPIC-010 lands". Option (a) **(rec)** gate on observable state (reviewer configured), so no release-coupling is needed and FR-1 may find this already done; cost: the issue's literal "after EPIC-010 ships" milestone is not tracked. (b) Hold this spec until SPEC-031 is `done`; cost: leaves the gap open for an unknown time.
- **D4 - include `ai-review` too?** The resolver already pairs it with `ready-to-merge`; the issue names only `ready-to-merge`. (a) **(rec)** Leave as the resolver already does; cost: scope stays as-is rather than narrowing to the issue's wording. (b) `ready-to-merge` only.

## Follow-ups (tracked)

None beyond this issue (#390).
