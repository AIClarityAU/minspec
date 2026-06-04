import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => {
  const config = new Map<string, unknown>([['scroogellmNudge.enabled', true]]);
  return {
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    env: { openExternal: vi.fn() },
    window: { showInformationMessage: vi.fn(async () => undefined) },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (key: string, def?: unknown) => (config.has(key) ? config.get(key) : def),
      })),
      createFileSystemWatcher: vi.fn(),
    },
    extensions: { getExtension: vi.fn(() => undefined) },
    RelativePattern: class { constructor(public a: unknown, public b: string) {} },
  };
});

vi.mock('../src/lib/ai-usage-detector', () => ({
  detectAITools: vi.fn(() => ({ tools: [], heavyUsage: false })),
}));

import * as vscode from 'vscode';
import {
  maybeShowNudge,
  recordInstallTimestamp,
  buildNudgeMessage,
  isScroogeLlmInstalled,
  setupConformanceWatcher,
} from '../src/lib/bridge';
import { detectAITools } from '../src/lib/ai-usage-detector';

const ONE_DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * ONE_DAY;

function makeContext(globalState: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(globalState));
  return {
    globalState: {
      get: <T>(k: string, def?: T) => (store.has(k) ? (store.get(k) as T) : def),
      update: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    },
    _store: store,
  } as unknown as import('vscode').ExtensionContext & { _store: Map<string, unknown> };
}

describe('bridge — recordInstallTimestamp', () => {
  it('stores timestamp when none set', async () => {
    const ctx = makeContext();
    recordInstallTimestamp(ctx, 1_000_000);
    expect((ctx as any)._store.get('minspec.installedAt')).toBe(1_000_000);
  });

  it('does not overwrite existing timestamp', () => {
    const ctx = makeContext({ 'minspec.installedAt': 500 });
    recordInstallTimestamp(ctx, 999_999);
    expect((ctx as any)._store.get('minspec.installedAt')).toBe(500);
  });
});

describe('bridge — buildNudgeMessage', () => {
  it('uses base copy when no tools detected', () => {
    const msg = buildNudgeMessage({ tools: [], heavyUsage: false });
    expect(msg).toContain('25-40%');
    expect(msg).not.toContain('alongside');
  });

  it('mentions detected tool by name', () => {
    const msg = buildNudgeMessage({ tools: ['Claude Code'], heavyUsage: false });
    expect(msg).toContain('Claude Code');
    expect(msg).toContain('alongside');
  });

  it('summarises when 3+ tools detected', () => {
    const msg = buildNudgeMessage({
      tools: ['Claude Code', 'Cursor', 'Cody', 'Copilot'],
      heavyUsage: true,
    });
    expect(msg).toContain('Claude Code');
    expect(msg).toContain('+ 2 more');
  });
});

describe('bridge — maybeShowNudge gating', () => {
  beforeEach(() => {
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear();
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (detectAITools as ReturnType<typeof vi.fn>).mockReturnValue({ tools: [], heavyUsage: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips when ScroogeLLM already installed', async () => {
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'aiclarity.scroogellm' });
    const shown = await maybeShowNudge(makeContext(), Date.now());
    expect(shown).toBe(false);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('skips when permanently dismissed', async () => {
    const ctx = makeContext({ 'minspec.scroogellmNudge.dismissed': true });
    const shown = await maybeShowNudge(ctx, Date.now());
    expect(shown).toBe(false);
  });

  it('skips within 24h of install', async () => {
    const now = 1_000_000_000;
    const ctx = makeContext({ 'minspec.installedAt': now - (ONE_DAY - 1) });
    const shown = await maybeShowNudge(ctx, now);
    expect(shown).toBe(false);
  });

  it('shows after 24h install age + no prior nudge', async () => {
    const now = 1_000_000_000;
    const ctx = makeContext({ 'minspec.installedAt': now - (ONE_DAY + 1) });
    const shown = await maybeShowNudge(ctx, now);
    expect(shown).toBe(true);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
  });

  it('skips when last shown < 7 days ago', async () => {
    const now = 1_000_000_000;
    const ctx = makeContext({
      'minspec.installedAt': now - (30 * ONE_DAY),
      'minspec.scroogellmNudge.lastShownAt': now - (SEVEN_DAYS - 1),
    });
    const shown = await maybeShowNudge(ctx, now);
    expect(shown).toBe(false);
  });

  it('shows again after 7-day cooldown', async () => {
    const now = 1_000_000_000;
    const ctx = makeContext({
      'minspec.installedAt': now - (30 * ONE_DAY),
      'minspec.scroogellmNudge.lastShownAt': now - (SEVEN_DAYS + 1),
    });
    const shown = await maybeShowNudge(ctx, now);
    expect(shown).toBe(true);
  });

  it("permanently dismisses on Don't Show Again", async () => {
    const now = 1_000_000_000;
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue("Don't Show Again");
    const ctx = makeContext({ 'minspec.installedAt': now - (ONE_DAY + 1) });
    await maybeShowNudge(ctx, now);
    expect((ctx as any)._store.get('minspec.scroogellmNudge.dismissed')).toBe(true);
  });

  it('records lastShownAt when shown', async () => {
    const now = 1_000_000_000;
    const ctx = makeContext({ 'minspec.installedAt': now - (ONE_DAY + 1) });
    await maybeShowNudge(ctx, now);
    expect((ctx as any)._store.get('minspec.scroogellmNudge.lastShownAt')).toBe(now);
  });

  it('opens marketplace URL on Learn More', async () => {
    const now = 1_000_000_000;
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Learn More');
    const ctx = makeContext({ 'minspec.installedAt': now - (ONE_DAY + 1) });
    await maybeShowNudge(ctx, now);
    expect(vscode.env.openExternal).toHaveBeenCalled();
  });
});

describe('bridge — setupConformanceWatcher (#123 multi-root base)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // conformance.enabled = true so the watcher is actually created.
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: (key: string, def?: unknown) =>
        key === 'conformance.enabled'
          ? true
          : key === 'specsDir'
            ? 'specs'
            : def,
    });
    // ScroogeLLM appears installed (second precondition for the watcher).
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'aiclarity.scroogellm',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the passed workspaceRoot as the watcher base, not workspaceFolders[0]', () => {
    const created: any[] = [];
    (vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      (pattern: { a?: unknown }) => {
        created.push(pattern?.a);
        return { onDidChange: vi.fn(), onDidCreate: vi.fn(), onDidDelete: vi.fn(), dispose: vi.fn() };
      },
    );

    const watcher = setupConformanceWatcher('/tmp/wsB');

    expect(watcher).toBeDefined();
    expect(created).toHaveLength(1);
    // RelativePattern base must be the folder we were asked to watch.
    expect(created[0]).toBe('/tmp/wsB');
  });
});

describe('bridge — isScroogeLlmInstalled', () => {
  it('returns false when extension absent', () => {
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    expect(isScroogeLlmInstalled()).toBe(false);
  });

  it('returns true when extension present', () => {
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'aiclarity.scroogellm' });
    expect(isScroogeLlmInstalled()).toBe(true);
  });
});
