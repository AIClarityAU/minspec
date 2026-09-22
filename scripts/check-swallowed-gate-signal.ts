#!/usr/bin/env -S npx tsx
/**
 * check-swallowed-gate-signal.ts — makes DR-066 clause 1 un-landable (#1859).
 *
 * Clause 1 of "no silent gate" says no load-bearing gate signal may be written with a
 * swallowed error. Since 2026-07-22 that has been prose, enforced by whoever happened to
 * notice: six instances fixed by hand, and fifteen more sitting in the tree unremarked
 * when this check was first run. That is the constitution's own "enforce, don't trust
 * the model" case — a rule the model must remember is a rule that drifts.
 *
 *   npx tsx scripts/check-swallowed-gate-signal.ts [--dir scripts]
 *
 * Exit 0 = every swallowed capture that decides something is annotated.
 * Exit 1 = at least one is not, OR the check could not do its job.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 * This check enforces clause 1, so it had better not violate it. An unreadable file, a
 * missing directory, or a scan that walked nothing is a RED, not a green — there is no
 * path here that exits 0 without having actually read scripts. "Green because it didn't
 * run" is the #811 always-green bug, and a lint about silent gates failing silently
 * would be the joke writing itself.
 *
 * ── WHERE THIS IS ENFORCED ───────────────────────────────────────────────────
 * `npm run check:swallowed-gate`, and via `pretest` for anyone running `npm test`
 * locally. NOT via pretest in CI: the test job runs `npx vitest run --coverage`
 * directly, which never fires npm's pretest hook. The merge-blocking enforcement is
 * a T0 test (packages/minspec/tests/swallowed-gate-signal.test.ts) that shells out to
 * this file and fails on a non-zero exit. Wiring a named CI step instead would be
 * more discoverable, but the App installation holds no `workflows` permission by
 * design (host DR-079), so an agent cannot add one.
 *
 * All decision logic lives in the pure, unit-tested lib/swallowed-gate-signal.ts; this
 * file is IO only: walk, read, hand the text over, print, set the exit code.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  findSwallowedGateSignals,
  formatSwallowedSignal,
  unannotated,
  type SwallowedSignal,
} from './lib/swallowed-gate-signal';

/** Anything meaning "this check could not do its job" — always a red. */
class GateError extends Error {}

const ROOT = process.cwd();

const argDir = (): string => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'scripts';
};

/** Every `.sh` under `dir`, recursively. Throws rather than skipping on an IO error. */
function shellScripts(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    throw new GateError(`cannot read directory ${dir}: ${(error as Error).message}`);
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return shellScripts(path);
    return path.endsWith('.sh') ? [path] : [];
  });
}

function main(): number {
  const dir = join(ROOT, argDir());
  const scripts = shellScripts(dir);

  // A scan that found no scripts has not established anything. Treating it as a pass is
  // the exact failure this check exists to forbid.
  if (scripts.length === 0) {
    throw new GateError(`no shell scripts found under ${argDir()} — refusing to report a pass`);
  }

  const findings: SwallowedSignal[] = scripts.flatMap((path) => {
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      throw new GateError(`cannot read ${path}: ${(error as Error).message}`);
    }
    return findSwallowedGateSignals(relative(ROOT, path), source);
  });

  const failures = unannotated(findings);
  const known = findings.filter((f) => f.knownIssue !== undefined);

  if (known.length > 0) {
    // Printed every run, deliberately. Debt that stops being mentioned stops being debt
    // and becomes the shape of the codebase.
    console.log(`Known, tracked (${known.length}) — not failing the build:`);
    known.forEach((f) => console.log(formatSwallowedSignal(f)));
    console.log('');
  }

  if (failures.length > 0) {
    console.error(
      `DR-066 clause 1: ${failures.length} swallowed gate signal(s) with no justification\n`,
    );
    failures.forEach((f) => console.error(`${formatSwallowedSignal(f)}\n`));
    return 1;
  }

  console.log(
    `DR-066 clause 1: clean — ${scripts.length} scripts scanned, ` +
      `${known.length} known and tracked, 0 unannotated.`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(
    error instanceof GateError
      ? `DR-066 clause 1 check could not run: ${error.message}`
      : `DR-066 clause 1 check crashed: ${(error as Error).stack ?? error}`,
  );
  process.exit(1);
}
