/**
 * #2467 — nothing detects a decision/epic record with two frontmatter blocks.
 *
 * `setAdrStatus` (adr-manager.ts) synthesizes a fresh frontmatter block and
 * prepends it when the EXISTING block fails to parse (e.g. because it is still
 * CRLF — the SPEC-095/#2397 damage). The original block survives as body text
 * immediately below, complete with its own stale `status:` line. Nothing
 * downstream notices: `listAdrs` reads only the first block, and the
 * status-parity rule compares frontmatter against a `## Status` section or a
 * head blockquote — a stray body `status:` line is neither.
 *
 * `detectDoubledFrontmatter` is the validator-side backstop that finds a file
 * already in this state. These tests pin its detection AND its false-positive
 * discipline — a bare `---` divider in ordinary prose must never be flagged.
 */
import { describe, it, expect } from 'vitest';
import { detectDoubledFrontmatter } from '../src/lib/adr-manager';

describe('detectDoubledFrontmatter() — #2467', () => {
  it('detects two consecutive frontmatter-shaped blocks, each carrying a status: line', () => {
    const content = [
      '---',
      'id: DR-999',
      'title: Test',
      'status: accepted',
      '---',
      '',
      '---',
      'id: DR-999',
      'title: Test',
      'status: proposed',
      '---',
      '',
      '# DR-999: Test',
      '',
      '## Status',
      'Accepted',
    ].join('\n');

    const finding = detectDoubledFrontmatter(content);
    expect(finding).toBeDefined();
    expect(finding?.firstBlockEndLine).toBe(5);
    expect(finding?.secondBlockStartLine).toBe(7);
  });

  it('detects the doubled shape even when the second (original) block is still CRLF', () => {
    // The real #2467 shape: `setAdrStatus` prepends a freshly synthesized LF
    // block ahead of an original block it could not parse because that block
    // is CRLF — so the two fences differ in line ending, not just position.
    const content =
      '---\nid: DR-999\nstatus: accepted\n---\n\n' +
      '---\r\nid: DR-999\r\nstatus: proposed\r\n---\r\n\n' +
      '# DR-999\n';

    const finding = detectDoubledFrontmatter(content);
    expect(finding).toBeDefined();
  });

  it('does not flag a single, well-formed frontmatter block', () => {
    const content = '---\nid: DR-001\nstatus: accepted\n---\n\n## Context\nfine.\n';
    expect(detectDoubledFrontmatter(content)).toBeUndefined();
  });

  it('does not flag an ordinary markdown horizontal-rule divider after frontmatter', () => {
    // Two `---` lines in a row IS legal markdown (back-to-back horizontal
    // rules) and must never read as damage.
    const content = '---\nid: DR-001\nstatus: accepted\n---\n\n## Context\n\n---\n\n---\n\nMore prose.\n';
    expect(detectDoubledFrontmatter(content)).toBeUndefined();
  });

  it('does not flag two consecutive blocks that carry no status: line at all', () => {
    // Precision over recall: the detector keys on the concrete #2467 symptom
    // (two different status claims), not on "any two adjacent fenced blocks".
    const content = [
      '---',
      'title: A',
      'date: 2026-01-01',
      '---',
      '---',
      'title: B',
      'date: 2026-01-02',
      '---',
    ].join('\n');
    expect(detectDoubledFrontmatter(content)).toBeUndefined();
  });

  it('does not flag a file with no frontmatter at all', () => {
    expect(detectDoubledFrontmatter('# Just a heading\n\nSome body.\n')).toBeUndefined();
  });

  it('does not flag an unterminated first block', () => {
    const content = '---\nid: DR-001\nstatus: accepted\n\n## Context\nno closing fence above.\n';
    expect(detectDoubledFrontmatter(content)).toBeUndefined();
  });
});
