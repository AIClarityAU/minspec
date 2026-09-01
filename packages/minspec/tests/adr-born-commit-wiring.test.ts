/**
 * #1133 — wiring test for the Accept-ADR path's interaction with
 * `commitBornIfUntracked`.
 *
 * Before this fix, `applyStatus` (commands/adr.ts) called
 * `commitBornIfUntracked` as a bare, unassigned `await` — a `'protected-branch'`
 * outcome from it vanished with no console signal and no way for a future
 * reader to tell it was ever inspected. This proves two things the bug report
 * asked for:
 *
 *   1. `applyStatus` now CAPTURES the born-commit's result (does not discard
 *      the awaited promise outright) — asserted indirectly by proving the
 *      accept flow calls `commitBornIfUntracked` with the right arguments and
 *      keeps going, never treating its return value as a reason to bail out.
 *   2. A `'protected-branch'` outcome from the born-commit leg does NOT stop
 *      `setAdrStatus` / `regenerateDrIndex` / the funnel `commitApprovalIfEnabled`
 *      call from running — the funnel call is what shows the full, file-naming
 *      warning (see commit-on-approve.test.ts and approval-recover-wiring.test.ts
 *      for that half).
 *
 * Deliberately independent of adr-command.test.ts's larger mock surface, which
 * does not mock `./commit-on-approve` at all (its `commitOnApprove` config
 * default resolves falsy, so the real module no-ops before touching git). This
 * file mocks it directly so the wiring itself is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(async () => undefined),
    showQuickPick: vi.fn(),
    activeTextEditor: undefined as unknown,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/adr-ws' } }],
    getConfiguration: vi.fn(() => ({ get: (_k: string, def?: unknown) => def })),
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/tmp/adr-ws' } })),
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
  ADR_STATUS_VALUES: ['proposed', 'accepted', 'deprecated', 'superseded'],
}));

const commitBornIfUntrackedMock = vi.fn();
const commitApprovalIfEnabledMock = vi.fn();
vi.mock('../src/commands/commit-on-approve', () => ({
  commitBornIfUntracked: (...a: unknown[]) => commitBornIfUntrackedMock(...a),
  commitApprovalIfEnabled: (...a: unknown[]) => commitApprovalIfEnabledMock(...a),
}));

import { acceptAdrCommand } from '../src/commands/adr';
import { setAdrStatus, regenerateDrIndex } from '../src/lib/adr-manager';

const DR21 = '/tmp/adr-ws/docs/decisions/DR-021.md';

beforeEach(() => {
  vi.clearAllMocks();
  commitApprovalIfEnabledMock.mockResolvedValue({
    suffix: ' · NOT committed (on main — DR-021.md and INDEX.md left in your working tree)',
  });
});

describe('#1133 — applyStatus / commitBornIfUntracked wiring on Accept ADR', () => {
  it('calls commitBornIfUntracked with the DR path before flipping status', async () => {
    commitBornIfUntrackedMock.mockResolvedValue({ outcome: 'committed', paths: ['docs/decisions/DR-021.md'] });

    await acceptAdrCommand({ adr: { filePath: DR21, status: 'proposed', id: 'DR-021' } } as never);

    expect(commitBornIfUntrackedMock).toHaveBeenCalledWith(
      '/tmp/adr-ws',
      DR21,
      'chore(adr): add DR-021',
    );
    expect(setAdrStatus).toHaveBeenCalledWith(DR21, 'accepted');
  });

  it('a protected-branch outcome from the born commit does not stop the rest of the accept flow', async () => {
    commitBornIfUntrackedMock.mockResolvedValue({
      outcome: 'protected-branch',
      branch: { current: 'main', default: 'main' },
      paths: ['docs/decisions/DR-021.md'],
    });

    await acceptAdrCommand({ adr: { filePath: DR21, status: 'proposed', id: 'DR-021' } } as never);

    // The born-commit refusal is NOT treated as a reason to bail — status still
    // flips, the index still regenerates, and the funnel commit call (which
    // shows the real, file-naming warning) still runs.
    expect(setAdrStatus).toHaveBeenCalledWith(DR21, 'accepted');
    expect(regenerateDrIndex).toHaveBeenCalled();
    expect(commitApprovalIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(commitApprovalIfEnabledMock).toHaveBeenCalledWith(
      '/tmp/adr-ws',
      [DR21, '/tmp/adr-ws/docs/decisions/INDEX.md'],
      'chore(accept): DR-021 → accepted',
    );
  });

  it('a thrown/rejected born commit does not crash the accept — errors still surface via the normal catch', async () => {
    commitBornIfUntrackedMock.mockRejectedValue(new Error('boom'));

    await acceptAdrCommand({ adr: { filePath: DR21, status: 'proposed', id: 'DR-021' } } as never);

    // applyStatus wraps its whole body in try/catch — an unexpected rejection
    // from the born-commit leg surfaces as the same error toast every other
    // failure in this function uses, never an unhandled rejection.
    const vscode = await import('vscode');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'MinSpec: Failed to set status — boom',
    );
    expect(setAdrStatus).not.toHaveBeenCalled();
  });
});
