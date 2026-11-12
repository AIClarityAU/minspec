/**
 * T3 (#3036, review of #3382) - the delegated-approval remediation path, driven through the
 * real remediate-pr.sh with only `gh` stubbed.
 *
 * Fixtures copy the rollup shapes read from production on 2026-10-30:
 *   #3382 / #3378: `ai-review` is a CheckRun posted by the App, detailsUrl `https://minspec.dev/`
 *   and workflowName ""; `ai-review/pass` is a StatusContext with targetUrl ""; the run that
 *   produced the verdict is the `runner` job of workflow `ai-review-runner`, which is SUCCESS
 *   on a `changes` verdict (#3378).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/remediate-pr.sh');
const DLG = 'dlg-approve/spec-257-5682159114c4';
const REVIEW_RUN = '41020354324';
const RERUN_MARKER = '<!-- minspec-remediate-rerun -->';
const ATTEMPT_MARKER = '<!-- minspec-auto-remediation -->';

// The workflow name comes from the workflow file, so renaming it reddens this suite rather
// than quietly sending every delegated PR to a human.
const REVIEW_WORKFLOW = /^name: (.+)$/m.exec(
  fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ai-review.yml'), 'utf-8'),
)![1];

const STARTED = '2026-10-30T08:21:48Z';
const runnerCheck = (overrides: Record<string, unknown> = {}) => ({
  __typename: 'CheckRun',
  name: 'runner',
  workflowName: REVIEW_WORKFLOW,
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  detailsUrl: `https://github.com/AIClarityAU/minspec/actions/runs/${REVIEW_RUN}/job/123946329111`,
  startedAt: STARTED,
  ...overrides,
});
const aiReviewCheck = (conclusion: string) => ({
  __typename: 'CheckRun',
  name: 'ai-review',
  workflowName: '',
  status: 'COMPLETED',
  conclusion,
  detailsUrl: 'https://minspec.dev/',
  startedAt: STARTED,
});
const aiReviewPass = (state: string) => ({
  __typename: 'StatusContext',
  context: 'ai-review/pass',
  state,
  targetUrl: '',
  startedAt: STARTED,
});
const readyToMerge = {
  __typename: 'StatusContext',
  context: 'ready-to-merge',
  state: 'FAILURE',
  targetUrl: '',
  startedAt: STARTED,
};
const gateJob = {
  __typename: 'CheckRun',
  name: 'gate',
  workflowName: 'ready-to-merge',
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  detailsUrl: 'https://github.com/AIClarityAU/minspec/actions/runs/333/job/3',
  startedAt: STARTED,
};
const testJob = (conclusion = 'FAILURE') => ({
  __typename: 'CheckRun',
  name: 'test',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion,
  detailsUrl: 'https://github.com/AIClarityAU/minspec/actions/runs/222/job/2',
  startedAt: STARTED,
});

const changesRollup = (extra: unknown[] = []) => [
  runnerCheck(),
  aiReviewCheck('FAILURE'),
  aiReviewPass('FAILURE'),
  readyToMerge,
  gateJob,
  ...extra,
];

const seam = (args: string[], input: unknown) =>
  execFileSync('bash', [SCRIPT, ...args], { encoding: 'utf-8', input: JSON.stringify(input) })
    .trim()
    .split('\n')
    .filter(Boolean);

describe('--derive-failed-runs with-review reads the shape production emits', () => {
  it('finds the review run for a red ai-review with the homepage URL and no target_url', () => {
    expect(seam(['--derive-failed-runs', 'with-review'], { statusCheckRollup: changesRollup(), labels: [] })).toEqual([
      REVIEW_RUN,
    ]);
  });
  it('finds it from the ai-review:changes label alone, with the check NEUTRAL (the #3378 shape)', () => {
    const roll = {
      statusCheckRollup: [runnerCheck(), aiReviewCheck('NEUTRAL'), aiReviewPass('FAILURE')],
      labels: [{ name: 'ai-review:changes' }],
    };
    expect(seam(['--derive-failed-runs', 'with-review'], roll)).toEqual([REVIEW_RUN]);
  });
  it('a machinery ai-review:pass (NEUTRAL + a red status by design) is not a red review', () => {
    const roll = {
      statusCheckRollup: [runnerCheck(), aiReviewCheck('NEUTRAL'), aiReviewPass('FAILURE'), testJob()],
      labels: [{ name: 'ai-review:pass' }],
    };
    expect(seam(['--derive-failed-runs', 'with-review'], roll)).toEqual(['222']);
  });
  it('without with-review the review run stays out, and ready-to-merge is out in both modes', () => {
    const roll = { statusCheckRollup: changesRollup([testJob()]), labels: [] };
    expect(seam(['--derive-failed-runs'], roll)).toEqual(['222']);
    expect(seam(['--derive-failed-runs', 'with-review'], roll).sort()).toEqual(['222', REVIEW_RUN].sort());
    expect(seam(['--derive-failed-runs', 'with-review'], roll)).not.toContain('333');
  });
  it('a skipped review run, or a rollup with no review run, yields no id', () => {
    const skipped = { statusCheckRollup: [runnerCheck({ conclusion: 'SKIPPED' }), aiReviewCheck('FAILURE')], labels: [] };
    const absent = { statusCheckRollup: [aiReviewCheck('FAILURE'), aiReviewPass('FAILURE')], labels: [] };
    expect(seam(['--derive-failed-runs', 'with-review'], skipped)).toEqual([]);
    expect(seam(['--derive-failed-runs', 'with-review'], absent)).toEqual([]);
  });
});

describe('--classify on dlg-approve/*: BEHIND beats a red check', () => {
  const classify = (mergeState: string, labels: string, failing: string, bad: string, claim = 'no', sweep = 'yes') =>
    execFileSync('bash', [SCRIPT, '--classify', DLG, 'MERGEABLE', mergeState, labels, failing, bad, claim, sweep], {
      encoding: 'utf-8',
    }).trim();

  it('BEHIND + a red check, a red review or ai-review:changes is a branch update', () => {
    expect(classify('BEHIND', '', 'yes', 'no')).toBe('rebase-only');
    expect(classify('BEHIND', '', 'no', 'yes')).toBe('rebase-only');
    expect(classify('BEHIND', 'ai-review:changes', 'no', 'no')).toBe('rebase-only');
    expect(classify('BEHIND', 'ai-review:pass', 'yes', 'no')).toBe('rebase-only');
  });
  it('control: a current branch with a red check is still the one rerun', () => {
    expect(classify('BLOCKED', '', 'yes', 'no')).toBe('dlg-rerun');
    expect(classify('UNSTABLE', 'ai-review:changes', 'no', 'no')).toBe('dlg-rerun');
  });
  it('conflicts and live claims still win; a green BEHIND pass still waits its merge turn', () => {
    expect(classify('DIRTY', '', 'yes', 'no')).toBe('skip-conflict');
    expect(classify('BEHIND', '', 'yes', 'no', 'yes')).toBe('skip-live-owned');
    expect(classify('BEHIND', 'ai-review:pass', 'no', 'no')).toBe('skip-awaiting-merge-turn');
  });
  it('a non-delegated branch keeps its existing routing when BEHIND and red', () => {
    const other = (branch: string) =>
      execFileSync('bash', [SCRIPT, '--classify', branch, 'MERGEABLE', 'BEHIND', '', 'yes', 'no', 'no', 'yes'], {
        encoding: 'utf-8',
      }).trim();
    expect(other('agent/issue-1')).toBe('agent-remediate-checks');
    expect(other('dlg-approve-x')).toBe('skip-not-automation');
  });
});

type Stub = {
  rollup: unknown[];
  labels?: string[];
  mergeState?: string;
  branch?: string;
  comments?: unknown[];
  commentsReadFails?: boolean;
  commentPostFails?: boolean;
  rerunFails?: boolean;
  cwd?: string;
};

// Everything except `gh` is real, so what is asserted is what the script would ask GitHub to do.
function drive(stub: Stub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediate-dlg-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const pr = {
    number: 9003036,
    state: 'OPEN',
    isDraft: false,
    headRefName: stub.branch ?? DLG,
    headRepository: { name: 'minspec' },
    headRepositoryOwner: { login: 'AIClarityAU' },
    mergeable: 'MERGEABLE',
    mergeStateStatus: stub.mergeState ?? 'BLOCKED',
    labels: (stub.labels ?? []).map((name) => ({ name })),
    statusCheckRollup: stub.rollup,
    title: 't',
    author: { login: 'minspec-sdd' },
  };
  fs.writeFileSync(path.join(dir, 'pr.json'), JSON.stringify(pr));
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify({ comments: stub.comments ?? [] }));
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, '#!/usr/bin/env bash\necho ghs_stub_token\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
printf '%s\\n' "gh \${*//$'\\n'/ }" >> "${dir}/calls"
case "$*" in
  "api user"*) echo 'minspec-sdd[bot]' ;;
  "pr view"*"--json comments"*) ${stub.commentsReadFails ? 'echo boom >&2; exit 1' : `cat "${dir}/comments.json"`} ;;
  "pr view"*) cat "${dir}/pr.json" ;;
  "pr comment"*) ${stub.commentPostFails ? 'exit 1' : 'exit 0'} ;;
  "run rerun"*) ${stub.rerunFails ? 'exit 1' : 'exit 0'} ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const r = spawnSync('bash', [SCRIPT, '9003036'], {
    encoding: 'utf-8',
    cwd: stub.cwd ?? REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      MINSPEC_GH_APP_TOKEN_SCRIPT: minter,
      MINSPEC_CLAIM_OFF: '1',
    },
  });
  const calls = fs.existsSync(path.join(dir, 'calls'))
    ? fs.readFileSync(path.join(dir, 'calls'), 'utf-8').split('\n').filter(Boolean)
    : [];
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    calls,
    reruns: calls.filter((c) => c.startsWith('gh run rerun')),
    comments: calls.filter((c) => c.startsWith('gh pr comment')),
    humanLabel: calls.some((c) => c.includes('--add-label needs-human-review')),
  };
}

describe('dlg-rerun end to end: what gets rerun', () => {
  it('a current PR red only on ai-review reruns the review run in full, once, and never with --failed', () => {
    const r = drive({ rollup: changesRollup() });
    expect(r.status, r.out).toBe(0);
    expect(r.reruns).toEqual([`gh run rerun ${REVIEW_RUN} --repo AIClarityAU/minspec`]);
    expect(r.humanLabel).toBe(false);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toContain(RERUN_MARKER);
  });
  it('the same for the label-only #3378 shape', () => {
    const r = drive({
      rollup: [runnerCheck(), aiReviewCheck('NEUTRAL'), aiReviewPass('FAILURE')],
      labels: ['ai-review:changes'],
    });
    expect(r.reruns).toEqual([`gh run rerun ${REVIEW_RUN} --repo AIClarityAU/minspec`]);
  });
  it('an ordinary failed job is rerun with --failed, next to the review run in full', () => {
    const r = drive({ rollup: changesRollup([testJob()]) });
    expect(r.reruns.sort()).toEqual(
      [`gh run rerun 222 --repo AIClarityAU/minspec --failed`, `gh run rerun ${REVIEW_RUN} --repo AIClarityAU/minspec`].sort(),
    );
  });
  it('a failed job alone, with no review problem, leaves the review run alone', () => {
    const r = drive({
      rollup: [runnerCheck(), aiReviewCheck('SUCCESS'), aiReviewPass('SUCCESS'), testJob()],
      labels: ['ai-review:pass'],
    });
    expect(r.reruns).toEqual(['gh run rerun 222 --repo AIClarityAU/minspec --failed']);
  });
  it('the comment tells the truth: no remediation follows on a delegated branch', () => {
    const r = drive({ rollup: changesRollup() });
    expect(r.comments[0]).not.toMatch(/remediation proceeds|remediation agent/);
    expect(r.comments[0]).toMatch(/needs-human-review/);
  });
});

describe('dlg-rerun end to end: at most once, and failed reads go to a human', () => {
  const spent = [{ author: { login: 'minspec-sdd[bot]' }, body: `earlier\n${RERUN_MARKER}` }];

  it('a marker already on the PR means no second rerun: human path', () => {
    const r = drive({ rollup: changesRollup(), comments: spent });
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(true);
  });
  it('no review run in the rollup means no rerun: human path', () => {
    const r = drive({ rollup: [aiReviewCheck('FAILURE'), aiReviewPass('FAILURE')] });
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(true);
  });
  it('a failed read of the comments cannot look like "no rerun yet": no rerun, human path', () => {
    const r = drive({ rollup: changesRollup(), commentsReadFails: true });
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(true);
  });
  it('a marker that could not be posted means no rerun, because nothing would bound the next one', () => {
    const r = drive({ rollup: changesRollup(), commentPostFails: true });
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(true);
  });
  it('a rerun GitHub refuses goes to the human path', () => {
    const r = drive({ rollup: changesRollup(), rerunFails: true });
    expect(r.reruns).toHaveLength(1);
    expect(r.humanLabel).toBe(true);
  });
  it('while the rerun is in flight the stale verdict is not read as "still red"', () => {
    const r = drive({
      rollup: [runnerCheck({ status: 'IN_PROGRESS', conclusion: null }), aiReviewCheck('FAILURE'), aiReviewPass('FAILURE')],
      comments: spent,
    });
    expect(r.out).toMatch(/in flight/);
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(false);
  });
  it('a queued rerun with no startedAt still counts as in flight', () => {
    const r = drive({
      rollup: [
        ...changesRollup(),
        runnerCheck({ status: 'QUEUED', conclusion: null, startedAt: undefined }),
      ],
      comments: spent,
    });
    expect(r.humanLabel).toBe(false);
    expect(r.reruns).toEqual([]);
  });
  it('ready-to-merge alone is not a rerun target and not a red delegated PR', () => {
    const r = drive({ rollup: [runnerCheck(), aiReviewCheck('SUCCESS'), readyToMerge, gateJob], labels: ['ai-review:pass'] });
    expect(r.reruns).toEqual([]);
    expect(r.humanLabel).toBe(false);
  });
});

describe('red dlg-approve PR that is BEHIND: a bounded mechanical update', () => {
  function gitFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediate-dlg-git-'));
    const git = (cwd: string, ...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf-8' }).trim();
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    git(dir, 'clone', '-q', origin, work);
    git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${DLG}`);
    fs.writeFileSync(path.join(work, 'fix.txt'), 'the base fix\n');
    git(work, 'add', 'fix.txt');
    git(work, 'commit', '-q', '-m', 'base fix');
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    return { work, branchTip: () => git(origin, 'rev-parse', DLG), mainTip: () => git(origin, 'rev-parse', 'main'),
      isAncestor: (a: string, b: string) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: origin }).status === 0 };
  }

  it('merges main, charges the attempt budget before the push, and reruns nothing', () => {
    const g = gitFixture();
    const before = g.branchTip();
    const r = drive({ rollup: changesRollup(), mergeState: 'BEHIND', cwd: g.work });
    expect(r.status, r.out).toBe(0);
    expect(g.branchTip()).not.toBe(before);
    expect(g.isAncestor(g.mainTip(), g.branchTip())).toBe(true);
    expect(r.reruns).toEqual([]);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toContain(ATTEMPT_MARKER);
  });
  it('a marker that cannot be posted means no push', () => {
    const g = gitFixture();
    const before = g.branchTip();
    drive({ rollup: changesRollup(), mergeState: 'BEHIND', cwd: g.work, commentPostFails: true });
    expect(g.branchTip()).toBe(before);
  });
  it('the update budget stops the churn: at the cap, no push and a human', () => {
    const g = gitFixture();
    const before = g.branchTip();
    const used = [1, 2].map((n) => ({ author: { login: 'minspec-sdd[bot]' }, body: `update ${n}\n${ATTEMPT_MARKER}` }));
    const r = drive({ rollup: changesRollup(), mergeState: 'BEHIND', cwd: g.work, comments: used });
    expect(g.branchTip()).toBe(before);
    expect(r.humanLabel).toBe(true);
  });
  it('an update waits for checks in flight, so a review underway is not cancelled by the push', () => {
    const g = gitFixture();
    const before = g.branchTip();
    const r = drive({
      rollup: [runnerCheck({ status: 'IN_PROGRESS', conclusion: null }), aiReviewCheck('NEUTRAL')],
      labels: ['ai-review:changes'],
      mergeState: 'BEHIND',
      cwd: g.work,
    });
    expect(g.branchTip()).toBe(before);
    expect(r.humanLabel).toBe(false);
  });
  it('a green BEHIND delegated PR updates as before, charging no budget', () => {
    const g = gitFixture();
    const before = g.branchTip();
    const r = drive({ rollup: [runnerCheck(), aiReviewCheck('NEUTRAL')], mergeState: 'BEHIND', cwd: g.work });
    expect(g.branchTip()).not.toBe(before);
    expect(r.comments).toEqual([]);
  });
});

describe('non-delegated branches are untouched', () => {
  it('a red agent branch still reruns with --failed only, ignoring the review run', () => {
    const r = drive({ rollup: changesRollup([testJob()]), branch: 'fix/1-x' });
    expect(r.reruns).toEqual(['gh run rerun 222 --repo AIClarityAU/minspec --failed']);
    expect(r.comments[0]).toMatch(/remediation proceeds/);
  });
});
