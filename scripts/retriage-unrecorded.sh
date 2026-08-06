#!/usr/bin/env bash
# retriage-unrecorded.sh — re-derive a verdict for issues triaged before records existed (#1002).
#
# Usage:
#   scripts/retriage-unrecorded.sh                 # DRY RUN — list the work, spend nothing
#   scripts/retriage-unrecorded.sh --apply         # re-triage ALL of them
#   scripts/retriage-unrecorded.sh --apply --max N # re-triage at most N (stage it)
#
# ── Why this is not just a label sweep ───────────────────────────────────────
# `backfill-hold-labels.sh` recovers a hold reason from a RECORD. An issue triaged before
# #983 has none — the reason was never written down, so it cannot be recovered, only
# RE-DERIVED by running triage again. That is one `claude -p` call per issue: real spend,
# and the reason this is a separate script with a separate opt-in rather than a flag on
# the backfill.
#
# ── Safety ───────────────────────────────────────────────────────────────────
# Each issue goes through `triage-inbox.sh`, which is the ONLY writer of a verdict record
# (#983). This script never mints, labels, or decides anything itself — it selects which
# issues to hand over, and nothing more.
#
# RESUMABLE by construction: the selection re-queries live state every run and skips
# anything that now has a record, so an interrupted run is continued simply by re-running
# it. No state file to strand.
#
# ORDER is oldest-first, so a partial run leaves the oldest half of the backlog covered
# rather than an arbitrary scatter.

set -uo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${SCRIPT_DIR}/dispatch-ready-check.sh"
TRIAGE="${SCRIPT_DIR}/triage-inbox.sh"

APPLY=0; MAX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --max)   MAX="${2:?--max needs a number}"; shift 2 ;;
    *) echo "usage: $0 [--apply] [--max N]" >&2; exit 1 ;;
  esac
done

command -v claude >/dev/null 2>&1 || { echo "ERROR: \`claude\` is not on PATH — triage cannot run." >&2; exit 1; }
[[ -x "$TRIAGE" || -r "$TRIAGE" ]] || { echo "ERROR: ${TRIAGE} missing." >&2; exit 1; }

echo "Selecting OPEN issues with no trusted verdict record…"
Q='query($c:String){repository(owner:"AIClarityAU",name:"minspec"){issues(first:50,after:$c,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor}nodes{number title labels(first:30){nodes{name}} comments(first:100){nodes{author{login} authorAssociation body}}}}}}'

CUR="null"; TOTAL=0
TARGETS="$(mktemp)"; trap 'rm -f "$TARGETS"' EXIT
while :; do
  OUT="$(gh api graphql -f query="$Q" -F c="$CUR" 2>/dev/null)" || { echo "ERROR: GraphQL page failed — stopping rather than acting on a partial view." >&2; exit 1; }
  N="$(printf '%s' "$OUT" | jq '.data.repository.issues.nodes|length')"
  TOTAL=$((TOTAL + N))
  for i in $(seq 0 $((N - 1))); do
    NODE="$(printf '%s' "$OUT" | jq -c ".data.repository.issues.nodes[$i]")"
    NUM="$(printf '%s' "$NODE" | jq -r '.number')"
    REC="$(printf '%s' "$NODE" | jq -c '{comments: .comments.nodes}' \
            | "$GATE" --trusted-comment-bodies 2>/dev/null | "$GATE" --newest-record 2>/dev/null)"
    [[ -n "$REC" ]] && continue                       # already has a record — nothing to derive
    # Skip the security quarantine: only a human retires that, and re-triage must not
    # look like it did.
    printf '%s' "$NODE" | jq -e '[.labels.nodes[].name] | index("agent-quarantined")' >/dev/null 2>&1 && continue
    printf '%s\t%s\n' "$NUM" "$(printf '%s' "$NODE" | jq -r '.title' | cut -c1-64)" >> "$TARGETS"
  done
  [[ "$(printf '%s' "$OUT" | jq -r '.data.repository.issues.pageInfo.hasNextPage')" == "true" ]] || break
  CUR="$(printf '%s' "$OUT" | jq -r '.data.repository.issues.pageInfo.endCursor')"
done

COUNT="$(wc -l < "$TARGETS" | tr -d ' ')"
echo "  open issues scanned : ${TOTAL}"
echo "  need a re-triage    : ${COUNT}"
[[ "$MAX" -gt 0 ]] && echo "  capped this run at  : ${MAX}"
echo

if [[ "$APPLY" -ne 1 ]]; then
  echo "DRY RUN — no LLM call made, nothing changed. Oldest 20 of the selection:"
  head -20 "$TARGETS" | awk -F'\t' '{printf "  #%-7s %s\n", $1, $2}'
  echo
  echo "Each of the ${COUNT} is ONE \`claude -p\` triage call. Re-run with --apply (optionally --max N)."
  exit 0
fi

DONE=0; FAILED=0
while IFS=$'\t' read -r NUM TITLE; do
  [[ "$MAX" -gt 0 && "$DONE" -ge "$MAX" ]] && { echo "Reached --max ${MAX}; stopping. Re-run to continue — selection is live, so completed issues drop out."; break; }
  printf '[%d/%s] #%s %s\n' "$((DONE + 1))" "$COUNT" "$NUM" "$TITLE"
  if bash "$TRIAGE" "$NUM" >/dev/null 2>&1; then
    DONE=$((DONE + 1))
  else
    FAILED=$((FAILED + 1))
    echo "  WARNING: triage failed for #${NUM} — left untouched, will be re-selected next run." >&2
  fi
done < "$TARGETS"

echo
echo "── Summary ──────────────────────────────"
printf '  re-triaged   %d\n' "$DONE"
printf '  failed       %d   (left untouched; re-run to retry)\n' "$FAILED"
printf '  remaining    %d\n' "$((COUNT - DONE - FAILED))"
