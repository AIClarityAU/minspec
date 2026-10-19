---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the credential-isolation work (#1816) and DR-066's no-silent-gate family both live here
aspects: [identity, credential-isolation, no-silent-gate, fail-closed, coverage, banner, blast-radius, evidence-discipline]
depends_on: [DR-066]  # the fail-closed / no-single-witness rule every FR below applies to the identity check itself
relates_to: [DR-082, DR-086, "#2048", "#2044", "#2191", "#1816", "#1846", "#1872", "#2046", "#1927"]
# Ownership declared in Specify (SPEC-038). Nothing NEW is created in this repo. The
# detector this spec mostly changes, identity-boundary-check.sh, lives OUTSIDE this repo
# (~/.claude/scripts, versioned on the host in harvest316/claude-config) on purpose:
# it is about the machine, not about MinSpec, and nothing in it ships to adopters
# (constitution invariant 3; header of scripts/hooks/session-identity.sh). Where that half
# is tracked is DQ-1.
implements: none
implements_reason: >-
  The in-repo half edits an existing dev-time hook and its test, which no spec owns; the
  detector half lives in a different repository and cannot be owned from this register (DQ-1).
affects: [scripts/hooks/session-identity.sh, packages/minspec/tests/session-identity.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: The identity check says how much it looked at, and its two FAIL causes stop sharing words

Triggered by: #2048 (identity-boundary-check: a path allowlist, and a banner that cannot tell
a possible leak from an agent with no credential at all).
Builds on: #1816 (the check and its session-start banner, #1927), #2044 (first split of the
FAIL wording, merged as #2191). Same class as #1846 and #1872, which each closed one path.
Rests on: DR-066 (No silent gate: fail visibly, never on a single producer). DR-082 (agent
GitHub writes take the bot identity) defines the bot's minting chain that FR-5 classifies.

## In plain terms

At the start of every session a banner reports whether this session can reach a founder
GitHub credential. The check behind it searches a fixed list of places. When it finds
nothing it says PASS. That means "nothing in the places I searched", but the banner drops
even the count of places searched, so it reads as "nothing anywhere".

When the check cannot verify a place, it fails closed, which is correct. But one cause is
"a place that could hold a founder credential gave no answer" and another is "the bot's own
token service is down, so the agent has no credential at all". These need opposite
responses: revoke something, or restart a service. #2044 fixed the old banner, which called
every such failure a possible leak. It did that by calling every one an availability
failure, so the error now runs the other way.

This spec makes the check report what it covered and tag why each place could not be
verified. The banner then prints both. It also widens the search to the config files the
agent harness reads, and anything token-shaped found outside the known list is classified
like any other credential, so it is never dropped.

## Current state (verified 2026-10-19, origin base `6df91ac4`)

Each line below was read from the code, not inferred. "Check line N" is a line of `~/.claude/scripts/identity-boundary-check.sh` (479 lines, read 2026-10-19). That file is outside this repo, so its line numbers will drift without this spec noticing.

| # | Observation | Evidence |
|---|---|---|
| CS-1 | The check's PASS carries a count, but it counts **clean results**, not surfaces examined. A surface that was not examined adds nothing, so it cannot show up as a gap. | check line 474 (`~/.claude/scripts/identity-boundary-check.sh`, outside this repo) (`$clean path(s) checked`) |
| CS-2 | The banner **removes** that count from the PASS line. | `scripts/hooks/session-identity.sh:87` (`${verdict%% (*}`); asserted by `packages/minspec/tests/session-identity.test.ts:177` |
| CS-3 | Since #2044, **every** FAIL made only of unverified paths gets the "AVAILABILITY failure, not a confirmed credential leak" wording, whatever produced the unverified paths. Example: a token in `hosts.yml` whose `/user` probe answered HTTP 500 is a founder-capable path left unverified, and it gets the wording meant for a broker outage. | `session-identity.sh:93-104`; the check gives such a token `[UNKNOWN]` (`identity-boundary-check.sh` `record()`, `UNKNOWN)` arm) |
| CS-4 | The check's output lines say nothing about where an unverified path came from. A reader cannot tell the bot's own helper from any other helper or store. | `identity-boundary-check.sh` `probe_helper()`; no output line names the producer's class |
| CS-5 | The banner's "First unverified" names the first line that is **not** `[clean]`. In a real record that can be an `[info]` or `[note]` line, not an `[UNKNOWN]` one. | `session-identity.sh:98`; `[note]` lines are emitted before later sections, e.g. the D-Bus note in P1 |
| CS-6 | Files scanned at rest: git credential stores, netrc, `gh`/`hub` config, `.env*` under `~/code` (depth 4), and listed shell rc files. The harness config files (`.mcp.json`, `.claude/settings*.json`, `~/.claude.json`) are not on the list. The at-rest env-var regex only matches `NAME=value`, so it would also miss the JSON shape `"GH_TOKEN": "…"`. | check lines 396-401 |
| CS-7 | A file that holds a token and is not on the list produces no output line at all: no `[clean]` and no `[UNKNOWN]`. | same; the list is the only producer of file candidates |
| CS-8 | The `[NOT COVERED]` count (unreadable process environments) is printed in the body but does not reach the verdict line or the banner. | check lines 422 and 474 |

## Functional requirements

### Coverage is reported, not implied (issue items 1 and 4)

- **FR-1. Count surfaces examined, not clean results.** The check counts each *surface* it
  examined: one location it looked at, or one producer it invoked. Each surface is counted
  once in exactly one of `user`, `unknown`, `clean`, `absent` (looked, nothing exists there)
  or `not-covered` (known to exist but structurally unreadable, as in CS-8). Today an absent
  file adds nothing (CS-1). Under FR-1 it counts as `absent`, so a reader can see that the
  check looked for it.
- **FR-2. A machine-readable coverage line.** Just before its `IDENTITY-BOUNDARY` verdict
  line, the check prints exactly one line:
  `IDENTITY-COVERAGE surfaces=<N> user=<a> unknown=<b> unknown_bot_chain=<c> clean=<d> absent=<e> not_covered=<f> sections=<s>/<S>`.
  The numbers must add up: `a+b+d+e+f = N`, and `c <= b`. This line is the contract between
  the check and the banner. Its field names are fixed by this spec (DQ-3 decides the
  versioning).
- **FR-3. The PASS verdict states its scope.** The PASS sentence becomes "no GitHub user
  credential reachable across N surfaces examined", and adds "(M not covered)" when `f > 0`.
  It must never read as a claim about places it did not examine.
- **FR-4. The banner keeps the scope.** A PASS banner shows the surface count, and the
  not-covered count when it is non-zero. CS-2's removal of the count is withdrawn. When the
  stored record has **no** `IDENTITY-COVERAGE` line (an older check, or a damaged record),
  the banner says that coverage was not reported. It must not render a bare PASS.

### The two FAIL causes are told apart by evidence, not by wording (issue item 2)

- **FR-5. Tag where each unverified path came from.** Every `[UNKNOWN]` line is tagged
  `bot-chain` or `other`. A path is `bot-chain` only when its producer is on an explicit,
  enumerated list of the bot identity's minting chain (DR-082). Examples: a credential
  helper whose command resolves to the bot token minter, or a `GH_TOKEN` the bot wrapper
  injects. The match is on the resolved command or path, never on a substring of a label.
  Anything not positively matched is `other`. The default falls toward the alarming reading.
- **FR-6. The availability wording needs every unknown to be bot-chain.** The banner uses
  the "the agent cannot authenticate at all; the token broker is the likely cause" wording
  only when `user=0`, `unknown>0` and `unknown_bot_chain = unknown`. It names the broker
  (#2046) and the step to restore it.
- **FR-7. Any `other` unknown gets the founder-reachability wording.** When `user=0` and at
  least one unknown is `other`, the banner says a path that could hold a user credential
  could not be verified, and names the first one. When bot-chain unknowns are also present,
  it adds one clause giving their count. It must never use FR-6's wording. This reverses
  CS-3 for the `other` case.
- **FR-8. Name the first `[UNKNOWN]`, not the first non-clean line.** The banner picks out
  the first `[UNKNOWN]` line of the needed tag. It never names an `[info]`, `[note]` or
  `[NOT COVERED]` line (fixes CS-5).
- **FR-9. `user>0` keeps today's finding wording, and only the check decides it.** Nothing
  in FR-5 to FR-8 can soften a FAIL where a USER credential was observed. The banner
  decides which wording to use from the coverage line, not from verdict text. If the
  coverage line and the verdict disagree (for example, the verdict says PASS but `user>0`
  or `unknown>0`), the banner reports a damaged record (unknown, re-run). It never chooses
  the milder of the two readings.

### Coverage is widened, and the list stops failing open (issue items 3 and 4)

- **FR-10. Scan the harness config surface.** The at-rest scan adds the files the agent
  harness reads: `<repo>/.mcp.json`, `<repo>/.claude/settings.json`,
  `<repo>/.claude/settings.local.json` for every repo the check already enumerates, plus
  `~/.claude.json` and `~/.claude/settings*.json`. Each is examined for token-shaped
  strings (the existing `TOKEN_RE`) **and** for the JSON env-var shape
  (`"GH_TOKEN"|"GITHUB_TOKEN"|"GH_ENTERPRISE_TOKEN"|"GITHUB_PAT"` followed by a string
  value). Every candidate goes through the existing `classify()`.
- **FR-11. An unlisted file that holds a token is still classified.** A bounded sweep (the
  bounds are DQ-2) looks for `TOKEN_RE`-shaped strings in files **not** on the enumerated
  list. Each hit is classified exactly like a listed one: USER, clean, or UNKNOWN. A file
  the sweep cannot read is `[UNKNOWN]`, never skipped. The question becomes "is a token
  here, and whose is it?" rather than "is this a path I know?". After FR-11, CS-7's silent
  case can only arise outside the sweep's stated bounds.
- **FR-12. Print the sweep's own bounds.** The sweep's limits (roots, depth, size cap,
  pruned directories) appear as a `[NOT COVERED]` line and in `not_covered`. The remaining
  blind spot is then stated rather than implied. This is the part of item 3 that has no
  natural boundary (see the issue's stated cost), and FR-12 is how it stays visible.

### Constraints carried over unchanged

- **FR-13. No value is ever printed.** Every new output line goes through the existing
  `redact()`. A found credential is shown only as a 4-character prefix plus a sha256
  fingerprint (the check's existing "No values, ever" design note).
- **FR-14. No new network destination.** New candidates are sent only to the existing
  `classify()` call (`api.github.com/user`, which already exists). A string the sweep finds
  is sent there only when it matches `TOKEN_RE`, the GitHub token prefixes. A
  merely token-shaped string with no GitHub prefix is reported as `[UNKNOWN] unclassified
  shape` and never sent anywhere. This keeps the check's rule "never send a non-GitHub
  secret to GitHub".
- **FR-15. Fail-closed stays.** Every new path ends in USER, clean, absent, not-covered or
  UNKNOWN. A sweep that times out or aborts makes the `stores` section incomplete, so the
  verdict is FAIL (existing `COVER[]` mechanism). A partial sweep never counts as clean.

## Acceptance criteria

Each criterion needs a test that **fails before** the change and passes after it, with a
control that proves the test can pass. Bash tests go in the check's own suite
(`~/.claude/scripts/tests/identity-boundary-check.test.sh`). Banner tests go in
`packages/minspec/tests/session-identity.test.ts`.

- **AC-1 (FR-1, FR-2).** Seed a known fixture home. The check's `IDENTITY-COVERAGE` line has
  the expected `N`, the fields add up, and deleting one listed file moves it from `clean`
  to `absent` without changing `N`.
- **AC-2 (FR-3, FR-4).** The banner for a stub PASS record contains the surface count. A
  record with `not_covered=3` shows "3 not covered". A record without a coverage line does
  not render as a bare PASS. This replaces the exact-string assertion at
  `session-identity.test.ts:177`.
- **AC-3 (FR-5, FR-6).** Every unknown in a stub record is `bot-chain`, as in the
  2026-09-22 six-path shape. The banner uses the cannot-authenticate wording, names the
  broker, and does **not** contain "founder credential may be reachable".
- **AC-4 (FR-7). The regression this spec exists for.** A stub record has five `bot-chain`
  unknowns and one `other` unknown. The banner uses the founder-reachability wording, names
  the `other` path, and does **not** contain "AVAILABILITY failure". This fails on the
  current hook (CS-3).
- **AC-5 (FR-8).** A record whose first non-clean line is a `[note]` names the `[UNKNOWN]`
  line, not the note.
- **AC-6 (FR-9).** A record with a PASS verdict but `unknown=1` on its coverage line is
  reported as damaged or unknown, never as PASS.
- **AC-7 (FR-10).** Plant a test-shaped token (the shape only, never a real credential) as
  `"GH_TOKEN": "<value>"` in a fixture `.claude/settings.local.json`. The check classifies
  it. Against a stubbed `/user` that answers 200 it reports USER. An empty-file control
  passes.
- **AC-8 (FR-11, FR-12).** A planted token in an unlisted file inside the sweep bounds is
  classified, not dropped. The same token placed beyond the depth bound is not classified,
  and the `[NOT COVERED]` line states the bound it lies beyond.
- **AC-9 (FR-13, FR-14).** Across all fixtures, the full output contains no planted value.
  A planted non-GitHub-prefixed 40-character string produces no outbound request: the
  stubbed endpoint logs zero calls for it.
- **AC-10 (FR-15).** Force the sweep to time out. The verdict is FAIL with `stores` listed
  as incomplete.

## Invariants this change must not break

- **Invariant 2 (No silent gate).** This spec applies invariant 2 to the identity check
  itself. Today a credential on an unlisted path reads as PASS, and an `other` unknown
  reads as an outage. FR-9 and FR-15 make sure no new branch becomes a quiet pass. The
  coverage line is a second witness to the verdict line: FR-9 requires them to agree.
- **Invariant 3 (Blast radius).** None of this ships to adopters. The check stays in
  `~/.claude/scripts` on this machine. The banner is a dev-time hook in `scripts/hooks/`,
  outside any shipped template. No change may move either into `packages/` or into a
  harness template.
- **Invariant 1 (Offline core).** The MinSpec extension is untouched. The check's
  network use is unchanged in destination (FR-14), and it remains a machine tool the
  founder runs, not MinSpec core.
- **The check's own design notes** (header of `identity-boundary-check.sh`) stay true:
  location from kernel signals only, producers invoked in isolation, identity via
  `curl -q`, positive proof only, no values ever.

## Decisions needed (Clarify)

- **DQ-1. Where is the detector half tracked?** FR-1 to FR-3, FR-5 and FR-10 to FR-15
  change a file in `harvest316/claude-config`, not in this repo.
  - (a) **(rec)** This spec covers both halves. The detector work lands in claude-config
    with a commit trailer citing SPEC-212, and the banner work lands here. **Cost:** this
    repo's spec validators and hash lock cannot see the claude-config half, so its progress
    is checked by hand.
  - (b) This spec keeps FR-4 and FR-6 to FR-9 (the banner). A claude-config issue owns the
    detector. **Cost:** the banner depends on an output contract (FR-2) owned in another
    tracker, which is the same coupling as (a) with one more place to look.
  - (c) Move the check into this repo. **Cost:** this undoes a deliberate placement (the
    check is about the machine, not MinSpec). It also puts a credential-probing script
    one template edit away from shipping to adopters (invariant 3).
- **DQ-2. How big is the FR-11 sweep?**
  - (a) **(rec)** `$HOME` to depth 4. Prune `node_modules`, `.git` object stores, caches
    and `.cache`. Skip files over 1 MiB and binaries. Run inside the existing 300 s
    background budget. **Cost:** a token in a deeper or larger file stays outside the
    sweep. FR-12 states that limit instead of hiding it, but the gap still exists.
  - (b) All of `$HOME`, no depth cap. **Cost:** the run time is unbounded on a large home.
    A sweep that times out fails the run (FR-15), so the banner can stay FAIL for good,
    and an alarm that never clears stops being read.
  - (c) No sweep, only FR-10's list. **Cost:** the allowlist defect this issue names stays
    exactly as it is, one entry larger.
- **DQ-3. What does the banner do with an older check?** The check updates outside this
  repo, so a banner can meet a record from a check that predates FR-2.
  - (a) **(rec)** No coverage line means "coverage not reported". A PASS from such a record
    renders as unknown scope, not a bare PASS (FR-4). A FAIL keeps the founder wording
    (FR-7 by default). **Cost:** until the check is updated, every banner reads more
    alarming than today.
  - (b) Fall back to today's text-matching. **Cost:** it keeps CS-3's inverted wording for
    exactly the records most likely to be stale.
- **DQ-4. What happens to the founder's `.local` detector?** `.local/detect-agent-config-credentials.sh`
  covers the FR-10 surface by itself.
  - (a) **(rec)** Retire it once FR-10 lands and AC-7 passes. **Cost:** until then there
    are two predicates for the same surface, and duplicate predicates drift.
  - (b) Keep it as an independent second witness. **Cost:** it has no test suite and is
    not run on a schedule, so it is a witness only when someone remembers to run it.

## Rejected alternatives (DR-086 §4: recorded here because under 'act' nobody sees them live)

- **Make an unrecognised path `[UNKNOWN]` without classifying it** (the issue's item 4,
  taken literally). Rejected in favour of FR-11. "Unrecognised file" has no definition that
  is not another list. Every file that matches would stay UNKNOWN for good, so the check
  could never pass, and a check that never passes gets ignored. The check's own notes
  rejected UNKNOWN for other-uid environments for the same reason.
- **Infer bot-chain from the error text** ("broker unreachable" in stderr). Rejected:
  stderr can be steered and changes between versions. FR-5 matches the resolved producer
  instead.
- **Leave detection alone and do items 1 and 2 only** (the issue's minimum). Not rejected
  outright: FR-1 to FR-9 are that minimum and can ship first. But by itself it would
  report the blind spot honestly and leave it open, which is the cost the issue names.

## Follow-ups (tracked)

None beyond DQ-1. Outcome (b) of DQ-1 would require filing a claude-config issue at
Clarify time.
