/**
 * The calling path for delegated approval (#2854 item 3, DR-108).
 *
 * The ONLY code that writes an approval record under `minspec-sdd[bot]`. It records an
 * approval of a spec, or an acceptance of an engineering decision record, only after an
 * independent AI review passed on that exact content, and it cites the review comment as
 * `verdictBy`. The record it writes is then judged again, by the same predicate, in
 * `scripts/approval-integrity.ts` (`checkApprovalActor`), so this path and the validator
 * cannot disagree about what a valid delegated record is.
 *
 * WHAT COUNTS AS AN INDEPENDENT AI REVIEW PASS. The content pull request (the one that
 * last changed the artifact, given as `--pr`) must:
 *
 *   1. be merged, and list the artifact among its changed files;
 *   2. carry, at its head commit, the same canonical content (`specHash`) as the artifact
 *      being approved, so the review was of these bytes and not an earlier draft;
 *   3. have an `ai-review` check-run on that head commit, from the reviewer App, with
 *      conclusion `success` (the verdict check, which mirrors the verdict: see the NOTE
 *      at the top of `.github/workflows/ai-review.yml`);
 *   4. have, as its LATEST AI review comment from the reviewer App, an `ai-review:pass`
 *      comment, posted inside a completed run of `.github/workflows/ai-review.yml` on
 *      that head commit. The App token is available to agent sessions, so a comment's
 *      login alone does not prove CI posted it; a run is something an agent cannot
 *      create for a pull_request event, so the time window ties the comment to CI.
 *
 * And the recording session must not be the authoring one: the current branch must
 * differ from the content pull request's head branch.
 *
 * Every missing witness DENIES: no pull request, no files, no head content, no check-run,
 * no comment, no run, no delegation file, unknown repeat-fix share.
 *
 * Network: `gh api` (GitHub). This is dev-time tooling in `scripts/`, not shipped
 * (DR-086 §5); MinSpec itself still makes no network call (constitution invariant 1).
 *
 *   npx tsx scripts/lib/delegated-approval.ts --artifact <repo-relative path> --pr <N> \
 *     [--repo-root <dir>] [--repo owner/name] [--base origin/main] [--write]
 *
 * Without `--write` it prints the decision and the record it would write. With `--write`
 * it also writes the sidecar and moves the artifact's lifecycle (a spec advances to
 * implementing; a DR flips to `accepted` and the register index is regenerated), the
 * same writes the founder's *Approve Spec* / *Accept ADR* make. Committing and opening the
 * approval pull request stay with the caller. Exit 0 = approved (or would be), 1 = denied.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { specHash } from '../../packages/shared/src/canonical';
import { BOT_ACTOR, parseDelegations, type DelegatedAct, type Tier } from './autonomy';
import {
  actForPath,
  checkApprovalActor,
  frontmatterField,
  type DelegationWitnesses,
} from './approval-actor';
import { readRepeatFixShare, utcToday } from './repeat-fix-share';
import { readContentPullRequest } from './content-pr';
import { readSpecFile, advanceSpecToImplementing } from '../../packages/minspec/src/lib/spec';
import { isTerminalSpecStatus } from '../../packages/minspec/src/lib/spec-vocabulary';
import { loadConfig } from '../../packages/minspec/src/lib/config';
import { validateSpec } from '../../packages/minspec/src/lib/spec-validator';
import { epicRefSet } from '../../packages/minspec/src/lib/epic-manager';
import { readShardIdFiles } from '../../packages/minspec/src/lib/spec-layout';
import { assertOwnershipDeclaredForAdvance } from '../../packages/minspec/src/lib/ownership-advance-guard';
import { setAdrStatus, regenerateDrIndex } from '../../packages/minspec/src/lib/adr-manager';

/** Where the AI review panel's run lives. A comment outside one of its runs is not a verdict. */
export const AI_REVIEW_WORKFLOW_PATH = '.github/workflows/ai-review.yml';
/** The verdict check-run's name (not the runner job's implicit check). */
export const AI_REVIEW_CHECK_NAME = 'ai-review';
/** The App that posts the review. The same App the agents use, hence the run binding. */
export const REVIEWER_LOGIN = BOT_ACTOR;
export const REVIEWER_APP_SLUG = 'minspec-sdd';

const REVIEW_HEADING = /^## 🤖 AI review — `ai-review:([a-z-]+)`/;

export interface PullFacts {
  readonly number: number;
  readonly merged: boolean;
  readonly headSha: string;
  readonly headRef: string;
  readonly authorLogin: string;
  readonly files: readonly string[];
}

export interface CommentFacts {
  readonly id: number;
  readonly url: string;
  readonly login: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface CheckRunFacts {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly appSlug: string | undefined;
  readonly headSha: string;
  readonly completedAt: string | null;
}

export interface WorkflowRunFacts {
  readonly path: string;
  readonly event: string;
  readonly status: string;
  readonly headSha: string;
  readonly runStartedAt: string;
  readonly updatedAt: string;
}

export interface ReviewEvidence {
  readonly pull: PullFacts;
  /** The artifact's bytes at the pull request's head commit, or null when absent there. */
  readonly artifactAtHead: string | null;
  readonly comments: readonly CommentFacts[];
  readonly checkRuns: readonly CheckRunFacts[];
  readonly workflowRuns: readonly WorkflowRunFacts[];
}

export interface PlanInput {
  readonly artifactPath: string;
  /** The artifact as it is on the base being approved, or null when absent. */
  readonly artifactContent: string | null;
  /** `undefined` = the evidence could not be gathered. */
  readonly review: ReviewEvidence | undefined;
  /** The branch the recording session is on. */
  readonly recorderRef: string;
  /** The specHash of an existing approval record for this artifact, if any. */
  readonly existingApprovalHash: string | undefined;
  readonly witnesses: DelegationWitnesses;
  /** ISO-8601, the approval time to record. */
  readonly now: string;
}

/** The sidecar this path writes. DR-012's record plus the amendment's fields. */
export interface DelegatedApprovalRecord {
  readonly specPath: string;
  readonly specHash: string;
  readonly approvedAt: string;
  readonly approvedBy: typeof BOT_ACTOR;
  readonly tier: Tier;
  readonly migrated: false;
  readonly baselineBlob: '';
  readonly actor: typeof BOT_ACTOR;
  readonly basis: string;
  readonly act: DelegatedAct;
  readonly author: string;
  readonly verdictBy: string;
}

export type PlanResult =
  | { readonly ok: true; readonly record: DelegatedApprovalRecord; readonly delegationId: string }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];

/** `session:<branch>` for an agent-authored pull request, the login otherwise. */
export function authorIdentity(pull: Pick<PullFacts, 'authorLogin' | 'headRef'>): string {
  return /\[bot\]$/i.test(pull.authorLogin) ? `session:${pull.headRef}` : pull.authorLogin;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/**
 * Decide, and build the record. Pure: every fact arrives as input.
 *
 * The record is built first and then judged by `checkApprovalActor`, the validator's own
 * predicate, so the delegation decision is made in exactly one place.
 */
export function planDelegatedApproval(input: PlanInput): PlanResult {
  const no = (reason: string, detail: string): PlanResult => ({ ok: false, reason, detail });
  const { artifactPath, artifactContent, review, witnesses } = input;

  if (artifactContent === null) return no('artifact-missing', `${artifactPath} does not exist on the base`);
  if (review === undefined) return no('no-review-evidence', 'the review evidence could not be gathered');

  const hash = specHash(artifactContent);
  if (input.existingApprovalHash === hash) {
    return no('already-approved', `${artifactPath} already has an approval record for this content`);
  }

  const { pull } = review;
  if (!pull.merged) return no('pr-not-merged', `#${pull.number} is not merged, so its content is not what is being approved`);
  if (!pull.files.includes(artifactPath)) {
    return no('pr-does-not-touch-artifact', `#${pull.number} does not change ${artifactPath}, so its review did not judge it`);
  }
  if (review.artifactAtHead === null) {
    return no('reviewed-content-missing', `${artifactPath} is absent at #${pull.number}'s head ${pull.headSha}`);
  }
  if (specHash(review.artifactAtHead) !== hash) {
    return no(
      'reviewed-content-differs',
      `${artifactPath} at #${pull.number}'s head canonicalizes differently from the content being approved: the review was of other bytes`,
    );
  }

  // The recording session is not the authoring one.
  const recorder = input.recorderRef.trim();
  if (recorder === '') return no('recorder-unknown', 'the recording session\'s branch could not be read');
  if (recorder === pull.headRef) {
    return no('author-is-recorder', `the recording branch ${recorder} is the branch that wrote ${artifactPath}`);
  }

  const pass = judgeHeadReviewPass(review);
  if (!pass.ok) return no(pass.reason, pass.detail);
  const latest = { url: pass.url };

  const tier = frontmatterField(artifactContent, 'tier');
  if (tier === undefined || !TIERS.includes(tier as Tier)) {
    return no('tier-unknown', `${artifactPath} declares no tier T1..T4, and a tier is never invented`);
  }

  const delegations = witnesses.delegations ?? [];
  const act = actForPath(artifactPath);
  // The delegation to cite: the first that covers this repo and act. `checkApprovalActor`
  // re-judges it in full, so picking a non-covering one only produces a refusal.
  const cand = delegations.find(
    (d) => d.repo.toLowerCase() === (witnesses.repo ?? '').toLowerCase() && d.covers.includes(act),
  );
  if (cand === undefined) return no('no-delegation', `no delegation names ${String(witnesses.repo)} for ${act}`);

  const record: DelegatedApprovalRecord = {
    specPath: artifactPath,
    specHash: hash,
    approvedAt: input.now,
    approvedBy: BOT_ACTOR,
    tier: tier as Tier,
    migrated: false,
    baselineBlob: '',
    actor: BOT_ACTOR,
    basis: `delegation:${cand.id}`,
    act,
    author: authorIdentity(pull),
    verdictBy: latest.url,
  };

  const judged = checkApprovalActor(record as unknown as Record<string, unknown>, { path: artifactPath, content: artifactContent }, witnesses);
  if (judged.failures.length > 0 || judged.cls?.kind !== 'delegated') {
    const f = judged.failures[0];
    return no(f ? f.check : 'not-delegated', f ? f.detail : 'the record did not classify as delegated');
  }
  return { ok: true, record, delegationId: judged.cls.delegationId };
}

/**
 * Did an independent AI review pass on the pull request's CURRENT head commit? Items 3
 * and 4 of the header, and nothing else: the `ai-review` check-run from the reviewer App
 * on `pull.headSha` concluded `success`, and the LATEST AI review comment from the
 * reviewer App is an `ai-review:pass`, posted inside a completed `ai-review.yml` run on
 * that same head. Pure. Shared by the post-merge approval path (above) and the pre-merge
 * delegated arm (`delegated-merge.ts`, #2981), so the two cannot disagree on what a pass
 * on a head is.
 */
export function judgeHeadReviewPass(
  review: ReviewEvidence,
): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string; readonly detail: string } {
  const deny = (reason: string, detail: string) => ({ ok: false as const, reason, detail });
  const { pull } = review;
  // The verdict check-run on the reviewed commit.
  const checks = review.checkRuns
    .filter((c) => c.name === AI_REVIEW_CHECK_NAME && c.headSha === pull.headSha && c.appSlug === REVIEWER_APP_SLUG)
    .sort((a, b) => (ms(b.completedAt) || 0) - (ms(a.completedAt) || 0));
  if (checks.length === 0) {
    return deny('no-ai-review-check', `no ${AI_REVIEW_CHECK_NAME} check-run from ${REVIEWER_APP_SLUG} on ${pull.headSha}`);
  }
  if (checks[0].status !== 'completed' || checks[0].conclusion !== 'success') {
    return deny(
      'ai-review-check-not-success',
      `the latest ${AI_REVIEW_CHECK_NAME} check on ${pull.headSha} is ${checks[0].status}/${String(checks[0].conclusion)}`,
    );
  }

  // The latest AI review comment, and the CI run it was posted inside.
  const reviews = review.comments
    .filter((c) => c.login === REVIEWER_LOGIN && REVIEW_HEADING.test(c.body) && !Number.isNaN(ms(c.createdAt)))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt) || b.id - a.id);
  if (reviews.length === 0) return deny('no-ai-review-comment', `#${pull.number} has no AI review comment`);
  const latest = reviews[0];
  const label = latest.body.match(REVIEW_HEADING)?.[1];
  if (label !== 'pass') {
    return deny('latest-review-not-pass', `the latest AI review on #${pull.number} is ai-review:${String(label)}`);
  }
  const runs = review.workflowRuns.filter(
    (r) =>
      r.path === AI_REVIEW_WORKFLOW_PATH &&
      r.event === 'pull_request' &&
      r.status === 'completed' &&
      r.headSha === pull.headSha,
  );
  if (runs.length === 0) {
    return deny('no-ai-review-run', `no completed ${AI_REVIEW_WORKFLOW_PATH} run on ${pull.headSha}`);
  }
  const at = ms(latest.createdAt);
  if (!runs.some((r) => ms(r.runStartedAt) <= at && at <= ms(r.updatedAt))) {
    return deny(
      'comment-outside-ci-run',
      `the pass comment ${latest.url} was not posted during any ${AI_REVIEW_WORKFLOW_PATH} run on ${pull.headSha}`,
    );
  }
  return { ok: true, url: latest.url };
}

// ─── IO: gathering the evidence ─────────────────────────────────────────────

export type GhRunner = (args: readonly string[]) => string;

const defaultGh: GhRunner = (args) =>
  execFileSync('gh', ['api', ...args], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

function pages<T>(gh: GhRunner, route: string, pick: (page: unknown) => T[]): T[] {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const sep = route.includes('?') ? '&' : '?';
    const items = pick(JSON.parse(gh([`${route}${sep}per_page=100&page=${page}`])));
    out.push(...items);
    if (items.length < 100) return out;
  }
  throw new Error(`${route}: more than 50 pages, refusing to judge a partial list`);
}

type Json = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Read every fact `planDelegatedApproval` needs from GitHub. Throws on any read
 * failure; the CLI turns a throw into a denial.
 */
export function gatherReviewEvidence(
  repo: string,
  prNumber: number,
  artifactPath: string,
  gh: GhRunner = defaultGh,
): ReviewEvidence {
  const pr = JSON.parse(gh([`repos/${repo}/pulls/${prNumber}`])) as Json;
  const head = (pr.head ?? {}) as Json;
  const headSha = s(head.sha);
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error(`#${prNumber}: no head sha`);

  const files = pages(gh, `repos/${repo}/pulls/${prNumber}/files`, (p) =>
    (p as Json[]).map((f) => s(f.filename)),
  );

  let artifactAtHead: string | null;
  try {
    artifactAtHead = gh([
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/${artifactPath.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`,
    ]);
  } catch {
    artifactAtHead = null;
  }

  const comments = pages(gh, `repos/${repo}/issues/${prNumber}/comments`, (p) =>
    (p as Json[]).map((c) => ({
      id: Number(c.id),
      url: s(c.html_url),
      login: s((c.user as Json | null)?.login),
      body: s(c.body),
      createdAt: s(c.created_at),
    })),
  );

  const checkRuns = pages(gh, `repos/${repo}/commits/${headSha}/check-runs?check_name=${AI_REVIEW_CHECK_NAME}`, (p) =>
    (((p as Json).check_runs ?? []) as Json[]).map((c) => ({
      name: s(c.name),
      status: s(c.status),
      conclusion: typeof c.conclusion === 'string' ? c.conclusion : null,
      appSlug: s((c.app as Json | null)?.slug) || undefined,
      headSha: s(c.head_sha),
      completedAt: typeof c.completed_at === 'string' ? c.completed_at : null,
    })),
  );

  const workflowRuns = pages(gh, `repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request`, (p) =>
    (((p as Json).workflow_runs ?? []) as Json[]).map((r) => ({
      path: s(r.path),
      event: s(r.event),
      status: s(r.status),
      headSha: s(r.head_sha),
      runStartedAt: s(r.run_started_at),
      updatedAt: s(r.updated_at),
    })),
  );

  return {
    pull: {
      number: prNumber,
      merged: pr.merged === true,
      headSha,
      headRef: s(head.ref),
      authorLogin: s((pr.user as Json | null)?.login),
      files,
    },
    artifactAtHead,
    comments,
    checkRuns,
    workflowRuns,
  };
}

// ─── the CLI ────────────────────────────────────────────────────────────────

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const gitShow = (root: string, ref: string, rel: string): string | null => {
  try {
    return git(root, ['show', `${ref}:${rel}`]);
  } catch {
    return null;
  }
};

export interface CliArgs {
  readonly artifact: string;
  readonly pr: number;
  readonly repoRoot: string;
  readonly repo?: string;
  readonly base: string;
  readonly write: boolean;
}

/** Strict argv parse. Any unknown flag or missing value is a usage error, never a guess. */
export function parseCliArgs(argv: readonly string[], cwd: string): CliArgs | string {
  const v: Record<string, string> = {};
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') {
      write = true;
      continue;
    }
    if (!['--artifact', '--pr', '--repo-root', '--repo', '--base'].includes(k)) return `unknown argument: ${k}`;
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) return `${k} needs a value`;
    v[k.slice(2)] = val;
    i++;
  }
  const artifact = (v.artifact ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (artifact === '' || artifact.split('/').includes('..') || path.isAbsolute(artifact)) {
    return '--artifact must be a repo-relative path';
  }
  if (!/^\d+$/.test(v.pr ?? '')) return '--pr must be a pull request number';
  return {
    artifact,
    pr: Number(v.pr),
    repoRoot: path.resolve(v['repo-root'] ?? cwd),
    repo: v.repo,
    base: v.base ?? 'origin/main',
    write,
  };
}

function main(): number {
  const parsed = parseCliArgs(process.argv.slice(2), process.cwd());
  if (typeof parsed === 'string') {
    console.log(JSON.stringify({ ok: false, reason: 'cli-usage', detail: parsed }));
    return 1;
  }
  const { artifact, pr, repoRoot, base } = parsed;

  let repo = parsed.repo;
  if (repo === undefined) {
    const m = git(repoRoot, ['remote', 'get-url', 'origin']).trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
    repo = m ? m[1] : undefined;
  }
  if (repo === undefined) {
    console.log(JSON.stringify({ ok: false, reason: 'witness-missing', detail: 'repository unknown; pass --repo' }));
    return 1;
  }

  let review: ReviewEvidence | undefined;
  try {
    review = gatherReviewEvidence(repo, pr, artifact);
  } catch (err) {
    console.error(`evidence could not be gathered: ${String(err).split('\n')[0]}`);
    review = undefined;
  }

  const delegationsText = gitShow(repoRoot, base, '.minspec/delegations.json');
  const existing = gitShow(repoRoot, base, `.minspec/approvals/${artifact}.json`);
  let existingApprovalHash: string | undefined;
  try {
    existingApprovalHash = existing === null ? undefined : (JSON.parse(existing) as { specHash?: string }).specHash;
  } catch {
    existingApprovalHash = undefined;
  }

  const witnesses: DelegationWitnesses = {
    repo,
    delegations: delegationsText === null ? undefined : parseDelegations(delegationsText),
    decisionStatus: (id) => {
      if (!/^DR-\d+$/.test(id)) return undefined;
      const t = gitShow(repoRoot, base, `docs/decisions/${id}.md`);
      return t === null ? undefined : frontmatterField(t, 'status');
    },
    repeatFixShare: readRepeatFixShare(repoRoot, base).share,
    today: utcToday(),
    contentPullRequest: (rel) => readContentPullRequest(repoRoot, base, rel),
  };

  let recorderRef = '';
  try {
    recorderRef = git(repoRoot, ['branch', '--show-current']).trim();
  } catch {
    recorderRef = '';
  }

  const plan = planDelegatedApproval({
    artifactPath: artifact,
    artifactContent: gitShow(repoRoot, base, artifact),
    review,
    recorderRef,
    existingApprovalHash,
    witnesses,
    now: new Date().toISOString(),
  });
  const deny = (reason: string, detail: string): number => {
    console.log(JSON.stringify({ ok: false, reason, detail }));
    return 1;
  };
  if (!plan.ok) {
    console.log(JSON.stringify(plan));
    return 1;
  }

  // The working tree must hold the base's bytes for the artifact, or the record would
  // describe content other than what gets committed.
  const abs = path.join(repoRoot, artifact);
  const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
  if (onDisk === null || specHash(onDisk) !== plan.record.specHash) {
    return deny('working-tree-differs', `${artifact} in the working tree differs from ${base}`);
  }
  // Everything the founder's Approve Spec refuses, this refuses too.
  if (plan.record.act === 'spec-approval') {
    const unready = specNotApprovable(repoRoot, abs);
    if (unready !== undefined) return deny('spec-not-approvable', unready);
  }
  console.log(JSON.stringify(plan));
  if (!parsed.write) return 0;

  writeLifecycle(repoRoot, abs, plan.record.act);
  const sidecar = path.join(repoRoot, '.minspec', 'approvals', `${artifact}.json`);
  if (!fs.existsSync(path.join(repoRoot, '.minspec'))) {
    console.error('no .minspec/ at the repo root: this repo has not opted in');
    return 1;
  }
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  fs.writeFileSync(sidecar, JSON.stringify(plan.record, null, 2) + '\n', 'utf-8');
  return 0;
}

/**
 * The refusals the founder's *Approve Spec* command makes before any write
 * (`packages/minspec/src/commands/approve.ts`): a terminal spec, an incomplete spec
 * (`validateSpec` errors), or one the phase advance would put into violation. Returns
 * the reason, or undefined when the spec may be approved.
 */
export function specNotApprovable(repoRoot: string, abs: string): string | undefined {
  const parsed = readSpecFile(abs);
  const status = parsed.frontmatter.status;
  if (isTerminalSpecStatus(status)) return `the spec is ${String(status)}, past the approval gate`;
  const result = validateSpec(parsed, loadConfig(repoRoot), {
    knownEpicRefs: epicRefSet(repoRoot),
    siblingShardFiles: readShardIdFiles(path.dirname(abs)),
    pathExists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
  });
  if (!result.complete) {
    const errors = result.violations.filter((v) => v.severity === 'error').map((v) => v.message);
    return `the spec is not complete: ${errors.join('; ')}`;
  }
  try {
    assertOwnershipDeclaredForAdvance(abs, parsed);
  } catch (err) {
    return `the phase advance would violate: ${err instanceof Error ? err.message : String(err)}`;
  }
  return undefined;
}

/** The lifecycle half of the act, using the same writers the founder's commands use. */
function writeLifecycle(repoRoot: string, abs: string, act: DelegatedAct): void {
  if (act === 'engineering-dr-acceptance') {
    setAdrStatus(abs, 'accepted');
    regenerateDrIndex(repoRoot);
  } else {
    advanceSpecToImplementing(abs);
  }
}

if (/(^|[\\/])delegated-approval\.ts$/.test(process.argv[1] ?? '')) {
  let code = 1;
  try {
    code = main();
  } catch (err) {
    console.log(JSON.stringify({ ok: false, reason: 'errored', detail: String(err).split('\n')[0] }));
    code = 1;
  }
  process.exit(code);
}
