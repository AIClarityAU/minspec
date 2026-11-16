/**
 * What a launcher runs out of a worktree an agent has been in (lib/agent-worktree.sh).
 *
 * agent-launch-harness.ts records what an AGENT is started with. This records the other
 * half: what the LAUNCHER itself executes, in the agent's worktree, once the agent has
 * exited. The method is one file, a canary, planted at every place a launcher could run
 * something from. A canary does nothing but say that it ran: under which label, from
 * which directory, with which arguments and with which variables in its environment.
 *
 *   in the agent's worktree   git hooks, the scripts `npm test` and its siblings run, the
 *                             tools `npx` would find, and a second git directory the
 *                             worktree's `.git` file is rewritten to name
 *   in the launcher's tree    the launcher's own hooks and its own tools
 *
 * The first group is planted by the fixture agent itself (agent-act.sh, run by the stub
 * `claude` where the agent was started, with the environment the agent was given), after
 * it has made its commit. So every canary of that group that is seen afterwards was run by
 * the launcher.
 *
 * Nothing here knows how the launchers were fixed: the same harness, run against the
 * scripts before the change, is what records them red.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  CREDENTIAL_SHAPE,
  DISPATCH,
  DISPATCH_ISSUE,
  FOUNDER,
  NAMED_CREDENTIALS,
  ROOT,
  SCRIPTS,
  dispatchSandbox,
  runRemediate,
  withFixtureValues,
  type DispatchSandbox,
  type Recorded,
  type RemediateFixture,
  type RemediateOptions,
  type RemediateRun,
} from './agent-launch-harness';

/** A variable only the launcher is given: it is on no list, and it is not credential-shaped. */
export const LAUNCHER_ONLY = 'LAUNCHER_ONLY_FIXTURE';

/** What the launcher holds in these runs and no agent, and no worktree's code, may see. */
export const LAUNCHER_ENV: Record<string, string> = {
  ...withFixtureValues([...NAMED_CREDENTIALS, 'TAVILY_API_KEY', 'WEBHOOK_SECRET']),
  [LAUNCHER_ONLY]: '1',
};

/** Every hook git might run for a fetch, a push, a rebase, a merge, a checkout or a commit. */
export const HOOKS = [
  'pre-push',
  'reference-transaction',
  'post-checkout',
  'post-merge',
  'post-rewrite',
  'pre-rebase',
  'commit-msg',
  'prepare-commit-msg',
  'pre-merge-commit',
  'post-commit',
  'pre-commit',
  'post-index-change',
];

export interface Sighting {
  /** What was planted: `worktree-hook:pre-push`, `trusted-hook:pre-push`, `worktree-check`, ... */
  label: string;
  /** The directory the canary file is in, resolved. */
  ranFrom: string;
  cwd: string;
  args: string;
  /** The names of the variables in its environment. */
  names: string[];
}

/** The names in a sighting that mean it ran with the launcher's environment. Empty is the pass. */
export function launcherNames(s: Sighting): string[] {
  return s.names.filter((n) => n === LAUNCHER_ONLY || NAMED_CREDENTIALS.includes(n) || CREDENTIAL_SHAPE.test(n));
}

const logOf = (dir: string) => path.join(dir, 'canary.log');

/** The text of a canary. `then` is what it does once it has said that it ran. */
export function canary(dir: string, label: string, then = 'exit 0'): string {
  return [
    '#!/usr/bin/env bash',
    '# A canary: it says that it ran, from where, and with which variables.',
    `printf '%s\\t%s\\t%s\\t%s\\t%s\\n' '${label}' "$(cd "$(dirname "\${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" "$PWD" "$*" "$(compgen -e | tr '\\n' ' ')" >> '${logOf(dir)}'`,
    then,
    '',
  ].join('\n');
}

/** A hook is handed lines on its input by some git operations: read them, then pass. */
const HOOK_PASSES = 'cat >/dev/null 2>&1 || true\nexit 0';

export function sightings(dir: string): Sighting[] {
  const log = logOf(dir);
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [label = '', ranFrom = '', cwd = '', args = '', names = ''] = line.split('\t');
      return { label, ranFrom, cwd, args, names: names.split(' ').filter(Boolean) };
    });
}

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o755 });
}

/** The auto-merge gate's answer, from the stand-in for the launcher's own `tsx`. */
const GATE_ANSWER = '{"eligible":false,"blast":"low","reason":"fixture gate","failed":[],"block":""}';

/**
 * The launcher's own tree, as a real checkout has it: `core.hooksPath` is the relative
 * `.githooks` (`npm install` sets it), there is a hook of the launcher's own for every
 * name, and its tools are under its own `node_modules`. Each is a canary, so a test can
 * say that the launcher's copy DID run where one is a gate.
 */
function trustedTree(dir: string, repo: string, git: (...args: string[]) => string): void {
  git('-C', repo, 'config', 'core.hooksPath', '.githooks');
  for (const h of HOOKS) put(path.join(repo, '.githooks', h), canary(dir, `trusted-hook:${h}`, HOOK_PASSES));
  put(path.join(repo, 'node_modules', '.bin', 'tsx'), canary(dir, 'trusted-bin:tsx', `echo '${GATE_ANSWER}'\nexit 0`));
  // The reviewers read their verdict schema from the guard beside `scripts/`. Without it
  // a reviewer stops before it has asked git for anything.
  put(path.join(repo, '.github', 'scripts', 'ai-review-guard.js'), fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ai-review-guard.js'), 'utf-8'));
}

export interface AgentActs {
  /**
   * Also rewrite the worktree's `.git` file to name a git directory of the agent's own:
   * a copy of the repository's, whose configuration names the agent's programs for the
   * two ends of a push and a fetch, and for showing a diff (which is what a reviewer
   * asks git for).
   */
  redirectGit?: boolean;
  /** A line the agent commits, for a commit the pre-publish scan must stop. */
  commits?: string;
}

/**
 * A line the pre-publish scan stops a commit for: the key name of a credentials file,
 * with a value that is plainly not one. It is the NAME the scan matches, not a secret.
 * Put together from two pieces so that this file's own lines do not hold it: the scan
 * reads the diff of whatever is being published, this file included.
 */
export const SCAN_STOPS_THIS = ['aws_access', '_key_id = fixture-not-a-key'].join('');

/**
 * Write what the fixture agent does (agent-act.sh) and the files it plants.
 *
 * One commit first, made with no hooks, so that nothing planted has run by the time the
 * agent exits. Then a canary at every place its launcher might run something from.
 */
export function agentActs(dir: string, acts: AgentActs = {}): void {
  const plant = path.join(dir, 'plant');
  for (const h of HOOKS) put(path.join(plant, '.githooks', h), canary(dir, `worktree-hook:${h}`, HOOK_PASSES));
  put(path.join(plant, '.canary', 'check.sh'), canary(dir, 'worktree-check'));
  put(path.join(plant, '.canary', 'receive-pack'), canary(dir, 'worktree-git:receive-pack', 'exec git receive-pack "$@"'));
  put(path.join(plant, '.canary', 'upload-pack'), canary(dir, 'worktree-git:upload-pack', 'exec git upload-pack "$@"'));
  put(path.join(plant, '.canary', 'ext-diff'), canary(dir, 'worktree-git:ext-diff'));
  put(path.join(plant, 'node_modules', '.bin', 'tsx'), canary(dir, 'worktree-bin:tsx', 'exit 1'));
  put(path.join(plant, 'node_modules', '.bin', 'vitest'), canary(dir, 'worktree-bin:vitest', 'exit 1'));
  const check = (name: string) => `bash ./.canary/check.sh ${name}`;
  fs.writeFileSync(
    path.join(plant, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      version: '0.0.0',
      private: true,
      scripts: { test: check('test'), lint: check('lint'), build: check('build'), validate: check('validate') },
    }),
  );
  const redirect = acts.redirectGit
    ? [
        'common="$(git rev-parse --path-format=absolute --git-common-dir)"',
        'cp -R "$common" .elsewhere',
        'git config -f .elsewhere/config remote.origin.receivepack "$PWD/.canary/receive-pack"',
        'git config -f .elsewhere/config remote.origin.uploadpack "$PWD/.canary/upload-pack"',
        'git config -f .elsewhere/config diff.external "$PWD/.canary/ext-diff"',
        `printf 'gitdir: %s\\n' "$PWD/.elsewhere" > .git`,
      ]
    : [];
  put(
    path.join(dir, 'agent-act.sh'),
    [
      '#!/usr/bin/env bash',
      '# What the fixture agent does in its worktree.',
      'set -euo pipefail',
      '[[ -e .canary/planted ]] && exit 0',
      "printf 'the agent was here\\n' >> README.md",
      ...(acts.commits ? [`printf '%s\\n' '${acts.commits}' >> README.md`] : []),
      'git -c core.hooksPath=/dev/null add README.md',
      "git -c core.hooksPath=/dev/null -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m 'fixture: the change the agent made'",
      `cp -Rp '${plant}/.' .`,
      ...redirect,
      ': > .canary/planted',
      '',
    ].join('\n'),
  );
}

export interface TrustRun {
  status: number | null;
  out: string;
  dir: string;
  repo: string;
  origin: string;
  worktree: string;
  branch: string;
  sightings: Sighting[];
  recorded: Recorded;
  /** What the fixture agent's own script printed, for a failure message. */
  actLog: string;
  /** The commit a branch is at in `origin`, or '' when it has none. */
  originHead(branch?: string): string;
  /** The commit the agent made, read from the repository the launcher runs from. */
  agentCommit(): string;
}

function gitIn(dir: string): (...args: string[]) => string {
  const env = {
    ...process.env,
    HOME: path.join(dir, 'home'),
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  return (...args: string[]) => execFileSync('git', args, { env, encoding: 'utf-8', stdio: 'pipe' });
}

function trustRun(
  sb: DispatchSandbox,
  r: { status: number | null; stdout: string | null; stderr: string | null },
  branch: string,
): TrustRun {
  const repo = path.join(sb.dir, 'repo');
  const origin = path.join(sb.dir, 'origin.git');
  const git = gitIn(sb.dir);
  const tryGit = (...args: string[]) => {
    try {
      return git(...args).trim();
    } catch {
      return '';
    }
  };
  const actLog = path.join(sb.dir, 'agent-act.log');
  return {
    status: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    dir: sb.dir,
    repo,
    origin,
    worktree: sb.worktree(DISPATCH_ISSUE),
    branch,
    sightings: sightings(sb.dir),
    recorded: sb.recorded(),
    actLog: fs.existsSync(actLog) ? fs.readFileSync(actLog, 'utf-8') : '',
    originHead: (b = branch) => tryGit('--git-dir', origin, 'rev-parse', '--verify', '-q', `refs/heads/${b}`),
    agentCommit: () => tryGit('-C', repo, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`),
  };
}

/** The branch the dispatcher gives an issue's agent, read from the script that names it. */
export function dispatchBranch(issue = DISPATCH_ISSUE): string {
  const m = fs.readFileSync(DISPATCH, 'utf-8').match(/^BRANCH="([^"$]*)\$\{?ISSUE\}?([^"$]*)"$/m);
  if (!m) throw new Error('BRANCH= not found in dispatch-issue.sh: fix this extractor, do not hard-code the name');
  return `${m[1]}${issue}${m[2]}`;
}

/**
 * Run the real dispatcher for one issue to the end: the agent commits and plants, and the
 * dispatcher scans, pushes, runs the checks, asks its reviewers and its auto-merge gate.
 * The shepherd that would then wait on the pull request is turned off; its steps are run
 * by runShepherd.
 */
export function runDispatchToPublish(acts: AgentActs = {}): TrustRun {
  const sb = dispatchSandbox({ [DISPATCH_ISSUE]: { author: FOUNDER } }, 'Done: the change is committed.');
  trustedTree(sb.dir, path.join(sb.dir, 'repo'), gitIn(sb.dir));
  agentActs(sb.dir, acts);
  const r = spawnSync(sb.dispatcher, [DISPATCH_ISSUE], {
    encoding: 'utf-8',
    env: { ...sb.env, ...LAUNCHER_ENV, MINSPEC_SHEPHERD_OFF: '1' },
  });
  return trustRun(sb, r, dispatchBranch());
}

/** One function of dispatch-issue.sh, as shipped. */
function shippedFunction(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {\n`);
  const end = src.indexOf('\n}\n', start);
  if (start < 0 || end <= start) {
    throw new Error(`${name}() not found in dispatch-issue.sh: fix this extractor rather than deleting the test`);
  }
  return src.slice(start + 1, end + 2);
}

/**
 * Run one step of the dispatcher's shepherd, as shipped, on a worktree an agent has been
 * in: `publish` (scan, then push) or `rebase` (fetch, rebase onto a `main` that has moved,
 * then scan and force-push).
 *
 * The functions are taken out of dispatch-issue.sh, and what they lean on is set up by
 * the script's own `source` lines. The worktree is made the way the script makes one, by
 * `git worktree add` from the repository the script is in, and pinned the way the script
 * pins one when the script under test knows how to.
 */
export function runShepherd(step: 'publish' | 'rebase', acts: AgentActs = {}): TrustRun {
  const src = fs.readFileSync(DISPATCH, 'utf-8');
  const setup = src.split('\n').filter((l) => /^source "\$\{SCRIPT_DIR\}\/lib\/[a-z0-9-]+\.sh"$/.test(l));
  const fns = ['run_egress_guard', 'shepherd_publish', 'shepherd_rebase'].map((n) => shippedFunction(src, n));
  for (const needle of ['push', 'rebase', 'fetch']) {
    if (!fns.some((f) => new RegExp(`\\b${needle}\\b`).test(f))) {
      throw new Error(`the shepherd no longer runs git ${needle}: this harness is testing nothing`);
    }
  }

  const sb = dispatchSandbox({ [DISPATCH_ISSUE]: { author: FOUNDER } });
  const repo = path.join(sb.dir, 'repo');
  const git = gitIn(sb.dir);
  trustedTree(sb.dir, repo, git);
  agentActs(sb.dir, acts);
  const branch = dispatchBranch();
  const worktree = sb.worktree(DISPATCH_ISSUE);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git('-C', repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '-q', '-b', branch, worktree, 'origin/main');

  if (step === 'rebase') {
    // `main` moves on in `origin` after the worktree was cut from it, in a file the agent
    // does not touch, so the rebase has something to do and applies cleanly.
    const seed = path.join(sb.dir, 'seed-main');
    git('clone', '-q', path.join(sb.dir, 'origin.git'), seed);
    fs.writeFileSync(path.join(seed, 'MOVED.md'), 'main moved on\n');
    git('-C', seed, 'add', 'MOVED.md');
    git('-C', seed, 'commit', '-q', '-m', 'fixture: main moves on');
    git('-C', seed, 'push', '-q', 'origin', 'main');
  }

  const driver = [
    'set -euo pipefail',
    `SCRIPT_DIR=${JSON.stringify(path.join(repo, 'scripts'))}`,
    `REPO_ROOT=${JSON.stringify(repo)}`,
    'REPO="AIClarityAU/minspec"',
    `ISSUE=${DISPATCH_ISSUE}`,
    'ROLE=dev',
    `BRANCH=${JSON.stringify(branch)}`,
    `WORKTREE=${JSON.stringify(worktree)}`,
    `LOG=${JSON.stringify(path.join(sb.dir, 'agent.log'))}`,
    ...setup,
    'gh_bot_init',
    'if declare -F agent_worktree_pin >/dev/null; then agent_worktree_pin "$WORKTREE"; fi',
    // The agent runs now, after the worktree was pinned, as it does in the script. It is
    // given a bare environment: what it plants is what matters here, not what it holds.
    `( cd "$WORKTREE" && env -i "PATH=$PATH" "HOME=$HOME" ${JSON.stringify(path.join(sb.dir, 'agent-act.sh'))} 0 ) >> ${JSON.stringify(path.join(sb.dir, 'agent-act.log'))} 2>&1`,
    'quarantine_publish() { echo "QUARANTINED: $1"; }',
    ...fns,
    'step_rc=0',
    step === 'publish' ? 'shepherd_publish || step_rc=$?' : 'shepherd_rebase || step_rc=$?',
    'echo "SHEPHERD-STEP-RETURNED:$step_rc"',
  ].join('\n');
  const file = path.join(sb.dir, 'shepherd-step.sh');
  fs.writeFileSync(file, driver);
  const r = spawnSync('bash', [file], {
    encoding: 'utf-8',
    env: {
      ...sb.env,
      ...LAUNCHER_ENV,
      MINSPEC_CLAIM_OFF: '1',
      // A rebase writes commits, so the launcher needs a name to write them under, as
      // the machine it really runs on has in its git configuration.
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  });
  const run = trustRun(sb, r, branch);
  if (!/^SHEPHERD-STEP-RETURNED:\d+$/m.test(run.out)) {
    throw new Error(`the shepherd step did not return (driver exit ${r.status}):\n${run.out}\n${run.actLog}`);
  }
  return run;
}

/** What a shepherd step returned. */
export function stepReturned(run: TrustRun): number {
  return Number(run.out.match(/^SHEPHERD-STEP-RETURNED:(\d+)$/m)?.[1] ?? -1);
}

export interface RemediateTrustRun extends RemediateRun {
  sightings: Sighting[];
  /** The commit the pull request's branch is at in `origin` after the sweep. */
  originHead: string;
  /** The commit it was at before. */
  originHeadBefore: string;
}

/**
 * Run the real scripts/remediate-pr.sh on a pull request whose BRANCH already carries a
 * hook for every name: the agent that opened the pull request committed them. The sweep
 * checks that branch out, so they are in its worktree before any agent is started there.
 *
 * `mainMoved` puts a commit on `origin/main` the branch does not have, which is what the
 * mechanical merge (`rebase-only`) needs to have something to do.
 */
export function runRemediateTrust(
  opts: RemediateOptions & { acts?: AgentActs; mainMoved?: boolean } = {},
): RemediateTrustRun {
  let before = '';
  let fixture: RemediateFixture | undefined;
  const run = runRemediate({
    agentOut: 'Done: the fix is committed.',
    ...opts,
    env: { ...LAUNCHER_ENV, MINSPEC_CLAIM_OFF: '1', ...opts.env },
    prepare(f) {
      fixture = f;
      trustedTree(f.dir, f.repo, f.git);
      agentActs(f.dir, opts.acts);
      for (const h of HOOKS) put(path.join(f.seed, '.githooks', h), canary(f.dir, `worktree-hook:${h}`, HOOK_PASSES));
      f.git('-C', f.seed, '-c', 'core.hooksPath=/dev/null', 'add', '.githooks');
      f.git('-C', f.seed, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'fixture: hooks the branch carries');
      before = f.git('-C', f.seed, 'rev-parse', 'HEAD').trim();
      if (opts.mainMoved) {
        const main = path.join(f.dir, 'seed-main');
        f.git('clone', '-q', f.origin, main);
        fs.writeFileSync(path.join(main, 'MOVED.md'), 'main moved on\n');
        f.git('-C', main, 'add', 'MOVED.md');
        f.git('-C', main, 'commit', '-q', '-m', 'fixture: main moves on');
        f.git('-C', main, 'push', '-q', 'origin', 'main');
      }
      opts.prepare?.(f);
    },
  });
  if (!fixture) throw new Error('the remediation fixture was never built');
  let head = '';
  try {
    head = fixture.git('--git-dir', run.origin, 'rev-parse', '--verify', '-q', `refs/heads/${run.branch}`).trim();
  } catch {
    head = '';
  }
  return { ...run, sightings: sightings(run.dir), originHead: head, originHeadBefore: before };
}

// ── The drain's sweep of every checkout ──────────────────────────────────────

export interface DrainSyncRun {
  status: number | null;
  out: string;
  dir: string;
  sightings: Sighting[];
  /** A checkout nobody is using, on `main`, behind `origin`: the sweep's own work. */
  siblingHead: string;
  /** Where `origin/main` is. */
  originMain: string;
  /** The worktree an agent was given, and what its `.git` file says now. */
  agentWorktree: string;
  agentGitFile: string;
  dispose(): void;
}

/**
 * Run the real scripts/drain-inbox.sh --sync-checkouts over a repository with three
 * checkouts: its own (parked off `main`, with a live session), a dormant one on `main`
 * that is behind `origin`, and a worktree an agent was given on a branch of its own.
 *
 * The agent has rewritten that worktree's `.git` file to name a git directory it made:
 * a copy of the repository's, whose HEAD says `main` and whose configuration names a
 * program of the agent's for git to ask about changed files. The sweep visits every
 * checkout the repository has on record. With `headSaysMain` the agent has also pointed
 * the worktree's REAL HEAD at `main`, so the sweep's first question (is it on `main`?)
 * is answered yes by the repository's own record too.
 *
 * The script and its libraries are COPIED into the repository under test, as
 * presence-sync-parity.test.ts does, and the repository is named outright as well: the
 * sweep must never be pointed at the checkout these tests run from.
 */
export function runDrainSync(opts: { headSaysMain?: boolean } = {}): DrainSyncRun {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'trust-drain-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const git = gitIn(dir);
  const origin = path.join(dir, 'origin.git');
  const primary = path.join(dir, 'primary');
  const sibling = path.join(dir, 'sibling');
  const agentWorktree = path.join(dir, 'agent-worktree');
  git('init', '-q', '--bare', '-b', 'main', origin);
  git('clone', '-q', origin, primary);
  fs.writeFileSync(path.join(primary, '.gitignore'), '.minspec/sessions/\n');
  fs.writeFileSync(path.join(primary, 'a.txt'), 'one\n');
  git('-C', primary, 'add', '.gitignore', 'a.txt');
  git('-C', primary, 'commit', '-q', '-m', 'fixture: one');
  git('-C', primary, 'push', '-q', 'origin', 'main');
  git('-C', primary, 'checkout', '-q', '-b', 'host');
  git('-C', primary, 'worktree', 'add', '-q', sibling, 'main');
  git('-C', primary, 'worktree', 'add', '-q', '-b', 'agent/issue-9', agentWorktree, 'origin/main');

  const other = path.join(dir, 'other');
  git('clone', '-q', origin, other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'two\n');
  git('-C', other, 'add', 'b.txt');
  git('-C', other, 'commit', '-q', '-m', 'fixture: two');
  git('-C', other, 'push', '-q', 'origin', 'main');
  git('-C', primary, 'fetch', '-q', 'origin', 'main');

  // A live session in the repository's own checkout, so the sweep can tell that the
  // other one on `main` is dormant (with nobody provably live it touches nothing).
  const sessions = path.join(primary, '.minspec', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(
    path.join(sessions, 'fixture.session.json'),
    `${JSON.stringify({ sessionId: 'fixture', worktreeRoot: primary, pid: process.pid, lastSeen: new Date().toISOString() }, null, 2)}\n`,
  );

  fs.mkdirSync(path.join(primary, 'scripts'));
  fs.copyFileSync(path.join(SCRIPTS, 'drain-inbox.sh'), path.join(primary, 'scripts', 'drain-inbox.sh'));
  fs.cpSync(path.join(SCRIPTS, 'lib'), path.join(primary, 'scripts', 'lib'), { recursive: true });

  // The agent's move, made in its own worktree with nothing but git and a file write.
  put(path.join(agentWorktree, '.canary', 'fsmonitor'), canary(dir, 'worktree-git:fsmonitor'));
  for (const h of HOOKS) put(path.join(agentWorktree, '.githooks', h), canary(dir, `worktree-hook:${h}`, HOOK_PASSES));
  const common = git('-C', agentWorktree, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
  const elsewhere = path.join(agentWorktree, '.elsewhere');
  fs.cpSync(common, elsewhere, { recursive: true });
  git('--git-dir', elsewhere, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  // And, when asked, the same in the git directory that really is the worktree's: git
  // lets a worktree point its HEAD at any branch by name, so the repository's own record
  // then says `main` as well.
  if (opts.headSaysMain) git('-C', agentWorktree, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('config', '-f', path.join(elsewhere, 'config'), 'core.fsmonitor', path.join(agentWorktree, '.canary', 'fsmonitor'));
  git('config', '-f', path.join(elsewhere, 'config'), 'core.hooksPath', path.join(agentWorktree, '.githooks'));
  fs.writeFileSync(path.join(agentWorktree, '.git'), `gitdir: ${elsewhere}\n`);

  const pins = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(e[0]) && e[1] !== undefined),
  );
  const r = spawnSync('bash', [path.join(primary, 'scripts', 'drain-inbox.sh'), '--sync-checkouts'], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      ...pins,
      ...LAUNCHER_ENV,
      MINSPEC_DRAIN_PRIMARY_ROOT: primary,
      // The run directory is not what is under test.
      MINSPEC_DRAIN_SELF_REFRESH: '0',
      MINSPEC_DRAIN_RUN_DIR: path.join(dir, 'norun'),
    },
  });
  const rev = (...args: string[]) => {
    try {
      return git(...args).trim();
    } catch {
      return '';
    }
  };
  return {
    status: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    dir,
    sightings: sightings(dir),
    siblingHead: rev('--git-dir', path.join(primary, '.git', 'worktrees', 'sibling'), 'rev-parse', 'HEAD'),
    originMain: rev('--git-dir', origin, 'rev-parse', 'refs/heads/main'),
    agentWorktree,
    agentGitFile: fs.readFileSync(path.join(agentWorktree, '.git'), 'utf-8'),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
