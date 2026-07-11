---
id: SPEC-034
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals.json[SPEC-034].specHash. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness
aspects: [reviewer, provenance, github-app, oidc, broker, tier-2, team]
depends_on: [DR-054, DR-033, DR-017, DR-004]
relates_to: [SPEC-031, SPEC-033, DR-047, DR-050]
phases:
  specify: done          # requirements drafted 2026-07-11
  clarify: in-progress   # OQ-1/2/3 pre-resolved 2026-07-11 (Paul Harvey); OQ-4/5/6 open before Plan (T4 → Clarify mandatory)
  plan: not-started
  tasks: not-started
  implement: not-started
---

# MinSpec — OIDC Review Token-Broker (shared reviewer App identity for GitHub-native review)

> **The Tier-2 credential seam of [DR-054](../../../docs/decisions/DR-054.md).** A
> vendor-operated, stateless service that exchanges a GitHub Actions **OIDC** token for a
> **short-lived, repo-scoped** installation token for the shared `minspec-sdd` GitHub App,
> so a reviewer running in the customer's own CI can post its verdict **as
> `minspec-sdd[bot]`** without ever holding the App's private key. A sibling of
> [DR-017](../../../docs/decisions/DR-017.md)'s host-side **model-access** broker — same
> shape (credential-free client → broker injects the real credential), different credential
> (a GitHub App token, not a model token). **Nothing in this spec is built** — this is the
> Specify-phase requirements record; every capability below is *specified, not built*.

**Date:** 2026-07-11
**Decision:** [DR-054](../../../docs/decisions/DR-054.md) (reviewer identity + broker) · provenance model [DR-033](../../../docs/decisions/DR-033.md) §6 · broker pattern [DR-017](../../../docs/decisions/DR-017.md) · tiering [DR-004](../../../docs/decisions/DR-004.md)
**Epic:** [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md)

**Tier — T4.** Security-critical, load-bearing, near-irreversible once team repos
authenticate through it (DR-054 §Costly to Refactor). It holds the shared App private key —
a compromise is a forge-`ai-review:pass`-everywhere event. Clarify is **mandatory**: the
open questions below (does the reviewer need a GH-native *approval* vs a label; the abuse
model; audit retention; the enterprise-override wiring) gate the Plan.

---

## Context

To get the review history the team tier promises — human activity under the human's name,
MinSpec's under `minspec-sdd[bot]`, in a readable GitHub timeline — the reviewer must post
its verdict **as a distinct bot identity** ([#464](https://github.com/AIClarityAU/minspec/issues/464):
a human-run reviewer cannot even GH-natively approve its author's PR;
[DR-033](../../../docs/decisions/DR-033.md) §6 / #428: a label from a human is
indistinguishable from a real review, so only a bot-applied label can gate auto-merge).

Per [DR-054](../../../docs/decisions/DR-054.md) §4 the bot identity is **one shared,
published GitHub App** (`minspec-sdd`), installed by the customer. Posting *as* that App from
customer CI requires an **installation token**, which is minted from the App's **private
key**. The key cannot live in customer repos (a shared, extractable secret → forge on every
install → provenance collapse — rejected in DR-054 §Alternatives). GitHub Actions **OIDC**
solves exactly this: the customer's workflow presents a signed, short-lived identity token
proving *which repo/workflow is asking*, and a broker that holds the key returns a scoped
installation token. This spec defines that broker and the CI contract that consumes it.

**Boundary:** this broker brokers a **GitHub identity token only**. The **model** the
reviewer calls is a separate, Tier-1, user-chosen credential (subscription / API / local
endpoint — DR-054 §2) and is **out of scope** here; do not conflate it with
[DR-017](../../../docs/decisions/DR-017.md)'s model-access broker.

## Contracts (Specify-phase sketch — firm up in Plan)

Token-exchange request (customer CI → broker):

```
POST /installation-token
Authorization: Bearer <github_actions_oidc_jwt>   # aud = broker's configured audience
Body: { "repository": "<owner>/<repo>", "permissions_profile": "review" }
```

Response (broker → customer CI):

```
200 { "token": "<ghs_… short-lived installation token>",
      "expires_at": "<ISO-8601, ≤ requested TTL>",
      "permissions": { "issues": "write", "pull_requests": "write",
                       "checks": "write", "statuses": "write" },
      "repositories": ["<owner>/<repo>"] }        # single-repo scoped
4xx  { "error": "<machine code>", "reason": "<human string>" }   # fail-closed; no token
```

The `review` permissions profile is the **least-privilege** set the reviewer needs: apply
`ai-review:*` labels (issues:write), post the review comment / GH-native review
(pull_requests:write), and set the `ai-review` / `ready-to-merge` checks (checks:write +
statuses:write). No `contents:write`, no admin, no org scope.

## Functional Requirements

- **FR-1 — OIDC verification.** The broker MUST verify the presented token's signature
  against GitHub's OIDC JWKS (`https://token.actions.githubusercontent.com/.well-known/jwks`),
  and validate `iss`, `aud` (its own configured audience), and expiry. An invalid/expired/
  wrong-audience token → 401, no installation token.
- **FR-2 — Claim-scoped minting.** The broker MUST mint the installation token **only** for
  the repository named in the OIDC claims (`repository` / `repository_owner`), never a
  caller-supplied repo that disagrees with the claims. The request body `repository` is a
  cross-check, not the source of truth; a mismatch → 403.
- **FR-3 — Least-privilege, single-repo, short-lived.** The minted token MUST be scoped to
  the one repository and to the `review` permissions profile above, with a TTL no longer than
  needed (target ≤10 min; GitHub's ceiling is 1h). Never an org-wide or multi-repo token.
- **FR-4 — App-installation precondition.** The broker MUST resolve the `minspec-sdd` App's
  installation on the target repo and mint against that installation. If the App is not
  installed on the repo → 403 with a reason that tells the customer to install/grant the App
  (the one-click "grant access to `minspec-sdd[bot]`" step).
- **FR-5 — Private key custody.** The App private key MUST exist **only** in the broker's
  secret store (e.g. a Cloudflare Worker secret), never in any customer repo, workflow,
  client, or the vsix. The vsix/harness ships only the **public** App slug/id and the broker
  URL.
- **FR-6 — Statelessness / no artifact custody.** The broker MUST NOT receive, store, or
  proxy any user code, diff, spec text, or prompt. Its only inputs are the OIDC JWT and the
  repo identifier; its only output is a scoped token. (This is what keeps the broker outside
  the data-sovereignty surface — DR-054 §2 Tier-2 "code and prompts do not flow through the
  broker.")
- **FR-7 — CI-side contract (the consuming workflow).** The ai-review workflow MUST: request
  a GitHub OIDC token (`permissions: id-token: write`) with the broker audience; call the
  broker; use the returned token to apply `ai-review:*` labels + post the verdict as
  `minspec-sdd[bot]`. The workflow that *runs the guard* stays pinned to the trusted base
  (unchanged from `ready-to-merge.yml`'s self-forge defence).
- **FR-8 — Provenance closure with the existing guard.** A label applied via a
  broker-minted token has `sender = minspec-sdd[bot]`, satisfying the
  `AI_REVIEW_BOT_LOGINS` allowlist ([DR-033](../../../docs/decisions/DR-033.md) §6 /
  `ai-review-guard.js`), so `ready-to-merge` goes green **only** on a real,
  bot-posted verdict. A human hand-applying the label is still their own login → reverted.
  This spec MUST NOT weaken that guard; it feeds it a trustworthy applier.
- **FR-9 — Fail-closed everywhere.** Broker unreachable, rate-limited, deny, or any error →
  the workflow gets **no** token → it cannot post `ai-review:pass` → `ready-to-merge` stays
  red. A broker outage blocks merges (safe), never green-lights them. No fallback path may
  post a pass without a broker-minted (or enterprise-override) token.
- **FR-10 — Enterprise override (customer-own-app).** A customer running their own App / GHES
  MUST be able to bypass the vendor broker entirely: configure their own `app-id` + private
  key (as their repo/org secret, via GitHub's native app-token action) and set
  `AI_REVIEW_BOT_LOGINS` to their bot login. The workflow MUST read the reviewer identity from
  config, never a hardcoded `minspec-sdd[bot]`, so the override is a config change, not a fork
  (DR-054 §4).
- **FR-11 — Default shipped identity.** For the common path, the harness/CI scaffold MUST
  ship `minspec-sdd[bot]` as the default reviewer allowlist and the broker URL as the default
  token source, so a fresh repo works with only the App-install grant — no per-repo variable
  (resolves #597).

## Security & Non-Functional Requirements

- **NFR-1 — Audit without content.** The broker SHOULD log token issuance (repo, timestamp,
  granted scope, requesting workflow ref) for abuse investigation, and MUST NOT log any user
  artifact content. Define a retention window (OQ-5).
- **NFR-2 — Abuse / DoS resistance.** The broker MUST rate-limit per repo/org and reject
  malformed or replayed OIDC tokens. Define whether *any* repo with the App installed may
  request a token, or an explicit allowlist/policy gates it (OQ-2).
- **NFR-3 — SLO.** Because the broker gates team-tier merges (FR-9), it MUST have a stated
  availability SLO and a status signal; degradation surfaces as "merge blocked: reviewer
  identity unavailable," never a silent green.
- **NFR-4 — Own security review.** As a key-custody service, the broker MUST clear an
  independent security review before any customer repo authenticates through it (mirrors the
  attestation discipline of [DR-017](../../../docs/decisions/DR-017.md)).
- **NFR-5 — Key rotation.** The App private key MUST be rotatable without customer action
  (customers hold nothing); document the rotation runbook.

## Out of Scope

- **Model access / which LLM the reviewer calls** — Tier-1, user-chosen (DR-054 §2); that is
  [DR-017](../../../docs/decisions/DR-017.md)'s separate broker + #74. This broker never sees
  model traffic.
- **The reviewer's prompt/verdict logic** — SPEC-031 (reviewer-all-approvables).
- **Branch-protection / ruleset provisioning on init** — SPEC-033 (#557); this spec assumes
  the `ready-to-merge` / `ai-review` checks exist and are required.
- **The solo/local path** — review under the user's own `gh` + `approvals.json`
  ([DR-050](../../../docs/decisions/DR-050.md)); it needs no bot and no broker.

## Open Questions

**OQ-1/2/3 pre-resolved 2026-07-11 (Paul Harvey); OQ-4/5/6 remain and gate the Plan.**

- **OQ-1 — Label+status vs GH-native approval. → RESOLVED: GH-native "Approved" is the
  primary target.** The bot posts a GitHub-native *Approved* review (needs pull_requests:write
  + the non-author bot identity — [#464](https://github.com/AIClarityAU/minspec/issues/464));
  the `ai-review:pass` label + `ready-to-merge` status remain as the fallback the guard already
  trusts. Founder leans GH-native, open either way — so build the label+status path (already
  specified) and add the GH-native approval on top; do not drop the label path. The `review`
  permission profile already carries pull_requests:write, so no scope change.
- **OQ-2 — Who may request a token? → RESOLVED: any repo with the App installed.** Zero
  onboarding friction — everyone who installs the App can mint a scoped token. Abuse
  monitoring (revoke on non-usage / abuse patterns) is a **later, optional** layer, **not** a
  v1 gate; parked at [#639](https://github.com/AIClarityAU/minspec/issues/639). Fail-closed
  provenance (FR-8/9) + short-lived single-repo tokens (FR-3) bound the v1 risk without it.
- **OQ-3 — Deployment substrate. → RESOLVED: Cloudflare Worker.** Fits the existing
  wrangler/CF stack; verifies the OIDC JWT against GitHub's JWKS via WebCrypto (RS256), holds
  the App private key as an encrypted Worker secret, signs the App JWT and mints the scoped
  installation token — all stateless. Storage (KV/D1/Durable Objects) is needed **only** if
  the parked abuse-tracking (#639) is later built; the base broker needs none. Confirm the CF
  free tier meets the SLO (NFR-3) in Plan.
- **OQ-4 — Enterprise override mechanics.** Does the override use GitHub's native
  `create-github-app-token` action with the customer's own app-id/key (no vendor code at
  all), or a customer-hosted copy of this broker? Pick the one that needs the least MinSpec
  code to support (FR-10).
- **OQ-5 — Audit retention & privacy.** What exactly is logged, for how long, under what
  privacy policy (Tier-2 requires one — DR-004)? (NFR-1.)
- **OQ-6 — Reviewer-in-CI credential for the model.** Track B (#342) runs the reviewer in CI;
  its *model* credential (CLAUDE_CODE_OAUTH_TOKEN / API key / local endpoint) is separate from
  this broker but must be specified somewhere — confirm it is #74/SPEC-031's job, not this
  spec's, and that the two seams never cross.

## Risks & Mitigations

| Risk | Mechanism / anchor | Mitigation |
|---|---|---|
| Broker mints a token for the wrong repo (confused-deputy) | Caller supplies a `repository` that disagrees with the OIDC claims | FR-2: mint strictly from verified claims; body repo is a cross-check; mismatch → 403. |
| Shared App key compromise = forge everywhere | Broker holds the one key for all installs | FR-5 custody + NFR-4 security review + NFR-5 rotation; short-lived single-repo tokens (FR-3) cap per-issuance blast radius; guard still fails closed (FR-8/9). |
| Broker outage silently degrades to an insecure path | A tempting "fallback" that posts a pass without the broker | FR-9: there is **no** pass-posting path without a broker-minted or enterprise-override token; outage = red gate, never green. |
| OIDC token replay / forgery | A leaked JWT reused to mint tokens | FR-1 signature+aud+expiry validation against GitHub JWKS; NFR-2 replay rejection + rate-limit; JWTs are short-lived and audience-bound. |
| Data-sovereignty claim undermined by the broker | Customers fear "MinSpec sees our code" | FR-6: the broker receives only an OIDC JWT + repo id, never artifacts; state this explicitly in the Tier-2 privacy copy (DR-054 §2). |
| Enterprise override untested → rots | Default is the shared App; override gets no dogfood | FR-10 config-driven identity + a contract test asserting the workflow reads an overridden identity, not a hardcoded bot (DR-054 Risk row). |
