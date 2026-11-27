#!/usr/bin/env bash
# apply.sh - install the #2036 fix into the operator's chief-of-staff script.
#
# The defect: `cos.py asked` and `cos.py waiting` decide whether a peer session is
# holding a question for the human by testing whether the arrow character (or
# "Your turn") appears ANYWHERE in its last turn. Since #1857 the arrow carries a
# routing marker - [act], [fyi], [human:<StopClass>] - and `cos.py nudge` already
# classifies each item through item_actor(). These two display paths did not, so a
# block of pure [fyi] still read as ASKING YOU, and `asked` printed an [act] item and
# a [human:...] item identically. The patch adds human_ask(), which classifies each
# item with the same item_actor() nudge uses and fails closed (anything the marker
# cannot vouch for is still an ask), and makes both commands read it.
#
# WHY THIS IS A PATCH AND NOT A COMMIT TO THE FILE: `cos.py` lives at
# ~/.claude/scripts/cos.py, outside this repository, and that directory is mounted
# READ-ONLY inside the agent container (`grep .claude/scripts /proc/self/mountinfo`).
# The agent that wrote the fix could read the file and could not write it. So the
# fix is staged here, verified against a copy, and applied by a human on the HOST.
# Same mechanism as the #2369 host patch.
#
# Run it on the host, from anywhere:
#
#     bash scripts/host-patches/2036-cos-asked-waiting-fyi/apply.sh
#
# What it does, in order, and it stops at the first step that fails:
#
#   1. CONTROL - runs the regression test against the installed cos.py. It must FAIL.
#      A pass means the behaviour is already there (applied before, or fixed another
#      way): nothing is changed and this exits 0.
#   2. Patches a COPY (never the live file) with --fuzz=0. If cos.py has moved since
#      the patch was cut and a hunk no longer matches exactly, this refuses rather
#      than guess where the hunk goes.
#   3. Runs the regression test against the patched copy. It must PASS.
#   4. Backs the live file up beside itself as `.cos.py.bak-2036-<epoch>` (the naming
#      the existing backups there use), then writes the patched content IN PLACE.
#   5. Installs the regression test next to the other cos.py tests.
#   6. Re-runs the test against the live file; restores the backup if it fails.
#
# It touches exactly two paths: the target cos.py (plus its backup) and
# tests/asked-waiting-fyi.test.py beside it. It makes no network call - the test
# fakes the session list and transcripts - and it runs only when a human invokes it.
#
# Override the target with COS_PY=/path/to/cos.py (used to rehearse on a copy).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${COS_PY:-$HOME/.claude/scripts/cos.py}"
PATCH="$HERE/cos.py.patch"
TEST="$HERE/asked-waiting-fyi.test.py"
# sha256 of the cos.py the patch was cut against (2026-11-20). Informational: a
# different file may still take the patch cleanly, and step 2 is what decides that.
BASE_SHA="3cb6c73454ac6b899e15714e2c0f2152321ba8daaa3ed912b0a1ab6dfb0764f4"

die() { echo "apply: $*" >&2; exit 1; }

command -v patch >/dev/null   || die "\`patch\` not found on PATH"
command -v python3 >/dev/null || die "\`python3\` not found on PATH"
[[ -f "$PATCH" && -f "$TEST" ]] || die "cos.py.patch / asked-waiting-fyi.test.py missing beside this script"
[[ -f "$TARGET" ]] || die "no cos.py at $TARGET (set COS_PY=/path/to/cos.py)"
[[ -w "$TARGET" && -w "$(dirname "$TARGET")" ]] \
  || die "$TARGET is not writable - inside the agent container it is a read-only mount; run this on the HOST"

# 1. CONTROL: the defect must be present, or there is nothing to fix.
if COS_PY="$TARGET" python3 "$TEST" >/dev/null 2>&1; then
  echo "apply: $TARGET already passes asked-waiting-fyi.test.py - already applied, nothing changed."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$TARGET" "$TMP/cos.py"

have_sha="$(sha256sum "$TARGET" | cut -d' ' -f1)"
if [[ "$have_sha" != "$BASE_SHA" ]]; then
  echo "apply: note - $TARGET differs from the build this patch was cut against;"
  echo "       continuing only if every hunk still matches exactly."
fi

# 2. Patch the COPY. --fuzz=0: a hunk whose context changed is a refusal, not a guess.
if ! patch --fuzz=0 --no-backup-if-mismatch "$TMP/cos.py" < "$PATCH" > "$TMP/patch.log" 2>&1; then
  cat "$TMP/patch.log" >&2
  die "the patch does not apply cleanly - cos.py has changed around a patched hunk. Nothing was changed; the patch needs re-cutting against the current file."
fi

# 3. The patched copy must pass before it goes anywhere near the live file.
COS_PY="$TMP/cos.py" python3 "$TEST" \
  || die "the patched copy FAILS its own regression test. Nothing was changed."

# 4. Back up, then write in place (same inode, mode and owner as before).
BACKUP="$(dirname "$TARGET")/.cos.py.bak-2036-$(date +%s)"
cp -p "$TARGET" "$BACKUP"
cat "$TMP/cos.py" > "$TARGET"

# 5. The test lives with the other cos.py tests from here on.
TESTS_DIR="$(dirname "$TARGET")/tests"
mkdir -p "$TESTS_DIR"
cp "$TEST" "$TESTS_DIR/asked-waiting-fyi.test.py"

# 6. Prove the LIVE file, not the copy.
if ! COS_PY="$TARGET" python3 "$TESTS_DIR/asked-waiting-fyi.test.py"; then
  cat "$BACKUP" > "$TARGET"
  die "the installed file failed the regression test - restored from $BACKUP"
fi

echo "apply: installed. backup: $BACKUP"
echo "apply: sha256 $(sha256sum "$TARGET" | cut -d' ' -f1)"
