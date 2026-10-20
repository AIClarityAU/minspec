/**
 * T0/T1 — the repeat-fix share producer (#2854 item 2, DR-108 tripwire).
 *
 * The delegation suspends itself when this share passes its tripwire, and an unknown
 * share already suspends it. So the property that matters most is the fail-closed one:
 * every way the number could be untrustworthy must yield `share: undefined`, never a
 * low number. Those cases come first.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  fixScopeIssues,
  measureRepeatFixShare,
  readRepeatFixShare,
  MIN_ATTRIBUTION,
  WINDOW_DAYS,
  type CommitLine,
  type GitRunner,
} from '../../../scripts/lib/repeat-fix-share';

const TODAY = '2026-10-20';
let n = 0;
const c = (date: string, subject: string): CommitLine => ({ sha: `sha${String(n++).padStart(4, '0')}`, date, subject });

describe('fails closed — an untrustworthy share is unknown, never low', () => {
  it('no fix commits in the window → unknown', () => {
    const m = measureRepeatFixShare([c('2026-10-01T00:00:00Z', 'feat(#1): x')], TODAY);
    expect(m.share).toBeUndefined();
    expect(m.reason).toMatch(/no fix commits/);
  });

  it('attribution below the floor → unknown', () => {
    const h = [
      c('2026-10-01T00:00:00Z', 'fix(#1): a'),
      c('2026-10-02T00:00:00Z', 'fix: b'),
      c('2026-10-03T00:00:00Z', 'fix: c'),
    ];
    const m = measureRepeatFixShare(h, TODAY);
    expect(m.share).toBeUndefined();
    expect(m.attributed).toBe(1);
    expect(m.reason).toMatch(/cite an issue/);
  });

  it('attribution exactly at the floor is known', () => {
    const h = [
      ...Array.from({ length: 8 }, (_, i) => c(`2026-10-0${i + 1}T00:00:00Z`, `fix(#${100 + i}): a`)),
      c('2026-10-09T00:00:00Z', 'fix: b'),
      c('2026-10-09T01:00:00Z', 'fix: c'),
    ];
    expect(MIN_ATTRIBUTION).toBe(0.8);
    expect(measureRepeatFixShare(h, TODAY).share).toBe(0);
  });

  it('an unreadable commit date → unknown', () => {
    expect(measureRepeatFixShare([c('yesterday', 'fix(#1): a')], TODAY).share).toBeUndefined();
  });

  it('an unreadable today → unknown', () => {
    for (const t of ['', 'today', '2026-13-45']) {
      expect(measureRepeatFixShare([c('2026-10-01T00:00:00Z', 'fix(#1): a')], t).share).toBeUndefined();
    }
  });

  const fakeGit = (over: Partial<Record<'shallow' | 'verify' | 'log', string | Error>>): GitRunner => (args) => {
    const key = args[0] === 'rev-parse' && args[1] === '--is-shallow-repository' ? 'shallow' : args[0] === 'rev-parse' ? 'verify' : 'log';
    const v = over[key] ?? (key === 'shallow' ? 'false\n' : key === 'verify' ? 'abc\n' : '');
    if (v instanceof Error) throw v;
    return v;
  };

  it('a shallow clone → unknown (earlier fixes would be invisible)', () => {
    const m = readRepeatFixShare('/x', 'HEAD', TODAY, fakeGit({ shallow: 'true\n', log: 'a\t2026-10-01T00:00:00Z\tfix(#1): a\n' }));
    expect(m.share).toBeUndefined();
    expect(m.reason).toMatch(/shallow/);
  });
  it('git failing on any read → unknown', () => {
    for (const k of ['shallow', 'verify', 'log'] as const) {
      expect(readRepeatFixShare('/x', 'HEAD', TODAY, fakeGit({ [k]: new Error('boom') })).share).toBeUndefined();
    }
  });
  it('an unparseable log line → unknown', () => {
    expect(readRepeatFixShare('/x', 'HEAD', TODAY, fakeGit({ log: 'garbage-without-tabs\n' })).share).toBeUndefined();
  });
});

describe('the definition', () => {
  it('recognises only conventional fix subjects, and reads issues from the scope', () => {
    expect(fixScopeIssues('fix(#12): a')).toEqual(['12']);
    expect(fixScopeIssues('fix(#12, #13)!: a')).toEqual(['12', '13']);
    expect(fixScopeIssues('fix: a (#99)')).toEqual([]);
    expect(fixScopeIssues('fix!: a')).toEqual([]);
    expect(fixScopeIssues('feat(#12): a')).toBeUndefined();
    expect(fixScopeIssues('fixup! fix(#12): a')).toBeUndefined();
    expect(fixScopeIssues('Fix(#12): a')).toBeUndefined();
  });

  it('a second fix citing the same issue is a repeat; the first is not', () => {
    const h = [c('2026-10-01T00:00:00Z', 'fix(#5): first'), c('2026-10-02T00:00:00Z', 'fix(#5): again'), c('2026-10-03T00:00:00Z', 'fix(#6): other')];
    const m = measureRepeatFixShare(h, TODAY);
    expect({ fixes: m.fixes, repeats: m.repeats, attributed: m.attributed }).toEqual({ fixes: 3, repeats: 1, attributed: 3 });
    expect(m.share).toBeCloseTo(1 / 3);
  });

  it('a citation BEFORE the window still makes an in-window fix a repeat, but is not counted itself', () => {
    const h = [c('2026-01-01T00:00:00Z', 'fix(#5): long ago'), c('2026-10-02T00:00:00Z', 'fix(#5): again')];
    const m = measureRepeatFixShare(h, TODAY);
    expect(m.fixes).toBe(1);
    expect(m.repeats).toBe(1);
    expect(m.share).toBe(1);
  });

  it('order of input does not matter (sorted by date)', () => {
    const a = c('2026-10-01T00:00:00Z', 'fix(#5): first');
    const b = c('2026-10-02T00:00:00Z', 'fix(#5): again');
    expect(measureRepeatFixShare([b, a], TODAY)).toEqual(measureRepeatFixShare([a, b], TODAY));
  });

  it('the window is the 60 days ending today, inclusive at both ends, and ignores the future', () => {
    expect(WINDOW_DAYS).toBe(60);
    const h = [
      c('2026-08-21T23:59:59Z', 'fix(#1): just outside'),
      c('2026-08-22T00:00:00Z', 'fix(#2): first day'),
      c('2026-10-20T23:59:59Z', 'fix(#3): last moment'),
      c('2026-10-21T00:00:00Z', 'fix(#4): tomorrow'),
    ];
    const m = measureRepeatFixShare(h, TODAY);
    expect(m.windowStart).toBe('2026-08-22');
    expect(m.windowEnd).toBe(TODAY);
    expect(m.fixes).toBe(2);
  });
});

describe('reading a real git history', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });
  it('measures from the given ref, merges excluded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rfs-'));
    sh(root, 'init', '-q', '-b', 'main');
    sh(root, 'config', 'user.email', 't@example.com');
    sh(root, 'config', 'user.name', 't');
    const commit = (msg: string, date: string) => {
      fs.writeFileSync(path.join(root, 'f'), msg);
      sh(root, 'add', 'f');
      execFileSync('git', ['commit', '-q', '-m', msg], {
        cwd: root,
        env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
      });
    };
    commit('fix(#7): one', '2026-10-01T00:00:00Z');
    commit('fix(#7): two', '2026-10-02T00:00:00Z');
    commit('fix(#8): three', '2026-10-03T00:00:00Z');
    const m = readRepeatFixShare(root, 'main', TODAY);
    expect({ fixes: m.fixes, repeats: m.repeats }).toEqual({ fixes: 3, repeats: 1 });
    expect(m.share).toBeCloseTo(1 / 3);
    expect(readRepeatFixShare(root, 'no-such-ref', TODAY).share).toBeUndefined();
  });
});
