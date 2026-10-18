/**
 * T1 contract test (the test tier, not the SDD ceremony tier) — #2243: the PR seam provisions
 * MinSpec's OWN lane label, and nothing else. Decision: DR-098 (lane-label provisioning).
 *
 * `gh pr create --label docs-lane` fails outright in a repository that has no
 * `docs-lane` label (`could not add label: 'docs-lane' not found`, nothing created).
 * That single refusal is why approvals in voip-sms-inbox needed an `Open PR` click and
 * a manual merge while this repository's landed on their own. The parity test
 * (`approval-lane-label-parity.test.ts`) proves the flow end to end; this file pins the
 * seam's contract, because it is a forge WRITE and every edge of it has to be exact:
 *
 *   - only when the caller opts in (`provisionLaneLabel`), so SPEC-039's command keeps
 *     its pinned behaviour (R3/AC-10) and gains no call;
 *   - only for `DOCS_LANE_LABEL`, never for whatever label name gh happens to report;
 *   - at most once per call, and never `--force` (which would rewrite a label a
 *     maintainer customised);
 *   - a create that loses a race to another approval counts as success;
 *   - every failure still resolves a typed outcome (INV-5), now naming the label.
 */

import { describe, it, expect } from 'vitest';
import {
  DOCS_LANE_LABEL,
  DOCS_LANE_LABEL_COLOR,
  DOCS_LANE_LABEL_DESCRIPTION,
  buildLaneLabelCreateArgs,
  missingLabelFrom,
  openPullRequest,
  type ExecRun,
} from '../src/lib/approval-pr';

interface Call {
  file: string;
  args: string[];
  cwd?: string;
}

/** A runner that answers each call in order from a script; unscripted calls are a test bug. */
function scripted(
  steps: Array<(c: Call) => { stdout: string; stderr: string }>,
): { run: ExecRun; calls: Call[] } {
  const calls: Call[] = [];
  const run: ExecRun = async (file, args, opts) => {
    const call = { file, args: [...args], cwd: opts?.cwd };
    calls.push(call);
    const step = steps.shift();
    if (!step) throw new Error(`TEST BUG: unscripted call ${file} ${args.join(' ')}`);
    return step(call);
  };
  return { run, calls };
}

const ok = (stdout = ''): (() => { stdout: string; stderr: string }) => () => ({ stdout, stderr: '' });
const fail =
  (stderr: string, extra: Record<string, unknown> = {}): (() => never) =>
  () => {
    throw Object.assign(new Error('Command failed (exit 1)'), { stderr, ...extra });
  };

/** gh 2.100.0's exact refusal, captured from a `--dry-run` against voip-sms-inbox. */
const MISSING_LANE = "could not add label: 'docs-lane' not found";
const LABEL_EXISTS =
  'label with name "docs-lane" already exists; use `--force` to update its color and description';
const URL = 'https://github.com/o/r/pull/7';

const REQ = {
  cwd: '/repo',
  head: 'approvals/spec-003-x',
  title: 'chore(approve): SPEC-003 approved for implementation',
  body: 'body',
  labels: [DOCS_LANE_LABEL],
};

const kinds = (calls: Call[]): string[] => calls.map((c) => `${c.file} ${c.args[0]} ${c.args[1]}`);

// =============================================================================

describe('missingLabelFrom', () => {
  it.each([
    [MISSING_LANE, 'docs-lane'],
    [`${MISSING_LANE}\n`, 'docs-lane'],
    ["could not add label: 'hold:human' not found", 'hold:human'],
  ])('reads the label name out of gh\'s refusal: %j', (msg, name) => {
    expect(missingLabelFrom(msg)).toBe(name);
  });

  it.each([
    'pull request create failed: validation failed',
    LABEL_EXISTS,
    "could not add assignee: 'someone' not found",
    '',
  ])('answers undefined for anything else: %j', (msg) => {
    expect(missingLabelFrom(msg)).toBeUndefined();
  });
});

describe('buildLaneLabelCreateArgs', () => {
  it('creates exactly the lane label, with the colour and description this repo carries', () => {
    expect(buildLaneLabelCreateArgs()).toEqual([
      'label',
      'create',
      DOCS_LANE_LABEL,
      '--color',
      DOCS_LANE_LABEL_COLOR,
      '--description',
      DOCS_LANE_LABEL_DESCRIPTION,
    ]);
  });

  it('targets the same repo as the PR when a slug is given', () => {
    const argv = buildLaneLabelCreateArgs('o/r');
    expect(argv.slice(0, 3)).toEqual(['label', 'create', DOCS_LANE_LABEL]);
    expect(argv).toEqual(expect.arrayContaining(['--repo', 'o/r']));
  });

  it('never passes --force, which would overwrite a label a maintainer customised', () => {
    expect(buildLaneLabelCreateArgs()).not.toContain('--force');
    expect(buildLaneLabelCreateArgs('o/r')).not.toContain('--force');
  });
});

describe('openPullRequest — lane label provisioning (#2243)', () => {
  it('creates the missing lane label once, retries once, and reports that it did', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE), ok(), ok(`${URL}\n`)]);
    const res = await openPullRequest({ ...REQ, run, provisionLaneLabel: true });

    expect(res).toEqual({ outcome: 'created', url: URL, labelProvisioned: true });
    expect(kinds(calls)).toEqual(['gh pr create', 'gh label create', 'gh pr create']);
    expect(calls[1].args).toEqual(buildLaneLabelCreateArgs());
    // The retry is the SAME request — still labelled, so the lane still sees it.
    expect(calls[2].args).toEqual(calls[0].args);
    expect(calls.every((c) => c.cwd === '/repo')).toBe(true);
  });

  it('keeps the FR-6 probe first when adoption is on', async () => {
    const { run, calls } = scripted([ok('[]\n'), fail(MISSING_LANE), ok(), ok(`${URL}\n`)]);
    const res = await openPullRequest({ ...REQ, run, adoptExisting: true, provisionLaneLabel: true });
    expect(res.outcome).toBe('created');
    expect(kinds(calls)).toEqual(['gh pr list', 'gh pr create', 'gh label create', 'gh pr create']);
  });

  it('passes the request slug to the label create, so both writes hit one repo', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE), ok(), ok(`${URL}\n`)]);
    await openPullRequest({ ...REQ, slug: 'o/r', run, provisionLaneLabel: true });
    expect(calls[1].args).toEqual(buildLaneLabelCreateArgs('o/r'));
  });

  it('a label another approval created first is success, not failure — and not claimed', async () => {
    // Three approvals in a row (SPEC-003/004/005 took 16 s) race on the first create.
    const { run, calls } = scripted([fail(MISSING_LANE), fail(LABEL_EXISTS), ok(`${URL}\n`)]);
    const res = await openPullRequest({ ...REQ, run, provisionLaneLabel: true });
    expect(res).toEqual({ outcome: 'created', url: URL });
    expect(kinds(calls)).toEqual(['gh pr create', 'gh label create', 'gh pr create']);
  });

  it('a label it cannot create fails typed, names the label, and does NOT retry the PR', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE), fail('HTTP 403: Resource not accessible by integration')]);
    const res = await openPullRequest({ ...REQ, run, provisionLaneLabel: true });
    expect(res.outcome).toBe('failed');
    expect(res.missingLabel).toBe(DOCS_LANE_LABEL);
    expect(res.error).toContain(MISSING_LANE);
    expect(res.error).toContain('HTTP 403');
    expect(kinds(calls)).toEqual(['gh pr create', 'gh label create']);
  });

  it('provisions at most ONCE — a second identical refusal is reported, not looped on', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE), ok(), fail(MISSING_LANE)]);
    const res = await openPullRequest({ ...REQ, run, provisionLaneLabel: true });
    expect(res).toMatchObject({ outcome: 'failed', missingLabel: DOCS_LANE_LABEL });
    expect(calls.filter((c) => c.args[0] === 'label')).toHaveLength(1);
  });

  it('classifies a failed RETRY exactly like a first attempt', async () => {
    const { run } = scripted([
      fail(MISSING_LANE),
      ok(),
      fail('You are not logged into any GitHub hosts. Run gh auth login to authenticate.'),
    ]);
    const res = await openPullRequest({ ...REQ, run, provisionLaneLabel: true });
    expect(res.outcome).toBe('gh-unauthenticated');
  });

  it('never creates a label other than the lane label, whatever gh names', async () => {
    // A maintainer's own label missing is not MinSpec's to create.
    const { run, calls } = scripted([fail("could not add label: 'hold:human' not found")]);
    const res = await openPullRequest({
      ...REQ,
      labels: [DOCS_LANE_LABEL, 'hold:human'],
      run,
      provisionLaneLabel: true,
    });
    expect(res).toMatchObject({ outcome: 'failed', missingLabel: 'hold:human' });
    expect(kinds(calls)).toEqual(['gh pr create']);
  });

  it('never creates the lane label for a request that does not carry it', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE)]);
    const res = await openPullRequest({ ...REQ, labels: [], run, provisionLaneLabel: true });
    expect(res.outcome).toBe('failed');
    expect(kinds(calls)).toEqual(['gh pr create']);
  });

  it('WITHOUT the opt-in (SPEC-039\'s command) it makes no label call — only names the gap', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE)]);
    const res = await openPullRequest({ ...REQ, run });
    expect(res).toEqual({ outcome: 'failed', error: MISSING_LANE, missingLabel: DOCS_LANE_LABEL });
    expect(kinds(calls)).toEqual(['gh pr create']);
  });

  it('never throws, even when the label create throws a non-Error (INV-5)', async () => {
    const run: ExecRun = async (_file, args) => {
      if (args[0] === 'label') throw 'boom';
      throw Object.assign(new Error('exit 1'), { stderr: MISSING_LANE });
    };
    await expect(openPullRequest({ ...REQ, run, provisionLaneLabel: true })).resolves.toMatchObject({
      outcome: 'failed',
      missingLabel: DOCS_LANE_LABEL,
    });
  });

  it('spawns no git at all on this path (INV-3)', async () => {
    const { run, calls } = scripted([fail(MISSING_LANE), ok(), ok(`${URL}\n`)]);
    await openPullRequest({ ...REQ, run, provisionLaneLabel: true });
    expect(calls.filter((c) => c.file === 'git')).toEqual([]);
  });
});
