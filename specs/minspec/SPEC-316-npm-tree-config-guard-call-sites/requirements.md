---
id: SPEC-316
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (the npm call sites live in its dispatch, remediation and drain scripts)
aspects: [security, npm, supply-chain, trust-boundary, dispatch, drain, remediation, fail-closed, no-silent-gate]
depends_on: []
relates_to: ["#3330", "#3329", "#3238", "#3224", "#3048", "#2691", "SPEC-285", "DR-105"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface, decided at Plan: `scripts/lib/provision-worktree-modules.sh`
  (split its tree check into a reusable function), `scripts/drain-inbox.sh`
  (`provision_run_dir_modules`), `scripts/dispatch-issue.sh` and `scripts/remediate-pr.sh`
  (agent tool allowlists, worktree provisioning), and tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-316: Decide, per site, where the npm tree-config guard applies, and apply it where it changes something

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3330](https://github.com/AIClarityAU/minspec/issues/3330). Nothing is built until this spec
> is approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> It extends the guard that PR #3329 (refuse tree-controlled npm config before remediation
> `npm ci`) added in `scripts/lib/provision-worktree-modules.sh:22-77`. No decision record: every
> choice here is a script change that can be reverted in under a day (the dispatch's decision-record filter: a record only for a choice
> that cannot be undone in a day).

## In plain terms

PR #3329 stopped one npm install from letting the checked-out tree steer npm. A committed
`.npmrc` (for example `git=<path>`) plus a git dependency in the lockfile made
`npm ci --offline --ignore-scripts` run a program the tree chose, and reach the network despite
`--offline` (measured with npm 10.9.9 by job sec-npm-1029, as quoted in #3329's comment block).
The guard refuses a tree `.npmrc` or `npm-shrinkwrap.json`, requires a v2+ lockfile whose
entries are all `https://registry.npmjs.org/` tarballs or in-tree workspace links, and passes
`--git=false`.

#3330 names three more places npm runs on a tree. This spec does not assume the guard belongs at
all three. The question at each site is: **does refusing tree npm config close anything that
the tree cannot already do some other way at that site?** Where the tree already chooses the
code that runs (a `package.json` `test` script), the guard is redundant and the real boundary is
the environment and the network, which SPEC-285 owns. Where the install is meant to run *no*
tree-chosen code, the guard matters.

## Findings per site (observed in this checkout, base `1b8bebe1`)

Line numbers drift; the issue's `dispatch-issue.sh:2511` and `drain-inbox.sh:891` are now the
lines below.

### Site A - dispatcher's post-agent gate checks (`scripts/dispatch-issue.sh:2716-2742`)

- Runs `npm test`, `npm run lint`, `npm run build`, `npm run validate` in the agent's worktree,
  each through `bash "$AGENT_LAUNCH_ENV"` (the environment allowlist, DR-105) under a timeout
  (`dispatch-issue.sh:2719`).
- The tree is agent-written. The comment at `dispatch-issue.sh:2711-2715` already says so: "an
  agent wrote, or could have rewritten, every script they run."
- npm reads a project `.npmrc` for `run-script` too (documented npm behaviour, e.g.
  `script-shell`, `node-options`; I believe this, not reproduced here). But anything a `.npmrc`
  can make `npm test` execute, the tree can already make it execute by editing the `test` script
  in `package.json`. **The guard adds no boundary here.** The residual - arbitrary code with
  open network during the gate run - is already recorded as out of the egress guard's scope
  (`dispatch-issue.sh:1989-1993`) and is SPEC-285's subject (sandbox container, D6 network
  egress).
- **Adjacent finding, not in the issue:** the dispatch worktree is never provisioned with
  `node_modules`. Nothing in `dispatch-issue.sh` calls `provision_worktree_modules` (grep for
  `provision` there returns only unrelated lines), and `ALLOWED_TOOLS` at
  `dispatch-issue.sh:1667` grants the agent `Bash(npm ci)`. So in a dispatch, the npm install
  that does happen is the agent's own, online, without `--ignore-scripts`, under whatever
  `.npmrc` the tree carries. That is site B's shape, in the dispatcher.

### Site B - the agent's own `npm ci` / `npm test` (remediation and dispatch)

- `ALLOWED_TOOLS` grants `Bash(npm ci)` and `Bash(npm test)` to the remediation agent
  (`scripts/remediate-pr.sh:787`) and to the dispatch agent (`dispatch-issue.sh:1667`). The
  agent is started through `$AGENT_LAUNCH_ENV`, so it holds no token; there is no network
  sandbox (SPEC-285 is `status: specifying`, not built).
- The guard cannot wrap these calls: the agent types the command. And as at site A, the agent
  can edit `package.json` scripts and run `npm test`, so a tree `.npmrc` gives it no extra code
  execution or network reach.
- What a guarded parent install *does* change: in remediation, `provision_worktree_modules`
  already installs `node_modules` before the agent starts (`remediate-pr.sh:1189`), so the
  agent's `npm ci` is unnecessary. Each agent `npm ci` re-runs the online, scripts-enabled
  install the guard exists to avoid, and `npm ci` deletes through a symlinked `node_modules`
  (#3224). Removing `Bash(npm ci)` from the agent and provisioning the dispatch worktree the
  remediation way makes the honest path offline and guarded. It does not stop a hostile agent
  (that one has `npm test`), and this spec says so rather than claiming otherwise.

### Site C - the drain's run-dir install (`scripts/drain-inbox.sh:882-940`)

- `provision_run_dir_modules` runs `npm ci --offline --ignore-scripts --no-audit --no-fund`
  (`drain-inbox.sh:903`) and then `npm run build --workspace=@aiclarity/shared`
  (`drain-inbox.sh:909`) in the run dir. Neither checks for a tree `.npmrc` or
  `npm-shrinkwrap.json`, vets the lockfile, or passes `--git=false`.
- **Neither runs through `$AGENT_LAUNCH_ENV`.** They run in the drain's own shell. The drain
  mints and holds a bot credential in its environment for its writes (`drain-inbox.sh:207`,
  `:2114-2117`); I believe it can be present when this function runs, unverified. So the
  issue's "impact is limited the same way as #3329 ... installs run in the scrubbed, token-free
  environment" **does not hold at site C.**
- The tree is `origin/main`, verified before use (`drain-inbox.sh:1014-1027`), and the drain
  already runs main's scripts with that same environment. So whoever can land arbitrary code on
  main already wins at site C, and the guard does not change that.
- What the guard *does* add: a `.npmrc` line or a lockfile `resolved` pointing at a git URL is
  a small, inconspicuous diff that a reviewer (human or AI) is likelier to pass than a script
  change. On main, it would execute a chosen program in a credentialed shell on the next drain
  cycle. Refusing it there costs one function call and fails visibly into the existing fallback
  (link a tree that has a runnable `tsx`, `drain-inbox.sh:919-940`).

## Functional requirements

- **FR-1 - One tree check, shared.** The tree checks in `provision_worktree_modules` (no
  `.npmrc`, no `npm-shrinkwrap.json`, a v2+ lockfile whose every entry is a
  `https://registry.npmjs.org/` tarball or an in-tree workspace link) become one function that
  both `provision_worktree_modules` and the drain call. There is no second copy of the jq
  predicate (a duplicated security predicate drifts; #358 is the precedent for one shared
  control). `provision_worktree_modules`' observable behaviour does not change.
- **FR-2 - Drain run dir guarded (site C).** Before `npm ci` in `provision_run_dir_modules`,
  the run dir passes the FR-1 check. On a refusal the install is skipped, the reason the check
  printed is printed under `[drain] WARNING:`, and the function continues to its existing
  fallback. The `npm ci` call adds `--git=false`. The `npm run build --workspace=@aiclarity/shared`
  step runs only after a guarded install succeeded (it already does; this must stay true).
- **FR-3 - Site C refusal is visible on every cycle it holds.** A refused run dir does not
  write the lockfile stamp, so the next cycle re-checks and re-warns; it never caches a pass.
- **FR-4 - Dispatch worktree provisioned (site A adjacent / site B).** Subject to
  [D1](#decisions-needed-clarify): `dispatch-issue.sh` calls `provision_worktree_modules` on
  the agent worktree before the agent starts, as `remediate-pr.sh:1189` does. A provisioning
  failure is handled the way remediation handles it (no agent is started; the issue is left for
  a human with a reason), never ignored.
- **FR-5 - Agent install removed (site B).** Subject to [D1](#decisions-needed-clarify):
  `Bash(npm ci)` is removed from `ALLOWED_TOOLS` in `dispatch-issue.sh` and `remediate-pr.sh`,
  and the prompts stop telling the agent to run it. `Bash(npm test)` and the other checks stay.
- **FR-6 - Site A recorded, not guarded.** The post-agent gate checks get no `.npmrc` refusal.
  The comment at `dispatch-issue.sh:2711-2715` gains one sentence naming why (the tree already
  chooses the command; the boundary is the environment allowlist and, when built, SPEC-285's
  sandbox), so the next reviewer does not re-file it.
- **FR-7 - No overclaim.** No comment, PR body or summary written for this work says the agent
  "cannot reach the network" or "cannot run tree code". It says what is true: the parent's
  installs are guarded; the agent's own commands are not sandboxed until SPEC-285.

## Acceptance criteria

- **AC-1** A run dir with a committed `.npmrc` (any content): `provision_run_dir_modules` does
  not run `npm ci`, prints a `[drain] WARNING:` line naming `.npmrc`, writes no stamp, and the
  fallback runs. Proven with a test whose stub `npm` records whether it was called, and a
  control (same fixture without `.npmrc`) where it is called.
- **AC-2** Same as AC-1 for `npm-shrinkwrap.json`, for a lockfile entry with
  `resolved: "git+ssh://..."`, for a link entry resolving outside the tree, and for a v1
  lockfile. Each case is a separate fixture so a fault in one branch of the check cannot hide
  behind another.
- **AC-3** The run dir's real `npm ci` call carries `--git=false` (asserted on the recorded argv
  of the stub, not by grepping script text).
- **AC-4** `provision_worktree_modules` passes its existing tests unchanged after FR-1.
- **AC-5** The FR-1 check is defined once: one test fails if a second copy of the lockfile
  predicate appears under `scripts/`.
- **AC-6** (if D1 = a) A dispatch with a worktree carrying `.npmrc` starts no agent and leaves
  a visible reason; `ALLOWED_TOOLS` in both scripts no longer contains `Bash(npm ci)`.
- **AC-7** The current main tree passes the FR-1 check (no `.npmrc` and no
  `npm-shrinkwrap.json` is tracked today; `git ls-files | grep -i npmrc` returned nothing at
  `1b8bebe1`), so turning the guard on at site C does not wedge the live drain.

## Invariants this must not break

- **Invariant 2 (no silent gate):** every refusal prints its reason; a missing `jq`, an
  unreadable lockfile or a parse error is a refusal, never a pass (the existing check already
  fails closed on jq's non-zero exit; FR-1 keeps that).
- **Invariant 3 (blast radius):** these are dev-time scripts of this repo; nothing here ships in
  the extension or touches another repo's config.
- **Invariant 1 (offline core):** unaffected - this is pipeline tooling, not the product. The
  change reduces network reach (`--git=false`, no agent online install), never adds any.
- **#3224:** no path introduced here installs through a symlinked `node_modules`.
- **The drain fallback stays fail-closed on `tsx`:** a refused install never fakes a runner
  (`drain-inbox.sh:875-877`).

## Out of scope

- Network isolation of the agent and of the gate checks - SPEC-285 (D6).
- Integrity of the shared npm cache that `--offline` installs read from. Any tree code run as
  the same user (site A, site B) can write to it; whether `npm ci` re-verifies cached content
  against the lockfile's `integrity` on read I believe is true, unverified. This needs its own
  look; see Follow-ups.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

**D1 - Site B: take `npm ci` away from the agents and provision the dispatch worktree in the
parent?**
- (a) **(rec)** Yes: FR-4 and FR-5. Every install becomes the parent's guarded, offline,
  scripts-off install. Cost: a dispatch whose branch needs a dependency not yet in the local
  npm cache (an agent adding a new package) now fails provisioning or the agent's tests,
  where today the agent's online `npm ci` fetched it; such issues will land on a human.
- (b) Leave the agents' `npm ci` and record the redundancy argument only. Cost: the honest path
  keeps running online, scripts-enabled installs steered by the tree, and the #3224 deletion
  hazard stays reachable.

**Recorded selection: Option (a),** yes, FR-4 and FR-5: the parent provisions the dispatch worktree and the agents lose `npm ci`. An agent session copied this document's (rec) option; no human chose this item.

**D2 - Site C: apply the guard to the drain's run dir?**
- (a) **(rec)** Yes: FR-2 and FR-3. Cost: a legitimate future `.npmrc` on main (say, to pin a
  registry mirror) would silently stop the drain's own install and send it to the link fallback
  every cycle until the check is changed; the warning makes it visible, but it is a wedge on a
  config change someone might reasonably want.
- (b) No: main is the trust root and the drain already runs main's scripts. Cost: a one-line
  `.npmrc` landing on main runs a chosen program in the drain's credentialed shell.

**Recorded selection: Option (a),** yes, FR-2 and FR-3: the guard applies to the drain's run dir. An agent session copied this document's (rec) option; no human chose this item.

**D3 - Site A: confirm "no guard, recorded why" (FR-6)?**
- (a) **(rec)** Confirm. Cost: none in code; it relies on SPEC-285 for the real boundary, which
  is not built.
- (b) Guard anyway, for uniformity. Cost: extra refusals that close nothing, and a reader may
  take the guard as a boundary it is not.

**Recorded selection: Option (a),** confirm "no guard, recorded why" at Site A (FR-6). An agent session copied this document's (rec) option; no human chose this item.

## Follow-ups (tracked)

- Shared npm cache integrity (Out of scope, second bullet): to be filed as an issue by the
  dispatcher or a human; this specify-only dispatch has no permission to file issues.
  Recorded here so it is not prose-only.
- Network sandbox for agents and gate checks: SPEC-285.
