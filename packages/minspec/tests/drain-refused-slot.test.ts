/**
 * T3 regression + T0 invariants (#2641) - an issue the dispatcher refuses does not use a
 * slot of the queue limit, and a cycle that starts nothing says so.
 *
 * THE INCIDENT, 2026-10-08 to 2026-10-09. The drain was alive, its quota gate read open,
 * and it started no build for at least 8.5 hours. Its log: 22 cycles, 44 lines
 * `[drain] dispatching #N` (all of them issue 494 or issue 780), 44 `Skipping #N` lines
 * giving `not-ready [countermanded]: countermanding label 'agent-escalated' present`, and
 * 22 lines `[drain] cycle done.` It ran with MINSPEC_DRAIN_QUEUE_LIMIT=2. Of 71 open
 * `agent-ready` issues, 52 also carried a countermanding label, and the ranker placed all
 * 52 ahead of the 19 clean ones.
 *
 * ROOT CAUSE. run_cycle trimmed the ranked list to the queue limit and only then handed
 * each survivor to the dispatcher, which is where the one check that looks at
 * countermanding labels runs. The dispatcher reports a refusal as exit 0, the drain
 * counted exit 0 as a dispatch, and nothing refilled the slot. The ranking is
 * deterministic, so the same refused issues took every slot of every cycle.
 *
 * WHAT SHOULD HAVE CAUGHT IT. The all-failed roll-up (#2140) counts non-zero exits only,
 * and a refusal is exit 0: "2 offered, 2 refused, 60 never offered" ended `cycle done.`
 * And no test put a refused issue ahead of a clean one under a limit: the fixtures that
 * exercised the limit were all-clean.
 *
 * HOW THESE ARE BUILT. Each test drives the REAL drain through a whole cycle
 * (helpers/drain-harness.ts), and a refused issue goes through the REAL dispatcher and
 * the REAL readiness gate: the harness answers `gh issue view` with the fixture's labels
 * and nothing here imitates what a refusal looks like. Only clean issues reach the stub
 * dispatcher, so `dispatched()` is the list of builds a live cycle would have started.
 *
 * The fixtures vary on more than the code under test: how many issues are refused, where
 * they rank (ahead of, among, behind and beyond the clean ones, with rank order both
 * matching and reversing issue number), which label refuses them, the limit, and the
 * fan-out width.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runLoop, runOnce, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
// Nothing here may depend on drain or quota knobs in the surrounding environment (#2574).
// MINSPEC_DRAIN_QUEUE_LIMIT=1 is one of the hostile knobs, and the limit is the subject.
useHostileAmbientDrainKnobs();

afterEach(cleanupDrains);

/** A reading any cap admits, so the quota gate is never what decided a test here. */
const ROOM: Reading = { pct: 1, resetIn: 3600 };

const limit = (n: number) => ({ MINSPEC_DRAIN_QUEUE_LIMIT: String(n) });

/** Labels that make the real dispatcher refuse each of `issues` as countermanded. */
const countermanded = (issues: number[], by = 'agent-escalated'): Record<number, string[]> =>
  Object.fromEntries(issues.map((n) => [n, ['agent-ready', 'role:dev', by]]));

/**
 * The countermanding labels, read from the gate that owns them rather than copied here: a
 * label added to the gate tomorrow is covered the same day, and a copy would drift.
 */
const GATE = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');
const COUNTERMANDING: string[] = (() => {
  const m = fs.readFileSync(GATE, 'utf-8').match(/^for gate in ([a-z -]+); do$/m);
  if (!m) {
    throw new Error(
      'Could not read the countermanding-label list out of dispatch-ready-check.sh. Fix this ' +
        'extractor rather than deleting the tests: they are what proves each of those labels ' +
        'still keeps an issue from being built (#2641).',
    );
  }
  return m[1].trim().split(/\s+/);
})();

const refusalLines = (log: string) => log.split('\n').filter((l) => /^Skipping #\d+ /.test(l));

describe('#2641 T3: an issue the dispatcher refuses does not use a slot of the queue limit', () => {
  it.each([
    {
      name: 'two refused on top, a limit of 2 (the live case)',
      ready: [1, 2, 10, 20, 30],
      refused: [1, 2],
      cap: 2,
      builds: [10, 20],
      offered: [1, 2, 10, 20],
    },
    {
      name: 'one refused on top, a limit of 1',
      ready: [1, 10, 20],
      refused: [1],
      cap: 1,
      builds: [10],
      offered: [1, 10],
    },
    {
      name: 'more refused than the limit',
      ready: [1, 2, 3, 10, 20],
      refused: [1, 2, 3],
      cap: 2,
      builds: [10, 20],
      offered: [1, 2, 3, 10, 20],
    },
    {
      name: 'six refused ahead of a limit of 1',
      ready: [1, 2, 3, 4, 5, 6, 10, 20],
      refused: [1, 2, 3, 4, 5, 6],
      cap: 1,
      builds: [10],
      offered: [1, 2, 3, 4, 5, 6, 10],
    },
    {
      name: 'refused and clean interleaved',
      ready: [1, 2, 3, 4, 5, 6],
      refused: [2, 4],
      cap: 3,
      builds: [1, 3, 5],
      offered: [1, 2, 3, 4, 5],
    },
    {
      name: 'the refused one in the middle of the batch',
      ready: [1, 2, 3],
      refused: [2],
      cap: 2,
      builds: [1, 3],
      offered: [1, 2, 3],
    },
    {
      name: 'fewer clean issues than the limit',
      ready: [1, 2, 10],
      refused: [1, 2],
      cap: 5,
      builds: [10],
      offered: [1, 2, 10],
    },
  ])('$name: the clean issues below are built in the same cycle', async ({ ready, refused, cap, builds, offered }) => {
    const d = await runOnce({ ready, realDispatch: countermanded(refused), reading: ROOM, env: limit(cap) });

    // What ran. `dispatched()` is written by the stub dispatcher, which a refused issue
    // never reaches, so this is the list of builds and not of offers.
    expect(d.dispatched()).toEqual(builds);
    expect(d.offered()).toEqual(offered);

    // Each refusal is the real dispatcher's, for the real reason.
    const said = refusalLines(d.log());
    expect(said).toHaveLength(refused.length);
    for (const n of refused) {
      expect(d.log()).toMatch(new RegExp(`^Skipping #${n} .*\\[countermanded\\].*'agent-escalated'`, 'm'));
    }
    expect(d.claudeCalled()).toBe(false);
  });

  it('where an issue RANKS is what counts, not its number: refused issues ranked first by a ranker that reverses the numbers', async () => {
    // Rank order is 20, 10, 2, 1. The two refused ones lead it and are the HIGHEST numbers,
    // so a fix that looked at numeric position would dispatch 1 and 2 without ever offering
    // them, and one that still trimmed first would dispatch nothing.
    const d = await runOnce({
      ready: [1, 2, 10, 20],
      realDispatch: countermanded([10, 20]),
      rankDescending: true,
      reading: ROOM,
      env: limit(2),
    });
    expect(d.offered()).toEqual([20, 10, 2, 1]);
    expect(d.dispatched()).toEqual([2, 1]);
  });

  it('CONTROL: a refused issue ranked beyond the reach of the limit is never offered at all', async () => {
    // The slot rule lets the drain go PAST a refusal; it must not go looking for them.
    const d = await runOnce({ ready: [1, 2, 3, 4], realDispatch: countermanded([3, 4]), reading: ROOM, env: limit(2) });
    expect(d.dispatched()).toEqual([1, 2]);
    expect(d.offered()).toEqual([1, 2]);
    expect(refusalLines(d.log())).toEqual([]);
  });

  it('CONTROL: the limit still limits. Five clean issues under a limit of 2 start exactly two builds', async () => {
    // Guards the guard: "do not count a refusal" must not have become "do not count".
    const d = await runOnce({ ready: [1, 2, 3, 4, 5], reading: ROOM, env: limit(2) });
    expect(d.dispatched()).toEqual([1, 2]);
    expect(d.offered()).toEqual([1, 2]);
  });

  it('CONTROL: with refusals in the way the limit is still the most that is built', async () => {
    const d = await runOnce({
      ready: [1, 2, 10, 20, 30, 40],
      realDispatch: countermanded([1, 2]),
      reading: ROOM,
      env: limit(3),
    });
    expect(d.dispatched()).toEqual([10, 20, 30]);
    expect(d.offered()).toEqual([1, 2, 10, 20, 30]);
  });

  it('says once, by number, which issues were refused without using a slot', async () => {
    const d = await runOnce({
      ready: [1, 2, 3, 10],
      realDispatch: countermanded([1, 2, 3]),
      reading: ROOM,
      env: limit(1),
    });
    const lines = d.log().split('\n').filter((l) => l.includes('did not use a slot of the queue limit'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[drain\] 3 issue\(s\) were refused by the dispatcher before any work started/);
    expect(lines[0]).toMatch(/: #1 #2 #3$/);
  });
});

describe('#2641 T0: a countermanded issue is never dispatched, whatever refuses it and wherever it ranks', () => {
  it('reads a real list of countermanding labels out of the gate', () => {
    // A list that came back empty would make every case below vacuous.
    expect(COUNTERMANDING.length).toBeGreaterThanOrEqual(6);
    expect(COUNTERMANDING).toContain('agent-escalated');
    expect(COUNTERMANDING).toContain('needs-human-review');
  });

  it.each(COUNTERMANDING)('%s: refused when it ranks first under a limit of 1, and the clean issue behind it is built', async (label) => {
    const d = await runOnce({ ready: [1, 10], realDispatch: countermanded([1], label), reading: ROOM, env: limit(1) });
    expect(d.offered()).toEqual([1, 10]);
    expect(d.dispatched()).toEqual([10]);
    expect(d.log()).toMatch(new RegExp(`^Skipping #1 .*\\[countermanded\\].*'${label}'`, 'm'));
    expect(d.claudeCalled()).toBe(false);
  });

  it.each(COUNTERMANDING)('%s: refused when it ranks last with room to spare', async (label) => {
    const d = await runOnce({ ready: [1, 10], realDispatch: countermanded([10], label), reading: ROOM, env: limit(30) });
    expect(d.offered()).toEqual([1, 10]);
    expect(d.dispatched()).toEqual([1]);
    expect(d.log()).toMatch(new RegExp(`^Skipping #10 .*\\[countermanded\\].*'${label}'`, 'm'));
  });

  it('an issue whose ready label is gone by dispatch time is refused, and frees its slot the same way', async () => {
    // The other quiet refusal: re-triaged away between the read and the dispatch.
    const d = await runOnce({ ready: [1, 10], realDispatch: { 1: ['role:dev'] }, reading: ROOM, env: limit(1) });
    expect(d.dispatched()).toEqual([10]);
    expect(d.log()).toMatch(/^Skipping #1 .*\[no-label\]/m);
  });

  it('the file the dispatcher records its refusal in is never named to anything the dispatcher runs', async () => {
    // The record decides whether a slot was used, so an agent that could find and write it
    // could give itself a second dispatch. The name is taken out of the environment before
    // the dispatcher runs anything.
    const d = await runOnce({ ready: [1, 2, 10], realDispatch: countermanded([1, 2]), reading: ROOM, env: limit(1) });
    expect(d.dispatched()).toEqual([10]);
    expect(d.outcomeFileLeaked()).toBe(false);
  });
});

describe('#2641: the same rule on the parallel path', () => {
  it.each([
    { name: 'width 2, limit 2', width: 2, cap: 2, ready: [1, 2, 3, 10, 20, 30], refused: [1, 2, 3], builds: [10, 20] },
    { name: 'width 3, limit 1', width: 3, cap: 1, ready: [1, 2, 10, 20], refused: [1, 2], builds: [10] },
    { name: 'width 2, limit 3, refused among clean', width: 2, cap: 3, ready: [1, 2, 3, 4, 5, 6], refused: [2, 3], builds: [1, 4, 5] },
  ])('$name: refused issues do not use a slot, and no more than the limit is built', async ({ width, cap, ready, refused, builds }) => {
    const d = await runOnce({
      ready,
      realDispatch: countermanded(refused),
      reading: ROOM,
      // A build that takes a moment, so launches really overlap.
      dispatchSecs: 0.2,
      env: { ...limit(cap), MINSPEC_DRAIN_CONCURRENCY: String(width) },
    });
    // Launch order is not deterministic under fan-out; the set, and its size, are.
    expect([...d.dispatched()].sort((a, b) => a - b)).toEqual(builds);
    expect(d.dispatched()).toHaveLength(Math.min(cap, builds.length));
    for (const n of refused) expect(d.dispatched()).not.toContain(n);
    expect(d.log()).toContain('cycle done');
  });

  it('CONTROL: width 3 with a limit of 2 and nothing refused builds exactly two', async () => {
    const d = await runOnce({
      ready: [1, 2, 3, 4, 5],
      reading: ROOM,
      dispatchSecs: 0.2,
      env: { ...limit(2), MINSPEC_DRAIN_CONCURRENCY: '3' },
    });
    expect([...d.dispatched()].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

describe('#2641 T0 (no silent gate): a cycle that starts nothing while issues are ready says so', () => {
  // The alarm itself, by how the line BEGINS: the cycle's last line names it too.
  const alarm = (log: string) => log.split('\n').filter((l) => l.startsWith('[drain] NOTHING DISPATCHED'));

  it('every ready issue refused: the cycle names how many were ready and how many were refused', async () => {
    const d = await runOnce({ ready: [1, 2, 3], realDispatch: countermanded([1, 2, 3]), reading: ROOM, env: limit(2) });
    expect(d.dispatched()).toEqual([]);
    // With no slot used, all three are offered: the limit of 2 is not what stopped it.
    expect(d.offered()).toEqual([1, 2, 3]);
    const lines = alarm(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[drain\] NOTHING DISPATCHED this cycle: 3 issue\(s\) ready, 3 refused by the dispatcher/);
    expect(lines[0]).toContain('0 never offered');
    // The cycle is over, and its last line does not read as a healthy one.
    expect(d.log()).toMatch(/^\[drain\] cycle done\. Nothing was dispatched/m);
    expect(d.log()).not.toContain('cycle error');
  });

  it('THE LIVE CASE, with the record gone: refusals take every slot again, and the cycle says so instead of "cycle done."', async () => {
    // This is what the drain did for 8.5 hours. Here the dispatcher is given nowhere to
    // record that it started nothing (an older dispatcher, or one that could not write),
    // so the slot rule has nothing to go on and the two refusals use both slots. The
    // refusal is still in the dispatcher's own output, and that is enough to notice that
    // the cycle started nothing with clean issues queued behind.
    const d = await runOnce({
      ready: [1, 2, 10, 20],
      realDispatch: countermanded([1, 2]),
      withholdOutcomeRecord: true,
      reading: ROOM,
      env: limit(2),
    });
    expect(d.dispatched()).toEqual([]);
    expect(d.offered()).toEqual([1, 2]);
    const lines = alarm(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/4 issue\(s\) ready, 2 refused by the dispatcher/);
    expect(lines[0]).toContain('2 never offered');
    expect(d.log()).toMatch(/^\[drain\] cycle done\. Nothing was dispatched/m);
    // And each such refusal is named as having been counted against the limit.
    expect(d.log()).toMatch(/WARNING: the dispatcher refused #1 but left no not-started record/);
    expect(d.log()).toMatch(/WARNING: the dispatcher refused #2 but left no not-started record/);
  });

  it('with the record gone and room in the limit, the clean issue behind is still built and nothing is alarming', async () => {
    const d = await runOnce({
      ready: [1, 2, 10, 20],
      realDispatch: countermanded([1, 2]),
      withholdOutcomeRecord: true,
      reading: ROOM,
      env: limit(3),
    });
    expect(d.offered()).toEqual([1, 2, 10]);
    expect(d.dispatched()).toEqual([10]);
    expect(alarm(d.log())).toEqual([]);
    expect(d.log()).toMatch(/^\[drain\] cycle done\.$/m);
  });

  it('a limit of 0 starts nothing and says the issues were never offered', async () => {
    const d = await runOnce({ ready: [1, 2], reading: ROOM, env: limit(0) });
    expect(d.dispatched()).toEqual([]);
    expect(d.offered()).toEqual([]);
    const lines = alarm(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 issue\(s\) ready, 0 refused by the dispatcher/);
    expect(lines[0]).toContain('2 never offered (queue limit 0)');
  });

  it('CONTROL: a cycle that builds something is not alarming, and ends on the plain line', async () => {
    const d = await runOnce({ ready: [1, 2, 10], realDispatch: countermanded([1]), reading: ROOM, env: limit(2) });
    expect(d.dispatched()).toEqual([2, 10]);
    expect(alarm(d.log())).toEqual([]);
    expect(d.log()).toMatch(/^\[drain\] cycle done\.$/m);
    expect(d.log()).not.toContain('Nothing was dispatched');
  });

  it('CONTROL: an all-clean cycle prints neither the alarm nor the refused line', async () => {
    const d = await runOnce({ ready: [1, 2], reading: ROOM, env: limit(2) });
    expect(d.dispatched()).toEqual([1, 2]);
    expect(alarm(d.log())).toEqual([]);
    expect(d.log()).not.toContain('refused by the dispatcher');
    expect(d.log()).not.toContain('left no not-started record');
  });

  it('CONTROL: an empty queue is not a starved one', async () => {
    // An inbox issue, so that a one-shot starts a cycle at all.
    const d = await runOnce({ inbox: [300], reading: ROOM });
    expect(d.log()).toContain('no agent-ready / agent-ready-specify issues after triage');
    expect(alarm(d.log())).toEqual([]);
  });
});

describe('#2641: a refusal is neither an attempt nor a completion, for the two gates that count them', () => {
  // Going past refusals means one cycle can now hold any number of them. Two existing
  // gates count dispatches, and a refusal (exit 0, nothing run) must not dilute either.
  const alarm = (log: string) => log.split('\n').filter((l) => l.startsWith('[drain] NOTHING DISPATCHED'));
  const THRASH = 'Autocompact is thrashing';

  it('#2140 all-failed: a refusal ahead of two failures does not make the cycle look partly successful', async () => {
    const d = await runOnce({
      ready: [1, 2, 3],
      realDispatch: countermanded([1]),
      issueFails: [2, 3],
      reading: ROOM,
      env: limit(5),
    });
    expect(d.offered()).toEqual([1, 2, 3]);
    expect(d.dispatched()).toEqual([]);
    expect(d.log()).toContain('CYCLE FAILED');
    expect(d.log()).toContain('all 2 dispatch(es)');
    expect(d.log()).not.toContain('cycle done.');
    // One loud line for this cycle, and it is the all-failed one.
    expect(alarm(d.log())).toEqual([]);
  });

  it('#2140 CONTROL: a refusal, a failure and a build is a partial failure, as it always was', async () => {
    const d = await runOnce({
      ready: [1, 2, 3],
      realDispatch: countermanded([1]),
      issueFails: [2],
      reading: ROOM,
      env: limit(5),
    });
    expect(d.dispatched()).toEqual([3]);
    expect(d.log()).toContain('WARNING: dispatch failed for #2');
    expect(d.log()).not.toContain('CYCLE FAILED');
    expect(d.log()).toMatch(/^\[drain\] cycle done\.$/m);
  });

  it('a refusal with no record and a failure: not all-failed, and still nothing ran, so the cycle says that', async () => {
    const d = await runOnce({
      ready: [1, 2],
      realDispatch: countermanded([1]),
      withholdOutcomeRecord: true,
      issueFails: [2],
      reading: ROOM,
      env: limit(5),
    });
    expect(d.dispatched()).toEqual([]);
    expect(d.log()).not.toContain('CYCLE FAILED');
    const lines = alarm(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2 issue(s) ready, 1 refused by the dispatcher before any work started, 1 failed, 0 never offered');
  });

  it('#912 breaker: a refusal between two thrashed builds does not end the run of thrashes', async () => {
    // The breaker halts after N completions in a row that thrashed. A refused issue
    // completed nothing, so it must not count as the clean completion that resets it.
    const d = await runOnce({
      ready: [1, 2, 3, 4],
      realDispatch: countermanded([2]),
      issueSays: { 1: THRASH, 3: THRASH },
      reading: ROOM,
      env: { ...limit(10), MINSPEC_DISPATCH_AUTOCOMPACT_HALT: '2' },
    });
    expect(d.offered()).toEqual([1, 2, 3]);
    expect(d.dispatched()).toEqual([1, 3]);
    expect(d.log()).toContain('HALTING dispatch for the rest of this cycle');
  });

  it('#912 breaker CONTROL: a clean BUILD between two thrashed ones does end it', async () => {
    const d = await runOnce({
      ready: [1, 2, 3, 4],
      issueSays: { 1: THRASH, 3: THRASH },
      reading: ROOM,
      env: { ...limit(10), MINSPEC_DISPATCH_AUTOCOMPACT_HALT: '2' },
    });
    expect(d.dispatched()).toEqual([1, 2, 3, 4]);
    expect(d.log()).not.toContain('HALTING dispatch');
  });
});

describe('#2641: the quota gate is asked before every offer, refused or not', () => {
  /** The loop has either finished the cycle or gone to sleep on a pause. */
  const settled = (log: string) => log.includes('cycle done') || /sleeping \d+s/.test(log);
  const CAP_50 = { MINSPEC_QUOTA_ADMIT_PCT: '50' };
  const UNDER: Reading = { pct: 40, resetIn: 9000 };
  const OVER: Reading = { pct: 55, resetIn: 9000 };

  it('a reading that crosses the cap during the first build holds the rest, refusals before it notwithstanding', async () => {
    const d = await runLoop(
      {
        ready: [1, 2, 10, 20, 30],
        realDispatch: countermanded([1, 2]),
        reading: UNDER,
        readingAfterIssue: { 10: OVER },
        env: { ...CAP_50, ...limit(3) },
      },
      settled,
    );
    expect(d.offered()).toEqual([1, 2, 10]);
    expect(d.dispatched()).toEqual([10]);
    expect(d.log()).toMatch(/defer:\d+ \(5h window 55% used/);
    expect(d.log()).toContain('holding the rest of the queue');
    expect(d.log()).not.toContain('cycle done');
  });

  it('a gate that holds before the first offer offers nothing, not even an issue it would have refused', async () => {
    const d = await runLoop(
      {
        ready: [1, 2, 10],
        realDispatch: countermanded([1, 2]),
        reading: UNDER,
        readingAfterRanking: OVER,
        env: { ...CAP_50, ...limit(2) },
      },
      settled,
    );
    expect(d.offered()).toEqual([]);
    expect(d.dispatched()).toEqual([]);
    expect(d.log()).toContain('holding the rest of the queue');
    expect(d.log()).not.toContain('cycle done');
  });
});
