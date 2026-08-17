/**
 * #1274 — T2 wiring regression: `shepherd_publish` in dispatch-issue.sh must judge
 * its workflow-file preflight by `workflow_diff_range` (scripts/lib/workflow-paths.sh),
 * never by re-deriving its own naive two-dot diff.
 *
 * Root cause (same class as the pre-push hook's #1263 fix, applied here to a SIBLING
 * call site the #1263 PR never touched): `shepherd_publish` computed
 * `git diff --name-only origin/main..$BRANCH`. `git diff A..B` is the two-endpoint
 * TREE diff (`git diff A B`), not reachability-aware, so it also reports every file
 * origin/main changed since $BRANCH's fork point — files this push does not touch,
 * whose commits are already on the remote. `shepherd_fix` calls `shepherd_publish`
 * WITHOUT rebasing first (only `shepherd_rebase` does), so any branch amended by a
 * fix agent while origin/main had since touched a workflow file hit this.
 *
 * dispatch-issue.sh cannot be sourced in isolation for a full behavioural drive of
 * shepherd_publish — line 1 dereferences `$1` under `set -euo pipefail` and
 * `gh_bot_init` performs a real credential mint at source time (see the file's own
 * header). `workflow-diff-range.test.ts` proves the extracted function directly and
 * behaviourally; this file is the wiring guard that the one real caller which had
 * the bug actually calls it, in the same style as shepherd-decide.test.ts's
 * "shepherd wiring" block.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const WORKFLOW_PATHS_LIB = path.resolve(__dirname, '../../../scripts/lib/workflow-paths.sh');

function shepherdPublishBody(): string {
  const code = fs.readFileSync(DISPATCH, 'utf-8');
  const start = code.indexOf('shepherd_publish() {');
  expect(start, 'shepherd_publish must exist in dispatch-issue.sh').toBeGreaterThan(-1);
  const end = code.indexOf('\n}', start);
  return code.slice(start, end);
}

/**
 * Full-line `#` comments stripped. The function's own comments name the OLD buggy
 * pattern (`origin/main..$BRANCH`) to explain why it changed (the codebase's own
 * documentation style — see e.g. .githooks/pre-push's #1263 comment doing the
 * same) — so a regex over the raw body self-matches its own explanation. This
 * checks executable code only, which is what could actually regress.
 */
function codeOnly(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('#1274 shepherd_publish uses the shared merge-base-aware range', () => {
  it('calls workflow_diff_range for its workflow-file preflight', () => {
    expect(shepherdPublishBody()).toMatch(/workflow_diff_range\s+"\$prev_tip"\s+"\$local_sha"\s+"origin\/main"/);
  });

  it('does NOT contain the naive two-dot origin/main..$BRANCH diff (the #1274 bug)', () => {
    expect(codeOnly(shepherdPublishBody())).not.toMatch(/origin\/main\.\.\$\{?BRANCH\}?/);
  });

  it('resolves the previous tip from the real remote, not an assumed-fresh tracking ref', () => {
    // ls-remote asks the forge directly, so a stale local refs/remotes/origin/<branch>
    // (this worktree may not have fetched it) cannot feed a wrong verdict either.
    expect(shepherdPublishBody()).toMatch(/ls-remote --exit-code origin "refs\/heads\/\$BRANCH"/);
  });

  it('dispatch-issue.sh sources the lib workflow_diff_range is defined in', () => {
    const dispatch = fs.readFileSync(DISPATCH, 'utf-8');
    expect(dispatch).toMatch(/source "\$\{SCRIPT_DIR\}\/lib\/workflow-paths\.sh"/);
    expect(fs.readFileSync(WORKFLOW_PATHS_LIB, 'utf-8')).toMatch(/^workflow_diff_range\(\) \{/m);
  });
});
