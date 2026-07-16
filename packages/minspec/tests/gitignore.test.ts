/**
 * T2 — Feature tests: ensureGitignoreEntries
 *
 * Issue #1: `minspec init` should add session/calibration to .gitignore
 * so users don't commit ephemeral data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  ensureGitignoreEntries,
  MINSPEC_GITIGNORE_MARKER,
  MINSPEC_GITIGNORE_ENTRIES,
  generateHarnessFiles,
  refreshHarnessFiles,
} from '../src/lib/scaffold';
import {
  HASHES_FILENAME,
  TEMPLATE_BASELINE_FILENAME,
} from '../src/lib/merge-refresh';

describe('ensureGitignoreEntries()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with marker and entries if missing', () => {
    ensureGitignoreEntries(tmpDir);

    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain(MINSPEC_GITIGNORE_MARKER);
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('appends marker block to existing .gitignore without entries', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const existing = 'node_modules\ndist\n';
    fs.writeFileSync(gitignorePath, existing);

    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content.startsWith(existing)).toBe(true);
    expect(content).toContain(MINSPEC_GITIGNORE_MARKER);
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('does not duplicate marker block on second run', () => {
    ensureGitignoreEntries(tmpDir);
    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const markerCount = content.split(MINSPEC_GITIGNORE_MARKER).length - 1;
    expect(markerCount).toBe(1);

    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });

  it('does not re-add entries already present (user added them manually)', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const existing =
      'node_modules\n' + MINSPEC_GITIGNORE_ENTRIES.map((e) => e).join('\n') + '\n';
    fs.writeFileSync(gitignorePath, existing);

    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });

  it('preserves existing .gitignore content verbatim', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const existing = 'node_modules\n.env\n\n# user comment\nbuild/\n';
    fs.writeFileSync(gitignorePath, existing);

    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content.startsWith(existing)).toBe(true);
  });

  it('handles .gitignore without trailing newline', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'node_modules');

    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('node_modules');
    expect(content).toContain(MINSPEC_GITIGNORE_MARKER);
    // Marker block should be separated from previous content by a newline
    const idx = content.indexOf(MINSPEC_GITIGNORE_MARKER);
    expect(content[idx - 1]).toBe('\n');
  });

  it('adds only the missing entries when some already present', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, `node_modules\n${MINSPEC_GITIGNORE_ENTRIES[0]}\n`);

    ensureGitignoreEntries(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });
});

describe('generateHarnessFiles() — gitignore integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-init-gitignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init creates .gitignore with MinSpec ephemeral entries', () => {
    generateHarnessFiles(tmpDir);

    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.minspec/session.json');
    expect(content).toContain('.minspec/calibration.json');
  });

  it('init preserves existing .gitignore content', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const existing = 'node_modules\ndist\n';
    fs.writeFileSync(gitignorePath, existing);

    generateHarnessFiles(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('node_modules');
    expect(content).toContain('dist');
    expect(content).toContain('.minspec/session.json');
  });
});

describe('MINSPEC_GITIGNORE_ENTRIES — coverage of machine-local state files', () => {
  it('includes all four machine-local files (session, calibration, hashes, baseline)', () => {
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain('.minspec/session.json');
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain('.minspec/calibration.json');
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain('.minspec/generated-hashes.json');
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain('.minspec/template-baseline.json');
  });

  // ASYMMETRY GATE (durable fix): the merge-refresh state files are the source of
  // truth for their own filenames. This ties the gitignore literals back to those
  // constants, so renaming a state file without updating the ignore list — the
  // exact asymmetry this work closed — fails the suite instead of silently
  // re-stranding the file as committed.
  it('covers the merge-refresh state files by their source-of-truth constants', () => {
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain(`.minspec/${HASHES_FILENAME}`);
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain(`.minspec/${TEMPLATE_BASELINE_FILENAME}`);
  });

  // Guard against over-ignoring: config.json and constitution.md are shared,
  // committed project files. They must NEVER appear in the ignore list.
  it('never ignores shared/committed project files', () => {
    expect(MINSPEC_GITIGNORE_ENTRIES).not.toContain('.minspec/config.json');
    expect(MINSPEC_GITIGNORE_ENTRIES).not.toContain('.minspec/constitution.md');
  });
});

describe('root .gitignore — mirrors MINSPEC_GITIGNORE_ENTRIES (#794)', () => {
  // T0 invariant gate: this repo's OWN root .gitignore must list every entry in
  // MINSPEC_GITIGNORE_ENTRIES. Without this, an entry can be added to the
  // scaffold list (applied to newly-scaffolded projects) while the monorepo's
  // own root file silently omits it — a present-but-asymmetric validator gap
  // that already leaked twice (#755: .minspec/queue/; #790: agent-dispatch
  // sidecars only gitignored reactively). Fails CI the moment the two drift.
  const repoRootGitignorePath = path.join(__dirname, '..', '..', '..', '.gitignore');
  const repoRootGitignore = fs.readFileSync(repoRootGitignorePath, 'utf-8');
  const repoRootGitignoreLines = new Set(
    repoRootGitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  it('contains every MINSPEC_GITIGNORE_ENTRIES entry', () => {
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      expect(
        repoRootGitignoreLines.has(entry),
        `root .gitignore is missing scaffold entry "${entry}" — add it to keep ` +
          'the monorepo checkout gitignore-consistent with newly-scaffolded projects',
      ).toBe(true);
    }
  });
});

describe('refreshHarnessFiles() — gitignore backfill for existing projects', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-refresh-gitignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backfills the new state-file entries on refresh of an old project', () => {
    // Initialise a project, then simulate one scaffolded BEFORE the state-file
    // entries existed: rewrite .gitignore to hold only the two original entries.
    generateHarnessFiles(tmpDir);

    const gitignorePath = path.join(tmpDir, '.gitignore');
    const oldStyle =
      `node_modules\n\n${MINSPEC_GITIGNORE_MARKER}\n` +
      '.minspec/session.json\n.minspec/calibration.json\n';
    fs.writeFileSync(gitignorePath, oldStyle);

    refreshHarnessFiles(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');

    // New state-file entries are now present.
    expect(content).toContain(`.minspec/${HASHES_FILENAME}`);
    expect(content).toContain(`.minspec/${TEMPLATE_BASELINE_FILENAME}`);

    // Pre-existing content preserved.
    expect(content).toContain('node_modules');

    // No duplicate marker.
    const markerCount = content.split(MINSPEC_GITIGNORE_MARKER).length - 1;
    expect(markerCount).toBe(1);

    // Every entry appears exactly once (no duplication of the originals).
    for (const entry of MINSPEC_GITIGNORE_ENTRIES) {
      const occurrences = content.split('\n').filter((line) => line.trim() === entry).length;
      expect(occurrences, `entry ${entry} should appear exactly once`).toBe(1);
    }
  });
});
