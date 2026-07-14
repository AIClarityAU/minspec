#!/usr/bin/env -S npx tsx
/**
 * direct-push-audit.ts — #688 harden: IO layer for the direct-push-to-`main`
 * audit.
 *
 * Given the before/after SHAs of a `push` event on `main`, walks the commits
 * that landed (`git rev-list before..after`, so it needs full history —
 * `actions/checkout` with `fetch-depth: 0`), classifies each as direct vs
 * PR-merge via `gh api repos/{o}/{r}/commits/{sha}/pulls`, and reads each
 * commit's changed files via `git diff-tree` (no extra API calls needed —
 * the checkout already has the objects). Hands the parsed inputs to the PURE
 * decision core (`auditPushedCommits` in
 * `packages/minspec/src/lib/direct-push-audit.ts`); on any violation, files
 * (or comments on a rolling) a `bug,security`-labeled issue naming the
 * pusher, SHA, and offending files.
 *
 * ADVISORY ONLY — the audited push has already landed by the time this runs;
 * this can only flag a violation loudly, never block it. Fails OPEN: any
 * API/tooling error is logged and swallowed (exit 0), never lets a glitch in
 * this audit itself look like (or cause) a broken build. Kill-switch:
 * `DIRECT_PUSH_AUDIT_OFF=1` skips the audit entirely.
 *
 * Usage (intended for a `push: branches: [main]` GitHub Actions workflow —
 * see #688 for the not-yet-wired workflow; this script is CI-tooling-config-
 * adjacent but lives under scripts/ so it is independently unit-testable):
 *
 *   npx tsx scripts/direct-push-audit.ts \
 *     --owner <org> --repo <repo> --before <sha> --after <sha> \
 *     [--pusher <login>] [--run-url <url>]
 */

import { execFile } from 'node:child_process';

import {
  auditPushedCommits,
  hasDirectPushViolation,
  type PushedCommitInput,
  type DirectPushFinding,
} from '../packages/minspec/src/lib/direct-push-audit';

interface Args {
  owner: string;
  repo: string;
  before: string;
  after: string;
  pusher?: string;
  runUrl?: string;
}

const ROLLING_ISSUE_TITLE = 'security: direct push(es) to `main` touched non-docs paths';

export function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith('--')) continue;
    out[key.slice(2)] = val ?? '';
  }
  return {
    owner: out.owner ?? '',
    repo: out.repo ?? '',
    before: out.before ?? '',
    after: out.after ?? '',
    pusher: out.pusher || undefined,
    runUrl: out['run-url'] || undefined,
  };
}

function log(msg: string): void {
  process.stderr.write(`direct-push-audit: ${msg}\n`);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function gh(args: string[]): Promise<string> {
  return run('gh', args);
}

/** All-zero SHA is git's sentinel for "branch was just created" — nothing to walk. */
function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

async function listPushedShas(before: string, after: string): Promise<string[]> {
  if (isZeroSha(before)) {
    // New branch push: audit only the tip commit, not the whole branch history.
    return [after];
  }
  const raw = await run('git', ['rev-list', '--no-merges', `${before}..${after}`]);
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchChangedFiles(sha: string): Promise<string[]> {
  const raw = await run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchAuthor(sha: string): Promise<string | undefined> {
  try {
    const raw = await run('git', ['show', '-s', '--format=%ae', sha]);
    return raw.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function fetchAssociatedPulls(owner: string, repo: string, sha: string): Promise<unknown> {
  const raw = await gh(['api', `repos/${owner}/${repo}/commits/${sha}/pulls`]);
  return JSON.parse(raw) as unknown;
}

function renderReport(findings: readonly DirectPushFinding[]): string {
  const lines: string[] = [];
  for (const f of findings) {
    if (!f.direct) {
      lines.push(`· [pr-merge] ${f.sha} — exempt (reviewed via PR)`);
      continue;
    }
    if (f.violation) {
      lines.push(`✗ [direct] ${f.sha}${f.author ? ` (${f.author})` : ''} — touched: ${f.offendingFiles.join(', ')}`);
    } else {
      lines.push(`✓ [direct] ${f.sha}${f.author ? ` (${f.author})` : ''} — stayed within docs-only allowlist`);
    }
  }
  return lines.join('\n');
}

function renderIssueBody(
  findings: readonly DirectPushFinding[],
  args: Args,
): string {
  const violations = findings.filter((f) => f.violation);
  const lines: string[] = [];
  lines.push(
    'A direct (non-PR) push to `main` touched file(s) outside the docs-only allowlist ' +
      '(`specs/**`, `docs/decisions/**`, `docs/domain/**`, `docs/epics/**`, ' +
      '`.minspec/approvals/**`, top-level `*.md`).',
  );
  lines.push('');
  lines.push(
    'This push landed via the admin bypass on the `main` ruleset (#575/DR-051) — that bypass ' +
      'is REF-scoped, not PATH-scoped, so it grants pushing anything, not just docs. This is an ' +
      'ADVISORY-ONLY alert: the push has already landed and cannot be blocked retroactively. ' +
      'Verify the change was intentional and reviewed.',
  );
  lines.push('');
  lines.push('## Offending commit(s)');
  lines.push('');
  for (const f of violations) {
    lines.push(`- \`${f.sha}\`${f.author ? ` by ${f.author}` : ''}`);
    for (const file of f.offendingFiles) {
      lines.push(`  - ${file}`);
    }
  }
  if (args.pusher) {
    lines.push('');
    lines.push(`Pusher (from the triggering event): ${args.pusher}`);
  }
  if (args.runUrl) {
    lines.push('');
    lines.push(`Workflow run: ${args.runUrl}`);
  }
  return lines.join('\n');
}

async function findRollingIssue(owner: string, repo: string): Promise<number | undefined> {
  const raw = await gh([
    'issue', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'open',
    '--search', `"${ROLLING_ISSUE_TITLE}" in:title`,
    '--json', 'number,title',
  ]);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return undefined;
  const match = parsed.find(
    (i) => typeof i === 'object' && i !== null && (i as { title?: unknown }).title === ROLLING_ISSUE_TITLE,
  ) as { number?: number } | undefined;
  return typeof match?.number === 'number' ? match.number : undefined;
}

async function fileOrCommentIssue(owner: string, repo: string, body: string): Promise<void> {
  const existing = await findRollingIssue(owner, repo);
  if (existing !== undefined) {
    await gh(['issue', 'comment', String(existing), '--repo', `${owner}/${repo}`, '--body', body]);
    log(`commented on rolling issue #${existing}`);
    return;
  }
  await gh([
    'issue', 'create',
    '--repo', `${owner}/${repo}`,
    '--title', ROLLING_ISSUE_TITLE,
    '--label', 'bug,security',
    '--body', body,
  ]);
  log('filed new rolling issue');
}

async function main(): Promise<void> {
  if (process.env.DIRECT_PUSH_AUDIT_OFF === '1') {
    log('DIRECT_PUSH_AUDIT_OFF=1 — skipping audit.');
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.owner || !args.repo || !args.before || !args.after) {
    log('usage: --owner <org> --repo <repo> --before <sha> --after <sha> [--pusher <login>] [--run-url <url>]');
    process.exitCode = 2;
    return;
  }

  const shas = await listPushedShas(args.before, args.after);
  if (shas.length === 0) {
    log('no new commits on this push (e.g. a fast-forward with nothing new, or a branch deletion) — nothing to audit.');
    return;
  }

  const commits: PushedCommitInput[] = [];
  for (const sha of shas) {
    const [pulls, files, author] = await Promise.all([
      fetchAssociatedPulls(args.owner, args.repo, sha),
      fetchChangedFiles(sha),
      fetchAuthor(sha),
    ]);
    commits.push({ sha, author, pulls, files });
  }

  const findings = auditPushedCommits(commits);
  process.stdout.write(renderReport(findings) + '\n');

  if (hasDirectPushViolation(findings)) {
    log('one or more direct pushes touched non-docs paths — filing alert issue.');
    await fileOrCommentIssue(args.owner, args.repo, renderIssueBody(findings, args));
  }
}

// Run main() ONLY when invoked directly as a script — guarded so importing
// this module for tests does not execute the CLI (same convention as
// audit-ruleset-integration-ids.ts / auto-merge-gate.ts). Fail-open: any
// error anywhere in this audit is logged, not thrown — a bug in the audit
// tooling itself must never look like (or cause) a broken build.
const invokedDirectly = /direct-push-audit\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly && !process.env.VITEST) {
  main().catch((e) => {
    log(`FATAL (fail-open, not failing the run): ${(e as Error).message}`);
  });
}
