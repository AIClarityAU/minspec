/**
 * #1530 — a fresh worktree's `npm install` left `packages/shared/out/` absent.
 *
 * Root cause: `@aiclarity/shared`'s `package.json` resolves `main`/`types` to
 * `out/index.js`/`out/index.d.ts` (built by `tsc`), but nothing ran that build at
 * `npm install` time. `npm test` happened to be safe already — its `pretest` hook
 * builds the workspace — but any OTHER consumer of the package run directly after
 * a plain `npm install` (`npm run facts`, `npx vitest run <file>` bypassing the
 * `pretest` hook, a plain `node`/`tsx` script importing the package) hit Node's
 * real module resolution against a missing `out/` and died with:
 *
 *   Error: Cannot find module '.../node_modules/@aiclarity/shared/out/index.js'
 *
 * That is exactly what happened in the filing issue: it read as "25/25
 * facts-cli tests failing" / "main is red", not as "you need to build first",
 * because a fresh worktree fails identically whether or not the branch under
 * test is broken.
 *
 * Fix: the root `prepare` script (which npm runs on every `npm install`/`npm ci`,
 * not just on `npm test`) now also builds `@aiclarity/shared` — so `out/` exists
 * the moment `npm install` finishes, regardless of which script runs next.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
);

// NOTE: deliberately no test here deletes/rebuilds the real packages/shared/out —
// vitest runs test FILES in parallel worker processes, and this repo's suite has
// other files (facts-cli.test.ts) that spawn a real `tsx scripts/facts.ts`
// subprocess resolving @aiclarity/shared through that exact built output. An
// earlier draft of this test deleted it mid-suite to prove the fix behaviorally
// and intermittently broke that unrelated file — the same class of bug this
// issue is about, just self-inflicted. The two checks below are pure text
// assertions against package.json instead: no shared filesystem state, no races.
// The behavioral proof (delete packages/shared/out, run `npm run prepare`, confirm
// it comes back) was run by hand instead — see the PR/issue notes for that trace.

describe('#1530: npm install builds @aiclarity/shared, so out/ is never silently absent', () => {
  it('the root prepare script builds @aiclarity/shared', () => {
    // prepare is the ONLY lifecycle script npm runs on a bare `npm install`/`npm ci`
    // with no explicit script name — pretest/pretypecheck only fire for their
    // matching named script, so they cannot cover this gap on their own.
    const prepare: string = rootPackageJson.scripts.prepare;
    expect(prepare).toMatch(/npm run build --workspace=@aiclarity\/shared/);
  });

  it('a failure building @aiclarity/shared is NOT swallowed by prepare (no silent gate, invariant #2)', () => {
    const prepare: string = rootPackageJson.scripts.prepare;
    // The pre-existing `git config ... || true` tolerates a read-only/misconfigured
    // git config (not a correctness gate). The build step that follows it must NOT
    // sit behind its own `|| true`/`; true` — a swallowed build failure would leave
    // out/ absent exactly as before, silently.
    const buildClause = prepare.split('&&').pop() ?? '';
    expect(buildClause).toContain('npm run build --workspace=@aiclarity/shared');
    expect(buildClause).not.toMatch(/\|\|\s*true/);
  });
});
