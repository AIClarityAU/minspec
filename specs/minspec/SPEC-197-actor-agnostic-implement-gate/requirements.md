---
id: SPEC-197
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals/. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — approval validity (same epic as SPEC-041, whose records this gate reads)
aspects: [approval, spec-gate, ci, git-hooks, enforcement, tier-0, offline, no-silent-gate, blast-radius, never-wrong]
depends_on: [SPEC-041, SPEC-038, DR-062]  # SPEC-041 supplies the ADR/epic records and upstream-stale; SPEC-038 the implements:/affects: ownership convention; DR-062 §3 is the decision this spec carries
relates_to: [SPEC-022, DR-012, DR-031, DR-034, DR-037, DR-047, DR-066, DR-081, "#861", "#460", "#426", "#803", "#517", "#643"]
# Ownership (SPEC-038) is deliberately NOT declared yet. Which files this spec creates
# depends on Clarify D1 (where the verdict engine lives and in what language) and D3 (own
# CI job vs folded into the existing validate job). Declare implements:/affects: in Plan,
# once those are answered and BEFORE approval mints a hash — adding them afterwards voids it.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Actor-agnostic implement-gate at commit time and in CI (Requirements)

> Carries **[DR-062](../../../docs/decisions/DR-062.md) §3** — *"no implementing an unapproved
> approvable" moves to an actor-agnostic gate*. Filed as [#861](https://github.com/AIClarityAU/minspec/issues/861);
> deliberately split out of [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md)
> (its "Out of scope" and FR-OQ4) to keep that spec at T3. DR-062 is `accepted`, so no new
> decision record is needed for the *whether*; the open *how* choices are under
> **Decisions needed (Clarify)** below.

## One-Sentence Scope

A deterministic, offline check — run as a pre-commit stage for early feedback and as a CI
check as the authoritative witness — fails any commit or pull request that adds, modifies,
deletes or renames a file owned by an approvable whose approval is missing, stale (and,
once SPEC-041 ships them, upstream-stale), using exactly the owned-set and verdict rules the
session-local spec-gate uses today, so the rule holds for a human in an editor, a script,
or CI, not only for a Claude Code agent.

## Context (verified 2026-10-16 against this branch's base, `5f792386`)

- **Today's gate is session-local.** The spec-gate is a Claude Code `PreToolUse` hook
  ([scripts/hooks/spec-gate.py:1-80](../../../scripts/hooks/spec-gate.py#L1), wrapped by
  [spec-gate.sh](../../../scripts/hooks/spec-gate.sh)). It denies an agent's Edit/Write; it
  never sees a human editing in VS Code, a `sed` in a script, a `git apply`, or CI. That is
  the first hole DR-062 §3 names.
- **Today's gate is specs-only and T3/T4-only.** It skips any document whose `tier:` is not
  T3/T4 ([spec-gate.py:528](../../../scripts/hooks/spec-gate.py#L528)) and only reads spec
  directories. DRs and epics have no hash-locked approval record at all: SPEC-041 FR-2 would
  add one, but it is **specified, not built** — `upstreamDeps`/`upstream-stale` have no hits
  under `packages/*/src` on this base. No DR (`docs/decisions/`) or epic (`docs/epics/`)
  declares `implements:`/`affects:` on this base either, so even with records there would be
  no owned set to gate. That is the second hole.
- **What the existing gate decides, precisely** — the semantics this spec must reproduce:
  - *Owned set* ([`declared_impl_files` :326](../../../scripts/hooks/spec-gate.py#L326),
    [`owned_file_set` :397](../../../scripts/hooks/spec-gate.py#L397)): structured
    `implements:`/`affects:` paths, matched **without** an existence filter (so creating a
    declared file is gated), plus backtick paths in the spec's own `tasks.md`, matched **only
    if the file exists**. Path validity rules are mirrored in TypeScript by
    [ownership-path-rules.ts](../../../packages/minspec/src/lib/ownership-path-rules.ts),
    with byte-parity pinned by `packages/minspec/tests/ownership-path-parity.test.ts`.
  - *Eligibility*: a spec is checked only when its phase intent is `implementing`/`done`
    ([`phase_intent_status` :221, applied at :565](../../../scripts/hooks/spec-gate.py#L565)).
    A spec still in Specify owns nothing for gating purposes — the #426 lesson
    (pairwise doc-before-code, never a repo-wide freeze; DR-047 §3).
  - *Verdict*: canonical hash of the spec doc vs its committed path-keyed sidecar under
    `.minspec/approvals/` (DR-034). `approved` passes, `unapproved`/`stale` blocks, a
    `migrated: true` record warns but passes ([`select_verdict` :414](../../../scripts/hooks/spec-gate.py#L414)).
  - *Never blocked*: the spec's own docs and `.minspec/` — freezing them would deadlock the
    approval that unfreezes the code.
- **The shipped pre-commit is opportunistic by design.** Stage 3 of the generated hook uses
  whichever validator tier is reachable and degrades rather than bricking a commit
  ([template-registry.ts:1510-1520](../../../packages/minspec/src/lib/template-registry.ts#L1510)),
  and `git commit --no-verify` skips every hook. A pre-commit stage alone therefore cannot
  be the gate under constitution invariant 2 (*no silent gate*: no required check may hinge
  on a single producer one config gap disables). CI is the independent second witness.
- **Precedent for rolling out a CI approval gate.** [scripts/approval-integrity.ts](../../../scripts/approval-integrity.ts)
  (DR-081 §4) reads the same sidecars with the shared canonical `specHash`
  ([canonical.ts:126](../../../packages/shared/src/canonical.ts#L126)) and the same approver
  check (`checkApprover`, [approval.ts:447](../../../packages/minspec/src/lib/approval.ts#L447)),
  and shipped advisory first, "deliberately NOT wired into the branch ruleset" until proven.

**Core gap (one sentence):** the rule "no implementation code for an unapproved approvable"
is enforced only at the tool-call boundary of one agent harness, for specs only, so every
other actor — and every DR and epic — is unconstrained.

## Functional Requirements

- **FR-1 (diff-scoped trigger).** The check evaluates the set of paths a change touches: at
  pre-commit, the staged paths; in CI, the paths changed between the merge base and the head
  of the pull request (or merge group). Added, modified, deleted, and both sides of a rename
  all count as touched. A file the change does not touch is never evaluated — an unapproved
  spec never blocks unrelated work (#426, DR-047 §3).
- **FR-2 (owned set — one definition).** The owned set of an approvable is computed exactly
  as the spec-gate computes it today (structured `implements:`/`affects:` with no existence
  filter; `tasks.md` backtick paths existence-filtered; same path-validity rules). Existence
  is judged against the **post-change tree** (the index at pre-commit, the PR head in CI).
  There is one definition, not two drifting copies: either one implementation shared by
  both gates, or two implementations pinned by a parity test in the style of
  `ownership-path-parity.test.ts` (Clarify D1).
- **FR-3 (eligibility — parity with spec-gate).** An approvable participates when the
  spec-gate would let it participate (T3/T4, phase intent `implementing`/`done`), subject to
  Clarify D2. A change to the spec-gate's eligibility rule and to this check's must be the
  same change.
- **FR-4 (verdict on the post-change state).** The verdict for each eligible approvable is
  computed from the **post-change** tree: its documents' canonical hash vs its committed
  sidecar. So a pull request that approves a spec *and* touches its code passes; one that
  edits an approved spec (voiding it) *and* touches its code fails. `approved` → pass;
  `unapproved` or `stale` → fail; `migrated: true` → pass with a visible warning naming the
  approvable.
- **FR-5 (`upstream-stale`).** Once SPEC-041 FR-1/FR-3 ship, an approvable that derives
  `upstream-stale` fails exactly like `stale`. A record without `upstreamDeps` behaves as
  today (no verdict change). This FR is inert, and says so in its output, until the
  SPEC-041 field exists — it must not be implemented against a guessed record shape.
- **FR-6 (DRs and epics).** Once (a) SPEC-041 FR-2 gives accepted DRs/epics hash-locked
  records and (b) DRs/epics can declare `implements:`/`affects:` (validated by the same
  path rules as SPEC-038), a DR or epic participates on the same terms as a spec. Which
  DR/epic states count as "being implemented" is Clarify D6.
- **FR-7 (overlapping owners).** When a touched path is owned by more than one eligible
  approvable, it fails if **any** owner's verdict fails — one approved owner does not excuse
  another's missing approval. (Within one spec's own documents the spec-gate's existing
  strongest-doc selection is kept, unchanged.)
- **FR-8 (never blocked).** An approvable's own documents, everything under `.minspec/`,
  and approval-record changes are never failed by this check — the deadlock exclusion the
  spec-gate already has.
- **FR-9 (record authenticity).** A sidecar counts as an approval only if its approver
  passes the same `checkApprover` rule `approval-integrity` applies, so a record an agent
  wrote under its own identity cannot open the gate. If SPEC-187's approval witness — a mark
  an agent in this repo cannot produce — ([#517](https://github.com/AIClarityAU/minspec/issues/517)) lands, this check
  verifies that witness too; until then it is honest that the approver field is a claim,
  not a proof.
- **FR-10 (actionable failure output).** A failure lists every blocked path with the
  owning approvable's id, its verdict (`unapproved` / `stale — <doc> edited since approval`
  / `upstream-stale — <ref> changed`), and the remedy: approve it with the palette command
  **MinSpec: Approve Spec** (or the DR/epic equivalent), or move the code change to a
  separate pull request. All failures are reported in one run, not just the first. The
  human-only bypass (Clarify D4) is not advertised in the failure text (DR-031 D2).
- **FR-11 (two tiers, one authoritative).** The pre-commit stage is early feedback and may
  be skipped (`--no-verify`, missing runtime); when it cannot run it prints that it did not
  run — never silent. The CI check is the authoritative witness and **fails closed and
  visibly** on any input it cannot read: base not reachable in the checkout, an unparseable
  sidecar, unreadable frontmatter of an approvable that owns a touched path (constitution
  invariant 2). It never concludes success without having evaluated the diff.
- **FR-12 (rollout mode).** Enforcement level is read from `.minspec/config.json` as
  `off | warn | block`. `warn` reports in full and exits zero; `block` exits non-zero. The
  default and the promotion path are Clarify D5 / D3.
- **FR-13 (session gate retained).** The `PreToolUse` spec-gate stays: it stops the agent
  *before* the edit; this check stops the change from landing. They must agree — a fixture
  set exercised against both asserts identical verdicts for identical trees.
- **FR-14 (CI events).** The CI check runs on `pull_request` and `merge_group`. On a plain
  `push` it either evaluates the pushed range or prints that it did not evaluate and why;
  it never reports a green it did not earn.

## Invariants

- **INV-1 (offline, deterministic — constitution invariant 1).** The verdict is a pure
  function of the git tree(s) and the committed sidecars. No network call, no LLM, in
  either tier. The CI tier uses only what the checkout already contains.
- **INV-2 (no silent gate — constitution invariant 2).** No swallowed error writes the
  verdict; a missing or errored input fails the CI tier closed and visibly; the commit tier
  and the CI tier are independent witnesses, so one hook-path or permission gap cannot
  disable the rule.
- **INV-3 (blast radius — constitution invariant 3).** Both tiers act only in a repository
  carrying `.minspec/` at its root. Nothing this spec ships changes behaviour in a repo
  that did not opt in, and an adopter's existing commit and CI behaviour does not change on
  refresh unless their configured mode says so (D5).
- **INV-4 (never mutates a sign-off).** The check reads approval records; it writes none.
  It never clears or re-snapshots a verdict (DR-062 §4; SPEC-041 INV-1).
- **INV-5 (pairwise, never repo-wide).** Only paths the change touches, owned by eligible
  approvables, can fail. An unapproved approvable never blocks a change that does not touch
  its owned set (#426).
- **INV-6 (no approval deadlock).** Approvable documents, `.minspec/`, and approval records
  are always committable, so the act of approving is never blocked by the gate it unlocks.

## Vertical slices (thinnest-first)

1. **Slice 1 — specs, actor-agnostic (FR-1–4, 7–14).** Parity with today's spec-gate, now
   at commit time and in CI, advisory (`warn`) in this repo first. Closes the "human / CI /
   script unconstrained" hole for specs. Depends only on what exists today.
2. **Slice 2 — `upstream-stale` (FR-5).** Blocked by SPEC-041 Slice 2.
3. **Slice 3 — DRs and epics (FR-6).** Blocked by SPEC-041 Slice 1 (records) and by an
   ownership declaration for DRs/epics (D6). Closes the "specs-only" hole.

The greenfield hole — code no approvable declares — closes only as far as approvables
declare `implements:` (#460 / SPEC-038); this spec does not claim to close it.

## Decisions needed (Clarify)

- **D1 — Where the verdict engine lives.**
  - **(a) (rec)** One pure TypeScript engine (owned set + verdict) in a Tier-0 module, run
    in CI by a `scripts/` entry point beside `approval-integrity.ts`, and shipped to
    adopters through the validator the generated hook and workflow already call; the
    Python spec-gate keeps its own code with a cross-language parity test. *Cost:* two
    implementations stay alive (TS + Python) and only the parity test keeps them honest.
  - (b) Reuse `spec-gate.py`'s functions from a new Python entry point for both tiers.
    *Cost:* CI and adopters need `python3`; the TS validator would not share the logic.
  - (c) Port the spec-gate to TS and call it from the hook via Node. *Cost:* the
    PreToolUse hook gains a Node start-up on every edit and a rewrite of a gate that works.
- **D2 — Eligibility: does a not-yet-`implementing` approvable own anything?**
  - **(a) (rec)** Parity: only `implementing`/`done` intent participates. *Cost:* a human
    can write code for a spec still in Specify, without advancing phases, and neither gate
    fires — the hole is narrowed, not closed.
  - (b) Any unapproved T3/T4 approvable with a structured declaration participates.
    *Cost:* `implements:` often names existing shared files (SPEC-041 owns `approval.ts`),
    so an unapproved draft would freeze unrelated fixes — the #426 class this repo already
    paid for.
  - (c) `implements:` gated whenever unapproved, `affects:` only when implementing.
    *Cost:* same freeze as (b) for shared files listed under `implements:`, and the two
    gates diverge unless the spec-gate changes too.
- **D3 — CI home and promotion.**
  - **(a) (rec)** Its own named check, advisory (`warn`) first in this repo, promoted to a
    required check after a run of clean pull requests with zero false blocks. *Cost:*
    until promoted it is a signal, not a gate, and the promotion is a ruleset change only
    the founder can make.
  - (b) Fold it into the existing required *MinSpec SDD validation* job. *Cost:* it becomes
    required on day one with no false-positive trial, and a push-event run of that job has
    no diff base.
- **D4 — Bypass for an urgent change to code owned by an unapproved approvable.**
  - **(a) (rec)** No in-gate override: approve the spec, split the pull request, or use the
    existing human `--admin` merge as break-glass. *Cost:* `--admin` bypasses every other
    check at once, not just this one.
  - (b) A human-applied PR label or commit trailer naming the reason. *Cost:* any actor
    with a write token (including an agent) can apply a label or write a trailer, so it is
    forgeable unless SPEC-187's witness exists.
- **D5 — Adopter default on scaffold/refresh.**
  - **(a) (rec)** `warn` for every adopter until they set `block`. *Cost:* an adopter who
    never changes the setting gets a visible report but no enforcement.
  - (b) `block` for new `init`, `warn` for refreshed installs. *Cost:* two behaviours to
    document and test, and a new adopter's first unapproved-spec commit fails.
  - (c) `off` until opted in. *Cost:* most adopters never see it.
- **D6 — What "being implemented" means for a DR or epic.** DRs move
  `proposed → accepted`; epics have their own lifecycle; neither has `phases:`.
  - **(a) (rec)** A DR/epic participates once it declares `implements:`/`affects:`;
    touching its owned set fails unless it has a current (non-stale) acceptance record.
    *Cost:* declaring ownership on a proposed DR immediately freezes those files, so
    authors may simply not declare — the gate then sees nothing.
  - (b) Only `accepted` DRs/active epics participate, and only for staleness. *Cost:* code
    for a still-`proposed` DR is never gated, which is the exact gap DR-062 §3 names.

## Acceptance Criteria

- **AC-1 (FR-1, FR-4, FR-11).** In a fixture repo with a T3 spec whose phases say
  `implement: in-progress` and no sidecar, a commit touching a file in its `implements:`
  fails at pre-commit (mode `block`) and the CI check on a pull request with the same diff
  fails; the output names the path, the spec id, and `unapproved`.
- **AC-2 (FR-1, INV-5).** In the same fixture, a commit touching only an unrelated source
  file passes both tiers.
- **AC-3 (FR-4).** A pull request that adds a valid approval sidecar and touches the code in
  the same diff passes; one that edits an approved spec's body and touches its code fails
  with `stale`.
- **AC-4 (FR-2).** Creating a not-yet-existing file listed under `implements:` fails;
  creating a file named only in `tasks.md` backticks (absent in the base) does not; deleting
  and renaming an owned file both fail.
- **AC-5 (FR-7).** A path owned by one approved and one unapproved eligible spec fails.
- **AC-6 (FR-8, INV-6).** Editing the unapproved spec's own `requirements.md`, and any file
  under `.minspec/`, passes in both tiers.
- **AC-7 (FR-9).** A sidecar whose approver fails `checkApprover` is treated as no approval.
- **AC-8 (FR-11, INV-2).** With a corrupt sidecar, or a checkout without the merge base,
  the CI tier exits non-zero with a message naming the unreadable input; a test asserts
  there is no code path that exits zero without evaluating the diff.
- **AC-9 (FR-13).** One shared fixture set produces identical verdicts from this check and
  from `spec-gate.py` for every fixture.
- **AC-10 (INV-1).** No network or LLM module is reachable from the check's entry points
  (import-graph test), and the verdict is byte-identical across repeated runs.
- **AC-11 (INV-3).** In a repo without `.minspec/` at the root, both tiers do nothing and
  say so; with mode `off` they report that they are off.
- **AC-12 (FR-12).** Mode `warn` prints the full report and exits zero; `block` exits
  non-zero on the same input.
- **AC-13 (FR-5, FR-6).** Until SPEC-041's fields exist, the output states that
  `upstream-stale` and DR/epic coverage are not yet evaluated; once they exist, an
  upstream-stale spec and a stale accepted DR with a declared owned set each fail.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **The two gates drift** (Python session gate vs this check), so an agent is allowed what CI then refuses, or the reverse. | FR-2/FR-13 single definition or parity fixtures run against both; changing one without the other fails the suite. |
| R2 | **False blocks erode trust** and drive `--admin` as routine — the "bypass on every use is no gate" shape DR-081 recorded. | D3 advisory-first trial with a zero-false-block bar before promotion; FR-10 output says exactly what to do. |
| R3 | **Forged approval record opens the gate.** | FR-9 approver check now; SPEC-187 witness ([#517](https://github.com/AIClarityAU/minspec/issues/517)) when it lands. Stated as a residual, not claimed closed. |
| R4 | **Shallow CI checkout has no merge base**, and a naive fallback evaluates nothing and passes. | FR-11/AC-8: missing base fails closed and visibly; the workflow fetches enough history to compute the base. |
| R5 | **Shipping to adopters changes their commit behaviour** on refresh. | INV-3 and D5: opt-in marker required; default mode chosen explicitly; refresh never silently raises enforcement. |
| R6 | **Spec number collision.** Many in-flight branches claim ids in the 137–196 range on local remote refs; this spec took 197 as the next id not seen there, but open PRs are not fully visible offline. | Renumber at review time if a collision is reported (the id-at-merge work, SPEC-139 on #267, would remove this class). |

## Out of scope

- Closing the greenfield hole for code no approvable declares — #460 / SPEC-038.
- Symbol-level drift between approved FRs and code (DR-062 leg B, #643).
- Defining SPEC-041's record shape, `upstreamDeps`, or the ADR/epic acceptance record — this
  spec only consumes them.
- Changing the branch ruleset — a founder action after D3's trial, not a code change.

## Traceability

- **Decision:** [DR-062](../../../docs/decisions/DR-062.md) §3. Related: [DR-012](../../../docs/decisions/DR-012.md)
  (HITL spec gate), [DR-031](../../../docs/decisions/DR-031.md) (sound gate, human-only
  audited bypass), [DR-034](../../../docs/decisions/DR-034.md) (committed sidecars),
  [DR-037](../../../docs/decisions/DR-037.md) (scaffolded git hooks),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-081](../../../docs/decisions/DR-081.md) (approval-integrity, advisory-first).
- **Depends on:** [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (records,
  `upstream-stale`), [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) (ownership).
- **Issue:** [#861](https://github.com/AIClarityAU/minspec/issues/861).
