/**
 * Approvable — DR-041's collective term (as amended 2026-06-30) for the
 * AI-reviewed superset of artifacts: Spec, Plan, DesignDoc, TasksDoc, DR,
 * ConstitutionInvariant, Epic, Issue, PR (#325).
 *
 * Membership here means AI-reviewed, not human-gated: only a critical subset
 * (Spec, Plan, DR, constitution invariant, PR-to-main, Epic) carries a human
 * approval gate; Issue is never human-gated (DR-041 amendment, DR-047).
 *
 * Type-only (Tier 0: no vscode, no network). Spec and Epic reuse the existing
 * graph node shapes from `next-task`; the rest had no contract interface, so
 * minimal ones are declared here.
 */
import type { AdrStatus, ApprovalState, EpicNode, SpecNode } from '../next-task';

/** A spec's plan artifact (plan.md). */
export interface PlanNode {
  specId: string; // SPEC-NNN owning the plan
  approvalState: ApprovalState;
}

/** A spec's design.md. */
export interface DesignDocNode {
  specId: string; // SPEC-NNN owning the doc
}

/** A spec's tasks.md. */
export interface TasksDocNode {
  specId: string; // SPEC-NNN owning the doc
}

/** A single constitution invariant. */
export interface ConstitutionInvariantNode {
  index: number; // 1-based position in the constitution's invariants list
}

/** A decision record (DR-NNN). */
export interface DrNode {
  id: string; // DR-NNN
  status: AdrStatus;
}

/** A pull request awaiting review. */
export interface PrNode {
  number: number;
  state: 'open' | 'merged' | 'closed';
}

/** A tracked issue. */
export interface IssueNode {
  number: number;
  state: 'open' | 'closed';
}

export type Approvable =
  | SpecNode
  | PlanNode
  | DesignDocNode
  | TasksDocNode
  | DrNode
  | ConstitutionInvariantNode
  | EpicNode
  | IssueNode
  | PrNode;
