/**
 * T0 — DR amendment follow-through (#1145)
 *
 * Tests `validateDrAmendments()`: an offline, Tier-0 scan reporting ACCEPTED decisions
 * that claim to amend or supersede another decision whose target says nothing about it.
 *
 * THE GAP: a DR saying "this amends DR-NNN" has no mechanism to make that happen.
 * `acceptAdrCommand` sets the target DR's own status and regenerates INDEX.md — it never
 * opens a second file, so the amendment lives entirely in a human remembering a sentence.
 *
 * Measured over the real corpus on 2026-08-05, THREE accepted DRs had claimed amendments
 * their targets had never heard of. One was load-bearing: DR-070 §3 read "there is no
 * second admission lane" while two shipped front ends were a second authorising party.
 * An accepted DR is authoritative, so a stale one does not merely go out of date — it
 * misinforms.
 *
 * Two properties matter as much as the detection itself, and both are pinned below:
 *   • `proposed` sources must stay SILENT — a pending amendment is what proposed means,
 *     and flagging it would train the reader to ignore the rule; and
 *   • acknowledgement is loose ON PURPOSE (the target need only mention the source id).
 *     The rule proves a link was made, never that the prose is right — claiming otherwise
 *     would be the false-signpost defect it exists to prevent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { validateDrAmendments, type DrAmendmentGap } from '../src/lib/adr-manager';

describe('validateDrAmendments()', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-dramend-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write a DR file. `body` is appended after the frontmatter. */
  function dr(id: string, status: 'accepted' | 'proposed' | 'superseded', body = ''): void {
    fs.writeFileSync(
      path.join(dir, `${id}.md`),
      `---\nid: ${id}\nstatus: ${status}\ndate: 2026-08-05\ntitle: ${id}\n---\n\n# ${id}\n\n${body}\n`,
    );
  }
  const run = (): DrAmendmentGap[] => validateDrAmendments(dir);

  // ── Detection ─────────────────────────────────────────────────────────────
  it('flags an accepted DR whose target never mentions it', () => {
    dr('DR-001', 'accepted', 'The original decision.');
    dr('DR-002', 'accepted', 'This **amends DR-001** in an important way.');
    const gaps = run();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ source: 'DR-002', target: 'DR-001', relation: 'amends' });
  });

  it.each(['amends', 'supersedes', 'Amendment to', 'SUPERSEDES', 'AmEnDs'])(
    'recognises the verb %s, case-insensitively',
    (verb) => {
      dr('DR-001', 'accepted', 'Original.');
      dr('DR-002', 'accepted', `This ${verb} DR-001.`);
      expect(run()).toHaveLength(1);
    },
  );

  it('the message names both DRs and says what to do about it', () => {
    dr('DR-001', 'accepted', 'Original.');
    dr('DR-002', 'accepted', 'Supersedes DR-001.');
    const [gap] = run();
    expect(gap.message).toContain('DR-002');
    expect(gap.message).toContain('DR-001');
    expect(gap.message).toMatch(/Amended by/);     // the suggested remedy
    expect(gap.message).toMatch(/reword/);         // …and the honest alternative
  });

  // ── Silence, where silence is correct ─────────────────────────────────────
  it('stays silent when the target DOES mention the source', () => {
    dr('DR-001', 'accepted', 'Original. > Amended by DR-002, see there.');
    dr('DR-002', 'accepted', 'This amends DR-001.');
    expect(run()).toEqual([]);
  });

  it('stays silent for a PROPOSED source — a pending amendment is what proposed means', () => {
    dr('DR-001', 'accepted', 'Original, and it does not mention its amender.');
    dr('DR-002', 'proposed', 'This amends DR-001.');
    expect(run()).toEqual([]);
  });

  it('stays silent for a superseded source', () => {
    dr('DR-001', 'accepted', 'Original.');
    dr('DR-002', 'superseded', 'This amends DR-001.');
    expect(run()).toEqual([]);
  });

  it('stays silent when the target file does not exist — Rule 9 owns dangling refs', () => {
    dr('DR-002', 'accepted', 'This amends DR-999, which is not in this register.');
    expect(run()).toEqual([]);
  });

  it('ignores a self-reference', () => {
    dr('DR-002', 'accepted', 'DR-002 amends DR-002 — nonsense, but must not report.');
    expect(run()).toEqual([]);
  });

  it('does not fire on prose that merely MENTIONS another DR', () => {
    dr('DR-001', 'accepted', 'Original.');
    dr('DR-002', 'accepted', 'See DR-001 for background. Related to DR-001. Cf. DR-001.');
    expect(run()).toEqual([]);
  });

  // ── Shape ─────────────────────────────────────────────────────────────────
  it('reports one gap per pair, however many times the claim is repeated', () => {
    dr('DR-001', 'accepted', 'Original.');
    dr('DR-002', 'accepted', 'amends DR-001 … and later, again: supersedes DR-001.');
    expect(run()).toHaveLength(1);
  });

  it('reports each distinct target separately', () => {
    dr('DR-001', 'accepted', 'A.');
    dr('DR-002', 'accepted', 'B.');
    dr('DR-003', 'accepted', 'This amends DR-001 and supersedes DR-002.');
    expect(run().map((g) => g.target).sort()).toEqual(['DR-001', 'DR-002']);
  });

  it('is deterministic — same input, same order', () => {
    dr('DR-001', 'accepted', 'A.');
    dr('DR-002', 'accepted', 'B.');
    dr('DR-003', 'accepted', 'amends DR-002');
    dr('DR-004', 'accepted', 'amends DR-001');
    expect(run().map((g) => `${g.source}->${g.target}`)).toEqual(run().map((g) => `${g.source}->${g.target}`));
  });

  it('returns [] for an empty or absent directory rather than throwing', () => {
    expect(run()).toEqual([]);
    expect(validateDrAmendments(path.join(dir, 'nope'))).toEqual([]);
  });

  it('ignores non-DR files in the directory', () => {
    dr('DR-001', 'accepted', 'Original.');
    fs.writeFileSync(path.join(dir, 'INDEX.md'), 'DR-999 amends DR-001');
    fs.writeFileSync(path.join(dir, 'README.md'), 'supersedes DR-001');
    expect(run()).toEqual([]);
  });

  // ── The honest limit, stated as a test so nobody mistakes it for more ─────
  it('proves only that a LINK exists, never that the amended prose is correct', () => {
    // The target mentions the source in passing and says nothing about the change.
    // The rule accepts this. That is deliberate: it can enforce follow-through, not
    // comprehension, and a check that claimed otherwise would be a false signpost.
    dr('DR-001', 'accepted', 'Original. (Unrelated aside: DR-002 exists.)');
    dr('DR-002', 'accepted', 'This supersedes DR-001 entirely.');
    expect(run()).toEqual([]);
  });
});
