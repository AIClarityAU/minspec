#!/usr/bin/env bash
# backfill-hold-labels.sh — apply `hold:*` to issues triaged before the label existed (#1002).
#
# Usage:
#   scripts/backfill-hold-labels.sh            # DRY RUN — prints the plan, changes nothing
#   scripts/backfill-hold-labels.sh --apply    # actually applies it
#
# ── What it can and cannot do ────────────────────────────────────────────────
# The hold reason is recoverable ONLY from a verdict record. An issue triaged before
# #983 shipped the record has no reason to recover — nothing anywhere says why it was
# held — so this script SKIPS it rather than guessing. Those need a re-triage, which is
# an LLM run and a separate decision about spend; conflating the two would hide a real
# cost behind a label sweep.
#
# Measured on 2026-08-06 across 540 open issues: 280 `needs-review` carry no record at
# all. Expect the plan to cover a minority and say so — a backfill that silently covered
# 15% while reading as "done" is exactly the false signpost this project exists to avoid.
#
# ── Trust ────────────────────────────────────────────────────────────────────
# Records are read through `dispatch-ready-check.sh --trusted-comment-bodies` and
# `--newest-record`, the same tested seams the dispatcher uses. This repo is PUBLIC, so
# an unfiltered read would let any stranger's forged block decide a label (#1113).

set -uo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${SCRIPT_DIR}/dispatch-ready-check.sh"
DECIDE="${SCRIPT_DIR}/triage-decide.sh"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# The hold vocabulary is DERIVED from the gate that emits it, never restated here. A
# hardcoded list silently stops covering a new hold the moment one is added — and this
# corpus already grew `specify` (#1169) after the vocabulary was first written down.
mapfile -t HOLDS < <(grep -oE 'emit [a-z-]+ "\$ROLE" [a-z]+' "$DECIDE" | awk '{print $NF}' | sort -u)
if [[ "${#HOLDS[@]}" -lt 3 ]]; then
  echo "ERROR: could not derive the hold vocabulary from ${DECIDE} (got ${#HOLDS[*]}) — refusing to run a bulk label sweep on a guess." >&2
  exit 1
fi
echo "Hold vocabulary (derived from triage-decide.sh): ${HOLDS[*]}"
[[ "$APPLY" -eq 1 ]] || echo "DRY RUN — nothing will be changed. Re-run with --apply to act."
echo

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CUR="null"; PLANNED=0; SKIPPED_NORECORD=0; ALREADY=0; NOHOLD=0; TOTAL=0

Q='query($c:String){repository(owner:"AIClarityAU",name:"minspec"){issues(first:50,after:$c,states:OPEN){pageInfo{hasNextPage endCursor}nodes{number labels(first:30){nodes{name}} comments(first:100){nodes{author{login} authorAssociation body}}}}}}'

while :; do
  OUT="$(gh api graphql -f query="$Q" -F c="$CUR" 2>/dev/null)" || { echo "ERROR: GraphQL page failed — stopping (partial run, nothing silently skipped)." >&2; exit 1; }
  COUNT="$(printf '%s' "$OUT" | jq '.data.repository.issues.nodes | length')"
  TOTAL=$((TOTAL + COUNT))

  for idx in $(seq 0 $((COUNT - 1))); do
    NODE="$(printf '%s' "$OUT" | jq -c ".data.repository.issues.nodes[$idx]")"
    NUM="$(printf '%s' "$NODE" | jq -r '.number')"
    HAVE="$(printf '%s' "$NODE" | jq -r '[.labels.nodes[].name] | map(select(startswith("hold:"))) | join(",")')"

    REC="$(printf '%s' "$NODE" | jq -c '{comments: .comments.nodes}' \
            | "$GATE" --trusted-comment-bodies 2>/dev/null \
            | "$GATE" --newest-record 2>/dev/null)"
    if [[ -z "$REC" ]]; then SKIPPED_NORECORD=$((SKIPPED_NORECORD + 1)); continue; fi

    HOLD="$(printf '%s\n' "$REC" | grep -iE '^[[:space:]]*hold[[:space:]]*:' | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '[:space:]')"
    if [[ -z "$HOLD" || "$HOLD" == "none" ]]; then NOHOLD=$((NOHOLD + 1)); continue; fi

    WANT="hold:${HOLD}"
    if [[ ",${HAVE}," == *",${WANT},"* && "$HAVE" == "$WANT" ]]; then ALREADY=$((ALREADY + 1)); continue; fi

    PLANNED=$((PLANNED + 1))
    printf '  #%-6s %-16s' "$NUM" "$WANT"
    [[ -n "$HAVE" ]] && printf ' (replacing: %s)' "$HAVE"
    printf '\n'

    if [[ "$APPLY" -eq 1 ]]; then
      gh label create "$WANT" --repo "$REPO" --color cfd3d7 --description "Held — reason recorded by triage (#1002)" >/dev/null 2>&1 || true
      gh issue edit "$NUM" --repo "$REPO" --add-label "$WANT" >/dev/null 2>&1 \
        || echo "    WARNING: could not add ${WANT} to #${NUM}" >&2
      # Remove every OTHER hold:* — two contradicting reasons is worse than none.
      for h in "${HOLDS[@]}"; do
        [[ "hold:${h}" == "$WANT" ]] && continue
        [[ ",${HAVE}," == *",hold:${h},"* ]] || continue
        gh issue edit "$NUM" --repo "$REPO" --remove-label "hold:${h}" >/dev/null 2>&1 || true
      done
    fi
  done

  [[ "$(printf '%s' "$OUT" | jq -r '.data.repository.issues.pageInfo.hasNextPage')" == "true" ]] || break
  CUR="$(printf '%s' "$OUT" | jq -r '.data.repository.issues.pageInfo.endCursor')"
done

echo
echo "── Summary ──────────────────────────────────────────────"
printf '  open issues scanned      %d\n' "$TOTAL"
printf '  labelled / to label      %d\n' "$PLANNED"
printf '  already correct          %d\n' "$ALREADY"
printf '  no hold (dispatchable)   %d\n' "$NOHOLD"
printf '  SKIPPED, no record       %d   <- not backfillable; needs re-triage\n' "$SKIPPED_NORECORD"
echo
echo "The skipped count is the honest limit of this sweep: a hold reason that was never"
echo "recorded cannot be recovered, only re-derived by running triage again."
[[ "$APPLY" -eq 1 ]] || echo "DRY RUN — re-run with --apply to make these changes."
