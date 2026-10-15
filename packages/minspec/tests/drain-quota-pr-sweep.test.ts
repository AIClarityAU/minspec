/**
 * T2 regression (#2587) - the quota cap holds inside the pull request sweep too.
 *
 * #2573 fixed the cap for DISPATCH: the gate is asked before every launch, on both the
 * serial and the parallel path (see drain-quota-per-dispatch.test.ts). The third stage of
 * a cycle, the pull request sweep (`sweep_open_prs` in scripts/drain-inbox.sh), was left
 * out of that fix. It hands every open, non-draft pull request to scripts/remediate-pr.sh
 * in a loop, and nothing in that loop asked `quota_gate`. remediate-pr.sh launches an
 * agent for any pull request it classifies as fixable (scripts/remediate-pr.sh:814), so a
 * cycle admitted under the cap, and whose dispatches all finished under it, could still
 * cross the cap during the sweep and keep launching remediation agents until the open-PR
 * list ended — the same shape #2573 fixed for dispatch, just one stage later.
 *
 * ROOT CAUSE. sweep_open_prs's per-PR loop called scripts/remediate-pr.sh without ever
 * asking quota_gate; only a usage-limit line in a remediation's own OUTPUT could stop it.
 *
 * WHAT SHOULD HAVE CAUGHT IT. The existing quota regression tests (#2573) drive the
 * dispatch loop with a meter that moves; none of them put an open PR in front of the
 * sweep, so the sweep's own loop was never exercised against a moving reading.
 *
 * So these drive the REAL loop (helpers/drain-harness.ts) with a stub remediator that
 * moves the meter when it finishes a PR, exactly as the dispatch regression tests do for
 * the stub dispatcher.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runLoop, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();
useHostileAmbientDrainKnobs();

afterEach(cleanupDrains);

const CAP_60 = { MINSPEC_QUOTA_ADMIT_PCT_7D: '60', MINSPEC_DRAIN_QUEUE_LIMIT: '100' };
const AT_58: Reading = { pct: 5, resetIn: 8400, weekPct: 58, weekResetIn: 378000 };
const AT_66: Reading = { pct: 6, resetIn: 8400, weekPct: 66, weekResetIn: 378000 };

const settled = (log: string) => log.includes('cycle done') || /sleeping \d+s/.test(log);

describe('T2 regression (#2587): the PR sweep stops remediating when the reading crosses the cap', () => {
  it('a reading that crosses while the first PR is remediated holds the rest of the sweep', async () => {
    // One ready issue so the cycle does not early-return before reaching the sweep
    // (#1708 is the separate issue about that ordering; this fixture just needs to get
    // past it). Its own dispatch finishes under the cap; the first PR's remediation is
    // what crosses it.
    const d = await runLoop(
      {
        ready: [901],
        openPrs: [2001, 2002, 2003],
        reading: AT_58,
        readingAfterIssue: { 901: AT_58 },
        readingAfterPr: { 2001: AT_66 },
        env: CAP_60,
      },
      settled,
    );
    const log = d.log();

    // What ran: the one dispatch, then exactly the first PR — nothing after the crossing.
    expect(d.dispatched()).toEqual([901]);
    expect(d.remediated()).toEqual([2001]);
    expect(log).not.toContain('remediated PR #2002');
    expect(log).not.toContain('remediated PR #2003');

    // Why it stopped: the gate, named, with the reading that decided — not a usage-limit
    // signal (there was none; the stub never said anything claude-shaped).
    expect(log).toMatch(/defer:\d+ \(7d window 66% used/);
    expect(log).toContain('holding the rest of the PR sweep');

    // What the loop did about it: paused for the window, not a crashed/errored cycle.
    expect(log).toMatch(/sleeping \d+s/);
    expect(log).not.toContain('cycle done');
    expect(log).not.toContain('cycle error');
    expect(log).not.toContain('usage-limit signal');
    expect(d.claudeCalled()).toBe(false);
  });

  it('CONTROL: a reading that stays under the cap sweeps every open PR and finishes the cycle', async () => {
    const d = await runLoop(
      {
        ready: [901],
        openPrs: [2001, 2002, 2003],
        reading: AT_58,
        readingAfterIssue: { 901: AT_58 },
        readingAfterPr: { 2001: AT_58, 2002: AT_58 },
        env: CAP_60,
      },
      settled,
    );
    const log = d.log();
    expect(d.dispatched()).toEqual([901]);
    expect(d.remediated()).toEqual([2001, 2002, 2003]);
    expect(log).toContain('cycle done');
    expect(log).not.toContain('holding the rest of the PR sweep');
  });
});
