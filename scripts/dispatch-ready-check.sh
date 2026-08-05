#!/usr/bin/env bash
# dispatch-ready-check.sh — pure deterministic dispatch-readiness gate (#406, #983).
#
# `agent-ready` is stamped ONCE at triage and then never re-checked. Between the
# drain ENUMERATING the agent-ready issues and the dispatcher actually LAUNCHING one
# (the drain processes issues sequentially, so a slow earlier build defers later
# ones by many minutes), the issue may have been closed, re-triaged to needs-review,
# or quarantined. Dispatching on that stale point-in-time stamp builds a
# no-longer-ready issue. This gate re-validates the issue's CURRENT state at
# dispatch time, deterministically.
#
# ── #983: the label is a STAMP of a verdict, never the verdict ────────────────
# ROOT CAUSE this closes: the checks below (state + countermanding labels) only ever
# asked whether a countermanding signal is PRESENT — they never asked whether an
# affirming verdict EXISTS and STILL HOLDS. So ANY writer of the `agent-ready` label
# (a human clicking it in the GitHub UI, a bulk `gh issue edit`, any script)
# inherited the triage gate's authority without ever passing through it: nothing
# re-computed tier or human_only at dispatch. Confirmed in production — five
# hand-flipped issues (#118/#299/#326/#357/#440) dispatched and burned build-agent
# tokens; one of them was `human-only-type`. Only the weaker model-trusted DR-355
# self-escalation caught them. This is the repo's recurring validator-asymmetry
# class (a validator that checks present-and-resolving, never missing).
#
# The fix: dispatch now REQUIRES a machine-readable VERDICT RECORD written by the
# gate itself (triage-inbox.sh, via --render-record below) and refuses without one.
# The record is keyed to a `bodyHash` of the issue body AS TRIAGED, so it is
# FALSIFIABLE — edit the issue after triage and the hash stops matching, the verdict
# is stale, and dispatch holds until a re-triage regenerates it.
#
# WHY THE RECORD GRAMMAR LIVES HERE (in the READER, not the writer): a format that
# two files each half-know is a format that drifts. This script both RENDERS the
# record (--render-record, called by triage-inbox.sh) and PARSES it, so writer and
# reader are the same code by construction and the round-trip is unit-testable.
#
# ── CORRECTION (2026-07-31): the paragraph that used to sit here was WRONG ───
# It read: "Anyone with WRITE ACCESS could hand-craft a record comment … a forged
# record must also carry a correct sha256 of the exact triaged body."
#
# This repo is PUBLIC. Both halves fail: writing the comment needs no permission at
# all, and the `bodyHash` is no obstacle because the issue body is public, so the
# hash is computable by anyone. A HASH BINDS CONTENT, NEVER AUTHORSHIP — it was
# doing real work against *staleness* and none whatever against *forgery*, and the
# two were conflated. Recorded in DR-072 §5.
#
# Two things now stand where that reasoning did:
#   1. `--trusted-comment-bodies` — records are read only from comments whose AUTHOR
#      could legitimately write one (this gate's App, or OWNER/MEMBER/COLLABORATOR).
#   2. `--newest-record` — selection is by the record's own `verdictAt`, not by
#      position, because comment authorship is NOT record authorship: trusted writers
#      republish text they did not author (a maintainer quoting a past verdict; the
#      dispatcher echoing a build agent's summary verbatim).
#
# STILL OPEN, and stated so it is not mistaken for closed: a COLLABORATOR-authored
# *triage* record is accepted, so the boundary is "people with write access" rather
# than "the gate itself"; `approvedBy` is self-declared on the CLI path; and the
# existing corpus has never been audited for an already-planted record. All #1105.
#
# ── #1084: the gate needed an EXIT, not just an entrance ─────────────────────
# Closing the hole above left `needs-review` a one-way door: dispatch demanded a
# verdict with hold=none, and the only writer of such a verdict was the LLM triage
# gate — which, re-run, re-derives the same hold. A human who had reviewed an issue
# and wanted to say "I've read it, go" had NO way to. A gate that refuses valid work
# is worse than the hole it closed, so this adds the missing exit — through the gate,
# never around it:
#
#   scripts/approve-issue.sh <N>  mints a SECOND record schema
#   (minspec-human-approval/1) carrying the approving human's identity, and the
#   reader below accepts it on the same terms as a triage verdict PLUS two extra
#   conjuncts: a non-bot `approvedBy`, and a `supersedes` naming a hold a human is
#   permitted to lift.
#
# WHICH HOLDS A HUMAN MAY LIFT (DR-072 §3 — the table that owns this policy; derived from DR-070 §5, whose absolutes it may never widen):
#   tier    ✅ "too big to auto-build". Human review is EXACTLY the designed remedy.
#   human   ❌ human_only is a CONTENT class (marketing/positioning/legal/copy/
#              decide), i.e. who may AUTHOR it — not who may permit it. No keystroke
#              transfers authorship, so no approval lifts it. Absolute.
#   info    ❌ the gate asked for missing information; approval does not supply it.
#   unknown ❌ the gate concluded nothing, so there is nothing to approve. Re-triage.
# A mis-CLASSIFIED issue is cured by fixing the input (edit the body so the type is
# unambiguous, then re-triage — the bodyHash changes, so that is a real re-verdict),
# never by overriding the classifier's output.
#
# ── #1169 / DR-076: a SECOND affirmative outcome — specify-only ──────────────
# An auto-buildable T3/T4 no longer parks on `hold: tier` waiting for a human to read
# the raw issue. `triage-decide.sh` now resolves it to `agent-ready-specify` /
# `hold: specify`, which this gate ADMITS — for the Specify phase only. DR-076 funds
# one human read on such an item and spends it on the finished spec, not on the
# unrefined issue body the Specify phase exists to replace.
#
# Two properties keep that from being a widening of the IMPLEMENT path:
#   1. The gate says WHICH mode it authorised, in its own stdout: `ready` (full
#      build) vs `ready-specify` (spec only). The dispatcher branches on that string
#      and on nothing else, so it cannot mistake one for the other. Silence would
#      have been the hole — a gate that admitted T3/T4 without naming the limit.
#   2. `decision` and `hold` must AGREE — agent-ready goes with hold none, and
#      agent-ready-specify with hold specify, never any other pairing. A crossed
#      record is refused rather than resolved to its permissive half, so no single
#      mutated field turns a spec authorisation into a build one.
# The MODE is read from the RECORD, never from the label — that is #983's whole
# thesis, and re-deriving it from `agent-ready-specify` would reinstate exactly the
# label-as-authority hole this file exists to close.
#
# Usage:
#   dispatch-ready-check.sh <state> <labels-csv> <verdict-source-file> <body-file>
#     <state>               the issue's CURRENT state from `gh issue view --json state`
#                           (OPEN | CLOSED, case-insensitive).
#     <labels-csv>          the issue's CURRENT labels, comma-separated (label NAMES).
#                           May legitimately be empty (an issue with no labels).
#     <verdict-source-file> a file holding the TRUSTED comment bodies (the dispatcher
#                           pipes `gh issue view --json comments` through
#                           `--trusted-comment-bodies`). The record with the NEWEST
#                           `verdictAt` wins — not the textually last — so a re-triage
#                           supersedes an earlier verdict while a stale record QUOTED
#                           inside a later comment cannot.
#     <body-file>           a file holding the issue body AS COMPOSED FOR TRIAGE
#                           ("# " + title + "\n\n" + body), used to recompute bodyHash.
#
#   dispatch-ready-check.sh --render-record <decision> <role> <tier> <human_only> <hold> [verdictAt]
#     Issue body on stdin. Prints the comment-embeddable verdict record. This is the
#     WRITER half of the same grammar — triage-inbox.sh's only way to mint a record.
#
#   dispatch-ready-check.sh --render-approval <approvedBy> <role> <tier> <supersedes> [approvedAt]
#     Issue body on stdin. Prints a HUMAN-APPROVAL record (#1084) — the same grammar,
#     a different schema. approve-issue.sh's only way to mint one.
#
#   dispatch-ready-check.sh --may-approve <hold> <human_only>
#     Pure predicate: may a human approval lift this hold? Prints "approvable" (exit 0)
#     or "not-approvable [<code>]: <reason>" (exit 1). It lives HERE, beside the reader
#     that enforces the same rule, so approve-issue.sh (which holds credentials and is
#     therefore not unit-testable) contains no policy of its own to drift.
#
# Exit 0  → STILL DISPATCHABLE. Prints "ready" (full build) or "ready-specify"
#           (#1169: Specify phase only — the caller MUST run a specify-only agent
#           and must not implement). A caller that ignores the distinction and
#           builds on "ready-specify" defeats the gate; that is why the two strings
#           differ rather than the mode riding on a label the caller re-reads.
# Exit 1  → NOT DISPATCHABLE. Prints one line: "not-ready [<code>]: <reason>".
#           Codes, and how the dispatcher treats each:
#             closed | no-label | countermanded  — the #406 staleness classes: an
#               expected, self-evident skip (the issue's own state/labels already
#               say why). Quiet.
#             no-verdict | stale-verdict | bad-schema | human-only | held |
#             decision | no-body | no-hash | no-approver | bot-approver |
#             bad-supersedes | no-verdictat | bad-verdictat | future-verdict —
#               the #983/#1084/#1113 verdict classes: a HOLD that
#               is NOT self-evident from the issue, so the dispatcher SURFACES it
#               (label + a one-time comment). A silent refusal would itself violate
#               "no silent gate" (DR-066). Anything unrecognised is surfaced too —
#               fail toward visible.
#
# DESIGN — only abort on CLEAR signals so valid work is NEVER falsely aborted (the
# #406 invariant): we REQUIRE open + agent-ready + a fresh affirming verdict, and
# additionally refuse when a label that explicitly means "a human must look at this"
# is present — a contradictory {agent-ready + needs-review} state resolves to "hold
# for a human", which is the safe direction. A refusal is always a HOLD: nothing is
# deleted, `agent-ready` is never silently stripped, and the issue is one re-triage
# (`scripts/triage-inbox.sh <N>`) away from dispatching again.
#
# SCOPE (in a comment here and in the dispatcher): this closes the label/open-state
# staleness cases and the unverdicted-label hole. Full dependency-graph freshness —
# re-checking that a linked SPEC's status is >= the phase this work needs, or that a
# linked DR is still `accepted` — is the architect-flagged follow-up and is OUT OF
# SCOPE here.
#
# PURE: no gh/git/network/side-effects (it only reads files the caller names), so it
# is unit-testable in isolation (tests/dispatch-ready-check.test.ts) and the
# dispatcher does the credentialed `gh issue view` itself, exactly as triage/review
# split fetch from decision.

set -uo pipefail

# ── The verdict-record grammar (single source of truth for writer AND reader) ──
# Bumping RECORD_SCHEMA invalidates every existing record: the reader refuses an
# unrecognised `gate:` value rather than guessing at fields it may not understand,
# and every issue is re-triaged. That is deliberate — fail closed on schema drift.
RECORD_SCHEMA="minspec-triage-verdict/1"
# The human-approval schema (#1084) is deliberately a SEPARATE value rather than a
# flag inside the triage record: the two are authorised by different parties, carry
# different required fields, and the dispatch audit trail must say which one let a
# build start. A reader that could not tell them apart would report "the gate passed
# it" for both.
RECORD_SCHEMA_HUMAN="minspec-human-approval/1"
# The holds a human approval may lift (DR-072 §3). A set, not a boolean, so widening
# it is a visible one-line diff in a tested file — never an emergent consequence of
# some other change.
#
# `specify` (#1169) joins `tier` because it IS the tier hold, partially released: the
# same "too big to auto-build" classification, with the Specify phase let through. If
# the set had not followed the rename, every T3/T4 item would have become
# un-approvable overnight and #1084's exit door — the human who has read the issue
# and wants the full build — would have silently closed. That is a NARROWING of the
# same authority, not a new one: nothing here lets an approval reach `human`, `info`
# or `unknown`, which stay absolute.
APPROVABLE_HOLDS="tier specify"
# The App login whose comments carry the gate's own verdict records. Defined ONCE,
# here, because every reader must agree on it. Its authorAssociation is CONTRIBUTOR,
# so association alone would reject the very writer every record comes from.
#
# ── The login form DEPENDS ON WHICH API YOU CALL (measured 2026-07-31) ────────
#   gh issue view --json comments   (GraphQL)  → "minspec-sdd"        ← bare
#   gh pr view    --json comments   (GraphQL)  → "minspec-sdd"        ← bare
#   gh api repos/../issues/N/comments (REST)   → "minspec-sdd[bot]"   ← bracketed
# Today all three readers use the GraphQL shape, so the bare form is what arrives. But
# nothing at the call site makes that visible, REST is a perfectly reasonable thing to
# switch to (`--paginate` alone is a good reason, and this repo already uses REST for
# the timeline), and getting it wrong fails in the WORST direction: the filter would
# silently drop every bot-authored record and the gate would refuse to dispatch
# anything, with no error to explain why. So the comparison normalises BOTH sides —
# lowercased, with a trailing `[bot]` stripped — and accepts either spelling.
#
# NOT `is_bot_identity`: that matches ANY `*[bot]` login, which would trust
# `github-actions[bot]`, `dependabot[bot]` and every future App installed on the repo
# to author verdict records. Only THIS gate's App may.
RECORD_BOT_LOGIN="minspec-sdd"
RECORD_MARKER="<!-- minspec-verdict-record -->"
RECORD_BEGIN="MINSPEC_VERDICT_BEGIN"
RECORD_END="MINSPEC_VERDICT_END"

# body_hash: sha256 of stdin, printed as "sha256:<hex>". Returns non-zero if no
# digest could be computed, so BOTH halves fail closed rather than treating an
# uncomputable hash as a match (an unfalsifiable record is worse than none).
body_hash() {
  local h
  h="$(sha256sum 2>/dev/null | awk '{print $1}')"
  [[ -n "$h" ]] || return 1
  printf 'sha256:%s' "$h"
}

# Record values come from the deterministic gate's fixed vocabulary, but they are
# rendered into a delimited block a parser later trusts — so constrain them here
# rather than assuming. Anything outside [A-Za-z0-9:._/-] is dropped, which makes a
# newline-bearing value unable to forge extra record fields.
#
# `[` and `]` are in the allowlist so a GitHub App login (`minspec-sdd[bot]`) renders
# FAITHFULLY. They were once excluded, which silently rewrote such a login to
# `minspec-sddbot` — and a record whose approvedBy names an account that does not
# exist is an audit trail that lies. Neither bracket can forge a field (that needs a
# newline or a colon, both still stripped).
record_scrub() { printf '%s' "$1" | tr -cd 'A-Za-z0-9:._/[]-'; }

# The NEWEST complete BEGIN..END range in the verdict source, by `verdictAt`.
#
# ── Why not simply the LAST one (as this did until 2026-07-31) ───────────────
# Taking the textually-last record assumed that position in the joined text tracks
# recency. It does not, and the gap is reachable with NO ATTACKER AT ALL:
#
#   `--trusted-comment-bodies` establishes authorship of the COMMENT. It cannot
#   establish authorship of the RECORD, because trusted writers republish text they
#   did not author. A maintainer writing "the first triage said: <pastes record> but
#   I re-ran it and it now wants review" puts a stale record LAST — and the gate then
#   dispatched an issue whose live verdict was `hold: tier`. Reproduced against a
#   `hold: human` / `human_only: yes` verdict too, i.e. it defeated the one hold this
#   design calls absolute. The same channel exists non-adversarially through
#   `dispatch-issue.sh`, which posts a build agent's `.agent-summary.md` verbatim
#   under a trusted identity.
#
# So recency is read from the record's OWN timestamp rather than inferred from where
# it happens to sit. A quoted record is always older than the verdict it is quoted
# beside, so it can no longer win. `verdictAt` is ISO-8601 UTC, which sorts
# lexicographically in chronological order — no date parsing required. Ties (same
# second) fall back to the later position, preserving the re-triage-supersedes rule.
#
# A record with no parseable `verdictAt` sorts below every dated one and is refused
# outright downstream, so this can never silently prefer an undated record.
newest_record() { _newest_record_impl < "$1"; }

# Implementation reads stdin so the `--newest-record` entry point and the reader
# below share ONE selector. The approval front ends each used to carry their own
# copy of "take the last record", which is how two of the three readers would have
# kept the quoted-record defect after the third was fixed.
_newest_record_impl() {
  awk -v b="$RECORD_BEGIN" -v e="$RECORD_END" '
    # NOTE: this awk program is bash single-quoted, so NO APOSTROPHES below — one
    # would close the quote and break the whole script. (It did, once.)
    #
    # Returns the verdictAt of a record ONLY when it is well-formed ISO-8601 UTC;
    # anything else returns "" so it sorts BELOW every dated record.
    #
    # The shape check is load-bearing, not decoration. Ranking is a lexical string
    # compare, and a malformed value like `not-a-date` compares ABOVE any real
    # timestamp because "n" > "2". So an unvalidated key let a garbled record win
    # selection from ANY position — and the reader then refused the whole issue with
    # `bad-verdictat`. That is the denial direction of this gate family: not a bypass,
    # but a way to make a perfectly good issue undispatchable until it is re-triaged.
    # (An earlier comment here claimed a bad value "sorts below every dated one".
    # That was true only of the EMPTY case; caught in review of PR #1127.)
    function verdict_at(block,   n, lines, i, v) {
      n = split(block, lines, "\n")
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /^[[:space:]]*[Vv][Ee][Rr][Dd][Ii][Cc][Tt][Aa][Tt][[:space:]]*:/) {
          v = lines[i]
          sub(/^[^:]*:[[:space:]]*/, "", v)
          gsub(/[[:space:]\r]/, "", v)
          if (v ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z$/)
            return v
          return ""
        }
      }
      return ""
    }
    index($0, b) { buf = ""; inb = 1 }
    inb          { buf = buf $0 "\n" }
    index($0, e) {
      if (inb) {
        at = verdict_at(buf)
        # >= not > : equal timestamps keep the LATER record, so a re-triage in the
        # same second still supersedes the verdict it replaces.
        if (!seen || at >= best_at) { best_at = at; best = buf; seen = 1 }
        inb = 0
      }
    }
    END { printf "%s", best }
  ' 2>/dev/null
}

# Exposed so the credentialed approval front ends select a record with THIS code
# rather than each carrying its own "take the last one" awk — which is exactly how
# two of the three readers would have retained the quoted-record defect after the
# third was fixed. Verdict source on stdin; prints the winning record block.
if [[ "${1:-}" == "--newest-record" ]]; then
  _newest_record_impl
  exit 0
fi

# is_bot_identity <login> — true for GitHub App / bot logins. Load-bearing in BOTH
# halves (approve-issue.sh refuses to mint under one; the reader refuses to honour
# one), so that the autonomous pipeline — which writes as `minspec-sdd[bot]` — can
# never mint the human keystroke it exists to wait for.
is_bot_identity() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    # `*[bot]` is GitHub's own suffix for every App identity, so it generalises to
    # bots this repo has never seen. The two literals cover this pipeline's own
    # identities in their bare form, since that is what a hand-forged record would
    # most plausibly carry. A human login ending in "bot" (talbot, abbot) is
    # deliberately NOT matched — the suffix rule is the bracketed form only.
    *'[bot]'|'github-actions'|'minspec-sdd') return 0 ;;
    *) return 1 ;;
  esac
}

# Exposed as an entry point so approve-issue.sh asks THIS file rather than carrying a
# second copy of the rule — two files half-knowing one predicate is how they drift.
if [[ "${1:-}" == "--is-bot-identity" ]]; then
  is_bot_identity "${2-}" && exit 0
  exit 1
fi

# ── PURE: keep only comments whose AUTHOR could legitimately carry a verdict ──
# THE HOLE THIS CLOSES (found 2026-07-31 while building #1113): this repo is PUBLIC,
# so ANY GitHub user can comment on an issue — and every reader of a verdict record
# used to join ALL comment bodies and take the last record found. #983's own header
# says the record is "not bound to its AUTHOR" and reasons that forging one needs
# write access. That was WRONG on a public repo: crafting the comment needs no
# permission at all, and the `bodyHash` is no obstacle because the issue body is
# public and the hash is therefore computable by anyone.
#
# It was assumed that at least the `agent-ready` LABEL still required write access.
# That is ALSO false: `.github/ISSUE_TEMPLATE/agent-task.yml` declares
# `labels: ["agent-ready", "inbox"]`, so any internet user opening an Agent Task issue
# receives the label on creation. What actually stops that dispatching is #983's record
# requirement — the label alone is not, and never was, a permission boundary.
#
# So this filter is a PRECONDITION of shipping #1113, not an optional hardening: with
# the label freely obtainable, the record is the ONLY thing standing between a stranger
# and a build.
#
# Trust is by AUTHOR, which a comment body cannot alter about itself:
#   • the gate's own bot login (passed in — App identities read as CONTRIBUTOR, so
#     association alone would reject the very writer the records come from); or
#   • an authorAssociation of OWNER / MEMBER / COLLABORATOR.
# Everything else — CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE, absent — is dropped.
# Input: `gh issue view --json comments` output on stdin. Output: the joined bodies,
# oldest→newest, exactly the shape the reader already expects.
if [[ "${1:-}" == "--trusted-comment-bodies" ]]; then
  shift
  t_bot="${1-$RECORD_BOT_LOGIN}"
  [[ -n "$t_bot" ]] || t_bot="$RECORD_BOT_LOGIN"
  jq -r --arg bot "$t_bot" '
    # Normalise a login so the bare and `[bot]`-suffixed spellings of the SAME App
    # compare equal, and case can never matter. Applied to both sides.
    def botnorm: ascii_downcase | sub("\\[bot\\]$"; "");
    [ (.comments // [])[]
      | select(
          ($bot != "" and (((.author.login // "") | botnorm) == ($bot | botnorm)))
          or ((.authorAssociation // "") as $a
              | $a == "OWNER" or $a == "MEMBER" or $a == "COLLABORATOR")
        )
      | (.body // "")
    ] | join("\n")
  ' 2>/dev/null || {
    # Unparseable input ⇒ emit NOTHING. An empty verdict source makes the reader
    # refuse with `no-verdict`, which is the safe direction; echoing the raw input
    # through on error would defeat the entire filter.
    printf ''
    exit 1
  }
  exit 0
fi

# ── PURE PREDICATE: may a human approval lift this hold? (#1084) ──────────────
# Exported as its own entry point so the credentialed writer (approve-issue.sh) and
# the reader below decide by the SAME code, and so the policy is unit-testable
# without gh. Deny is the default: an unrecognised hold falls through to a refusal.
if [[ "${1:-}" == "--may-approve" ]]; then
  shift
  a_hold="$(printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  a_human="$(printf '%s' "${2-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

  # human_only is checked FIRST and independently of `hold`, mirroring the reader:
  # it is the one classification whose violation a build can never walk back, so it
  # is never inferred from a sibling field a garbled record could disagree with.
  if [[ "$a_human" != "no" ]]; then
    echo "not-approvable [human-only]: verdict records human_only='${a_human:-<missing>}'. human_only is a CONTENT class (marketing, positioning, copy, legal, decide) — it says who may AUTHOR the work, not who may permit it, so no approval lifts it (DR-072 §3). If the classification is WRONG, fix the input: make the issue body unambiguous about its type and re-triage."
    exit 1
  fi
  case "$a_hold" in
    none)
      echo "not-approvable [already-ready]: hold is already 'none' — this issue needs no approval; it is dispatchable as it stands."
      exit 1 ;;
    human)
      echo "not-approvable [hold-human]: hold='human' — see human_only above; absolute (DR-072 §3)."
      exit 1 ;;
    info)
      echo "not-approvable [hold-info]: hold='info' — triage could not size this issue and asked for more information. Approval does not supply it: add what is missing to the issue, then re-triage."
      exit 1 ;;
    unknown)
      echo "not-approvable [hold-unknown]: hold='unknown' — the gate reached no conclusion (no verdict block, or a garbled one), so there is no decision to approve. Re-triage with \`scripts/triage-inbox.sh <N>\`."
      exit 1 ;;
  esac
  if printf '%s\n' "$APPROVABLE_HOLDS" | tr ' ' '\n' | grep -Fxq -- "$a_hold"; then
    echo "approvable"
    exit 0
  fi
  echo "not-approvable [bad-hold]: hold='${a_hold:-<missing>}' is not a hold a human approval may lift (approvable: ${APPROVABLE_HOLDS}) — refusing rather than guessing."
  exit 1
fi

# ── WRITER: mint a verdict record (issue body on stdin) ───────────────────────
if [[ "${1:-}" == "--render-record" ]]; then
  shift
  r_decision="$(record_scrub "${1:?usage: --render-record <decision> <role> <tier> <human_only> <hold> [verdictAt]}")"
  r_role="$(record_scrub "${2:?--render-record needs <role>}")"
  r_tier="$(record_scrub "${3:?--render-record needs <tier>}")"
  r_human="$(record_scrub "${4:?--render-record needs <human_only>}")"
  r_hold="$(record_scrub "${5:?--render-record needs <hold>}")"
  r_at="$(record_scrub "${6:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}")"
  if ! r_hash="$(body_hash)"; then
    echo "ERROR: cannot compute bodyHash (sha256sum unavailable) — refusing to render an unfalsifiable verdict record." >&2
    exit 1
  fi
  # Fenced so the block renders as monospace in the GitHub comment (auditable by a
  # human) while staying trivially machine-extractable by the BEGIN/END sentinels.
  printf '%s\n' "$RECORD_MARKER"
  printf '```\n'
  printf '%s\n' "$RECORD_BEGIN"
  printf 'gate: %s\n'       "$RECORD_SCHEMA"
  printf 'decision: %s\n'   "$r_decision"
  printf 'role: %s\n'       "$r_role"
  printf 'tier: %s\n'       "$r_tier"
  printf 'human_only: %s\n' "$r_human"
  printf 'hold: %s\n'       "$r_hold"
  printf 'bodyHash: %s\n'   "$r_hash"
  printf 'verdictAt: %s\n'  "$r_at"
  printf '%s\n' "$RECORD_END"
  printf '```\n'
  exit 0
fi

# ── WRITER: mint a HUMAN-APPROVAL record (#1084; issue body on stdin) ─────────
# Emits `hold: none` + `decision: agent-ready` because that is what a human approval
# MEANS — the hold is lifted — while `supersedes:` preserves which hold was lifted,
# so the audit trail never loses the fact that this issue was once held and by what.
if [[ "${1:-}" == "--render-approval" ]]; then
  shift
  a_by="$(record_scrub "${1:?usage: --render-approval <approvedBy> <role> <tier> <supersedes> [approvedAt]}")"
  a_role="$(record_scrub "${2:?--render-approval needs <role>}")"
  a_tier="$(record_scrub "${3:?--render-approval needs <tier>}")"
  a_sup="$(record_scrub "${4:?--render-approval needs <supersedes>}")"
  a_at="$(record_scrub "${5:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}")"
  # Refuse at the WRITER too, not only at the reader: a record that could never be
  # honoured must never be minted, or the issue acquires an approval comment that
  # silently does nothing — a false signpost.
  if [[ -z "$a_by" ]] || is_bot_identity "$a_by"; then
    echo "ERROR: approvedBy='${a_by:-<empty>}' is empty or a bot identity — a human approval must name a human (#1084). Refusing to render." >&2
    exit 1
  fi
  if ! printf '%s\n' "$APPROVABLE_HOLDS" | tr ' ' '\n' | grep -Fxq -- "$a_sup"; then
    echo "ERROR: supersedes='${a_sup:-<empty>}' is not a hold a human approval may lift (approvable: ${APPROVABLE_HOLDS}). Refusing to render (DR-072 §3)." >&2
    exit 1
  fi
  if ! a_hash="$(body_hash)"; then
    echo "ERROR: cannot compute bodyHash (sha256sum unavailable) — refusing to render an unfalsifiable approval record." >&2
    exit 1
  fi
  printf '%s\n' "$RECORD_MARKER"
  printf '```\n'
  printf '%s\n' "$RECORD_BEGIN"
  printf 'gate: %s\n'       "$RECORD_SCHEMA_HUMAN"
  printf 'decision: %s\n'   "agent-ready"
  printf 'role: %s\n'       "$a_role"
  printf 'tier: %s\n'       "$a_tier"
  printf 'human_only: %s\n' "no"
  printf 'hold: %s\n'       "none"
  printf 'supersedes: %s\n' "$a_sup"
  printf 'approvedBy: %s\n' "$a_by"
  printf 'bodyHash: %s\n'   "$a_hash"
  printf 'verdictAt: %s\n'  "$a_at"
  printf '%s\n' "$RECORD_END"
  printf '```\n'
  exit 0
fi

# ── READER: the dispatch gate ─────────────────────────────────────────────────
STATE="${1:?usage: dispatch-ready-check.sh <state> <labels-csv> <verdict-source-file> <body-file>}"
LABELS_CSV="${2-}"      # optional: an issue may have zero labels
VERDICT_SRC="${3-}"     # REQUIRED: absence is itself a refusal (fail closed)
BODY_FILE="${4-}"       # REQUIRED: needed to recompute bodyHash

# Normalise state; gh emits OPEN | CLOSED.
state_uc="$(printf '%s' "$STATE" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"

# Exact (whole-label) membership test over the comma-separated set. `grep -Fxq`
# so a label like `agent-ready-later` can never satisfy a check for `agent-ready`.
has_label() {
  printf '%s' "$LABELS_CSV" \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | grep -Fxq -- "$1"
}

# refuse <code> <reason> — every non-dispatch exit goes through here, so the
# machine-readable code and the human sentence can never disagree.
refuse() { echo "not-ready [$1]: $2"; exit 1; }


# Single field out of the record block, trimmed; empty if absent.
record_field() {
  printf '%s\n' "$RECORD" \
    | { grep -iE "^[[:space:]]*$1[[:space:]]*:" || true; } \
    | head -1 \
    | sed -E "s/^[^:]*:[[:space:]]*//" \
    | tr -d '\r' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

if [[ "$state_uc" != "OPEN" ]]; then
  refuse closed "issue state is '${STATE}', not OPEN"
fi

# Either ready label satisfies the PRECONDITION; neither of them decides the MODE.
# `agent-ready-specify` (#1169) is what triage applies to an auto-buildable T3/T4, so
# refusing it here would make the gate reject the very work it authorised. Which of
# the two modes runs is read from the RECORD below — the label is a stamp (#983).
if ! has_label "agent-ready" && ! has_label "agent-ready-specify"; then
  refuse no-label "neither 'agent-ready' nor 'agent-ready-specify' is present"
fi

# Any explicit human-gate / quarantine label countermands a lingering agent-ready.
for gate in needs-review needs-info needs-human-review agent-quarantined; do
  if has_label "$gate"; then
    refuse countermanded "countermanding label '${gate}' present (re-triaged / quarantined since drain)"
  fi
done

# ── #983: the label got us this far; now the VERDICT has to actually exist ────
if [[ -z "$VERDICT_SRC" || ! -r "$VERDICT_SRC" ]]; then
  refuse no-verdict "no verdict source supplied to the gate (caller must pass the issue's comment bodies) — refusing rather than trusting the label alone"
fi

RECORD="$(newest_record "$VERDICT_SRC")"
if [[ -z "$RECORD" ]]; then
  refuse no-verdict "'agent-ready' is present but NO triage verdict record backs it — the label alone is not a verdict (#983). Re-triage with \`scripts/triage-inbox.sh <N>\` to mint one."
fi

r_gate="$(record_field gate)"
IS_HUMAN_APPROVAL=0
case "$r_gate" in
  "$RECORD_SCHEMA")       IS_HUMAN_APPROVAL=0 ;;
  "$RECORD_SCHEMA_HUMAN") IS_HUMAN_APPROVAL=1 ;;
  *) refuse bad-schema "verdict record declares gate '${r_gate:-<missing>}', which is neither '${RECORD_SCHEMA}' nor '${RECORD_SCHEMA_HUMAN}' — unrecognised schema, refusing rather than guessing. Re-triage to mint a current record." ;;
esac

# ── `verdictAt` is now load-bearing, so it has to be real ────────────────────
# Recency selection above reads this field, which makes an absent or future-dated
# timestamp a way to influence WHICH record wins. Both are refused.
#
# A future date is refused because a record cannot have been minted after now: it is
# the residual of the quoted-record class, where the quoted text is fabricated rather
# than copied. The clock bound is best-effort — if `date` cannot produce one we skip
# THIS check rather than refuse everything, because the primary control (newest
# `verdictAt` wins) needs no clock at all, and a gate that refuses all work because a
# date utility is missing would be a far worse failure than the one it guards.
r_at="$(record_field verdictAt)"
if [[ -z "$r_at" ]]; then
  refuse no-verdictat "verdict record carries no verdictAt — recency cannot be established, and an undated record can never be shown to be the current one. Re-triage."
fi
if ! [[ "$r_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  refuse bad-verdictat "verdict record's verdictAt '${r_at}' is not ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ) — refusing rather than guessing at its recency."
fi
if _skew_bound="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" && [[ -n "$_skew_bound" ]]; then
  if [[ "$r_at" > "$_skew_bound" ]]; then
    refuse future-verdict "verdict record is dated ${r_at}, which is in the future (now+1h is ${_skew_bound}) — a verdict cannot have been minted after it was read."
  fi
fi

# Freshness FIRST: a record that is not about the issue as it stands now says
# nothing about it, whatever its other fields claim.
r_hash="$(record_field bodyHash)"
if [[ -z "$r_hash" ]]; then
  refuse stale-verdict "verdict record carries no bodyHash — it cannot be shown to describe the CURRENT issue. Re-triage."
fi
if [[ -z "$BODY_FILE" || ! -r "$BODY_FILE" ]]; then
  refuse no-body "no issue-body file supplied to the gate, so the verdict's bodyHash cannot be re-verified — refusing (fail closed)"
fi
if ! now_hash="$(body_hash < "$BODY_FILE")"; then
  refuse no-hash "could not recompute the issue-body hash (sha256sum unavailable) — refusing rather than accepting an unverifiable verdict"
fi
if [[ "$now_hash" != "$r_hash" ]]; then
  refuse stale-verdict "the issue body has changed since it was triaged (verdict bodyHash ${r_hash} != current ${now_hash}) — the verdict describes a different issue. Re-triage with \`scripts/triage-inbox.sh <N>\`."
fi

# Independent of `hold`, on purpose: human_only is the one classification whose
# violation is never recoverable by a build, so it is asserted directly rather than
# inferred from a sibling field that a malformed/forged record could disagree with.
r_human="$(printf '%s' "$(record_field human_only)" | tr '[:upper:]' '[:lower:]')"
if [[ "$r_human" != "no" ]]; then
  refuse human-only "verdict records human_only='${r_human:-<missing>}' — a human-only issue never auto-builds, whatever labels say (#983)"
fi

# `hold` names the branch the triage gate actually fired. TWO values are affirmative
# and they authorise different things (#1169):
#   none     → full build
#   specify  → the Specify phase ONLY; implementation still waits on the human's
#              spec approval
# human/tier/info/unknown are all refusals (and `unknown` is the fail-closed default,
# so a garbled verdict lands here too). MODE is the variable the caller acts on; it is
# set here and nowhere else, so there is exactly one place that decides it.
r_hold="$(printf '%s' "$(record_field hold)" | tr '[:upper:]' '[:lower:]')"
case "$r_hold" in
  none)    MODE="ready"; EXPECT_DECISION="agent-ready" ;;
  specify) MODE="ready-specify"; EXPECT_DECISION="agent-ready-specify" ;;
  *) refuse held "verdict holds this issue: hold='${r_hold:-<missing>}' (only 'none' = full build and 'specify' = spec-only are auto-buildable outcomes) — a human gate applies" ;;
esac

# Defense in depth: the hold already implies the decision, so a record that disagrees
# with itself is refused rather than resolved to its permissive half. This is what
# stops ONE mutated field from converting a spec authorisation into a build one — the
# pair has to be forged consistently, and the bodyHash above still has to match.
r_decision="$(printf '%s' "$(record_field decision)" | tr '[:upper:]' '[:lower:]')"
if [[ "$r_decision" != "$EXPECT_DECISION" ]]; then
  refuse decision "verdict decision is '${r_decision:-<missing>}', but hold='${r_hold}' requires '${EXPECT_DECISION}' — record is inconsistent with its own hold, refusing"
fi

# ── #1084: extra conjuncts a HUMAN-APPROVAL record must also satisfy ──────────
# Checked last, so a stale or self-inconsistent approval is reported by the more
# informative shared code above rather than being masked by an approver complaint.
if [[ "$IS_HUMAN_APPROVAL" -eq 1 ]]; then
  r_by="$(record_field approvedBy)"
  if [[ -z "$r_by" ]]; then
    refuse no-approver "human-approval record names no approvedBy — an unattributed human approval is not a human approval (#1084). Re-approve with \`scripts/approve-issue.sh <N>\`."
  fi
  if is_bot_identity "$r_by"; then
    refuse bot-approver "human-approval record was minted by the bot identity '${r_by}' — the autonomous pipeline may never mint the human keystroke it exists to wait for (#1084). A human must run \`scripts/approve-issue.sh <N>\`."
  fi
  r_sup="$(printf '%s' "$(record_field supersedes)" | tr '[:upper:]' '[:lower:]')"
  if ! printf '%s\n' "$APPROVABLE_HOLDS" | tr ' ' '\n' | grep -Fxq -- "$r_sup"; then
    refuse bad-supersedes "human-approval record claims to lift hold '${r_sup:-<missing>}', which no approval may lift (approvable: ${APPROVABLE_HOLDS}) — human_only, info and unknown holds are absolute (DR-072 §3)."
  fi
fi

# The mode the caller must honour — "ready" (full build) or "ready-specify" (#1169).
echo "$MODE"
exit 0
