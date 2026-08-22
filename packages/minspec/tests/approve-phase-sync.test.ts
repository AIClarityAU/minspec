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

  // PINNING TEST FOR THE DEFAULT (SPEC-061 DQ-1, resolved 2026-08-22). Creation is
  // OPT-IN, so this contract survives unchanged — approved FR-6 requires the
  // shape-preserving behaviour stay reachable, which unconditional widening would have
  // removed. DQ-1 calls this test out by name as the reason plain Option A was rejected.
  it('is a no-op when there is no phases block (default: shape-preserving)', () => {
    const noPhases = path.join(tmpDir, 'no-phases.md');
    const src = '---\nid: SPEC-201\nstatus: specifying\ntier: T2\n---\n# X\n';
    fs.writeFileSync(noPhases, src);
    setSpecPhases(noPhases, { specify: 'done' });
    expect(fs.readFileSync(noPhases, 'utf-8')).toBe(src); // byte-identical
  });

  it('creates the block ONLY when createIfAbsent is passed', () => {
    const noPhases = path.join(tmpDir, 'no-phases-optin.md');
    const src = '---\nid: SPEC-202\nstatus: specifying\ntier: T2\n---\n# X\n';
    fs.writeFileSync(noPhases, src);
    setSpecPhases(noPhases, { specify: 'done' }, { createIfAbsent: true });
    const fm = parseSpec(fs.readFileSync(noPhases, 'utf-8')).frontmatter;
    expect(fm.phases.specify).toBe('done');
    expect(fm.phases.clarify).toBe('pending');
    expect(fm.phases.implement).toBe('pending');
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
    // DR-069 (#886): approved + plan in-progress (implement not started) → 'planning'.
    expect(result).toBe('planning');
    const parsed = parseSpec(fs.readFileSync(p, 'utf-8'));
    // Status line flipped.
    expect(parsed.frontmatter.status).toBe('planning');
    // Phases map advanced in lockstep.
    expect(parsed.frontmatter.phases.specify).toBe('done');
    expect(parsed.frontmatter.phases.plan).toBe('in-progress');
    // THE INVARIANT (approval-aware, DR-069): literal status === deriveStatus(persisted phases).
    expect(deriveStatus(parsed.frontmatter.phases, 'approved', undefined)).toBe(parsed.frontmatter.status);
  });

  // CONTRACT CHANGED (SPEC-061 / #957). The status-only fallback is gone. It stamped
  // `implementing` on bytes that derive `new` — a file that contradicted itself the
  // moment it was re-read — and left `validateOwnership` un-armed because that rule
  // keys on `plan`. There is now ONE path: the block is created and the literal is
  // derived from the persisted bytes, so `planning` is correct for a pre-implement spec.
  it('creates the phases block and stamps planning when the spec has none', () => {
    const p = write(
      'SPEC-203.md',
      '---\nid: SPEC-203\nstatus: specifying\ntier: T2\n---\n# X\n',
    );
    expect(advanceSpecToImplementing(p)).toBe('planning');
    const after = fs.readFileSync(p, 'utf-8');
    const fm = parseSpec(after).frontmatter;
    expect(fm.status).toBe('planning');
    expect(after).toContain('phases:');
    // the whole point: the persisted bytes reproduce the written literal
    expect(fm.status).toBe(deriveStatus(fm.phases, 'approved', undefined));
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
    // DR-069: approved + plan in-progress (implement not started) → 'planning'.
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
    // DR-069 (#886): the writer now derives via the approval-aware deriveStatus, which
    // returns 'planning' for an approved spec whose implement phase has not started —
    // a value the persisted (specify-only) bytes REPRODUCE, so there is no #148 desync
    // and no throw. (The degenerate gate still fires for a would-be 'implementing' the
    // bytes can't persist; a specify-only block never targets 'implementing'.)
    expect(advanceSpecToImplementing(p)).toBe('planning');

    // THE INVARIANT (approval-aware, DR-069): the persisted `status:` line equals the
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
    // DR-069: approved + plan in-progress → 'planning' (body line synced in lockstep, #667).
    expect(after).toContain('status: planning');
    expect(after).toContain('**Status:** Planning (SDD Specify phase)');
  });

  // Still #667's body-token sync; only the expected VALUE changed, because the
  // phaseless path now derives `planning` rather than hard-stamping `implementing`
  // (SPEC-061 / #957). The property under test is unchanged: the body prose line and
  // the frontmatter literal must not disagree.
  it('syncs the body **Status:** line when the phases block is created (#667)', () => {
    const p = write(
      'SPEC-207.md',
      '---\nid: SPEC-207\nstatus: specifying\ntier: T2\n---\n\n# X\n\n**Status:** Specifying\n',
    );
    advanceSpecToImplementing(p);
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('status: planning');
    expect(after).toContain('**Status:** Planning');
  });
});

// ─── SPEC-061 / #957 — a phaseless spec must be able to agree with itself ─────
//
// Before this fix `advanceSpecToImplementing` short-circuited when the frontmatter
// had no `phases:` block and stamped `status: implementing`. That literal was one
// the file provably could not re-derive: `parseSpec` materializes absent phases to
// `pending` and `deriveStatus` tests `allPending` BEFORE the approval check, so the
// bytes derived `new`. 22 specs drifted this way (#1513), and because
// `validateOwnership` arms on `plan`, 20 approved T3/T4 specs were never
// ownership-gated at all (#1543) — one missing block silently disabled three things.
describe('advanceSpecToImplementing — a spec with no phases: block (SPEC-061)', () => {
  let dir: string;
  const FM = [
    '---',
    'id: SPEC-999',
    'type: requirements',
    'status: specifying',
    'tier: T2', // T2 so the SPEC-038 ownership guard is out of scope here
    'product: minspec',
    '# a full-line comment (the DR-012 lock reminder shape) must survive',
    '---',
    '',
    '# Body',
    '',
    '## Requirements',
    '- [ ] a thing',
    '',
  ].join('\n');

  const write = (src = FM): string => {
    const p = path.join(dir, 'requirements.md');
    fs.writeFileSync(p, src, 'utf-8');
    return p;
  };
  const fmOf = (p: string) => parseSpec(fs.readFileSync(p, 'utf-8')).frontmatter;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec061-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // AC-1
  it('creates a complete phases block, in PHASES order', () => {
    const p = write();
    advanceSpecToImplementing(p);
    const block = fs.readFileSync(p, 'utf-8').split('---')[1];
    expect(block).toContain('phases:');
    const order = ['specify', 'clarify', 'plan', 'tasks', 'implement'];
    const seen = order.map((k) => block.indexOf(`  ${k}:`));
    expect(seen.every((i) => i > -1), `missing a phase line: ${block}`).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // in order
  });

  // AC-2 — asserted on the PERSISTED BYTES, not the in-memory map
  it('leaves the file agreeing with itself: literal === derived from the bytes', () => {
    const p = write();
    advanceSpecToImplementing(p);
    const fm = fmOf(p);
    expect(fm.status).toBe(deriveStatus(fm.phases, 'approved', undefined));
  });

  // AC-3 — THE regression. Pre-fix this was `implementing`.
  it('stamps planning, not implementing, for an approved pre-implement spec', () => {
    const p = write();
    expect(advanceSpecToImplementing(p)).toBe('planning');
    expect(fmOf(p).status).toBe('planning');
  });

  it('pre-fix shape is genuinely gone: the bytes no longer derive new', () => {
    const p = write();
    advanceSpecToImplementing(p);
    expect(deriveStatus(fmOf(p).phases, 'approved', undefined)).not.toBe('new');
  });

  // AC-4 — hash-neutral, so an approval write cannot stale the approval it records
  it('does not change the canonical hash', async () => {
    const { specHash } = await import('@aiclarity/shared');
    const p = write();
    const before = specHash(fs.readFileSync(p, 'utf-8'));
    advanceSpecToImplementing(p);
    expect(specHash(fs.readFileSync(p, 'utf-8'))).toBe(before);
  });

  // AC-5
  it('is idempotent — a second advance is a byte-for-byte no-op', () => {
    const p = write();
    advanceSpecToImplementing(p);
    const once = fs.readFileSync(p, 'utf-8');
    advanceSpecToImplementing(p);
    expect(fs.readFileSync(p, 'utf-8')).toBe(once);
  });

  it('preserves full-line frontmatter comments (they are hashed content)', () => {
    const p = write();
    advanceSpecToImplementing(p);
    expect(fs.readFileSync(p, 'utf-8')).toContain('# a full-line comment');
  });

  // AC-6 — the degenerate-block gate must NOT be weakened by block creation.
  // A block that EXISTS but omits every implementing-band line still throws;
  // individual lines are still never invented.
  // The reachable degenerate shape, established by measurement rather than assumed:
  // a block whose ONLY lines are implementing-band ones it cannot advance. The
  // specifying-band lines phasesForApproval would mark `done` have no line to write
  // to, so the persisted bytes stay all-pending and derive `new` while the target is
  // `planning`. A block with only `specify:` or `specify:`+`clarify:` does NOT reach
  // the gate (it advances cleanly to `planning`) — my first draft of this test used
  // that shape and passed vacuously.
  it.each([
    // AC-6 as AMENDED at Clarify 2026-08-22: a block with NO recognized phase child.
    ['no recognized child', 'phases:\n  notaphase: pending'],
    // Also-reaching shapes, established by measurement: the specifying-band lines
    // phasesForApproval would mark `done` have no line to write to, so the persisted
    // bytes stay all-pending and derive `new` against a `planning` target.
    ['only implement:', 'phases:\n  implement: pending'],
    ['only tasks:', 'phases:\n  tasks: pending'],
  ])('still throws on a degenerate block (%s) that cannot realize the target', (_n, block) => {
    const p = write(FM.replace('product: minspec', `product: minspec\n${block}`));
    expect(() => advanceSpecToImplementing(p)).toThrow(/Cannot advance/i);
  });

  it('does not invent individual phase lines inside an existing block', () => {
    const p = write(FM.replace('product: minspec', 'product: minspec\nphases:\n  specify: pending\n  plan: pending'));
    advanceSpecToImplementing(p);
    const block = fs.readFileSync(p, 'utf-8').split('---')[1];
    expect(block).not.toContain('clarify:');   // absent line stays absent
    expect(block).not.toContain('implement:');
  });

  // setSpecPhases contract, pinned so docstring and behaviour cannot drift (AC-8)
  it('setSpecPhases creates the block when opted in, defaulting unsupplied phases to pending', () => {
    const p = write();
    setSpecPhases(p, { plan: 'in-progress' }, { createIfAbsent: true });
    const fm = fmOf(p);
    expect(fm.phases.plan).toBe('in-progress');
    expect(fm.phases.specify).toBe('pending');
    expect(fm.phases.implement).toBe('pending');
  });
});
