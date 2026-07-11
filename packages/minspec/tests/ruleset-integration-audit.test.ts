/**
 * T0 — ruleset integration-id pin audit (#560 harden).
 *
 * Covers the exact bug shape from #560 (a required check pinned to an app
 * that never posts it, e.g. `ai-review` pinned to `15368` when the real
 * poster is `4212099`) plus the surrounding decision states: ok, unobserved,
 * unpinned, and defensive parsing of malformed GitHub API responses.
 */

import { describe, it, expect } from 'vitest';
import {
  extractRequiredCheckPins,
  extractObservedCheckRuns,
  auditRequiredCheckPins,
  hasIntegrationIdMismatch,
  type RequiredCheckPin,
  type ObservedCheckRun,
} from '../src/lib/ruleset-integration-audit';

// ─── extractRequiredCheckPins ────────────────────────────────────────────────

describe('extractRequiredCheckPins', () => {
  it('pulls context + integration_id out of a required_status_checks rule', () => {
    const detail = {
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'ai-review', integration_id: 15368 },
              { context: 'lint' },
            ],
          },
        },
      ],
    };
    expect(extractRequiredCheckPins(detail)).toEqual([
      { context: 'ai-review', integrationId: 15368 },
      { context: 'lint', integrationId: undefined },
    ]);
  });

  it('ignores non-required_status_checks rules', () => {
    const detail = { rules: [{ type: 'deletion' }, { type: 'required_status_checks', parameters: {} }] };
    expect(extractRequiredCheckPins(detail)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['no rules array', {}],
    ['rules not an array', { rules: 'nope' }],
    ['rule not an object', { rules: [null, 42] }],
    ['missing parameters', { rules: [{ type: 'required_status_checks' }] }],
    [
      'checks not an array',
      { rules: [{ type: 'required_status_checks', parameters: { required_status_checks: 'nope' } }] },
    ],
    [
      'check missing context',
      { rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{}] } }] },
    ],
  ])('tolerates malformed input: %s', (_label, input) => {
    expect(extractRequiredCheckPins(input)).toEqual([]);
  });
});

// ─── extractObservedCheckRuns ────────────────────────────────────────────────

describe('extractObservedCheckRuns', () => {
  it('flattens check_runs across multiple sampled responses', () => {
    const responses = [
      { check_runs: [{ name: 'ai-review', app: { id: 4212099 } }] },
      { check_runs: [{ name: 'ai-review', app: { id: 4212099 } }, { name: 'lint', app: { id: 15368 } }] },
    ];
    expect(extractObservedCheckRuns(responses)).toEqual([
      { name: 'ai-review', appId: 4212099 },
      { name: 'ai-review', appId: 4212099 },
      { name: 'lint', appId: 15368 },
    ]);
  });

  it.each([
    ['null response', [null]],
    ['non-object response', ['nope']],
    ['check_runs not an array', [{ check_runs: 'nope' }]],
    ['run not an object', [{ check_runs: [null, 42] }]],
    ['run missing name', [{ check_runs: [{ app: { id: 1 } }] }]],
  ])('tolerates malformed input: %s', (_label, input) => {
    expect(extractObservedCheckRuns(input)).toEqual([]);
  });

  it('reports appId undefined when the run has no app object', () => {
    expect(extractObservedCheckRuns([{ check_runs: [{ name: 'build' }] }])).toEqual([
      { name: 'build', appId: undefined },
    ]);
  });
});

// ─── auditRequiredCheckPins ──────────────────────────────────────────────────

describe('auditRequiredCheckPins', () => {
  it('flags the exact #560 bug shape: pinned to the wrong app that never posts the context', () => {
    const pins: RequiredCheckPin[] = [{ context: 'ai-review', integrationId: 15368 }];
    const observed: ObservedCheckRun[] = [
      { name: 'ai-review', appId: 4212099 },
      { name: 'ai-review', appId: 4212099 },
    ];
    const findings = auditRequiredCheckPins(pins, observed);
    expect(findings).toEqual([
      {
        context: 'ai-review',
        pinnedIntegrationId: 15368,
        observedAppIds: [4212099],
        status: 'mismatch',
        detail: expect.stringContaining('app 4212099'),
      },
    ]);
    expect(hasIntegrationIdMismatch(findings)).toBe(true);
  });

  it('reports ok when the pin matches the real poster (ready-to-merge / #560\'s correctly-pinned check)', () => {
    const pins: RequiredCheckPin[] = [{ context: 'ready-to-merge', integrationId: 15368 }];
    const observed: ObservedCheckRun[] = [{ name: 'ready-to-merge', appId: 15368 }];
    const findings = auditRequiredCheckPins(pins, observed);
    expect(findings[0].status).toBe('ok');
    expect(hasIntegrationIdMismatch(findings)).toBe(false);
  });

  it('reports unpinned when no integration_id is set — nothing to verify', () => {
    const findings = auditRequiredCheckPins([{ context: 'lint' }], [{ name: 'lint', appId: 15368 }]);
    expect(findings[0].status).toBe('unpinned');
    expect(hasIntegrationIdMismatch(findings)).toBe(false);
  });

  it('reports unobserved (inconclusive, not a failure) when the context never appeared in the sample', () => {
    const findings = auditRequiredCheckPins([{ context: 'ai-review', integrationId: 4212099 }], []);
    expect(findings[0].status).toBe('unobserved');
    expect(findings[0].observedAppIds).toEqual([]);
    expect(hasIntegrationIdMismatch(findings)).toBe(false);
  });

  it('handles multiple pins independently and preserves input order', () => {
    const pins: RequiredCheckPin[] = [
      { context: 'ai-review', integrationId: 15368 }, // mismatch
      { context: 'ready-to-merge', integrationId: 15368 }, // ok
      { context: 'lint' }, // unpinned
      { context: 'build', integrationId: 999 }, // unobserved
    ];
    const observed: ObservedCheckRun[] = [
      { name: 'ai-review', appId: 4212099 },
      { name: 'ready-to-merge', appId: 15368 },
      { name: 'lint', appId: 15368 },
    ];
    const statuses = auditRequiredCheckPins(pins, observed).map((f) => f.status);
    expect(statuses).toEqual(['mismatch', 'ok', 'unpinned', 'unobserved']);
  });

  it('ignores observed runs with no app id when matching', () => {
    const findings = auditRequiredCheckPins(
      [{ context: 'ai-review', integrationId: 4212099 }],
      [{ name: 'ai-review', appId: undefined }],
    );
    // No usable app id was observed for this context, so it is unverifiable, not a false "ok".
    expect(findings[0].status).toBe('unobserved');
  });

  it('sorts and de-duplicates multiple distinct observed app ids for one context', () => {
    const findings = auditRequiredCheckPins(
      [{ context: 'ai-review', integrationId: 1 }],
      [
        { name: 'ai-review', appId: 30 },
        { name: 'ai-review', appId: 10 },
        { name: 'ai-review', appId: 30 },
      ],
    );
    expect(findings[0].observedAppIds).toEqual([10, 30]);
  });
});
