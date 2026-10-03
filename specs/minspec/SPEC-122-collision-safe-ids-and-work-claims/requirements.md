---
id: SPEC-122
type: requirements
title: Collision-safe artifact ids and advisory work claims — reserve a number before writing it, and show on the signpost what another session already has in hand
status: specifying
tier: T4
product: minspec
created: 2026-10-03
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination; sibling of SPEC-026 (session presence), SPEC-044 (issue claims) and the in-flight SPEC-120 (git guardrail)
aspects: [session-coordination, id-allocation, reservation, advisory-claim, signpost, worktree, tier-0, offline, determinism, never-wrong, no-wedge]
depends_on: [SPEC-026]  # reuses the presence record, its liveness predicate and its worktree enumeration (all built) as the declared-claim source
relates_to: [SPEC-012, SPEC-027, SPEC-044, SPEC-076, SPEC-096, DR-019, DR-051, DR-067, DR-074, "#176", "#168", "#267", "#1226", "#1418", "#1948"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038; the SPEC-096
# precedent). All five paths are NET-NEW: none exists at 350c6fa4.
implements: [packages/minspec/src/lib/id-allocator.ts, packages/minspec/tests/id-allocator.test.ts, packages/minspec/src/lib/work-claims.ts, packages/minspec/tests/work-claims.test.ts, scripts/allocate-id.ts]
# Modified, not owned. spec-manager.ts, adr-manager.ts and epic-manager.ts hold the three
# max-plus-one allocators this spec reroutes; presence.ts and session.ts belong to SPEC-026;
# commands/next-task.ts to SPEC-012; scripts/next-task.ts to SPEC-076; dispatch-issue.sh to
# SPEC-044; template-registry.ts to SPEC-043.
affects: [packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/epic-manager.ts, packages/minspec/src/lib/presence.ts, packages/minspec/src/lib/session.ts, packages/minspec/src/commands/next-task.ts, packages/minspec/src/views/status-bar.ts, packages/minspec/src/lib/template-registry.ts, scripts/next-task.ts, scripts/dispatch-issue.sh, package.json]
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

Make the three "next number" allocators (spec, decision record, epic) hand out a number that
no other session in the same clone can also receive, by reserving it atomically before
writing; and show, beside the next-task signpost, which artifacts another session or branch
already has in hand — both from local evidence only, with no daemon, no network call, no new
dependency and nothing that can block or wedge a session.

## Context — what exists today (read from `350c6fa4`, not inferred)

The issue was written on 2026-06-05, before most of the coordination work in this epic
existed. A good part of what it asks for has since been built under other specs. This
section separates what is built from what is still missing, so the requirements cover only
the remainder.

### Built already

| What the issue asks | What exists | Where |
|---|---|---|
| A record of which session works on which spec and branch | One presence file per live session, carrying `scope`, `branch`, `worktreeRoot`, `specIds`, `fileAllowlist`, refreshed every 30 seconds (SPEC-026, session presence) | `packages/minspec/src/lib/presence.ts:56-68`, `:46-48` |
| Advisory only, no hard lock | Liveness is "seen within 120 seconds and process alive"; a dead session's record simply expires | `presence.ts:100` (`isRecordLive`) |
| Reading across worktrees | Every worktree of the clone is enumerated and each one's own presence directory is read | `presence.ts:342` (`listWorktreeRoots`), used at `:390` |
| Not double-working an issue | Issue and pull-request claims as expiring leases, arbitrated over GitHub (SPEC-044, coordinated sessions). Networked, development-time scripts, not the extension | `scripts/lib/issue-lease.sh`; `presence.ts:140-204` |
| Catching a duplicate decision-record id | An offline duplicate check in the validator, plus a cross-pull-request check in CI that is advisory | `scripts/lib/dr-id-collision.ts:22-36`; `.github/workflows/dr-id-collision.yml` |
| Catching a duplicate spec id | An offline duplicate check in the validator, fatal, over one checkout only | `scripts/lib/spec-id-collision.ts`; `scripts/validate-frontmatter.ts:43` |

### Still missing — the two halves of this spec

**1. Nothing prevents a duplicate number; everything only detects one, afterwards.** All
three allocators compute the highest number in one working tree plus one:

- `nextSpecId` — `packages/minspec/src/lib/spec-manager.ts:210-223`
- `nextAdrNumber` — `packages/minspec/src/lib/adr-manager.ts:105-120`
- `nextEpicNumber` — `packages/minspec/src/lib/epic-manager.ts:428-440`

Each is correct in isolation. Two sessions in two worktrees each compute the same number,
each correctly, and neither can see the other. The comments on both collision gates say this
in so many words and conclude that "the collision has to be caught rather than avoided"
(`scripts/lib/spec-id-collision.ts:16-20`).

Measured in this clone on 2026-10-03, with no network call: listing the spec directories on
every remote-tracking branch shows **18 different specs all named `SPEC-097-…`**, on 18
different branches, each produced by a separate dispatched session that was told to take
"the next unused number" (`scripts/dispatch-issue.sh:795`) and could see only its own
working tree. The highest id on any branch is `SPEC-121`; the highest on the default branch
is `SPEC-096`. This spec's own id was chosen by running that same listing by hand — which is
the procedure FR-1 turns into code.

There is also no cross-pull-request check for spec ids at all: the only workflow that
matches `spec-id-collision` or `dr-id-collision` under `.github/` is the decision-record one.
And an agent session has no way to ask for a number: creation is reachable only from the
Command Palette (the gap #1948 "no headless path to create a decision record" names).

**2. The presence record is written, but nothing shows it against an artifact.** The
signpost command builds its answer from the artifact graph alone
(`packages/minspec/src/commands/next-task.ts:24-30`); a search of
`packages/minspec/src/views/status-bar.ts` for `presence`, `peer` and `readAllRecords`
returns no match. So a second session is pointed at a spec with no sign that another session
is mid-edit on it. Three further gaps sit behind that one:

- The record names specs only (`specIds`). Decision records, epics and issues cannot be
  claimed.
- The contention reader looks only at sessions **in the same working tree**
  (`presence.ts:428`). That is right for its purpose (a file clobber needs a shared tree),
  and wrong for this one: once #168 (worktree per session) holds, the peer working on the
  same spec is by construction in a **different** tree.
- A headless session writes no presence record at all: the record's `pid` is the editor's
  extension host (`presence.ts:725`), and a dispatched agent has no editor. In this clone
  that is the common case — `git worktree list` reports 358 worktrees.

### Root cause, and the gate that is missing

*Symptom:* duplicate ids; two sessions drafting the same artifact.

*Mechanism:* allocation reads a single working tree, and the claim record has no reader at
the point where work is chosen.

*Missing gate:* a reserve step that is atomic across every worktree of the clone, and a
commit-time check that refuses a newly added number another branch or worktree already
carries. A prose rule ("take the number from the collision gate") exists in this repo's
`CLAUDE.md`; 18 sessions on one number is the measured result of relying on it.

### One fact that shapes the design

The issue suggests a counter or a `sessions.json` under `.minspec/`. `.minspec/` lives in
the **working tree**, so each worktree has its own copy, and local state there is gitignored
(`packages/minspec/src/lib/scaffold.ts:282`). A counter under `.minspec/` is therefore
visible to exactly one session and arbitrates nothing. The comment at `presence.ts:330-334`
records the same trap for presence. Whatever arbitrates must live where every worktree of
the clone looks: the shared git directory (`git rev-parse --git-common-dir`), or git's own
ref store.

## Functional Requirements

Requirements are written under the recommended answer to each question in
[Decisions needed (Clarify)](#decisions-needed-clarify). "The clone" means one git
repository on one machine together with all of its worktrees.

### Part A — collision-safe allocation

- **FR-1 (the known-ids set is every id the clone can see, not one working tree).** For a
  given register (spec, decision record, epic), the set of taken numbers is the union of:
  1. files in this working tree (today's behaviour);
  2. files in every other worktree's working tree, committed or not;
  3. every local branch and every remote-tracking ref **already present** in the clone,
     read from git's object store;
  4. live reservations (FR-2).

  The candidate number is the highest of that union plus one. Every read is local. The
  allocator MUST NOT fetch, list a remote, or call a forge: a ref that has not been fetched
  is not seen, and FR-9 says so to the reader rather than hiding it.
- **FR-1a (range scoping is preserved).** `nextSpecId` scopes its range by product when one
  is given (`spec-manager.ts:198-205`). The allocator keeps each creator's present scoping;
  the register key used by FR-1 and FR-2 includes the scope, so two products that
  legitimately share a number do not block each other.
- **FR-2 (reserve, then write — one winner).** Before any artifact file is written, the
  allocator creates a reservation for the candidate number in a store shared by every
  worktree of the clone, using an operation the operating system or git makes atomic
  ("create only if absent"). If the create reports the reservation already exists, the
  allocator recomputes the candidate and tries again. Retries are bounded (a named
  constant); exhausting them fails visibly with the last number tried and never falls back
  to an unreserved number.
- **FR-3 (the reservation carries the artifact skeleton with it).** The same operation that
  wins the reservation writes the artifact's skeleton at its final path — the directory and
  `requirements.md` with `id:` frontmatter for a spec, the `DR-NNN` file for a decision
  record, the `EPIC-NNN` file for an epic. From that moment FR-1 item 2 sees the number in
  the working tree, so the reservation only has to cover the instant between winning and
  writing. A session that then spends an hour drafting holds its number through the file,
  not through a timer.
- **FR-4 (a reservation expires and cannot wedge anything).** A reservation is ignored once
  it is older than a named time-to-live (default 15 minutes). It is never a lock: it stops
  no edit, commit or approval, and its only effect is to remove one number from the
  candidates. A session that crashes after reserving and before writing costs nothing — the
  number returns to the pool at expiry. Expired reservations are deleted opportunistically
  by the next allocation. Deleting the whole store at any time MUST be safe: the allocator
  then works from FR-1 items 1 to 3.
- **FR-5 (reservation record — contract).**

  ```typescript
  /** One reserved artifact number. Local to the clone; never committed, never pushed. */
  interface IdReservation {
    kind: 'spec' | 'dr' | 'epic';
    scope: string;        // range scope per FR-1a; '' for a register with a single range
    id: string;           // canonical id as the creator formats it, e.g. 'SPEC-122'
    path: string;         // repo-relative path of the skeleton written by FR-3
    worktreeRoot: string; // git top level of the reserving worktree
    branch: string;       // branch at reserve time; '' when detached
    sessionId: string;    // MINSPEC_SESSION_ID when set, else ''
    reservedAt: string;   // ISO-8601 UTC, millisecond precision
  }
  ```

  A record that does not parse is treated as a **live** reservation for the number its name
  carries (the cautious direction: skip one number) and is reported, not silently dropped.
- **FR-6 (all three creators use the one allocator).** `createSpec`, `createAdr` and the
  epic creator obtain their number only through the allocator. No other code path in
  `packages/minspec/src` computes highest-plus-one for these registers; a test enumerates
  the call sites so a fourth cannot be added unnoticed.
- **FR-7 (a headless way to take a number).** `npm run allocate-id -- <spec|dr|epic> --slug
  <slug> [--product <name>]` performs FR-1 to FR-3 from a terminal with no editor and prints
  one JSON object: the id, the path of the skeleton, and the FR-9 coverage note. It follows
  the shape SPEC-076 (headless signpost reader) set for `npm run next-task`: it calls the
  same library function the extension calls and refuses a root with no `.minspec/` marker.
  It writes only the reservation and the skeleton.
- **FR-8 (the dispatcher hands out the number; the agent does not guess one).** The
  specify-phase dispatch in `scripts/dispatch-issue.sh` obtains the id through FR-7 inside
  the agent's worktree before the agent starts and names that id and path in the prompt, in
  place of the instruction to find "the next unused number" (`dispatch-issue.sh:795`). This
  is the consumer that produced the 18-way collision measured above.
- **FR-9 (say what the allocator could not see).** Every allocation result carries a
  coverage note: how many worktrees and refs were read, and the age of the newest
  remote-tracking ref. The editor shows it only when it matters — remote-tracking refs
  older than a named threshold, or a worktree that could not be read. Wording states the
  observation ("remote branches last updated 9 days ago; a newer id may exist there"), never
  a guarantee of uniqueness.
- **FR-10 (commit-time backstop — the gate that binds an agent).** The shipped pre-commit
  hook refuses a commit that **adds** an artifact number (one absent from the commit's
  parent) when another worktree or any ref in the clone already carries that number at a
  **different path**. The refusal prints the holder (branch or worktree and path) and the
  next free number per FR-1. The same number at the same path on another ref is the same
  artifact and is never a collision. If the hook cannot enumerate worktrees or refs it fails
  closed with a message naming what it could not read; `MINSPEC_ID_GATE_OFF=1` is the
  intentional bypass, matching the existing `RCDD_GATE_OFF` and `SECRET_GATE_OFF` shape. The
  hook's definition of "taken" MUST be the allocator's: one implementation, or two held
  together by a parity test (the SPEC-026 FR-14 precedent).
- **FR-11 (existing gates stay).** The validator's duplicate checks and the
  cross-pull-request check in CI are unchanged. They are the second, independent witness for
  what this spec cannot reach: a second clone, a second machine, a branch never fetched.

### Part B — advisory work claims

- **FR-12 (a claim is evidence that an artifact is in hand elsewhere — two sources).**
  - *Declared:* a live presence record (SPEC-026) from any worktree of the clone naming the
    artifact, or an unexpired reservation (FR-5) for it.
  - *Derived:* a worktree other than this one whose branch has uncommitted or unmerged
    changes, relative to the default branch, to that artifact's own files.

  Derived claims exist because headless sessions declare nothing; they need no new file and
  cannot go stale independently of the work they describe.
- **FR-13 (claims may name any artifact kind).** The session state gains an optional
  `claims: string[]` accepting `SPEC-NNN`, `DR-NNN`, `EPIC-NNN` and `#N` (an issue, held as
  an opaque local string — no lookup). The presence record carries it as an optional field.
  Absent means empty; the existing `specIds` field keeps its meaning and is read as claims
  too. The addition is backwards compatible in both directions: the present reader requires
  only the fields it lists (`presence.ts:250-266`) and ignores extras.
- **FR-14 (claims are populated by the tool, not by memory).** Creating an artifact through
  the allocator adds its id to the creating session's claims. No requirement here depends on
  a session remembering to declare what it is working on; a session that declares nothing is
  still covered by the derived source.
- **FR-15 (the claim view — contract).** A pure function in `work-claims.ts` takes the
  presence records, reservations and per-worktree git facts as **inputs** and returns:

  ```typescript
  interface WorkClaim {
    artifactId: string;                // 'SPEC-044', 'DR-067', 'EPIC-009', '#176'
    source: 'declared' | 'derived';
    liveness: 'live' | 'unknown';      // 'live' only from SPEC-026's isRecordLive
    branch: string;
    worktreeRoot: string;
    sessionId: string;                 // '' when derived
    scope: string;                     // the session's one-line scope; '' when unknown
    observedAt: string;                // lastSeen, reservedAt, or the newest change time
  }
  ```

  Output order is deterministic (artifact id, then source, then `worktreeRoot`). The
  function performs no file, git or network access itself; the reads live in its caller, so
  it is tested by calling it. Liveness is not redefined here — it is SPEC-026's predicate.
- **FR-16 (shown beside the signpost, never inside the choice).** When the next task's
  target, or the spec that owns it, has a claim from another session or worktree, the
  signpost appends one line under the imperative:
  - declared and live: `SPEC-044 in progress — "<scope>" on branch <branch>`
  - anything else: `Branch <branch> has unmerged changes to SPEC-044 (last change <age> ago;
    no live session seen)`

  The resolver's choice of task is unchanged (see DQ-3). The same lines appear in the
  status-bar tooltip, and `npm run next-task` gains a `claims` array on each answer.
- **FR-17 (wording never overstates).** "In progress" is used only for a declared claim
  whose liveness is `live`. Every other claim is described as what was observed, with its
  age. A claim whose evidence could not be read is omitted and counted in a single
  "N worktrees could not be read" line; it is never rendered as "no one is working on this".
- **FR-18 (warn at the moment of overlap).** When a session's own claims come to include an
  artifact that another **live** session has declared, the editor shows one non-modal
  notification naming the artifact, the other session's scope and its branch. Once per
  artifact per session. It blocks nothing.
- **FR-19 (claims never delay the signpost).** The signpost renders from the artifact graph
  first. Claims are gathered afterwards and off the render path, and are cached per
  heartbeat interval. A slow or failed gather leaves the signpost exactly as it is today.
  The Plan phase measures the gather on a clone of this size (358 worktrees, 289
  remote-tracking refs) and sets the budget from that measurement.

## Acceptance Criteria

1. **Concurrent allocation yields distinct ids.** Eight processes, each in its own worktree
   of one clone, allocate a spec at the same instant: eight different ids, eight skeletons,
   no error. The same test with the atomic create replaced by a plain write MUST fail — the
   test names that mutation and is run against it, so it cannot pass while inert.
2. **An id on another branch is seen.** With `SPEC-130-foo` present only on a local branch
   or remote-tracking ref, and absent from every working tree, allocation returns `SPEC-131`.
3. **An uncommitted id in another worktree is seen.** Same, with the directory present only
   as untracked files in a sibling worktree.
4. **No wedge.** A reservation with no skeleton is ignored after the time-to-live and its
   number is handed out again. With the store deleted mid-run, allocation still succeeds.
5. **Corrupt reservation.** An unparseable record makes the allocator skip that number and
   report the file; it neither throws nor reuses the number.
6. **Scoped ranges.** Two products each allocating their first spec both receive `SPEC-001`.
7. **Single allocator.** A test fails if any file under `packages/minspec/src` other than
   `id-allocator.ts` computes a next number for the three registers.
8. **Headless.** `npm run allocate-id -- spec --slug x` prints one JSON object and creates
   the skeleton; on a root with no `.minspec/` it exits non-zero, writes nothing, and says
   why.
9. **Dispatch.** A specify-phase dispatch prompt contains a concrete reserved id and path
   and no longer contains the words "the next unused number"; two dispatches started
   together receive different ids.
10. **Backstop.** A commit adding `SPEC-130-bar` while a sibling worktree or any ref holds
    `SPEC-130-foo` is refused, naming the holder and the next free id. A commit carrying
    `SPEC-130-foo` at the same path as another ref passes. With worktree enumeration made to
    fail, the commit is refused with a message naming the failure; with
    `MINSPEC_ID_GATE_OFF=1` it passes.
11. **Parity.** For a table of fixture clones, the hook and the allocator agree on the set of
    taken numbers.
12. **Declared claim across worktrees.** A live presence record in worktree B naming
    `SPEC-044` makes worktree A's signpost for `SPEC-044` carry the "in progress" line with
    B's scope and branch. When B's record goes stale, the line no longer says "in progress".
13. **Derived claim.** A sibling worktree with uncommitted edits to `SPEC-044`'s files and no
    presence record yields the "has unmerged changes" line, with an age.
14. **The choice is untouched.** For every fixture in the SPEC-012 (next-task resolver) test
    corpus, `resolveNextTask` returns byte-identical output with and without claims present.
15. **Old and new records mix.** A presence record without `claims` is read as having none;
    a record with `claims` is accepted by the unmodified SPEC-026 reader.
16. **Offline.** The allocator, the claim gather and the hook complete with networking
    disabled, and a test asserts that no `git` subcommand they spawn is one that contacts a
    remote (`fetch`, `pull`, `push`, `ls-remote`, `remote update`).
17. **Opt-in.** In a repository with no `.minspec/` marker, no reservation, skeleton, claim
    or store directory is written by any path in this spec.

## Invariants (must not break)

- **INV-1 (offline — constitution invariant 1).** No network call. Git is used only for
  local reads and, under DQ-1 option B, a local ref write.
- **INV-2 (blast radius — constitution invariant 3, SPEC-096).** Every write is inside the
  opted-in repository (its working tree or its own git directory) and only when `.minspec/`
  exists at the root. Nothing here creates `.minspec/`.
- **INV-3 (no silent gate — constitution invariant 2).** The FR-10 backstop fails closed and
  visibly on an unreadable witness. Its bypass is explicit and named.
- **INV-4 (advisory means advisory).** No claim and no reservation ever blocks an edit, a
  commit, an approval or a phase advance. The one thing in this spec that blocks is FR-10,
  and only for a newly added duplicate number.
- **INV-5 (nothing can wedge).** No state written here needs a live owner to release it.
  Every record expires or is superseded by the artifact itself, and deleting all of it is
  always safe.
- **INV-6 (the resolver stays pure and deterministic — SPEC-012 FR-1, FR-11).** Claims do
  not enter `resolveNextTask` and do not change its output.
- **INV-7 (never wrong).** A claim line states observed evidence and its age. The allocator
  states what it could not see. Neither asserts uniqueness or absence beyond what was read.
- **INV-8 (a visible id is never reused).** A number carried by any working tree or ref the
  clone can read is never handed out again while it is visible.
- **INV-9 (small).** No daemon, no background process beyond the existing 30-second
  heartbeat, no new dependency.
- **INV-10 (one liveness definition).** "Live" is SPEC-026's `isRecordLive`; this spec adds
  no second predicate.

## Decisions needed (Clarify)

Each question carries a recommendation and what the recommendation costs. The requirements
above are written under the recommended option in every case. No human has chosen these:
they are an agent's recommendations, and approving this spec is what ratifies them.

### DQ-1 — Where reservations live

The store must be visible to every worktree of the clone, which rules out the working tree.

- **A — a directory of small files inside the shared git directory (rec).** One file per
  reservation, created with the operating system's "create only if absent". *Cost:* MinSpec
  writes inside `.git/`, a place users do not expect a tool to write and that this project
  has not written before; and the mechanism can never be extended to a second clone, so
  #267 (ids across clones) needs a different one.
- **B — git refs.** One ref per reservation under a private namespace, created with git's
  own compare-and-set. *Cost:* the refs show up in `git for-each-ref` and in graphical git
  tools, and a mirror push would publish them. *What it buys:* the same primitive could
  later be pushed to arbitrate across clones.
- **C — a counter under `.minspec/`, as the issue suggests.** *Cost:* it does not work —
  each worktree has its own `.minspec/` (see "One fact that shapes the design"). Listed
  because the issue names it.

### DQ-2 — Does the commit-time backstop block, or only warn?

- **A — block, with a named bypass (rec).** *Cost:* a forgotten local branch that carries a
  number holds that number for as long as the branch exists; a session is told to take the
  next one. Numbers are skipped more often, and the decision-record sequence check already
  warns on gaps (`packages/minspec/src/lib/adr-manager.ts:381`), so skipped
  decision-record numbers add standing warnings.
- **B — warn only.** *Cost:* this is the prose-rule shape that produced 18 sessions on one
  number; an agent that does not read the warning commits the duplicate.

### DQ-3 — Does a claim change which task the signpost picks?

- **A — annotate only (rec).** The signpost picks as it does today and adds the claim line.
  *Cost:* a person can still be sent to an artifact another session is mid-edit on, and has
  to read the extra line to notice.
- **B — skip a task whose target is claimed by a live session.** *Cost:* the resolver stops
  being a pure function of the artifact graph, which SPEC-012 (next-task resolver) forbids;
  and a wrong or lingering claim hides a task with nobody told, which is the wedge the issue
  rules out.

### DQ-4 — Are derived claims in this spec?

- **A — declared and derived (rec).** *Cost:* one read-only git query per worktree, which at
  358 worktrees needs the budget and caching FR-19 calls for; and a derived claim cannot
  tell an abandoned branch from active work, so the line reports an age instead of saying
  "in progress".
- **B — declared only.** *Cost:* headless sessions, which are most of the sessions in this
  clone, are invisible, so the signpost line would rarely appear in the setup that motivated
  it.

### DQ-5 — Is the dispatcher change (FR-8) in this spec?

- **A — in this spec, as its own slice (rec).** *Cost:* this spec then edits
  `scripts/dispatch-issue.sh`, a development-time script that SPEC-044 owns and that many
  in-flight changes touch, so the slice carries merge-conflict risk.
- **B — a follow-up issue.** *Cost:* the measured 18-way collision keeps recurring until
  that issue is built, with the fix already available one call away.

### DQ-6 — Is T4 (complete ceremony — all phases) the right tier?

Classified T4 on mechanical scope: five new files, eleven modified, across the extension,
the shipped hook templates and the development-time scripts, with a new commit-time gate.

- **A — T4 (rec).** *Cost:* the full phase set, including a Clarify pass, for a change whose
  two halves are each small.
- **B — split into two T3 (full spec cycle) specs, allocation and claims.** *Cost:* a second
  spec id and a second approval for work that shares its worktree-enumeration code.

## Why no new DR

Nothing here passes the irreversibility filter. The reservation store is local, uncommitted
state that expires by itself; moving it (DQ-1 A to B, or back) is a change of one module
with no data to migrate. The claim field is additive and optional. The signpost line is
display. The directions these rest on — presence as an expiring lease, worktree isolation
for code, a deterministic signpost — are already decided in DR-067, DR-051 and DR-019. If
DQ-3 is answered B, that contradicts SPEC-012's purity requirement and DR-019, and a record
or an amendment becomes due before the Plan phase.

## Delivery slices (ordering is load-bearing)

1. **The allocator slice** — FR-1 to FR-6, FR-9, FR-11. Closes the race for anything created
   through the editor.
2. **The headless-and-dispatch slice** — FR-7, FR-8. Closes the measured collision source.
3. **The backstop slice** — FR-10. Lands after the first two so a refusal always has a
   working "take the next number" path to point at.
4. **The claims slice** — FR-12 to FR-19. Independent of the first three except for reading
   reservations as declared claims.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| "Create only if absent" is not atomic on some network filesystems | Out of scope with SPEC-026's cross-machine case; FR-11 keeps the validator and CI checks as the independent witness |
| Remote-tracking refs are stale, so the allocator reuses a number taken elsewhere | FR-9 reports their age; the cross-pull-request check still catches it; #267 is the real fix |
| A stale branch holds a number forever under FR-10 | The refusal names the holder so the branch can be deleted; numbers are cheap; DQ-2 states this cost |
| Reading 358 worktrees makes allocation or the signpost slow | Allocation reads directory listings only; claims are off the render path and cached (FR-19); budget set by measurement in Plan |
| The hook and the allocator drift apart | One implementation or a parity test (FR-10, criterion 11) |
| A derived claim reads as an accusation that someone is active | FR-17 wording: observation and age, "in progress" reserved for live declared claims |
| Writing inside `.git/` surprises a user | Named in DQ-1 as the cost of the recommended option; the store is documented, self-expiring and safe to delete |

## Costly to Refactor

- **The meaning of "taken"** (FR-1). The allocator, the hook and, later, #267 all key on it.
- **The `claims` field name and accepted id forms** (FR-13). It is written by every session
  and read by every other; a rename needs both directions of compatibility again.
- **The claim line wording** (FR-16, FR-17). People learn to act on it; changing what
  "in progress" means later changes what they should trust.

Cheap to change: the store location, the time-to-live, retry counts, cache interval.

## Out of Scope

- **Any message passing between sessions.** SPEC-027 (inter-session comms) owns the one
  courtesy protocol that exists; this spec adds none.
- **Hard locks of any kind**, and anything that needs a live owner to release it.
- **Ids across clones or machines.** #267 (collision-proof ids minted at merge). This spec
  is the same-clone half that the epic names as its counterpart.
- **Renumbering the specs that already collide** on open branches (the 18 `SPEC-097`
  claimants and any others).
- **A cross-pull-request check for spec ids in CI.** The decision-record register has one;
  the spec register does not. Related, networked, and separate.
- **Shipping a headless allocator to adopter repositories.** FR-7 is this repository's
  development-time script, as SPEC-076's reader is. For adopters, FR-10 is what binds an
  agent; a shipped headless create path is #1948.
- **Issue and pull-request claims over GitHub.** SPEC-044 owns them. An issue number in
  `claims` is a local string only.
- **Same-file edit contention and branch-moved-under-you detection.** SPEC-026 and the
  in-flight SPEC-120 (concurrent-session git guardrail, #168).
- **Changing the heartbeat, its interval or its liveness rule.**

## Alternatives considered and rejected

- **A single `.minspec/sessions.json`**, the issue's sketch. One shared file is a write race
  between sessions — the reason SPEC-022 moved approvals to one file per spec — and under
  worktree isolation it is not shared at all. The per-session presence files already built
  are the same idea without either defect.
- **A lock file held for the life of the session.** Wedges on a crash; the issue rules it
  out.
- **Take the number at merge only.** Removes the race entirely but needs a network round
  trip and renames after review; it is #267's design space and does not help a session that
  must name its artifact now.
- **Random or timestamp ids.** No collisions, but breaks the sequential, human-readable
  registers and every existing reference.
- **A dedicated claim file per artifact.** A second record that can disagree with the
  presence record and with the branch; derived claims give the same answer with nothing to
  keep in step.
- **Fetch before allocating.** Would shrink the stale-ref window, but is a network call
  without consent (constitution invariant 1).

## Follow-ups to file

This dispatch may not create issues; these need filing when the spec is approved.

- Renumber the open branches that share a spec id (18 on `SPEC-097` at the time of writing).
- A cross-pull-request spec-id check in CI, mirroring the decision-record one.
- Decide whether the decision-record gap warning should ignore numbers skipped by a
  reservation (only if DQ-2 is answered A and the warnings prove noisy).

## Traceability

- Issue: [#176](https://github.com/AIClarityAU/minspec/issues/176). Primary fix it sits on:
  #168 (worktree per session; in flight as SPEC-120).
- Counterpart: #267 (ids across clones), named in
  [EPIC-009](../../../docs/epics/EPIC-009-team-readiness.md).
- Prior detection gates this spec complements: #1226 (decision-record id collision),
  #1418 (spec id collision).
- Builds on: [SPEC-026](../SPEC-026-session-presence/requirements.md),
  [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md),
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md),
  [SPEC-076](../SPEC-076-headless-signpost-reader/requirements.md).
