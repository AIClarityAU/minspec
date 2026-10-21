/**
 * #1908 — the shell (awk) tier of the pre-commit gate must accept what the
 * Python tier accepts, and must validate the same class of file.
 *
 * DR-037's detection chain is Node -> python -> shell, highest-fidelity-
 * available wins. In this sandbox python3 IS present, so every OTHER suite
 * that drives the real hook via `git commit` (dr-frontmatter-gate.test.ts,
 * dr037-hook-scaffolds.test.ts) exercises the PYTHON tier, never the shell
 * (`awk`) fallback — the `command -v python3 && [ -f validate.py ]` check
 * short-circuits straight past it and the awk gate never runs.
 *
 * That left the shell twin untested end-to-end: `validate.py`'s parser could
 * be fixed while the `awk` pattern in `pre-commit` stayed broken, and nothing
 * would catch it — exactly the "a commit refused by one is accepted by the
 * other" risk the issue calls out. These tests force the shell tier with a
 * PATH built from a curated bin directory — symlinks to exactly the binaries
 * the hook needs (git, sh, awk, basename, grep), never python3 — so the SAME
 * `git commit` drives the actual `awk` gate, not a proxy for it.
 *
 * A naive "drop every PATH dir that resolves python3" was tried first and
 * rejected: in this container git/awk/basename/grep/python3 all live in the
 * SAME /usr/bin, so dropping python3's directory would have silently taken
 * git down with it too, and every test below would fail for the wrong reason
 * (git unresolvable) rather than prove anything about the awk gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
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

/** The binaries the shell (awk) tier + the git plumbing around it need. Deliberately excludes python3. */
const REQUIRED_BINARIES = ['git', 'sh', 'awk', 'basename', 'grep'];

function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here — keep looking
    }
  }
  return null;
}

/** A fresh directory containing ONLY symlinks to REQUIRED_BINARIES — no python3, ever. */
function buildShellTierBinDir(): string {
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tier-bin-'));
  for (const name of REQUIRED_BINARIES) {
    const real = findOnPath(name);
    if (!real) {
      throw new Error(`#1908 shell-tier fixture: required binary '${name}' not found on PATH`);
    }
    fs.symlinkSync(real, path.join(bindir, name));
  }
  return bindir;
}

let SHELL_TIER_PATH: string;

beforeAll(() => {
  SHELL_TIER_PATH = buildShellTierBinDir();
});

/**
 * The GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n pins
 * vitest.setup.ts puts on process.env to hold auto-maintenance off in every
 * fixture repo (#1532). shellTierEnv() below builds its env from scratch
 * rather than spreading process.env — the whole point is a PATH that cannot
 * resolve python3 — so without this, those pins never reach the git calls in
 * this file and a fixture repo's `git commit` can trigger a detached
 * maintenance process that still has `.git/objects` open when a later
 * `fs.rmSync` tries to remove it, surfacing as ENOTEMPTY (#2627).
 */
function gitConfigPinEnv(): NodeJS.ProcessEnv {
  const pins: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key) && value !== undefined) {
      pins[key] = value;
    }
  }
  return pins;
}

function shellTierEnv(): NodeJS.ProcessEnv {
  // Deliberately NOT spreading process.env.PATH: the whole point is a PATH
  // that cannot resolve python3 (or npx), even though both exist elsewhere on
  // the real one. HOME is kept so git can find global config if any. The
  // GIT_CONFIG_* pins ARE carried over (see gitConfigPinEnv) so fixture repos
  // here get the same auto-maintenance-off treatment as every other suite.
  return { ...GIT_ENV, ...gitConfigPinEnv(), PATH: SHELL_TIER_PATH, HOME: process.env.HOME };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: shellTierEnv() });
}

function repoIn(dir: string): void {
  git(dir, 'init', '-b', 'main');
  generateHarnessFiles(dir);
  git(dir, 'add', '-A');
  spawnSync('git', ['commit', '-m', 'scaffold', '--no-verify'], { cwd: dir, env: shellTierEnv() });
}

function writeAndStage(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(dir, 'add', '-A');
}

function commit(dir: string): { code: number | null; out: string } {
  const r = spawnSync('git', ['commit', '-m', 'add file'], {
    cwd: dir,
    encoding: 'utf-8',
    env: shellTierEnv(),
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function mkRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tier-'));
}

const DR_WITH_QUOTED_ID = `---
id: "DR-024"
title: Quoted id
status: accepted
date: 2026-08-15
---

# DR-024 — Quoted id
`;

const SPEC_WITH_QUOTED_ID = `---
id: "SPEC-001"
title: Quoted id
tier: T2
status: specifying
created: 2026-05-30
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-001
`;

describe('#1908 preconditions — the fixture actually forces the shell tier', () => {
  it('the curated PATH resolves git/sh/awk/basename/grep but never python3 or npx', () => {
    // `sh` gets its own check: dash's `sh` (this fixture's own interpreter)
    // does not understand `--version` and errors "Illegal option --", which is
    // about sh's flag parsing, not about whether it resolves on PATH — the
    // thing actually under test here.
    for (const name of REQUIRED_BINARIES) {
      const args = name === 'sh' ? ['-c', 'exit 0'] : ['--version'];
      expect(
        () => execFileSync(name, args, { env: shellTierEnv() }),
        `expected '${name}' to resolve on the shell-tier PATH`
      ).not.toThrow();
    }
    expect(() => execFileSync('python3', ['--version'], { env: shellTierEnv() })).toThrow();
    expect(() => execFileSync('npx', ['--version'], { env: shellTierEnv() })).toThrow();
    // Sanity: python3 DOES exist on the real, ambient PATH — otherwise this
    // whole file would be proving nothing (nothing to force a fallback FROM).
    expect(() => execFileSync('python3', ['--version'], { env: process.env })).not.toThrow();
  });

  it('#2627 carries the auto-maintenance-off pins into the curated env, inside a real fixture', () => {
    // Guards the fix for #2627: shellTierEnv() builds its env from scratch, so
    // the GIT_CONFIG_* pins vitest.setup.ts puts on process.env (#1532) do not
    // reach it for free — gitConfigPinEnv() must copy them over. Assert what
    // git actually resolves INSIDE a fixture this file creates, under the
    // exact env this file hands its own git calls, not a proxy for it.
    const dir = mkRepo();
    try {
      repoIn(dir);
      expect(
        execFileSync('git', ['config', '--get', 'maintenance.auto'], { cwd: dir, encoding: 'utf-8', env: shellTierEnv() }).trim()
      ).toBe('false');
      expect(
        execFileSync('git', ['config', '--get', 'gc.auto'], { cwd: dir, encoding: 'utf-8', env: shellTierEnv() }).trim()
      ).toBe('0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#1908 shell (awk) tier — quoted id acceptance', () => {
  it('ALLOWS a DR whose id is double-quoted (id: "DR-024")', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(dir, 'docs/decisions/DR-024-quoted.md', DR_WITH_QUOTED_ID);
      const r = commit(dir);
      expect(r.code, `quoted id must be accepted by the shell gate:\n${r.out}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ALLOWS a spec whose id is double-quoted (id: "SPEC-001")', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(dir, 'specs/SPEC-001-x.md', SPEC_WITH_QUOTED_ID);
      const r = commit(dir);
      expect(r.code, `quoted id must be accepted by the shell gate:\n${r.out}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still BLOCKS a DR with no id at all (quote handling did not just widen the match)', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(dir, 'docs/decisions/DR-025-noid.md', '# DR-025\n\nno frontmatter\n');
      const r = commit(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('id: DR-NNN');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#1908 shell (awk) tier — DR gate keyed on directory, not filename', () => {
  it('BLOCKS a decision record with no frontmatter that is NOT named DR-NNN.md', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(dir, 'docs/decisions/0024-thread-identity.md', '# thread identity\n\nno frontmatter\n');
      const r = commit(dir);
      expect(r.code, `a misnamed DR must still be gated:\n${r.out}`).not.toBe(0);
      expect(r.out).toContain('0024-thread-identity.md');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ALLOWS the same misnamed record once it carries id: DR-NNN frontmatter', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(
        dir,
        'docs/decisions/0024-thread-identity.md',
        '---\nid: DR-024\ntitle: Thread identity\nstatus: accepted\ndate: 2026-08-15\n---\n\n# DR-024\n'
      );
      const r = commit(dir);
      expect(r.code, `a well-formed misnamed DR must still commit:\n${r.out}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still ignores INDEX.md and README.md, which carry no id of their own', () => {
    const dir = mkRepo();
    try {
      repoIn(dir);
      writeAndStage(dir, 'docs/decisions/INDEX.md', '# Decision Register\n\n- DR-001\n');
      writeAndStage(dir, 'docs/decisions/README.md', '# How this directory works\n');
      const r = commit(dir);
      expect(r.code, `INDEX.md/README.md must stay exempt:\n${r.out}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
