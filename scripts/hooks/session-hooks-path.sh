#!/usr/bin/env bash
# session-hooks-path.sh — second witness that core.hooksPath is actually armed (#2671).
#
# `prepare` (scripts/prepare.mjs) now fails loudly, at install time, when
# `git config core.hooksPath .githooks` fails. But constitution invariant 2 also
# forbids a required check hinging on a SINGLE producer: a clone whose
# `npm install` ran long ago under an older package.json, or was run with
# `--ignore-scripts`, or whose `.git/config` was edited by hand afterwards, never
# re-runs `prepare` and would never see that failure reported. This is the
# independent second witness invariant 2 asks for: it reads the CURRENT git
# config at every session start, not at install time, so a hooks path that went
# missing or wrong AFTER a clean install (a stray `git config --unset`, a fresh
# worktree that skipped `npm install`) is still caught, by a different producer
# than the one that set it.
#
# Side-effect-free and its own file (same reasoning as session-autonomy.sh): a
# test can execute it directly without also firing the branch guardrail, the
# drain or the radar. Never fatal to the session — a broken printer must not
# wedge a session start — but never silent either: a session with no armed
# hooks says so on every single start until the hooks are reinstalled.

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

want=".githooks"
# `git config --get` exits 1 when the key is simply unset — the documented
# swallow-ok idiom this repo's own DR-066 lint names explicitly (grep's exit 1
# meaning "no match", not a command failure). The marker is on the assignment
# line itself, not this comment, because that is what the lint reads.
got="$(git config --get core.hooksPath 2>/dev/null || true)"  # swallow-ok: unset reads as "", same as "configured to something else" below

if [ "$got" != "$want" ]; then
  echo "⚠️  git hooks are NOT armed: core.hooksPath is '${got:-<unset>}', expected '$want' (#2671)."
  echo "    Every commit-time gate (secret scan, spec-frontmatter check, RCDD root-cause gate)"
  echo "    is silently absent until this is fixed. Run: npm run prepare"
fi
