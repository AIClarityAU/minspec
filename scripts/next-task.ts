/**
 * Headless signpost reader — SPEC-076.
 *
 * Answers "what is the one next human action?" for one or more MinSpec projects from a
 * terminal with no editor, no extension host and no workspace open. Prints one JSON
 * document on stdout, one result per requested root, in the order given.
 *
 *   npx tsx scripts/next-task.ts                       # the working directory
 *   npx tsx scripts/next-task.ts ~/code/sealbox ~/code/ColdForge
 *
 * Also wired as `npm run next-task -- <root>...`, which exists for discoverability. Prefer
 * the direct `npx tsx` form when consuming the output, because `npm run` adds its own
 * banner lines to stdout and would break a pipe into `jq` (SPEC-076 FR-5).
 *
 * WHAT THIS IS NOT. It computes nothing. It calls `buildArtifactGraph` +
 * `resolveNextTask` — the exact pair `packages/minspec/src/commands/next-task.ts` calls
 * for the Command Palette — and re-emits the resolver's own `NextTask` unchanged. There is
 * deliberately no ranking, severity or ordering logic in this file (FR-1 / INV-4). Two
 * implementations of "what is next" would drift, and the wrong one would be authoritative;
 * #1948's own option analysis names that cost. If the answer is wrong, it is wrong in the
 * resolver and it is wrong in the editor too, which is the property worth having.
 *
 * WHY THE `.minspec/` CHECK IS NOT OPTIONAL (FR-2, the defect this file exists to avoid).
 * Measured before SPEC-076: `buildArtifactGraph` on a directory with no `.minspec/` returns
 * an EMPTY graph rather than an error, because `loadConfig`
 * (packages/minspec/src/lib/config.ts:139-140) treats a missing config as "use defaults".
 * `resolveNextTask` then returns `null` — which is also the correct answer for a real
 * MinSpec project that simply has nothing pending. Read as the latter, the former tells a
 * supervisor "that project is clear" about a repo MinSpec was never installed in. So a root
 * without the marker is refused by NAME here and never reported as a task of any kind.
 * `.minspec/` is also MinSpec's opt-in marker and blast-radius boundary (DR-074 /
 * constitution invariant 3), so refusing is the correct answer on both counts.
 *
 * WHAT IT MEASURES (FR-4). The WORKING TREE, matching the editor: `getApprovalStatus`
 * (packages/minspec/src/lib/approval.ts:493) hashes the spec file read from disk. Reading
 * `origin/main` instead would answer a different question than the pane and the two would
 * disagree exactly when the tree is dirty. Because these checkouts are shared and routinely
 * dirty, each answer also reports the HEAD sha and a dirty flag so a caller can tell a
 * clean-tree reading from one carrying another session's half-finished work.
 *
 * Offline and read-only (constitution invariants 1 and 3): filesystem plus local git, no
 * network, and it creates, modifies and deletes nothing in any root it is pointed at.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { buildArtifactGraph } from '../packages/minspec/src/lib/artifact-graph';
import {
  formatNextTaskLabel,
  resolveNextTask,
  type NextTask,
} from '../packages/shared/src/next-task';

/** Exit codes (FR-6). */
const EXIT_OK = 0;
const EXIT_ROOT_FAILED = 1;
const EXIT_USAGE = 2;

type FailureCode = 'not-a-minspec-project' | 'root-not-found' | 'resolver-failed';

interface TreeState {
  /** Short HEAD sha of the tree that was measured. */
  head: string;
  /** True when `git status --porcelain` reported anything at all. */
  dirty: boolean;
}

interface RootAnswer {
  root: string;
  resolvedRoot: string;
  ok: true;
  tree: TreeState | null;
  treeNote?: string;
  /** The resolver's own object, unchanged. `null` = this project has nothing pending. */
  task: NextTask | null;
  label: string;
}

interface RootFailure {
  root: string;
  resolvedRoot: string;
  ok: false;
  error: { code: FailureCode; message: string };
}

type RootResult = RootAnswer | RootFailure;

interface HeadlessSignpostReport {
  tool: 'minspec-next-task';
  contractVersion: 1;
  results: RootResult[];
}

const USAGE = `minspec next-task — the one next human action per project, headless.

Usage:
  npx tsx scripts/next-task.ts [<root>...]
  npm run next-task -- [<root>...]

With no <root>, reads the current working directory. Each root must contain a .minspec/
directory; one that does not is reported as an error, never as "nothing to do".

Output: a single JSON document on stdout. Diagnostics on stderr.
Exit: 0 every root answered - 1 a root failed - 2 usage error.`;

/**
 * Read the working-tree state for a root. Best-effort and NON-fatal: a root that is not a
 * git repository is still a perfectly valid MinSpec project, so a git failure degrades to
 * `tree: null` plus a stated reason rather than failing the root. This is advisory context
 * for interpreting the answer, not a gate signal, so degrading visibly is the correct
 * behaviour rather than failing closed.
 */
function readTreeState(root: string): { tree: TreeState | null; treeNote?: string } {
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

  try {
    const head = git(['rev-parse', '--short', 'HEAD']).trim();
    // Presence of ANY output means the tree differs from HEAD. Deliberately not parsed
    // into columns - only emptiness is load-bearing here.
    const dirty = git(['status', '--porcelain']).length > 0;
    return { tree: { head, dirty } };
  } catch (err) {
    return {
      tree: null,
      treeNote: `working-tree state unavailable (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
    };
  }
}

/** Resolve one root, independently of every other (FR-3). Never throws. */
function readRoot(rawRoot: string): RootResult {
  const resolvedRoot = path.resolve(rawRoot);
  const base = { root: rawRoot, resolvedRoot };

  let isDir = false;
  try {
    isDir = fs.statSync(resolvedRoot).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return {
      ...base,
      ok: false,
      error: { code: 'root-not-found', message: `not a directory: ${resolvedRoot}` },
    };
  }

  // FR-2. The opt-in marker, checked before any graph is built. Directory presence only:
  // a repo with .minspec/ but an unreadable config HAS opted in, and loadConfig already
  // falls back to defaults for it - a different condition from never having opted in.
  const marker = path.join(resolvedRoot, '.minspec');
  let hasMarker = false;
  try {
    hasMarker = fs.statSync(marker).isDirectory();
  } catch {
    hasMarker = false;
  }
  if (!hasMarker) {
    return {
      ...base,
      ok: false,
      error: {
        code: 'not-a-minspec-project',
        message: `no .minspec/ directory in ${resolvedRoot} - MinSpec is not installed here, which is NOT the same as having nothing to do`,
      },
    };
  }

  try {
    const task = resolveNextTask(buildArtifactGraph(resolvedRoot));
    const { tree, treeNote } = readTreeState(resolvedRoot);
    return {
      ...base,
      ok: true,
      tree,
      ...(treeNote === undefined ? {} : { treeNote }),
      task,
      label: formatNextTaskLabel(task),
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: {
        code: 'resolver-failed',
        message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      },
    };
  }
}

function main(argv: string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT_OK;
  }

  const unknownFlags = argv.filter((a) => a.startsWith('-'));
  if (unknownFlags.length > 0) {
    process.stderr.write(`unknown option: ${unknownFlags.join(', ')}\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  const roots = argv.length > 0 ? argv : [process.cwd()];
  if (roots.length === 0) {
    // Unreachable via the default above, kept so a future arg-parsing change cannot make
    // "zero roots" exit 0 with an empty document (FR-6).
    process.stderr.write(`no roots to read\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  const results = roots.map(readRoot);

  const report: HeadlessSignpostReport = {
    tool: 'minspec-next-task',
    contractVersion: 1,
    results,
  };
  // stdout carries the document and nothing else (FR-5). No timestamp anywhere in it, so
  // two runs over an unchanged tree are byte-identical and a caller can diff two readings
  // to detect real change (FR-7).
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  // Every failure is visible on stderr as well as in the document, so a caller reading
  // only the stream still sees it (FR-5, constitution invariant 2).
  const failures = results.filter((r): r is RootFailure => !r.ok);
  for (const f of failures) {
    process.stderr.write(`FAILED ${f.root}: ${f.error.code} - ${f.error.message}\n`);
  }

  return failures.length > 0 ? EXIT_ROOT_FAILED : EXIT_OK;
}

process.exit(main(process.argv.slice(2)));
