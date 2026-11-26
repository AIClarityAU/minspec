---
id: SPEC-250
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the same credential-boundary domain as SPEC-226 and SPEC-213
aspects: [security, identity, credential-boundary, fail-closed, no-silent-gate, alarm-fidelity]
relates_to: [DR-066, DR-008, SPEC-226, SPEC-213, "#2146", "#1816", "#2044", "#1043"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# The check this spec changes is NOT in this repo: it is
# ~/.claude/scripts/identity-boundary-check.sh with its suite at
# ~/.claude/scripts/tests/identity-boundary-check.test.sh, in the founder's host-side
# claude-config repository (the container's ~/.claude has no .git). Those paths cannot be
# listed in `implements:` or `affects:`, which name repo paths; they are named in the body.
implements: none
implements_reason: >-
  The credential check itself lives outside this repository (SPEC-226 D-1). The only in-repo
  files this spec touches are the session banner and its test, which no spec owns and which
  SPEC-226 and SPEC-213 also edit; owning them here would freeze them for those specs.
affects: [scripts/hooks/session-identity.sh, packages/minspec/tests/session-identity.test.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-250: The identity check decides reachability from what a producer handed over, not from whether it explained a failure

## In plain terms

`identity-boundary-check.sh` asks every GitHub credential producer (the `gh` keyring, every
git credential helper) for a credential and classifies what comes back. When a helper exits
non-zero, the check today decides "benign or alarming" by **whether the helper wrote anything
to stderr**. A helper that fails silently is `[clean]`. A helper that fails and says why is
`[UNKNOWN]`, and one `UNKNOWN` turns the whole run into
`FAIL — N path(s) could not be verified (fail-closed)`.

Both helpers are in the same state: they handed over no credential. Stderr says nothing about
that. So during every token-broker outage (the broker client explains itself on stderr) the
check fails with a verdict shaped like a reachability alarm, at the moment no credential of
any kind can be obtained.

This spec separates two questions the check currently merges:

1. **Reachability:** did the producer hand the agent a credential? This is decided **only
   from the producer's output content** (stdout and, new, stderr - see FR-2). It is never
   decided from the exit code or from whether stderr is empty.
2. **Availability:** did the producer work? A producer that exited non-zero (or timed out)
   and handed over nothing is counted in a new `[unavailable]` bucket. It **still fails the
   run (exit 2)**, but its wording says "no credential was obtained", not "could not be
   verified".

Cost: the run's exit code during an outage does not change (still `2`), so this does not
make outages quieter for any gate that keys on exit code. It changes what the record and the
banner *say*. The assumption most likely to be wrong is that "handed over nothing now" is a
safe thing to report as not-a-breach. It is not proof the producer holds no founder
credential (a locked keyring holds one and returns nothing). That is why `[unavailable]` is
never `[clean]` and never contributes to `PASS` (INV-1).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. The founder
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves the spec
> through the normal approval gate before anything is built. Every requirement is written
> under the recommended answer to each decision.

Materializes **[#2146](https://github.com/AIClarityAU/minspec/issues/2146)**: *"the identity
banner reports a dead credential helper as a possible founder-credential leak."* The issue's
recommended option is "decide reachability from stdout, and use stderr only to pick the
wording". This spec adopts it, with three corrections found while reading the code (see
Context): stderr can itself carry a credential (FR-2), the mute exit-1 acceptance is wider
than its stated reason (D-1), and the banner half was already changed by #2044.

**Id note.** `SPEC-250` is the highest claimed id plus one (renumbered from `SPEC-238` after `origin/main` claimed that id for another spec; highest claimed then `SPEC-249`). Claimed ids were read on
2026-10-27 from every local and remote-tracking branch of this worktree's repository and from
every worktree under `/tmp/minspec-agent/` and `~/code/.worktrees/MinSpecPro/` (highest
`SPEC-237` at first read); `origin/main` was at `7a200191`. Open pull requests were not queried, because
this dispatch makes no network call. If the id collides at review time, renumber.

**Tier note.** Triage recorded T3/T4. Mechanical scope is small: one function and the verdict
block of one script outside this repo, its test suite, and possibly one banner arm here. The
change is to a security gate's classification, so this spec keeps T3 ceremony.

## One-Sentence Scope

Make `identity-boundary-check.sh` classify a credential producer's failure by the content it
handed over - credential found, credential-shaped garbage, or nothing - and report "nothing,
because the producer failed" as a distinct, still-failing `[unavailable]` result whose wording
asserts no reachability.

## Context: what the code does today

Read from `~/.claude/scripts/identity-boundary-check.sh` (27140 bytes, mtime 2026-09-11), its
suite `~/.claude/scripts/tests/identity-boundary-check.test.sh`, and this repo at `origin/main`
`7a200191`. Line numbers are from that file; anything inferred is marked.

### Root cause

**Mechanism.** `probe_helper` (`:306-328`) runs a helper as git would, captures stdout into
`out` and stderr into `$TMPD/herr`, then:

- `:315` - timeout (rc 124) is `unknown`.
- `:316-324` - if stdout has a `^password=` line, each `password=`/`username=` value is
  classified (or `unknown` if none is token-shaped). This arm is correct and stays.
- `:324` - `rc 0`, **or** `rc 1` **with empty stderr**, is `[clean] no credential`.
- `:327` - everything else is
  `unknown "$lbl: exited $rc without a credential (<first 80 bytes of stderr>)"`.

The verdict (`:470-474`) turns any `unknowns > 0` into
`FAIL — $unknowns path(s) could not be verified (fail-closed)`, exit `2`.

So at `:324`/`:327` the branch keys on stderr emptiness. Stderr carries no credential to git
(git passes a helper's stderr through to the terminal and reads the credential from stdout
only - inferred from git's credential-helper protocol, not re-read from git source in this
session), so it carries no information about reachability.

The keyring probe P1 (`:241-258`) has the same shape: `gh auth token` exiting with anything
other than `rc 1` + `no oauth token found` on stderr is `unknown "keyring ... exited $grc
without a token"`. A broker outage does not hit P1 (it does not use the broker), but a D-Bus
or keyring error does.

**Missing gate.** The suite pins the current behaviour as intended:
`expect "helper: an error is UNKNOWN" 2 "exited 3 without a credential"` (test `:179-180`)
and `expect "keyring: a gh error is UNKNOWN, not 'no token'" 2` (`:155-156`). No case
distinguishes "failed and handed over nothing" from "handed over something unverifiable", so
nothing caught that both land in the same bucket with the same alarm-shaped wording.

### Why errors were made `UNKNOWN` in the first place (do not lose this)

The script header (`:38-46`) records the reason: under `ptrace_scope=1`, "couldn't read it"
had twice become "nothing there", and the keyring arm says "A producer ERROR is not 'no
token' - a D-Bus hiccup must not turn into a PASS" (`:257`). That reasoning is **right** and
this spec keeps it: a failed producer is not evidence the store behind it is empty. The
defect is narrower - the check reports "failed, handed over nothing" with the same count and
wording as "answered with something we could not classify", and it exempts the mute failure
from that rule entirely.

### What #2044 already changed (the issue predates it)

The issue was filed 2026-09-25 and quotes the banner text *"A founder credential may be
reachable from agent sessions."* On 2026-10-01 `ac5c069bd` (#2191, fixing #2044) added a banner
arm in `scripts/hooks/session-identity.sh:93-104` that maps any `fail-closed` / `could not be
verified` verdict to "an AVAILABILITY failure, not a confirmed credential leak ... Most
commonly the token broker is down." So the **banner** no longer asserts reachability for this
verdict. What remains:

- The **check's own output** (read by whoever runs it to diagnose, and quoted in the banner's
  `$verdict`) still says `could not be verified`, still counts a dead broker in the same
  bucket as a helper that answered with a non-token password, and still prints `[UNKNOWN]`.
- The banner arm infers "availability" from the verdict phrase, so it **also** labels a real
  unverifiable answer (`answered with a password that is not token-shaped`, a 403, a Bot 200)
  as availability. That is the inverse error: an unclassifiable credential reads as an outage.
  Splitting the bucket in the check (FR-3) lets the banner tell them apart (FR-6).
- The mute/talkative inconsistency in the check is unchanged.

### Measured instance (from the issue, 2026-09-25, not re-run in this session)

During a gh-app-token broker outage, `/usr/local/bin/agent-git-credential get` exited `1`
with 350 bytes of stderr (`gh-app-token: the broker ANSWERED but returned an EMPTY token.`).
All six probes of that helper became `[UNKNOWN]`; every other path was `[clean]`. Not
re-measured here: this dispatch does not run the live check or touch the broker.

### A gap the issue does not name: a credential on stderr is never classified

At `:327`, stderr is quoted into the `UNKNOWN` line and passes through `redact()` (`:99-104`),
so a token on stderr is **hidden** from the output but **never sent to `classify`**. A helper
(or a debug flag on one) that prints a live founder token to stderr and exits non-zero
produces `[UNKNOWN] ... exited 3 without a credential (<redacted>)` today. That stderr reaches
the agent's terminal (git passes it through), so the token is reachable, and the check reports
it as an availability problem instead of `[USER]`. Under the issue's rec as literally worded
("decide reachability from stdout") this gap would remain. FR-2 closes it.

## Functional Requirements

- **FR-1: Reachability is decided from output content only.** For every producer probe
  (helpers in P2b; the keyring in P1 under D-2's rec), the classification is decided in this
  order, and the exit code and stderr *emptiness* play no part in steps 1-3:
  1. **Credential handed over.** Stdout carries a credential-protocol attribute line that git
     would use - `password=`, `credential=` (git 2.46+ pre-encoded credential),
     `oauth_refresh_token=` - or, for the keyring, any non-empty stdout. Every token-shaped
     value from those lines, and from `username=`, goes through `record` exactly as `:317-322`
     does today. If none is token-shaped: `[UNKNOWN] ... answered with a credential that is
     not token-shaped` (unchanged meaning).
  2. **Credential-shaped content anywhere else in stdout.** Stdout has no attribute line from
     step 1 but contains a `TOKEN_RE` match anywhere (a malformed line such as `password ghp_…`,
     a bare token, a partial write before dying). Each match goes through `record`. This is
     the issue's required "partial or malformed credential must still land in the alarming
     bucket", implemented as a content check, never as an exit-code exemption.
  3. **Any other non-empty stdout** that is not git-protocol attribute lines (`key=value`
     with a key from git's credential protocol) is `[UNKNOWN] ... answered with output that is
     not a credential` and keeps today's `could not be verified` meaning.
  4. **Nothing handed over.** Stdout is empty, or carries only non-secret protocol attributes
     (`protocol=`, `host=`, `path=`, `quit=`, `capability[]=`, `authtype=` with no value step 1
     or 2 matched). Then the exit status picks the bucket: see FR-3.
- **FR-2: Stderr is scanned for credentials, then used for wording only.** Before FR-1 step 4
  is applied, the probe's full stderr (not the 80-byte excerpt) is scanned for `TOKEN_RE`.
  Each match goes through `record` with label `<probe>: on stderr`, because stderr reaches the
  agent's terminal. Stderr never moves a probe *toward* `clean`, and its emptiness never
  moves a probe *toward* `unknown`. Apart from this scan, stderr is used only for the excerpt
  in the `[unavailable]` line (still through `redact()`).
- **FR-3: A new `[unavailable]` result, counted separately, still failing.** A probe that
  reaches FR-1 step 4 with a non-zero exit status (including timeout, rc 124, under D-3's rec)
  prints `[unavailable] <label>: producer failed (exit <rc>) and handed over no credential
  (<redacted stderr excerpt>)`, increments a new counter `unavailable`, and does **not**
  increment `unknowns`. A probe at step 4 with exit `0` is `[clean]` as today. Mute exit `1`
  is handled by D-1. Counting: each probe prints its own line; the counter counts distinct
  producers (one helper string, or the keyring), so six probes of one dead helper read as one
  unavailable producer in the verdict.
- **FR-4: Verdict precedence and wording.** The verdict block becomes, in order:
  1. `users > 0` - unchanged (`FAIL — N path(s) yield a GitHub USER credential`, exit `1`), with
     every other non-zero count appended.
  2. `unknowns > 0` - unchanged wording and exit `2`; append `; N producer(s) unavailable` when
     that count is non-zero.
  3. `unavailable > 0` - `FAIL — N credential producer(s) unavailable; no credential was
     obtained from any path (fail-closed)`, exit `2`. The phrase `could not be verified` must
     **not** appear in this verdict.
  4. `clean == 0` and 5. `PASS` - unchanged.

  If SPEC-226 lands first, its `not scanned` count sits between steps 2 and 3, and the verdict
  names every non-zero count. Exit codes stay `0`/`1`/`2` (INV-4).
- **FR-5: The suite's intent cases are rewritten, not deleted.** The two cases pinning
  "error is UNKNOWN" (test `:155-156`, `:179-180`) become "error with no credential is
  UNAVAILABLE, exit 2, and the verdict does not contain `could not be verified`". New cases are
  listed under Acceptance Criteria.
- **FR-6: The banner tells unavailable apart from unverifiable.** In
  `scripts/hooks/session-identity.sh`, a verdict containing `producer(s) unavailable` and no
  `could not be verified` keeps the existing availability text (`:99-103`) and names the first
  `[unavailable]` record line. A verdict containing `could not be verified` (a producer
  answered with something the check could not classify) gets its own text: the check received
  an answer it could not classify, which is not known to be an outage; run the check and read
  the `[UNKNOWN]` lines before any GitHub write. It must **not** say "Most commonly the token
  broker is down". The `0/*` USER arm (`:105-109`) is unchanged.

## Acceptance Criteria

All check cases run in `identity-boundary-check.test.sh`'s hermetic sandbox (temp `HOME`, stub
`curl`/`gh`/`ssh`, fake tokens assembled at runtime). Banner cases run in
`packages/minspec/tests/session-identity.test.ts` here.

- [ ] **The incident.** A helper that writes 350 bytes of diagnostic to stderr and exits `1`
      with empty stdout: exit `2`, verdict contains `producer(s) unavailable`, does **not**
      contain `could not be verified`, record has `[unavailable]` lines and no `[UNKNOWN]`
      line for that helper. Shown red on the unchanged script. (FR-1.4, FR-3, FR-4)
- [ ] **Mute equals talkative for reachability.** The same helper with stderr silenced
      produces no `[USER]` and no `[UNKNOWN]` line; its bucket follows D-1. Under D-1's rec,
      it is `[unavailable]` exactly like the talkative one. (FR-1, D-1)
- [ ] **Partial credential before dying still alarms.** A helper printing
      `password=<user-class fake>` then exiting `3`: exit `1`, `[USER]`. A helper printing
      `password <user-class fake>` (malformed, no `=`) then exiting `1`: exit `1`, `[USER]`.
      A helper printing a bare user-class fake token on stdout then exiting `1`: exit `1`.
      (FR-1.1, FR-1.2)
- [ ] **Token on stderr is classified.** A helper printing a user-class fake token to
      **stderr** and exiting `3`: exit `1`, a `[USER]` line labelled `on stderr`. Shown red on
      the unchanged script (which exits `2`). (FR-2)
- [ ] **Unclassifiable answers stay UNKNOWN.** The existing `password=hunter2` case still exits
      `2` with `could not be verified`; a helper printing `garbage` on stdout and exiting `1`
      exits `2` with `could not be verified`. (FR-1.1, FR-1.3)
- [ ] **Unavailable never passes.** With every probe unavailable and zero clean paths, exit
      `2`. With one unavailable producer and every other path clean, exit `2`. (INV-1)
- [ ] **Can still pass.** Empty sandbox exits `0`; `gh auth git-credential` stubbed as "not
      logged in" (its real behaviour under D-1) exits `0`. (INV-3)
- [ ] **No values.** Every new case asserts no fake token value appears in stdout or stderr
      of the check, including the stderr-token case. (INV-2)
- [ ] **Banner, both arms.** A stub verdict `FAIL — 1 credential producer(s) unavailable; ...
      (fail-closed)` prints the availability text and the first `[unavailable]` line. A stub
      verdict `FAIL — 1 path(s) could not be verified (fail-closed)` prints the
      unverifiable text and does **not** contain `token broker`. Existing USER and PASS
      banner cases are unchanged. (FR-6)
- [ ] **Suites green.** `identity-boundary-check.test.sh` passes in the container with zero
      stderr output (its existing rule); `npx vitest run packages/minspec/tests/session-identity.test.ts`
      and `npm run lint` pass here.

## Invariants (must not break)

- **INV-1: No silent gate (constitution invariant 2, DR-066).** A producer that failed is
  never `[clean]` and never counts toward `PASS` (except the narrow, named D-1 case if the
  founder picks it). `[unavailable]` keeps exit `2`. Making the alarm *accurate* must not
  make it *absent*.
- **INV-2: No values, ever.** Every new line, including the stderr excerpt and the
  `on stderr` label, goes through `redact()`; values appear only as `fp()` fingerprints.
- **INV-3: The check can still pass** (`:42-43`). A healthy container with `gh` logged out
  must exit `0`.
- **INV-4: Exit codes and the verdict-line format stay compatible.** `0`/`1`/`2`, one
  `IDENTITY-BOUNDARY [<location>]: <verdict>` line. `session-identity.sh`, SPEC-213 and
  SPEC-226 depend on them.
- **INV-5: Never send a non-GitHub secret to GitHub** (`:47-48`). The stderr scan (FR-2)
  classifies only `TOKEN_RE` matches, which are GitHub-prefixed, and only from helpers already
  scoped to a GitHub host.
- **INV-6: Blast radius (constitution invariant 3).** The check is the founder's machine-local
  dev tooling; nothing ships to adopters. **INV-7: No new network endpoint (invariant 1)** -
  FR-2 can add `classify` calls only to the existing `api.github.com/user`.

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

### D-1: What does a mute exit 1 mean?

**Recorded selection: Option (a),** narrow the acceptance to helpers with an independent
witness: mute exit 1 is `[clean]` only for `gh auth git-credential`, and every other mute
non-zero exit is `[unavailable]`.

Today `rc 1` + empty stderr + empty stdout is `[clean]` for **any** helper (`:324`). The
header justifies it for one helper only: "that is how `gh auth git-credential` says 'not
logged in'. The keyring it would read is probed directly (P1, stderr-checked), so this is not
the only witness" (`:44-46`). For every other helper there is no second witness, so a mute
failure of, say, a libsecret-backed helper with a locked keyring reads as "no credential"
(inferred - no such helper was tested in this session).

- **(a) Narrow the acceptance to helpers with an independent witness (rec).** Mute exit 1 is
  `[clean]` only for a helper whose store another probe reads directly - today
  `gh auth git-credential` (store = the keyring P1 reads). Every other mute non-zero exit is
  `[unavailable]`, the same as a talkative one. This is the issue's consistency fix applied in
  the direction the header's own reasoning supports. Cost: a third-party helper that uses
  mute exit 1 to mean "I have nothing" (inferred to be uncommon; git's documented convention
  is exit 0 with no output) would turn the run to exit `2` permanently on a machine that
  configures it, and needs an entry on the witnessed list or a fix to the helper.
- (b) Keep mute exit 1 as `[clean]` for every helper; only the talkative case moves to
  `[unavailable]`. Cost: stderr still decides between pass and fail - the inconsistency the
  issue names survives, now as `clean` versus `unavailable` instead of `clean` versus `unknown`.
- (c) Every non-zero exit is `[unavailable]`, including `gh auth git-credential`. Cost: the
  check fails in every container where `gh` is logged out (inferred: `gh auth git-credential
  get` exits 1 silently when not logged in, per the header), which breaks INV-3.

### D-2: Does the same rule apply to the keyring probe (P1)?

**Recorded selection: Option (a),** yes; `gh auth token` exiting with an error and no token is
`[unavailable]`, not `[UNKNOWN]`, and it still fails the run (INV-1).

- **(a) Yes (rec).** `gh auth token` exiting with an error and no token is `[unavailable]`,
  not `[UNKNOWN]`. The header's D-Bus concern is kept: it still fails the run (INV-1). Cost:
  a keyring error that is in fact a *permission* problem on a populated keyring (the
  `ptrace_scope=1` class) is worded "unavailable" rather than "could not be verified"; both
  exit `2`, so only the wording is softer.
- (b) No; P1 keeps `[UNKNOWN]`. Cost: the same mute-versus-talkative inconsistency stays in
  one section, and a keyring hiccup still reads as unverifiable.

### D-3: Is a timeout (rc 124) unavailable or unknown?

**Recorded selection: Option (a),** a timeout (rc 124) is unavailable when stdout carried no
credential, the same state of nothing handed over.

- **(a) Unavailable, when stdout carried no credential (rec).** It is the same state - nothing
  handed over - and a hung broker is the second most likely outage shape (inferred). Cost: a
  helper blocked on an interactive unlock prompt that *would* hand over a founder credential
  if answered is worded "unavailable"; it still fails the run.
- (b) Keep `[UNKNOWN]` with today's "producer may be live but unanswering" text. Cost: a hung
  broker keeps producing the `could not be verified` wording this spec exists to retire.

## Alternatives considered and rejected

- **Treat a mute exit 1 as UNKNOWN too (issue option 2).** Strictly more alarm and still no
  way to tell unavailability from reachability; it fixes the inconsistency and keeps the
  inversion. Also breaks INV-3 for a logged-out `gh` (see D-1 c).
- **Document the outage reading and change nothing (issue option 3).** Keeps training
  responders to skim the banner (#1043 shape).
- **Make unavailable exit 0 (PASS with a note).** Would let a failed producer that sits in
  front of a populated store pass - the exact "couldn't read it became nothing there" failure
  the header records twice. Rejected by INV-1.
- **Decide reachability from stdout only, as the issue literally words it.** Leaves the
  stderr-token gap (FR-2) open: a token printed to stderr would be counted `[unavailable]`.

## Limitations, stated plainly

- `[unavailable]` means "nothing was handed over at this instant". It does not mean the store
  behind the producer is empty; a producer that recovers may hand over a founder credential on
  the next run. The run stays failing for exactly this reason.
- The check is point-in-time (`session-identity.sh` runs it every 30 minutes in the
  background), as SPEC-226 also states.
- FR-1 step 4's list of non-secret protocol attributes is itself a list. A future git
  attribute that carries a secret under a new key would read as "nothing handed over" unless
  step 2's `TOKEN_RE` scan catches its value - which it does for any GitHub-prefixed token.

## Costly to Refactor

The verdict phrases `producer(s) unavailable` and `could not be verified` become a contract
with the banner (FR-6) and its tests. They are defined once in the check and pinned by one
banner case each. Everything else reverts in one commit per repository.

## Why no new DR

No choice here takes more than a day to undo (the ADR filter: a DR only for a choice that takes longer than that to undo): it is a classification
and wording change inside one machine-local script plus one banner arm. Where the check's
source lives is SPEC-226 D-1 and is not re-decided here. DR-066 (no silent gate) is the rule
applied; this spec does not change it.

## Out of Scope

- **Where the check's source lives** - SPEC-226 D-1.
- **Coverage of unscanned surfaces** - SPEC-226.
- **The broker client's own diagnostics and the outage itself** - #2146 is about the check's
  classification, not the broker.
- **The banner's `first_path` picking the first non-`[clean]` line, which can be an `[info]`
  or `[note]` line** (`session-identity.sh:98`, read in this session, not reproduced). FR-6
  replaces that selector for the two arms it touches; any other arm is untouched.

## Test plan (for the Plan phase to place)

- **T0, against the unchanged script:** write "The incident", "Token on stderr is classified"
  and "Mute equals talkative" cases and show them red; show "Can still pass" and
  "Unclassifiable answers stay UNKNOWN" green.
- **T1:** FR-1 to FR-6, case by case, red first then green.
- **Not vacuous:** each fail-closed case has a passing control; the stderr-token case asserts
  the `[USER]` label text, not the exit code alone.

## Traceability

- **Issue:** [#2146](https://github.com/AIClarityAU/minspec/issues/2146).
- **Origin of the check:** #1816. Banner availability split already shipped: #2044 (`ac5c069bd`,
  #2191). Reflexive-override shape: #1043.
- **Rule applied:** [DR-066](../../../docs/decisions/DR-066.md) (no silent gate; constitution
  invariant 2). Isolation context: [DR-008](../../../docs/decisions/DR-008.md).
- **Sibling specs:** SPEC-226 (unscanned surfaces; same script, same verdict block, same banner
  arm - whichever lands second rebases its verdict precedence onto the other's), SPEC-213
  (location witness).
- **Follow-ups:** None.
- **DR for this spec:** none; see "Why no new DR".
