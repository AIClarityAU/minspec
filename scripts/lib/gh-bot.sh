#!/usr/bin/env bash
# scripts/lib/gh-bot.sh — make every agent GitHub write carry the BOT's identity.
#
# ── Why this exists (#1355) ───────────────────────────────────────────────────
# The container's `gh` is authenticated as the founder's account. Every agent
# write therefore recorded a HUMAN as the actor, and the audit trail lied about
# who acted — the exact harm minspec#995 exists to prevent.
#
# It also generated the mail that surfaced the bug. GitHub permanently
# auto-subscribes the AUTHOR of a thread, so an agent-filed issue subscribed the
# founder forever, and every later bot comment on it sent them email. Sampling 50
# unread notifications on this repo: 25 `author`, 21 `ci_activity`, 4 other.
#
# minspec#995 already required App-token attribution. It was PROSE ONLY, and
# nothing obeyed it: before this file, `grep -l gh-app-token scripts/*.sh` found
# nothing across 76 write call sites in 11 paths. A rule the model has to
# remember is a rule that drifts — hence `scripts/check-gh-bot-attribution.sh`,
# which fails CI if a write is reintroduced without sourcing this file.
#
# ── The shape: a `gh` shell function, minting LAZILY on first write ───────────
# gh_bot_init defines a shell function named `gh`. Shell functions take
# precedence over PATH, so every existing `gh ...` call in the sourcing script
# routes through it with ZERO call-site edits — 1 edit per script instead of 76.
#
# The function mints a token only when the invocation is a WRITE. That laziness
# is not an optimisation, it is a correctness requirement:
#
#   An earlier version exported GH_TOKEN eagerly at source time. It broke every
#   consumer that runs these files for their READ-ONLY paths — the pure
#   `--verify-label-event` entry point, the source-text assertions, and
#   issue-lease.sh being sourced as a LIBRARY. Locally it looked fine, because
#   this container has the App key; under CI conditions (no key) it failed 30+
#   times in one run. Local green was a false green.
#
# So: sourcing this file must never touch the network, and a script that only
# reads must run fine with no credential at all.
#
# ── What this deliberately does NOT convert ───────────────────────────────────
#   * `scripts/approve-issue.sh` — human-only BY DESIGN (TTY-required, no
#     `--yes`, and it refuses outright when `gh api user` resolves to a bot).
#     Its APPROVER *is* the authenticated human, so attributing its writes to
#     that human is correct. Sourcing this file there would break approval
#     entirely. It is allowlisted in the guard for that reason.
#   * `git push` — push identity comes from git credentials and commit
#     authorship, not from `gh`. Out of scope.
#   * `--admin` merges — remain a HUMAN action (founder decision, 2026-07-28).
#     Nothing here grants or eases that.
#
# ── Failure policy: closed and loud, at STARTUP ───────────────────────────────
# If a token cannot be minted, scripts abort before doing any work rather than
# falling back to ambient auth. Constitution invariant 2 (no silent gate): a
# missing witness fails visibly, never best-effort. Half a run attributed to the
# human is worse than no run, because it is the failure we are fixing.

# Idempotent source guard: several of these scripts source each other.
[[ -n "${_GH_BOT_SH_LOADED:-}" ]] && return 0
_GH_BOT_SH_LOADED=1

_GH_BOT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_GH_BOT_TOKEN_SCRIPT="${MINSPEC_GH_APP_TOKEN_SCRIPT:-$HOME/.claude/scripts/gh-app-token.sh}"
_GH_BOT_READY_CHECK="${_GH_BOT_LIB_DIR}/../dispatch-ready-check.sh"

# Set only when WE minted the token. An inherited token belongs to the caller
# (a workflow), so refresh must never replace it.
_GH_BOT_OWNED=0
_GH_BOT_MINTED_AT=0

# Installation tokens live ~1h. A drain pass can outlast that, so long loops call
# gh_bot_refresh; re-mint with headroom rather than at the cliff.
_GH_BOT_MAX_AGE="${MINSPEC_GH_BOT_MAX_AGE:-2700}"   # 45 min

gh_bot_die() {
  echo "gh-bot: $*" >&2
  exit 1
}

# Is this login a bot? Delegates to dispatch-ready-check.sh rather than carrying
# a second copy of the predicate — that file's own header warns that "two files
# half-knowing one predicate is how they drift."
# Invoked via `bash <path>` rather than requiring the executable bit: a fresh
# checkout with a lost mode bit must not silently turn every inherited token
# into a "not a bot" verdict, which would hard-fail CI for the wrong reason.
_gh_bot_is_bot_login() {
  local login="${1-}"
  [[ -n "$login" ]] || return 1
  [[ -f "$_GH_BOT_READY_CHECK" ]] || gh_bot_die \
"cannot classify the inherited GH_TOKEN identity — the bot-identity predicate is missing.
  looked for: $_GH_BOT_READY_CHECK
  Failing closed rather than guessing whether '${login}' is a bot."
  bash "$_GH_BOT_READY_CHECK" --is-bot-identity "$login" >/dev/null 2>&1
}

_gh_bot_mint() {
  [[ -f "$_GH_BOT_TOKEN_SCRIPT" ]] || gh_bot_die \
"cannot mint a bot token — the App token script is missing.
  looked for: $_GH_BOT_TOKEN_SCRIPT
  Refusing to write to GitHub as the human (minspec#995, #1355).
  Fix the path, set MINSPEC_GH_APP_TOKEN_SCRIPT, or run with the App token
  already in GH_TOKEN."

  # stderr MUST stay off stdout: gh-app-token.sh emits advisory warnings (e.g. a
  # loose key mode) on stderr, and folding those into the capture would hand `gh`
  # a token with prose glued to it.
  local tok errfile err_txt rc
  errfile="$(mktemp)"
  tok="$("$_GH_BOT_TOKEN_SCRIPT" 2>"$errfile")" && rc=0 || rc=$?
  err_txt="$(cat "$errfile" 2>/dev/null)"
  rm -f "$errfile"

  if (( rc != 0 )); then
    gh_bot_die \
"the App token script failed (exit ${rc}), so this run has no bot identity.
  ${err_txt}
  Refusing to fall back to ambient auth — that is the bug this closes (#1355)."
  fi

  [[ -n "$tok" && "$tok" != *$'\n'* ]] || gh_bot_die \
"the App token script returned something that is not a single token.
  ${err_txt}
  Refusing to proceed with an unverified credential."

  export GH_TOKEN="$tok"
  _GH_BOT_OWNED=1
  _GH_BOT_MINTED_AT="$(date +%s)"
}

# ── THE write vocabulary — one definition, two consumers ──────────────────────
# Both the runtime predicate below and the CI guard
# (scripts/check-gh-bot-attribution.sh) answer the same question: "is this `gh`
# invocation a write?" They MUST answer it identically.
#
# They did not, at first. The guard's regex lacked `ruleset` and the
# add/remove/clone/... verbs that the runtime had, which opened a blind spot in
# the gate: `gh ruleset create` would mint a token at runtime, yet the guard
# would not REQUIRE that script to source this file — so a new script could ship
# unattributed and still pass CI. That is precisely the failure this file's own
# `_gh_bot_is_bot_login` header warns about, "two files half-knowing one
# predicate", committed by the file that warns about it.
#
# So the vocabulary lives here, once, and the guard sources this file to read it.
# Sourcing is safe and offline: it defines variables and functions, and shadows
# nothing until gh_bot_init is called.
GH_BOT_WRITE_NOUNS='issue|pr|label|release|workflow|repo|secret|variable|cache|run|ruleset'
# `run` covers `gh workflow run`; `upload` covers `gh release upload`. Both are
# genuinely mutating and were missing (#1401 review) — they are listed with the
# rest rather than special-cased, so the guard picks them up for free.
GH_BOT_WRITE_VERBS='create|comment|edit|merge|review|close|reopen|delete|ready|lock|unlock|set|rename|transfer|cancel|rerun|add|remove|clone|sync|archive|unarchive|restore|run|upload'
# Mutating HTTP methods for `gh api -X`. BOTH cases, and shared for the same
# reason as the lists above: the guard once matched only uppercase while the
# runtime accepted either, so `gh api -X post` in a non-sourcing script passed
# CI and still wrote as the human. A second parity gap of exactly the kind
# single-sourcing is meant to make impossible (#1401 security review).
GH_BOT_WRITE_METHODS='POST|PATCH|PUT|DELETE|post|patch|put|delete'

# ── Is this argv a WRITE? ─────────────────────────────────────────────────────
# Conservative: anything uncertain counts as a write. A false "write" costs one
# token mint; a false "read" ships the bug back.
_gh_bot_is_write() {
  local noun="${1:-}" verb="${2:-}"
  case "$noun" in
    api)
      # `gh api` defaults to GET; -f/-F/--raw-field/--input imply a POST body.
      #
      # GraphQL is the exception that needs care. `-f query=...` is how you pass
      # ANY GraphQL document, read or write, so the -f rule alone would call every
      # paginated query a write. That is not merely wasteful: a classified write
      # MINTS, and so a read-only script would abort wherever no key exists.
      # (retriage-unrecorded.sh is exactly that script — two reads, delegating all
      # writing to triage-inbox.sh.) So for graphql, decide on the document: a
      # `mutation` keyword in argv means write, otherwise read.
      local -a args=("$@")
      local i n="${#args[@]}" is_graphql=0 has_mutation=0 has_body=0
      for ((i = 0; i < n; i++)); do
        case "${args[i]}" in
          graphql) is_graphql=1 ;;
          # Three spellings, all valid to gh's flag parser and all previously
          # missed except the first: `-X POST`, `--method=POST`, `-XPOST`. The
          # equals/attached forms slipped past BOTH runtime and guard, so such a
          # write shipped as the human (#1401 review).
          -X|--method)
            [[ "${args[i + 1]:-}" =~ ^($GH_BOT_WRITE_METHODS)$ ]] && return 0 ;;
          --method=*|-X=*)
            [[ "${args[i]#*=}" =~ ^($GH_BOT_WRITE_METHODS)$ ]] && return 0 ;;
          -X?*)
            [[ "${args[i]#-X}" =~ ^($GH_BOT_WRITE_METHODS)$ ]] && return 0 ;;
          --input) return 0 ;;
          -f|-F|--field|--raw-field) has_body=1 ;;
          *mutation*) has_mutation=1 ;;
        esac
      done
      # KNOWN CONSTRAINT (#1401 security review): the decision reads argv, so a
      # mutation whose document arrives through a VARIABLE — `-f query="$MUT"` —
      # looks like a read to both this and the guard, and would go out as the
      # ambient identity. No current call site does it. If you add a GraphQL
      # mutation, keep a literal `mutation` token in argv, or call
      # `_gh_bot_ensure` yourself before the write. Tracked in the follow-up
      # filed from that review.
      if (( is_graphql )); then
        (( has_mutation )) && return 0
        return 1
      fi
      (( has_body )) && return 0
      return 1 ;;
  esac
  [[ "$noun" =~ ^($GH_BOT_WRITE_NOUNS)$ ]] || return 1
  [[ "$verb" =~ ^($GH_BOT_WRITE_VERBS)$ ]] || return 1
  return 0
}

# Mint/validate at most once per process. Called by the `gh` wrapper on a write.
_gh_bot_ensure() {
  [[ "${_GH_BOT_VERIFIED:-0}" == "1" ]] && return 0

  if [[ -n "${GH_TOKEN:-}" ]]; then
    # Inherited. The CI path: approve-on-label.yml and ai-review.yml already
    # hand these scripts an App token, and clobbering it would be wrong.
    #
    # But "GH_TOKEN is set" does not by itself mean "not the human" — a founder
    # PAT exported in a shell would sail straight through and reintroduce the
    # exact bug. So verify, and fail closed on a human.
    #
    # An INSTALLATION token has no associated user, so `gh api user` 403s. That
    # is the expected, correct case for the CI path — not an error.
    #
    # CAREFUL: on a 403 `gh` prints the error BODY to stdout, so `-q .login`
    # yields the whole JSON blob rather than nothing. Taking that at face value
    # classified every installation token as a human login and hard-failed CI.
    # Accept only something actually shaped like a GitHub login.
    #
    # AND an unrecognisable answer is NOT the same as a 403. An earlier version
    # treated "not login-shaped" as "must be an installation token" and accepted
    # it — so a probe that came back empty for ANY reason (network blip, rate
    # limit, gh crash) would wave a human PAT straight through. That is a
    # fail-OPEN on an ambiguous signal, in the one place this whole file exists
    # to fail closed (#1401 security review). Now the 403 must be positively
    # identified; anything else is refused.
    #
    # `command gh`, never bare `gh` — bare would recurse into our own wrapper.
    local probe rc login
    probe="$(command gh api user 2>&1)" && rc=0 || rc=$?
    login="$(printf '%s' "$probe" | { command grep -oE '"login"[[:space:]]*:[[:space:]]*"[^"]+"' || true; } \
             | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"

    if [[ -z "$login" ]]; then
      # No login in the answer. Only a recognisable "this token has no user"
      # rejection may be read as an installation token.
      # 403 ONLY, never 401. An installation token is authenticated but has no
      # user, which is a 403. A 401 means the credential itself was rejected —
      # an expired or revoked HUMAN PAT returns exactly that, and reading it as
      # "must be an installation token" is the same guess this block exists to
      # stop making (#1401 security review).
      if (( rc != 0 )) && printf '%s' "$probe" \
           | command grep -qiE 'not accessible by integration|"status"[[:space:]]*:[[:space:]]*"?403|HTTP 403'; then
        _GH_BOT_VERIFIED=1
        return 0                    # positively identified installation token
      fi
      if [[ "${MINSPEC_GH_BOT_ALLOW_HUMAN:-}" == "1" ]]; then
        echo "gh-bot: WARNING: GH_TOKEN identity unverifiable (gh api user exited ${rc}) — proceeding because MINSPEC_GH_BOT_ALLOW_HUMAN=1." >&2
        _GH_BOT_VERIFIED=1
        return 0
      fi
      gh_bot_die \
"GH_TOKEN is set but its identity could not be established (gh api user exited ${rc}).
  Refusing to write: an unverifiable token may be a human's, and this is the one
  place that must not guess (#1355).
  Response: $(printf '%s' "$probe" | head -c 200)
  Unset GH_TOKEN to mint a bot token instead, or set MINSPEC_GH_BOT_ALLOW_HUMAN=1
  if a human is deliberately running this."
    fi
    if _gh_bot_is_bot_login "$login"; then
      _GH_BOT_VERIFIED=1
      return 0
    fi
    if [[ "${MINSPEC_GH_BOT_ALLOW_HUMAN:-}" == "1" ]]; then
      echo "gh-bot: WARNING: writing as HUMAN '${login}' — MINSPEC_GH_BOT_ALLOW_HUMAN=1 is set." >&2
      _GH_BOT_VERIFIED=1
      return 0
    fi
    gh_bot_die \
"GH_TOKEN is set but resolves to '${login}', which is not a bot identity.
  Agent writes must not be recorded as a human (minspec#995, #1355).
  Unset GH_TOKEN to let a bot token be minted, or set
  MINSPEC_GH_BOT_ALLOW_HUMAN=1 if this really is a human running the script."
  fi

  _gh_bot_mint
  _GH_BOT_VERIFIED=1
}

# gh_bot_init — call once, near the top of any script that writes to GitHub.
#
# Defines a shell function named `gh`, which shadows the binary for the rest of
# the process. Reads pass straight through on whatever credential is ambient;
# only a WRITE forces a bot identity first. That is what lets a read-only entry
# point run with no credential at all, which the test suites depend on.
#
# Cheap, offline, and safe to call more than once: it does NOT mint, contact
# GitHub, or fail. All of that is deferred to the first write.
#
# The shadowing lives HERE rather than at file scope on purpose — sourcing a
# library should not silently redefine a command the caller did not ask about.
gh_bot_init() {
  gh() {
    if _gh_bot_is_write "$@"; then
      _gh_bot_ensure
    fi
    command gh "$@"
  }
  _GH_BOT_ARMED=1
}

# gh_bot_refresh — re-mint if OUR token is near expiry. No-op for an inherited
# token (not ours to replace) and no-op while the current one has headroom.
# Call at the top of long per-item loops.
gh_bot_refresh() {
  [[ "$_GH_BOT_OWNED" == "1" ]] || return 0
  local age=$(( $(date +%s) - _GH_BOT_MINTED_AT ))
  (( age >= _GH_BOT_MAX_AGE )) || return 0
  echo "gh-bot: token is ${age}s old — re-minting." >&2
  _gh_bot_mint
}
