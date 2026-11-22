/**
 * `.githooks/pre-commit` — approve-then-edit race gate (#424).
 *
 * Runs the REAL hook in a throwaway repo (core.hooksPath -> the real .githooks), so a
 * gate that never fires cannot pass. Both directions are pinned: the clean paths must
 * PASS or an always-red gate would look like it works.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { specHash } from '../../shared/src/canonical';
import { applyDelegationCoverage, checkApprovable, type RaceFailure } from '../../../scripts/lib/approval-sidecar-race';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');
const SPEC = 'specs/x/SPEC-900/requirements.md';
const SIDECAR = `.minspec/approvals/${SPEC}.json`;
const V1 = '---\nid: SPEC-900\nstatus: approved\n---\n\n# S\n\nFR1: original.\n';
const V2 = '---\nid: SPEC-900\nstatus: approved\n---\n\n# S\n\nFR1: rewritten.\n';

let tmp: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });
const write = (rel: string, body: string) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const sidecarFor = (body: string) => JSON.stringify({ specPath: SPEC, specHash: specHash(body) }) + '\n';
const commit = (env: Record<string, string> = {}) =>
  spawnSync('git', ['commit', '-m', 'x'], { cwd: tmp, encoding: 'utf-8', env: { ...process.env, ...env } });

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-race-gate-')));
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 't@minspec.test']);
  git(['config', 'user.name', 'T']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR]);
  // Baseline: approved spec + matching sidecar, committed with the gate bypassed.
  write(SPEC, V1);
  write(SIDECAR, sidecarFor(V1));
  git(['add', '-A']);
  const r = commit({ APPROVAL_RACE_GATE_OFF: '1', DR_INDEX_GATE_OFF: '1' });
  expect(r.status).toBe(0);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('approval race gate (#424)', () => {
  it('rejects a staged spec edit whose committed sidecar is not re-staged', () => {
    write(SPEC, V2);
    git(['add', SPEC]);
    const r = commit({ DR_INDEX_GATE_OFF: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
  });

  it('allows the edit when the matching re-approval sidecar is staged too', () => {
    write(SPEC, V2);
    write(SIDECAR, sidecarFor(V2));
    git(['add', SPEC, SIDECAR]);
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('rejects a staged sidecar that describes earlier bytes (the e9f82ca shape)', () => {
    write(SPEC, V2); // edited after the sidecar was computed from V1
    git(['add', SPEC, SIDECAR]);
    // sidecar on disk is still V1's, but touch it so it is part of the commit
    write(SIDECAR, JSON.stringify({ specPath: SPEC, specHash: specHash(V1), approvedAt: 't' }) + '\n');
    git(['add', SIDECAR]);
    const r = commit({ DR_INDEX_GATE_OFF: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-mismatch');
  });

  it('ignores status-only edits (lifecycle keys do not change the hash)', () => {
    write(SPEC, V1.replace('status: approved', 'status: implementing'));
    git(['add', SPEC]);
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('ignores a spec with no sidecar', () => {
    write('specs/x/SPEC-901/requirements.md', V2);
    git(['add', 'specs/x/SPEC-901/requirements.md']);
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('reads the staged index, not the working tree', () => {
    // Index: V2 + a sidecar matching V2 (a valid re-approval). Working tree then drifts to a
    // third body that would hash differently; a gate reading the working tree would refuse.
    write(SPEC, V2);
    write(SIDECAR, sidecarFor(V2));
    git(['add', SPEC, SIDECAR]);
    write(SPEC, V2.replace('rewritten', 'drifted after staging'));
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('allows a revoked approval: sidecar deletion staged with an edit', () => {
    write(SPEC, V2);
    git(['add', SPEC]);
    git(['rm', '-q', '--cached', SIDECAR]);
    fs.rmSync(path.join(tmp, SIDECAR));
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('control: an edit with the sidecar neither re-staged nor deleted still fails', () => {
    write(SPEC, V2);
    git(['add', SPEC]);
    fs.rmSync(path.join(tmp, SIDECAR)); // deleted in working tree only, not staged
    const r = commit({ DR_INDEX_GATE_OFF: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
  });

  it('rejects a sidecar staged alone that does not match the committed spec', () => {
    write(SIDECAR, sidecarFor(V2)); // approval of bytes that are only in the working tree
    write(SPEC, V2);
    git(['add', SIDECAR]);
    const r = commit({ DR_INDEX_GATE_OFF: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-mismatch');
  });

  it('allows a sidecar staged alone that matches the committed spec', () => {
    write(SIDECAR, JSON.stringify({ specPath: SPEC, specHash: specHash(V1), approvedAt: 't' }) + '\n');
    git(['add', SIDECAR]);
    expect(commit({ DR_INDEX_GATE_OFF: '1' }).status).toBe(0);
  });

  it('fails closed when the checker script is missing', () => {
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-race-hooks-'));
    try {
      // Mirror the hook at a root that has no scripts/ dir.
      const root = path.join(hooks, 'r');
      fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
      fs.copyFileSync(path.join(REAL_HOOKS_DIR, 'pre-commit'), path.join(root, '.githooks', 'pre-commit'));
      fs.chmodSync(path.join(root, '.githooks', 'pre-commit'), 0o755);
      git(['config', 'core.hooksPath', path.join(root, '.githooks')]);
      write(SPEC, V2);
      git(['add', SPEC]);
      const r = commit({ DR_INDEX_GATE_OFF: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('checker script missing');
    } finally {
      fs.rmSync(hooks, { recursive: true, force: true });
    }
  });

  it('names a missing toolchain as such, and still fails closed (#3963)', () => {
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-race-hooks-'));
    const emptyCache = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-race-cache-'));
    try {
      // Hook root with a checker script but NO node_modules, and an empty npx cache.
      const root = path.join(hooks, 'r');
      fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
      fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(REAL_HOOKS_DIR, 'pre-commit'), path.join(root, '.githooks', 'pre-commit'));
      fs.chmodSync(path.join(root, '.githooks', 'pre-commit'), 0o755);
      fs.writeFileSync(path.join(root, 'scripts', 'check-approval-sidecar-race.ts'), 'process.exit(0);\n');
      git(['config', 'core.hooksPath', path.join(root, '.githooks')]);
      write(SPEC, V2);
      git(['add', SPEC]);
      const r = commit({ DR_INDEX_GATE_OFF: '1', npm_config_cache: emptyCache });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('TOOLCHAIN MISSING');
      expect(r.stderr).not.toContain('sidecar-not-restaged');
    } finally {
      fs.rmSync(hooks, { recursive: true, force: true });
      fs.rmSync(emptyCache, { recursive: true, force: true });
    }
  });

  it('APPROVAL_RACE_GATE_OFF=1 bypasses only this gate', () => {
    write(SPEC, V2);
    git(['add', SPEC]);
    expect(commit({ DR_INDEX_GATE_OFF: '1', APPROVAL_RACE_GATE_OFF: '1' }).status).toBe(0);
  });
});

describe('checkApprovable (pure)', () => {
  const base = { path: SPEC, stagedContent: V2, headSidecarText: sidecarFor(V1), sidecarStaged: false, stagedSidecarText: null };
  it('fails closed on an unreadable committed sidecar', () => {
    expect(checkApprovable({ ...base, headSidecarText: 'not json' }, specHash)?.check).toBe('sidecar-unreadable');
  });
  it('passes an unapproved file', () => {
    expect(checkApprovable({ ...base, headSidecarText: null }, specHash)).toBeNull();
  });
});

// ── #3831: a live delegation turns a voided approval into a warning ─────────────────────
//
// DLG-001 (DR-108) lets the bot re-approve a spec after its content merges, but this gate
// refused the content commit itself, so an approved spec could never be edited at all. When
// a live delegation covers the spec the void is the EXPECTED state: warn, let it land, and
// let the delegated caller re-approve. Every witness is read from HEAD and fails closed.
describe('approval race gate: delegation-covered spec edits (#3831)', () => {
  const T3V1 = '---\nid: SPEC-900\nstatus: approved\ntier: T3\n---\n\n# S\n\nFR1: original.\n';
  const T3V2 = '---\nid: SPEC-900\nstatus: approved\ntier: T3\n---\n\n# S\n\nFR1: rewritten.\n';
  const DELEGATIONS = '.minspec/delegations.json';
  const DR = 'docs/decisions/DR-108.md';
  const ENV = { DR_INDEX_GATE_OFF: '1' };
  const record = (over: Record<string, unknown> = {}) =>
    JSON.stringify(
      {
        version: 1,
        delegations: [
          {
            id: 'DLG-001',
            decision: 'DR-108',
            words: 'greenlight',
            said: '2026-10-17',
            source: 'test',
            repo: 'AIClarityAU/minspec',
            covers: ['spec-approval'],
            tiers: ['T1', 'T2', 'T3', 'T4'],
            reviewBy: '2999-01-01',
            tripwire: { metric: 'repeat-fix-share', max: 0.13 },
            ...over,
          },
        ],
      },
      null,
      2,
    ) + '\n';
  const sidecarOf = (body: string) => JSON.stringify({ specPath: SPEC, specHash: specHash(body) }) + '\n';

  /** Commit the witnesses (gate off) under a fix subject so the repeat-fix share is known: 0/1. */
  function seed(opts: { delegations?: string | null; drStatus?: string; fixCommit?: boolean } = {}) {
    git(['remote', 'add', 'origin', 'https://github.com/AIClarityAU/minspec.git']);
    git(['checkout', '-q', '-b', 'work']); // with an origin, the default-branch guard refuses main
    write(SPEC, T3V1);
    write(SIDECAR, sidecarOf(T3V1));
    if (opts.delegations !== null) write(DELEGATIONS, opts.delegations ?? record());
    write(DR, `---\nid: DR-108\nstatus: ${opts.drStatus ?? 'accepted'}\n---\n\n# DR-108\n`);
    git(['add', '-A']);
    const msg = opts.fixCommit === false ? ['-m', 'chore: seed'] : ['-m', 'fix(#1): seed', '-m', 'Root cause: test seed.'];
    const r = spawnSync('git', ['commit', ...msg], {
      cwd: tmp,
      encoding: 'utf-8',
      env: { ...process.env, APPROVAL_RACE_GATE_OFF: '1', DR_INDEX_GATE_OFF: '1', ADR_BORN_GATE_OFF: '1' },
    });
    expect(r.status, r.stderr).toBe(0);
  }
  const editSpec = () => {
    write(SPEC, T3V2);
    git(['add', SPEC]);
  };

  it('(a) covered: warns and allows the content commit, leaving the sidecar untouched', () => {
    seed();
    editSpec();
    const r = commit(ENV);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('warning');
    expect(r.stderr).toContain('sidecar-not-restaged');
    expect(r.stderr).toContain('DLG-001');
    // No approval is written or re-written: the committed sidecar still describes V1.
    expect(execFileSync('git', ['show', `HEAD:${SIDECAR}`], { cwd: tmp, encoding: 'utf-8' })).toBe(sidecarOf(T3V1));
  });

  it('(b) not covered: decision record not accepted -> refuses as before', () => {
    seed({ drStatus: 'proposed' });
    editSpec();
    const r = commit(ENV);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
    expect(r.stderr).not.toContain('warning');
  });

  it('(b) not covered: delegation names another repo -> refuses', () => {
    seed({ delegations: record({ repo: 'AIClarityAU/sealbox' }) });
    editSpec();
    expect(commit(ENV).status).not.toBe(0);
  });

  it('(b) not covered: tier outside the delegation -> refuses', () => {
    seed({ delegations: record({ tiers: ['T1'] }) });
    editSpec();
    expect(commit(ENV).status).not.toBe(0);
  });

  it('(b) not covered: repeat-fix share unknown (no fix commits) -> refuses', () => {
    seed({ fixCommit: false });
    editSpec();
    const r = commit(ENV);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
  });

  it('(c) malformed delegation record -> refuses (fail closed)', () => {
    seed({ delegations: '{ not json' });
    editSpec();
    const r = commit(ENV);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
  });

  it('(c) missing delegation record -> refuses (fail closed)', () => {
    seed({ delegations: null });
    editSpec();
    expect(commit(ENV).status).not.toBe(0);
  });

  it('(c) a delegation staged in the same commit grants nothing: witnesses come from HEAD', () => {
    seed({ delegations: null });
    editSpec();
    write(DELEGATIONS, record());
    git(['add', DELEGATIONS]);
    expect(commit(ENV).status).not.toBe(0);
  });

  it('(c) a tier change staged in the same commit grants nothing: the tier is read from HEAD', () => {
    seed({ delegations: record({ tiers: ['T1'] }) }); // HEAD spec is T3: out of scope
    write(SPEC, T3V2.replace('tier: T3', 'tier: T1'));
    git(['add', SPEC]);
    const r = commit(ENV);
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain('sidecar-not-restaged');
    expect(r.stderr).not.toContain('warning');
  });

  it('covered spec, stale STAGED sidecar (sidecar-mismatch) still refuses', () => {
    seed();
    write(SPEC, T3V2);
    write(SIDECAR, JSON.stringify({ specPath: SPEC, specHash: specHash(T3V1), approvedAt: 't' }) + '\n');
    git(['add', SPEC, SIDECAR]);
    const r = commit(ENV);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('sidecar-mismatch');
  });
});

describe('applyDelegationCoverage (pure, #3831)', () => {
  const voided: RaceFailure = { path: SPEC, check: 'sidecar-not-restaged', detail: 'd' };
  it('downgrades only a covered sidecar-not-restaged', () => {
    const out = applyDelegationCoverage([voided], () => ({ covered: true, detail: 'covered by DLG-001' }));
    expect(out.refusals).toEqual([]);
    expect(out.warnings.map((w) => w.path)).toEqual([SPEC]);
  });
  it('refuses when not covered', () => {
    const out = applyDelegationCoverage([voided], () => ({ covered: false, detail: 'no' }));
    expect(out.refusals.length).toBe(1);
    expect(out.warnings).toEqual([]);
  });
  it('never asks about, or downgrades, a mismatch or unreadable sidecar', () => {
    let asked = 0;
    const cov = () => (asked++, { covered: true, detail: 'x' });
    const out = applyDelegationCoverage(
      [
        { path: SPEC, check: 'sidecar-mismatch', detail: 'm' },
        { path: SPEC, check: 'sidecar-unreadable', detail: 'u' },
      ],
      cov,
    );
    expect(out.refusals.length).toBe(2);
    expect(asked).toBe(0);
  });
  it('fails closed when the coverage witness throws', () => {
    const out = applyDelegationCoverage([voided], () => {
      throw new Error('boom');
    });
    expect(out.refusals.length).toBe(1);
    expect(out.refusals[0].detail).toContain('boom');
  });
});
