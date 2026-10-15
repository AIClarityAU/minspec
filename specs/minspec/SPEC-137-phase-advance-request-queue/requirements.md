---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - same epic as DR-057, whose phase-advance enqueue this hardens
aspects: [queue, phase-advance, idempotency, dedup, tier-0, offline, no-llm, gitignored, blast-radius, no-silent-gate]
depends_on: [DR-057, DR-004, SPEC-096]  # DR-057 s2 decides the queue exists; DR-004 the Tier-0 no-LLM rule; SPEC-096 the opt-in marker creator
relates_to: [SPEC-022, SPEC-012, SPEC-026, SPEC-062, DR-015, "#712", "#731", "#733", "#732", "#734", "#735", "#738"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Phase-advance request queue - one file per request, deduplicated by spec path and upstream hash

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and approves it through the normal spec-approval gate before any design or code.

Issue: #731 (sub-issue of #712, "drain actions approved-doc phase-advance"). Design
rationale: DR-057 section 2 ("The drain DETECTS + ENQUEUES; generation runs in a
CC-session/dispatch consumer"). This spec decides nothing DR-057 did not already decide;
it pins the queue's *shape and idempotency*.

## In plain terms

When a spec is approved, the editor drops a small note into a local folder saying "this
spec is ready for its next phase". A different program (the one allowed to run an LLM)
later picks the note up and writes `tasks.md`. The note-dropper never calls an LLM. This
spec makes the note-dropping safe to repeat: approving the same text twice leaves one
note, approving after an edit leaves a new one, and two sessions never overwrite each
other's note. Cost: a second request format to read. Left out: the consumer, the drain
sweep, the toast.

## Where the code stands today (verified, not assumed)

`packages/minspec/src/lib/phase-advance-queue.ts` already exists (landed with #733, the
Alt-A toast). It is **path-keyed, not hash-keyed**: `queueRequestPath` maps
`specs/x/requirements.md` to `.minspec/queue/specs/x/requirements.md.json`, and
`enqueuePhaseAdvance` overwrites that one file with a fresh `requestedAt` every call
(`phase-advance-queue.ts:44-67`). Its own header says "full dedup by upstream spec hash is
`.minspec/queue/`'s own follow-up (#731/#738)". `.minspec/queue/` is already ignored
(`.gitignore:73`) and the directory is created through `ensureDirectory`, which refuses to
create the `.minspec/` opt-in marker (SPEC-096). The one caller is
`approve.ts:191-193` (`source: 'alt-a-toast'`). So #731 is a **hardening of an existing
primitive**, not a greenfield one: the open gaps against the issue text are (a) no upstream
hash in the request, (b) no dedup by hash, (c) no unique per-request filename, (d) no
in-flight versus consumed state a consumer could use.

## Functional requirements

- **FR-1 - Location and ignore.** Requests live under `.minspec/queue/` only. The
  directory is gitignored and machine-local; it is never staged by commit-on-approve.
  The scaffold's ignore list (`MINSPEC_GITIGNORE_ENTRIES`, `scaffold.ts`) contains the
  entry so an adopter's repo ignores it too.
- **FR-2 - Request record.** Each request is one JSON file holding at least: `specPath`
  (repo-relative POSIX), `upstreamHash` (the canonical `specHash` of the approved
  document at enqueue time, the same function `recordApproval` uses, approval.ts:262),
  `requestedAt` (ISO), `source` (producer name), and `schema` (integer version).
- **FR-3 - One file per request, unique name.** The filename is derived from the spec id
  and a unique suffix (timestamp plus random), never from a shared key alone, so two
  concurrent sessions enqueuing never write the same path. Writes are create-exclusive
  (`wx`) so a name collision fails loudly instead of overwriting.
- **FR-4 - Idempotent dedup.** Before writing, the producer looks for an existing
  **in-flight** request with the same `specPath` AND the same `upstreamHash`. If one
  exists the call is a no-op and reports `deduplicated` (not an error, not a silent
  success: the return value says which happened). A re-approval after an edit has a
  different hash and enqueues a new request.
- **FR-5 - Superseded requests.** When a new request is written for a `specPath` whose
  older in-flight request has a different `upstreamHash`, the older one is marked
  superseded (see Decision D2) so a consumer never generates from stale text.
- **FR-6 - Tier-0 by construction.** The module imports only `fs`, `path`, the shared
  hashing function, and local helpers. It spawns no process and makes no network call
  (constitution invariant 1; DR-004; DR-057 section 2). A test asserts the import set.
- **FR-7 - Opt-in only.** In a folder without `.minspec/` the enqueue throws
  `NotOptedInError` and writes nothing (constitution invariant 3; SPEC-096 FR-5).
- **FR-8 - Failure is visible.** A write failure surfaces to the caller, who shows it
  (as `approve.ts:191-201` already does). No `catch {}` that discards the error (invariant
  2). A malformed or unreadable request file found during the dedup scan is reported, not
  skipped: the scan fails closed for that file by treating it as "not a duplicate" AND
  returning it in a `warnings` list, so a corrupt file never blocks a legitimate enqueue
  yet is never invisible.
- **FR-9 - Read side contract.** The module exports a pure `listPendingRequests(rootDir)`
  so the consumer (#732/#734/#735) reads one documented shape. Dequeue and generation are
  NOT part of this spec.
- **FR-10 - Migration of the existing path-keyed files.** Request files written by the
  current producer (no `upstreamHash`) are read as `legacy`: the consumer treats them as
  "hash unknown, always process once" and the producer never dedups against them.

## Acceptance criteria

- **AC-1.** Enqueue the same spec twice with unchanged content: exactly one request file
  exists after the second call; the second call returns `deduplicated`.
- **AC-2.** Enqueue, edit the spec body so `specHash` changes, enqueue again: two files
  exist and the older one is marked superseded (FR-5).
- **AC-3.** Two enqueues of different specs in the same millisecond produce two distinct
  files; two enqueues of the same spec and different hashes in the same millisecond also
  do (the random suffix; FR-3).
- **AC-4.** Editing only `status:` frontmatter does not change `upstreamHash`, so it does
  not create a second request (canonicalization strips it; verified by calling `specHash`,
  not by reading prose).
- **AC-5.** In a temp dir with no `.minspec/`, enqueue throws `NotOptedInError` and the
  directory listing is unchanged.
- **AC-6.** The module's import list contains no `child_process`, `http`, `https`, `net`
  or `vscode`.
- **AC-7.** `git status` after an enqueue shows no change (the queue is ignored), and
  `git check-ignore --no-index .minspec/queue/x.json` matches.
- **AC-8.** A hand-corrupted request file in the queue does not stop an enqueue and
  appears in the returned `warnings`.
- **AC-9.** A pre-existing path-keyed request (current format) is listed as `legacy` and
  does not suppress a new enqueue.

## Invariants this change must not break

- Core works offline; no network call (invariant 1).
- No silent gate: no swallowed error on the write or the dedup scan (invariant 2). Note the
  queue is advisory transient intent, not a gate; the approval sidecar stays the only
  ground truth (DR-057 section 5), so a lost request must degrade to "the next sweep
  re-detects it", never to "a phase is skipped".
- Blast radius: nothing is written where `.minspec/` is absent (invariant 3).
- The existing `approve.ts` caller keeps working: its signature change must be
  backward compatible or updated in the same change.

## Out of scope

The consumer and generation (#732/#734/#735); the drain-sweep producer (#738); the
Alt-A toast (#733, shipped); `design.md` lane; any change to SPEC-026's mailbox.

## Decisions needed (Clarify)

**D1 - Filename scheme versus the existing path-keyed layout.**
- **(rec) A: flat directory, `<specId>-<UTC timestamp>-<random>.json`.** Matches the
  issue text ("specId + timestamp/uuid"); no nested directories to create; a consumer
  lists one folder. Cost: the repo-relative path is only inside the file, so finding "the
  request for this spec" needs a scan (cheap at queue sizes, but not a path lookup), and
  the shipped nested layout is abandoned (migration under FR-10).
- B: keep the nested path-keyed layout and add the hash to the filename
  (`.../requirements.md.<hash8>.json`). Cost: keeps the lookup by path and no migration,
  but two sessions enqueuing the same spec and hash race on one name (resolved only by
  `wx`, which turns a harmless duplicate into an error), and it does not meet the issue's
  "unique name" wording.

**D2 - What "in-flight" and "superseded" mean on disk.**
- **(rec) A: state is a field plus a sibling directory**: consumer moves a request to
  `.minspec/queue/done/` when finished; superseded requests get `"superseded": true`
  written in place. Cost: the producer rewrites an existing file (a second write kind),
  and a consumer crash between generate and move leaves a request that re-runs once.
- B: producer deletes superseded files. Cost: loses the audit trail of what was asked,
  and deleting is a destructive act by a Tier-0 module in a folder the consumer owns.
- C: no superseded state; the consumer compares `upstreamHash` against the current spec
  hash and drops stale ones itself. Cost: every consumer must remember to do it, which is
  the "trust the model" shape the constitution warns about; the queue then accumulates
  stale files with no marker.

**D3 - Dedup window after consumption.** Should a request already consumed (in `done/`)
for the same path and hash block a new enqueue?
- **(rec) A: yes, within the last N days (suggest 7), by reading `done/`.** Prevents a
  re-approve loop regenerating `tasks.md` from identical input. Cost: if the generated PR
  was rejected and the human wants a retry, the enqueue is silently-looking a no-op (it
  returns `deduplicated`, with the reason `consumed`, so it is visible, but needs a
  `force` path).
- B: no, only in-flight blocks. Cost: identical input can regenerate repeatedly.

**D4 - New SPEC or amend existing?** No spec currently owns `phase-advance-queue.ts`
(grep of `specs/` finds it named only in SPEC-096's ownership notes). This draft mints
SPEC-137; the alternative is to fold it into a SPEC-062 amendment. Recommended: keep it
separate (**rec**), at the cost of one more document to keep in step with DR-057.
