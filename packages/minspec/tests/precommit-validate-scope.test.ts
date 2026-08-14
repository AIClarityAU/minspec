/**
 * T3 — the pre-commit validate gate blames only what the commit INTRODUCES (#1471).
 *
 * The validator scans the whole corpus, so while main is red for any reason every
 * docs/spec commit was blocked — and misattributed, handing you a filename you
 * never opened. On 2026-08-12 a two-line DR status flip was blocked by SPEC-055/057
 * missing `implements:`, with the gate's text pointing at DR-index drift instead.
 *
 * WHY THIS TEST EXISTS AT ALL, beyond the behaviour:
 * the first version of the fix was silently INERT. The hook runs under
 * `set -o pipefail`, so piping the (expectedly failing) baseline validator into
 * grep propagated its non-zero, the baseline was treated as unobtainable, and the
 * gate fell back to fail-closed on every red corpus — the exact case it exists to
 * handle. It looked correct in review and blocked exactly as before. Only running
 * it revealed that. So this drives the real hook, in a real git repo, with a
 * stubbed validator, and asserts the three outcomes that distinguish a working
 * fix from an inert one.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: every case spawns real git + node child processes, so the 5s default is
// a load metric rather than a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const HOOK = path.resolve(__dirname, '../../../.githooks/pre-commit');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } }).trim();
}

/**
 * A repo whose `npm run validate` is a stub: it prints one `FAIL <path>` line per
 * spec file containing the token BROKEN, then the validator's real summary line
 * (which the hook uses as its "did it actually run" witness).
 */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-scope-'));
  fs.mkdirSync(path.join(dir, 'specs', 'minspec'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });

  // The hook checks for this path before trusting a baseline.
  fs.writeFileSync(path.join(dir, 'scripts', 'validate-frontmatter.ts'), '// stub\n');
  fs.writeFileSync(
    path.join(dir, 'fake-validate.js'),
    `const fs = require('fs'), path = require('path');
     const d = path.join(process.cwd(), 'specs', 'minspec');
     let n = 0;
     for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
       if (fs.readFileSync(path.join(d, f), 'utf-8').includes('BROKEN')) {
         console.log('FAIL specs/minspec/' + f + ': broken'); n++;
       }
     }
     if (n) { console.log(n + ' validation error(s). Fix before committing.'); process.exit(1); }
     console.log('Frontmatter validation passed.');\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'scope-fixture', scripts: { validate: 'node fake-validate.js' } }),
  );
  fs.copyFileSync(HOOK, path.join(dir, '.githooks', 'pre-commit'));
  fs.chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);

  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'core.hooksPath', '.githooks');
  // A DR file, because the gate only arms on docs/spec paths.
  fs.writeFileSync(path.join(dir, 'docs', 'decisions', 'DR-001.md'), 'ok\n');
  fs.writeFileSync(path.join(dir, 'specs', 'minspec', 'a.md'), 'fine\n');
  git(dir, 'add', '.');
  // --no-verify: the fixture's SETUP must not run the hook. The hook carries other
  // gates (secret scan, spec-gate, …) that have nothing to do with this test and
  // no meaning in a synthetic repo. Only the commits UNDER TEST are verified.
  git(dir, 'commit', '-m', 'base', '--no-verify');
  return dir;
}

/** Attempt a commit; return the hook's combined output and whether it landed. */
function tryCommit(dir: string, msg: string): { ok: boolean; out: string } {
  const r = spawnSync('git', ['commit', '-m', msg], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV },
  });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

describe('pre-commit validate gate: pre-existing vs introduced (#1471)', () => {
  it('a clean commit on a green corpus passes', () => {
    const dir = makeRepo();
    try {
      fs.appendFileSync(path.join(dir, 'docs', 'decisions', 'DR-001.md'), 'more\n');
      git(dir, 'add', '.');
      const { ok, out } = tryCommit(dir, 'docs: harmless');
      expect(ok, out).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('an UNRELATED commit is ALLOWED when the corpus was already red at HEAD', () => {
    const dir = makeRepo();
    try {
      // Someone else breaks the corpus and it is already on HEAD.
      fs.writeFileSync(path.join(dir, 'specs', 'minspec', 'b.md'), 'BROKEN\n');
      git(dir, 'add', '.');
      execFileSync('git', ['commit', '-m', 'break', '--no-verify'], {
        cwd: dir, env: { ...process.env, ...GIT_ENV },
      });

      // Now an unrelated docs edit. It introduces nothing.
      fs.appendFileSync(path.join(dir, 'docs', 'decisions', 'DR-001.md'), 'unrelated\n');
      git(dir, 'add', '.');
      const { ok, out } = tryCommit(dir, 'docs: unrelated');
      expect(ok, `must not blame this commit for HEAD's breakage:\n${out}`).toBe(true);
      expect(out).toMatch(/NONE of it was introduced by this commit/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a commit that INTRODUCES a violation is blocked, and only its own is named', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'specs', 'minspec', 'preexisting.md'), 'BROKEN\n');
      git(dir, 'add', '.');
      execFileSync('git', ['commit', '-m', 'break', '--no-verify'], {
        cwd: dir, env: { ...process.env, ...GIT_ENV },
      });

      fs.writeFileSync(path.join(dir, 'specs', 'minspec', 'mine.md'), 'BROKEN\n');
      git(dir, 'add', '.');
      const { ok, out } = tryCommit(dir, 'spec: my own breakage');
      expect(ok, 'an introduced violation must still block').toBe(false);

      // The "INTRODUCES" list must name mine and NOT the pre-existing one —
      // that precision is the whole point; a list of both is the old behaviour.
      const introduced = out.slice(out.indexOf('INTRODUCES'));
      expect(introduced).toMatch(/mine\.md/);
      expect(introduced).not.toMatch(/preexisting\.md/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails CLOSED when the LIVE validator crashes without reporting a result', () => {
    // #1483 review: the witness existed on the baseline path but not the live one.
    // A validator that exits non-zero with no FAIL lines and no summary — a crash,
    // a broken dep, a syntax error introduced by THIS commit — yielded an empty
    // now_fails, hence an empty `introduced`, hence "nothing introduced, allowed".
    // That is strictly worse than the behaviour it replaced, which blocked.
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'fake-validate.js'), 'process.exit(3);\n');
      fs.appendFileSync(path.join(dir, 'docs', 'decisions', 'DR-001.md'), 'x\n');
      git(dir, 'add', '.');
      const { ok, out } = tryCommit(dir, 'docs: while the validator is broken');
      expect(ok, `a crashed validator must not read as "nothing introduced":\n${out}`).toBe(false);
      expect(out).toMatch(/exited non-zero without reporting a result/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails CLOSED when the baseline validator cannot run', () => {
    const dir = makeRepo();
    try {
      fs.writeFileSync(path.join(dir, 'specs', 'minspec', 'b.md'), 'BROKEN\n');
      git(dir, 'add', '.');
      execFileSync('git', ['commit', '-m', 'break', '--no-verify'], {
        cwd: dir, env: { ...process.env, ...GIT_ENV },
      });

      // Remove the file the baseline probes for, so HEAD's tree cannot be validated.
      // An unobtainable baseline must NOT be read as "clean" — that would mark every
      // pre-existing failure as introduced, or worse, wave a real one through.
      git(dir, 'rm', '-q', 'scripts/validate-frontmatter.ts');
      execFileSync('git', ['commit', '-m', 'drop validator', '--no-verify'], {
        cwd: dir, env: { ...process.env, ...GIT_ENV },
      });

      fs.appendFileSync(path.join(dir, 'docs', 'decisions', 'DR-001.md'), 'x\n');
      git(dir, 'add', '.');
      const { ok, out } = tryCommit(dir, 'docs: unrelated');
      expect(ok, 'no baseline ⇒ must not silently allow').toBe(false);
      expect(out).toMatch(/could not build the HEAD baseline/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
