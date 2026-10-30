---
id: SPEC-264
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; the epic DR-065 (presence-gated fast-forward) belongs to
aspects: [presence, drain, fast-forward, container, pid-namespace, no-silent-gate, fail-safe]
depends_on: [SPEC-026, DR-065]  # SPEC-026 owns the presence record and its liveness rule; DR-065 section 1 owns the gate's conjunction this spec may amend (D1)
relates_to: [SPEC-135, SPEC-140, SPEC-044, DR-051, "#2626", "#1678", "#1167", "#1714", "#846", "#168"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns is decided at Plan, after Decisions D1 and D2
  are answered. Expected touch set (not owned, all modified): scripts/drain-inbox.sh
  (checkout_occupied, sync_shared_checkouts), packages/minspec/src/lib/presence.ts
  (record shape and isRecordLive, only if D1 (a) or (b)), and
  packages/minspec/tests/presence-sync-parity.test.ts.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-264: The presence-gated fast-forward works, or says it cannot, when the drain and the editor are in different process namespaces

> **This is a SPECIFICATION ONLY.** Written for issue #2626. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> Design rests on [DR-065](../../../docs/decisions/DR-065.md) (presence-gated fast-forward)
> and [SPEC-026](../SPEC-026-session-presence/requirements.md) (session presence).

## In plain terms

The drain is allowed to fast-forward a shared checkout only when it can prove no live session
has that checkout open (DR-065). It proves liveness by checking that the editor's process id
still exists. The drain runs inside the agent container; the editor runs on the host. The
container cannot see host processes, so every editor looks dead, so nobody looks live, so every
checkout reads "occupied" and nothing is ever fast-forwarded. The drain logs nothing that
tells this apart from a checkout that really is in use.

This spec does two things. First, it makes the drain say what it saw on every cycle, so an
inert gate is visible (FR-1 to FR-4, no decision needed). Second, it fixes the liveness rule
so a record from a namespace the reader cannot see is judged correctly. The second part
changes DR-065 section 1, so the human picks the rule (D1).

## Measured state (this base)

Read from code at this base (`origin/main` 2026-10-28). The issue's line numbers have drifted;
these are current.

- **Writer.** `packages/minspec/src/lib/presence.ts:725` writes `pid: process.pid`, the
  editor extension host's id **in the editor's own process namespace**. The record
  (`presence.ts:56-68`) carries no host, boot or namespace identity.
- **TS liveness.** `presence.ts:87-94` `pidAlive` uses `process.kill(pid, 0)`;
  `presence.ts:100-105` `isRecordLive` = fresh `lastSeen` (under `STALE_SECS = 120`) AND
  `pidAlive`. `presence.ts:381-407` `isCheckoutOccupied` answers occupied when no record is
  live (`:405`).
- **Bash liveness.** `scripts/drain-inbox.sh:661-709` `checkout_occupied` mirrors it:
  stale ⇒ skip (`:700`), `kill -0 "$pid"` fails ⇒ skip (`:701`), and
  `(( live_total > 0 )) || return 0` (`:706`) ⇒ occupied when nobody is live.
- **Consumer.** `sync_shared_checkouts` (`drain-inbox.sh:723-764`) skips the checkout on G3
  (`:750`) with **no output**. The other skips (G1 off-main, G2 dirty, G4 diverged, already
  current) are silent too. Only a completed fast-forward or a refused one prints a line
  (`:759-761`).
- **Second consumer.** `scripts/check-primaries-clean.sh:135-146` reads the seam
  `drain-inbox.sh --checkout-occupied` (`drain-inbox.sh:3343-3347`) and parses the **last
  stdout line** as `occupied` / `dormant`, anything else ⇒ `unknown`.
- **Parity.** `packages/minspec/tests/presence-sync-parity.test.ts` pins TS and bash to the
  same answers over golden fixtures, including
  `'live elsewhere + dead-pid claim here ⇒ dormant for this root'` (`:120-127`).
- **Observed in the container (issue #2626, 2026-10-09, not re-measured here).** One fresh
  host-editor record (`lastSeen` 6 s old, `pid` 986229); `kill -0 986229` ⇒ no such process;
  `--checkout-occupied` ⇒ `occupied` for the primary and for a worktree with no record.

## Root cause (mechanism)

Root cause: the liveness rule assumes writer and reader share one process namespace. The
writer stores a namespace-local process id (`presence.ts:725`); the reader probes it with
`kill -0` from whatever namespace it runs in (`drain-inbox.sh:701`, `presence.ts:89`). From a
container, every host record reads dead, the "nobody demonstrably live" arm (`:706`) answers
occupied, and the gate is permanently shut. The missing gate is visibility: no output
distinguishes "occupied because a session is live" from "occupied because the reader can see
no one", so the inert state was invisible for as long as the drain has run in the container.

SPEC-026 FR-4's cross-machine note and DR-065's negative consequences both name the cross-host
case and call it out of scope. A container on the same host is the same mechanism, and here it
is the normal deployment.

### A latent fail-open the issue did not name (derived from code, not reproduced)

The issue calls today's outcome the safe direction. That holds only while **no** record reads
live. The fixture at `presence-sync-parity.test.ts:120-127` pins that a fresh record with a
dead pid claims nothing. So if any one record ever reads live from the container (a future
container-side presence writer such as an editor window attached to the container, or a host
pid number that happens to exist in the container), condition (a) of DR-065 section 1 is met,
and **every host editor's checkout, fresh but pid-invisible, reads dormant**. A clean, on-main,
behind checkout open in a live host window would then be fast-forwarded under it. G2 and G4
still stop WIP or commit loss; moving HEAD under a live session is still the thing rule #8
(#168) forbids. I believe this is reachable from the code at `drain-inbox.sh:697-708`;
unverified by a fixture. FR-6 makes it a test either way.

## Functional requirements

### Visibility (no decision needed; buildable before D1)

**FR-1 - Per-cycle presence summary.** Each `sync_shared_checkouts` pass prints exactly one
summary line, to the drain log, of the form
`[drain] presence: <R> record(s) read, <F> fresh, <L> live; ff <n>, current <n>, skipped off-main <n>, dirty <n>, occupied <n>, diverged <n>`.
Counts come from the same evaluation the gate used, never a second derivation (DR-065 §4: no
third copy of the predicate). When `MINSPEC_DRAIN_GATED_FF=0`, the line says the pass is
disabled instead of printing zeros.

**FR-2 - Namespace-blind warning.** When a record is fresh by `lastSeen` and dead by the pid
probe, the drain prints a `WARNING` line naming the record's `worktreeRoot`, its age and pid,
and the two explanations it cannot tell apart: "the writer is in a process namespace this
drain cannot see (e.g. host editor, containerised drain)" or "the writer exited less than
120 s ago". The warning prints when that condition **starts** and again when it **clears**, not
every cycle, so a standing condition does not flood the log; the FR-1 counts carry it every
cycle.

**FR-3 - Inert-gate escalation.** When the gate has answered occupied for every eligible
checkout (on main, clean, behind) on every pass for longer than a threshold, AND at least one
fresh-but-pid-dead record existed throughout, the drain prints one
`WARNING: presence gate has not opened for <duration>` line naming SPEC-264 and the kill-switch.
The threshold is a named constant (proposed 30 min, set at Plan). Prints once per episode.
This is the line whose absence let #2626 go unseen.

**FR-4 - Seam contract unchanged.** `drain-inbox.sh --checkout-occupied <root>` keeps printing
`occupied` or `dormant` as its **last stdout line** with the same exit codes (0 occupied,
1 dormant). Any diagnostic it emits goes to stderr. `check-primaries-clean.sh` must need no
change to keep working.

### Liveness across a namespace boundary (shape depends on D1)

**FR-5 - Reader judges a foreign-namespace record by the rule D1 picks.** Whatever D1 picks,
it applies identically in `isRecordLive` (TS) and `checkout_occupied` (bash), and the parity
test gains fixtures for it. Under D1 (a), the record gains one optional field, a namespace
token, and:

- token present in record AND reader's own token computable AND equal ⇒ today's rule
  (fresh AND pid alive);
- token present AND differs from the reader's ⇒ fresh `lastSeen` alone (the SPEC-044
  `isClaimLive` foreign-host shape, `presence.ts:169-175`);
- token absent from the record, or reader cannot compute its own ⇒ the D2 answer.

**FR-6 - A fresh record never claims nothing because of a pid the reader cannot judge.**
Pin, as a parity fixture, the scenario in
[A latent fail-open](#a-latent-fail-open-the-issue-did-not-name-derived-from-code-not-reproduced):
one record live to the reader elsewhere, one fresh record from a foreign namespace claiming
root R. R must read **occupied**. This holds under every D1 option except (d), where FR-6 still
lands as a fixture documenting the hazard, and the hazard is filed against whichever change
first adds a container-side writer.

**FR-7 - Pruning respects the same rule.** `getActiveSessions` (`presence.ts:675-697`) deletes
records it judges dead. It must use the FR-5 rule, so an editor never unlinks a fresh record
written from a namespace it cannot see (the reverse direction: an editor window attached to a
container, read by a host window). Whether that deployment occurs here is unverified; the
requirement costs nothing once FR-5 exists.

**FR-8 - Record field is additive.** A record without the new field (old writer) and a reader
without the new rule (old drain) both keep working: no reader rejects a record for carrying or
lacking the field, and `readAllRecords`'s malformed-shape check (`presence.ts:243`) does not
start treating either as corrupt.

## Acceptance criteria

- **AC-1** (FR-1) A `--sync-checkouts` run over a fixture with two records (one live, one
  stale) prints one summary line with `2 record(s) read, 1 fresh, 1 live` and per-reason counts
  that sum to the number of checkouts visited.
- **AC-2** (FR-2) A fixture with a fresh record whose pid is dead prints the warning once on
  the first pass, not on the second, and a "cleared" line on the pass after the record goes
  stale or live.
- **AC-3** (FR-3) With a fake clock past the threshold and a standing fresh-but-pid-dead record,
  exactly one escalation line prints; it does not print when one checkout fast-forwarded in the
  window.
- **AC-4** (FR-4) `check-primaries-clean.sh` against the same fixtures returns the same
  classifications before and after; `--checkout-occupied` stdout is exactly one line.
- **AC-5** (FR-5, D1 (a)) Parity fixtures: same-token dead pid ⇒ dead (keeps
  `presence-sync-parity.test.ts:120-127`); different-token fresh ⇒ live; different-token stale
  ⇒ dead; token-absent ⇒ D2 answer. TS and bash agree on every one.
- **AC-6** (FR-6) The latent-fail-open fixture answers occupied for R in both readers. Shown
  red against this base's rule before the change (or recorded as a red-on-base fixture if D1 is
  (d)).
- **AC-7** (FR-7) A host-side `getActiveSessions` call over a fresh foreign-token record does
  not delete it.
- **AC-8** End to end in the container: with the founder's host editor open on the primary and
  one clean, on-main, behind worktree with no record, one drain pass fast-forwards the worktree
  and leaves the primary alone (D1 (a) or (b)); under (d) it prints the FR-3 line instead.

## Invariants this change must not break

- **DR-065 §1 fail direction.** Any doubt ⇒ occupied. No new rule may make an unreadable,
  corrupt or stale record count toward dormancy. Empty sessions dirs anywhere ⇒ occupied.
- **DR-065 §2 floor.** G1, G2, G4 and `merge --ff-only` are untouched; presence stays the newest
  guard, not the only one.
- **DR-065 §4 parity.** TS and bash change together; `STALE_SECS` / `PRESENCE_STALE_SECS` stay
  paired; the golden-fixture parity test is the gate.
- **Constitution invariant 1 (offline).** The namespace token is read from the local machine
  only. No network call is added.
- **Constitution invariant 2 (no silent gate).** The new diagnostics must not be written with a
  swallowed error that hides a failed evaluation; a failure to compute counts prints that it
  failed. The ff remains advisory infrastructure, not a merge gate.
- **Constitution invariant 3 (blast radius).** The heartbeat stays a no-op outside an opted-in
  folder (`presence.ts:704`); the new field is written only where the record already is.
- **No new trust.** Records are writable by any agent in a worktree. The pid probe was never
  authentication (a forged record with `pid: 1` passes `kill -0` in the agent container today; checked 2026-10-28, uid 1000, rc 0), and
  this spec does not pretend otherwise; G2/G4 remain what stops data loss.

## Out of scope

- Moving the founder's own checkout: SPEC-135 (self-installing build) and SPEC-140 (checkout
  follows approval) give that checkout its own mover. #1678 (live record claims the in-use
  primary) stays theirs.
- Agent sessions in container worktrees do not write presence records (presence is written by
  the extension). Whether they should is a separate question; this spec does not change it.
- Cross-machine presence (different hosts sharing a checkout over a network filesystem).
- Running the drain on the host or sharing the host's pid namespace (deployment, not repo
  code); see D1 (c).

## Decisions needed (Clarify)

**D1 - How may liveness be judged across a namespace boundary?** (Changes DR-065 §1's
"heartbeat within 120 s AND PID alive"; whichever of (a)/(b) is chosen, a DR-065 amendment,
born `proposed`, is written at Plan and must be accepted before build.)

- (a) **(rec)** Namespace token in the record; foreign-namespace records judged by fresh
  `lastSeen` alone, same-namespace records keep the pid probe (FR-5). Matches the existing
  SPEC-044 claim-lease rule (`isClaimLive`, foreign host ⇒ TTL alone). Cost: a crashed host
  editor's record keeps its checkout occupied for up to 120 s instead of immediately, and counts
  toward condition (a) for that long; plus one record field and a token reader in two languages.
- (b) Drop the pid probe everywhere; liveness is fresh `lastSeen` alone. Simplest, one rule.
  Cost: loses fast crash detection on the same machine too, and changes the pinned fixture at
  `presence-sync-parity.test.ts:120-127`.
- (c) Make the drain share the host's pid namespace (`--pid=host`) or run it on the host. No
  code change to the rule. Cost: weakens container isolation, the reason the drain is in a
  container; outside this repo's control, so not buildable from this spec.
- (d) Keep the rule; ship only FR-1 to FR-4 (and FR-6 as a documenting fixture), and let
  SPEC-135 carry the founder's checkout. Cost: dormant worktrees never fast-forward while the
  drain runs in the container, and the latent fail-open stays unfixed until someone adds a
  container-side writer.

**D2 - What does the token contain, and what if it is missing?** (Only if D1 is (a).)

- (a) **(rec)** Token = the Linux pid-namespace id (`readlink /proc/self/ns/pid`) joined with
  the kernel boot id (`/proc/sys/kernel/random/boot_id`), so it differs between host and
  container and across reboots. Record without a token, or reader that cannot compute one
  (macOS, Windows, Docker Desktop's VM) ⇒ fresh `lastSeen` alone. Cost: on non-Linux hosts the
  pid probe is effectively retired, so same-machine crash detection there is 120 s slow.
- (b) Same token; missing ⇒ today's pid probe. Cost: a Docker Desktop host (editor on macOS,
  drain in the Linux VM) stays inert exactly as today, now with FR-2/FR-3 warning about it.

Autonomy note (DR-086 §4): alternatives rejected without asking - inferring the namespace from
the "fresh but pid dead" signature alone (it is identical to an editor that crashed under 120 s
ago, so it cannot define liveness; it is kept only as the FR-2 diagnostic); comparing hostnames
(a container's hostname differs from the host's, but so does nothing else useful, and it is
user-settable).

## Follow-ups (tracked)

- #1678 - in-use primary never fast-forwards (owned by SPEC-135 / SPEC-140).
- DR-065 amendment for D1 - written at Plan if D1 is (a) or (b); tracked by FR-5 of this spec.
- Re-measure #2626's observation on the current base before build (the issue's line numbers
  predate this base): tracked by AC-8 of this spec.
