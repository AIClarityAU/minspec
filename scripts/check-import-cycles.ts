#!/usr/bin/env tsx
/**
 * check-import-cycles.ts — SPEC-040 FR-2, the runtime-import-cycle gate.
 *
 * Fails the build when any two modules under `packages/minspec/src` import each
 * other at runtime, directly or through a chain. Type-only edges are erased by
 * the compiler and do not count; MinSpec's three known `lib` cycles are each held
 * open by exactly one such edge, so this gate ships green and guards the next
 * `type`→value flip that would close one for real (AC-4).
 *
 * Thin runner: every graph-building and cycle-finding decision lives in the Tier-0
 * `packages/minspec/src/lib/import-cycle-check.ts`, which is offline and
 * dependency-free (DR-064 §1, constitution invariant #1). What stays here is the
 * gate's own plumbing — locating the tree, the self-check below
 * (`MIN_SCANNED_MODULES`), reporting, and the exit code. Wired as
 * `npm run check:cycles` and run by CI's `lint` job; the runner itself is covered
 * end-to-end by `packages/minspec/tests/check-import-cycles-cli.test.ts`.
 */

import { existsSync } from 'fs';
import { join, relative } from 'path';
import {
  buildValueImportGraph,
  detectImportCycles,
} from '../packages/minspec/src/lib/import-cycle-check';

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, 'packages', 'minspec', 'src');

/**
 * Fewest modules a run may scan before its verdict means anything.
 *
 * DR-066 — no silent gate. The `existsSync` guard below catches a MISSING source
 * root, but nothing catches an EMPTY or wrong one: aim this at a directory that
 * exists and holds no TypeScript and the gate prints `0 modules scanned, 0 runtime
 * import cycles` and exits 0. That is the silent gate in its purest form — a scanner
 * that has quietly stopped finding files reports no cycles, and "no cycles" is
 * precisely what a pass looks like, so it would keep passing forever while guarding
 * nothing. Only asserting the COUNT can tell an acyclic tree from an unread one.
 *
 * The floor sits far below the real tree (95 modules when it was added), so ordinary
 * deletions and refactors never trip it, and far above the zero-to-a-handful that a
 * wrong cwd, a moved package, or a broken directory walk produces. If the source tree
 * ever genuinely shrinks this far, lowering the number is a deliberate edit with a
 * reviewer on it — which is the point.
 */
const MIN_SCANNED_MODULES = 50;

function run(): number {
  if (!existsSync(SRC_ROOT)) {
    console.error(
      `FAIL ${relative(ROOT, SRC_ROOT)}: source root not found — run this from the repo root.`,
    );
    return 1;
  }

  const graph = buildValueImportGraph(SRC_ROOT);

  // Checked before the scan's RESULT is interpreted, because the floor is a
  // precondition on the scan rather than a finding within it: a run that saw almost
  // nothing has not earned the right to pronounce the tree acyclic.
  if (graph.files.length < MIN_SCANNED_MODULES) {
    console.error(
      `FAIL ${relative(ROOT, SRC_ROOT)}: ${graph.files.length} module(s) scanned, below the ` +
        `floor of ${MIN_SCANNED_MODULES} — this run did not see the tree it guards, so it ` +
        'proves nothing about it.',
    );
    console.error(
      'Run this from the repo root. If the source tree genuinely shrank this far, lower ' +
        'MIN_SCANNED_MODULES in scripts/check-import-cycles.ts deliberately.',
    );
    return 1;
  }

  // Surfaced, never swallowed: a relative import naming nothing on disk means the
  // scanner could not follow an edge, and an unfollowed edge is a blind spot in
  // the gate. Reported as a warning rather than a failure because the compiler
  // already fails on a genuinely broken import; the zero-unresolved assertion in
  // import-cycle-check.test.ts is what makes a resolver regression fail loudly.
  for (const { file, specifier, line } of graph.unresolved) {
    console.warn(`WARN ${file}:${line}: unresolved relative import "${specifier}" — not scanned.`);
  }

  const cycles = detectImportCycles(graph);
  if (cycles.length === 0) {
    console.log(
      `Import cycle check passed — ${graph.files.length} modules scanned, 0 runtime import cycles.`,
    );
    return 0;
  }

  for (const { members } of cycles) {
    console.error(`FAIL runtime import cycle: ${[...members, members[0]].join(' -> ')}`);
  }
  console.error(
    `\n${cycles.length} runtime import cycle(s) in ${relative(ROOT, SRC_ROOT)}. ` +
      'Break each loop — re-home the shared value, or make the edge `import type` ' +
      'if the import is only ever a type.',
  );
  return 1;
}

let exitCode: number;
try {
  exitCode = run();
} catch (error) {
  // DR-066 — no silent gate. A scan that throws has NOT proved the tree acyclic,
  // so it exits non-zero with the failure in full, never falls through to a pass.
  console.error('FAIL import-cycle check crashed — the gate did not run:');
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  exitCode = 1;
}
process.exit(exitCode);
