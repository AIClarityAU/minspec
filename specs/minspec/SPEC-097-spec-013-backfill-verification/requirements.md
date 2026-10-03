---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — this spec operationalizes SPEC-013's own floor over the existing corpus, same epic SPEC-013 carries
aspects: [tier-0, deterministic-floor, backfill, signpost-integrity, evidence-discipline, silent-gate, approval-hash]
relates_to: [SPEC-013, SPEC-006, SPEC-010, DR-012, DR-020, DR-029, DR-034, DR-066, "#142", "#121", "#167"]
# This spec's own deliverable cannot be given concrete file ownership yet: the mechanism it
# runs (SPEC-013 FR-9's L0-L3 floor + FR-10 freshness) is itself unbuilt (SPEC-013
# `status: implementing`, zero shipped implementation per SPEC-013's own frontmatter
# `implements_reason`), and the write-mechanism for disposing of findings is an open Clarify
# question (DQ-1/DQ-2/DQ-3 below). Plan declares ownership once SPEC-013 ships and those are
# ratified, per the same SPEC-038 FR-1/FR-2 convention SPEC-013 itself follows.
implements: none
implements_reason: >-
  Blocked on SPEC-013 (`status: implementing`), which has not shipped FR-9's L0-L3 floor or
  FR-10 freshness — the exact mechanism this spec exists to run. There is nothing to invoke
  yet, so there is nothing to name as a NEW owned file until SPEC-013 lands and this spec's
  Clarify questions pick a write-mechanism (DQ-1) and a layer scope (DQ-2).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Run SPEC-013's deterministic floor across the existing corpus as a backfill-verification pass (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or corpus edit is created by this
> document. It is the Specify-phase artifact for
> [#142](https://github.com/AIClarityAU/minspec/issues/142), which triage classified
> `T3/T4` — the spec is the gate, not the fix, and the fix itself cannot start before a
> dependency (SPEC-013) ships.

## One-Sentence Scope

Once [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)'s deterministic floor
(FR-9 L0-L3 + FR-10) is built, run it across every spec and every DR that exists in the
corpus **at run time** — not the frozen "13 specs + 30 DRs" count from the 2026-06-04
manual backfill — and dispose of every finding as a fix or a written, in-artifact escape,
treating each finding as a defect in that manual sweep rather than a new requirement.

## Context

### Why this follows SPEC-013, not replaces it

[SPEC-013](../SPEC-013-risk-section-policy/requirements.md) is the Tier-0 floor itself:
the section registry (FR-1), the single `hasSection` predicate (FR-2), per-FR disposition
coverage (FR-3), and the deterministic layers L0 (disposition) / L1 (specificity → B2) /
L2 (id-based consistency) / L3 (freshness, FR-10). Its own frontmatter
`implements_reason` states plainly that none of this exists yet: `core-end`, `coreHash`,
`SECTION_REGISTRY` and the polarity-cue set return zero hits in `packages/minspec/src`,
`packages/shared/src` and `scripts` (verified again on this branch — same zero hits).
SPEC-013's status is `implementing`, and its own **R2** risk and **RD-1** resolved
decision both name the thing this spec operationalizes:

> RD-1 — backfill before enabling... **Executed 2026-06-04** — all 30 DRs + 13 specs now
> carry the cross-check family (commits `128eeff` specs, `f08b06a` DRs); **FR-6 enablement
> is the remaining gate.**

That backfill was LLM-authored and adversarially reviewed by a human reading prose — not
run through a mechanical predicate, because the predicate did not exist on 2026-06-04 and
still does not. SPEC-013's own Follow-ups name exactly this gap and ask for an issue to be
filed "if not already tracked alongside #121" — #142 is that issue, and this is its spec.

### The corpus has already outgrown the number the issue names

The issue's "13 specs + 30 DRs" is the count **at the time of the manual backfill**, not a
property of the corpus. Measured on this branch today (`2026-10-03`):

| Corpus | Count on `2026-06-04` (RD-1) | Count measured now |
|---|---|---|
| Specs (`specs/*/SPEC-*/requirements.md`) | 13 | **76** |
| DRs (`docs/decisions/DR-*.md`) | 30 | **100** |

Neither count is frozen in this spec's requirements below — per the evidence-discipline
rule that a currency claim expires, this spec's own FR-1 requires the run to measure the
corpus it is given, not a number written into a requirements document months before the
run happens. By the time SPEC-013 ships and this pass runs, both counts will likely be
larger again.

### What presence-only grepping already shows, and why it isn't the answer

A heading existing is not the same question SPEC-013's floor asks (artifact-existence ≠
feature-existence). Measured on this branch:

| Corpus | Has `## Risks...` heading | Has `## Consequences` heading |
|---|---|---|
| DRs (100) | 57 | 96 |
| Specs (76) | 42 | 13 |

These numbers say nothing about L0 (is every `FR-N` paired with a disposition?), L1 (is
the line specific, not vacuous-but-citing-an-id?), L2 (is Out-of-Scope actually disjoint
from the FR set?), or L3 (has the FR set changed since the section was last touched?). A
spec's lower Consequences-heading count than Risks is expected and not itself a finding —
SPEC-013's own FR-13 makes Zone-B depth tier-proportional (T1/T2 carry a smaller family),
so a raw count across mixed tiers is a weak proxy at best. This is exactly why the task is
"run the floor," not "re-grep headings by hand again": a second manual pass would repeat
the same class of miss RD-1's first pass is suspected of making.

### The approval-hash collision this pass will hit, repeatedly

`specHash` (DR-012, amended by DR-034/SPEC-022) is canonical over the **whole spec body**
minus `status:`/`phases:` (`packages/shared/src/canonical.ts`, `getSpecBodyOnly`). Editing
a Risks or Consequences section to fix an L0/L1 finding edits those bytes. Measured on this
branch: **78** specs already carry an approval record under `.minspec/approvals/` — so a
disposition that edits an already-approved spec's body will stale that approval, by
design (DR-012's whole point), on every one of those 78 specs a finding touches. DRs carry
no such hash (DR-051: specs/DRs/epics commit direct on main, gated only by the pre-commit
corpus check), so this collision is specs-only. **This is the single largest scope risk in
this spec and is why DQ-1 below exists** — it is not a corner case, it is the expected
shape of running a stricter, newly-mechanized check over a corpus whose approvals were
minted under a looser one.

### Why no new DR

The policy this pass enforces was already decided — DR-020 (Risks/Consequences required),
its addendum (Consequences shape), and DR-029 (the cross-checks lifecycle) own that. This
spec applies an existing, already-built-once-by-hand decision mechanically; it adds no
store, no setting, and nothing it does is irreversible in under a day (a disposition can be
re-edited, an escape line can be revised, a re-approval can be re-run). A DR would become
necessary only if DQ-1 below resolves to a change in what `specHash` covers — that is a
change to DR-012/DR-034 itself and must not be smuggled in as a side effect of this pass;
see DQ-1's Option C.

## Functional Requirements

- **FR-1 (measure the corpus at run time, not at spec-writing time).** The pass MUST
  enumerate every file matching `specs/*/SPEC-*/requirements.md` and every file matching
  `docs/decisions/DR-*.md` present in the checkout **at the moment it runs**, and MUST NOT
  hard-code the 13/30 or 76/100 counts above as a target or a completion check. Those
  numbers are context for this document only.

- **FR-2 (run only the layers SPEC-013 has actually shipped).** The pass MUST run every
  layer of SPEC-013's floor that is built and merged at the time this spec reaches Plan:
  at minimum L0 (per-FR disposition, FR-3/FR-9), L1 (specificity → B2), L2 (id-based
  consistency) and L3/FR-10 (freshness) — the four SPEC-013 itself states "ship
  independently" of SPEC-006/SPEC-010. L4 (hollow-test, needs SPEC-006) and FR-11
  (FR→section coverage, needs SPEC-010/#121) MUST be included only if those two specs have
  also shipped by then; otherwise they are explicitly out of scope for this run, named as
  such in the report (FR-6), not silently omitted. See DQ-2.

- **FR-3 (every finding gets a disposition, written into the artifact).** Each floor
  finding MUST be resolved as exactly one of:
  - **fixed** — the artifact's own Risks/Consequences/Assumptions/etc. content is edited
    to satisfy the layer, in the artifact's own voice (never a fabricated stub — SPEC-013
    INV-advisory: the enforcement tool offers, it does not author another artifact's
    content);
  - **escaped** — an explicit, in-artifact line disposing of the finding (SPEC-013 FR-3's
    "covered by FR-M" or "happy-path only, accepted" shape), so the disposition survives
    independently of this spec's own PR description and is itself checkable by a later
    run of the same floor.
  No finding may be closed by a note in a PR, issue comment, or commit message alone.

- **FR-4 (no silent skip, including the un-parseable case).** An artifact the floor
  cannot parse — missing `FR-N` ids entirely, predating the SPEC-013 grammar, or any other
  parse failure — MUST be enumerated in the report as its own finding category and given a
  disposition (FR-3), never dropped from the run with no record. See DQ-3.

- **FR-5 (completeness is proved, not asserted).** The report (FR-6) MUST include a
  set-difference check: every path FR-1 enumerated appears exactly once in the report's
  per-artifact listing, and the check fails visibly (constitution invariant 2) if the
  listing and the live directory enumeration disagree when the report is generated. A
  report that silently covers fewer artifacts than exist is the exact fault this pass
  exists to find in the 2026-06-04 sweep, and must not be reintroduced by this one.

- **FR-6 (one consolidated, human-readable report).** The pass MUST produce one artifact
  (report file or tracking issue) grouping findings by layer (L0/L1/L2/L3/unparseable) and
  by disposition (fixed/escaped/out-of-scope-this-run), so "every finding = something the
  manual sweep let through" (the issue's own framing) is checkable by a human in one read,
  not re-derived from a diff.

- **FR-7 (the re-approval wave is explicit, not incidental).** Every spec whose approval
  hash is staled by an FR-3 "fixed" disposition MUST be re-approved through the normal
  Approve Spec flow (DR-012) before this spec's work is considered complete, and the set
  of specs needing re-approval MUST be named up front (derivable from FR-1's enumeration
  intersected with existing approval records) rather than discovered one stale-approval
  warning at a time. See DQ-1 — this FR assumes DQ-1's Option A.

- **FR-8 (scope boundary — a catch-up pass, not a standing gate).** This spec ships no new
  CI check, editor warning, or validator rule that runs on every future save. Turning
  SPEC-013's floor into ongoing, non-silent enforcement for specs/DRs authored *after*
  this pass is SPEC-013's own FR-6 (detect → offer) and FR-13 (lifecycle gating) — this
  spec's job ends when the existing corpus, as enumerated by FR-1, is clean or honestly
  escaped.

- **FR-9 (sequencing — cannot start before its dependency).** No Plan work for this spec
  may begin before SPEC-013 ships the layers named in FR-2 as `done`/merged. This spec's
  own `status` stays `specifying` until then; it is written now so the decision in DQ-1
  and DQ-2 are on record before the dependency lands, not decided under pressure once it
  does.

## Acceptance Criteria

- [ ] The report's per-artifact listing has zero set-difference against a fresh
      `find specs -name requirements.md` / `find docs/decisions -name 'DR-*.md'` run at
      report-generation time. (FR-1, FR-5)
- [ ] Every artifact in that listing appears in the report with a disposition for every
      finding the run's active layers (FR-2) raised against it, or an explicit "no
      findings" line. (FR-3, FR-4, FR-6)
- [ ] No artifact the floor could not parse is absent from the report; each appears under
      the unparseable category with its own disposition. (FR-4)
- [ ] The set of specs whose approval hash goes stale as a direct result of this pass is
      named before any fix is committed, and every member of that set carries a fresh
      approval record by the time this spec's work is marked complete. (FR-7)
- [ ] L4/FR-11 findings are present in the report if and only if SPEC-006/SPEC-010 had
      shipped by run time; their absence is stated, not silent, either way. (FR-2)
- [ ] No new CI workflow, pre-commit rule, or validator check is added by this spec's own
      implementation. (FR-8)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** The run itself — enumerating
  the corpus and evaluating the floor — requires no network call; only the fully
  human-initiated follow-on acts (re-approving a spec, posting the report somewhere) touch
  a remote, as they already do today outside this spec.
- **INV-2 — No silent gate (constitution invariant 2).** Every artifact FR-1 enumerates
  reaches a disposition (FR-3) or an explicit escape (FR-4); the completeness check (FR-5)
  itself fails closed and visibly rather than passing on an empty or partial listing.
- **INV-3 — No borrowed-identity approval.** A re-approval triggered by FR-7 is a real
  human act through the existing Approve Spec flow; nothing in this pass may mint or
  simulate an approval record on a human's behalf.
- **INV-4 — Content stays author-written (SPEC-013 INV-advisory).** A "fixed" disposition
  (FR-3) is written in the artifact's own voice by whoever performs the fix; this pass
  never fabricates Risks/Consequences prose into an artifact it does not own.
- **INV-5 — `specHash` coverage is unchanged by this spec.** This pass may *trigger*
  re-approvals (FR-7); it must not alter what bytes `specHash` covers to make the problem
  go away. Any such change is DR-012/DR-034's decision, not this spec's (see DQ-1 Option C).

## Decisions needed (Clarify)

### DQ-1 — How does the pass handle the approval-hash collision on already-approved specs?

The Context section above measures 78 specs with a live approval record today; any
finding fixed on one of them stales that approval.

- **Option A — accept the re-approval wave, named up front (rec).** Fix every finding
  regardless of a spec's approval state; FR-7 names the affected set before work starts so
  it is budgeted as its own pass rather than discovered one warning at a time.
  **Cost:** potentially dozens of re-approvals land in one event — a real, concentrated
  human-review cost, not spread over normal review cadence. The size of that set is itself
  only knowable once SPEC-013's floor can run, so it cannot be bounded further at Specify
  time.
- **Option B — report-only on already-approved specs; defer the edit to each spec's next
  natural touch.** Only unapproved/`specifying`/`planning` specs get fixed now; approved
  ones get a named, tracked finding with no edit.
  **Cost:** weakens the issue's own framing ("every finding = something the manual sweep
  let through") — a known gap sits open, visible but unfixed, for every already-approved
  spec, indefinitely. That is the trust-by-assertion state SPEC-013 exists to close, now
  reopened for exactly the specs most likely to be cited as "done."
- **Option C — narrow what `specHash` covers so cross-check-only edits don't stale
  approval.** Rejected as an option *for this spec*: it is a DR-012/DR-034 change, not a
  consequence of running a verification pass, and FR-10's own freshness design (binding
  FR-body bytes) already treats a *different* kind of edit as deliberately stale-able.
  Recorded here only so a future session proposing it under this spec's cover is caught —
  INV-5 forbids it.

### DQ-2 — Does this pass wait for SPEC-006 and SPEC-010, or run the independently-shippable layers now?

SPEC-013 itself states L0-L3 + FR-10 "ship independently" of SPEC-006 (hollow-test
scanner, feeds L4) and SPEC-010's #121 amendment (coverage DAG, feeds FR-11); both are
`specifying` today.

- **Option A — run L0-L3 + FR-10 as soon as SPEC-013 ships them; file a second,
  later pass for L4/FR-11 once SPEC-006/SPEC-010 land (rec).** Matches SPEC-013's own
  sequencing (its Open Questions section calls these "sequenced dependencies, not
  blockers"). **Cost:** two passes instead of one, and the second has no date until
  SPEC-006/SPEC-010 do.
- **Option B — wait for all three specs (SPEC-013 + SPEC-006 + SPEC-010) and run the full
  floor once.** **Cost:** this pass — and the reliability gap the issue opens with — waits
  on two more specs with no date, when four of the five floor layers are available sooner
  on SPEC-013 alone.

### DQ-3 — How are pre-SPEC-013-grammar artifacts (no `FR-N` ids at all) handled?

Some of the 100 DRs and a few older specs predate `FR-N` numbering as a convention; FR-9's
L0/L2 key off that id, and FR-12's grammar is new parser work with nothing to parse in
those files.

- **Option A — every such artifact is its own named finding under "unparseable",
  escaped explicitly rather than excluded (rec).** FR-4. **Cost:** likely surfaces a batch
  of legacy-shape findings that need individual triage rather than a bulk rule.
- **Option B — exclude artifacts below a stated id threshold (e.g., pre-DR-020) from the
  run entirely, by a hard-coded cutoff.** **Cost:** a cutoff with no mechanical check that
  everything below it is actually legacy-shaped is the same unverified-exclusion risk this
  whole pass exists to close — an unchecked assumption standing in for a measurement.

## Out of Scope

- **Building SPEC-013's floor itself.** Dependency, not deliverable (FR-9/DQ-2).
- **Turning the floor into a standing CI/editor gate for future specs/DRs.** SPEC-013's own
  FR-6 and FR-13 (FR-8).
- **Re-laying out the corpus to the canonical Zone A/Zone B order.** Tracked separately at
  [#167](https://github.com/AIClarityAU/minspec/issues/167) per SPEC-013's own Follow-ups —
  a structural reorder, mechanically distinct from the content dispositions this pass
  performs, even though both pair with the same 2026-06-04 backfill.
- **Semantic/LLM review of content quality (reality-check, round-table).** EPIC-007
  Slice 2-3, per SPEC-013's own FR-14 scope boundary — this pass is Tier-0 deterministic
  only, same as the mechanism it runs.
- **The consequence/reach risk axis** ([DR-022](../../../docs/decisions/DR-022.md)) —
  already out of scope for SPEC-013 itself (gated on #91 per DR-024), a different signal
  from the doc-section heading this pass checks.

## Traceability

- **Issue:** [#142](https://github.com/AIClarityAU/minspec/issues/142) — "once SPEC-013
  floor is built, run it across all existing specs + DRs."
- **Dependency:** [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) (the floor
  this spec runs; `status: implementing`), consuming [SPEC-006](../SPEC-006-stub-completeness-gate/requirements.md)
  and [SPEC-010](../SPEC-010-signpost-correctness/requirements.md) only for the L4/FR-11
  layers (DQ-2).
- **Operationalizes:** SPEC-013's RD-1 ("backfill before enabling... FR-6 enablement is
  the remaining gate") and its own unfiled Follow-up ("file issue... if not already
  tracked alongside #121") — #142 is that filing, this is its spec.
- **Governing decisions:** [DR-020](../../../docs/decisions/DR-020.md) (Risks/Consequences
  policy, enforced here, not re-decided), [DR-029](../../../docs/decisions/DR-029.md)
  (cross-checks lifecycle), [DR-012](../../../docs/decisions/DR-012.md) /
  [DR-034](../../../docs/decisions/DR-034.md) (the approval hash DQ-1 works around, not
  through), [DR-066](../../../docs/decisions/DR-066.md) (no silent gate, INV-2).
- **Sibling, not absorbed:** [#167](https://github.com/AIClarityAU/minspec/issues/167)
  (canonical zone re-layout), [#121](https://github.com/AIClarityAU/minspec/issues/121)
  (SPEC-010 DAG amendment feeding FR-11).

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4, autonomy
`act`).

- **Re-run the manual (LLM-authored, human-reviewed) sweep again, by hand, a second time.**
  Rejected: that is the exact mechanism suspected of the original miss; a second manual
  pass over a corpus six times larger offers no reason to trust it more than the first.
- **Fold this into SPEC-013 itself as an acceptance criterion.** Rejected: SPEC-013 is the
  mechanism; running it over a pre-existing corpus is a distinct, separately-scoped body
  of work with its own real cost (DQ-1's re-approval wave) that would otherwise hide inside
  SPEC-013's own acceptance criteria and understate SPEC-013's true landing cost.
  SPEC-013's own Follow-ups section asks for exactly this separation ("→ file issue").
- **Hard-code the issue's "13 specs + 30 DRs" as the scope.** Rejected: already measured
  stale on this branch (76/100) before this spec is even approved; see Context.

## Id note

This id was picked by taking the highest `SPEC-NNN` found under `specs/**/requirements.md`
on this branch (`SPEC-096`) and adding one. This dispatch runs with no network access and
is not permitted to check open pull requests or other local worktrees for a claimed
`SPEC-097`, unlike the DR-id collision gate's own check (`scripts/check-dr-id-collision.ts`,
which has no spec-id analogue today). If this id collides with another spec at review
time, renumber per that same convention.
