/**
 * #3048 - a drain launched from a fresh worktree must not silently run without
 * node_modules. PRIMARY_ROOT is the launching worktree's toplevel; when the run dir's
 * own offline install fails, the fallback link must consider the primary worktree too
 * and warn visibly when nothing usable can be linked. Since 2026-10-28 "usable" means
 * a runnable `.bin/tsx`, not merely a `node_modules` directory: an emptied directory
 * passed the old `-d` check (behaviour: run-dir-owns-node-modules.test.ts).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/drain-inbox.sh'), 'utf8');
const fn = src.slice(src.indexOf('provision_run_dir_modules() {'), src.indexOf('# ensure_fresh_run_dir (#773):'));

describe('drain run-dir node_modules fallback source (#3048)', () => {
  it('considers the first git worktree as well as PRIMARY_ROOT', () => {
    expect(fn).toContain('worktree list --porcelain');
    expect(fn).toMatch(/for cand in "\$PRIMARY_ROOT" "\$first_wt"; do/);
  });

  it('picks a source by a runnable tsx, never by directory existence alone', () => {
    expect(fn).toContain('-x "${cand}/node_modules/.bin/tsx"');
    expect(fn).not.toMatch(/-d "\$\{(mod_root|cand|src)\}\/node_modules" \]\]/);
  });

  it('links from the resolved source, not unconditionally from PRIMARY_ROOT', () => {
    expect(fn).toContain('ln -sfn "${src}/node_modules" "$nm"');
    expect(src).not.toContain('ln -sfn "${PRIMARY_ROOT}/node_modules"');
  });

  it('prints a visible WARNING when nothing usable can be linked', () => {
    expect(fn).toMatch(/WARNING: no runnable tsx for the run dir/);
  });
});
