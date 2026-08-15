#!/usr/bin/env bash
# triage-inbox.sh — triage inbox issues into agent-ready / agent-ready-specify /
#                   needs-review / needs-info
# Usage: scripts/triage-inbox.sh [issue-number]
#
# `agent-ready-specify` (#1169, implementing DR-076) is the outcome for an
# auto-buildable T3/T4: the agent may write the SPEC and must stop there, so the
# human's single review moves off the raw issue and onto the finished spec. The
# vocabulary the AGENT emits is unchanged — the deterministic gate derives the class
# from tier (see triage-decide.sh).
#
# Without args: processes all issues labeled 'inbox'
# With arg: triages single issue
#
# Security model (mirrors dispatch-issue.sh): the issue body is UNTRUSTED
# (prompt-injection surface). The triage AGENT therefore gets NO credentials and
# CANNOT mutate labels — it only emits a verdict block. This PARENT script feeds
# that verdict through the deterministic gate (triage-decide.sh) and applies the
# result with gh. An injected "make this agent-ready" cannot reach the label.
#
# ── Verdict RECORD, not just a label (#1002, enabling #983) ──────────────────
# A label is a lossy, point-in-time STAMP: it says a gate once ran, never what it
# concluded, and ANY writer (a human in the GitHub UI, a bulk `gh issue edit`) can
# apply it without passing through the gate at all. So alongside the labels this
# script persists the gate's actual verdict as a delimited, machine-readable block
# inside the bot triage comment — GitHub-side, shared, auditable, and surviving a
# fresh clone (no local state file to strand). dispatch-ready-check.sh REQUIRES
# that record before it will dispatch, so an unverdicted `agent-ready` now holds
# instead of building.
#
# The record carries a `bodyHash` of the issue body AS TRIAGED, which makes the
# verdict falsifiable: edit the issue after triage and the hash no longer matches,
# so dispatch refuses as stale and the issue is re-triaged. Ordering below is
# deliberate — the RECORD is posted BEFORE the labels, so there is never a window
# in which `agent-ready` exists with no verdict behind it.
#
# The record's GRAMMAR is owned by the reader (dispatch-ready-check.sh
# --render-record), never re-implemented here: one file writes and parses it, so
# writer and reader cannot drift into two dialects of the same format.
#
# Re-triage is therefore the ONLY way to (re)authorise dispatch, and it is complete:
# it mints a record for the body as it now stands AND clears the outcome labels the
# new verdict supersedes — including `needs-human-review`, which dispatch applies
# when it holds. Without that clearing, a held issue would re-triage to a perfectly
# good agent-ready verdict and then be countermanded by the leftover hold label,
# stranding real work. (`agent-quarantined` is deliberately NOT cleared: that is a
# security quarantine from the egress guard, and only a human retires it.)

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="${SCRIPT_DIR}/roles"
# shellcheck source=scripts/lib/agent-context.sh
source "${SCRIPT_DIR}/lib/agent-context.sh"
# Agent writes carry the BOT's identity, never the human's (#1355). This arms a
# `gh` wrapper; acquiring the token is LAZY, so reads pass through untouched and
# only the first WRITE mints — aborting there, loudly, if it cannot.
# shellcheck source=scripts/lib/gh-bot.sh
source "${SCRIPT_DIR}/lib/gh-bot.sh"
gh_bot_init

DECIDE="${SCRIPT_DIR}/triage-decide.sh"
READY_CHECK="${SCRIPT_DIR}/dispatch-ready-check.sh"
SHADOW="${SCRIPT_DIR}/shadow-triage.sh"

# One `key=value` line out of `triage-decide.sh --fields` output.
verdict_field() {
  printf '%s\n' "$2" | { grep -E "^$1=" || true; } | head -1 | cut -d= -f2-
}

triage_issue() {
  local ISSUE="$1"

  if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Invalid issue number: $ISSUE" >&2
    return 1
  fi

  local ISSUE_JSON ISSUE_BODY ISSUE_TITLE
  ISSUE_JSON=$(gh issue view "$ISSUE" --repo "$REPO" --json body,title,labels)
  ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '"# " + .title + "\n\n" + .body')
  ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')

  echo "Triaging: #$ISSUE — $ISSUE_TITLE"

  local USER_CONTENT
  USER_CONTENT=$(cat <<CONTENT
<untrusted_issue_body>
${ISSUE_BODY}
</untrusted_issue_body>

Repo: ${REPO}
Issue number: ${ISSUE}

Classify this issue per your role instructions (apply the human-only type filter
FIRST, then tier). You CANNOT edit labels or run any command — the dispatcher
applies your verdict.

\`decision: agent-ready\` means "an agent may start on this", NOT "an agent may build
all of it". For an auto-buildable T3/T4 the deterministic gate converts it into a
SPECIFY-ONLY dispatch (DR-076 / #1169) — so do not withhold it just because the work
is large. Withhold it when the issue is human-only, or when you cannot judge it
auto-buildable at all. Emit EXACTLY ONE verdict block, and nothing after it:

TRIAGE_VERDICT_BEGIN
decision: agent-ready | needs-review | needs-info
role: dev | architect | security | reviewer
tier: T1 | T2 | T3 | T4
human_only: yes | no
rationale: <one line — for needs-review say tier-complexity vs human-only-type; for needs-info say what is missing>
TRIAGE_VERDICT_END
CONTENT
)

  # Agent runs with NO tools: it classifies tier from the issue TEXT alone and
  # can only return text. The issue body is UNTRUSTED (prompt-injection surface),
  # so per the global `claude -p` Subprocess Rule #1 (DR-345 / FiverrGigmeister
  # DR-002) it gets NO filesystem/network tool — granting Read over untrusted
  # input is an arbitrary-file-read / cred-exfil hole (`claude -p` resolves
  # absolute paths OUTSIDE cwd; cwd is not a sandbox boundary), so the tool is
  # ELIMINATED, not justified by triage.md's anti-injection prose (#344). `--tools
  # ""` disables the entire built-in tool set. We capture the returned text.
  local AGENT_OUT
  AGENT_OUT=$("${AGENT_ENV_SCRUB[@]}" claude -p "$USER_CONTENT" \
    --system-prompt-file "${ROLES_DIR}/triage.md" \
    "${AGENT_CONTEXT_ARGS[@]}" \
    --tools "" \
    --output-format text 2>&1) || {
      echo "WARNING: triage agent failed for #$ISSUE — leaving in inbox" >&2
      return 0
    }

  # Deterministic gate → the normalised verdict, as key=value fields. `--fields`
  # (not the space-joined default line) because the RECORD must carry the gate's own
  # view of tier / human_only, and re-parsing the agent's raw text here would be a
  # second parser of the same format — the classic way a gate and its record drift.
  local FIELDS LABEL ROLE HOLD TIER HUMAN_ONLY
  FIELDS=$(printf '%s\n' "$AGENT_OUT" | "$DECIDE" --fields || true)
  LABEL=$(verdict_field label "$FIELDS")
  ROLE=$(verdict_field role "$FIELDS")
  HOLD=$(verdict_field hold "$FIELDS")
  TIER=$(verdict_field tier "$FIELDS")
  HUMAN_ONLY=$(verdict_field human_only "$FIELDS")

  if [[ -z "$LABEL" || -z "$ROLE" || -z "$HOLD" || -z "$TIER" || -z "$HUMAN_ONLY" ]]; then
    echo "WARNING: no verdict parsed for #$ISSUE — leaving in inbox" >&2
    return 0
  fi

  # Pull the agent's rationale line for the triage comment (best-effort).
  local RATIONALE
  RATIONALE=$(printf '%s\n' "$AGENT_OUT" \
    | sed -n '/TRIAGE_VERDICT_BEGIN/,/TRIAGE_VERDICT_END/p' \
    | { grep -iE '^[[:space:]]*rationale[[:space:]]*:' || true; } \
    | head -1 | sed -E 's/^[^:]*:[[:space:]]*//')
  [[ -z "$RATIONALE" ]] && RATIONALE="(no rationale emitted)"

  # Mint the machine-readable verdict record, keyed to the body we just triaged.
  # FAIL CLOSED: if the record cannot be rendered we apply NO labels at all —
  # an `agent-ready` with no verdict behind it is precisely the #983 hole, and
  # producing one here would be worse than leaving the issue untriaged.
  local RECORD
  if ! RECORD=$(printf '%s' "$ISSUE_BODY" | "$READY_CHECK" --render-record \
                  "$LABEL" "$ROLE" "$TIER" "$HUMAN_ONLY" "$HOLD"); then
    echo "ERROR: could not render the verdict record for #$ISSUE — refusing to apply any label (an unverdicted label is the #983 hole). Left as-is." >&2
    return 1
  fi

  # PARENT applies the verdict (credentialed op — never the agent).
  echo "  → #$ISSUE: $LABEL (role:$ROLE · tier:$TIER · hold:$HOLD)"

  # `gh issue edit --add-label` resolves label NAMES against the repo's label set and
  # fails the whole request on an unknown one — and this script runs under
  # `set -euo pipefail`, so a repo that has never seen `agent-ready-specify` (#1169)
  # would abort the ENTIRE drain on the first T3/T4 verdict, not just skip an issue.
  # Create it idempotently first. Best-effort is safe HERE and only here: the label is
  # a cosmetic stamp, and if creation genuinely fails the `--add-label` below still
  # fails LOUDLY, and dispatch then refuses with `no-label`. Nothing passes silently.
  if [[ "$LABEL" == "agent-ready-specify" ]]; then
    gh label create "agent-ready-specify" --repo "$REPO" --color 0e8a16 \
      --description "Auto-buildable T3/T4 — dispatch the SPECIFY phase only; the human approves the spec before any implementation (DR-076 / #1169)" \
      2>/dev/null || true
  fi

  # #1002 — the HOLD REASON as a label, so the backlog is machine-addressable.
  # `triage-decide.sh` computes WHY an issue is not fully auto-buildable and, until now,
  # that reason survived only inside the verdict record. `needs-review` was byte-identical
  # whether the bounce was a human-only content class, T3/T4 ceremony, missing information,
  # or the fail-closed default — so "how many are held purely on tier?" could not be
  # answered without re-running an LLM over the corpus.
  #
  # `none` gets NO label: it is the absence of a hold, and a `hold:none` sticker on every
  # dispatchable issue would be noise on the one class nobody needs to filter for.
  #
  # Created idempotently for the same reason as above — an unknown label name fails the
  # whole `--add-label` request under `set -euo pipefail`, which would abort the drain.
  local HOLD_LABEL=""
  if [[ -n "$HOLD" && "$HOLD" != "none" ]]; then
    HOLD_LABEL="hold:${HOLD}"
    gh label create "$HOLD_LABEL" --repo "$REPO" --color cfd3d7 \
      --description "Held — reason recorded by triage (#1002)" 2>/dev/null || true
  fi

  # RECORD FIRST, labels second — so `agent-ready` never exists, even momentarily,
  # without the verdict that authorises it.
  gh issue comment "$ISSUE" --repo "$REPO" \
    --body "$(printf '**Triage:** `%s` · role:`%s` · tier:`%s` · hold:`%s`\n%s\n\n%s\n\n— auto-triaged (`triage-inbox.sh`); verdict enforced by the deterministic gate (`triage-decide.sh`). The block above is the machine-readable verdict record that `dispatch-ready-check.sh` requires before any dispatch (#983). It is keyed to the issue body as triaged — edit the issue and this verdict goes stale, so re-run `scripts/triage-inbox.sh %s`.' \
        "$LABEL" "$ROLE" "$TIER" "$HOLD" "$RATIONALE" "$RECORD" "$ISSUE")" >/dev/null

  gh issue edit "$ISSUE" --repo "$REPO" \
    --add-label "role:${ROLE},${LABEL}${HOLD_LABEL:+,${HOLD_LABEL}}" >/dev/null

  # Clear the outcome labels this verdict SUPERSEDES. Load-bearing for the
  # agent-ready branch: dispatch labels a held issue `needs-human-review`, which
  # countermands `agent-ready` — so without this, a re-triage could mint a valid
  # verdict that the stale hold label then vetoes forever. Best-effort + LOUD
  # (never silent, DR-066): a failure here holds the issue, it never releases it.
  # The two ready labels supersede EACH OTHER as well (#1169). A T3/T4 re-triaged
  # from `agent-ready-specify` up to plain `agent-ready` (or an issue whose tier fell
  # the other way) must not end up wearing both: the dispatcher would then see a
  # ready label whose class disagrees with the record it is about to read.
  local SUPERSEDED
  case "$LABEL" in
    agent-ready)          SUPERSEDED="inbox,needs-review,needs-info,needs-human-review,agent-ready-specify" ;;
    agent-ready-specify)  SUPERSEDED="inbox,needs-review,needs-info,needs-human-review,agent-ready" ;;
    needs-review)         SUPERSEDED="inbox,agent-ready,agent-ready-specify,needs-info" ;;
    needs-info)           SUPERSEDED="inbox,agent-ready,agent-ready-specify,needs-review" ;;
    *)                    SUPERSEDED="inbox" ;;
  esac

  # A re-triage that changes the hold must not leave the OLD hold:* label behind: two
  # contradicting reasons on one issue is worse than none, and this label exists to be
  # queried. Every hold:* except the one just applied is superseded, including when the
  # new verdict is `none` (HOLD_LABEL empty) — an issue that became dispatchable must
  # stop claiming it is held.
  #
  # ONLY the ones this issue ACTUALLY HAS. `hold:*` labels are created lazily (just the
  # current one, above), so most do not exist repo-wide — and naming a nonexistent label
  # makes `gh` reject the WHOLE remove request, which then falls into the retry below and
  # reports "could not clear superseded label(s)". That warning is load-bearing: it means
  # a human-gate label may be countermanding a valid verdict. Firing it routinely, for
  # labels that were never there, trains the reader to ignore the one time it is real.
  # (`backfill-hold-labels.sh` already guards this way; this is the same check.)
  local h CURRENT_LABELS
  CURRENT_LABELS=$(echo "$ISSUE_JSON" | jq -r '[.labels[].name] | join(",")')
  for h in human tier specify info unknown; do
    [[ "hold:${h}" == "$HOLD_LABEL" ]] && continue
    [[ ",${CURRENT_LABELS}," == *",hold:${h},"* ]] || continue
    SUPERSEDED="${SUPERSEDED},hold:${h}"
  done

  if ! gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$SUPERSEDED" >/dev/null 2>&1; then
    # `gh` resolves label NAMES against the repo's label set and fails the whole
    # request if any one of them does not exist there — which would leave EVERY
    # superseded label in place, `inbox` included, re-triaging this issue forever.
    # Retry one at a time so a single unknown name cannot veto the rest.
    local one failed=""
    IFS=',' read -r -a _sup <<< "$SUPERSEDED"
    for one in "${_sup[@]}"; do
      gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$one" >/dev/null 2>&1 || failed+="${one} "
    done
    if [[ -n "$failed" ]]; then
      echo "WARNING: could not clear superseded label(s) on #$ISSUE: ${failed}— if a human-gate label lingers it will keep countermanding this verdict at dispatch; clear it by hand." >&2
    fi
  fi

  # ── Shadow-triage instrument (#1338) — measurement only, never a control ────
  # Runs GLM (z.ai) on the SAME prompt and pushes its output through the SAME gate
  # binary, purely to record whether the two agree. It runs LAST, after every label
  # and the verdict record are already applied, so nothing above can wait on a
  # third-party endpoint. INERT until MINSPEC_SHADOW_TRIAGE_KEY is set.
  #
  # The call site is the shadow-only guarantee, and it is three properties, not a
  # promise: stdout is discarded (so no verdict can be captured), the exit status is
  # discarded (so it cannot branch anything), and the result is bound to no variable.
  # There is deliberately no `$(...)` here for a later edit to make load-bearing.
  # `|| true` is correct HERE and would be a DR-066 violation on a gate — see the
  # fail-safe rationale in shadow-triage.sh (this signal reaches no decision).
  if [[ -x "$SHADOW" ]]; then
    local SHADOW_PROMPT SHADOW_FIELDS_FILE
    SHADOW_PROMPT="$(mktemp)"
    SHADOW_FIELDS_FILE="$(mktemp)"
    printf '%s' "$USER_CONTENT" > "$SHADOW_PROMPT"
    printf '%s\n' "$FIELDS" > "$SHADOW_FIELDS_FILE"
    "$SHADOW" record --issue "$ISSUE" --repo "$REPO" \
      --prompt-file "$SHADOW_PROMPT" --live-fields "$SHADOW_FIELDS_FILE" >/dev/null || true
    rm -f "$SHADOW_PROMPT" "$SHADOW_FIELDS_FILE"
  fi

  echo "Triage complete for #$ISSUE"
}

if [[ "${1:-}" ]]; then
  triage_issue "$1"
else
  ISSUES=$(gh issue list --repo "$REPO" --label "inbox" --json number -q '.[].number')
  if [[ -z "$ISSUES" ]]; then
    echo "No inbox issues found."
    exit 0
  fi
  for ISSUE in $ISSUES; do
    # One LLM call per issue, so a large inbox can outlive the ~1h installation
    # token. Re-mint when it is near expiry (#1412). No-op with headroom, and a
    # no-op for a CI-supplied token, so the cost is nil on a short run.
    gh_bot_refresh
    triage_issue "$ISSUE"
  done
fi
