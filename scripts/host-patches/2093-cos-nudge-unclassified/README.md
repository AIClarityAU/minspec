# Host patch: `cos.py nudge` silently dropped sessions it could not classify (#2093)

**Status: staged, NOT applied.** Nothing in this directory runs on its own, and the fix is
not live until a human runs `apply.sh` on the host. Delete this directory once it has been
applied - a staged patch left behind reads as still-pending work.

## Why this is a patch

The file being fixed is `~/.claude/scripts/cos.py`, the operator's chief-of-staff script. It
is not part of this repository, and that path is read-only to the dispatched agent, so the
agent could read it and could not write it. The fix was made on a copy, verified there, and
staged here for a host-side apply - the same route the #2369 open-PR-cap fix took.

## Apply (on the host)

    bash scripts/host-patches/2093-cos-nudge-unclassified/apply.sh

The script's header lists each step. In short: it checks the defect is present, patches a
copy with no fuzz, tests the copy, backs up the live file, installs, and re-tests the live
file - restoring the backup if that last test fails. To rehearse without touching the real
file: `COS_PY=/tmp/cos-copy.py bash .../apply.sh`.

If `cos.py` has changed around a patched hunk since 2026-11-20 (base sha256 `3cb6c734...`)
the script refuses and changes nothing. The patch then needs re-cutting against the current
file; do not force an older copy of it.

## Root cause

`last_assistant_text` returns `""` for three different situations - the last
conversational record is a USER record (a tool result: the session is wedged mid-tool-call),
the transcript has nothing readable, or the last assistant turn was only a tool call - and
`cmd_nudge` skipped every one of them with `if not txt: continue`. Such a session was listed
in neither DUE nor HELD, and a run made only of them printed `no parked sessions`. No gate
told "nothing to classify" apart from "something I could not classify".

The same `""` reached `nudge --mark`, which hashed it without complaint and wrote
`da39a3ee5e6b` (the SHA-1 of the empty string) into `.cos-state.json`'s `nudged` ledger -
the fingerprint the issue found on 8 of 16 entries.

## What the patch changes

- **`last_turn(path)`** returns `(kind, text)` with kind `assistant`, `user` or `none`, so a
  caller can say WHY there is no text. `last_assistant_text` is now a one-line wrapper over
  it and returns exactly what it did before, so its other callers are unchanged.
- **`nudge_text(row)`** returns `(text, why)` for one session; `why` is set only when the
  session cannot be classified (no transcript, nothing readable, last record is a USER
  record, or an assistant turn with no text).
- **`cmd_nudge` has a third bucket.** Each such idle session prints as
  `UNCLASS <name> idle <age> <reason>`, followed by an `UNCLASSIFIED: N idle session(s) ...`
  count. `no parked sessions` is printed only when DUE, HELD and UNCLASS are all empty; when
  only UNCLASS has entries the closing line says so and that it is NOT "nothing to do".
- **`nudge --mark` refuses an unclassifiable session** instead of recording the empty-string
  hash, prints the reason, and counts it as not marked (non-zero exit, as for any other
  failed mark). `nudge --mark-due` uses the same classifier, so it also never marks one.

## Not changed

- The exit status of a plain `cos.py nudge` stays 0 when sessions are unclassified. The
  issue asks for a visible bucket and count; a non-zero exit would change what every caller
  of `nudge` reads as a tool failure, and no caller was in scope to audit.
- Idle sessions sitting on a quota wall (`LIMIT_RE`) are still left out of `nudge` on
  purpose - they are reported as `stuck` elsewhere. Unchanged.

## Verification done before staging

Run against a copy of `cos.py` (sha256 `3cb6c734...`, as read 2026-11-20):

- `nudge-unclassified.test.py` fails on the unpatched file (11 of 15 checks, including the
  `--mark` check that reproduces the `da39a3ee5e6b` ledger entry) and passes on the patched
  one.
- Five mutants of the patched file each fail the test: the UNCLASS bucket reverted to a
  silent skip; `no parked sessions` gated on DUE and HELD only; `--mark` hashing `""` again;
  a USER last record reported as "nothing readable"; `--mark-due` not excluding
  unclassified sessions.
- `apply.sh` rehearsed on copies: a fresh copy installs byte-identical to the verified
  build; a second run reports already-applied and changes nothing; a copy with one edited
  context line is refused and left untouched.
- The sixteen existing `tests/*.test.py` give the same result patched and unpatched. Three
  of them (`cos-runner-junk`, `mergeable-neutral`, `quota-no5h`) already fail on the
  unpatched file in the agent container - not caused by this patch and not fixed by it.
