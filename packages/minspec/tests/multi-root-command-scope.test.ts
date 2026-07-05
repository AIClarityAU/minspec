import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T0 regression: approval / validation / navigation commands must resolve their
 * root to the folder that CONTAINS the artifact they act on — not
 * `workspaceFolders?.[0]` (harvest316/minspec#373; residual of #123 which fixed
 * only the write/scaffold + activation call sites).
 *
 * Scenario: two-folder workspace where [0] = /tmp/root-a, [1] = /tmp/root-b, and
 * the user acts on a spec in root-b. Each command MUST see rootDir === /tmp/root-b.
 */

// ─── Shared vscode mock — two workspace folders, per-file getWorkspaceFolder ────
// (The literals /tmp/root-a and /tmp/root-b are inlined in the factory because
//  `vi.mock` is hoisted above module-level consts — see the vitest docs.)

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    tabGroups: { activeTabGroup: { activeTab: undefined } },
  },
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: '/tmp/root-a' } },
      { uri: { fsPath: '/tmp/root-b' } },
    ],
    getConfiguration: () => ({ get: () => undefined }),
    openTextDocument: vi.fn(),
    // The real VS Code walks workspaceFolders and returns the longest-prefix
    // match — mirror that so folderForFile() maps files under root-b to root-b,
    // not [0].
    getWorkspaceFolder: vi.fn((uri: { fsPath: string }) => {
      const p = uri.fsPath;
      const folders = [
        { uri: { fsPath: '/tmp/root-a' } },
        { uri: { fsPath: '/tmp/root-b' } },
      ];
      return folders.find(
        (f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + '/'),
      );
    }),
  },
  commands: { executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

const ROOT_A = '/tmp/root-a';
const ROOT_B = '/tmp/root-b';
const SPEC_IN_B = '/tmp/root-b/specs/minspec/SPEC-042/spec.md';

// ─── Command-specific lib mocks ────────────────────────────────────────────────

vi.mock('../src/views/spec-tree-provider', () => ({
  listSpecs: vi.fn(() => []),
}));
vi.mock('../src/lib/spec', () => ({
  readSpecFile: vi.fn(),
  setSpecStatus: vi.fn(),
}));
vi.mock('../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal()),
  loadConfig: vi.fn(() => ({})),
}));
vi.mock('../src/lib/spec-validator', () => ({
  validateSpec: vi.fn(() => ({
    specId: 'SPEC-042',
    tier: 'T2',
    complete: true,
    violations: [],
    detectedAspects: [],
    declaredAspects: [],
    effectiveAspects: [],
  })),
}));
vi.mock('../src/lib/epic-manager', () => ({
  epicRefSet: vi.fn(() => new Set<string>()),
  listEpics: vi.fn(() => []),
}));
vi.mock('../src/lib/adr-manager', () => ({ listAdrs: vi.fn(() => []) }));
vi.mock('../src/lib/approval', () => ({
  approveSpec: vi.fn(),
  revokeApproval: vi.fn(() => true),
  getApprovalStatus: vi.fn(() => 'unapproved'),
  gitConfigEmail: vi.fn(() => 't@example.com'),
}));
vi.mock('../src/lib/active-spec', () => ({
  resolveActiveSpecId: vi.fn(() => undefined),
}));
vi.mock('../src/lib/recent-approvables', () => ({
  recentApprovables: vi.fn(() => []),
}));

// ─── Imports (after all mocks are declared) ────────────────────────────────────

import { approveSpecCommand, revokeApprovalCommand } from '../src/commands/approve';
import { validateSpecCommand } from '../src/commands/validate';
import { readSpecFile } from '../src/lib/spec';
import { loadConfig } from '../src/lib/config';
import { epicRefSet } from '../src/lib/epic-manager';
import {
  approveSpec as recordApproval,
  revokeApproval as removeApproval,
  getApprovalStatus,
} from '../src/lib/approval';
import type { SpecSummary } from '../src/views/spec-tree-provider';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function specInRootB(): SpecSummary {
  return {
    id: 'SPEC-042',
    title: 'Multi-root',
    tier: 'T2',
    status: 'specifying',
    currentPhase: 'specify',
    filePath: SPEC_IN_B,
    phasesDone: 0,
    phasesTotal: 4,
  } as unknown as SpecSummary;
}

// =============================================================================

describe('multi-root: approval / validation commands (harvest316/minspec#373)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSpecFile).mockReturnValue(
      { frontmatter: { id: 'SPEC-042', status: 'specifying' } } as ReturnType<typeof readSpecFile>,
    );
  });

  it('approveSpecCommand uses root-b when the tree-node spec lives in root-b', async () => {
    await approveSpecCommand({ spec: specInRootB() });

    // Every root-scoped lookup must be against root-b, never root-a.
    expect(loadConfig).toHaveBeenCalledWith(ROOT_B);
    expect(loadConfig).not.toHaveBeenCalledWith(ROOT_A);
    expect(epicRefSet).toHaveBeenCalledWith(ROOT_B);
    expect(recordApproval).toHaveBeenCalledWith(
      ROOT_B,
      SPEC_IN_B,
      'T2',
      't@example.com',
    );
  });

  it('revokeApprovalCommand uses root-b when the tree-node spec lives in root-b', async () => {
    // Only 'approved' / 'stale' specs survive revoke's filter; force it.
    vi.mocked(getApprovalStatus).mockReturnValue('approved');
    await revokeApprovalCommand({ spec: specInRootB() });

    expect(removeApproval).toHaveBeenCalledWith(ROOT_B, SPEC_IN_B);
    expect(removeApproval).not.toHaveBeenCalledWith(ROOT_A, expect.anything());
  });

  it('validateSpecCommand uses root-b when the tree-node spec lives in root-b', async () => {
    await validateSpecCommand({ spec: specInRootB() });

    expect(loadConfig).toHaveBeenCalledWith(ROOT_B);
    expect(epicRefSet).toHaveBeenCalledWith(ROOT_B);
    // SPEC-022: validate.ts feeds the folder-scoped approval verdict.
    expect(getApprovalStatus).toHaveBeenCalledWith(ROOT_B, SPEC_IN_B);
    expect(getApprovalStatus).not.toHaveBeenCalledWith(ROOT_A, expect.anything());
  });
});
