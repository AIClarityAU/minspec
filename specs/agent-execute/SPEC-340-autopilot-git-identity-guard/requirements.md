---
id: SPEC-340
type: requirements
status: specifying
tier: T3
product: agent-execute
epic: EPIC-007  # Agent Execute Extension - Autopilot Mode (DR-036) runs inside the agent-dispatch surface
aspects: [autopilot, security, blast-radius, git-identity, fail-closed, offline, auto-merge]
depends_on: [DR-036]
relates_to: ["#238", "#233", "#234", "#235", "#236", "#237", DR-036, DR-015]
implements: none
implements_reason: >-
  Specify phase only. The Autopilot Mode loop that this guard gates does not exist yet
  (no `autopilot` or `blueprint` symbol under packages/*/src or scripts/ at 10a23c80), and
  neither does a `gate-placement` config key. Which files this spec owns is declared at Plan.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-340: Autopilot Mode refuses to run anywhere but the three playground repos, rechecked from git identity on every loop iteration

> **This is a SPECIFICATION ONLY.** Written for issue #238 (A11 git-identity guard), the
> A11 prerequisite of [DR-036 Autopilot Mode](../../../docs/decisions/DR-036.md) (see
> `docs/autopilot-mode-design.md` §4, row A11). Nothing is built until the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are answered and the spec is
> approved. T3 (full spec cycle: specify, plan, tasks, implement).
>
> No new decision record. DR-036 already decided the mechanism: hard-named repos, checked
> from git identity, refused outright. Every choice left here can be undone in under a day.

## In plain terms

Autopilot Mode merges its own pull requests with no human in the loop. DR-036 allows that
only on three throwaway repos: MeetLoop, HireLoop and SourceBridge. The switch that turns
auto-merge on, `gate-placement=auto-merge`, will sit in `.minspec/config.json`, and an
agent can edit that file. If the loop runs in the wrong directory (a sibling worktree, or
a canonical path that resolves wrongly), it would carry playground rules into MinSpec
itself and merge unreviewed code there.

This spec adds a guard that ignores the config file when deciding *where* it is. On every
loop iteration, before any merge is armed, it reads the repo's identity from git, compares
it with a list compiled into the code, and stops the run if they do not match. The config
switch is still required, but on its own it is never enough.

## Status of the claims

| Claim | How it was checked |
|---|---|
| No Autopilot loop exists yet | `grep -rli "autopilot\|blueprint" packages/*/src scripts` returns nothing at 10a23c80 |
| No `gate-placement` key is read anywhere | `grep -rn "gate-placement\|gatePlacement" packages scripts --include=*.ts` returns no code hits at 10a23c80 |
| A remote resolver that keeps "none" separate from "ambiguous" already exists | `packages/minspec/src/lib/git-remotes.ts:47` (`RemoteResolution`), `:129` (`githubSlugFromUrl`). Whether `githubSlugFromUrl` already normalises every form FR5 needs is unverified; Plan checks it |
| The three playground checkouts' remotes today | Local `git remote -v` on 2026-11-16: `https://github.com/harvest316/{MeetLoop,HireLoop,SourceBridge}.git`, each with a `.minspec/` marker. Read offline; whether GitHub has since moved them to `AIClarityAU` is **not checked** (no network) |
| The root commits today | `git rev-list --max-parents=0 HEAD`, run locally, none shallow: MeetLoop `38193e12…`, HireLoop `15faadaa…`, SourceBridge `efab47c6…`, MinSpec core `d1fb9210…` |

## Threat model

What the guard defends against:

- **T-1 misresolved location.** The loop's working directory, canonical-dir lookup or
  worktree resolution points at a MinSpec core checkout (or any other repo) while the
  loop believes it is in a playground. This is the case DR-036 A11 names.
- **T-2 config trusted for identity.** `.minspec/config.json` says `auto-merge` in a repo
  that is not a playground, because it was copied, scaffolded or edited.
- **T-3 cheap identity forgery.** An agent in the loop edits `.git/config`
  (`git remote set-url`, an added remote, a `pushurl`, an `insteadOf` rewrite) or sets
  environment variables (`GIT_DIR`, `GIT_CONFIG_COUNT`/`KEY`/`VALUE`,
  `GIT_CONFIG_PARAMETERS`) so that the remote URL reads as a playground.
- **T-4 verify one repo, merge another.** The guard checks the working directory, but the
  merge call names a different repository (for example `gh pr merge --repo <other>`).

Out of scope, handled elsewhere:

- An agent that edits the guard's own source or its compiled list. That is a source edit
  under machinery review; DR-036 A3 (#235) adds the PreToolUse deny on gate files.
- Rewriting the history of MinSpec core to fake a root commit. That needs a force-push to
  a protected `main`, which the branch ruleset blocks.

## Functional requirements

**FR1 - Fixed list, compiled in.** The playground identities are a constant in source
code: for each of the three repos, its exact GitHub `owner/name` slug (Clarify D1) and its
root commit SHA (Clarify D2). No config file, environment variable, command-line flag or
settings key can add to, remove from or replace the list. The only way to change it is a
code change, which goes through review like any other.

**FR2 - Checked on every iteration, never cached.** Each Autopilot loop iteration runs the
guard again before doing anything that can arm, enable or perform a merge. A verdict from
an earlier iteration, an earlier process or a file on disk is never reused.

**FR3 - Config is necessary, never sufficient.** Auto-merge is allowed only when the
config says `gate-placement=auto-merge` **and** the guard returns `verified`. A failed
guard refuses whatever the config says. A passing guard with any other config value
grants nothing: the guard never turns auto-merge *on*.

**FR4 - Identity read from the repo, with environment overrides removed.** The guard
resolves the repo from the iteration's actual working directory
(`git rev-parse --show-toplevel`), never from a stored path. It runs every git command
with the variables that redirect git or inject config (`GIT_DIR`, `GIT_WORK_TREE`,
`GIT_COMMON_DIR`, `GIT_CONFIG*`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and its
`KEY_n`/`VALUE_n` pairs) removed from the environment. Clearing them is not enough on its
own: if any of them was set when the guard was called, the guard refuses (FR7), because
the iteration that called it was running against something other than this repo.

**FR5 - Witness one, the remote URLs.** The guard reads every configured remote's
effective fetch URL and push URL, after git applies `insteadOf`/`pushInsteadOf`
(`git remote get-url --all <name>` and `git remote get-url --push --all <name>`). It
normalises each to `owner/name`: HTTPS, `ssh://` and scp-style `git@host:` forms; a
trailing `.git` or `/` dropped; host, owner and name compared case-insensitively; host
must be exactly `github.com`. Every URL must normalise to the **same** playground slug
(Clarify D3). Any URL that does not parse, points at another host, or names any other
repo fails the witness. Zero remotes fails the witness: the `none` state that is a safe
"no" for `git-remotes.ts` callers is a refusal here.

**FR6 - Witness two, the root commit.** The guard lists the root commits reachable from
`HEAD` (`git rev-list --max-parents=0 HEAD`) with `GIT_NO_REPLACE_OBJECTS=1` set, and
refuses if `.git/info/grafts` exists, so `git replace --graft` and legacy grafts cannot
fake a parentless commit. It refuses a shallow clone
(`git rev-parse --is-shallow-repository` is `true`), because the shallow boundary commit
looks parentless. The witness passes only when the root set contains the listed root SHA
of **the same** playground that FR5 matched. It refuses whenever MinSpec core's root
(`d1fb9210e407f61a82497ac25a6fb946511f2917`) is in the set, even if the other checks pass.
That deny entry is the T0 anchor: it holds even when an agent has rewritten every remote URL.

**FR7 - Fails closed, and says why.** The guard returns exactly one of:
`{ kind: 'verified', slug, root }` or `{ kind: 'refused', reason, observed }`. Every error
is a `refused`: a non-zero git exit, a timeout, output that does not parse, an unexpected
exception, or the two witnesses disagreeing. No code path returns "unknown" or skips the
check, and nothing catches an error and carries on (constitution invariant 2). `reason` is a
fixed code (`no-remote`, `foreign-remote`, `mixed-remotes`, `unparseable-remote`,
`root-mismatch`, `core-root-present`, `shallow`, `grafts-present`, `git-env-override`,
`git-error`, `witness-disagree`). `observed` holds the slugs and roots actually seen.

**FR8 - A refusal stops the whole run.** On `refused`, the loop arms no merge, does no
further work in that run, writes `status: human-needed` with the reason code (DR-036's
existing escalation state), and shows a visible message naming the reason and what it
observed. A refusal is not a warning and does not fall back to "open a PR and wait".
DR-036 says Autopilot Mode never touches MinSpec core, and a repo it cannot identify might
be MinSpec core, so every write in that run is suspect, not only the merge.

**FR9 - The merge target comes from the verdict.** Whatever arms or performs the merge
takes the repository slug from the `verified` result of that iteration. It must not read it
from config, an environment variable or a separate `gh` lookup. If the merge call cannot be
given an explicit repository, the plan must show it acting on the same working directory
the guard just checked, in the same iteration.

**FR10 - Offline.** The guard reads only local git state: no `gh`, no GitHub API call, no
`git fetch` or `ls-remote` against a remote (constitution invariant 1). Rejected
alternative: asking the GitHub API for the repo's ID would survive a rename, but it is a
network call and the token it needs is one of the things the loop could be steered to
misuse.

**FR11 - Stays in the repo that opted in.** The guard writes nothing, adds no hook and
changes no config, in the target repo or anywhere else. It runs only inside the Autopilot
loop, which runs only where `.minspec/` exists (constitution invariant 3).

## Acceptance criteria

Each criterion is a T0 test (pure function or temporary git repository, offline, no
network). The guard is written as a pure core that takes the list as a parameter, plus a
production entry point bound to the FR1 constant. Tests may pass a fixture list to the
core, but AC1 and AC9 must go through the production entry point.

- **AC1 (the issue's T0 test).** A temporary repository whose remote is
  `https://github.com/AIClarityAU/minspec.git` and whose `.minspec/config.json` sets
  `gate-placement=auto-merge` → production entry returns `refused`, and auto-merge
  eligibility is `false`. The same assertion run against this repository's own checkout
  (MinSpec core, root `d1fb9210…`) returns `refused` with `core-root-present` (when not
  shallow) or `shallow`.
- **AC2.** Fixture playground repo (fixture list: slug + fixture root) whose remote and root
  both match → `verified` with that slug. The control for AC3 to AC8.
- **AC3.** The AC2 repo with its remote changed to a non-playground slug → `foreign-remote`.
  The AC2 repo with a second remote pointing elsewhere → `mixed-remotes` (under the D3
  recommendation). A `pushurl` pointing elsewhere → refused.
- **AC4.** A non-playground repo whose remote URL is rewritten to a playground slug, without
  a matching root → `root-mismatch`. A repo carrying core's root plus a playground URL →
  `core-root-present`.
- **AC5.** Shallow clone → `shallow`. A `git replace --graft` that makes a non-root commit
  look parentless with the root SHA listed → refused (replace objects ignored). A present
  `.git/info/grafts` → `grafts-present`.
- **AC6.** `GIT_DIR`, or a `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0` triple injecting
  `remote.origin.url`, set when the guard is called → `git-env-override`. The injected
  value never reaches the slug comparison.
- **AC7.** The git runner throws, exits non-zero or times out → `git-error`, never
  `verified`. Zero remotes → `no-remote`. URL `not a url` → `unparseable-remote`.
- **AC8.** Eligibility truth table: config `auto-merge` × guard `verified` → eligible; every
  other one of the four combinations → not eligible.
- **AC9.** The production list is a frozen constant. No config, environment or settings read
  affects it, shown by a test that sets plausible keys (`autopilot.playgrounds`,
  `MINSPEC_PLAYGROUNDS`) and gets the same result as AC1.
- **AC10 (loop wiring, when the loop exists).** A loop test with an iteration counter shows
  the guard is called once per iteration, before the merge-arm call, and that changing the
  remote between iteration 1 and iteration 2 refuses at iteration 2. Until the Autopilot
  loop exists (DR-036 follow-ups #233 to #237), AC10 is reported as blocked, not passed.
- **Mutation proof.** Each of these mutants must make at least one AC fail: dropping the
  per-iteration call, treating `none` as pass, dropping the root witness, dropping the
  core-root deny, catching `git-error` into `verified`.

## Invariants this change must not break

- **Invariant 1, offline.** FR10: local git reads only.
- **Invariant 2, no silent gate.** FR7 and FR8: every error is a visible refusal, and the
  decision uses two independent witnesses (remote URL and root commit), so one editable
  file cannot turn it.
- **Invariant 3, blast radius.** FR11: read-only, and runs only in an opted-in repo.
- **DR-036's firewall.** Auto-merge stays per-repo config **and** this guard. MinSpec core
  keeps the human gate on every pull request.

## Decisions needed (Clarify)

**D1 - Which owner the list names.** The local remotes are `harvest316/<Repo>`. Session
notes record an org move from harvest316 to AIClarityAU, and I have not checked
(offline) whether these three repos moved.
- `a` exact slugs as observed, `harvest316/MeetLoop` and the other two **(rec)**. Cost: if
  a repo is later moved and its remote updated, the mode refuses until a one-line code
  change. That fails closed, but it is a stop you will hit.
- `b` both `harvest316/<Repo>` and `AIClarityAU/<Repo>` for each. Cost: twice the accepted
  slugs. Still exact names, so the extra risk is small.

**D2 - Whether to require the root-commit witness (FR6).**
- `a` require it, with the core-root deny **(rec)**. It is the only witness an agent cannot
  forge by editing `.git/config`, and it satisfies invariant 2's demand for a second,
  independent witness. Cost: a history rewrite on a playground repo (squash-to-root,
  `filter-repo`) refuses the mode until the constant is updated, and shallow clones,
  including default CI checkouts, are refused.
- `b` remote URL only, which is what the issue text asks for. Cost: one editable file
  decides it, so T-3 stays open.

**D3 - How to treat extra remotes.**
- `a` every remote, fetch and push, must name the same playground **(rec)**. Cost: a
  playground clone that also tracks a template or upstream remote is refused until that
  remote is removed.
- `b` check only the remote the loop pushes to. Cost: it needs a reliable "which remote
  does the loop push to" answer, which is exactly what `git-remotes.ts` reports as
  `ambiguous`, and it leaves a planted remote harmless only if that resolution is right.

## Follow-ups (tracked)

- Loop wiring (AC10) waits for the Autopilot loop itself, which does not exist yet. The
  other DR-036 prerequisites are #233 to #237. AC10 is part of this spec, not a separate
  item. It is reported as blocked until then.
- Protecting the guard's source and list from loop-agent edits: #235 (A3, PreToolUse deny).
- None other.
