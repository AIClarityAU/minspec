/**
 * #1530 — a fresh worktree's `npm install` left `packages/shared/out/` absent.
 * #2671 — the hook install half of that same script swallowed its own failure.
 *
 * Root cause (#1530): `@aiclarity/shared`'s `package.json` resolves `main`/`types` to
 * `out/index.js`/`out/index.d.ts` (built by `tsc`), but nothing ran that build at
 * `npm install` time. `npm test` happened to be safe already — its `pretest` hook
 * builds the workspace — but any OTHER consumer of the package run directly after
 * a plain `npm install` (`npm run facts`, `npx vitest run <file>` bypassing the
 * `pretest` hook, a plain `node`/`tsx` script importing the package) hit Node's
 * real module resolution against a missing `out/` and died with:
 *
 *   Error: Cannot find module '.../node_modules/@aiclarity/shared/out/index.js'
 *
 * Fix: the root `prepare` script (which npm runs on every `npm install`/`npm ci`,
 * not just on `npm test`) also builds `@aiclarity/shared` — so `out/` exists the
 * moment `npm install` finishes, regardless of which script runs next.
 *
 * Root cause (#2671): the same script's OTHER half —
 * `git config core.hooksPath .githooks || true` — swallowed a failed hook install,
 * so a clone where it failed (no `.git`, a read-only `.git/config`, …) installed
 * with zero commit-time gates (secret scan, spec-frontmatter check, RCDD root-cause
 * gate) and said nothing. Constitution invariant 2 ("no silent gate") forbids a
 * load-bearing gate signal written with a swallowed error. The checker that
 * enforces that clause (scripts/check-swallowed-gate-signal.ts) only ever walked
 * `.sh` files, so this swallow — sitting inside a `package.json` script string —
 * was structurally invisible to it; see swallowed-gate-signal.test.ts for the
 * matching fix on that side.
 *
 * Fix: both steps moved out of the inline `package.json` one-liner into
 * `scripts/prepare.mjs` (DI'd exec, unit-tested below), which runs the build and
 * the hook install independently of each other's outcome and reports a non-zero
 * exit — loudly, with a named reason — if EITHER failed.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { runPrepare } from '../../../scripts/prepare.mjs';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
);
const prepareSource = fs.readFileSync(path.join(repoRoot, 'scripts/prepare.mjs'), 'utf-8');

describe('#1530 / #2671: npm install builds @aiclarity/shared and arms the git hooks, neither silently', () => {
  it('the root prepare script delegates to scripts/prepare.mjs', () => {
    // prepare is the ONLY lifecycle script npm runs on a bare `npm install`/`npm ci`
    // with no explicit script name — pretest/pretypecheck only fire for their
    // matching named script, so they cannot cover this gap on their own.
    expect(rootPackageJson.scripts.prepare).toBe('node scripts/prepare.mjs');
  });

  it('scripts/prepare.mjs builds @aiclarity/shared', () => {
    expect(prepareSource).toMatch(/--workspace=@aiclarity\/shared/);
  });

  it('scripts/prepare.mjs installs the git hooks at .githooks', () => {
    expect(prepareSource).toMatch(/core\.hooksPath/);
    expect(prepareSource).toMatch(/\.githooks/);
  });

  // INV: neither step's failure is swallowed by the OTHER step's success — each
  // must be visible in the combined verdict `runPrepare()` returns.
  describe('runPrepare(): neither step can hide the other failing', () => {
    it('both steps succeed -> ok', () => {
      const exec = vi.fn();
      const result = runPrepare(exec);
      expect(result).toEqual({ buildOk: true, hooksOk: true, ok: true });
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it('a build failure is NOT swallowed, and the hooks step still runs (#1530 must not regress)', () => {
      const exec = vi.fn((cmd: string) => {
        if (cmd === 'npm') throw new Error('build failed');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = runPrepare(exec);
      errSpy.mockRestore();

      expect(result.buildOk).toBe(false);
      expect(result.hooksOk).toBe(true);
      expect(result.ok).toBe(false);
      // The hooks step ran despite the build failing — decoupled, not short-circuited.
      expect(exec).toHaveBeenCalledWith(
        'git',
        ['config', 'core.hooksPath', '.githooks'],
        expect.anything(),
      );
    });

    it('a hooks-install failure is NOT swallowed, is reported loudly, and the build still ran', () => {
      const exec = vi.fn((cmd: string) => {
        if (cmd === 'git') throw new Error('not a git repository');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = runPrepare(exec);
      const printed = errSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      errSpy.mockRestore();

      expect(result.buildOk).toBe(true);
      expect(result.hooksOk).toBe(false);
      expect(result.ok).toBe(false); // this is the #2671 fix: the old script exited 0 here
      expect(printed).toMatch(/git hooks are NOT installed/);
      expect(exec).toHaveBeenCalledWith(
        'npm',
        ['run', 'build', '--workspace=@aiclarity/shared'],
        expect.anything(),
      );
    });
  });

  // Behavioral proof the unit tests above cannot give: that the real CLI entry
  // point (not just the exported function) actually exits non-zero. A lint on
  // `runPrepare`'s return value would pass even if the `invokedDirectly` block at
  // the bottom of the file never read `.ok` or never called `process.exit` —
  // exactly the "asserted the source, not the behaviour" gap this repo has been
  // bitten by before. Stubs real `git`/`npm` on PATH so this is deterministic
  // without touching the real `.git` or `packages/shared/out/` of this checkout.
  describe('node scripts/prepare.mjs: the real process exits non-zero on a failed hook install', () => {
    it('fails the whole script, loudly, when git config fails', () => {
      const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-stub-'));
      try {
        fs.writeFileSync(
          path.join(stubDir, 'git'),
          '#!/bin/sh\necho "fatal: not a git repository" >&2\nexit 128\n',
          { mode: 0o755 },
        );
        fs.writeFileSync(path.join(stubDir, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

        const result = spawnSync('node', ['scripts/prepare.mjs'], {
          cwd: repoRoot,
          env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
          encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/git hooks are NOT installed/);
      } finally {
        fs.rmSync(stubDir, { recursive: true, force: true });
      }
    });
  });
});
