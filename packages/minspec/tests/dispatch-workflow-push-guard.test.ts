/**
 * T0 — every dispatch publish path consults the workflow-push guard (#1269, #1120).
 * The App token cannot push `.github/workflows/`; a path that skips the check strands
 * a finished build. Text-level wiring test, matching sibling dispatch-*.test.ts style.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findScript(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, 'scripts', 'dispatch-issue.sh');
    if (fs.existsSync(c)) return c;
    dir = path.dirname(dir);
  }
  throw new Error('dispatch-issue.sh not found');
}
const src = fs
  .readFileSync(findScript(), 'utf-8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** Body of a top-level shell function. */
function fnBody(name: string): string {
  const m = src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  expect(m, `function ${name} missing`).toBeTruthy();
  return m![0];
}

describe('workflow-push guard covers every publish path (#1269)', () => {
  it('shared predicate consults workflow_push_allowed', () => {
    expect(fnBody('workflow_publish_blocked')).toContain('workflow_push_allowed');
  });

  it('shepherd publish uses the shared predicate', () => {
    expect(fnBody('shepherd_publish')).toContain('workflow_publish_blocked');
  });

  it('every `push` of $BRANCH is preceded by the guard', () => {
    const lines = src.split('\n');
    const pushes = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /agent_worktree_git push\b/.test(l));
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    for (const { i } of pushes) {
      // nearest enclosing publish context: scan back up to 60 lines for the guard
      const window = lines.slice(Math.max(0, i - 60), i).join('\n');
      expect(window, `push at line ${i + 1} is unguarded`).toContain('workflow_publish_blocked');
    }
  });

  it('main path holds instead of pushing when the guard fires', () => {
    expect(src).toMatch(/elif WORKFLOW_STRAYS=\$\(workflow_publish_blocked\); then\s+hold_workflow_push/);
  });
});
