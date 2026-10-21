/**
 * #2630 — the shipped `validate.py` must FAIL, not silently skip, on a spec file it
 * cannot read.
 *
 * WHY THIS EXISTS. Both readers in the VALIDATE_PY template — the full-corpus `reader`
 * (walks `specs/`, `docs/decisions/`, `docs/domain/`) and the pre-commit `staged_content`
 * (reads the staged git blob) — caught every exception and returned `None`. The main loop's
 * only response to `None` was `continue`: a spec that would otherwise FAIL validation
 * stopped failing the moment it became unreadable (a stray non-UTF-8 byte, a permission
 * error). `staged_files` had the identical shape one layer up: any `git diff --cached`
 * failure returned `[]`, which pre-commit read as "nothing staged" rather than "could not
 * determine what's staged" — so a git failure validated zero files and still exited 0.
 * Both are a direct violation of the constitution's invariant 2: an errored witness must
 * fail the gate closed and visibly, never silently pass or stop evaluating.
 *
 * This suite proves the fix in both modes: a file that cannot be decoded or opened now
 * produces a `FAIL <path>: unreadable (<reason>)` line and a non-zero exit, and a top-level
 * git failure in pre-commit mode produces its own FAIL line and a non-zero exit — with a
 * clean-corpus control in each mode proving the new code path isn't just failing everything.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const VALIDATE_PY_PATH = '.minspec/hooks/validate.py';
const VALIDATE_PY_SOURCE = renderManagedFile(
  MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === VALIDATE_PY_PATH)!,
);

function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-py-unreadable-'));
  fs.writeFileSync(path.join(dir, 'validate.py'), VALIDATE_PY_SOURCE);
  return dir;
}

function git(repo: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 'T');
}

function runValidatePy(repo: string, args: string[] = []): { code: number; err: string } {
  const r = spawnSync('python3', [path.join(repo, 'validate.py'), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

describe('#2630 — full-corpus mode fails closed on an unreadable spec', () => {
  it('control: a readable spec with broken frontmatter FAILs on the frontmatter, not on readability', () => {
    const repo = mkRepo();
    try {
      initRepo(repo);
      fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'specs', 'SPEC-001-probe.md'), '# no frontmatter\nbody\n');
      const { code, err } = runValidatePy(repo);
      expect(code).not.toBe(0);
      expect(err).toMatch(/FAIL specs\/SPEC-001-probe\.md: missing `id: SPEC-NNN` frontmatter/);
      expect(err).not.toMatch(/unreadable/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('control: a clean spec corpus exits zero', () => {
    const repo = mkRepo();
    try {
      initRepo(repo);
      fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, 'specs', 'SPEC-001-probe.md'),
        '---\nid: SPEC-001\ntier: T1\n---\n# Demo\nbody\n',
      );
      const { code } = runValidatePy(repo);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a spec file with a non-UTF-8 byte FAILs loudly instead of exiting zero', () => {
    const repo = mkRepo();
    try {
      initRepo(repo);
      fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
      // Two bytes that are not valid UTF-8 — exactly the #2630 repro.
      fs.writeFileSync(
        path.join(repo, 'specs', 'SPEC-001-probe.md'),
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# no frontmatter\nbody\n', 'utf8')]),
      );
      const { code, err } = runValidatePy(repo);
      expect(code).not.toBe(0);
      expect(err).toMatch(/FAIL specs\/SPEC-001-probe\.md: unreadable \(/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'a spec file with mode 000 FAILs loudly instead of exiting zero',
    () => {
      const repo = mkRepo();
      const specPath = path.join(repo, 'specs', 'SPEC-001-probe.md');
      try {
        initRepo(repo);
        fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
        fs.writeFileSync(specPath, '# no frontmatter\nbody\n');
        fs.chmodSync(specPath, 0o000);
        const { code, err } = runValidatePy(repo);
        expect(code).not.toBe(0);
        expect(err).toMatch(/FAIL specs\/SPEC-001-probe\.md: unreadable \(/);
      } finally {
        fs.chmodSync(specPath, 0o644);
        fs.rmSync(repo, { recursive: true, force: true });
      }
    },
  );
});

describe('#2630 — pre-commit mode fails closed on an unreadable staged file and on a git failure', () => {
  it('control: a clean staged spec exits zero under --pre-commit', () => {
    const repo = mkRepo();
    try {
      initRepo(repo);
      fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, 'specs', 'SPEC-001-probe.md'),
        '---\nid: SPEC-001\ntier: T1\n---\n# Demo\nbody\n',
      );
      git(repo, 'add', 'specs/SPEC-001-probe.md');
      const { code } = runValidatePy(repo, ['--pre-commit']);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a staged spec blob that cannot be decoded FAILs loudly under --pre-commit', () => {
    const repo = mkRepo();
    try {
      initRepo(repo);
      fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, 'specs', 'SPEC-001-probe.md'),
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# no frontmatter\nbody\n', 'utf8')]),
      );
      git(repo, 'add', 'specs/SPEC-001-probe.md');
      const { code, err } = runValidatePy(repo, ['--pre-commit']);
      expect(code).not.toBe(0);
      expect(err).toMatch(/FAIL specs\/SPEC-001-probe\.md: unreadable \(/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a git failure listing staged files FAILs loudly instead of validating nothing', () => {
    // No `git init` at all: `git diff --cached` has nothing to run against, so
    // `staged_files` itself raises. Pre-#2630 this came back as `[]` and the run
    // silently validated zero files while still exiting 0.
    const repo = mkRepo();
    try {
      const { code, err } = runValidatePy(repo, ['--pre-commit']);
      expect(code).not.toBe(0);
      expect(err).toMatch(/FAIL pre-commit: could not list staged files/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
