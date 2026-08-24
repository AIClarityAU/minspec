/**
 * approval-recover.test.ts — #1115, one-click recovery from the `protected-branch`
 * refusal.
 *
 * The invariants are tested against a RECORDING STUB runner, so INV-1 ("never moves
 * the primary checkout") is asserted on the actual argv the module would have run,
 * not by reading the source. That distinction is the whole point: a source-text
 * assertion passes even after someone adds a `git checkout`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  recoverProtectedBranchApproval,
  type GitRun,
  type RecoverResult,
} from '../src/lib/approval-recover';

/** git subcommands that would move or rewrite the shared checkout (INV-1). */
const HEAD_MOVING = ['checkout', 'switch', 'merge', 'rebase', 'reset', 'cherry-pick'];

interface Recorder {
  readonly calls: string[][];
  /** `cwd` for the call at the same index — lets a test assert WHERE a step ran. */
  readonly cwds: Array<string | undefined>;
  readonly run: GitRun;
}

/**
 * A stub runner. `fail` maps the first token of a call to an error, so a test can
 * make exactly one step fail without hand-writing a whole runner.
 */
function recorder(opts: { fail?: Record<string, unknown>; noDelta?: boolean } = {}): Recorder {
  const calls: string[][] = [];
  const cwds: Array<string | undefined> = [];
  const run: GitRun = async (args, o) => {
    calls.push([...args]);
    cwds.push(o?.cwd);
    const key = args[0] ?? '';
    if (opts.fail && key in opts.fail) throw opts.fail[key];
    if (key === 'remote') return 'https://github.com/OWNER/REPO.git\n';
    // The approval commit's SHA (#1653 review). Distinctive so a test can prove the
    // value reaching the PR body came from HERE and not from the primary's HEAD.
    if (key === 'rev-parse') return 'c0ffee1234567890\n';
    // `diff --cached --quiet` REJECTS when there IS a delta — so resolving means
    // "no delta". Default to a delta (reject) unless the test asks otherwise.
    if (key === 'diff') {
      if (opts.noDelta) return '';
      throw new Error('has staged changes');
    }
    return '';
  };
  return { calls, cwds, run };
}

/** A temp dir holding the two approval files, plus their absolute paths. */
function fixture(): { root: string; absPaths: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-fixture-'));
  const spec = path.join(root, 'specs/minspec/SPEC-099-x/requirements.md');
  const rec = path.join(root, '.minspec/approvals/specs/minspec/SPEC-099-x/requirements.md.json');
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.mkdirSync(path.dirname(rec), { recursive: true });
  fs.writeFileSync(spec, '---\nid: SPEC-099\n---\n');
  fs.writeFileSync(rec, '{"specHash":"deadbeef"}');
  return { root, absPaths: [spec, rec] };
}

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recover-wt-'));
}

const OPTS = { slug: 'SPEC-099', now: new Date('2026-08-05T12:00:00.000Z') };

async function recover(
  r: Recorder,
  fx = fixture(),
  extra: Record<string, unknown> = {},
): Promise<RecoverResult> {
  return recoverProtectedBranchApproval(fx.root, fx.absPaths, 'chore(approve): SPEC-099', { ...OPTS, ...extra }, {
    run: r.run,
    mkTempDir: mkTemp,
  });
}

describe('recoverProtectedBranchApproval — #1115', () => {
  it('recovers: branches off origin/main, commits the approval, pushes, returns a compare URL', async () => {
    const r = recorder();
    const res = await recover(r);
    expect(res.outcome).toBe('recovered');
    expect(res.branch).toMatch(/^approvals\/spec-099-/);
    expect(res.compareUrl).toBe(
      `https://github.com/OWNER/REPO/compare/${encodeURIComponent(res.branch!)}?expand=1`,
    );
    expect(res.paths).toHaveLength(2);
  });

  it('INV-1: NEVER runs a command that moves the primary checkout — asserted on recorded argv', async () => {
    const r = recorder();
    await recover(r);
    const used = r.calls.map((c) => c[0]);
    for (const forbidden of HEAD_MOVING) expect(used).not.toContain(forbidden);
    // The only mutation of the primary is `fetch` (a remote-tracking ref) and
    // `worktree add`/`remove` (a separate worktree with a separate index).
    const primaryOps = new Set(used);
    // `rev-parse` joined this set in #1653: the approval commit's SHA must be read
    // for the PR body, and it exists ONLY in the ephemeral worktree. It is read-only
    // by construction — it cannot move any ref — so it does not weaken the invariant.
    // The next assertion pins the stronger property the exact-set alone cannot: that
    // it ran in the WORKTREE, never in the primary checkout.
    expect(primaryOps).toEqual(
      new Set(['remote', 'fetch', 'worktree', 'add', 'diff', 'commit', 'push', 'rev-parse']),
    );
  });

  it('INV-1 (#1653): the SHA probe runs in the WORKTREE, never in the primary checkout', async () => {
    const r = recorder();
    const fx = fixture();
    await recover(r, fx);
    const i = r.calls.findIndex((c) => c[0] === 'rev-parse');
    expect(i).toBeGreaterThanOrEqual(0);
    // Reading HEAD in the primary would return the BASE tip — the exact wrong-SHA
    // defect the review caught — and would also make the probe meaningless here.
    expect(r.cwds[i]).not.toBe(fx.root);
    expect(r.cwds[i]).toContain('recover-wt-');
  });

  it('#1653: a recovered result carries the approval commit SHA', async () => {
    const res = await recover(recorder());
    expect(res.outcome).toBe('recovered');
    expect(res.sha).toBe('c0ffee1234567890');
  });

  it('INV-1: stages ONLY the approval paths — never a blanket add -A', async () => {
    const r = recorder();
    await recover(r);
    const add = r.calls.find((c) => c[0] === 'add')!;
    expect(add).toContain('--');
    expect(add).not.toContain('-A');
    expect(add).not.toContain('--all');
    // Exactly the two fixture paths follow the `--` separator.
    expect(add.slice(add.indexOf('--') + 1)).toHaveLength(2);
  });

  it('INV-3: never writes an approval record, a sidecar, or a status: line', async () => {
    const fx = fixture();
    const before = fs.readFileSync(fx.absPaths[0], 'utf-8');
    const beforeRec = fs.readFileSync(fx.absPaths[1], 'utf-8');
    await recover(recorder(), fx);
    expect(fs.readFileSync(fx.absPaths[0], 'utf-8')).toBe(before);
    expect(fs.readFileSync(fx.absPaths[1], 'utf-8')).toBe(beforeRec);
  });

  it('commits with DR_INDEX_GATE_OFF only — the pure-bash gates stay live', async () => {
    const calls: Array<{ args: string[]; env?: Record<string, string> }> = [];
    const run: GitRun = async (args, opts) => {
      calls.push({ args: [...args], env: opts?.env });
      if (args[0] === 'remote') return 'git@github.com:OWNER/REPO.git\n';
      if (args[0] === 'diff') throw new Error('delta');
      return '';
    };
    const fx = fixture();
    await recoverProtectedBranchApproval(fx.root, fx.absPaths, 'chore(approve): x', OPTS, {
      run,
      mkTempDir: mkTemp,
    });
    const commit = calls.find((c) => c.args[0] === 'commit')!;
    expect(commit.env).toEqual({ DR_INDEX_GATE_OFF: '1' });
    // --no-verify would disable the DR-029 and RCDD gates too — it must never appear.
    expect(commit.args).not.toContain('--no-verify');
  });

  describe('INV-2 — every failure is a typed result, never a throw', () => {
    it('no origin remote → no-remote, and NO network call is attempted', async () => {
      const r = recorder({ fail: { remote: new Error('no such remote') } });
      const res = await recover(r);
      expect(res.outcome).toBe('no-remote');
      expect(r.calls.map((c) => c[0])).not.toContain('fetch');
      expect(r.calls.map((c) => c[0])).not.toContain('push');
    });

    it('a network failure on fetch → offline (classified, not a generic failure)', async () => {
      const r = recorder({ fail: { fetch: { stderr: 'fatal: could not resolve host: github.com' } } });
      const res = await recover(r);
      expect(res.outcome).toBe('offline');
    });

    it('a network failure on push → offline', async () => {
      const r = recorder({ fail: { push: { stderr: 'fatal: unable to access ... Connection timed out' } } });
      const res = await recover(r);
      expect(res.outcome).toBe('offline');
    });

    it('a hook rejection on commit → failed, carrying the hook stderr', async () => {
      const r = recorder({ fail: { commit: { stderr: '✖ DR-029 gate: new DR born accepted' } } });
      const res = await recover(r);
      expect(res.outcome).toBe('failed');
      expect(res.error).toContain('DR-029');
    });

    it('a non-Error thrown by the FIRST step is caught by that step, not the backstop', async () => {
      // Renamed after review on #1255: the previous name claimed to exercise the
      // outer INV-2 backstop, but `remote` has its own catch so it never got there.
      // A test whose name overstates what it covers is worse than no test.
      const run: GitRun = async () => {
        throw { toString: () => 'weird non-Error' };
      };
      const fx = fixture();
      const res = await recoverProtectedBranchApproval(fx.root, fx.absPaths, 'm', OPTS, {
        run,
        mkTempDir: mkTemp,
      });
      expect(res.outcome).toBe('no-remote');
    });

    it('INV-2 backstop: a throw from OUTSIDE any step-local catch still returns a typed result', async () => {
      // mkTempDir sits between the `fetch` catch and the worktree catch, so it is
      // the one seam reaching the function-level backstop. Verified by construction:
      // if the backstop were removed this rejects instead of resolving.
      const fx = fixture();
      const res = await recoverProtectedBranchApproval(fx.root, fx.absPaths, 'm', OPTS, {
        run: recorder().run,
        mkTempDir: () => {
          throw new Error('ENOSPC: no space left on device');
        },
      });
      expect(res.outcome).toBe('failed');
      expect(res.error).toContain('ENOSPC');
    });
  });

  it('#1255: honours an explicit baseBranch — recovery is not hardcoded to main', async () => {
    // The destination guard protects main/master/trunk, so a master-default repo
    // must fetch and branch off `master`. Defaulting to `main` made the whole
    // feature silently inert there.
    const r = recorder();
    await recover(r, fixture(), { baseBranch: 'master' });
    const fetch = r.calls.find((c) => c[0] === 'fetch')!;
    expect(fetch).toStrictEqual(['fetch', 'origin', 'master']);
    const add = r.calls.find((c) => c[0] === 'worktree')!;
    expect(add).toContain('origin/master');
    expect(add).not.toContain('origin/main');
  });

  it('no delta vs the base → nothing-to-commit, and NO empty commit is made', async () => {
    const r = recorder({ noDelta: true });
    const res = await recover(r);
    expect(res.outcome).toBe('nothing-to-commit');
    expect(r.calls.map((c) => c[0])).not.toContain('commit');
    expect(r.calls.map((c) => c[0])).not.toContain('push');
  });

  it('drops a path that does not exist, and reports nothing-to-commit when none do', async () => {
    const fx = fixture();
    const missing = path.join(fx.root, 'specs/minspec/GONE/requirements.md');
    const r = recorder();
    const res = await recoverProtectedBranchApproval(fx.root, [missing], 'm', OPTS, {
      run: r.run,
      mkTempDir: mkTemp,
    });
    expect(res.outcome).toBe('nothing-to-commit');
    expect(r.calls).toHaveLength(0); // refused before any git ran
  });

  it('never transports a path resolving OUTSIDE the repo root', async () => {
    const fx = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    const evil = path.join(outside, 'secrets.md');
    fs.writeFileSync(evil, 'nope');
    const r = recorder();
    const res = await recoverProtectedBranchApproval(fx.root, [evil], 'm', OPTS, {
      run: r.run,
      mkTempDir: mkTemp,
    });
    expect(res.outcome).toBe('nothing-to-commit');
    expect(r.calls).toHaveLength(0);
  });

  it('the worktree is always removed, even when a step fails', async () => {
    const r = recorder({ fail: { push: { stderr: 'boom' } } });
    const res = await recover(r);
    expect(res.outcome).toBe('failed');
    const removes = r.calls.filter((c) => c[0] === 'worktree' && c[1] === 'remove');
    expect(removes).toHaveLength(1);
  });

  it('branch names are deterministic given `now`, and collision-free across approvals', async () => {
    const a = await recover(recorder(), fixture(), { now: new Date('2026-08-05T12:00:00.000Z') });
    const b = await recover(recorder(), fixture(), { now: new Date('2026-08-05T12:00:00.001Z') });
    expect(a.branch).not.toBe(b.branch);
    const again = await recover(recorder(), fixture(), { now: new Date('2026-08-05T12:00:00.000Z') });
    expect(again.branch).toBe(a.branch);
  });
});
