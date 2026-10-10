#!/usr/bin/env bash
# scripts/lib/agent-context.sh — the ambient context every headless agent starts with.
#
# Single source of truth for the two things a dev-time `claude -p` run starts with:
#   • which SETTINGS it loads. Source this file, then expand "${AGENT_CONTEXT_ARGS[@]}"
#     in the invocation.
#   • which ENVIRONMENT it is handed. Source this file, then start the CLI through it:
#     `bash "$AGENT_LAUNCH_ENV" claude -p ...`. Sourced, this file is a library; run,
#     it is the program that builds that environment. See "The agent's environment".
#
# ── Why this exists (#912 recurrence: the drain's autocompact halt) ────────────
# `claude -p` injects the DISCOVERED SUBAGENT ROSTER into the conversation as an
# `agent_listing_delta` ATTACHMENT. That is not part of the system prompt, so
# #912's `--system-prompt-file` context-slim fix — which does suppress the
# ambient CLAUDE.md/memory load — never touched it.
#
# On the operator box that hit this, `~/.claude/agents/` holds 272 definitions:
# 83,599 bytes, ~21k tokens, PER INJECTION. And the attachment is re-injected
# AFTER EVERY AUTOCOMPACT, which is the entire failure mode — compaction frees
# the window and the roster immediately refills it. Three rounds of that trip the
# harness's own abort:
#
#   "Autocompact is thrashing: the context refilled to the limit within 3 turns
#    of the previous compact, 3 times in a row."
#
# Measured identically across four crashed dispatches (#1101, #1099, #1132,
# #1189): exactly 4 roster injections and 3 compact summaries per run — ~334 KB
# of roster in one build. EVERY dispatched build died this way, which is what
# tripped drain-inbox.sh's autocompact circuit-breaker 3/3 and halted dispatch.
# The breaker was correct; it was reporting a real, systemic outage.
#
# The roster is pure dead weight to these runs: dispatch-issue.sh's ALLOWED_TOOLS
# grants no Agent/Task tool and no role prompt asks for a subagent, so the run
# cannot use a single agent it is paying ~21k tokens x4 to be told about.
#
# ── What this changes, and what it deliberately does not ──────────────────────
# `--setting-sources project,local` drops USER scope. Measured: 83,599 -> 3,201
# bytes (-96%; only the built-in agents remain).
#
#   * PROJECT scope is KEPT ON PURPOSE. The repo's own `.claude/settings.json`
#     (spec-gate.sh, marker-guard.mjs) is COMMITTED, so it is present in every
#     agent worktree and keeps loading. No MinSpec gate is weakened here — that
#     is the constitution's no-silent-gate invariant, so it is not negotiable.
#   * AUTH-NEUTRAL. Credentials do not live in settings, and the subscription
#     OAuth path is preserved — verified by a probe run that completed normally
#     under these sources. Unlike `--bare`, which forces ANTHROPIC_API_KEY and
#     would break subscription-default billing (DR-016/017).
#   * It does NOT drop `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. An earlier version of
#     this comment claimed it did — that was wrong, and the correction matters:
#     `--setting-sources` selects which settings FILES load, and cannot unset a
#     variable that is already exported in the process environment. The override
#     is inherited (session -> drain -> dispatch -> `claude -p`), so it survives
#     any file-source selection. What keeps it from the agent is the launch itself:
#     every launcher starts the CLI through this file, run as a program (see "The
#     agent's environment" below), which builds the agent's environment from a
#     list of names that the override is not on.
#   * User-scope hooks stop applying to headless runs (terminal naming, the
#     caveman output-style hook, the primary-checkout guard). That is correct
#     here: the agent runs in an isolated /tmp worktree and its allowlist admits
#     only `git add`/`git commit`-prefixed commands, so it has no path to the
#     primary checkout the guard protects.
#
# Kill-switch, no code change:
#   MINSPEC_AGENT_SETTING_SOURCES=user,project,local   restore the pre-fix shape
#   MINSPEC_AGENT_SETTING_SOURCES=""                   omit the flag entirely
#
# Enforced by packages/minspec/tests/agent-context-slim.test.ts — a new launcher
# that forgets the flag silently restores the outage, so a comment here is not
# enough ("enforce, don't trust the model").

# shellcheck shell=bash

MINSPEC_AGENT_SETTING_SOURCES="${MINSPEC_AGENT_SETTING_SOURCES-project,local}"

AGENT_CONTEXT_ARGS=()
if [[ -n "$MINSPEC_AGENT_SETTING_SOURCES" ]]; then
  AGENT_CONTEXT_ARGS=(--setting-sources "$MINSPEC_AGENT_SETTING_SOURCES")
fi

# ══ The agent's environment (#1203) ══════════════════════════════════════════
# `--setting-sources` above selects which settings FILES load. It cannot unset a
# variable that is already exported in the process environment, and one of those
# is actively harmful to a headless build:
#
#   CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=55
#
# It reaches a headless agent by inheritance — VS Code session ->
# drain-inbox.sh -> dispatch-issue.sh -> `claude -p` — and makes the run compact at
# 55% of its window instead of the default. That roughly halves the usable span
# between compactions, which is precisely the condition that turns an ordinary
# large file read into "the context refilled to the limit within 3 turns of the
# previous compact" and aborts the build.
#
# Verified on a LIVE dispatched agent, not inferred:
#   $ tr '\0' '\n' < /proc/<agent>/environ | grep AUTOCOMPACT
#   CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=55
# and run #1067 showed 8 compact summaries from 28 entries totalling ~60 KB — a
# volume that cannot fill a 200k window once, let alone eight times.
#
# This file used to answer that with an array, AGENT_ENV_SCRUB, that REMOVED that one
# variable from the launcher's own environment and passed every other one on. It is
# gone. A list of names to remove can only ever hold the names somebody thought of, and
# what it passed on included the launcher's own GitHub token: that token is installed by
# `export` into the launcher's shell (scripts/lib/gh-bot.sh), on the launcher's first
# write, along with every secret-named variable the operator's session carried.
#
# An agent started by these launchers reads text its launcher did not write, and most of
# them can read files or run the project's own build, so what it HOLDS matters more than
# what it is told. So the question is turned round: a name reaches the agent because it
# is LISTED, and for no other reason.
#
# ── This file is also the program that does it ───────────────────────────────
# SOURCED, it defines AGENT_CONTEXT_ARGS above and AGENT_LAUNCH_ENV below, and stops.
# RUN, it starts a command with an environment built from the list:
#
#   bash "$AGENT_LAUNCH_ENV" [--model-login <NAME>]... <command> [args...]
#       Replace this process with <command>, whose environment holds ONLY the names on
#       the list below that the launcher itself had. Prints nothing of its own.
#       --model-login adds ONE of the model's own login variables for this launch (see
#       "The model's own login" below). It takes a name this file knows, and no other.
#   bash "$AGENT_LAUNCH_ENV" --report
#       One line: which names would pass and which the launcher holds that would not.
#       Names only, never a value.
#   bash "$AGENT_LAUNCH_ENV" --names
#       The list, one name per line.
#
# EVERY start of the CLI under scripts/ is written that way, the `--help` probes included:
#
#     bash "$AGENT_LAUNCH_ENV" claude -p "$PROMPT" ...
#
# packages/minspec/tests/agent-launch-sites.test.ts reads every file under scripts/ and
# fails on a start of the CLI that does not go through here, so a new launcher cannot
# quietly go back to inheriting.
#
# ONE FILE, ON PURPOSE. The program could have been a file of its own. It is here because
# every launcher already sources this one, unguarded, so a launcher that can launch at all
# has the program: there is no second file to be missing, to be left out of what MinSpec
# ships beside review-branch.sh, or to fall outside the list of files that make up the
# reviewer's identity (ai-review-guard.js, PANEL_KEY_PATHS, which already holds this one).
#
# ── What is on the list, and why each ─────────────────────────────────────────
# What a headless run needs in order to start, find its login, reach the model, and run
# the project's build and commit the result. Each name is there for a reason given
# beside it. A name that is absent from the launcher is absent from the agent: nothing
# is invented, including the TERM and SHELL bash gives itself when it has none.
#
# ── What can never be on it ───────────────────────────────────────────────────
# GH_TOKEN, GITHUB_TOKEN, any token stamp, and any name ending in _API_KEY, _TOKEN or
# _SECRET. The list is checked against that rule on EVERY run, before anything is
# started: a list that has gained such a name starts nothing and says which name. The
# list is the control, so an edit to the list is how this would come back, and a rule
# that is only prose would not notice.
#
# ── The model's own login ─────────────────────────────────────────────────────
# One thing named like a credential has to reach the CLI or it cannot run at all: its
# own login. On an operator's machine that is a file under HOME (or CLAUDE_CONFIG_DIR),
# which is why those two are listed and why most launches need nothing more. In CI there
# is no such file: the login arrives in a variable.
#
# So a launch that runs there says so, at its own call site, and names which one:
#
#     bash "$AGENT_LAUNCH_ENV" --model-login CLAUDE_CODE_OAUTH_TOKEN claude -p ...
#
# The names it may ask for are AGENT_MODEL_LOGINS below, and nothing else: the option
# takes a name from that set, so it cannot be used to pass a GitHub token, and the set
# is itself checked on every run for a name that is GitHub's. It is an argument and not
# a variable, so nothing in the environment can ask on a launcher's behalf.
#
# What that leaves, and cannot be removed: an agent that can read files can read its own
# process's login, wherever the login is kept. Passing one login and not the other is
# also how a launch chooses which account pays (see review-branch.sh).
#
# ── The one switch ────────────────────────────────────────────────────────────
# MINSPEC_AGENT_ENV_SCRUB=0 was made to hand an agent the operator's autocompact
# threshold while debugging #1203, and under the array this replaced it meant "inherit
# everything". It now passes CLAUDE_AUTOCOMPACT_PCT_OVERRIDE and nothing else: the
# switch keeps the one use it was made for, and cannot widen the list. The override is a
# legitimate INTERACTIVE preference, and the operator's own sessions are untouched.
# ANTHROPIC_BASE_URL (the scrooge tee-proxy, a deliberate measurement instrument) and
# CLAUDE_EFFORT (a cost/behaviour choice, not a correctness bug) ARE on the list, as they
# were deliberately left alone before.
#
# ── What this does NOT do ─────────────────────────────────────────────────────
# It decides what the agent INHERITS. The agent is still a process of the launcher's
# user, so it can ask for whatever that user can ask for, and an environment cannot
# change that. Closing it takes a boundary between the two (another user, a container),
# not a shorter list.
#
# ── Where the program is, and why it cannot be pointed elsewhere ──────────────
# AGENT_LAUNCH_ENV is assigned HERE and nowhere else, unconditionally, to this file's own
# absolute path, taken from where this file IS and not from the directory a launcher
# happens to be in. So:
#   • a value that arrived in the launcher's environment is overwritten the moment the
#     launcher sources this file, before any launch can use it. No launcher reads it
#     from the environment, gives it a default, or assigns it again
#     (agent-launch-sites.test.ts holds all three).
#   • a launch made after `cd` into an agent's worktree still runs THIS copy. The
#     worktree is a checkout of the same repository and so holds a copy of this file
#     at the same relative path, which an earlier run on that branch could have edited;
#     an absolute path never finds it.
#   • the program cannot be missing while the launcher runs: it is the file the launcher
#     has just sourced, and every launcher sources it unguarded, so a missing file stops
#     the launcher on that line with bash's own error, before anything is fetched,
#     claimed or started.
# Run as `bash <path>`, so a checkout that lost the mode bit still works.
#
# Enforced by packages/minspec/tests/dispatch-env-allowlist.test.ts and
# agent-launch-sites.test.ts, which start the real launchers and read the environment
# their agent was given.
AGENT_LAUNCH_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-context.sh"

# Sourced: that is all. Everything below is the program, and runs only when this file is
# itself what bash was asked to run.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

set -euo pipefail

# Telling an exported variable from one bash made up for itself needs bash 4.4. An older
# bash cannot build the environment correctly, so it builds none: this stops here, in
# words, and never falls back to starting the command with everything inherited.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  echo "agent-context.sh: needs bash 4.4 or newer, and this is ${BASH_VERSION}. Nothing was started." >&2
  exit 1
fi

# The model's own login, by name. `--model-login` takes one of these and nothing else.
#   ANTHROPIC_API_KEY         a pay-as-you-go key
#   CLAUDE_CODE_OAUTH_TOKEN   the subscription login, where there is no file to hold it
AGENT_MODEL_LOGINS=(
  ANTHROPIC_API_KEY
  CLAUDE_CODE_OAUTH_TOKEN
)

AGENT_ENV_ALLOW=(
  # Finding programs and the user's own files. HOME is also where the CLI keeps its login.
  PATH
  HOME
  USER
  LOGNAME
  SHELL
  # The directory the launch happens in (the agent's worktree), temp files, the terminal.
  PWD
  TMPDIR
  TERM
  # Time zone and locale: dates in test output, and how text is sorted and decoded.
  TZ
  LANG
  LANGUAGE
  LC_ALL
  LC_CTYPE
  LC_COLLATE
  LC_MESSAGES
  LC_MONETARY
  LC_NUMERIC
  LC_TIME
  # Where per-user configuration, caches and state live when they are not under HOME.
  XDG_CONFIG_HOME
  XDG_CACHE_HOME
  XDG_DATA_HOME
  XDG_STATE_HOME
  # How this machine's binaries find their libraries, and how node is configured.
  LD_LIBRARY_PATH
  NODE_OPTIONS
  NODE_PATH
  # The route to the network and which certificate authorities to trust on it. A proxy
  # address that embeds a password is passed with it: keep the password in the proxy's
  # own configuration, not in the address.
  HTTP_PROXY
  HTTPS_PROXY
  NO_PROXY
  ALL_PROXY
  http_proxy
  https_proxy
  no_proxy
  all_proxy
  NODE_EXTRA_CA_CERTS
  SSL_CERT_FILE
  SSL_CERT_DIR
  # Who a local commit is recorded as, where that is set here rather than in git's files.
  GIT_AUTHOR_NAME
  GIT_AUTHOR_EMAIL
  GIT_COMMITTER_NAME
  GIT_COMMITTER_EMAIL
  # The CLI's own settings. None is a credential: where its files are, which endpoint it
  # calls (the measurement proxy), and how much effort it spends. The last two are the
  # ones #1203 left in place on purpose.
  CLAUDE_CONFIG_DIR
  ANTHROPIC_BASE_URL
  CLAUDE_EFFORT
)

_agent_env_die() {
  echo "agent-context.sh: $*" >&2
  exit 1
}

# Is this the name of something no agent may be handed? Case is ignored: the rule is
# about what a name says it holds.
_agent_env_credential_shaped() {
  local name="${1^^}"
  case "$name" in
    GH_TOKEN|GITHUB_TOKEN|*_TOKEN_STAMP) return 0 ;;
    *_API_KEY|*_TOKEN|*_SECRET) return 0 ;;
  esac
  return 1
}

# Is this the name of something of GitHub's? No launch is handed one of these under any
# option: the launcher does every GitHub write itself, after the agent has exited.
_agent_env_githubs() {
  local name="${1^^}"
  case "$name" in
    GH_*|GITHUB_*|*_TOKEN_STAMP|*GH_BOT*|*GH_APP*) return 0 ;;
  esac
  return 1
}

# Both lists are checked before either is used, every time.
_agent_env_check_list() {
  local name
  for name in "${AGENT_ENV_ALLOW[@]}"; do
    [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
      || _agent_env_die "the list holds something that is not a variable name. The list is names, never patterns. Nothing was started."
    if _agent_env_credential_shaped "$name"; then
      _agent_env_die "${name} is on the list, and it is named like a credential. No agent may be handed one, so nothing was started. Take it off the list in ${BASH_SOURCE[0]}."
    fi
  done
  for name in "${AGENT_MODEL_LOGINS[@]}"; do
    [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
      || _agent_env_die "the model logins hold something that is not a variable name. Nothing was started."
    if _agent_env_githubs "$name"; then
      _agent_env_die "${name} is among the model logins, and it is GitHub's. No agent may be handed one, so nothing was started. Take it out of AGENT_MODEL_LOGINS in ${BASH_SOURCE[0]}."
    fi
  done
}

# Is this one of the model logins `--model-login` may be asked for?
_agent_env_model_login() {
  local name
  for name in "${AGENT_MODEL_LOGINS[@]}"; do
    [[ "$name" == "${1-}" ]] && return 0
  done
  return 1
}

# AGENT_ENV_PASSING: the listed names this process was itself handed, in list order,
# then the model logins this launch asked for by name ($@).
# "Handed" means exported: a variable bash made up for itself is not the launcher's.
_agent_env_passing() {
  local name
  local -a listed=("${AGENT_ENV_ALLOW[@]}")
  if [[ "${MINSPEC_AGENT_ENV_SCRUB:-1}" == "0" ]]; then
    listed+=(CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)
  fi
  listed+=("$@")
  AGENT_ENV_PASSING=()
  for name in "${listed[@]}"; do
    if [[ -v "$name" && "${!name@a}" == *x* ]]; then
      AGENT_ENV_PASSING+=("$name")
    fi
  done
}

_agent_env_report() {
  local name passing="" withheld="" shown=0 more=0
  local -A passes=()
  for name in "${AGENT_ENV_PASSING[@]}"; do
    passes["$name"]=1
    passing+=" ${name}"
  done
  if [[ "${MINSPEC_AGENT_ENV_SCRUB:-1}" == "0" ]]; then
    passing+=" (MINSPEC_AGENT_ENV_SCRUB=0 adds CLAUDE_AUTOCOMPACT_PCT_OVERRIDE to the list, and nothing else)"
  fi
  if ! type compgen >/dev/null 2>&1; then
    echo "agent environment: an allowlist. passing ${#AGENT_ENV_PASSING[@]}:${passing}. What else the launcher holds could not be listed (this bash has no compgen); none of it is passed."
    return 0
  fi
  while IFS= read -r name; do
    # `_` and SHLVL are the shell's own bookkeeping, in every process there is.
    [[ -n "$name" && "$name" != "_" && "$name" != "SHLVL" ]] || continue
    [[ -z "${passes[$name]:-}" ]] || continue
    if (( shown < 60 )); then
      withheld+=" ${name}"
      shown=$(( shown + 1 ))
    else
      more=$(( more + 1 ))
    fi
  done < <(compgen -e | LC_ALL=C sort)
  (( more > 0 )) && withheld+=" and ${more} more"
  echo "agent environment: an allowlist. passing ${#AGENT_ENV_PASSING[@]}:${passing}; withholding $(( shown + more )):${withheld:- (nothing)}"
}

_agent_env_check_list

# `--model-login <NAME>`, any number of times, before the command. An argument and not a
# variable: only the call site can ask, and only for a name this file knows.
model_logins=()
while [[ "${1:-}" == "--model-login" ]]; do
  [[ $# -ge 2 ]] || _agent_env_die "usage: --model-login takes the name of a model login. Nothing was started."
  if ! _agent_env_model_login "$2"; then
    asked="(not a variable name)"
    [[ "$2" =~ ^[A-Za-z_][A-Za-z0-9_]{0,63}$ ]] && asked="$2"
    _agent_env_die "--model-login was asked for ${asked}, which is not a model login this program knows (it knows: ${AGENT_MODEL_LOGINS[*]}). Nothing was started."
  fi
  model_logins+=("$2")
  shift 2
done

case "${1:-}" in
  --names)
    [[ $# -eq 1 && ${#model_logins[@]} -eq 0 ]] || _agent_env_die "usage: --names takes no argument."
    printf '%s\n' "${AGENT_ENV_ALLOW[@]}"
    exit 0 ;;
  --report)
    [[ $# -eq 1 && ${#model_logins[@]} -eq 0 ]] || _agent_env_die "usage: --report takes no argument."
    _agent_env_passing
    _agent_env_report
    exit 0 ;;
  "")
    _agent_env_die "usage: bash agent-context.sh [--model-login <NAME>]... <command> [args...] | --report | --names. Nothing was started." ;;
  -*)
    _agent_env_die "usage: the command to start comes first, and '${1%%=*}' is an option. Nothing was started." ;;
  *=*)
    # `env` reads a leading NAME=VALUE word as an assignment, which would put a name the
    # list never saw into the agent's environment. Only the name is printed back.
    _agent_env_die "the command word begins '${1%%=*}=', which would be read as an assignment into the agent's environment and not as a command. Nothing was started." ;;
esac

_agent_env_passing ${model_logins[@]+"${model_logins[@]}"}
pairs=()
for name in "${AGENT_ENV_PASSING[@]}"; do
  pairs+=("${name}=${!name}")
done
exec env -i "${pairs[@]}" "$@"
