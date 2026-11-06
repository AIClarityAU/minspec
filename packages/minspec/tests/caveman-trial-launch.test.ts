/**
 * Caveman trial (queue item cav1, 2026-10-18 to 2026-10-25): the drain's build, fix and
 * remediation agents carry the caveman ruleset at the level in MINSPEC_CAVEMAN_MODE
 * (default `full`), and turning it off is that one value.
 *
 * Why an appended system prompt and not the plugin: `--setting-sources project,local`
 * drops user scope so the plugin hook never runs for a drain agent, a process-env level
 * loses to settings.json, and loading the plugin would rewrite the shared
 * ~/.claude/.caveman-active flag that interactive sessions read. See agent-context.sh.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope (#1399): shells out; vitest's 5s default flakes under load (#2598).
useShellTimeout();

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found');
}
const ROOT = findRepoRoot();
const LIB = path.join(ROOT, 'scripts/lib/agent-context.sh');

/** A fake HOME whose caveman plugin hook echoes the level it was asked for. */
function fakeHome(withHook: boolean): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cav-home-'));
  if (withHook) {
    const hooks = path.join(home, '.claude/plugins/cache/caveman/caveman/abc123/hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(
      path.join(hooks, 'caveman-activate.js'),
      "process.stdout.write('CAVEMAN MODE ACTIVE — level: ' + process.env.CAVEMAN_DEFAULT_MODE + '\\nRULES');\n" +
        "require('fs').writeFileSync(require('path').join(process.env.CLAUDE_CONFIG_DIR,'.caveman-active'), process.env.CAVEMAN_DEFAULT_MODE);\n",
    );
  }
  return home;
}

function init(home: string, env: Record<string, string | undefined>) {
  const r = spawnSync(
    'bash',
    ['-c', `source "${LIB}"; agent_caveman_init; printf '%s\\n' "\${#AGENT_CAVEMAN_ARGS[@]}"; printf '%s\\n' "\${AGENT_CAVEMAN_ARGS[@]+"\${AGENT_CAVEMAN_ARGS[@]}"}"`],
    { env: { PATH: process.env.PATH ?? '', HOME: home, ...env } as NodeJS.ProcessEnv, encoding: 'utf8' },
  );
  const [count, ...rest] = r.stdout.split('\n');
  return { count: Number(count), args: rest.join('\n'), stderr: r.stderr, status: r.status };
}

describe('caveman trial: AGENT_CAVEMAN_ARGS', () => {
  it('defaults to full and appends the ruleset as a system prompt', () => {
    const home = fakeHome(true);
    const r = init(home, {});
    expect(r.status).toBe(0);
    expect(r.count).toBe(2);
    expect(r.args).toContain('--append-system-prompt');
    expect(r.args).toContain('CAVEMAN MODE ACTIVE — level: full');
  });

  it('names the machine-parsed markers as exempt from terse style', () => {
    const r = init(fakeHome(true), {});
    for (const m of ['ESCALATE:', 'Root cause:', 'DEEPER:', 'Closes #N', 'commit subjects']) {
      expect(r.args).toContain(m);
    }
  });

  it('honours MINSPEC_CAVEMAN_MODE for another level', () => {
    expect(init(fakeHome(true), { MINSPEC_CAVEMAN_MODE: 'ultra' }).args).toContain('level: ultra');
  });

  it.each(['off', ''])('is switched off by MINSPEC_CAVEMAN_MODE=%j', (v) => {
    const r = init(fakeHome(true), { MINSPEC_CAVEMAN_MODE: v });
    expect(r.count).toBe(0);
  });

  it('never touches the shared ~/.claude/.caveman-active flag interactive sessions read', () => {
    const home = fakeHome(true);
    init(home, {});
    expect(fs.existsSync(path.join(home, '.claude/.caveman-active'))).toBe(false);
  });

  it('no caveman plugin installed at all (CI, an adopter): no args and no stderr noise', () => {
    const r = init(fakeHome(false), {});
    expect(r.count).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('fails visible, not silent: an installed plugin with no usable hook launches without caveman and says so', () => {
    const home = fakeHome(false);
    fs.mkdirSync(path.join(home, '.claude/plugins/cache/caveman/caveman/abc123'), { recursive: true });
    const r = init(home, {});
    expect(r.count).toBe(0);
    expect(r.stderr).toContain('running without caveman');
  });

  it('a hook that reports a different level launches without caveman and says so', () => {
    const home = fakeHome(true);
    const hook = path.join(home, '.claude/plugins/cache/caveman/caveman/abc123/hooks/caveman-activate.js');
    fs.writeFileSync(hook, "process.stdout.write('something else');\n");
    const r = init(home, {});
    expect(r.count).toBe(0);
    expect(r.stderr).toContain('did not report level');
  });

  it('rejects an unknown level visibly', () => {
    const r = init(fakeHome(true), { MINSPEC_CAVEMAN_MODE: 'wenyan' });
    expect(r.count).toBe(0);
    expect(r.stderr).toContain('not off|lite|full|ultra');
  });
});

describe('caveman trial: launch sites carry it', () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sites: Array<[string, number]> = [
    ['scripts/dispatch-issue.sh', 2],
    ['scripts/remediate-pr.sh', 1],
  ];
  it.each(sites)('%s inits once and passes the args at %i launch(es)', (file, n) => {
    const src = read(file);
    expect(src.match(/^agent_caveman_init$/gm)?.length).toBe(1);
    expect(src.match(/AGENT_CAVEMAN_ARGS\[@\]\+/g)?.length).toBe(n);
  });

  it('only the three build/fix/remediate agents are in the trial (interactive and reviewers are not)', () => {
    for (const f of ['scripts/triage-inbox.sh', 'scripts/review-pr.sh', 'scripts/review-branch.sh', 'scripts/review-approvable.sh']) {
      expect(read(f)).not.toContain('AGENT_CAVEMAN_ARGS');
    }
  });
});
