---
id: SPEC-235
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (the App-token broker is its only GitHub credential path; same home as DR-095)
aspects: [broker, credential-boundary, availability, cache, no-silent-gate, rate-limit, host-side]
depends_on: []
relates_to: ["#2114", "#2046", "#2044", "#1855", "#2043", DR-095, DR-094]
implements: none
implements_reason: >-
  Specify phase only. Every file this spec would change lives in the host NixOS
  configuration (/etc/nixos/home.nix and /etc/nixos/scripts/gh-app-token-mint.sh),
  outside this repo; which of those files it owns is decided at Plan, after D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-235: The App-token broker stops serving a token GitHub has rejected, and an operator can force a fresh mint without host access

> **This is a SPECIFICATION ONLY.** Written for issue #2114 (broker serves one shared dead
> token until TTL). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> **On the id.** Spec ids 229 through 234 are all present on local refs of in-flight branches
> (scanned with `git ls-tree` over every local ref, 2026-10-27), so SPEC-235 is the first id
> not seen anywhere. Open pull requests not fetched locally are invisible to that scan.

## In plain terms

Every agent session on the machine gets its GitHub token from one host-side broker. The
broker caches one token for 50 minutes and hands the same one to everyone. If GitHub stops
accepting that token early, every session is locked out until the 50 minutes run out, and
nothing inside the container can fix it. This spec makes the broker notice a rejected token
and mint a new one, gives operators a safe "mint me a fresh one" command, and makes
`--check` test that the token actually works.

## Root-cause diagnosis (read from the host config, 2026-10-27)

The bad state is "every session gets `401 Bad credentials` and every mint returns the same
value". The mechanism and the missing gate:

- **Mechanism: freshness is judged by file age alone.** The per-connection handler
  `gh-app-token-proxy-server.py` (generated from `/etc/nixos/home.nix:1572-1650`) serves
  `$XDG_RUNTIME_DIR/gh-app-token.cache` whenever `time.time() - st.st_mtime < TTL`, with
  `TTL = 50 * 60` (`home.nix:1587`, the check at `:1606`). Nothing about the
  token's validity enters that decision. A token revoked (`DELETE /installation/token`),
  invalidated by a key rotation, or killed by any other cause is served unchanged until the
  file is 50 minutes old.
- **Mechanism: the cache is host-global, so the failure is too.** One cache file, one
  socket (`ListenStream = "%t/gh-app-token.sock"`, `Accept = true`, `home.nix:1657-1659`).
  Every container session reads the same file, so one invalidation is a fleet-wide outage.
- **Missing gate 1: no consumer can ask for a re-mint.** The handler reads nothing from its
  socket (comment "Reads NOTHING from stdin", `home.nix:1576`), and the client
  `~/.claude/scripts/gh-app-token.sh` (mounted read-only from the host, `home.nix:100`)
  offers `--check`, `--installations`, `--permissions` only (`gh-app-token.sh:160-176`).
  Recovery needs host `systemctl` or waiting out the TTL.
- **Missing gate 2: `--check` does not authenticate.** `--check` runs `_mint > /dev/null`
  and prints OK (`gh-app-token.sh:160`). `_emit` validates shape and prefix only
  (`gh-app-token.sh:128-155`). A dead token of the right shape reports OK, which is the
  false all-clear the issue describes.
- **Contributing: the mint discards `expires_at`.** `gh-app-token-mint.sh:136-139` extracts
  only `.token` from the `POST /app/installations/:id/access_tokens` response, so the
  handler cannot know the real expiry and falls back to the mtime guess.

The issue's 07:05 lockout on 2026-09-23 (no DELETE involved) has no cause identified. This
spec does not need one: the fix removes the outage for every cause that GitHub reports as
`401`. The issue's statement that the cached `exp` was `1790114175` is from the issue body;
I believe, unverified, that this was derived from the cache mtime, since installation tokens
are opaque strings rather than JWTs.

## Where the change lands (blast radius)

All code is host configuration in `/etc/nixos` (the host register, which keeps its own
DR-079 and DR-085; those are **not** this repo's DR-079 / DR-085). This repo ships none of
it to adopters, so invariant 3 is not engaged by the change itself. The spec lives here
because the broker exists to serve this repo's agent fleet, and DR-095 (mount the broker
socket's directory, read-only) set the precedent of recording host-broker decisions in this
register. Building it needs the founder or a host-side session; a container session cannot
apply a NixOS generation.

## Functional requirements

**FR-1. A token GitHub has rejected is never served again.** When the handler has positive
evidence that the cached token is dead (FR-2), it discards the cache and mints a new token
before answering. It never returns a token it has itself classified as dead.

**FR-2. "Dead" means HTTP 401 and nothing else.** Liveness is decided by one authenticated
call with the token, `GET https://api.github.com/installation/repositories?per_page=1`,
classified by the **HTTP status code**, never by a process exit code or message text:

| Status | Class | Handler action |
|---|---|---|
| 200 | live | serve cached |
| 401 | dead | discard, re-mint (FR-1) |
| anything else (403, 404, 429, 5xx), timeout, DNS or TLS failure | unknown | per D2 |

`GET /user` is **not** an acceptable probe: a healthy installation token answers it with
`403 Resource not accessible by integration`. One shared probe function is used by both the
handler (FR-1) and `--check` (FR-5); there is no second copy of the classification.

**FR-3. When to probe is bounded (D1).** The probe runs no more often than D1 allows. Whatever
D1 picks, the worst-case time a dead token can be served after GitHub rejects it is stated
as a number in the plan and asserted by a test (AC-3).

**FR-4. Operator re-mint: `gh-app-token.sh --refresh` (subject to D3).** A container client
can request that the broker re-mint. The request carries no token and no free-form input
beyond a fixed verb. The broker honours it only after its own probe (FR-2) of the current
cached token returns **dead**, or after D3's alternative rule; a refresh request against a
live token answers with the live token and a stderr note, and does not mint. Every honoured
or refused refresh writes one journal line (outcome, cache age, probe status code).

**FR-5. `--check` proves the token authenticates.** `--check` prints OK only after the FR-2
probe returns 200 for the token it received. A 401 prints "token is DEAD" and the next step
(`gh-app-token.sh --refresh`), and exits non-zero. An unknown result prints the status code
and exits non-zero with a message distinct from "dead", so an outage of GitHub is not
reported as a dead credential.

**FR-6. Expiry comes from GitHub, not from file age.** The mint records the response's
`expires_at`. The handler treats the cache as stale at `expires_at` minus a margin (the
current 10-minute margin, 60 minutes minus `TTL`, is kept unless the plan measures a reason
to change it). If `expires_at` is missing or unparseable, the cache is treated as stale
(mint fresh), never as fresh.

**FR-7. One mint at a time.** Probe-and-re-mint is serialised across concurrent handler
instances (each connection is its own process because `Accept = true`). When the token dies,
N sessions connecting at once produce **one** mint, and the other N-1 handlers serve the
token that mint produced. The lock is held only around probe, mint and cache write, with a
timeout; a handler that cannot take the lock within the timeout fails closed with a journal
line, never serves the token it already suspects.

**FR-8. Re-mint rate is capped.** The handler mints at most a fixed number of times per
window (value set at Plan; the cap and window are named constants). When the cap is hit it
fails closed (exit 1, journal line naming the cap), which the client already reports as a
broker failure rather than a token. A broken probe or a client loop cannot become an
unbounded mint storm against the App.

**FR-9. The broker never revokes.** Neither the handler nor `--refresh` calls
`DELETE /installation/token`. Revoking a live shared token is the act that caused the
reproducible form of this outage. The operator procedure for a leaked token becomes:
revoke it, then `gh-app-token.sh --refresh` (FR-4 sees 401 and re-mints).

**FR-10. The cache file is never readable by anyone but its owner, not even briefly.** The
new cache write creates the file with mode 0600 at creation (`os.open(..., O_CREAT|O_EXCL,
0o600)` to a temp name, then atomic `rename`), replacing today's `write_text` followed by
`chmod` (`home.nix:1642-1643`), which leaves the token at umask permissions between the two
calls. A reader never sees a half-written cache.

**FR-11. Nothing new reaches the container.** The cache stays outside every container mount
(DR-095's dedicated-directory rule). The probe runs host-side in the handler; the container
gains no key, no JWT, and no path to the cache. The only new container-visible surface is the
fixed refresh verb of FR-4.

**FR-12. Every failure is visible.** Each new failure path (probe unknown, lock timeout, cap
hit, mint failed after a dead probe, malformed `expires_at`) writes a distinct journal line.
No new `|| true` or bare `except` on a path that decides what token is served.

## Invariants (must not break)

1. **No silent gate (invariant 2).** A dead token must not produce an OK from `--check`, and
   no new path swallows an error that decides which token is served (FR-5, FR-12).
2. **Blast radius (invariant 3).** Nothing in this change ships into an adopter repo or into
   any machine-wide config other than the host broker that already exists for this fleet.
3. **Offline core (invariant 1).** MinSpec the extension is untouched. The broker already
   makes network calls (it mints); the probe adds calls to the same host, `api.github.com`,
   from the same host-side process.
4. **Credential boundary (DR-095, host DR-079).** The container never holds the App key or
   the cache file, and the org pin (`MINSPEC_APP_ORG=AIClarityAU`) is unchanged.
5. **Fail closed on the credential side.** Any unclassified state results in no token or a
   fresh token, never in emitting something that is not a token (existing `_emit` contract,
   `gh-app-token.sh:128-155`).
6. **Existing client contract.** `gh-app-token.sh` with no argument still prints exactly one
   token line or exits non-zero; every in-repo consumer (`scripts/lib/gh-bot.sh:60`,
   `scripts/lib/workflow-paths.sh:252`, `scripts/lib/delegated-approval-caller.ts:69`,
   `scripts/review-churn-report.sh:66`) works without change.

## Acceptance criteria

Tests run against the handler with GitHub replaced by a local stub server (no real token,
no real network; fixtures use token-shaped dummies only).

- **AC-1 (dead → re-mint).** Cache holds token A, stub answers 401 for A. One request
  returns a new token B, the cache now holds B, and a journal line records the re-mint.
- **AC-2 (403 is live, not dead).** Stub answers `GET /installation/repositories` with 200
  and `GET /user` with 403. The handler serves A and does not mint. A mutant that probes
  `/user`, or classifies by exit code, fails this test.
- **AC-3 (bounded exposure).** After the stub flips A to 401 at time t, no request after
  t + (the FR-3 bound) receives A.
- **AC-4 (stampede).** 20 concurrent requests arrive while A is dead: exactly one mint call
  reaches the stub, all 20 receive B.
- **AC-5 (unknown).** Stub returns 503 for the probe: behaviour matches D2's chosen option,
  and a journal line names the 503.
- **AC-6 (cap).** Stub answers 401 for every token: mints stop at the FR-8 cap; the next
  request exits 1 with the cap line; the client reports a broker failure, not a token.
- **AC-7 (`--refresh` on a live token).** A is live: `--refresh` returns A, no mint.
- **AC-8 (`--refresh` on a dead token).** A is dead: `--refresh` returns B.
- **AC-9 (`--check`).** 200 → OK, exit 0. 401 → "DEAD" and the `--refresh` hint, exit
  non-zero. 503 → status code printed, exit non-zero, wording does not say "dead".
- **AC-10 (expiry).** A cache whose `expires_at` is past the margin is not served even if
  the file is younger than 50 minutes; a missing `expires_at` causes a mint.
- **AC-11 (file mode).** Under umask 022, the cache file is never observed with any mode
  other than 0600 (checked by stat on every write, including the temp file).
- **AC-12 (no revoke).** Across every AC above, the stub records zero
  `DELETE /installation/token` calls.
- **AC-13 (contract).** `scripts/lib/gh-bot.sh` and `scripts/lib/workflow-paths.sh` tests
  pass unchanged against the new client.

## Security notes (security-role review of the design)

- `[MEDIUM] home.nix:1642-1643` — the current cache write leaves a plaintext installation
  token at umask permissions between `write_text` and `chmod`. Exposure is limited to the
  host user's runtime directory, which is mode 0700 on a standard systemd user session (I
  believe, unverified on this host). Recommendation: FR-10.
- `[MEDIUM] design` — a refresh path that re-mints unconditionally hands every container
  session an App-rate-limit lever. Recommendation: FR-4 (probe-gated), FR-8 (cap).
- `[LOW] design` — reading a refresh verb from the socket ends the handler's
  "reads nothing" property, which host DR-079 relies on. Recommendation: D3 chooses
  between a fixed one-byte verb and a second socket; neither accepts free-form input.
- No secrets, tokens, or high-entropy strings appear in this spec. No dependency is added.

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

**D1. When does the handler probe a cached token?**

**Recorded selection: Option (a),** probe on a timer, at most once per 60 s per cache, plus
on every `--refresh`.

- (a) **Probe on a timer: at most once per 60 s per cache, plus on every `--refresh`
  (rec).** Worst-case dead-token exposure is 60 s instead of up to 50 min; one extra API call
  a minute at most. Cost: up to 60 s of fleet-wide `401`s after a revoke remain, and the
  handler must store the last-probe time beside the cache.
- (b) Probe on every cache hit. Exposure is zero. Cost: one GitHub round trip added to every
  token request from every session (hundreds an hour under a full drain), latency on the hot
  path, and probe calls counting against the installation's rate limit.
- (c) Never probe in the read path; rely on `--refresh` only. Cheapest. Cost: the outage
  still happens for every cause until an operator notices and refreshes, which is the
  property #2114 says is the priority.

**D2. What does the handler serve when the probe result is unknown (GitHub 5xx, 429,
network failure)?**

**Recorded selection: Option (a),** serve the cached token and log the status code.

- (a) **Serve the cached token and log the status code (rec).** The token was fresh by
  expiry; an unreachable GitHub makes a new mint fail anyway. Cost: during a partial GitHub
  outage that also invalidated the token, a dead token can be served until the next probe.
- (b) Fail closed (no token). Cost: a GitHub blip becomes a fleet-wide broker outage, which is
  the failure this spec exists to remove.

**D3. How does `--refresh` reach the handler?**

**Recorded selection: Option (a),** one fixed byte on the existing socket, read with a short
timeout; any other input or none means a normal request.

- (a) **One fixed byte on the existing socket, read with a short timeout; any other input or
  none means a normal request (rec).** Smallest change, one socket. Cost: the handler stops
  being "reads nothing", which host DR-079 states; that host record needs an amendment line,
  and a slow client now holds a handler for the read timeout.
- (b) A second socket `gh-app-token-refresh.sock` in the same DR-095 directory. Keeps the
  main handler input-free. Cost: a second unit and mount entry to keep in step, which is the
  "keep X and Y aligned" pattern that has drifted before.
- (c) No `--refresh`; ship D1 only. Cost: an operator with a known-dead token still waits up
  to the D1 interval, and the revoke-then-recover procedure (FR-9) has no command.

**D4. Does this need a decision record?** I believe no: every choice above can be reversed
by one NixOS generation switch in minutes, which is under the one-day DR filter. The
D3(a) choice amends host DR-079 in the host register, not this one. Recommendation: no DR
here; record D1-D3 outcomes in this spec's Clarify answers. Cost: the reasoning lives in a
spec rather than the register, so a later reader looking for "why does the broker probe"
must find it through #2114.

**Recorded selection: Option (no DR),** no DR here; the D1-D3 outcomes are recorded in this
spec's Clarify answers.

## Out of scope

- The stale-socket and dead-listener case (#2046) and the IDENTITY banner wording (#2044).
- The drain reporting a failed query as "cycle done" (#1855).
- Per-session tokens. Minting one token per session would isolate a revoke to one session,
  but multiplies mints by the session count and needs the broker to know session identity;
  rejected here because FR-1 removes the outage without that cost.

## Follow-ups (tracked)

- None filed by this spec. The 07:05 2026-09-23 lockout's original cause stays unknown; if
  FR-12's journal lines show recurring 401s after this ships, that evidence is the trigger to
  file one.
