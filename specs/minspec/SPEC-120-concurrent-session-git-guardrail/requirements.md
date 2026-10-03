---
id: SPEC-120
type: requirements
title: Concurrent-session git guardrail — a branch-moved-under-you witness in the affected window, and a spec-tied isolated session
status: specifying
tier: T3
product: minspec
created: 2026-10-03
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination, sibling of SPEC-026 (session presence) and SPEC-057 (stranded-branch detection)
aspects: [session-coordination, worktree, g8-git-transparency, tier-0, offline, second-witness, status-bar, never-wrong]
depends_on: [SPEC-026]  # reuses the presence heartbeat (built) as the "is a peer in this folder" evidence and its 30s tick; refines the worktree command SPEC-026 FR-9 specifies
relates_to: [SPEC-015, SPEC-044, SPEC-052, SPEC-057, SPEC-096, DR-046, DR-051, DR-065, DR-073, "#168"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038; the SPEC-096
# precedent). All four paths are NET-NEW: none exists at 350c6fa4.
implements: [packages/minspec/src/lib/head-witness.ts, packages/minspec/tests/head-witness.test.ts, packages/minspec/src/commands/new-isolated-session.ts, packages/minspec/tests/new-isolated-session.test.ts]
# Modified, not owned. presence.ts belongs to SPEC-026; status-bar.ts to SPEC-015;
# template-registry.ts and scaffold.ts to SPEC-043.
affects: [packages/minspec/src/extension.ts, packages/minspec/src/views/status-bar.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-120: Concurrent-session git guardrail

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or accepts the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes.

Triggered by: [#168](https://github.com/AIClarityAU/minspec/issues/168) — concurrent-session
git guardrail (worktree-per-session, branch-switched-under-you detection).

Rests on, and does not change: [DR-051](../../../docs/decisions/DR-051.md) (artifact-class
branch policy — approvable documents on `main`, code in worktrees),
[DR-065](../../../docs/decisions/DR-065.md) (the one sanctioned case in which a loop may
fast-forward a shared checkout), [DR-046](../../../docs/decisions/DR-046.md) (dedicated
worktree isolation for dispatch). No new decision record — see
[Why no new DR](#why-no-new-dr).

## One-Sentence Scope

When the branch of the folder a MinSpec window is open on moves and that window did not
move it, say so in that window (and to the coding agent working in it) in plain language
with only the claims the evidence supports; and give a non-git-expert one command that
opens a separate folder on its own branch, named after the spec being worked on, so the
collision cannot happen in the first place.

## Context — what exists today (read from `350c6fa4`, not inferred)

Issue #168 was filed before most of the session-coordination corpus existed. A large part of
what it asks for has since been **specified**, and a smaller part **built**. This spec covers
only the remainder, and says which is which, so that it does not mint a second owner for
work that already has one.

| What #168 asks for | Where it lives today | State at `350c6fa4` |
|---|---|---|
| A heartbeat naming the sessions in a folder ("two windows, same repo") | SPEC-026 (session presence) FR-1 to FR-7 | **Built**: `SessionPresenceManager` in `packages/minspec/src/lib/presence.ts:514`, started at `packages/minspec/src/extension.ts:125-127`; same-folder test `sameCheckout` at `presence.ts:310`, `isCheckoutOccupied` at `presence.ts:381` |
| A count of other sessions in the status bar | SPEC-026 FR-5 | **Specified, not built**: no occurrence of the `👥` suffix anywhere under `packages/minspec/src` |
| A command that creates a worktree | SPEC-026 FR-9, titled "MinSpec: New Session Worktree" | **Specified, not built**: no such command among the 71 in `packages/minspec/package.json`; the only `git worktree add` call in the extension is the docs lane at `packages/minspec/src/commands/push-docs-lane.ts:278` |
| Undo a branch switch that strands a peer | SPEC-026 FR-15 part 1, a `post-checkout` hook | **Specified, not built**: no `post-checkout` or `prepare-commit-msg` template in `template-registry.ts` or `scaffold.ts`; none of the four `MINSPEC_*_OFF` switches appears in `.minspec/hooks/pre-commit` |
| The working-practice rules, in the generated agent instructions | SPEC-026 FR-9 "Concurrent-Session Etiquette" block | **Specified, not built**: `template-registry.ts` carries no such block (searched for `worktree`, `rule #8`, `one session`; two unrelated hits at `:519` and `:1339`) |
| "Your branch changed and you did not do it", told to **the affected session** | Nowhere in the product. A dev-time shell version exists at `scripts/hooks/session-start.sh:27-52` | **Gap** — this spec |
| A worktree **tied to the active spec** | Nowhere. SPEC-026 FR-9 takes a free-form `<name>` | **Gap** — this spec |
| Never switch with uncommitted work | SPEC-026 FR-15 records that git offers no hook that can refuse a switch (observed on git 2.43) | **Gap for MinSpec's own commands** — this spec; unsolvable for switches made elsewhere |
| Status bar: this branch, isolated or shared | Nowhere | **Gap** — this spec |

### Root cause, and the gate that is missing

The mechanism is the one the issue names: one working tree has one `HEAD`, and several
actors move it. That is unchanged and is addressed structurally by isolation.

What this spec adds to the diagnosis is where the existing design's detection sits. SPEC-026
FR-15 detects a branch switch **in the process that made the switch** — a git hook that runs
on the mover's side. That is a single producer, and it is silent in every one of these cases:

- the mover is an actor MinSpec's hooks do not run for (a clone with `core.hooksPath` not
  set, a hook kill-switch, a tool that calls git with hooks disabled);
- the move is not a checkout. A `post-checkout` hook is specified for `switch`/`checkout`;
  whether `reset --hard`, `rebase`, `merge` and `pull` reach it is **unverified here** and is
  a Plan-phase measurement, not an assumption this spec makes;
- the hook is simply not installed yet, which is the state today.

In all of them the session whose branch moved is told nothing. Constitution invariant 2 (no
silent gate — "no required check hinges on a single producer that one permission/config gap
can disable (provide an independent second witness)") names this shape. SPEC-057
(stranded-branch detection) applied the same reasoning to a different guard. This spec is the
independent second witness for the branch-moved case: it runs **in the affected window**,
reads git's own state, and depends on no hook.

### Two facts that shape the design

1. **A coding agent does not read toasts.** SPEC-026's "critical constraint" section records
   that an autonomous agent never looks at the status bar or the Command Palette. A warning
   shown only in the VS Code window reaches the human and not the agent that is about to
   commit onto the wrong branch. So the witness has two faces (FR-1 to FR-9 for the window,
   FR-10 for the agent).
2. **Presence cannot see every actor.** SPEC-026 FR-11 records that every session inside one
   VS Code window shares one extension-host process, which writes one presence record. Two
   Claude Code tabs in one window, or an agent started from a bare terminal, are therefore
   invisible to presence. "No peer in the presence directory" is **not** evidence that
   nothing else is using the folder. Every requirement below that words a message is built
   around that limit: MinSpec says what it observed and never names an actor it cannot show.

## Functional Requirements

Requirements are written under the recommended option of each Clarify question. A different
answer changes the requirement that cites it, and is noted there.

### Layer A — the witness (detection). Ship first; depends on nothing unbuilt

#### FR-1 — Observe the checkout's HEAD, offline

The witness holds an observation of the folder the window is open on:

```typescript
interface HeadObservation {
  worktreeRoot: string;        // git rev-parse --show-toplevel
  gitDir: string;              // the PER-WORKTREE git directory (absolute)
  ref: string | null;          // short branch name; null when HEAD is detached
  sha: string;                 // full object id of HEAD, never truncated for comparison
  dirty: boolean;              // true when git status --porcelain is non-empty
  observedAt: string;          // ISO-8601 UTC
}
```

- Every field comes from a local git read. No fetch, no network call of any kind.
- `gitDir` is resolved by asking git, never by joining `<root>/.git`. In a linked worktree
  `.git` is a file, not a directory, so a path built by joining finds nothing (FR-9, INV-7).
- If any read fails, the observation is `unreadable` and FR-8 applies. A failed read is never
  treated as "no change".

#### FR-2 — Baseline

- The first successful observation after activation becomes the **baseline**. Nothing is
  reported for it.
- The baseline is also kept in the window's workspace state, so a change that happened while
  the window was closed is noticed at the next activation. That case is reported at the
  quiet level only (FR-6), with wording that says "since this window was last open", because
  the person may well have made the change themselves in between.
- The baseline moves forward only by FR-5 (a move MinSpec made itself) or FR-7 (the person
  acknowledged the alert). It never moves silently on a move that was reported.

#### FR-3 — When the witness looks

- at activation;
- when git's per-worktree HEAD state changes on disk (a file watcher on the resolved
  `gitDir`, FR-1);
- on the existing 30-second presence heartbeat tick (`HEARTBEAT_SECS`, `presence.ts:46`), as
  the fallback for a watcher that is unavailable or misses an event.

No new timer is introduced (INV-8). Worst-case latency from a move to the alert is therefore
one heartbeat plus the settle window of FR-9.

#### FR-4 — Classify the move (pure function)

`classifyHeadChange(baseline, current, isAncestor)` returns exactly one of:

| Class | Condition |
|---|---|
| `unchanged` | same `ref`, same `sha` |
| `branch-switched` | both attached, `ref` differs |
| `detached` | baseline attached, current detached |
| `reattached` | baseline detached, current attached |
| `advanced` | same `ref`, new `sha` has the baseline `sha` as an ancestor (a commit, a fast-forward, a pull) |
| `rewritten` | same `ref`, new `sha` does **not** have the baseline `sha` as an ancestor (a reset, a rebase, an amend) |
| `unknown-move` | the ancestry question could not be answered |

The function takes its inputs as values and the ancestry answer as an argument, so it is
testable with no repository. `unknown-move` is a reported class, not a silent default.

#### FR-5 — Evidence, in three states — never a guess about who

The issue's wording is "if HEAD changes without this session acting". The window cannot know
who acted in general: a checkout from VS Code's own source-control view, from a terminal, or
from an agent in another tab all look identical on disk. So the witness records **evidence**,
not an actor:

1. **`self-token`** — a MinSpec command in this window registered an *expected move* (target
   ref or sha, expiring after 30 seconds) immediately before running a git operation that
   moves this checkout's HEAD, and the observed move matches it. The move is silent and the
   baseline advances.
2. **`peer-here`** — the presence layer reports at least one **live** other session whose
   `worktreeRoot` is this same checkout (`isCheckoutOccupied`, `presence.ts:381`, which
   compares through `sameCheckout`, `presence.ts:310`).
3. **`none`** — neither of the above.

`peer-here` means a peer is present, not that the peer made the move. Message text keeps that
distinction (FR-7, INV-4).

#### FR-6 — Severity

| Move class | Evidence | Tree dirty (baseline or now) | Level |
|---|---|---|---|
| any | `self-token` | either | **silent** — baseline advances |
| `branch-switched`, `detached`, `reattached`, `rewritten`, `unknown-move` | `peer-here` | either | **loud** |
| same | `none` | dirty | **loud** |
| same | `none` | clean | **quiet** |
| `advanced` | `peer-here` | either | **quiet** ("new commits appeared on your branch") |
| `advanced` | `none` | either | **silent** — the ordinary case of the person committing |
| any, found at activation after the window was closed (FR-2) | any | either | **quiet** |

- **Loud** = a non-modal warning notification over the visible editor, plus the status-bar
  alert state of FR-14, plus a line in the MinSpec output channel. It is never a modal dialog
  and never takes focus.
- **Quiet** = the status-bar alert state and the output-channel line; no notification.
- **Silent** = an output-channel line only.

This table is the recommended answer to [DQ-1](#dq-1--how-loud-is-a-move-with-no-evidence-of-another-actor).

#### FR-7 — What the alert says, and what it offers

Every loud or quiet alert states, in plain language with no git vocabulary beyond "branch":

1. the branch before and the branch now (or, for `rewritten`, that the branch's history was
   replaced; for `detached`, that the folder is no longer on any branch);
2. whether there are unsaved-to-git changes in the folder **right now**;
3. the evidence, worded to its strength: with `peer-here`, "another MinSpec session is open
   on this folder" and that session's declared scope (SPEC-026 FR-16 findability: scope, not
   a bare id); with `none`, "MinSpec did not make this change. If you did not either,
   something else is using this folder." It never says another session made the move;
4. one recommended next step.

Reference copy for the loud case with a peer (exact copy is settled in Plan):

> ⚠️ This folder changed branch: `X` → `Y`. MinSpec did not do this, and another session
> ("<peer scope>") is open on the same folder. You have changes that are not committed —
> they are now sitting on `Y`. Do not switch back until you have committed them or moved
> to your own folder.

Actions offered, each keyboard-reachable:

- **Show details** — opens the output channel at the entry: both observations, the last line
  of git's own HEAD log for this worktree when readable, and the live peers.
- **Open an isolated session** — runs FR-11.
- **I did this** — acknowledges; the current observation becomes the baseline.

The witness **never** switches, stashes, resets, reverts or commits on the person's behalf
(INV-2). Undoing a switch belongs to SPEC-026 FR-15 and stays there.

#### FR-8 — An unreadable checkout is shown as unreadable

If the observation fails (git missing, git directory unreadable, a command error), the status
bar shows a distinct "cannot check this folder's branch" state with the reason in the
tooltip, and the output channel records the failing command and its error. It does not show
the normal state. When a later observation succeeds, the state clears on its own. (Constitution
invariant 2: a missing witness is visible, never a silent pass.)

#### FR-9 — Settle, coalesce, and work in a linked worktree

- A burst of moves (a rebase replays many commits) produces **one** alert, comparing the
  baseline with the state once HEAD has been still for a short settle window (a named
  constant; 2 seconds is the starting value).
- If the settled state equals the baseline but HEAD moved in between (a switch away and
  back), the round trip is recorded in the output channel and raised at the quiet level — the
  files on disk may have been rewritten along the way.
- At most one alert is outstanding per window. A further move while one is outstanding
  updates it instead of stacking a second.
- The witness works identically when the window is open on a linked worktree. (For
  reference, the existing auto-classify watcher is built on the pattern
  `.git/{HEAD,refs/heads/**}` relative to the workspace root, `extension.ts:715-717`; I
  believe that pattern matches nothing in a linked worktree because `.git` is a file there —
  **unverified by execution**, recorded under [Follow-ups](#follow-ups-to-file) and not
  fixed by this spec.)

#### FR-10 — The agent-facing witness (Claude Code hook)

Recommended answer to [DQ-3](#dq-3--does-the-agent-facing-witness-ship-in-this-spec).

- MinSpec scaffolds one more Claude Code hook alongside the existing session-title hook
  (`CLAUDE_HOOK_TEMPLATES`, `template-registry.ts:2273-2296`, DR-073 hook stack), gated on
  `tools.claude` exactly as that hook is, registered additively in `.claude/settings.json`.
- On each prompt submission the hook compares the folder's current branch with the branch it
  recorded for **this agent session**, and when they differ prints the FR-7 facts into the
  agent's context, followed by: stop, do not commit, do not switch back, tell the human.
- The record is keyed by the agent session's own id and stored under the per-worktree git
  directory — never in the working tree, never committed, never shared between worktrees.
  This is the productized form of `scripts/hooks/session-start.sh:27-52`, with two
  corrections: it is per session instead of per folder (the dev-time version shares one
  record among all sessions in a folder, so the second session to start erases the first
  one's baseline), and it runs on every prompt instead of once at start.
- The hook is deliberately the small version: branch name and dirty flag only, no ancestry.
  The cases it shares with FR-4 (`unchanged`, `branch-switched`, `detached`, `reattached`)
  are pinned by one golden fixture evaluated by both the TypeScript classifier and the shell
  hook, the SPEC-026 FR-14 parity idiom. Divergence fails CI.
- It reads only local git state, exits 0 on any error after printing that it could not
  check (it informs; it does not block a prompt), and writes nothing when the folder has no
  `.minspec/` marker.

### Layer B — isolation (the structural fix)

#### FR-11 — One command: "MinSpec: New Isolated Session"

- There is **one** worktree-creating command for sessions, not two. This spec refines the
  command SPEC-026 FR-9 specifies; it does not add a sibling. The title is the plain-language
  one from the issue ([DQ-4](#dq-4--command-title-and-how-spec-026-fr-9-is-reconciled)).
- The extension calls git directly (SPEC-026 FR-9 portability rule: no dependence on a
  repo-local script).
- The command **never moves the HEAD of the folder it was run from** and never touches that
  folder's uncommitted changes (INV-9, INV-10; DR-051 §4a). It creates a new folder on a new
  branch and opens it in a new window.
- Before creating anything it shows what it is about to create — folder path, branch name,
  and what the branch is based on (FR-13) — and proceeds on one confirmation.
- It refuses, visibly and without creating anything, when: the folder has no `.minspec/`
  marker (the SPEC-096 single-creator rule — it points at Initialize and creates no marker);
  the folder is not a git repository; the target path already exists and is not the worktree
  it would have created.
- If the person has uncommitted changes, they stay where they are. The confirmation says so,
  and names "MinSpec: Push work via branch" (SPEC-052) as the way to land them. Carrying
  uncommitted work across is out of scope.

#### FR-12 — Names: tied to the spec

- With an active spec (the session's declared `specIds`, else the spec open in the editor),
  the defaults are branch `spec/SPEC-NNN` and folder name `SPEC-NNN`.
- With no active spec, the command asks for a short name and uses branch `session/<name>` and
  folder `<name>`. It never invents a spec id.
- If the default branch already exists: when it is checked out in an existing worktree, the
  command offers to open that folder instead of creating a second one; otherwise it offers
  the next free suffix (`spec/SPEC-NNN-2`). It never reuses, resets or deletes an existing
  branch.
- The folder is created at the location chosen in
  [DQ-2](#dq-2--where-the-isolated-folder-is-created). Under the recommended option:
  `<parent of repo>/<repo>.worktrees/<name>`, overridable by a setting.
- **What is isolated is the code for the spec, not the spec document.** Under DR-051 §1 the
  approvable documents stay on the default branch (or take the review-branch route of DR-051
  §4b). A `spec/SPEC-NNN` branch is where that spec's implementation is written. The
  confirmation text says this in one line so the folder name is not read as "the spec lives
  here now".

#### FR-13 — The base of the new branch, stated honestly

- The new branch is created from the default branch as the remote last reported it
  (`origin/<default>` as already present locally), falling back to the local default branch,
  falling back to the current commit. Each fallback is named in the confirmation.
- No fetch is performed (constitution invariant 1). The confirmation shows how old the base
  is ("based on `main` as of 3 days ago"), so a stale base is visible before it is built on.
  Fetching with consent is out of scope here; SPEC-085 (backlog fetch consent) is the
  existing consent pattern if it is added later.
- The command does not branch from the current folder's HEAD by default: when that folder
  has just been moved by another actor, its HEAD is exactly the thing that cannot be trusted.

#### FR-14 — Status bar: this folder's branch, and what MinSpec can show about sharing

The existing MinSpec status-bar item (SPEC-015 owns the surface) gains a checkout segment
showing the branch name and one of:

| State | Shown when | Wording |
|---|---|---|
| **shared** | presence reports a live peer on this same checkout | `⚠ shared (N other)` |
| **isolated** | the folder is a linked worktree and no live peer is on it | `isolated` |
| **main folder** | the folder is the primary checkout and no live peer is reported | branch name only; tooltip: "Other tools that MinSpec cannot see may also be using this folder." |
| **alert** | an FR-6 loud or quiet alert is outstanding | `⚠ branch changed`, until acknowledged or HEAD returns to the baseline |
| **unreadable** | FR-8 | `? branch` |

MinSpec does **not** display "owned by this session" (the issue's wording). It cannot
establish ownership (Context, fact 2), and an unprovable "owned" on a status bar is the false
signpost the product exists to avoid ([DQ-5](#dq-5--the-owned-by-this-session-label)).
Clicking the segment opens the SPEC-026 FR-5 Quick Pick where that exists, and otherwise a
Quick Pick listing this repository's worktrees (from git's own list) with "New Isolated
Session" as the first entry.

#### FR-15 — MinSpec's own commands never switch a folder with uncommitted work

Git gives no way to refuse a switch made elsewhere, so this requirement binds what MinSpec
can bind: its own code.

- No MinSpec command runs a git operation that moves the HEAD of the folder the window is
  open on to a different branch, or rewrites it, while that folder has uncommitted changes.
  It refuses with a plain explanation and offers FR-11.
- Every MinSpec command that does move this checkout's HEAD registers the FR-5 expected-move
  token first.
- Both halves are held by an **inventory test** over the extension's git invocations (the
  SPEC-096 inventory-test idiom): a new call site that moves HEAD without the dirty check and
  the token fails the test. Which call sites exist today is a Plan-phase measurement; this
  spec does not assert a count.
- MinSpec does **not** offer to stash. The stash is shared by every worktree of a repository,
  so an automatic stash by one session is itself a cross-session collision. The offered
  remedies are "commit" and "open an isolated session".

### Layer C — the rules, shipped

#### FR-16 — The working-practice rules in the generated agent instructions

SPEC-026 FR-9 specifies that a "Concurrent-Session Etiquette" block exists in the generated
agent instructions. This requirement fixes its content to the rules from the issue, reconciled
with DR-051:

1. One session, one folder, one branch. Never two sessions in one folder.
2. Do not switch branches in a folder another session may be using — open an isolated
   session instead.
3. Do not switch branches with uncommitted changes. Commit first.
4. Commit small and push promptly.
5. Do not write **code** on the default branch. (The issue's rule is "`main` is for merging
   only"; stated that broadly it contradicts DR-051 §1, under which approvable documents are
   committed directly on the default branch. The shipped rule carries the code-only form.)

The block goes only into the harness file of the opted-in repository, inside the managed
region, by the existing refresh path. It is prose and therefore model-trusted; FR-1 to FR-10
are what make a breach visible, and that relationship is stated in the block's own comment so
the rule is not mistaken for enforcement.

## Acceptance Criteria

- [ ] **Loud when a peer is present** — with a second live MinSpec session on the same
      folder, switching the branch from outside the window produces the loud alert within
      one heartbeat plus the settle window, naming both branches and the peer's scope.
      (FR-3, FR-5, FR-6, FR-7)
- [ ] **Loud when work is at risk** — with no peer and uncommitted changes, the same switch
      produces the loud alert, and its text does not mention another session. (FR-6, FR-7, INV-4)
- [ ] **Quiet when nothing is at risk** — with no peer and a clean tree, the same switch
      produces no notification; the status bar shows the alert state. (FR-6, FR-14)
- [ ] **Ordinary commits are silent** — committing on the current branch from the terminal or
      the source-control view produces no notification and no alert state. (FR-4, FR-6, INV-6)
- [ ] **MinSpec's own moves are silent** — a MinSpec command that moves HEAD after registering
      its token produces no alert, and the baseline follows. (FR-5)
- [ ] **A rebase is one alert** — a multi-commit rebase run from outside produces exactly one
      `rewritten` alert. (FR-4, FR-9)
- [ ] **Unreadable is visible** — with git made unavailable, the status bar shows the
      unreadable state and the output channel names the failing command; no "all fine" state
      is shown. (FR-8, INV-5)
- [ ] **Works in a linked worktree** — every criterion above holds when the window is open on
      a linked worktree, and a branch switch in the primary checkout raises nothing in that
      window. (FR-1, FR-9, INV-7)
- [ ] **The agent is told** — in a Claude Code session, after an outside branch switch, the
      next prompt's context contains the before and after branch and the stop instruction; a
      second agent session in the same folder keeps its own baseline. (FR-10)
- [ ] **Classifier parity** — the TypeScript classifier and the shell hook agree on every case
      in the shared golden fixture; CI fails on divergence. (FR-10)
- [ ] **Isolated session from a spec** — with SPEC-NNN active, the command proposes branch
      `spec/SPEC-NNN` and folder `SPEC-NNN`, shows the base and its age, and on confirmation
      opens the new folder in a new window; the original folder's branch, HEAD and
      uncommitted changes are byte-identical before and after. (FR-11, FR-12, FR-13, INV-9, INV-10)
- [ ] **Existing branch is never clobbered** — with `spec/SPEC-NNN` already checked out in a
      worktree, the command offers to open that folder; with the branch existing and not
      checked out, it proposes a suffixed name. (FR-12)
- [ ] **Refuses outside an opted-in folder** — in a folder with no `.minspec/`, neither the
      witness nor the command writes anything, and the command shows the refusal. (FR-11, INV-3)
- [ ] **No network** — the witness module, the command and the hook contain no network call
      and no `git fetch`/`pull`/`push` (static check). (INV-1)
- [ ] **Status bar never claims ownership** — the strings "owned" and "yours" do not appear
      in the checkout segment or its tooltip in any state. (FR-14, INV-4)
- [ ] **No dirty switch by MinSpec** — the inventory test fails when a HEAD-moving git call is
      added without the dirty check and the token. (FR-15)
- [ ] **Rules shipped** — after a harness refresh, the generated agent instructions carry the
      five rules, with rule 5 in its code-only form. (FR-16)

## Invariants (must not break)

- **INV-1 (offline).** No network call, and no git command that contacts a remote, from the
  witness, the command, or the hook. (Constitution invariant 1.)
- **INV-2 (the witness is read-only).** The witness and the hook never run a git command that
  changes the repository, the index, the stash or the working tree. Their only writes are
  window memory, workspace state, the output channel, and (hook) one record under the
  per-worktree git directory.
- **INV-3 (opt-in).** Nothing here runs, writes or scaffolds in a folder without the
  `.minspec/` marker, and nothing here creates that marker. (Constitution invariant 3; SPEC-096.)
- **INV-4 (no claim beyond the evidence).** No text asserts that another session made a move,
  or that this session owns a folder. `peer-here` is worded as presence.
- **INV-5 (unknown is not fine).** A failed observation or an unanswerable ancestry question
  is shown as such. No error path resolves to the normal state. (Constitution invariant 2.)
- **INV-6 (solo silence).** A single session committing, and any move carrying a
  `self-token`, raises no notification.
- **INV-7 (linked worktrees).** Behaviour is identical in a primary checkout and a linked
  worktree; no path is built by assuming `.git` is a directory.
- **INV-8 (nothing duplicated).** No second presence store, no new timer, no second
  worktree-creating session command.
- **INV-9 (uncommitted work is never moved).** No requirement here stashes, discards,
  carries or commits the person's changes.
- **INV-10 (the shared folder's HEAD is not moved).** "New Isolated Session" leaves the HEAD
  of the folder it was run from untouched; DR-051 §4a and the single DR-065 exception stand
  unchanged.

## Decisions needed (Clarify)

Each question carries a recommendation and what the recommendation costs. The requirements
above are written under the recommended option in every case. No human has chosen these:
they are an agent's recommendations, and approving this spec is what ratifies them.

### DQ-1 — How loud is a move with no evidence of another actor?

The window cannot tell a switch you made from the source-control view from one an agent made
in another tab.

- **A — loud on evidence only (rec).** Notification when a peer is present **or** the tree is
  dirty; status bar only when the tree is clean and no peer is seen (the FR-6 table).
  *Cost:* an actor presence cannot see, switching a clean folder, raises only the status-bar
  state — a person not looking at the status bar learns of it late. Nothing uncommitted is at
  risk in that case; the residual risk is the next commit landing on the wrong branch, which
  FR-10 covers for the agent.
- **B — always loud**, the issue's literal ask. *Cost:* a notification every time the person
  switches branch themselves; a warning that fires on normal use is a warning people learn
  to dismiss, which removes it for the real case.
- **C — loud only when a peer is present.** *Cost:* silent in the most common real setup
  (several agent tabs in one window, one presence record), which is the setup #168 describes.

### DQ-2 — Where the isolated folder is created

- **A — beside the repository (rec):** `<parent>/<repo>.worktrees/<name>`, with a setting to
  override. Matches the issue's "sibling folder". *Cost:* it is a write outside the repository
  root, made on an explicit command with the path shown first; and where only the repository
  itself is mounted into a container, a sibling path lands on container-local storage that a
  container rebuild discards. The confirmation cannot detect that in general.
- **B — inside the repository:** `.minspec/worktrees/<name>`, git-ignored. Survives any mount
  layout and stays inside the opted-in folder. *Cost:* a full nested copy of the project
  inside the workspace — search, file watchers and language servers index it twice unless
  each is told not to, and the person sees the project inside itself.
- **C — `~/code/.worktrees/<repo>/<name>`,** the literal path in SPEC-026 FR-9. *Cost:* it is
  one machine's layout; an adopter has no `~/code`.

### DQ-3 — Does the agent-facing witness ship in this spec?

- **A — yes, FR-10 as written (rec).** *Cost:* a second implementation in shell, held to the
  TypeScript one by a parity fixture — a standing two-place edit — and one more scaffolded
  hook in the harness-refresh family.
- **B — defer to a follow-up spec.** *Cost:* the detection ships reaching only the human; the
  agent, which is the actor that commits onto the wrong branch, is not told.

### DQ-4 — Command title, and how SPEC-026 FR-9 is reconciled

SPEC-026 (approved; its approval is bound to its text) names the command "MinSpec: New
Session Worktree" with a free-form name.

- **A — title "MinSpec: New Isolated Session", and a one-line pointer added to SPEC-026 FR-9
  at Plan (rec).** Plain language for a person who does not know what a worktree is
  (constitution goal G-8, git transparency). *Cost:* editing SPEC-026 voids its approval and
  needs a re-approval read of that one line.
- **B — keep SPEC-026's title; this spec only adds the spec-tied defaults.** *Cost:* the
  command a non-git user most needs is named with the one git term they are least likely to
  know.
- **C — leave SPEC-026 untouched and record the divergence only here.** *Cost:* two approved
  specs name one command differently; the next reader has to work out which governs.

### DQ-5 — The "owned by this session" label

- **A — never shown; the states are shared / isolated / main folder (rec, FR-14).**
  *Cost:* the reassuring label the issue asks for is absent; "isolated" says how the folder
  was made, not that nobody else is in it.
- **B — show "owned by this session" when no peer is reported.** *Cost:* it is false whenever
  an actor presence cannot see is in the folder — the exact case this spec exists for.

## Why no new DR

The issue suggests a decision record for "worktree-per-spec". The direction — code isolates
in worktrees, approvable documents stay on the default branch — is already decided and in
force in DR-051 §1, with its enforcement in §4 and its one exception in DR-065. This spec
adds a naming default (`spec/SPEC-NNN`), a folder location and an advisory witness. Each is
a default or a read-only observer, changeable in well under a day with no data migration, so
none passes the irreversibility filter for a new record. If DQ-2 or DQ-4 is answered in a way
that contradicts DR-051 or SPEC-026, that answer is the point at which a record or an
amendment becomes due, and the Plan phase must raise it before building.

## Costly to Refactor

1. **Branch and folder naming defaults** (`spec/SPEC-NNN`, `session/<name>`). Once people
   have folders and pushed branches under a scheme, changing it leaves the old ones behind.
   Hold both prefixes as named constants; any reader must tolerate branches that follow
   neither.
2. **The hook's per-session record location** under the git directory. A later move orphans
   existing records; they are disposable, so the cost is one missed comparison per session.
3. **The classifier's class names** — they appear in the parity fixture and the output
   channel. Add freely; rename with the fixture.

## Out of Scope

- **Undoing or preventing a switch made outside MinSpec.** Git offers no veto; the
  auto-revert is SPEC-026 FR-15.
- **Building SPEC-026's unbuilt layers** (status-bar count, pre-commit backstop, session
  trailer, `post-checkout` hook). They remain SPEC-026's. Layer A here is deliberately
  independent of them so it can ship first.
- **Carrying uncommitted changes into the new folder.** SPEC-052 (push work via branch).
- **Removing isolated folders when work is done.** Listing them is in FR-14; cleanup is a
  separate feature surface (see Follow-ups).
- **Fetching before branching.** A network call needs consent; not added here.
- **Installing dependencies in the new folder.** The new window opens on a checkout with no
  installed packages; the confirmation says so in one line and does nothing about it.
- **Inter-session negotiation.** SPEC-027 (inter-session comms).
- **Amending this repository's own `CLAUDE.md`** with the five rules ahead of the feature.
  The dev-time hook already prints the core rule at session start
  (`scripts/hooks/session-start.sh:52`); the product path is FR-16.

## Alternatives considered and rejected

- **Attribute the move by window focus or recency** ("you were typing here two seconds ago,
  so it was you"). A heuristic about who acted, presented as fact, in a product whose claim is
  that its signposts are right. Rejected for the three evidence states of FR-5.
- **Have the mover's hook write an attribution log the witness reads.** Would upgrade
  `none` to a named actor, but depends on the very hook whose absence this spec is the second
  witness for. Left as a later enrichment once SPEC-026 FR-15 exists; the witness must stay
  correct without it.
- **Offer to stash before a switch** (the issue's "warn/offer-stash"). The stash is shared
  across all worktrees of a repository, so it is one more shared mutable thing for concurrent
  sessions to collide on. Rejected (FR-15).
- **Block the agent's `git commit` when the branch moved** (a PreToolUse gate). That is
  enforcement, not detection, with its own false-block cost; it belongs with SPEC-026's hard
  backstop, not in an advisory witness.
- **Fold all of this into SPEC-026.** SPEC-026 is approved and T4; widening it voids its
  approval for content that is separable and can ship before SPEC-026's hook layer.
- **A lock file naming the owning session** (the issue's "lockfile"). SPEC-026 already
  rejected a separate lock store in favour of the presence heartbeat (its INV-14); this spec
  reuses presence and adds no store (INV-8).

## Follow-ups to file

This dispatch may not create issues. Each line below needs one, so that it is not a
prose-only consequence:

- The auto-classify watcher pattern at `packages/minspec/src/extension.ts:715-717` likely
  never fires in a linked worktree (FR-9 note; unverified by execution).
- Whether `reset --hard`, `rebase`, `merge` and `pull` reach SPEC-026 FR-15's `post-checkout`
  hook — measure, and record the answer in SPEC-026's plan.
- Cleanup of finished isolated-session folders (a `git worktree remove` flow with a
  nothing-unlanded check).
- The dev-time `scripts/hooks/session-start.sh:27-52` keeps one branch record per folder, not
  per session; replace it with the FR-10 hook once that ships.

## Traceability

- **Triggered by:** [#168](https://github.com/AIClarityAU/minspec/issues/168).
- **Depends on:** SPEC-026 (session presence) — the built presence layer, FR-1 to FR-7.
- **Refines:** SPEC-026 FR-9 (the worktree command and the etiquette block), without editing
  SPEC-026 in this change (DQ-4).
- **Rests on:** DR-051 (artifact-class branch policy), DR-065 (sanctioned shared-checkout
  fast-forward), DR-046 (dispatch worktree isolation), DR-073 (Claude Code hook stack).
- **Serves:** constitution goal G-8 (git transparency) and invariant 2 (no single-producer
  witness).
- **Spec id:** SPEC-120 is one above the highest spec directory visible on any
  remote-tracking ref in this checkout (SPEC-119) at authoring time. Open pull requests this
  checkout has not fetched are invisible from here; if the spec-id collision check reports a
  clash, renumber.
