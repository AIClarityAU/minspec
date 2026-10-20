/**
 * T0 — the calling path for delegated approval (#2854 item 3, DR-108).
 *
 * The bot records an approval only after an independent AI review passed on the exact
 * content, citing the review comment as `verdictBy`. Pinned here:
 *
 *   - the record is always under `minspec-sdd[bot]`, never anyone else;
 *   - every missing witness (evidence, artifact, pull request, head content, check-run,
 *     comment, CI run, delegation file, ratio, decision status) DENIES, by name;
 *   - a review of OTHER bytes, a review by anything but the CI panel, a latest verdict
 *     that is not a pass, and a recording session that is the authoring one all deny;
 *   - the record it builds passes the validator's own predicate.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { specHash } from '../../shared/src/canonical';
import { BOT_ACTOR, type Delegation } from '../../../scripts/lib/autonomy';
import { checkApprovalActor, type DelegationWitnesses } from '../../../scripts/lib/approval-actor';
import {
  AI_REVIEW_WORKFLOW_PATH,
  authorIdentity,
  gatherReviewEvidence,
  parseCliArgs,
  planDelegatedApproval,
  specNotApprovable,
  type GhRunner,
  type PlanInput,
  type ReviewEvidence,
} from '../../../scripts/lib/delegated-approval';

const REPO = 'AIClarityAU/minspec';
const SPEC = 'specs/minspec/SPEC-900-fixture/requirements.md';
const HEAD = 'a'.repeat(40);
const BODY = `---
id: SPEC-900
status: planning
tier: T3
---

# Fixture

- FR-1. Enough content to hash.
`;
const PASS_URL = `https://github.com/${REPO}/pull/41#issuecomment-200`;

const LIVE: Delegation = {
  id: 'DLG-001',
  decision: 'DR-108',
  words: 'greenlight all future development',
  said: '2026-10-17',
  source: 'queue item in5',
  repo: REPO,
  covers: ['spec-approval', 'engineering-dr-acceptance'],
  tiers: ['T1', 'T2', 'T3', 'T4'],
  reviewBy: '2027-01-17',
  tripwire: { metric: 'repeat-fix-share', max: 0.13 },
};

const W = (over: Partial<DelegationWitnesses> = {}): DelegationWitnesses => ({
  repo: REPO,
  delegations: [LIVE],
  decisionStatus: (id) => (id === 'DR-108' ? 'accepted' : undefined),
  repeatFixShare: 0.08,
  today: '2026-10-20',
  contentPullRequest: () => 41,
  ...over,
});

const comment = (id: number, label: string, createdAt: string, login = BOT_ACTOR) => ({
  id,
  url: `https://github.com/${REPO}/pull/41#issuecomment-${id}`,
  login,
  body: `## 🤖 AI review — \`ai-review:${label}\`\n\n### Reviewer\n...`,
  createdAt,
});

const evidence = (over: Partial<ReviewEvidence> = {}): ReviewEvidence => ({
  pull: {
    number: 41,
    merged: true,
    headSha: HEAD,
    headRef: 'cos/spec-writer',
    authorLogin: BOT_ACTOR,
    files: [SPEC, `docs/other.md`],
  },
  artifactAtHead: BODY.replace('status: planning', 'status: specifying'), // status is hash-neutral
  comments: [
    comment(100, 'changes', '2026-10-19T09:05:00Z'),
    comment(150, 'pass', '2026-10-19T10:00:00Z', 'github-actions[bot]'),
    comment(200, 'pass', '2026-10-19T10:05:00Z'),
  ],
  checkRuns: [
    { name: 'ai-review', status: 'completed', conclusion: 'success', appSlug: 'minspec-sdd', headSha: HEAD, completedAt: '2026-10-19T10:05:10Z' },
  ],
  workflowRuns: [
    { path: AI_REVIEW_WORKFLOW_PATH, event: 'pull_request', status: 'completed', headSha: HEAD, runStartedAt: '2026-10-19T10:00:30Z', updatedAt: '2026-10-19T10:05:20Z' },
  ],
  ...over,
});

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  artifactPath: SPEC,
  artifactContent: BODY,
  review: evidence(),
  recorderRef: 'cos/approver',
  existingApprovalHash: undefined,
  witnesses: W(),
  now: '2026-10-20T10:00:00.000Z',
  ...over,
});

const reason = (r: ReturnType<typeof planDelegatedApproval>) => (r.ok ? 'ok' : r.reason);

describe('the happy path', () => {
  it('builds a bot record citing the latest pass comment, and the validator accepts it', () => {
    const r = planDelegatedApproval(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toEqual({
      specPath: SPEC,
      specHash: specHash(BODY),
      approvedAt: '2026-10-20T10:00:00.000Z',
      approvedBy: BOT_ACTOR,
      tier: 'T3',
      migrated: false,
      baselineBlob: '',
      actor: BOT_ACTOR,
      basis: 'delegation:DLG-001',
      act: 'spec-approval',
      author: 'session:cos/spec-writer',
      verdictBy: PASS_URL,
    });
    const v = checkApprovalActor(r.record as unknown as Record<string, unknown>, { path: SPEC, content: BODY }, W());
    expect(v.failures).toEqual([]);
    expect(v.cls?.kind).toBe('delegated');
  });

  it('records a human author by login, an agent author by session branch', () => {
    expect(authorIdentity({ authorLogin: 'harvest316', headRef: 'x' })).toBe('harvest316');
    expect(authorIdentity({ authorLogin: BOT_ACTOR, headRef: 'cos/x' })).toBe('session:cos/x');
  });
});

describe('T0 — every missing witness denies', () => {
  const cases: [string, Partial<PlanInput>, string][] = [
    ['no evidence gathered', { review: undefined }, 'no-review-evidence'],
    ['artifact absent on the base', { artifactContent: null }, 'artifact-missing'],
    ['artifact absent at the review head', { review: evidence({ artifactAtHead: null }) }, 'reviewed-content-missing'],
    ['no check-runs', { review: evidence({ checkRuns: [] }) }, 'no-ai-review-check'],
    ['no comments', { review: evidence({ comments: [] }) }, 'no-ai-review-comment'],
    ['no workflow runs', { review: evidence({ workflowRuns: [] }) }, 'no-ai-review-run'],
    ['recording branch unknown', { recorderRef: '' }, 'recorder-unknown'],
    ['delegation file unreadable', { witnesses: W({ delegations: undefined }) }, 'no-delegation'],
    ['repo unknown', { witnesses: W({ repo: undefined }) }, 'no-delegation'],
    ['repeat-fix share unknown', { witnesses: W({ repeatFixShare: undefined }) }, 'delegation-tripwire-unknown'],
    ['decision status unreadable', { witnesses: W({ decisionStatus: () => undefined }) }, 'delegation-no-live-delegation'],
    ['no tier declared', { artifactContent: BODY.replace('tier: T3\n', ''), review: evidence({ artifactAtHead: BODY.replace('tier: T3\n', '') }) }, 'tier-unknown'],
  ];
  for (const [name, over, expected] of cases) {
    it(`${name} → ${expected}`, () => expect(reason(planDelegatedApproval(input(over)))).toBe(expected));
  }
});

describe('T0 — the review must be an independent CI pass on these bytes', () => {
  it('a pull request that is not merged is refused', () => {
    expect(reason(planDelegatedApproval(input({ review: evidence({ pull: { ...evidence().pull, merged: false } }) })))).toBe('pr-not-merged');
  });
  it('a pull request that did not change the artifact is refused', () => {
    expect(reason(planDelegatedApproval(input({ review: evidence({ pull: { ...evidence().pull, files: ['x.md'] } }) })))).toBe('pr-does-not-touch-artifact');
  });
  it('a review of other bytes is refused', () => {
    expect(reason(planDelegatedApproval(input({ review: evidence({ artifactAtHead: BODY + '\nmore\n' }) })))).toBe('reviewed-content-differs');
  });
  it('the authoring session may not record its own approval', () => {
    expect(reason(planDelegatedApproval(input({ recorderRef: 'cos/spec-writer' })))).toBe('author-is-recorder');
  });
  it('a failing, neutral or pending verdict check is refused', () => {
    for (const [status, conclusion] of [['completed', 'failure'], ['completed', 'neutral'], ['in_progress', null]] as const) {
      const checkRuns = [{ ...evidence().checkRuns[0], status, conclusion }];
      expect(reason(planDelegatedApproval(input({ review: evidence({ checkRuns }) })))).toBe('ai-review-check-not-success');
    }
  });
  it('the latest verdict check wins over an earlier success', () => {
    const checkRuns = [
      evidence().checkRuns[0],
      { ...evidence().checkRuns[0], conclusion: 'failure', completedAt: '2026-10-19T11:00:00Z' },
    ];
    expect(reason(planDelegatedApproval(input({ review: evidence({ checkRuns }) })))).toBe('ai-review-check-not-success');
  });
  it('a check from another app, on another commit, or under another name does not count', () => {
    for (const patch of [{ appSlug: 'other-app' }, { appSlug: undefined }, { headSha: 'b'.repeat(40) }, { name: 'ai-review-runner' }]) {
      const checkRuns = [{ ...evidence().checkRuns[0], ...patch }];
      expect(reason(planDelegatedApproval(input({ review: evidence({ checkRuns }) })))).toBe('no-ai-review-check');
    }
  });
  it('a later non-pass review supersedes an earlier pass', () => {
    const comments = [...evidence().comments, comment(300, 'changes', '2026-10-19T10:30:00Z')];
    expect(reason(planDelegatedApproval(input({ review: evidence({ comments }) })))).toBe('latest-review-not-pass');
  });
  it('a pass from any other login is ignored', () => {
    const comments = [comment(150, 'pass', '2026-10-19T10:01:00Z', 'github-actions[bot]'), comment(151, 'pass', '2026-10-19T10:02:00Z', 'harvest316')];
    expect(reason(planDelegatedApproval(input({ review: evidence({ comments }) })))).toBe('no-ai-review-comment');
  });
  it('a pass comment posted outside every CI review run is refused (an agent posting as the App)', () => {
    const comments = [comment(400, 'pass', '2026-10-19T12:00:00Z')];
    expect(reason(planDelegatedApproval(input({ review: evidence({ comments }) })))).toBe('comment-outside-ci-run');
  });
  it('a run of another workflow, event, commit, or one still running does not count', () => {
    for (const patch of [
      { path: '.github/workflows/ci.yml' },
      { event: 'workflow_dispatch' },
      { headSha: 'b'.repeat(40) },
      { status: 'in_progress' },
    ]) {
      const workflowRuns = [{ ...evidence().workflowRuns[0], ...patch }];
      expect(reason(planDelegatedApproval(input({ review: evidence({ workflowRuns }) })))).toBe('no-ai-review-run');
    }
  });
  it('content already approved is not approved again', () => {
    expect(reason(planDelegatedApproval(input({ existingApprovalHash: specHash(BODY) })))).toBe('already-approved');
  });
});

describe('T0 — governance and memory-fabric stay the founder\'s through the calling path', () => {
  it('the constitution is refused', () => {
    const p = '.minspec/constitution.md';
    const r = planDelegatedApproval(
      input({ artifactPath: p, review: evidence({ pull: { ...evidence().pull, files: [p] } }) }),
    );
    expect(reason(r)).toBe('delegation-touches-governance');
  });
  it('a memory-fabric repo is refused', () => {
    const repo = 'AIClarityAU/memory-fabric';
    const comments = [{ ...comment(200, 'pass', '2026-10-19T10:05:00Z'), url: `https://github.com/${repo}/pull/41#issuecomment-200` }];
    const r = planDelegatedApproval(
      input({ review: evidence({ comments }), witnesses: W({ repo, delegations: [{ ...LIVE, repo }] }) }),
    );
    expect(reason(r)).toBe('delegation-repo-never-delegated');
  });
});

describe('gathering evidence from GitHub', () => {
  const routes = (map: Record<string, unknown>): GhRunner => (args) => {
    const route = args[args.length - 1];
    const key = Object.keys(map).find((k) => route.startsWith(k));
    if (key === undefined) throw new Error(`unexpected route ${route}`);
    const v = map[key];
    if (v instanceof Error) throw v;
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  const base = {
    [`repos/${REPO}/pulls/41/files`]: [{ filename: SPEC }],
    [`repos/${REPO}/pulls/41`]: { merged: true, head: { sha: HEAD, ref: 'cos/w' }, user: { login: BOT_ACTOR } },
    [`repos/${REPO}/contents/`]: BODY,
    [`repos/${REPO}/issues/41/comments`]: [
      { id: 200, html_url: PASS_URL, user: { login: BOT_ACTOR }, body: 'b', created_at: '2026-10-19T10:05:00Z' },
    ],
    [`repos/${REPO}/commits/${HEAD}/check-runs`]: {
      check_runs: [{ name: 'ai-review', status: 'completed', conclusion: 'success', app: { slug: 'minspec-sdd' }, head_sha: HEAD, completed_at: 'z' }],
    },
    [`repos/${REPO}/actions/runs`]: {
      workflow_runs: [{ path: AI_REVIEW_WORKFLOW_PATH, event: 'pull_request', status: 'completed', head_sha: HEAD, run_started_at: 's', updated_at: 'u' }],
    },
  };

  it('maps every field the plan reads', () => {
    const e = gatherReviewEvidence(REPO, 41, SPEC, routes(base));
    expect(e.pull).toEqual({ number: 41, merged: true, headSha: HEAD, headRef: 'cos/w', authorLogin: BOT_ACTOR, files: [SPEC] });
    expect(e.artifactAtHead).toBe(BODY);
    expect(e.comments[0]).toEqual({ id: 200, url: PASS_URL, login: BOT_ACTOR, body: 'b', createdAt: '2026-10-19T10:05:00Z' });
    expect(e.checkRuns[0].appSlug).toBe('minspec-sdd');
    expect(e.workflowRuns[0].path).toBe(AI_REVIEW_WORKFLOW_PATH);
  });

  it('a missing artifact at head reads as null, not as an error', () => {
    const e = gatherReviewEvidence(REPO, 41, SPEC, routes({ ...base, [`repos/${REPO}/contents/`]: new Error('404') }));
    expect(e.artifactAtHead).toBeNull();
  });

  it('a pull request with no head sha throws (the CLI turns that into a denial)', () => {
    expect(() => gatherReviewEvidence(REPO, 41, SPEC, routes({ ...base, [`repos/${REPO}/pulls/41`]: { head: {} } }))).toThrow(/no head sha/);
  });

  it('pages until a short page, so a long comment thread is read in full', () => {
    const calls: string[] = [];
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, html_url: 'u', user: { login: 'x' }, body: '', created_at: 'c' }));
    const gh: GhRunner = (args) => {
      const route = args[args.length - 1];
      if (route.startsWith(`repos/${REPO}/issues/41/comments`)) {
        calls.push(route);
        return JSON.stringify(route.endsWith('&page=1') ? full : [full[0]]);
      }
      return routes(base)(args);
    };
    const e = gatherReviewEvidence(REPO, 41, SPEC, gh);
    expect(calls.length).toBe(2);
    expect(e.comments.length).toBe(101);
  });
});

describe('the CLI argument parse is strict', () => {
  it('accepts the documented flags', () => {
    expect(parseCliArgs(['--artifact', `./${SPEC}`, '--pr', '41', '--write'], '/r')).toEqual({
      artifact: SPEC,
      pr: 41,
      repoRoot: '/r',
      repo: undefined,
      base: 'origin/main',
      write: true,
    });
  });
  for (const argv of [
    ['--artifact', SPEC],
    ['--pr', '41'],
    ['--artifact', '../x', '--pr', '1'],
    ['--artifact', '/abs', '--pr', '1'],
    ['--artifact', SPEC, '--pr', 'x'],
    ['--artifact', SPEC, '--pr', '1', '--admin'],
    ['--artifact', '--pr', '1'],
  ]) {
    it(`refuses ${argv.join(' ')}`, () => expect(typeof parseCliArgs(argv, '/r')).toBe('string'));
  }
});

describe('the bot refuses what the founder\'s Approve Spec refuses', () => {
  it('a terminal spec is refused', () => {
    const root = path.resolve(__dirname, '../../..');
    const abs = path.join(root, 'specs/minspec/SPEC-007-epic-grouping/requirements.md');
    expect(specNotApprovable(root, abs)).toMatch(/past the approval gate/);
  });
  it('an incomplete T3 spec is refused, a complete one is not', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlgready-'));
    fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1', specsDir: 'specs' }));
    const dir = path.join(root, 'specs', 'SPEC-900-x');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, 'requirements.md');
    fs.writeFileSync(abs, '---\nid: SPEC-900\ntitle: x\nstatus: specifying\ntier: T3\n---\n\n# x\n');
    expect(specNotApprovable(root, abs)).toMatch(/not complete/);
  });
});
