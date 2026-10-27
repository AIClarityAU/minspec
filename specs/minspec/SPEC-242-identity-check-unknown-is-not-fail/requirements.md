---
id: SPEC-242
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same credential-boundary domain as SPEC-226 and SPEC-213
aspects: [security, identity, credential-boundary, fail-closed, no-silent-gate, cry-wolf, evidence]
relates_to: [DR-066, DR-003, SPEC-226, SPEC-213, "#2160", "#2042", "#2044", "#1816"]
# The check this spec changes is NOT in this repo: it is
# ~/.claude/scripts/identity-boundary-check.sh with its suite at
# ~/.claude/scripts/tests/identity-boundary-check.test.sh, in the founder's host-side
# claude-config repository (the container's ~/.claude has no .git). SPEC-226 D-1 decides
# where that source of truth lives; this spec follows whatever D-1 decides.
implements: none
implements_reason: >-
  The verdict logic lives outside this repository (see SPEC-226 D-1). The only in-repo
  files this spec changes are the session banner and its test, which SPEC-226 and
  SPEC-213 also edit; owning them from this spec would freeze them for those specs.
affects: [scripts/hooks/session-identity.sh, packages/minspec/tests/session-identity.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-242: The identity check reports "could not verify" as UNKNOWN, not as FAIL, and keeps the evidence

## In plain terms

`identity-boundary-check.sh` answers one question: can an agent session in the container
use a GitHub credential that acts as the founder? Today it has two kinds of FAIL. One means
"a founder credential was found". The other means "some probe gave no answer, so the check
refused to call it clean". Both start with the word `FAIL`. On #2160 a session saw the second
kind, and 20 minutes later a PASS, with no credential change in between.

This spec does three things. The second kind of result gets its own verdict word,
`UNKNOWN`, so `FAIL` only ever means a found credential. Every UNKNOWN line names its cause
class, so a reader can tell "GitHub did not answer" from "a file could not be read". And the
record of a non-PASS run is kept instead of being overwritten by the next run, so a cause
can be looked up after the fact.

The exit code does not change: UNKNOWN still exits `2` and still fails closed. Only the
word and the evidence change.

Cost: anything that matches on the word `FAIL` in the verdict line must be updated together
(the banner here, and SPEC-213's consumer). The assumption most likely to be wrong: that the
6 unknowns on #2160 came from GitHub classification calls and not from some other probe.
That was not observed, because the record was overwritten (see Measured). FR-1 exists so the
next one is observed.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. The founder
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves this spec
> through the normal approval gate before anything is built. Every requirement is written
> under the recommended answer to each decision.

Materializes **[#2160](https://github.com/AIClarityAU/minspec/issues/2160)**: *"identity-boundary-check
fails closed on process churn, so a security alarm fires without a credential finding."*

**Id note.** `SPEC-242` is the highest claimed id plus one. Claimed ids were read on
2026-10-27 from every remote-tracking branch of this worktree's repository (highest
`SPEC-241`) and from `origin/main` at `983e9107`. Open pull requests were not queried, because
this dispatch makes no network call. If the id collides at review time, renumber.

**Tier note.** Triage recorded T3 (full spec cycle). Mechanical scope is small: one script
and its suite outside this repo, plus one hook and one test here. It is a security gate's
verdict contract, so this spec keeps T3 ceremony.

## One-Sentence Scope

Give `identity-boundary-check.sh` a distinct `UNKNOWN` verdict for "could not verify" (still
exit `2`, still fail-closed), tag every UNKNOWN line with a cause class, and keep the full
record of every non-PASS run so its cause can be read later.

## Context: what the code does today

Read from `~/.claude/scripts/identity-boundary-check.sh` (27140 bytes, mtime 2026-09-11) and
this repo at `origin/main` `983e9107`. Inferred statements are marked.

### What the issue says, checked against the code

The issue proposes a mechanism: process churn changes which process environments are scanned,
and that produces the FAIL. Three parts of that were checked.

1. **A pid that exits mid-scan is already not a gap.** P4 reads `/proc/<pid>/environ`; if the
   read fails and `/proc/<pid>` no longer exists, the pid is skipped and nothing is counted
   (`identity-boundary-check.sh:413-416`, comment: *"a PID that exited mid-scan is not a
   gap"*). A pid that still exists but cannot be read is counted as `[NOT COVERED]`, not
   `UNKNOWN` (`:422`). So churn in the scanned set cannot by itself raise `unknowns`. The
   62-versus-52 count on #2160 is the `[info]` line (`:423`), which does not feed the verdict.
2. **"6 paths in the FAIL, 15 in the PASS" compares two different counters.** The FAIL
   verdict prints `$unknowns` (`:472`). The PASS verdict prints `$clean` (`:474`). Neither is
   "how many paths were reachable". The FAIL run's `clean` count was never printed. So the
   numbers do not show that fewer paths were readable; that reading of the evidence is not
   supported.
3. **The banner split already exists in part.** #2044 (merged 2026-10-01 as `ac5c069bd`, after
   this issue was filed) made the banner treat a `could not be verified … (fail-closed)`
   verdict as an *availability* failure that does not say "tell the human before any GitHub
   write" (`scripts/hooks/session-identity.sh:89-104`). The "warn the human" text on #2160 is
   the pre-#2044 banner. What #2044 did **not** change: the verdict line itself still starts
   with `FAIL`, and the banner tells the two apart only by matching free text.

### Root cause (mechanism plus missing gate)

**Mechanism.** The verdict has one word, `FAIL`, for two different facts: "a USER credential
was observed" (exit `1`) and "a probe gave no definitive answer" (exit `2`) (`:470-473`). Any
reader that does not parse the exit code or the rest of the sentence sees one alarm. Where
the UNKNOWNs come from is a set of probes that depend on things outside the credential
question: GitHub's `/user` endpoint answering within 15 seconds (`:120`, `:136` maps any
non-200/401/403 code, including `000` for a timeout and `429`, to `UNKNOWN`), GitHub answering
`403` for something other than an App token (`:133-134`, which includes rate limiting), `ssh`
to GitHub answering (`:451`), and credential helpers answering within 20 seconds (`:313`). The
number of `/user` calls a run makes grows with the number of distinct token-shaped values in
process environments, because each one is classified (`:420`). *Inferred, not observed:* a
busy fleet, each session holding its own broker `ghs_` token, raises that call count, and
with it the chance that one call times out or is rate limited. That is the most likely link
between "process churn" and the FAIL, and it is a link through the network, not through
unreadable pids.

**Missing gates.**
- **No cause is retained.** The banner's background runner moves each completed run over the
  previous record (`session-identity.sh:124`, `mv -f "$tmp" "$last"`). The FAIL record on
  #2160, with its six `[UNKNOWN]` lines, was replaced by the next PASS and no longer exists.
  The only record on disk at 2026-10-27 is a PASS. So the question "what were the 6?" cannot
  be answered, and every future occurrence is equally unanswerable. This is the gate that
  should have made the issue's mechanism checkable.
- **The UNKNOWN lines carry no cause class.** They are free text (`:149`, `:244-258`, `:313`,
  `:327`, `:359`, `:451`). A reader, or the banner, cannot tell "GitHub was unavailable" from
  "a credential file exists and cannot be read" without reading every line. The second one is
  much closer to a finding than the first.

### Measured (2026-10-27, in the agent container)

- `~/.cache/identity-boundary/` holds one record (`3f0d7631954d.last`, 1407 bytes): a PASS with
  13 clean, `25 process environment(s) scanned`. No non-PASS record exists.
- The verdict line is the only contract: `IDENTITY-BOUNDARY [<location>]: <verdict>`, exit
  `0`/`1`/`2` (`:52-53`, `:476-479`). The banner reads the last `IDENTITY-BOUNDARY` line from the
  record (`session-identity.sh:75`) and switches on it (`:86-113`).
- **Unmeasured:** which probe produced the six UNKNOWNs on #2160; how many `/user` calls a run
  makes under a full fleet; whether GitHub rate-limited any of them. Plan T0 measures the
  second; FR-1 makes the first answerable next time.

## Functional Requirements

- **FR-1: Keep the evidence of every non-PASS run.** When a completed run's verdict is not
  `PASS`, the banner's background runner keeps that run's full record, in addition to
  replacing `<host>.last`. The kept copy is named with the run's UTC finish time, lives in the
  same mode-`0700` state directory, and is mode `0600`. At most the newest N kept copies are
  kept (D-3 sets N; rec 20); older ones are deleted. A PASS run keeps no extra copy. The record
  already contains no token values (`redact()`, `:99-103`), and FR-1 adds no new content to it.
- **FR-2: A cause class on every UNKNOWN line.** Every `[UNKNOWN]` line carries exactly one
  cause class from this closed list, written as `[UNKNOWN:<class>]`:
  1. `network` — a remote producer did not give a definitive answer: `/user` returned `000`,
     `5xx`, `429`, or a `403` not matching the App rule; `ssh` gave no greeting and no
     `Permission denied`.
  2. `producer` — a local producer did not give a definitive answer: a helper timed out or
     exited non-zero with stderr; `gh auth token` failed; a required tool is not installed.
  3. `unreadable` — a credential store exists and could not be read.
  4. `malformed` — a store holds a GitHub entry with no token-shaped secret, or a producer
     answered with something that is not a token.
  5. `ambiguous` — the evidence contradicts itself: the location witnesses disagree, more
     than one ssh greeting, `/user` answered 200 as a Bot.
  6. `incomplete` — a section did not complete (`:468`), or the run aborted.

  A new UNKNOWN site that has no class is a test failure (FR-6 AC "every site tagged"), so a
  class cannot be skipped by accident.
- **FR-3: `UNKNOWN` is its own verdict word.** The verdict line becomes one of:
  - `FAIL — <n> path(s) yield a GitHub USER credential[; <m> more could not be verified]` —
    exit `1`. Unchanged. `FAIL` is used **only** here.
  - `UNKNOWN — <m> path(s) could not be verified (fail-closed): <class>=<count>[, …]; <c> path(s) clean` —
    exit `2`. Replaces today's `FAIL — <m> path(s) could not be verified (fail-closed)`. It names
    the per-class counts and the clean count, so two runs can be compared on the same counter.
  - `UNKNOWN — nothing was checked (fail-closed)` — exit `2`. Replaces today's
    `FAIL — nothing was checked (fail-closed)`.
  - `PASS — no GitHub user credential reachable (<c> path(s) checked)` — exit `0`. Unchanged.
  The phrase `fail-closed` stays in every exit-`2` verdict.
- **FR-4: `unreadable` and `incomplete` are named first.** When the UNKNOWN classes include
  `unreadable` or `incomplete`, the verdict lists those classes first, and the first named
  path is the first `unreadable` line. Reason: an existing credential store the check cannot
  read may hold a live founder credential; that is not an availability blip. (D-2 asks
  whether it should go further and exit `1`.)
- **FR-5: The banner reads the verdict word, not the sentence.** In
  `scripts/hooks/session-identity.sh`:
  1. `0/PASS*` — unchanged.
  2. `0/UNKNOWN*` with only `network`/`producer` classes — the existing availability text
     (`:100-103`), with the class counts and the first UNKNOWN line, and the path to the kept
     record from FR-1. It does not say "tell the human before any GitHub write".
  3. `0/UNKNOWN*` with any `unreadable`, `malformed`, `ambiguous` or `incomplete` class — a
     distinct line: the check could not verify a credential store or its own run, so a founder
     credential there would not be seen; names the first such line and the kept record; tells
     the session to run the check by hand before any GitHub write. It does not say "token
     broker".
  4. `0/FAIL*` — the existing finding text (`:107-109`). Unchanged.
  5. A verdict that matches none of these (for example an older script still printing
     `FAIL — … could not be verified`) is shown as the finding text, never as availability:
     an unrecognised shape fails toward the louder message, not the quieter one.
  Once FR-3 ships, the free-text match on `fail-closed` / `could not be verified` (`:93`) is
  removed, so the banner has one way to tell the cases apart.
- **FR-6: The counts that move with the fleet stay informational.** The `process
  environment(s) scanned` and `[NOT COVERED]` counts stay `[info]` / `[NOT COVERED]` lines
  and never change the verdict. This is today's behaviour (`:413-424`) and is pinned by a test
  so a later change cannot make pid churn a verdict input.
- **FR-7: No values, no new endpoints, no writes outside the state directory.** Every new or
  changed line goes through `redact()`. The check makes no call it does not make today. FR-1
  writes only under `${XDG_CACHE_HOME:-$HOME/.cache}/identity-boundary/`.

## Costly to Refactor

1. **The verdict word is a contract.** The banner here and SPEC-213's consumer match on it.
   Renaming `UNKNOWN` later means changing every consumer in the same change. Check: the word
   is defined once in the check, and one banner test pins each verdict shape.
2. **The cause-class list is a contract.** The banner routes on it (FR-5). Adding a class is
   cheap; renaming or merging one needs the banner changed with it.

Everything else can be reverted in one commit to each repository.

## Acceptance Criteria

Check cases run in `identity-boundary-check.test.sh`'s hermetic sandbox (temp `HOME`, stub
`curl`/`gh`/`ssh`, fake tokens assembled at runtime). Banner cases run in
`session-identity.test.ts` here.

- [ ] **Network UNKNOWN is not FAIL.** Stub `curl` returns `000` for one env-held fake token.
      Exit is `2`; the verdict starts `UNKNOWN —`, contains `network=1` and a clean count; no
      line starts `FAIL`. On the unchanged script the verdict starts `FAIL —` (red baseline,
      shown in the PR). (FR-2, FR-3)
- [ ] **Rate limit is network.** Stub `curl` returns `403` with a rate-limit body for a `ghp_`
      fake, and `429` for another. Both lines are `[UNKNOWN:network]`. (FR-2.1)
- [ ] **USER is still FAIL.** A user-class fake in `.git-credentials` exits `1`, the verdict
      starts `FAIL —`. (FR-3, INV-1)
- [ ] **Unreadable store is named first.** A mode-`000` `.git-credentials` plus one network
      UNKNOWN: exit `2`, the verdict lists `unreadable=1` before `network=1`. (FR-4)
- [ ] **Every UNKNOWN site is tagged.** A source-level test lists every call of `unknown` and
      every `unknowns=$((unknowns+1))` in the script and fails if any emitted line lacks a
      class from the FR-2 list. A mutant that drops one tag makes it red. (FR-2)
- [ ] **Pid churn cannot change the verdict.** Run the check with a fake `/proc` population
      of 5 and of 50 readable environments holding no token, and with 3 pids that vanish
      between listing and read. All runs give the same verdict word and exit. (FR-6)
- [ ] **Evidence is kept.** In the banner test, a stub check that prints an `UNKNOWN` verdict
      leaves `<host>.last` plus one kept copy with that content, mode `0600`; a following PASS
      replaces `<host>.last` and leaves the kept copy. N+1 non-PASS runs leave N kept copies.
      (FR-1)
- [ ] **Banner routing.** Stub verdicts for each FR-5 case print their own text: network-only
      UNKNOWN does not contain `tell the human`; unreadable UNKNOWN does not contain `token
      broker`; the legacy `FAIL — 6 path(s) could not be verified (fail-closed)` string prints
      the finding text. (FR-5)
- [ ] **No values in output or kept records.** Every new case asserts no fake token value in
      stdout, stderr, `<host>.last` or any kept copy. (FR-7)
- [ ] **Suites green.** `identity-boundary-check.test.sh` passes with zero stderr output (its
      existing rule). `npx vitest run packages/minspec/tests/session-identity.test.ts` and
      `npm run lint` pass here.

## Invariants (must not break)

- **INV-1: No silent gate (constitution invariant 2, DR-066).** An UNKNOWN still exits `2`
  and still fails the run. This spec renames the verdict word and adds a cause; it never turns
  an unverified path into `clean` or `PASS`. No class, cap or retry may downgrade UNKNOWN.
- **INV-2: No values, ever** (`:49-50`), including in kept records.
- **INV-3: Never send a non-GitHub secret to GitHub** (`:47-48`). Unchanged; this spec adds no
  classification.
- **INV-4: The check can still pass.** A clean system still exits `0` with `PASS`.
- **INV-5: Exit codes and line format stay compatible.** `0`/`1`/`2`, one
  `IDENTITY-BOUNDARY [<location>]: <verdict>` line, `--location` unchanged. Only the first word
  of the exit-`2` verdict changes, from `FAIL` to `UNKNOWN`; consumers that key on the exit code
  are unaffected.
- **INV-6: Blast radius (constitution invariant 3).** This is the founder's dev tooling; nothing
  ships to adopters.
- **INV-7: Offline core (constitution invariant 1).** No new network call. MinSpec's product
  core is unaffected.

## Decisions needed (Clarify)

### D-1: Retry a `network` UNKNOWN before reporting it?

- **(a) No retry; report it with its class (rec).** The verdict stays a true record of what
  happened, and FR-1 keeps the evidence to measure how often it happens. Cost: a single
  timeout still makes the banner show the availability line until the next run, up to 30
  minutes later (`FRESH_S`, `session-identity.sh:36`).
- (b) Retry each `network` UNKNOWN once after a short wait, as the check already does for one
  `401` (`:123-124`). Cost: under a real outage every retry adds up to 15 more seconds per token,
  and the banner's runner kills the check at 300 seconds (`session-identity.sh:122`), which leaves the old
  record in place and hides the outage as an old PASS. A retry also hides the rate of
  transient failures that FR-1 is meant to measure.

### D-2: Should an `unreadable` credential store exit `1` (finding) instead of `2`?

- **(a) No; it stays exit `2`, named first, with its own banner line (rec).** It is not an
  observed credential, and calling it one is the same cry-wolf the issue complains of, in
  the other direction. Cost: a store the agent cannot read but some other process can (and
  that holds a live token) shows as UNKNOWN, not FAIL; the banner tells the session to check
  by hand, which relies on the session doing so.
- (b) Exit `1`. Cost: a file with a wrong mode, no credential in it, raises the founder-leak
  alarm.

### D-3: How many non-PASS records to keep (FR-1)?

- **(a) The newest 20 (rec).** At one run per 30 minutes that is at least 10 hours of
  failures, and each record is about 1.5 KB. Cost: a long outage rolls the first failure out;
  the first one is the one that names the onset.
- (b) Keep the first and the newest 19 of each unbroken non-PASS streak. Cost: more logic in a
  hook that must not fail; a bug there loses evidence silently.

## Clarify selections (recorded by the specifying agent 2026-10-27; ratified only by approval of this spec)

- **The issue's "UNKNOWN with the path named" direction is adopted; its process-churn
  mechanism is not.** The code skips exited pids and does not count unreadable live pids as
  UNKNOWN (Context, point 1). Rejected: treating pid churn as the cause and changing P4. The
  requirement FR-6 pins today's P4 behaviour instead.
- **Verdict word `UNKNOWN`, not a new exit code.** Rejected: exit `3` for UNKNOWN. Every
  consumer would need a change, and the existing `2` already means "unknown / aborted" in the
  check's documented contract (`:52`).

## Limitations, stated plainly

- **This spec does not find the cause of the #2160 FAIL.** That record is gone. FR-1 makes the
  next one readable; the class counts in FR-3 make it readable from the verdict line alone.
- **A real outage still makes the banner show a warning.** It shows the availability text, not
  the finding text. That is the intended fail-closed behaviour, not a defect.
- **Coverage gaps are SPEC-226's subject.** Paths the check has no entry for (#2042) stay
  clean by omission until SPEC-226 lands. This spec and SPEC-226 both add UNKNOWN shapes;
  SPEC-226's "not scanned" result maps to class `incomplete` here, and whichever lands second
  aligns its wording to the other.

## Why no new DR

The verdict word and the class list can be renamed in one change to each repository, which is
under the ADR filter (a DR only for a choice that takes more than a day to undo). DR-066 (no
silent gate) is the rule this spec applies; it does not change DR-066.

## Out of Scope

- **Reducing the number of `/user` calls a full fleet causes** (for example caching dead
  fingerprints across runs). SPEC-226 FR-7 covers this.
- **Scanning more surfaces.** SPEC-226.
- **The location witness.** SPEC-213.

## Alternatives considered and rejected

- **Make the env scan ignore pids that change between runs.** The code already ignores exited
  pids, so this changes nothing about the verdict, and it would make the scan's coverage depend
  on timing.
- **Downgrade a single `network` UNKNOWN to PASS-with-warning.** That is a silent pass on a
  missing witness, which DR-066 and constitution invariant 2 forbid.
- **Rely on the #2044 banner split alone.** It routes on free text in a verdict that still says
  `FAIL`; any other reader of the verdict line still sees an alarm, and the cause is still lost.

## Test plan (for the Plan phase to place)

- **T0, before any change:** (1) write the "Network UNKNOWN is not FAIL", "Every UNKNOWN site is
  tagged", "Evidence is kept" and "Banner routing" cases and show them red on the unchanged code;
  the "USER is still FAIL" and "Pid churn cannot change the verdict" cases must be green on the
  unchanged code. (2) Count the `/user` calls one full run makes under the live fleet, by
  counting classify calls only; no value printed.
- **T1:** FR-1 to FR-7, case by case, red first, then green.
- **Not vacuous:** every UNKNOWN case has a control that passes; the tag test is checked
  against a mutant that removes one tag.

## Traceability

- **Issue:** [#2160](https://github.com/AIClarityAU/minspec/issues/2160).
- **Related:** #2042 / SPEC-226 (the opposite failure direction in the same check); #2044 (the
  banner's availability-versus-finding split, merged as `ac5c069bd`); #1816 (origin of the
  check); SPEC-213 (location witness, a consumer of the verdict line).
- **Rule applied:** [DR-066](../../../docs/decisions/DR-066.md) (no silent gate; constitution
  invariant 2). Root-cause discipline: [DR-003](../../../docs/decisions/DR-003.md).
- **Follow-ups (tracked):** None. Every deferred item above is covered by SPEC-226 or SPEC-213.
- **DR for this spec:** none; see "Why no new DR".
