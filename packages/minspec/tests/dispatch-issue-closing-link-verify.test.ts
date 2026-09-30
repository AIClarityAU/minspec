/**
 * T2 — #2228: dispatched PRs must be VERIFIED to have actually linked their
 * `Closes #N` trailer, not just trusted to have.
 *
 * Root cause: #1322 made the dispatcher WRITE a deterministic `Closes #$ISSUE`
 * trailer into every auto-dispatched PR body, so closure no longer depended on
 * the agent spontaneously writing a GitHub keyword. But #1322 never closed the
 * other half of the loop — nothing anywhere in the pipeline READ GitHub's own
 * parsed result (`closingIssuesReferences`) back to confirm the trailer
 * actually took. #2228 found PRs opened after ~05:20Z on 2026-09-30 carrying
 * the trailer verbatim with `closingIssuesReferences` reported EMPTY by
 * GitHub — the external trigger for THAT is unverified (a GitHub-side
 * incident is the lead candidate, per the issue), but the pipeline defect is
 * independent of whatever triggered it: a required outcome (merge closes the
 * issue) rested on a single unwitnessed producer (the keyword parser),
 * violating constitution invariant 2 ("no required check hinges on a single
 * producer that one permission/config gap can disable — provide an
 * independent second witness").
 *
 * This suite proves the new witness: a pure classifier
 * (`issue_linked_in_closing_refs`, exposed via the `--issue-linked` seam) that
 * decides whether a target issue number appears in GitHub's own
 * `closingIssuesReferences` list, plus static assertions that the dispatcher
 * actually reads that list back after creating/finding the PR and fails
 * VISIBLY (needs-human-review label + PR comment), never silently, when it
 * does not.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const scriptPath = path.join(root, 'scripts', 'dispatch-issue.sh');

/**
 * Run the pure seam. `refs` is the newline-separated closingIssuesReferences
 * issue numbers (the shape `gh pr view --json closingIssuesReferences --jq
 * '.closingIssuesReferences[].number'` emits) fed on stdin; `target` is the
 * issue the dispatcher is trying to confirm. Exit 0 = linked, 1 = not linked.
 */
function isLinked(refs: string, target: string): { code: number } {
  try {
    execFileSync('bash', [scriptPath, '--issue-linked', target], {
      input: refs,
      encoding: 'utf-8',
    });
    return { code: 0 };
  } catch (e: any) {
    return { code: e.status ?? -1 };
  }
}

describe('dispatch-issue.sh — issue_linked_in_closing_refs pure classifier (#2228)', () => {
  it('confirms linkage when the target issue is the only ref', () => {
    expect(isLinked('2034\n', '2034').code).toBe(0);
  });

  it('confirms linkage when the target issue is among several refs', () => {
    expect(isLinked('1\n2068\n900\n', '2068').code).toBe(0);
  });

  it('reports NOT linked when the refs list is empty (the #2228 failure shape)', () => {
    expect(isLinked('', '2222').code).toBe(1);
  });

  it('reports NOT linked when refs exist but not for this issue', () => {
    expect(isLinked('2034\n900\n', '2222').code).toBe(1);
  });

  it('does not let a substring false-match (target 22 vs ref 220)', () => {
    // A bare (non-anchored) grep would treat "22" as found inside "220". The
    // classifier must match the WHOLE line, exactly.
    expect(isLinked('220\n', '22').code).toBe(1);
  });

  it('matches exactly on a multi-ref list without trailing newline', () => {
    expect(isLinked('4\n2178\n17', '2178').code).toBe(0);
  });
});

describe('dispatch-issue.sh — the closing-link verification is actually wired (#2228)', () => {
  const content = fs.readFileSync(scriptPath, 'utf-8');

  it('reads back closingIssuesReferences after the PR is confirmed to exist', () => {
    const prConfirmedIdx = content.indexOf('WARNING: no PR for $BRANCH');
    expect(prConfirmedIdx).toBeGreaterThan(-1);
    const afterPrConfirmed = content.slice(prConfirmedIdx);
    expect(afterPrConfirmed).toMatch(
      /gh pr view "\$pr_num" --repo "\$REPO" --json closingIssuesReferences/,
    );
    expect(afterPrConfirmed).toMatch(/issue_linked_in_closing_refs "\$ISSUE"/);
  });

  it('fails closed on a read error — an API failure is never treated as confirmation', () => {
    const idx = content.indexOf('gh pr view "$pr_num" --repo "$REPO" --json closingIssuesReferences');
    expect(idx).toBeGreaterThan(-1);
    const block = content.slice(idx, idx + 400);
    // The swallow (`2>/dev/null || true`) must feed the SAME "not linked" branch
    // as a genuinely empty list, not skip the check.
    expect(block).toMatch(/2>\/dev\/null \|\| true/);
    expect(block).toMatch(/if ! issue_linked_in_closing_refs/);
  });

  it('an unconfirmed link is flagged VISIBLY — needs-human-review label + PR comment, never silent', () => {
    const idx = content.indexOf('if ! issue_linked_in_closing_refs "$ISSUE"');
    expect(idx).toBeGreaterThan(-1);
    const block = content.slice(idx, idx + 900);
    expect(block).toMatch(/gh pr edit "\$pr_num" --repo "\$REPO" --add-label "needs-human-review"/);
    expect(block).toMatch(/gh pr comment "\$pr_num" --repo "\$REPO" --body/);
    expect(block).toMatch(/WARNING:.*closingIssuesReferences/);
  });

  it('the verification runs BEFORE native auto-merge can arm (6a precedes 6b)', () => {
    const verifyIdx = content.indexOf('issue_linked_in_closing_refs "$ISSUE"');
    // Anchor on the 6b step comment inside run_reviewer_stage, not the bare
    // `native_automerge_enabled` call — that identifier also appears much
    // earlier as the `--check-native-automerge` pure-seam dispatch (line ~94),
    // which would make this assertion pass vacuously against the wrong site.
    const automergeIdx = content.indexOf('6b. Native auto-merge (DR-061)');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(automergeIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(automergeIdx);
  });
});
