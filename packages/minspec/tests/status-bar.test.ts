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
  MinSpecStatusBar,
  MinSpecScaffoldCommitStatusBar,
  formatStatusBarText,
  formatTooltip,
  formatScaffoldCommitText,
  computeProgress,
  fromFrontmatter,
} from '../src/views/status-bar';
import type { StatusBarSpec } from '../src/views/status-bar';
import type { SpecFrontmatter } from '../src/lib/spec';

// --- Helpers ---

function makeSpec(overrides: Partial<StatusBarSpec> = {}): StatusBarSpec {
  return {
    id: 'SPEC-001',
    title: 'Add rate limiting',
    tier: 'T2',
    currentPhase: 'plan',
    phases: {
      specify: 'done',
      clarify: 'skipped',
      plan: 'in-progress',
      tasks: 'pending',
      implement: 'pending',
    },
    ...overrides,
  };
}

// =============================================================================
// T0 INVARIANT TESTS — Status bar contract
// =============================================================================

describe('T0 Invariants — Status Bar', () => {
  it('Invariant: null spec always shows "No active spec"', () => {
    const text = formatStatusBarText(null);
    expect(text).toBe('$(shield) MinSpec: No active spec');
  });

  it('Invariant: non-null spec always includes tier, phase, and progress', () => {
    const spec = makeSpec();
    const text = formatStatusBarText(spec);
    expect(text).toContain('T2');
    expect(text).toContain('Plan');
    expect(text).toMatch(/· \d+%/);
  });

  it('Invariant: progress never contains the redundant " done" suffix (#97)', () => {
    const spec = makeSpec();
    expect(computeProgress(spec.phases, spec.tier)).not.toContain('done');
    expect(formatStatusBarText(spec)).not.toContain('done');
  });

  it('Invariant: progress is a tier-aware percentage token "· N%" (#38)', () => {
    const spec = makeSpec();
    const progress = computeProgress(spec.phases, spec.tier);
    expect(progress).toMatch(/^· \d+%$/);
  });

  it('Invariant: dispose cleans up the status bar item', () => {
    vi.clearAllMocks();
    // Reset mock item state
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';

    const bar = new MinSpecStatusBar();
    bar.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });
});

// =============================================================================
// T2 FEATURE TESTS — Formatting and behavior
// =============================================================================

describe('formatStatusBarText()', () => {
  it('shows "No active spec" when null', () => {
    expect(formatStatusBarText(null)).toBe('$(shield) MinSpec: No active spec');
  });

  it('formats with tier, current phase, and tier-aware percentage', () => {
    // T3 requires specify+plan+tasks+implement (4 phases); specify+plan done
    // (clarify is NOT required at T3, so it does not count) → 2/4 = 50%
    const spec = makeSpec({
      tier: 'T3',
      currentPhase: 'tasks',
      phases: {
        specify: 'done',
        clarify: 'done',
        plan: 'done',
        tasks: 'in-progress',
        implement: 'pending',
      },
    });
    expect(formatStatusBarText(spec)).toBe('$(shield) MinSpec: T3 | Tasks | · 50%');
  });

  it('shows "Done" and 100% when no current phase (all complete)', () => {
    const spec = makeSpec({
      currentPhase: null,
      phases: {
        specify: 'done',
        clarify: 'done',
        plan: 'done',
        tasks: 'done',
        implement: 'done',
      },
    });
    expect(formatStatusBarText(spec)).toBe('$(shield) MinSpec: T2 | Done | · 100%');
  });

  it('shows T1 with Specify phase at 0%', () => {
    const spec = makeSpec({
      tier: 'T1',
      currentPhase: 'specify',
      phases: {
        specify: 'in-progress',
        clarify: 'pending',
        plan: 'pending',
        tasks: 'pending',
        implement: 'pending',
      },
    });
    expect(formatStatusBarText(spec)).toBe('$(shield) MinSpec: T1 | Specify | · 0%');
  });

  it('counts skipped phases as completed in the percentage', () => {
    // T2 requires specify+plan (2 phases); specify done, plan in-progress → 50%
    const spec = makeSpec({
      tier: 'T2',
      currentPhase: 'plan',
      phases: {
        specify: 'done',
        clarify: 'skipped',
        plan: 'in-progress',
        tasks: 'pending',
        implement: 'pending',
      },
    });
    expect(formatStatusBarText(spec)).toBe('$(shield) MinSpec: T2 | Plan | · 50%');
  });
});

describe('formatTooltip()', () => {
  it('shows spec ID and title', () => {
    const spec = makeSpec({ id: 'SPEC-042', title: 'Fix login redirect' });
    expect(formatTooltip(spec)).toBe('SPEC-042: Fix login redirect');
  });

  it('shows helpful text when null', () => {
    expect(formatTooltip(null)).toBe('No active spec. Click to select one.');
  });
});

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

describe('MinSpecStatusBar class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock item state between tests
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
  });

  it('creates a status bar item on construction', () => {
    new MinSpecStatusBar();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(1, 100); // Left=1, priority=100
  });

  it('sets command to minspec.status', () => {
    new MinSpecStatusBar();
    expect(mockStatusBarItem.command).toBe('minspec.status');
  });

  it('update(null) shows "No active spec" and calls show()', () => {
    const bar = new MinSpecStatusBar();
    bar.update(null);

    expect(mockStatusBarItem.text).toBe('$(shield) MinSpec: No active spec');
    expect(mockStatusBarItem.tooltip).toBe('No active spec. Click to select one.');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it('update(spec) shows formatted text and tooltip', () => {
    const bar = new MinSpecStatusBar();

    const spec = makeSpec({
      id: 'SPEC-007',
      title: 'Add caching layer',
      tier: 'T3',
      currentPhase: 'implement',
      phases: {
        specify: 'done',
        clarify: 'done',
        plan: 'done',
        tasks: 'done',
        implement: 'in-progress',
      },
    });
    bar.update(spec);

    // T3 requires specify+plan+tasks+implement; first 3 done, implement
    // in-progress → 3/4 = 75% (clarify done but not required at T3)
    expect(mockStatusBarItem.text).toBe('$(shield) MinSpec: T3 | Implement | · 75%');
    expect(mockStatusBarItem.tooltip).toBe('SPEC-007: Add caching layer');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it('dispose calls dispose on the underlying item', () => {
    const bar = new MinSpecStatusBar();
    bar.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
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
