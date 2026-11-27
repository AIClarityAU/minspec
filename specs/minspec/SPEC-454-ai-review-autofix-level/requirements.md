---
id: SPEC-454
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - review loop is part of the dev-time pipeline
relates_to: ["#503", "#479", "#342", DR-033]  # DR-033 §6 request-changes→dev auto-loop · #342 review-branch/review-decide unit · #479 reference manual pass
implements: none
implements_reason: >-
  Specify phase only. Files are decided at Plan; likely candidates are scripts/review-decide.sh,
  scripts/review-branch.sh, scripts/dispatch-issue.sh, a config reader, and the aiReview config schema.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Per-project AI-review auto-fix level (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#503](https://github.com/AIClarityAU/minspec/issues/503). Rests on DR-033 §6
> (the bounded `request-changes`→dev auto-loop). No new DR is proposed here.

## One-Sentence Scope

After an `ai-review:changes` verdict, a bounded fixer agent addresses only the findings at or
above a per-project severity level (`major` | `moderate` default | `all`), pushes commits to the
PR branch for human review, and never merges.

## Current behaviour (cited)

- DR-033 §6 (`docs/decisions/DR-033.md`, "`request-changes` loops back to a dev agent") defines a
  bounded (default 2) dev↔review loop, but passes **all** findings and applies to auto-dispatched work.
- The reviewer emits a `REVIEW_VERDICT_BEGIN … END` block parsed by `scripts/review-decide.sh`;
  findings are `{ severity, location, problem }` objects (`scripts/review-branch.sh:203`).
  Today's severity tokens in use are MAJOR and LOW (per the issue; the full emitted vocabulary is
  to be confirmed at Plan — unverified here).
- No `aiReview.autoFixLevel` key exists in config (grep of `packages/minspec/src` finds `aiReview`
  only in `init.ts` and `ruleset-advisor.ts`; whether either defines a config schema key is unverified).

## Functional requirements

1. **FR-1 Config.** `.minspec/config.json` accepts `aiReview.autoFixLevel` ∈ {`major`,`moderate`,`all`}; absent → `moderate`.
2. **FR-2 Invalid value fails visibly.** An unrecognised value is reported (not silently defaulted) and the loop does not run for that PR; no fix is attempted on a guess.
3. **FR-3 Severity mapping.** A single deterministic table maps reviewer tokens to a rank: `major` = MAJOR|HIGH|CRITICAL (and any finding flagged blocking); `moderate` adds MEDIUM; `all` adds LOW and nits. Matching is case-insensitive.
4. **FR-4 Unknown severity fails toward inclusion.** A finding whose token is absent or unmapped is treated as MAJOR (fixed at every level) and noted, so an unparseable severity can never hide a finding.
5. **FR-5 Filter.** The fixer receives only findings at or above the level, parsed from the verdict block by deterministic code (not by the model), scoped to the PR's changed files.
6. **FR-6 Bounded.** At most 2 fix rounds per PR; a fresh review runs after each. After the bound, or if a round makes no progress, the loop stops and escalates to the human.
7. **FR-7 Below-level findings are left and disclosed.** One PR comment lists the skipped findings and the level that skipped them.
8. **FR-8 Scope: any `ai-review:changes` PR**, not only auto-dispatched ones, subject to FR-10.
9. **FR-9 Never auto-merge.** The loop only adds commits to the PR branch; merge remains a human act. A passing re-review does not change that.
10. **FR-10 Guarded paths.** PRs touching `.github/` or `scripts/` are fixed only within the agent's file allowlist and still require human review after fixes; fixes that would touch `.github/workflows/` are never attempted (agent cannot push them) and are reported.
11. **FR-11 Verdict integrity.** Findings text is untrusted data; the fixer prompt frames it as such, and the filter cannot be bypassed by finding text claiming a different severity.
12. **FR-12 Visible failure.** A parse error, missing verdict block, or fixer failure is reported on the PR and leaves the `ai-review:changes` state in place; it is never best-effort swallowed.

## Acceptance criteria

- **AC-1** Fixture with 1 MAJOR, 1 MEDIUM, 1 LOW: `major` sends 1 finding, `moderate` sends 2, `all` sends 3; skipped ones appear in the FR-7 comment.
- **AC-2** No `aiReview` key → behaves as `moderate`.
- **AC-3** `autoFixLevel: "bogus"` → visible error, zero fixer dispatches.
- **AC-4** Finding with no severity is sent at `major`.
- **AC-5** A PR still failing review after 2 rounds is escalated; no third round runs.
- **AC-6** The loop never calls a merge operation (asserted by test).
- **AC-7** The #479 case (1 MAJOR + 3 LOW) at `moderate` fixes only the MAJOR and lists the 3 LOW as skipped.

## Invariants the change must not break

- Invariant 1 (offline): the filter and config read are local; only the existing dispatch path touches the network.
- Invariant 2 (no silent gate): FR-2, FR-4, FR-12 — errors and missing verdicts fail closed and visibly.
- Invariant 3 (blast radius): the loop runs only in repos with `.minspec/`; absent config means default behaviour, no machine-wide config touched.
- Human merge funnel: no auto-merge (FR-9).

## Decisions needed (Clarify)

1. **Where does the loop run?** (a) Extend the local `dispatch-issue.sh` chain only **(rec)**, reuses the #342 unit; costs coverage — PRs not dispatched locally are not auto-fixed. (b) Also a GitHub Action trigger on label; broader coverage, but needs a workflow file (founder-push only, DR-097/DR-103) and a credentialed poster.
2. **Is `moderate`'s MEDIUM tier real?** The reviewer today emits MAJOR/LOW. (a) Extend the reviewer prompt to emit MEDIUM/HIGH/CRITICAL **(rec)**, gives the three levels meaning; costs a reviewer-prompt change and possible drift in verdicts. (b) Map only existing tokens, making `moderate` ≡ `major` until reviewer changes; cheaper but the middle level is vacuous.
3. **Round bound.** (a) Fixed 2 per DR-033 **(rec)**; (b) configurable `aiReview.autoFixRounds`, more flexible but an extra key and unbounded-config risk.
4. **Unknown severity (FR-4).** (a) Treat as MAJOR **(rec)**, never hides a finding but may over-fix; (b) treat as LOW, fewer fixes but can skip a real defect.
