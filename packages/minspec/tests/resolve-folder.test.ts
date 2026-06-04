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
  },
}));

import * as vscode from 'vscode';
import { resolveTargetFolderNonInteractive } from '../src/lib/resolve-folder';

type MutableWorkspace = {
  workspaceFolders: { uri: { fsPath: string } }[] | undefined;
};
type MutableWindow = {
  activeTextEditor: { document: { uri: { fsPath: string } } } | undefined;
};

function setFolders(...paths: string[]): void {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders =
    paths.length === 0 ? undefined : paths.map(p => ({ uri: { fsPath: p } }));
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
