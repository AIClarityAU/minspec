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
 *     path calls that seam;
 *   - through the real completion block with a stubbed `gh`: a specify run applies
 *     `awaiting-spec-signoff` beside `agent-done`, and a build run removes it in the same
 *     call that stamps `agent-done`;
 *   - through the real approve-issue.sh label clear with a stubbed `gh`: an approval
 *     clears `awaiting-spec-signoff`;
 *   - both copies of the closing-keyword grammar, extracted from the script and executed
 *     over one table of bodies.
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
import * as os from 'os';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();

const ROOT = path.resolve(__dirname, '../../..');
const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');
const APPROVE = path.join(ROOT, 'scripts', 'approve-issue.sh');

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

});

/** Run a span of real script with a `gh` stub that logs argv and exits per `ghExit`. */
function runSpanWithGh(span: string, vars: string, ghExit = 'exit 0'): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specify-keeps-'));
  try {
    const log = path.join(dir, 'calls.log');
    fs.writeFileSync(
      path.join(dir, 'gh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${ghExit}\n`,
      { mode: 0o755 },
    );
    const r = spawnSync('bash', ['-c', `set -uo pipefail\n${vars}\n${span}`], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    expect(r.status, r.stderr).toBe(0);
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers moved: ${from} .. ${to}. Fix this extractor, do not delete the test (#3351 review).`);
  return src.slice(a, b);
}

describe('the sign-off label cannot outlive the spec stage (#3351 review)', () => {
  const dispatchSrc = fs.readFileSync(DISPATCH, 'utf-8');
  const approveSrc = fs.readFileSync(APPROVE, 'utf-8');
  const completion = between(dispatchSrc, 'gh label create "awaiting-spec-signoff"', 'echo "Agent completed issue #$ISSUE');
  const stampOf = (calls: string[]) => calls.filter((c) => c.startsWith('issue edit 42'));

  it('a finished specify run labels the open issue awaiting-spec-signoff, keeping agent-done', () => {
    const calls = runSpanWithGh(completion, 'REPO=o/r; ISSUE=42; SPECIFY_ONLY=1');
    expect(calls[0]).toMatch(/^label create awaiting-spec-signoff/);
    expect(stampOf(calls)).toHaveLength(1);
    expect(stampOf(calls)[0]).toContain('--add-label agent-done,awaiting-spec-signoff');
  });

  it('a finished build stamps agent-done and removes the label in the SAME call, so no reader sees both', () => {
    const calls = runSpanWithGh(completion, 'REPO=o/r; ISSUE=42; SPECIFY_ONLY=0');
    // Created first: `gh` fails the whole edit on a name the repo does not have.
    expect(calls[0]).toMatch(/^label create awaiting-spec-signoff/);
    expect(stampOf(calls)).toHaveLength(1);
    expect(stampOf(calls)[0]).toContain('--remove-label agent-running,agent-ready,awaiting-spec-signoff');
    expect(stampOf(calls)[0]).toContain('--add-label agent-done');
    expect(stampOf(calls)[0]).not.toContain('--add-label agent-done,awaiting-spec-signoff');
  });

  const clearSpan = between(approveSrc, 'if grep -qx "awaiting-spec-signoff"', 'echo "Approved #${ISSUE} as');
  const CARRIED = `REPO=o/r; ISSUE=42; CURRENT_LABELS=$'agent-done\\nawaiting-spec-signoff\\nhold:specify'`;

  it('an approval clears the label when the issue carries it, because a build follows', () => {
    expect(runSpanWithGh(clearSpan, CARRIED)).toEqual(['issue edit 42 --repo o/r --remove-label awaiting-spec-signoff']);
  });

  it('an approval names no such label when the issue does not carry it', () => {
    expect(runSpanWithGh(clearSpan, `REPO=o/r; ISSUE=42; CURRENT_LABELS=$'hold:tier'`)).toEqual([]);
  });

  it('a failed clear warns, and does not stop the approval', () => {
    const r = spawnSync('bash', ['-c', `set -euo pipefail\ngh() { return 1; }\n${CARRIED}\n${clearSpan}\necho reached`], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('could not clear awaiting-spec-signoff');
    expect(r.stdout).toContain('reached');
  });
});

/**
 * Both copies of the grammar, as the script holds them: the ERE run through `grep -iE` and
 * every jq `test(...)` run through real jq. The expected column is GitHub's grammar written
 * here by hand, and GITHUB_CLOSES above is checked against it too.
 */
describe('CLOSING_KEYWORD_ERE and the jq copies agree with one table (#3348)', () => {
  const dispatchSrc = fs.readFileSync(DISPATCH, 'utf-8');
  const ereLine = dispatchSrc.split('\n').find((l) => l.startsWith('CLOSING_KEYWORD_ERE='));
  const jqFilters = [...dispatchSrc.matchAll(/\(test\("\(\^\|\[\^a-z\]\)\(close.*?"; "i"\)\)/g)].map((m) => m[0]);

  const TABLE: [string, boolean][] = [
    ['Closes #42', true],
    ['closed #42', true],
    ['CLOSE #42', true],
    ['Fix #42', true],
    ['fixes: #42', true],
    ['FIXED #42', true],
    ['Resolve #42', true],
    ['resolves #42', true],
    ['resolved:#42', true],
    ['closes#42', true],
    ['Resolves\t#42', true],
    ['Fixes AIClarityAU/minspec#42', true],
    ['Fixes: AIClarityAU/minspec#42', true],
    ['closes https://github.com/AIClarityAU/minspec/issues/42', true],
    ['summary\nFIXED #42\nmore', true],
    ['(fixes #42)', true],
    ['Refs #42', false],
    ['Discloses #5', false],
    ['Prefix #5', false],
    ['unresolved #5', false],
    ['this closes nothing', false],
    ['fixes the bug in issue 42', false],
    ['', false],
  ];

  function ereMatches(body: string): boolean {
    const r = spawnSync('bash', ['-c', `${ereLine}\ngrep -qiE "$CLOSING_KEYWORD_ERE"`], { input: body, encoding: 'utf-8' });
    expect(r.status === 0 || r.status === 1, r.stderr).toBe(true);
    return r.status === 0;
  }

  function jqMatches(filter: string, body: string): boolean {
    const r = spawnSync('jq', ['-r', `.body | ${filter}`], { input: JSON.stringify({ body }), encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim() === 'true';
  }

  it('the extractors found the ERE and both jq copies', () => {
    expect(ereLine).toBeTruthy();
    expect(jqFilters).toHaveLength(2);
  });

  it.each(TABLE)('%j -> %s, in the ERE, in each jq copy, and in the hand-written grammar', (body, expected) => {
    expect(ereMatches(body)).toBe(expected);
    for (const f of jqFilters) expect(jqMatches(f, body)).toBe(expected);
    expect(GITHUB_CLOSES.test(body)).toBe(expected);
  });
});
