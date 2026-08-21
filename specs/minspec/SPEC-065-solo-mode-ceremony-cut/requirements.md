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

*Clarify pass 2026-08-21. Each question below is now either **RESOLVED** with the evidence
that settles it, or **OPEN** with the founder decision it needs, the measured cost of each
option, and a follow-up task. No question is left as a vague concern.*

### DQ-1 (merge freshness) — OPEN, founder decision

Unattended merging raises the odds of the #1394 class: two individually-green PRs redden
`main` because a PR's checks run against a base that no longer exists. It already bit —
a duplicate `SPEC-061` reached `main` on 2026-08-19 because the id-uniqueness gate
validated a tree in which only one SPEC-061 existed (repaired by #1574).

**Measured, 2026-08-21:**

- The ruleset's `required_status_checks.strict` is **`null`** (unset), not `false` as this
  spec previously stated. Effect is the same — branches need not be up to date — but the
  earlier wording named a value the API does not report.
- Only one rule type is configured on `main`: `required_status_checks`. **No merge queue
  is set up**, so option (b) is new configuration, not a toggle.
- `allow_update_branch` is **`false`**, so today there is not even a one-click "update
  branch" affordance to soften `strict`.
- Merge throughput, last 7 days: 4, 23, 4, 7, 13, 1, 5 per day (median ~5, peak 23). This
  is the cost basis: `strict` serialises merges, so its pain scales with the *peak*, and a
  23-merge day under `strict` means 23 sequential rebase-and-rerun cycles.

**Options.** (a) turn `strict` on — correct, and costly exactly on the busy days;
(b) adopt a merge queue — same guarantee without serialising the author's work, but it is
net-new configuration and interacts with the machinery gate in DQ-2; (c) accept the risk
and rely on the post-hoc uniqueness gate — cheapest, and the failure mode is a red `main`
that blocks everyone until repaired, which is what happened.

**Follow-up if unresolved:** #1394 already tracks the class. This spec should not ship
FR-3 (auto-merge as default) without DQ-1 answered, because unattended merging is what
raises the rate.

### DQ-2 (machinery witness) — OPEN, founder decision; one option eliminated

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

**Blast radius, measured:** 4 of the last 30 merges (13%) were machinery.

**Follow-up:** #509 is the tracking issue and already holds the scoped-merge-path ask.

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

**Proposed decision:** `mode: solo` does **not** retire bot attribution; the row stays
`team`-parked only for the *coordination* machinery around it, not the identity itself.

This **contradicts an accepted DR**, so it is a recommendation, not a settled fact. DR-076
is `accepted`, and a spec cannot amend an accepted decision on its own — approving SPEC-065
with this paragraph is the act that carries the amendment, and the founder should confirm
they intend that rather than inherit it silently. If instead DR-076's row is to stand, this
DQ reverts to OPEN and FR-5 must list bot-attribution among the parked machinery again.

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
