/**
 * T0 — #1113: the label flip is the approval gesture again, and its provenance
 * comes from GitHub's own record rather than from the webhook payload.
 *
 * #983 stopped a hand-applied `agent-ready` from dispatching, because the label was a
 * point-in-time STAMP of a verdict nobody re-checked. What was wrong was never "a human
 * flipped a label" — it was "nothing recorded WHO flipped it, or WHAT verdict they were
 * overriding". #1113 keeps the gesture and supplies the record.
 *
 * The control these tests exist to pin is `--verify-label-event`: before minting an
 * approval naming an actor, the workflow re-asks GitHub's timeline whether that actor
 * really applied that label. It must fail CLOSED on every shape that is not a positive,
 * exact match — a different label, a different actor, an `unlabeled` event, a truncated
 * or unparseable response. "Could not tell" must never read as "verified", because the
 * thing being authorised is an agent starting work on a held issue.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/approve-on-label.sh');
const ACTOR = 'harvest316';
const LABEL = 'agent-ready';

function verify(timeline: unknown, label = LABEL, actor = ACTOR): { ok: boolean; out: string } {
  const input = typeof timeline === 'string' ? timeline : JSON.stringify(timeline);
  try {
    return {
      ok: true,
      out: execFileSync('bash', [SCRIPT, '--verify-label-event', label, actor], {
        input,
        encoding: 'utf-8',
      }).trim(),
    };
  } catch (e: any) {
    return { ok: false, out: ((e.stdout ?? '') + (e.stderr ?? '')).toString().trim() };
  }
}

const labeled = (name: string, login: string) => ({ event: 'labeled', label: { name }, actor: { login } });

describe('approve-on-label.sh — the approval binds to a recorded human action (#1113)', () => {
  it('a matching labeled event by the actor → verified (the only go path)', () => {
    expect(verify([labeled(LABEL, ACTOR)])).toEqual({ ok: true, out: 'verified' });
  });

  it('finds the match among unrelated timeline noise', () => {
    const timeline = [
      { event: 'commented', actor: { login: 'someone' } },
      labeled('needs-review', 'minspec-sdd[bot]'),
      { event: 'cross-referenced', actor: { login: ACTOR } },
      labeled(LABEL, ACTOR),
      { event: 'renamed', actor: { login: ACTOR } },
    ];
    expect(verify(timeline).ok).toBe(true);
  });

  // ── Every near-miss must fail closed ───────────────────────────────────────
  it('an empty timeline → unverified', () => {
    const r = verify([]);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('no ');
  });

  it('a labeled event for a DIFFERENT label → unverified', () => {
    expect(verify([labeled('needs-review', ACTOR)]).ok).toBe(false);
  });

  it('a labeled event by a DIFFERENT actor → unverified (this is the forgery case)', () => {
    expect(verify([labeled(LABEL, 'someone-else')]).ok).toBe(false);
    expect(verify([labeled(LABEL, 'minspec-sdd[bot]')]).ok).toBe(false);
  });

  it('an UNLABELED event with the right label and actor → unverified', () => {
    const removed = { event: 'unlabeled', label: { name: LABEL }, actor: { login: ACTOR } };
    expect(verify([removed]).ok).toBe(false);
  });

  it('matching is exact, not substring — a superstring label does not verify', () => {
    expect(verify([labeled('agent-ready-later', ACTOR)]).ok).toBe(false);
    expect(verify([labeled(LABEL, 'harvest3160')]).ok).toBe(false);
  });

  it('events missing .label or .actor do not throw and do not verify', () => {
    expect(verify([{ event: 'labeled' }]).ok).toBe(false);
    expect(verify([{ event: 'labeled', label: { name: LABEL } }]).ok).toBe(false);
    expect(verify([{ event: 'labeled', actor: { login: ACTOR } }]).ok).toBe(false);
  });

  it('an unparseable or truncated timeline → unverified, NOT verified-by-default', () => {
    for (const bad of ['', 'not json', '{"event":', '[{"event":"labeled"']) {
      const r = verify(bad);
      expect(r.ok, `input=${JSON.stringify(bad)}`).toBe(false);
      expect(r.out, `input=${JSON.stringify(bad)}`).toContain('unverified');
    }
  });

  it('a JSON object (not an array) → unverified rather than a crash', () => {
    expect(verify({ event: 'labeled' }).ok).toBe(false);
  });

  it('an empty label or actor argument → unverified', () => {
    expect(verify([labeled(LABEL, ACTOR)], '', ACTOR).ok).toBe(false);
    expect(verify([labeled(LABEL, ACTOR)], LABEL, '').ok).toBe(false);
  });

  // ── The identity has no parameter to come through ─────────────────────────
  it('refuses to run outside GitHub Actions — there is no --approver flag at all', () => {
    let out = '';
    let threw = false;
    try {
      execFileSync('bash', [SCRIPT], {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: '' },
      });
    } catch (e: any) {
      threw = true;
      out = ((e.stdout ?? '') + (e.stderr ?? '')).toString();
    }
    expect(threw).toBe(true);
    expect(out).toMatch(/only inside GitHub Actions/);
    // The refusal must point at the path that DOES work, not just say no.
    expect(out).toMatch(/approve-issue\.sh/);
  });

  it('inside Actions but with no event file → refuses (identity has no trusted source)', () => {
    let out = '';
    let threw = false;
    try {
      execFileSync('bash', [SCRIPT], {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '/nonexistent/event.json' },
      });
    } catch (e: any) {
      threw = true;
      out = ((e.stdout ?? '') + (e.stderr ?? '')).toString();
    }
    expect(threw).toBe(true);
    expect(out).toMatch(/GITHUB_EVENT_PATH/);
  });

  it('exposes no flag through which a caller could name the approver', () => {
    // Strip whole-line comments FIRST. The header prose says "there is deliberately
    // NO --approver flag", and an assertion that a comment can satisfy — or, as here,
    // spuriously fail — is measuring the documentation, not the program.
    const code = execFileSync('cat', [SCRIPT], { encoding: 'utf-8' })
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

    for (const flag of ['--approver', '--force', '--yes']) {
      expect(code, `${flag} must not be accepted`).not.toContain(flag);
    }
    // …and the identity is read from the runner's event file, and nowhere else.
    expect(code).toMatch(/sender\.login/);
    expect(code).toMatch(/GITHUB_EVENT_PATH/);
  });

  it('the comment-stripping above is not vacuous — it still sees real code', () => {
    // Guards the previous test: if the filter ever removed everything, that test would
    // pass for the wrong reason. Assert the stripped text retains the actual logic.
    const code = execFileSync('cat', [SCRIPT], { encoding: 'utf-8' })
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).toContain('--verify-label-event');
    expect(code).toContain('--may-approve');
    expect(code).toContain('--render-approval');
    expect(code.length).toBeGreaterThan(1500);
  });
});
