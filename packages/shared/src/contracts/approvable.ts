/**
 * Approvable — DR-041's collective term for artifacts that carry a human
 * approval gate: Spec, DR, PR, Epic, Issue (#325).
 *
 * Type-only (Tier 0: no vscode, no network). Spec and Epic reuse the existing
 * graph node shapes from `next-task`; DR, PR and Issue had no contract
 * interface, so minimal ones are declared here.
 */
import type { AdrStatus, EpicNode, SpecNode } from '../next-task';

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

export type Approvable = SpecNode | DrNode | PrNode | EpicNode | IssueNode;
