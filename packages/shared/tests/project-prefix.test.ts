/**
 * T0/T1 — Cross-project reference prefixes (DR-053 / #500).
 *
 * Pure, deterministic, Tier-0: same input → identical output, no fs/vscode/net.
 *
 * T0 = the never-fail-loud invariant (unknown prefix resolves, never throws) +
 *      the local-vs-cross disambiguation that keeps a bare id from being read as
 *      prefixed. T1 = the parse/resolve/format/suggest contract shapes.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePrefixTable,
  resolveRef,
  formatCrossRef,
  suggestPrefixDeterministic,
  isCrossProjectRef,
  EMPTY_PREFIX_MAP,
  type PrefixMap,
} from '@aiclarity/shared';

const TABLE = `
# Project Prefixes

| Prefix | Project | Repo                   |
|--------|---------|------------------------|
| MS     | minspec | AIClarityAU/minspec    |
| SC     | scrooge | AIClarityAU/scroogellm |
| SB     | sealbox | AIClarityAU/sealbox    |
`;

function map(): PrefixMap {
  return parsePrefixTable(TABLE);
}

// ---------------------------------------------------------------------------
// parsePrefixTable
// ---------------------------------------------------------------------------
describe('parsePrefixTable', () => {
  it('parses each data row into both indexes', () => {
    const m = map();
    expect(m.byPrefix.size).toBe(3);
    expect(m.byPrefix.get('MS')).toEqual({ prefix: 'MS', project: 'minspec', repo: 'AIClarityAU/minspec' });
    expect(m.byProject.get('scrooge')?.prefix).toBe('SC');
    expect(m.byProject.get('sealbox')?.repo).toBe('AIClarityAU/sealbox');
  });

  it('skips the header + separator rows and blank lines', () => {
    const m = map();
    expect(m.byPrefix.has('PREFIX')).toBe(false);
    expect(m.byPrefix.has('---')).toBe(false);
  });

  it('uppercases prefixes so the table may be written in any case', () => {
    const m = parsePrefixTable('| ms | minspec |');
    expect(m.byPrefix.get('MS')?.project).toBe('minspec');
  });

  it('treats the repo column as optional', () => {
    const m = parsePrefixTable('| MS | minspec |');
    expect(m.byPrefix.get('MS')).toEqual({ prefix: 'MS', project: 'minspec', repo: undefined });
  });

  it('ignores malformed rows rather than throwing (robust Tier-0 read)', () => {
    const m = parsePrefixTable('| MS | minspec |\n| onlyonecell |\n| |\nnot a table row\n| 12 | bad-prefix |');
    expect(m.byPrefix.size).toBe(1);
    expect(m.byPrefix.get('MS')?.project).toBe('minspec');
  });

  it('first occurrence of a prefix wins (later duplicate dropped)', () => {
    const m = parsePrefixTable('| MS | minspec |\n| MS | mimic |');
    expect(m.byPrefix.get('MS')?.project).toBe('minspec');
  });

  it('returns an empty map for empty/undefined input', () => {
    expect(parsePrefixTable('').byPrefix.size).toBe(0);
    expect(parsePrefixTable(undefined as unknown as string).byPrefix.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveRef — cross-project
// ---------------------------------------------------------------------------
describe('resolveRef — cross-project SDD refs', () => {
  it('resolves a known-prefix SDD ref', () => {
    expect(resolveRef('MS-SPEC-019', map())).toEqual({
      status: 'cross-project',
      kind: 'SPEC',
      localId: 'SPEC-019',
      num: 19,
      prefix: 'MS',
      project: 'minspec',
      repo: 'AIClarityAU/minspec',
    });
  });

  it('resolves DR and EPIC kinds', () => {
    expect(resolveRef('SC-DR-007', map())).toMatchObject({ status: 'cross-project', kind: 'DR', localId: 'DR-007', project: 'scrooge' });
    expect(resolveRef('SB-EPIC-002', map())).toMatchObject({ status: 'cross-project', kind: 'EPIC', localId: 'EPIC-002', project: 'sealbox' });
  });

  it('resolves a cross-project issue/PR ref', () => {
    expect(resolveRef('SC#26', map())).toEqual({
      status: 'cross-project',
      kind: 'ISSUE',
      localId: '#26',
      num: 26,
      prefix: 'SC',
      project: 'scrooge',
      repo: 'AIClarityAU/scroogellm',
    });
  });
});

describe('resolveRef — unknown prefix is advisory, never fatal (T0 never-fail-loud)', () => {
  it('returns unknown-prefix for an SDD ref with no table row', () => {
    expect(resolveRef('ZZ-SPEC-001', map())).toEqual({
      status: 'unknown-prefix',
      kind: 'SPEC',
      localId: 'SPEC-001',
      num: 1,
      prefix: 'ZZ',
    });
  });

  it('returns unknown-prefix for an issue ref with no table row', () => {
    expect(resolveRef('ZZ#9', map())).toMatchObject({ status: 'unknown-prefix', kind: 'ISSUE', prefix: 'ZZ', num: 9 });
  });

  it('never throws — even against the empty map', () => {
    expect(() => resolveRef('QQ-DR-001', EMPTY_PREFIX_MAP)).not.toThrow();
    expect(resolveRef('QQ-DR-001')).toMatchObject({ status: 'unknown-prefix', prefix: 'QQ' });
  });
});

// ---------------------------------------------------------------------------
// resolveRef — local + non-refs (disambiguation)
// ---------------------------------------------------------------------------
describe('resolveRef — local ids are NOT read as prefixed', () => {
  it('bare SDD ids resolve local', () => {
    expect(resolveRef('SPEC-019', map())).toEqual({ status: 'local', kind: 'SPEC', localId: 'SPEC-019', num: 19 });
    expect(resolveRef('DR-053', map())).toMatchObject({ status: 'local', kind: 'DR', num: 53 });
    expect(resolveRef('EPIC-010', map())).toMatchObject({ status: 'local', kind: 'EPIC', num: 10 });
  });

  it('bare issue ref resolves local', () => {
    expect(resolveRef('#500', map())).toEqual({ status: 'local', kind: 'ISSUE', localId: '#500', num: 500 });
  });

  it('local resolution does not depend on the map', () => {
    expect(resolveRef('SPEC-019', EMPTY_PREFIX_MAP)).toMatchObject({ status: 'local', kind: 'SPEC' });
  });
});

describe('resolveRef — non-reference tokens return null', () => {
  it.each(['', 'hello', 'SPEC', 'SPEC-', 'MS-', 'MS-FOO-1', '#', 'MS##1', 'M-SPEC-1', 'ABCDEF-SPEC-1'])(
    'returns null for %j',
    (tok) => {
      expect(resolveRef(tok, map())).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// formatCrossRef
// ---------------------------------------------------------------------------
describe('formatCrossRef', () => {
  it('joins an SDD id with a dash', () => {
    expect(formatCrossRef('SPEC-019', 'minspec', map())).toBe('MS-SPEC-019');
    expect(formatCrossRef('DR-007', 'scrooge', map())).toBe('SC-DR-007');
  });

  it('joins an issue ref directly onto the #', () => {
    expect(formatCrossRef('#500', 'minspec', map())).toBe('MS#500');
  });

  it('round-trips through resolveRef', () => {
    const m = map();
    const s = formatCrossRef('SPEC-019', 'minspec', m)!;
    expect(resolveRef(s, m)).toMatchObject({ status: 'cross-project', project: 'minspec', localId: 'SPEC-019' });
  });

  it('returns null for a project with no prefix (caller must suggest, not emit ambiguous)', () => {
    expect(formatCrossRef('SPEC-001', 'nope', map())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// suggestPrefixDeterministic
// ---------------------------------------------------------------------------
describe('suggestPrefixDeterministic', () => {
  it('is deterministic — first two letters, uppercased', () => {
    expect(suggestPrefixDeterministic('minspec')).toBe('MI');
    expect(suggestPrefixDeterministic('scrooge')).toBe('SC');
    expect(suggestPrefixDeterministic('minspec')).toBe('MI');
  });

  it('avoids a taken prefix by walking to the next free second letter', () => {
    const s = suggestPrefixDeterministic('minspec', new Set(['MI']));
    expect(s).not.toBe('MI');
    expect(s[0]).toBe('M');
    expect(s).toHaveLength(2);
  });

  it('handles names with no usable letters', () => {
    expect(suggestPrefixDeterministic('123')).toMatch(/^X[A-Z]$/);
  });
});

// ---------------------------------------------------------------------------
// isCrossProjectRef
// ---------------------------------------------------------------------------
describe('isCrossProjectRef', () => {
  it('true for known and unknown prefixed refs, false for local and non-refs', () => {
    const m = map();
    expect(isCrossProjectRef('MS-SPEC-019', m)).toBe(true);
    expect(isCrossProjectRef('ZZ-SPEC-001', m)).toBe(true);
    expect(isCrossProjectRef('SPEC-019', m)).toBe(false);
    expect(isCrossProjectRef('not a ref', m)).toBe(false);
  });
});
