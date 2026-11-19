// #1092 — the stdlib-unittest suites in scripts/hooks/ (spec gate, canonical
// hashing, ...) were run by no workflow, so a regression in a merge-gating
// hook shipped green. CI runs `npx vitest`, so running them from here puts
// them under the existing required check without touching CI config.
//
// Fails CLOSED (invariant 2): a missing python3, or zero discovered suites,
// is a red test — never a silent skip.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hooksDir = resolve(__dirname, '../../../scripts/hooks');
const suites = readdirSync(hooksDir).filter((f) => /^test_.*\.py$/.test(f));

describe('python hook unittest suites (#1092)', () => {
  it('discovers at least the known suites', () => {
    expect(suites).toEqual(expect.arrayContaining(['test_spec_gate.py', 'test_canonical.py']));
  });

  it.each(suites)('%s passes', (suite) => {
    const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', hooksDir, '-p', suite], {
      cwd: hooksDir,
      encoding: 'utf8',
    });
    expect(r.error, 'python3 must be available').toBeUndefined();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  }, 60_000);
});
