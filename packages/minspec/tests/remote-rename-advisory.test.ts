/**
 * T2/T3 (#1545) — detect a remote that isn't called `origin`, and offer to fix it.
 *
 * `origin` is what `git clone` picks, not a rule git enforces. A user who runs
 * `git remote add <project-name> <url>` never gets one, and reported exactly that:
 * MinSpec told them to "add a GitHub remote" they had already added, and skipped the
 * [Create ruleset] offer it was otherwise able to make.
 *
 * Renaming the remote is worth more than teaching MinSpec to cope, because it repairs
 * every OTHER tool at the same time — including the scaffolded shell hook, which
 * cannot import a TypeScript resolver, and bare `git push`.
 *
 * The offer must stay narrow. Firing on an ambiguous setup is a prompt to break
 * something, so these tests pin the silence cases as hard as the offer case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}));

import * as vscode from 'vscode';
import { offerRemoteRenameAdvisory } from '../src/commands/init';
import type { CommandRunner } from '../src/lib/ruleset-advisor';

/** A runner answering `git config --get-regexp` with `lines`, and OK to everything else. */
function runnerFor(lines: string, declined = ''): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args.includes('--get-regexp')) return { code: 0, stdout: lines, stderr: '' };
    if (args.includes('--get') && args.includes('minspec.remoteRenameDeclined')) {
      return declined
        ? { code: 0, stdout: declined, stderr: '' }
        : { code: 1, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  return { run, calls };
}

const SOLE_MISNAMED = 'remote.voip-sms-inbox.url https://github.com/harvest316/voip-sms-inbox.git\n';

describe('offerRemoteRenameAdvisory() (#1545)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('not a git repo → no toast, no git call', async () => {
    const { run, calls } = runnerFor(SOLE_MISNAMED);
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => false });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('offers when the sole GitHub remote is not named origin', async () => {
    const { run } = runnerFor(SOLE_MISNAMED);
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("'voip-sms-inbox'"),
      'Rename to origin',
      'Keep as is',
    );
  });

  it('renames on click, and says so', async () => {
    const { run, calls } = runnerFor(SOLE_MISNAMED);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      'Rename to origin' as never,
    );
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });

    expect(calls).toContainEqual([
      '-C',
      '/tmp/ws',
      'remote',
      'rename',
      'voip-sms-inbox',
      'origin',
    ]);
    expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("renamed remote 'voip-sms-inbox' to 'origin'"),
    );
  });

  it('surfaces the real git error when the rename fails', async () => {
    // The usual cause is an `origin` that already exists — a generic "failed" would
    // leave the user with nothing to act on, which is the #1538 mistake in miniature.
    const calls: string[][] = [];
    const run: CommandRunner = vi.fn(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args.includes('--get-regexp')) return { code: 0, stdout: SOLE_MISNAMED, stderr: '' };
      if (args.includes('rename'))
        return { code: 128, stdout: '', stderr: "fatal: remote origin already exists.\n" };
      return { code: 1, stdout: '', stderr: '' };
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      'Rename to origin' as never,
    );

    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('remote origin already exists'),
    );
  });

  it('records a per-repo flag on "Keep as is" so it never nags again', async () => {
    const { run, calls } = runnerFor(SOLE_MISNAMED);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Keep as is' as never);
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });

    expect(calls).toContainEqual([
      '-C',
      '/tmp/ws',
      'config',
      'minspec.remoteRenameDeclined',
      'true',
    ]);
  });

  it('stays silent once declined', async () => {
    const { run } = runnerFor(SOLE_MISNAMED, 'true\n');
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('stays silent when the remote is already called origin', async () => {
    const { run } = runnerFor('remote.origin.url https://github.com/o/r.git\n');
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('stays silent for a non-GitHub remote', async () => {
    const { run } = runnerFor('remote.gl.url https://gitlab.com/o/r.git\n');
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('stays silent with several remotes — never guesses which to rename', async () => {
    const { run } = runnerFor(
      'remote.a.url https://github.com/o/r.git\nremote.b.url https://github.com/o2/r.git\n',
    );
    await offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('never throws when git does', async () => {
    const run: CommandRunner = vi.fn(async () => {
      throw new Error('git missing');
    });
    await expect(
      offerRemoteRenameAdvisory('/tmp/ws', { run, isRepo: () => true }),
    ).resolves.toBeUndefined();
  });
});
