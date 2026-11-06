/**
 * T0 - the delegated-merge judge (#2981, DR-108): may a held spec pull request merge
 * without the founder?
 *
 * The founder's answer (queue item dlg2981, 2026-10-21): T1-T4 spec pull requests covered
 * by DLG-001 merge on their own once their AI review passes; memory-fabric, plan-only
 * pull requests and governance files stay his. Every test below but the first is a way
 * that answer could be widened by accident, and each must DENY.
 */
import { describe, it, expect } from 'vitest';
import { type Delegation } from '../../../scripts/lib/autonomy';
import { type ReviewEvidence } from '../../../scripts/lib/delegated-approval';
import {
  gatherMergeInput,
  parseMergeArgs,
  parseStopClasses,
  planDelegatedMerge,
  type MergeDeps,
  type MergeFile,
  type MergeInput,
  type MergePull,
} from '../../../scripts/lib/delegated-merge';

const REPO = 'AIClarityAU/minspec';
const PR = 2966;
const HEAD = 'a'.repeat(40);
const SPEC = 'specs/minspec/SPEC-228-ci-parity/requirements.md';
const VERDICT_URL = `https://github.com/${REPO}/pull/${PR}#issuecomment-111`;

const spec = (status = 'specifying', tier = 'T2') =>
  `---\nid: SPEC-228\ntitle: x\nstatus: ${status}\ntier: ${tier}\n---\n\n# Requirements\n\nFR-1 something.\n`;

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

function review(over: Partial<ReviewEvidence> = {}, headSha = HEAD): ReviewEvidence {
  return {
    pull: { number: PR, merged: false, headSha, headRef: 'agent/issue-2900', authorLogin: 'minspec-sdd[bot]', files: [SPEC] },
    artifactAtHead: spec(),
    comments: [
      {
        id: 111,
        url: VERDICT_URL,
        login: 'minspec-sdd[bot]',
        body: '## 🤖 AI review — `ai-review:pass`\n\nLooks right.',
        createdAt: '2026-10-21T01:00:30Z',
      },
    ],
    checkRuns: [
      { name: 'ai-review', status: 'completed', conclusion: 'success', appSlug: 'minspec-sdd', headSha, completedAt: '2026-10-21T01:01:00Z' },
    ],
    workflowRuns: [
      {
        path: '.github/workflows/ai-review.yml',
        event: 'pull_request',
        status: 'completed',
        headSha,
        runStartedAt: '2026-10-21T01:00:00Z',
        updatedAt: '2026-10-21T01:01:00Z',
      },
    ],
    ...over,
  };
}

const pull = (over: Partial<MergePull> = {}): MergePull => ({
  number: PR,
  state: 'open',
  draft: false,
  baseRef: 'main',
  headSha: HEAD,
  headRef: 'agent/issue-2900',
  authorLogin: 'minspec-sdd[bot]',
  labels: ['ai-review:pass', 'needs-human-review', 'awaiting-approval'],
  ...over,
});

const file = (over: Partial<MergeFile> = {}): MergeFile => ({
  path: SPEC,
  status: 'added',
  headContent: spec(),
  baseContent: null,
  ...over,
});

function input(over: Partial<MergeInput> = {}): MergeInput {
  return {
    repo: REPO,
    optedIn: true,
    shallow: false,
    stopClasses: 'approval-or-acceptance',
    pull: pull(),
    files: [file()],
    review: review(),
    delegations: [DLG],
    decisionStatus: (id) => (id === 'DR-108' ? 'accepted' : undefined),
    repeatFixShare: 0.08,
    today: '2026-10-21',
    ...over,
  };
}

const reasonOf = (i: MergeInput) => {
  const p = planDelegatedMerge(i);
  return p.arm ? 'ARMED' : p.reason;
};

describe('the covered case', () => {
  it('a new specifying T2 spec with a pass on its head is cleared, bound to that head', () => {
    const p = planDelegatedMerge(input());
    expect(p).toMatchObject({ arm: true, delegationId: 'DLG-001', headSha: HEAD, verdictBy: VERDICT_URL, classesAfter: [] });
  });

  it('an edit to a spec that is still specifying on the base is cleared too', () => {
    expect(reasonOf(input({ files: [file({ status: 'modified', baseContent: spec('specifying') })] }))).toBe('ARMED');
  });

  it.each(['T1', 'T2', 'T3', 'T4'])('tier %s is covered', (tier) => {
    expect(reasonOf(input({ files: [file({ headContent: spec('specifying', tier) })] }))).toBe('ARMED');
  });
});

describe('scope: only spec requirements, never plans, governance or machinery', () => {
  it.each([
    ['specs/minspec/SPEC-228-ci-parity/design.md', 'plan-artifact'],
    ['specs/minspec/SPEC-228-ci-parity/tasks.md', 'plan-artifact'],
    ['.minspec/constitution.md', 'path-out-of-scope'],
    ['.minspec/delegations.json', 'path-out-of-scope'],
    ['.minspec/config.json', 'path-out-of-scope'],
    ['.minspec/approvals/specs/minspec/SPEC-228-ci-parity/requirements.md.json', 'path-out-of-scope'],
    ['.github/workflows/ci.yml', 'path-out-of-scope'],
    ['scripts/lib/autonomy.ts', 'path-out-of-scope'],
    ['scripts/dispatch-issue.sh', 'path-out-of-scope'],
    ['docs/decisions/DR-108.md', 'path-out-of-scope'],
    ['docs/decisions/DR-200.md', 'path-out-of-scope'],
    ['packages/minspec/src/extension.ts', 'path-out-of-scope'],
    ['CLAUDE.md', 'path-out-of-scope'],
    ['specs/minspec/tasks.md', 'plan-artifact'],
    ['specs/minspec/README.md', 'path-out-of-scope'],
    ['specs/minspec/SPEC-228-ci-parity/notes.md', 'path-out-of-scope'],
  ])('%s alongside a spec denies (%s)', (extra, reason) => {
    expect(reasonOf(input({ files: [file(), file({ path: extra })] }))).toBe(reason);
  });

  it('a plan-only pull request denies (#2980)', () => {
    expect(reasonOf(input({ files: [file({ path: 'specs/minspec/SPEC-067-triage-dispute/design.md' })] }))).toBe('plan-artifact');
  });

  it('memory-fabric is never delegated, whatever the record says', () => {
    const mf = { ...DLG, repo: 'harvest316/memory-fabric' };
    expect(reasonOf(input({ repo: 'harvest316/memory-fabric', delegations: [mf] }))).toBe('repo-never-delegated');
    expect(reasonOf(input({ repo: 'AIClarityAU/Memory-Fabric', delegations: [mf] }))).toBe('repo-never-delegated');
  });

  it('a repo with no matching delegation denies', () => {
    expect(reasonOf(input({ repo: 'AIClarityAU/sealbox' }))).toBe('verdict-not-on-this-pr');
    // with the verdict on the right repo, the delegation itself is what is missing
    const url = `https://github.com/AIClarityAU/sealbox/pull/${PR}#issuecomment-111`;
    const r = review();
    expect(
      reasonOf(input({ repo: 'AIClarityAU/sealbox', review: { ...r, comments: [{ ...r.comments[0], url }] } })),
    ).toBe('delegation-no-live-delegation');
  });

  it('a removed or renamed spec file denies', () => {
    expect(reasonOf(input({ files: [file({ status: 'removed' })] }))).toBe('file-status-not-admitted');
    expect(reasonOf(input({ files: [file({ status: 'renamed' })] }))).toBe('file-status-not-admitted');
    expect(reasonOf(input({ files: [file({ status: '' })] }))).toBe('file-status-not-admitted');
  });
});

describe('merging is not approving: the spec must stay pre-approval', () => {
  it.each(['planning', 'implementing', 'done', 'archived', 'superseded'])('head status %s denies', (st) => {
    expect(reasonOf(input({ files: [file({ headContent: spec(st) })] }))).toBe('status-not-specifying');
  });

  it('a spec with no status denies', () => {
    expect(reasonOf(input({ files: [file({ headContent: '---\nid: SPEC-1\ntier: T2\n---\n' })] }))).toBe('status-not-specifying');
  });

  it.each(['planning', 'implementing'])('editing a spec that is %s on the base denies', (st) => {
    expect(reasonOf(input({ files: [file({ status: 'modified', baseContent: spec(st) })] }))).toBe('edits-approved-spec');
  });

  it.each([undefined, 'T5', 't2', ''])('tier %s denies; a tier is never invented', (tier) => {
    const c = tier === undefined ? '---\nid: SPEC-1\nstatus: specifying\n---\n' : spec('specifying', tier);
    expect(reasonOf(input({ files: [file({ headContent: c })] }))).toBe('tier-unknown');
  });
});

describe('the review must have passed on the CURRENT head', () => {
  it('no ai-review:pass label denies', () => {
    expect(reasonOf(input({ pull: pull({ labels: ['needs-human-review'] }) }))).toBe('review-not-pass');
  });

  it.each(['ai-review:changes', 'ai-review:blocked'])('%s beside a pass label denies', (l) => {
    expect(reasonOf(input({ pull: pull({ labels: ['ai-review:pass', l] }) }))).toBe('review-not-pass');
  });

  it('a hold:* label denies', () => {
    expect(reasonOf(input({ pull: pull({ labels: ['ai-review:pass', 'hold:human'] }) }))).toBe('held-by-label');
  });

  it('the label alone is not enough: no review evidence denies', () => {
    expect(reasonOf(input({ review: undefined }))).toBe('no-review-evidence');
  });

  it('a pass recorded on an older head denies (stale)', () => {
    const old = 'b'.repeat(40);
    expect(reasonOf(input({ review: review({}, old) }))).toBe('head-moved');
    // evidence for the current head, but the check-run and run are on the old one
    const r = review();
    expect(
      reasonOf(input({ review: { ...r, checkRuns: r.checkRuns.map((c) => ({ ...c, headSha: old })) } })),
    ).toBe('no-ai-review-check');
    expect(
      reasonOf(input({ review: { ...r, workflowRuns: r.workflowRuns.map((w) => ({ ...w, headSha: old })) } })),
    ).toBe('no-ai-review-run');
  });

  it('a later ai-review:changes comment wins over an earlier pass', () => {
    const r = review();
    const later = { ...r.comments[0], id: 112, url: VERDICT_URL.replace('111', '112'), body: '## 🤖 AI review — `ai-review:changes`', createdAt: '2026-10-21T01:00:50Z' };
    expect(reasonOf(input({ review: { ...r, comments: [r.comments[0], later] } }))).toBe('latest-review-not-pass');
  });

  it('a pass comment posted outside any CI run on the head denies', () => {
    const r = review();
    const forged = { ...r.comments[0], createdAt: '2026-10-21T05:00:00Z' };
    expect(reasonOf(input({ review: { ...r, comments: [forged] } }))).toBe('comment-outside-ci-run');
  });

  it('a pass comment from another identity is not a verdict', () => {
    const r = review();
    expect(reasonOf(input({ review: { ...r, comments: [{ ...r.comments[0], login: 'harvest316' }] } }))).toBe('no-ai-review-comment');
  });

  it('a failed check-run on the head denies', () => {
    const r = review();
    expect(
      reasonOf(input({ review: { ...r, checkRuns: [{ ...r.checkRuns[0], conclusion: 'failure' }] } })),
    ).toBe('ai-review-check-not-success');
  });

  it('a verdict comment on another pull request denies', () => {
    const r = review();
    const url = `https://github.com/${REPO}/pull/9999#issuecomment-111`;
    expect(reasonOf(input({ review: { ...r, comments: [{ ...r.comments[0], url }] } }))).toBe('verdict-not-on-this-pr');
  });
});

describe('the delegation record and its tripwire', () => {
  it('an absent or unparseable delegation file denies', () => {
    expect(reasonOf(input({ delegations: undefined }))).toBe('no-delegation-record');
    expect(reasonOf(input({ delegations: [] }))).toBe('delegation-no-live-delegation');
  });

  it('a delegation whose decision is not accepted covers nothing', () => {
    expect(reasonOf(input({ decisionStatus: () => 'proposed' }))).toBe('delegation-no-live-delegation');
    expect(reasonOf(input({ decisionStatus: () => undefined }))).toBe('delegation-no-live-delegation');
  });

  it('a lapsed delegation covers nothing', () => {
    expect(reasonOf(input({ today: '2027-01-18' }))).toBe('delegation-no-live-delegation');
  });

  it('a delegation that does not cover spec approval covers nothing', () => {
    expect(reasonOf(input({ delegations: [{ ...DLG, covers: ['engineering-dr-acceptance'] }] }))).toBe('delegation-no-live-delegation');
  });

  it('a delegation that does not cover the tier covers nothing', () => {
    expect(reasonOf(input({ delegations: [{ ...DLG, tiers: ['T1'] }] }))).toBe('delegation-no-live-delegation');
  });

  it('an unknown repeat-fix share denies', () => {
    expect(reasonOf(input({ repeatFixShare: undefined }))).toBe('delegation-tripwire-unknown');
    expect(reasonOf(input({ repeatFixShare: Number.NaN }))).toBe('delegation-tripwire-unknown');
  });

  it('a share over the tripwire denies', () => {
    expect(reasonOf(input({ repeatFixShare: 0.131 }))).toBe('delegation-tripwire-tripped');
  });

  it('a shallow or unreadable clone denies', () => {
    expect(reasonOf(input({ shallow: true }))).toBe('shallow-clone');
    expect(reasonOf(input({ shallow: undefined }))).toBe('shallow-clone');
  });

  it('a repo that has not opted in denies', () => {
    expect(reasonOf(input({ optedIn: false }))).toBe('not-opted-in');
  });
});

describe('the stop classes: the delegation clears exactly one', () => {
  it('no stop classes given denies', () => {
    expect(reasonOf(input({ stopClasses: undefined }))).toBe('stop-classes-unknown');
  });

  it('an empty class list denies: this arm only clears a delegated hold', () => {
    expect(reasonOf(input({ stopClasses: '' }))).toBe('stop-classes-unexpected');
  });

  it.each(['irreversible-or-outward-facing', 'edits-the-autonomy-rules', 'spend-above-threshold'])(
    '%s without approval-or-acceptance denies',
    (c) => {
      expect(reasonOf(input({ stopClasses: c }))).toBe('stop-classes-unexpected');
    },
  );

  it.each(['irreversible-or-outward-facing', 'edits-the-autonomy-rules', 'no-such-class'])(
    'approval-or-acceptance plus %s denies: the other class survives the delegation',
    (c) => {
      expect(reasonOf(input({ stopClasses: `approval-or-acceptance,${c}` }))).toBe('other-stop-class');
    },
  );

  it('parseStopClasses keeps unknown tokens and drops only empty ones', () => {
    expect(parseStopClasses(' approval-or-acceptance, ,bogus ')).toEqual(['approval-or-acceptance', 'bogus']);
  });
});

describe('the pull request itself', () => {
  it.each([
    [{ state: 'closed' }, 'pr-not-open'],
    [{ draft: true }, 'pr-draft'],
    [{ baseRef: 'release' }, 'pr-base-not-main'],
    [{ headSha: '' }, 'pr-unreadable'],
  ] as const)('%o denies (%s)', (over, reason) => {
    expect(reasonOf(input({ pull: pull(over) }))).toBe(reason);
  });

  it('unreadable inputs deny', () => {
    expect(reasonOf(input({ pull: undefined }))).toBe('pr-unreadable');
    expect(reasonOf(input({ files: undefined }))).toBe('files-unreadable');
    expect(reasonOf(input({ files: [] }))).toBe('no-files');
    expect(reasonOf(input({ files: [file({ headContent: null })] }))).toBe('head-content-unreadable');
    expect(reasonOf(input({ files: [file({ status: 'modified', baseContent: undefined })] }))).toBe('base-unreadable');
  });
});

describe('gathering: every read failure becomes a denial, never a pass', () => {
  const okGit = (args: readonly string[]): string => {
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return 'false\n';
    if (args[0] === 'cat-file') {
      if (String(args[2]).endsWith(SPEC)) throw new Error('absent');
      return '';
    }
    if (args[0] === 'show') {
      const rel = String(args[1]).split(':')[1];
      if (rel === '.minspec/delegations.json') return JSON.stringify({ version: 1, delegations: [DLG] });
      if (rel === 'docs/decisions/DR-108.md') return '---\nid: DR-108\nstatus: accepted\n---\n';
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
        merged: false,
        base: { ref: 'main' },
        head: { sha: HEAD, ref: 'agent/issue-2900' },
        user: { login: 'minspec-sdd[bot]' },
        labels: [{ name: 'ai-review:pass' }, { name: 'needs-human-review' }],
      });
    }
    if (route.startsWith(`repos/${REPO}/pulls/${PR}/files`)) return JSON.stringify([{ filename: SPEC, status: 'added' }]);
    if (route.includes('/contents/')) return spec();
    const r = review();
    if (route.startsWith(`repos/${REPO}/issues/${PR}/comments`)) {
      return JSON.stringify(r.comments.map((c) => ({ id: c.id, html_url: c.url, user: { login: c.login }, body: c.body, created_at: c.createdAt })));
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
    today: () => '2026-10-21',
    exists: () => true,
    ...over,
  });
  const args = { pr: PR, repo: REPO, base: 'origin/main', stopClasses: 'approval-or-acceptance' };
  const plan = (d: MergeDeps) => planDelegatedMerge(gatherMergeInput(args, d));

  it('the all-good world is cleared (control for the denials below)', () => {
    expect(plan(deps())).toMatchObject({ arm: true, headSha: HEAD });
  });

  it('a gh failure on the pull request denies', () => {
    expect(plan(deps({ gh: () => { throw new Error('HTTP 401'); } }))).toMatchObject({ arm: false, reason: 'pr-unreadable' });
  });

  it('a gh failure on the comments denies', () => {
    const gh = (a: readonly string[]) => {
      if (a[a.length - 1].includes('/comments')) throw new Error('HTTP 502');
      return okGh(a);
    };
    expect(plan(deps({ gh }))).toMatchObject({ arm: false, reason: 'no-review-evidence' });
  });

  it('a shallow clone denies', () => {
    const git = (a: readonly string[]) => (a[1] === '--is-shallow-repository' ? 'true\n' : okGit(a));
    expect(plan(deps({ git }))).toMatchObject({ arm: false, reason: 'shallow-clone' });
  });

  it('a failed base fetch denies', () => {
    const git = (a: readonly string[]) => {
      if (a[0] === 'fetch') throw new Error('network');
      return okGit(a);
    };
    expect(plan(deps({ git }))).toMatchObject({ arm: false });
  });

  it('an unmeasurable repeat-fix share denies', () => {
    expect(plan(deps({ repeatFixShare: () => undefined }))).toMatchObject({ arm: false, reason: 'delegation-tripwire-unknown' });
  });

  it('an unparseable delegation file denies', () => {
    const git = (a: readonly string[]) => (a[0] === 'show' && String(a[1]).endsWith('delegations.json') ? '{not json' : okGit(a));
    expect(plan(deps({ git }))).toMatchObject({ arm: false, reason: 'no-delegation-record' });
  });

  it('no .minspec/ denies', () => {
    expect(plan(deps({ exists: () => false }))).toMatchObject({ arm: false, reason: 'not-opted-in' });
  });
});

describe('argv', () => {
  it('requires --pr and --stop-classes, and accepts an empty class list', () => {
    expect(parseMergeArgs(['--stop-classes', 'x'], '/r')).toMatch(/--pr/);
    expect(parseMergeArgs(['--pr', '5'], '/r')).toMatch(/--stop-classes/);
    expect(parseMergeArgs(['--pr', '0', '--stop-classes', 'x'], '/r')).toMatch(/--pr/);
    expect(parseMergeArgs(['--pr', '5', '--bogus', 'x'], '/r')).toMatch(/unknown/);
    expect(parseMergeArgs(['--pr', '5', '--stop-classes', ''], '/r')).toMatchObject({ pr: 5, stopClasses: '' });
  });
});
