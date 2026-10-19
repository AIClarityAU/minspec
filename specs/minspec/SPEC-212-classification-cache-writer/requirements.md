---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-004  # Classifier Validation
aspects: [classifier, auto-bootstrap, prompt-suppression, tier-0, offline, opt-in]
relates_to: ["#2080", "#2079", "#2355", "#203", "#216", SPEC-096, SPEC-004]
implements: none
implements_reason: >-
  Changes land in existing files (`classify.ts`, `auto-bootstrap.ts`) that no spec owns;
  a defect spec should not freeze them.
affects: [packages/minspec/src/commands/classify.ts, packages/minspec/src/lib/auto-bootstrap.ts]
---

# SPEC-212: Classification cache that settles the classify prompt

Issue: #2080. Related: #2079 (classify prompt ignores "Always" - fixed on the Always path only, deliberately leaving this change out).

## Problem (verified in code)

`hasUnclassifiedChanges` (`packages/minspec/src/lib/auto-bootstrap.ts`) returns `false` when any regular file in `.minspec/classifications/` has `mtimeMs >= .git/index` mtime ("the latest classification postdates the latest stage activity"). It also creates that directory (via `ensureDirectory`, only below an existing `.minspec/`, #2355).

Nothing writes a file there. `classifyCommand` (`packages/minspec/src/commands/classify.ts`) shows a toast ("... nothing is saved") or, in auto mode, a status-bar line, and persists no result. So the suppression clause can never fire, and clicking `Classify` on the prompt leaves the condition that raised it untouched: the prompt re-arms on every staging change.

## Scope

One sentence: a user-initiated classification run records a single small result file in the directory the reader already watches, so acting on the prompt settles it until staging changes again.

## Functional requirements

- **FR-1** After an explicit (non-`auto`) `classifyCommand` run completes the classification in a folder where `.minspec/` exists, it writes `.minspec/classifications/latest.json`, overwriting any previous copy. No other file name is written (bounded: never more than one file).
- **FR-2** `latest.json` contains `{ "tier": "T1".."T4", "classifiedAt": <ISO-8601 UTC>, "usedStaged": <boolean> }`. No file paths, diff content, or signal values (nothing sensitive, nothing that grows with the diff).
- **FR-3** The write goes through the shared guard that cannot create `.minspec/` (SPEC-096 FR-4, `ensureDirectory`/the existing opt-in-safe store pattern). A folder without `.minspec/` gets no write and no directory (invariant 3; same rule as #2355).
- **FR-4** A write failure (read-only FS, permissions) must not fail or block the classify command and must not be swallowed silently: it is logged to the MinSpec output channel and the verdict is still shown. The consequence of failure is only that the prompt is not suppressed (fail toward prompting, not toward silence).
- **FR-5** The write is atomic enough that the reader never sees a partial file (write temp in same directory then rename, or equivalent); the reader only tests existence and mtime, so a torn file would still suppress - the file must be complete when it appears.
- **FR-6** The advisory toast text no longer claims "nothing is saved" for the opted-in case; it states that the result is recorded for prompt suppression only. Non-opted-in text is unchanged.
- **FR-7** `hasUnclassifiedChanges` logic is unchanged (its `mtime >= index` comparison is the contract); a comment there is updated to name `latest.json` and its writer so the signpost is true.
- **FR-8** Behaviour for auto runs (fired by the git-HEAD watcher): see Decisions needed D-1.

## Acceptance criteria

- **AC-1** Given an opted-in git repo with staged activity, `hasUnclassifiedChanges` is `true`; after `classifyCommand` (explicit) runs, it is `false`; after a subsequent `git add` (index mtime moves past `latest.json`), it is `true` again.
- **AC-2** Running classify twice yields exactly one file in `.minspec/classifications/`.
- **AC-3** In a folder with no `.minspec/`, classify writes nothing and `.minspec/` does not exist afterwards.
- **AC-4** With the directory made unwritable, classify still shows its verdict, logs the failure, and the prompt still fires.
- **AC-5** `latest.json` parses and matches the FR-2 shape; no key outside it.
- **AC-6** Tests run in a temp directory and assert the real file effect (not source text), including a mtime-ordering case with index touched after the write.

## Invariants this must not break

- Offline: local file write only, no network (constitution invariant 1).
- No silent gate: failure is visible in the output channel; no swallowed error on the write (invariant 2). The prompt is an advisory nudge, not a merge gate, so fail-toward-prompting is the safe direction.
- Blast radius: only an opted-in repo (`.minspec/` present) is written to; the detector still cannot manufacture the marker (invariant 3, #2355).
- The prompt continues to fire for repos that never classify (behaviour change only after the user acts).

## Out of scope

- The "Always" preference path (#2079).
- Pruning/history of past classifications (single overwritten file by design).
- Whether `.minspec/classifications/` should be gitignored (see D-2).

## Decisions needed (Clarify)

- **D-1: Do auto (commit-triggered) runs write the cache?**
  - (a) **(rec)** No - only explicit runs. An ambient commit-run is not the user acting on the prompt; a commit also rewrites `.git/index`, and writing there would add churn on every commit. Cost: after an auto-mode run the prompt can still appear on the next staging change, as today.
  - (b) Yes, both. Cost: a file write on every commit, and the suppression then depends on write-vs-index ordering within the commit hook (a write just before the index update would not suppress).
- **D-2: Is `latest.json` committed or ignored?** It is machine-local state whose mtime matters and would diff on every classification.
  - (a) **(rec)** Ensure it is git-ignored for adopters (a `.minspec/.gitignore` line or equivalent). Cost: touches what MinSpec scaffolds into adopters, a wider blast radius than the one-file write, and needs its own opt-in-safe review.
  - (b) Leave to the user. Cost: a dirty tree after every classify, which itself moves nothing in the index but invites accidental commits.
- **D-3: Reject the alternative of deleting the suppression clause?** The issue's second option. Recommended **reject** (rec): it removes the only designed path by which acting on the prompt can settle it. Cost of rejecting: a new on-disk artifact (bounded to one file by FR-1).
