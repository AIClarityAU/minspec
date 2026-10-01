---
id: SPEC-027
type: requirements
# Re-opened 2026-10-01 by #388. The body below differs from the bytes approved on 2026-07-14
# (.minspec/approvals/specs/minspec/SPEC-027-inter-session-comms/requirements.md.json), so that
# approval no longer covers this document. Status returns to specifying until it is re-approved.
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [session-coordination, mailbox, release-request, courtesy-protocol, tier-0, offline, loop-safety, opt-in]
depends_on: [SPEC-026]  # presence record, liveness, sessionId, contention predicate, arbitration, HITL fallback
relates_to: [SPEC-044, DR-051, DR-037, DR-067, DR-073, DR-074, "#388", "#380"]  # SPEC-044/DR-067 = work-item leases (the sibling coordination layer) · DR-051 = approvables on main · DR-037 = managed hooks · DR-073 = contract for writing a foreign settings file · DR-074 = blast radius / opt-in
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). Both files
# are new. claude-settings.ts is touched only under DQ-2's recommended option.
implements: [packages/minspec/src/lib/mailbox.ts, packages/minspec/tests/mailbox.test.ts]
affects: [packages/minspec/src/lib/claude-settings.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-027: Inter-session comms - sessions resolve a file conflict between themselves (Tier 2)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, checks **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it
> through the normal spec-approval gate before anything is planned or built. Every
> requirement below is written under each decision's recommended option, so approving the
> spec as it stands accepts those recommendations. Choosing a different option changes only
> the requirements that decision names.

Materializes **[#388](https://github.com/AIClarityAU/minspec/issues/388)** (inter-session
comms, Tier 2 of the conflict ladder), itself a follow-up of
[#380](https://github.com/AIClarityAU/minspec/issues/380) (session presence). Tier 2 is the
middle rung of the ladder defined in
[SPEC-026 (session presence + concurrent-edit guard)](../SPEC-026-session-presence/requirements.md):
**prevent (Tier 1), then sessions resolve it themselves (Tier 2, this spec), then a human
resolves it (Tier 3)**. The original ask: *"session X asking session Y if they're still
working on file Z or whether they can release it."*

## Why this document changed - read this first

Issue #388 describes this spec as a stub with `status: new`. **That is out of date.** The
spec was fully written in July (commit `5876e4fc`), approved by the founder on 2026-07-14,
and has sat at `status: planning` since. Nothing has been built from it: no `mailbox.ts`
exists, and the only mention of the id under `packages/` or `scripts/` is an unrelated test
that uses "SPEC-027" as a made-up fixture name
(`packages/minspec/tests/view-phase-file-command.test.ts`).

This dispatch re-read the approved text against the code as it stands today (base commit
`27661a68`) and found that the approved design **cannot work on the substrate that was
actually built**, and has one hole of its own. Rather than leave an approved spec that a
later build would trip over, this revision corrects it and puts the resulting choices in
front of the human. **The price is that the July approval no longer covers this text.**

| What | Approved in July | This revision | Why |
|---|---|---|---|
| Prerequisites | "Depends on SPEC-026" in one line | **FR-0** names three conditions that must be observably true before Plan starts | Three of the things the protocol reads do not exist in code (see the table below) |
| Who listens | A CLAUDE.md instruction asks each agent to check its inbox every turn | **FR-7**: shipped code puts a pending request in front of the agent; prose only says how to answer | Constitution principle 8, *"Don't hope an LLM will follow rules - enforce it via code"* (`.minspec/constitution.md:22`). Put to the human as DQ-2 |
| Who may ask | Either session; two independent exchanges when both overlap | **FR-2**: only the session that arbitration would block | Two symmetric exchanges can end with both sessions releasing and neither holding the file |
| "Never ask twice" | Stated, but stored nowhere - the only record of a request is the request file, which FR-5 pruning deletes | **FR-2** adds a sent-ledger that pruning does not touch | Without it the load-bearing no-ping-pong property (INV-2) cannot be implemented or tested |
| Releasing a directory claim | "Removes the path" | **FR-3**: removes every claim entry that covers the path, whole, or answers `busy` | A claim can be a directory; "remove the path" is undefined for it |
| Message text reaching an agent | Not addressed | **FR-8**: nothing from a message file is shown to an agent except validated fields in a fixed template | The inbox is a file any local process can write; its contents land in an agent's context |
| Opt-in boundary | Not addressed | **FR-9**: no write unless `.minspec/sessions/` already exists | Constitution invariant 3 (blast radius), added after the July approval |
| Gitignore entry | "Add `.minspec/sessions/mailbox/` to `MINSPEC_GITIGNORE_ENTRIES`" | Dropped | The existing `.minspec/sessions/` entry (`packages/minspec/src/lib/scaffold.ts:281`) already covers the subdirectory |

The two decisions the founder made in July (auto-shrink on release, 60-second timeout) are
**carried forward unchanged** - see [Carried-forward decisions](#carried-forward-decisions).

## One-Sentence Scope

When SPEC-026's commit backstop would block a session because a live peer in the same
working tree claims the file, let that session ask the peer once, through a local file
mailbox, whether it has finished with the file - so the common "I was done, I just had not
dropped my claim" case clears without a human, and everything else falls through to the
existing human path unchanged.

## Context - what the code does today (read at `27661a68`, not inferred)

Every row is something this dispatch opened and read. Where a row reports an absence, the
terms searched are named, because an absent search term is not an absent feature.

| # | Observation | Evidence |
|---|---|---|
| P1 | The contention predicate exists but nothing calls it. | `contendingLiveSessions` at `packages/minspec/src/lib/presence.ts:340`. Searching `packages/`, `scripts/`, `.githooks/` and `.minspec/hooks/` for the name finds only its definition and its tests. |
| P2 | A session with an empty claim is never a contender. | `presence.ts:354` - `if (rec.fileAllowlist.length === 0) continue`. |
| P3 | Nothing an autonomous agent does populates a claim. | `createSession` defaults the allowlist to empty (`packages/minspec/src/lib/session.ts:164-172`), and its one caller passes none (`packages/minspec/src/commands/session.ts:64`). The only other writer is the human clicking "Add to Scope" on a drift toast (`packages/minspec/src/extension.ts:1036`). |
| P4 | Two sessions in the same working tree publish **the same** claim. | The heartbeat copies the claim from `loadSession(this.rootDir)` (`presence.ts:635`, `:644`), and that is the single file `.minspec/session.json` per folder (`session.ts:28`). SPEC-026's Context says "each session has its own `session.json`"; the code has one per working tree. |
| P5 | A "session" is one editor window, not one agent conversation. | `sessionId` is minted once per extension-host activation (`presence.ts:440`) and exported to that window's terminals as `MINSPEC_SESSION_ID` (`extension.ts:125-130`). Several agent conversations in one window share one id and one presence record. |
| P6 | Each working tree has its own `.minspec/sessions/` directory. | `presence.ts:269-275` (comment on `listWorktreeRoots`) and `scripts/drain-inbox.sh:434`. |
| P7 | The rest of SPEC-026's guard layer is specified, not built. | SPEC-026 is `status: planning`. No hits in `.minspec/hooks/` or `.githooks/` for `sessions`, `MinSpec-Session` or `MINSPEC_SESSION_ID` (the commit backstop, trailer hook and checkout guard would each contain one). No hits in `packages/minspec/src/` for `resolution prompt` or `Reveal worktree` (the Tier 3 human actions). `Concurrent-Session Etiquette` appears only in spec prose, in no template and not in this repo's CLAUDE.md. |
| P8 | Presence readers ignore anything that is not a presence record. | `presence.ts:218` skips every name not ending `.session.json`, so a `mailbox/` subdirectory is invisible to liveness and to the drain's sync gate. |
| P9 | Presence never creates the opt-in marker. | Every write and delete is gated on `isOptedIn()` (`presence.ts:484`, `:625`) and `sessions/` is created non-recursively (`presence.ts:630`). |
| P10 | MinSpec already ships one hook into an adopter's Claude Code settings, additively. | `packages/minspec/src/lib/claude-settings.ts:12`, `:39`, `:134` - one `UserPromptSubmit` entry (the session-title hook). |
| P11 | A headless dispatched agent has no presence at all. | The only presence writer is `SessionPresenceManager`, which lives in the extension host. The worktree this spec was written in has no `.minspec/sessions/` directory. |

**What follows from P2, P3 and P4 together.** The approved protocol starts when a peer's
claim covers a file, and ends when the peer shrinks "its own" claim. Today an agent session
never has a claim (P3), so the protocol never starts (P2); and if a human did add one, both
same-tree sessions would publish it (P4), so neither could release it without releasing it
for the other. These are gaps in SPEC-026's claim model, not in this spec's protocol, and
they are why FR-0 exists.

**What has moved around this spec since July.** SPEC-044 (coordinated self-completing
sessions) added *work-item* leases: a session claims an issue or pull request before
touching it. That coordinates **who works on which task**, across working trees, through
GitHub. This spec coordinates **who may commit which file**, inside one working tree,
through local files. They do not overlap, and neither replaces the other. Separately, this
repository now runs one session per working tree as a rule, which makes the same-tree
conflict this spec resolves uncommon *here* (I believe; nobody has counted). It remains the
normal case for an adopter running two or three editor windows on one checkout. DQ-1 puts
that trade-off to the human.

## Carried-forward decisions

Made by the founder in the July Clarify round. Unchanged; re-approving this spec re-accepts
them.

| # | Question | Resolution |
|---|---|---|
| C1 | Does answering "released" also change the answering session's claim, or is it only a reply? | **It changes the claim.** Answering `release-ack` removes the claim, and the peer sees that at the answering session's next heartbeat. FR-3 now states precisely what is removed. |
| C2 | How long does a request wait for an answer? | **60 seconds** - twice SPEC-026's 30-second heartbeat. Accepted false negative: a request is delivered at the start of the holder's next turn, so a live holder in the middle of a long turn can miss the window and the asker falls to the human path although the holder would have answered. Chosen over a longer wait or continuous polling because the fallback is safe and cheap. |

## Functional Requirements

Vocabulary: the **holder** is the session whose claim covers the file and which SPEC-026's
arbitration (its FR-13) would allow to commit. The **asker** is the session that arbitration
would block. A **claim entry** is one line of a session's `fileAllowlist`.

### FR-0 - Prerequisites (a gate on starting Plan, not something this spec builds)

Plan for this spec MUST NOT start until all three are true in code on `main`. Each is checked
by reading the code and citing `file:line`, never by an issue being closed or a spec
existing.

- **PRE-1 - Per-session claims.** Two live sessions in the same working tree can publish
  **different** `fileAllowlist` values, and one can change its own without changing the
  other's. Today they cannot (P4).
- **PRE-2 - A claim an agent actually makes.** There is a path by which an autonomous agent
  session ends up with a non-empty claim without a human clicking a toast. Today there is
  none (P3).
- **PRE-3 - The surfaces this protocol defers to exist.** SPEC-026's commit backstop and
  arbitration (its FR-12 and FR-13) and its human resolution path (its FR-16) are built.
  This protocol's only purpose is to clear a block faster than those do; with no block and
  no fallback it has nothing to do. Today none is built (P7).

PRE-1 and PRE-2 are defects or gaps in SPEC-026's claim model and belong to SPEC-026. They
are listed under [Follow-ups](#follow-ups) as issues that still need filing.

### FR-1 - Mailbox location and message shape

- The mailbox is `<working tree>/.minspec/sessions/mailbox/` - a subdirectory of the
  presence directory the two sessions already share (P6). It is covered by the existing
  gitignore entry; no new entry is added.
- A message to session R is one file under `mailbox/<R's sessionId>/`. No file name in the
  mailbox ends in `.session.json`, so presence readers never see one (P8).
- The mailbox directory is created only when the first request is sent. A repository where
  no conflict ever happens never contains it.
- Shape:

  ```typescript
  interface MailboxMessage {
    v: 1;                    // shape version; a reader skips any other value (FR-8, INV-6)
    id: string;              // UUID-v4
    from: string;            // sender sessionId
    to: string;              // recipient sessionId
    kind: 'release-request' | 'release-ack' | 'busy';
    path: string;            // the one repo-relative file this message concerns
    inReplyTo?: string;      // replies only: the id of the release-request being answered
    createdAt: string;       // fixed-width ISO-8601 UTC, ms precision (as SPEC-026 startedAt)
    expiresAt: string;       // requests only: createdAt + REQUEST_TIMEOUT_MS
  }
  ```

  There is **no free-text field**, deliberately (FR-8). There is no estimated-time field on
  `busy`: a promise nothing enforces is worse than no promise.
- Every write is atomic (temporary file in the same directory, then rename), the idiom
  SPEC-026 FR-3 already uses. No network. Tier 0.

### FR-2 - Sending a request (the asker; done by code, never composed by the agent)

- **Trigger.** A request is sent for file P from asker A to holder H exactly when SPEC-026's
  backstop conditions hold for P against H (H is live, in the same working tree, and a claim
  entry of H covers P) **and** arbitration would block A rather than H. This spec adds no
  second detector: it uses SPEC-026's predicate and SPEC-026's arbitration as they are.
- **Scope of files.** The same files the backstop guards - the approvable corpus
  (`specs/**`, `docs/decisions/**`, `docs/epics/**`, `docs/domain/**`). For code, the answer
  to a same-tree conflict is a separate working tree (Tier 1), not a conversation.
- **One direction only.** The holder never sends. Arbitration already lets it commit, so it
  has nothing to ask for, and letting both sides ask is how both end up releasing.
- **Sent by shipped code.** The request file is written by MinSpec code at the point where
  SPEC-026 reports the contention. An agent is never asked to hand-write message JSON.
- **Once, durably.** Before writing a request, the sender records it in its own sent-ledger:
  one entry per (holder sessionId, path), created with exclusive-create semantics so a
  second attempt fails rather than overwrites. If the entry already exists, nothing is sent.
  The ledger lives under the asker's own mailbox directory and is **not** subject to FR-5
  pruning: it lasts as long as the asker's session. One request per (asker, holder, path)
  for the life of both sessions - not re-opened when the request expires, not re-opened if
  the holder later re-claims the file.
- **Non-blocking.** Sending never waits. The asker carries on with other work and learns
  the outcome through FR-4.

### FR-3 - Answering a request (the holder)

- A request is answerable only while unexpired, addressed to this session, from a session
  that is still live, and naming a path that one of this session's claim entries covers.
  Anything else is not shown (FR-7) and is pruned (FR-5).
- The holder's agent chooses one of two answers. The choice is a judgment and stays with
  the agent; everything around it is code.
  - **`release-ack`** - "I have finished with this file." Shipped code then, in this order:
    (1) removes from this session's claim **every entry that covers the path**, whole;
    (2) only if that write succeeded, writes the reply. A `release-ack` on disk therefore
    always means the holder's stored claim no longer covers the path. If a covering entry
    is a directory the holder still needs for other files, releasing would drop those too -
    so the answer in that case is `busy`. Code never splits or rewrites an entry.
  - **`busy`** - "still working on it." No claim change.
  - When unsure, `busy`. It costs the asker nothing but a fall to the human path.
- **One reply.** The reply for a request is created with exclusive-create semantics keyed
  on the request's id. A second reply - for instance from another agent conversation in the
  same window (P5) - fails and is not retried.
- **The answer is one action.** The agent answers by invoking one shipped entry point with
  the request and the chosen answer; it does not edit claim files or write reply JSON
  itself. What that entry point is (a managed script alongside the DR-037 hooks, or another
  mechanism) is for Plan - see Open Questions.
- **`REQUEST_TIMEOUT_MS`** is a named constant, default 60 seconds (C2), kept beside
  SPEC-026's paired heartbeat constants.
- **Known limitation, unchanged from July - no take-back.** A holder that answers
  `release-ack` and later needs the file again has no way to warn the asker, who may already
  be editing. Mitigated only by answering `busy` when unsure.

### FR-4 - The asker learns the outcome (one round trip, no retry)

- The outcome is one of three, read from the ledger entry and the asker's own inbox:
  - **Released** - a `release-ack` for the request exists. The asker may commit once the
    holder's next heartbeat has published the shrunk claim (at most one heartbeat interval,
    30 seconds). Nothing in this spec makes the commit pass; SPEC-026's backstop simply no
    longer finds a claim.
  - **Busy** - a `busy` reply exists.
  - **No answer** - the request's `expiresAt` has passed with no reply, or the holder is no
    longer live.
- **Busy and no answer both fall to the human path** (SPEC-026 FR-16), which names the peer
  by its human-readable scope. The conflict message additionally says that a release was
  already requested and what came back, so the human is not asked to repeat a step the
  tooling already tried.
- The outcome is reported wherever SPEC-026 next reports the same contention (its advisory
  and its commit rejection). No separate notification channel and no extra state.
- **There is no path to a second request** - not from a reply, not from a timeout, not from
  the same conflict being detected again on a later turn. FR-2's ledger is what makes that
  true across time, including after the original messages have been pruned.

### FR-5 - Pruning

- A message is **dead** when its `expiresAt` has passed (requests), when the request it
  answers is recorded as resolved in the asker's ledger (replies), or when its addressee is
  no longer live under SPEC-026's liveness rule.
- A session prunes dead messages in **its own** inbox when it reads it. Best-effort; a
  failed delete is swallowed.
- A session's whole mailbox directory, ledger included, is removed when its presence record
  is pruned as dead, by whichever session does that pruning.
- A request to a holder that dies before answering is, to the asker, the same as a timeout.
  One fall-through, not two.

### FR-6 - Never contradicts SPEC-026's arbitration or backstop

- The protocol is a courtesy. No message, by existing, changes any backstop verdict. A
  `busy` grants nothing; a `release-ack` unblocks nothing by itself. The only channel of
  effect is the holder's own stored claim shrinking (FR-3), which SPEC-026 already treats as
  an ordinary claim change.
- It never overrides SPEC-026's worktree steer (its FR-9) or the approvables-on-main policy
  of DR-051.

### FR-7 - Delivery does not depend on the agent remembering (written under DQ-2 option b)

- A pending answerable request (FR-3) is put in front of the holder's agent at the start of
  its next turn **by shipped code**, with no reliance on a CLAUDE.md instruction being read
  and remembered.
- For Claude Code this is a hook entry MinSpec installs in the project's own
  `.claude/settings.json`, additively and under the DR-073 contract for writing a foreign
  file, exactly as the session-title hook is installed today (P10). It is never installed in
  a machine-wide settings file.
- The hook resolves "which session am I" from `MINSPEC_SESSION_ID`. With no resolvable
  session id, or no mailbox, it prints nothing and exits successfully. A headless agent with
  no presence (P11) is therefore untouched.
- A harness MinSpec ships no hook for, and a human-only window with no agent, are not
  reached. Their requests time out and fall to the human path. That is the stated limit, not
  a defect.
- Prose in the CLAUDE.md template is limited to **how to answer** a request once shown. It
  does not carry the obligation to look.
- If the hook is written in a second language (shell), any liveness or claim-coverage logic
  it repeats joins SPEC-026's existing two-engine parity fixture (its FR-14). It does not get
  a private, untested copy.

### FR-8 - A message is data, never instructions

- What the hook shows an agent is a **fixed template** filled with exactly: the validated
  `path`, the sender's scope, and the request id. The sender's scope is looked up from the
  sender's live presence record, not read from the message; it is rendered as quoted data,
  on one line, length-capped, with control characters removed.
- `path` is accepted only if it is a normalized repo-relative path with no control
  characters and no parent-directory segments, and is covered by one of the recipient's own
  claim entries. Otherwise the message is malformed.
- A malformed, unreadable, wrong-version or unparseable message is skipped and pruned,
  never shown and never thrown.

### FR-9 - Opt-in boundary and zero footprint

- No mailbox write happens unless `.minspec/sessions/` already exists. Mailbox code never
  creates `.minspec/` or `.minspec/sessions/`; the directories it does create are made
  non-recursively, as presence does (P9).
- A repository with one session, or with sessions that never conflict, contains no mailbox
  directory, and the hook does no more than one existence check per turn.

## Acceptance Criteria

- [ ] **AC-1 - One request on a real block.** With the FR-0 prerequisites in place, when
  arbitration would block session A on file P against live holder H, exactly one
  `release-request` appears in H's inbox. (FR-1, FR-2)
- [ ] **AC-2 - The holder never asks.** In the same situation H writes no request to A.
  (FR-2, INV-10)
- [ ] **AC-3 - Never twice, even after pruning.** After A's request has expired and been
  pruned from H's inbox, the same conflict detected again on a later turn sends nothing.
  (FR-2, FR-4, FR-5, INV-2)
- [ ] **AC-4 - Release shrinks the claim, then replies.** Answering `release-ack` removes
  every covering entry from H's stored claim and then writes the reply; with the claim write
  forced to fail, no `release-ack` is written. (FR-3, INV-11)
- [ ] **AC-5 - Busy changes nothing.** Answering `busy` leaves H's claim byte-identical and
  writes a reply with no time field. (FR-3)
- [ ] **AC-6 - One reply.** A second answer to the same request fails and leaves the first
  reply unchanged. (FR-3)
- [ ] **AC-7 - The asker is unblocked by the claim, not the message.** After a
  `release-ack`, the backstop still rejects A until H's shrunk claim is published, and
  allows it after. With a `release-ack` present but H's claim unchanged, the backstop
  verdict is unchanged. (FR-4, FR-6, INV-1)
- [ ] **AC-8 - Busy, timeout and dead holder all reach the human path** by the same branch,
  and the conflict message states that a release was requested and what came back. (FR-4,
  FR-5, INV-3)
- [ ] **AC-9 - Delivery without prose.** With the hook installed and no CLAUDE.md
  instruction present, a pending request appears in the holder's next turn. (FR-7, INV-12)
- [ ] **AC-10 - Hostile message.** A message whose `path` contains a newline followed by
  instruction-like text, and one whose `from` is not a live session, are each skipped,
  pruned and never rendered. (FR-8, INV-8)
- [ ] **AC-11 - Not opted in, nothing written.** In a folder with no `.minspec/`, and in
  one with `.minspec/` but no `sessions/`, no mailbox path is created by any code path.
  (FR-9, INV-7)
- [ ] **AC-12 - Presence is unaffected.** With a populated mailbox directory present,
  `isCheckoutOccupied` and `getActiveSessions` return what they return without it. (FR-1,
  INV-9)
- [ ] **AC-13 - No git noise, no network.** No mailbox file appears in
  `git status --porcelain`; the mailbox module passes the Tier 0 import ban. (INV-4, INV-5)
- [ ] **AC-14 - Tests first.** Each invariant below has a test that fails before the change
  and passes after. Because a test can pass without the feature existing, each is also shown
  to fail when the behaviour it guards is removed.

## Invariants (must not break)

- **INV-1 - Courtesy only.** No mailbox content causes the backstop to allow a commit it
  would reject, or reject one it would allow.
- **INV-2 - Bounded, across time.** For any ordered (asker, holder, path), at most one
  request and at most one reply ever exist for the life of both sessions. Enforced by
  exclusive-create on the ledger entry and on the reply, not by convention, and it survives
  pruning.
- **INV-3 - Dead and stale collapse to timeout.** The asker has exactly one non-released
  outcome branch.
- **INV-4 - No git noise.** No mailbox file is ever tracked or shown as untracked.
- **INV-5 - Offline.** Zero network calls (constitution invariant 1).
- **INV-6 - Fail-soft.** A corrupt inbox never throws, never blocks a turn, never blocks a
  commit. This is deliberate and does not breach constitution invariant 2 (no silent gate):
  the mailbox is not a gate. Its failure costs speed only; the backstop and the human path
  are unchanged.
- **INV-7 - Blast radius.** No write outside an already-existing `.minspec/sessions/`; no
  hook entry outside the project's own settings (constitution invariant 3).
- **INV-8 - Data, not instructions.** No byte of a message file reaches an agent's context
  except through FR-8's validated fields.
- **INV-9 - Invisible to presence.** Liveness, the peer count, and the drain's sync gate are
  unaffected by anything in the mailbox.
- **INV-10 - One direction.** The session arbitration favours never sends a request.
- **INV-11 - A `release-ack` is never false.** If it is on disk, the holder's stored claim
  did not cover the path at the moment it was written.
- **INV-12 - Delivery is code.** Under DQ-2 option b, whether a holder's agent sees a
  request does not depend on any instruction it must remember.

## Decisions needed (Clarify)

### DQ-1 - Is Tier 2 still wanted in this form, and when?

The protocol is sound, but its prerequisites are unbuilt (FR-0) and the conflict it resolves
is one this repository's own working practice now mostly avoids.

- **a) Hold behind FR-0 (rec).** Approve the protocol as the Tier 2 design; do not plan or
  build until the three prerequisites are true in code. *Cost:* the founder's second-ranked
  preference stays undelivered for as long as SPEC-026's guard layer does, and this approval
  is spent on a spec that may wait months, during which the code can drift under it again.
- **b) Retarget to conflicts across working trees.** Two branches editing the same file is
  the collision the one-session-per-worktree model actually produces; it surfaces as a merge
  conflict at the funnel. *Cost:* a different design, not a revision - it needs a claim that
  works across working trees (for example, derived from each branch's changed paths), a
  mailbox both trees can reach, and a boundary with SPEC-044 and the merge funnel. It would
  be a new Specify round and this text would be discarded.
- **c) Withdraw.** Mark SPEC-027 superseded by Tier 1 (worktree isolation) plus Tier 3
  (human), and close #388. *Cost:* drops an explicit founder ask without anyone having
  measured how often a same-tree conflict occurs, and leaves adopters who run several
  windows on one checkout with no middle rung.

Nobody has counted same-tree backstop blocks, because the backstop does not exist yet. A
follow-up below proposes making that countable so this question can be answered from data
the next time it is asked.

### DQ-2 - Who makes the holder look at its inbox?

- **a) A CLAUDE.md instruction** (the July design). *Cost:* it holds only as far as each
  session reads and remembers it, which constitution principle 8 names as the failure mode;
  and no "Concurrent-Session Etiquette" block exists to attach it to (P7).
- **b) A shipped hook delivers it (rec).** FR-7 as written. *Cost:* it reaches only agent
  harnesses MinSpec ships a hook for (today, Claude Code), adds a second MinSpec-managed
  entry to the adopter's `.claude/settings.json`, and still delivers only at the start of a
  turn, so C2's false negative remains.

Choosing (a) replaces FR-7 and INV-12 with a template instruction and removes AC-9 and the
`affects:` entry in the frontmatter. Nothing else changes.

## Open Questions (for Plan, not for the human)

- **OQ-1 - The answer entry point.** FR-3 requires one shipped action for "answer this
  request". Candidates: a managed script beside the DR-037 hooks; a marker file the
  extension host acts on. Constraint: MinSpec is an extension, not a command-line tool, so
  this must not become a general `minspec` shell command.
- **OQ-2 - Exclusive create that is also atomic.** FR-2 and FR-3 need create-if-absent with
  complete contents. Temporary file plus hard link is one way; Plan picks and tests it on
  the filesystems MinSpec supports.
- **OQ-3 - Where the request is sent from.** At SPEC-026's pre-edit advisory, at its commit
  rejection, or both. Sending from the commit hook means shell code writes a message, which
  enlarges the two-engine parity set.
- **OQ-4 - Session identity fallback.** FR-7 keys on `MINSPEC_SESSION_ID`. The fallback to
  `.minspec/session.json` depends on how PRE-1 reshapes per-session state.

## Why no new DR

`docs/decisions/INDEX.md` was searched for `mailbox`, `inter-session` and `release-request`;
no decision record covers this. None is added, because nothing here is hard to undo: the
mailbox is gitignored, ephemeral, local state with no committed artifact, the protocol
binds nothing, and removing the feature is deleting one directory, one module and one hook
entry. The on-disk message shape is the stickiest part and is handled by the additive-only
rule under Costly to Refactor.

## Costly to Refactor

1. **`MailboxMessage` is read by two sessions that may run different extension versions.**
   Add fields freely; never rename or remove without bumping `v`. A reader skips versions it
   does not know.
2. **The one-request, one-reply bound (INV-2) is the safety property.** Allowing a follow-up
   nudge later is a deliberate, reviewed change that reopens the ping-pong risk.
3. **A second MinSpec-managed hook entry in an adopter's settings** joins the family that
   must be installed, refreshed and removed cleanly.

## Out of Scope

- **Negotiation, counter-offers, priority overrides.** One question, one answer. Who wins is
  SPEC-026's arbitration and stays there.
- **Handing work over.** #388 mentions a `handoff` answer. Passing an in-progress diff to
  the asker needs a transfer format, a merge story and a trust model; it is a separate
  feature.
- **Conflicts across working trees or machines.** See DQ-1 option b. Liveness is
  machine-local.
- **Code files.** Tier 1 (a separate working tree) is the answer there.
- **Taking back a release.** See FR-3's known limitation.
- **A human-facing mailbox UI.** A human-only window is not asked; its requests time out.
- **Fixing SPEC-026's claim model.** PRE-1 and PRE-2 are stated here as prerequisites and
  handed back to SPEC-026.

## Alternatives considered and rejected

- **Let code decide the holder's answer** (for example: no uncommitted change to the file
  means released). Rejected: an unmodified file says nothing about whether the session is
  about to edit it. Intent is the one thing here only the agent knows.
- **Both sessions may ask** (the July design). Rejected: overlap is symmetric, so both ask,
  and both answering "released" leaves the file unclaimed with two sessions free to edit it.
- **Ride the heartbeat file instead of a separate mailbox.** Rejected: the presence record
  is rewritten every 30 seconds by the extension host from other state, so a message field
  in it would be overwritten, and its shape is already mirrored by a shell reader.
- **Re-open a pair when the holder's claim changes** (the July wording). Rejected in favour
  of never re-opening: it needs the ledger to track claim history, for a case the human path
  already handles.
- **Leave the approved text alone and note the drift elsewhere.** Rejected: an approved
  spec that cannot be built as written is a signpost pointing the wrong way.

## Test plan (for the Plan phase to place)

- Ledger and reply exclusivity under two concurrent writers (INV-2, AC-3, AC-6).
- Claim-write failure injected before the reply (INV-11, AC-4).
- A fixture set of hostile and malformed messages (INV-6, INV-8, AC-10).
- Opt-in matrix: no `.minspec/`; `.minspec/` without `sessions/`; both present (INV-7,
  AC-11).
- Presence functions run with and without a populated mailbox (INV-9, AC-12).
- Backstop verdict with a reply present and the claim unchanged (INV-1, AC-7).
- Each of the above re-run with the guarded behaviour removed, to show the test can fail.

## Follow-ups

The dispatch that wrote this had no network access and could file nothing. **Each item below
still needs an issue**; until it has a number it is tracked only by this list.

- **FU-1 (unfiled) - SPEC-026: same-tree sessions share one claim.** P4. Blocks PRE-1, and
  independently undermines SPEC-026's own backstop, which assumes a peer's claim is its own.
- **FU-2 (unfiled) - SPEC-026: no agent-driven claim source.** P3. Blocks PRE-2.
- **FU-3 (unfiled) - SPEC-026 FR-10 text and the built signature disagree.** The spec says
  `contendingLiveSessions(paths)` returns path-and-peer pairs; the code takes five
  parameters and returns records (P1). Small; fix whichever is wrong.
- **FU-4 (unfiled) - Make same-tree blocks countable.** A local count of backstop
  rejections would let DQ-1 be answered from data.
- **FU-5 - #388's body is stale.** It still says "stub, status new". Correct it when this
  spec's pull request is opened.

## Traceability

- **Triggered by:** [#388](https://github.com/AIClarityAU/minspec/issues/388); parent
  [#380](https://github.com/AIClarityAU/minspec/issues/380); SPEC-026 decision D4 (the
  ranked ladder).
- **Depends on:** SPEC-026 - presence record and liveness (its FR-1 to FR-4), the
  contention predicate (FR-10), the backstop and arbitration (FR-12, FR-13), the parity
  fixture (FR-14), the human path (FR-16).
- **Sibling, not overlapping:** SPEC-044 / DR-067 (work-item leases).
- **Governed by:** constitution invariants 1 (offline), 2 (no silent gate - see INV-6) and
  3 (blast radius); constitution principle 8 (enforce via code); DR-051 (approvables on
  main); DR-073 (writing a foreign settings file); DR-074 (opt-in scope).
- **History:** first Specify `5876e4fc` (July, under #380); approved 2026-07-14; moved to
  `planning` by `3df4e7c4`; re-opened by this revision.
