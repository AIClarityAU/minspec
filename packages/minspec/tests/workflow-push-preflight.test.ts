import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

/**
 * T3 regression (#1120): a push that touches `.github/workflows/**` with a GitHub
 * App credential must be refused LOCALLY, with an actionable message.
 *
 * GitHub gates workflow files behind a separate `workflows: write` permission —
 * `contents: write`, which the minspec-sdd App has, is documented as insufficient.
 * So the server rejects such a push outright, and it does so only at `git push`,
 * after the work is already sealed into branch history:
 *
 *   ! [remote rejected] … (refusing to allow a GitHub App to create or update
 *     workflow `.github/workflows/ai-review.yml` without `workflows` permission)
 *
 * Every `MinSpec: Refresh Harness Files` rewrites five managed workflow templates,
 * so this fires on every harness refresh in every consuming repo until the App is
 * granted the permission.
 *
 * These drive a REAL `git push` against a local bare remote. A mocked push cannot
 * prove a hook fires — the same class of gap that shipped an inert guard in #1057,
 * where the fixture manufactured a precondition production lacked.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const made: string[] = [];

/**
 * Isolate from the developer's own git config.
 *
 * `credential.helper` is CUMULATIVE — git runs every configured helper in order and
 * takes the first answer. This box has `credential.helper = store` in a global
 * ~/.gitconfig, so `store` answers before the fixture's helper and the probe sees
 * whatever real credential happens to be cached: `x-access-token` while an App token
 * was cached (these tests passed), a human login once it was replaced (they failed).
 *
 * The fixture's helper must be the ONLY one, or the suite tests the machine it runs
 * on rather than the guard. CI passed throughout precisely because it has no cached
 * credential — the failure was invisible there.
 */
const ISOLATED_ENV = {
  ...process.env,
  // os.devNull, not a literal '/dev/null' — the latter is Unix-only and would
  // break a Windows run (#1146 review, low).
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
};

/**
 * Per-fixture environment, applied to every git invocation in that repo (#1141).
 *
 * The hook tests below drive a real `git push` at a LOCAL bare remote, which is
 * not an https URL and therefore carries no App installation token — so the real
 * probe correctly fails open there and cannot be what decides these cases. Before
 * this, nothing pinned the verdict at all, and the hook silently classified every
 * fixture by whatever username happened to be cached in the machine's global
 * credential store. That is why this file failed in BOTH directions depending on
 * the box: with `x-access-token` cached only the human test failed; with a human
 * login cached only the two App-blocking tests failed.
 *
 * MINSPEC_FAKE_APP_CRED pins it, so these tests prove what they claim to prove —
 * the HOOK's behaviour given a verdict — and nothing else. The verdict itself is
 * proven separately, against the real probe, in the second describe block.
 */
const repoEnv = new Map<string, NodeJS.ProcessEnv>();

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...ISOLATED_ENV, ...(repoEnv.get(cwd) ?? {}) },
  });
}

function mustGit(cwd: string, ...args: string[]) {
  const r = git(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

/**
 * A repo wired exactly like a MinSpec project: core.hooksPath=.githooks, the real
 * pre-push hook and its lib copied in, and a local bare remote to push at.
 *
 * `credentialIsApp` fakes the credential probe the way production sees it — git
 * hands an installation token the fixed username `x-access-token`.
 */
function makeRepo({ credentialIsApp }: { credentialIsApp: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-prepush-'));
  made.push(dir);
  const work = path.join(dir, 'work');
  const remote = path.join(dir, 'remote.git');

  mustGit(dir, 'init', '--bare', remote);
  fs.mkdirSync(work);
  mustGit(work, 'init', '--initial-branch', 'main');
  mustGit(work, 'config', 'user.email', 'test@example.com');
  mustGit(work, 'config', 'user.name', 'Test');
  mustGit(work, 'remote', 'add', 'origin', remote);

  // A credential helper that answers with the username production would see.
  // No real secret anywhere — the guard reads the username only.
  //
  // The EMPTY first entry is load-bearing (#1141). `credential.helper` is a
  // multi-valued config list evaluated system → global → local, and git stops at
  // the first helper that returns a complete credential. Setting only a repo-local
  // helper therefore does NOT give the fixture control: a machine with a global
  // `credential.helper = store` answers first, out of ~/.git-credentials. An empty
  // value resets the accumulated chain, so the helper appended after it is the one
  // that answers.
  const user = credentialIsApp ? 'x-access-token' : 'a-human';
  mustGit(work, 'config', 'credential.helper', '');
  mustGit(work, 'config', '--add', 'credential.helper', `!f() { echo username=${user}; echo password=x; }; f`);

  // See the repoEnv doc comment: the local bare remote is not https, so the real
  // probe fails open here by design. Pin the verdict so these cases test the hook.
  repoEnv.set(work, { MINSPEC_FAKE_APP_CRED: credentialIsApp ? '1' : '0' });

  fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(work, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, '.githooks/pre-push'), path.join(work, '.githooks/pre-push'));
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/lib/workflow-paths.sh'),
    path.join(work, 'scripts/lib/workflow-paths.sh'),
  );
  fs.chmodSync(path.join(work, '.githooks/pre-push'), 0o755);
  mustGit(work, 'config', 'core.hooksPath', '.githooks');

  fs.writeFileSync(path.join(work, 'seed.txt'), 'seed\n');
  mustGit(work, 'add', '-A');
  mustGit(work, 'commit', '-m', 'seed');
  mustGit(work, 'push', '-q', '-u', 'origin', 'main');
  return { work, remote };
}

function commitFile(work: string, rel: string, body = 'x\n') {
  const abs = path.join(work, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  mustGit(work, 'add', '-A');
  mustGit(work, 'commit', '-m', `add ${rel}`);
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe('pre-push blocks an App-credentialed workflow push', () => {
  it('is testing the real hook, not a copy that drifted (anti-vacuity)', () => {
    const hook = fs.readFileSync(path.resolve(repoRoot, '.githooks/pre-push'), 'utf8');
    const lib = fs.readFileSync(path.resolve(repoRoot, 'scripts/lib/workflow-paths.sh'), 'utf8');
    expect(hook).toContain('workflow-paths.sh');
    expect(lib).toContain('WORKFLOW_PATH_RE');
    // If core.hooksPath were unset in the fixture the hook would never run and
    // every "blocked" assertion below would silently invert to a pass.
    const { work } = makeRepo({ credentialIsApp: true });
    expect(mustGit(work, 'config', '--get', 'core.hooksPath')).toBe('.githooks');
  });

  it('refuses a push touching .github/workflows/ and names the remedy', () => {
    const { work } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/refresh');
    commitFile(work, '.github/workflows/ai-review.yml', 'name: ai-review\n');

    const res = git(work, 'push', '-u', 'origin', 'chore/refresh');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing to push/);
    expect(res.stderr).toMatch(/\.github\/workflows\/ai-review\.yml/);
    expect(res.stderr).toMatch(/workflows: write/);
    expect(res.stderr).toMatch(/MINSPEC_ALLOW_WORKFLOW_PUSH=1/);
  });

  it('actually prevents the ref reaching the remote', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/refresh');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    git(work, 'push', '-u', 'origin', 'chore/refresh');
    // The point of the guard: nothing landed. A message without this is theatre.
    expect(git(remote, 'rev-parse', '--verify', 'chore/refresh').status).not.toBe(0);
  });

  it('allows a workflow push under a HUMAN credential (never a new obstacle)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: false });
    mustGit(work, 'checkout', '-q', '-b', 'human/wf');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = git(work, 'push', '-u', 'origin', 'human/wf');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'human/wf').status).toBe(0);
  });

  it('allows an App push that touches no workflow file', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'feat/code');
    commitFile(work, 'packages/minspec/src/thing.ts', 'export const x = 1;\n');
    const res = git(work, 'push', '-u', 'origin', 'feat/code');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'feat/code').status).toBe(0);
  });

  it('honours the env escape hatch', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/override');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = spawnSync('git', ['push', '-u', 'origin', 'chore/override'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...ISOLATED_ENV, ...repoEnv.get(work), MINSPEC_ALLOW_WORKFLOW_PUSH: '1' },
    });
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/override').status).toBe(0);
  });

  it('honours the git-config escape hatch', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'config', 'minspec.allowWorkflowPush', 'true');
    mustGit(work, 'checkout', '-q', '-b', 'chore/cfg');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = git(work, 'push', '-u', 'origin', 'chore/cfg');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/cfg').status).toBe(0);
  });

  it('does not block a branch DELETION (no content to reject)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'tmp/gone');
    commitFile(work, 'note.txt');
    mustGit(work, 'push', '-q', '-u', 'origin', 'tmp/gone');
    mustGit(work, 'checkout', '-q', 'main');
    const res = git(work, 'push', 'origin', '--delete', 'tmp/gone');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'tmp/gone').status).not.toBe(0);
  });

  it('is inert when the lib is absent (partial checkout must still push)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    fs.rmSync(path.join(work, 'scripts/lib/workflow-paths.sh'));
    mustGit(work, 'checkout', '-q', '-b', 'chore/nolib');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    mustGit(work, 'add', '-A');
    const res = git(work, 'push', '-u', 'origin', 'chore/nolib');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/nolib').status).toBe(0);
  });
});

/**
 * T3 regression (#1141): the probe must read the credential THIS PUSH will use.
 *
 * The block above proves what the hook does given a verdict. This block proves the
 * verdict itself, against the real `push_credential_is_app_token` with no seam set
 * — because the defect was never in the hook, it was in how the verdict was
 * reached. The original probe asked for a hardcoded `https://github.com` and got
 * whatever the machine's global credential helper had cached, so it returned the
 * SAME answer for both fixtures and the suite silently inverted which half of the
 * guard it proved.
 *
 * These repos are never pushed, so they need no remote on disk — only a URL for
 * the probe to key on.
 */
describe('the credential probe reads the push credential, not the machine', () => {
  /** A repo with an https remote and a fixture-controlled credential chain. */
  function probeRepo(opts: { user?: string; url?: string; resetChain?: boolean }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-credprobe-'));
    made.push(dir);
    mustGit(dir, 'init', '--initial-branch', 'main');
    mustGit(dir, 'remote', 'add', 'origin', opts.url ?? 'https://github.com/fake/repo.git');
    if (opts.resetChain !== false) mustGit(dir, 'config', 'credential.helper', '');
    if (opts.user) {
      mustGit(
        dir,
        'config',
        '--add',
        'credential.helper',
        `!f() { echo username=${opts.user}; echo password=x; }; f`,
      );
    }
    return dir;
  }

  /** Run the REAL probe with the seam explicitly unset. `arg` is the target it
   *  would receive from the pre-push hook (remote name or URL). */
  function probe(cwd: string, extraEnv: NodeJS.ProcessEnv = {}, arg = '') {
    const env = { ...ISOLATED_ENV, ...extraEnv };
    delete env.MINSPEC_FAKE_APP_CRED;
    return spawnSync(
      'bash',
      [
        '-c',
        `. "${repoRoot}/scripts/lib/workflow-paths.sh"; ` +
          `if push_credential_is_app_token ${arg ? `'${arg}'` : ''}; then echo app; else echo not-app; fi`,
      ],
      { cwd, encoding: 'utf8', env, timeout: 15_000 },
    );
  }

  it('classifies an App installation token as App', () => {
    const r = probe(probeRepo({ user: 'x-access-token' }));
    expect(r.stdout.trim(), r.stderr).toBe('app');
  });

  it('classifies a human credential as NOT App (never a new obstacle)', () => {
    const r = probe(probeRepo({ user: 'a-human' }));
    expect(r.stdout.trim(), r.stderr).toBe('not-app');
  });

  /**
   * The assertion the original file was missing entirely, and the direct
   * reproduction of #1141. Its anti-vacuity test checked `core.hooksPath` — the one
   * precondition that cannot be silently overridden — and never checked the one
   * that could.
   *
   * Determinism matters here: an earlier draft of this test asserted
   * `expect(['app','not-app']).toContain(result)`, which is a tautology and proves
   * nothing. Instead of depending on whatever the real machine has cached, this
   * INJECTS a hostile global helper via GIT_CONFIG_GLOBAL, so the preemption is
   * reproduced identically on every box — including a CI runner with no global
   * credential config at all, where the bug would otherwise be invisible.
   */
  it('a global helper preempts an unreset chain — and the reset defeats it', () => {
    const hostile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitcfg-')), 'gitconfig');
    made.push(path.dirname(hostile));
    fs.writeFileSync(
      hostile,
      '[credential]\n\thelper = "!f() { echo username=ambient-human; echo password=x; }; f"\n',
    );
    const withHostileGlobal = { GIT_CONFIG_GLOBAL: hostile };

    // Chain NOT reset: git walks global -> local and stops at the first helper that
    // answers, so the ambient credential decides and the App fixture is misread as
    // human. This is the bug, reproduced.
    const unreset = probe(
      probeRepo({ user: 'x-access-token', resetChain: false }),
      withHostileGlobal,
    );
    expect(unreset.stdout.trim(), unreset.stderr).toBe('not-app');

    // Same hostile global, same fixture — but the empty first entry resets the
    // accumulated chain, so the fixture's helper is the one that answers.
    const reset = probe(probeRepo({ user: 'x-access-token' }), withHostileGlobal);
    expect(reset.stdout.trim(), reset.stderr).toBe('app');
  });

  it('fails open on a non-https remote (ssh//file cannot carry an App token)', () => {
    expect(probe(probeRepo({ user: 'x-access-token', url: 'git@github.com:fake/repo.git' })).stdout.trim())
      .toBe('not-app');
    expect(probe(probeRepo({ user: 'x-access-token', url: '/tmp/some/bare.git' })).stdout.trim())
      .toBe('not-app');
  });

  /**
   * git hands pre-push the target as $1 (remote name) and $2 (resolved URL). The
   * hook previously forwarded neither, so the probe always keyed on `origin` — and
   * `git push upstream …`, or a bare-URL push, was judged by a remote it was not
   * going to use.
   */
  it('honours a non-origin remote NAME', () => {
    const dir = probeRepo({ user: 'a-human' }); // origin = human
    mustGit(dir, 'remote', 'add', 'upstream', 'https://github.com/other/repo.git');
    // The helper answers for any host, so a different remote must still resolve —
    // what is under test is that the ARGUMENT is used at all, not ignored.
    expect(probe(dir, {}, 'upstream').stdout.trim()).toBe('not-app');

    const appDir = probeRepo({ user: 'x-access-token' });
    mustGit(appDir, 'remote', 'add', 'upstream', 'https://github.com/other/repo.git');
    expect(probe(appDir, {}, 'upstream').stdout.trim()).toBe('app');
  });

  it('honours a bare URL target (git push https://… main)', () => {
    const dir = probeRepo({ user: 'x-access-token' });
    expect(probe(dir, {}, 'https://github.com/any/repo.git').stdout.trim()).toBe('app');
    // A non-https bare URL still fails open.
    expect(probe(dir, {}, 'git@github.com:any/repo.git').stdout.trim()).toBe('not-app');
  });

  /**
   * Verified, not assumed (the comment in workflow-paths.sh used to claim more than
   * this): a token in the push URL's userinfo IS visible to `git credential fill`,
   * and only because the probe now keys on the real push URL.
   */
  it('sees an App token embedded in the push URL userinfo', () => {
    const dir = probeRepo({}); // chain reset, no helper at all
    expect(
      probe(dir, {}, 'https://x-access-token:SECRET@github.com/o/r.git').stdout.trim(),
    ).toBe('app');
    expect(probe(dir, {}, 'https://a-human:SECRET@github.com/o/r.git').stdout.trim()).toBe(
      'not-app',
    );
  });

  /**
   * The hook must FORWARD the target git gave it. Covering the function's argument
   * handling alone is not enough: reverting the hook's forwarding left every other
   * test in this file green, which is precisely the vacuity trap this PR is about.
   *
   * Shape that discriminates: `origin` is a local bare repo (non-https, so the probe
   * fails open on it) while `upstream` is https with an App credential. Pushing to
   * `upstream` must be REFUSED — which can only happen if the hook passed `upstream`
   * through. Without forwarding it probes `origin`, fails open, and lets the push
   * proceed.
   *
   * The hook is INVOKED DIRECTLY, with the argv and stdin git uses, rather than via
   * a real `git push`. That is deliberate and not a shortcut: git contacts the remote
   * to enumerate refs BEFORE it runs pre-push, so an https remote git cannot reach
   * fails at connection time and the hook never executes — an end-to-end version of
   * this test passes and fails for the wrong reason. Reaching a real https remote
   * would also put the suite on the network, against constitution invariant 1.
   * Everything downstream of argv is still the real hook and the real probe.
   */
  it('the HOOK forwards the target remote, not just origin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-fwd-'));
    made.push(dir);
    const work = path.join(dir, 'work');
    const localRemote = path.join(dir, 'remote.git');
    mustGit(dir, 'init', '--bare', localRemote);
    fs.mkdirSync(work);
    mustGit(work, 'init', '--initial-branch', 'main');
    mustGit(work, 'config', 'user.email', 'test@example.com');
    mustGit(work, 'config', 'user.name', 'Test');
    mustGit(work, 'remote', 'add', 'origin', localRemote);
    mustGit(work, 'remote', 'add', 'upstream', 'https://127.0.0.1:1/fake/up.git');
    mustGit(work, 'config', 'credential.helper', '');
    mustGit(
      work,
      'config',
      '--add',
      'credential.helper',
      '!f() { echo username=x-access-token; echo password=x; }; f',
    );

    fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
    fs.mkdirSync(path.join(work, 'scripts/lib'), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, '.githooks/pre-push'), path.join(work, '.githooks/pre-push'));
    fs.copyFileSync(
      path.join(repoRoot, 'scripts/lib/workflow-paths.sh'),
      path.join(work, 'scripts/lib/workflow-paths.sh'),
    );
    fs.chmodSync(path.join(work, '.githooks/pre-push'), 0o755);
    mustGit(work, 'config', 'core.hooksPath', '.githooks');

    fs.writeFileSync(path.join(work, 'seed.txt'), 'seed\n');
    mustGit(work, 'add', '-A');
    mustGit(work, 'commit', '-m', 'seed');
    mustGit(work, 'push', '-q', '-u', 'origin', 'main');

    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const sha = mustGit(work, 'rev-parse', 'HEAD');
    const zero = '0'.repeat(40);

    // No seam — this must exercise the real probe.
    const env = { ...ISOLATED_ENV };
    delete env.MINSPEC_FAKE_APP_CRED;

    /** Invoke the hook the way git does: argv = (remote, url), refs on stdin. */
    const runHook = (remote: string, url: string) =>
      spawnSync(path.join(work, '.githooks/pre-push'), [remote, url], {
        cwd: work,
        encoding: 'utf8',
        env,
        input: `refs/heads/main ${sha} refs/heads/main ${zero}\n`,
        timeout: 30_000,
      });

    // Target = upstream (https, App credential) -> must refuse.
    const blocked = runHook('upstream', 'https://127.0.0.1:1/fake/up.git');
    expect(blocked.status, blocked.stderr).not.toBe(0);
    expect(blocked.stderr).toMatch(/refusing to push/);

    // Target = origin (local bare, not https) -> nothing to gate, must pass.
    const allowed = runHook('origin', localRemote);
    expect(allowed.status, allowed.stderr).toBe(0);
  });

  it('fails open when the remote does not exist at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-credprobe-'));
    made.push(dir);
    mustGit(dir, 'init', '--initial-branch', 'main');
    expect(probe(dir).stdout.trim()).toBe('not-app');
  });

  it('honours the MINSPEC_FAKE_APP_CRED seam when SOURCED, not only when executed', () => {
    // The seam used to live inside the `--check` block, reachable only when the
    // lib was EXECUTED — so the hook, which SOURCES it, could never be pinned.
    const dir = probeRepo({ user: 'a-human' });
    const forced = spawnSync(
      'bash',
      [
        '-c',
        `. "${repoRoot}/scripts/lib/workflow-paths.sh"; ` +
          'if push_credential_is_app_token; then echo app; else echo not-app; fi',
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...ISOLATED_ENV, MINSPEC_FAKE_APP_CRED: '1' },
        timeout: 15_000,
      },
    );
    expect(forced.stdout.trim(), forced.stderr).toBe('app');
  });

  /**
   * Verified under a real PTY rather than asserted against the source text.
   * Without GIT_TERMINAL_PROMPT=0, git writes `Username for 'https://…': ` to
   * /dev/tty — which the probe's `2>/dev/null` cannot suppress, because it is not
   * stderr. Where git can read from the tty it blocks there instead.
   */
  it('never writes a credential prompt to the terminal when no helper can answer', (ctx) => {
    // `script -qec CMD FILE` is util-linux syntax. macOS/BSD ship a different
    // script(1) whose argument order differs, so probe for the flavour rather than
    // failing on a developer's Mac. Skipped, never silently passed — a skip is
    // visible in the report, a green stub is not.
    const flavour = spawnSync('script', ['--version'], { encoding: 'utf8' });
    if (flavour.status !== 0 || !/util-linux/.test(flavour.stdout ?? '')) {
      ctx.skip();
      return;
    }

    // script(1) runs its command through $SHELL, falling back to /bin/sh. That made
    // this test depend on the AMBIENT shell of whoever launched vitest: bash from an
    // interactive terminal (green), /bin/sh -> dash from the VS Code extension host
    // (red). workflow-paths.sh is bash — `${BASH_SOURCE[0]}` alone makes dash exit
    // with "Bad substitution" — so under the Testing panel this test failed with
    //   expected 'sh: 183: …' to match /not-app/
    // while passing from the CLI. Production is unaffected: .githooks/pre-push
    // carries `#!/usr/bin/env bash`, so git never runs the lib under dash.
    //
    // The earlier guard checked that script EXISTS and is util-linux — a precondition
    // this test already controlled — and never the one that actually varied: which
    // shell the command would run under. Naming bash explicitly removes the variable
    // rather than detecting it. Via a temp file, not `bash -c "…"`, so the snippet
    // needs no second level of quoting inside script's own argument.
    const dir = probeRepo({}); // chain reset, no helper appended
    const snippet = path.join(dir, 'probe.sh');
    fs.writeFileSync(
      snippet,
      '#!/usr/bin/env bash\n' +
        `. "${repoRoot}/scripts/lib/workflow-paths.sh"\n` +
        'push_credential_is_app_token && echo app || echo not-app\n',
    );

    const r = spawnSync('script', ['-qec', `bash ${snippet}`, '/dev/null'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 15_000,
    });
    const seen = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // Fail loudly if the harness itself broke, rather than letting a shell error
    // satisfy "no prompt appeared" and turn this green for the wrong reason.
    expect(seen, 'script/bash harness did not run').not.toMatch(/Bad substitution|not found/);
    expect(seen).not.toMatch(/Username for/);
    expect(seen).toMatch(/not-app/);
  });
});
