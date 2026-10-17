/**
 * Regression: dispatch-issue.sh's git operations must be pinned to the
 * script's own repo root, never the caller's inherited cwd (#1896).
 *
 * dispatch-issue.sh pins `REPO="AIClarityAU/minspec"` for every `gh` call,
 * but the branch-creating `git` operations (fetch/worktree add/worktree
 * remove/branch -D) were bare — no `-C`, so they resolved `origin` from
 * whatever repo the process's inherited cwd happened to be. drain-inbox.sh
 * launches the dispatcher with no `cd`, so a caller started outside this
 * repo's checkout would read the issue via `gh` correctly but cut the agent
 * branch/worktree, and eventually push, into whatever repo the ambient cwd
 * pointed at — a silent wrong-repo write. Same "ambient value where an
 * explicit one was required" shape as #1893/#1894.
 *
 * This is a static source check (the same convention used by
 * dispatch-egress-lib-parity.test.ts / dispatch-automerge-*-exclusion.test.ts
 * for this script) rather than an execution test, because exercising the
 * real fetch/worktree calls needs a live git remote and an isolated cwd —
 * out of proportion for locking a naming convention. What it protects: any
 * future edit that reintroduces a bare `git fetch`/`git worktree`/`git
 * branch` call (e.g. a new git operation added without noticing the
 * existing ones are all `-C`-pinned) is caught here rather than resurfacing
 * only as a wrong-repo write in production.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const src = fs.readFileSync(DISPATCH, 'utf-8');

describe('dispatch-issue.sh: git ops pinned to REPO_ROOT, not caller cwd (#1896)', () => {
  it('derives REPO_ROOT from SCRIPT_DIR, not cwd, right after SCRIPT_DIR is set', () => {
    expect(src).toContain('REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"');
  });

  it('refuses to run if the resolved REPO_ROOT has no .minspec/ (guards a shared/vendored install)', () => {
    expect(src).toMatch(/if \[\[ ! -d "\$\{REPO_ROOT\}\/\.minspec" \]\]; then[\s\S]*?exit 1/);
  });

  it('every fetch/worktree/branch call the script issues is pinned with `-C "$REPO_ROOT"`', () => {
    const lines = src.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue; // comments may mention the commands in prose
      // Bare invocations of the git subcommands this bug affected.
      if (/^git (fetch|worktree|branch) /.test(trimmed)) {
        expect(trimmed, `unpinned git op found: ${trimmed}`).toMatch(/^git -C "\$REPO_ROOT" (fetch|worktree|branch) /);
      }
    }
  });

  it('the four call sites this fix pinned are present with -C "$REPO_ROOT"', () => {
    expect(src).toContain('git -C "$REPO_ROOT" fetch origin main -q 2>/dev/null || true');
    expect(src).toContain('git -C "$REPO_ROOT" rev-list --count HEAD..origin/main');
    expect(src).toContain('git -C "$REPO_ROOT" worktree remove "$WORKTREE" --force');
    expect(src).toContain('git -C "$REPO_ROOT" branch -D "$BRANCH"');
    expect(src).toContain('git -C "$REPO_ROOT" fetch origin main -q\n');
    expect(src).toContain('git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE" origin/main');
  });
});
