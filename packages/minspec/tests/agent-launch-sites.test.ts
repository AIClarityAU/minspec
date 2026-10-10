/**
 * T0 - every start of the CLI under scripts/ goes through the allowlist, and what each
 * one's agent is handed is what the allowlist says (#1203).
 *
 * dispatch-env-allowlist.test.ts holds this for the two launchers that read issue text
 * (the dispatcher and triage). This file holds it for the rest, and for the property
 * itself: that there is no start of the CLI anywhere under scripts/ that does not go
 * through scripts/lib/agent-context.sh, bar two that are named. Both are in the hand-run
 * verifier of the extension's own sealed start, which has to start the CLI the way the
 * extension does. SEALED_START_UNDER_VERIFICATION says what those two are handed (the
 * whole environment of whoever runs it) and why that is accepted there, and the gate
 * holds each to what its reason rests on.
 *
 * Root cause this guards: every launch used to sit behind an array that REMOVED one
 * variable from the launcher's own environment and passed the rest on, and the one test
 * near it (agent-context-slim.test.ts) matched launcher source text plus the text of the
 * library each launcher sources, so it stayed green whatever the child received. Fixing
 * two launchers left five inheriting, which is the same defect with a shorter list.
 *
 * THREE KINDS OF TEST HERE.
 *   1. Per launch site: the REAL script is run against a stub `gh` and a stub `claude`
 *      that records the environment it was started with. What is asserted is what the
 *      child held, never what the launcher's text says.
 *   2. The helper cannot be swapped: not by a variable in the launcher's environment, not
 *      by a copy at its own relative path in the agent's worktree, and when it is missing
 *      nothing is started.
 *   3. The enumerating gate: every file under scripts/ is read, and a mention of the CLI
 *      fails unless it is a start through the helper, or on a short list of explained
 *      non-starts, or one of the two listed starts of the verifier, whole and in its own
 *      file. A new launcher that names the CLI and inherits cannot be added quietly.
 *
 * WHAT THE GATE CANNOT SEE. It reads text for the CLI's name, so it is a tripwire for
 * the ordinary ways of writing a start, and not a proof that there is no other:
 *   - a start that never names the CLI under scripts/: a program held in a variable that
 *     is given its value somewhere this does not read (the environment, a file elsewhere);
 *   - a start from a file that is not under scripts/ at all;
 *   - a line of TypeScript that opens with `*` and is code (a multiplication carried onto
 *     a line of its own) is read as the inside of a comment.
 * What a started agent actually held is the first kind of test, which runs the launchers
 * and reads what the child was given. That one does not depend on how a start is spelled.
 *
 * Every "secret" is a fixture value that says so. Nothing here can reach GitHub.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
// The extension's own builders for its one start of the CLI. Read here only to hold the
// verifier's two listed starts to what is said about them; see SEALED_START_UNDER_VERIFICATION.
import { aiPassArgs, aiPassEnv } from '../src/lib/epic-backfill';
import {
  DISPATCH_ISSUE,
  FIXTURE_VALUE,
  FOUNDER,
  ROOT,
  SCRIPTS,
  checkoutWithoutLaunchHelper,
  cleanupLaunchHarness,
  credentialNames,
  passThroughHelper,
  runDispatch,
  runFixAgent,
  runRadar,
  runRemediate,
  runReviewApprovable,
  runReviewBranch,
  runReviewPr,
  runTriage,
  reviewVerdict,
  withFixtureValues,
  type Launch,
  type Run,
  type SiteOptions,
} from './helpers/agent-launch-harness';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
afterEach(cleanupLaunchHarness);

/** What the launcher is holding when it starts its agent. Each row is a different mix. */
const HELD: { name: string; names: string[] }[] = [
  { name: 'the GitHub token and its stamp', names: ['GH_TOKEN', 'MINSPEC_GH_BOT_TOKEN_STAMP'] },
  { name: 'several credentials at once', names: ['GH_TOKEN', 'GITHUB_TOKEN', 'TAVILY_API_KEY', 'NPM_TOKEN', 'WEBHOOK_SECRET'] },
  {
    name: 'names no pattern describes',
    names: ['MINSPEC_SHADOW_TRIAGE_KEY', 'AWS_ACCESS_KEY_ID', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'SSH_AUTH_SOCK'],
  },
  { name: "both of the model's own logins", names: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN'] },
];

/** What a run needs, and must still be handed. The values are checked, not only the names. */
const NEEDED: Record<string, string> = {
  TZ: 'Antarctica/Troll',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/fixture-proxy',
  CLAUDE_EFFORT: 'low',
};

interface Site {
  name: string;
  run(opts: SiteOptions): Run;
  /**
   * One entry per start of the CLI the run makes, in order: the model login that start
   * asks for by name, or null when it asks for none.
   */
  logins: (string | null)[];
  /** `--help` capability probes the run makes before it. */
  probes: number;
}

const SITES: Site[] = [
  { name: 'review-pr.sh, the pull request reviewer', run: runReviewPr, logins: [null], probes: 1 },
  { name: 'review-branch.sh, the subscription reviewer', run: runReviewBranch, logins: ['CLAUDE_CODE_OAUTH_TOKEN'], probes: 1 },
  {
    name: 'review-branch.sh, the pay-as-you-go failover',
    run: (o) => runReviewBranch({ ...o, failover: true }),
    logins: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    probes: 1,
  },
  { name: 'review-approvable.sh, the subscription reviewer', run: runReviewApprovable, logins: ['CLAUDE_CODE_OAUTH_TOKEN'], probes: 1 },
  {
    name: 'review-approvable.sh, the pay-as-you-go failover',
    run: (o) => runReviewApprovable({ ...o, failover: true }),
    logins: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    probes: 1,
  },
  { name: 'remediate-pr.sh, the remediation agent', run: runRemediate, logins: [null], probes: 0 },
  { name: 'tooling-radar/run-radar.sh, the scan', run: runRadar, logins: [null], probes: 0 },
];

/**
 * Assert one start holds exactly what it may: none of `held`, except the one model login
 * that start asked for by name, and that one only when the launcher had it to give.
 */
function expectOnlyWhatItMay(launch: Launch, login: string | null, parent: Record<string, string>, what: string): void {
  const may = login !== null && login in parent ? [login] : [];
  expect(credentialNames(launch), `${what}: credential-shaped names in the child`).toEqual(may);
  for (const name of Object.keys(parent)) {
    if (may.includes(name) || name in NEEDED) continue;
    expect(launch.names, `${what}: ${name} must not reach the child`).not.toContain(name);
  }
  if (may.length === 1) expect(launch.env[may[0]], `${what}: the login arrives unchanged`).toBe(parent[may[0]]);
}

describe.each(SITES)('T0: $name', (site) => {
  it('control: the launch is really reached, the expected number of times', () => {
    const run = site.run({});
    expect(run.launches, run.out).toHaveLength(site.logins.length);
    expect(run.probes, run.out).toHaveLength(site.probes);
    for (const launch of run.launches) expect(launch.argv).toContain('-p');
  });

  it.each(HELD)('holding $name, the agent is handed none of it but its own login', ({ names }) => {
    const parent = withFixtureValues(names);
    const run = site.run({ env: parent });
    expect(run.launches, run.out).toHaveLength(site.logins.length);
    // A failover run always holds the pay-as-you-go key: the harness sets it to stage one.
    const held = { ...parent, ...(site.logins.includes('ANTHROPIC_API_KEY') ? { ANTHROPIC_API_KEY: FIXTURE_VALUE } : {}) };
    site.logins.forEach((login, i) => expectOnlyWhatItMay(run.launches[i], login, held, `start ${i}`));
  });

  it('the capability probe is handed no credential at all, not even a model login', () => {
    const run = site.run({ env: withFixtureValues(['GH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'TAVILY_API_KEY']) });
    expect(run.probes).toHaveLength(site.probes);
    for (const probe of run.probes) {
      expect(credentialNames(probe)).toEqual([]);
      expect(probe.names).toContain('PATH');
    }
  });

  it('what a run needs is still handed over, unchanged', () => {
    const run = site.run({ env: { ...NEEDED, ...withFixtureValues(['GH_TOKEN']) } });
    expect(run.launches, run.out).toHaveLength(site.logins.length);
    for (const launch of run.launches) {
      for (const [name, value] of Object.entries(NEEDED)) expect(launch.env[name], name).toBe(value);
      expect(launch.names).toEqual(expect.arrayContaining(['PATH', 'HOME']));
      expect(launch.names).not.toContain('GH_TOKEN');
    }
  });

  it('a helper path offered in the environment is not the one that runs', () => {
    // AGENT_LAUNCH_ENV names the program the launch goes through. If a launcher took it
    // from its environment, pointing it at a program that hands everything over would
    // undo the list. Each launcher assigns it itself, from its own directory.
    const parent = { ...withFixtureValues(['GH_TOKEN', 'GITHUB_TOKEN', 'TAVILY_API_KEY']), AGENT_LAUNCH_ENV: passThroughHelper() };
    const run = site.run({ env: parent });
    expect(run.launches, run.out).toHaveLength(site.logins.length);
    const held = { ...parent, ...(site.logins.includes('ANTHROPIC_API_KEY') ? { ANTHROPIC_API_KEY: FIXTURE_VALUE } : {}) };
    site.logins.forEach((login, i) => expectOnlyWhatItMay(run.launches[i], login, held, `start ${i}`));
    for (const probe of run.probes) expect(credentialNames(probe)).toEqual([]);
  });
});

describe('T0: a reviewer is handed one model login, and which one decides who pays', () => {
  it.each([
    ['review-branch.sh', runReviewBranch],
    ['review-approvable.sh', runReviewApprovable],
  ] as const)('%s: the subscription start never holds the pay-as-you-go key, and the failover never holds the token', (_n, run) => {
    const r = run({ failover: true, env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-subscription-login' } });
    expect(r.launches, r.out).toHaveLength(2);
    const [subscription, payg] = r.launches;
    expect(subscription.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('fixture-subscription-login');
    expect(subscription.names).not.toContain('ANTHROPIC_API_KEY');
    expect(payg.env.ANTHROPIC_API_KEY).toBe(FIXTURE_VALUE);
    expect(payg.names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('with no failover configured, a quota outage starts no second reviewer', () => {
    const r = runReviewBranch({ failover: true, env: { AI_REVIEW_FAILOVER: 'wait' } });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].names).not.toContain('ANTHROPIC_API_KEY');
  });
});

describe('T0: the launch helper cannot be swapped for another', () => {
  const HOSTILE = withFixtureValues(['GH_TOKEN', 'GITHUB_TOKEN', 'TAVILY_API_KEY', 'WEBHOOK_SECRET']);
  const founder = { author: FOUNDER };

  it('dispatch-issue.sh: a helper path offered in the environment is not the one that runs', () => {
    const run = runDispatch({ issue: founder, env: { ...HOSTILE, AGENT_LAUNCH_ENV: passThroughHelper() } });
    expect(run.launches, run.out).toHaveLength(1);
    expect(credentialNames(run.launches[0])).toEqual([]);
  });

  it('triage-inbox.sh: a helper path offered in the environment is not the one that runs', () => {
    const run = runTriage({
      issues: { [DISPATCH_ISSUE]: founder },
      only: DISPATCH_ISSUE,
      env: { ...HOSTILE, AGENT_LAUNCH_ENV: passThroughHelper() },
    });
    expect(run.launches, run.out).toHaveLength(1);
    expect(credentialNames(run.launches[0])).toEqual([]);
  });

  it("dispatch-issue.sh's fix agent: a helper path offered in the environment is not the one that runs", () => {
    const run = runFixAgent({
      comments: [{ author: FOUNDER, association: 'OWNER', body: reviewVerdict('FIX-THIS') }],
      env: { ...HOSTILE, AGENT_LAUNCH_ENV: passThroughHelper() },
    });
    expect(run.launches, run.out).toHaveLength(1);
    expect(credentialNames(run.launches[0])).toEqual([]);
  });

  it('dispatch-issue.sh: a copy of the helper in the agent worktree, where an agent could have edited it, is not used', () => {
    const run = runDispatch({ issue: founder, env: HOSTILE, plantHelperCopy: true });
    expect(run.launches, run.out).toHaveLength(1);
    // Not vacuous: the copy really was at the helper's own relative path, in the
    // directory the agent was started in.
    expect(run.launches[0].helperCopyInCwd).toBe(true);
    expect(run.launches[0].cwd).toBe(run.worktree);
    expect(credentialNames(run.launches[0])).toEqual([]);
  });

  it('remediate-pr.sh: a copy of the helper on the pull request branch is not used', () => {
    const run = runRemediate({ env: HOSTILE });
    expect(run.launches, run.out).toHaveLength(1);
    expect(run.launches[0].helperCopyInCwd).toBe(true);
    expect(run.launches[0].cwd).toBe(run.worktree);
    expect(credentialNames(run.launches[0])).toEqual([]);
  });
});

describe('T0: with the launch program missing, no launcher starts anything', () => {
  // The program is scripts/lib/agent-context.sh, the library every launcher sources. So
  // "missing" is that file being gone, and each launcher must stop on its own `source`
  // line, before it fetches, claims or starts anything, and never go on to start the CLI
  // with its own environment instead.
  let co: ReturnType<typeof checkoutWithoutLaunchHelper>;
  let base: string;
  let head: string;

  beforeAll(() => {
    co = checkoutWithoutLaunchHelper();
    const rev = (ref: string) => spawnSync('git', ['-C', co.root, 'rev-parse', ref], { encoding: 'utf-8' }).stdout.trim();
    base = rev('HEAD~1');
    fs.writeFileSync(path.join(co.root, 'changed.txt'), 'a change to review\n');
    spawnSync('git', ['-C', co.root, 'add', 'changed.txt'], { encoding: 'utf-8' });
    spawnSync(
      'git',
      ['-C', co.root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'a change'],
      { encoding: 'utf-8', env: { ...process.env, HOME: co.root } },
    );
    head = rev('HEAD');
    fs.writeFileSync(path.join(co.root, 'doc.md'), '# a document\n\nwith a line.\n');
  });
  afterAll(() => co.dispose());

  const cases: [string, () => string[]][] = [
    ['triage-inbox.sh', () => ['triage-inbox.sh', DISPATCH_ISSUE]],
    ['dispatch-issue.sh', () => ['dispatch-issue.sh', DISPATCH_ISSUE]],
    ['review-branch.sh', () => ['review-branch.sh', base, head]],
    ['review-pr.sh', () => ['review-pr.sh', '77']],
    ['review-approvable.sh', () => ['review-approvable.sh', path.join(co.root, 'doc.md')]],
    ['remediate-pr.sh', () => ['remediate-pr.sh', '77']],
    ['tooling-radar/run-radar.sh', () => ['tooling-radar/run-radar.sh', '--dry-run']],
  ];

  it.each(cases)('%s stops, names the missing file, and starts no agent and no probe', (_name, argv) => {
    const [script, ...args] = argv();
    const r = spawnSync('bash', [path.join(co.scripts, script), ...args], { cwd: co.root, encoding: 'utf-8', env: co.env });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).not.toBe(0);
    expect(out).toMatch(/lib\/agent-context\.sh: No such file or directory/);
    const seen = co.recorded();
    expect(seen.launches).toEqual([]);
    expect(seen.probes).toEqual([]);
    // Stopped before anything was read from GitHub or changed on it.
    expect(seen.ghCalls.filter((c) => /^(issue|pr) /.test(c))).toEqual([]);
    expect(seen.ghWrites).toEqual([]);
  });

  it('control: the same checkout with the file put back does start one', () => {
    fs.copyFileSync(path.join(SCRIPTS, 'lib', 'agent-context.sh'), path.join(co.scripts, 'lib', 'agent-context.sh'));
    const r = spawnSync('bash', [path.join(co.scripts, 'review-approvable.sh'), path.join(co.root, 'doc.md')], {
      cwd: co.root,
      encoding: 'utf-8',
      env: co.env,
    });
    expect(co.recorded().launches, `${r.stdout}${r.stderr}`).toHaveLength(1);
  });
});

describe('scripts/lib/agent-context.sh: sourced it is a library, and it names itself as the program', () => {
  const LIB = path.join(SCRIPTS, 'lib', 'agent-context.sh');
  const sourced = (script: string, opts: { cwd?: string; env?: Record<string, string> } = {}) =>
    spawnSync('bash', ['-c', script, 'bash', LIB], {
      encoding: 'utf-8',
      cwd: opts.cwd,
      env: { PATH: process.env.PATH ?? '', ...opts.env },
    });

  it('AGENT_LAUNCH_ENV is its own absolute path, whatever the environment offered', () => {
    const r = sourced('set -euo pipefail; source "$1"; printf "%s" "$AGENT_LAUNCH_ENV"', {
      env: { AGENT_LAUNCH_ENV: passThroughHelper() },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(LIB);
  });

  it('and still absolute when it is sourced by a relative path from another directory', () => {
    const r = sourced('set -euo pipefail; source lib/agent-context.sh; cd /; printf "%s" "$AGENT_LAUNCH_ENV"', { cwd: SCRIPTS });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(LIB);
    expect(path.isAbsolute(r.stdout)).toBe(true);
  });

  it('sourcing it starts nothing, prints nothing, and leaves the caller\'s shell options alone', () => {
    // The program below the `return` must not run in a launcher's own shell: it ends
    // with `exec`, which would replace the launcher.
    const r = sourced('source "$1"; echo "still here: opts=$-"; declare -p AGENT_ENV_ALLOW 2>/dev/null || echo "no list in the caller"');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/^still here: opts=[a-zA-Z]*\n/);
    expect(r.stdout).not.toMatch(/opts=[a-zA-Z]*e/); // `set -e` was not turned on behind the caller's back
    expect(r.stdout).toContain('no list in the caller');
  });

  it('run, with no command, it refuses and starts nothing', () => {
    const r = spawnSync('bash', [LIB], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Nothing was started/);
  });
});

describe('scripts/lib/agent-context.sh: --model-login hands over one known login, and nothing else by that door', () => {
  const LIB = path.join(SCRIPTS, 'lib', 'agent-context.sh');
  const HOLDING = withFixtureValues(['GH_TOKEN', 'GITHUB_TOKEN', 'TAVILY_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
  /** Run `env` through the program and return the names it was started with, or the refusal. */
  const through = (args: string[], env: Record<string, string> = HOLDING, program = LIB) => {
    const r = spawnSync('bash', [program, ...args, 'env'], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', ...env } });
    const names = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(0, l.indexOf('=')));
    return { status: r.status, names, stderr: r.stderr, started: r.stdout !== '' };
  };

  it('with no option, neither login is handed over', () => {
    const r = through([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.names).toContain('PATH');
    expect(r.names.filter((n) => n in HOLDING)).toEqual([]);
  });

  it.each(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])('asked for %s, it hands over that one and not the other', (login) => {
    const r = through(['--model-login', login]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.names.filter((n) => n in HOLDING)).toEqual([login]);
  });

  it('a login the launcher does not hold is not invented', () => {
    const r = through(['--model-login', 'ANTHROPIC_API_KEY'], withFixtureValues(['GH_TOKEN']));
    expect(r.status, r.stderr).toBe(0);
    expect(r.names).not.toContain('ANTHROPIC_API_KEY');
    expect(r.names).not.toContain('GH_TOKEN');
  });

  it.each([
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'MINSPEC_GH_BOT_TOKEN_STAMP',
    'TAVILY_API_KEY',
    'PATH',
    'anthropic_api_key',
    'ANTHROPIC_API_KEY=x',
    'ANTHROPIC_API_KEY GH_TOKEN',
    '*',
    '',
  ])('asked for %j, it refuses and starts nothing', (name) => {
    const r = through(['--model-login', name]);
    expect(r.status).toBe(1);
    expect(r.started).toBe(false);
    expect(r.stderr).toMatch(/Nothing was started/);
    // The refusal never prints a value, and never echoes something that is not a name.
    expect(r.stderr).not.toContain(FIXTURE_VALUE);
  });

  it('the option with no name after it refuses and starts nothing', () => {
    const r = spawnSync('bash', [LIB, '--model-login'], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', ...HOLDING } });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });

  it('a variable in the environment cannot ask on a launch\'s behalf', () => {
    const r = through([], { ...HOLDING, AGENT_MODEL_LOGINS: 'GH_TOKEN', MODEL_LOGIN: 'GH_TOKEN', AGENT_ENV_ALLOW: 'GH_TOKEN' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.names.filter((n) => n in HOLDING)).toEqual([]);
  });

  it('a copy whose set of model logins has gained a GitHub name refuses to start anything, option or no option', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-mutated-logins-'));
    try {
      const src = fs.readFileSync(LIB, 'utf-8');
      const mutated = src.replace(/^AGENT_MODEL_LOGINS=\(\n/m, 'AGENT_MODEL_LOGINS=(\n  GH_TOKEN\n');
      expect(mutated, 'the edit must land, or this test tests nothing').not.toBe(src);
      const copy = path.join(dir, 'agent-context.sh');
      fs.writeFileSync(copy, mutated);
      for (const args of [[], ['--model-login', 'GH_TOKEN']]) {
        const r = through(args, HOLDING, copy);
        expect(r.status).toBe(1);
        expect(r.started).toBe(false);
        expect(r.stderr).toMatch(/GH_TOKEN is among the model logins, and it is GitHub's/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // What a name says it holds does not depend on its case. (The program used to upper-case
  // the name to ask; on a bash that cannot do that it matches without regard to case.)
  it.each([
    ['AGENT_ENV_ALLOW', 'FIXTURE_API_KEY', /FIXTURE_API_KEY is on the list, and it is named like a credential/],
    ['AGENT_ENV_ALLOW', 'fixture_api_key', /fixture_api_key is on the list, and it is named like a credential/],
    ['AGENT_ENV_ALLOW', 'Fixture_Token', /Fixture_Token is on the list, and it is named like a credential/],
    ['AGENT_ENV_ALLOW', 'gh_token', /gh_token is on the list, and it is named like a credential/],
    // Anything of GitHub's, whatever it holds: the list is held to the same rule the model
    // logins are.
    ['AGENT_ENV_ALLOW', 'GH_HOST', /GH_HOST is on the list, and it is GitHub's/],
    ['AGENT_ENV_ALLOW', 'github_repository', /github_repository is on the list, and it is GitHub's/],
    ['AGENT_ENV_ALLOW', 'MINSPEC_GH_APP_ID', /MINSPEC_GH_APP_ID is on the list, and it is GitHub's/],
    ['AGENT_MODEL_LOGINS', 'github_app_key', /github_app_key is among the model logins, and it is GitHub's/],
    ['AGENT_MODEL_LOGINS', 'my_gh_bot_login', /my_gh_bot_login is among the model logins, and it is GitHub's/],
  ] as [string, string, RegExp][])('a copy whose %s has gained %s refuses to start anything, whatever case the name is in', (list, name, says) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-mutated-case-'));
    try {
      const src = fs.readFileSync(LIB, 'utf-8');
      const mutated = src.replace(new RegExp(`^${list}=\\(\\n`, 'm'), `${list}=(\n  ${name}\n`);
      expect(mutated, 'the edit must land, or this test tests nothing').not.toBe(src);
      const copy = path.join(dir, 'agent-context.sh');
      fs.writeFileSync(copy, mutated);
      const r = through([], HOLDING, copy);
      expect(r.status).toBe(1);
      expect(r.started).toBe(false);
      expect(r.stderr).toMatch(says);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('and the names it hands over are still matched exactly afterwards', () => {
    // Reading a name's shape without regard to case must not leave the shell matching
    // everything that way. `http_proxy` is listed and held here; HTTP_PROXY is listed and
    // is NOT held, and must not appear because its lower-case twin does.
    const r = through([], { http_proxy: 'fixture' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.names).toContain('http_proxy');
    expect(r.names).not.toContain('HTTP_PROXY');
    // And a model login asked for in the wrong case is not one.
    const asked = through(['--model-login', 'anthropic_api_key'], HOLDING);
    expect(asked.status).toBe(1);
    expect(asked.started).toBe(false);
  });
});

// ── The enumerating gate ─────────────────────────────────────────────────────

/** File types that are documents or data, not something that runs. */
const NOT_CODE = new Set(['.md', '.json', '.jsonl', '.txt', '.pyc', '.patch', '.snap', '.svg', '.png']);

/** Every file under scripts/ that could start a program, as a path relative to scripts/. */
function codeFiles(dir = SCRIPTS): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__pycache__' ? [] : codeFiles(full);
    // A file named like a test is read like any other: a name is something anybody can
    // give a file, and none under scripts/ names the CLI. A link is not read (isFile is
    // false for one), which is why a test below fails if scripts/ ever holds a link.
    if (!e.isFile() || NOT_CODE.has(path.extname(e.name)) || e.name === 'LICENSE') return [];
    return [path.relative(SCRIPTS, full)];
  });
}

interface CodeLine {
  file: string;
  line: number;
  text: string;
}

/**
 * The lines of a file that are code: full-line comments dropped, and a shell command that
 * continues over several lines with a trailing backslash joined into one, so a launch
 * cannot hide its helper on a different line from its command.
 */
function codeLines(text: string, file: string): CodeLine[] {
  const shell = /\.(sh|bash)$/.test(file) || !path.extname(file);
  const script = /\.(ts|js|mjs|cjs)$/.test(file);
  // A whole-line comment. A line that opens a block comment and closes it with code after
  // it (`/* note */ run()`), or that closes one and goes on (`*/ run()`), is code.
  const comment = {
    test: (l: string) => (script ? /^\s*\/\//.test(l) || (/^\s*(\/\*|\*)/.test(l) && !/\*\/\s*\S/.test(l)) : /^\s*#/.test(l)),
  };
  const out: CodeLine[] = [];
  const raw = text.split('\n');
  for (let i = 0; i < raw.length; i++) {
    if (comment.test(raw[i])) continue;
    let joined = raw[i];
    const first = i + 1;
    while (shell && /\\$/.test(joined) && i + 1 < raw.length) joined = `${joined.slice(0, -1)} ${raw[++i].trim()}`;
    out.push({ file, line: first, text: joined });
  }
  return out;
}

/**
 * Where a line names the CLI: the word on its own, however it is reached (a bare command,
 * an absolute path to it, a quoted string in a spawn call), the name of its package, or
 * the name of the SDK that starts it without naming any command.
 * `.claude/`, `~/.claude`, `claude.ai` and an address at a mail host are not the CLI.
 */
function cliMentions(text: string): number[] {
  const at: number[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9_.@-])claude(?![A-Za-z0-9_./@-])|claude-code|claude[-_]agent[-_]sdk|claude_code_sdk/g)) at.push(m.index ?? 0);
  return at;
}

/** Is the mention at `index` a start of the CLI through the helper, and nothing else? */
function startsThroughHelper(text: string, index: number): boolean {
  return /bash "\$AGENT_LAUNCH_ENV" (?:--model-login (?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN) )*$/.test(text.slice(0, index));
}

/**
 * The hand-run verifier of the extension's own sealed start (#2580). The one file under
 * scripts/ that starts the CLI itself; see SEALED_START_UNDER_VERIFICATION.
 */
const VERIFIER = 'verify-sealed-claude-start.ts';

/**
 * Lines that name the CLI and do not start it. Each is matched by the file and the WHOLE
 * line, trimmed, and says why it is not a start. A line that names the CLI and is neither
 * a start through the helper nor on this list fails the gate, so this list is where a
 * human decides, in review, that a new mention is harmless.
 *
 * THE WHOLE LINE, AND NOT A PIECE OF IT (#2689). An entry used to be a piece of its line,
 * and a line that held the piece was explained, all of it. So a start of the CLI written
 * onto an explained line was explained with it and the gate stayed green. Matched whole,
 * nothing can be added to an explained line and leave it explained. The price is that an
 * edit to one of these lines, however small, is an edit here as well; that is the line
 * being read again by a person, which is what the list is for.
 *
 * For a shell command continued over several lines, the line is the joined one, as
 * `codeLines` makes it. A character outside plain ASCII is written as its escape.
 *
 * A line that DOES start the CLI never belongs here, whatever the reason for it. "Starts
 * nothing" would be false of it, and a false reason is worse than a failing gate.
 */
const NOT_A_START: { file: string; is: string; why: string }[] = [
  {
    file: 'retriage-unrecorded.sh',
    is: 'command -v claude >/dev/null 2>&1 || { echo "ERROR: the agent CLI is not on PATH \u2014 triage cannot run." >&2; exit 1; }',
    why: 'asks whether the CLI is installed; starts nothing',
  },
  {
    file: 'drain-inbox.sh',
    is: 'if [[ "$comm" == *claude* || "$args" == *claude-code* || "$args" == *anthropic.claude*  || "$args" == *"/claude/versions/"* || "$exe" == *"/claude/versions/"* ]]; then',
    why: 'matches the name of an already-running process to find its own session',
  },
  {
    file: 'tooling-radar/parse-scan.mjs',
    is: 'throw new Error(`claude output was not JSON (${error.message}); raw transcript kept`);',
    why: 'an error message',
  },
  {
    file: 'tooling-radar/parse-scan.mjs',
    is: "throw new Error(`claude reported an error: ${parsed.result || '(no detail)'}`);",
    why: 'an error message',
  },
  {
    file: 'tooling-radar/parse-scan.mjs',
    is: "if (!text) throw new Error('claude output had no string `result` field');",
    why: 'an error message',
  },
  {
    file: 'hooks/session-panel.py',
    is: 'That is what an editor panel launches. A print-mode run (`claude -p <prompt>`)',
    why: 'a docstring',
  },
  {
    file: 'hooks/session-panel.py',
    is: 'in its arguments, and a checkout under a folder called "claude-code" would then',
    why: 'a docstring',
  },
  {
    file: 'hooks/session-panel.py',
    is: 'if f.read().strip() == "claude":',
    why: 'reads the name of an already-running process',
  },
  {
    file: 'hooks/session-panel.py',
    is: 'if "/claude/versions/" in program or "@anthropic-ai/claude-code/" in program or os.path.basename(program) == "claude":',
    why: 'compares the path of an already-running process',
  },
  {
    file: 'hooks/session-panel.py',
    is: 'out.append("      Resume it in a terminal: claude --resume %s" % sid)',
    why: 'text shown to a person',
  },
  {
    file: VERIFIER,
    is: 'details.push(`claude exited non-zero: ${String((err as Error).message)}`);',
    why: 'a line of the report it prints',
  },
  {
    file: VERIFIER,
    is: "console.error('FAIL: `claude` is not on PATH (or did not answer --version). Nothing was run.');",
    why: 'an error message',
  },
  {
    file: VERIFIER,
    is: "console.log(allPass ? 'PASS \u2014 the sealed claude start holds against the installed Claude Code.' : 'FAIL \u2014 see above.');",
    why: 'the last line of the report it prints',
  },
];

interface SealedStart {
  file: string;
  /** The WHOLE line, trimmed, and never a piece of it: a start is accepted as it is written, or it is not. */
  is: string;
  kind: 'carries a prompt' | 'asks the version';
  why: string;
}

/**
 * Starts of the CLI that do NOT go through the helper, and are accepted as they stand.
 * A list of its own, apart from NOT_A_START, because nothing on it "starts nothing".
 *
 * WHAT THE FILE IS. scripts/verify-sealed-claude-start.ts (#2580) is run by hand to
 * re-check the one start of the CLI the extension makes itself (`proposeAI`, #2570, in
 * packages/minspec/src/lib/epic-backfill.ts). It starts the real CLI with the product's
 * own argument list and the product's own environment, and reads what the installed CLI
 * did with them. Started through scripts/lib/agent-context.sh it would no longer measure
 * the product: the allowlist hands on neither of the two variables `aiPassEnv` sets, and
 * one of them, CLAUDE_CODE_DISABLE_ATTACHMENTS, is a thing the script is run to measure.
 *
 * WHAT ITS START IS HANDED, in plain words. `aiPassEnv()` is everything in the
 * environment of whoever runs the script, with those two variables added. Nothing is
 * taken out. A GitHub token held in that shell reaches the CLI. That is the thing #1203
 * stopped for every other start under scripts/, and it is not stopped here.
 *
 * WHY THAT IS ACCEPTED HERE. An inherited environment is dangerous in the hands of an
 * agent that can act, on text someone else wrote, started by a machine with nobody
 * there. This start holds the environment and is none of the three, and each is
 * asserted below, not only said:
 *   - nothing to act with: the product's argument list asks for no tool (`--tools ""`)
 *     and no MCP server (`--strict-mcp-config`), and the start hands that list over whole
 *   - nobody else's text: the prompt is the one the script's own `buildDirectPrompt`
 *     makes, out of fixed sentences and the paths of files the script has just written
 *   - no machine starts it: no workflow, git hook, package script or other script in
 *     this repository names the file. A person runs it, in a shell whose environment
 *     their own CLI holds every time they start one there.
 *
 * WHAT THIS DOES NOT SHOW, so that it is not over-trusted. It reads text, and it calls
 * the product's two builders.
 *   - Whether the installed CLI obeys `--tools ""` is what the script is run to find
 *     out. On a release that ignores it the first of the three is gone, and the other
 *     two are what is left.
 *   - What `buildDirectPrompt` writes was read by a person. The assertion is only that
 *     the prompt comes from it.
 *   - The script wraps `execFile` (`installPatches`), so what reaches the CLI from the
 *     listed line is the product's list followed by `--model <name>` and, when the
 *     person running it passes one, `--settings <json>`. Neither is on the line.
 *   - Three more of its rows start the CLI through `proposeAI` itself, one of them with
 *     `--no-session-persistence` taken out so that the transcript can be read. Those
 *     starts are in packages/minspec/src, where ai-pass-single-start.test.ts and
 *     ai-pass-no-tools.test.ts hold them; no line under scripts/ names the CLI for them.
 *   - A machine that ran the file without naming it (a pattern such as
 *     `scripts/verify-*.ts`) would not be found.
 *
 * Adding a third entry is a decision of the same weight, and the test that counts them
 * is where it is made.
 */
const SEALED_START_UNDER_VERIFICATION: SealedStart[] = [
  {
    file: VERIFIER,
    is: "const { stdout } = await execFileAsync('claude', lib.aiPassArgs(prompt), {",
    kind: 'carries a prompt',
    why: "the verifier's direct row: the product's own argument list and environment, handed to the real CLI whole",
  },
  {
    file: VERIFIER,
    is: "execFileSync('claude', ['--version'], { timeout: 5000 });",
    kind: 'asks the version',
    why:
      'asks whether a CLI is installed, before anything is run. It carries no prompt and no print mode, so there is ' +
      'no text for anything to act on. It inherits the whole environment, as the other does',
  },
];

/**
 * How many times each file starts the CLI through the helper. Pinned, so that a launcher
 * gaining a start (or a new launcher appearing) is a deliberate edit here, next to the
 * reminder that the new start needs a behavioural test above: this gate reads text, and
 * only a test that runs the launcher sees what its agent is handed.
 */
const STARTS: Record<string, number> = {
  'dispatch-issue.sh': 2,
  'triage-inbox.sh': 1,
  'review-branch.sh': 3,
  'review-pr.sh': 2,
  'review-approvable.sh': 3,
  'remediate-pr.sh': 1,
  'tooling-radar/run-radar.sh': 1,
};

/** Which starts may ask for a model login by name, in file order. Everything else asks for none. */
const MODEL_LOGINS: Record<string, string[]> = {
  'review-branch.sh': ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  'review-approvable.sh': ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
};

interface Finding {
  where: string;
  text: string;
}

/** Read one file's code and sort every mention of the CLI. Pure, so it can be tested on text. */
function classify(
  file: string,
  text: string,
): { starts: CodeLine[]; unexplained: Finding[]; explained: Set<number>; sealed: { entry: number; line: CodeLine }[] } {
  const starts: CodeLine[] = [];
  const unexplained: Finding[] = [];
  const explained = new Set<number>();
  const sealed: { entry: number; line: CodeLine }[] = [];
  for (const l of codeLines(text, file)) {
    const mentions = cliMentions(l.text);
    if (mentions.length === 0) continue;
    if (mentions.every((i) => startsThroughHelper(l.text, i))) {
      starts.push(l);
      continue;
    }
    // Both lists match the WHOLE line, in its own file. Nothing can be added to a line
    // and leave it listed, and the same line in any other file is not listed (#2689).
    const whole = l.text.trim();
    const seal = SEALED_START_UNDER_VERIFICATION.findIndex((e) => e.file === file && whole === e.is);
    if (seal >= 0) {
      sealed.push({ entry: seal, line: l });
      continue;
    }
    const entry = NOT_A_START.findIndex((e) => e.file === file && whole === e.is);
    if (entry >= 0) explained.add(entry);
    else unexplained.push({ where: `scripts/${file}:${l.line}`, text: l.text.trim().slice(0, 160) });
  }
  return { starts, unexplained, explained, sealed };
}

/** Every file under `dir`, at any depth, as full paths. An absent directory holds none. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(full) : e.isFile() ? [full] : [];
  });
}

describe('T0: no start of the CLI anywhere under scripts/ goes round the allowlist unaccounted for', () => {
  const files = codeFiles();
  const read = (file: string) => fs.readFileSync(path.join(SCRIPTS, file), 'utf-8');
  const all = files.map((file) => ({ file, ...classify(file, read(file)) }));

  it('reads the whole of scripts/, nested directories included (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files).toEqual(expect.arrayContaining(['dispatch-issue.sh', 'tooling-radar/run-radar.sh', 'hooks/session-panel.py', 'lib/gh-bot.sh']));
  });

  it('a file named like a test is read like any other', () => {
    expect(files).toEqual(expect.arrayContaining(['lib/gh-bot.test.js', 'check-gh-bot-attribution.test.js', 'hooks/test_spec_gate.py']));
  });

  it('nothing under scripts/ is a link: the scan opens files, and a link is one it would never open', () => {
    const links = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) return [path.relative(SCRIPTS, full)];
        return e.isDirectory() && e.name !== 'node_modules' && e.name !== '__pycache__' ? links(full) : [];
      });
    expect(links(SCRIPTS)).toEqual([]);
  });

  it('the predicate itself: what counts as a start through the helper, and what does not', () => {
    const verdict = (line: string) => {
      const c = classify('some-new-launcher.sh', `${line}\n`);
      return c.unexplained.length > 0 ? 'unexplained' : c.starts.length > 0 ? 'start' : 'no mention';
    };
    // Through the helper.
    expect(verdict('AGENT_OUT=$(bash "$AGENT_LAUNCH_ENV" claude -p "$PROMPT" --tools "")')).toBe('start');
    expect(verdict('bash "$AGENT_LAUNCH_ENV" --model-login ANTHROPIC_API_KEY claude -p --model opus')).toBe('start');
    expect(verdict('(cd "$W" && timeout 5 bash "$AGENT_LAUNCH_ENV" claude -p "$P" \\\n  --model x)')).toBe('start');
    // Round it, every way it has been or could be written.
    expect(verdict('claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('AGENT_OUT=$(claude -p "$PROMPT")')).toBe('unexplained');
    expect(verdict('"${AGENT_ENV_SCRUB[@]}" claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('env -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('ANTHROPIC_API_KEY= claude -p --help')).toBe('unexplained');
    expect(verdict('/usr/local/bin/claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('"$HOME/.local/bin/claude" --print "$PROMPT"')).toBe('unexplained');
    expect(verdict('npx @anthropic-ai/claude-code -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('CLI=claude')).toBe('unexplained');
    expect(verdict('timeout 5 \\\n  claude -p "$PROMPT"')).toBe('unexplained');
    // The helper named, but not what the command runs through.
    expect(verdict('bash "$AGENT_LAUNCH_ENV" --report; claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('bash "$AGENT_LAUNCH_ENV" --model-login GH_TOKEN claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('bash "$OTHER_HELPER" claude -p "$PROMPT"')).toBe('unexplained');
    expect(verdict('bash scripts/lib/agent-context.sh claude -p "$PROMPT"')).toBe('unexplained');
    // In another language.
    expect(classify('x.mjs', "spawn('claude', ['-p', prompt]);\n").unexplained).toHaveLength(1);
    expect(classify('x.py', 'subprocess.run(["claude", "-p", prompt])\n').unexplained).toHaveLength(1);
    // Through the SDK, which starts the CLI without a command being written anywhere.
    expect(classify('x.mjs', "import { query } from '@anthropic-ai/claude-agent-sdk';\n").unexplained).toHaveLength(1);
    expect(classify('x.py', 'from claude_agent_sdk import query\n').unexplained).toHaveLength(1);
    expect(classify('x.py', 'import claude_code_sdk\n').unexplained).toHaveLength(1);
    // A comment marker in front of code does not make the line a comment.
    expect(classify('x.ts', "/* ok */ spawn('claude', ['-p', prompt]);\n").unexplained).toHaveLength(1);
    expect(classify('x.ts', " */ spawn('claude', ['-p', prompt]);\n").unexplained).toHaveLength(1);
    expect(classify('x.ts', "/* spawn('claude', ['-p', prompt]) */\n").unexplained).toHaveLength(0);
    expect(classify('x.ts', ' * runs claude -p for the reviewer\n').unexplained).toHaveLength(0);
    expect(classify('x.ts', "// spawn('claude', ['-p', prompt]);\n").unexplained).toHaveLength(0);
    // Not the CLI at all.
    expect(verdict('cat "$HOME/.claude/settings.json" .claude/hooks/x.sh')).toBe('no mention');
    expect(verdict('git -c user.email="claude@example.invalid" commit')).toBe('no mention');
    expect(verdict('# a comment about claude -p')).toBe('no mention');
  });

  it('every mention of the CLI is a start through the helper, or is explained', () => {
    const unexplained = all.flatMap((f) => f.unexplained);
    expect(
      unexplained,
      unexplained.length > 0
        ? 'These lines name the CLI and do not start it through scripts/lib/agent-context.sh. An agent started ' +
          'any other way inherits its launcher\'s whole environment, the GitHub token included (#1203). Start it as ' +
          '`bash "$AGENT_LAUNCH_ENV" claude ...`; or, if the line starts nothing, add its whole line to NOT_A_START in this ' +
          'file with the reason. A line that does start it is never a NOT_A_START entry: read SEALED_START_UNDER_VERIFICATION ' +
          `for the one case accepted, and what had to be shown for it.\n${unexplained.map((u) => `  ${u.where}: ${u.text}`).join('\n')}`
        : 'every mention accounted for',
    ).toEqual([]);
  });

  it('every explained non-start still exists (the list does not outlive what it explains)', () => {
    const live = new Set(all.flatMap((f) => [...f.explained]));
    const stale = NOT_A_START.filter((_, i) => !live.has(i)).map((e) => `${e.file}: ${e.is}`);
    expect(stale).toEqual([]);
  });

  it('an explained line is explained only as the whole of it: a start written onto one is seen (#2689)', () => {
    const verdict = (file: string, line: string) => {
      const c = classify(file, `${line}\n`);
      return c.unexplained.length > 0 ? 'unexplained' : c.explained.size > 0 ? 'explained' : c.starts.length > 0 ? 'start' : 'no mention';
    };
    for (const e of NOT_A_START) {
      expect(verdict(e.file, e.is), e.is).toBe('explained');
      expect(verdict(e.file, `  ${e.is}  `), 'indented, as it stands in the file').toBe('explained');
      // The same words in any other file explain nothing there.
      expect(verdict('some-new-launcher.sh', e.is), e.is).toBe('unexplained');
      // A start after it, or in front of it, on the same line.
      expect(verdict(e.file, `${e.is} && claude -p "$x"`), e.is).toBe('unexplained');
      expect(verdict(e.file, `claude -p "$x"; ${e.is}`), e.is).toBe('unexplained');
      // And a piece of it is not it: the entry is the line, not something the line holds.
      expect(verdict(e.file, e.is.slice(0, -1)), e.is).toBe('unexplained');
    }
    // The two lines this was found with, as they were written. Each holds, whole, the
    // piece that used to explain it, and each stayed green.
    expect(verdict(VERIFIER, "details.push(`claude exited non-zero: ${execFileSync('claude', ['-p', 'x'])}`);")).toBe('unexplained');
    expect(verdict('drain-inbox.sh', 'if [[ "$comm" == *claude* ]] && claude -p "$x"; then')).toBe('unexplained');
  });

  // ── The two starts that do not go through the helper ───────────────────────
  //
  // SEALED_START_UNDER_VERIFICATION has the reasoning. These hold the tree to it.

  it('a start that goes round the helper is accepted only as its whole line, and only in its own file', () => {
    const verdict = (file: string, line: string) => {
      const c = classify(file, `${line}\n`);
      return c.unexplained.length > 0 ? 'unexplained' : c.sealed.length > 0 ? 'listed' : c.starts.length > 0 ? 'start' : 'no mention';
    };
    for (const e of SEALED_START_UNDER_VERIFICATION) {
      expect(verdict(e.file, e.is), e.is).toBe('listed');
      expect(verdict(e.file, `    ${e.is}`), 'indented, as it stands in the file').toBe('listed');
      // The same line in any other file is a start that goes round the allowlist.
      expect(verdict('some-new-check.ts', e.is), e.is).toBe('unexplained');
      expect(verdict(`lib/${e.file}`, e.is), e.is).toBe('unexplained');
      // And nothing rides on the end of it, or in front of it.
      expect(verdict(e.file, `${e.is} execFileSync('claude', ['-p', 'x']);`), e.is).toBe('unexplained');
      expect(verdict(e.file, `execFileSync('claude', ['-p', 'x']); ${e.is}`), e.is).toBe('unexplained');
    }
    // In the verifier itself, every other way of starting the CLI.
    for (const other of [
      "execFile('claude', ['-p', 'x']);",
      "execFileSync('claude', ['-p', prompt], { env: process.env });",
      "spawn('claude', lib.aiPassArgs(prompt), { env: lib.aiPassEnv() });",
      "const { stdout } = await execFileAsync('claude', ['-p', prompt], {",
      "const { stdout } = await execFileAsync('claude', [...lib.aiPassArgs(prompt), '--mcp-config', file], {",
      "const { stdout } = await execFileAsync('claude', lib.aiPassArgs(prompt), { env: process.env });",
      "const { stdout } = await execFileAsync('claude', lib.aiPassArgs(theirText), {",
      "execFileSync('claude', ['--version', '-p', 'x'], { timeout: 5000 });",
      "execFileSync('claude', ['-p', '--help'], { timeout: 5000 });",
    ]) {
      expect(verdict(VERIFIER, other), other).toBe('unexplained');
    }
  });

  it('the two on the list are in the tree once each, in the one file, and there is no third', () => {
    const found = all.flatMap((f) => f.sealed.map((s) => `${f.file}: ${SEALED_START_UNDER_VERIFICATION[s.entry].kind}`));
    // A second copy of either line is a second start; a line that has gone leaves the
    // list explaining nothing. Both show here.
    expect(found.sort()).toEqual([`${VERIFIER}: asks the version`, `${VERIFIER}: carries a prompt`]);
    // What the list itself says: two entries, one of each kind, one file. A third
    // entry is a new start that inherits, and is decided here, in review.
    expect(SEALED_START_UNDER_VERIFICATION.map((e) => `${e.file}: ${e.kind}`).sort()).toEqual(found);
  });

  it("the one that carries a prompt is handed the product's own argument list and environment, and the script's own prompt", () => {
    const entry = SEALED_START_UNDER_VERIFICATION.find((e) => e.kind === 'carries a prompt');
    expect(entry).toBeDefined();
    const lines = codeLines(read(VERIFIER), VERIFIER);
    const at = lines.findIndex((l) => l.text.trim() === entry!.is);
    const end = lines.findIndex((l, i) => i > at && l.text.trim() === '});');
    expect(at, 'the listed line is in the file').toBeGreaterThanOrEqual(0);
    expect(end, 'and the call it opens is closed').toBeGreaterThan(at);
    // The argument list is the product's, whole: the line is matched whole, so this is
    // what the file says. Nothing is spread into it and nothing follows it.
    expect(entry!.is).toContain("('claude', lib.aiPassArgs(prompt), {");
    // The options, one to a line, each `name: value,`. Nothing is spread in, so nothing
    // can bring a second environment with it, and there is no shell.
    const options = lines.slice(at + 1, end).map((l) => l.text.trim());
    const given = options.map((o) => /^([A-Za-z]+): (.+),$/.exec(o));
    expect(given.every((m) => m !== null), options.join(' | ')).toBe(true);
    expect(given.map((m) => m![1]).sort(), options.join(' | ')).toEqual(['cwd', 'env', 'maxBuffer', 'timeout']);
    // The environment is the product's builder, called with nothing: so with the
    // environment of whoever runs the script, and not one the script chose instead.
    expect(options).toContain('env: lib.aiPassEnv(),');
    // `lib` is the product's module and is bound once, so these are the product's builders.
    const bound = (name: string) =>
      lines.filter((l) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b|\\b${name}\\s*=(?!=)`).test(l.text)).map((l) => l.text.trim());
    expect(bound('lib')).toEqual(["const lib = (await import('../packages/minspec/src/lib/epic-backfill')) as EpicBackfillModule;"]);
    // And `prompt` is the script's own, bound once: no text from anywhere else.
    expect(bound('prompt')).toEqual(['const prompt = buildDirectPrompt(canaryDir, canaries);']);
  });

  it("the product's argument list asks for no tool and no MCP server, and its environment is all of the one it is given", () => {
    const args = aiPassArgs('a prompt');
    // `--tools` takes a list: the empty string straight after it is "none".
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args.filter((a) => a === '--tools')).toHaveLength(1);
    // With no `--mcp-config`, this loads no server.
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');

    // What the list above says the start is handed, kept true to the code: everything,
    // a GitHub token included, and two variables more. If this stops being so, that
    // text is wrong and is the thing to change.
    const held = { ...withFixtureValues(['GH_TOKEN', 'GITHUB_TOKEN', 'TAVILY_API_KEY']), TZ: 'Antarctica/Troll' };
    const handed = aiPassEnv(held);
    expect(handed, 'aiPassEnv no longer hands on all it is given: reread SEALED_START_UNDER_VERIFICATION').toMatchObject(held);
    expect(Object.keys(handed).filter((n) => !(n in held)).sort()).toEqual([
      'CLAUDE_CODE_DISABLE_ATTACHMENTS',
      'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    ]);
    // Called with nothing, as the verifier calls it, that environment is the caller's own.
    const marker = 'MINSPEC_FIXTURE_HELD_BY_WHOEVER_RUNS_IT';
    process.env[marker] = FIXTURE_VALUE;
    try {
      expect(aiPassEnv()[marker]).toBe(FIXTURE_VALUE);
    } finally {
      delete process.env[marker];
    }
  });

  it('the other asks for the version and nothing else: no prompt, no print mode', () => {
    const entry = SEALED_START_UNDER_VERIFICATION.find((e) => e.kind === 'asks the version');
    expect(entry).toBeDefined();
    expect(entry!.is).toMatch(/^execFileSync\('claude', \['--version'\], \{ timeout: \d+ \}\);$/);
  });

  it('nothing in the repository runs the verifier: no workflow, git hook, package script, Claude Code hook or other script names it', () => {
    // What a machine would act on is code. A comment that names the file tells it nothing
    // (scripts/lib/agent-context.sh says, in a comment, why this file is the exception),
    // so whole-line comments are dropped here, as they are for every other reading above.
    const names = (file: string, text: string) =>
      codeLines(text, file)
        .map((l) => l.text)
        .join('\n')
        .includes(path.basename(VERIFIER, '.ts'));
    // The predicate sees a name however the file is reached, in whatever kind of file.
    expect(names('.github/workflows/x.yml', '      - run: npx tsx scripts/verify-sealed-claude-start.ts --model haiku\n')).toBe(true);
    expect(names('package.json', '    "verify:sealed": "tsx ./scripts/verify-sealed-claude-start"\n')).toBe(true);
    expect(names('scripts/x.sh', 'timeout 600 \\\n  npx tsx "${SCRIPT_DIR}/verify-sealed-claude-start.ts"\n')).toBe(true);
    expect(names('scripts/x.sh', 'echo ok # then scripts/verify-sealed-claude-start.ts\n')).toBe(true);
    expect(names('.claude/settings.json', '            "command": "npx tsx \\"$CLAUDE_PROJECT_DIR\\"/scripts/verify-sealed-claude-start.ts"\n')).toBe(true);
    // And not a comment, nor a file with a name like it.
    expect(names('scripts/lib/x.sh', '# see scripts/verify-sealed-claude-start.ts\n')).toBe(false);
    expect(names('.github/workflows/x.yml', '      # scripts/verify-sealed-claude-start.ts is run by hand\n')).toBe(false);
    expect(names('package.json', '    "validate": "npm run validate && scripts/verify-epic-backfill.sh"\n')).toBe(false);

    // Where a machine is told what to run. A document that tells a PERSON to run it is
    // not one of them, so documents are left out here as they are under scripts/.
    const places = [
      ...files.filter((f) => f !== VERIFIER).map((f) => path.join(SCRIPTS, f)),
      ...filesUnder(path.join(ROOT, '.github')).filter((p) => !NOT_CODE.has(path.extname(p))),
      ...filesUnder(path.join(ROOT, '.githooks')),
      // What Claude Code is told to run in every session in this repository. A dispatched
      // agent loads the project's settings too, so a hook here runs inside one.
      path.join(ROOT, '.claude', 'settings.json'),
      ...filesUnder(path.join(ROOT, '.claude', 'hooks')).filter((p) => !NOT_CODE.has(path.extname(p))),
      ...filesUnder(path.join(ROOT, '.minspec', 'hooks')),
      path.join(ROOT, 'package.json'),
      ...fs.readdirSync(path.join(ROOT, 'packages')).map((p) => path.join(ROOT, 'packages', p, 'package.json')).filter((p) => fs.existsSync(p)),
    ];
    const relative = places.map((p) => path.relative(ROOT, p));
    // Not vacuous: the places a machine is told what to run are all among them.
    expect(relative).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml',
        '.githooks/pre-commit',
        '.claude/settings.json',
        '.claude/hooks/session-title.sh',
        'package.json',
        'packages/minspec/package.json',
        'scripts/drain-inbox.sh',
      ]),
    );
    expect(relative).not.toContain(`scripts/${VERIFIER}`);
    expect(places.filter((p) => names(path.relative(ROOT, p), fs.readFileSync(p, 'utf-8'))).map((p) => path.relative(ROOT, p))).toEqual([]);
    // The one comment that does name it is where it is said to be, so the rule above is
    // not passing only because nothing names the file at all.
    expect(fs.readFileSync(path.join(SCRIPTS, 'lib', 'agent-context.sh'), 'utf-8')).toContain(`scripts/${VERIFIER}`);
  });

  it('the starts are the ones this file tests, file by file', () => {
    const found = Object.fromEntries(all.filter((f) => f.starts.length > 0).map((f) => [f.file, f.starts.length]));
    // A difference here means a start was added or removed. A new one needs a test above
    // that runs its launcher and reads what the agent was handed, and then a number here.
    expect(found).toEqual(STARTS);
  });

  it('only the reviewers that run in CI ask for a model login, and only by a known name', () => {
    const found: Record<string, string[]> = {};
    for (const f of all) {
      const asked = f.starts.flatMap((l) => [...l.text.matchAll(/--model-login (\S+)/g)].map((m) => m[1]));
      if (asked.length > 0) found[f.file] = asked;
    }
    expect(found).toEqual(MODEL_LOGINS);
  });

  it('each launcher sources the library that is the program, unguarded, from its own directory, before its first start', () => {
    const scriptDir = 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"';
    for (const f of all.filter((x) => x.starts.length > 0)) {
      const lines = codeLines(read(f.file), f.file);
      const nested = f.file.includes('/');
      // At the start of a line: not inside an `if [[ -f ... ]]`, not behind `||`. A
      // launcher that could carry on without this file could carry on to a bare launch.
      const source = `source "\${SCRIPT_DIR}/${nested ? '../' : ''}lib/agent-context.sh"`;
      const sourced = lines.filter((l) => l.text === source);
      expect(sourced, `${f.file}: exactly one \`${source}\`, at the start of a line`).toHaveLength(1);
      const dir = lines.filter((l) => l.text === scriptDir);
      expect(dir, `${f.file}: SCRIPT_DIR taken from where the file is`).toHaveLength(1);
      expect(dir[0].line, `${f.file}: SCRIPT_DIR is set before the library is sourced`).toBeLessThan(sourced[0].line);
      const firstStart = Math.min(...f.starts.map((l) => l.line));
      expect(sourced[0].line, `${f.file}: the library is sourced before the first start`).toBeLessThan(firstStart);
    }
  });

  it('the helper path is assigned once, in the library, to the library\'s own absolute path', () => {
    const assignment = 'AGENT_LAUNCH_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-context.sh"';
    const assigned = files.flatMap((file) =>
      codeLines(read(file), file)
        .filter((l) => /^\s*(export\s+|declare\s+(-\w+\s+)*|local\s+|readonly\s+)?AGENT_LAUNCH_ENV\+?=/.test(l.text))
        .map((l) => `${file}: ${l.text}`),
    );
    expect(assigned).toEqual([`lib/agent-context.sh: ${assignment}`]);
  });

  it('nothing under scripts/ gives the helper path any other value, or a default taken from the environment', () => {
    // Every line of code that names the variable is one of two things: the one assignment
    // above, or a launch through it. Anything else (a default such as
    // ${AGENT_LAUNCH_ENV:-...}, an export, a read, a second assignment) is how the path
    // could be made to point elsewhere.
    const allowed = /^AGENT_LAUNCH_ENV="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)\/agent-context\.sh"$/;
    const odd: string[] = [];
    for (const file of files) {
      for (const l of codeLines(read(file), file)) {
        if (!l.text.includes('AGENT_LAUNCH_ENV')) continue;
        if (allowed.test(l.text)) continue;
        const without = l.text.replaceAll('bash "$AGENT_LAUNCH_ENV" ', '');
        if (!without.includes('AGENT_LAUNCH_ENV')) continue;
        odd.push(`scripts/${file}:${l.line}: ${l.text.trim().slice(0, 140)}`);
      }
    }
    expect(odd).toEqual([]);
  });

  it('the array the helper replaced is gone, so no launcher can go back to it', () => {
    const users = files.filter((file) => codeLines(read(file), file).some((l) => /AGENT_ENV_SCRUB\b/.test(l.text.replace(/MINSPEC_AGENT_ENV_SCRUB/g, ''))));
    expect(users).toEqual([]);
  });
});

// ── The enumerating gate, second half: what a launcher runs in an agent's worktree ──
//
// The gate above is about what an AGENT is started with. This one is about the launcher
// itself, afterwards: a launcher that makes a worktree for an agent goes back into it to
// push, rebase, run the checks and ask for a review, and whatever it executes there runs
// with the launcher's own environment (lib/agent-worktree.sh has the reasoning, and
// agent-worktree-trust.test.ts plants a canary at each place and reads what it saw).
//
// The canary tests prove the sites that exist. This holds the NEXT one to the same rule:
// in a launcher that makes a worktree and starts an agent, every line of code that names
// the worktree must be one of a closed list of shapes, each of which either runs nothing
// there or runs it through the pinned git or the environment allowlist. A new line in a
// new shape fails here until it is one of them.
//
// WHAT IT CANNOT SEE, so that it is not over-trusted. It reads text. It finds a worktree
// by the variable that holds its path and by the names given to files inside it, so it
// does not follow the path into a function defined in another file, through a variable
// assigned from a command, or into a program that is told the path and changes to it by
// itself. Those are what the canary runs are for.

/** The variable a launcher keeps its agent worktree's path in, not a longer name. */
const WORKTREE_VAR = /\$\{?WORKTREE\}?(?![A-Za-z0-9_])/;
const BARE_GIT = /(?<![A-Za-z0-9_-])git(?=\s)/;
const LAUNCHER_FNS = '(?:launcher_git|agent_worktree_pin|agent_worktree_git|agent_worktree_function|agent_worktree_trusted)';
const ALLOWLISTED = 'bash "\\$AGENT_LAUNCH_ENV" ';

/** Could this text start another command? A separator, a pipe, a substitution. */
const RUNS_MORE = /[;&|`]|\$\(/;
/** The text with everything inside single quotes taken out: words, not commands. */
const unquoted = (t: string) => t.replace(/'[^']*'/g, "''");

/**
 * The shapes a line that names the worktree may have. Each claims the WHOLE line: what
 * comes after the part it recognises must be one of the endings written into it, so a
 * second command cannot ride on the end of an accepted one.
 */
const WORKTREE_SHAPES: { name: string; is: (t: string) => boolean }[] = [
  { name: 'asks whether it exists', is: (t) => /^if \[\[ -d "\$WORKTREE" \]\]; then$/.test(t) },
  // Words only: the path is printed, in a message or in a prompt.
  { name: 'says where it is', is: (t) => /^echo "[^"`]*"(?: >&2)?$/.test(t) && !/\$\(/.test(t) },
  { name: 'tells the agent where it is', is: (t) => t === 'Worktree: ${WORKTREE}' },
  {
    name: 'says where it is, in a comment it posts',
    is: (t) => {
      const head = /^(?:gh issue comment "\$ISSUE" --repo "\$REPO" +--body|post_marked_comment "\$ATTEMPT_MARKER") "\$\(printf ''/;
      const rest = unquoted(t).replace(head, '');
      // After the one `printf`, only its arguments: variables, and nothing that runs.
      return head.test(unquoted(t)) && /^(?: +"\$\{?[A-Za-z_]+\}?")*\)"(?: 2>\/dev\/null \|\| true)?$/.test(rest);
    },
  },
  { name: 'names a file in it', is: (t) => /^[A-Z_]+="\$\{WORKTREE\}\/\.[a-z-]+\.(log|md|json)"$/.test(t) },
  {
    name: "reads the agent's summary",
    is: (t) => t === '[[ -f "${WORKTREE}/.agent-summary.md" ]] && SUMMARY=$(cat "${WORKTREE}/.agent-summary.md")',
  },
  {
    name: 'git, or a program of its own, with the git directory and the hooks pinned',
    is: (t) => {
      const body = t
        .replace(/^(?:if ! [A-Z_]+=\$\(|cleanup\(\) \{ )/, '')
        .replace(/(?:\); then| 2>\/dev\/null \|\| (?:true|\{|true; \})| \|\| \{)$/, '');
      return new RegExp(`^${LAUNCHER_FNS} `).test(body) && !RUNS_MORE.test(body) && !BARE_GIT.test(body);
    },
  },
  {
    name: "starts the agent, or the worktree's own check, through the allowlist",
    is: (t) => {
      const head = new RegExp(
        `^(?:if )?\\( ?cd "\\$WORKTREE" && (?:"\\$\\{BUILD_TIMEOUT_ARGS\\[@\\]\\}" |timeout --kill-after=30s "\\$\\{budget\\}s" )?${ALLOWLISTED}`,
      );
      // What is started, and its arguments, up to where its output goes.
      const rest = t.replace(head, '').replace(/(?: 2>&1 \| tee(?: -a)? "\$LOG"\)(?:; then| \|\| true)| >\/dev\/null 2>&1 \); then)$/, '');
      return head.test(t) && rest !== t.replace(head, '') && !RUNS_MORE.test(rest);
    },
  },
  {
    name: 'tells its own gate, run by its own tsx from its own tree through the allowlist, where it is',
    is: (t) => {
      const head = new RegExp(
        `^DECISION=\\$\\(cd "\\$REPO_ROOT" && ${ALLOWLISTED} *"\\$\\{REPO_ROOT\\}/node_modules/\\.bin/tsx" "\\$\\{SCRIPT_DIR\\}/auto-merge-gate\\.ts" +--worktree "\\$WORKTREE" `,
      );
      // Its arguments, then the fail-safe answer for a gate that could not be run.
      const rest = unquoted(t).replace(head, '').replace(/ 2>>"\$LOG" +\|\| echo ''\)$/, '');
      return head.test(t) && rest !== unquoted(t).replace(head, '') && !RUNS_MORE.test(rest);
    },
  },
];

const shapeOf = (text: string) => WORKTREE_SHAPES.find((s) => s.is(text.trim()))?.name;

/** Shell files whose code makes a worktree AND starts the CLI: the launchers this is about. */
function worktreeLaunchers(): string[] {
  return codeFiles()
    .filter((f) => /\.sh$/.test(f))
    .filter((f) => {
      const text = fs.readFileSync(path.join(SCRIPTS, f), 'utf-8');
      const lines = codeLines(text, f);
      return lines.some((l) => /\bworktree add\b/.test(l.text)) && classify(f, text).starts.length > 0;
    })
    .sort();
}

describe('T0: a launcher runs nothing as itself out of a worktree it gave an agent', () => {
  const launchers = worktreeLaunchers();
  const linesOf = (f: string) => codeLines(fs.readFileSync(path.join(SCRIPTS, f), 'utf-8'), f);

  it('the launchers that make a worktree and start an agent are the ones the canary tests run', () => {
    // A third one is found here by itself, and is held to every rule below. This list is
    // the reminder that it also needs a canary run of its own (agent-worktree-trust.test.ts).
    expect(launchers).toEqual(['dispatch-issue.sh', 'remediate-pr.sh']);
  });

  it('the shapes themselves: what a line that names the worktree may look like, and what it may not', () => {
    for (const ok of [
      'launcher_git -C "$REPO_ROOT" worktree remove "$WORKTREE" --force 2>/dev/null || true',
      'launcher_git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE" origin/main',
      'agent_worktree_pin "$WORKTREE"',
      'if ! MATCHES=$(agent_worktree_function agent_egress_scan "$WORKTREE" "$PRE_SHA" "${WORKTREE}/.agent-summary.md"); then',
      '(cd "$WORKTREE" && bash "$AGENT_LAUNCH_ENV" claude -p "$fix_prompt" --model "$RUN_MODEL" 2>&1 | tee -a "$LOG") || true',
      'if ( cd "$WORKTREE" && timeout --kill-after=30s "${budget}s" bash "$AGENT_LAUNCH_ENV" "$@" >/dev/null 2>&1 ); then',
      'echo "Worktree left at: $WORKTREE"',
      'LOG="${WORKTREE}/.agent.log"',
    ]) {
      expect(shapeOf(ok), ok).toBeDefined();
    }
    for (const bad of [
      // git that reads the worktree's own .git file and runs the worktree's own hooks.
      'git -C "$WORKTREE" push -u origin "$BRANCH"',
      'if git -C "$WORKTREE" diff --name-only "${base}...HEAD" | grep -q x; then',
      'SHA=$(git -C "$WORKTREE" rev-parse --short HEAD)',
      'launcher_git worktree add "$WORKTREE" x && git -C "$WORKTREE" status',
      'git worktree add --detach "$WORKTREE" "origin/${BRANCH}"',
      // The worktree's own code, with the launcher's environment.
      '( cd "$WORKTREE" && timeout --kill-after=30s "${budget}s" "$@" >/dev/null 2>&1 )',
      '(cd "$WORKTREE" && npm test)',
      'DECISION=$(cd "$WORKTREE" && npx tsx "${SCRIPT_DIR}/auto-merge-gate.ts" --worktree "$WORKTREE" --base "$AUTOMERGE_BASE"',
      'rev_out=$( cd "$WORKTREE" && "$reviewer" "$base" HEAD --role reviewer 2>>"$LOG" ) || true',
      'bash "${WORKTREE}/scripts/check.sh"',
      'npm --prefix "$WORKTREE" test',
      '"${WORKTREE}/node_modules/.bin/tsx" x.ts',
      'agent_egress_scan "$WORKTREE" "origin/main" "${WORKTREE}/.agent-summary.md"',
      'agent_worktree_git status && cd "$WORKTREE" && ./run',
      'echo "$(cd "$WORKTREE" && ./run)"',
      'TOOL="${WORKTREE}/bin/tool"',
      // An accepted shape with a second command riding on the end of it.
      'agent_worktree_pin "$WORKTREE"; bash "${WORKTREE}/x.sh"',
      'launcher_git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE" origin/main && "${WORKTREE}/run"',
      '(cd "$WORKTREE" && bash "$AGENT_LAUNCH_ENV" claude -p "$p" 2>&1 | tee -a "$LOG") || true; (cd "$WORKTREE" && ./run)',
      '(cd "$WORKTREE" && bash "$AGENT_LAUNCH_ENV" claude -p "$p"; ./run) || true',
      'echo "left at $WORKTREE"; (cd "$WORKTREE" && ./run)',
      'echo "left at $WORKTREE" | bash',
    ]) {
      expect(shapeOf(bad), bad).toBeUndefined();
    }
  });

  it('every line that names the worktree is one of those shapes', () => {
    const unexplained = launchers.flatMap((f) =>
      linesOf(f)
        .filter((l) => WORKTREE_VAR.test(l.text) && !/^\s*WORKTREE=/.test(l.text))
        .filter((l) => shapeOf(l.text) === undefined)
        .map((l) => `${f}:${l.line}: ${l.text.trim().slice(0, 140)}`),
    );
    expect(unexplained).toEqual([]);
  });

  it('the scan is not vacuous: each launcher has lines of the shapes that matter', () => {
    for (const f of launchers) {
      const shapes = new Set(linesOf(f).filter((l) => WORKTREE_VAR.test(l.text)).map((l) => shapeOf(l.text)));
      expect([...shapes], f).toContain('git, or a program of its own, with the git directory and the hooks pinned');
      expect([...shapes], f).toContain("starts the agent, or the worktree's own check, through the allowlist");
    }
  });

  it('each makes its worktree with its own hooks, pins it before any agent is started, and never asks git for it any other way', () => {
    for (const f of launchers) {
      const lines = linesOf(f);
      const adds = lines.filter((l) => /\bworktree add\b/.test(l.text));
      expect(adds.length, f).toBeGreaterThan(0);
      for (const l of adds) expect(l.text.trim(), `${f}:${l.line}`).toMatch(/^launcher_git /);
      const pin = lines.find((l) => /^\s*agent_worktree_pin "\$WORKTREE"/.test(l.text));
      expect(pin, `${f} never pins its worktree`).toBeDefined();
      const firstAdd = adds[0].line;
      const firstStart = Math.min(...classify(f, fs.readFileSync(path.join(SCRIPTS, f), 'utf-8')).starts.filter((s) => s.line > firstAdd).map((s) => s.line));
      expect(pin!.line, f).toBeGreaterThan(firstAdd);
      expect(pin!.line, f).toBeLessThan(firstStart);
      // Sourced unguarded, from its own directory: a missing library stops the run.
      expect(lines.some((l) => l.text === 'source "${SCRIPT_DIR}/lib/agent-worktree.sh"'), f).toBe(true);
    }
  });

  it('none of them looks a tool up from wherever it happens to be', () => {
    // `npx <tool>` runs the copy in the directory it is run from before any other.
    for (const f of launchers) {
      const found = linesOf(f).filter((l) => /(?:^|[\s;&|(])npx\s/.test(l.text)).map((l) => `${f}:${l.line}`);
      expect(found, f).toEqual([]);
    }
  });

  it('a file in the worktree is read as data and never run', () => {
    // The names a launcher gives to files inside the worktree (its log, the agent's
    // summary, the signals) are found from the lines that assign them.
    for (const f of launchers) {
      const lines = linesOf(f);
      const names = lines.flatMap((l) => l.text.trim().match(/^([A-Z_]+)="\$\{WORKTREE\}\//)?.[1] ?? []);
      expect(names.length, f).toBeGreaterThan(0);
      const runner = new RegExp(`(?<![A-Za-z0-9_-])(?:bash|sh|source|\\.|eval|exec|node|python3?|tsx|npm|env)\\s+(?:-\\S+\\s+)*"?\\$\\{?(?:${names.join('|')})\\}?(?![A-Za-z0-9_])`);
      const asCommand = new RegExp(`(?:^|[;&|(]|\\$\\()\\s*"?\\$\\{?(?:${names.join('|')})\\}?(?![A-Za-z0-9_])`);
      const run = lines.filter((l) => runner.test(l.text) || asCommand.test(l.text)).map((l) => `${f}:${l.line}: ${l.text.trim().slice(0, 100)}`);
      expect(run, f).toEqual([]);
    }
  });

  it('a script that visits every checkout the repository lists asks git about them only through its own records', () => {
    // The drain keeps dormant checkouts current, and the list it walks includes the
    // worktrees agents were given. `git -C <that checkout>` reads the checkout's own
    // `.git` file. So the only directories such a script may hand to `git -C` are its
    // own, and every other checkout is reached with launcher_worktree_git.
    const walkers = codeFiles()
      .filter((f) => /\.sh$/.test(f))
      .filter((f) => linesOf(f).some((l) => /\bworktree list\b/.test(l.text)));
    expect(walkers).toEqual(['drain-inbox.sh']);
    for (const f of walkers) {
      const lines = linesOf(f);
      const targets = new Set(
        lines.flatMap((l) => [...l.text.matchAll(/(?<![A-Za-z0-9_-])git -C "\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"/g)].map((m) => m[1])),
      );
      expect([...targets].sort(), f).toEqual(['DRAIN_RUN_DIR', 'PRIMARY_ROOT', 'SCRIPT_DIR']);
      expect(lines.some((l) => /launcher_worktree_git "\$PRIMARY_ROOT" "\$root" /.test(l.text)), f).toBe(true);
      expect(lines.some((l) => l.text === 'source "${SCRIPT_DIR}/lib/agent-worktree.sh"'), f).toBe(true);
    }
  });
});

// ── bash 3.2 ─────────────────────────────────────────────────────────────────
//
// The reviewers are copied into adopters' repositories (scripts/gen-ci-templates.mjs),
// and some of those run on a machine whose only bash is 3.2. The launch program is run
// by every one of them, so it must not be the thing that stops a reviewer there. It did
// for a while: it asked which variables were exported with `${name@a}` and refused any
// bash older than 4.4.
//
// This is a tripwire for the constructs, by name. It is not a bash 3.2: whether a file
// PARSES there is something only that shell can say (review-branch.sh, review-decide.sh
// and the launch program do; review-pr.sh and review-approvable.sh did not before this
// work either, at a `$( ... )` its parser cannot close). A real 3.2 was run by hand
// when this was written, and is not on the machines that run this suite.

const LAUNCH_PROGRAM = path.join(SCRIPTS, 'lib', 'agent-context.sh');

/** Each construct bash 3.2 does not have, and how it reads in a script. */
const NOT_IN_BASH_32: [string, RegExp][] = [
  ['case modification, ${name^^} or ${name,,}', /\$\{!?(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(?:\[[^\]]*\])?(?:\^\^?|,,?)[^}]*\}/],
  ['parameter transformation, ${name@a}', /\$\{[^}]*[A-Za-z0-9_\]]@[A-Za-z]\}/],
  ['an associative array or a nameref', /\b(?:declare|local|typeset)\s+-[A-Za-z]*[An]/],
  ['[[ -v name ]]', /\[\[\s+(?:!\s+)?-v\s/],
  ['mapfile, readarray or coproc', /(?:^|[\s;&|(])(?:mapfile|readarray|coproc)\s/],
  ['|& or &>>', /\|&|&>>/],
  [';;& or ;& in a case', /;;&|;&(?!&)/],
  ['wait -n', /\bwait\s+-n\b/],
  ['a negative array index', /\$\{[A-Za-z_][A-Za-z0-9_]*\[-[0-9]+\]\}/],
  ['a shell option newer than 3.2', /\bshopt\s+-[su]\s+(?:globstar|lastpipe|inherit_errexit|autocd|checkjobs|dirspell|compat\d+)\b/],
  ['printf %(fmt)T', /printf\s+(?:-v\s+\S+\s+)?['"][^'"]*%\([^)]*\)T/],
];

describe('T0: what runs on an adopter\'s bash 3.2 uses nothing bash 3.2 lacks', () => {
  // The launch program, and the shipped scripts that do parse under 3.2.
  const HELD = ['lib/agent-context.sh', 'review-branch.sh', 'review-decide.sh'];

  it('the predicate itself: it sees each construct, and not the forms 3.2 does have', () => {
    for (const bad of [
      'local name="${1^^}"',
      'x="${login,,}"',
      'if [[ -v "$name" && "${!name@a}" == *x* ]]; then',
      'local -A passes=()',
      'declare -n ref=x',
      'mapfile -t lines < file',
      'cmd |& tee log',
      'echo "${arr[-1]}"',
      'shopt -s globstar',
    ]) {
      expect(NOT_IN_BASH_32.some(([, re]) => re.test(bad)), bad).toBe(true);
    }
    for (const fine of [
      'exec env -i ${pairs[@]+"${pairs[@]}"} "$@"',
      'for name in ${1+"$@"}; do',
      'local -a listed=("${AGENT_ENV_ALLOW[@]}")',
      'pairs+=("${name}=${!name}")',
      'shopt -s nocasematch',
      "exported=$'\\n'\"$(compgen -e)\"$'\\n'",
      '[[ "$a" =~ ^[0-9]+$ ]] && x="${BASH_REMATCH[0]}"',
      'cmd 2>&1 | tee -a "$LOG"',
      'echo "${1:-}" "${x%%/*}" "${x#*/}" "${#arr[@]}"',
    ]) {
      expect(NOT_IN_BASH_32.filter(([, re]) => re.test(fine)).map(([n]) => n), fine).toEqual([]);
    }
  });

  it.each(HELD)('%s uses none of them', (file) => {
    const found = codeLines(fs.readFileSync(path.join(SCRIPTS, file), 'utf-8'), file).flatMap((l) =>
      NOT_IN_BASH_32.filter(([, re]) => re.test(l.text)).map(([name]) => `${file}:${l.line}: ${name}: ${l.text.trim().slice(0, 100)}`),
    );
    expect(found).toEqual([]);
  });

  it('the launch program refuses only a bash older than 3.2, and says which it needs', () => {
    const text = fs.readFileSync(LAUNCH_PROGRAM, 'utf-8');
    expect(text).toContain('BASH_VERSINFO[0] < 3 || (BASH_VERSINFO[0] == 3 && BASH_VERSINFO[1] < 2)');
    expect(text).toMatch(/needs bash 3\.2 or newer/);
    expect(codeLines(text, 'lib/agent-context.sh').filter((l) => /BASH_VERSINFO\[0\] < 4|needs bash 4/.test(l.text))).toEqual([]);
  });

  it('the launch program expands no array that can be empty without the guard bash 3.2 needs', () => {
    // Under `set -u`, bash before 4.4 calls "${arr[@]}" of an EMPTY array an unbound
    // variable. The two arrays that can be empty here (nothing listed is exported;
    // nothing to hand over) are expanded as ${arr[@]+"${arr[@]}"}.
    const lines = codeLines(fs.readFileSync(LAUNCH_PROGRAM, 'utf-8'), 'lib/agent-context.sh');
    const bare = (name: string) => new RegExp(`(?<!\\+)"\\$\\{${name}\\[@\\]\\}"`);
    for (const name of ['AGENT_ENV_PASSING', 'pairs']) {
      expect(lines.filter((l) => bare(name).test(l.text)).map((l) => `${l.line}: ${l.text.trim()}`), name).toEqual([]);
      expect(lines.some((l) => l.text.includes(`\${${name}[@]+"\${${name}[@]}"}`)), name).toBe(true);
    }
  });

  it('the launch program still starts its command when it was handed an empty environment', () => {
    // As near to the empty case as a shell gets: bash exports a few names of its own on
    // the way up, and nothing else is there to hand over.
    const r = spawnSync('bash', ['-c', 'exec env -i "$BASH" "$1" /usr/bin/env', 'bash', LAUNCH_PROGRAM], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(r.status, r.stderr).toBe(0);
    const names = r.stdout.split('\n').filter(Boolean).map((l) => l.replace(/=.*/, ''));
    // Nothing bash made up for itself on the way (a default PATH, a TERM, a SHELL) is
    // among them: those are the shell's, and were never handed to the launcher.
    for (const n of names) expect(['PWD', 'OLDPWD', 'SHLVL', '_'], n).toContain(n);
  });

  it('a variable that only resembles a listed name does not make the listed one appear', () => {
    // HTTP_PROXY and TZ are on the list and are NOT in this environment. `http_proxy` is
    // (it is listed in its own right, and differs only by case), and so is a name that
    // merely contains `TZ`. Names are matched whole and exactly.
    const r = spawnSync('bash', ['-c', 'exec env -i http_proxy=fixture MY_TZ_OFFSET=1 "$BASH" "$1" /usr/bin/env', 'bash', LAUNCH_PROGRAM], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(r.status, r.stderr).toBe(0);
    const names = r.stdout.split('\n').filter(Boolean).map((l) => l.replace(/=.*/, ''));
    expect(names).toContain('http_proxy');
    expect(names).not.toContain('HTTP_PROXY');
    expect(names).not.toContain('TZ');
    expect(names).not.toContain('MY_TZ_OFFSET');
  });
});
