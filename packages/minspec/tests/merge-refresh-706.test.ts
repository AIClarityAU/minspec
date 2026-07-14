/**
 * T3 regression — #706 (P1 data-loss): the harness refresh destroyed a populated,
 * hand-authored constitution `## Goals` section, replacing it with the template's
 * empty `<!-- Add goals here -->` placeholder.
 *
 * Root cause: mergeFile() takes the template's version of a section whenever the
 * baseline hash is absent (`!oldHash`) OR equals the current hash — and the
 * constitution template's content sections are empty placeholders. So populated
 * human content got overwritten by an empty section, in two ways: (A) no recorded
 * baseline hash for the section, and (B) seedConstitution having re-hashed the
 * whole merged constitution, laundering the human content into the baseline so
 * `existingHash === oldHash`.
 *
 * Fix: mergeFile never replaces a section that has real content with an
 * effectively-empty (comments/whitespace only) template section (INV-2).
 */
import { describe, it, expect } from 'vitest';
import { mergeFile, parseSections, hashSection } from '../src/lib/merge-refresh';

const POPULATED = [
  '# Demo — Constitution',
  '',
  '## Goals',
  '',
  '1. **G-1 — Measured savings.** Real hand-authored goal with detail.',
  '2. **G-2 — Measurement is the moat.** Another goal.',
  '',
].join('\n');

// The constitution template ships Goals as an empty placeholder.
const TEMPLATE_EMPTY_GOALS = [
  '# Demo — Constitution',
  '',
  '## Goals',
  '',
  '<!-- Add goals here. Example: -->',
  '<!-- 1. Ship a frictionless SDD experience -->',
  '',
].join('\n');

function goalsBodyHash(doc: string): string {
  const g = parseSections(doc).find((s) => s.heading === 'Goals')!;
  return hashSection(g.body);
}

describe('#706 — mergeFile never overwrites populated content with an empty template section', () => {
  it('Case A: no baseline hash for Goals → preserves the populated Goals', () => {
    const { merged } = mergeFile(POPULATED, TEMPLATE_EMPTY_GOALS, {});
    expect(merged).toContain('G-1 — Measured savings');
    expect(merged).toContain('G-2 — Measurement is the moat');
    expect(merged).not.toContain('Add goals here');
  });

  it('Case B: baseline hash equals the populated content (seed laundering) → still preserves', () => {
    const oldHashes = { Goals: goalsBodyHash(POPULATED) };
    const { merged } = mergeFile(POPULATED, TEMPLATE_EMPTY_GOALS, oldHashes);
    expect(merged).toContain('G-1 — Measured savings');
    expect(merged).not.toContain('Add goals here');
  });

  it('an empty existing section is still populated from a non-empty template (no over-preserve)', () => {
    const emptyExisting = '# Demo — Constitution\n\n## Goals\n\n<!-- Add goals here. Example: -->\n';
    const withContent = '# Demo — Constitution\n\n## Goals\n\n1. Seeded goal.\n';
    const { merged } = mergeFile(emptyExisting, withContent, {});
    expect(merged).toContain('Seeded goal.');
  });

  it('regression guard: a normal unmodified harness section still updates to new template content', () => {
    const existing = '# X\n\n## Overview\n\nold overview text\n';
    const generated = '# X\n\n## Overview\n\nNEW overview text from template\n';
    const overviewHash = hashSection(parseSections(existing).find((s) => s.heading === 'Overview')!.body);
    const { merged } = mergeFile(existing, generated, { Overview: overviewHash });
    expect(merged).toContain('NEW overview text from template');
    expect(merged).not.toContain('old overview text');
  });
});
