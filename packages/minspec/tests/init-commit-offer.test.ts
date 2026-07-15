/**
 * T2 — Feature Tests: post-init "what to commit" hint + offer (#222)
 *
 * After MinSpec init scaffolds .minspec/ + harness files, the user is left with
 * a pile of unstaged new files and no guidance. This feature adds a NON-MODAL
 * toast that summarizes the scaffolded files and OFFERS to commit them in one
 * dedicated commit.
 *
 * Behavior under test:
 *   - The offer appears (a non-modal info toast with a commit action), when the
 *     folder is a git repo and scaffolded paths exist.
 *   - Accept  → exactly ONE dedicated commit is made of only the scaffolded paths.
 *   - Decline → no commit (no-op).
 *   - Not a git repo → no offer at all.
 *
 * The git surface is injected (ScaffoldCommitter) so the test never shells out
 * to a real repository; the toast is the mocked vscode.window API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Mock vscode (non-modal info/warn toasts) ────────────────────────────────

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

// ─── Mock the constitution nudge (keep happy-path toast count deterministic) ──

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

import * as vscode from 'vscode';
import {
  initCommand,
  initRefreshCommand,
  offerScaffoldCommit,
  collectScaffoldPaths,
  collectDirtyScaffoldPaths,
  commitHarnessRefreshCommand,
  SCAFFOLD_COMMIT_MESSAGE,
  REFRESH_COMMIT_MESSAGE,
  type ScaffoldCommitter,
} from '../src/commands/init';
import { scaffold, generateHarnessFiles } from '../src/lib/scaffold';

/** A spying committer stub that records add()/commit()/dirty() calls. */
function makeCommitterStub(isRepo = true, dirtyPaths?: readonly string[]) {
  const added: string[][] = [];
  const commits: string[] = [];
  const committer: ScaffoldCommitter = {
    isRepo: vi.fn(async () => isRepo),
    add: vi.fn(async (paths: readonly string[]) => {
      added.push([...paths]);
    }),
    commit: vi.fn(async (message: string) => {
      commits.push(message);
    }),
    // Default: everything asked about is reported dirty (mirrors a fresh
    // scaffold where nothing is committed yet). Tests that care about the
    // clean case pass `dirtyPaths` explicitly.
    dirty: vi.fn(async (paths: readonly string[]) => [...(dirtyPaths ?? paths)]),
  };
  return { committer, added, commits };
}

describe('post-init commit offer (#222)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-commit-offer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Make `tmpDir` look like a git repo with some scaffolded files present. */
  function seedScaffold(): void {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs', 'epics'), { recursive: true });
    // Both are scaffold()-authored, non-gitignored managed files (#610): config.json
    // under .minspec, the epic index under the default epicsDir (docs/epics).
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'epics', 'INDEX.md'), '# Epics\n');
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
  }

  describe('collectScaffoldPaths()', () => {
    it('returns only the scaffolded paths that exist on disk', () => {
      seedScaffold();
      const paths = collectScaffoldPaths(tmpDir);
      expect(paths).toContain('CLAUDE.md');
      expect(paths).toContain('.gitignore');
      // Absent harness files must NOT be listed.
      expect(paths).not.toContain('DESIGN.md');
      expect(paths).not.toContain('.cursor/rules');
    });

    it('returns an empty list when nothing has been scaffolded', () => {
      expect(collectScaffoldPaths(tmpDir)).toEqual([]);
    });

    // #607/#610 — regression: a bare directory pathspec used to stage EVERYTHING
    // under `.minspec/`, including genuinely user-authored content MinSpec never
    // wrote (a WIP spec draft, …). Every entry is now a precise file, so an
    // unrelated file living alongside a real managed one is never listed — while
    // the managed files MinSpec DOES author (config.json, epics/INDEX.md) still are.
    it('lists the precise managed files (incl. config.json + epics/INDEX.md), never .minspec itself or user drafts', () => {
      seedScaffold();
      fs.writeFileSync(path.join(tmpDir, '.minspec', 'constitution.md'), '# Constitution');
      fs.mkdirSync(path.join(tmpDir, '.minspec', 'specs', 'SPEC-999'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.minspec', 'specs', 'SPEC-999', 'requirements.md'),
        '# WIP draft',
      );

      const paths = collectScaffoldPaths(tmpDir);

      // The managed harness files ARE listed — including config.json + epics/INDEX.md,
      // which scaffold() writes but that are NOT gitignored and MUST be committed (#610).
      expect(paths).toContain('.minspec/constitution.md');
      expect(paths).toContain('.minspec/config.json');
      expect(paths).toContain('docs/epics/INDEX.md');
      // … but the directory itself and any WIP spec draft (genuinely user content)
      // under the same directory are NOT.
      expect(paths).not.toContain('.minspec');
      expect(paths.some((p) => p.startsWith('.minspec/specs'))).toBe(false);
    });

    it('never lists .claude/commands or .cursor/rules as bare directories', () => {
      seedScaffold();
      fs.mkdirSync(path.join(tmpDir, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.claude', 'commands', 'my-own-command.md'),
        '# not a MinSpec shim',
      );

      const paths = collectScaffoldPaths(tmpDir);

      expect(paths).not.toContain('.claude/commands');
      expect(paths).not.toContain('.cursor/rules');
      expect(paths).not.toContain('.claude/commands/my-own-command.md');
    });
  });

  describe('offerScaffoldCommit() — the offer appears', () => {
    it('shows a NON-MODAL info toast with a commit action', async () => {
      seedScaffold();
      const { committer } = makeCommitterStub(true);
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer });

      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
      const call = vi.mocked(vscode.window.showInformationMessage).mock.calls[0];
      const message = call[0] as string;
      // Summarizes scaffolded files + offers a commit.
      expect(message).toMatch(/scaffolded/i);
      expect(message).toContain('CLAUDE.md');
      // The action is a plain string label (a keyboard-navigable toast button),
      // never a modal options object.
      const action = call[1];
      expect(typeof action).toBe('string');
      const opts = call.find((a) => a && typeof a === 'object') as
        | { modal?: boolean }
        | undefined;
      expect(opts?.modal).not.toBe(true);
    });
  });

  describe('offerScaffoldCommit() — accept', () => {
    it('makes exactly ONE dedicated commit of only the scaffolded files', async () => {
      seedScaffold();
      const { committer, added, commits } = makeCommitterStub(true);
      // User clicks the commit action (first action label passed to the toast).
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        async (_msg: string, ...actions: string[]) => actions[0],
      );

      await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer });

      // Exactly one commit, with the dedicated message.
      expect(commits).toEqual([SCAFFOLD_COMMIT_MESSAGE]);
      expect(committer.commit).toHaveBeenCalledTimes(1);
      // Staged exactly the scaffolded paths — and ONLY those.
      expect(added).toHaveLength(1);
      const staged = added[0];
      expect(staged).toEqual(collectScaffoldPaths(tmpDir));
      expect(staged).toContain('CLAUDE.md');
      expect(staged).toContain('.gitignore');
      // #610 — the MinSpec-written, non-gitignored managed files ARE staged …
      expect(staged).toContain('.minspec/config.json');
      expect(staged).toContain('docs/epics/INDEX.md');
      // … but never the bare `.minspec` directory pathspec (#607).
      expect(staged).not.toContain('.minspec');
    });
  });

  describe('offerScaffoldCommit() — decline', () => {
    it('makes NO commit when the user dismisses the toast', async () => {
      seedScaffold();
      const { committer, added, commits } = makeCommitterStub(true);
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer });

      expect(commits).toEqual([]);
      expect(added).toEqual([]);
      expect(committer.add).not.toHaveBeenCalled();
      expect(committer.commit).not.toHaveBeenCalled();
    });
  });

  describe('offerScaffoldCommit() — not a git repo', () => {
    it('makes no offer at all when .git is absent', async () => {
      // Scaffolded files but NO .git directory.
      fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
      const makeCommitter = vi.fn();

      await offerScaffoldCommit(tmpDir, { makeCommitter });

      expect(makeCommitter).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('makes no offer when the committer reports it is not a repo', async () => {
      seedScaffold();
      const { committer, commits } = makeCommitterStub(false);

      await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer });

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(commits).toEqual([]);
    });
  });

  describe('offerScaffoldCommit() — best-effort', () => {
    it('surfaces a warning (not an error) and never throws when commit fails', async () => {
      seedScaffold();
      const committer: ScaffoldCommitter = {
        isRepo: vi.fn(async () => true),
        add: vi.fn(async () => undefined),
        commit: vi.fn(async () => {
          throw new Error('nothing to commit');
        }),
        dirty: vi.fn(async (paths: readonly string[]) => [...paths]),
      };
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        async (_msg: string, ...actions: string[]) => actions[0],
      );

      await expect(
        offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer }),
      ).resolves.toBeUndefined();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('initCommand() integration — offer is reachable via init', () => {
    it('fires the commit offer after a real init in a git repo', async () => {
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
      const { committer, commits } = makeCommitterStub(true);
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        async (_msg: string, ...actions: string[]) => (actions.length ? actions[0] : undefined),
      );

      await initCommand(tmpDir, { makeCommitter: async () => committer });

      // The real scaffold ran, so .minspec/ + harness files exist…
      expect(fs.existsSync(path.join(tmpDir, '.minspec'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
      // …and the offer was accepted → exactly one dedicated commit.
      expect(commits).toEqual([SCAFFOLD_COMMIT_MESSAGE]);
    });
  });
});

/**
 * T3 — Regression: a harness REFRESH must offer to commit, exactly as init does.
 *
 * Bug (RCDD 2026-07-10): `initRefreshCommand` rewrote the harness files (e.g. on
 * window reload via auto-bootstrap's drift offer) but NEVER called
 * `offerScaffoldCommit`, so a refresh stranded its own output uncommitted —
 * unlike init, which got the #222 offer. Root cause: the refresh write-path was
 * built without the commit affordance the init write-path has, and no test
 * asserted the two paths were symmetric. These tests are that gate.
 */
describe('post-refresh commit offer — init/refresh symmetry (RCDD 2026-07-10)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-refresh-offer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("offerScaffoldCommit({ variant: 'refresh' })", () => {
    it('uses refresh wording + the dedicated refresh commit message on accept', async () => {
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
      const { committer, commits } = makeCommitterStub(true);
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        async (_msg: string, ...actions: string[]) => (actions.length ? actions[0] : undefined),
      );

      await offerScaffoldCommit(tmpDir, {
        makeCommitter: async () => committer,
        variant: 'refresh',
      });

      // Offer toast is worded for a refresh, not a scaffold.
      const offer = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0] as string;
      expect(offer).toMatch(/refreshed/i);
      expect(offer).not.toMatch(/scaffolded/i);
      // …and the commit carries the dedicated refresh message.
      expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
    });
  });

  describe('initRefreshCommand() integration — the offer is reachable via refresh', () => {
    it('fires the commit offer after a real refresh in a git repo (regression)', async () => {
      // A real, already-initialized project: scaffold + harness on disk, in a repo.
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
      scaffold(tmpDir);
      generateHarnessFiles(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);

      const { committer, commits } = makeCommitterStub(true);
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        async (_msg: string, ...actions: string[]) => (actions.length ? actions[0] : undefined),
      );

      await initRefreshCommand(tmpDir, { makeCommitter: async () => committer });

      // Pre-fix this array is empty: refresh rewrote files but never offered to
      // commit. Post-fix: exactly one dedicated refresh commit, mirroring init.
      expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
      expect(committer.commit).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * T2 — Feature tests: recoverable "harness uncommitted" affordance (#758).
 *
 * The post-init/-refresh commit offer is a one-shot, non-modal toast — easy to
 * dismiss or lose to the notification center, with no trace once gone. These
 * pieces make the offer RECOVERABLE:
 *   - `collectDirtyScaffoldPaths` — of the scaffolded/refreshed paths, which are
 *     CURRENTLY uncommitted (distinct from `collectScaffoldPaths`, which only
 *     asks "does this managed file exist on disk").
 *   - `commitHarnessRefreshCommand` — re-invokable recovery: re-offers the
 *     commit when something is dirty, and says so plainly (never a silent
 *     no-op) when nothing is.
 */
describe('collectDirtyScaffoldPaths() (#758)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-dirty-scaffold-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedScaffold(): void {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
  }

  it('returns [] when the folder is not a git repo', async () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
    const makeCommitter = vi.fn();

    const dirty = await collectDirtyScaffoldPaths(tmpDir, { makeCommitter });

    expect(dirty).toEqual([]);
    expect(makeCommitter).not.toHaveBeenCalled();
  });

  it('returns [] when nothing has been scaffolded yet', async () => {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    const makeCommitter = vi.fn();

    const dirty = await collectDirtyScaffoldPaths(tmpDir, { makeCommitter });

    expect(dirty).toEqual([]);
    expect(makeCommitter).not.toHaveBeenCalled();
  });

  it('delegates to the committer.dirty() and returns exactly what it reports', async () => {
    seedScaffold();
    const { committer } = makeCommitterStub(true, ['CLAUDE.md']);

    const dirty = await collectDirtyScaffoldPaths(tmpDir, { makeCommitter: async () => committer });

    expect(dirty).toEqual(['CLAUDE.md']);
    expect(committer.dirty).toHaveBeenCalledWith(collectScaffoldPaths(tmpDir));
  });

  it('returns [] when the committer reports everything already committed', async () => {
    seedScaffold();
    const { committer } = makeCommitterStub(true, []);

    const dirty = await collectDirtyScaffoldPaths(tmpDir, { makeCommitter: async () => committer });

    expect(dirty).toEqual([]);
  });

  it('returns [] (best-effort) when the committer reports it is not a repo', async () => {
    seedScaffold();
    const { committer } = makeCommitterStub(false);

    const dirty = await collectDirtyScaffoldPaths(tmpDir, { makeCommitter: async () => committer });

    expect(dirty).toEqual([]);
  });

  it('returns [] (best-effort) when building the committer throws', async () => {
    seedScaffold();

    const dirty = await collectDirtyScaffoldPaths(tmpDir, {
      makeCommitter: async () => {
        throw new Error('git not found');
      },
    });

    expect(dirty).toEqual([]);
  });
});

describe('commitHarnessRefreshCommand() (#758)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-commit-refresh-cmd-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedScaffold(): void {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
  }

  it('re-offers the commit (refresh wording) when something is dirty, and accept commits it', async () => {
    seedScaffold();
    const { committer, commits } = makeCommitterStub(true, ['CLAUDE.md']);
    vi.mocked(vscode.window.showInformationMessage).mockImplementation(
      async (_msg: string, ...actions: string[]) => (actions.length ? actions[0] : undefined),
    );

    await commitHarnessRefreshCommand(tmpDir, { makeCommitter: async () => committer });

    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('says plainly there is nothing to commit — never a silent no-op — when clean', async () => {
    seedScaffold();
    const { committer } = makeCommitterStub(true, []);

    await commitHarnessRefreshCommand(tmpDir, { makeCommitter: async () => committer });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    const message = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0] as string;
    expect(message).toMatch(/no uncommitted/i);
    expect(committer.add).not.toHaveBeenCalled();
    expect(committer.commit).not.toHaveBeenCalled();
  });
});
