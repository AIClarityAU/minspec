---
id: SPEC-080
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — same incident family as DR-066 and SPEC-071
aspects: [ci, gates, required-checks, rulesets, integration-id, silent-failure, provenance, tier-0]
relates_to: [DR-047, DR-066, DR-074, SPEC-071, SPEC-054]
# Ownership declared now, at Specify, per SPEC-038 FR-3 / the shipped `/minspec-specify`
# convention and SPEC-071's own precedent note (declaring post-approval stales the hash,
# per `canonical.ts` — `implements:`/`affects:` are inside it).
# The pure decision core and CLI already exist (feat(#560): scripts/audit-ruleset-
# integration-ids.ts, packages/minspec/src/lib/ruleset-integration-audit.ts) and are
# claimed by NO spec's `implements:` (grepped: only this file and SPEC-071/SPEC-054/
# SPEC-065 mention the filenames, and none of those three list them under `implements:`).
# This spec is their first owner, via `affects:` for the existing files (modified, not
# authored, by this change) and `implements:` for the new wiring artifact DQ-1 selects.
implements: []  # the concrete new file (workflow or script) is named once DQ-1 resolves
affects: [scripts/audit-ruleset-integration-ids.ts, packages/minspec/src/lib/ruleset-integration-audit.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: A gate cross-validates every pinned `integration_id` against the App that actually posts the check — and a context nothing has ever posted fails closed

> **This is a SPECIFICATION ONLY.** No code, workflow, or test is created by this document.
> It is the Specify-phase artifact for
> [#1525](https://github.com/AIClarityAU/minspec/issues/1525), which the deterministic
> triage gate classified T3/T4 — ceremony required before any build (DR-076/#1169).

## One-Sentence Scope

Wire the existing, already-built `integration_id` pin audit
(`scripts/audit-ruleset-integration-ids.ts` / `ruleset-integration-audit.ts`, built for
[#560](https://github.com/AIClarityAU/minspec/issues/560)) into a running gate that covers
**every** required-checks ruleset in this repo rather than one hand-invoked ruleset id, and
change its "zero observed check-runs" verdict from inconclusive to a hard failure, so the
exact #560 failure shape — a required check pinned to an App that never posts it — cannot
recur silently.

## Context

### What #560 already fixed, and what it deliberately left open

`#560` found and corrected one live instance: the `ai-review` required check on ruleset
`18352261` was pinned to `integration_id: 15368` (the built-in `github-actions` bot) while
the check is actually posted by the **minspec-sdd** App (`4212099`). The pin was corrected
by hand via the API. Nothing stopped the next ruleset edit from reintroducing the same
unsatisfiable-by-construction state, and the symptom is invisible from a PR: the check never
shows red, it simply can never run, and every merge quietly goes through repo-admin bypass
instead of an enforced pass. This is constitution invariant 2 (no silent gate) in its purest
form — a check that can never be satisfied is a gate that looks green and enforces nothing.

### The backstop already exists as code, and was deliberately left disconnected

A later, more capable change than #1525's own "Verified state (2026-08-14)" snapshot
already landed:

- `scripts/audit-ruleset-integration-ids.ts` (CLI/IO) and
  `packages/minspec/src/lib/ruleset-integration-audit.ts` (pure decision core) — committed as
  `20b8fa1` `feat(#560): add integration_id pin audit for required-check rulesets` — do
  exactly the comparison #1525 asks for: fetch a ruleset's required-check pins, sample recent
  real check-runs, and classify each pin `ok` / `mismatch` / `unobserved` / `unpinned`.
- That commit's own message states the gap this spec closes: *"Wiring this into a periodic
  job is follow-up, out of scope here (this repo's dev role cannot touch CI config)."*
- It is unit-tested (`packages/minspec/tests/ruleset-integration-audit.test.ts`,
  `audit-ruleset-integration-ids.test.ts`) but **wired into nothing**: no npm script, no
  workflow, and it requires `--owner --repo --ruleset-id` that nothing in this repo supplies
  (confirmed: no `grep -rl` hit for `audit-ruleset-integration-ids` under `.github/` or in
  `package.json` scripts).

So **#1525's premise that "the gate is unbuilt" is now only half true**: the decision core is
built and correct; the thing described as missing — a running, repo-wide, fail-closed
witness — is still missing, for two separate reasons:

1. **It is not invoked by anything.** A correct script nobody runs is exactly the "Install ≠
   adopt" failure the project has hit before — detects nothing by sitting on disk.
2. **It only covers one ruleset id, hand-supplied.** `#1525`'s own ask is *"for each repo
   carrying a required-checks ruleset, for each required context"* — the current CLI audits
   the one ruleset id a caller names; it has no step that enumerates every required-checks
   ruleset in the repo, so a second ruleset (or a new one created later) is silently out of
   scope even once the first is wired in.

### The existing core treats "never observed" as inconclusive — #1525 asks for the opposite

`auditRequiredCheckPins` (`ruleset-integration-audit.ts:135-188`) classifies a pinned context
with zero observed check-runs in the sample as `unobserved`, documented as *"Inconclusive …
NOT a failure"* (`:124-126`), and `hasIntegrationIdMismatch` — the function the CLI's exit
code is keyed to — explicitly excludes `unobserved` (`:191-193`, pinned by test at
`ruleset-integration-audit.test.ts:136-141`). That is a reasonable reading for a
**human-invoked, one-off audit**: a context might simply not have run in the sampled window
yet (new context, infrequent trigger, sample too small).

#1525 is explicit that a **running, periodic gate** must read the same situation the other
way: *"Zero observed runs must fail, not pass — a context nothing has ever posted is exactly
the unsatisfiable case this is meant to catch. Per invariant 2, a missing witness fails
closed."* Both framings are internally consistent; they disagree because they are answering
different questions (audit vs. gate). This spec does not resolve that disagreement by edit —
see **DQ-2**, because flipping the shipped, tested `unobserved` semantics is itself a
behavior change to code covered by the `auditRequiredCheckPins` suite's 7 tests
(`ruleset-integration-audit.test.ts:102-179`), 3 of which exercise the `unobserved` status
and one of which (`:136-141`) directly pins `hasIntegrationIdMismatch` to `false` for it —
not a free clarification.

### Where #1525's recommended location collides with blast radius (DR-074 / invariant 3)

#1525's Decision names **Option A: "a CI job in `minspec-validate.yml`"** as recommended.
Read literally, that collides with this repo's own blast-radius rule: `minspec-validate.yml`
is a **managed template region**
(`# >>> minspec:managed:validate-workflow >>>` … `<<<`, `.github/workflows/minspec-validate.yml:1,50`),
the file *Refresh Harness Files* rewrites byte-for-byte in every `.minspec/`-opted-in repo it
scaffolds into. Landing a repo-specific, App-JWT-dependent, ruleset-reading job inside that
shared region would ship a new, credential-dependent requirement into **every adopter repo's
required CI path**, not just this one — the opposite of "the project that did not opt into
this specific capability is unaffected" (constitution invariant 3, DR-074). This is the same
shape of question SPEC-071 already raised and deferred for its own witness (DQ-4: this-repo
first, scaffold as a separate, later landing). **FR-6** below carries this forward:
`minspec-validate.yml` itself is out of scope for the new job; it lands in its own,
repo-local workflow file instead, with scaffolding to other repos deferred to **DQ-4**.

### Credential story is cheaper than #1525 assumed, but still unverified

#1525's Option A names its cost as *"it needs an App JWT to read ruleset config, so the job
depends on the App credential being present."* That mechanism **already exists and already
runs in this repo**: `.github/workflows/ai-review.yml` mints a minspec-sdd[bot] installation
token today via `actions/create-github-app-token` (`:192`) from the `MINSPEC_APP_PRIVATE_KEY`
secret, specifically so a job can act with more than the default `GITHUB_TOKEN`'s permissions.
Reusing that step is not new infrastructure. What is **unverified** is whether the existing
App installation's permission grant already includes repository `administration: read` — the
scope the Rulesets API (`GET /repos/{owner}/{repo}/rulesets/{id}`) requires. Sibling spec
SPEC-071 flags the identical open question for the adjacent `rules/branches` endpoint at its
own DQ-2, unresolved there too (*"has not been probed and must be verified live at Clarify or
Plan"*). This spec does not re-probe it independently — see **DQ-1** — to avoid two parallel,
possibly-contradictory investigations of the same App-permission gap.

## Functional Requirements

- **FR-1 — The witness runs unattended, not just on hand invocation.** The existing CLI
  (`scripts/audit-ruleset-integration-ids.ts`) is invoked by a scheduled and/or per-PR CI job
  rather than requiring a human to run it from a shell. The exact trigger shape (scheduled,
  per-PR, or both, and whether it is a *required* check) is **DQ-3**.

- **FR-2 — Every required-checks ruleset in the repo is covered, not one hand-named id.** The
  wiring enumerates the repo's rulesets (`GET /repos/{owner}/{repo}/rulesets`) and audits
  every ruleset that carries a `required_status_checks` rule, rather than taking a single
  `--ruleset-id` from a hardcoded value. A ruleset added after this ships is covered on its
  next run without an edit to the wiring. This closes the "second ruleset is silently out of
  scope" gap named in Context.

- **FR-3 — Zero observed check-runs for a pinned context fails the gate's exit code.** The
  wiring layer (not necessarily the pure `ruleset-integration-audit.ts` core — see DQ-2) must
  cause the CI job to fail, not pass, when a pinned context's audit status is `unobserved`,
  matching #1525's explicit requirement that a context nothing has ever posted is the
  unsatisfiable case the gate exists to catch. The failure message must say plainly that the
  context was never observed in the sample and that this is being treated as a failure
  **because it is a running gate**, not because the pin is proven wrong — distinguishing it
  from a confirmed `mismatch` (see FR-5).

- **FR-4 — Fail closed and distinguishably on every non-success path.** Every way the job can
  fail to produce a clean verdict is a distinct, explicitly worded failure, never a silent
  pass and never a silent stop: (a) `gh`/API error or non-zero exit from the underlying calls;
  (b) authentication or permission failure (403/404) reading rulesets or check-runs; (c) an
  unparseable response; (d) zero required-checks rulesets found on the repo (itself worth
  reporting, not silently treated as "nothing to check" — a repo that lost its last
  required-checks ruleset entirely is a bigger problem than one bad pin, and the job must say
  so rather than exiting 0); (e) one or more pins `mismatch`; (f) one or more pins
  `unobserved` (FR-3). (a)-(c) must never be reported as "no findings" or success.

- **FR-5 — Findings are actionable and distinguish confirmed-wrong from never-observed.** A
  finding names: the ruleset id and the context, the pinned `integration_id`, the observed
  App id(s) if any, and which of `mismatch` (proven wrong — the exact #560 shape) or
  `unobserved` (never seen — the gate treats it as a failure per FR-3, but the finding must
  not claim the pin is *proven* wrong when it has simply never run). Overclaiming a proven
  mismatch where the honest state is "never observed" would itself be a false signpost
  (project convention: don't write "wrong" when the honest state is "unverified").

- **FR-6 — The job is its own workflow file, not an addition to the managed
  `minspec-validate.yml` template.** Per Context's blast-radius finding, this gate ships as a
  repo-local workflow (or script) that is not part of the managed template region any
  `.minspec/`-scaffolded repo receives automatically. Whether it later becomes a scaffolded,
  opt-in template of its own is **DQ-4** — deferred, not decided here, matching SPEC-071's
  precedent of landing this-repo-only first.

- **FR-7 — Self-coverage.** The job's own expected required-check context (if FR-3's finding
  type is itself wired as a required context — see DQ-3) is included in the enumeration FR-2
  performs; this gate does not exempt itself from the audit it runs.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, DR-066).** No load-bearing read or
  verdict in this feature is best-effort: no `|| true`, no ignored exit code, no
  `continue-on-error` on the path producing the verdict. A missing or errored witness fails
  closed and visibly (FR-4).
- **INV-2 — Blast radius (constitution invariant 3, DR-074).** Nothing this spec ships changes
  behavior in a repo, org, or machine-wide config that did not opt in via `.minspec/`; in
  particular, the managed `minspec-validate.yml` template is not altered by this spec (FR-6),
  so no adopter repo gains a new, credential-dependent requirement without a separate,
  explicit landing.
- **INV-3 — Detection never auto-repairs.** This feature never writes a ruleset. Re-pinning a
  mismatched `integration_id` is a mutating action and stays consent-gated behind an explicit
  human act, matching the DR-050 pattern SPEC-071 restates for its own witness (INV-4 there).
  An auto-healing witness would also mask the edit that caused the drift.
- **INV-4 — The expected set is read from the ruleset API, the observed set is read from real
  check-runs; neither is reconstructed from memory, prose, or a hand-supplied id.** This is
  the direct fix for the "silently out of scope" gap FR-2 closes.
- **INV-5 — No new credential surface without a recorded decision.** If Plan determines the
  existing minspec-sdd App installation does NOT already carry `administration: read`,
  granting it is a governance act requiring its own DR before implementation (DQ-1, DQ-5).

## Acceptance Criteria

- [ ] **The #560 scenario is the fixture** — a fixture reproducing `ai-review` pinned to
      `15368` while only `4212099` posts it is red before the gate is wired in (today: the
      script exists but nothing calls it) and the CI job fails, naming the mismatch, once
      wired. (FR-1, FR-5)
- [ ] **A second ruleset is covered without a config edit** — a fixture or test adds a second
      required-checks ruleset and confirms the job audits it without a hardcoded id change.
      (FR-2)
- [ ] **Never-observed fails the job, with an honest message** — a pinned context with zero
      sampled check-runs makes the job exit non-zero, and the message distinguishes this from
      a proven mismatch. (FR-3, FR-5)
- [ ] **Read/permission/parse failures are each distinct and none is "no findings"** — a test
      or documented manual verification for each of FR-4(a)-(c) confirms a non-zero exit with
      a specific message, never conflated with success or with "zero rulesets". (FR-4)
- [ ] **Zero required-checks rulesets is its own named finding**, not a silent pass. (FR-4(d))
- [ ] **`minspec-validate.yml` is unmodified by this change** — a diff review confirms no edit
      inside the `minspec:managed:validate-workflow` region. (FR-6, INV-2)
- [ ] **Nothing is best-effort** — no `|| true`, ignored exit code, or `continue-on-error` on
      any verdict-producing path in the new wiring; `scripts/check-swallowed-gate-signal.ts`
      passes over it where in scope. (INV-1)
- [ ] **No ruleset write** — a review of the diff confirms the new wiring only calls read
      (`GET`) endpoints. (INV-3)

## Decisions needed (Clarify)

- **DQ-1 — Does the existing minspec-sdd App installation already have `administration: read`?**
  This spec's whole credential cost hinges on this and it has not been probed. **This is the
  same unresolved question as SPEC-071 DQ-2** (different endpoint, same App-permission class)
  — *Recommendation:* resolve both from one probe at whichever spec reaches Plan first, and
  have the other cite the result, rather than two sessions independently calling the same API
  and risking a contradictory answer. *Cost of not doing this:* duplicate investigation, and a
  real risk the two specs record two different answers to the same fact.

- **DQ-2 — Does "zero observed runs fails" change the shipped `ruleset-integration-audit.ts`
  core, or only the CI wiring around it?**
  - **(A) Wiring-only (recommended).** The pure core's `unobserved` status and the 7 tests in
    the `auditRequiredCheckPins` suite (`ruleset-integration-audit.test.ts:102-179`) stay
    exactly as shipped (correct for the human-invoked one-off audit use case they were built
    for); the CI wrapper treats `unobserved` as a failing exit code for *its own* purposes, the
    same way `hasIntegrationIdMismatch` is already a thin policy function on top of the pure
    classification. *Cost:* two call sites now disagree about whether `unobserved` is "a
    failure" — correct per audience, but a future reader must understand the core is
    intentionally more lenient than the gate built on top of it, which this spec's FR-5 and the
    core's own docblock both need to say explicitly.
  - **(B) Change the core.** Flip `hasIntegrationIdMismatch` (or add a stricter sibling) to
    also return true on `unobserved`. *Cost:* breaks the shipped semantics and the suite's test
    at `:136-141` that pins `unobserved` as non-failing for the one-off audit CLI's own exit
    code, for a use case (unattended gate) the core was not written against.
  - *Recorded recommendation:* **(A)** — the gate's stricter read is a property of being a
    *gate*, not a correction to the audit's own honest "I don't know yet" state.

- **DQ-3 — Trigger shape and required-check status.** Scheduled only, per-PR only, or both
  (mirroring SPEC-071 FR-4's two-independent-lanes reasoning for the same incident family)?
  And does the new check itself become a **required** context in this repo once it exists?
  *Recommendation:* both lanes, required in this repo — a scheduled-only witness that is not
  itself required can stop running without anyone noticing (the exact class DR-066 clause 3
  exists for), and SPEC-071 already settles this question the same way for its own witness.
  *Cost:* building a second lane and the self-coverage FR-7 asks for is real, non-optional
  overhead, not a free add-on.

- **DQ-4 — Rollout scope: this repo only, or scaffold to every `.minspec/` repo?**
  *Recommendation:* this repo first, matching SPEC-071 DQ-4's identical call for the sibling
  witness. *Cost:* the other MinSpec-managed repos stay uncovered through the gap between
  landings — acceptable because #560's one confirmed instance was in this repo.

- **DQ-5 — Does this spec need its own DR?** Deferred by the same logic SPEC-071 used at its
  DQ-7: no DR is minted here. *Recommendation:* a DR becomes required before Plan completes
  **only if** DQ-1 resolves to "the App needs a new permission" **or** DQ-4 resolves to
  scaffold-into-other-repos. Either is an outward-facing, not-undoable-in-a-day change — the
  project's ADR filter. *Cost:* one more approval step layered onto a fix for a live,
  already-once-exploited gap, if either condition triggers.
  ➡️ If both resolve the cheap way (no new permission, this-repo-only), record "no DR needed"
  explicitly at Clarify, so the absence is a decision, not an omission.

## Out of Scope

- **SPEC-071's drift witness** (required-check demoted from required to advisory). That is a
  different failure mode of the same ruleset family, already specified separately, and
  explicitly declines this spec's concern at its own Out-of-Scope ("Integration-id pinning …
  adjacent, valuable and separate").
- **Repairing any ruleset found mismatched or unobserved.** Detection only (INV-3); re-pinning
  is a consent-gated human act.
- **Any ruleset property other than `required_status_checks[].integration_id`** —
  `required_approving_review_count`, bypass actors, or merge-method rules are not this spec's
  concern (same boundary SPEC-071 draws for itself).
- **Resolving DQ-1's App-permission question independently of SPEC-071.** It is named here
  for sequencing, not re-investigated here.

## Alternatives considered and rejected

Recorded per DR-086 §4 (autonomy `act` — nobody sees rejected options live).

- **Add the job inside `minspec-validate.yml` as #1525 literally suggested.** Rejected — see
  Context and FR-6: that file is the managed template every `.minspec/`-scaffolded repo
  receives verbatim, so landing a credential-dependent, repo-admin-API-reading job there would
  silently widen blast radius to every adopter (DR-074), not just this repo.
  **This is a genuine correction to the issue's own stated recommendation**, not a restatement
  of it, flagged explicitly because the issue's "Decision for the human" otherwise reads as
  settled.
- **Rebuild the audit from scratch.** Rejected — `scripts/audit-ruleset-integration-ids.ts`
  and its pure core already exist, are tested, and do the comparison correctly; the actual gap
  is wiring plus the enumeration and never-observed semantics named in FR-2/FR-3.
- **Change the pure core's `unobserved` semantics directly (DQ-2 option B).** Rejected as the
  default — it would silently invert the meaning of the `auditRequiredCheckPins` suite's 7
  already-passing, intentionally-scoped tests for a use case (a one-off human audit) the core
  was correctly built against.
- **Resolve the App-permission question independently of SPEC-071 right now.** Rejected —
  both specs need the same fact about the same App installation; investigating it twice risks
  recording two different answers to one question.

## Traceability

- **Issue:** [#1525](https://github.com/AIClarityAU/minspec/issues/1525) — "no check
  cross-validates a required context's pinned `integration_id` against the App that actually
  posts it."
- **Prior incident this hardens:** [#560](https://github.com/AIClarityAU/minspec/issues/560) —
  the `ai-review` mispin itself (closed; tracked the bug, not this hardening).
- **Rule in force:** [DR-047](../../../docs/decisions/DR-047.md) — required-checks design
  rationale; [DR-066](../../../docs/decisions/DR-066.md) — No silent gate (constitution
  invariant 2).
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) — constitution invariant 3,
  the basis for FR-6's correction to the issue's suggested location.
- **Sibling spec, same incident family:** [SPEC-071](../SPEC-071-required-check-drift-witness/requirements.md) —
  the "still required at all" axis; this spec is the "pinned to the right App" axis. Shares
  the open App-permission question (DQ-1 here, DQ-2 there).
- **Existing, unwired implementation:** `scripts/audit-ruleset-integration-ids.ts`,
  `packages/minspec/src/lib/ruleset-integration-audit.ts` — commit `20b8fa1`
  `feat(#560): add integration_id pin audit for required-check rulesets`.
- **Related, not this spec's concern:** `#1120` (App installation permissions), `#1263`
  (false refusal in the sibling pre-push hook).
- **DR for this spec:** none yet, by design — see DQ-5 for when one becomes required.
