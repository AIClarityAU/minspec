/**
 * SPEC-268 (#2982) - the scaffolded review stack runs with only the Claude secret.
 *
 * T0 tests. Every assertion here EXECUTES the shipped workflow code (the bash guard step of
 * `ai-review.yml`, the github-script steps of `ready-to-merge.yml`) or the trusted guard
 * module, with fakes for GitHub. Text-matching alone would pass with the feature absent.
 *
 *   - FR1/FR2: the guard requires only CLAUDE_CODE_OAUTH_TOKEN and decides `identity`.
 *   - R1 parity: `ready-to-merge.yml`'s `ctx` step decides the SAME identity.
 *   - FR2-FR4: every write step reads its token through ONE expression; the App arm never
 *     silently falls back to `github.token`.
 *   - FR5/FR6: the allowlist gains `github-actions[bot]` only in a no-App, same-repo,
 *     non-machinery PR with no operator allowlist.
 *   - FR7/D2: the `workflow_run` trigger resolves the PR's current base, re-evaluates in
 *     both arms (design R3), fails closed and visibly on a failed read, and the gate goes
 *     green on a GITHUB_TOKEN-posted pass with no label event.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import * as advisor from '../src/lib/ruleset-advisor';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the guard is CommonJS, loaded exactly as the workflow loads it
const GUARD = require('../../../.github/scripts/ai-review-guard.js');

const REPO = path.resolve(__dirname, '../../..');
const AI_REVIEW = fs.readFileSync(path.join(REPO, '.github/workflows/ai-review.yml'), 'utf-8');
const RTM = fs.readFileSync(path.join(REPO, '.github/workflows/ready-to-merge.yml'), 'utf-8');

/**
 * One top-level job of ai-review.yml, read textually (js-yaml is only a transitive
 * dependency here, see docs-lane-hold.test.ts): its simple `key: value` lines and its
 * two-level maps (`permissions`, `env`, `outputs`), comments stripped.
 */
function jobOf(id: string) {
  const rows = AI_REVIEW.split('\n');
  const at = rows.findIndex((l) => l === `  ${id}:`);
  if (at < 0) throw new Error(`job ${id} is missing`);
  const body: string[] = [];
  for (let i = at + 1; i < rows.length; i++) {
    if (/^ {2}\S/.test(rows[i]) || /^\S/.test(rows[i])) break;
    body.push(rows[i]);
  }
  const top: Record<string, string> = {};
  const maps: Record<string, Record<string, string>> = {};
  let cur: string | null = null;
  for (const raw of body) {
    const l = raw.replace(/\s+#.*$/, '');
    if (/^\s*#/.test(l) || l.trim() === '') continue;
    let m = /^ {4}([a-z-]+):\s*(.*)$/i.exec(l);
    if (m) {
      top[m[1]] = m[2];
      cur = m[2] === '' ? m[1] : null;
      if (cur) maps[cur] = {};
      continue;
    }
    m = /^ {6}([A-Za-z_-]+):\s*(.*)$/.exec(l);
    if (m && cur) maps[cur][m[1]] = m[2];
  }
  return { top, maps, body: body.join('\n') };
}


const GUARD_STEP = 'Check reviewer is configured (skip cleanly if not)';
const CTX_STEP = 'Resolve the pull request and reviewer identity';
const GATE_STEP = 'Enforce ai-review label integrity and reflect the merge gate';
const TOKEN_EXPR =
  "${{ steps.guard.outputs.identity == 'actions' && github.token || steps.app-token.outputs.token }}";

const PASS = 'ai-review:pass';
const ACTIONS_BOT = 'github-actions[bot]';
const HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
// Shape of a secret, never a real one.
const SHAPE = 'x-shape-only-not-a-credential';

useShellTimeout();

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop() as string, { recursive: true, force: true });
});

const indentOf = (l: string): number => l.length - l.trimStart().length;

/** A step's block scalar (`run: |` or `script: |`), dedented as the runner sees it. */
function stepScalar(source: string, stepName: string, key: 'run' | 'script'): string {
  const rows = source.split('\n');
  const nameAt = rows.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt < 0) throw new Error(`step "${stepName}" is missing`);
  const stepIndent = indentOf(rows[nameAt]);
  let at = -1;
  for (let i = nameAt + 1; i < rows.length; i++) {
    if (rows[i].trim() === '') continue;
    if (indentOf(rows[i]) <= stepIndent) break;
    if (rows[i].trim() === `${key}: |`) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error(`step "${stepName}" has no \`${key}: |\` block`);
  const keyIndent = indentOf(rows[at]);
  const body: string[] = [];
  let blockIndent = -1;
  for (let i = at + 1; i < rows.length; i++) {
    const l = rows[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    if (indentOf(l) <= keyIndent) break;
    if (blockIndent < 0) blockIndent = indentOf(l);
    body.push(l.slice(blockIndent));
  }
  const script = `${body.join('\n')}\n`;
  if (script.includes('${{')) throw new Error(`"${stepName}" ${key} block holds an Actions expression`);
  return script;
}

/** The raw lines of one step (from its `- name:` to the next sibling). */
function stepLines(source: string, stepName: string): string[] {
  const rows = source.split('\n');
  const nameAt = rows.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt < 0) throw new Error(`step "${stepName}" is missing`);
  const ind = indentOf(rows[nameAt]);
  const out = [rows[nameAt]];
  for (let i = nameAt + 1; i < rows.length; i++) {
    if (rows[i].trim() !== '' && indentOf(rows[i]) <= ind) break;
    out.push(rows[i]);
  }
  return out;
}

const ARM_STEP = 'Decide the reviewer arm (App or GITHUB_TOKEN)';

/** Runs ai-review.yml's `arm` job step (which review job starts) with the given secrets. */
function runArmStep(secrets: { appId?: string; appKey?: string; mode?: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-arm-'));
  scratch.push(dir);
  const out = path.join(dir, 'out');
  fs.writeFileSync(out, '');
  const res = spawnSync('bash', ['-c', stepScalar(AI_REVIEW, ARM_STEP, 'run')], {
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, APP_ID: secrets.appId ?? '', APP_KEY: secrets.appKey ?? '', REVIEW_APP_MODE: secrets.mode ?? '' },
    encoding: 'utf-8',
  });
  if (res.status !== 0) throw new Error(`arm step exited ${res.status}`);
  const m = /^arm=(.*)$/m.exec(fs.readFileSync(out, 'utf-8'));
  return m ? m[1] : '';
}

/**
 * Runs the ai-review.yml guard step with the given secrets; returns its outputs + log.
 * `jobArm` is the job it runs in (REVIEW_JOB_ARM); by default the one the `arm` job picks
 * for the same secrets, exactly as the workflow wires it.
 */
function runGuardStep(secrets: { oauth?: string; appId?: string; appKey?: string; mode?: string; reviewAppId?: string; reviewAppKey?: string; jobArm?: string }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-guard-'));
  scratch.push(dir);
  const out = path.join(dir, 'out');
  fs.writeFileSync(out, '');
  const jobArm = secrets.jobArm ?? runArmStep(secrets);
  const res = spawnSync('bash', ['-c', stepScalar(AI_REVIEW, GUARD_STEP, 'run')], {
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: out,
      REVIEW_JOB_ARM: jobArm,
      OAUTH_TOKEN: secrets.oauth ?? '',
      APP_ID: secrets.appId ?? '',
      APP_KEY: secrets.appKey ?? '',
      REVIEW_APP_MODE: secrets.mode ?? '',
      REVIEW_APP_ID: secrets.reviewAppId ?? '',
      REVIEW_APP_KEY: secrets.reviewAppKey ?? '',
    },
    encoding: 'utf-8',
  });
  const outputs: Record<string, string> = {};
  for (const line of fs.readFileSync(out, 'utf-8').split('\n')) {
    const m = /^([a-z_]+)=(.*)$/.exec(line);
    if (m) outputs[m[1]] = m[2];
  }
  return { code: res.status, stdout: res.stdout, outputs };
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

type Call = { api: string; args: Record<string, unknown> };

/** Runs the ready-to-merge `ctx` step. */
async function runCtx(o: {
  eventName: 'pull_request' | 'workflow_run';
  hasAppId: boolean;
  hasAppKey: boolean;
  /** The evaluated `vars.AI_REVIEW_APP == '' || == 'builder'` boolean (#4078); default builder. */
  builderMode?: boolean;
  runPrs?: Array<{ number: number }>;
  prRead?: Record<string, unknown> | Error;
}) {
  const log: Call[] = [];
  const outputs: Record<string, string> = {};
  const notices: string[] = [];
  const warnings: string[] = [];
  let failed: string | null = null;
  const github = {
    rest: {
      pulls: {
        get: async (args: Record<string, unknown>) => {
          log.push({ api: 'pulls.get', args });
          if (o.prRead instanceof Error) throw o.prRead;
          return { data: o.prRead };
        },
      },
      repos: {
        createCommitStatus: async (args: Record<string, unknown>) => {
          log.push({ api: 'repos.createCommitStatus', args });
          return { data: {} };
        },
      },
    },
  };
  const context = {
    eventName: o.eventName,
    repo: { owner: 'OWNER', repo: 'REPO' },
    payload:
      o.eventName === 'pull_request'
        ? { pull_request: { number: 7, base: { sha: BASE }, head: { sha: HEAD, repo: { full_name: 'OWNER/REPO' } } } }
        : { workflow_run: { head_sha: HEAD, pull_requests: o.runPrs ?? [] } },
  };
  const core = {
    setOutput: (k: string, v: unknown) => {
      outputs[k] = String(v);
    },
    notice: (m: string) => notices.push(m),
    warning: (m: string) => warnings.push(m),
    info: () => undefined,
    setFailed: (m: string) => {
      failed = m;
    },
  };
  const proc = { env: { HAS_APP_ID: String(o.hasAppId), HAS_APP_KEY: String(o.hasAppKey), REVIEW_BUILDER_MODE: String(o.builderMode ?? true) } };
  const fn = new AsyncFunction('github', 'context', 'core', 'process', stepScalar(RTM, CTX_STEP, 'script'));
  await fn(github, context, core, proc);
  return { log, outputs, notices, warnings, failed: failed as string | null };
}

/** A genuine ai-review.yml run on HEAD for PR 7, as the Actions API returns it. */
function genuineRun(over: Record<string, unknown> = {}) {
  return {
    id: 501,
    path: '.github/workflows/ai-review.yml',
    event: 'pull_request',
    head_sha: HEAD,
    head_repository: { full_name: 'OWNER/REPO' },
    pull_requests: [{ number: 7 }],
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    created_at: '2026-11-01T12:01:00Z',
    ...over,
  };
}

/** Its GITHUB_TOKEN-arm job, with the pass witness step in the given conclusion. */
function genuineJob(witness: string = 'success', over: Record<string, unknown> = {}) {
  return {
    run_id: 501,
    run_attempt: 1,
    name: GUARD.REVIEW_ACTIONS_JOB,
    head_sha: HEAD,
    status: 'completed',
    conclusion: 'success',
    steps: [{ name: GUARD.PASS_WITNESS_STEP, status: 'completed', conclusion: witness }],
    ...over,
  };
}

/** Runs the ready-to-merge gate step against a PR whose pass was posted by `poster`. */
async function runGate(o: {
  eventName?: 'pull_request' | 'workflow_run';
  identity: 'app' | 'actions';
  varSet?: boolean;
  fork?: boolean;
  files?: string[] | Error;
  poster?: string;
  /** PR author login (pr.user.login). */
  author?: string;
  /** context.actor (the run's triggering actor). */
  actor?: string;
  /** ai-review workflow runs on the head (Actions API); default: one genuine passing run. */
  reviewRuns?: unknown[] | Error;
  /** jobs of the selected run; default: the GITHUB_TOKEN-arm job with the witness step green. */
  reviewJobs?: unknown[] | Error;
}) {
  const poster = o.poster ?? ACTIONS_BOT;
  const slug = poster.replace(/\[bot\]$/, '');
  const eventName = o.eventName ?? 'pull_request';
  const files = o.files ?? ['packages/minspec/src/lib/thing.ts'];
  const log: Call[] = [];
  const pr = {
    number: 7,
    state: 'open',
    head: { sha: HEAD, repo: { full_name: o.fork ? 'someone/REPO' : 'OWNER/REPO' } },
    base: { sha: BASE, repo: { full_name: 'OWNER/REPO' } },
    labels: [{ name: PASS }],
    body: '',
    auto_merge: null,
    draft: false,
    changed_files: Array.isArray(files) ? files.length : 1,
    user: { login: o.author ?? 'someone' },
  };
  const rec = (api: string) =>
    Object.assign(
      async (args: Record<string, unknown>) => {
        log.push({ api, args });
        return { data: {} };
      },
      { api },
    );
  const rest = {
    pulls: {
      get: async (args: Record<string, unknown>) => {
        log.push({ api: 'pulls.get', args });
        return { data: pr };
      },
      listFiles: Object.assign(async () => ({ data: [] }), { api: 'pulls.listFiles' }),
    },
    repos: {
      createCommitStatus: rec('repos.createCommitStatus'),
      getCommit: async () => ({ data: { commit: { committer: { date: '2026-11-01T12:00:00Z' } } } }),
      listCommitStatusesForRef: Object.assign(async () => ({ data: [] }), { api: 'repos.listCommitStatusesForRef' }),
    },
    issues: {
      listEvents: Object.assign(async () => ({ data: [] }), { api: 'issues.listEvents' }),
      get: async () => ({ data: { state: 'closed' } }),
      addLabels: rec('issues.addLabels'),
      removeLabel: rec('issues.removeLabel'),
      createComment: rec('issues.createComment'),
    },
    checks: { listForRef: Object.assign(async () => ({ data: { total_count: 0, check_runs: [] } }), { api: 'checks.listForRef' }) },
    actions: {
      listWorkflowRuns: Object.assign(async () => ({ data: { total_count: 0, workflow_runs: [] } }), { api: 'actions.listWorkflowRuns' }),
      listJobsForWorkflowRun: Object.assign(async () => ({ data: { total_count: 0, jobs: [] } }), { api: 'actions.listJobsForWorkflowRun' }),
    },
  };
  const reviewRuns = o.reviewRuns ?? [genuineRun()];
  const reviewJobs = o.reviewJobs ?? [genuineJob()];
  const github = {
    rest,
    paginate: async (method: { api?: string }, args?: Record<string, unknown>) => {
      if (method === rest.pulls.listFiles) {
        if (files instanceof Error) throw files;
        return files.map((filename) => ({ filename }));
      }
      if (method === rest.issues.listEvents) {
        return [{ event: 'labeled', label: { name: PASS }, actor: { login: poster }, created_at: '2026-11-01T12:05:00Z' }];
      }
      if (method === rest.repos.listCommitStatusesForRef) {
        return [{ context: 'ai-review/pass', state: 'success', creator: { login: poster }, created_at: '2026-11-01T12:05:00Z' }];
      }
      if (method === rest.actions.listWorkflowRuns) {
        log.push({ api: 'actions.listWorkflowRuns', args: args ?? {} });
        if (reviewRuns instanceof Error) throw reviewRuns;
        return reviewRuns;
      }
      if (method === rest.actions.listJobsForWorkflowRun) {
        log.push({ api: 'actions.listJobsForWorkflowRun', args: args ?? {} });
        if (reviewJobs instanceof Error) throw reviewJobs;
        return reviewJobs;
      }
      if (method === rest.checks.listForRef) {
        return [{ name: 'ai-review', status: 'completed', conclusion: 'success', head_sha: HEAD, app: { slug }, completed_at: '2026-11-01T12:05:00Z' }];
      }
      return [];
    },
  };
  const context = {
    eventName,
    actor: o.actor ?? 'someone',
    repo: { owner: 'OWNER', repo: 'REPO' },
    payload:
      eventName === 'pull_request'
        ? { action: 'opened', pull_request: pr, sender: { login: 'someone' } }
        : { workflow_run: { head_sha: HEAD, pull_requests: [{ number: 7 }] }, sender: { login: ACTIONS_BOT } },
  };
  const warnings: string[] = [];
  const infos: string[] = [];
  const core = { warning: (m: string) => warnings.push(m), info: (m: string) => infos.push(m) };
  const proc = {
    env: {
      GITHUB_WORKSPACE: REPO,
      AI_REVIEW_BOT_LOGINS: o.varSet ? 'my-reviewer[bot]' : 'minspec-sdd[bot]',
      AI_REVIEW_BOT_LOGINS_VAR_SET: String(Boolean(o.varSet)),
      REVIEW_IDENTITY: o.identity,
      PR_NUMBER: '7',
    },
  };
  const fn = new AsyncFunction('github', 'context', 'core', 'require', 'process', stepScalar(RTM, GATE_STEP, 'script'));
  await fn(github, context, core, require, proc);
  const status = log.filter((c) => c.api === 'repos.createCommitStatus').pop();
  return { log, warnings, infos, state: status ? (status.args.state as string) : null, description: status?.args.description as string };
}

describe('FR1/FR2 - ai-review.yml guard: only the Claude secret gates; identity decided once', () => {
  it('Claude secret alone: configured, identity=actions (the no-App adopter is NOT skipped)', () => {
    const r = runGuardStep({ oauth: SHAPE });
    expect(r.code).toBe(0);
    expect(r.outputs).toMatchObject({ configured: 'true', identity: 'actions' });
  });

  it('all three secrets: configured, identity=app (App arm unchanged)', () => {
    const r = runGuardStep({ oauth: SHAPE, appId: '123', appKey: SHAPE });
    expect(r.outputs).toMatchObject({ configured: 'true', identity: 'app' });
    expect(r.stdout).not.toContain('::warning');
  });

  it.each([
    ['ID only', { appId: '123' }, 'MINSPEC_APP_PRIVATE_KEY'],
    ['key only', { appKey: SHAPE }, 'MINSPEC_APP_ID'],
  ])('half-configured App (%s): identity=actions plus a warning naming the missing secret', (_n, s, missing) => {
    const r = runGuardStep({ oauth: SHAPE, ...s });
    expect(r.outputs).toMatchObject({ configured: 'true', identity: 'actions' });
    expect(r.stdout).toMatch(new RegExp(`::warning[^\\n]*${missing}`));
  });

  it('no Claude secret: skips with the NOTICE whatever the App secrets say (and the NOTICE no longer demands them)', () => {
    for (const s of [{}, { appId: '1', appKey: SHAPE }]) {
      const r = runGuardStep(s);
      expect(r.code).toBe(0);
      expect(r.outputs.configured).toBe('false');
      expect(r.stdout).toContain('::notice');
      expect(r.stdout).not.toMatch(/Add the CLAUDE_CODE_OAUTH_TOKEN and MINSPEC_APP_ID/);
    }
  });
});

describe('R1 parity - ready-to-merge ctx decides the same identity as the ai-review guard', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('appId=%s appKey=%s', async (hasAppId, hasAppKey) => {
    const guard = runGuardStep({ oauth: SHAPE, appId: hasAppId ? '1' : '', appKey: hasAppKey ? SHAPE : '' });
    const ctx = await runCtx({ eventName: 'pull_request', hasAppId, hasAppKey });
    expect(ctx.outputs.identity).toBe(guard.outputs.identity);
    expect(ctx.outputs).toMatchObject({ proceed: 'true', pr_number: '7', base_sha: BASE });
  });

  // #4078 review mode: the review App always posts (or the run fails), so neither side may
  // ever pick the GITHUB_TOKEN arm there, whatever the builder App secrets are.
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('AI_REVIEW_APP=review, builder appId=%s appKey=%s -> app on both sides', async (hasAppId, hasAppKey) => {
    const guard = runGuardStep({
      oauth: SHAPE,
      mode: 'review',
      reviewAppId: '9',
      reviewAppKey: SHAPE,
      appId: hasAppId ? '1' : '',
      appKey: hasAppKey ? SHAPE : '',
    });
    const ctx = await runCtx({ eventName: 'pull_request', hasAppId, hasAppKey, builderMode: false });
    expect(guard.outputs.identity).toBe('app');
    expect(ctx.outputs.identity).toBe('app');
  });

  it('AI_REVIEW_APP=review without the review secrets fails the guard red, never the GITHUB_TOKEN arm', () => {
    const guard = runGuardStep({ oauth: SHAPE, mode: 'review' });
    expect(guard.code).not.toBe(0);
    expect(guard.outputs.identity).toBeUndefined();
  });
});

describe('FR2-FR4 - token selection in ai-review.yml', () => {
  it('every App-token reference sits inside the ONE selection expression', () => {
    const refs = AI_REVIEW.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('steps.app-token.outputs.token'));
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const l of refs) expect(l.trim()).toMatch(new RegExp(`^[A-Z_]+: ${TOKEN_EXPR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });

  it('the App arm never falls back to github.token: actions selects github.token, anything else the App token', () => {
    // The expression's shape is `actions && github.token || app`. With identity=app the
    // left operand is false, so the result is the App token, empty or not - exactly today.
    expect(TOKEN_EXPR.indexOf("== 'actions' && github.token")).toBeGreaterThan(0);
    expect(TOKEN_EXPR.trim().endsWith('steps.app-token.outputs.token }}')).toBe(true);
  });

  it('the App token is minted only in identity=app', () => {
    const mint = stepLines(AI_REVIEW, 'Mint GitHub App token (post as minspec-sdd[bot])').join('\n');
    expect(mint).toMatch(/if: steps\.guard\.outputs\.identity == 'app'/);
  });

  // Review finding (#4079): the write scopes are granted ONLY to the GITHUB_TOKEN arm's
  // job; the App arm's own token stays `contents: read`, exactly as before SPEC-268.
  it('workflow + App-arm job keep contents: read; only the GITHUB_TOKEN-arm job gets the FR4 write scopes', () => {
    const m = /^permissions:\n((?: {2}.+\n)+)/m.exec(AI_REVIEW);
    expect(m![1].replace(/#.*$/gm, '').trim()).toBe('contents: read');
    expect(jobOf('arm').top.permissions).toBe('{}');
    expect(jobOf('runner').maps.permissions).toEqual({ contents: 'read' });
    expect(jobOf(GUARD.REVIEW_ACTIONS_JOB).maps.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
      issues: 'write',
      checks: 'write',
      statuses: 'write',
    });
  });

  it('exactly one review job runs per arm, both run the SAME steps, each tells the guard its arm', () => {
    const jobIds = AI_REVIEW.slice(AI_REVIEW.indexOf('\njobs:\n'))
      .split('\n')
      .filter((l) => /^ {2}[a-z][\w-]*:$/.test(l))
      .map((l) => l.trim().slice(0, -1));
    expect(jobIds).toEqual(['arm', 'runner', GUARD.REVIEW_ACTIONS_JOB]);
    const r = jobOf('runner');
    expect(r.top.needs).toBe('arm');
    expect(r.top.if).toBe("needs.arm.outputs.arm != 'actions'");
    expect(r.maps.env).toEqual({ REVIEW_JOB_ARM: 'app' });
    // `steps:` then the anchor on its own line: the steps are defined ONCE, in `runner`.
    expect(r.body).toMatch(/^ {4}steps:\n {6}&review-steps\n/m);
    const a = jobOf(GUARD.REVIEW_ACTIONS_JOB);
    expect(a.top.needs).toBe('arm');
    expect(a.top.if).toBe("needs.arm.outputs.arm == 'actions'");
    expect(a.maps.env).toEqual({ REVIEW_JOB_ARM: 'actions' });
    expect(a.top.steps).toBe('*review-steps'); // the same list, not a drifting copy
    expect(AI_REVIEW.match(/&review-steps\b/g)).toHaveLength(1);
    expect(jobOf('arm').maps.outputs).toEqual({ arm: '${{ steps.arm.outputs.arm }}' });
  });

  it('the arm job and the guard decide the same arm for every secret state', () => {
    const states = [{}, { appId: '1' }, { appKey: SHAPE }, { appId: '1', appKey: SHAPE }];
    for (const mode of ['', 'builder', ' Builder ', 'review']) {
      for (const st of states) {
        const s = { oauth: SHAPE, mode, reviewAppId: '9', reviewAppKey: SHAPE, ...st };
        const r = runGuardStep(s);
        expect(r.code, JSON.stringify(s)).toBe(0);
        expect(r.outputs.identity).toBe(runArmStep(s));
      }
    }
  });

  it('guard in the wrong job (or no job arm) fails red before posting anything', () => {
    for (const [secrets, jobArm] of [
      [{ oauth: SHAPE }, 'app'],
      [{ oauth: SHAPE, appId: '1', appKey: SHAPE }, 'actions'],
      [{ oauth: SHAPE }, ''],
    ] as const) {
      const r = runGuardStep({ ...secrets, jobArm });
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('Reviewer arm mismatch');
      expect(r.outputs.configured).toBeUndefined();
      expect(r.outputs.identity).toBeUndefined();
    }
  });

  it('the pass witness step is named as the guard expects and runs only on a posted, non-machinery pass', () => {
    const rows = AI_REVIEW.split('\n');
    const at = rows.findIndex((l) => l.trim() === `- name: ${GUARD.PASS_WITNESS_STEP}`);
    expect(at).toBeGreaterThan(rows.findIndex((l) => l.trim() === '- name: Post verdict + apply label as minspec-sdd[bot]'));
    expect(at).toBeLessThan(rows.findIndex((l) => l.trim() === `- name: Fail closed — request changes as minspec-sdd[bot] on any error`));
    const step = stepLines(AI_REVIEW, GUARD.PASS_WITNESS_STEP).map((l) => l.trim());
    // implicit success(): skipped whenever any earlier step failed
    expect(step).toContain(
      "if: steps.guard.outputs.configured == 'true' && steps.review.outputs.label == 'ai-review:pass' && steps.review.outputs.is_machinery != 'true'",
    );
    expect(step.find((l) => l.startsWith('run:'))).not.toMatch(/\$\{\{/);
    expect(GUARD.REVIEW_WORKFLOW_PATH).toBe('.github/workflows/ai-review.yml');
  });

  it('the inference step still receives no GitHub token', () => {
    const rows = AI_REVIEW.split('\n');
    const at = rows.findIndex((l) => l.includes('CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}'));
    expect(at).toBeGreaterThan(0);
    // Walk back to the step's `- name:` and forward to the next step.
    let s = at;
    while (!rows[s].trim().startsWith('- name:')) s--;
    const step = stepLines(AI_REVIEW, rows[s].trim().slice('- name: '.length)).join('\n');
    expect(step).not.toMatch(/github\.token|GH_TOKEN|GITHUB_TOKEN|app-token/);
  });
});

describe('FR5/FR6 - guard.effectiveAllowlist + pathsTouchMachinery', () => {
  const base = { raw: 'minspec-sdd[bot]', identity: 'actions', varSet: false, isFork: false, touchesMachinery: false };

  it('widens with github-actions[bot] only in the no-App, same-repo, non-machinery, no-variable case', () => {
    expect(GUARD.effectiveAllowlist(base).allowlist).toEqual(['minspec-sdd[bot]', ACTIONS_BOT]);
    expect(GUARD.FALLBACK_REVIEWER_LOGIN).toBe(ACTIONS_BOT);
  });

  it.each([
    ['App arm', { identity: 'app' }],
    ['operator allowlist set', { varSet: true }],
    ['fork PR', { isFork: true }],
    ['machinery PR', { touchesMachinery: true }],
    ['machinery unknown', { touchesMachinery: undefined }],
    ['identity unknown', { identity: undefined }],
  ])('%s: never widens', (_n, delta) => {
    const r = GUARD.effectiveAllowlist({ ...base, ...delta });
    expect(r.allowlist).not.toContain(ACTIONS_BOT);
    expect(r.widened).toBe(false);
  });

  it('pathsTouchMachinery reuses MACHINERY_PATH_RE and fails toward true', () => {
    expect(GUARD.pathsTouchMachinery(['src/a.ts', 'docs/x.md'], 2)).toBe(false);
    expect(GUARD.pathsTouchMachinery(['src/a.ts', '.github/workflows/x.yml'], 2)).toBe(true);
    expect(GUARD.pathsTouchMachinery(['scripts/x.sh'])).toBe(true);
    expect(GUARD.pathsTouchMachinery([])).toBe(true);
    expect(GUARD.pathsTouchMachinery(undefined)).toBe(true);
    expect(GUARD.pathsTouchMachinery(['src/a.ts'], 2)).toBe(true); // truncated listing
    expect(GUARD.pathsTouchMachinery(['src/a.ts', 42])).toBe(true);
    // Same predicate as the diff-header one: no second hand-written copy.
    for (const p of ['.github/x', 'scripts/y', '.githooks/z', 'packages/minspec/src/lib/ci-review-templates.ts', 'src/ok.ts']) {
      expect(GUARD.pathsTouchMachinery([p], 1)).toBe(GUARD.inputTouchesMachinery(`diff --git a/${p} b/${p}\n`));
    }
  });
});

describe('AC1/AC4 - the gate turns green on a github-actions pass only where FR5/FR6 allow', () => {
  it('AC1: no-App repo, non-machinery PR, pass posted by github-actions[bot] -> success', async () => {
    const r = await runGate({ identity: 'actions' });
    expect(r.state).toBe('success');
  });

  it('AC2: App repo -> a github-actions pass is still rejected (allowlist unchanged)', async () => {
    const r = await runGate({ identity: 'app' });
    expect(r.state).toBe('failure');
  });

  it('AC2: App repo, pass posted by minspec-sdd[bot] -> success as today', async () => {
    const r = await runGate({ identity: 'app', poster: 'minspec-sdd[bot]' });
    expect(r.state).toBe('success');
  });

  // T3 (pre-review round 4): Dependabot-triggered runs get Dependabot secrets, never Actions
  // secrets (GitHub docs, "Troubleshooting Dependabot on GitHub Actions"), so an App repo's
  // Dependabot PR reads as identity=actions. Its branch is same-repo and a dependency bump is
  // not machinery, so without this rule the App repo's gate would trust github-actions[bot].
  it('Dependabot PR (author dependabot[bot]) never widens, even when its run reads identity=actions', async () => {
    const r = await runGate({ identity: 'actions', author: 'dependabot[bot]' });
    expect(r.state).toBe('failure');
  });

  it('Dependabot-triggered run (actor dependabot[bot]) never widens', async () => {
    const r = await runGate({ identity: 'actions', actor: 'dependabot[bot]' });
    expect(r.state).toBe('failure');
  });

  it('Dependabot workflow_run re-evaluation never widens either', async () => {
    const r = await runGate({ eventName: 'workflow_run', identity: 'actions', author: 'dependabot[bot]' });
    expect(r.state).toBe('failure');
  });

  it('AC4: machinery PR in the no-App arm -> failure', async () => {
    const r = await runGate({ identity: 'actions', files: ['src/a.ts', '.github/workflows/evil.yml'] });
    expect(r.state).toBe('failure');
  });

  it('AC4: file list unreadable -> failure (fail closed)', async () => {
    const r = await runGate({ identity: 'actions', files: new Error('boom') });
    expect(r.state).toBe('failure');
  });

  it('AC4: fork PR never widens', async () => {
    const r = await runGate({ identity: 'actions', fork: true });
    expect(r.state).toBe('failure');
  });

  it('FR5: an operator-set AI_REVIEW_BOT_LOGINS is never widened behind their back', async () => {
    const r = await runGate({ identity: 'actions', varSet: true });
    expect(r.state).toBe('failure');
  });
});

// SPEC-268 independent review (#4079, rv-4079-fe80cda3): github-actions[bot] is the login of
// EVERY GITHUB_TOKEN in the repo, so in the no-App arm a non-machinery PR whose own code
// runs under CI (a test, an npm lifecycle script) could post the label, the status and the
// check-run itself. The gate must not count any of them: only the ai-review.yml RUN on the
// head, read through the Actions API, is evidence there.
describe('review finding - a github-actions pass counts only when the ai-review run on the head recorded it', () => {
  it('forged: label + ai-review/pass status + ai-review check-run all by github-actions[bot], no ai-review run -> failure', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: [] });
    expect(r.state).toBe('failure');
    expect(r.description).toMatch(/no ai-review run/);
  });

  it('forged: a different workflow (CI running the PR code) on the head, even with a step of the same name -> failure', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: [genuineRun({ path: '.github/workflows/ci.yml' })] });
    expect(r.state).toBe('failure');
  });

  it('forged: a workflow_dispatch run of ai-review.yml is not a pull_request review -> failure', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: [genuineRun({ event: 'workflow_dispatch' })] });
    expect(r.state).toBe('failure');
  });

  it('the genuine run did not record a pass (witness step skipped) -> failure despite the forged label/status/check', async () => {
    const r = await runGate({ identity: 'actions', reviewJobs: [genuineJob('skipped')] });
    expect(r.state).toBe('failure');
  });

  it('a run on an OLDER head does not speak for this one -> failure', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: [genuineRun({ head_sha: 'd'.repeat(40) })] });
    expect(r.state).toBe('failure');
  });

  it('the latest ai-review run on the head is still running -> failure', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: [genuineRun({ status: 'in_progress', conclusion: null })] });
    expect(r.state).toBe('failure');
  });

  it('runs listing unreadable -> failure (fail closed, visibly)', async () => {
    const r = await runGate({ identity: 'actions', reviewRuns: new Error('HTTP 500') });
    expect(r.state).toBe('failure');
    expect(r.warnings.join('\n')).toMatch(/ai-review run/);
  });

  it('jobs listing unreadable -> failure (fail closed)', async () => {
    const r = await runGate({ identity: 'actions', reviewJobs: new Error('HTTP 403') });
    expect(r.state).toBe('failure');
  });

  it('genuine ai-review run on the head recorded the pass -> success, read for THIS head through ai-review.yml', async () => {
    const r = await runGate({ identity: 'actions' });
    expect(r.state).toBe('success');
    const runs = r.log.find((c) => c.api === 'actions.listWorkflowRuns');
    expect(runs?.args).toMatchObject({ owner: 'OWNER', repo: 'REPO', workflow_id: 'ai-review.yml', head_sha: HEAD, event: 'pull_request' });
    const jobs = r.log.find((c) => c.api === 'actions.listJobsForWorkflowRun');
    expect(jobs?.args).toMatchObject({ run_id: 501, filter: 'latest' });
  });

  it('App arm never consults the Actions runs (its witnesses are App-attested)', async () => {
    const r = await runGate({ identity: 'app', poster: 'minspec-sdd[bot]', reviewRuns: [] });
    expect(r.state).toBe('success');
    expect(r.log.some((c) => c.api === 'actions.listWorkflowRuns')).toBe(false);
  });

  it('ready-to-merge may read Actions runs (actions: read) and nothing more on that scope', () => {
    expect(RTM).toMatch(/^ {2}actions: read\b/m);
    expect(RTM).not.toMatch(/^ {2}actions: write/m);
  });
});

describe('FR7/D1/D2/AC5 - the workflow_run trigger', () => {
  it('ready-to-merge listens for completed ai-review-runner runs and keeps the per-PR queue', () => {
    expect(RTM).toMatch(/^ {2}workflow_run:\n {4}workflows: \[ai-review-runner\]\n {4}types: \[completed\]$/m);
    expect(AI_REVIEW).toMatch(/^name: ai-review-runner$/m);
    const m = /^concurrency:\n\s+group:\s*(.+)\n\s+cancel-in-progress:\s*(\w+)/m.exec(RTM);
    expect(m![1]).toBe(
      'ready-to-merge-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}',
    );
    expect(m![2]).toBe('false');
  });

  it('every step after ctx runs only when ctx says proceed', () => {
    const rows = RTM.split('\n');
    const ctxAt = rows.findIndex((l) => l.trim() === `- name: ${CTX_STEP}`);
    expect(ctxAt).toBeGreaterThan(0);
    const after = rows.slice(ctxAt + 1).filter((l) => /^ {6}- (name|uses):/.test(l));
    expect(after.length).toBeGreaterThanOrEqual(3);
    for (const l of after) {
      const name = l.trim().replace(/^- (name|uses): /, '');
      const step = l.includes('- uses:') ? rows.slice(rows.indexOf(l), rows.indexOf(l) + 4).join('\n') : stepLines(RTM, name).join('\n');
      expect(step, name).toContain("if: steps.ctx.outputs.proceed == 'true'");
    }
    expect(RTM).toContain('ref: ${{ steps.ctx.outputs.base_sha }}');
  });

  it('D2 (design R3): App arm re-evaluates too - a no-op run in the shared group could cancel a queued gate run and write nothing', async () => {
    const r = await runCtx({
      eventName: 'workflow_run',
      hasAppId: true,
      hasAppKey: true,
      runPrs: [{ number: 7 }],
      prRead: { state: 'open', base: { sha: BASE }, head: { sha: HEAD, repo: { full_name: 'OWNER/REPO' } } },
    });
    expect(r.outputs).toMatchObject({ proceed: 'true', identity: 'app', base_sha: BASE });
    expect(r.failed).toBeNull();
  });

  it('D2 (design R3): App arm under workflow_run gives the same verdict the labeled run would', async () => {
    expect((await runGate({ eventName: 'workflow_run', identity: 'app', poster: 'minspec-sdd[bot]' })).state).toBe('success');
    expect((await runGate({ eventName: 'workflow_run', identity: 'app' })).state).toBe('failure');
  });

  it('no PR on the run -> NOTICE, posts nothing', async () => {
    const r = await runCtx({ eventName: 'workflow_run', hasAppId: false, hasAppKey: false, runPrs: [] });
    expect(r.outputs.proceed).toBe('false');
    expect(r.notices.length).toBe(1);
    expect(r.log.filter((c) => c.api === 'repos.createCommitStatus')).toEqual([]);
  });

  it('PR read fails -> posts failure naming the reason and fails the step (never silent)', async () => {
    const r = await runCtx({ eventName: 'workflow_run', hasAppId: false, hasAppKey: false, runPrs: [{ number: 7 }], prRead: new Error('500') });
    expect(r.outputs.proceed).toBe('false');
    const st = r.log.find((c) => c.api === 'repos.createCommitStatus');
    expect(st?.args).toMatchObject({ sha: HEAD, state: 'failure', context: 'ready-to-merge' });
    expect(String(st?.args.description)).toMatch(/could not read/i);
    expect(r.failed).not.toBeNull();
  });

  it('closed PR or fork PR -> NOTICE, posts nothing', async () => {
    for (const pr of [
      { state: 'closed', base: { sha: BASE }, head: { sha: HEAD, repo: { full_name: 'OWNER/REPO' } } },
      { state: 'open', base: { sha: BASE }, head: { sha: HEAD, repo: { full_name: 'fork/REPO' } } },
    ]) {
      const r = await runCtx({ eventName: 'workflow_run', hasAppId: false, hasAppKey: false, runPrs: [{ number: 7 }], prRead: pr });
      expect(r.outputs.proceed).toBe('false');
      expect(r.log.filter((c) => c.api === 'repos.createCommitStatus')).toEqual([]);
    }
  });

  it('open same-repo PR -> proceeds pinned to the CURRENT base read from the API', async () => {
    const fresh = 'd'.repeat(40);
    const r = await runCtx({
      eventName: 'workflow_run',
      hasAppId: false,
      hasAppKey: false,
      runPrs: [{ number: 7 }],
      prRead: { state: 'open', base: { sha: fresh }, head: { sha: HEAD, repo: { full_name: 'OWNER/REPO' } } },
    });
    expect(r.outputs).toMatchObject({ proceed: 'true', identity: 'actions', pr_number: '7', base_sha: fresh });
  });

  it('AC5: gate under workflow_run reads the PR fresh and posts success on a github-actions pass', async () => {
    const r = await runGate({ eventName: 'workflow_run', identity: 'actions' });
    expect(r.log.some((c) => c.api === 'pulls.get')).toBe(true);
    expect(r.state).toBe('success');
    // Re-evaluation is not a label event: no provenance revert, no staleness strip.
    expect(r.log.some((c) => c.api === 'issues.removeLabel' && c.args.name === PASS)).toBe(false);
  });
});

describe('FR8/AC6 - the setup probe reports the identity mode in words', () => {
  const withNames = (names: string[]) => async (_cmd: string, args: readonly string[]) =>
    args.some((a) => a.includes('actions/secrets'))
      ? { code: 0, stdout: JSON.stringify(names), stderr: '' }
      : { code: 1, stdout: '', stderr: 'unexpected' };

  it('only the Claude secret: configured (Tier-A may be required), identity=actions, sentence says GITHUB_TOKEN', async () => {
    const p = await advisor.probeReviewerIdentity('o', 'r', withNames(['CLAUDE_CODE_OAUTH_TOKEN']));
    expect(p).toMatchObject({ configured: true, identity: 'actions' });
    expect(p.sentence).toBe('App secrets absent: using GITHUB_TOKEN (reviews post as github-actions[bot]).');
    expect(await advisor.probeReviewerConfigured('o', 'r', withNames(['CLAUDE_CODE_OAUTH_TOKEN']))).toBe(true);
  });

  it('all three: identity=app, sentence names the App', async () => {
    const p = await advisor.probeReviewerIdentity('o', 'r', withNames(['CLAUDE_CODE_OAUTH_TOKEN', 'MINSPEC_APP_ID', 'MINSPEC_APP_PRIVATE_KEY']));
    expect(p).toMatchObject({ configured: true, identity: 'app' });
    expect(p.sentence).toContain('minspec-sdd[bot]');
  });

  it('half-configured: names the missing secret', async () => {
    const p = await advisor.probeReviewerIdentity('o', 'r', withNames(['CLAUDE_CODE_OAUTH_TOKEN', 'MINSPEC_APP_ID']));
    expect(p).toMatchObject({ configured: true, identity: 'actions', missingIdentitySecrets: ['MINSPEC_APP_PRIVATE_KEY'] });
    expect(p.sentence).toMatch(/^MINSPEC_APP_PRIVATE_KEY missing: App half-configured, using GITHUB_TOKEN/);
  });

  it('read failure: not configured, identity unknown (fail-safe: Tier-A stays out)', async () => {
    const p = await advisor.probeReviewerIdentity('o', 'r', async () => ({ code: 1, stdout: '', stderr: 'nope' }));
    expect(p).toMatchObject({ configured: false, identity: 'unknown', sentence: '' });
  });

  it('the probe and the shipped guard agree on identity for every App-secret state', () => {
    for (const [id, key] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const names = new Set(['CLAUDE_CODE_OAUTH_TOKEN', ...(id ? ['MINSPEC_APP_ID'] : []), ...(key ? ['MINSPEC_APP_PRIVATE_KEY'] : [])]);
      const g = runGuardStep({ oauth: SHAPE, appId: id ? '1' : '', appKey: key ? SHAPE : '' });
      expect(advisor.describeReviewerSecrets(names).identity).toBe(g.outputs.identity);
    }
  });
  // T3 (pre-review round 4): the probe reads secret NAMES only, so it cannot see
  // AI_REVIEW_APP. When the review-only App's secrets exist, the sentence must not assert
  // github-actions[bot] or minspec-sdd[bot] unqualified: in review mode neither posts.
  it('review-only App secrets present: the sentence names AI_REVIEW_APP=review and the review-only App', () => {
    for (const builder of [[], ['MINSPEC_APP_ID', 'MINSPEC_APP_PRIVATE_KEY']]) {
      const names = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'MINSPEC_REVIEW_APP_ID', 'MINSPEC_REVIEW_APP_PRIVATE_KEY', ...builder]);
      const p = advisor.describeReviewerSecrets(names);
      expect(p.sentence).toMatch(/AI_REVIEW_APP/);
      expect(p.sentence).toMatch(/review-only App/);
    }
  });

  it('no review-only App secrets: the sentence is unchanged (does not mention AI_REVIEW_APP)', () => {
    expect(advisor.describeReviewerSecrets(new Set(['CLAUDE_CODE_OAUTH_TOKEN'])).sentence).not.toMatch(/AI_REVIEW_APP/);
  });
});
