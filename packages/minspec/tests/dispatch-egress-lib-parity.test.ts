/**
 * T3 — regression: `dispatch-issue.sh`'s `run_egress_guard` must stay a thin
 * delegate to `scripts/lib/agent-egress.sh::agent_egress_scan`, never re-grow its
 * own inline copy of the scan (#358, #743).
 *
 * PR #743 extracted the pre-publish egress-guard orchestration into
 * `scripts/lib/agent-egress.sh` so `remediate-pr.sh` and `dispatch-issue.sh` run the
 * IDENTICAL fail-closed scan — two copies of a security control can drift, and a
 * future hardening (e.g. a new exfil channel) landed in only one copy would leave
 * the other silently weaker. The dedup itself is already in place on `main`; what
 * was missing was a test that (a) locks the structural shape — `run_egress_guard`
 * sources the lib and delegates, with no re-inlined `git log -p` / added-lines /
 * commit-message scan logic — and (b) proves BEHAVIOURAL parity: calling
 * `run_egress_guard` and calling `agent_egress_scan` directly with the same inputs
 * must agree, both on the BLOCK case and the CLEAN case. Without this, a future
 * edit could silently re-fork the two paths and nothing would catch it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Locate scripts/ from the repo (or worktree) root — same helper the sibling
// dispatch-issue.sh tests use.
function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptsDir = findScriptsDir();
const dispatchPath = path.join(scriptsDir, 'dispatch-issue.sh');
const libPath = path.join(scriptsDir, 'lib', 'agent-egress.sh');
const dispatchSrc = fs.readFileSync(dispatchPath, 'utf-8');

// Fixture "secret" shaped to match egress-scan.sh's sk-ant- pattern, used ONLY
// inside throwaway fixture repos/files this test creates and deletes. Assembled
// from two literals (not one contiguous string) so THIS SOURCE FILE's own added
// lines never contain the shape the real pre-publish egress guard matches on — the
// guard scans this file's own diff too when the dispatcher publishes this PR.
const FAKE_SECRET = ['sk-ant-', 'api03-AbCdEf0123456789abcdefABCDEF01'].join('');

/** Extract the `run_egress_guard() { ... }` function body from dispatch-issue.sh. */
function extractRunEgressGuard(): string {
  const m = dispatchSrc.match(/^run_egress_guard\(\) \{[\s\S]*?^\}/m);
  if (!m) throw new Error('run_egress_guard() not found in dispatch-issue.sh');
  return m[0];
}
const runEgressGuardFn = extractRunEgressGuard();

// ─── Structural guard: no re-inlined scan logic ────────────────────────────

describe('dispatch-issue.sh — sources the shared egress lib, does not reimplement it (#358, #743)', () => {
  it('sources scripts/lib/agent-egress.sh near the top of the script', () => {
    expect(dispatchSrc).toMatch(/source\s+"\$\{SCRIPT_DIR\}\/lib\/agent-egress\.sh"/);
  });

  it('run_egress_guard() delegates to agent_egress_scan and is a thin wrapper', () => {
    expect(runEgressGuardFn).toMatch(/agent_egress_scan\s+"\$WORKTREE"/);
  });

  it('run_egress_guard() does NOT re-inline the scan (no git log -p / added-lines / commit-message dump of its own)', () => {
    // These are the load-bearing pieces of the ORIGINAL inline copy this issue
    // guards against reintroducing. If any reappear inside run_egress_guard's own
    // body, the two publish paths have re-forked.
    expect(runEgressGuardFn).not.toMatch(/git log -p/);
    expect(runEgressGuardFn).not.toMatch(/added-lines/);
    expect(runEgressGuardFn).not.toMatch(/commit-messages/);
    expect(runEgressGuardFn).not.toMatch(/mktemp/);
  });
});

// ─── Behavioural parity: run_egress_guard vs agent_egress_scan direct ──────

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-parity-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git('add', 'base.txt');
  git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();
  // run_egress_guard hardcodes "origin/main" as the base ref — synthesize that
  // remote-tracking ref locally so the fixture repo doesn't need a real remote.
  git('update-ref', 'refs/remotes/origin/main', baseSha);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
}

function commit(name: string, content: string, message: string) {
  fs.writeFileSync(path.join(dir, name), content);
  git('add', name);
  git('commit', '-q', '-m', message);
}

/** Invoke a bash snippet that defines WORKTREE and calls the given function/expr. */
function callGuard(kind: 'wrapper' | 'direct'): { blocked: boolean; out: string } {
  const body =
    kind === 'wrapper'
      ? `${runEgressGuardFn}\nWORKTREE=${JSON.stringify(dir)}\nrun_egress_guard`
      : `WORKTREE=${JSON.stringify(dir)}\nagent_egress_scan "$WORKTREE" origin/main "${dir}/.agent-summary.md" "${dir}/.review-signals.json"`;
  const script = `source ${JSON.stringify(libPath)}\n${body}`;
  try {
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' });
    return { blocked: false, out: normalizeScratchPath(out.trim()) };
  } catch (e: any) {
    return { blocked: true, out: normalizeScratchPath((e.stdout ?? '').toString().trim()) };
  }
}

// Each invocation gets its OWN mktemp scratch dir (by design — see agent-egress.sh),
// so the block reason embeds a different, non-deterministic path per call even when
// the underlying verdict is identical. Normalize it away so the parity assertion
// compares the actual verdict, not two unrelated tmp-dir names.
function normalizeScratchPath(out: string): string {
  return out.replace(/\/tmp\/[^/\s]+\//g, '<scratch>/');
}

describe('run_egress_guard() vs agent_egress_scan() — identical verdicts (parity)', () => {
  it('both PASS on a clean commit', () => {
    commit('clean.txt', 'nothing interesting here\n', 'clean commit');
    const wrapper = callGuard('wrapper');
    const direct = callGuard('direct');
    expect(wrapper.blocked).toBe(false);
    expect(direct.blocked).toBe(false);
    expect(wrapper.out).toBe(direct.out);
  });

  it('both BLOCK on a secret added in a commit (git log -p / added-lines path)', () => {
    commit('secret.txt', `const key = "${FAKE_SECRET}";\n`, 'add key');
    const wrapper = callGuard('wrapper');
    const direct = callGuard('direct');
    expect(wrapper.blocked).toBe(true);
    expect(direct.blocked).toBe(true);
    expect(wrapper.out).toBe(direct.out);
  });

  it('both BLOCK on a secret smuggled into a commit MESSAGE', () => {
    commit('noop.txt', 'noop\n', FAKE_SECRET);
    const wrapper = callGuard('wrapper');
    const direct = callGuard('direct');
    expect(wrapper.blocked).toBe(true);
    expect(direct.blocked).toBe(true);
    expect(wrapper.out).toBe(direct.out);
  });

  it('both BLOCK on a secret in .agent-summary.md', () => {
    commit('clean2.txt', 'nothing interesting\n', 'clean commit 2');
    fs.writeFileSync(path.join(dir, '.agent-summary.md'), `Summary: leaked ${FAKE_SECRET}\n`);
    const wrapper = callGuard('wrapper');
    const direct = callGuard('direct');
    expect(wrapper.blocked).toBe(true);
    expect(direct.blocked).toBe(true);
    expect(wrapper.out).toBe(direct.out);
  });
});
