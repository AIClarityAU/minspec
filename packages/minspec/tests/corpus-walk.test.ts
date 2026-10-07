/**
 * T3 regression (#1999): a read failure must never be reported as an empty corpus.
 *
 * The defect these pin: `safeGlob` in `validate-frontmatter.ts` and `walkMarkdownFiles` in
 * `facts.ts` each wrapped a recursive `readdirSync` in `catch { return [] }`. One
 * unreadable directory under `specs/` therefore made `npm run validate` miss a genuine
 * duplicate `id: SPEC-070`, exit 0, and print 60 false `dangling SPEC reference` warnings
 * about specs that exist — while Rules 17 and 18, whose catch blocks promise to fail
 * visibly, printed nothing, because the throw never reached them.
 *
 * The reader is injected rather than built out of `chmod`, because a `chmod 000` fixture is
 * inert when the suite runs as root and would pass vacuously in a container CI. One real
 * filesystem case is kept at the end, skipped explicitly under root so the skip is visible.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isMissingRoot,
  walkFilesByExt,
  walkOptionalRoot,
  type DirEntry,
  type DirReader,
} from '../../../scripts/lib/corpus-walk';

const file = (name: string): DirEntry => ({ name, isDirectory: () => false });
const dir = (name: string): DirEntry => ({ name, isDirectory: () => true });

/** A reader over a literal tree, which throws `errors[dir]` where one is set. */
function fakeReader(
  tree: Record<string, DirEntry[]>,
  errors: Record<string, NodeJS.ErrnoException> = {},
): DirReader {
  return (d: string) => {
    if (errors[d]) throw errors[d];
    const entries = tree[d];
    if (!entries) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, scandir '${d}'`);
      err.code = 'ENOENT';
      err.path = d;
      throw err;
    }
    return entries;
  };
}

function ioError(code: string, path: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`${code}: scandir '${path}'`);
  err.code = code;
  err.path = path;
  return err;
}

const CORPUS: Record<string, DirEntry[]> = {
  '/specs': [dir('minspec'), file('README.txt')],
  '/specs/minspec': [dir('SPEC-070-a'), dir('SPEC-071-b')],
  '/specs/minspec/SPEC-070-a': [file('requirements.md'), file('notes.txt')],
  '/specs/minspec/SPEC-071-b': [file('requirements.md')],
};

describe('walkFilesByExt', () => {
  it('collects matching files recursively and ignores other extensions', () => {
    expect(walkFilesByExt('/specs', '.md', fakeReader(CORPUS))).toEqual([
      '/specs/minspec/SPEC-070-a/requirements.md',
      '/specs/minspec/SPEC-071-b/requirements.md',
    ]);
  });

  it('does not descend into a symlinked directory (isDirectory() is false for a symlink)', () => {
    const tree = { '/specs': [file('link-to-elsewhere'), file('real.md')] };
    expect(walkFilesByExt('/specs', '.md', fakeReader(tree))).toEqual(['/specs/real.md']);
  });

  it('throws rather than returning [] when the root is missing', () => {
    expect(() => walkFilesByExt('/nope', '.md', fakeReader({}))).toThrow(/ENOENT/);
  });
});

describe('walkOptionalRoot — an absent root is tolerated, a failed read is not', () => {
  it('returns [] when the root itself does not exist', () => {
    expect(walkOptionalRoot('/nope', '.md', fakeReader({}))).toEqual([]);
  });

  it('THROWS on a permission error at the root, instead of reporting an empty corpus', () => {
    const read = fakeReader(CORPUS, { '/specs': ioError('EACCES', '/specs') });
    expect(() => walkOptionalRoot('/specs', '.md', read)).toThrow(/EACCES/);
  });

  it('THROWS on a permission error deeper in the tree — the defect that shipped', () => {
    const read = fakeReader(CORPUS, {
      '/specs/minspec/SPEC-071-b': ioError('EACCES', '/specs/minspec/SPEC-071-b'),
    });
    expect(() => walkOptionalRoot('/specs', '.md', read)).toThrow(/EACCES/);
  });

  it('THROWS when a subdirectory vanishes mid-walk, rather than returning what it already had', () => {
    // A concurrent-session race (#168), not an absence: the partial list would read as a
    // complete corpus to every consumer.
    const read = fakeReader(CORPUS, {
      '/specs/minspec/SPEC-071-b': ioError('ENOENT', '/specs/minspec/SPEC-071-b'),
    });
    expect(() => walkOptionalRoot('/specs', '.md', read)).toThrow(/ENOENT/);
  });

  it('never hands back a partial result when a read fails after files were collected', () => {
    const read = fakeReader(CORPUS, {
      '/specs/minspec/SPEC-071-b': ioError('EACCES', '/specs/minspec/SPEC-071-b'),
    });
    let returned: string[] | undefined;
    try {
      returned = walkOptionalRoot('/specs', '.md', read);
    } catch {
      returned = undefined;
    }
    // The first spec's requirements.md was already collected when the second threw.
    expect(returned).toBeUndefined();
  });
});

describe('isMissingRoot', () => {
  it('is true only for this exact directory being absent', () => {
    expect(isMissingRoot(ioError('ENOENT', '/specs'), '/specs')).toBe(true);
  });

  it('is false for a missing SUBdirectory — that is a vanished child, not an absent root', () => {
    expect(isMissingRoot(ioError('ENOENT', '/specs/minspec'), '/specs')).toBe(false);
  });

  it('is false for any other error code on the root', () => {
    expect(isMissingRoot(ioError('EACCES', '/specs'), '/specs')).toBe(false);
  });

  it('is false for a non-IO throw', () => {
    expect(isMissingRoot(new Error('boom'), '/specs')).toBe(false);
  });
});

describe('real filesystem', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it('walks a real tree the same way the injected reader does', () => {
    const root = mkdtempSync(join(tmpdir(), 'corpus-walk-'));
    try {
      mkdirSync(join(root, 'minspec', 'SPEC-070-a'), { recursive: true });
      writeFileSync(join(root, 'minspec', 'SPEC-070-a', 'requirements.md'), 'x');
      writeFileSync(join(root, 'minspec', 'SPEC-070-a', 'notes.txt'), 'x');
      expect(walkOptionalRoot(root, '.md')).toEqual([
        join(root, 'minspec', 'SPEC-070-a', 'requirements.md'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(isRoot)('throws on a real unreadable subdirectory (skipped as root, where chmod is inert)', () => {
    const root = mkdtempSync(join(tmpdir(), 'corpus-walk-'));
    const locked = join(root, 'locked');
    try {
      mkdirSync(locked);
      writeFileSync(join(root, 'visible.md'), 'x');
      chmodSync(locked, 0o000);
      expect(() => walkOptionalRoot(root, '.md')).toThrow(/EACCES/);
    } finally {
      chmodSync(locked, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
