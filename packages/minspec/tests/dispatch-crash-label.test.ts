/**
 * #1202 — a harness crash must be separable from a reasoned escalation.
 *
 * `agent-escalated` alone cannot distinguish "the agent asked for a human" from "the
 * run was killed and never made an attempt". The crash path now also stamps
 * `agent-crashed` and posts the crash signature as a comment, so the reason outlives
 * the /tmp-scoped drain log. The genuine-escalation path must NOT carry the label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    expect(crashBlock).toContain('tail -n 15 "$LOG"');
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
