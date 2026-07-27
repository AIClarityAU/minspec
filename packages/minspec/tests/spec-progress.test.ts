import { describe, it, expect } from 'vitest';
import { computeProgress, fromFrontmatter } from '../src/lib/spec-progress';
import type { SpecFrontmatter } from '../src/lib/spec';

// SPEC-040 FR-5: these helpers moved here from `views/status-bar.ts` (tested in
// status-bar.test.ts before the move). Their contract is unchanged — every case
// below is the pre-move assertion verbatim, which is what makes the move
// behaviour-preserving (INV-2) rather than a rewrite.
//
// Note what this file does NOT do: mock `vscode`. status-bar.test.ts must, for
// createStatusBarItem. That absence is the FR-5 property under test — these are
// Tier-0 derivations with a Tier-0 consumer (lib/active-spec.ts), so they belong
// in `lib` and no longer force a lib→views import.

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

  it('omitted tier uses the whole five-phase pipeline (lib/active-spec.ts path)', () => {
    const phases = {
      specify: 'done' as const,
      clarify: 'done' as const,
      plan: 'pending' as const,
      tasks: 'pending' as const,
      implement: 'pending' as const,
    };
    // No tier → legacy whole-pipeline denominator: 2 of 5 → 40%. (A T2 spec with
    // these phases would read 100%; the two callers must not be conflated.)
    expect(computeProgress(phases)).toBe('· 40%');
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

  it('prefers the earliest in-progress phase over an earlier pending one', () => {
    const fm: SpecFrontmatter = {
      id: 'SPEC-004',
      title: 'Out-of-order phases',
      tier: 'T4',
      status: 'implementing',
      created: '2026-05-26',
      phases: {
        specify: 'pending',
        clarify: 'pending',
        plan: 'in-progress',
        tasks: 'pending',
        implement: 'pending',
      },
    };
    // in-progress wins the whole first pass, so an earlier *pending* phase never
    // shadows work actually underway.
    expect(fromFrontmatter(fm).currentPhase).toBe('plan');
  });
});
