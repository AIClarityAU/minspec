---
id: SPEC-026
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-026 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: [SPEC-022, SPEC-027, DR-037, DR-051, "#380", "#575"]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-026 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md) (decisions D-P1 to D-P10 are cited by
id); the contract is [requirements.md](requirements.md), which no task edits.

Layer 1 (presence, FR-1 to FR-4, FR-6, FR-7) is already built; design.md *What already
exists* lists where. These tasks build what is missing.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths outside requirements.md's *Files to modify* list are given
with their reason in design.md, *Files*.

Shared rules for every task:

- **T0 first.** Write the task's invariant tests before the code, and show them red against
  the pre-change code in the pull request body (INV-1 to INV-15, requirements.md).
- Hook tests run the **rendered template** (`renderManagedFile` of the registry entry, as
  `tests/pre-commit-protected-branch.test.ts` does) in a throwaway git repo under
  `os.tmpdir()`, never the repo's own `.minspec/hooks/` copy, which is stale (design.md,
  *Risks*).
- A hook function is tested alone by extracting the text between its
  `# >>> minspec:fn:<name> >>>` markers (design.md, *Contracts*) and running it under `sh`.
- Every new check has a negative control in the same test that shows it can go red.
- A live peer in a test is a record whose `pid` is a child process the test spawned and
  kills in `afterEach`; a dead peer uses a pid probed to return ESRCH, as
  `tests/presence-sync-parity.test.ts` does.
- Run the task's test file, then `npx vitest run` (CI runs vitest directly, never
  `npm test`), `npm run lint`, `npm run typecheck` and `npm run validate`.
- A task that edits `packages/minspec/src/lib/template-registry.ts` is review machinery: its
  pull request needs the founder's merge. Tasks 2 to 6 and 10 are such tasks.

## 1 - Presence groundwork in TypeScript (FR-10, FR-14, D-P5)

- [ ] **1.1** `packages/minspec/src/lib/presence.ts` - change `contendingLiveSessions` to
  return `{ path: string; peer: SessionPresenceRecord }[]`, one entry per contended path and
  peer (FR-10 shape); export `APPROVABLE_CORPUS_PREFIXES` and `isApprovableCorpusPath`
  (D-P5); export `isPathClaimed` so the parity test can name the rule it mirrors. Update the
  existing callers in `packages/minspec/tests/presence.test.ts`.
- [ ] **1.2** `packages/minspec/tests/helpers/presence-fixtures.ts` (new) - the golden
  fixture set FR-14 lists: live, stale heartbeat (121 s), stale by 1 s at the 120 s edge,
  dead pid, empty allowlist, same versus different `worktreeRoot`, covering versus
  non-covering path (exact, `dir/`, `dir/*`), a non-corpus path, and a corrupt record. Each
  fixture states its expected contender list. Exports a builder that writes the records into
  a temp `.minspec/sessions/` and spawns or reaps the pids.
- [ ] **1.3** `packages/minspec/tests/presence.test.ts` - run every fixture through
  `contendingLiveSessions`; tag the existing Layer 1 tests with their invariant ids (INV-2,
  INV-3, INV-4, INV-5, INV-6) and add any that are missing, so
  `grep -o 'INV-[0-9]*' packages/minspec/tests/presence*.test.ts` lists INV-1 to INV-6, INV-8
  and INV-10.
  *Done when:* the fixture cases pass, a mutant that drops the empty-allowlist skip fails
  INV-10, and the grep above lists the eight ids.

## 2 - The bash predicate and its parity test (FR-14, INV-13; machinery)

- [ ] **2.1** `packages/minspec/src/lib/template-registry.ts` - add to `PRE_COMMIT_HOOK`,
  after the existing stages and not yet called: the shell constants `STALE_SECS=120` and
  `HEARTBEAT_SECS=30` with a comment naming `presence.ts`; `minspec_iso_epoch` (GNU then BSD
  `date`, D-P4); and `minspec_cedit_contenders` (liveness, same tree, non-empty covering
  allowlist, corpus filter; no arbitration), each inside its `minspec:fn` markers. Paths are
  read line by line (D-P3); the coverage rule is design.md, *Coverage semantics*.
- [ ] **2.2** `packages/minspec/tests/presence-contention-parity.test.ts` (new) - for every
  fixture from 1.2, run TS `contendingLiveSessions` and the extracted bash
  `minspec_cedit_contenders` on the same directory and paths, and assert identical
  `(path, sessionId)` sets. Also assert the shell constants equal `STALE_SECS` and
  `HEARTBEAT_SECS`, and the shell corpus `case` list equals `APPROVABLE_CORPUS_PREFIXES`.
  The header states that parity covers file paths only (design.md, *Coverage semantics*) and
  excludes arbitration (FR-14).
  *Done when:* the test passes, and changing the shell threshold to 121, or dropping the
  `dir/*` branch, turns it red.

## 3 - Self-identity: the `prepare-commit-msg` trailer (FR-11, INV-12, D-P1; machinery)

- [ ] **3.1** `packages/minspec/src/lib/template-registry.ts` - add `minspec_self_session`
  to `PRE_COMMIT_HOOK` (in its markers); add `PREPARE_COMMIT_MSG_HOOK`, which carries a
  byte-identical copy of `minspec_self_session`, appends `MinSpec-Session: <id>` once (key
  built from `SESSION_TRAILER_KEY`), appends nothing when no id resolves, never duplicates
  an existing trailer, and honours `MINSPEC_TRAILER_OFF=1`. Register it in
  `MANAGED_REGION_TEMPLATES` as `prepare-commit-msg-hook` (`executable: true`,
  `#!/usr/bin/env sh` preamble), next to `commit-msg-hook`.
- [ ] **3.2** `packages/minspec/tests/prepare-commit-msg-hook.test.ts` (new) - in a temp
  repo: id from `MINSPEC_SESSION_ID`; id from `.minspec/session.json` when the env is unset;
  no id ⇒ message unchanged and exit 0; existing trailer ⇒ not duplicated; kill-switch ⇒
  unchanged; unreadable message file ⇒ exit 0. Assert the two `minspec_self_session` copies
  are identical text.
- [ ] **3.3** `packages/minspec/tests/dr037-hook-scaffolds.test.ts` - assert scaffolding
  writes `.minspec/hooks/prepare-commit-msg` executable, inside its managed markers, and that
  Refresh keeps a user edit outside the markers (CTR-4).
  *Done when:* all three pass.

## 4 - The contention backstop and arbitration (FR-8, FR-12, FR-13, FR-16; machinery)

- [ ] **4.1** **BLOCKED until the FR-13.1 amendment (#3332) is accepted** - do not start before then.
  `packages/minspec/src/lib/template-registry.ts` - add `minspec_cedit_gate` to
  `PRE_COMMIT_HOOK` and call it as `minspec_cedit_gate || exit 1` after the existing stages,
  per design.md *The pre-commit stanzas in outline*: kill-switch `MINSPEC_CEDIT_OFF`; the
  absent-or-empty sessions no-op with the FR-8 carve-out stated in a comment above it; self
  `startedAt` from self's own presence record (D-P2 - departs from FR-13.1's literal wording at
  requirements.md:350, see the D-P2 note and #3332); the total-order arbitration (FR-13.1);
  the null-self fallback that allows with a warning (FR-13.2); a rejection message naming the
  peer by scope, branch, pid, `lastSeen` and `startedAt`, with the FR-12 resolution text, the
  FR-16 copy-paste prompt inline, and the bypass; one `info:` line per record whose time it
  cannot parse (design.md, *Risks*).
- [ ] **4.2** `packages/minspec/tests/pre-commit-cedit-gate.test.ts` (new) - each case in a
  temp repo with real staged files:
  INV-7 (solo, and only self) ⇒ exit 0;
  INV-8 (only claimant stale, dead, or absent) ⇒ exit 0;
  INV-9 (two live records, same tree, overlapping allowlists): earlier `startedAt` exits 0
  and the later exits 1, run from both sides; **equal `startedAt`**: the lower `sessionId`
  exits 0 and the other 1;
  INV-10 (different tree, empty allowlist) ⇒ exit 0;
  INV-11 (no sessions dir; empty dir) ⇒ exit 0;
  INV-12 (malformed record, unparseable `lastSeen`, `MINSPEC_SESSION_ID` unset and no
  `session.json`) ⇒ exit 0; `MINSPEC_CEDIT_OFF=1` ⇒ exit 0;
  self-id under a shared pid: two records with the **same** pid, committing as one of them
  its own claimed file ⇒ exit 0 (acceptance criterion *Self-id survives shared ext-host PID*);
  a staged **delete** and a staged **rename** of a held file ⇒ exit 1 (D-P3);
  a non-corpus path claimed by a live peer ⇒ exit 0 (FR-12 P4);
  the rejection text contains the peer's scope and not its bare uuid alone (FR-16).
  *Done when:* every case passes, and removing the `sessionId` tie-break makes the
  equal-`startedAt` case exit 0 on both sides (red).

## 5 - Approvables commit on the default branch on the primary (FR-15.2, INV-15, D-P6; machinery)

- [ ] **5.1** `packages/minspec/src/lib/template-registry.ts` - factor Stage 0's decision
  into `minspec_default_branch_guarded` (Stage 0 calls it; every line pinned by the
  `.githooks` twin test stays in the template), then add `minspec_approvable_main_gate`,
  called as `minspec_approvable_main_gate || exit 1`: kill-switch
  `MINSPEC_APPROVABLE_MAIN_OFF`; linked worktree (top-level `.git` is a file) exempt; no
  corpus path staged ⇒ allow; staged set without a diff filter and with `--no-renames`
  (D-P3); default branch from `refs/remotes/origin/HEAD`, fallback `main`; detached or
  unresolvable ⇒ allow; current ≠ default ⇒ reject, with the worktree-and-pull-request
  advice when `minspec_default_branch_guarded` is true and "switch to the default branch"
  when it is not.
- [ ] **5.2** `packages/minspec/tests/pre-commit-approvable-main.test.ts` (new) - the four
  INV-15 cases (primary, approvable, non-default branch ⇒ 1; same set on the default branch
  in a repo with no remote ⇒ 0; code-only on a feature branch ⇒ 0; approvable in a linked
  worktree on a branch ⇒ 0), plus: a staged `git mv` of a spec off the default branch ⇒ 1;
  kill-switch ⇒ 0; the message names a worktree when the default branch is guarded and does
  not tell the user to commit on it.
- [ ] **5.3** `packages/minspec/tests/pre-commit-protected-branch.test.ts` - unchanged
  expectations must stay green after the factoring; add one case per opt-out
  (`MINSPEC_ALLOW_MAIN`, `minspec.allowCommitOnDefaultBranch`) asserting
  `minspec_default_branch_guarded` agrees with Stage 0.
  *Done when:* all pass and the `.githooks` twin test is green with `.githooks/` untouched.

## 6 - The `post-checkout` HEAD guard (FR-15.1, INV-7, INV-11, INV-12, D-P7; machinery)

- [ ] **6.1** `packages/minspec/src/lib/template-registry.ts` - add `POST_CHECKOUT_HOOK` and
  register it as `post-checkout-hook` (`executable: true`, `sh` preamble). Body per FR-15.1
  and the four rails of D-P7: primary checkout only; skip during rebase, merge, cherry-pick
  or revert; skip a zero `prev`; revert with `MINSPEC_HEADGUARD_OFF=1 git switch -`
  (fallback `git checkout -`). Agent context (`MINSPEC_SESSION_ID` set) reverts every
  branch switch; human context reverts only with a live same-tree peer and a non-empty
  `git status --porcelain`. Kill-switch `MINSPEC_HEADGUARD_OFF`. Messages give the
  `git worktree add` command (rule #8).
- [ ] **6.2** `packages/minspec/tests/post-checkout-hook.test.ts` (new) - agent context on
  the primary: `git switch other` ends back on the starting branch, and the hook ran once
  (a counter file proves no re-fire loop); agent context in a linked worktree: the switch
  stands; human context, no peer: stands; human, live peer, clean tree: stands; human, live
  peer, dirty tree: reverted, the dirty file intact; `git rebase` on the primary in agent
  context completes; no sessions dir in human context ⇒ no-op (INV-11); kill-switch ⇒ the
  switch stands.
- [ ] **6.3** `packages/minspec/tests/dr037-hook-scaffolds.test.ts` - the scaffold case
  from 3.3 for `post-checkout`.
  *Done when:* all pass.

## 7 - Status bar `👥 N` and tooltip (FR-5, INV-4, D-P8)

- [ ] **7.1** `packages/minspec/src/views/status-bar.ts` - pure exports
  `formatPresenceSuffix(n)` (empty string for 0, ` 👥 N` otherwise) and
  `formatPeerTooltipLine(peer, now)` in the FR-5 format
  `[scope] (project, type) — branch — last seen Xs ago`; `MinSpecNextTaskStatusBar` gains
  `setPeers(peers)`, which appends the suffix, extends the tooltip, and switches the click
  command to `minspec.showSessions` while N ≥ 1 and back to `minspec.nextTask` at 0.
- [ ] **7.2** `packages/minspec/src/extension.ts` - subscribe the next-task item to
  `presence.onDidChange`, calling `setPeers(presence.getActiveSessions())` at most once per
  10 s (trailing debounce, cleared on dispose).
- [ ] **7.3** `packages/minspec/tests/status-bar-presence.test.ts` (new) - INV-4 (zero peers ⇒
  no `👥`, command stays `minspec.nextTask`); one and three peers ⇒ suffix and one tooltip
  line each; the tooltip names scope, not uuid; the debounce coalesces five events in 10 s
  into one update (fake timers).
  *Done when:* passing; the acceptance criteria *Multi-session badge*, *Graceful close* and
  *Single-session silence* are checked at the unit level here and end to end in task 12.

## 8 - Sessions Quick Pick and the FR-16 actions (FR-5, FR-16)

- [ ] **8.1** `packages/minspec/src/commands/show-sessions.ts` (new) - `minspec.showSessions`:
  a Quick Pick with "Next task" first (runs `minspec.nextTask`), then one item per live peer
  labelled by scope, with project, type, branch, `worktreeRoot` and `startedAt` in the
  detail. Selecting a peer opens a second pick with **Copy resolution prompt** (writes the
  FR-16 text, naming self's scope, the peer's scope and branch, and the files both claim, to
  the clipboard) and **Reveal worktree** (opens `worktreeRoot` in a new window via
  `vscode.openFolder`). The prompt text is built by an exported pure function.
- [ ] **8.2** `packages/minspec/package.json` - contribute `minspec.showSessions` with title
  "MinSpec: Show Live Sessions" and a keybinding not already taken in `contributes.keybindings`;
  `packages/minspec/src/extension.ts` - register the command.
- [ ] **8.3** `packages/minspec/tests/show-sessions.test.ts` (new) - the prompt builder's
  output contains both scopes, the branch and every contended file, and no bare uuid; the
  pick items are ordered as specified; both actions are reachable by keyboard (Quick Pick
  items, no mouse-only control); the keybinding exists and is shown in the tooltip from 7.1.
  *Done when:* passing.

## 9 - New Session Worktree command and the steer toast (FR-9, D-P10)

- [ ] **9.1** `packages/minspec/src/commands/new-session-worktree.ts` (new) -
  `minspec.newSessionWorktree`: input box for the name, validated with
  `git check-ref-format --branch`; runs
  `git worktree add <home>/code/.worktrees/<repo>/<name> -b <name> <base>` (D-P10) without
  any repo script; on success offers to open the folder in a new window; on failure shows
  git's message. Also export `shouldOfferWorktree(peers, selfRoot)`: true iff some live peer
  shares this tree (`sameCheckout`) and its declared work includes a code path (empty
  allowlist, or a non-corpus entry, D-P5).
- [ ] **9.2** `packages/minspec/src/extension.ts` - on activation, and on the first
  `onDidChange` after it, if `shouldOfferWorktree` is true, show one non-modal toast
  "N other live session(s) share this working tree - open an isolated worktree?" with a
  **Create Worktree** button that runs the command; never runs it unasked; at most once per
  activation. `packages/minspec/package.json` - contribute the command, title
  "MinSpec: New Session Worktree", with a keybinding.
- [ ] **9.3** `packages/minspec/tests/new-session-worktree.test.ts` (new) -
  `shouldOfferWorktree`: approvables-only peer ⇒ false (DR-051), code-path peer ⇒ true,
  empty-allowlist peer ⇒ true, different-tree peer ⇒ false, dead peer ⇒ false; the command,
  run against a temp repo with an injected home directory, creates the worktree on a new
  branch at the expected path and two worktrees report distinct `worktreeRoot`s; an invalid
  name is refused before git runs.
  *Done when:* passing.

## 10 - CLAUDE.md "Concurrent-Session Etiquette" block (FR-9 soft binding; machinery)

- [ ] **10.1** `packages/minspec/src/lib/template-registry.ts` - add the block to
  `CLAUDE_MD_TEMPLATE`, after *Session Scope Protocol*, adapted from the draft text that was
  in design.md before this plan: how to read `.minspec/sessions/*.session.json` and judge a
  peer live (`lastSeen` under 120 s and `kill -0`); approvables claimed by a live same-tree
  peer are not edited; code edits with a live same-tree peer go in a worktree first; agents
  never move the primary checkout's HEAD; keep `fileAllowlist` honest; and, per D-P6, where
  approvables commit (the default branch on the primary when it is not push-protected,
  otherwise a worktree branch and a pull request).
- [ ] **10.2** `packages/minspec/tests/claude-md-etiquette.test.ts` (new) - the rendered
  CLAUDE.md contains the block once; the threshold it states equals `STALE_SECS`; every
  `MINSPEC_*_OFF` name it mentions exists in a hook template; it never tells the reader to
  commit an approvable on the default branch without the push-protected condition.
  *Done when:* passing.

## 11 - Edit-time contention advisory (FR-10, FR-16, D-P9)

- [ ] **11.1** `packages/minspec/src/lib/contention-advisory.ts` (new) - a pure
  `adviseOnEdit(state, repoRelPath, contenders)` returning the toast text or nothing, and the
  updated set of `(path, sessionId)` pairs already warned. Text names each peer by scope and
  branch and offers the FR-16 prompt.
- [ ] **11.2** `packages/minspec/src/extension.ts` - on a corpus document first going dirty,
  and on opening a corpus document, call `contendingLiveSessions` with self's
  `presence.sessionId` and show `adviseOnEdit`'s text as a non-modal warning with a
  **Copy resolution prompt** button. Never blocks the edit.
- [ ] **11.3** `packages/minspec/tests/contention-advisory.test.ts` (new) - one warning per
  `(path, peer)` per activation; a second peer on the same path warns again; a non-corpus
  path never warns; no contenders ⇒ nothing; text has scope, not a bare uuid.
  *Done when:* passing.

## 12 - Acceptance sweep (INV-1, INV-14, the acceptance criteria)

- [ ] **12.1** `packages/minspec/tests/session-guard-acceptance.test.ts` (new) - end to end
  in a temp repo with the rendered hooks installed via `core.hooksPath`: two
  `SessionPresenceManager` instances with fake timers see each other within one heartbeat
  and lose each other within one debounce after `stop()`; a record whose pid is killed is
  pruned and unseen by the next `getActiveSessions()` (crash recovery, within 125 s of fake
  time); concurrent clobber arbitration and sequential handoff through real `git commit`;
  after the whole run, `git status --porcelain` is empty under `.minspec/`, no
  `.minspec/locks/` exists, and the only new data on the commit objects is the
  `MinSpec-Session:` trailer (INV-1, INV-14). A static check that no guard path imports
  `http`, `https`, `net` or calls `fetch` (INV-5, INV-14).
- [ ] **12.2** Pull request body: a table mapping every acceptance criterion in
  requirements.md to the test case that checks it, and the two that only a person can check
  in a running editor (*Worktree-steer offered* within 35 s on a second window; the badge on
  two real windows), with the manual steps.
  *Done when:* the table has no criterion without a test or a stated manual step.
