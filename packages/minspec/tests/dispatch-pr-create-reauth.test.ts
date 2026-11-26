/**
 * T3 — regression (#4062): a 401 on `gh pr create` must trigger ONE forced token
 * re-mint + retry, and a PR that still cannot be made must fail the dispatch.
 *
 * Root cause: dispatch-issue.sh refreshed the token by AGE (gh_bot_refresh) before
 * the post-build writes, but the broker can hand back a token dead inside its
 * headroom (#2114); the `gh pr list`/`gh pr create` that followed swallowed every
 * error and never called gh_bot_reauth_read, so a 401 became a WARNING + return 0,
 * stranding a finished branch with no PR (#4061). Missing gate: no failure signal.
 *
 * Exercises the shipped `ensure_branch_pr` block (lifted between its markers).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

function findScript(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, 'scripts', 'dispatch-issue.sh');
    if (fs.existsSync(c)) return c;
    dir = path.dirname(dir);
  }
  throw new Error('dispatch-issue.sh not found');
}
const content = fs.readFileSync(findScript(), 'utf-8');

function block(): string {
  const b = content.indexOf('# >>> ensure-branch-pr');
  const e = content.indexOf('# <<< ensure-branch-pr');
  if (b < 0 || e < b) throw new Error('ensure-branch-pr markers missing');
  return content.slice(content.indexOf('\n', b) + 1, e);
}

// `gh` stub: a created PR exists only if the create ran with a "good" token.
// Token state: file `tok` holds "dead" until reauth flips it to "live".
const GH = `#!/usr/bin/env bash
S="$GH_STUB_STATE"
printf '%s\\n' "$*" >> "$S/calls.log"
tok=$(cat "$S/tok")
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  if [ "$tok" = "live" ]; then echo 77 > "$S/pr"; exit 0; fi
  echo "gh: Bad credentials (HTTP 401)" >&2; exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  if [ "$tok" = "dead" ] && [ ! -f "$S/pr" ]; then echo "gh: Bad credentials (HTTP 401)" >&2; exit 1; fi
  [ -f "$S/pr" ] && cat "$S/pr"; exit 0
fi
exit 0
`;

function run(reauthOk: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-pr-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), GH, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'calls.log'), '');
    fs.writeFileSync(path.join(dir, 'tok'), 'dead');
    const script = [
      'set -euo pipefail',
      'REPO=O/R; BRANCH=agent/issue-1; ISSUE_TITLE=t; BODY=b',
      `gh_bot_reauth_read() { echo REAUTH >> "$GH_STUB_STATE/calls.log"; ${
        reauthOk ? 'echo live > "$GH_STUB_STATE/tok"; return 0' : 'return 1'
      }; }`,
      block(),
      'ensure_branch_pr',
      'echo "PR=[$ENSURED_PR_NUM]"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STUB_STATE: dir },
    });
    return {
      status: r.status,
      stdout: r.stdout || '',
      calls: fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8').split('\n').filter(Boolean),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('dispatch-issue.sh — PR create re-auths once on a 401 and fails visibly (#4062)', () => {
  it('retries the create after a forced re-mint when the first create 401s', () => {
    const r = run(true);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('PR=[77]');
    expect(r.calls.filter((c) => c === 'REAUTH')).toHaveLength(1);
    expect(r.calls.filter((c) => c.startsWith('pr create'))).toHaveLength(2);
  });

  it('leaves the PR number empty (caller fails the dispatch) when re-auth yields no new token', () => {
    const r = run(false);
    expect(r.stdout).toContain('PR=[]');
    expect(r.calls.filter((c) => c === 'REAUTH')).toHaveLength(1);
    expect(r.calls.filter((c) => c.startsWith('pr create'))).toHaveLength(1);
  });

  it('the caller turns an empty PR into a non-zero dispatch exit, not a quiet return 0', () => {
    expect(content).toMatch(/PR_STRANDED=1\n\s+return 1/);
    expect(content).toMatch(/if \[\[ "\$\{PR_STRANDED:-0\}" == "1" \]\]; then\n\s+exit 1\nfi\nexit_started/);
  });
});
