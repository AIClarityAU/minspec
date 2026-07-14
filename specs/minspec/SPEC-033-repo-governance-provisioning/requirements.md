---
id: SPEC-033
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry
relates_to: [SPEC-024, SPEC-030, SPEC-034]  # SPEC-024 auto-merge gate consumes the `ai-review:pass` label this propagates · SPEC-030 is the init-time non-modal offer pattern this reuses · SPEC-034 (OIDC broker, not yet shipped) will shrink FR-4's checklist once live
---

# MinSpec — Repo Governance Provisioning (ai-review + branch protection on init/refresh) — Requirements

**Date:** 2026-07-07
**Status:** Implementing
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

- **scrooge** `main`: now carries the full ai-review set (landed via harness-refresh
  PR #57) — no longer a live example of the gap.
- **sealbox** `main`: still only `deploy-site.yml` + `minspec-validate.yml` — the sole
  accurate pre-fix example.

A hand-port exists (scrooge branch `feat/port-ai-review-ci`, commit `cd4b14c`) that copied
the full reviewer harness into scrooge and **proves it runs in a non-monorepo repo** — but
it was never merged, and, more to the point, it was a **manual** port. Nothing in the vsix
detects the gap or fills it.

**Reconfirmed 2026-07-12 (dogfood-gap follow-up):** the same asymmetry extends past the
reviewer gate. `MANAGED_REGION_TEMPLATES` (via `CI_REVIEW_STACK_TEMPLATES`, #564) now ships
`ai-review.yml` / `ready-to-merge.yml` / `ai-review-retry.yml` + reviewer scripts/roles — but
`ready-to-merge.yml` has **zero** reference to `auto-merge-gate.ts` or
`MINSPEC_AUTOMERGE_MODE`, and none of `dispatch-issue.sh`, `triage-inbox.sh`,
`drain-inbox.sh`, or `auto-merge-gate.ts` are in the template set at all. So a repo that runs
Init/Refresh today gets the reviewer but no triage, no drain, and no auto-merge decisioning —
the "full automated system" minspec itself runs is still monorepo-only. See FR-6/FR-7 below.

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
  `ACTIVATION` checklist as explicit, **unchecked** items (never reported as done). **This is
  today's (pre-SPEC-034) checklist and is expected to shrink** — see the superseded-by note
  below: `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`); `MINSPEC_APP_ID` +
  `MINSPEC_APP_PRIVATE_KEY` (raw PEM); the `minspec-sdd[bot]` App installed with
  `pull-requests: write` + `issues: write` + `checks: write`; repo variable
  `AI_REVIEW_BOT_LOGINS = minspec-sdd[bot]` (corrected 2026-07-12 — the requirements draft
  had stale the pre-rename `AI_REVIEW_LABEL_ACTORS`, matching a live comment-drift bug found
  and filed the same session, [#666](https://github.com/AIClarityAU/minspec/issues/666));
  and marking the `ai-review` check required (#480). Deep-link `claude setup-token` and the
  App install page where possible.
  > **Superseded-by note (2026-07-12):** [DR-054](../../../docs/decisions/DR-054.md) +
  > [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (status: `implementing`,
  > phases: plan in-progress, tasks/implement pending — **not live yet**, confirmed by
  > reading `ai-review.yml` itself, which still mints via `secrets.MINSPEC_APP_ID` /
  > `secrets.MINSPEC_APP_PRIVATE_KEY` directly, FR-5/FR-11) replace the per-repo
  > `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` PEM-secret model with a **vendor-operated OIDC
  > broker**: the private key lives only in the broker's secret store, never a customer repo,
  > and the default path needs **no per-repo App-credential secret and no
  > `AI_REVIEW_BOT_LOGINS` variable at all** (SPEC-034 FR-5/FR-11 — the shared
  > `minspec-sdd[bot]` identity ships as the default). The only prerequisite left in that
  > world is: grant the App install, and give the workflow `permissions: id-token: write`.
  > `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` become **enterprise-override-only** inputs
  > (SPEC-034 FR-10 — a customer's *own* App, not the shared one). **FR-4's checklist content
  > must track whichever of the two models `ai-review.yml` actually runs at scaffold-time** —
  > read it from the workflow's own ACTIVATION header / a shared constant, never hardcode a
  > duplicate copy of the checklist here that can drift the way the `AI_REVIEW_BOT_LOGINS`
  > rename already did once.
- **FR-5 — Idempotent + drift-managed.** Init/refresh any number of times ⇒ one copy of
  each file, no marker duplication; refresh keeps the MinSpec-owned region current and
  preserves user content outside the markers; deleted markers ⇒ skip + warn, never clobber
  (the existing managed-region contract, inherited for free).
- **FR-6 — Triage/drain/dispatch propagation (added 2026-07-12 — dogfood-gap follow-up).**
  `dispatch-issue.sh`, `triage-inbox.sh`, `drain-inbox.sh` are **not portable today**: each
  hardcodes `REPO="AIClarityAU/minspec"` (confirmed: `dispatch-issue.sh:11`,
  `triage-inbox.sh:16`, `drain-inbox.sh:21`), unlike the ai-review workflows, which derive
  `github.repository` at runtime. Before these join the managed-region template set:
  parameterize `REPO` (resolve from `gh repo view --json nameWithOwner` / the runtime
  workflow context, never a literal string) and extend the `ci-stack-portability` test
  pattern (`template-registry.ts:980`) to cover the new templates. Once parameterized, add
  the three scripts to the managed-region set alongside the dispatch-only roles they load
  (`dev`/`triage` — reconcile against `roles/architect.md`, which the ai-review stack already
  ships for its own panel use, #453). *Decision: same spec, not a new one (D-6).*
- **FR-7 — `auto-merge-gate.ts` propagation, default `consequence-hybrid` (added
  2026-07-12).** Add `scripts/auto-merge-gate.ts` as a managed-region template — confirmed
  portable as-is (zero hardcoded repo refs, unlike FR-6's scripts). Scaffolded repos default
  `MINSPEC_AUTOMERGE_MODE` / `.minspec/config.json`'s `autoMerge.mode` to
  `consequence-hybrid`, matching minspec's own SPEC-030 default — **an explicit, informed
  decision (D-7) taken with SPEC-030/SPEC-024's four safety holes
  ([#489](https://github.com/AIClarityAU/minspec/issues/489),
  [#490](https://github.com/AIClarityAU/minspec/issues/490),
  [#491](https://github.com/AIClarityAU/minspec/issues/491),
  [#466](https://github.com/AIClarityAU/minspec/issues/466)) and two open prerequisite
  backstops ([#91](https://github.com/AIClarityAU/minspec/issues/91),
  [#195](https://github.com/AIClarityAU/minspec/issues/195)) still open** — those gaps now
  apply to every repo this scaffolds into, not just minspec. A per-dev/per-repo override
  (DR-033 #183) always wins over this default (INV-9).
- **FR-8 — Workspace-wide init offer (added 2026-07-12).** When `Initialize SDD Structure`
  runs with a multi-root `*.code-workspace` open, offer (non-modal) to run init on every
  **top-level workspace folder** — the literal `folders` array entries, reusing the existing
  `allWorkspaceFolderPaths`-style enumeration (`resolve-folder.ts`, built for #604) — **never**
  a filesystem recursion for nested `.git` dirs (D-9). Already-scaffolded folders are listed
  in the same offer as "already current," not silently skipped and not re-prompted
  individually.

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
- **INV-8 — No hardcoded-repo scripts ship (FR-6).** Any script added to the managed-region
  set that shells out to `gh`/`git` must resolve its target repo dynamically; a template
  containing a literal `AIClarityAU/minspec` (or any other single repo) string never ships.
  Enforced by extending the `ci-stack-portability` test before FR-6's templates are added.
- **INV-9 — Auto-merge default never overrides an explicit config (FR-7).** `consequence-hybrid`
  is the scaffolded default, but a per-dev/per-repo `autoMerge.mode` already set to `pr-gate`
  always wins — FR-7 introduces no fail-open path that silently upgrades an explicit
  `pr-gate` choice.
- **INV-10 — Workspace-wide offer is declared, not discovered (FR-8).** The offer never
  touches a folder outside the workspace's declared `folders` array; it lists exactly what it
  will touch before running, and running it twice is a no-op for already-current folders
  (inherits FR-5/INV-2).

## Decisions needed (Clarify — human-only)

- **D-1 — Tier: T3 or T4?** Half (A) is T3-shaped (files + one command). Half (B) adds a
  GitHub-API **write** with a repo-admin credential — a new external-integration boundary
  that arguably makes the feature T4 and warrants a security review of the protection-write
  path. *Recommendation:* keep (A) T3; treat (B) as its own security-reviewed slice.
- **D-2 — Branch protection: ever write, or advise-only?** Does the extension actually call
  `gh api` to set protection (needs admin), or does it **only** ever surface the steps? This
  is an authority question, not just UX. *Recommendation:* advise-only by default; opt-in
  write behind explicit confirm + present-token check.
- **D-3 — Secret-name convention. → RESOLVED (2026-07-12) by DR-054/SPEC-034, not by this
  spec.** `CLAUDE_CODE_OAUTH_TOKEN` stays a fixed, per-repo customer secret (Tier-1 model
  credential, DR-054 §2 — untouched by the identity question). The GitHub-identity secrets
  are **not** a "fixed convention repeated per repo" as originally framed here — DR-054
  decided one shared App + OIDC broker instead (SPEC-034), so once that ships,
  `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` stop being something the *default* path asks a
  customer to set at all; they become the **enterprise-override** inputs only (SPEC-034
  FR-10, a customer's own App). Until SPEC-034 actually ships (currently plan-in-progress,
  not implemented — `ai-review.yml` still mints directly from repo secrets today), FR-4 must
  keep surfacing the current PEM-secret checklist as-is; this spec's job is only to make sure
  FR-4 tracks SPEC-034's rollout rather than freezing today's checklist as permanent.
- **D-4 — The `packages/`-gated security role.** The security role fires only when
  `packages/**` changes (a monorepo-ism). Ship as-is (harmless no-op elsewhere) or
  generalize to a configurable path glob? *Recommendation:* ship as-is now; generalize later
  if a consuming repo needs it.
- **D-5 — Tier-0 positioning.** ai-review runs `claude -p` **in CI**, not in the extension
  runtime. Confirm this is consistent with MinSpec's Tier-0/air-gapped stance
  ([DR-004](../../../docs/decisions/DR-004.md)) — inference lives in the repo's CI, which the
  user owns, not inside the shipped extension.
- **D-6 — Triage/drain/dispatch scope-fit. → RESOLVED (2026-07-12, Paul Harvey): new FR-6 in
  this spec**, not a separate spec — same epic (EPIC-009), same "propagate minspec's own
  automation" concern as FR-1. Accepted that this is a bigger lift than FR-1 (a portability
  refactor, not a template copy) — see INV-8.
- **D-7 — Auto-merge default for freshly-provisioned repos. → RESOLVED (2026-07-12, Paul
  Harvey): `consequence-hybrid` by default (FR-7)**, explicitly overriding this session's own
  `pr-gate`-by-default recommendation. **Recorded risk, accepted knowingly:** sealbox and
  scrooge will run live auto-merge under today's known gaps — #489 (signal-1 is
  agent-self-reported, never cross-checked against the real diff), #490 (a subtle code
  change can false-negative to low-blast and auto-merge), #491 (an audit-write failure is
  swallowed, so a wrong auto-merge can be untraceable), #466 (`ai-review:pass` isn't yet
  SHA-bound — TOCTOU), plus #91/#195 (consequence-classifier rescope and the real
  impact-reach index are both still open). Mitigation carried into FR-7/INV-9: a per-repo
  override to `pr-gate` always wins, so this is a default, not a floor. Follow-up: closing
  #489/#490/#491/#466/#91/#195 remains tracked independently (SPEC-024/030); this decision
  does not wait on them.
- **D-8 — Workspace-init target set. → RESOLVED (2026-07-12, Paul Harvey): top-level
  workspace folders only (FR-8)** — the `.code-workspace` file's declared `folders` array,
  not a recursive filesystem scan for nested `.git` dirs. Matches the existing
  `allWorkspaceFolderPaths` primitive (#604); avoids surfacing repos the user never
  consciously added to the workspace.
- **D-9 — Workspace-init spec-fit. → RESOLVED (2026-07-12, Paul Harvey): folded into
  SPEC-033 as FR-8**, not a separate spec — still "provisioning governance across every
  managed repo," just widening *which folders* get offered rather than *what* gets
  provisioned.

## Acceptance (feature-level, verified end-to-end)

1. A **fresh repo** with only `.minspec/` scaffolded, after init/refresh, has the full
   ai-review file set committed and ai-review **triggers** on the next PR (skipping cleanly
   with the notice while secrets are absent). [INV-1, FR-1]
2. `MinSpec: Check Repo Governance` on sealbox (pre-fix) reports *both* gaps
   (missing ai-review, unprotected/under-required `main`) and offers the fix. [FR-2]
3. Accepting the fix scaffolds the files (half A) and either writes protection (D-2 opt-in)
   or prints the exact steps (default), plus the FR-4 prerequisite checklist. [FR-3, FR-4]
4. Re-running the command is a clean no-op; a user edit outside the markers survives; a
   deleted marker warns rather than clobbers. [INV-2, INV-3, FR-5]
5. After the FR-6 portability refactor, `dispatch-issue.sh`/`triage-inbox.sh`/`drain-inbox.sh`
   scaffolded into scrooge/sealbox resolve their own repo at runtime — a portability test
   (extending `ci-stack-portability`) asserts no template contains a literal
   `AIClarityAU/minspec` string. [INV-8, FR-6]
6. A freshly-scaffolded repo's `.minspec/config.json` has `autoMerge.mode: consequence-hybrid`
   by default; setting it to `pr-gate` before/after scaffold is never overwritten by a
   re-init/refresh. [INV-9, FR-7]
7. Running `Initialize SDD Structure` with a `*.code-workspace` open (e.g.
   `mmo.code-workspace`) offers every top-level workspace folder, marks already-scaffolded
   ones as current, and touches no folder outside the declared `folders` array. [INV-10, FR-8]

## Follow-ups (tracked — DR-023)

- **Dogfood PRs** into `scrooge` and `sealbox`, produced by running the shipped vsix's
  refresh/governance command (not hand-applied), each superseding scrooge's stale
  `feat/port-ai-review-ci` branch — track under #557.
- **Retire** `scrooge:feat/port-ai-review-ci` once the vsix-scaffolded set lands.
- **A DR** for "which governance bits the vsix auto-writes vs surfaces" — file if Clarify
  (D-1/D-2) lands on ever writing branch protection from the extension.
- **FR-4's checklist must be re-derived once SPEC-034 ships** (D-3) — do not let this spec's
  copy of the ACTIVATION checklist drift from `ai-review.yml`'s own a second time (#666 was
  the first instance, a plain comment typo; the next one would be a spec-vs-code desync).
- **Track #489/#490/#491/#466/#91/#195 independently** (D-7) — FR-7 ships `consequence-hybrid`
  as the default now, as an accepted risk, not contingent on those closing; they remain
  SPEC-024/SPEC-030's problem to close, not blockers re-litigated here.
