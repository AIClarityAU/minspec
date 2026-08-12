#!/usr/bin/env bash
# scripts/lib/shadow-triage.sh — pure seams for the GLM shadow-triage instrument (#1338).
#
# This library holds ONLY pure functions: request construction, response parsing,
# model selection, repo-visibility policy, and field/agreement projection. Nothing
# here writes a log row or decides anything; `shadow_http` / `shadow_resolve_model`
# are the only functions that touch the network. `scripts/shadow-triage.sh` is the
# impure runner that composes them; the split exists so the security property below is
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
# THE TRANSPORT: a direct HTTPS request, NOT `claude -p` — and why that is SAFER
# ══════════════════════════════════════════════════════════════════════════════
# This instrument used to shell out to `claude -p` with ANTHROPIC_BASE_URL pointed at
# z.ai. It cannot: measured on the operator box 2026-08-07, all three routes are dead.
#
#   `--bare` + ANTHROPIC_API_KEY=<z.ai key>   → "Invalid API key · Fix external API key"
#   `--bare` + apiKeyHelper via --settings    → same
#   no `--bare`, Anthropic env scrubbed       → IGNORED ANTHROPIC_BASE_URL and hit
#                                               api.anthropic.com on the STORED
#                                               credential, erroring "issue with the
#                                               selected model (glm-5.2)"
#
# The likely cause of the rejection is shape: a z.ai key is 49 characters and does not
# carry Anthropic's `sk-ant-` prefix. Whatever the cause, the CLI is not a usable
# client for this endpoint, so the transport is now a direct POST to /v1/messages.
#
# READ THE REMOVAL OF THE OLD SCRUB AS A STRENGTHENING, NOT A WEAKENING. The previous
# apparatus — `--bare`, plus a long `env -u` list — existed for exactly one reason: a
# CLI resolves credentials BY ITSELF. It reads ~/.claude/.credentials.json, the OS
# keychain, ANTHROPIC_AUTH_TOKEN, a header bag, Bedrock/Vertex switches; the scrub was
# a running attempt to enumerate and close every one of those doors, and it could only
# ever be as complete as the enumeration (route 3 above is that enumeration failing in
# practice — the CLI ignored the base URL and used the stored token anyway).
#
# `curl` resolves nothing. It sends the bytes it is given. This request carries EXACTLY
# ONE credential header, `x-api-key`, holding the z.ai key, and there is no code path by
# which an Anthropic credential could join it: not from the environment (curl does not
# read ANTHROPIC_*), not from disk (--disable ignores ~/.curlrc), not from a redirect
# (--location is deliberately never passed, so the header cannot be replayed to another
# host). The old exfiltration hazard is not mitigated here — it is structurally absent.
#
# A second, quieter gain: the shadow path no longer runs `claude` at all, so it cannot
# consume the very Anthropic quota (#1234) this instrument exists to help relieve.
#
# Related standing rule this honours: never route Claude subscription auth through a
# third-party proxy. Using z.ai with z.ai's OWN key is the sanctioned path.
#
# ══════════════════════════════════════════════════════════════════════════════
# THE KEY NEVER ENTERS ARGV
# ══════════════════════════════════════════════════════════════════════════════
# `/proc/<pid>/cmdline` is world-readable, so `-H "x-api-key: $KEY"` publishes the key
# to every local user for the life of the request. That is a real finding, not a
# hypothetical: the security reviewer flagged exactly that shape as `low` on the
# model-resolution change that first introduced a curl call here.
#
# So every request is issued as `curl --config -` with the headers written to STDIN by
# bash's `printf` BUILTIN — a builtin forks no process and therefore has no cmdline,
# and the pipeline's subshell inherits the parent's unchanged cmdline. Verified by
# observation on this box: with a sentinel key fed this way, /proc/<curl>/cmdline read
# `curl --disable --silent --show-error … <url>` and the sentinel appeared in no
# process's cmdline at all. Asserted in shadow-triage-isolation.test.ts against BOTH a
# stub curl (which records the argv it really received) and a live curl read out of
# /proc while a request is in flight.
#
# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION (all optional; the instrument is INERT until the key is set)
# ══════════════════════════════════════════════════════════════════════════════
#   MINSPEC_SHADOW_TRIAGE_KEY         z.ai API key. ABSENT → the shadow step is skipped
#                                     with a one-line note and real triage is untouched.
#   MINSPEC_SHADOW_TRIAGE             set to 0 to hard-disable even with a key present.
#   MINSPEC_SHADOW_TRIAGE_MODEL       explicit model id; overrides `latest` resolution.
#   MINSPEC_SHADOW_TRIAGE_BASE_URL    z.ai Anthropic-compatible endpoint.
#   MINSPEC_SHADOW_TRIAGE_TIMEOUT     hard wall-clock bound, seconds (default 120).
#   MINSPEC_SHADOW_TRIAGE_MAX_TOKENS  response cap (default 1024 — see below).
#   MINSPEC_SHADOW_TRIAGE_LOG         JSONL path (default .minspec/shadow-triage.jsonl).

# shellcheck shell=bash

SHADOW_TRIAGE_SCHEMA="minspec-shadow-triage/1"

# ── Model selection: resolve "latest", never pin a version ───────────────────
# "z.ai" is not a model, and it publishes NO floating alias. Captured from the live
# endpoint on 2026-08-07 (`GET /v1/models`): only concrete ids come back — glm-4.5,
# glm-4.5-air, glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1, glm-5.2 — with no
# `latest` entry. That captured response is committed verbatim as this resolver's
# fixture in shadow-triage-isolation.test.ts, alongside the command that re-captures
# it, so this paragraph is checkable rather than merely asserted.
#
# So "always use their latest" cannot be a pin; it must be RESOLVED per run. The
# default is therefore the sentinel `latest`, resolved by `shadow_resolve_model` from
# the newest `created_at` in that listing. An explicit MINSPEC_SHADOW_TRIAGE_MODEL
# still wins, so a specific version can be forced.
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

# ── max_tokens: 1024, chosen against a measurement ───────────────────────────
# MEASURED 2026-08-07 against the live endpoint, with the real scripts/roles/triage.md
# as `system` and a one-line issue as the user turn: the whole verdict block cost
# 51 output tokens (1826 in). 1024 is ~20x that, and both bounds are deliberate:
#
#   TOO TIGHT would corrupt the metric this instrument exists to produce. Conformance
#   tolerates prose around the block (`shadow_block_conformant` scans for the
#   sentinels), so a model that thinks aloud for a paragraph first would be cut off
#   MID-BLOCK and recorded as `conformant:false` — a transport artefact scored as a
#   GLM schema failure, feeding straight into #1338's 2% malformed-rate rollback
#   trigger. A cap tuned to the happy path measures the cap, not the model.
#
#   TOO LOOSE (4k, 8k) buys nothing: the gate discards every token outside the block,
#   so the extra budget can only fund an essay nobody reads, on a third party's quota,
#   on every triaged issue.
#
# And if 1024 is ever wrong, the log SAYS so rather than absorbing it: a response with
# `stop_reason: "max_tokens"` that failed conformance is recorded as the typed error
# `truncated`, which the report counts as an endpoint error and therefore excludes
# from the malformed rate. Override with MINSPEC_SHADOW_TRIAGE_MAX_TOKENS.
SHADOW_TRIAGE_DEFAULT_MAX_TOKENS="1024"

shadow_key()        { printf '%s' "${MINSPEC_SHADOW_TRIAGE_KEY:-}"; }
shadow_model()      { printf '%s' "${MINSPEC_SHADOW_TRIAGE_MODEL:-$SHADOW_TRIAGE_DEFAULT_MODEL}"; }
shadow_base_url()   { printf '%s' "${MINSPEC_SHADOW_TRIAGE_BASE_URL:-$SHADOW_TRIAGE_DEFAULT_BASE_URL}"; }
shadow_timeout()    { printf '%s' "${MINSPEC_SHADOW_TRIAGE_TIMEOUT:-$SHADOW_TRIAGE_DEFAULT_TIMEOUT}"; }
shadow_max_tokens() { printf '%s' "${MINSPEC_SHADOW_TRIAGE_MAX_TOKENS:-$SHADOW_TRIAGE_DEFAULT_MAX_TOKENS}"; }

# ══════════════════════════════════════════════════════════════════════════════
# TRANSPORT SEAMS
# ══════════════════════════════════════════════════════════════════════════════

# ── shadow_curl_config — the ONLY place the credential appears ────────────────
# Emits curl's config-file syntax on stdout, to be piped into `curl --config -`.
#
# The key is read from the environment HERE rather than passed in by a caller, so no
# call site ever needs to hold it: there is exactly one expression in this codebase
# that names the key, and it writes to a pipe. `printf` is a bash BUILTIN — it forks
# nothing, so this never becomes a process with a cmdline for `ps` to show.
#
# NEVER add a debug seam that prints this. The absence of one is the point.
shadow_curl_config() {
  printf 'header = "x-api-key: %s"\n' "$(shadow_key)"
  printf 'header = "anthropic-version: 2023-06-01"\n'
  printf 'header = "content-type: application/json"\n'
}

# ── shadow_curl_argv — the request line, provably credential-free ─────────────
# Populates SHADOW_CURL_ARGV for `<url> <out_file> <timeout> [post_body_file]`.
# Nothing secret is placed here, and that is asserted behaviourally, not in a comment.
#
# Flags, each load-bearing:
#   --disable          ignore ~/.curlrc, which could otherwise inject an Authorization
#                      header or turn on redirect-following behind our back. curl
#                      requires it to be the first argument.
#   --config -         headers arrive on STDIN (see shadow_curl_config).
#   --output FILE      the body goes to a file, so stdout carries ONLY the status code
#                      and one can never be mistaken for the other by a parse.
#   --write-out        the HTTP status, needed to type an error the body does not name.
#   --max-time         curl's own bound, inside the runner's `timeout` wrapper.
#   (no --location)    redirects are NOT followed. Following one would replay the
#                      x-api-key header to whatever host the redirect named.
shadow_curl_argv() {
  local url="$1" out_file="$2" timeout_s="$3" post_body_file="${4:-}"
  SHADOW_CURL_ARGV=(
    curl
    --disable
    --silent --show-error
    --max-time "$timeout_s"
    --output "$out_file"
    --write-out '%{http_code}'
    --config -
  )
  if [[ -n "$post_body_file" ]]; then
    SHADOW_CURL_ARGV+=(--request POST --data-binary "@${post_body_file}")
  fi
  SHADOW_CURL_ARGV+=("$url")
}

# ── shadow_http — issue one request; echo the HTTP status ─────────────────────
# The single place the config pipe is wired to curl. Returns the exit status of the
# request; curl's stderr is discarded so a vendor diagnostic can never carry request
# detail into a log.
#
# Belt AND braces on the clock: curl's own `--max-time` runs INSIDE an external
# `timeout` of the same bound, because a curl that wedges before its timer is armed
# would otherwise have no cap at all — and an unbounded instrument becomes a latency
# dependency of the real triage it is only supposed to watch. Both routes surface as
# a single `timeout` reason to a reader of the log (124 from timeout, 28 from curl).
shadow_http() {
  local url="$1" out_file="$2" timeout_s="$3" post_body_file="${4:-}"
  shadow_curl_argv "$url" "$out_file" "$timeout_s" "$post_body_file"
  shadow_curl_config | timeout "$timeout_s" "${SHADOW_CURL_ARGV[@]}" 2>/dev/null
}

# ── shadow_request_body — the /v1/messages payload (pure) ─────────────────────
# Shape verified against the live endpoint 2026-08-07: this exact body, with the real
# scripts/roles/triage.md as `system`, returned a well-formed verdict block.
#
# `system` carries the role file and the user turn carries the issue text, mirroring
# how the live triage call splits them (`--system-prompt-file` plus the prompt). A
# shadow run that differed in task shape would measure a different task, and its
# agreement number would not be evidence about anything the pilot cares about.
#
# Both are passed as FILES and read by jq's --rawfile, never interpolated: the issue
# body is untrusted text and must not be able to close a string and inject JSON.
shadow_request_body() {
  local model="$1" max_tokens="$2" system_file="$3" prompt_file="$4"
  jq -c -n \
    --arg     model      "$model" \
    --argjson max_tokens "$max_tokens" \
    --rawfile system     "$system_file" \
    --rawfile prompt     "$prompt_file" \
    '{model: $model,
      max_tokens: $max_tokens,
      system: $system,
      messages: [{role: "user", content: $prompt}]}'
}

# ── shadow_extract_text — assistant text out of the response (pure) ───────────
# Reads a /v1/messages response on stdin; writes the concatenated `content[].text` to
# stdout. Exit 1 when there is no assistant text to be had — a malformed body, an
# error envelope, or an empty content array.
#
# THIS is what reaches the gate. Feeding the raw response JSON to `triage-decide.sh`
# would appear to work today (the sentinels are still findable inside the JSON string)
# and would break the instant a verdict arrived with an escaped newline in it, so the
# extraction is explicit and its failure is a recorded reason rather than a silently
# empty verdict.
shadow_extract_text() {
  local text
  text="$(jq -j '
    if (.content? | type) == "array"
    then [ .content[] | select((.type? == "text") and ((.text? | type) == "string")) | .text ] | join("")
    else empty end
  ' 2>/dev/null)" || return 1
  [[ -z "${text//[[:space:]]/}" ]] && return 1
  printf '%s' "$text"
}

# ── shadow_stop_reason — why generation ended (pure) ──────────────────────────
# Empty string when absent or unparseable. Read to tell a TRUNCATED response apart
# from a model that genuinely failed the schema; see the max_tokens note above.
shadow_stop_reason() {
  jq -r 'if (.stop_reason? | type) == "string" then .stop_reason else "" end' 2>/dev/null || printf ''
}

# ── shadow_classify_error — a TYPED reason, never a mistaken verdict ──────────
# Reads a response body on stdin, takes the HTTP status as $1. Exit 0 with a short
# machine-stable reason on stdout when the body is an error; exit 1 when it is not.
#
# z.ai returns TWO different error envelopes, both observed live on 2026-08-07:
#
#   HTTP 400  {"type":"error","error":{"type":"invalid_request_error","code":"1211",
#              "message":"[1211][Unknown Model, please check the model code.][…]"}}
#   HTTP 401  {"error":{"message":"token expired or incorrect","type":"401"}}
#
# The second has NO top-level `"type":"error"`, so keying on that alone would let an
# auth failure through as a "response" whose content array happens to be missing — the
# row would then read `conformant:false` and count against GLM's schema discipline.
# Hence the test is the presence of an `error` OBJECT, either envelope.
#
# The MESSAGE is deliberately not carried into the reason: it is vendor prose of
# unbounded length and the one field that could conceivably echo request detail back
# at us. Only the code / type / status — enough to group by in the report.
shadow_classify_error() {
  local status="${1:-}" body reason
  body="$(cat)"
  [[ -z "${body//[[:space:]]/}" ]] && { printf 'empty-response'; return 0; }

  reason="$(printf '%s' "$body" | jq -r '
    if (.error? | type) == "object"
    then ((.error.code? // .error.type? // "unknown") | tostring)
    else empty end
  ' 2>/dev/null)"

  if [[ -n "$reason" ]]; then
    printf 'api-error:%s' "$reason"
    return 0
  fi

  # Not an error envelope. Two remaining non-verdict cases, kept apart because they
  # point at different faults: a body that is not JSON at all (gateway, HTML error
  # page) versus well-formed JSON returned under a non-2xx status.
  if ! printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
    if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then printf 'unparseable-response'
    else printf 'http-%s' "${status:-000}"; fi
    return 0
  fi
  if [[ -n "$status" && ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    printf 'http-%s' "$status"
    return 0
  fi
  return 1
}

# ── shadow_pick_latest_model — the PURE half of "latest" resolution ───────────
# A /v1/models JSON body on stdin → the newest non-lite model id on stdout, or
# nothing (exit 1) if none can be chosen. Pure: no network, no env, no clock, so
# the selection rule is testable against fixtures without a z.ai account.
#
# "Newest" is `created_at`, NOT list order and NOT a version-string sort: a lexical
# compare ranks 'glm-5.10' BELOW 'glm-5.9', and list order is not a recency guarantee.
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
# skips the shadow run — it must never fall back to a guessed id, because a row
# labelled with the wrong model is worse than no row.
#
# Uses the SAME credential-free request path as the verdict call, so the key is out
# of `ps` for the listing too.
shadow_resolve_model() {
  local requested; requested="$(shadow_model)"
  if [[ "$requested" != "latest" ]]; then printf '%s' "$requested"; return 0; fi
  [[ -z "$(shadow_key)" ]] && return 1

  local out_file status rc base
  out_file="$(mktemp)" || return 1
  base="$(shadow_base_url)"
  status="$(shadow_http "${base%/}/v1/models" "$out_file" 20)"
  rc=$?
  if [[ $rc -ne 0 || ! "$status" =~ ^2[0-9][0-9]$ ]]; then rm -f "$out_file"; return 1; fi
  shadow_pick_latest_model < "$out_file"
  rc=$?
  rm -f "$out_file"
  return $rc
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
