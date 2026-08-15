/**
 * T3 regression — the subscription reviewer path must not inherit ANTHROPIC_API_KEY.
 *
 * `claude -p` selects ONE credential, and an API key present in the environment wins
 * over CLAUDE_CODE_OAUTH_TOKEN. `run_reviewer`'s payg branch has always scrubbed the
 * OAuth token so the failover cannot accidentally ride the subscription; the
 * subscription branch had no mirror-image scrub, because until the failover was wired
 * into ai-review.yml the key was never in that environment at all.
 *
 * Wiring it in broke that assumption and the normal path silently became a PAYG call.
 * Measured on PR #1287 run 31143035538: three of four voters exited with
 * `Credit balance is too low` and `review-branch.sh: reviewer agent (role=reviewer)
 * failed (non-quota) — gate fails closed`, on a run that never intended to use PAYG.
 * The gate failed closed, so nothing un-reviewed could merge — but the reviewer was
 * dead, and the cause was an ambient credential rather than anything in the diff.
 *
 * The invariant these lock: the failover is reachable ONLY through the explicit
 * `run_reviewer payg` call, never by ambient environment.
 *
 * These drive the REAL scripts/review-branch.sh against a stub `claude` that reports
 * what it actually saw in its environment, so a source-text change that did not
 * survive into the spawned process would still fail here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/review-branch.sh');

let workdir: string;
let base: string;
let head: string;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cred-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: workdir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@e',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@e',
      },
    });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(workdir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(workdir, 'a.txt'), 'one\ntwo\n');
  git('add', '-A');
  git('commit', '-qm', 'head');
  head = git('rev-parse', 'HEAD').trim();
});

afterAll(() => fs.rmSync(workdir, { recursive: true, force: true }));

const VERDICT = `REVIEW_VERDICT_BEGIN
verdict: pass
blocking: 0
summary: stub
REVIEW_VERDICT_END
`;

/**
 * Run the real review-branch.sh with a stub `claude` that WRITES ITS OWN VIEW of the
 * two credential variables to a side file. We assert on what the child actually saw,
 * not on the parent's intent — the whole defect was a value surviving into the child.
 */
function credsSeenByChild(env: Record<string, string>): { oauth: string; apiKey: string } {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  const seen = path.join(bin, 'seen.env');
  const outFile = path.join(bin, 'payload.out');
  fs.writeFileSync(outFile, VERDICT);
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
cat >/dev/null
printf 'OAUTH=[%s]\\nAPIKEY=[%s]\\n' "\${CLAUDE_CODE_OAUTH_TOKEN-UNSET}" "\${ANTHROPIC_API_KEY-UNSET}" > ${JSON.stringify(seen)}
cat ${JSON.stringify(outFile)}
exit 0
`,
    { mode: 0o755 },
  );
  spawnSync('bash', [SCRIPT, base, head, '--role', 'reviewer'], {
    cwd: workdir,
    encoding: 'utf-8',
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
  });
  const text = fs.existsSync(seen) ? fs.readFileSync(seen, 'utf-8') : '';
  fs.rmSync(bin, { recursive: true, force: true });
  return {
    oauth: /OAUTH=\[(.*)\]/.exec(text)?.[1] ?? '<stub never ran>',
    apiKey: /APIKEY=\[(.*)\]/.exec(text)?.[1] ?? '<stub never ran>',
  };
}

describe('reviewer credential isolation — the subscription path never rides PAYG', () => {
  it('does NOT pass ANTHROPIC_API_KEY to the reviewer when the subscription token is present', () => {
    // THE REGRESSION. Before the fix the child saw the real key and `claude -p`
    // preferred it, turning every "subscription" review into an unintended PAYG call.
    const seen = credsSeenByChild({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok-fixture',
      ANTHROPIC_API_KEY: 'sk-ant-should-not-reach-the-child',
    });
    expect(seen.apiKey).toBe('');
    expect(seen.apiKey).not.toContain('sk-ant');
  });

  it('still passes the subscription token through (the scrub is surgical, not a blanket wipe)', () => {
    // Guards the obvious over-correction: scrubbing the whole credential environment
    // would "fix" the bug by breaking the reviewer, and the test above alone would
    // not notice.
    const seen = credsSeenByChild({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok-fixture',
      ANTHROPIC_API_KEY: 'sk-ant-should-not-reach-the-child',
    });
    expect(seen.oauth).toBe('oauth-tok-fixture');
  });

  it('scrubs the key even when no subscription token is set (no ambient PAYG fallback)', () => {
    // Absent an OAuth token the ambient key would otherwise be the only credential,
    // so `claude -p` would use it — a PAYG call nobody asked for and no failover
    // decision authorized. Reaching PAYG must require the explicit payg branch.
    const seen = credsSeenByChild({
      CLAUDE_CODE_OAUTH_TOKEN: '',
      ANTHROPIC_API_KEY: 'sk-ant-should-not-reach-the-child',
    });
    expect(seen.apiKey).toBe('');
  });
});
