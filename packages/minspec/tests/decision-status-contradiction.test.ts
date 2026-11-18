import { describe, it, expect } from 'vitest';
import { findDecisionContradictions } from '../../../scripts/lib/decision-status-contradiction';

describe('findDecisionContradictions (#1812)', () => {
  it('flags a frontmatter comment saying D2/D3/D4 remain open while the body resolves D3 (#1797 shape)', () => {
    const t = [
      '---',
      'id: SPEC-062',
      'implements: [] # D2/D3/D4 remain open',
      '---',
      '## Decisions needed (Clarify)',
      '**D3. Routing.**',
      'RESOLVED 2026-09-05 — split by kind',
    ].join('\n');
    expect(findDecisionContradictions(t)).toEqual([{ id: 'D3', openLine: 3, resolvedLine: 7 }]);
  });
  it('flags a DR note saying a decision is still open when an explicit D1 RESOLVED exists (#1658 shape)', () => {
    const t = 'D1 RESOLVED 2026-08-01 — event driven\n\nNote: D1 (trigger model) is still **open**.\n';
    expect(findDecisionContradictions(t)).toEqual([{ id: 'D1', openLine: 3, resolvedLine: 1 }]);
  });
  it('flags a "Decision needed — D1" marker alongside a resolution', () => {
    const t = '> Decision needed — D1\n\n### D1 (width)\nresolved 2026-09-05 chose (a)\n';
    expect(findDecisionContradictions(t).map((f) => f.id)).toEqual(['D1']);
  });
  it('treats OQ and PQ ids the same and normalises OQ-1 to OQ1', () => {
    const t = 'OQ-1 is still open.\nOQ1 RESOLVED 2026-09-05 — yes\nPQ2 remains open\nPQ2 RESOLVED: no\n';
    expect(findDecisionContradictions(t).map((f) => f.id)).toEqual(['OQ1', 'PQ2']);
  });
  it('does not flag different decisions, or open-only / resolved-only documents', () => {
    expect(findDecisionContradictions('D1 is still open.\nD2 RESOLVED 2026-09-05 — x\n')).toEqual([]);
    expect(findDecisionContradictions('D1 is still open.\n')).toEqual([]);
    expect(findDecisionContradictions('D1 RESOLVED 2026-09-05 — x\n')).toEqual([]);
  });
  it('does not flag a single line that says the decision moved', () => {
    expect(findDecisionContradictions('D1 was still open, now RESOLVED 2026-09-05 — x\n')).toEqual([]);
  });
  it('attributes a bare RESOLVED line to its own block only', () => {
    const t = '**D1. A**\nstill open note: D2 remains open\n**D2. B**\nRESOLVED 2026-09-05 — x\n';
    expect(findDecisionContradictions(t).map((f) => f.id)).toEqual(['D2']);
    const u = '**D1. A**\nD2 remains open\n## Other\nRESOLVED 2026-09-05 — x\n';
    expect(findDecisionContradictions(u)).toEqual([]);
  });
  it('ignores fenced code and CRLF line endings do not hide a finding', () => {
    expect(findDecisionContradictions('```\nD1 is still open\nD1 RESOLVED 2026-09-05 — x\n```\n')).toEqual([]);
    expect(findDecisionContradictions('D1 is still open\r\nD1 RESOLVED 2026-09-05 — x\r\n')).toHaveLength(1);
  });
  it('gives each id on a multi-id line its own nearest status (missed-contradiction shape)', () => {
    const t = [
      'implements: [] # D1 RESOLVED 2026-09-01; D2/D3 remain open',
      '**D2. Routing.**',
      'RESOLVED 2026-09-05 — split',
    ].join('\n');
    expect(findDecisionContradictions(t)).toEqual([{ id: 'D2', openLine: 1, resolvedLine: 3 }]);
  });
  it('does not report a false contradiction against a multi-id line where the id is open (false-warning shape)', () => {
    const t = 'implements: [] # D1 RESOLVED 2026-09-01; D2/D3 remain open\nD2 is still open.\n';
    expect(findDecisionContradictions(t)).toEqual([]);
  });
  it('matches **Resolved:** emphasis and capital "Resolved <date>"', () => {
    expect(findDecisionContradictions('D1 is still open.\n**Resolved:** D1 chose (a)\n')).toHaveLength(1);
    expect(findDecisionContradictions('D1 is still open.\nD1 Resolved 2026-09-05 — x\n')).toHaveLength(1);
  });
  it('does not credit a bare RESOLVED line to an id that merely starts a prose line', () => {
    const t = 'D1 is still open.\nRESOLVED 2026-09-05 — x\n';
    expect(findDecisionContradictions(t)).toEqual([]);
  });
});
