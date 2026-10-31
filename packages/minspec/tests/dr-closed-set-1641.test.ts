/** #1641 — DR frontmatter closed-set rule (status legal set, retired field aliases). */
import { describe, it, expect } from 'vitest';
import { checkDrFrontmatterClosedSet } from '../../../scripts/lib/dr-closed-set';

const dr = (fm: string) => ({ file: 'docs/decisions/DR-900.md', content: `---\n${fm}\n---\n# T\n` });

describe('checkDrFrontmatterClosedSet', () => {
  it('accepts every legal status, with a trailing comment and CRLF', () => {
    for (const s of ['proposed', 'accepted', 'deprecated', 'superseded']) {
      expect(checkDrFrontmatterClosedSet([dr(`id: DR-900\nstatus: ${s}   # note`)])).toEqual([]);
    }
    expect(checkDrFrontmatterClosedSet([{ file: 'DR-1.md', content: '---\r\nstatus: accepted\r\n---\r\n' }])).toEqual([]);
  });
  it('rejects an illegal status', () => {
    const d = checkDrFrontmatterClosedSet([dr('id: DR-900\nstatus: active')]);
    expect(d).toHaveLength(1);
    expect(d[0].message).toMatch(/`active` is not legal/);
  });
  it('rejects a missing status and missing frontmatter', () => {
    expect(checkDrFrontmatterClosedSet([dr('id: DR-900')])[0].message).toMatch(/missing/);
    expect(checkDrFrontmatterClosedSet([{ file: 'DR-2.md', content: '# no fm' }])[0].message).toMatch(/no frontmatter/);
  });
  it('rejects the retired approved-by spelling, accepts approved_by', () => {
    const bad = checkDrFrontmatterClosedSet([dr('status: accepted\napproved-by: paul')]);
    expect(bad[0].message).toMatch(/use `approved_by`/);
    expect(checkDrFrontmatterClosedSet([dr('status: accepted\napproved_by: paul')])).toEqual([]);
  });
  it('skips INDEX.md and README.md', () => {
    expect(checkDrFrontmatterClosedSet([{ file: 'docs/decisions/INDEX.md', content: 'x' }])).toEqual([]);
  });
});
