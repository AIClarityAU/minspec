/**
 * approval-inflight.ts — the record that carries an approval while its PR is open
 * (#2974).
 *
 * THE PROBLEM. On push-protected `main`, `recoverProtectedBranchApproval` transports
 * an approval (sidecar + approved document + register INDEX) to an `approvals/...`
 * branch and opens a PR. The primary checkout kept the originals as dirty paths
 * until the PR merged, often for days. They could not simply be dropped, because
 * the editor reads approval state from the working-tree sidecar and lifecycle
 * status from the document's own frontmatter: restoring them would make a
 * just-accepted decision read `proposed` and a just-approved spec read
 * unapproved — the founder would conclude the accept had failed (the reverse of
 * the 2026-10-09 incident, where an editor that disagreed with `main` made specs
 * look approved when they were not).
 *
 * THE RECORD. After the push and the PR, `settleRecoveredApproval`
 * (approval-recover.ts) writes ONE file per approved document here, then restores
 * the transported paths in the working tree. This module is the read side: the
 * approval store, the ADR list and the spec catalog overlay what it carries for as
 * long as the approval is genuinely in flight.
 *
 * WHERE IT LIVES. `<git-dir>/minspec-inflight-<URI-encoded document path>.json`,
 * one flat file per approved document. Inside the git directory, so it is never a
 * working-tree path (nothing to `.gitignore`, nothing an adopter repo has to
 * scaffold, and `git status` cannot see it). Flat, so writing it creates no
 * directory: SPEC-096 FR-4 names every module allowed to, and this is not one.
 * The write is therefore a plain overwrite, not temp-and-rename; a torn file fails
 * to parse and reads as "no record", which shows the committed truth. The per-worktree
 * `--git-dir`, NOT `--git-common-dir`: the record compensates for bytes restored in
 * ONE working tree, so a sibling worktree of the same repository, whose files were
 * never touched, must not inherit the overlay. For the primary checkout the two
 * directories are the same one.
 *
 * WHEN IT STOPS COUNTING (a stale overlay must never outlive the PR):
 *   - landed: `HEAD` carries a sidecar with the same `specHash` — the PR merged and
 *     this checkout has it. The record is deleted; the real files now speak.
 *   - in flight: the remote-tracking ref `origin/<branch>` still exists, OR
 *     `origin/<base>` already carries the sidecar (merged, not yet pulled here).
 *   - otherwise dead: the branch is gone from the remote and `main` never received
 *     the approval — a closed-unmerged PR once a fetch has pruned it. The overlay is
 *     ignored, so the item reads as what `main` says (unapproved). The file is KEPT:
 *     with the branch deleted it may be the only remaining copy of the approval.
 *   Any git error reads as "not live" (fail closed to the committed truth).
 *
 * The lifecycle overlay (status, phases) applies only while the document's bytes
 * are still exactly the ones the settle step restored. A later edit by the founder
 * ends it for that document, so the overlay can never paper over real work.
 *
 * Tier-0: `fs`, `path`, `crypto`, `child_process` (local git, no network — reading
 * remote-tracking refs is offline). A LEAF: it imports nothing from this package,
 * so `approval-store.ts` can depend on it without a cycle.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const INFLIGHT_PREFIX = 'minspec-inflight-';
/** Bound on each local git probe a reader runs; a reader sits on a refresh path. */
const PROBE_TIMEOUT_MS = 5_000;

/** On-disk shape, version 1. */
export interface InflightRecordV1 {
  readonly version: 1;
  /** The pushed `approvals/...` branch — its remote-tracking ref is the liveness witness. */
  readonly branch: string;
  /** The protected base the PR targets (e.g. `main`). */
  readonly base: string;
  /** The approval commit on {@link branch}. */
  readonly sha: string;
  /** Repo-relative POSIX path of the sidecar the approval lives in on the branch. */
  readonly sidecarRel: string;
  /** The sidecar's JSON, verbatim — shape-validated by the approval store on read. */
  readonly record: unknown;
  /** The approved document, when its working copy was restored. */
  readonly doc?: {
    /** Repo-relative POSIX path. */
    readonly rel: string;
    /** sha256 of the working-tree bytes the restore produced. */
    readonly restoredSha256: string;
    /** The pushed document's frontmatter block (`---\n…\n---\n`, LF), for the lifecycle overlay. */
    readonly frontmatter: string;
  };
  readonly recordedAt: string;
}

/** A record that is live right now. */
export interface LiveInflight {
  readonly file: string;
  readonly data: InflightRecordV1;
  /** The approval's `specHash`, read from the stored sidecar. */
  readonly specHash: string;
  /**
   * The document is byte-for-byte the copy the settle step restored, so the
   * pushed document — the one the approval covers — is what is in flight for it.
   */
  readonly docRestored: boolean;
}

/** POSIX-normalize a repo-relative path (same rule as the sidecar store's key). */
function posix(rel: string): string {
  return rel.split(path.sep).join('/').split('\\').join('/').replace(/^\.\//, '');
}

/**
 * The per-worktree git directory, resolved without spawning git: a `.git`
 * directory, or the `gitdir:` line of a linked worktree's `.git` file.
 */
export function gitDirSync(rootDir: string): string | undefined {
  const dotGit = path.join(rootDir, '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (!st.isFile()) return undefined;
    const m = /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(fs.readFileSync(dotGit, 'utf-8'));
    return m ? path.resolve(rootDir, m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Path of the in-flight file for a repo-relative document path, or undefined outside git. */
export function inflightFile(rootDir: string, docRel: string): string | undefined {
  const gitDir = gitDirSync(rootDir);
  if (!gitDir) return undefined;
  const rel = posix(docRel);
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return undefined;
  return path.join(gitDir, `${INFLIGHT_PREFIX}${encodeURIComponent(rel)}.json`);
}

/** Write (overwrite) a record. Throws when there is no git directory to hold it. */
export function writeInflight(rootDir: string, docRel: string, data: InflightRecordV1): string {
  const file = inflightFile(rootDir, docRel);
  if (!file) throw new Error(`not a git work tree: ${rootDir}`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return file;
}

export function sha256Of(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isRecordV1(v: unknown): v is InflightRecordV1 {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (r.version !== 1) return false;
  for (const k of ['branch', 'base', 'sha', 'sidecarRel', 'recordedAt']) {
    if (typeof r[k] !== 'string' || (r[k] as string).length === 0) return false;
  }
  if (!r.record || typeof r.record !== 'object') return false;
  if (typeof (r.record as Record<string, unknown>).specHash !== 'string') return false;
  if (r.doc !== undefined) {
    const d = r.doc as Record<string, unknown>;
    if (!d || typeof d.rel !== 'string' || typeof d.restoredSha256 !== 'string' || typeof d.frontmatter !== 'string') {
      return false;
    }
  }
  return true;
}

/** Local git probe; undefined on ANY failure (missing object, no repo, timeout). */
function gitOut(rootDir: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', [...args], {
      cwd: rootDir,
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
      maxBuffer: 8 * 1024 * 1024,
    }).toString();
  } catch {
    return undefined;
  }
}

/** Does `rev:sidecarRel` hold a sidecar with this `specHash`? */
function revCarries(rootDir: string, rev: string, sidecarRel: string, specHash: string): boolean {
  const text = gitOut(rootDir, ['show', `${rev}:${sidecarRel}`]);
  if (text === undefined) return false;
  try {
    const parsed = JSON.parse(text) as { specHash?: unknown };
    return parsed.specHash === specHash;
  } catch {
    return false;
  }
}

/**
 * The live in-flight approval for a repo-relative document path, or undefined.
 * Deletes the record once `HEAD` carries the approval. Never throws.
 */
export function readLiveInflight(rootDir: string, docRel: string): LiveInflight | undefined {
  try {
    const file = inflightFile(rootDir, docRel);
    if (!file || !fs.existsSync(file)) return undefined;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!isRecordV1(data)) return undefined;
    const specHash = (data.record as { specHash: string }).specHash;

    if (revCarries(rootDir, 'HEAD', data.sidecarRel, specHash)) {
      // Landed and checked out here: the committed sidecar and document now say
      // everything this record said. Clearing it is what stops the overlay from
      // outliving the merge.
      try {
        fs.unlinkSync(file);
      } catch {
        // an undeletable record is still ignored below by returning undefined
      }
      return undefined;
    }

    const branchLive = gitOut(rootDir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${data.branch}^{commit}`]) !== undefined;
    const merged = !branchLive && revCarries(rootDir, `refs/remotes/origin/${data.base}`, data.sidecarRel, specHash);
    if (!branchLive && !merged) return undefined; // closed-unmerged (pruned) — the committed truth speaks

    let docRestored = false;
    if (data.doc && posix(data.doc.rel) === posix(docRel)) {
      try {
        docRestored = sha256Of(fs.readFileSync(path.join(rootDir, ...posix(docRel).split('/')))) === data.doc.restoredSha256;
      } catch {
        docRestored = false;
      }
    }
    return { file, data, specHash, docRestored };
  } catch {
    return undefined;
  }
}

/**
 * The pushed document's frontmatter block, for a reader that shows lifecycle status
 * (`status:`, `phases:`) — only while the document on disk is still the restored
 * copy and the approval is live. Each reader parses it with its OWN frontmatter
 * parser, so this module adds no second status grammar.
 */
export function inflightFrontmatter(rootDir: string, absDocPath: string): string | undefined {
  const rel = path.relative(rootDir, absDocPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  // Fast path: nothing recorded → no git probe at all.
  const file = inflightFile(rootDir, rel);
  if (!file || !fs.existsSync(file)) return undefined;
  const live = readLiveInflight(rootDir, rel);
  return live?.docRestored ? live.data.doc?.frontmatter : undefined;
}
