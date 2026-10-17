/**
 * T1 — `scripts/push-docs.sh`: a pure/mixed deletion must be representable (#798).
 *
 * The lane builds its branch by COPYING changed docs files into a throwaway
 * worktree off `origin/main`. A deletion has nothing on disk to copy, so before
 * this fix it was silently filtered out of the gathered file set — an all-deletion
 * changeset reported "no changed docs-corpus files found" and nothing was pushed.
 * The fix classifies each docs-corpus path by its `git status --porcelain` code:
 * a worktree deletion (` D`) or staged deletion (`D `) is `git rm`'d in the lane
 * worktree instead of copied. These tests run the REAL script against a real git
 * repo (an `origin` bare repo + a `primary` clone), with `gh` stubbed so no network
 * call happens; they assert the pushed branch actually carries the deletion.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

// #1099 — this suite drives real `git` child processes per assertion (setupRepo +
// runPushDocs both shell out). Under container scheduling contention a single `git`
// invocation can queue past the 5s default testTimeout even though nothing hung,
// and which suite trips it is non-deterministic run-to-run (#1099). Raised HERE,
// per-file, not globally — a genuinely hung test elsewhere still fails fast at the
// default. 30s is the value #1099 measured all affected suites passing reliably at.
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  vi.resetConfig();
});

const PUSH_DOCS_SH = path.resolve(__dirname, '../../../scripts/push-docs.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } }).trim();
}

/** A fake `gh` on PATH — never touches the network; `pr create` logs its argv. */
function installFakeGh(binDir: string, callsLog: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  repo) echo "test-owner/test-repo" ;;
  pr)
    printf '%s\\n' "$@" >> "${callsLog}"
    echo "https://github.com/test-owner/test-repo/pull/42"
    ;;
  *) echo "fake gh: unsupported subcommand: \${1:-}" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
}

/** Parse the `--head <branch>` value out of the logged `gh pr create` argv lines. */
function branchFromGhLog(callsLog: string): string {
  const lines = fs.readFileSync(callsLog, 'utf-8').split('\n');
  const i = lines.indexOf('--head');
  if (i === -1 || !lines[i + 1]) throw new Error(`no --head in gh log: ${lines.join('|')}`);
  return lines[i + 1];
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    try {
      // Best-effort: drop any worktree registration before removing the dir.
      execFileSync('git', ['-C', path.join(r, 'primary'), 'worktree', 'prune'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    fs.rmSync(r, { recursive: true, force: true });
  }
});

/** Set up `origin.git` (bare) + a `primary` clone, with the given files committed on main. */
function setupRepo(files: Record<string, string>): { root: string; origin: string; primary: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-docs-sh-'));
  roots.push(root);
  const origin = path.join(root, 'origin.git');
  const primary = path.join(root, 'primary');
  fs.mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'clone', origin, primary);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(primary, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'seed');
  git(primary, 'push', 'origin', 'main');
  return { root, origin, primary };
}

function runPushDocs(primary: string, root: string, args: string[]): string {
  const binDir = path.join(root, 'bin');
  const callsLog = path.join(root, 'gh-calls.log');
  fs.writeFileSync(callsLog, '');
  installFakeGh(binDir, callsLog);
  const out = execFileSync('bash', [PUSH_DOCS_SH, ...args], {
    cwd: primary,
    encoding: 'utf-8',
    env: { ...process.env, ...GIT_ENV, PATH: `${binDir}:${process.env.PATH}` },
  });
  return out;
}

/**
 * Same as {@link runPushDocs}, but also captures stderr on BOTH success and failure — the
 * #2158 governance-transition warning is printed there (constitution invariant 2: a
 * refusal must be visible, and stderr is where `push-docs.sh` already puts every other
 * loud refusal in this file). `execFileSync` only hands back stderr on a non-zero exit,
 * which is wrong here: the script exits 0 on this path (it still opens the PR, just
 * un-labelled) — `spawnSync` returns both streams regardless of exit code.
 */
function runPushDocsCaptureAll(
  primary: string,
  root: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const binDir = path.join(root, 'bin');
  const callsLog = path.join(root, 'gh-calls.log');
  fs.writeFileSync(callsLog, '');
  installFakeGh(binDir, callsLog);
  const res = spawnSync('bash', [PUSH_DOCS_SH, ...args], {
    cwd: primary,
    encoding: 'utf-8',
    env: { ...process.env, ...GIT_ENV, PATH: `${binDir}:${process.env.PATH}` },
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('push-docs.sh — delete-only lane push (#798)', () => {
  it('a removed doc is git rm-ed in the lane worktree and actually pushed', () => {
    const { root, origin, primary } = setupRepo({ 'docs/decisions/DR-100.md': 'seed\n' });
    const callsLog = path.join(root, 'gh-calls.log');

    // Working-tree deletion, unstaged — porcelain code ` D`.
    fs.rmSync(path.join(primary, 'docs/decisions/DR-100.md'));

    const out = runPushDocs(primary, root, ['-m', 'docs: remove DR-100']);
    expect(out).toMatch(/push-docs: opened https:\/\/github\.com\/test-owner\/test-repo\/pull\/42/);

    const branch = branchFromGhLog(callsLog);
    // The pushed branch carries the deletion: the file is gone at that ref.
    expect(() => git(origin, 'show', `${branch}:docs/decisions/DR-100.md`)).toThrow();
    // ...but main (the branch's base) still has it — proves it's a real deletion,
    // not just an absent file that was never on the branch to begin with.
    expect(git(origin, 'show', 'main:docs/decisions/DR-100.md')).toBe('seed');
  });

  it('a pure-deletion changeset is no longer silently filtered to "no changes"', () => {
    const { root, primary } = setupRepo({ 'docs/decisions/DR-101.md': 'seed\n' });
    fs.rmSync(path.join(primary, 'docs/decisions/DR-101.md'));
    const out = runPushDocs(primary, root, ['-m', 'docs: remove DR-101']);
    expect(out).not.toMatch(/no changed docs-corpus files found/);
    expect(out).toMatch(/push-docs: opened/);
  });
});

describe('push-docs.sh — mixed add+delete lane push (#798)', () => {
  it('one file is copied/modified, another is git rm-ed, in the same push', () => {
    const { root, origin, primary } = setupRepo({
      'docs/decisions/DR-100.md': 'seed\n',
      'docs/decisions/DR-101.md': 'seed\n',
    });
    const callsLog = path.join(root, 'gh-calls.log');

    fs.rmSync(path.join(primary, 'docs/decisions/DR-100.md')); // deletion
    fs.writeFileSync(path.join(primary, 'docs/decisions/DR-101.md'), 'updated\n'); // modify

    const out = runPushDocs(primary, root, ['-m', 'docs: update DR-101, remove DR-100']);
    expect(out).toMatch(/push-docs: opened/);

    const branch = branchFromGhLog(callsLog);
    expect(() => git(origin, 'show', `${branch}:docs/decisions/DR-100.md`)).toThrow();
    expect(git(origin, 'show', `${branch}:docs/decisions/DR-101.md`)).toBe('updated');
  });
});

/**
 * push-docs.sh — governance status-transition gate (#2158).
 *
 * Root cause: the script knew the lane's docs-corpus precondition (CORPUS above) but not
 * its second one — no changed `status:` line under docs/decisions/ or specs/ (#1847) — so
 * it applied `docs-lane` unconditionally and opened PRs the lane's own workflow job was
 * guaranteed to refuse with `exit 1`. These tests run the REAL script end to end (same
 * harness as the #798 suite above: a bare `origin` + `primary` clone, `gh` stubbed) and
 * inspect the logged `gh pr create` argv for `--label docs-lane` — present on an ordinary
 * docs change, ABSENT the moment a governance `status:` line is touched.
 */
describe('push-docs.sh — governance status-transition gate (#2158)', () => {
  it('withholds the docs-lane label when a spec status line changes (the shape that produced the false red)', () => {
    const { root, primary } = setupRepo({
      'specs/minspec/SPEC-100-x/requirements.md': '---\nid: SPEC-100\nstatus: specifying\n---\n',
    });
    const callsLog = path.join(root, 'gh-calls.log');
    fs.writeFileSync(
      path.join(primary, 'specs/minspec/SPEC-100-x/requirements.md'),
      '---\nid: SPEC-100\nstatus: approved\n---\n',
    );

    const result = runPushDocsCaptureAll(primary, root, ['-m', 'docs: approve SPEC-100']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/push-docs: opened/);
    expect(result.stderr).toMatch(/NOT labelling docs-lane/);
    expect(result.stderr).toMatch(/specs\/minspec\/SPEC-100-x\/requirements\.md/);
    expect(result.stderr).toMatch(/human act/);

    const log = fs.readFileSync(callsLog, 'utf-8');
    expect(log).not.toMatch(/--label\ndocs-lane/);
  });

  it('withholds the label on a DR acceptance (status: proposed -> accepted)', () => {
    const { root, primary } = setupRepo({ 'docs/decisions/DR-101.md': '---\nstatus: proposed\n---\nbody\n' });
    const callsLog = path.join(root, 'gh-calls.log');
    fs.writeFileSync(path.join(primary, 'docs/decisions/DR-101.md'), '---\nstatus: accepted\n---\nbody\n');

    const out = runPushDocs(primary, root, ['-m', 'docs: accept DR-101']);
    expect(out).toMatch(/push-docs: opened/);

    const log = fs.readFileSync(callsLog, 'utf-8');
    expect(log).not.toMatch(/--label\ndocs-lane/);
  });

  it('KEEPS the label on a DR typo fix — the lane arms on that, so the producer must not be coarser', () => {
    const { root, primary } = setupRepo({
      'docs/decisions/DR-102.md': '---\nstatus: accepted\n---\na speling mistake\n',
    });
    const callsLog = path.join(root, 'gh-calls.log');
    fs.writeFileSync(
      path.join(primary, 'docs/decisions/DR-102.md'),
      '---\nstatus: accepted\n---\na spelling mistake\n',
    );

    const out = runPushDocs(primary, root, ['-m', 'docs: fix typo in DR-102']);
    expect(out).toMatch(/push-docs: opened/);
    expect(out).not.toMatch(/NOT labelling docs-lane/);

    const log = fs.readFileSync(callsLog, 'utf-8');
    expect(log).toMatch(/--label\ndocs-lane/);
  });

  it('KEEPS the label on an ordinary docs-only change with no governance path at all', () => {
    const { root, primary } = setupRepo({ 'CLAUDE.md': 'old status: fine\n' });
    const callsLog = path.join(root, 'gh-calls.log');
    fs.writeFileSync(path.join(primary, 'CLAUDE.md'), 'new status: fine\n');

    const out = runPushDocs(primary, root, ['-m', 'docs: tweak CLAUDE.md']);
    expect(out).toMatch(/push-docs: opened/);

    const log = fs.readFileSync(callsLog, 'utf-8');
    expect(log).toMatch(/--label\ndocs-lane/);
  });

  it('the un-labelled PR body names the file and explains it needs a human merge', () => {
    const { root, primary } = setupRepo({
      'specs/minspec/SPEC-103-x/requirements.md': '---\nid: SPEC-103\nstatus: specifying\n---\n',
    });
    const callsLog = path.join(root, 'gh-calls.log');
    fs.writeFileSync(
      path.join(primary, 'specs/minspec/SPEC-103-x/requirements.md'),
      '---\nid: SPEC-103\nstatus: approved\n---\n',
    );

    runPushDocs(primary, root, ['-m', 'docs: approve SPEC-103']);
    const log = fs.readFileSync(callsLog, 'utf-8');
    expect(log).toContain('specs/minspec/SPEC-103-x/requirements.md');
    expect(log).toMatch(/human (act|merge)/);
  });
});
