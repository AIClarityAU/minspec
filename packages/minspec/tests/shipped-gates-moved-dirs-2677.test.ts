/**
 * #2677 — a shipped gate must give the same verdict when a project moves
 * `specsDir`, `decisionsDir` or `epicsDir`.
 *
 * ROOT CAUSE. The only test of a custom directory (`template-engine.test.ts`,
 * "uses custom config values") asserts that `specsDir` reaches the Markdown
 * templates. No test ran a SHIPPED GATE (the python validator, the pre-commit shell
 * tier) against a project that moved a directory, so those gates matching `specs/`
 * and `docs/decisions/` literally was invisible: a spec with no frontmatter exits 1
 * in the default layout and exits 0, silently, in a moved one.
 *
 * WHAT THIS PINS. Every `*Dir` key of DEFAULT_CONFIG is moved (derived from the
 * config itself, so a new key joins automatically), the same violation is planted,
 * and each shipped gate must give its default-layout verdict. A gate that cannot
 * is listed in KNOWN_FAILURES with its tracking issue, and the test asserts it
 * STILL fails, so fixing a gate forces its entry to be deleted.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DEFAULT_CONFIG } from '../src/lib/config';
import { generateHarnessFiles } from '../src/lib/scaffold';
import { MINSPEC_HOOKS_DIR } from '../src/lib/template-registry';
import { pathWithoutTools } from './helpers/path-without-tool';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const PRE_COMMIT = `${MINSPEC_HOOKS_DIR}/pre-commit`;
const VALIDATE_PY = `${MINSPEC_HOOKS_DIR}/validate.py`;

function python3Available(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
// Skipping on CI would make every python assertion vacuously green.
const HAS_PY = python3Available();
if (!HAS_PY && process.env.CI) {
  throw new Error('python3 is required in CI: the shipped validator under test is Python.');
}

type DirKey = 'specsDir' | 'decisionsDir' | 'epicsDir';
const DIR_KEYS = (Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>).filter(
  (k) => k.endsWith('Dir'),
) as DirKey[];

/** A violation: a file at a default location, planted at the configured one. */
interface Violation {
  name: string;
  dirKey: DirKey;
  file: string;
}
const VIOLATIONS: Violation[] = [
  { name: 'spec without frontmatter', dirKey: 'specsDir', file: 'SPEC-001.md' },
  { name: 'decision record without frontmatter', dirKey: 'decisionsDir', file: 'DR-001.md' },
];

type Gate = 'validate.py full scan' | 'validate.py --pre-commit' | 'pre-commit, python tier' | 'pre-commit, shell tier';
const GATES: Gate[] = [
  'validate.py full scan',
  'validate.py --pre-commit',
  'pre-commit, python tier',
  'pre-commit, shell tier',
];

/** Known failures: `${gate} | ${violation}` -> tracking issue. Each is asserted to still fail. */
const KNOWN_FAILURES: Record<string, string> = {};
for (const g of GATES) {
  for (const v of VIOLATIONS) {
    KNOWN_FAILURES[`${g} | ${v.name}`] = '#2684';
  }
}

let repo: string;
let scratch: string;

function git(...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: repo,
    stdio: 'ignore',
  });
}

function setup(moved: boolean): void {
  git('init', '-q');
  generateHarnessFiles(repo);
  const dirs: Record<string, string> = {};
  for (const k of DIR_KEYS) dirs[k] = moved ? `moved/${k}` : (DEFAULT_CONFIG[k] as string);
  fs.mkdirSync(path.join(repo, '.minspec'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.minspec', 'config.json'),
    JSON.stringify({ ...DEFAULT_CONFIG, ...dirs, ownershipDeclaration: 'error' }, null, 2),
  );
  git('add', '-A');
}

function plant(v: Violation, moved: boolean): string {
  const dir = moved ? `moved/${v.dirKey}` : (DEFAULT_CONFIG[v.dirKey] as string);
  const rel = `${dir}/${v.file}`;
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), '# No frontmatter at all\n\nBody.\n');
  git('add', '--', rel);
  return rel;
}

/** Exit code of one gate. Stderr is returned for diagnostics. */
function run(gate: Gate): { code: number; stderr: string } {
  const hook = path.join(repo, PRE_COMMIT);
  const env = { ...process.env, PATH: process.env.PATH ?? '' };
  let r;
  if (gate === 'validate.py full scan') {
    r = spawnSync('python3', [path.join(repo, VALIDATE_PY)], { cwd: repo, encoding: 'utf-8' });
  } else if (gate === 'validate.py --pre-commit') {
    r = spawnSync('python3', [path.join(repo, VALIDATE_PY), '--pre-commit'], {
      cwd: repo,
      encoding: 'utf-8',
    });
  } else {
    const p =
      gate === 'pre-commit, shell tier'
        ? pathWithoutTools(['python3', 'python', 'py'], env.PATH, scratch)
        : env.PATH;
    r = spawnSync('sh', [hook], { cwd: repo, encoding: 'utf-8', env: { ...env, PATH: p } });
  }
  if (r.error) throw r.error;
  if (r.status === null) throw new Error(`${gate} killed by ${r.signal}`);
  return { code: r.status, stderr: r.stderr };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-2677-repo-'));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-2677-path-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('#2677 shipped gates under moved specsDir/decisionsDir/epicsDir', { timeout: 60_000 }, () => {
  it('moves every *Dir key of DEFAULT_CONFIG (derived, not hardcoded)', () => {
    expect(DIR_KEYS).toEqual(expect.arrayContaining(['specsDir', 'decisionsDir', 'epicsDir']));
  });

  for (const gate of GATES) {
    for (const v of VIOLATIONS) {
      const key = `${gate} | ${v.name}`;
      const known = KNOWN_FAILURES[key];

      it.skipIf(!HAS_PY)(`default layout: ${key} refuses (exit 1)`, () => {
        setup(false);
        const rel = plant(v, false);
        const r = run(gate);
        expect(r.code, r.stderr).toBe(1);
        // Refused for the planted file, not for an unrelated stage of the hook.
        expect(r.stderr).toContain(rel);
      });

      it.skipIf(!HAS_PY)(
        known
          ? `moved layout: ${key} gives the default verdict — KNOWN FAILURE ${known}, must still fail`
          : `moved layout: ${key} gives the default verdict (exit 1)`,
        () => {
          setup(true);
          plant(v, true);
          const r = run(gate);
          if (known) {
            // Still wrong. When this starts failing the gate was fixed: delete the entry.
            expect(r.code, `${known} is fixed for "${key}"; remove it from KNOWN_FAILURES`).toBe(0);
          } else {
            expect(r.code, r.stderr).toBe(1);
          }
        },
      );
    }
  }
});
