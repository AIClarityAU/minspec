#!/usr/bin/env bash
# workflow-paths.sh — is this push going to be refused for touching CI workflows?
#
# NOW CAPABILITY-PROBING, not premise-based (#1120). This gate used to assume the App
# lacks `workflows: write` and refuse on that basis. The assumption was true when #1120
# was filed and later stopped being true, at which point the gate began refusing pushes
# that would have succeeded — a false refusal, the direction that trains the override
# reflex until the day the gate is right and gets overridden anyway.
#
# `workflow_permission_granted` now asks instead of assuming, so the answer stays
# correct in BOTH directions: it steps aside while the permission is held, and re-blocks
# if it is revoked. It fails CLOSED — an unanswerable probe refuses, because a probe that
# cannot answer must never be read as a yes.
#
# HONEST LIMIT on "re-blocks if revoked": a positive verdict is cached for
# MINSPEC_PERM_TTL (24 h default), so a permission revoked mid-window still yields exit 0
# until the cache expires, and the server rejects that push instead of this hook. That is
# a deliberate trade — the alternative is a network call on every workflow push — and it
# is acceptable only because this guard is ADVISORY: it converts a server rejection into
# a better local message, it is not an access control. Set MINSPEC_PERM_TTL=0 to probe
# every time.
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
# CONTRACT. Sourced, never executed. Two pure-ish predicates, a pure range helper
# (workflow_diff_range, #1274), plus a `--check` seam so tests can exercise the
# decision without git, network, or a real remote. Offline by construction
# (constitution invariant 1): the credential probe reads git's own credential
# helper chain and never contacts a forge.

# Any path under a `.github/workflows/` directory, at the repo root or nested.
WORKFLOW_PATH_RE='(^|/)\.github/workflows/'

# Reads newline-separated repo-relative paths on stdin. True when any is a
# workflow file. Twin of dispatch-issue.sh's paths_have_approvable_doc().
paths_touch_workflows() {
  grep -qE "$WORKFLOW_PATH_RE"
}

# The `git diff` RANGE that answers "what does this push actually introduce" —
# never "what differs between these two trees right now" (#1274).
#
# `git diff A..B` is the two-endpoint TREE diff (`git diff A B`), not a
# reachability-aware one. Fed a base that has moved ahead of where a branch
# forked — the ordinary case for ANY stale or rebased branch, since this repo
# touches `.github/workflows/**` often — it also reports every file the base
# changed in the meantime, even though the push does not touch them and the
# commits carrying them are already on the remote.
#
# This is the range logic `.githooks/pre-push` arrived at for the same reason
# (#1263; see that file for the three false-refusal attempts along the way).
# Extracted here so every caller shares ONE correct answer instead of each
# re-deriving — and re-breaking — its own copy. dispatch-issue.sh's
# shepherd_publish had exactly this bug: `origin/main..$BRANCH`, a naive
# two-dot diff, false-positived on a branch a fix agent had amended without
# rebasing once origin/main had since touched a workflow file.
#
#   prev_sha  — the ref's previously-known/remote tip. Empty ⇒ unknown (new
#               branch, or the caller could not determine it) — always falls
#               through to the base_ref arm.
#   local_sha — the commit about to be pushed.
#   base_ref  — fallback base when prev_sha is empty or not an ancestor of
#               local_sha (a diverged history: reset, rebase, force-push onto
#               a new line). Defaults to origin/main.
#
#   prev_sha IS an ancestor of local_sha -> prev_sha..local_sha  (ordinary
#     fast-forward: two-dot is correct BECAUSE it is an ancestor, and this also
#     excludes a workflow edit an EARLIER push of this ref already landed).
#   otherwise                            -> base_ref...local_sha (three-dot:
#     merge-base against the default branch, so drift the base_ref made since
#     the fork point is excluded too).
workflow_diff_range() {
  local prev_sha="${1:-}" local_sha="$2" base_ref="${3:-origin/main}"
  if [ -n "$prev_sha" ] && git merge-base --is-ancestor "$prev_sha" "$local_sha" 2>/dev/null; then
    printf '%s..%s\n' "$prev_sha" "$local_sha"
  else
    printf '%s...%s\n' "$base_ref" "$local_sha"
  fi
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
  echo "  You are seeing this because the capability probe could NOT confirm the" >&2
  echo "  installation holds 'workflows: write' — it fails closed, so an" >&2
  echo "  unanswerable probe refuses rather than guesses. Either the permission is" >&2
  echo "  genuinely absent, or the probe could not run (no token script, offline," >&2
  echo "  or MINSPEC_WORKFLOW_PERM_PROBE=0)." >&2
  echo "" >&2
  echo "  Check which, before assuming the permission is missing:" >&2
  echo "      ~/.claude/scripts/gh-app-token.sh --permissions | grep workflows" >&2
  echo "" >&2
  echo "  → prints 'workflows=write'  : the probe is broken, not the permission." >&2
  echo "      Report on AIClarityAU/minspec#1120; MINSPEC_ALLOW_WORKFLOW_PUSH=1" >&2
  echo "      unblocks you meanwhile." >&2
  echo "  → prints nothing / 'read'   : the permission really is missing. Grant it" >&2
  echo "      (Org Settings → Developer settings → GitHub Apps → Edit →" >&2
  echo "      Permissions & events → Repository permissions → Workflows →" >&2
  echo "      'Read and write', then accept it on the installation), or push with" >&2
  echo "      a human credential carrying the 'workflow' scope." >&2
  echo "" >&2
  echo "  Allow once:      MINSPEC_ALLOW_WORKFLOW_PUSH=1 git push ..." >&2
  echo "  Allow in future: git config minspec.allowWorkflowPush true" >&2
}

# Has the operator opted out?
workflow_push_allowed() {
  [ "${MINSPEC_ALLOW_WORKFLOW_PUSH:-0}" = "1" ] && return 0
  [ "$(git config --get minspec.allowWorkflowPush 2>/dev/null)" = "true" ]
}

# ── Capability probe (#1120) ─────────────────────────────────────────────────
# Exit 0 iff the App installation DEMONSTRABLY holds `workflows: write`, i.e. the
# push this gate is about to refuse would actually succeed.
#
# WHY PROBE AT ALL. The gate's premise — "the App lacks this permission, so the
# server will reject you after the commit is sealed" — was true when #1120 was filed
# and is false now. A gate whose premise has silently expired refuses correct work,
# and every needless override trains the reflex that makes the override worthless on
# the day the gate is right. Probing keeps the answer correct in BOTH directions: it
# re-blocks by itself if the permission is ever revoked.
#
# TIER-0 POSTURE. MinSpec itself makes no network call; this is dev-time tooling in
# `scripts/`, not shipped extension code, so the constraint does not apply — but the
# cost is still paid only where it buys something:
#   • ONLY where it earns its cost: the hook calls this AFTER workflow-path detection,
#     so an ordinary push never reaches it (verified by the call site, not asserted —
#     the first version claimed this while sitting before the detection loop).
#   • CACHED for MINSPEC_PERM_TTL seconds (default 24 h) in the git dir, so repeated
#     pushes cost nothing.
#   • FAILS CLOSED. No token script, no network, malformed output, or any error ⇒
#     non-zero ⇒ the gate blocks exactly as before. A probe that cannot answer must
#     never be read as a yes.
# Opt out entirely with MINSPEC_WORKFLOW_PERM_PROBE=0.
workflow_permission_granted() {
  [ "${MINSPEC_WORKFLOW_PERM_PROBE:-1}" = "0" ] && return 1

  local ttl cache now stamp val
  ttl="${MINSPEC_PERM_TTL:-86400}"
  cache="$(git rev-parse --git-dir 2>/dev/null)/minspec-workflows-perm" || return 1
  [ -n "$cache" ] || return 1

  now=$(date -u +%s 2>/dev/null) || return 1
  if [ -r "$cache" ]; then
    stamp=$(cut -d' ' -f1 <"$cache" 2>/dev/null)
    val=$(cut -d' ' -f2 <"$cache" 2>/dev/null)
    if [ -n "$stamp" ] && [ -n "$val" ] && [ $((now - stamp)) -lt "$ttl" ]; then
      [ "$val" = "write" ] && return 0 || return 1
    fi
  fi

  local script perms
  script="${MINSPEC_APP_TOKEN_SCRIPT:-$HOME/.claude/scripts/gh-app-token.sh}"
  [ -x "$script" ] || return 1
  # `--permissions` reads the installation's granted permissions object. Never infer
  # this from a response header: X-Accepted-Github-Permissions describes what an
  # ENDPOINT accepts and reports metadata=read here — the opposite of the truth.
  perms="$("$script" --permissions 2>/dev/null)" || return 1
  case "$perms" in
    *workflows=write*) printf '%s write\n' "$now" >"$cache" 2>/dev/null; return 0 ;;
    "") return 1 ;;                                   # unparseable ⇒ fail closed
    *) printf '%s none\n' "$now" >"$cache" 2>/dev/null; return 1 ;;
  esac
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
