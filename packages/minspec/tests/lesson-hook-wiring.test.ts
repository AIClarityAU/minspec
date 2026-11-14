/**
 * Lesson-hook pilot wiring (#3082): `--setting-sources project,local` drops the user-level
 * lesson hook, so agent-context.sh passes it inline via `--settings`, limited by LESSON_ONLY
 * to the ten pilot lessons. The wiring must be valid JSON, scoped, and switchable off.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found');
}
const LIB = path.join(findRepoRoot(), 'scripts/lib/agent-context.sh');

function fakeHome(withHook: boolean): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-home-'));
  if (withHook) {
    fs.mkdirSync(path.join(home, '.claude/hooks'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/hooks/lesson-hook.py'), '');
  }
  return home;
}

/** The AGENT_CONTEXT_ARGS the library builds, one per element. */
function args(home: string, env: Record<string, string | undefined> = {}): string[] {
  const r = spawnSync(
    'bash',
    ['-c', `source "${LIB}"; printf '%s\\0' "\${AGENT_CONTEXT_ARGS[@]}"`],
    { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', HOME: home, ...env } as NodeJS.ProcessEnv },
  );
  expect(r.status).toBe(0);
  return r.stdout.split('\0').filter((s, i, a) => i < a.length - 1 || s !== '');
}

describe('lesson hook reaches dispatched sessions (#3082)', () => {
  it('adds a valid --settings PreToolUse hook limited to the ten pilot lessons', () => {
    const a = args(fakeHome(true));
    expect(a.slice(0, 2)).toEqual(['--setting-sources', 'project,local']);
    const i = a.indexOf('--settings');
    expect(i).toBeGreaterThan(-1);
    const cfg = JSON.parse(a[i + 1]!);
    const entry = cfg.hooks.PreToolUse[0];
    expect(entry.matcher).toBe('Bash|Edit|Write');
    const cmd: string = entry.hooks[0].command;
    expect(cmd).toContain('lesson-hook.py --json');
    const only = /LESSON_ONLY=(\S+)/.exec(cmd)![1]!.split(',');
    expect(only).toHaveLength(10);
    for (const f of ['f-rcdd-mech-not.md', 'f-refe-befo-stat.md', 'f-poll-revi.md', 'f-trace-both-arms.md']) {
      expect(only).toContain(f);
    }
  });

  it('is switched off by MINSPEC_LESSON_HOOK=off', () => {
    expect(args(fakeHome(true), { MINSPEC_LESSON_HOOK: 'off' })).not.toContain('--settings');
  });

  it('adds nothing where the hook file is absent (CI, an adopter)', () => {
    expect(args(fakeHome(false))).not.toContain('--settings');
  });

  it('adds nothing when user scope is restored (the user hook loads itself)', () => {
    expect(args(fakeHome(true), { MINSPEC_AGENT_SETTING_SOURCES: 'user,project,local' })).not.toContain('--settings');
  });
});
