import { describe, it, expect } from 'vitest';
import { formatBaselineReport, baselineWarningAnnotation } from '../../../scripts/check-baseline-integrity';

const clean = { total: 3, recovered: 2, unrecoverable: 0, noBaseline: 1, unrecoverableSpecs: [] };
const drift = {
  total: 2,
  recovered: 0,
  unrecoverable: 2,
  noBaseline: 0,
  unrecoverableSpecs: ['specs/a/requirements.md', 'specs/b/requirements.md'],
};

describe('#435 baseline-integrity report', () => {
  it('lists counts and every unrecoverable spec when drift exists', () => {
    const out = formatBaselineReport(drift).join('\n');
    expect(out).toContain('2 unrecoverable');
    expect(out).toContain('WARNING');
    expect(out).toContain('specs/a/requirements.md');
    expect(out).toContain('specs/b/requirements.md');
  });
  it('emits no warning when nothing is unrecoverable', () => {
    expect(formatBaselineReport(clean).join('\n')).not.toContain('WARNING');
    expect(baselineWarningAnnotation(clean)).toBeUndefined();
  });
  it('annotation names the specs', () => {
    expect(baselineWarningAnnotation(drift)).toMatch(/^::warning .*specs\/a\/requirements\.md/);
  });
});
