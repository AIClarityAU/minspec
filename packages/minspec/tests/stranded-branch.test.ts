/**
 * SPEC-057 — stranded protected-branch detection. Drives an injected git stub;
 * no network, no repo mutation.
 */
import { describe, it, expect } from 'vitest';
import {
  probeStrandedBranch,
  StrandedNotifyTracker,
  buildStrandedAdvisory,
  pushStrandedBranch,
  type StrandedSignal,
} from '../src/lib/stranded-branch';
import type { GitRun } from '../src/lib/approve-commit';

interface World {
  current?: string; // '' / undefined => detached
  originHead?: string;
  upstreamAhead?: string | null; // null => no upstream configured
  originAhead?: string | null;
  sha?: string;
  log?: string;
  noRemote?: boolean;
  config?: Record<string, string>;
}

function stub(w: World, calls: string[][] = []): GitRun {
  return (args) => {
    calls.push([...args]);
    const a = args.join(' ');
    const fail = (): never => {
      throw new Error(`exit 1: ${a}`);
    };
    if (a.startsWith('config --get ')) {
      const key = args[2];
      if (key === 'remote.origin.url') return w.noRemote ? fail() : 'git@github.com:o/r.git';
      const v = w.config?.[key];
      return v === undefined ? fail() : v;
    }
    if (a === 'rev-parse --absolute-git-dir') return '/nonexistent-git-dir-spec057';
    if (a === 'symbolic-ref -q --short HEAD') return w.current ? w.current + '\n' : fail();
    if (a === 'symbolic-ref -q --short refs/remotes/origin/HEAD')
      return w.originHead ? `origin/${w.originHead}\n` : fail();
    if (a === 'rev-list --count @{u}..HEAD')
      return w.upstreamAhead == null ? fail() : w.upstreamAhead + '\n';
    if (a.startsWith('rev-list --count origin/'))
      return w.originAhead == null ? fail() : w.originAhead + '\n';
    if (a === 'rev-parse HEAD') return (w.sha ?? 'a'.repeat(40)) + '\n';
    if (args[0] === 'log') return w.log ?? 'abc1234\tfeat: x\n';
    return '';
  };
}

const NO_ENV: NodeJS.ProcessEnv = {};

describe('probeStrandedBranch', () => {
  it('AC-1: reports count + leading commits on protected default (upstream)', async () => {
    const r = await probeStrandedBranch(
      stub({
        current: 'main',
        originHead: 'main',
        upstreamAhead: '2',
        log: 'aaa1111\tfirst\nbbb2222\tsecond\n',
      }),
      NO_ENV,
    );
    expect(r).toMatchObject({
      branch: 'main',
      ahead: 2,
      commits: [
        { sha: 'aaa1111', subject: 'first' },
        { sha: 'bbb2222', subject: 'second' },
      ],
    });
  });

  it('AC-1: falls back to origin/<default> when no upstream', async () => {
    const calls: string[][] = [];
    const r = await probeStrandedBranch(
      stub({ current: 'main', originHead: 'main', upstreamAhead: null, originAhead: '3' }, calls),
      NO_ENV,
    );
    expect(r?.ahead).toBe(3);
    expect(calls.some((c) => c.join(' ') === 'rev-list --count origin/main..HEAD')).toBe(true);
  });

  it('AC-1: bounds leading commits to 5', async () => {
    const log = Array.from({ length: 9 }, (_, i) => `s${i}\tc${i}`).join('\n');
    const r = await probeStrandedBranch(
      stub({ current: 'main', originHead: 'main', upstreamAhead: '9', log }),
      NO_ENV,
    );
    expect(r?.ahead).toBe(9);
    expect(r?.commits).toHaveLength(5);
  });

  it('AC-1: zero ahead => no signal', async () => {
    expect(
      await probeStrandedBranch(stub({ current: 'main', originHead: 'main', upstreamAhead: '0' }), NO_ENV),
    ).toBeNull();
  });

  it('AC-1/INV-3: unresolvable count (no upstream, no origin ref) => no signal', async () => {
    expect(
      await probeStrandedBranch(
        stub({ current: 'main', originHead: 'main', upstreamAhead: null, originAhead: null }),
        NO_ENV,
      ),
    ).toBeNull();
  });

  it('AC-1: detached HEAD => no signal', async () => {
    expect(await probeStrandedBranch(stub({ current: '', originHead: 'main' }), NO_ENV)).toBeNull();
  });

  it('AC-1: no remote => no signal', async () => {
    expect(await probeStrandedBranch(stub({ current: 'main', noRemote: true, upstreamAhead: '2' }), NO_ENV)).toBeNull();
  });

  it('AC-1: honours minspec.protectedBranches fallback when origin/HEAD absent', async () => {
    const r = await probeStrandedBranch(
      stub({ current: 'master', upstreamAhead: '1' }),
      NO_ENV,
    );
    expect(r?.branch).toBe('master');
  });

  it('AC-7: feature branch ahead of its upstream => no signal', async () => {
    expect(
      await probeStrandedBranch(stub({ current: 'feat/x', originHead: 'main', upstreamAhead: '4' }), NO_ENV),
    ).toBeNull();
  });

  it('AC-5: non-approval commit subject still triggers', async () => {
    const r = await probeStrandedBranch(
      stub({ current: 'main', originHead: 'main', upstreamAhead: '1', log: 'ccc3333\tfix: unrelated\n' }),
      NO_ENV,
    );
    expect(r?.commits[0]?.subject).toBe('fix: unrelated');
  });

  it('AC-6/INV-4: independent of commitApprovalIfEnabled — a fresh probe sees pre-existing ahead state', async () => {
    const run = stub({ current: 'main', originHead: 'main', upstreamAhead: '1' });
    // Called twice with no commit-time call in between: each is a fresh git read.
    const calls: string[][] = [];
    const run2 = stub({ current: 'main', originHead: 'main', upstreamAhead: '1' }, calls);
    expect(await probeStrandedBranch(run, NO_ENV)).not.toBeNull();
    await probeStrandedBranch(run2, NO_ENV);
    await probeStrandedBranch(run2, NO_ENV);
    expect(calls.filter((c) => c.join(' ') === 'rev-list --count @{u}..HEAD')).toHaveLength(2);
  });

  it('documented bypass (MINSPEC_ALLOW_MAIN) => no signal, fail open', async () => {
    expect(
      await probeStrandedBranch(
        stub({ current: 'main', originHead: 'main', upstreamAhead: '2' }),
        { MINSPEC_ALLOW_MAIN: '1' },
      ),
    ).toBeNull();
  });

  it('INV-3: a runner that always throws resolves null, never rejects', async () => {
    const boom: GitRun = () => {
      throw new Error('git missing');
    };
    await expect(probeStrandedBranch(boom, NO_ENV)).resolves.toBeNull();
  });

  it('INV-1/INV-2: probe runs only read-only local git commands', async () => {
    const calls: string[][] = [];
    await probeStrandedBranch(
      stub({ current: 'main', originHead: 'main', upstreamAhead: '2' }, calls),
      NO_ENV,
    );
    const verbs = new Set(calls.map((c) => c[0]));
    for (const banned of ['checkout', 'switch', 'merge', 'rebase', 'reset', 'push', 'fetch', 'pull', 'branch']) {
      expect(verbs.has(banned)).toBe(false);
    }
  });
});

const SIG: StrandedSignal = {
  branch: 'main',
  ahead: 2,
  headSha: 'a'.repeat(40),
  commits: [
    { sha: 'aaa1111', subject: 'one' },
    { sha: 'bbb2222', subject: 'two' },
  ],
};

describe('StrandedNotifyTracker (FR-7 / AC-3)', () => {
  it('shows once per SHA, re-shows when SHA or count changes, and after clear()', () => {
    const t = new StrandedNotifyTracker();
    expect(t.shouldNotify(SIG)).toBe(true);
    expect(t.shouldNotify(SIG)).toBe(false);
    expect(t.shouldNotify({ ...SIG, headSha: 'b'.repeat(40), ahead: 3 })).toBe(true);
    expect(t.shouldNotify({ ...SIG, headSha: 'b'.repeat(40), ahead: 3 })).toBe(false);
    expect(t.shouldNotify({ ...SIG, headSha: 'b'.repeat(40), ahead: 4 })).toBe(true);
    t.clear();
    expect(t.shouldNotify({ ...SIG, headSha: 'b'.repeat(40), ahead: 4 })).toBe(true);
  });

  it('a new tracker (next session) shows again', () => {
    expect(new StrandedNotifyTracker().shouldNotify(SIG)).toBe(true);
    expect(new StrandedNotifyTracker().shouldNotify(SIG)).toBe(true);
  });
});

describe('buildStrandedAdvisory (FR-4, FR-5)', () => {
  it('names branch, count and leading subjects', () => {
    const a = buildStrandedAdvisory(SIG, 'prompt');
    expect(a.message).toContain("'main'");
    expect(a.message).toContain('2 local commits');
    expect(a.message).toContain('aaa1111 one');
    expect(a.offerPush).toBe(true);
    expect(a.pushWithoutClick).toBe(false);
  });

  it('never: advisory still renders, no push offered, manual hint included', () => {
    const a = buildStrandedAdvisory(SIG, 'never');
    expect(a.offerPush).toBe(false);
    expect(a.message).toContain('by hand');
  });

  it('always: standing setting is the consent', () => {
    expect(buildStrandedAdvisory(SIG, 'always').pushWithoutClick).toBe(true);
  });

  it('notes commits beyond the shown few; singular noun for 1', () => {
    expect(buildStrandedAdvisory({ ...SIG, ahead: 9 }, 'prompt').message).toContain('+7 more');
    expect(buildStrandedAdvisory({ ...SIG, ahead: 1, commits: [SIG.commits[0]!] }, 'prompt').message).toContain('1 local commit ');
  });
});

describe('pushStrandedBranch (AC-4)', () => {
  it('creates a branch at HEAD and pushes it; no checkout/switch/merge/rebase/reset', async () => {
    const calls: string[][] = [];
    const run: GitRun = (args) => {
      calls.push([...args]);
      const a = args.join(' ');
      if (a === 'rev-parse --is-inside-work-tree') return 'true\n';
      if (a === 'rev-parse --abbrev-ref HEAD') return 'main\n';
      if (a === 'remote get-url origin') return 'git@github.com:o/r.git\n';
      return '';
    };
    const r = await pushStrandedBranch('/x', SIG, run, new Date('2026-01-02T03:04:05.006Z'));
    expect(r.outcome).toBe('pushed-branch');
    expect(r.branch).toMatch(/^approvals\/stranded-/);
    const verbs = calls.map((c) => c[0]);
    expect(verbs).toContain('branch');
    expect(verbs).toContain('push');
    for (const banned of ['checkout', 'switch', 'merge', 'rebase', 'reset']) {
      expect(verbs).not.toContain(banned);
    }
    expect(calls.find((c) => c[0] === 'branch' && c[2] === 'HEAD')).toBeTruthy();
  });
});
