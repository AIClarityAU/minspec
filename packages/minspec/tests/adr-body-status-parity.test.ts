/**
 * T3 — accepting a DR must reconcile ALL the places its status lives (#1624).
 *
 * Bug: a DR's status lives in three places — frontmatter `status:`, the body's
 * `## Status` section, and the INDEX entry. `setAdrStatus` rewrote only the
 * frontmatter, and `applyStatus` regenerated only the INDEX. The body was never
 * touched, so every acceptance left the file asserting two different statuses at
 * once. The #626 parity rule then failed — correctly, but only AFTER the accept
 * had landed, and because the accept path writes to `main` directly (DR-051), it
 * landed there. That took main red for four consecutive ci.yml runs on
 * 2026-08-19 and blocked every open PR.
 *
 * Conservative by design: only a RECOGNISED status word is rewritten. Prose we
 * do not understand is left alone for the validator to flag, because silently
 * mangling a hand-authored rationale is worse than a caught parity error.
 */
import { describe, it, expect } from 'vitest';
import { reconcileBodyStatus } from '../src/lib/adr-manager';

const doc = (bodyStatus: string) =>
  `---\nid: DR-999\nstatus: proposed\n---\n\n# DR-999: Thing\n\n## Status\n\n${bodyStatus}\n\n## Context\n\nUnrelated **Proposed** word that must not be touched.\n`;

describe('#1624 — reconcileBodyStatus keeps the body in step with the frontmatter', () => {
  it('THE #1624 CASE: rewrites the bold status token on accept', () => {
    const out = reconcileBodyStatus(doc('**Proposed.** The decision was made by the founder.'), 'accepted');
    expect(out).toContain('**Accepted.** The decision was made by the founder.');
    expect(out).not.toContain('**Proposed.**');
  });

  it('preserves the surrounding prose verbatim', () => {
    const out = reconcileBodyStatus(doc('**Proposed.** Pending *MinSpec: Accept ADR*.'), 'accepted');
    expect(out).toContain('Pending *MinSpec: Accept ADR*.');
  });

  it('handles a token with no trailing period', () => {
    expect(reconcileBodyStatus(doc('**Proposed** — awaiting sign-off.'), 'accepted'))
      .toContain('**Accepted** — awaiting sign-off.');
  });

  it('only touches the FIRST token inside ## Status, never later sections', () => {
    const out = reconcileBodyStatus(doc('**Proposed.** Body.'), 'accepted');
    // The word in ## Context must survive untouched — a global replace would eat it.
    expect(out).toContain('Unrelated **Proposed** word that must not be touched.');
  });

  it('is a no-op when the DR has no ## Status section (60 of 86 DRs)', () => {
    const noSection = `---\nid: DR-998\nstatus: proposed\n---\n\n# DR-998\n\n## Context\n\nText.\n`;
    expect(reconcileBodyStatus(noSection, 'accepted')).toBe(noSection);
  });

  it('leaves UNRECOGNISED prose alone rather than mangling it', () => {
    // No known status word to anchor on → return unchanged and let the parity
    // validator flag it. Guessing here would corrupt hand-authored rationale.
    const odd = doc('This DR is in an unusual state described at length.');
    expect(reconcileBodyStatus(odd, 'accepted')).toBe(odd);
  });

  it('round-trips every status value', () => {
    for (const s of ['proposed', 'accepted', 'deprecated', 'superseded'] as const) {
      const cap = s[0].toUpperCase() + s.slice(1);
      expect(reconcileBodyStatus(doc('**Proposed.** x'), s)).toContain(`**${cap}.** x`);
    }
  });
});
