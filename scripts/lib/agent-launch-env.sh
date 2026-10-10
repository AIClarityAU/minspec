#!/usr/bin/env bash
# scripts/lib/agent-launch-env.sh - start an agent with an environment built from a list.
#
#   bash scripts/lib/agent-launch-env.sh <command> [args...]
#       Replace this process with <command>, whose environment holds ONLY the names on
#       the list below that the launcher itself had. Prints nothing of its own.
#   bash scripts/lib/agent-launch-env.sh --report
#       One line: which names would pass and which the launcher holds that would not.
#       Names only, never a value.
#   bash scripts/lib/agent-launch-env.sh --names
#       The list, one name per line.
#
# Used at every launch in scripts/dispatch-issue.sh and scripts/triage-inbox.sh:
#
#     bash "$AGENT_LAUNCH_ENV" claude -p "$PROMPT" ...
#
# ── Why this exists (#1203) ───────────────────────────────────────────────────
# Those launches used to sit behind AGENT_ENV_SCRUB (scripts/lib/agent-context.sh),
# which builds the agent's environment by REMOVING one named variable from the
# launcher's own. A list of names to remove can only ever hold the names somebody
# thought of, and everything else is passed on. The launcher's GitHub token is installed
# by `export` into that same shell (scripts/lib/gh-bot.sh), on the launcher's first
# write, so it was passed on too, along with every secret-named variable the operator's
# session carried.
#
# An agent started here reads text its launcher did not write and runs the project's own
# build, so what it holds matters more than what it is told. This turns the question
# round: a name reaches the agent because it is LISTED, and for no other reason.
#
# ── What is on the list, and why each ─────────────────────────────────────────
# What a headless run needs in order to start, find its login, reach the model, and run
# the project's build and commit the result. Each name is there for a reason given
# beside it. A name that is absent from the launcher is absent from the agent: nothing
# is invented, including the TERM and SHELL bash gives itself when it has none.
#
# The CLI's login is not on it and does not need to be. The subscription login is a file
# under HOME (or CLAUDE_CONFIG_DIR), which is why those two are listed. A launcher whose
# CLI authenticates from an environment variable instead cannot use this path as it
# stands: nothing shaped like a credential passes, by rule (see below), and that is a
# decision to revisit deliberately rather than a variable to add.
#
# ── What can never be on it ───────────────────────────────────────────────────
# GH_TOKEN, GITHUB_TOKEN, any token stamp, and any name ending in _API_KEY, _TOKEN or
# _SECRET. The list is checked against that rule on EVERY run, before anything is
# started: a list that has gained such a name starts nothing and says which name. The
# list is the control, so an edit to the list is how this would come back, and a rule
# that is only prose would not notice.
#
# ── The one switch ────────────────────────────────────────────────────────────
# MINSPEC_AGENT_ENV_SCRUB=0 was made to hand an agent the operator's autocompact
# threshold while debugging #1203. For the launchers that still use AGENT_ENV_SCRUB it
# means "inherit everything". HERE it passes CLAUDE_AUTOCOMPACT_PCT_OVERRIDE and nothing
# else: the switch keeps the one use it was made for, and cannot widen the list.
#
# ── What this does NOT do ─────────────────────────────────────────────────────
# It decides what the agent INHERITS. The agent is still a process of the launcher's
# user, so it can ask for whatever that user can ask for, and an environment cannot
# change that. Closing it takes a boundary between the two (another user, a container),
# not a shorter list.
#
# Executed, never sourced, and run as `bash <path>` so a checkout that lost the mode bit
# still works. A launch line that names a missing or empty path starts nothing: bash
# fails on it before `claude` is ever reached.
#
# Enforced by packages/minspec/tests/dispatch-env-allowlist.test.ts, which starts the
# real launchers and reads the environment their agent was given.

set -euo pipefail

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
  echo "agent-launch-env: $*" >&2
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

# The list is checked before it is used, every time.
_agent_env_check_list() {
  local name
  for name in "${AGENT_ENV_ALLOW[@]}"; do
    [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
      || _agent_env_die "the list holds something that is not a variable name. The list is names, never patterns. Nothing was started."
    if _agent_env_credential_shaped "$name"; then
      _agent_env_die "${name} is on the list, and it is named like a credential. No agent may be handed one, so nothing was started. Take it off the list in ${BASH_SOURCE[0]}."
    fi
  done
}

# AGENT_ENV_PASSING: the listed names this process was itself handed, in list order.
# "Handed" means exported: a variable bash made up for itself is not the launcher's.
_agent_env_passing() {
  local name
  local -a listed=("${AGENT_ENV_ALLOW[@]}")
  if [[ "${MINSPEC_AGENT_ENV_SCRUB:-1}" == "0" ]]; then
    listed+=(CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)
  fi
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

case "${1:-}" in
  --names)
    [[ $# -eq 1 ]] || _agent_env_die "usage: --names takes no argument."
    printf '%s\n' "${AGENT_ENV_ALLOW[@]}"
    exit 0 ;;
  --report)
    [[ $# -eq 1 ]] || _agent_env_die "usage: --report takes no argument."
    _agent_env_passing
    _agent_env_report
    exit 0 ;;
  "")
    _agent_env_die "usage: agent-launch-env.sh <command> [args...] | --report | --names. Nothing was started." ;;
  -*)
    _agent_env_die "usage: the command to start comes first, and '${1%%=*}' is an option. Nothing was started." ;;
  *=*)
    # `env` reads a leading NAME=VALUE word as an assignment, which would put a name the
    # list never saw into the agent's environment. Only the name is printed back.
    _agent_env_die "the command word begins '${1%%=*}=', which would be read as an assignment into the agent's environment and not as a command. Nothing was started." ;;
esac

_agent_env_passing
pairs=()
for name in "${AGENT_ENV_PASSING[@]}"; do
  pairs+=("${name}=${!name}")
done
exec env -i "${pairs[@]}" "$@"
