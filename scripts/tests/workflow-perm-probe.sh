#!/usr/bin/env bash
# Drive the REAL pre-push hook in a temp repo, exercising the #1120 capability probe.
WT=/home/jason/code/.worktrees/minspec/gate-1120
HOOK="$WT/.githooks/pre-push"
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
setup; probe "real token script (has workflows=write)" allow \
  MINSPEC_PERM_TTL=0

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

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
