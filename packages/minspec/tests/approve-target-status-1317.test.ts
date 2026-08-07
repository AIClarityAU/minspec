/**
 * T3 regression — #1317 / #1339: approving a spec turned `main` red.
 *
 * MECHANISM. `approveSpecCommand` validated the spec in the state it was
 * LEAVING, then advanced it into a different state and never re-validated.
 * `validateOwnership` fires only once the spec is in the build path
 * (`phases.plan` is `in-progress`/`done` — spec-validator.ts:783-785), and at
 * approve time `plan` is still `pending`, so the rule short-circuits to `[]` and
 * cannot fire. `phasesForApproval` then sets `plan → 'in-progress'`
 * (lifecycle.ts:180-184) — precisely the predicate that ARMS the rule. With
 * `ownershipDeclaration: 'error'` the newly-armed rule is a hard error, so the
 * next validator run (CI on main) failed on a file nobody had touched.
 *
 * Three specs went through this exact door before it was shut: SPEC-051 (#1300),
 * SPEC-048 and SPEC-049 (#1348) — the last of which is the commit that re-reddened
 * main while #1317 was still open.
 *
 * THE GATE. `violationsIntroducedByApproval` validates the POST-advance state and
 * returns only what the advance would newly introduce. Approval refuses on a
 * non-empty result, so a spec can no longer be approved into a status whose own
 * rules it does not satisfy.
 */
import { describe, it, expect } from 'vitest';
import { parseSpec } from '../src/lib/spec';
import {
  validateSpec,
  violationsIntroducedByApproval,
} from '../src/lib/spec-validator';
import { DEFAULT_CONFIG } from '../src/lib/config';

const FULL_BODY = `## Specify
Build the thing.
- [ ] criterion one

## Plan
Steps.

## Tasks
- [ ] task a

## Implement
code.
`;

/**
 * A primary T3 requirements spec sitting where approval finds it: pre-advance,
 * with `plan: pending`. Only frontmatter lines are conditionally dropped — blank
 * lines inside the body are structural (they separate `## ` sections) and must
 * survive verbatim.
 */
function preApprovalSpec(extraFrontmatter?: string, body: string = FULL_BODY): string {
  const frontmatter = [
    '---',
    'id: SPEC-900',
    'title: Ownership Gate Fixture',
    'type: requirements',
    'tier: T3',
    'status: specifying',
    'created: 2026-08-07',
    ...(extraFrontmatter ? [extraFrontmatter] : []),
    'phases:',
    '  specify: done',
    '  clarify: done',
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${body}`;
}

const ERROR_CONFIG = { ...DEFAULT_CONFIG, ownershipDeclaration: 'error' as const };
const OWNERSHIP_MISSING = 'ownership.implements.missing';

describe('#1317 — the pre-advance blind spot that let main go red', () => {
  it('does NOT fire the ownership rule pre-advance (this is why approval let it through)', () => {
    // Documents the mechanism rather than the symptom: the rule is not merely
    // downgraded here, it is structurally unreachable while plan is `pending`.
    const result = validateSpec(parseSpec(preApprovalSpec()), ERROR_CONFIG);
    expect(result.violations.map((v) => v.rule)).not.toContain(OWNERSHIP_MISSING);
  });

  it('DOES fire once the approval advance is applied — the state approval creates', () => {
    const introduced = violationsIntroducedByApproval(
      parseSpec(preApprovalSpec()),
      ERROR_CONFIG,
    );
    const ownership = introduced.find((v) => v.rule === OWNERSHIP_MISSING);
    expect(ownership, 'approving this spec would arm an error the spec cannot satisfy').toBeDefined();
    expect(ownership!.severity).toBe('error');
    // The refusal must be actionable, not just a denial.
    expect(ownership!.fixHint).toContain('implements:');
  });
});

describe('#1317 — the gate does not over-refuse', () => {
  it('passes a spec that declares owned code', () => {
    const introduced = violationsIntroducedByApproval(
      parseSpec(preApprovalSpec('implements: [packages/minspec/src/lib/foo.ts]')),
      ERROR_CONFIG,
    );
    expect(introduced.map((v) => v.rule)).not.toContain(OWNERSHIP_MISSING);
  });

  it('passes a spec using the documented `none` escape', () => {
    const introduced = violationsIntroducedByApproval(
      parseSpec(
        preApprovalSpec('implements: none\nimplements_reason: prose-only convention'),
      ),
      ERROR_CONFIG,
    );
    expect(introduced.map((v) => v.rule)).not.toContain(OWNERSHIP_MISSING);
  });

  it('respects the config ratchet — a `warn` repo is not gated by this', () => {
    // FR-7 ratchet: the gate introduces NO new policy. A repo that has not opted
    // into `error` keeps approving exactly as before; only errors refuse.
    const introduced = violationsIntroducedByApproval(
      parseSpec(preApprovalSpec()),
      { ...DEFAULT_CONFIG, ownershipDeclaration: 'warn' as const },
    );
    expect(introduced).toEqual([]);
  });

  it('reports only what the ADVANCE introduces, never pre-existing errors', () => {
    // A spec already failing for a phase-INDEPENDENT reason must not have that
    // error re-attributed to the approval — the refusal would then name the wrong
    // cause, which is the false-signpost failure this repo forbids. Asserted as a
    // property over whatever the validator reports, not against a hard-coded rule
    // name, so it keeps holding as rules are added.
    // No acceptance criteria → `acceptance.missing`, which is phase-independent
    // and so fires on BOTH sides of the advance.
    const alreadyBad = parseSpec(
      preApprovalSpec(undefined, '## Specify\nx\n\n## Plan\ny\n\n## Tasks\nz\n\n## Implement\nw\n'),
    );
    const pre = validateSpec(alreadyBad, ERROR_CONFIG).violations.filter(
      (v) => v.severity === 'error',
    );
    expect(pre.length, 'fixture must already fail BEFORE the advance').toBeGreaterThan(0);

    const key = (v: { rule: string; message: string }) => `${v.rule} ${v.message}`;
    const preKeys = new Set(pre.map(key));
    const introduced = violationsIntroducedByApproval(alreadyBad, ERROR_CONFIG);
    for (const v of introduced) {
      expect(preKeys.has(key(v)), `pre-existing error re-attributed to approval: ${v.rule}`).toBe(
        false,
      );
    }
    // ...while still catching the one the advance genuinely arms.
    expect(introduced.map((v) => v.rule)).toContain(OWNERSHIP_MISSING);
  });

  it('leaves a T1/T2 spec alone — the ownership rule is T3+ only', () => {
    const t2 = parseSpec(preApprovalSpec().replace('tier: T3', 'tier: T2'));
    expect(violationsIntroducedByApproval(t2, ERROR_CONFIG)).toEqual([]);
  });
});
