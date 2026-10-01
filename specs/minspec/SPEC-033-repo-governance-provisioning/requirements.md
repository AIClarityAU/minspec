---
id: SPEC-033
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry
relates_to: [SPEC-024, SPEC-030, SPEC-034, SPEC-063, DR-058, DR-061]  # SPEC-024 auto-merge gate consumes the `ai-review:pass` label this propagates · SPEC-030 is the init-time non-modal offer pattern this reuses · SPEC-034 (OIDC broker, not yet shipped) will shrink FR-4's checklist once live · SPEC-063 (clean uninstall) mirrors this spec's inventory and must stay in lockstep · DR-058 + DR-061 are the two auto-merge decisions FR-7 now rests on
---

# MinSpec — Repo Governance Provisioning (ai-review + branch protection on init/refresh) — Requirements

> **Revision 2026-10-01 — [#703](https://github.com/AIClarityAU/minspec/issues/703) re-check. Read this first.**
> The five refinements #703 asks for were **already applied** to this file on 2026-07-14
> (commit `fffae66e`) and the result was approved on 2026-08-07 (#1367). This revision does
> not re-apply them. It checks each one against the code and the decision register as they
> stand at commit `8bfc5cc5`, and corrects the places where the approved text had become
> false. **Editing the body voids the 2026-08-07 approval**, so `status` is back to
> `specifying` and the spec needs one fresh read.
>
> | #703 refinement | Where it lives | State at `8bfc5cc5` |
> |---|---|---|
> | 1 — auto-merge scaffold default `pr-gate`, flip when the merge-holes close | FR-7, INV-9, D-7, AC-6 | Applied, but **three of its premises are now false** — rewritten here; the flip is put back to the founder as **D-11** |
> | 2 — one state-detecting Initialize / Refresh command | FR-9, INV-11, D-10, AC-8 | Applied and still wanted (not built — two palette entries remain). Rationale and line anchors corrected |
> | 3 — list folders by name; no second toast for nested repos | FR-8, INV-10, AC-7 | Applied and still wanted (not built). One wrong symbol name corrected |
> | 4 — `gh api` is the GitHub API; keep it, hold no token | FR-3 clarify note | Applied and **verified true** against `ruleset-advisor.ts`. Anchors added, no change of meaning |
> | 5 — OIDC (SPEC-034) supersede note; `AI_REVIEW_BOT_LOGINS` | FR-4, D-3 | Applied. SPEC-034's status was misquoted and the permission list had drifted — both corrected |
>
> It also carries out the three corrections a 2026-08-05 drift audit (#1271) left as a
> banner on this file: the expired flip condition (now D-11), the untestable AC-2 (rewritten
> against a fixture), and the rotted line citations (re-anchored — every `file:line` below
> names a **symbol** first and gives the line only as it stood at `8bfc5cc5`, because a
> line number alone rots silently; the line-level reference gap is #1252).
>
> **What a reader should check:** D-11 (the one open human decision), the rewritten FR-7 /
> INV-9 / AC-6, and the rewritten AC-2. Everything else is an anchor or wording correction.
>
> Note on protection reads: verify `main` protection via
> `repos/{owner}/{repo}/rules/branches/main` (rulesets). This org uses rulesets, not classic
> branch protection, so a 404 from `/branches/main/protection` is **not** evidence of an
> unprotected branch.

**Date:** 2026-07-07 (clarify refinements applied 2026-07-14; re-checked and corrected 2026-10-01 — both [#703](https://github.com/AIClarityAU/minspec/issues/703))
**Status:** Specifying (the 2026-08-07 approval, #1367, was against the pre-correction bytes; one open decision, D-11)
**Triggered by:** [#557](https://github.com/AIClarityAU/minspec/issues/557) — "provision repo governance (branch protection + ai-review) on init/refresh — detect & offer to fix."
**Builds on:** [DR-037](../../../docs/decisions/DR-037.md) — the managed-region template mechanism this rides · [DR-050](../../../docs/decisions/DR-050.md) — shelling the user's own `gh` on consent (FR-3) · [DR-058](../../../docs/decisions/DR-058.md) + [DR-061](../../../docs/decisions/DR-061.md) — the two auto-merge decisions FR-7 rests on · the ai-review workflow set ([#342](https://github.com/AIClarityAU/minspec/issues/342) / [#428](https://github.com/AIClarityAU/minspec/issues/428) / [#480](https://github.com/AIClarityAU/minspec/issues/480)), propagated **unchanged**, not rewritten.
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
`.github/workflows/minspec-validate.yml`, registered as the `validate-workflow` entry of
`MANAGED_REGION_TEMPLATES` in
[template-registry.ts](../../../packages/minspec/src/lib/template-registry.ts) (`:2614`).
Init scaffolds it; Refresh keeps it current; a template change fires the drift prompt.
That is why `minspec-validate.yml` is present on `scrooge` and `sealbox` today.

The **ai-review** workflow set — the independent fresh-context reviewer that produces the
`ai-review:pass` / `ai-review:changes` label — is **not** in that list. It exists only on
`AIClarityAU/minspec`. Consequence, observed 2026-07-06 (#557) and reconfirmed 2026-07-07:

- **scrooge** `main`: now carries the full ai-review set (landed via harness-refresh
  PR #57) — no longer a live example of the gap.
- **sealbox** `main`: was the last pre-fix example (only `deploy-site.yml` +
  `minspec-validate.yml`) when this was written. The 2026-08-05 drift audit (#1271) recorded
  that it now carries the ai-review set and a `required_status_checks` ruleset on `main` —
  not re-checked in this revision, which had no network access. Either way **no live repo
  is a usable example of the gap any more**, which is why AC-2 now uses a fixture.

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
(`MANAGED_REGION_TEMPLATES`, `template-registry.ts:2612`) included the validator gate but
not the reviewer gate — so init/refresh scaffolded one and never the other. (The reviewer
half has since landed: `CI_REVIEW_STACK_TEMPLATES`, `template-registry.ts:2429`, spread
into the set at `:2643` — #564. The triage/drain/auto-merge half — FR-6/FR-7 — has not.) And there is **no governance-completeness check** that notices a
MinSpec-managed repo is missing ai-review or an unprotected default branch. Same
present-but-asymmetric-coverage class as the [validator-asymmetry](../../../docs/decisions/)
finding: the gate checks the thing it happens to know about and is silent on the omission.

### What exists — do NOT rebuild

| Piece | Where | State |
|---|---|---|
| Managed-region scaffold + refresh (marker-delimited, preserve-outside, skip+warn on deleted markers) | `packages/minspec/src/lib/template-registry.ts` (`MANAGED_REGION_TEMPLATES`, `renderManagedFile`) + `merge-refresh.ts` | built (DR-037, #249) |
| The exact propagation precedent | `template-registry.ts` — the `validate-workflow` entry (`:2614`) | built — extend this list |
| The reviewer stack as managed-region templates (FR-1) | `template-registry.ts` `CI_REVIEW_STACK_TEMPLATES` (`:2429`); portability suite `packages/minspec/tests/managed-region-templates.test.ts` (`#564 CI-review stack — portability`, `:387`) | built (#564) — FR-6/FR-7 extend this |
| Ruleset detect (autonomous read) + create/update (consent-gated write) | `packages/minspec/src/lib/ruleset-advisor.ts` — `hasRequiredChecksRuleset` (`:216`), `createRequiredChecksRuleset` (`:523`), `updateRulesetRequiredChecks` (`:819`) | built (DR-050 + its 2026-07-01 / 2026-07-16 amendments) |
| Auto-merge, consequence gate — env-only switch, deny-by-default | `scripts/auto-merge-gate.ts` `resolveMode` (`:79`); sole caller `scripts/dispatch-issue.sh:1881`; switch read at `dispatch-issue.sh:1863` | built in this monorepo only; **not portable** (see FR-7) |
| Auto-merge, GitHub-native — config-backed switch, default off | `scripts/dispatch-issue.sh` `native_automerge_enabled` (`:77`), reading `.minspec/config.json` `autoMerge.native` | built ([DR-061](../../../docs/decisions/DR-061.md)); on for this repo only |
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
  > **Clarify note (#703): `gh api` IS the GitHub REST API.** The extension already uses it
  > — verified 2026-10-01 in `packages/minspec/src/lib/ruleset-advisor.ts`:
  > `hasRequiredChecksRuleset` (`:216`) is a `gh api .../rulesets` GET that runs autonomously,
  > and `createRequiredChecksRuleset` (`:523`) is the `gh api -X POST .../rulesets` write that
  > fires only on the user's explicit click (the file's header, `:17-48`, states the split and
  > cites [DR-050](../../../docs/decisions/DR-050.md)). The
  > relaxed network invariant ([DR-054](../../../docs/decisions/DR-054.md) — data-sovereignty,
  > not air-gap) removes the "no network" objection but does **not** argue for a direct
  > `octokit`/`fetch`+token client: that would make the extension **hold a credential**,
  > reintroducing the token-custody surface DR-054/DR-050 deliberately keep out ("MinSpec
  > holds no token, initiates no egress"). Keep `gh api` — it is credential-free (gh owns
  > auth, the hop is user-initiated). Its one gap, "`gh` not installed / not authed",
  > downgrades to the FR-3 advisory path, **never** a stored PAT.
- **FR-4 — Surface the prerequisites the vsix cannot do headlessly.** Present the ai-review
  `ACTIVATION` checklist as explicit, **unchecked** items (never reported as done). **This is
  today's (pre-SPEC-034) checklist and is expected to shrink** — see the superseded-by note
  below: `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`); `MINSPEC_APP_ID` +
  `MINSPEC_APP_PRIVATE_KEY` (raw PEM); the `minspec-sdd[bot]` App installed with
  `pull-requests: write` + `issues: write` + `checks: write` + `statuses: write` (the fourth
  was added to the workflow's header for #466 after this list was first written — the list
  here had drifted, which is the exact failure the note below warns about); repo variable
  `AI_REVIEW_BOT_LOGINS = minspec-sdd[bot]` (corrected 2026-07-12 — the requirements draft
  had stale the pre-rename `AI_REVIEW_LABEL_ACTORS`, matching a live comment-drift bug found
  and filed the same session, [#666](https://github.com/AIClarityAU/minspec/issues/666));
  and marking the `ai-review` check required (#480). Deep-link `claude setup-token` and the
  App install page where possible.
  > **Superseded-by note (2026-07-12):** [DR-054](../../../docs/decisions/DR-054.md) +
  > [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (frontmatter `status: planning`
  > at `8bfc5cc5` — an earlier draft of this note misquoted it as `implementing` — and **not
  > live**: `.github/workflows/ai-review.yml` still mints via `secrets.MINSPEC_APP_ID` /
  > `secrets.MINSPEC_APP_PRIVATE_KEY` directly, `:176-177` and `:194-195`) replace the per-repo
  > `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` PEM-secret model with a **vendor-operated OIDC
  > broker**: the private key lives only in the broker's secret store, never a customer repo,
  > and the default path needs **no per-repo App-credential secret and no
  > `AI_REVIEW_BOT_LOGINS` variable at all** (SPEC-034 FR-5/FR-11 — the shared
  > `minspec-sdd[bot]` identity ships as the default). The only prerequisite left in that
  > world is: grant the App install, and give the workflow `permissions: id-token: write`.
  > `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` become **enterprise-override-only** inputs
  > (SPEC-034 FR-10 — a customer's *own* App, not the shared one). **FR-4's checklist content
  > must track whichever of the two models `ai-review.yml` actually runs at scaffold-time** —
  > read it from the workflow's own ACTIVATION header (`ai-review.yml:100`) / a shared
  > constant, never hardcode a duplicate copy of the checklist that can drift. It has now
  > drifted twice in this very spec (the `AI_REVIEW_BOT_LOGINS` rename, then the missing
  > `statuses: write`), so the list in FR-4 above is **illustrative of today's header, not
  > the contract** — the contract is "render what the scaffolded workflow's header says".
- **FR-5 — Idempotent + drift-managed.** Init/refresh any number of times ⇒ one copy of
  each file, no marker duplication; refresh keeps the MinSpec-owned region current and
  preserves user content outside the markers; deleted markers ⇒ skip + warn, never clobber
  (the existing managed-region contract, inherited for free).
- **FR-6 — Triage/drain/dispatch propagation (added 2026-07-12 — dogfood-gap follow-up).**
  `dispatch-issue.sh`, `triage-inbox.sh`, `drain-inbox.sh` are **not portable today**: each
  hardcodes `REPO="AIClarityAU/minspec"` (re-confirmed at `8bfc5cc5`: `dispatch-issue.sh:21`,
  `triage-inbox.sh:51`, `drain-inbox.sh:104`), unlike the ai-review workflows, which derive
  `github.repository` at runtime. Before these join the managed-region template set:
  parameterize `REPO` (resolve from `gh repo view --json nameWithOwner` / the runtime
  workflow context, never a literal string) and extend the CI-review-stack portability suite
  (`packages/minspec/tests/managed-region-templates.test.ts:387`) to cover the new templates. Once parameterized, add
  the three scripts to the managed-region set alongside the dispatch-only roles they load
  (`dev`/`triage` — reconcile against `roles/architect.md`, which the ai-review stack already
  ships for its own panel use, #453). *Decision: same spec, not a new one (D-6).*
- **FR-7 — Auto-merge decisioning propagation; a scaffolded repo does not auto-merge unless
  its owner turns it on (added 2026-07-12; default reversed 2026-07-14 per #703 / D-7;
  rewritten 2026-10-01).** The #703 decision was: propagate the gate now, deny-by-default,
  and flip the scaffold default to `consequence-hybrid` once #489/#490/#491/#466 close. The
  intent — *present everywhere, live nowhere until its owner says so* — stands. Three things
  the 2026-07-14 text asserted do not hold at `8bfc5cc5`, so the requirement is restated:
  1. **The gate script is not portable as-is.** The earlier text said "confirmed portable
     as-is (zero hardcoded repo refs)". It has no hardcoded repo string, but it imports
     monorepo source — `../packages/minspec/src/lib/{auto-merge,consequence-analyzers,test-scanner,classifier,machinery-paths}`
     and `../packages/shared/src/review-signals` (`scripts/auto-merge-gate.ts:35-55`) — and
     runs under `npx tsx` (`dispatch-issue.sh:1881`). Copied into a repo with no `packages/`
     tree it fails at import. So FR-7 needs the same treatment as FR-6: **ship a
     self-contained artifact** (a generated single file with its imports bundled, held
     byte-equal to its sources by the same generator-plus-staleness check the reviewer stack
     already uses), never the raw `.ts`.
  2. **The gate has exactly one caller, and FR-6 ships it.** `ready-to-merge.yml` makes no
     reference to the gate (0 matches); the only invocation is `dispatch-issue.sh:1881`. A
     scaffolded gate with no scaffolded dispatcher is inert. **FR-7 therefore depends on
     FR-6** and must not be released ahead of it as if it added protection.
  3. **`autoMerge.mode` is not a config key anything reads.** The earlier text and AC-6
     had scaffolding write `.minspec/config.json` `autoMerge.mode: pr-gate`. No reader of
     that key exists (0 matches across `scripts/` and `packages/minspec/src`): the mode comes
     only from the environment variable `MINSPEC_AUTOMERGE_MODE`
     (`dispatch-issue.sh:1863`), and anything other than the exact token
     `consequence-hybrid` — including absent — resolves to `pr-gate`
     (`auto-merge-gate.ts:79`). Writing the key would be a setting that looks like a
     control and controls nothing. **The deny default is delivered by absence, not by a
     written value**: scaffolding MUST NOT write any auto-merge enablement, and the
     requirement is on resolved behaviour (AC-6), not on a config byte.

  Since 2026-07-14 a **second** auto-merge switch also exists, which the earlier text does
  not mention: GitHub-native auto-merge on a provenance-verified `ai-review:pass`
  ([DR-061](../../../docs/decisions/DR-061.md), accepted 2026-07-15), read from
  `.minspec/config.json` `autoMerge.native`, **default off**, on for this repo
  (`dispatch-issue.sh:77-88`; the consequence gate wins if both are set, `:81`). FR-7 covers
  both switches: **a scaffolded repo gets neither turned on.** That matches DR-061 §1
  ("Default off — deny-by-default preserved for projects that don't opt in") and constitution
  invariant 3 (an adopter did not opt in to auto-merge by running init).

  **The "then flip" half is no longer a standing instruction — it is D-11.** Its stated
  condition has, per the 2026-08-05 audit, already fired, and DR-061 changed what a flip
  would mean. Until D-11 is answered this spec ships deny on both switches and no flip.
  A per-repo setting always wins over the scaffold default in either direction (INV-9).
- **FR-8 — Workspace-wide init offer (added 2026-07-12; refined 2026-07-14 per #703).** When
  `Initialize SDD Structure` runs with a multi-root `*.code-workspace` open, offer (non-modal)
  to run init on every **top-level workspace folder** — the literal `folders` array entries,
  reusing the existing enumeration `allWorkspaceRoots` (`packages/minspec/src/lib/resolve-folder.ts:107`;
  the earlier text named it `allWorkspaceFolderPaths`, a symbol that has never existed in
  `packages/`) — **never** a filesystem recursion for nested `.git` dirs (D-9). **The offer lists
  each folder by name** (a checklist showing per-folder state — *needs-init* vs *already
  current*), so the user sees exactly what will be touched before confirming (INV-10 /
  [HITL approval UX](../../../docs/decisions/) — act on a visible, enumerated artifact, never a
  vague "initialize all N folders?"). Already-scaffolded folders appear in that list as
  "already current," not silently skipped and not re-prompted individually. A folder with no
  `.minspec/` has not opted in (constitution invariant 3), so **the confirmed list is the
  opt-in**: only folders the user left selected in that list are initialized. *(A VS Code
  toast cannot itself hold a checklist; the surface — e.g. a non-modal offer whose action
  opens a multi-select pick — is a Plan-phase choice. The requirement is that the named,
  per-folder list is on screen before any write.)* **No second toast
  for nested git repos** (#703 / D-9): the founder does not use nested repos; if a nested
  `.git` is nonetheless detected, at most emit a single passive one-line advisory ("N nested
  repos found — not included; run init inside each if wanted"), never a second interactive
  offer.
- **FR-9 — Collapse init + refresh into one state-detecting command (added 2026-07-14 per
  #703 / D-10).** Today two near-identically-named palette entries — *MinSpec: Initialize SDD
  Structure* (`initCommand`, `packages/minspec/src/commands/init.ts:1223` — first-run scaffold +
  onboarding gated to first init: coverage prompt, ruleset advisory, PR-ext nudge) and
  *MinSpec: Refresh Harness Files* (`initRefreshCommand`, same file `:1475` — merge-preserving
  re-render, no onboarding) — are a
  misfire trap: a user cannot tell which to run. *(Corrected 2026-10-01: the earlier text
  said init on an already-scaffolded repo "could clobber". The code says the opposite —
  `generateHarnessFiles` (`packages/minspec/src/lib/scaffold.ts:1384`) writes a template file
  only when it does not already exist, and its managed-region step
  (`generateManagedRegionTemplates`, `scaffold.ts:717`) likewise skips any path that exists.
  The real misfire is quieter: running Initialize on a scaffolded repo reports "Initialized"
  and **updates no existing managed region**, so a user who wanted a refresh believes they
  got one. The same call also re-saves the template baseline (`scaffold.ts:1436`), which would
  additionally silence the "templates updated, refresh?" prompt for the files it just
  skipped — **that consequence is inferred, not traced**; the Plan phase must confirm it, because if true the
  merged command fixes a silent-staleness defect and not only a naming one.)* Collapse them to **one** command
  (*MinSpec: Initialize / Refresh SDD Structure*) that branches on state: no
  `.minspec/config.json` ⇒ full init (with onboarding); present ⇒ merge-preserving refresh
  (+ managed-region warnings). One palette verb, impossible to pick wrong; the refresh path
  becomes an internal branch, not a separate user-facing command. Auto-bootstrap already does
  init-on-open / refresh-on-open, so the manual command is the redundant surface this
  simplifies. *(Riding in this spec per D-10 because it is the init entry point FR-8's
  workspace-wide offer and FR-1/FR-6/FR-7's scaffolding all hang off; if the Plan phase finds
  it inflates scope, it is cleanly separable to its own T2 issue — the governance-content FRs
  do not depend on it.)*

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
- **INV-9 — A scaffolded repo never auto-merges on MinSpec's say-so (FR-7).** Init/refresh
  never writes a value that turns on either auto-merge switch — not `autoMerge.native: true`,
  not the token `consequence-hybrid` in any scaffolded file (config, workflow `env:`, or a
  script default) — and never changes the repo's `allow_auto_merge` setting. Absent,
  unreadable, or unrecognised resolves to hold (the resolvers' existing behaviour,
  `auto-merge-gate.ts:79`, `dispatch-issue.sh:75-88` — propagation must not weaken it). A
  value the repo's owner set is never overwritten by re-init/refresh, in **either**
  direction. This holds unless D-11 is answered with an option that explicitly amends it.
- **INV-10 — Workspace-wide offer is declared, not discovered (FR-8).** The offer never
  touches a folder outside the workspace's declared `folders` array; it lists each folder **by
  name** with its state before running, and running it twice is a no-op for already-current
  folders (inherits FR-5/INV-2). A folder with no `.minspec/` is initialized only if the user
  left it selected in that list — the list is the opt-in (constitution invariant 3).
- **INV-11 — One command, no wrong choice, no clobber (FR-9).** The merged init/refresh
  command selects init vs refresh purely from `.minspec/config.json` presence; the refresh
  branch preserves user content outside managed markers exactly as `initRefreshCommand` does
  today (inherits INV-3), and the onboarding prompts fire only on the first-init branch —
  never re-prompted on the refresh branch.

- **INV-12 — Nothing scaffolded reaches outside what is scaffolded (FR-6, FR-7).** No file
  MinSpec scaffolds may import, source, or execute a path that MinSpec does not also
  scaffold (the monorepo's `packages/**` in particular). Enforced by extending the existing
  `#564 CI-review stack — scaffolding is dependency-complete` suite
  (`packages/minspec/tests/managed-region-templates.test.ts:429`) to the FR-6/FR-7 artifacts
  **before** they join the template set, and by running the scaffolded gate in a fixture
  with no `packages/` tree (AC-6). INV-8 covers a hardcoded repo *name*; this covers a
  hardcoded repo *layout* — the gap that let "portable as-is" be written about a script
  that cannot start outside this monorepo.

## Decisions needed (Clarify — human-only)

### Open — needs the founder before this can be re-approved

- **D-11 — What auto-merge posture does a freshly scaffolded repo get, now that the #703
  flip condition has fired?** #703 resolved: `pr-gate` until #489/#490/#491/#466 close,
  then flip to `consequence-hybrid`. Two things have changed since.
  *The condition fired.* The 2026-08-05 audit (#1271) recorded all four closed, and this
  repo's history carries the fixes — `33180fa0` (#489), `5844bc05` (#490, recorded as
  DR-058), `f4e0ba75` (#491), and #466's SHA-bound pass in the `ai-review.yml` header
  (`:108-110`). The issue *states* were not re-read in this revision (no network access).
  *The flip no longer means what it meant.* [DR-061](../../../docs/decisions/DR-061.md)
  (accepted 2026-07-15, the day after the #703 decision) records that the
  consequence-hybrid gate holds every change because the analyzers it measures blast with
  (#88, on the #91/#195 index) are unbuilt, and introduced GitHub-native auto-merge as the
  interim path — default off, on for this repo. Whether #88/#91/#195 are still open is
  **unverified here** and should be checked before answering.
  - **(a) Deny on both switches, and no automatic flip — turning either on stays a
    deliberate per-repo act by its owner. (rec)** Cost: the "then flip" half of the #703
    decision is dropped rather than honoured, and every scaffolded repo keeps a human merge
    keystroke until its owner opts in by hand — the bottleneck DR-061 measured on this repo
    stays in place on those. Recommended because it is the only option consistent with
    DR-061 §1's default-off and constitution invariant 3 without a new decision record.
  - **(b) Flip the scaffold default to `consequence-hybrid`, as #703 literally says.**
    Cost: there is no config seam for the mode today, so this means building one or
    scaffolding an environment default (INV-9 amended); and if DR-061's reading still holds,
    the flip changes nothing observable — every PR still holds — while shipping a switch
    that reads as "on".
  - **(c) Scaffold `autoMerge.native: true` — what this repo itself runs.** Cost: every
    adopter repo merges on `ai-review:pass` with no human, without having asked for it;
    that reverses DR-061 §1's default-off, cuts against invariant 3, needs the repo's
    `allow_auto_merge` setting changed (a GitHub write), and needs a new decision record
    amending DR-061 before it can ship.

### Recorded earlier — not re-opened by this revision

D-1, D-2, D-4 and D-5 below were in this form when the spec was approved on 2026-08-07. One
observation only: D-2's recommended shape (advise by default, write only on an explicit
confirm) is what `ruleset-advisor.ts` does today (see *What exists*).


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
- **D-7 — Auto-merge default for freshly-provisioned repos. → SUPERSEDED (2026-07-14, Paul
  Harvey, #703): `pr-gate` by default until the merge-holes close, then flip.** The earlier
  2026-07-12 resolution (`consequence-hybrid` by default, accepting the holes on every repo)
  is **reversed**. Scaffolded repos default to `pr-gate` (deny-by-default); the gate is still
  propagated (FR-7) so it is *present and configured*, but no repo auto-merges live until
  #489/#490/#491/#466 close (backstops #91/#195). Founder's steer ("obv we should close those
  gaps") + the opening "are we safe to turn on" both point to not spreading a known-holed
  live default. The flip of the scaffold default to `consequence-hybrid` becomes a one-line
  follow-up once those close. A per-repo override still wins in either direction (INV-9).
  **→ Condition since met and overtaken by DR-061; the flip is re-opened as D-11
  (2026-10-01). The `pr-gate`-by-default half stands and is what FR-7 ships.**
- **D-10 — Collapse the two init/refresh palette commands into one? → RESOLVED (2026-07-14,
  Paul Harvey, #703): yes — one state-detecting command (FR-9).** `initCommand` (first-run +
  onboarding) and `initRefreshCommand` (merge-preserving) do genuinely different things, but
  two near-identical palette names are a misfire trap; collapse to one command that branches
  on `.minspec/config.json` presence. Folded into this spec (it is the init entry point the
  other FRs hang off); separable to its own T2 issue if Plan finds it inflates scope.
- **D-8 — Workspace-init target set. → RESOLVED (2026-07-12, Paul Harvey): top-level
  workspace folders only (FR-8)** — the `.code-workspace` file's declared `folders` array,
  not a recursive filesystem scan for nested `.git` dirs. Matches the existing
  `allWorkspaceRoots` primitive (`resolve-folder.ts:107`); avoids surfacing repos the user never
  consciously added to the workspace.
- **D-9 — Workspace-init spec-fit. → RESOLVED (2026-07-12, Paul Harvey): folded into
  SPEC-033 as FR-8**, not a separate spec — still "provisioning governance across every
  managed repo," just widening *which folders* get offered rather than *what* gets
  provisioned.

## Acceptance (feature-level, verified end-to-end)

1. A **fresh repo** with only `.minspec/` scaffolded, after init/refresh, has the full
   ai-review file set committed and ai-review **triggers** on the next PR (skipping cleanly
   with the notice while secrets are absent). [INV-1, FR-1]
2. `MinSpec: Check Repo Governance` run against a **fixture repo** — a temporary git repo
   with `.minspec/` scaffolded, no ai-review workflow files, and an injected `CommandRunner`
   (the seam `ruleset-advisor.ts` already funnels every `gh` call through) answering the
   rulesets read with an empty list — reports *both* gaps (missing ai-review, default branch
   without the required checks) and offers the fix. **Control:** the same command against a
   fixture that has the full workflow set and a satisfying ruleset reports neither gap and
   offers nothing — without it, a command that always reports gaps would pass. No live repo
   and no network are used. *(Rewritten 2026-10-01: this was written against `sealbox`
   "pre-fix", a state the 2026-08-05 audit recorded as gone.)* [FR-2]
3. Accepting the fix scaffolds the files (half A) and either writes protection (D-2 opt-in)
   or prints the exact steps (default), plus the FR-4 prerequisite checklist. [FR-3, FR-4]
4. Re-running the command is a clean no-op; a user edit outside the markers survives; a
   deleted marker warns rather than clobbers. [INV-2, INV-3, FR-5]
5. After the FR-6 portability refactor, `dispatch-issue.sh`/`triage-inbox.sh`/`drain-inbox.sh`
   scaffolded into scrooge/sealbox resolve their own repo at runtime — a portability test
   (extending `ci-stack-portability`) asserts no template contains a literal
   `AIClarityAU/minspec` string. [INV-8, FR-6]
6. In a freshly scaffolded fixture repo carrying FR-6's and FR-7's artifacts, with no
   auto-merge setting written by anyone: **(a)** the scaffolded gate artifact runs to a
   verdict with **no `packages/` tree present** (the check the earlier "portable as-is"
   claim never had); **(b)** the mode resolves to `pr-gate` and the native switch resolves
   off, so the dispatcher holds every PR; **(c)** the scaffold's own output contains no
   `autoMerge` enablement and no `consequence-hybrid` token; **(d)** after the owner turns
   either switch on — and separately, after the owner writes an explicit off — a
   re-init/refresh leaves the value exactly as set. (b) and (c) are as specified under
   D-11 option (a); options (b)/(c) would change them. [INV-9, INV-12, FR-7]
7. Running the init command with a `*.code-workspace` open (e.g. `mmo.code-workspace`) offers
   every top-level workspace folder **by name** with per-folder state, marks already-scaffolded
   ones as current, and touches no folder outside the declared `folders` array; a nested `.git`
   yields at most a passive advisory, never a second toast. [INV-10, FR-8]
8. The single *MinSpec: Initialize / Refresh SDD Structure* command runs full init (with
   onboarding) on a repo with no `.minspec/config.json` and a merge-preserving refresh (no
   onboarding, user content outside markers intact) on one that has it — with no separate
   *Refresh Harness Files* entry in the palette. [INV-11, FR-9]

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
- **The FR-7 scaffold-default flip is no longer a standing follow-up** — its condition
  fired and DR-061 changed what it would do; it is decision **D-11** above. If D-11 lands on
  option (c), a decision record amending DR-061 is required before implementation.
- **Keep [SPEC-063](../SPEC-063-clean-uninstall/requirements.md) (clean uninstall) in
  lockstep.** It inventories this spec's FR-1/FR-3/FR-6/FR-7 as its removal checklist and
  names FR-9's command; FR-7's artifact is now a generated bundle rather than the raw
  `scripts/auto-merge-gate.ts`, and D-11 may add or remove a config write. SPEC-063 must be
  re-read against whatever D-11 decides.
- **FR-9 command-merge is separable** (D-10) — if Plan finds collapsing the two init/refresh
  commands inflates SPEC-033, split it to its own T2 issue; the governance-content FRs
  (FR-1/2/3/4/6/7) do not depend on it.
- **Not yet filed — this revision ran with no network access and could file nothing.** Two
  items need an issue so they do not stay prose-only (DR-023): (1) the SPEC-063 lockstep
  re-read above; (2) a stale doc comment found while checking FR-7 —
  `packages/minspec/src/lib/auto-merge.ts:59` says the mode's "Default = consequence-hybrid",
  while both resolvers default to `pr-gate` (`auto-merge-gate.ts:79`,
  `dispatch-issue.sh:1863`). Out of this spec's scope; recorded so it is not lost.

## Alternatives rejected in this revision

Recorded because nobody reviewed these choices live (DR-086 §4).

- **Change nothing and close #703 as already applied.** Literally accurate — all five
  refinements were in the file. Rejected because the approved text then still told an
  implementer to scaffold a config key nothing reads, to ship a script that cannot start
  outside this monorepo, and to test against a repo state that no longer exists. The cost
  of not taking this path is real: **this revision voids a founder approval** and asks for
  another read. If that read is not worth it, closing this change and #703 loses nothing
  that was approved — only these corrections.
- **Carry out the flip, since its written condition is met.** Rejected: DR-061 post-dates
  the #703 decision and changes the flip's effect, and turning on a merge path for other
  repos is not a call an agent makes on an expired conditional. It is D-11.
- **Mint a new spec for the corrections.** Rejected: one decision, one document — a second
  id would leave two specs both claiming FR-7.
- **Edit the body but leave `status: implementing`.** Rejected: the stored approval hash
  covers the old bytes, so the file would claim an approval it no longer has.
