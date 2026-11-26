---
id: SPEC-438
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; DR-051 section 4c names this guard as the extension half of shared-checkout staleness
relates_to: [DR-051, DR-065, DR-080, DR-050, DR-062, SPEC-022, SPEC-026, SPEC-050, SPEC-140, "#512", "#481", "#95", "#276", "#168", "#1167"]
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan. The likely set is one
  new vscode-free module (packages/minspec/src/lib/artifact-freshness.ts) and its real-git
  tests, with one call each from commands/approve.ts, commands/adr.ts (acceptAdrCommand),
  commands/epic.ts (acceptEpicCommand) and commands/validate.ts, and one check in
  lib/approval-recover.ts.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Staleness guard on approve, accept and validate (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076 / #1169). Nothing is
> built until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#512](https://github.com/AIClarityAU/minspec/issues/512). Design rationale:
> [DR-051](../../../docs/decisions/DR-051.md) section 4(c) (accepted) already decides the
> shape: a staleness guard, not an auto-copier, detecting offline and offering a
> consent-gated sync. [DR-065](../../../docs/decisions/DR-065.md) section 3 records that the
> drain's unconditional `git fetch` exists partly to feed this guard, and its follow-ups
> list #512 as the extension half. No new decision record is needed; see Decisions
> needed item 3 for the one case that would need a DR-065 amendment.

## One-Sentence Scope

Before MinSpec approves, accepts or validates an artifact, it checks offline, against the
last-fetched `origin` refs, whether someone else has changed that artifact upstream since
the local copy was taken, and if so it says so and stops or warns instead of judging the
old copy; it never overwrites the local file.

## In plain terms

The SPEC-024 approval failed with "no acceptance criteria" even though the criteria had
merged in #492. The checkout was 35 commits behind `origin/main`, so MinSpec read the old
file. Worse cases exist: an approval that succeeds on an old file mints a hash for content
that is no longer the spec. With this spec, MinSpec notices that `origin/main` (as last
fetched) has a newer version of the file you are approving and tells you before it acts.
It does not fetch on its own and does not copy anything over your files.

## Current behaviour (cited)

- **Approve reads the working tree with no freshness check.** `approveSpecCommand` reads the
  spec with `readSpecFile(spec.filePath)` (`packages/minspec/src/commands/approve.ts:265`)
  and validates it at `approve.ts:274`; nothing compares it to `origin`. The validate
  command does the same (`packages/minspec/src/commands/validate.ts:51`, `:59`).
- **The offline primitive already exists.** `classifyPrimary` counts commits behind and ahead
  of `origin/<default>` with `git rev-list --count` and no network
  (`packages/minspec/src/lib/tidy-primary.ts:263-264`), and compares working-tree content to
  `origin/<default>` by blob id (`tidy-primary.ts` around `:275-284`). It works only on the
  default branch and for the whole tree, not one artifact.
- **The approval transport can push old content over new.** When the default branch is
  protected, recovery fetches `origin/<base>` (`packages/minspec/src/lib/approval-recover.ts:252`), creates a
  worktree off the fresh `origin/<base>` (`:265`), then copies the approval paths from the
  primary's working tree into it (`:285-297`). If the primary's copy predates an upstream
  edit, the approval branch silently reverts that edit. I believe, unverified, that this
  is the worse form of the SPEC-024 incident: had the stale file passed validation, its
  approval pull request would have removed the merged acceptance criteria.
- **The drain keeps `origin/*` refs current on shared checkouts.** DR-065 section 3:
  `git fetch` runs on every checkout regardless of occupancy (`scripts/drain-inbox.sh`), so
  last-known refs are often recent on this repo. That is not true for an adopter with no
  drain.

## Definitions

- **Artifact paths.** The files whose content the gate judges or writes:
  - spec: every file in the spec's directory (requirements.md and its shard siblings such
    as design.md and tasks.md, which `readShardIdFiles` already reads at approval) plus its
    approval sidecar (`sidecarPath`, `lib/approval-store.ts`);
  - decision record: the `DR-NNN.md` file and its approval record, if any (DR-062);
  - epic: the epic file and its approval record, if any.
- **Upstream ref (O).** `origin/<default>` as resolved locally from `refs/remotes/origin/HEAD`
  (same resolution as `tidy-primary.ts`), falling back to `main`. Never fetched by the guard.
- **Fork point (B).** `git merge-base HEAD O`. On a checkout that is simply behind main, B is
  HEAD; on a feature branch or a diverged main it is where the two split. One definition
  covers both.
- **Freshness verdict**, per artifact, one of:
  - `fresh`: for every artifact path, the working-tree content equals O's content (blob id
    compare, as `tidy-primary.ts` does, so line-ending normalisation cannot cause a false
    mismatch), OR no artifact path changed between B and O.
  - `local-ahead`: no artifact path changed between B and O, and some artifact path differs
    locally (uncommitted edit, or local commits after B). This is the normal state of a spec
    being edited and approved; local is the truth.
  - `behind`: some artifact path changed between B and O, its working-tree content differs
    from O's, and no artifact path has a local change since B. The local copy is an old
    version of something that has since moved on.
  - `conflict`: some artifact path changed between B and O AND some artifact path has a
    local change since B (committed or not), and the working tree does not equal O. Both
    sides edited; neither copy is the whole truth.
  - `unknown`, with a reason: not a git repo, no `origin` remote, O does not resolve,
    merge-base fails, or any git call errors or exceeds its time limit.
  An artifact path deleted or renamed in B..O counts as changed upstream.

## Functional Requirements

- **FR1 — Offline freshness check.** A vscode-free function takes a workspace root and a list
  of artifact paths and returns a freshness verdict plus: O's name, the commit count of
  `HEAD..O` and `O..HEAD`, the artifact paths that changed in B..O, and the time of the most
  recent update to O known locally (from the ref's reflog or `FETCH_HEAD` mtime; absent when
  neither exists). It runs only local git commands. It makes no network call and runs no
  `fetch`, `pull`, `checkout`, `reset`, `merge` or write of any kind.
- **FR2 — Gate placement.** Every command that approves, accepts or validates one artifact
  runs FR1 for that artifact's paths after the user has picked the artifact and before any
  read that feeds a verdict or any write. Known entry points: `approveSpecCommand` (and
  whatever `approveActive` funnels into), `acceptAdrCommand`, `acceptEpicCommand`,
  `validateSpecCommand`. Plan enumerates them from the registered commands and confirms no
  other path writes an approval record.
- **FR3 — `fresh` and `local-ahead` are silent.** The gate proceeds exactly as today, with no
  added prompt or toast. A checkout that is behind O on unrelated files does not warn.
- **FR4 — `behind` on approve or accept.** The gate does not record the approval. It shows
  the artifact, how far behind, which paths changed upstream, and how old the last-known O
  is, for example: "SPEC-024 has changed on origin/main since your copy (requirements.md;
  your checkout is 35 commits behind origin/main as of 3 h ago). Approving now would sign
  the old text." Its actions are those settled by Decisions needed items 1 and 3, and
  always include **Show upstream changes** (a diff of the artifact paths, working tree
  against O, opened read-only in the editor).
- **FR5 — `conflict` on approve or accept.** As FR4, but the message says both sides
  edited the artifact, and no sync action is offered — only **Show upstream changes** and
  cancel. Approving in this state is refused, with no override (see Decisions needed item 1).
- **FR6 — Validate command.** `behind` or `conflict` does not stop validation; the result
  is shown with a leading warning naming the verdict and the changed paths, so the user
  knows the verdict is about the local copy, not the merged one.
- **FR7 — `unknown` is visible, never a silent pass.** On `unknown` the gate proceeds
  (a repo with no remote must keep working offline), and the approval or validation
  message carries one clause naming why freshness was not checked, for example
  "freshness not checked: no origin remote". A git error or timeout is reported the same
  way, not swallowed.
- **FR8 — Never overwrites local content.** No guard action writes to the working tree,
  index or HEAD of the checkout. "Pull" or "sync", if offered at all, is either delegated
  to the user's own action or is a separately consented operation as decided in item 3;
  the guard itself never copies O's content over the local file.
- **FR9 — Optional consented refresh.** The `behind` dialog may offer **Fetch and re-check**,
  which runs `git fetch origin <default>` only on that click (consent per DR-050: the user's
  own git, no socket in the extension), then re-runs FR1 and re-presents the result. A
  fetch failure is shown and leaves the previous verdict in force.
- **FR10 — Approval transport refuses to revert upstream edits.** In
  `recoverProtectedBranchApproval`, after the existing fetch and before copying (between
  `approval-recover.ts:252` and `:285`), for each approval path that is not the DR index
  (which already splices, #2912): if the path changed in B..O (B taken against the freshly
  fetched O) and the primary's working-tree content differs from O, the recovery returns a
  new typed outcome (for example `stale-base`) naming the paths, commits nothing and pushes
  nothing. The caller shows it as an honest failure, as for its other non-success
  outcomes. This check needs no human decision: it is the same rule as FR4 applied at the
  moment the network has already been consented to.
- **FR11 — Bounded cost.** FR1 uses a fixed, named per-call time limit; the whole check
  adds no more than the limit set at Plan (target well under one second on this repo).
  Exceeding it yields `unknown` with reason `timeout` (FR7), never a hang.
- **FR12 — One implementation of the comparison.** The blob-id and behind/ahead helpers are
  shared with `tidy-primary.ts` rather than copied a third time, or the Plan records why
  not. Two copies of one predicate drift (DR-065 section 4 parity problem).

## Acceptance Criteria

Each is a test on a real temporary git repository with a bare `origin`, no network.

- **AC1** Local main 3 commits behind O; the spec's requirements.md changed in one of
  them; working tree clean → verdict `behind`, changed paths = [requirements.md], behind = 3.
- **AC2** Local main 35 behind O, none of the commits touch the spec's directory or sidecar
  → `fresh`; approving shows no added prompt (FR3).
- **AC3** Spec edited in the working tree, O has no change to it since B → `local-ahead`;
  approval proceeds unchanged.
- **AC4** O changed requirements.md AND the working tree also edits it → `conflict`; the
  approve command records nothing and offers no sync action (FR5).
- **AC5** O changed requirements.md, and the working tree holds exactly O's bytes
  (the stranded-copy case SPEC-140 describes) → `fresh`.
- **AC6** Same as AC5 but the working file is CRLF under `core.autocrlf=true` and O is LF →
  `fresh` (blob-id compare, #2472 precedent).
- **AC7** Feature branch whose fork point predates an upstream edit to the spec, no
  local change to it → `behind`; with a local change → `conflict`.
- **AC8** O deleted or renamed the spec's requirements.md → `behind` naming the path.
- **AC9** Only the approval sidecar changed upstream (someone approved or revoked there) →
  `behind`.
- **AC10** No `origin` remote → `unknown` (reason `no-remote`), approval proceeds, and the
  success message contains the "freshness not checked" clause (FR7).
- **AC11** A git call made to fail (for example a corrupted ref) → `unknown` with a reason,
  surfaced; never `fresh`.
- **AC12** FR1 under a git wrapper that records invocations: no `fetch`, `pull`, `push`,
  `checkout`, `switch`, `reset`, `merge`, `rebase`, `add` or `commit` is ever invoked, and
  the checkout's HEAD, index and working tree are byte-identical before and after.
- **AC13** Recovery (FR10): primary's spec file is an old version; O (after the recovery's
  fetch) has a newer one → outcome `stale-base`, no branch pushed, no commit created in the
  throwaway worktree, primary untouched.
- **AC14** Recovery with a fresh primary copy still recovers as today (no regression).
- **AC15** The validate command on a `behind` spec still reports its violations and prefixes
  the warning (FR6).
- **AC16** No `http`, `https`, `net` or `fetch` import is added to `packages/minspec`
  (existing Tier-0 lint stays green).

## Invariants this must not break

- **Constitution invariant 1 (offline core).** The check reads local refs only. The only
  network is a user-clicked fetch (FR9) or the recovery fetch that already exists under
  `minspec.pushOnApprove` consent (`approval-recover.ts` INV-4). Never an automatic fetch.
- **Constitution invariant 2 (no silent gate).** Every non-`fresh` outcome, including
  `unknown` and errors, is shown; none resolves to a silent pass.
- **Constitution invariant 3 (blast radius).** The guard runs only inside the existing
  approve, accept and validate commands, which already require the `.minspec/` opt-in marker
  (`approve.ts` `hasOptInMarker`).
- **DR-051 section 4(a) and DR-065 section 5.** MinSpec never moves a shared checkout's HEAD
  from the extension; DR-065 scopes the one sanctioned fast-forward to the drain and
  explicitly not to the Tier-0 extension. Any in-editor sync must respect that (item 3).
- **Local edits are never clobbered.** Dirty state is the danger case (DR-051 section 4(c)):
  no guard path writes the working tree.
- **SPEC-022 hash model unchanged.** The guard decides whether to proceed; it does not change
  what is hashed or how.
- **SPEC-140 and DR-080 behaviour preserved.** FR10 adds one refusal to recovery; recovery's
  other outcomes and SPEC-140's follow pass are unchanged. Plan must coordinate the shared
  file `approval-recover.ts` with SPEC-140 (planning), which also lists it under `affects`.

## Out of scope

- Moving the checkout forward automatically (DR-065 drain, SPEC-140 follow pass own that).
- A continuous staleness indicator in the status bar or tree. Backlog candidate; this spec
  covers only the moment a gate acts.
- Staleness of artifacts the gated one depends on (`depends_on`); DR-062 owns that.
- The script-side guard (#481, shipped): dispatch and drain may fetch and refuse.

## Decisions needed (Clarify)

1. **What may the user do on `behind` (approve or accept)?**
   - (a) **(rec)** Refuse, with **Show upstream changes**, **Fetch and re-check** and
     cancel, and no "approve anyway". The approval waits until the local copy is current.
     Cost: a user who really wants to sign the old text (rare; it is by definition not what
     is on main) must update the checkout first, one extra step.
   - (b) Warn with an **Approve anyway** override that the approval toast then records.
     Cost: the override is the exact click that produced a wrong approval in the SPEC-024
     incident; a hash for superseded content can then land.
   - (c) Non-modal warning only, approve proceeds. Cost: repeats the incident with a toast.
   `conflict` is refused with no override under every option.
   Recorded selection: none yet; the human chooses.
2. **When should freshness be read: last-known refs only, or a fetch first?**
   - (a) **(rec)** Last-known refs only, plus the consented **Fetch and re-check** button
     (FR9). This is what DR-051 section 4(c) (accepted) says. Cost: a checkout whose refs
     were never fetched passes as `fresh` against an old O; FR4 shows the age of O only
     when the guard fires, so a silent `fresh` on old refs is possible on a repo with no
     drain.
   - (b) An automatic `git fetch` before every gate, reading DR-050's amendment that a
     read-only fetch is a probe that may run without a consent toast. Cost: contradicts
     the wording of DR-051 section 4(c), which would need an amendment; adds network
     latency to every approval; offline turns every check into `unknown`.
   Recorded selection: none yet; the human chooses.
3. **What does "sync" mean in the editor?**
   - (a) **(rec)** MinSpec does not move HEAD. Offer **Show upstream changes** and open the
     editor's Source Control view so the user pulls with their own git. Keeps DR-065
     section 5 intact with no amendment. Cost: one manual pull, and on the shared primary
     the user may hit the dirty-tree refusal their pull already gives.
   - (b) Offer **Update checkout**, which runs `git merge --ff-only O` only when the checkout
     is on the default branch, the working tree is clean for every path O changes, and the
     move is a true fast-forward (DR-065 guards G2 and G4), after the click. Cost: makes
     the extension a second HEAD mover, which DR-065 section 5 rules out; needs a DR-065
     amendment (a new or superseding DR) and on a shared checkout a live-presence check.
   - (c) Invoke VS Code's built-in `git.pull` on the click. Cost: on a dirty or diverged
     tree it produces a merge commit or conflicts in the user's checkout, outside MinSpec's
     guards.
   Recorded selection: none yet; the human chooses.
4. **Should `unknown` because O has never been fetched, or was last updated long ago, be
   reported louder?** (a) **(rec)** No: one clause in the success message (FR7), and the age
   of O shown whenever the guard fires. Cost: an old O reads as a normal approval message.
   (b) Warn when O is older than a set age (for example 7 days). Cost: an offline user is
   warned on every approval, which trains them to ignore it.
   Recorded selection: none yet; the human chooses.

## Follow-ups (tracked)

- Continuous staleness indicator (status bar or tree) — not filed; record as a backlog line
  at Plan if still wanted (DR-023: no 30-day decision depends on it).
- If item 3 resolves to (b): a DR-065 amendment or superseding DR, filed at Clarify.
- `tidy-primary.ts` parity drift with `check-primaries-clean.sh` (its own docstring) is
  separate and unchanged by this spec.
