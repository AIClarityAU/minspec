/**
 * SPEC-051 — ownership declared before approval (T0 invariants).
 *
 * These are the guard's OWN tests. `ownership.test.ts` already covers `validateOwnership`
 * with 14 cases and is untouched — it is the de facto contract for the shared matcher, so
 * the extraction had to keep it green. What is new here is the pre-approval REFUSAL and,
 * most importantly, the parity between the two call sites (INV-5): the whole point of
 * extracting one predicate is that the validator and the guard can never disagree.
 */
import { describe, it, expect } from 'vitest';
import {
  ownershipDeclared,
  ownershipRequiredBeforeBuildBand,
  assertOwnershipDeclared,
  OwnershipUndeclaredError,
  validateOwnership,
} from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

/** Minimal primary spec; `extra` goes inside the frontmatter block. */
function spec(opts: { tier?: string; plan?: string; extra?: string } = {}): string {
  const { tier = 'T4', plan = 'pending', extra = '' } = opts;
  return `---
id: SPEC-999
type: requirements
status: specifying
tier: ${tier}
product: minspec
${extra}phases:
  specify: done
  clarify: done
  plan: ${plan}
  tasks: pending
  implement: pending
---

# SPEC-999 — fixture

## Context
Body.
`;
}

const OWNED = 'implements: [packages/minspec/src/lib/thing.ts]\n';
const NONE_OK = 'implements: none\nimplements_reason: owns no code; modifies existing files\n';
const NONE_BARE = 'implements: none\n';
const JUNK = 'implements: [not-a-path, node_modules/x.ts]\n';

describe('SPEC-051 — ownershipDeclared (the shared matcher)', () => {
  it('T2.1 — an undeclared spec is NOT declared', () => {
    expect(ownershipDeclared(spec())).toBe(false);
  });

  it('a real owned path counts', () => {
    expect(ownershipDeclared(spec({ extra: OWNED }))).toBe(true);
  });

  it('T2.2 — `implements: none` + reason is a valid escape (FR-4)', () => {
    expect(ownershipDeclared(spec({ extra: NONE_OK }))).toBe(true);
  });

  it('the escape is NOT free — `none` without a reason does not count (FR-5)', () => {
    expect(ownershipDeclared(spec({ extra: NONE_BARE }))).toBe(false);
  });

  it('tokens that own nothing leave the gate un-armed, so they do not count', () => {
    expect(ownershipDeclared(spec({ extra: JUNK }))).toBe(false);
  });

  it('T2.4 — a greenfield path (not yet on disk) satisfies it', () => {
    // isValidOwnedPath deliberately excludes existence — ownership is declared before the
    // file is written, which is the entire premise of declaring it before approval.
    expect(ownershipDeclared(spec({ extra: 'implements: [packages/minspec/src/lib/not-created-yet.ts]\n' }))).toBe(true);
  });

  it('unevaluable input never produces a refusal verdict', () => {
    // The guard must not refuse on bytes it could not read; the validator re-checks against
    // real parsed content downstream.
    expect(ownershipDeclared('' as string)).toBe(true);
    expect(ownershipDeclared(undefined as unknown as string)).toBe(true);
  });
});

describe('SPEC-051 — scope (AC-7)', () => {
  it('T2.3 — T1/T2 are out of scope', () => {
    expect(ownershipRequiredBeforeBuildBand('requirements', 'T1' as never, 'pending')).toBe(false);
    expect(ownershipRequiredBeforeBuildBand('requirements', 'T2' as never, 'pending')).toBe(false);
  });

  it('T3/T4 primary specs are in scope', () => {
    expect(ownershipRequiredBeforeBuildBand('requirements', 'T3' as never, 'pending')).toBe(true);
    expect(ownershipRequiredBeforeBuildBand('', 'T4' as never, 'pending')).toBe(true);
  });

  it('a non-primary (design/tasks) file is out of scope', () => {
    expect(ownershipRequiredBeforeBuildBand('design', 'T4' as never, 'pending')).toBe(false);
    expect(ownershipRequiredBeforeBuildBand('tasks', 'T4' as never, 'pending')).toBe(false);
  });

  it('an absent/unknown tier is out of scope, not accidentally IN it', () => {
    // Regression: `TIER_RANK[undefined] < 3` is `undefined < 3` === false, which would fall
    // THROUGH to the declaration check instead of skipping. Coerced with `?? 0`.
    expect(ownershipRequiredBeforeBuildBand('requirements', undefined as never, 'pending')).toBe(false);
  });

  it('a spec ALREADY in the build band is the validator\'s business, not the guard\'s', () => {
    // Re-refusing here would block a legitimate re-approval of an in-flight spec.
    expect(ownershipRequiredBeforeBuildBand('requirements', 'T4' as never, 'in-progress')).toBe(false);
    expect(ownershipRequiredBeforeBuildBand('requirements', 'T4' as never, 'done')).toBe(false);
  });
});

describe('SPEC-051 — assertOwnershipDeclared (FR-1/FR-2)', () => {
  it('refuses an undeclared T4 primary spec about to cross into Plan', () => {
    expect(() => assertOwnershipDeclared(spec(), 'requirements', 'T4' as never, 'pending', '/x/requirements.md'))
      .toThrow(OwnershipUndeclaredError);
  });

  it('the refusal carries the SAME fix wording the validator emits (one message, two surfaces)', () => {
    let msg = '';
    try {
      assertOwnershipDeclared(spec(), 'requirements', 'T4' as never, 'pending', '/x/requirements.md');
    } catch (e) {
      msg = (e as Error).message;
    }
    const violation = validateOwnership(parseSpec(spec({ plan: 'in-progress' })), DEFAULT_CONFIG)
      .find((v) => v.rule === 'ownership.implements.missing');
    expect(violation).toBeDefined();
    expect(msg).toContain(violation!.fixHint);
  });

  it('does not throw once ownership is declared', () => {
    expect(() => assertOwnershipDeclared(spec({ extra: OWNED }), 'requirements', 'T4' as never, 'pending', '/x'))
      .not.toThrow();
  });

  it('FR-5 — it never AUTHORS ownership, it only refuses', () => {
    const before = spec();
    try {
      assertOwnershipDeclared(before, 'requirements', 'T4' as never, 'pending', '/x');
    } catch {
      /* expected */
    }
    // The guard is pure: the caller's bytes are untouched, so nothing was written on the
    // human's behalf (risk R4 / the no-borrowed-sign-off rule).
    expect(before).toBe(spec());
  });
});

describe('SPEC-051 INV-5 — guard and validator never disagree (risk R5)', () => {
  // The parity test DR-077 sanctions for a rule with two call sites. Both must reach the
  // same verdict over one shared fixture table; if either grows a private rule, this fails.
  const FIXTURES: Array<{ name: string; extra: string; declared: boolean }> = [
    { name: 'undeclared', extra: '', declared: false },
    { name: 'owned path', extra: OWNED, declared: true },
    { name: 'none + reason', extra: NONE_OK, declared: true },
    { name: 'none, no reason', extra: NONE_BARE, declared: false },
    { name: 'owns-nothing tokens', extra: JUNK, declared: false },
    { name: 'greenfield path', extra: 'implements: [packages/minspec/src/lib/new.ts]\n', declared: true },
  ];

  for (const f of FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      const raw = spec({ extra: f.extra });

      // Guard's view (pre-Plan).
      expect(ownershipDeclared(raw)).toBe(f.declared);

      // Validator's view — same bytes, but past the Plan boundary so the rule is armed.
      const armed = spec({ extra: f.extra, plan: 'in-progress' });
      const missing = validateOwnership(parseSpec(armed), DEFAULT_CONFIG)
        .some((v) => v.rule === 'ownership.implements.missing');

      // The validator flags MISSING exactly when the guard says NOT declared.
      expect(missing).toBe(!f.declared);
    });
  }
});
