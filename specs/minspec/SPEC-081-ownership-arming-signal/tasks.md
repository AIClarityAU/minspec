---
id: SPEC-081
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-081 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the spec-to-code ownership contract (SPEC-038's sibling)
relates_to: [SPEC-038, SPEC-070, DR-069, "#1543", "#2250", "#3650"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-081 - Tasks

The order below is the order of work. There are three pull requests (sections 1 to 3); each
merges on its own with the full `packages/minspec` suite and `npm run validate` green, and
names the requirement IDs it satisfies, the files it touches and the test that proves it. The
mechanisms are in [design.md](design.md); the contract is [requirements.md](requirements.md),
which no task edits.

**Path convention.** Only the five paths in requirements.md's `implements:`/`affects:` appear
in backticks here. The spec gate reads every backticked path in this file that resolves to an
existing source file as owned by SPEC-081 (the fuzzy arm of `declared_impl_files`), so a
backtick on a shared file would freeze it for every session whenever this spec's approval goes
stale. Two other files are edited and are named in plain text: packages/minspec/src/lib/spec.ts
and packages/minspec/src/commands/validate.ts (design.md, *Files*, says why they are not
declared).

Shared rules for every task:

- The T0 file is `packages/minspec/tests/ownership-arming-signal.test.ts`. Each task adds its
  own `describe` block; no task deletes another task's cases.
- Line numbers in design.md and requirements.md have moved; locate code by symbol
  (`validateOwnership`, `violationsIntroducedByApproval`, `ownership_violations`,
  `phase_intent_status`, `read_record`, `resolve_record`, `declared_impl_files`).
- Every pull request: `git diff --name-only origin/main...HEAD` lists no file under `specs/`
  (AC-10, INV-4). Fixtures live in temp directories created by the test.
- All three pull requests touch review machinery (`template-registry.ts` or `scripts/`), so
  each goes through the machinery merge path.
- Before calling a task done, from `packages/minspec`: `npx vitest run
  ownership-arming-signal shipped-ownership-gate-2250 ownership spec-gate
  ownership-guard approve-command-ownership-guard`, then the whole suite; from the repo
  root: `npm run validate`.

## 1 - The validator rule and its adopter twin (FR-1 to FR-4 for two sites, FR-9 in part; AC-1 to AC-4, AC-5's first two columns)

One pull request, because the existing #2250 corpus parity test goes red if either side
changes alone (design.md, D6).

- [ ] **1.1** `packages/minspec/tests/ownership-arming-signal.test.ts` (new, owned) - the
  fixture table exactly as design.md, *Test plan*, lists it (the seven FR-4 rows plus the
  extra rows), a temp-repo helper that writes a row's spec and sidecar, and two columns: TS
  (`ownershipArming`) and `validate.py` (the rendered template imported with importlib, as
  `shipped-ownership-gate-2250.test.ts` does it, calling `ownership_arming`). Each column also
  runs the row's sidecar through that site's classifier. *Done when:* the file runs and is red
  because neither function exists yet; the red run is noted in the PR body.
- [ ] **1.2** packages/minspec/src/lib/spec.ts (undeclared) - export
  `authoredPhaseStatus(raw, phase)`: the phase's value under a column-0 `phases:` key via the
  existing `parseFrontmatterYaml` and `stripInlineComment`, or `undefined` when there is no
  block, no line, or an unrecognised value. `phaseStatusOf` and every existing caller are
  unchanged. *Test:* T0 rows for no block, no plan line, `started`, quoted, trailing comment.
- [ ] **1.3** `packages/minspec/src/lib/spec-validator.ts` - add `ApprovalEvidence`,
  `OwnershipArming`, `classifyApprovalSidecar(text)` and `ownershipArming(spec, input)` with
  design.md's decision order; `validateOwnership(spec, config, input = {})` maps the outcome
  to findings per design.md's validator table (new rules `ownership.arming.signal-absent`,
  warning; `ownership.arming.evidence-unreadable`, dial severity; fallback-armed
  `ownership.implements.missing` always `warning`, message naming the approval record);
  `ValidateSpecOptions.ownershipArming` passes `input` through `validateSpec`;
  `violationsIntroducedByApproval` sets `phasesAuthored: true` on the advanced copy only.
  Rewrite the `validateOwnership` JSDoc to describe the new predicate (FR-9). No `fs` import.
- [ ] **1.4** `packages/minspec/tests/ownership-arming-signal.test.ts` - AC-1 (two fixtures
  differing only in `plan: pending` versus no block, both with a sidecar: no finding versus
  armed); AC-2 (T3, no block, no `implements:`, approved sidecar yields
  `ownership.implements.missing`; again with a stale sidecar); AC-3 (T4, no block, no sidecar
  yields `ownership.arming.signal-absent`; with `status: archived`, nothing); AC-4 (explicit
  `plan: pending`, no `implements:`, with and without a sidecar: nothing); the not-supplied
  variant (no `input`: `signal-absent` whose message says evidence was not supplied); the
  #1317 shape (a phaseless undeclared T3 spec with an `absent` sidecar under
  `ownershipDeclaration: 'error'`: `violationsIntroducedByApproval` still returns
  `ownership.implements.missing`). *Done when:* all green and the #1317 case is red with
  `phasesAuthored` removed from 1.3 (run once, noted in the PR body).
- [ ] **1.5** `packages/minspec/src/lib/template-registry.ts` - in the emitted `validate.py`:
  `authored_plan`, `sidecar_evidence(root, rel, pre_commit)` (full scan reads the working
  tree; `--pre-commit` reads the index with `git ls-files --error-unmatch` then
  `git show :<path>`, a git error being `unreadable`), `ownership_arming(text, evidence)`,
  and `ownership_violations(content, declaration, evidence=None)` with the same mapping as
  1.3. `main()` passes evidence in both modes. `OWNERSHIP_HINTS` gains the two new rules.
  Update the port's header comment and the `ownership_violations` docstring (FR-9). *Test:*
  the T0's `validate.py` column agrees with TS on every row; an adopter fixture at
  `ownershipDeclaration: "warn"` with a phaseless approved undeclared spec exits 0 with a
  `WARN` line (INV-3); a pre-commit fixture whose sidecar is staged but not yet committed
  reads `present`. `shipped-ownership-gate-2250.test.ts` passes **unedited**.
- [ ] **1.6** `scripts/validate-frontmatter.ts` - Rule 15 reads
  `.minspec/approvals/<spec-rel>.json` per spec (absent file: `undefined`; a read throw:
  `unreadable`) and passes the evidence to `validateOwnership`. Update the Rule 15 comment.
  packages/minspec/src/commands/validate.ts (undeclared) - pass the same evidence through
  `validateSpec`'s new option. *Done when:* `npm run validate` on this repo is green and its
  output shows `ownership.implements.missing` warnings for exactly the undeclared phaseless
  specs and one `signal-absent` warning (SPEC-305 at `ff613c62`; re-measured at the PR's own
  base), quoted in the PR body.

## 2 - The corpus surface (FR-6, FR-7; AC-8, AC-9)

- [ ] **2.1** `packages/minspec/tests/ownership-arming-signal.test.ts` - run
  `node_modules/.bin/tsx scripts/validate-frontmatter.ts` with `cwd` a fixture repo (the
  `delegation-citation.test.ts` pattern). AC-8: a fixture with one phaseless approved spec and
  one phaseless unapproved spec prints the FR-6 line with a count of 1 naming the
  approved fixture's id, a count of 1 naming the unapproved one, and `0 ... []`; a fixture with none prints all three counts as `0`. AC-9: a
  directory named `specs/a/aa-first/requirements.md` sorted first, and a phaseless approved
  undeclared spec after it: output names the first path as unreadable **and** carries the
  ownership finding for the second. FR-7's sidecar half: a malformed sidecar is reported
  against its spec, never as "no record". *Done when:* written red against section 1's
  merge, then green.
- [ ] **2.2** `scripts/validate-frontmatter.ts` - Rule 15 calls `ownershipArming` per spec
  and, after its `eachFile` loop, prints the FR-6 line (design.md, *Corpus surface*) with
  `console.log`, ids sorted, zeros explicit. *Done when:* 2.1 is green and the PR body
  quotes the line from `npm run validate` at the PR's base SHA (full SHA).

## 3 - The spec-gate (FR-4 third site, FR-5, FR-9 rest; AC-5, AC-6, AC-7, AC-11)

- [ ] **3.1** `packages/minspec/tests/ownership-arming-signal.test.ts` - the third parity
  column: `scripts/hooks/spec-gate.py` imported with importlib, calling `ownership_arming`
  and `sidecar_evidence`. AC-6 behaviour fixtures, the hook run with JSON on stdin and `cwd`
  a `git init` temp repo (as `spec-gate.test.ts` does): a phaseless T3 spec declaring
  `implements: [src/owned.ts]` with a **stale** sidecar denies a `Write` to `src/owned.ts`;
  with an approved sidecar, allows; `src/other.ts` is allowed either way; a malformed sidecar
  denies `src/owned.ts` with a reason naming the unreadable record. AC-7 / INV-5: for every
  table row with an authored plan, the gate's gated/not-gated decision equals what
  `phase_intent_status` alone gives; the two consumer-difference rows in design.md (block
  without plan line and no sidecar: gated; archived with an approved sidecar: not gated) are
  asserted as such. *Done when:* written red, then green after 3.2.
- [ ] **3.2** `scripts/hooks/spec-gate.py` - add `sidecar_evidence` (cwd sidecar, then the
  common-dir fallback when the cwd one is absent, the `resolve_record` order),
  `ownership_arming`, and the second gating arm (`armed-by-approval` or
  `evidence-unreadable`, literal status not `archived`); an unreadable record's deny reason
  says so. `phase_intent_status` and its band are not edited. Rewrite the module docstring's
  paragraph that says a phaseless spec "never reaches the owned-set computation", the
  STRUCTURED bullet's pointer to that gap, and the matching sentence in the
  `declared_impl_files` docstring (FR-9). *Done when:* 3.1 green, `spec-gate.test.ts` passes
  unedited (AC-7), and `grep -n "phases gap\|arms nothing" scripts/hooks/spec-gate.py` finds
  no sentence describing the gap as current.
- [ ] **3.3** Mutation check (AC-5), no committed change - in each of the three sites in
  turn, make the plan-absent-and-present branch return `exempt`, run the T0, revert. Each
  mutant must turn the `no-block + approved` row red. Quote the three failing assertion
  names in the PR body.
- [ ] **3.4** Corpus honesty (AC-11), PR body only - at the PR's base (full SHA), list the
  FR-6 counts and every phaseless spec that becomes gated with a **stale** approval, by
  comparing `python3 scripts/hooks/canonical.py --hash <file>` with each sidecar's
  `specHash`. At `ff613c62` that list was empty (design.md, finding 2); a non-empty list is
  named, not fixed, in the PR.
