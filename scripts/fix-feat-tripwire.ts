#!/usr/bin/env -S npx tsx
/**
 * fix-feat-tripwire.ts — #691 monthly fix:feat tripwire.
 *
 * Runs `git log` on the given repo, hands the raw output to the PURE decision
 * core (`packages/minspec/src/lib/fix-feat-tripwire.ts`), and prints a
 * per-month report: fix:feat by commit count, and fix:feat by src line churn
 * split product (packages/) vs machinery (.github/, scripts/) vs sites
 * (sites/). Exits non-zero when the tripwire fires — a single month at/above
 * the count-ratio ceiling, or a sustained multi-month rise — so this can gate
 * a CI job once wired into one (wiring `.github/workflows/` is out of this
 * script's scope — see the dev-role file allowlist).
 *
 * Usage:
 *   npx tsx scripts/fix-feat-tripwire.ts [--since <git-date-expr>] [--json]
 *     [--sustained-months <n>] [--count-ratio-ceiling <n>] [--cwd <path>]
 *
 * `--since` is passed straight through to `git log --since` (e.g. "6 months
 * ago", "2026-01-01"); omitted means "the whole history". Read-only — never
 * mutates the repo.
 */

import { execFile } from 'node:child_process';

import {
  aggregateByMonth,
  buildGitLogArgs,
  evaluateTripwire,
  parseGitLog,
  DEFAULT_TRIPWIRE_CONFIG,
  type MonthStats,
  type TripwireAlert,
  type TripwireConfig,
} from '../packages/minspec/src/lib/fix-feat-tripwire';

interface Args {
  since?: string;
  json: boolean;
  sustainedMonths: number;
  countRatioCeiling: number;
  cwd: string;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    since: undefined,
    json: false,
    sustainedMonths: DEFAULT_TRIPWIRE_CONFIG.sustainedMonths,
    countRatioCeiling: DEFAULT_TRIPWIRE_CONFIG.countRatioCeiling,
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--since') out.since = argv[++i];
    else if (arg === '--json') out.json = true;
    else if (arg === '--sustained-months') {
      const n = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(n) && n > 0) out.sustainedMonths = n;
    } else if (arg === '--count-ratio-ceiling') {
      const n = Number.parseFloat(argv[++i] ?? '');
      if (Number.isFinite(n) && n > 0) out.countRatioCeiling = n;
    } else if (arg === '--cwd') {
      out.cwd = argv[++i] ?? out.cwd;
    }
  }
  return out;
}

function log(msg: string): void {
  process.stderr.write(`fix-feat-tripwire: ${msg}\n`);
}

function gitLog(cwd: string, since?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      buildGitLogArgs(since),
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`git log failed: ${err.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function fmtRatio(r: number | null): string {
  return r === null ? '—' : r.toFixed(2);
}

function renderReport(monthStats: MonthStats[], alerts: TripwireAlert[]): string {
  const lines: string[] = [];
  lines.push(
    'month     fix  feat  count-ratio  product-churn  machinery-churn  sites-churn',
  );
  for (const m of monthStats) {
    lines.push(
      `${m.month}  ${String(m.fixCount).padStart(3)}  ${String(m.featCount).padStart(4)}  ` +
        `${fmtRatio(m.countRatio).padStart(11)}  ${fmtRatio(m.churnByArea.product.ratio).padStart(14)}  ` +
        `${fmtRatio(m.churnByArea.machinery.ratio).padStart(15)}  ${fmtRatio(m.churnByArea.sites.ratio).padStart(11)}`,
    );
  }
  if (alerts.length > 0) {
    lines.push('');
    lines.push('ALERTS:');
    for (const a of alerts) lines.push(`  ✗ [${a.month}] ${a.reason}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = await gitLog(args.cwd, args.since);
  const commits = parseGitLog(raw);
  const monthStats = aggregateByMonth(commits);
  const config: TripwireConfig = {
    sustainedMonths: args.sustainedMonths,
    countRatioCeiling: args.countRatioCeiling,
  };
  const alerts = evaluateTripwire(monthStats, config);

  if (args.json) {
    process.stdout.write(JSON.stringify({ monthStats, alerts }, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport(monthStats, alerts) + '\n');
  }

  if (alerts.length > 0) {
    log(`${alerts.length} alert(s) fired — sustained rise or ceiling breach, see ALERTS above.`);
    process.exitCode = 1;
  }
}

// Run main() ONLY when invoked directly as a script — guarded so importing
// this module for tests does not execute the CLI (same convention as
// audit-ruleset-integration-ids.ts).
const invokedDirectly = /fix-feat-tripwire\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly && !process.env.VITEST) {
  main().catch((e) => {
    log(`FATAL: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
