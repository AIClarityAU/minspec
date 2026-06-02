import { describe, it, expect } from 'vitest';
import { pickFolderPath } from '../src/lib/workspace';

/**
 * #123 regression: write-commands used `workspaceFolders?.[0]`, silently
 * targeting the first folder in a multi-root workspace. pickFolderPath is the
 * pure core of the multi-root-safe resolver.
 */
describe('pickFolderPath (multi-root target resolution)', () => {
  it('returns undefined with no folders', () => {
    expect(pickFolderPath([])).toBeUndefined();
  });

  it('returns the only folder when there is one (no prompt needed)', () => {
    expect(pickFolderPath(['/repo/a'])).toBe('/repo/a');
    expect(pickFolderPath(['/repo/a'], '/elsewhere/x.ts')).toBe('/repo/a');
  });

  it('resolves to the folder containing the active file', () => {
    expect(pickFolderPath(['/repo/a', '/repo/b'], '/repo/b/src/x.ts')).toBe(
      '/repo/b',
    );
  });

  it('prefers the longest-prefix folder (nested folders)', () => {
    expect(pickFolderPath(['/repo/a', '/repo/ab'], '/repo/ab/x.ts')).toBe(
      '/repo/ab',
    );
  });

  it('returns undefined (→ caller must prompt) when >1 folder and no active match', () => {
    expect(pickFolderPath(['/repo/a', '/repo/b'])).toBeUndefined();
    expect(
      pickFolderPath(['/repo/a', '/repo/b'], '/somewhere/else/x.ts'),
    ).toBeUndefined();
  });
});
