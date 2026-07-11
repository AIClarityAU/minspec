#!/usr/bin/env -S npx tsx
/**
 * audit-ruleset-integration-ids.ts — #560 harden: IO layer for the
 * integration-id pin audit.
 *
 * Fetches a branch ruleset's detail plus a sample of recent commits'
 * check-runs via the user's own authenticated `gh`, hands the parsed JSON to
 * the PURE decision core (`auditRequiredCheckPins` in
 * `packages/minspec/src/lib/ruleset-integration-audit.ts`), and prints a
 * report. Exits non-zero iff any pin is an unsatisfiable `mismatch` — the
 * exact #560 bug shape (a required check pinned to an app that never posts
 * it, permanently degrading merges into bypass).
 *
 * Usage:
 *   npx tsx scripts/audit-ruleset-integration-ids.ts \
 *     --owner <org> --repo <repo> --ruleset-id <id> \
 *     [--ref <branch>] [--sample-size <n>]
 *
 * `--ref` defaults to the repo's default branch (resolved via `gh api
 * repos/{owner}/{repo}`); `--sample-size` (default 10) is how many of its
 * most recent commits to sample for check-runs. Read-only throughout — this
 * only ever GETs the repo's own ruleset/commit/check-run data, never mutates
 * anything (same network-boundary class as the autonomous probes in
 * `ruleset-advisor.ts`).
 */

import { execFile } from 'node:child_process';

import {
  auditRequiredCheckPins,
  extractObservedCheckRuns,
  extractRequiredCheckPins,
  hasIntegrationIdMismatch,
  type PinAuditFinding,
} from '../packages/minspec/src/lib/ruleset-integration-audit';

interface Args {
  owner: string;
  repo: string;
  rulesetId: string;
  ref?: string;
  sampleSize: number;
}

export function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith('--')) continue;
    out[key.slice(2)] = val ?? '';
  }
  const sampleSize = Number.parseInt(out['sample-size'] ?? '', 10);
  return {
    owner: out.owner ?? '',
    repo: out.repo ?? '',
    rulesetId: out['ruleset-id'] ?? '',
    ref: out.ref || undefined,
    sampleSize: Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : 10,
  };
}

function log(msg: string): void {
  process.stderr.write(`audit-ruleset-integration-ids: ${msg}\n`);
}

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`gh ${args.join(' ')} failed: ${err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const raw = await gh(['api', `repos/${owner}/${repo}`]);
  const parsed = JSON.parse(raw) as { default_branch?: unknown };
  if (typeof parsed.default_branch !== 'string' || parsed.default_branch.trim() === '') {
    throw new Error(`repos/${owner}/${repo} did not report a default_branch`);
  }
  return parsed.default_branch;
}

async function fetchRecentShas(owner: string, repo: string, ref: string, count: number): Promise<string[]> {
  const raw = await gh(['api', `repos/${owner}/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=${count}`]);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c) => (typeof c === 'object' && c !== null ? (c as { sha?: unknown }).sha : undefined))
    .filter((sha): sha is string => typeof sha === 'string');
}

function renderReport(findings: PinAuditFinding[]): string {
  const lines: string[] = [];
  for (const f of findings) {
    const marker =
      f.status === 'mismatch' ? '✗' : f.status === 'ok' ? '✓' : f.status === 'unobserved' ? '?' : '·';
    lines.push(`${marker} [${f.status}] ${f.detail}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner || !args.repo || !args.rulesetId) {
    log('usage: --owner <org> --repo <repo> --ruleset-id <id> [--ref <branch>] [--sample-size <n>]');
    process.exitCode = 2;
    return;
  }

  const rulesetRaw = await gh(['api', `repos/${args.owner}/${args.repo}/rulesets/${args.rulesetId}`]);
  const rulesetDetail = JSON.parse(rulesetRaw) as unknown;
  const pins = extractRequiredCheckPins(rulesetDetail);
  if (pins.length === 0) {
    log('ruleset has no required_status_checks rule (or none parsed) — nothing to audit.');
    return;
  }

  const ref = args.ref ?? (await resolveDefaultBranch(args.owner, args.repo));
  const shas = await fetchRecentShas(args.owner, args.repo, ref, args.sampleSize);
  if (shas.length === 0) {
    log(`no commits found on '${ref}' — cannot sample check-runs.`);
  }

  const checkRunsResponses: unknown[] = [];
  for (const sha of shas) {
    try {
      const raw = await gh(['api', `repos/${args.owner}/${args.repo}/commits/${sha}/check-runs`]);
      checkRunsResponses.push(JSON.parse(raw) as unknown);
    } catch (e) {
      log(`could not fetch check-runs for ${sha}: ${(e as Error).message}`);
    }
  }

  const observed = extractObservedCheckRuns(checkRunsResponses);
  const findings = auditRequiredCheckPins(pins, observed);

  process.stdout.write(renderReport(findings) + '\n');

  if (hasIntegrationIdMismatch(findings)) {
    log('one or more required-check pins are unsatisfiable (#560 bug shape) — see ✗ findings above.');
    process.exitCode = 1;
  }
}

// Run main() ONLY when invoked directly as a script — guarded so importing
// this module for tests does not execute the CLI (same convention as
// auto-merge-gate.ts). Belt-and-suspenders: never run under vitest.
const invokedDirectly = /audit-ruleset-integration-ids\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly && !process.env.VITEST) {
  main().catch((e) => {
    log(`FATAL: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
