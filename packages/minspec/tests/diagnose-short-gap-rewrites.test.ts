import { describe, it, expect } from 'vitest';
import { classify, parseTurns, type Turn } from '../../../scripts/diagnose-short-gap-rewrites';

const base: Turn = { id: 'a', t: 0, model: 'm', ctx: 500_000, read: 499_000, create: 1_000, create5m: 0, compactedBefore: false };

describe('diagnose-short-gap-rewrites', () => {
  it('attributes a post-compaction shrink to compaction, not expiry', () => {
    const cur: Turn = { ...base, id: 'b', t: 1000, ctx: 83_925, read: 14_995, create: 68_928, compactedBefore: true };
    expect(classify(base, cur)).toEqual({ gap: 1000, tokens: 68_928, mechanism: 'compaction' });
  });
  it('ignores a normal cache hit', () => {
    expect(classify(base, { ...base, id: 'b', t: 10 })).toBeNull();
  });
  it('flags a same-size short-gap rewrite with no explanation as unexplained', () => {
    const cur: Turn = { ...base, id: 'b', t: 800, read: 0, create: 500_000 };
    expect(classify(base, cur)?.mechanism).toBe('unexplained');
  });
  it('attributes a 5-minute-TTL write after 300s to ttl-5m', () => {
    const cur: Turn = { ...base, id: 'b', t: 800, read: 0, create: 500_000 };
    expect(classify({ ...base, create5m: 1000 }, cur)?.mechanism).toBe('ttl-5m');
  });
  it('parseTurns marks the turn after a compact_boundary and dedupes ids', () => {
    const a = { type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id: 'x', model: 'm', usage: { input_tokens: 1, cache_read_input_tokens: 100000, cache_creation_input_tokens: 10 } } };
    const b = { ...a, timestamp: '2026-01-01T00:10:00Z', message: { ...a.message, id: 'y' } };
    const text = [a, a, { type: 'system', subtype: 'compact_boundary' }, b].map((x) => JSON.stringify(x)).join('\n');
    const t = parseTurns(text);
    expect(t.map((x) => x.compactedBefore)).toEqual([false, true]);
  });
});
