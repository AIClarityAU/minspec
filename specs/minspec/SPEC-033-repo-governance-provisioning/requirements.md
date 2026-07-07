---
id: SPEC-033
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry
relates_to: [SPEC-024, SPEC-030]  # SPEC-024 auto-merge gate consumes the `ai-review:pass` label this propagates · SPEC-030 is the init-time non-modal offer pattern this reuses
---

# MinSpec — Repo Governance Provisioning (ai-review + branch protection on init/refresh) — Requirements

**Date:** 2026-07-07
**Status:** Specifying (SDD Specify phase)
**Triggered by:** [#557](https://github.com/AIClarityAU/minspec/issues/557) — "provision repo governance (branch protection + ai-review) on init/refresh — detect & offer to fix."
**Builds on:** [DR-037](../../../docs/decisions/DR-037.md) — the managed-region template mechanism this rides · the ai-review workflow set ([#342](https://github.com/AIClarityAU/minspec/issues/342) / [#428](https://github.com/AIClarityAU/minspec/issues/428) / [#480](https://github.com/AIClarityAU/minspec/issues/480)), propagated **unchanged**, not rewritten.
**Relates:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) — the auto-merge gate that only becomes meaningful once the `ai-review:pass` label it consumes is actually produced on every repo, which today it is not.

> This spec makes MinSpec **propagate its own guardrails to every repo it manages**,
> instead of leaving them on `AIClarityAU/minspec` alone. It has two halves with very
> different risk: (A) **scaffold the ai-review workflow set** — pure files, rides the
> existing refresh channel, self-skips until configured, low risk; (B) **provision branch
> protection** — a GitHub-API *write* against repo admin, higher risk, HITL-gated. The
> **shipped default for (B) — write-vs-advise — and this feature's tier are human-only
> calls**; see *Decisions needed (Clarify)*.

---

## Context

MinSpec's harness propagation already carries **one** CI gate into every managed repo:
`.github/workflows/minspec-validate.yml`, registered as a managed-region template at
[template-registry.ts:937](../../../packages/minspec/src/lib/template-registry.ts#L937).
Init scaffolds it; Refresh keeps it current; a template change fires the drift prompt.
That is why `minspec-validate.yml` is present on `scrooge` and `sealbox` today.

The **ai-review** workflow set — the independent fresh-context reviewer that produces the
`ai-review:pass` / `ai-review:changes` label — is **not** in that list. It exists only on
`AIClarityAU/minspec`. Consequence, observed 2026-07-06 (#557) and reconfirmed 2026-07-07:

- **scrooge** `main`: only `deploy-site.yml` + `minspec-validate.yml`. PR #46 received two
  `MinSpec Validate` checks and **zero** ai-review.
- **sealbox** `main`: identical — only `deploy-site.yml` + `minspec-validate.yml`.

A hand-port exists (scrooge branch `feat/port-ai-review-ci`, commit `cd4b14c`) that copied
the full reviewer harness into scrooge and **proves it runs in a non-monorepo repo** — but
it was never merged, and, more to the point, it was a **manual** port. Nothing in the vsix
detects the gap or fills it.

**Root cause (mechanism + missing gate):** the propagation set
(`MANAGED_REGION_TEMPLATES`, [template-registry.ts:936](../../../packages/minspec/src/lib/template-registry.ts#L936))
includes the validator gate but not the reviewer gate — so init/refresh scaffolds one and
never the other. And there is **no governance-completeness check** that notices a
MinSpec-managed repo is missing ai-review or an unprotected default branch. Same
present-but-asymmetric-coverage class as the [validator-asymmetry](../../../docs/decisions/)
finding: the gate checks the thing it happens to know about and is silent on the omission.

### What exists — do NOT rebuild

| Piece | Where | State |
|---|---|---|
| Managed-region scaffold + refresh (marker-delimited, preserve-outside, skip+warn on deleted markers) | `packages/minspec/src/lib/template-registry.ts` (`MANAGED_REGION_TEMPLATES`, `renderManagedFile`) + `merge-refresh.ts` | built (DR-037, #249) |
| The exact propagation precedent | `template-registry.ts:937` — the `validate-workflow` entry | built — extend this list |
| Drift baseline → "templates updated, refresh?" prompt | `template-registry.ts` `computeTemplateBaseline` (loops `MANAGED_REGION_TEMPLATES`) | built — new entries auto-join |
| ai-review workflow set (self-skips when secretless; `pull_request` not `_target`; base-ref trusted control plane; self-edit guard) | minspec `.github/workflows/{ai-review,ai-review-retry,ready-to-merge}.yml` | built (#342/#428/#480) |
| Reviewer scripts + roles (no-tools `claude -p` over diff-as-untrusted-data; fail-closed decide) | minspec `scripts/{review-branch,review-decide}.sh`, `scripts/roles/{reviewer,security}.md`, `.github/scripts/ai-review-guard.js` | built |
| Proven non-monorepo port (content source) | scrooge branch `feat/port-ai-review-ci` (`cd4b14c`) | hand-ported, unmerged |
| Post-init non-modal "offer to fix" pattern | `packages/minspec/src/commands/init.ts` — `offerScaffoldCommit` / `offerRulesetAdvisory` | built — the UX to follow |
| Activation prerequisites, authoritative list | ai-review.yml `ACTIVATION` header (secrets, App perms, required-check) | built — surface this, don't reinvent |

## Scope

### In scope

- **FR-1 — Scaffold the ai-review harness as managed-region templates.** Add to
  `MANAGED_REGION_TEMPLATES` so **init and refresh** write, into any repo, exactly as they
  do `minspec-validate.yml`: the three workflows (`ai-review.yml`, `ai-review-retry.yml`,
  `ready-to-merge.yml`), `.github/scripts/ai-review-guard.js`, `scripts/review-branch.sh`
  + `scripts/review-decide.sh` (executable), and `scripts/roles/{reviewer,security}.md`.
  Content is **pinned literal, repo-agnostic** (lifted from the proven port), and — by the
  workflow's own guard — **self-skips with a `::notice … NOT a failure`** when the
  activation secrets are absent. Result: ai-review *triggers on every PR* in the repo the
  moment the files land; it *acts* once configured (FR-4).
- **FR-2 — Governance detection + offer.** A `MinSpec: Check Repo Governance` command, and
  a passive check on project open (mirroring init auto-bootstrap), that reports, per repo:
  (a) ai-review workflow set present & current vs missing/stale; (b) default branch
  protected (force-push/deletion blocked, PR required, `ai-review` a required check) vs not.
  Findings surface as a **non-modal** offer to fix, never a focus-stealing modal
  ([HITL approval UX](../../../docs/decisions/)).
- **FR-3 — Branch-protection provisioning (HITL, idempotent).** Offer to set on the default
  branch: block force-push + deletion, require a PR, require the `ai-review` verdict check.
  Applied via `gh api` **only** when an authenticated `gh`/token with repo-admin is
  available and the user confirms; otherwise **downgrade to advisory** — surface the exact
  `gh`/GitHub-UI steps and change nothing. Re-running is a no-op when already satisfied.
- **FR-4 — Surface the prerequisites the vsix cannot do headlessly.** Present the ai-review
  `ACTIVATION` checklist as explicit, **unchecked** items (never reported as done):
  `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`); `MINSPEC_APP_ID` +
  `MINSPEC_APP_PRIVATE_KEY` (raw PEM); the `minspec-sdd[bot]` App installed with
  `pull-requests: write` + `issues: write` + `checks: write`; repo variable
  `AI_REVIEW_LABEL_ACTORS = minspec-sdd[bot]`; and marking the `ai-review` check required
  (#480). Deep-link `claude setup-token` and the App install page where possible.
- **FR-5 — Idempotent + drift-managed.** Init/refresh any number of times ⇒ one copy of
  each file, no marker duplication; refresh keeps the MinSpec-owned region current and
  preserves user content outside the markers; deleted markers ⇒ skip + warn, never clobber
  (the existing managed-region contract, inherited for free).

### Out of scope (explicitly)

- **The reviewer's internal logic / workflow security model** — already built and reviewed
  (#342/#428/#480). This spec **propagates** it; it does not modify the reviewer.
- **Installing the GitHub App or writing repo secrets headlessly** — infeasible (App
  install is a web-OAuth flow; secret values are not the extension's to hold). Surfaced
  (FR-4), never faked.
- **Fork-PR enforcement** — fork PRs get empty secrets, so the workflow skips cleanly. That
  is documented behaviour, not a gap this spec closes.
- **Running agent BUILD/dispatch in CI** — that is [#542](https://github.com/AIClarityAU/minspec/issues/542) (a distinct explore); ai-review-in-CI is toolless and does not share its risk profile.

## Invariants (T0 — write these tests before implementation)

- **INV-1 — Never-wrong self-skip.** Scaffolding the workflow into a repo with **no**
  activation secrets never reds a PR; it emits the skip notice. (The load-bearing safety
  property that makes "scaffold everywhere" acceptable.)
- **INV-2 — Idempotent.** N runs of init/refresh ⇒ exactly one of each file, zero marker
  duplication.
- **INV-3 — No clobber.** User content outside the managed markers survives refresh;
  deleted/absent markers ⇒ skip + warn, not overwrite.
- **INV-4 — Private-repo safe.** The propagated workflow introduces **no new** secret-exfil
  surface: `pull_request` (not `pull_request_target`), base-ref trusted control plane, and
  the self-edit guard all travel with it. (Propagation must not weaken the model that made
  it safe on minspec.)
- **INV-5 — Headless honesty.** The vsix never marks a step done that it did not perform
  (App install, secrets). Those render as an explicit unchecked checklist. (Evidence
  discipline / never-wrong — a false "provisioned" is the worst defect.)
- **INV-6 — Branch-protection is HITL + fail-safe.** No protection write without explicit
  confirm; idempotent; no admin token ⇒ advisory only, never a silent partial write.
- **INV-7 — Keyboard-reachable.** The governance check + fix action have a keyboard path and
  show their keybinding (global input-modality preference).

## Decisions needed (Clarify — human-only)

- **D-1 — Tier: T3 or T4?** Half (A) is T3-shaped (files + one command). Half (B) adds a
  GitHub-API **write** with a repo-admin credential — a new external-integration boundary
  that arguably makes the feature T4 and warrants a security review of the protection-write
  path. *Recommendation:* keep (A) T3; treat (B) as its own security-reviewed slice.
- **D-2 — Branch protection: ever write, or advise-only?** Does the extension actually call
  `gh api` to set protection (needs admin), or does it **only** ever surface the steps? This
  is an authority question, not just UX. *Recommendation:* advise-only by default; opt-in
  write behind explicit confirm + present-token check.
- **D-3 — Secret-name convention.** Keep `CLAUDE_CODE_OAUTH_TOKEN` /`MINSPEC_APP_ID` /
  `MINSPEC_APP_PRIVATE_KEY` as a **fixed cross-repo convention** (one `minspec-sdd[bot]` App
  serves all AIClarityAU repos) or parameterize per repo? *Recommendation:* fixed
  convention — matches reality, keeps the template byte-stable.
- **D-4 — The `packages/`-gated security role.** The security role fires only when
  `packages/**` changes (a monorepo-ism). Ship as-is (harmless no-op elsewhere) or
  generalize to a configurable path glob? *Recommendation:* ship as-is now; generalize later
  if a consuming repo needs it.
- **D-5 — Tier-0 positioning.** ai-review runs `claude -p` **in CI**, not in the extension
  runtime. Confirm this is consistent with MinSpec's Tier-0/air-gapped stance
  ([DR-004](../../../docs/decisions/DR-004.md)) — inference lives in the repo's CI, which the
  user owns, not inside the shipped extension.

## Acceptance (feature-level, verified end-to-end)

1. A **fresh repo** with only `.minspec/` scaffolded, after init/refresh, has the full
   ai-review file set committed and ai-review **triggers** on the next PR (skipping cleanly
   with the notice while secrets are absent). [INV-1, FR-1]
2. `MinSpec: Check Repo Governance` on scrooge/sealbox (pre-fix) reports *both* gaps
   (missing ai-review, unprotected/under-required `main`) and offers the fix. [FR-2]
3. Accepting the fix scaffolds the files (half A) and either writes protection (D-2 opt-in)
   or prints the exact steps (default), plus the FR-4 prerequisite checklist. [FR-3, FR-4]
4. Re-running the command is a clean no-op; a user edit outside the markers survives; a
   deleted marker warns rather than clobbers. [INV-2, INV-3, FR-5]

## Follow-ups (tracked — DR-023)

- **Dogfood PRs** into `scrooge` and `sealbox`, produced by running the shipped vsix's
  refresh/governance command (not hand-applied), each superseding scrooge's stale
  `feat/port-ai-review-ci` branch — track under #557.
- **Retire** `scrooge:feat/port-ai-review-ci` once the vsix-scaffolded set lands.
- **A DR** for "which governance bits the vsix auto-writes vs surfaces" — file if Clarify
  (D-1/D-2) lands on ever writing branch protection from the extension.
