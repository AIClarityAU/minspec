---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a shipped file asserting a false fact is a false signpost
aspects: [managed-files, harness, portability, downstream, gate, prose, no-silent-gate, tier-0]
depends_on: [DR-090, SPEC-066]
relates_to: [DR-053, DR-027, DR-011, "#1969", "#1968", "#1108", SPEC-043]
# Ownership declared in Specify, before approval mints a hash. SPEC-066 owns
# prose-vantage.ts / managed-prose-vantage.test.ts and neither exists yet (SPEC-066 is
# `planning`, unbuilt), so this spec owns nothing new; it extends SPEC-066's detector
# through that spec's contract. See Decision DQ-1 for the ordering consequence.
implements: none
implements_reason: >-
  The detector and its suite are created by SPEC-066; owning them here too would give two
  specs one file. This spec only adds rules to that detector and repairs shipped strings.
affects: [packages/minspec/src/lib/prose-vantage.ts, packages/minspec/tests/managed-prose-vantage.test.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/ci-review-templates.ts, .github/workflows/docs-lane.yml]
phases:
  specify: in-progress
---

# SPEC-212: Managed prose may not cite MinSpec's ordinals, incident numbers or registers as the adopter's own

Issue: #1969. Decision it rests on: DR-090 (accepted 2026-09-02). Extends SPEC-066.

## One-Sentence Scope

Extend SPEC-066's vantage gate with three detectors for citation shapes that carry no
path token — ordinal "constitution invariant N", bare `#N` / `DR-N` register references —
and repair the three measured instance families, so that a managed file never points a
receiving repo at a rule, incident or decision that exists only in the minspec repo.

## Context

DR-090 swept seven managed files on 2026-09-02. #1969 reports three more, confirmed against
AIClarityAU/scroogellm at `798d44e`, an adopter that received them verbatim. Two arrived
after the sweep, so this is the class re-forming, not leftovers.

Line numbers in the issue have drifted on current `main`; the instances below are located by
content, and the implementer must re-locate them (`grep`), not trust a line number
(CLAUDE.md "Mechanism claims need the same bar").

**Instance A — ordinal invariant citations (blocking).** "constitution invariant 2 / 3"
appears in the shipped `.minspec/hooks/pre-commit` template
(`template-registry.ts`: "…harness must not commit (constitution invariant 3)" and
"Fails CLOSED once opted in (constitution invariant 2)") and twice in
`.github/workflows/docs-lane.yml` ("…fail the gate CLOSED and visibly (constitution
invariant 2)", "leaves a held PR armed (constitution invariant 2 - no silent gate)").
The numbers index MinSpec's constitution; an adopter's `.minspec/constitution.md` is a
different, itself-scaffolded list, so the citation resolves cleanly to the WRONG rule
(scroogellm: 2 = "Savings are auditable", 3 = "PII anonymization is deterministic"). SPEC-066
FR-11 already names this residual as undetectable because it carries no path token; this
spec closes the ordinal form of it. Only the docs-lane:231 form self-glosses.

**Instance B — MinSpec incident history narrated as the adopter's.** `docs-lane.yml`'s
hold-gate block ("Measured on #1741: `hold:human` was applied at 22:09:26 and this lane
armed auto-merge at 22:09:34…", plus #1847/#1816/#1754/#1858 and commit `132a0bc6`). Per
DR-053 a bare `#N` inside a repo means that repo's; scroogellm's numbering tops out near
#162. No shipped text names minspec as the subject, so DR-090 §2's attribution escape is
not met.

**Instance C — non-existent DRs and scripts, two POSTED into adopter PRs.** The hold-gate
block names `scripts/approve-on-label.sh`, `scripts/approve-issue.sh`,
`scripts/dispatch-issue.sh` (none scaffolded). Two refusal bodies passed to
`gh pr comment` cite DR-072 / DR-029 / DR-086, absent from the adopter's register (DR-027:
each repo keeps its own). These are the sharpest: written into the adopter's PR thread by
the gate to the person being refused, an audience that never chose to read MinSpec's
internals.

The three script names are path-shaped, so SPEC-066 FR-3 would already catch them once
built; they are listed so the repair is not forgotten, not because they need a new rule.

## Functional Requirements

**FR-1 — Ordinal-citation rule.** In prose (SPEC-066 FR-2 scope, shipped bytes per FR-1
there), the pattern `constitution(?:'s)? invariants? #?\d+` (case-insensitive; also
`invariants \d+(?:, ?\d+)*` and `INV-\d+` when preceded by "constitution") is a violation
unless the enclosing prose block attributes it per SPEC-066 FR-6 (`minspec(?:'s own)? repo`
in the same block) — OR the citation is followed within the same sentence by the rule
stated inline. Lacking either, fail. Rationale: an ordinal is meaningful only against a
list the reader may not have.

**FR-2 — Inline-restatement is the preferred repair.** For Instance A the shipped text
states the rule in words ("a merge-gating check must fail closed and visibly";
"nothing MinSpec ships may change behaviour in a repo that did not opt in") and drops the
number. Attribution ("MinSpec's own constitution invariant 2") is allowed by FR-1 but is
the fallback, because it still leaves an adopter-unresolvable number in their hook.

**FR-3 — Register-reference rule.** In prose, `DR-\d+` and bare `#\d+` references are
violations unless (a) attributed per SPEC-066 FR-6 in the same block, or (b) inside a
string the file's own code interpolates from the adopter's repo. Placeholders (`DR-NNN`)
are skipped as in SPEC-066 FR-5. Because a `#N` inside a `gh pr comment` body is
indistinguishable from prose to a line scanner, shell/YAML string literals passed to
`gh pr comment|issue comment|review` are treated as prose for this rule (FR-4).

**FR-4 — Posted strings are the highest-priority audience.** The detector classifies text
that the file POSTS (arguments to `gh pr comment`, `gh issue comment`, `--body`,
`--body-file` content built in the same step) as prose for FR-1/FR-3 regardless of
`commentStyle`, since SPEC-066 FR-2 reads comments only and would skip these string bodies
entirely. A gate that skipped them would pass #1969 while the sharpest instance ships.

**FR-5 — Repairs.** Instance A: remove the ordinals, restate inline (FR-2).
Instance B: either drop the incident narrative from the shipped bytes via a registry
`localize` hook (SPEC-066 FR-7/FR-8) or attribute it ("on the minspec repo's #1741…").
Instance C posted strings: remove the DR numbers and state the rule inline
("accepting a DR or approving a spec is a human act"); keep no register reference in a
string an adopter's PR will display. Script names: attribute or localize.

**FR-6 — Source and shipped copies stay one thing.** `.github/workflows/docs-lane.yml` is
the on-disk source and `ci-review-templates.ts` its generated embed; the fix edits the
source and re-runs `scripts/gen-ci-templates.mjs` (never hand-edit the embed). The
pre-commit template text lives directly in `template-registry.ts`.

**FR-7 — Residual stated honestly.** Ordinals other than "constitution invariant N" (e.g.
"principle 4", "rule 3 above") remain undetected; the detector header states the limit and
no artifact claims this spec closes the class (extends SPEC-066 FR-11).

## Invariants

**INV-1 — Fail closed and visibly (constitution invariant 2, restated: a merge-gating check
fails visibly, never best-effort).** New rules run in the same required vitest suite as
SPEC-066; they never warn-and-pass.
**INV-2 — Never vacuous.** Before any pass/fail assertion the suite asserts each new rule
extracts ≥1 hit from a fixture built from the pre-repair text of Instances A, B and C.
**INV-3 — Positive control, both directions** for each rule: unattributed → rejected;
same text with attribution or inline restatement → accepted.
**INV-4 — Tier 0.** Pure string work, no network, no `vscode` import (constitution
invariant 1).
**INV-5 — No exception register** (inherits SPEC-066 INV-6, DR-090 §3). No pragma, no
per-template allowlist.
**INV-6 — Blast radius.** Behaviour of the shipped hook and workflow is unchanged; only
comment/message text changes (constitution invariant 3).

## Acceptance Criteria

**AC-1** — The new suite cases fail against the pre-repair text (≥4 ordinal hits across
two files, ≥1 incident-number hit, ≥2 posted-string DR hits) and pass after FR-5, proven by
running against both trees.
**AC-2** — Mutation checks: disabling FR-1's regex fails the ordinal reject case; disabling
FR-4's posted-string scan fails the posted-string reject case.
**AC-3** — Shipped `.minspec/hooks/pre-commit` and the localized `docs-lane.yml` contain no
`constitution invariant <digit>` and no `DR-<digit>` / `#<digit>` outside an attributed block.
**AC-4** — A scaffolded temp repo's shipped files, grepped with the gate's own regex (not
`grep -c`), report zero hits.
**AC-5** — `npm test`, `npm run lint`, `npm run validate` green; generated embed matches
source (staleness check).

## Decisions needed (Clarify)

**DQ-1 — Where do the new rules land, given SPEC-066 is unbuilt?**
(a) *(rec)* Build them inside SPEC-066's detector as extra rules, sequenced after SPEC-066's
implementation; this spec stays separate for traceability. Cost: #1969's repairs wait for
SPEC-066 to be built, and the posted PR-comment strings keep shipping meanwhile.
(b) Ship the three repairs now (text-only, FR-5) plus a small standalone test, then fold
the detector into SPEC-066 later. Cost: a throwaway test that SPEC-066 later duplicates.
(c) Amend SPEC-066 directly instead of a new spec. Cost: edits an already-planning spec and
may stale its approval hash.

**DQ-2 — Instance B: attribute or localize away?** (rec) Localize away via the registry
`localize` hook (SPEC-066 FR-7): incident timestamps are noise in an adopter's repo. Cost:
one more hand-written rewrite that must throw on a missing anchor (SPEC-066 FR-8) and be
kept in step with upstream wording. Alternative: attribute in place — cheaper, but ships
MinSpec's incident log into every adopter's workflow permanently.

**DQ-3 — Is a bare `#N` always a violation, or only in posted strings?** (rec) Only in
posted strings and unattributed incident narration; a trailing `(#1847)` provenance tag in
a code comment is the codebase's universal convention and flagging all of them would force
a rewrite of nearly every managed file. Cost: a code comment citing `#N` as though it were
the adopter's still passes, so the harm class survives in low-audience comments.

## Out of Scope

- The behavioural fail-open in the same workflow (#1968) — separate bug.
- An LLM prose-claim voter (DR-090 §Consequences).
- Implementing SPEC-066's detector.

## Follow-ups (tracked)

- **#1969** — closed by this spec's implementation.
- **SPEC-066** — owns the detector this extends; must be built first under DQ-1(a).
- Nothing deferred as prose.
