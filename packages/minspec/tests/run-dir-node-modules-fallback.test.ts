/**
 * #3048 - a drain launched from a fresh worktree must not silently run without
 * node_modules. PRIMARY_ROOT is the launching worktree's toplevel; the run-dir sync
 * must fall back to the primary worktree and warn visibly when nothing can be linked.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/drain-inbox.sh'), 'utf8');

describe('drain run-dir node_modules source (#3048)', () => {
  it('falls back to the first git worktree when PRIMARY_ROOT has no node_modules', () => {
    expect(src).toContain('worktree list --porcelain');
    expect(src).toMatch(/mod_root="\$first_wt"/);
  });

  it('links node_modules from the resolved root, not unconditionally from PRIMARY_ROOT', () => {
    expect(src).toContain('ln -sfn "${mod_root}/node_modules"');
    expect(src).not.toContain('ln -sfn "${PRIMARY_ROOT}/node_modules"');
  });

  it('prints a visible WARNING when no node_modules can be linked', () => {
    expect(src).toMatch(/WARNING: no node_modules found/);
  });
});
