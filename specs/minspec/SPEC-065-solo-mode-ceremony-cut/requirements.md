---
id: SPEC-065
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — ceremony is the methodology, so cutting it belongs here
aspects: [governance, hitl, auto-merge, branch-protection, ai-review, profile, tier-0]
relates_to: [DR-075, DR-076, DR-033, DR-047, DR-066, SPEC-024, SPEC-038, SPEC-051]
# No `implements:` yet — this spec is `specifying`, pre-Clarify, so SPEC-038 FR-3 has not
# armed. It MUST be declared during Clarify, BEFORE approval mints the hash: SPEC-051
# records what happens otherwise (approving without it forces a post-approval edit, which
# stales the signature the human just gave). The Clarify decisions below determine which
# files this spec owns, so the declaration cannot honestly be written until they close.
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

This is not an edge case: of the PRs handled on 2026-08-19, #1215, #1257, #1347, #1352 and
#1599 were all machinery. In a repo whose product *is* its machinery, the exempt case is
the common case. #509 tracks the scoped alternative.

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
  presence-gated fast-forward (DR-065), `awaiting-approval` labelling, bot-attribution
  token minting, and team-scale drain HITL MUST remain in source and remain reachable
  under `mode: team`. *Rationale: DR-076 says parked means retained — reviving team mode
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

- **DQ-1 (merge freshness).** Unattended merging raises the odds of the #1394 class, where
  two individually-green PRs redden `main` because `required_status_checks.strict` is
  `false`. On 2026-08-19 this produced a duplicate `SPEC-061` on `main`: the uniqueness
  gate existed and passed, because it validated a tree in which only one SPEC-061 existed.
  Does solo mode turn `strict` on, adopt a merge queue, or accept the risk? Each has a real
  cost — `strict` serialises merges and forces a rebase per PR.
- **DQ-2 (machinery witness).** Which design satisfies FR-2 (see #509)? A base-SHA reviewer
  preserves "a gate cannot certify itself" but is blind to defects only the *new* machinery
  would catch, and `on: pull_request` sources the workflow from the head, so it needs
  `pull_request_target` or a two-stage job with the security posture that implies.
- **DQ-3 (bot identity).** DR-076 parks the bot-attribution token path. But this is a
  **public** repo, and DR-056's verdict-record provenance binds content, not authorship.
  Does retiring it under `solo` lose an audit property that still matters, given a
  third party reading the history cannot tell a solo repo from a team one?
- **DQ-4 (ownership).** Which files does this spec own? Required before approval — see the
  frontmatter note. Depends on DQ-2.

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
