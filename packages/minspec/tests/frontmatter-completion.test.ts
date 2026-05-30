/**
 * Tests for frontmatterValueCompletions() — the pure core of the frontmatter
 * value completion provider. Covers field resolution, file-awareness
 * (ADR vs spec status), prefix filtering, and frontmatter-boundary gating.
 */

import { describe, it, expect, vi } from 'vitest';

// The module under test imports `vscode` for its provider wrapper; the pure
// core needs none of it, but the import must resolve. Minimal mock.
vi.mock('vscode', () => ({
  CompletionItem: class {
    constructor(public label: string, public kind?: number) {}
    detail?: string;
    sortText?: string;
  },
  CompletionItemKind: { EnumMember: 19 },
}));

import {
  frontmatterValueCompletions,
  SPEC_STATUS_VALUES,
  TIER_VALUES,
  PHASE_STATUS_VALUES,
  type FrontmatterCompletionContext,
} from '../src/views/frontmatter-completion';

/** Build a context from a multi-line doc string + the line being edited. */
function ctx(
  fileName: string,
  doc: string,
  lineIndex: number,
  linePrefix: string,
): FrontmatterCompletionContext {
  return { fileName, lines: doc.split('\n'), lineIndex, linePrefix };
}

const ADR_DOC = '---\nid: DR-007\ntitle: Something\nstatus: \ndate: 2026-05-29\n---\n\n## Context\n';
const SPEC_DOC = '---\nid: SPEC-001\ntype: requirements\nstatus: \ntier: \n---\n\n# Spec\n';

describe('frontmatterValueCompletions()', () => {
  describe('status field — file-aware', () => {
    it('offers ADR statuses inside a DR-*.md', () => {
      const result = frontmatterValueCompletions(
        ctx('DR-007-something.md', ADR_DOC, 3, 'status: '),
      );
      expect(result).toEqual(['proposed', 'accepted', 'deprecated', 'superseded']);
    });

    it('offers spec statuses inside a spec file', () => {
      const result = frontmatterValueCompletions(
        ctx('requirements.md', SPEC_DOC, 3, 'status: '),
      );
      expect(result).toEqual([...SPEC_STATUS_VALUES]);
    });
  });

  describe('tier field', () => {
    it('offers T1–T4', () => {
      const result = frontmatterValueCompletions(
        ctx('requirements.md', SPEC_DOC, 4, 'tier: '),
      );
      expect(result).toEqual([...TIER_VALUES]);
    });
  });

  describe('epic field — registry-driven', () => {
    const EPIC_DOC = '---\nid: SPEC-001\nepic: \nstatus: new\n---\n# Spec\n';
    const cands = ['EPIC-001', 'EPIC-002', 'telemetry', 'auth'];

    it('offers injected epic candidates (ids + slugs)', () => {
      const result = frontmatterValueCompletions({
        fileName: 'requirements.md',
        lines: EPIC_DOC.split('\n'),
        lineIndex: 2,
        linePrefix: 'epic: ',
        epicCandidates: cands,
      });
      expect(result).toEqual(cands);
    });

    it('prefix-filters epic candidates', () => {
      const result = frontmatterValueCompletions({
        fileName: 'requirements.md',
        lines: EPIC_DOC.split('\n'),
        lineIndex: 2,
        linePrefix: 'epic: EPIC',
        epicCandidates: cands,
      });
      expect(result).toEqual(['EPIC-001', 'EPIC-002']);
    });

    it('returns [] for epic field when no candidates injected', () => {
      const result = frontmatterValueCompletions({
        fileName: 'requirements.md',
        lines: EPIC_DOC.split('\n'),
        lineIndex: 2,
        linePrefix: 'epic: ',
      });
      expect(result).toEqual([]);
    });
  });

  describe('phase keys', () => {
    it('offers phase statuses after a phase key', () => {
      const doc = '---\nid: SPEC-001\nimplement: \n---\n';
      const result = frontmatterValueCompletions(ctx('design.md', doc, 2, 'implement: '));
      expect(result).toEqual([...PHASE_STATUS_VALUES]);
    });

    it('handles indented (nested) phase keys', () => {
      const doc = '---\nid: SPEC-001\nphases:\n  specify: \n---\n';
      const result = frontmatterValueCompletions(ctx('design.md', doc, 3, '  specify: '));
      expect(result).toEqual([...PHASE_STATUS_VALUES]);
    });
  });

  describe('prefix filtering', () => {
    it('filters candidates by what is already typed (case-insensitive)', () => {
      const result = frontmatterValueCompletions(
        ctx('DR-007-something.md', ADR_DOC, 3, 'status: dep'),
      );
      expect(result).toEqual(['deprecated']);
    });

    it('returns empty when typed value matches nothing', () => {
      const result = frontmatterValueCompletions(
        ctx('DR-007-something.md', ADR_DOC, 3, 'status: xyz'),
      );
      expect(result).toEqual([]);
    });
  });

  describe('boundary gating', () => {
    it('returns empty outside the frontmatter block', () => {
      // Line 7 is "## Context" in ADR_DOC — well past the closing ---
      const result = frontmatterValueCompletions(
        ctx('DR-007-something.md', ADR_DOC, 7, 'status: '),
      );
      expect(result).toEqual([]);
    });

    it('returns empty when the doc has no frontmatter', () => {
      const doc = '# Just markdown\n\nstatus: \n';
      const result = frontmatterValueCompletions(ctx('notes.md', doc, 2, 'status: '));
      expect(result).toEqual([]);
    });

    it('returns empty for an unterminated frontmatter block', () => {
      const doc = '---\nid: SPEC-001\nstatus: \n';
      const result = frontmatterValueCompletions(ctx('design.md', doc, 2, 'status: '));
      expect(result).toEqual([]);
    });
  });

  describe('non-applicable lines', () => {
    it('returns empty for an unknown field', () => {
      const result = frontmatterValueCompletions(
        ctx('requirements.md', SPEC_DOC, 2, 'type: '),
      );
      expect(result).toEqual([]);
    });

    it('returns empty when there is no key: on the line', () => {
      const result = frontmatterValueCompletions(
        ctx('requirements.md', SPEC_DOC, 3, 'sta'),
      );
      expect(result).toEqual([]);
    });
  });
});
