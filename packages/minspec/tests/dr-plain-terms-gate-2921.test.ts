/**
 * #2921 — a hand-written decision record without `## In plain terms` was never
 * noticed: the section lived only in the generator template. Both validators now
 * WARN (not fail) on it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';
import { hasPlainTermsSection, drsMissingPlainTerms } from '../../../scripts/lib/dr-required-sections';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const SOURCE = renderManagedFile(
  MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === '.minspec/hooks/validate.py')!,
);

const WITH = '---\nid: DR-001\n---\n# T\n\n## In plain terms — what this changes for you\nx\n';
const WITHOUT = '---\nid: DR-002\n---\n# T\n\n## Context\nx\n';

describe('node twin (scripts/lib/dr-required-sections)', () => {
  it('detects the heading and ignores frontmatter / prose mentions', () => {
    expect(hasPlainTermsSection(WITH)).toBe(true);
    expect(hasPlainTermsSection(WITHOUT)).toBe(false);
    expect(hasPlainTermsSection('---\nid: DR-3\n---\nsee In plain terms below\n')).toBe(false);
  });
  it('skips INDEX.md and README.md', () => {
    expect(
      drsMissingPlainTerms([
        { file: 'docs/decisions/INDEX.md', content: 'x' },
        { file: 'docs/decisions/README.md', content: 'x' },
        { file: 'docs/decisions/DR-002.md', content: WITHOUT },
        { file: 'docs/decisions/DR-001.md', content: WITH },
      ]),
    ).toEqual(['docs/decisions/DR-002.md']);
  });
});

describe('python validate.py twin', () => {
  function run(content: string): { code: number; err: string } {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-plain-terms-'));
    try {
      const git = (...a: string[]) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
      git('init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(repo, 'validate.py'), SOURCE);
      fs.mkdirSync(path.join(repo, 'docs', 'decisions'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'docs', 'decisions', 'DR-001.md'), content);
      git('add', 'docs');
      const r = spawnSync('python3', [path.join(repo, 'validate.py'), '--pre-commit'], {
        cwd: repo,
        encoding: 'utf8',
      });
      return { code: r.status ?? -1, err: r.stderr ?? '' };
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  it('warns, without failing, when the section is missing', () => {
    const { code, err } = run(WITHOUT.replace('DR-002', 'DR-001'));
    expect(err).toMatch(/WARN docs\/decisions\/DR-001\.md: decision record lacks a `## In plain terms`/);
    expect(code).toBe(0);
  });
  it('is silent when the section is present', () => {
    const { code, err } = run(WITH);
    expect(err).not.toMatch(/In plain terms/);
    expect(code).toBe(0);
  });
});
