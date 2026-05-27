/**
 * T1 — Contract Tests: Parking-lot async functions
 *
 * Tests async exports from src/lib/parking-lot.ts that shell out to `gh` / `git`:
 *   - isGhAvailable()
 *   - getRepoFromRemote()
 *   - createGitHubIssue()
 *   - parkTopic()
 *
 * All child_process.execFile calls are mocked via vitest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: unknown, cb?: Function) => {
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
  createGitHubIssue,
  parkTopic,
  createParkingLotEntry,
  type ParkingLotEntry,
} from '../src/lib/parking-lot';

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

describe('getRepoFromRemote()', () => {
  it('parses SSH remote URL', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'git@github.com:harvest316/MinSpecPro.git\n', stderr: '' });
      },
    );

    const result = await getRepoFromRemote('/fake/root');
    expect(result).toBe('harvest316/MinSpecPro');
  });

  it('parses HTTPS remote URL', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'https://github.com/harvest316/MinSpecPro.git\n', stderr: '' });
      },
    );

    const result = await getRepoFromRemote('/fake/root');
    expect(result).toBe('harvest316/MinSpecPro');
  });

  it('returns null for non-GitHub remote', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'https://gitlab.com/owner/repo.git\n', stderr: '' });
      },
    );

    const result = await getRepoFromRemote('/fake/root');
    expect(result).toBeNull();
  });

  it('returns null when git command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('not a git repository'), { stdout: '', stderr: '' });
      },
    );

    const result = await getRepoFromRemote('/fake/root');
    expect(result).toBeNull();
  });
});

// ─── createGitHubIssue ──────────────────────────────────────────────────

describe('createGitHubIssue()', () => {
  const entry: ParkingLotEntry = {
    title: 'Consider caching',
    body: 'Spec lookups could be cached for performance',
    labels: ['idea', 'inbox'],
    sessionScope: 'Implement auth (minspec, feat)',
    createdAt: '2026-05-26T10:00:00.000Z',
  };

  it('returns issue URL on success', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: 'https://github.com/owner/repo/issues/99\n', stderr: '' });
      },
    );

    const url = await createGitHubIssue(entry, 'owner/repo');
    expect(url).toBe('https://github.com/owner/repo/issues/99');
  });

  it('passes correct arguments to gh issue create', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: 'https://github.com/owner/repo/issues/1\n', stderr: '' });
      },
    );

    await createGitHubIssue(entry, 'owner/repo');

    expect(calls[0]).toEqual(expect.arrayContaining([
      'issue', 'create',
      '--repo', 'owner/repo',
      '--title', 'Consider caching',
      '--label', 'idea,inbox',
    ]));

    // Body should contain the entry body and session scope
    const bodyIndex = calls[0].indexOf('--body');
    expect(bodyIndex).toBeGreaterThan(-1);
    const body = calls[0][bodyIndex + 1];
    expect(body).toContain('Spec lookups could be cached for performance');
    expect(body).toContain('Implement auth (minspec, feat)');
    expect(body).toContain('Parked automatically by MinSpec');
  });

  it('omits --label flag when labels are empty', async () => {
    const noLabelsEntry: ParkingLotEntry = {
      ...entry,
      labels: [],
    };

    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        calls.push(args as string[]);
        cb!(null, { stdout: 'https://github.com/owner/repo/issues/1\n', stderr: '' });
      },
    );

    await createGitHubIssue(noLabelsEntry, 'owner/repo');
    expect(calls[0]).not.toContain('--label');
  });

  it('returns null when gh command fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(new Error('not authenticated'), { stdout: '', stderr: '' });
      },
    );

    const url = await createGitHubIssue(entry, 'owner/repo');
    expect(url).toBeNull();
  });

  it('returns null when gh returns empty stdout', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const url = await createGitHubIssue(entry, 'owner/repo');
    expect(url).toBeNull();
  });
});

// ─── parkTopic ──────────────────────────────────────────────────────────

describe('parkTopic()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-park-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const entry: ParkingLotEntry = {
    title: 'Future idea',
    body: 'Some idea for later',
    labels: ['idea', 'inbox'],
    sessionScope: 'Current scope',
    createdAt: '2026-05-27T00:00:00.000Z',
  };

  it('uses GitHub when gh is available and repo is found', async () => {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        callIndex++;
        if (callIndex === 1) {
          // isGhAvailable: gh auth status
          cb!(null, { stdout: 'Logged in', stderr: '' });
        } else if (callIndex === 2) {
          // getRepoFromRemote: git remote get-url origin
          cb!(null, { stdout: 'git@github.com:owner/repo.git\n', stderr: '' });
        } else {
          // createGitHubIssue: gh issue create
          cb!(null, { stdout: 'https://github.com/owner/repo/issues/77\n', stderr: '' });
        }
      },
    );

    const result = await parkTopic(tmpDir, entry);
    expect(result.method).toBe('github');
    expect(result.url).toBe('https://github.com/owner/repo/issues/77');
    expect(result.filePath).toBeUndefined();
  });

  it('falls back to local file when gh is not available', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        // isGhAvailable fails
        cb!(new Error('gh not found'), { stdout: '', stderr: '' });
      },
    );

    const result = await parkTopic(tmpDir, entry);
    expect(result.method).toBe('file');
    expect(result.filePath).toBe(path.join(tmpDir, '.minspec', 'parking-lot.md'));
    expect(result.url).toBeUndefined();

    // Verify the file was actually created
    expect(fs.existsSync(result.filePath!)).toBe(true);
    const content = fs.readFileSync(result.filePath!, 'utf-8');
    expect(content).toContain('## Future idea');
  });

  it('falls back to local file when repo is not found', async () => {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        callIndex++;
        if (callIndex === 1) {
          // isGhAvailable succeeds
          cb!(null, { stdout: 'Logged in', stderr: '' });
        } else {
          // getRepoFromRemote: non-GitHub remote
          cb!(null, { stdout: 'https://gitlab.com/owner/repo.git\n', stderr: '' });
        }
      },
    );

    const result = await parkTopic(tmpDir, entry);
    expect(result.method).toBe('file');
    expect(result.filePath).toBeDefined();
  });

  it('falls back to local file when GitHub issue creation fails', async () => {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') cb = _opts as Function;
        callIndex++;
        if (callIndex === 1) {
          // isGhAvailable succeeds
          cb!(null, { stdout: 'Logged in', stderr: '' });
        } else if (callIndex === 2) {
          // getRepoFromRemote succeeds
          cb!(null, { stdout: 'git@github.com:owner/repo.git\n', stderr: '' });
        } else {
          // createGitHubIssue fails
          cb!(new Error('API error'), { stdout: '', stderr: '' });
        }
      },
    );

    const result = await parkTopic(tmpDir, entry);
    expect(result.method).toBe('file');
    expect(result.filePath).toBeDefined();
  });
});
