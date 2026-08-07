#!/usr/bin/env bash
# scripts/lib/shadow-triage.sh — pure seams for the GLM shadow-triage instrument (#1338).
#
# This library holds ONLY pure functions: environment construction, argv construction,
# repo-visibility policy, and field/agreement projection. Nothing here runs an agent,
# writes a file, or touches the network. `scripts/shadow-triage.sh` is the impure
# runner that composes them; the split exists so the security property below is
# testable as BEHAVIOUR rather than asserted by grepping a script for its own text.
#
# ══════════════════════════════════════════════════════════════════════════════
# WHY THIS EXISTS
# ══════════════════════════════════════════════════════════════════════════════
# The drain loop and the required `ai-review` merge gate draw on ONE Anthropic
# subscription quota, so the queue jams when that quota runs out (#1234). Moving the
# cheap mechanical triage role onto a second provider relieves it. But GLM's fitness
# for OUR task shape is unmeasured — every number in #1338's memo is a proxy for
# general capability, none of them measures "classifies our issues into our tiers"
# or "emits our verdict block without drifting". Per this repo's evidence discipline,
# plausible inference is not observation, so the honest verdict today is INSUFFICIENT
# EVIDENCE, and the correct next step is an instrument, not a switch.
#
# So: run GLM alongside the live triage agent on the same issue, push BOTH outputs
# through the SAME deterministic gate (`triage-decide.sh`), record the agreement, and
# discard the shadow verdict. Nothing GLM says may reach a label, a verdict record, a
# comment, or a dispatch.
#
# ══════════════════════════════════════════════════════════════════════════════
# THE SECURITY PROPERTY — credential isolation (the single most important thing here)
# ══════════════════════════════════════════════════════════════════════════════
# The shadow call points ANTHROPIC_BASE_URL at z.ai. If an Anthropic credential is
# reachable at that moment, `claude -p` sends the founder's token TO A THIRD-PARTY
# SERVER — a credential exfiltration, and far worse than any quota jam. There are TWO
# distinct reachable credentials, and scrubbing the environment only closes one:
#
#   1. ENVIRONMENT — CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
#      inherited from the operator's shell. Closed by `env -u` in shadow_build_env.
#
#   2. THE ON-DISK CREDENTIAL STORE — `~/.claude/.credentials.json` (present on the
#      operator box: 827 bytes, mode 600) plus the OS keychain. `env -u` CANNOT touch
#      these, and an unauthenticated `claude -p` falls straight back to them.
#
# Measured on this box, not inferred — three probes against an unreachable base URL:
#
#   claude -p --bare  (no key in env)   → "Not logged in · Please run /login"
#   claude -p --bare  (fake key in env) → "Invalid API key · Fix external API key"
#   claude -p         (no key in env)   → answered normally
#
# The third probe is the hazard, demonstrated: with no `--bare`, the CLI silently
# used the stored subscription credential. `--bare` is therefore LOAD-BEARING, not a
# tidy-up — its documented contract (`claude --help`) is "Anthropic auth is strictly
# ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never
# read)". Removing `--bare` from shadow_build_argv reopens the exfiltration path even
# with every `env -u` below intact. Both halves are asserted in
# packages/minspec/tests/shadow-triage-isolation.test.ts.
#
# Related standing rule this honours: never route Claude subscription auth through a
# third-party proxy. Using z.ai with z.ai's OWN key is the sanctioned path; inheriting
# Anthropic auth is not.
#
# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION (all optional; the instrument is INERT until the key is set)
# ══════════════════════════════════════════════════════════════════════════════
#   MINSPEC_SHADOW_TRIAGE_KEY       z.ai API key. ABSENT → the shadow step is skipped
#                                   with a one-line note and real triage is untouched.
#   MINSPEC_SHADOW_TRIAGE           set to 0 to hard-disable even with a key present.
#   MINSPEC_SHADOW_TRIAGE_MODEL     pinned model id (default below).
#   MINSPEC_SHADOW_TRIAGE_BASE_URL  z.ai Anthropic-compatible endpoint.
#   MINSPEC_SHADOW_TRIAGE_TIMEOUT   hard wall-clock bound, seconds (default 120).
#   MINSPEC_SHADOW_TRIAGE_LOG       JSONL path (default .minspec/shadow-triage.jsonl).

# shellcheck shell=bash

SHADOW_TRIAGE_SCHEMA="minspec-shadow-triage/1"

# ── Model selection: resolve "latest", never pin a version ───────────────────
# "z.ai" is not a model, and it publishes NO floating alias — verified 2026-08-07
# against a live key: GET /v1/models returns only concrete ids (glm-4.5, glm-4.5-air,
# glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1, glm-5.2), with no `latest` entry.
# So "always use their latest" cannot be a pin; it must be RESOLVED per run.
#
# The default is therefore the sentinel `latest`, resolved by `shadow_resolve_model`
# from the newest `created_at` in that listing. An explicit
# MINSPEC_SHADOW_TRIAGE_MODEL still wins, so a specific version can be forced.
#
# Measurement integrity is preserved NOT by pinning but by recording the RESOLVED id
# on every row (#1338): the report groups by model, so a mid-pilot version change
# splits the sample rather than silently averaging two models together. A log that
# does not say which model produced a verdict cannot be re-read later.
#
# LITE VARIANTS ARE EXCLUDED. Newest-by-date would eventually select a smaller
# sibling — a future `glm-5.3-air` or `-turbo` would be newest yet weaker, silently
# DOWNGRADING the pilot while the log still said "latest". Suffixes in
# SHADOW_TRIAGE_LITE_RE are skipped unless named explicitly.
SHADOW_TRIAGE_DEFAULT_MODEL="latest"
# Trailing lite/speed-tier suffixes. Anchored at end so `glm-5-turbo` matches but a
# hypothetical `glm-turbo-pro` does not.
SHADOW_TRIAGE_LITE_RE='-(air|turbo|flash|mini|lite)$'
SHADOW_TRIAGE_DEFAULT_BASE_URL="https://api.z.ai/api/anthropic"
SHADOW_TRIAGE_DEFAULT_TIMEOUT="120"

shadow_key()      { printf '%s' "${MINSPEC_SHADOW_TRIAGE_KEY:-}"; }
shadow_model()    { printf '%s' "${MINSPEC_SHADOW_TRIAGE_MODEL:-$SHADOW_TRIAGE_DEFAULT_MODEL}"; }

# ── shadow_pick_latest_model — the PURE half of "latest" resolution ───────────
# A /v1/models JSON body on stdin → the newest non-lite model id on stdout, or
# nothing (exit 1) if none can be chosen. Pure: no network, no env, no clock, so
# the selection rule is testable against fixtures without a z.ai account.
#
# "Newest" is `created_at`, NOT list order and NOT a version-string sort: 'glm-5.2'
# vs 'glm-5-turbo' does not order correctly as text, and a lexical compare would
# rank 'glm-4.7' above 'glm-5' (4>... no: '4'<'5' — but 'glm-5.1' vs 'glm-5.2' only
# works by luck, and breaks entirely at a two-digit minor like 'glm-5.10').
# created_at is the vendor's own statement of recency, so it is what we read.
shadow_pick_latest_model() {
  python3 -c '
import json, re, sys
LITE = re.compile(sys.argv[1])
try:
    body = json.load(sys.stdin)
except Exception:
    sys.exit(1)
rows = body.get("data")
if not isinstance(rows, list):
    sys.exit(1)
best = None
for m in rows:
    if not isinstance(m, dict):
        continue
    mid, created = m.get("id"), m.get("created_at")
    if not isinstance(mid, str) or not isinstance(created, str) or not mid:
        continue          # a malformed row is skipped, never guessed at
    if LITE.search(mid):
        continue          # lite sibling: newer is not better
    if best is None or created > best[0]:
        best = (created, mid)
if best is None:
    sys.exit(1)
print(best[1])
' "$SHADOW_TRIAGE_LITE_RE"
}

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
shadow_base_url() { printf '%s' "${MINSPEC_SHADOW_TRIAGE_BASE_URL:-$SHADOW_TRIAGE_DEFAULT_BASE_URL}"; }
shadow_timeout()  { printf '%s' "${MINSPEC_SHADOW_TRIAGE_TIMEOUT:-$SHADOW_TRIAGE_DEFAULT_TIMEOUT}"; }

# ── shadow_build_env — the credential-isolation seam ──────────────────────────
# Populates SHADOW_ENV_ARRAY with an `env` prefix that (a) removes every Anthropic
# credential the process may have inherited and (b) supplies the z.ai key in its place.
#
# Ordering note, verified rather than assumed: GNU env applies its `-u` options BEFORE
# the NAME=VALUE operands, so `env -u X X=v` yields X=v. The `-u` on a var we then set
# is therefore not redundant — it is the FAIL-SAFE. If a future edit drops the
# assignment, the variable is absent (the run fails to authenticate) rather than
# inherited (the run ships an Anthropic token to z.ai). Absent beats inherited.
#
# Both key vars are set to the SAME z.ai key on purpose: the z.ai docs use
# ANTHROPIC_AUTH_TOKEN (Bearer), while `--bare`'s documented contract reads
# ANTHROPIC_API_KEY (x-api-key). Setting both covers either header convention, and
# since both carry the z.ai key neither can leak an Anthropic credential.
shadow_build_env() {
  local key="$1" base_url="$2" model="$3"
  SHADOW_ENV_ARRAY=(
    env
    # (1) Anthropic credentials — the exfiltration payload. Never inherited.
    -u CLAUDE_CODE_OAUTH_TOKEN
    -u ANTHROPIC_API_KEY
    -u ANTHROPIC_AUTH_TOKEN
    # (2) A header bag can carry an Authorization header, so it is a credential too.
    -u ANTHROPIC_CUSTOM_HEADERS
    # (3) Other providers' credentials — same exfiltration class, different vendor.
    -u AWS_BEARER_TOKEN_BEDROCK
    -u GOOGLE_APPLICATION_CREDENTIALS
    -u ANTHROPIC_VERTEX_PROJECT_ID
    # (4) Provider switches. Not credentials, but either one makes the CLI IGNORE
    #     ANTHROPIC_BASE_URL, so the run would quietly measure a different provider
    #     and log it as GLM — a false row is worse than a missing one.
    -u CLAUDE_CODE_USE_BEDROCK
    -u CLAUDE_CODE_USE_VERTEX
    # (5) Inherited autocompact override (#1203) — same reason agent-context.sh
    #     scrubs it for the live agent; a headless one-shot has no use for it.
    -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
    # ── and now, the only credential this call may hold ──
    "ANTHROPIC_BASE_URL=${base_url}"
    "ANTHROPIC_API_KEY=${key}"
    "ANTHROPIC_AUTH_TOKEN=${key}"
    # Pin the model on the ALIAS-RESOLUTION path as well as on the command line, so
    # no resolution route inside the CLI can reach a different GLM than the one the
    # row will claim was used.
    "ANTHROPIC_DEFAULT_OPUS_MODEL=${model}"
    "ANTHROPIC_DEFAULT_SONNET_MODEL=${model}"
    "ANTHROPIC_DEFAULT_HAIKU_MODEL=${model}"
    # Keep incidental traffic off a third-party endpoint.
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
  )
}

# ── shadow_build_argv — the invocation seam ───────────────────────────────────
# Populates SHADOW_ARGV. Deliberately mirrors the LIVE triage call in
# triage-inbox.sh (same prompt text, same `--system-prompt-file`, same `--tools ""`,
# same `--output-format text`) — a shadow run that differs in task shape measures a
# different task and its agreement number would be meaningless.
#
# Two flags differ from the live call, and both are load-bearing:
#   --bare   the credential firewall documented at the top of this file.
#   --model  the pin; without it the endpoint chooses, and #1338's whole objection
#            is that an unpinned endpoint is a moving target.
shadow_build_argv() {
  local model="$1" role_file="$2" prompt="$3"
  SHADOW_ARGV=(
    claude -p "$prompt"
    --bare
    --model "$model"
    --system-prompt-file "$role_file"
    --tools ""
    --output-format text
  )
}

# ── shadow_repo_public — jurisdiction policy (pure predicate) ─────────────────
# Reads `gh repo view --json visibility,isPrivate` output on stdin.
# Exit 0 ONLY when both witnesses independently say public.
#
# FAILS CLOSED: a missing field, malformed JSON, an empty body, or any disagreement
# between the two witnesses reads as "not public" and the shadow step is skipped.
# This is a jurisdiction constraint (scrooge DR-021 §5) — issue bodies from a PRIVATE
# repo must not be sent to a third-party endpoint at all — and for a constraint of
# that shape "I could not tell" and "it is private" have to land in the same place.
# minspec and sealbox are public; scroogellm is private and out of bounds.
shadow_repo_public() {
  local json vis priv
  json="$(cat)"
  [[ -z "$json" ]] && return 1
  vis="$(printf '%s' "$json" | jq -r '.visibility? // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  priv="$(printf '%s' "$json" | jq -r 'if (type == "object" and has("isPrivate")) then (.isPrivate | tostring) else empty end' 2>/dev/null)"
  [[ "$vis" == "public" && "$priv" == "false" ]]
}

# ── shadow_fields_to_json — projection of the gate's own output ───────────────
# `triage-decide.sh --fields` emits `key=value` lines. This turns them into a JSON
# object for the log row. Both the live and the shadow verdict pass through the SAME
# gate binary and then this SAME projection, so the two sides of every comparison are
# normalised identically — the record can never disagree with the gate because there
# is only one parser of the verdict format (the recurring failure mode this repo has
# already hit: a gate and its record drifting through two parsers).
shadow_fields_to_json() {
  jq -R -s -c '
    split("\n")
    | map(select(length > 0) | capture("^(?<k>[a-z_]+)=(?<v>.*)$"))
    | map({(.k): .v})
    | add // {}
  ' 2>/dev/null || printf '{}'
}

# ── shadow_agreement — per-field agreement booleans (pure) ────────────────────
# $1 live JSON, $2 shadow JSON. Emits {label,role,hold,tier,human_only,all}.
# A field agrees only when BOTH sides carry a non-null value AND they match, so an
# absent shadow verdict scores as disagreement rather than as vacuous agreement.
shadow_agreement() {
  jq -c -n --argjson l "$1" --argjson s "$2" '
    (["label","role","hold","tier","human_only"]
      | map({ (.): (($l[.] // null) != null and ($l[.] // null) == ($s[.] // null)) })
      | add) as $f
    | $f + { all: ($f | to_entries | map(.value) | all) }
  ' 2>/dev/null || printf '{"label":false,"role":false,"hold":false,"tier":false,"human_only":false,"all":false}'
}

# ── shadow_block_conformant — verdict-block schema conformance (pure) ─────────
# #1338's second metric. Reads raw agent text on stdin; exit 0 when the output
# carries a well-formed verdict block: the BEGIN/END sentinels, and all four
# load-bearing field names inside them. `rationale` is deliberately NOT required —
# it is prose the gate discards, so demanding it would inflate the malformed rate
# with a defect that has no consequence.
shadow_block_conformant() {
  local raw block f
  raw="$(cat)"
  block="$(printf '%s\n' "$raw" | sed -n '/TRIAGE_VERDICT_BEGIN/,/TRIAGE_VERDICT_END/p')"
  [[ -z "$block" ]] && return 1
  printf '%s\n' "$block" | grep -q 'TRIAGE_VERDICT_END' || return 1
  for f in decision role tier human_only; do
    printf '%s\n' "$block" | grep -qiE "^[[:space:]]*${f}[[:space:]]*:" || return 1
  done
  return 0
}
