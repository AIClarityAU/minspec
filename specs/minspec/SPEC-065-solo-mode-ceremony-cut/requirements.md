---
id: SPEC-065
type: requirements
status: implementing
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — ceremony is the methodology, so cutting it belongs here
aspects: [governance, hitl, auto-merge, branch-protection, ai-review, profile, tier-0]
relates_to: [DR-075, DR-076, DR-033, DR-047, DR-066, SPEC-024, SPEC-038, SPEC-051]
# Declared during Clarify (2026-08-21), in the SAME edit that answered DQ-2 — deliberately
# BEFORE approval mints the hash. SPEC-051 records what happens otherwise: approving first
# forces a post-approval edit, which stales the signature the human just gave.
# DQ-2 resolved to the TWO-STAGE SPLIT, so per DQ-4's enumeration this spec creates and
# therefore OWNS a new witness workflow plus its tests. (An earlier draft mistakenly applied
# the disposition belonging to `pull_request_target` — the outcome DQ-2 rejected — and
# routed the witness to `affects:`.)
implements: [.github/workflows/machinery-witness.yml, packages/minspec/tests/machinery-witness.test.ts, packages/minspec/src/lib/profile.ts, packages/minspec/tests/profile.test.ts, packages/minspec/tests/solo-mode-keep-gates.test.ts]
# `affects:` = modified but owned elsewhere. The two-stage split adds its own workflow
# (owned above) and only ADJUSTS these to consume its witness.
affects: [.github/workflows/ai-review.yml, .github/workflows/ready-to-merge.yml, scripts/auto-merge-gate.ts, scripts/dispatch-issue.sh]
---

# SPEC-065: Solo mode — the DR-076 ceremony cut

## One-Sentence Scope

Introduce a `mode: solo | team` profile and make `solo` the operating default for this
repo, so that work merges unattended on deterministic + AI signals alone, while every
gate that defends against the **model** cutting corners keeps firing untouched.

## Context

DR-075 established that MinSpec is a solo-first personal tool; DR-076 recorded the
keep/kill list for its own governance. Both are accepted. #1169 is the umbrella to
implement them, triaged T4 (`role:architect`) because relaxing branch protection,
removing a human merge gate, and retiring an identity path are architecture-scale and
hard to walk back.

The distinction DR-076 draws, and this spec inherits, is **what a gate defends against**:

- Gates that defend against the **model** (hash-locked approvals, tier floor, validators,
  RCDD, T0-first, independent AI review) run without human attention and stay.
- Gates that exist for **multi-human trust** (a second person's approving keystroke,
  bot-vs-human attribution, presence coordination) have no subject in a solo repo. Their
  human half has degraded to rubber-stamping, which is worse than absent: it records a
  judgement that did not happen.

### What is already true (measured 2026-08-19, not assumed)

Some of the cut is already in place, and the spec must not re-litigate it:

- **Branch protection carries no human-approval requirement.** `required_approving_review_count`
  is `null` on `main`'s ruleset; the required set is six deterministic checks
  (`lint`, `test`, `MinSpec SDD validation`, `ai-review`, `ready-to-merge`, `build`).
- **Native auto-merge is on and config-backed** (`.minspec/config.json` → `autoMerge.native`),
  and non-machinery PRs do merge on a provenance-verified `ai-review:pass` with no keystroke.
- **Auto-drain is on** and triages/dispatches unattended.

### What actually blocks unattended operation

One thing dominates, and it is not the human-approval requirement:

**Every machinery PR needs `--admin`.** A PR touching `.github/**` or `scripts/**` gets
`ai-review` → `neutral`, so no SHA-bound pass witness is posted, so `ready-to-merge` stays
red — and `ready-to-merge` is required. `--admin` is the only path, and `--admin` is
human-only by standing policy *and* bypasses every other required check, not just the one
that is falsely red.

The severity is that it is a **total** block, not that it is frequent. Measured across the
last 30 merged PRs, **4 were machinery (13%)** — so the earlier claim in this spec that
"the exempt case is the common case" was wrong, and is corrected here. It came from the
2026-08-19 batch (#1215, #1257, #1347, #1352, #1599, all machinery), which was a selection
of PRs *chosen because* they were the stuck ones, not a sample of the merge stream.

FR-2 stands on different grounds: a machinery PR cannot reach a green `ready-to-merge` by
**any** unattended path, at any frequency, so 13% of the repo's work is permanently outside
solo mode until #509 lands. A 13% hard block is still a hard block; it is simply not the
majority case, and the requirement should not be argued from a frequency that is not real.

Two further classes were observed producing **false** `ai-review:changes` labels on PRs
whose voters had all returned `verdict: pass, blocking: 0`:

1. **No reviewer failover (#1234).** Voters emitted no verdict block at all; the gate
   correctly failed closed, but the resulting label reads as "the reviewer wants changes",
   which was never true. Observed on #1257.
2. **Protocol-token quoting (#1157).** A reviewer that merely *quotes*
   `REVIEW_VERDICT_BEGIN` trips the >1-marker anomaly rule and fails closed. Observed on
   #1215 — which was blocked by the very defect it fixed. Now merged.

Unattended merging makes both classes more costly, because no human is reading the verdict
to notice it contradicts the artifact beneath it.

## Functional Requirements

- **FR-1 (the profile is a real, single-sourced setting).** A `mode` key with domain
  `solo | team` MUST exist as configuration (`.minspec/config.json`), with exactly one
  resolver that every consumer reads. It MUST NOT be inferable only from an environment
  variable: #183 records the failure mode, where `autoMerge.native` had a config seam and
  `MINSPEC_AUTOMERGE_MODE` did not, so the stricter policy silently reverted to a hold in
  any session lacking the export. *Rationale: a profile that does not survive a fresh
  session is not a profile.*

- **FR-2 (machinery PRs get a merge path that is not `--admin`).** Under `solo`, a PR
  touching `.github/**` or `scripts/**` MUST be able to reach a green `ready-to-merge`
  through a witness that does **not** require a human keystroke and does **not** bypass
  the other required checks. The self-certification property MUST be preserved: the
  reviewing machinery may not be the machinery the PR changes. The specific design —
  base-SHA reviewer, scoped provenance-verified label, or other — is a **Clarify decision**
  (DQ-2), and #509 is the tracking issue. *Rationale: this is the measured blocker; without
  it "solo mode" is unattended for everything except the work this repo mostly does.*

- **FR-3 (auto-merge is the default path, not an opt-in).** Under `solo`, a PR that is
  green on the required checks and carries a provenance-verified `ai-review:pass` MUST
  merge without a human act. The `pr-gate` deny-by-default behaviour is retained as the
  `team` profile's setting, not deleted.

- **FR-4 (a false red must be distinguishable from a verdict).** Because no human reads
  routine PRs under `solo`, a fail-closed refusal caused by reviewer *unavailability* or
  by protocol-parsing anomaly MUST be labelled distinctly from a reviewer that genuinely
  requested changes, and MUST NOT be auto-merged on. `ai-review:blocked` already carries
  this meaning for quota/transient failures; the classes in Context §2 currently collapse
  into `ai-review:changes`. *Rationale: constitution invariant 2 — a gate must fail
  visibly; under automation, "visibly" means machine-distinguishable, not merely worded
  differently in a comment nobody opens.*

- **FR-5 (team machinery is parked behind the profile, never deleted).** Docs-lane,
  presence-gated fast-forward (DR-065), `awaiting-approval` labelling, and team-scale drain
  HITL MUST remain in source and remain reachable under `mode: team`. **Bot-attribution
  token minting is explicitly NOT in this list** — DQ-3 resolved that it stays active under
  `solo`, because the repo is public and the audit trail is read by people who cannot know
  it is solo-operated. *Rationale: DR-076 says parked means retained — reviving team mode
  must not require archaeology.*

- **FR-6 (the keep list is enforced, not merely documented).** A T0 suite MUST assert that
  under `mode: solo` the model-defending gates still fire: hash-locked approval staleness,
  the tier classifier floor, frontmatter/validator gates, the RCDD `Root cause:` hook,
  and the requirement that T3/T4 spec approval and irreversible/outward-facing acts remain
  human. *Rationale: a keep list in prose is model-trusted and will drift; the constitution
  says enforce, don't trust the model.*

## Acceptance Criteria

- **AC-1 (FR-1).** With no environment variables set, a fresh process resolves `mode` from
  config and every consumer agrees. Asserted by driving each consumer's resolver, not by
  reading the config file.
- **AC-2 (FR-1, negative).** An unrecognised or absent `mode` value resolves to the safer
  profile (deny-by-default), never to `solo` by accident. Mirrors `resolveMode`'s existing
  exact-token discipline in `scripts/auto-merge-gate.ts`.
- **AC-3 (FR-2).** A machinery PR that is otherwise green reaches `ready-to-merge` success
  and merges with no `--admin` and no human keystroke, while a machinery PR that changes
  the *witness mechanism itself* still cannot self-certify. Both halves asserted.
- **AC-4 (FR-3).** A green, AI-passed non-machinery PR merges unattended; the same PR under
  `mode: team` holds for a human.
- **AC-5 (FR-4).** A reviewer that emits no verdict block, and a reviewer whose output
  quotes the protocol tokens, each produce a label distinct from `ai-review:changes`, and
  neither is auto-merged. Red-then-green against reproductions of #1234 and #1157.
- **AC-6 (FR-6).** Under `mode: solo`, editing an approved spec's content still stales its
  approval; a T4 task still cannot be ceremony-reduced below its floor; a `fix:` commit
  without `Root cause:` is still rejected. Each asserted by execution, not by source text.
- **AC-7 (FR-5).** With `mode: team`, the parked subsystems are reachable and behave as
  they do today. Guards against the cut being implemented as deletion.

## Invariants

- **INV-1.** Constitution invariant 2 holds unchanged: no gate signal is written with a
  swallowed error, and a missing or errored witness fails closed and visibly. Solo mode
  removes human gates, never deterministic ones.
- **INV-2.** T3/T4 spec approval remains a human act, and no agent may mint an approval
  record, under either profile (DR-056, SPEC-051 FR-5).
- **INV-3.** Irreversible or outward-facing acts — marketplace publish, repo visibility,
  deletions, anything leaving the machine — remain human-gated under both profiles.
- **INV-4.** MinSpec's blast radius is unchanged (constitution invariant 3): the profile
  is per-project and may not alter behaviour in a repo without `.minspec/`.

## Decisions needed (Clarify)

*Clarify pass 2026-08-21. **All four questions are RESOLVED** — DQ-3 and DQ-4 by evidence,
DQ-1 and DQ-2 by founder decision on 2026-08-21 after the options were costed from measured
data. Each records the decision, the rationale, the accepted cost, and its follow-up.*

### DQ-1 (merge freshness) — RESOLVED: turn `strict` on

Unattended merging raises the odds of the #1394 class: two individually-green PRs redden
`main` because a PR's checks run against a base that no longer exists. It already bit —
a duplicate `SPEC-061` reached `main` on 2026-08-19 because the id-uniqueness gate
validated a tree in which only one SPEC-061 existed (repaired by #1574).

**Measured, 2026-08-21:**

- The ruleset's `strict_required_status_checks_policy` was **`false`** when this Clarify
  pass measured it (ruleset `18352261`, read 2026-08-21). **Superseded 2026-08-22** — see
  the APPLIED note under the decision below, which carries the witness showing `true`. The
  measurement is kept rather than overwritten because it is the cost basis the decision was
  taken on. An earlier draft of this Clarify pass "corrected" this to `null`; that
  was wrong. `null` is what the `/rules/branches/main` projection reports because that
  endpoint exposes a differently-named field — the ruleset itself stores `false`. #1394's
  original wording was right, and the correction has been withdrawn.
- Only one rule type is configured on `main`: `required_status_checks`. **No merge queue
  is set up**, so option (b) is new configuration, not a toggle.
- `allow_update_branch` is **`false`**, so today there is not even a one-click "update
  branch" affordance to soften `strict`.
- Merge throughput, last 7 days: 4, 23, 4, 7, 13, 1, 5 per day (median ~5, peak 23). This
  is the cost basis: `strict` serialises merges, so its pain scales with the *peak*, and a
  23-merge day under `strict` means 23 sequential rebase-and-rerun cycles.

**Decision (founder, 2026-08-21): option (a) — turn `strict` on.**

Rationale: under FR-3 no human reads routine PRs, so a red `main` is not noticed by the
person who caused it. It blocks *everyone* until someone happens to look — which is exactly
what happened on 2026-08-19, where the duplicate `SPEC-061` sat on `main` and every open PR
inherited the failure. Serialising merges costs throughput; a red `main` costs the whole
pipeline, and under solo mode it costs it silently.

**Accepted cost, stated plainly:** on a peak day (23 merges observed) this means 23
sequential rebase-and-rerun cycles. `allow_update_branch` is `false`, so there is not even
a one-click update affordance today — enabling it is a sensible companion change and is
NOT part of this decision.

**Follow-up:** #1394 tracks the class and should be closed by the `strict` flip plus a
note recording the throughput trade. A merge queue (option (b)) remains the better
long-term answer if the serialisation cost proves painful; it is not foreclosed.

**APPLIED 2026-08-22** by the founder (ruleset `updated_at: 2026-08-22T12:30:44+10:00`).

Witness, so this is checkable rather than asserted — re-runnable by any reader:

```
$ gh api repos/AIClarityAU/minspec/rulesets/18352261 \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters
          | {strict: .strict_required_status_checks_policy,
             checks: [.required_status_checks[] | {context, integration_id}]}'

{"strict":true,
 "checks":[{"context":"lint","integration_id":null},
           {"context":"test","integration_id":null},
           {"context":"MinSpec SDD validation","integration_id":null},
           {"context":"ai-review","integration_id":4212099},
           {"context":"ready-to-merge","integration_id":15368},
           {"context":"build","integration_id":null}]}
```

Both `integration_id` bindings survived the write (`ai-review` → 4212099,
`ready-to-merge` → 15368) — the bindings `scripts/audit-ruleset-integration-ids.ts` exists
to protect, and which a `PUT` that rebuilt the rules array could silently have dropped,
turning two provenance-bound checks into name-matched ones any producer could satisfy.

The flip was a human act by necessity, not preference: the `minspec-sdd` App has
`admin=false` and the API returns `403 Resource not accessible by integration` on
`PUT /repos/.../rulesets/18352261`. That is the correct boundary — the reviewer App must
not be able to rewrite the protection that gates it — and it is worth recording, because
it means this row of the ceremony cut can never be fully automated.

First observed effect, within minutes: PR #1629 flipped to `BEHIND` and required a
merge-forward before it could proceed. That is the predicted cost arriving on schedule,
not a fault.

### DQ-2 (machinery witness) — RESOLVED: two-stage trusted/untrusted split

**Measured:** `ai-review.yml` triggers on `pull_request` (types `opened, synchronize,
reopened`), so the workflow body is sourced from the **PR head**. That is what makes a PR
able to edit the reviewer that judges it, and it eliminates the naive "just review it
again" fix.

So a base-SHA witness requires either `pull_request_target` (which runs base-trusted
workflow code **with** repository secrets against untrusted head content — the exact shape
that leaks tokens if the job ever checks out and executes head code) or a two-stage job
where an untrusted stage produces only data and a trusted stage posts the witness.

Residual limitation either way: a base-SHA reviewer is blind to defects only the *new*
machinery would catch, so a PR that changes the witness mechanism itself must still stop
for a human. That exception is small and enumerable, unlike today's blanket block.

**Decision (founder, 2026-08-21): the two-stage split, not `pull_request_target`.**

`pull_request_target` runs base-trusted workflow code **with repository secrets** in the
context of untrusted head content. The failure mode is not subtle — one `checkout` of the
head followed by anything that executes head-controlled code (a script, a build step, a
dependency install) exfiltrates the App token that is the root of this repo's entire
provenance story. Getting it right requires never touching head content in that job, which
is a discipline no gate enforces.

The two-stage split inverts the burden: an **untrusted** stage reads the diff and emits
only data, and a **trusted** stage consumes that data and posts the witness. The trusted
stage never executes head-controlled code, so the property is structural rather than
remembered.

**Accepted cost:** more moving parts, and the untrusted→trusted boundary must treat its
input strictly as data (the same discipline `review-decide.sh` already applies to reviewer
output). A PR that changes the witness mechanism itself must still stop for a human — that
exception is small and enumerable, unlike today's blanket block.

**Blast radius, measured:** 4 of the last 30 merges (13%) were machinery.

**Follow-up:** #509 is the tracking issue and already holds the scoped-merge-path ask; it
should record this decision so the design is not re-litigated at build time.

### DQ-3 (bot identity) — RESOLVED: do not retire it under `solo`

DR-076 parks the bot-attribution token path as team-only. The evidence says keep it:

- The repo is **PUBLIC** (`visibility=PUBLIC`, verified 2026-08-21). The audit trail is
  therefore read by people who are not the founder and cannot know the repo is solo-operated.
- DR-056's verdict-record provenance binds **content**, not authorship, so it does not
  substitute for identity.
- The concrete harm is not abstract: GitHub permanently subscribes the **author** of a
  thread, so an agent write made as the human subscribes them to it forever, and the
  history records a person as having done what an agent did — a false signpost in the
  product whose entire claim is that its signposts do not lie.

"Solo" describes who *consents*, not who *reads the record later*. Parking this one saves
nothing at solo scale (the token mint is already automated and free) while giving up a
property that only matters because the repo is public.

**Decision:** `mode: solo` does **not** retire bot attribution; the row stays `team`-parked
only for the *coordination* machinery around it, not the identity itself.

This contradicts a row in accepted DR-076, and a spec cannot amend an accepted decision on
its own. The founder confirmed the amendment on **2026-08-21**, and it is recorded at the
source — DR-076's "Cut or park" table now carries an amendment note pointing here, so the
two records agree and neither has to be read through the other to be correct.

### DQ-4 (ownership) — RESOLVED for the declaration, deferred only in extent

`implements:` must be in the approved bytes (SPEC-051). It cannot be finalised before DQ-2,
because the witness design determines which files are created. But the *shape* is settled
and the declaration is enumerable per outcome:

- Always owned: the `mode`/`autonomy` resolver module and its T0 suite (FR-1, FR-6).
- If DQ-2 = two-stage job: a new workflow (or job) file plus its tests.
- If DQ-2 = `pull_request_target`: no new file; an edit to `ai-review.yml`, which is owned
  elsewhere and therefore belongs in `affects:`, not `implements:`.

**Follow-up task:** write `implements:` (or `implements: none` + `implements_reason:`)
into the frontmatter **in the same edit that answers DQ-2, before approval**. Approving
first and adding it after is precisely the trap SPEC-051 records — the post-approval edit
stales the signature the founder just gave.

## Risks

- **Accepted (DR-076).** With no human reading routine PRs, a wrong-but-plausible change
  that passes tests and AI review lands. Mitigation is the layered deterministic gates plus
  the retained T3/T4 read — the same bet the product makes for its users.
- **Concentration.** `ai-review` becomes the only reader on most changes, so its
  no-silent-gate properties matter more, not less. FR-4 exists because two distinct false-red
  classes were observed in a single day.
- **Irreversibility.** Protection relaxation is the least reversible element; it is also the
  element already largely in place, which reduces but does not remove the exposure.

## Out of Scope

- Building `team` mode as a supported product configuration. It is parked, and reviving it
  is design work under DR-075 §4.
- Any change to what MinSpec installs in an adopter's repo. This spec governs **this**
  repo's own workflow (INV-4).
- The `--dry-run` argument defect (#1591) and the reviewer failover work (#1234), which are
  independently tracked and merely make solo mode safer.

## Traceability

- **Decisions:** DR-075 (solo-first), DR-076 (keep/kill list), DR-033 / DR-047 (review
  gating), DR-066 (fail-closed required checks), DR-065 (presence-gated ff — parked).
- **Issues:** #1169 (umbrella), #509 (machinery merge path, FR-2), #183 (gate-placement
  config, FR-1), #1234 (reviewer failover, FR-4), #1157 (token quoting, FR-4), #1394
  (merge freshness, DQ-1), #816 (eager `needs-human-review`).
- **Specs:** SPEC-024 (auto-merge gate), SPEC-038 (ownership), SPEC-051 (declare ownership
  before the hash is minted — the reason this spec's `implements:` is deferred to Clarify).
