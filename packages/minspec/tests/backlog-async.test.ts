/**
 * T1 — Contract Tests: Backlog async functions
 *
 * Tests async exports from src/lib/backlog.ts that shell out to `gh` / `git`:
 *   - isGhAvailable()
 *   - getRepoFromRemote()
 *   - fetchIssues()
 *   - applyWsjfToIssue()
 *   - transitionIssue()
 *   - setPriority()
 *
 * All child_process.execFile calls are mocked via vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: unknown, cb?: Function) => {
    // Handle both (cmd, args, cb) and (cmd, args, opts, cb) signatures
    if (typeof opts === 'function') {
      cb = opts as Function;
    }
    if (cb) {
      cb(null, { stdout: '', stderr: '' });
    }
  }),
}));

import { execFile } from 'child_process';
import {
  isGhAvailable,
  getRepoFromRemote,
  fetchIssues,
  applyWsjfToIssue,
  transitionIssue,
  setPriority,
  calculateWsjf,
  type WsjfScore,
} from '../src/lib/backlog';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecFile.mockReset();
  // Default: call callback with empty stdout
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], opts: unknown, cb?: Function) => {
      if (typeof opts === 'function') {
        cb = opts as Function;
      }
      if (cb) {
        cb(null, { stdout: '', stderr: '' });
      }
    },
  );
});

// ─── isGhAvailable ────────────────────────────────────────────────────────

describe('isGhAvailable()', () => {
  it('returns true when gh auth status succeeds', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'Logged in to github.com', stderr: '' });
      },
    );

    const result = await isGhAvailable();
    expect(result).toBe(true);

    // Verify correct command was called
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('returns false when gh auth status throws', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('gh not found'), { stdout: '', stderr: '' });
      },
    );

    const result = await isGhAvailable();
    expect(result).toBe(false);
  });
});

// ─── getRepoFromRemote ───────────────────────────────────────────────────

/**
 * #1545: `getRepoFromRemote` no longer runs `git remote get-url origin`. It reads
 * ALL remotes via `git config --get-regexp ^remote\..*\.url$` and resolves through
 * the shared `lib/git-remotes` primitive, so a repo whose remote is not named
 * `origin` stops reading as a repo with no remote at all. These fixtures therefore
 * carry git-config LINES (`remote.<name>.url <url>`) rather than a bare URL.
 */
describe('getRepoFromRemote()', () => {
  /** Reply to any execFile with `stdout`, honouring both callback signatures. */
  function replyWith(stdout: string): void {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout, stderr: '' });
      },
    );
  }

  it('parses SSH remote URL', async () => {
    replyWith('remote.origin.url git@github.com:harvest316/MinSpecPro.git\n');
    expect(await getRepoFromRemote('/fake/root')).toBe('harvest316/MinSpecPro');
  });

  it('parses HTTPS remote URL', async () => {
    replyWith('remote.origin.url https://github.com/harvest316/MinSpecPro.git\n');
    expect(await getRepoFromRemote('/fake/root')).toBe('harvest316/MinSpecPro');
  });

  it('resolves a sole remote that is NOT named origin (#1545)', async () => {
    // The reported bug: this used to return null, and MinSpec then told the user to
    // add a GitHub remote they had already added.
    replyWith('remote.voip-sms-inbox.url https://github.com/harvest316/voip-sms-inbox.git\n');
    expect(await getRepoFromRemote('/fake/root')).toBe('harvest316/voip-sms-inbox');
  });

  it('still prefers origin on a fork checkout, where remotes disagree by design', async () => {
    // origin = your fork, upstream = theirs. Unchanged from the pre-#1545
    // behaviour, and the case that proves the resolver did not get too clever.
    replyWith(
      [
        'remote.upstream.url https://github.com/up/stream.git',
        'remote.origin.url https://github.com/harvest316/MinSpecPro.git',
        '',
      ].join('\n'),
    );
    expect(await getRepoFromRemote('/fake/root')).toBe('harvest316/MinSpecPro');
  });

  it('returns null when UNRESOLVABLE remotes point at different repos', async () => {
    // No origin AND no agreement — genuinely no answer, so refuse rather than
    // target the wrong repository. (With an `origin` present this is NOT null; see
    // the fork-checkout case above.)
    replyWith(
      ['remote.a.url https://github.com/mine/r.git', 'remote.b.url https://github.com/theirs/r.git', ''].join(
        '\n',
      ),
    );
    expect(await getRepoFromRemote('/fake/root')).toBeNull();
  });

  it('returns null for non-GitHub remote', async () => {
    replyWith('remote.origin.url https://gitlab.com/owner/repo.git\n');
    expect(await getRepoFromRemote('/fake/root')).toBeNull();
  });

  it('returns null when git command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('not a git repository'), { stdout: '', stderr: '' });
      },
    );
    expect(await getRepoFromRemote('/fake/root')).toBeNull();
  });

  it('scopes the read to rootDir', async () => {
    await getRepoFromRemote('/my/project');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-C', '/my/project', 'config', '--get-regexp', '^remote\\..*\\.url$'],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ─── fetchIssues ─────────────────────────────────────────────────────────

describe('fetchIssues()', () => {
  it('returns parsed issues from gh output', async () => {
    const ghOutput: Array<{
      number: number;
      title: string;
      url: string;
      labels: { name: string }[];
      state: string;
      createdAt: string;
      updatedAt: string;
    }> = [
      {
        number: 42,
        title: 'Add WSJF scoring',
        url: 'https://github.com/owner/repo/issues/42',
        labels: [{ name: 'inbox' }, { name: 'P1' }, { name: 'wsjf:7.5' }],
        state: 'OPEN',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
      {
        number: 43,
        title: 'Fix typo',
        url: 'https://github.com/owner/repo/issues/43',
        labels: [{ name: 'triaged' }],
        state: 'OPEN',
        createdAt: '2026-01-03T00:00:00Z',
        updatedAt: '2026-01-03T00:00:00Z',
      },
    ];

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: JSON.stringify(ghOutput), stderr: '' });
      },
    );

    const issues = await fetchIssues('/fake/root');
    expect(issues).toHaveLength(2);

    // First issue — fully labeled
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe('Add WSJF scoring');
    expect(issues[0].labels).toEqual(['inbox', 'P1', 'wsjf:7.5']);
    expect(issues[0].lifecycleLabel).toBe('inbox');
    expect(issues[0].priorityLabel).toBe('P1');
    expect(issues[0].wsjfScore).toBe(7.5);

    // Second issue — minimal labels
    expect(issues[1].number).toBe(43);
    expect(issues[1].lifecycleLabel).toBe('triaged');
    expect(issues[1].priorityLabel).toBeNull();
    expect(issues[1].wsjfScore).toBeNull();
  });

  it('returns empty array when gh command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('gh not authenticated'), { stdout: '', stderr: '' });
      },
    );

    const issues = await fetchIssues('/fake/root');
    expect(issues).toEqual([]);
  });

  it('passes default options (open, limit 100)', async () => {
    await fetchIssues('/fake/root');
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['issue', 'list', '--state', 'open', '--limit', '100']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('passes custom options', async () => {
    await fetchIssues('/fake/root', { state: 'closed', limit: 50, label: 'bug' });
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--state', 'closed', '--limit', '50', '--label', 'bug']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns empty array on invalid JSON', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'not valid json', stderr: '' });
      },
    );

    const issues = await fetchIssues('/fake/root');
    expect(issues).toEqual([]);
  });
});

// ─── applyWsjfToIssue ───────────────────────────────────────────────────

describe('applyWsjfToIssue()', () => {
  const wsjf: WsjfScore = calculateWsjf({
    businessValue: 8,
    timeCriticality: 5,
    riskReduction: 3,
    jobSize: 4,
  });

  it('returns true on success', async () => {
    // First call: gh issue view (returns labels)
    // Subsequent calls: gh issue edit (remove old labels, add new), gh issue comment
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        callIndex++;
        if (callIndex === 1) {
          // gh issue view --json labels
          cb!(null, {
            stdout: JSON.stringify({ labels: [{ name: 'wsjf:3' }, { name: 'inbox' }] }),
            stderr: '',
          });
        } else {
          cb!(null, { stdout: '', stderr: '' });
        }
      },
    );

    const result = await applyWsjfToIssue('/fake/root', 42, wsjf);
    expect(result).toBe(true);
  });

  it('removes old wsjf labels before adding new one', async () => {
    const calls: string[][] = [];
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        callIndex++;
        if (callIndex === 1) {
          cb!(null, {
            stdout: JSON.stringify({ labels: [{ name: 'wsjf:2.5' }] }),
            stderr: '',
          });
        } else {
          cb!(null, { stdout: '', stderr: '' });
        }
      },
    );

    await applyWsjfToIssue('/fake/root', 10, wsjf);

    // Call 1: view labels
    expect(calls[0]).toEqual(expect.arrayContaining(['issue', 'view']));
    // Call 2: remove old wsjf label
    expect(calls[1]).toEqual(expect.arrayContaining(['--remove-label', 'wsjf:2.5']));
    // Call 3: add new wsjf label
    expect(calls[2]).toEqual(expect.arrayContaining(['--add-label', `wsjf:${wsjf.score}`]));
    // Call 4: post comment
    expect(calls[3]).toEqual(expect.arrayContaining(['issue', 'comment']));
  });

  it('returns false when gh command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('API rate limit'), { stdout: '', stderr: '' });
      },
    );

    const result = await applyWsjfToIssue('/fake/root', 42, wsjf);
    expect(result).toBe(false);
  });

  it('handles issue with no existing wsjf labels', async () => {
    const calls: string[][] = [];
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        callIndex++;
        if (callIndex === 1) {
          cb!(null, {
            stdout: JSON.stringify({ labels: [{ name: 'bug' }] }),
            stderr: '',
          });
        } else {
          cb!(null, { stdout: '', stderr: '' });
        }
      },
    );

    const result = await applyWsjfToIssue('/fake/root', 5, wsjf);
    expect(result).toBe(true);
    // Should be: view, add label, comment (no remove-label call)
    expect(calls).toHaveLength(3);
  });
});

// ─── transitionIssue ─────────────────────────────────────────────────────

describe('transitionIssue()', () => {
  it('removes old label and adds new label', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await transitionIssue('/fake/root', 42, 'inbox', 'triaged');
    expect(result).toBe(true);
    expect(calls[0]).toEqual(expect.arrayContaining([
      '--remove-label', 'inbox',
      '--add-label', 'triaged',
    ]));
  });

  it('only adds label when current label is null', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await transitionIssue('/fake/root', 42, null, 'inbox');
    expect(result).toBe(true);

    const issueArgs = calls[0];
    expect(issueArgs).toContain('--add-label');
    expect(issueArgs).not.toContain('--remove-label');
  });

  it('returns false when gh command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('network error'), { stdout: '', stderr: '' });
      },
    );

    const result = await transitionIssue('/fake/root', 42, 'inbox', 'triaged');
    expect(result).toBe(false);
  });

  it('passes issue number as string to gh', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    await transitionIssue('/fake/root', 99, 'wip', 'done');
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['issue', 'edit', '99']),
      expect.any(Object),
      expect.any(Function),
    );
  });
});

// ─── setPriority ─────────────────────────────────────────────────────────

describe('setPriority()', () => {
  it('removes old priority and adds new priority', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await setPriority('/fake/root', 42, 'P3', 'P1');
    expect(result).toBe(true);
    expect(calls[0]).toEqual(expect.arrayContaining([
      '--remove-label', 'P3',
      '--add-label', 'P1',
    ]));
  });

  it('only adds label when current priority is null', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await setPriority('/fake/root', 42, null, 'P2');
    expect(result).toBe(true);

    const issueArgs = calls[0];
    expect(issueArgs).toContain('--add-label');
    expect(issueArgs).not.toContain('--remove-label');
  });

  it('returns false when gh command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('not authenticated'), { stdout: '', stderr: '' });
      },
    );

    const result = await setPriority('/fake/root', 42, 'P1', 'P2');
    expect(result).toBe(false);
  });
});
