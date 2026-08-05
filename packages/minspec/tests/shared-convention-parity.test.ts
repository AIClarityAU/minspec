/**
 * T0 invariant — a convention that ships to more than one agent-instruction
 * template must be BYTE-IDENTICAL in every one of them.
 *
 * CLAUDE.md, AGENTS.md and .cursorrules are read by three different assistants on
 * the same repo. A rule that says one thing in two of them and something subtly
 * different in the third is worse than no rule: the assistants disagree and the
 * human cannot tell which copy is authoritative. Nothing prevented that drift
 * before this test — the only guard was the author remembering to edit all three,
 * which is precisely the "enforce, don't trust the model" failure the constitution
 * names. Prose cannot hold a three-way invariant; a test can.
 *
 * Adding a shared convention = add its heading to SHARED_CONVENTIONS. The parity,
 * the constitution-exclusion and the "no orphan copy" checks then cover it for free.
 */
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/lib/template-registry';
import { parseSections } from '../src/lib/merge-refresh';

/** The three templates that carry agent-facing conventions. */
const AGENT_TEMPLATES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'] as const;

/**
 * Headings that must appear, identically, in all three. These are communication
 * conventions — how an assistant talks to the human — NOT project invariants, so
 * they are deliberately absent from the constitution template (see below).
 */
const SHARED_CONVENTIONS = [
  'Naming waves, phases, and batches',
  'Human action items — mark them, then repeat them',
] as const;

/** Body of `heading` in `template`, or undefined if the section is absent. */
function sectionBody(template: string, heading: string): string | undefined {
  return parseSections(TEMPLATES[template as keyof typeof TEMPLATES]).find(
    (s) => s.heading === heading,
  )?.body;
}

describe('shared agent conventions are identical across all three templates', () => {
  for (const heading of SHARED_CONVENTIONS) {
    it(`"${heading}" is present and byte-identical in every agent template`, () => {
      const bodies = AGENT_TEMPLATES.map((t) => ({ template: t, body: sectionBody(t, heading) }));
      for (const { template, body } of bodies) {
        expect(body, `"${heading}" missing from ${template}`).toBeDefined();
      }
      const [first, ...rest] = bodies;
      for (const other of rest) {
        expect(other.body, `${other.template} drifted from ${first.template}`).toBe(first.body);
      }
    });

    it(`"${heading}" stays OUT of the constitution template`, () => {
      // The constitution holds invariants/principles/constraints/goals — rules about
      // the PROJECT. How an assistant formats its replies is not one of those, and
      // scaffolding it there would put un-editable boilerplate into a document the
      // human is meant to author.
      expect(sectionBody('constitution.md', heading)).toBeUndefined();
    });
  }

  it('no agent template carries a convention the others have never heard of', () => {
    // Catches the reverse drift: a rule added to ONE template and forgotten in the
    // other two. Only headings the templates share by design are exempt (each file
    // legitimately has its own structural sections, e.g. "File Locations").
    const marker = '➡️';
    const carriers = AGENT_TEMPLATES.filter((t) =>
      TEMPLATES[t as keyof typeof TEMPLATES].includes(marker),
    );
    expect(carriers).toEqual([...AGENT_TEMPLATES]);
  });
});

describe('the action-item marker is unambiguous', () => {
  it('reserves ➡️ for pending human action, using it nowhere else', () => {
    for (const template of AGENT_TEMPLATES) {
      const body = sectionBody(template, 'Human action items — mark them, then repeat them')!;
      const whole = TEMPLATES[template as keyof typeof TEMPLATES];
      const inSection = (body.match(/➡️/g) ?? []).length;
      const inFile = (whole.match(/➡️/g) ?? []).length;
      // Every occurrence in the file belongs to the section that defines the marker.
      // A stray ➡️ elsewhere would make "scan for ➡️" return a false hit — the exact
      // failure the rule forbids.
      expect(inFile, `stray ➡️ outside its own section in ${template}`).toBe(inSection);
      expect(inSection).toBeGreaterThan(0);
    }
  });

  it('states both placements (inline mid-turn AND end-of-turn) and the reply keys', () => {
    for (const template of AGENT_TEMPLATES) {
      const body = sectionBody(template, 'Human action items — mark them, then repeat them')!;
      expect(body).toContain('mid-turn');
      expect(body).toContain('end of every turn');
      expect(body).toMatch(/`m` merge/);
      expect(body).toMatch(/unmerged/);
    }
  });
});
