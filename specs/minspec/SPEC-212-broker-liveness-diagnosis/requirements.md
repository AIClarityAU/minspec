---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - what MinSpec's harness depends on must fail visibly
aspects: [gh-app-token, broker, diagnosis, no-silent-gate, container, bind-mount]
depends_on: [DR-066, DR-079]  # DR-066: a gate failure must be visible; DR-079: the container-side broker stand-in
relates_to: ["#2046", "#1355", "#995"]
implements: none
implements_reason: >-
  The script this issue names lives outside the repository (~/.claude/scripts/gh-app-token.sh);
  nothing in the repo is owned by this spec until Decision DQ-1 is answered.
affects: []
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: A dead broker listener reports as a dead listener, and the report cannot silently regress

## In plain terms

Issue #2046 says the container's `gh-app-token.sh` printed "broker returned no token" when the
broker had not answered at all, because it tested that the socket FILE existed (`-S`) and threw
away the connect error. A stale socket inode passes `-S`, so the one correct message was never
reached, and diagnosis went to the host journal for a unit that had never run.

**Finding while writing this spec (read from the file, not inferred):** the script at
`~/.claude/scripts/gh-app-token.sh` on this machine already contains the fix for suggested
items 1 to 3. It checks `-e` and `-S` separately, runs the connect inside a python client that
exits with a distinct code per errno (11 refused, 12/14 timeout, 13/15 other I/O, 16 EACCES),
captures stderr into a scratch file instead of `2>/dev/null || true`, has a distinct
empty-reply arm and a "not a token" arm, and its ECONNREFUSED arm tells the reader to grep
`/proc/self/mountinfo` for a `//deleted` source (the script header cites the 2026-09-22
outage). The consumer, `scripts/lib/gh-bot.sh:204-217`, already prints the script's stderr in
its failure text. So the defect as filed is **not live in that file**.

What is still true: (a) that file is not in this repository, so nothing here proves it stays
fixed or ships it to anyone who lacks it; (b) the `//deleted` mount-staleness check is a
printed hint, not an automatic detection; (c) suggested item 4 (bind the directory, not the
file) is untouched and is the only change that stops the outage recurring. This spec therefore
asks the human which of those is in scope before anything is built.

## One-Sentence Scope

Decide, and then pin with a test, how a refused connect to the broker socket is reported, so
that "listener dead" is never again worded as "broker declined".

## Context (measured)

- `~/.claude/scripts/gh-app-token.sh` (read 2026-10-19): arms for `-e`, `-S`, rc 11, 16, 12|14,
  13|15, unclassified (prints captured stderr), empty token, non-token shape. `_ERRF` holds
  stderr; there is no `|| true`.
- `git ls-files | grep gh-app-token` finds no script in the repo; only consumers
  (`scripts/lib/gh-bot.sh:60` defaults `MINSPEC_GH_APP_TOKEN_SCRIPT` to the `$HOME` path) and a
  test stub, `packages/minspec/tests/helpers/gh-app-token-stub.sh`.
- Root-cause statement from the issue, kept: file-existence was used as a proxy for listener
  liveness, and the syscall error that would refute the proxy was discarded. The gate that
  should have rejected it: a test that starts a socket file with no listener and asserts the
  message. None exists in the repo today (grep for `ECONNREFUSED` / `NOTHING IS LISTENING`
  under `packages/` and `tests/`: unverified here, to be re-run in Plan).

## Functional Requirements

Written under the recommended answer to DQ-1 (option b). If DQ-1 resolves to (a), only FR-6
remains.

- **FR-1.** Reaching a socket path whose listener is gone (ECONNREFUSED) MUST exit non-zero
  with a message that says nothing is listening. It MUST NOT use the words "returned no token".
- **FR-2.** Refused, permission-denied, timed-out, empty-reply and non-token-reply MUST each
  produce a distinct message and a distinct exit path; none may share a branch.
- **FR-3.** The client's stderr MUST be captured and printed on any unclassified failure; no
  failure path may discard it (`2>/dev/null` and `|| true` are banned on the client call).
- **FR-4.** On ECONNREFUSED the message MUST point at `/proc/self/mountinfo` and the `//deleted`
  marker, and say that a restart of the host unit alone will not reach a stale bind mount.
- **FR-5.** Where `/proc/self/mountinfo` is readable and the socket's mount source carries
  `//deleted`, the script SHOULD state "mount is stale; recreate the container" as fact, not
  as a hint (DQ-2).
- **FR-6.** A committed test MUST create a socket file with no listener (bind, then close
  without unlink) and assert FR-1/FR-2, run against the script named by
  `MINSPEC_GH_APP_TOKEN_SCRIPT`, so the gate exists independent of one machine's copy.
- **FR-7.** The script under test MUST be selectable without touching `$HOME`; the test MUST
  fail visibly (not skip) when the selected script is absent (invariant 2).

## Acceptance Criteria

1. A stale socket file with no listener yields exit 1 and text containing "NOTHING IS
   LISTENING" (or the equivalent chosen wording), and not "returned no token".
2. A listener that accepts then closes without data yields the empty-reply message, not the
   refused message.
3. A listener that never answers yields the timeout message within the bound.
4. A client fault with stderr output prints that stderr.
5. With the test's script path unset or wrong, the test fails rather than passes vacuously.
6. A mutation that restores `[ -S ]`-only checking and `2>/dev/null || true` turns criteria 1
   and 4 red.

## Invariants (must not break)

- **INV-1 (constitution 1, offline).** No network call: the diagnosis uses a local unix socket
  and `/proc` only.
- **INV-2 (constitution 2, no silent gate).** A mint failure stays fail-closed; it never falls
  back to ambient human auth (`gh-bot.sh:213-216`).
- **INV-3 (constitution 3, blast radius).** Nothing writes to `~/.claude` or the container's
  mount configuration from this repo without the adopter's opt-in marker `.minspec/`.
- **INV-4.** A broker answer is only emitted if it is token-shaped (the existing token-shape check: inline in `scripts/gh-bot.sh`; a `_is_token` helper in the out-of-repo `~/.claude/scripts/gh-app-token.sh`, unverified here).

## Decisions needed (Clarify)

- **DQ-1. Where does the fix live?**
  - (a) **Close as already fixed out-of-tree**, add nothing. Cost: nothing pins it; the next
    edit of an unversioned `$HOME` file can regress it unseen, which is the original failure.
  - (b) **(rec)** Keep the script out of the repo but add the FR-6 behavioural test, run
    against `MINSPEC_GH_APP_TOKEN_SCRIPT`. Cost: the test cannot run in CI on machines without
    the script, so FR-7 makes it fail loudly there unless CI supplies a copy; adds a
    skip-or-supply policy to settle in Plan.
  - (c) Vendor the script into `scripts/` and have `gh-bot.sh` default to it. Cost: changes
    the credential-path default for every consumer, a larger blast radius than a message fix.
- **DQ-2. Auto-detect `//deleted` (FR-5) or keep it a printed hint?** Rec: detect, because the
  issue shows a hint was misread. Cost: parsing `/proc/self/mountinfo` is Linux-only and must
  degrade silently to the hint elsewhere.
- **DQ-3. Suggested item 4 (bind the directory).** Rec: out of scope here and filed
  separately. Cost: the outage recurs on every host-side socket replacement until it is done.
  It changes container mount topology, outside this repo's files.

## Limitations

- The `ConnectionRefusedError` reading comes from the issue's evidence file, which is outside
  this repo and was not available to the writer of this spec.
- Whether the script on every other machine matches the one read here is unverified.

## Traceability

Issue: #2046. Related: #1355 (bot attribution), #995. DRs: DR-066 (no silent gate), DR-079
(container broker stand-in). No new DR is needed unless DQ-1 resolves to (c).
