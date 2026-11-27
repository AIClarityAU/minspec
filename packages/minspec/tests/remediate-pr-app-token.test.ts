/**
 * remediate-pr.sh under the identity the drain really runs as (#3592).
 *
 * The drain writes with an App installation token. Such a token has no user, so
 * `gh api user` always answers 403 "Resource not accessible by integration" (#3037). The
 * runaway guard must still count its own budget markers in that shape, by the App's bot
 * login, and only those: a human's or the reviewer's comment that ends in a marker must
 * never be charged. When no identity can be established at all, the sweep must spend no
 * agent AND hand the pull request to a human with a label, never stop with only a stderr
 * line (constitution invariant 2, no silent gate).
 *
 * Every test here RUNS the real script through the launch harness (stub `gh` and stub
 * agent on PATH). The harness's default `gh api user` is the installation 403.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  APP,
  FOUNDER,
  ACTIONS_APP,
  cleanupLaunchHarness,
  runRemediate,
  type CommentFixture,
} from './helpers/agent-launch-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
afterEach(cleanupLaunchHarness);

const ATTEMPT = '<!-- minspec-auto-remediation -->';
const marked = (author: unknown, n: number): CommentFixture => ({ author, body: `note ${n}\n${ATTEMPT}` });
const labelled = (writes: string[]): boolean => writes.some((w) => w.startsWith('pr edit'));

describe('remediate-pr.sh on an App installation token (#3592)', () => {
  it('counts only the App bot login: one own marker plus three foreign ones is attempt 2/2', () => {
    // Any-author counting would see 4 and cap; an empty allowlist would see 0 (1/2), and
    // the skip that #3592's first fix added would launch nothing at all.
    const run = runRemediate({
      comments: [marked(APP, 1), marked(FOUNDER, 2), marked(ACTIONS_APP, 3), marked(FOUNDER, 4)],
    });
    expect(run.out).toContain('Attempt 2/2');
    expect(run.out).not.toContain('Cap reached');
    expect(run.out).not.toContain('could not establish');
    expect(run.launches, run.out).toHaveLength(1);
  });

  it('caps on the App bot login\'s own markers and labels the pull request', () => {
    const run = runRemediate({ comments: [marked(APP, 1), marked(APP, 2)] });
    expect(run.out).toContain('Cap reached');
    expect(run.launches, run.out).toHaveLength(0);
    expect(labelled(run.ghWrites), run.ghWrites.join('\n')).toBe(true);
  });

  it('with no comments at all, the sweep is not skipped: the agent runs as attempt 1/2', () => {
    const run = runRemediate();
    expect(run.out).toContain('Attempt 1/2');
    expect(run.launches, run.out).toHaveLength(1);
  });
});

describe('remediate-pr.sh when no identity can be established (#3592)', () => {
  const NO_IDENTITY = { STUB_GH_USER_ERROR: 'HTTP 401: Bad credentials (https://api.github.com/user)' };

  it('spends no agent and labels the pull request needs-human-review', () => {
    const run = runRemediate({ env: NO_IDENTITY, comments: [marked(APP, 1)] });
    expect(run.stderr).toContain('could not establish which account posts');
    expect(run.launches, run.out).toHaveLength(0);
    expect(labelled(run.ghWrites), run.ghWrites.join('\n')).toBe(true);
  });

  it('a red delegated-approval pull request still reaches a human', () => {
    const run = runRemediate({ env: NO_IDENTITY, pr: { headRefName: 'dlg-approve/fixture' } });
    expect(run.out).toContain('Delegated-approval PR: could not establish');
    expect(run.launches, run.out).toHaveLength(0);
    expect(labelled(run.ghWrites), run.ghWrites.join('\n')).toBe(true);
  });
});

describe('remediate-pr.sh on a user token', () => {
  it('counts its own login, widened by MINSPEC_REMEDIATE_AUTHOR_LOGINS', () => {
    const op = { __typename: 'User', login: 'fixture-operator', databaseId: 900000010 };
    const second = { __typename: 'User', login: 'second-op', databaseId: 900000011 };
    const comments = [marked(op, 1), marked(second, 2)];
    const own = runRemediate({ env: { STUB_GH_LOGIN: 'fixture-operator' }, comments });
    expect(own.out).toContain('Attempt 2/2');
    const widened = runRemediate({
      env: { STUB_GH_LOGIN: 'fixture-operator', MINSPEC_REMEDIATE_AUTHOR_LOGINS: 'second-op' },
      comments,
    });
    expect(widened.out).toContain('Cap reached');
    expect(widened.launches, widened.out).toHaveLength(0);
  });
});
