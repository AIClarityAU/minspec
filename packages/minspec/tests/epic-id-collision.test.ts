/** Epic-id uniqueness (#396) — twin of the DR/spec collision gates. */
import { describe, it, expect } from 'vitest';
import {
  checkDeclaredEpicIds,
  canonicalEpicId,
  declaredEpicId,
} from '../../../scripts/lib/epic-id-collision';

const e = (file: string, id?: string) => ({
  file: `docs/epics/${file}`,
  content: `---\n${id ? `id: ${id}\n` : ''}slug: x\nstatus: active\n---\n# X\n`,
});

describe('checkDeclaredEpicIds', () => {
  it('flags two files declaring the same id', () => {
    const d = checkDeclaredEpicIds([e('EPIC-004-a.md', 'EPIC-004'), e('EPIC-004-b.md', 'EPIC-004')]);
    expect(d).toHaveLength(1);
    expect(d[0].id).toBe('EPIC-004');
    expect(d[0].files).toEqual(['docs/epics/EPIC-004-a.md', 'docs/epics/EPIC-004-b.md']);
  });
  it('treats EPIC-4 and EPIC-004 as one id', () => {
    expect(checkDeclaredEpicIds([e('EPIC-004-a.md', 'EPIC-4'), e('EPIC-004-b.md', 'EPIC-004')])).toHaveLength(1);
  });
  it('catches a file whose declared id collides with another filename id', () => {
    expect(checkDeclaredEpicIds([e('EPIC-005-a.md', 'EPIC-004'), e('EPIC-004-b.md')])).toHaveLength(1);
  });
  it('uses the filename id when no frontmatter id is declared', () => {
    expect(checkDeclaredEpicIds([e('EPIC-004-a.md'), e('EPIC-004-b.md', 'EPIC-004')])).toHaveLength(1);
  });
  it('is clean for unique ids and ignores non-epic files', () => {
    expect(
      checkDeclaredEpicIds([e('EPIC-001-a.md', 'EPIC-001'), e('EPIC-002-b.md', 'EPIC-002'), e('INDEX.md', 'EPIC-001')]),
    ).toEqual([]);
  });
  it('sees ids in CRLF files', () => {
    const crlf = (f: string) => ({ file: `docs/epics/${f}`, content: '---\r\nid: EPIC-009\r\n---\r\n# X\r\n' });
    expect(checkDeclaredEpicIds([crlf('EPIC-009-a.md'), crlf('EPIC-009-b.md')])).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('canonicalEpicId', () => {
    expect(canonicalEpicId('EPIC-7')).toBe('EPIC-007');
    expect(canonicalEpicId('SPEC-007')).toBeUndefined();
  });
  it('declaredEpicId', () => {
    expect(declaredEpicId('---\nid: EPIC-003\n---\n')).toBe('EPIC-003');
    expect(declaredEpicId('no frontmatter')).toBeUndefined();
  });
});
