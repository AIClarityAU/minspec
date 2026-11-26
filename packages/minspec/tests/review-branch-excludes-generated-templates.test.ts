/**
 * T3 regression — #4080: the ai-review voters must not receive the generated
 * `ci-review-templates.ts` in their diff.
 *
 * That file is base64 of the CI templates; editing an early line of an embedded
 * template re-encodes nearly the whole file. On PR #4079 the diff reached ~1.22 MB
 * and every voter answered "Prompt is too long" (HTTP 400), failing closed to
 * `changes`. The generated file is a pure function of its sources, which are in
 * the diff themselves, so it carries no review signal.
 *
 * Drives the REAL scripts/review-branch.sh with --print-input (no reviewer runs).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/review-branch.sh');
const GENERATED = 'packages/minspec/src/lib/ci-review-templates.ts';

let workdir: string;
let base: string;
let head: string;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-branch-gen-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: workdir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@e',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@e',
      },
    });
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(workdir, path.dirname(GENERATED)), { recursive: true });
  fs.writeFileSync(path.join(workdir, GENERATED), 'GENERATED_OLD\n');
  fs.writeFileSync(path.join(workdir, 'normal.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(workdir, GENERATED), 'GENERATED_NEW_PAYLOAD\n');
  fs.writeFileSync(path.join(workdir, 'normal.txt'), 'one\nNORMAL_CHANGE\n');
  git('add', '-A');
  git('commit', '-qm', 'head');
  head = git('rev-parse', 'HEAD').trim();
});

afterAll(() => fs.rmSync(workdir, { recursive: true, force: true }));

function printInput(): string {
  const r = spawnSync('bash', [SCRIPT, base, head, '--role', 'reviewer', '--print-input'], {
    cwd: workdir,
    encoding: 'utf-8',
  });
  return r.stdout ?? '';
}

describe('#4080 review-branch.sh — voters never see the generated templates file', () => {
  it('keeps the normal file in the voter input', () => {
    const out = printInput();
    expect(out).toContain('NORMAL_CHANGE');
  });

  it('drops the generated ci-review-templates.ts from the voter input', () => {
    const out = printInput();
    expect(out).not.toContain('GENERATED_NEW_PAYLOAD');
    expect(out).not.toContain('ci-review-templates.ts');
  });
});
