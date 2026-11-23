#!/usr/bin/env bash
# post-compact.sh — reinjects context after conversation compaction
#
# The Scope line used to `cat .claude/.session-scope`, which on the primary checkout is a
# 107-day-old ScroogeLLM scope from a different session (#1914). Every compaction of every
# session on that checkout re-injected it as the live scope: a signpost pointing the wrong
# way is worse than no signpost. It now reads THIS session's declaration or says there is
# none. Storage and the reasons for it: scripts/hooks/lib/session-scope.sh.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
# shellcheck source=lib/session-scope.sh
if [ ! -r "$HOOK_DIR/lib/session-scope.sh" ]; then
  # Say so rather than going quiet: a hook that degrades in silence is indistinguishable
  # from a hook with nothing to report, which is the failure this whole issue is about.
  echo "[MinSpec] post-compact: scripts/hooks/lib/session-scope.sh is missing, skipping."
  exit 0
fi
. "$HOOK_DIR/lib/session-scope.sh" || exit 0

INPUT=$(cat 2>/dev/null || true)
FIELDS=()
readarray -d '' -t FIELDS < <(scope_parse_envelope "$INPUT") 2>/dev/null || FIELDS=()
SESSION_ID="${FIELDS[0]:-}"

ROOT="$(scope_project_root)"
SCOPE_FILE="$(scope_session_file "$ROOT" "$SESSION_ID")"

echo "━━━ Context reinject after compaction ━━━"
echo "Repo: AIClarityAU/minspec"
if scope_is_declared "$ROOT" "$SESSION_ID"; then
  echo "Scope: $(cat "$SCOPE_FILE" 2>/dev/null)"
else
  echo "Scope: [not declared by this session - redeclare before continuing]"
fi
echo "Invariants: CLAUDE.md ## Invariants"
echo "Tasks: specs/minspec/tasks.md"
echo "Decisions: docs/decisions/INDEX.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
