---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an always-on warning is a false signpost that buries the real failure
aspects: [validator, gate, pre-commit, signal-to-noise, no-silent-gate]
relates_to: [SPEC-075, DR-003]
implements: none  # specify-only; the owning files are declared at Plan
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — The commit-time validator reports on the commit, and warns only about contradictions (Requirements)

**What you are approving.** Two changes to what the pre-commit validate gate prints, from issue #1006.
(1) At commit time the gate leads with the failures this commit introduces, and the warnings it
shows are limited to the files the commit touches; CI keeps the full-corpus report.
(2) The `split-coverage` warning stops firing on a spec that simply has not reached the phase
yet; it fires only when the spec's own `phases:` map says a phase is under way or finished but
its file is missing. The cost that bites: a spec that is merely lagging (no `design.md`, plan not
started) is no longer flagged anywhere, locally or in CI. Two choices are under
**Decisions needed (Clarify)**.

Issue: #1006 (commit-time validator floods 106 workspace-wide warnings for a 2-file docs commit).
Related: #943 owns the accept-command bug behind the parity FAIL; this spec does not touch it.

## Problem (observed, not inferred)

Approving DR-040 (two files) printed 106 warnings about other files, then one `FAIL` (the `#626`
status-parity finding) as the last line. Mechanism, from code:

- `.githooks/pre-commit` triggers on any staged spec/DR/domain/epic file, runs `npm run validate`
  over the **whole corpus**, and on failure prints the entire output (`printf '%s\n' "$validate_out" >&2`)
  before the introduced-vs-pre-existing comparison (#1471) prints which failures are the commit's.
  Warnings are never compared against HEAD, so they are all shown.
- `validateSplitLayoutCoverage` (`packages/minspec/src/lib/spec-validator.ts:1425`) takes only each
  file's `type` and `tier` (`SplitLayoutFile`). It never sees `phases:`, so every spec dir holding
  only `requirements.md` gets `split-coverage.design.missing` and `.tasks.missing`, however early it is.
  `scripts/validate-frontmatter.ts:249` emits these as warnings on every run.

Root cause (mechanism plus missing gate): the coverage rule compares files against the tier's
*required* phases instead of the spec's *reached* phases, so it cannot distinguish "not yet
authored" from "claimed but absent"; and the commit gate has no notion of which findings belong to
the commit, so noise from unrelated files shares the channel with the blocking line.

## Functional requirements

- **FR-1 — Phase-aware coverage.** `split-coverage.<type>.missing` is emitted for a split dir only
  when the owning spec's `phases:` map marks the phase that file embodies (specify→requirements,
  plan→design, tasks→tasks) as `in-progress` or `done` and no sibling of that `type` exists. A
  phase at `pending` (or absent) produces no finding. The `phases:` map is read from the
  requirements file (the primary artifact, as `tier:` already is).
- **FR-2 — Fail visibly when the map cannot be read.** If the dir has no requirements file, or its
  `phases:` map is missing or unparseable, the rule falls back to the current tier-required
  behaviour for that dir rather than skipping it (invariant 2: an unreadable witness never reads as
  "nothing wrong").
- **FR-3 — Severity unchanged.** The finding stays a warning. This spec changes when it fires, not
  how hard it blocks.
- **FR-4 — Commit-time scope.** In the pre-commit gate, warnings and FAIL lines are filtered to the
  paths the commit stages (plus, for a split spec dir, its siblings, since coverage is a property of
  the directory). Findings about other files are replaced by one summary line giving the count
  withheld and the command to see them (`npm run validate`).
- **FR-5 — The blocking finding leads.** When the gate blocks, the lines this commit introduces
  (#1471's `introduced` set) are printed first, under their own heading, and the remaining output
  after. A reader who reads only the top of the output sees the cause.
- **FR-6 — CI stays whole-corpus.** `npm run validate` with no arguments, and CI, are unchanged:
  full corpus, every finding. Scoping is a view applied by the commit gate, not a change to what
  the validator checks.
- **FR-7 — No hidden suppression.** FR-4's withheld count is always printed when non-zero, and the
  gate's pass/fail decision is computed from the unfiltered result. Filtering changes only what is
  displayed, never whether a failure blocks.

## Acceptance criteria

- **AC-1.** A dir with `phases.plan: pending` and only `requirements.md` yields no
  `split-coverage` finding. (Today: two.)
- **AC-2.** A dir with `phases.plan: in-progress` and no `design.md` yields exactly
  `split-coverage.design.missing`.
- **AC-3.** A dir whose requirements file has no `phases:` map yields the tier-required findings
  (FR-2), and a malformed map does the same.
- **AC-4.** A two-file commit (one DR, `INDEX.md`) against a corpus with N unrelated warnings prints
  none of those N warnings, prints "N withheld", and prints the introduced FAIL before any other
  output.
- **AC-5.** The same commit with an unrelated *pre-existing* FAIL elsewhere still exits as today
  (allowed per #1471), and the withheld count includes it.
- **AC-6.** `npm run validate` output on the full corpus differs from today's only by the
  FR-1 findings that no longer fire.
- **AC-7.** A validator that crashes without a summary line still fails closed (the #1483 witness
  check is not weakened by filtering).

## Invariants the change must not break

- Invariant 2 (no silent gate): FR-2, FR-7 and AC-7 exist for this. A filtered view must not become
  a place where a failure can hide; the decision runs on the unfiltered result.
- Invariant 1 (offline): no network call; the staged-path list comes from `git diff --cached`.
- Invariant 3 (blast radius): the hook change ships through the managed harness template, so it
  reaches only repos with `.minspec/`; Plan must state how it propagates (Refresh Harness Files).
- The #1471 introduced-vs-pre-existing comparison and the #1483 summary-line witness keep their
  current semantics.

## Out of scope

The `#626` parity FAIL and the accept-command bug that produced it (#943). Reclassifying other
warning rules. Changing DR/INDEX integrity checks.

## Decisions needed (Clarify)

1. **What happens to specs that lag with no `phases:` movement?** FR-1 stops flagging them anywhere,
   including CI, so a spec can sit at `plan: pending` indefinitely without a signal.
   - **(a) Accept (rec)** — progress is the spec's own claim; a lagging spec is normal, and the
     cost is that nothing nudges an abandoned spec dir.
   - **(b)** Keep a single per-corpus count line in `npm run validate` ("21 specs have not reached
     Plan"), informational only. Cost: one more always-on line, the very pattern #1006 complains of,
     though one line instead of ~50.
2. **Where is commit-time scoping implemented?**
   - **(a) In the validator (rec)** — a `--paths` argument on `scripts/validate-frontmatter.ts`; the
     hook passes the staged list. One implementation, testable in Vitest. Cost: the validator gains
     an argument and every rule must declare which file(s) a finding belongs to.
   - **(b)** In the hook, by filtering output lines by path. Cost: shell text-matching on message
     formats, which breaks silently when a message omits its path — the failure mode FR-7 forbids.
