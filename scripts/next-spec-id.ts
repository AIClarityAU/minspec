#!/usr/bin/env -S npx tsx
/**
 * next-spec-id.ts — open-PR-aware spec-id allocator (#3164).
 *
 *   npx tsx scripts/next-spec-id.ts --repo OWNER/NAME [--base main] [--specs-dir specs]
 *
 * Prints `SPEC-NNN` = max(base, every open PR, every worktree of this repository, every
 * local branch, every remote-tracking ref, every live claim) + 1 on stdout, and has already
 * claimed that id. Dev-time dispatch machinery: it reads the network, so it
 * lives here and never in the Tier-0 extension. FAILS CLOSED — exit 1 with no id on stdout
 * if any source could not be read or no claim could be taken, because a partial view is
 * exactly the blind read that handed SPEC-232 to 11 PRs.
 *
 * WHY A CLAIM. A Specify dispatch's PR opens only after its agent finishes, and the drain
 * runs dispatches in parallel, so sibling dispatches read one open-PR set. Each allocation
 * therefore takes the id by creating a file only one process can create (O_EXCL), under the
 * git common dir so every worktree of the repository shares it.
 *
 * A claim is `<common>/minspec/spec-id-claims/SPEC-NNN.<generation>`, and its mtime is when
 * it was taken. It reserves the id for CLAIM_TTL_MS, and by then the spec is visible another
 * way (the agent's worktree, its branch, its PR) or the dispatch is dead. So a crash blocks
 * no id for good. An expired claim is never deleted or overwritten: re-taking the id creates
 * the next generation. Names are therefore never reused, so a process stalled on an old view
 * cannot take over or remove a claim made since, and O_EXCL alone decides every race. That
 * leaves one small file per allocation in `.git`.
 *
 * LIMIT. The claim is per machine and refs are as of the last fetch. Two machines can still
 * pick one id until one of their PRs opens.
 */

import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openPrSpecClaims, baseSpecDirs, SpecIdGateError } from './lib/open-pr-spec-claims';
import { nextFreeSpecId } from './lib/spec-id-claims';
import { canonicalSpecId } from './lib/spec-id-collision';

/** Twice LEASE_ABS_MAX_SECS (scripts/lib/issue-lease.sh), the longest a dispatch may run. */
const CLAIM_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_CLAIM_ATTEMPTS = 1000;

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new SpecIdGateError(`missing required argument --${name}. Usage: next-spec-id.ts --repo OWNER/NAME [--base main]`);
}

function git(args: string[], input?: string): Buffer {
  try {
    return execFileSync('git', args, {
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    throw new SpecIdGateError(`\`git ${args.join(' ')}\` failed:\n${(err.stderr?.toString() || err.message || String(e)).trim()}`);
  }
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // a worktree listed but gone, or removed under us, holds nothing
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new SpecIdGateError(`could not list ${dir}: ${(e as Error).message}`);
  }
}

/** Spec directories in one working tree (uncommitted included). */
function treeSpecDirs(treeRoot: string, specsDir: string): string[] {
  const root = join(treeRoot, specsDir);
  return subdirectories(root).flatMap((product) =>
    subdirectories(join(root, product)).map((spec) => `${specsDir}/${product}/${spec}`),
  );
}

/** Spec directories in the working tree of every worktree of this repository, this one included. */
function worktreeSpecDirs(specsDir: string): string[] {
  return git(['worktree', 'list', '--porcelain'])
    .toString('utf-8')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .flatMap((line) => treeSpecDirs(line.slice('worktree '.length), specsDir));
}

/** One `git cat-file --batch`: the tree objects among `objects`; a missing object is skipped. */
function readTrees(objects: string[]): Buffer[] {
  const out = git(['cat-file', '--batch'], `${objects.join('\n')}\n`);
  const trees: Buffer[] = [];
  for (let at = 0; at < out.length; ) {
    const eol = out.indexOf(0x0a, at);
    const header = out.toString('utf-8', at, eol);
    at = eol + 1;
    if (header.endsWith(' missing')) continue;
    const m = header.match(/^[0-9a-f]+ (\w+) (\d+)$/);
    if (!m) throw new SpecIdGateError(`could not parse \`git cat-file --batch\` output: ${header.slice(0, 200)}`);
    const size = Number(m[2]);
    if (m[1] === 'tree') trees.push(out.subarray(at, at + size));
    at += size + 1; // the object, then its trailing newline
  }
  return trees;
}

/** The subdirectories in a raw tree object: `<mode> <name>\0<binary hash>` per entry. */
function subtrees(tree: Buffer, hashBytes: number): Array<{ name: string; oid: string }> {
  const entries: Array<{ name: string; oid: string }> = [];
  for (let at = 0; at < tree.length; ) {
    const space = tree.indexOf(0x20, at);
    const nul = tree.indexOf(0, space);
    const end = nul + 1 + hashBytes;
    if (tree.toString('latin1', at, space) === '40000') {
      entries.push({ name: tree.toString('utf-8', space + 1, nul), oid: tree.toString('hex', nul + 1, end) });
    }
    at = end;
  }
  return entries;
}

/**
 * Spec directories in the tree of every local branch and remote-tracking ref. Distinct tips,
 * then distinct product trees, in one batch process each (SPEC-227 FR-4: a process per ref
 * took 6.5 s on this repository).
 */
function refSpecDirs(specsDir: string): string[] {
  const tips = [
    ...new Set(
      git(['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes']).toString('utf-8').split('\n').filter(Boolean),
    ),
  ];
  if (tips.length === 0) return [];
  const hashBytes = tips[0].length / 2;
  const products = new Map<string, string>();
  for (const specsTree of readTrees(tips.map((tip) => `${tip}:${specsDir}`))) {
    for (const { name, oid } of subtrees(specsTree, hashBytes)) products.set(oid, name);
  }
  if (products.size === 0) return [];
  const oids = [...products.keys()];
  const dirs = new Set<string>();
  readTrees(oids).forEach((productTree, i) => {
    for (const { name } of subtrees(productTree, hashBytes)) dirs.add(`${specsDir}/${products.get(oids[i])}/${name}`);
  });
  return [...dirs];
}

function claimDirectory(): string {
  const common = git(['rev-parse', '--git-common-dir']).toString('utf-8').trim();
  const dir = resolve(common, 'minspec', 'spec-id-claims');
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new SpecIdGateError(`could not create ${dir}: ${(e as Error).message}`);
  }
  return dir;
}

/** Every claim on disk: its number, its generation, and whether it still reserves the id. */
function readClaims(dir: string): Array<{ number: number; generation: number; live: boolean }> {
  const now = Date.now();
  const claims = [];
  try {
    for (const name of readdirSync(dir)) {
      const m = name.match(/^SPEC-(\d+)\.(\d+)$/);
      if (!m) continue;
      const live = now - statSync(join(dir, name)).mtimeMs < CLAIM_TTL_MS;
      claims.push({ number: Number(m[1]), generation: Number(m[2]), live });
    }
  } catch (e) {
    throw new SpecIdGateError(`could not read the claims in ${dir}: ${(e as Error).message}`);
  }
  return claims;
}

/** Take the lowest id above `floor` and above every live claim. Losing a race re-reads. */
function claimNextId(dir: string, floor: number): string {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const claims = readClaims(dir);
    const number = Math.max(floor, ...claims.filter((c) => c.live).map((c) => c.number)) + 1;
    const generation = Math.max(-1, ...claims.filter((c) => c.number === number).map((c) => c.generation)) + 1;
    const id = canonicalSpecId(String(number));
    try {
      const fd = openSync(join(dir, `${id}.${generation}`), 'wx');
      writeSync(fd, `pid ${process.pid}\n`);
      closeSync(fd);
      return id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new SpecIdGateError(`could not claim ${id} in ${dir}: ${(e as Error).message}`);
    }
  }
  throw new SpecIdGateError(`no id claimed in ${dir} after ${MAX_CLAIM_ATTEMPTS} attempts.`);
}

try {
  const repo = arg('repo');
  const base = arg('base', 'main');
  const specsDir = arg('specs-dir', 'specs').replace(/\/+$/, '');
  const dir = claimDirectory();
  const open = openPrSpecClaims(repo, specsDir);
  const next = nextFreeSpecId(
    baseSpecDirs(repo, base, specsDir),
    open.flatMap((p) => p.dirs),
    worktreeSpecDirs(specsDir),
    refSpecDirs(specsDir),
  );
  console.log(claimNextId(dir, Number(next.slice('SPEC-'.length)) - 1));
} catch (e) {
  const why = e instanceof SpecIdGateError ? e.message : `unexpected error: ${(e as Error).message}`;
  console.error(`next spec id FAILED CLOSED — ${why}`);
  process.exit(1);
}
