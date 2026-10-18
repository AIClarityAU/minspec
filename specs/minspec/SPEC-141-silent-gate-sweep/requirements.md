---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (the silent-gate incident family)
aspects: [silent-gate, audit, lint, gates, ci, scripts, witness, tier-0]
relates_to: [DR-066, DR-093, SPEC-071, SPEC-078, "#1891", "#1859", "#1855", "#1853", "#1708"]
# Ownership (`implements:`) is deliberately NOT declared yet: it is inside the canonical hash,
# so it must be settled in Clarify together with DQ-1/DQ-2 (which decide whether the widened
# lint extends scripts/lib/swallowed-gate-signal.ts or adds a sibling file). Declare it before
# approval, never after.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: Sweep for DR-066 violations, and make the class a red build

Tracks #1891 (audit: sweep for DR-066 violations). Rule decided in DR-066 (no silent gate)
and constitution invariant 2; **re-deciding it is out of scope**.

## Scope sentence

Produce a triaged inventory of every place a swallowed error or single-producer witness can
make a stalled gate look like "nothing to do", and widen the existing mechanical check so each
future instance fails the build instead of causing an outage.

## Starting state (measured 2026-10-18 against `origin/main`, not taken from the issue)

The issue was filed before much of its part 3 landed. Verified in the tree:

- **Part 3 is partly built.** `scripts/check-swallowed-gate-signal.ts` +
  `scripts/lib/swallowed-gate-signal.ts` exist; `npm run check:swallowed-gate`; enforced
  merge-blocking by a T0 test (`packages/minspec/tests/swallowed-gate-signal.test.ts`) because
  CI runs `npx vitest`, not `npm test`, so `pretest` never fires there (file header, lines 29-37).
- **What it catches:** `.sh` files under `scripts/` and `package.json` `scripts`; a swallow
  (`|| true` / `|| :`) whose output is *captured into a variable* that later drives control
  flow. Two annotations: `# swallow-ok: <reason>`, `# swallow-known: #NNNN <reason>`.
- **What it cannot see (its own header states it under-reports):** `.github/workflows/**`
  (scope is `scripts/` + package.json); `2>/dev/null` used *without* `|| true`; a value
  reaching a conditional through a second variable or a function; an **early return
  indistinguishable from "nothing to do"** (the #1708 shape); and the whole of part 2 —
  single-producer witnesses — which no mechanical check addresses.
- `.github/workflows/` currently has ~70 grep hits (`ai-review.yml` 47, `docs-lane.yml` 8,
  `ai-review-retry.yml` 7, others ≤3) that no lint reads.
- Two `swallow-known: #1855` annotations remain in `scripts/drain-inbox.sh`; a #1855 "sanity
  floor" contradiction message exists at `drain-inbox.sh:1500`. Whether #1855, #1853 and #1708
  are still open must be re-checked at implement time, not assumed from this spec.

## Functional requirements

- **FR-1 Inventory, workflows.** Enumerate every `|| true`, `|| :`, `2>/dev/null`,
  `continue-on-error: true`, and `if: always()`-guarded step in `.github/workflows/**` that
  produces or consumes a gate signal. Classify each hit as *instance*, *legitimate best-effort*
  or *needs-decision*, with a one-line reason, in a committed ledger.
- **FR-2 Inventory, scripts.** Same classification for `scripts/**` hits the current lint does
  not already adjudicate (the lint only sees capture-then-branch). Hits already carrying a
  `swallow-ok` / `swallow-known` annotation are cross-checked, not re-triaged from scratch.
- **FR-3 Triage question, fixed.** Every classification applies the issue's single test: *if
  this command failed right now, would the caller behave differently from "there was nothing
  to do"?* No → instance. The ledger records the answer, not only the verdict.
- **FR-4 Single-producer witnesses.** Enumerate every gate whose witness has exactly one
  producer, and for each record: the producer, the situation the gate exists for, and whether
  the producer runs in that situation (archetype: #1859 — witness existed only while a human
  watched). Gates failing the test get an independent second witness (DR-066 clause 3) or a
  tracked issue.
- **FR-5 Every instance leaves the ledger as a fix or an issue.** An *instance* is either
  fixed in the implementing PR, or annotated `swallow-known: #NNNN` with a filed issue. No
  ledger row may remain "instance" with neither (DR-023: no prose-only follow-up).
- **FR-6 Widen the check to workflows.** The mechanical check scans `.github/workflows/**`
  (shell in `run:` blocks) with the same three-property definition used for scripts (swallowed,
  captured, decides control flow) and the same two annotations.
- **FR-7 Silent-empty on stderr suppression.** The check flags a captured command with
  `2>/dev/null` (no `|| true`) when its emptiness is tested, subject to DQ-1.
- **FR-8 Early-return indistinguishable from idle (#1708).** Subject to DQ-2: either a
  detectable rule for "a loop/sweep that can return before doing work and logs the same line
  as a clean no-op", or an explicit statement that this shape is out of mechanical reach and
  is covered by FR-9.
- **FR-9 Idle-vs-stalled is observable.** For the drain, a cycle that did no work must record
  *why* (nothing ready vs query failed vs early return) in a form a test can assert. This is
  the one runtime requirement; it exists because lint cannot prove the property (see lint's
  stated limits).
- **FR-10 Fail closed.** The widened check keeps the existing guarantee: an unreadable file,
  missing directory, or a scan that walked nothing is red, never green. A workflow YAML that
  fails to parse is red.
- **FR-11 Enforcement lands where it actually runs.** The check's enforcement must be a path
  CI executes (a vitest T0 test), not only `pretest`. The App installation cannot edit
  workflows, so no new workflow step is required or assumed.
- **FR-12 Baseline honesty.** Pre-existing findings are `swallow-known` with an issue, never
  `swallow-ok`; the summary line prints the known-debt count on every run.

## Acceptance criteria

- **AC-1** Ledger exists, covers every hit of the issue's grep over `scripts/` and
  `.github/workflows/`, and each row has a classification and the FR-3 answer. A script that
  re-runs the grep and fails if a hit is absent from the ledger (or the reverse) is the
  completeness witness; a hand-maintained count is not accepted.
- **AC-2** Zero ledger rows are "instance" without a fix or an issue number (FR-5).
- **AC-3** A fixture workflow containing `x=$(gh … || true); if [ -z "$x" ]` makes the check
  exit 1; the same line with `# swallow-ok: <reason>` exits 0; a reasonless marker exits 1.
- **AC-4** Mutation check: removing the workflow scan, or making the scan walk nothing, turns
  the T0 test red (the existing "walked nothing" guard extends to workflows).
- **AC-5** A fixture with `x=$(cmd 2>/dev/null)` then `[ -z "$x" ]` is flagged (FR-7) unless
  DQ-1 resolves to "not flagged", in which case the doc states the exclusion.
- **AC-6** The FR-4 inventory lists, per gate, producer + situation + verdict; each failing
  gate has a second witness or an issue.
- **AC-7** The check passes on `origin/main` after the implementing PR (known debt counted,
  not hidden), and `npm run validate`, `npm test` and `npm run lint` pass.
- **AC-8** FR-9: a test drives the drain with a failing ready-set query and asserts the cycle
  does not report the same outcome as an empty queue.

## Invariants this change must not break

- **INV-1 Offline (constitution 1).** The check and the inventory make no network call.
- **INV-2 No silent gate (constitution 2).** The new check is itself a gate, so it fails
  closed (FR-10) and is not a single point (FR-11 plus the existing T0 test).
- **INV-3 Blast radius (constitution 3).** Anything shipped to adopters is gated on `.minspec/`
  at the repo root. This spec scans *this* repo's `scripts/` and `.github/`; shipping the lint
  to adopter repos is **not** in scope (see DQ-3).
- **INV-4 No relabelling debt as fine.** A real defect is never silenced with `swallow-ok`.
- **INV-5 A pass is a floor, not a proof.** Docs and messages must not say a script is
  "clause-1 clean" on a pass; the lint's stated limits stay stated.

## Not in scope

Re-deciding DR-066; fixing #1853/#1855/#1708 beyond what FR-5 requires (each has its own
issue); a general shell parser.

## Decisions needed (Clarify)

- **DQ-1 — `2>/dev/null` without `|| true` (FR-7).** *(A, rec)* Flag when captured and
  emptiness-tested — closes the #1853-style hole; cost: noisier, more `swallow-ok` annotations
  to write on first landing. *(B)* Leave to the ledger only — quiet, but the class stays
  remembered, not enforced.
- **DQ-2 — #1708 early-return shape (FR-8).** *(A, rec)* Do not attempt a lint; rely on FR-9's
  observable reason code — cost: the shape is caught by a test of the drain only, not
  repo-wide. *(B)* Heuristic lint for "log line identical across branches" — cost: high
  false-positive rate, likely disabled within weeks, which enforces nothing.
- **DQ-3 — Ship the lint to adopters?** *(A, rec)* No, this repo only — smallest blast radius;
  cost: adopters' own gates are unprotected. *(B)* Scaffold it behind `.minspec/` — protects
  adopters; cost: a shipped-surface commitment and a T4 re-scope.
- **DQ-4 — Ledger home.** *(A, rec)* A committed file under this spec's directory, checked by
  AC-1's script — cost: needs upkeep as hits change. *(B)* A one-off issue comment — no upkeep;
  cost: nothing keeps it true, which is the failure this spec exists to remove.
