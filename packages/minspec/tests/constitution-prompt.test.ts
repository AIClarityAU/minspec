import { describe, it, expect } from 'vitest';
import { buildGenerationPrompt } from '../src/lib/constitution-prompt';
import { CONSTITUTION_SECTION_SCHEMA } from '../src/lib/constitution-proposer';
import type { ContextManifest } from '../src/lib/constitution-context';

function manifest(): ContextManifest {
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
        id: 'node-engine',
        kind: 'node-engine',
        summary: 'Pinned Node engine: >=18.',
        evidence: 'engines.node = >=18',
        section: 'Constraints',
      },
    ],
    isMonorepo: false,
    tier0Packages: [],
    hasNetworkDeps: false,
    proseDocs: { claudeMd: false, decisions: 0, epics: 0 },
  };
}

describe('buildGenerationPrompt (FR-2)', () => {
  it('names all four schema sections', () => {
    const prompt = buildGenerationPrompt(manifest(), CONSTITUTION_SECTION_SCHEMA);
    for (const section of CONSTITUTION_SECTION_SCHEMA.sections) {
      expect(prompt).toContain(section);
    }
  });

  it('embeds each manifest signal summary', () => {
    const prompt = buildGenerationPrompt(manifest(), CONSTITUTION_SECTION_SCHEMA);
    for (const sig of manifest().signals) {
      expect(prompt).toContain(sig.summary);
    }
  });

  it('instructs DRAFT marking + per-item provenance + silence>noise', () => {
    const prompt = buildGenerationPrompt(manifest(), CONSTITUTION_SECTION_SCHEMA);
    expect(prompt).toMatch(/DRAFT/);
    expect(prompt).toMatch(/provenance/i);
    expect(prompt).toMatch(/proposed because/);
    expect(prompt).toMatch(/Silence beats noise/i);
    expect(prompt).toMatch(/Notable but unwritten/i);
  });

  it('is deterministic: identical manifest → byte-identical prompt', () => {
    const a = buildGenerationPrompt(manifest(), CONSTITUTION_SECTION_SCHEMA);
    const b = buildGenerationPrompt(manifest(), CONSTITUTION_SECTION_SCHEMA);
    expect(a).toBe(b);
  });
});
