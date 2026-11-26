import { describe, it, expect } from 'vitest';
import { validateSiblingStatusLag } from '../src/lib/spec-validator';

const f = (type: string, status?: string) => ({ file: `SPEC-1/${type}.md`, type, status });

describe('validateSiblingStatusLag (#972)', () => {
  it('flags a specifying design under an implementing requirements', () => {
    const v = validateSiblingStatusLag([f('requirements', 'implementing'), f('design', 'specifying')]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('status.sibling.lag');
    expect(v[0].severity).toBe('error');
  });
  it('flags a lagging tasks file', () => {
    expect(validateSiblingStatusLag([f('requirements', 'done'), f('design', 'done'), f('tasks', 'implementing')])).toHaveLength(1);
  });
  it('passes agreeing, ahead, or status-less siblings', () => {
    expect(validateSiblingStatusLag([f('requirements', 'implementing'), f('design', 'implementing'), f('tasks', 'done')])).toEqual([]);
    expect(validateSiblingStatusLag([f('requirements', 'implementing'), f('design')])).toEqual([]);
  });
  it('ignores unranked parents and a missing parent', () => {
    expect(validateSiblingStatusLag([f('requirements', 'archived'), f('design', 'specifying')])).toEqual([]);
    expect(validateSiblingStatusLag([f('design', 'specifying')])).toEqual([]);
  });
});
