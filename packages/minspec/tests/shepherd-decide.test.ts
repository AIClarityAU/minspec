/**
 * SPEC-044 Slice 2 — T0: the pure creator-shepherd decision seam (`--decide`).
 *
 * Covers FR-4 (the shepherd loop is BOUNDED — by wall clock and by attempt cap),
 * INV-5 (no credentialed step is ever elected without holding the claim — D3), and
 * the D4 reuse contract (the action token comes from remediate-pr.sh's classify_pr;
 * this seam only decides what to DO with it, and fails closed on anything unknown).
 *
 * The seam is pure: no gh, no git, no claude — so every ordering rule below is
 * asserted deterministically rather than observed in a live loop.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/shepherd-pr.sh');
const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');

interface DecideArgs {
  action: string;
  merged?: 'yes' | 'no';
  holds?: 'yes' | 'no';
  attempts?: number;
  maxAttempts?: number;
  elapsed?: number;
  maxSecs?: number;
}

/** Run `--decide`; returns the single action token. */
function decide({
  action,
  merged = 'no',
  holds = 'yes',
  attempts = 0,
  maxAttempts = 2,
  elapsed = 0,
  maxSecs = 3600,
}: DecideArgs): string {
  return execFileSync(
    'bash',
    [
      SCRIPT,
      '--decide',
      action,
      merged,
      holds,
      String(attempts),
      String(maxAttempts),
      String(elapsed),
      String(maxSecs),
    ],
    { encoding: 'utf-8' },
  ).trim();
}

/** Every action token classify_pr can emit, plus an unknown one. */
const ALL_ACTIONS = [
  'skip-not-automation',
  'skip-conflict',
  'agent-remediate-checks',
  'agent-remediate-review',
  'rebase-only',
  'skip-clean',
  'some-token-from-the-future',
];

describe('shepherd --decide: INV-5/D3 a reclaimed owner never elects a credentialed op', () => {
  it('stands down for EVERY action token when the claim is no longer held', () => {
    for (const action of ALL_ACTIONS) {
      expect(decide({ action, holds: 'no' }), `action=${action}`).toBe('stand-down');
    }
  });

  it('stand-down outranks the wall-clock ceiling and the attempt cap', () => {
    // Losing the claim is not a "we ran out of budget" outcome — it must be reported
    // as stand-down so the caller never mistakes it for an exhausted shepherd.
    expect(decide({ action: 'agent-remediate-checks', holds: 'no', elapsed: 99_999, maxSecs: 10 })).toBe(
      'stand-down',
    );
    expect(decide({ action: 'agent-remediate-checks', holds: 'no', attempts: 99, maxAttempts: 2 })).toBe(
      'stand-down',
    );
  });

  it('never emits a do-* (credentialed) token without the claim', () => {
    for (const action of ALL_ACTIONS) {
      expect(decide({ action, holds: 'no' })).not.toMatch(/^do-/);
    }
  });
});

describe('shepherd --decide: merged is terminal and reported honestly', () => {
  it('reports stop-merged even if the claim has since moved', () => {
    // A merged PR is a read-only observation; reporting stand-down here would be a
    // false signpost (the work DID land).
    expect(decide({ action: 'skip-clean', merged: 'yes', holds: 'no' })).toBe('stop-merged');
  });

  it('merged outranks every action token, cap and ceiling', () => {
    for (const action of ALL_ACTIONS) {
      expect(decide({ action, merged: 'yes', elapsed: 99_999, maxSecs: 10, attempts: 99 })).toBe('stop-merged');
    }
  });
});

describe('shepherd --decide: FR-4 the loop is bounded', () => {
  it('stops at the wall-clock ceiling rather than electing more work', () => {
    expect(decide({ action: 'agent-remediate-checks', elapsed: 3600, maxSecs: 3600 })).toBe('stop-timeout');
    expect(decide({ action: 'rebase-only', elapsed: 3601, maxSecs: 3600 })).toBe('stop-timeout');
    // skip-clean would otherwise poll forever — the ceiling is what ends it.
    expect(decide({ action: 'skip-clean', elapsed: 3600, maxSecs: 3600 })).toBe('stop-timeout');
  });

  it('keeps working strictly BELOW the ceiling', () => {
    expect(decide({ action: 'agent-remediate-checks', elapsed: 3599, maxSecs: 3600 })).toBe('do-fix');
  });

  it('caps repeated fix attempts instead of looping', () => {
    expect(decide({ action: 'agent-remediate-checks', attempts: 0, maxAttempts: 2 })).toBe('do-fix');
    expect(decide({ action: 'agent-remediate-checks', attempts: 1, maxAttempts: 2 })).toBe('do-fix');
    expect(decide({ action: 'agent-remediate-checks', attempts: 2, maxAttempts: 2 })).toBe('stop-capped');
    expect(decide({ action: 'agent-remediate-review', attempts: 5, maxAttempts: 2 })).toBe('stop-capped');
  });

  it('the cap applies only to agent work — a rebase is mechanical and uncapped', () => {
    expect(decide({ action: 'rebase-only', attempts: 99, maxAttempts: 2 })).toBe('do-rebase');
  });
});

describe('shepherd --decide: action routing (D4 — classify_pr is the one source of truth)', () => {
  it('routes each classify_pr token to its shepherd action', () => {
    expect(decide({ action: 'agent-remediate-checks' })).toBe('do-fix');
    expect(decide({ action: 'agent-remediate-review' })).toBe('do-fix');
    expect(decide({ action: 'rebase-only' })).toBe('do-rebase');
  });

  it('surfaces conflicts, never auto-resolves them', () => {
    expect(decide({ action: 'skip-conflict' })).toBe('stop-conflict');
    // ...and does so regardless of remaining budget — more time never buys a merge.
    expect(decide({ action: 'skip-conflict', attempts: 0, elapsed: 0 })).toBe('stop-conflict');
  });

  it('refuses to drive a non-automation (human) PR', () => {
    expect(decide({ action: 'skip-not-automation' })).toBe('stop-not-automation');
  });

  it('waits — never claims success — while green but unmerged', () => {
    // "Nothing fixable" is not "merged". Declaring done here would be the classic
    // false signpost this project treats as the worst defect.
    expect(decide({ action: 'skip-clean' })).toBe('wait');
  });

  it('fails closed on an unknown token instead of guessing', () => {
    expect(decide({ action: 'some-token-from-the-future' })).toBe('stop-not-automation');
    expect(decide({ action: '' })).toBe('stop-not-automation');
  });
});

describe('shepherd wiring: the loop is bounded by CODE, not by a token', () => {
  const code = fs.readFileSync(DISPATCH, 'utf-8');

  /** The body of shepherd_own_pr, from its definition to the next top-level `}`. */
  function shepherdBody(): string {
    const start = code.indexOf('shepherd_own_pr() {');
    expect(start, 'shepherd_own_pr must exist in dispatch-issue.sh').toBeGreaterThan(-1);
    const end = code.indexOf('\n}', start);
    return code.slice(start, end);
  }

  it('polls under a wall-clock condition rather than `while true`', () => {
    const body = shepherdBody();
    // A `while true` here would make the ceiling depend entirely on --decide returning
    // the right token — the failure mode this project gates against rather than trusts.
    expect(body).not.toMatch(/while true; do/);
    expect(body).toMatch(/while \(\( \$\(date -u \+%s\) <= loop_deadline \)\); do/);
  });

  it('hands off visibly when the ceiling is reached, never stops silently', () => {
    // A quiet return would read as "shepherded successfully" — a false signpost.
    expect(shepherdBody()).toMatch(/shepherd_hand_off .*ceiling/);
  });

  it('re-verifies the claim before electing any credentialed step (D3/INV-5)', () => {
    expect(shepherdBody()).toMatch(/lease_verify_holds "\$ISSUE"/);
  });

  it('never mutates ai-review:* labels — CI owns them (#600)', () => {
    const body = shepherdBody();
    expect(body).not.toMatch(/--add-label "ai-review:/);
    expect(body).not.toMatch(/--remove-label "ai-review:/);
  });

  it('shares ONE attempt budget with the drain rather than opening a second', () => {
    // Same marker the drain counts, so creator + drain attempts add up to one cap.
    expect(code).toMatch(/SHEPHERD_ATTEMPT_MARKER="<!-- minspec-auto-remediation -->"/);
  });

  it('bounds the BUILD phase by the absolute claim lifetime (FR-12)', () => {
    expect(code).toMatch(/BUILD_DEADLINE=\$\(\( \$\(date -u \+%s\) \+ LEASE_ABS_MAX_SECS \)\)/);
    expect(code).toMatch(/BUILD_TIMEOUT_ARGS=\(timeout "\$\{BUILD_REMAINING\}s"\)/);
  });

  it('tears the renew ticker down in the same EXIT trap that releases the claim (D10)', () => {
    expect(code).toMatch(/trap 'lease_stop_renew_ticker; lease_release_all[^']*' EXIT/);
  });
});
