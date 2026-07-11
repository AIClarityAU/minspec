/**
 * #626 — body↔frontmatter status parity (the #362 backfill's dominant defect class).
 * The check must catch clear recognised-word disagreements while NEVER false-positiving
 * on free-form status prose (a false validator error blocks a legitimate commit).
 */
import { describe, it, expect } from 'vitest';
import {
  checkStatusParity,
  bodyStatusToken,
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
