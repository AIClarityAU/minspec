import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===========================================================================
// extension-extra.test.ts
//
// Companion to extension.test.ts. The base test exercises command wiring,
// watchers, drift detection and first-run. This file targets the regions
// that base test leaves uncovered (reported by `vitest --coverage`):
//
//   • lines 379-399 — the `autoClassifyOnCommit` git watcher block
//   • lines 447-481 — resolveSpecFrontmatter recursive walk (via injectContext)
//   • lines 550-551 — removeContextCommand early-return when no workspace
//
// It uses its OWN isolated module mocks (Vitest scopes vi.mock per file), so
// it can stub auto-bootstrap, which the base harness leaves real, and drive
// each branch deterministically.
//
// It also holds the activation cases for SPEC-086, which removed the
// ScroogeLLM bridge this file used to mock: an installation that still has the
// bridge's stored state and settings, and the manifest-to-registration parity
// that shows a command was removed from both sides.
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const registeredCommands = new Map<string, (...args: any[]) => any>();
let subscriptions: any[] = [];

const mockSpecTreeProvider = { refresh: vi.fn(), setExpansionMemory: vi.fn(), epicGrouping: { set: vi.fn(), toggle: vi.fn(() => true) } };
const mockAdrTreeProvider = { refresh: vi.fn(), setExpansionMemory: vi.fn(), epicGrouping: { set: vi.fn(), toggle: vi.fn(() => true) } };
const mockBacklogTreeProvider = { refresh: vi.fn(), refreshIfStale: vi.fn(), setExpansionMemory: vi.fn(), epicGrouping: { set: vi.fn(), toggle: vi.fn(() => true) } };
const mockNextTaskStatusBar = { update: vi.fn(), dispose: vi.fn() };
const mockScaffoldCommitStatusBar = { update: vi.fn(), dispose: vi.fn() };
const mockTidyPrimaryStatusBar = { update: vi.fn(), dispose: vi.fn() };
const mockSpecPanel = { show: vi.fn(), refresh: vi.fn(), dispose: vi.fn() };
const mockCodeLensProvider = { refresh: vi.fn() };
const mockSpecFileLensProvider = { refresh: vi.fn() };

// File watcher factory — captures onDid* callbacks so tests can fire them.
const makeWatcher = () => ({
  onDidChange: vi.fn(),
  onDidCreate: vi.fn(),
  onDidDelete: vi.fn(),
  dispose: vi.fn(),
});

// Each createFileSystemWatcher call gets its own fresh watcher; we keep them
// all so a test can reach the git watcher (created last, conditionally).
let createdWatchers: ReturnType<typeof makeWatcher>[] = [];

// Config the activation reads. Tests mutate this object before calling
// activate() to flip autoClassifyOnCommit etc.
let configValues: Record<string, any> = {};

// Every settings key activation asked for, in order. A test can then say that a
// key was NOT read, which the value returned for it cannot show.
let configKeysRead: string[] = [];

// The onDidChangeConfiguration listener activate() registers, captured so the
// live-toggle regression test (#203) can fire it without a window reload.
let configChangeHandler: ((e: any) => void) | undefined;

// ---------------------------------------------------------------------------
// vscode mock
// ---------------------------------------------------------------------------

vi.mock('vscode', () => ({
  window: {
    createTreeView: vi.fn(() => ({
      dispose: vi.fn(),
      onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
      onDidExpandElement: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCollapseElement: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    onDidChangeWindowState: vi.fn(() => ({ dispose: vi.fn() })),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
    showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    showInputBox: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/test-workspace' } }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: any) => {
        configKeysRead.push(key);
        return Object.prototype.hasOwnProperty.call(configValues, key)
          ? configValues[key]
          : def;
      }),
    })),
    createFileSystemWatcher: vi.fn(() => {
      const w = makeWatcher();
      createdWatchers.push(w);
      return w;
    }),
    openTextDocument: vi.fn(() => Promise.resolve({})),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    textDocuments: [],
    onDidChangeConfiguration: vi.fn((handler: (e: any) => void) => {
      configChangeHandler = handler;
      return { dispose: vi.fn() };
    }),
    // #549: activate() subscribes to re-scan the trees on folder-set changes.
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: any[]) => any) => {
      registeredCommands.set(id, handler);
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
  },
  languages: {
    registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    createDiagnosticCollection: vi.fn(() => ({
      set: vi.fn(),
      delete: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  extensions: {
    getExtension: vi.fn(() => undefined),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  TreeItem: class {
    constructor(public label: string, public collapsibleState: number) {}
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    parse: (s: string) => ({ toString: () => s }),
  },
  ViewColumn: { Beside: 2 },
  RelativePattern: class {
    constructor(public base: any, public pattern: string) {}
  },
}));

// ---------------------------------------------------------------------------
// Lib / view mocks
// ---------------------------------------------------------------------------

vi.mock('../src/commands/init', () => ({
  initCommand: vi.fn(),
  initRefreshCommand: vi.fn(),
  commitHarnessRefreshCommand: vi.fn(),
  collectDirtyScaffoldPaths: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/commands/classify', () => ({ classifyCommand: vi.fn() }));
vi.mock('../src/commands/status', () => ({ statusCommand: vi.fn(() => vi.fn()) }));
vi.mock('../src/commands/session', () => ({ declareScopeCommand: vi.fn() }));
vi.mock('../src/commands/park', () => ({ parkCommand: vi.fn() }));
vi.mock('../src/commands/example', () => ({ generateExampleCommand: vi.fn() }));
vi.mock('../src/commands/migrate', () => ({ migrateLayoutCommand: vi.fn() }));
vi.mock('../src/commands/adr', () => ({
  createAdrCommand: vi.fn(),
  regenerateDrIndexCommand: vi.fn(),
  acceptAdrCommand: vi.fn(),
  setAdrStatusCommand: vi.fn(),
}));
vi.mock('../src/commands/epic', () => ({
  createEpicCommand: vi.fn(),
  regenerateEpicIndexCommand: vi.fn(),
  acceptEpicCommand: vi.fn(),
}));
vi.mock('../src/commands/backfill-epics', () => ({ backfillEpicsCommand: vi.fn() }));
vi.mock('../src/lib/adr-manager', () => ({ regenerateDrIndex: vi.fn() }));
vi.mock('../src/commands/backlog', () => ({ scoreWsjfCommand: vi.fn(), triageIssueCommand: vi.fn() }));
vi.mock('../src/commands/approve', () => ({ approveSpecCommand: vi.fn(), revokeApprovalCommand: vi.fn() }));
vi.mock('../src/commands/validate', () => ({ validateSpecCommand: vi.fn() }));
vi.mock('../src/views/spec-tree-provider', () => ({
  SpecTreeProvider: vi.fn(function () { return mockSpecTreeProvider; }),
}));
vi.mock('../src/views/adr-tree-provider', () => ({
  AdrTreeProvider: vi.fn(function () { return mockAdrTreeProvider; }),
}));
vi.mock('../src/views/backlog-view', () => ({
  BacklogTreeProvider: vi.fn(function () { return mockBacklogTreeProvider; }),
}));
vi.mock('../src/views/frontmatter-completion', () => ({
  FrontmatterCompletionProvider: vi.fn(function () { return {}; }),
}));
// Partial mock: stub the status-bar classes and forward the module's other real
// exports. `fromFrontmatter` moved to `lib/spec-progress` in SPEC-040 FR-5 and is
// no longer mocked here at all, so injectContext still derives currentPhase from
// spec frontmatter via the real helper.
vi.mock('../src/views/status-bar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/views/status-bar')>()),
  MinSpecNextTaskStatusBar: vi.fn(function () { return mockNextTaskStatusBar; }),
  MinSpecScaffoldCommitStatusBar: vi.fn(function () { return mockScaffoldCommitStatusBar; }),
  MinSpecTidyPrimaryStatusBar: vi.fn(function () { return mockTidyPrimaryStatusBar; }),
}));
vi.mock('../src/commands/next-task', () => ({
  nextTaskCommand: vi.fn(() => vi.fn()),
  computeNextTask: vi.fn(() => null),
}));
vi.mock('../src/views/spec-panel', () => ({
  SpecPanel: vi.fn(function () { return mockSpecPanel; }),
}));
vi.mock('../src/views/codelens-provider', () => ({
  MinSpecCodeLensProvider: vi.fn(function () { return mockCodeLensProvider; }),
  MinSpecSpecFileLensProvider: vi.fn(function () { return mockSpecFileLensProvider; }),
  goToSpecCommand: vi.fn(),
  goToCodeCommand: vi.fn(),
  linkToSpecCommand: vi.fn(),
}));
// Partial mock: stub loaders, forward real exports.
vi.mock('../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/config')>()),
  loadConfig: vi.fn(() => ({ specsDir: 'specs' })),
  resolveAndValidate: vi.fn((root: string, sub: string) => `${root}/${sub}`),
}));
vi.mock('../src/lib/session', () => ({
  loadSession: vi.fn(() => null),
  saveSession: vi.fn(),
  addToScope: vi.fn((session: any) => session),
  isFileInScope: vi.fn(() => true),
}));
vi.mock('../src/lib/tool-detector', () => ({
  detectTools: vi.fn(() => ({})),
  getToolFilePath: vi.fn(() => ''),
}));
vi.mock('../src/lib/context-injector', () => ({
  injectContextToFile: vi.fn(),
  removeContextFromFile: vi.fn(),
}));
vi.mock('../src/lib/parking-lot', () => ({
  parkTopic: vi.fn(() => Promise.resolve({ method: 'file', filePath: '/tmp/test' })),
  createParkingLotEntry: vi.fn(() => ({})),
}));
vi.mock('../src/lib/active-spec', () => ({
  findActiveSpec: vi.fn(() => Promise.resolve(null)),
  trackActiveSpecEditor: vi.fn(),
}));
vi.mock('../src/lib/active-adr', () => ({
  trackActiveAdrEditor: vi.fn(),
}));
vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolderNonInteractive: vi.fn(() => '/tmp/test-workspace'),
}));
// Auto-bootstrap stubbed: runBootstrap is a no-op promise; isWatchedGitPath
// uses the real predicate so the git-watcher filter is exercised honestly.
vi.mock('../src/lib/auto-bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auto-bootstrap')>()),
  runBootstrap: vi.fn(() => Promise.resolve()),
}));
// Partial mock: stub parseSpec, forward real exports.
vi.mock('../src/lib/spec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/spec')>()),
  parseSpec: vi.fn(() => ({ frontmatter: { id: 'SPEC-000' } })),
}));
vi.mock('fs');
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return actual;
});

// ---------------------------------------------------------------------------
// SUT + mocked-import handles
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { activate } from '../src/extension';
import { detectTools, getToolFilePath } from '../src/lib/tool-detector';
import { injectContextToFile, removeContextFromFile } from '../src/lib/context-injector';
import { parseSpec } from '../src/lib/spec';
import { loadConfig, resolveAndValidate } from '../src/lib/config';
import { createEpicCommand, acceptEpicCommand, regenerateEpicIndexCommand } from '../src/commands/epic';
import { backfillEpicsCommand } from '../src/commands/backfill-epics';
import { acceptAdrCommand, setAdrStatusCommand, regenerateDrIndexCommand } from '../src/commands/adr';
import { approveSpecCommand, revokeApprovalCommand } from '../src/commands/approve';
import { validateSpecCommand } from '../src/commands/validate';
import { migrateLayoutCommand } from '../src/commands/migrate';
import { parkCommand } from '../src/commands/park';
import { regenerateDrIndex } from '../src/lib/adr-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContext(overrides: Partial<Record<string, any>> = {}) {
  return {
    extensionUri: { fsPath: '/tmp/ext' },
    subscriptions,
    globalState: { get: vi.fn(() => undefined), update: vi.fn() },
    workspaceState: { get: vi.fn((_k: string, def: any) => def), update: vi.fn() },
    // SPEC-026 FR-11: activate() sets MINSPEC_SESSION_ID via this collection.
    environmentVariableCollection: { replace: vi.fn(), append: vi.fn(), prepend: vi.fn(), delete: vi.fn(), clear: vi.fn() },
    ...overrides,
  } as unknown as vscode.ExtensionContext;
}

function invokeCommand(id: string, ...args: any[]): any {
  const handler = registeredCommands.get(id);
  if (!handler) throw new Error(`Command "${id}" was never registered`);
  return handler(...args);
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredCommands.clear();
  subscriptions = [];
  createdWatchers = [];
  configValues = {};
  configKeysRead = [];
  configChangeHandler = undefined;

  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readdirSync as any).mockReturnValue([]);
});

// ===========================================================================
// Auto-classify-on-commit git watcher (lines 379-399)
// ===========================================================================

describe('auto-classify git watcher', () => {
  it('does NOT create a git watcher when autoClassifyOnCommit is disabled (default)', () => {
    configValues = {}; // autoClassifyOnCommit defaults to false
    activate(makeMockContext());

    // 5 standard watchers (specs, adrs, traceability, approvals, epics), no git watcher.
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(5);
  });

  it('creates a git watcher and fires classify only for watched git paths when enabled', () => {
    configValues = { autoClassifyOnCommit: true };
    activate(makeMockContext());

    // The git watcher is the 6th (index 5) created (5 standard + git).
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(6);
    const gitWatcher = createdWatchers[5];
    expect(gitWatcher.onDidChange).toHaveBeenCalled();
    expect(gitWatcher.onDidCreate).toHaveBeenCalled();

    const trigger = gitWatcher.onDidChange.mock.calls[0][0] as (u: any) => void;

    // The commit watcher fires classify in AUTO mode — passive, no toast (#216).
    const AUTO = { auto: true };

    // A non-watched path (e.g. .git/config) must be ignored.
    trigger({ fsPath: '/tmp/test-workspace/.git/config' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'minspec.classify',
      '/tmp/test-workspace',
      AUTO,
    );

    // A watched path (.git/HEAD) triggers the classify command in auto mode.
    trigger({ fsPath: '/tmp/test-workspace/.git/HEAD' });
    // #302: classify is invoked WITH the resolved folder (never folder-less /
    // `undefined`, which would let classifyCommand fall through to the
    // interactive project picker) AND in auto mode (passive, no toast).
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'minspec.classify',
      '/tmp/test-workspace',
      AUTO,
    );

    // A refs/heads/* path also triggers (covers the onDidCreate handler too).
    const triggerCreate = gitWatcher.onDidCreate.mock.calls[0][0] as (u: any) => void;
    vi.mocked(vscode.commands.executeCommand).mockClear();
    triggerCreate({ fsPath: '/tmp/test-workspace/.git/refs/heads/main' });
    // #302: same on the refs/heads/* (onDidCreate) path — folder + auto.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'minspec.classify',
      '/tmp/test-workspace',
      AUTO,
    );
  });

  // #203 regression: enabling the setting AFTER activation must start the
  // watcher live, with no window reload. Previously the watcher was wired only
  // at activation, so the classify toast's "from now on" silently did nothing.
  it('starts the git watcher live when autoClassifyOnCommit flips on after activation', () => {
    configValues = {}; // start disabled
    activate(makeMockContext());
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(5);
    expect(configChangeHandler).toBeDefined();

    // Simulate the toast writing the setting, then VS Code firing the change.
    configValues = { autoClassifyOnCommit: true };
    configChangeHandler!({
      affectsConfiguration: (k: string) => k === 'minspec.autoClassifyOnCommit',
    });

    // The 6th watcher (the git watcher) now exists without any reload.
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(6);
    const gitWatcher = createdWatchers[5];
    expect(gitWatcher.onDidChange).toHaveBeenCalled();
    expect(gitWatcher.onDidCreate).toHaveBeenCalled();
  });

  it('disposes the git watcher live when autoClassifyOnCommit flips off', () => {
    configValues = { autoClassifyOnCommit: true };
    activate(makeMockContext());
    const gitWatcher = createdWatchers[5];

    configValues = { autoClassifyOnCommit: false };
    configChangeHandler!({
      affectsConfiguration: (k: string) => k === 'minspec.autoClassifyOnCommit',
    });

    expect(gitWatcher.dispose).toHaveBeenCalled();
  });

  it('ignores config changes for unrelated settings', () => {
    configValues = {}; // disabled
    activate(makeMockContext());
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(5);

    // A change to some other key must not create the git watcher.
    configValues = { autoClassifyOnCommit: true };
    configChangeHandler!({ affectsConfiguration: () => false });

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(5);
  });
});

// ===========================================================================
// SPEC-086: an installation that ran the ScroogeLLM bridge
//
// The bridge is gone, but a machine that ran an earlier build can still hold
// the three global-state keys it wrote and the two settings it read. DQ-4
// leaves that state where it is, so activation has to work with all of it
// present and read none of it. These cases put every condition the bridge
// waited for in place. Run against a tree that still has the bridge, each fails.
// ===========================================================================

describe('an installation that ran the ScroogeLLM bridge (SPEC-086 FR-1, FR-2, FR-3, FR-5, DQ-4)', () => {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const RETIRED = /scroogellmNudge|installedAt|conformance/;

  /** Global state as an earlier build left it: installed a month ago, prompt shown once, never dismissed. */
  function stateAnEarlierBuildLeft() {
    const stored: Record<string, unknown> = {
      'minspec.installedAt': Date.now() - THIRTY_DAYS,
      'minspec.scroogellmNudge.lastShownAt': Date.now() - THIRTY_DAYS,
      'minspec.scroogellmNudge.dismissed': false,
    };
    return {
      get: vi.fn((key: string, fallback?: unknown) => (key in stored ? stored[key] : fallback)),
      update: vi.fn(() => Promise.resolve()),
    };
  }

  /**
   * Activate with everything the prompt waited for in place: old enough, cooled
   * down, never dismissed, its setting stored as on, and the product not
   * installed. Then let whatever activation left pending finish, because the
   * prompt was shown after an await.
   */
  async function activateWhereThePromptWouldHaveShown() {
    configValues = { 'scroogellmNudge.enabled': true, 'conformance.enabled': true };
    const globalState = stateAnEarlierBuildLeft();
    expect(() => activate(makeMockContext({ globalState }))).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    return globalState;
  }

  afterEach(() => {
    // clearAllMocks keeps implementations, so the "installed" answer below would leak.
    vi.mocked(vscode.extensions.getExtension).mockImplementation(() => undefined);
  });

  it('shows no message that names ScroogeLLM', async () => {
    await activateWhereThePromptWouldHaveShown();

    const shown = vi.mocked(vscode.window.showInformationMessage).mock.calls.map((call) => String(call[0]));
    expect(shown.filter((message) => /scrooge/i.test(message))).toEqual([]);
  });

  it('does not ask whether any other extension is installed', async () => {
    await activateWhereThePromptWouldHaveShown();

    expect(vi.mocked(vscode.extensions.getExtension).mock.calls.map((call) => call[0])).toEqual([]);
  });

  it('reads and writes none of the state the earlier build stored', async () => {
    const globalState = await activateWhereThePromptWouldHaveShown();

    expect(globalState.get.mock.calls.map((call) => call[0]).filter((key) => RETIRED.test(key))).toEqual([]);
    expect(globalState.update.mock.calls).toEqual([]);
  });

  it('reads neither retired setting', async () => {
    await activateWhereThePromptWouldHaveShown();

    // The recorder saw activation read settings at all, so "none retired" is a finding.
    expect(configKeysRead.length).toBeGreaterThan(0);
    expect(configKeysRead.filter((key) => RETIRED.test(key))).toEqual([]);
  });

  it('creates no conformance watcher, even with the old setting stored as on and ScroogeLLM installed', () => {
    // Everything the watcher waited for.
    configValues = { 'conformance.enabled': true };
    vi.mocked(vscode.extensions.getExtension).mockImplementation(
      () => ({ id: 'aiclarity.scroogellm' }) as unknown as vscode.Extension<unknown>,
    );

    activate(makeMockContext());

    // The five standing watchers (specs, adrs, traceability, approvals, epics) and no sixth.
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(5);
  });
});

// ===========================================================================
// SPEC-086 FR-4 / FR-7: what activation registers is what the manifest contributes
//
// The base test names 23 commands in a list. This derives the list from the
// manifest and compares both ways, so removing a command from one side only
// fails here: a contribution with no registration is a palette entry that
// errors, and a registration with no contribution is a command nobody can see.
// ===========================================================================

describe('activation registers exactly the commands the manifest contributes (SPEC-086 FR-4, FR-7)', () => {
  it('every contributed command is registered, and nothing else is', async () => {
    // `fs` is mocked in this file, so the manifest is read through the real module.
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const manifest = JSON.parse(
      realFs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { contributes: { commands: Array<{ command: string }> } };
    const contributed = manifest.contributes.commands.map((entry) => entry.command).sort();

    activate(makeMockContext());

    // An empty list would equal an empty registry, so check the list is real first.
    expect(contributed.length).toBeGreaterThan(20);
    expect([...registeredCommands.keys()].sort()).toEqual(contributed);
  });
});

// ===========================================================================
// resolveSpecFrontmatter recursive walk (lines 447-481, via injectContext)
// ===========================================================================

describe('resolveSpecFrontmatter (via injectContext)', () => {
  it('returns null (and errors) when loadConfig throws — config resolution guard', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('SPEC-001');
    vi.mocked(loadConfig).mockImplementationOnce(() => {
      throw new Error('bad config');
    });

    activate(makeMockContext());
    await invokeCommand('minspec.injectContext');

    // Walk bailed at the config try/catch → frontmatter null → not-found error.
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('SPEC-001 not found'),
    );
    expect(injectContextToFile).not.toHaveBeenCalled();
  });

  it('returns null when the specs dir does not exist', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('SPEC-001');
    vi.mocked(resolveAndValidate).mockReturnValueOnce('/tmp/test-workspace/specs');
    // specs dir missing → existsSync false for the specsDir check.
    vi.mocked(fs.existsSync).mockReturnValue(false);

    activate(makeMockContext());
    await invokeCommand('minspec.injectContext');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('SPEC-001 not found'),
    );
  });

  it('recurses into subdirectories and skips unreadable dirs and unparseable files', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('SPEC-042');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Directory layout:
    //   specs/                 → [feature/ (dir), bad/ (dir, unreadable), broken.md, SPEC-042.md]
    //   specs/feature/         → [nested.md]  (parseable but wrong id → skipped)
    //   specs/bad/             → readdir throws (covers the inner try/catch)
    vi.mocked(fs.readdirSync as any).mockImplementation((dir: string) => {
      const d = String(dir);
      if (d.endsWith('/specs')) {
        return [
          { name: 'feature', isDirectory: () => true },
          { name: 'bad', isDirectory: () => true },
          { name: 'broken.md', isDirectory: () => false },
          { name: 'SPEC-042.md', isDirectory: () => false },
          { name: 'notes.txt', isDirectory: () => false }, // non-.md → ignored
        ];
      }
      if (d.endsWith('/feature')) {
        return [{ name: 'nested.md', isDirectory: () => false }];
      }
      if (d.endsWith('/bad')) {
        throw new Error('EACCES'); // unreadable dir → continue
      }
      return [];
    });

    vi.mocked(fs.readFileSync as any).mockReturnValue('---\nraw\n---\n');
    vi.mocked(parseSpec as any).mockImplementation((content: string) => {
      void content;
      // Track which file is being parsed via call order isn't reliable, so key
      // off a side channel: readFileSync was just called with the full path.
      const lastRead = vi.mocked(fs.readFileSync).mock.calls.at(-1)?.[0] as string;
      if (String(lastRead).endsWith('broken.md')) {
        throw new Error('unparseable'); // covers the inner parse try/catch
      }
      if (String(lastRead).endsWith('nested.md')) {
        return { frontmatter: { id: 'SPEC-999', title: 'Other', tier: 'T1', status: 'new' } };
      }
      if (String(lastRead).endsWith('SPEC-042.md')) {
        return {
          frontmatter: {
            id: 'SPEC-042',
            title: 'Found It',
            tier: 'T3',
            status: 'implementing',
            phases: { specify: 'done', plan: 'in-progress' },
          },
        };
      }
      return { frontmatter: { id: 'SPEC-x' } };
    });

    vi.mocked(detectTools as any).mockReturnValue({ claude: true });
    vi.mocked(getToolFilePath as any).mockReturnValue('/tmp/test-workspace/CLAUDE.md');

    activate(makeMockContext());
    await invokeCommand('minspec.injectContext');

    // The walk found SPEC-042 despite the dir recursion, unreadable dir, and
    // unparseable sibling — and injected its REAL frontmatter.
    expect(injectContextToFile).toHaveBeenCalledTimes(1);
    const injected = vi.mocked(injectContextToFile).mock.calls[0][1];
    expect(injected.specId).toBe('SPEC-042');
    expect(injected.tier).toBe('T3');
    expect(injected.status).toBe('implementing');
    expect(injected.title).toBe('Found It');
    // first non-done phase is plan (in-progress).
    expect(injected.currentPhase).toBe('plan');
  });

  it('continues past an unreadable directory while walking with no match (covers readdir catch)', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('SPEC-404');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // No file carries SPEC-404, so the WHOLE tree is walked — including the
    // unreadable `bad/` dir whose readdir throws (exercises the continue path).
    vi.mocked(fs.readdirSync as any).mockImplementation((dir: string) => {
      const d = String(dir);
      if (d.endsWith('/specs')) {
        return [{ name: 'bad', isDirectory: () => true }];
      }
      if (d.endsWith('/bad')) {
        throw new Error('EACCES'); // unreadable dir → continue (line 464)
      }
      return [];
    });
    vi.mocked(fs.readFileSync as any).mockReturnValue('---\nraw\n---\n');
    vi.mocked(parseSpec as any).mockReturnValue({ frontmatter: { id: 'SPEC-OTHER' } });

    vi.mocked(detectTools as any).mockReturnValue({ claude: true });
    vi.mocked(getToolFilePath as any).mockReturnValue('/tmp/test-workspace/CLAUDE.md');

    activate(makeMockContext());
    await invokeCommand('minspec.injectContext');

    // Walk completed with no match → not-found error, nothing injected.
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('SPEC-404 not found'),
    );
    expect(injectContextToFile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// injectContextCommand no-workspace early return (lines 488-489)
// ===========================================================================

describe('injectContext command — no workspace', () => {
  it('shows the no-workspace error and injects nothing when workspaceRoot is empty', async () => {
    const { resolveTargetFolderNonInteractive } = await import('../src/lib/resolve-folder');
    vi.mocked(resolveTargetFolderNonInteractive).mockReturnValueOnce('');

    activate(makeMockContext());
    await invokeCommand('minspec.injectContext');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'MinSpec: No workspace folder open.',
    );
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(injectContextToFile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// onSpecsChanged watcher path — refresh tree + panel (status-bar item removed)
// ===========================================================================

describe('spec watcher onSpecsChanged', () => {
  it('refreshes the spec tree and panel when a spec file changes', () => {
    activate(makeMockContext());

    // The spec watcher is the first watcher created (index 0).
    const specWatcher = createdWatchers[0];
    const onChange = specWatcher.onDidChange.mock.calls[0][0] as () => void;
    mockSpecTreeProvider.refresh.mockClear();
    mockSpecPanel.refresh.mockClear();

    onChange();

    expect(mockSpecTreeProvider.refresh).toHaveBeenCalled();
    expect(mockSpecPanel.refresh).toHaveBeenCalled();
  });
});

// ===========================================================================
// removeContextCommand no-workspace early return (lines 550-551)
// ===========================================================================

describe('removeContext command — no workspace', () => {
  it('shows the no-workspace error and removes nothing when workspaceRoot is empty', async () => {
    const { resolveTargetFolderNonInteractive } = await import('../src/lib/resolve-folder');
    vi.mocked(resolveTargetFolderNonInteractive).mockReturnValueOnce('');

    activate(makeMockContext());
    invokeCommand('minspec.removeContext');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'MinSpec: No workspace folder open.',
    );
    expect(removeContextFromFile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Refresh-wrapping command callbacks (lines 167-223)
//
// The base test asserts these commands are REGISTERED but never invokes most
// of the async refresh-wrapping wrappers (createEpic, acceptEpic, backfill,
// acceptAdr, setAdrStatus, approveSpec, revokeApproval, validateSpec, the
// index regenerators, migrateLayout). Invoking each one covers its body +
// delegation.
// ===========================================================================

describe('refresh-wrapping command callbacks', () => {
  it('createEpic delegates then refreshes all three trees', async () => {
    activate(makeMockContext());
    await invokeCommand('minspec.createEpic');
    expect(createEpicCommand).toHaveBeenCalled();
    expect(mockSpecTreeProvider.refresh).toHaveBeenCalled();
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();
    expect(mockBacklogTreeProvider.refresh).toHaveBeenCalled();
  });

  it('acceptEpic delegates with the node then refreshes all three trees', async () => {
    activate(makeMockContext());
    const node = { epic: { slug: 'x' } };
    await invokeCommand('minspec.acceptEpic', node);
    expect(acceptEpicCommand).toHaveBeenCalledWith(node);
    expect(mockSpecTreeProvider.refresh).toHaveBeenCalled();
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();
    expect(mockBacklogTreeProvider.refresh).toHaveBeenCalled();
  });

  it('backfillEpics forwards the folder arg then refreshes all three trees', async () => {
    activate(makeMockContext());
    await invokeCommand('minspec.backfillEpics', '/tmp/test-workspace');
    // #213: the handler now forwards a 2nd opts arg (BackfillOptions); undefined here.
    expect(backfillEpicsCommand).toHaveBeenCalledWith('/tmp/test-workspace', undefined);
    expect(mockSpecTreeProvider.refresh).toHaveBeenCalled();
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();
    expect(mockBacklogTreeProvider.refresh).toHaveBeenCalled();
  });

  it('regenerateEpicIndex / regenerateDrIndex delegate to their commands', () => {
    activate(makeMockContext());
    invokeCommand('minspec.regenerateEpicIndex');
    expect(regenerateEpicIndexCommand).toHaveBeenCalled();
    invokeCommand('minspec.regenerateDrIndex');
    expect(regenerateDrIndexCommand).toHaveBeenCalled();
  });

  it('acceptAdr delegates with the node then refreshes the ADR tree', async () => {
    activate(makeMockContext());
    const node = { adr: { id: 'DR-001' } };
    await invokeCommand('minspec.acceptAdr', node);
    expect(acceptAdrCommand).toHaveBeenCalledWith(node);
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();
  });

  it('setAdrStatus delegates with the node then refreshes the ADR tree', async () => {
    activate(makeMockContext());
    const node = { adr: { id: 'DR-002' } };
    await invokeCommand('minspec.setAdrStatus', node);
    expect(setAdrStatusCommand).toHaveBeenCalledWith(node);
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();
  });

  // approve/revoke fire `minspec.refreshTree` INSIDE the command, so the wrapper
  // must NOT add its own refresh — doing so only fed the redundant rebuild burst
  // that froze the UI (issue #154). Assert delegation + no wrapper-level refresh.
  it('approveSpec delegates with the node and does not add a redundant refresh', async () => {
    activate(makeMockContext());
    const node = { spec: { id: 'SPEC-001' } };
    await invokeCommand('minspec.approveSpec', node);
    // Second arg is the globalState Memento, wired for the first-approve tip (#104).
    expect(approveSpecCommand).toHaveBeenCalledWith(node, expect.anything());
    expect(mockSpecTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('revokeApproval delegates with the node and does not add a redundant refresh', async () => {
    activate(makeMockContext());
    const node = { spec: { id: 'SPEC-002' } };
    await invokeCommand('minspec.revokeApproval', node);
    expect(revokeApprovalCommand).toHaveBeenCalledWith(node);
    expect(mockSpecTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('validateSpec delegates with the node', () => {
    activate(makeMockContext());
    const node = { spec: { id: 'SPEC-003' } };
    invokeCommand('minspec.validateSpec', node);
    expect(validateSpecCommand).toHaveBeenCalledWith(node);
  });

  it('migrateLayout delegates with the workspace root', () => {
    activate(makeMockContext());
    invokeCommand('minspec.migrateLayout');
    expect(migrateLayoutCommand).toHaveBeenCalledWith('/tmp/test-workspace');
  });

  it('park forwards no options; parkForce forwards { force: true }', () => {
    activate(makeMockContext());
    invokeCommand('minspec.park');
    expect(parkCommand).toHaveBeenLastCalledWith();
    invokeCommand('minspec.parkForce');
    expect(parkCommand).toHaveBeenLastCalledWith({ force: true });
  });

  it('the SpecPanel dispose subscription disposes the panel', () => {
    activate(makeMockContext());
    // activate() pushes a plain `{ dispose: () => specPanel.dispose() }`
    // disposable whose `dispose` is a real arrow closure — not a vitest mock
    // (registration disposables use `{ dispose: vi.fn() }`, which carry a
    // `.mock` property). That distinguishes the panel disposable uniquely.
    const panelDisposable = subscriptions.find(
      (s) =>
        s &&
        typeof s === 'object' &&
        Object.keys(s).length === 1 &&
        typeof s.dispose === 'function' &&
        !('mock' in s.dispose),
    );
    expect(panelDisposable).toBeDefined();
    panelDisposable.dispose();
    expect(mockSpecPanel.dispose).toHaveBeenCalled();
  });
});

// ===========================================================================
// #2355: the bootstrap toast remembers a pre-opt-in answer in workspaceState
// ===========================================================================

describe('auto-bootstrap host wiring (#2355)', () => {
  it('hands runBootstrap the workspaceState as its pre-opt-in memory, for every folder', async () => {
    const { runBootstrap } = await import('../src/lib/auto-bootstrap');
    const ctx = makeMockContext();
    activate(ctx);

    // Without this the answer to the "not initialized" toast has nowhere to live
    // except a file in the folder, and the toast would return on every activation.
    const calls = vi.mocked(runBootstrap).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [folder, host] of calls) {
      expect(folder).toBe('/tmp/test-workspace');
      expect(host.preOptInMemory).toBe(ctx.workspaceState);
    }
  });
});

// ===========================================================================
// Epic-grouping toggles (lines 82-92, 187-189)
// ===========================================================================

describe('epic grouping toggles', () => {
  it('seeds each provider grouping from workspaceState on activation', () => {
    const ctx = makeMockContext();
    activate(ctx);
    // The three providers each get a .set(...) call seeding their default.
    expect(mockSpecTreeProvider.epicGrouping.set).toHaveBeenCalled();
    expect(mockAdrTreeProvider.epicGrouping.set).toHaveBeenCalled();
    expect(mockBacklogTreeProvider.epicGrouping.set).toHaveBeenCalled();
    // Spec/ADR default ON, Backlog default OFF.
    expect(mockSpecTreeProvider.epicGrouping.set).toHaveBeenCalledWith(true);
    expect(mockBacklogTreeProvider.epicGrouping.set).toHaveBeenCalledWith(false);
  });

  it('toggling the spec-explorer grouping flips state, persists, and refreshes', async () => {
    const ctx = makeMockContext();
    activate(ctx);
    await invokeCommand('minspec.specExplorer.toggleEpicGrouping');
    expect(mockSpecTreeProvider.epicGrouping.toggle).toHaveBeenCalled();
    expect(ctx.workspaceState.update).toHaveBeenCalledWith(
      'minspec.specExplorer.groupByEpic',
      true,
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'minspec.specExplorer.groupByEpic',
      true,
    );
    expect(mockSpecTreeProvider.refresh).toHaveBeenCalled();
  });

  it('toggling the ADR and backlog groupings also flips and refreshes', async () => {
    activate(makeMockContext());
    await invokeCommand('minspec.adrExplorer.toggleEpicGrouping');
    expect(mockAdrTreeProvider.epicGrouping.toggle).toHaveBeenCalled();
    expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();

    await invokeCommand('minspec.backlog.toggleEpicGrouping');
    expect(mockBacklogTreeProvider.epicGrouping.toggle).toHaveBeenCalled();
    expect(mockBacklogTreeProvider.refresh).toHaveBeenCalled();
  });
});

// ===========================================================================
// onAdrsChanged guard branches (lines 294, 298)
// ===========================================================================

describe('ADR watcher onAdrsChanged guards', () => {
  it('returns before scheduling a regenerate when workspaceRoot is empty (line 294)', async () => {
    vi.useFakeTimers();
    try {
      const { resolveTargetFolderNonInteractive } = await import('../src/lib/resolve-folder');
      vi.mocked(resolveTargetFolderNonInteractive).mockReturnValueOnce('');

      activate(makeMockContext());

      // adr watcher is the 2nd watcher created (specs=0, adrs=1).
      const adrWatcher = createdWatchers[1];
      const onChange = adrWatcher.onDidChange.mock.calls[0][0] as (u: any) => void;
      vi.mocked(regenerateDrIndex).mockClear();

      // A normal DR change with an empty root → tree refreshes, but the
      // !workspaceRoot guard returns before the debounce is armed.
      onChange({ fsPath: '/docs/decisions/DR-009.md' });
      expect(mockAdrTreeProvider.refresh).toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(regenerateDrIndex).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes undefined options to regenerateDrIndex when decisionsDir is empty (line 298)', () => {
    vi.useFakeTimers();
    try {
      configValues = { decisionsDir: '' };
      activate(makeMockContext());

      const adrWatcher = createdWatchers[1];
      const onChange = adrWatcher.onDidChange.mock.calls[0][0] as (u: any) => void;
      vi.mocked(regenerateDrIndex).mockClear();

      onChange({ fsPath: '/tmp/test-workspace/docs/decisions/DR-009.md' });
      vi.advanceTimersByTime(300);

      // The `decisionsDir ? {decisionsDir} : undefined` ternary takes the
      // undefined branch when decisionsDir is the empty string.
      expect(regenerateDrIndex).toHaveBeenCalledWith('/tmp/test-workspace', undefined);
    } finally {
      vi.useRealTimers();
    }
  });
});
