/**
 * T0 — two spec-id allocations running at once never return one id, and a crash blocks no
 * id for good (#3164, independent review of #3378).
 *
 * ROOT CAUSE this file pins. The allocator read the open-PR set, but a Specify dispatch's
 * PR opens only after its agent finishes. The drain runs dispatches in parallel
 * (`MINSPEC_DRAIN_CONCURRENCY`, default 8), so siblings read one set, got one id and were
 * each told not to recompute it: the #3236 failure (14 PRs duplicating SPEC-263/264).
 *
 * Real processes against a real repository, with only `gh` stubbed through the
 * `SPEC_ID_GH_BIN` seam. SPEC-227 FR-1 (the offline claimed-id reader) sources each get a
 * case of their own, so no source is untested.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOCATOR = path.join(REPO_ROOT, 'scripts', 'next-spec-id.ts');
const HOURS = 60 * 60 * 1000;

/** tsx by absolute path, found by walking up from the repo (#1032). */
function tsxBin(): string {
  let dir = REPO_ROOT;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'tsx');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find node_modules/.bin/tsx at or above ${REPO_ROOT}`);
}

const TSX = tsxBin();
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MINSPEC|GIT)_/.test(k)));

/**
 * Base tops out at 231, one open PR holds 249. The pause in the open-PR read is held open
 * so every concurrent process has read its sources before any of them can finish.
 */
const GH = `#!/bin/sh
case "$*" in
  *"contents/specs?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec"}]]' ;;
  *"contents/specs/minspec?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec/SPEC-231-a"}]]' ;;
  *graphql*) sleep 1; echo '{"data":{"repository":{"pullRequests":{"pageInfo":{"hasNextPage":false},"nodes":[
    {"number":3124,"files":{"pageInfo":{"hasNextPage":false},"nodes":[{"path":"specs/minspec/SPEC-249-d/requirements.md","changeType":"ADDED"}]}}
  ]}}}}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`;

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: ENV, encoding: 'utf-8' }).trim();
}

/** A real repository holding one commit with no specs directory, and a stub gh. */
function world(): { repo: string; ghBin: string } {
  const repo = tempDir('spec-id-claims-');
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-qm', 'init');
  const ghDir = tempDir('spec-id-claims-gh-');
  const ghBin = path.join(ghDir, 'gh');
  fs.writeFileSync(ghBin, GH, { mode: 0o755 });
  return { repo, ghBin };
}

function allocateSync(cwd: string, ghBin: string) {
  const r = spawnSync(TSX, [ALLOCATOR, '--repo', 'o/r', '--base', 'main'], {
    cwd,
    encoding: 'utf-8',
    env: { ...ENV, SPEC_ID_GH_BIN: ghBin },
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

function allocateAsync(cwd: string, ghBin: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [ALLOCATOR, '--repo', 'o/r', '--base', 'main'], {
      cwd,
      env: { ...ENV, SPEC_ID_GH_BIN: ghBin },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr }));
  });
}

function claimDir(repo: string): string {
  return path.join(repo, '.git', 'minspec', 'spec-id-claims');
}

/** Make every claim on disk look `ageMs` old. */
function ageClaims(repo: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  for (const f of fs.readdirSync(claimDir(repo))) fs.utimesSync(path.join(claimDir(repo), f), when, when);
}

describe('concurrent allocations, one machine', () => {
  it('8 real processes running at once all get different ids', async () => {
    const { repo, ghBin } = world();
    const results = await Promise.all(Array.from({ length: 8 }, () => allocateAsync(repo, ghBin)));
    for (const r of results) expect(r.status, r.stderr).toBe(0);
    expect(results.map((r) => r.stdout).sort()).toEqual([
      'SPEC-250', 'SPEC-251', 'SPEC-252', 'SPEC-253', 'SPEC-254', 'SPEC-255', 'SPEC-256', 'SPEC-257',
    ]);
  });

  it('processes in different worktrees of one repository share the claim', async () => {
    const { repo, ghBin } = world();
    const sibling = path.join(tempDir('spec-id-claims-wt-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', sibling);
    const results = await Promise.all([repo, sibling, repo, sibling].map((cwd) => allocateAsync(cwd, ghBin)));
    for (const r of results) expect(r.status, r.stderr).toBe(0);
    expect(results.map((r) => r.stdout).sort()).toEqual(['SPEC-250', 'SPEC-251', 'SPEC-252', 'SPEC-253']);
  });

  it('8 processes racing for one expired claim still get different ids', async () => {
    const { repo, ghBin } = world();
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
    ageClaims(repo, 5 * HOURS);
    const results = await Promise.all(Array.from({ length: 8 }, () => allocateAsync(repo, ghBin)));
    for (const r of results) expect(r.status, r.stderr).toBe(0);
    const ids = results.map((r) => r.stdout);
    expect(new Set(ids).size).toBe(8);
    expect(ids).toContain('SPEC-250');
  });
});

describe('a crash blocks no id for good', () => {
  it('a claim whose dispatch never came back holds its id only until it expires', () => {
    const { repo, ghBin } = world();
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
    // the process above is gone and no PR ever opened: the shape a crash leaves behind
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-251');
    ageClaims(repo, 3 * HOURS);
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-252');
    ageClaims(repo, 5 * HOURS);
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-251');
  });

  it('a claim is honoured past the longest a dispatch may run (2 hours, LEASE_ABS_MAX_SECS)', () => {
    const lease = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'issue-lease.sh'), 'utf-8');
    expect(lease).toMatch(/^LEASE_ABS_MAX_SECS=7200\b/m);
    const { repo, ghBin } = world();
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
    ageClaims(repo, 2 * HOURS + 60_000);
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-251');
  });
});

describe('SPEC-227 FR-1 sources beyond the open PRs', () => {
  const specFile = (n: number) => `specs/minspec/SPEC-${n}-x/requirements.md`;

  function commitSpecOnNewBranch(repo: string, branch: string, n: number): void {
    const wt = path.join(tempDir('spec-id-claims-branch-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
    fs.mkdirSync(path.dirname(path.join(wt, specFile(n))), { recursive: true });
    fs.writeFileSync(path.join(wt, specFile(n)), 'x\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'spec');
    git(repo, 'worktree', 'remove', '--force', wt);
  }

  it('a spec only on a local branch counts', () => {
    const { repo, ghBin } = world();
    commitSpecOnNewBranch(repo, 'a', 300);
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-301');
  });

  it('a spec only on a remote-tracking ref counts', () => {
    const { repo, ghBin } = world();
    commitSpecOnNewBranch(repo, 'b', 310);
    git(repo, 'update-ref', 'refs/remotes/origin/b', 'refs/heads/b');
    git(repo, 'branch', '-qD', 'b');
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-311');
  });

  it('an uncommitted spec in a sibling worktree counts', () => {
    const { repo, ghBin } = world();
    const sibling = path.join(tempDir('spec-id-claims-wt-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', sibling);
    fs.mkdirSync(path.dirname(path.join(sibling, specFile(320))), { recursive: true });
    fs.writeFileSync(path.join(sibling, specFile(320)), 'x\n');
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-321');
  });

  it('an uncommitted spec in this working tree counts', () => {
    const { repo, ghBin } = world();
    fs.mkdirSync(path.dirname(path.join(repo, specFile(330))), { recursive: true });
    fs.writeFileSync(path.join(repo, specFile(330)), 'x\n');
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-331');
  });

  it('a worktree whose directory is gone is not a failure', () => {
    const { repo, ghBin } = world();
    const parent = tempDir('spec-id-claims-wt-');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', path.join(parent, 'wt'));
    fs.rmSync(path.join(parent, 'wt'), { recursive: true, force: true });
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
  });

  it('many refs on one tip, and specs under two products, are all read', () => {
    const { repo, ghBin } = world();
    commitSpecOnNewBranch(repo, 'c', 340);
    for (let i = 0; i < 30; i++) git(repo, 'branch', `dup-${i}`, 'c');
    const wt = path.join(tempDir('spec-id-claims-branch-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'd', wt);
    fs.mkdirSync(path.join(wt, 'specs/alpha/SPEC-350-y'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'specs/alpha/SPEC-350-y/requirements.md'), 'x\n');
    fs.mkdirSync(path.join(wt, 'specs/beta/SPEC-345-z'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'specs/beta/SPEC-345-z/requirements.md'), 'x\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'spec');
    git(repo, 'worktree', 'remove', '--force', wt);
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-351');
  });
});

describe('boundaries', () => {
  it('writes nothing outside its claim location', () => {
    const { repo, ghBin } = world();
    const before = fs.readdirSync(path.join(repo, '.git')).sort();
    expect(allocateSync(repo, ghBin).stdout).toBe('SPEC-250');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(fs.readdirSync(path.join(repo, '.git')).sort()).toEqual([...before, 'minspec'].sort());
    expect(fs.readdirSync(path.join(repo, '.git', 'minspec'))).toEqual(['spec-id-claims']);
    expect(fs.readdirSync(claimDir(repo))).toEqual(['SPEC-250.0']);
  });

  it('fails closed with no id on stdout outside a git repository, where no claim can be taken', () => {
    const { ghBin } = world();
    const r = allocateSync(tempDir('spec-id-claims-nogit-'), ghBin);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('FAILED CLOSED');
  });

  it('fails closed when the claim location cannot be written', () => {
    const { repo, ghBin } = world();
    fs.mkdirSync(claimDir(repo), { recursive: true });
    fs.chmodSync(claimDir(repo), 0o500);
    try {
      const r = allocateSync(repo, ghBin);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('FAILED CLOSED');
    } finally {
      fs.chmodSync(claimDir(repo), 0o700);
    }
  });
});
