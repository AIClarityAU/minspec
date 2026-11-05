/**
 * #1202 — a harness crash must be separable from a reasoned escalation.
 *
 * `agent-escalated` alone cannot distinguish "the agent asked for a human" from "the
 * run was killed and never made an attempt". The crash path now also stamps
 * `agent-crashed` and posts the crash signature as a comment, so the reason outlives
 * the /tmp-scoped drain log. The genuine-escalation path must NOT carry the label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(__dirname, '../../..');
const src = readFileSync(resolve(root, 'scripts/dispatch-issue.sh'), 'utf8');
const crashStart = src.indexOf('#1307 — a CRASH raises the human gate');
const crashBlock = src.slice(crashStart, src.indexOf('\nfi\n', crashStart));

describe('#1202 crash path records why it terminated', () => {
  it('locates the crash block', () => {
    expect(crashStart).toBeGreaterThan(0);
  });

  it('stamps agent-crashed on the crash path', () => {
    expect(crashBlock).toMatch(/--add-label "agent-crashed"/);
  });

  it('posts the crash signature as an issue comment', () => {
    expect(crashBlock).toMatch(/gh issue comment "\$ISSUE"/);
    // The excerpt must come from the shared-scan helper, never raw from the log.
    expect(crashBlock).toContain('crash_log_excerpt "$LOG"');
    expect(crashBlock).not.toContain('tail -n 15 "$LOG"');
  });

  it('does not misdescribe where the log lives', () => {
    expect(crashBlock).not.toContain('/tmp-scoped');
  });

  it('keeps the human gate (#1307) on the crash path', () => {
    expect(crashBlock).toContain('--add-label "agent-escalated,needs-human-review"');
  });

  it('does not stamp agent-crashed on a reasoned escalation', () => {
    const esc = src.slice(src.indexOf('Agent ESCALATED issue') - 600, src.indexOf('Agent ESCALATED issue'));
    expect(esc).not.toContain('agent-crashed');
  });

  it('agent-crashed countermands readiness and is cleared on approval/triage', () => {
    for (const f of ['dispatch-ready-check.sh', 'approve-issue.sh', 'triage-inbox.sh']) {
      expect(readFileSync(resolve(root, 'scripts', f), 'utf8'), f).toContain('agent-crashed');
    }
  });
});

// Assembled at runtime so this file's own added lines never contain the shape the
// egress guard matches on (the guard scans this diff when the dispatcher publishes it).
const FAKE_SECRET = ['sk-ant-', 'api03-AbCdEf0123456789abcdefABCDEF01'].join('');

function extractFn(name: string): string {
  const m = src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`${name}() not found in dispatch-issue.sh`);
  return m[0];
}

function runExcerpt(logText: string | null, scanner?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'crash-excerpt-'));
  try {
    const log = join(dir, '.agent.log');
    if (logText !== null) writeFileSync(log, logText);
    const script = `AGENT_EGRESS_SCAN="${scanner ?? resolve(root, 'scripts/egress-scan.sh')}"\n${extractFn('crash_log_excerpt')}\ncrash_log_excerpt "$1"`;
    return spawnSync('bash', ['-c', script, 'bash', log], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('#1202 crash excerpt goes through the shared egress scan, fails closed', () => {
  it('passes a clean log tail through', () => {
    const r = runExcerpt('line one\nAPI error 529 overloaded\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('API error 529 overloaded');
  });

  it('withholds the whole excerpt when a secret-shaped string is present, echoing nothing', () => {
    const r = runExcerpt(`boom\nleak: ${FAKE_SECRET}\n`);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('sk-ant');
    expect(r.stdout).not.toContain('api03');
    expect(r.stderr).not.toContain('api03');
  });

  it('fails closed when the scanner cannot run', () => {
    const r = runExcerpt('harmless\n', '/nonexistent/egress-scan.sh');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('fails closed on a missing log', () => {
    const r = runExcerpt(null);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('the posted body names the worktree log and posts no raw lines on a withheld excerpt', () => {
    expect(crashBlock).toContain('worktree');
    expect(crashBlock).toMatch(/withheld/i);
  });
});
