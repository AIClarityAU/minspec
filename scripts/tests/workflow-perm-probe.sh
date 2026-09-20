#!/usr/bin/env bash
# Drive the REAL pre-push hook in a temp repo, exercising the #1120 capability probe.
# Derive the repo root from THIS script's location — never a hardcoded absolute path.
# The first version pinned one developer's worktree, so on CI or any other checkout the
# hook did not exist, every probe errored, and the "step aside" case failed: a committed
# test with zero portable coverage. Caught by review on #1460, not by running it.
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SELF_DIR" && git rev-parse --show-toplevel)
HOOK="$REPO_ROOT/.githooks/pre-push"
[ -f "$HOOK" ] || { echo "cannot find pre-push hook at $HOOK" >&2; exit 1; }
ZERO=$(printf '0%.0s' {1..40})
pass=0; fail=0

setup() {
  R=$(mktemp -d)
  git -C "$R" init -q -b main
  git -C "$R" config user.email t@t; git -C "$R" config user.name T
  mkdir -p "$R/.github/workflows"; echo 'name: CI' > "$R/.github/workflows/ci.yml"
  echo x > "$R/README.md"
  git -C "$R" add -A; git -C "$R" commit -qm base
  git -C "$R" update-ref refs/remotes/origin/main HEAD
  git -C "$R" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  git -C "$R" switch -q -c feature
  echo 'name: CI2' > "$R/.github/workflows/ci.yml"     # a REAL workflow change
  git -C "$R" add -A; git -C "$R" commit -qm "edit workflow"
  SHA=$(git -C "$R" rev-parse HEAD)
}

probe() {
  local desc="$1" expect="$2"; shift 2
  local out rc got
  out=$(echo "refs/heads/feature $SHA refs/heads/feature $ZERO" \
        | (cd "$R" && env "$@" MINSPEC_FAKE_APP_CRED=1 MINSPEC_ALLOW_WORKFLOW_PUSH=0 \
          bash "$HOOK" origin https://github.com/o/r.git 2>&1))
  rc=$?
  got=allow; [ $rc -ne 0 ] && got=BLOCK
  if [ "$got" = "$expect" ]; then printf '  ok   %-54s -> %s\n' "$desc" "$got"; pass=$((pass+1))
  else printf '  FAIL %-54s -> %s (wanted %s)\n' "$desc" "$got" "$expect"; fail=$((fail+1))
       printf '%s\n' "$out" | head -3 | sed 's/^/         /'; fi
  rm -rf "$R"
}

echo "--- probe says workflows=write ⇒ step aside ---"
# STUBBED, deliberately. This case used to invoke the REAL host token script and
# assert `allow`, which made it a test of the environment's current grant rather
# than of this code path: it passed only while the installation happened to hold
# `workflows: write`, and went red the moment that changed — silently, because no
# CI job or npm script runs this suite. Stub the affirmative answer so the case
# proves what it claims: given a permissions object containing workflows=write,
# the gate steps aside.
GRANTED=$(mktemp); printf '#!/usr/bin/env bash\necho "contents=write"\necho "workflows=write"\n' > "$GRANTED"; chmod +x "$GRANTED"
setup; probe "probe reports workflows=write"           allow \
  MINSPEC_APP_TOKEN_SCRIPT="$GRANTED" MINSPEC_PERM_TTL=0
rm -f "$GRANTED"

echo "--- probe cannot answer ⇒ fail CLOSED ---"
setup; probe "token script missing"                    BLOCK \
  MINSPEC_APP_TOKEN_SCRIPT=/nonexistent/nope MINSPEC_PERM_TTL=0
setup; probe "token script errors"                     BLOCK \
  MINSPEC_APP_TOKEN_SCRIPT=/bin/false MINSPEC_PERM_TTL=0
setup; probe "probe explicitly disabled"               BLOCK \
  MINSPEC_WORKFLOW_PERM_PROBE=0

echo "--- probe says permission ABSENT ⇒ still blocks ---"
FAKE=$(mktemp); printf '#!/usr/bin/env bash\necho "contents=write"\necho "metadata=read"\n' > "$FAKE"; chmod +x "$FAKE"
setup; probe "installation lacks workflows"            BLOCK \
  MINSPEC_APP_TOKEN_SCRIPT="$FAKE" MINSPEC_PERM_TTL=0
rm -f "$FAKE"

# ── an INDETERMINATE probe must not be cached as a measurement (#1120) ────────
# Every case above asserts only allow/BLOCK, and both a real "workflows absent"
# answer and a probe that cannot answer BLOCK. So allow/BLOCK cannot tell them
# apart, and the difference is load-bearing: a determinate answer is cached for
# MINSPEC_PERM_TTL, an indeterminate one must not be — otherwise a repaired token
# script is disbelieved for up to the TTL, and the cache records a measurement
# that was never taken. The discriminator is the CACHE FILE, so assert on it.
cache_case() {
  local desc="$1" want="$2" script="$3"
  setup
  echo "refs/heads/feature $SHA refs/heads/feature $ZERO" \
    | (cd "$R" && env MINSPEC_FAKE_APP_CRED=1 MINSPEC_ALLOW_WORKFLOW_PUSH=0 \
        MINSPEC_APP_TOKEN_SCRIPT="$script" MINSPEC_PERM_TTL=86400 \
        bash "$HOOK" origin https://github.com/o/r.git >/dev/null 2>&1)
  local f got
  f="$R/$(git -C "$R" rev-parse --git-dir)/minspec-workflows-perm"
  if [ -e "$f" ]; then got="cached:$(cut -d' ' -f2 <"$f")"; else got="uncached"; fi
  if [ "$got" = "$want" ]; then printf '  ok   %-54s -> %s\n' "$desc" "$got"; pass=$((pass+1))
  else printf '  FAIL %-54s -> %s (wanted %s)\n' "$desc" "$got" "$want"; fail=$((fail+1)); fi
  rm -rf "$R"
}

echo "--- indeterminate vs answered: only an ANSWER may be cached ---"
REAL=$(mktemp); printf '#!/usr/bin/env bash\necho "contents=write"\necho "metadata=read"\n' > "$REAL"; chmod +x "$REAL"
NOTPERMS=$(mktemp); printf '#!/usr/bin/env bash\necho "repositories: 6"\n' > "$NOTPERMS"; chmod +x "$NOTPERMS"
EMPTY=$(mktemp); printf '#!/usr/bin/env bash\nexit 0\n' > "$EMPTY"; chmod +x "$EMPTY"
cache_case "a real permissions object, workflows absent" "cached:none" "$REAL"
cache_case "NOT a permissions object (host-brokered flag)" "uncached"   "$NOTPERMS"
cache_case "empty output"                                 "uncached"   "$EMPTY"
rm -f "$REAL" "$NOTPERMS" "$EMPTY"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
