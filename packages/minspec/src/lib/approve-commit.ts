/**
 * Commit-on-approve — the durable half of "committed ground truth" (SPEC-022,
 * FR-1). Approving/accepting an approvable writes the doc's status flip and (for
 * specs) the attributed sidecar record; this module makes those writes a real
 * `git commit` so an approval is never left sitting uncommitted in the working
 * tree (the SPEC-023 nuisance — see project memory `project_alt_a_no_autocommit`).
 *
 * Gated by the `minspec.commitOnApprove` setting (default on), read by the
 * command layer — this Tier-0 module stays vscode-free (fs + path + git only,
 * matching `approval.ts`).
 *
 * NEVER-WRONG invariants (load-bearing; DR-003 addendum, project memory
 * `feedback_commit_sweeps_prestaged`):
 *   1. Pathspec-safety. The commit stages/commits ONLY the exact approval paths,
 *      via `git commit -- <paths>` (a partial commit) with GIT_LITERAL_PATHSPECS
 *      set — a bare `git commit` would bundle whatever ANOTHER concurrent session
 *      pre-staged, and a path containing a git glob metachar ([ ] * ?) would
 *      otherwise match a FOREIGN sibling. Do NOT drop the literal-pathspecs env or
 *      the `--` separator, and do NOT "simplify" to `git add -A` / bare commit.
 *   2. Never a false 'committed'. In detached HEAD the commit is unreferenced and
 *      a later checkout silently discards it (losing the approval) — so we refuse
 *      to commit there and return 'detached-head', never 'committed'.
 *   3. No stranded staging. `git add` touches the SHARED index; if the commit then
 *      fails, we `git reset` those exact paths so a failed approval never leaves
 *      files pre-staged for another session's bare commit to sweep up.
 *
 * ASYNC + bounded: git runs off the extension-host thread (async execFile) with a
 * timeout, so a slow user pre-commit hook can't freeze the UI on every Alt+A.
 *
 * Best-effort and NEVER rejects: every failure (not a repo, hook rejection, git
 * absent, timeout) degrades to a typed result the caller surfaces as an advisory
 * — the approval record is already written on disk, so a failed commit only means
 * the user commits it themselves, never that the approval is lost.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** Max time (ms) any single git invocation may run — bounds a hung pre-commit hook. */
const GIT_TIMEOUT_MS = 30_000;

/** Outcome of a commit-on-approve attempt. Never an exception — always one of these. */
export type CommitApprovalOutcome =
  | 'committed' //         the paths were committed
  | 'not-a-repo' //        rootDir is not inside a git work tree — nothing to do
  | 'detached-head' //     HEAD is detached — refused (a commit here would be orphaned/lost)
  | 'nothing-to-commit' // no given path exists, or none differs from HEAD
  | 'failed'; //           git errored (e.g. a pre-commit hook rejected) — files un-staged again

export interface CommitApprovalResult {
  readonly outcome: CommitApprovalOutcome;
  /** Repo-relative paths that were staged/committed (present on 'committed'). */
  readonly paths?: string[];
  /** Error detail incl. git/hook stderr (present on 'failed'). */
  readonly error?: string;
}

/**
 * Minimal git surface, injectable so tests can drive a stub instead of shelling
 * out. `run` resolves stdout as a string and REJECTS on a non-zero git exit
 * (matching `execFile`), which the commit flow catches. A synchronous stub that
 * returns a string is also accepted (each call is awaited).
 */
export type GitRun = (args: readonly string[]) => Promise<string> | string;

/**
 * Default git runner rooted at `rootDir`. GIT_LITERAL_PATHSPECS=1 disables glob/
 * magic pathspec interpretation for EVERY invocation (invariant 1). stderr is
 * captured so a hook rejection carries its reason into the failure result.
 */
export function defaultGitRun(rootDir: string): GitRun {
  return async (args) => {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: rootDir,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
    });
    return stdout.toString();
  };
}

/** Human-readable error, preferring the git/hook stderr when present. */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    if (stderr) return stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/**
 * Commit exactly `absPaths` (those that exist) into a single commit with
 * `message`, restricted by literal pathspec so no other staged content is swept
 * in and no glob metachar matches a foreign file.
 *
 * @param rootDir  the git work-tree root (also the cwd for git)
 * @param absPaths absolute paths of the approval doc + record (missing ones are skipped)
 * @param message  the commit subject (conventional; never `fix:` so the RCDD gate stays quiet)
 * @param run      injectable git runner (defaults to a real one rooted at rootDir)
 */
export async function commitApproval(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
  run: GitRun = defaultGitRun(rootDir),
): Promise<CommitApprovalResult> {
  // 1. Repo guard — outside a work tree there is nothing to commit into.
  try {
    if ((await run(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
      return { outcome: 'not-a-repo' };
    }
  } catch {
    return { outcome: 'not-a-repo' };
  }

  // 2. Detached-HEAD guard (invariant 2). `symbolic-ref -q HEAD` exits non-zero
  //    (rejects) when HEAD is not on a branch. A commit made there is unreferenced
  //    and a later checkout discards it — so refuse and NEVER claim 'committed'.
  try {
    const ref = (await run(['symbolic-ref', '-q', 'HEAD'])).trim();
    if (!ref) return { outcome: 'detached-head' };
  } catch {
    return { outcome: 'detached-head' };
  }

  // 3. Keep only paths that exist on disk, made repo-relative. A path that
  //    resolves outside the repo (shouldn't happen) is dropped, never committed.
  const rel = absPaths
    .filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    })
    .map((p) => path.relative(rootDir, p))
    .filter((p) => p.length > 0 && !p.startsWith('..' + path.sep) && p !== '..');
  if (rel.length === 0) return { outcome: 'nothing-to-commit' };

  // 4. Stage exactly these paths (this is what makes a NEW untracked sidecar
  //    committable by the pathspec commit below).
  try {
    await run(['add', '--', ...rel]);
  } catch (err) {
    return { outcome: 'failed', error: describeError(err) };
  }

  // 5. If nothing among these paths actually differs from HEAD (e.g. a re-approve
  //    that changed neither the doc nor the record), skip — `git commit --` would
  //    otherwise fail "nothing to commit". `diff --quiet` REJECTS (exit 1) when
  //    there ARE staged changes for these pathspecs; unstage first so the shared
  //    index is left clean.
  let hasStagedChange = false;
  try {
    await run(['diff', '--cached', '--quiet', '--', ...rel]);
  } catch {
    hasStagedChange = true;
  }
  if (!hasStagedChange) {
    await unstage(run, rel);
    return { outcome: 'nothing-to-commit', paths: rel };
  }

  // 6. Partial commit — ONLY these literal pathspecs. Never bundles another
  //    session's pre-staged files (invariant 1).
  try {
    await run(['commit', '-m', message, '--', ...rel]);
    return { outcome: 'committed', paths: rel };
  } catch (err) {
    // Invariant 3: a failed commit must not leave our paths staged in the shared
    // index for another session's bare commit to sweep up. Unstage them again.
    await unstage(run, rel);
    return { outcome: 'failed', error: describeError(err) };
  }
}

/** Best-effort unstage of exactly `rel` (never throws — index-clean is advisory). */
async function unstage(run: GitRun, rel: readonly string[]): Promise<void> {
  try {
    await run(['reset', '-q', '--', ...rel]);
  } catch {
    // ignore — reset is a best-effort cleanup; the commit result already stands.
  }
}
