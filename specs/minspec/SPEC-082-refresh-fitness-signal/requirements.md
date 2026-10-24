---
id: SPEC-082
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a refresh that cannot fix the problem must say so, not report success
aspects: [harness-refresh, provenance, signpost, tier-0, fail-closed, supply-chain]
relates_to: [DR-092, SPEC-068, SPEC-060, SPEC-079, DR-003, DR-066]
# Deliberately NO implements:/affects: yet. The one plausible target file
# (harness-provenance.ts, or wherever the `level`-verdict message ends up) is owned by
# SPEC-068's own `implements:`, and SPEC-068 is `plan: in-progress` — unbuilt, its shape
# still moving. Declaring `affects:` on a file that does not exist yet, while DQ-1 below
# is still open on whether this spec's requirement gets folded INTO SPEC-068 rather than
# built as its own increment, would arm the spec-gate over a target neither spec has
# settled (the SPEC-053 blast-radius problem SPEC-060 names for the same reason). Ownership
# is deferred to Plan, once DQ-1 resolves.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-082: A guaranteed-no-op refresh must say it cannot fix external drift, not report success

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1492](https://github.com/AIClarityAU/minspec/issues/1492)** — running
*MinSpec: Refresh Harness Files* from an installed build whose embedded templates are
older than the change that fixed a downstream drift changes nothing, reports success (or,
once [SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md) lands, reports
a bare "up to date"), and leaves the operator no way to tell that the tool itself — not
the repo — is the reason the drift persists. Measured on `AIClarityAU/scroogellm`
(`fix/payg-failover-wiring`): `minspec-ci-parity` failed on 3 of 10 managed files; decoding
the base64 template arrays out of the installed extension's `out/extension.js` and
diffing against `raw.githubusercontent.com/AIClarityAU/minspec/main` showed the installed
build (`0.1.26`, packaged 2026-08-12 15:50) pre-dates the exact commit (`0f928d2`,
2026-08-13 08:27) that fixed those 3 files. Running the refresh would have rewritten each
file with the same stale bytes it already had.

## One-Sentence Scope

When a refresh's direction verdict means nothing would be written because the running
build already matches what the repo has recorded — [SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md)'s
`level` verdict — the report must say, in the same breath, that this build is not ahead of
what already exists and therefore cannot resolve a drift an external check still reports,
instead of reading as an unqualified success.

## Context

### Why this is a distinct gap from SPEC-068, not a duplicate of it

[DR-092](../../../docs/decisions/DR-092.md) and its materialising spec,
[SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md), answer *"is this
write moving the repo backwards?"* — comparing the running build's `TEMPLATE_EPOCH`
against the repo's own recorded `templateEpoch`. That is the right question for #1095 (a
refresh reverting a repo to older content) and its four verdicts already cover it well:
`ahead`/`level` write, `behind`/`unknown` hold and say why (SPEC-068 FR-5).

#1492 is a different failure sitting inside the `level` cell of that same table. `level`
means *this build's epoch equals the repo's recorded epoch* — which is exactly what
happens when the same stale build refreshed this repo before, or scaffolded it originally,
and nothing has changed since. SPEC-068 FR-4 says `level` "write[s] as today (a no-op in
practice)" and FR-5's refusal language is scoped to `behind`/`unknown` only — `level` is
not held, and nothing in SPEC-068 requires it to say anything beyond the ordinary
"nothing to refresh." But a `level` verdict answers *"did the repo move backwards?"*
("no"); it does not and cannot answer *"is what's already here actually current?"* — an
operator who ran refresh **because** an external check (`minspec-ci-parity`) is red gets
the same "up to date" report whether the build is genuinely current or whether it is the
very thing holding the repo back. SPEC-068's Out of Scope section says as much: *"Protecting
a repo from bundles built before this feature. An older bundle ignores a record it
predates; nothing in this spec can change that"* — this spec is the follow-on that takes
that residual and turns the ambiguous-silent case into a legible one, entirely within what
a `level`-verdict build already knows about itself, with no new comparison.

### What is already true (verified against this repo's current `HEAD`, not assumed)

- `harness-provenance.ts` (SPEC-068's own new module) does not exist yet — confirmed by
  `ls packages/minspec/src/lib/ | grep -i provenance` returning only `build-provenance.ts`
  (SPEC-060's, unrelated and dogfood-scoped, see below). SPEC-068's `phases.plan` is
  `in-progress`; nothing in this spec can be built ahead of it (see
  [DQ-1](#decisions-needed-clarify)).
- [SPEC-060](../SPEC-060-build-provenance-stamp/requirements.md) (build-provenance stamp)
  stamps the running build with its own source commit, but its `INV-3` scopes that
  entirely to the **dogfood workspace** (this repo's own `packages/minspec` checkout) by
  construction — confirmed by DR-092's own Follow-ups section: *"No edit to SPEC-060 is
  required by this DR [...] this record does not ask SPEC-060 to widen."* A consumer
  workspace (scroogellm, sealbox, any adopter) gets none of SPEC-060's freshness signal
  today, and this spec does not propose changing that scope either — it uses the
  epoch/provenance identity SPEC-068 is already building for consumer workspaces instead.
- [DR-092](../../../docs/decisions/DR-092.md)'s own Follow-ups list an **unfiled** item
  (d), "the cross-repo correction to sealbox's `minspec-ci-parity` remedy text, which today
  advises the action that causes the drift", and a separately parked, **not decided**
  item: "an opt-in, consent-gated 'newer templates exist' check... it needs its own
  record." Both are adjacent to #1492's complaint and neither is what this spec does — see
  [Out of Scope](#out-of-scope), which exists specifically so this spec is not read as
  quietly resolving either.
- [SPEC-079](../SPEC-079-managed-parity-localization-drift/requirements.md), filed from the
  same scroogellm `minspec-ci-parity` drain, hit the identical "is this DR-092 follow-up or
  a new spec?" question for a different mechanism (a byte-level localization mismatch, not
  a stale build) and resolved it the same way this spec does: its own id, explicitly
  cross-linked, with a Clarify decision on whether to fold. That precedent is followed here
  deliberately rather than re-argued.

### Why the fix stays Tier-0 (no network, no new comparison)

The insight that makes this cheap: a `level` verdict is **self-certifying** that the
running build cannot have changed anything, without needing to know what the *true*
upstream canonical is. `TEMPLATE_EPOCH` (SPEC-068 FR-1) is a source constant baked into the
bundle; `templateEpoch` (SPEC-068 FR-3) is the repo's own tracked record of which epoch
last wrote its managed content. If they are equal, the build in hand is provably not newer
than whatever produced the files already on disk — a fact this repo already computes for
every refresh once SPEC-068 lands, and this spec adds no new fetch, no new comparison, and
no new stored value. It only changes what is said about a fact SPEC-068 already knows.

## Functional Requirements

- **FR-1 — A `level` verdict's report states the epoch-equality fact, not just "nothing to
  do."** When the direction verdict (SPEC-068 FR-4) is `level`, the refresh's output names
  the matched epoch and states explicitly that this build is not ahead of the repo's
  recorded state — distinct wording from `ahead` (which has actually changed something)
  and from `behind`/`unknown` (already held and explained by SPEC-068 FR-5). `ahead` needs
  no change: a write that actually happened is its own evidence of freshness.

- **FR-2 — The message points at the actionable next step without checking anything.**
  Mirroring SPEC-068 FR-5's pattern for `behind` ("update the extension"), the `level`
  message names the same remedy — *if an external check still reports drift, this build's
  templates already match what generated the current files; check whether a newer
  MinSpec release exists before re-running refresh* — without MinSpec making any network
  call to verify it (constitution invariant 1).

- **FR-3 — Surfaces, never recomputes, SPEC-068's own diagnostic fields.** The message
  reuses `writtenBy.version` / `writtenBy.buildSha` / `templateEpoch` from SPEC-068 FR-3's
  provenance record rather than inventing a second source for the same facts — so a human
  never again has to decode base64 template arrays out of a bundled `out/extension.js` by
  hand to answer "which build wrote this," which is exactly the manual step #1492's
  measurement took.

- **FR-4 — Does not silently duplicate DR-092's unfiled follow-up (d).** The cross-repo
  correction to a downstream repo's own `minspec-ci-parity` remedy text is a different,
  already-named follow-up (editing a file this repo does not own or ship). This spec
  cross-links it (done, above and in [Out of Scope](#out-of-scope)) rather than re-solving
  or silently absorbing it.

- **FR-5 — Does not silently duplicate DR-092's parked, undecided network check.** The
  "opt-in, consent-gated newer-templates-exist check" DR-092 explicitly left undecided is a
  different mechanism (it would need to reach the network to know the *true* upstream
  state). This spec's FR-1/FR-2 answer a strictly weaker, Tier-0-provable question — "is
  this build ahead of what's already here" — and must not be read as having resolved the
  stronger, parked question.

- **FR-6 — Blast radius stays opt-in (constitution invariant 3).** The changed message
  reaches only a workspace that already has `.minspec/` and already runs the refresh
  command; nothing here changes behaviour anywhere else.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, [DR-066](../../../docs/decisions/DR-066.md)).**
  A refresh run in direct response to a red external drift signal must never complete with
  a report that reads as unqualified success while the build is provably unable to have
  changed the files that signal is about.
- **INV-2 — Additive to SPEC-068, never a competing implementation.** This spec changes
  what is said about the `level` verdict; it introduces no second epoch comparison, no
  second provenance reader, and ships no code ahead of SPEC-068's own module landing (see
  [DQ-1](#decisions-needed-clarify)).
- **INV-3 — Tier 0 throughout (constitution invariant 1, [DR-004](../../../docs/decisions/DR-004.md)).**
  No network call, no git invocation, no filesystem read outside the workspace. The message
  is derivable with the build and the repo's own tracked record alone.
- **INV-4 — Blast radius (constitution invariant 3).** Nothing here changes behaviour in a
  repo without `.minspec/` at its root.

## Acceptance Criteria

- [ ] **`level` says more than "nothing to do."** A refresh whose verdict is `level` names
      the matched epoch and states that this build is not ahead of what is already
      recorded — provable by a test that runs a refresh twice in a row against a fixture
      repo and asserts the second run's report differs in substance from a bare "up to
      date" string. (FR-1)
- [ ] **`ahead` is unchanged.** A refresh that actually wrote something reports exactly as
      SPEC-068 specifies for `ahead`, with no new caveat language added to a report that
      already proves freshness by having changed something. (FR-1)
- [ ] **The remedy is named, nothing is checked.** The `level` message names "check for a
      newer MinSpec release" as the action, and a test asserts no network call or
      subprocess is made while producing it. (FR-2, INV-3)
- [ ] **One source for the diagnostic fields.** The message's version/buildSha/epoch values
      are read from SPEC-068's own provenance record type, not a second parser or a second
      read of the bundle. (FR-3, INV-2)
- [ ] **DR-092 follow-up (d) is not touched by this spec.** Nothing in this spec's
      implementation edits or proposes editing any file outside this repository. (FR-4)
- [ ] **The parked network check is not implicitly resolved.** This spec's Plan phase
      states explicitly that FR-1/FR-2 do not answer DR-092's undecided "newer templates
      exist" question, and that the question remains open and unassigned. (FR-5)
- [ ] **No behaviour change without `.minspec/`.** (FR-6, INV-4)
- [ ] **No new network call anywhere in this spec's code.** Asserted by a test against the
      same network/child-process allowlist `invariants.test.ts` already guards. (INV-3)

## Decisions needed (Clarify)

- **DQ-1 — Fold into SPEC-068, or ship as this spec's own increment?** SPEC-068 is
  `plan: in-progress` — unbuilt — and FR-1 here is a small, natural extension of its own
  FR-4/FR-5 (the four-verdict report). Building it as a second spec against the same
  not-yet-existing module risks exactly the twinned-enforcement drift [DR-077](../../../docs/decisions/DR-077.md)
  already named as expensive to keep honest for one rule living in two places.
  *Recommendation:* **fold FR-1–FR-3 into SPEC-068 as an amendment to its FR-4/FR-5 before
  SPEC-068 reaches Plan-complete**, and let SPEC-082 stand only as the traceability anchor
  for #1492 (an issue pointing at SPEC-068's amended requirement, per DR-023's
  issue-to-materializing-approvable link), closing this spec without its own
  `implements:`. *Cost:* adds scope to an already-large, in-flight spec and risks stalling
  it further if SPEC-068's own reviewer disagrees with the fold; the alternative (keep
  SPEC-082 standalone) is fully independent but duplicates "where is the `level` message
  owned" the way SPEC-079 DQ-3 flagged for a different pair of specs.

- **DQ-2 — Does FR-1's message apply to every `level` refresh, or only when asked?** The
  common case for `level` is a healthy repo that is genuinely current — printing "this
  build is not ahead" on every such run risks reading as alarming noise rather than
  information, for the overwhelming majority of runs where nothing is wrong.
  *Recommendation:* **always print the short epoch/build-identity line** (matches SPEC-068
  FR-5's existing pattern of naming both epochs even on a routine `ahead`/`level` run), but
  reserve the stronger "may not resolve an external check" framing for a `--verbose` or
  equivalent diagnostic flag, so the common healthy path stays a one-line, calm report.
  *Cost:* a flag most operators will not discover on their own, so the exact operator this
  spec is for (mid-incident, reading a failing downstream gate) has one more step between
  them and the answer unless the base message is inviting enough to prompt it.

- **DQ-3 — Does this spec need its own DR?** No new irreversible choice is made here — the
  epoch comparison, the provenance record, and the fail-closed direction are all DR-092's
  decision; this spec only changes report text for one already-decided verdict.
  *Recommendation:* **no DR required**, record that explicitly (mirrors SPEC-071 DQ-7's
  convention for the same situation) — unless DQ-1 resolves to *not* folding and instead
  widens FR-2's remedy language into something that reaches the network, at which point
  that widening would need its own DR under DR-050's consent framing.

## Out of Scope

- **Reaching the network to learn the true upstream canonical.** DR-092's parked,
  consent-gated "newer templates exist" check. Distinct mechanism (see FR-5); would need
  its own record if taken up.
- **Editing `minspec-ci-parity.yml` or its remedy text in any downstream repo.** DR-092's
  unfiled follow-up (d); lives outside this repository's blast radius by construction
  (constitution invariant 3), same conclusion SPEC-079 reached for a sibling drift.
- **Widening SPEC-060's build-freshness stamp to consumer workspaces.** Already
  deliberately declined by DR-092 itself; this spec uses SPEC-068's separate,
  no-git-required identity instead, precisely so SPEC-060's dogfood-only scope can stand.
- **Building anything before SPEC-068's own module exists**, regardless of how DQ-1
  resolves — there is nothing to attach this message to until then.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| The message is read as DR-092's parked network check having shipped | Both are about "is the build current," worded similarly | FR-5 and the Out of Scope section state the boundary explicitly; AC requires the Plan record to restate it |
| Folding into SPEC-068 (DQ-1) stalls both specs' review | One reviewer now owns two specs' worth of requirements text | DQ-1's cost is named; a human may instead choose to keep SPEC-082 standalone and accept the ownership-location duplication SPEC-079 DQ-3 already accepted for a sibling case |
| The always-on epoch line (DQ-2) becomes noise fatigue on the common healthy path | Every `level` refresh prints it, and most are fine | DQ-2's recommendation keeps the strong framing behind a flag; a human may instead choose silence-by-default if measurement later shows fatigue |

## Traceability

- **Issues:** #1492 (this spec's trigger), #1095 (DR-092's trigger, the reversion this
  spec's sibling mechanism sits beside).
- **Decisions:** DR-092 (the direction-verdict decision this spec extends the reporting
  of), DR-003 (signpost/evidence discipline — a "success" report must not overstate what
  happened), DR-066 (no silent gate), DR-077 (twinned-enforcement cost, cited in DQ-1).
- **Specs:** SPEC-068 (owns the four-verdict gate and provenance record this spec's FR-1–3
  extend; sequencing dependency per INV-2), SPEC-060 (build-provenance stamp, dogfood-only
  precedent this spec deliberately does not widen), SPEC-079 (sibling spec from the same
  scroogellm `minspec-ci-parity` drain, same DR-092-follow-up-vs-new-spec question, same
  resolution pattern).
