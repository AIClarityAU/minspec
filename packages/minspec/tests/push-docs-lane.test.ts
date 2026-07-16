/**
 * push-docs-lane — T0 tests for the "MinSpec: Push docs via lane" command
 * (SPEC-039 INV-1/INV-3/INV-4).
 *
 * The load-bearing property is INV-1: NO network happens unless the user invoked
 * the command AND confirmed the modal. So the two headline cases —
 *   (a) no docs changes  → info toast, `gh` NEVER spawned, no git mutation, and
 *   (b) user cancels the confirm → `gh` NEVER spawned, no git mutation —
 * both assert the wire stayed cold. We also pin the graceful-degrade outcomes
 * (INV-4, never throws) and that a gh preflight failure aborts BEFORE any worktree
 * mutation (INV-3, primary untouched).
 *
 * vscode and the git/gh runner are both mocked; no real subprocess is spawned
 * except in the happy-path test, which still injects the runner (only `fs` is real).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Mock vscode (the command's only UI surface) ─────────────────────────────
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    showInputBox: vi.fn(async () => undefined),
  },
  env: { openExternal: vi.fn(async () => true) },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}));

// resolveTargetFolder is only reached when no folder arg is passed; mock it so the
// import resolves without a live vscode workspace, and so the no-folder test can
// drive it to undefined.
vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolder: vi.fn(async () => undefined),
}));

import * as vscode from 'vscode';
import { resolveTargetFolder } from '../src/lib/resolve-folder';
import {
  pushDocsLaneCommand,
  parsePorcelainPaths,
  slugFromOriginUrl,
  type ExecRun,
} from '../src/commands/push-docs-lane';

const showInfo = vi.mocked(vscode.window.showInformationMessage);
const showWarn = vi.mocked(vscode.window.showWarningMessage);
const showInput = vi.mocked(vscode.window.showInputBox);

// ─── An injectable git/gh runner driven by a response table ──────────────────
type ResponderVal =
  | string
  | Error
  | (() => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string });
interface Call {
  file: string;
  args: string[];
  cwd?: string;
  key: string;
}

function responder(map: Record<string, ResponderVal>): { run: ExecRun; calls: Call[] } {
  const calls: Call[] = [];
  const run: ExecRun = async (file, args, opts) => {
    const key = `${file} ${args.join(' ')}`;
    calls.push({ file, args: [...args], cwd: opts?.cwd, key });
    let val: ResponderVal | undefined = map[key];
    if (val === undefined) {
      const hit = Object.entries(map).find(([k]) => key.startsWith(k));
      val = hit?.[1];
    }
    if (val === undefined) return { stdout: '', stderr: '' };
    if (val instanceof Error) throw val;
    if (typeof val === 'function') return val();
    return { stdout: val, stderr: '' };
  };
  return { run, calls };
}

function enoent(): Error {
  const e = new Error('spawn gh ENOENT') as Error & { code: string };
  e.code = 'ENOENT';
  return e;
}

/** The local probes every run reaches before the corpus filter. */
const LOCAL_PROBES = (root: string, status: string): Record<string, ResponderVal> => ({
  'git rev-parse --is-inside-work-tree': 'true\n',
  'git symbolic-ref -q HEAD': 'refs/heads/main\n',
  'git rev-parse --show-toplevel': `${root}\n`,
  'git remote get-url origin': 'git@github.com:AIClarityAU/minspec.git\n',
  'git rev-parse --short HEAD': 'abc1234\n',
  'git -c core.quotePath=false status --porcelain': status,
});

const ghNeverSpawned = (calls: Call[]): boolean => calls.every((c) => c.file !== 'gh');
const gitMutated = (calls: Call[]): boolean =>
  calls.some(
    (c) =>
      c.file === 'git' &&
      (c.args.includes('fetch') ||
        c.args.includes('push') ||
        c.args.includes('commit') ||
        (c.args[0] === 'worktree' && c.args[1] === 'add')),
  );

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-pdl-'));
  // resetAllMocks (not clearAllMocks) also drains any queued mockResolvedValueOnce,
  // so a once-value a test never consumes (it returned before the confirm) can't
  // leak into the next test's confirm.
  vi.resetAllMocks();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Create a docs file under `root` so the copy-based lane sees it on disk. */
function writeDoc(rel: string, content = 'body\n'): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// =============================================================================
// INV-1 headline: no network unless invoked AND confirmed
// =============================================================================

describe('pushDocsLaneCommand — no docs changes ⇒ info toast, wire stays cold', () => {
  it('reports no-docs-changes, never spawns gh, never mutates git', async () => {
    // Working tree has ONLY non-docs changes → filtered out by the corpus.
    const { run, calls } = responder(LOCAL_PROBES(root, ' M packages/minspec/src/x.ts\n?? build/out.js\n'));
    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('no-docs-changes');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(gitMutated(calls)).toBe(false);
    expect(showInfo).toHaveBeenCalledTimes(1);
    expect(String(showInfo.mock.calls[0][0])).toMatch(/no docs changes/i);
    // The confirm was never shown (we stopped before it).
    expect(showWarn).not.toHaveBeenCalled();
    expect(showInput).not.toHaveBeenCalled();
  });

  it('reports no-docs-changes when the tree is entirely clean', async () => {
    const { run, calls } = responder(LOCAL_PROBES(root, ''));
    const res = await pushDocsLaneCommand(root, { run });
    expect(res.outcome).toBe('no-docs-changes');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(gitMutated(calls)).toBe(false);
  });
});

describe('pushDocsLaneCommand — user cancels the confirm ⇒ wire stays cold', () => {
  it('there ARE docs changes, but the modal is dismissed → cancelled, no gh, no mutation', async () => {
    writeDoc('docs/decisions/DR-001.md');
    const { run, calls } = responder(LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n'));
    showWarn.mockResolvedValueOnce(undefined); // dismiss the modal confirm
    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('cancelled');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(gitMutated(calls)).toBe(false);
    // The confirm WAS surfaced (modal), the message prompt was not reached.
    expect(showWarn).toHaveBeenCalledTimes(1);
    expect(showWarn.mock.calls[0][1]).toMatchObject({ modal: true });
    expect(String((showWarn.mock.calls[0][1] as { detail: string }).detail)).toMatch(
      /pull request.*network/i,
    );
    expect(showInput).not.toHaveBeenCalled();
    // Cancelling is silent (no info/error toast).
    expect(showInfo).not.toHaveBeenCalled();
  });

  it('cancelling the message prompt (after confirming) still opens no PR', async () => {
    writeDoc('docs/decisions/DR-001.md');
    const { run, calls } = responder(LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n'));
    showWarn.mockResolvedValueOnce('Open docs-lane PR'); // confirm the modal
    showInput.mockResolvedValueOnce(undefined); // then Escape the message box
    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('cancelled');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(gitMutated(calls)).toBe(false);
    expect(showInput).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// INV-3: a gh preflight failure aborts BEFORE any git mutation (primary untouched)
// =============================================================================

describe('pushDocsLaneCommand — gh preflight gates the mutation (INV-3)', () => {
  it('gh absent (ENOENT) → gh-absent, no worktree/commit/push ever runs', async () => {
    writeDoc('docs/decisions/DR-001.md');
    const { run, calls } = responder({
      ...LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n'),
      'gh auth status': enoent(),
    });
    showWarn.mockResolvedValueOnce('Open docs-lane PR');
    showInput.mockResolvedValueOnce('docs: DR-001');
    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('gh-absent');
    expect(gitMutated(calls)).toBe(false); // no fetch/worktree/commit/push
    expect(showWarn).toHaveBeenLastCalledWith(expect.stringMatching(/GitHub CLI.*not found/i));
  });

  it('gh unauthenticated → gh-unauthenticated, no git mutation', async () => {
    const authErr = Object.assign(new Error('exit 1'), {
      stderr: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
    });
    writeDoc('docs/decisions/DR-001.md');
    const { run, calls } = responder({
      ...LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n'),
      'gh auth status': authErr,
    });
    showWarn.mockResolvedValueOnce('Open docs-lane PR');
    showInput.mockResolvedValueOnce('docs: DR-001');
    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('gh-unauthenticated');
    expect(gitMutated(calls)).toBe(false);
  });
});

// =============================================================================
// INV-4: graceful degrade — every failure mode is a typed result, never a throw
// =============================================================================

describe('pushDocsLaneCommand — graceful degrade (INV-4)', () => {
  it('not a repo → not-a-repo, silent about the network', async () => {
    const { run, calls } = responder({ 'git rev-parse --is-inside-work-tree': 'false\n' });
    const res = await pushDocsLaneCommand(root, { run });
    expect(res.outcome).toBe('not-a-repo');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(showWarn).toHaveBeenCalledWith(expect.stringMatching(/not a git repository/i));
  });

  it('git rev-parse throws (non-repo dir) → not-a-repo, never rejects', async () => {
    const { run } = responder({
      'git rev-parse --is-inside-work-tree': Object.assign(new Error('fatal'), {
        stderr: 'fatal: not a git repository',
      }),
    });
    await expect(pushDocsLaneCommand(root, { run })).resolves.toMatchObject({
      outcome: 'not-a-repo',
    });
  });

  it('detached HEAD → detached-head, wire stays cold', async () => {
    const probes = LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n');
    probes['git symbolic-ref -q HEAD'] = ''; // -q prints nothing when detached
    const { run, calls } = responder(probes);
    const res = await pushDocsLaneCommand(root, { run });
    expect(res.outcome).toBe('detached-head');
    expect(ghNeverSpawned(calls)).toBe(true);
    expect(gitMutated(calls)).toBe(false);
  });

  it('no origin remote → no-origin', async () => {
    const probes = LOCAL_PROBES(root, ' M docs/decisions/DR-001.md\n');
    probes['git remote get-url origin'] = Object.assign(new Error('exit 2'), {
      stderr: "error: No such remote 'origin'",
    });
    const { run, calls } = responder(probes);
    const res = await pushDocsLaneCommand(root, { run });
    expect(res.outcome).toBe('no-origin');
    expect(ghNeverSpawned(calls)).toBe(true);
  });

  it('no folder resolved → no-folder, no network, silent (resolver already spoke)', async () => {
    vi.mocked(resolveTargetFolder).mockResolvedValueOnce(undefined);
    const { run, calls } = responder({});
    const res = await pushDocsLaneCommand(undefined, { run });
    expect(res.outcome).toBe('no-folder');
    expect(calls.length).toBe(0);
    expect(showInfo).not.toHaveBeenCalled();
    expect(showWarn).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Happy path — a full push with the runner injected (only fs is real)
// =============================================================================

describe('pushDocsLaneCommand — opens the PR on the happy path', () => {
  it('copies the docs file, commits, pushes, opens a labelled PR, cleans up', async () => {
    // A real docs file the command will copy out of `root`.
    fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'decisions', 'DR-042.md'), '---\nstatus: proposed\n---\n');

    const map: Record<string, ResponderVal> = {
      ...LOCAL_PROBES(root, ' M docs/decisions/DR-042.md\n'),
      'gh auth status': 'Logged in to github.com\n',
      'git fetch origin main': '',
      'git worktree add': '',
      'git add --': '',
      // diff --cached --quiet REJECTS when there IS a staged delta.
      'git diff --cached --quiet': Object.assign(new Error('exit 1'), { stderr: '' }),
      'git commit': '',
      'git push': '',
      'gh pr create': 'https://github.com/AIClarityAU/minspec/pull/999\n',
      'git worktree remove': '',
    };
    const { run, calls } = responder(map);
    showWarn.mockResolvedValueOnce('Open docs-lane PR');
    showInput.mockResolvedValueOnce('docs: add DR-042');

    const res = await pushDocsLaneCommand(root, { run });

    expect(res.outcome).toBe('pushed');
    expect(res.prUrl).toBe('https://github.com/AIClarityAU/minspec/pull/999');
    expect(res.branch).toBe('docs-lane/abc1234-1');
    expect(res.files).toEqual(['docs/decisions/DR-042.md']);

    // The PR was created with the docs-lane label and correct base/head.
    const prCall = calls.find((c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create');
    expect(prCall).toBeDefined();
    expect(prCall!.args).toEqual(expect.arrayContaining(['--label', 'docs-lane', '--base', 'main']));
    expect(prCall!.args).toEqual(expect.arrayContaining(['--head', 'docs-lane/abc1234-1']));

    // Only the docs file was staged — literal pathspec, never `add -A` (INV-2).
    const addCall = calls.find((c) => c.file === 'git' && c.args[0] === 'add');
    expect(addCall!.args).toEqual(['add', '--', 'docs/decisions/DR-042.md']);

    // Commit MUST use --no-verify: the ephemeral worktree has no node_modules /
    // built @aiclarity/shared, so .githooks/pre-commit's `npm run validate` crashes
    // on module load. The same validation is re-run + required on the PR by ci.yml
    // lint (`npm run validate`), so skipping the local hook is safe. Guard locks the arg.
    const commitCall = calls.find((c) => c.file === 'git' && c.args[0] === 'commit');
    expect(commitCall!.args).toContain('--no-verify');

    // Worktree cleaned up (INV-4 finally).
    expect(calls.some((c) => c.file === 'git' && c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);

    // Success toast carries the PR URL.
    expect(showInfo).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/AIClarityAU/minspec/pull/999'),
      'Open PR',
    );
  });

  it('no delta vs origin/main → no-delta, no commit/push, worktree cleaned', async () => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'x.md'), 'body\n');
    const map: Record<string, ResponderVal> = {
      ...LOCAL_PROBES(root, ' M docs/x.md\n'),
      'gh auth status': 'ok\n',
      'git fetch origin main': '',
      'git worktree add': '',
      'git add --': '',
      'git diff --cached --quiet': '', // exit 0 → NO staged delta
      'git worktree remove': '',
    };
    const { run, calls } = responder(map);
    showWarn.mockResolvedValueOnce('Open docs-lane PR');
    showInput.mockResolvedValueOnce('docs: x');

    const res = await pushDocsLaneCommand(root, { run });
    expect(res.outcome).toBe('no-delta');
    expect(calls.some((c) => c.file === 'git' && c.args[0] === 'commit')).toBe(false);
    expect(calls.some((c) => c.file === 'git' && c.args[0] === 'push')).toBe(false);
    expect(calls.some((c) => c.file === 'git' && c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);
  });
});

// =============================================================================
// Pure parsing helpers
// =============================================================================

describe('parsePorcelainPaths', () => {
  it('strips the XY status and keeps the path', () => {
    expect(parsePorcelainPaths(' M docs/a.md\n?? README.md\nA  specs/b.md\n')).toEqual([
      'docs/a.md',
      'README.md',
      'specs/b.md',
    ]);
  });
  it('keeps the NEW path of a rename', () => {
    expect(parsePorcelainPaths('R  docs/old.md -> docs/new.md\n')).toEqual(['docs/new.md']);
  });
  it('drops blank lines and CRs', () => {
    expect(parsePorcelainPaths(' M docs/a.md\r\n\n')).toEqual(['docs/a.md']);
  });
});

describe('slugFromOriginUrl', () => {
  it('parses ssh and https GitHub remotes, stripping .git', () => {
    expect(slugFromOriginUrl('git@github.com:AIClarityAU/minspec.git')).toBe('AIClarityAU/minspec');
    expect(slugFromOriginUrl('https://github.com/AIClarityAU/minspec.git')).toBe('AIClarityAU/minspec');
    expect(slugFromOriginUrl('https://github.com/AIClarityAU/minspec')).toBe('AIClarityAU/minspec');
    expect(slugFromOriginUrl('ssh://git@github.com/AIClarityAU/minspec.git')).toBe('AIClarityAU/minspec');
  });
  it('returns undefined for an unrecognizable remote', () => {
    expect(slugFromOriginUrl('not-a-url')).toBeUndefined();
  });
});
