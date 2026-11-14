/**
 * Pure decision for the pre-commit approve-then-edit race gate (#424).
 *
 * THE RACE. "Approve Spec" hashes + baselines the file at one moment and `git commit`
 * lands at another; nothing checked that the bytes did not move in between. An edit in
 * that gap (or a spec edited after approval and committed alone) produces a commit whose
 * approvable no longer matches its sidecar's `specHash`, so the approval reads `stale`
 * with no git history ever showing the content "change" (SPEC-026, commit e9f82ca).
 *
 * TWO REFUSALS, both about a staged approvable that has an approval sidecar:
 *   1. `sidecar-not-restaged` — the sidecar is committed at HEAD, is NOT part of this
 *      commit, and the staged file's `specHash` differs from the sidecar's: an edit that
 *      silently voids the approval. A deliberate re-approval stages the sidecar too.
 *   2. `sidecar-mismatch` — the sidecar IS staged but its `specHash` does not describe
 *      the staged file: the approval was given to different bytes than the ones landing.
 *      This is the exact shape of e9f82ca, which the "sidecar staged => allowed" exemption
 *      alone would let straight through.
 *
 * Deliberately I/O-free: the caller (scripts/check-approval-sidecar-race.ts) reads git.
 * `hash` is injected so this module stays testable without the canonicalizer's imports.
 */

export const APPROVALS_PREFIX = '.minspec/approvals/';

/** Everything the decision needs about one staged approvable. */
export interface StagedApprovable {
  /** Repo-relative path of the staged file. */
  readonly path: string;
  /** Staged (index) content. */
  readonly stagedContent: string;
  /** The sidecar committed at HEAD, parsed JSON text; null when none exists at HEAD. */
  readonly headSidecarText: string | null;
  /** True when the sidecar path is part of this commit (added/modified, not deleted). */
  readonly sidecarStaged: boolean;
  /** Staged (index) sidecar text; null when the sidecar is not staged. */
  readonly stagedSidecarText: string | null;
}

export interface RaceFailure {
  readonly path: string;
  readonly check: 'sidecar-not-restaged' | 'sidecar-mismatch' | 'sidecar-unreadable';
  readonly detail: string;
}

export function sidecarPathFor(approvablePath: string): string {
  return `${APPROVALS_PREFIX}${approvablePath}.json`;
}

/** Extract the string `specHash` from sidecar JSON text; null if absent or unparseable. */
export function readSidecarHash(text: string): string | null {
  try {
    const rec: unknown = JSON.parse(text);
    if (rec && typeof rec === 'object' && typeof (rec as { specHash?: unknown }).specHash === 'string') {
      return (rec as { specHash: string }).specHash;
    }
  } catch {
    // fall through: an unreadable sidecar is reported by the caller, never passed.
  }
  return null;
}

export function checkApprovable(
  item: StagedApprovable,
  hash: (raw: string) => string,
): RaceFailure | null {
  const live = hash(item.stagedContent);

  if (item.sidecarStaged) {
    const text = item.stagedSidecarText ?? '';
    const recorded = readSidecarHash(text);
    if (recorded === null) {
      return {
        path: item.path,
        check: 'sidecar-unreadable',
        detail: `the staged sidecar ${sidecarPathFor(item.path)} has no readable string specHash`,
      };
    }
    if (recorded !== live) {
      return {
        path: item.path,
        check: 'sidecar-mismatch',
        detail:
          `staged sidecar specHash=${recorded} but the staged file canonicalizes to ${live} — ` +
          'the file changed after "Approve Spec" ran; re-run it and stage the fresh sidecar',
      };
    }
    return null;
  }

  if (item.headSidecarText === null) return null; // never approved: nothing to void
  const recorded = readSidecarHash(item.headSidecarText);
  if (recorded === null) {
    return {
      path: item.path,
      check: 'sidecar-unreadable',
      detail: `the committed sidecar ${sidecarPathFor(item.path)} has no readable string specHash`,
    };
  }
  if (recorded !== live) {
    return {
      path: item.path,
      check: 'sidecar-not-restaged',
      detail:
        `committed sidecar specHash=${recorded} but the staged file canonicalizes to ${live} — ` +
        'this commit voids the approval without re-approving; run "MinSpec: Approve Spec for ' +
        `Implementation" and stage ${sidecarPathFor(item.path)} with it`,
    };
  }
  return null;
}

export function checkApprovables(
  items: readonly StagedApprovable[],
  hash: (raw: string) => string,
): RaceFailure[] {
  const out: RaceFailure[] = [];
  for (const it of items) {
    const f = checkApprovable(it, hash);
    if (f) out.push(f);
  }
  return out;
}
