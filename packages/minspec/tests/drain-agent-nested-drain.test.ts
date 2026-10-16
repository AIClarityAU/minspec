/**
 * #2817 — a drain-dispatched agent's session-start hook must not launch a nested
 * drain. dispatch-issue.sh exports MINSPEC_DRAIN_AGENT=1; the hook skips the
 * auto-drain block when it is set.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOOK_SRC = path.join(REPO_ROOT, 'scripts', 'hooks', 'session-start.sh');
const DISPATCH_SRC = path.join(REPO_ROOT, 'scripts', 'dispatch-issue.sh');

let ws: string;
let calls: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-drain-'));
  fs.mkdirSync(path.join(ws, 'scripts', 'hooks'), { recursive: true });
  fs.copyFileSync(HOOK_SRC, path.join(ws, 'scripts', 'hooks', 'session-start.sh'));
  calls = path.join(ws, 'calls.log');
  const pref = path.join(ws, 'pref');
  fs.writeFileSync(pref, 'on\n');
  // Fake drain: records every invocation; --pref-path points at an "on" pref.
  const fake = path.join(ws, 'scripts', 'drain-inbox.sh');
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n[[ "$1" == "--pref-path" ]] && echo "${pref}"\nexit 0\n`,
  );
  fs.chmodSync(fake, 0o755);
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

function runHook(env: Record<string, string | undefined>): string[] {
  spawnSync('bash', [path.join(ws, 'scripts', 'hooks', 'session-start.sh')], {
    cwd: ws,
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, MINSPEC_DRAIN_AGENT: undefined, ...env },
  });
  return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf-8').trim().split('\n') : [];
}

describe('nested drain guard (#2817)', () => {
  it('control: without the marker the hook starts the drain with --auto', () => {
    expect(runHook({})).toContain('--auto');
  });

  it('with MINSPEC_DRAIN_AGENT=1 the hook starts no drain', () => {
    const invoked = runHook({ MINSPEC_DRAIN_AGENT: '1' });
    expect(invoked).not.toContain('--auto');
    expect(invoked).not.toContain('--dry-run');
  });

  it('dispatch-issue.sh exports the marker before launching agents', () => {
    const src = fs.readFileSync(DISPATCH_SRC, 'utf-8');
    expect(src).toMatch(/^export MINSPEC_DRAIN_AGENT=1$/m);
  });
});
