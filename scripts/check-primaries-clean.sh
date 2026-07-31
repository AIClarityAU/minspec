#!/usr/bin/env bash
#
# check-primaries-clean.sh — DIAGNOSTIC ONLY. Explains why a shared primary
# checkout is dirty and stale, and why DR-065's gated fast-forward will never
# rescue it on its own.
#
# THIS SCRIPT MUTATES NOTHING. No commit, no stash, no checkout, no rm, no
# merge, no HEAD movement, not even a fetch that could be mistaken for one. It
# reads and it prints. Moving a shared HEAD is governed by DR-065 and is
# implemented exactly once, in `sync_shared_checkouts()`
# (scripts/drain-inbox.sh) behind guards G1-G4. This script is not a second
# implementation of that and must never become one.
#
# WHY IT EXISTS — the G2 deadlock
#   DR-065 §2 gates fast-forward on four guards. G2 requires the checkout be
#   CONTENT-CLEAN (`git status --porcelain` empty), which protects uncommitted
#   WIP left by a session that exited. G2 is correct and load-bearing: from
#   git's point of view a dirty path is a dirty path, and it cannot tell WIP
#   from anything else.
#
#   But that creates a trap. An audit of the three minspecpro.code-workspace
#   primaries on 2026-07-31 found 8 dirty paths, of which SEVEN were
#   byte-identical to origin/main — the pre-merge copies of already-merged PRs
#   (#1153, #1151, #111, #34, #104), left behind because a MinSpec extension
#   command writes to the OPEN WORKSPACE FOLDER (always the primary, never a
#   worktree) and nothing ever cleans up after the PR lands.
#
#   Those paths carry no information. They are bytes that already exist on the
#   remote. But they are `git status` output, so G2 fails, so the checkout is
#   skipped, forever. It cannot become clean by itself, so it never becomes
#   eligible, so it stays stale — all three repos were simultaneously dirty AND
#   behind in exactly this way. The guard is working as designed and the
#   outcome is still a permanent staleness deadlock.
#
#   That is a gap in DR-065's guard set, not a licence to route around it. This
#   script's whole job is to make the deadlock legible: to say which dirty
#   paths are REDUNDANT (already on the remote, carrying nothing) and which are
#   ORPHAN (real unlanded work), so a human can decide. Resolving it belongs in
#   a DR amendment — see the follow-up issue linked at the bottom of the output.
#
# CLASSIFICATION
#   REDUNDANT  worktree content is byte-identical to origin/<default>'s version,
#              or locally deleted and absent there. Carries no information.
#   ORPHAN     content differs. Real unlanded work. Someone must land it.
#
#   The classification is advisory. It is NOT a dormancy signal and must never
#   be used as one: DR-065 §1 is explicit that clean/empty is indistinguishable
#   from "the heartbeat isn't running", which is why presence fails toward
#   OCCUPIED. A checkout showing zero ORPHANs is not thereby dormant.
#
# PRESENCE
#   Occupancy is reported using the one sanctioned predicate,
#   `drain-inbox.sh --checkout-occupied`, never a local re-derivation (DR-065 §4
#   makes the bash/TS pair a parity-tested gate; a third copy would be the drift
#   class that test exists to catch).
#
# USAGE
#   scripts/check-primaries-clean.sh            # report
#   scripts/check-primaries-clean.sh --quiet    # print only what needs a human
#
# EXIT CODE
#   0  every primary is clean and current
#   1  at least one primary has an ORPHAN, is stale, or is deadlocked
#   2  usage / resolution error
#
set -uo pipefail

QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    --fix)
      # Removed deliberately. The previous revision of this script implemented
      # --fix as "drop the REDUNDANT paths, then merge --ff-only", gated on
      # nothing but the absence of ORPHANs. ai-review flagged it as BLOCKING and
      # was right on both counts: absence of orphans is not presence-proof
      # (DR-065 §1), and dropping working-tree paths is not among the operations
      # DR-065 §5 sanctions — that section names `merge --ff-only` and nothing
      # else, explicitly not to be cited for anything further.
      echo "check-primaries-clean: --fix was removed; this script no longer mutates anything." >&2
      echo "  Fast-forwarding a shared checkout is DR-065's single sanctioned exception and" >&2
      echo "  lives in sync_shared_checkouts() (scripts/drain-inbox.sh), behind guards G1-G4." >&2
      echo "  Run the drain, or land the reported ORPHANs, and let that path do the ff." >&2
      exit 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "check-primaries-clean: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve the repo's MAIN working tree, not whatever tree this copy sits in.
# This script is about the PRIMARY checkouts and will routinely be run from a
# worktree. Using the script's own directory would make SELF_ROOT
# .worktrees/<repo>/<name>, so the siblings resolve under .worktrees/ — which
# does not exist — and all three repos report SKIP while the actual primaries go
# uninspected. Observed in testing. `--git-common-dir` is the primary's .git
# even from a linked worktree.
COMMON_DIR="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -z "$COMMON_DIR" ]; then
  echo "check-primaries-clean: $HERE is not inside a git checkout." >&2
  echo "  This script must be run from inside the repo it is committed to," >&2
  echo "  because it locates the sibling repos relative to that checkout." >&2
  exit 2
fi
SELF_ROOT="$(dirname "$COMMON_DIR")"
CODE_ROOT="$(dirname "$SELF_ROOT")"
REPOS=("$SELF_ROOT" "$CODE_ROOT/scroogellm" "$CODE_ROOT/sealbox")

DRAIN="$SELF_ROOT/scripts/drain-inbox.sh"

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

# Occupancy via the sanctioned predicate only. Anything other than a clean
# "dormant" answer is reported as unknown and treated as occupied downstream,
# matching DR-065 §1's fail direction.
# Read its STDOUT ("occupied" / "dormant") rather than branching on $?, so a
# non-zero exit from any other cause (missing arg, git error, the seam moving)
# degrades to "unknown" instead of being silently read as dormancy.
occupancy() {
  local root="$1" out
  [ -x "$DRAIN" ] || { echo "unknown"; return; }
  out="$("$DRAIN" --checkout-occupied "$root" 2>/dev/null | tail -1)"
  case "$out" in
    occupied|dormant) echo "$out" ;;
    *) echo "unknown" ;;
  esac
}

overall=0
deadlocked=0

for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"

  if [ ! -e "$repo/.git" ]; then
    say "SKIP  $name — not checked out at $repo"
    continue
  fi

  db="$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  db="${db:-main}"
  origin_ref="origin/$db"

  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  occ="$(occupancy "$repo")"

  if [ "$branch" != "$db" ]; then
    warn "WARN  $name — primary is on '$branch', not $db (presence: $occ)."
    warn "      Another session may have branch-switched this shared checkout (rule #8)."
    overall=1
    continue
  fi

  # Read-only. NOT a fetch: this script does not touch the object store either,
  # so it can never be mistaken for the sanctioned sync. It reports against
  # whatever origin/<default> the last drain fetch left behind, and says so when
  # that ref is missing.
  if ! git -C "$repo" rev-parse --verify -q "$origin_ref" >/dev/null 2>&1; then
    warn "WARN  $name — no $origin_ref ref locally; run the drain (it fetches unconditionally)."
    overall=1
    continue
  fi

  behind="$(git -C "$repo" rev-list --count "HEAD..$origin_ref" 2>/dev/null || echo 0)"
  ahead="$(git -C "$repo" rev-list --count "$origin_ref..HEAD" 2>/dev/null || echo 0)"

  redundant=(); orphans=()
  while IFS= read -r -d '' entry; do
    code="${entry:0:2}"; p="${entry:3}"
    case "$code" in R*|C*) IFS= read -r -d '' _src ;; esac
    [ -n "$p" ] || continue
    if [ -e "$repo/$p" ]; then
      if git -C "$repo" cat-file -e "$origin_ref:$p" 2>/dev/null \
         && git -C "$repo" show "$origin_ref:$p" 2>/dev/null | cmp -s - "$repo/$p"; then
        redundant+=("$p")
      else
        orphans+=("$p")
      fi
    else
      if git -C "$repo" cat-file -e "$origin_ref:$p" 2>/dev/null; then
        orphans+=("$p")
      else
        redundant+=("$p")
      fi
    fi
  done < <(git -C "$repo" status --porcelain -z 2>/dev/null)

  if [ "${#orphans[@]}" -eq 0 ] && [ "${#redundant[@]}" -eq 0 ] \
     && [ "$behind" = "0" ] && [ "$ahead" = "0" ]; then
    say "OK    $name — clean, current with $origin_ref"
    continue
  fi

  say "----  $name  (presence: $occ)"
  [ "$behind" != "0" ] && say "      behind $origin_ref by $behind commit(s)"
  [ "$ahead" != "0" ] && say "      AHEAD of $origin_ref by $ahead commit(s) — unpushed local commits"
  for p in "${redundant[@]}"; do
    say "      REDUNDANT  $p"
  done
  for p in "${orphans[@]}"; do
    mt="$(date -r "$repo/$p" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'deleted')"
    say "      ORPHAN     $p  (last written $mt)"
  done
  overall=1

  if [ "${#orphans[@]}" -gt 0 ]; then
    say "      -> unlanded work. Land it from the owning worktree, or via"
    say "         scripts/push-docs.sh if it is an approvable. Do not discard it."
  fi

  if [ "${#orphans[@]}" -eq 0 ] && [ "${#redundant[@]}" -gt 0 ] && [ "$behind" != "0" ]; then
    deadlocked=1
    say "      -> G2 DEADLOCK: every dirty path here is REDUNDANT, so this checkout"
    say "         carries no unlanded work — but DR-065 G2 (content-clean) still fails,"
    say "         so sync_shared_checkouts() will skip it on every cycle and it stays"
    say "         behind indefinitely. Nothing here resolves that: a human decides"
    say "         whether to discard the redundant copies."
  fi
done

if [ "$deadlocked" = 1 ]; then
  say ""
  say "The G2 deadlock above is a gap in DR-065's guard set, not a reason to bypass it."
  say "Tracked for a DR amendment — see #1167."
fi

exit "$overall"
