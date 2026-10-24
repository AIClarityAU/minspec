---
id: SPEC-226
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the same credential-boundary domain as SPEC-213 (agent location) and SPEC-037 (approver identity)
aspects: [security, identity, credential-boundary, fail-closed, no-silent-gate, coverage, never-wrong]
relates_to: [DR-066, DR-008, DR-086, SPEC-213, "#2042", "#1816", "#2044"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# The check this spec changes is NOT in this repo: it is
# ~/.claude/scripts/identity-boundary-check.sh with its suite at
# ~/.claude/scripts/tests/identity-boundary-check.test.sh, both in the founder's host-side
# claude-config repository (the container's ~/.claude has no .git). Those paths cannot be
# listed in `implements:` or `affects:`, which name repo paths; they are named in the body.
implements: none
implements_reason: >-
  The credential check itself lives outside this repository (D-1). The only in-repo files
  this spec changes are the session banner and its test, which no spec owns and which other
  identity work (SPEC-213) also edits; owning them from this spec would freeze them for it.
affects: [scripts/hooks/session-identity.sh, packages/minspec/tests/session-identity.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-226: The identity check scans what the agent can reach, and says "not scanned" instead of "clean"

## In plain terms

`identity-boundary-check.sh` answers one question: can an agent session in the container
get a GitHub credential that acts as the founder? It decides by visiting a fixed list of
places where GitHub tools keep credentials. On 2026-09-22 a live founder OAuth token sat in
two files on no list: a repo's `.mcp.json` and its `.claude/settings.local.json`. Every
agent session could read both. The check passed, because it never looked there and said
nothing about places it skipped.

This spec makes three changes. The check scans the agent-harness config files by name. It
also does a broader scan, by content, of every directory mounted into the container. And
when there is a surface the check can reach but did not scan, it says so and fails, instead
of leaving that surface out of the report. The session banner names that case separately,
so a gap in coverage does not read as "the token broker is down".

Cost: the check becomes slower, because it reads the mounted code tree. The first run may
send many dead tokens to GitHub to be classified (D-3). The implementation lands in the
founder's host-side config repository, not here (D-1). The assumption most likely to be
wrong: that "every mount in `/proc/self/mountinfo`, plus every live harness working
directory" covers everything an agent can read. FR-4 and the Limitations section say where
that assumption stops.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. The founder
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves the spec
> through the normal approval gate before anything is built. Every requirement is written
> under the recommended answer to each decision.

Materializes **[#2042](https://github.com/AIClarityAU/minspec/issues/2042)**: *"identity-boundary-check
reports clean-by-omission for credential paths it has no entry for."* The issue proposes
(1) folding the agent-config scan into the check, and (2) reporting unscanned classes as
`UNKNOWN`. This spec does both. It adds a third part the issue points at but does not
propose: an independent witness that compares the check's coverage with the harness's reach,
which is the comparison whose absence let them drift apart ("nothing compared them").

**Id note.** `SPEC-226` is the highest claimed id plus one. Claimed ids were read on
2026-10-19 from every local and remote-tracking branch of this worktree's repository (450
remote refs, highest `SPEC-225`), from `origin/main` at `6df91ac4` (highest on disk:
`SPEC-211`), and from every worktree under `~/code/.worktrees/MinSpecPro/` and
`/tmp/minspec-agent/`. Open pull requests were not queried, because this dispatch makes no
network call. If the id collides at review time, renumber.

**Tier note.** Triage recorded T3 (full spec cycle). Mechanical scope: one script and its
test suite outside this repo, plus one hook and one test here. The change is to a security
gate, so this spec keeps the T3 ceremony and does not argue the tier down.

## One-Sentence Scope

Make `identity-boundary-check.sh` scan the agent-harness config layer and every mounted
agent-readable surface for GitHub credentials, and fail closed, naming the surface, whenever
a surface the agent can reach was not scanned.

## Context: what the code does today

Read from `~/.claude/scripts/identity-boundary-check.sh` (27140 bytes, mtime 2026-09-11) and
this repo at `origin/main` `6df91ac4`. Nothing here is inferred unless marked.

### Root cause

**Mechanism.** The check's credential-at-rest coverage is a list of path names. P3 reads
`.git-credentials`, `.config/git/credentials`, `.netrc`, `_netrc`, `$NETRC`,
`.config/gh/hosts.yml`, `$GH_CONFIG_DIR/hosts.yml` and `.config/hub` under each home
(`identity-boundary-check.sh:356-392`). Its one wider scan is `.env*` files under
`$HOME/code` to depth 4, plus nine shell rc files (`:394-401`). No entry matches `.mcp.json`,
`.claude/settings.json`, `.claude/settings.local.json` or `~/.claude.json`. A file that is
not on the list produces no output line at all.

**Missing gate.** The check already fails closed on sections that do not complete:
`SECTIONS=(location keyring gitconfig helpers stores env ssh)` (`:78`), and the verdict
raises `UNKNOWN` for any section missing from `COVER` (`:467-468`). But that gate asks
whether the check finished its own list. It never asks whether the list covers what the
agent can read. Nothing compares coverage with reach, so a surface added to the harness (or
a credential moved off a watched path, as the `gh` hardening did) is silently out of scope.
`PASS — … ($clean path(s) checked)` (`:474`) is a true statement about the listed paths, but
the banner reports it as a statement about the whole machine (`scripts/hooks/session-identity.sh:87`).

### Measured (2026-10-19, in the agent container)

- **Reach is larger than the list.** `/proc/self/mountinfo` has 31 mount points that are not
  under `/proc`, `/sys` or `/dev`. These include `/home/jason/code` (the whole code tree),
  `/home/jason/.claude`, `/etc/nixos`, `/tmp/runtime` and `/home/jason/.local/share/claude`.
  Agent worktrees live under `/tmp/minspec-agent/` (this one does), which is outside
  `$HOME/code`. P2a's repo discovery (`:268`) and P3's `.env*` scan (`:399`) never visit it.
- **The existing detector is itself a path list.** `.local/detect-agent-config-credentials.sh`
  in the primary checkout (2695 bytes) matches six file names under one root (default
  `$HOME/code`, `find -maxdepth 4`). From reading the file (not run): if the root does not
  exist, `find`'s error goes to `/dev/null`, the loop sees nothing, and the script prints
  `RESULT: clean`. That is the same clean-by-omission defect. Its pattern
  (`gho_|ghu_|ghp_|github_pat_` with `[A-Za-z0-9]` bodies) misses `ghs_`/`ghr_` and the
  new-format tokens with `.` and `-` that the main check's `TOKEN_RE` was widened for
  (`:32-36`, `:77`). The file's mode is `0777`, so any process could rewrite it. It is not
  fit to be the second witness. This spec folds in its *idea*, not the file.
- **The banner gives the wrong reason for this case.** `session-identity.sh:93-104` maps any
  `fail-closed` / `could not be verified` verdict to "an AVAILABILITY failure … Most commonly
  the token broker is down". Under FR-5, an unscanned surface would get that same text,
  which names the wrong cause.
- **Unmeasured:** how many distinct token-shaped GitHub candidates the FR-3 sweep will find
  (session transcripts under `~/.claude/projects/` are the likely bulk), and how long the
  sweep takes on the mounted code tree. Values were deliberately not read to measure this.
  Plan T0 measures both, by fingerprint count only (see Test plan).

## Functional Requirements

- **FR-1: Agent-config class, by name.** A new section `agentconfig` (added to `SECTIONS`)
  reads every harness config file the agent can load, from these locations:
  1. user scope: `~/.claude.json`, `~/.claude/settings.json`,
     `~/.claude/settings.local.json`, under each home in `HOMES` (`:341-344`);
  2. project scope: `<dir>/.mcp.json`, `<dir>/.claude/settings.json`,
     `<dir>/.claude/settings.local.json`, for every `<dir>` that is (a) a repo found by P2a,
     (b) a git worktree of such a repo (`git worktree list --porcelain`), or (c) the git
     top level of a live harness working directory (FR-4);
  3. managed scope: `/etc/claude-code/managed-settings.json` and `managed-mcp.json`.

  Each file that exists is read whole and every `TOKEN_RE` match goes through `record_all`.
  Values of the keys `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`,
  `GH_ENTERPRISE_TOKEN` and `GITHUB_PAT` also go through `record_all`, at any JSON depth,
  including inside an allow-rule string such as `Bash(GH_TOKEN=… gh …)`. If a file exists
  but cannot be read or parsed, that is `[UNKNOWN] <path>: exists but cannot be read`, the
  same as P3 (`:359`). Each file read with no candidate prints one `[clean]` line naming it.
- **FR-2: Report the risk factors without the value.** Each line FR-1 or FR-3 records also
  carries the file's mode and its git state (`tracked`, `ignored`, `untracked`, `no-repo`),
  which the detector printed. A `USER` finding in a file that git tracks says so first,
  because that copy may already be published.
- **FR-3: Content sweep over every reach root, the independent second witness.** A new
  section `sweep` greps every regular, non-binary file under every reach root (FR-4) for
  `TOKEN_RE` and the FR-1 key names, and records each distinct candidate with `record_all`.
  It does not depend on file names. A credential in a file whose name no section knows is
  still found, which closes the class #2042 describes without listing the next new file by
  hand. Rules:
  1. **GitHub-shaped only.** Only `TOKEN_RE` matches and values of GitHub-named keys are
     sent to GitHub. A generic token-shaped string from an arbitrary file is **never** sent:
     the sweep reads `~/.claude/.credentials.json` and other non-GitHub secrets, and the
     check's rule "never send a non-GitHub secret to GitHub" (`:47-48`) stays absolute.
  2. **Exclusions are declared, never silent.** Pruned subtrees (`node_modules`,
     `.git/objects`, the check's own `$TMPD`, `/proc`, `/sys`, `/dev`) form one reviewed list
     in the script. Each pruned subtree prints one `[NOT COVERED] <path>: <reason>` line.
  3. **Fail closed on incompleteness.** A sweep that times out, hits an unreadable directory
     inside a root, or exceeds the FR-7 candidate cap counts one `UNKNOWN` per root, naming
     the root and the reason. It never ends at a partial `clean`.
  4. **Name the drift.** A candidate found by the sweep in a file FR-1 or P3 does not cover
     by name prints a `[note] coverage drift: <path> holds a GitHub-shaped value no named
     section reads`. The value is still classified, so the verdict is correct either way.
- **FR-4: Reach roots come from the system, not from a list.** The sweep's roots are built
  each run from two witnesses, and neither is a list of credential file names:
  1. **Mounts.** Every mount point in `/proc/self/mountinfo` whose filesystem type is not a
     pseudo-filesystem (`proc`, `sysfs`, `cgroup`, `cgroup2`, `devpts`, `mqueue`, `devtmpfs`,
     `securityfs`, `debugfs`, `tracefs`, `bpf`, `pstore`, `configfs`, `fusectl`,
     `hugetlbfs`, `binfmt_misc`, `autofs`), and that is not the container's root overlay.
     A mount point that is a single file is scanned as that file. Unix sockets are skipped
     and counted as `[info]`.
  2. **Writable parts of the root overlay.** `$HOME`, each home in `HOMES`, and `/tmp`.
     These are not separate mounts in every container shape, but agents write to them.
  3. **Live harness directories.** The working directory (`/proc/<pid>/cwd`) of every
     same-uid process whose `comm` is `claude`, or whose `cmdline` runs the Claude Code
     entry point. If such a directory is not already under a root from 1 or 2, it is added
     as a root and a `[note] coverage drift: harness running in <dir>, outside the mounted
     roots` line is printed. If a `/proc/<pid>/cwd` cannot be read, that process is counted
     under the existing `[NOT COVERED]` rule for other-uid processes (`:422`).

  If `/proc/self/mountinfo` cannot be read, or yields no root, that is `UNKNOWN` and the run
  fails. "No mounts found" must never mean "nothing to scan".
- **FR-5: An unscanned surface is a distinct, failing result.** A new counter `unscanned`
  counts every reach root, and every FR-1 location, that the run did not finish scanning.
  Each one prints `[UNKNOWN] not scanned: <surface> (<reason>)`. When `unscanned > 0` and
  no `USER` was found, the verdict is
  `FAIL — <n> agent-reachable surface(s) not scanned (fail-closed)`, with exit `2`. Unscanned
  surfaces are kept separate from the existing count of probes that could not be verified,
  so a reader can tell "did not look" from "looked, and the producer did not answer". When
  both happen, the verdict names both counts. The `[NOT COVERED]` lines from FR-3 rule 2 do
  not increment `unscanned`: they are declared, reviewed exclusions, as the other-uid
  `/proc` rule already is.
- **FR-6: The banner names the coverage case.** In `scripts/hooks/session-identity.sh`, a
  verdict that contains `not scanned` is matched **before** the existing
  `fail-closed` / `could not be verified` case (`:93`). It prints a distinct line: the check
  did not scan some agent-reachable surface, so a credential there would not be seen; the
  first `not scanned:` line from the record; and the command to run to see them all. It
  never says the token broker is down. The existing availability and `USER` banners do not
  change.
- **FR-7: Classification volume is bounded and visible.** The sweep can find many more
  candidates than the current probes. So:
  1. classification is de-duplicated by fingerprint across all sections in one run
     (`SEEN`, `:117`; today `DEAD` results are not cached, `:139`, so each repeat of a dead
     token costs a second request);
  2. under D-3's recommendation, a token GitHub rejected twice with `401` is remembered as
     dead across runs. The entry is its 16-hex-character sha256 prefix only, in a file
     under the check's mode-`0700` state directory, and a later run skips it;
  3. a per-run cap on new classifications (the value is set in Plan from the T0
     measurement). Candidates past the cap are not dropped: each one is `UNKNOWN`, so going
     over the cap fails the run visibly and names the count.
- **FR-8: No values, ever, and no writes outside the check's state.** Every new line goes
  through `redact()` (`:99-103`). Values appear only as `fp()` fingerprints (`:106`). The
  check never edits, moves or re-modes a file it finds. Fixing a finding is the founder's
  act, as the revocation on 2026-09-22 was.

## Costly to Refactor

1. **The verdict wording is a contract.** The banner (FR-6) and its test match on the
   verdict text. Changing `not scanned` later means changing both together. Check: the
   phrase is defined once in the check and pinned by one banner test case.
2. **The dead-fingerprint cache persists across runs (FR-7.2).** If its format changes,
   the old cache has to be discarded, which costs one slower run. That is low cost, because
   the cache is only an optimisation and never a reason to pass.

Everything else can be reverted in one commit to each repository.

## Acceptance Criteria

All cases run in `identity-boundary-check.test.sh`'s hermetic sandbox (temp `HOME`, stub
`curl`/`gh`/`ssh`, fake tokens assembled at runtime), except the banner cases, which run in
`session-identity.test.ts` here.

- [ ] **The incident, reproduced.** A sandbox with a user-class fake token at
      `$H/code/repo/.mcp.json` `mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN` exits
      `1`, and a `[USER]` line names that path. Another case plants the token inline in a
      `permissions.allow` entry of `$H/code/repo/.claude/settings.local.json`, with the
      same result. (FR-1)
- [ ] **Found by content, not name.** A user-class fake token in `$H/code/repo/notes/odd-name.cfg`
      exits `1`, and a `coverage drift` note names the file. (FR-3)
- [ ] **Worktree outside `$HOME/code`.** A user-class fake token in `.claude/settings.local.json`
      of a worktree under a sandbox `/tmp`-equivalent root exits `1`. (FR-1 2b, FR-4 2)
- [ ] **Unscanned fails closed.** If a root is made unreadable (mode `000`), or the sweep is
      forced to time out, the run exits `2`. The verdict contains `not scanned`, and an
      `[UNKNOWN] not scanned:` line names the root. Under the same conditions on the
      unchanged script, the run exits `0` (shown in the PR as the red baseline). (FR-5)
- [ ] **No mountinfo, no pass.** With `/proc/self/mountinfo` unreadable to the check (the
      check reads the file through a path variable that the test points at an unreadable
      file, because it cannot override the real one), the run exits `2`. (FR-4)
- [ ] **Never sends a non-GitHub secret.** A sandbox file holding a 40-character generic
      token-shaped string, with no GitHub prefix and no GitHub key name, produces no stub
      `curl` call carrying that string. The stub records every bearer it receives. (FR-3 1)
- [ ] **Can still pass.** An empty sandbox exits `0`, and the verdict says `PASS`. A dead
      fake token in `.mcp.json` also exits `0` and prints a `[note]` naming the file (D-2
      rec). (INV-4)
- [ ] **Cap is visible.** Plant cap+1 distinct unknown-to-stub fake tokens with the cache
      empty. The run exits `2`, names the count over the cap, and the stub saw at most the
      cap's number of new `/user` calls. (FR-7.3)
- [ ] **Dead cache works and cannot clear a live token.** On a second run over the same
      dead fakes, the stub sees zero `/user` calls for them. A user-class fake whose
      fingerprint was planted in the cache by hand is still classified, and the run exits
      `1`. (FR-7.2, INV-1)
- [ ] **No values in output.** Every new case asserts that no fake token value appears in
      stdout, stderr or the cache file. The suite's existing assertion is extended to the
      cache file. (FR-8)
- [ ] **Banner names the coverage case.** In `session-identity.test.ts`, a stub verdict
      `FAIL — 1 agent-reachable surface(s) not scanned (fail-closed)` with a record line
      `[UNKNOWN] not scanned: /tmp/x (timeout)` prints that path. The output does not
      contain `token broker`. The existing availability-failure case still prints its
      current text. (FR-6)
- [ ] **Suites green.** `identity-boundary-check.test.sh` passes in the container with zero
      stderr output (its existing rule). `npx vitest run packages/minspec/tests/session-identity.test.ts`
      and `npm run lint` pass here.

## Invariants (must not break)

- **INV-1: No silent gate (constitution invariant 2, DR-066).** Every surface the check can
  reach ends in exactly one of three states: `USER`, `clean` (scanned, nothing live), or
  `UNKNOWN`. A declared `[NOT COVERED]` exclusion is the only fourth outcome, and it is
  printed. No cache, cap or exclusion may turn a missing signal into `clean`. The
  dead-fingerprint cache can only skip a token that already got a confirmed double `401`;
  it can never mark one live or clean on its own.
- **INV-2: No values, ever.** The existing rule (`:49-50`) is unchanged and covers every
  new line and the cache file.
- **INV-3: Never send a non-GitHub secret to GitHub** (`:47-48`). The sweep reads files
  that hold other services' credentials; FR-3 rule 1 is the requirement that protects them.
- **INV-4: The check can still pass.** The check's own design rejected any rule under
  which it "could never pass and would be ignored" (`:42-43`). An empty or clean system
  must still exit `0`.
- **INV-5: Exit codes and the verdict-line format stay compatible.** `0` / `1` / `2`, one
  `IDENTITY-BOUNDARY [<location>]: <verdict>` line, and `--location` unchanged.
  `session-identity.sh` and SPEC-213 depend on all three.
- **INV-6: Read-only (constitution invariant 3).** The check writes only its own state
  directory. Nothing is shipped to adopters. This is the founder's dev tooling, and no
  adopter's repo or machine is touched.
- **INV-7: No new network endpoint (constitution invariant 1).** The check already calls
  `api.github.com/user`, only for the founder's own diagnosis. This spec adds calls to that
  same endpoint and no other. MinSpec's product core is unaffected.

## Decisions needed (Clarify)

### D-1: Where does the check's source of truth live?

- **(a) Leave the check in the host-side claude-config repository, next to its test suite
  (rec).** The check polices agents, and keeping it out of a repo that agents open pull
  requests against means an agent cannot weaken its own guard through an auto-merged
  change. Cost: the change gets no CI run and no ai-review vote. Its only review is the
  founder's, and the suite runs by hand inside the container. Implementation needs a host
  session, because the container's `~/.claude` has no `.git`.
- (b) Move the check and its suite into this repo (for example `scripts/identity/`), with
  `~/.claude/scripts` pointing at it. Cost: agents can propose edits to their own boundary
  check. `scripts/` is not machinery-gated, so a weakening edit could merge without a human,
  unless a new path rule is added. Benefit: CI and ai-review on every change.

### D-2: Is a dead token at rest a finding?

- **(a) No. It is `clean` for the verdict, and a `[note]` names the file (rec).** The
  property is "can an agent obtain a live user credential", and a token GitHub rejects
  cannot act. Cost: a revoked token left in a mode-`644` file never turns the banner red.
  Once the token is confirmed dead, removing it relies on the founder reading the note.
- (b) Yes. Any GitHub-shaped value in an agent-readable file fails the run. Cost: every
  expired bot (`ghs_`) token echoed into a session transcript would fail the check for
  good, so the check could never pass in practice. INV-4 forbids that.

### D-3: Session transcripts, and how many requests the sweep sends to GitHub

The sweep's roots include `~/.claude/projects/`, where every token ever printed in a session
is kept. The candidate count there is unmeasured (see Measured).

- **(a) Sweep them, with the cross-run dead-fingerprint cache and a per-run cap that fails
  visibly (FR-7) (rec).** Transcripts are agent-readable, and the 2026-09-22 token was
  pasted into a command, so it is likely in a transcript too (inferred, not checked). Cost:
  the first runs may send many requests to GitHub's `/user` endpoint with dead tokens. Until
  the cache warms, the cap may fail the check (exit `2`) for several runs. Whether GitHub
  rate-limits or flags repeated bad-credential requests from one address enough to affect
  the bot's own token broker on that address is unknown and has not been checked.
- (b) Declare `~/.claude/projects/` as `[NOT COVERED]`. Cost: the biggest store of pasted
  secrets in the container is permanently out of scope, which is the very gap this issue
  is about, now declared instead of silent.

Plan T0's measurement (distinct-candidate count) decides the cap. If the count is so large
that (a) cannot reach `PASS` within a few runs, Plan returns here instead of picking a
cap that never holds.

## Clarify selections (recorded by an agent 2026-10-19; ratified only by approval of this spec)

- **A coverage-drift note does not fail the run (FR-3.4, FR-4.3).** The value was still
  classified, so the verdict is correct either way. Making drift fail would turn every
  `claude` started in a new directory into a red banner, and a banner that is often red is
  ignored. Rejected: drift as `UNKNOWN`.
- **The `.local` detector is retired, not wired in as the second witness.** It is a path
  list with the same omission defect, a narrower pattern, and mode `0777` (Measured). FR-3
  is the second witness instead.

## Limitations, stated plainly

- **Reach is defined as "mounted or writable here, or a live harness directory".** A
  surface that is none of these, and that the agent can still read, is not covered.
  Examples: a network share the agent reaches through a tool, or another uid's files made
  world-readable inside the root overlay outside `$HOME` and `/tmp`. The pseudo-filesystem
  list in FR-4 is itself a list. A new filesystem type that holds files and is wrongly
  added to it would be skipped. The test pins the list.
- **Committed history is not swept.** `.git/objects` is excluded (FR-3.2). A token committed
  and then deleted from a repo is the job of gitleaks and history scanning, not of this
  check.
- **Only GitHub-shaped values are classified.** A founder credential with no GitHub prefix,
  stored under a key name not on FR-1's list, is invisible (INV-3 is the reason).
- **The check reports a point-in-time state.** It runs every 30 minutes in the background
  (`session-identity.sh:36`), so a token written and read between two runs is not seen.

## Why no new DR

D-1 is the only choice that is costly to undo. Moving the check back across repositories
is still a one-day job, so it is under the ADR filter (a DR only for a choice that takes more than a day to undo). The decision and the alternatives
not taken are recorded here and on #2042. DR-066 (no silent gate) is the rule this spec
applies. It does not change DR-066.

## Out of Scope

- **Replacing the file copies with an environment indirection so the MCP server keeps
  working.** #2042 names this as separate.
- **Stopping the harness from recording a secret inside a `permissions.allow` rule.**
  This is prevention, not detection. *Unfiled follow-up: needs an issue number before
  approval (see Traceability).*
- **Non-GitHub secrets in agent config** (other MCP servers' API keys). The check's
  property is GitHub user identity. *Unfiled follow-up, as above.*
- **The location witness.** SPEC-213.

## Alternatives considered and rejected

- **Add the two missing file names to P3 and stop there.** This fixes the instance and
  leaves the property broken: the next file the harness gains is clean by omission again.
  This is the defect class itself.
- **Ship the `.local` detector as-is beside the check.** It has the same omission defect
  (Measured).
- **Derive roots only from live harness working directories.** A worktree whose session
  has ended still holds its `settings.local.json`, and the next session reads it. Mounts
  cover the files at rest, and live directories cover where sessions run now.
- **Scan everything for any token-shaped string and classify all of them.** This would send
  non-GitHub secrets to GitHub (INV-3).

## Test plan (for the Plan phase to place)

- **T0, before any change (in the container, against the unchanged script):** (1) measure
  the sweep's wall time over the FR-4 roots and the number of distinct GitHub-shaped
  candidates, recorded as a count and a fingerprint list only. No value is printed, and
  none is sent to GitHub. (2) Write the "Unscanned fails closed", "Found by content" and
  "Worktree outside `$HOME/code`" cases, and show them red on the unchanged script. The
  "Can still pass" case must be green on the unchanged script.
- **T1:** FR-1 to FR-8, case by case. Each case is red first, then green.
- **Not vacuous:** every fail-closed case has a control run that passes. The non-GitHub-secret
  case checks the stub's recorded bearers, not the exit code alone.

## Traceability

- **Issue:** [#2042](https://github.com/AIClarityAU/minspec/issues/2042).
- **Origin of the check:** #1816 (founder identity reported "closed" six times); the
  banner's availability-versus-finding split is #2044.
- **Rule applied:** [DR-066](../../../docs/decisions/DR-066.md) (no silent gate; constitution
  invariant 2). Isolation context: [DR-008](../../../docs/decisions/DR-008.md).
- **Sibling spec:** SPEC-213 (an agent not provably in the container cannot act as the
  founder), in flight on `cos/spec-1816-1018`; it edits the same banner and relies on INV-5.
- **Follow-ups:** two items under Out of Scope are **unfiled**, because this dispatch makes
  no network call. Each needs an issue number, or a dated `docs/backlog.md` line under
  DR-023, before this spec is approved.
- **DR for this spec:** none; see "Why no new DR".
