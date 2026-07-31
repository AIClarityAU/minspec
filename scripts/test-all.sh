#!/usr/bin/env bash
#
# test-all.sh — run every automated test suite across the three repos that make up
# the minspecpro.code-workspace multi-root workspace, and print one summary.
#
# WHY THIS EXISTS
#   The three repos use four different test runners (Vitest, node:test, Python
#   unittest, and mocha-in-a-spawned-VS-Code-host). VS Code's Testing panel shows
#   them via three separate controller extensions, which is fine interactively but
#   gives no single headless "did everything pass" answer. This is that answer.
#
#   The Testing panel remains the way to run these interactively — its own
#   "Run All Tests" already fans out across every controller in every folder. This
#   script is the terminal/CI-shaped equivalent.
#
# SIBLING REPOS ARE OPTIONAL
#   scroogellm and sealbox are separate repositories that may not be checked out.
#   Each is skipped with a visible SKIP row rather than failing the run, so this
#   stays useful for someone who cloned only MinSpec.
#
# USAGE
#   scripts/test-all.sh                 # every suite that runs headlessly
#   scripts/test-all.sh --coverage      # ... and collect Vitest coverage
#   scripts/test-all.sh --e2e           # ... and include the extension-host suite
#   scripts/test-all.sh --list          # show what would run, run nothing
#
# EXIT CODE
#   0 only if every suite that ran passed. Skipped suites do not fail the run, but
#   they are always printed — a silently-absent suite would make a green result lie.

# Deliberately NOT `set -e`: a failing suite must not abort the others. The whole
# point is to see every result in one pass. Failures are collected and re-reported.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MINSPEC_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd -- "$MINSPEC_ROOT/.." && pwd)"
SCROOGE_ROOT="$WORKSPACE_ROOT/scroogellm"
SEALBOX_ROOT="$WORKSPACE_ROOT/sealbox"

WITH_COVERAGE=0
WITH_E2E=0
LIST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --coverage) WITH_COVERAGE=1 ;;
    --e2e)      WITH_E2E=1 ;;
    --list)     LIST_ONLY=1 ;;
    -h|--help)  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          printf 'unknown option: %s (try --help)\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

# Parallel arrays: one entry per suite, appended by run_suite.
SUITE_NAMES=()
SUITE_STATUS=()
SUITE_DETAIL=()

bold=$(tput bold 2>/dev/null || printf '')
dim=$(tput dim 2>/dev/null || printf '')
red=$(tput setaf 1 2>/dev/null || printf '')
green=$(tput setaf 2 2>/dev/null || printf '')
yellow=$(tput setaf 3 2>/dev/null || printf '')
reset=$(tput sgr0 2>/dev/null || printf '')

note() { printf '%s==>%s %s\n' "$bold" "$reset" "$1"; }

record() {
  SUITE_NAMES+=("$1")
  SUITE_STATUS+=("$2")
  SUITE_DETAIL+=("$3")
}

# Summarise a runner's stdout into a short "42 passed" / "2 failed, 40 passed" string.
# Each runner reports differently, so the parse is per-kind rather than one regex.
summarise() {
  local kind="$1" log="$2"
  case "$kind" in
    node)
      local pass fail
      pass=$(grep -m1 '^# pass ' "$log" | awk '{print $3}')
      fail=$(grep -m1 '^# fail ' "$log" | awk '{print $3}')
      [ -n "${pass:-}" ] || { printf 'no TAP summary — see log'; return; }
      if [ "${fail:-0}" != "0" ]; then printf '%s failed, %s passed' "$fail" "$pass"
      else printf '%s passed' "$pass"; fi
      ;;
    vitest)
      grep -m1 -E '^\s+Tests\s+' "$log" | sed -E 's/^\s+Tests\s+//; s/\s+$//' \
        || printf 'no summary line — see log'
      ;;
    python)
      local ran
      ran=$(grep -m1 -E '^Ran [0-9]+ test' "$log" | awk '{print $2}')
      if grep -qE '^OK' "$log"; then printf '%s passed' "${ran:-?}"
      else printf '%s ran, FAILED — see log' "${ran:-?}"; fi
      ;;
    *) printf 'see log' ;;
  esac
}

# run_suite <display-name> <summary-kind> <working-dir> <command...>
run_suite() {
  local name="$1" kind="$2" dir="$3"; shift 3

  if [ ! -d "$dir" ]; then
    record "$name" SKIP "directory not present: $dir"
    return
  fi

  if [ "$LIST_ONLY" -eq 1 ]; then
    record "$name" LIST "$dir \$ $*"
    return
  fi

  local log="$LOG_DIR/$(printf '%s' "$name" | tr -c 'A-Za-z0-9' '_').log"
  note "$name"
  # Subshell so a failed `cd` can never leak into the next suite's working
  # directory — a chained cd that silently fails is how a scoped command ends up
  # running against the wrong repo.
  ( cd "$dir" && "$@" ) >"$log" 2>&1
  local rc=$?
  tail -n 5 "$log" | sed "s/^/${dim}  │ ${reset}/"

  if [ $rc -eq 0 ]; then
    record "$name" PASS "$(summarise "$kind" "$log")"
  else
    record "$name" FAIL "$(summarise "$kind" "$log")"
    # LOG_DIR is removed by the EXIT trap, so a failing suite's log is copied out to
    # survive the run. Via mktemp, not a name derived from the suite: a predictable
    # path in a world-writable /tmp is a symlink-clobber target on a shared host.
    local kept
    kept=$(mktemp "${TMPDIR:-/tmp}/minspec-test-XXXXXXXX.log" 2>/dev/null) || kept=""
    if [ -n "$kept" ] && cp "$log" "$kept" 2>/dev/null; then
      printf '%s  full log: %s%s\n' "$dim" "$kept" "$reset"
    fi
  fi
}

# ---------------------------------------------------------------------------
# MinSpec (AIClarityAU/minspec)
# ---------------------------------------------------------------------------
if [ "$WITH_COVERAGE" -eq 1 ]; then
  # Coverage thresholds come from .minspec/config.json (coverage.minimumPercentage),
  # read by vitest.config.ts — NOT from a VS Code setting, so a headless run and the
  # Testing panel's coverage profile gate on the same number.
  run_suite "MinSpec · Vitest (+coverage)" vitest "$MINSPEC_ROOT" npx vitest run --coverage
else
  run_suite "MinSpec · Vitest" vitest "$MINSPEC_ROOT" npx vitest run
fi

run_suite "MinSpec · Python hooks" python "$MINSPEC_ROOT" \
  python3 -m unittest discover -s scripts/hooks -p 'test_*.py'

# A SECOND Python suite, in a different tree. `unittest discover` takes exactly one
# start directory and VS Code's Python controller is configured with `-s scripts/hooks`,
# so these 14 cases are invisible to the Testing panel AND were running nowhere at all —
# no workflow, no npm script, no githook. They cannot simply be moved next to the others:
# the file binds session-title.py and session-title.sh via os.path.dirname(__file__), so
# relocating it breaks every case. Running it as its own suite is the honest fix; panel
# parity is a separate problem.
run_suite "MinSpec · Python session-title hook" python "$MINSPEC_ROOT" \
  python3 -m unittest discover -s .claude/hooks -p 'test_*.py'

# Not a test suite — a gate on the Testing panel itself. scripts/test-all.sh invokes
# node --test with explicit shell globs, so it stays GREEN in exactly the state where
# the panel shows nothing. This replays the extension's own glob algorithm and fails
# when a suite we claim is visible would not actually appear.
run_suite "MinSpec · Testing-panel discovery" other "$MINSPEC_ROOT" \
  node scripts/check-testing-panel-discovery.mjs

# `node --test <dir>` does NOT search a directory — Node 22 resolves the argument as
# a module and dies with MODULE_NOT_FOUND. Directory search happens only when there
# are no positional arguments. Hence the explicit glob here, and the bare
# `node --test` (no args) used for tee-proxy below.
run_suite "MinSpec · node:test (ai-review guard)" node "$MINSPEC_ROOT" \
  bash -c 'node --test .github/scripts/*.test.js'

if [ "$WITH_E2E" -eq 1 ]; then
  # Downloads and spawns a real VS Code, so it needs a display (or xvfb-run) and a
  # network fetch on first use. Opt-in for that reason, not because it is optional
  # to correctness — CI runs it. This is also the suite the Testing panel cannot
  # show on VSCodium: its controller, ms-vscode.extension-test-runner, is
  # Marketplace-only and absent from Open VSX.
  run_suite "MinSpec · extension host (mocha e2e)" other "$MINSPEC_ROOT" \
    npm run test:e2e --workspace=minspec
fi

# ---------------------------------------------------------------------------
# Scrooge (AIClarityAU/scroogellm)
# ---------------------------------------------------------------------------
run_suite "Scrooge · node:test (ai-review guard)" node "$SCROOGE_ROOT" \
  bash -c 'node --test .github/scripts/*.test.js'

# Bare `node --test` from the package root: no positional args, so Node walks the
# tree with its default patterns and finds tests/*.test.mjs.
run_suite "Scrooge · node:test (tee-proxy)" node "$SCROOGE_ROOT/dogfood/tee-proxy" \
  node --test

# ---------------------------------------------------------------------------
# SealBox (AIClarityAU/sealbox)
# ---------------------------------------------------------------------------
run_suite "SealBox · node:test (ai-review guard)" node "$SEALBOX_ROOT" \
  bash -c 'node --test .github/scripts/*.test.js'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n%s%s%s\n' "$bold" "──────────────────────────────────────────────────────────────" "$reset"
printf '%sTest summary — 3 repos%s\n\n' "$bold" "$reset"

failed=0
skipped=0
for i in "${!SUITE_NAMES[@]}"; do
  status="${SUITE_STATUS[$i]}"
  case "$status" in
    PASS) colour="$green"; mark="PASS" ;;
    FAIL) colour="$red";   mark="FAIL"; failed=$((failed + 1)) ;;
    SKIP) colour="$yellow"; mark="SKIP"; skipped=$((skipped + 1)) ;;
    *)    colour="$dim";   mark="$status" ;;
  esac
  printf '  %s%-4s%s  %-38s %s%s%s\n' \
    "$colour" "$mark" "$reset" "${SUITE_NAMES[$i]}" "$dim" "${SUITE_DETAIL[$i]}" "$reset"
done

printf '\n'
if [ "$LIST_ONLY" -eq 1 ]; then
  exit 0
fi

if [ "$skipped" -gt 0 ]; then
  printf '  %s%s suite(s) skipped — a sibling repo is not checked out.%s\n' \
    "$yellow" "$skipped" "$reset"
fi

if [ "$failed" -gt 0 ]; then
  printf '  %s%s suite(s) FAILED.%s\n' "$red" "$failed" "$reset"
  printf '  %sIf this box is under load, re-run idle before diagnosing — this repo has a\n' "$dim"
  printf '  known false-red-under-load pattern (dozens of spurious failures busy, zero idle).%s\n' "$reset"
  exit 1
fi

printf '  %sAll suites passed.%s\n' "$green" "$reset"
