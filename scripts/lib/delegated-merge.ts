/**
 * The pre-merge half of delegated approval (#2981, DR-108): may a held spec pull request
 * merge without the founder's keystroke?
 *
 * WHY. `dispatch-issue.sh` step 6b holds every `specs/**` pull request as
 * `needs-human-review`: `autonomy_stop_classes_for_paths` gives it the
 * `approval-or-acceptance` stop class, and `mayProceed` stops on any class. DR-108 §1 says
 * a live delegation clears exactly that class and nothing else, through
 * `stopClassesAfterDelegation`. The founder confirmed the reading on 2026-10-21 (queue
 * item dlg2981, verbatim: "y - my aproval is already the Alt-A"): a spec pull request
 * covered by DLG-001 may merge once its AI review passes. Nothing asked the delegation
 * at merge time, so about 36 covered spec pull requests sat held. This is the judge.
 *
 * WHAT IT DECIDES, AND NOTHING MORE. Whether the delegation clears the merge hold on ONE
 * open pull request at its CURRENT head. It never writes: arming auto-merge is done by
 * `dispatch-issue.sh` (`--delegated-spec-merge`), under the bot's `gh` wrapper, only after
 * `mayProceed` has also said yes to the stop classes left over from this verdict. The
 * landed spec stays `specifying`: merging is not approving. Approval is still the
 * post-merge caller's (`delegated-approval-caller.ts`), with its own independent review.
 *
 * ADMITTED, ALL OF:
 *   - the repo is not memory-fabric and has opted in (`.minspec/`); the clone is full;
 *   - the pull request is open, not a draft, and targets `main`;
 *   - every changed file is a spec's `requirements.md`
 *     (`specs/<project>/SPEC-NNN-<slug>/requirements.md`), added or modified. Any other
 *     path denies, so governance files, the constitution, the delegations file,
 *     `.minspec/`, `.github/` and `scripts/` can never ride this path;
 *   - OR (DR-121, build #3586) the diff is plan artifacts only (`design.md`/`tasks.md`)
 *     for ONE spec whose `requirements.md` is approved on the base (a non-stale approval
 *     record, status planning/implementing/done), authored and committed by the bot
 *     only, every latest check run on the head finished SUCCESS, SKIPPED or NEUTRAL
 *     (DR-121 s2.4, DR-119 item 10), and DR-121 is `accepted` on the base. Until it is, a
 *     plan artifact is refused by name (#2980). A plan is merged DIRECTLY at the judged
 *     head (`mergeMode: 'direct'`), never by native auto-merge (DR-121 s2.4, item 11),
 *     because native auto-merge waits only for the REQUIRED checks. See `planArmFacts`;
 *   - each spec's `status:` is `new` or `specifying` at the head, and on the base when the
 *     file exists there: a pull request that moves a spec's lifecycle, or edits a spec
 *     past specifying, is an approval in disguise and stays the founder's;
 *   - each spec declares a tier T1..T4;
 *   - the labels carry `ai-review:pass`, and no `ai-review:changes`,
 *     `ai-review:blocked` or `hold:*`;
 *   - an independent AI review passed on the CURRENT head (`judgeHeadReviewPass`: the
 *     check-run, the latest review comment and the CI run it was posted in, all on this
 *     head SHA), and the verdict comment is on this pull request;
 *   - `evaluateDelegation` covers the act `spec-approval` for every spec at its tier:
 *     a live, accepted, unexpired delegation for this repo, recorded under the bot, the
 *     verdict not the author's, no governance path, and the repeat-fix share known and
 *     within the tripwire;
 *   - the stop classes the bash populator derived for the diff contain
 *     `approval-or-acceptance`, and none remain once the delegation has cleared it.
 *
 * Every unreadable input denies. A wrong "no" costs one founder keystroke; a wrong "yes"
 * merges a spec nobody delegated.
 *
 * Network: `gh api` reads (GitHub) and `git fetch`. Dev-time tooling in `scripts/`, not
 * shipped (DR-086 §5); MinSpec itself makes no network call (constitution invariant 1).
 *
 *   npx tsx scripts/lib/delegated-merge.ts --pr <N> --stop-classes <csv> \
 *     [--repo owner/name] [--repo-root <dir>] [--base origin/main]
 *
 * Prints one JSON line. Exit 0 = the delegation clears the hold, 1 = it does not.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  BOT_ACTOR,
  evaluateDelegation,
  parseDelegations,
  stopClassesAfterDelegation,
  type Delegation,
  type StopClass,
  type Tier,
} from './autonomy';
import { frontmatterField, isReviewCommentUrl, reviewCommentPr } from './approval-actor';
import {
  authorIdentity,
  gatherReviewEvidence,
  judgeHeadReviewPass,
  type GhRunner,
  type ReviewEvidence,
} from './delegated-approval';
import { readRepeatFixShare, utcToday } from './repeat-fix-share';
import { specHash } from '../../packages/shared/src/canonical';

/** The only path shape this arm admits: one spec's requirements. */
export const SPEC_REQUIREMENTS_PATH = /^specs\/[^/]+\/SPEC-\d+-[^/]+\/requirements\.md$/;
/** Plan artifacts (#2980). Named separately so the denial says why. */
export const PLAN_ARTIFACT = /(^|\/)(design|tasks)\.md$/;
/**
 * DR-121 section 2.2: a plan artifact inside one spec's own directory. Group 1 is that
 * directory; a plan pull request's every path must match, all with the same group 1.
 */
export const SPEC_PLAN_PATH = /^(specs\/[^/]+\/SPEC-\d+-[^/]+)\/(design|tasks)\.md$/;
/** The decision record that admits plan pull requests; read from the base on every run. */
export const PLAN_DECISION = 'DR-121';
/** DR-121 section 2.3: the planned spec's status on the base. Anything else waits. */
export const PLAN_SPEC_APPROVED_STATUSES: ReadonlySet<string> = new Set(['planning', 'implementing', 'done']);
/** DR-119 section 1 item 10, as DR-121 section 2.4 applies it: the only green conclusions. */
export const PLAN_GREEN_CONCLUSIONS: ReadonlySet<string> = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
/** DR-119 section 1 item 2, as DR-121 section 2.4 applies it: the bot, keyed on type. */
export const PLAN_BOT_LOGIN = 'minspec-sdd[bot]';
/** A spec that has not been approved yet. Anything later is the founder's. */
export const PRE_APPROVAL_STATUSES: ReadonlySet<string> = new Set(['new', 'specifying']);
/** GitHub file statuses admitted. A removal or rename is not new spec content. */
const ADMITTED_FILE_STATUSES: ReadonlySet<string> = new Set(['added', 'modified']);
/** The one class a delegation may clear (DR-108 §1). */
export const CLEARABLE_CLASS: StopClass = 'approval-or-acceptance';
const NEVER_DELEGATED_REPO_NAMES: ReadonlySet<string> = new Set(['memory-fabric']);
const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];
const BLOCKING_LABELS: ReadonlySet<string> = new Set(['ai-review:changes', 'ai-review:blocked']);

export interface MergePull {
  readonly number: number;
  readonly state: string;
  readonly draft: boolean;
  readonly baseRef: string;
  readonly headSha: string;
  readonly headRef: string;
  readonly authorLogin: string;
  /** GitHub's `user.type` (`Bot`, `User`); undefined = not read. Plan arm only. */
  readonly authorType?: string;
  readonly labels: readonly string[];
}

/** DR-121: the planned spec as it stands on the base. null = absent, undefined = unreadable. */
export interface PlanSpecFacts {
  readonly requirements: string | null | undefined;
  readonly sidecar: string | null | undefined;
}

/** One latest check run on a commit, as GitHub reports it. */
export interface PlanCheckRun {
  readonly name: string;
  /** queued, in_progress, completed, ... */
  readonly status: string;
  /** success, failure, neutral, ...; null while not completed. */
  readonly conclusion: string | null;
}

/** DR-121 s2.4 (DR-119 item 10): every latest check run on `sha`; runs undefined = unreadable. */
export interface PlanChecks {
  readonly sha: string;
  readonly runs: readonly PlanCheckRun[] | undefined;
}

export interface MergeFile {
  readonly path: string;
  /** GitHub's file status: added, modified, removed, renamed, ... */
  readonly status: string;
  /** The file at the pull request's head, or null when it could not be read. */
  readonly headContent: string | null;
  /** The file on the base: null = absent there, undefined = could not be read. */
  readonly baseContent: string | null | undefined;
}

export interface MergeInput {
  readonly repo: string;
  readonly optedIn: boolean;
  /** `git rev-parse --is-shallow-repository`; undefined = could not be read. */
  readonly shallow: boolean | undefined;
  /** Comma-separated stop classes from `autonomy_stop_classes_for_paths`; undefined = none given. */
  readonly stopClasses: string | undefined;
  readonly pull: MergePull | undefined;
  readonly files: readonly MergeFile[] | undefined;
  readonly review: ReviewEvidence | undefined;
  /** undefined = the delegation file is absent or does not parse. */
  readonly delegations: readonly Delegation[] | undefined;
  readonly decisionStatus: (drId: string) => string | undefined;
  readonly repeatFixShare: number | undefined;
  readonly today: string;
  /** DR-121: read only when the diff holds a plan artifact; undefined = not read. */
  readonly planSpec?: PlanSpecFacts;
  /** DR-121: the author login of EVERY commit, merge commits included; '' = no linked account. */
  readonly commitAuthors?: readonly string[];
  /** DR-121: every latest check run on the head; read only for a plan diff; undefined = not read. */
  readonly planChecks?: PlanChecks;
}

export type MergePlan =
  | {
      readonly arm: true;
      readonly reason: 'covered';
      readonly detail: string;
      readonly delegationId: string;
      readonly verdictBy: string;
      readonly headSha: string;
      readonly classesAfter: readonly StopClass[];
      /**
       * How the caller merges. `auto`: arm GitHub native auto-merge (the spec arm, DR-108).
       * `direct`: merge now, pinned to `headSha`, never native auto-merge (a plan, DR-121 s2.4).
       */
      readonly mergeMode: 'auto' | 'direct';
    }
  | { readonly arm: false; readonly reason: string; readonly detail: string };

/** Comma-separated classes into a list. Empty tokens are dropped; unknown ones kept. */
export function parseStopClasses(csv: string): StopClass[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '') as StopClass[];
}

/**
 * Decide. Pure: every fact arrives as input. Fails closed at every branch.
 */
export function planDelegatedMerge(input: MergeInput): MergePlan {
  const no = (reason: string, detail: string): MergePlan => ({ arm: false, reason, detail });
  const { repo, pull, files, review } = input;

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return no('repo-unknown', `"${repo}" is not owner/name`);
  if (NEVER_DELEGATED_REPO_NAMES.has(repo.split('/')[1].toLowerCase())) {
    return no('repo-never-delegated', `${repo} is never delegated; its merges stay the founder's`);
  }
  if (!input.optedIn) return no('not-opted-in', 'no .minspec/ at the repo root: this repo has not opted in');
  if (input.shallow !== false) {
    return no('shallow-clone', 'the clone is shallow or unreadable: the repeat-fix share cannot be trusted');
  }

  if (input.stopClasses === undefined) return no('stop-classes-unknown', 'no stop classes were given for the diff');
  const classes = parseStopClasses(input.stopClasses);
  if (!classes.includes(CLEARABLE_CLASS)) {
    return no(
      'stop-classes-unexpected',
      `the diff's stop classes are "${input.stopClasses}", not ${CLEARABLE_CLASS}: this arm only clears a delegated hold`,
    );
  }

  if (pull === undefined) return no('pr-unreadable', 'the pull request could not be read');
  if (pull.state !== 'open') return no('pr-not-open', `#${pull.number} is ${pull.state}`);
  if (pull.draft) return no('pr-draft', `#${pull.number} is a draft`);
  if (pull.baseRef !== 'main') return no('pr-base-not-main', `#${pull.number} targets ${pull.baseRef}, not main`);
  if (!/^[0-9a-f]{40}$/.test(pull.headSha)) return no('pr-unreadable', `#${pull.number} has no head SHA`);

  if (files === undefined) return no('files-unreadable', `#${pull.number}'s changed files could not be read`);
  if (files.length === 0) return no('no-files', `#${pull.number} changes no files`);
  const tiers: Tier[] = [];
  const planFile = files.find((f) => PLAN_ARTIFACT.test(f.path));
  if (planFile !== undefined) {
    const planned = planArmFacts(input, pull, files, planFile.path);
    if ('arm' in planned) return planned;
    tiers.push(planned.tier);
  }
  for (const f of planFile === undefined ? files : []) {
    if (!SPEC_REQUIREMENTS_PATH.test(f.path)) {
      return no('path-out-of-scope', `${f.path} is not a spec's requirements.md; only spec content rides this arm`);
    }
    if (!ADMITTED_FILE_STATUSES.has(f.status)) {
      return no('file-status-not-admitted', `${f.path} is ${f.status || 'of unknown status'}; only added or modified spec content is admitted`);
    }
    if (f.headContent === null) return no('head-content-unreadable', `${f.path} could not be read at ${pull.headSha}`);
    const headStatus = frontmatterField(f.headContent, 'status');
    if (headStatus === undefined || !PRE_APPROVAL_STATUSES.has(headStatus)) {
      return no(
        'status-not-specifying',
        `${f.path} is status "${String(headStatus)}" at the head; only a spec that stays new or specifying merges on this delegation`,
      );
    }
    if (f.baseContent === undefined) return no('base-unreadable', `${f.path} could not be read on the base`);
    if (f.baseContent !== null) {
      const baseStatus = frontmatterField(f.baseContent, 'status');
      if (baseStatus === undefined || !PRE_APPROVAL_STATUSES.has(baseStatus)) {
        return no(
          'edits-approved-spec',
          `${f.path} is status "${String(baseStatus)}" on the base; editing a spec past specifying stays the founder's`,
        );
      }
    }
    const tier = frontmatterField(f.headContent, 'tier');
    if (tier === undefined || !TIERS.includes(tier as Tier)) {
      return no('tier-unknown', `${f.path} declares no tier T1..T4, and a tier is never invented`);
    }
    tiers.push(tier as Tier);
  }

  const held = pull.labels.filter((l) => l.startsWith('hold:'));
  if (held.length > 0) return no('held-by-label', `#${pull.number} carries ${held.join(', ')}`);
  const blocking = pull.labels.filter((l) => BLOCKING_LABELS.has(l));
  if (blocking.length > 0) return no('review-not-pass', `#${pull.number} carries ${blocking.join(', ')}`);
  if (!pull.labels.includes('ai-review:pass')) return no('review-not-pass', `#${pull.number} has no ai-review:pass label`);

  if (review === undefined) return no('no-review-evidence', 'the review evidence could not be gathered');
  if (review.pull.number !== pull.number || review.pull.headSha !== pull.headSha) {
    return no('head-moved', `the review evidence is for ${review.pull.headSha}, the pull request is at ${pull.headSha}`);
  }
  const pass = judgeHeadReviewPass(review);
  if (!pass.ok) return no(pass.reason, pass.detail);
  if (!isReviewCommentUrl(pass.url, repo) || reviewCommentPr(pass.url) !== pull.number) {
    return no('verdict-not-on-this-pr', `the pass comment ${pass.url} is not on #${pull.number}`);
  }

  if (input.delegations === undefined) {
    return no('no-delegation-record', '.minspec/delegations.json is absent or does not parse on the base');
  }
  const author = authorIdentity({ authorLogin: pull.authorLogin, headRef: pull.headRef });
  let delegationId: string | undefined;
  let after: StopClass[] = classes;
  for (const tier of tiers) {
    const verdict = evaluateDelegation(input.delegations, input.decisionStatus, {
      repo,
      act: 'spec-approval',
      tier,
      actor: BOT_ACTOR,
      author,
      verdictBy: pass.url,
      repeatFixShare: input.repeatFixShare,
      today: input.today,
      paths: files.map((f) => f.path),
    });
    if (!verdict.covered) return no(`delegation-${verdict.reason}`, verdict.detail);
    delegationId ??= verdict.delegationId;
    after = stopClassesAfterDelegation(after, verdict);
  }
  if (delegationId === undefined) return no('no-live-delegation', 'no delegation covered this pull request');
  if (after.length > 0) {
    return no('other-stop-class', `stop classes remain after the delegation: ${after.join(', ')}`);
  }
  return {
    arm: true,
    reason: 'covered',
    detail: `covered by ${delegationId} at ${pull.headSha}; verdict ${pass.url}`,
    delegationId,
    verdictBy: pass.url,
    headSha: pull.headSha,
    classesAfter: after,
    mergeMode: planFile === undefined ? 'auto' : 'direct',
  };
}

/**
 * DR-121 section 2, conditions 1 to 4's plan-specific half. Returns the planned spec's
 * tier, or a denial. The shared half (labels, the head-bound review, the delegation and
 * its tripwire) is the spec arm's own code after this returns, so the two arms cannot
 * drift on it. Every unreadable fact denies.
 */
function planArmFacts(
  input: MergeInput,
  pull: MergePull,
  files: readonly MergeFile[],
  firstPlanPath: string,
): { readonly tier: Tier } | MergePlan {
  const no = (reason: string, detail: string): MergePlan => ({ arm: false, reason, detail });
  if (input.decisionStatus(PLAN_DECISION) !== 'accepted') {
    return no(
      'plan-artifact',
      `${firstPlanPath} is a plan artifact (#2980) and ${PLAN_DECISION} is not accepted on the base; plan pull requests are not merged on this delegation`,
    );
  }
  // 2.2: plan artifacts only, all in one spec's directory.
  const dirs = new Set<string>();
  for (const f of files) {
    const m = SPEC_PLAN_PATH.exec(f.path);
    if (m === null) {
      return no('plan-mixed-diff', `${f.path} is not a spec's design.md or tasks.md; a plan pull request changes plan artifacts only (${PLAN_DECISION} s2.2)`);
    }
    dirs.add(m[1]);
  }
  if (dirs.size !== 1) {
    return no('plan-mixed-diff', `the plan artifacts span ${dirs.size} specs; a plan pull request plans one spec (${PLAN_DECISION} s2.2)`);
  }
  for (const f of files) {
    if (!ADMITTED_FILE_STATUSES.has(f.status)) {
      return no('file-status-not-admitted', `${f.path} is ${f.status || 'of unknown status'}; only added or modified plan artifacts are admitted`);
    }
    if (f.headContent === null) return no('head-content-unreadable', `${f.path} could not be read at ${pull.headSha}`);
  }
  // 2.3: the spec it plans is approved on the base, and the approval is not stale.
  const reqPath = `${[...dirs][0]}/requirements.md`;
  const facts = input.planSpec;
  if (facts === undefined || facts.requirements === undefined) {
    return no('base-unreadable', `${reqPath} could not be read on the base`);
  }
  if (facts.requirements === null) {
    return no('plan-spec-not-approved', `${reqPath} does not exist on the base; a plan waits for its approved spec`);
  }
  const status = frontmatterField(facts.requirements, 'status');
  if (status === undefined || !PLAN_SPEC_APPROVED_STATUSES.has(status)) {
    return no('plan-spec-not-approved', `${reqPath} is status "${String(status)}" on the base; a plan merges only once its spec is planning, implementing or done`);
  }
  if (facts.sidecar === undefined) return no('base-unreadable', `the approval record for ${reqPath} could not be read on the base`);
  if (facts.sidecar === null) {
    return no('plan-spec-not-approved', `${reqPath} has no approval record on the base; a plan waits for its approved spec`);
  }
  let record: { specPath?: unknown; specHash?: unknown };
  try {
    record = JSON.parse(facts.sidecar) as { specPath?: unknown; specHash?: unknown };
  } catch {
    return no('plan-spec-approval-unreadable', `the approval record for ${reqPath} does not parse`);
  }
  if (record === null || typeof record !== 'object') {
    return no('plan-spec-approval-unreadable', `the approval record for ${reqPath} is not an object`);
  }
  if (record.specPath !== reqPath || record.specHash !== specHash(facts.requirements)) {
    return no('plan-spec-approval-stale', `the approval record does not match ${reqPath} as it stands on the base (stale or for another spec)`);
  }
  const tier = frontmatterField(facts.requirements, 'tier');
  if (tier === undefined || !TIERS.includes(tier as Tier)) {
    return no('tier-unknown', `${reqPath} declares no tier T1..T4, and a tier is never invented`);
  }
  // 2.4: the bot's pull request, every commit the bot's (DR-119 s1 item 2). A merge commit
  // by anyone else denies too: what it brought in is not checked path by path here.
  if (pull.authorType !== 'Bot' || pull.authorLogin !== PLAN_BOT_LOGIN) {
    return no('plan-author-not-bot', `#${pull.number} is authored by ${pull.authorLogin} (${String(pull.authorType)}), not ${PLAN_BOT_LOGIN} (Bot)`);
  }
  const commits = input.commitAuthors;
  if (commits === undefined || commits.length === 0) {
    return no('plan-commit-not-bot', `#${pull.number}'s commits could not be read`);
  }
  const strays = commits.filter((a) => a !== PLAN_BOT_LOGIN);
  if (strays.length > 0) {
    return no('plan-commit-not-bot', `#${pull.number} has ${strays.length} commit(s) not by ${PLAN_BOT_LOGIN}: ${[...new Set(strays.map((a) => a || '<no account>'))].join(', ')}`);
  }
  // 2.4 (DR-119 item 10): CI green on the head - EVERY latest check run, required or not,
  // because a plan is merged directly and nothing else waits on an optional check. Zero,
  // unreadable, pending or any other conclusion denies; the next drain cycle retries.
  const checks = input.planChecks;
  if (checks === undefined || checks.runs === undefined || checks.sha !== pull.headSha) {
    return no('plan-ci-unreadable', `the check runs on ${pull.headSha} could not be read`);
  }
  if (checks.runs.length === 0) {
    return no('plan-ci-none', `no check run has reported on ${pull.headSha}; zero checks is not green (${PLAN_DECISION} s2.4)`);
  }
  const pending = checks.runs.filter((c) => c.status !== 'completed');
  if (pending.length > 0) {
    return no('plan-ci-pending', `${pending.length} check run(s) on ${pull.headSha} have not finished: ${pending.map((c) => c.name || '<unnamed>').join(', ')}`);
  }
  const red = checks.runs.filter((c) => !PLAN_GREEN_CONCLUSIONS.has(String(c.conclusion ?? '').toUpperCase()));
  if (red.length > 0) {
    return no(
      'plan-ci-not-green',
      `check run(s) on ${pull.headSha} did not finish SUCCESS, SKIPPED or NEUTRAL: ${red.map((c) => `${c.name || '<unnamed>'}=${String(c.conclusion)}`).join(', ')} (${PLAN_DECISION} s2.4)`,
    );
  }
  return { tier: tier as Tier };
}

// ─── IO: gathering the facts ────────────────────────────────────────────────

type Json = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface MergeDeps {
  readonly gh: GhRunner;
  /** `git -C repoRoot ...`. Throws on a non-zero exit. */
  readonly git: (args: readonly string[]) => string;
  readonly repeatFixShare: (base: string) => number | undefined;
  readonly today: () => string;
  readonly exists: (rel: string) => boolean;
}

export interface MergeArgs {
  readonly pr: number;
  readonly repo: string;
  readonly base: string;
  readonly stopClasses: string;
}

/** Read every fact. Never throws: each unreadable fact becomes `undefined`/null and denies. */
export function gatherMergeInput(args: MergeArgs, deps: MergeDeps): MergeInput {
  const { pr, repo, base } = args;
  const show = (rel: string): string | null | undefined => {
    try {
      deps.git(['cat-file', '-e', `${base}:${rel}`]);
    } catch {
      return null;
    }
    try {
      return deps.git(['show', `${base}:${rel}`]);
    } catch {
      return undefined;
    }
  };

  let shallow: boolean | undefined;
  try {
    const out = deps.git(['rev-parse', '--is-shallow-repository']).trim();
    shallow = out === 'false' ? false : out === 'true' ? true : undefined;
  } catch {
    shallow = undefined;
  }
  let baseOk = true;
  try {
    if (base.startsWith('origin/')) deps.git(['fetch', '--quiet', 'origin', base.slice('origin/'.length)]);
    deps.git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    baseOk = false;
  }

  let pull: MergePull | undefined;
  try {
    const p = JSON.parse(deps.gh([`repos/${repo}/pulls/${pr}`])) as Json;
    const head = (p.head ?? {}) as Json;
    const baseRef = (p.base ?? {}) as Json;
    pull = {
      number: pr,
      state: s(p.state),
      draft: p.draft === true,
      baseRef: s(baseRef.ref),
      headSha: s(head.sha),
      headRef: s(head.ref),
      authorLogin: s((p.user as Json | null)?.login),
      authorType: s((p.user as Json | null)?.type) || undefined,
      labels: ((p.labels ?? []) as Json[]).map((l) => s(l.name)),
    };
  } catch {
    pull = undefined;
  }

  let files: MergeFile[] | undefined;
  if (pull !== undefined && /^[0-9a-f]{40}$/.test(pull.headSha)) {
    try {
      const rows: Json[] = [];
      for (let page = 1; ; page++) {
        if (page > 30) throw new Error('more than 30 pages of files');
        const items = JSON.parse(deps.gh([`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`])) as Json[];
        if (!Array.isArray(items)) throw new Error('not a list');
        rows.push(...items);
        if (items.length < 100) break;
      }
      const headSha = pull.headSha;
      files = rows.map((f) => {
        const rel = s(f.filename);
        let headContent: string | null;
        try {
          headContent = deps.gh([
            '-H',
            'Accept: application/vnd.github.raw',
            `repos/${repo}/contents/${rel.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`,
          ]);
        } catch {
          headContent = null;
        }
        return { path: rel, status: s(f.status), headContent, baseContent: baseOk ? show(rel) : undefined };
      });
    } catch {
      files = undefined;
    }
  }

  let review: ReviewEvidence | undefined;
  const first = files?.[0]?.path;
  if (first !== undefined) {
    try {
      review = gatherReviewEvidence(repo, pr, first, deps.gh);
    } catch {
      review = undefined;
    }
  }

  // DR-121: the planned spec on the base, and every commit's author. Read only for a diff
  // that holds a plan artifact, so the spec arm's reads are unchanged.
  let planSpec: PlanSpecFacts | undefined;
  let commitAuthors: string[] | undefined;
  let planChecks: PlanChecks | undefined;
  const planDir = files?.map((f) => SPEC_PLAN_PATH.exec(f.path)?.[1]).find((d) => d !== undefined);
  if (planDir !== undefined) {
    const reqPath = `${planDir}/requirements.md`;
    planSpec = baseOk
      ? { requirements: show(reqPath), sidecar: show(`.minspec/approvals/${reqPath}.json`) }
      : { requirements: undefined, sidecar: undefined };
    try {
      const rows: Json[] = [];
      for (let page = 1; ; page++) {
        // GitHub lists at most 250 commits on a pull request; more is unreadable here.
        if (page > 3) throw new Error('more than 250 commits');
        const items = JSON.parse(deps.gh([`repos/${repo}/pulls/${pr}/commits?per_page=100&page=${page}`])) as Json[];
        if (!Array.isArray(items)) throw new Error('not a list');
        rows.push(...items);
        if (items.length < 100) break;
      }
      commitAuthors = rows.map((c) => s((c.author as Json | null)?.login));
    } catch {
      commitAuthors = undefined;
    }
    // DR-121 s2.4: every LATEST check run on the head (filter=latest drops superseded
    // re-runs). A short read (fewer rows than total_count) is unreadable, never a pass.
    const headSha = pull?.headSha ?? '';
    let runs: PlanCheckRun[] | undefined;
    try {
      if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('no head sha');
      const rows: Json[] = [];
      let total = -1;
      for (let page = 1; ; page++) {
        if (page > 10) throw new Error('more than 10 pages of check runs');
        const body = JSON.parse(
          deps.gh([`repos/${repo}/commits/${headSha}/check-runs?filter=latest&per_page=100&page=${page}`]),
        ) as Json;
        const items = body?.check_runs;
        if (!Array.isArray(items) || typeof body.total_count !== 'number') throw new Error('not a check-run list');
        total = body.total_count;
        rows.push(...(items as Json[]));
        if (items.length < 100 || rows.length >= total) break;
      }
      if (rows.length !== total) throw new Error(`read ${rows.length} of ${total} check runs`);
      runs = rows.map((c) => ({
        name: s(c.name),
        status: s(c.status),
        conclusion: typeof c.conclusion === 'string' ? c.conclusion : null,
      }));
    } catch {
      runs = undefined;
    }
    planChecks = { sha: headSha, runs };
  }

  const delegationsText = baseOk ? show('.minspec/delegations.json') : undefined;
  const delegations = typeof delegationsText === 'string' ? parseDelegations(delegationsText) : undefined;
  const decisionStatus = (id: string): string | undefined => {
    if (!baseOk || !/^DR-\d+$/.test(id)) return undefined;
    const t = show(`docs/decisions/${id}.md`);
    return typeof t === 'string' ? frontmatterField(t, 'status') : undefined;
  };

  return {
    repo,
    optedIn: deps.exists('.minspec'),
    shallow,
    stopClasses: args.stopClasses,
    pull,
    files,
    review,
    delegations,
    decisionStatus,
    repeatFixShare: baseOk ? deps.repeatFixShare(base) : undefined,
    today: deps.today(),
    planSpec,
    commitAuthors,
    planChecks,
  };
}

// ─── the CLI ────────────────────────────────────────────────────────────────

export interface CliOptions extends MergeArgs {
  readonly repoRoot: string;
}

/** Strict argv parse. Any unknown flag or missing value is a usage error, never a guess. */
export function parseMergeArgs(argv: readonly string[], cwd: string): CliOptions | string {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!['--pr', '--repo', '--repo-root', '--base', '--stop-classes'].includes(k)) return `unknown argument: ${k}`;
    const val = argv[i + 1];
    // `--stop-classes ''` is a legal value (no classes), so only a missing value or the
    // next flag is a usage error.
    if (val === undefined || val.startsWith('--')) return `${k} needs a value`;
    v[k.slice(2)] = val;
    i++;
  }
  if (v.pr === undefined || !/^[1-9]\d*$/.test(v.pr)) return '--pr must be a positive integer';
  if (v['stop-classes'] === undefined) return '--stop-classes is required (the populator\'s output for this diff)';
  return {
    pr: Number(v.pr),
    repo: v.repo ?? 'AIClarityAU/minspec',
    repoRoot: path.resolve(v['repo-root'] ?? cwd),
    base: v.base ?? 'origin/main',
    stopClasses: v['stop-classes'],
  };
}

export function realMergeDeps(repoRoot: string): MergeDeps {
  return {
    gh: (args) =>
      execFileSync('gh', ['api', ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    git: (args) =>
      execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }),
    repeatFixShare: (base) => readRepeatFixShare(repoRoot, base).share,
    today: utcToday,
    exists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
  };
}

if (/(^|[\\/])delegated-merge\.ts$/.test(process.argv[1] ?? '')) {
  let code = 1;
  try {
    const opts = parseMergeArgs(process.argv.slice(2), process.cwd());
    if (typeof opts === 'string') {
      console.log(JSON.stringify({ arm: false, reason: 'cli-usage', detail: opts }));
    } else {
      const plan = planDelegatedMerge(gatherMergeInput(opts, realMergeDeps(opts.repoRoot)));
      console.log(JSON.stringify({ pr: opts.pr, ...plan }));
      code = plan.arm ? 0 : 1;
    }
  } catch (err) {
    console.log(JSON.stringify({ arm: false, reason: 'errored', detail: String(err).split('\n')[0] }));
    code = 1;
  }
  process.exit(code);
}
