---
id: SPEC-071
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (the silent-gate incident family)
aspects: [ci, gates, required-checks, rulesets, drift, silent-failure, provenance, scaffold, tier-0]
relates_to: [DR-066, DR-074, DR-050, DR-063, DR-090, SPEC-054, SPEC-033]
# No `implements:` / `affects:` declared yet, deliberately. SPEC-038 FR-3 requires the
# ownership declaration *past Clarify*, and the file set here is downstream of DQ-1
# (which witness shape) and DQ-3 (whose manifest). Declaring a guessed set now would
# freeze paths this spec may never touch — the spec-gate freezes `affects:` exactly as
# hard as `implements:`. It MUST be declared at Clarify — `.minspec/config.json` sets
# `ownershipDeclaration: error`, and `validateOwnership` arms the moment `phases.plan`
# reaches `in-progress`, which approval itself writes. Declaring at Clarify therefore
# lands the set BEFORE any approval mints a hash (SPEC-051's trap), and keeps the
# approve gate satisfiable. Today, at `plan: pending`, the rule is inert by design
# (spec-validator.ts:792-796).
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-071: A shipped gate must prove it is still a required check

> Materializes **[#1782](https://github.com/AIClarityAU/minspec/issues/1782)** — the
> RCDD report on the `AIClarityAU/memory-fabric` ruleset drift of 2026-09-02, where one
> whole-object ruleset `PUT` silently dropped `ai-review` and `ready-to-merge` from the
> required-check list while both workflows kept running and reporting green.
>
> This spec does **not** re-litigate the rule it enforces. The rule is already in force:
> [DR-066](../../../docs/decisions/DR-066.md) (`status: accepted`, 2026-07-22) and its
> constitution amendment, **invariant 2 — no silent gate**. What is missing is a witness
> for the one clause nothing observes: *a gate that has been quietly demoted from
> required to advisory.*

## One-Sentence Scope

Add a deterministic, fail-closed witness that periodically and per-PR compares the check
contexts a MinSpec-managed repo **ships** against the contexts its default branch
**actually requires**, and fails visibly when a shipped gating context is no longer
required — closing, by detection, the drift class that #1782 records and that no CI job,
script, hook or extension feature in either repo would have caught.

## Context

### What happened (the observation, not a proxy)

Per #1782, the `main` ruleset of `AIClarityAU/memory-fabric` (id `21400809`) moved from
requiring three contexts to requiring one in a single write:

| ruleset version | when | required contexts |
|---|---|---|
| 48094552 | 2026-08-30 10:57Z | `MinSpec SDD validation`, `ready-to-merge`, `ai-review` |
| 48423528 | 2026-09-02 10:18Z | `MinSpec SDD validation` |

The intended change was to the approvals count (bot self-approval, memory-fabric#6).
Losing the two provenance gates was collateral, and it was invisible: the closing comment
50 seconds later reported `checks=MinSpec SDD validation` as the *verified expected state*.
Blast radius of this instance was zero — no PR merged and no commit landed on `main`
during the degraded window — so the spec is written against the class, not the damage.

### Mechanism

A GitHub ruleset update is a **whole-object replacement**; there is no PATCH. MinSpec's own
code says so and handles it correctly: `updateRulesetRequiredChecks`
(`packages/minspec/src/lib/ruleset-advisor.ts:817-895`) does a GET of the live ruleset
(`:824`), unions the requested contexts onto the observed ones, and only then PUTs
(`:878-883`). It never removes.

memory-fabric#6 carried a ready-to-run `PUT .../rulesets/21400809` heredoc whose `rules`
array had been **reconstructed by hand** rather than read from live state, listing one
context. Applying it replaced three with one. The safe writer was not wrong — it was
bypassed. **A helper that is safe only when used is not a gate.**

### The missing gate

Nothing in `AIClarityAU/minspec` or `AIClarityAU/memory-fabric` asserts that the checks a
repo ships are still the checks its branch requires. The nearest existing machinery, and
why each one misses:

- `scripts/check-swallowed-gate-signal.ts` enforces **DR-066 clause 1** only (swallowed
  errors on gate-signal writes), and scans shell scripts under `scripts/` — not ruleset
  state.
- `scripts/audit-ruleset-integration-ids.ts` audits `integration_id` **pins** on contexts
  that *are* required (#560's failure mode). It is also **wired into nothing** — no npm
  script, no workflow — and requires `--owner --repo --ruleset-id` that nothing supplies.
- `listRequiredCheckContexts` (`ruleset-advisor.ts:661-693`) can read the required list,
  but collapses read failure, parse failure and "no ruleset at all" into the same `null`
  (`:666-675`, `:692`). That is correct for its caller (init's offer-to-create) and
  disqualifying for a gate.
- `.github/workflows/main-red-watch.yml` is the closest thing to a watcher, and its own
  header says it is **not a gate and never a required check** (`:21-25`). It fires on
  `workflow_run` failure, not on gating-status change.
- **SPEC-054** (`status: planning`, `plan: in-progress`) names this exact gap and
  explicitly declines it: *"removing the job from `ci.yml` entirely defeats it. Nothing
  short of an out-of-band watcher closes that, and this spec does not build one."*
  (`specs/minspec/SPEC-054-gate-signal-linter/requirements.md:356-359`). This spec is that
  watcher.

The workflows kept running and kept reporting. Only their **gating status** was removed,
and that is invisible from inside a PR. This is invariant 2 exactly: a gate demoted to
advisory is a gate that fails open and invisibly. It is the gate-shaped form of the
project's oldest rule — *artifact-existence ≠ feature-existence*, here **workflow-runs ≠
workflow-gates**.

### Why a repo-content lint would not have caught it

The offending heredoc lived in a **GitHub issue body** — outside the repository. A lint
over `scripts/`, `.github/` or docs has no reach there. This is load-bearing for DQ-1:
prevention-by-linting cannot close this instance, so the primary requirement below is
**detection**, and any prevention leg is additive.

### Contributing factor — the degraded default is also the fail-safe default

`DEFAULT_REQUIRED_CHECK_CONTEXTS` is `['MinSpec SDD validation']`
(`ruleset-advisor.ts:80`), pinned by test to the scaffolded CI job name (#559). That is
correct for the scaffold — requiring `ready-to-merge` on a fresh repo with no reviewer
wired would block every merge. But it means *the fail-safe scaffold default and the
degraded end-state are byte-identical*, so anyone reconstructing "what MinSpec requires"
from memory reproduces the bug. The required set must be **read**, never remembered.

### Cross-repo state at filing

Of 6 `AIClarityAU` repos, 5 are MinSpec-managed and all 5 ship both workflows.
`minspec`, `sealbox`, `scroogellm` and `voip-sms-inbox` currently require both;
`memory-fabric` was the only one degraded. That distribution is what makes the witness
worth scaffolding rather than hand-checking — but it is a snapshot in #1782, not a
continuously verified fact, which is the whole point of the spec.

## Functional Requirements

- **FR-1 — The shipped gate set is declared as data, never remembered.** A
  version-controlled declaration names, per repo, the check contexts that MUST be required
  on the default branch, and binds each to the workflow/job that produces it. The drift
  check reads this declaration; it never infers the expected set from
  `DEFAULT_REQUIRED_CHECK_CONTEXTS`, from a workflow-file scan alone, or from any
  hand-written list. Whether this is SPEC-054's `scripts/lib/gate-manifest.ts` or a
  separate file is **DQ-3**.

- **FR-2 — The drift check.** A deterministic check reads the contexts the default branch
  currently requires, and reports a **finding** for every context in the FR-1 declaration
  that is absent from that list. A finding fails the check with a non-zero exit. The check
  is read-only: it reports, it never repairs (see INV-4).

- **FR-3 — Fail closed and distinguishably.** Every non-success path is a distinct,
  explicitly-worded failure, never a silent pass and never a silent stop:
  (a) API read failure / non-zero exit; (b) authentication or permission failure
  (`403`/`404` on the rules endpoint); (c) unparseable response; (d) a branch that requires
  **zero** contexts; (e) a shipped context missing from the required list. (a)-(c) must not
  be reported as (d) or as success. The check MUST NOT delegate the read to
  `listRequiredCheckContexts`, which collapses (a), (c) and "no ruleset" into one `null`
  (`ruleset-advisor.ts:666-675`, `:692`) — the same constraint SPEC-054 settled as its DQ-6.

- **FR-4 — Two independent witnesses for the witness itself.** Invariant 2 clause 3
  forbids a required check whose sole producer one gap can disable, and a scheduled job
  that quietly stops running is precisely that. The drift check therefore runs on **two
  independent triggers** with **two independent alert mechanisms** — a per-change lane
  whose failure is visible on the change itself, and an out-of-band lane whose failure
  surfaces without anyone opening a pull request. Neither lane's silence may be read as
  health by the other. The concrete trigger/mechanism pairing follows from DQ-1.

- **FR-5 — Liveness of the out-of-band lane is asserted, not assumed.** The per-change lane
  asserts that the out-of-band lane produced a *successful* run within a declared freshness
  window, and reports a finding when it did not. A lane that has not run is reported as
  **unknown-and-failing**, never as clean. (This is FR-3's "never silently stop evaluating"
  applied to the watcher's own cadence.)

- **FR-6 — Self-membership.** The drift check asserts that **its own** context name appears
  both in the FR-1 declaration and in the branch's required list, and fails — printing the
  observed list verbatim — when either is absent. A drift detector that can itself be
  demoted without complaint reproduces the defect it exists to catch. (SPEC-054 AC-10
  specifies the same property for its own checker at `requirements.md:341-345`; if both
  ship, the property is stated once and shared, not duplicated divergently.)

- **FR-7 — Findings are actionable and honest.** A finding names: the missing context(s),
  the observed required list verbatim, the expected list and its source file, the ruleset
  id and version where the API supplies them, and an explicit statement that **nothing was
  repaired** and what the human must do. It must not imply the drift has been corrected.

- **FR-8 — Blast radius is the repo the check runs in.** The check reads only the
  repository it is running inside. No org-wide enumeration, no cross-repo sweep, no
  scanning of a repo that has not opted in. Where the check is scaffolded into another
  repository, it ships only into repos carrying `.minspec/` at the root (constitution
  invariant 3, DR-074), and any prose it carries holds in the repo that receives it or
  names `minspec` as its subject (DR-090).

- **FR-9 — Every sanctioned ruleset write is union-never-remove, and that is
  property-tested.** `updateRulesetRequiredChecks` already unions before it PUTs
  (`ruleset-advisor.ts:824`, `:878-883`). A test must pin the *property* — for any observed
  required-context set and any requested addition, the emitted PUT payload's context set is
  a superset of the observed one — rather than asserting one call site. Additionally,
  `DEFAULT_REQUIRED_CHECK_CONTEXTS` is documented at its definition as **scaffold-time
  seed only**, explicitly not a drift baseline, so the #559 pin and this spec's expected
  set are never confused again.

- **FR-10 — Degradation is visible, not fatal-by-default, for adopters.** In a repo where
  the reading identity genuinely cannot see branch rules (no permission, private repo, no
  token), the check must say so loudly (FR-3 case (b)) and must not be silently skipped.
  Whether that state blocks a merge in an adopter's repo or only warns is **DQ-5** — but it
  is never invisible.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, DR-066).** No load-bearing write or
  read in this feature is best-effort. No `|| true`, no ignored exit code, no
  `continue-on-error` on the path that produces the verdict. A missing or errored witness
  fails closed **and** visibly.
- **INV-2 — Blast radius (constitution invariant 3, DR-074).** Nothing this spec ships
  changes behaviour in a repo, org or machine-wide config that did not opt in via
  `.minspec/`.
- **INV-3 — Offline core (constitution invariant 1, DR-004/DR-050).** The MinSpec extension's
  core path makes no network call. If any part of this lands inside the extension (DQ-1
  option B), the branch-rules read is a **read-only probe of the repo's own configuration**
  through the user's own authenticated `gh` — the class DR-050 Amendment 2026-07-01 already
  authorises for `hasRequiredChecksRuleset` / `listRequiredCheckContexts`
  (`ruleset-advisor.ts:216-257`, `:661-693`) — and egresses no artifacts, spec content or
  telemetry.
- **INV-4 — Detection never auto-repairs.** This feature never writes a ruleset. Re-adding a
  dropped context is a mutating action and stays consent-gated behind the user's explicit
  click, per DR-050. An auto-healing witness would also mask the write that caused the drift,
  destroying the signal it exists to produce.
- **INV-5 — The expected set is read from data, the actual set is read from the API.**
  Neither side may be reconstructed from memory, from prose, or from a default constant.
  This is the direct root-cause inversion of #1782's contributing factor.
- **INV-6 — No new credential surface without a recorded decision.** If the chosen design
  needs a permission the GitHub App installation does not already hold, that grant is a
  governance act and requires its own DR before implementation (see DQ-2, DQ-7).

## Acceptance Criteria

- [ ] **Drift is caught** — a repo whose branch requires a strict subset of its declared
      shipped contexts fails the check, naming every missing context. (FR-1, FR-2)
- [ ] **The #1782 scenario is the fixture** — a fixture reproducing memory-fabric's
      `48094552 → 48423528` transition (three contexts → one) is red before the check
      exists and green after, with the two dropped contexts named in the output. (FR-2, FR-7)
- [ ] **Read failure is not a pass** — API error, permission denial and unparseable
      response each produce a distinct non-zero failure with its own message, and none of
      them is reported as "no drift" or as "zero contexts required". (FR-3)
- [ ] **Zero required contexts is its own finding** — a branch that requires nothing fails
      with a message distinguishable from a read failure. (FR-3)
- [ ] **Two lanes, independently observable** — disabling either lane leaves the other
      still failing visibly on drift; a test or documented manual verification demonstrates
      both directions, not just one. (FR-4)
- [ ] **A stopped watcher is a finding** — with the out-of-band lane's last success older
      than the freshness window, the per-change lane reports unknown-and-failing rather
      than clean. (FR-5)
- [ ] **The detector cannot be quietly demoted** — removing the detector's own context from
      the required list makes the detector fail, printing the observed list. (FR-6)
- [ ] **The finding is actionable and does not overclaim** — output names the missing
      contexts, the observed and expected lists with its source file, and states plainly
      that nothing was repaired. (FR-7)
- [ ] **No cross-repo reach** — the check reads only its own repository; a test or review
      confirms no org-level or multi-repo enumeration, and any scaffolded artifact is gated
      on `.minspec/` presence. (FR-8, INV-2)
- [ ] **Union-never-remove is a property, not an example** — a property/table-driven test
      shows the PUT payload's context set is a superset of the observed set across varied
      observed sets and additions, including empty and single-element observed sets.
      (FR-9)
- [ ] **The seed constant cannot be mistaken for a baseline** — `DEFAULT_REQUIRED_CHECK_CONTEXTS`
      carries a comment at its definition stating it is a scaffold seed and not the drift
      baseline. (FR-9)
- [ ] **Nothing is best-effort** — no `|| true`, ignored exit code, or `continue-on-error`
      on any verdict-producing path in the new code; `scripts/check-swallowed-gate-signal.ts`
      passes over it where the new code is in scope for that scanner. (INV-1)

## Decisions needed (Clarify)

These are the human's read. Each names a recommendation **and** what that recommendation
costs, per the project's decision convention.

- **DQ-1 — Which witness shape?** #1782 offers three.
  - **(A) A witness workflow — recommended.** A scheduled plus per-`pull_request` job that
    reads the branch rules and fails when a shipped context is not required. *Cost:* it may
    need a token permission the App installation does not hold (see DQ-2), and a scheduled
    job that silently stops running is itself an unwitnessed gate — which is why FR-4 and
    FR-5 exist and are non-optional overhead on this option.
  - **(B) The extension as witness.** Surface drift in the MinSpec status bar or a
    validation run. *Cost:* fires only when someone opens the editor, so an unattended repo
    — exactly memory-fabric's situation — drifts unnoticed. Viable as an **addition** to
    (A), not as a replacement.
  - **(C) Harden the advisor only.** Document and lint against hand-written ruleset PUTs.
    *Cost:* prose is not a gate, and — decisively — the offending heredoc lived in a GitHub
    **issue body**, outside every repo lint's reach. (C) could not have caught this
    incident and must not be chosen alone.
  - *Recorded recommendation:* **A, with B as a later additive surface.** The named cost of
    A is real permission + cadence overhead; accept it, because the alternative is a gate
    whose enforcement nobody observes.

- **DQ-2 — Which endpoint, and does it cost a new App permission?**
  `GET /repos/{owner}/{repo}/rules/branches/{branch}` returns the rules **actually in
  force** on a branch (the better question for this check — it answers "what gates `main`",
  not "what does ruleset N say"), whereas `GET /repos/{owner}/{repo}/rulesets` returns the
  ruleset objects. **I believe, unverified, that the `rules/branches` endpoint needs no
  `administration: read`, which would make option A's headline cost zero** — this has not
  been probed and must be verified live at Clarify or Plan before the permission question
  is answered either way. If a new permission *is* required, granting it is a governance
  act on the shared App installation and triggers INV-6 and DQ-7.
  *Recommendation:* probe `rules/branches` first. *Cost of the probe being wrong:* a Plan
  built on a permission that does not exist, discovered late.

- **DQ-3 — Whose manifest?** SPEC-054 FR-5 already specifies a producer manifest at
  `scripts/lib/gate-manifest.ts` listing each required context and its producers — a
  superset of what FR-1 needs. SPEC-054 is `status: planning`, `plan: in-progress`, and
  **none of its four `implements:` files exist yet**.
  - *Recommendation:* **extend SPEC-054's manifest, and sequence this spec's implementation
    behind it.** *Cost:* this work is then blocked on a spec that has not reached Tasks, so
    the fix for a live drift class waits on an unrelated schedule. The alternative — a
    second, narrower declaration owned here — ships sooner and creates exactly the duplicate
    source of truth that FR-1's "never remembered" rule is trying to eliminate.

- **DQ-4 — Rollout scope.** Ship into `AIClarityAU/minspec` only first, or scaffold into
  every `.minspec/` repo from day one?
  *Recommendation:* **this repo first, scaffold second, as two separate landings.** *Cost:*
  the four other MinSpec-managed repos — including memory-fabric, the one that actually
  drifted — stay unwatched through the gap between the two landings.

- **DQ-5 — Is the new check itself a REQUIRED context, and where?** SPEC-054 settled
  "required from day one" for its own checker (`requirements.md:183-185`).
  *Recommendation:* **required in this repo; advisory-but-loud in scaffolded adopter repos
  until FR-10's permission story is confirmed.** *Cost:* an asymmetry between this repo and
  adopters is itself a small silent-gate risk, and it must be documented at the scaffold
  site rather than left implicit.

- **DQ-6 — Separate spec, or fold into SPEC-054?** Folding would put one watcher story in
  one place. *Recommendation:* **keep separate (this spec).** SPEC-054 is at
  `status: planning`, i.e. approved and hash-locked; editing its body stales the signature
  the human already gave, and SPEC-054 explicitly scoped this watcher **out**
  (`requirements.md:356-359`). *Cost:* two specs in one domain, and a real seam to maintain
  at DQ-3's manifest boundary.

- **DQ-7 — Does this need its own DR?** No DR is minted by this spec, deliberately: the
  spec defers every irreversible choice to the questions above rather than pre-empting
  them. *Recommendation:* **a DR becomes required before Plan completes if — and only if —
  DQ-1 resolves to A **and** (DQ-4 resolves to scaffold-into-adopters **or** DQ-2 resolves
  to needing a new App permission).* Either of those is outward-facing and not undoable in
  under a day — the ADR filter this project states as *"decision records required for any
  choice that cannot be undone in <1 day"* (the rule lives in the parent register, not this
  repo's, so no local DR id is cited here and none is dangling). *Cost:* one more approval
  step on a fix for a live gap.
  ➡️ If both resolve the cheap way (own repo only, no new permission), record "no DR
  needed" at Clarify explicitly, so the absence is a decision and not an omission.

## Out of Scope

- **Repairing memory-fabric's ruleset.** Restoring `ai-review` and `ready-to-merge` as
  required contexts on `AIClarityAU/memory-fabric` is a one-off operational act in another
  repo, not a deliverable of this spec, and it is a mutating ruleset write that stays
  consent-gated (INV-4). It should be done through `updateRulesetRequiredChecks`'
  union-never-remove path, not a hand-written payload. ➡️ Tracked on #1782.
- **DR-066 clause 1 and clause 3.** Swallowed gate-signal writes
  (`scripts/check-swallowed-gate-signal.ts`) and the ≥2-independent-producers audit
  (SPEC-054 FR-3) are separate, already-specified work. This spec adds the **"still
  required at all"** axis only.
- **Approval-count, bypass-actor and other ruleset properties.** The witness compares
  required-check contexts. Drift in `required_approving_review_count`, bypass actors or
  merge-method rules is a plausible extension and explicitly not specified here — naming it
  now prevents the scope from widening silently during Plan.
- **Integration-id pinning.** `scripts/audit-ruleset-integration-ids.ts` covers #560's
  wrong-App-id failure. Wiring that unwired script into CI is adjacent, valuable and
  separate.
- **Preventing out-of-repo ruleset writes.** As established above, the write that caused
  #1782 originated outside any repository. Any prevention mechanism for that class is a
  different problem (agent-tooling policy), not this witness.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Fold into SPEC-054 rather than mint SPEC-071.** Rejected — see DQ-6. SPEC-054 is
  approved at `planning` and explicitly scoped this watcher out; amending it would stale a
  signature the human already gave, for a requirement it declined on purpose.
- **Specify option C (lint hand-written PUTs) as the primary fix.** Rejected on evidence,
  not preference: the triggering payload lived in a GitHub issue body, which no repo lint
  can see. It would have produced a green board and an unfixed class.
- **A central scanner in `minspec` that sweeps all `AIClarityAU` repos.** Rejected — it
  reaches into repos that did not opt in, breaking constitution invariant 3, and needs
  org-wide administration read. Per-repo, `.minspec/`-gated scaffolding (FR-8) gets the
  same coverage without the blast radius.
- **Make the witness auto-repair the dropped contexts.** Rejected — INV-4. It would mutate
  a user's repository without consent (DR-050) and, worse, erase the evidence of the write
  that caused the drift, converting a loud finding into a self-healing silence.
- **Reuse `listRequiredCheckContexts` for the read.** Rejected — it collapses read failure,
  parse failure and "no ruleset" into one `null` (`ruleset-advisor.ts:666-675`, `:692`).
  Correct for its caller, disqualifying for a gate (FR-3). SPEC-054 reached the same
  conclusion independently as its DQ-6.
- **Raise `DEFAULT_REQUIRED_CHECK_CONTEXTS` to include `ai-review` / `ready-to-merge` so
  the default and the expected set agree.** Rejected — #559 pinned that default for a
  reason: requiring `ready-to-merge` at init on a repo with no reviewer wired blocks every
  merge on a fresh repo. The fix for the confusion is FR-9's documentation plus FR-1's
  "read, never remember", not a change to the seed.
- **Tier T3 rather than T4.** Rejected for the specify pass. If DQ-1/DQ-4 resolve to a
  scaffolded artifact, the change reaches other people's repositories and touches merge
  gating there, which is the same reasoning that put SPEC-070 at T4. The tier is an
  upward-only floor; if Clarify settles on this-repo-only with no scaffold, T4 stays as
  written rather than being lowered mid-flight.

## Traceability

- **Issue:** [#1782](https://github.com/AIClarityAU/minspec/issues/1782) — "no guard
  asserts a shipped gate is still a required check".
- **Rule in force:** [DR-066](../../../docs/decisions/DR-066.md) — No silent gate
  (`accepted` 2026-07-22) and `.minspec/constitution.md` invariant 2.
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) (invariant 3),
  [DR-090](../../../docs/decisions/DR-090.md) (prose shipped into another repo).
- **Network posture:** [DR-050](../../../docs/decisions/DR-050.md) — read-only probes of a
  repo's own config are autonomous; mutating ruleset writes are consent-gated.
- **Second-witness precedent:** [DR-063](../../../docs/decisions/DR-063.md) / #854 — the
  `ready-to-merge` dual witness, DR-066 clause 3 applied once already.
- **Sibling spec:** [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md) — clauses 1
  and 3; names this gap at `requirements.md:356-359` and declines it.
- **Prior instances of the class:** #560 (wrong App id pin), #810 (best-effort status
  post), #857 (non-required red scan) — the three incidents DR-066 generalised.
- **DR for this spec:** none yet, by design — see DQ-7 for the condition under which one
  becomes required before Plan completes.
