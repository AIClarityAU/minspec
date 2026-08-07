import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * T0 gate: a tracked source file must be TEXT.
 *
 * A single NUL byte makes a file binary to every text tool. `file` reports it as
 * `data`, `git diff` renders "Binary files differ", and — the one that bites —
 * plain `grep` SKIPS IT SILENTLY: exit 1, no output, indistinguishable from "no
 * match in a file I did read".
 *
 * That is not hypothetical. `auto-bootstrap.ts` carried two raw NULs (a separator
 * written as a literal byte instead of the `\x00` escape) for its whole life. The
 * cost was a FALSE NEGATIVE about whether a feature existed: three greps for
 * `answeredSignatures` / `loadPreferences` over `src/` came back empty and read as
 * "this was never built", when all of it was there. The file lied to every tool
 * that read it, including the secret scans and drift-parity greps this project's
 * gates are made of. Root-caused and fixed in #1266.
 *
 * The fix was one line. THIS is the part that makes it un-recommittable — without
 * it, #1266 is a data-only fix, which per DR-003 means the root cause was never
 * addressed: the mechanism (a raw control byte reaching a source file) had no gate
 * standing in its way.
 *
 * Scope note: this asserts on TRACKED files only (`git ls-files`), so a build
 * artifact or a fixture in a temp dir can never fail it — only something someone
 * actually committed.
 */

/** Repo root, from this test file's location (tests/ → package → packages/ → root). */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Tracked paths that must be readable as text. Deliberately NOT "every tracked
 * file": images, fonts and `.vsix` fixtures are legitimately binary. Extension-based
 * rather than directory-based so a new source directory is covered the day it appears.
 */
const TEXT_SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.py',
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

describe('#1266 — a tracked source file must be text, never binary', () => {
  it('no tracked text-source file contains a NUL byte', () => {
    const offenders: string[] = [];

    for (const rel of trackedFiles()) {
      if (!TEXT_SOURCE_EXTENSIONS.includes(path.extname(rel).toLowerCase())) continue;

      const abs = path.join(REPO_ROOT, rel);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        // Tracked but absent from the working tree (sparse checkout, mid-rebase).
        // Nothing to assert about a file we cannot read; never a false failure.
        continue;
      }

      const at = buf.indexOf(0);
      if (at !== -1) {
        const line = buf.subarray(0, at).toString('utf-8').split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }

    // Named in the message, because "expected 1 to be 0" would send the next
    // reader hunting for a file that plain grep cannot find.
    expect(
      offenders,
      `NUL byte(s) found in tracked source — these files are BINARY to grep/diff and ` +
        `will be silently skipped by text gates. Write the byte as an escape sequence ` +
        `(\\x00) instead of embedding it literally:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it("auto-bootstrap.ts's drift separator survives as an escape, not a raw byte", () => {
    // The specific regression. The separator must still BE a NUL at runtime (it is
    // chosen because it cannot occur in a path or heading), while the source file
    // stays text — so this asserts both halves, not just the absence of the byte.
    const rel = 'packages/minspec/src/lib/auto-bootstrap.ts';
    const buf = fs.readFileSync(path.join(REPO_ROOT, rel));

    expect(buf.indexOf(0), `${rel} must not contain a raw NUL byte`).toBe(-1);
    expect(buf.toString('utf-8')).toContain('\\x00');

    // And the escape still denotes NUL — the reason the separator is unambiguous.
    expect(`a\x00b`.charCodeAt(1)).toBe(0);
  });
});
