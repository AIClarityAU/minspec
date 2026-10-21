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
 * SETTLING THE PRIMARY (#2974). Recovery itself still never writes to the primary.
 * Once the caller has the PR open, {@link settleRecoveredApproval} retires the
 * transported copies from the primary's WORKING TREE — and only there: HEAD and the
 * index are never touched, and a path is restored only when its working bytes are
 * proven equal to the blob just pushed. What those copies used to tell the editor
 * (approved, accepted) moves to the in-flight record (`approval-inflight.ts`).
 *
 * WIRED TO SPEC-050's PR SEAM (#1653). #1115 requirement 2 asked that PR opening
 * reuse the `approval-pr.ts` seam rather than grow a second `gh pr create`. That
 * seam landed in #1224, and the `recovered` outcome is now its call site:
 * `commands/commit-on-approve.ts` → `recoverOnProtectedBranch` hands this
 * result's `branch` / `compareUrl` / `paths` / `sha` to `openApprovalPr`. This
 * module still opens no PR ITSELF — it stays vscode-free and network-minimal,
 * and the caller owns the `gh` step, exactly as the consent split above does.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalizeSpec } from '@aiclarity/shared';
import { compareUrlFor, approvalBranchName } from './approve-push';
import { spliceDrIndexEntry } from './dr-index-splice';
import { sha256Of, writeInflight, inflightFile, type InflightRecordV1 } from './approval-inflight';
import { SPEC_STATUSES } from './spec-vocabulary';

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
  /**
   * The approval commit this recovery created (present on 'recovered' when it
   * could be read).
   *
   * Load-bearing, not informational. Recovery commits in a SEPARATE worktree, so
   * the primary checkout's `HEAD` never moves and still points at the base branch
   * tip. `resolveHeadSha(run, rootDir)` — which `openApprovalPr` falls back to —
   * would therefore stamp the PR body with the WRONG commit, exactly the caller
   * class its own docstring warns about (`approval-pr.ts:355-366`). Returning the
   * real SHA is what lets the shared PR step stay honest for this path.
   */
  readonly sha?: string;
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

/**
 * For a register INDEX.md in the approval set, write into `dst` the base INDEX
 * (already checked out in the worktree) with only the target decision's entry
 * applied. The target id comes from the sibling `DR-NNN*.md` path(s) in the same
 * set. Returns false (caller copies the file as before) when no single target id,
 * no base INDEX, or no matching entry can be found — never throws.
 */
function spliceTargetEntry(rel: readonly string[], indexRel: string, src: string, dst: string): boolean {
  try {
    const dir = path.dirname(indexRel);
    const ids = new Set<string>();
    for (const p of rel) {
      if (path.dirname(p) !== dir) continue;
      const m = /^(DR-\d+)/.exec(path.basename(p));
      if (m) ids.add(m[1]);
    }
    if (ids.size === 0 || !fs.existsSync(dst)) return false;
    let text = fs.readFileSync(dst, 'utf-8');
    const working = fs.readFileSync(src, 'utf-8');
    for (const id of ids) {
      const next = spliceDrIndexEntry(text, working, id);
      if (next === null) return false;
      text = next;
    }
    fs.writeFileSync(dst, text);
    return true;
  } catch {
    return false;
  }
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
          const src = path.join(rootDir, f);
          // #2912: the shared checkout's INDEX.md is regenerated from EVERY DR on
          // disk, so copying it wholesale drags in other decisions' uncommitted
          // rows. Splice only the target DR's entry onto origin/<base>'s INDEX.
          if (path.basename(f) === 'INDEX.md' && spliceTargetEntry(rel, f, src, dst)) continue;
          fs.copyFileSync(src, dst);
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

      // 8b. Read the commit we just made, IN THE WORKTREE. The primary checkout's
      //     HEAD is untouched by design (INV-1), so this is the only place the
      //     approval commit's SHA exists. Undefined on failure — one PR body line
      //     degrades, the recovery does not.
      let sha: string | undefined;
      try {
        sha = (await run(['rev-parse', 'HEAD'], { cwd: wt })).trim() || undefined;
      } catch {
        sha = undefined;
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
        sha,
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

// ─── #2974: settle the primary once the approval PR is open ────────────────────

/** Outcome of {@link settleRecoveredApproval}. Never an exception. */
export interface SettleResult {
  /** Transported paths retired from the primary's working tree (restored to the index copy, or a new sidecar removed). */
  readonly restored: string[];
  /** Transported paths deliberately left in place, each for a stated reason in {@link reasons}. */
  readonly kept: string[];
  /** The in-flight record written, when the sidecar was retired. */
  readonly inflight?: string;
  /** Why each kept path was kept, or why nothing was settled at all (key `*`). */
  readonly reasons: Record<string, string>;
}

const SIDECAR_PREFIX = '.minspec/approvals/';

/**
 * Status words that a lifecycle transition rewrites in a document's BODY (the spec
 * `**Status:**` line, a decision's `## Status` line). The decision words are listed
 * here rather than imported because `adr-manager.ts` keeps its set private; a status
 * added there and missing here only makes {@link differsOnlyInLifecycle} answer
 * "no", which leaves the document in place — the safe direction.
 */
const LIFECYCLE_WORDS = [...SPEC_STATUSES, 'proposed', 'accepted', 'deprecated', 'superseded'];
const LIFECYCLE_WORD_RE = new RegExp(`\\b(${[...new Set(LIFECYCLE_WORDS)].join('|')})\\b`, 'gi');

/**
 * Do two versions of an approvable differ ONLY in lifecycle — frontmatter `status:` /
 * `phases:` and the status word in the body? Built on the approval hash's own
 * canonical form, so "same content" means exactly what an approval already means
 * by it. Restoring a document that differed in anything else would show the founder
 * the OLD text in the editor until the PR merged, so such a document stays put.
 */
export function differsOnlyInLifecycle(headText: string, pushedText: string): boolean {
  const norm = (t: string): string => canonicalizeSpec(t).replace(LIFECYCLE_WORD_RE, '\u0000');
  return norm(headText) === norm(pushedText);
}

/** The frontmatter block of a document, LF-normalized, or '' when it has none. */
function frontmatterBlock(text: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(text.replace(/\r\n?/g, '\n'));
  return m ? m[0].replace(/\n?$/, '\n') : '';
}

function posixRel(p: string): string {
  return p.split(path.sep).join('/').split('\\').join('/');
}

/**
 * Retire an approval's transported copies from the primary checkout once its PR is
 * open (#2974), keeping what they told the editor in the in-flight record.
 *
 * GUARDS, each checked per path immediately before it is touched:
 *   - PROVEN: the working bytes (`git hash-object`, so clean filters apply exactly as
 *     they did for the pushed commit) equal the blob at `res.sha`. A path the founder
 *     edited after the push is never restored — their work is never lost.
 *   - INDEX UNTOUCHED: a path with STAGED changes is left alone, and only
 *     `git restore --worktree` runs (source: the index), so HEAD and the index never
 *     move. A sidecar new to this branch is removed with `unlink`, nothing else.
 *   - SIDECAR FIRST: the in-flight record is written before anything is retired; if
 *     the sidecar is not proven, or cannot be retired, NOTHING is touched and the
 *     record is removed, so the approval is never left recorded nowhere.
 *   - DOCUMENT ONLY ON A LIFECYCLE-ONLY DIFF: the approved document is restored only
 *     when it is tracked and differs from HEAD only in lifecycle
 *     ({@link differsOnlyInLifecycle}); otherwise it stays, still reading approved
 *     through the in-flight record.
 *   - An untracked transported document is never deleted: it is the founder's open
 *     editor buffer, and nothing on `main` would show in its place.
 *
 * Never throws. Makes no network call (every git step here is local).
 */
export async function settleRecoveredApproval(
  rootDir: string,
  res: RecoverResult,
  opts: { baseBranch?: string; now?: Date } = {},
  deps: { run?: GitRun } = {},
): Promise<SettleResult> {
  const run = deps.run ?? defaultGitRun();
  const restored: string[] = [];
  const kept: string[] = [];
  const reasons: Record<string, string> = {};
  const nothing = (why: string): SettleResult => ({
    restored: [],
    kept: (res.paths ?? []).map(posixRel),
    reasons: { '*': why },
  });

  if (res.outcome !== 'recovered' || !res.sha || !res.branch || !res.paths || res.paths.length === 0) {
    return nothing('no recovered approval commit to compare against');
  }
  const sha = res.sha;
  const rel = res.paths.map(posixRel);
  const abs = (p: string): string => path.join(rootDir, ...p.split('/'));

  const ok = async (args: string[]): Promise<boolean> => {
    try {
      await run(args, { cwd: rootDir });
      return true;
    } catch {
      return false;
    }
  };
  const out = async (args: string[]): Promise<string | undefined> => {
    try {
      return await run(args, { cwd: rootDir });
    } catch {
      return undefined;
    }
  };
  const proven = async (p: string): Promise<boolean> => {
    if (!fs.existsSync(abs(p))) return false;
    const working = (await out(['hash-object', '--', p]))?.trim();
    const pushed = (await out(['rev-parse', '--verify', '-q', `${sha}:${p}`]))?.trim();
    return !!working && working === pushed;
  };
  const tracked = (p: string): Promise<boolean> => ok(['rev-parse', '--verify', '-q', `HEAD:${p}`]);
  // `diff --cached --quiet` REJECTS when the index differs from HEAD for the path.
  const indexClean = (p: string): Promise<boolean> => ok(['diff', '--cached', '--quiet', '--', p]);

  /** Retire one path from the working tree; false (and nothing done) unless every guard holds. */
  const retire = async (p: string, why: (r: string) => void): Promise<boolean> => {
    if (!(await indexClean(p))) {
      why('staged changes in the index');
      return false;
    }
    if (!(await proven(p))) {
      why('working bytes differ from the pushed blob');
      return false;
    }
    if (await tracked(p)) {
      if (await ok(['restore', '--worktree', '--', p])) return true;
      why('git restore failed');
      return false;
    }
    try {
      fs.unlinkSync(abs(p));
      return true;
    } catch (err) {
      why(describeError(err));
      return false;
    }
  };

  try {
    const sidecars = rel.filter((p) => p.startsWith(SIDECAR_PREFIX) && p.endsWith('.json'));
    if (sidecars.length !== 1) return nothing(`expected one approval sidecar, found ${sidecars.length}`);
    const sidecarRel = sidecars[0];
    if (!(await proven(sidecarRel))) return nothing('the sidecar differs from the pushed blob');

    let record: { specPath?: unknown; specHash?: unknown };
    try {
      record = JSON.parse(fs.readFileSync(abs(sidecarRel), 'utf-8')) as typeof record;
    } catch {
      return nothing('the sidecar is not readable JSON');
    }
    if (typeof record.specPath !== 'string' || typeof record.specHash !== 'string') {
      return nothing('the sidecar names no document');
    }
    const docRel = posixRel(record.specPath);
    if (!inflightFile(rootDir, docRel)) return nothing('no git directory for the in-flight record');

    // Decide the document BEFORE anything is written, from bytes read now.
    let docText: string | undefined;
    let docEligible = false;
    if (rel.includes(docRel)) {
      try {
        docText = fs.readFileSync(abs(docRel), 'utf-8');
      } catch {
        docText = undefined;
      }
      const headText = await out(['show', `HEAD:${docRel}`]);
      if (docText === undefined) reasons[docRel] = 'the document is not readable';
      else if (headText === undefined) reasons[docRel] = 'the document is not on HEAD (never deleted)';
      else if (!differsOnlyInLifecycle(headText, docText)) reasons[docRel] = 'it differs from HEAD beyond lifecycle';
      else docEligible = true;
    }

    const base: InflightRecordV1 = {
      version: 1,
      branch: res.branch,
      base: opts.baseBranch ?? 'main',
      sha,
      sidecarRel,
      record,
      recordedAt: (opts.now ?? new Date()).toISOString(),
    };
    let file: string;
    try {
      file = writeInflight(rootDir, docRel, base);
    } catch (err) {
      return nothing(`could not write the in-flight record: ${describeError(err)}`);
    }

    if (!(await retire(sidecarRel, (r) => (reasons[sidecarRel] = r)))) {
      // The sidecar stays where it was, so the in-flight record would be a second
      // copy with no purpose; remove it and touch nothing else.
      try {
        fs.unlinkSync(file);
      } catch {
        // a leftover record is ignored once HEAD carries the approval
      }
      return { restored: [], kept: rel, reasons };
    }
    restored.push(sidecarRel);

    for (const p of rel) {
      if (p === sidecarRel) continue;
      if (p === docRel) {
        if (!docEligible) {
          kept.push(p);
          continue;
        }
        // The overlay is keyed to the RESTORED bytes, so it is written straight after
        // the restore; until then a reader sees HEAD's lifecycle for that instant.
        const frontmatter = frontmatterBlock(docText ?? '');
        if (!(await retire(p, (r) => (reasons[p] = r)))) {
          kept.push(p);
          continue;
        }
        try {
          writeInflight(rootDir, docRel, {
            ...base,
            doc: { rel: docRel, restoredSha256: sha256Of(fs.readFileSync(abs(p))), frontmatter },
          });
        } catch (err) {
          // The approval record itself is already in place; only the lifecycle
          // overlay is missing, so the document reads as HEAD says until merge.
          reasons[p] = `restored, but the lifecycle overlay was not recorded: ${describeError(err)}`;
        }
        restored.push(p);
        continue;
      }
      if (!(await tracked(p))) {
        reasons[p] = 'not on HEAD (never deleted)';
        kept.push(p);
        continue;
      }
      if (await retire(p, (r) => (reasons[p] = r))) restored.push(p);
      else kept.push(p);
    }
    return { restored, kept, inflight: file, reasons };
  } catch (err) {
    return { restored, kept: rel.filter((p) => !restored.includes(p)), reasons: { ...reasons, '*': describeError(err) } };
  }
}
