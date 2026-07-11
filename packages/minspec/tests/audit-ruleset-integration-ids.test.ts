/**
 * T1 — arg parsing for the #560 harden CLI (scripts/audit-ruleset-integration-ids.ts).
 * The network/`gh` IO in that script is a thin, untested-by-design shell (same
 * convention as auto-merge-gate.ts) — only the pure parseArgs is unit-tested here.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../scripts/audit-ruleset-integration-ids';

describe('parseArgs', () => {
  it('parses owner/repo/ruleset-id and defaults sample-size to 10', () => {
    const args = parseArgs(['--owner', 'AIClarityAU', '--repo', 'minspec', '--ruleset-id', '18352261']);
    expect(args).toEqual({
      owner: 'AIClarityAU',
      repo: 'minspec',
      rulesetId: '18352261',
      ref: undefined,
      sampleSize: 10,
    });
  });

  it('parses an explicit ref and sample-size', () => {
    const args = parseArgs([
      '--owner', 'AIClarityAU',
      '--repo', 'minspec',
      '--ruleset-id', '1',
      '--ref', 'main',
      '--sample-size', '25',
    ]);
    expect(args.ref).toBe('main');
    expect(args.sampleSize).toBe(25);
  });

  it('falls back sample-size to 10 on a non-positive or non-numeric value', () => {
    expect(parseArgs(['--sample-size', '0']).sampleSize).toBe(10);
    expect(parseArgs(['--sample-size', '-5']).sampleSize).toBe(10);
    expect(parseArgs(['--sample-size', 'nope']).sampleSize).toBe(10);
  });

  it('defaults owner/repo/ruleset-id to empty string when absent', () => {
    expect(parseArgs([])).toEqual({ owner: '', repo: '', rulesetId: '', ref: undefined, sampleSize: 10 });
  });
});
