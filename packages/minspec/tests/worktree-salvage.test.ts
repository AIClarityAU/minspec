/**
 * T0 — worktree salvage verdict reads diff DIRECTION (#1259).
 *
 * ROOT CAUSE: the #1161 sweep treated "differs from origin/main" as "unique work"; a
 * deletions-only staged state (229 deletions, 0 insertions) differs because main still
 * holds the content. Only insertions (or untracked authored files) are salvage.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { classifyWorktree } from '../../../scripts/lib/worktree-salvage';

const none = { stagedNumstat: '', unstagedNumstat: '', untracked: [] as string[] };

describe('classifyWorktree', () => {
  it('deletions-only staged state is NOTHING_UNIQUE (scroogellm#118 shape)', () => {
    const r = classifyWorktree({ ...none, stagedNumstat: '0\t200\t.github/workflows/ci.yml\n0\t29\tsrc/t.test.ts\n' });
    expect(r.verdict).toBe('NOTHING_UNIQUE');
    expect(r.deletions).toBe(229);
    expect(r.insertions).toBe(0);
  });
  it('clean worktree is NOTHING_UNIQUE', () => {
    expect(classifyWorktree(none).verdict).toBe('NOTHING_UNIQUE');
  });
  it('staged insertions are SALVAGE', () => {
    expect(classifyWorktree({ ...none, stagedNumstat: '3\t0\ta.ts\n' }).verdict).toBe('SALVAGE');
  });
  it('unstaged insertions are SALVAGE', () => {
    expect(classifyWorktree({ ...none, unstagedNumstat: '1\t1\ta.ts\n' }).verdict).toBe('SALVAGE');
  });
  it('untracked authored file is SALVAGE; artifacts are not', () => {
    expect(classifyWorktree({ ...none, untracked: ['notes.md'] }).verdict).toBe('SALVAGE');
    expect(classifyWorktree({ ...none, untracked: ['node_modules/x/i.js', 'a.vsix', 'dist/b.js'] }).verdict).toBe(
      'NOTHING_UNIQUE',
    );
  });
  it('binary change fails closed to SALVAGE', () => {
    expect(classifyWorktree({ ...none, stagedNumstat: '-\t-\timg.png\n' }).verdict).toBe('SALVAGE');
  });
  it('unparseable line fails closed to SALVAGE', () => {
    expect(classifyWorktree({ ...none, stagedNumstat: 'garbage\n' }).verdict).toBe('SALVAGE');
  });
});

describe('check-worktree-salvage CLI', () => {
  const script = path.resolve(__dirname, '../../../scripts/check-worktree-salvage.ts');
  const run = (dir: string) => {
    try {
      execFileSync('npx', ['tsx', script, dir], { encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (e) {
      return (e as { status: number }).status;
    }
  };
  it('exit codes: deletions-only 0, insertion 1, non-repo 2', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-salvage-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
    g('init', '-q');
    fs.writeFileSync(path.join(d, 'a.txt'), 'one\ntwo\n');
    g('add', '.');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    g('rm', '-q', 'a.txt');
    expect(run(d)).toBe(0);
    fs.writeFileSync(path.join(d, 'b.txt'), 'new\n');
    expect(run(d)).toBe(1);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-plain-'));
    expect(run(plain)).toBe(2);
  }, 60000);
});
