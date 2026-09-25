#!/usr/bin/env -S npx tsx
/**
 * check-orphaned-docstring.ts — makes a detached doc comment un-landable (#2009).
 *
 *   npx tsx scripts/check-orphaned-docstring.ts [--dir packages]
 *
 * Exit 0 = every doc block has a declaration, or is a known tracked instance.
 * Exit 1 = at least one new orphan, OR the check could not do its job.
 *
 * ── WHY A GATE AND NOT A REVIEW NOTE ─────────────────────────────────────────
 * The instance that prompted this (#1955) passed typecheck, lint, 6110 tests and a
 * four-voter AI review panel on the commit that introduced it, and was caught only on a
 * later re-read of the diff. Review is not a reliable catch for it, which is the
 * constitution's "enforce, don't trust the model" case.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 * An unreadable file, a missing directory, or a walk that visited nothing is RED. There is
 * no path here that exits 0 without having actually read sources: "green because it did not
 * run" is the failure this repo keeps re-finding, and a gate about false signposts that
 * itself reports a false green would be the joke writing itself. The scanned COUNT is
 * printed on success for the same reason — "scanned 0, all clean" and "scanned 435, all
 * clean" must not print identically.
 *
 * ── WHERE THIS IS ENFORCED ───────────────────────────────────────────────────
 * `npm run check:orphaned-docstring`. The merge-blocking enforcement is a T0 test
 * (packages/minspec/tests/orphaned-docstring.test.ts) that shells out to this file, because
 * CI runs `npx vitest` directly and never fires npm's `pretest` hook — a gate wired only to
 * `pretest` gates nothing in CI. A named CI step would be more discoverable, but the App
 * installation holds no `workflows` permission by design (host DR-079).
 *
 * Decision logic lives in the pure, unit-tested lib/orphaned-docstring.ts; this file is IO
 * only: walk, read, hand the text over, print, set the exit code.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  findOrphanedDocstrings,
  formatOrphanedDocstring,
  KNOWN_ORPHANED_DOCSTRINGS,
  type OrphanedDocstring,
} from './lib/orphaned-docstring';

const ROOT = process.cwd();

/**
 * Both source roots by default. `scripts/` is not exempt: the fifth known instance lives in
 * `scripts/lib/swallowed-gate-signal.ts`, the library behind the sibling lint this one is
 * modelled on. A gate that skipped the gate infrastructure would miss the case most likely
 * to matter.
 */
const DEFAULT_ROOTS = ['packages', 'scripts'] as const;

const argDirs = (): readonly string[] => {
  const i = process.argv.indexOf('--dir');
  return i !== -1 && process.argv[i + 1] ? [process.argv[i + 1]] : DEFAULT_ROOTS;
};

/** Every non-declaration .ts source under `dir`. Throws rather than returning [] — see FAIL CLOSED. */
function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
      out.push(...tsSources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main(): number {
  const roots = argDirs();
  const files: string[] = [];
  for (const r of roots) {
    const dir = join(ROOT, r);
    if (!statSync(dir).isDirectory()) {
      console.error(`orphaned-docstring: --dir ${r} is not a directory.`);
      return 1;
    }
    files.push(...tsSources(dir));
  }
  if (files.length === 0) {
    console.error(
      `orphaned-docstring: walked ${roots.join(', ')} and found NO .ts sources. ` +
        'Refusing to report clean on an empty scan.',
    );
    return 1;
  }

  const byFile = new Map<string, OrphanedDocstring[]>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    const found = findOrphanedDocstrings(readFileSync(file, 'utf-8'), rel);
    if (found.length > 0) byFile.set(rel, found);
  }

  const known: OrphanedDocstring[] = [];
  const failures: OrphanedDocstring[] = [];
  for (const [rel, found] of byFile) {
    const allowed = KNOWN_ORPHANED_DOCSTRINGS.get(rel) ?? 0;
    // The first `allowed` are the tracked backlog; anything beyond is new.
    known.push(...found.slice(0, allowed));
    failures.push(...found.slice(allowed));
  }

  if (known.length > 0) {
    console.log(`Known, tracked (${known.length}) — not failing the build:`);
    known.forEach((f) => console.log(`  ${f.file}:${f.line}`));
    console.log('');
  }

  if (failures.length > 0) {
    console.error(
      `orphaned-docstring: ${failures.length} doc block(s) detached from their declaration.\n`,
    );
    failures.forEach((f) => console.error(`  ${formatOrphanedDocstring(f)}\n`));
    console.error(
      'A doc block directly above another doc block has no declaration. If you just\n' +
        'inserted a function, you took the block above it away from what it documented.',
    );
    return 1;
  }

  console.log(
    `orphaned-docstring: clean — ${files.length} source(s) scanned, ` +
      `${known.length} known and tracked, 0 new.`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(
    `orphaned-docstring: the check could not run (${error instanceof Error ? error.message : String(error)}).\n` +
      'Failing closed: this is NOT a clean tree, it is an unrun check.',
  );
  process.exit(1);
}
