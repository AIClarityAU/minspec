/**
 * T3 regression (#2573) - the quota cap holds per DISPATCH, on both paths.
 *
 * THE INCIDENT, 2026-10-04. The founder had capped the weekly window at 60%
 * (MINSPEC_QUOTA_ADMIT_PCT_7D=60). A loop started at 06:19:55 read 58%, was admitted, and
 * announced "330 issue(s) ready - dispatching the top 100 this cycle". It then worked down
 * that list for two hours. The weekly reading passed 60 and stood at 66% by 08:03. The
 * gate was never asked again, and the loop was stopped by hand at 08:20:08, 28 entries
 * short of the end of the cycle. Relaunched, it deferred at once on the same meter.
 *
 * ROOT CAUSE. run_cycle asked quota_gate once, at the top of a cycle. The parallel path
 * asked again before every launch; the one-at-a-time path, which is the default, did not.
 * A cycle is up to MINSPEC_DRAIN_QUEUE_LIMIT issues long, so on the default path a cap was
 * a check on the first issue of a cycle only.
 *
 * WHAT SHOULD HAVE CAUGHT IT. Every quota test called `--quota-gate` once and read the
 * answer. None drove a cycle of several issues with a meter that moves, which is the only
 * place "was the gate asked" can be seen.
 *
 * So these drive the REAL loop (helpers/drain-harness.ts) with a stub dispatcher that
 * moves the meter when it finishes an issue, as an agent does. The crossing is varied in
 * WHERE it happens and in WHAT crosses, not only in the code under test: a fix that
 * re-checked only before the second dispatch, or only the weekly window, would pass a
 * single fixture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runLoop, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
// Nothing here may depend on drain or quota knobs in the surrounding environment (#2574).
useHostileAmbientDrainKnobs();

afterEach(cleanupDrains);

/** The incident's cap, and its two readings: under it when the cycle starts, over it later. */
const CAP_60 = { MINSPEC_QUOTA_ADMIT_PCT_7D: '60', MINSPEC_DRAIN_QUEUE_LIMIT: '100' };
const AT_58: Reading = { pct: 5, resetIn: 8400, weekPct: 58, weekResetIn: 378000 };
const AT_66: Reading = { pct: 6, resetIn: 8400, weekPct: 66, weekResetIn: 378000 };

const issues = (n: number) => Array.from({ length: n }, (_, i) => 901 + i);

/** The loop has either finished the cycle or gone to sleep on a pause. */
const settled = (log: string) => log.includes('cycle done') || /sleeping \d+s/.test(log);

describe('T3 regression (#2573): a serial cycle stops launching when the reading crosses the cap', () => {
  it.each([
    { queue: 2, crossAfter: 1 },
    { queue: 3, crossAfter: 1 },
    { queue: 3, crossAfter: 2 },
    { queue: 5, crossAfter: 1 },
    { queue: 5, crossAfter: 3 },
    { queue: 5, crossAfter: 4 },
  ])(
    '$queue queued, the weekly reading crosses the cap while dispatch $crossAfter runs: exactly $crossAfter launched',
    async ({ queue, crossAfter }) => {
      const ready = issues(queue);
      const d = await runLoop(
        { ready, reading: AT_58, readingAfterIssue: { [ready[crossAfter - 1]]: AT_66 }, env: CAP_60 },
        settled,
      );
      const log = d.log();

      // What ran: the issues up to the crossing, in order, and nothing after it.
      expect(d.dispatched()).toEqual(ready.slice(0, crossAfter));
      expect(log).not.toContain(`dispatching #${ready[crossAfter]}...`);

      // Why it stopped: the gate, named, with the reading that decided.
      expect(log).toMatch(/defer:\d+ \(7d window 66% used/);
      expect(log).toContain('holding the rest of the queue');

      // What the loop did about it: the cycle returned 42 (it went to the quota sleep,
      // not on to "cycle done", and not into the error count) with the cause recorded
      // as the GATE. A text signal takes the other branch, which says so in the log.
      expect(log).toMatch(/sleeping \d+s/);
      expect(log).not.toContain('cycle done');
      expect(log).not.toContain('cycle error');
      expect(log).not.toContain('usage-limit signal');
      expect(d.claudeCalled()).toBe(false);
    },
  );

  it('CONTROL: a reading that stays under the cap dispatches the whole queue and finishes the cycle', async () => {
    const ready = issues(4);
    const d = await runLoop({ ready, reading: AT_58, readingAfterIssue: { 901: AT_58, 903: AT_58 }, env: CAP_60 }, settled);
    expect(d.dispatched()).toEqual(ready);
    expect(d.log()).toContain('cycle done');
    expect(d.log()).not.toContain('holding the rest of the queue');
  });

  it('the first dispatch is checked too: a reading that crosses after the cycle was admitted launches nothing', async () => {
    // The cycle's own check is minutes old by the time the queue has been triaged, read
    // and ranked. The ranker stub moves the meter, standing in for that time passing.
    const d = await runLoop({ ready: issues(3), reading: AT_58, readingAfterRanking: AT_66, env: CAP_60 }, settled);
    expect(d.dispatched()).toEqual([]);
    expect(d.log()).toMatch(/defer:\d+ \(7d window 66% used/);
    expect(d.log()).toContain('holding the rest of the queue');
    expect(d.log()).not.toContain('cycle done');
  });

  it('the 5h window is held per dispatch as well, not only the weekly one', async () => {
    const ready = issues(3);
    const d = await runLoop(
      {
        ready,
        reading: { pct: 40, resetIn: 9000 },
        readingAfterIssue: { 901: { pct: 55, resetIn: 9000 } },
        env: { MINSPEC_QUOTA_ADMIT_PCT: '50' },
      },
      settled,
    );
    expect(d.dispatched()).toEqual([901]);
    expect(d.log()).toMatch(/defer:\d+ \(5h window 55% used/);
    expect(d.log()).toContain('holding the rest of the queue');
    expect(d.log()).not.toContain('cycle done');
  });

  it('a reading that goes STALE mid-cycle holds the queue: an unknown budget is not permission (invariant 2)', async () => {
    // Refreshing is off here, so nothing replaces the old reading. Before the fix a
    // serial cycle never looked again and so never noticed.
    const ready = issues(3);
    const d = await runLoop(
      { ready, reading: AT_58, readingAfterIssue: { 901: { ...AT_58, ageSec: 5000 } }, env: CAP_60 },
      settled,
    );
    expect(d.dispatched()).toEqual([901]);
    expect(d.log()).toMatch(/defer:stale \(reading is \d+s old/);
    expect(d.log()).toContain('holding the rest of the queue');
    expect(d.log()).not.toContain('cycle done');
  });
});

describe('#2573: no new path admits without a reading', () => {
  it('a machine that has NEVER had a reading spends one bootstrap admit per dispatch, then holds', async () => {
    // The bootstrap allowance is unchanged: three admits, counted, then a refusal. What
    // changed is who asks. The cycle's own check takes the first, each serial dispatch
    // now takes one as each parallel launch always has, and the fourth ask is refused.
    // Before the fix the cycle's one admit covered the whole queue.
    const ready = issues(4);
    const d = await runLoop({ ready, reading: null }, settled);
    const log = d.log();
    expect(d.dispatched()).toEqual([901, 902]);
    // Three admits were recorded and no more: the cycle's own, and one per dispatch.
    expect(fs.readFileSync(`${d.quota}.bootstrap`, 'utf-8').trim()).toBe('3');
    expect(log).toMatch(/defer:no-reading/);
    expect(log).toContain('holding the rest of the queue');
    expect(log).not.toContain('cycle done');
  });
});

describe('#2573: the parallel path keeps its per-launch check (one implementation, both paths)', () => {
  it('at width 2 the launches after the crossing are held, and work in flight is left to finish', async () => {
    // Either of the first two crossing the cap must stop the third and fourth from
    // launching. Both are given the same reading, so the order they finish in is free.
    const d = await runLoop(
      {
        ready: issues(4),
        reading: AT_58,
        readingAfterIssue: { 901: AT_66, 902: AT_66 },
        dispatchSecs: 1,
        env: { ...CAP_60, MINSPEC_DRAIN_CONCURRENCY: '2' },
      },
      settled,
    );
    const log = d.log();
    expect(log).toContain('(concurrency=2)');
    expect(d.dispatched().sort()).toEqual([901, 902]);
    expect(log).toMatch(/defer:\d+ \(7d window 66% used/);
    expect(log).toContain('holding the rest of the queue');
    // In-flight work drained: both dispatches printed their last line.
    expect(log).toContain('RAN 901');
    expect(log).toContain('RAN 902');
    expect(log).not.toContain('usage-limit signal');
    expect(log).not.toContain('cycle done');
  });

  it('a gate hold is not downgraded by a limit notice from a build still in flight', async () => {
    // #901 finishes first and moves the meter over the cap, so the gate holds the queue.
    // #902 is still running and ends on the CLI's own limit line. The pause was the
    // meter's decision, so the rest it takes is the gate's: a text signal arriving
    // afterwards must not hand that rest to the signal path, where a meter reading can
    // cut it short.
    const d = await runLoop(
      {
        ready: issues(4),
        reading: AT_58,
        readingAfterIssue: { 901: AT_66 },
        // Far enough apart that a loaded machine cannot let #902 finish first.
        issueSecs: { 901: 0.3, 902: 3 },
        issueSays: { 902: "You've hit your session limit · resets 11:20am (Australia/Sydney)" },
        env: { ...CAP_60, MINSPEC_DRAIN_CONCURRENCY: '2' },
      },
      settled,
    );
    const log = d.log();
    expect(d.dispatched().sort()).toEqual([901, 902]);
    expect(log).toContain('holding the rest of the queue');
    // The notice did arrive, in the drain's own capture of #902 ...
    expect(log).toContain("You've hit your session limit");
    // ... and the loop still rested as the gate's pause does, not as a signal's.
    expect(log).toMatch(/sleeping \d+s/);
    expect(log).not.toMatch(/usage-limit signal (CONTRADICTED|not contradicted|contradicted)/);
    expect(log).not.toContain('cycle done');
  });
});
