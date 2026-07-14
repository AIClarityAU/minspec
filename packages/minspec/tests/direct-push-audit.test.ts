/**
 * T0 — direct (non-PR) push audit for `main` (#688 harden).
 *
 * Covers the #575/DR-051 threat shape this backstop guards: the `main`
 * ruleset's Admin bypass is REF-scoped, not PATH-scoped, so an admin CAN
 * direct-push non-docs content to `main`. This audit must flag exactly that
 * (a direct commit touching a file outside the docs-only allowlist) and
 * exempt everything else: PR-merge commits (already reviewed) and direct
 * commits that stay within the allowed corpus.
 */

import { describe, it, expect } from 'vitest';
import {
  isAllowedDirectPushPath,
  classifyOffendingFiles,
  isDirectPush,
  auditPushedCommits,
  hasDirectPushViolation,
  type PushedCommitInput,
} from '../src/lib/direct-push-audit';

// ─── isAllowedDirectPushPath ─────────────────────────────────────────────────

describe('isAllowedDirectPushPath', () => {
  it.each([
    'specs/minspec/tasks.md',
    'docs/decisions/DR-051.md',
    'docs/domain/foo.md',
    'docs/epics/EP-001.md',
    '.minspec/approvals/some-approval.json',
    'README.md',
    'CLAUDE.md',
  ])('allows %s', (path) => {
    expect(isAllowedDirectPushPath(path)).toBe(true);
  });

  it.each([
    'packages/minspec/src/extension.ts',
    'scripts/dispatch-issue.sh',
    '.github/workflows/ci.yml',
    'docs/README.md', // nested — not top-level, not under an allowed docs/ subtree
    'package.json',
  ])('rejects %s', (path) => {
    expect(isAllowedDirectPushPath(path)).toBe(false);
  });
});

// ─── classifyOffendingFiles ──────────────────────────────────────────────────

describe('classifyOffendingFiles', () => {
  it('returns only the non-allowed files, sorted', () => {
    const files = ['specs/foo.md', 'packages/minspec/src/z.ts', 'CLAUDE.md', 'packages/minspec/src/a.ts'];
    expect(classifyOffendingFiles(files)).toEqual(['packages/minspec/src/a.ts', 'packages/minspec/src/z.ts']);
  });

  it('returns [] when every file is inside the allowlist', () => {
    expect(classifyOffendingFiles(['specs/foo.md', 'docs/decisions/DR-051.md', 'CLAUDE.md'])).toEqual([]);
  });
});

// ─── isDirectPush ─────────────────────────────────────────────────────────────

describe('isDirectPush', () => {
  it('is direct when the commit has no associated pulls', () => {
    expect(isDirectPush([])).toBe(true);
  });

  it('is direct when associated pulls exist but none are merged', () => {
    expect(isDirectPush([{ number: 1, merged_at: null }])).toBe(true);
  });

  it('is NOT direct when a merged pull is associated (PR-merge commit)', () => {
    expect(isDirectPush([{ number: 1, merged_at: '2026-07-13T00:00:00Z' }])).toBe(false);
  });

  it('is NOT direct when any one of several associated pulls is merged', () => {
    expect(
      isDirectPush([
        { number: 1, merged_at: null },
        { number: 2, merged_at: '2026-07-13T00:00:00Z' },
      ]),
    ).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['an object (API error body)', { message: 'Not Found' }],
  ])('tolerates malformed input by NOT flagging as direct: %s', (_label, input) => {
    // Fail-open: an unparseable pulls response must degrade into silence,
    // not a false alarm — this audit is advisory-only.
    expect(isDirectPush(input)).toBe(false);
  });
});

// ─── auditPushedCommits ───────────────────────────────────────────────────────

describe('auditPushedCommits', () => {
  it('flags the exact #575 bypass shape: a direct push touching a non-docs file', () => {
    const commits: PushedCommitInput[] = [
      { sha: 'abc123', author: 'someadmin', pulls: [], files: ['packages/minspec/src/extension.ts'] },
    ];
    const findings = auditPushedCommits(commits);
    expect(findings).toEqual([
      {
        sha: 'abc123',
        author: 'someadmin',
        direct: true,
        offendingFiles: ['packages/minspec/src/extension.ts'],
        violation: true,
      },
    ]);
    expect(hasDirectPushViolation(findings)).toBe(true);
  });

  it('does not flag a direct push that stays within the docs-only allowlist (the #575 intended path)', () => {
    const commits: PushedCommitInput[] = [
      { sha: 'def456', pulls: [], files: ['specs/minspec/SPEC-030.md', 'docs/decisions/DR-060.md'] },
    ];
    const findings = auditPushedCommits(commits);
    expect(findings[0].direct).toBe(true);
    expect(findings[0].violation).toBe(false);
    expect(hasDirectPushViolation(findings)).toBe(false);
  });

  it('exempts a PR-merge commit even if it touches non-docs files', () => {
    const commits: PushedCommitInput[] = [
      {
        sha: 'ghi789',
        pulls: [{ number: 42, merged_at: '2026-07-13T00:00:00Z' }],
        files: ['packages/minspec/src/extension.ts'],
      },
    ];
    const findings = auditPushedCommits(commits);
    expect(findings[0].direct).toBe(false);
    expect(findings[0].offendingFiles).toEqual([]);
    expect(findings[0].violation).toBe(false);
    expect(hasDirectPushViolation(findings)).toBe(false);
  });

  it('handles a mixed batch and preserves input order', () => {
    const commits: PushedCommitInput[] = [
      { sha: 'a', pulls: [{ number: 1, merged_at: '2026-07-13T00:00:00Z' }], files: ['packages/x.ts'] },
      { sha: 'b', pulls: [], files: ['scripts/y.sh'] },
      { sha: 'c', pulls: [], files: ['CLAUDE.md'] },
    ];
    const findings = auditPushedCommits(commits);
    expect(findings.map((f) => [f.sha, f.direct, f.violation])).toEqual([
      ['a', false, false],
      ['b', true, true],
      ['c', true, false],
    ]);
    expect(hasDirectPushViolation(findings)).toBe(true);
  });

  it('empty input yields no findings and no violation', () => {
    expect(auditPushedCommits([])).toEqual([]);
    expect(hasDirectPushViolation([])).toBe(false);
  });
});
