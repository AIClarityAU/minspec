/**
 * T0 — the spec-id allocator and advisory PR check must see ids claimed by OPEN PRs (#3164).
 *
 * ROOT CAUSE this file pins. A Specify dispatch allocated `max(SPEC id on its own base
 * checkout) + 1`; open pull requests are invisible from a base checkout, so every dispatch
 * that ran while SPEC-232 was in flight picked SPEC-232 (11 open PRs on 2026-10-27). DRs
 * already had the cure (`check-dr-id-collision.ts`: max across main AND every open PR);
 * spec ids had neither the allocator nor the advisory check.
 *
 * Decision logic is asserted by CALLING it; the scripts by running them against a stub `gh`
 * pinned through the `SPEC_ID_GH_BIN` seam, so no test reaches GitHub.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  claimedSpecDirsFromPrFiles,
  decideSpecIdCollision,
  nextFreeSpecId,
  specDirFromPath,
} from '../../../scripts/lib/spec-id-claims';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const D = (n: number, slug = 'x') => `specs/minspec/SPEC-${String(n).padStart(3, '0')}-${slug}`;

describe('pure — claims and next free id', () => {
  it('specDirFromPath returns the spec directory, undefined for non-spec paths', () => {
    expect(specDirFromPath('specs/minspec/SPEC-232-a/requirements.md')).toBe('specs/minspec/SPEC-232-a');
    expect(specDirFromPath('docs/decisions/DR-232.md')).toBeUndefined();
  });

  it('claimedSpecDirsFromPrFiles keeps only introducing statuses under the specs dir', () => {
    const dirs = claimedSpecDirsFromPrFiles(
      [
        { filename: `${D(232, 'a')}/requirements.md`, status: 'added' },
        { filename: `${D(232, 'a')}/design.md`, status: 'added' },
        { filename: `${D(100, 'old')}/requirements.md`, status: 'modified' },
        { filename: `${D(101, 'gone')}/requirements.md`, status: 'removed' },
        { filename: 'README.md', status: 'added' },
      ],
      'specs',
    );
    expect(dirs).toEqual([D(232, 'a')]);
  });

  it('nextFreeSpecId is the max across ALL sources plus one — an open PR counts', () => {
    // base tops out at 231; an open PR already holds 248
    expect(nextFreeSpecId([D(231)], [D(248, 'pr')])).toBe('SPEC-249');
    expect(nextFreeSpecId([D(231)])).toBe('SPEC-232');
    expect(nextFreeSpecId([])).toBe('SPEC-001');
  });
});

describe('pure — decideSpecIdCollision', () => {
  const base = [D(231), D(232, 'push-docs-lane-eligibility')];

  it('fails a PR whose new id is held by a different directory on the base', () => {
    const v = decideSpecIdCollision({ baseRef: 'main', baseDirs: base, subject: { pr: 3153, dirs: [D(232, 'mine')] }, otherPrs: [] });
    expect(v.ok).toBe(false);
    expect(v.findings[0]).toMatchObject({ id: 'SPEC-232', against: 'base' });
    expect(v.nextFreeId).toBe('SPEC-233');
    expect(v.message).toContain('Next free id: SPEC-233');
  });

  it('two open PRs on one id: only the later PR yields', () => {
    const early = { pr: 3122, dirs: [D(240, 'a')] };
    const late = { pr: 3124, dirs: [D(240, 'b')] };
    expect(decideSpecIdCollision({ baseRef: 'main', baseDirs: [D(231)], subject: late, otherPrs: [early, late] }).ok).toBe(false);
    expect(decideSpecIdCollision({ baseRef: 'main', baseDirs: [D(231)], subject: early, otherPrs: [early, late] }).ok).toBe(true);
  });

  it('next free id counts every open PR, so the suggested renumber cannot itself clash', () => {
    const v = decideSpecIdCollision({
      baseRef: 'main',
      baseDirs: base,
      subject: { pr: 3153, dirs: [D(232, 'mine')] },
      otherPrs: [{ pr: 3122, dirs: [D(248, 'a')] }, { pr: 3124, dirs: [D(249, 'b')] }],
    });
    expect(v.nextFreeId).toBe('SPEC-250');
  });

  it('extending an already-merged spec directory is not a collision', () => {
    const v = decideSpecIdCollision({ baseRef: 'main', baseDirs: base, subject: { pr: 9, dirs: [D(231)] }, otherPrs: [] });
    expect(v.ok).toBe(true);
  });
});

describe('scripts — against a stub gh, failing closed', () => {
  const REPO_ARGS = ['--repo', 'o/r', '--base', 'main'];

  /** Stub gh serving a fixed world: base 231/232, open PRs 3122 (id 248) and 3124 (id 249). */
  const WORLD = `#!/bin/sh
case "$*" in
  *"contents/specs?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec"}]]' ;;
  *"contents/specs/minspec?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec/SPEC-231-a"},{"type":"dir","path":"specs/minspec/SPEC-232-b"}]]' ;;
  *graphql*) echo '{"data":{"repository":{"pullRequests":{"pageInfo":{"hasNextPage":false},"nodes":[
    {"number":3122,"files":{"pageInfo":{"hasNextPage":false},"nodes":[{"path":"specs/minspec/SPEC-248-c/requirements.md","changeType":"ADDED"}]}},
    {"number":3124,"files":{"pageInfo":{"hasNextPage":false},"nodes":[{"path":"specs/minspec/SPEC-249-d/requirements.md","changeType":"ADDED"}]}},
    {"number":3153,"files":{"pageInfo":{"hasNextPage":false},"nodes":[{"path":"specs/minspec/SPEC-232-e/requirements.md","changeType":"ADDED"}]}}
  ]}}}}' ;;
  *"pulls/3153/files"*) echo '[[{"filename":"specs/minspec/SPEC-232-e/requirements.md","status":"added"}]]' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`;

  function run(script: string, args: string[], stub: string): { status: number; stdout: string; stderr: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-id-cli-'));
    const bin = path.join(tmp, 'gh');
    fs.writeFileSync(bin, stub, { mode: 0o755 });
    // cwd is an empty dir so the allocator's working-tree read is empty and deterministic
    try {
      const out = execFileSync('npx', ['tsx', path.join(REPO_ROOT, 'scripts', script), ...args], {
        cwd: tmp,
        encoding: 'utf-8',
        env: { ...process.env, SPEC_ID_GH_BIN: bin, GITHUB_ACTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: out, stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('allocator prints max(base, open PRs)+1 — 250, not the blind 233', () => {
    const r = run('next-spec-id.ts', REPO_ARGS, WORLD);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('SPEC-250');
  });

  it('allocator fails closed with no id on stdout when gh errors', () => {
    const r = run('next-spec-id.ts', REPO_ARGS, '#!/bin/sh\necho "HTTP 403" >&2\nexit 1\n');
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toContain('FAILED CLOSED');
  });

  it('check names the clash with main and the next free id', () => {
    const r = run('check-spec-id-collision.ts', [...REPO_ARGS, '--pr', '3153'], WORLD);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SPEC-232');
    expect(r.stderr).toContain('Next free id: SPEC-250');
  });

  it('check fails closed when gh errors — never green because it could not look', () => {
    const r = run('check-spec-id-collision.ts', [...REPO_ARGS, '--pr', '3153'], '#!/bin/sh\nexit 1\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAILED CLOSED');
  });
});
