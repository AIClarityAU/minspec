import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Hardening guard for harvest316/minspec#123 / #373: a `workspaceFolders?.[0]`
 * grab must not appear in command / view / extension code. Both PRs fixed a
 * specific set of call sites, and both left the pattern reachable — #373 was
 * born because #123 didn't cover the approval/validation/navigation family.
 * The next site to reach for `[0]` would repeat the same class of bug in a
 * multi-root workspace, so fail loudly at test time and force the author to
 * use `lib/resolve-folder.ts` (`resolveTargetFolder`, `folderForFile`,
 * `resolveTargetFolderNonInteractive`).
 *
 * Exempt files — these are the resolver primitives themselves and one
 * documented last-resort fallback:
 *   - lib/resolve-folder.ts       (defines the resolvers)
 *   - views/frontmatter-completion.ts (`?? [0]` fallback, per the guard-review
 *     in the #373 issue: `getWorkspaceFolder(...) ?? [0]` is acceptable).
 */

const SRC_ROOT = path.resolve(__dirname, '..', 'src');

const EXEMPT_FILES = new Set(
  ['lib/resolve-folder.ts', 'views/frontmatter-completion.ts'].map((rel) =>
    path.resolve(SRC_ROOT, rel),
  ),
);

// Enumeration paths that iterate the whole set (`for (const f of workspaceFolders`)
// are safe — they act on every folder, never silently pick [0]. Only the
// index-0 grab is banned.
const BANNED = /workspaceFolders\s*\?\.\s*\[\s*0\s*\]/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip the integration-test scaffolding — those files intentionally
      // use `workspaceFolders?.[0]` in their integration setup, mirroring
      // how a raw extension host is bootstrapped for the test suite.
      if (entry === 'test' && dir === SRC_ROOT) continue;
      yield* walk(full);
    } else if (entry.endsWith('.ts')) {
      yield full;
    }
  }
}

// Strip line and block comments before matching. Comments about the banned
// pattern (e.g. describing what got replaced) are documentation, not
// offenders. Naive but sufficient — TypeScript strings don't legitimately
// contain the banned literal.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('workspaceFolders?.[0] guard (harvest316/minspec#123 / #373)', () => {
  it('no source file outside lib/resolve-folder.ts reaches for workspaceFolders?.[0]', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (EXEMPT_FILES.has(file)) continue;
      const contents = stripComments(readFileSync(file, 'utf8'));
      if (BANNED.test(contents)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    // Fail with the exact list so the author sees which file broke the gate.
    // Route the fix through `resolveTargetFolder()` (user-present commands),
    // `folderForFile(fsPath)` (target artifact is known), or
    // `resolveTargetFolderNonInteractive()` (activation-time).
    expect(offenders).toEqual([]);
  });
});
