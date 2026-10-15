---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — failover spends the adopter's money and sends diffs to a second provider; consent + visible-gate class, same as SPEC-078
aspects: [ci, ai-review, quota, failover, config]
relates_to: ["#522", "#519", SPEC-078, SPEC-074, SPEC-031]
---

# SPEC-137: AI-review provider failover — config surface, live proof, Copilot decision

Issue: #522 (AIClarityAU/minspec). Builds on the hook shipped in #519. No DR exists for this design yet; DR need is a Clarify outcome (DQ-4).

## Problem

#519 shipped the *hook*: `scripts/review-branch.sh:453` fails over to a PAYG Anthropic key when `AI_REVIEW_FAILOVER == payg` and `ANTHROPIC_API_KEY` is set after a quota failure (`quota_failure`, `:449`). The switch is set only as a GitHub repo variable (`.github/workflows/ai-review.yml:456`), invisible to `.minspec/config.json` and the init flow. The PAYG route has never been exercised against a real quota wall. A third provider (GitHub Copilot) was floated.

**Scope sentence:** make the wait|payg choice a declared, visible per-project setting, prove the PAYG path against a real quota wall, and decide (not build) whether a Copilot adapter belongs.

## Functional requirements

- **FR-1 — Config key.** `.minspec/config.json` gains an optional `aiReview.failover` field, enum `wait` | `payg`, default `wait`. Absent = `wait` (today's behaviour). Unknown values fail config validation visibly (invariant 2), never silently coerce to `wait`.
- **FR-2 — Single resolved value.** One resolver determines the effective mode from config and the `AI_REVIEW_FAILOVER` repo variable, with documented precedence (DQ-1). The workflow and `review-branch.sh` consume the resolved value; no second parser of the setting.
- **FR-3 — Init prompt.** The init/setup flow asks "when subscription quota runs out: wait for reset, or fail over to pay-as-you-go?" with `wait` preselected. Choosing `payg` states plainly that diffs go to the Anthropic API under the user's key and incur cost, and that the key is a repo secret the extension never writes (invariant 1 consent; no secret handling in config).
- **FR-4 — Fail visible on half-configured payg.** If mode is `payg` but `ANTHROPIC_API_KEY` is absent, the review run surfaces this (distinct, named message in the blocked-comment), rather than silently behaving as `wait` as `:453` does today. Invariant 2.
- **FR-5 — Verdict provenance.** A review produced via failover is labelled as PAYG in the verdict output, so the reader can tell which route judged the PR.
- **FR-6 — Opt-in boundary.** Nothing in this change alters behaviour in a repo without `.minspec/` (invariant 3); default stays `wait`; no network call is added to the extension (invariant 1).
- **FR-7 — Live end-to-end proof.** A recorded, reproducible verification that, with the subscription quota actually exhausted, the PAYG invocation (`CLAUDE_CODE_OAUTH_TOKEN= ANTHROPIC_API_KEY=… claude -p`) routes to PAYG and yields a rendered verdict. Evidence (run link, log excerpt showing the failover line and verdict) is attached to the spec/PR; hermetic fixtures alone do not satisfy this (fixtures encode assumptions). How to force exhaustion safely is DQ-2.
- **FR-8 — Copilot decision recorded.** The Copilot adapter is NOT built under this spec. The outcome of DQ-3 is recorded; if accepted, a follow-up spec and issue are filed with a provider-adapter interface sketch.

## Acceptance criteria

- **AC-1** Config with `aiReview.failover: "payg"` validates; `"bogus"` fails validation with a named error; absent resolves to `wait`.
- **AC-2** Given each of {config only, variable only, both agreeing, both conflicting}, the resolver returns the documented winner (per DQ-1) — table-driven test.
- **AC-3** Init flow writes the chosen value and shows the cost/egress disclosure when `payg` is chosen.
- **AC-4** `payg` without a key produces the FR-4 visible message in the blocked output; `wait` is unchanged.
- **AC-5** A failover verdict contains the FR-5 provenance marker.
- **AC-6** FR-7 evidence exists and shows a real (not mocked) quota wall → PAYG verdict.
- **AC-7** A repo without `.minspec/` sees no behavioural change.

## Invariants not to break

1. No network call from the extension without consent (config read/write is local only).
2. No silent gate: misconfiguration and failover outcome are visible; `quota_failure` classification (SPEC-074/078) is not weakened.
3. Blast radius: opt-in marker `.minspec/`; default `wait`.
4. `run_reviewer payg` stays reachable only through the explicit failover call, never ambient env (`review-branch.sh:233`, `:309`).
5. API key never stored in `.minspec/config.json` or logs.

## Non-goals

Implementing Copilot; changing quota detection (SPEC-078); changing retry cadence.

## Decisions needed (Clarify)

- **DQ-1 — Precedence between config and repo variable.**
  A) Config wins, variable is override-only-if-config-absent **(rec)** — config is reviewable in a PR; cost: a repo owner can't flip emergency failover without a commit.
  B) Variable wins — fast ops toggle; cost: hidden, un-reviewed state silently beats the committed setting (the very drift this issue is removing).
  C) Disagreement is an error — most visible; cost: friction for a rarely-hit case.
- **DQ-2 — How to force a real quota wall for FR-7.**
  A) Use a dedicated low-limit throwaway subscription account until it exhausts **(rec)** — genuine; cost: needs founder-owned credential and an unpredictable wait.
  B) Wait for a natural exhaustion on the live fleet — free; cost: non-deterministic, may take weeks.
  C) Simulate with the exact quota message — fast; cost: does not meet FR-7 (it proves the classifier, not the routing).
  Either way credentials are a human action; the agent cannot supply them.
- **DQ-3 — Copilot adapter.**
  A) Defer; file separate spec only on demand **(rec)** — keeps this T3 small; cost: third option stays unavailable, and Copilot's API may not support non-interactive review at all (unverified).
  B) Include now — one switch values `wait|payg|copilot`; cost: new provider protocol, auth and data-egress surface, far above this spec's blast radius.
- **DQ-4 — DR needed?** The `aiReview.failover` config namespace is hard to rename once adopters use it. A) Short DR for the key name and precedence **(rec)**; cost: ceremony. B) Spec only; cost: a quasi-permanent schema choice has no rationale record.
- **DQ-5 — Surface for the switch in the shipped CI templates.** `ci-review-templates.ts` embeds generated copies of the workflow; the resolved value must reach adopters' copies too. Confirm templates regenerate via `gen-ci-templates.mjs` and which spec owns the touched files (ownership declaration needed before approval, per SPEC-038).
