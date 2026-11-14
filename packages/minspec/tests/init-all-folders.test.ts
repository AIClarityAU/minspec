/**
 * #294 — multi-root Initialize SDD Structure offers "All uninitialized folders"
 * and no longer silently targets the active editor's folder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  folders: [] as string[],
  active: undefined as string | undefined,
  initialized: new Set<string>(),
}));

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showTextDocument: vi.fn(),
    get activeTextEditor() {
      return state.active ? { document: { uri: { fsPath: state.active } } } : undefined;
    },
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(),
    get workspaceFolders() {
      return state.folders.map((f) => ({ uri: { fsPath: f } }));
    },
  },
}));
vi.mock('../src/lib/scaffold', () => ({
  scaffold: vi.fn(),
  generateHarnessFiles: vi.fn(() => []),
  refreshHarnessFiles: vi.fn(() => []),
  rescaffoldManagedRegionFile: vi.fn(),
}));
vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolder: vi.fn(async () => '/ws/fallback'),
  workspaceFolderLabel: vi.fn((f: string) => f.split('/').pop()),
}));
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>();
  const existsSync = (p: unknown) =>
    typeof p === 'string' && p.endsWith('/.minspec/config.json')
      ? state.initialized.has(p.slice(0, -'/.minspec/config.json'.length))
      : actual.existsSync(p as string);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

import * as vscode from 'vscode';
import { initCommand, INIT_ALL_LABEL } from '../src/commands/init';
import { scaffold } from '../src/lib/scaffold';
import { resolveTargetFolder } from '../src/lib/resolve-folder';

describe('initCommand multi-root target selection (#294)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.folders = ['/ws/a', '/ws/b', '/ws/c'];
    state.active = undefined;
    state.initialized = new Set();
  });

  it('offers every folder plus "All uninitialized folders" and inits each uninitialized one', async () => {
    state.initialized = new Set(['/ws/c']);
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce((async (items: any[]) =>
      items.find((i) => i.label === INIT_ALL_LABEL)) as never);
    await initCommand();
    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
    expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c', INIT_ALL_LABEL]);
    expect(vi.mocked(scaffold).mock.calls.map((c) => c[0])).toEqual(['/ws/a', '/ws/b']);
  });

  it('asks even when an editor is focused, listing its folder first, and inits only the pick', async () => {
    state.active = '/ws/b/src/x.ts';
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce((async (items: any[]) =>
      items[0]) as never);
    await initCommand();
    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
    expect(items[0].label).toBe('b');
    expect(vi.mocked(scaffold).mock.calls.map((c) => c[0])).toEqual(['/ws/b']);
  });

  it('does nothing when the pick is dismissed', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
    await initCommand();
    expect(scaffold).not.toHaveBeenCalled();
    expect(resolveTargetFolder).not.toHaveBeenCalled();
  });

  it('omits the all-option path when fewer than 2 folders are uninitialized (falls back to the normal resolver)', async () => {
    state.initialized = new Set(['/ws/a', '/ws/b']);
    await initCommand();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: INIT_ALL_LABEL })]),
      expect.anything(),
    );
    expect(resolveTargetFolder).toHaveBeenCalled();
    expect(scaffold).toHaveBeenCalledWith('/ws/fallback');
  });

  it('an explicit folder argument never prompts', async () => {
    await initCommand('/ws/a');
    const asked = vi.mocked(vscode.window.showQuickPick).mock.calls.filter(
      (c) => (c[1] as any)?.placeHolder?.includes('select the project'),
    );
    expect(asked).toHaveLength(0);
    expect(scaffold).toHaveBeenCalledWith('/ws/a');
  });
});
