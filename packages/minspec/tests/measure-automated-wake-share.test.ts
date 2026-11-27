import { describe, it, expect } from 'vitest';
import { classifyWake, idleWakes, summarize, type Wake } from '../../../scripts/measure-automated-wake-share';

const asst = (id: string, ts: string, read: number, create: number) => ({
  type: 'assistant',
  timestamp: ts,
  message: { id, model: 'm', usage: { input_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: create } },
});
const jl = (xs: object[]) => xs.map((x) => JSON.stringify(x)).join('\n');

describe('classifyWake', () => {
  it('reads human from either field', () => {
    expect(classifyWake({ turnOrigin: 'human' })).toBe('human');
    expect(classifyWake({ origin: { kind: 'human' } })).toBe('human');
  });
  it('splits socket peers from subagent hand-backs by origin.from', () => {
    expect(classifyWake({ turnOrigin: 'peer', origin: { kind: 'peer', from: 'uds:/tmp/x.sock' } })).toBe('peer-socket');
    expect(classifyWake({ turnOrigin: 'peer', origin: { kind: 'peer', from: 'a9f3', name: 'Explore' } })).toBe('peer-subagent');
  });
  it('maps the other automated origins', () => {
    expect(classifyWake({ turnOrigin: 'task_notification' })).toBe('task-notif');
    expect(classifyWake({ origin: { kind: 'task-notification' } })).toBe('task-notif');
    expect(classifyWake({ turnOrigin: 'scheduled' })).toBe('scheduled');
    expect(classifyWake({ turnOrigin: 'system' })).toBe('system');
    expect(classifyWake({ origin: { kind: 'coordinator' } })).toBe('coordinator');
    expect(classifyWake({ turnOrigin: 'sdk' })).toBe('sdk');
  });
  it('treats a meta record with no origin as the harness continuation', () => {
    expect(classifyWake({ isMeta: true })).toBe('continuation');
  });
  it('falls back to content only when no origin field exists, else unlabelled', () => {
    expect(classifyWake({ message: { content: 'x <cross-session-message from="uds:/a">' } })).toBe('peer-socket');
    expect(classifyWake({ message: { content: 'hello' } })).toBe('unlabelled');
  });
  it('a human field wins over relay text in the content', () => {
    expect(classifyWake({ turnOrigin: 'human', message: { content: '<cross-session-message' } })).toBe('human');
  });
});

describe('idleWakes', () => {
  const a = asst('a', '2026-01-01T00:00:00Z', 100_000, 10);
  const rewrite = (id: string, ts: string) => asst(id, ts, 0, 100_000);
  it('attributes an over-idle rewrite to the first user record after the previous turn', () => {
    const text = jl([a, { type: 'user', turnOrigin: 'task_notification', message: { content: 'n' } }, rewrite('b', '2026-01-01T02:00:00Z')]);
    expect(idleWakes(text).map((w) => w.wake)).toEqual(['task-notif']);
  });
  it('skips tool_result user records when finding the wake', () => {
    const tr = { type: 'user', message: { content: [{ type: 'tool_result' }] } };
    const text = jl([a, tr, { type: 'user', turnOrigin: 'human', message: { content: 'hi' } }, rewrite('b', '2026-01-01T02:00:00Z')]);
    expect(idleWakes(text).map((w) => w.wake)).toEqual(['human']);
  });
  it('ignores short gaps and compaction rewrites', () => {
    expect(idleWakes(jl([a, { type: 'user', turnOrigin: 'human' }, rewrite('b', '2026-01-01T00:30:00Z')]))).toEqual([]);
    expect(idleWakes(jl([a, { type: 'system', subtype: 'compact_boundary' }, { type: 'user', turnOrigin: 'human' }, rewrite('b', '2026-01-01T02:00:00Z')]))).toEqual([]);
  });
  it('ignores sidechain user records', () => {
    const text = jl([a, { type: 'user', isSidechain: true, turnOrigin: 'sdk' }, { type: 'user', turnOrigin: 'human' }, rewrite('b', '2026-01-01T02:00:00Z')]);
    expect(idleWakes(text).map((w) => w.wake)).toEqual(['human']);
  });
});

describe('summarize', () => {
  const w = (wake: Wake['wake']): Wake => ({ gap: 7200, tokens: 1, wake });
  it('headline counts socket peers as automated; lower bound drops them; unlabelled is excluded', () => {
    const s = summarize([w('human'), w('human'), w('peer-socket'), w('peer-socket'), w('task-notif'), w('unlabelled')]);
    expect(s.total).toBe(6);
    expect(s.headline).toBeCloseTo(3 / 5);
    expect(s.lowerBound).toBeCloseTo(1 / 3);
  });
  it('returns null shares on an empty or all-unlabelled set', () => {
    expect(summarize([]).headline).toBeNull();
    expect(summarize([w('unlabelled')]).lowerBound).toBeNull();
  });
});
