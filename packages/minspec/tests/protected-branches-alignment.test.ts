import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

/**
 * Invariant: every guard that decides "is this branch push-protected" agrees on the
 * same list.
 *
 * There are three, and they had silently diverged:
 *
 *   1. `minspec.protectedBranches` in package.json — default `['main','master']`
 *   2. the two `getConfiguration(...).get('protectedBranches', <fallback>)` call sites
 *   3. the generated pre-commit hook's `guard_candidates` fallback — `main master trunk`
 *
 * In a VS Code host, `get()` returns the PACKAGE.JSON default whenever the user has
 * not set the key — the inline fallback never runs. So `trunk` protection existed
 * only in the hook: a repo defaulting to `trunk` was blocked at commit time but the
 * commit offer never warned, and commit-on-approve would attempt a direct push that
 * the forge rejects. Three guards, two answers, no test.
 *
 * The divergence was invisible because each site reads correctly in isolation. This
 * pins them together instead of trusting an author to update all three (#1054 review).
 */

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
) as { contributes: { configuration: { properties: Record<string, { default?: string[] }> } } };

const declared = pkg.contributes.configuration.properties['minspec.protectedBranches']?.default;

function sourceOf(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

/** Every `get<string[]>('protectedBranches', [...])` fallback in the extension source. */
function inlineFallbacks(src: string): string[][] {
  const out: string[][] = [];
  const re = /getConfiguration\([^)]*\)\s*[\s\S]{0,80}?\.get<string\[\]>\(\s*'protectedBranches',\s*(\[[^\]]*\])\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const inner = m[1].replace(/^\[/, '').replace(/\]$/, '');
    out.push(
      inner
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean),
    );
  }
  return out;
}

describe('protected-branch lists agree across every guard', () => {
  it('package.json declares the setting with a default', () => {
    // Anti-vacuity: a renamed key would otherwise make every comparison below
    // compare undefined against undefined.
    expect(Array.isArray(declared)).toBe(true);
    expect(declared!.length).toBeGreaterThan(0);
  });

  it.each(['src/commands/init.ts', 'src/commands/commit-on-approve.ts'])(
    '%s inline fallback matches the package.json default',
    (rel) => {
      const found = inlineFallbacks(sourceOf(rel));
      expect(found.length, `no protectedBranches read found in ${rel} — has it been renamed?`)
        .toBeGreaterThan(0);
      for (const list of found) expect(list).toEqual(declared);
    },
  );

  it('the generated pre-commit hook falls back to the same names', () => {
    const hook = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'pre-commit-hook');
    expect(hook, 'pre-commit-hook template not found').toBeDefined();
    const m = /guard_candidates="([^"]+)"/.exec(hook!.content);
    expect(m, 'guard_candidates fallback not found in the hook').not.toBeNull();
    expect(m![1].split(/\s+/)).toEqual(declared);
  });

  it('the hook reads the git-config twin of the same key', () => {
    const hook = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'pre-commit-hook')!;
    expect(hook.content).toMatch(/git config --get minspec\.protectedBranches/);
  });
});
