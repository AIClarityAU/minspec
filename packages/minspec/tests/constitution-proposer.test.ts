import { describe, it, expect } from 'vitest';
import {
  seedProvider,
  buildSeedProposal,
  integrateProposal,
  sectionHasHumanContent,
  CONSTITUTION_SECTION_SCHEMA,
  type Proposal,
} from '../src/lib/constitution-proposer';
import type { ContextManifest } from '../src/lib/constitution-context';

/** A manifest with no network deps + a Tier-0 package + monorepo layout. */
function noNetworkTier0Manifest(): ContextManifest {
  return {
    signals: [
      {
        id: 'no-network-deps',
        kind: 'no-network-deps',
        summary: 'No runtime network-client dependencies detected.',
        evidence: 'no known HTTP/socket client',
        section: 'Invariants',
      },
      {
        id: 'tier0-package:@aiclarity/shared',
        kind: 'tier0-package',
        summary: 'Tier-0 package: @aiclarity/shared.',
        evidence: 'vscode-free workspace member',
        section: 'Constraints',
      },
      {
        id: 'monorepo-layout',
        kind: 'monorepo-layout',
        summary: 'Monorepo layout.',
        evidence: 'packages/ exists',
        section: 'Constraints',
      },
    ],
    packageName: '@aiclarity/minspec-monorepo',
    isMonorepo: true,
    tier0Packages: ['@aiclarity/shared'],
    hasNetworkDeps: false,
    proseDocs: { claudeMd: false, decisions: 0, epics: 0 },
  };
}

const ALL_TEMPLATE = `# proj — Constitution

## Invariants

Rules that must never be violated.

<!-- Add invariants here. Example: -->
<!-- 1. No breaking changes -->

## Principles

Guidelines.

<!-- Add principles here -->

## Constraints

Constraints.

<!-- Add constraints here -->
`;

describe('buildSeedProposal (FR-5)', () => {
  it('returns a DRAFT offline Invariant and a vscode/network-free Constraint candidate', () => {
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    const offline = proposal.candidates.find(
      (c) => c.section === 'Invariants' && /offline|no network/i.test(c.text),
    );
    expect(offline).toBeDefined();
    expect(offline!.draft).toBe(true);

    const shared = proposal.candidates.find(
      (c) =>
        c.section === 'Constraints' &&
        /@aiclarity\/shared/.test(c.text) &&
        /vscode\/network-free|Tier-0/.test(c.text),
    );
    expect(shared).toBeDefined();
  });

  it('NEVER returns zero candidates for a non-empty manifest (INV-4)', () => {
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    expect(proposal.candidates.length).toBeGreaterThan(0);
  });

  it('every candidate carries draft:true and a non-empty provenance (FR-7)', () => {
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    for (const c of proposal.candidates) {
      expect(c.draft).toBe(true);
      expect(typeof c.provenance).toBe('string');
      expect(c.provenance.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('seedProvider (FR-3 seam)', () => {
  it('satisfies ConstitutionProvider — propose() returns a Proposal', () => {
    const result = seedProvider.propose(noNetworkTier0Manifest(), CONSTITUTION_SECTION_SCHEMA);
    expect(result).not.toBeInstanceOf(Promise);
    const proposal = result as Proposal;
    expect(Array.isArray(proposal.candidates)).toBe(true);
    expect(Array.isArray(proposal.notableUnwritten)).toBe(true);
  });
});

describe('integrateProposal (FR-4)', () => {
  it('writes DRAFT entries into empty sections and injects ## Goals when absent', () => {
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    const { merged } = integrateProposal(ALL_TEMPLATE, proposal);

    expect(merged).toMatch(/## Goals/);
    // DRAFT marker present in the merged doc
    expect(merged).toMatch(/- DRAFT:/);
    // offline invariant landed under Invariants
    const invSection = merged.split('## Principles')[0];
    expect(invSection).toMatch(/DRAFT:.*(offline|no network)/i);
  });

  it('is idempotent: running twice adds nothing the second time', () => {
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    const first = integrateProposal(ALL_TEMPLATE, proposal);
    expect(first.added.length).toBeGreaterThan(0);

    const second = integrateProposal(first.merged, proposal);
    expect(second.added.length).toBe(0);
    expect(second.skipped.length).toBe(proposal.candidates.length);
    expect(second.merged).toBe(first.merged);
  });

  it('never touches a section that already holds human (non-DRAFT) content', () => {
    const human = `## Invariants

1. Humans wrote this invariant and it must be preserved exactly.

## Constraints

<!-- empty -->
`;
    const proposal = buildSeedProposal(noNetworkTier0Manifest());
    const { merged } = integrateProposal(human, proposal);

    // human invariant text preserved verbatim
    expect(merged).toContain('Humans wrote this invariant and it must be preserved exactly.');
    // no DRAFT invariant was injected into the human-authored Invariants section
    const invSection = merged.split('## Constraints')[0];
    expect(invSection).not.toMatch(/DRAFT:/);
    // but Constraints (empty) did gain DRAFT entries
    const constraintsSection = merged.split('## Constraints')[1] ?? '';
    expect(constraintsSection).toMatch(/DRAFT:/);
  });
});

describe('sectionHasHumanContent', () => {
  it('false for comment-only / DRAFT-only / empty bodies', () => {
    expect(sectionHasHumanContent('\n<!-- placeholder -->\n')).toBe(false);
    expect(sectionHasHumanContent('\n')).toBe(false);
    expect(
      sectionHasHumanContent('\n- DRAFT: a draft\n  > _proposed because x_\n'),
    ).toBe(false);
  });

  it('true when a non-DRAFT list item (a human rule) is present', () => {
    expect(sectionHasHumanContent('\n1. A human rule\n')).toBe(true);
    expect(sectionHasHumanContent('\n- A human rule\n')).toBe(true);
  });

  it('false for a descriptive prose paragraph (template scaffolding, not a rule)', () => {
    expect(sectionHasHumanContent('\nRules that must never be violated.\n')).toBe(false);
  });
});
