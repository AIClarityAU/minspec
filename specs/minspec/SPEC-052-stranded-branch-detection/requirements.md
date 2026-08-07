---
id: SPEC-052
title: Detect a shared checkout's protected branch sitting ahead of its pushed upstream — an independent second witness to the #1064/#1115 commit-time guard
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-08-07
epic: EPIC-009  # Team Readiness — session coordination / git transparency (G-8), sibling of DR-080 and SPEC-026
relates_to: [DR-080, SPEC-050, SPEC-026, DR-051, DR-046, DR-065, DR-066, SPEC-032]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Detect a protected-branch checkout ahead of its pushed upstream (Requirements)

> Materializes **[#1021](https://github.com/AIClarityAU/minspec/issues/1021)** ("commitOnApprove
> commits the approval to local main but never pushes — 4th stranded approval today").
> Serves constitution goal **[G-8 — git transparency](../../../.minspec/constitution.md#L47)**
> and is a direct application of **invariant #2 — no silent gate / no single disableable
> witness** (this repo's CLAUDE.md): the prevention mechanism this spec backstops is exactly
> one commit-time guard: if it is absent, stale, or bypassed, nothing else today notices.

## One-Sentence Scope

When a MinSpec-managed checkout's **protected default branch** carries one or more local
commits its remote does not have — for **any** reason, not only a refused approval commit —
detect this automatically (at extension activation and on the existing session-presence
heartbeat) and surface it as a persistent, actionable advisory offering the same
rule-#8-safe "push a new branch at this SHA" recovery already shipped for the commit-time
refusal path, instead of relying on a human noticing `git status` or running `/wrapup`.

## Context

Grounded in the current code, with `file:line` evidence.

- **The literal instance #1021 reports is already fixed going forward.** At the time this
  issue was filed (2026-07-27), `commitApproval` committed straight to local `main` with no
  refusal and no push. That specific defect closed with **[#1064](https://github.com/AIClarityAU/minspec/issues/1064)**
  (`d1d97eff`, `683ef335`, `43c6f1ed`): [`resolveBranchDestination`](../../../packages/minspec/src/lib/approve-commit.ts#L307)
  runs **before any `git add`** ([approve-commit.ts:210-216](../../../packages/minspec/src/lib/approve-commit.ts#L210))
  and a commit onto the resolved protected default now returns `'protected-branch'`,
  **staging nothing**. The follow-up **[#1115](https://github.com/AIClarityAU/minspec/issues/1115)**
  / **[DR-080](../../../docs/decisions/DR-080.md)** (merged `58c2339`, PR #1255, 2026-08-06)
  then wired that refusal to automatic, consent-gated recovery —
  [`recoverProtectedBranchApproval`](../../../packages/minspec/src/lib/approval-recover.ts#L152)
  commits the approval into a **throwaway worktree** off `origin/<default>` and pushes it,
  never touching the primary checkout's HEAD or index (INV-1 there). Both are on `main` in
  this worktree today (`git log --oneline -- approval-recover.ts` → `58c2339`,
  `merge-base HEAD origin/main` = HEAD). **This spec does not re-fix that path — it is fixed.**

- **The fix is exactly one producer.** Every mechanism above lives on ONE path: the
  extension's `commitApprovalIfEnabled` (Alt+A / Accept ADR / Accept Epic), mirrored by
  the `.githooks/pre-commit` shell hook for terminal/agent commits
  ([`approve-commit-hook-parity.test.ts`](../../../packages/minspec/tests/approve-commit-hook-parity.test.ts)
  is the binding contract that keeps the two in sync). Per this repo's own constitution
  invariant #2 ("no required check hinges on a single producer that one permission/config
  gap can disable — provide an independent second witness"), a guard that only ever runs
  through one producer is exactly the shape that invariant warns about, and this repo has
  concrete, evidenced ways that producer goes missing on a given checkout without anyone
  choosing it:
  - **A stale installed build.** Project memory records the installed extension is a
    **frozen snapshot** — rebuilding requires an explicit package+install+reload
    (`project_extension_local_install`). A developer on a pre-#1064/#1115 build still hits
    the *original* bug, unaware a fix exists.
  - **An un-refreshed or never-installed hook.** `.githooks` is wired via `core.hooksPath`,
    set by `npm install`'s `prepare` script (`CLAUDE.md` Pre-Commit Checks). A fresh clone
    before the first `npm install`, or any commit path that runs outside VS Code
    *and* outside that hook (a raw terminal `git commit`, an agent shelling `git` directly),
    is unguarded until it runs.
  - **The documented bypasses, used deliberately or by habit.** `MINSPEC_GATE_OFF=1`,
    `MINSPEC_ALLOW_MAIN=1`, `minspec.allowCommitOnDefaultBranch=true`
    ([approve-commit.ts:313-315](../../../packages/minspec/src/lib/approve-commit.ts#L313)) —
    sanctioned escape hatches, but each one silently disables the ONLY witness that would
    otherwise catch a resulting stranding.

  In every one of these cases the *outcome* is identical to #1021's original report — a
  real, committed change sitting on a shared checkout's protected branch, invisible to CI,
  to the DAG, and to every other checkout, until a human happens to run `/wrapup` or type
  `git status` (exactly how #1021 itself was found, per its own "Filed during a `/wrapup`"
  footer). **That discovery path is not automatic — it is a human noticing.**

- **No existing spec covers this state.** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md)
  is explicitly read-only over `origin/*` — it discovers *remote* branches nobody merged; a
  local-only commit that was never pushed to any branch has no remote presence for it to
  find (SPEC-032 Context, "invisible to every local- or worktree-based scan" runs the
  opposite direction: it's about branches *only* on `origin`). [SPEC-026](../SPEC-026-session-presence/requirements.md)
  (session presence) tracks *who is sitting in* a checkout, not the checkout's ahead/behind
  state. [DR-080](../../../docs/decisions/DR-080.md) fixed the *producer*; nothing fixes the
  *absence of a witness* when that producer didn't run.

- **The rule-#8-safe recovery pattern already exists and is already documented as safe for
  exactly this "commit already exists locally" shape** — this spec does not need to invent
  one. [`approve-push.ts`](../../../packages/minspec/src/lib/approve-push.ts#L20-L26)'s
  `push-new-branch` plan creates a branch **at the same SHA** and pushes it, leaving the
  working checkout's HEAD untouched by construction (no `reset`/`rebase`/`checkout`), with
  the leftover local commit's eventual reconciliation explicitly called out: *"the leftover
  local commit is identical in content, so a later `git pull --rebase` drops it by patch-id
  without conflict."* This spec reuses that plan kind; it does not design a new one.

**Core gap (one sentence):** the only thing standing between "a commit lands unpushed on a
shared checkout's protected branch" and "nobody notices for hours" is a single commit-time
guard and a human's habit of running `/wrapup` — and this repo's own constitution says a
required signal must never rest on one producer alone.

## Functional Requirements

- **FR-1 (detection probe).** A pure, injectable-git-runner function — mirroring
  `resolveBranchDestination`'s style and fail-open contract — that: (a) resolves the current
  branch and the protected default the same way `resolveBranchDestination` does (reused, not
  re-derived, so the two never disagree on *which* branch is protected); (b) when they match,
  counts commits ahead of the configured upstream (`rev-list --count @{u}..HEAD`), or against
  `origin/<default>` when no upstream is configured at all; (c) returns the count plus the
  leading commits' short SHA + subject (bounded to 5), or a "no signal" result when the
  branch is not protected, has no commits ahead, or the probe cannot determine an answer.
- **FR-2 (independent from the commit-time guard — INV-4).** The probe re-reads git state
  itself; it must NOT be implemented as "check whether the last `resolveBranchDestination`
  call refused something," because that would make it a second read of the SAME producer's
  output rather than a second witness. It runs whether or not `commitApprovalIfEnabled` ran
  at all in this session.
- **FR-3 (trigger points).** Runs (a) once on extension `activate()`
  ([extension.ts:60](../../../packages/minspec/src/extension.ts#L60)), and (b) on each
  existing SPEC-026 presence heartbeat tick, so a commit landing mid-session — from a
  terminal, another tool, or a bypass — is caught without requiring a window reload.
  Read-only; never delays or blocks activation (fails open, exactly like
  `resolveBranchDestination`).
- **FR-4 (persistent, actionable advisory).** When ahead-count > 0 on the protected branch,
  show a **non-auto-dismissing** (but non-modal — matches the project's stated non-modal
  toast preference) notification naming the branch, the count, and the leading commit
  subject(s). This is deliberately not a single toast that scrolls away unread: the failure
  mode this spec exists to close is exactly "the signal existed but nobody saw it."
- **FR-5 (recovery action, reusing the shipped pattern).** The advisory offers a "Save on a
  branch and push" action that runs `approve-push.ts`'s existing `push-new-branch` plan
  against the current HEAD — create a branch **at the current SHA**, push it, touch nothing
  else in the primary checkout. Gated on `minspec.pushOnApprove` exactly as every other
  approval-push surface: `never` ⇒ the advisory still appears (this is a visibility feature,
  not a push feature) but no git/network call is offered, only the count and how to push it
  by hand; `prompt` ⇒ the click is the consent; `always` ⇒ the standing setting is the
  consent (DR-071 condition 1 — no new consent surface is introduced).
- **FR-6 (not limited to approval commits).** The probe inspects **any** commit(s) ahead, not
  only ones matching an approval-commit message pattern (`chore(approve): …`). A stale
  build or a bypassed hook can strand a commit that has nothing to do with Alt+A — scoping
  detection to "looks like an approval" would under-detect the exact class FR-2/Context
  describes.
- **FR-7 (idempotent, not nagging).** Once shown for a given HEAD SHA in a session, do not
  re-show for that same SHA (track last-notified SHA per workspace). Re-show if the
  ahead-count changes (new commits piled on top) or the SHA otherwise moves, and again on the
  next session/activation — matching this project's "one-time prompt, not a repeat nag"
  convention (`feedback_one_time_prompt_is_feature_tour`), while never letting an unresolved
  stranding go permanently silent just because it was seen once.

## Invariants

- **INV-1 (never moves the shared checkout's HEAD — rule #8 / DR-051 §4a / DR-046 / DR-065).**
  No `checkout`, `switch`, `merge`, `rebase`, or `reset` runs anywhere in this feature. The
  recovery action only creates and pushes a **new** ref at the existing SHA; the primary's
  HEAD and index are never written. DR-065's presence-gated fast-forward is not invoked and
  not needed — nothing here moves an *existing* ref.
- **INV-2 (detection is unconditionally safe; the network step alone is consent-gated).**
  `rev-list --count @{u}..HEAD` and the branch-resolution reads are local-only — no network,
  ever — so FR-1/FR-3's probe runs regardless of `minspec.pushOnApprove`. Only FR-5's push
  is gated (constitution invariant #1).
  ### Decisions needed (Clarify)

  - **OQ-1 (does the recovery action ALSO auto-open a PR?).** `approval-recover.ts`
    deliberately stops at "pushed, here's the compare URL" pending SPEC-050's `approval-pr.ts`
    seam (`#1224`, still an unmerged draft per DR-080 §5's dated loan). Recommendation:
    mirror that precedent exactly — stop at the compare URL here too, rather than write a
    **fourth** copy of `gh pr create` logic ahead of #1224 landing. Trade-off: one more click
    for the developer versus one more duplicated PR-opening implementation to maintain and
    eventually retire. Needs the human's explicit sign-off because it's the third time this
    project has faced this exact fork (SPEC-050, DR-080, now here).
  - **OQ-2 (scope to the protected/default branch only — never a feature branch).** A
    developer's feature branch sitting ahead of its own remote is normal, unremarked WIP —
    none of MinSpec's business, and an advisory there would be pure noise contradicting the
    project's "avoid nagging" stance. The FRs above are written to fire ONLY when
    `current === default` (reusing `resolveBranchDestination`'s own match), never on any
    other branch. Recommendation: keep it that way — flagging for sign-off only because it
    is the one design choice that, if loosened later, would turn this into the kind of
    per-branch noise the project has previously rejected.
  - **OQ-3 (heartbeat cadence).** Reuse SPEC-026's existing presence-heartbeat interval
    as-is, or does a `git rev-list` probe need its own (likely less frequent) cadence?
    Recommendation: reuse SPEC-026's interval unless Plan-phase profiling shows the added
    I/O is measurable — avoids a second polling loop for one more check — but this needs
    confirmation against SPEC-026's own contract (its heartbeat may be documented elsewhere
    as read-nothing-from-disk beyond its own presence file, which this would add to).
  - **OQ-4 (does this belong in the VS Code extension only, or should the analogous gap on
    the *agent/CLI* side — e.g. a Claude Code `SessionStart` hook — be tracked too)?** This
    spec scopes strictly to `packages/minspec` (the editor surface); a comparable gap likely
    exists for headless/agent sessions operating on the same shared checkout, but that is a
    different product surface (`scripts/hooks/` or similar, not a VS Code extension) and
    per this repo's triage rule 3 ("detection ≠ integration … treat them as separate work
    items"), pulling it in here would be scope creep. Recommendation: file it as a separate
    issue if the human wants it tracked, rather than fold it into this spec's FRs.

- **INV-3 (never throws, never blocks).** A probe failure — git absent, corrupt repo,
  detached HEAD, no protected-branch match, no upstream and no `origin` — silently no-ops,
  exactly matching `resolveBranchDestination`'s fail-open contract (approve-commit.ts:36-37,
  "Unknown destination … FAILS OPEN — unchanged behaviour, never a block"). This is advisory,
  never a gate: it must never delay extension activation or the presence heartbeat's other
  work.
- **INV-4 (independent producer — constitution invariant #2).** The probe must not read its
  answer from, or be gated behind, the commit-time guard's own state (`resolveBranchDestination`
  may be *called* for its branch-matching logic, but the ahead/behind computation is a fresh
  git read every time this runs, never cached from or dependent on whether a
  `commitApprovalIfEnabled` call happened in this session).
- **INV-5 (never mints or edits an approval record).** This feature transports whatever
  commit already exists at HEAD; it never writes `status:`, a sidecar, or `approvedBy`
  (DR-012), matching every other push-adjacent module in this codebase (approval-recover.ts
  INV-3, approve-push.ts's contract).

## Out of scope (tracked elsewhere)

- **Auto-opening a PR for the recovered branch** — see OQ-1; deferred to the same #1224
  repayment event DR-080 named, not re-litigated here.
- **Any branch other than the resolved protected default** — see OQ-2; feature-branch WIP is
  explicitly not this spec's concern.
- **The commit-time guard itself** — already shipped (#1064, #1115/DR-080/PR #1255). This
  spec is additive, not a re-fix.
- **Remote/forgotten-branch discovery** — owned by [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) /
  [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md); this spec's subject (a
  commit that was never pushed anywhere) is the complementary, un-covered case.
- **An agent/CLI-side (non-VS-Code) equivalent detector** — see OQ-4; a separate issue if
  wanted, per the detection-≠-integration triage rule.

## Acceptance Criteria

- **AC-1 (FR-1, INV-3).** On a protected-default branch with N local commits not on
  `@{u}` (or `origin/<default>` with no upstream configured), the probe returns the count and
  up to 5 leading commit SHA+subjects; on any other branch, or with 0 commits ahead, or where
  git state cannot be resolved, it returns "no signal" — asserted against a stub git runner
  covering each branch of `resolveBranchDestination`'s own fail-open cases.
- **AC-2 (FR-3).** The probe runs once at `activate()` and again on each presence-heartbeat
  tick, asserted by a fake-timer test counting invocations, never blocking either path
  (activation completes / the heartbeat's other work runs even if the probe throws
  internally — INV-3).
- **AC-3 (FR-4, FR-7).** A nonzero ahead-count shows exactly one advisory per distinct SHA per
  session; the same SHA reseen on a later heartbeat tick does not re-show; a SHA that changes
  (more commits landed) does re-show.
- **AC-4 (FR-5, INV-1, INV-2).** With `pushOnApprove: always` or a `prompt` click, the
  recovery action runs `git branch <new> <sha>` + `git push origin <new>` (or the equivalent
  `push-new-branch` plan call) and **no** `checkout`/`switch`/`merge`/`rebase`/`reset` is ever
  invoked — asserted on the recorded runner argv, not by inspection. With `never`, the
  advisory still renders (visibility only) and the recorded runner argv contains zero network
  calls.
- **AC-5 (FR-6).** A fixture where the ahead commit's subject does NOT match `chore(approve):`
  still triggers the advisory — proves detection isn't approval-message-scoped.
- **AC-6 (FR-2, INV-4).** A test that calls the probe WITHOUT ever calling
  `commitApprovalIfEnabled` in the same process still detects a pre-existing ahead state —
  proves the two are independent producers, not one gated behind the other.
- **AC-7 (OQ-2's current default).** A feature branch (current ≠ resolved default) with
  commits ahead of its own upstream produces "no signal" — never an advisory — asserted
  explicitly so a future change cannot silently widen this into per-branch noise.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A third-plus polling loop (SPEC-026 heartbeat + this probe) adds measurable I/O on large repos | OQ-3 flags cadence for Plan-phase profiling before committing to "reuse the heartbeat as-is" |
| R2 | The advisory becomes visual noise if a developer intentionally works ahead of `@{u}` on a protected branch during a sanctioned bypass (`MINSPEC_ALLOW_MAIN=1`) | The advisory states the count and offers a fix, never blocks; FR-7 stops re-nagging once seen for that SHA |
| R3 | Detection logic drifts from the commit-time guard's own branch-resolution, disagreeing on which branch is "protected" | FR-1 explicitly reuses `resolveBranchDestination`'s resolution rather than re-implementing it, so the two cannot diverge on *that* question (only on the ahead-count question, which the guard never answers at all) |
| R4 | A THIRD copy of push-branch logic accumulates alongside `approve-push.ts` and `approval-recover.ts` | FR-5 explicitly reuses `approve-push.ts`'s `push-new-branch` plan rather than writing a new one; unlike DR-080 §5's dated loan (a genuinely new worktree-transport pattern), this is a straight call to existing code |

## Traceability

- **Issue:** [#1021](https://github.com/AIClarityAU/minspec/issues/1021) — this spec's
  trigger. Its literal reported instance (commit succeeds unpushed on local `main`) is
  already closed by #1064 + #1115/DR-080 (see Context); this spec is the residual
  independent-witness gap #1021 leaves open.
- **Prevention layer (already shipped, not touched here):** [#1064](https://github.com/AIClarityAU/minspec/issues/1064)
  (commit-time refusal), [#1115](https://github.com/AIClarityAU/minspec/issues/1115) /
  [DR-080](../../../docs/decisions/DR-080.md) / PR #1255 (auto-recovery on refusal).
- **Related, same family:** [#996](https://github.com/AIClarityAU/minspec/pull/996), [#874](https://github.com/AIClarityAU/minspec/issues/874)
  (stranding instances referenced in #1021's own body).
- **Complementary, not overlapping:** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) /
  [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md) (remote-branch discovery —
  the opposite direction), [SPEC-050](../SPEC-050-silent-approval-pr/requirements.md) (what
  happens once a push already occurred, not detection of a stranding).
- **Goal:** constitution [G-8](../../../.minspec/constitution.md#L47) — git transparency.
  Constitution invariant #2 — no single disableable producer/witness — is this spec's core
  rationale, cited directly in Context.
