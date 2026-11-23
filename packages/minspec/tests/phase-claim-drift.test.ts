import { describe, it, expect } from 'vitest';
import { checkPhaseClaimDrift } from '../../../scripts/lib/phase-claim-drift';

const tree = new Set(['a.ts', 'b.sh']);
const probe = (p: string) => tree.has(p);

describe('checkPhaseClaimDrift (#1518)', () => {
  it('flags implement: pending when an implements path exists on the default branch', () => {
    const r = checkPhaseClaimDrift(
      [{ file: 's1', implement: 'pending', implementsTokens: ['a.ts', 'missing.ts'] }],
      probe,
    );
    expect(r.flagged).toEqual([{ file: 's1', paths: ['a.ts'] }]);
    expect(r.unchecked).toEqual([]);
  });

  it('does not flag when no implements path exists (legitimate not-started work)', () => {
    const r = checkPhaseClaimDrift([{ file: 's', implement: 'pending', implementsTokens: ['nope.ts'] }], probe);
    expect(r.flagged).toEqual([]);
  });

  it('exempts implements: none', () => {
    const r = checkPhaseClaimDrift([{ file: 's', implement: 'pending', implementsTokens: ['none'] }], probe);
    expect(r.flagged).toEqual([]);
  });

  it('ignores specs whose implement phase is not pending', () => {
    const r = checkPhaseClaimDrift([{ file: 's', implement: 'in-progress', implementsTokens: ['a.ts'] }], probe);
    expect(r.flagged).toEqual([]);
  });

  it('reports unchecked, never a silent pass, when the ref is unresolvable', () => {
    const r = checkPhaseClaimDrift(
      [{ file: 's', implement: 'pending', implementsTokens: ['a.ts'] }],
      () => undefined,
    );
    expect(r.flagged).toEqual([]);
    expect(r.unchecked).toEqual(['s']);
  });
});
