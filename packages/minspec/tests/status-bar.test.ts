import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock item — returned by createStatusBarItem
const mockStatusBarItem = {
  text: '',
  tooltip: '',
  command: '',
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

// Mock vscode module before any imports that use it
vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
}));

import * as vscode from 'vscode';
import {
  MinSpecScaffoldCommitStatusBar,
  MinSpecNextTaskStatusBar,
  MinSpecTidyPrimaryStatusBar,
  formatScaffoldCommitText,
  formatTidyPrimaryText,
  formatKeybindingForDisplay,
  resolveNextTaskKeybinding,
} from '../src/views/status-bar';
import type { NextTask } from '@aiclarity/shared';

function nextTask(overrides: Partial<NextTask> = {}): NextTask {
  return {
    kind: 'spec-approve',
    targetId: 'SPEC-001',
    imperative: 'Approve SPEC-001',
    severityClass: 'pending',
    evidence: {
      severityClass: 'pending',
      rule: 'pending.spec-approve',
      explanation: 'SPEC-001 is unapproved',
      refs: ['SPEC-001'],
    },
    ...overrides,
  };
}

// NOTE: the per-spec "tier | phase | progress" status-bar item (MinSpecStatusBar,
// formatStatusBarText, formatTooltip) was removed — it wasn't useful across
// multi-spec sessions and its identity now belongs in the session/tab title
// (#897). `computeProgress` / `fromFrontmatter` survive as shared helpers, but
// SPEC-040 FR-5 moved them to `lib/spec-progress.ts` (their consumer,
// lib/active-spec.ts, is Tier-0) — their contract is tested in
// spec-progress.test.ts, which needs no `vscode` mock at all. The Next-Task
// signpost's own formatter (formatNextTaskText) is covered in
// next-task-command.test.ts.

// =============================================================================
// Harness-refresh commit recovery status bar (#758)
// =============================================================================

describe('formatScaffoldCommitText()', () => {
  it('includes the dirty-file count', () => {
    expect(formatScaffoldCommitText(3)).toBe('$(git-commit) MinSpec: harness uncommitted (3)');
  });

  it('renders singular count the same way as plural (count is data, not grammar)', () => {
    expect(formatScaffoldCommitText(1)).toBe('$(git-commit) MinSpec: harness uncommitted (1)');
  });
});

describe('MinSpecScaffoldCommitStatusBar class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
  });

  it('creates a status bar item on construction, bound to the recovery command', () => {
    new MinSpecScaffoldCommitStatusBar();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(1, 98); // Left=1, priority=98
    expect(mockStatusBarItem.command).toBe('minspec.commitHarnessRefresh');
  });

  it('update([]) hides the item — nothing to recover', () => {
    const bar = new MinSpecScaffoldCommitStatusBar();
    bar.update([]);
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
    expect(mockStatusBarItem.show).not.toHaveBeenCalled();
  });

  it('update([...dirty]) shows the item with a count and a listing tooltip', () => {
    const bar = new MinSpecScaffoldCommitStatusBar();
    bar.update(['CLAUDE.md', '.minspec/config.json']);

    expect(mockStatusBarItem.text).toBe('$(git-commit) MinSpec: harness uncommitted (2)');
    expect(mockStatusBarItem.tooltip).toContain('CLAUDE.md');
    expect(mockStatusBarItem.tooltip).toContain('.minspec/config.json');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
    expect(mockStatusBarItem.hide).not.toHaveBeenCalled();
  });

  it('dispose calls dispose on the underlying item', () => {
    const bar = new MinSpecScaffoldCommitStatusBar();
    bar.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });
});

// =============================================================================
// Tidy-primary status bar (#1162)
// =============================================================================

describe('formatTidyPrimaryText()', () => {
  it('includes the redundant-path count', () => {
    expect(formatTidyPrimaryText(2)).toBe('$(trash) MinSpec: 2 redundant');
  });

  it('renders singular count the same way as plural (count is data, not grammar)', () => {
    expect(formatTidyPrimaryText(1)).toBe('$(trash) MinSpec: 1 redundant');
  });
});

describe('MinSpecTidyPrimaryStatusBar class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
  });

  it('creates a status bar item on construction, bound to minspec.tidyPrimary', () => {
    new MinSpecTidyPrimaryStatusBar();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(1, 97); // Left=1, priority=97
    expect(mockStatusBarItem.command).toBe('minspec.tidyPrimary');
  });

  it('update([], 0) hides the item — nothing redundant', () => {
    const bar = new MinSpecTidyPrimaryStatusBar();
    bar.update([], 0);
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
    expect(mockStatusBarItem.show).not.toHaveBeenCalled();
  });

  it('update([], N) with orphans-but-no-redundant still hides the badge (orphans are never counted in it)', () => {
    const bar = new MinSpecTidyPrimaryStatusBar();
    bar.update([], 3);
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
    expect(mockStatusBarItem.show).not.toHaveBeenCalled();
  });

  it('update([...redundant], 0) shows the item with a count and a listing tooltip', () => {
    const bar = new MinSpecTidyPrimaryStatusBar();
    bar.update(['a.txt', 'b.txt'], 0);

    expect(mockStatusBarItem.text).toBe('$(trash) MinSpec: 2 redundant');
    expect(mockStatusBarItem.tooltip).toContain('a.txt');
    expect(mockStatusBarItem.tooltip).toContain('b.txt');
    expect(mockStatusBarItem.tooltip).not.toContain('unlanded');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
    expect(mockStatusBarItem.hide).not.toHaveBeenCalled();
  });

  it('folds a non-zero orphan count into the tooltip, never the badge text', () => {
    const bar = new MinSpecTidyPrimaryStatusBar();
    bar.update(['a.txt'], 2);

    expect(mockStatusBarItem.text).toBe('$(trash) MinSpec: 1 redundant');
    expect(mockStatusBarItem.tooltip).toContain('2 unlanded paths');
  });

  it('dispose calls dispose on the underlying item', () => {
    const bar = new MinSpecTidyPrimaryStatusBar();
    bar.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });
});

// =============================================================================
// formatKeybindingForDisplay() — pretty-print a VS Code keybinding string (#934)
// =============================================================================

describe('formatKeybindingForDisplay', () => {
  it('renders a single Alt key as Alt+N', () => {
    expect(formatKeybindingForDisplay('alt+n')).toBe('Alt+N');
  });

  it('renders a two-stroke chord space-separated', () => {
    expect(formatKeybindingForDisplay('ctrl+k ctrl+n')).toBe('Ctrl+K Ctrl+N');
  });

  it('canonicalises known modifier casing (cmd/shift)', () => {
    expect(formatKeybindingForDisplay('cmd+shift+p')).toBe('Cmd+Shift+P');
  });

  it('tolerates stray whitespace', () => {
    expect(formatKeybindingForDisplay('  alt+n  ')).toBe('Alt+N');
  });
});

// =============================================================================
// resolveNextTaskKeybinding() — read the shipped default from the manifest (#934)
// =============================================================================

describe('resolveNextTaskKeybinding', () => {
  const manifest = {
    contributes: {
      keybindings: [
        { command: 'minspec.approveActive', key: 'alt+a' },
        { command: 'minspec.nextTask', key: 'alt+n' },
      ],
    },
  };

  it('finds and formats the minspec.nextTask binding', () => {
    expect(resolveNextTaskKeybinding(manifest)).toBe('Alt+N');
  });

  it('returns undefined when the command is not bound', () => {
    expect(resolveNextTaskKeybinding({ contributes: { keybindings: [] } })).toBeUndefined();
  });

  it('returns undefined for a manifest with no keybindings section', () => {
    expect(resolveNextTaskKeybinding({})).toBeUndefined();
    expect(resolveNextTaskKeybinding(undefined)).toBeUndefined();
  });

  it('prefers the mac override on darwin', () => {
    const macManifest = {
      contributes: {
        keybindings: [{ command: 'minspec.nextTask', key: 'alt+n', mac: 'cmd+n' }],
      },
    };
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      expect(resolveNextTaskKeybinding(macManifest)).toBe('Cmd+N');
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });
});

// =============================================================================
// MinSpecNextTaskStatusBar — signpost tooltip carries the hotkey (#934)
// =============================================================================

describe('MinSpecNextTaskStatusBar class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
  });

  it('binds the item to minspec.nextTask at priority 99', () => {
    new MinSpecNextTaskStatusBar('Alt+N');
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(1, 99); // Left=1
    expect(mockStatusBarItem.command).toBe('minspec.nextTask');
  });

  it('appends the shortcut to the tooltip for a pending task', () => {
    const bar = new MinSpecNextTaskStatusBar('Alt+N');
    bar.update(nextTask());
    expect(mockStatusBarItem.tooltip).toBe('SPEC-001 is unapproved\nShortcut: Alt+N');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it('shows the shortcut even in the "clear" state', () => {
    const bar = new MinSpecNextTaskStatusBar('Alt+N');
    bar.update(null);
    expect(mockStatusBarItem.tooltip).toBe('No pending review tasks.\nShortcut: Alt+N');
  });

  it('omits the shortcut line when no keybinding is known (never invents one)', () => {
    const bar = new MinSpecNextTaskStatusBar(undefined);
    bar.update(nextTask());
    expect(mockStatusBarItem.tooltip).toBe('SPEC-001 is unapproved');
    expect(mockStatusBarItem.tooltip).not.toContain('Shortcut');
  });
});
