import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Every machine-local scratch directory must be gitignored (#1967).
 *
 * `.local/` was used as multi-session scratch without an ignore rule while its
 * siblings `.codegraph/` and `.radar/` were ignored; nothing asserted the set, so
 * the convention and `.gitignore` drifted and any sweeping `git add -A` would have
 * published every session's drafts. Add new scratch dirs to this list.
 *
 * The check runs in a throwaway repo holding ONLY this repo's `.gitignore`, so a
 * machine-local `.git/info/exclude` or global excludes file cannot mask a missing
 * rule (the developer's own exclude had `.local/`, which hid the gap).
 */
const repoRoot = path.resolve(__dirname, '../../..');
const SCRATCH_DIRS = ['.local', '.codegraph', '.radar'];

describe('machine-local scratch directories are gitignored', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-ignored-'));
  fs.copyFileSync(path.join(repoRoot, '.gitignore'), path.join(tmp, '.gitignore'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const init = spawnSync('git', ['init', '-q'], { cwd: tmp, encoding: 'utf8', env });

  it('isolated repo initialised (guard against a vacuous pass)', () => {
    expect(init.status, init.stderr).toBe(0);
  });

  for (const dir of SCRATCH_DIRS) {
    it(`${dir}/ is ignored by the committed .gitignore`, () => {
      const res = spawnSync('git', ['check-ignore', '-q', `${dir}/probe-file`], {
        cwd: tmp,
        encoding: 'utf8',
        env,
      });
      // 0 = ignored, 1 = not ignored, >1 = error
      expect(res.status, res.stderr).toBe(0);
    });
  }
});
