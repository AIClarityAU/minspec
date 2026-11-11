/**
 * T2 — Feature tests: ensureGitattributesEntries
 *
 * Issue #2398: a scaffolded hook/script has no line-ending pin, so a checkout
 * with `core.autocrlf=true` (git's own Windows default) turns it CRLF and a
 * POSIX shell can no longer run it — the pre-commit hook then fails shut and
 * blocks every commit. `ensureGitattributesEntries` writes the marker-bounded
 * `.gitattributes` block (`text eol=lf`) that pins these paths LF regardless
 * of `core.autocrlf`, mirroring `ensureGitignoreEntries` in both shape and
 * idempotency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

import {
  ensureGitattributesEntries,
  MINSPEC_GITATTRIBUTES_MARKER,
  MINSPEC_GITATTRIBUTES_ENTRIES,
  generateHarnessFiles,
  refreshHarnessFiles,
} from '../src/lib/scaffold';
import { useShellTimeout } from './helpers/shell-timeout';

// #2598: the end-to-end describe below runs its own `run()` wrapper around
// execFileSync eight times (git init/config/add/commit/checkout) — plenty to
// flake on vitest's 5s default under load even though the suite passed in
// isolation. Must be at module scope (#1399) — see helpers/shell-timeout.ts.
useShellTimeout();

describe('ensureGitattributesEntries()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitattributes-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitattributes with marker and entries if missing', () => {
    ensureGitattributesEntries(tmpDir);

    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    expect(fs.existsSync(gitattributesPath)).toBe(true);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content).toContain(MINSPEC_GITATTRIBUTES_MARKER);
    for (const entry of MINSPEC_GITATTRIBUTES_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('appends marker block to existing .gitattributes without entries', () => {
    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    const existing = '*.png binary\n';
    fs.writeFileSync(gitattributesPath, existing);

    ensureGitattributesEntries(tmpDir);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content.startsWith(existing)).toBe(true);
    expect(content).toContain(MINSPEC_GITATTRIBUTES_MARKER);
    for (const entry of MINSPEC_GITATTRIBUTES_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('does not duplicate marker block on second run', () => {
    ensureGitattributesEntries(tmpDir);
    ensureGitattributesEntries(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitattributes'), 'utf-8');
    const markerCount = content.split(MINSPEC_GITATTRIBUTES_MARKER).length - 1;
    expect(markerCount).toBe(1);

    for (const entry of MINSPEC_GITATTRIBUTES_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry.trim()).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });

  it('does not re-add entries already present (user added them manually)', () => {
    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    const existing = '*.png binary\n' + MINSPEC_GITATTRIBUTES_ENTRIES.join('\n') + '\n';
    fs.writeFileSync(gitattributesPath, existing);

    ensureGitattributesEntries(tmpDir);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    for (const entry of MINSPEC_GITATTRIBUTES_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry.trim()).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });

  it('preserves existing .gitattributes content verbatim', () => {
    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    const existing = '*.png binary\n*.jpg binary\n\n# user comment\nvendor/** -diff\n';
    fs.writeFileSync(gitattributesPath, existing);

    ensureGitattributesEntries(tmpDir);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content.startsWith(existing)).toBe(true);
  });

  it('handles .gitattributes without trailing newline', () => {
    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    fs.writeFileSync(gitattributesPath, '*.png binary');

    ensureGitattributesEntries(tmpDir);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content).toContain('*.png binary');
    expect(content).toContain(MINSPEC_GITATTRIBUTES_MARKER);
    const idx = content.indexOf(MINSPEC_GITATTRIBUTES_MARKER);
    expect(content[idx - 1]).toBe('\n');
  });
});

describe('generateHarnessFiles() — gitattributes integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-init-gitattributes-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init creates .gitattributes pinning hooks/scripts/workflows LF', () => {
    generateHarnessFiles(tmpDir);

    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    expect(fs.existsSync(gitattributesPath)).toBe(true);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content).toContain('.minspec/hooks/**');
    expect(content).toContain('.claude/hooks/**');
    expect(content).toContain('scripts/**/*.sh');
    expect(content).toContain('scripts/**/*.py');
    expect(content).toContain('text eol=lf');
  });

  it('init preserves existing .gitattributes content', () => {
    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    const existing = '*.png binary\n';
    fs.writeFileSync(gitattributesPath, existing);

    generateHarnessFiles(tmpDir);

    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    expect(content).toContain('*.png binary');
    expect(content).toContain('.minspec/hooks/**');
  });
});

describe('refreshHarnessFiles() — gitattributes backfill for existing projects', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-refresh-gitattributes-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backfills the LF pin on refresh of a project scaffolded before #2398', () => {
    // Initialise a project, then simulate one scaffolded BEFORE the LF pin
    // existed: delete the entire .gitattributes MinSpec would have written.
    generateHarnessFiles(tmpDir);

    const gitattributesPath = path.join(tmpDir, '.gitattributes');
    fs.rmSync(gitattributesPath, { force: true });

    refreshHarnessFiles(tmpDir);

    expect(fs.existsSync(gitattributesPath)).toBe(true);
    const content = fs.readFileSync(gitattributesPath, 'utf-8');
    for (const entry of MINSPEC_GITATTRIBUTES_ENTRIES) {
      expect(content).toContain(entry);
    }
  });
});

/**
 * End-to-end regression for the issue's own repro: scaffold, commit, set
 * `core.autocrlf=true`, delete the hook, and check it out again. Without the
 * `.gitattributes` pin this reproduces the issue's exact failure (CRLF hook,
 * `/usr/bin/env: 'sh\r': No such file or directory`); with the pin the
 * checked-out hook stays LF. Skipped when git is unavailable (sandboxed CI),
 * mirroring other git-shelling tests in this suite (see
 * default-committer-real-git.test.ts).
 */
describe('end-to-end: checkout under core.autocrlf=true stays LF (#2398)', () => {
  let tmpDir: string;
  let gitAvailable = true;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-crlf-e2e-test-'));
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      gitAvailable = false;
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pre-commit hook survives a core.autocrlf=true checkout as LF', () => {
    if (!gitAvailable) return;

    const run = (args: string[]) =>
      execFileSync('git', args, { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' });

    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    // Disable this repo's own hooksPath so the temp repo's commit isn't
    // gated by the outer project's pre-commit hook.
    run(['config', 'core.hooksPath', '/dev/null']);

    generateHarnessFiles(tmpDir);

    run(['add', '-A']);
    run(['commit', '-q', '-m', 'scaffold']);

    // Simulate the Windows default and the checkout that follows it.
    run(['config', 'core.autocrlf', 'true']);
    const hookPath = path.join(tmpDir, '.minspec', 'hooks', 'pre-commit');
    fs.rmSync(hookPath);
    run(['checkout', '--', '.minspec/hooks/pre-commit']);

    const bytes = fs.readFileSync(hookPath, 'utf-8');
    expect(bytes).not.toContain('\r');
    expect(bytes.startsWith('#!/usr/bin/env sh\n')).toBe(true);
  });
});
