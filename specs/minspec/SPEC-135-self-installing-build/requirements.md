---
id: SPEC-135
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - one consent, then an unattended path from main into the editor
aspects: [build, provenance, install, consent, supply-chain, git-sync, drain, dogfood, host, no-silent-gate, blast-radius]
depends_on: [SPEC-060, SPEC-026, DR-065, DR-074]  # SPEC-060 owns the build stamp and, once its Amendment A is approved, the packed-path question; SPEC-026 the session records the witness sits beside; DR-065 the fast-forward this extends; DR-074 the blast-radius rule the host act is written under
relates_to: [SPEC-044, DR-051, DR-066, DR-004, DR-005, DR-086, DR-103, "#2203", "#2616", "#1678", "#1167", "#1354", "#1439", "#1952", "#1504", "#512", "#2613", "#2626", "#2628", "#2629", "#2632"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). All eight files
# are NEW and are needed under every answer to the open questions below: the witness
# writer, the one bash definition of the packed paths, the build step, the host act, the
# updater, and the three tests that pin them.
implements: [packages/minspec/src/lib/build-witness.ts, packages/minspec/tests/build-witness.test.ts, scripts/lib/packed-paths.sh, scripts/self-install/build.sh, scripts/self-install/setup.sh, scripts/self-install/update.sh, packages/minspec/tests/self-install-build.test.ts, packages/minspec/tests/self-install-update.test.ts]
# Modified, not owned. `extension.ts` gains the witness call and the status item,
# `drain-inbox.sh` (owned by SPEC-044) gains the build step and one skip, `.gitignore` one
# entry. `build-provenance.ts` is NOT listed: the amended count is SPEC-060's own code,
# changed under SPEC-060 Amendment A, and this spec only reads the list it exports.
affects: [packages/minspec/src/extension.ts, scripts/drain-inbox.sh, .gitignore]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-135: A new build installs itself and the checkout follows it - one setup act, then no rebuild chore and no stale-build warning to chase

## In plain terms

You run one setup command on your machine, once. A background service checks GitHub
every five minutes. When extension code changes on main, the drain builds it, the
service installs it in your editor, and only then moves your checkout forward. Each
window records its build for agents to read. Uncommitted approvals are never
stashed or overwritten: a pull that would change one waits and says why. Docs-only
commits stop raising the stale-build warning; that needs your re-approval of SPEC-060.
Cost: merged code reaches your editor in about half an hour, read by anyone or not.
Left out: restarting your window; new builds load at your next restart. Riskiest
assumption: installing under open windows is safe.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, checks the three questions under
> **[Open questions for the founder](#open-questions-for-the-founder-recommended-answers-recorded-by-an-agent-2026-10-09-ratified-only-by-approval-of-this-spec)**,
> and approves it through the normal spec-approval gate before any code changes. Every
> requirement below is written under each question's recommended answer, so approving the
> spec as it stands accepts those three answers and leaves no question open. This change
> also carries **Amendment A to SPEC-060** (build provenance stamp), which needs its own
> re-approval; see FR-18. Two decision records must also be amended before the parts that
> lean on them are built; approving this spec does not amend them. See
> **[Decision records](#decision-records)**.

Materializes **[#2203](https://github.com/AIClarityAU/minspec/issues/2203)** (no host-side
check for installed extension staleness) and
**[#2616](https://github.com/AIClarityAU/minspec/issues/2616)** (the stale-build warning
counts every commit). The diagnosis on #2203 offered four options. On 2026-10-09 the
founder chose its option (c), a one-time consented installer, in one word, "auto", and
added:

> another part of auto that i'd like to see is watching for new git changes and pulling
> them automatically.

Both were relayed verbatim to the session that wrote this spec, which recorded them, as
relayed, in the third comment on #2203. So the decision is made and is not reopened here.
This spec covers
exactly five parts: (1) the extension records its running build where it can be read from
outside the editor; (2) the drain builds when packed paths change; (3) a one-time host
installer; (4) the amendment that stops docs-only commits warning; (5) automatic pull,
coupled to the install.

**Id note.** `SPEC-135` is the highest claimed id plus one. Claimed ids were read on
2026-10-09 at 02:27 UTC across `origin/main` at `1bc9e484` (highest: 134), the changed
files of all 32 open pull requests (highest: 134, in #2622, the SPEC-134 approval), the
history of all 257 remote-tracking branches, 185 of them `origin/agent/issue-*`
(highest: 134), every local ref, and the worktrees on disk for an uncommitted draft
(none at 135 or above; the same search finds SPEC-134 in four, which is the control). No
gate checks spec ids across pull requests; #2055 (the id allocator is blind to unmerged
branches) tracks that. If the id collides at review time, renumber.

**Tier note.** Triage recorded T3 (full spec cycle) on #2203. Counted on mechanical
scope this is 8 new files and 3 modified ones, inside the 6-to-15 band the classifier
maps to T3 (`packages/minspec/src/lib/git-analyzer.ts:34-39`). It crosses the extension,
the dev-time scripts and the host, and it stays at T3 because tier follows scope, not
difficulty.

## One-Sentence Scope

Make "the editor runs the build that matches the checkout" a property the tooling keeps
true by itself: the extension says which build it runs, the drain builds when packed code
changes, a host service the founder sets up once installs each build and then
fast-forwards his checkout no further than the installed build covers, and every step
that fails says so in two places.

## Context - what the code does today (read from `origin/main` 1bc9e484, not inferred)

### Root cause, from #2203

**Root cause:** every actor that fast-forwards the dogfood checkout moves it past the
installed build without building or installing anything, and the only gate on the
resulting skew is an advisory toast inside the editor, because the extension records its
running build nowhere outside its own process, so no agent, hook or drain can see the
skew before a human does.

What produces the gap:

- **Movers that carry no build.** The diagnosis matched four fast-forwards of the primary
  checkout, to the second, to supervisor-authored queue commands ending in
  `git merge --ff-only origin/main` (table on #2203). None builds or installs.
- **Installs are a hand act.** The editor is fed by hand-installed `.vsix` files. The
  diagnosis measured 28 hours 34 minutes between one install being queued and run, and a
  built `0.1.27` package that was never installed.

What fails to catch it:

- **The running build is written nowhere.** `buildSha()`
  (`packages/minspec/src/lib/build-provenance.ts:35-41`) has two consumers: the status
  command (`packages/minspec/src/commands/status.ts:27`) and the toast
  (`packages/minspec/src/extension.ts:781`). Neither writes a file.
- **The toast is the only check, and it runs once.** It is evaluated per activation
  (`packages/minspec/src/extension.ts:756-759`), shows only the `stale` verdict (`:782`),
  and one click silences that build for good (`:784-791`).
- **The toast counts every commit.** `git rev-list --count <sha>..HEAD` with no path
  (`packages/minspec/src/lib/build-provenance.ts:141`). That is #2616, and FR-18.

### Where each piece runs (measured 2026-10-09 from the agent container)

- **The drain runs in the container.** A loop was live as
  `bash scripts/drain-inbox.sh --auto`. Its clean checkout of `origin/main` is
  `/tmp/minspec-drain-run` (`scripts/drain-inbox.sh:187`, created at `:723`, hard-synced at
  `:741`), which exists only inside the container, so a build left there is invisible to
  the host. That run directory borrows the primary checkout's `node_modules`
  (`:750-753`), which the script's own comment says can lag `origin/main`.
- **The editor runs on the host.** The container has no editor command line (none of
  `codium`, `code`, `code-insiders`, `cursor`), no per-user service manager it can reach
  (`systemctl --user` answers "Failed to connect to bus") and no `crontab`. The one live
  session record named process 986229; `kill -0 986229` in the container answers "No
  such process". The checkout is at the same path on both sides
  (`worktreeRoot: /home/jason/code/MinSpecPro` in that record).
- **The drain's loop is not always on.** It ends with the session that started it
  (`scripts/drain-inbox.sh:2333-2335`), has an 8-hour cap (`:94`), cycles every 20 minutes
  (`:194`), and a cycle the quota gate defers returns before any git work
  (`:1192-1196`, ahead of the run-dir refresh at `:1218` and the checkout sync at `:1227`).

### Why the existing fast-forward cannot do the pull

`sync_shared_checkouts` (`scripts/drain-inbox.sh:579-610`) is DR-065 (presence-gated
fast-forward) in code. It moves a checkout only when four guards hold. For the founder's
checkout two of them fail in normal use, the second for two separate reasons:

- **Content-clean (`:599`).** His approvals sit in that checkout uncommitted: an approval
  record under `.minspec/approvals/` and a frontmatter edit to the spec. On 2026-10-09 it
  held two (SPEC-075, validate corpus from config, and SPEC-134, specify just in time).
  They exist nowhere else until a pull request carries them.
- **Provably dormant (`:600`).** It is the checkout his editor is open in. #1678 (an
  in-use primary checkout never fast-forwards) records five hand syncs in one session for
  this reason.
- **And dormancy cannot be proven from where the drain runs.** From the container the
  editor's process cannot be seen, so the drain's predicate answers "occupied" for every
  checkout, including one no editor has open (measured through its `--checkout-occupied`
  seam; filed as #2626, the gated fast-forward cannot open from the container).

### What git itself guarantees (measured, git 2.43.0, throwaway repositories)

These four results are what part E is built on. Each was run, not read from documentation.

| Checkout state before `git merge --ff-only <target>` | Result |
|---|---|
| Modified and untracked files, none changed by the incoming commits | Moves. Every such file has the same sha256 afterwards. |
| A modified file, and an untracked file, that an incoming commit changes, bytes identical to the incoming version | Refuses, exit 1, `HEAD` unmoved, files untouched. Git does not compare content. |
| The same two files after `git add` of exactly those paths | Moves. Same bytes, same inode, same modification time: git never rewrote them. They end clean. |
| A modified file an incoming commit changes, bytes different, staged or not | Refuses, exit 1, `HEAD` unmoved, file untouched. |

So a plain fast-forward never needs a stash to be safe: it either leaves an uncommitted
file exactly as it was, or it does not move at all.

### What already exists and is reused

- **The build stamp.** `scripts/build-extension.sh` stamps the commit into the bundle
  (`:57`), marks a build from uncommitted work `-dirty` (`:29-31`) and refuses to emit an
  unstamped bundle (`:86`). SPEC-060 (build provenance stamp) owns it.
- **The packaging path.** `npm run package` (`packages/minspec/package.json:627`) runs the
  supply-chain check first (`:626`, DR-005, the pre-publish inventory gate).
- **An ignored directory every opted-in project already has.** `.minspec/sessions/`
  holds the presence heartbeat of SPEC-026 (session presence); it is ignored here
  (`.gitignore:68`) and in every scaffolded project
  (`packages/minspec/src/lib/scaffold.ts:293`). Both readers match only `*.session.json`
  (`packages/minspec/src/lib/presence.ts:224`, `scripts/drain-inbox.sh:542`).

## Terms

- **Packed path** - a path whose content reaches the packaged extension or decides how it
  is built. Defined once, in SPEC-060 Amendment A.
- **The checkout** - the one working copy named in the setup act. In practice the
  founder's primary checkout of this repository.
- **Built, installed, running** - three commits that can differ: the commit the newest
  published build was made from; the commit of the build the updater last installed; the
  commit of the build a given window is executing.
- **Covers** - an installed build covers a commit when no commit between the build's own
  commit and that commit changes a packed path.
- **The drop** - `.minspec/self-install/` in the checkout: ignored, readable from the
  container and the host, and the only place the two sides exchange files.
- **The updater** - the per-user background service the setup act registers on the host.
- **Witness** - the record a window writes naming the build it runs.

## How the parts fit

```
main moves, and a packed path changed
   |
   v
drain (container)   builds from a clean checkout of that commit,
   |                publishes the package and a build record into the drop
   v
updater (host)      checks the build, installs it with the editor's own command,
   |                writes the installed record
   v
updater (host)      fast-forwards the checkout, no further than the installed build covers,
   |                writes the state record on every pass
   v
extension (window)  writes its witness; shows the state; restarts nothing
```

| Record | Written by, and only by | Where |
|---|---|---|
| Witness, one per window | the extension | `.minspec/sessions/`, beside that window's heartbeat |
| Consent | the setup act | the drop |
| Build, and build failure | the build step | the drop |
| Installed, and install failure | the updater | the drop |
| State, every pass | the updater | the drop |

## Functional Requirements

### A. The running build is readable from outside the editor (part 1)

- **FR-1 - The witness.** In a workspace folder that carries `.minspec/`, each window
  MUST write one record naming the build it runs, exactly as `buildSha()` returns it
  (a `-dirty` suffix, `unknown` and `dev` included), the extension version, the time that
  extension host activated, and the session id of the same window's heartbeat. It is
  written on activation and removed on an orderly shutdown.

- **FR-2 - Where it is written, and where it is not.** The witness MUST live in
  `.minspec/sessions/`, under a file name neither presence reader matches, so it needs
  no new ignore rule in any project and cannot change either reader's verdict. In a
  folder without `.minspec/` nothing is written. `git status --porcelain` MUST read the
  same before and after. A failed write MUST NOT delay or fail activation; it surfaces
  at the reader, as FR-4's "unknown".

- **FR-3 - Alive or not.** A reader MUST count a witness only while the heartbeat with
  the same session id has been refreshed within SPEC-026's stale threshold, and MUST read
  anything older as "no window running". A reader that cannot see the editor's process,
  which is every reader in the container, judges by that refresh time alone.

- **FR-4 - Three answers, never collapsed.** A reader asking what runs in a checkout
  gets: the builds of the live windows (one each, and they may differ), "no window
  running", or "unknown" (a record that cannot be read, or a stamp of `unknown` or
  `dev`). No reader may turn the second or third into "current".

### B. The drain builds when packed code changes (part 2)

- **FR-5 - When.** On each cycle, if the drain's primary checkout carries the consent
  record (FR-10), the drain MUST build when no build record exists, or when a commit
  between the last built
  commit and the tip of the default branch changes a packed path. A docs-only advance
  builds nothing. At most one build per cycle, so a burst of merges is one build. The
  decision MUST NOT depend on which actor moved any checkout, or on whether one moved.
  Without the consent record the drain builds nothing, and one environment switch turns
  the build step off, like the switches the drain already has.

- **FR-6 - How.** A build MUST be made from a clean checkout of exactly the commit it is
  stamped with, outside the checkout, with dependencies installed from that commit's
  lockfile, through `npm run package` including its supply-chain check, with no flag that
  skips a step. A build stamped `-dirty` or `unknown` MUST NOT be published.

- **FR-7 - Publishing, and failing.** A successful build MUST be published into the drop
  as the package file plus one build record, the record written last and atomically,
  naming the full commit, the version, the file name, the file's sha256 and the build
  time in UTC. The three newest builds are kept. A failed build MUST leave the previous
  build record as it was, write a failure record (commit, time, exit code, where the log
  is), print a warning line in the drain log, and let the cycle's other work proceed.

- **FR-8 - Not behind the quota gate, and not the drain's alone.** The build spends no
  model quota and MUST run on a cycle the quota gate defers. The same build step MUST be
  runnable by hand from any session and produce the same records, so the drain is not
  the only producer of builds.

- **FR-9 - One packed-path definition per language.** The bash callers (the build step
  and the updater) MUST read the packed-path list from one sourced file. The extension
  reads the list SPEC-060 exports. A test MUST fail when the two lists differ. Both sides
  fail closed as SPEC-060 Amendment A requires: when the filtered query fails, or none of
  the listed paths exists, every commit counts as changing a packed path.

### C. One act on the host, then nothing further (part 3)

- **FR-10 - The act.** One command, run by the founder in his own terminal on the host,
  is the whole consent. It MUST print, before it changes anything, each thing it is about
  to do: which checkout, which editor command, which remote it will contact and how
  often, what it will change (the MinSpec extension in that editor, and that checkout's
  `HEAD`), where it registers itself, and the one command that removes it. It then
  proceeds with no further prompt. A dry run prints the same and changes nothing. It
  writes the consent record into the drop, naming what was consented to, when, and by
  which operating-system user, and registers one per-user background service. It never
  asks for elevated rights and never registers anything system-wide. Running it again
  replaces the earlier registration; it never adds a second. Whether a script may write
  that registration at all is for DR-074 to say (INV-3, #2632); if it may not, the act
  prints the registration and the founder installs it himself.

- **FR-11 - When the act refuses.** It MUST refuse, changing nothing and saying which
  check failed, when the folder has no `.minspec/`, when the folder is not this
  repository's source tree, when no editor command line is found, or when the host
  offers no per-user scheduler it can register with. It MUST NOT guess a substitute. The
  agent container has neither an editor command line nor a scheduler (Context), so the
  act refuses there: an agent session hands the founder the command and cannot run it.

- **FR-12 - What the service may do.** For the one checkout in its registration, and
  nothing else: fetch the default branch from that checkout's `origin`; install a
  published build into the one editor; fast-forward that checkout. No other repository,
  remote, extension or branch, and never a push. The checkout, the editor command and
  the remote address are fixed in the registration at setup. If the checkout's `origin`
  address no longer matches, or the consent record is gone, a pass does nothing and says
  why. Removing the consent record therefore stops the service from inside the container.

- **FR-13 - Checks before an install.** The updater MUST refuse a build, naming the first
  check that failed, unless: the build record parses; the file exists and its sha256
  matches the record; the package's own manifest names publisher `aiclarity` and name
  `minspec`; the stamped commit is on the default branch as the updater itself fetched
  it; the build is not older than the installed one; and the stamp is neither `-dirty`
  nor `unknown`.

- **FR-14 - Install, and record it.** The updater installs with the editor's own command
  line. On exit 0 it writes the installed record (commit, time, file sha256). On any other
  exit it writes an install-failure record with the command's output and leaves the
  installed record as it was. A failed install is tried again on a later pass, at most
  once per pass. One pass runs at a time.

- **FR-15 - No act per install.** No prompt, button, toast or confirmation may stand
  between a published build that passes FR-13 and its install.

- **FR-16 - Undo, and status.** One command MUST remove the service registration and the
  consent record; after it nothing fetches, installs or pulls. Another prints the current
  state record. Both are reachable from the keyboard alone.

- **FR-17 - A window that runs an older build says so, and restarts nothing.** When a
  window runs a build other than the installed one, the extension MUST show it in that
  window's status bar, with no toast and no modal, naming both builds and, in the
  tooltip, the editor command that loads the new one and how to reach it from the
  keyboard. It clears when they match. It MUST re-evaluate when the installed record
  changes, not only at activation. The extension MUST NOT restart or reload anything
  itself (OQ-1), reads only local files for this, and shows nothing in a workspace
  without the consent record.

### D. Docs-only commits do not warn (part 4)

- **FR-18 - The amended trigger.** SPEC-060's FR-3 and AC-4 are amended, in the same
  change as this spec, by **SPEC-060 Amendment A**: the stale-build warning fires only
  when a commit after the running build's stamp changes a packed path, and it counts
  only those. This spec does not restate that rule. It depends on it: FR-5's build
  trigger and FR-20's coupling ask the same question from the same list. Amendment A
  takes effect when the founder re-approves SPEC-060, and the code change it describes
  is made under SPEC-060, which owns `build-provenance.ts`.

### E. The checkout follows (part 5)

- **FR-19 - Watching.** Every pass, by default every five minutes, the updater fetches
  the default branch of the checkout's `origin`. A fetch never moves `HEAD` and never
  touches the working tree, so it runs whatever state the checkout is in.

- **FR-20 - Coupled to the install.** Within a pass the order is fixed: fetch, install a
  newer published build if there is one, then pull. The pull's target is the newest commit
  on the fetched default branch that the installed build covers, which is the tip when
  the installed build covers the tip. So docs-only commits flow at once, and a commit that
  needs a build holds the checkout just before it until that build is installed. Before
  the updater's first successful install there is no installed build, and nothing is
  pulled.

- **FR-21 - The only operation.** `git merge --ff-only` to that target. Nothing else may
  move `HEAD` or change a file in the working tree: no stash, no autostash, no rebase, no
  reset of `HEAD`, no checkout or restore of a working-tree path, no clean, no merge
  commit. The index may be changed for one purpose only, to mark a path whose bytes
  already equal the incoming version (FR-22, sixth row), and it MUST be put back as found
  if the fast-forward then does not happen.

- **FR-22 - What the checkout's state decides.** Each row is a named result in the state
  record. None discards, stashes or rewrites anything.

  | State of the checkout | What happens |
  |---|---|
  | `HEAD` is not the default branch: another branch, or detached | Fetch only. No move. |
  | Local commits: `HEAD` is ahead of, or has diverged from, the target | Fetch only. No move, no rebase, no reset. |
  | `HEAD` is already past what the installed build covers (something else moved it) | No move. Reported as ahead of the installed build. |
  | A merge, rebase, cherry-pick or bisect is in progress, or the index is locked | No move this pass. |
  | Dirty, and no modified or untracked path is changed by the incoming commits | Moves. Every such file is byte-identical afterwards. |
  | Dirty, and every such path the incoming commits change already holds the incoming bytes | Moves (OQ-2). Those files are never removed or rewritten and end clean. |
  | Dirty, and at least one such path holds different bytes | No move at all. The paths are named. The index and the working tree are left as found. |

- **FR-23 - One mover for this checkout.** `sync_shared_checkouts` MUST skip a checkout
  that carries the consent record; it still fetches. Every other checkout stays under
  DR-065 exactly as today.

- **FR-24 - The same pass on demand.** The updater's single pass MUST be runnable from a
  terminal, so a person or a queued command that wants the checkout current takes the
  coupled path. A person's own `git pull` is never blocked; if it leaves the checkout
  ahead of the installed build, FR-22's third row reports it and the next build closes it.

### F. Nothing fails quietly

- **FR-25 - A state record every pass.** The updater MUST write the state record at the
  end of every pass, including a pass that had nothing to do: the time, `HEAD`, the
  fetched tip, the built and installed commits, and one result each for fetch, install
  and pull, each from a closed list. A pass that ends early still writes it.

- **FR-26 - Two readers, and each process watches the other.** The extension shows the
  worst current condition in the status bar of the consented workspace and is quiet
  when everything is current. The drain prints the state once per cycle and warns when:
  the state record is older than three updater intervals (the updater has stopped); a
  published build has gone uninstalled for three updater intervals; or a window that
  activated after an install reports a different build (the install did not take). The
  updater reports the reverse: a commit that has waited for a build for more than three
  drain intervals (the drain has stopped, or the build is failing). No threshold is
  written in more than one place.

## Costly to Refactor

Ranked by what is hardest to undo.

1. **A service on the founder's machine.** Why costly: it is the one piece no agent
   session can install, observe or repair directly, and its registration sits on a
   surface DR-074 bounds. What to check: everything it acts on is fixed at setup (FR-12),
   one command removes it (FR-16), and #2632 is recorded before it is built.
2. **The record shapes in the drop.** Why costly: three processes on two sides of a
   container boundary read them. What to check: one writer per record, and the table
   under "How the parts fit" is the whole contract.
3. **The second fast-forward rule.** Why costly: DR-065 was written so that its exception
   would not be widened by example. What to check: the amendment in #2628 is recorded
   before part E is built.
4. **The packed-path list.** Why costly: the warning, the build trigger and the pull all
   read it. What to check: SPEC-060's AC-4d and FR-9's parity test.

## Acceptance Criteria

- [ ] Activating with stamp X in a folder that has `.minspec/` writes a witness naming X;
      in a folder without it nothing is written; `git status --porcelain` is unchanged in
      both; and both presence readers give the same verdict with the witness file present
      as without it. (FR-1, FR-2)
- [ ] Two windows on different builds are reported as two builds; a witness whose
      heartbeat is past the stale threshold reads "no window running"; a malformed one
      reads "unknown"; none of the three reads "current". (FR-3, FR-4)
- [ ] On a real git fixture (a bare origin, real commits): origin advanced by a commit
      under `packages/minspec/src/` produces a stamped build and a build record for the
      new tip; advanced by a docs-only commit, none. The result is the same with the
      clone moved by `git merge --ff-only`, moved by `git pull --tags --autostash -r`, and
      not moved. (FR-5)
- [ ] With no consent record the drain builds nothing, and `sync_shared_checkouts`
      behaves as it does today. (FR-5, FR-23, INV-3)
- [ ] A build stamped `-dirty` is not published, and the build never reads the primary
      checkout's `node_modules`. A failing build leaves the previous build record
      byte-identical, writes a failure record, prints a warning, and the rest of the
      cycle still runs. (FR-6, FR-7)
- [ ] A cycle the quota gate defers still builds; the build step run by hand writes the
      same records. (FR-8)
- [ ] Changing one list and not the other turns the parity test red; with the listed
      paths absent the build step builds and the updater holds. (FR-9)
- [ ] A dry run of the setup act changes nothing. A real run prints its plan before the
      first change and reads nothing from the terminal. It refuses by name in a folder
      without `.minspec/` and with no editor command line. (FR-10, FR-11)
- [ ] After the undo command a pass does nothing; with the consent record removed by
      hand a pass does nothing and says why; with `origin` pointed elsewhere a pass
      does nothing and says why. (FR-12, FR-16)
- [ ] Each of these is refused by name and the stub editor command records no call: a
      sha256 mismatch, another extension's package, a commit not on the default branch,
      a build older than the installed one, a `-dirty` stamp. (FR-13)
- [ ] A passing build is installed with no input; exit 0 writes the installed record; a
      non-zero exit writes a failure record and leaves the installed record unchanged.
      (FR-14, FR-15)
- [ ] With the tip three commits ahead as docs, packed, docs and nothing built: the
      checkout moves one commit and holds. After the tip's build installs it moves to
      the tip in the same pass. In no pass does `HEAD` rest on a commit the installed
      build does not cover. (FR-20, INV-4)
- [ ] Each row of FR-22's table is a fixture. In every row the sha256 of every modified
      and untracked file is the same before and after, and the remote-tracking ref has
      advanced, so the fetch ran. The identical-bytes row ends moved and clean with inode
      and modification time unchanged; the different-bytes row ends unmoved, the paths
      named and the index as found. (FR-19, FR-21, FR-22, INV-5)
- [ ] Run under a recording `git` across every row, the updater issues no stash, rebase,
      clean, working-tree checkout or restore, and no reset that names `HEAD`. The
      recording shows the fast-forward it is meant to allow, so the check cannot pass on
      a run that did nothing. (FR-21)
- [ ] The drain's sync skips the consented checkout and still fast-forwards a clean,
      dormant sibling. (FR-23)
- [ ] One pass run from a terminal writes the same state record as a scheduled pass on
      the same fixture. (FR-24)
- [ ] A pass with nothing to do writes the state record. A state record older than
      three intervals makes the drain warn; so does an uninstalled build; so does a
      window reporting another build after an install; and a commit left waiting for a
      build past the threshold is reported by the updater. (FR-25, FR-26)
- [ ] SPEC-060 Amendment A's criteria AC-4 to AC-4d pass, reading the same packed-path
      list FR-9 ties to the bash one. (FR-18)
- [ ] With a window on an older build the status item names both builds and no toast is
      shown; it clears when they match; nothing is shown without the consent record; the
      extension source added here imports no network module and calls no restart or
      reload command. (FR-17, INV-1)
- [ ] The packaged extension contains nothing under `scripts/`; no npm lifecycle script
      and no scaffolded template runs or names the setup act. (INV-3)

## Invariants (must not break)

- **INV-1 - No network call without consent (constitution invariant 1).** The extension
  makes none. The only network call this spec adds is the updater's fetch from one
  remote, and it does not exist until the founder has run the setup act, which states it.
  The drain's own fetch is unchanged.
- **INV-2 - No silent gate (constitution invariant 2).** A failed build, install or pull
  is a named, recorded result shown in two places. "Unknown" is never rendered as
  current. No record write is wrapped in a swallowed error. Builds have a second
  producer, and the drain and the updater each report when the other has stopped.
- **INV-3 - Blast radius (constitution invariant 3).** Nothing MinSpec ships performs the
  setup act: not the packaged extension, not a template, not an npm lifecycle script,
  not the drain. A person runs it, by hand, on the host. The act writes one thing outside
  the checkout, the service's registration; the service changes one thing outside it,
  the MinSpec extension in the one editor. DR-074 (blast radius is the project) puts
  machine-wide surfaces out of bounds for a per-project write (`docs/decisions/DR-074.md:122`)
  and requires anything that must live on one to carry its own scope check (`:127`):
  the registration names one checkout and every pass re-checks `.minspec/` and the
  consent record before acting. No adopter's project, and no other checkout on this
  machine, changes behaviour. DR-074 states that bound with no exception for an owner's
  own act, and the invariant's own test is a machine "that did not opt in". Whether an
  owner's explicit act on his own machine is inside the bound is for that record to say,
  not for this spec, and approving this spec does not say it. The registration is not
  built until DR-074 carries the answer: #2632. If the answer is no, the act writes only
  inside the checkout and prints the registration for the founder to install himself;
  one clause of FR-10 moves and nothing else does.
- **INV-4 - Never ahead.** No automatic mover leaves the checkout on a commit the
  installed build does not cover.
- **INV-5 - No uncommitted byte is lost, moved or rewritten.** There is no stash,
  autostash, rebase, clean, working-tree restore or reset of `HEAD` anywhere in this spec.
  A file changes only when git fast-forwards a path that was clean.
- **INV-6 - The rest of "never move a shared `HEAD`" stands.** Only a fast-forward, only
  on the default branch, only the consented checkout. Worktrees and every other checkout
  stay under DR-065.
- **INV-7 - A person's own git is never blocked.** Nothing here refuses, hooks or
  rewrites a command the founder runs himself.
- **INV-8 - One extension, forwards only.** The updater installs `aiclarity.minspec` and
  nothing else, from the drop and nowhere else, and never an older build over a newer one.
- **INV-9 - No nagging (constitution principle 4).** No toast per build, install or pull.
  The status item is the only surface, and it is quiet when everything is current.

## How this relates to DR-065: extend, not reuse and not supersede

- **Reuse fails.** The Context shows two of DR-065's four guards false for this checkout
  in normal use. Unchanged, the rule would fetch and never pull.
- **Supersede is wrong.** DR-065 remains the rule for every other checkout, and its fail
  direction (any doubt means fetch only) is kept here.
- **So this spec adds a second sanctioned case.** Same operation (`merge --ff-only` to
  the default branch). Same two structural guards: on the default branch, and a true
  fast-forward. Three differences, for the one checkout its owner named: his recorded
  consent stands in for proof of dormancy; git's own refusal to overwrite, with no stash,
  stands in for content-clean; and a guard DR-065 does not have is added, never past the
  installed build. `sync_shared_checkouts` changes in one way only: it skips that
  checkout (FR-23).

DR-065 calls its exception the sole one (`docs/decisions/DR-065.md:69`) and DR-051
(approvables on main) repeats it (`docs/decisions/DR-051.md:132`). Approving this spec
does not amend that record. The amendment is its own act and must be made before part E
is built. Tracked as #2628 (DR-065 needs an amendment for the consent-gated case). The
amendment to DR-065 proposed on
2026-08-30, which would discard byte-identical leftovers, is not used and not needed:
FR-22 reaches the same end without removing a file.

## Open questions for the founder (recommended answers recorded by an agent 2026-10-09; ratified only by approval of this spec)

Each question carries a **Recorded selection** line naming the option this document
recommends. An agent session wrote those lines; the founder has not chosen them. This
repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which an agent
proceeds on a stated recommendation and leaves the options it did not take on record
(DR-086, autonomy as a second axis). Approving a T3 spec is on that record's stop list
(`scripts/lib/autonomy.ts:68-71`), so nothing here stands in for the approval: the lines
propose, and approving this spec ratifies them.

### OQ-1 - When does a newly installed build start running?

An updated extension takes effect when the window's extensions restart; the editor's
release notes say so ("When an extension is updated, you can now restart extensions
instead of having to reload the window", VS Code 1.88). Not measured on the founder's
editor from here.

**Recorded selection: Option A,** at the next restart he does anyway.

- **Option A - shown, never forced (rec).** As FR-17 specifies. *Cost:* a window left
  open keeps running the older build, so the checks that live in the extension lag the
  checkout for as long as he does not restart. That is displayed, not prevented.
- **Option B - the extension restarts the window's extensions after each install.**
  *Cost:* it restarts every extension in that window, not only MinSpec. What that
  interrupts, including agent sessions hosted in the editor, is unmeasured, and it could
  happen once per drain cycle.
- **Option C - Option A, and Approve refuses while the window runs an older build.**
  *Cost:* each install becomes one forced restart before his next approval, and it
  changes the approve gate, which is outside the five parts decided.

Under B, FR-17's last sentence is reversed and a requirement on timing is added. Under C,
one requirement on the approve command is added.

### OQ-2 - One of your uncommitted approvals has since landed on main with the same bytes. Does it hold the pull?

**Recorded selection: Option A,** it does not.

- **Option A - identical copies pass, and nothing is removed (rec).** As FR-22's sixth
  row specifies. *Cost:* the judgement that the bytes are equal is made by the tool that
  then moves `HEAD`. Git re-checks it and refuses a wrong one (measured), so the worst
  outcome of an error is a held pull; but the step changes the index of a live checkout
  for an instant, and it rests on git behaviour measured on version 2.43.0 in the
  container, not on the host's git.
- **Option B - any incoming change to a dirty path holds the pull.** *Cost:* every
  approval of his that lands on main stops the automatic pull until someone clears the
  copy by hand, which is the chore this spec removes. The checkout held two such
  approvals on the day this was written.
- **Option C - discard the identical copy, then pull.** *Cost:* a delete performed by
  the tool that judged it safe. That is the DR-065 amendment of 2026-08-30, which is
  proposed and not accepted. Option A reaches the same end without it.

Under B, FR-22's sixth row merges into the seventh. Under C, that row changes and DR-065's
proposed amendment must be accepted first.

### OQ-3 - Which process watches GitHub and moves the checkout?

**Recorded selection: Option A,** the host service the setup act registers.

- **Option A - the host service (rec).** As FR-19 to FR-24 specify. *Cost:* the code that
  fetches and moves his checkout runs where no agent session can watch it; agents see
  only the records it writes. It is also a second process that can stop.
- **Option B - the drain, by extending `sync_shared_checkouts`; the host service only
  installs.** *Cost:* pulls happen only while a drain loop is alive, a stopped drain is
  silent because nothing else fetches, and the checkout would trail the install by up to
  one 20-minute cycle.
- **Option C - the extension, as an offer or a setting.** *Cost:* the extension would
  make a network call, which its offline core forbids (DR-004, tiered network consent),
  or it would need a key press per pull, which is the act this spec removes.

Under B, FR-19 to FR-22 and FR-24 move into the drain, FR-12 loses its fetch and its pull,
and INV-1 has no new network call to cover. C is not buildable under the constitution as
it stands.

## Host facts to measure before Plan settles the mechanism

None of these can be measured from the container. Each names what changes if the answer
is no. They are Plan-phase work in this spec, not separate issues.

1. **Which per-user scheduler the host offers, and whether a script may register with
   it.** If none, FR-11 refuses, and "one act, then nothing" is not deliverable there:
   return to Clarify.
2. **Whether the editor's install command replaces a build of the same version while a
   window runs it, and what that window then reads from disk.** The version is reused
   across builds (#1952, version reused across builds). If a running window can be left
   with old code and new files, each build needs its own version before this is switched
   on.
3. **Whether the editor's command line works from a background service** with no desktop
   session of its own.
4. **Whether a fetch succeeds from a background service** with the credentials the
   editor's own pulls use.
5. **Whether a window started after an install runs the new build with no further act.**
   Expected; the witness answers it on the first run.
6. **Whether the host's git gives the four results in the Context table.** FR-22's
   fixtures answer it when run there. If the third result differs, the sixth row of
   FR-22 falls back to the seventh, which is OQ-2's Option B.

## Decision records

Two existing records must be amended, each before the part that leans on it is built.
Approving this spec decides neither; each is its own act.

- **DR-065 needs an amendment** naming the consent-gated case, before part E (the pull)
  is built: #2628.
- **DR-074 needs to say whether an owner's own act on his own machine is inside its
  bound**, before part C's registration is built: #2632. This spec recommends that it
  is, under the conditions INV-3 lists, and that recommendation's cost is a second
  widening of the invariant beside the org-admin policy, marked by something weaker than
  `.minspec/` at a repository root.
- **Parts A, B and D need no record.** The witness, the build step and the narrower count
  write only inside the project, and each can be removed in under a day (one file write
  in the extension, one switch in the drain, one list). DR-103 (versions reach the
  Marketplace through a release workflow) is a different channel with a different
  audience and is unchanged.

## Risks

| # | Risk | What bounds it |
|---|---|---|
| R1 | **An unattended route into the founder's editor.** Anything that can write the drop can have code installed and run as him, and the updater is itself a script in that checkout. FR-13's checks stop mistakes, not an adversary: the record and the file are written by the same hand, and a signature would need a key the container holds, which is the same boundary. | It is not a new boundary. `core.hooksPath` resolves to the primary checkout's `.githooks` (measured), every agent session can write that checkout, and those hooks are expected to run as him whenever his editor commits (inferred from the shared git config; not observed on the host). What is new is that this route needs no act of his. FR-12 limits it to one extension from one folder; removing the consent record stops it. |
| R2 | **A bad merge reaches his editor within a cycle.** | The merge gate is the only review. FR-13 refuses anything not on the default branch. The way back is the undo command, then a hand install of an older package; while the service runs it only moves forward. |
| R3 | **The drain is the usual builder and is not always running.** | FR-8's hand path, and FR-26: the updater reports a commit that has waited too long. The checkout holds just before that commit; docs still flow up to it. |
| R4 | **The updater stops and nobody notices.** | FR-25 and FR-26: a stale state record is reported by the drain and shown in the status bar. |
| R5 | **A write by the editor lands between git's check and git's update of the same file.** Git has no lock a second program honours, so that write is lost. | It needs an incoming commit that changes that very file in that instant. The approval being written would be stale against the incoming text anyway. Not eliminated. |
| R6 | **A packed-path list that misses an input** makes the build trigger, the pull and the warning all wrong together. | SPEC-060's AC-4d, FR-9's parity test, and the fall-back to counting every commit. |
| R7 | **A second mover remains: the founder's own git, or a queued bare merge.** | FR-24 offers the coupled pass; FR-22's third row reports the result; #2629 retires the queued commands. |
| R8 | **The installed record says one thing and the editor runs another** (a hand install, or an install that exits 0 and does nothing). | FR-26: a window activated after the install is the second witness. |

## Out of Scope

- **Restarting or reloading the editor** (OQ-1).
- **Refusing Approve on an older running build** (OQ-1, Option C).
- **Giving each build its own version.** #1952 (version reused across builds); see the
  second host fact.
- **Publishing.** DR-103, and no Marketplace or Open VSX channel feeds this.
- **A second editor, checkout or repository on the same machine.** One registration
  names one of each. Anyone else who works on this repository may run the setup act on
  their own machine; nothing runs it for them. Adopters receive only the witness
  (FR-1 to FR-4).
- **Building on the host.** The drain builds; the host only installs.
- **The editor's own Sync button**, which pulls with autostash. It is the founder's own
  git (INV-7).
- **Clearing an uncommitted approval that differs from main.** FR-22 holds and names it;
  resolving it is a person's or its owning session's work.
- **The drain's inability to see the editor's process** (#2626), **the in-use primary
  never fast-forwarding** (#1678) and **the content-clean deadlock** (#1167). FR-23
  takes this one checkout out of their path; they stay open for every other checkout.
- **The unbuilt parts of SPEC-060**: the on-demand surface, the version-bump gate and
  the reviewer guidance (#1504).

## What this costs

- Code merged to `main` runs in the founder's editor with no act of his, typically
  within one drain cycle plus one updater pass. The installed build serves every project
  he opens in that editor, as it does today; from here on those projects get each merged
  build without him choosing the moment.
- There is a service on his machine that agents cannot repair. When it stops, the cost
  is a status-bar notice and a held checkout until he re-runs one command.
- A failing build holds the checkout just before the first commit that needs it, for as
  long as the build fails. Until the updater's first install, nothing is pulled at all.
- SPEC-060 needs a second sign-off, and until it has one the spec gate denies agent
  edits to the six files SPEC-060 declares (measured; see Amendment A).
- The installed build and the running build can differ for as long as a window stays
  open. This spec shows that; it does not close it.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Options (a), (b) and (d) of the diagnosis alone.** The witness alone still ends in a
  hand install; a rebuild tied to each mover is three producers and still a hand install;
  the narrower count alone leaves 9 of 19 commits warning. All three are parts of this
  spec; none is sufficient.
- **The extension installs its own updates.** Rejected: that code would ship to every
  adopter, and a program that can replace itself from a file in the workspace is a wider
  blast radius than a dev-time script in one repository.
- **Stash, pull, pop.** Rejected by instruction. The one autostash pull the diagnosis
  found restored an approval intact, which shows it can work, not that it is safe: the
  stash is shared by every worktree, and a pop that conflicts leaves the approval in a
  stash nobody is watching.
- **Pull first, install after.** Rejected: it is the order that produces the warning.
- **Hold the whole pull until the tip is covered.** Rejected: a steady run of packed
  merges would keep the checkout from ever moving. FR-20 moves as far as is covered.
- **A terminal loop the founder starts by hand each day.** Rejected: it is an act per
  day, and it stops when the terminal closes with nothing to say so.
- **Have a model decide whether a build or a pull is safe.** Rejected: every decision
  here is a comparison of commits, files and hashes.

## Test plan (for the Plan phase to place)

- **Invariant tests, written before implementation:** `self-install-update.test.ts`
  holds FR-22's table and FR-20's coupling as fixtures, shown red first;
  `build-witness.test.ts` holds FR-1 to FR-4.
- **Regression tests, red on `origin/main` first, on real git fixtures** (a bare origin,
  real commits, no stubbed refs): the three tests named on #2203, which are the build
  trigger across three movers, the witness in an opted-in and a not-opted-in folder, and
  the count (the last belongs to SPEC-060 Amendment A).
- **A stub editor command** that records its arguments and exits as told stands in for
  the editor, so every install path runs in CI.
- **Not vacuous:** each check of FR-13 and each row of FR-22 is removed one at a time and
  the suite is shown to turn red, with a clean control run. Fixtures vary the number of
  commits, of dirty files and of builds in the drop, not only the code.
- **Under CI's shape:** the tests run through `npx vitest run`, which is what CI runs
  (`.github/workflows/ci.yml:184`).

## Traceability

- **Issues:** [#2203](https://github.com/AIClarityAU/minspec/issues/2203) (the diagnosis
  and the four options in its second comment, the decision as relayed in its third) and
  [#2616](https://github.com/AIClarityAU/minspec/issues/2616) (the count).
- **Amended in the same change:**
  [SPEC-060](../SPEC-060-build-provenance-stamp/requirements.md) (build provenance
  stamp), Amendment A.
- **Follow-ups filed from this spec:** #2628 (DR-065 needs an amendment for the
  consent-gated case), #2632 (DR-074 must say whether an owner's own act is inside its
  bound), #2629 (retire the hand-queued fast-forwards once the updater is live), #2626
  (the gated fast-forward cannot open from the container; found while measuring,
  parked).
- **Neighbours, not duplicates:** #1678 (an in-use primary never fast-forwards), #1167
  (the content-clean deadlock), #1354 (an orphan approval record blocks the
  fast-forward), #1439 (a stale install disables shipped gates), #1952 (version reused
  across builds), #512 (staleness guard on approval), #2613 (proposed amendments are
  invisible to status readers).
- **Governing decisions:** [DR-065](../../../docs/decisions/DR-065.md) (presence-gated
  fast-forward), [DR-051](../../../docs/decisions/DR-051.md) (approvables on main),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius is the project),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-004](../../../docs/decisions/DR-004.md) (tiered network consent),
  [DR-005](../../../docs/decisions/DR-005.md) (pre-publish supply-chain gate),
  [DR-086](../../../docs/decisions/DR-086.md) (acting on a recommendation).
- **Specs this builds on:**
  [SPEC-026](../SPEC-026-session-presence/requirements.md) (session presence),
  [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  (coordinated sessions, which owns the drain script).
- **DR for this spec:** no new record. Two existing records need an amendment first; see
  "Decision records".
