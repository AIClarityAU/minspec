/**
 * What a launcher runs out of a worktree an agent has been in (#1203).
 *
 * An agent is started with an environment built from a list of names, so it is not handed
 * its launcher's token. The launcher still holds it, and goes back into the same
 * directory afterwards: it scans, pushes, rebases, runs the checks, asks a reviewer and a
 * gate. Anything in that directory it EXECUTES there runs as the launcher. These tests
 * plant a canary at each such place, in a real worktree, and read what the launcher let it
 * see (helpers/agent-worktree-harness.ts has the method).
 *
 * Two answers are accepted, and each test names the one it holds a site to:
 *
 *   never run     a worktree's git hook, a worktree's tool, a program the worktree's own
 *                 git configuration names. The launcher's copy runs instead, and where
 *                 that copy is a gate the test says it DID run.
 *   run blind     the worktree's own checks. They are its code by definition, so they run
 *                 with the environment an agent is given and nothing of the launcher's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { cleanupLaunchHarness, SCRIPTS } from './helpers/agent-launch-harness';
import {
  HOOKS,
  LAUNCHER_ONLY,
  SCAN_STOPS_THIS,
  launcherNames,
  runDispatchToPublish,
  runDrainSync,
  runRemediateTrust,
  runShepherd,
  stepReturned,
  type DrainSyncRun,
  type RemediateTrustRun,
  type Sighting,
  type TrustRun,
} from './helpers/agent-worktree-harness';

const LIB = path.join(SCRIPTS, 'lib', 'agent-worktree.sh');

// Every test here runs real git and real scripts. At module scope: the call is inert
// from inside a hook (#1399).
useShellTimeout();

afterAll(() => {
  cleanupLaunchHarness();
});

const labelled = (all: Sighting[], prefix: string) => all.filter((s) => s.label.startsWith(prefix));
/** One line a sighting, for a failure message: what ran, and what it could see of the launcher's. */
const told = (all: Sighting[]) => all.map((s) => `${s.label} [${s.args}] saw: ${launcherNames(s).join(',') || 'nothing of the launcher\'s'}`);
/** Was the FILE that ran inside this directory? (Where it was run from is not the question:
 * the launcher's own hooks run with the worktree as their directory, and should.) */
const under = (dir: string) => {
  const real = fs.realpathSync(dir);
  return (s: Sighting) => s.ranFrom === real || s.ranFrom.startsWith(`${real}/`);
};

// A run of the real dispatcher takes several seconds, and several times that on a busy
// machine: each is made once, and the tests below read it.
const SLOW = 600_000;

describe('the dispatcher, from the agent exiting to the end of its run', () => {
  let run: TrustRun;
  beforeAll(() => {
    run = runDispatchToPublish();
  }, SLOW);

  it('ran to the end: the agent committed and planted, and the branch reached origin', () => {
    // Without this every "never ran" below would pass on a run that stopped early.
    expect(run.actLog).not.toMatch(/failed/);
    expect(run.agentCommit(), run.out).not.toBe('');
    expect(run.originHead(), run.out).toBe(run.agentCommit());
    expect(run.out).toContain('Running auto-merge gate');
    // The build agent, then the reviewer the dispatcher asks about its work.
    expect(run.recorded.launches.length, run.out).toBeGreaterThanOrEqual(2);
  });

  it('runs none of the worktree\'s git hooks', () => {
    expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
  });

  it('runs its OWN pre-push hook on the push: hooks are pinned, not turned off', () => {
    const own = labelled(run.sightings, 'trusted-hook:pre-push');
    expect(own.length, told(run.sightings).join('\n')).toBeGreaterThan(0);
    for (const s of own) expect(s.ranFrom).toBe(path.join(fs.realpathSync(run.repo), '.githooks'));
  });

  it('runs each of the worktree\'s four checks, and with nothing of its own in their environment', () => {
    const checks = labelled(run.sightings, 'worktree-check');
    expect(checks.map((s) => s.args).sort()).toEqual(['build', 'lint', 'test', 'validate']);
    for (const s of checks) expect(launcherNames(s), `npm run ${s.args}`).toEqual([]);
  });

  it('gives the checks the environment an agent is given, so they can still run', () => {
    for (const s of labelled(run.sightings, 'worktree-check')) {
      expect(s.names).toContain('PATH');
      expect(s.names).toContain('HOME');
    }
  });

  it('never runs a tool out of the worktree\'s node_modules', () => {
    expect(told(labelled(run.sightings, 'worktree-bin:'))).toEqual([]);
  });

  it('runs the auto-merge gate with its own tsx, away from the worktree, and blind', () => {
    const gate = labelled(run.sightings, 'trusted-bin:tsx').filter((s) => s.args.includes('auto-merge-gate.ts'));
    expect(gate.length, told(run.sightings).join('\n')).toBe(1);
    expect(gate[0].ranFrom).toBe(path.join(fs.realpathSync(run.repo), 'node_modules', '.bin'));
    // The gate runs the worktree's tests itself, so it is started the way a check is.
    expect(launcherNames(gate[0])).toEqual([]);
    // Not from inside the worktree, where the files a TypeScript runner reads on the way
    // up (its configuration, its path mappings) would be the agent's.
    expect(gate[0].cwd).not.toBe(run.worktree);
    expect(gate[0].args).toContain(`--worktree ${run.worktree}`);
  });

  it('lets nothing that ran out of the worktree see anything of the launcher\'s', () => {
    // The sweep behind the named tests: whatever a later change adds to the list of
    // things planted, or to the list of things the dispatcher runs.
    const exposed = run.sightings.filter(under(run.worktree)).filter((s) => launcherNames(s).length > 0);
    expect(told(exposed)).toEqual([]);
  });
});

describe('the dispatcher, when the agent rewrote the worktree\'s .git file', () => {
  let run: TrustRun;
  beforeAll(() => {
    run = runDispatchToPublish({ redirectGit: true });
  }, SLOW);

  it('still pushes the branch the agent committed to, from the git directory it made', () => {
    expect(run.actLog).not.toMatch(/failed/);
    expect(fs.readFileSync(path.join(run.worktree, '.git'), 'utf-8')).toContain('.elsewhere');
    expect(run.agentCommit(), run.out).not.toBe('');
    expect(run.originHead(), run.out).toBe(run.agentCommit());
  });

  it('runs no program named by the configuration the agent pointed it at', () => {
    expect(told(labelled(run.sightings, 'worktree-git:'))).toEqual([]);
  });

  it('shows its reviewer the diff of the branch it pushed, not of the git directory the agent named', () => {
    // The reviewer is the dispatcher's own script, run in the worktree, and it asks git
    // for the diff itself. The git directory the agent named has no change on it at all.
    const reviewer = run.recorded.launches[1];
    expect(reviewer, run.out).toBeDefined();
    expect(reviewer.prompt).toContain('+the agent was here');
  });

  it('runs none of the worktree\'s hooks and none of its tools either', () => {
    expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
    expect(told(labelled(run.sightings, 'worktree-bin:'))).toEqual([]);
  });

  it('lets nothing that ran out of the worktree see anything of the launcher\'s', () => {
    const exposed = run.sightings.filter(under(run.worktree)).filter((s) => launcherNames(s).length > 0);
    expect(told(exposed)).toEqual([]);
  });
});

describe('the shepherd\'s own steps on a worktree an agent has been in', () => {
  describe('publish (scan, then push)', () => {
    let run: TrustRun;
    beforeAll(() => {
      run = runShepherd('publish');
    }, SLOW);

    it('pushed', () => {
      expect(stepReturned(run), run.out).toBe(0);
      expect(run.originHead()).toBe(run.agentCommit());
    });
    it('ran none of the worktree\'s hooks, and its own pre-push', () => {
      expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
      expect(labelled(run.sightings, 'trusted-hook:pre-push').length).toBeGreaterThan(0);
    });
  });

  describe('rebase (fetch, rebase, scan, force-push)', () => {
    let run: TrustRun;
    beforeAll(() => {
      run = runShepherd('rebase');
    }, SLOW);

    it('rebased onto the main that had moved, and pushed the result', () => {
      expect(stepReturned(run), run.out).toBe(0);
      expect(run.originHead()).toBe(run.agentCommit());
      const onMain = execFileSync('git', ['--git-dir', run.origin, 'merge-base', '--is-ancestor', 'refs/heads/main', run.originHead()], {
        stdio: 'pipe',
      });
      expect(onMain.length).toBe(0);
    });
    it('ran none of the worktree\'s hooks through the fetch, the rebase or the push', () => {
      expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
    });
    it('ran its own hooks for them', () => {
      const own = new Set(labelled(run.sightings, 'trusted-hook:').map((s) => s.label));
      expect([...own]).toContain('trusted-hook:pre-push');
      expect([...own]).toContain('trusted-hook:pre-rebase');
    });
  });

  describe('the pre-publish scan reads the history that is about to be pushed', () => {
    // The scan asks git for the branch's commits. Asked through the worktree's `.git`
    // file, it is answered by whichever git directory that file names by then.
    it('control: a commit the scan stops is not pushed', () => {
      const run = runShepherd('publish', { commits: SCAN_STOPS_THIS });
      expect(run.out).toContain('QUARANTINED:');
      expect(stepReturned(run)).toBe(1);
      expect(run.originHead()).toBe('');
    }, SLOW);

    it('and is not pushed when the agent has pointed the worktree at a git directory where that commit is not', () => {
      const run = runShepherd('publish', { commits: SCAN_STOPS_THIS, redirectGit: true });
      expect(run.out).toContain('QUARANTINED:');
      expect(stepReturned(run)).toBe(1);
      expect(run.originHead()).toBe('');
      expect(told(labelled(run.sightings, 'worktree-git:'))).toEqual([]);
    }, SLOW);
  });

  describe('publish, when the agent rewrote the worktree\'s .git file', () => {
    let run: TrustRun;
    beforeAll(() => {
      run = runShepherd('publish', { redirectGit: true });
    }, SLOW);

    it('pushed the agent\'s commit and ran no program the agent\'s configuration names', () => {
      expect(stepReturned(run), run.out).toBe(0);
      expect(run.originHead()).toBe(run.agentCommit());
      expect(told(labelled(run.sightings, 'worktree-git:'))).toEqual([]);
    });
  });
});

describe('the remediation sweep, on a pull request whose branch carries hooks', () => {
  describe('the agent path (a failing check)', () => {
    let run: RemediateTrustRun;
    beforeAll(() => {
      run = runRemediateTrust();
    }, SLOW);

    it('started its agent, and pushed the commit the agent made onto the branch', () => {
      expect(run.launches.length, run.out).toBe(1);
      expect(run.originHead, run.out).not.toBe('');
      expect(run.originHead, run.out).not.toBe(run.originHeadBefore);
    });
    it('ran none of the branch\'s hooks: not making the worktree, not pushing from it', () => {
      expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
    });
    it('ran its own pre-push hook on the push', () => {
      expect(labelled(run.sightings, 'trusted-hook:pre-push').length, told(run.sightings).join('\n')).toBeGreaterThan(0);
    });
  });

  describe('the mechanical merge of main (no agent)', () => {
    let run: RemediateTrustRun;
    beforeAll(() => {
      run = runRemediateTrust({ pr: { statusCheckRollup: [], mergeStateStatus: 'BEHIND' }, mainMoved: true });
    }, SLOW);

    it('merged and pushed, with no agent started', () => {
      expect(run.out).toContain('Pushed merge of main');
      expect(run.launches).toEqual([]);
      expect(run.originHead).not.toBe(run.originHeadBefore);
    });
    it('ran none of the branch\'s hooks through the checkout, the merge or the push', () => {
      expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
    });
    it('ran its own hooks for them', () => {
      const own = new Set(labelled(run.sightings, 'trusted-hook:').map((s) => s.label));
      expect([...own]).toContain('trusted-hook:pre-push');
      expect([...own]).toContain('trusted-hook:commit-msg');
    });
  });

  describe('the pre-publish scan reads the commits that are about to be pushed', () => {
    it('control: a commit the scan stops is not pushed', () => {
      const run = runRemediateTrust({ acts: { commits: SCAN_STOPS_THIS } });
      expect(run.launches.length, run.out).toBe(1);
      expect(run.out).toContain('egress guard BLOCKED');
      expect(run.originHead).toBe(run.originHeadBefore);
    }, SLOW);

    it('and is not pushed when the agent has pointed the worktree at a git directory where that commit is not', () => {
      const run = runRemediateTrust({ acts: { commits: SCAN_STOPS_THIS, redirectGit: true } });
      expect(run.launches.length, run.out).toBe(1);
      expect(run.out).toContain('egress guard BLOCKED');
      expect(run.originHead).toBe(run.originHeadBefore);
    }, SLOW);
  });

  describe('the agent path, when the agent rewrote the worktree\'s .git file', () => {
    let run: RemediateTrustRun;
    beforeAll(() => {
      run = runRemediateTrust({ acts: { redirectGit: true } });
    }, SLOW);

    it('pushed the agent\'s commit and ran no program the agent\'s configuration names', () => {
      expect(run.originHead, run.out).not.toBe(run.originHeadBefore);
      expect(told(labelled(run.sightings, 'worktree-git:'))).toEqual([]);
      expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
    });
  });
});

describe('the drain, keeping every checkout the repository has on record current', () => {
  let run: DrainSyncRun;
  beforeAll(() => {
    run = runDrainSync();
  }, SLOW);
  afterAll(() => run?.dispose());

  it('control: it still fast-forwards a dormant checkout that is on main', () => {
    expect(run.status, run.out).toBe(0);
    expect(run.siblingHead, run.out).toBe(run.originMain);
  });

  it('runs no program named by the git directory an agent pointed its worktree at', () => {
    // It decides whether a checkout is on `main`, and clean, by asking git. Asked through
    // the worktree's own `.git` file, git answers from whatever that file names: here a
    // git directory that says `main`, and that names the agent's program for the very
    // next question.
    expect(run.agentGitFile).toContain('.elsewhere');
    expect(told(labelled(run.sightings, 'worktree-git:'))).toEqual([]);
    expect(told(labelled(run.sightings, 'worktree-hook:'))).toEqual([]);
  });

  it('lets nothing that ran out of the agent\'s worktree see anything of its own', () => {
    const exposed = run.sightings.filter(under(run.agentWorktree)).filter((s) => launcherNames(s).length > 0);
    expect(told(exposed)).toEqual([]);
  });

  it('and runs none when the agent has pointed its worktree\'s real HEAD at main as well', () => {
    // Then the repository's own record says `main` too, and the sweep goes on to ask
    // whether the checkout is clean. That question is where the agent's program is named.
    const second = runDrainSync({ headSaysMain: true });
    try {
      expect(second.status, second.out).toBe(0);
      expect(second.siblingHead, second.out).toBe(second.originMain);
      expect(told(labelled(second.sightings, 'worktree-git:'))).toEqual([]);
      expect(told(labelled(second.sightings, 'worktree-hook:'))).toEqual([]);
    } finally {
      second.dispose();
    }
  }, SLOW);
});

// ── lib/agent-worktree.sh on its own ─────────────────────────────────────────

describe('lib/agent-worktree.sh', () => {
  let dir: string;
  let repo: string;
  let worktree: string;
  const env = () => ({
    PATH: process.env.PATH ?? '',
    HOME: dir,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    [LAUNCHER_ONLY]: '1',
  });
  /** Source the library in a shell of its own, pin `pin` when given, and run `body`. */
  const sh = (body: string, pin?: string) =>
    spawnSync('bash', ['-c', `set -uo pipefail\nsource "$1"\n${pin ? 'agent_worktree_pin "$2" || exit 97\n' : ''}${body}`, 'x', LIB, pin ?? ''], {
      encoding: 'utf-8',
      env: env(),
    });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-worktree-lib-'));
    repo = path.join(dir, 'repo');
    worktree = path.join(dir, 'wt');
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, { env: { ...process.env, ...env() }, stdio: 'pipe' });
    git('-C', repo, 'init', '-q', '-b', 'main');
    git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'fixture');
    git('-C', repo, 'worktree', 'add', '-q', '-b', 'agent/x', worktree);
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names the launcher\'s own hooks by an absolute path beside its scripts', () => {
    const r = sh('printf %s "$AGENT_TRUSTED_HOOKS"');
    expect(r.stdout).toBe(path.join(path.dirname(SCRIPTS), '.githooks'));
  });

  it('pins a linked worktree to the git directory git made for it, outside the worktree', () => {
    const r = sh('printf "%s\\n%s" "$AGENT_WORKTREE" "$AGENT_WORKTREE_GIT_DIR"', worktree);
    expect(r.status, r.stderr).toBe(0);
    const [pinned, gitDir] = r.stdout.split('\n');
    expect(pinned).toBe(fs.realpathSync(worktree));
    expect(gitDir).toBe(path.join(fs.realpathSync(repo), '.git', 'worktrees', 'wt'));
  });

  it('throws away a pinned worktree and git directory that arrived in the environment', () => {
    const r = spawnSync('bash', ['-c', 'source "$1"; printf "[%s][%s]" "$AGENT_WORKTREE" "$AGENT_WORKTREE_GIT_DIR"', 'x', LIB], {
      encoding: 'utf-8',
      env: { ...env(), AGENT_WORKTREE: '/somewhere', AGENT_WORKTREE_GIT_DIR: '/somewhere/else', AGENT_TRUSTED_HOOKS: '/hooks' },
    });
    expect(r.stdout).toBe('[][]');
  });

  it.each([
    ['a directory that is not there', () => path.join(dir, 'absent')],
    ['no worktree at all', () => ''],
    ['a directory that is no git worktree', () => dir],
    // A repository's own checkout: its git directory is inside it, where an agent given
    // that directory to work in could rewrite it.
    ['a checkout whose git directory is inside it', () => repo],
  ])('refuses to pin %s, says so, and leaves nothing pinned', (_what, target) => {
    const r = sh(`agent_worktree_pin "$2"; echo "rc=$? [$AGENT_WORKTREE][$AGENT_WORKTREE_GIT_DIR]"`.replace('"$2"', JSON.stringify(target())));
    expect(r.stdout).toContain('rc=1 [][]');
    expect(r.stderr).toMatch(/^agent-worktree: .*Nothing was pinned\.$/m);
  });

  it('drops an earlier pin when a later one is refused', () => {
    const r = sh(`agent_worktree_pin ${JSON.stringify(path.join(dir, 'absent'))} 2>/dev/null; echo "rc=$? [$AGENT_WORKTREE]"`, worktree);
    expect(r.stdout).toContain('rc=1 []');
  });

  it.each([
    ['agent_worktree_git', 'agent_worktree_git rev-parse HEAD'],
    ['agent_worktree_trusted', 'agent_worktree_trusted /usr/bin/env true'],
    ['agent_worktree_function', 'f() { echo RAN; }; agent_worktree_function f'],
  ])('%s runs nothing, and says so, when no worktree is pinned', (_name, call) => {
    const r = sh(`${call}; echo "rc=$?"`);
    expect(r.stdout).toBe('rc=1\n');
    expect(r.stderr).toMatch(/no worktree is pinned/);
  });

  it('agent_worktree_git reads the pinned git directory whatever the worktree\'s .git file says', () => {
    const copy = path.join(dir, 'wt-redirected');
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'agent/y', copy], { env: { ...process.env, ...env() }, stdio: 'pipe' });
    const r = sh(
      [
        'before="$(agent_worktree_git rev-parse --absolute-git-dir)"',
        // The agent's move: a git directory of its own, named by the worktree's .git file.
        `git init -q ${JSON.stringify(path.join(copy, '.elsewhere'))}`,
        `printf 'gitdir: %s\\n' ${JSON.stringify(path.join(copy, '.elsewhere', '.git'))} > ${JSON.stringify(path.join(copy, '.git'))}`,
        'after="$(agent_worktree_git rev-parse --absolute-git-dir)"',
        `plain="$(git -C ${JSON.stringify(copy)} rev-parse --absolute-git-dir)"`,
        'echo "same=$([[ "$before" == "$after" ]] && echo yes || echo no) plain=${plain##*/wt-redirected/}"',
      ].join('\n'),
      copy,
    );
    expect(r.status, r.stderr).toBe(0);
    // The control is `plain`: an unpinned git in that directory does follow the file.
    expect(r.stdout.trim()).toBe('same=yes plain=.elsewhere/.git');
  });

  it('agent_worktree_trusted refuses a program that is not named by an absolute path', () => {
    for (const program of ['review-branch.sh', './review-branch.sh', 'scripts/review-branch.sh', '']) {
      const r = sh(`agent_worktree_trusted ${JSON.stringify(program)} x; echo "rc=$?"`, worktree);
      expect(r.stdout, program).toBe('rc=1\n');
      expect(r.stderr).toMatch(/is not an absolute path/);
    }
  });

  it('agent_worktree_trusted runs its program in the worktree with git pointed at the pinned directory and the launcher\'s hooks', () => {
    const r = sh(
      'agent_worktree_trusted /usr/bin/env bash -c \'echo "$PWD|$GIT_DIR|$GIT_WORK_TREE|$(git rev-parse --abbrev-ref HEAD)|$(git config core.hooksPath)"\'',
      worktree,
    );
    const real = fs.realpathSync(worktree);
    expect(r.stdout.trim()).toBe(
      [real, path.join(fs.realpathSync(repo), '.git', 'worktrees', 'wt'), real, 'agent/x', path.join(path.dirname(SCRIPTS), '.githooks')].join('|'),
    );
  });

  it('agent_worktree_trusted adds its hooks entry after the git configuration the environment already carries', () => {
    const r = spawnSync(
      'bash',
      ['-c', 'source "$1"; agent_worktree_pin "$2" || exit 97; agent_worktree_trusted /usr/bin/env bash -c \'echo "$GIT_CONFIG_COUNT|$(git config gc.auto)|$(git config core.hooksPath)"\'', 'x', LIB, worktree],
      { encoding: 'utf-8', env: { ...env(), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'gc.auto', GIT_CONFIG_VALUE_0: '0' } },
    );
    expect(r.stdout.trim()).toBe(`2|0|${path.join(path.dirname(SCRIPTS), '.githooks')}`);
  });

  it('agent_worktree_function calls a function of the launcher\'s with the same pins, and only a function', () => {
    const ok = sh('probe() { echo "$GIT_DIR|$1"; }; agent_worktree_function probe arg', worktree);
    expect(ok.stdout.trim()).toBe(`${path.join(fs.realpathSync(repo), '.git', 'worktrees', 'wt')}|arg`);
    const program = sh('agent_worktree_function /usr/bin/env true; echo "rc=$?"', worktree);
    expect(program.stdout).toBe('rc=1\n');
    expect(program.stderr).toMatch(/is not a shell function/);
  });

  it('leaves the launcher\'s own environment as it was: the pins do not outlive the call', () => {
    const r = sh('agent_worktree_trusted /usr/bin/env true; f() { :; }; agent_worktree_function f; echo "[${GIT_DIR-unset}][${GIT_WORK_TREE-unset}][${GIT_CONFIG_COUNT-unset}]"', worktree);
    expect(r.stdout.trim()).toBe('[unset][unset][unset]');
  });

  describe('launcher_worktree_git: a worktree this script did not make', () => {
    const admin = () => path.join(fs.realpathSync(repo), '.git', 'worktrees', 'wt');

    it('finds a worktree\'s git directory in the repository\'s own records', () => {
      const r = sh(`launcher_worktree_git_dir ${JSON.stringify(repo)} ${JSON.stringify(worktree)}`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe(admin());
    });

    it('and the repository\'s own checkout, and from any of its worktrees', () => {
      const own = sh(`launcher_worktree_git_dir ${JSON.stringify(repo)} ${JSON.stringify(repo)}`);
      expect(own.stdout.trim()).toBe(path.join(fs.realpathSync(repo), '.git'));
      // Asked from a linked worktree (a drain started from one), the records are the same.
      const fromLinked = sh(`launcher_worktree_git_dir ${JSON.stringify(worktree)} ${JSON.stringify(worktree)}`);
      expect(fromLinked.stdout.trim()).toBe(admin());
      const ownFromLinked = sh(`launcher_worktree_git_dir ${JSON.stringify(worktree)} ${JSON.stringify(repo)}`);
      expect(ownFromLinked.stdout.trim()).toBe(path.join(fs.realpathSync(repo), '.git'));
    });

    it('has no answer for a directory the repository has no record of, and git is not run there', () => {
      const stranger = path.join(dir, 'not-a-worktree');
      fs.mkdirSync(stranger, { recursive: true });
      const found = sh(`launcher_worktree_git_dir ${JSON.stringify(repo)} ${JSON.stringify(stranger)}; echo "rc=$?"`);
      expect(found.stdout).toBe('rc=1\n');
      const r = sh(`launcher_worktree_git ${JSON.stringify(repo)} ${JSON.stringify(stranger)} init -q; echo "rc=$?"`);
      expect(r.stdout).toBe('rc=1\n');
      expect(r.stderr).toMatch(/has no record of a worktree at .*so git was not run there/);
      expect(fs.existsSync(path.join(stranger, '.git'))).toBe(false);
    });

    it('answers from the records whatever the worktree\'s own .git file says', () => {
      const moved = path.join(dir, 'wt-moved');
      execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'agent/z', moved], { env: { ...process.env, ...env() }, stdio: 'pipe' });
      const r = sh(
        [
          `git init -q ${JSON.stringify(path.join(moved, '.elsewhere'))}`,
          `printf 'gitdir: %s\\n' ${JSON.stringify(path.join(moved, '.elsewhere', '.git'))} > ${JSON.stringify(path.join(moved, '.git'))}`,
          `launcher_worktree_git ${JSON.stringify(repo)} ${JSON.stringify(moved)} rev-parse --abbrev-ref HEAD`,
          `launcher_worktree_git ${JSON.stringify(repo)} ${JSON.stringify(moved)} rev-parse --absolute-git-dir`,
          `launcher_worktree_git ${JSON.stringify(repo)} ${JSON.stringify(moved)} config core.hooksPath`,
          // The control: an unpinned git in that directory follows the file.
          `git -C ${JSON.stringify(moved)} rev-parse --absolute-git-dir`,
        ].join('\n'),
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual([
        'agent/z',
        path.join(fs.realpathSync(repo), '.git', 'worktrees', 'wt-moved'),
        path.join(path.dirname(SCRIPTS), '.githooks'),
        path.join(fs.realpathSync(moved), '.elsewhere', '.git'),
      ]);
    });
  });

  it('is tested with a canary for every hook the repository ships', () => {
    // The list is the harness's. This holds it to the hooks the repository actually ships,
    // so a new hook file is one the canary runs cover.
    const shipped = fs.readdirSync(path.join(path.dirname(SCRIPTS), '.githooks'));
    for (const h of shipped) expect(HOOKS, `.githooks/${h} is not in the harness's list of hooks`).toContain(h);
  });
});
