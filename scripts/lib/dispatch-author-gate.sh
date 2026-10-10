#!/usr/bin/env bash
# scripts/lib/dispatch-author-gate.sh - whose text may start an agent.
#
# One definition, sourced by scripts/triage-inbox.sh and scripts/dispatch-issue.sh. An
# issue is triaged or dispatched only when its AUTHOR is on the list below, and comment
# text reaches an agent's prompt only from a commenter who is.
#
# ── Why this exists ───────────────────────────────────────────────────────────
# Neither launcher asked GitHub who wrote the issue: the field was not in either
# `gh issue view`. Every gate between a label and a launch judged something else. The
# readiness gate (dispatch-ready-check.sh, #983) checks who wrote the triage RECORD,
# which is the bot that had just triaged the issue, so it vouches for triage having run
# and not for the text triage ran on. The claim is about concurrency and the quota gate
# about capacity. This repository is public, an issue form applies the `inbox` label for
# whoever fills it in, and the agent that is eventually started runs the project's own
# build, which the launcher itself calls "executing arbitrary code by definition". So the
# question of whose text that is has to be answered by code, before a model reads it.
#
# ── The rule: a login on a list ───────────────────────────────────────────────
# NOT "is a collaborator" and NOT "has write access". Both are properties of an account
# that somebody can grant later for an unrelated reason, and a person given access to
# review or to push is not thereby a person whose text may start an agent. Adding one is
# an edit to this file, reviewed like any other.
#
# The entries are the pipeline's own App and the founder. GitHub gives an App's login in
# different forms depending on the field and the API, so the App is listed in both forms
# an ISSUE AUTHOR can take:
#
#   gh issue view --json author      (GraphQL, rendered by gh)   app/minspec-sdd
#   gh api repos/.../issues/N        (REST)                      minspec-sdd[bot]
#
# The bare `minspec-sdd` is deliberately NOT an entry. Neither form above can be a
# person's login (`/` and `[` are not characters a login may contain), and the bare form
# can. See dispatch_trusted_comments for the one place the bare form is met.
#
# ── No switch, no override ────────────────────────────────────────────────────
# The list is literals in a function body, compared exactly. There is no variable to
# set, so nothing in the environment adds a login or turns the gate off, and every
# variable this file reads is a lowercase local or a positional parameter
# (dispatch-author-gate.test.ts holds it to that). A gate with an off switch is a gate
# the next urgent morning switches off.
#
# ── Fail closed, and say so ───────────────────────────────────────────────────
# An author that cannot be read is a refusal in the same words as any other, never a
# pass (constitution invariant 2). These functions decide and describe; the launcher
# that calls them prints the refusal, naming the issue, and chooses its exit.
#
# Sourced, not executed. It defines functions and does nothing else: no network, no
# trap, no output.

# shellcheck shell=bash

# The list. One login per line.
_dispatch_trusted_authors() {
  printf '%s\n' \
    'app/minspec-sdd' \
    'minspec-sdd[bot]' \
    'harvest316'
}

# dispatch_author_trusted <login>: exit 0 iff the login is on the list.
#
# Compared as a whole string, quoted on both sides. That matters for `minspec-sdd[bot]`:
# unquoted it would be a pattern, and `[bot]` would match any one of b, o and t.
dispatch_author_trusted() {
  local login="${1-}" listed
  [[ -n "$login" ]] || return 1
  while IFS= read -r listed; do
    if [[ "$login" == "$listed" ]]; then return 0; fi
  done <<< "$(_dispatch_trusted_authors)"
  return 1
}

# A login as it may be PRINTED: only the characters a login (in any of the forms above)
# can have, and no more than 64 of them.
#
# A refusal names the author, and that author is the one party here who is not trusted.
# The drain reads its dispatcher's output for the CLI's limit notice and for the
# autocompact signature, so a login echoed as written could be made to read as either.
# The apostrophe is not in the set, which is what makes quoting it in a message safe.
_dispatch_printable_login() {
  local raw="${1-}" kept
  kept="$(printf '%s' "$raw" | LC_ALL=C tr -cd 'A-Za-z0-9._/[]-')"
  kept="${kept:0:64}"
  if [[ "$kept" == "$raw" ]]; then
    printf '%s' "$kept"
  else
    printf '%s (other characters removed)' "$kept"
  fi
}

# dispatch_author_check <issue-json>: may an agent be started on this issue?
#
#   <issue-json>  what `gh issue view <N> --json author,...` printed.
#
# Prints ONE line and returns:
#   0  the author's login. It is on the list.
#   1  why not, worded to follow "Refusing #<N> — ": either the author is not on the
#      list, or it could not be read.
#
# "Could not be read" is everything that is not exactly one non-empty string at
# `.author.login` of one JSON object: a missing field, a null, a number, a list, a
# document that does not parse, two documents, no jq to parse it with. None of those is
# evidence about who wrote the issue, so none of them passes.
dispatch_author_check() {
  local doc="${1-}" login
  # Slurped, so the whole input is counted before any of it is believed: one document is
  # an issue, and two are not, whichever of them carries a login.
  if ! login="$(printf '%s' "$doc" | jq -ers '
        if length == 1 then .[0] else empty end
        | if type == "object" then .author else empty end
        | if type == "object" then .login else empty end
        | select(type == "string" and length > 0)' 2>/dev/null)"; then
    printf '%s\n' 'its author could not be read, and an author that cannot be read is never trusted'
    return 1
  fi
  if dispatch_author_trusted "$login"; then
    printf '%s\n' "$login"
    return 0
  fi
  printf "its author '%s' is not on the dispatch author list\n" "$(_dispatch_printable_login "$login")"
  return 1
}

# dispatch_trusted_comments [<what>]: keep only the comments an agent may be shown.
#
#   stdin   what `gh issue view|pr view <N> --json comments` printed.
#   stdout  the same document, with `.comments` cut down to those whose author is on the
#           list. Order and every other field are untouched.
#   stderr  one line when anything was dropped: how many, on <what>, and from whom.
#   <what>  names the thing for that line, e.g. "pull request 77". Caller's own words.
#
# DROPPED, NOT REFUSED. A comment from somebody who is not on the list is removed and the
# rest goes on. Refusing the whole run instead would let anyone who can comment stop it,
# which on a public repository is anyone: the gate would become a way to deny work, and
# the text it was protecting the agent from never needed the run to stop.
#
# NEVER SILENTLY. Dropped text is the reason an agent may act differently from what a
# reader of the thread expects, so the line says it happened.
#
# ── The one place the bare login is accepted ─────────────────────────────────
# `gh ... --json comments` gives a comment's author as a login and nothing else, and for
# an App that login is the bare slug: `minspec-sdd`, with no `app/` in front and no
# `[bot]` behind (measured 2026-07-31, see RECORD_BOT_LOGIN in dispatch-ready-check.sh).
# So a commenter is on the list when the login is an entry, or when `app/<login>` is.
# That is the same reading the verdict-record reader already makes of this field, and it
# is weaker than the issue-author check above: nothing in this document says whether a
# bare `minspec-sdd` is the App or a person's account of that name. Telling them apart
# needs the author's TYPE, which this field does not carry (REST does). Until a caller
# reads comments that way, this function narrows who is trusted to the list and does not
# settle that one question.
#
# A document that cannot be read yields NO comments, a non-zero status and a line saying
# so: `{"comments":[]}` on stdout, so a caller that pipes this on gets nothing rather
# than everything.
dispatch_trusted_comments() {
  local what="${1:-these comments}" doc listed result total dropped names
  doc="$(cat)"
  if ! listed="$(_dispatch_trusted_authors | jq -R . | jq -s -c .)" || [[ -z "$listed" ]]; then
    listed=""
  fi
  result=""
  if [[ -n "$listed" ]]; then
    result="$(printf '%s' "$doc" | jq -c --argjson listed "$listed" '
      def on_list: . as $l | ($l | type) == "string" and any($listed[]; . == $l or . == ("app/" + $l));
      def trusted: type == "object" and (.author | type) == "object" and (.author.login | on_list);
      # A login as it may be printed: the same characters _dispatch_printable_login keeps.
      def printable:
        explode
        | map(select((. >= 48 and . <= 57) or (. >= 65 and . <= 90) or (. >= 97 and . <= 122)
                     or . == 45 or . == 46 or . == 47 or . == 91 or . == 93 or . == 95))
        | implode | .[0:64];
      def who:
        if type == "object" and (.author | type) == "object" and (.author.login | type) == "string"
        then (.author.login | printable) else "unreadable-author" end;
      if type != "object" or (.comments | type) != "array" then error("not a list of comments") else . end
      | [ .comments[] | select(trusted | not) | who ] as $out
      | { doc: (.comments |= map(select(trusted))),
          total: (.comments | length),
          dropped: ($out | length),
          names: ($out | unique | if length > 10 then (.[0:10] + ["and \(length - 10) more"]) else . end | join(", ")) }
      ' 2>/dev/null)" || result=""
  fi
  # Exactly one result. None is unreadable input (or no jq); two is two documents.
  if [[ -z "$result" || "$result" == *$'\n'* ]]; then
    echo "dispatch-author-gate: could not read the comments on ${what}, so no comment text is given to the agent." >&2
    printf '%s\n' '{"comments":[]}'
    return 1
  fi
  total="$(printf '%s' "$result" | jq -r '.total')"
  dropped="$(printf '%s' "$result" | jq -r '.dropped')"
  names="$(printf '%s' "$result" | jq -r '.names')"
  if [[ "$dropped" != "0" ]]; then
    echo "dispatch-author-gate: dropped ${dropped} of ${total} comment(s) on ${what} from author(s) not on the dispatch author list: ${names}. Their text is not given to the agent." >&2
  fi
  printf '%s' "$result" | jq -c '.doc'
}
