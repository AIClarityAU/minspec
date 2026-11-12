import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) }, window: {}, commands: {} }));

import { describePaths } from '../src/commands/commit-on-approve';

describe('describePaths (#1133)', () => {
  it('names nothing for an empty/absent list', () => {
    expect(describePaths(undefined)).toBe('');
    expect(describePaths([])).toBe('');
  });
  it('names one and two paths by basename', () => {
    expect(describePaths(['docs/decisions/DR-064.md'])).toBe('DR-064.md');
    expect(describePaths(['docs/decisions/DR-064.md', 'docs/decisions/INDEX.md'])).toBe('DR-064.md and INDEX.md');
  });
  it('truncates past three paths', () => {
    expect(describePaths(['a/1.md', 'a/2.md', 'a/3.md', 'a/4.md', 'a/5.md'])).toBe('1.md, 2.md, 3.md and 2 more');
  });
  it('keeps the full path when basenames collide', () => {
    expect(describePaths(['x/INDEX.md', 'y/INDEX.md'])).toBe('x/INDEX.md and y/INDEX.md');
  });
});
