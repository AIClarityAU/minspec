/**
 * #2399 — a hook committed from Windows loses the executable bit, so git
 * silently skips `.minspec/hooks/pre-commit` and `commit-msg` on every Linux or
 * macOS checkout of that commit, printing only a disableable hint, never a
 * failure. The commit gates MinSpec scaffolds (secret scan, protected-branch
 * guard, RCDD root-cause gate) stop gating and nothing else reports it —
 * exactly the shape constitution invariant 2 (no silent gate) forbids.
 *
 * ROOT CAUSE: `writeManagedFile` (scaffold.ts) set only the FILESYSTEM mode via
 * `fs.chmodSync`, inside a `try` that silently swallowed failure on platforms
 * without POSIX modes (Windows). The filesystem mode is not what git commits —
 * the INDEX entry's own mode is — so on Windows a freshly scaffolded hook
 * landed in the index at git's default `100644`, and nothing ever corrected it.
 *
 * `git config core.fileMode false` reproduces the Windows-observed symptom on
 * Linux (ignore the filesystem's reported mode entirely when staging), without
 * needing a Windows machine to run the test on — the fix is in the GIT INDEX
 * path, which this isolates independently of the OS underneath.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { generateHarnessFiles, refreshHarnessFiles, type ManagedRegionWarning } from '../src/lib/scaffold';
import { MANAGED_REGION_TEMPLATES, MINSPEC_HOOKS_DIR } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real git children.
useShellTimeout();

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
}

/** `git ls-files -s <path>` → the index mode (e.g. `100755`), or undefined if untracked. */
function indexMode(dir: string, rel: string): string | undefined {
  const out = git(dir, 'ls-files', '-s', '--', rel);
  const line = out.trim();
  if (!line) return undefined;
  return line.split(/\s+/)[0];
}

const EXECUTABLE_TEMPLATE_PATHS = MANAGED_REGION_TEMPLATES.filter((t) => t.executable).map(
  (t) => t.outputPath,
);

describe('#2399 — scaffolded executable templates keep their bit in the git INDEX', () => {
  it('sanity: there is at least one executable managed-region template to check', () => {
    expect(EXECUTABLE_TEMPLATE_PATHS.length).toBeGreaterThan(0);
    expect(EXECUTABLE_TEMPLATE_PATHS).toContain(`${MINSPEC_HOOKS_DIR}/pre-commit`);
    expect(EXECUTABLE_TEMPLATE_PATHS).toContain(`${MINSPEC_HOOKS_DIR}/commit-msg`);
  });

  it(
    'a scaffold + commit under core.fileMode=false (the Windows-observed symptom) still records 100755 in the index',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-'));
      try {
        git(dir, 'init', '-b', 'main');
        // Git for Windows sets this on every repo it creates or clones (per the
        // issue). It makes git ignore the filesystem's reported mode when
        // deciding whether a tracked file's mode changed, reproducing the
        // Windows symptom on this Linux test runner.
        git(dir, 'config', 'core.fileMode', 'false');

        generateHarnessFiles(dir);

        for (const rel of EXECUTABLE_TEMPLATE_PATHS) {
          expect(
            indexMode(dir, rel),
            `${rel} should already be staged in the index by the scaffold itself`,
          ).toBe('100755');
        }

        git(dir, 'add', '-A');
        git(dir, 'commit', '-m', 'scaffold');

        for (const rel of EXECUTABLE_TEMPLATE_PATHS) {
          expect(
            indexMode(dir, rel),
            `${rel} must be committed as 100755, or every POSIX checkout silently skips it as a hook`,
          ).toBe('100755');
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('refresh self-heals a PRE-EXISTING 100644 hook (a repo last scaffolded on Windows before this fix)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-heal-'));
    try {
      git(dir, 'init', '-b', 'main');
      git(dir, 'config', 'core.fileMode', 'false');

      generateHarnessFiles(dir);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'scaffold');

      // Simulate the pre-fix state: a hook committed at 100644 with its (already
      // correct) body untouched — e.g. via a Windows commit that predates this
      // fix. `--chmod=-x` flips only the index entry; the on-disk content and
      // the working-tree mode are irrelevant to this reproduction, because
      // `core.fileMode=false` makes git ignore the working tree's mode anyway.
      // Guard the commit on there actually being a staged change: against the
      // UNFIXED scaffold the first commit above already landed at 100644 (that
      // is this whole bug), so this flip would be a no-op and `git commit`
      // would fail with "nothing to commit" — that must not be mistaken for a
      // test failure, since reaching 100644 either way is exactly the state
      // this test needs.
      const preCommit = `${MINSPEC_HOOKS_DIR}/pre-commit`;
      git(dir, 'update-index', '--chmod=-x', '--', preCommit);
      if (git(dir, 'diff', '--cached', '--name-only').trim()) {
        git(dir, 'commit', '-m', 'simulate a Windows-committed 100644 hook');
      }
      expect(indexMode(dir, preCommit)).toBe('100644');

      const warnings = refreshHarnessFiles(dir);
      // The index change is REPORTED, never silent (G-8).
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ outputPath: preCommit, kind: 'exec-bit-recorded' });
      expect(warnings[0].message).toContain('100755');

      expect(
        indexMode(dir, preCommit),
        'refresh should have re-recorded the execute bit in the index',
      ).toBe('100755');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the self-heal flips ONLY the mode: unstaged edits to the hook are not staged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-edit-'));
    try {
      git(dir, 'init', '-b', 'main');
      git(dir, 'config', 'core.fileMode', 'false');
      generateHarnessFiles(dir);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'scaffold');

      const preCommit = `${MINSPEC_HOOKS_DIR}/pre-commit`;
      git(dir, 'update-index', '--chmod=-x', '--', preCommit);
      git(dir, 'commit', '-m', 'simulate a Windows-committed 100644 hook', '--allow-empty');
      // A user edit OUTSIDE the managed region, left unstaged.
      fs.appendFileSync(path.join(dir, preCommit), '\n# my local tweak\n');

      refreshHarnessFiles(dir);

      expect(indexMode(dir, preCommit)).toBe('100755');
      // Worktree still differs from the index (edit unstaged), mode aside.
      expect(git(dir, 'diff', '--name-only', '--', preCommit).trim()).toBe(preCommit);
      expect(git(dir, 'show', `:${preCommit}`)).not.toContain('my local tweak');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refresh reports nothing when the hooks are already 100755', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-quiet-'));
    try {
      git(dir, 'init', '-b', 'main');
      generateHarnessFiles(dir);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'scaffold');
      expect(refreshHarnessFiles(dir).filter((w) => w.kind === 'exec-bit-recorded')).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#2399 — init reports hooks it stages into the git index (G-8)', () => {
  it('init raises an exec-bit-recorded notice for each hook it staged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-init-'));
    try {
      git(dir, 'init', '-b', 'main');
      const notices: ManagedRegionWarning[] = [];
      generateHarnessFiles(dir, notices);

      const preCommit = `${MINSPEC_HOOKS_DIR}/pre-commit`;
      expect(indexMode(dir, preCommit)).toBe('100755');
      const recorded = notices.filter((n) => n.kind === 'exec-bit-recorded').map((n) => n.outputPath);
      expect(recorded).toContain(preCommit);
      expect(recorded).toContain(`${MINSPEC_HOOKS_DIR}/commit-msg`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init raises no notice when the index did not change (re-run, or no git repo)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-init-quiet-'));
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-execbit-init-norepo-'));
    try {
      git(dir, 'init', '-b', 'main');
      generateHarnessFiles(dir);
      const again: ManagedRegionWarning[] = [];
      generateHarnessFiles(dir, again);
      expect(again).toEqual([]);

      const noRepo: ManagedRegionWarning[] = [];
      generateHarnessFiles(bare, noRepo);
      expect(noRepo).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
