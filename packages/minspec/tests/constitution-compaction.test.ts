import { describe, it, expect } from 'vitest';
import { compactConstitution } from '../src/lib/constitution-compaction';

const SEEDED = `# proj — Constitution

## Invariants

- DRAFT: Runs offline — no network calls without explicit user consent.
  > _proposed because no runtime network-client dependency was detected_

## Constraints

- DRAFT: @aiclarity/shared stays vscode/network-free (Tier-0).
  > _proposed because @aiclarity/shared is a vscode-free workspace package_
`;

describe('compactConstitution (FR-8)', () => {
  it('strips all DRAFT markers and provenance blockquotes', () => {
    const result = compactConstitution(SEEDED);
    expect(result.compacted).not.toMatch(/DRAFT:/);
    expect(result.compacted).not.toMatch(/_proposed because/);
    expect(result.strippedDraftMarkers).toBe(2);
    expect(result.strippedProvenance).toBe(2);
    expect(result.unchanged).toBe(false);
  });

  it('rule text survives compaction meaning-equivalent', () => {
    const result = compactConstitution(SEEDED);
    expect(result.compacted).toContain(
      'Runs offline — no network calls without explicit user consent.',
    );
    expect(result.compacted).toContain('@aiclarity/shared stays vscode/network-free (Tier-0).');
    // bullets preserved
    expect(result.compacted).toMatch(/- Runs offline/);
  });

  it('a constitution with no DRAFT/provenance returns unchanged=true (no silent rewrite)', () => {
    const plain = `## Invariants

1. A human invariant.

## Principles

1. A human principle.
`;
    const result = compactConstitution(plain);
    expect(result.unchanged).toBe(true);
    expect(result.compacted).toBe(plain);
    expect(result.strippedDraftMarkers).toBe(0);
    expect(result.strippedProvenance).toBe(0);
  });
});
