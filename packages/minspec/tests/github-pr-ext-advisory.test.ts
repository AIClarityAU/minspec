/**
 * T2 — GitHub Pull Requests extension advisory.
 *
 * Post-init, first-time-only nudge toward the official GitHub Pull Requests
 * and Issues extension: reviewing/merging PRs locally through it avoids the
 * messy history GitHub's browser-side "Rebase and merge" button can leave
 * behind. Mirrors offerRulesetAdvisory's consent shape: installing an
 * extension is a mutating, network-touching action, so it fires ONLY on the
 * user's explicit "Install" click.
 *
 * Contract cases:
 *   1. not a git repo         → no toast, zero vscode.extensions call.
 *   2. already installed      → SILENT (no toast at all).
 *   3. not installed           → exactly ONE toast offering Install/Not now/Learn more.
 *   4. "Install" clicked       → triggers the install, no further toast.
 *   5. "Learn more" clicked    → opens the Marketplace URL, no install.
 *   6. "Not now" / dismissed   → no install, no external open.
 *   7. a thrown failure is swallowed (best-effort, never breaks init).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}));

import * as vscode from 'vscode';
import {
  offerGitHubPrExtensionAdvisory,
  GITHUB_PR_EXTENSION_ID,
  GITHUB_PR_EXTENSION_MARKETPLACE_URL,
} from '../src/commands/init';

describe('offerGitHubPrExtensionAdvisory()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('not a git repo → no toast, no extensions lookup', async () => {
    await offerGitHubPrExtensionAdvisory('/tmp/ws', { isRepo: () => false });

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.extensions.getExtension).not.toHaveBeenCalled();
  });

  it('already installed → silent, no toast', async () => {
    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: (id) => id === GITHUB_PR_EXTENSION_ID,
    });

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('not installed → shows exactly one toast with Install/Not now/Learn more', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(undefined);

    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: () => false,
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    const [msg, ...actions] = vi.mocked(vscode.window.showInformationMessage).mock.calls[0];
    expect(msg).toContain('GitHub Pull Requests');
    expect(actions).toEqual(['Install', 'Not now', 'Learn more']);
  });

  it('"Install" clicked → triggers the injected install, no external open', async () => {
    const install = vi.fn(async () => undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Install');

    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: () => false,
      install,
    });

    expect(install).toHaveBeenCalledWith(GITHUB_PR_EXTENSION_ID);
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  it('default install path calls workbench.extensions.installExtension', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Install');

    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: () => false,
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.installExtension',
      GITHUB_PR_EXTENSION_ID,
    );
  });

  it('"Learn more" clicked → opens the Marketplace URL, no install', async () => {
    const install = vi.fn();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Learn more');

    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: () => false,
      install,
    });

    expect(install).not.toHaveBeenCalled();
    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
    const url = (vi.mocked(vscode.env.openExternal).mock.calls[0][0] as { toString(): string }).toString();
    expect(url).toBe(GITHUB_PR_EXTENSION_MARKETPLACE_URL);
  });

  it('"Not now" / dismiss → no install, no external open', async () => {
    const install = vi.fn();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Not now');

    await offerGitHubPrExtensionAdvisory('/tmp/ws', {
      isRepo: () => true,
      isInstalled: () => false,
      install,
    });

    expect(install).not.toHaveBeenCalled();
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  it('a thrown failure is swallowed (best-effort, never breaks init)', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockRejectedValueOnce(new Error('boom'));

    await expect(
      offerGitHubPrExtensionAdvisory('/tmp/ws', { isRepo: () => true, isInstalled: () => false }),
    ).resolves.toBeUndefined();
  });
});
