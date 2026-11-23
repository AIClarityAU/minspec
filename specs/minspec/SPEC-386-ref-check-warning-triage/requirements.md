---
id: SPEC-386
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - evidence-discipline gate; follow-up to SPEC-201
aspects: [validator, ref-check, citation-fidelity, warn-first-ratchet, tier-0, corpus]
relates_to: [SPEC-201, "#3914", "#3493", "#1643", "#3752", "#161"]
implements: [scripts/reference-check-exemptions.json]
affects: [packages/minspec/src/lib/reference-checker.ts, scripts/validate-frontmatter.ts, packages/minspec/tests/reference-checker.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-386: Triage the ref-check warnings left by the citation-fidelity tier

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it through the normal spec-approval
> gate before any code or corpus edit.

Materializes **#3914** (*chore: triage ref-check citation-fidelity warnings from #3493*).
Follows SPEC-201 (citation-rot validator) and #3493 / #1643 (the fidelity tier that SPEC-201
asked for), and #3752 (parent-register exemption list).

## One-Sentence Scope

Bring Rule 9's (`ref-check`) warning count down to signal by removing the known false-positive
classes at the checker/exemption level, fixing the three real line-bound drifts, and setting a
rule for when the fidelity tier may leave warning severity.

## Context

Counts below are from #3914, measured on head 2170baa3 merged with main by a prior session
(`npx tsx scripts/validate-frontmatter.ts`). They move with every merge; **re-measure at plan
time**, and treat none of them as verified by this spec.

- 926 non-fatal warnings; 456 are `ref-check`: 373 `citation fidelity`, 83 `dangling`.
- The "14 global-register DR refs" of #1643 are already exempt via
  `scripts/reference-check-exemptions.json` (#3752: DR-355/359/360/362). Nothing left there.
- Only 4 dangling DR refs remain in `specs/`, all example ids: DR-000 and DR-999 (SPEC-051
  design, SPEC-310 AC-6); DR-130 and DR-131 (SPEC-122 requirements).
- 10 dangling in `docs/decisions/` (accepted DRs or INDEX): host/cross-repo paths
  (`/etc/nixos/...`, `net/unix/af_unix.c`), `SPEC-100` (scroogellm), `SPEC-003`. Fixing
  means editing accepted DR text, so the issue left them alone.
- Fidelity, 3 line-bound hits (likely real drift): `DR-100.md` cites `preferences.ts:196`
  (file has 187 lines); SPEC-248 cites `approval.ts:609-611` (584); SPEC-316 cites
  `provision-worktree-modules.sh:22-77` (76).
- Fidelity, 370 literal-echo hits, concentrated in SPEC-070 (51), docs/decisions (30),
  SPEC-042 (21), SPEC-035 (21), SPEC-044 (20), SPEC-043 (20), SPEC-050 (16). Mix of rotted
  lines and renamed/never-present symbols; repeated `package.json` setting names cited near
  a `package.json` path look like a systematic false-positive pattern.

Mechanism (observed in code, `reference-checker.ts` fidelity tier, ~lines 228-370 at the time
of writing; line numbers rot): the literal-echo rule requires every backticked identifier within
+/-1 line of a `path:line` citation to appear verbatim in that file. A setting key such as
`minspec.foo.bar` cited beside `package.json:120` is a *name the file defines inside a JSON
string*, so it usually does appear; hits come when the prose names a key as a concept near an
unrelated citation. The exact cause of the `package.json` cluster is **not yet established**
- plan must reproduce it before changing the checker (RCDD: mechanism, not the symptom).

Constraint that shapes everything: editing an approved spec stales its approval hash (hash
lock), so corpus edits to specs cost a re-approval each. Prefer fixes that live in the checker
or the exemption file.

## Functional Requirements

- **FR-1 (example-id exemption).** Rule 9 shall not warn on a `DR-NNN`/`SPEC-NNN` that is
  explicitly an illustrative example. The four known ids (DR-000, DR-999, DR-130, DR-131) are
  no longer reported. The mechanism is a Clarify decision (Q1); whichever is chosen, an
  exemption needs a written reason and an exempt id that later resolves locally still warns
  (the #3752 behaviour is kept).
- **FR-2 (non-repo path class).** Citations whose path is not in this repo (absolute host
  paths, kernel/other-repo paths) shall not be reported as dangling, by a rule that is
  narrow enough that a typo'd in-repo path still warns (Q2).
- **FR-3 (real drift fixed).** The three line-bound drifts are resolved so the three warnings
  disappear *because the citation is correct*, not because it is exempted: re-point each to the
  current location or drop the line number. Each is a corpus edit; see FR-6 for the approval
  cost.
- **FR-4 (systematic fidelity false positive).** The `package.json` setting-name pattern is
  reproduced, its mechanism written down, and, if it is a checker flaw, fixed in
  `checkCitationFidelity` with a one-sided test (fails before, passes after) and a control
  that a genuinely absent setting key near a `package.json` citation still warns. The
  "frozen candidate set" comment in the checker is updated in the same change.
- **FR-5 (severity rule).** The fidelity tier stays at warning severity until a stated
  criterion is met (Q3). The criterion is recorded where the caller is (not only in this
  spec), so a reader of the gate sees why it is a warning.
- **FR-6 (hash-lock discipline).** No spec edit lands without its re-approval path being named
  in the plan. Where a fix can be made in the checker or exemption file instead of editing an
  approved spec, it is (the #3752 rationale).
- **FR-7 (remaining literal-echo hits).** The 370 literal-echo hits are not hand-fixed
  wholesale. The plan sorts them by cause (rotted line / renamed symbol / false-positive
  pattern), fixes or exempts the false-positive patterns in the checker, and files the residue
  as a counted backlog line or issue per Q4, not as silent left-overs.
- **FR-8 (visible, not silent).** No change in this spec may reduce coverage silently: the
  warning-count delta is reported per class in the PR, and any new exemption or skip path
  emits its own visible warning when it cannot be applied (invariant 2).

## Invariants (must not break)

1. Offline: the checker reads local files only; no network (constitution invariant 1).
2. No silent gate: an unreadable exemption list or checker input fails visibly, never as a
   quiet pass (invariant 2). A new exemption path is not allowed to swallow errors.
3. Blast radius: changes apply only to this repo's `scripts/` and corpus; nothing shipped to
   adopters changes behaviour unless `.minspec/` opted them in (invariant 3). Where
   `reference-checker.ts` is shipped, the change is behaviour-preserving for non-opted repos.
4. Approved specs and accepted DRs are not edited to quiet a checker when a checker or
   exemption fix would do (FR-6).
5. A real finding must stay a finding: every exemption has a one-sided control showing a
   near-miss still warns.

## Acceptance Criteria

- **AC-1.** After the change, the four example DR ids no longer appear in `ref-check` output;
  a fixture with a non-exempt phantom `DR-998` still warns.
- **AC-2.** The three line-bound hits are absent, and a fixture citing `file:9999` still warns.
- **AC-3.** The `package.json` cluster is reproduced in a test before any fix, the mechanism is
  stated in the PR, and the post-fix count for that cluster is reported.
- **AC-4.** `npx tsx scripts/validate-frontmatter.ts` runs to completion; the per-class
  warning counts (dangling, line-bound, literal-echo) before/after are in the PR body,
  measured at the same base.
- **AC-5.** The severity criterion from Q3 is written next to the fidelity caller in
  `validate-frontmatter.ts`.
- **AC-6.** `npm test`, `npm run validate`, `npm run lint` pass. No approved spec's hash is
  staled except those named in the plan.

## Decisions needed (Clarify)

**Q1. How are example ids exempted (FR-1)?**
- (a) Add them to `reference-check-exemptions.json` **(rec)**. Smallest, reuses #3752; cost:
  the file's `_comment` says it is for parent-register ids, so it widens meaning to "ids that
  never resolve", and a future real DR-130 will then be silently exempt until the
  now-resolves warning fires (it does warn, so the risk is bounded).
- (b) An inline example marker/fence rule in the checker. Principled and self-documenting;
  cost: edits the checker's frozen scope and needs authors to adopt the marker, which means
  editing approved specs (hash lock).
- (c) Edit SPEC-051/310/122 to use unmistakable placeholders. Cost: three re-approvals.

**Recorded selection: the recommended option,** (a), add the example ids to `reference-check-exemptions.json`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

**Q2. Non-repo paths (FR-2)?**
- (a) Exempt absolute (`/`-rooted) paths only **(rec)**. Narrow, mechanical; cost: does not
  cover relative cross-repo paths like `net/unix/af_unix.c`, which then need (b).
- (b) Per-path entries in the exemption file. Precise; cost: grows a list by hand.
- (c) Leave the 10 `docs/decisions/` warnings. Cost: permanent noise in a gate meant to be
  clean.

**Recorded selection: the recommended option,** (a), exempt absolute (`/`-rooted) paths only. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

**Q3. When may the fidelity tier leave warning severity (FR-5)?**
- (a) Stay warning until the count is under a numeric threshold (issue's suggestion) **(rec)**,
  proposed: zero line-bound hits plus fewer than a stated number of literal-echo hits, set by
  the human; cost: a number chosen without a measured false-positive rate is arbitrary.
- (b) Split severities: line-bound becomes fatal now (it has no false-positive class once the
  3 are fixed), literal-echo stays warning. Cost: a fatal gate on a corpus with rotting
  citations can block unrelated PRs; needs the 3 fixes landed first.
- (c) Stay warning indefinitely. Cost: the tier is advisory forever; #3914 says 926 warnings
  already drown signal.

**Recorded selection: the recommended option,** (a), stay at warning until the count is under a numeric threshold; the number itself is not set here and stays the human's to set, so the tier stays at warning until it is. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

**Q4. Fate of the residue of literal-echo hits (FR-7)?**
- (a) One backlog line per cluster in `docs/backlog.md` **(rec)**; cost: nobody owns them.
- (b) One issue per top cluster (SPEC-070 etc.). Cost: most would not change a decision within
  30 days (CLAUDE.md filing rule), so it is issue noise.
- (c) Bulk-fix by regenerating citations. Cost: mass re-approval of approved specs.

**Recorded selection: the recommended option,** (a), one backlog line per cluster in `docs/backlog.md`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

## Out of Scope

- Making Rule 9 fatal for existence (dangling) findings.
- Editing accepted DR text beyond what Q2/Q4 choose.
- Any change to the approval-hash scheme.

## Traceability

Issue **#3914**; builds on SPEC-201, #3493 (fidelity tier), #1643, #3752 (exemptions), #161
(Rule 9). No new DR: every choice here is reversible in under a day (DR-359 ADR filter).
