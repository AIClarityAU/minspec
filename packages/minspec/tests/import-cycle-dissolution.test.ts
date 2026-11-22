/**
 * SPEC-040 FR-6 / #988 - pins the dissolution of the three type-held import cycles in
 * `packages/minspec/src/lib`.
 *
 * The runtime cycle gate (`npm run check:cycles`, SPEC-040 FR-2) only sees VALUE edges, so
 * it cannot tell whether these loops come back through an `import type`. This test reads
 * every module specifier as text (value imports, `import type`, `export ... from`,
 * `export type ... from`, side-effect imports, `require`, dynamic `import()`), so a
 * type-only edge re-closing a loop fails here even though the runtime gate stays green.
 *
 * The three loops and the edge that closed each one:
 *   - approval <-> approval-store : approval-store imported ApprovalRecord from ./approval
 *   - spec <-> lifecycle          : lifecycle imported PhaseStatus/SpecStatus from ./spec
 *   - the epic-manager loop       : epic-manager (and epic-backfill, adr-manager) imported
 *                                   slugify from ./spec-manager
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const LIB = path.resolve(__dirname, '../src/lib');

/** Every module specifier in `text`, type-only edges included. */
function moduleSpecifiers(text: string): string[] {
  const info = ts.preProcessFile(text, /* readImportFiles */ true, /* detectJavaScriptImports */ true);
  return info.importedFiles.map((f) => f.fileName);
}

function specifiersOf(file: string): string[] {
  return moduleSpecifiers(fs.readFileSync(path.join(LIB, file), 'utf8'));
}

/** Normalise `./x`, `./x.js`, `./x.ts`, `./x/index` to `./x` for comparison. */
function normalise(spec: string): string {
  return spec.replace(/\.(js|ts)$/, '').replace(/\/index$/, '');
}

function importsModule(file: string, target: string): boolean {
  return specifiersOf(file).some((s) => normalise(s) === target);
}

describe('import-cycle dissolution (SPEC-040 FR-6 / #988)', () => {
  // Negative control: the reader must SEE every edge shape the assertions below rely on,
  // otherwise "imports nothing from X" would pass vacuously.
  it('control: the specifier reader detects type-only, re-export and value edges', () => {
    const sample = [
      "import type { ApprovalRecord } from './approval';",
      "import {\n  type PhaseStatus,\n  SpecStatus,\n} from './spec';",
      "export type { X } from './type-reexport';",
      "export { slugify } from './spec-manager';",
      "import './side-effect';",
      "const m = require('./required');",
      "const d = import('./dynamic');",
    ].join('\n');
    const found = moduleSpecifiers(sample);
    for (const s of [
      './approval',
      './spec',
      './type-reexport',
      './spec-manager',
      './side-effect',
      './required',
      './dynamic',
    ]) {
      expect(found).toContain(s);
    }
  });

  it('approval-store.ts imports nothing from ./approval (type-only included)', () => {
    // Positive control on the real file: the reader sees its actual imports.
    expect(specifiersOf('approval-store.ts')).toContain('./approval-types');
    expect(importsModule('approval-store.ts', './approval')).toBe(false);
  });

  it('lifecycle.ts imports nothing from ./spec (type-only included)', () => {
    expect(specifiersOf('lifecycle.ts')).toContain('./spec-vocabulary');
    expect(importsModule('lifecycle.ts', './spec')).toBe(false);
  });

  it('lifecycle.ts imports nothing from ./approval (type-only included)', () => {
    expect(specifiersOf('lifecycle.ts')).toContain('./approval-types');
    expect(importsModule('lifecycle.ts', './approval')).toBe(false);
  });

  it.each(['epic-manager.ts', 'epic-backfill.ts', 'adr-manager.ts'])(
    '%s imports nothing from ./spec-manager (slugify comes from ./slug)',
    (file) => {
      expect(specifiersOf(file)).toContain('./slug');
      expect(importsModule(file, './spec-manager')).toBe(false);
    },
  );

  it('the re-homed leaves stay leaves: slug.ts has no imports; approval-types.ts and spec-vocabulary.ts import none of the cycle members', () => {
    expect(specifiersOf('slug.ts')).toEqual([]);
    const cycleMembers = ['./approval', './approval-store', './spec', './lifecycle', './spec-manager', './epic-manager'];
    for (const leaf of ['approval-types.ts', 'spec-vocabulary.ts']) {
      const specs = specifiersOf(leaf).map(normalise);
      for (const member of cycleMembers) {
        expect(specs, `${leaf} must not import ${member}`).not.toContain(member);
      }
    }
  });
});
