#!/usr/bin/env -S npx tsx
/**
 * next-spec-id.ts — open-PR-aware spec-id allocator (#3164).
 *
 *   npx tsx scripts/next-spec-id.ts --repo OWNER/NAME [--base main] [--specs-dir specs]
 *
 * Prints `SPEC-NNN` = max(base, this working tree, every open PR) + 1 on stdout.
 * Dev-time dispatch machinery: it reads the network, so it lives here and never in the
 * Tier-0 extension. FAILS CLOSED — exit 1 with no id on stdout if any source could not
 * be read, because a partial view is exactly the blind read that handed SPEC-232 to 11 PRs.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { openPrSpecClaims, baseSpecDirs, SpecIdGateError } from './lib/open-pr-spec-claims';
import { nextFreeSpecId } from './lib/spec-id-claims';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new SpecIdGateError(`missing required argument --${name}. Usage: next-spec-id.ts --repo OWNER/NAME [--base main]`);
}

/** Spec directories in this working tree (uncommitted included). */
function localSpecDirs(specsDir: string): string[] {
  const root = join(process.cwd(), specsDir);
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  for (const product of readdirSync(root, { withFileTypes: true })) {
    if (!product.isDirectory()) continue;
    for (const spec of readdirSync(join(root, product.name), { withFileTypes: true })) {
      if (spec.isDirectory()) dirs.push(`${specsDir}/${product.name}/${spec.name}`);
    }
  }
  return dirs;
}

try {
  const repo = arg('repo');
  const base = arg('base', 'main');
  const specsDir = arg('specs-dir', 'specs').replace(/\/+$/, '');
  const open = openPrSpecClaims(repo, specsDir);
  console.log(
    nextFreeSpecId(baseSpecDirs(repo, base, specsDir), localSpecDirs(specsDir), open.flatMap((p) => p.dirs)),
  );
} catch (e) {
  const why = e instanceof SpecIdGateError ? e.message : `unexpected error: ${(e as Error).message}`;
  console.error(`next spec id FAILED CLOSED — ${why}`);
  process.exit(1);
}
