/**
 * `implement.claimed-without-evidence` (#1751) — the direction `validateOwnership`
 * does not check.
 *
 * `validateOwnership` (SPEC-038 / #460, `ownership.test.ts`) asserts a declared
 * `implements:` path is well-shaped, existing-or-not-yet — a not-yet-created path
 * is valid GREENFIELD ownership by design. Nothing previously checked the other
 * direction: when `phases.implement` is `in-progress`/`done` (the spec is
 * ACTIVELY claiming implementation progress or completion), nothing asserted the
 * paths it names actually exist. SPEC-065's backfilled `phases:` block claimed
 * `implement: in-progress` with none of its five declared `implements:` files on
 * disk — only an ai-review LLM panel caught it (PR #1661); this rule makes that
 * deterministic.
 *
 * `pathExists` is a caller-supplied resolver (spec-validator.ts is filesystem-free
 * by design), so every test below drives it with an in-memory `Set`, never real
 * fs — the resolver's CONTRACT is what's under test, not any particular fs call.
 */
import { describe, it, expect } from 'vitest';
import { validateSpec, validateImplementEvidence } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

const RULE = 'implement.claimed-without-evidence';

/** Build a raw spec with `implements:` + phase state. */
function evidenceSpec(o: {
  implementsVal?: string; // raw value after `implements:` (omit = absent)
  implement?: string; // implement phase status (default 'in-progress')
  tier?: string;
}): string {
  const fm: string[] = [
    '---',
    'id: SPEC-999',
    'title: Evidence Test',
    `tier: ${o.tier ?? 'T3'}`,
    'status: implementing',
    'created: 2026-07-15',
  ];
  if (o.implementsVal !== undefined) fm.push(`implements: ${o.implementsVal}`);
  fm.push(
    'phases:',
    '  specify: done',
    '  clarify: done',
    '  plan: done',
    '  tasks: done',
    `  implement: ${o.implement ?? 'in-progress'}`,
    '---',
    '',
  );
  return fm.join('\n') + '\n## Specify\nx\n\n## Implement\ni\n';
}

/** A pathExists resolver backed by an in-memory allowlist — no real fs. */
const existsIn = (present: readonly string[]) => (p: string): boolean => present.includes(p);

const rulesFor = (raw: string, pathExists?: (p: string) => boolean): string[] =>
  validateSpec(parseSpec(raw), DEFAULT_CONFIG, { pathExists }).violations.map((v) => v.rule);

describe('implement.claimed-without-evidence (#1751)', () => {
  it('fires when implement: in-progress and the declared path does not exist', () => {
    const raw = evidenceSpec({ implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]' });
    expect(rulesFor(raw, existsIn([]))).toContain(RULE);
  });

  it('fires when implement: done and the declared path does not exist', () => {
    const raw = evidenceSpec({
      implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]',
      implement: 'done',
    });
    expect(rulesFor(raw, existsIn([]))).toContain(RULE);
  });

  it('does NOT fire when the declared path exists on disk', () => {
    const raw = evidenceSpec({ implementsVal: '[packages/minspec/src/lib/spec-validator.ts]' });
    expect(rulesFor(raw, existsIn(['packages/minspec/src/lib/spec-validator.ts']))).not.toContain(RULE);
  });

  it('does NOT fire when implement: pending — the spec is not yet claiming progress', () => {
    const raw = evidenceSpec({
      implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]',
      implement: 'pending',
    });
    expect(rulesFor(raw, existsIn([]))).not.toContain(RULE);
  });

  it('does NOT fire when implement: skipped — a deliberate skip is not a claim', () => {
    const raw = evidenceSpec({
      implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]',
      implement: 'skipped',
    });
    expect(rulesFor(raw, existsIn([]))).not.toContain(RULE);
  });

  it('does NOT fire on the implements: none escape — no paths declared to check', () => {
    const raw = evidenceSpec({ implementsVal: 'none' });
    expect(rulesFor(raw, existsIn([]))).not.toContain(RULE);
  });

  it('does NOT fire with no implements: declared at all', () => {
    const raw = evidenceSpec({});
    expect(rulesFor(raw, existsIn([]))).not.toContain(RULE);
  });

  it('fires when at least one of several declared paths is missing, even if others exist', () => {
    const raw = evidenceSpec({
      implementsVal: '[packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/ghost.ts]',
    });
    expect(rulesFor(raw, existsIn(['packages/minspec/src/lib/spec-validator.ts']))).toContain(RULE);
  });

  it('omitting the pathExists resolver skips the check entirely (no false positive without fs access)', () => {
    // No resolver supplied at all — mirrors a caller with no filesystem access
    // (same no-false-positive contract as knownEpicRefs / siblingShardFiles).
    const raw = evidenceSpec({ implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]' });
    expect(rulesFor(raw)).not.toContain(RULE);
  });

  it('severity respects config.implementEvidence (warn by default, error when ratcheted)', () => {
    const raw = evidenceSpec({ implementsVal: '[packages/minspec/src/lib/does-not-exist.ts]' });
    const parsed = parseSpec(raw);
    const warnResult = validateImplementEvidence(parsed, DEFAULT_CONFIG, existsIn([]));
    expect(warnResult).toHaveLength(1);
    expect(warnResult[0].severity).toBe('warning');

    const errorResult = validateImplementEvidence(
      parsed,
      { ...DEFAULT_CONFIG, implementEvidence: 'error' },
      existsIn([]),
    );
    expect(errorResult[0].severity).toBe('error');
  });

  it('a malformed (non-owned-path) token is not double-flagged here — ownership.implements.invalid already covers it', () => {
    const raw = evidenceSpec({ implementsVal: '[../evil.ts]' });
    expect(rulesFor(raw, existsIn([]))).not.toContain(RULE);
  });
});
