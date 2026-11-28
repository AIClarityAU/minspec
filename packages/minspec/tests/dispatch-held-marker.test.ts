/**
 * #4169 — the hold label is a best-effort network write, so a held issue also has a
 * local second witness: a `minspec-held` marker in the worktree's git directory.
 * dispatch-ready-check.sh must refuse an issue whose worktree carries it, even when
 * the issue is still `agent-ready` with no countermanding label (#1485), and
 * dispatch-issue.sh must retry the label write and fail visibly.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  vi.resetConfig();
});

const GATE = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');
const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const BODY = '# Fix the thing\n\nThe thing is broken. Please fix it.';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-held-'));
}

function gate(base: string, issue: string): { ok: boolean; out: string } {
  const dir = tmp();
  const verdict = path.join(dir, 'v');
  const body = path.join(dir, 'b');
  fs.writeFileSync(
    verdict,
    execFileSync(
      'bash',
      [GATE, '--render-record', 'agent-ready', 'dev', 'T2', 'no', 'none', '2026-07-29T00:00:00Z'],
      { input: BODY, encoding: 'utf-8' },
    ),
  );
  fs.writeFileSync(body, BODY);
  const r = spawnSync('bash', [GATE, 'OPEN', 'agent-ready,role:dev', verdict, body, issue], {
    encoding: 'utf-8',
    env: { ...process.env, MINSPEC_LEASE_WORKTREE_BASE: base },
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

function makeWorktree(base: string, name: string): string {
  const wt = path.join(base, name);
  fs.mkdirSync(wt, { recursive: true });
  execFileSync('git', ['init', '-q', wt]);
  return wt;
}

describe('dispatch-ready-check.sh — minspec-held marker (#4169)', () => {
  it('refuses an agent-ready issue whose worktree carries the marker', () => {
    const base = tmp();
    const wt = makeWorktree(base, 'issue-4242-sid-1-2');
    fs.writeFileSync(path.join(wt, '.git', 'minspec-held'), 'quarantined\n');
    const r = gate(base, '4242');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[held]');
  });

  it('does not refuse on [held] when the worktree has no marker, or belongs to another issue', () => {
    const base = tmp();
    makeWorktree(base, 'issue-4242-sid-1-2');
    const other = makeWorktree(base, 'issue-42420-sid-1-2');
    fs.writeFileSync(path.join(other, '.git', 'minspec-held'), 'x\n');
    expect(gate(base, '4242').out).not.toContain('[held]');
  });
});

describe('dispatch-issue.sh — hold_issue_labels (#4169)', () => {
  const src = fs.readFileSync(DISPATCH, 'utf-8');

  it('no hold path swallows the label write with a bare `|| true`', () => {
    for (const fn of ['quarantine_publish', 'hold_specify_scope', 'hold_workflow_push']) {
      const start = src.indexOf(`${fn}() {`);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      expect(body, fn).toContain('hold_issue_labels');
      expect(body, fn).not.toMatch(/gh issue edit[^\n]*\n[^\n]*--add-label[^\n]*\|\| true/);
    }
  });

  it('retries, then fails visibly and still leaves the marker', () => {
    const dir = tmp();
    const wt = makeWorktree(dir, 'wt');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho x >> "$GH_CALLS"\nexit 1\n', { mode: 0o755 });
    const calls = path.join(dir, 'calls');
    const start = src.indexOf('mark_worktree_held() {');
    const end = src.indexOf('# Quarantine path (#358)');
    const script = `${src.slice(start, end)}\nhold_issue_labels "test hold" "needs-human-review"; echo "rc=$?"`;
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_CALLS: calls,
        WORKTREE: wt,
        AGENT_WORKTREE_GIT_DIR: path.join(wt, '.git'),
        ISSUE: '7',
        REPO: 'o/r',
        HOLD_LABEL_RETRY_SLEEP: '0',
      },
    });
    expect(r.stdout).toContain('rc=1');
    expect(r.stderr).toContain('could NOT apply hold labels');
    expect(fs.readFileSync(calls, 'utf-8').trim().split('\n')).toHaveLength(3);
    expect(fs.existsSync(path.join(wt, '.git', 'minspec-held'))).toBe(true);
  });
});

describe('dispatch-ready-check.sh --clear-held (#4169 release path)', () => {
  it('clears the marker so a previously held issue is no longer refused [held]', () => {
    const base = tmp();
    const wt = makeWorktree(base, 'issue-4242-sid-1-2');
    const other = makeWorktree(base, 'issue-42420-sid-1-2');
    fs.writeFileSync(path.join(wt, '.git', 'minspec-held'), 'held\n');
    fs.writeFileSync(path.join(other, '.git', 'minspec-held'), 'held\n');
    expect(gate(base, '4242').out).toContain('[held]');
    const r = spawnSync('bash', [GATE, '--clear-held', '4242'], {
      encoding: 'utf-8',
      env: { ...process.env, MINSPEC_LEASE_WORKTREE_BASE: base },
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(wt, '.git', 'minspec-held'))).toBe(false);
    expect(fs.existsSync(path.join(other, '.git', 'minspec-held'))).toBe(true);
    expect(gate(base, '4242').out).not.toContain('[held]');
  });

  it('rejects a non-numeric issue number', () => {
    const r = spawnSync('bash', [GATE, '--clear-held', '../x'], { encoding: 'utf-8' });
    expect(r.status).toBe(2);
  });

  it('approve-issue.sh calls --clear-held, but not for an agent-quarantined issue', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/approve-issue.sh'), 'utf-8');
    expect(src).toMatch(/grep -qx "agent-quarantined" <<<"\$CURRENT_LABELS"[\s\S]*--clear-held "\$ISSUE"/);
  });
});
