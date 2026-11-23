/**
 * #1461 — a failed PAYG failover must be diagnosable, not reported as a plain
 * subscription quota block. Drives the REAL scripts/review-branch.sh against a stub
 * `claude` that fails differently per credential path.
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
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-branch-payg-'));
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

/** Subscription attempt: usage limit. PAYG attempt (OAuth token blanked): `paygErr`. */
function run(paygErr: string): { stdout: string; stderr: string } {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
for a in "$@"; do [ "$a" = "--help" ] && { echo "  --json-schema <schema>"; exit 0; }; done
cat >/dev/null
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo ${JSON.stringify(paygErr)} >&2
else
  echo "Claude AI usage limit reached|resets 5pm" >&2
fi
exit 1
`,
    { mode: 0o755 },
  );
  const r = spawnSync('bash', [SCRIPT, base, head, '--role', 'reviewer'], {
    cwd: workdir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AI_REVIEW_FAILOVER: 'payg',
      ANTHROPIC_API_KEY: 'sk-test-placeholder',
    },
  });
  fs.rmSync(bin, { recursive: true, force: true });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('#1461 PAYG failover failure is surfaced and classified', () => {
  it('prints the PAYG attempt’s own stderr to the log', () => {
    const { stderr } = run('Credit balance is too low');
    expect(stderr).toContain('PAYG failover also produced no verdict');
    expect(stderr).toContain('Credit balance is too low');
  });

  it('marks a dead credential as non-quota, in the marker', () => {
    const { stdout } = run('Credit balance is too low');
    expect(stdout).toContain('REVIEW_UNAVAILABLE_BEGIN');
    expect(stdout).toContain('failover: payg attempted');
    expect(stdout).toMatch(/non-quota reason/);
    expect(stdout).toContain('Credit balance is too low');
    // the subscription attempt's evidence is preserved, not overwritten
    expect(stdout).toMatch(/resets 5pm/);
  });

  it('marks a PAYG rate-limit as transient', () => {
    const { stdout } = run('429 rate limit exceeded');
    expect(stdout).toMatch(/PAYG also rate-limited/);
  });
});
