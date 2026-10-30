/**
 * T3 (#2939) - spec-writing pauses while the drain's own held pull requests are at the cap.
 *
 * THE BUG. The drain opened spec drafts faster than anything could land them: 62 open
 * drafts on 2026-10-18, each withheld from auto-merge as `approval-or-acceptance`, with
 * 117 issues still queued as `agent-ready-specify`. The founder had already parked the
 * same pile by hand twice (2026-10-07, 2026-10-16). The response to the first, the
 * MINSPEC_DRAIN_SPECIFY switch (#2582), defaults to on and lives only in a launcher's
 * environment, so every restart of the drain turned spec-writing back on. Nothing tied
 * spec-writing to the condition that makes it waste: drafts already waiting on a human.
 *
 * WHAT MUST HOLD:
 *   B1  below the cap, spec-writing is dispatched exactly as before.
 *   B2  at or above the cap, an `agent-ready-specify` issue is not dispatched, a build
 *       still is, and the cycle says so in one line naming the count and the cap.
 *   B3  with ONLY spec-writing queued at the cap, open PRs are still swept.
 *   B4  a count that cannot be read pauses spec-writing, loudly. Reading it as 0 would
 *       be the silent gate (invariant 2) that let the pile form.
 *   B5  a cap that is not a whole number is read as 0, the setting that spends nothing.
 *   B6  with the switch already off, the count is not asked for at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runOnce, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
useHostileAmbientDrainKnobs();

afterEach(cleanupDrains);

const ROOM: Reading = { pct: 1, resetIn: 3600 };

const pausedLines = (log: string) => log.split('\n').filter((l) => l.includes('spec-writing is PAUSED'));

describe('#2939 B1: below the cap, spec-writing runs as before', () => {
  it.each([
    { name: 'none held, default cap', held: 0, env: {} as Record<string, string> },
    { name: 'nine held, default cap of 10', held: 9, env: {} as Record<string, string> },
    { name: 'four held, cap of 5', held: 4, env: { MINSPEC_DRAIN_SPECIFY_MAX_HELD: '5' } },
  ])('$name: both queues are dispatched', async ({ held, env }) => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: held, reading: ROOM, env });
    expect(d.dispatched()).toEqual([42, 77]);
    expect(pausedLines(d.log())).toEqual([]);
  });
});

describe('#2939 B2: at or above the cap, builds run and spec-writing waits', () => {
  it.each([
    { name: 'exactly the default cap', held: 10, env: {} as Record<string, string>, cap: 10 },
    { name: 'the 62 held on 2026-10-18', held: 62, env: {} as Record<string, string>, cap: 10 },
    { name: 'a cap of 5 with 5 held', held: 5, env: { MINSPEC_DRAIN_SPECIFY_MAX_HELD: '5' }, cap: 5 },
  ])('$name: only the build is dispatched, and the cycle says why once', async ({ held, env, cap }) => {
    const d = await runOnce({ ready: [42], specify: [77, 78], heldPrs: held, reading: ROOM, env });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`${held} drain pull request(s) held for a human`);
    expect(lines[0]).toContain(`cap ${cap}`);
    expect(lines[0]).toContain('2 agent-ready-specify issue(s) left');
    expect(d.log()).toContain('cycle done');
  });
});

describe('#2939 B3: spec-writing alone at the cap still sweeps open PRs', () => {
  it('nothing is dispatched and the open PRs are remediated', async () => {
    const d = await runOnce({ specify: [77], openPrs: [501, 502], heldPrs: 30, reading: ROOM });
    expect(d.dispatched()).toEqual([]);
    expect(d.remediated()).toEqual([501, 502]);
    expect(pausedLines(d.log())).toHaveLength(1);
    expect(d.log()).toContain('cycle done');
  });
});

describe('#2939 B4: an unreadable count pauses spec-writing, never reads as zero', () => {
  it('the gh query fails: builds run, spec-writing waits, and the line says the count failed', async () => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 'fail', reading: ROOM });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('could not be counted');
  });
});

describe('#2939 B5: a cap that is not a whole number spends nothing', () => {
  it.each(['ten', '-1', '1.5', ' 10'])('MINSPEC_DRAIN_SPECIFY_MAX_HELD=%j pauses spec-writing and names the value', async (value) => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 0, reading: ROOM, env: { MINSPEC_DRAIN_SPECIFY_MAX_HELD: value } });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('is not a whole number');
  });
});

describe('#2939 B6: the switch already off is not overridden or re-asked', () => {
  it('MINSPEC_DRAIN_SPECIFY=0 keeps its own line, and no count is asked for', async () => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 0, reading: ROOM, env: { MINSPEC_DRAIN_SPECIFY: '0' } });
    expect(d.dispatched()).toEqual([42]);
    expect(pausedLines(d.log())).toEqual([]);
    expect(d.log()).toContain('spec-writing is switched OFF');
    expect(d.heldAsked()).toBe(0);
  });
});

/**
 * T3 (#3344) - the held count misses drafts that already merged.
 *
 * THE BUG. Delegated spec merge (#2981, Step 0c) lands a held spec draft on main at
 * `status: specifying`, which takes it OUT of the held count above. Each such merge
 * reopened spec-writing while the drafts it landed still waited on Clarify and sign-off,
 * so unapproved specs on main went from 30 to 77 between 2026-10-27 and 2026-10-29 with
 * the held cap holding throughout. The brake measured where a draft waits before merge,
 * never where it waits after.
 *
 *   P1  at or above MINSPEC_DRAIN_SPECIFY_MAX_PENDING (default 40) unapproved specs on the
 *       tree the drain runs from, spec-writing pauses even with nothing held; builds run.
 *   P2  below it, spec-writing runs; only the frontmatter `status:` counts.
 *   P3  a tree with no specs/ folder is a count nobody read: spec-writing pauses, loudly.
 *   P4  a cap that is not a whole number is read as 0, the setting that spends nothing.
 */
describe('#3344 P1: unapproved specs on main at the cap pause spec-writing', () => {
  it.each([
    { name: 'exactly the default cap of 40', pending: 40, env: {} as Record<string, string>, cap: 40 },
    { name: 'the 77 on main on 2026-10-29', pending: 77, env: {} as Record<string, string>, cap: 40 },
    { name: 'a cap of 3 with 3 pending', pending: 3, env: { MINSPEC_DRAIN_SPECIFY_MAX_PENDING: '3' }, cap: 3 },
  ])('$name: only the build is dispatched, and the cycle says why once', async ({ pending, env, cap }) => {
    const d = await runOnce({ ready: [42], specify: [77, 78], heldPrs: 0, pendingSpecs: pending, reading: ROOM, env });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`${pending} spec(s) on main waiting for Clarify or sign-off`);
    expect(lines[0]).toContain(`cap ${cap}`);
    expect(lines[0]).toContain('2 agent-ready-specify issue(s) left');
  });
});

describe('#3344 P2: below the pending cap, spec-writing runs', () => {
  it.each([
    { name: '39 pending, default cap', pending: 39, env: {} as Record<string, string> },
    { name: '2 pending, cap of 3 (body mention and approved specs not counted)', pending: 2, env: { MINSPEC_DRAIN_SPECIFY_MAX_PENDING: '3' } },
  ])('$name: both queues are dispatched', async ({ pending, env }) => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 0, pendingSpecs: pending, reading: ROOM, env });
    expect(d.dispatched()).toEqual([42, 77]);
    expect(pausedLines(d.log())).toEqual([]);
  });
});

describe('#3344 P3: no specs folder is not a count of zero', () => {
  it('spec-writing pauses and the line says the count could not be read', async () => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 0, pendingSpecs: 'missing', reading: ROOM });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unapproved specs on main could not be counted');
  });
});

describe('#3344 P4: a pending cap that is not a whole number spends nothing', () => {
  it.each(['forty', '-1', '2.5'])('MINSPEC_DRAIN_SPECIFY_MAX_PENDING=%j pauses spec-writing and names the value', async (value) => {
    const d = await runOnce({ ready: [42], specify: [77], heldPrs: 0, pendingSpecs: 0, reading: ROOM, env: { MINSPEC_DRAIN_SPECIFY_MAX_PENDING: value } });
    expect(d.dispatched()).toEqual([42]);
    const lines = pausedLines(d.log());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('MINSPEC_DRAIN_SPECIFY_MAX_PENDING');
    expect(lines[0]).toContain('is not a whole number');
  });
});
