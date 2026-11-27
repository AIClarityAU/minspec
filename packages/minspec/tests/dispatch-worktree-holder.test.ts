/**
 * #3909 / SPEC-384 - a re-dispatch of an issue whose earlier agent worktree still holds
 * agent/issue-N used to die at `git worktree add` with rc=128 ("'agent/issue-N' is already
 * used by worktree at '/tmp/minspec-agent/issue-N-<old sid>'"), every cycle, until an
 * outside sweep removed the registration. Measured 2026-11-27: two consecutive drain cycles
 * failed outright on #1267, #1485 and #1508.
 *
 * The cleanup in dispatch-issue.sh only ever looked at THIS session's claim-unique path, and
 * nothing asked git which worktree already had the branch checked out. These tests drive the
 * holder check in scripts/lib/issue-branch.sh against real git repos in a tmpdir, and pin
 * where dispatch-issue.sh calls it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const BRANCH_LIB = path.join(SCRIPTS, 'lib/issue-branch.sh');
const WT_LIB = path.join(SCRIPTS, 'lib/agent-worktree.sh');
const DISPATCH = path.join(SCRIPTS, 'dispatch-issue.sh');
const BR = 'agent/issue-7';

let tmp: string, repo: string, base: string, holder: string;

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync('git', a, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function sh(script: string) {
  return spawnSync('bash', ['-c', `set -u; source "${BRANCH_LIB}"; source "${WT_LIB}"; ${script}`], {
    encoding: 'utf-8',
  });
}
function commit(cwd: string, file: string) {
  fs.writeFileSync(path.join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file);
}
/** The holder check, as dispatch-issue.sh calls it. Returns [stdout fields, result]. */
function plan(witness = 'claim', issue = '7') {
  const r = sh(`issue_branch_holder_plan "${repo}" ${BR} "${base}" ${issue} ${witness}`);
  return { fields: r.stdout.replace(/\n$/, '').split('\t'), r };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-holder-')));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  base = path.join(tmp, 'minspec-agent');
  fs.mkdirSync(base);
  holder = path.join(base, 'issue-7-sid-111-222');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  // The crashed/finished earlier dispatch: its worktree, holding the branch, with a commit.
  git(repo, 'worktree', 'add', '-q', '-b', BR, holder, 'origin/main');
  commit(holder, 'earlier-work');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('T3 #3909: a registered worktree holding agent/issue-N', () => {
  it('reproduces the rc=128 the drain logged when a fresh worktree is added for the branch', () => {
    const r = spawnSync('git', ['-C', repo, 'worktree', 'add', path.join(base, 'issue-7-sid-333-444'), BR], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(128);
    expect(r.stderr).toContain(`'${BR}' is already used by worktree at '${holder}'`);
  });

  it('dead owner, folder present: the plan is to reuse that worktree in place (D1 a)', () => {
    const { fields, r } = plan();
    expect(r.status, r.stderr).toBe(0);
    expect(fields).toEqual(['reuse', holder]);
  });
});

describe('issue_branch_holder_plan: every other holder state', () => {
  it('no holder at all: none, so the dispatch behaves exactly as before (AC-6)', () => {
    git(repo, 'worktree', 'remove', holder);
    const { fields, r } = plan();
    expect(r.status, r.stderr).toBe(0);
    expect(fields).toEqual(['none']);
  });

  it('folder gone: prune that one registration, and only that one (AC-2, blast radius)', () => {
    const other = path.join(tmp, 'someone-elses-checkout');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', other, 'origin/main');
    fs.rmSync(holder, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
    const { fields, r } = plan();
    expect(r.status, r.stderr).toBe(0);
    expect(fields).toEqual(['prune', holder]);
    // The step dispatch-issue.sh runs for `prune` (launcher_git there; plain git here).
    git(repo, 'worktree', 'remove', holder);
    const list = git(repo, 'worktree', 'list', '--porcelain');
    expect(list).not.toContain(holder);
    expect(list, 'another missing registration is not this dispatch\'s to drop').toContain(other);
    // The branch and its commit survive (AC-7), and a fresh worktree can now be added.
    git(repo, 'worktree', 'add', '-q', path.join(base, 'issue-7-sid-333-444'), BR);
    expect(fs.existsSync(path.join(base, 'issue-7-sid-333-444', 'earlier-work'))).toBe(true);
  });

  it('no claim witness (MINSPEC_CLAIM_OFF): liveness unknown, so defer and touch nothing (FR-5, AC-5)', () => {
    const { fields, r } = plan('none');
    expect(r.status, r.stderr).toBe(0);
    expect(fields[0]).toBe('defer');
    expect(fields[1]).toBe(holder);
    expect(fields[2]).toMatch(/liveness/);
    expect(fs.existsSync(path.join(holder, 'earlier-work'))).toBe(true);
  });

  it('a holder outside the dispatcher\'s worktree base is in flight, never touched (D3)', () => {
    const human = path.join(tmp, 'human-checkout');
    git(repo, 'worktree', 'remove', holder);
    git(repo, 'worktree', 'add', '-q', human, BR);
    const { fields } = plan();
    expect(fields.slice(0, 2)).toEqual(['defer', human]);
    expect(fields[2]).toMatch(/outside/);
  });

  it('a holder named like a dispatch worktree but outside the base is still deferred (D3)', () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const lookalike = path.join(elsewhere, 'issue-7-sid-111-222');
    git(repo, 'worktree', 'remove', holder);
    git(repo, 'worktree', 'add', '-q', lookalike, BR);
    const { fields } = plan();
    expect(fields.slice(0, 2)).toEqual(['defer', lookalike]);
    expect(fields[2]).toMatch(/outside/);
  });

  it('a holder whose folder is gone but sits outside the base is deferred, not pruned', () => {
    const human = path.join(tmp, 'human-checkout');
    git(repo, 'worktree', 'remove', holder);
    git(repo, 'worktree', 'add', '-q', human, BR);
    fs.rmSync(human, { recursive: true, force: true });
    expect(plan().fields.slice(0, 2)).toEqual(['defer', human]);
  });

  it('a holder under the base named for another issue is deferred (issue-7 is not issue-77)', () => {
    const { fields } = plan('claim', '77');
    expect(fields[0]).toBe('defer');
  });

  it('a locked holder is deferred', () => {
    git(repo, 'worktree', 'lock', holder);
    const { fields } = plan();
    expect(fields.slice(0, 2)).toEqual(['defer', holder]);
    expect(fields[2]).toMatch(/locked/);
  });

  it('a holder whose .git file no longer names the repository\'s record is deferred (an agent could rewrite it)', () => {
    const evil = path.join(tmp, 'evil-gitdir');
    fs.mkdirSync(evil);
    fs.writeFileSync(path.join(holder, '.git'), `gitdir: ${evil}\n`);
    const { fields } = plan();
    expect(fields.slice(0, 2)).toEqual(['defer', holder]);
    expect(fields[2]).toMatch(/\.git/);
  });

  it('a worktree a gate held for a human (quarantine, workflow push) is deferred, never reused', () => {
    // #1485 on 2026-11-26: quarantined by the egress guard, but the label write failed, so
    // the issue stayed agent-ready. The marker in the worktree's git directory is the
    // second witness that keeps a reuse from running a new agent over held output.
    const gd = git(holder, 'rev-parse', '--absolute-git-dir');
    const m = sh(`issue_branch_mark_held "${gd}" "quarantined by the pre-publish egress guard (#358)"`);
    expect(m.status, m.stderr).toBe(0);
    expect(fs.existsSync(path.join(gd, 'minspec-held'))).toBe(true);
    expect(git(holder, 'status', '--porcelain'), 'the marker is outside the tree').toBe('');
    const { fields } = plan();
    expect(fields.slice(0, 2)).toEqual(['defer', holder]);
    expect(fields[2]).toBe('held for a human by an earlier dispatch: quarantined by the pre-publish egress guard (#358)');
  });

  it('issue_branch_mark_held with no git directory fails loudly', () => {
    const r = sh(`issue_branch_mark_held "" "x"`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no git directory/);
  });

  it('a git failure listing worktrees is an error, never "none" (invariant 2)', () => {
    const r = sh(`issue_branch_holder_plan "${path.join(tmp, 'not-a-repo')}" ${BR} "${base}" 7 claim`);
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toMatch(/could not list/);
  });
});

describe('issue_branch_set_aside_artifacts: reuse never discards, and never posts a stale summary', () => {
  it('moves the previous run\'s dispatcher files out of the tree and leaves every byte of work (AC-3)', () => {
    fs.writeFileSync(path.join(holder, 'earlier-work'), 'modified, uncommitted');
    fs.writeFileSync(path.join(holder, 'untracked.txt'), 'untracked');
    fs.writeFileSync(path.join(holder, '.agent-summary.md'), 'old summary');
    fs.writeFileSync(path.join(holder, '.review-signals.json'), '{"old":true}');
    fs.writeFileSync(path.join(holder, '.agent.log'), 'old log');
    const aside = path.join(tmp, 'aside');
    const r = sh(`issue_branch_set_aside_artifacts "${holder}" "${aside}"`);
    expect(r.status, r.stderr).toBe(0);
    const dest = r.stdout.trim();
    expect(dest.startsWith(`${aside}/issue-7-sid-111-222-`)).toBe(true);
    expect(fs.readFileSync(path.join(dest, '.agent-summary.md'), 'utf-8')).toBe('old summary');
    expect(fs.readFileSync(path.join(dest, '.review-signals.json'), 'utf-8')).toBe('{"old":true}');
    expect(fs.readFileSync(path.join(dest, '.agent.log'), 'utf-8')).toBe('old log');
    for (const f of ['.agent-summary.md', '.review-signals.json', '.agent.log']) {
      expect(fs.existsSync(path.join(holder, f)), f).toBe(false);
    }
    expect(fs.readFileSync(path.join(holder, 'earlier-work'), 'utf-8')).toBe('modified, uncommitted');
    expect(fs.readFileSync(path.join(holder, 'untracked.txt'), 'utf-8')).toBe('untracked');
    expect(git(holder, 'branch', '--show-current')).toBe(BR);
  });

  it('nothing to set aside is not an error', () => {
    const r = sh(`issue_branch_set_aside_artifacts "${holder}" "${path.join(tmp, 'aside')}"`);
    expect(r.status, r.stderr).toBe(0);
  });

  it('a destination that cannot be made fails loudly and moves nothing', () => {
    fs.writeFileSync(path.join(holder, '.agent-summary.md'), 'old summary');
    const blocker = path.join(tmp, 'aside-is-a-file');
    fs.writeFileSync(blocker, '');
    const r = sh(`issue_branch_set_aside_artifacts "${holder}" "${blocker}"`);
    expect(r.status).not.toBe(0);
    expect(fs.readFileSync(path.join(holder, '.agent-summary.md'), 'utf-8')).toBe('old summary');
  });
});

describe('dispatch-issue.sh wiring (#3909)', () => {
  const src = fs.readFileSync(DISPATCH, 'utf-8');
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };

  it('asks for the holder plan after the claim is won and before "started" is claimed', () => {
    const acquire = at('lease_acquire "$ISSUE"');
    const planCall = at('issue_branch_holder_plan "$REPO_ROOT" "$BRANCH" "$WORKTREE_BASE" "$ISSUE"');
    const claimed = at('\nDISPATCH_CLAIMED=1\n');
    expect(acquire).toBeLessThan(planCall);
    expect(planCall).toBeLessThan(claimed);
  });

  it('a failed holder check stops the dispatch; it is never swallowed', () => {
    const line = src.split('\n').find((l) => l.includes('issue_branch_holder_plan "$REPO_ROOT"'))!;
    expect(line).not.toMatch(/\|\|\s*true/);
    expect(line).toMatch(/\|\| \{|^\s*if ! /);
  });

  it('a deferred holder exits through exit_declined (not counted as a failed dispatch)', () => {
    const planCall = at('issue_branch_holder_plan "$REPO_ROOT"');
    const claimed = at('\nDISPATCH_CLAIMED=1\n');
    const block = src.slice(planCall, claimed);
    expect(block).toMatch(/defer\)[\s\S]*?exit_declined/);
  });

  it.each(['quarantine_publish', 'hold_specify_scope', 'hold_workflow_push'])(
    '%s records the hold in the worktree git directory, so no later dispatch reuses it',
    (fn) => {
      const start = at(`\n${fn}() {\n`);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      expect(body).toContain('issue_branch_mark_held "$AGENT_WORKTREE_GIT_DIR" ');
    },
  );

  it('a reused holder becomes the worktree and is not added again', () => {
    expect(src).toContain('WORKTREE="$HOLDER_PATH"');
    const reuse = at('if [[ "$HOLDER_ACTION" == "reuse" ]]; then');
    const add = at('launcher_git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE" origin/main');
    expect(reuse).toBeLessThan(add);
  });
});
