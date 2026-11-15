/**
 * #2817 — a drain-dispatched agent's session start must not launch a nested drain.
 * agent-context.sh stamps MINSPEC_HEADLESS_AGENT=1 on every dispatched launch; the
 * session-start hook's auto-drain block must return early when it is set, and still
 * run `--auto` for a human session (control).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOOK_SRC = path.join(REPO_ROOT, 'scripts', 'hooks', 'session-start.sh');

let ws: string;
let log: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-drain-'));
  fs.mkdirSync(path.join(ws, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.minspec'), { recursive: true });
  fs.copyFileSync(HOOK_SRC, path.join(ws, 'scripts', 'hooks', 'session-start.sh'));
  log = path.join(ws, 'drain-calls.log');
  const pref = path.join(ws, '.minspec', 'auto-drain');
  fs.writeFileSync(pref, 'on\n');
  // Stub drain: records every invocation; --pref-path points at the "on" pref.
  const stub = path.join(ws, 'scripts', 'drain-inbox.sh');
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\n[[ "$1" == "--pref-path" ]] && echo "${pref}"\nexit 0\n`,
  );
  fs.chmodSync(stub, 0o755);
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

function runHook(extra: Record<string, string>): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (!('MINSPEC_HEADLESS_AGENT' in extra)) delete env.MINSPEC_HEADLESS_AGENT;
  spawnSync('bash', [path.join(ws, 'scripts', 'hooks', 'session-start.sh')], {
    cwd: ws,
    env,
    encoding: 'utf-8',
  });
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean) : [];
}

describe('session-start auto-drain vs dispatched agents (#2817)', () => {
  it('control: a human session with the pref on launches `--auto`', () => {
    expect(runHook({})).toContain('--auto');
  });

  it('a dispatched agent (MINSPEC_HEADLESS_AGENT=1) never launches a drain', () => {
    const calls = runHook({ MINSPEC_HEADLESS_AGENT: '1' });
    expect(calls).not.toContain('--auto');
    // only the read-only `--pref-path` query may run; no drain, no pending scan
    expect(calls.filter((c) => c !== '--pref-path')).toEqual([]);
  });
});
