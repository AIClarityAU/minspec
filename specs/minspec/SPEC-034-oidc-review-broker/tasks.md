---
id: SPEC-034
type: tasks
status: implementing  # tasks authored 2026-07-12; tracks requirements.md + design.md
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness
depends_on: [DR-054, DR-017, DR-033, DR-004]
---

# OIDC Review Token-Broker — Tasks

Tasks phase for [SPEC-034](./requirements.md), realising the five slices in
[design.md](./design.md). Dependency-ordered; each item is completable in one session and
verifiable from **outside** (an HTTP response, a fixture-PR state, a passing test, a repo
scan). **T0 invariant tests (AC-2/5/6/8/9/10) are written before the code they guard.**

## Slice 0 — scaffold + T0 invariant tests (red first)

- [ ] **0.1 Worker scaffold.** `wrangler` + TS project; `POST /installation-token` route stub returns 501. *Verify:* `wrangler dev` answers 501.
- [ ] **0.2 T0 decision-logic tests (failing).** Pure, I/O-free tests for: confused-deputy reject (AC-2), request-shape accepts only `{jwt, repository}` (AC-6), any error ⇒ no token (AC-9), reviewer identity read from config not hardcoded (AC-10). *Verify:* tests exist and are red.
- [ ] **0.3 Key-custody scan test (AC-5).** A test asserts no App private key appears in the vsix, harness output, or CI config — only the public app slug + broker URL. *Verify:* test passes against the repo tree.

## Slice 1 — happy-path seam

- [ ] **1.1 OIDC verify (`jose`).** Verify sig/`iss`/`aud`/`exp` against GitHub JWKS; invalid ⇒ 401 (AC-1, partial). *Verify:* unit test with a bad/expired/wrong-aud JWT → 401.
- [ ] **1.2 Claim-scoped authorisation.** Mint only for the OIDC `repository` claim; body `repository` must match, else 403 (turns AC-2 green). *Verify:* T0 test 0.2 confused-deputy passes.
- [ ] **1.3 Mint scoped token (`@octokit/auth-app`).** One repo, `review` profile, TTL ≤10 min (AC-3). *Verify:* response `repositories`/`permissions`/`expires_at` asserted in an integration test.
- [ ] **1.4 ai-review workflow → apply label as bot (e2e).** Workflow requests OIDC (`id-token: write`), calls broker, applies `ai-review:pass` on a fixture PR (AC-7). *Verify:* fixture PR label event shows `sender = minspec-sdd[bot]`.
- [ ] **1.5 No-artifact-egress contract (AC-6).** Broker ignores/rejects any field beyond `{jwt, repository}`; no code path stores/forwards content. *Verify:* T0 test 0.2 request-shape passes.

## Slice 2 — fail-closed + provenance

- [ ] **2.1 App-not-installed ⇒ 403.** Reason tells the caller to install/grant the App (AC-4). *Verify:* integration test against a repo without the App → 403 + install reason.
- [ ] **2.2 Broker down/deny ⇒ red gate (AC-9).** Workflow gets no token, posts no pass, `ready-to-merge` stays red; no path posts a pass without a broker/override token. *Verify:* workflow test with the broker stubbed to 5xx → no `ai-review:pass`, status red.
- [ ] **2.3 Provenance closure (AC-8).** A broker-token-applied label satisfies `AI_REVIEW_BOT_LOGINS` → `ready-to-merge` green; the same label hand-applied by a human → reverted; `ai-review-guard.js` is unchanged and its tests still pass. *Verify:* guard test suite green + a bot-vs-human applier fixture.

## Slice 3 — GH-native approval

- [ ] **3.1 Post an Approved review (AC-12).** On a passing PR whose author ≠ the bot, the bot posts a GitHub-native *Approved* review in addition to the label + status. *Verify:* fixture PR shows an `APPROVED` review authored by `minspec-sdd[bot]`.

## Slice 4 — enterprise override

- [ ] **4.1 Config-driven native override (AC-10).** When a customer app-id secret + `AI_REVIEW_BOT_LOGINS` are set, the workflow mints via GitHub's native `create-github-app-token` (no vendor-broker call) and posts as the customer bot. *Verify:* contract test asserts identity is read from config (never hardcoded `minspec-sdd[bot]`) and the broker endpoint is not hit on the override path.

## Slice 5 — zero-config default + audit

- [ ] **5.1 Zero-config default (AC-11).** A fresh repo whose only setup is the App-install grant (no per-repo variable) posts a verdict as the default `minspec-sdd[bot]`. *Verify:* fixture repo with only the install → verdict posts.
- [ ] **5.2 Content-free audit (AC-13).** Emit `{repo, timestamp, granted scope, workflow ref, ttl}` to the chosen log sink (CF Logpush vs Workers Analytics Engine — decide here); ≤30-day retention; no artifact content. *Verify:* audit-record test asserts the exact field set and rejects any content field.

## Ops / gates before GA (not code slices, but blocking)

- [ ] **6.1 CF free-tier vs SLO (NFR-3).** Confirm the free tier meets the availability SLO; wire the status signal so degradation reads "reviewer identity unavailable," never a silent green.
- [ ] **6.2 Broker security review + key rotation (NFR-4/5).** Independent security review before any customer repo authenticates; document the private-key rotation runbook.
- [ ] **6.3 Tier-2 privacy policy (DR-004 / OQ-5).** Publish the policy covering the audit log before the path ships.
