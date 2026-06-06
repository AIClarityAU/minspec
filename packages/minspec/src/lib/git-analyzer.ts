import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import * as path from 'path';

import type { Tier } from './config';
import type { ClassificationSignal } from './classifier';
import type {
  ChangedFile,
  ChangeStatus,
  ConsequenceInput,
} from './consequence-analyzers';
export type { ClassificationSignal };

/** Options for the git analyzer */
export interface GitAnalyzerOptions {
  /** Whether to analyze staged changes (--cached) or working tree */
  staged?: boolean;
  /** Inject a SimpleGit instance for testing */
  git?: SimpleGit;
}

/** Parsed diff file entry from simple-git */
interface DiffFile {
  file: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Determine tier contribution based on file count.
 * 1-2 = T1, 3-5 = T2, 6-15 = T3, 16+ = T4
 */
function fileCountTier(count: number): Tier {
  if (count <= 2) return 'T1';
  if (count <= 5) return 'T2';
  if (count <= 15) return 'T3';
  return 'T4';
}

/**
 * Determine tier contribution based on total line count.
 * 1-20 = T1, 21-100 = T2, 101-500 = T3, 501+ = T4
 */
function lineCountTier(lines: number): Tier {
  if (lines <= 20) return 'T1';
  if (lines <= 100) return 'T2';
  if (lines <= 500) return 'T3';
  return 'T4';
}

/**
 * Determine tier contribution based on file type diversity.
 * All same extension = T1, 2 types = T2, 3+ = T3
 */
function fileTypeTier(extensions: Set<string>): Tier {
  const count = extensions.size;
  if (count <= 1) return 'T1';
  if (count === 2) return 'T2';
  return 'T3';
}

/**
 * Determine tier contribution based on cross-directory changes.
 * Same dir = T1, 2 dirs = T2, 3+ = T3
 */
function crossDirectoryTier(directories: Set<string>): Tier {
  const count = directories.size;
  if (count <= 1) return 'T1';
  if (count === 2) return 'T2';
  return 'T3';
}

/**
 * Determine tier contribution for new files.
 * 0 new = T1, 1-2 = T2, 3+ = T3
 */
function newFilesTier(newFileCount: number): Tier {
  if (newFileCount === 0) return 'T1';
  if (newFileCount <= 2) return 'T2';
  return 'T3';
}

/**
 * Check if a repo exists and is a git repository.
 * Returns true if the path is inside a git working tree.
 */
async function isGitRepo(git: SimpleGit): Promise<boolean> {
  try {
    const result = await git.revparse(['--is-inside-work-tree']);
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Extract file extension from a file path.
 * Returns the extension without the dot, or empty string for no extension.
 */
function getExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return ext ? ext.slice(1).toLowerCase() : '';
}

/**
 * Extract the directory portion of a file path.
 * Root-level files get '.' as their directory.
 */
function getDirectory(filePath: string): string {
  const dir = path.dirname(filePath);
  return dir || '.';
}

/**
 * Analyze the current git diff and produce classification signals.
 *
 * Works on staged changes (--cached) by default, falling back to working tree changes.
 * Returns empty signals array if not in a git repo or no changes detected.
 *
 * @param repoPath - Absolute path to the repository root
 * @param options - Configuration options (staged vs working tree, injected git instance)
 * @returns Array of classification signals for the tier classification engine
 */
export async function analyzeGitDiff(
  repoPath: string,
  options: GitAnalyzerOptions = {},
): Promise<ClassificationSignal[]> {
  const { staged = true, git: injectedGit } = options;

  const git = injectedGit ?? simpleGit(repoPath);

  // Check this is actually a git repo
  if (!(await isGitRepo(git))) {
    return [];
  }

  // Get diff summary — staged or working tree
  const diffArgs = staged ? ['--cached'] : [];
  let diffSummary;
  try {
    diffSummary = await git.diffSummary(diffArgs);
  } catch {
    return [];
  }

  const files = diffSummary.files as DiffFile[];

  // No changes = no signals
  if (files.length === 0) {
    return [];
  }

  // Compute raw metrics
  const fileCount = files.length;
  const totalLines = files.reduce((sum, f) => sum + f.insertions + f.deletions, 0);

  const extensions = new Set<string>();
  const directories = new Set<string>();
  let newFileCount = 0;
  let hasPackageJsonChange = false;
  let hasNewDependencies = false;

  for (const file of files) {
    const ext = getExtension(file.file);
    if (ext) extensions.add(ext);
    directories.add(getDirectory(file.file));

    // Detect package.json changes
    if (path.basename(file.file) === 'package.json') {
      hasPackageJsonChange = true;
    }
  }

  // Detect new files via git status (diff summary doesn't distinguish new vs modified)
  try {
    const statusResult = await git.status();
    const stagedNew = statusResult.created ?? [];
    const untrackedFiles = staged ? [] : (statusResult.not_added ?? []);
    newFileCount = staged ? stagedNew.length : stagedNew.length + untrackedFiles.length;
  } catch {
    // If status fails, fall back to no new files
    newFileCount = 0;
  }

  // Check if package.json changes include new dependencies.
  // Pathspec must cover BOTH a repo-root `package.json` and nested ones:
  // git's `**/package.json` glob matches nested files only, never the root file,
  // so the bare `package.json` pathspec is required to catch root dependency edits.
  if (hasPackageJsonChange) {
    try {
      const diffOutput = await git.diff([
        ...(staged ? ['--cached'] : []),
        '--',
        'package.json',
        '**/package.json',
      ]);
      // Look for lines adding dependencies/devDependencies entries
      const addedLines = diffOutput
        .split('\n')
        .filter(line => line.startsWith('+') && !line.startsWith('+++'));
      hasNewDependencies = addedLines.some(line =>
        /^\+\s*"[^"]+"\s*:\s*"[^"]*"/.test(line) &&
        (diffOutput.includes('"dependencies"') || diffOutput.includes('"devDependencies"')),
      );
    } catch {
      // If diff parsing fails, just use the boolean change signal
      hasNewDependencies = false;
    }
  }

  // Build signals array
  const signals: ClassificationSignal[] = [];

  // File count signal
  signals.push({
    name: 'files_changed',
    value: fileCount,
    weight: 0.3,
    tierContribution: fileCountTier(fileCount),
  });

  // Line count signal
  signals.push({
    name: 'lines_changed',
    value: totalLines,
    weight: 0.25,
    tierContribution: lineCountTier(totalLines),
  });

  // File types diversity signal
  signals.push({
    name: 'file_types',
    value: extensions.size,
    weight: 0.15,
    tierContribution: fileTypeTier(extensions),
  });

  // Cross-directory signal
  signals.push({
    name: 'cross_directory',
    value: directories.size,
    weight: 0.15,
    tierContribution: crossDirectoryTier(directories),
  });

  // New files signal
  signals.push({
    name: 'new_files',
    value: newFileCount,
    weight: 0.1,
    tierContribution: newFilesTier(newFileCount),
  });

  // Dependency changes signal (only emitted when package.json is changed)
  if (hasPackageJsonChange) {
    signals.push({
      name: 'dependency_change',
      value: hasNewDependencies,
      weight: 0.2,
      tierContribution: hasNewDependencies ? 'T3' : 'T2',
    });
  }

  return signals;
}

// ─── Consequence input (SPEC-023 FR-7 — the IO seam) ─────────────────────────

/**
 * Map a git status (`status.files[].index`/`working_dir` letters, or a category
 * array) to the normalized {@link ChangeStatus}. Defaults to `'modified'`.
 */
function statusFromGit(
  filePath: string,
  created: Set<string>,
  deleted: Set<string>,
  renamed: Set<string>,
): ChangeStatus {
  if (deleted.has(filePath)) return 'deleted';
  if (renamed.has(filePath)) return 'renamed';
  if (created.has(filePath)) return 'added';
  return 'modified';
}

/**
 * Build the pure {@link ConsequenceInput} for the consequence analyzers from the
 * current git diff. **This is the IO seam** (INV-1): all git/disk reads live here
 * in the analyzer-adjacent IO layer; the analyzers themselves stay pure and
 * receive only data.
 *
 * It reads, per changed file:
 *  - path, insertions, deletions, status (added/modified/deleted/renamed);
 *  - new content (`git show :<path>` staged, or working-tree `git show :<path>`
 *    fallback) and old content (`git show HEAD:<path>`), best-effort.
 *
 * `refIndex` is **always null in v1** — there is no cross-file reference index
 * yet (SPEC-023 Clarification 2); analyzers degrade accordingly.
 *
 * Failures are swallowed per-file (content stays `undefined`) so a partial read
 * degrades gracefully rather than throwing — the analyzers handle missing content.
 */
export async function buildConsequenceInput(
  repoPath: string,
  options: GitAnalyzerOptions = {},
): Promise<ConsequenceInput> {
  const { staged = true, git: injectedGit } = options;
  const git = injectedGit ?? simpleGit(repoPath);

  const empty: ConsequenceInput = { changedFiles: [], refIndex: null };

  if (!(await isGitRepo(git))) return empty;

  let diffSummary;
  try {
    diffSummary = await git.diffSummary(staged ? ['--cached'] : []);
  } catch {
    return empty;
  }
  const files = diffSummary.files as DiffFile[];
  if (files.length === 0) return empty;

  // Classify status from `git status`.
  const created = new Set<string>();
  const deleted = new Set<string>();
  const renamed = new Set<string>();
  try {
    const st = await git.status();
    for (const f of st.created ?? []) created.add(f);
    for (const f of st.deleted ?? []) deleted.add(f);
    if (!staged) for (const f of st.not_added ?? []) created.add(f);
    for (const r of st.renamed ?? []) {
      // simple-git renamed entries: { from, to }
      const to = (r as unknown as { to?: string }).to;
      if (to) renamed.add(to);
    }
  } catch {
    // No status → everything defaults to 'modified'.
  }

  const changedFiles: ChangedFile[] = [];

  for (const file of files) {
    const status = statusFromGit(file.file, created, deleted, renamed);

    let content: string | undefined;
    let oldContent: string | undefined;

    if (status !== 'deleted') {
      // New/current content: the staged blob (`:path`) or, for working-tree
      // mode, the file on disk via the same `:path` falls back to HEAD; read the
      // working tree directly when not staged.
      try {
        if (staged) {
          content = await git.show([`:${file.file}`]);
        } else {
          // Working-tree content: read from disk relative to repo root.
          const abs = path.isAbsolute(file.file)
            ? file.file
            : path.join(repoPath, file.file);
          content = await fsReadFile(abs);
        }
      } catch {
        content = undefined;
      }
    }

    if (status !== 'added') {
      try {
        oldContent = await git.show([`HEAD:${file.file}`]);
      } catch {
        oldContent = undefined;
      }
    }

    changedFiles.push({
      path: file.file,
      insertions: file.insertions,
      deletions: file.deletions,
      status,
      content,
      oldContent,
    });
  }

  return { changedFiles, refIndex: null };
}

/** Best-effort UTF-8 file read; returns undefined on any failure. */
async function fsReadFile(absPath: string): Promise<string | undefined> {
  try {
    // Lazy import keeps fs out of the module's top-level surface; this is the IO
    // layer, so fs is permitted here (analyzers stay pure — INV-1).
    const fs = await import('fs');
    return fs.promises.readFile(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}
