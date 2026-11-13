#!/usr/bin/env -S npx tsx
/**
 * check-baseline-integrity.ts — surfaces per-machine approval-baseline drift (#435).
 *
 *   npm run check:baseline-integrity [-- <rootDir>]
 *
 * `checkBaselineIntegrity` (#404) counts approval records whose recorded baseline
 * cannot be resolved on THIS machine (the per-machine pin ref never travelled with a
 * plain `git push`, or the blob was gc-pruned — DR-043). This is its caller, so the
 * drift is surfaced, not just surfaceable.
 *
 * WARN-ONLY by design: drift is a per-machine fact, not a defect in the change under
 * review, so it exits 0 and (under GitHub Actions) emits a `::warning::` annotation.
 * It is NOT silent on failure, though: if the check itself cannot run it throws and
 * exits non-zero (invariant 2 — a witness that cannot run is not a witness that
 * passed). Tier-0, offline.
 */
import * as path from 'path';
import { fileURLToPath } from 'node:url';

import { checkBaselineIntegrity, type BaselineIntegrityReport } from '../packages/minspec/src/lib/approval';

/** Human-readable report lines; pure so it can be tested without a repo. */
export function formatBaselineReport(report: BaselineIntegrityReport): string[] {
  const lines = [
    `baseline-integrity: ${report.total} approval record(s) — ` +
      `${report.recovered} recovered, ${report.unrecoverable} unrecoverable, ${report.noBaseline} no baseline`,
  ];
  if (report.unrecoverable > 0) {
    lines.push(
      `WARNING: ${report.unrecoverable} recorded baseline(s) cannot be resolved on this machine ` +
        '(pin ref not fetched, or blob gc-pruned):',
    );
    for (const spec of report.unrecoverableSpecs) lines.push(`  - ${spec}`);
  }
  return lines;
}

/** GitHub Actions annotation for drift, or undefined when there is none. */
export function baselineWarningAnnotation(report: BaselineIntegrityReport): string | undefined {
  if (report.unrecoverable === 0) return undefined;
  return `::warning title=baseline-integrity::${report.unrecoverable} unrecoverable baseline(s): ${report.unrecoverableSpecs.join(', ')}`;
}

function main(): void {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const report = checkBaselineIntegrity(rootDir);
  for (const line of formatBaselineReport(report)) process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const annotation = baselineWarningAnnotation(report);
    if (annotation) process.stdout.write(`${annotation}\n`);
  }
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) main();
