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
  formatScaffoldCommitText,
  computeProgress,
  fromFrontmatter,
} from '../src/views/status-bar';
import type { SpecFrontmatter } from '../src/lib/spec';

// NOTE: the per-spec "tier | phase | progress" status-bar item (MinSpecStatusBar,
// formatStatusBarText, formatTooltip) was removed — it wasn't useful across
// multi-spec sessions and its identity now belongs in the session/tab title
// (#897). `computeProgress` / `fromFrontmatter` survive as shared helpers
// (used by lib/active-spec.ts), so their contract is still tested here. The
// Next-Task signpost's own formatter (formatNextTaskText) is covered in
// next-task-command.test.ts.

// =============================================================================
// computeProgress() — tier-aware completion percentage (#38)
// =============================================================================

describe('computeProgress()', () => {
  it('returns "· 0%" when all required phases pending', () => {
    const phases = {
      specify: 'pending' as const,
      clarify: 'pending' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    expect(computeProgress(phases, 'T4')).toBe('· 0%');
  });

  it('returns "· 100%" when all phases done (T4 requires all five)', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'done' as const,
      plan: 'done' as const,
      tasks: 'done' as const,
      implement: 'done' as const,
    };
    expect(computeProgress(phases, 'T4')).toBe('· 100%');
  });

  it('T1 is 100% as soon as specify is done (tier-aware denominator, #38)', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'pending' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    // T1 requires only specify, so 1/1 = 100% even though other phases pending
    expect(computeProgress(phases, 'T1')).toBe('· 100%');
  });

  it('T2 denominator is specify+plan (not all 5): specify done → 50%', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'skipped' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    // clarify skipped is ignored (not required at T2); 1 of 2 required → 50%
    expect(computeProgress(phases, 'T2')).toBe('· 50%');
  });

  it('counts skipped required phases as completed', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'skipped' as const,
      plan: 'skipped' as const,
      tasks: 'done' as const,
      implement: 'in-progress' as const,
    };
    // T4 requires all 5: specify+clarify+plan+tasks complete, implement not → 4/5 = 80%
    expect(computeProgress(phases, 'T4')).toBe('· 80%');
  });

  it('in-progress required phase does not count as completed', () => {
    const phases = {
      specify: 'in-progress' as const,
      clarify: 'pending' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    expect(computeProgress(phases, 'T2')).toBe('· 0%');
  });

  it('never emits the redundant " done" suffix (#97)', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'done' as const,
      plan: 'done' as const,
      tasks: 'done' as const,
      implement: 'done' as const,
    };
    expect(computeProgress(phases, 'T3')).not.toContain('done');
  });

  it('unknown tier falls back to a specify-only denominator', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'pending' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    expect(computeProgress(phases, 'T9')).toBe('· 100%');
  });
});

// =============================================================================
// fromFrontmatter() — derive the current phase for the active-spec summary
// =============================================================================

describe('fromFrontmatter()', () => {
  it('derives current phase from in-progress phase', () => {
    const fm: SpecFrontmatter = {
      id: 'SPEC-001',
      title: 'Test',
      tier: 'T2',
      status: 'implementing',
      created: '2026-05-26',
      phases: {
        specify: 'done',
        clarify: 'done',
        plan: 'done',
        tasks: 'done',
        implement: 'in-progress',
      },
    };
    const result = fromFrontmatter(fm);
    expect(result.currentPhase).toBe('implement');
    expect(result.id).toBe('SPEC-001');
    expect(result.tier).toBe('T2');
  });

  it('falls back to first pending when no in-progress', () => {
    const fm: SpecFrontmatter = {
      id: 'SPEC-002',
      title: 'Test 2',
      tier: 'T3',
      status: 'new',
      created: '2026-05-26',
      phases: {
        specify: 'done',
        clarify: 'skipped',
        plan: 'pending',
        tasks: 'pending',
        implement: 'pending',
      },
    };
    const result = fromFrontmatter(fm);
    expect(result.currentPhase).toBe('plan');
  });

  it('returns null currentPhase when all phases complete', () => {
    const fm: SpecFrontmatter = {
      id: 'SPEC-003',
      title: 'Done spec',
      tier: 'T1',
      status: 'done',
      created: '2026-05-26',
      phases: {
        specify: 'done',
        clarify: 'skipped',
        plan: 'skipped',
        tasks: 'done',
        implement: 'done',
      },
    };
    const result = fromFrontmatter(fm);
    expect(result.currentPhase).toBeNull();
  });
});

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
