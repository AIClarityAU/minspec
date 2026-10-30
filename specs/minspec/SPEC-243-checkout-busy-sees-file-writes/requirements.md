---
id: SPEC-243
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [shared-checkout, liveness, no-silent-gate, fail-closed, operator-tooling, offline]
depends_on: []
relates_to: ["#2162", "#2161", "#2153", "#2154", "#2155", DR-065, SPEC-077]
implements: none
implements_reason: >-
  Specify phase only. The code this spec governs lives outside this repository
  (~/.claude/scripts/cos.py and ~/.claude/scripts/cos-runner/cos-runner-state.py, operator
  tooling on the founder's machine); which files it owns is fixed at Plan, after D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-243: `checkout_busy()` sees plain working-tree writes and fails closed when any witness cannot be read

> **This is a SPECIFICATION ONLY.** Written for issue #2162. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Before the chief of staff hands the founder a command that moves a shared checkout (discard,
fast-forward, branch switch), it asks `checkout_busy()` "is anything operating on this tree
right now?". Today that question is answered only by git's own operation markers and the
age of `.git/HEAD`. A process that just rewrites files leaves none of those, so the answer is
"idle" while a pipeline is writing the tree. This spec adds a witness that sees file writes,
makes every witness fail closed, and asks the human three questions the issue deliberately
left open.

## Root cause (mechanism + missing gate)

- **Mechanism.** `checkout_busy()` (in `~/.claude/scripts/cos.py`, lines 890-929, read 2026-10-27)
  checks six markers in the git dir (`index.lock`, `rebase-merge`, `rebase-apply`,
  `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG`, `:915-922`) and whether `.git/HEAD` was
  written in the last 300 s (`:923-926`). All of those are side-effects of **git
  operations**. A writer that edits tracked files without running a HEAD-moving or
  index-locking git command is outside what the witness can observe, by construction.
- **Missing gate.** No second, independent witness for working-tree writes exists, so the
  single-producer gap is not caught (constitution invariant 2: "no required check hinges on
  a single producer"). The skill makes this predicate one of four required facts before any
  tree-moving command is offered (the chief-of-staff-runner skill's SKILL.md, lines 868
  and 1774), so it is load-bearing.
- **Existing fail-open.** If `os.path.getmtime(<gitdir>/HEAD)` raises `OSError`, the
  function falls through to `return False, ""` (`cos.py:927-929`): an unreadable witness
  reports "idle". Same invariant, same fix.

## Measured evidence

From the issue (2026-09-26 14:50, not re-measured here): `checkout_busy('/home/jason/code/MinSpecPro')`
returned `(False, '')`; `.git/HEAD` mtime was 4 days old; no markers; `drain-inbox.sh --auto`
(pid 1677, cwd = that checkout) had rewritten 12 tracked files 13 minutes earlier.

Read for this spec (2026-10-27):

- The drain's cycle period defaults to **1200 s** (`scripts/drain-inbox.sh:250`,
  `INTERVAL="${MINSPEC_DRAIN_INTERVAL:-1200}"`). The measured write was 780 s old. **A
  file-mtime witness with the existing 300 s window would also have reported idle** in the
  measured case. The window is therefore not a tuning detail; see D2.
- The drain holds a pid lock at `/tmp/minspec-drain-inbox.lock`
  (`scripts/drain-inbox.sh:223`, liveness probe `:3381-3384`).
- Callers of the predicate: `cos.py:1189` (the `tick` GIT-BRANCH alert) and
  `cos-runner-state.py:290` (primaries survey) and `:314-325` (`busy PATH` command, exit 1 =
  busy). The runner imports the same function, so there is one predicate, not two copies.
- MinSpecPro tracks 1240 files (`git ls-files | wc -l` in this worktree), so a full stat of
  tracked paths is cheap at this scale.

## Why not a cwd/process scan alone

The drain reaches other repos with `git -C <path>`, so its cwd is never those repos
(already recorded in the function's docstring, `cos.py:900-904`). A cwd scan is blind in the
opposite direction. Neither git markers nor cwd is sufficient alone; this spec does not use
cwd as a witness of idleness.

## Functional requirements

- **FR1 - Working-tree write witness.** `checkout_busy(repo)` reports busy when any file in
  the witness set (D1) has an mtime newer than `now - window` (D2). The `why` string names
  the witness, the newest path, and its age in seconds.
- **FR2 - Witnesses combine by OR.** The result is busy if ANY witness reports busy. Order of
  evaluation may short-circuit on the first busy witness; it must never short-circuit on
  "idle".
- **FR3 - Fail closed on an unreadable witness.** If any witness cannot be evaluated (git
  command fails or times out, `stat` raises, the file list is empty when the repo has a
  `HEAD` commit, the git dir is unresolvable), the result is `(True, "cannot read <witness>:
  <reason> - treat as busy")`. This replaces the `except OSError: pass` at `cos.py:927-928`.
- **FR4 - Future mtimes are busy.** An mtime later than `now` (clock skew across container
  boundaries) counts as busy, with the skew in the `why` string; never as idle.
- **FR5 - The probe does not write.** Evaluating the witnesses must not modify the repo:
  no `git status` without `--no-optional-locks` (a plain `git status` may refresh and
  rewrite `.git/index`), no fetch, no index refresh. A second call immediately after the
  first must not be made "busy" by the first.
- **FR6 - Offline.** No network call (invariant 1). All witnesses are local filesystem or
  local git reads.
- **FR7 - Callers report the witness that fired.** The `busy` command text at
  `cos-runner-state.py:324` ("HEAD not written in the last 5 minutes") is updated to list
  every witness evaluated and the window, so an idle answer says what it checked. Exit codes
  are unchanged (0 idle, 1 busy, busy on unknown).
- **FR8 - Bounded cost.** One call completes in under 2 s on a checkout of 10 000 tracked
  files on local disk; above a configured file-count ceiling the witness reports
  `cannot read ... (too many files) - treat as busy` rather than silently sampling.
- **FR9 - Skill prose matches.** The skill paragraph that describes the predicate
  (the chief-of-staff-runner skill's SKILL.md, lines 908-910) is updated in the same change to name the new
  witness and the window, so the prose does not describe the old gate.
- **FR10 (conditional on D3 = a).** A live-actor witness: if the drain lock
  (`/tmp/minspec-drain-inbox.lock`, path overridable by `MINSPEC_DRAIN_LOCK`) names a live
  pid, and that drain's target set includes `repo`, the checkout is busy, why = "the drain
  (pid N) is live and writes this checkout every cycle". An unreadable lock is FR3 (busy).

## Acceptance criteria

Each is a fixture test against a throwaway repo in a temp dir, plus one control.

- **AC1** - Repo with no markers, HEAD mtime 4 days old, one tracked file touched 60 s ago:
  busy, `why` names that file. **Control:** same repo, file touched before the window: idle.
- **AC2** - The measured shape: tracked file written 780 s ago, HEAD old. Expected result is
  whatever D2 decides, stated as a test (the test exists either way, so the choice is
  visible, not implicit).
- **AC3** - `<gitdir>/HEAD` made unreadable (or the git dir removed after resolution):
  busy with a "cannot read" reason. Today this returns idle; the test must fail on
  today's code.
- **AC4** - `git ls-files` replaced by a failing binary on `PATH`: busy, "cannot read".
- **AC5** - File mtime set 120 s in the future: busy, reason mentions skew.
- **AC6** - Linked worktree (`.git` is a file): the witness reads that worktree's files and
  git dir, not the primary's.
- **AC7** - Two consecutive calls on an idle repo both return idle, and the mtimes of
  `<gitdir>/index` and `<gitdir>/HEAD` are unchanged between before and after (FR5).
- **AC8** - Untracked-but-not-ignored file written 60 s ago: busy if D1 includes untracked
  files; idle otherwise. Ignored file (e.g. under `node_modules/`) written 60 s ago: idle
  (ignored output is not tree content a fast-forward or discard touches).
- **AC9** - Mutation check: deleting the new witness from the OR, or reverting FR3 to
  `pass`, makes at least one of AC1/AC3/AC4 fail (so the tests are not vacuous).
- **AC10 (if FR10)** - Lock file with a live pid and the repo in the target set: busy. Lock
  with a dead pid: that witness idle. Lock unreadable: busy.

## Invariants this change must not break

- **Invariant 1 (offline).** No network call in any witness (FR6).
- **Invariant 2 (no silent gate).** Every witness fails closed (FR3); the gate gains an
  independent second producer (FR1) instead of one.
- **Invariant 3 (blast radius).** The change touches only the founder's own operator
  tooling in `~/.claude/`; nothing shipped in the MinSpec extension or scaffolded into an
  adopter repo changes.
- **DR-065.** This predicate stays an extra precondition on offering a tree-moving command;
  it does not authorise one. G1-G4 in `sync_shared_checkouts()` (`scripts/drain-inbox.sh:711`)
  are not modified by this spec.
- **Existing behaviour.** Every case that is busy today stays busy (markers, HEAD < 300 s,
  unresolvable git dir).

## Out of scope

- Fixing the drain so it stops rewriting the shared checkout every cycle: that is #2161.
  With this spec built, that checkout will correctly read busy whenever the drain has
  written it within the window; #2161 is what lets it ever read idle.
- Changing `sync_shared_checkouts()` guards in the drain.
- An inotify/fanotify daemon. A long-lived watcher would see writes exactly, but it is a new
  always-on process with its own liveness problem; this predicate is a one-shot read.

## Decisions needed (Clarify)

**D1 - Which files the write witness reads.**

- **a (rec)** Tracked files (`git ls-files -z`) plus untracked-not-ignored files
  (`git ls-files -z --others --exclude-standard`), newest mtime across them. Sees same-content
  rewrites (which leave `git status` clean) and new files. Cost: one `stat` per file, and
  any editor save in the tree, including the founder's own, reads as busy.
- **b** Only currently dirty paths (`git --no-optional-locks status --porcelain`). Cheaper
  and quieter. Cost: blind to a rewrite that restores identical content, and blind once the
  writer commits; the measured drain rewrite may well have been such a case (unverified).
- **c** `.git/index` mtime. Cheapest. Cost: any reader running plain `git status` rewrites
  the index, so the probe's own neighbours make it noisy, and a writer that never stages
  is invisible. Not recommended.

**D2 - The window for the write witness.**

- **a (rec)** A separate constant, default `2 x MINSPEC_DRAIN_INTERVAL` (2400 s with today's
  default), so a writer that runs every cycle is never seen as idle between cycles. Cost: a
  checkout edited by hand in the last 40 minutes reads busy, so the chief of staff surfaces a
  decision instead of a ready command more often.
- **b** Reuse 300 s, matching HEAD. Cost: the measured case (780 s) still reads idle; the
  defect this spec exists for stays open.
- **c** A short window plus D3 = a. Cost: the drain coupling in D3 becomes load-bearing, and
  any other periodic writer that is not the drain is missed between its runs.

**D3 - Whether a known periodic actor counts as busy even while it sleeps.**

- **a** Add FR10: a live drain lock whose target set includes the checkout means busy.
  Cost: `cos.py` takes a dependency on the drain's lock path and on a definition of its
  target set that does not exist as a readable list today (Plan must find or create one),
  and while #2161 is open the MinSpecPro checkout reads busy for as long as the drain is
  alive.
- **b (rec)** No actor witness now; rely on D2 = a. File-recency is actor-agnostic, so it
  covers writers this tool has never heard of. Cost: a drain that has been asleep for longer
  than the window, and is about to write again, reads idle; DR-065's G2/G4 remain what make
  a fast-forward safe in that gap.

## Follow-ups (tracked)

- #2161 - the drain rewrites the shared checkout every cycle (the concrete case this gate
  missed; out of scope above).
- Skill prose (FR9) is in scope of this spec's implementation, not a separate item.
- None other.

## Links

- Issue: #2162
- Design rests on: DR-065 (the sanctioned shared-checkout fast-forward and its G1-G4
  guards). No new decision record: every choice here is a constant or a function body in
  operator tooling, reversible in well under a day (the decision-record filter: only choices that cannot be
  undone in under a day need one).
