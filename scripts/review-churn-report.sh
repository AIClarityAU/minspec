#!/usr/bin/env bash
# Measure ai-review churn: how many review runs re-reviewed a patch that a PRIOR
# PASSING run on the same PR had already covered. That count is what wiring #1840
# (patch-hash re-attestation) could actually skip. #1839 records the fingerprint
# this reads back.
#
# Read-only. Makes no writes.
#
# Every correction below was MEASURED against the live API, not reasoned. An earlier
# copy of this instrument lived outside the repo and shipped three defects that each
# produced confident, plausible, wrong output; it is in the repo now so it gets review
# and tests like any other gate input.
#
#  1. filter=all. The check-runs endpoint defaults to filter=latest, which hides
#     earlier same-name runs on a SHA. Measured: 4 of 93 sampled SHAs carried a
#     hidden second ai-review run. Real but ~4%, not the majority effect predicted.
#  2. Eligibility sits on the correct side of the relation. completed+success+
#     allowlisted is a property of the run being re-attested FROM, never of the run
#     being skipped - a skipped run never gets a conclusion at all. Applying it to the
#     run being counted dropped every failed re-review of an already-passed patch,
#     which is exactly what re-attestation prevents. Measured: that excluded 53% of
#     runs (121 runs = 57 success / 38 neutral / 22 failure / 4 action_required).
#  3. Fails loudly. Wrapping every gh call in 2>/dev/null with no status check made an
#     expired token or a rate-limit print "nothing to measure" - an outage was
#     indistinguishable from a clean empty result.
#  4. No CEILING claim. Hidden runs and force-pushed-away history both delete real
#     repeats, so the true skippable count can EXCEED what this reports. Floor, not
#     ceiling.
#  5. Effective sample is PRs, not runs. Repeats cluster hard inside one PR, so N runs
#     are not N independent observations. Both are printed.
#
# KNOWN REMAINING BIAS, unfixable from this endpoint: history comes from
# pulls/{n}/commits, which lists only CURRENTLY REACHABLE commits, so a force-push
# erases the check-runs that preceded it. That deletes repeats: it biases DOWN.
#
# Usage: scripts/review-churn-report.sh [days] [repo]
set -uo pipefail

DAYS="${1:-14}"
REPO="${2:-AIClarityAU/minspec}"
REVIEWER_SLUG="${REVIEWER_SLUG:-minspec-sdd}"
ERRS="$(mktemp)"; SHACACHE="$(mktemp -d)"
trap 'rm -rf "$ERRS" "$SHACACHE"' EXIT

if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_TOKEN="$("$HOME/.claude/scripts/gh-app-token.sh" 2>/dev/null || true)"
  [[ -z "$GH_TOKEN" ]] && { echo "ERROR: could not mint an App token. Not falling back to the human account." >&2; exit 1; }
  export GH_TOKEN
fi

# Bounded retry. The dataset is ~1 REST call per PR-commit, which is squarely in the
# regime where GitHub returns transient 502s and secondary rate-limit errors; gh does
# not retry those itself. Measured: a clean run has 0 failures, but two heavy sweeps
# back to back produced 12. Retrying keeps "fail loudly" from degrading into "fails on
# any blip" - only an error that survives 3 attempts marks the dataset partial.
gh_retry() {
  local n=0
  until gh "$@"; do
    n=$((n + 1))
    (( n >= 3 )) && return 1
    # These are GitHub SECONDARY rate limits: the primary budget was measured at
    # 4280/5000 remaining while calls were failing, so it is burst rate, not quota.
    # They are genuinely transient and depend on what ran BEFORE this script: the same
    # 2-day window produced 36 failures right after two heavy sweeps and 0 failures
    # from a quiet start. Retry absorbs the small case; the refusal below catches the
    # large one rather than reporting a rate off a partial dataset.
    sleep $(( n * 5 ))
  done
}

SINCE="$(date -u -d "${DAYS} days ago" +%Y-%m-%d)" || { echo "ERROR: bad days arg '${DAYS}'" >&2; exit 1; }
[[ -z "$SINCE" ]] && { echo "ERROR: empty SINCE" >&2; exit 1; }
echo "ai-review churn - $REPO, PRs updated since $SINCE"
echo

prs="$(gh_retry pr list --repo "$REPO" --state all --limit 400 \
        --json number,updatedAt,title \
        --jq "[.[] | select(.updatedAt >= \"${SINCE}\")] | .[] | \"\(.number)\t\(.title)\"")" \
  || { echo "ERROR: gh pr list failed - refusing to report an empty measurement as a result." >&2; exit 1; }
[[ -z "$prs" ]] && { echo "No PRs updated in the last $DAYS days."; exit 0; }

tot=0; c_success=0; c_neutral=0; c_failure=0; c_other=0
fp_runs=0; skippable=0; nofp=0; prs_seen=0; prs_with_skip=0; offslug=0
report=""

while IFS=$'\t' read -r pr title; do
  [[ -z "$pr" ]] && continue
  # The commits fetch records APIFAIL too. It previously did not: a failure here
  # emitted no SHAs, `rows` came back empty, and the PR was dropped by the `continue`
  # below with apifails still 0, so the refusal guard never fired and the rate was
  # biased DOWN. That is precisely the fail-quietly defect this script exists to
  # refuse, left live in half the code by the claim that it had been fixed.
  if ! shas="$(gh_retry api --paginate "repos/$REPO/pulls/$pr/commits" --jq '.[].sha' 2>>"$ERRS")"; then
    echo "APIFAIL" >>"$ERRS"
    continue
  fi
  rows="$(
    printf '%s\n' "$shas" |
    while read -r sha; do
      [[ -z "$sha" ]] && continue
      # ONE emit path for both cache-hit and fresh, so the two cannot disagree about
      # trailing newlines. They previously did: the cache was written with `printf
      # '%s'` and read with `cat`, so on a hit the next commit's rows were appended to
      # the last cached row, `sort -u` merged them, and the parser read the wrong
      # fields - dropping one run and corrupting another's fingerprint.
      # Only SUCCESSFUL fetches are cached; caching a failure would replay it as
      # "this SHA had no runs" for every later PR sharing the SHA.
      cached="$SHACACHE/$sha"
      if [[ ! -f "$cached" ]]; then
        if out="$(gh_retry api --paginate "repos/$REPO/commits/$sha/check-runs?per_page=100&filter=all&check_name=ai-review" \
          --jq '.check_runs[]
                | select(.name == "ai-review" and .status == "completed")
                | [ (.started_at // .completed_at // "0"),
                    (.conclusion // "?"),
                    (.app.slug // "?"),
                    ( [ (.output.title // ""), (.output.summary // ""), (.output.text // "") ]
                      | join("\n") | capture("patch-fingerprint:(?<fp>[0-9a-f]{64})").fp? // "-" )
                  ] | @tsv' 2>>"$ERRS")"; then
          if [[ -n "$out" ]]; then printf '%s\n' "$out" > "$cached"; else : > "$cached"; fi
        else
          echo "APIFAIL" >>"$ERRS"
          continue
        fi
      fi
      cat "$cached"
    done | sort -u
  )"
  [[ -z "$rows" ]] && continue
  prs_seen=$((prs_seen + 1))

  # >>> churn-count (executed verbatim by review-churn-count.test.ts)
  declare -A passed=()   # fingerprints a PRIOR passing run already covered
  pr_skip=0; pr_fp=0
  while IFS=$'\t' read -r _ts concl slug fp; do
    [[ -z "${concl:-}" ]] && continue
    tot=$((tot + 1))
    case "$concl" in
      success) c_success=$((c_success + 1)) ;;
      neutral) c_neutral=$((c_neutral + 1)) ;;
      failure) c_failure=$((c_failure + 1)) ;;
      *)       c_other=$((c_other + 1)) ;;
    esac
    [[ "$slug" != "$REVIEWER_SLUG" ]] && offslug=$((offslug + 1))
    if [[ "$fp" == "-" ]]; then nofp=$((nofp + 1)); continue; fi

    # DENOMINATOR: any fingerprinted run. Its own conclusion is irrelevant, because a
    # run that gets skipped never produces one.
    fp_runs=$((fp_runs + 1)); pr_fp=$((pr_fp + 1))
    if [[ -n "${passed[$fp]:-}" ]]; then
      skippable=$((skippable + 1)); pr_skip=$((pr_skip + 1))
    fi
    # ELIGIBILITY BELONGS HERE: only a passing, allowlisted run can be re-attested FROM.
    if [[ "$concl" == "success" && "$slug" == "$REVIEWER_SLUG" ]]; then passed[$fp]=1; fi
  done <<< "$rows"
  # <<< churn-count
  unset passed

  if (( pr_skip > 0 )); then
    prs_with_skip=$((prs_with_skip + 1))
    report+="$(printf '  #%-6s %2d/%-2d  %s' "$pr" "$pr_skip" "$pr_fp" "${title:0:52}")"$'\n'
  fi
done <<< "$prs"

# grep -c PRINTS "0" and EXITS 1 when it matches nothing, so `|| echo 0` appends a
# second line and the arithmetic below dies on "0\n0". Let the `||` supply only the
# exit status, never more output.
apifails="$(grep -c APIFAIL "$ERRS" 2>/dev/null || true)"
apifails="${apifails:-0}"

echo "ai-review runs seen:               $tot   across $prs_seen PRs"
echo "  success:                         $c_success"
echo "  neutral (machinery self-exempt): $c_neutral"
echo "  failure:                         $c_failure"
echo "  other:                           $c_other"
echo "  from a non-allowlisted app:      $offslug"
echo "  carrying no fingerprint:         $nofp"
echo
echo "carrying a fingerprint:            $fp_runs   <- denominator"
echo "  ...patch already passed earlier: $skippable"
echo "effective sample (PRs):            $prs_seen   ($prs_with_skip with a repeat)"
echo

if (( apifails > 0 )); then
  echo "REFUSING TO REPORT: $apifails API call(s) failed, so this dataset is partial."
  echo "A partial fetch deletes repeats and silently deflates the rate. Re-run."
  exit 1
fi
if (( fp_runs < 20 )) || (( prs_seen < 10 )); then
  echo "SAMPLE TOO SMALL ($fp_runs runs / $prs_seen PRs) - do NOT decide #1840 on this."
  echo "Repeats cluster inside a PR, so runs are not independent observations."
  exit 0
fi

pct="$(awk -v d="$skippable" -v p="$fp_runs" 'BEGIN{printf "%.1f", (100*d)/p}')"
mach="$(awk -v n="$c_neutral" -v t="$tot" 'BEGIN{printf "%.1f", t?(100*n)/t:0}')"
echo "SKIPPABLE: ${pct}% of fingerprinted runs re-reviewed an already-passed patch."
echo
[[ -n "$report" ]] && { echo "PRs with repeats:"; printf '%s' "$report"; echo; }
cat <<EOF
How to read this for #1840:
  NOT a ceiling. Hidden same-SHA runs and force-pushed-away history both delete real
  repeats from this dataset, so the true skippable count can exceed the figure above.
  Treat it as a floor with unknown slack.

  THE STRUCTURAL LIMIT, which no sample size fixes: findReattestableVerdict can only
  re-attest FROM a completed+success run. Machinery PRs always conclude neutral, so
  re-attestation can never skip one - yet they are ${mach}% of runs here, and each
  burns the full voter panel before self-exempting (ai-review.yml maps the verdict to
  neutral well after the voter steps have run). The largest block of repeat spend is
  out of reach of the design as proposed.

  Against any saving, weigh the cost recorded on #1840: an identical patch can still
  merge differently because the base moved (the #1394 class), so re-attestation trades
  back part of what strict buys.
EOF
