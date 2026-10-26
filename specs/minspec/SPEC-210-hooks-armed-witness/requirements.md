---
id: SPEC-210
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a shared repo must carry; the scaffolded DR-037 hook harness is one of them
aspects: [git-hooks, core-hooksPath, secret-scanning, no-silent-gate, second-witness, harness, blast-radius, headless-clone]
depends_on: [DR-037, DR-066]
relates_to: ["#1863", "#1186", "#1620", "#1850", "#2671", "#1277", "#1809", SPEC-033]  # #1277 and #1809 have specs on unmerged branches only, so they are cited by issue
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-210: Witness that an adopter's git hooks are armed

Issue: [#1863](https://github.com/AIClarityAU/minspec/issues/1863) (the secret-scan hook is
absent, and prints nothing, in any clone never opened in VS Code). Design rests on
[DR-037](../../../docs/decisions/DR-037.md) (scaffold editor-independent git hooks, accepted)
and [DR-066](../../../docs/decisions/DR-066.md) (no silent gate). **Specify phase only.
Nothing here is built.** No new DR is proposed: every choice below can be reverted in under a
day (a scaffolded template plus a list entry). The id SPEC-210 is one above the highest
spec number seen across this checkout's remote refs (209, on an unmerged branch). Those refs may be stale, so a
collision has to be checked at review.

## In plain terms

MinSpec ships its git hooks (secret scan, spec checks, root-cause gate) into the repos that
adopt it, under `.minspec/hooks/`. Git only runs them if the local setting `core.hooksPath`
points there. That setting is not copied when a repo is cloned. Today the only thing that sets
it is the VS Code extension, when the folder is opened. A clone that is never opened in VS Code
(a CI checkout, an agent container committing headlessly, a plain terminal clone, a fresh
machine) has no hooks and **prints nothing**. A clean commit then looks like a passed gate.
The hook cannot warn about its own absence. So this spec adds **witnesses that run somewhere
other than the hook**, and fixes the two places where the existing path already fails quietly.

## What was measured (read from the code and local disk, 2026-10-18)

- `ensureHooksPath` (`packages/minspec/src/lib/scaffold.ts:986-1006`) is the **only**
  producer of `core.hooksPath` for adopters. It runs on init (`scaffold.ts:1626`) and refresh
  (`scaffold.ts:1846`), and it is **fail-quiet by design** (`catch {}` at `scaffold.ts:1003`).
  If the write fails, nothing is reported.
- If the current value differs from `.minspec/hooks`, `ensureHooksPath` **overwrites it**
  (`scaffold.ts:999-1001`). That includes a value another tool set on purpose (e.g. a
  hook manager's directory). This is noted as a limitation below and is outside this spec.
- The shipped guidance (`template-registry.ts:440-455`) already says that `core.hooksPath`
  "does **not** survive cloning". It tells the reader to run *MinSpec: Refresh Harness Files*,
  which is an editor action and cannot happen in a headless clone. `template-registry.ts:618-622`
  tells the reader to check `git config --local core.hooksPath` by hand. That is prose; nothing
  checks it.
- minspec's own repo has a session-start witness for this exact failure:
  `scripts/hooks/session-hooks-path.sh` (#2671), called from `scripts/hooks/session-start.sh:167`.
  **It is not shipped to adopters.** The only Claude Code hook MinSpec registers for adopters is
  the session-title hook (`scaffold.ts:912-919`, `claude-settings.ts:141`).
- The CI secret-scan workflow **is** already shipped to adopters (`template-registry.ts:2614-2625`,
  added for #1186). Its job reports the check context `gitleaks` (`.github/workflows/secret-scan.yml`,
  `jobs.gitleaks.name`). Both repos named in the issue have it **committed**
  (`~/code/voip-sms-inbox` at `6272f9c`, `~/code/memory-fabric` at `932c103`). The issue says
  "neither of these repos has an equivalent", which is stale on local disk. I have not checked
  whether those commits are on each origin's default branch, or whether the workflow has run
  there. That needs a network call, which this dispatch does not make.
- The ruleset advisor's required-check set (`ruleset-advisor.ts:80`, resolution at `:428-437`)
  includes `MinSpec SDD validation`, and adds `ai-review` / `ready-to-merge` / code-maturity
  contexts when they apply. It **never includes `gitleaks`**. So even an adopter who accepts
  every MinSpec offer ends up with a server-side secret witness that cannot block a merge.
- Both named repos have no root `package.json`. Both currently have
  `core.hooksPath = .minspec/hooks` locally, and both have `.minspec/hooks/pre-commit` (local
  disk, this machine). This matches the issue.
- I believe git deliberately gives a clone no way to install or enable hooks (a hook is
  arbitrary code, and auto-arming it on clone would run untrusted code). So no committed file
  can make the hooks arm themselves. This is unverified here. If it is wrong, FR-1's premise
  needs revisiting at Plan.

## Root cause

**Mechanism:** hook installation is a side effect of an editor action (the extension calling
`ensureHooksPath`), not something that holds in every clone. The producer also swallows its
own failure. **Missing gate:** nothing that runs in a headless clone checks that
`core.hooksPath` resolves to a directory holding an executable `pre-commit`. And the one
witness that does run there, CI's `gitleaks` job, is never offered as a required check. So a
red result cannot stop a merge.

## One-Sentence Scope

Ship adopters an armed-hooks witness that runs outside the hook (session start, CI), make the
existing producer report its own failure, and offer the shipped `gitleaks` CI job as a
required check, so an unarmed clone is visible before or at merge time and never reads as a
pass.

## Functional Requirements

- **FR-1 (post-condition, defined once).** "Hooks armed" means all of the following. (a)
  `git config core.hooksPath` resolves (relative to the work tree top level) to the repo's
  `.minspec/hooks`. (b) `.minspec/hooks/pre-commit` and `.minspec/hooks/commit-msg` exist and
  are executable. (c) `pre-commit` carries the MinSpec managed-region marker. One pure,
  offline predicate implements this. Every witness below calls it. None re-derives it.
- **FR-2 (session-start witness, shipped).** MinSpec scaffolds a Claude Code SessionStart hook
  under `.claude/hooks/` (a managed template, like session-title) and registers it in
  `.claude/settings.json` through the existing registration path. `.claude/settings.json` is
  committed, so a headless agent clone runs it with no editor involved. When FR-1 fails, it
  prints a visible warning on **every** session start. The warning names the hooks path it
  found (or `<unset>`), the gates that are absent (secret scan, spec frontmatter, root-cause),
  and the exact one-line command that arms them (`git config core.hooksPath .minspec/hooks`).
  It is never fatal to session start, and never silent when unarmed. When armed, it prints
  nothing. Whether it also *repairs* is Clarify D1.
- **FR-3 (opt-in boundary).** The witness does nothing, and exits 0, when the repo has no
  `.minspec/` at its root, or the directory is not a git work tree. It reads only local git
  config and local files. No network (invariant 1). It writes nothing unless D1 says so
  (invariant 3).
- **FR-4 (producer stops failing quietly).** `ensureHooksPath` keeps its contract that a
  failure never breaks init/refresh. But when the write fails, or FR-1 does not hold
  afterwards, it reports this through the extension's existing user-visible channel, naming
  the failure and the command from FR-2. A repo with no git stays a silent no-op: that case
  has nothing to arm.
- **FR-5 (in-editor witness).** On activation in an opted-in repo, the extension evaluates
  FR-1 after `ensureHooksPath`. If it still fails, the extension shows the same report as
  FR-4. This catches a `core.hooksPath` that another tool rewrote after MinSpec set it. It
  makes no network call and uses no modal (HITL UX: a non-modal toast).
- **FR-6 (server-side witness can gate).** The ruleset advisor offers `gitleaks` as a required
  check context **when** `.github/workflows/secret-scan.yml` is scaffolded in the repo. This
  follows the same scaffolded-workflow condition the advisor already uses for `ai-review` /
  `ready-to-merge`. It goes through the existing consented advisory pass (DR-050). The
  advisor may not apply it without the user's existing click, and may not add it where the
  workflow is absent: a required check that never reports wedges every merge. Whether
  existing adopters get a re-offer is Clarify D2.
- **FR-7 (shipped guidance tells the truth).** The Pre-Commit Checks template text
  (`template-registry.ts:440-455`, `:618-622`) is corrected in three ways. (a) It names
  headless clones and CI checkouts as unarmed by default. (b) It says the FR-2 witness will
  say so at session start, and gives the arming command, not only an editor command. (c) It
  states that the CI `gitleaks` job is the witness that still runs when the local hook does
  not. No claim is written that the code does not back (RCDD evidence rule).
- **FR-8 (minspec's own witness stays aligned).** minspec's in-repo
  `scripts/hooks/session-hooks-path.sh` (#2671) checks `.githooks`, not `.minspec/hooks`, and
  stays separate. Plan decides whether it reuses the FR-1 predicate. It must not be weakened.

## Acceptance criteria

Each is a behaviour test on a **real git fixture** (an actual `git init`/`git clone`, not a
mocked config read), run with a control that shows the check fails when the defect is put back.

- **AC-1.** Fresh `git clone` of a scaffolded repo with `core.hooksPath` unset → the FR-2 hook
  prints a warning naming `<unset>`, the absent gates and the arming command, and exits 0.
- **AC-2.** `core.hooksPath` set correctly but `pre-commit` not executable → warning names the
  non-executable file. Running the same fixture with the file executable produces no output.
- **AC-3.** `core.hooksPath` pointing at a different directory (absolute path to another
  checkout, or a foreign hook manager's directory) → warning names the value found.
- **AC-4.** Repo with no `.minspec/` → the hook prints nothing and changes nothing (byte
  compare of `.git/config` before and after).
- **AC-5.** `ensureHooksPath` with a git config write that fails (e.g. a read-only
  `.git/config`) → the failure is reported on the user-visible channel and init/refresh still
  completes.
- **AC-6.** Ruleset resolution with `secret-scan.yml` scaffolded includes `gitleaks`; without
  it, it does not. A mutation that drops the condition fails one of the two cases.
- **AC-7.** The rendered Pre-Commit Checks text contains no claim that the session witness or
  the `gitleaks` required-check offer exists unless the code paths for FR-2 and FR-6 exist.
  This is checked against the built template set, not against source text.
- **AC-8.** The SessionStart registration is idempotent. A second refresh adds no duplicate
  entry, and it keeps any user hooks already in `.claude/settings.json`.

## Invariants this must not break

- **Invariant 1 (offline core).** Every witness here reads local config and files only.
  FR-6 adds a context name to an advisory that already runs under DR-050 consent. It adds no
  new call.
- **Invariant 2 (no silent gate).** This spec exists for invariant 2. No witness swallows its own
  failure into silence. A failure to evaluate FR-1 is reported as "could not verify hooks", never
  as armed.
- **Invariant 3 (blast radius).** Everything is gated on `.minspec/` at the repo root. Nothing
  touches global or system git config (`--local` only, as today).
- **DR-037.** The hooks remain ordinary tracked files under `.minspec/hooks/`. This spec adds
  witnesses and changes no gate's behaviour.

## Limitations, stated plainly

- **No local witness can fire in a bare terminal clone that never runs Claude Code or VS
  Code.** In that case the first thing that sees the commit is CI's `gitleaks` job at
  push/PR time. The secret is then already in a pushed commit, which is too late to stop the
  leak but early enough to block the merge (once FR-6's offer is accepted). This spec narrows
  the silent window. It cannot close it. The issue's recommended "check inside the hook" is
  unreachable in exactly this case, as the issue itself says, and it is not specified.
- **A server-side witness only gates if the human accepts the required-check offer.** FR-6
  makes it offerable. It does not make it required.
- **`ensureHooksPath` overwrites a foreign `core.hooksPath`** (`scaffold.ts:999`). That is a
  co-existence problem with other hook managers (husky, lefthook, pre-commit). It is separate
  from the silent-absence defect and is not fixed here. FR-5/AC-3 at least make the conflict
  visible. It should be tracked as its own issue (see the agent summary; this dispatch cannot
  file issues).
- The in-flight spec for #1277 (worktree-local hooks path; it currently has a duplicate id on two
  unmerged branches) covers an absolute `core.hooksPath` shadowing worktree hooks in
  **minspec's own** repo. The FR-1 predicate will flag the adopter version of that shape
  (AC-3), but it does not change how worktrees resolve hooks.

## Decisions needed (Clarify)

2 of 3 decisions carry a recorded selection: an agent session recorded the option this
document already recommended, under the founder's standing instruction of 2026-10-26 (inbox
items in66/in67, relayed by the chief-of-staff proxy) to settle Clarify on the recommended
options. No human chose an individual option; they are ratified only by approval of this
spec. Still open, with no selection recorded: D2. That instruction is held outside this
repository (the founder's inbox, read by the chief-of-staff proxy), so a reader cannot check
it from here: treat each selection as the recommendation it restates until this spec is
approved. The frontmatter `clarify:` field is not edited here.

- **D1. Should the session-start witness repair as well as warn?**
  - **(a) Warn only (rec).** It matches the issue's recommendation ("assert the post-condition
    rather than adding another installer") and minspec's own #2671 witness, and a session
    start never writes git config. Cost: an agent container keeps committing unhooked until
    something acts on the warning. An agent usually does, a human reading scrollback may not.
  - (b) Warn and set `core.hooksPath` when it is unset (never overwrite a non-empty value).
    It closes the window for agent sessions immediately. Cost: a session start writes git config
    with no click. That is the same silent-side-effect installer shape the root cause names,
    one step earlier.
  **Recorded selection: Option (a), warn only.** Selected on its recommended option under
  the founder's standing instruction of 2026-10-26 (inbox items in66/in67, relayed by the
  chief-of-staff proxy).
- **D2. Should adopters who already ran the ruleset advisory be re-offered `gitleaks`?**
  - **(a) Re-offer once, on the next refresh, as a separately dismissible offer (rec).** The two
    repos in the issue get the gate without hand-editing a ruleset. Cost: one more toast for
    every existing adopter, including ones who deliberately leave secret scanning advisory.
  - (b) New inits only. No new prompt. Cost: every existing adopter, including both repos in
    the issue, keeps a non-gating CI witness until someone notices.
- **D3. Root `package.json` with a `prepare` script (the issue's alternative): rejected
  (rec).** Recorded so the reader can overturn it. It ties arming to someone running
  `npm install`, which CI and headless clones also skip (the same assumption, moved one step
  back), and it puts a Node manifest into non-Node adopter repos. Cost of rejecting: a Node
  adopter who always runs `npm install` would have been armed with no session-start hook at
  all.
  **Recorded selection: The root `package.json` `prepare` script stays rejected, as
  recommended.** Selected on its recommended option under the founder's standing instruction
  of 2026-10-26 (inbox items in66/in67, relayed by the chief-of-staff proxy).

## Alternatives considered

- **Check inside the hook** (the issue's first half). Unreachable when the hook is not wired,
  which is the case that matters. A hook that runs is wired by definition. Rejected as the
  primary witness.
- **`git config` include file committed to the repo.** I believe git ignores in-repo config for
  security reasons, and it must be activated through local config anyway (unverified). It does
  not change the analysis.
- **Fail the commit from CI.** CI cannot see local config. It can only re-scan content, which
  is what FR-6 makes required.

## Traceability

- Issue: #1863. Related: #1186 (warned path; adopter CI workflow shipped there), #1620/#1850
  (CI second witness for minspec), #2671 (minspec's session-start witness), #1277 (worktree-local hooks path).
- Decisions: DR-037 (hook harness), DR-066 (no silent gate), DR-050 (consented advisory pass
  FR-6 rides on). SPEC-033 owns the ruleset advisory. #1809's in-flight spec is the sibling
  secret-scanning settings advisory.
