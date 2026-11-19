import { describe, it, expect } from 'vitest';
import type { Approvable, SpecNode, EpicNode, DrNode, PrNode, IssueNode } from '../src';

describe('Approvable (DR-041)', () => {
  it('accepts each member type', () => {
    const spec: SpecNode = { id: 'SPEC-001', status: 'new', approvalState: 'unapproved' };
    const epic: EpicNode = { id: 'EPIC-001', status: 'active' };
    const dr: DrNode = { id: 'DR-041', status: 'accepted' };
    const pr: PrNode = { number: 1, state: 'open' };
    const issue: IssueNode = { number: 325, state: 'open' };
    const all: Approvable[] = [spec, epic, dr, pr, issue];
    expect(all).toHaveLength(5);
  });
});
