/**
 * #2068 — `check-primaries-clean.sh` classified a dirty path as ORPHAN ("real
 * unlanded work. Someone must land it.") whenever it differed from
 * `origin/<default>`, even when the SAME bytes were already committed and
 * pushed to a feature branch sitting in an open pull request. That report
 * told a reader on a shared checkout to go land work that was already landed
 * — acting on it produces a duplicate branch/PR of something already in
 * review (measured 2026-09-23 against SPEC-070's design.md / PR #2058).
 *
 * These tests drive the REAL script against REAL temp git repos (same
 * pattern as drain-selfheal.test.ts) — a test that re-implements the
 * classification rule in TypeScript would only prove agreement with itself.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-primaries-clean.sh');
// The script as it existed before #2068 (two-outcome REDUNDANT/ORPHAN classifier,
// comparing only against origin/<default>) — a byte-for-byte snapshot taken from
// this repo's HEAD before the fix landed, kept as a fixture so the regression
// proof below doesn't depend on git history/commit position.
const BASE_SCRIPT = path.resolve(__dirname, 'fixtures/check-primaries-clean.pre-2068.sh');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

/**
 * Build a throwaway CODE_ROOT/myrepo checkout wired to a real bare origin,
 * with the script under test committed into myrepo/scripts/ from the FIRST
 * commit — not copied in afterwards as an untracked file. `git status
 * --porcelain` (no `-uall`) collapses a wholly-new, wholly-untracked
 * directory into a single directory-path entry rather than recursing into
 * it (the exact shape of the sibling bug #1650). Copying the script (and any
 * other fixture dir) in as untracked content after the seed commit would
 * make THIS test's own setup collide with the classifier it exercises —
 * `scripts/` (and any new `specs/`) would show up as spurious ORPHAN
 * directory entries instead of the specific file paths under test. Seeding
 * both dirs into the tracked, pushed commit keeps the working tree fully
 * clean before each scenario adds its own single dirty path.
 *
 * The script's own BASH_SOURCE-relative resolution (SELF_ROOT = this
 * checkout, CODE_ROOT = its parent) lands on this temp tree, not the real
 * monorepo. The script's other listed repo (CODE_ROOT/sealbox) is left
 * absent on purpose — it reports SKIP and is not under test here.
 */
function setupPrimary(root: string): { origin: string; primary: string } {
  const origin = path.join(root, 'origin.git');
  const primary = path.join(root, 'myrepo');
  fs.mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'clone', origin, primary);

  fs.writeFileSync(path.join(primary, 'README.md'), 'seed\n');
  fs.mkdirSync(path.join(primary, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(primary, 'scripts', 'check-primaries-clean.sh'));
  fs.mkdirSync(path.join(primary, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(primary, 'specs', '.gitkeep'), '');

  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'seed');
  git(primary, 'push', 'origin', 'main');
  return { origin, primary };
}

function run(primary: string): { status: number | null; out: string } {
  const r = spawnSync('bash', [path.join(primary, 'scripts', 'check-primaries-clean.sh')], {
    encoding: 'utf-8',
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Push `content` at `relPath` to a new branch off `origin`, never merged to main. */
function pushToFeatureBranch(root: string, origin: string, branch: string, relPath: string, content: string): void {
  const other = path.join(root, `other-${branch.replace(/\W+/g, '-')}`);
  git(root, 'clone', origin, other);
  git(other, 'checkout', '-b', branch);
  fs.mkdirSync(path.dirname(path.join(other, relPath)), { recursive: true });
  fs.writeFileSync(path.join(other, relPath), content);
  git(other, 'add', '.');
  git(other, 'commit', '-m', `add ${relPath}`);
  git(other, 'push', 'origin', branch);
}

describe('check-primaries-clean.sh: LANDED-ON-BRANCH vs ORPHAN (#2068)', () => {
  it('a dirty path already pushed to a FEATURE branch is LANDED-ON-BRANCH, not ORPHAN', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-primaries-'));
    try {
      const { origin, primary } = setupPrimary(root);

      // A second clone pushes design.md to a feature branch — never merged to
      // main — simulating PR #2058 in the issue's measured repro.
      pushToFeatureBranch(root, origin, 'docs/spec-070-design', 'specs/design.md', 'landed content\n');
      // The primary fetches (same as "the last drain fetch" the script's own
      // comments describe), so refs/remotes/origin/docs/spec-070-design
      // exists locally without this script ever fetching itself.
      git(primary, 'fetch', 'origin');

      // The SAME bytes sit UNTRACKED in the primary's working tree — exactly
      // the shape from the issue: committed+pushed elsewhere, but dirty here.
      // `specs/` was already committed in the seed, so this shows up as an
      // individual untracked FILE, not a collapsed new-directory entry.
      fs.writeFileSync(path.join(primary, 'specs', 'design.md'), 'landed content\n');

      const { out } = run(primary);

      expect(out).toContain('LANDED-ON-BRANCH  specs/design.md');
      expect(out).toContain('origin/docs/spec-070-design');
      // The defect: this must never read ORPHAN once it's proven landed elsewhere.
      expect(out).not.toMatch(/ORPHAN\s+specs\/design\.md/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('BASE (pre-fix) regression proof: the unfixed classifier reports this case ORPHAN', () => {
    // Runs the SAME repro against the script as it existed before #2068 — the
    // two-outcome (REDUNDANT/ORPHAN) classifier that compared only against
    // origin/<default>. Proves the test is a real regression test, not a
    // vacuous pass: red against base, green against head (see the sibling
    // case above, which is identical apart from which script runs).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-primaries-base-'));
    try {
      const { origin, primary } = setupPrimary(root);

      pushToFeatureBranch(root, origin, 'docs/spec-070-design', 'specs/design.md', 'landed content\n');
      git(primary, 'fetch', 'origin');
      fs.writeFileSync(path.join(primary, 'specs', 'design.md'), 'landed content\n');

      // Swap in the pre-#2068 script (overwrites the tracked copy on disk —
      // the classifier reads whatever bytes are on disk when it runs, so this
      // does not need its own commit).
      fs.copyFileSync(BASE_SCRIPT, path.join(primary, 'scripts', 'check-primaries-clean.sh'));

      const { out } = run(primary);

      expect(out).toMatch(/ORPHAN\s+specs\/design\.md/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('content matching origin/<default> AT THE SAME PATH is still REDUNDANT (unchanged behaviour)', () => {
    // The classic case this script exists for: a MinSpec extension command
    // writes a file straight to the open workspace folder (untracked), and
    // the SAME path/content later lands on main via a different clone/PR —
    // exactly the "7 of 8 dirty paths were pre-merge copies of already-merged
    // PRs" audit in the header comment. REDUNDANT compares the SAME repo
    // path, not just matching bytes under any name (#2068 only widens the
    // "differs from origin/<default>" arm, not this one).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-primaries-redundant-'));
    try {
      const { origin, primary } = setupPrimary(root);

      // A different clone lands specs/decision.md directly on main.
      const lander = path.join(root, 'lander');
      git(root, 'clone', origin, lander);
      fs.writeFileSync(path.join(lander, 'specs', 'decision.md'), 'decision content\n');
      git(lander, 'add', '.');
      git(lander, 'commit', '-m', 'land decision');
      git(lander, 'push', 'origin', 'main');
      git(primary, 'fetch', 'origin');

      // The primary never pulled that commit — it has the SAME bytes at the
      // SAME path, but UNTRACKED (the extension-writes-to-disk shape).
      fs.writeFileSync(path.join(primary, 'specs', 'decision.md'), 'decision content\n');

      const { out } = run(primary);
      expect(out).toContain('REDUNDANT  specs/decision.md');
      expect(out).not.toContain('LANDED-ON-BRANCH  specs/decision.md');
      expect(out).not.toMatch(/ORPHAN\s+specs\/decision\.md/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('content matching NO ref anywhere is still ORPHAN (widening did not over-suppress)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-primaries-orphan-'));
    try {
      const { origin, primary } = setupPrimary(root);

      // A pushed branch exists, but with UNRELATED content — the orphan path's
      // bytes appear nowhere on the remote.
      pushToFeatureBranch(root, origin, 'docs/unrelated', 'unrelated.md', 'unrelated content\n');
      git(primary, 'fetch', 'origin');

      fs.writeFileSync(path.join(primary, 'orphan.md'), `real unlanded work ${Date.now()}\n`);

      const { out, status } = run(primary);
      expect(out).toMatch(/ORPHAN\s+orphan\.md/);
      expect(out).not.toContain('LANDED-ON-BRANCH  orphan.md');
      expect(status).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
