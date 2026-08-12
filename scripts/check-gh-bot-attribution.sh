#!/usr/bin/env bash
#
# check-gh-bot-attribution.sh — fail if a shell script writes to GitHub without
# first taking a bot identity.
#
# THIS SCRIPT MUTATES NOTHING. It reads files and exits non-zero on a finding.
#
# ── Why this exists (#1355) ───────────────────────────────────────────────────
# minspec#995 required agent GitHub writes to be App-token attributed. That rule
# lived only in CLAUDE.md prose, and nothing obeyed it: at the time this guard
# was written, `grep -l gh-app-token scripts/*.sh` matched NOTHING across 76
# write call sites in 11 paths. Every agent-filed issue, comment, label and merge
# was recorded as the founder.
#
# The constitution's answer to a rule the model has to remember is to stop
# trusting the model and build the gate. This is that gate.
#
# ── The rule ──────────────────────────────────────────────────────────────────
# A file under scripts/ that CONTAINS a `gh` write verb MUST both
#   1. source lib/gh-bot.sh, AND
#   2. call gh_bot_init.
#
# BOTH, because the helper is inert until init: sourcing defines functions and
# variables, and only gh_bot_init creates the `gh` wrapper that is the entire
# mechanism. Source-without-init writes as the human.
#
# It does not check call-site-by-call-site. Once armed, the wrapper shadows the
# binary for the whole process, so one init covers every `gh` invocation in the
# file — reads pass through, writes mint first.
#
# ── Deliberate limits, stated so a reader does not over-trust this ────────────
#   * SHELL FILES ONLY (*.sh). `scripts/roles/*.md` are agent PROMPTS, not
#     executables — some do mention `gh pr review`, and review-branch.sh:122
#     explicitly instructs agents to ignore that step. A .ts/.mjs helper that
#     shelled out to `gh` would NOT be caught; none does today.
#   * TEXTUAL, not semantic. It greps for command-shaped lines. A write built by
#     string concatenation, or dispatched through a variable (`$GH issue ...`),
#     slips past. This raises the floor; it is not a proof.
#   * SUBSHELL BYPASS (#1413). The wrapper is a shell FUNCTION, so it covers this
#     process and its command-substitution subshells — but not a genuinely new
#     process, e.g. `bash -c 'gh issue comment ...'`, which would call the real
#     `gh` under whatever credential is ambient. It is deliberately NOT
#     `export -f`'d: that travels as BASH_FUNC_gh%% into EVERY descendant,
#     including the `claude -p` agents that are credential-free by design
#     (INV-5), and it would be bash-only anyway — a partial fix that reads as a
#     complete one. Instead the guard flags the common spelling below, so the gap
#     is loud rather than silent.
#   * Only FULL-LINE comments are stripped. A code line carrying a write-shaped
#     TRAILING comment (`some_cmd  # then gh pr create`) still matches and would
#     fail the file. That direction is the safe one — a false FAIL is visible and
#     one allowlist line or a reworded comment clears it, whereas a false PASS
#     ships the bug — so it is left as-is rather than made cleverer.
#   * The allowlist is the escape hatch, and every entry carries a reason.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "${HERE}/.." && pwd)}"
SCAN_DIR="${ROOT}/scripts"

# ── Allowlist: path → reason. A bare path with no reason is not permitted. ────
#
# approve-issue.sh   Human-only BY DESIGN: TTY-required, no `--yes`, and it
#                    refuses outright when `gh api user` resolves to a bot
#                    (approve-issue.sh:169 → dispatch-ready-check.sh
#                    --is-bot-identity). Its APPROVER *is* the authenticated
#                    human, so its writes SHOULD carry that human. Sourcing
#                    gh-bot.sh here would break approval entirely.
#
# review-branch.sh   The only match is the string "submit via `gh pr review`"
#                    inside an agent-prompt heredoc (review-branch.sh:122),
#                    which tells the agent to IGNORE that step. Prose, not a
#                    call site.
allowlist_reason() {
  case "$1" in
    scripts/approve-issue.sh) echo "human-only by design; APPROVER is the authenticated human (#1355)" ;;
    scripts/review-branch.sh) echo "match is prose inside an agent prompt, not a call site (#1355)" ;;
    scripts/lib/gh-bot.sh) echo "IS the attribution mechanism — its \`command gh\` calls are the wrapper's own body and cannot source itself (#1411)" ;;
    *) return 1 ;;
  esac
}

# The write vocabulary is READ FROM the runtime helper, never restated here.
#
# It was restated here at first, and the two copies immediately disagreed: this
# regex lacked `ruleset` and the add/remove/clone/... verbs, so `gh ruleset
# create` would mint a token at runtime while this guard did not require the
# script to source the helper at all — a hole in the gate, in the gate's own
# vocabulary. One definition, two consumers.
#
# Sourcing gh-bot.sh is offline and side-effect-free: it defines variables and
# functions and shadows `gh` only when gh_bot_init is called, which this does not.
# shellcheck source=scripts/lib/gh-bot.sh
source "${HERE}/lib/gh-bot.sh"

# `[= ]*` covers all four spellings gh accepts: `-X POST`, `-XPOST`,
# `--method POST`, `--method=POST`. A bare ` *` missed the equals form while the
# runtime caught it — a parity gap of the same kind twice over, so it is spelled
# out here and pinned by tests on both sides.
WRITE_RE="(^|[^[:alnum:]_-])gh (${GH_BOT_WRITE_NOUNS}) (${GH_BOT_WRITE_VERBS})|gh api [^|]*((-X|--method)[= ]*(${GH_BOT_WRITE_METHODS})|--input|-f |-F |--field|--raw-field)"

# GraphQL: a write unless the line DECLARES itself a read (#1411).
#
# The old rule keyed on a literal `mutation` token, which a document held in a
# variable (`-f query="$MUT"`) simply does not have — so a mutation read as a
# query on both sides and would have shipped as the human. Argv cannot answer
# this, so the default is now the safe answer and a read must say so by calling
# `gh_bot_graphql_read`. Mirrors _gh_bot_is_write exactly, in both directions.
GRAPHQL_LINE_RE='gh api [^|]*graphql'
GRAPHQL_READ_DECL_RE='gh_bot_graphql_read'

# A write issued from a NEW bash process escapes the wrapper (#1413), because a
# shell function is not inherited across exec. Flag the common spelling so the
# gap fails loudly instead of writing as the human. Textual and therefore
# partial — it catches `bash -c '... gh pr comment ...'`, not a write assembled
# at runtime — but a visible partial beats a silent hole (invariant 2).
SUBSHELL_WRITE_RE="(bash|sh|zsh)[[:space:]]+-c[^\n]*gh (${GH_BOT_WRITE_NOUNS}) (${GH_BOT_WRITE_VERBS})"

fail=0
checked=0
skipped=""

[[ -d "$SCAN_DIR" ]] || { echo "check-gh-bot-attribution: no such directory: $SCAN_DIR" >&2; exit 2; }

while IFS= read -r file; do
  rel="${file#"$ROOT"/}"

  # Checked FIRST and independently of everything below: a write spawned in a new
  # shell process escapes the wrapper even in a fully compliant file, so sourcing
  # and arming do not cure it (#1413). Reported separately for that reason.
  sub_hits="$(grep -nE "$SUBSHELL_WRITE_RE" "$file" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  if [[ -n "$sub_hits" ]] && ! allowlist_reason "$rel" >/dev/null; then
    fail=1
    echo "FAIL: ${rel} issues a GitHub write from a NEW shell process — the \`gh\` wrapper is a shell function and does not survive exec, so this writes as the human" >&2
    echo "$sub_hits" | sed 's/^/    /' >&2
    echo "    Fix: run the write in THIS shell (drop the \`bash -c\`), or have the inner script source lib/gh-bot.sh and call gh_bot_init itself." >&2
    echo >&2
  fi

  # Strip full-line comments before matching, so a `# ... gh pr create ...`
  # explanation never trips the guard. NOTE the anchor: `grep -n` on a SINGLE
  # file emits "16:# ..." with no filename prefix, so a pattern expecting ":16:"
  # silently filters nothing.
  hits="$(grep -nE "$WRITE_RE" "$file" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*#' || true)"

  # Every `gh api graphql` line is a write UNLESS it declares itself a read.
  # Two steps, because the main regex reaches graphql lines only when they carry
  # a body flag: first drop the DECLARED reads, then add back any graphql line
  # the main regex missed (e.g. a document supplied via --input or stdin).
  hits="$(printf '%s' "$hits" | awk -v r="$GRAPHQL_READ_DECL_RE" 'NF && $0 !~ r' || true)"
  extra="$(grep -nE "$GRAPHQL_LINE_RE" "$file" 2>/dev/null \
             | grep -vE '^[0-9]+:[[:space:]]*#' \
             | grep -vE "$GRAPHQL_READ_DECL_RE" || true)"
  if [[ -n "$extra" ]]; then
    hits="$(printf '%s\n%s' "$hits" "$extra" | awk 'NF' | sort -t: -k1,1n -u)"
  fi

  [[ -n "$hits" ]] || continue

  checked=$((checked + 1))

  if reason="$(allowlist_reason "$rel")"; then
    skipped+="  - ${rel} — ${reason}"$'\n'
    continue
  fi

  # BOTH are required, and requiring only the first was a hole in this gate.
  #
  # gh-bot.sh is INERT until gh_bot_init runs: sourcing defines functions and
  # variables but shadows nothing, and the `gh` wrapper — the whole mechanism —
  # is created inside gh_bot_init. So a script that sources and forgets to init
  # calls the real `gh` under ambient founder credentials while satisfying a
  # source-only check. That is a silent gate admitting the exact bug this guard
  # exists to catch (invariant 2). Caught by review on #1401; it slipped in when
  # the helper moved from an eager GH_TOKEN export, where sourcing alone really
  # was sufficient, to lazy init — and this check was not revisited.
  #
  # Match the FILENAME, not a particular relative path: scripts/lib/issue-lease.sh
  # lives beside the helper and sources it as "${_ISSUE_LEASE_DIR}/gh-bot.sh",
  # with no "lib/" segment to match on.
  has_source=0; has_init=0
  grep -qE '^[[:space:]]*(source|\.)[[:space:]].*gh-bot\.sh' "$file" && has_source=1
  # A commented-out `# gh_bot_init` must not satisfy the requirement.
  if grep -E '(^|[^[:alnum:]_-])gh_bot_init([^[:alnum:]_-]|$)' "$file" 2>/dev/null \
       | grep -qvE '^[[:space:]]*#'; then
    has_init=1
  fi

  if (( has_source && has_init )); then
    continue
  fi

  fail=1
  if (( has_source )); then
    # The subtler failure, so say exactly what is wrong: the helper is present but
    # never armed, which looks compliant at a glance and writes as the human.
    echo "FAIL: ${rel} sources lib/gh-bot.sh but never calls gh_bot_init — the helper is INERT, so these writes go out as the human" >&2
  else
    echo "FAIL: ${rel} writes to GitHub but never sources lib/gh-bot.sh" >&2
  fi
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
done < <(find "$SCAN_DIR" -type f -name '*.sh' | sort)

# Always print what was waived. A silently-skipped file reads as "covered".
if [[ -n "$skipped" ]]; then
  echo "Allowlisted (intentionally NOT bot-attributed):" >&2
  printf '%s' "$skipped" >&2
fi

if (( fail )); then
  cat >&2 <<'MSG'
Agent GitHub writes must carry the bot's identity, not the human's (minspec#995,
#1355). GitHub permanently auto-subscribes the AUTHOR of a thread, so a write
made as the human subscribes them to it forever — and the audit trail then
records a human as having done what an agent did.

Fix: source the helper once, near the top of the script, after SCRIPT_DIR is set.

    # shellcheck source=scripts/lib/gh-bot.sh
    source "${SCRIPT_DIR}/lib/gh-bot.sh"
    gh_bot_init

That arms a `gh` wrapper for the whole process, so individual `gh` calls need no
change: reads pass through, and the first WRITE mints a bot token (or aborts).

For a GraphQL line, note that `gh api graphql` counts as a WRITE by default — a
document held in a variable cannot be classified from argv. If the document is
provably a query, say so by calling `gh_bot_graphql_read` instead.

If the script is genuinely a HUMAN action (like approve-issue.sh), add it to
allowlist_reason() in this file with the reason spelled out.
MSG
  exit 1
fi

echo "check-gh-bot-attribution: OK — ${checked} file(s) with GitHub writes, all attributed or explicitly allowlisted."
