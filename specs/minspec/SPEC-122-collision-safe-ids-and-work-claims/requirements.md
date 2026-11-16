---
id: SPEC-122
type: requirements
title: Collision-safe artifact ids and advisory work claims — reserve a number before writing it, and show on the signpost what another session already has in hand
status: specifying
tier: T4
product: minspec
created: 2026-10-03
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination; sibling of SPEC-026 (session presence), SPEC-044 (issue claims), SPEC-227 (spec id sees unmerged claims)
aspects: [session-coordination, id-allocation, reservation, advisory-claim, signpost, worktree, tier-0, offline, determinism, never-wrong, no-wedge]
# SPEC-026: presence record, liveness predicate, worktree enumeration (built) — the declared-claim source.
# SPEC-227: the offline claimed-spec-id reader this spec generalises to two more registers.
depends_on: [SPEC-026, SPEC-227]
relates_to: [SPEC-012, SPEC-027, SPEC-044, SPEC-076, SPEC-096, SPEC-214, SPEC-264, SPEC-297, DR-019, DR-051, DR-065, DR-067, DR-074, "#176", "#168", "#267", "#1226", "#1418", "#1948", "#3164", "#3236"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038; the SPEC-096
# precedent). Every path below is NET-NEW: none exists at origin/main 7931142f (2026-11-16).
implements: [packages/shared/src/id-reservations.ts, packages/shared/tests/id-reservations.test.ts, packages/minspec/src/lib/id-allocator.ts, packages/minspec/tests/id-allocator.test.ts, packages/minspec/src/lib/work-claims.ts, packages/minspec/tests/work-claims.test.ts, scripts/next-dr-id.ts]
# Modified, not owned. spec-manager.ts, adr-manager.ts and epic-manager.ts hold the three
# max-plus-one allocators this spec reroutes; presence.ts and session.ts belong to SPEC-026;
# commands/next-task.ts to SPEC-012; scripts/next-task.ts to SPEC-076; scripts/next-spec-id.ts
# to #3164 / SPEC-227; template-registry.ts to SPEC-043.
affects: [packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/epic-manager.ts, packages/minspec/src/lib/presence.ts, packages/minspec/src/lib/session.ts, packages/minspec/src/commands/next-task.ts, packages/minspec/src/views/status-bar.ts, packages/minspec/src/lib/template-registry.ts, scripts/next-task.ts, scripts/next-spec-id.ts, package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-122: Collision-safe artifact ids and advisory work claims

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or accepts the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes.

> **Refreshed 2026-11-16 against `origin/main` 7931142f.** First written 2026-10-03 at
> 350c6fa4. In the six weeks between, the dispatcher gained an open-PR-aware spec-id
> allocator with an atomic claim (#3164), the cross-pull-request spec-id check started
> running in CI, and SPEC-227 (spec id sees unmerged claims) specified the offline spec-id
> reader for the extension. This revision drops what those now cover, reuses the claim
> store #3164 built instead of inventing a second one, and keeps only what is still
> missing. Every `file:line` below was re-read at 7931142f.

Triggered by: [#176](https://github.com/AIClarityAU/minspec/issues/176) — lightweight
multi-session coordination: atomic number allocation plus advisory artifact leases, and
explicitly **not** a general inter-session message bus.

Rests on, and does not change: [DR-051](../../../docs/decisions/DR-051.md) (artifact-class
branch policy — code isolates in worktrees), [DR-067](../../../docs/decisions/DR-067.md)
(a session claims work under an expiring lease; presence is that lease),
[DR-019](../../../docs/decisions/DR-019.md) (the next task is computed deterministically,
never guessed) and [DR-074](../../../docs/decisions/DR-074.md) (blast radius — the opt-in
marker). No new decision record — see [Why no new DR](#why-no-new-dr).

## One-Sentence Scope

Make the extension's three "next number" allocators (spec, decision record, epic) reserve a
number atomically in the claim store every worktree of the clone already shares before
writing it, back that with a commit-time refusal of a newly added duplicate number, and show
beside the next-task signpost which artifacts another session or branch already has in
hand — all from local evidence, with no daemon, no network call, no new dependency and
nothing that can block or wedge a session.

## Context — what exists at 7931142f (read, not inferred)

### Built already — not required again here

| What the issue asks | What exists | Where |
|---|---|---|
| A record of which session works on which spec and branch | One presence file per live session, carrying `scope`, `branch`, `worktreeRoot`, `specIds`, `fileAllowlist`, refreshed every 30 seconds (SPEC-026, session presence) | `packages/minspec/src/lib/presence.ts:56-68` |
| Advisory only, no hard lock | Liveness is "seen within 120 seconds and process alive"; a dead session's record expires | `presence.ts:100` (`isRecordLive`) |
| Reading across worktrees | Every worktree of the clone is enumerated and each one's own presence directory is read | `presence.ts:342` (`listWorktreeRoots`) |
| Not double-working an issue | Issue and pull-request claims as expiring leases over GitHub (SPEC-044, coordinated sessions); networked, development-time | `scripts/lib/issue-lease.sh` |
| **The dispatcher hands an agent a reserved spec id** (this spec's former FR-8) | `next-spec-id.ts` takes the max over the base, every open PR, every worktree, every local and remote-tracking ref and every live claim, then **claims** the next id with an exclusive create under the shared git directory. Built for #3164 after 11 PRs took SPEC-232 and 14 took SPEC-263/264 (#3236) | `scripts/next-spec-id.ts:1-28`, `:151-196`; called at `scripts/dispatch-issue.sh:1543-1552` |
| Cross-pull-request spec-id check (this spec previously listed it out of scope) | The DR collision workflow now also runs the spec-id decision on every PR | `scripts/check-dr-id-collision.ts:32`, `:78`; `.github/workflows/dr-id-collision.yml` |
| Single-tree duplicate checks | Validator rules for duplicate DR and spec ids | `scripts/lib/dr-id-collision.ts`, `scripts/lib/spec-id-collision.ts` |

### Specified elsewhere, not built — this spec depends on it, does not repeat it

**SPEC-227 (spec id sees unmerged claims, status `planning`)** owns the offline reader of
claimed **spec** ids — working tree, every worktree, every local and remote-tracking ref —
and `nextSpecId` using it (SPEC-227 FR-1 to FR-7), including how gaps and the age of the
remote view are reported (FR-5, FR-6). Its reader module (`packages/shared/src/claimed-spec-ids.ts`)
does not exist at 7931142f. This spec builds on that reader and does not restate it.

**SPEC-297 (spec-id publish-time guard)** refuses, in the dispatcher, to publish a Specify
branch whose added spec id is not the reserved one. That is a dev-time, publish-time check;
FR-9 below is the shipped, commit-time one. They do not overlap.

### Still missing — the two halves of this spec

**1. The extension still allocates blind, and nothing reserves a DR or epic number.**

- `nextSpecId` — `packages/minspec/src/lib/spec-manager.ts:212-225` — max over one specs
  tree plus one. SPEC-227 widens what it reads; neither spec, until this one, makes it
  **reserve**, so two editor windows in two worktrees reading the same widened set still
  get the same number.
- `nextAdrNumber` — `packages/minspec/src/lib/adr-manager.ts:107-122` — one directory
  listing plus one.
- `nextEpicNumber` — `packages/minspec/src/lib/epic-manager.ts:433-445` — same.
- On the dev-time side, `check-dr-id-collision.ts` prints `Next free id` but claims
  nothing, so two sessions authoring decision records at once read the same answer — the
  #1226 shape (DR-077 claimed twice). `next-spec-id.ts` reserves spec ids only
  (`next-spec-id.ts:167`, the claim name pattern is `SPEC-(\d+)\.(\d+)`).

Measured on 2026-10-03, before #3164: 18 branches each carried a different `SPEC-097-…`
directory. Measured since: 11 open PRs on SPEC-232 and 14 on SPEC-263/264
(`next-spec-id.ts` header; `packages/minspec/tests/spec-id-allocator-claims.test.ts:5-9`).
#3164 closed the dispatcher path. The editor path and the DR and epic registers remain.

**2. The presence record is written, but nothing shows it against an artifact.**
`computeNextTask` builds its answer from the artifact graph alone
(`packages/minspec/src/commands/next-task.ts:24-30`); `status-bar.ts` and `next-task.ts`
contain no match for `presence`, `readAllRecords` or `peer`. A second session is pointed at
a spec with no sign that another session is mid-edit on it. Behind that:

- The record names specs only (`specIds`, `presence.ts:63`). Decision records, epics and
  issues cannot be claimed.
- The contention reader keeps only peers **in the same working tree**
  (`presence.ts:428`, `if (!sameCheckout(...)) continue`). Right for a file clobber; wrong
  here: under #168 (worktree per session) the peer on the same spec is by construction in a
  **different** tree.
- A headless session writes no presence record: the record's `pid` is the editor's
  extension host (`presence.ts:725`). `git worktree list` in this clone reports 156
  worktrees; most belong to dispatched agents with no editor.
- Liveness across process namespaces is broken today: a container reader sees every host
  editor's pid as dead (SPEC-264, presence across pid namespace, status `planning`). A
  declared claim judged by `isRecordLive` inherits that until SPEC-264 lands.

### Root cause, and the gate that is missing

*Symptom:* duplicate ids; two sessions drafting the same artifact.

*Mechanism:* the editor's allocators read a single working tree and reserve nothing; the
claim record has no reader at the point where work is chosen.

*Missing gate:* an atomic reserve shared by every worktree **and** by the dispatcher, and a
commit-time check that refuses a newly added number another branch or worktree already
carries. The dispatcher path got its reserve in #3164; the editor, DR and epic paths did
not, and the only commit-side defence is the single-tree validator.

### One fact that shapes the design

The issue suggests a counter or a `sessions.json` under `.minspec/`. `.minspec/` lives in
the **working tree**, so each worktree has its own copy (`.minspec/sessions/` is gitignored
per worktree, `packages/minspec/src/lib/scaffold.ts:293`). A counter there is visible to
one session and arbitrates nothing. #3164 reached the same conclusion and put its claims at
`<git-common-dir>/minspec/spec-id-claims/` (`next-spec-id.ts:151-153`), where every worktree
of the clone looks. This spec uses that store.

## Functional Requirements

Requirements are written under the recommended answer to each question in
[Decisions needed (Clarify)](#decisions-needed-clarify). "The clone" means one git
repository on one machine together with all of its worktrees. A "register" is one of
`spec`, `dr`, `epic`.

### Part A — collision-safe allocation

- **FR-1 (the taken set, per register).** The set of taken numbers for a register is the
  union of:
  1. for `spec`, the SPEC-227 FR-1 reader's output, unchanged;
  2. for `dr` and `epic`, the same three sources SPEC-227 FR-1 reads (this working tree,
     every other worktree's working tree, every ref under `refs/heads/` and
     `refs/remotes/`), keyed on the register's file names (`docs/decisions/DR-NNN*.md`,
     `docs/epics/EPIC-NNN*.md`, under the configured directories), with the same
     no-network rule (SPEC-227 FR-2), batch cost rule (FR-4) and visible-degradation rule
     (FR-5);
  3. every live reservation in the register's store (FR-2).

  The candidate is the highest of that union plus one. The reader for item 2 is the
  SPEC-227 reader parameterised by register, not a second implementation; if SPEC-227
  ships spec-only, the Plan phase generalises it rather than copying it.
- **FR-1a (range scoping is preserved).** `nextSpecId` keeps its product scoping
  (`spec-manager.ts:203-217`). Reservations are not scoped: a live reservation of
  `SPEC-005` removes 5 from every product's candidates. That direction only ever skips a
  number; it never hands out a taken one.
- **FR-2 (one reservation store, shared with the dispatcher).** Reservations live at
  `<git-common-dir>/minspec/<register>-id-claims/`, where `spec-id-claims/` is the
  directory `next-spec-id.ts` writes today. The protocol is the one #3164 built, unchanged:
  - a reservation is a file named `<ID>.<generation>`, created with exclusive create
    (`O_EXCL`); creating it is winning the number; `EEXIST` means re-read and retry;
  - its modification time is when it was taken;
  - an expired reservation is never deleted or overwritten; re-taking that number creates
    the next generation, so a process acting on an old view can never remove or take over
    a reservation made since;
  - retries are bounded; exhausting them fails visibly with the last id tried and never
    falls back to an unreserved number.

  The protocol moves out of `next-spec-id.ts` into `packages/shared/src/id-reservations.ts`
  (offline, no `vscode`, Tier 0), and both `next-spec-id.ts` and the extension call it. One
  implementation, so a dispatched agent's reservation and an editor's reservation see each
  other by construction.
- **FR-3 (the reservation is followed at once by the skeleton).** After winning, and before
  returning, the allocator writes the artifact's skeleton at its final path — the spec
  directory and `requirements.md` with `id:` frontmatter, the `DR-NNN` file, or the
  `EPIC-NNN` file. From then FR-1's working-tree source sees the number, so the reservation
  only has to cover the instant between winning and writing. A session that drafts for an
  hour holds its number through the file, not through a timer. If the skeleton write fails,
  the error is shown and the reservation is left to expire (it is never deleted, FR-2).
- **FR-4 (expiry, and nothing can wedge).** One time-to-live, defined once in
  `id-reservations.ts` and used by every caller: the 4 hours `next-spec-id.ts` uses today
  (`CLAIM_TTL_MS`, `next-spec-id.ts:40`, set to twice the longest a dispatch may run).
  A reservation is a removed candidate and nothing else: it stops no edit, commit, approval
  or phase advance. A crash between reserving and writing costs one number for at most the
  time-to-live. Deleting the whole store is safe for the allocator, which then works from
  FR-1's other sources; a reservation lost that way is covered by FR-9 and the CI check.
- **FR-5 (reservation body — contract).** The file **name** alone decides the reservation
  (id, generation) and the modification time alone decides its age. The body is optional
  metadata, used only for display by Part B:

  ```typescript
  /** Optional body of `<git-common-dir>/minspec/<register>-id-claims/<ID>.<generation>`.
   *  Local to the clone; never committed, never pushed. */
  interface IdReservationBody {
    v: 1;
    path?: string;        // repo-relative path of the skeleton FR-3 writes
    worktreeRoot?: string;// git top level of the reserving worktree
    branch?: string;      // branch at reserve time; absent when detached
    sessionId?: string;   // MINSPEC_SESSION_ID when set
    issue?: string;       // '#N' when the caller knows it (the dispatcher does)
    pid?: number;
  }
  ```

  A body that is not this JSON — including the `pid N` line `next-spec-id.ts:188` writes
  today — is a valid reservation with no metadata. It is never ignored, never treated as an
  error and never rewritten.
- **FR-6 (all three editor creators use the one allocator).** `createSpec`, `createAdr`
  and the epic creator obtain their number only through `id-allocator.ts`. No other code
  path in `packages/minspec/src` computes highest-plus-one for these registers; a test
  enumerates the call sites so a fourth cannot be added unnoticed.
- **FR-7 (dev-time DR reservation).** `scripts/next-dr-id.ts --repo OWNER/NAME [--base main]`
  is the decision-record twin of `next-spec-id.ts`: it takes the max over the base, every
  open PR (the source `check-dr-id-collision.ts` already reads), every worktree and every
  ref, reserves the next id through FR-2, prints it, and fails closed exactly as
  `next-spec-id.ts` does. It is development-time machinery and may read the network, as its
  sibling does; nothing under `packages/` imports it. (Scope question: DQ-5.)
- **FR-8 (say what the allocator could not see).** The editor's allocation result carries
  SPEC-227 FR-5's list of unread sources and FR-6's remote-view age, plus the count of live
  reservations read. The editor shows the note only when it matters (an unread source, or a
  remote view older than a named threshold), worded as an observation — "branch list as of
  last fetch 9 days ago; a newer id may exist there" — never as a guarantee of uniqueness.
- **FR-9 (commit-time backstop — the gate that binds an agent).** The shipped pre-commit
  hook refuses a commit that **adds** an artifact number (absent from the commit's parent)
  when another worktree or any ref in the clone already carries that number at a
  **different path**. The refusal prints the holder (branch or worktree, and path) and the
  next free number per FR-1. The same number at the same path on another ref is the same
  artifact and never a collision. A rename of the commit's own artifact (the parent
  vacates the path) is not a collision, matching the `vacatedDirs` rule of
  `SpecPrClaims` in `scripts/lib/spec-id-claims.ts`. If the hook cannot enumerate worktrees or refs it
  fails closed, naming what it could not read; `MINSPEC_ID_GATE_OFF=1` is the intentional
  bypass, matching `RCDD_GATE_OFF` and `SECRET_GATE_OFF`. The hook's definition of "taken"
  is FR-1's: one implementation, or two held together by a parity test (the SPEC-026 FR-14
  precedent). It ignores reservations: a commit carries a file, and the file is what
  conflicts.
- **FR-10 (existing gates stay).** The validator's single-tree duplicate rules, the CI
  cross-PR check for spec and DR ids, `next-spec-id.ts`'s fail-closed behaviour and
  SPEC-297's publish-time guard are unchanged. They are the independent witnesses for what
  this spec cannot reach: a second clone, a second machine, a branch never fetched.

### Part B — advisory work claims

- **FR-11 (a claim is evidence that an artifact is in hand elsewhere — two sources).**
  - *Declared:* a live presence record (SPEC-026) from any worktree of the clone naming the
    artifact, or a live reservation (FR-2) whose body names a path or issue for it.
  - *Derived:* a worktree other than this one whose branch has uncommitted changes, or
    commits not on the default branch, touching that artifact's own files.

  Derived claims exist because headless sessions declare nothing; they need no new file and
  cannot go stale independently of the work they describe. A dispatcher reservation whose
  body carries `issue` is how a headless Specify agent becomes a declared claim on its
  issue without a presence record.
- **FR-12 (claims may name any artifact kind).** The session state gains an optional
  `claims: string[]` accepting `SPEC-NNN`, `DR-NNN`, `EPIC-NNN` and `#N` (an issue, held as
  an opaque local string — no lookup). The presence record carries it as an optional field.
  Absent means empty; `specIds` keeps its meaning and is read as claims too. Backwards
  compatible both ways: the present reader requires only the fields it lists
  (`presence.ts:255-266`) and ignores extras.
- **FR-13 (claims are populated by the tool, not by memory).** Creating an artifact through
  the allocator adds its id to the creating session's claims. No requirement here depends on
  a session remembering to declare what it works on; a session that declares nothing is
  still covered by the derived source.
- **FR-14 (the claim view — contract).** A pure function in `work-claims.ts` takes presence
  records, reservations and per-worktree git facts as **inputs** and returns:

  ```typescript
  interface WorkClaim {
    artifactId: string;                // 'SPEC-044', 'DR-067', 'EPIC-009', '#176'
    source: 'declared' | 'derived';
    liveness: 'live' | 'unknown';      // 'live' only from SPEC-026's isRecordLive
    branch: string;
    worktreeRoot: string;
    sessionId: string;                 // '' when derived or not recorded
    scope: string;                     // the session's one-line scope; '' when unknown
    observedAt: string;                // lastSeen, reservation mtime, or newest change time (ISO-8601 UTC)
  }
  ```

  Output order is deterministic (artifact id, then source, then `worktreeRoot`). The
  function performs no file, git or network access; the reads live in its caller, so it is
  tested by calling it. Liveness is SPEC-026's predicate, including whatever SPEC-264
  changes it to; this spec adds none.
- **FR-15 (shown beside the signpost, never inside the choice).** When the next task's
  target, or the spec that owns it, has a claim from another session or worktree, the
  signpost appends one line under the imperative:
  - declared and live: `SPEC-044 in progress — "<scope>" on branch <branch>`
  - anything else: `Branch <branch> has unmerged changes to SPEC-044 (last change <age> ago;
    no live session seen)`

  The resolver's choice is unchanged (DQ-3). The same lines appear in the status-bar
  tooltip, and `npm run next-task` (SPEC-076) gains a `claims` array on each answer.
- **FR-16 (wording never overstates).** "In progress" is used only for a declared claim
  whose liveness is `live`. Every other claim is described as what was observed, with its
  age. A claim whose evidence could not be read is omitted and counted in one
  "N worktrees could not be read" line; it is never rendered as "no one is working on this".
- **FR-17 (warn at the moment of overlap).** When a session's own claims come to include an
  artifact that another **live** session has declared, the editor shows one non-modal
  notification naming the artifact, the other session's scope and its branch. Once per
  artifact per session. It blocks nothing.
- **FR-18 (claims never delay the signpost).** The signpost renders from the artifact graph
  first. Claims are gathered afterwards, off the render path, and cached per heartbeat
  interval. A slow or failed gather leaves the signpost exactly as it is today. The Plan
  phase measures the gather on a clone of this size (156 worktrees and 362 remote-tracking
  refs on 2026-11-16) and sets the budget from that measurement.

## Acceptance Criteria

1. **Concurrent editor allocations yield distinct ids.** Eight processes, each in its own
   worktree of one clone, call the extension allocator for a spec at the same instant:
   eight different ids, eight skeletons, no error. The same test with the exclusive create
   replaced by a plain write MUST fail — the test names that mutation and is run against
   it, so it cannot pass while inert.
2. **Editor and dispatcher see each other.** With `next-spec-id.ts` and the extension
   allocator run concurrently in one clone, they never return one id; a reservation
   written by either is read by the other.
3. **DR and epic sources.** With `DR-130-foo.md` present only on a local branch or a
   remote-tracking ref, absent from every working tree, the DR allocator returns `DR-131`;
   same for an untracked `EPIC-020-x.md` in a sibling worktree yielding `EPIC-021`. Each
   FR-1 source gets its own red-then-green case.
4. **No wedge.** A reservation with no skeleton stops reserving after the time-to-live and
   its number is handed out again under the next generation. With the store deleted
   mid-run, allocation still succeeds.
5. **Foreign body.** A reservation whose body is `pid 123` or random bytes reserves its
   number exactly like a JSON one, is not rewritten, and raises no error.
6. **Scoped ranges.** Two products each allocating their first spec, with no reservations
   present, both receive `SPEC-001`.
7. **Single allocator.** A test fails if any file under `packages/minspec/src` other than
   `id-allocator.ts` computes a next number for the three registers, and if
   `next-spec-id.ts` creates claim files other than through `id-reservations.ts`.
8. **Dev-time DR id.** Two `next-dr-id.ts` runs started together print different ids; with
   the open-PR read made to fail, it exits non-zero with no id on stdout.
9. **Backstop.** A commit adding `SPEC-130-bar` while a sibling worktree or any ref holds
   `SPEC-130-foo` is refused, naming the holder and the next free id. A commit carrying
   `SPEC-130-foo` at the same path as another ref passes; a commit renaming its own
   `SPEC-130-foo` to `SPEC-130-foo2` passes. With worktree enumeration made to fail, the
   commit is refused with a message naming the failure; with `MINSPEC_ID_GATE_OFF=1` it
   passes. Same three cases for a `DR-NNN` file.
10. **Parity.** For a table of fixture clones, the hook and the allocator agree on the set
    of taken numbers.
11. **Declared claim across worktrees.** A live presence record in worktree B naming
    `SPEC-044` makes worktree A's signpost for `SPEC-044` carry the "in progress" line with
    B's scope and branch. When B's record goes stale, the line no longer says "in progress".
12. **Headless declared claim.** A live reservation whose body names `issue: '#176'` and a
    path under `SPEC-122` yields a declared claim on both, with no presence record present.
13. **Derived claim.** A sibling worktree with uncommitted edits to `SPEC-044`'s files and no
    presence record yields the "has unmerged changes" line, with an age.
14. **The choice is untouched.** For every fixture in the SPEC-012 (next-task resolver) test
    corpus, `resolveNextTask` returns byte-identical output with and without claims present.
15. **Old and new records mix.** A presence record without `claims` is read as having none;
    a record with `claims` is accepted by the unmodified SPEC-026 reader.
16. **Offline.** The extension allocator, the claim gather and the hook complete with
    networking disabled, and a test asserts no `git` subcommand they spawn contacts a
    remote (`fetch`, `pull`, `push`, `ls-remote`, `remote update`).
17. **Opt-in.** In a repository with no `.minspec/` marker, no reservation, skeleton, claim
    or store directory is written by any extension or hook path in this spec.

## Invariants (must not break)

- **INV-1 (offline — constitution invariant 1).** No network call from the extension or the
  shipped hook. Git is used only for local reads. `next-dr-id.ts` (FR-7) is dev-time
  machinery and reads the network as `next-spec-id.ts` already does.
- **INV-2 (blast radius — constitution invariant 3, SPEC-096).** Every write is inside the
  opted-in repository (its working tree or its own git directory) and only when `.minspec/`
  exists at the root. Nothing here creates `.minspec/`.
- **INV-3 (no silent gate — constitution invariant 2).** The FR-9 backstop fails closed and
  visibly on an unreadable witness; its bypass is explicit and named. FR-2 never falls back
  to an unreserved number.
- **INV-4 (advisory means advisory).** No claim and no reservation ever blocks an edit, a
  commit, an approval or a phase advance. The one thing in this spec that blocks is FR-9,
  and only for a newly added duplicate number.
- **INV-5 (nothing can wedge).** No state written here needs a live owner to release it.
  Every reservation expires or is superseded by the artifact itself; deleting all of it is
  always safe for the allocator.
- **INV-6 (the resolver stays pure and deterministic — SPEC-012).** Claims do not enter
  `resolveNextTask` and do not change its output.
- **INV-7 (never wrong).** A claim line states observed evidence and its age. The allocator
  states what it could not see. Neither asserts uniqueness or absence beyond what was read.
- **INV-8 (a visible id is never reused).** A number carried by any working tree, ref or
  live reservation the clone can read is never handed out again while it is visible.
- **INV-9 (small).** No daemon, no background process beyond the existing 30-second
  heartbeat, no new dependency.
- **INV-10 (one liveness definition, one reservation protocol).** "Live" is SPEC-026's
  `isRecordLive`; the reservation protocol is `id-reservations.ts`. This spec adds no second
  of either.

## Decisions needed (Clarify)

Each question carries a recommendation and what the recommendation costs. The requirements
above are written under the recommended option in every case. No human has chosen these:
they are an agent's recommendations, and approving this spec is what ratifies them.

### DQ-1 — May the shipped extension write inside `.git/`?

#3164 already writes `<git-common-dir>/minspec/spec-id-claims/`, but only from this repo's
dev-time dispatcher. FR-2 extends that to the extension, which ships to adopters.

- **A — yes, the same store (rec).** One store means editor and dispatcher reservations see
  each other (AC-2). *Cost:* the shipped extension writes inside an adopter's `.git/` for the
  first time — a place users do not expect a tool to write — leaving one small file per
  allocation there; and the mechanism cannot extend to a second clone, so #267 (ids across
  clones) still needs its own.
- **B — git refs under a private namespace**, created with git's compare-and-set. *Cost:*
  the refs appear in `git for-each-ref` and graphical git tools, a mirror push publishes
  them, and the dispatcher's existing store would have to move or be read as a second
  source. *What it buys:* a primitive that could later be pushed to arbitrate across clones.
- **C — a counter under `.minspec/`, as the issue suggests.** *Cost:* it does not work —
  each worktree has its own `.minspec/`. Listed because the issue names it.

### DQ-2 — Does the commit-time backstop block, or only warn?

- **A — block, with a named bypass (rec).** *Cost:* a forgotten local branch carrying a
  number holds it for as long as the branch exists; a session is told to take the next one.
  Numbers get skipped more often, leaving visible holes in the registers. (The DR sequence
  check warns only on `duplicate` and `padding`, `packages/minspec/src/lib/adr-manager.ts:134`,
  so a skipped number raises no warning; the 2026-10-03 draft said otherwise and was wrong.)
- **B — warn only.** *Cost:* this is the prose-rule shape that produced 18, then 11, then 14
  sessions on one number; an agent that does not read the warning commits the duplicate.

### DQ-3 — Does a claim change which task the signpost picks?

- **A — annotate only (rec).** *Cost:* a person can still be sent to an artifact another
  session is mid-edit on, and has to read the extra line to notice.
- **B — skip a task whose target is claimed by a live session.** *Cost:* the resolver stops
  being a pure function of the artifact graph, which SPEC-012 forbids; and a wrong or
  lingering claim hides a task with nobody told — the wedge the issue rules out.

### DQ-4 — Are derived claims in this spec?

- **A — declared and derived (rec).** *Cost:* one read-only git query per worktree, which at
  156 worktrees needs the budget and caching FR-18 calls for; and a derived claim cannot
  tell an abandoned branch from active work, so the line reports an age instead of
  "in progress".
- **B — declared only.** *Cost:* headless sessions, most of the sessions in this clone,
  show only when the dispatcher's reservation names them (FR-11), and only for the hours it
  lives; so the signpost line would rarely appear in the setup that motivated it.

### DQ-5 — Is the dev-time DR allocator (FR-7) in this spec?

- **A — in this spec, as its own slice (rec).** *Cost:* this spec then edits development-time
  scripts next to the in-flight SPEC-214 (reviewer DR-id facts) work, with merge-conflict
  risk, and repo `CLAUDE.md` still says "take the number from the collision gate" until a
  follow-up points it at `next-dr-id.ts`.
- **B — a follow-up issue.** *Cost:* concurrent DR authoring keeps colliding the #1226 way
  until that issue is built, with the shared reservation protocol already one call away.

### DQ-6 — Is T4 (complete ceremony — all phases) the right tier?

Classified T4 on mechanical scope: seven new files, eleven modified, across the extension,
the shared package, the shipped hook templates and dev-time scripts, with a new commit-time
gate.

- **A — T4 (rec).** *Cost:* the full phase set, including Clarify, for a change whose two
  halves are each small.
- **B — split into two T3 (full spec cycle) specs, allocation and claims.** *Cost:* a second
  spec id and a second approval for work that shares its worktree-enumeration code.

## Why no new DR

Nothing here passes the irreversibility filter. The reservation store is local, uncommitted
state that expires by itself, and its location and protocol were set by #3164; moving it
(DQ-1 A to B) is a change of one module with no data to migrate. The claim field is
additive and optional. The signpost line is display. The directions these rest on —
presence as an expiring lease, worktree isolation for code, a deterministic signpost — are
already decided in DR-067, DR-051 and DR-019. If DQ-3 is answered B, that contradicts
SPEC-012's purity requirement and DR-019, and a record or an amendment becomes due before
the Plan phase.

## Delivery slices (ordering is load-bearing)

1. **The shared-protocol slice** — FR-2, FR-4, FR-5: extract the reservation protocol from
   `next-spec-id.ts` into `id-reservations.ts`, behaviour unchanged, with its own tests.
2. **The editor-allocator slice** — FR-1, FR-1a, FR-3, FR-6, FR-8. Needs SPEC-227's reader
   (or builds its generalisation). Closes the race for anything created in the editor.
3. **The dev-time DR slice** — FR-7 (if DQ-5 is A).
4. **The backstop slice** — FR-9, FR-10. Lands after slices 2 and 3 so a refusal always has
   a working "take the next number" path to point at.
5. **The claims slice** — FR-11 to FR-18. Independent of slices 2 to 4 except for reading
   reservation bodies as declared claims.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Exclusive create is not atomic on some network filesystems | Same exposure `next-spec-id.ts` already has; FR-10 keeps the validator and CI checks as the independent witness |
| Remote-tracking refs are stale, so the allocator reuses a number taken elsewhere | FR-8 reports their age; the CI cross-PR check still catches it; #267 is the real fix |
| A stale branch holds a number forever under FR-9 | The refusal names the holder so the branch can be deleted; numbers are cheap; DQ-2 states this cost |
| Reading 156 worktrees makes allocation or the signpost slow | SPEC-227 FR-4's batch rule for refs; claims are off the render path and cached (FR-18); budget set by measurement in Plan |
| The hook and the allocator drift apart | One implementation or a parity test (FR-9, AC-10) |
| Extracting the protocol changes `next-spec-id.ts`'s behaviour | Slice 1 is behaviour-preserving and keeps `spec-id-allocator-claims.test.ts` green unchanged |
| A host editor's claim reads as not live from a container | Wording falls back to the observed-evidence line (FR-16), never "nobody"; fixed at source by SPEC-264 |
| A derived claim reads as an accusation that someone is active | FR-16 wording: observation and age; "in progress" reserved for live declared claims |
| The 4-hour time-to-live holds an editor's crashed reservation longer than it needs | Costs one skipped number; one TTL keeps one protocol (INV-10) |

## Costly to Refactor

- **The meaning of "taken"** (FR-1). The allocator, the hook and later #267 all key on it.
- **The store path and file-name protocol** (FR-2). The dispatcher and every installed
  extension read it; a change needs both sides to read old and new names for a release.
- **The `claims` field name and accepted id forms** (FR-12). Written by every session and
  read by every other; a rename needs both directions of compatibility again.
- **The claim line wording** (FR-15, FR-16). People learn to act on it.

Cheap to change: the time-to-live, retry counts, cache interval, the body's optional fields.

## Out of Scope

- **Any message passing between sessions.** SPEC-027 (inter-session comms) owns the one
  courtesy protocol that exists; this spec adds none.
- **Hard locks of any kind**, and anything that needs a live owner to release it.
- **Ids across clones or machines.** #267 (collision-proof ids minted at merge).
- **The offline spec-id reader and `nextSpecId` reading it** — SPEC-227.
- **The dispatcher's spec-id allocation and the cross-PR CI check** — built (#3164).
- **The dispatcher's publish-time id guard** — SPEC-297.
- **Renumbering artifacts that already collide** on open branches.
- **Shipping a headless allocator to adopters.** `next-spec-id.ts` and `next-dr-id.ts` are
  this repository's dev-time scripts; for adopters FR-9 is what binds an agent, and a
  shipped headless create path is #1948.
- **Issue and pull-request claims over GitHub.** SPEC-044 owns them. An issue in `claims` is
  a local string only.
- **Same-file edit contention and branch-moved-under-you detection.** SPEC-026 and #168.
- **Changing the heartbeat, its interval or its liveness rule** (SPEC-026, SPEC-264).

## Alternatives considered and rejected

Recorded because this spec was written under the `act` autonomy mode (DR-086 §4).

- **A single `.minspec/sessions.json`**, the issue's sketch. One shared file is a write race
  between sessions — the reason SPEC-022 moved approvals to one file per spec — and under
  worktree isolation it is not shared at all. The per-session presence files are the same
  idea without either defect.
- **A second, extension-only reservation store** (this spec's 2026-10-03 draft, with a
  15-minute TTL and opportunistic deletion). Rejected once #3164 built one: two stores mean
  the editor and the dispatcher cannot see each other's reservations, and opportunistic
  deletion is the race #3164's generation naming was built to remove.
- **A lock file held for the life of the session.** Wedges on a crash; the issue rules it out.
- **Take the number at merge only.** Removes the race but needs a network round trip and
  renames after review; it is #267's design space.
- **Random or timestamp ids.** No collisions, but breaks the sequential registers and every
  existing reference.
- **A dedicated claim file per artifact.** A second record that can disagree with the
  presence record and with the branch; derived claims give the same answer with nothing to
  keep in step.
- **Fetch before allocating in the extension.** Shrinks the stale-ref window but is a
  network call without consent (constitution invariant 1).

## Follow-ups to file

This dispatch may not create issues; these need filing when the spec is approved.

- Point repo `CLAUDE.md`'s "take the number from the collision gate" at `next-dr-id.ts`
  once FR-7 lands (only if DQ-5 is A).
- Re-check SPEC-122's own id against open PRs at approval time: this refresh kept the id
  minted on 2026-10-03, and open PRs are not visible offline.

## Traceability

- Issue: [#176](https://github.com/AIClarityAU/minspec/issues/176). Primary fix it sits on:
  #168 (worktree per session).
- Built prerequisite: #3164 (`scripts/next-spec-id.ts`, the shared claim store).
- Counterpart: #267 (ids across clones), named in
  [EPIC-009](../../../docs/epics/EPIC-009-team-readiness.md).
- Detection gates this spec complements: #1226 (decision-record id collision), #1418 (spec
  id collision), #3236 (14 PRs on one id).
- Builds on: [SPEC-026](../SPEC-026-session-presence/requirements.md),
  SPEC-227 (spec id sees unmerged claims),
  [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md),
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md),
  [SPEC-076](../SPEC-076-headless-signpost-reader/requirements.md). Neighbours: SPEC-214,
  SPEC-264, SPEC-297.
