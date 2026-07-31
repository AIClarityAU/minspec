import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ensureGitignoreEntries,
  untrackDeclaredMachineLocalPaths,
  generateHarnessFiles,
  refreshHarnessFiles,
  MINSPEC_GITIGNORE_ENTRIES,
} from '../src/lib/scaffold';

/**
 * T3 regression: declaring a path machine-local must actually make it machine-local.
 *
 * Writing an entry into `.gitignore` does NOT ignore a file git already tracks. Every
 * MinSpec-scaffolded repo hit this the same way — scaffolded, files committed, ignore
 * entries added later, so the rules landed on already-tracked paths and were inert
 * from the moment they were written. The extension rewrites those files on every
 * refresh, they show as modified forever, and they get swept into commits.
 *
 * Diagnosed after the same symptom was hand-cleaned in three separate repos without
 * anyone fixing what re-created it (#1103 untracked minspec's copy,
 * AIClarityAU/sealbox#33 sealbox's; scroogellm's was still tracked). The instance kept
 * getting fixed; the mechanism did not.
 *
 * These drive REAL git in temp repos — the whole defect is about index state, which a
 * mock cannot model.
 */

const made: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tracked(cwd: string): string[] {
  return git(cwd, 'ls-files').split('\n').filter(Boolean);
}

/** A repo in the exact broken state: the file is tracked AND listed in .gitignore. */
function makeRepo({ commitFirst = true }: { commitFirst?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-untrack-'));
  made.push(dir);
  git(dir, 'init', '--initial-branch', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.minspec/generated-hashes.json'), '{}\n');
  fs.writeFileSync(path.join(dir, '.minspec/preferences.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  if (commitFirst) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'seed');
  }
  return dir;
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe('untrackDeclaredMachineLocalPaths', () => {
  it('reproduces the real precondition (anti-vacuity)', () => {
    const dir = makeRepo();
    // The bug only exists because these ARE tracked. If the fixture failed to
    // commit them, every assertion below would pass without testing anything.
    expect(tracked(dir)).toContain('.minspec/generated-hashes.json');
    expect(tracked(dir)).toContain('.minspec/preferences.json');
    // And git genuinely refuses to ignore them once tracked — the premise.
    fs.writeFileSync(path.join(dir, '.gitignore'), '.minspec/generated-hashes.json\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-m', 'ignore');
    fs.writeFileSync(path.join(dir, '.minspec/generated-hashes.json'), '{"changed":1}\n');
    expect(git(dir, 'status', '--short')).toMatch(/generated-hashes\.json/);
  });

  it('untracks a declared path that git is tracking, and leaves it on disk', () => {
    const dir = makeRepo();
    const removed = untrackDeclaredMachineLocalPaths(dir);

    expect(removed).toContain('.minspec/generated-hashes.json');
    expect(removed).toContain('.minspec/preferences.json');
    expect(tracked(dir)).not.toContain('.minspec/generated-hashes.json');
    expect(tracked(dir)).not.toContain('.minspec/preferences.json');
    // Machine-local means "not in git", NOT "deleted" — the extension still needs it.
    expect(fs.existsSync(path.join(dir, '.minspec/generated-hashes.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.minspec/preferences.json'))).toBe(true);
  });

  it('leaves files it does not declare alone', () => {
    const dir = makeRepo();
    untrackDeclaredMachineLocalPaths(dir);
    expect(tracked(dir)).toContain('README.md');
  });

  it('is idempotent — a second run reports nothing and changes nothing', () => {
    const dir = makeRepo();
    expect(untrackDeclaredMachineLocalPaths(dir).length).toBeGreaterThan(0);
    expect(untrackDeclaredMachineLocalPaths(dir)).toEqual([]);
  });

  it('is a no-op in a repo where nothing declared is tracked', () => {
    const dir = makeRepo({ commitFirst: false });
    expect(untrackDeclaredMachineLocalPaths(dir)).toEqual([]);
  });

  it('does not throw outside a git repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-nogit-'));
    made.push(dir);
    expect(() => untrackDeclaredMachineLocalPaths(dir)).not.toThrow();
    expect(untrackDeclaredMachineLocalPaths(dir)).toEqual([]);
  });

  it('the ignore rule actually takes effect afterwards (the point of all this)', () => {
    const dir = makeRepo();
    // The FULL declared list, as a real scaffolded repo has — otherwise the other
    // untracked-but-unignored file shows as `??` and the assertion fails for a
    // reason that has nothing to do with the fix.
    fs.writeFileSync(path.join(dir, '.gitignore'), `${MINSPEC_GITIGNORE_ENTRIES.join('\n')}\n`);
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-m', 'ignore');

    untrackDeclaredMachineLocalPaths(dir);
    git(dir, 'commit', '-am', 'untrack');

    // Rewrite it the way a refresh would. Before the fix this showed as modified
    // forever; now the pre-existing rule finally applies and status is clean.
    fs.writeFileSync(path.join(dir, '.minspec/generated-hashes.json'), '{"rewritten":1}\n');
    expect(git(dir, 'status', '--short')).toBe('');
  });
});

describe('the untrack is REPORTED, never silent', () => {
  /**
   * The #1146 blocking finding, from three of four voters: the first revision called
   * `untrackDeclaredMachineLocalPaths` and DISCARDED its return, so a `git rm --cached`
   * ran invisibly during auto-refresh-on-open — the exact G-8 / never-wrong invisible
   * git action the function's own docstring claimed to prevent. The docstring said
   * "returns what it actually untracked so the caller can SAY so"; no caller said so.
   */
  it('ensureGitignoreEntries returns what it untracked', () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), `${MINSPEC_GITIGNORE_ENTRIES.join('\n')}\n`);
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-m', 'ignore');

    const reported = ensureGitignoreEntries(dir);
    expect(reported).toContain('.minspec/generated-hashes.json');
    expect(reported).toContain('.minspec/preferences.json');
  });

  it('refreshHarnessFiles surfaces each untracked path as an `untracked` notice', () => {
    const dir = makeRepo();
    // A real harness so refresh runs end-to-end rather than bailing early.
    generateHarnessFiles(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'scaffold');
    // Re-track a declared machine-local file, i.e. the broken state in the wild.
    fs.writeFileSync(path.join(dir, '.minspec/generated-hashes.json'), '{}\n');
    git(dir, 'add', '-f', '.minspec/generated-hashes.json');
    git(dir, 'commit', '-m', 're-track');
    expect(tracked(dir)).toContain('.minspec/generated-hashes.json');

    const warnings = refreshHarnessFiles(dir);

    const notice = warnings.find((w) => w.outputPath === '.minspec/generated-hashes.json');
    expect(notice, 'the untrack must reach the caller').toBeDefined();
    expect(notice!.kind).toBe('untracked');
    // The message has to say what happened to git AND that the file survives —
    // a user seeing a deletion in Source Control needs both facts.
    expect(notice!.message).toMatch(/removed from the index/);
    expect(notice!.message).toMatch(/untouched on disk/);
    expect(notice!.message).toMatch(/git add/);
    // And it must not masquerade as a marker warning, whose surface offers
    // "Re-scaffold" — meaningless here.
    expect(notice!.kind).not.toBe('missing-markers');
  });

  it('generateHarnessFiles returns the untracked paths too (the INIT path)', () => {
    // The second round of #1146 review: the first fix threaded the refresh path
    // and left this one discarding. initCommand is re-runnable and NOT gated on
    // first-init, so Initialize on an already-broken repo — exactly the population
    // this reconcile targets — reaches here and mutates the index.
    const dir = makeRepo();
    expect(tracked(dir)).toContain('.minspec/generated-hashes.json');

    const untracked = generateHarnessFiles(dir);

    expect(untracked).toContain('.minspec/generated-hashes.json');
    expect(untracked).toContain('.minspec/preferences.json');
    expect(tracked(dir)).not.toContain('.minspec/generated-hashes.json');
    // Still on disk — generate rewrites it immediately afterwards.
    expect(fs.existsSync(path.join(dir, '.minspec/generated-hashes.json'))).toBe(true);
  });

  it('generateHarnessFiles returns [] when nothing was tracked', () => {
    const dir = makeRepo({ commitFirst: false });
    expect(generateHarnessFiles(dir)).toEqual([]);
  });

  it('reports nothing when there was nothing to untrack', () => {
    const dir = makeRepo({ commitFirst: false });
    generateHarnessFiles(dir);
    const warnings = refreshHarnessFiles(dir);
    expect(warnings.filter((w) => w.kind === 'untracked')).toEqual([]);
  });
});

describe('ensureGitignoreEntries reconciles even when the entries are all present', () => {
  it('untracks despite the all-entries-present early return', () => {
    // THE case that made this survive four hand-fixes: a repo whose .gitignore is
    // already complete and correct-looking. ensureGitignoreEntries returns early
    // there, so a reconcile placed after that return would skip exactly the repos
    // that need it.
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), `${MINSPEC_GITIGNORE_ENTRIES.join('\n')}\n`);
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-m', 'full ignore list');

    expect(tracked(dir)).toContain('.minspec/generated-hashes.json');
    ensureGitignoreEntries(dir);
    expect(tracked(dir)).not.toContain('.minspec/generated-hashes.json');
  });
});
