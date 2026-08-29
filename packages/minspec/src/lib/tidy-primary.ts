/**
 * #1162 — fold `scripts/check-primaries-clean.sh`'s classification into the
 * extension, so a permanently-dirty primary stops training everyone to ignore
 * `git status`.
 *
 * SPEC-026 covers the CONTENTION half of the shared-primary problem (presence,
 * worktree-steer, the pre-commit backstop). This module covers the other half:
 * a dirty path left behind by work that already landed. An audit on 2026-07-31
 * found 7 of 8 dirty paths across the three primaries were byte-identical to
 * `origin/main` — pre-merge copies of already-merged PRs, stranded because
 * nothing ever fast-forwards a primary (see `scripts/check-primaries-clean.sh`
 * for the full mechanism writeup and the G2-deadlock analysis).
 *
 * CLASSIFICATION (mirrors `check-primaries-clean.sh` byte-for-byte):
 *   REDUNDANT  the dirty path's content is byte-identical to `origin/<default>`'s
 *              version, or is locally deleted and absent there too. Carries no
 *              information — safe to discard, because the eventual sanctioned
 *              fast-forward (`sync_shared_checkouts()`, DR-065) reproduces it.
 *   ORPHAN     content differs (or exists only on one side in a way that isn't
 *              a matching absence). Real unlanded work. NEVER touched here.
 *
 * TIER-0 / OFFLINE (invariant #1): this module makes NO network call, including
 * no `git fetch`. It classifies against whatever `origin/<default>` ref is
 * already resolvable locally — exactly like the bash script's read-only design
 * (see its "NOT a fetch" comment). A caller that wants a fresher answer must
 * fetch itself, outside this module, with the user's explicit action driving it
 * (never an automatic background fetch).
 *
 * MUTATION SAFETY: `tidyRedundantPaths` is the ONLY function here that writes
 * anything, and it:
 *   - re-classifies every requested path immediately before acting (closes the
 *     classify→act TOCTOU window — a path that stopped being REDUNDANT between
 *     the scan and the click is skipped, never force-discarded);
 *   - only ever discards a LOCAL, UNCOMMITTED copy whose bytes are already
 *     proven to exist on `origin/<default>` — it never moves HEAD, never
 *     touches the index for a path with STAGED changes, and never invents or
 *     restores content for a locally-deleted path (that's left for a human);
 *   - is NOT a second implementation of DR-065's gated fast-forward. Moving a
 *     shared HEAD stays exactly where DR-065 put it
 *     (`sync_shared_checkouts()` in `scripts/drain-inbox.sh`), behind guards
 *     G1-G4. This only ever discards path-scoped, uncommitted, provably-
 *     redundant content — a strictly narrower and independently-safe operation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { readAllRecords, isRecordLive, type SessionPresenceRecord } from './presence';

/** One dirty path's verdict. */
export interface TidyClassification {
  /** Repo-relative path, as reported by `git status --porcelain -z`. */
  path: string;
  kind: 'REDUNDANT' | 'ORPHAN';
  existsLocally: boolean;
  existsUpstream: boolean;
}

/** Why a classification pass couldn't produce a verdict at all. */
export type PrimaryClassificationNote =
  | 'off-default-branch'
  | 'missing-origin-ref'
  | 'not-a-git-repo';

export interface PrimaryClassification {
  rootDir: string;
  /** e.g. 'origin/main'; null when it couldn't be resolved (see `note`). */
  originRef: string | null;
  defaultBranch: string;
  branch: string;
  onDefaultBranch: boolean;
  /** commits HEAD is behind / ahead of `originRef`; 0 when unknown. */
  behind: number;
  ahead: number;
  redundant: TidyClassification[];
  orphans: TidyClassification[];
  /** Set when classification stopped early — redundant/orphans are then always []. */
  note?: PrimaryClassificationNote;
}

/** Best-effort git query in `rootDir`; '' on any failure (not a repo, detached, …). */
function gitOut(rootDir: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** True iff the git invocation exits 0. Never throws. */
function gitOk(rootDir: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd: rootDir, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** Raw bytes of `ref:path`, or null on any failure (missing ref, missing path, …). */
function gitShowBytes(rootDir: string, ref: string, relPath: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${ref}:${relPath}`], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Parse `git status --porcelain -z` output into repo-relative paths. Mirrors
 * the bash reader: an `R`/`C` (rename/copy) entry is followed by a second
 * NUL-terminated token (the source path), which must be consumed and dropped
 * or every later entry misparses by one field.
 */
export function parsePorcelainZ(raw: string): string[] {
  const tokens = raw.split('\0');
  const paths: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const entry = tokens[i];
    i++;
    if (!entry) continue; // trailing split artifact
    const code = entry.slice(0, 2);
    const p = entry.slice(3);
    if (p) paths.push(p);
    if (code[0] === 'R' || code[0] === 'C') {
      i++; // skip the source-path token
    }
  }
  return paths;
}

/**
 * Classify every dirty path in `rootDir` against `origin/<default>` — the
 * read-only half of `check-primaries-clean.sh`. Never fetches, never mutates.
 * Returns null only when `rootDir` isn't inside a git checkout at all.
 */
export function classifyPrimary(rootDir: string): PrimaryClassification | null {
  const topLevel = gitOut(rootDir, ['rev-parse', '--show-toplevel']);
  if (!topLevel) return null; // not a git repo

  const rawDefault = gitOut(rootDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const defaultBranch = rawDefault.replace(/^origin\//, '') || 'main';
  const originRef = `origin/${defaultBranch}`;
  const branch = gitOut(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const onDefaultBranch = branch === defaultBranch;

  const empty: Omit<PrimaryClassification, 'note'> = {
    rootDir,
    originRef: null,
    defaultBranch,
    branch,
    onDefaultBranch,
    behind: 0,
    ahead: 0,
    redundant: [],
    orphans: [],
  };

  if (!onDefaultBranch) {
    return { ...empty, note: 'off-default-branch' };
  }
  if (!gitOk(rootDir, ['rev-parse', '--verify', '-q', originRef])) {
    return { ...empty, note: 'missing-origin-ref' };
  }

  const behind = Number(gitOut(rootDir, ['rev-list', '--count', `HEAD..${originRef}`])) || 0;
  const ahead = Number(gitOut(rootDir, ['rev-list', '--count', `${originRef}..HEAD`])) || 0;

  const redundant: TidyClassification[] = [];
  const orphans: TidyClassification[] = [];
  const raw = gitOut(rootDir, ['status', '--porcelain', '-z']);
  for (const p of parsePorcelainZ(raw)) {
    const existsLocally = fs.existsSync(path.join(rootDir, p));
    const existsUpstream = gitOk(rootDir, ['cat-file', '-e', `${originRef}:${p}`]);

    let kind: 'REDUNDANT' | 'ORPHAN';
    if (existsLocally) {
      if (!existsUpstream) {
        kind = 'ORPHAN'; // content not on origin at all
      } else {
        const upstreamBytes = gitShowBytes(rootDir, originRef, p);
        const localBytes = safeReadFile(path.join(rootDir, p));
        // Any read failure ⇒ can't prove equality ⇒ ORPHAN (fail toward keeping
        // it, mirroring isCheckoutOccupied's "any error ⇒ occupied" direction).
        kind = upstreamBytes !== null && localBytes !== null && upstreamBytes.equals(localBytes)
          ? 'REDUNDANT'
          : 'ORPHAN';
      }
    } else {
      kind = existsUpstream ? 'ORPHAN' : 'REDUNDANT'; // deleted-and-absent-upstream too ⇒ consistent
    }

    const entry: TidyClassification = { path: p, kind, existsLocally, existsUpstream };
    (kind === 'REDUNDANT' ? redundant : orphans).push(entry);
  }

  return { ...empty, originRef, behind, ahead, redundant, orphans };
}

function safeReadFile(absPath: string): Buffer | null {
  try {
    return fs.readFileSync(absPath);
  } catch {
    return null;
  }
}

/**
 * The other LIVE sessions (per SPEC-026 presence, excluding `selfSessionId`)
 * whose `worktreeRoot` is this exact checkout. A non-empty result means
 * someone else is actively working in this primary right now — reason enough
 * for the tidy command to refuse (a peer mid-edit could be about to touch one
 * of these "redundant" paths, even though the classification is correct at
 * this instant). Distinct from `isCheckoutOccupied` (presence.ts), which
 * counts a caller's OWN session as occupying its own tree — exactly the wrong
 * answer here, where the caller IS that session and needs to know about
 * everyone ELSE.
 */
export function otherLiveSessionsHere(
  rootDir: string,
  worktreeRoot: string,
  selfSessionId?: string,
  now = Date.now(),
): SessionPresenceRecord[] {
  const target = path.resolve(worktreeRoot);
  const out: SessionPresenceRecord[] = [];
  for (const { rec } of readAllRecords(rootDir)) {
    if (!rec) continue;
    if (selfSessionId && rec.sessionId === selfSessionId) continue;
    if (path.resolve(rec.worktreeRoot) !== target) continue;
    if (!isRecordLive(rec, now)) continue;
    out.push(rec);
  }
  return out;
}

/** One requested path's outcome from {@link tidyRedundantPaths}. */
export interface TidySkip {
  path: string;
  reason: string;
}

export interface TidyResult {
  removed: string[];
  skipped: TidySkip[];
}

/**
 * Discard the local, uncommitted copy of each path in `requestedPaths` — ONLY
 * the ones a fresh re-classification (taken right now, not the caller's
 * possibly-stale scan) still calls REDUNDANT. Every other path is skipped and
 * reported, never silently dropped.
 *
 *   untracked REDUNDANT path       → delete the file
 *   tracked, unstaged-only edit    → `git checkout -- path` (restores HEAD's
 *                                     content; safe because a byte-identical
 *                                     copy is proven to live on `origin`)
 *   anything else (staged changes,
 *   locally-deleted, off-default,
 *   no origin ref, no longer
 *   REDUNDANT)                     → skipped with a reason, never touched
 *
 * Never fetches. Never moves HEAD. Never touches an ORPHAN path, even if the
 * caller (by mistake) asked it to.
 */
export function tidyRedundantPaths(rootDir: string, requestedPaths: string[]): TidyResult {
  const fresh = classifyPrimary(rootDir);
  const removed: string[] = [];
  const skipped: TidySkip[] = [];

  if (!fresh) {
    return { removed, skipped: requestedPaths.map((p) => ({ path: p, reason: 'not a git repo' })) };
  }
  if (fresh.note) {
    const reason =
      fresh.note === 'off-default-branch'
        ? `primary moved off ${fresh.defaultBranch} (now on ${fresh.branch}) since the scan`
        : `origin/${fresh.defaultBranch} is no longer resolvable locally`;
    return { removed, skipped: requestedPaths.map((p) => ({ path: p, reason })) };
  }

  const freshRedundant = new Map(fresh.redundant.map((c) => [c.path, c]));
  for (const p of requestedPaths) {
    const c = freshRedundant.get(p);
    if (!c) {
      skipped.push({ path: p, reason: 'no longer classified REDUNDANT — left untouched' });
      continue;
    }
    if (!c.existsLocally) {
      skipped.push({ path: p, reason: 'locally deleted — restore manually if this was unintended' });
      continue;
    }
    const abs = path.join(rootDir, p);
    if (!gitOk(rootDir, ['ls-files', '--error-unmatch', '--', p])) {
      // untracked — a plain delete carries no history to lose.
      try {
        fs.unlinkSync(abs);
        removed.push(p);
      } catch (e) {
        skipped.push({ path: p, reason: `delete failed: ${(e as Error).message}` });
      }
      continue;
    }
    if (!gitOk(rootDir, ['diff', '--cached', '--quiet', '--', p])) {
      // has staged changes — out of scope, resolve manually.
      skipped.push({ path: p, reason: 'has staged changes — tidy only discards unstaged/untracked content' });
      continue;
    }
    if (gitOk(rootDir, ['checkout', '--', p])) {
      removed.push(p);
    } else {
      skipped.push({ path: p, reason: 'git checkout failed' });
    }
  }

  return { removed, skipped };
}
