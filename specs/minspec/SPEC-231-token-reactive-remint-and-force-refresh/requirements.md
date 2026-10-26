---
id: SPEC-231
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its bot-credential layer)
aspects: [github-app-token, gh-bot, broker, reactive-remint, force-refresh, no-silent-gate, fail-closed, blast-radius]
depends_on: []
relates_to: ["#2090", "#2114", "#2066", "#2046", "#1355", "#995", "#1855"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Nothing is
# built from this spec until it is approved. scripts/lib/gh-bot.sh and its callers
# already exist; this spec modifies them and owns only its new test file.
implements: [scripts/lib/gh-bot-reactive-remint.test.js]
affects: [scripts/lib/gh-bot.sh, scripts/lib/gh-bot.test.js, scripts/drain-inbox.sh, scripts/remediate-pr.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-231: A dead bot token is replaced on the 401 that proves it dead, and a caller can force a fresh mint

> **This is a SPECIFICATION ONLY.** Written for issue #2090. Nothing is built until a
> human reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and
> approves it.

## In plain terms

The issue reports: *"broker serves known-dead cached token to TTL; needs re-mint-on-401 +
gh-app-token.sh --refresh flag."* Two asks: (1) a caller that gets a 401 on a token minted
through this path retries once on a fresh mint; (2) a way to force "bypass what is cached,
mint fresh".

## Root-cause finding (read before the requirements)

The issue says the caching layer is undiagnosed. Reading `main` (`8ce02607`) it is largely
diagnosed already, by #2114, and the finding changes what is buildable here:

| Claim | Evidence |
|---|---|
| The in-container client caches nothing. | `~/.claude/scripts/gh-app-token.sh` `_mint()` opens `/tmp/gh-app-token.sock` per call; it sits OUTSIDE this repo (`git ls-files` finds no copy, only `packages/minspec/tests/helpers/gh-app-token-stub.sh`). |
| The cache that serves a dead token is the **host broker** (`gh-app-token-proxy`). | `scripts/lib/gh-bot.sh:106-108`: "The host broker hands the whole machine ONE cached installation token and keeps handing it out after it dies, with no in-container way to force a re-mint (#2114)." Stated as established fact in code; I did not reproduce it (this container cannot inspect the host). |
| `gh-bot.sh` already has age-based re-mint and a same-token guard. | `_GH_BOT_MAX_AGE` (`:70`), `_gh_bot_adopt` (`:115-130`) refuses to reset the age clock when the broker returns the value already held. |
| A **reactive** path already exists for reads, but only as an opt-in function each caller must remember. | `gh_bot_reauth_read` (`gh-bot.sh:582-593`); called at `drain-inbox.sh:1582`, `:1819` and `remediate-pr.sh:639`. Not called by `triage-inbox.sh`, `dispatch-issue.sh`, or the `gh` wrapper itself. |
| The **write** path has no reactive path at all. | `_gh_bot_ensure` (`gh-bot.sh:308`) checks age only; a write on a dead-but-young token returns `401 Bad credentials` to the caller. |

So the answer to the issue's open question is: **the dead-token cache lives in the host
broker; `gh-bot.sh` is the caller-side layer and already guards against it for reads, if
asked.** The two asks then split:

- **Ask 1 (re-mint on 401)** belongs in `gh-bot.sh`, which is in this repo. Buildable.
- **Ask 2 (`gh-app-token.sh --refresh`)** can only be a real *forced* mint if the host broker
  honours a request to bypass its cache. The broker and the container client are outside this
  repo and outside this project's blast radius (constitution invariant 3). Adding a flag to
  the client that the broker ignores would be a false signpost. See Decision D1.

## Functional requirements

**FR-1. Reactive re-mint on a proven-dead token (read and write).** `gh-bot.sh`'s `gh`
wrapper, when it holds a token it OWNS (`_GH_BOT_OWNED=1`) and a `gh` call fails with an HTTP
401 / `Bad credentials`, makes exactly ONE forced re-mint and, only if that returned a
*different* token (`_gh_bot_adopt` status 0), re-runs the same call once. It never loops.

**FR-2. Same token back means report, not retry.** If the re-mint returns the token already
held, or fails, the original failure is returned unchanged with its original exit status and
output, plus one stderr line naming that the broker returned the same dead credential. A 401
is never converted into success, an empty result, or a silent retry (#1855, constitution
invariant 2).

**FR-3. Inherited tokens are never replaced.** A token supplied by the caller (a workflow's
`GITHUB_TOKEN`, `_GH_BOT_OWNED != 1`) is never re-minted by FR-1; the 401 passes through.
(Same rule as `gh_bot_reauth_read`, `gh-bot.sh:589-591`.)

**FR-4. Only a 401 triggers it.** 403, 404, 422, rate-limit and network errors do not re-mint.
Detection keys on the HTTP status / `gh`'s `HTTP 401` text, not on a bare non-zero exit. The
exact matcher is a plan-phase item; it must be pinned by a test using a real `gh` 401 output
shape (not an invented one).

**FR-5. Writes retry safely.** A 401 means GitHub did not process the request, so re-running
a write once is not a duplicate. The re-run happens only for a call whose first attempt
returned 401; a call that returned any other outcome (including a timeout with unknown
server-side effect) is never re-run.

**FR-6. Forced refresh entry point in-repo.** `gh_bot_force_refresh` (name per plan) mints
now regardless of age and cooldown, reuses `_gh_bot_adopt`, and returns 0 only when a
different credential is installed. `gh_bot_reauth_read` becomes a thin caller of it so there
is one forced-mint code path, not two.

**FR-7. Callers stop remembering.** Because FR-1 is in the wrapper, the per-caller
`gh_bot_reauth_read` blocks in `drain-inbox.sh` and `remediate-pr.sh` are either removed or
reduced to the loud-hold branch; no new caller needs to add one. Behaviour of the existing
tests in `scripts/lib/gh-bot.test.js` (refresh, same-token, cooldown) is preserved.

**FR-8. Client `--refresh` (conditional on D1).** If D1 resolves to "broker supports a
bypass", `gh-app-token.sh --refresh` is specified in the host/broker repo, and this spec only
requires `gh-bot.sh` to pass it through when `MINSPEC_GH_APP_TOKEN_SCRIPT` advertises support.
If D1 resolves otherwise, FR-8 is dropped and the issue's second ask is closed as
"not possible from this repo; see FR-6".

## Invariants (must not break)

- **INV-1 (constitution 2, no silent gate).** A 401 that cannot be cured is surfaced with
  its original status; no `|| true` on the re-mint; a missing token script on the write path
  still dies (#1355), on the read path stays best-effort-but-loud.
- **INV-2 (constitution 3, blast radius).** Nothing here edits `~/.claude`, the host broker,
  or any machine-wide config. Behaviour changes only in scripts under `.minspec/`-opted repos.
- **INV-3 (constitution 1, offline).** No new network call; the retry uses the same broker
  socket and the same `gh` call already being made.
- **INV-4.** No bot token ever reaches an agent environment (`lib/agent-context.sh`
  allowlist unchanged; `_gh_bot_adopt` keeps exporting only as today).
- **INV-5.** Never fall back to ambient/human auth on failure (#995, #1355).
- **INV-6.** Retry count is bounded at one per call; the existing cooldown
  (`_GH_BOT_REMINT_COOLDOWN`) is bypassed only by a *proven* 401, as `gh_bot_reauth_read` does.

## Acceptance criteria

- **AC-1.** With a stub minter returning token A then B, and a stub `gh` that 401s on A and
  succeeds on B: a write via the wrapper succeeds, the minter is called twice, `gh` twice.
- **AC-2.** Stub minter always returns A (dead): the wrapper returns the original 401 status
  and output, `gh` is called exactly once more or not at all per FR-2 (pick one in plan and
  pin it), and stderr names the same-token condition. No third attempt.
- **AC-3.** Inherited `GH_TOKEN`: 401 passes through, minter never invoked.
- **AC-4.** 403/404/422 outputs: minter never invoked.
- **AC-5.** Minter exits non-zero during the re-mint: read path loud-and-continues, write
  path dies with the existing #1355 message.
- **AC-6.** A write that returns a non-401 failure is never re-run (spy counts `gh` calls).
- **AC-7.** `gh_bot_force_refresh` ignores age and cooldown, returns 0 only on a changed
  token. Existing `gh-bot.test.js` cases still pass unchanged.
- **AC-8.** A distinguishing test exists that fails on `main` (write on a dead young token
  returns 401 with one `gh` call) and passes after.

## Decisions needed (Clarify)

**D1. What does "`--refresh`" mean when the cache is on the host?**
- **(a) (rec) In-repo only: FR-6 `gh_bot_force_refresh` + FR-1; close ask 2 as not feasible
  here.** Cost: a human at a terminal still has no one-liner that truly bypasses the broker
  cache; the broker may keep returning the same dead token, in which case we only fail loudly
  (FR-2), not recover.
- **(b) Also file a host-side issue** (broker + container client honour a `refresh` request
  line on the socket). Cost: the work lives outside this repo and blast radius, needs the
  founder's host access, and the client flag is dishonest until the broker ships.
- **(c) Add a client flag now that only skips local state.** Rejected: the client has no
  local state, so it would be a no-op that reads as a fix.

**D2. Retry location.** (a) **(rec)** inside the `gh` wrapper (covers every caller). Cost:
the wrapper re-runs argv, so a command reading stdin cannot be replayed and must be excluded
or buffered. (b) a separate `gh_bot_retry_on_401 -- gh ...` helper callers opt into. Cost:
recreates the #2066 problem of callers forgetting.

**D3. On same-token-back, one more attempt or none?** (a) **(rec)** none: report immediately.
Cost: a broker that rotates a moment later is missed until the next call. (b) one delayed
retry. Cost: adds a sleep inside a wrapper under `set -e` loops.

## Alternatives rejected

- Shortening `_GH_BOT_MAX_AGE`: age is a guess; the broker can serve dead tokens inside any
  window, and it multiplies broker round trips.
- Re-mint on every call: rate-limit and broker load; the once-only read guard exists for this.

## Follow-ups (tracked)

- Host-side broker bypass request, if D1(b): to be filed on approval of this spec.
- Backlog: `triage-inbox.sh` / `dispatch-issue.sh` have no reactive read path today; covered
  by FR-1/FR-7 once built.
