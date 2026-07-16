/**
 * SPEC-038 / #460 — required `implements:`/`affects:` spec→code ownership.
 *
 * TEST-FIRST (DR-003): written RED against a not-yet-wired `validateOwnership`.
 * The POSITIVE cases (missing / invalid → a finding) fail until the rule ships;
 * the NEGATIVE guards (clean cases) pass trivially now and must keep passing after.
 * The AC-7 symmetry test is the T0 invariant — it fails in BOTH directions, so the
 * validator-asymmetry class (#137) cannot silently return.
 *
 * Ships as `warn` by default (FR-7); tests force severity by rule identity, not
 * config, so they hold across the warn→error ratchet.
 */
import { describe, it, expect } from 'vitest';
import { validateSpec } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

const MISSING = 'ownership.implements.missing';
const INVALID = 'ownership.implements.invalid';

/** Build a raw spec with ownership frontmatter + phase state. */
function ownSpec(o: {
  tier?: string;
  clarify?: string; // clarify phase status (default done = past Clarify)
  implementsVal?: string; // raw value after `implements:` (omit = absent)
  affectsVal?: string;
  reason?: string; // implements_reason:
  body?: string;
}): string {
  const fm: string[] = [
    '---',
    'id: SPEC-999',
    'title: Ownership Test',
    `tier: ${o.tier ?? 'T3'}`,
    'status: implementing',
    'created: 2026-07-15',
  ];
  if (o.implementsVal !== undefined) fm.push(`implements: ${o.implementsVal}`);
  if (o.affectsVal !== undefined) fm.push(`affects: ${o.affectsVal}`);
  if (o.reason !== undefined) fm.push(`implements_reason: ${o.reason}`);
  fm.push(
    'phases:',
    '  specify: done',
    `  clarify: ${o.clarify ?? 'done'}`,
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
    '',
  );
  const body = o.body ?? '## Specify\nx\n- [ ] c\n\n## Plan\np\n\n## Tasks\n- [ ] t\n\n## Implement\ni\n';
  return fm.join('\n') + '\n' + body;
}

const rules = (raw: string): string[] =>
  validateSpec(parseSpec(raw), DEFAULT_CONFIG).violations.map((v) => v.rule);

describe('SPEC-038 ownership declaration (#460)', () => {
  // ── T0 invariant: symmetry (AC-7 / INV-2 / #137) ──────────────────────────
  it('AC-7 — fails on BOTH missing and invalid (asymmetry cannot return)', () => {
    // missing direction
    expect(rules(ownSpec({ tier: 'T3', clarify: 'done' }))).toContain(MISSING);
    // invalid direction
    expect(rules(ownSpec({ tier: 'T3', implementsVal: '[../../evil.ts]' }))).toContain(INVALID);
  });

  // ── Presence (FR-3) ───────────────────────────────────────────────────────
  it('AC-1 — T3 past Clarify with no implements: → missing', () => {
    expect(rules(ownSpec({ tier: 'T3', clarify: 'done' }))).toContain(MISSING);
  });

  it('AC-2 — implements: none + reason → clean', () => {
    const r = rules(ownSpec({ implementsVal: 'none', reason: 'policy spec — owns no code' }));
    expect(r).not.toContain(MISSING);
    expect(r).not.toContain(INVALID);
  });

  it('AC-2b — implements: none WITHOUT a reason → missing (escape is not free, FR-5)', () => {
    expect(rules(ownSpec({ implementsVal: 'none' }))).toContain(MISSING);
  });

  // ── Validity (FR-4) ───────────────────────────────────────────────────────
  it('AC-3 — a declared but non-existent path is valid (greenfield ownership)', () => {
    const r = rules(ownSpec({ implementsVal: '[packages/minspec/src/lib/does-not-exist-yet.ts]' }));
    expect(r).not.toContain(INVALID);
    expect(r).not.toContain(MISSING); // a real declaration satisfies presence too
  });

  it('AC-4 — absolute / parent-escape paths → invalid', () => {
    expect(rules(ownSpec({ implementsVal: '[/etc/passwd.ts]' }))).toContain(INVALID);
    expect(rules(ownSpec({ implementsVal: '[../x.ts]' }))).toContain(INVALID);
  });

  // ── Scope (FR-6, option (a): required T3/T4 only) ─────────────────────────
  it('AC-6 — T1/T2 without implements: is exempt (clean)', () => {
    expect(rules(ownSpec({ tier: 'T2', clarify: 'done' }))).not.toContain(MISSING);
    expect(rules(ownSpec({ tier: 'T1', clarify: 'done' }))).not.toContain(MISSING);
  });

  // ── Trigger predicate (P2 — phases.clarify) ───────────────────────────────
  it('a T3 still in Clarify (clarify: pending) is NOT yet required', () => {
    expect(rules(ownSpec({ tier: 'T3', clarify: 'pending' }))).not.toContain(MISSING);
  });
});
