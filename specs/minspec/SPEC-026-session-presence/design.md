---
id: SPEC-026
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-026 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: [SPEC-015, SPEC-022, SPEC-027, SPEC-044, SPEC-096, DR-037, DR-051, DR-066, "#380", "#575", "#1162", "#2403"]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-026 - Design: session presence and the concurrent-edit guard

Plan for [requirements.md](requirements.md). The contract is that file; this one says how
to build what is still missing. Citations of "today" are against `origin/main` at
`00f9ce35`, the commit this plan was written on. New code is named by symbol, because line
numbers move. This file replaces the 2026-07-01 draft that sat here with
`status: specifying`; that draft's hook bodies are folded in below, with the four defects
this plan found in them corrected (see *What changed from the draft*).

## What already exists (read, not assumed)

Layer 1 (presence, FR-1 to FR-7) is built and running. Layer 2 (the guard, FR-8 to FR-16)
is almost entirely unbuilt.

| Requirement | State on `00f9ce35` | Where |
|---|---|---|
| FR-1 sessions dir + gitignore | built | `SESSIONS_DIR` in `packages/minspec/src/lib/presence.ts`; `.minspec/sessions/` in `MINSPEC_GITIGNORE_ENTRIES` (`scaffold.ts`); covered in `tests/gitignore.test.ts` |
| FR-2 record shape | built | `SessionPresenceRecord`, `isValidRecord` in `presence.ts` |
| FR-3 heartbeat, atomic write, constants, `sessionId` into `session.json`, `MINSPEC_SESSION_ID` env | built | `SessionPresenceManager.start` / `writeHeartbeat`; `HEARTBEAT_SECS`, `STALE_SECS`; `extension.ts` sets `MINSPEC_SESSION_ID` through `environmentVariableCollection` |
| FR-4 liveness and prune | built | `isRecordLive`, `pidAlive`, `getActiveSessions` |
| FR-5 status bar `👥 N`, tooltip, Quick Pick | **not built** | `onDidChange` emitter exists; nothing in `src/views/status-bar.ts` consumes it |
| FR-6 cleanup, FR-7 `fs.watch` | built | `stop()`, `dispose()`, the watcher in `start()` |
| FR-8 carve-out statement | not built | lands with the gate (task 4) |
| FR-9 worktree command, steer toast, CLAUDE.md etiquette | **not built** | no command, no toast, no block in `CLAUDE_MD_TEMPLATE` |
| FR-10 TS predicate | partly built | `contendingLiveSessions` exists but returns `SessionPresenceRecord[]`, not the FR-10 `{ path, peer }[]`; no editor surface calls it |
| FR-11 trailer hook | not built | `SESSION_TRAILER_KEY` constant exists; no `prepare-commit-msg` template |
| FR-12, FR-13 pre-commit backstop + arbitration | not built | |
| FR-14 parity | not built for the contention predicate | a parity test exists for the sync gate only (`tests/presence-sync-parity.test.ts` against `scripts/drain-inbox.sh`) |
| FR-15.1 `post-checkout` | not built | |
| FR-15.2 approvable-on-main assertion | not built | |
| FR-16 resolution prompt, reveal worktree | not built | |

Also built since the spec was written, and reused here rather than re-derived:
`sameCheckout` (#2403, case- and realpath-safe tree comparison), `listWorktreeRoots`,
`isCheckoutOccupied` (the sync gate), and `classifyApprovablePath` in
`src/lib/approvable.ts` (classifies by file name, not by corpus directory, so FR-12/FR-15.2
need their own corpus-prefix test - see *Corpus filter*).

Layer 1's invariants INV-1 to INV-6 have tests, but only INV-1, INV-8 and INV-10 are tagged
by id (`grep -o 'INV-[0-9]*' tests/presence*.test.ts`). Task 1 tags or adds the rest so the
T0 acceptance line can be checked by grep.

## Where the hooks live

The three git hooks are **managed-region templates in
`packages/minspec/src/lib/template-registry.ts`**, scaffolded into an adopter's
`.minspec/hooks/` (DR-037). `PRE_COMMIT_HOOK` already holds Stage 0 (protected-branch
guard), the author-identity gate, the secret scan and the validator chain;
`MANAGED_REGION_TEMPLATES` registers `pre-commit-hook`, `commit-msg-hook` and `validate-py`.
This plan:

- appends the FR-12/FR-13 and FR-15.2 stanzas to `PRE_COMMIT_HOOK`, after the existing
  stages;
- adds two templates, `PREPARE_COMMIT_MSG_HOOK` and `POST_CHECKOUT_HOOK`, registered as
  `prepare-commit-msg-hook` and `post-checkout-hook` with `executable: true` and the
  `#!/usr/bin/env sh` preamble, beside the existing two.

`.minspec/hooks/` in this repo is generated output and is never hand-edited. This repo sets
`core.hooksPath=.githooks`, so the generated hooks do not run here; the `.githooks/` twin is
out of this plan's scope (see *Not in this plan*).

Every task that edits `template-registry.ts` is review machinery: its pull request needs the
founder's merge, never `--admin` (`machinery-review-required`).

## Decisions this plan makes

Each is an engineering choice inside what requirements.md allows, **except D-P2**, which
departs from FR-13.1's wording (requirements.md:350) and awaits an FR-13.1 amendment (#3332).
None answers a question the spec left to the founder. Alternatives rejected are recorded with each (DR-086 §4).

### D-P1 - Self-identity in pre-commit (closes OQ-5)

git runs `pre-commit` **before** `prepare-commit-msg`, and passes no message file to
`pre-commit`. So the pre-commit stanza cannot read the trailer: it does not exist yet. The
draft's `MINSPEC_COMMIT_MSG_FILE` cannot be populated by anything.

**Chosen:** the pre-commit stanza resolves `MY_SESSION` through the **same chain the trailer
hook uses** - `$MINSPEC_SESSION_ID`, then `sessionId` in `.minspec/session.json` - as one
shell function, `minspec_self_session`, defined once in each hook that needs it with
byte-identical text (a test asserts the copies match). The trailer then carries the same
value by construction, and serves its FR-11 purpose of a CI-visible record.

Rejected: (a) moving the gate to `commit-msg`, which does get the file after
`prepare-commit-msg` has stamped it - FR-12 names the pre-commit hook, and it would split the
DR-037 gate family across two files for no gain in correctness; (b) an exported message-file
variable - git creates the file after `pre-commit` runs, so it cannot work.

### D-P2 - Which `startedAt` arbitration compares (FR-13, INV-9)

The draft read self's `startedAt` from `.minspec/session.json`. That field is the time the
session **scope** was declared (`SessionState.startedAt`, `src/lib/session.ts`), not the
presence record's activation time. Worse, `session.json` is one file per working tree, so two
sessions in the same tree read the **same** self values. Comparing self's scope time with the
peer's presence time is asymmetric: A and B can each decide they hold, or each decide they do
not, which breaks INV-9.

**requirements.md contradicts itself here.** Line 118 (FR-2, the `startedAt` field) calls the
presence field "the FR-13 arbitration key". Line 350 (FR-13.1) says to "compare `startedAt` of
self (from `.minspec/session.json`) with the contending peer's". Those name two different
values for self. This plan follows line 118, because it is the only reading under which both
sides of the comparison are the same kind of value. It does not follow the literal wording of
line 350, so D-P2 is **not** inside what requirements.md allows. requirements.md is hash-locked
and is left untouched; the amendment is tracked in #3332 (amend FR-13.1 to the presence-record
`startedAt`). Task 4.1 is **blocked until #3332 is accepted**: no builder implements the arbitration
against the hash-locked line 350 wording, and this note is not a licence to. Once the
amendment is accepted, 4.1 follows the amended FR-13.1.

**Chosen:** self's `startedAt` is read from **self's own presence record**,
`.minspec/sessions/<MY_SESSION>.session.json`. Both sides then compare the same two values
and the order is total. `MY_SESSION` itself comes from the chain in D-P1
(`$MINSPEC_SESSION_ID`, then `sessionId` in `.minspec/session.json`), not from FR-13.1; the
shared `session.json` supplies the id only, never the timestamp. If self has no readable
presence record, self is treated as later (FR-13.1: the conservative side blocks).

### D-P3 - Staged set: no diff filter, no rename folding

FR-12 and FR-15.2 both say `git diff --cached --name-only`. The draft added
`--diff-filter=ACM` to the FR-12 stanza, which would let a live peer's claimed file be
deleted or renamed away without a block. **Chosen:** both stanzas use
`git diff --cached --name-only --no-renames`, so a rename lists its old path (deleted) and its
new path (added), and both are checked. Paths are read with `while IFS= read -r`, never
word-split, so a path with a space is one path.

### D-P4 - Timestamp parsing in a POSIX hook

The bash sync gate in `scripts/drain-inbox.sh` parses `lastSeen` with GNU `date -u -d`. An
adopter's hook also runs on macOS, where `date -d` does not exist. **Chosen:** one helper,
`minspec_iso_epoch`, tries GNU `date -u -d "$iso" +%s`, then BSD
`date -j -u -f '%Y-%m-%dT%H:%M:%S' "${iso%.*}" +%s`; if both fail the record is treated as
**not live** (fail-open, INV-12). Rejected: adding an epoch field to the record (CTR-1 allows
it, but every reader would then have two sources of truth for one time).

### D-P5 - Corpus filter

One constant, `APPROVABLE_CORPUS_PREFIXES = ['specs/', 'docs/decisions/', 'docs/domain/',
'docs/epics/']`, exported from `presence.ts`, with `isApprovableCorpusPath(repoRelPath)`. The
hook duplicates it as a `case` pattern with a tie-back comment; the parity test (task 2)
asserts the two lists are equal by reading the template text. FR-9's "declared work includes a
code path" test is `fileAllowlist.length === 0 || fileAllowlist.some(p =>
!isApprovableCorpusPath(p))`.

### D-P6 - FR-15.2 next to the shipped protected-branch guard

Since the spec was approved, Stage 0 of `PRE_COMMIT_HOOK` refuses an authored commit on the
default branch when that branch is push-protected (inferred from `origin/HEAD`, or the
`main master trunk` fallback when an `origin` remote exists; opt-outs `MINSPEC_ALLOW_MAIN=1`
and `minspec.allowCommitOnDefaultBranch`). FR-15.2 refuses an approvable commit on the
**primary** checkout when HEAD is **not** the default branch, and exempts linked worktrees.

Together, on a remote-backed repo with a protected default branch, the primary checkout
commits no approvable at all, and approvables go worktree branch to pull request. That is
not a deadlock: the worktree exemption is the path, and it is how approvables move in
practice today. On a repo without a protected default branch, approvables commit on the
default branch on the primary, as DR-051 §4b intends. FR-15.2 itself is implemented by this plan exactly as
specified (task 5 builds it; it is not built today).

What the plan does decide is the **wording**: FR-15.2's rejection message must not tell the
user to "commit on main" when Stage 0 would then refuse that. The stanza reuses Stage 0's own
decision (factored into a function, `minspec_default_branch_guarded`, which Stage 0 then also
calls, so the two cannot disagree; the factored body keeps every line pinned by the
`.githooks` twin test in `tests/pre-commit-protected-branch.test.ts`, and `.githooks/` is not
touched) and prints "use a worktree branch and a pull request" when
the default branch is guarded, and "switch to `<default>`" when it is not. The CLAUDE.md
etiquette block (task 10) states the same rule.

The reconciliation of DR-051 §1 ("approvables edit on main") with the shipped Stage 0 guard is
#575's business, not this spec's; nothing here changes either rule.

### D-P7 - `post-checkout` safety rails the draft lacked

FR-15.1 reverts a switch "on the primary checkout". The draft's body had no primary check, so
it would have reverted an agent switching branches **inside its own worktree** - the exact
thing rule #8 tells it to do. It also called `git switch -`, which fires `post-checkout` again
and, in agent context, would revert the revert forever. The template therefore:

1. exits 0 unless the top-level `.git` is a **directory** (primary checkout); a linked
   worktree's `.git` is a file;
2. exits 0 while a rebase, merge, cherry-pick or revert is in progress (the same
   `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` markers
   Stage 0 checks), because a rebase checks out commits as part of its own work;
3. exits 0 when `prev` is the all-zero sha (a fresh clone or `worktree add`);
4. runs the revert as `MINSPEC_HEADGUARD_OFF=1 git switch -` (falling back to
   `git checkout -`), so the hook it triggers is a no-op.

### D-P8 - Which status-bar item carries `👥 N`

FR-5 says "the existing MinSpec status bar item". There are three today; only
`MinSpecNextTaskStatusBar` is always shown (the scaffold-commit and tidy-primary items appear
only when they have something to report). **Chosen:** the next-task item. Its text gains the
` 👥 N` suffix when N is at least 1; its tooltip gains one line per peer in the FR-5 format.
While N is at least 1 its click runs a new command, `minspec.showSessions`, whose Quick Pick
lists **"Next task"** first (running `minspec.nextTask`), then one entry per peer, so the
click loses nothing. The next-task keybinding is untouched. `minspec.showSessions` gets its
own keybinding, shown in the tooltip and in the command title (hotkey visibility rule).
Updates are debounced to at most once per 10 s, as FR-5 requires.

Rejected: a fourth, separate status-bar item - FR-5 says the existing item gains a suffix.

### D-P9 - What "edit-intent time" is (FR-10)

**Chosen:** the first time a corpus document goes dirty in this window
(`workspace.onDidChangeTextDocument` with `document.isDirty` and the path not yet warned),
plus once on opening a corpus file already claimed. One non-modal warning toast per
`(path, peer.sessionId)` per activation, naming the peer by scope (FR-16). The decision logic
is a pure function in a new `src/lib/contention-advisory.ts`; `extension.ts` only wires the
event. Rejected: `onWillSaveTextDocument` - by then the edit is made, and FR-10's whole value
is firing before tokens are spent.

### D-P10 - New Session Worktree path and name

FR-9 fixes the location `~/code/.worktrees/<repo>/<name>` and says the extension calls
`git worktree add ... -b <name>` itself. `<repo>` is the basename of the primary's
`git rev-parse --show-toplevel`; `<name>` comes from an input box, validated with
`git check-ref-format --branch`; the base is `origin/<default>` when that ref exists, else
`HEAD`, matching `push-docs-lane.ts` and `approval-recover.ts`, which already call
`worktree add` this way. On success the command offers to open the folder in a new window.
The toast's "Create Worktree" button runs the same command. It never runs unasked.

## Contracts

- `SessionPresenceRecord` (FR-2): unchanged. Add-only (CTR-1).
- `contendingLiveSessions(rootDir, worktreeRoot, paths, selfSessionId?, now?)` changes its
  return type to `{ path: string; peer: SessionPresenceRecord }[]` - one entry per
  contended path and peer, as FR-10 specifies. Its only callers today are tests.
- `isApprovableCorpusPath(repoRelPath: string): boolean`, `APPROVABLE_CORPUS_PREFIXES` (D-P5).
- Shell functions inside `PRE_COMMIT_HOOK`, each between its own
  `# >>> minspec:fn:<name> >>>` / `# <<< minspec:fn:<name> <<<` comment pair so a test can
  extract and run it alone:
  - `minspec_iso_epoch ISO` - epoch seconds or non-zero exit (D-P4);
  - `minspec_self_session` - prints `MY_SESSION` or nothing (D-P1);
  - `minspec_cedit_contenders STAGED_FILE` - prints `path<TAB>peerRecordFile` for each
    contended path; liveness and coverage only, no arbitration (FR-14's parity scope);
  - `minspec_cedit_gate` - FR-12/FR-13 verdict, exit 0 or 1;
  - `minspec_default_branch_guarded` - Stage 0's decision, factored (D-P6);
  - `minspec_approvable_main_gate` - FR-15.2 verdict.
- Kill-switches: `MINSPEC_CEDIT_OFF`, `MINSPEC_HEADGUARD_OFF`, `MINSPEC_TRAILER_OFF`,
  `MINSPEC_APPROVABLE_MAIN_OFF`. Shell constants `STALE_SECS=120`, `HEARTBEAT_SECS=30` with a
  comment naming `presence.ts`; a test ties them to the TS constants.
- Trailer: `MinSpec-Session: <uuid>`, key from `SESSION_TRAILER_KEY` (CTR-2). The template
  text is built from the constant, not a second literal.

## Coverage semantics, both engines

`isPathClaimed` in `presence.ts` is the TS rule: normalise `\` to `/`, strip a trailing `/*`
and trailing slashes from the allowlist entry, skip an empty entry, then match if the path
equals the entry, or starts with `entry/`. (It also matches when the entry sits under the
path, which only matters for a directory path; staged paths are always files, so the bash
twin need not implement it, and the parity fixtures use file paths only - stated in the test
header.) The bash twin implements exactly the first two rules. An empty allowlist is no
claim (INV-10).

## The pre-commit stanzas in outline

`minspec_cedit_gate` (FR-12/13), in order:

1. `MINSPEC_CEDIT_OFF=1` ⇒ allow.
2. `.minspec/sessions/` missing, or no `*.session.json` in it ⇒ allow (FR-8 carve-out,
   INV-11). The FR-8 carve-out paragraph is stated as a comment directly above the function.
3. Resolve `MY_SESSION` (D-P1), self `startedAt` (D-P2), tree root, now, staged set (D-P3).
   Any git or date failure ⇒ allow.
4. `minspec_cedit_contenders` yields contended `(path, peer)` pairs: peer id differs from
   `MY_SESSION`; peer `worktreeRoot` equals this tree root (string compare after
   `cd -P`-style canonicalisation where the path exists); peer live (fresh and `kill -0`);
   allowlist non-empty and covering; path in the corpus.
5. For each pair, arbitration: the peer holds iff self `startedAt` is unknown, or the peer's
   is lexically earlier, or they are equal and the peer's `sessionId` is lexically lower.
   `MY_SESSION` empty ⇒ FR-13.2 self-fallback: the pair is skipped if the peer's pid equals
   the committing shell's parent chain root when derivable, and otherwise **allowed** with a
   warning line (never a self-block).
6. Any held pair ⇒ print, per pair, the peer's **scope**, branch, pid, `lastSeen` and
   `startedAt` (FR-16, never a bare uuid), the resolution text from FR-12 (wait up to 120 s,
   pick a different document, or coordinate - with the FR-16 copy-paste prompt printed
   inline), and the bypass; exit 1.

`minspec_approvable_main_gate` (FR-15.2): kill-switch; linked worktree ⇒ allow; no corpus
path staged ⇒ allow; default branch from `git symbolic-ref --short
refs/remotes/origin/HEAD`, fallback `main`; current branch empty (detached) or unresolvable ⇒
allow; current ≠ default ⇒ reject with the D-P6 wording.

Both run after the existing stages, each with its own `|| exit 1`; neither adds a
whole-hook `exit 0` (an existing test forbids that above Stage 0, and the same rule holds
here).

## What changed from the draft

1. Self-id read from a message file that does not exist at pre-commit time (D-P1).
2. Self `startedAt` read from the scope time in the shared `session.json` (D-P2).
3. `--diff-filter=ACM` let deletes and renames past the gate (D-P3).
4. `post-checkout` had no primary-checkout test, no in-progress-operation test, and re-fired
   itself on revert (D-P7).
5. Rejection and etiquette text said "approvables commit on main" without allowing for the
   Stage 0 guard shipped since (D-P6).

## Files

From requirements.md *Traceability - Files to modify*, plus these, each for the reason
given:

- `packages/minspec/src/lib/contention-advisory.ts` (new) - D-P9 pure decision logic, kept
  out of `extension.ts` so it is testable without a vscode mock.
- `packages/minspec/src/commands/new-session-worktree.ts`,
  `packages/minspec/src/commands/show-sessions.ts` (new) - the FR-9 command and the FR-5/FR-16
  Quick Pick, following the existing one-command-per-file layout in `src/commands/`.
- `packages/minspec/package.json` - `contributes.commands` and `keybindings` for the two new
  commands.
- `packages/minspec/tests/helpers/presence-fixtures.ts` (new) - the golden fixture set both
  engines read (FR-14).
- New test files named in tasks.md.

`packages/minspec/src/lib/session.ts` needs no change: `SessionState.sessionId` already
round-trips. `scaffold.ts` needs no change: the gitignore entry exists, and new
`MANAGED_REGION_TEMPLATES` entries are scaffolded by the existing loop (task 3 checks this
with `tests/dr037-hook-scaffolds.test.ts` rather than assuming it).

## Not in this plan

- **The `.githooks/` twin in this repo.** Dogfooding the guard here needs a separate
  decision: this repo's automation runs many sessions on one machine, and the agent-strict
  `post-checkout` changes their behaviour. Filed as an inbox issue when this plan's pull
  request opens (number cited in the pull request body).
- **Tier-2 negotiation** - SPEC-027.
- **Making an accurate `fileAllowlist` mandatory** (the draft's third open question) -
  requirements.md *Out of Scope* leaves it to #380's fan-out; this plan does not decide it.

## Risks

- **Shared ext-host pid.** All sessions in one VS Code window share one presence record, so
  the guard serialises windows, not Claude tabs within a window. That is what FR-11 says and
  the spec accepts; the tests do not pretend otherwise.
- **The `session.json` fallback names one session per tree.** When `MINSPEC_SESSION_ID` is
  unset (a bare terminal), D-P1 falls back to `session.json`, which holds whichever window
  wrote it last, so a human committing from a bare terminal may be treated as that window.
  The consequence is an allow, never a self-block, which is the FR-13.2 direction.
- **The repo's own `.minspec/hooks/` copy is tracked and already older than the template**
  (it lacks Stage 0). No task regenerates it; a task does so only if a test it runs requires
  it.
- **The hook is inert where `date` parses neither form.** D-P4 fails open; the FR-8
  carve-out classifies this gate as advisory, so it is not a silent merge gate under
  constitution invariant 2. Task 4 prints one `info:` line when it cannot parse a record, so
  inertness is visible.
- **Machinery merges.** Tasks 2 to 6 and 10 edit `template-registry.ts`, so each waits for a
  human merge. They are ordered so each lands independently and leaves the hooks working.
