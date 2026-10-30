/**
 * #3397 — a merged fix to drain-inbox.sh must not stay inert in a running loop.
 * The loop records a hash of the script at start and ends when it differs.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const DRAIN_SRC = fs.readFileSync(DRAIN, 'utf-8');

function drift(args: string[], self: string) {
  const r = spawnSync('bash', [DRAIN, '--self-drift', ...args], {
    encoding: 'utf-8',
    env: { ...process.env, MINSPEC_DRAIN_SELF: self },
  });
  return { code: r.status, out: (r.stdout ?? '').trim() };
}

describe('drain-inbox.sh — code drift seam (#3397)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-drift-'));
  const f = path.join(dir, 'self.sh');

  it('same content is not drifted; changed content is; missing file is (fail closed)', () => {
    fs.writeFileSync(f, 'echo a\n');
    const h = drift([], f).out;
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(drift([h], f)).toEqual({ code: 1, out: 'same' });
    fs.writeFileSync(f, 'echo b\n');
    expect(drift([h], f)).toEqual({ code: 0, out: 'drifted' });
    fs.rmSync(f);
    expect(drift([h], f)).toEqual({ code: 0, out: 'drifted' });
  });

  it('run_loop records the hash and checks it between cycles, before running a cycle', () => {
    const loop = DRAIN_SRC.slice(DRAIN_SRC.indexOf('\nrun_loop() {'));
    const body = loop.slice(0, loop.indexOf('\n}\n'));
    expect(body).toContain('start_hash="$(self_hash)"');
    const check = body.indexOf('self_drifted "$start_hash"');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf('run_cycle ||'));
  });
});
