#!/usr/bin/env -S npx tsx
/**
 * check-script-binaries.ts — every binary a package.json script runs must come from a
 * declared (dev)dependency, not from an undeclared network `npx` fetch (#979).
 *
 *   npx tsx scripts/check-script-binaries.ts
 *
 * Exit 0 = all script binaries resolve to declared packages. Exit 1 = an undeclared binary,
 * OR the check could not do its job (no package.json, or declared packages not installed).
 * Fail closed: an uninstalled dependency is RED, never a silent pass.
 *
 * Merge-blocking enforcement: packages/minspec/tests/script-binaries.test.ts (CI runs
 * `npx vitest`, which never fires npm's `pretest`). Logic: scripts/lib/script-binaries.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findUndeclaredBinaries } from './lib/script-binaries';

const ROOT = process.cwd();

const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf-8'));

function main(): number {
  const pkgPath = join(ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`check-script-binaries: ${pkgPath} not found`);
    return 1;
  }
  const pkg = readJson(pkgPath) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const bins = new Set<string>();
  const missing: string[] = [];
  for (const name of declared) {
    const p = join(ROOT, 'node_modules', name, 'package.json');
    if (!existsSync(p)) {
      missing.push(name);
      continue;
    }
    const bin = readJson(p).bin;
    if (typeof bin === 'string') bins.add(name.split('/').pop() as string);
    else if (bin && typeof bin === 'object') Object.keys(bin).forEach((b) => bins.add(b));
  }
  if (missing.length > 0) {
    console.error(`check-script-binaries: declared packages not installed (run npm ci): ${missing.join(', ')}`);
    return 1;
  }
  const bad = findUndeclaredBinaries(pkg.scripts ?? {}, bins);
  for (const b of bad) {
    console.error(`script "${b.script}" runs "${b.binary}", which no declared dependency provides: ${b.command}`);
  }
  if (bad.length > 0) return 1;
  console.log(`check-script-binaries: ${Object.keys(pkg.scripts ?? {}).length} scripts, ${bins.size} declared binaries — all resolve`);
  return 0;
}

process.exit(main());
