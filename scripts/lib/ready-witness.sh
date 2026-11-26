#!/usr/bin/env bash
# ready-witness.sh — has the `ready-to-merge` gate itself said this head is ready?
# (#4078)
#
# WHY. Agent-side readers (remediate-pr.sh, dispatch-issue.sh) used to act on the bare
# `ai-review:pass` label, or on any `ready-to-merge` commit status. Both are writable by
# the builder App (`minspec-sdd[bot]`) whose token every agent session can obtain, so a
# builder-written pass could steer the drain even though it can no longer satisfy the
# merge gate. The one witness the builder cannot write is a `ready-to-merge` status
# posted by GitHub Actions itself (`github-actions[bot]`, integration 15368, the
# integration the ruleset pins): ready-to-merge.yml posts it with the workflow's own
# GITHUB_TOKEN after checking the verdict's provenance against the reviewer allowlist.
# So a reader keys on that, and on nothing a session token can forge.
#
# RULE. Among every `ready-to-merge` status on the commit, the most recent decides
# (ties: the EARLIER list position, since the API lists newest first). It is a
# witness only if its state is `success` AND its creator is `github-actions[bot]`.
# A newer status from any other creator voids it, rather than being skipped over:
# fail closed, the same rule the guard applies to a newer `ai-review` check-run
# from another App.
#
#   source scripts/lib/ready-witness.sh
#   ready_witness_from_statuses < statuses.json   # pure: prints yes | no
#   ready_to_merge_witnessed <owner/repo> <sha>    # prints yes | no | error
#
# `error` is a failed read and is never `no` in disguise: a caller that cannot tell must
# not treat the head as unreviewed-but-known, nor as ready (constitution invariant 2).

READY_WITNESS_CREATOR='github-actions[bot]'

# Input: one JSON array of commit statuses, or several arrays back to back (the shape
# `gh api --paginate` emits). Output: yes | no. Unparseable input prints `error`.
ready_witness_from_statuses() {
  jq -rs --arg creator "$READY_WITNESS_CREATOR" '
    [ .[] | if type == "array" then .[] else empty end ]
    | to_entries
    | map(.value + {_i: .key} | select((.context // "") == "ready-to-merge"))
    | sort_by([(.created_at // ""), (0 - ._i)])
    | last
    | if . == null then "no"
      elif (.state // "") == "success" and ((.creator // {}).login // "") == $creator then "yes"
      else "no" end
  ' 2>/dev/null || echo error
}

ready_to_merge_witnessed() {
  local repo="$1" sha="$2" raw
  if [[ -z "$repo" || ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo error; return 0
  fi
  raw=$(gh api --paginate "repos/${repo}/commits/${sha}/statuses?per_page=100" 2>/dev/null) || {
    echo error; return 0
  }
  printf '%s' "$raw" | ready_witness_from_statuses
}
