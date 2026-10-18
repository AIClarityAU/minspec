---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the gh-bot attribution gate (DR-082) is a trust gate, and DR-066 "no silent gate" is this epic's rule
aspects: [ci, gates, no-silent-gate, gh-bot, attribution, fail-closed, offline, tier-0]
depends_on: [DR-066, DR-082]  # DR-066 clause 1 and 2 are the rule this applies; DR-082 defines the gate being hardened
relates_to: [SPEC-054, "#1978", "#1994", "#1355", "#1411", "#1413", "#1855", "#1859"]
# Ownership declared in Specify (SPEC-038). Both files already exist and are not owned
# by any spec; this defect spec modifies them and does not take ownership, so it does
# not freeze the gate against other changes.
implements: none
implements_reason: >-
  Every change lands in two existing files: the gate script and its test suite. A defect
  spec owning a shared CI gate would freeze it for every unrelated change to the gate.
affects: [scripts/check-gh-bot-attribution.sh, scripts/check-gh-bot-attribution.test.js]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - gh-bot attribution gate: input the gate could not read must fail closed (Requirements)

> Materializes the remaining scope of
> **[#1978](https://github.com/AIClarityAU/minspec/issues/1978)** ("an unreadable .sh passes
> the gh-bot attribution gate silently"). Rests on
> [DR-066](../../../docs/decisions/DR-066.md) (no silent gate) and
> [DR-082](../../../docs/decisions/DR-082.md) (agent GitHub writes take a bot identity, and
> a CI guard enforces it).

## In plain terms

`scripts/check-gh-bot-attribution.sh` is the CI gate that fails the build when a shell script
writes to GitHub without first taking the bot's identity. If such a script slips through, every
issue, comment or merge it makes is recorded as the founder's.

The gate decides "this file has no GitHub writes" from an empty search result. An empty
result is also what you get when the gate **could not read** the file. #1994 fixed the case of
one unreadable *file*. This spec closes the rest of the same defect: input the gate never got
to read must make it fail visibly, never print `OK`.

## Context

### What already landed

- **#1994** (`b8225125`, merged 2026-09-22) added a readability check at the top of the
  per-file loop (`scripts/check-gh-bot-attribution.sh:139-153`). A `chmod 000` `.sh` file now
  fails the gate. A regression test drives the real script
  (`scripts/check-gh-bot-attribution.test.js:51`).
- The same commit **retracted** the issue body's original seven sites (in `egress-scan.sh`,
  `check-supply-chain.sh` and `dispatch-issue.sh`), plus an eighth. Each was re-marked
  `swallow-ok` with a stated reason, because what the code does after the empty value is safe
  (for example `scripts/egress-scan.sh:159` blocks unreadable input before the grep runs).
  That explains the issue title's "8 originally filed here were retracted". I believe (inferred from the title, not stated anywhere I could read offline) that the "4 real sites"
  are the four `|| true` captures in this gate (`:158`, `:171`, `:177`, `:178-180`).
  **This spec does not reopen the retracted sites** (see DQ-3). I did not re-trace them in
  this pass. That they are safe is #1994's claim, not my observation.

### What is still open: verified

**An unreadable subdirectory makes the gate pass.** I observed this on this checkout
(`2c296e3e`), running as uid 1000:

```
scripts/sub/offender.sh  (bare `gh issue comment`, no gh-bot.sh)  -> FAIL, exit 1   (control)
chmod 000 scripts/sub                                             -> find: 'scripts/sub': Permission denied
                                                                     check-gh-bot-attribution: OK - 0 file(s) ...  exit 0
```

**How it happens:** the file list comes from `find "$SCAN_DIR" -type f -name '*.sh' | sort`
inside a process substitution (`:230`). Bash ignores the exit status of a process
substitution, even under `set -euo pipefail`, so the `find` error reaches nothing but stderr.
The files under that directory are never listed, so the per-file `-r` check from #1994 never
runs for them.

**The gate that should have rejected it:** nothing checks that the list is complete. The
gate's only defence is a per-file check, and it covers only files that made it onto the list.

### What is still open: inferred, not observed

**Read errors after the check.** Every hit-list capture still turns grep's exit 2 (read error)
into an empty string with `2>/dev/null ... || true`. The `-r` check runs *before* the reads,
so a file that becomes unreadable, or hits an I/O error, between the check and the grep would
read as clean. I believe this is real but did not reproduce it: the window is narrow and I
built no harness for it. Today the `-r` check is the only thing guarding this path, and DR-066
clause 2 says a missing or errored witness must fail closed. The read itself is that witness,
and its error is currently thrown away.

**Exit codes from ugrep.** CI runs GNU grep, where exit 2 means an error (`grep(1)`). This
container's `grep` is ugrep (see the comment at `:125-127`). I believe ugrep also uses exit 2
for errors, unverified. The tests must run under CI's GNU grep (FR-6).

## Terms

- **Listing**: getting the set of `*.sh` paths under `scripts/` to scan.
- **Read**: any `grep`/`awk` call on a listed file whose result decides pass or fail.
- **No match**: grep exit 1 with no output. A real answer: the file holds no matching line.
- **Read error**: grep exit 2 or higher, or any `awk` exit other than 0. No answer about the
  file at all.

## Requirements

### A. The listing must be complete or the gate fails

- **FR-1** If the listing reports any error, the gate exits non-zero and does not print its
  `OK` line. Errors include an unreadable or untraversable directory and an entry that
  vanishes mid-walk. Detection must rest on the listing command's own exit status or error
  stream, **not** on a separate permission pre-scan, because a pre-scan has the same
  check-then-use gap as FR-2.
- **FR-2** The failure message names the gate, says it **could not list** input, prints the
  path the lister reported, and says the gate is failing closed. It must be clearly different
  from the "writes as the human" FAIL text, so whoever reads it fixes permissions, not
  attribution.

### B. Every read separates "no match" from "read error"

- **FR-3** Each read whose empty result can lead to "no violation" must keep the first
  command's exit status apart from the empty-output case. A read error fails the gate closed
  for that file with the FR-2-style "cannot read" message. Exit 1 / no match keeps today's
  behaviour. This covers the captures at `:158`, `:171` and `:178-180`. In each one the
  `grep -v` comment filter and `|| true` currently hide the first `grep`'s status.
- **FR-4** The `-r` check from #1994 stays as the first, clearest message. It is no longer the
  only witness: FR-3 is the second, so a failure between check and read still fails closed
  (DR-066 clause 2).
- **FR-5** The `has_source` / `has_init` reads (`:209-214`) already fail in the safe
  direction: a read error leaves the flag at 0 and the file FAILs. Tests must pin this
  (AC-5), so a later refactor such as `|| has_source=1` or an inverted test cannot quietly
  flip it.

### C. Tests and annotations

- **FR-6** Every new case runs the **real script on real files**, as the existing suite does
  (`check-gh-bot-attribution.test.js:5-11`). Each asserts the exit code **and** the message.
  When the premise cannot be set up (running as root ignores permission bits), the case
  prints a loud SKIP, as the #1978 case does, and must not pass vacuously.
- **FR-7** The read-error path (FR-3) is tested by forcing a read error, not by reasoning.
  For example, a `grep` stand-in earlier on `PATH` that exits 2 for the target file and calls
  the real grep otherwise. The Plan phase picks the mechanism. A test that only checks the
  script's source text for an exit-status check is **not** enough (memory: tests can pass
  vacuously).
- **FR-8** Each `# swallow-ok:` comment in this file currently justifies itself by "the
  unreadable case is blocked by the -r guard at the top of this loop". Update each one to give
  the true reason after the change, or delete it if the `|| true` goes away. The
  `swallowed-gate-signal` lint (SPEC-054, `scripts/lib/swallowed-gate-signal.ts`) must still
  pass on the file.
- **FR-9** The `OK` line also reports how many `.sh` files were **scanned**, alongside today's
  count of files with writes. Without it, a scan that saw nothing looks the same as a scan
  that saw everything. Whether zero scanned should fail is DQ-1.

## Acceptance criteria

- **AC-1** A fixture holding `scripts/sub/offender.sh` (a bare write) with `scripts/sub` set to
  `chmod 000` makes the gate exit 1. Output names `scripts/sub` and says it could not list and
  is failing closed. It does not print `OK`. The case is RED against `2c296e3e`'s script (the
  observation above) and GREEN after.
- **AC-2** The same fixture with `scripts/sub` readable still fails for the attribution
  reason. This is the control: it shows AC-1's failure comes from the listing, not from an
  unrelated break.
- **AC-3** A fixture with a **compliant** file inside an unreadable directory also exits 1.
  The gate must not reason "nothing I could see was bad".
- **AC-4** With a forced read error (FR-7) on a file holding a bare write, the gate exits 1
  with the "cannot read" message. With the same forced error on a file holding **no** writes,
  the gate also exits 1, because a read error is never "no writes".
- **AC-5** With a forced read error on the `has_source` read only, a file that otherwise
  sources and arms gh-bot.sh still FAILs (FR-5).
- **AC-6** Every existing case in `check-gh-bot-attribution.test.js` passes unchanged, and so
  does `npm run check:gh-bot` on the real repository.
- **AC-7** The new cases pass in CI's `lint` job, which uses GNU grep
  (`.github/workflows/ci.yml:121-124`), not only locally.
- **AC-8** The swallow lint reports no new unannotated site in this file, and no annotation
  still cites the `-r` check as its only reason (FR-8).

## Invariants this change must not break

- **INV-1 Read-only.** The gate still writes nothing (`:6`).
- **INV-2 Offline** (constitution invariant 1). No network calls are added.
- **INV-3 No new false PASS.** Every change moves an outcome from pass to fail, never the
  other way. Exception: none.
- **INV-4 One write vocabulary.** The patterns are still read from `lib/gh-bot.sh`
  (`:94-100`) and never restated here (#1411).
- **INV-5 Waiver semantics.** The allowlist, and the rule that waived files are always
  printed, stay unchanged. "Could not read" is never a waiver and never appears in the
  `skipped` list (the reasoning at `:146-148`).
- **INV-6 Portability.** The gate behaves the same under GNU grep (CI) and the local grep.
  No `\n`-in-bracket-style dialect traps (`:117-127`).
- **INV-7 Blast radius** (constitution invariant 3). This is a dev-time repo script. Nothing
  here ships to adopters.

## Out of scope

- The seven sites in the issue body and the eighth in #1994's commit message: retracted in
  #1994 and annotated `swallow-ok`. Reopening any of them needs its own issue (DQ-3).
- The drain's `swallow-known: #1855` sites (`scripts/drain-inbox.sh:1060`, `:1141`), tracked
  at #1855.
- The gate's own deliberate limits (it reads text rather than understanding it, and the
  `bash -c` bypass), which the header at `:31-53` already states.

## Decisions needed (Clarify)

### DQ-1 - Should a scan that found zero `.sh` files fail?

Today `scripts/` holds 51 `.sh` files (`find scripts -type f -name '*.sh' | wc -l` at
`2c296e3e`). A run that lists none means the gate looked at nothing.

- **(a) Fail when zero files are scanned (rec).** It catches a whole class of "looked at
  nothing" failures that FR-1 might miss (wrong `ROOT` argument, an empty mount). **Cost:** a
  temporary test tree with no `.sh` file now fails. No existing case builds one (every
  `runGuard` call passes at least one file), but future tests need to know.
- **(b) Report the count only (FR-9) and still pass.** **Cost:** an empty scan stays a green
  run that only a reader of the log would notice, which is the visible-but-not-failing shape
  DR-066 was written against (#857).

### DQ-2 - Symlinked `.sh` files

`find -type f` does not list symlinks, so a `scripts/foo.sh` that links elsewhere is never
scanned. There are none today (`find scripts -type l` returned nothing at `2c296e3e`). This is
a coverage gap, not a read error, so it sits next to this spec's scope rather than inside it.

- **(a) Fail on any `*.sh` symlink under `scripts/` unless it is allowlisted with a reason
  (rec).** It is simple, follows no links, and cannot loop or read outside the repo. **Cost:**
  one more FAIL message to explain, and anyone who wants a symlinked script must add an
  allowlist line.
- **(b) Follow the links (`find -L`) and scan the target.** **Cost:** the gate can then read
  outside the repo and must handle link loops, which brings new error paths of the kind this
  spec is closing.
- **(c) Leave it out and state it in the header as a known limit.** **Cost:** the follow-up
  must be filed as an issue before this spec is approved (no prose-only follow-ups), and until
  then the gap is silent.

### DQ-3 - Keep #1978 to the gh-bot gate

The issue body still describes seven sites outside this gate, while its title says they were
retracted.

- **(a) Specify only the gh-bot gate's remaining holes, as written (rec).** #1994 gave each
  retraction a reason in a comment that a reviewer can check. **Cost:** if any retraction was
  wrong, this spec does not catch it. This pass did not re-trace them.
- **(b) Add a re-audit of the eight retracted sites to this spec.** **Cost:** it brings three
  unrelated scripts into a T3 spec about one gate, which is the same split the issue body
  made for #1855 ("the fixes are unrelated").

## Traceability

- Issue: #1978. Earlier fix: #1994 (`b8225125`). Lint that found the class: #1859 / #1980
  (SPEC-054).
- Rule: DR-066 clauses 1 and 2. Gate: DR-082 (#1355, #1411, #1413).
- No new DR: every choice here can be undone in under a day (the parent register's ADR filter).
