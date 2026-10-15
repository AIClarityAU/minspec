---
id: SPEC-196
type: requirements
title: Drain git-sync backstop — sweep stranded docs-only commits on a shared checkout's main into a PR, and re-align a main whose local commits have already landed
status: specifying
tier: T3
product: minspec
# ownership (SPEC-038). Both implements: paths are NET-NEW. The sweep is a sourced helper
# beside the existing scripts/lib/docs-corpus.sh and governance-transition.sh it reuses, so
# drain-inbox.sh gains one call site rather than another few hundred lines. drain-inbox.sh
# itself is OWNED by SPEC-044 (its implements:), so it is listed under affects:, never here.
implements: [scripts/lib/stranded-main-sweep.sh, packages/minspec/tests/stranded-main-sweep.test.ts]
affects: [scripts/drain-inbox.sh]
epic: EPIC-009  # Team Readiness — shared-checkout coordination; sibling of DR-065's gated fast-forward and SPEC-057's extension-side detector
aspects: [drain, git-recovery, worktree, rule-8, session-coordination, docs-lane, pull-request, presence, no-silent-gate, blast-radius, tier-1]
relates_to: [SPEC-057, SPEC-062, SPEC-052, SPEC-050, SPEC-058, SPEC-039, SPEC-026, SPEC-044, DR-065, DR-051, DR-046, DR-061, DR-067, DR-080, DR-004, DR-003]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-196 — Drain git-sync backstop for stranded commits on a shared checkout's `main`

> **This is a SPECIFICATION ONLY.** No script, test or workflow is created by the dispatch
> that produced it. A human resolves **[Decisions needed (Clarify)](#decisions-needed-clarify)**
> and approves the spec through the normal gate before anything is built. The fast-align
> half (FR-5) also needs the **proposed DR-065 amendment** accepted first (see
> [DR note](#dr-note)) — it widens a recorded rule-#8 exception.

Materializes **[#809](https://github.com/AIClarityAU/minspec/issues/809)** — *"drain git-sync
guard — auto-sweep stranded primary-main commits into docs-lane PRs + safe fast-align"*. Rests
on **[DR-065](../../../docs/decisions/DR-065.md)** (the sole sanctioned exception to "never
move a shared HEAD"), which this spec proposes to amend, and on
**[DR-051](../../../docs/decisions/DR-051.md)** (approvables live on `main`).

## One-Sentence Scope

On each drain cycle, for each checkout of **this** repository that sits on `main` with local
commits `origin/main` lacks, the drain (a) pushes those commits to a new branch and opens a PR
when every one of them touches only the docs corpus — never moving HEAD or the working tree —
and (b) once their content has landed on `origin/main`, re-aligns that `main` to
`origin/main` under DR-065's dormancy guards plus a content-absorbed proof; anything else
(non-docs commits, unexplained dirt on a dormant checkout) is reported, never touched.

## Context (grounded, `file:line` against this worktree)

**The issue's Phase-1 premise has partly moved since it was filed (2026-07-16).** Per RCDD
the spec is written against today's code, not the issue's snapshot:

- **Approvals no longer strand by default.** `resolveBranchDestination`
  ([`approve-commit.ts:348`](../../../packages/minspec/src/lib/approve-commit.ts#L348)) runs
  before any `git add` and a commit onto the protected default returns `'protected-branch'`,
  staging nothing (#1064); `recoverProtectedBranchApproval`
  ([`approval-recover.ts:165`](../../../packages/minspec/src/lib/approval-recover.ts#L165),
  #1115 / [DR-080](../../../docs/decisions/DR-080.md)) commits into a throwaway worktree and
  pushes. [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md) Context records
  this and enumerates the producers that still strand: a **stale installed build**, a
  **never-installed hook** (fresh clone before `npm install`), and the **documented bypasses**
  (`MINSPEC_GATE_OFF=1`, `MINSPEC_ALLOW_MAIN=1`, `minspec.allowCommitOnDefaultBranch`). A raw
  terminal or agent `git commit` on `main` strands the same way.
- **Harness refresh still commits onto the current branch** and
  [SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md) D-1 (resolved 2026-08-14)
  decided its PR is **human-merged, never auto-merged**, because a refresh restages
  `.github/workflows/**` including `ai-review.yml` itself.
- **So the stranding rate is lower, not zero**, and SPEC-057 makes the same argument this
  spec does: constitution invariant 2 forbids a load-bearing outcome resting on one producer.
  SPEC-057 is the **extension-side, consent-gated** second witness (advisory + click). This
  spec is the **drain-side, unattended** backstop for the docs-only subset, and the
  reconcile step nothing owns.

**What the drain does today.** `sync_shared_checkouts`
([`scripts/drain-inbox.sh:646`](../../../scripts/drain-inbox.sh#L646), called every cycle at
[`:1356`](../../../scripts/drain-inbox.sh#L1356)) enumerates `git worktree list` of **this**
repository, fetches unconditionally, and `merge --ff-only`s a checkout only when DR-065's four
guards hold — G1 on `main`, G2 `status --porcelain` empty, G3 not presence-occupied, G4 a true
fast-forward. A checkout with **any** local commit fails G4 (`:676`, *"diverged (local
commits) ⇒ skip, never reset"*) and is skipped **every cycle forever**: the stranded commit is
never pushed, and once its content lands by some other route (a hand-opened lane PR, a
squash-merge) the checkout is still diverged by SHA, so it is never fast-forwarded again
either. That is the permanent-staleness shape DR-065 was written to remove, re-entered
through G4 instead of G2 (the G2 variant is the 2026-08-30 DR-065 amendment, #1167, still
`proposed` and — `grep REDUNDANT_DISCARD scripts/drain-inbox.sh` returns nothing —
unimplemented).

**The pieces this reuses rather than re-deriving:**

| Need | Existing single source | Never fork |
|---|---|---|
| "Is this path docs?" | `DOCS_CORPUS_RE` in [`scripts/lib/docs-corpus.sh`](../../../scripts/lib/docs-corpus.sh), lock-step with `docs-corpus.ts` and `docs-lane.yml:100` | The issue body's own regex is an older copy (no `skills/*.md`); use the library |
| "Will the lane refuse this?" | `GOVERNANCE_PATH_RE` / `STATUS_TRANSITION_RE` in [`scripts/lib/governance-transition.sh`](../../../scripts/lib/governance-transition.sh), already consumed by `push-docs.sh:134-142` | Same rule push-docs uses: a status transition ⇒ open **without** `docs-lane` |
| Bot identity for push / PR | [`scripts/lib/gh-bot.sh`](../../../scripts/lib/gh-bot.sh) (`gh_bot_init`) | Never the human's token |
| Dormancy | `checkout_occupied` (`drain-inbox.sh:584`), parity-tested against `isCheckoutOccupied` (`presence.ts:381`) | — |
| Running git in a listed worktree | `launcher_worktree_git` (#1203) | Never trust the tree's own `.git` file |

**Where this can run.** Only a host-side drain sees a primary checkout's local git state.
[SPEC-062](../SPEC-062-autonomous-pr-drain/requirements.md) D1 moved the *non-LLM PR steps*
to a GitHub Action; a runner has no access to a developer's primary checkout, so this step is
**host-drain only** by construction and runs wherever `sync_shared_checkouts` runs today.
Drain liveness (#773, "drain self-terminates rc 43") appears addressed by
`ensure_fresh_run_dir` (`drain-inbox.sh:1343-1346`, comment cites #773); the issue's state was
not checked from this offline dispatch.

## Scope

### In scope
- **Sweep** (FR-1 – FR-4): push stranded **docs-only** local commits on a checkout's `main` to
  a new remote branch and open (or adopt) a PR — no HEAD, index or working-tree change.
- **Absorbed fast-align** (FR-5): re-point a checkout's `main` at `origin/main` once every
  local commit's content is provably already on `origin/main` — gated by DR-065 G1–G3 plus a
  content-absorbed proof that replaces G4.
- **Report-only classes** (FR-6): non-docs stranded commits and unexplained dirt on a dormant
  checkout are reported, never acted on.

### Out of scope
- **Preventing strands** — #332, #430, #758, #763, #512 and the already-shipped #1064/#1115.
- **Extension-side detection / consent-gated recovery** — [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md).
- **Uncommitted non-docs work on a dirty primary** — [SPEC-052](../SPEC-052-push-work-via-branch/requirements.md)
  (its Follow-ups already name #809 as the complementary half).
- **Byte-identical redundant dirt blocking G2** — the DR-065 2026-08-30 amendment (#1167).
- **Auto-fixing dirty derived harness files** (issue Phase 3 item 2) — see **D2**; recommended
  out, for reasons stated there.
- **Any `--admin` merge.** The issue proposes `--admin` for machinery; SPEC-062 INV-2 forbids an
  unattended `--admin`, SPEC-058 D-1 keeps harness PRs human-merged, and this repo's merge
  funnel (CLAUDE.md, SPEC-044 FR-4b) reserves merge confirmation to one driver. Rejected, not
  deferred.
- **The Tier-0 extension doing any of this.** Dev-time drain tooling only (DR-004 Tier 1).

## Functional Requirements

- **FR-1 (classify each checkout, read-only first).** After `sync_shared_checkouts`' fetch,
  for each checkout it enumerates (same list, same `launcher_worktree_git`, same exclusion of
  the drain run-dir), the sweep computes, with no write: HEAD branch; the ahead set
  `origin/main..HEAD`; for each ahead commit its changed paths (`diff-tree --no-commit-id
  --name-only -r -m`, merges included); `status --porcelain`; and occupancy. A checkout not on
  `main` (G1), or with an empty ahead set, is ignored by FR-2 – FR-5. Any git error in this
  step ⇒ that checkout is skipped **and the error is logged naming the checkout and the
  command** — never treated as "nothing ahead" (constitution invariant 2; an empty result from
  a failed read is not absence).

- **FR-2 (sweep eligibility — all must hold).** A checkout's ahead set is swept only when:
  - **E1** every path of every ahead commit matches `DOCS_CORPUS_RE` (sourced, not copied);
  - **E2** the ahead set is non-empty and at most `MINSPEC_SWEEP_MAX_COMMITS` (default 20)
    commits — a larger set is reported (FR-6), on the theory that 20 unpushed commits on `main`
    is a situation a human should see, not a backlog a script should ship;
  - **E3** the newest ahead commit's committer date is older than a grace window
    (`MINSPEC_SWEEP_GRACE_MIN`, default per **D4**), so a session that just committed and is
    about to run its own recovery (SPEC-057 / approve-push) is not raced;
  - **E4** HEAD is **not already contained in any remote-tracking ref** (`git branch -r
    --contains HEAD` empty after the fetch). If it is, the commits are already on the remote:
    no push; FR-3's PR-adoption check still runs against that branch;
  - **E5** HEAD is **not content-absorbed** into `origin/main` (FR-5's predicate). If it is, the
    content already landed: skip the sweep and go to FR-5.

  Working-tree dirt does **not** block the sweep: it creates a ref and pushes it, touching
  neither index nor working tree. Occupancy does not block it either, subject to **D4**.

- **FR-3 (the sweep itself — refs only, idempotent, no overwrite).**
  1. Branch name is a pure function of the checkout and HEAD:
     `stranded/<checkout-basename>-<HEAD-sha12>`. Same HEAD ⇒ same name, so a re-run converges.
  2. Create it with `git branch <name> <HEAD>` — **never** `-f`, never `checkout`/`switch`. If the
     local name exists at a **different** SHA, stop and report (never overwrite a branch).
  3. Push with `git push origin <name>:refs/heads/<name>` — **never** `--force`/`+refspec`. If the
     remote name exists at a different SHA, git rejects it; that rejection is reported, not retried
     with force.
  4. Before opening a PR, look for an existing open PR whose head is that branch, **or** whose head
     commit is HEAD; adopt it if found (log, no second PR). Open at most one PR per HEAD SHA.
  5. Open the PR against `main` with the bot identity (`gh_bot_init`; assert a non-empty token
     before the first write — a failed mint must abort visibly, never fall through to the
     human's credential). Label `docs-lane` **unless** any ahead commit changes a `status:` line
     under `GOVERNANCE_PATH_RE` (the `push-docs.sh:134-142` rule): then open it **unlabelled**,
     because the lane would refuse it with a red check and spec approval / DR acceptance is a
     human merge (DR-029, DR-086 §2). The PR body lists each swept commit (short SHA + subject),
     the checkout it came from, and states that the checkout's `main` was not modified.
  6. The sweep never merges, never arms auto-merge itself, and never labels `ai-review:*` or
     `ready-to-merge`. Landing is the lane's (DR-061) or a human's job.

- **FR-4 (lane outcome is observed, not assumed).** The sweep records `{checkout, HEAD, branch,
  PR}` in the drain's run state so the next cycle can report "swept, awaiting merge" rather than
  re-deriving it. It never claims a PR "will auto-merge"; the PR's own checks are the witness.

- **FR-5 (absorbed fast-align — the guarded HEAD move).** A checkout's `main` is re-pointed at
  `origin/main` only when **all** hold, in this order, re-checked immediately before the write:
  - **A1 = DR-065 G1** on `main`;
  - **A2 = DR-065 G2** `status --porcelain` empty (tracked **and** untracked);
  - **A3 = DR-065 G3** `checkout_occupied` reports dormant (positive proof; empty/stale/corrupt
    presence ⇒ occupied ⇒ skip);
  - **A4 (replaces G4) content absorbed:** merging HEAD into `origin/main` would change nothing —
    the exact predicate is **D1**; the recommended form is `git merge-tree --write-tree
    origin/main HEAD` exits 0 with a tree id equal to `origin/main^{tree}`;
  - **A5 backup first:** `git update-ref refs/minspec/stranded-backup/<checkout-basename>/<HEAD-sha12>
    <HEAD>` succeeds **before** the move, so every local commit stays reachable after it (not
    only via reflog, which expires).

  The move is `git reset --keep origin/main` — `--keep`, not `--hard`, so a file that became
  dirty between the A2 check and the write makes git **abort** rather than discard it
  (TOCTOU narrowed by git itself). Observed on git 2.43.0 in a scratch repo while writing this
  spec: an untracked file the target would overwrite makes `reset --keep` exit 128 with the
  file's bytes intact; an untracked file the target does not touch survives the reset. Plan
  re-pins both as tests (AC-10) rather than trusting this note. Kill-switch
  `MINSPEC_DRAIN_ABSORBED_ALIGN=0`, independent of `MINSPEC_DRAIN_GATED_FF`. Each move logs the
  checkout, old HEAD, new HEAD and the backup ref. This operation requires the DR-065 amendment
  to be **accepted** — until then FR-5 ships disabled-by-default or not at all.

- **FR-6 (report-only classes — never touched).** Each of these is logged once per distinct
  state per drain run and raised on the alarm channel chosen in **D5**; none causes any write to
  the checkout:
  - **R1** ahead set contains any non-docs path (the SPEC-057 / human recovery route applies);
  - **R2** ahead set exceeds E2's cap;
  - **R3** a **dormant** checkout (A3) is dirty with anything not cleaned by the DR-065 #1167
    amendment — possible uncommitted work nobody is sitting in;
  - **R4** any FR-3 refusal (name collision at a different SHA, push rejected, PR create failed,
    bot token unavailable);
  - **R5** a checkout ahead of `origin/main` whose content is **not** absorbed **and** which was
    already swept on a previous cycle, after the swept PR was **closed unmerged** — the lane said
    no; a human decides.

  An **occupied** checkout that is dirty is normal (a live session is working) and is **not**
  alarmed — only logged at debug level. This is the refinement the issue's Phase 3 item 4 needs:
  "unexpected dirty" is only unexpected when nobody is home.

- **FR-7 (ordering inside the cycle).** The sweep runs **after** `sync_shared_checkouts`' fetch
  (it needs current `origin/*`) and before triage/dispatch, in the same position the sync holds
  today. A checkout that FR-5 re-aligned this cycle is not swept this cycle. The whole step never
  aborts the drain: a failure is per-checkout, logged, and the cycle continues — but no failure is
  swallowed without its log line (no bare `|| true` on any signal FR-4/FR-5/FR-6 depend on).

## Invariants (must hold)

- **INV-1 (rule #8 / DR-065 §5).** No `checkout`, `switch`, `rebase`, `merge`, `stash`, `clean`,
  `restore` or `reset --hard` is ever issued against a shared checkout by this step. The **only**
  HEAD move is FR-5's `reset --keep`, and only with A1–A5 true and the DR-065 amendment accepted.
  The sweep (FR-3) writes refs only.
- **INV-2 (no commit becomes unreachable).** Every commit that was reachable from a checkout's
  `main` before the step is reachable afterwards from a named ref (the backup ref, or the pushed
  `stranded/*` branch). Verifiable by a test on recorded state, not by inspection.
- **INV-3 (never overwrite).** No `-f`/`--force`/`+refspec` on any branch create or push.
- **INV-4 (no silent gate — constitution #2).** Every classification read and every write either
  succeeds or produces a named log line; an errored read skips the checkout, it never reads as
  "clean" or "nothing ahead".
- **INV-5 (blast radius — constitution #3).** Acts only on worktrees `git worktree list` reports for
  **this** repository, which carries `.minspec/`. Any wider set is **D3**, and every member of a
  wider set must itself carry `.minspec/` at its root.
- **INV-6 (never mints or edits an approval).** Transports commits that already exist; never
  writes `status:`, a sidecar or `approvedBy` (DR-012), never relabels a governance PR into the
  lane.
- **INV-7 (no unattended bypass).** Never `--admin`, never a token that can bypass a required
  check; never arms auto-merge itself (SPEC-062 INV-2).
- **INV-8 (dev-time only).** Nothing here ships in the extension (Tier 0, offline core,
  constitution #1). Network use is the drain's existing Tier-1 posture (DR-004).

## Acceptance Criteria

All T0 (offline, temp-repo fixtures with a local bare repo as `origin`; `gh` stubbed and its argv
recorded). Each names the requirement it proves.

- **AC-1 (FR-2, FR-3, INV-1, INV-3).** A dormant-or-occupied checkout on `main` with two ahead
  commits touching only `specs/**` and `docs/**`, older than the grace window ⇒ branch
  `stranded/<name>-<sha12>` exists on `origin` at HEAD, one `gh pr create` with `--label
  docs-lane`; the checkout's HEAD SHA, `git status --porcelain` and index are byte-identical
  before and after; recorded git argv contains none of INV-1's forbidden verbs and no `-f`/`--force`.
- **AC-2 (FR-3.5).** Same, with one ahead commit flipping `status:` in a spec ⇒ PR opened
  **without** `docs-lane`. Pinned by sourcing `governance-transition.sh`, not a copied regex.
- **AC-3 (FR-3.1, FR-3.4, idempotency).** Running the cycle twice ⇒ exactly one branch and one
  `gh pr create` total; the second run adopts.
- **AC-4 (FR-2 E1, FR-6 R1).** One ahead commit touches `packages/**` ⇒ no branch, no push, no PR,
  one R1 report.
- **AC-5 (FR-2 E3).** Ahead commit younger than the grace window ⇒ nothing happens this cycle;
  with the clock advanced past it ⇒ AC-1's outcome.
- **AC-6 (FR-2 E4).** HEAD already on some `origin/*` branch ⇒ no push; PR adopted or opened
  against that branch.
- **AC-7 (FR-5, INV-2).** Local `main` has one commit whose content `origin/main` received via a
  squash-merge (different SHA), plus `origin/main` has since moved on by an unrelated commit;
  checkout clean and dormant ⇒ `main` == `origin/main` afterwards, and the backup ref points at
  the old HEAD. (Under D1 option (a) this AC instead asserts **no** move — that is the point of D1.)
- **AC-8 (FR-5 A4 refusal).** Local commit whose content is **not** on `origin/main` ⇒ no move,
  checkout byte-identical before/after.
- **AC-9 (FR-5 A2/A3 refusal).** Absorbed content but (i) one dirty tracked file, (ii) one
  untracked file, (iii) a live presence record for this checkout, (iv) an **empty** presence
  directory ⇒ no move in each case.
- **AC-10 (FR-5 TOCTOU).** A file is dirtied between the A2 check and the write (injected via the
  test's git-runner seam) ⇒ `reset --keep` aborts, the file's bytes survive, a failure line is
  logged, and the backup ref still exists.
- **AC-11 (FR-6 R3 vs occupied).** Dormant + dirty ⇒ one R3 report; occupied + dirty ⇒ no report.
- **AC-12 (FR-1, INV-4).** `rev-list` (or `diff-tree`) made to fail on one checkout ⇒ that checkout
  is skipped with a log naming it and the command, the next checkout is still processed, and no
  push happens for the failed one.
- **AC-13 (FR-3.5 identity).** Bot-token mint stubbed to fail ⇒ no `gh pr create` runs under any
  other identity; R4 reported.
- **AC-14 (kill-switches).** `MINSPEC_DRAIN_STRANDED_SWEEP=0` ⇒ AC-1 fixture produces no branch;
  `MINSPEC_DRAIN_ABSORBED_ALIGN=0` ⇒ AC-7 fixture produces no move; each independent of the other
  and of `MINSPEC_DRAIN_GATED_FF`.
- **AC-15 (mutation discipline).** Plan names, per guard (E1–E5, A1–A5), a mutant that removes it
  and the AC that turns red. A guard with no killing AC is a gap (project memory: coverage % hides
  decisions; tests can pass vacuously).

## Risks

- **R-a (re-proposing reverted content).** If `origin/main` added then reverted a change that a
  stranded local commit also carries, A4 reports "not absorbed" and the sweep would open a PR
  re-adding it. Bounded, not removed: the PR still faces ai-review and every required check, and
  the PR body names its origin. Not detectable from git alone.
- **R-b (presence is the gate on the only HEAD move).** A3 inherits DR-065's single-machine
  presence limits. INV-2's backup ref is what makes a wrong move recoverable rather than lossy.
- **R-c (FR-5 rarely fires while VS Code is open).** The extension heartbeats presence for the
  primary while a window is open (SPEC-026), so A3 holds mainly when the editor is closed. That is
  DR-065's accepted cost, inherited unchanged; the sweep (FR-3) does not depend on dormancy and
  gives the main benefit regardless.
- **R-d (two producers, one commit).** SPEC-057's advisory and this sweep can both push the same
  commit under different branch names. E3's grace window and E4's containment check make the
  second producer a no-op in the ordinary order; a race inside the window yields two PRs with
  identical content, which is visible and closable, not lossy.
- **R-e (`merge-tree --write-tree` semantics).** Needs git ≥ 2.38 (this container: 2.43.0). Plan
  must pin the minimum and fail closed (no move) on an older git.

## Decisions needed (Clarify)

### D1 — What proves the local commits have "already landed" (FR-5 A4)?

- **(a) Strict tree equality — the issue's original:** `git diff HEAD origin/main` is empty.
  Safest possible proof. Cost: under ~15 concurrent sessions merging, `origin/main` usually moves
  between the stranded content landing and the next drain cycle, after which the trees never match
  again — the predicate is close to inert in exactly the repo that needs it.
- **(b) Content absorbed — merging HEAD into `origin/main` is a no-op (rec):** `git merge-tree
  --write-tree origin/main HEAD` exits 0 and yields `origin/main^{tree}`, plus A5's backup ref.
  Fires whether or not `origin/main` has moved on. **Cost:** it is a judgement made by a 3-way merge,
  so a merge-machinery edge case is a wrong "absorbed" verdict; the backup ref keeps that
  recoverable, but the checkout would silently show `origin/main` until someone looks.
- **(c) No fast-align.** Sweep only; diverged checkouts stay diverged and are reported. Cost: the
  permanent-staleness deadlock DR-065 exists to remove stays live for every checkout that ever
  stranded a commit.

### D2 — Dirty derived harness files (issue Phase 3 item 2)

- **(a) Out of this spec (rec).** Byte-identical leftovers are the DR-065 #1167 amendment's job;
  anything else on a dormant checkout is an R3 report. **Cost:** a real partial harness refresh on
  a dormant checkout still waits for a human.
- **(b) Build it as the issue describes.** Needs a headless `refreshHarnessFiles`, which does not
  exist (SPEC-136 headless core is `specifying`), and its PR would carry machinery paths that
  SPEC-058 D-1 already decided are human-merged — so the "auto" half would end at an open PR
  anyway, after writing to a shared working tree.

### D3 — Which checkouts?

- **(a) This repository's worktrees only — what `sync_shared_checkouts` already enumerates (rec).**
  **Cost:** the sealbox strand the issue reports stays manual until sealbox's own tooling adopts
  this helper.
- **(b) A configured list of sibling repos**, each required to carry `.minspec/` (constitution
  #3 opt-in). Cost: a new config surface and a drain that writes to other repositories' remotes
  from this repo's process — wider blast radius for one recurring incident.

### D4 — Grace window and occupancy for the sweep (FR-2 E3)

- **(a) Sweep regardless of occupancy, after a 30-minute grace window (rec).** The sweep touches no
  tree, and the editor keeps the primary "occupied" whenever it is open, so a dormancy gate would
  make the sweep almost never run. **Cost:** a session that deliberately keeps an unpushed commit on
  `main` longer than 30 minutes gets it pushed and a PR opened for it.
- **(b) Dormant checkouts only.** Cost: near-inert (R-c), i.e. the backstop rarely backstops.
- **(c) Different window** — any value; shorter races SPEC-057's click path, longer leaves the
  strand invisible to other checkouts longer.

### D5 — Where do FR-6 reports go?

- **(a) Drain log + one deduplicated `inbox` issue per (checkout, report class, state hash),
  closed by the drain when the state clears (rec).** Visible without a session open. **Cost:**
  network writes and possible issue churn on a flapping state; the dedup key is a new thing to get
  right.
- **(b) Drain log only.** Cost: nobody reads it; an "alarm" nobody sees is the silent-gate shape.
- **(c) SPEC-062's hold queue → signpost.** The right long-term home, but its representation is
  deferred to #1608 and does not exist yet.

## DR note

The decision this spec rests on — adding a second sanctioned HEAD move on a shared checkout — is
the one choice here that cannot be undone in under a day (a wrong move is the unrecoverable class
DR-065 §"Costly to Refactor" names). DR-065 is the in-force record of exactly that question, and
its §5 lists `reset` among what it does **not** sanction. Per the dedup rule this is therefore a
**proposed amendment to DR-065**, not a new DR number: see *DR-065 → Amendment (2026-10-16)*.
Alternatives considered and rejected for the record form: a fresh DR (would leave DR-065 §5 saying
"never reset" with no pointer — two records disagreeing); folding it into DR-051 (DR-051 §4a is the
rule, DR-065 is the exception register). The sweep half needs no DR: a pushed branch and an opened
PR are reversible in minutes.

## Follow-ups (tracked)

- **#809** — this spec's issue.
- **DR-065 amendment (2026-10-16)** — must be accepted by a human before FR-5 is built.
- **#1167** — DR-065's G2 redundant-discard amendment, still `proposed`; D2(a) leans on it.
- **#1608** — signpost/agent-queue split; D5(c)'s eventual home.
- **#773** — drain liveness; this step only runs if the drain does.
- None new filed from this dispatch: it has no network access, and every follow-up above already
  has a tracked home.
