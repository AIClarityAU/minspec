/**
 * The post-merge caller for delegated approval (#2981, DR-108).
 *
 * `delegated-approval.ts` decides one approval for one artifact and, with `--write`,
 * writes the sidecar and the lifecycle change. Nothing ran it. This is the caller: it
 * finds the approvables on the base that a merged content pull request left without a
 * current approval record, runs that CLI for each on a branch of its own, commits the
 * result and opens the approval pull request, all as `minspec-sdd[bot]`.
 *
 * WHAT IT NEVER DOES. It never merges anything, never arms auto-merge, never touches
 * `needs-human-review`, and never approves a pull request that is not merged yet (the CLI
 * refuses those: `pr-not-merged`). It runs strictly AFTER a content pull request merged.
 * Whether a covered spec pull request may merge without the founder is a separate
 * decision (#2981) and nothing here depends on it.
 *
 * WHERE THE JUDGEMENT IS. Not here. Whether an approval is covered is decided by
 * `evaluateDelegation` (`autonomy.ts`) and `checkApprovalActor` (`approval-actor.ts`),
 * through the CLI, and judged again by `approval-integrity.ts` on the approval pull
 * request. This file only adds refusals: it pre-checks scope with the same
 * `evaluateDelegation`, so an out-of-scope artifact never reaches GitHub at all, and it
 * checks what the CLI wrote before anything is pushed.
 *
 * FAIL CLOSED. The whole run is refused, before any branch or GitHub write, when any of
 * these cannot be read or does not hold: the repo opted in (`.minspec/`), the repo is
 * not memory-fabric, the clone is full (a shallow clone hides earlier fixes, so the
 * repeat-fix share would read low), the delegation records parse, the repeat-fix share
 * is known and at or under the tripwire, the bot token is non-empty and is an App
 * installation token (never the founder's), and the open pull request list was read in
 * full. Per artifact, any unreadable fact skips that artifact, by name.
 *
 * Out of scope by construction:
 *   - plan artifacts (`design.md`, `tasks.md`, #2980): never a candidate, even with a
 *     stale sidecar;
 *   - governance paths and direction records: refused by `evaluateDelegation`;
 *   - memory-fabric: refused at the run level and again by `evaluateDelegation`.
 *
 * Network: `gh` and `git push` (GitHub). Dev-time tooling in `scripts/`, not shipped
 * (DR-086 §5); MinSpec itself still makes no network call (constitution invariant 1).
 *
 *   npx tsx scripts/lib/delegated-approval-caller.ts [--repo-root <dir>] [--repo owner/name]
 *     [--base origin/main] [--max N] [--worktree-root <dir>] [--write]
 *
 * Without `--write` it is a dry run: it runs the CLI's own checks on a throwaway branch,
 * reports what it would open, and pushes nothing. Prints one JSON report. Exit 0 = the
 * run was admitted (each artifact's outcome is in the report), 1 = the run was refused,
 * 2 = an artifact failed mid-write (the report says which).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { specHash } from '../../packages/shared/src/canonical';
import { isTerminalSpecStatus, type SpecStatus } from '../../packages/minspec/src/lib/spec-vocabulary';
import { BOT_ACTOR, evaluateDelegation, parseDelegations, type Delegation, type Tier } from './autonomy';
import { actForPath, frontmatterField } from './approval-actor';
import { readContentPullRequest } from './content-pr';
import { readRepeatFixShare, utcToday } from './repeat-fix-share';
import { openClarifyDetail, clarifyPhaseDetail } from './clarify-open';

/** The commit identity of `minspec-sdd[bot]` (the App's bot user). */
export const BOT_EMAIL = '299695933+minspec-sdd[bot]@users.noreply.github.com';
/** Every branch this caller creates starts with this, and only this caller uses it. */
export const BRANCH_PREFIX = 'dlg-approve/';
/** The open pull request read must come back under this, or it may be truncated. */
export const OPEN_PR_LIMIT = 500;
const DEFAULT_MAX = 5;
const TOKEN_SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'gh-app-token.sh');

const SPEC_APPROVABLE = /^specs\/.+\/requirements\.md$/;
const DR_APPROVABLE = /^docs\/decisions\/DR-\d+\.md$/;
/** Plan artifacts: never approved by this caller (#2980). */
const PLAN_ARTIFACT = /(^|\/)(design|tasks)\.md$/;
const NEVER_DELEGATED_REPO_NAMES = new Set(['memory-fabric']);
const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];

// ─── the seams ──────────────────────────────────────────────────────────────

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
}

export interface ApproveCall {
  /** Where the CLI script and node_modules are. */
  readonly repoRoot: string;
  /** The recording worktree: the CLI's `--repo-root`, on the recording branch. */
  readonly worktree: string;
  readonly artifact: string;
  readonly pr: number;
  readonly repo: string;
  readonly base: string;
  readonly write: boolean;
  readonly token: string;
}

export interface CallerDeps {
  /** `git -C cwd ...`. Throws on a non-zero exit. */
  readonly git: (cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv) => string;
  /** `gh ...` under exactly this token. Throws on a non-zero exit. */
  readonly gh: (args: readonly string[], token: string) => string;
  /** The bot's installation token, or '' when none could be minted. */
  readonly mintToken: () => string;
  /** One run of `delegated-approval.ts`. Never throws: a crash is a non-zero code. */
  readonly approve: (call: ApproveCall) => CliRun;
  readonly repeatFixShare: (repoRoot: string, base: string) => number | undefined;
  readonly contentPullRequest: (repoRoot: string, base: string, rel: string) => number | undefined;
  readonly today: () => string;
}

export interface CallerOptions {
  readonly repoRoot: string;
  readonly repo: string;
  readonly base: string;
  readonly max: number;
  readonly write: boolean;
  /** Where recording worktrees go. Default: the shared worktrees root for this repo. */
  readonly worktreeRoot?: string;
}

export type Outcome = 'opened' | 'would-open' | 'skipped' | 'denied' | 'error';

export interface ArtifactResult {
  readonly artifact: string;
  readonly pr?: number;
  readonly outcome: Outcome;
  readonly reason: string;
  readonly detail?: string;
  readonly branch?: string;
  readonly url?: string;
}

export interface CallerReport {
  readonly ok: boolean;
  readonly mode: 'write' | 'dry-run';
  /** Set when the whole run was refused. */
  readonly refused?: { readonly reason: string; readonly detail: string };
  /** Approvables whose current content already has an approval record. */
  readonly alreadyApproved: number;
  readonly results: readonly ArtifactResult[];
}

// ─── pure helpers ───────────────────────────────────────────────────────────

/** Spec `requirements.md` or a decision record. Never a plan artifact. */
export function isApprovableCandidatePath(rel: string): boolean {
  if (PLAN_ARTIFACT.test(rel)) return false;
  return SPEC_APPROVABLE.test(rel) || DR_APPROVABLE.test(rel);
}

export const sidecarPathFor = (artifact: string): string => `.minspec/approvals/${artifact}.json`;

/** The id used in the branch and commit: frontmatter `id:`, else the file's stem. */
export function artifactId(rel: string, content: string): string {
  const id = frontmatterField(content, 'id');
  if (id !== undefined && /^[A-Za-z]+-\d+$/.test(id)) return id.toUpperCase();
  const dr = rel.match(/(DR-\d+)\.md$/);
  if (dr) return dr[1];
  return path.basename(path.dirname(rel)).replace(/[^A-Za-z0-9-]/g, '-');
}

/** Deterministic, so a second run finds the first run's branch instead of making another. */
export function branchFor(id: string, hash: string): string {
  return `${BRANCH_PREFIX}${id.toLowerCase()}-${hash.slice(0, 12)}`;
}

/**
 * NUL-separated `git status --porcelain=v1 -z` into paths. The first three bytes of an
 * entry are status and a space, never trimmed (a leading space is a status column).
 * A rename entry carries a second path, which is consumed and counted as changed too.
 */
export function parsePorcelainZ(out: string): string[] {
  const parts = out.split('\0');
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    files.push(e.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') {
      const from = parts[++i];
      if (from) files.push(from);
    }
  }
  return files;
}

interface CliRecord {
  readonly specPath: string;
  readonly specHash: string;
  readonly approvedBy: string;
  readonly actor: string;
  readonly basis: string;
  readonly act: string;
  readonly author: string;
  readonly verdictBy: string;
  readonly tier: string;
}

/**
 * Read the CLI's verdict. Anything but an exit 0 with a well-formed bot record for this
 * artifact is a denial: an unknown verdict is never permission.
 */
export function readCliVerdict(
  run: CliRun,
  artifact: string,
  repo: string,
): { ok: true; record: CliRecord; delegationId: string } | { ok: false; reason: string; detail: string } {
  const last = run.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '').pop() ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return { ok: false, reason: 'cli-output-unreadable', detail: `exit ${run.code}, last line not JSON: ${last.slice(0, 200)}` };
  }
  const p = parsed as { ok?: unknown; reason?: unknown; detail?: unknown; record?: unknown; delegationId?: unknown };
  if (p.ok !== true || run.code !== 0) {
    const reason = typeof p.reason === 'string' ? p.reason : 'unknown';
    return { ok: false, reason: `cli-denied:${reason}`, detail: typeof p.detail === 'string' ? p.detail : `exit ${run.code}` };
  }
  const r = p.record as Record<string, unknown> | undefined;
  const str = (k: string) => (r && typeof r[k] === 'string' ? (r[k] as string) : undefined);
  const fields = ['specPath', 'specHash', 'approvedBy', 'actor', 'basis', 'act', 'author', 'verdictBy', 'tier'];
  if (r === undefined || fields.some((k) => str(k) === undefined) || typeof p.delegationId !== 'string') {
    return { ok: false, reason: 'cli-output-unreadable', detail: 'the approval record is missing fields' };
  }
  const rec = r as unknown as CliRecord;
  if (rec.actor !== BOT_ACTOR || rec.approvedBy !== BOT_ACTOR) {
    return { ok: false, reason: 'record-not-bot', detail: `actor "${rec.actor}", approvedBy "${rec.approvedBy}"` };
  }
  if (rec.specPath !== artifact) {
    return { ok: false, reason: 'record-wrong-artifact', detail: `${rec.specPath} is not ${artifact}` };
  }
  if (!rec.verdictBy.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/`)) {
    return { ok: false, reason: 'record-no-independent-verdict', detail: `verdictBy "${rec.verdictBy}"` };
  }
  if (rec.author.trim() === '' || rec.author.trim().toLowerCase() === rec.verdictBy.trim().toLowerCase()) {
    return { ok: false, reason: 'record-verdict-by-author', detail: `author "${rec.author}"` };
  }
  return { ok: true, record: rec, delegationId: p.delegationId };
}

// ─── the run ────────────────────────────────────────────────────────────────

interface Candidate {
  readonly artifact: string;
  readonly content: string;
  readonly hash: string;
  readonly pr: number;
  readonly id: string;
}

/** The shared worktrees root: `<parent of primary>/.worktrees/<primary name>`. */
function defaultWorktreeRoot(deps: CallerDeps, repoRoot: string): string {
  const common = deps.git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const primary = path.dirname(common);
  return path.join(path.dirname(primary), '.worktrees', path.basename(primary));
}

export function runCaller(opts: CallerOptions, deps: CallerDeps): CallerReport {
  const mode = opts.write ? 'write' : 'dry-run';
  const refuse = (reason: string, detail: string): CallerReport => ({
    ok: false,
    mode,
    refused: { reason, detail },
    alreadyApproved: 0,
    results: [],
  });
  const { repoRoot, repo, base } = opts;
  const show = (rel: string): string | null => {
    try {
      return deps.git(repoRoot, ['show', `${base}:${rel}`]);
    } catch {
      return null;
    }
  };

  // ── run-level preconditions: each refuses the whole run, before any write ──
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return refuse('repo-unknown', `"${repo}" is not owner/name`);
  if (NEVER_DELEGATED_REPO_NAMES.has(repo.split('/')[1].toLowerCase())) {
    return refuse('repo-never-delegated', `${repo} is never delegated; its approvals stay the founder's`);
  }
  if (!fs.existsSync(path.join(repoRoot, '.minspec'))) {
    return refuse('not-opted-in', `no .minspec/ at ${repoRoot}: this repo has not opted in`);
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) return refuse('max-invalid', `--max must be a positive integer`);

  let shallow: string;
  try {
    shallow = deps.git(repoRoot, ['rev-parse', '--is-shallow-repository']).trim();
  } catch (err) {
    return refuse('git-unreadable', String(err).split('\n')[0]);
  }
  if (shallow !== 'false') {
    return refuse('shallow-clone', 'the clone is shallow: the repeat-fix share cannot be measured, so nothing is approved (use fetch-depth: 0)');
  }
  if (base.startsWith('origin/')) {
    try {
      deps.git(repoRoot, ['fetch', '--quiet', 'origin', base.slice('origin/'.length)], { GIT_TERMINAL_PROMPT: '0' });
    } catch (err) {
      return refuse('fetch-failed', `could not fetch ${base}: ${String(err).split('\n')[0]}`);
    }
  }
  try {
    deps.git(repoRoot, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    return refuse('base-unknown', `${base} is not a commit`);
  }

  const delegationsText = show('.minspec/delegations.json');
  const delegations: Delegation[] | undefined = delegationsText === null ? undefined : parseDelegations(delegationsText);
  const ours = (delegations ?? []).filter((d) => d.repo.toLowerCase() === repo.toLowerCase());
  if (delegations === undefined || ours.length === 0) {
    return refuse('no-delegation-record', `no readable delegation for ${repo} in .minspec/delegations.json on ${base}`);
  }
  const share = deps.repeatFixShare(repoRoot, base);
  if (share === undefined || !Number.isFinite(share)) {
    return refuse('tripwire-unknown', 'the repeat-fix share could not be measured, so the tripwire cannot be checked');
  }
  const cap = Math.min(...ours.map((d) => d.tripwire.max));
  if (share > cap) return refuse('tripwire-tripped', `repeat-fix share ${share} exceeds the tripwire ${cap}`);

  const token = deps.mintToken().trim();
  if (token === '') return refuse('no-bot-token', 'no App installation token could be minted; nothing is written under any other identity');
  // Only an installation token can list the installation's repositories. A user token
  // (the founder's) is refused here, so no write below can be attributed to him.
  try {
    deps.gh(['api', '/installation/repositories?per_page=1'], token);
  } catch (err) {
    return refuse('not-bot-identity', `the token is not a working App installation token: ${String(err).split('\n')[0]}`);
  }

  let openPaths: Set<string>;
  let openHeads: Set<string>;
  try {
    const rows = JSON.parse(
      deps.gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', String(OPEN_PR_LIMIT), '--json', 'number,headRefName,files'], token),
    ) as { headRefName?: string; files?: { path?: string }[] }[];
    if (!Array.isArray(rows)) throw new Error('not a list');
    if (rows.length >= OPEN_PR_LIMIT) {
      return refuse('open-pr-read-truncated', `the open pull request read returned ${rows.length}, the limit: it may be cut off`);
    }
    openPaths = new Set(rows.flatMap((r) => (r.files ?? []).map((f) => String(f.path ?? ''))));
    openHeads = new Set(rows.map((r) => String(r.headRefName ?? '')));
  } catch (err) {
    return refuse('open-pr-read-failed', String(err).split('\n')[0]);
  }

  const decisionStatus = (id: string): string | undefined => {
    if (!/^DR-\d+$/.test(id)) return undefined;
    const t = show(`docs/decisions/${id}.md`);
    return t === null ? undefined : frontmatterField(t, 'status');
  };
  const today = deps.today();

  // ── candidates: approvables on the base without a current approval record ──
  let listing: string;
  try {
    listing = deps.git(repoRoot, ['ls-tree', '-r', '--name-only', base, '--', 'specs', 'docs/decisions']);
  } catch (err) {
    return refuse('base-unreadable', String(err).split('\n')[0]);
  }
  const results: ArtifactResult[] = [];
  const candidates: Candidate[] = [];
  let alreadyApproved = 0;
  const skip = (artifact: string, reason: string, detail?: string, pr?: number) =>
    results.push({ artifact, pr, outcome: 'skipped', reason, detail });

  for (const artifact of listing.split('\n').map((l) => l.trim()).filter(isApprovableCandidatePath).sort()) {
    const content = show(artifact);
    if (content === null) continue;
    const hash = specHash(content);
    const sidecarText = show(sidecarPathFor(artifact));
    if (sidecarText !== null) {
      let existing: unknown;
      try {
        existing = (JSON.parse(sidecarText) as { specHash?: unknown }).specHash;
      } catch {
        skip(artifact, 'sidecar-unreadable', 'the existing approval record does not parse; it is never overwritten');
        continue;
      }
      if (existing === hash) {
        alreadyApproved++;
        continue;
      }
    }
    const act = actForPath(artifact);
    const status = frontmatterField(content, 'status');
    if (act === 'spec-approval') {
      if (status === undefined) {
        skip(artifact, 'status-unknown');
        continue;
      }
      if (isTerminalSpecStatus(status as SpecStatus)) continue;
    } else if (status !== 'proposed') {
      continue;
    }
    if (act === 'spec-approval') {
      // Same shared check the CLI applies (#3059): refuse visibly before any GitHub read.
      const open = openClarifyDetail(content);
      if (open !== undefined) {
        skip(artifact, 'clarify-open', open);
        continue;
      }
    }
    const tier = frontmatterField(content, 'tier');
    if (act === 'spec-approval') {
      const phase = clarifyPhaseDetail(content, tier);
      if (phase !== undefined) {
        skip(artifact, 'clarify-pending', phase);
        continue;
      }
    }
    if (tier === undefined || !TIERS.includes(tier as Tier)) {
      skip(artifact, 'tier-unknown', 'no tier T1..T4 declared');
      continue;
    }
    const kind = frontmatterField(content, 'kind');
    // The same scope predicate the validator uses, asked before any GitHub read.
    const scope = evaluateDelegation(ours, decisionStatus, {
      repo,
      act,
      tier: tier as Tier,
      actor: BOT_ACTOR,
      author: '(pre-check)',
      verdictBy: '(pre-check verdict)',
      drKind: kind === 'engineering' ? 'engineering' : kind === 'direction' ? 'direction' : undefined,
      repeatFixShare: share,
      today,
      paths: [artifact],
    });
    if (!scope.covered) {
      skip(artifact, `delegation-${scope.reason}`, scope.detail);
      continue;
    }
    const pr = deps.contentPullRequest(repoRoot, base, artifact);
    if (pr === undefined) {
      skip(artifact, 'content-pr-unknown', 'the pull request that last changed this content could not be read from git');
      continue;
    }
    if (openPaths.has(artifact) || openPaths.has(sidecarPathFor(artifact))) {
      skip(artifact, 'in-open-pr', 'an open pull request changes this artifact or its approval record', pr);
      continue;
    }
    candidates.push({ artifact, content, hash, pr, id: artifactId(artifact, content) });
  }

  // ── record, oldest content pull request first ──
  const wtRoot = opts.worktreeRoot ?? defaultWorktreeRoot(deps, repoRoot);
  let failed = false;
  for (const c of candidates.sort((a, b) => a.pr - b.pr).slice(0, opts.max)) {
    const r = recordOne(c, opts, deps, token, wtRoot, openHeads);
    if (r.outcome === 'error') failed = true;
    results.push(r);
  }
  for (const c of candidates.slice(opts.max)) {
    skip(c.artifact, 'over-max', `more than --max ${opts.max} this run; next run takes it`, c.pr);
  }
  return { ok: !failed, mode, alreadyApproved, results };
}

function recordOne(
  c: Candidate,
  opts: CallerOptions,
  deps: CallerDeps,
  token: string,
  wtRoot: string,
  openHeads: ReadonlySet<string>,
): ArtifactResult {
  const { repoRoot, repo, base } = opts;
  const branch = branchFor(c.id, c.hash);
  const at = (outcome: Outcome, reason: string, detail?: string, url?: string): ArtifactResult => ({
    artifact: c.artifact,
    pr: c.pr,
    outcome,
    reason,
    detail,
    branch,
    url,
  });
  const wt = path.join(wtRoot, branch.replace(/\//g, '-'));

  try {
    if (deps.git(repoRoot, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim() !== '') {
      // Pushed by an earlier run. With its pull request open, that run's work stands. With
      // none open (a PR create that failed, or a PR closed unmerged) it is reported as an
      // error every run, never silently skipped, and never re-pushed over.
      return openHeads.has(branch)
        ? at('skipped', 'approval-pr-open', `${branch} already has an open pull request`)
        : at('error', 'approval-branch-without-pr', `origin has ${branch} but no open pull request for it`);
    }
  } catch (err) {
    return at('skipped', 'remote-unreadable', String(err).split('\n')[0]);
  }
  try {
    deps.git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return at('skipped', 'local-branch-exists', `${branch} exists locally (a crashed run?); it is left for inspection`);
  } catch {
    /* absent: the expected case */
  }
  if (fs.existsSync(wt)) return at('skipped', 'worktree-exists', `${wt} exists; it is left for inspection`);

  // The pre-commit gate needs installed dependencies; refuse before any branch exists (#3057).
  const depsRoot = opts.write ? resolveDependencyRoot(repoRoot, deps.git) : repoRoot;
  if (depsRoot === null) {
    return at(
      'error',
      'dependencies-missing',
      `no node_modules in ${repoRoot} or in the primary worktree; run npm install there (the recording commit's pre-commit gate needs it)`,
    );
  }

  fs.mkdirSync(wtRoot, { recursive: true });
  try {
    deps.git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, wt, base]);
  } catch (err) {
    return at('error', 'worktree-failed', String(err).split('\n')[0]);
  }

  let pushed = false;
  try {
    const run = deps.approve({ repoRoot, worktree: wt, artifact: c.artifact, pr: c.pr, repo, base, write: opts.write, token });
    const verdict = readCliVerdict(run, c.artifact, repo);
    if (!verdict.ok) return at('denied', verdict.reason, verdict.detail);
    if (verdict.record.specHash !== c.hash) {
      return at('denied', 'record-hash-differs', 'the CLI judged other content than the base holds');
    }
    if (!opts.write) return at('would-open', 'covered', `${verdict.delegationId}, verdict ${verdict.record.verdictBy}`);

    // What the CLI wrote must be exactly the sidecar and its approvable (and the
    // regenerated register index for a DR), and the sidecar must be the record it printed.
    const sidecar = sidecarPathFor(c.artifact);
    const changed = parsePorcelainZ(deps.git(wt, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const allowed = new Set([sidecar, c.artifact]);
    if (verdict.record.act === 'engineering-dr-acceptance') allowed.add('docs/decisions/INDEX.md');
    const strays = changed.filter((f) => !allowed.has(f));
    if (strays.length > 0 || !changed.includes(sidecar)) {
      return at('denied', 'unexpected-write', strays.length > 0 ? `also changed: ${strays.join(', ')}` : 'no sidecar was written');
    }
    let written: unknown;
    try {
      written = JSON.parse(fs.readFileSync(path.join(wt, sidecar), 'utf-8'));
    } catch {
      return at('denied', 'unexpected-write', 'the written sidecar does not parse');
    }
    if (JSON.stringify(written) !== JSON.stringify(verdict.record)) {
      return at('denied', 'unexpected-write', 'the written sidecar is not the record the CLI printed');
    }

    const isDr = verdict.record.act === 'engineering-dr-acceptance';
    const subject = isDr
      ? `chore(accept): ${c.id} → accepted (delegated, ${verdict.delegationId})`
      : `chore(approve): ${c.id} approved for implementation (delegated, ${verdict.delegationId})`;
    const why = [
      `Recorded by ${BOT_ACTOR} under ${verdict.delegationId} (DR-108), not by the founder.`,
      `Content pull request: #${c.pr}. Author: ${verdict.record.author}.`,
      `Independent verdict: ${verdict.record.verdictBy}`,
      `Caller: scripts/lib/delegated-approval-caller.ts (#2981).`,
    ].join('\n');
    const gitId = ['-c', `user.name=${BOT_ACTOR}`, '-c', `user.email=${BOT_EMAIL}`];
    // The pre-commit validate gate runs `npm run validate` (tsx + hoisted deps); a fresh
    // worktree has no node_modules, the validator crashes, and the gate fails closed (#3020).
    // Linked AFTER the stray check and never staged: add/commit take explicit paths only.
    linkDependencies(depsRoot, wt);
    deps.git(wt, ['add', '--', ...changed]);
    deps.git(wt, [...gitId, 'commit', '--quiet', '-m', subject, '-m', why, '--', ...changed]);
    deps.git(
      wt,
      [
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f',
        'push',
        '--quiet',
        'origin',
        `refs/heads/${branch}:refs/heads/${branch}`,
      ],
      { GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
    );
    pushed = true;

    const bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-approve-'));
    const bodyFile = path.join(bodyDir, 'body.md');
    fs.writeFileSync(bodyFile, prBody(c, verdict.record, verdict.delegationId, isDr), 'utf-8');
    let out: string;
    try {
      out = deps.gh(
        ['pr', 'create', '--repo', repo, '--base', base.replace(/^origin\//, ''), '--head', branch, '--title', subject, '--body-file', bodyFile],
        token,
      );
    } finally {
      fs.rmSync(bodyDir, { recursive: true, force: true });
    }
    const url = out.trim().split('\n').pop() ?? '';
    if (!/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url)) {
      return at('error', 'pr-create-unconfirmed', `gh printed no pull request URL; ${branch} is pushed: ${out.slice(0, 200)}`);
    }
    return at('opened', 'covered', `${verdict.delegationId}, verdict ${verdict.record.verdictBy}`, url);
  } catch (err) {
    return at('error', pushed ? 'pr-create-failed' : 'write-failed', errorDetail(err));
  } finally {
    try {
      deps.git(repoRoot, ['worktree', 'remove', '--force', wt]);
    } catch {
      /* reported by the next run as worktree-exists, never silently reused */
    }
    // Always: once pushed, origin holds the branch; unpushed, the run is deterministic
    // and the next one rebuilds it from the base.
    try {
      deps.git(repoRoot, ['branch', '-D', branch]);
    } catch {
      /* reported by the next run as local-branch-exists */
    }
  }
}

function prBody(c: Candidate, rec: CliRecord, delegationId: string, isDr: boolean): string {
  const act = isDr ? `accepts engineering decision record ${c.id}` : `approves ${c.id} for implementation`;
  return [
    `## Delegated ${isDr ? 'acceptance' : 'approval'} - recorded by ${BOT_ACTOR}, not the founder`,
    '',
    `This pull request ${act} under delegation **${delegationId}** (DR-108, delegated approval under the bot's own name).`,
    `The founder did not take this act; the record names \`${BOT_ACTOR}\` as the actor and cites the delegation as its basis.`,
    '',
    `- Artifact: \`${c.artifact}\` (tier ${rec.tier})`,
    `- Content pull request: #${c.pr} (merged; its content is what is approved)`,
    `- Author: \`${rec.author}\``,
    `- Independent verdict (second AI, not the author): ${rec.verdictBy}`,
    `- Approval record: \`${sidecarPathFor(c.artifact)}\``,
    '',
    'Judged by `scripts/lib/delegated-approval.ts` (the CLI) and judged again by `approval-integrity` on this pull request.',
    'Opened by `scripts/lib/delegated-approval-caller.ts` (#2981). It never merges and never arms auto-merge.',
    '',
  ].join('\n');
}

/** Node's uncaught-error banner: three lines that precede the actual message (#3020). */
const NODE_CRASH_NOISE = /^(node:internal\/|const err = |throw |\^+$)/;

/**
 * The directory whose `node_modules` the recording worktree should use: `repoRoot` when it
 * has them, else the primary worktree (first `git worktree list --porcelain` entry) when it
 * does, else null (#3057: a session worktree used as --repo-root has no deps of its own).
 */
export function resolveDependencyRoot(repoRoot: string, git: CallerDeps['git']): string | null {
  if (fs.existsSync(path.join(repoRoot, 'node_modules'))) return repoRoot;
  try {
    const first = git(repoRoot, ['worktree', 'list', '--porcelain']).split('\n')[0] ?? '';
    const primary = first.startsWith('worktree ') ? first.slice('worktree '.length).trim() : '';
    if (primary !== '' && fs.existsSync(path.join(primary, 'node_modules'))) return primary;
  } catch {
    /* unreadable: treated as no fallback */
  }
  return null;
}

/**
 * Make the primary checkout's installed dependencies visible to the recording worktree.
 * Without them the pre-commit validate gate cannot run and refuses the commit (#3020).
 * A no-op when the primary has none or the worktree already has `node_modules`.
 */
export function linkDependencies(repoRoot: string, worktree: string): boolean {
  const src = path.join(repoRoot, 'node_modules');
  const dst = path.join(worktree, 'node_modules');
  if (!fs.existsSync(src)) return false;
  try {
    fs.lstatSync(dst);
    return false;
  } catch {
    /* absent: link it */
  }
  fs.symlinkSync(src, dst, 'dir');
  return true;
}

/**
 * One-line failure reason for the report. `execFileSync` puts git's own words (hook
 * refusal, nothing to commit, identity error) on `err.stderr`, never in `String(err)`,
 * which is only "Command failed: git ... commit"; keep both so the cause is diagnosable.
 */
export function errorDetail(err: unknown): string {
  const head = String(err).split('\n')[0];
  const raw = (err as { stderr?: unknown } | null)?.stderr;
  const stderr = raw == null ? '' : String(raw);
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NODE_CRASH_NOISE.test(l))
    .slice(0, 3);
  return lines.length === 0 ? head : `${head} | stderr: ${lines.join(' / ').slice(0, 600)}`;
}

// ─── the real seams ─────────────────────────────────────────────────────────

const realGit: CallerDeps['git'] = (cwd, args, env) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(env ?? {}) },
  });

const realGh: CallerDeps['gh'] = (args, token) => {
  if (token.trim() === '') throw new Error('refusing a gh call with an empty token');
  return execFileSync('gh', [...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: '' },
  });
};

const realMint = (): string => {
  const cmd = process.env.MINSPEC_GH_APP_TOKEN_CMD || TOKEN_SCRIPT;
  try {
    return execFileSync(cmd, [], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
};

const realApprove: CallerDeps['approve'] = (c) => {
  const args = [
    '--no-install',
    'tsx',
    path.join(c.repoRoot, 'scripts', 'lib', 'delegated-approval.ts'),
    '--artifact',
    c.artifact,
    '--pr',
    String(c.pr),
    '--repo-root',
    c.worktree,
    '--repo',
    c.repo,
    '--base',
    c.base,
    ...(c.write ? ['--write'] : []),
  ];
  try {
    const stdout = execFileSync('npx', args, {
      cwd: c.repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_TOKEN: c.token, GITHUB_TOKEN: '' },
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: typeof e.status === 'number' && e.status !== 0 ? e.status : 1, stdout: String(e.stdout ?? '') };
  }
};

export const REAL_DEPS: CallerDeps = {
  git: realGit,
  gh: realGh,
  mintToken: realMint,
  approve: realApprove,
  repeatFixShare: (root, base) => readRepeatFixShare(root, base).share,
  contentPullRequest: (root, base, rel) => readContentPullRequest(root, base, rel),
  today: utcToday,
};

// ─── the CLI ────────────────────────────────────────────────────────────────

/** Strict argv parse. Any unknown flag or missing value is a usage error, never a guess. */
export function parseCallerArgs(argv: readonly string[], cwd: string): CallerOptions | string {
  const v: Record<string, string> = {};
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') {
      write = true;
      continue;
    }
    if (!['--repo-root', '--repo', '--base', '--max', '--worktree-root'].includes(k)) return `unknown argument: ${k}`;
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) return `${k} needs a value`;
    v[k.slice(2)] = val;
    i++;
  }
  if (v.max !== undefined && !/^[1-9]\d*$/.test(v.max)) return '--max must be a positive integer';
  const repoRoot = path.resolve(v['repo-root'] ?? cwd);
  let repo: string | undefined = v.repo;
  if (repo === undefined) {
    try {
      const url = realGit(repoRoot, ['remote', 'get-url', 'origin']).trim();
      repo = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1];
    } catch {
      repo = undefined;
    }
  }
  if (repo === undefined) return 'repository unknown; pass --repo';
  return {
    repoRoot,
    repo,
    base: v.base ?? 'origin/main',
    max: v.max === undefined ? DEFAULT_MAX : Number(v.max),
    write,
    worktreeRoot: v['worktree-root'] === undefined ? undefined : path.resolve(v['worktree-root']),
  };
}

if (/(^|[\\/])delegated-approval-caller\.ts$/.test(process.argv[1] ?? '')) {
  let code = 1;
  try {
    const opts = parseCallerArgs(process.argv.slice(2), process.cwd());
    if (typeof opts === 'string') {
      console.log(JSON.stringify({ ok: false, refused: { reason: 'cli-usage', detail: opts } }));
    } else {
      const report = runCaller(opts, REAL_DEPS);
      console.log(JSON.stringify(report, null, 2));
      code = report.refused ? 1 : report.ok ? 0 : 2;
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, refused: { reason: 'errored', detail: String(err).split('\n')[0] } }));
    code = 1;
  }
  process.exit(code);
}
