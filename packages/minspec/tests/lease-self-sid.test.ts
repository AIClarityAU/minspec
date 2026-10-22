/**
 * SPEC-044 — `lease_self_sid` stability (#2132).
 *
 * Every production caller reads the sid through `$(lease_self_sid)` — a command
 * substitution, which bash runs in a forked SUBSHELL. The previous implementation
 * memoized via `export MINSPEC_LEASE_SID="$sid"` INSIDE the function: that export
 * lived only in the subshell and died with it, so the memo never reached the
 * parent and every call fell through to mint a fresh
 * `/proc/sys/kernel/random/uuid`. A session could then never recognise its own
 * claim (`lease_verify_holds` always false), which made `shepherd_decide` return
 * `stand-down` unconditionally.
 *
 * These tests exercise `lease_self_sid` the same way production does — via
 * `$(...)` — because a direct, same-shell call would pass even on the OLD, buggy
 * implementation (no subshell involved) and prove nothing.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');

/** Run a bash snippet that sources issue-lease.sh, with a clean lease-identity env. */
function run(snippet: string, env: Record<string, string> = {}): string {
  const cleanEnv = { ...process.env };
  delete cleanEnv.MINSPEC_SESSION_ID;
  delete cleanEnv.MINSPEC_LEASE_SID;
  return execFileSync('bash', ['-c', `source "${SCRIPT}"; ${snippet}`], {
    encoding: 'utf-8',
    env: { ...cleanEnv, ...env },
  }).trim();
}

describe('lease_self_sid (#2132)', () => {
  it('agrees with itself across two separate command-substitution subshells', () => {
    // This is the exact repro from the issue: each `$(lease_self_sid)` forks its
    // own subshell, which is how EVERY production caller invokes it.
    const out = run('a="$(lease_self_sid)"; b="$(lease_self_sid)"; echo "$a|$b"');
    const [a, b] = out.split('|');
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('agrees with itself across three levels of nested command substitution', () => {
    const out = run(
      'a="$(lease_self_sid)"; b="$(echo "$(lease_self_sid)")"; c="$(lease_worktree_path 99 | sed -E "s#.*/issue-99-##")"; echo "$a|$b|$c"'
    );
    const [a, b, c] = out.split('|');
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('prefers an explicit MINSPEC_LEASE_SID override', () => {
    const out = run('echo "$(lease_self_sid)"', { MINSPEC_LEASE_SID: 'sid-forced' });
    expect(out).toBe('sid-forced');
  });

  it('prefers MINSPEC_SESSION_ID (presence identity) when no override is set', () => {
    const out = run('echo "$(lease_self_sid)"', { MINSPEC_SESSION_ID: 'presence-123' });
    expect(out).toBe('presence-123');
  });

  it('falls back to a deterministic, non-random value when neither env var is set', () => {
    // Two independent processes get two independent (distinct) sids — the fix must
    // not collapse to one constant — but each process's own repeated calls agree
    // (covered above). Guard against a regression to the OLD random-uuid fallback,
    // which would make even same-process repeats disagree (already asserted above)
    // and would never look like the fixed shape (`sid-<pid>-<starttime>`).
    const out = run('echo "$(lease_self_sid)"');
    expect(out).toMatch(/^sid-\d+-\d+$/);
  });
});
