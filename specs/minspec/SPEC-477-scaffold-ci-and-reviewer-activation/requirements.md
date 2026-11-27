---
id: SPEC-437
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry (same epic as SPEC-033, whose remainder this finishes)
aspects: [ci, scaffold, required-checks, rulesets, reviewer-activation, consent, tier-0]
relates_to: [SPEC-033, SPEC-071, DR-050, DR-066, DR-037, DR-054, "#564", "#557", "#559", "#560", "#562", "#561"]
---

# SPEC-437: Finish #564 — scaffold `ci.yml` (Tier B) and offer reviewer activation (secrets + App)

> Materializes [#564](https://github.com/AIClarityAU/minspec/issues/564) — "scaffold the FULL
> required-check CI stack on init, two-tier". **Most of #564 already shipped**; this spec
> covers only the measured remainder so it is not re-built. Design rests on
> [DR-050](../../../docs/decisions/DR-050.md) (ruleset advisor: autonomous read-probe, consent-gated
> mutation) and [DR-066](../../../docs/decisions/DR-066.md) (no silent gate). No new DR is proposed.

## One-Sentence Scope

Finish the two unbuilt slices of #564: (a) scaffold a `ci.yml` managed template whose
`lint`/`test`/`build` jobs are required only for scripts the repo really has, and (b) make
Init/Refresh tell the user — by exact name, consent-gated — which reviewer secrets and App
install are still missing, so a scaffolded `ai-review` gate can actually go live.

## Already built — do NOT rebuild (verified against code, 2026-10-16; re-checked 2026-11-27, line numbers refreshed — still no `ci.yml` template and no activation offer in `template-registry.ts`/`init.ts`)

| #564 slice | State | Evidence |
|---|---|---|
| 1 — ai-review.yml, ready-to-merge.yml, ai-review-retry.yml + reviewer scripts/roles as managed files | **Built** | `template-registry.ts:2965` `CI_REVIEW_STACK_TEMPLATES` (workflows `:2967-2987`, scripts `:3010-3057`, roles `:3065-3083`, guard `:3089`); spread into the registry at `:3138`, `:3181` |
| 2 — ruleset advisor requires Tier A (`ai-review`, `ready-to-merge`) once scaffolded | **Built** | `ruleset-advisor.ts:373-377` check constants; `:441` resolver builds from `DEFAULT_REQUIRED_CHECK_CONTEXTS`; wired in `init.ts:818-826` |
| 3a — read-only probe: are all three reviewer secrets set? | **Built, boolean-only — extended by FR-4/FR-8, see FR-9** | `ruleset-advisor.ts:734` `REVIEWER_SECRETS` (single source of truth), `:802` `probeReviewerConfigured` declaration (returns at the `return` inside it; names only, never values). It returns a plain `boolean`: every error path (non-zero `gh` exit, bad JSON, non-array) collapses to `false`, and it exposes no set of present names |
| 4a — code-check detection from `package.json` scripts | **Built** | `ruleset-advisor.ts:400` `detectCodeChecks`; consumed `init.ts:823` |

## Remaining gap (the two slices this spec owns)

1. **No `ci.yml` is scaffolded.** `grep` of `template-registry.ts` finds no `ci.yml`
   `outputPath`. `detectCodeChecks` can add `lint`/`test`/`build` to the required set, but
   a freshly-inited repo has no workflow that *reports* those contexts — the same
   "required, never produced" deadlock class as #559, one step earlier. (This repo's own
   `.github/workflows/ci.yml` exists but is hand-built and not a template.)
2. **No activation offer.** Init probes whether the reviewer is configured, but nothing
   tells the user *which* of `CLAUDE_CODE_OAUTH_TOKEN`, `MINSPEC_APP_ID`,
   `MINSPEC_APP_PRIVATE_KEY` is missing, nor that the `minspec-sdd` App must be installed.
   Until all are set the scaffolded `ai-review.yml` self-skips with a notice and posts no
   check (SPEC-033 FR-1), so Tier A is scaffolded but inert, and repos run with a 1-check gate.

## Functional requirements

- **FR-1 — `ci.yml` managed template.** Add a managed-region template
  `.github/workflows/ci.yml` (hash comment style, `pull_request` trigger, repo-agnostic,
  no minspec-monorepo literals) with one job per context: `lint`, `test`, `build`. Each job
  runs `npm run <name>` and **self-skips with a visible `::notice` — success, never a silent
  pass-by-absence of the check — when `package.json` has no such script**. A skipped
  job still reports its context, so the check is always *produced*.
  *(Open: DQ-1 — whether skipped-green is acceptable.)*
- **FR-2 — Tier B is gated by detection AND a producer, never weakened for hand-owned CI.**
  New resolver input `ciWorkflow: 'scaffolded' | 'hand-owned' | 'absent'` (mirrors
  `aiReviewScaffolded`). `lint`/`test`/`build` enter the required set as follows:
  - `scaffolded` (MinSpec wrote the managed `ci.yml`): only when `detectCodeChecks` finds the
    script (and FR-3 confirms the job exists).
  - `hand-owned` (an unmarked pre-existing `ci.yml` was skipped per DQ-3 (A)): **today's
    behaviour is preserved** — `detectCodeChecks` alone decides. The repo's own `ci.yml` is the
    producer; Init/Refresh must never remove a required check a repo already has (no gate
    weakening). Repos like this one or sealbox keep their lint/test/build requirements.
  - `absent` (no `ci.yml` at all, e.g. user opted out of the template): Tier B is **not**
    required, since nothing produces the contexts (the #559 deadlock class). This is the only
    case that is stricter than today, and it removes a requirement that could never be met.
  Scaffolding `ci.yml` alone never adds a required check. Absence of a script ⇒ not required.
- **FR-3 — Intersect with what CI reports.** Before adding a Tier B context, the resolver
  must confirm the scaffolded `ci.yml` actually defines a job of that name (read from the
  template's own job list, one shared constant — never a second hand-kept list).
- **FR-4 — Name the missing activation prerequisites.** After the existing reviewer probe,
  if not configured, show **one non-modal** notice listing exactly the missing names from
  `REVIEWER_SECRETS` (from the FR-9 `present` set; only when `status: 'ok'`) plus "install the
  `minspec-sdd` GitHub App on this repo". Items render **unchecked** — never reported as
  done (SPEC-033 FR-4). The list is derived from `REVIEWER_SECRETS`, not duplicated.
- **FR-5 — Consent-gated `gh secret set` (optional action, values never held).** The
  notice offers a per-secret action that runs `gh secret set <NAME>` with the **value
  supplied by the user at an input prompt** and piped to `gh` on stdin; MinSpec never
  stores, logs, or echoes it. `gh` unavailable/unauthenticated ⇒ downgrade to the FR-4
  advisory with the exact manual command. The click is the consent (DR-050 mutating class).
  *(Open: DQ-2 — whether to build this at all.)*
- **FR-6 — App install is a link, not an action.** The extension never installs the App
  (needs GitHub admin OAuth); it deep-links the install page. No MinSpec token custody.
- **FR-7 — Idempotent, drift-managed.** Re-running Init/Refresh yields one copy of each
  file, no duplicate prompts once configured (inherits the managed-region contract, DR-037).
- **FR-9 — Probe returns a result, not a boolean.** Replace the boolean return of
  `probeReviewerConfigured` with a discriminated result:
  `{ status: 'ok'; present: readonly string[] } | { status: 'error'; reason: string }`.
  `configured` is derived (`ok` and every `REVIEWER_SECRETS` name present); the missing set for
  FR-4 is `REVIEWER_SECRETS` minus `present`. Existing callers keep their fail-safe (`error` ⇒
  not configured ⇒ Tier A not required). Names only, never values; this is the one change to
  the otherwise-built probe and its tests are updated, not skipped.
- **FR-8 — Failure is visible.** A failed probe, `gh secret set`, or ruleset update surfaces
  its error; none is swallowed (DR-066 / invariant 2). An errored probe (FR-9 `status: 'error'`) leaves the check
  **not required**, says so with the reason, and **never** renders the FR-4 missing-secrets list
  (an auth/network failure must not falsely claim all three secrets are missing) — it never silently proceeds as "configured".

## Invariants (must not break)

- **INV-1 Offline core (constitution 1):** the probe stays a user-`gh` read of the repo's
  own config; no MinSpec socket, no token; secret *values* never read, only set on explicit click.
- **INV-2 No silent gate (constitution 2):** FR-2/FR-3 guarantee no required context lacks
  a producer; FR-8 forbids swallowed errors. Skipped-green in FR-1 must emit a notice.
- **INV-3 Blast radius (constitution 3):** everything is gated on `.minspec/` opt-in; no
  workflow or ruleset write in a repo that did not init.
- **INV-4:** FR-5 never writes a ruleset; ruleset mutation stays on the existing consent click.

## Acceptance criteria

- **AC-1** Init on a repo with `package.json` scripts `lint`+`build` only, and the reviewer
  **not** configured (so Tier A is out): `ci.yml` is written; required set =
  `MinSpec SDD validation` + `lint` + `build`; `test` absent. (With the reviewer configured,
  `ai-review` + `ready-to-merge` are additionally required — AC-4.)
- **AC-2** Init on a repo with no `package.json` (sealbox-shaped, pre-CI): `ci.yml`
  written; required set unchanged from today; no permanent-pending check.
- **AC-3** Reviewer secrets partially set (`CLAUDE_CODE_OAUTH_TOKEN` only): notice names
  exactly `MINSPEC_APP_ID` and `MINSPEC_APP_PRIVATE_KEY` plus the App install.
- **AC-4** All three set: no activation notice; `ai-review`/`ready-to-merge` required (existing behaviour, regression-pinned).
- **AC-7** Repo with a hand-owned unmarked `ci.yml` and `lint`/`test`/`build` scripts: `ci.yml`
  untouched + warned; required set still includes `lint`/`test`/`build` (no regression, FR-2).
- **AC-8** Probe errors (`gh` auth failure): no secrets list shown; notice states the error;
  Tier A not required (FR-8/FR-9).
- **AC-5** `gh` missing: advisory with manual commands; nothing mutated, nothing thrown.
- **AC-6** A `ci.yml` job rename without updating the shared constant fails a test (FR-3 drift pin).

## Out of scope

Slices 1–2 and the probe (already built); the OIDC broker that removes per-repo App
secrets (SPEC-034); drift detection of required checks (SPEC-071); auto-merge/triage
propagation (SPEC-033 FR-6/FR-7); the autolink advisor (#561).

## Decisions needed (Clarify)

- **DQ-1 — How should a missing script behave in `ci.yml`?**
  (A) **(rec)** Job runs and *skips green with a notice* — context always produced, so it can
  never deadlock; cost: a green check that ran nothing, which is a mild false-comfort risk
  (mitigated: FR-2 never *requires* it without the script).
  (B) Generate the job only for scripts present at scaffold time — no false greens; cost: a
  script added later has no job until Refresh, and Refresh must re-render the file.
- **DQ-2 — Build FR-5 (`gh secret set` with prompted value) or only FR-4 (named notice)?**
  (A) **(rec)** FR-4 only first, FR-5 as a follow-up — smallest surface, zero secret-handling
  code; cost: user types `gh secret set` themselves.
  (B) Build both — one-click setup; cost: the extension now handles credential material
  (even transiently), which the DR-050/DR-054 posture avoids and needs its own security review.
- **DQ-3 — `ci.yml` collision.** Repos like sealbox already hand-own a `ci.yml`. Managed-region
  markers preserve outside content, but a differing existing file may surprise. Options:
  (A) **(rec)** skip + warn when an unmarked `ci.yml` exists (never clobber); cost: such repos
  get no scaffolded `ci.yml`, though their existing Tier B requirements are preserved (FR-2 `hand-owned`). (B) append a managed region; cost: two sources of truth in one file.
- **DQ-4 — Tier tier.** Predicted T3 (new template + resolver input + UI notice). If DQ-2 (B)
  is chosen, raise to T4 (credential handling).

## Follow-ups (tracked)

- Hand-port into scrooge as "first real instance" (issue's immediate slice) — already
  superseded by SPEC-033's dogfood follow-up, tracked under #557.
- If DQ-2 (A) is chosen, file the `gh secret set` offer as a separate issue before implement.
