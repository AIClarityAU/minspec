/**
 * T3 — REGRESSION: the scaffolded pre-commit gate must require frontmatter on a
 * decision record, not only on a spec.
 *
 * Observed in a real dogfooding project: `docs/decisions/` held three records, and
 * only DR-001 — the one created by *MinSpec: Create Architecture Decision Record* —
 * carried frontmatter. DR-002 and DR-003, written by hand, had none at all. Nothing
 * flagged it, so the register was two-thirds unreadable to any tool that parses it.
 *
 * The mechanism was a gate that validated only what MinSpec itself creates. The
 * shell gate's `case` matched `specs/*.md` and nothing else, and `validate.py`
 * contains no reference to the decisions directory — so a DR could be committed in
 * any shape. This is the recorded validator-asymmetry class, one artifact class over
 * from where it was last fixed: the tooling asserted the artifacts it wrote and
 * never asserted the class.
 *
 * These tests drive the REAL hook, spawning real git, so a gate that renders but
 * does not fire cannot pass.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { generateHarnessFiles } from '../src/lib/scaffold';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
}

/** A scaffolded repo with one DR staged, whose body is `content`. */
function repoWithDr(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-gate-'));
  git(dir, 'init', '-b', 'main');
  generateHarnessFiles(dir);
  // Commit the scaffold first, so the DR is the only thing under test.
  git(dir, 'add', '-A');
  spawnSync('git', ['commit', '-m', 'scaffold', '--no-verify'], {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
  });
  fs.mkdirSync(path.join(dir, 'docs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/decisions', name), content);
  git(dir, 'add', '-A');
  return dir;
}

function commit(dir: string): { code: number | null; out: string } {
  const r = spawnSync('git', ['commit', '-m', 'add decision'], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, ...GIT_ENV },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const WITH_FM = `---
id: DR-002
title: Raw capture before parse
status: accepted
date: 2026-08-15
---

# DR-002 — Raw capture before parse
`;

const WITHOUT_FM = `# DR-002 — Raw capture before parse

- **Status:** accepted
`;

describe('the scaffolded gate requires DR frontmatter', () => {
  it('BLOCKS a decision record with no frontmatter', () => {
    const dir = repoWithDr('DR-002-raw-capture.md', WITHOUT_FM);
    try {
      const r = commit(dir);
      expect(r.code, `the gate must refuse an unreadable DR:\n${r.out}`).not.toBe(0);
      expect(r.out).toContain('id: DR-NNN');
      expect(r.out, 'the refusal must name the offending file').toContain('DR-002-raw-capture.md');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ALLOWS a decision record that carries frontmatter', () => {
    // The other side of the gate. Without this a gate that refuses everything
    // would pass the test above and look correct.
    const dir = repoWithDr('DR-002-raw-capture.md', WITH_FM);
    try {
      const r = commit(dir);
      expect(r.code, `a well-formed DR must still commit:\n${r.out}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the branch tip unmoved when it refuses', () => {
    // A hook that prints a refusal but still writes the commit is the failure mode
    // a status-code assertion alone cannot see.
    const dir = repoWithDr('DR-003-thread-identity.md', WITHOUT_FM);
    try {
      const before = git(dir, 'rev-parse', 'HEAD').trim();
      commit(dir);
      expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores INDEX.md, which is a register listing and carries no id', () => {
    // Narrowness matters: the register's own index would otherwise be blocked
    // forever, and a gate that blocks correct work is one people switch off.
    const dir = repoWithDr('INDEX.md', '# Decision Register\n\n- DR-001\n');
    try {
      expect(commit(dir).code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
