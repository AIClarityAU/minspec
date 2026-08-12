#!/usr/bin/env bash
# workflow-paths.sh — is this push going to be refused for touching CI workflows?
#
# ⚠ STALE PREMISE, 2026-08-12 (#1120). The permission this gate pre-empts has since
# been GRANTED: installation 144283146 reports `workflows=write`, read from the
# installation's own permissions object via the App JWT — not inferred from a response
# header, which reports what an endpoint accepts rather than what is granted. An
# App-token push touching `.github/workflows/ci.yml` succeeded (#1453).
#
# This gate therefore now fires on pushes that would SUCCEED — a false refusal, the
# direction that trains people to reach for the override until the day it matters.
# Kept for now rather than deleted (the permission could be revoked, and the guard is
# cheap) but it should be removed or made capability-probing; tracked on #1120. The
# message below leads with the re-check rather than the org-owner setting.
#
# THE ORIGINAL PROBLEM (#1120). Agent git pushes authenticate as the `minspec-sdd` GitHub
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

# True when the credential git would use for the push is a GitHub App
# installation token, i.e. the push would be subject to the App's permissions.
#
# Detected from the USERNAME only — `x-access-token` is the fixed username git
# uses for an installation token, while a human PAT/OAuth credential carries the
# account login. The password is never read, echoed, or logged. A human pushing
# with their own credential must never be blocked by this, so anything other than
# that exact username returns false (fail OPEN — this guard exists to give a
# better error, never to be a new obstacle).
#
# #1141 — THREE THINGS HERE ARE LOAD-BEARING. The original probe asked
# `git credential fill` for a hardcoded `https://github.com` with no other
# constraints, which was wrong in three separate ways:
#
#   1. WRONG SUBJECT. It probed the AMBIENT default credential for github.com,
#      not the credential this push will use. Git resolves `credential.helper`
#      as a multi-valued list evaluated system → global → local, stopping at the
#      first helper that returns a complete credential. A machine with a global
#      `credential.helper = store` therefore answered out of ~/.git-credentials
#      before any repo-local helper was consulted — so the verdict was decided by
#      whatever username happened to be cached on the box. Both failure
#      directions were observed: an App-credentialed push on a machine caching a
#      human PAT sailed through (fail-open, the exact #1120 rejection this exists
#      to pre-empt), and a human on a machine that had last cached
#      `x-access-token` was false-blocked. Now the push URL is the subject, via
#      `git remote get-url --push`, which honours insteadOf/pushInsteadOf
#      rewrites the way the push itself does.
#
#      WHAT THIS DOES AND DOES NOT SEE (verified, not assumed):
#        • A credential helper answering for the push URL — seen.
#        • A token embedded in the push URL's userinfo
#          (https://x-access-token:…@github.com/…) — seen. `git credential fill`
#          parses the username straight out of the URL, and it only reaches the
#          probe at all BECAUSE the probe now keys on the real push URL; the old
#          hardcoded host could never have seen it.
#        • `http.extraheader` (an Authorization header injected directly) — NOT
#          seen. It bypasses git's credential machinery entirely, so
#          `git credential fill` returns nothing for it. The guard fails open
#          there. That is a known residual gap, acceptable because this guard is
#          advisory — it converts a server-side rejection into a better local
#          message; it is not an access control.
#
#   2. IT PROMPTED ON THE TERMINAL. With no helper able to answer and a TTY
#      attached, `git credential fill` does not fail quietly — it asks:
#      `Username for 'https://github.com': `. The `2>/dev/null` on the old call
#      could not suppress that, because git writes the prompt to /dev/tty, not to
#      stderr. Verified under a real PTY: the old form emits the prompt, the new
#      form prints `terminal prompts disabled` and emits nothing to the terminal.
#      Where git can actually READ from the tty it blocks there waiting for input;
#      where stdin is a pipe (as here) it fails immediately but still writes the
#      prompt. Either way a contributor without a credential helper got mysterious
#      output or a stall from a `git push` — and `npm install` sets
#      core.hooksPath=.githooks, so that reaches everyone. GIT_TERMINAL_PROMPT=0
#      makes it fail instead of asking.
#
#   3. NON-HTTPS REMOTES. An App installation token only ever travels over
#      https. An ssh or filesystem remote cannot carry one, so it fails open
#      rather than probing a URL git would not attach a credential to anyway.
push_credential_is_app_token() {
  # Test seam. Deliberately checked HERE, inside the function, so it is reachable
  # when this file is SOURCED — which is how the pre-push hook uses it. It
  # previously existed only inside the `--check` block below, i.e. only when this
  # file was EXECUTED, so no test of the hook could ever reach it. That is why the
  # hook's tests were left depending on ambient machine credentials, which is the
  # bug above.
  #
  # THIS IS A BYPASS, AND IT NOW APPLIES TO THE HOOK PATH TOO. MINSPEC_FAKE_APP_CRED=0
  # forces the guard open exactly as MINSPEC_ALLOW_WORKFLOW_PUSH=1 does — it grants no
  # capability that was not already granted, and this guard is advisory (it turns a
  # server-side rejection into a better local message; it is not an access control).
  # But it is a second env-var escape hatch, so it is named here rather than left to
  # be discovered.
  if [ -n "${MINSPEC_FAKE_APP_CRED:-}" ]; then
    [ "${MINSPEC_FAKE_APP_CRED}" = "1" ]
    return
  fi

  # Accepts either a remote NAME or a URL. git's pre-push hook is handed both
  # ($1 = name, $2 = URL), and `git push https://… main` passes a bare URL as the
  # name — so resolving only names would fail open on exactly the ad-hoc push most
  # likely to carry an out-of-band credential.
  local target="${1:-origin}" url user
  case "$target" in
    https://*|http://*|ssh://*|git@*|/*|./*|../*) url="$target" ;;
    *) url=$(git remote get-url --push "$target" 2>/dev/null) || return 1 ;;
  esac
  case "$url" in
    https://*) ;;
    *) return 1 ;;
  esac

  user=$(printf 'url=%s\n\n' "$url" \
         | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null \
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
  echo "  .github/workflows/** — 'contents: write' is not enough." >&2
  echo "" >&2
  echo "  ⚠ THIS MAY NO LONGER APPLY. Measured 2026-08-12: installation 144283146" >&2
  echo "  reports workflows=write (alongside contents/actions/checks/issues/" >&2
  echo "  pull_requests/statuses/merge_queues=write), and an App-token push" >&2
  echo "  touching .github/workflows/ci.yml SUCCEEDED — see #1453. The premise" >&2
  echo "  behind this refusal was true when #1120 was filed and is not true now." >&2
  echo "" >&2
  echo "  So before doing anything else, RE-CHECK rather than chasing a setting" >&2
  echo "  that is already applied:" >&2
  echo "      GH_TOKEN=\$(~/.claude/scripts/gh-app-token.sh) gh api \\" >&2
  echo "        /installation/repositories >/dev/null && echo 'token OK'" >&2
  echo "  and simply retry the push. If it succeeds, this gate is stale — say so" >&2
  echo "  on AIClarityAU/minspec#1120 so it is removed rather than overridden." >&2
  echo "" >&2
  echo "  If the push genuinely IS rejected (permission later revoked):" >&2
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
  # MINSPEC_FAKE_APP_CRED is honoured inside push_credential_is_app_token itself
  # now, so this no longer needs to special-case it — one seam, one place, and the
  # sourced path (the hook) gets the same behaviour this executed path does.
  push_credential_is_app_token && _wp_app=1 || _wp_app=0
  if workflow_push_allowed; then
    echo clear
  elif [ "$_wp_app" = "1" ] && printf '%s\n' "$_wp_input" | paths_touch_workflows; then
    echo blocked
  else
    echo clear
  fi
fi
