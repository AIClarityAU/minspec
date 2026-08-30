/**
 * commands/tidy-primary.ts (#1162) — the confirm-then-mutate surface over
 * `lib/tidy-primary.ts`'s classification. `lib/tidy-primary.ts` itself is
 * covered against real git fixtures in tidy-primary.test.ts; this file mocks
 * that module so it can pin the COMMAND's own branches (no workspace, off-
 * default-branch, missing origin ref, nothing redundant, a live peer sharing
 * the checkout, cancel, confirm) without needing a real repo per case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

vi.mock('../src/lib/tidy-primary', () => ({
  classifyPrimary: vi.fn(),
  tidyRedundantPaths: vi.fn(),
  otherLiveSessionsHere: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { tidyPrimaryCommand } from '../src/commands/tidy-primary';
import {
  classifyPrimary,
  tidyRedundantPaths,
  otherLiveSessionsHere,
  type PrimaryClassification,
} from '../src/lib/tidy-primary';

const mockedClassify = vi.mocked(classifyPrimary);
const mockedTidy = vi.mocked(tidyRedundantPaths);
const mockedPeers = vi.mocked(otherLiveSessionsHere);

function baseClassification(over: Partial<PrimaryClassification> = {}): PrimaryClassification {
  return {
    rootDir: '/ws',
    originRef: 'origin/main',
    defaultBranch: 'main',
    branch: 'main',
    onDefaultBranch: true,
    behind: 1,
    ahead: 0,
    redundant: [],
    orphans: [],
    ...over,
  };
}

describe('tidyPrimaryCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPeers.mockReturnValue([]);
  });

  it('warns and returns immediately when there is no workspace root', async () => {
    await tidyPrimaryCommand('');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no workspace folder'),
    );
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it('warns when the folder is not a git checkout', async () => {
    mockedClassify.mockReturnValue(null);
    await tidyPrimaryCommand('/ws');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not a git checkout'),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('informs (does not warn) when off the default branch, and never calls tidy', async () => {
    mockedClassify.mockReturnValue(baseClassification({ note: 'off-default-branch', branch: 'feature/x' }));
    await tidyPrimaryCommand('/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("on 'feature/x'"),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('informs when origin ref is missing locally, and never calls tidy', async () => {
    mockedClassify.mockReturnValue(baseClassification({ note: 'missing-origin-ref', originRef: null }));
    await tidyPrimaryCommand('/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('MinSpec never fetches'),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('reports clean-with-orphans when nothing is redundant but orphans remain', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({ orphans: [{ path: 'c.txt', kind: 'ORPHAN', existsLocally: true, existsUpstream: false }] }),
    );
    await tidyPrimaryCommand('/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 unlanded path'),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('reports fully clean when nothing is redundant and no orphans exist', async () => {
    mockedClassify.mockReturnValue(baseClassification());
    await tidyPrimaryCommand('/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('MinSpec: primary is clean — nothing to tidy.');
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('refuses when another live session shares this exact checkout, without prompting', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({ redundant: [{ path: 'a.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true }] }),
    );
    mockedPeers.mockReturnValue([
      {
        sessionId: 'peer',
        scope: 's',
        project: 'p',
        type: null,
        branch: 'main',
        worktreeRoot: '/ws',
        specIds: [],
        fileAllowlist: [],
        pid: 1,
        lastSeen: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      },
    ]);

    await tidyPrimaryCommand('/ws', 'self-session');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('other live session'));
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('discard'),
      expect.anything(),
      expect.anything(),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('#1714 refuses without prompting when peer presence is indeterminate (null), not just when peers are found', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({ redundant: [{ path: 'a.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true }] }),
    );
    // otherLiveSessionsHere returns null when it couldn't positively confirm
    // zero peers (missing/unreadable sessions dir, or a corrupt record) —
    // distinct from `[]`, which means it positively confirmed nobody's here.
    mockedPeers.mockReturnValue(null);

    await tidyPrimaryCommand('/ws', 'self-session');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("couldn't confirm"));
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('discard'),
      expect.anything(),
      expect.anything(),
    );
    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('cancelling the confirm dialog leaves everything untouched', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({ redundant: [{ path: 'a.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true }] }),
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined);

    await tidyPrimaryCommand('/ws');

    expect(mockedTidy).not.toHaveBeenCalled();
  });

  it('confirming calls tidyRedundantPaths with exactly the redundant paths, and reports the result', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({
        redundant: [
          { path: 'a.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true },
          { path: 'b.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true },
        ],
      }),
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Tidy');
    mockedTidy.mockReturnValue({ removed: ['a.txt', 'b.txt'], skipped: [] });

    await tidyPrimaryCommand('/ws');

    expect(mockedTidy).toHaveBeenCalledWith('/ws', ['a.txt', 'b.txt']);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('tidied 2 redundant path(s)'),
    );
  });

  it('reports skipped paths with a warning, not a plain info message', async () => {
    mockedClassify.mockReturnValue(
      baseClassification({
        redundant: [{ path: 'a.txt', kind: 'REDUNDANT', existsLocally: true, existsUpstream: true }],
      }),
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Tidy');
    mockedTidy.mockReturnValue({
      removed: [],
      skipped: [{ path: 'a.txt', reason: 'no longer classified REDUNDANT — left untouched' }],
    });

    await tidyPrimaryCommand('/ws');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 skipped'),
    );
  });
});
