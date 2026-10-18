---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - sibling of SPEC-058 (harness refresh); the commit offer's path handling
aspects: [scaffold, refresh, commit-offer, no-silent-gate, enforce-not-trust]
relates_to: [SPEC-058, DR-073, "#1422", "#1301", "#763", "#1103", "#610", "#2398", "#758"]
affects: [packages/minspec/src/commands/init.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: The scaffold commit set is bound to what init/refresh writes, not maintained beside it

Issue: #1422 (harden: SCAFFOLD_PATHSPECS is a hand-maintained mirror).

## In plain terms

After "MinSpec: Initialize" or "Refresh harness", MinSpec offers to commit the files it
wrote. Which files are offered comes from a hand-typed list (`SCAFFOLD_PATHSPECS`,
`packages/minspec/src/commands/init.ts:101`) that nothing ties to the code that writes the
files. When a new write is added and the list is not, the file is silently left dirty. That
is exactly how #1301 happened: `registerClaudeHooks` wrote `.claude/settings.json`, the list
never gained it, and the offer committed an inert hook.

This spec makes that mismatch impossible to ship unnoticed.

## Problem (mechanism, not state)

- **Mechanism:** two parallel enumerations - the write paths in scaffold/refresh, and the
  literal list in `SCAFFOLD_PATHSPECS`. Adding to one does not touch the other.
- **Missing gate:** no test or code asserts the second covers the first. Only a human
  noticing a dirty file after "Commit them" catches a gap. This is the "enforce, don't
  trust the model" class: correct only while someone remembers.
- **Adjacent brittleness (#763):** the commit path aborts entirely when one path (e.g.
  `.claude/`) is gitignored, stranding every other refreshed file. Same offer, same
  untested path handling.

## Functional requirements

- **FR-1 Single source.** The set of paths the offer stages is derived from the paths
  init/refresh actually wrote in that run (a write report), not from a literal list kept
  alongside the writers. Adding a write path to the scaffold cannot omit it from the
  staged set without also bypassing the report.
- **FR-2 Report at the write site.** Every managed write (scaffold files, section-merge
  templates, managed-region templates, `.gitignore`/`.gitattributes` appends, and the
  `.claude/settings.json` hook registration) records its relative path through one shared
  helper. Writes that change nothing (idempotent no-op) are not reported.
- **FR-3 Deliberate exclusions are explicit.** `.minspec/generated-hashes.json` and
  `.minspec/template-baseline.json` (machine-local derived state, #1103) are never in the
  staged set. The exclusion is a named, commented constant at the single point where the
  report is filtered, not an implicit omission.
- **FR-4 Unreported-write tripwire.** A test scaffolds and refreshes into a temp git repo
  and fails if any file the run created or modified (working-tree diff, minus the FR-3
  exclusions) is absent from the staged set. This guards writers that bypass the helper,
  so FR-1 does not rest on convention.
- **FR-5 Existence filtering preserved.** The staged set still contains only paths that
  exist on disk, and never a directory (a user's unrelated sibling files, e.g. a
  hand-written `.claude/commands/my-own-command.md`, are never swept in).
- **FR-6 Dirty-state polling.** `collectDirtyScaffoldPaths` (#758: status bar / re-invokable
  command) must use the same derived set. When no run has reported yet in this session
  (e.g. after an editor restart), it falls back to a documented persistent source - see
  Decisions needed.
- **FR-7 Ignored path does not strand the rest (#763).** If one staged path is gitignored,
  the commit proceeds with the remaining paths and the skipped path is named in the
  result message. A visible skip, never a silent drop and never an all-or-nothing abort.
  If every path is ignored, the offer says so rather than doing nothing.
- **FR-8 Offline.** No network call is introduced (invariant 1).

## Acceptance criteria

- AC-1: Adding a new managed write through the shared helper stages it with no edit to any
  list; adding a write that bypasses the helper turns the FR-4 test red.
- AC-2: Reverting the #1301 fix (dropping the settings.json registration from the report)
  turns the FR-4 test red - the test is proven against the known historical defect.
- AC-3: After init and after refresh in a fixture repo, `git status --porcelain` shows no
  MinSpec-written file outside the FR-3 exclusions once the offer is accepted.
- AC-4: With `.claude/` gitignored, accepting the offer commits all other files and the
  message lists the skipped path (#763).
- AC-5: Existing `collectScaffoldPaths` / `offerScaffoldCommit` behaviours covered by
  current tests (existence filter, default-branch branch offer, refresh variant) are
  unchanged.

## Invariants this must not break

- No silent gate (constitution 2): the tripwire fails visibly; a skipped ignored path is
  reported, not swallowed.
- Blast radius (constitution 3): only runs in a repo with `.minspec/`; nothing new is
  written outside what init/refresh already write.
- Never sweeps a directory or user-authored sibling files (FR-5).
- Section-merge files (CLAUDE.md, AGENTS.md, .cursorrules, settings.json) remain staged
  although user-authored: ownership is handled by how they are written (DR-073), not by
  declining to commit.

## Out of scope

- Changing what init/refresh write, or the manifest-tracking story (#1103).
- The commit message wording and the default-branch branch-offer flow.

## Decisions needed (Clarify)

1. **Derive vs. test.** The issue offers (a) derive from a write report, (b) test the
   equivalence only.
   - **(a) Derive + tripwire test (rec; this spec's FR-1..FR-4).** Removes the class; test
     catches bypassers. Cost: touches every write site (a one-line helper call each) and
     the reported set exists only for the run that wrote it, forcing FR-6's fallback.
   - **(b) Test only.** Smallest change; no write-site edits. Cost: still needs an
     allowlist of known-omitted paths (a small parallel list) and only CI, not the product,
     notices a gap.
2. **FR-6 fallback after restart.** The status-bar poll has no in-memory report.
   - **Persist the last report in `.minspec/` machine-local, gitignored state (rec).**
     Exact for refreshed files. Cost: a new machine-local file, and it must itself be
     gitignored (and not stale-trusted if deleted).
   - **Derive the fallback by dry-running the writers.** No new state. Cost: re-runs
     writers read-only; needs a dry-run mode in each, larger change.
   - **Keep a minimal static list for the poll only.** Cost: reintroduces the exact
     parallel enumeration this spec removes.
3. **Fold #763 into this spec?** (rec: yes, FR-7 - the issue asks for the same pass and both
   are untested path handling in one function.) Cost: spec/PR is larger; if refused, FR-7
   moves to its own spec and #763 stays open.
