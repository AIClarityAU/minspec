/**
 * #2009 — a doc comment detached from its declaration must be un-landable.
 *
 * The defect that prompted this shipped in #1955: two functions were inserted between
 * `validateOwnership`'s doc block and its declaration, silently re-parenting the block onto
 * another function and leaving a load-bearing gate function undocumented. It passed
 * typecheck, lint, 6110 tests and a four-voter review panel on the commit that introduced
 * it. Review is not a reliable catch for this, so it needs a gate.
 *
 * The suite has two halves. The unit half pins the predicate. The T0 half shells out to the
 * real script, because that is what CI actually runs: `npx vitest` never fires npm's
 * `pretest` hook, so a check wired only to `pretest` gates nothing, and a suite that only
 * tested the pure function would leave the wiring unproven.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  findOrphanedDocstrings,
  KNOWN_ORPHANED_DOCSTRINGS,
} from '../../../scripts/lib/orphaned-docstring';

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-orphaned-docstring.ts');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function run(args: string[] = []): { status: number | null; output: string } {
  const r = spawnSync(TSX, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf-8' });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

describe('#2009 findOrphanedDocstrings — the predicate', () => {
  it('flags a doc block immediately followed by another doc block', () => {
    const src = ['/**', ' * orphaned', ' */', '/**', ' * the real owner', ' */', 'export function f() {}'].join('\n');
    const found = findOrphanedDocstrings(src, 'x.ts');
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3); // the `*/` that lost its declaration, 1-indexed
  });

  it('flags the single-line form, which is how the real instance looked', () => {
    // commit-on-approve.ts:70 is exactly this: a long block, then `/** … */` on one line.
    const src = ['/**', ' * orphaned', ' */', '/** one-liner */', 'const A = 1;'].join('\n');
    expect(findOrphanedDocstrings(src, 'x.ts')).toHaveLength(1);
  });

  it('does NOT flag a doc block followed by its declaration', () => {
    const src = ['/**', ' * fine', ' */', 'export function f() {}'].join('\n');
    expect(findOrphanedDocstrings(src, 'x.ts')).toHaveLength(0);
  });

  it('does NOT flag a `*/` that is not alone on its line', () => {
    // `} */` and a trailing `*/` after code are ordinary and must stay quiet.
    const src = ['const a = 1; /* inline */', '/** doc */', 'const b = 2;'].join('\n');
    expect(findOrphanedDocstrings(src, 'x.ts')).toHaveLength(0);
  });

  it('does NOT flag a block comment that is not a doc comment', () => {
    const src = ['/**', ' * doc', ' */', '/* plain block, not /** */', 'const a = 1;'].join('\n');
    expect(findOrphanedDocstrings(src, 'x.ts')).toHaveLength(0);
  });

  it('finds every instance, not just the first', () => {
    const src = ['/**', ' * a', ' */', '/**', ' * b', ' */', '/**', ' * c', ' */', 'const x = 1;'].join('\n');
    expect(findOrphanedDocstrings(src, 'x.ts')).toHaveLength(2);
  });

  it('returns [] for empty input rather than throwing', () => {
    expect(findOrphanedDocstrings('', 'x.ts')).toEqual([]);
  });
});

describe('#2009 check-orphaned-docstring — the gate as CI runs it', () => {
  it('passes on the real tree, and says how much it scanned', () => {
    const { status, output } = run();
    expect(status).toBe(0);
    // A count, not a bare "clean": "scanned 0, all clean" must not read like "scanned 435".
    expect(output).toMatch(/\d+ source\(s\) scanned/);
    const scanned = Number(/(\d+) source\(s\) scanned/.exec(output)?.[1] ?? 0);
    expect(scanned).toBeGreaterThan(400); // both roots, not just one
  });

  // The load-bearing case. Without it the suite would pass against a gate that never fires.
  it('FAILS when a new orphan is introduced', () => {
    const target = path.join(REPO_ROOT, 'packages/minspec/src/lib/scaffold.ts');
    const original = fs.readFileSync(target, 'utf-8');
    const injected = original.replace(
      'export function untrackDeclaredMachineLocalPaths',
      '/**\n * Injected orphan.\n */\nexport function untrackDeclaredMachineLocalPaths',
    );
    expect(injected).not.toBe(original); // the injection must actually land
    try {
      fs.writeFileSync(target, injected, 'utf-8');
      const { status, output } = run();
      expect(status).toBe(1);
      expect(output).toMatch(/detached from their declaration/);
    } finally {
      fs.writeFileSync(target, original, 'utf-8');
    }
  });

  it('fails CLOSED on a directory it cannot walk, rather than reporting clean', () => {
    const { status, output } = run(['--dir', 'does-not-exist-anywhere']);
    expect(status).toBe(1);
    expect(output).toMatch(/could not run|not a directory/);
  });

  it('counts the tracked backlog by file, so a new orphan in a known file still fails', () => {
    // A count rather than line numbers: line numbers rot on the next edit, and a stale
    // waiver either fails a clean file or silences a real defect.
    expect(KNOWN_ORPHANED_DOCSTRINGS.get('packages/minspec/src/lib/adr-manager.ts')).toBe(2);
    expect([...KNOWN_ORPHANED_DOCSTRINGS.values()].reduce((a, b) => a + b, 0)).toBe(5);
  });
});
