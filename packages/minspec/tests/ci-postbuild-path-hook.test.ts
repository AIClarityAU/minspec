// Regression test for #3563: the e2e job's "Compile e2e tests" step runs a bare
// `tsc`, and ubuntu-26.04 runners ship no global TypeScript, so it exited 127
// on every run. The real fix edits .github/workflows/ci.yml (founder-only, the
// App token has no `workflows` permission). Until that lands, the `postbuild`
// npm hook appends the repo's node_modules/.bin directories to the file named
// by $GITHUB_PATH, which GitHub Actions adds to PATH for every LATER step of the
// same job. With GITHUB_PATH unset or empty the hook must do nothing at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const pkgDir = path.resolve(__dirname, '..');

function runPostbuild(env: NodeJS.ProcessEnv) {
  return spawnSync('npm', ['run', '--silent', 'postbuild'], {
    cwd: pkgDir,
    env,
    encoding: 'utf8',
  });
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GITHUB_PATH;
  return env;
}

describe('postbuild hook puts repo tools on PATH for later CI steps (#3563)', () => {
  let tmp: string;
  let ghPath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-path-hook-'));
    ghPath = path.join(tmp, 'github_path');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('appends absolute .bin directories, at least one containing tsc, when GITHUB_PATH is set', () => {
    fs.writeFileSync(ghPath, '/pre/existing\n');
    const r = runPostbuild({ ...baseEnv(), GITHUB_PATH: ghPath });
    expect(r.status, r.stderr).toBe(0);

    const lines = fs.readFileSync(ghPath, 'utf8').split('\n').filter(Boolean);
    expect(lines[0]).toBe('/pre/existing'); // appends, never truncates
    const added = lines.slice(1);
    expect(added.length).toBeGreaterThan(0);
    for (const dir of added) {
      expect(path.isAbsolute(dir)).toBe(true);
      expect(path.basename(dir)).toBe('.bin');
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
    expect(added.some((d) => fs.existsSync(path.join(d, 'tsc')))).toBe(true);
  });

  it('writes nothing when GITHUB_PATH is unset', () => {
    const r = runPostbuild(baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('writes nothing when GITHUB_PATH is empty', () => {
    const r = runPostbuild({ ...baseEnv(), GITHUB_PATH: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
