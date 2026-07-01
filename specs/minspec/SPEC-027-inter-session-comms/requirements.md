---
id: SPEC-027
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness
depends_on: [SPEC-026]  # reuses SessionPresenceRecord, liveness/staleness, sessionId, atomic-write idiom, .minspec/sessions/
relates_to: [DR-051]  # inherits the docs-on-main / worktree enforcement this spec itself is authored under
phases:
  specify: done
  clarify: done   # 2 gating decisions resolved by Paul Harvey 2026-07-01 (see Resolved Clarifications)
  plan: pending
  tasks: pending
  implement: pending
---

# Inter-Session Comms — Sessions Auto-Resolve Conflicts (Tier 2)

> Tier 2 of [SPEC-026](../SPEC-026-session-presence/requirements.md)'s conflict-resolution
> ladder: **prevent (Tier 1) > sessions auto-resolve (Tier 2, this spec) > HITL (Tier 3)**.
> A **courtesy release-request protocol** — one session asks a live peer to voluntarily
> drop a claim it may no longer be actively using — riding the existing presence
> directory. Not an authority mechanism: it never overrides SPEC-026's arbitration
> (FR-13) or its hard backstop (FR-12); it only tries to resolve *faster and without a
> human* the common case where a peer's claim has simply gone stale in practice (task
> finished) before its heartbeat/session naturally clears it.

Triggered by: [SPEC-026](../SPEC-026-session-presence/requirements.md) D4 — the user's
ranked preference, and the original ask ("session X asking session Y if they're still
working on file Z or whether they can release it").

## Context

SPEC-026 gives two sessions **visibility** (presence, FR-1..7) and, when both are live and
genuinely contending, a **hard backstop** (FR-12/13) that blocks the later committer. What
neither layer does is let the two sessions **talk** — so a session that's actually done with
a file (but hasn't shrunk its `fileAllowlist` or ended) still blocks a peer for up to the
full staleness window, and the peer's only recourse today is Tier-3 HITL (SPEC-026 FR-16):
surface it to the human with a copy/paste prompt.

**The value this spec adds:** let the contended-against session ask, and the holder answer,
automatically — closing the common "I'm actually done, just forgot to update my claim" case
without a human, while the genuine "still working on it" case still degrades honestly to
HITL. This is deliberately a **courtesy protocol, not a negotiation**: exactly one request,
one reply, no retries, no ping-pong, and it never contradicts SPEC-026's own arbitration —
it is scoped to unblock *faster*, not to decide *who wins* (FR-13 already decides that).

## Resolved Clarifications (Clarify phase — approved by Paul Harvey 2026-07-01)

| # | Question | Resolution |
|---|---|---|
| C1 | **Auto-shrink on `release-ack`** — should replying also autonomously mutate the peer's own `fileAllowlist`, or reply-only? | **Auto-shrink.** Replying `release-ack` atomically removes the path from the peer's own `fileAllowlist`, propagating at its next heartbeat. Consistent with the existing trust model (CLAUDE.md already asks agents to keep `fileAllowlist` honest/current) — this is the same self-correction, prompted by a peer's ask rather than self-noticed. Encoded in FR-3. |
| C2 | **`REQUEST_TIMEOUT_MS` default** | **60s (2× the SPEC-026 30s heartbeat interval, chosen as a familiar reference point).** Honest caveat: the inbox check runs at **turn-start** (FR-3), not on the heartbeat timer — a live peer mid-long-turn (a lengthy tool call, a build, a thorough search) can exceed 60s without checking its inbox even though it is well within SPEC-026's 120s liveness window. This is an **accepted false-negative**: the requester may fall to HITL against a peer that would have answered given more time. Chosen deliberately over a longer timeout or continuous polling — both add latency/cost for a courtesy layer whose fallback (HITL) is safe and cheap; escalating conservatively is preferred to waiting indefinitely. Encoded in FR-3. |

## Requirements

### FR-1 — Mailbox directory + message shape

- `.minspec/sessions/mailbox/` is a new gitignored subdirectory of the existing presence
  directory (`.minspec/sessions/`) — same lifecycle, same machine, no new top-level path.
- Each message is one file: `.minspec/sessions/mailbox/<to-sessionId>/<msg-id>.json`
  (one subdirectory per recipient keeps a session's inbox listable with a single glob).
- Message shape:

  ```typescript
  interface MailboxMessage {
    id: string;              // UUID-v4
    from: string;            // sender sessionId
    to: string;              // recipient sessionId
    kind: 'release-request' | 'release-ack' | 'busy';
    path: string;             // the contended corpus path this message concerns
    createdAt: string;        // canonical fixed-width ISO-8601 UTC, ms (matches SPEC-026 FR-2 startedAt precision)
    expiresAt: string;        // createdAt + FR-3's REQUEST_TIMEOUT_MS
  }
  ```

- Atomic write (temp + `fs.rename`), the same idiom as SPEC-026 FR-3. No network; Tier-0.

### FR-2 — Sending a release-request (the requester side)

- Builds on SPEC-026 FR-10's `contendingLiveSessions(paths)`. When it returns a live,
  same-`worktreeRoot`, claim-holding peer for a path the requester wants to edit, the
  requester (if it has no unexpired `release-request` already pending to that
  `(peer, path)` pair — **dedup, no resend**) writes ONE `release-request` message to
  the peer's mailbox naming the contended path.
- This does not block the requester's current turn — it is fire-and-forget; the requester
  proceeds with other work and checks back (FR-4) on a later turn or heartbeat tick.
- **Once-ever per `(peer sessionId, path)` pair (closes the post-expiry loophole).** The
  dedup above is not merely "no duplicate while unexpired" — it is permanent for that pair:
  after a `release-request` to `(peer, path)` has **resolved** (a `busy` reply, or its
  `expiresAt` passing unanswered), the requester **MUST NOT** send another `release-request`
  to that same peer for that same path, even if a later turn's `contendingLiveSessions`
  re-detects the same contention. Once resolved, that pair stays resolved to Tier-3 HITL
  (FR-4) for the remainder of the overlap — it is re-opened **only** by an ordinary claim
  change (the peer's `fileAllowlist` shrinks, or the peer's session ends), which
  SPEC-026 FR-10 observes directly and which starts a genuinely new contention against a
  changed state, not a resend of the same request.

### FR-3 — Answering a release-request (the holder side)

- **CLAUDE.md "Concurrent-Session Etiquette" gains one obligation:** at the start of each
  turn, before beginning new edits, an agent checks its OWN inbox
  (`.minspec/sessions/mailbox/<my-sessionId>/*.json`) once. This rides the *existing*
  per-turn presence check (SPEC-026 FR-9/etiquette) — no new timer, no continuous polling.
- For each unexpired, unanswered request naming a path in the agent's own
  `fileAllowlist`:
  - If the agent has genuinely finished with that path (it would remove it from its
    allowlist anyway, or has no further edits planned this session), it replies
    `release-ack` **and removes the path from its own `fileAllowlist`** (so a peer's next
    heartbeat read no longer sees a claim — the same committed-intent surface SPEC-026
    already uses, no new mutation channel).
  - Otherwise it replies `busy` (still actively working; no ETA field — an unenforceable
    promise is worse than no promise, [DR-003](../../../docs/decisions/DR-003.md) evidence
    discipline).
  - A message can also go unanswered (agent never checks, or session ends) — FR-5 handles
    that honestly via timeout, not a hang.
  - **Known limitation — no re-claim recourse.** If a peer's "genuinely finished" self-
    assessment turns out to be wrong (it replies `release-ack`, shrinks its claim, then
    later needs the same path again this session), the spec defines no re-claim signal back
    to the requester. The requester may already have started editing (FR-4 "proceed"),
    recreating the wasted-work scenario SPEC-026 FR-10 exists to warn about — self-inflicted
    by an over-eager `release-ack`. Mitigated only by the same self-assessment discipline as
    the no-ETA rule above (an honest "not actually done" reply — i.e. `busy` — costs nothing
    and is always the safe default when unsure); not solved structurally. Accepted trade-off,
    not a silent gap (see also Out of Scope).
- **`REQUEST_TIMEOUT_MS`** (default: 60s, Clarify C2) is a named constant in `mailbox.ts`,
  tunable alongside SPEC-026's paired heartbeat/stale constants. **Honestly bounded, not
  guaranteed:** because the inbox check is turn-start-driven, not heartbeat-driven, a live
  peer mid-long-turn can exceed this window without replying — an accepted false-negative
  that escalates to HITL rather than blocking (see C2).

### FR-4 — Requester resolution (single round-trip, no retry loop)

- On a later turn (or triggered by the next `contendingLiveSessions` check for the same
  path), the requester reads its own **sent** message's status by checking for a reply
  addressed to itself referencing the same `path`+`from`:
  - **`release-ack` received** → proceed; the peer's `fileAllowlist` no longer covers the
    path (FR-3), so SPEC-026 FR-10/FR-12 no longer see a claim. No further messaging.
  - **`busy` received, OR the request `expiresAt` has passed with no reply** → **fall
    through to Tier-3 HITL** (SPEC-026 FR-16): surface the peer by its human-readable
    `scope`, plus a note that a release was already requested electronically and the
    result (`busy` / no response), so the human isn't asked to repeat a step the tooling
    already tried.
- **No retry, no second request, no negotiation loop, EVER, for the same `(peer, path)`
  pair** — this is the load-bearing loop-safety property, and it holds **across time, not
  just within one exchange** (FR-2's once-ever rule): at most one `release-request` and at
  most one reply will EVER exist for a given peer+path combination for the lifetime of the
  overlap, regardless of how many more times the underlying contention is re-detected on
  later turns. Ping-pong is structurally impossible because there is no code path — neither
  a reply, nor a timeout, nor a fresh re-detection — that can trigger a second request to
  the same pair.

### FR-5 — Message pruning (mirrors SPEC-026 FR-4)

- A mailbox message is **DEAD** iff: `expiresAt` has passed, OR the addressee
  (`to` for an unanswered request; `from` for a reply not yet read) is no longer LIVE
  per SPEC-026's liveness predicate (`lastSeen` stale OR `kill -0` fails).
- Any session listing a mailbox directory (its own, on FR-3's inbox check) prunes DEAD
  messages it encounters (best-effort unlink, swallow errors) — the same
  list-parse-check-prune shape as `getActiveSessions()`, no new mechanism invented.
- A message addressed to a session that dies before replying is therefore equivalent to
  a timeout from the requester's perspective (FR-4 falls through the same way) — dead and
  stale collapse to one case, exactly as SPEC-026 already treats dead/stale sessions
  identically.

### FR-6 — Never contradicts SPEC-026's arbitration or hard backstop

- This protocol is **advisory and courtesy-only**. It never overrides:
  - SPEC-026 FR-12/13's hard pre-commit backstop (still fires exactly as specified,
    regardless of any mailbox exchange — a `busy` reply does not grant permission to
    clobber, and a `release-ack` does not itself unblock a commit; the peer's shrunk
    `fileAllowlist`, propagated at its next heartbeat, is what FR-10/FR-12 actually read).
  - SPEC-026 FR-9's worktree-steer or DR-051's docs-on-main policy.
- If both sessions simultaneously hold claims the other wants, **two independent
  request/reply exchanges** happen — each peer answers per its own actual work state.
  There is no shared "who wins" decision in this protocol; if the two answers leave a
  genuine live conflict, SPEC-026 FR-13's arbitration (earlier `startedAt`, then lower
  `sessionId`) is what decides — unchanged, untouched, and outside this spec's scope.

## Invariants (T0 — tests before implementation)

- **INV-1 (courtesy-only, never binding).** No mailbox message content can cause FR-12/13
  to allow a commit that would otherwise be rejected, or reject one that would otherwise
  be allowed. The only channel of effect is a peer voluntarily shrinking its OWN
  `fileAllowlist` (FR-3) — which SPEC-026 already treats as an ordinary claim change.
- **INV-2 (bounded messaging — no ping-pong, across time, not just per exchange).** For any
  given `(peer sessionId, path)` pair, at most 2 mailbox messages EVER exist for the
  lifetime of the overlap (1 request + 1 reply) — not merely "per contention event." Once a
  `release-request` to that pair has resolved (`busy` or timeout), FR-2's once-ever rule
  means NO later re-detection of the same contention (even many turns later) sends another
  request to that pair; it stays resolved to Tier-3 HITL until the peer's claim genuinely
  changes. Verified by construction (FR-4 has no retry branch, and FR-2 forbids resending to
  a pair that has ever resolved) and a T0 test asserting `sendReleaseRequest` is never called
  a second time for the same `(peer, path)` pair — both immediately (a reply/timeout-handling
  code path) AND on a later, independent re-detection of the same still-live contention.
- **INV-3 (dead/stale collapse to timeout).** A request whose recipient is dead or stale
  is treated identically to one that timed out with no reply — the requester's FR-4
  resolution has exactly one non-`release-ack` path (fall to HITL), not two.
- **INV-4 (no new git noise).** `.minspec/sessions/mailbox/` is gitignored (added to
  `MINSPEC_GITIGNORE_ENTRIES`); no mailbox file ever appears in `git status --porcelain`.
- **INV-5 (offline only).** `mailbox.ts` makes zero network calls (static import check,
  same as SPEC-026 INV-5).
- **INV-6 (fail-soft).** A malformed or unreadable mailbox message is skipped (treated as
  absent/DEAD), never thrown — a corrupt inbox must not crash the etiquette check or
  block the agent's turn.

## Acceptance Criteria

- [ ] **Release request sent on contention** — when `contendingLiveSessions` finds a live
  claim-holding peer for a path the requester wants, exactly one `release-request` is
  written to the peer's mailbox; a second detection of the same contention before
  `expiresAt` does NOT send a duplicate. (FR-1, FR-2)
- [ ] **Holder replies release-ack and shrinks its claim** — a peer that has genuinely
  finished with the path replies `release-ack` and the path no longer appears in its
  `fileAllowlist` on its next heartbeat. (FR-3)
- [ ] **Holder replies busy, no ETA** — a peer still working replies `busy` with no
  promised-time field. (FR-3)
- [ ] **Requester unblocks on release-ack** — the requester observes the peer's claim
  gone (via FR-10) once `release-ack` + the peer's next heartbeat have landed. (FR-4)
- [ ] **Requester falls to HITL on busy or timeout** — a `busy` reply, or no reply within
  `REQUEST_TIMEOUT_MS`, surfaces the SPEC-026 FR-16 HITL path, noting the electronic
  attempt already made. (FR-4)
- [ ] **No ping-pong possible, including post-expiry re-detection** — across the full
  request→reply→resolution flow, no more than 2 mailbox messages ever exist for one
  `(peer, path)` pair; no code path re-sends immediately, AND a fresh `contendingLiveSessions`
  re-detection of the SAME still-unresolved contention on a LATER turn (after the first
  request expired or resolved `busy`) does NOT send a second request — it resolves straight
  to HITL. (FR-2, FR-4, INV-2)
- [ ] **Dead recipient degrades like a timeout** — a request addressed to a
  session that dies before replying resolves via the SAME fall-through as an
  expired/unanswered request, not a separate code path. (FR-5, INV-3)
- [ ] **Never overrides the hard backstop** — a `release-ack` or `busy` reply, by itself
  (peer's `fileAllowlist` unchanged), does not alter any FR-12/13 verdict; only the
  peer's own claim mutation does. (FR-6, INV-1)
- [ ] **Zero git noise, offline** — no mailbox file ever committed; no network calls.
  (INV-4, INV-5)
- [ ] **T0 discipline** — INV-1..INV-6 each have a test that fails against pre-change code
  and passes after — written before implementation.

## Costly to Refactor

1. **`MailboxMessage` shape is on-disk, read by both sessions.** Add fields freely, never
   rename/remove without migration — same discipline as SPEC-026's `SessionPresenceRecord`
   (Costly-to-Refactor #1 there).
2. **The 1-request/1-reply bound (INV-2) is the load-bearing safety property.** Loosening
   it later (e.g. allowing a follow-up nudge) is a deliberate, reviewable change, not a
   quiet extension — it reopens the ping-pong risk this spec's design specifically closes.
3. **`.minspec/sessions/mailbox/` nesting under the presence dir** — ties its lifecycle to
   SPEC-026's; moving it out later means updating the gitignore entry and any hard-coded
   path assumptions in both `mailbox.ts` and the CLAUDE.md etiquette template.

## Out of Scope

- **Multi-round negotiation, counter-offers, or an authority/priority override.** This
  protocol never decides "who wins" — SPEC-026 FR-13 already does, deterministically. A
  richer negotiation (e.g. requester offers to wait N seconds, peer counter-proposes) is
  explicitly rejected as scope creep that reopens ping-pong risk for marginal value.
- **File/content handoff.** A peer sending its in-progress diff to the requester so it can
  continue the peer's work. A much larger feature (needs a transfer format, conflict
  merge, trust model) — not needed for the "is this claim actually stale" courtesy case
  this spec targets.
- **Cross-machine mailboxes.** Inherits SPEC-026's machine-local liveness limitation
  (`kill -0` is meaningless across machines).
- **Re-claim after a mistaken `release-ack`.** No signal lets a peer that wrongly declared
  itself "finished" retract and re-warn the requester if it needs the path again — see
  FR-3's Known Limitation. Structural recourse (e.g. a `retract` message kind) is deferred;
  the accepted mitigation is self-assessment discipline, not tooling.
- **Guaranteed delivery / message persistence beyond the timeout window.** A message that
  expires unread is simply dead — no retry, no escalation beyond falling to HITL (FR-4).
- **A UI surface for the mailbox.** No status-bar/Quick-Pick element for messages in this
  spec; SPEC-026 FR-16's existing HITL surface is reused as-is for the fallback case.

## Traceability

- **Triggered by:** [SPEC-026](../SPEC-026-session-presence/requirements.md) D4 (the user's
  ranked conflict-resolution preference) and the original ask for sessions to negotiate
  directly.
- **Depends on:** SPEC-026 FR-1..4 (presence, liveness, atomic-write), FR-10
  (`contendingLiveSessions`, the trigger), FR-13 (arbitration, deliberately untouched),
  FR-16 (the HITL fallback this spec degrades to).
- **Authored under:** [DR-051](../../../docs/decisions/DR-051.md) — this is a
  review-needing approvable (new spec), so it is authored in a worktree on a review
  branch → PR, not direct-to-`main`.
- **Files to modify (allowlist for implementation agents):**
  - `packages/minspec/src/lib/mailbox.ts` (new — message read/write/prune, reuses
    SPEC-026's liveness helper and atomic-write pattern)
  - `packages/minspec/src/lib/scaffold.ts` (add `.minspec/sessions/mailbox/` gitignore entry)
  - CLAUDE.md template (extend Concurrent-Session Etiquette with the per-turn inbox check)
  - `packages/minspec/tests/mailbox.test.ts` (new — INV-1..6 T0 tests)
