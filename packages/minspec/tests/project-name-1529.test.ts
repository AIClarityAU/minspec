/**
 * #1529 — a harness refresh run from a git worktree silently renamed the project
 * in every generated file.
 *
 * Root cause: `buildContext` fell back to `path.basename(rootDir)` whenever the
 * project had no root `package.json` name. A linked worktree's directory name is
 * arbitrary, so the basename is not the project. Nothing compared the derived name
 * against the name already recorded in the harness, so the rename was written with
 * zero warnings — the constitution's own "no silent gate" shape.
 *
 * The gate: the name already on disk outranks the basename guess, and a divergence
 * is reported rather than applied.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildContext, resolveProjectName } from '../src/lib/template-engine';
import { refreshHarnessFiles } from '../src/lib/scaffold';
import { loadConfig, DEFAULT_CONFIG } from '../src/lib/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** H1 the CLAUDE.md template renders: `# <name> — Project Instructions`. */
function recordedNameOf(dir: string): string | undefined {
  const raw = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8');
  return raw.match(/^#\s+(.+?)\s+—\s+Project Instructions\s*$/m)?.[1];
}

describe('projectName resolution (#1529)', () => {
  let parent: string;
  /** The project's real checkout, whose directory name IS the project name. */
  let realCheckout: string;
  /** A copy under an arbitrary directory name, standing in for a linked worktree. */
  let worktree: string;

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1529-'));
    realCheckout = path.join(parent, 'realproj');
    worktree = path.join(parent, 'wt-some-branch-name');
    fs.mkdirSync(realCheckout, { recursive: true });
    // Generate a full harness in the correctly-named directory first.
    refreshHarnessFiles(realCheckout);
    // Then strip `projectName` back out of config.json, so the fixture is a project
    // scaffolded BEFORE this fix — which is the only population that can still hit
    // #1529. A project seeded by the fixed scaffold carries the name in config and
    // was never at risk; asserting against that fixture would test nothing.
    const configPath = path.join(realCheckout, '.minspec', 'config.json');
    const seeded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete seeded.projectName;
    fs.writeFileSync(configPath, JSON.stringify(seeded, null, 2) + '\n');
  });

  afterEach(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('seeds the fixture with the real project name (guards the test itself)', () => {
    expect(recordedNameOf(realCheckout)).toBe('realproj');
  });

  it('REGRESSION: refreshing from a differently-named directory must not rename the project', () => {
    fs.cpSync(realCheckout, worktree, { recursive: true });
    refreshHarnessFiles(worktree);

    expect(recordedNameOf(worktree)).toBe('realproj');
    expect(fs.readFileSync(path.join(worktree, 'AGENTS.md'), 'utf-8')).toContain(
      '# realproj — Agent Instructions',
    );
    expect(fs.readFileSync(path.join(worktree, '.cursorrules'), 'utf-8')).toContain(
      '# realproj — Cursor Rules',
    );
    expect(
      fs.readFileSync(path.join(worktree, '.minspec', 'constitution.md'), 'utf-8'),
    ).toContain('# realproj — Constitution');
    expect(fs.readFileSync(path.join(worktree, '.minspec', 'labels.md'), 'utf-8')).toContain(
      '# Issue label vocabulary — realproj',
    );
  });

  it('REGRESSION: the divergence is REPORTED, never silently swallowed', () => {
    fs.cpSync(realCheckout, worktree, { recursive: true });
    const warnings = refreshHarnessFiles(worktree);

    const mismatch = warnings.filter((w) => w.kind === 'project-name-mismatch');
    expect(mismatch).toHaveLength(1);
    // The message must name BOTH sides — a warning that says only "mismatch" leaves
    // the reader to go find which name won.
    expect(mismatch[0].message).toContain('realproj');
    expect(mismatch[0].message).toContain('wt-some-branch-name');
  });

  it('emits NO mismatch warning when refreshed in its own directory', () => {
    const warnings = refreshHarnessFiles(realCheckout);
    expect(warnings.filter((w) => w.kind === 'project-name-mismatch')).toHaveLength(0);
  });

  describe('resolution order', () => {
    it('config.projectName is authoritative — it outranks the recorded name and never warns', () => {
      fs.cpSync(realCheckout, worktree, { recursive: true });
      const configPath = path.join(worktree, '.minspec', 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ ...loadConfig(worktree), projectName: 'renamed-on-purpose' }, null, 2),
      );

      const warnings = refreshHarnessFiles(worktree);

      expect(recordedNameOf(worktree)).toBe('renamed-on-purpose');
      expect(warnings.filter((w) => w.kind === 'project-name-mismatch')).toHaveLength(0);
    });

    it('package.json name outranks the recorded name (an explicit source, not a guess)', () => {
      fs.cpSync(realCheckout, worktree, { recursive: true });
      fs.writeFileSync(
        path.join(worktree, 'package.json'),
        JSON.stringify({ name: '@org/from-package' }),
      );
      expect(resolveProjectName(worktree).name).toBe('from-package');
      expect(resolveProjectName(worktree).source).toBe('package.json');
    });

    it('falls back to the basename when nothing else is recorded', () => {
      const bare = path.join(parent, 'bare-project');
      fs.mkdirSync(bare, { recursive: true });
      const resolved = resolveProjectName(bare);
      expect(resolved.name).toBe('bare-project');
      expect(resolved.source).toBe('basename');
      expect(resolved.recorded).toBeUndefined();
    });

    it('reports source `recorded` when the on-disk name overrides the basename', () => {
      fs.cpSync(realCheckout, worktree, { recursive: true });
      const resolved = resolveProjectName(worktree);
      expect(resolved.name).toBe('realproj');
      expect(resolved.source).toBe('recorded');
      expect(resolved.recorded).toBe('realproj');
      expect(resolved.basename).toBe('wt-some-branch-name');
    });

    it('buildContext renders with the resolved name', () => {
      fs.cpSync(realCheckout, worktree, { recursive: true });
      expect(buildContext(worktree).projectName).toBe('realproj');
    });
  });

  describe('config persistence', () => {
    it('scaffold records projectName in a NEWLY created config.json', () => {
      const fresh = path.join(parent, 'fresh-project');
      fs.mkdirSync(fresh, { recursive: true });
      refreshHarnessFiles(fresh);

      const written = JSON.parse(
        fs.readFileSync(path.join(fresh, '.minspec', 'config.json'), 'utf-8'),
      );
      expect(written.projectName).toBe('fresh-project');
    });

    it('never overwrites an existing config.json', () => {
      const configPath = path.join(realCheckout, '.minspec', 'config.json');
      const before = fs.readFileSync(configPath, 'utf-8');
      refreshHarnessFiles(realCheckout);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    });

    it('DEFAULT_CONFIG carries no projectName — it is project-specific, not a default', () => {
      expect('projectName' in DEFAULT_CONFIG).toBe(false);
    });
  });
});
