import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildSeedProposal,
  integrateProposal,
  type Proposal,
} from '../src/lib/constitution-proposer';
import type { ContextManifest } from '../src/lib/constitution-context';

/** The five new Tier-0 lib modules SPEC-025 adds. */
const TIER0_MODULES = [
  'constitution-context.ts',
  'constitution-proposer.ts',
  'constitution-prompt.ts',
  'constitution-compaction.ts',
  'constitution-nudge.ts',
];

const LIB_DIR = path.resolve(__dirname, '../src/lib');

function manifest(): ContextManifest {
  return {
    signals: [
      {
        id: 'no-network-deps',
        kind: 'no-network-deps',
        summary: 'No network deps.',
        evidence: 'none found',
        section: 'Invariants',
      },
      {
        id: 'tier0-package:@aiclarity/shared',
        kind: 'tier0-package',
        summary: 'Tier-0 package.',
        evidence: 'vscode-free',
        section: 'Constraints',
      },
    ],
    isMonorepo: true,
    tier0Packages: ['@aiclarity/shared'],
    hasNetworkDeps: false,
    proseDocs: { claudeMd: false, decisions: 0, epics: 0 },
  };
}

describe('INV-1 — Tier-0 purity (source scan)', () => {
  it('no new lib module imports vscode or touches network/exec', () => {
    const violations: string[] = [];
    // Forbidden runtime hooks. We scan source text; type-only imports of these
    // names do not appear here because none are referenced as types.
    const forbidden: RegExp[] = [
      /from\s+['"]vscode['"]/,
      /require\(\s*['"]vscode['"]\s*\)/,
      /\bfetch\s*\(/,
      /from\s+['"](?:node:)?https?['"]/,
      /require\(\s*['"](?:node:)?https?['"]\s*\)/,
      /from\s+['"](?:node:)?net['"]/,
      /from\s+['"](?:node:)?child_process['"]/,
      /require\(\s*['"](?:node:)?child_process['"]\s*\)/,
      /\b(?:exec|execSync|spawn|spawnSync|execFile)\s*\(/,
    ];
    for (const mod of TIER0_MODULES) {
      const full = path.join(LIB_DIR, mod);
      expect(fs.existsSync(full), `${mod} must exist`).toBe(true);
      const src = fs.readFileSync(full, 'utf-8');
      for (const re of forbidden) {
        if (re.test(src)) violations.push(`${mod}: ${re}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('INV-2 — non-overwrite / additive / idempotent', () => {
  it('non-overwrite: a human Invariant item is byte-preserved and untouched', () => {
    const human = `# proj — Constitution

## Invariants

1. A HUMAN invariant — preserve me exactly, byte for byte.

## Constraints

<!-- empty -->
`;
    const { merged } = integrateProposal(human, buildSeedProposal(manifest()));
    expect(merged).toContain('1. A HUMAN invariant — preserve me exactly, byte for byte.');
    const invSection = merged.split('## Constraints')[0];
    expect(invSection).not.toMatch(/DRAFT:/);
  });

  it('idempotent: re-integrating the same proposal adds zero new candidates', () => {
    const proposal = buildSeedProposal(manifest());
    const first = integrateProposal('## Invariants\n\n<!-- empty -->\n', proposal);
    const second = integrateProposal(first.merged, proposal);
    expect(second.added.length).toBe(0);
    expect(second.merged).toBe(first.merged);
  });

  it('additive: human Invariants + empty Constraints → only Constraints gains DRAFT', () => {
    const doc = `## Invariants

1. Human rule.

## Constraints

<!-- empty -->

## Principles

<!-- empty -->
`;
    const { merged } = integrateProposal(doc, buildSeedProposal(manifest()));
    const invSection = merged.split('## Constraints')[0];
    const constraintsSection = (merged.split('## Constraints')[1] ?? '').split('## Principles')[0];
    expect(invSection).not.toMatch(/DRAFT:/); // Invariants untouched
    expect(constraintsSection).toMatch(/DRAFT:/); // Constraints seeded
  });
});

describe('INV-4 — degrade, never block', () => {
  it('buildSeedProposal returns >=1 candidate for any non-empty manifest', () => {
    const proposal: Proposal = buildSeedProposal(manifest());
    expect(proposal.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('integrate never yields an empty constitution', () => {
    const { merged } = integrateProposal('', buildSeedProposal(manifest()));
    expect(merged.trim().length).toBeGreaterThan(0);
    expect(merged).toMatch(/DRAFT:/);
  });
});
