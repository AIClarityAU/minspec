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
function credsSeenByChild(env: Record<string, string>): {
  oauth: string;
  apiKey: string;
  reviewerCalls: number;
} {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  const seen = path.join(bin, 'seen.env');
  const calls = path.join(bin, 'reviewer.calls');
  const outFile = path.join(bin, 'payload.out');
  fs.writeFileSync(outFile, VERDICT);
  // The `--help` arm exists because review-branch.sh probes `claude -p --help` for
  // `--json-schema` before it will review at all (DR-079 fail-closed preflight). A stub
  // that does not advertise the flag makes the script refuse and exit BEFORE
  // run_reviewer, and then the only child that ever ran is the probe — so all three
  // assertions below would be satisfied by the probe's own hardcoded scrub while
  // run_reviewer went completely unexercised. That is a vacuous green, not a passing
  // invariant. The arm returns WITHOUT recording, so `seen.env` and `reviewer.calls`
  // describe the REVIEWER invocation only.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
for a in "$@"; do
  [ "$a" = "--help" ] && { echo "  --json-schema <schema>"; exit 0; }
done
cat >/dev/null
echo call >> ${JSON.stringify(calls)}
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
  const callText = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf-8') : '';
  fs.rmSync(bin, { recursive: true, force: true });
  return {
    oauth: /OAUTH=\[(.*)\]/.exec(text)?.[1] ?? '<stub never ran>',
    apiKey: /APIKEY=\[(.*)\]/.exec(text)?.[1] ?? '<stub never ran>',
    reviewerCalls: callText.split('\n').filter(Boolean).length,
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
    expect(seen.reviewerCalls, 'run_reviewer must actually have been reached').toBe(1);
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
    expect(seen.reviewerCalls, 'run_reviewer must actually have been reached').toBe(1);
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
    expect(seen.reviewerCalls, 'run_reviewer must actually have been reached').toBe(1);
    expect(seen.apiKey).toBe('');
  });

  it('the assertions above observe run_reviewer, never the preflight probe (anti-vacuity)', () => {
    // The guard for the defect this suite nearly acquired: review-branch.sh probes
    // `claude -p --help` for --json-schema BEFORE run_reviewer, and that probe carries
    // its own hardcoded `ANTHROPIC_API_KEY=''`. A stub that fails the probe makes the
    // script exit early, leaving the probe as the ONLY observation — at which point
    // every assertion above passes without run_reviewer running at all, and deleting
    // the real scrub could not turn any of them red.
    //
    // This locks the distinction directly: exactly one RECORDED call (the probe never
    // records), and it carries the reviewer's argv, not `--help`.
    const seen = credsSeenByChild({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok-fixture',
      ANTHROPIC_API_KEY: 'sk-ant-should-not-reach-the-child',
    });
    expect(seen.reviewerCalls).toBe(1);
    expect(seen.oauth).not.toBe('<stub never ran>');
    expect(seen.apiKey).not.toBe('<stub never ran>');
  });
});
