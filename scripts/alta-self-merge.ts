#!/usr/bin/env -S npx tsx
/**
 * alta-self-merge.ts — merge a pull request that carries only the founder's own Alt-A
 * (founder decision in36, 2026-10-21), as `minspec-sdd[bot]`, with no human keystroke.
 *
 * The judgement is `judgeApprovalOnly` (`scripts/lib/alta-approval-only.ts`). This file
 * does the impure work around it:
 *   1. reads the PR, its commits and the default branch from the GitHub API;
 *   2. fetches the base tip and `refs/pull/<n>/head` into the local object store (data
 *      only: nothing from the PR is ever executed);
 *   3. runs the judge;
 *   4. with `--merge`, and only on `eligible`: re-reads the base tip, requires every
 *      required status check of the default branch's ruleset to be green on the judged
 *      head, then squash-merges through the merge API with `sha=<judged head>`, so a
 *      push after the judgement makes GitHub refuse the merge rather than land it;
 *   5. posts one audit comment naming the records and the head SHA.
 *
 * Fails closed. An API or git failure yields `needs-founder` with `error: true` and a
 * non-zero exit, so the workflow run goes red and the failure is visible (constitution
 * invariant 2). A decline is a normal outcome and exits 0; the founder merges as before.
 *
 * Usage (the workflow supplies a minted App installation token as GH_TOKEN):
 *   npx tsx scripts/alta-self-merge.ts --repo OWNER/NAME --pr 2998 [--merge]
 *   npx tsx scripts/alta-self-merge.ts --repo OWNER/NAME --head-sha <sha> [--merge]
 *
 * Founder identity: ALTA_FOUNDER_LOGINS and ALTA_FOUNDER_EMAILS (comma separated).
 * Unset means nothing is eligible.
 *
 * STDOUT carries one JSON line per PR judged; diagnostics go to STDERR.
 */

import { execFileSync } from 'node:child_process';

import {
  judgeApprovalOnly,
  parseList,
  type GateConfig,
  type GitBytes,
  type PrCommit,
  type PrFacts,
  type Verdict,
} from './lib/alta-approval-only';

export type Gh = (args: readonly string[]) => string;

export type Outcome =
  | { readonly pr: number; readonly decision: 'merged'; readonly headSha: string; readonly records: readonly string[] }
  | { readonly pr: number; readonly decision: 'eligible'; readonly headSha: string; readonly records: readonly string[] }
  | { readonly pr: number; readonly decision: 'waiting'; readonly reason: string }
  | { readonly pr: number; readonly decision: 'needs-founder'; readonly reason: string; readonly error: boolean };

export interface RunDeps {
  readonly gh: Gh;
  readonly git: GitBytes;
  readonly cfg: GateConfig;
  readonly merge: boolean;
  readonly token: string | undefined;
}

const defaultGh: Gh = (args) =>
  execFileSync('gh', args as string[], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

export const defaultGit =
  (cwd: string): GitBytes =>
  (args) =>
    execFileSync('git', args as string[], { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

const ghJson = (gh: Gh, args: readonly string[]): unknown => JSON.parse(gh(['api', ...args]));

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what} is not a string`);
  return v;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} is not an object`);
  return v as Record<string, unknown>;
}

/** Flatten `gh api --paginate --slurp` output (an array of pages). */
function pages(v: unknown, what: string, key?: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${what}: paginated response is not an array of pages`);
  const out: unknown[] = [];
  for (const page of v) {
    const items = key ? obj(page, what)[key] : page;
    if (!Array.isArray(items)) throw new Error(`${what}: page is not an array`);
    out.push(...items);
  }
  return out;
}

/** Read everything the judge needs about one PR from the API. Throws on any unexpected shape. */
export function readPrFacts(gh: Gh, repo: string, pr: number): PrFacts & { readonly title: string } {
  const p = obj(ghJson(gh, [`repos/${repo}/pulls/${pr}`]), 'pull');
  const r = obj(ghJson(gh, [`repos/${repo}`]), 'repo');
  const base = obj(p.base, 'pull.base');
  const head = obj(p.head, 'pull.head');
  const headRepo = head.repo == null ? null : str(obj(head.repo, 'pull.head.repo').full_name, 'head repo name');
  const labels = Array.isArray(p.labels) ? p.labels.map((l) => str(obj(l, 'label').name, 'label name')) : null;
  if (!labels) throw new Error('pull.labels is not an array');
  if (typeof p.commits !== 'number') throw new Error('pull.commits is not a number');
  const commits: PrCommit[] = pages(
    ghJson(gh, ['--paginate', '--slurp', `repos/${repo}/pulls/${pr}/commits?per_page=100`]),
    'commits',
  ).map((c) => {
    const o = obj(c, 'commit');
    const parents = o.parents;
    if (!Array.isArray(parents)) throw new Error('commit.parents is not an array');
    const author = o.author == null ? null : obj(o.author, 'commit.author').login;
    return {
      sha: str(o.sha, 'commit.sha'),
      parentCount: parents.length,
      authorLogin: typeof author === 'string' ? author : null,
    };
  });
  return {
    number: pr,
    title: str(p.title, 'pull.title'),
    state: str(p.state, 'pull.state'),
    draft: p.draft === true,
    merged: p.merged === true,
    baseRef: str(base.ref, 'pull.base.ref'),
    defaultBranch: str(r.default_branch, 'repo.default_branch'),
    baseRepo: str(obj(base.repo, 'pull.base.repo').full_name, 'base repo name'),
    headRepo,
    authorLogin: str(obj(p.user, 'pull.user').login, 'pull.user.login'),
    headSha: str(head.sha, 'pull.head.sha'),
    labels,
    commitCount: p.commits,
    commits,
  };
}

export interface RequiredCheck {
  readonly context: string;
  readonly integrationId?: number;
}

/** The required status checks the ruleset applies to `branch`. Empty or unreadable throws. */
export function readRequiredChecks(gh: Gh, repo: string, branch: string): RequiredCheck[] {
  const rules = ghJson(gh, [`repos/${repo}/rules/branches/${branch}`]);
  if (!Array.isArray(rules)) throw new Error('branch rules are not an array');
  const out: RequiredCheck[] = [];
  for (const rule of rules) {
    const o = obj(rule, 'rule');
    if (o.type !== 'required_status_checks') continue;
    const checks = obj(o.parameters, 'rule.parameters').required_status_checks;
    if (!Array.isArray(checks)) throw new Error('required_status_checks is not an array');
    for (const c of checks) {
      const co = obj(c, 'required check');
      out.push({
        context: str(co.context, 'required check context'),
        ...(typeof co.integration_id === 'number' ? { integrationId: co.integration_id } : {}),
      });
    }
  }
  if (out.length === 0) throw new Error('no required status checks found; cannot prove the PR is green');
  return out;
}

/**
 * The required checks NOT green on `sha`. A check-run counts when completed with
 * `success` (from the required App when the ruleset names one, newest run wins); a commit
 * status counts when its latest state is `success`.
 */
export function failingRequiredChecks(gh: Gh, repo: string, sha: string, required: readonly RequiredCheck[]): string[] {
  const runs = pages(
    ghJson(gh, ['--paginate', '--slurp', `repos/${repo}/commits/${sha}/check-runs?per_page=100`]),
    'check-runs',
    'check_runs',
  ).map((x) => obj(x, 'check-run'));
  const statuses = pages(
    ghJson(gh, ['--paginate', '--slurp', `repos/${repo}/commits/${sha}/statuses?per_page=100`]),
    'statuses',
  ).map((x) => obj(x, 'status'));
  const failing: string[] = [];
  for (const req of required) {
    const matching = runs
      .filter((r) => r.name === req.context)
      .filter((r) => req.integrationId === undefined || (r.app != null && obj(r.app, 'check-run.app').id === req.integrationId))
      .sort((a, b) => Number(b.id) - Number(a.id));
    const newestRun = matching[0];
    const runOk = newestRun !== undefined && newestRun.status === 'completed' && newestRun.conclusion === 'success';
    // The statuses listing is newest-first per GitHub's API; the first entry for a context is its current state.
    const newestStatus = statuses.find((s) => s.context === req.context);
    const statusOk = newestStatus !== undefined && newestStatus.state === 'success';
    if (!runOk && !statusOk) failing.push(req.context);
  }
  return failing;
}

/** Judge one PR and, with `merge`, merge it. Never throws. */
export function runOne(repo: string, pr: number, deps: RunDeps): Outcome {
  let facts: ReturnType<typeof readPrFacts>;
  let baseSha: string;
  try {
    facts = readPrFacts(deps.gh, repo, pr);
    if (!/^[A-Za-z0-9._/-]+$/.test(facts.defaultBranch) || facts.defaultBranch.startsWith('-')) {
      throw new Error('default branch name has an unexpected shape');
    }
    deps.git([
      'fetch',
      '--no-tags',
      '--quiet',
      'origin',
      `+refs/heads/${facts.defaultBranch}:refs/alta/base`,
      `+refs/pull/${pr}/head:refs/alta/head/${pr}`,
    ]);
    baseSha = deps.git(['rev-parse', '--verify', 'refs/alta/base^{commit}']).toString('utf-8').trim();
  } catch (e) {
    return { pr, decision: 'needs-founder', reason: `error: ${(e as Error).message}`, error: true };
  }

  const verdict: Verdict = judgeApprovalOnly(facts, baseSha, deps.cfg, deps.git);
  if (verdict.decision !== 'eligible') {
    // The judge turns its own failures into an `error:` verdict; surface those as errors.
    return { pr, decision: 'needs-founder', reason: verdict.reason, error: verdict.reason.startsWith('error:') };
  }
  if (!deps.merge) return { pr, decision: 'eligible', headSha: verdict.headSha, records: verdict.records };

  try {
    if (!deps.token) throw new Error('GH_TOKEN is empty; refusing to write under an ambient identity');
    const required = readRequiredChecks(deps.gh, repo, facts.defaultBranch);
    const failing = failingRequiredChecks(deps.gh, repo, verdict.headSha, required);
    if (failing.length > 0) return { pr, decision: 'waiting', reason: `required checks not green: ${failing.join(', ')}` };
    const tip = obj(ghJson(deps.gh, [`repos/${repo}/git/ref/heads/${facts.defaultBranch}`]), 'ref');
    if (str(obj(tip.object, 'ref.object').sha, 'ref.object.sha') !== verdict.baseSha) {
      return { pr, decision: 'waiting', reason: 'base branch moved since the judgement' };
    }
    deps.gh([
      'api',
      '-X',
      'PUT',
      `repos/${repo}/pulls/${pr}/merge`,
      '-f',
      `sha=${verdict.headSha}`,
      '-f',
      'merge_method=squash',
      '-f',
      `commit_title=${facts.title} (#${pr})`,
    ]);
  } catch (e) {
    return { pr, decision: 'needs-founder', reason: `error: ${(e as Error).message}`, error: true };
  }

  try {
    const body = [
      '## Merged as an approval-only pull request',
      '',
      `This pull request carried only the founder's own approval, so \`minspec-sdd[bot]\` merged it with no second keystroke (founder decision in36, 2026-10-21; check: \`scripts/alta-self-merge.ts\`).`,
      '',
      `- Head merged: \`${verdict.headSha}\` (bound with \`sha=\`, so no later push could land)`,
      `- Base judged against: \`${verdict.baseSha}\``,
      `- Approval records: ${verdict.records.map((r) => `\`${r}\``).join(', ')}`,
    ].join('\n');
    deps.gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '-f', `body=${body}`]);
  } catch (e) {
    process.stderr.write(`alta-self-merge: PR #${pr} merged, but the audit comment failed: ${(e as Error).message}\n`);
    return { pr, decision: 'needs-founder', reason: 'merged; audit comment failed', error: true };
  }
  return { pr, decision: 'merged', headSha: verdict.headSha, records: verdict.records };
}

/** Open PRs whose current head is `sha`. */
export function prsForHead(gh: Gh, repo: string, sha: string): number[] {
  const list = ghJson(gh, [`repos/${repo}/commits/${sha}/pulls`]);
  if (!Array.isArray(list)) throw new Error('commit pulls listing is not an array');
  return list
    .map((x) => obj(x, 'pull'))
    .filter((p) => p.state === 'open' && obj(p.head, 'pull.head').sha === sha)
    .map((p) => {
      if (typeof p.number !== 'number') throw new Error('pull.number is not a number');
      return p.number;
    });
}

export function parseArgs(argv: readonly string[]): { repo: string; prs: number[]; headSha?: string; merge: boolean } {
  let repo = '';
  const prs: number[] = [];
  let headSha: string | undefined;
  let merge = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i] ?? '';
    else if (a === '--pr') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--pr needs a positive integer`);
      prs.push(n);
    } else if (a === '--head-sha') headSha = argv[++i];
    else if (a === '--merge') merge = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error('--repo OWNER/NAME is required');
  if (headSha !== undefined && !/^[0-9a-f]{40}$/.test(headSha)) throw new Error('--head-sha needs a 40-hex SHA');
  if (prs.length === 0 && headSha === undefined) throw new Error('--pr or --head-sha is required');
  return { repo, prs, headSha, merge };
}

export function main(argv: readonly string[], env: NodeJS.ProcessEnv, gh: Gh = defaultGh, git: GitBytes = defaultGit(process.cwd())): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`alta-self-merge: ${(e as Error).message}\n`);
    return 2;
  }
  const cfg: GateConfig = {
    founderLogins: parseList(env.ALTA_FOUNDER_LOGINS),
    founderEmails: parseList(env.ALTA_FOUNDER_EMAILS),
  };
  let prs = args.prs;
  if (args.headSha !== undefined) {
    try {
      prs = [...prs, ...prsForHead(gh, args.repo, args.headSha)];
    } catch (e) {
      process.stdout.write(`${JSON.stringify({ headSha: args.headSha, decision: 'needs-founder', reason: `error: ${(e as Error).message}`, error: true })}\n`);
      return 1;
    }
  }
  let failed = false;
  for (const pr of [...new Set(prs)]) {
    const outcome = runOne(args.repo, pr, { gh, git, cfg, merge: args.merge, token: env.GH_TOKEN });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    if (outcome.decision === 'needs-founder' && outcome.error) failed = true;
  }
  return failed ? 1 : 0;
}

const invokedDirectly = /alta-self-merge\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
