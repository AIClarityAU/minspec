/**
 * SPEC-054 gate-signal linter — one describe block per task.
 */

import { describe, it, expect } from 'vitest';
import * as advisor from '../src/lib/ruleset-advisor';
import type { RulesetFull } from '../src/lib/ruleset-advisor';

describe('INV-4 exports', () => {
  const guarding = {
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'test' }, { context: 'lint' }, { context: '' }],
        },
      },
    ],
  };
  const allRef = {
    conditions: { ref_name: { include: ['~ALL'] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'build' }] },
      },
    ],
  };
  const noChecksRule = {
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
    rules: [{ type: 'deletion' }],
  };

  it('exports both helpers as functions', () => {
    expect(typeof advisor.rulesetGuardsDefaultBranchChecks).toBe('function');
    expect(typeof advisor.extractRequiredContexts).toBe('function');
  });

  it('rulesetGuardsDefaultBranchChecks: guarding ruleset → true', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(guarding)).toBe(true);
  });

  it('rulesetGuardsDefaultBranchChecks: ~ALL ruleset → true', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(allRef)).toBe(true);
  });

  it('rulesetGuardsDefaultBranchChecks: no required_status_checks rule → false', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(noChecksRule)).toBe(false);
  });

  it('rulesetGuardsDefaultBranchChecks: null → false', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(null)).toBe(false);
  });

  it('extractRequiredContexts: guarding ruleset → non-empty contexts only', () => {
    expect(advisor.extractRequiredContexts(guarding as RulesetFull)).toEqual(['test', 'lint']);
  });

  it('extractRequiredContexts: ~ALL ruleset → its contexts', () => {
    expect(advisor.extractRequiredContexts(allRef as RulesetFull)).toEqual(['build']);
  });

  it('extractRequiredContexts: no required_status_checks rule → []', () => {
    expect(advisor.extractRequiredContexts(noChecksRule as RulesetFull)).toEqual([]);
  });

  it('extractRequiredContexts: null → throws as today (callers guard first)', () => {
    expect(() => advisor.extractRequiredContexts(null as unknown as RulesetFull)).toThrow();
  });
});
