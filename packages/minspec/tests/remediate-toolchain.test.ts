/**
 * T3 - a remediation worktree gets its OWN node_modules, or no agent runs (#3238).
 *
 * Root cause: remediate-pr.sh made the worktree with a bare `git worktree add`;
 * node_modules is gitignored so it had none, `npm ci` is denied network in the sandbox,
 * and every agent escalated on the fail-closed validate gate. Nothing checked for a
 * runnable toolchain before the agent was launched.
 */
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupLaunchHarness, runRemediate } from './helpers/agent-launch-harness';

afterEach(cleanupLaunchHarness);

describe('remediate-pr.sh toolchain provisioning', () => {
  it('offline install fails: zero agent launches and a visible marked comment', () => {
    const run = runRemediate({
      prepare: ({ dir }) => fs.writeFileSync(path.join(dir, 'npm-fail'), ''),
    });
    expect(run.launches).toHaveLength(0);
    expect(run.posted.join('\n')).toContain('remediation-unrunnable: no node_modules');
    expect(run.out).toContain('remediation-unrunnable');
  });

  it('offline install succeeds: agent runs in a worktree with a real node_modules', () => {
    const seen: { link: boolean; tsx: boolean } = { link: true, tsx: false };
    const run = runRemediate({
      prepare: ({ dir }) => {
        const act = path.join(dir, 'agent-act.sh');
        fs.writeFileSync(
          act,
          `#!/usr/bin/env bash
if [[ -L node_modules ]]; then echo link > "${dir}/nm-kind"; else echo real > "${dir}/nm-kind"; fi
[[ -x node_modules/.bin/tsx ]] && echo yes > "${dir}/nm-tsx"
`,
          { mode: 0o755 },
        );
      },
    });
    expect(run.launches.length).toBeGreaterThan(0);
    seen.link = fs.readFileSync(path.join(run.dir, 'nm-kind'), 'utf-8').trim() === 'link';
    seen.tsx = fs.existsSync(path.join(run.dir, 'nm-tsx'));
    expect(seen).toEqual({ link: false, tsx: true });
    const log = fs.readFileSync(path.join(run.dir, 'npm-ci.log'), 'utf-8');
    expect(log).toContain('--offline');
    expect(log).toContain('--ignore-scripts');
    expect(run.posted.join('\n')).not.toContain('remediation-unrunnable');
  });
});
