#!/usr/bin/env -S npx tsx
/**
 * check-spec-id-collision.ts — advisory per-PR spec-id collision check (#3164), the
 * sibling of check-dr-id-collision.ts.
 *
 *   npx tsx scripts/check-spec-id-collision.ts --repo OWNER/NAME --pr 3153 --base main
 *
 * Exit 0 = every spec id the PR adds is free on the base and across other open PRs.
 * Exit 1 = a clash, OR the check could not look (fail closed, DR-066) — never a green
 * because it didn't run. Decision logic is the pure `lib/spec-id-claims.ts`.
 */

import { openPrSpecClaims, baseSpecDirs, prSpecDirs, SpecIdGateError } from './lib/open-pr-spec-claims';
import { decideSpecIdCollision } from './lib/spec-id-claims';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new SpecIdGateError(`missing required argument --${name}. Usage: check-spec-id-collision.ts --repo OWNER/NAME --pr N --base main`);
}

try {
  const repo = arg('repo');
  const base = arg('base');
  const pr = Number.parseInt(arg('pr'), 10);
  if (!Number.isFinite(pr) || pr <= 0) throw new SpecIdGateError('--pr must be a positive number');
  const specsDir = arg('specs-dir', 'specs').replace(/\/+$/, '');

  const verdict = decideSpecIdCollision({
    baseRef: base,
    baseDirs: baseSpecDirs(repo, base, specsDir),
    subject: { pr, dirs: prSpecDirs(repo, pr, specsDir) },
    otherPrs: openPrSpecClaims(repo, specsDir, pr),
  });
  if (verdict.ok) {
    console.log(verdict.message);
  } else {
    console.error(verdict.message);
    if (process.env.GITHUB_ACTIONS) {
      console.error(
        `::error title=Spec id collision::${verdict.findings.map((f) => f.id).join(', ')} already claimed — renumber to ${verdict.nextFreeId}`,
      );
    }
    process.exitCode = 1;
  }
} catch (e) {
  const why = e instanceof SpecIdGateError ? e.message : `unexpected error: ${(e as Error).message}`;
  console.error(`Spec id collision check FAILED CLOSED — ${why}`);
  process.exit(1);
}
