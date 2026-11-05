---
id: SPEC-219
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [sessions, messaging, addressing, no-silent-gate, tier-0, offline]
depends_on: [SPEC-026, SPEC-044]  # SPEC-026 presence records; SPEC-044 the hub (chief-of-staff) every session reports to
relates_to: ["#2013", "#1492", "#1857", SPEC-027]
implements: none
implements_reason: >-
  Specify phase only. The address resolver is not in this repository (see Context), so which
  files this spec will own is decided at Plan, after Decision D1.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-219: A session's messaging address must not change when its display name does

Issue: #2013 (bug: a session's messaging address churns every ~30s). Specify only; nothing is built.

## In plain terms

Sessions rename themselves from the refs they have most recently seen, so the name shown
by `ListAgents` changes every ~30 seconds. `SendMessage` resolves the recipient by that
whole name string, so a send composed against a name read seconds earlier fails with
`No agent named '...' is reachable`. Appending the row's ` [ref]` does not rescue it,
because the lookup is keyed on the whole string. The busiest session (the chief-of-staff
hub) renames most, so it is the hardest to reach. The content of a failed send is lost
unless the sender notices and reroutes it.

## Context (verified vs. unverified)

- Measured in #2013: 5 consecutive failures, `ListAgents` re-read each time, the name
  changed three times while one message was composed, ` [90fea4]` appended without effect.
- **Searched this repo** (`grep` for `sessionName`, `says it was`, `derived-name` across
  `.ts/.md/.py/.sh`): the only hit is an unrelated test. I found no code here that
  derives session names or resolves `SendMessage` recipients. I believe both live in the
  Claude Code host / its orchestration layer, outside this repository (unverified:
  I have not inspected that layer). SPEC-026 presence records (`.minspec/sessions/`) are a
  different mechanism.
- Consequence: this repo may be unable to fix the defect itself. D1 asks the human to
  decide where the change lands. Requirements below state the contract any fix must meet.

## Functional requirements

- **FR-1 Ref is the address.** A recipient written as a bare `[ref]`, or `name [ref]`,
  resolves to the live session with that ref, whatever the name component says.
- **FR-2 Stale name never invalidates a matching ref.** Name text is display-only once a
  ref is present. A name that is merely out of date (it appears in that session's recent
  previous-names, the "says it was ... until Ns ago" data) resolves.
- **FR-3 Wrong ref still fails loudly.** A ref matching no live session fails with the
  existing "not reachable" error. No fallback to name matching when a ref is supplied
  (a ref the sender typed is a stronger statement than a name).
- **FR-4 Name-only sends keep working** exactly as today, including the ambiguity error
  when two rows share a name.
- **FR-5 Not silent when stale.** When a send succeeds via ref but the supplied name
  differed from the current one, the tool result says so (e.g. "delivered to [90fea4],
  now named '...'"). Mitigates the cost of FR-2 (a wrong-but-stale name succeeds).
- **FR-6 Ref stability.** The ref of a live session must not change for the session's
  lifetime, including across renames. (Already observed true in #2013; becomes a
  stated, tested guarantee.)
- **FR-7 Documentation matches behaviour.** The tool guidance "append ` [ref]` when the
  bare name is not enough" must be true for the stale-name case.

## Acceptance criteria

- **AC-1** Given a session renamed after the sender read `ListAgents`, `SendMessage` to the
  old `name [ref]` delivers to that session (FR-1, FR-2).
- **AC-2** `SendMessage` to bare `[ref]` delivers (FR-1).
- **AC-3** `SendMessage` to `old-name [deadbeef]` where `deadbeef` is no live ref returns
  "not reachable" even if `old-name` matches a different live session (FR-3).
- **AC-4** Name-only send to a unique current name still delivers; a duplicated name still
  errors as ambiguous (FR-4).
- **AC-5** A stale-name delivery reports the current name in its result (FR-5).
- **AC-6** Across N renames of one session, its ref is constant (FR-6).
- **AC-7** Regression: with the pre-fix resolver, AC-1 fails; with the fix, it passes.

## Invariants this must not break

- **INV-1 (constitution 1, offline):** resolution is local; no network call is added.
- **INV-2 (constitution 2, no silent gate):** a delivery failure stays a visible error to
  the sender; the fix must not turn failure into a swallowed drop. FR-5 keeps a stale-name
  success visible rather than silent.
- **INV-3 (constitution 3, blast radius):** the change applies only where the session
  messaging facility is already in use; nothing is written to a repo without `.minspec/`.
- **INV-4:** the display name keeps its current derivation and readability (#2013 says
  the self-renaming is useful); only the *address* is decoupled from it.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified. D1 has a selection recorded from the answer to
task-queue item c219 (2026-10-27: "Upstream (Recommended)"), an answer the queue attributes to the
founder. A queue answer is not consent and is not verified here: DR-108 (delegated approval) section
4 holds that a queue item cannot carry consent, because any session can write the queue. D2 and D3
carry the (rec) option an agent session copied; no human chose them (each says so). Delegation
DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR
acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified
only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may
overturn it.

**D1 - Where does this land?** (gating; blocks Plan)

**Recorded selection: (a),** route the fix upstream to the owner of the host messaging
layer, and keep this spec as the contract plus acceptance tests for it. Source: the answer
to task-queue item c219, 2026-10-27 ("Upstream (Recommended)"). A queue answer is not
consent (DR-108 section 4), so this selection is unverified and binds only if this spec is approved with it in place, by the
founder or by the bot under DLG-001. The upstream report itself is a separate
outward-facing act; this record makes none.

- (a) **(rec)** File/route upstream to the owner of the host messaging layer, and keep this
  spec as the contract plus acceptance tests for it. Cost: MinSpec cannot ship the fix
  itself, so timing is outside our control and nothing improves here until it lands.
- (b) Build a MinSpec-owned alias/relay in this repo (e.g. a stable address in the
  SPEC-026 presence record that senders resolve first). Cost: duplicates a host feature,
  adds a second address namespace sessions must learn, and only helps sessions that use it.
- (c) Interim convention only: senders re-read `ListAgents` immediately before each send and
  keep messages short. Cost: this is prose, not a gate; the issue shows it already fails
  (5 sends) because the TTL is shorter than composition time.

**D2 - Ref-wins versus a stable alias.** (the issue's two options)

**Recorded selection: (a),** accept a stale name when the ref matches. An agent session
copied this document's (rec) option; no human chose this item.

- (a) **(rec)** Accept a stale name when the ref matches. Smallest change, uses data already
  in every row. Cost: a sender who picked the wrong session but the right-looking ref
  gets no name-mismatch error; only FR-5's notice reveals it.
- (b) Separate stable alias per session, distinct from the self-updating display name.
  Cleaner model. Cost: larger, and needs a place for the alias to live and be discovered.

**D3 - Should a ref-bearing send with a name that matches a *different* live session be
rejected as a likely mistake?** (a) **(rec)** No, ref wins (FR-3 as written); cost: a
mis-typed ref that happens to be live delivers to the wrong session. (b) Yes, reject on
conflict; cost: reintroduces failures for the legitimate stale-name case when the old name
was since taken by another session.

**Recorded selection: (a),** no: the ref wins (FR-3 as written). An agent session copied
this document's (rec) option; no human chose this item.

## Out of scope

- Changing how display names are derived (INV-4).
- Delivery guarantees for offline recipients or retry queues (SPEC-027 territory).

## Traceability

Issue #2013. Related reroutes #1492, #1857. Builds on SPEC-026 (presence), SPEC-044
(hub). No DR proposed: nothing here is irreversible in under a day; revisit if D2(b) is chosen.
