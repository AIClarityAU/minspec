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

# How long before RETRYING a re-mint that failed, or that came back with the token we
# already hold. Both leave the holder stale, so without a cooldown every read in a long
# loop would spawn its own broker round trip while the broker is down or has not
# rotated its cache (#2114).
_GH_BOT_REMINT_COOLDOWN="${MINSPEC_GH_BOT_REMINT_COOLDOWN:-30}"
_GH_BOT_REMINT_TRIED_AT=0

# Fingerprint of the token we hold — see _gh_bot_adopt for why the VALUE matters and
# not just the moment we asked for it.
_GH_BOT_TOKEN_FP=""

gh_bot_die() {
  echo "gh-bot: $*" >&2
  exit 1
}

# A short, non-reversible fingerprint of a token. Never the token itself: this ends up
# in an exported environment variable, which is visible to every child and to anything
# that dumps the environment.
# Empty when no hasher is available, and every caller treats empty as "cannot vouch for
# this token" rather than as a match — a missing tool must not manufacture ownership.
# Every consumer of this file runs under `set -euo pipefail`, so nothing here may fail
# as a bare statement: an unguarded non-zero would abort the CALLER, and the caller is
# the drain. Hence the explicit `|| h=""` rather than a bare pipeline.
_gh_bot_fingerprint() {
  local h=""
  h="$(printf '%s' "${1-}" | command sha256sum 2>/dev/null)" || h=""  # swallow-ok: a missing hasher yields an empty fingerprint, which every caller reads as "cannot vouch for this token" and refuses to match — the absence IS the answer here, not a lost verdict
  printf '%s' "${h:0:16}"
}

# _gh_bot_adopt <token> — install a token as OURS, dated by the TOKEN and not by the
# moment we asked for it.
#
# The host broker hands the whole machine ONE cached installation token and keeps
# handing it out after it dies, with no in-container way to force a re-mint (#2114). So
# "we minted a second ago" is not evidence that the credential is young: a mint that
# returns the value we already hold has told us nothing except that the cache has not
# rotated. Resetting the age clock there would buy a full max-age of confidence in a
# token that may already be dead, which is how a headroom scheme becomes a headroom
# fiction. The clock therefore moves only when the VALUE changes.
#
# Returns 0 when a genuinely different credential is now in place, 1 when the broker
# handed back the same one. Callers use that to tell "worth retrying" from "hold".
_gh_bot_adopt() {
  local tok="${1-}" changed=0
  [[ "$tok" != "${GH_TOKEN:-}" ]] && changed=1
  export GH_TOKEN="$tok"
  _GH_BOT_OWNED=1
  # We minted it, so there is no third-party identity to probe — skip the `gh api user`
  # check `_gh_bot_ensure` would otherwise run against our own token on the first write.
  _GH_BOT_VERIFIED=1
  _GH_BOT_TOKEN_FP="$(_gh_bot_fingerprint "$tok")"
  (( changed )) && _GH_BOT_MINTED_AT="$(date +%s)"
  # Carry ownership across a fork, so a child can refresh what its parent minted.
  [[ -n "$_GH_BOT_TOKEN_FP" ]] \
    && export MINSPEC_GH_BOT_TOKEN_STAMP="${_GH_BOT_MINTED_AT}:${_GH_BOT_TOKEN_FP}"
  (( changed ))
}

# ── Ownership across a fork ───────────────────────────────────────────────────
# drain-inbox.sh exports its minted GH_TOKEN and then spawns triage-inbox.sh,
# dispatch-issue.sh and remediate-pr.sh, each of which sources this file afresh. Without
# the stamp they see only "GH_TOKEN is set" and classify it as INHERITED — "not ours to
# replace" — so the gh_bot_refresh calls those three already make are no-ops, and each
# child presents its parent's token for its whole run, dead or not. Measured in the
# 2026-09-27 drain log: `Fetching issue #2023... HTTP 401: Bad credentials`, once per
# dispatch, for hours (#2066).
#
# The stamp is fingerprint-VERIFIED, not merely present, because a marker outlives the
# token it describes: scripts/review-churn-report.sh assigns GH_TOKEN from the broker
# itself, and an unverified stamp inherited from an ancestor would then claim ownership
# of a credential this file never minted.
#
# Offline by construction (one hash, no network), so sourcing stays safe — and it
# deliberately does NOT set _GH_BOT_VERIFIED: an inherited token still earns its
# identity check on the first WRITE, exactly as it did before.
if [[ -n "${GH_TOKEN:-}" && -n "${MINSPEC_GH_BOT_TOKEN_STAMP:-}" ]]; then
  _gh_bot_stamp_at="${MINSPEC_GH_BOT_TOKEN_STAMP%%:*}"
  _gh_bot_stamp_fp="${MINSPEC_GH_BOT_TOKEN_STAMP#*:}"
  if [[ "$_gh_bot_stamp_at" =~ ^[0-9]+$ && -n "$_gh_bot_stamp_fp" \
        && "$_gh_bot_stamp_fp" == "$(_gh_bot_fingerprint "$GH_TOKEN")" ]]; then
    _GH_BOT_OWNED=1
    _GH_BOT_MINTED_AT="$_gh_bot_stamp_at"
    _GH_BOT_TOKEN_FP="$_gh_bot_stamp_fp"
  fi
  unset _gh_bot_stamp_at _gh_bot_stamp_fp
fi

# _gh_bot_token_is_stale — is the token we HOLD one of ours, and old enough that it may
# already have expired? One predicate for the read path, the write path and
# gh_bot_refresh: three copies of "is it time to re-mint" is how they drift apart, and
# the read path drifting is what produced #2066.
_gh_bot_token_is_stale() {
  [[ "$_GH_BOT_OWNED" == "1" ]] || return 1      # inherited: not ours to replace
  [[ -n "${GH_TOKEN:-}" ]] || return 1           # nothing held yet
  (( _GH_BOT_MINTED_AT > 0 )) || return 1
  (( $(date +%s) - _GH_BOT_MINTED_AT >= _GH_BOT_MAX_AGE ))
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

  if ! _gh_bot_adopt "$tok"; then
    # The same token back. Not an error — the caller asked for a credential and there is
    # one — but the age clock deliberately did not move (#2114), so the next refresh
    # tries again instead of assuming a fresh 45 minutes.
    return 0
  fi
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
      # GraphQL now defaults to WRITE, and that inversion is the point (#1411).
      #
      # A GraphQL document says whether it mutates; argv often does not, because
      # `-f query="$MUT"` hides the document in a variable. The previous rule
      # keyed on a literal `mutation` token, so a mutation built in a variable
      # read as a query and would have gone out under the ambient identity — a
      # silent hole that depended on a future author remembering a comment.
      #
      # Unguessable input must not be guessed at, so the default is the safe
      # answer and a genuine READ has to say so, out loud and greppably, by
      # calling `gh_bot_graphql_read`. That is one declaration at each of the two
      # existing read sites, versus a standing invitation to misattribute.
      local -a args=("$@")
      local i n="${#args[@]}" is_graphql=0 has_body=0
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
        esac
      done
      (( is_graphql )) && return 0        # unguessable ⇒ treat as a write
      (( has_body )) && return 0
      return 1 ;;
  esac
  [[ "$noun" =~ ^($GH_BOT_WRITE_NOUNS)$ ]] || return 1
  [[ "$verb" =~ ^($GH_BOT_WRITE_VERBS)$ ]] || return 1
  return 0
}

# Mint/validate at most once per process. Called by the `gh` wrapper on a write.
_gh_bot_ensure() {
  # IDENTITY and VALIDITY are different questions, and _GH_BOT_VERIFIED only answers the
  # first. A token of OURS that has aged out must be replaced before it is used, however
  # thoroughly it was verified an hour ago — otherwise the first write after the cliff
  # goes out on a dead credential and comes back as a 401 that reads like a permissions
  # problem (#2066). Fatal on failure, unlike the read path: a write with no bot
  # identity must abort rather than fall back (#1355).
  if _gh_bot_token_is_stale; then
    _gh_bot_mint
    return 0
  fi

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
             | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"  # swallow-ok: grep exits 1 when the answer carries no login field, which is the case this probe is looking for; the branch below accepts it only alongside a 403

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

# _gh_bot_read_auth — give READS a credential when the ambient one does not exist.
#
# The original contract was "reads pass straight through on whatever credential is
# ambient; only a WRITE forces a bot identity first", and it was correct when it was
# written: this container's `gh` was authenticated as the founder, so reads worked and
# only attribution needed fixing. The identity-boundary work then removed that
# credential by design, and nothing in the read path noticed — `gh` began answering
# every read with "To get started with GitHub CLI, please run: gh auth login" on
# stderr, which callers were already routing to /dev/null.
#
# Measured 2026-09-21: `drain-inbox.sh` logged
# "no agent-ready / agent-ready-specify issues after triage — cycle done" 47 times
# while the repo actually held 119 `agent-ready` + 326 `agent-ready-specify` open
# issues. Both probes a reader reaches for came back green — the log was current to
# the second, and the loop was alive — because the failure was an authentication
# error being read as an empty queue. That is #1855's shape, and this is its cause:
# the swallow made it silent, the missing read credential made it wrong.
#
# BEST-EFFORT, NEVER FATAL, and that asymmetry is the whole design:
#
#   * A WRITE with no bot identity must abort (`_gh_bot_ensure` → `gh_bot_die`),
#     because writing as the human is the bug this file exists to close (#1355).
#   * A READ with no bot identity must proceed exactly as it did before this
#     function existed. CI has no App key, `check-gh-bot-attribution.sh` sources
#     this file offline, and `issue-lease.sh` is sourced as a LIBRARY — the header
#     above is explicit that "a script that only reads must run fine with no
#     credential at all", and an eager export already broke 30+ CI cases once.
#
# So every failure path here returns 0 and leaves GH_TOKEN untouched. It cannot make
# a read worse than it is today; it can only make an unauthenticated one work.
#
# It does NOT make a failed read quiet. Callers must still distinguish "the query
# failed" from "the answer is empty" — this only removes the most common cause of the
# first. `drain-inbox.sh` holds loudly on a non-zero status for exactly that reason.
# The once-only guard is per-SHELL, not per-process, and that distinction is load
# bearing. A caller that reads inside `$(...)` runs in a subshell, so neither the
# guard nor the `export GH_TOKEN` below propagates back to the parent — such a caller
# re-mints on every read. That is correct but wasteful, and on a many-read loop it is
# a rate-limit concern. `gh_bot_warm_read` exists so those callers can pay once, in
# the parent, before the first read (#2003 review).
_gh_bot_read_auth() {
  # Staleness is asked BEFORE the once-only guard, and that ORDER is the fix for #2066.
  # The guard exists to stop a hot read loop re-minting a HEALTHY token; it must not pin
  # a DEAD one for the life of the process. An aged-out token is worse than no token at
  # all: `gh` presents it and GitHub answers `401 Bad credentials`, so the read fails
  # where an unauthenticated one would at least have tried. Measured 2026-09-27:
  # drain-inbox.sh minted once before an 8-hour loop, and from ~1h in every read 401'd
  # for the remaining seven hours over a 60-issue queue.
  if _gh_bot_token_is_stale; then
    # `|| return 0` is not decoration: a failed re-mint is not a failed read, and every
    # consumer runs under `set -e`, where a bare non-zero here would abort the drain.
    _gh_bot_remint_read || return 0
    return 0
  fi

  [[ "${_GH_BOT_READ_AUTH_TRIED:-0}" == "1" ]] && return 0
  _GH_BOT_READ_AUTH_TRIED=1

  # Something is already ambient. Never replace it: it may be the caller's (a
  # workflow's GITHUB_TOKEN), and a read has no business re-identifying it. Note this
  # is reachable only when the token is NOT ours — an aged-out token of our own was
  # already handled above.
  [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]] && return 0

  _gh_bot_remint_read || return 0
  return 0
}

# _gh_bot_remint_read — mint for the READ path: best-effort, never fatal, never SILENT.
#
# Same asymmetry as above — a read may not abort — but "may not abort" was read as "may
# say nothing", and a quiet re-mint failure followed by a 401 is the diagnosis-hostile
# shape that cost seven hours on 2026-09-27. Constitution invariant 2 wants the missing
# witness visible, so this prints the broker's own diagnosis and carries on.
#
# Returns 0 only when a DIFFERENT credential is now installed.
_gh_bot_remint_read() {
  # No key at all is the documented CI case, not a failure: "a script that only reads
  # must run fine with no credential at all." Silent on purpose, and only here.
  [[ -f "$_GH_BOT_TOKEN_SCRIPT" ]] || return 1

  local now; now="$(date +%s)"
  if (( _GH_BOT_REMINT_TRIED_AT > 0
        && now - _GH_BOT_REMINT_TRIED_AT < _GH_BOT_REMINT_COOLDOWN )); then
    return 1
  fi
  _GH_BOT_REMINT_TRIED_AT="$now"

  local tok errfile err_txt rc=0
  errfile="$(mktemp)"
  tok="$("$_GH_BOT_TOKEN_SCRIPT" 2>"$errfile")" || rc=$?
  err_txt="$(cat "$errfile" 2>/dev/null)"  # swallow-ok: this reads the diagnosis to PRINT it; an unreadable scratch file must not turn a reported failure into an abort, and rc above is the verdict
  rm -f "$errfile"

  if (( rc != 0 )) || [[ -z "$tok" || "$tok" == *$'\n'* ]]; then
    echo "gh-bot: could not re-mint a read token (App token script exited ${rc}) — the read goes out on whatever credential is present, and will fail if that one is dead." >&2
    [[ -n "$err_txt" ]] && printf 'gh-bot:   %s\n' "$err_txt" >&2
    return 1
  fi

  _gh_bot_adopt "$tok"
}

# gh_bot_init — call once, near the top of any script that writes to GitHub.
#
# Defines a shell function named `gh`, which shadows the binary for the rest of
# the process. A WRITE forces a bot identity first and aborts without one. A READ
# takes a bot token when one can be minted and otherwise proceeds unauthenticated,
# which is what lets a read-only entry point run with no credential at all — the
# property the test suites and CI depend on.
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
    else
      # A read still needs SOME credential. Best-effort and never fatal — see
      # _gh_bot_read_auth for why the two directions fail differently.
      _gh_bot_read_auth
    fi
    command gh "$@"
  }
  _GH_BOT_ARMED=1
}

# gh_bot_graphql_read — run a GraphQL query that provably does NOT mutate.
#
# `gh api graphql` counts as a write by default, because a document passed in a
# variable cannot be classified from argv and guessing wrong writes as the human
# (#1411). A read therefore has to declare itself, and this is the declaration:
# an explicit, greppable call that skips the mint and goes straight to `gh`.
#
#     gh_bot_graphql_read -f query="$Q" -F c="$CUR"
#
# Use it ONLY for a document you can see is a query. If the document comes from
# somewhere you do not control, it is not a read — call `gh` normally and let it
# mint. The guard treats every `gh api graphql` line WITHOUT this call as a
# write, so the choice is recorded in the source rather than left to memory.
gh_bot_graphql_read() {
  command gh api graphql "$@"
}

# gh_bot_warm_read — mint the read token ONCE, here, in the caller's own shell.
#
# For a script that does many reads inside `$(...)`. Each of those is a subshell, so
# `_gh_bot_read_auth` runs there, exports into a shell that is about to vanish, and
# the next read mints all over again. Calling this in the parent puts GH_TOKEN in the
# environment the subshells inherit, so the whole run pays for one token.
#
# Same best-effort, never-fatal contract as the read path it wraps: no key means no
# change, and the reads proceed exactly as they would have. Call it AFTER argv
# dispatch, never at source time — the offline seams and the test suites must not be
# made to touch the network.
gh_bot_warm_read() {
  _gh_bot_read_auth
}

# gh_bot_refresh — re-mint if OUR token is near expiry. No-op for an inherited
# token (not ours to replace) and no-op while the current one has headroom.
# Call at the top of long per-item loops.
gh_bot_refresh() {
  _gh_bot_token_is_stale || return 0
  echo "gh-bot: token is $(( $(date +%s) - _GH_BOT_MINTED_AT ))s old — re-minting." >&2
  _gh_bot_mint
}

# gh_bot_reauth_read — force ONE re-mint attempt, ignoring headroom, for a caller that
# has just SEEN a read fail.
#
# Age is a GUESS about validity; a failed read is an OBSERVATION of it. The broker hands
# the whole machine one cached token and keeps handing it out after it dies (#2114), so a
# holder can sit well inside its headroom and still hold a dead credential — nothing the
# age check above can see, and exactly what the failure just proved.
#
# Returns 0 only when a DIFFERENT credential is now in place, i.e. when re-running the
# read could plausibly succeed. Non-zero means the broker gave back the same value (or
# nothing), so the caller must report the failure rather than re-run a query guaranteed
# to fail again: a failed query is never an empty queue (#1855), and this must not soften
# that into a silent retry loop.
gh_bot_reauth_read() {
  # OUR token, or none at all. A caller's credential (a workflow's GITHUB_TOKEN) stays
  # the caller's even when a read fails on it: "whose identity is this" is a different
  # question from "is this token alive", and the read path has no business answering the
  # first. In CI, where a workflow supplies the token, this is therefore a no-op — and a
  # failed read there stays the loud hold it already was.
  if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]] && [[ "$_GH_BOT_OWNED" != "1" ]]; then
    return 1
  fi
  _GH_BOT_REMINT_TRIED_AT=0   # a proven-bad token outranks the cooldown
  _gh_bot_remint_read
}
