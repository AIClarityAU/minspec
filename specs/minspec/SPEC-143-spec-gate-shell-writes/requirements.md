---
id: SPEC-143
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the doc-before-code gate is the methodology's write-time enforcement
aspects: [spec-gate, hooks, no-silent-gate, bypass-permissions, shell-parsing, blast-radius]
relates_to: [DR-012, DR-031, DR-047, SPEC-022, SPEC-038, "#1911", "#1893", "#37", "#1158", "#1816", "#1543"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). NEW files are
# owned: the command-text write extractor, the after-the-command content witness, and their
# tests. MODIFIED, not owned: spec-gate.py (SPEC-022's gate) gains a Bash arm and an honest
# docstring; spec-gate.sh gains a kill-switch audit line for Bash; .claude/settings.json
# gains the two matcher entries. Note that declaring spec-gate.py under affects: arms the
# gate on it for other sessions once this spec leaves Clarify unapproved - intended, since
# this spec rewrites its decision path.
implements: [scripts/hooks/spec_gate_bash.py, scripts/hooks/spec-gate-post.py, scripts/hooks/test_spec_gate_bash.py, scripts/hooks/test_spec_gate_post.py]
affects: [scripts/hooks/spec-gate.py, scripts/hooks/spec-gate.sh, .claude/settings.json]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-143: The spec gate also sees writes made through the shell

Triggered by: #1911 (the spec gate is matcher-scoped to Edit/Write/MultiEdit, so a Bash
write to a gated file is never evaluated).

## In plain terms

The spec gate stops an agent from changing code that belongs to a T3/T4 (full-ceremony)
spec nobody has approved yet. Today it only checks three editing tools: Edit, Write and
MultiEdit. If the agent changes the same file from the shell instead - `sed -i`, `>`, `tee`,
a heredoc, `python3 -c`, `git apply` - the gate never runs and leaves no record.

With this spec, two checks cover the shell:

1. **Before the command runs**, the gate reads the command text. If the command clearly
   writes to a file an unapproved spec owns, the gate refuses it, the same way it refuses an
   Edit today.
2. **After the command runs**, a second check compares the owned files against how they
   looked before the command. If one changed anyway, because the first check could not see
   the write (a variable path, a script, `eval`), it says so at once, names the file and
   the spec, and writes an audit line.

Commands that touch no spec-owned file behave exactly as they do now.

## Context

**The hole, cited.** `.claude/settings.json:5` wires the gate on
`"matcher": "Edit|Write|MultiEdit"`, and `scripts/hooks/spec-gate.py:465-466` re-checks it
(`if tool not in ("Edit", "Write", "MultiEdit"): passthrough()`). A `Bash` call never reaches
the owned-set check. The `MINSPEC_GATE_OFF` audit in `scripts/hooks/spec-gate.sh` is never
reached either, so `.minspec/gate-bypass.log` has nothing to show. The result is not a wrong
verdict. It is no verdict, and from outside that looks the same as a file no spec governs.
#1893 (the gate fails open outside cwd) has the same shape.

**Why this is the routine path.** The gate's docstring (`spec-gate.py:8-10`) calls a
PreToolUse deny "the only enforcement that survives bypass-permissions mode". Agents here
run in that mode, and the harness guidance in that mode steers file work towards the shell.
So the gate's strongest claim holds least in the mode it names.

**Precedent for reading command text.** `scripts/hooks/host-write-guard.py` (#1816) is
already a PreToolUse hook on `Bash`. It splits a command into simple commands on shell
operators (`SEGMENT_SPLIT`, line 64) and judges each segment on its own, because a
whole-string match let a mention inside an argument count as the act. Its docstring states
plainly what text-reading cannot catch. This spec reuses that approach and that honesty.

**Why one witness is not enough (constitution invariant 2).** Reading command text has no
upper bound. `eval`, `$VAR/x.ts`, `bash ./script.sh`, `python3 -c 'open(...)'`,
`find -exec`, `xargs` and `git apply` of a patch can all hide the target. If text-reading
were the only check, every one of those would pass silently, which invariant 2 forbids ("no
required check hinges on a single producer"). The after-the-command witness (FR-9 to FR-14)
does not read the command at all. It checks file content, so a write that slips past the
parser still shows up.

**What the issue's three options became.**

- *(issue rec) Add `Bash` to the matcher and parse write-shaped commands.* Taken, as the
  first check (FR-1 to FR-8).
- *Cover the class at the commit or CI boundary.* Not taken as the fix, because the write
  would still land unchecked in the working tree, and #1158 means no Python gate test runs
  in CI. Kept open as OQ-4.
- *Accept and document a tool-only scope.* Taken in part. The docstring is rewritten to
  say what is covered and what is not (FR-16). Documentation alone is not the fix.

**What "pairwise" forbids (DR-047 section 3).** The gate blocks only the code a given
unapproved spec owns, never the whole repo. Every deny and every alert in this spec is tied
to one or more named blocking specs and their owned files. A command the gate cannot fully
read is **never** denied on that ground alone, because that would block all shell use while
any spec is unapproved: the repo-wide freeze DR-047 section 3 rejects. The second witness
exists so that this allow is not a silent pass.

## Terms

- **Blocking spec / owned set**: as `spec-gate.py` computes them today. A blocking spec is a
  T3/T4 spec whose phases put it in implementation and whose approval is missing or stale.
  Its owned set is its `implements:`/`affects:` files plus existing backtick paths in its
  `tasks.md`. This spec does not change how either is computed.
- **Protected set**: the union of the owned sets of all blocking specs, as exact
  cwd-relative POSIX paths.
- **Write-shaped command**: a Bash command with at least one segment matching an FR-3
  pattern.
- **Resolved target**: a path taken from command text with no unexpanded `$`, backtick,
  `$(`, glob character (`*?[`), brace expansion or `~user` left in it. `~/` expands to
  `$HOME`.
- **Unresolved write**: a write-shaped segment whose target cannot be resolved, or a
  segment of a kind FR-4 lists as opaque.

## Requirements

### A. Wiring

- **FR-1** `.claude/settings.json` runs the spec gate as a PreToolUse hook on `Bash` as
  well as `Edit|Write|MultiEdit`. The gate's tool check accepts `Bash`. `host-write-guard.py`
  stays on the same matcher, unchanged. If either hook denies, the command is denied.
- **FR-2** A PostToolUse hook on `Bash` runs the after-the-command witness (section C).
  The kill-switch (`MINSPEC_GATE_OFF=1`) skips both hooks, and each skip writes one audit
  line (FR-15).

### B. Before the command - read the command text and deny on a clear match

- **FR-3** The extractor splits the command into simple commands with the same operator
  set as `host-write-guard.py` `SEGMENT_SPLIT` (`|| && ; & | \n $( backtick`). It
  recognises at least these write forms and takes their targets:
  - output redirections `>`, `>>`, `>|`, `&>`, `&>>`, `N>`, `N>>`, including a heredoc
    whose output is redirected (`cat <<EOF > FILE`);
  - `tee [-a] FILE...`;
  - `sed -i[SUFFIX]` / `sed --in-place[=SUFFIX]` and `perl -i[SUFFIX]`, taking every
    non-option argument after the script as a target;
  - `cp`, `mv`, `install`, `ln`, `rsync`, `dd of=` (the destination, including
    `-t DIR` / `--target-directory`);
  - `rm`, `unlink`, `truncate`, `touch`, `shred` (deletion and truncation are writes; the
    Edit tools cannot delete, but the shell can);
  - `git checkout [<tree-ish>] -- PATH...`, `git restore PATH...`, `git mv`, `git rm`,
    `git stash pop|apply` (target: unknown, so unresolved), and `git apply` / `git am` /
    `patch` (FR-5).
  A destination that is a directory is matched against every protected path under it.
- **FR-4** These segment kinds are **opaque**. Their writes cannot be read from the text,
  so they count as unresolved writes whatever their arguments are: `eval`, `source`/`.`,
  `bash|sh|zsh -c`, running a script file, `python*|node|ruby|perl -e|-c` (other than the
  `-i` forms in FR-3), `xargs`, `find ... -exec|-execdir|-delete`, `make`, and `npm|npx run`.
  The list sits in one table in the extractor so tests can enumerate it.
- **FR-5** For `git apply`, `git am` and `patch`, when the patch is a readable file named by
  a resolved path, the extractor reads its `+++ b/` and `--- a/` headers (and `rename to`)
  as targets. A patch on stdin, or one it cannot read, makes the segment unresolved. It
  reads at most 1 MiB of a patch and treats anything larger as unresolved.
- **FR-6** Resolution base. Relative targets resolve against the envelope `cwd`. A
  `cd`/`pushd` segment with a resolved literal argument moves the base for every later
  segment in the same command. A `cd` with an unresolved argument makes every later
  write-shaped segment unresolved. `git -C <path>` moves the base for that segment only.
  After normalising, a target that sits outside cwd (`../…`, or an absolute path not under
  cwd) is out of scope here and handled exactly as `spec-gate.py` handles it today. #1893
  owns that boundary, and this spec must not widen or narrow it.
- **FR-7** Decision. If any resolved target matches the protected set (case-insensitively,
  using the same `owned_match` as the Edit path), the gate **denies**. The deny reason
  states the matched path(s), each blocking spec and its verdict (`unapproved`/`stale`),
  and the existing approval instruction. It names the shell form that matched, so a
  wrongly matched argument can be diagnosed. Otherwise the gate passes through (no
  decision), never `allow`, so the normal Bash permission flow and the other Bash hooks
  decide as they do today.
- **FR-8** Fast path, and how a crash fails. A command with no write-shaped segment and no
  opaque segment passes through without scanning `specs/`. This keeps the corpus scan off
  the hot path. If the extractor raises, the error is never swallowed: the gate behaves as
  OQ-1 decides, and an audit line (FR-15) records the exception type. A parser bug must
  never be a silent pass.

### C. After the command - a witness that does not read the command

- **FR-9** When the protected set is non-empty and the command is not fast-pathed, the
  before-hook writes a snapshot of every protected path: whether it exists, its size,
  `mtime_ns` and SHA-256. The snapshot is keyed by the envelope's `tool_use_id` (or, if
  absent, by a hash of `session_id` plus command text) and stored under the repository's
  git directory (`$(git rev-parse --git-dir)/minspec-gate/`), never in a shared `/tmp`.
  That keeps it inside the opted-in project (constitution invariant 3) and away from other
  sessions. A path that does not exist is recorded as absent, so a creation is detected.
- **FR-10** The after-the-command hook loads the snapshot and recomputes the same values.
  If any protected path was created, deleted or changed in content, it emits a **visible**
  signal in the same turn. The signal names each changed path, its blocking spec(s) and
  verdict, and states that the change is in the working tree **unreviewed**. It tells the
  agent to revert it (giving `git checkout -- <path>` or deletion of the created file as
  the remedy). It also writes an audit line (FR-15). The hook does not change any file
  itself (see OQ-2).
- **FR-11** The witness compares content, not timestamps. If only `mtime_ns` differs but
  the SHA-256 is the same (`touch`, a no-op `sed -i`), that is not a change and is not
  reported.
- **FR-12** A missing witness is visible. If the snapshot cannot be found (the before-hook
  crashed, was skipped, or was removed), or the after-hook itself fails, it emits a visible
  warning that says the shell write check did not run for this command. It never says
  nothing (constitution invariant 2). The one exception is a snapshot that is missing
  because the before-hook fast-pathed the command (FR-8). The before-hook leaves a
  zero-cost "fast-pathed" marker, so the after-hook can tell that case from a missing one.
- **FR-13** Wording. Another process may change a protected file while the command runs.
  So the alert says the file "changed while this command ran". It does not say "this
  command wrote it".
- **FR-14** Each snapshot is removed after its after-hook reads it. Snapshots older than
  24 hours are swept on the next run, so the directory cannot grow without bound.

### D. Audit, honesty, scope

- **FR-15** Every Bash-arm event that is not a plain pass-through writes one line to the
  canonical `.minspec/gate-bypass.log` (the same file `spec-gate.sh` resolves). That means
  every deny, every unresolved write when the protected set is non-empty, every witness
  alert, every missing-witness warning, every extractor exception and every kill-switch
  skip. Each line has the UTC timestamp, cwd, tool `Bash`, the event kind, and the matched
  or changed paths. **It never records the command text.** Shell commands routinely carry
  tokens in env assignments (`GH_TOKEN=...`, see `host-write-guard.py`), and this log is a
  plain file. Writing the log can fail. That failure must itself surface in the hook's
  visible output, never as `|| true` alone.
- **FR-16** The `spec-gate.py` module docstring stops claiming the gate is "the only
  enforcement that survives bypass-permissions mode". It says instead what the gate
  covers: Edit/Write/MultiEdit by path; Bash by reading the command text (FR-3 to FR-5),
  with the after-the-command witness as a second check. It also lists what neither check
  stops, from Limitations below. The deny message for the Edit path is unchanged.
- **FR-17** Only this repo's own hooks change. Nothing in `packages/` changes, and no
  adopter-facing template changes. The gate is not productized (#37). When #37 ships it,
  the Bash coverage is part of what must ship with it (constitution invariant 3: nothing
  here alters behaviour outside this repository).

## Acceptance criteria

These tests use a temporary git repo fixture with one blocking T3 spec that declares
`implements: [src/owned.ts]` and an unrelated `src/free.ts`. They feed the hooks real
PreToolUse/PostToolUse envelopes on stdin, as `test_spec_gate.py` does. Each AC also runs
the post-witness with real shell execution between the before and after calls, not a
simulated file change.

- **AC-1** Deny on each FR-3 form aimed at `src/owned.ts`: `sed -i 's/a/b/' src/owned.ts`,
  `echo x > src/owned.ts`, `echo x >> ./src/owned.ts`, `printf x | tee -a src/owned.ts`,
  `cat <<EOF > src/owned.ts`, `cp /tmp/x src/owned.ts`, `mv x src/`, `rm src/owned.ts`,
  `truncate -s0 src/owned.ts`, `git checkout HEAD -- src/owned.ts`, `cd src && sed -i s/a/b/
  owned.ts`, `git -C src checkout -- owned.ts`, and `git apply p.diff` where `p.diff`
  touches `src/owned.ts`. Each deny reason names `src/owned.ts`, the spec id and the verdict.
- **AC-2** Case: `echo x > SRC/Owned.ts` is denied, as the Edit path's `owned_match` would
  deny it.
- **AC-3** The same forms aimed at `src/free.ts` pass through with no output. Read-only
  commands (`cat src/owned.ts`, `grep -n x src/owned.ts`, `git diff src/owned.ts`,
  `sed -n 1p src/owned.ts`) pass through. A mention inside a quoted argument
  (`git commit -m "fix > src/owned.ts"`, `echo "sed -i src/owned.ts"`) does **not** deny.
- **AC-4** Fast path: for a command with no write-shaped or opaque segment, the before-hook
  does not open any file under `specs/`. The test checks this by making `specs/` unreadable
  and confirming the command still passes through with no warning.
- **AC-5** Unresolved and opaque writes are not denied: `f=src/owned.ts; echo x > "$f"`,
  `eval "echo x > src/owned.ts"`, `python3 -c "open('src/owned.ts','w').write('x')"`,
  `bash -c 'echo x > src/owned.ts'`. For each, the after-hook then reports `src/owned.ts` as
  changed, naming the spec. An audit line is written for each, and none contains the
  command text.
- **AC-6** Creation: with `src/owned.ts` absent, `python3 -c "open('src/owned.ts','w')"` is
  reported as created. Deletion through an opaque form is reported as deleted.
- **AC-7** `touch src/owned.ts` (content unchanged) gives no witness alert (FR-11). The
  before-hook still denies it, because `touch` is an FR-3 form. That is consistent with the
  Edit path, which denies a no-op Write.
- **AC-8** Missing witness: with the snapshot deleted between the before and after calls,
  the after-hook prints the visible "did not run" warning. With the after-hook given an
  unparseable envelope, it prints a visible warning too, not silence. A fast-pathed command
  prints nothing.
- **AC-9** An extractor exception, forced through a test seam, writes an audit line with
  the exception type and behaves as OQ-1 decides. Its exit path never prints nothing at all.
- **AC-10** With no blocking spec in the fixture, every AC-1 command passes through, and no
  snapshot is written.
- **AC-11** With `MINSPEC_GATE_OFF=1`, both hooks pass through and each writes one
  kill-switch audit line with the event kind and no command text.
- **AC-12** `.claude/settings.json` has the PreToolUse `Bash` entry for the spec gate and
  the PostToolUse `Bash` entry for the witness. A test reads the file and checks both, so
  dropping one in a settings rewrite fails the test (sessions overwrite this file from
  stale copies).
- **AC-13** The `spec-gate.py` docstring no longer contains "the only enforcement that
  survives bypass-permissions mode", and it has a section listing the Limitations below.
- **AC-14** A mutation check: replacing the FR-7 deny with a pass-through fails at least
  one AC-1 case, and disabling the FR-10 comparison fails AC-5. This proves the tests are
  not vacuous.

## Invariants this change must not break

- **Constitution invariant 1 (offline).** Both hooks are local. They run no `git fetch`
  and make no network call.
- **Constitution invariant 2 (no silent gate).** Every path where the gate cannot decide
  ends in a visible message and an audit line (FR-8, FR-12, FR-15). The issue's own cost
  note, "a parser bug now fails toward allow", is answered by the second witness and the
  exception audit, not by accepting it.
- **Constitution invariant 3 (blast radius).** Snapshots live under the repo's git
  directory. The audit log is the existing canonical `.minspec/gate-bypass.log`. Nothing
  outside this repository changes (FR-17).
- **DR-047 section 3 (pairwise, never repo-wide).** No deny happens without a resolved
  target in a named blocking spec's owned set. Opaque and unresolved commands are never
  denied on that ground alone.
- **Doc-before-code, not doc-before-doc.** A spec's own docs and `.minspec/` approval
  writes stay writable from the shell exactly as from Edit, because neither is in any owned
  set.
- **Edit/Write/MultiEdit behaviour is unchanged.** Every existing `test_spec_gate.py` case
  passes unmodified.

## Limitations, stated plainly

Written down so no reader takes this control to be stronger than it is (the same reason
`host-write-guard.py` gives for its own docstring).

- **The before-check catches the honest path, not a determined evader.** Any FR-4 opaque
  form gets past it. The after-witness then reports the write. It does not prevent it.
- **The after-witness reports; it does not revert** (unless OQ-2 decides otherwise). The
  write stays in the working tree until someone reverts it. Nothing today stops it from
  being committed (OQ-4).
- **Background and detached writes are missed.** A command that starts a background
  process (`&`, `nohup`, `setsid`, a `run_in_background` Bash call) and writes after the
  after-hook has run is not seen by either check.
- **Concurrent writers are misattributed** (FR-13). In a shared checkout another session's
  edit can be reported against this command. The worktree-per-session norm (#168) keeps
  this rare, but it does not rule it out.
- **The approval store and the gate itself are not protected by this spec.** Approval
  writes to `.minspec/` are always allowed, by design, and so are edits to
  `scripts/hooks/spec-gate*` and `.claude/settings.json`, unless an unapproved spec owns
  them. An agent that rewrites the hook, or forges an approval sidecar, gets past this spec
  entirely. A deterministic check that approval records are real belongs to SPEC-069
  (approval-record witness) at the PR boundary.
- **The owned set is only as complete as the spec's declaration.** Any gap in
  `owned_file_set` (undeclared greenfield code; specs with no `phases:` block, #1543) is
  inherited unchanged.
- **The Python tests run in no CI** until #1158 lands. Until then the ACs are witnessed
  locally only. This must be said wherever this spec's tests are cited as proof.

## Decisions needed (Clarify)

### OQ-1 - What happens when the extractor itself crashes?

- **(a) (rec)** Pass through, and print a visible warning that the shell write check did
  not run, plus an audit line. The after-witness still runs, because the snapshot is
  written before parsing, so a crash cannot skip it. **Cost:** a write that only the
  before-check would have blocked lands, and is then reported rather than prevented.
- (b) Deny whenever the protected set is non-empty. **Cost:** any parser bug blocks every
  shell command while any spec is unapproved. That is the repo-wide freeze DR-047 section 3
  rejects, triggered by our own bug.

### OQ-2 - Should the after-witness restore a changed protected file?

- **(a) (rec)** Report only (FR-10), and tell the agent the exact revert command. **Cost:**
  the unreviewed change stays in the working tree until the agent or a human reverts it.
  An agent that ignores the alert can go on to commit it (see OQ-4).
- (b) Restore automatically from the snapshot. That needs the snapshot to hold full file
  content, not just a hash. **Cost:** if another writer (a human in the editor, another
  session) changed the file in the same window, their work is silently overwritten. That
  is a destructive act on unconfirmed attribution, and snapshots grow to the full size of
  the owned set on every shell call.

### OQ-3 - Do opaque segments (FR-4) also get a "this may write" note *before* running?

- **(a) (rec)** No. Stay silent before the command, and let the after-witness decide from
  the content. **Cost:** no warning beforehand, and the agent learns only after the write.
- (b) Yes. Add a non-blocking `permissionDecisionReason`-style note whenever an opaque
  segment runs while the protected set is non-empty. **Cost:** `npm run`, `make` and
  `bash script.sh` are everyday commands, so the note fires on most build and test calls.
  Agents learn to ignore it, which wears down the alerts that matter.

### OQ-4 - Is a commit-time owned-set check part of this spec?

The issue's second option. `.githooks/pre-commit` could refuse a commit that stages a file
in a blocking spec's owned set, reading paths from `git diff --cached --name-only`, with no
command parsing. That closes the "reported but committed anyway" gap OQ-2 (a) leaves.

- **(a) (rec)** Not in this spec. File it as its own issue, so it gets its own spec and its
  own `affects: [.githooks/pre-commit]` declaration. **Cost:** until it lands, an alert the
  agent ignores can still reach a commit. A human has to file the issue: this dispatch
  cannot.
- (b) Fold it in as section E. **Cost:** this spec then also owns `.githooks/pre-commit`,
  which other specs edit too. Approval waits on a second, unrelated design (how the commit
  hook resolves owned sets, and its bypass), and the scope this issue asked for grows.

### OQ-5 - Performance budget for the before-check on a non-fast-path Bash call

The corpus scan (`glob specs/**/*.md` plus a hash per T3/T4 spec) runs on every Edit today,
and would now also run on every write-shaped Bash call. No figure is measured yet.

- **(a) (rec)** Plan measures the p95 time of the existing Edit path on this repo and sets
  the Bash arm's budget at no more than that value plus 20%. If the measured value is too
  high, a later spec may cache the protected set per HEAD. **Cost:** the budget is unknown
  at approval time.
- (b) Fix an absolute budget now (for example 100 ms). **Cost:** it is a guess, not a
  measurement. If the existing scan is already slower, the spec cannot be met without a
  cache design no one has specified.

## Alternatives considered

- **Repo-wide Bash freeze while any spec is unapproved.** Rejected: DR-047 section 3.
- **Deny every unresolved write.** Rejected for the same reason. `npm run build` is
  unresolved.
- **A whole-string substring match, as the first version of `host-write-guard.py` did.**
  Rejected: that guard's own history (#1816) shows a mention inside an argument read as the
  act. FR-3 judges each segment, and AC-3 tests the quoted-mention case.
- **A filesystem watcher (inotify) instead of a snapshot.** Rejected: it needs a resident
  process, is Linux-only, and is not tied to a tool call. The snapshot runs only when a
  command does, and needs nothing installed.

## Depends on

- Nothing has to land first. #1158 (Python tests in CI) is needed before this spec's tests
  can witness anything in CI. It is not needed to build the spec.

## Traceability

- Triggered by #1911. Same failure shape as #1893 (gate fails open outside cwd).
- Gate lineage: DR-012 (hard-to-skip HITL gate), DR-031 (common-dir fallback, kill-switch
  audit), SPEC-022 (approval foundation), SPEC-038 (ownership declarations), DR-047
  section 3 (pairwise scoping).
- Text-reading precedent and stated limits: `scripts/hooks/host-write-guard.py` (#1816).
- Productization: #37. CI witness: #1158. Phases backfill: #1543.
