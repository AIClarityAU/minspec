#!/usr/bin/env -S npx tsx
/**
 * open-blockers.ts — which of an issue's declared blockers are still OPEN (#3326).
 *
 *   printf '%s' "$BODY" | npx tsx scripts/open-blockers.ts <issue> <owner/name>
 *
 * stdin   the issue body.
 * stdout  the number of every OPEN same-repo blocker, one per line (nothing = none open).
 * exit    0 when the answer is known. Non-zero on ANY failure to learn a blocker's state,
 *         with nothing on stdout: "could not tell" must never read as "none open", so the
 *         caller (scripts/dispatch-ready-check.sh) refuses on a non-zero exit (invariant 2).
 *
 * Blockers come from the two places the ranker reads: the body's declarations, parsed by
 * `parseDeclaredBlockers` in scripts/lib/issue-rank.ts (the one parser; there is no second
 * copy here), and GitHub's native `Issue.blockedBy` relation. Cross-repo blockers are not
 * local edges and are ignored, exactly as the ranker ignores them.
 */
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDeclaredBlockers } from './lib/issue-rank';

export interface BlockerDeps {
  /** State of a same-repo issue OR pull request: 'OPEN' | 'CLOSED' (| 'MERGED'). Throws on any failure. */
  issueState(repo: string, n: number): string;
  /** Same-repo numbers in the issue's native blockedBy relation, with their states. Throws on failure. */
  nativeBlockers(repo: string, n: number): { number: number; state: string }[];
}

const WAY_OUT = (n: number): string =>
  `to clear it, edit the issue body to remove or correct the 'Blocked by #${n}' line`;

export function openBlockers(issue: number, repo: string, body: string, deps: BlockerDeps): number[] {
  const open = new Set<number>();
  const declared = parseDeclaredBlockers(body).filter((n) => n !== issue);
  for (const n of declared) {
    let state: string;
    try {
      state = deps.issueState(repo, n).trim().toUpperCase();
    } catch (e) {
      // Still fail closed, but name the blocker: a deleted/transferred one never reads again.
      throw new Error(`blocker #${n} state unreadable (${e instanceof Error ? e.message : String(e)}); ${WAY_OUT(n)}`);
    }
    if (state === 'OPEN') open.add(n);
    else if (state !== 'CLOSED' && state !== 'MERGED') throw new Error(`blocker #${n}: unreadable state '${state}'; ${WAY_OUT(n)}`);
  }
  for (const { number, state } of deps.nativeBlockers(repo, issue)) {
    if (number === issue) continue;
    const s = state.trim().toUpperCase();
    if (s === 'OPEN') open.add(number);
    else if (s !== 'CLOSED' && s !== 'MERGED') throw new Error(`blocker #${number}: unreadable state '${s}'`);
  }
  return [...open].sort((a, b) => a - b);
}

const NATIVE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 100) { totalCount nodes { number state repository { nameWithOwner } } }
    }
  }
}`;

export const ghDeps: BlockerDeps = {
  issueState(repo, n) {
    // The REST issues endpoint answers open|closed for issues AND pull requests; `gh issue
    // view` fails on a PR, which would hold its dependents forever, even once it merges.
    return execFileSync('gh', ['api', `repos/${repo}/issues/${n}`, '--jq', '.state'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  },
  nativeBlockers(repo, n) {
    const [owner, name] = repo.split('/');
    const raw = execFileSync(
      'gh',
      ['api', 'graphql', '-f', `query=${NATIVE_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${n}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const parsed = JSON.parse(raw) as {
      errors?: unknown;
      data?: { repository?: { issue?: { blockedBy?: { totalCount?: number; nodes?: unknown } } } };
    };
    if (parsed.errors) throw new Error(`GraphQL error: ${JSON.stringify(parsed.errors)}`);
    const conn = parsed.data?.repository?.issue?.blockedBy;
    if (!conn || !Array.isArray(conn.nodes)) throw new Error('malformed response: no blockedBy connection');
    if (typeof conn.totalCount === 'number' && conn.totalCount > conn.nodes.length) {
      throw new Error(`blockedBy truncated: ${conn.nodes.length} of ${conn.totalCount}`);
    }
    const out: { number: number; state: string }[] = [];
    for (const node of conn.nodes as { number?: unknown; state?: unknown; repository?: { nameWithOwner?: unknown } }[]) {
      if (typeof node?.number !== 'number' || typeof node.state !== 'string') {
        throw new Error('malformed response: blockedBy node without number/state');
      }
      if (String(node.repository?.nameWithOwner ?? '').toLowerCase() === repo.toLowerCase()) {
        out.push({ number: node.number, state: node.state });
      }
    }
    return out;
  },
};

function main(): void {
  const [issueArg, repo] = process.argv.slice(2);
  const issue = Number(issueArg);
  if (!Number.isInteger(issue) || issue <= 0 || !repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    process.stderr.write('usage: open-blockers.ts <issue> <owner/name> < body\n');
    process.exit(2);
  }
  let body = '';
  try {
    body = fs.readFileSync(0, 'utf8');
    const open = openBlockers(issue, repo, body, ghDeps);
    if (open.length > 0) process.stdout.write(open.join('\n') + '\n');
  } catch (e) {
    process.stderr.write(`open-blockers: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

// Run only when invoked as a script — importing it (the tests) must not read stdin.
if (/open-blockers\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) main();
