---
id: SPEC-268
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-268 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a repo must carry, provisionable without hand-set secrets
relates_to: ["#2982", "#1567", "#559", "DR-115"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-268 - Tasks

Plan: [design.md](design.md). Contract: [requirements.md](requirements.md), which no task
edits. One pull request: it changes `.github/workflows/`, so it is a machinery pull request
and needs a founder push (the bot has no `workflows` permission).

1. **T0 tests first** (FR1-FR8, AC1-AC7) -
   `packages/minspec/tests/review-identity-mode.test.ts`: executes the `ai-review.yml`
   guard step and the `ready-to-merge.yml` `ctx` step over the four secret states; token
   expression binding; gate allowlist widening, fork and machinery refusals; `workflow_run`
   resolution (App early exit, no PR, read failure, closed PR, current base).
2. **Guard helpers** (FR5, FR6) - `.github/scripts/ai-review-guard.js`:
   `effectiveAllowlist`, `pathsTouchMachinery`, `FALLBACK_REVIEWER_LOGIN`.
3. **`ai-review.yml`** (FR1-FR4, FR10) - guard, mint condition, token expression,
   permissions, NOTICE and header text.
4. **`ready-to-merge.yml`** (FR5, FR7) - `workflow_run` trigger, concurrency group, `ctx`
   step, base pin, gate PR source and allowlist.
5. **Probe and report** (FR8, AC6) - `ruleset-advisor.ts` constants and
   `probeReviewerIdentity`; `init.ts` sentence; existing tests updated.
6. **Recurrence gate** (design R5) -
   `packages/minspec/tests/adopter-secret-allowlist.test.ts`.
7. **Regenerate templates** (AC7) - `node scripts/gen-ci-templates.mjs`; full suite and
   typecheck.
