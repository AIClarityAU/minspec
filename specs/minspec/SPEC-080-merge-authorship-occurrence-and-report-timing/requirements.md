---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — derived-state truthfulness (the harness-refresh authorship record and its notice must not lie about which section, or which moment, MinSpec is talking about)
aspects: [harness-refresh, authorship, manifest, duplicate-headings, notice-timing, never-wrong, tier-0]
relates_to: [DR-089, SPEC-043]
implements: [packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/lib/scaffold.ts]
affects: [packages/minspec/tests/merge-refresh.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: Authorship maps key by occurrence, and a withheld update is reported when it costs the user something

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1724](https://github.com/AIClarityAU/minspec/issues/1724)** — two latent
defects found by the third adversarial review of the #1697 fix, deliberately deferred off
that branch because neither is reachable with a wrong outcome today and fixing them
mid-branch would have widened an already-large change. [DR-089](../../../docs/decisions/DR-089.md)
names both explicitly in its own Follow-ups (`docs/decisions/DR-089.md:123-124`) as
`minspec#1724`.

## One-Sentence Scope

Make the harness-refresh authorship bookkeeping (`withheldTemplateHashes`,
`unauthoredHeadings`, `preservedWithoutBaseline` in `mergeFile`, and the
`preservedWithoutBaseline` notice it feeds) correct for a document with a duplicate `##`
heading, and honest about *when* a withheld template update actually costs the user
something, without reopening the alert-fatigue defects earlier #1697 rounds removed.

## Context

Both defects were found, not hypothesized: the reviewer traced `mergeFile` and
`preservedWithoutBaselineMessage` line by line rather than inferring from the #1697 PR
description, per this project's Evidence Discipline rule (plausible-inference ≠
observation). Re-verified against this repo's current `HEAD` for this spec.

### Defect 1 — authorship maps key by heading string, not by occurrence

`mergeFile` ([merge-refresh.ts:640](../../../packages/minspec/src/lib/merge-refresh.ts#L640))
already treats *content* correctly per occurrence: existing sections with a duplicate
heading are queued positionally (`existingByHeading: Map<string, Section[]>`,
[:666-678](../../../packages/minspec/src/lib/merge-refresh.ts#L666)) and consumed one at a
time as the template's own occurrences of that heading are processed in order
([:738-741](../../../packages/minspec/src/lib/merge-refresh.ts#L738)) — so if the template
*also* carries the heading twice, the loop body runs once per pair and can reach two
genuinely different content decisions (hold vs. take-template) for the two pairs.

The **authorship bookkeeping** the same loop body writes does not have the same
granularity. `dispositionDecided`, `withheldTemplateHashes`, and `unauthoredSeen` are all
keyed by the bare heading string, and every write site guards on
`!dispositionDecided.has(heading)`
([:820](../../../packages/minspec/src/lib/merge-refresh.ts#L820),
[:946](../../../packages/minspec/src/lib/merge-refresh.ts#L946),
[:977](../../../packages/minspec/src/lib/merge-refresh.ts#L977)), with
`dispositionDecided.add(heading)` fired once per loop iteration regardless of which
occurrence it was ([:985](../../../packages/minspec/src/lib/merge-refresh.ts#L985)). So
when the template ships a heading twice and the two existing↔generated pairs reach
*different* dispositions — say, pair 1 is proven unmodified and pair 2 is held without a
baseline — only pair 1's decision is ever recorded: pair 2's hold is silently dropped from
`withheldTemplateHashes`/`preservedWithoutBaseline`/`unauthoredHeadings` because
`dispositionDecided` already reads `true` by the time pair 2's branch runs. The
`MergeResult` docstring states this as a deliberate design property — "first-occurrence-wins
… ALWAYS an object" ([:162-164](../../../packages/minspec/src/lib/merge-refresh.ts#L162),
repeated at [:197-199](../../../packages/minspec/src/lib/merge-refresh.ts#L197)) — but the
property is a simplification the surplus-occurrence case (template has the heading once,
existing has it twice — see `hasAuthoredContent`'s partner pass at
[:997-1061](../../../packages/minspec/src/lib/merge-refresh.ts#L997)) happens to make safe,
not a guarantee that holds when the *template* also repeats the heading.

Nothing is red today because no fixture exercises the second shape. `merge-refresh.test.ts`
AC-52 and AC-52b (`packages/minspec/tests/merge-refresh.test.ts:2486` and `:2514`) pin
duplicate-heading authorship, but both give the **template** exactly one `## Goals`
occurrence — the scenario they cover is "existing has a surplus occurrence the template
never claims," which the leftover-preserve pass ([:997](../../../packages/minspec/src/lib/merge-refresh.ts#L997))
handles correctly by construction (a surplus occurrence with no template counterpart has
only one possible disposition: record nothing, per AC-52). Neither test gives the
**template** two occurrences of the same heading whose paired existing occurrences should
reach genuinely different dispositions — the shape defect 1 describes. That is the missing
gate, per this project's RCDD sibling rule: the bad state ("pair 2's hold vanished") is a
symptom; the mechanism is heading-keyed bookkeeping under positionally-decided content; the
missing gate is a duplicate-heading fixture where the two paired decisions diverge.

The persisted manifest (`.minspec/generated-hashes.json`) is *itself* heading-keyed —
`{ [filePath]: { [heading]: hash } }`, unchanged since [SPEC-043](../SPEC-043-harness-refresh-manifest-consistency/requirements.md)
— so even a fully occurrence-aware `mergeFile` can only ever persist **one** hash per
heading per file at the end of a run. Fixing the *in-memory* silent-override is necessary
regardless; whether the *persisted* record also needs to become occurrence-aware (a format
change reaching every adopter's `.minspec/generated-hashes.json`, in the spirit of
[DR-089](../../../docs/decisions/DR-089.md) §3's `hashVersion` stamp) is the open question
this spec routes to [DQ-1](#decisions-needed-clarify).

### Defect 2 — the withheld-update report fires once, at decision time, not at consequence time

`preservedWithoutBaseline` is populated by `reportHold()`
([:706-712](../../../packages/minspec/src/lib/merge-refresh.ts#L706)), called from exactly
two branches: the fail-closed no-baseline branch
([:950](../../../packages/minspec/src/lib/merge-refresh.ts#L950)) and the INV-2
authored-list-items guard
([:826](../../../packages/minspec/src/lib/merge-refresh.ts#L826)). The third branch that
also holds a body while withholding a template update — "user modified this section, keep
it" ([:951-979](../../../packages/minspec/src/lib/merge-refresh.ts#L951)) — never calls
`reportHold`. That branch is exactly the one every hold transitions into on its *second*
and later refresh, because [DR-089](../../../docs/decisions/DR-089.md) §1 makes the first
hold record the withheld template's hash as `oldHash`
([:947](../../../packages/minspec/src/lib/merge-refresh.ts#L947),
[:978](../../../packages/minspec/src/lib/merge-refresh.ts#L978)), and `existingHash !==
oldHash` is then permanently true for as long as the section stays held — routing every
later refresh through the silent branch regardless of whether the *template* has changed
further since the hold began.

`scaffold.ts` then builds **one notice per refresh** from whatever `preservedWithoutBaseline`
entries that refresh's `mergeFile` calls returned
([:1654-1682](../../../packages/minspec/src/lib/scaffold.ts#L1654)) — correctly, by design
("ONE message for the whole refresh, not one per file," #1697 F3,
[:579-583](../../../packages/minspec/src/lib/scaffold.ts#L579), to avoid the toast-queue
alert fatigue earlier rounds measured and removed). The design is sound; the input it is
fed is not: because `mergeFile` never reports the continuing-hold branch, a refresh where
the template ships a genuinely new change into an already-held section produces
`notices: []` — silent at exactly the moment a real update was withheld, having been loud
only once, earlier, about a different (predicted, not yet real) future.

Reproduced end to end, per the issue: refresh #1 holds a section with no baseline, reports
it once (correct — this is the `preservedWithoutBaseline`/fail-closed path). Refresh #2, the
template now carries a **further** ratified change to that same section (a newer invariant
the user never received); the hold continues via the "user modified" branch; `notices` is
`[]`. The user was told once, at hold time, that an update was withheld — a prediction about
a future that had not happened yet — and is told nothing when the withholding materializes.
The issue's own framing: "the honest shape is either a report at the point the update is
withheld, or a standing indicator that the section is held, rather than a single past-tense
notice." Both are legitimate; [DQ-2](#decisions-needed-clarify) exists because the choice
carries a real cost either way, named below.

**Constitution framing.** The issue cites invariant 2 ("no silent gate"); this report is not
a merge-gating CI check, so the literal text of invariant 2
(`.minspec/constitution.md:8`) does not bind it directly. The applicable principle is **G-4 —
signpost** (`.minspec/constitution.md:46`, "always tell the human the one thing to review
next") and the never-wrong signpost framing DR-055 §3 and this codebase's own docstrings
already invoke for this exact mechanism — `MergeResult`'s docstring states "silently
preserving is better than silently overwriting, but it is still silent (constitution
invariant 2)" ([:128-129](../../../packages/minspec/src/lib/merge-refresh.ts#L128)). This
spec keeps that existing citation rather than re-litigating it, while naming G-4/DR-055 §3
as the more precisely applicable principle for a reviewer checking the citation against the
constitution's literal text.

### Missing-gate note (RCDD, both defects)

Per this project's RCDD sibling rule — a description of a bad state is not its root cause.
For both defects the bad state (a decision vanishes; a notice never fires) is a symptom; the
mechanism is named above for each (heading-keyed bookkeeping under positional content
decisions; `reportHold` uncalled from the continuing-hold branch); the missing gate in both
cases is the **absence of a fixture that can turn red** — no test drives a template with two
occurrences of one heading to divergent dispositions (defect 1), and no test drives a second
refresh where a hold is already in effect and the template changes further underneath it
(defect 2). Any fix this spec's Plan phase produces must ship the fixture that fails on
today's code and passes after, for both defects (red-before-green, matching this corpus's
own convention — see SPEC-043 AC-1/AC-7).

## Functional Requirements

- **FR-1 (occurrence-safe authorship decisions, in-memory).** Within one `mergeFile` run, no
  occurrence's authorship disposition (held-with-report, held-with-withheld-hash, or
  record-nothing) may be silently discarded or overwritten by a different occurrence's
  disposition under the same heading. Every `genSection`/`existSection` pair the loop body
  decides MUST contribute its own disposition to the in-memory bookkeeping; a later
  occurrence's decision must never be dropped because an earlier occurrence already "decided"
  for that heading string.

- **FR-2 (no occurrence's hold goes unreported).** Every occurrence that withholds a
  genuine template update (per the existing `withheldSomething` / `generatedAddsContent`
  test the fail-closed and INV-2-guard branches already use) MUST be represented in
  `preservedWithoutBaseline` reporting for that refresh — never silently absorbed because a
  different occurrence of the same heading happened to be unmodified.

- **FR-3 (one persisted hash per heading — reconciliation is explicit, not accidental).**
  Because `generated-hashes.json` stays heading-keyed (FR-3 does not itself change the
  persisted schema — see [DQ-1](#decisions-needed-clarify)), where two occurrences of one
  heading reach different in-memory dispositions, the single value this run persists for
  that heading MUST be derived by a stated, documented rule — not by "whichever occurrence's
  write statement executed last" as today. The rule must never let a *more permissive*
  occurrence's evidence (e.g., "proven unmodified") stand in for a *less permissive*
  occurrence's (e.g., "held without evidence") under the same key, because that is precisely
  the silent-misattribution shape defect 1 describes: the next refresh must not read a
  forged "proven" claim for content it never actually proved.

- **FR-4 (a withheld update is reported when it lands, not only when the hold begins).** A
  refresh where the template's rendered body for a held section differs, in content, from
  the template body that was withheld and recorded at the hold's most recent report (i.e.
  `hashSection(genSection.body)` diverges from the `oldHash` this run reads, which
  [DR-089](../../../docs/decisions/DR-089.md) §1 guarantees is the previously-withheld
  template's hash whenever the section is already held) MUST surface a notice for that
  heading on **this** refresh — the consequence-time report the issue asks for — using
  whichever shape [DQ-2](#decisions-needed-clarify) resolves to (a fresh per-consequence
  notice, or a standing held-section indicator kept current).

- **FR-5 (no regression of #1697's anti-noise design).** FR-4 MUST NOT report a hold on a
  refresh where the template has not changed since the last report for that heading — the
  exact repeat-nagging shape #1697 F3's "one message for the whole refresh" and the
  settled-hold silence (`merge-refresh.test.ts:2476`, "the second refresh holds on recorded
  evidence and is silent") were written to prevent. The discriminator is content-level
  (mirrors `sectionContentDiffers`/`generatedAddsContent`'s existing basis), not a byte
  comparison, for the same reason the rest of this file already avoids byte comparisons
  (`renderTemplate`'s own re-rendering is permanently byte-different from a settled section —
  see `MergeResult` docstring point 2 at
  [:115-124](../../../packages/minspec/src/lib/merge-refresh.ts#L115)).

- **FR-6 (existing pinned behavior is revised deliberately, not incidentally).**
  `merge-refresh.test.ts` AC-52 and AC-52b
  (`packages/minspec/tests/merge-refresh.test.ts:2486`, `:2514`) currently pin
  first-occurrence-wins heading-keyed semantics for the surplus-occurrence case. Plan MUST
  state explicitly whether FR-1/FR-3's reconciliation rule changes either assertion's
  expected value, and if so why the new value is still correct for that case (AC-52/AC-52b
  cover a shape — template has one occurrence, existing has a surplus — where the bug this
  spec fixes cannot manifest, so a careful implementation may leave both green unchanged;
  Plan must show that, not assume it).

## Invariants (must not break)

- **INV-1 — No content loss (#153).** A document with a duplicate `##` heading never loses
  either occurrence's body across a refresh. Unchanged by this spec; FR-1–FR-3 touch only
  which *authorship record* is kept for a heading, never which *body* the merge writes.
- **INV-2 — No silent misattribution.** The persisted manifest never records, for a heading,
  a disposition that is truer of one occurrence than the one the recorded hash actually
  describes when the two diverge (FR-3). A reconciliation that is conservative and
  documented satisfies this; one that silently prefers whichever occurrence's code path ran
  last does not.
- **INV-3 — No alert-fatigue regression (#1697 F3).** The per-refresh notice stays exactly
  one message for the whole refresh (not one per file, not one per held section); FR-4 adds
  a new *trigger* condition (content changed since the hold's last report) without changing
  that shape, and FR-5 is the explicit guard against re-firing on an unchanged hold.
- **INV-4 — Offline, Tier-0 (constitution invariant 1).** No part of this fix — the
  reconciliation rule, the consequence-time trigger, or any new fixture — reaches the
  network or shells out. Pure filesystem + string/hash comparison, matching every existing
  function in `merge-refresh.ts`.
- **INV-5 — Existing #1697/DR-089 guarantees hold.** The fail-closed-on-missing-baseline
  rule, the withheld-template-hash recording (DR-089 §1), and the unauthored-heading deletion
  (DR-089 §1) are unchanged in their single-occurrence form; this spec only closes the gap
  when more than one occurrence of a heading is in play.

## Acceptance Criteria

- [ ] **AC-1 (FR-1, FR-2) — divergent-disposition duplicate heading, red-before-green.** A
      fixture where the template carries a heading twice and the two existing↔generated
      pairs reach different dispositions (e.g., pair 1 proven-unmodified, pair 2
      held-without-baseline) results in pair 2's hold appearing in
      `preservedWithoutBaseline` and/or `withheldTemplateHashes`. **Must fail on current
      code** — today pair 2's disposition is silently dropped whenever pair 1 is decided
      first (`dispositionDecided` already true).
- [ ] **AC-2 (FR-3) — reconciliation is conservative and documented.** For the AC-1 fixture,
      the single value persisted for the shared heading in the manifest reflects the rule
      Plan documents (not an unstated last-write-wins), and that rule never lets the
      unmodified pair's evidence stand in for the held pair's.
- [ ] **AC-3 (FR-6) — AC-52/AC-52b outcome is stated, not assumed.** Plan records, for each
      of AC-52 and AC-52b, whether its expected value changes under the new reconciliation
      rule, with the one-sentence reason either way.
- [ ] **AC-4 (FR-4, FR-5) — consequence-time report, red-before-green.** A two-refresh
      fixture: refresh #1 holds a section with no baseline (reports once, as today);
      refresh #2's template ships further genuinely different content into that same
      section while the hold continues. Refresh #2 surfaces a notice naming that heading.
      **Must fail on current code** — today refresh #2's `notices` is `[]` (the issue's own
      reproduction).
- [ ] **AC-5 (FR-5, INV-3) — no re-fire on an unchanged hold.** A three-refresh fixture:
      refresh #1 holds and reports; refresh #2 has no further template change to that
      section (template identical to refresh #1's); refresh #2 produces **no** notice for
      that heading — pins the existing "second refresh … is silent" guarantee
      (`merge-refresh.test.ts:2476`) is not broken by FR-4's new trigger.
- [ ] **AC-6 (INV-4) — offline.** No new network/child-process/LLM call is reachable from
      any function this spec's Plan touches; `invariants.test.ts`'s allowlist gains no new
      entry without a corresponding DR.

## Decisions needed (Clarify)

- **DQ-1 — Does the persisted manifest need to become occurrence-aware, or does an
  in-memory reconciliation rule (FR-3) suffice?**
  - **(A) In-memory reconciliation only, manifest schema unchanged (rec).** `mergeFile`
    becomes occurrence-safe internally (FR-1/FR-2), and a documented rule (FR-3) collapses
    a heading's multiple occurrence-dispositions into the one value
    `generated-hashes.json` can hold. **Cost:** two occurrences of one heading permanently
    share a single evidence trail across refreshes — a document that legitimately needs two
    independently-tracked duplicate-heading histories cannot get one without (B). This is
    the cheaper option and ships no format change into any adopter's `.minspec/` directory
    (constitution invariant 3 — blast radius stays in this run, not in every adopter's
    machine-local state).
  - **(B) Occurrence-aware manifest.** Extend `generated-hashes.json`'s schema so a
    duplicate heading can carry independent entries per occurrence (e.g., an
    occurrence-suffixed key), gated behind a `hashVersion` bump in the spirit of
    [DR-089](../../../docs/decisions/DR-089.md) §3 (an unrecognized stamp is distrusted
    wholesale, never partially trusted). **Cost:** reaches every adopter's `.minspec/`
    directory on their next refresh (a format migration, not a pure code fix) — the exact
    DR-359 "hard to reverse in under a day" shape this project gates behind its own ADR
    filter, so choosing (B) means this spec needs its own DR before Plan, the same way
    DR-089 itself was required for the authorship-vs-disk distinction.
  - *Recommendation:* **(A).** Duplicate `##` headings in a MinSpec-managed file are already
    a narrow edge case (#153's own motivating report); (A) fixes the silent-misattribution
    defect this issue actually reports without opening a migration that reaches every
    adopter for a case this narrow. (B) is the more complete fix and should be revisited if
    a real duplicate-heading document is ever observed where (A)'s shared-evidence-trail
    cost actually bites.

- **DQ-2 — Consequence-time report: a fresh per-consequence notice, or a standing
  held-section indicator?**
  - **(A) Per-consequence notice (rec).** Extend the existing `reportHold` mechanism so the
    continuing-hold branch also reports, gated by FR-4's content-changed trigger. Reuses the
    existing toast/notice surface (`preservedWithoutBaselineMessage`,
    `initRefreshCommand`'s existing rendering path) — no new UI surface. **Cost:** the
    report is still a point-in-time notice a user can miss if they do not read that
    refresh's output; it does not answer "is anything held right now" on demand, only "did
    something change just now."
  - **(B) Standing held-section indicator.** A persistent, queryable surface (e.g., a status
    reflected in the constitution/spec signpost, or a dedicated command) that always shows
    which sections are currently held, independent of whether this refresh changed
    anything. **Cost:** a new UI/command surface to design and maintain — out of a T3 spec's
    natural size, and the kind of design call SPEC-043's own precedent (OQ-1 "throw vs
    soft-skip") resolves at Clarify rather than leaving to Plan to invent; this spec's Plan
    phase would need to scope it as its own slice or defer it to a follow-up spec.
  - *Recommendation:* **(A)**, matching the issue's own stated preference for fixing the
    report mechanism first and named as the option with materially less design surface. (B)
    remains the more complete long-term answer (a held section not reported since materially
    outlasts any one notice) and should be filed as a follow-up issue if (A) ships first —
    per this project's DR-023 forward rule, not left as unfiled prose.

- **DQ-3 — Sequencing: one PR for both defects, or two?** The issue itself recommends
  fixing defect 2 first ("the report is what the invariant-2 argument for this whole change
  rests on") and defect 1 "when the authorship maps are next touched for another reason."
  *Recommendation:* **two implementation slices, defect 2 first**, matching the issue's own
  ordering — defect 2's fix (FR-4/FR-5) does not depend on defect 1's (FR-1–FR-3), and
  shipping it alone closes the sharper of the two gaps (a real, reproduced silent miss)
  without waiting on the wider-blast-radius occurrence-keying change. *Cost:* two smaller
  reviews instead of one, and defect 1 stays live (latent, not reachable with a wrong
  outcome today, per the issue's own framing) for however long the second slice takes.

## Out of Scope

- **DQ-1 Option (B)'s manifest-format migration itself.** Named and costed here; not
  designed or built by this spec. If DQ-1 resolves to (B), the format change and its DR are
  a separate deliverable this spec's Plan phase sequences behind, not one it specifies.
- **DQ-2 Option (B)'s standing indicator UI/command surface.** Named and costed; building it
  is a follow-up spec's scope if (A) ships first, per DR-023's forward rule.
- **Any change to which section body `mergeFile` keeps.** This spec touches only the
  *authorship record* and *notice timing*; INV-1/INV-5 hold the content decision itself
  fixed.
- **#1717** (the sibling issue #1697's review deferred alongside this one). Related, not
  absorbed — a different defect, tracked separately.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Fixing both defects as one FR set with no DQ-3 sequencing note.** Rejected — the issue's
  own recommendation explicitly orders the two fixes and gives a reason; silently
  flattening that into "implement everything in FR order" would discard information the
  issue reporter already worked out, for no benefit (the two fixes are independent).
- **Treating DQ-1 as settled in favor of (A) with no DR path named for (B).** Rejected — a
  future implementer who discovers (A)'s shared-evidence-trail cost is unacceptable needs a
  named path forward, not a spec that silently assumed (A) was the only answer.
- **Specifying a standing-indicator UI in this spec (DQ-2 Option B) directly.** Rejected as
  premature — no design for that surface exists yet, and folding it in here would make a
  narrow bugfix spec carry a new, differently-shaped feature with its own approval bar.

## Traceability

- **Issue:** [#1724](https://github.com/AIClarityAU/minspec/issues/1724) — "harness-merge
  authorship maps are keyed by heading not occurrence, and the withheld-update report fires
  at decision time rather than consequence time," filed from the third adversarial review of
  #1697.
- **Originating fix:** [#1697](https://github.com/AIClarityAU/minspec/issues/1697) — "MinSpec:
  Refresh Harness Files silently deleting project-authored content" — both defects were found
  reviewing that fix and deliberately deferred off its branch.
- **Decision record this spec extends:** [DR-089](../../../docs/decisions/DR-089.md) — "The
  harness manifest records authorship, not disk," whose own Follow-ups section
  (`docs/decisions/DR-089.md:123-124`) names both halves of `minspec#1724` as tracked, not
  resolved, by that record.
- **Spec this work continues:** [SPEC-043](../SPEC-043-harness-refresh-manifest-consistency/requirements.md)
  — owns the manifest-consistency invariants (INV-1 through INV-5) this spec's FR-3/FR-4
  operate inside, without reopening them.
- **Methodology:** [DR-003 RCDD](../../../docs/decisions/DR-003.md) (mechanism + missing
  gate, not a bad-state restatement — applied above to both defects).
- **Sibling, related but not absorbed:** [#1717](https://github.com/AIClarityAU/minspec/issues/1717)
  — the other decision #1697's review deferred off that branch.
- **Blast radius:** constitution invariant 3 — DQ-1's Option (A) is recommended in part
  because it ships no format change into any adopter's `.minspec/` directory; Option (B), if
  chosen, would need its own DR for exactly that reason.
- **DR for this spec:** none yet. DQ-1 states the exact condition (resolving to Option B)
  under which one becomes required before Plan completes; DQ-2 resolving to Option B would
  additionally need its own design spec for the standing-indicator surface before that part
  of the work could proceed.
