/**
 * T2 (#2582) - MINSPEC_DRAIN_SPECIFY=0 stops spec-writing dispatches and nothing else.
 *
 * WHY THE SWITCH EXISTS. Spec drafts were being written faster than they were read: 87
 * open pull requests carried `awaiting-approval` on 2026-10-07, with 272 issues still
 * queued as `agent-ready-specify` behind them. The only ways to stop more were to pause
 * the whole drain, which also stops builds and pull request remediation, or to strip a
 * label from 272 issues.
 *
 * WHAT IT MUST AND MUST NOT DO:
 *   S1  at 1, and by default, both queues are dispatched: today's behaviour, unchanged.
 *   S2  at 0 an `agent-ready-specify` issue is not dispatched and an `agent-ready` one is.
 *   S3  triage and pull request remediation still run at 0, including when spec-writing
 *       is the ONLY work queued. A cycle with nothing to dispatch returns before the
 *       sweep, so a switch that merely emptied the queue would have switched
 *       remediation off as a side effect.
 *   S4  each cycle says, in one line, that spec-writing is off and how many issues it left.
 *   S5  the dispatch cap is not spent on the issues the switch skips.
 *   S6  a value that is neither 0 nor 1 is read as off, and the line says so. The knob
 *       exists to stop spending, so "ignored, and still spending" is the unsafe reading.
 *
 * Every test drives the real script through whole cycles (helpers/drain-harness.ts), and
 * asserts on what the stubs were actually asked to do, not on what the log says was done.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runOnce, type DrainFixture, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
// MINSPEC_DRAIN_SPECIFY=0 is one of the hostile knobs: the "on by default" tests below
// run with it set in the surrounding environment, where a drain started with the switch
// off would put it for every agent it dispatches (#2574).
useHostileAmbientDrainKnobs();

afterEach(cleanupDrains);

/** A reading any cap admits, so the quota gate is never what decided a test here. */
const ROOM: Reading = { pct: 1, resetIn: 3600 };
const OFF = { MINSPEC_DRAIN_SPECIFY: '0' };

const offLines = (log: string) => log.split('\n').filter((l) => l.includes('spec-writing is switched OFF'));

describe('#2582 S1: on by default, and at 1', () => {
  it.each([
    { name: 'no knob at all', env: {} as Record<string, string> },
    { name: 'MINSPEC_DRAIN_SPECIFY=1', env: { MINSPEC_DRAIN_SPECIFY: '1' } },
    { name: 'an EMPTY MINSPEC_DRAIN_SPECIFY (the same as unset)', env: { MINSPEC_DRAIN_SPECIFY: '' } },
  ])('$name: the build issue and the spec-writing issue are both dispatched', async ({ env }) => {
    const d = await runOnce({ ready: [42], specify: [77], reading: ROOM, env });
    expect(d.dispatched()).toEqual([42, 77]);
    expect(offLines(d.log())).toEqual([]);
    expect(d.log()).toContain('cycle done');
  });
});

describe('#2582 S2 + S4: at 0 the spec-writing queue is left alone, and the cycle says so once', () => {
  it('a spec-writing issue is not dispatched and a build issue is', async () => {
    const d = await runOnce({ ready: [42], specify: [77], reading: ROOM, env: OFF });
    expect(d.dispatched()).toEqual([42]);
    expect(d.log()).not.toContain('dispatching #77');
    expect(d.log()).toContain('cycle done');
    const lines = offLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/spec-writing is switched OFF \(MINSPEC_DRAIN_SPECIFY=0\): 1 agent-ready-specify issue\(s\) left/);
    expect(d.claudeCalled()).toBe(false);
  });

  it.each([
    { name: 'none queued', ready: [42, 43], specify: [] as number[], left: 0, dispatched: [42, 43] },
    { name: 'three queued among two builds', ready: [42, 43], specify: [77, 78, 79], left: 3, dispatched: [42, 43] },
    { name: 'spec-writing issues numbered below every build', ready: [500, 501], specify: [1, 2], left: 2, dispatched: [500, 501] },
    { name: 'the queues interleaved', ready: [10, 30, 50], specify: [20, 40], left: 2, dispatched: [10, 30, 50] },
  ])('$name: exactly $left counted as left, and only the builds dispatched', async ({ ready, specify, left, dispatched }) => {
    const d = await runOnce({ ready, specify, reading: ROOM, env: OFF });
    expect(d.dispatched()).toEqual(dispatched);
    const lines = offLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`: ${left} agent-ready-specify issue(s) left`);
  });

  it('an issue carrying BOTH labels is a build: it is dispatched, and not counted as left', async () => {
    // The dispatcher takes the mode from the verdict record, not the label, and an
    // approved spec leaves an issue labelled for the build with the old label beside
    // it. Leaving that one behind would strand approved work.
    const d = await runOnce({ ready: [42, 77], specify: [77, 78], reading: ROOM, env: OFF });
    expect(d.dispatched()).toEqual([42, 77]);
    expect(offLines(d.log())[0]).toContain(': 1 agent-ready-specify issue(s) left');
  });
});

describe('#2582 S3: triage and pull request remediation still run at 0', () => {
  it('with builds queued: the inbox is triaged, the builds dispatched, the open PRs swept', async () => {
    const d = await runOnce({ inbox: [300], ready: [42], specify: [77], openPrs: [501, 502], reading: ROOM, env: OFF });
    expect(d.triaged()).toEqual([300]);
    expect(d.dispatched()).toEqual([42]);
    expect(d.remediated()).toEqual([501, 502]);
    expect(d.log()).toContain('cycle done');
  });

  it('with ONLY spec-writing queued: nothing is dispatched, and the open PRs are still swept', async () => {
    // The case a naive switch gets wrong. Empty the dispatch queue and run_cycle takes
    // its "nothing ready" return, which comes BEFORE the sweep.
    const d = await runOnce({ specify: [77, 78], openPrs: [501, 502], reading: ROOM, env: OFF });
    expect(d.dispatched()).toEqual([]);
    expect(d.remediated()).toEqual([501, 502]);
    const log = d.log();
    expect(offLines(log)).toHaveLength(1);
    expect(offLines(log)[0]).toContain(': 2 agent-ready-specify issue(s) left');
    expect(log).toContain('sweeping 2 open PR(s)');
    expect(log).toContain('cycle done');
    // It did not go through the ranker or announce a dispatch of nothing.
    expect(log).not.toContain('dispatch order ranked');
    expect(log).not.toMatch(/dispatching \d+ agent-ready issue/);
  });

  it('CONTROL: the same queue with the switch on dispatches the spec-writing issues, then sweeps', async () => {
    const d = await runOnce({ specify: [77, 78], openPrs: [501, 502], reading: ROOM });
    expect(d.dispatched()).toEqual([77, 78]);
    expect(d.remediated()).toEqual([501, 502]);
  });

  it('with ONLY spec-writing queued and a limit notice from the sweep, the cycle pauses as any sweep does', async () => {
    // The sweep reached through the switch is the same sweep: a remediation that ends on
    // the CLI's own limit line pauses the cycle, so "cycle done" must not follow it.
    const d = await runOnce({
      specify: [77],
      openPrs: [501, 502],
      reading: ROOM,
      env: { ...OFF },
      remediateSays: { 501: "You've hit your session limit · resets 11:20am (Australia/Sydney)" },
    });
    expect(d.dispatched()).toEqual([]);
    expect(d.remediated()).toEqual([501]);
    expect(d.log()).toContain('usage-limit signal while remediating PR #501');
    expect(d.log()).not.toContain('cycle done');
  });

  it('nothing queued at all still says the switch is off: every cycle says so', async () => {
    // An inbox issue, so that a one-shot starts a cycle at all.
    const d = await runOnce({ inbox: [300], reading: ROOM, env: OFF });
    expect(d.triaged()).toEqual([300]);
    expect(offLines(d.log())).toHaveLength(1);
    expect(offLines(d.log())[0]).toContain(': 0 agent-ready-specify issue(s) left');
    expect(d.log()).toContain('no agent-ready / agent-ready-specify issues after triage');
  });
});

describe('#2582 S5: the dispatch cap is spent on builds, not on issues the switch skips', () => {
  it('with a cap of 2 and three spec-writing issues ahead of them in the order, two builds are dispatched', async () => {
    // The stub ranker keeps numeric order, so 1, 2, 3 lead it. Capping first and
    // skipping afterwards would dispatch nothing at all, on every cycle, forever, with
    // builds queued: the live drain was running with a cap of 2 when this was written.
    const fixture: DrainFixture = { ready: [10, 20, 30], specify: [1, 2, 3], reading: ROOM };
    const d = await runOnce({ ...fixture, env: { ...OFF, MINSPEC_DRAIN_QUEUE_LIMIT: '2' } });
    expect(d.dispatched()).toEqual([10, 20]);
    expect(d.log()).toMatch(/NOTE: 3 issue\(s\) ready — dispatching the top 2 this cycle/);
    // CONTROL: with the switch on, the same cap goes to the first two of all six.
    const on = await runOnce({ ...fixture, env: { MINSPEC_DRAIN_QUEUE_LIMIT: '2' } });
    expect(on.dispatched()).toEqual([1, 2]);
  });
});

describe('#2582 S6: a value that is neither 0 nor 1 is off, loudly', () => {
  it.each(['false', 'off', 'no', 'yes', 'true', '2', ' 0', '0 '])('MINSPEC_DRAIN_SPECIFY=%j leaves the spec-writing queue alone and names the value', async (value) => {
    const d = await runOnce({ ready: [42], specify: [77], reading: ROOM, env: { MINSPEC_DRAIN_SPECIFY: value } });
    expect(d.dispatched()).toEqual([42]);
    const lines = offLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('is neither 0 nor 1');
    expect(lines[0]).toContain(': 1 agent-ready-specify issue(s) left');
  });
});
