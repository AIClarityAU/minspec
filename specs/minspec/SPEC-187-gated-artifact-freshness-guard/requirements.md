---
id: SPEC-187
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval or a validation verdict computed from an out-of-date copy is a signpost that lies
aspects: [approval, freshness, git, offline, tier-0, no-silent-gate, consent, ux]
depends_on: [SPEC-022, DR-051, DR-050, DR-071]  # SPEC-022 owns the approval record and hash this guard sits in front of; DR-051 §4(c) is the decision this materializes; DR-050 and DR-071 are the two consent forms the optional network step may use
relates_to: [SPEC-026, SPEC-029, SPEC-136, DR-065, DR-056, DR-078, "#512", "#481", "#463", "#95", "#276", "#168", "#1439"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both source files
# are NEW and are needed under every answer to the Clarify decisions below: the editor-free
# detection module (FR-1 to FR-8) and the editor glue that puts its verdict in front of the
# three gates (FR-9 to FR-19), plus one test file for each.
implements: [packages/minspec/src/lib/artifact-freshness.ts, packages/minspec/src/commands/freshness-guard.ts, packages/minspec/tests/artifact-freshness.test.ts, packages/minspec/tests/freshness-guard.test.ts]
# Modified, not owned. The three gates call the guard; commit-on-approve carries the
# acknowledgement trailer (FR-17); tidy-primary.ts may give up its default-branch resolution
# for sharing (FR-8); package.json declares the settings (FR-20, FR-21).
affects: [packages/minspec/src/commands/approve.ts, packages/minspec/src/commands/validate.ts, packages/minspec/src/commands/adr.ts, packages/minspec/src/commands/epic.ts, packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/src/lib/tidy-primary.ts, packages/minspec/package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-187: Freshness guard on approve and validate - say when the copy being judged is behind the last-known remote, and never copy over it

> Issue: [#512](https://github.com/AIClarityAU/minspec/issues/512). Materializes
> [DR-051](../../../docs/decisions/DR-051.md) §4(c) ("freshness is the other half") and its
> Follow-ups row for #512. The script-side half of the same class shipped as #481 (PR #497);
> [DR-065](../../../docs/decisions/DR-065.md) §3 and its Alternatives row hand this extension-side
> half to #512 unchanged. **Specified, not built.**

## In plain terms

When you approve or check a spec (or accept a decision record or an epic), MinSpec reads the
file on your disk. If your checkout is behind what the remote last told it, that file may be an
old copy, and MinSpec will judge the old copy without saying so. That is how a SPEC-024 approval
was refused for "no acceptance criteria" when the criteria had already merged: the checkout was
35 commits behind.

This spec adds a check that runs first, without going online. It compares the file you are
about to approve against the last copy of the remote your git already has. If the remote copy
has changes yours does not, MinSpec tells you before it judges, names the file and how far
behind it is, and offers three things: look at the newer copy (offline), fetch and check again
(online, only because you clicked), or approve your copy anyway. It never copies the remote file
over yours, because yours may hold edits you have not saved anywhere else.

Cost: one extra click on an approval in a checkout that is behind. Left out: any automatic
fetching, and any change to how the approval hash is computed. Riskiest assumption: the last
fetch is recent enough to be worth comparing against (decision D-2 is about exactly that).

## One-Sentence Scope

Before Approve Spec, Accept Decision Record, Accept Epic or Check Spec judges an artifact, the
extension works out offline, from the remote-tracking refs git already holds, whether that
artifact's files are behind, diverged from, or only locally ahead of the remote's default
branch, and puts that answer in front of the human with consent-gated ways to catch up, without
ever writing over the artifact.

## Context - what the code does today (read from this worktree's base, 5f792386)

- **Approve Spec reads the working tree and nothing else.** `approveSpecCommand` reads the spec
  with `readSpecFile(spec.filePath)` (`packages/minspec/src/commands/approve.ts:264`) and passes
  it straight to `validateSpec` (`approve.ts:273`). The refusal at `approve.ts:285-298` reports
  the validator's errors with no hint that the input may be an old copy. That is the exact path
  the SPEC-024 incident took.
- **Check Spec is the same shape, read-only.** `validateSpecCommand` reads the file
  (`packages/minspec/src/commands/validate.ts:56`) and validates it (`validate.ts:58`).
- **Alt+A only routes.** `minspec.approveActive` dispatches to `minspec.approveSpec`,
  `minspec.acceptAdr` or `minspec.acceptEpic` and holds no approve logic of its own
  (`packages/minspec/src/commands/approve-active.ts:13-24`), so guarding those three commands
  guards Alt+A. The two accept commands are `acceptAdrCommand`
  (`packages/minspec/src/commands/adr.ts:278`) and `acceptEpicCommand`
  (`packages/minspec/src/commands/epic.ts:17`).
- **The extension already measures "behind origin", but for the whole tree and only for a
  status-bar item, never in front of a gate.** `classifyPrimary`
  (`packages/minspec/src/lib/tidy-primary.ts:213`) resolves `origin/<default>` from the local
  `refs/remotes/origin/HEAD` (`tidy-primary.ts:217-219`), counts commits behind and ahead over
  the whole tree (`tidy-primary.ts:243-244`), and classifies dirty paths against it - offline,
  never fetching (`tidy-primary.ts:34-39`). It returns early off the default branch
  (`tidy-primary.ts:236-238`) and is called only by the tidy-primary status bar
  (`packages/minspec/src/extension.ts:309-330`). Nothing in `approve.ts`, `validate.ts`,
  `adr.ts` or `epic.ts` calls it. Searched in `packages/minspec/src` for `rev-list`,
  `is-ancestor`, `FETCH_HEAD`, `@{u}` and `refs/remotes`: the other hits are
  `build-provenance.ts` (running build against HEAD, `build-provenance.ts:104-145`) and default-
  branch resolution for commit-on-approve (`packages/minspec/src/lib/approve-commit.ts:382-388`).
  None compares a gated artifact with the remote.
- **Pieces that already exist and are reused, not rebuilt:** default-branch resolution and the
  NUL-separated porcelain parser (`parsePorcelainZ`, `tidy-primary.ts:181`); "other live sessions
  in this checkout", which excludes the caller's own session and returns `null` when presence
  cannot be read (`otherLiveSessionsHere`, `tidy-primary.ts:310`); remote selection
  (`chooseRemote`, `packages/minspec/src/lib/git-remotes.ts:91`); the offline `git` helper and the
  "prove ancestry or say unknown" discipline of `build-provenance.ts:82-103`; and the consented
  push precedent with an injectable git runner (`packages/minspec/src/lib/approve-push.ts:1-47`).
- **The drain already keeps refs fresh in this repo.** DR-065 §3 makes `git fetch` unconditional
  in the drain, precisely so this guard's offline read has current `origin/*` refs to compare
  against. An adopter with no drain has refs only as fresh as their last manual fetch.

## Terms

- **Out of date** (not "stale"). In this codebase "stale" already means an approval whose hash
  no longer matches the file (`ApprovalStatus`, SPEC-022, SPEC-029). This spec never uses
  "stale" for the checkout, so the two cannot be confused in a message.
- **Reference ref.** The remote-tracking ref the guard compares against: by default the remote's
  default branch as git last recorded it (FR-2). Always a local ref. Never fetched by the guard
  itself.
- **Last-known.** What the reference ref said at the last fetch. Every message says
  "last-known", never "up to date", because the guard cannot know the remote's present state
  without going online.
- **Gated set.** The files whose content decides the gate's verdict (FR-3).
- **Base.** The merge base of HEAD and the reference ref.
- **Upstream-changed path.** A gated-set path whose content at the reference ref differs from its
  content at the base. **Locally-changed path:** one whose content at HEAD differs from the base.
  **Dirty path:** one whose working-tree or index content differs from HEAD, untracked included.

## Functional Requirements

### A. Detection - offline, per artifact, never writes

- **FR-1 Offline only.** Detection runs only local `git` commands that read refs, objects and the
  index. It never runs `fetch`, `pull`, `ls-remote`, `remote update`, or anything else that
  contacts a remote, and makes no other network call. (Constitution invariant 1.)
- **FR-2 Reference ref.** Resolve in this order and stop at the first that exists locally:
  1. the `minspec.freshness.referenceRef` setting, when set (for example `upstream/main`);
  2. `refs/remotes/<remote>/HEAD` resolved to its target, where `<remote>` is the one
     `chooseRemote` picks;
  3. `<remote>/main`, then `<remote>/master`.
  None found: the verdict is `not-applicable` with reason `no-reference-ref` (FR-7). The
  default-branch choice over the current branch's own upstream is decision D-6.
- **FR-3 Gated set.** For a spec: every file in the spec's directory (requirements and all
  shards), the spec's approval record under `.minspec/approvals/`, `.minspec/config.json`, and the
  epic file the spec's `epic:` names. For a decision record or an epic: that one file and
  `.minspec/config.json`. Paths are repo-relative. How wide this should be is decision D-4.
- **FR-4 Compare content, not commit counts.** Upstream-changed and locally-changed paths are
  found by comparing tree content at base, HEAD and the reference ref, limited to the gated set.
  A commit that changed a gated file and a later commit that reverted it leave nothing to report.
  Commit counts are computed only for the message: commits on the reference ref and not on HEAD
  that touch the gated set, and the same count over the whole tree.
- **FR-5 Verdict.**
  - **behind**: at least one upstream-changed path, and no path is both upstream-changed and
    locally-changed.
  - **diverged**: at least one path is both upstream-changed and locally-changed.
  - **current**: no upstream-changed path. Local-only changes (locally-changed or dirty) do not
    make it out of date; they are the edit in progress.
  - Dirty paths are always reported alongside the verdict, because they decide whether a
    fast-forward is safe (FR-14). Dirty paths alone never produce a warning (decision D-5).
- **FR-6 Freshness of the reference itself.** Report when the reference ref was last updated
  locally, from its reflog, else the modification time of `FETCH_HEAD`, else `unknown`. This is
  shown, never used to change the verdict (decision D-2 covers fetching).
- **FR-7 Cannot-tell is its own answer, never "current".**
  - `not-applicable`: the folder is not a git checkout, has no remote, or has no reference ref.
    These are normal states for some projects. They are said once in the MinSpec output channel
    per session and per reason, and do not prompt (FR-12).
  - `error`: git is present but a probe failed, timed out, or there is no merge base. It is
    never shown as `current`. How each gate shows it is FR-11 and FR-12.
- **FR-8 Bounded and editor-free.** All detection lives in one module with no `vscode` import,
  taking an injectable git runner (the `approve-push.ts` `GitRun` shape) so it can be
  unit-tested without a repo and reused by the headless core of SPEC-136 later. Every git call
  is limited to the gated set where git allows it, and the whole detection has one time budget
  (the Plan phase fixes the figure; exceeding it yields `error`, FR-7). Untracked-file listing
  is limited to the gated set and read with NUL-separated porcelain output through the existing
  `parsePorcelainZ`, never by trimming porcelain text. Default-branch resolution is shared with
  `classifyPrimary` rather than written a third time; whether that means extracting it or
  calling it is Plan's choice, but the two must not disagree on the reference ref.

### B. Where the verdict is shown

- **FR-9 Runs first.** In Approve Spec, Accept Decision Record, Accept Epic and Check Spec, the
  guard runs after the artifact is chosen and before the artifact is read for judging, so every
  later message (refusal or success) can carry its verdict.
- **FR-10 Refusals name the likely cause.** When Approve Spec refuses (`approve.ts:285` or
  `approve.ts:314`) and the verdict is `behind` or `diverged`, the refusal starts by saying the
  copy judged is out of date, which files the last-known remote has newer versions of, and that
  the missing content may already be there. This is the SPEC-024 incident's direct fix.
- **FR-11 Check Spec is told, never blocked.** Check Spec is read-only and stays read-only. A
  `behind`, `diverged` or `error` verdict adds one leading line to its result and a
  "Show newer copy" button (FR-13) when there is one. It never adds, removes or changes a
  validation violation.
- **FR-12 Approve and accept ask before judging an out-of-date copy.** When the verdict is
  `behind` or `diverged`, the gate does not continue until the human picks one of the FR-13
  actions. Dismissing the prompt cancels; nothing is written. When the verdict is `error`, the
  same prompt appears with the reason and only "Approve this copy anyway" and cancel, so a
  failed check is visible and never passes silently (constitution invariant 2). `current` and
  `not-applicable` do not prompt. Whether to ask or refuse outright is decision D-1.
- **FR-13 The actions.** Offered as buttons on a non-modal warning over the visible artifact
  (see UX), only when they apply:
  - **Show newer copy** - offline. Opens a diff of the working-tree file against its content at
    the reference ref, read with `git show`. Changes no file. The prompt stays answerable.
  - **Fetch and check again** - network, so offered only as a button, and the click is the
    consent (DR-050). Runs `git fetch <remote> <branch>` for the reference ref only, which
    updates that ref and touches neither HEAD nor the working tree, then restarts the gate from
    FR-9.
  - **Fetch, fast-forward and check again** - offered only when FR-14 holds. Fetches as above,
    then `git merge --ff-only <reference ref>`, then restarts from FR-9.
  - **Approve this copy anyway** (or "Accept this copy anyway") - continues with the working-tree
    copy, and the acknowledgement is recorded (FR-17).

### C. Catching up - consent-gated, never overwriting

- **FR-14 When a fast-forward is offered.** All of: the current branch's configured upstream is
  the reference ref; HEAD is an ancestor of the reference ref (verdict `behind`, never
  `diverged`); no dirty path is also an upstream-changed path; and no live session other than
  this window's own claims this checkout. That last test is `otherLiveSessionsHere`
  (`tidy-primary.ts:310`): a non-empty result, or `null` because presence could not be read,
  withholds the option and the prompt says why (DR-051 §4(a), DR-065). Not
  `isCheckoutOccupied`, which counts the caller's own session as occupying its tree.
- **FR-15 Never overwrite, never reset.** The guard never writes any file in the gated set,
  never copies remote content into the working tree, and never runs `reset`, `rebase`,
  `checkout`, `switch`, `stash`, `restore`, `cherry-pick` or a merge that makes a commit. The
  only HEAD movement it can cause is `merge --ff-only`, and only from the button in FR-13.
  `--ff-only` makes losing a commit impossible by construction; git itself refuses a
  fast-forward that would overwrite a dirty file.
- **FR-16 Re-judge after any catch-up.** After a fetch or a fast-forward the gate starts again
  from FR-9 and re-reads the artifact from disk. A result computed before the catch-up is never
  reused. If a fetch or fast-forward fails (offline, auth, refused), the failure is shown with
  git's own reason and the original prompt is offered again; it never falls through to
  approving.

### D. Recording and settings

- **FR-17 Acknowledged approvals say so.** When the human picks "Approve this copy anyway" on a
  `behind`, `diverged` or `error` verdict and commit-on-approve makes a commit, that commit's
  message carries a trailer:
  `MinSpec-Freshness: <verdict>; <n> behind on gated files; ref <ref>@<short sha>; ref updated <ISO time or unknown>`.
  Where the acknowledgement lives when no commit is made is decision D-3.
- **FR-18 The approval hash does not change.** The guard never alters what SPEC-022 hashes or
  how. The hash still covers the working-tree content the human approved.
- **FR-19 Opted-in folders only.** The guard runs only in a folder with `.minspec/` at its root
  (constitution invariant 3). Approve already refuses elsewhere (`approve.ts:238`); Check Spec
  skips the guard there and behaves exactly as today.
- **FR-20 Settings, declared in `package.json`, read with the DR-078 order, never written by
  MinSpec to user-global scope:**
  - `minspec.freshness.guard` - `on` (default) or `off`. When `off`, every approval and accept
    success message ends with "freshness not checked (guard off)", so a disabled guard is never
    mistaken for a passing one.
  - `minspec.freshness.referenceRef` - optional override for FR-2.
- **FR-21 Optional fetch before approving.** `minspec.freshness.fetchBeforeApprove` - `never`,
  `prompt` or `always`. `always` is standing consent for one fixed, same-origin, repeating
  network action (DR-071): fetch the reference ref, and nothing else, before FR-9 on approve
  and accept. A failed fetch under `always` is reported and the guard falls back to the
  last-known ref, saying so. The default is decision D-2.

## Contract

The detection module's output. Field names are binding for Plan; helper names are not.

```ts
/** Which gate asked. Decides the gated set (FR-3) and how the verdict is shown (FR-11, FR-12). */
export type GateKind = 'approve-spec' | 'accept-adr' | 'accept-epic' | 'check-spec';

export interface FreshnessInput {
  readonly rootDir: string;            // repo root of the folder holding the artifact
  readonly gate: GateKind;
  readonly artifactPath: string;       // absolute path of the approvable file
  readonly referenceRefOverride?: string; // minspec.freshness.referenceRef
}

interface Common {
  readonly ref: string;                // e.g. 'origin/main'
  readonly refSha: string;
  readonly refUpdatedAt?: string;      // ISO 8601; absent = unknown (FR-6)
  readonly gatedPaths: readonly string[];
  readonly dirtyPaths: readonly string[];
  readonly behindOverall: number;      // commits on ref not on HEAD, whole tree
}

export type FreshnessVerdict =
  | { readonly kind: 'not-applicable'; readonly reason: 'not-git' | 'no-remote' | 'no-reference-ref' | 'guard-off'; readonly detail: string }
  | { readonly kind: 'error'; readonly detail: string }
  | (Common & { readonly kind: 'current'; readonly locallyChanged: readonly string[] })
  | (Common & {
      readonly kind: 'behind';
      readonly upstreamChanged: readonly string[];
      readonly behindOnGated: number;  // commits on ref not on HEAD touching the gated set
      readonly fastForward: { readonly offered: true } | { readonly offered: false; readonly why: string };
    })
  | (Common & {
      readonly kind: 'diverged';
      readonly upstreamChanged: readonly string[];
      readonly bothChanged: readonly string[];
      readonly behindOnGated: number;
      readonly aheadOnGated: number;
    });

export type DetectFreshness = (input: FreshnessInput, git: GitRun) => Promise<FreshnessVerdict>;
```

## UX

The approve prompt for the SPEC-024 case. Non-modal, over the open artifact, matching the
existing advisory toasts in `approve.ts`.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚠ MinSpec: SPEC-024 - your copy is behind the last-known origin/main.        │
│   origin/main has newer versions of: requirements.md                         │
│   (3 commits touch this spec; 35 behind overall; origin/main last fetched    │
│   2026-07-04 09:12). Approving now judges and approves your older copy.      │
│                                                                              │
│  [Show newer copy]  [Fetch, fast-forward and check again]                    │
│  [Fetch and check again]  [Approve this copy anyway]          (x = cancel)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

When FR-14 does not hold, the fast-forward button is absent and one line says why, for example
"Fast-forward not offered: requirements.md has uncommitted changes" or "another MinSpec session
is open in this checkout".

## Costly to Refactor

Low. Every choice here is undone in under a day: the prompt, the settings and their defaults,
the gated set and the reference-ref order are all code or configuration. The one durable output
is the FR-17 trailer, which is written into commit history; its key and field order should be
fixed at Plan because anything that later parses it reads old commits too. No decision record is
minted: the deciding choice (guard, not auto-copy; offline detection; consent-gated sync) is
already recorded in DR-051 §4(c), and DR-065's Alternatives section already assigns the
human-prompt path to this issue.

## Acceptance Criteria

- [ ] **The SPEC-024 case is caught** - a checkout whose HEAD lacks an acceptance-criteria
      commit present on the last-known `origin/main` gets a `behind` verdict naming
      `requirements.md`, and Approve Spec's refusal says the copy is out of date before listing
      the validator's errors. (FR-4, FR-5, FR-10)
- [ ] **No network without consent** - with the default settings, running every gate in every
      verdict state makes no network call; a fetch happens only after a button click or under
      `fetchBeforeApprove: always`. (FR-1, FR-13, FR-21)
- [ ] **Never overwrites** - in a checkout with a dirty gated file and a `behind` verdict, no
      action the guard offers changes that file's bytes, and the fast-forward is not offered.
      (FR-14, FR-15)
- [ ] **Only fast-forward moves HEAD** - across all paths through the guard, the only command it
      runs that changes HEAD is `git merge --ff-only`, and only after the human clicks.
      (FR-13, FR-15)
- [ ] **Per artifact, not per tree** - a checkout 35 commits behind whose upstream commits touch
      no gated file gets `current`, and the approval proceeds without a prompt. (FR-3, FR-5)
- [ ] **Reverts are not reported** - an upstream change to a gated file followed by its revert
      gives `current`. (FR-4)
- [ ] **Local edits are not "out of date"** - a gated file edited locally (committed or not),
      with no upstream change, gives `current` with no prompt. (FR-5)
- [ ] **Diverged never offers fast-forward** - a gated file changed on both sides gives
      `diverged`, names the file in `bothChanged`, and the fast-forward button is absent.
      (FR-5, FR-14)
- [ ] **Failure is visible** - a git probe that fails or times out gives `error`; Approve shows
      the reason and requires "Approve this copy anyway" or cancel; it is never shown as
      current. (FR-7, FR-12)
- [ ] **Cannot-tell states do not nag** - no git, no remote, or no reference ref prompt nothing
      and are written once per session to the output channel. (FR-7)
- [ ] **Check Spec stays read-only** - its violations are identical with the guard on and off;
      only a leading line and a button are added. (FR-11)
- [ ] **Re-judged after catch-up** - after "Fetch, fast-forward and check again", the artifact
      is re-read from disk and validated afresh; a failed fetch re-offers the prompt and never
      approves. (FR-16)
- [ ] **Acknowledged approvals are traceable** - "Approve this copy anyway" on a `behind`
      verdict with commit-on-approve on yields a commit whose message carries the
      `MinSpec-Freshness:` trailer with verdict, count and ref. (FR-17)
- [ ] **Hash unchanged** - the approval hash for a given working-tree file is the same with the
      guard on and off. (FR-18)
- [ ] **Opted-in folders only** - in a folder without `.minspec/`, Check Spec runs no git
      command for freshness. (FR-19)
- [ ] **Off is said aloud** - with `minspec.freshness.guard: off`, every approve and accept
      success message says freshness was not checked. (FR-20)
- [ ] **Alt+A is covered** - approving through `minspec.approveActive` on a spec, a decision
      record and an epic each runs the guard. (FR-9)

## Invariants (must not break)

- **INV-1 Offline core** (constitution invariant 1). Detection is network-free; a network
  action needs a click (DR-050) or the named standing-consent setting (DR-071).
- **INV-2 No silent gate** (constitution invariant 2). A failed or timed-out check is shown and
  needs an explicit choice on approve; "could not tell" is never rendered as "current"; a
  disabled guard says so on every approval.
- **INV-3 Blast radius** (constitution invariant 3). Runs only where `.minspec/` exists; never
  writes user-global settings (DR-078).
- **INV-4 Local work is never lost.** No file in the gated set is written by the guard; HEAD
  moves only by `--ff-only` on a click; no reset, rebase, stash or overwrite.
- **INV-5 Approval semantics unchanged.** SPEC-022's record, hash and canonicalization are
  untouched; the guard decides only whether the gate proceeds.
- **INV-6 A guard cannot turn a refusal into a pass.** Whatever the verdict, a spec the
  validator refuses stays refused.
- **INV-7 Shared-checkout HEAD rule** (DR-051 §4(a), DR-065). Fast-forward is withheld when any
  other live session claims the checkout, and presence that cannot be read counts as claimed.

## Decisions needed (Clarify)

- **D-1 - Ask or refuse when the copy is out of date?**
  - **(a) Ask, with "Approve this copy anyway" (rec).** Matches DR-051 §4(c)'s "warn + offer a
    consent-gated sync" and works offline. Cost: in a checkout that is chronically behind, the
    extra click on every approval may train people to click through it.
  - (b) Refuse outright until caught up. Cost: an offline user whose remote has moved can never
    approve, and an intentional approval of a local version is impossible.
  - (c) Approve, then warn. Cost: the wrong approval is recorded first - the incident itself.
- **D-2 - Default for fetching before approve (`fetchBeforeApprove`)?**
  - **(a) `never` (rec).** Offline by default, and in this repo the drain already fetches
    (DR-065 §3). Cost: for an adopter with no drain, the guard compares against whatever their
    last manual fetch saw, possibly weeks old; FR-6 shows the age but cannot fix it.
  - (b) `prompt` - ask each time whether to fetch first. Cost: a second prompt on every
    approval, including when nothing changed.
  - (c) `always`. Cost: every approval makes a network call by default, which DR-071 permits
    only when the user chose the setting, so it cannot be a shipped default.
- **D-3 - Where is "approved anyway" recorded?**
  - **(a) Commit trailer only (rec, FR-17).** No schema change. Cost: with commit-on-approve
    off, the acknowledgement is recorded nowhere durable.
  - (b) A field in the approval record. Cost: changes SPEC-022's record format, an approved spec,
    and every reader of approval records.
  - (c) Not recorded. Cost: a later reader cannot tell a knowing approval of an older copy from
    an unknowing one.
- **D-4 - How wide is the gated set?**
  - **(a) Spec directory, approval record, config and the named epic (rec, FR-3).** Covers every
    file `validateSpec` reads for its verdict except existence checks on `implements:` paths.
    Cost: an upstream edit to the epic file alone triggers a prompt even when it changes nothing
    the validator cares about.
  - (b) The approvable file only. Cost: misses a newer shard, approval record or config that
    changes the verdict.
  - (c) The whole tree. Cost: in an active repo almost every approval prompts, which is the
    fastest way to make people ignore it.
- **D-5 - Warn on dirty files alone?**
  - **(a) No (rec, FR-5).** Approving a just-edited spec is the normal case, and the human is
    looking at the content being approved. Cost: another session's uncommitted edit to the same
    spec is approved without comment; the only defence is that it is visible in the editor.
  - (b) Yes. Cost: a prompt on nearly every approval, since approval itself rewrites the file.
- **D-6 - Compare against the default branch or the current branch's upstream?**
  - **(a) The remote's default branch (rec, FR-2).** Approvables land on `main` (DR-051), so
    that is where a newer version would be. Cost: on a long-lived feature branch the guard
    reports `main`'s changes even when the branch deliberately differs; the override setting
    is the escape.
  - (b) The current branch's upstream. Cost: misses the SPEC-024 shape whenever the approval is
    made on a branch, because the merged change is on `main`, not on the branch's upstream.

## Out of Scope

- The script side - dispatch and drain fetch and refuse on their own (#481, shipped in PR #497).
- Agent dispatch from a dirty primary checkout - that is #463's spec, for the agent-execute
  extension.
- Any automatic or background fetch, timer or status-bar indicator. Fetching happens only per
  FR-13 and FR-21.
- Pre-commit hooks and CI: they read the working tree at invocation and run where fetching is
  allowed.
- Wiring the detection into SPEC-136's headless core. FR-8 keeps the module editor-free so that
  is possible; doing it belongs to SPEC-136.
- Merging, rebasing or resolving a diverged artifact. The guard reports `diverged` and shows the
  newer copy; resolving it is the human's job with their own git tools.

## Alternatives considered and rejected

- **Copy the remote's docs over the local ones when out of date** (the naive fix #512 itself
  rejects). Rejected on three counts: fetching needs the network (invariant 1); "dirty" is the
  mid-edit case, so copying clobbers the work the trigger detected; and the right direction
  depends on state (unapproved and in edit means local wins, merged means remote wins), so a
  blind copy is wrong either way.
- **Judge the remote copy instead of the working tree** (`git show <ref>:<path>`). Rejected: the
  human approves what they are looking at; approving a different copy than the one on screen is
  the same never-wrong failure in the other direction, and it breaks SPEC-022's working-tree
  hash.
- **Whole-tree "N commits behind" warning.** Rejected as the trigger (kept as context in the
  message): it fires on nearly every approval in an active repo and says nothing about the
  artifact.
- **Refuse when the reference ref is older than some age.** Rejected for now: any threshold is a
  guess, and refusing offline approvals for an old fetch punishes the offline user invariant 1
  protects. D-2 is the place to change how fresh the reference is.
- **A modal dialog.** Rejected: a focus-stealing modal over the artifact is the HITL anti-pattern
  this repo avoids for advisory gates; a non-modal warning with buttons still holds the gate
  until answered.

## Test plan (for the Plan phase to place)

- Detection, against throwaway git repos built in the test (a bare "remote", a clone, commits on
  each side): every FR-5 verdict, the revert case, the not-applicable reasons, a missing merge
  base, a probe timeout, a dirty file overlapping an upstream change, and the presence
  fail-direction for FR-14. One test proves zero remote-contacting commands are issued by
  recording every argv the injected runner receives.
- Gate glue, with a stubbed verdict: each gate's prompt or line per verdict; dismiss cancels and
  writes nothing; "anyway" reaches the approval with the trailer; a failed fetch re-prompts.
- Hash identity with the guard on and off for the same file (FR-18).

## Traceability

- Issue: [#512](https://github.com/AIClarityAU/minspec/issues/512).
- Rationale: [DR-051](../../../docs/decisions/DR-051.md) §4(c) and its #512 Follow-up row;
  [DR-065](../../../docs/decisions/DR-065.md) §3 and the "Prompt a human for each ff" alternative.
- Consent: [DR-050](../../../docs/decisions/DR-050.md) (per-click), [DR-071](../../../docs/decisions/DR-071.md)
  (standing setting).
- Neighbours: SPEC-022 (approval record and hash), SPEC-026 (session presence), SPEC-029
  (approval staleness UX - a different "stale"), SPEC-136 (headless core), #95 (shared approval
  records), #276 (forgotten-merge inbox), #168 (worktree per session), #1439 (build provenance,
  the model for offline git checks).
