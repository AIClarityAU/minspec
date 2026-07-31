#!/usr/bin/env bash
# workflow-paths.sh — is this push going to be refused for touching CI workflows?
#
# THE PROBLEM (#1120). Agent git pushes authenticate as the `minspec-sdd` GitHub
# App. GitHub treats `.github/workflows/**` as a permission of its own
# (`workflows: write`) precisely so a compromised App cannot rewrite CI — and
# `contents: write`, which the App does have, is documented as NOT sufficient.
# So a push whose diff touches any workflow file is rejected outright:
#
#   ! [remote rejected] <branch> -> <branch> (refusing to allow a GitHub App to
#     create or update workflow `.github/workflows/ai-review.yml` without
#     `workflows` permission)
#
# This is not an edge case. `MinSpec: Refresh Harness Files` rewrites FIVE managed
# workflow templates (ai-review, ready-to-merge, ai-review-retry, docs-lane,
# minspec-validate), so EVERY harness refresh in EVERY consuming repo produces a
# branch the App cannot push. It first bit landing a stranded refresh into
# AIClarityAU/scroogellm (#102).
#
# WHY A PREFLIGHT AND NOT JUST THE GRANT. Granting the App `workflows: write` is
# the real fix, but it is a UI-only action on the app registration plus a
# per-installation approval by an org owner — there is no API for it. Until then,
# and for any repo whose installation has not accepted the update, the failure
# must arrive BEFORE the work is sealed into branch history with a cryptic
# server-side message. Same reasoning as the protected-branch guard in
# .githooks/pre-commit: "the rejection arrives at `git push`, after the work is
# already done".
#
# CONTRACT. Sourced, never executed. Two pure-ish predicates plus a `--check`
# seam so tests can exercise the decision without git, network, or a real remote.
# Offline by construction (constitution invariant 1): the credential probe reads
# git's own credential helper chain and never contacts a forge.

# Any path under a `.github/workflows/` directory, at the repo root or nested.
WORKFLOW_PATH_RE='(^|/)\.github/workflows/'

# Reads newline-separated repo-relative paths on stdin. True when any is a
# workflow file. Twin of dispatch-issue.sh's paths_have_approvable_doc().
paths_touch_workflows() {
  grep -qE "$WORKFLOW_PATH_RE"
}

# True when the credential git would use for `origin` is a GitHub App
# installation token, i.e. the push would be subject to the App's permissions.
#
# Detected from the USERNAME only — `x-access-token` is the fixed username git
# uses for an installation token, while a human PAT/OAuth credential carries the
# account login. The password is never read, echoed, or logged. A human pushing
# with their own credential must never be blocked by this, so anything other than
# that exact username returns false (fail OPEN — this guard exists to give a
# better error, never to be a new obstacle).
push_credential_is_app_token() {
  local user
  user=$(printf 'protocol=https\nhost=github.com\n\n' \
         | git credential fill 2>/dev/null \
         | sed -n 's/^username=//p' \
         | head -1) || return 1
  [ "$user" = "x-access-token" ]
}

# Explain the refusal and, more importantly, how to get unstuck. Callers pass the
# offending paths on stdin.
workflow_push_refusal() {
  local paths
  paths=$(head -5)
  echo "✗ MinSpec gate: refusing to push — this branch changes CI workflow files," >&2
  echo "  and the credential in use is a GitHub App installation token." >&2
  echo "" >&2
  printf '%s\n' "$paths" | sed 's/^/      /' >&2
  echo "" >&2
  echo "  GitHub requires a separate 'workflows: write' permission for" >&2
  echo "  .github/workflows/** — 'contents: write' is not enough — so this push" >&2
  echo "  would be rejected by the server after the commit was already made." >&2
  echo "" >&2
  echo "  Fix it properly (one-time, org owner):" >&2
  echo "      Org Settings → Developer settings → GitHub Apps → Edit →" >&2
  echo "      Permissions & events → Repository permissions → Workflows →" >&2
  echo "      'Read and write', then accept the permission update on the" >&2
  echo "      installation. See AIClarityAU/minspec#1120." >&2
  echo "" >&2
  echo "  Push it now instead:" >&2
  echo "      push with a human credential that carries the 'workflow' scope," >&2
  echo "      or split the workflow change into its own human-pushed commit." >&2
  echo "" >&2
  echo "  Allow once:      MINSPEC_ALLOW_WORKFLOW_PUSH=1 git push ..." >&2
  echo "  Allow in future: git config minspec.allowWorkflowPush true" >&2
}

# Has the operator opted out?
workflow_push_allowed() {
  [ "${MINSPEC_ALLOW_WORKFLOW_PUSH:-0}" = "1" ] && return 0
  [ "$(git config --get minspec.allowWorkflowPush 2>/dev/null)" = "true" ]
}

# Test seam: `workflow-paths.sh --check` reads paths on stdin and prints
# `blocked` or `clear`, with the credential probe forced by MINSPEC_FAKE_APP_CRED
# so the decision is provable without a real credential helper or network.
#
# Guarded on being EXECUTED, not sourced. A bare `$1` here would read the SOURCING
# script's first argument — so `dispatch-issue.sh --check …` would trip this block
# and `cat` would swallow that script's stdin. Sourced use must define functions
# and nothing else.
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1:-}" = "--check" ]; then
  _wp_input=$(cat)
  _wp_app="${MINSPEC_FAKE_APP_CRED:-}"
  if [ -z "$_wp_app" ]; then
    push_credential_is_app_token && _wp_app=1 || _wp_app=0
  fi
  if workflow_push_allowed; then
    echo clear
  elif [ "$_wp_app" = "1" ] && printf '%s\n' "$_wp_input" | paths_touch_workflows; then
    echo blocked
  else
    echo clear
  fi
fi
