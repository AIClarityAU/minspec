import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

/**
 * Invariant: every guard that decides "is this branch push-protected" agrees on the
 * same FALLBACK list, even though (per #1111) they read it from two different
 * config stores by design — a vscode setting for the push guard, a git-config
 * twin for the commit-destination guard.
 *
 *   1. `minspec.protectedBranches` in package.json — the vscode setting's default
 *   2. `commit-on-approve.ts`'s inline `getConfiguration(...).get('protectedBranches', <fallback>)`
 *      (the PUSH guard — `pushOnApprove` deciding whether a direct push would be rejected)
 *   3. the generated pre-commit hook's `guard_candidates` fallback — `main master trunk`
 *   4. `approve-commit.ts`'s `CONVENTIONAL_DEFAULT_BRANCHES` — the git-config-backed
 *      fallback `resolveBranchDestination` reads, which is now the ONLY
 *      commit-destination guard (`commitApproval`'s protected-branch refusal AND
 *      `init.ts`'s harness-commit-offer `branchInfo()`, collapsed onto it by #1132)
 *
 * In a VS Code host, `get()` returns the PACKAGE.JSON default whenever the user has
 * not set the key — the inline fallback never runs. So `trunk` protection existed
 * only in the hook: a repo defaulting to `trunk` was blocked at commit time but the
 * commit offer never warned, and commit-on-approve would attempt a direct push that
 * the forge rejects. Four guards, two answers, no test.
 *
 * `init.ts` used to carry its OWN inline vscode fallback (checked here too) until
 * #1132 found it was really a fourth, unmirrored copy of the commit-destination
 * decision — missing every documented bypass (`MINSPEC_ALLOW_MAIN`,
 * `MINSPEC_GATE_OFF`, `minspec.allowCommitOnDefaultBranch`, mid-merge) that
 * `resolveBranchDestination` already had. It now delegates there directly instead
 * of reading `minspec.protectedBranches` itself, so it is intentionally ABSENT
 * from the inline-fallback scan below — re-adding a `getConfiguration(...).get(
 * 'protectedBranches', ...)` call to init.ts would be regrowing that fourth copy.
 *
 * The divergence was invisible because each site reads correctly in isolation. This
 * pins them together instead of trusting an author to update all of them (#1054
 * review, widened #1132).
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

  it.each(['src/commands/commit-on-approve.ts'])(
    '%s inline fallback matches the package.json default',
    (rel) => {
      const found = inlineFallbacks(sourceOf(rel));
      expect(found.length, `no protectedBranches read found in ${rel} — has it been renamed?`)
        .toBeGreaterThan(0);
      for (const list of found) expect(list).toEqual(declared);
    },
  );

  it('init.ts no longer carries its own inline vscode protectedBranches fallback (#1132)', () => {
    // A reintroduced `getConfiguration(...).get('protectedBranches', ...)` here
    // would silently regrow the fourth, unmirrored copy #1132 removed — init.ts's
    // commit-destination decision must come from `resolveBranchDestination`
    // (git-config-backed) alone, matching the hook and `commitApproval`.
    expect(inlineFallbacks(sourceOf('src/commands/init.ts'))).toEqual([]);
  });

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

  it("approve-commit.ts's git-config-backed fallback — the ONE commit-destination guard both commitApproval and init.ts's branchInfo() now share — matches the same default", () => {
    const src = sourceOf('src/lib/approve-commit.ts');
    const m = /CONVENTIONAL_DEFAULT_BRANCHES\s*=\s*(\[[^\]]*\])/.exec(src);
    expect(m, 'CONVENTIONAL_DEFAULT_BRANCHES not found in approve-commit.ts').not.toBeNull();
    const list = m![1]
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(list).toEqual(declared);
  });
});
