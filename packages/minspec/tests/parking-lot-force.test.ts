/**
 * T2 — Feature: park-topic force + dedup-hit choice (issue harvest316/minspec#136)
 *
 * Builds on the #24 dedup gate. #24 made `parkTopic` silently REUSE an existing
 * open issue when the normalized title matches. #136 adds the missing Scope 4:
 *
 *   1. A `force` path that BYPASSES the dedup gate and always creates — both on
 *      the GitHub path and the file-fallback path.
 *   2. A dedup-HIT choice surfaced to the command layer: open existing / comment
 *      on existing / force-create new.
 *
 * This file covers the library contract (parkTopic force, commentOnIssue) and the
 * command-layer choice UX (parkCommand quick-pick). All `gh`/`git` shell-outs go
 * through child_process.execFile, which is mocked — no network, no live repo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Library-level tests: parkTopic(force) + commentOnIssue ─────────────────
// These mock child_process directly (same pattern as parking-lot-dedup.test.ts).

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], opts: unknown, cb?: Function) => {
      if (typeof opts === 'function') cb = opts as Function;
      if (cb) cb(null, { stdout: '', stderr: '' });
    },
  ),
}));

import { execFile } from 'child_process';
import {
  parkTopic,
  commentOnIssue,
  type ParkingLotEntry,
} from '../src/lib/parking-lot';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

interface Scenario {
  ghAuth?: { ok: boolean };
  remote?: string;
  issueListJson?: string;
  issueListThrows?: boolean;
  createUrl?: string;
  commentThrows?: boolean;
}

function installMock(scenario: Scenario): {
  createCalls: string[][];
  listCalls: string[][];
  commentCalls: string[][];
} {
  const createCalls: string[][] = [];
  const listCalls: string[][] = [];
  const commentCalls: string[][] = [];

  mockExecFile.mockImplementation(
    (cmd: string, args: string[], opts: unknown, cb?: Function) => {
      if (typeof opts === 'function') cb = opts as Function;
      const done = cb as Function;

      if (cmd === 'git' && args[0] === 'remote') {
        return done(null, {
          stdout: (scenario.remote ?? 'git@github.com:owner/repo.git') + '\n',
          stderr: '',
        });
      }

      if (cmd === 'gh' && args[0] === 'auth') {
        if (scenario.ghAuth?.ok === false) {
          return done(new Error('not authenticated'), { stdout: '', stderr: '' });
        }
        return done(null, { stdout: 'Logged in', stderr: '' });
      }

      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        listCalls.push(args as string[]);
        if (scenario.issueListThrows) {
          return done(new Error('network error'), { stdout: '', stderr: '' });
        }
        return done(null, { stdout: scenario.issueListJson ?? '[]', stderr: '' });
      }

      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'create') {
        createCalls.push(args as string[]);
        return done(null, {
          stdout: (scenario.createUrl ?? 'https://github.com/owner/repo/issues/1') + '\n',
          stderr: '',
        });
      }

      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'comment') {
        commentCalls.push(args as string[]);
        if (scenario.commentThrows) {
          return done(new Error('comment failed'), { stdout: '', stderr: '' });
        }
        return done(null, {
          stdout: 'https://github.com/owner/repo/issues/10#issuecomment-1\n',
          stderr: '',
        });
      }

      return done(null, { stdout: '', stderr: '' });
    },
  );

  return { createCalls, listCalls, commentCalls };
}

function entry(title: string, body = 'some body'): ParkingLotEntry {
  return {
    title,
    body,
    labels: ['idea', 'inbox'],
    sessionScope: 'Current scope',
    createdAt: '2026-06-04T00:00:00.000Z',
  };
}

let tmpDir: string;

beforeEach(() => {
  mockExecFile.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-force-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── parkTopic — force bypasses the dedup gate (GitHub path) ────────────────

describe('parkTopic({ force }) — GitHub path', () => {
  it('force creates a new issue even when a matching open issue exists', async () => {
    // A matching issue exists — without force this would dedup. With force the
    // gate is bypassed and a brand-new issue is created. The list lookup must be
    // skipped entirely.
    const m = installMock({
      issueListJson: JSON.stringify([
        { number: 10, title: 'foo', url: 'https://github.com/owner/repo/issues/10' },
      ]),
      createUrl: 'https://github.com/owner/repo/issues/20',
    });

    const r = await parkTopic(tmpDir, entry('foo'), { force: true });

    expect(r.method).toBe('github');
    expect(r.url).toBe('https://github.com/owner/repo/issues/20');
    expect(r.deduped).toBeFalsy();
    expect(m.createCalls.length).toBe(1);
    // Dedup lookup must NOT run when forcing.
    expect(m.listCalls.length).toBe(0);
  });

  it('without force, a matching open issue still dedups (regression guard)', async () => {
    const m = installMock({
      issueListJson: JSON.stringify([
        { number: 10, title: 'foo', url: 'https://github.com/owner/repo/issues/10' },
      ]),
    });

    const r = await parkTopic(tmpDir, entry('foo'));

    expect(r.deduped).toBe(true);
    expect(r.url).toBe('https://github.com/owner/repo/issues/10');
    expect(m.createCalls.length).toBe(0);
  });
});

// ─── parkTopic — force bypasses the dedup gate (file fallback path) ─────────

describe('parkTopic({ force }) — file fallback path', () => {
  it('force appends a second block even when the heading already exists', async () => {
    installMock({ ghAuth: { ok: false } });

    const r1 = await parkTopic(tmpDir, entry('foo'));
    expect(r1.method).toBe('file');

    // Force the same title again — without force this dedups to one block.
    const r2 = await parkTopic(tmpDir, entry('foo'), { force: true });
    expect(r2.method).toBe('file');
    expect(r2.deduped).toBeFalsy();

    const content = fs.readFileSync(
      path.join(tmpDir, '.minspec', 'parking-lot.md'),
      'utf-8',
    );
    const headingCount = (content.match(/^## /gm) || []).length;
    expect(headingCount).toBe(2);
  });
});

// ─── commentOnIssue — injectable, mockable, no network ──────────────────────

describe('commentOnIssue()', () => {
  it('shells out to `gh issue comment` and returns true on success', async () => {
    const m = installMock({});

    const ok = await commentOnIssue(
      'https://github.com/owner/repo/issues/10',
      'a comment body',
      'owner/repo',
    );

    expect(ok).toBe(true);
    expect(m.commentCalls.length).toBe(1);
    // The issue URL/number and the body must be passed through.
    const args = m.commentCalls[0];
    expect(args).toContain('comment');
    expect(args).toContain('https://github.com/owner/repo/issues/10');
    expect(args).toContain('a comment body');
  });

  it('returns false (never throws) when the comment call fails', async () => {
    installMock({ commentThrows: true });

    const ok = await commentOnIssue(
      'https://github.com/owner/repo/issues/10',
      'body',
      'owner/repo',
    );

    expect(ok).toBe(false);
  });
});
