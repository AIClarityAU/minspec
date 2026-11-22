import { describe, it, expect } from 'vitest';
import type { Approvable, SpecNode, EpicNode, DrNode, PrNode, IssueNode,
  PlanNode, DesignDocNode, TasksDocNode, ConstitutionInvariantNode } from '../src';

describe('Approvable (DR-041)', () => {
  it('accepts each member type', () => {
    const spec: SpecNode = { id: 'SPEC-001', status: 'new', approvalState: 'unapproved' };
    const epic: EpicNode = { id: 'EPIC-001', status: 'active' };
    const dr: DrNode = { id: 'DR-041', status: 'accepted' };
    const pr: PrNode = { number: 1, state: 'open' };
    const issue: IssueNode = { number: 325, state: 'open' };
    const plan: PlanNode = { specId: 'SPEC-001', approvalState: 'unapproved' };
    const design: DesignDocNode = { specId: 'SPEC-001' };
    const tasks: TasksDocNode = { specId: 'SPEC-001' };
    const inv: ConstitutionInvariantNode = { index: 1 };
    const all: Approvable[] = [spec, plan, design, tasks, dr, inv, epic, issue, pr];
    expect(all).toHaveLength(9);
  });
});
