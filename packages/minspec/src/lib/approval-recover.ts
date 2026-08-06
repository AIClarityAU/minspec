/**
 * approval-recover.ts — one-click recovery from the `protected-branch` refusal
 * (#1115, follow-up to #1064).
 *
 * THE PROBLEM. `commitApproval` refuses to commit an approval when HEAD is the
 * push-protected default branch: such a commit could never be pushed, and the
 * #1041 pre-commit hook rejects it anyway. That refusal is correct. What was
 * missing is what happens next — today the developer gets an honest warning and
 * their files left in the working tree, and must then hand-drive a branch, a
 * commit, a push and a PR. Measured on 2026-08-05: SIX ratifications in one
 * sitting all stranded this way, each recovered by hand. Goal G-8 (git
 * transparency) says a non-git-literate developer should never have to.
 *
 * THE APPROACH. Everything happens in a THROWAWAY WORKTREE off `origin/<base>`.
 * The approval files are COPIED there from the primary working tree, committed,
 * and pushed. This is the `push-docs-lane` pattern (SPEC-039) and the same one a
 * human uses by hand; it is chosen over `git branch <new> HEAD` + plumbing
 * because it needs no index manipulation and cannot touch the shared checkout.
 *
 * INVARIANTS (load-bearing):
 *   INV-1 (primary untouched, rule #8 / DR-046 / DR-051 §4a). No `checkout`,
 *     `switch`, `merge`, `rebase` or `reset` ever runs, and nothing is staged in
 *     the primary's index. Only read-only probes, a `fetch` (which moves a
 *     remote-tracking ref, not HEAD), and `worktree add`/`remove` (a SEPARATE
 *     worktree with a SEPARATE index).
 *   INV-2 (never throws). Every failure — no remote, offline, hook rejection,
 *     timeout, unreadable file — returns a typed result. An approval must never
 *     be lost or obscured by a recovery failure, and the caller's existing
 *     honest warning stays the fallback surface.
 *   INV-3 (never mints or edits an approval record). This module TRANSPORTS
 *     files that *MinSpec: Approve Spec* already wrote. It never writes `status:`,
 *     never writes a sidecar, never sets `approvedBy` (DR-012, #1025).
 *   INV-4 (no network without consent). This module makes network calls
 *     (`fetch`, `push`) unconditionally when invoked — the CALLER is responsible
 *     for gating on `minspec.pushOnApprove` first. That split is deliberate:
 *     consent is a UI concern and lives in the command layer, while this file
 *     stays vscode-free and unit-testable. The caller contract is stated on
 *     {@link recoverProtectedBranchApproval}.
 *
 * NOT YET WIRED TO SPEC-050's PR SEAM. #1115 requirement 2 asks that PR opening
 * reuse the `approval-pr.ts` seam rather than growing a second `gh pr create`.
 * That seam is still an unmerged draft (#1224), so this slice deliberately stops
 * at "pushed, with a compare URL" — which is what removes the stranding — and
 * opens no PR at all. When #1224 lands, the `recovered` outcome is the natural
 * call site for it. Stated here rather than left for a reader to wonder about.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareUrlFor, approvalBranchName } from './approve-push';

const execFileAsync = promisify(execFile);

/** Max time (ms) any single git invocation may run — bounds a hung hook/network. */
const GIT_TIMEOUT_MS = 60_000;

/** Outcome of a recovery attempt. Never an exception — always one of these. */
export type RecoverOutcome =
  | 'recovered' //         branch created, approval committed, pushed
  | 'no-remote' //         no `origin` — nothing to push to
  | 'nothing-to-commit' // the paths are already identical to the base
  | 'offline' //           a network step could not reach the remote
  | 'failed'; //           any other git error (e.g. a hook rejected the commit)

export interface RecoverResult {
  readonly outcome: RecoverOutcome;
  /** The branch created and pushed (present on 'recovered'). */
  readonly branch?: string;
  /** PR-open URL for that branch (present on 'recovered' when origin was parseable). */
  readonly compareUrl?: string;
  /** Repo-relative paths transported (present on 'recovered'/'nothing-to-commit'). */
  readonly paths?: string[];
  /** Error detail incl. git/hook stderr (present on 'failed'/'offline'). */
  readonly error?: string;
}

/**
 * Minimal git surface, injectable so tests drive a stub instead of spawning a real
 * subprocess. Resolves stdout and REJECTS on a non-zero exit (matching `execFile`).
 */
export type GitRun = (
  args: readonly string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => Promise<string>;

/**
 * Default git runner. GIT_LITERAL_PATHSPECS=1 disables glob/magic pathspec
 * interpretation, so a `[`/`*`/`?` in an approval path can never match a foreign
 * sibling — mirroring `approve-commit.ts`.
 */
export function defaultGitRun(): GitRun {
  return async (args, opts) => {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: opts?.cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', ...opts?.env },
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

/** Does an error message look like a network/DNS/connection failure (→ 'offline')? */
function isNetworkError(message: string): boolean {
  return /could ?n'?t? resolve host|resolve host|network is unreachable|temporary failure in name resolution|failed to connect|could not connect|connection (refused|reset|timed out)|unable to access|operation timed out|timed out|no route to host|dial tcp|proxy|ssl|tls/i.test(
    message,
  );
}

export interface RecoverOptions {
  /** Slug used to derive the branch name (usually the approved artifact's id). */
  readonly slug: string;
  /** Branch to base the recovery branch on. Defaults to 'main'. */
  readonly baseBranch?: string;
  /** Injected for deterministic branch names in tests. */
  readonly now?: Date;
}

export interface RecoverDeps {
  readonly run?: GitRun;
  /** Injected so tests need no real temp dir. Returns a fresh empty directory. */
  readonly mkTempDir?: () => string;
}

/**
 * Transport an approval that `commitApproval` refused to commit on the protected
 * default branch: create a branch off `origin/<base>`, commit exactly `absPaths`
 * there, push it, and return a compare URL.
 *
 * CALLER CONTRACT (INV-4): this makes network calls the moment it is invoked. The
 * caller MUST have established push consent (`minspec.pushOnApprove`) first. With
 * `never`, or a declined `prompt`, do not call this at all.
 *
 * @param rootDir  the primary git work-tree root (never mutated)
 * @param absPaths absolute paths of the approval doc + record (missing ones skipped)
 * @param message  the commit subject (conventional; never `fix:` so the RCDD gate stays quiet)
 */
export async function recoverProtectedBranchApproval(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
  opts: RecoverOptions,
  deps: RecoverDeps = {},
): Promise<RecoverResult> {
  const run = deps.run ?? defaultGitRun();
  const mkTempDir = deps.mkTempDir ?? (() => fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approval-')));
  const base = opts.baseBranch ?? 'main';

  try {
    // 1. Keep only paths that exist, made repo-relative. A path resolving OUTSIDE
    //    the repo is dropped, never transported.
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
    if (rel.length === 0) return { outcome: 'nothing-to-commit', paths: [] };

    // 2. Origin must exist to push. Local config read — no network yet.
    let originUrl = '';
    try {
      originUrl = (await run(['remote', 'get-url', 'origin'], { cwd: rootDir })).trim();
    } catch {
      return { outcome: 'no-remote' };
    }
    if (!originUrl) return { outcome: 'no-remote' };

    // 3. Refresh the base so the branch forks from the current tip. FIRST network call.
    try {
      await run(['fetch', 'origin', base], { cwd: rootDir });
    } catch (err) {
      const msg = describeError(err);
      return { outcome: isNetworkError(msg) ? 'offline' : 'failed', error: msg };
    }

    const branch = approvalBranchName(opts.slug, opts.now ?? new Date());
    const tmpBase = mkTempDir();
    const wt = path.join(tmpBase, 'wt');

    try {
      // 4. Worktree off origin/<base> — a SEPARATE index, so the primary's is
      //    untouched even while we stage (INV-1).
      try {
        await run(['worktree', 'add', '-q', '-b', branch, wt, `origin/${base}`], { cwd: rootDir });
      } catch (err) {
        return { outcome: 'failed', error: describeError(err) };
      }

      // 5. Copy each approval path in from the primary WORKING TREE (these files
      //    are uncommitted there — copying is the only way to reach them).
      try {
        for (const f of rel) {
          const dst = path.join(wt, f);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(path.join(rootDir, f), dst);
        }
      } catch (err) {
        return { outcome: 'failed', error: describeError(err) };
      }

      // 6. Stage EXACTLY these paths — never a blanket `add -A`, so nothing
      //    incidental can ride along (and the runner's literal pathspecs hold).
      try {
        await run(['add', '--', ...rel], { cwd: wt });
      } catch (err) {
        return { outcome: 'failed', error: describeError(err) };
      }

      // 7. Nothing differing from the base → the approval already landed (e.g. a
      //    re-approve of unchanged content). Report it; never make an empty commit.
      //    `diff --cached --quiet` REJECTS when there IS a delta.
      let hasDelta = false;
      try {
        await run(['diff', '--cached', '--quiet'], { cwd: wt });
      } catch {
        hasDelta = true;
      }
      if (!hasDelta) return { outcome: 'nothing-to-commit', paths: rel };

      // 8. Commit. DR_INDEX_GATE_OFF=1 (NOT --no-verify) for the same reason
      //    push-docs.sh uses it: the ephemeral worktree has no node_modules, so
      //    ONLY the pre-commit hook's `npm run validate` step crashes on module
      //    load. That step has this dedicated kill-switch. The two pure-bash gates
      //    (DR-029 born-`proposed`, and commit-msg RCDD) stay ACTIVE, and CI re-runs
      //    `npm run validate` on the resulting PR — no invariant hole.
      try {
        await run(['commit', '-m', message], { cwd: wt, env: { DR_INDEX_GATE_OFF: '1' } });
      } catch (err) {
        return { outcome: 'failed', error: describeError(err) };
      }

      // 9. Push. SECOND (and last) network call.
      try {
        await run(['push', '-q', '-u', 'origin', branch], { cwd: wt });
      } catch (err) {
        const msg = describeError(err);
        return { outcome: isNetworkError(msg) ? 'offline' : 'failed', error: msg };
      }

      return {
        outcome: 'recovered',
        branch,
        compareUrl: compareUrlFor(originUrl, branch),
        paths: rel,
      };
    } finally {
      // Best-effort cleanup — never throws, never changes the result (INV-2).
      try {
        await run(['worktree', 'remove', '--force', wt], { cwd: rootDir });
      } catch {
        // ignore — a leftover worktree is harmless and `git worktree prune` reaps it
      }
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {
        // ignore — a leftover temp dir is harmless
      }
    }
  } catch (err) {
    // INV-2 backstop: anything unexpected still degrades to a typed result.
    return { outcome: 'failed', error: describeError(err) };
  }
}
