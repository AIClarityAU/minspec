import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────
// resolveTargetFolderNonInteractive reads workspace.workspaceFolders and
// window.activeTextEditor; it must never call showWorkspaceFolderPick.

vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    showWorkspaceFolderPick: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({ get: () => cfgDefault })),
  },
}));
let cfgDefault: string | undefined;

import * as vscode from 'vscode';
import { resolveTargetFolder, resolveTargetFolderNonInteractive, matchDefaultProject, initLastPickMemory } from '../src/lib/resolve-folder';

type MutableWorkspace = {
  workspaceFolders: { uri: { fsPath: string } }[] | undefined;
};
type MutableWindow = {
  activeTextEditor: { document: { uri: { fsPath: string } } } | undefined;
};

function setFolders(...paths: string[]): void {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders =
    paths.length === 0 ? undefined : paths.map(p => ({ name: p.split('/').pop(), uri: { fsPath: p } }));
}
function setActiveFile(fsPath: string | undefined): void {
  (vscode.window as unknown as MutableWindow).activeTextEditor =
    fsPath === undefined ? undefined : { document: { uri: { fsPath } } };
}

describe('resolveTargetFolderNonInteractive (#123 activation-safe resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFolders();
    setActiveFile(undefined);
  });

  it('returns empty string when no folder is open', () => {
    expect(resolveTargetFolderNonInteractive()).toBe('');
  });

  it('returns the only folder in a single-root workspace (unchanged behavior)', () => {
    setFolders('/repo/a');
    expect(resolveTargetFolderNonInteractive()).toBe('/repo/a');
  });

  it('targets the folder containing the active editor in a multi-root workspace', () => {
    setFolders('/repo/a', '/repo/b');
    setActiveFile('/repo/b/src/x.ts');
    expect(resolveTargetFolderNonInteractive()).toBe('/repo/b');
  });

  it('falls back to the first folder when no active editor (no prompt at activation)', () => {
    setFolders('/repo/a', '/repo/b');
    setActiveFile(undefined);
    expect(resolveTargetFolderNonInteractive()).toBe('/repo/a');
    // CRITICAL: activation must never pop a folder picker.
    expect(vscode.window.showWorkspaceFolderPick).not.toHaveBeenCalled();
  });

  it('falls back to the first folder when the active file is outside every folder', () => {
    setFolders('/repo/a', '/repo/b');
    setActiveFile('/somewhere/else/x.ts');
    expect(resolveTargetFolderNonInteractive()).toBe('/repo/a');
    expect(vscode.window.showWorkspaceFolderPick).not.toHaveBeenCalled();
  });
});

describe('resolveTargetFolder skip-picker (#299)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFolders('/repo/a', '/repo/b');
    setActiveFile(undefined);
    cfgDefault = undefined;
    initLastPickMemory(undefined);
  });

  it('uses minspec.defaultProject (by name) without prompting', async () => {
    cfgDefault = 'b';
    expect(await resolveTargetFolder()).toBe('/repo/b');
    expect(vscode.window.showWorkspaceFolderPick).not.toHaveBeenCalled();
  });

  it('active editor wins over the setting', async () => {
    cfgDefault = 'b';
    setActiveFile('/repo/a/x.ts');
    expect(await resolveTargetFolder()).toBe('/repo/a');
  });

  it('prompts once, then reuses the last pick', async () => {
    (vscode.window.showWorkspaceFolderPick as ReturnType<typeof vi.fn>).mockResolvedValue({
      uri: { fsPath: '/repo/a' },
    });
    expect(await resolveTargetFolder()).toBe('/repo/a');
    expect(await resolveTargetFolder()).toBe('/repo/a');
    expect(vscode.window.showWorkspaceFolderPick).toHaveBeenCalledTimes(1);
  });

  it('setting beats last pick; unmatched setting falls through to prompt', async () => {
    (vscode.window.showWorkspaceFolderPick as ReturnType<typeof vi.fn>).mockResolvedValue({
      uri: { fsPath: '/repo/a' },
    });
    await resolveTargetFolder();
    cfgDefault = 'b';
    expect(await resolveTargetFolder()).toBe('/repo/b');
    initLastPickMemory(undefined);
    cfgDefault = 'nope';
    await resolveTargetFolder();
    expect(vscode.window.showWorkspaceFolderPick).toHaveBeenCalledTimes(2);
  });

  it('restores the last pick from workspaceState; ignores a stale path', async () => {
    const mem = { get: vi.fn(() => '/repo/b'), update: vi.fn() };
    initLastPickMemory(mem as never);
    expect(await resolveTargetFolder()).toBe('/repo/b');
    mem.get.mockReturnValue('/gone');
    (vscode.window.showWorkspaceFolderPick as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    expect(await resolveTargetFolder()).toBeUndefined();
    expect(vscode.window.showWorkspaceFolderPick).toHaveBeenCalledTimes(1);
  });
});

describe('matchDefaultProject', () => {
  const fs = [{ name: 'A', fsPath: '/x/a' }, { name: 'B', fsPath: '/x/b' }];
  it('matches name, then path; empty/unmatched → undefined', () => {
    expect(matchDefaultProject(fs, 'B')).toBe('/x/b');
    expect(matchDefaultProject(fs, '/x/a')).toBe('/x/a');
    expect(matchDefaultProject(fs, ' ')).toBeUndefined();
    expect(matchDefaultProject(fs, 'C')).toBeUndefined();
    expect(matchDefaultProject(fs, undefined)).toBeUndefined();
  });
});
