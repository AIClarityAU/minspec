/**
 * T0/T1 — DR Sequence Validation (issue #41)
 *
 * Tests validateDrSequence() in src/lib/adr-manager.ts: a Tier-0, offline
 * scan of the decisions directory that WARNS (never throws) on local
 * DR-NNN sequence anomalies:
 *   - duplicate: the same DR number used by two files
 *   - padding:   an id that is not zero-padded to >= 3 digits
 *
 * Originally triggered by DR-362 being minted while the local register ran to
 * DR-010 (a global-register number leaked into a project-local register). The
 * `gap` kind that caught it was REMOVED in #2051: a number absent from the run
 * is usually an id held by an open pull request, invisible to an offline scan,
 * so the rule fired on correct work. A clean, properly-padded sequence must
 * produce NO warnings, and a discontiguous one must produce none either.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { validateDrSequence, type DrSequenceWarning } from '../src/lib/adr-manager';

describe('validateDrSequence()', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-drseq-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write an empty DR file with the given file name. */
  function dr(fileName: string): void {
    fs.writeFileSync(path.join(dir, fileName), '---\nid: x\n---\n', 'utf-8');
  }

  function kinds(warnings: DrSequenceWarning[]): string[] {
    return warnings.map(w => w.kind);
  }

  // ─── No-warning cases ───────────────────────────────────────────────────

  it('a clean contiguous sequence produces NO warnings', () => {
    dr('DR-001-alpha.md');
    dr('DR-002-beta.md');
    dr('DR-003-gamma.md');
    expect(validateDrSequence(dir)).toEqual([]);
  });

  it('a single DR produces NO warnings', () => {
    dr('DR-001-only.md');
    expect(validateDrSequence(dir)).toEqual([]);
  });

  it('an empty decisions directory produces NO warnings', () => {
    expect(validateDrSequence(dir)).toEqual([]);
  });

  it('a non-existent decisions directory produces NO warnings', () => {
    expect(validateDrSequence(path.join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('non-DR files (INDEX.md, README.md, notes) are ignored', () => {
    dr('DR-001-alpha.md');
    dr('DR-002-beta.md');
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# index\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'README.md'), '# readme\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'notes\n', 'utf-8');
    expect(validateDrSequence(dir)).toEqual([]);
  });

  // ─── A missing number is NOT an anomaly (T3, #2051) ──────────────────────
  //
  // These pin the REMOVAL of the former `gap` rule. It reported every number
  // absent from the contiguous 1..max run and told the reader to "renumber the
  // out-of-sequence DR to close the gap". Under worktree-per-session (#168) the
  // neighbouring ids are routinely held by OPEN PULL REQUESTS, which a local
  // directory scan cannot see, so the rule fired on correct work. A Tier-0
  // offline validator must only assert about ids in front of it.

  it('a missing intermediate number produces NO warning', () => {
    dr('DR-001-alpha.md');
    dr('DR-002-beta.md');
    dr('DR-005-eta.md'); // 003 + 004 absent — may be claimed by open PRs
    expect(validateDrSequence(dir)).toEqual([]);
  });

  it('the real #1956 shape — an id above the highest on disk — is silent', () => {
    // Measured on the SPEC-034 broker branch: DR-091 on main, DR-094 added,
    // DR-092 held by #1835 and DR-093 by #1866. The old rule emitted two false
    // "Renumber the out-of-sequence DR" warnings here. Both ids were correct.
    dr('DR-091-ninety-one.md');
    dr('DR-094-ninety-four.md');
    expect(validateDrSequence(dir)).toEqual([]);
  });

  it('no warning kind is ever the string "gap"', () => {
    // Property, not instance: whatever the input, `gap` is no longer emitted.
    dr('DR-001-alpha.md');
    dr('DR-010-ten.md');
    dr('DR-362-leaked-global-number.md');
    dr('DR-7-underpadded.md');
    dr('DR-010-duplicate-of-ten.md');
    const warnings = validateDrSequence(dir);
    expect(kinds(warnings)).not.toContain('gap');
    // Non-vacuity control: the scan DID look and DID find the other kinds, so
    // the assertion above is not passing because nothing was examined.
    expect(warnings.length).toBeGreaterThan(0);
    expect(new Set(kinds(warnings))).toEqual(new Set(['duplicate', 'padding']));
  });

  it('ACCEPTED COST (#2051): a leaked global-register number is no longer detected', () => {
    // DR-362 minted into a register running to DR-010 is exactly the #41 defect
    // this validator was written for, and dropping `gap` gives up catching it
    // offline. Recorded as a test rather than a comment so the loss is visible
    // if anyone later assumes Rule 6 still covers it. The remaining detector is
    // the id-collision gate at PR time, which sees duplicates, not leaks.
    for (let n = 1; n <= 10; n++) {
      dr(`DR-${String(n).padStart(3, '0')}-real.md`);
    }
    dr('DR-362-leaked-global-number.md');
    expect(validateDrSequence(dir)).toEqual([]);
  });

  // ─── Duplicate ──────────────────────────────────────────────────────────

  it('a duplicate number warns (kind: duplicate), naming both files', () => {
    dr('DR-001-alpha.md');
    dr('DR-002-beta.md');
    dr('DR-002-beta-again.md');
    const warnings = validateDrSequence(dir);
    expect(kinds(warnings)).toContain('duplicate');
    const dup = warnings.find(w => w.kind === 'duplicate');
    expect(dup?.number).toBe(2);
    expect(dup?.files.length).toBe(2);
    expect(dup?.files).toContain('DR-002-beta.md');
    expect(dup?.files).toContain('DR-002-beta-again.md');
  });

  // ─── Padding ────────────────────────────────────────────────────────────

  it('an under-padded id warns (kind: padding)', () => {
    dr('DR-1-alpha.md');
    const warnings = validateDrSequence(dir);
    expect(kinds(warnings)).toContain('padding');
    const pad = warnings.find(w => w.kind === 'padding');
    expect(pad?.number).toBe(1);
    expect(pad?.files).toContain('DR-1-alpha.md');
  });

  it('a >=3-digit id is NOT a padding warning', () => {
    dr('DR-100-alpha.md');
    dr('DR-101-beta.md');
    dr('DR-102-gamma.md');
    expect(validateDrSequence(dir).filter(w => w.kind === 'padding')).toEqual([]);
  });

  // ─── Every warning carries a human-readable message ─────────────────────

  it('every warning carries a non-empty message', () => {
    dr('DR-001-alpha.md');
    dr('DR-003-gamma.md');
    dr('DR-003-gamma-dup.md');
    dr('DR-5-short.md');
    const warnings = validateDrSequence(dir);
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) {
      expect(typeof w.message).toBe('string');
      expect(w.message.length).toBeGreaterThan(0);
    }
  });
});
