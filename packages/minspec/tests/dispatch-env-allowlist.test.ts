/**
 * T0 - Invariant: an agent started over issue text is handed an environment built from an
 * ALLOWLIST of names. No GitHub token, no token stamp, and nothing whose name ends in
 * `_API_KEY`, `_TOKEN` or `_SECRET` is in it, whatever the launcher itself was holding.
 *
 * ROOT CAUSE this makes un-committable. The launch sites started the agent behind
 * `AGENT_ENV_SCRUB` (scripts/lib/agent-context.sh), which builds the child's environment by
 * REMOVING one named variable from the launcher's own. So every other exported name was
 * passed on. scripts/lib/gh-bot.sh installs the launcher's GitHub token with `export`, into
 * that same shell, on the launcher's first write: the agent received it along with every
 * secret-named variable the operator's session happened to carry.
 *
 * WHAT SHOULD HAVE CAUGHT IT. agent-context-slim.test.ts asks whether each launcher applies
 * the scrub, and answers from the launcher's text plus the text of the libraries it
 * sources. The library's own text contains the scrub, so a launcher that sources it passes
 * whatever its child is given. Nothing looked at a child.
 *
 * So this suite looks at the child. Each block starts a real launcher (see
 * helpers/agent-launch-harness.ts for what is real and what is a stub) and reads the
 * environment the stub `claude` was started with. The fixture is varied, not only the
 * code: no token inherited at all, several forbidden names at once, names that match
 * nothing but the pattern, and secrets the pattern does not describe.
 *
 * WHAT A GREEN RUN DOES NOT SHOW. This is about what the agent INHERITS. It is still the
 * launcher's user, so a process it starts can ask anything that user can ask. An
 * allowlist cannot change that, and this suite does not claim it does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import {
  CREDENTIAL_SHAPE,
  DISPATCH,
  FIXTURE_VALUE,
  ISSUE_BODY_MARKER,
  LAUNCH_ENV,
  NAMED_CREDENTIALS,
  TRIAGE,
  author,
  cleanupLaunchHarness,
  credentialNames,
  reviewVerdict,
  runDispatch,
  runFixAgent,
  runTriage,
  withFixtureValues,
  type Launch,
} from './helpers/agent-launch-harness';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
afterEach(cleanupLaunchHarness);

const TRUSTED = { author: author('harvest316') };

/** What the launcher is holding when it starts the agent, one fixture per row. */
const HELD = [
  {
    name: 'nothing inherited: only the token the launcher mints for its own first write',
    held: [] as string[],
  },
  {
    name: 'the token and its stamp inherited, as the drain hands them down',
    held: ['GH_TOKEN', 'MINSPEC_GH_BOT_TOKEN_STAMP'],
  },
  {
    name: 'several forbidden names at once',
    held: [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'MINSPEC_GH_BOT_TOKEN_STAMP',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'SEARCH_PROVIDER_API_KEY',
      'NPM_TOKEN',
      'WEBHOOK_SECRET',
    ],
  },
  {
    name: 'names that match nothing but the pattern',
    held: ['X_API_KEY', 'Y_TOKEN', 'Z_SECRET', 'NOBODY_HAS_HEARD_OF_THIS_API_KEY'],
  },
  {
    name: 'secrets and switches the pattern does not describe',
    held: [
      'MINSPEC_SHADOW_TRIAGE_KEY',
      'DB_PASSWORD',
      'SSH_AUTH_SOCK',
      'AWS_SECRET_ACCESS_KEY',
      'MINSPEC_GATE_OFF',
      'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
      'SOME_SETTING_NOBODY_LISTED',
    ],
  },
];

/** What a run needs, and must still have. Each with a value that can be recognised. */
const NEEDED: Record<string, string> = {
  TZ: 'Pacific/Auckland',
  LANG: 'C.UTF-8',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/fixture-proxy',
  CLAUDE_EFFORT: 'low',
  CLAUDE_CONFIG_DIR: '/nonexistent/fixture-claude-config',
};

function onlyLaunch(launches: Launch[], context: string): Launch {
  expect(launches.length, `expected exactly one agent launch:\n${context}`).toBe(1);
  return launches[0];
}

function expectNothingForbidden(launch: Launch, held: string[]): void {
  // By name: everything the fixture planted.
  expect(launch.names.filter((n) => held.includes(n))).toEqual([]);
  // By rule: the token, its twin and its stamp, and anything credential-shaped, whether
  // the fixture planted it or the launcher made it (the minted token is not in `held`).
  expect(credentialNames(launch)).toEqual([]);
}

describe('T0: the build agent, started by the real scripts/dispatch-issue.sh', () => {
  it('the harness is not vacuous: the agent is started, in its worktree, on the issue text', () => {
    const r = runDispatch({ issue: TRUSTED });
    const launch = onlyLaunch(r.launches, r.out);
    expect(launch.cwd).toBe(r.worktree);
    expect(launch.prompt).toContain(ISSUE_BODY_MARKER);
    expect(launch.argv).toContain('--allowedTools');
    // The recorder sees an environment at all, or every "is absent" below is true of nothing.
    expect(launch.names).toContain('PATH');
  });

  it.each(HELD)('holds no credential when the launcher has: $name', ({ held }) => {
    const r = runDispatch({ issue: TRUSTED, env: withFixtureValues(held) });
    const launch = onlyLaunch(r.launches, r.out);
    expectNothingForbidden(launch, held);
  });

  it('the launcher did hold a token while the agent ran, and kept it afterwards', () => {
    // The other half of the row above that inherits nothing. A launcher with no token
    // would make "the agent has none" true for the wrong reason, and a fix that disarmed
    // the launcher would break every write it makes after the agent exits.
    const r = runDispatch({ issue: TRUSTED });
    onlyLaunch(r.launches, r.out);
    expect(r.ghWrites.length).toBeGreaterThanOrEqual(3);
    expect(r.ghWrites.filter((w) => !w.endsWith('token=present'))).toEqual([]);
    // Before the launch (the claim, the running label) and after it (the escalation).
    expect(r.ghWrites.filter((w) => w.startsWith('issue edit'))).toHaveLength(2);
  });

  it('still has what a run needs, with the values the launcher had', () => {
    const r = runDispatch({ issue: TRUSTED, env: { ...NEEDED, ...withFixtureValues(['GH_TOKEN', 'X_API_KEY']) } });
    const launch = onlyLaunch(r.launches, r.out);
    for (const [name, value] of Object.entries(NEEDED)) expect(launch.env[name], name).toBe(value);
    // PATH is the launcher's, so the tools the agent runs are the ones the launcher sees.
    expect(launch.env.PATH).toContain(path.join(r.dir, 'bin'));
    expect(launch.env.HOME).toBe(path.join(r.dir, 'home'));
    expect(launch.env.PWD).toBe(r.worktree);
    expectNothingForbidden(launch, ['GH_TOKEN', 'X_API_KEY']);
  });

  it('is started under the claim, with the build ceiling in front of the launch', () => {
    // The production shape, not a kill-switch path: the claim is won, so the launch line
    // runs with `timeout` ahead of it. A wrapper that only worked as the first word of
    // the command would pass every other test here and fail in the drain.
    const r = runDispatch({ issue: TRUSTED });
    expect(r.out).toContain(`Claimed #4242`);
    expect(r.claims).toHaveLength(1);
    onlyLaunch(r.launches, r.out);
  });
});

describe('T0: the triage agent, started by the real scripts/triage-inbox.sh', () => {
  it.each(HELD)('holds no credential when the launcher has: $name', ({ held }) => {
    const r = runTriage({ issues: { '4242': TRUSTED }, only: '4242', env: withFixtureValues(held) });
    expect(r.status, r.out).toBe(0);
    const launch = onlyLaunch(r.launches, r.out);
    expectNothingForbidden(launch, held);
  });

  it('still has what a run needs, and the launcher applies the verdict with its own token', () => {
    const r = runTriage({
      issues: { '4242': TRUSTED },
      only: '4242',
      env: { ...NEEDED, ...withFixtureValues(['GH_TOKEN', 'GITHUB_TOKEN']) },
    });
    expect(r.status, r.out).toBe(0);
    const launch = onlyLaunch(r.launches, r.out);
    for (const [name, value] of Object.entries(NEEDED)) expect(launch.env[name], name).toBe(value);
    expect(launch.env.PATH).toContain(path.join(r.dir, 'bin'));
    // The verdict comment and the labels are written AFTER the agent has exited.
    expect(r.ghWrites.length).toBeGreaterThanOrEqual(2);
    expect(r.ghWrites.filter((w) => !w.endsWith('token=present'))).toEqual([]);
  });
});

describe('T0: the fix agent, started by the real shepherd_fix', () => {
  const comments = [{ login: 'minspec-sdd', association: 'CONTRIBUTOR', body: reviewVerdict('BOT-FINDING') }];

  it.each(HELD)('holds no credential when the launcher has: $name', ({ held }) => {
    const r = runFixAgent({ comments, env: withFixtureValues(held) });
    const launch = onlyLaunch(r.launches, r.out);
    expectNothingForbidden(launch, held);
  });

  it('still has what a run needs', () => {
    const r = runFixAgent({ comments, env: NEEDED });
    const launch = onlyLaunch(r.launches, r.out);
    for (const [name, value] of Object.entries(NEEDED)) expect(launch.env[name], name).toBe(value);
    // The launcher minted for its own comment before it started the agent.
    expect(r.ghWrites).toContain('pr comment token=present');
  });
});

describe('scripts/lib/agent-launch-env.sh: the allowlist itself', () => {
  /** Run the wrapper with exactly this environment. PATH is added so `bash` and friends resolve. */
  function launch(args: string[], env: Record<string, string> = {}) {
    return spawnSync('bash', [LAUNCH_ENV, ...args], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', ...env },
    });
  }
  /** The names a process started through the wrapper holds. */
  function namesGiven(env: Record<string, string>): string[] {
    const r = launch(['bash', '-c', 'while IFS= read -r -d "" kv; do printf "%s\\n" "${kv%%=*}"; done < /proc/$$/environ'], env);
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\n').filter(Boolean).sort();
  }
  function allowlist(): string[] {
    const r = launch(['--names']);
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\n').filter(Boolean);
  }

  it('prints its list, and nothing on it is a credential by name', () => {
    const names = allowlist();
    expect(names).toContain('PATH');
    expect(names).toContain('HOME');
    expect(names.filter((n) => CREDENTIAL_SHAPE.test(n) || NAMED_CREDENTIALS.includes(n))).toEqual([]);
    // One name per line, each a plain variable name: the list is names, never patterns.
    for (const n of names) expect(n).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a started process holds only names that are on the list', () => {
    const everything = {
      HOME: '/nonexistent/fixture-home',
      ...NEEDED,
      ...withFixtureValues(HELD.flatMap((h) => h.held)),
    };
    const given = namesGiven(everything);
    const allowed = new Set(allowlist());
    expect(given.filter((n) => !allowed.has(n))).toEqual([]);
    // And it is not empty: the names the launcher had and the list has did arrive.
    for (const n of ['PATH', 'HOME', ...Object.keys(NEEDED)]) expect(given, n).toContain(n);
  });

  it('does not invent a name the launcher did not have', () => {
    // bash gives itself a TERM and a SHELL when it has none. Those are the launcher
    // shell's own, not something it was handed, and they are not passed on. PWD is the
    // one name a shell always exports: it is the directory the launch happens in.
    const given = namesGiven({});
    expect(given).toEqual(['PATH', 'PWD']);
  });

  it('passes values and arguments through byte for byte', () => {
    const awkward = 'http://127.0.0.1:9/a b?x=1&y="2"\'3\'\nsecond line $HOME `id`';
    const v = launch(['bash', '-c', 'printf %s "$ANTHROPIC_BASE_URL"'], { ANTHROPIC_BASE_URL: awkward });
    expect(v.stdout).toBe(awkward);
    const a = launch(['printf', '[%s]', 'a b', '', 'c\nd', '-p', '--model', 'x=y']);
    expect(a.stdout).toBe('[a b][][c\nd][-p][--model][x=y]');
  });

  it('ends on the status of what it started, including under `timeout`', () => {
    expect(launch(['bash', '-c', 'exit 7']).status).toBe(7);
    const r = spawnSync('timeout', ['--kill-after=5s', '20s', 'bash', LAUNCH_ENV, 'bash', '-c', 'echo ran; exit 9'], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', ...withFixtureValues(['GH_TOKEN']) },
    });
    expect(r.stdout).toBe('ran\n');
    expect(r.status).toBe(9);
  });

  it('says nothing of its own when it starts something', () => {
    // The triage launcher captures the agent's output, stderr included, and hands it to a
    // parser. A line of the wrapper's own in that stream would be read as the agent's.
    const r = launch(['bash', '-c', 'true'], withFixtureValues(['GH_TOKEN', 'X_API_KEY']));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('refuses to start nothing, and refuses a command word `env` would read as an assignment', () => {
    const none = launch([]);
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/usage/i);
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'launch-env-')), 'ran');
    const assign = launch([`GH_TOKEN=${FIXTURE_VALUE}`, 'bash', '-c', `touch ${JSON.stringify(marker)}`]);
    expect(assign.status).not.toBe(0);
    expect(assign.stderr).toMatch(/assignment/);
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(path.dirname(marker), { recursive: true, force: true });
  });

  it('the autocompact switch keeps the one setting it was made for, and nothing else', () => {
    // MINSPEC_AGENT_ENV_SCRUB=0 exists to hand an agent the operator's autocompact
    // threshold while debugging #1203. It used to mean "inherit everything".
    const held = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55', ...withFixtureValues(['GH_TOKEN', 'X_API_KEY', 'DB_PASSWORD']) };
    expect(namesGiven(held)).toEqual(['PATH', 'PWD']);
    expect(namesGiven({ ...held, MINSPEC_AGENT_ENV_SCRUB: '1' })).toEqual(['PATH', 'PWD']);
    expect(namesGiven({ ...held, MINSPEC_AGENT_ENV_SCRUB: '0' })).toEqual([
      'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
      'PATH',
      'PWD',
    ]);
  });

  it('reports what it passes and what it withholds, by name and never by value', () => {
    const r = launch(['--report'], {
      HOME: '/nonexistent/fixture-home',
      TZ: 'Pacific/Auckland',
      ...withFixtureValues(['GH_TOKEN', 'X_API_KEY', 'SOME_SETTING_NOBODY_LISTED']),
    });
    expect(r.status, r.stderr).toBe(0);
    const text = r.stdout;
    expect(text.trim().split('\n')).toHaveLength(1);
    const [passing, withholding] = text.split('withholding');
    for (const n of ['PATH', 'HOME', 'TZ']) expect(passing, n).toMatch(new RegExp(`\\b${n}\\b`));
    for (const n of ['GH_TOKEN', 'X_API_KEY', 'SOME_SETTING_NOBODY_LISTED']) {
      expect(passing, n).not.toMatch(new RegExp(`\\b${n}\\b`));
      expect(withholding, n).toMatch(new RegExp(`\\b${n}\\b`));
    }
    expect(text).not.toContain(FIXTURE_VALUE);
    expect(text).not.toContain('Pacific/Auckland');
  });

  it('a list that has gained a credential-shaped name starts nothing', () => {
    // The list is the control, so an edit to it is the way this comes back. A copy of the
    // wrapper with one such name added must refuse outright, and say which name.
    const src = fs.readFileSync(LAUNCH_ENV, 'utf-8');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-env-mutant-'));
    try {
      for (const added of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'MINSPEC_GH_BOT_TOKEN_STAMP', 'WEBHOOK_SECRET']) {
        const mutant = src.replace(/^AGENT_ENV_ALLOW=\(\n/m, `AGENT_ENV_ALLOW=(\n  ${added}\n`);
        // The edit landed where it was meant to, or a survivor here would mean nothing.
        expect(mutant).not.toBe(src);
        const file = path.join(dir, `${added}.sh`);
        fs.writeFileSync(file, mutant);
        const marker = path.join(dir, `${added}.ran`);
        const r = spawnSync('bash', [file, 'bash', '-c', `touch ${JSON.stringify(marker)}`], {
          encoding: 'utf-8',
          env: { PATH: process.env.PATH ?? '', [added]: FIXTURE_VALUE },
        });
        expect(r.status, added).not.toBe(0);
        expect(r.stderr, added).toContain(added);
        expect(fs.existsSync(marker), added).toBe(false);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('every agent launch in the two launchers goes through the allowlist', () => {
  // A supplement, not the proof. The blocks above observe the launches they can drive;
  // this catches a NEW launch line added to either file without the wrapper, on the day
  // it is written. It reads code lines, so a documented example can neither satisfy nor
  // trip it. `claude -p --help` is a capability probe: no prompt, no tool, no model call.
  function launchLines(file: string): string[] {
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .filter((l) => /\bclaude\s+(-p|--print)\b/.test(l) && !/\bclaude\s+-p\s+--help\b/.test(l))
      .map((l) => l.trim());
  }

  it('finds the launch lines (the scan is not vacuous)', () => {
    expect(launchLines(DISPATCH)).toHaveLength(2); // the build agent and the fix agent
    expect(launchLines(TRIAGE)).toHaveLength(1);
  });

  it.each([DISPATCH, TRIAGE])('%s: `claude` is started by the wrapper, on the launching line', (file) => {
    const bare = launchLines(file).filter((l) => !/\bbash "\$AGENT_LAUNCH_ENV" claude\s+(-p|--print)\b/.test(l));
    expect(bare.map((l) => l.slice(0, 100))).toEqual([]);
  });
});
