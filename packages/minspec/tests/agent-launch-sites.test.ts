/**
 * T0 - every start of the CLI under scripts/ goes through the allowlist, and what each
 * one's agent is handed is what the allowlist says (#1203).
 *
 * dispatch-env-allowlist.test.ts holds this for the two launchers that read issue text
 * (the dispatcher and triage). This file holds it for the rest, and for the property
 * itself: that there is no start of the CLI anywhere under scripts/ that does not go
 * through scripts/lib/agent-context.sh.
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
 *      that is neither a start through the helper nor on a short list of explained
 *      non-starts fails. A new launcher that inherits cannot be added quietly.
 *
 * Every "secret" is a fixture value that says so. Nothing here can reach GitHub.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import {
  DISPATCH_ISSUE,
  FIXTURE_VALUE,
  FOUNDER,
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
});

// ── The enumerating gate ─────────────────────────────────────────────────────

/** File types that are documents or data, not something that runs. */
const NOT_CODE = new Set(['.md', '.json', '.jsonl', '.txt', '.pyc', '.patch', '.snap', '.svg', '.png']);

/** Every file under scripts/ that could start a program, as a path relative to scripts/. */
function codeFiles(dir = SCRIPTS): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__pycache__' ? [] : codeFiles(full);
    if (!e.isFile() || NOT_CODE.has(path.extname(e.name)) || e.name === 'LICENSE') return [];
    // Tests start stubs of their own, by design.
    if (/\.test\.(ts|js|mjs|cjs)$/.test(e.name) || /^test_.*\.py$/.test(e.name)) return [];
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
  const comment = /\.(ts|js|mjs|cjs)$/.test(file) ? /^\s*(\/\/|\/\*|\*)/ : /^\s*#/;
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
 * an absolute path to it, a quoted string in a spawn call), or the name of its package.
 * `.claude/`, `~/.claude`, `claude.ai` and an address at a mail host are not the CLI.
 */
function cliMentions(text: string): number[] {
  const at: number[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9_.@-])claude(?![A-Za-z0-9_./@-])|claude-code/g)) at.push(m.index ?? 0);
  return at;
}

/** Is the mention at `index` a start of the CLI through the helper, and nothing else? */
function startsThroughHelper(text: string, index: number): boolean {
  return /bash "\$AGENT_LAUNCH_ENV" (?:--model-login (?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN) )*$/.test(text.slice(0, index));
}

/**
 * Lines that name the CLI and do not start it. Each is matched by the file and a piece of
 * the line, and says why it is not a start. A line that names the CLI and is neither a
 * start through the helper nor on this list fails the gate, so this list is where a human
 * decides, in review, that a new mention is harmless.
 */
const NOT_A_START: { file: string; has: string; why: string }[] = [
  { file: 'retriage-unrecorded.sh', has: 'command -v claude >/dev/null', why: 'asks whether the CLI is installed; starts nothing' },
  { file: 'drain-inbox.sh', has: '"$comm" == *claude*', why: 'matches the name of an already-running process to find its own session' },
  { file: 'tooling-radar/parse-scan.mjs', has: 'claude output was not JSON', why: 'an error message' },
  { file: 'tooling-radar/parse-scan.mjs', has: 'claude reported an error', why: 'an error message' },
  { file: 'tooling-radar/parse-scan.mjs', has: 'claude output had no string', why: 'an error message' },
  { file: 'hooks/session-panel.py', has: 'A print-mode run (`claude -p <prompt>`)', why: 'a docstring' },
  { file: 'hooks/session-panel.py', has: 'a checkout under a folder called "claude-code"', why: 'a docstring' },
  { file: 'hooks/session-panel.py', has: 'f.read().strip() == "claude"', why: 'reads the name of an already-running process' },
  { file: 'hooks/session-panel.py', has: 'os.path.basename(program) == "claude"', why: 'compares the path of an already-running process' },
  { file: 'hooks/session-panel.py', has: 'Resume it in a terminal: claude --resume', why: 'text shown to a person' },
];

/**
 * How many times each file starts the CLI. Pinned, so that a launcher gaining a start
 * (or a new launcher appearing) is a deliberate edit here, next to the reminder that the
 * new start needs a behavioural test above: this gate reads text, and only a test that
 * runs the launcher sees what its agent is handed.
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
function classify(file: string, text: string): { starts: CodeLine[]; unexplained: Finding[]; explained: Set<number> } {
  const starts: CodeLine[] = [];
  const unexplained: Finding[] = [];
  const explained = new Set<number>();
  for (const l of codeLines(text, file)) {
    const mentions = cliMentions(l.text);
    if (mentions.length === 0) continue;
    if (mentions.every((i) => startsThroughHelper(l.text, i))) {
      starts.push(l);
      continue;
    }
    const entry = NOT_A_START.findIndex((e) => e.file === file && l.text.includes(e.has));
    if (entry >= 0) explained.add(entry);
    else unexplained.push({ where: `scripts/${file}:${l.line}`, text: l.text.trim().slice(0, 160) });
  }
  return { starts, unexplained, explained };
}

describe('T0: no start of the CLI anywhere under scripts/ goes round the allowlist', () => {
  const files = codeFiles();
  const read = (file: string) => fs.readFileSync(path.join(SCRIPTS, file), 'utf-8');
  const all = files.map((file) => ({ file, ...classify(file, read(file)) }));

  it('reads the whole of scripts/, nested directories included (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files).toEqual(expect.arrayContaining(['dispatch-issue.sh', 'tooling-radar/run-radar.sh', 'hooks/session-panel.py', 'lib/gh-bot.sh']));
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
          '`bash "$AGENT_LAUNCH_ENV" claude ...`; or, if the line starts nothing, add it to NOT_A_START in this file ' +
          `with the reason.\n${unexplained.map((u) => `  ${u.where}: ${u.text}`).join('\n')}`
        : 'every mention accounted for',
    ).toEqual([]);
  });

  it('every explained non-start still exists (the list does not outlive what it explains)', () => {
    const live = new Set(all.flatMap((f) => [...f.explained]));
    const stale = NOT_A_START.filter((_, i) => !live.has(i)).map((e) => `${e.file}: ${e.has}`);
    expect(stale).toEqual([]);
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
