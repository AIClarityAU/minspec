/**
 * T3 - a specify-only spec PR must not close its build issue (#3348).
 *
 * Root cause: the dispatcher appended `Closes #N` to every PR body it published
 * (#1322), with no SPECIFY_ONLY guard. A specify-only dispatch (DR-076, `hold:specify`)
 * publishes the SPEC for issue N, not its build, so merging the spec closed the issue
 * that was meant to carry the build. 120 `hold:specify` issues were closed COMPLETED
 * this way and their builds were never started. No gate asserted that a spec PR closes
 * nothing, so the state was never rejected.
 *
 * Pinned here:
 *   - as behaviour, through the real seam: `--specify-pr-body N` turns every closing
 *     keyword into a plain reference and leaves exactly one `Refs #N`, whatever the
 *     agent's summary or the review block said;
 *   - as source text only, which proves the lines exist and not that they run: the publish
 *     path calls that seam, and the specify arm applies `awaiting-spec-signoff` beside
 *     `agent-done`.
 * Pinned elsewhere:
 *   - the inverted post-create link witness (arm only on a read, empty closing list), through
 *     the real 6a..6b span: dispatch-issue-closing-link-verify.test.ts;
 *   - the delegated spec merge refusing a spec PR that would close anything:
 *     delegated-merge-seam.test.ts;
 *   - the issue surviving the drain after its spec PR merges, through the real reconciler:
 *     drain-reconcile.test.ts.
 * Nothing here runs a dispatch or follows an issue past the merge.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../../..');
const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');

/** Comment-only lines stripped, so a prose mention can never satisfy a wiring assertion. */
const dispatchCode = fs
  .readFileSync(DISPATCH, 'utf-8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/**
 * GitHub's closing-keyword grammar, written independently of the script's own pattern so
 * the two cannot drift together: close/closes/closed, fix/fixes/fixed, resolve/resolves/
 * resolved, optional colon, then `#N`, `owner/repo#N` or an issue URL.
 */
const GITHUB_CLOSES = /(^|[^a-z])(close[sd]?|fix(e[sd])?|resolve[sd]?)[:\s]*([a-z0-9._-]+\/[a-z0-9._-]+)?(#|https?:\/\/)/i;

function specifyBody(issue: string, body: string) {
  const r = spawnSync('bash', [DISPATCH, '--specify-pr-body', issue], { input: body, encoding: 'utf-8' });
  return { status: r.status, out: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('--specify-pr-body: a spec PR body references its issue and closes nothing (#3348)', () => {
  it.each([
    ['the dispatcher trailer', 'Spec drafted.\n\nCloses #42'],
    ['an agent-written Fixes with a colon and owner/repo', 'Fixes: AIClarityAU/minspec#42'],
    ['past tense, lower case', 'this resolved #42 already'],
    ['an issue URL', 'closes https://github.com/AIClarityAU/minspec/issues/42'],
    ['two on one line and a different issue', 'Closes #42, fixes #7'],
    ['a keyword at the very start of a later line', 'summary\nFIXED #42\nmore'],
    ['a tab separator', 'Resolves\t#42'],
  ])('%s: no closing keyword survives, and Refs #42 is present once', (_n, body) => {
    const r = specifyBody('42', body);
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(GITHUB_CLOSES);
    expect(r.out.match(/Refs #42\b/g)).toHaveLength(1);
  });

  it('keeps the rest of the body and references a different issue without closing it', () => {
    const r = specifyBody('42', 'Wrote SPEC-300.\n\nCloses #42, fixes #7');
    expect(r.out).toContain('Wrote SPEC-300.');
    expect(r.out).toMatch(/Refs #7\b/);
    expect(r.out).not.toMatch(GITHUB_CLOSES);
  });

  it('a body with no reference at all gains exactly one Refs line', () => {
    const r = specifyBody('42', 'Agent completed (no summary written).');
    expect(r.status).toBe(0);
    expect(r.out.trim().endsWith('Refs #42')).toBe(true);
    expect(r.out.match(/Refs #42\b/g)).toHaveLength(1);
  });

  it('a word that merely ends in a keyword is left alone (Discloses #5 is not a keyword)', () => {
    const r = specifyBody('42', 'Discloses #5 only.');
    expect(r.out).toContain('Discloses #5 only.');
  });

  it('Refs #420 does not count as a reference to #42', () => {
    const r = specifyBody('42', 'Refs #420');
    expect(r.out.match(/Refs #42\b/g)).toHaveLength(1);
  });

  it('a non-numeric issue is a usage error, never a silently unguarded body', () => {
    const r = specifyBody('abc', 'Closes #42');
    expect(r.status).not.toBe(0);
    expect(r.out).toBe('');
  });
});

describe('dispatch-issue.sh: the publish path uses the guard in specify-only mode (#3348)', () => {
  it('the trailer is Refs, not Closes, when SPECIFY_ONLY=1', () => {
    expect(dispatchCode).toMatch(/if \[\[ "\$SPECIFY_ONLY" == "1" \]\][\s\S]{0,200}Refs #%s/);
  });

  it('the assembled body passes through specify_pr_body before any PR is created', () => {
    const guard = dispatchCode.indexOf('BODY=$(specify_pr_body "$ISSUE"');
    const reviewer = dispatchCode.indexOf('run_reviewer_stage ||');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(reviewer);
  });

  it('a finished specify run labels the open issue awaiting-spec-signoff, keeping agent-done', () => {
    expect(dispatchCode).toMatch(/gh label create "awaiting-spec-signoff"/);
    expect(dispatchCode).toMatch(/--add-label "agent-done,awaiting-spec-signoff"/);
  });
});
