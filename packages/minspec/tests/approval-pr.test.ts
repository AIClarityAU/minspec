/**
 * approval-pr — T0/T1 tests for SPEC-050's shared `gh pr create` seam (Slice 1).
 *
 * The seam is the ONE PR-opening path in the codebase (FR-4), so these tests pin
 * the properties that make that consolidation safe rather than merely tidy:
 *
 *   FR-4 / AC-10 — the argv it builds for SPEC-039's inputs is byte-identical to
 *     the literal array it replaced, and `adoptExisting` defaults to `false` so
 *     the extraction added no call SPEC-039's command did not already make. Both
 *     are asserted here as well as by `push-docs-lane.test.ts` passing unedited.
 *   INV-2 — `laneLabelsFor` is the only `docs-lane` minter, and it refuses to
 *     mint on a non-corpus path OR on an empty list (an unproven absolute fails
 *     closed; constitution invariant #2).
 *   INV-3 — the seam's only `git` call is the read-only `rev-parse HEAD`. Every
 *     scenario's recorded argv is checked for `checkout`/`switch`/`merge`/
 *     `rebase`/`reset`, aggregated in an `afterEach`, so this holds for tests
 *     added later too — asserted on the argv, never by inspection (AC-8).
 *   INV-4 — `buildApprovalPrBody` presents a record and writes nothing; with no
 *     record it OMITS the provenance lines rather than inventing them.
 *   INV-5 — every failure resolves a typed outcome. Nothing here ever rejects,
 *     including when the runner throws a non-`Error`.
 *
 * NO vscode mock: the seam is Tier-0 and imports no editor surface at all. If
 * that ever changes, this file stops compiling for the right reason (and
 * `import-boundaries.test.ts`'s exactly-seven vscode-warn set fails first).
 *
 * FILE ALLOWLIST (SPEC-050 Slice 1): src/lib/approval-pr.ts,
 * src/commands/push-docs-lane.ts, tests/approval-pr.test.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  DOCS_LANE_LABEL,
  buildApprovalPrBody,
  buildPrCreateArgs,
  describeError,
  isAuthError,
  isEnoent,
  isNetworkError,
  laneLabelsFor,
  openPullRequest,
  resolveHeadSha,
  slugFromOriginUrl,
  type ExecRun,
} from '../src/lib/approval-pr';
import type { ApprovalRecord } from '../src/lib/approval';

// ─── An injectable git/gh runner driven by a response table ──────────────────
// Same shape as `push-docs-lane.test.ts`'s harness (deliberately — the two suites
// exercise the same runner contract, so they must model it identically).

type ResponderVal =
  | string
  | Error
  | (() => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string });

interface Call {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  key: string;
}

/** Every call any responder in this file recorded — drained by the AC-8 afterEach. */
let allCalls: Call[] = [];

function responder(map: Record<string, ResponderVal>): { run: ExecRun; calls: Call[] } {
  const calls: Call[] = [];
  const run: ExecRun = async (file, args, opts) => {
    const key = `${file} ${args.join(' ')}`;
    const call: Call = { file, args: [...args], cwd: opts?.cwd, env: opts?.env, key };
    calls.push(call);
    allCalls.push(call);
    let val: ResponderVal | undefined = map[key];
    if (val === undefined) {
      const hit = Object.entries(map).find(([k]) => key.startsWith(k));
      val = hit?.[1];
    }
    if (val === undefined) return { stdout: '', stderr: '' };
    if (val instanceof Error) throw val;
    if (typeof val === 'function') return val();
    return { stdout: val, stderr: '' };
    // NOTE: no non-Error-throw arm here on purpose — the INV-5 backstop test
    // injects a bare `ExecRun` that does `throw 'boom'` directly, so widening
    // ResponderVal to `unknown` (which collapses the union and stops
    // type-checking every response table in this file) buys nothing.
  };
  return { run, calls };
}

function enoent(): Error {
  const e = new Error('spawn gh ENOENT') as Error & { code: string };
  e.code = 'ENOENT';
  return e;
}
const authErr = (): Error =>
  Object.assign(new Error('exit 1'), {
    stderr: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
  });
const netErr = (): Error =>
  Object.assign(new Error('exit 1'), { stderr: 'fatal: could not resolve host: github.com' });
const plainErr = (): Error =>
  Object.assign(new Error('exit 1'), { stderr: 'pull request create failed: validation failed' });

const prCreateCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create');
const prListCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'list');

/**
 * AC-8 / INV-3: the seam must NEVER move a checkout. Asserted on the recorded
 * argv of every call the suite made, not by reading the source.
 */
const CHECKOUT_MOVING_VERBS = ['checkout', 'switch', 'merge', 'rebase', 'reset'];
function expectCheckoutNeverMoved(calls: Call[]): void {
  const moved = calls.filter(
    (c) => c.file === 'git' && CHECKOUT_MOVING_VERBS.some((v) => c.args.includes(v)),
  );
  expect(moved.map((c) => c.key)).toEqual([]);
}

afterEach(() => {
  // Aggregate guard: holds for every scenario in this file, including ones added
  // later that forget to assert it themselves.
  expectCheckoutNeverMoved(allCalls);
  allCalls = [];
});

const BASE_REQ = {
  cwd: '/repo',
  head: 'approvals/spec-050-abc1234',
  title: 'chore(approve): SPEC-050 approved for implementation',
  body: 'body text',
  labels: [DOCS_LANE_LABEL],
};

// =============================================================================
// buildPrCreateArgs — pure; the flags MinSpec would actually send
// =============================================================================

describe('buildPrCreateArgs', () => {
  it('reproduces SPEC-039 push-docs-lane argv exactly, in order (AC-10)', () => {
    // This literal IS the `prArgs` array that push-docs-lane.ts built inline
    // before the extraction (see the SPEC-050 Slice 1 diff). If the seam ever
    // reorders or drops a flag, this fails here as well as in
    // push-docs-lane.test.ts's arrayContaining assertions.
    expect(
      buildPrCreateArgs({
        slug: 'AIClarityAU/minspec',
        base: 'main',
        head: 'docs-lane/abc1234-1',
        title: 'docs: add DR-042',
        body: 'Docs-only change',
        labels: [DOCS_LANE_LABEL],
      }),
    ).toEqual([
      'pr',
      'create',
      '--repo',
      'AIClarityAU/minspec',
      '--base',
      'main',
      '--head',
      'docs-lane/abc1234-1',
      '--title',
      'docs: add DR-042',
      '--label',
      'docs-lane',
      '--body',
      'Docs-only change',
    ]);
  });

  it('omits --repo without a slug and --base without a base (gh infers both)', () => {
    const args = buildPrCreateArgs({
      head: 'approvals/x',
      title: 't',
      body: 'b',
      labels: [DOCS_LANE_LABEL],
    });
    expect(args).not.toContain('--repo');
    expect(args).not.toContain('--base');
    expect(args.slice(0, 2)).toEqual(['pr', 'create']);
    expect(args).toEqual(expect.arrayContaining(['--head', 'approvals/x']));
  });

  it('emits one --label pair per label, and NO --label for an empty list', () => {
    expect(
      buildPrCreateArgs({ head: 'h', title: 't', body: 'b', labels: ['a', 'b'] }),
    ).toEqual(expect.arrayContaining(['--label', 'a', '--label', 'b']));

    const none = buildPrCreateArgs({ head: 'h', title: 't', body: 'b', labels: [] });
    expect(none).not.toContain('--label');
    expect(none).not.toContain(DOCS_LANE_LABEL);
  });
});

// =============================================================================
// laneLabelsFor — INV-2, the single docs-lane minter
// =============================================================================

describe('laneLabelsFor (INV-2)', () => {
  it('labels an approval commit whose paths are all corpus (doc + sidecar)', () => {
    expect(
      laneLabelsFor([
        'specs/minspec/SPEC-050-silent-approval-pr/requirements.md',
        '.minspec/approvals/specs/minspec/SPEC-050-silent-approval-pr/requirements.md.json',
      ]),
    ).toEqual([DOCS_LANE_LABEL]);
    expect(laneLabelsFor(['docs/decisions/DR-071.md', 'docs/decisions/INDEX.md'])).toEqual([
      DOCS_LANE_LABEL,
    ]);
    // CLAUDE.md, not README.md, on purpose: both are top-level `.md` and so both
    // ARE corpus, but `docs-lane.yml`'s separate `outward` denylist rejects
    // README/CHANGELOG/LICENCE/NOTICE. Asserting README here would bake a
    // client/server disagreement into the fixture as if it were the intent. The
    // mismatch is SPEC-039's, pre-dates this seam, and is untouched by it —
    // `laneLabelsFor` is deliberately the corpus predicate and nothing more.
    expect(laneLabelsFor(['CLAUDE.md', 'skills/wrapup/SKILL.md'])).toEqual([DOCS_LANE_LABEL]);
  });

  it('refuses the label when ANY path is outside the corpus', () => {
    // One source file among the docs is enough — this is the case that would
    // otherwise ride an auto-merge lane without a human merge keystroke.
    expect(
      laneLabelsFor(['specs/x/requirements.md', 'packages/minspec/src/lib/approval-pr.ts']),
    ).toEqual([]);
    // A NESTED .md is deliberately not corpus (docs-corpus.ts: `[^/]+\.md$`).
    expect(laneLabelsFor(['packages/minspec/x.md'])).toEqual([]);
    // A parent-escape can never satisfy the corpus predicate.
    expect(laneLabelsFor(['../escape.md'])).toEqual([]);
    // An executable under skills/ is not corpus — prose an agent reads, never
    // code it runs.
    expect(laneLabelsFor(['skills/wrapup/run.sh'])).toEqual([]);
  });

  it('refuses the label for an EMPTY list — `every` is vacuously true, so the guard is explicit', () => {
    // A caller that cannot enumerate what it committed has not PROVEN the change
    // is docs-only. Failing closed here is the whole reason this is a function
    // and not an inline `.every(...)` at each call site.
    expect(laneLabelsFor([])).toEqual([]);
  });
});

// =============================================================================
// openPullRequest — the one gh pr create (FR-2/FR-5/FR-6/INV-5)
// =============================================================================

describe('openPullRequest — happy path', () => {
  it('creates exactly one PR, labelled, and returns the TRIMMED url', async () => {
    const { run, calls } = responder({
      'gh pr create': 'https://github.com/AIClarityAU/minspec/pull/1200\n',
    });

    const res = await openPullRequest({ ...BASE_REQ, run });

    expect(res).toEqual({
      outcome: 'created',
      url: 'https://github.com/AIClarityAU/minspec/pull/1200',
    });
    expect(prCreateCalls(calls)).toHaveLength(1);
    const argv = prCreateCalls(calls)[0].args;
    expect(argv.slice(0, 2)).toEqual(['pr', 'create']);
    expect(argv).toEqual(expect.arrayContaining(['--label', DOCS_LANE_LABEL]));
    expect(argv).toEqual(expect.arrayContaining(['--head', BASE_REQ.head]));
    expect(argv).toEqual(expect.arrayContaining(['--title', BASE_REQ.title]));
    expect(calls[0].cwd).toBe('/repo');
    expectCheckoutNeverMoved(calls);
  });

  it('never spawns git at all on the create path (INV-3)', async () => {
    const { run, calls } = responder({ 'gh pr create': 'https://x/1\n' });
    await openPullRequest({ ...BASE_REQ, run });
    expect(calls.filter((c) => c.file === 'git')).toEqual([]);
  });
});

describe('openPullRequest — idempotency (FR-6 / AC-5)', () => {
  it('adopts an existing open PR and NEVER runs pr create', async () => {
    const { run, calls } = responder({
      'gh pr list': '[{"url":"https://github.com/AIClarityAU/minspec/pull/42"}]\n',
    });

    const res = await openPullRequest({ ...BASE_REQ, run, adoptExisting: true });

    expect(res).toEqual({
      outcome: 'adopted',
      url: 'https://github.com/AIClarityAU/minspec/pull/42',
    });
    expect(prCreateCalls(calls)).toEqual([]);
    expect(prListCalls(calls)).toHaveLength(1);
    expect(prListCalls(calls)[0].args).toEqual(
      expect.arrayContaining(['--head', BASE_REQ.head, '--state', 'open', '--json', 'url']),
    );
  });

  it.each([
    ['empty stdout', ''],
    ['an empty array', '[]\n'],
    ['malformed JSON', 'not json at all\n'],
    ['an unexpected shape', '{"url":"https://x/9"}\n'],
    ['an entry with no url', '[{}]\n'],
  ])('falls through to create when pr list returns %s (never throws)', async (_label, stdout) => {
    const { run, calls } = responder({
      'gh pr list': stdout,
      'gh pr create': 'https://github.com/AIClarityAU/minspec/pull/7\n',
    });

    const res = await openPullRequest({ ...BASE_REQ, run, adoptExisting: true });

    expect(res.outcome).toBe('created');
    expect(res.url).toBe('https://github.com/AIClarityAU/minspec/pull/7');
    expect(prCreateCalls(calls)).toHaveLength(1);
  });

  it('a failing pr list probe never decides the outcome — create still runs', async () => {
    const { run, calls } = responder({
      'gh pr list': netErr(),
      'gh pr create': 'https://github.com/AIClarityAU/minspec/pull/8\n',
    });
    const res = await openPullRequest({ ...BASE_REQ, run, adoptExisting: true });
    expect(res.outcome).toBe('created');
    expect(prCreateCalls(calls)).toHaveLength(1);
  });

  it('adopts when create loses the race and reports "already exists" with a url', async () => {
    const raced = Object.assign(new Error('exit 1'), {
      stderr:
        'a pull request for branch "approvals/spec-050-abc1234" into branch "main" already ' +
        'exists: https://github.com/AIClarityAU/minspec/pull/99.',
    });
    const { run } = responder({ 'gh pr list': '[]\n', 'gh pr create': raced });

    const res = await openPullRequest({ ...BASE_REQ, run, adoptExisting: true });

    // Trailing sentence punctuation must not end up inside the URL.
    expect(res).toEqual({
      outcome: 'adopted',
      url: 'https://github.com/AIClarityAU/minspec/pull/99',
    });
  });

  it('does NOT adopt an "already exists" error when adoptExisting is off (AC-10)', async () => {
    const raced = Object.assign(new Error('exit 1'), {
      stderr: 'already exists: https://github.com/AIClarityAU/minspec/pull/99',
    });
    const { run } = responder({ 'gh pr create': raced });
    const res = await openPullRequest({ ...BASE_REQ, run });
    expect(res.outcome).toBe('failed');
  });

  it('does NOT probe pr list by default — SPEC-039 gained no extra call (AC-10/R3)', async () => {
    const { run, calls } = responder({ 'gh pr create': 'https://x/1\n' });
    await openPullRequest({ ...BASE_REQ, run });
    expect(prListCalls(calls)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('openPullRequest — graceful degrade (FR-5 / AC-4 / INV-5)', () => {
  it.each([
    ['ENOENT', enoent, 'gh-absent'],
    ['an auth failure', authErr, 'gh-unauthenticated'],
    ['a network failure', netErr, 'offline'],
    ['any other gh error', plainErr, 'failed'],
  ])('classifies %s as %s and resolves (never rejects)', async (_l, mk, outcome) => {
    const { run } = responder({ 'gh pr create': mk() });
    await expect(openPullRequest({ ...BASE_REQ, run })).resolves.toMatchObject({ outcome });
  });

  it('gh-absent carries no error detail — matching SPEC-039 exactly (AC-10)', async () => {
    // push-docs-lane's original arm was `surface({ outcome: 'gh-absent' })` with
    // no error field; the seam must not start attaching one, or the toast text
    // would change on a path SPEC-039's tests cover.
    const { run } = responder({ 'gh pr create': enoent() });
    const res = await openPullRequest({ ...BASE_REQ, run });
    expect(res.outcome).toBe('gh-absent');
    expect(res.error).toBeUndefined();
    expect(res.url).toBeUndefined();
  });

  it('carries the gh stderr into `error` for the non-ENOENT arms', async () => {
    const { run } = responder({ 'gh pr create': plainErr() });
    const res = await openPullRequest({ ...BASE_REQ, run });
    expect(res.error).toMatch(/validation failed/);
  });

  it('a NON-Error throw still resolves `failed` — the INV-5 backstop', async () => {
    // `throw 'boom'` bypasses every `instanceof Error` check; a seam that only
    // handled Errors would reject here and take the approval's surface with it.
    const run: ExecRun = async () => {
      throw 'boom';
    };
    await expect(openPullRequest({ ...BASE_REQ, run })).resolves.toEqual({
      outcome: 'failed',
      error: 'boom',
    });
  });

  it('a runner that throws synchronously still resolves a typed outcome', async () => {
    const run = (() => {
      throw new Error('spawn failed before any promise');
    }) as unknown as ExecRun;
    await expect(openPullRequest({ ...BASE_REQ, run })).resolves.toMatchObject({
      outcome: 'failed',
    });
  });
});

// =============================================================================
// buildApprovalPrBody — OQ-2 provenance, INV-4 non-authority
// =============================================================================

const RECORD: ApprovalRecord = {
  specPath: 'specs/minspec/SPEC-050-silent-approval-pr/requirements.md',
  specHash: 'deadbeefcafe1234',
  approvedAt: '2026-08-05T01:02:03.000Z',
  approvedBy: 'founder@example.com',
  tier: 'T2',
  migrated: false,
  baselineBlob: '0'.repeat(40),
};

describe('buildApprovalPrBody (OQ-2 / INV-4)', () => {
  it('carries artifact, tier, approver, specHash and the approval commit', () => {
    const body = buildApprovalPrBody({
      paths: [RECORD.specPath, `.minspec/approvals/${RECORD.specPath}.json`],
      record: RECORD,
      sha: 'abc1234def5678',
    });
    expect(body).toContain(RECORD.specPath);
    expect(body).toContain('T2');
    expect(body).toContain('founder@example.com');
    expect(body).toContain('deadbeefcafe1234');
    expect(body).toContain('abc1234def5678');
    expect(body).toContain(`.minspec/approvals/${RECORD.specPath}.json`);
  });

  it('claims docs-lane membership ONLY when the label is really applied', () => {
    // The body is read by a human deciding whether to merge. A PR that MinSpec
    // deliberately left unlabelled (INV-2, non-corpus paths) must not carry a
    // body announcing it rides the auto-merge lane — that is a false statement in
    // the artifact, the same never-wrong class as a body that looks like a signed
    // record and is not one (#1025).
    const labelled = buildApprovalPrBody({ paths: [RECORD.specPath], labels: [DOCS_LANE_LABEL] });
    expect(labelled).toContain('docs-lane');
    expect(labelled).not.toMatch(/NOT labelled/);

    const unlabelled = buildApprovalPrBody({ paths: [RECORD.specPath], labels: [] });
    expect(unlabelled).toMatch(/NOT labelled for the docs-lane/);
    expect(unlabelled).toMatch(/needs a human merge/);

    // Omitted → claims neither, because the builder was told nothing.
    const silent = buildApprovalPrBody({ paths: [RECORD.specPath] });
    expect(silent).not.toMatch(/docs-lane/);
  });

  it('states that the body is presentation, never authoritative (INV-4)', () => {
    const body = buildApprovalPrBody({ paths: [RECORD.specPath], record: RECORD });
    expect(body).toMatch(/never authoritative/i);
    expect(body).toMatch(/\.minspec\/approvals\//);
  });

  it('OMITS every line whose datum is absent — never invents one', () => {
    // The ADR/epic accept paths write no sidecar, so `readRecord` returns
    // undefined. Degrading must not print `undefined` where a tier or an
    // approver email would go: a body that LOOKS like a signed record but is not
    // one is the forged-sign-off class (#1025), not a cosmetic defect.
    const body = buildApprovalPrBody({ paths: ['docs/decisions/DR-077.md'] });
    expect(body).toContain('docs/decisions/DR-077.md');
    expect(body).not.toMatch(/undefined|null|\bTier:\s*$/im);
    expect(body).not.toMatch(/Approved by/i);
    expect(body).not.toMatch(/specHash/i);
    expect(body).not.toMatch(/Approval commit/i);
    expect(body).toMatch(/never authoritative/i);
  });

  it('names the first path as the artifact when there is no record', () => {
    expect(buildApprovalPrBody({ paths: ['specs/x/requirements.md'] })).toMatch(
      /Approved artifact.*specs\/x\/requirements\.md/,
    );
  });

  it('is total on an empty path list (no throw, no invented artifact)', () => {
    const body = buildApprovalPrBody({ paths: [] });
    expect(typeof body).toBe('string');
    expect(body).not.toMatch(/undefined/);
  });
});

// =============================================================================
// resolveHeadSha — local read-only probe
// =============================================================================

describe('resolveHeadSha', () => {
  it('returns the trimmed HEAD sha and runs ONLY `git rev-parse HEAD` (INV-3)', async () => {
    const { run, calls } = responder({ 'git rev-parse HEAD': 'abc1234def5678\n' });
    await expect(resolveHeadSha(run, '/repo')).resolves.toBe('abc1234def5678');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['rev-parse', 'HEAD']);
    expect(calls[0].cwd).toBe('/repo');
    expectCheckoutNeverMoved(calls);
  });

  it('returns undefined when git rejects — a missing sha costs one body line, not the PR', async () => {
    const { run } = responder({ 'git rev-parse HEAD': plainErr() });
    await expect(resolveHeadSha(run, '/repo')).resolves.toBeUndefined();
  });

  it('returns undefined for empty stdout rather than an empty-string sha', async () => {
    const { run } = responder({ 'git rev-parse HEAD': '\n' });
    await expect(resolveHeadSha(run, '/repo')).resolves.toBeUndefined();
  });
});

// =============================================================================
// Classifiers + slug parser — moved verbatim, pinned here so the seam owns them
// =============================================================================

describe('error classifiers (moved from push-docs-lane, semantics unchanged)', () => {
  it('isEnoent is true only for a `code: ENOENT` object', () => {
    expect(isEnoent(enoent())).toBe(true);
    expect(isEnoent(new Error('nope'))).toBe(false);
    expect(isEnoent(undefined)).toBe(false);
    expect(isEnoent('ENOENT')).toBe(false);
  });

  it('describeError prefers stderr, then message, then String()', () => {
    expect(describeError(Object.assign(new Error('m'), { stderr: '  boom  ' }))).toBe('boom');
    expect(describeError(new Error('m'))).toBe('m');
    expect(describeError('raw')).toBe('raw');
  });

  it('isAuthError and isNetworkError keep their original patterns', () => {
    expect(isAuthError('You are not logged into any GitHub hosts')).toBe(true);
    expect(isAuthError('bad credentials')).toBe(true);
    expect(isNetworkError('could not resolve host: github.com')).toBe(true);
    expect(isNetworkError('connection refused')).toBe(true);
    expect(isNetworkError('validation failed')).toBe(false);
  });
});

describe('slugFromOriginUrl (re-homed in the seam)', () => {
  it('parses ssh and https GitHub remotes, stripping .git', () => {
    expect(slugFromOriginUrl('git@github.com:AIClarityAU/minspec.git')).toBe('AIClarityAU/minspec');
    expect(slugFromOriginUrl('https://github.com/AIClarityAU/minspec')).toBe('AIClarityAU/minspec');
    expect(slugFromOriginUrl('ssh://git@github.com/AIClarityAU/minspec.git')).toBe(
      'AIClarityAU/minspec',
    );
  });
  it('returns undefined for an unrecognizable remote', () => {
    expect(slugFromOriginUrl('not-a-url')).toBeUndefined();
  });
});
