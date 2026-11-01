/**
 * #1163 — Accept ADR must not present an acceptance that reached no commit as a plain
 * success. `commitApprovalIfEnabled` flags every such outcome `stranded`; `acceptAdrCommand`
 * must then raise a warning (not the success toast) that names the uncommitted state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    tabGroups: undefined as unknown,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/adr-ws' } }],
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(() => Promise.resolve({})),
    getWorkspaceFolder: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

vi.mock('../src/lib/adr-manager', () => ({
  createAdr: vi.fn(),
  findSimilarAdrs: vi.fn(() => []),
  listAdrs: vi.fn(() => []),
  setAdrStatus: vi.fn(),
  adrHasFrontmatter: vi.fn(() => true),
  regenerateDrIndex: vi.fn(),
  validatePendingDrAmendments: vi.fn(() => []),
  ADR_STATUS_VALUES: ['proposed', 'accepted', 'deprecated', 'superseded'],
}));
vi.mock('../src/lib/approval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/approval')>()),
  gitConfigEmail: vi.fn(() => 'human@example.com'),
  canonicalSpecHash: vi.fn(() => 'hash'),
}));
vi.mock('../src/lib/approval-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/approval-store')>()),
  writeRecord: vi.fn(),
}));
vi.mock('../src/commands/commit-on-approve', () => ({
  commitApprovalIfEnabled: vi.fn(),
  commitBornIfUntracked: vi.fn(),
}));

import * as vscode from 'vscode';
import { acceptAdrCommand } from '../src/commands/adr';
import { listAdrs } from '../src/lib/adr-manager';
import { commitApprovalIfEnabled } from '../src/commands/commit-on-approve';

const WS = '/tmp/adr-ws';
const DR1 = `${WS}/docs/decisions/DR-001.md`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.workspace.getWorkspaceFolder).mockImplementation(
    (() => vscode.workspace.workspaceFolders?.[0]) as never,
  );
  vi.mocked(listAdrs).mockReturnValue([
    { id: 'DR-001', title: 'Use PG', status: 'proposed', date: '', filePath: DR1 },
  ] as never);
});

const node = { adr: { id: 'DR-001', status: 'proposed', filePath: DR1 } } as never;

describe('Accept ADR — stranded acceptance (#1163)', () => {
  it('warns, and shows no success toast, when the acceptance reached no commit', async () => {
    vi.mocked(commitApprovalIfEnabled).mockResolvedValueOnce({
      suffix: ' · NOT committed (on main — files left in your working tree)',
      stranded: true,
    });

    await acceptAdrCommand(node);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    const msg = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(msg).toContain('DR-001 → accepted');
    expect(msg).toContain('NOT committed');
  });

  it('keeps the plain success toast when the acceptance was committed', async () => {
    vi.mocked(commitApprovalIfEnabled).mockResolvedValueOnce({ suffix: ' · committed' });

    await acceptAdrCommand(node);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'MinSpec: DR-001 → accepted · committed',
    );
  });
});
