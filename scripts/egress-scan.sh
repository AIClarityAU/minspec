#!/usr/bin/env bash
# egress-scan.sh — pure, testable pre-publish exfil/secret scanner (#358).
#
# The dev agent (dispatch-issue.sh) runs `claude -p` over an UNTRUSTED issue body —
# a prompt-injection surface. It holds NO credentials (no gh/push/remote/network),
# but the PARENT then PUBLISHES its output: it pushes the committed diff, opens a PR,
# and posts `.agent-summary.md` (+ derives `.review-signals.json`) to the issue. So a
# prompt-injected agent's exfil channel is: read a secret from a file it can Read,
# then smuggle that secret into the committed diff or the summary — which the parent
# faithfully publishes. This scanner is the EGRESS GUARD the parent runs AFTER the
# agent exits but BEFORE the first credentialed/network op, over exactly that
# about-to-be-published material.
#
# Usage:
#   egress-scan.sh <path> [<path> ...]
#     Each <path> is a file to scan (e.g. the diff dumped to a temp file, the
#     `.agent-summary.md`, the `.review-signals.json`).
#
# Exit 0  → CLEAN: no secret/exfil marker matched in any input.
# Exit 1  → BLOCKED: at least one marker matched, an input was unreadable, or the
#           scan itself errored. Matching lines are printed to stdout with the
#           secret VALUES redacted to `***` / `<redacted-…>` so the caller can log
#           WHY the publish was blocked without re-leaking the secret it just caught.
#
# FAIL CLOSED — the load-bearing rule (mirrors review-decide.sh / triage-decide.sh):
# if ANY input path is missing/unreadable, or the high-entropy scanner errors, we
# treat it as a HIT and exit 1 — NEVER as clean. A guard that failed open would
# publish precisely the material it exists to withhold, so uncertainty resolves to
# "block", not "allow". No input paths at all is likewise a fail-closed block.
#
# HONEST SCOPE — do NOT overclaim (see dispatch-issue.sh ALLOWED_TOOLS note):
# this closes the WRITE-TO-PUBLISHED channel only — a secret cannot be smuggled into
# the material the parent publishes: the committed diff, the commit MESSAGES (`git
# push` carries them and the PR shows them — added after the #479 review flagged
# them as an unscanned exfil path), `.agent-summary.md`, and `.review-signals.json`.
# The scanner itself is content-agnostic (scans whatever paths it is given); the
# caller (run_egress_guard) decides that set. It does NOT close arbitrary NETWORK
# egress DURING the agent run: the agent may edit test files and `npm test` executes
# them, so a determined injection could exfiltrate over the network at test time.
# That residual is inherent to running the project's own build and is out of scope.
#
# PURE + no side effects: reads only the given files, writes only stdout, makes no
# network/gh/git call — so it is unit-testable in isolation (tests/egress-scan.test.ts)
# and reusable by any future publisher (a PR-open Action, etc.), like review-decide.sh.

# NOT `set -e`: a `grep` that finds nothing exits 1, which is the NORMAL "no match"
# path and must never abort the scan. `-u`/pipefail still catch real mistakes.
set -uo pipefail

# ── Secret shape patterns (case-SENSITIVE; distinctive, near-zero false positives) ──
CS_PATTERNS=(
  'sk-ant-[A-Za-z0-9_-]{16,}'                            # Anthropic API key
  '(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}' # AWS access key id (and STS/role variants)
  '-----BEGIN[ A-Z0-9]*PRIVATE KEY-----'                 # PEM private-key header (RSA/EC/OPENSSH/generic)
  'gh[pousr]_[A-Za-z0-9]{20,}'                            # GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)
  'xox[baprs]-[A-Za-z0-9-]{10,}'                          # Slack token
)

# ── Credential-file markers (case-INSENSITIVE; the "obvious credential contents"
#    signal). Deliberately NARROW to the unambiguous AWS credentials-file keys so a
#    legitimate spec/doc/test PR that merely QUOTES the words "password"/"secret"
#    is not quarantined. A real secret VALUE (an .env/credentials dump) still trips
#    the high-entropy pass below regardless of its keyword. ──
CI_PATTERNS=(
  'aws_secret_access_key[[:space:]]*[:=]'
  'aws_access_key_id[[:space:]]*[:=]'
)

# ── High-entropy pass (awk). Flags a maximal run of base64/hex/token characters of
#    length >= 32 that LOOKS like a secret, while sparing the high-entropy strings
#    that are LEGITIMATELY committed in this repo:
#      • pure hex of any length  → a hash (sha1/sha256/git SHA; the approvals
#        sidecars and .minspec/generated-hashes.json are full of these),
#      • `sha256-`/`sha384-`/`sha512-` prefixed base64 → SRI / npm-lock integrity,
#    both of which would otherwise false-block nearly every approval / dependency PR.
#    A token is treated as a secret when it is base64-flavoured (contains + / =) or
#    is a mixed-class alnum blob (has upper AND lower AND digit — the entropy tell).
#    NOTE: uses a maximal `+` run (mawk does not match open `{n,}` intervals
#    greedily) and checks length in code, so a trailing `==` is never split off.
#    RESIDUAL (low): an all-lowercase-or-all-uppercase alnum secret with no base64
#    char slips this heuristic; the distinctive-prefix shapes above catch the common
#    real tokens, and this is defence-in-depth, not the sole control. ──
read -r -d '' ENTROPY_AWK <<'AWK' || true
# Longest run of CONTIGUOUS alphanumerics in t. Separators (/, -, _) break a run.
# A prefix-less secret is one unbroken high-entropy run; a file path or structured
# id is short dictionary segments split by separators, so its longest run is a
# short word. Gates the mixed-class rule so it fires on secrets, not paths (#616).
function longest_alnum_run(t,   i, c, n, best) {
  n = 0; best = 0
  for (i = 1; i <= length(t); i++) {
    c = substr(t, i, 1)
    if (c ~ /[A-Za-z0-9]/) { n++; if (n > best) best = n } else n = 0
  }
  return best
}
function secretish(t,   hasU, hasL, hasD) {
  if (length(t) < 32) return 0
  if (t ~ /^sha(1|224|256|384|512)-/) return 0   # SRI / npm-lock integrity hash — not a secret
  if (t ~ /^[0-9a-fA-F]+$/) return 0             # pure hex = a hash (sha*/git SHA) committed legitimately
  # `+` and `=` are strong base64 signals that file PATHS never carry. A base64
  # secret is caught here regardless of separators.
  if (t ~ /[+=]/) return 1                        # base64-flavoured blob (padding/plus)
  # Mixed-class (upper+lower+digit) is the entropy tell for a prefix-less secret,
  # but ONLY on a CONTIGUOUS >=32 run. Applied to the whole separator-laden token
  # it flagged MinSpec's OWN artifact paths — SPEC-/DR-/EPIC-NNN ids are
  # upper+lower+digit yet split by `/` and `-` into short words, so nearly every
  # MinSpec PR was quarantined (#616). A secret WRAPPED in separators still has its
  # >=32 contiguous run (foo/<32-char-blob>/bar → run=32), so this is NOT a bypass;
  # only a secret deliberately chopped into <32 chunks slips — the same
  # defence-in-depth residual the distinctive-prefix shapes above backstop. A
  # lowercase-plus-slash path was never mixed-class and already passed (#479).
  if (longest_alnum_run(t) < 32) return 0
  hasU = (t ~ /[A-Z]/); hasL = (t ~ /[a-z]/); hasD = (t ~ /[0-9]/)
  return (hasU && hasL && hasD) ? 1 : 0          # contiguous mixed-class high-entropy token
}
{
  s = $0
  while (match(s, /[A-Za-z0-9+\/=_-]+/)) {
    tok = substr(s, RSTART, RLENGTH)
    s   = substr(s, RSTART + RLENGTH)
    if (secretish(tok)) { print FNR ": " $0; break }
  }
}
AWK

# Scrub secret VALUES out of any line we print as a block reason, so writing the
# reason to a log/CI output never re-leaks the secret this guard just caught. Uses
# `#` as the sed delimiter because several patterns contain `/`. Specific prefixes
# first, then a catch-all mask over any leftover long high-entropy run.
redact() {
  sed -E \
    -e 's#(sk-ant-)[A-Za-z0-9_-]+#\1***#g' \
    -e 's#(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}#\1****REDACTED#g' \
    -e 's#(gh[pousr]_)[A-Za-z0-9]{20,}#\1***#g' \
    -e 's#(xox[baprs]-)[A-Za-z0-9-]{10,}#\1***#g' \
    -e 's#(-----BEGIN[ A-Z0-9]*PRIVATE KEY-----).*#\1 ***REDACTED***#g' \
    -e 's#[A-Za-z0-9+/=_-]{32,}#<redacted-high-entropy>#g'
}

# Prefix each matched "LINENO:line" with a stable, path-safe tag. Done in awk (not
# sed) so a `#`/`/` anywhere in the file path can never corrupt the substitution.
emit() {
  local kind="$1" file="$2"
  redact | awk -v f="$file" -v k="$kind" '{ print "BLOCK " f " [" k "]: " $0 }'
}

# Scan one file. Returns 1 (and prints redacted reasons) on any hit / unreadable /
# scanner error; 0 when the file is clean.
scan_file() {
  local f="$1" found=0 pat out rc

  # FAIL CLOSED: a path we were asked to scan but cannot read is a block, never a
  # clean pass — otherwise deleting/hiding the input would defeat the guard.
  if [[ ! -f "$f" || ! -r "$f" ]]; then
    echo "BLOCK ${f} [unreadable]: cannot read input — failing closed"
    return 1
  fi

  # `-e "$pat"` (not a bare pattern arg): several patterns begin with `-` (the PEM
  # `-----BEGIN…` header), which grep would otherwise parse as options before it
  # ever reached the `--`. `-e` marks it unambiguously as the pattern.
  for pat in "${CS_PATTERNS[@]}"; do
    out=$(grep -nE -e "$pat" -- "$f" 2>/dev/null || true)
    if [[ -n "$out" ]]; then printf '%s\n' "$out" | emit shape "$f"; found=1; fi
  done

  for pat in "${CI_PATTERNS[@]}"; do
    out=$(grep -niE -e "$pat" -- "$f" 2>/dev/null || true)
    if [[ -n "$out" ]]; then printf '%s\n' "$out" | emit cred "$f"; found=1; fi
  done

  # High-entropy pass — fail closed if awk itself errors (non-zero exit). No `--`:
  # mawk does not accept it, and $f is always a repo-controlled temp/worktree path.
  out=$(awk "$ENTROPY_AWK" "$f" 2>/dev/null); rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "BLOCK ${f} [entropy]: high-entropy scan errored (awk rc=${rc}) — failing closed"; found=1
  elif [[ -n "$out" ]]; then
    printf '%s\n' "$out" | emit entropy "$f"; found=1
  fi

  return "$found"
}

# FAIL CLOSED: called with no inputs → cannot prove anything clean → block.
if [[ $# -eq 0 ]]; then
  echo "BLOCK [no-input]: egress-scan.sh called with no paths — failing closed"
  exit 1
fi

overall=0
for f in "$@"; do
  if ! scan_file "$f"; then overall=1; fi
done
exit "$overall"
