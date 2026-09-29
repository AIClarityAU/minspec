#!/usr/bin/env -S npx tsx
/**
 * rank-issues.ts — order dispatchable issues by what they unblock, then spec, then
 * tier, then number (#2196). The thin IO shell over the pure scripts/lib/issue-rank.ts.
 *
 *   printf '%s\n' 2011 2012 2013 | npx tsx scripts/rank-issues.ts [--repo owner/name] [--explain]
 *
 * stdin   candidate issue numbers, one per line (blank lines ignored, duplicates merged).
 * stdout  the SAME set, reordered, one per line — or, with --explain, a table giving
 *         each candidate's value on every term plus the count of spec-less candidates.
 * exit    0 on success; non-zero on ANY failure, with NOTHING on stdout. A partial list
 *         with exit 0 is the one outcome a caller cannot detect, because a shorter
 *         queue reads exactly like a smaller backlog.
 *
 * What it reads:
 *   - every OPEN issue (number, title, body, labels, and GitHub's native
 *     Issue.blockedBy relation) in ONE paged GraphQL query — the whole open set, not
 *     just the candidates, because "what does #N unblock" is answered by the bodies of
 *     the issues that wait on it. ~9 pages / ~12s for ~880 open issues (2026-09-28).
 *   - the signpost's structural order from the workspace (`--root`, default: this
 *     script's repo) via the signpost's own fs adapter, buildArtifactGraph.
 *
 * The drain (scripts/drain-inbox.sh, run_cycle Step 2) pipes its ready set through
 * this and falls back to numeric order, loudly, on any non-zero exit. A human can run
 * it standalone to answer "what should I dispatch next, and why":
 *
 *   gh issue list --label agent-ready --json number --jq '.[].number' \
 *     | npx tsx scripts/rank-issues.ts --explain
 *
 * It calls the `gh` BINARY, so it needs a credential in the environment (the drain
 * exports GH_TOKEN before its reads). In this container, mint one first:
 *   export GH_TOKEN="$(~/.claude/scripts/gh-app-token.sh)"
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  rankIssues,
  blockingGraph,
  structuralOrder,
  type IssueRecord,
  type RankedIssue,
  type StructuralOrder,
} from './lib/issue-rank';
import { buildArtifactGraph } from '../packages/minspec/src/lib/artifact-graph';
import { listEpics } from '../packages/minspec/src/lib/epic-manager';

// ─── Contract for the injected IO ────────────────────────────────────────────

export interface OpenIssueFetch {
  issues: IssueRecord[];
  /** What the repo reports as open, to compare against what came back. */
  totalCount: number;
  /** Anything truncated or inconsistent, for stderr. Never swallowed. */
  notes: string[];
}

export interface CliDeps {
  readStdin(): string;
  /** Throws on any failure. */
  fetchOpenIssues(repo: string): OpenIssueFetch;
  /** Throws on any failure, including an empty order. */
  loadStructuralOrder(root: string): StructuralOrder;
  out(s: string): void;
  err(s: string): void;
}

// ─── The GraphQL fetch ───────────────────────────────────────────────────────

const PAGE = 100;
const NESTED = 100;

export const OPEN_ISSUES_QUERY = `query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: ${PAGE}, after: $endCursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        body
        labels(first: ${NESTED}) { totalCount nodes { name } }
        blockedBy(first: ${NESTED}) { totalCount nodes { number repository { nameWithOwner } } }
      }
    }
  }
}`;

function fail(msg: string): never {
  throw new Error(msg);
}

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(`malformed response: ${what} is not an object`);
  return v as Record<string, unknown>;
}

function asArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) fail(`malformed response: ${what} is not an array`);
  return v;
}

function asIssueNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) fail(`malformed response: ${what} is not an issue number`);
  return v;
}

/** A `{ totalCount, nodes }` connection; notes a truncation rather than hiding it. */
function connection<T>(
  v: unknown,
  what: string,
  pick: (node: unknown, i: number) => T,
  notes: string[],
): T[] {
  const c = asObject(v, what);
  const nodes = asArray(c.nodes, `${what}.nodes`).map(pick);
  const total = c.totalCount;
  if (typeof total === 'number' && total > nodes.length) {
    notes.push(`${what}: fetched ${nodes.length} of ${total} — the rest are not seen by the ranker`);
  }
  return nodes;
}

/**
 * Parse `gh api graphql --paginate --slurp` output (a JSON array, one element per
 * page) into issue records. Throws on anything malformed or on a GraphQL error — a
 * half-understood response must not become a confidently wrong ranking.
 *
 * `repo` is the repository that was queried. GitHub's blocked-by relation can point
 * at an issue in ANOTHER repository, and an issue number means nothing without its
 * repository: sealbox#55 is not minspec#55. So a native blocker from elsewhere is
 * noted and dropped, never turned into an edge from the local issue that happens to
 * share its number — the same rule the body grammar applies to `owner/repo#N`.
 */
export function parseIssuePages(raw: string, repo: string): OpenIssueFetch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`response is not JSON: ${(e as Error).message}`);
  }
  const pages = asArray(parsed, 'the paged response');
  if (pages.length === 0) fail('the paged response has no pages');

  const notes: string[] = [];
  const byNumber = new Map<number, IssueRecord>();
  let totalCount = 0;
  pages.forEach((p, pi) => {
    const page = asObject(p, `page ${pi}`);
    if (Array.isArray(page.errors) && page.errors.length > 0) {
      const msgs = page.errors.map((e) => String((e as { message?: unknown })?.message ?? JSON.stringify(e)));
      fail(`GraphQL error: ${msgs.join('; ')}`);
    }
    const data = asObject(page.data, `page ${pi} data`);
    const repository = asObject(data.repository, `page ${pi} repository`);
    const issues = asObject(repository.issues, `page ${pi} issues`);
    if (typeof issues.totalCount === 'number') totalCount = issues.totalCount;
    for (const [ni, n] of asArray(issues.nodes, `page ${pi} nodes`).entries()) {
      const node = asObject(n, `page ${pi} node ${ni}`);
      const number = asIssueNumber(node.number, `page ${pi} node ${ni}.number`);
      if (typeof node.title !== 'string') fail(`malformed response: #${number} title is not a string`);
      if (node.body !== null && node.body !== undefined && typeof node.body !== 'string') {
        fail(`malformed response: #${number} body is not a string`);
      }
      const labels = connection(node.labels, `#${number} labels`, (l, i) => {
        const name = asObject(l, `#${number} label ${i}`).name;
        if (typeof name !== 'string') fail(`malformed response: #${number} label ${i} has no name`);
        return name;
      }, notes);
      const blockedBy: number[] = [];
      const foreign: string[] = [];
      const blockers = connection(
        node.blockedBy,
        `#${number} blockedBy`,
        (b, i) => {
          const o = asObject(b, `#${number} blockedBy ${i}`);
          const owner = asObject(o.repository, `#${number} blockedBy ${i}.repository`).nameWithOwner;
          if (typeof owner !== 'string') fail(`malformed response: #${number} blockedBy ${i} has no repository`);
          return { n: asIssueNumber(o.number, `#${number} blockedBy ${i}`), owner };
        },
        notes,
      );
      for (const { n, owner } of blockers) {
        if (owner.toLowerCase() === repo.toLowerCase()) blockedBy.push(n);
        else foreign.push(`${owner}#${n}`);
      }
      if (foreign.length > 0) {
        notes.push(`#${number} blockedBy: ${foreign.join(', ')} — in another repository, not a local edge`);
      }
      // A page boundary that shifts while paging can repeat an issue; keep the first.
      if (!byNumber.has(number)) {
        byNumber.set(number, { number, title: node.title, body: (node.body as string | null) ?? '', labels, blockedBy });
      }
    }
  });
  return { issues: [...byNumber.values()], totalCount, notes };
}

function ghFetchOpenIssues(repo: string): OpenIssueFetch {
  const [owner, name] = repo.split('/');
  let raw: string;
  try {
    raw = execFileSync(
      'gh',
      ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${OPEN_ISSUES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`],
      // stderr is inherited, never discarded: gh's own message is how a failure is diagnosed.
      { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    );
  } catch (e) {
    const x = e as { status?: number | null; signal?: string | null; code?: string };
    const how = x.code === 'ENOENT' ? 'gh not found on PATH' : x.status != null ? `exit ${x.status}` : `signal ${x.signal}`;
    fail(`gh api graphql failed (${how}) — gh's own error, if any, is above`);
  }
  return parseIssuePages(raw, repo);
}

// ─── The structural order ────────────────────────────────────────────────────

/**
 * The structural order of the workspace at `root`. Exported so the tests can pin, on a
 * real workspace, that no spec status reaches it (INV-3): the pure `structuralOrder`
 * is status-blind by type, but this is where a filter on status would go.
 */
export function loadOrder(root: string): StructuralOrder {
  // The signpost's own fs adapter — the same reader the Next Task command uses — so the
  // epic `order:` and spec membership come from one parser. It DEGRADES to an empty
  // graph on a misconfigured root (INV-DEGRADE there), which here would silently turn
  // term 2 off for every candidate; so an empty result is a failure, not a ranking.
  const graph = buildArtifactGraph(root);
  if (graph.specs.length === 0) {
    fail(`no specs found under ${root} — refusing to rank without the spec term`);
  }
  const slugs = new Map(listEpics(root).map((e) => [e.id, e.slug]));
  return structuralOrder(graph, slugs);
}

// ─── Output ──────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** The --explain table. Pure: the ranked list plus the facts it was computed from. */
export function renderExplain(
  ranked: readonly RankedIssue[],
  meta: { fetched: number; totalOpen: number; edgeCount: number; fromBody: number; fromNative: number; orderSize: number },
): string {
  const lines: string[] = [];
  lines.push(
    `Ranked ${ranked.length} candidate(s): unblocks (desc), then spec/epic structural rank, then tier, then issue number.`,
  );
  lines.push(
    `Graph: ${meta.edgeCount} declared blocking edge(s) among the open issues ` +
      `(${meta.fromBody} from body declarations, ${meta.fromNative} from GitHub-native relations; ` +
      `${meta.fetched} of ${meta.totalOpen} reported open were fetched). ` +
      `Structural order: ${meta.orderSize} slot(s).`,
  );
  lines.push('');
  const header = ['rank', 'issue', 'unblocks', 'spec / epic', 'tier'];
  const rows = ranked.map((r, i) => [
    String(i + 1),
    `#${r.number}`,
    r.reasons.unblocks,
    r.reasons.spec,
    r.reasons.tier,
  ]);
  const widths = header.map((h, c) => Math.min(60, Math.max(h.length, ...rows.map((row) => row[c].length))));
  lines.push(header.map((h, c) => pad(h, widths[c])).join('  ').trimEnd());
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) lines.push(row.map((cell, c) => pad(cell, widths[c])).join('  ').trimEnd());
  lines.push('');
  const specless = ranked.filter((r) => r.specRank === null).length;
  lines.push(
    `${specless} of ${ranked.length} candidate(s) serve no spec or epic (no SPEC-NNN in the title's scope or head, ` +
      'no epic: label, or one not in the structural order) — they sort after linked issues on the spec term.',
  );
  const noData = ranked.filter((r) => !r.hasData).length;
  if (noData > 0) {
    lines.push(
      `${noData} of ${ranked.length} candidate(s) are not in the fetched open issues ` +
        '(closed since the queue read, or not returned) — ranked with no data, never dropped.',
    );
  }
  return lines.join('\n') + '\n';
}

// ─── The CLI ─────────────────────────────────────────────────────────────────

const DEFAULT_REPO = 'AIClarityAU/minspec';

interface Args {
  repo: string;
  root: string;
  explain: boolean;
}

function parseArgs(argv: readonly string[], defaultRoot: string): Args {
  const args: Args = { repo: DEFAULT_REPO, root: defaultRoot, explain: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--explain') args.explain = true;
    else if (a === '--repo' || a === '--root') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
      if (a === '--repo') {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v)) fail(`--repo must be owner/name, got '${v}'`);
        args.repo = v;
      } else {
        args.root = path.resolve(v);
      }
      i++;
    } else fail(`unknown argument '${a}' (usage: rank-issues.ts [--repo owner/name] [--root dir] [--explain])`);
  }
  return args;
}

/** Candidate numbers from stdin. Refuses — never drops — a line that is not one. */
function parseCandidates(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!/^\d{1,9}$/.test(line) || Number(line) <= 0) fail(`not an issue number on stdin: '${line}'`);
    const n = Number(line);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Run the CLI. Returns the exit code. Output is written ONCE, after everything has
 * succeeded, so a failure part-way can never leave a partial list on stdout.
 */
export function runCli(argv: readonly string[], deps: CliDeps, defaultRoot = path.resolve(__dirname, '..')): number {
  try {
    const args = parseArgs(argv, defaultRoot);
    const candidates = parseCandidates(deps.readStdin());
    if (candidates.length === 0) return 0;

    let fetched: OpenIssueFetch;
    try {
      fetched = deps.fetchOpenIssues(args.repo);
    } catch (e) {
      fail(`could not fetch open issues for ${args.repo}: ${(e as Error).message}`);
    }
    let order: StructuralOrder;
    try {
      order = deps.loadStructuralOrder(args.root);
    } catch (e) {
      fail(`could not load the structural spec order from ${args.root}: ${(e as Error).message}`);
    }

    for (const note of fetched.notes) deps.err(`rank-issues: NOTE: ${note}\n`);
    if (fetched.issues.length !== fetched.totalCount) {
      deps.err(
        `rank-issues: NOTE: fetched ${fetched.issues.length} of ${fetched.totalCount} open issue(s) — ` +
          'issues opened or closed while paging, or a truncated fetch; blocking counts may be understated.\n',
      );
    }

    const ctx = { open: new Set(fetched.issues.map((i) => i.number)), issues: fetched.issues, order };
    const ranked = rankIssues(candidates, ctx);

    // Defence in depth for the one property the caller depends on: exactly the input set.
    const got = ranked.map((r) => r.number).sort((a, b) => a - b);
    const want = [...candidates].sort((a, b) => a - b);
    if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
      fail(`internal error: ranked set differs from the candidate set (${got.join(',')} vs ${want.join(',')})`);
    }

    if (args.explain) {
      const g = blockingGraph(ctx);
      deps.out(
        renderExplain(ranked, {
          fetched: fetched.issues.length,
          totalOpen: fetched.totalCount,
          edgeCount: g.edgeCount,
          fromBody: g.fromBody,
          fromNative: g.fromNative,
          orderSize: order.size,
        }),
      );
    } else {
      deps.out(ranked.map((r) => `${r.number}\n`).join(''));
    }
    return 0;
  } catch (e) {
    deps.err(`rank-issues: ${(e as Error).message}\n`);
    return 1;
  }
}

function realDeps(): CliDeps {
  return {
    // fd 0, read to EOF. Throws on an unreadable stdin, which runCli turns into exit 1.
    readStdin: () => fs.readFileSync(0, 'utf-8'),
    fetchOpenIssues: ghFetchOpenIssues,
    loadStructuralOrder: loadOrder,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  };
}

// Run only when invoked as a script — importing it (the tests) must not read stdin.
if (/rank-issues\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  process.exitCode = runCli(process.argv.slice(2), realDeps());
}
