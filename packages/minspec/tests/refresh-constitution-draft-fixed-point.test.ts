/**
 * #2520 — one Refresh is not a fixed point when it seeds a new constitution
 * DRAFT (`.cursorrules` lagged one run).
 *
 * `refreshHarnessFiles` used to render+merge every harness template from a
 * context built BEFORE `seedConstitution` ran, so a DRAFT entry seeded by
 * THIS refresh (because a new signal — e.g. a docs/decisions/ register coming
 * into use — appeared since the last refresh) was not reflected in any
 * template that iterates the constitution's list (`.cursorrules` renders
 * `{{#each principles}}`) until the NEXT refresh. Measured on origin/main
 * 350c6fa4: Refresh 1 seeded the DRAFT into constitution.md but left
 * `.cursorrules` stale; Refresh 2 (on an otherwise-untouched project) then
 * changed `.cursorrules`; Refresh 3 was finally quiet.
 *
 * Root cause: `seedConstitution` ran only AFTER the render-and-merge loop in
 * `refreshHarnessFiles` (`packages/minspec/src/lib/scaffold.ts`). The fix adds
 * a seed call BEFORE `buildContext`/the render loop too, so a signal that
 * targets an already-existing constitution section (Invariants/Principles/
 * Constraints/Goals all pre-exist from Initialize) is reflected in every
 * template's render in the SAME run it first appears.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';

describe('#2520 — refresh seeds a new DRAFT and renders it in the SAME run', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-2520-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const cursorrulesPath = (root: string) => path.join(root, '.cursorrules');
  const draftLine = 'Record hard-to-reverse decisions as decision records before implementing.';

  it('Refresh 1 already renders the DRAFT it just seeded; Refresh 2 changes nothing', () => {
    generateHarnessFiles(tmp);

    // Simulate the issue's repro: a docs/decisions/ register comes into use
    // AFTER Initialize, so the signal is new at the next Refresh.
    const decisionsDir = path.join(tmp, 'docs', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    fs.writeFileSync(path.join(decisionsDir, 'DR-001.md'), '# DR-001\n\nSome decision.\n');
    fs.writeFileSync(path.join(decisionsDir, 'DR-002.md'), '# DR-002\n\nAnother decision.\n');

    expect(fs.readFileSync(cursorrulesPath(tmp), 'utf-8')).not.toContain(draftLine);

    refreshHarnessFiles(tmp); // Refresh 1 — the signal first appears here
    const constitutionAfterR1 = fs.readFileSync(
      path.join(tmp, '.minspec', 'constitution.md'),
      'utf-8',
    );
    const cursorrulesAfterR1 = fs.readFileSync(cursorrulesPath(tmp), 'utf-8');

    // The DRAFT landed in the constitution...
    expect(constitutionAfterR1).toContain(draftLine);
    // ...and — the fix — ALSO in .cursorrules, within this same run.
    expect(cursorrulesAfterR1).toContain(draftLine);

    refreshHarnessFiles(tmp); // Refresh 2 — nobody touched the project in between
    const cursorrulesAfterR2 = fs.readFileSync(cursorrulesPath(tmp), 'utf-8');

    // Fixed point in one run: Refresh 2 must be a byte-for-byte no-op for the
    // file the bug was measured on.
    expect(cursorrulesAfterR2).toBe(cursorrulesAfterR1);
  });
});
