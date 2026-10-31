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
import { execFileSync, spawnSync } from 'node:child_process';

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

  /**
   * tsx by ABSOLUTE path, found by walking up from the repo (#1032). `npx tsx` with a
   * cwd outside the repo cannot resolve tsx and falls back to the npx cache or a
   * registry fetch, which a Tier-0/offline gate must not depend on.
   */
  function tsxBin(): string {
    let dir = REPO_ROOT;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'node_modules', '.bin', 'tsx');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`could not find node_modules/.bin/tsx at or above ${REPO_ROOT}`);
  }

  /** The caller's env minus MINSPEC_* and GIT_*, so a live drain or a git hook cannot leak in. */
  function scrubbedEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MINSPEC|GIT)_/.test(k)));
  }

  function run(script: string, args: string[], stub: string): { status: number; stdout: string; stderr: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-id-cli-'));
    const bin = path.join(tmp, 'gh');
    fs.writeFileSync(bin, stub, { mode: 0o755 });
    // cwd is an empty repo so the allocator's local reads are empty and deterministic
    execFileSync('git', ['init', '-q'], { cwd: tmp, env: scrubbedEnv() });
    try {
      const out = execFileSync(tsxBin(), [path.join(REPO_ROOT, 'scripts', script), ...args], {
        cwd: tmp,
        encoding: 'utf-8',
        env: { ...scrubbedEnv(), SPEC_ID_GH_BIN: bin, GITHUB_ACTIONS: '' },
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

  // SPEC-227 FR-12 (gate fails closed): a listing that succeeds with nothing in it is not
  // "nothing is claimed". It would hand out SPEC-001 with exit 0.
  const EMPTY_BASE = WORLD.replace(
    `'[[{"type":"dir","path":"specs/minspec/SPEC-231-a"},{"type":"dir","path":"specs/minspec/SPEC-232-b"}]]'`,
    `'[[]]'`,
  );
  const NO_PRODUCTS = WORLD.replace(`'[[{"type":"dir","path":"specs/minspec"}]]'`, `'[[]]'`);

  it.each([
    ['a product directory with no specs', EMPTY_BASE],
    ['a specs directory with no products', NO_PRODUCTS],
  ])('allocator and check fail closed on an empty base listing: %s', (_name, stub) => {
    expect(stub).not.toBe(WORLD);
    const alloc = run('next-spec-id.ts', REPO_ARGS, stub);
    expect(alloc.status).toBe(1);
    expect(alloc.stdout.trim()).toBe('');
    expect(alloc.stderr).toContain('FAILED CLOSED');
    const check = run('check-spec-id-collision.ts', [...REPO_ARGS, '--pr', '3153'], stub);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('FAILED CLOSED');
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

/**
 * SPEC-227 AC-6 (dispatch prompt carries the literal id). The real span of
 * dispatch-issue.sh, from the allocator block to the end of the Specify prompt, run with a
 * stub tsx under the dispatcher's own root. Deleting the block fails these.
 */
describe('dispatch-issue.sh — the Specify prompt carries the allocated id', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'dispatch-issue.sh'), 'utf-8');
  const SCRIPTS = path.join(REPO_ROOT, 'scripts');

  function allocatorSpan(): string {
    const from = source.indexOf('SPEC_ID_TEXT="the next unused number"');
    const end = '\nPROMPT\n)';
    const to = source.indexOf(end, from);
    expect(from, 'allocator block is gone from dispatch-issue.sh').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return `${source.slice(from, to + end.length)}\nfi\nprintf '%s' "\${PROMPT:-}"`;
  }

  function dispatch(tsxBody: string, specifyOnly = '1') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-id-dispatch-'));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-id-caller-'));
    try {
      const log = path.join(root, 'calls.log');
      fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'node_modules', '.bin', 'tsx'),
        `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd -P)" "$*" >> ${JSON.stringify(log)}\n${tsxBody}\n`,
        { mode: 0o755 },
      );
      const vars = Object.entries({
        SPECIFY_ONLY: specifyOnly, ISSUE: '42', ROLE: 'dev', REPO: 'o/r', ISSUE_BODY: '',
        ROLE_SECTION: '', BRANCH: 'b', WORKTREE: 'w', REPO_ROOT: root, SCRIPT_DIR: SCRIPTS,
      }).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n');
      const r = spawnSync('bash', ['-c', `set -euo pipefail\n${vars}\n${allocatorSpan()}`], {
        cwd: elsewhere,
        encoding: 'utf-8',
      });
      return {
        status: r.status,
        prompt: r.stdout,
        stderr: r.stderr,
        root: fs.realpathSync(root),
        calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : [],
      };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  }

  it('writes the allocated id into the prompt, in place of "the next unused number"', () => {
    const r = dispatch('echo SPEC-777');
    expect(r.status, r.stderr).toBe(0);
    expect(r.prompt).toContain('`id: SPEC-NNN` (exactly SPEC-777');
    expect(r.prompt).not.toContain('the next unused number');
    expect(r.stderr).toBe('');
  });

  it('runs the allocator from the dispatcher\'s checkout, whatever the caller\'s directory', () => {
    const r = dispatch('echo SPEC-777');
    expect(r.calls).toEqual([`${r.root}|${SCRIPTS}/next-spec-id.ts --repo o/r --base main`]);
  });

  it.each([
    ['the allocator fails', 'echo "FAILED CLOSED" >&2; exit 1'],
    ['the allocator prints something that is not an id', 'echo banana'],
  ])('when %s the dispatch goes on, warns visibly and keeps the old wording', (_name, body) => {
    const r = dispatch(body);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('WARNING: open-PR-aware spec id lookup failed for #42');
    expect(r.prompt).toContain('`id: SPEC-NNN` (the next unused number)');
    expect(r.prompt).not.toContain('banana');
  });

  it('a build dispatch never allocates', () => {
    const r = dispatch('echo SPEC-777', '0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
  });
});
