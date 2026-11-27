/**
 * #2006 — a PRIMARY_ROOT that is not a git work tree made the #773 freshness
 * comparison fail forever, silently, with the sentinel truncated to "noorigi".
 * Behaviour: the drain says so loudly and prints sentinels whole.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

useShellTimeout();
useHostileAmbientDrainKnobs();

const SCRIPTS = path.resolve(__dirname, '../../../scripts');

function run(body: string): { code: number | null; out: string; err: string } {
  const r = spawnSync(
    'bash',
    ['-c', `set +e; src="$(sed -n '/^short_sha() {/,/^}/p;/^assert_primary_is_worktree() {/,/^}/p' "${SCRIPTS}/drain-inbox.sh")"; eval "$src"; ${body}`],
    { encoding: 'utf-8', env: { ...drainBaseEnv() } },
  );
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe('PRIMARY_ROOT work-tree assertion and sentinel display (#2006)', () => {
  it('a non-repo PRIMARY_ROOT fails loudly, naming the path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-notrepo-'));
    try {
      const r = run(`PRIMARY_ROOT="${dir}"; assert_primary_is_worktree; echo rc=$?`);
      expect(r.out).toContain('rc=1');
      expect(r.err).toContain('is not a git work tree');
      expect(r.err).toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a real work tree passes silently', () => {
    const r = run(`PRIMARY_ROOT="${SCRIPTS}"; assert_primary_is_worktree; echo rc=$?`);
    expect(r.out).toContain('rc=0');
    expect(r.err).toBe('');
  });

  it('short_sha truncates a SHA but prints a sentinel whole', () => {
    const r = run(`short_sha df63a85c9210df63a85c9210df63a85c9210abcd; echo; short_sha noorigin; echo; short_sha norun`);
    expect(r.out.split('\n')).toEqual(['df63a85', '<unresolved:noorigin>', '<unresolved:norun>']);
  });

  it('ensure_fresh_run_dir runs the assertion before BOTH origin/main comparisons', () => {
    const src = fs.readFileSync(path.join(SCRIPTS, 'drain-inbox.sh'), 'utf-8');
    const m = /^ensure_fresh_run_dir\(\) \{\n[\s\S]*?^\}$/m.exec(src);
    expect(m).not.toBeNull();
    const body = m![0];
    const check = body.indexOf('assert_primary_is_worktree');
    // The run-dir path (drain-service.sh starts the drain from the run dir) compares
    // against origin/main first, so the check must precede that block too.
    const runDirBlock = body.indexOf('local executing_from_run_dir=false');
    const firstCompare = body.indexOf('rev-parse origin/main');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(runDirBlock);
    expect(check).toBeLessThan(firstCompare);
  });
});
