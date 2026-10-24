/**
 * T0 - the post-merge caller for delegated approval (#2981, DR-108).
 *
 * Driven against a REAL git repository with a bare `origin`, so the scan, the worktree,
 * the commit and the push are the real operations; only GitHub (`gh`), the token mint
 * and the one-artifact CLI are stubbed. Pinned here:
 *
 *   - fail closed, before any branch or GitHub write: memory-fabric, no `.minspec/`, a
 *     shallow clone, no readable delegation record, an unknown or tripped repeat-fix
 *     share, an empty token, a token that is not an App installation token, an open
 *     pull request read at its limit;
 *   - scope: plan artifacts (#2980), governance paths and direction records are never
 *     recorded; already-approved content is not approved again;
 *   - an unknown or non-pass verdict from the CLI denies and pushes nothing;
 *   - what is pushed is exactly the sidecar and its approvable, committed and opened
 *     under `minspec-sdd[bot]`, with no merge, no auto-merge and no `--admin`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { specHash } from '../../shared/src/canonical';
import { BOT_ACTOR } from '../../../scripts/lib/autonomy';
import {
  BOT_EMAIL,
  REAL_DEPS,
  branchFor,
  errorDetail,
  linkDependencies,
  isApprovableCandidatePath,
  parseCallerArgs,
  parsePorcelainZ,
  readCliVerdict,
  runCaller,
  sidecarPathFor,
  type ApproveCall,
  type CallerDeps,
  type CallerOptions,
} from '../../../scripts/lib/delegated-approval-caller';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never in a hook (#1399): these suites spawn git/bash per assertion (#1285).
useShellTimeout();

const REPO = 'AIClarityAU/minspec';
const TOKEN = 'fixture-installation-token';
const SPEC = 'specs/minspec/SPEC-900-fixture/requirements.md';
const DESIGN = 'specs/minspec/SPEC-900-fixture/design.md';
const DR_ENG = 'docs/decisions/DR-900.md';

const DELEGATIONS = JSON.stringify({
  version: 1,
  delegations: [
    {
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
    },
  ],
});

const spec = (id: string, status: string, extra = '') =>
  `---\nid: ${id}\nstatus: ${status}\ntier: T3\n---\n\n# ${id}\n\n- FR-1. Content ${id}.${extra}\n`;
const dr = (id: string, status: string, kind: string) =>
  `---\nid: ${id}\nstatus: ${status}\nkind: ${kind}\ntier: T2\n---\n\n# ${id}\n\nBody of ${id}.\n`;

let tmp: string;
let origin: string;
let root: string;
let wtRoot: string;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

function commit(files: Record<string, string>, subject: string) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  sh(root, 'add', '-A');
  sh(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', subject);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-caller-'));
  origin = path.join(tmp, 'origin.git');
  root = path.join(tmp, 'repo');
  wtRoot = path.join(tmp, 'worktrees');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  sh(root, 'remote', 'add', 'origin', origin);
  commit(
    {
      '.minspec/delegations.json': DELEGATIONS,
      'docs/decisions/DR-108.md': dr('DR-108', 'accepted', 'direction'),
      'README.md': 'fixture\n',
    },
    'chore: scaffold (#1)',
  );
  commit({ [SPEC]: spec('SPEC-900', 'specifying') }, 'feat: SPEC-900 fixture spec (#41)');
  commit({ [DR_ENG]: dr('DR-900', 'proposed', 'engineering') }, 'docs: DR-900 engineering record (#42)');
  sh(root, 'push', '-q', 'origin', 'main');
  sh(root, 'fetch', '-q', 'origin');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Recorder {
  gh: string[][];
  ghTokens: string[];
  approve: ApproveCall[];
}

/** The CLI as it behaves on a covered approval: writes the record and flips the lifecycle. */
function passingApprove(call: ApproveCall, verdictPr = 41) {
  const content = fs.readFileSync(path.join(call.worktree, call.artifact), 'utf-8');
  const isDr = call.artifact.startsWith('docs/decisions/');
  const record = {
    specPath: call.artifact,
    specHash: specHash(content),
    approvedAt: '2026-10-21T00:00:00.000Z',
    approvedBy: BOT_ACTOR,
    tier: isDr ? 'T2' : 'T3',
    migrated: false,
    baselineBlob: '',
    actor: BOT_ACTOR,
    basis: 'delegation:DLG-001',
    act: isDr ? 'engineering-dr-acceptance' : 'spec-approval',
    author: 'session:feat/spec-900',
    verdictBy: `https://github.com/${REPO}/pull/${verdictPr}#issuecomment-200`,
  };
  if (call.write) {
    const side = path.join(call.worktree, sidecarPathFor(call.artifact));
    fs.mkdirSync(path.dirname(side), { recursive: true });
    fs.writeFileSync(side, JSON.stringify(record, null, 2) + '\n');
    fs.writeFileSync(
      path.join(call.worktree, call.artifact),
      content.replace(/^status: .*$/m, isDr ? 'status: accepted' : 'status: implementing'),
    );
  }
  return { code: 0, stdout: `noise line\n${JSON.stringify({ ok: true, record, delegationId: 'DLG-001' })}\n` };
}

function deps(rec: Recorder, over: Partial<CallerDeps> = {}): CallerDeps {
  return {
    git: REAL_DEPS.git,
    gh: (args, token) => {
      rec.gh.push([...args]);
      rec.ghTokens.push(token);
      if (args[0] === 'api') return '{"total_count":1,"repositories":[]}';
      if (args[0] === 'pr' && args[1] === 'list') return '[]';
      if (args[0] === 'pr' && args[1] === 'create') return `https://github.com/${REPO}/pull/999\n`;
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    mintToken: () => TOKEN,
    approve: (call) => {
      rec.approve.push(call);
      return passingApprove(call);
    },
    repeatFixShare: () => 0.0807,
    contentPullRequest: REAL_DEPS.contentPullRequest,
    today: () => '2026-10-21',
    ...over,
  };
}

const newRec = (): Recorder => ({ gh: [], ghTokens: [], approve: [] });
const opts = (over: Partial<CallerOptions> = {}): CallerOptions => ({
  repoRoot: root,
  repo: REPO,
  base: 'origin/main',
  max: 5,
  write: true,
  worktreeRoot: wtRoot,
  ...over,
});
const remoteBranches = () =>
  execFileSync('git', ['-C', origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'], { encoding: 'utf-8' })
    .split('\n')
    .filter((l) => l !== '');
const noWrites = (rec: Recorder) => {
  expect(rec.gh.filter((a) => a[0] === 'pr' && a[1] === 'create')).toEqual([]);
  expect(remoteBranches()).toEqual(['main']);
};

describe('the happy path', () => {
  it('records each covered artifact on its own branch and opens the PR as the bot', () => {
    const rec = newRec();
    const report = runCaller(opts(), deps(rec));
    expect(report.refused).toBeUndefined();
    expect(report.ok).toBe(true);
    const opened = report.results.filter((r) => r.outcome === 'opened');
    expect(opened.map((r) => r.artifact).sort()).toEqual([DR_ENG, SPEC]);
    expect(opened.find((r) => r.artifact === SPEC)?.pr).toBe(41);

    // Every GitHub call ran under the minted bot token, and none merges or arms anything.
    expect(rec.ghTokens.every((t) => t === TOKEN)).toBe(true);
    for (const a of rec.gh) {
      expect(a).not.toContain('merge');
      expect(a).not.toContain('--admin');
      expect(a).not.toContain('--auto');
    }

    const branch = opened.find((r) => r.artifact === SPEC)!.branch!;
    expect(remoteBranches()).toContain(branch);
    const files = sh(origin, 'diff', '--name-only', 'main', branch).split('\n').filter(Boolean).sort();
    expect(files).toEqual([sidecarPathFor(SPEC), SPEC].sort());
    expect(sh(origin, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', branch).trim()).toBe(
      `${BOT_ACTOR} <${BOT_EMAIL}>|${BOT_ACTOR} <${BOT_EMAIL}>`,
    );
    expect(sh(origin, 'log', '-1', '--format=%s', branch).trim()).toBe(
      'chore(approve): SPEC-900 approved for implementation (delegated, DLG-001)',
    );
    // No worktree or local branch is left behind.
    expect(fs.readdirSync(wtRoot)).toEqual([]);
    expect(sh(root, 'branch', '--list', 'dlg-approve/*').trim()).toBe('');
  });

  it('the recording branch is never the authoring branch, and the CLI runs on the base content', () => {
    const rec = newRec();
    runCaller(opts(), deps(rec));
    for (const call of rec.approve) {
      expect(call.write).toBe(true);
      expect(call.base).toBe('origin/main');
      expect(path.dirname(call.worktree)).toBe(wtRoot);
    }
  });

  it('a dry run judges through the CLI without --write and pushes nothing', () => {
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.mode).toBe('dry-run');
    expect(report.results.filter((r) => r.outcome === 'would-open')).toHaveLength(2);
    expect(rec.approve.every((c) => c.write === false)).toBe(true);
    noWrites(rec);
    expect(sh(root, 'branch', '--list', 'dlg-approve/*').trim()).toBe('');
  });

  it('--max caps the artifacts recorded per run, oldest content PR first', () => {
    const rec = newRec();
    const report = runCaller(opts({ max: 1 }), deps(rec));
    expect(report.results.find((r) => r.outcome === 'opened')?.artifact).toBe(SPEC);
    expect(report.results.find((r) => r.artifact === DR_ENG)?.reason).toBe('over-max');
  });
});

describe('T0 - the whole run fails closed before any write', () => {
  const refused = (report: ReturnType<typeof runCaller>, reason: string, rec: Recorder) => {
    expect(report.ok).toBe(false);
    expect(report.refused?.reason).toBe(reason);
    expect(report.results).toEqual([]);
    expect(rec.approve).toEqual([]);
    noWrites(rec);
  };

  it('memory-fabric is refused', () => {
    const rec = newRec();
    refused(runCaller(opts({ repo: 'AIClarityAU/memory-fabric' }), deps(rec)), 'repo-never-delegated', rec);
    expect(rec.gh).toEqual([]);
  });

  it('a repo that has not opted in (no .minspec/) is refused', () => {
    fs.rmSync(path.join(root, '.minspec'), { recursive: true });
    const rec = newRec();
    refused(runCaller(opts(), deps(rec)), 'not-opted-in', rec);
  });

  it('a shallow clone is refused, with the real repeat-fix reader too', () => {
    const shallow = path.join(tmp, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow]);
    const rec = newRec();
    refused(
      runCaller(opts({ repoRoot: shallow }), deps(rec, { repeatFixShare: REAL_DEPS.repeatFixShare })),
      'shallow-clone',
      rec,
    );
    expect(REAL_DEPS.repeatFixShare(shallow, 'origin/main')).toBeUndefined();
  });

  it('a missing or malformed delegation record is refused', () => {
    commit({ '.minspec/delegations.json': '{ not json' }, 'chore: break it (#50)');
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    refused(runCaller(opts(), deps(rec)), 'no-delegation-record', rec);

    fs.rmSync(path.join(root, '.minspec/delegations.json'));
    sh(root, 'add', '-A');
    sh(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'chore: drop it (#51)');
    sh(root, 'push', '-q', 'origin', 'main');
    const rec2 = newRec();
    refused(runCaller(opts(), deps(rec2)), 'no-delegation-record', rec2);
  });

  it('a delegation for another repo only is refused', () => {
    const rec = newRec();
    refused(runCaller(opts({ repo: 'AIClarityAU/sealbox' }), deps(rec)), 'no-delegation-record', rec);
  });

  it('an unknown repeat-fix share is refused', () => {
    const rec = newRec();
    refused(runCaller(opts(), deps(rec, { repeatFixShare: () => undefined })), 'tripwire-unknown', rec);
    const rec2 = newRec();
    refused(runCaller(opts(), deps(rec2, { repeatFixShare: () => Number.NaN })), 'tripwire-unknown', rec2);
  });

  it('a repeat-fix share above the tripwire is refused', () => {
    const rec = newRec();
    refused(runCaller(opts(), deps(rec, { repeatFixShare: () => 0.131 })), 'tripwire-tripped', rec);
  });

  it('an empty token is refused, and no gh call is made at all', () => {
    const rec = newRec();
    refused(runCaller(opts(), deps(rec, { mintToken: () => '   ' })), 'no-bot-token', rec);
    expect(rec.gh).toEqual([]);
  });

  it('a token that is not an App installation token (the founder\'s) is refused', () => {
    const rec = newRec();
    const d = deps(rec);
    const report = runCaller(
      opts(),
      {
        ...d,
        gh: (args, token) => {
          if (args[0] === 'api') throw new Error('HTTP 403: Resource not accessible by integration');
          return d.gh(args, token);
        },
      },
    );
    refused(report, 'not-bot-identity', rec);
  });

  it('an open pull request read at its limit is refused (it may be truncated)', () => {
    const rec = newRec();
    const d = deps(rec);
    const report = runCaller(opts(), {
      ...d,
      gh: (args, token) =>
        args[1] === 'list' ? JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ number: i, files: [] }))) : d.gh(args, token),
    });
    refused(report, 'open-pr-read-truncated', rec);
  });

  it('an unreadable open pull request read is refused', () => {
    const rec = newRec();
    const d = deps(rec);
    const report = runCaller(opts(), { ...d, gh: (args, token) => (args[1] === 'list' ? 'garbage' : d.gh(args, token)) });
    refused(report, 'open-pr-read-failed', rec);
  });
});

describe('T0 - scope exclusions', () => {
  it('plan artifacts are never candidates, even with a stale sidecar (#2980)', () => {
    commit(
      {
        [DESIGN]: '---\nid: SPEC-900\nstatus: planning\ntier: T3\n---\n\n# Design\n\nChanged.\n',
        [sidecarPathFor(DESIGN)]: JSON.stringify({ specPath: DESIGN, specHash: 'stale' }),
      },
      'docs: plan only (#60)',
    );
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.results.map((r) => r.artifact)).not.toContain(DESIGN);
    expect(rec.approve.map((c) => c.artifact)).not.toContain(DESIGN);
    expect(isApprovableCandidatePath(DESIGN)).toBe(false);
    expect(isApprovableCandidatePath('specs/minspec/SPEC-900-fixture/tasks.md')).toBe(false);
    expect(isApprovableCandidatePath(SPEC)).toBe(true);
    expect(isApprovableCandidatePath('.minspec/constitution.md')).toBe(false);
  });

  it('a governance decision record is refused before any GitHub read of it', () => {
    commit({ 'docs/decisions/DR-086.md': dr('DR-086', 'proposed', 'engineering') }, 'docs: amend DR-086 (#61)');
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.results.find((r) => r.artifact === 'docs/decisions/DR-086.md')?.reason).toBe(
      'delegation-touches-governance',
    );
    expect(rec.approve.map((c) => c.artifact)).not.toContain('docs/decisions/DR-086.md');
  });

  it('a direction record stays the founder\'s', () => {
    commit({ 'docs/decisions/DR-901.md': dr('DR-901', 'proposed', 'direction') }, 'docs: DR-901 (#62)');
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.results.find((r) => r.artifact === 'docs/decisions/DR-901.md')?.reason).toBe(
      'delegation-direction-record',
    );
  });

  it('content that already has a current approval record is not approved again', () => {
    const content = spec('SPEC-901', 'planning');
    commit(
      {
        'specs/minspec/SPEC-901-x/requirements.md': content,
        [sidecarPathFor('specs/minspec/SPEC-901-x/requirements.md')]: JSON.stringify({ specHash: specHash(content) }),
      },
      'feat: approved (#63)',
    );
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.alreadyApproved).toBe(1);
    expect(rec.approve.map((c) => c.artifact)).not.toContain('specs/minspec/SPEC-901-x/requirements.md');
  });

  it('a terminal spec, an unparseable sidecar and an artifact in an open PR are not recorded', () => {
    commit(
      {
        'specs/minspec/SPEC-902-x/requirements.md': spec('SPEC-902', 'done'),
        'specs/minspec/SPEC-903-x/requirements.md': spec('SPEC-903', 'specifying'),
        [sidecarPathFor('specs/minspec/SPEC-903-x/requirements.md')]: '{ bad',
      },
      'feat: more (#64)',
    );
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const d = deps(rec);
    const report = runCaller(opts({ write: false }), {
      ...d,
      gh: (args, token) =>
        args[1] === 'list' ? JSON.stringify([{ number: 7, headRefName: 'x', files: [{ path: SPEC }] }]) : d.gh(args, token),
    });
    const by = (a: string) => report.results.find((r) => r.artifact === a)?.reason;
    expect(by('specs/minspec/SPEC-902-x/requirements.md')).toBeUndefined();
    expect(by('specs/minspec/SPEC-903-x/requirements.md')).toBe('sidecar-unreadable');
    expect(by(SPEC)).toBe('in-open-pr');
    expect(rec.approve.map((c) => c.artifact)).toEqual([DR_ENG]);
  });

  it('a content PR that cannot be read from git is skipped', () => {
    commit({ 'specs/minspec/SPEC-904-x/requirements.md': spec('SPEC-904', 'specifying') }, 'direct push, no PR number');
    sh(root, 'push', '-q', 'origin', 'main');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    expect(report.results.find((r) => r.artifact === 'specs/minspec/SPEC-904-x/requirements.md')?.reason).toBe(
      'content-pr-unknown',
    );
  });

  it('an approval branch already on origin is never re-pushed; with no open PR it is a visible error', () => {
    const content = fs.readFileSync(path.join(root, SPEC), 'utf-8');
    const branch = branchFor('SPEC-900', specHash(content));
    sh(root, 'push', '-q', 'origin', `main:refs/heads/${branch}`);
    const rec = newRec();
    const report = runCaller(opts(), deps(rec));
    expect(report.results.find((r) => r.artifact === SPEC)).toMatchObject({ outcome: 'error', reason: 'approval-branch-without-pr' });
    expect(report.ok).toBe(false);

    const rec2 = newRec();
    const d = deps(rec2);
    const report2 = runCaller(opts(), {
      ...d,
      gh: (args, token) =>
        args[1] === 'list' ? JSON.stringify([{ number: 8, headRefName: branch, files: [] }]) : d.gh(args, token),
    });
    expect(report2.results.find((r) => r.artifact === SPEC)).toMatchObject({ outcome: 'skipped', reason: 'approval-pr-open' });
    expect(sh(origin, 'rev-parse', branch).trim()).toBe(sh(origin, 'rev-parse', 'main').trim());
  });
});

describe('T0 - an unknown or non-pass verdict denies and pushes nothing', () => {
  const only = (approve: CallerDeps['approve']) => {
    const rec = newRec();
    const report = runCaller(opts({ max: 1 }), deps(rec, { approve }));
    const r = report.results.find((x) => x.artifact === SPEC)!;
    noWrites(rec);
    expect(fs.readdirSync(wtRoot)).toEqual([]);
    expect(sh(root, 'branch', '--list', 'dlg-approve/*').trim()).toBe('');
    return r;
  };

  it('a CLI denial is reported by its reason', () => {
    const r = only(() => ({ code: 1, stdout: '{"ok":false,"reason":"latest-review-not-pass","detail":"x"}\n' }));
    expect(r.outcome).toBe('denied');
    expect(r.reason).toBe('cli-denied:latest-review-not-pass');
  });

  it('unreadable CLI output is a denial, even with exit 0', () => {
    expect(only(() => ({ code: 0, stdout: 'Approved!\n' })).reason).toBe('cli-output-unreadable');
    expect(only(() => ({ code: 0, stdout: '{"ok":true}\n' })).reason).toBe('cli-output-unreadable');
  });

  it('ok:true with a non-zero exit is a denial', () => {
    expect(only((c) => ({ ...passingApprove(c), code: 1 })).outcome).toBe('denied');
  });

  it('a record not under the bot, or with no independent verdict, is a denial', () => {
    const tweak = (patch: Record<string, string>) => (c: ApproveCall) => {
      const run = passingApprove(c);
      const j = JSON.parse(run.stdout.trim().split('\n').pop()!);
      return { code: 0, stdout: JSON.stringify({ ...j, record: { ...j.record, ...patch } }) };
    };
    expect(only(tweak({ actor: 'harvest316', approvedBy: 'harvest316' })).reason).toBe('record-not-bot');
    expect(only(tweak({ verdictBy: 'https://example.com/x' })).reason).toBe('record-no-independent-verdict');
    expect(
      only(tweak({ author: `https://github.com/${REPO}/pull/41#issuecomment-200` })).reason,
    ).toBe('record-verdict-by-author');
  });

  it('a write beyond the sidecar and its approvable is refused before the push', () => {
    const r = only((c) => {
      const run = passingApprove(c);
      fs.writeFileSync(path.join(c.worktree, '.minspec/delegations.json'), '{}');
      return run;
    });
    expect(r.reason).toBe('unexpected-write');
    expect(r.detail).toContain('.minspec/delegations.json');
  });
});

describe('helpers', () => {
  it('porcelain -z keeps the status column and both rename paths', () => {
    expect(parsePorcelainZ(' M a.md\0?? b c.json\0R  new.md\0old.md\0')).toEqual(['a.md', 'b c.json', 'new.md', 'old.md']);
  });

  it('the verdict reader takes the last JSON line', () => {
    const r = readCliVerdict({ code: 1, stdout: 'x\n{"ok":false,"reason":"pr-not-merged"}\n\n' }, SPEC, REPO);
    expect(r).toMatchObject({ ok: false, reason: 'cli-denied:pr-not-merged' });
  });

  it('the argument parse is strict', () => {
    expect(parseCallerArgs(['--bogus'], root)).toBe('unknown argument: --bogus');
    expect(parseCallerArgs(['--max', '0', '--repo', REPO], root)).toBe('--max must be a positive integer');
    expect(parseCallerArgs(['--repo'], root)).toBe('--repo needs a value');
    expect(parseCallerArgs(['--repo', REPO, '--write', '--max', '3'], root)).toMatchObject({
      repo: REPO,
      write: true,
      max: 3,
      base: 'origin/main',
    });
    // Dry run is the default.
    expect(parseCallerArgs(['--repo', REPO], root)).toMatchObject({ write: false });
  });
});

describe('errorDetail (#3013: git stderr reaches the report)', () => {
  it('carries the first stderr lines after the command line', () => {
    let caught: unknown;
    try {
      execFileSync('git', ['-C', os.tmpdir(), 'commit-nonexistent-subcommand'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      caught = e;
    }
    const d = errorDetail(caught);
    expect(d).toContain('Command failed: git');
    expect(d).toContain('| stderr: ');
    expect(d).toMatch(/not a git command/);
  });

  it('keeps only three stderr lines and falls back to the head without stderr', () => {
    const err = Object.assign(new Error('Command failed: git x'), { stderr: 'a\n\nb\nc\nd\n' });
    expect(errorDetail(err)).toBe('Error: Command failed: git x | stderr: a / b / c');
    expect(errorDetail(new Error('boom'))).toBe('Error: boom');
  });
});

describe('#3020: hook-gated commit needs deps in the recording worktree', () => {
  it('drops the node crash banner so the real message reaches the report', () => {
    const stderr =
      "node:internal/modules/cjs/loader:1430\n  const err = new Error(message);\n              ^\n\nError: Cannot find module 'handlebars'\nRequire stack:\n";
    const d = errorDetail(Object.assign(new Error('Command failed: git commit'), { stderr }));
    expect(d).toContain("Cannot find module 'handlebars'");
    expect(d).not.toContain('node:internal');
  });

  it('links the primary node_modules into a worktree that lacks it, once', () => {
    const primary = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-prim-'));
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-wt-'));
    expect(linkDependencies(primary, wt)).toBe(false); // primary has none
    fs.mkdirSync(path.join(primary, 'node_modules'));
    expect(linkDependencies(primary, wt)).toBe(true);
    expect(fs.realpathSync(path.join(wt, 'node_modules'))).toBe(fs.realpathSync(path.join(primary, 'node_modules')));
    expect(linkDependencies(primary, wt)).toBe(false); // already present
  });
});

describe('open Clarify questions (#3059)', () => {
  it('skips a spec with an unanswered decision, by name, and never runs the CLI', () => {
    commit(
      {
        'specs/minspec/SPEC-901-open/requirements.md': spec(
          'SPEC-901',
          'specifying',
          '\n\n## Decisions needed (Clarify)\n\n**D1. Pick one.**\n- (a) x\n',
        ),
      },
      'feat: SPEC-901 (#43)',
    );
    sh(root, 'push', '-q', 'origin', 'main');
    sh(root, 'fetch', '-q', 'origin');
    const rec = newRec();
    const report = runCaller(opts({ write: false }), deps(rec));
    const r = report.results.find((x) => x.artifact.includes('SPEC-901'));
    expect(r?.outcome).toBe('skipped');
    expect(r?.reason).toBe('clarify-open');
    expect(r?.detail).toContain('D1');
    expect(rec.approve.map((a) => a.artifact)).not.toContain('specs/minspec/SPEC-901-open/requirements.md');
  });
});
