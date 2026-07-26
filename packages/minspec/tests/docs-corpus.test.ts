/**
 * docs-corpus — T0 invariant tests for the pure corpus predicate (SPEC-039 INV-2).
 *
 * INV-2 (corpus-only): a non-docs path is NEVER in the corpus, so it can never be
 * pushed onto the auto-merging docs-lane. These tests pin the predicate to the
 * SAME corpus the workflow (`docs-lane.yml`) and the CLI (`push-docs.sh`) enforce:
 *   accept  specs/**, docs/**, markdown under skills/, .minspec/approvals/**, top-level *.md
 *   reject  everything else — notably code, .github/**, NESTED *.md, and any
 *           NON-markdown file under skills/ (an executable must never ride the lane).
 *
 * Pure: this file exercises the predicate with zero I/O (INV-1 corollary).
 */

import { describe, it, expect } from 'vitest';
import { isDocsCorpusPath, DOCS_CORPUS, DOCS_CORPUS_REGEX } from '../src/lib/docs-corpus';

describe('isDocsCorpusPath — accepts the docs corpus', () => {
  const accepted = [
    'specs/minspec/SPEC-039-push-docs-lane-command/requirements.md',
    'specs/minspec/SPEC-001/design.md',
    'specs/anything', // any depth under specs/
    'docs/decisions/DR-001.md',
    'docs/decisions/INDEX.md',
    'docs/epics/EP-001.md',
    '.minspec/approvals/specs/minspec/SPEC-039/requirements.md.json',
    '.minspec/approvals/DR-001.md.json',
    'skills/scrooge-delegate/SKILL.md', // agent skill definitions — markdown prose only
    'skills/anything/nested/deep.md', // any depth under skills/, so long as it is .md
    'README.md', // top-level markdown
    'CLAUDE.md',
    'CHANGELOG.md',
  ];
  for (const p of accepted) {
    it(`accepts ${p}`, () => {
      expect(isDocsCorpusPath(p)).toBe(true);
    });
  }
});

describe('isDocsCorpusPath — rejects everything outside the corpus', () => {
  const rejected = [
    'packages/minspec/src/lib/docs-corpus.ts',
    'packages/minspec/package.json',
    'src/extension.ts',
    '.github/workflows/docs-lane.yml',
    '.githooks/commit-msg',
    'scripts/push-docs.sh',
    'package.json',
    'tsconfig.json',
    // NESTED markdown is NOT top-level — `[^/]+\.md$` forbids a slash, so these reject.
    'packages/minspec/README.md',
    'packages/x/y.md',
    'docs-site/index.md', // does not start with `docs/` (the `-site` breaks the prefix)
    'specifications/foo.md', // not `specs/`
    '.minspec/config.json', // under .minspec but NOT approvals/
    '.minspec/approvals.json', // the legacy map file (has no trailing slash — not approvals/**)
    // A skill directory may hold EXECUTABLES. The corpus admits only its markdown, so a
    // script can never ride the auto-merging lane on the strength of a comment claiming
    // "skills are just prose" (the unproven-absolute / silent-gate class inv. #2 + DR-066
    // forbid). These are the enforcement proof for that claim.
    'skills/foo/run.sh',
    'skills/foo/run.py',
    'skills/scrooge-delegate/install.sh',
    'skills/foo/Makefile',
    'skills/README', // no extension at all
    'skills/bad.md.sh', // suffix-confusion: `.md` mid-name, NOT the extension (anchored $)
  ];
  for (const p of rejected) {
    it(`rejects ${p}`, () => {
      expect(isDocsCorpusPath(p)).toBe(false);
    });
  }
});

describe('isDocsCorpusPath — normalization + safety', () => {
  it('normalizes Windows separators before matching', () => {
    expect(isDocsCorpusPath('specs\\minspec\\SPEC-001\\design.md')).toBe(true);
    expect(isDocsCorpusPath('packages\\x\\y.md')).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(isDocsCorpusPath('')).toBe(false);
    // @ts-expect-error — guarding runtime misuse
    expect(isDocsCorpusPath(undefined)).toBe(false);
    // @ts-expect-error — guarding runtime misuse
    expect(isDocsCorpusPath(null)).toBe(false);
  });

  it('rejects absolute paths (never repo-relative docs)', () => {
    expect(isDocsCorpusPath('/etc/passwd')).toBe(false);
    expect(isDocsCorpusPath('/specs/x.md')).toBe(false);
  });

  it('rejects parent-escape even when it superficially matches a prefix', () => {
    // Would satisfy `^specs/` yet resolve OUTSIDE the repo — must be refused.
    expect(isDocsCorpusPath('specs/../../etc/passwd')).toBe(false);
    expect(isDocsCorpusPath('specs/../secret.md')).toBe(false);
    expect(isDocsCorpusPath('..')).toBe(false);
  });
});

describe('corpus constants stay in lock-step with the workflow', () => {
  it('DOCS_CORPUS_REGEX mirrors docs-lane.yml / push-docs.sh exactly', () => {
    // If this literal changes, docs-lane.yml `allowed=` and push-docs.sh `CORPUS=`
    // MUST change too, or the three enforcers disagree (never-wrong is lost).
    expect(DOCS_CORPUS_REGEX.source).toBe('^(specs\\/|docs\\/|skills\\/.*\\.md$|\\.minspec\\/approvals\\/|[^/]+\\.md$)');
  });

  it('DOCS_CORPUS lists the five human-readable corpus entries', () => {
    expect(DOCS_CORPUS).toEqual([
      'specs/**',
      'docs/**',
      'skills/**/*.md',
      '.minspec/approvals/**',
      '*.md (top-level only)',
    ]);
  });
});
