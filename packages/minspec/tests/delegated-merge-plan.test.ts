/**
 * T3 - DR-121 (plan artifacts merge on AI review once their spec is approved), build #3586.
 *
 * Regression for #2872 / #2980: DR-121 was accepted on 2026-11-11, but the judge still
 * refused every plan pull request by name, so 27 plan PRs whose specs were approved on main
 * sat held and the drain judged "0 armed of 8" while it starved (2026-11-14). Each test
 * below is one condition of DR-121 section 2; every one but the covered case must DENY.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type Delegation } from '../../../scripts/lib/autonomy';
import { type ReviewEvidence } from '../../../scripts/lib/delegated-approval';
import { specHash } from '../../../packages/shared/src/canonical';
import {
  gatherMergeInput,
  planDelegatedMerge,
  type MergeDeps,
  type MergeFile,
  type MergeInput,
  type MergePull,
  type PlanCheckRun,
} from '../../../scripts/lib/delegated-merge';

const REPO = 'AIClarityAU/minspec';
const PR = 3280;
const HEAD = 'b'.repeat(40);
const DIR = 'specs/minspec/SPEC-066-managed-prose-vantage';
const REQ = `${DIR}/requirements.md`;
const DESIGN = `${DIR}/design.md`;
const TASKS = `${DIR}/tasks.md`;
const SIDECAR = `.minspec/approvals/${REQ}.json`;
const VERDICT_URL = `https://github.com/${REPO}/pull/${PR}#issuecomment-222`;
const BOT = 'minspec-sdd[bot]';

const req = (status = 'planning', tier = 'T3') =>
  `---\nid: SPEC-066\ntitle: x\nstatus: ${status}\ntier: ${tier}\n---\n\n# Requirements\n\nFR-1 something.\n`;
const sidecar = (content = req(), over: Record<string, unknown> = {}) =>
  JSON.stringify({ specPath: REQ, specHash: specHash(content), approvedBy: 'github@harvest316.com', tier: 'T3', ...over });

const DLG: Delegation = {
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

function review(headSha = HEAD): ReviewEvidence {
  return {
    pull: { number: PR, merged: false, headSha, headRef: 'cos/plan-b-1028', authorLogin: BOT, files: [DESIGN, TASKS] },
    artifactAtHead: '# Design\n',
    comments: [
      { id: 222, url: VERDICT_URL, login: BOT, body: '## 🤖 AI review — `ai-review:pass`\n\nOK.', createdAt: '2026-11-01T01:00:30Z' },
    ],
    checkRuns: [
      { name: 'ai-review', status: 'completed', conclusion: 'success', appSlug: 'minspec-sdd', headSha, completedAt: '2026-11-01T01:01:00Z' },
    ],
    workflowRuns: [
      {
        path: '.github/workflows/ai-review.yml',
        event: 'pull_request',
        status: 'completed',
        headSha,
        runStartedAt: '2026-11-01T01:00:00Z',
        updatedAt: '2026-11-01T01:01:00Z',
      },
    ],
  };
}

const pull = (over: Partial<MergePull> = {}): MergePull => ({
  number: PR,
  state: 'open',
  draft: false,
  baseRef: 'main',
  headSha: HEAD,
  headRef: 'cos/plan-b-1028',
  authorLogin: BOT,
  authorType: 'Bot',
  labels: ['ai-review:pass', 'awaiting-approval'],
  ...over,
});

const pf = (path: string, over: Partial<MergeFile> = {}): MergeFile => ({
  path,
  status: 'added',
  headContent: '# plan\n',
  baseContent: null,
  ...over,
});

const run = (name: string, conclusion: string | null, status = 'completed'): PlanCheckRun => ({ name, status, conclusion });
/** Every latest check on the head green, one of each admitted conclusion (DR-119 item 10). */
const GREEN: PlanCheckRun[] = [run('test', 'success'), run('docs-only', 'skipped'), run('advisory', 'neutral'), run('ai-review', 'success')];

const decisions: Record<string, string> = { 'DR-108': 'accepted', 'DR-121': 'accepted' };

function input(over: Partial<MergeInput> = {}): MergeInput {
  return {
    repo: REPO,
    optedIn: true,
    shallow: false,
    stopClasses: 'approval-or-acceptance',
    pull: pull(),
    files: [pf(DESIGN), pf(TASKS)],
    review: review(),
    delegations: [DLG],
    decisionStatus: (id) => decisions[id],
    repeatFixShare: 0.08,
    today: '2026-11-14',
    planSpec: { requirements: req(), sidecar: sidecar() },
    commitAuthors: [BOT, BOT],
    planChecks: { sha: HEAD, runs: GREEN },
    ...over,
  };
}

const reasonOf = (i: MergeInput) => {
  const p = planDelegatedMerge(i);
  return p.arm ? 'ARMED' : p.reason;
};

describe('DR-121 covered case (#2872 regression)', () => {
  it('a plan-only PR for an approved spec, with a pass on its head, is cleared and bound to that head', () => {
    expect(planDelegatedMerge(input())).toMatchObject({ arm: true, delegationId: 'DLG-001', headSha: HEAD, verdictBy: VERDICT_URL, classesAfter: [] });
  });
  it('a cleared plan is merged directly, never by native auto-merge (DR-121 s2.4, item 11)', () => {
    expect(planDelegatedMerge(input())).toMatchObject({ arm: true, mergeMode: 'direct' });
  });
  it.each(['planning', 'implementing', 'done'])('spec status %s on the base is admitted', (st) => {
    const c = req(st);
    expect(reasonOf(input({ planSpec: { requirements: c, sidecar: sidecar(c) } }))).toBe('ARMED');
  });
  it('a single modified tasks.md is admitted', () => {
    expect(reasonOf(input({ files: [pf(TASKS, { status: 'modified', baseContent: '# old\n' })] }))).toBe('ARMED');
  });
});

describe('DR-121 s2.1: the record must be accepted on main', () => {
  it.each([undefined, 'proposed', 'deprecated'])('DR-121 status %s keeps the #2980 refusal', (st) => {
    expect(reasonOf(input({ decisionStatus: (id) => (id === 'DR-121' ? st : decisions[id]) }))).toBe('plan-artifact');
  });
});

describe('DR-121 s2.2: plan artifacts only, for one spec', () => {
  it('a plan PR that also touches requirements.md is not a plan PR', () => {
    expect(reasonOf(input({ files: [pf(DESIGN), pf(REQ)] }))).toBe('plan-mixed-diff');
  });
  it('plans for two specs deny', () => {
    expect(reasonOf(input({ files: [pf(DESIGN), pf('specs/minspec/SPEC-067-x/tasks.md')] }))).toBe('plan-mixed-diff');
  });
  it.each(['specs/minspec/tasks.md', 'docs/design.md', `${DIR}/sub/design.md`])('%s is not a spec plan path', (p) => {
    expect(reasonOf(input({ files: [pf(p)] }))).toBe('plan-mixed-diff');
  });
  it('a plan file with a sidecar or DR alongside denies', () => {
    expect(reasonOf(input({ files: [pf(DESIGN), pf(SIDECAR)] }))).toBe('plan-mixed-diff');
    expect(reasonOf(input({ files: [pf(DESIGN), pf('docs/decisions/DR-121.md')] }))).toBe('plan-mixed-diff');
  });
  it.each(['removed', 'renamed', ''])('a %s plan file denies', (st) => {
    expect(reasonOf(input({ files: [pf(DESIGN, { status: st })] }))).toBe('file-status-not-admitted');
  });
  it('an unreadable plan head denies', () => {
    expect(reasonOf(input({ files: [pf(DESIGN, { headContent: null })] }))).toBe('head-content-unreadable');
  });
});

describe('DR-121 s2.3: the spec it plans is approved on main, and not stale', () => {
  it('an unreadable base requirements.md denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: undefined, sidecar: sidecar() } }))).toBe('base-unreadable');
  });
  it('a spec absent on main denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: null, sidecar: null } }))).toBe('plan-spec-not-approved');
  });
  it('no plan-spec facts at all denies', () => {
    expect(reasonOf(input({ planSpec: undefined }))).toBe('base-unreadable');
  });
  it.each(['new', 'specifying', 'archived', undefined])('spec status %s denies', (st) => {
    const c = st === undefined ? '---\nid: SPEC-066\ntier: T3\n---\n' : req(st);
    expect(reasonOf(input({ planSpec: { requirements: c, sidecar: sidecar(c) } }))).toBe('plan-spec-not-approved');
  });
  it('no approval record denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: req(), sidecar: null } }))).toBe('plan-spec-not-approved');
  });
  it('an unreadable approval record denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: req(), sidecar: undefined } }))).toBe('base-unreadable');
    expect(reasonOf(input({ planSpec: { requirements: req(), sidecar: '{not json' } }))).toBe('plan-spec-approval-unreadable');
  });
  it('a stale approval (hash of other content) denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: req(), sidecar: sidecar(req() + 'FR-2 more.\n') } }))).toBe('plan-spec-approval-stale');
  });
  it('an approval record for another spec denies', () => {
    expect(reasonOf(input({ planSpec: { requirements: req(), sidecar: sidecar(req(), { specPath: 'specs/minspec/SPEC-1-x/requirements.md' }) } }))).toBe(
      'plan-spec-approval-stale',
    );
  });
  it.each([undefined, 'T5'])('a spec tier %s denies; a tier is never invented', (tier) => {
    const c = tier === undefined ? '---\nid: SPEC-066\nstatus: planning\n---\n' : req('planning', tier);
    expect(reasonOf(input({ planSpec: { requirements: c, sidecar: sidecar(c) } }))).toBe('tier-unknown');
  });
});

describe('DR-121 s2.4: the DR-119 pins', () => {
  it('a human author denies, even with a bot-looking login', () => {
    expect(reasonOf(input({ pull: pull({ authorLogin: 'harvest316', authorType: 'User' }) }))).toBe('plan-author-not-bot');
    expect(reasonOf(input({ pull: pull({ authorType: 'User' }) }))).toBe('plan-author-not-bot');
    expect(reasonOf(input({ pull: pull({ authorType: undefined }) }))).toBe('plan-author-not-bot');
  });
  it('a commit by anyone else denies', () => {
    expect(reasonOf(input({ commitAuthors: [BOT, 'harvest316'] }))).toBe('plan-commit-not-bot');
    expect(reasonOf(input({ commitAuthors: [BOT, ''] }))).toBe('plan-commit-not-bot');
  });
  it('unreadable or empty commits deny', () => {
    expect(reasonOf(input({ commitAuthors: undefined }))).toBe('plan-commit-not-bot');
    expect(reasonOf(input({ commitAuthors: [] }))).toBe('plan-commit-not-bot');
  });
  it.each(['hold:human', 'hold:specify'])('%s denies', (l) => {
    expect(reasonOf(input({ pull: pull({ labels: ['ai-review:pass', l] }) }))).toBe('held-by-label');
  });
  it.each(['ai-review:changes', 'ai-review:blocked'])('%s denies', (l) => {
    expect(reasonOf(input({ pull: pull({ labels: ['ai-review:pass', l] }) }))).toBe('review-not-pass');
  });
  it('no ai-review:pass denies', () => {
    expect(reasonOf(input({ pull: pull({ labels: [] }) }))).toBe('review-not-pass');
  });
  it('a pass on an older head denies', () => {
    expect(reasonOf(input({ review: review('c'.repeat(40)) }))).toBe('head-moved');
  });
});

describe('DR-121 s2.4: CI green on the head - EVERY latest check, required or not (DR-119 item 10)', () => {
  // Native auto-merge waits only for REQUIRED checks; a plan is merged directly, so the
  // judge itself must see every latest check run green (review rv-3746-a0f08b04).
  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'])(
    'a non-required check concluding %s denies',
    (c) => {
      expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [...GREEN, run('optional-lint', c)] } }))).toBe('plan-ci-not-green');
    },
  );
  it('a completed check with no conclusion denies', () => {
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [...GREEN, run('odd', null)] } }))).toBe('plan-ci-not-green');
  });
  it.each(['queued', 'in_progress', 'waiting', 'pending'])('a check still %s denies', (st) => {
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [...GREEN, run('slow', null, st)] } }))).toBe('plan-ci-pending');
  });
  it('zero check runs denies: none reported is not green', () => {
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [] } }))).toBe('plan-ci-none');
  });
  it('unreadable check runs deny', () => {
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: undefined } }))).toBe('plan-ci-unreadable');
  });
  it('check-run facts never gathered deny', () => {
    expect(reasonOf(input({ planChecks: undefined }))).toBe('plan-ci-unreadable');
  });
  it('green checks read on another sha deny', () => {
    expect(reasonOf(input({ planChecks: { sha: 'a'.repeat(40), runs: GREEN } }))).toBe('plan-ci-unreadable');
  });
  it('upper-case conclusions (GraphQL form) are read the same way', () => {
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [run('a', 'SUCCESS'), run('b', 'NEUTRAL'), run('c', 'SKIPPED')] } }))).toBe('ARMED');
    expect(reasonOf(input({ planChecks: { sha: HEAD, runs: [run('a', 'SUCCESS'), run('b', 'FAILURE')] } }))).toBe('plan-ci-not-green');
  });
});

describe('the spec arm is unchanged by the plan arm (DR-108)', () => {
  const SPEC_REQ = 'specs/minspec/SPEC-228-ci-parity/requirements.md';
  const specInput = (over: Partial<MergeInput> = {}) =>
    input({
      files: [pf(SPEC_REQ, { headContent: req('specifying'), baseContent: null })],
      review: { ...review(), artifactAtHead: req('specifying'), pull: { ...review().pull, files: [SPEC_REQ] } },
      planSpec: undefined,
      commitAuthors: undefined,
      planChecks: undefined,
      ...over,
    });
  it('a covered spec PR still arms native auto-merge, and needs no check-run read', () => {
    expect(planDelegatedMerge(specInput())).toMatchObject({ arm: true, mergeMode: 'auto' });
  });
  it('a red optional check does not enter the spec arm: required checks stay GitHub\'s', () => {
    expect(planDelegatedMerge(specInput({ planChecks: { sha: HEAD, runs: [run('x', 'failure')] } }))).toMatchObject({ arm: true, mergeMode: 'auto' });
  });
});

describe('DR-121 s2.5: the delegation and its tripwire', () => {
  it('a tripped repeat-fix share denies', () => {
    expect(reasonOf(input({ repeatFixShare: 0.5 }))).toMatch(/^delegation-/);
  });
  it('no delegation record denies', () => {
    expect(reasonOf(input({ delegations: undefined }))).toBe('no-delegation-record');
  });
  it('memory-fabric is still refused by name', () => {
    expect(reasonOf(input({ repo: 'harvest316/memory-fabric' }))).toBe('repo-never-delegated');
  });
});

describe('DR-121 gathering: plan facts are read from the base, failures deny', () => {
  const GATHER_RUNS: PlanCheckRun[] = GREEN;
  const okGit = (args: readonly string[]): string => {
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return 'false\n';
    if (args[0] === 'cat-file') {
      const rel = String(args[2]).split(':')[1];
      if (rel === DESIGN || rel === TASKS) throw new Error('absent');
      return '';
    }
    if (args[0] === 'show') {
      const rel = String(args[1]).split(':')[1];
      if (rel === '.minspec/delegations.json') return JSON.stringify({ version: 1, delegations: [DLG] });
      if (rel === 'docs/decisions/DR-108.md') return '---\nid: DR-108\nstatus: accepted\n---\n';
      if (rel === 'docs/decisions/DR-121.md') return '---\nid: DR-121\nstatus: accepted\n---\n';
      if (rel === REQ) return req();
      if (rel === SIDECAR) return sidecar();
      throw new Error('no such path');
    }
    return '';
  };
  const okGh = (args: readonly string[]): string => {
    const route = args[args.length - 1];
    if (route === `repos/${REPO}/pulls/${PR}`) {
      return JSON.stringify({
        state: 'open',
        draft: false,
        base: { ref: 'main' },
        head: { sha: HEAD, ref: 'cos/plan-b-1028' },
        user: { login: BOT, type: 'Bot' },
        labels: [{ name: 'ai-review:pass' }, { name: 'awaiting-approval' }],
      });
    }
    if (route.startsWith(`repos/${REPO}/pulls/${PR}/files`)) {
      return JSON.stringify([{ filename: DESIGN, status: 'added' }, { filename: TASKS, status: 'added' }]);
    }
    if (route.startsWith(`repos/${REPO}/pulls/${PR}/commits`)) {
      return JSON.stringify([
        { sha: '1'.repeat(40), author: { login: BOT }, parents: [{ sha: 'x' }] },
        { sha: '2'.repeat(40), author: { login: BOT }, parents: [{ sha: 'x' }, { sha: 'y' }] },
      ]);
    }
    if (route.includes('/contents/')) return '# plan\n';
    const r = review();
    if (route.startsWith(`repos/${REPO}/issues/${PR}/comments`)) {
      return JSON.stringify(r.comments.map((c) => ({ id: c.id, html_url: c.url, user: { login: c.login }, body: c.body, created_at: c.createdAt })));
    }
    if (route.includes('/check-runs?filter=latest')) {
      const runs = GATHER_RUNS.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
      return JSON.stringify({ total_count: runs.length, check_runs: runs });
    }
    if (route.includes('/check-runs')) {
      return JSON.stringify({
        check_runs: r.checkRuns.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, app: { slug: c.appSlug }, head_sha: c.headSha, completed_at: c.completedAt })),
      });
    }
    if (route.includes('/actions/runs')) {
      return JSON.stringify({
        workflow_runs: r.workflowRuns.map((w) => ({ path: w.path, event: w.event, status: w.status, head_sha: w.headSha, run_started_at: w.runStartedAt, updated_at: w.updatedAt })),
      });
    }
    throw new Error(`unexpected route ${route}`);
  };
  const deps = (over: Partial<MergeDeps> = {}): MergeDeps => ({
    gh: okGh,
    git: okGit,
    repeatFixShare: () => 0.08,
    today: () => '2026-11-14',
    exists: () => true,
    ...over,
  });
  const args = { pr: PR, repo: REPO, base: 'origin/main', stopClasses: 'approval-or-acceptance' };
  const plan = (d: MergeDeps) => planDelegatedMerge(gatherMergeInput(args, d));

  it('the all-good world is cleared, including a bot merge commit from main', () => {
    expect(plan(deps())).toMatchObject({ arm: true, headSha: HEAD });
  });
  it('a merge commit by a human denies: what it brought in is not checked file by file', () => {
    const gh = (a: readonly string[]) => {
      if (a[a.length - 1].includes('/commits')) {
        return JSON.stringify([
          { sha: '1'.repeat(40), author: { login: BOT }, parents: [{ sha: 'x' }] },
          { sha: '2'.repeat(40), author: { login: 'harvest316' }, parents: [{ sha: 'x' }, { sha: 'y' }] },
        ]);
      }
      return okGh(a);
    };
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-commit-not-bot' });
  });
  it('a commit with no GitHub author (unlinked email) denies', () => {
    const gh = (a: readonly string[]) =>
      a[a.length - 1].includes('/commits') ? JSON.stringify([{ sha: '1'.repeat(40), author: null, parents: [{ sha: 'x' }] }]) : okGh(a);
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-commit-not-bot' });
  });
  it('an unreadable commit list denies', () => {
    const gh = (a: readonly string[]) => {
      if (a[a.length - 1].includes('/commits')) throw new Error('HTTP 502');
      return okGh(a);
    };
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-commit-not-bot' });
  });
  it('the latest check runs are read on the judged head, and a red optional one denies', () => {
    const seen: string[] = [];
    const gh = (a: readonly string[]) => {
      const route = a[a.length - 1];
      seen.push(route);
      if (route.includes('/check-runs?filter=latest')) {
        return JSON.stringify({ total_count: 2, check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'optional', status: 'completed', conclusion: 'failure' }] });
      }
      return okGh(a);
    };
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-ci-not-green' });
    expect(seen).toContain(`repos/${REPO}/commits/${HEAD}/check-runs?filter=latest&per_page=100&page=1`);
  });
  it('an unreadable check-run list denies', () => {
    const gh = (a: readonly string[]) => {
      if (a[a.length - 1].includes('/check-runs?filter=latest')) throw new Error('HTTP 502');
      return okGh(a);
    };
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-ci-unreadable' });
  });
  it('a short read (fewer runs than total_count) denies, never passes on what it saw', () => {
    const gh = (a: readonly string[]) =>
      a[a.length - 1].includes('/check-runs?filter=latest')
        ? JSON.stringify({ total_count: 5, check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] })
        : okGh(a);
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-ci-unreadable' });
  });
  it('a check-run body with no total_count denies', () => {
    const gh = (a: readonly string[]) =>
      a[a.length - 1].includes('/check-runs?filter=latest')
        ? JSON.stringify({ check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] })
        : okGh(a);
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-ci-unreadable' });
  });
  it('a pending check read through gathering denies', () => {
    const gh = (a: readonly string[]) =>
      a[a.length - 1].includes('/check-runs?filter=latest')
        ? JSON.stringify({ total_count: 1, check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }] })
        : okGh(a);
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'plan-ci-pending' });
  });
  it('a missing approval record on the base denies', () => {
    const git = (a: readonly string[]) => {
      if (a[0] === 'cat-file' && String(a[2]).endsWith(SIDECAR)) throw new Error('absent');
      return okGit(a);
    };
    expect(plan(deps({ git }))).toMatchObject({ arm: false, reason: 'plan-spec-not-approved' });
  });
  it('DR-121 unreadable on the base keeps the refusal', () => {
    const git = (a: readonly string[]) => {
      if (a[0] === 'show' && String(a[1]).endsWith('DR-121.md')) throw new Error('gone');
      return okGit(a);
    };
    expect(plan(deps({ git }))).toMatchObject({ arm: false, reason: 'plan-artifact' });
  });
});

// ─── the seam: a plan is merged directly, never armed (DR-121 s2.4, item 11) ──────────────

describe('the dispatch seam merges a plan directly - never --auto, never --admin', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');
  const TIMEOUT = 60_000;
  const ARMED = {
    arm: true,
    reason: 'covered',
    detail: 'covered by DLG-001',
    delegationId: 'DLG-001',
    verdictBy: VERDICT_URL,
    headSha: HEAD,
    classesAfter: [] as string[],
  };
  const VIEW = { headRefName: 'cos/plan-b-1028', closingIssuesReferences: [], comments: [], author: { login: 'app/minspec-sdd' }, body: 'Refs #3586' };
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-plan-seam-'));
    fs.mkdirSync(path.join(tmp, 'bin'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function seam(o: { judge: Record<string, unknown>; diff: string; mergeExit?: number }) {
    const ghLog = path.join(tmp, 'gh.log');
    fs.writeFileSync(
      path.join(tmp, 'bin', 'gh'),
      `#!/usr/bin/env bash
printf 'TOKEN=%s ARGS=%s\\n' "\${GH_TOKEN:-}" "$*" >> ${JSON.stringify(ghLog)}
case "$1 $2" in
  "pr diff") printf '%s\\n' ${JSON.stringify(o.diff)} ;;
  "pr view") printf '%s\\n' ${JSON.stringify(JSON.stringify(VIEW))} ;;
  "pr merge") exit ${o.mergeExit ?? 0} ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    const judge = path.join(tmp, 'judge.sh');
    fs.writeFileSync(judge, `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(JSON.stringify(o.judge))}\n`, { mode: 0o755 });
    const token = path.join(tmp, 'token.sh');
    fs.writeFileSync(token, '#!/usr/bin/env bash\necho stub-bot-installation-token\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${path.join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      MINSPEC_DELEGATED_MERGE_JUDGE_CMD: judge,
      MINSPEC_GH_APP_TOKEN_SCRIPT: token,
      MINSPEC_AUTONOMY: 'act',
      MINSPEC_FRESHNESS_CHECKED: '1',
      MINSPEC_AUTOMERGE_NATIVE: '1',
    };
    delete env.MINSPEC_AUTOMERGE_MODE;
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    delete env.MINSPEC_GH_BOT_TOKEN_STAMP;
    const r = spawnSync('bash', [DISPATCH, '--delegated-spec-merge', String(PR), '--arm'], { encoding: 'utf-8', env });
    const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('{'));
    const gh = fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf-8').split('\n').filter(Boolean) : [];
    return {
      status: r.status,
      stderr: r.stderr ?? '',
      verdict: lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : undefined,
      merges: gh.filter((l) => l.includes('ARGS=pr merge')),
      edits: gh.filter((l) => l.includes('ARGS=pr edit')),
    };
  }
  const PLAN_DIFF = `${DESIGN}\n${TASKS}`;

  it('a plan the judge cleared is merged at the judged head with --squash and NO --auto', () => {
    const r = seam({ judge: { ...ARMED, mergeMode: 'direct' }, diff: PLAN_DIFF });
    expect(r.status).toBe(0);
    expect(r.merges).toEqual([`TOKEN=stub-bot-installation-token ARGS=pr merge ${PR} --repo ${REPO} --squash --match-head-commit ${HEAD}`]);
    expect(r.merges.join('\n')).not.toMatch(/--auto|--admin/);
    expect(r.verdict).toMatchObject({ proceed: true, mergeMode: 'direct', merged: true, armed: false });
  }, TIMEOUT);

  it('a plan diff forces a direct merge even if the judge says auto: the seam is a second witness', () => {
    const r = seam({ judge: { ...ARMED, mergeMode: 'auto' }, diff: PLAN_DIFF });
    expect(r.merges).toHaveLength(1);
    expect(r.merges[0]).not.toContain('--auto');
    expect(r.merges[0]).toContain(`--squash --match-head-commit ${HEAD}`);
  }, TIMEOUT);

  it('a judge that names no mergeMode still cannot arm auto-merge on a plan diff', () => {
    const r = seam({ judge: ARMED, diff: TASKS });
    expect(r.merges).toHaveLength(1);
    expect(r.merges[0]).not.toContain('--auto');
  }, TIMEOUT);

  it('a direct merge GitHub refuses exits 2, held for the next cycle, and arms nothing instead', () => {
    const r = seam({ judge: { ...ARMED, mergeMode: 'direct' }, diff: PLAN_DIFF, mergeExit: 1 });
    expect(r.status).toBe(2);
    expect(r.merges).toHaveLength(1);
    expect(r.merges.join('\n')).not.toContain('--auto');
    expect(r.verdict).toMatchObject({ merged: false, error: 'merge-failed' });
    expect(r.stderr).toContain('next cycle');
  }, TIMEOUT);

  it('the spec arm is unchanged: a spec PR still arms --auto --squash at the judged head', () => {
    const r = seam({ judge: { ...ARMED, mergeMode: 'auto' }, diff: 'specs/minspec/SPEC-228-ci-parity/requirements.md' });
    expect(r.status).toBe(0);
    expect(r.merges).toEqual([`TOKEN=stub-bot-installation-token ARGS=pr merge ${PR} --repo ${REPO} --auto --squash --match-head-commit ${HEAD}`]);
    expect(r.edits).toHaveLength(1);
    expect(r.verdict).toMatchObject({ armed: true, mergeMode: 'auto' });
  }, TIMEOUT);

  it('the spec arm is unchanged for an older judge that names no mergeMode', () => {
    const r = seam({ judge: ARMED, diff: 'specs/minspec/SPEC-228-ci-parity/requirements.md' });
    expect(r.merges).toEqual([`TOKEN=stub-bot-installation-token ARGS=pr merge ${PR} --repo ${REPO} --auto --squash --match-head-commit ${HEAD}`]);
  }, TIMEOUT);
});
