/**
 * #2262 — a non-string `type:` (nested block / list) must not make
 * `validateOwnership` throw. `parseSpec` coerces it to untyped.
 */
import { describe, it, expect } from 'vitest';
import { parseSpec } from '../src/lib/spec';
import { validateOwnership } from '../src/lib/spec-validator';
import { DEFAULT_CONFIG } from '../src/lib/config';

const NESTED = `---
id: SPEC-900
type:
  kind: requirements
tier: T3
phases:
  plan: done
---
# body
`;

describe('non-string type: frontmatter (#2262)', () => {
  it('parseSpec treats a nested-block type as untyped', () => {
    expect(parseSpec(NESTED).frontmatter.type).toBeUndefined();
  });

  it('validateOwnership does not throw on a nested-block type', () => {
    expect(() => validateOwnership(parseSpec(NESTED), DEFAULT_CONFIG)).not.toThrow();
  });

  it('a string type is preserved', () => {
    expect(parseSpec(NESTED.replace(/type:\n  kind: requirements/, 'type: requirements')).frontmatter.type).toBe('requirements');
  });
});
