import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  analyzeGitDiff,
  buildConsequenceInput,
  type ClassificationSignal,
} from '../src/lib/git-analyzer';
import type { ChangedFile, ConsequenceInput } from '../src/lib/consequence-analyzers';
import type { SimpleGit } from 'simple-git';

/** Helper to create a mock SimpleGit instance */
function createMockGit(overrides: Partial<Record<string, unknown>> = {}): SimpleGit {
  return {
    revparse: vi.fn().mockResolvedValue('true'),
    diffSummary: vi.fn().mockResolvedValue({ files: [], insertions: 0, deletions: 0, changed: 0 }),
    diff: vi.fn().mockResolvedValue(''),
    status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
    // `show` is only reached by buildConsequenceInput; analyzeGitDiff never calls
    // it, so defaulting it here is inert for every test above.
    show: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as SimpleGit;
}

/** Find a signal by name in the results */
function findSignal(signals: ClassificationSignal[], name: string): ClassificationSignal | undefined {
  return signals.find(s => s.name === name);
}

// ─── Real-git fixtures ───────────────────────────────────────────────────────
// buildConsequenceInput's whole job is translating real `git status` / `git show`
// output into ChangedFile records, so the core cases run against a REAL repo:
// a mock can only prove we called the functions we wrote, never that git answers
// the way the mapping assumes (the staged-vs-disk distinction below is exactly
// the kind of thing a mock would happily get wrong in both directions).

/** Temp dirs created by the current test, torn down in afterEach. */
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitanalyzer-'));
  tmpDirs.push(dir);
  return dir;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

function initRepo(dir: string): void {
  runGit(['init', '-b', 'main'], dir);
  runGit(['config', 'user.email', 'test@minspec.test'], dir);
  runGit(['config', 'user.name', 'MinSpec Test'], dir);
  // This box sets core.hooksPath globally (the RCDD commit-msg gate); point the
  // fixture at an empty dir so its throwaway commits never trip a real gate.
  const hooks = path.join(dir, '.nohooks');
  fs.mkdirSync(hooks, { recursive: true });
  runGit(['config', 'core.hooksPath', hooks], dir);
}

/** Write `content` to `rel` under `dir`, creating parents. Returns the abs path. */
function write(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

/** Bytes with an embedded NUL, which is what makes git classify a file as binary. */
const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff, 0xfe]);

/**
 * A repo with one staged TEXT edit (`a.ts`, +1/-1) and one staged BINARY
 * addition (`logo.png`). Real git on purpose: the defect these fixtures expose
 * lives in the *shape* simple-git returns for a binary entry, and a hand-built
 * mock would only restate our assumption about that shape.
 */
function repoWithStagedBinary(): string {
  const repo = makeTmpDir();
  initRepo(repo);
  write(repo, 'a.ts', 'export const a = 1;\n');
  runGit(['add', '-A'], repo);
  runGit(['commit', '-m', 'init'], repo);

  write(repo, 'a.ts', 'export const a = 2;\n');
  fs.writeFileSync(path.join(repo, 'logo.png'), BINARY_BYTES);
  runGit(['add', '-A'], repo);
  return repo;
}

/** Index ChangedFile records by path so assertions don't depend on git's ordering. */
function byPath(input: ConsequenceInput): Map<string, ChangedFile> {
  return new Map(input.changedFiles.map(f => [f.path, f]));
}

/** Build a diffSummary mock from a terse file list. */
function diffSummaryOf(
  files: Array<{ file: string; insertions?: number; deletions?: number }>,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    files: files.map(f => ({ insertions: 0, deletions: 0, binary: false, ...f })),
    changed: files.length,
  });
}

/**
 * A `show` mock that answers EVERY ref with an identifiable string. Used where
 * the point is that the code *declined to ask* — real git throws for
 * `:<deleted-path>` and `HEAD:<new-path>`, which would mask a missing guard by
 * producing `undefined` for the wrong reason.
 */
function echoShow(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (args: string[]) => `blob(${args[0]})`);
}

describe('analyzeGitDiff()', () => {
  describe('edge cases', () => {
    // The isGitRepo guard is REDUNDANT for the return value: every downstream
    // path already ends in `[]`, so `expect(signals).toEqual([])` against the
    // default (empty) diff mock passes just as happily with the guard deleted —
    // it asserts the module's universal fallback, not the guard. The guard's one
    // observable effect is declining to run the downstream commands, so both
    // tests below arm the mock with a NON-empty diff (making the empty result
    // load-bearing) and assert the call log directly, the same way the
    // buildConsequenceInput case at the bottom of this file does.
    const armedDiffSummary = () =>
      diffSummaryOf([{ file: 'src/a.ts', insertions: 9, deletions: 9 }]);

    it('asks git nothing beyond the repo probe when revparse throws', async () => {
      const diffSummary = armedDiffSummary();
      const status = vi.fn().mockResolvedValue({ created: ['src/a.ts'], not_added: [] });
      const git = createMockGit({
        revparse: vi.fn().mockRejectedValue(new Error('not a git repo')),
        diffSummary,
        status,
      });

      const signals = await analyzeGitDiff('/tmp/not-a-repo', { git });
      expect(signals).toEqual([]);
      expect(diffSummary).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    });

    it('asks git nothing beyond the repo probe when revparse returns non-true', async () => {
      const diffSummary = armedDiffSummary();
      const status = vi.fn().mockResolvedValue({ created: ['src/a.ts'], not_added: [] });
      const git = createMockGit({
        revparse: vi.fn().mockResolvedValue('false'),
        diffSummary,
        status,
      });

      const signals = await analyzeGitDiff('/tmp/not-a-repo', { git });
      expect(signals).toEqual([]);
      expect(diffSummary).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    });

    it('returns empty array when no changes detected', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({ files: [], insertions: 0, deletions: 0, changed: 0 }),
      });

      const signals = await analyzeGitDiff('/tmp/some-repo', { git });
      expect(signals).toEqual([]);
    });

    it('returns empty array when diffSummary throws', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockRejectedValue(new Error('diff failed')),
      });

      const signals = await analyzeGitDiff('/tmp/some-repo', { git });
      expect(signals).toEqual([]);
    });
  });

  describe('single file change (T1 signals)', () => {
    it('produces T1 signals for a single small file change', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'src/index.ts', insertions: 5, deletions: 2, binary: false }],
          insertions: 5,
          deletions: 2,
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      // Should have core signals
      expect(signals.length).toBeGreaterThanOrEqual(4);

      // File count: 1 file = T1
      const filesChanged = findSignal(signals, 'files_changed');
      expect(filesChanged).toBeDefined();
      expect(filesChanged!.value).toBe(1);
      expect(filesChanged!.tierContribution).toBe('T1');

      // Line count: 7 lines = T1
      const linesChanged = findSignal(signals, 'lines_changed');
      expect(linesChanged).toBeDefined();
      expect(linesChanged!.value).toBe(7);
      expect(linesChanged!.tierContribution).toBe('T1');

      // File types: 1 type (ts) = T1
      const fileTypes = findSignal(signals, 'file_types');
      expect(fileTypes).toBeDefined();
      expect(fileTypes!.value).toBe(1);
      expect(fileTypes!.tierContribution).toBe('T1');

      // Cross-directory: 1 dir = T1
      const crossDir = findSignal(signals, 'cross_directory');
      expect(crossDir).toBeDefined();
      expect(crossDir!.value).toBe(1);
      expect(crossDir!.tierContribution).toBe('T1');

      // New files: 0 = T1
      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles).toBeDefined();
      expect(newFiles!.value).toBe(0);
      expect(newFiles!.tierContribution).toBe('T1');
    });
  });

  describe('multi-file, multi-directory change (T3 signals)', () => {
    it('produces higher tier signals for complex changes', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'src/lib/analyzer.ts', insertions: 80, deletions: 20, binary: false },
            { file: 'src/lib/config.ts', insertions: 10, deletions: 5, binary: false },
            { file: 'tests/analyzer.test.ts', insertions: 60, deletions: 0, binary: false },
            { file: 'src/commands/classify.ts', insertions: 30, deletions: 10, binary: false },
            { file: 'docs/design.md', insertions: 15, deletions: 3, binary: false },
            { file: 'package.json', insertions: 2, deletions: 0, binary: false },
            { file: 'src/types/index.ts', insertions: 20, deletions: 0, binary: false },
          ],
          insertions: 217,
          deletions: 38,
          changed: 7,
        }),
        status: vi.fn().mockResolvedValue({
          created: ['src/lib/analyzer.ts', 'tests/analyzer.test.ts', 'src/types/index.ts'],
          not_added: [],
          staged: [],
        }),
        diff: vi.fn().mockResolvedValue(
          '--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,7 @@\n "dependencies": {\n+    "simple-git": "^3.27.0"\n }\n',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      // File count: 7 files = T3
      const filesChanged = findSignal(signals, 'files_changed');
      expect(filesChanged).toBeDefined();
      expect(filesChanged!.value).toBe(7);
      expect(filesChanged!.tierContribution).toBe('T3');

      // Line count: 255 lines = T3
      const linesChanged = findSignal(signals, 'lines_changed');
      expect(linesChanged).toBeDefined();
      expect(linesChanged!.value).toBe(255);
      expect(linesChanged!.tierContribution).toBe('T3');

      // File types: ts, md, json = 3 types = T3
      const fileTypes = findSignal(signals, 'file_types');
      expect(fileTypes).toBeDefined();
      expect(fileTypes!.value).toBe(3);
      expect(fileTypes!.tierContribution).toBe('T3');

      // Cross-directory: src/lib, tests, src/commands, docs, root, src/types = 6 dirs = T3
      const crossDir = findSignal(signals, 'cross_directory');
      expect(crossDir).toBeDefined();
      expect(crossDir!.value).toBeGreaterThanOrEqual(3);
      expect(crossDir!.tierContribution).toBe('T3');

      // New files: 3 = T3
      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles).toBeDefined();
      expect(newFiles!.value).toBe(3);
      expect(newFiles!.tierContribution).toBe('T3');

      // Dependency change present
      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(true);
      expect(depChange!.tierContribution).toBe('T3');
    });
  });

  describe('package.json dependency addition', () => {
    it('emits dependency_change signal when package.json is modified', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'package.json', insertions: 3, deletions: 1, binary: false },
            { file: 'src/index.ts', insertions: 10, deletions: 2, binary: false },
          ],
          insertions: 13,
          deletions: 3,
          changed: 2,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: vi.fn().mockResolvedValue(
          '--- a/package.json\n+++ b/package.json\n@@ -3,4 +3,6 @@\n "dependencies": {\n+    "lodash": "^4.17.21"\n }\n',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(true);
      expect(depChange!.tierContribution).toBe('T3');
    });

    it('emits dependency_change with false when package.json changes do not add deps', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'package.json', insertions: 1, deletions: 1, binary: false },
          ],
          insertions: 1,
          deletions: 1,
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: vi.fn().mockResolvedValue(
          '--- a/package.json\n+++ b/package.json\n@@ -2,3 +2,3 @@\n-  "version": "1.0.0"\n+  "version": "1.0.1"\n',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(false);
      expect(depChange!.tierContribution).toBe('T2');
    });

    it('does not read a non-dependency package.json edit as a new dep', async () => {
      // hasNewDependencies is an AND of two halves — the added line LOOKS like a
      // `"name": "version"` pair, and the patch mentions a dependencies block —
      // and only the second half was pinned. The version-bump case above leans
      // entirely on it: its added line matches the pair regex perfectly, and it
      // reads false only because the patch never names a dependencies section.
      // This is the mirror image. The section IS present (as context, which is
      // all `diffOutput.includes` looks at), so the added line's SHAPE is the
      // only thing left to decide the answer. Without both halves pinned the
      // regex is decoration: relaxing it to `/^\+/` — every added line counts —
      // passes every other test in this file.
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'package.json', insertions: 1 }]),
        diff: vi.fn().mockResolvedValue(
          [
            '--- a/package.json',
            '+++ b/package.json',
            '@@ -1,6 +1,7 @@',
            ' {',
            '   "dependencies": {',
            '     "zod": "^3.23.0"',
            '   },',
            '+  "private": true',
            ' }',
          ].join('\n'),
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change')!;
      expect(depChange.value).toBe(false);
      expect(depChange.tierContribution).toBe('T2');
    });

    it('does not emit dependency_change signal when no package.json change', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'src/index.ts', insertions: 5, deletions: 0, binary: false },
          ],
          insertions: 5,
          deletions: 0,
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeUndefined();
    });

    it('detects new deps in a ROOT-level package.json (#153)', async () => {
      // Real git pathspec semantics: '**/package.json' matches NESTED files only,
      // NOT a repo-root 'package.json'. This mock honors that — it returns the
      // dep-add diff only when the args include a pathspec that would match root.
      const rootDiff =
        '--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,7 @@\n "dependencies": {\n+    "zod": "^3.23.0"\n }\n';
      const matchesRoot = (args: string[]): boolean =>
        args.some(a => a === 'package.json' || a === ':/package.json' || a === '*package.json');

      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            // Root-level package.json (basename 'package.json', no directory).
            { file: 'package.json', insertions: 1, deletions: 0, binary: false },
          ],
          insertions: 1,
          deletions: 0,
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: vi.fn().mockImplementation(async (args: string[]) =>
          matchesRoot(args) ? rootDiff : '',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      // Bug: pathspec was only '**/package.json', so a root package.json's diff
      // came back empty and hasNewDependencies stayed false.
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(true);
      expect(depChange!.tierContribution).toBe('T3');
    });
  });

  describe('staged vs working tree', () => {
    it('uses --cached flag when staged option is true (default)', async () => {
      const diffSummaryMock = vi.fn().mockResolvedValue({
        files: [{ file: 'a.ts', insertions: 1, deletions: 0, binary: false }],
        insertions: 1,
        deletions: 0,
        changed: 1,
      });

      const git = createMockGit({
        diffSummary: diffSummaryMock,
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      await analyzeGitDiff('/tmp/repo', { git, staged: true });

      expect(diffSummaryMock).toHaveBeenCalledWith(['--cached']);
    });

    it('uses no flag when staged option is false', async () => {
      const diffSummaryMock = vi.fn().mockResolvedValue({
        files: [{ file: 'a.ts', insertions: 1, deletions: 0, binary: false }],
        insertions: 1,
        deletions: 0,
        changed: 1,
      });

      const git = createMockGit({
        diffSummary: diffSummaryMock,
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      await analyzeGitDiff('/tmp/repo', { git, staged: false });

      expect(diffSummaryMock).toHaveBeenCalledWith([]);
    });
  });

  describe('tier boundary values', () => {
    it('file count boundary: 2 files = T1, 3 files = T2', async () => {
      // 2 files = T1
      const git2 = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'a.ts', insertions: 1, deletions: 0, binary: false },
            { file: 'b.ts', insertions: 1, deletions: 0, binary: false },
          ],
          changed: 2,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals2 = await analyzeGitDiff('/tmp/repo', { git: git2 });
      expect(findSignal(signals2, 'files_changed')!.tierContribution).toBe('T1');

      // 3 files = T2
      const git3 = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'a.ts', insertions: 1, deletions: 0, binary: false },
            { file: 'b.ts', insertions: 1, deletions: 0, binary: false },
            { file: 'c.ts', insertions: 1, deletions: 0, binary: false },
          ],
          changed: 3,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals3 = await analyzeGitDiff('/tmp/repo', { git: git3 });
      expect(findSignal(signals3, 'files_changed')!.tierContribution).toBe('T2');
    });

    it('line count boundary: 20 lines = T1, 21 lines = T2', async () => {
      // 20 lines = T1
      const git20 = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 15, deletions: 5, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals20 = await analyzeGitDiff('/tmp/repo', { git: git20 });
      expect(findSignal(signals20, 'lines_changed')!.tierContribution).toBe('T1');

      // 21 lines = T2
      const git21 = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 16, deletions: 5, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals21 = await analyzeGitDiff('/tmp/repo', { git: git21 });
      expect(findSignal(signals21, 'lines_changed')!.tierContribution).toBe('T2');
    });

    it('file count: 16 files = T4', async () => {
      const files = Array.from({ length: 16 }, (_, i) => ({
        file: `src/file${i}.ts`,
        insertions: 5,
        deletions: 0,
        binary: false,
      }));

      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({ files, changed: 16 }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });
      expect(findSignal(signals, 'files_changed')!.tierContribution).toBe('T4');
    });

    it('line count: 501 lines = T4', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'big.ts', insertions: 400, deletions: 101, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });
      expect(findSignal(signals, 'lines_changed')!.tierContribution).toBe('T4');
    });

    it('file count boundary: 5 files = T2, 6 files = T3', async () => {
      // The T2/T3 step. Only the 2/3 and 16 boundaries were pinned, so the
      // T2 arm's upper edge could slide by one file unobserved.
      const nFiles = (n: number) =>
        createMockGit({
          diffSummary: diffSummaryOf(
            Array.from({ length: n }, (_, i) => ({ file: `src/f${i}.ts`, insertions: 1 })),
          ),
        });

      const at5 = await analyzeGitDiff('/tmp/repo', { git: nFiles(5) });
      expect(findSignal(at5, 'files_changed')!.value).toBe(5);
      expect(findSignal(at5, 'files_changed')!.tierContribution).toBe('T2');

      const at6 = await analyzeGitDiff('/tmp/repo', { git: nFiles(6) });
      expect(findSignal(at6, 'files_changed')!.value).toBe(6);
      expect(findSignal(at6, 'files_changed')!.tierContribution).toBe('T3');
    });

    it('line count boundary: 100 lines = T2, 101 lines = T3', async () => {
      // The T2/T3 step, pinned from BOTH sides: 100 alone leaves `<= 100` free
      // to become `< 100`, and 101 alone leaves it free to become `<= 101`.
      const nLines = (lines: number) =>
        createMockGit({
          diffSummary: diffSummaryOf([{ file: 'a.ts', insertions: lines, deletions: 0 }]),
        });

      const at100 = await analyzeGitDiff('/tmp/repo', { git: nLines(100) });
      expect(findSignal(at100, 'lines_changed')!.value).toBe(100);
      expect(findSignal(at100, 'lines_changed')!.tierContribution).toBe('T2');

      const at101 = await analyzeGitDiff('/tmp/repo', { git: nLines(101) });
      expect(findSignal(at101, 'lines_changed')!.value).toBe(101);
      expect(findSignal(at101, 'lines_changed')!.tierContribution).toBe('T3');
    });

    it('line count: exactly 500 lines = T3, not T4 (#153 — docstring said 500+=T4)', async () => {
      // Pins the actual boundary: lineCountTier(500) === 'T3' (only 501+ is T4).
      // The :38 docstring incorrectly claimed "500+=T4" / "1-500=T3"; this asserts code.
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'big.ts', insertions: 300, deletions: 200, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });
      expect(findSignal(signals, 'lines_changed')!.value).toBe(500);
      expect(findSignal(signals, 'lines_changed')!.tierContribution).toBe('T3');
    });
  });

  describe('signal weights', () => {
    it('all signals have valid weights between 0 and 1', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'package.json', insertions: 5, deletions: 2, binary: false },
            { file: 'src/index.ts', insertions: 10, deletions: 3, binary: false },
          ],
          changed: 2,
        }),
        status: vi.fn().mockResolvedValue({ created: ['src/index.ts'], not_added: [], staged: [] }),
        diff: vi.fn().mockResolvedValue(
          '"dependencies": {\n+    "foo": "^1.0.0"\n',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      for (const signal of signals) {
        expect(signal.weight).toBeGreaterThan(0);
        expect(signal.weight).toBeLessThanOrEqual(1);
      }
    });

    it('pins the exact weight of every signal', async () => {
      // The range check above is satisfied by ANY weight in (0, 1], so it pins
      // nothing that matters: these six numbers are the relative pull each axis
      // has on the classifier's weighted score, and any of them could be
      // rewritten — files_changed to 0.9, new_files to 0.99 — with the whole
      // suite still green. The mix is a decision about what makes a change
      // ceremonious, so it gets asserted as a decision. Comparing the whole map
      // at once also pins the signal ROSTER: a renamed or dropped axis fails
      // here rather than quietly narrowing what the classifier sees.
      const git = createMockGit({
        diffSummary: diffSummaryOf([
          { file: 'package.json', insertions: 5, deletions: 2 },
          { file: 'src/index.ts', insertions: 10, deletions: 3 },
        ]),
        status: vi.fn().mockResolvedValue({ created: ['src/index.ts'], not_added: [] }),
        diff: vi.fn().mockResolvedValue('"dependencies": {\n+    "foo": "^1.0.0"\n'),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      expect(Object.fromEntries(signals.map(s => [s.name, s.weight]))).toEqual({
        files_changed: 0.3,
        lines_changed: 0.25,
        file_types: 0.15,
        cross_directory: 0.15,
        new_files: 0.1,
        dependency_change: 0.2,
      });
    });

    it('all signals have valid tier contributions', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 5, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const validTiers = ['T1', 'T2', 'T3', 'T4'];
      for (const signal of signals) {
        expect(validTiers).toContain(signal.tierContribution);
      }
    });
  });

  describe('the directory and file-type axes are not interchangeable', () => {
    // Every other fixture in this file either changes both axes together (each
    // file in its own directory with its own extension) or asserts only one of
    // them, so the two counts coincide and nothing pins WHICH set feeds which
    // signal. Under that coincidence, counting filenames instead of
    // directories — or handing crossDirectoryTier the extension set and
    // fileTypeTier the directory set — is invisible. These two fixtures pull
    // the counts apart in opposite directions, so each signal can only be right
    // for the right reason.

    it('reports ONE directory and TWO file types for two files in one directory', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([
          { file: 'src/a.ts', insertions: 1 },
          { file: 'src/b.md', insertions: 1 },
        ]),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      // Directories, not filenames: two distinct files, one containing dir.
      const crossDir = findSignal(signals, 'cross_directory')!;
      expect(crossDir.value).toBe(1);
      expect(crossDir.tierContribution).toBe('T1');

      // ts + md. Two types is the T2 rung — pinning the `<= 1` edge of T1.
      const fileTypes = findSignal(signals, 'file_types')!;
      expect(fileTypes.value).toBe(2);
      expect(fileTypes.tierContribution).toBe('T2');
    });

    it('reports TWO directories and ONE file type for one extension spread across two dirs', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([
          { file: 'src/a.ts', insertions: 1 },
          { file: 'lib/b.ts', insertions: 1 },
        ]),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      // Two dirs is the T2 rung specifically: neither the T1 arm below it nor
      // the T3 fallthrough above it, both of which 2 would reach if either
      // bound moved by one.
      const crossDir = findSignal(signals, 'cross_directory')!;
      expect(crossDir.value).toBe(2);
      expect(crossDir.tierContribution).toBe('T2');

      const fileTypes = findSignal(signals, 'file_types')!;
      expect(fileTypes.value).toBe(1);
      expect(fileTypes.tierContribution).toBe('T1');
    });
  });

  describe('file extension handling', () => {
    it('handles files with no extension', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'Makefile', insertions: 3, deletions: 0, binary: false },
            { file: 'Dockerfile', insertions: 5, deletions: 2, binary: false },
          ],
          changed: 2,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      // Files with no extension: extensions set should be empty,
      // file_types should report 0 extensions (handled gracefully)
      const fileTypes = findSignal(signals, 'file_types');
      expect(fileTypes).toBeDefined();
      // No extensions detected = 0 types, which maps to T1 (<=1)
      expect(fileTypes!.value).toBe(0);
      expect(fileTypes!.tierContribution).toBe('T1');
    });

    it('handles mixed extensions correctly', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [
            { file: 'src/app.ts', insertions: 10, deletions: 0, binary: false },
            { file: 'styles/main.css', insertions: 5, deletions: 0, binary: false },
            { file: 'index.html', insertions: 3, deletions: 1, binary: false },
          ],
          changed: 3,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const fileTypes = findSignal(signals, 'file_types');
      expect(fileTypes).toBeDefined();
      expect(fileTypes!.value).toBe(3); // ts, css, html
      expect(fileTypes!.tierContribution).toBe('T3');
    });

    it('counts .TS and .ts as ONE file type', async () => {
      // Extensions are a diversity measure, and case is not diversity: a repo
      // with a stray `Component.TSX` next to `helper.tsx` is not touching two
      // kinds of file. Every other fixture here is lowercase throughout, so
      // dropping the fold went unnoticed while inflating file_types — and that
      // signal only has three rungs, so one phantom type is a whole tier.
      const git = createMockGit({
        diffSummary: diffSummaryOf([
          { file: 'src/A.TS', insertions: 1 },
          { file: 'src/b.ts', insertions: 1 },
        ]),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const fileTypes = findSignal(signals, 'file_types')!;
      expect(fileTypes.value).toBe(1);
      expect(fileTypes.tierContribution).toBe('T1');
    });

    it('folds the extracted extension, not the whole path', async () => {
      // Sibling of the case above, guarding the other way the fold can be
      // written: extracting from an already-lowercased path. That agrees with
      // "extract, then fold" on every ASCII path (verified by brute force —
      // zero disagreements), so ordinary fixtures cannot separate them. The one
      // input that can is Greek final sigma: JS `toLowerCase` is
      // context-sensitive, and a trailing capital sigma becomes 'ς' when it is
      // preceded by a cased letter (as in the full path 'src/x.Σ') but plain
      // 'σ' when the extension 'Σ' is folded on its own. So the two spellings
      // below are one type under the contract and two under the swap.
      // Microscopic, admittedly — but it is the contract (`getExtension`
      // promises the file's extension, lowercased) and it costs four lines.
      const git = createMockGit({
        diffSummary: diffSummaryOf([
          { file: 'src/x.Σ', insertions: 1 },
          { file: 'src/y.σ', insertions: 1 },
        ]),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      expect(findSignal(signals, 'file_types')!.value).toBe(1);
    });
  });

  describe('status call failure graceful handling', () => {
    it('still returns signals when git status fails (new_files defaults to 0)', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 5, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockRejectedValue(new Error('status failed')),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      expect(signals.length).toBeGreaterThan(0);
      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles).toBeDefined();
      expect(newFiles!.value).toBe(0);
      expect(newFiles!.tierContribution).toBe('T1');
    });
  });

  describe('partial git status payloads', () => {
    // The `?? []` fallbacks on `status.created` / `status.not_added` look
    // cosmetic but are load-bearing, and the shared catch below them hides that:
    // drop a `??` and the property access throws, the catch swallows it, and
    // new_files silently collapses to 0. Telling those apart therefore needs a
    // case where the SURVIVING array is non-empty — otherwise "0" is the answer
    // both with and without the guard, and the test proves nothing.

    it('counts untracked files when status omits `created` entirely', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 5, deletions: 0, binary: false }],
          changed: 1,
        }),
        // No `created` key at all — what a partial/older status payload looks like.
        status: vi.fn().mockResolvedValue({ not_added: ['n1.ts', 'n2.ts'] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git, staged: false });

      // 0 staged-new + 2 untracked. Without `created ?? []` this throws before
      // the addition and the catch reports 0 instead.
      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles!.value).toBe(2);
      expect(newFiles!.tierContribution).toBe('T2');
    });

    it('counts staged-new files when status omits `not_added` entirely', async () => {
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 5, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: ['a.ts'] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git, staged: false });

      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles!.value).toBe(1);
      expect(newFiles!.tierContribution).toBe('T2');
    });

    it('ignores untracked files in staged mode even when status lists them', async () => {
      // Pins the `staged ? stagedNew.length : ...` split: --cached can only ever
      // see the index, so an untracked file must not inflate the new-file count.
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'a.ts', insertions: 5, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: ['n1.ts', 'n2.ts', 'n3.ts'] }),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git, staged: true });

      const newFiles = findSignal(signals, 'new_files');
      expect(newFiles!.value).toBe(0);
      expect(newFiles!.tierContribution).toBe('T1');
    });
  });

  describe('dependency detection degrades rather than disappears', () => {
    it('still emits dependency_change (false/T2) when the package.json diff read throws', async () => {
      // The signal's EXISTENCE comes from the diffSummary file list; only its
      // upgrade to T3 depends on reading the patch. A failed read must therefore
      // leave a T2 signal standing, not drop the dependency axis on the floor.
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'package.json', insertions: 4, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: vi.fn().mockRejectedValue(new Error('git diff exploded')),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(false);
      expect(depChange!.tierContribution).toBe('T2');
    });

    it('omits --cached from the dependency diff when reading the working tree', async () => {
      // Working-tree mode must not ask git for the *staged* package.json patch,
      // or an unstaged dependency add reads as "no new deps".
      const diffMock = vi.fn().mockResolvedValue(
        '--- a/package.json\n+++ b/package.json\n "dependencies": {\n+    "zod": "^3.23.0"\n',
      );
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'package.json', insertions: 1, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: diffMock,
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git, staged: false });

      expect(diffMock).toHaveBeenCalledWith(['--', 'package.json', '**/package.json']);
      expect(findSignal(signals, 'dependency_change')!.value).toBe(true);
    });

    it('treats a nested package.json as a dependency surface too', async () => {
      // basename-based detection, not a root-only match: a monorepo package's
      // own manifest is just as much a dependency change.
      const git = createMockGit({
        diffSummary: vi.fn().mockResolvedValue({
          files: [{ file: 'packages/minspec/package.json', insertions: 1, deletions: 0, binary: false }],
          changed: 1,
        }),
        status: vi.fn().mockResolvedValue({ created: [], not_added: [], staged: [] }),
        diff: vi.fn().mockResolvedValue(
          '--- a/packages/minspec/package.json\n+++ b/packages/minspec/package.json\n "devDependencies": {\n+    "vitest": "^4.1.7"\n',
        ),
      });

      const signals = await analyzeGitDiff('/tmp/repo', { git });

      const depChange = findSignal(signals, 'dependency_change');
      expect(depChange).toBeDefined();
      expect(depChange!.value).toBe(true);
      expect(depChange!.tierContribution).toBe('T3');
    });
  });

  describe('against a real repository', () => {
    it('derives signals from a real staged diff with no injected git', async () => {
      // Exercises the `simpleGit(repoPath)` construction the mocked tests skip,
      // and proves the metrics survive a round trip through real diffSummary /
      // status parsing rather than our idea of their shape.
      const repo = makeTmpDir();
      initRepo(repo);
      write(repo, 'src/a.ts', 'export const a = 1;\n');
      runGit(['add', '-A'], repo);
      runGit(['commit', '-m', 'init'], repo);

      write(repo, 'src/a.ts', 'export const a = 2;\nexport const b = 3;\n');
      write(repo, 'docs/notes.md', '# notes\nline\n');
      runGit(['add', '-A'], repo);

      const signals = await analyzeGitDiff(repo);

      expect(findSignal(signals, 'files_changed')!.value).toBe(2);
      // a.ts: +2/-1, notes.md: +2/-0 → 5 changed lines.
      expect(findSignal(signals, 'lines_changed')!.value).toBe(5);
      expect(findSignal(signals, 'file_types')!.value).toBe(2); // ts, md
      expect(findSignal(signals, 'cross_directory')!.value).toBe(2); // src, docs
      // notes.md is the only path absent from HEAD.
      expect(findSignal(signals, 'new_files')!.value).toBe(1);
      expect(findSignal(signals, 'dependency_change')).toBeUndefined();
    }, 30000);

    it('returns no signals for a directory that is not a git repository', async () => {
      // The real `--is-inside-work-tree` failure path, not a mocked rejection.
      const notARepo = makeTmpDir();
      write(notARepo, 'a.ts', 'export const a = 1;\n');

      expect(await analyzeGitDiff(notARepo)).toEqual([]);
    }, 30000);
  });
});

// ─── buildConsequenceInput (SPEC-023 FR-7 — the IO seam) ─────────────────────
// This is the boundary the pure consequence analyzers sit behind: every git and
// disk read for the consequence axis happens here, and everything downstream is
// pure. Two failure modes matter more than the happy path — reading the WRONG
// side of a change (index vs disk vs HEAD), and throwing instead of degrading,
// because a throw here takes the whole classify command down with it.

describe('buildConsequenceInput()', () => {
  describe('against a real repository', () => {
    it('maps a real staged add/modify/delete onto statuses and both content sides', async () => {
      const repo = makeTmpDir();
      initRepo(repo);
      write(repo, 'src/keep.ts', 'export const keep = 1;\n');
      write(repo, 'src/gone.ts', 'export const gone = 1;\n');
      runGit(['add', '-A'], repo);
      runGit(['commit', '-m', 'init'], repo);

      write(repo, 'src/keep.ts', 'export const keep = 2;\nexport const extra = 3;\n');
      runGit(['rm', 'src/gone.ts'], repo);
      write(repo, 'src/brand-new.ts', 'export const fresh = 1;\n');
      runGit(['add', '-A'], repo);

      // No injected git — the real simpleGit(repoPath) path.
      const input = await buildConsequenceInput(repo);

      // v1 has no reference index; analyzers rely on this staying null.
      expect(input.refIndex).toBeNull();

      const files = byPath(input);
      expect([...files.keys()].sort()).toEqual([
        'src/brand-new.ts',
        'src/gone.ts',
        'src/keep.ts',
      ]);

      const added = files.get('src/brand-new.ts')!;
      expect(added.status).toBe('added');
      expect(added.content).toBe('export const fresh = 1;\n');
      expect(added.oldContent).toBeUndefined(); // absent from HEAD
      expect(added.insertions).toBe(1);
      expect(added.deletions).toBe(0);

      const removed = files.get('src/gone.ts')!;
      expect(removed.status).toBe('deleted');
      expect(removed.content).toBeUndefined();
      expect(removed.oldContent).toBe('export const gone = 1;\n');

      const modified = files.get('src/keep.ts')!;
      expect(modified.status).toBe('modified');
      // Both sides, and they must differ — a delta the analyzers can act on.
      expect(modified.content).toBe('export const keep = 2;\nexport const extra = 3;\n');
      expect(modified.oldContent).toBe('export const keep = 1;\n');
      expect(modified.insertions).toBe(2);
      expect(modified.deletions).toBe(1);
    }, 30000);

    it('reads working-tree content from DISK, not from the index', async () => {
      // Three distinct versions of one file — HEAD=v1, INDEX=v2, DISK=v3 — so the
      // returned content names exactly which source was read. `git show :a.ts`
      // would answer v2 and look perfectly plausible; only a disk read gives v3.
      const repo = makeTmpDir();
      initRepo(repo);
      write(repo, 'a.ts', 'v1-head\n');
      runGit(['add', '-A'], repo);
      runGit(['commit', '-m', 'init'], repo);

      write(repo, 'a.ts', 'v2-staged\n');
      runGit(['add', 'a.ts'], repo);
      write(repo, 'a.ts', 'v3-working\n');

      const input = await buildConsequenceInput(repo, { staged: false });

      const file = byPath(input).get('a.ts')!;
      expect(file.status).toBe('modified');
      expect(file.content).toBe('v3-working\n');
      expect(file.oldContent).toBe('v1-head\n'); // old side is always HEAD
    }, 30000);

    it('returns an empty input for a directory that is not a git repository', async () => {
      const notARepo = makeTmpDir();
      write(notARepo, 'a.ts', 'export const a = 1;\n');

      expect(await buildConsequenceInput(notARepo)).toEqual({
        changedFiles: [],
        refIndex: null,
      });
    }, 30000);

    it('returns an empty input for a clean repository', async () => {
      const repo = makeTmpDir();
      initRepo(repo);
      write(repo, 'a.ts', 'export const a = 1;\n');
      runGit(['add', '-A'], repo);
      runGit(['commit', '-m', 'init'], repo);

      const input = await buildConsequenceInput(repo);
      expect(input.changedFiles).toEqual([]);
      expect(input.refIndex).toBeNull();
    }, 30000);
  });

  describe('what it declines to ask git for', () => {
    // Real git throws for `:<deleted>` and `HEAD:<added>`, so a real-repo test
    // cannot distinguish "we skipped the read" from "we asked and it failed".
    // These use an all-answering `show` mock so the skip is the only explanation
    // for an undefined side, and assert the call log directly.

    it('never requests new content for a deleted file', async () => {
      const show = echoShow();
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'src/gone.ts', deletions: 9 }]),
        status: vi.fn().mockResolvedValue({ deleted: ['src/gone.ts'] }),
        show,
      });

      const file = byPath(await buildConsequenceInput('/tmp/repo', { git })).get('src/gone.ts')!;

      expect(file.status).toBe('deleted');
      expect(file.content).toBeUndefined();
      expect(file.oldContent).toBe('blob(HEAD:src/gone.ts)');
      expect(show).toHaveBeenCalledTimes(1); // the HEAD side only
      expect(show).not.toHaveBeenCalledWith([':src/gone.ts']);
    });

    it('never requests old content for an added file', async () => {
      const show = echoShow();
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'src/new.ts', insertions: 9 }]),
        status: vi.fn().mockResolvedValue({ created: ['src/new.ts'] }),
        show,
      });

      const file = byPath(await buildConsequenceInput('/tmp/repo', { git })).get('src/new.ts')!;

      expect(file.status).toBe('added');
      expect(file.content).toBe('blob(:src/new.ts)');
      expect(file.oldContent).toBeUndefined();
      expect(show).toHaveBeenCalledTimes(1); // the index side only
      expect(show).not.toHaveBeenCalledWith(['HEAD:src/new.ts']);
    });

    it('asks for the staged diff by default and the working-tree diff on request', async () => {
      const staged = diffSummaryOf([]);
      await buildConsequenceInput('/tmp/repo', { git: createMockGit({ diffSummary: staged }) });
      expect(staged).toHaveBeenCalledWith(['--cached']);

      const worktree = diffSummaryOf([]);
      await buildConsequenceInput('/tmp/repo', {
        git: createMockGit({ diffSummary: worktree }),
        staged: false,
      });
      expect(worktree).toHaveBeenCalledWith([]);
    });

    it('does not touch the diff at all when the path is not a git repo', async () => {
      // Without the isGitRepo guard this still returns an empty input (the mock
      // has no files), so the guard is only observable in the call log.
      const diffSummary = diffSummaryOf([{ file: 'a.ts' }]);
      const git = createMockGit({
        revparse: vi.fn().mockResolvedValue('false'),
        diffSummary,
      });

      expect(await buildConsequenceInput('/tmp/nope', { git })).toEqual({
        changedFiles: [],
        refIndex: null,
      });
      expect(diffSummary).not.toHaveBeenCalled();
    });

    it('returns an empty input instead of rejecting when diffSummary throws', async () => {
      // buildConsequenceInput is awaited inside the classify command; an
      // unhandled rejection here would take the whole classification down rather
      // than dropping the consequence axis. Resolving at all is the assertion.
      const status = vi.fn().mockResolvedValue({ created: [], not_added: [] });
      const git = createMockGit({
        diffSummary: vi.fn().mockRejectedValue(new Error('diff exploded')),
        status,
      });

      expect(await buildConsequenceInput('/tmp/repo', { git })).toEqual({
        changedFiles: [],
        refIndex: null,
      });
      expect(status).not.toHaveBeenCalled(); // bailed before the status probe
    });
  });

  describe('status classification', () => {
    it('resolves deleted over renamed over added when a path is in several categories', async () => {
      // Overlaps are real (a staged rename whose destination is then removed
      // lands in both `renamed` and `deleted`), so the precedence is a decision,
      // not an accident. Reordering the checks in statusFromGit flips this.
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'p.ts' }]),
        status: vi.fn().mockResolvedValue({
          created: ['p.ts'],
          deleted: ['p.ts'],
          renamed: [{ from: 'q.ts', to: 'p.ts' }],
        }),
      });

      expect(byPath(await buildConsequenceInput('/tmp/repo', { git })).get('p.ts')!.status)
        .toBe('deleted');
    });

    it('resolves renamed over added when a path is in both', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'p.ts' }]),
        status: vi.fn().mockResolvedValue({
          created: ['p.ts'],
          renamed: [{ from: 'q.ts', to: 'p.ts' }],
        }),
      });

      expect(byPath(await buildConsequenceInput('/tmp/repo', { git })).get('p.ts')!.status)
        .toBe('renamed');
    });

    it('falls back to modified for a path git did not categorise', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'plain.ts', insertions: 3, deletions: 1 }]),
        status: vi.fn().mockResolvedValue({ created: ['other.ts'], deleted: ['gone.ts'] }),
      });

      const file = byPath(await buildConsequenceInput('/tmp/repo', { git })).get('plain.ts')!;
      expect(file.status).toBe('modified');
      expect(file.insertions).toBe(3);
      expect(file.deletions).toBe(1);
    });

    it('treats untracked files as added in working-tree mode only', async () => {
      // NOTE: plain `git diff` never lists untracked paths, so against real git
      // this mapping is only reachable when the diff source does surface them.
      // It is still the documented contract for staged=false, and the staged
      // side below is the half that must NOT fire (an untracked file is by
      // definition absent from the index).
      const summary = () => diffSummaryOf([{ file: 'fresh.ts', insertions: 4 }]);
      const status = () => vi.fn().mockResolvedValue({ created: [], not_added: ['fresh.ts'] });

      const wt = await buildConsequenceInput('/tmp/repo', {
        git: createMockGit({ diffSummary: summary(), status: status(), show: echoShow() }),
        staged: false,
      });
      expect(byPath(wt).get('fresh.ts')!.status).toBe('added');

      const idx = await buildConsequenceInput('/tmp/repo', {
        git: createMockGit({ diffSummary: summary(), status: status(), show: echoShow() }),
        staged: true,
      });
      expect(byPath(idx).get('fresh.ts')!.status).toBe('modified');
    });

    it('keeps classifying later categories when an earlier status array is absent', async () => {
      // The `?? []` fallbacks matter because the surrounding catch hides their
      // absence: without them the first missing array throws mid-loop, the catch
      // swallows it, and every remaining file silently degrades to 'modified'.
      // Omitting `created` while `deleted` and `renamed` are populated is the
      // shape that separates "guarded" from "swallowed".
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'd.ts' }, { file: 'r.ts' }]),
        status: vi.fn().mockResolvedValue({
          deleted: ['d.ts'],
          renamed: [{ from: 'r0.ts', to: 'r.ts' }],
        }),
      });

      const files = byPath(await buildConsequenceInput('/tmp/repo', { git }));
      expect(files.get('d.ts')!.status).toBe('deleted');
      expect(files.get('r.ts')!.status).toBe('renamed');
    });

    it('keeps classifying in working-tree mode when `not_added` is absent', async () => {
      // Same swallowed-throw hazard as above, on the one `?? []` that only
      // evaluates under staged=false. `renamed` is read AFTER it, so a missing
      // guard here silently costs the rename classification.
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'a.ts' }, { file: 'r.ts' }]),
        status: vi.fn().mockResolvedValue({
          created: ['a.ts'],
          renamed: [{ from: 'r0.ts', to: 'r.ts' }],
        }),
        show: echoShow(),
      });

      const files = byPath(await buildConsequenceInput(makeTmpDir(), { git, staged: false }));
      expect(files.get('a.ts')!.status).toBe('added');
      expect(files.get('r.ts')!.status).toBe('renamed');
    });

    it('keeps classifying when `deleted` is absent but later categories are not', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'a.ts' }, { file: 'r.ts' }]),
        status: vi.fn().mockResolvedValue({
          created: ['a.ts'],
          renamed: [{ from: 'r0.ts', to: 'r.ts' }],
        }),
      });

      const files = byPath(await buildConsequenceInput('/tmp/repo', { git }));
      expect(files.get('a.ts')!.status).toBe('added');
      expect(files.get('r.ts')!.status).toBe('renamed');
    });

    it('survives a rename entry with no destination and still classifies its siblings', async () => {
      // Robustness, not discrimination: the `if (to)` guard's only current effect
      // is keeping `undefined` out of a Set<string>, which no observation can
      // see. What IS observable is that a malformed entry must not abort the
      // loop and strand the well-formed ones — that is what this pins.
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'x.ts' }, { file: 'y2.ts' }]),
        status: vi.fn().mockResolvedValue({
          renamed: [{ from: 'x0.ts' }, { from: 'y.ts', to: 'y2.ts' }],
        }),
      });

      const files = byPath(await buildConsequenceInput('/tmp/repo', { git }));
      expect(files.get('y2.ts')!.status).toBe('renamed');
      expect(files.get('x.ts')!.status).toBe('modified');
    });

    it('degrades every file to modified when git status is unavailable', async () => {
      // A status failure must not take the classify command down; the diff-side
      // facts (paths, counts, contents) are still worth having.
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'a.ts', insertions: 2, deletions: 1 }]),
        status: vi.fn().mockRejectedValue(new Error('status unavailable')),
        show: echoShow(),
      });

      const input = await buildConsequenceInput('/tmp/repo', { git });

      expect(input.changedFiles).toHaveLength(1);
      const file = input.changedFiles[0];
      expect(file.status).toBe('modified');
      expect(file.insertions).toBe(2);
      expect(file.content).toBe('blob(:a.ts)');
      expect(file.oldContent).toBe('blob(HEAD:a.ts)');
    });
  });

  describe('per-file read failures degrade instead of throwing', () => {
    it('leaves content undefined when the index read fails but keeps the old side', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'a.ts', insertions: 1 }]),
        show: vi.fn().mockImplementation(async (args: string[]) =>
          args[0].startsWith(':')
            ? Promise.reject(new Error('binary or missing blob'))
            : `old(${args[0]})`,
        ),
      });

      const file = (await buildConsequenceInput('/tmp/repo', { git })).changedFiles[0];
      expect(file.content).toBeUndefined();
      expect(file.oldContent).toBe('old(HEAD:a.ts)');
    });

    it('leaves oldContent undefined when the HEAD read fails but keeps the new side', async () => {
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'a.ts', insertions: 1 }]),
        show: vi.fn().mockImplementation(async (args: string[]) =>
          args[0].startsWith('HEAD:')
            ? Promise.reject(new Error('no such path in HEAD'))
            : `new(${args[0]})`,
        ),
      });

      const file = (await buildConsequenceInput('/tmp/repo', { git })).changedFiles[0];
      expect(file.content).toBe('new(:a.ts)');
      expect(file.oldContent).toBeUndefined();
    });

    it('leaves content undefined when a working-tree file is missing from disk', async () => {
      // An empty real directory as repoPath: the join resolves, the read fails.
      // The entry must survive with its diff-side facts intact.
      const emptyDir = makeTmpDir();
      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: 'ghost.ts', insertions: 7, deletions: 2 }]),
        show: vi.fn().mockRejectedValue(new Error('no HEAD')),
      });

      const input = await buildConsequenceInput(emptyDir, { git, staged: false });

      expect(input.changedFiles).toHaveLength(1);
      expect(input.changedFiles[0].content).toBeUndefined();
      expect(input.changedFiles[0].insertions).toBe(7);
      expect(input.changedFiles[0].deletions).toBe(2);
    });

    it('uses an absolute diff path as-is rather than re-rooting it under repoPath', async () => {
      // repoPath is deliberately a DIFFERENT directory: joining it with an
      // absolute path yields `<repoPath>/<abs>`, which does not exist, so a
      // populated content proves the isAbsolute branch ran.
      const elsewhere = makeTmpDir();
      const abs = write(elsewhere, 'outside.ts', 'absolute-content\n');
      const otherRepo = makeTmpDir();

      const git = createMockGit({
        diffSummary: diffSummaryOf([{ file: abs, insertions: 1 }]),
        show: vi.fn().mockRejectedValue(new Error('no HEAD')),
      });

      const input = await buildConsequenceInput(otherRepo, { git, staged: false });
      expect(input.changedFiles[0].content).toBe('absolute-content\n');
    });
  });
});

// ─── Binary files — KNOWN SOURCE DEFECT (#1197) ──────────────────────────────

describe('binary files', () => {
  // #1197 — a staged binary file makes lines_changed NaN and floors the whole
  // change at T4. Fix it there, then drop the two `.fails` markers below.
  //
  // simple-git types a diff entry as `DiffResultTextFile | DiffResultBinaryFile`,
  // and the binary arm carries `before`/`after` BYTE counts — it has no
  // `insertions`/`deletions` at all (simple-git/dist/typings/response.d.ts:147).
  // git-analyzer.ts asserts the whole array to its own local `DiffFile`, which
  // declares both as `number`, so the union is erased at compile time and the
  // absent fields surface only at runtime:
  //
  //   totalLines = files.reduce((sum, f) => sum + f.insertions + f.deletions, 0)
  //              = 2 + undefined + undefined
  //              = NaN
  //
  // NaN fails every `<=` in lineCountTier, so it falls through to 'T4' — one
  // added icon floors the whole change at T4 ceremony. Across the seam,
  // buildConsequenceInput hands the pure analyzers `insertions: undefined`
  // against a `readonly insertions: number` field.
  //
  // That is a SOURCE defect, not a coverage gap, so the two statements of
  // correct behaviour below are `it.fails`: they hold today only because the
  // assertion inside them throws, and they go red the moment the source is
  // fixed — which is the cue to drop the `.fails`. Asserting NaN in a normal
  // test would make this file certify the bug as the contract instead.
  //
  // `it.fails` is satisfied by ANY throw, including a broken fixture, so the
  // two plain tests either side share the same fixture and keep it honest.

  it('counts a binary file in files_changed like any other path', async () => {
    // True today and still true after the fix: a binary file IS a changed file.
    // Only the LINE arithmetic over it is undefined.
    const signals = await analyzeGitDiff(repoWithStagedBinary());
    expect(findSignal(signals, 'files_changed')!.value).toBe(2);
  }, 30000);

  it.fails('SHOULD total the text side only — today it is NaN, which reads as T4', async () => {
    const signals = await analyzeGitDiff(repoWithStagedBinary());
    const lines = findSignal(signals, 'lines_changed')!;
    expect(lines.value).toBe(2); // a.ts +1/-1; logo.png contributes no lines
    expect(lines.tierContribution).toBe('T1');
  }, 30000);

  it('keeps a binary file in the consequence input', async () => {
    // The consequence axis measures blast radius, not line volume, and a
    // swapped binary — a vendored jar, a signing key, an icon — is exactly the
    // kind of change it should be able to see. Filtering binaries out here to
    // dodge the arithmetic above would be a silent narrowing of what the
    // analyzers are shown, so their PRESENCE is asserted for real.
    const files = byPath(await buildConsequenceInput(repoWithStagedBinary()));
    expect([...files.keys()].sort()).toEqual(['a.ts', 'logo.png']);
    expect(files.get('logo.png')!.status).toBe('added');
    expect(files.get('a.ts')!.insertions).toBe(1);
  }, 30000);

  it.fails('SHOULD give a binary file numeric line counts — today they are undefined', async () => {
    const file = byPath(await buildConsequenceInput(repoWithStagedBinary())).get('logo.png')!;
    expect(file.insertions).toBe(0);
    expect(file.deletions).toBe(0);
  }, 30000);
});
