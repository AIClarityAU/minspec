import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseSpec,
  setSpecPhases,
  advanceSpecToImplementing,
} from '../src/lib/spec';
import { phasesForApproval, getSpecStatus, deriveStatus } from '../src/lib/lifecycle';
import type { PhaseState } from '../src/lib/lifecycle';

// ─── #148 regression: approval must keep the literal `status:` line and the
//     `phases:` map in agreement. Before the fix, approveSpecCommand rewrote only
//     the status line (→ implementing) and left the phases map untouched, so a
//     spec carrying a phases map could read `status: implementing` while its
//     phases derived `specifying`. The invariant under test: after the approval
//     advance, the written status equals getSpecStatus(persisted phases).

describe('phasesForApproval() — specifying band → implementing band', () => {
  it('advances a fresh spec so the derived status is implementing', () => {
    const phases: PhaseState = {
      specify: 'in-progress',
      clarify: 'pending',
      plan: 'pending',
      tasks: 'pending',
      implement: 'pending',
    };
    const next = phasesForApproval(phases);
    expect(next.specify).toBe('done');
    expect(next.clarify).toBe('done');
    expect(next.plan).toBe('in-progress'); // new current phase
    expect(next.tasks).toBe('pending');
    expect(next.implement).toBe('pending');
    expect(getSpecStatus(next)).toBe('implementing'); // the invariant
  });

  it('preserves a skipped phase (a skip is not a completion)', () => {
    const phases: PhaseState = {
      specify: 'done',
      clarify: 'skipped', // T1/T2 commonly skip clarify
      plan: 'pending',
      tasks: 'pending',
      implement: 'pending',
    };
    const next = phasesForApproval(phases);
    expect(next.clarify).toBe('skipped'); // NOT flipped to done
    expect(next.plan).toBe('in-progress');
    expect(getSpecStatus(next)).toBe('implementing');
  });

  it('starts the first non-done implementing-band phase, leaving done ones alone', () => {
    const phases: PhaseState = {
      specify: 'done',
      clarify: 'done',
      plan: 'done', // already planned
      tasks: 'pending',
      implement: 'pending',
    };
    const next = phasesForApproval(phases);
    expect(next.plan).toBe('done'); // untouched
    expect(next.tasks).toBe('in-progress'); // first non-done → current
    expect(getSpecStatus(next)).toBe('implementing');
  });

  it('does not mutate the input', () => {
    const phases: PhaseState = {
      specify: 'in-progress',
      clarify: 'pending',
      plan: 'pending',
      tasks: 'pending',
      implement: 'pending',
    };
    phasesForApproval(phases);
    expect(phases.specify).toBe('in-progress'); // original unchanged
  });
});

describe('setSpecPhases() — surgical phases-map rewrite', () => {
  let tmpDir: string;
  let filePath: string;

  const WITH_PHASES = `---
id: SPEC-200
type: requirements
# 🔒 Once approved, hash-locked: ANY edit voids approval. DR-012.
status: specifying
tier: T3
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# Title

## Context
Body stays put.
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-setphases-'));
    filePath = path.join(tmpDir, 'SPEC-200.md');
    fs.writeFileSync(filePath, WITH_PHASES);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('rewrites only existing phase lines, preserving the lock comment and body', () => {
    setSpecPhases(filePath, { specify: 'done', plan: 'in-progress' });
    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('  specify: done');
    expect(after).toContain('  plan: in-progress');
    // The DR-012 lock comment and body survive a surgical rewrite.
    expect(after).toContain('# 🔒 Once approved, hash-locked: ANY edit voids approval. DR-012.');
    expect(after).toContain('## Context\nBody stays put.');
    const parsed = parseSpec(after);
    expect(parsed.frontmatter.phases.specify).toBe('done');
    expect(parsed.frontmatter.phases.plan).toBe('in-progress');
  });

  it('does NOT add a phase line that was absent (preserves file shape)', () => {
    // The fixture has no `clarify:` line — advancing it must not introduce one.
    setSpecPhases(filePath, { clarify: 'done', specify: 'done' });
    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).not.toContain('clarify:');
    expect(after).toContain('  specify: done');
  });

  it('is a no-op when there is no phases block', () => {
    const noPhases = path.join(tmpDir, 'no-phases.md');
    const src = '---\nid: SPEC-201\nstatus: specifying\ntier: T2\n---\n# X\n';
    fs.writeFileSync(noPhases, src);
    setSpecPhases(noPhases, { specify: 'done' });
    expect(fs.readFileSync(noPhases, 'utf-8')).toBe(src); // byte-identical
  });
});

describe('advanceSpecToImplementing() — #148 status/phases agreement', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-advance-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const write = (name: string, body: string): string => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, body);
    return p;
  };

  it('advances both status AND phases so they cannot diverge (the #148 bug)', () => {
    const p = write(
      'SPEC-202.md',
      `---
id: SPEC-202
status: specifying
tier: T3
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# Title
`,
    );
    const result = advanceSpecToImplementing(p);
    // DR-067 (#886): approved + plan in-progress (implement not started) → 'planning'.
    expect(result).toBe('planning');
    const parsed = parseSpec(fs.readFileSync(p, 'utf-8'));
    // Status line flipped.
    expect(parsed.frontmatter.status).toBe('planning');
    // Phases map advanced in lockstep.
    expect(parsed.frontmatter.phases.specify).toBe('done');
    expect(parsed.frontmatter.phases.plan).toBe('in-progress');
    // THE INVARIANT (approval-aware, DR-067): literal status === deriveStatus(persisted phases).
    expect(deriveStatus(parsed.frontmatter.phases, 'approved', undefined)).toBe(parsed.frontmatter.status);
  });

  it('falls back to a status-only flip when the spec has no phases block', () => {
    const p = write(
      'SPEC-203.md',
      '---\nid: SPEC-203\nstatus: specifying\ntier: T2\n---\n# X\n',
    );
    expect(advanceSpecToImplementing(p)).toBe('implementing');
    const after = fs.readFileSync(p, 'utf-8');
    expect(parseSpec(after).frontmatter.status).toBe('implementing');
    expect(after).not.toContain('phases:'); // no phases block invented
  });

  it('preserves a skipped clarify through the advance (status still agrees)', () => {
    const p = write(
      'SPEC-204.md',
      `---
id: SPEC-204
status: specifying
tier: T3
phases:
  specify: done
  clarify: skipped
  plan: pending
  tasks: pending
  implement: pending
---

# Title
`,
    );
    advanceSpecToImplementing(p);
    const parsed = parseSpec(fs.readFileSync(p, 'utf-8'));
    expect(parsed.frontmatter.phases.clarify).toBe('skipped');
    // DR-067: approved + plan in-progress (implement not started) → 'planning'.
    expect(parsed.frontmatter.status).toBe('planning');
    expect(deriveStatus(parsed.frontmatter.phases, 'approved', undefined)).toBe('planning');
  });

  // ─── #148 MAJOR (degenerate block). A phases block carrying only an early-band
  //     line (e.g. `specify: in-progress`, no plan/tasks/implement) is the one
  //     shape the earlier fix reintroduced the desync on: `parseSpec` materializes
  //     the absent implementing-band phases to `pending` in memory, so the target
  //     derives `implementing`; but `setSpecPhases` only rewrites lines that
  //     physically exist, so it CANNOT persist an implementing-band marker, and a
  //     re-read derives `specifying`. Pre-fix, advanceSpecToImplementing wrote
  //     `status: implementing` over bytes that re-derive `specifying` — the exact
  //     #148 divergence — with no gate. This T3 pins the gate.
  it('rejects a degenerate phases block instead of writing a self-contradicting file (#148 MAJOR)', () => {
    const p = write(
      'SPEC-205.md',
      `---
id: SPEC-205
status: specifying
tier: T3
phases:
  specify: in-progress
---

# Title
`,
    );
    // DR-067 (#886): the writer now derives via the approval-aware deriveStatus, which
    // returns 'planning' for an approved spec whose implement phase has not started —
    // a value the persisted (specify-only) bytes REPRODUCE, so there is no #148 desync
    // and no throw. (The degenerate gate still fires for a would-be 'implementing' the
    // bytes can't persist; a specify-only block never targets 'implementing'.)
    expect(advanceSpecToImplementing(p)).toBe('planning');

    // THE INVARIANT (approval-aware, DR-067): the persisted `status:` line equals the
    // status its persisted `phases:` map derives — never desynced.
    const after = parseSpec(fs.readFileSync(p, 'utf-8')).frontmatter;
    expect(after.status).toBe('planning');
    expect(after.status).toBe(deriveStatus(after.phases, 'approved', undefined));
  });

  // #667: advanceSpecToImplementing (the Approve Spec write path) flipped the
  // frontmatter `status:` line but left the body's `**Status:**` prose line stale —
  // two disagreeing sources of truth for the same fact, caught live by the #626
  // parity gate on SPEC-030. The fix is in setSpecStatus (the single writer both
  // paths below funnel through), so both the phases-aware and status-only advance
  // shapes must sync the body line.
  it('syncs the body **Status:** line when advancing a spec with a phases block (#667)', () => {
    const p = write(
      'SPEC-206.md',
      `---
id: SPEC-206
status: specifying
tier: T3
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# Title

**Status:** Specifying (SDD Specify phase)
`,
    );
    advanceSpecToImplementing(p);
    const after = fs.readFileSync(p, 'utf-8');
    // DR-067: approved + plan in-progress → 'planning' (body line synced in lockstep, #667).
    expect(after).toContain('status: planning');
    expect(after).toContain('**Status:** Planning (SDD Specify phase)');
  });

  it('syncs the body **Status:** line for the no-phases-block fallback (#667)', () => {
    const p = write(
      'SPEC-207.md',
      '---\nid: SPEC-207\nstatus: specifying\ntier: T2\n---\n\n# X\n\n**Status:** Specifying\n',
    );
    advanceSpecToImplementing(p);
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('status: implementing');
    expect(after).toContain('**Status:** Implementing');
  });
});
