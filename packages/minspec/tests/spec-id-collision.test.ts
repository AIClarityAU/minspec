/**
 * Spec-id uniqueness (#1418) — the spec-side twin of the DR collision gate.
 *
 * The live incident these pin: five specs declaring `id: SPEC-052` at once, which made
 * `facts approval SPEC-052` report UNAPPROVED while the maintainer's real approval sat on a
 * different directory of the same id.
 */
import { describe, it, expect } from 'vitest';
import {
  checkDeclaredSpecIds,
  specIdFromPath,
  declaredSpecId,
  canonicalSpecId,
} from '../../../scripts/lib/spec-id-collision';

const fm = (id?: string) =>
  `---\n${id ? `id: ${id}\n` : ''}type: requirements\nstatus: specifying\ntier: T3\n---\n\n# X\n`;

const at = (dir: string, id?: string) => ({
  file: `specs/minspec/${dir}/requirements.md`,
  content: fm(id),
});

describe('specIdFromPath', () => {
  it('reads the id from the spec DIRECTORY, which is what a cross-PR check can see', () => {
    expect(specIdFromPath('specs/minspec/SPEC-052-push-work-via-branch/requirements.md')).toBe('SPEC-052');
    expect(specIdFromPath('specs/agent-execute/SPEC-019-execution-substrate/design.md')).toBe('SPEC-019');
  });

  it('canonicalises padding so SPEC-52 and SPEC-052 are one id, not two', () => {
    expect(specIdFromPath('specs/minspec/SPEC-52-x/requirements.md')).toBe('SPEC-052');
    expect(canonicalSpecId('7')).toBe('SPEC-007');
  });

  it('returns undefined for a non-spec path rather than guessing', () => {
    expect(specIdFromPath('docs/decisions/DR-052.md')).toBeUndefined();
    expect(specIdFromPath('README.md')).toBeUndefined();
  });
});

describe('declaredSpecId', () => {
  it('reads only the top-level frontmatter id', () => {
    expect(declaredSpecId(fm('SPEC-004'))).toBe('SPEC-004');
    expect(declaredSpecId(fm())).toBeUndefined();
  });

  it('does not read an `id:` from the body', () => {
    expect(declaredSpecId('# Title\n\nid: SPEC-999 mentioned in prose\n')).toBeUndefined();
  });
});

describe('checkDeclaredSpecIds — duplicates', () => {
  it('a clean corpus produces no defects', () => {
    expect(checkDeclaredSpecIds([at('SPEC-052-a', 'SPEC-052'), at('SPEC-053-b', 'SPEC-053')])).toEqual([]);
  });

  it('THE INCIDENT — five specs on one id are reported as one duplicate defect', () => {
    const defects = checkDeclaredSpecIds([
      at('SPEC-052-push-work-via-branch', 'SPEC-052'),
      at('SPEC-052-explain-affordance', 'SPEC-052'),
      at('SPEC-052-gate-signal-linter', 'SPEC-052'),
      at('SPEC-052-spec-id-in-tab-title', 'SPEC-052'),
      at('SPEC-052-stranded-branch-detection', 'SPEC-052'),
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('duplicate');
    expect(defects[0].files).toHaveLength(5);
    // The fix hint must say which one keeps the id — renaming the approved spec's directory
    // would strand its path-keyed sidecar.
    expect(defects[0].message).toContain('APPROVED');
  });

  it('padding variants collide — SPEC-52 and SPEC-052 are the same primary key', () => {
    const defects = checkDeclaredSpecIds([at('SPEC-052-a', 'SPEC-052'), at('SPEC-52-b', 'SPEC-52')]);
    expect(defects.map((d) => d.kind)).toEqual(['duplicate']);
  });
});

describe('checkDeclaredSpecIds — id/directory mismatch', () => {
  it('flags a spec whose declared id disagrees with its directory', () => {
    const defects = checkDeclaredSpecIds([at('SPEC-099-wrong', 'SPEC-004')]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('mismatch');
  });

  it('flags an id that is not a SPEC id at all', () => {
    expect(checkDeclaredSpecIds([at('SPEC-099-x', 'DR-004')])[0].kind).toBe('mismatch');
    expect(checkDeclaredSpecIds([at('SPEC-099-x', '99')])[0].kind).toBe('mismatch');
  });

  it('a mismatched spec is NOT also counted as a duplicate — one defect per file', () => {
    // SPEC-099-wrong declares SPEC-004, which SPEC-004-real also declares. It must be
    // reported once, as the mismatch it is, not twice.
    const defects = checkDeclaredSpecIds([at('SPEC-004-real', 'SPEC-004'), at('SPEC-099-wrong', 'SPEC-004')]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('mismatch');
  });

  it('an ABSENT id is left to Rule 2, not double-reported here', () => {
    expect(checkDeclaredSpecIds([at('SPEC-052-a')])).toEqual([]);
  });

  it('a non-spec file in the list is skipped, never guessed at', () => {
    expect(checkDeclaredSpecIds([{ file: 'docs/decisions/DR-052.md', content: fm('DR-052') }])).toEqual([]);
  });
});
