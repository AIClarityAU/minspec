---
id: SPEC-080
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — whether a refresh may silently re-identify a project is the same "no silent gate" family as SPEC-079's managed-region parity
aspects: [scaffold, harness-refresh, worktree, project-identity, evidence-discipline]
relates_to: []
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: The worktree project-rename defect is already fixed — verify and close, don't rebuild

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1496](https://github.com/AIClarityAU/minspec/issues/1496)** — "Refresh
Harness Files renames the project when run from a git worktree: identity is derived from
the folder basename."

## One-Sentence Scope

Confirm, against this repo's current `HEAD`, whether #1496's reported defect still exists
before specifying any fix for it — because the evidence gathered while writing this spec
says it does not.

## Context

### The issue's mechanism claim, checked against current code

#1496 reports: a `MinSpec: Refresh Harness Files` run from a linked git worktree
(`.worktrees/scroogellm/payg-scrub`) rewrote the project name in five managed files
(`.minspec/constitution.md`, `.minspec/labels.md`, `AGENTS.md`, `CLAUDE.md`,
`.cursorrules`) from `scroogellm` to `payg-scrub` — the worktree's arbitrary directory
name — because "the project name comes from the basename of the resolved workspace
folder" and "`.minspec/config.json` carries no name field, so there is nothing
authoritative to fall back to."

That description does not match `resolveProjectName` as it reads today
(`packages/minspec/src/lib/template-engine.ts:109-130`). The function already resolves,
most authoritative first:

1. `projectName` in `.minspec/config.json` — an explicit, deliberate rename
   (`template-engine.ts:117-118`).
2. root `package.json`'s `name`, org-scope stripped (`template-engine.ts:120-121`).
3. **the name already recorded in the existing harness** — read from the `CLAUDE.md` H1
   via `RECORDED_NAME_RE` (`template-engine.ts:58, 66-76`) — which **outranks the
   basename specifically because a linked worktree's directory name is arbitrary**
   (`template-engine.ts:100-103`, doc comment naming this exact scenario: *"a refresh run
   from `.worktrees/<branch>/` renamed the project in every generated file, silently"*).
4. the directory's basename — last resort only, used when neither of the above exists
   (`template-engine.ts:113, 125-129`).

`refreshHarnessFiles` (`packages/minspec/src/lib/scaffold.ts:1497-1523`) also surfaces a
non-silent `'project-name-mismatch'` notice whenever the recorded name wins over the
basename (`scaffold.ts:1510-1523`, message built by `projectNameMismatchMessage` at
`scaffold.ts:521-528`), naming both the kept name and the losing directory name so the
human never has to go find which one applied.

This is not a coincidental adjacent fix — it is the literal mechanism #1496 describes, already
closed.

### A dedicated regression suite already exercises this exact scenario

`packages/minspec/tests/project-name-1529.test.ts` builds the precise fixture #1496
reports: a correctly-named checkout, copied into a directory named after something else
entirely (`wt-some-branch-name`, standing in for `.worktrees/scroogellm/payg-scrub`), then
refreshed from there. Per-file assertions cover all five of #1496's affected paths —
`CLAUDE.md` (`:64`), `AGENTS.md` (`:65-67`), `.cursorrules` (`:68-70`),
`.minspec/constitution.md` (`:71-73`), `.minspec/labels.md` (`:74-76`) — each asserting the
**real** project name survived, not the worktree's basename. A second test
(`:79-89`) asserts the divergence is reported, never silently swallowed. A third block
(`:145-167`) confirms `.minspec/config.json` is seeded with `projectName` at first scaffold
— exactly the "persist identity at init" direction #1496's own issue body suggests — and
is never overwritten on a later refresh.

The suite's own header names the defect by number and describes it in the same words
#1496 uses:

> "a harness refresh run from a git worktree silently renamed the project in every
> generated file… Nothing compared the derived name against the name already recorded in
> the harness, so the rename was written with zero warnings."

**Live-run confirmation, done for this spec:** `npm ci` (root) then
`npx vitest run packages/minspec/tests/project-name-1529.test.ts` against this worktree's
`HEAD` — **12/12 tests passed**. This is a first-hand run, not a read of the test source;
the claims above are grounded in both the implementation reads (file:line citations) and
this live-green result, per this project's Evidence Discipline rule. That said, the run's
only record is this paragraph — this dispatch's shell output is transient and is not
captured anywhere in the diff, so a reader cannot cite it as proof, only reproduce it. The
exact command is given above precisely so a reviewer (or whoever closes #1496) can
independently re-run it rather than take this prose on trust; the Acceptance Criteria
checkbox for this run is left unchecked for that reason.

### Where the fix landed, and why #1496 was filed after it already existed

`git log` on `template-engine.ts` shows the fix commit directly:

```
c25c9961 fix(#1529): let the harness's own name outrank the directory it is refreshed from (#1536)
```

Dated 2026-08-15 (`git show -s --format=%ci c25c9961`). #1496's own body states the
reporter's extension build was **"0.1.26 rebuilt from main (d1a285b) today"** —
`d1a285b` is `fix(#1446): break the spec-validator→spec cycle...`, dated **2026-08-13**,
two days *before* the #1529 fix landed, and confirmed by `git merge-base --is-ancestor`
to be an ancestor of `c25c9961` (i.e. strictly older). #1496 was filed today
(2026-10-01) against a build that predates its own fix by seven weeks — a stale-build
report, not a live defect. #1496's own text already names the likely cause: *"related to
#1492 (the stale-build problem that made this refresh necessary)."*

### What #1496 asked for, versus what shipped

#1496's "Suggested direction" was: *"Persist the project identity at init (a `name` in
`.minspec/config.json`) and read it on refresh; failing that, derive from the git remote
slug… Folder basename should be the last resort."* The shipped fix took the config-persist
half of that suggestion (`project-name-1529.test.ts:145-155`) but not the git-remote
fallback — it uses the **already-recorded harness name** as the fallback ahead of
basename instead of a `git remote get-url origin` call. That is a materially *better* fit
for this project's own invariant 1 (offline core, no network calls without consent,
constitution and `template-engine.ts:107` "Pure reads; no network, no writes.") than a
git-remote shell-out would have been, and it covers the same worktree case #1496 reports.
No functional gap is introduced by the different choice of fallback source.

## Functional Requirements

- **FR-1 — Do not re-specify or re-build already-shipped behavior.** No Plan/Tasks/
  Implement phase for this spec may propose changes to `resolveProjectName`,
  `refreshHarnessFiles`'s project-name-mismatch path, or the five-file rename mechanism
  unless DQ-1 or DQ-2 below surfaces a genuine, currently-unfixed gap. Building a second
  fix for an already-fixed defect is itself a form of the "plausible-inference vs.
  observation" failure this project's Evidence Discipline rule exists to prevent — in this
  case inverted: assuming a report is current without checking the code first.
- **FR-2 — Confirm reproduction status with a live run before closing.** This dispatch ran
  `project-name-1529.test.ts` against this worktree's `HEAD` (which carries `c25c9961`)
  and observed 12/12 passing (see Context) — a stronger check than a read-only citation,
  per Evidence Discipline's "artifact-existence ≠ feature-existence." But the run's only
  evidence is this prose recording the result, not a citable artifact in the diff (no log
  file, no CI link) — a read-only reviewer cannot verify from the diff alone that the run
  happened or that it passed. The requirement is satisfied for *this dispatch's own*
  closing recommendation (DQ-1), not for an independent reader; the AC item below stays
  unchecked until whoever closes #1496 reproduces it themselves with the exact command
  given in Context.
- **FR-3 — Close the loop on the stale-build signal, not just this one report.** #1492 (the
  stale-build problem) is what let #1496 get filed as new against already-fixed code.
  This spec does not re-specify #1492 (out of #1496's scope, CLAUDE.md's
  detection-≠-integration triage rule), but its existence and relevance MUST be stated in
  #1496's closing comment so the pattern — a defect reported after its own fix already
  shipped — is visible to whoever triages #1492 next, rather than re-discovered cold.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2).** Already satisfied by the shipped
  `'project-name-mismatch'` notice (`scaffold.ts:1510-1523`); nothing in this spec proposes
  touching it.
- **INV-2 — Offline core (constitution invariant 1).** The shipped fix's fallback chain
  (config → package.json → recorded harness name → basename) makes zero network calls;
  confirmed by reading every branch of `resolveProjectName` (`template-engine.ts:109-130`).
  Any future proposal to add the issue's originally-suggested `git remote get-url origin`
  fallback would need its own explicit-consent framing (DR-050's bar) — not authorized by
  this spec.
- **INV-3 — Evidence Discipline (RCDD/DR-003).** This spec's own central claim — "already
  fixed" — is written with its verification method stated inline (file:line reads, a git
  ancestry check, and the live regression-suite run recorded under FR-2/Context — 12/12
  passed against this worktree's `HEAD`, not merely read) so a reviewer can tell exactly
  which parts are checked code and which part (the live run) is independently
  reproducible via the exact command given in Context.

## Acceptance Criteria

- [ ] **The ancestry claim is independently reproducible.** `git merge-base --is-ancestor
      c25c9961 <candidate-HEAD>` returns true, and `git show -s --format=%ci d1a285b`
      predates `git show -s --format=%ci c25c9961`, for whoever re-checks this. (Context)
- [ ] **The regression suite has been run green on current `main`**, not merely read,
      before #1496 is closed. This dispatch already ran it against this worktree's `HEAD`
      and observed 12/12 passing (Context, FR-2) — but that result lives only in this
      dispatch's transient shell output, not as a citable artifact in the diff, so it does
      not satisfy this item for an independent reader. Left unchecked until whoever closes
      #1496 re-runs `npx vitest run packages/minspec/tests/project-name-1529.test.ts`
      against `origin/main` themselves and confirms green — the same close-time spirit as
      DQ-1's ancestry sanity check.
- [ ] **#1496's closing comment names both the fixing commit/PR (`#1529` / `#1536` /
      `c25c9961`) and the stale-build cross-link (`#1492`)** rather than a bare "closed as
      duplicate." (FR-3)
- [ ] **No Plan/Tasks/Implement phase is opened for this spec** unless Clarify's DQ-1 or
      DQ-2 surfaces a real gap — an empty Plan phase that says "no build needed, closing
      the loop" is the expected, successful outcome, not a stalled spec. (FR-1)

## Decisions needed (Clarify)

- **DQ-1 — Close #1496 now, given FR-2's live run already passed?**
  *Recommendation:* **yes, close #1496 as already fixed**, citing `c25c9961`
  (`fix(#1529)`/PR #1536), the regression suite name, and this spec's 12/12 live result —
  the one thing this spec's Context section was careful to flag as an unproven gap (a live
  test run, not just a source read) was run, in-repo, for this dispatch's own `HEAD`. That
  result is this dispatch's own observation, not yet an independently-verified one (the AC
  item for it is intentionally left unchecked — see Acceptance Criteria).
  *Cost:* the worktree this ran in is this dispatch's own checkout of `main`, not a
  freshly re-pulled `origin/main` — a human closing the issue should do two cheap
  close-time checks rather than trusting this dispatch unconditionally: `git fetch && git
  log origin/main | grep c25c9961` (or equivalent) to confirm `origin/main` actually
  carries the fix commit, and a re-run of `npx vitest run
  packages/minspec/tests/project-name-1529.test.ts` against that same `origin/main` to
  independently confirm the 12/12 result this spec reports.

- **DQ-2 — Does #1496's closing comment need anything beyond citing the fix?**
  *Recommendation:* **no** — FR-3 already covers what the closing comment must contain
  (fixing commit/PR, plus the `#1492` stale-build cross-link so the *pattern* — a report
  filed against code older than its own fix — stays visible for whoever next triages
  `#1492`). No further dispatch or process is needed beyond posting that comment.
  *Cost:* none identified; this is the cheapest resolution available once FR-2 is
  satisfied.

- **DQ-3 — Does the issue's git-remote-fallback suggestion deserve its own follow-up?**
  The shipped fix's fallback order (recorded harness name, not git remote) covers #1496's
  reported scenario fully (Context, above). A git-remote fallback would only matter for a
  *first-ever* scaffold run inside a worktree with no prior harness and no `package.json`
  name — a narrower, currently-unreported case. *Recommendation:* **no follow-up filed
  now** — speculative scope for a case nobody has reported, and constitution invariant 1
  makes a git-remote shell-out a consent question this spec is not positioned to answer
  pre-emptively. *Cost:* if that narrower first-scaffold-in-a-worktree case is ever hit for
  real, it starts from zero instead of from this note — acceptable, since the note itself
  (this paragraph) is the record DR-086 §4 asks for under autonomy `act`.

## Out of Scope

- **Re-implementing or modifying `resolveProjectName` / `refreshHarnessFiles`.** Already
  shipped; FR-1 forbids re-specifying it absent a genuine gap.
- **Specifying a fix for #1492 (the stale-build problem).** Named as context for *why*
  #1496 was filed against old code, not re-scoped here (FR-3, CLAUDE.md drift rule).
- **Adding a git-remote-slug fallback to project-name resolution.** Addressed as DQ-3;
  explicitly not recommended without a real reported case.
- **Committing any code, config, or test change.** This spec's only committed artifact is
  itself; `npm ci` and the one test run it commissioned for FR-2 touched no tracked path.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Specifying FR/AC content to "fix" the worktree-rename defect as the issue describes
  it.** Rejected on evidence — `template-engine.ts:109-130`, `scaffold.ts:1497-1523`, and
  `project-name-1529.test.ts` all show the fix already shipped, commit-dated before the
  issue's own reproduction build. Writing new requirements for already-built behavior
  would be exactly the "artifact/plausible-inference treated as ground truth" failure
  this project's Evidence Discipline rule exists to catch, just pointed the other
  direction (assuming an old report is current instead of assuming an existing artifact
  proves a feature).
- **Closing #1496 directly from this dispatch, no spec.** Rejected — this dispatch's scope
  is Specify-phase only (T3/T4 gate, DR-076/#1169); closing an issue is an action on GitHub
  state, not a spec artifact, and is explicitly left to the human per DQ-1/DQ-2.
- **Treating a live test run as out of scope for a Specify-only dispatch.** Considered,
  then rejected — `npm ci` and `vitest run` touch nothing under this dispatch's file
  allowlist (no file outside `node_modules/`, which is gitignored and uncommitted, was
  created or changed by either command), and this project's own Evidence Discipline rule
  treats an unrun claim as exactly the failure class to avoid. Verifying a claim this
  spec's central argument depends on is diligence, not implementation; committing a
  code or test *change* would have been the disallowed act, and this dispatch made none.

## Traceability

- **Issue:** [#1496](https://github.com/AIClarityAU/minspec/issues/1496) — "Refresh
  Harness Files renames the project when run from a git worktree."
- **The fix, already shipped:** commit `c25c9961`, `fix(#1529): let the harness's own name
  outrank the directory it is refreshed from (#1536)`, 2026-08-15.
- **Regression coverage:** `packages/minspec/tests/project-name-1529.test.ts`.
- **Implementation:** `packages/minspec/src/lib/template-engine.ts:109-130`
  (`resolveProjectName`), `packages/minspec/src/lib/scaffold.ts:1497-1523`
  (`refreshHarnessFiles`'s mismatch notice), `scaffold.ts:521-528`
  (`projectNameMismatchMessage`).
- **Why the report and the fix didn't line up:** #1496's build was `d1a285b`
  (2026-08-13), confirmed an ancestor of and older than `c25c9961` (2026-08-15); cross-
  linked by the issue's own body to
  [#1492](https://github.com/AIClarityAU/minspec/issues/1492), the stale-build problem.
- **No DR:** none written or needed — this spec proposes no design choice, only a
  verify-and-close recommendation (DQ-1/DQ-2), and the shipped fix it verifies predates
  this spec and carries no DR of its own.
