#!/usr/bin/env bash
# scripts/lib/dispatch-author-gate.sh - whose text may start an agent.
#
# One definition, sourced by scripts/triage-inbox.sh, scripts/dispatch-issue.sh and
# scripts/remediate-pr.sh. An issue is triaged or dispatched only when everyone who WROTE
# ITS TEXT is on the list below: who opened it, everyone who has edited its body, and
# everyone who has changed its title. Comment text reaches an agent's prompt only from a
# commenter who is, and only when everyone who has edited that comment is too.
#
# It is also where every other reader learns WHICH ACCOUNT wrote a comment.
# scripts/dispatch-ready-check.sh reads the triage verdict record from comments, and it
# recognises the gate's own App with `listed` and the list below; a comment that reaches
# it with only a login is looked up here first (dispatch_identify_comments).
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
# ── The question is who wrote the TEXT, not who opened the issue ──────────────
# An issue's author is the account that created it. The body can afterwards be edited,
# and the title changed, by anyone with write access to the repository, and the author
# field does not move when they do. So "the author is on the list" says nothing about
# the words an agent is about to read. What is asked instead, of one GraphQL document:
#
#   author                          who opened it
#   editor, userContentEdits        who last edited the body, and everyone who ever did
#   timelineItems RENAMED_TITLE     everyone who changed the title
#
# Every one of them must be on the list. An edit or a rename by anyone else refuses the
# issue, whoever opened it and whoever edited it afterwards: a later edit by a listed
# account does not vouch for what an earlier one left in.
#
# AND THE TEXT JUDGED IS THE TEXT USED. That document is a second read, made after the
# `gh issue view` whose title and body the prompt is built from, so the two are compared:
# the title and body in the document that was judged must equal, exactly, the ones the
# launcher is holding. An issue edited between the two reads is refused, and offered
# again on the next cycle.
#
# ── The rule: an account on a list, by number and kind ───────────────────────
# NOT "is a collaborator" and NOT "has write access". Both are properties of an account
# that somebody can grant later for an unrelated reason, and a person given access to
# review or to push is not thereby a person whose text may start an agent. Adding one is
# an edit to this file, reviewed like any other.
#
# And NOT a login. A login is a name, and a name can be changed and then taken by
# somebody else; an App and a person can also be shown under the same one (the pipeline's
# App is `minspec-sdd` wherever GitHub shows a comment's author, and no person holds that
# login today, so anyone could). An entry is the account's KIND and its NUMBER, which
# GitHub assigns once and never reuses:
#
#   Bot:299695933    the pipeline's own App. REST shows it as `minspec-sdd[bot]` with
#                    this id, and the id is the number in its commit address.
#   User:4125483     the founder, `harvest316`.
#
# Read with `GET /users/<login>` (id, type) and confirmed against the GraphQL fields this
# file compares (`__typename`, `databaseId`) on 2026-10-10. A login is carried along only
# to be PRINTED in a refusal; nothing is decided by one. There is one source format
# (GraphQL) and one comparison (exact, on "<kind>:<id>"), with no prefix, no suffix and no
# second spelling to fall back to.
#
# ── What trusting the App leaves open ─────────────────────────────────────────
# The App is on the list because the pipeline files its own work as issues. That trusts
# more than one author: it trusts EVERY path that can make the App write, and whatever
# text that path put in what it wrote. Every such path found on 2026-10-10, in scripts/
# and .github/workflows/:
#
#   Issues, and whether somebody else's text can reach the body:
#   • scripts/tooling-radar/file-findings.mjs files `idea,inbox` issues as the App. YES:
#     the title and body are shaped by a model that read pages on the web, and its own
#     header says a hostile page "can shape the TEXT of an issue". `inbox` puts it in
#     front of triage.
#   • Interactive sessions park follow-ups and tangents as `inbox` issues under the App's
#     token (the repository's CLAUDE.md asks for the issue, the operator's own
#     instructions for the identity). YES: they quote whatever the session was reading,
#     which can be a pull request, a log, another issue or a web page.
#   • .github/workflows/main-red-watch.yml files as the App. NO: the body is a commit id,
#     a workflow name, job names and a run link, taken only from a push to `main`, and
#     its labels are `main-red` and `bug`, which no queue here reads.
#   • scripts/direct-push-audit.ts files under whatever credential its caller holds, and
#     no workflow in this repository calls it. Its body is commit ids, file paths and a
#     pusher's login from the audited push; its labels are `bug` and `security`.
#   • scripts/roles/architect.md tells a dispatched architect to file sub-issues. YES,
#     where it can: an agent is started without a GitHub token in its own environment
#     (lib/agent-context.sh), and that is a statement about one process. The agent runs
#     as the launcher's user, so a credential that user can reach is not out of the
#     agent's reach. What it filed would carry whatever the agent had been reading.
#   • .github/workflows/supply-chain-daily.yml files as `github-actions[bot]`, which is
#     NOT on the list: its issues are refused here and wait for a person.
#
#   Comments, which reach a fix agent through dispatch_pr_trusted_comments:
#   • .github/workflows/ai-review.yml posts each review verdict as the App. YES: the
#     verdict is written by a model that read the pull request's diff, and on a public
#     repository anyone can open a pull request.
#
# The YES rows are text a stranger can influence, arriving under an identity this list
# trusts. This file does NOT close that, and a rule here cannot: the gate sees which
# account wrote something, not where the words came from. What narrows it is on the
# writing side (a second identity, or a marker, for text the pipeline is relaying, held
# out of triage until a person has read it), and is not built. Until then the list means
# "filed by the pipeline or the founder", which is weaker than "written by them".
#
# ── No switch, no override ────────────────────────────────────────────────────
# The list is literals in a function body, compared exactly. There is no variable to
# set, so nothing in the environment adds an account or turns the gate off, and every
# variable this file reads is a lowercase local or a positional parameter
# (dispatch-author-gate.test.ts holds it to that). A gate with an off switch is a gate
# the next urgent morning switches off.
#
# ── Fail closed, and say so ───────────────────────────────────────────────────
# Whatever cannot be read is a refusal in the same words as any other, never a pass
# (constitution invariant 2): an account with no number, an edit history GitHub did not
# return in full, a document that does not parse, a read that failed. These functions
# decide and describe; the launcher that calls them prints the refusal, naming the issue,
# and chooses its exit.
#
# Sourced, not executed. It defines functions and does nothing else. The two functions
# that read from GitHub do so through gh_bot_graphql_read (lib/gh-bot.sh): a query, never
# a mutation, and a missing reader is a refusal like any other unreadable answer.

# shellcheck shell=bash

# _dispatch_graphql_read <gh api graphql arguments>: one declared read of GitHub.
#
# GraphQL answers nobody anonymous, and a declared read goes straight to `gh` without
# asking for a token (that is what declares it, lib/gh-bot.sh). The launchers make their
# other reads inside `$(...)`, where a token minted for one read is gone before the next,
# so nothing is necessarily in place by the time this runs. gh_bot_warm_read puts the
# pipeline's own read token there when nothing is. It never replaces a credential that is
# already present and it never fails, and when it can do nothing the read below fails
# instead, which is a refusal. Its own diagnosis is left on stderr.
#
# A FAILED READ SAYS WHY. The caller prints the refusal; this prints, on stderr, what
# `gh` said, because "could not be read" with no cause is a refusal nobody can act on (a
# dead credential and an outage read the same). One line, cut down to plain characters
# and 200 of them: it is `gh`'s own text, and it is printed where the drain reads.
_dispatch_graphql_read() {
  local said status=0
  if declare -F gh_bot_warm_read >/dev/null; then
    # Whatever it prints is diagnosis, never part of the answer that is captured.
    gh_bot_warm_read >&2
  fi
  # The answer goes to this function's stdout; what `gh` wrote to stderr is kept.
  { said="$(gh_bot_graphql_read "$@" 2>&1 >&3)" || status=$?; } 3>&1
  if (( status != 0 )); then
    said="$(printf '%s' "$said" | tr -c '[:alnum:] .,:()/_-' ' ' | head -c 200)"
    echo "dispatch-author-gate: the read of who wrote this failed (exit ${status}): ${said:-nothing was said}" >&2
  fi
  return "$status"
}

# The list. One account per line, as "<kind>:<id>".
#
# RESIDUAL RISK, stated where the entry is. `Bot:299695933` trusts every path that can
# make the App write, and not only words the pipeline composed itself. Two of the paths
# that file issues carry text a stranger can influence (the tooling radar, and issues
# parked by interactive sessions), and so do the review verdicts the App posts as
# comments. The full list is under "What trusting the App leaves open" above. Nothing in
# this file closes it, and removing the entry would stop the pipeline's own issues.
_dispatch_trusted_identities() {
  printf '%s\n' \
    'Bot:299695933' \
    'User:4125483'
}

# The list as a JSON array, for jq, which is where every comparison is made: one
# implementation of "is on the list" (`listed`, below), exact, on the whole string.
# Empty output means it could not be built.
_dispatch_trusted_identities_json() {
  _dispatch_trusted_identities | jq -R . | jq -s -c 'if length > 0 then . else empty end'
}

# What both jq programs below share: how an account is identified, whether it is on the
# list ($listed), and how one may be PRINTED.
#
# `shown` is for a refusal, and the account it names is the one party here who is not
# trusted. The drain reads its dispatcher's output for the CLI's limit notice and for the
# autocompact signature, so a login echoed as written could be made to read as either.
# Only the characters a login can have are kept, and no more than 64 of them; the
# apostrophe is not among them, which is what makes quoting it in a message safe.
_dispatch_gate_jq_defs() {
  cat <<'JQ'
def key:
  if type == "object" and (.__typename | type) == "string" and (.databaseId | type) == "number"
  then "\(.__typename):\(.databaseId)" else null end;
def listed: key as $k | $k != null and any($listed[]; . == $k);
def printable:
  explode
  | map(select((. >= 48 and . <= 57) or (. >= 65 and . <= 90) or (. >= 97 and . <= 122)
               or . == 45 or . == 46 or . == 47 or . == 91 or . == 93 or . == 95))
  | implode | .[0:64];
def shown:
  if type == "object" and (.login | type) == "string"
  then "'\(.login | printable)'" + (key as $k | if $k == null then "" else " (\($k | sub(":"; " ")))" end)
  else "an account that could not be read" end;
JQ
}

# The one fragment that reads an account: its kind, its number, and a name to print.
# Only a User and a Bot have a number here, so anything else has none and is unreadable.
_dispatch_actor_fields() {
  printf '%s' '__typename login ... on User { databaseId } ... on Bot { databaseId }'
}

# The refusal for anything that could not be read.
_dispatch_unreadable() {
  printf '%s' 'who wrote and edited it could not be read, and what cannot be read is never trusted'
}

# dispatch_issue_provenance_query: the query whose answer dispatch_issue_provenance_check
# judges. `first: 100` is a ceiling, and the check refuses when GitHub says there were more.
dispatch_issue_provenance_query() {
  cat <<GQL
query(\$owner: String!, \$name: String!, \$number: Int!) {
  repository(owner: \$owner, name: \$name) {
    issue(number: \$number) {
      number
      title
      body
      author { $(_dispatch_actor_fields) }
      editor { $(_dispatch_actor_fields) }
      lastEditedAt
      userContentEdits(first: 100) {
        totalCount
        nodes { editedAt editor { $(_dispatch_actor_fields) } }
      }
      timelineItems(itemTypes: [RENAMED_TITLE_EVENT], first: 100) {
        totalCount
        nodes { ... on RenamedTitleEvent { actor { $(_dispatch_actor_fields) } } }
      }
    }
  }
}
GQL
}

# dispatch_issue_provenance_check <provenance-json> <issue-view-json>
#
#   <provenance-json>  GitHub's answer to dispatch_issue_provenance_query.
#   <issue-view-json>  what `gh issue view <N> --json body,title,...` printed: the
#                      document the launcher builds its prompt from.
#
# Prints ONE line and returns:
#   0  who opened it, as "<login> (<kind> <id>)". Everyone who wrote its text is listed,
#      and that text is the text the launcher holds.
#   1  why not, worded to follow "Refusing #<N> — ".
#
# "Could not be read" is everything that is not exactly one well-formed answer and one
# well-formed view: a field that is missing, an account with no number, a history shorter
# than its own count, a document that does not parse, two documents where one belongs, no
# jq to parse it with. None of those is evidence about who wrote the issue, so none passes.
dispatch_issue_provenance_check() {
  local provenance="${1-}" view="${2-}" listed out
  if ! listed="$(_dispatch_trusted_identities_json 2>/dev/null)" || [[ -z "$listed" ]]; then
    printf '%s\n' "$(_dispatch_unreadable)"
    return 1
  fi
  # Each document is read as a stream of its own and COUNTED before it is believed: one
  # answer and one view, never two documents that together number two. Read from a file
  # descriptor, so neither meets the limit on the length of one argument.
  out=""
  if ! out="$(jq -rn --argjson listed "$listed" --arg unreadable "$(_dispatch_unreadable)" \
        --slurpfile answers <(printf '%s' "$provenance") --slurpfile views <(printf '%s' "$view") \
        "$(_dispatch_gate_jq_defs)"'
      def no($why): "no\t" + $why;
      if ($answers | length) != 1 or ($views | length) != 1 then no($unreadable)
      else $answers[0] as $p | $views[0] as $v
        | if ($p | type) != "object" or ($v | type) != "object" then no($unreadable)
          elif ($p | has("errors")) and ($p.errors != null) and ($p.errors != []) then no($unreadable)
          else (try $p.data.repository.issue catch null) as $i
            | if ($i | type) != "object"
                 or ([ "title", "body", "author", "editor", "lastEditedAt", "userContentEdits", "timelineItems" ] | all(. as $f | $i | has($f)) | not)
              then no($unreadable)
              elif ($i.title | type) != "string" or ($i.body | type) != "string"
                   or ($v.title | type) != "string" or ($v.body | type) != "string" then no($unreadable)
              elif $i.title != $v.title or $i.body != $v.body
              then no("its title or body changed while it was being checked, so the text that was judged is not the text that would be used")
              elif ($i.author | key) == null
              then no("its author could not be read, and an author that cannot be read is never trusted")
              elif ($i.author | listed | not)
              then no("its author \($i.author | shown) is not on the dispatch author list")
              else $i.userContentEdits as $e | $i.timelineItems as $r
                | if ($e | type) != "object" or ($e.totalCount | type) != "number" or ($e.nodes | type) != "array"
                     or ($r | type) != "object" or ($r.totalCount | type) != "number" or ($r.nodes | type) != "array"
                  then no($unreadable)
                  elif ($e.nodes | length) != $e.totalCount
                  then no("who edited its body could not be read in full (\($e.totalCount) edit(s) recorded, \($e.nodes | length) returned), and what cannot be read is never trusted")
                  elif ($r.nodes | length) != $r.totalCount
                  then no("who changed its title could not be read in full (\($r.totalCount) change(s) recorded, \($r.nodes | length) returned), and what cannot be read is never trusted")
                  else
                    ([ $e.nodes[] | (try .editor catch null) ]
                     + (if $i.lastEditedAt != null or $i.editor != null then [ $i.editor ] else [] end)) as $editors
                    | [ $r.nodes[] | (try .actor catch null) ] as $renamers
                    | if $i.lastEditedAt != null and $e.totalCount == 0
                      then no("its body has been edited and GitHub returned no record of by whom, and what cannot be read is never trusted")
                      elif any($editors[]; key == null)
                      then no("an account that edited its body could not be read, and what cannot be read is never trusted")
                      elif any($editors[]; listed | not)
                      then no("its body was edited by \(first($editors[] | select(listed | not)) | shown), who is not on the dispatch author list")
                      elif any($renamers[]; key == null)
                      then no("an account that changed its title could not be read, and what cannot be read is never trusted")
                      elif any($renamers[]; listed | not)
                      then no("its title was changed by \(first($renamers[] | select(listed | not)) | shown), who is not on the dispatch author list")
                      else "ok\t\($i.author.login | tostring | printable) (\($i.author | key | sub(":"; " ")))"
                      end
                  end
              end
          end
      end' 2>/dev/null)"; then
    out=""
  fi
  # Exactly one line, and one of the two answers. Anything else is not an answer.
  if [[ "$out" == *$'\n'* ]]; then out=""; fi
  case "$out" in
    $'ok\t'*) printf '%s\n' "${out#$'ok\t'}"; return 0 ;;
    $'no\t'*) printf '%s\n' "${out#$'no\t'}"; return 1 ;;
  esac
  printf '%s\n' "$(_dispatch_unreadable)"
  return 1
}

# dispatch_issue_gate <owner/repo> <issue-number> <issue-view-json>
#
# May an agent be started on this issue? Reads who wrote its text from GitHub and judges
# it against the document the launcher is holding. Prints one line and returns exactly as
# dispatch_issue_provenance_check does. A read that fails is a refusal that says so.
dispatch_issue_gate() {
  local repo="${1-}" issue="${2-}" view="${3-}" provenance
  if [[ "$repo" != */* || ! "$issue" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$(_dispatch_unreadable)"
    return 1
  fi
  # -f for the two names (never read as a file or a number), -F for the number (an Int).
  if ! provenance="$(_dispatch_graphql_read -f query="$(dispatch_issue_provenance_query)" \
        -f owner="${repo%%/*}" -f name="${repo#*/}" -F number="$issue")"; then
    printf '%s\n' 'who wrote and edited it could not be read from GitHub, and what cannot be read is never trusted'
    return 1
  fi
  dispatch_issue_provenance_check "$provenance" "$view"
}

# dispatch_pr_comments_query: the newest hundred comments on a pull request, each with
# who wrote it and who has edited it.
dispatch_pr_comments_query() {
  cat <<GQL
query(\$owner: String!, \$name: String!, \$number: Int!) {
  repository(owner: \$owner, name: \$name) {
    pullRequest(number: \$number) {
      comments(last: 100) {
        totalCount
        nodes {
          authorAssociation
          body
          createdAt
          author { $(_dispatch_actor_fields) }
          editor { $(_dispatch_actor_fields) }
          lastEditedAt
          userContentEdits(first: 20) {
            totalCount
            nodes { editor { $(_dispatch_actor_fields) } }
          }
        }
      }
    }
  }
}
GQL
}

# dispatch_trusted_comments [<what>]: keep only the comments an agent may be shown.
#
#   stdin   GitHub's answer to dispatch_pr_comments_query.
#   stdout  {"comments":[...]} in the shape `gh pr view --json comments` gives, holding
#           only the comments whose text was written by listed accounts, in order. Each
#           author carries the account's kind and number beside its login, which that
#           command does not give: a reader further on (the record filter,
#           dispatch-ready-check.sh --trusted-comment-bodies) decides by them, and a
#           login alone tells it nothing.
#   stderr  one line when anything was dropped: how many, on <what>, and whose; and one
#           when GitHub held more comments than the newest hundred that were read.
#   <what>  names the thing for those lines, e.g. "pull request #77". Caller's own words.
#
# A comment is kept when its AUTHOR is on the list AND so is everyone who has edited it.
# The second half matters as much as the first: anyone with write access can edit somebody
# else's comment, and the comment still shows its original author. So a comment whose
# last editor, or any editor in its history, is not listed is dropped, and so is one
# whose history GitHub did not return in full.
#
# DROPPED, NOT REFUSED. A comment that fails is removed and the rest goes on. Refusing
# the whole run instead would let anyone who can comment stop it, which on a public
# repository is anyone: the gate would become a way to deny work, and the text it was
# protecting the agent from never needed the run to stop.
#
# NEVER SILENTLY. Dropped text is the reason an agent may act differently from what a
# reader of the thread expects, so the line says it happened.
#
# A document that cannot be read yields NO comments, a non-zero status and a line saying
# so: `{"comments":[]}` on stdout, so a caller that pipes this on gets nothing rather
# than everything.
dispatch_trusted_comments() {
  local what="${1:-these comments}" doc listed result total read_n dropped names
  doc="$(cat)"
  result=""
  if listed="$(_dispatch_trusted_identities_json 2>/dev/null)" && [[ -n "$listed" ]]; then
    if ! result="$(printf '%s' "$doc" | jq -cs --argjson listed "$listed" "$(_dispatch_gate_jq_defs)"'
        def history_ok:
          has("editor") and has("lastEditedAt") and has("userContentEdits")
          and (.userContentEdits | type) == "object"
          and (.userContentEdits.totalCount | type) == "number"
          and (.userContentEdits.nodes | type) == "array"
          and (.userContentEdits.nodes | length) == .userContentEdits.totalCount
          and all(.userContentEdits.nodes[]; (try .editor catch null) | listed)
          and (if .lastEditedAt != null or .editor != null
               then (.editor | listed) and .userContentEdits.totalCount > 0
               else true end);
        def kept: type == "object" and (.body | type) == "string" and (.author | listed) and history_ok;
        def who:
          if type != "object" then "an account that could not be read"
          elif (.author | listed | not) then (.author | shown)
          else "\(.author | shown), in a comment that an account not on the list has edited or that could not be read in full"
          end;
        if length != 1 then error("not one document") else .[0] end
        | if type != "object" or ((has("errors")) and (.errors != null) and (.errors != [])) then error("not an answer") else . end
        | (try .data.repository.pullRequest.comments catch null) as $c
        | if ($c | type) != "object" or ($c.nodes | type) != "array" or ($c.totalCount | type) != "number"
          then error("not a list of comments") else . end
        | [ $c.nodes[] | select(kept | not) | who ] as $out
        | { doc: { comments: [ $c.nodes[] | select(kept)
                               | { author: { login: .author.login, __typename: .author.__typename, databaseId: .author.databaseId },
                                   authorAssociation, body, createdAt } ] },
            total: $c.totalCount,
            read: ($c.nodes | length),
            dropped: ($out | length),
            names: ($out | unique | if length > 10 then (.[0:10] + ["and \(length - 10) more"]) else . end | join(", ")) }
        ' 2>/dev/null)"; then
      result=""
    fi
  fi
  # Exactly one result. None is unreadable input (or no jq); two is two documents.
  if [[ -z "$result" || "$result" == *$'\n'* ]]; then
    echo "dispatch-author-gate: could not read the comments on ${what}, so no comment text is given to the agent." >&2
    printf '%s\n' '{"comments":[]}'
    return 1
  fi
  total="$(printf '%s' "$result" | jq -r '.total')"
  read_n="$(printf '%s' "$result" | jq -r '.read')"
  dropped="$(printf '%s' "$result" | jq -r '.dropped')"
  names="$(printf '%s' "$result" | jq -r '.names')"
  if [[ "$read_n" != "$total" ]]; then
    echo "dispatch-author-gate: ${what} has ${total} comments and only the newest ${read_n} were read. An older comment is not given to the agent." >&2
  fi
  if [[ "$dropped" != "0" ]]; then
    echo "dispatch-author-gate: dropped ${dropped} of ${read_n} comment(s) on ${what} whose text is not wholly from the dispatch author list: ${names}. Their text is not given to the agent." >&2
  fi
  printf '%s' "$result" | jq -c '.doc'
}

# dispatch_pr_trusted_comments <owner/repo> <pr-number>: read a pull request's comments
# from GitHub and keep the ones an agent may be shown. stdout, stderr and status are
# dispatch_trusted_comments'; a read that fails is the unreadable case.
dispatch_pr_trusted_comments() {
  local repo="${1-}" pr="${2-}" answer=""
  if [[ "$repo" == */* && "$pr" =~ ^[0-9]+$ ]]; then
    if ! answer="$(_dispatch_graphql_read -f query="$(dispatch_pr_comments_query)" \
          -f owner="${repo%%/*}" -f name="${repo#*/}" -F number="$pr")"; then
      answer=""
    fi
  fi
  printf '%s' "$answer" | dispatch_trusted_comments "pull request #${pr}"
}

# dispatch_identify_comments [<what>]: put the ACCOUNT on comments that arrived with only
# a login.
#
#   stdin   a document with a `comments` list, as `gh issue view --json comments` and
#           `gh pr view --json comments` print one. Each comment there has a login and no
#           account, and it has the comment's own id.
#   stdout  the same document. Every comment that had no account now has the one GitHub
#           says wrote the comment with that id: `author.__typename` and
#           `author.databaseId`, the two fields `listed` reads. A comment that already
#           had an account, or has no usable id to ask about, is passed on as it came.
#   status  1, with one line on stderr and NOTHING on stdout, when the document cannot
#           be read, when the read of GitHub fails, or when GitHub's answer does not
#           cover every comment that was asked about with the same text the document
#           has. All or nothing: a caller picks the NEWEST record among the comments it
#           trusts, so handing it some of them could make an older one the newest.
#   <what>  names the thing for that line. Caller's own words.
#
# It decides nothing about trust. It answers "which account", and the caller's rule,
# written with `listed`, answers the rest.
#
# WHY A LOGIN IS NOT ENOUGH. `gh issue view` shows the App's comments under the login
# `minspec-sdd`. That is the App's name, and nothing stops a person registering it as
# theirs: the two are different accounts with one spelling, and a rule written on the
# spelling trusts both. The kind and the number cannot be chosen by whoever registers.
#
# The ids go into the query as text, so each is held to the characters an id has before
# it is used. One that is anything else is not asked about, and its comment stays as it
# came: without an account.
dispatch_identify_comments() {
  local what="${1:-these comments}" doc ids batch list query answer found='{}' out
  doc="$(cat)"
  if ! ids="$(printf '%s' "$doc" | jq -r '
        if type != "object" then error("not a document") else . end
        | [ (.comments // [])[]
            | select(type == "object" and ((.author | type) != "object" or (.author.__typename | type) != "string"))
            | .id | select(type == "string" and test("^[A-Za-z0-9_=-]{1,128}$")) ]
        | unique | .[]' 2>/dev/null)"; then
    echo "dispatch-author-gate: could not read ${what}, so who wrote them was not looked up." >&2
    return 1
  fi
  while [[ -n "$ids" ]]; do
    batch="$(printf '%s\n' "$ids" | head -n 100)"
    ids="$(printf '%s\n' "$ids" | tail -n +101)"
    # The ids as a JSON list, which is also how GraphQL writes a list of strings.
    list="$(printf '%s\n' "$batch" | jq -R . | jq -s -c .)"
    query="query { nodes(ids: ${list}) { __typename ... on IssueComment { id body author { $(_dispatch_actor_fields) } } } }"
    if ! answer="$(_dispatch_graphql_read -f query="$query")"; then
      echo "dispatch-author-gate: could not read who wrote ${what}, so none of them is taken on its login." >&2
      return 1
    fi
    # What has been found so far holds the TEXT of every comment asked about, and how
    # much text that is is up to whoever writes comments. So it is read from a file
    # descriptor, like the answer beside it, and never put on jq's command line: one
    # argument may not be longer than 131,072 bytes, and past that jq is not started.
    if ! found="$(jq -c -n --slurpfile found <(printf '%s' "$found") --slurpfile answers <(printf '%s' "$answer") '
          if ($found | length) != 1 or ($answers | length) != 1 then error("not one document") else $answers[0] end
          | if type != "object" or (has("errors") and .errors != null and .errors != [])
               or ((try .data.nodes catch null) | type) != "array"
            then error("not an answer") else . end
          | reduce (.data.nodes[] | select(type == "object" and .__typename == "IssueComment" and (.id | type) == "string")) as $n
              ($found[0]; .[$n.id] = { body: $n.body, author: $n.author })' 2>/dev/null)" || [[ -z "$found" ]]; then
      echo "dispatch-author-gate: GitHub's answer about who wrote ${what} could not be read, so none of them is taken on its login." >&2
      return 1
    fi
  done
  # The same rule here: everything found, text and all, comes in by a file descriptor.
  if ! out="$(printf '%s' "$doc" | jq -c --slurpfile found <(printf '%s' "$found") '
        def bare: type == "object" and ((.author | type) != "object" or (.author.__typename | type) != "string");
        def askable: (.id | type) == "string" and (.id | test("^[A-Za-z0-9_=-]{1,128}$"));
        if ($found | length) != 1 then error("not one document") else . end
        | .comments = [ (.comments // [])[]
          | if bare and askable
            then ($found[0][.id]) as $f
                 | if $f == null or ($f.body | type) != "string" or $f.body != .body
                   then error("not covered")
                   else .author = (if ($f.author | type) == "object"
                                   then { login: $f.author.login, __typename: $f.author.__typename, databaseId: $f.author.databaseId }
                                   else null end)
                   end
            else . end ]' 2>/dev/null)" || [[ -z "$out" ]]; then
    echo "dispatch-author-gate: GitHub's answer does not cover every one of ${what} with the text that was read, so none of them is taken on its login." >&2
    return 1
  fi
  printf '%s\n' "$out"
}
