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

import { checkRepoScriptBinaries } from './lib/script-binaries';

function main(): number {
  const r = checkRepoScriptBinaries(process.cwd());
  for (const e of r.errors) console.error(e);
  if (r.errors.length > 0) return 1;
  console.log(`check-script-binaries: ${r.scriptCount} scripts, ${r.binaryCount} declared binaries — all resolve`);
  return 0;
}

process.exit(main());
