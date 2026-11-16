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
import { checkApprovable } from '../../../scripts/lib/approval-sidecar-race';
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
