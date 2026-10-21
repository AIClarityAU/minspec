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

  it('rejects with the auth reason when gh command fails on auth (#2247)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(
          new Error('You are not logged into any GitHub hosts. Run gh auth login to authenticate.'),
          { stdout: '', stderr: '' },
        );
      },
    );

    // Must reject, not resolve to [] — an unreadable source (auth failure)
    // is not the same as a readable, empty one (#2247).
    await expect(fetchIssues('/fake/root')).rejects.toThrow(
      'GitHub CLI (gh) is not authenticated',
    );
  });

  // #2459 — the reason is chosen by matching gh's text, and the signed-out arm
  // used to match the bare substring `auth`. A repository, owner or label that
  // merely CONTAINS those letters then turned every failure naming it into
  // "run `gh auth login`": advice to fix something that is not broken.
  describe('reason classification matches what gh says, not a stray substring (#2459)', () => {
    const SIGNED_OUT = 'GitHub CLI (gh) is not authenticated';
    const RATE_LIMITED = 'GitHub API rate limit exceeded';
    const TIMED_OUT = 'gh command timed out';
    const NETWORK = 'network unreachable';
    const GENERIC = 'gh issue list failed: ';

    /** Make the mocked `gh` fail with `err`, and return the reason fetchIssues rejects with. */
    async function reasonFor(err: Error, label?: string): Promise<string> {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
          if (typeof _opts === 'function') cb = _opts as Function;
          cb!(err, { stdout: '', stderr: '' });
        },
      );
      try {
        await fetchIssues('/fake/root', label ? { label } : undefined);
      } catch (thrown) {
        return (thrown as Error).message;
      }
      throw new Error('fetchIssues resolved — it must reject when gh fails (#2247)');
    }

    /** An error shaped like the one Node's execFile produces for a non-zero exit. */
    function execFailure(commandLine: string, stderr: string): Error {
      return Object.assign(new Error(`Command failed: ${commandLine}\n${stderr}`), {
        code: 1,
        killed: false,
        stdout: '',
        stderr,
      });
    }

    // The four wordings below are the ones this repo already holds as gh
    // output: tests/approval-pr.test.ts, tests/drain-query-failure.test.ts and
    // tests/fixtures/drain-quota-signal/1060-dispatch-capture-1903.txt.
    it.each([
      ['signed out of every host', 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.'],
      ['never signed in', 'To get started with GitHub CLI, please run:  gh auth login'],
      ['a rejected token', 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com'],
      ['a bare HTTP 401', 'HTTP 401: Unauthorized (https://api.github.com/graphql)'],
      ['an older "not logged in" wording', 'error: not logged in to github.com'],
    ])('still reports signed-out for %s', async (_name, message) => {
      expect(await reasonFor(new Error(message))).toContain(SIGNED_OUT);
    });

    it('does not call a missing repository whose NAME contains "auth" a sign-in problem', async () => {
      const message =
        "GraphQL: Could not resolve to a Repository with the name 'acme/auth-service'. (repository)";
      const reason = await reasonFor(new Error(message));

      expect(reason).not.toContain(SIGNED_OUT);
      // The generic arm carries gh's own text, so the user sees what failed.
      expect(reason).toBe(`${GENERIC}${message}`);
    });

    it('does not call a repository named "authentication" a sign-in problem either', async () => {
      const message =
        "GraphQL: Could not resolve to a Repository with the name 'acme/authentication'. (repository)";

      expect(await reasonFor(new Error(message))).toBe(`${GENERIC}${message}`);
    });

    it('reports a SAML-protected organisation as neither signed-out nor rate-limited', async () => {
      // Mentions "OAuth" AND "403": the old classifier answered "run `gh auth
      // login`", and with only the auth arm narrowed it would have answered
      // "rate limit exceeded" instead. Neither is what went wrong.
      const message =
        'HTTP 403: Resource protected by organization SAML enforcement. ' +
        'You must grant your OAuth token access to this organization.';
      const reason = await reasonFor(new Error(message));

      expect(reason).not.toContain(SIGNED_OUT);
      expect(reason).not.toContain(RATE_LIMITED);
      expect(reason).toBe(`${GENERIC}${message}`);
    });

    it('does not read a number that merely contains 401 or 403 as an HTTP status', async () => {
      expect(await reasonFor(new Error('GraphQL: Could not resolve to an Issue with the number of 1401.')))
        .toContain(GENERIC);
      expect(await reasonFor(new Error('GraphQL: Could not resolve to an Issue with the number of 4035.')))
        .toContain(GENERIC);
    });

    it.each([
      ['the primary limit', 'GraphQL: API rate limit exceeded for user ID 1.'],
      ['the secondary limit, which arrives as a 403', 'HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'],
    ])('still reports rate limiting for %s', async (_name, message) => {
      expect(await reasonFor(new Error(message))).toContain(RATE_LIMITED);
    });

    it('does not call a repository named "timeout" or "network" a connectivity problem', async () => {
      const timeoutRepo =
        "GraphQL: Could not resolve to a Repository with the name 'acme/timeout-lib'. (repository)";
      const networkRepo =
        "GraphQL: Could not resolve to a Repository with the name 'acme/network-tools'. (repository)";

      expect(await reasonFor(new Error(timeoutRepo))).toBe(`${GENERIC}${timeoutRepo}`);
      expect(await reasonFor(new Error(networkRepo))).toBe(`${GENERIC}${networkRepo}`);
    });

    it.each([
      ['a killed child (execFile timeout)', Object.assign(new Error('Command failed: gh issue list'), { killed: true }), TIMED_OUT],
      ['a Go i/o timeout', new Error('Post "https://api.github.com/graphql": dial tcp 140.82.112.6:443: i/o timeout'), TIMED_OUT],
      ['a Go client timeout', new Error('Post "https://api.github.com/graphql": net/http: request canceled (Client.Timeout exceeded while awaiting headers)'), TIMED_OUT],
      ['an operation that timed out', new Error('connect: operation timed out'), TIMED_OUT],
      ['an unreachable network', new Error('dial tcp 140.82.112.6:443: connect: network is unreachable'), NETWORK],
      ['a refused connection', new Error('connect ECONNREFUSED 127.0.0.1:443'), NETWORK],
    ])('still reports %s', async (_name, err, expected) => {
      expect(await reasonFor(err)).toContain(expected);
    });

    it('classifies on gh\'s stderr, not on the command line Node echoes into the message', async () => {
      // execFile's message is "Command failed: <full command line>\n<stderr>",
      // so a `--label` the CALLER passed is in the text even when gh never
      // mentioned it. A label spelling a sign-out phrase must not decide the reason.
      const stderr = 'GraphQL: Something went wrong while executing your query. (issues)';
      const err = execFailure('gh issue list --state open --label gh auth login', stderr);
      const reason = await reasonFor(err, 'gh auth login');

      expect(reason).not.toContain(SIGNED_OUT);
      expect(reason).toContain(GENERIC);
      expect(reason).toContain(stderr);
    });

    it('reads a real sign-out from stderr when the error carries one', async () => {
      const err = execFailure(
        'gh issue list --state open --limit 100',
        'To get started with GitHub CLI, please run:  gh auth login',
      );

      expect(await reasonFor(err)).toContain(SIGNED_OUT);
    });

    it('falls back to the message when stderr is empty', async () => {
      const err = Object.assign(new Error('GraphQL: API rate limit exceeded for user ID 1.'), {
        stderr: '',
      });

      expect(await reasonFor(err)).toContain(RATE_LIMITED);
    });
  });

  it('rejects with a not-installed reason on ENOENT (#2247)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
        cb!(err, { stdout: '', stderr: '' });
      },
    );

    await expect(fetchIssues('/fake/root')).rejects.toThrow(
      'GitHub CLI (gh) is not installed',
    );
  });

  it('rejects with a network reason on ENOTFOUND (offline) (#2247)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('getaddrinfo ENOTFOUND api.github.com'), { stdout: '', stderr: '' });
      },
    );

    await expect(fetchIssues('/fake/root')).rejects.toThrow(
      'network unreachable',
    );
  });

  it('rejects with a rate-limit reason on rate limiting (#2247)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('API rate limit exceeded for user'), { stdout: '', stderr: '' });
      },
    );

    await expect(fetchIssues('/fake/root')).rejects.toThrow(
      'GitHub API rate limit exceeded',
    );
  });

  it('passes default options (open, limit 100)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: '[]', stderr: '' });
      },
    );

    await fetchIssues('/fake/root');
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['issue', 'list', '--state', 'open', '--limit', '100']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('passes custom options', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: '[]', stderr: '' });
      },
    );

    await fetchIssues('/fake/root', { state: 'closed', limit: 50, label: 'bug' });
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--state', 'closed', '--limit', '50', '--label', 'bug']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects with a parse-failure reason on invalid JSON (#2247)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'not valid json', stderr: '' });
      },
    );

    await expect(fetchIssues('/fake/root')).rejects.toThrow(
      'could not be parsed as JSON',
    );
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
