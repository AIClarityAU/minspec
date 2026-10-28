---
id: SPEC-265
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a stale upstream copy is a supply-chain signpost that lies
aspects: [dev-harness, hooks, reference-clones, vendored-packs, no-silent-gate, offline]
depends_on: []
relates_to: ["#2846", "#2705", "#230", "#231", "#232"]
implements: none
implements_reason: >-
  Specify phase only. The files this spec will own (a hook script under scripts/hooks/, a
  registry file, a settings.json entry, a scheduled lag check) are fixed at Plan, after the
  Clarify decisions D1-D5 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-265: Reference clones are refreshed before an agent relies on them - a gate, not a remembered rule

> **This is a SPECIFICATION ONLY.** Written for issue #2846 (refresh reference repos before
> use). Nothing is built until a human reads it, answers
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. No decision record
> is created: every choice here is a hook and a config file, undone in well under a day
> (the "cannot be undone in under a day" decision-record filter).

## In plain terms

Agents read third-party repositories kept on disk only as references (for example
`~/code/agency-agents`, `~/code/gguf-parser-go`, the pstack upstream). Nothing refreshes those
clones, so an agent can build a claim on a copy that is months old. The founder had to ask for
a freshness check himself (2026-10-17: "there's no reason i should have to ask you to update
your dependencies or reference repos like pstack"). Today the only protection is a feedback
memory (`f-pull-reference-repos`) - a rule the model must remember, which is exactly the kind
of rule that drifts (learned rule `f-enfo-dont`).

This spec has two halves:

1. **Reference clones** - a pre-tool hook fast-forwards a registered reference clone before an
   agent reads from it, if it has not been fetched recently.
2. **Vendored / copied packs** - a scheduled check reports how far a vendored copy lags its
   upstream, and files an issue once the lag crosses a threshold.

## Measured state (this base, `bd2d754f`)

Read at this base, not inferred:

- `.claude/settings.json` registers PreToolUse hooks only for `Edit|Write|MultiEdit`
  (`spec-gate.sh`, `marker-guard.mjs`) and `Bash` (`host-write-guard.py`). No hook matches
  `Read`, `Grep` or `Glob`, and none refreshes anything.
- `scripts/hooks/host-write-guard.py` is the existing pattern for a Bash-text PreToolUse hook,
  including a written statement of what a command-text heuristic can and cannot catch.
- The only vendored pack in this repo with a pin is `scripts/roles/vendor/` (agency-agents),
  pinned by `scripts/roles/vendor/agency-agents.lock.json` (`pinnedCommit`, `pinnedAt
  2026-07-05`) and refreshed only by hand via `scripts/sync-agency-agents.sh` - a reviewed bump,
  never automatic (#231 decision, `scripts/roles/vendor/README.md`).
- **No pstack prompt pack exists in this repo at this base.** `git grep -i -E "pstack|cursor/plugins"`
  matches only `docs/decisions/DR-003.md:178-185` (URLs cited as prior art). The "pstack pack
  inside MinSpec, 364 commits behind" from the issue therefore lives somewhere else (another
  repo or the founder's harness) - not verified here.
- #2705 (the upstream watch) is not referenced anywhere in this repo's text, and this dispatch
  has no network access to read it. Whether it already covers half 2 is **unverified** - see D1.
- Reference clones present on this machine: `~/code/agency-agents`, `~/code/gguf-parser-go`
  (directory listing). There is no list of them anywhere; "which clones are references" exists
  only in the memory file's prose.

## Root cause (mechanism)

There is no mechanism between "an agent decides to read a reference clone" and "the clone is
current". Freshness depends entirely on the model remembering a prose rule, and there is no
registry that says which directories are references, so even a willing tool cannot tell a
reference clone from a working repository. The missing gate is a registry plus an enforcing
hook; the missing witness for vendored copies is any recorded comparison against upstream.

## Scope

**In:** the dev-time Claude Code harness of this monorepo (`.claude/settings.json`,
`scripts/hooks/`, a committed registry) and a scheduled lag check for vendored packs.

**Out:**
- The shipped VS Code extension. MinSpec itself makes no network call (constitution invariant
  1, DR-015 / DR-004 Tier 0); nothing here ships in a `.vsix`.
- Auto-updating a vendored copy. Refreshing `scripts/roles/vendor/` stays a reviewed bump
  (#231); this spec only *reports* lag.
- Any repository the founder works in (a "primary"). Those are never touched by this hook.
- Package dependency updates (`npm` etc.) - the founder's quote mentions "dependencies", but
  that is a separate surface with its own tooling; parked unless D5 says otherwise.

## Functional requirements

### Half 1 - reference clones

- **FR-1 Registry.** A committed registry lists every reference clone: its path (with `~`
  expansion), the upstream remote name, the default branch, and an optional per-entry max age.
  A directory not in the registry is never fetched or modified by this feature. Registering an
  entry is the explicit consent for the network call (invariant 1) and the opt-in for writing
  to that clone (invariant 3).
- **FR-2 Trigger.** A PreToolUse hook runs on `Read`, `Grep`, `Glob` and `Bash`. For
  `Read`/`Grep`/`Glob` it takes the target from the tool's path argument; for `Bash` it scans
  the command text for any path inside a registered clone (`cd <clone>`, `git -C <clone>`,
  file arguments). It resolves symlinks and `..` before comparing.
- **FR-3 Staleness test.** The clone is stale when its last fetch (mtime of
  `.git/FETCH_HEAD`, or "never" if absent) is older than the max age (default N hours - D2). A
  fresh clone is passed through with no network call and no output.
- **FR-4 Refresh.** A stale clone is refreshed with `git fetch <remote>` then
  `git merge --ff-only <remote>/<default-branch>` (equivalent to `pull --ff-only`) ONLY when
  all of these hold: working tree clean (no staged, unstaged or untracked-but-not-ignored
  changes), `HEAD` on the registered default branch, no `.minspec/` directory at the clone root,
  and no rebase/merge in progress. It never resets, stashes, rebases, forces, or switches
  branch.
- **FR-5 Bounded.** The refresh runs under a hard timeout (default 20 s) so a hung network
  never hangs the tool call. Git runs with `GIT_TERMINAL_PROMPT=0` so it can never wait on a
  credential prompt.
- **FR-6 Concurrency.** Many sessions share one machine (`p-conc-sess`). The refresh takes a
  per-clone lock (non-blocking `flock` on a file under the clone's `.git/`); a session that
  finds the lock held waits up to the timeout for the holder, then re-runs FR-3 rather than
  fetching again.
- **FR-7 Visible outcome, never silent.** Every non-fresh outcome is reported to the agent in
  the hook's output, naming the clone and what happened:
  - refreshed: `old..new` SHAs and commit count;
  - skipped by FR-4: which precondition failed, plus the clone's age since last fetch;
  - fetch failed or timed out: the git error text, plus the age since last fetch.
  Whether a failed or skipped refresh **denies** the read or **allows it with the warning** is
  D3.
- **FR-8 Fail closed on a broken hook.** If the hook itself cannot run (registry unreadable or
  malformed, script error), it says so in its output naming the cause; it does not exit 0
  silently (invariant 2). A malformed registry is a hard deny for paths it might cover only if
  D3 picks "deny"; otherwise it is a visible warning on every matched call.
- **FR-9 Stated limits.** The hook's module docstring states, as `host-write-guard.py` does,
  what the Bash-text match cannot see (a path built at runtime, a script that reads the clone
  internally). The hook is a guard for the honest path, not a sandbox.

### Half 2 - vendored or copied packs

- **FR-10 Pin record.** Every vendored pack carries a lockfile naming its upstream repo and the
  pinned commit (the existing `agency-agents.lock.json` shape is the template). A pack with no
  lockfile is reported by the check as "unpinned", not skipped.
- **FR-11 Lag check.** On a schedule (D4), a job fetches each pack's upstream and counts
  commits from `pinnedCommit` to the upstream default-branch head, restricted to the paths the
  lockfile maps when it maps paths (so unrelated upstream churn does not count).
- **FR-12 Threshold to issue.** When lag exceeds the threshold (default: 50 commits on mapped
  paths OR 90 days since `pinnedAt` - D4), the job opens one issue per pack, or updates the
  existing open one (deduplicated by a stable title/label), with the count, the age, and the
  exact refresh command (`scripts/sync-agency-agents.sh <sha>` for agency-agents). It never
  edits the vendored files.
- **FR-13 Visible failure.** A fetch failure or a lockfile it cannot parse fails the scheduled
  run visibly (red run, error text); it never records "0 behind" for an upstream it could not
  read (invariant 2).

## Acceptance criteria

- **AC-1** Read of a file inside a registered clone whose `FETCH_HEAD` is older than the max
  age, clean tree on default branch, upstream one commit ahead: after the hook, the clone's
  `HEAD` equals the upstream head and the hook output names `old..new` and "1 commit".
- **AC-2** Same, but `FETCH_HEAD` younger than the max age: no `git fetch` is executed
  (asserted by a fake `git` on `PATH` recording its argv) and the hook prints nothing.
- **AC-3** Read of a path NOT in any registered clone (including an unregistered clone under
  `~/code`, and this monorepo itself): no git command runs.
- **AC-4** Dirty tree, detached HEAD, non-default branch, `.minspec/` present, and rebase in
  progress: each one, separately, leaves `HEAD` and the working tree byte-identical and the
  output names that precondition.
- **AC-5** Upstream diverged (local commit not on upstream): `--ff-only` refuses; tree
  unchanged; output names the divergence.
- **AC-6** Fetch that hangs past the timeout (fake remote that never answers): the tool call
  returns within timeout + 2 s with the FR-7 failure text.
- **AC-7** Two concurrent hook runs against one stale clone: exactly one `git fetch` executes.
- **AC-8** Bash `cd ~/code/agency-agents && grep -r foo .` and `git -C ~/code/agency-agents log`
  each trigger FR-3; `echo ~/code/agency-agents-notes` (prefix collision) does not.
- **AC-9** Malformed registry: hook output names the registry and the parse error; it does not
  exit 0 silently.
- **AC-10** Lag check against a fixture upstream 60 commits ahead on mapped paths: one issue
  body is produced with the count and the refresh command; a second run updates rather than
  duplicates it. With 60 commits ahead only on unmapped paths: no issue.
- **AC-11** Lag check with an unreachable upstream: the run fails non-zero with the error; no
  "0 behind" line is written.
- **AC-12** Each AC is mutation-checked: removing the clean-tree check fails AC-4; removing the
  staleness test fails AC-2; removing the lock fails AC-7 (learned rule `f-test-can-pass` -
  tests must not pass vacuously).

## Invariants this change must not break

- **Invariant 1 (offline core).** Nothing in the shipped extension changes. The network call
  happens only for a clone the registry names (registration is the consent), and an offline
  machine still gets its reads - subject to D3 - with a visible "could not refresh" line.
- **Invariant 2 (no silent gate).** Every failure path prints its cause; no `|| true` on the
  refresh result; the lag check never reports a count it did not compute.
- **Invariant 3 (blast radius).** The hook is registered in this repo's `.claude/settings.json`
  (opt-in by `.minspec/`), not in any machine-wide config, unless D5 is answered otherwise. It
  writes only to directories the founder registered, and refuses any directory carrying
  `.minspec/` (a project, not a reference).
- **Never touch a primary.** Learned rules `p-conc-sess`, `f-primary-checkouts-clean-main`:
  working repositories belong to their sessions. FR-1 (allowlist only) plus FR-4 (`.minspec/`
  refusal, clean-tree-only, ff-only) are the two independent witnesses.
- **#231 reviewed-bump rule.** Vendored files change only by a deliberate, reviewed sync.

## Decisions needed (Clarify)

- **D1 - Does #2705 already own half 2?** This dispatch could not read #2705.
  - (a) **(rec)** If #2705 is a scheduled lag check, fold FR-10..FR-13 into it and cut half 2
    from this spec. Cost: two places to read for the full picture until #2705 lands.
  - (b) Keep half 2 here and close #2705 as covered. Cost: discards whatever design #2705
    already carries.
- **D2 - Max age before a refetch (N).**
  - (a) **(rec)** 6 hours. Cost: a read can see an upstream up to 6 h old; one fetch per clone
    per working session at most.
  - (b) 1 hour. Fresher; costs more fetch latency (seconds) on the first read each hour.
  - (c) 24 hours. Cheapest; a same-day upstream change can be missed.
- **D3 - Refresh failed or was skipped: deny the read, or allow with a warning?**
  - (a) **(rec)** Allow, with the FR-7 warning stating the clone's age. Cost: an agent can
    still rely on a stale copy - but it is told so, in its own context, every time.
  - (b) Deny until refreshed. Strictest; costs every offline session all reference reads, and a
    dirty reference clone blocks reads until a human cleans it.
- **D4 - Where the lag check runs, and its threshold.**
  - (a) **(rec)** A weekly scheduled GitHub Actions workflow in this repo (network is normal in
    CI); threshold 50 mapped-path commits or 90 days. Cost: a `.github/` workflow is machinery
    and goes through the machinery-review gate; it sees only packs committed to this repo, so a
    pstack copy held elsewhere is not covered.
  - (b) A step in the chief-of-staff runner. Covers packs outside this repo; costs a dependency
    on the runner being alive, with no CI witness.
- **D5 - Hook scope: this repo only, or every session on the machine?** The reference clones
  are read by sessions in many repos, not just this one.
  - (a) **(rec)** This repo's `.claude/settings.json` only. Cost: a session started in another
    repo reads stale clones unprotected; the memory rule stays the only cover there.
  - (b) The founder's user-level `~/.claude/settings.json`. Covers all sessions; costs a
    machine-wide behaviour change, which invariant 3 forbids MinSpec to ship - so it would be
    the founder's own config change, applied by him, not by this repo.
  Also in D5: whether package-manager dependency updates ("update your dependencies" in the
  quote) are in scope here. Recommendation: no - separate issue; `npm audit fix` is already
  pre-authorised by a standing rule.

## Follow-ups (tracked)

- Half 2 ownership: #2705 (per D1).
- Retire the prose stopgap: once FR-1..FR-9 ship, the feedback memory `f-pull-reference-repos`
  is reduced to a pointer to this hook (task in the Tasks phase of this spec).

## Rejected alternatives

- **Fetch every reference clone on SessionStart.** Rejected: pays the network on sessions that
  never read a reference, and a long session still drifts.
- **Cron `git pull` of all clones.** Rejected: runs while a human may be mid-edit in a clone,
  and has no tie to the moment of use - the founder's ask is "before you refer to them".
- **Git submodules for references.** Rejected: pins rather than freshens, and drags third-party
  repos into this repo's history.
- **Auto-sync vendored packs on lag.** Rejected: overturns the #231 reviewed-bump decision.
