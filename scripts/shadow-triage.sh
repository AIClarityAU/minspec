#!/usr/bin/env bash
# shadow-triage.sh — run GLM (z.ai) alongside the live triage agent, compare both
#                    verdicts through the SAME deterministic gate, record the
#                    agreement, and DISCARD the shadow verdict. (#1338)
#
# Usage:
#   shadow-triage.sh record --issue N --repo OWNER/REPO \
#                           --prompt-file FILE --live-fields FILE
#   shadow-triage.sh report [--log FILE] [--json]
#
# Pure seams (exist so the properties below are testable as BEHAVIOUR, not by
# grepping this file for its own text — a guard asserted only by source-text search
# passes just as happily while inert, which this repo has been bitten by):
#   shadow-triage.sh --print-effective-env   the environment the shadow call runs under
#   shadow-triage.sh --print-argv            the exact argv the shadow call uses
#   shadow-triage.sh --resolve-model         the model id this run would use
#   shadow-triage.sh --repo-public           gh JSON on stdin; exit 0 iff public
#   shadow-triage.sh --fields-to-json        `key=value` lines on stdin → JSON
#   shadow-triage.sh --block-conformant      raw agent text on stdin; exit 0 iff conformant
#
# ══════════════════════════════════════════════════════════════════════════════
# SHADOW-ONLY, BY CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════════
# `record` COMPUTES a shadow verdict, LOGS it, and DISCARDS it. The structural
# guarantee is that this script has exactly one output channel — the JSONL file —
# and NOTHING else:
#
#   • stdout is empty on every path, so a caller cannot capture a verdict even by
#     accident (there is no `$(...)` a future edit could accidentally make meaningful);
#   • it holds no `gh` call, so it cannot apply a label, post a comment, or mint a
#     verdict record;
#   • `record` always exits 0, so its status cannot branch the caller either.
#
# Notes and failures go to STDERR, which is a human channel, not a data channel.
# Asserted behaviourally in packages/minspec/tests/shadow-triage-shadow-only.test.ts,
# which drives the REAL triage-inbox.sh with a stub agent whose shadow half emits the
# OPPOSITE verdict and checks the applied label still follows the live agent.
#
# ══════════════════════════════════════════════════════════════════════════════
# FAIL-SAFE (skip), NOT FAIL-CLOSED (block) — and why that does not contradict DR-066
# ══════════════════════════════════════════════════════════════════════════════
# DR-066 / constitution invariant 2 forbids swallowing an error on a LOAD-BEARING GATE
# signal: a required check must fail visibly, never best-effort, because a silently-
# passed gate is indistinguishable from a gate that ran and approved.
#
# This is not a gate. It is an INSTRUMENT sitting beside one. It authorises nothing,
# refuses nothing, and its output reaches no decision — so the two failure directions
# are not symmetric:
#
#   fail CLOSED here would mean a z.ai outage, timeout, quota exhaustion, DNS blip or
#   malformed response could BLOCK OR DELAY REAL TRIAGE. The instrument would then
#   have become a dependency of the pipeline it was built to measure, and a
#   third-party one at that — strictly worse than the #1234 jam it exists to help fix.
#
#   fail SAFE means the sample is simply missing. The cost is a smaller n, and the
#   report states n so a reader can see it.
#
# Hence: a hard `timeout` bound, and every error deliberately swallowed to stderr.
# The swallow is correct HERE precisely because nothing downstream reads this signal.
# If that ever changes — if a shadow verdict is ever allowed to influence anything —
# this rationale expires and DR-066 applies in full.

set -uo pipefail   # deliberately NOT -e: see the fail-safe rationale above.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="${SCRIPT_DIR}/roles"
DECIDE="${SCRIPT_DIR}/triage-decide.sh"
# shellcheck source=scripts/lib/shadow-triage.sh
source "${SCRIPT_DIR}/lib/shadow-triage.sh"

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SHADOW_LOG="${MINSPEC_SHADOW_TRIAGE_LOG:-${REPO_ROOT}/.minspec/shadow-triage.jsonl}"

note() { echo "  shadow-triage: $*" >&2; }

# ── shadow_resolve_model — the NETWORK half ──────────────────────────────────
# Echoes the model id to actually use. An explicit MINSPEC_SHADOW_TRIAGE_MODEL (or
# any value other than the `latest` sentinel) is returned untouched — no request.
#
# FAIL-SAFE, NOT FAIL-CLOSED, and deliberately so: this is a measurement instrument,
# not a gate (contrast DR-066, which forbids swallowing a load-bearing GATE signal).
# If the listing cannot be fetched or parsed, this exits non-zero and the CALLER
# skips the shadow run recording `model-resolve-failed` — it must never fall back to
# a guessed id, because a row labelled with the wrong model is worse than no row.
shadow_resolve_model() {
  local requested; requested="$(shadow_model)"
  if [[ "$requested" != "latest" ]]; then printf '%s' "$requested"; return 0; fi

  local key base body
  key="$(shadow_key)"; base="$(shadow_base_url)"
  [[ -z "$key" ]] && return 1
  body="$(timeout 20 curl -sS --fail-with-body \
      "${base%/}/v1/models" \
      -H "x-api-key: ${key}" \
      -H "anthropic-version: 2023-06-01" 2>/dev/null)" || return 1
  printf '%s' "$body" | shadow_pick_latest_model
}

# ── Pure seams ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --print-effective-env)
    # Run `env` UNDER the constructed prefix, so what is printed is the environment
    # the shadow agent would actually see — an observation, not a description of one.
    shadow_build_env "${MINSPEC_SHADOW_TRIAGE_KEY:-<unset>}" "$(shadow_base_url)" "$(shadow_model)"
    exec "${SHADOW_ENV_ARRAY[@]}" env
    ;;
  --print-argv)
    shadow_build_argv "$(shadow_model)" "${ROLES_DIR}/triage.md" "<prompt>"
    printf '%s\n' "${SHADOW_ARGV[@]}"
    exit 0
    ;;
  --resolve-model)
    # The model id the shadow call would use. A seam rather than an internal detail
    # because "an explicit id issues no request" is a BEHAVIOUR worth asserting, and
    # `shadow_resolve_model` lives here (it is network work) rather than in the pure lib.
    shadow_resolve_model; exit $? ;;
  --repo-public)     shadow_repo_public; exit $? ;;
  --fields-to-json)  shadow_fields_to_json; exit 0 ;;
  --block-conformant) shadow_block_conformant; exit $? ;;
esac

MODE="${1:-}"
shift || true

ISSUE="" REPO="" PROMPT_FILE="" LIVE_FIELDS_FILE="" REPORT_JSON=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)       ISSUE="$2"; shift 2 ;;
    --repo)        REPO="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --live-fields) LIVE_FIELDS_FILE="$2"; shift 2 ;;
    --log)         SHADOW_LOG="$2"; shift 2 ;;
    --json)        REPORT_JSON="--json"; shift ;;
    *) note "unknown argument: $1"; exit 0 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════════════
# report — aggregate the JSONL and evaluate #1338's rollback triggers
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "report" ]]; then
  # The aggregation is a pure TypeScript function (scripts/shadow-triage-report.ts)
  # tested against synthetic rows; this is only the entry point.
  REPORT_ARGS=(--log "$SHADOW_LOG")
  [[ -n "$REPORT_JSON" ]] && REPORT_ARGS+=("$REPORT_JSON")
  exec npx tsx "${SCRIPT_DIR}/shadow-triage-report.ts" "${REPORT_ARGS[@]}"
fi

if [[ "$MODE" != "record" ]]; then
  note "usage: shadow-triage.sh record --issue N --repo OWNER/REPO --prompt-file F --live-fields F | report [--log F] [--json]"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# record — the shadow run. Never delays, never blocks, never returns a verdict.
# ══════════════════════════════════════════════════════════════════════════════

# Every gate below is a SKIP, and each one says so once. Silence would be the wrong
# kind of quiet: the operator should be able to tell "inert because unconfigured"
# from "ran and agreed", and a note costs one line per issue.
if [[ "${MINSPEC_SHADOW_TRIAGE:-1}" == "0" ]]; then
  note "disabled (MINSPEC_SHADOW_TRIAGE=0) — skipped."
  exit 0
fi

KEY="$(shadow_key)"
if [[ -z "$KEY" ]]; then
  note "no z.ai key configured (MINSPEC_SHADOW_TRIAGE_KEY) — skipped; real triage is unaffected."
  exit 0
fi

if [[ -z "$ISSUE" || -z "$REPO" || -z "$PROMPT_FILE" || -z "$LIVE_FIELDS_FILE" ]]; then
  note "incomplete invocation — skipped."
  exit 0
fi
if [[ ! -r "$PROMPT_FILE" || ! -r "$LIVE_FIELDS_FILE" ]]; then
  note "cannot read the prompt / live-fields file — skipped."
  exit 0
fi

# Jurisdiction: PUBLIC REPOS ONLY. A private repo's issue bodies must never be sent
# to a third-party endpoint (scrooge DR-021 §5). Fails closed on any doubt — an
# unreachable `gh`, a malformed response and a private repo all skip.
VIS_JSON="$(gh repo view "$REPO" --json visibility,isPrivate 2>/dev/null)" || VIS_JSON=""
if ! printf '%s' "$VIS_JSON" | shadow_repo_public; then
  note "${REPO} is not confirmed public — skipped (public repos only)."
  exit 0
fi



# Resolve the model BEFORE anything else costs time. With the default `latest`
# sentinel this is one GET /v1/models; with an explicit id it is a no-op.
# On failure we SKIP rather than fall back: a row labelled with a guessed model id
# would corrupt the very measurement this harness exists to produce (#1338).
if ! MODEL="$(shadow_resolve_model)" || [[ -z "$MODEL" ]]; then
  note "could not resolve the latest z.ai model — skipped (no guessed fallback)."
  exit 0
fi
BASE_URL="$(shadow_base_url)"
TIMEOUT="$(shadow_timeout)"
PROMPT="$(cat "$PROMPT_FILE")"

shadow_build_env "$KEY" "$BASE_URL" "$MODEL"
shadow_build_argv "$MODEL" "${ROLES_DIR}/triage.md" "$PROMPT"

START_MS="$(date +%s%3N)"
SHADOW_OUT=""
SHADOW_ERR=""
# The hard bound. `timeout` guarantees this cannot become a latency dependency of
# real triage no matter how z.ai behaves — the wall-clock cost of the instrument is
# capped before any of its output is looked at.
SHADOW_OUT="$(timeout "$TIMEOUT" "${SHADOW_ENV_ARRAY[@]}" "${SHADOW_ARGV[@]}" 2>/dev/null)"
RC=$?
# `RC=$?` must be its own statement: inside `if ! cmd; then RC=$?`, `$?` is the status
# of the NEGATION (always 0), not of the command — so the timeout code would be lost.
if [[ $RC -ne 0 ]]; then
  if [[ $RC -eq 124 ]]; then SHADOW_ERR="timeout"; else SHADOW_ERR="exit-${RC}"; fi
fi
END_MS="$(date +%s%3N)"
LATENCY=$(( END_MS - START_MS ))

# An auth failure exits 0 while printing "Not logged in" / "Invalid API key" (measured),
# so a zero exit is NOT evidence a verdict was produced. Conformance is judged on the
# TEXT, and the two failure classes are kept apart in the row: `error` means no usable
# response came back at all (infrastructure), `conformant:false` means a response came
# back and did not match the schema (the metric #1338 actually asked for). Collapsing
# them would let a z.ai outage masquerade as a GLM schema-conformance failure.
CONFORMANT=false
if [[ -z "$SHADOW_ERR" ]]; then
  if printf '%s' "$SHADOW_OUT" | shadow_block_conformant; then
    CONFORMANT=true
  elif [[ -z "${SHADOW_OUT//[[:space:]]/}" ]]; then
    SHADOW_ERR="empty-response"
  fi
fi

# BOTH verdicts go through the SAME gate binary. Re-parsing the shadow block here
# would be a second parser of a format the gate already owns, which is exactly how a
# gate and its record start disagreeing (the reason triage-inbox.sh takes `--fields`
# rather than re-reading the agent's raw text).
SHADOW_FIELDS="$(printf '%s\n' "$SHADOW_OUT" | "$DECIDE" --fields 2>/dev/null)"
LIVE_JSON="$(shadow_fields_to_json < "$LIVE_FIELDS_FILE")"
SHADOW_JSON="$(printf '%s\n' "$SHADOW_FIELDS" | shadow_fields_to_json)"
[[ "$CONFORMANT" == "true" ]] || SHADOW_JSON='{}'
AGREE_JSON="$(shadow_agreement "$LIVE_JSON" "$SHADOW_JSON")"

ROW="$(jq -c -n \
  --arg    schema   "$SHADOW_TRIAGE_SCHEMA" \
  --argjson issue   "$ISSUE" \
  --arg    repo     "$REPO" \
  --arg    at       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg    model    "$MODEL" \
  --arg    baseUrl  "$BASE_URL" \
  --argjson conformant "$CONFORMANT" \
  --argjson latencyMs  "$LATENCY" \
  --arg    error    "$SHADOW_ERR" \
  --argjson live    "$LIVE_JSON" \
  --argjson shadow  "$SHADOW_JSON" \
  --argjson agree   "$AGREE_JSON" \
  '{schema:$schema, issue:$issue, repo:$repo, at:$at, model:$model, baseUrl:$baseUrl,
    conformant:$conformant, latencyMs:$latencyMs,
    error: (if $error == "" then null else $error end),
    live:$live, shadow:$shadow, agree:$agree}' 2>/dev/null)"

if [[ -z "$ROW" ]]; then
  note "could not render a row for #${ISSUE} — sample dropped (real triage unaffected)."
  exit 0
fi

mkdir -p "$(dirname "$SHADOW_LOG")" 2>/dev/null
if ! printf '%s\n' "$ROW" >> "$SHADOW_LOG" 2>/dev/null; then
  note "could not append to ${SHADOW_LOG} — sample dropped (real triage unaffected)."
  exit 0
fi

note "#${ISSUE} recorded (model=${MODEL}, ${LATENCY}ms) — measurement only, verdict discarded."
exit 0
