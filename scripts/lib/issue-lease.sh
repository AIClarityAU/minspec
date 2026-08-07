#!/usr/bin/env bash
# scripts/lib/issue-lease.sh — SPEC-044 / DR-067 work-item claim lease (Tier-1).
#
# The third consumer of the SPEC-026 presence lease (after the sync gate, DR-065):
# "session S owns issue / PR N right now" is a lease over a work item. This file is
# the Tier-1 networked half — GitHub claim/poll + the local flock/worktree machinery.
# The offline lease *semantics* (the liveness predicate + the winner shape) live in
# the Tier-0 core (packages/minspec/src/lib/presence.ts, isClaimLive/pickClaimWinner);
# THIS file mirrors only the LIVENESS half byte-for-byte (the FR-10 parity gate).
#
# DUAL MODE (like remediate-pr.sh's --classify seam + agent-egress.sh's sourced lib):
#   • SOURCED by dispatch-issue.sh / drain-inbox.sh → defines the lease_* functions
#     (the flock is held in the CALLER's process so it survives for the build's life).
#   • EXECUTED directly → the pure `--classify-claim` / `--is-live` seams (unit-tested,
#     NO gh/git/claude) + the credentialed `acquire/renew/verify-holds/release/
#     release-all/reclaim?/worktree-path` subcommands.
#
# Security / tier model (unchanged from dispatch-issue.sh):
#   • the build/fix AGENT is credential-free; only the PARENT (which sources this)
#     runs the credentialed gh ops here (INV-5).
#   • NO network in the Tier-0 core — every gh call is HERE, never in presence.ts (INV-3).
#
# Correctness of at-most-one-owner NEVER rests on this soft claim (GitHub comment-list
# read-after-write is not linearizable). It rests on HARD layers: the concurrent
# PR-per-head server CAS (FR-3), the sequential open-issue + shipped-marker gate (D12/
# FR-3b), and the same-host per-item flock + claim-unique worktree path (D11/FR-11).
# The soft claim only dedups WASTED BUILD WORK.

# ── Config ───────────────────────────────────────────────────────────────────
: "${MINSPEC_LEASE_REPO:=AIClarityAU/minspec}"
_ISSUE_LEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # scripts/lib
_ISSUE_LEASE_REPO_ROOT="$(cd "${_ISSUE_LEASE_DIR}/../.." && pwd)"      # repo root

# Lease claim/renew/release write GitHub COMMENTS, so they must carry the bot's
# identity, not the human's (#1355).
#
# Sourced here, ARMED in the three writing functions rather than at file scope.
# This is a library: arming at source time would shadow `gh` process-wide for
# every consumer that merely wants `classify_claim` or `reclaim_decision`, which
# is the same "do not silently redefine a command the caller did not ask about"
# principle gh-bot.sh states about its own sourcing. gh_bot_init is idempotent
# and offline, so calling it per-writer costs nothing. (#1401 architect review.)
# shellcheck source=scripts/lib/gh-bot.sh
source "${_ISSUE_LEASE_DIR}/gh-bot.sh"
: "${MINSPEC_LEASE_WORKTREE_BASE:=/tmp/minspec-agent}"

# ── Work-item lease constants (SPEC-044 D10 / OQ-2) ──────────────────────────
# DISTINCT from the presence heartbeat (HEARTBEAT_SECS=30 / STALE_SECS=120): a build/
# shepherd runs many minutes, so the work-item claim carries its OWN, longer TTL,
# renewed on a wall-clock timer independent of build progress. PAIRED as
# LEASE_TTL_SECS = 4 × LEASE_RENEW_SECS (mirroring STALE = 4 × HEARTBEAT).
# LEASE_TTL_SECS MUST equal presence.ts LEASE_TTL_SECS — change BOTH or neither; the
# FR-10 liveness-parity test fails on drift. ABS_MAX is claim-specific (Tier-1 only,
# FR-12) and NOT in the presence parity set.
LEASE_RENEW_SECS=60
LEASE_TTL_SECS=240      # MUST equal presence.ts LEASE_TTL_SECS (= 4 × LEASE_RENEW_SECS, paired)
LEASE_ABS_MAX_SECS=7200 # absolute max-claim-lifetime (D10/FR-12); ~2× expected-build-max; NOT parity-shared

# Marker embedded in every claim comment so claims can be enumerated + retracted
# without a stateful store. The payload JSON is captured between the marker and ` -->`.
CLAIM_MARKER='minspec-claim'
# Persisted already-shipped marker (D12/FR-3b) — a comment carrying this is proof the
# item merged once; a re-claim/dispatch is refused before any build.
SHIPPED_MARKER='<!-- minspec-shipped -->'

# ── Self identity ────────────────────────────────────────────────────────────
# One session id per process, cached. Prefers the presence sessionId (MINSPEC_SESSION_ID)
# so a claim and the presence heartbeat agree; else a fresh uuid.
lease_self_sid() {
  if [[ -n "${MINSPEC_LEASE_SID:-}" ]]; then printf '%s' "$MINSPEC_LEASE_SID"; return 0; fi
  local sid="${MINSPEC_SESSION_ID:-}"
  if [[ -z "$sid" ]]; then
    sid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "sid-$$-$(date -u +%s 2>/dev/null || echo 0)")"
  fi
  export MINSPEC_LEASE_SID="$sid"
  printf '%s' "$sid"
}

lease_self_host() { hostname 2>/dev/null || echo "unknown-host"; }

# ── Claim-unique worktree path (D11/INV-7) ───────────────────────────────────
# ${BASE}/issue-N-<sessionId>, NOT the shared ${BASE}/issue-N, so two same-host racers
# never share a directory and neither force-removes the other's live worktree.
lease_worktree_path() {
  local item="${1:?lease_worktree_path needs an item}"
  printf '%s/issue-%s-%s' "$MINSPEC_LEASE_WORKTREE_BASE" "$item" "$(lease_self_sid)"
}

# ── PURE liveness (jq-free scalars) — mirrors presence.ts isClaimLive ─────────
# is_claim_live <lastRenewed_iso> <claimedAt_iso> <pid> <host> <self_host> <now_epoch>
#   exit 0 iff live. The LIVENESS half — TTL fresh AND (foreign-host OR pid alive) —
#   mirrors presence.ts isClaimLive BYTE-FOR-BYTE (FR-10). The ABS_MAX ceiling
#   (claimedAt + LEASE_ABS_MAX_SECS) is a claim-specific Tier-1 addition (D10/FR-12),
#   deliberately NOT in the presence parity set — a parity fixture keeps claimedAt
#   recent so the two engines agree on the liveness half.
is_claim_live() {
  local last_renewed="$1" claimed_at="$2" pid="$3" host="$4" self_host="$5" now="$6"
  local lr_epoch age ca_epoch
  lr_epoch="$(date -u -d "$last_renewed" +%s 2>/dev/null)" || return 1   # unparseable heartbeat ⇒ dead
  [[ -n "$lr_epoch" ]] || return 1
  age=$(( now - lr_epoch ))
  (( age < LEASE_TTL_SECS )) || return 1                                 # stale heartbeat ⇒ dead
  # pid half: same machine ⇒ pid must be alive; foreign host ⇒ pid unobservable ⇒ TTL alone.
  if [[ "$host" == "$self_host" ]]; then
    kill -0 "$pid" 2>/dev/null || return 1                              # same-machine dead pid ⇒ dead
  fi
  # ABS_MAX ceiling (Tier-1 only; NOT presence-parity). A missing/unparseable claimedAt
  # cannot force-expire (fail toward still-live for the ceiling — TTL already guards freshness).
  ca_epoch="$(date -u -d "$claimed_at" +%s 2>/dev/null)" || ca_epoch=""
  if [[ -n "$ca_epoch" ]]; then
    (( now - ca_epoch < LEASE_ABS_MAX_SECS )) || return 1               # past absolute lifetime ⇒ dead (FR-12)
  fi
  return 0
}

# ── PURE classifier (jq to iterate the array; is_claim_live per record) ───────
# classify_claim <claims_json> <self_session_id> <now_epoch> <enum_complete:0|1>
#   Prints ONE decision token on line 1, the winning sessionId on line 2:
#     own        = self holds the earliest LIVE claim AND enum_complete=1
#     stand-down = a live non-self claim wins, OR enum_complete=0, OR the claims are
#                  unparseable (INV-6: an incomplete/ambiguous read can NEVER prove own)
#     claim      = no live claim AND enum_complete=1 (self may acquire, then re-verify)
#   WINNER = earliest serverOrder → sessionId (D2). claimedAt is METADATA, never a key.
classify_claim() {
  local claims_json="$1" self_sid="$2" now="$3" enum_complete="$4"
  local self_host; self_host="$(lease_self_host)"

  if [[ "$enum_complete" != "1" ]]; then
    printf 'stand-down\n\n'   # INV-6: a provably-incomplete enumeration can never prove own
    return 0
  fi

  # Flatten to TSV; a jq parse error (malformed/non-array claims) ⇒ ambiguous ⇒ stand-down.
  local tsv
  if ! tsv="$(printf '%s' "$claims_json" | jq -r '
        .[] | [.sessionId, .host, .worktreeRoot, (.pid|tostring),
               .claimedAt, .lastRenewed, (.serverOrder|tostring)] | @tsv' 2>/dev/null)"; then
    printf 'stand-down\n\n'   # INV-6: unparseable claim record ⇒ never own
    return 0
  fi

  local best_sid="" best_order="" sid host wt pid claimed renewed order
  while IFS=$'\t' read -r sid host wt pid claimed renewed order; do
    [[ -n "$sid" ]] || continue
    if is_claim_live "$renewed" "$claimed" "$pid" "$host" "$self_host" "$now"; then
      # Winner = min(serverOrder), then min(sessionId) for the equal-id degenerate case.
      if [[ -z "$best_order" ]] \
         || (( order < best_order )) \
         || { (( order == best_order )) && [[ "$sid" < "$best_sid" ]]; }; then
        best_order="$order"; best_sid="$sid"
      fi
    fi
  done <<< "$tsv"

  if [[ -z "$best_sid" ]]; then
    printf 'claim\n%s\n' "$self_sid"          # no live claim ⇒ self may acquire
  elif [[ "$best_sid" == "$self_sid" ]]; then
    printf 'own\n%s\n' "$best_sid"
  else
    printf 'stand-down\n%s\n' "$best_sid"     # a live non-self claim wins ⇒ defer
  fi
  return 0
}

# ── Same-host hard lock (D11/FR-11) — a real same-host CAS, auto-released on death ──
# lease_flock <item>: acquire fd 200 on .minspec/locks/issue-N.lock (non-blocking). The
# fd stays OPEN in the CALLER's process (so a sourced caller holds it for the whole
# build; it releases when that process exits). Exit 0 acquired, non-zero ⇒ a live local
# racer holds it ⇒ caller must stand down.
lease_flock() {
  local item="${1:?lease_flock needs an item}"
  local lockdir="${_ISSUE_LEASE_REPO_ROOT}/.minspec/locks"
  mkdir -p "$lockdir" 2>/dev/null || return 1
  local lockfile="${lockdir}/issue-${item}.lock"
  exec 200>"$lockfile" || return 1
  flock -n 200 || return 1
  return 0
}

# ── D12 sequential guard: open-issue + not-already-shipped (FR-3b) ────────────
# lease_gate_open_unshipped <item>: exit 0 iff the item is OPEN and carries NO shipped
# marker. Refuse (exit 1) a closed/merged item BEFORE any build — the PR-per-head CAS
# window closes on merge, so at-most-one-merge across TIME rests HERE (D12/INV-1).
lease_gate_open_unshipped() {
  local item="${1:?lease_gate_open_unshipped needs an item}" state
  state="$(gh issue view "$item" --repo "$MINSPEC_LEASE_REPO" --json state --jq '.state' 2>/dev/null || echo "")"
  [[ "$state" == "OPEN" ]] || return 1        # closed / unknown ⇒ refuse
  # TRUSTED authors only. This repo is PUBLIC, and this read used to join EVERY
  # comment body from ANY author — so any internet user could post the marker (an
  # HTML comment, which renders as NOTHING in the GitHub UI) and that issue could
  # never be dispatched again. Permanent, invisible, zero-permission denial.
  #
  # Sharpening how live it was: `grep -rn 'minspec-shipped'` over the whole repo
  # returns only the definition on line 52 — nothing anywhere WRITES this marker, so
  # every possible match was necessarily attacker-authored.
  #
  # The general shape is worth naming: every gate here fails closed, which makes each
  # one a DENIAL primitive as well as an escalation guard. An author filter is a DROP,
  # so it protects the escalation direction and adds nothing in the denial direction —
  # unless it is applied to the reads that can deny, like this one.
  if gh issue view "$item" --repo "$MINSPEC_LEASE_REPO" --json comments 2>/dev/null \
       | "$(dirname "${BASH_SOURCE[0]}")/../dispatch-ready-check.sh" --trusted-comment-bodies 2>/dev/null \
       | grep -qF "$SHIPPED_MARKER"; then
    return 1                                   # already shipped ⇒ never re-dispatch
  fi
  return 0
}

# ── Claim comment body + read/enumerate ──────────────────────────────────────
lease_claim_body() {
  # <sid> <host> <wt> <pid> <claimedAt> <lastRenewed>
  local json
  json="$(jq -n -c \
    --arg s "$1" --arg h "$2" --arg w "$3" --argjson p "$4" --arg c "$5" --arg r "$6" \
    '{sessionId:$s, host:$h, worktreeRoot:$w, pid:$p, claimedAt:$c, lastRenewed:$r}')"
  printf '<!-- %s:%s -->\n\n🔒 MinSpec work-item claim by session `%s` on `%s` (SPEC-044 lease). Auto-released on completion/expiry.' \
    "$CLAIM_MARKER" "$json" "$1" "$2"
}

# lease_read_claims <item>: enumerate ALL claim comments TO EXHAUSTION (paginate). On
# ANY gh/parse error return non-zero (the caller maps that to enum_complete=0 → INV-6
# stand-down). serverOrder = the comment's server-assigned monotonic id.
lease_read_claims() {
  local item="${1:?lease_read_claims needs an item}" raw
  raw="$(gh api --paginate "repos/${MINSPEC_LEASE_REPO}/issues/${item}/comments" 2>/dev/null)" || return 1
  # gh --paginate concatenates JSON arrays; jq -s . re-wraps them, then flatten.
  printf '%s' "$raw" | jq -s -c --arg m "<!-- ${CLAIM_MARKER}:" '
    [ .[][] | select(.body | contains($m))
      | { id: .id,
          payload: (.body | capture("<!-- '"${CLAIM_MARKER}"':(?<j>\\{.*?\\}) -->"; "s").j | fromjson) }
      | .payload + { serverOrder: .id } ]' 2>/dev/null || return 1
}

# ── Credentialed ops (parent-side; the agent never calls these — INV-5) ──────
# acquire: post claim → re-read to exhaustion → verify winner. Exit 0 iff own.
lease_acquire() {
  gh_bot_init   # arm bot attribution before this function's GitHub write (#1355)
  local item="${1:?lease_acquire needs an item}"
  local sid host wt pid now claimed
  sid="$(lease_self_sid)"; host="$(lease_self_host)"; wt="$(lease_worktree_path "$item")"
  pid=$$; now="$(date -u +%s)"; claimed="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  gh issue comment "$item" --repo "$MINSPEC_LEASE_REPO" \
     --body "$(lease_claim_body "$sid" "$host" "$wt" "$pid" "$claimed" "$claimed")" >/dev/null 2>&1 || return 1
  local claims enum_complete decision
  if claims="$(lease_read_claims "$item")"; then enum_complete=1; else enum_complete=0; claims='[]'; fi
  decision="$(classify_claim "$claims" "$sid" "$now" "$enum_complete" | head -n1)"
  if [[ "$decision" == "own" ]]; then
    # Register the won item so release-all (FR-5, Slice 4) can retract every held claim.
    local reg="${_ISSUE_LEASE_REPO_ROOT}/.minspec/locks/claimed-${sid}.list"
    mkdir -p "$(dirname "$reg")" 2>/dev/null || true
    grep -qxF "$item" "$reg" 2>/dev/null || printf '%s\n' "$item" >> "$reg" 2>/dev/null || true
    return 0
  fi
  lease_release "$item" >/dev/null 2>&1 || true   # lost / incomplete ⇒ retract, stand down (best-effort)
  return 1
}

# renew: refresh this session's claim heartbeat (lastRenewed). Parent-side ticker (D10).
# Edits the session's own claim comment in place (keeps serverOrder = winner key stable).
lease_renew() {
  gh_bot_init   # arm bot attribution before this function's GitHub write (#1355)
  local item="${1:?lease_renew needs an item}" sid host now
  sid="$(lease_self_sid)"; host="$(lease_self_host)"; now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  local cid claimed
  # Find our claim comment id + its original claimedAt (preserve it; only bump lastRenewed).
  read -r cid claimed < <(gh api --paginate "repos/${MINSPEC_LEASE_REPO}/issues/${item}/comments" 2>/dev/null \
    | jq -r --arg m "<!-- ${CLAIM_MARKER}:" --arg sid "$sid" '
        [ .[][] | select(.body|contains($m))
          | { id:.id, p:(.body|capture("<!-- '"${CLAIM_MARKER}"':(?<j>\\{.*?\\}) -->";"s").j|fromjson) }
          | select(.p.sessionId==$sid) ] | (.[-1] // empty) | "\(.id)\t\(.p.claimedAt)"' 2>/dev/null \
    | tr '\t' ' ') || return 1
  [[ -n "$cid" ]] || return 1
  local wt pid; wt="$(lease_worktree_path "$item")"; pid=$$
  gh api -X PATCH "repos/${MINSPEC_LEASE_REPO}/issues/comments/${cid}" \
     -f body="$(lease_claim_body "$sid" "$host" "$wt" "$pid" "$claimed" "$now")" >/dev/null 2>&1 || return 1
  return 0
}

# verify-holds: exit 0 iff self STILL holds the live claim (D3 re-verify before every
# credentialed op — the owner stands down if it was reclaimed).
lease_verify_holds() {
  local item="${1:?lease_verify_holds needs an item}" sid now claims enum_complete decision
  sid="$(lease_self_sid)"; now="$(date -u +%s)"
  if claims="$(lease_read_claims "$item")"; then enum_complete=1; else enum_complete=0; claims='[]'; fi
  decision="$(classify_claim "$claims" "$sid" "$now" "$enum_complete" | head -n1)"
  [[ "$decision" == "own" ]]
}

# release: retract this session's claim comment(s) on this item (best-effort).
lease_release() {
  gh_bot_init   # arm bot attribution before this function's GitHub write (#1355)
  local item="${1:?lease_release needs an item}" sid
  sid="$(lease_self_sid)"
  local ids
  ids="$(gh api --paginate "repos/${MINSPEC_LEASE_REPO}/issues/${item}/comments" 2>/dev/null \
    | jq -r --arg m "<!-- ${CLAIM_MARKER}:" --arg sid "$sid" '
        .[][] | select(.body|contains($m))
        | select((.body|capture("<!-- '"${CLAIM_MARKER}"':(?<j>\\{.*?\\}) -->";"s").j|fromjson|.sessionId)==$sid)
        | .id' 2>/dev/null)" || return 0
  local id
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    gh api -X DELETE "repos/${MINSPEC_LEASE_REPO}/issues/comments/${id}" >/dev/null 2>&1 || true
  done <<< "$ids"
  return 0
}

# release-all: release every item this session claimed (exit-trap consumer, FR-5, Slice 4).
# Reads the per-session claimed-items registry the acquire path appends to.
lease_release_all() {
  local sid reg item
  sid="$(lease_self_sid)"
  reg="${_ISSUE_LEASE_REPO_ROOT}/.minspec/locks/claimed-${sid}.list"
  [[ -f "$reg" ]] || return 0
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    lease_release "$item" || true
  done < "$reg"
  rm -f "$reg" 2>/dev/null || true
  return 0
}

# ── Parent-side renew ticker (D10/FR-12; sourced-only API) ───────────────────
# The agent is CREDENTIAL-FREE (INV-5) so it cannot renew its own claim, and the parent
# is blocked on the agent subprocess. So the PARENT drives renewal: a background subshell
# that renews on a WALL-CLOCK timer, INDEPENDENT of build progress — a long, quiet build
# can never expire its own live claim. Torn down in the same EXIT trap that releases the
# lease (D6), so it can never outlive the work it protects.
#
# Build-independent renew means a HUNG owner (live parent, live ticker, wedged build)
# would otherwise hold its claim forever. That is bounded by the ABS_MAX ceiling in
# is_claim_live (claimedAt + LEASE_ABS_MAX_SECS), NOT by the ticker.
#
# Not exposed on the CLI: a standalone ticker would die with its own process, so it is
# only meaningful to a caller that SOURCES this lib and holds it for the build.
_LEASE_TICKER_PID=""

lease_start_renew_ticker() {
  local item="${1:?lease_start_renew_ticker needs an item}"
  [[ -z "$_LEASE_TICKER_PID" ]] || return 0    # idempotent — exactly one ticker per dispatch
  ( while sleep "$LEASE_RENEW_SECS"; do lease_renew "$item" >/dev/null 2>&1 || true; done ) &
  _LEASE_TICKER_PID=$!
  return 0
}

lease_stop_renew_ticker() {
  [[ -n "$_LEASE_TICKER_PID" ]] || return 0
  # Children first: killing the subshell alone would orphan its in-flight `sleep`.
  # `-P` matches by PARENT pid, so this can never self-match the caller the way a
  # `pkill -f <pattern>` would.
  pkill -P "$_LEASE_TICKER_PID" 2>/dev/null || true
  kill "$_LEASE_TICKER_PID" 2>/dev/null || true
  wait "$_LEASE_TICKER_PID" 2>/dev/null || true
  _LEASE_TICKER_PID=""
  return 0
}

# reclaim?: drain orphan gate (Slice 3 consumer). Exit 0 iff the claim is absent/expired
# AND (if stale) the TWO-PHASE grace handshake confirms the owner did not re-assert.
# A LIVE non-self claim ⇒ exit 1 (skip-live-owned). Kept here so the seam is one source
# of truth; the drain wiring lands in Slice 3.
# reclaim_decision <claims_json> <self_sid> <now_epoch> <enum_complete:0|1>
#   PURE half of `reclaim?` — no gh, so it is unit-testable like --classify-claim and
#   --is-live (issue-lease-reclaim.test.ts). Exit 0 iff reclaimable, 1 iff hands-off.
#
#   Switches on classify_claim's DECISION TOKEN (line 1), which is the published
#   contract. It must NEVER re-derive the answer from line 2 (the winning sessionId):
#   line 2 carries `self_sid` for the `claim` decision and is EMPTY for `stand-down`,
#   so "line 2 is empty" means the exact OPPOSITE of "no live claim" (#1198). That
#   inference inverted both directions — a long-dead claim reported held forever, and
#   an unprovable enumeration reported reclaimable, which INV-6 forbids.
#
#     claim       ⇒ no live claim  ⇒ reclaimable (0)
#     own         ⇒ self holds it  ⇒ nothing to reclaim (1)
#     stand-down  ⇒ live non-self owner, OR incomplete/unparseable enumeration ⇒ (1)
#
#   Fails CLOSED: an unrecognised token is treated as hands-off, so a future decision
#   value cannot silently become "go ahead and take it".
reclaim_decision() {
  local claims_json="${1?reclaim_decision needs claims_json}" self_sid="${2:?reclaim_decision needs a self sid}"
  local now="${3:?reclaim_decision needs now}" enum_complete="${4:?reclaim_decision needs enum_complete}"
  local decision
  decision="$(classify_claim "$claims_json" "$self_sid" "$now" "$enum_complete" | sed -n 1p)"
  case "$decision" in
    claim) return 0 ;;
    own|stand-down) return 1 ;;
    *) return 1 ;;   # unknown token ⇒ fail closed (INV-6)
  esac
}

lease_reclaim_q() {
  local item="${1:?lease_reclaim? needs an item}" sid now claims
  sid="$(lease_self_sid)"; now="$(date -u +%s)"
  if ! claims="$(lease_read_claims "$item")"; then return 1; fi   # can't prove expiry ⇒ do NOT reclaim (INV-6)
  # Enumeration succeeded ⇒ complete. The decision itself is the pure seam above.
  reclaim_decision "$claims" "$sid" "$now" 1
}

# ── CLI dispatch — ONLY when executed directly, never when sourced ───────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  _usage() {
    cat >&2 <<'EOF'
Usage:
  issue-lease.sh --classify-claim <claims_json> <self_session_id> <now_epoch> <enum_complete:0|1>
  issue-lease.sh --reclaim-decision <claims_json> <self_session_id> <now_epoch> <enum_complete:0|1>
  issue-lease.sh --is-live <lastRenewed> <claimedAt> <pid> <host> <self_host> <now_epoch>
  issue-lease.sh acquire|renew|verify-holds|release|reclaim?|worktree-path <item>
  issue-lease.sh release-all
EOF
  }
  case "${1:-}" in
    --classify-claim)
      shift
      [[ $# -eq 4 ]] || { _usage; exit 2; }
      classify_claim "$1" "$2" "$3" "$4"; exit 0 ;;
    --reclaim-decision)
      # Pure seam mirroring `reclaim?` minus the gh fetch (#1198). Exit 0 reclaimable,
      # 1 hands-off — the SAME two exit codes callers read from `reclaim?`.
      shift
      [[ $# -eq 4 ]] || { _usage; exit 2; }
      if reclaim_decision "$1" "$2" "$3" "$4"; then echo "reclaimable"; exit 0; else echo "hands-off"; exit 1; fi ;;
    --is-live)
      shift
      [[ $# -eq 6 ]] || { _usage; exit 2; }
      if is_claim_live "$1" "$2" "$3" "$4" "$5" "$6"; then echo "live"; exit 0; else echo "dead"; exit 1; fi ;;
    worktree-path)
      shift; [[ $# -eq 1 ]] || { _usage; exit 2; }
      lease_worktree_path "$1"; echo; exit 0 ;;
    acquire)
      shift; [[ $# -eq 1 ]] || { _usage; exit 2; }
      # NOTE: run standalone the flock releases when this process exits — production
      # dispatch SOURCES the lib so the parent holds it for the build's lifetime.
      lease_flock "$1" && lease_gate_open_unshipped "$1" && lease_acquire "$1"; exit $? ;;
    renew)        shift; [[ $# -eq 1 ]] || { _usage; exit 2; }; lease_renew "$1"; exit $? ;;
    verify-holds) shift; [[ $# -eq 1 ]] || { _usage; exit 2; }; lease_verify_holds "$1"; exit $? ;;
    release)      shift; [[ $# -eq 1 ]] || { _usage; exit 2; }; lease_release "$1"; exit $? ;;
    release-all)  shift; [[ $# -eq 0 ]] || { _usage; exit 2; }; lease_release_all; exit $? ;;
    'reclaim?')   shift; [[ $# -eq 1 ]] || { _usage; exit 2; }; lease_reclaim_q "$1"; exit $? ;;
    *) _usage; exit 2 ;;
  esac
fi
