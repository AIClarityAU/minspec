/**
 * #626 — body↔frontmatter status parity (the #362 backfill's dominant defect class).
 * The check must catch clear recognised-word disagreements while NEVER false-positiving
 * on free-form status prose (a false validator error blocks a legitimate commit).
 */
import { describe, it, expect } from 'vitest';
import {
  inspectAllStatusClaims,
  checkStatusParity,
  bodyStatusToken,
  inspectStatusLine,
} from '../src/lib/status-parity';

const specBody = (statusLine: string) =>
  `---\nid: SPEC-999\nstatus: x\n---\n\n# Title\n\n${statusLine}\n\n## Context\n`;
const drBody = (statusSection: string) =>
  `---\nid: DR-999\nstatus: x\n---\n\n# DR-999\n\n${statusSection}\n`;

describe('checkStatusParity — specs', () => {
  it('flags a clear disagreement (implementing vs Specifying)', () => {
    const f = checkStatusParity(specBody('**Status:** Specifying (SDD Specify phase)'), 'implementing', 'spec');
    expect(f).not.toBeNull();
    expect(f!.frontmatter).toBe('implementing');
    expect(f!.body).toBe('specifying');
  });

  it('passes when the leading word agrees (implementing)', () => {
    expect(checkStatusParity(specBody('**Status:** Implementing (SDD Implement phase)'), 'implementing', 'spec')).toBeNull();
  });

  it('strips an inline frontmatter comment before comparing', () => {
    expect(
      checkStatusParity(specBody('**Status:** Implementing'), 'implementing  # built: foo.ts (40 tests)', 'spec'),
    ).toBeNull();
  });

  it('does NOT false-positive on free-form status prose (unrecognised leading word)', () => {
    expect(checkStatusParity(specBody('**Status:** Clarify complete — awaiting Approve'), 'specifying', 'spec')).toBeNull();
  });

  it('passes when the recognised leading word matches even with trailing nuance prose', () => {
    expect(
      checkStatusParity(specBody('**Status:** Specifying (derived — INV-1: unapproved ⇒ specifying)'), 'specifying', 'spec'),
    ).toBeNull();
  });

  it('null when there is no body status line', () => {
    expect(checkStatusParity(specBody('Some intro without a status line.'), 'implementing', 'spec')).toBeNull();
  });
});

describe('checkStatusParity — DRs', () => {
  it('flags accepted vs a ## Status body of "Proposed."', () => {
    const f = checkStatusParity(drBody('## Status\n\nProposed. Implements DR-008 Layer 2.'), 'accepted', 'dr');
    expect(f).not.toBeNull();
    expect(f!.body).toBe('proposed');
    expect(f!.frontmatter).toBe('accepted');
  });

  it('passes when the ## Status body word agrees', () => {
    expect(checkStatusParity(drBody('## Status\n\nAccepted (2026-06-01).'), 'accepted', 'dr')).toBeNull();
  });

  it('uses DR vocabulary — "specifying" is not a DR status word, so it never false-flags', () => {
    // A spec word appearing in a DR body must not be treated as a recognised DR status.
    expect(checkStatusParity(drBody('## Status\n\nSpecifying something unrelated.'), 'accepted', 'dr')).toBeNull();
  });

  it('null when there is no ## Status section', () => {
    expect(checkStatusParity(drBody('## Context\n\nNo status heading here.'), 'accepted', 'dr')).toBeNull();
  });
});

describe('edge cases', () => {
  it('null on empty frontmatter status', () => {
    expect(checkStatusParity(specBody('**Status:** Specifying (SDD Specify phase)'), '', 'spec')).toBeNull();
    expect(checkStatusParity(specBody('**Status:** Specifying (SDD Specify phase)'), undefined, 'spec')).toBeNull();
  });

  it('bodyStatusToken reports the 1-based line of the status line', () => {
    const tok = bodyStatusToken(specBody('**Status:** Implementing (SDD Implement phase)'), 'spec');
    expect(tok?.token).toBe('implementing');
    expect(tok?.line).toBe(8); // ---,id,status,---,blank,# Title,blank,**Status:** => line 8
  });
});

/**
 * T3 regression (#968) — the DR arm matched `/^([A-Za-z]+)/` on the first non-empty line
 * after `## Status`, so a BOLD line ("**Proposed**, …") started with `*`, failed the match,
 * and returned null — which `checkStatusParity` reads as "not comparable" = pass.
 *
 * Measured when filed: 22 DRs carried a body `## Status`, 2 were bolded, and those same 2
 * were the register's ONLY genuine mismatches. The gate raised 0 findings — it missed 2/2
 * real defects while correctly clearing the 20 unbolded ones. The pre-existing DR tests
 * above all use unbolded bodies, which is why nothing ever caught it.
 *
 * These cases are the verbatim live shapes from DR-068 and DR-053.
 */
describe('checkStatusParity — DRs with emphasised status words (#968)', () => {
  it('flags DR-068\'s live shape: "**Proposed**, 2026-07-21." vs accepted', () => {
    const f = checkStatusParity(
      drBody('## Status\n\n**Proposed**, 2026-07-21. Triggered by session 2026-07-21.'),
      'accepted',
      'dr',
    );
    expect(f).not.toBeNull();
    expect(f!.body).toBe('proposed');
    expect(f!.frontmatter).toBe('accepted');
  });

  it('flags DR-053\'s live shape: "**Proposed** (v2, reworked), 2026-07-12." vs accepted', () => {
    const f = checkStatusParity(
      drBody('## Status\n\n**Proposed** (v2, reworked), 2026-07-12. Nothing applied to the corpus yet.'),
      'accepted',
      'dr',
    );
    expect(f).not.toBeNull();
    expect(f!.body).toBe('proposed');
  });

  it('does NOT over-fire when the bolded word agrees (the post-fix shape)', () => {
    expect(
      checkStatusParity(
        drBody('## Status\n\n**Accepted**, 2026-07-26 (proposed 2026-07-21). Triggered by…'),
        'accepted',
        'dr',
      ),
    ).toBeNull();
  });

  it('handles underscore and single-asterisk emphasis too', () => {
    expect(checkStatusParity(drBody('## Status\n\n__Proposed__, 2026-07-21.'), 'accepted', 'dr')?.body).toBe(
      'proposed',
    );
    expect(checkStatusParity(drBody('## Status\n\n*Proposed*, 2026-07-21.'), 'accepted', 'dr')?.body).toBe(
      'proposed',
    );
  });

  it('still refuses to false-positive on EMPHASISED free-form prose', () => {
    // Stripping emphasis must not widen what counts as a status word — "Clarify" is not
    // in the DR vocabulary, so this stays a non-finding.
    expect(
      checkStatusParity(drBody('## Status\n\n**Clarify complete** — awaiting Accept.'), 'accepted', 'dr'),
    ).toBeNull();
  });

  it('reports the correct 1-based line for a bolded DR status line', () => {
    // ---,id,status,---,blank,# DR-999,blank,## Status,blank,**Proposed** => line 10
    const tok = bodyStatusToken(drBody('## Status\n\n**Proposed**, 2026-07-21.'), 'dr');
    expect(tok?.token).toBe('proposed');
    expect(tok?.line).toBe(10);
  });
});

/**
 * #968 second half — `null` was overloaded: it meant BOTH "consistent / nothing to compare"
 * AND "this line defeated the parser". That is what let the bold hole hide for weeks, and a
 * regex fix alone would leave the next unrecognised shape equally silent. `inspectStatusLine`
 * distinguishes the cases so the validator can make "I could not read this" VISIBLE.
 */
describe('inspectStatusLine — non-comparable cases are distinguishable (#968)', () => {
  it('comparable: a recognised token (bolded or bare)', () => {
    expect(inspectStatusLine(drBody('## Status\n\n**Accepted**, 2026-07-26.'), 'dr')).toMatchObject({
      kind: 'comparable',
      token: 'accepted',
    });
    expect(inspectStatusLine(drBody('## Status\n\nAccepted (2026-06-01).'), 'dr')).toMatchObject({
      kind: 'comparable',
      token: 'accepted',
    });
  });

  it('absent: no status line at all', () => {
    expect(inspectStatusLine(drBody('## Context\n\nNo status heading here.'), 'dr')).toEqual({ kind: 'absent' });
    expect(inspectStatusLine(specBody('Some intro without a status line.'), 'spec')).toEqual({ kind: 'absent' });
  });

  it('freeform: a readable word that is not in the vocabulary — legitimate, low-noise', () => {
    expect(inspectStatusLine(drBody('## Status\n\nClarify complete — awaiting Accept.'), 'dr')).toMatchObject({
      kind: 'freeform',
      token: 'clarify',
    });
  });

  it('unparseable: a status line whose leading token cannot be read at all', () => {
    // This is the dangerous class the bold bug belonged to. It must be loud, not silent.
    const r = inspectStatusLine(drBody('## Status\n\n2026-07-14 — accepted by the maintainer.'), 'dr');
    expect(r.kind).toBe('unparseable');
    const emoji = inspectStatusLine(drBody('## Status\n\n✅ Accepted, 2026-07-14.'), 'dr');
    expect(emoji.kind).toBe('unparseable');
  });

  it('an empty ## Status section is absent, not unparseable', () => {
    expect(inspectStatusLine(drBody('## Status\n'), 'dr')).toEqual({ kind: 'absent' });
  });
});

/**
 * T0 — #1223: a DR can assert its status in TWO places, and they can disagree.
 *
 * DR-022 had THREE representations: frontmatter `accepted`, a `## Status` section
 * `accepted`, and a head blockquote `proposed` — on a T4 decision about the ceremony
 * model. `checkStatusParity` compares ONE body claim (the section), so it compared the two
 * that agreed and never saw the third. It hid for two months.
 *
 * The first attempt at this fix added a blockquote fallback that only fires when there is
 * NO `## Status` section — which does not help, because DR-022 HAS one. It looked correct
 * only because the "proof" ran against a fabricated input with the section stripped. The
 * real file returns `comparable: accepted`, verified.
 *
 * So the property is: compare EVERY comparable claim against frontmatter, and reject any
 * that disagrees. A document showing two different statuses is a false signpost whichever
 * one is read first.
 */

describe('inspectStatusLine — DR head-blockquote status (#1223)', () => {
  const dr = (body: string): string => `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999: X\n\n${body}\n`;

  it('reads a blockquote status assertion when there is no ## Status section', () => {
    const r = inspectStatusLine(dr('> **Status: proposed — scope-split by DR-024.** More prose.'), 'dr');
    expect(r).toMatchObject({ kind: 'comparable', token: 'proposed' });
  });

  it.each([
    '> **Status: proposed** — because reasons',
    '> Status: proposed',
    '> __Status: proposed__ trailing',
    '>   **Status:   proposed**',
    '> **status: PROPOSED**',
  ])('tolerates emphasis, spacing and case: %s', (line) => {
    const r = inspectStatusLine(dr(line), 'dr');
    expect(r).toMatchObject({ kind: 'comparable', token: 'proposed' });
  });

  it('the ## Status section still WINS when both are present', () => {
    // Order matters: the section is the canonical location, so a file with both is
    // compared on the section. The blockquote is a fallback, not an override.
    const body = '> **Status: proposed** caveat\n\n## Status\n\nAccepted (2026-01-01).';
    expect(inspectStatusLine(dr(body), 'dr')).toMatchObject({ kind: 'comparable', token: 'accepted' });
  });

  // ── The widening must not create false FATALs ────────────────────────────
  it('a blockquote that is not a status assertion is ignored', () => {
    for (const line of [
      '> **Note:** this supersedes DR-020.',
      '> Born `proposed` per DR-029 — acceptance is a separate human act.',
      '> The status of the analyzers is unresolved.',
      '> **Statuses:** several.',
    ]) {
      expect(inspectStatusLine(dr(line), 'dr'), line).toMatchObject({ kind: 'absent' });
    }
  });

  it('a blockquote whose status word is unrecognised reads FREEFORM, never a mismatch', () => {
    // The recognised-word guard is unchanged: widening what can be READ must never
    // widen what counts as a status, or prose becomes a build failure.
    const r = inspectStatusLine(dr('> **Status: clarifying-ish, pending #91**'), 'dr');
    expect(r.kind).toBe('freeform');
  });

  it('still returns absent when a DR has no status assertion at all', () => {
    expect(inspectStatusLine(dr('Just prose, no status anywhere.'), 'dr')).toMatchObject({ kind: 'absent' });
  });

  it('specs are unaffected by the DR fallback', () => {
    const spec = `---\nid: SPEC-999\n---\n\n> **Status: proposed** caveat\n`;
    expect(inspectStatusLine(spec, 'spec')).toMatchObject({ kind: 'absent' });
  });
});

describe('inspectAllStatusClaims — every claim, not just the first (#1223)', () => {
  const dr = (body: string, status = 'accepted'): string =>
    `---\nid: DR-999\nstatus: ${status}\n---\n\n# DR-999: X\n\n${body}\n`;

  it('returns BOTH the head blockquote and the ## Status section when both exist', () => {
    // The exact DR-022 shape. `inspectStatusLine` sees only the section.
    const body = '> **Status: proposed — scope-split by DR-024.**\n\n## Context\n\nstuff\n\n## Status\n\nAccepted (2026-07-25).';
    const claims = inspectAllStatusClaims(dr(body), 'dr');
    const tokens = claims.filter((c) => c.kind === 'comparable').map((c: any) => c.token).sort();
    expect(tokens).toEqual(['accepted', 'proposed']);
  });

  it('the singular inspector still sees only ONE — which is why the plural exists', () => {
    const body = '> **Status: proposed**\n\n## Status\n\nAccepted (2026-07-25).';
    expect(inspectStatusLine(dr(body), 'dr')).toMatchObject({ kind: 'comparable', token: 'accepted' });
  });

  it('does not double-count when the blockquote IS the only claim', () => {
    // With no `## Status`, inspectStatusLine already returns the blockquote; adding it
    // again would make a caller tallying findings report the same defect twice.
    const claims = inspectAllStatusClaims(dr('> **Status: proposed** caveat'), 'dr');
    expect(claims).toHaveLength(1);
  });

  it('returns [] when a DR asserts no status anywhere', () => {
    expect(inspectAllStatusClaims(dr('Just prose.'), 'dr')).toEqual([]);
  });

  it('specs are unaffected — the blockquote scan is DR-only', () => {
    const spec = `---\nid: SPEC-9\n---\n\n> **Status: proposed**\n\n**Status:** implementing\n`;
    const claims = inspectAllStatusClaims(spec, 'spec');
    expect(claims.every((c) => c.kind !== 'comparable' || (c as any).token === 'implementing')).toBe(true);
  });

  it('a free-form second claim is never a mismatch', () => {
    // Widening what can be READ must never widen what counts as a status, or prose
    // becomes a build failure.
    const body = '> **Status: clarifying-ish, pending #91**\n\n## Status\n\nAccepted (2026-01-01).';
    const claims = inspectAllStatusClaims(dr(body), 'dr');
    expect(claims.filter((c) => c.kind === 'comparable')).toHaveLength(1);
  });
});
