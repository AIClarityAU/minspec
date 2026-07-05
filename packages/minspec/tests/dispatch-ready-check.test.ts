/**
 * T1 — dispatch-ready-check.sh: re-validate agent-ready at dispatch time (#406).
 *
 * `agent-ready` is stamped ONCE at triage and never re-checked, so between the
 * drain enumerating the ready set and the dispatcher launching, an issue may have
 * been closed, re-triaged, or quarantined. This pure gate re-validates the CURRENT
 * (state, labels) and must:
 *   • PROCEED (exit 0) ONLY when the issue is OPEN and still carries agent-ready
 *     with no countermanding human-gate label, and
 *   • ABORT (exit 1) on every clear staleness signal (closed / agent-ready gone /
 *     a human-gate label present),
 * while NEVER falsely aborting valid work.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';

const GATE = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');

/** Run the gate; return { ok, out } where ok = (exit 0), out = trimmed stdout. */
function check(state: string, labelsCsv: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('bash', [GATE, state, labelsCsv], { encoding: 'utf-8' });
    return { ok: true, out: out.trim() };
  } catch (e: any) {
    // Non-zero exit (not-ready) throws; capture its stdout reason.
    return { ok: false, out: (e.stdout ?? '').toString().trim() };
  }
}

describe('dispatch-ready-check.sh — re-validate agent-ready at dispatch (#406)', () => {
  it('OPEN + agent-ready → proceed (the only go path)', () => {
    const r = check('OPEN', 'agent-ready,role:dev');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('CLOSED (even with agent-ready) → abort', () => {
    const r = check('CLOSED', 'agent-ready,role:dev');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/not OPEN/);
  });

  it('agent-ready label absent → abort', () => {
    const r = check('OPEN', 'role:dev');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/agent-ready/);
  });

  it('needs-review present (re-triaged) → abort even if agent-ready lingers', () => {
    const r = check('OPEN', 'agent-ready,role:dev,needs-review');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/needs-review/);
  });

  it('needs-info / needs-human-review / agent-quarantined each countermand', () => {
    for (const gate of ['needs-info', 'needs-human-review', 'agent-quarantined']) {
      const r = check('OPEN', `agent-ready,${gate}`);
      expect(r.ok, `gate=${gate}`).toBe(false);
      expect(r.out).toContain(gate);
    }
  });

  it('state is case-insensitive (gh may emit either case)', () => {
    expect(check('open', 'agent-ready').ok).toBe(true);
    expect(check('Open', 'agent-ready').ok).toBe(true);
  });

  it('membership is exact — a superstring label does NOT satisfy agent-ready', () => {
    const r = check('OPEN', 'agent-ready-later,role:dev');
    expect(r.ok).toBe(false);
  });

  it('empty label set → abort (no agent-ready)', () => {
    const r = check('OPEN', '');
    expect(r.ok).toBe(false);
  });

  it('does not false-abort on unrelated labels alongside agent-ready', () => {
    // A valid ready issue can also carry role:/priority:/goal: labels — none of
    // these are human-gates, so the gate must still proceed.
    const r = check('OPEN', 'agent-ready,role:security,priority:P1,goal:ship');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });
});
