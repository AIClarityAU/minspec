/**
 * Cross-PR spec-id decisions (#3164) — the spec twin of `dr-id-collision.ts`.
 *
 * ROOT CAUSE this module closes. A Specify dispatch picks its spec id as
 * `max(SPEC id on its own checkout) + 1`. Open pull requests are invisible from a base
 * checkout, so every dispatch that ran while SPEC-232 was in flight picked SPEC-232:
 * on 2026-10-27, 11 open PRs declared it. Each stayed green until its next base update,
 * then the validator's duplicate-id rule (correct) failed the required check. DRs had
 * the missing half already (`check-dr-id-collision.ts`, "Next free id" = max over main
 * and every open PR); spec ids had neither the allocator nor the advisory PR check.
 *
 * Keys on DIRECTORY names, never frontmatter (a PR's frontmatter is not cheaply readable
 * across every open PR); `checkDeclaredSpecIds` already forces id and directory to agree
 * on every tree that passes validation.
 *
 * Pure: no fs, no network. The network read lives in the dev-time scripts that call it —
 * nothing under `packages/` imports this (constitution invariant 1, DR-004).
 */

import { canonicalSpecId, specIdFromPath } from './spec-id-collision';

/** A file entry of a pull request, as the GitHub files API reports it. */
export interface SpecPrFileEntry {
  filename: string;
  status: string;
}

/** The spec directories one pull request adds. */
export interface SpecPrClaims {
  pr: number;
  /** Repo-relative spec directories, e.g. `specs/minspec/SPEC-232-slug`. */
  dirs: string[];
}

/** Statuses that INTRODUCE a path (a rename's `filename` is the NEW name). */
const CLAIMING_STATUSES = new Set(['added', 'renamed', 'copied']);

/** `specs/minspec/SPEC-232-slug/requirements.md` → `specs/minspec/SPEC-232-slug`. */
export function specDirFromPath(file: string): string | undefined {
  const m = file.replace(/\\/g, '/').match(/^(.*?\/?SPEC-\d+[^/]*)\//);
  return m && specIdFromPath(file) !== undefined ? m[1] : undefined;
}

/** Distinct, sorted spec directories among `paths`. */
export function specDirsFromPaths(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const d = specDirFromPath(p);
    if (d !== undefined) dirs.add(d);
  }
  return [...dirs].sort();
}

/** The spec directories a PR's file list INTRODUCES. */
export function claimedSpecDirsFromPrFiles(entries: SpecPrFileEntry[], specsDir: string): string[] {
  const prefix = specsDir.replace(/\/+$/, '') + '/';
  return specDirsFromPaths(
    entries
      .filter((e) => CLAIMING_STATUSES.has(e.status.toLowerCase()) && e.filename.startsWith(prefix))
      .map((e) => e.filename),
  );
}

/** The highest numeric id among `ids`, 0 when none parse. */
function maxSpecNumber(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(/^SPEC-(\d+)$/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max;
}

/** Canonical ids claimed by a set of spec directories. */
export function idsFromDirs(dirs: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const d of dirs) {
    const id = specIdFromPath(`${d}/x`);
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * The next free spec id: max over every claimed id (base, working tree, every open PR) + 1.
 * Callers pass ALL the sources; an empty union is `SPEC-001`.
 */
export function nextFreeSpecId(...sources: Array<Iterable<string>>): string {
  const all: string[] = [];
  for (const s of sources) all.push(...idsFromDirs(s));
  return canonicalSpecId(String(maxSpecNumber(all) + 1));
}

export interface SpecIdCollisionInput {
  baseRef: string;
  /** Spec directories on the base branch's CURRENT tip. */
  baseDirs: string[];
  /** Spec directories present in the PR under test's own tree that it adds. */
  subject: SpecPrClaims;
  /** Every OTHER open PR. May include the subject; it is filtered. */
  otherPrs: SpecPrClaims[];
  /** Extra directories to count for the next-free id only (e.g. a local working tree). */
  extraDirs?: string[];
}

export interface SpecIdFinding {
  id: string;
  /** The subject's directory carrying the contested id. */
  dir: string;
  /** Who else holds it: `base` or a PR number. */
  against: 'base' | number;
  otherDir: string;
}

export interface SpecIdVerdict {
  ok: boolean;
  findings: SpecIdFinding[];
  nextFreeId: string;
  message: string;
}

/**
 * Decide whether the subject PR's new spec ids are free.
 *
 * - An id held by a DIFFERENT directory on the base always fails the subject.
 * - Two open PRs on one id: the one opened later (higher number) yields, so exactly one
 *   of a pair is told to move (mirrors the DR gate and SPEC-227 FR-10).
 * - The same directory on both sides is not a collision (extra files in one spec).
 */
export function decideSpecIdCollision(input: SpecIdCollisionInput): SpecIdVerdict {
  const baseById = new Map<string, string>();
  for (const d of input.baseDirs) {
    const id = specIdFromPath(`${d}/x`);
    if (id !== undefined && !baseById.has(id)) baseById.set(id, d);
  }
  const baseDirSet = new Set(input.baseDirs);
  const others = input.otherPrs.filter((p) => p.pr !== input.subject.pr);

  const findings: SpecIdFinding[] = [];
  for (const dir of input.subject.dirs) {
    if (baseDirSet.has(dir)) continue; // already a merged spec; this PR extends it
    const id = specIdFromPath(`${dir}/x`);
    if (id === undefined) continue;
    const onBase = baseById.get(id);
    if (onBase !== undefined) {
      findings.push({ id, dir, against: 'base', otherDir: onBase });
      continue;
    }
    for (const other of others) {
      if (other.pr > input.subject.pr) continue; // the later PR is the one that yields
      const clash = other.dirs.find((d) => d !== dir && specIdFromPath(`${d}/x`) === id);
      if (clash !== undefined) {
        findings.push({ id, dir, against: other.pr, otherDir: clash });
        break;
      }
    }
  }

  const nextFreeId = nextFreeSpecId(
    input.baseDirs,
    input.subject.dirs,
    others.flatMap((p) => p.dirs),
    input.extraDirs ?? [],
  );

  if (findings.length === 0) {
    return {
      ok: true,
      findings,
      nextFreeId,
      message: `Spec id uniqueness OK — every spec id PR #${input.subject.pr} adds is free on ${input.baseRef} and across ${others.length} other open PR(s).`,
    };
  }
  const lines = findings.map((f) =>
    f.against === 'base'
      ? `  - ${f.id}: ${f.dir} collides with ${f.otherDir}, already on ${input.baseRef}.`
      : `  - ${f.id}: ${f.dir} collides with ${f.otherDir} in open PR #${f.against} (opened earlier).`,
  );
  return {
    ok: false,
    findings,
    nextFreeId,
    message:
      `Spec id collision — PR #${input.subject.pr} adds a spec id another spec already claims:\n${lines.join('\n')}\n` +
      `Next free id: ${nextFreeId}\n` +
      `Renumber: rename the directory to ${nextFreeId}-<slug> and change \`id:\` (and any SPEC refs inside it) to ${nextFreeId}. ` +
      'Keep the id on an APPROVED spec if there is one — its approval sidecar is path-keyed.',
  };
}
