#!/usr/bin/env bash
#
# check-primaries-clean.sh — keep the SHARED PRIMARY checkouts of the
# minspecpro.code-workspace repos clean and in sync with origin/main.
#
# WHY THIS EXISTS
#   Rule: one session = one worktree; the primary checkout is for merging, not
#   for working (see DR-051, SPEC-026). In practice the primary still goes dirty,
#   and an audit on 2026-07-31 found that SEVEN of the EIGHT dirty paths across
#   the three repos were byte-identical to origin/main. They were not work in
#   progress at all — they were the pre-merge copies of already-merged PRs, left
#   behind because nothing ever fast-forwards the primary.
#
#   That is the dominant failure mode and it is entirely mechanical:
#
#     1. A session (or a MinSpec extension command, which writes to the OPEN
#        WORKSPACE FOLDER — always the primary, never a worktree) edits files in
#        the primary.
#     2. The work is landed properly, via a worktree or the docs lane.
#     3. The PR merges. origin/main now carries that exact content.
#     4. Nobody pulls the primary. The identical local copies keep showing as
#        ` M` / `??` forever, and every later session opens onto a dirty tree it
#        did not create and cannot safely attribute.
#
#   The noise is the harm: a permanently-dirty primary trains everyone to ignore
#   `git status`, so the ONE path that is genuine unlanded work hides among six
#   that are not. This script separates those two populations mechanically.
#
# WHAT IT DOES
#   For each repo, after `git fetch origin main`, every dirty path is classified:
#
#     REDUNDANT  — worktree content is byte-identical to origin/main's version
#                  (or: locally deleted and absent from origin/main). Provably
#                  lossless to drop, because the exact bytes are on the remote.
#     ORPHAN     — content differs from origin/main. Real unlanded work. NEVER
#                  touched, only reported.
#
#   Default is report-only. With --fix it drops the REDUNDANT paths and then
#   fast-forwards, but ONLY when that repo has zero ORPHANs — an orphan means a
#   session is mid-flight and the tree is not ours to move (rule #8: never move
#   a shared HEAD under a live session).
#
# WHAT IT DELIBERATELY DOES NOT DO
#   - It never commits, stashes, or force-updates anything.
#   - It never touches a worktree under .worktrees/ — those are sessions' homes.
#   - It never drops a path whose bytes are not already on origin/main.
#   - It never fast-forwards a repo that has an ORPHAN, even with --fix.
#
# SIBLING REPOS ARE OPTIONAL
#   scroogellm and sealbox may not be checked out. Each is reported SKIP rather
#   than failing the run, so this stays useful for someone who cloned only
#   MinSpec. (Same convention as scripts/test-all.sh.)
#
# USAGE
#   scripts/check-primaries-clean.sh            # report only
#   scripts/check-primaries-clean.sh --fix      # drop redundant + fast-forward
#   scripts/check-primaries-clean.sh --quiet    # print only when action needed
#
# EXIT CODE
#   0  every primary is clean and in sync (or became so under --fix)
#   1  at least one primary still has an ORPHAN or is still behind
#   2  usage error
#
set -uo pipefail

FIX=0
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fix) FIX=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "check-primaries-clean: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

# Resolve the sibling repos relative to THIS repo's parent, so the script works
# from any clone location rather than assuming ~/code.
#
# SELF_ROOT is NOT optional. The sibling-SKIP convention below is a convenience
# for someone who cloned only MinSpec; applying it to the owning repo too would
# mean a copy of this script run from outside any checkout resolves to a junk
# root, SKIPs all three repos, and exits 0 — reporting "everything is clean"
# while having inspected nothing. That false green was observed in testing, so
# the owning repo is asserted, never skipped.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve the repo's MAIN working tree, not whatever tree this copy of the script
# happens to sit in. This script is about the PRIMARY checkouts, and it will
# routinely be run from a worktree (it is developed in one, and a session may
# invoke it from its own). Using the script's own directory would make
# SELF_ROOT=.worktrees/<repo>/<name>, so the siblings resolve to
# .worktrees/<repo>/scroogellm — which does not exist — and all three repos
# report SKIP or WARN while the actual primaries go uninspected. Observed in
# testing. `--git-common-dir` is the primary's .git even from a linked worktree.
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

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

overall=0
acted=0

for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"

  if [ ! -d "$repo/.git" ] && [ ! -f "$repo/.git" ]; then
    say "SKIP  $name — not checked out at $repo"
    continue
  fi

  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$branch" != "main" ]; then
    # A primary parked off main is itself the hazard rule #8 exists to prevent:
    # another session may have moved this shared HEAD. Never auto-correct it —
    # switching back could strand that session's uncommitted work.
    warn "WARN  $name — primary is on '$branch', not main. Not touching it."
    warn "      Another session may have branch-switched this shared checkout (rule #8)."
    overall=1
    continue
  fi

  if ! git -C "$repo" fetch -q origin main 2>/dev/null; then
    warn "WARN  $name — could not fetch origin/main; skipping (offline?)"
    overall=1
    continue
  fi

  behind="$(git -C "$repo" rev-list --count main..origin/main 2>/dev/null || echo 0)"
  ahead="$(git -C "$repo" rev-list --count origin/main..main 2>/dev/null || echo 0)"

  redundant=()
  orphans=()

  # Classify every dirty path. -z + NUL parsing so paths with spaces or unicode
  # survive; git's default porcelain quotes and escapes them, which would make
  # the later `git show origin/main:"$p"` lookup miss and misclassify a
  # REDUNDANT path as an ORPHAN.
  while IFS= read -r -d '' entry; do
    code="${entry:0:2}"
    p="${entry:3}"
    # Renames emit a second NUL-terminated field (the source path); the value we
    # want is already in $p, so just consume and discard the extra field.
    case "$code" in
      R*|C*) IFS= read -r -d '' _src ;;
    esac
    [ -n "$p" ] || continue

    if [ -e "$repo/$p" ]; then
      if git -C "$repo" cat-file -e "origin/main:$p" 2>/dev/null \
         && git -C "$repo" show "origin/main:$p" 2>/dev/null | cmp -s - "$repo/$p"; then
        redundant+=("$p")
      else
        orphans+=("$p")
      fi
    else
      # Locally deleted. Redundant only if origin/main also lacks it — otherwise
      # the deletion is itself unlanded work.
      if git -C "$repo" cat-file -e "origin/main:$p" 2>/dev/null; then
        orphans+=("$p")
      else
        redundant+=("$p")
      fi
    fi
  done < <(git -C "$repo" status --porcelain -z 2>/dev/null)

  if [ "${#orphans[@]}" -eq 0 ] && [ "${#redundant[@]}" -eq 0 ] \
     && [ "$behind" = "0" ] && [ "$ahead" = "0" ]; then
    say "OK    $name — clean, in sync with origin/main"
    continue
  fi

  say "----  $name"
  [ "$behind" != "0" ] && say "      behind origin/main by $behind commit(s)"
  [ "$ahead" != "0" ] && say "      AHEAD of origin/main by $ahead commit(s) — unpushed local commits on main"

  for p in "${redundant[@]}"; do
    say "      REDUNDANT  $p  (byte-identical to origin/main)"
  done
  for p in "${orphans[@]}"; do
    mt="$(date -r "$repo/$p" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'deleted')"
    say "      ORPHAN     $p  (last written $mt)"
  done

  if [ "${#orphans[@]}" -gt 0 ]; then
    say "      -> $name has unlanded work. Not dropping anything, not fast-forwarding."
    say "         A live session most likely owns it: check .worktrees/$name/ and"
    say "         land it from there, or via scripts/push-docs.sh if it is an approvable."
    overall=1
    continue
  fi

  if [ "$FIX" != 1 ]; then
    say "      -> re-run with --fix to drop the redundant copies and fast-forward."
    overall=1
    continue
  fi

  # --fix, and every dirty path is provably already on origin/main.
  for p in "${redundant[@]}"; do
    if git -C "$repo" ls-files --error-unmatch "$p" >/dev/null 2>&1; then
      git -C "$repo" checkout -- "$p" 2>/dev/null || warn "      could not restore $p"
    else
      rm -rf "$repo/$p" || warn "      could not remove $p"
    fi
    acted=1
  done

  if [ "$behind" != "0" ]; then
    if git -C "$repo" pull --ff-only -q 2>/dev/null; then
      say "      fast-forwarded $behind commit(s)"
      acted=1
    else
      warn "      WARN  $name — ff-only pull failed; leaving as is"
      overall=1
      continue
    fi
  fi

  if [ -z "$(git -C "$repo" status --porcelain)" ] \
     && [ "$(git -C "$repo" rev-list --count main..origin/main)" = "0" ]; then
    say "OK    $name — now clean and in sync"
  else
    warn "WARN  $name — still not clean after --fix"
    overall=1
  fi
done

if [ "$QUIET" = 1 ] && [ "$acted" = 1 ]; then
  echo "check-primaries-clean: acted on at least one primary (see --fix output above)"
fi

exit "$overall"
