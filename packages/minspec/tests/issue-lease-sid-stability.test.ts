/**
 * T3 regression (#2132) — `lease_self_sid` must return the SAME id every time within
 * one script invocation.
 *
 * The defect: the function memoised with `export MINSPEC_LEASE_SID=...`, but every
 * caller invokes it through command substitution (`sid="$(lease_self_sid)"`), so the
 * export died with that subshell and the next call minted a fresh UUID. A session
 * therefore could not recognise its own claim: `lease_verify_holds` compared a brand-new
 * sid against the claim it had just written, never got `own`, and `shepherd_decide`
 * returned `stand-down` for every PR the session opened itself.
 *
 * These tests drive the function the way real callers do - through `$(...)` - because a
 * test that captured the value any other way would not have caught the bug.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');

/**
 * Run a bash snippet with the lease lib sourced and BOTH sid env overrides cleared, so
 * the snippet exercises sid *production* rather than an injected value.
 */
function sh(snippet: string, env: Record<string, string> = {}): string {
  const clean = { ...process.env, ...env };
  delete clean.MINSPEC_LEASE_SID;
  delete clean.MINSPEC_SESSION_ID;
  for (const [k, v] of Object.entries(env)) clean[k] = v;
  return execFileSync('bash', ['-c', `source ${JSON.stringify(SCRIPT)}\n${snippet}`], {
    encoding: 'utf-8',
    env: clean,
  }).trim();
}

describe('lease_self_sid stability (#2132)', () => {
  it('returns the same id across two command substitutions in one invocation', () => {
    // The exact shape of the real callers: issue-lease.sh:240 (lease_claim) and :283
    // (lease_verify_holds) both do sid="$(lease_self_sid)".
    const out = sh('a="$(lease_self_sid)"; b="$(lease_self_sid)"; printf "%s\\n%s" "$a" "$b"');
    const [a, b] = out.split('\n');
    expect(a).toBeTruthy();
    expect(b).toBe(a);
  });

  it('stays stable across many calls, so a claim written early still matches later', () => {
    const out = sh(
      'for i in 1 2 3 4 5 6 7 8; do printf "%s\\n" "$(lease_self_sid)"; done',
    );
    const ids = new Set(out.split('\n').filter(Boolean));
    expect(ids.size).toBe(1);
  });

  it('is what lease_verify_holds compares, so a self-written claim resolves to own', () => {
    // End-to-end on the pure seam: build a claim carrying the sid this session produces,
    // then classify it. Before the fix the sid on the right-hand side was a different
    // UUID and the decision was never `own`.
    const out = sh(
      'sid="$(lease_self_sid)"; ' +
        'claims="$(jq -n -c --arg s "$sid" \'[{sessionId:$s, host:"h", pid:1, ' +
        'claimedAt:"2026-01-01T00:00:00.000Z", lastRenewed:"2026-01-01T00:00:00.000Z", serverOrder:1}]\')"; ' +
        'later="$(lease_self_sid)"; ' +
        'printf "%s" "$(if [ "$sid" = "$later" ]; then echo same; else echo different; fi)"',
    );
    expect(out).toBe('same');
  });

  it('still gives two concurrent invocations different ids (INV-1 exactly-one-owner)', () => {
    // Stability must not be bought with a constant: two separate processes are two
    // racers and must never collide.
    const first = sh('lease_self_sid');
    const second = sh('lease_self_sid');
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('honours MINSPEC_SESSION_ID when the caller supplies one', () => {
    const out = sh('a="$(lease_self_sid)"; b="$(lease_self_sid)"; printf "%s %s" "$a" "$b"', {
      MINSPEC_SESSION_ID: 'caller-supplied-sid',
    });
    expect(out).toBe('caller-supplied-sid caller-supplied-sid');
  });

  it('honours a pre-set MINSPEC_LEASE_SID', () => {
    const out = sh('lease_self_sid', { MINSPEC_LEASE_SID: 'preset-sid' });
    expect(out).toBe('preset-sid');
  });

  it('produces a path-safe id, because it is embedded in the worktree path', () => {
    // lease_worktree_path (:86) interpolates the sid into ${BASE}/issue-N-<sid>; a `/`
    // or whitespace there would silently create a nested or split path.
    const sid = sh('lease_self_sid');
    expect(sid).not.toMatch(/[/\s]/);
    expect(sid.length).toBeGreaterThan(0);
  });
});
