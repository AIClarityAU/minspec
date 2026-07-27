/**
 * SPEC-040 FR-2 / AC-4 — the runtime-import-cycle gate.
 *
 * The gate's whole value rests on one distinction: an `import type` edge is erased
 * by the compiler and cannot deadlock a module graph, a value edge can. These tests
 * pin that distinction from both sides (a value back-edge IS a failure, a type-only
 * one is NOT), pin the resolver so the scanner cannot quietly stop following edges
 * — a resolver that resolves nothing reports no cycles and passes forever, the
 * classic silent gate (DR-066) — and assert the shipped tree is green today.
 *
 * The later blocks are regressions for five proven blind spots, each of which let a
 * REAL cycle through while the gate printed "0 cycles": the `import x = require()`
 * form, relative DIRECTORY specifiers (`.`, `./`, `..`, `../`) through an `index`
 * barrel, symlinked files and directories, `.mts`/`.cts` modules, and a file the
 * parser could not read. Every one of them shares a signature — the scanner covered
 * less than the whole tree and said nothing — so each test asserts either the edge
 * is now SEEN or the scan now FAILS, never that it quietly carries on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildValueImportGraph,
  findValueImportCycles,
  type ImportCycle,
} from '../src/lib/import-cycle-check';

const REAL_SRC_ROOT = path.join(__dirname, '..', 'src');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

/** Materialise a synthetic source tree; returns its root. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-import-cycle-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const absolute = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  return root;
}

const chains = (cycles: ImportCycle[]): string[][] => cycles.map((c) => c.members);

describe('findValueImportCycles — value vs type edges', () => {
  it('reports a value back-edge, naming the exact member chain', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('does NOT report a back-edge that is `import type` (erased at runtime)', () => {
    const root = fixture({
      'lib/a.ts': "import type { B } from './b';\nexport const a: B = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport type B = number;\nexport const bb = a;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('reports a mixed `import { type X, y }` back-edge — the value specifier keeps the edge', () => {
    const root = fixture({
      'lib/a.ts': "import { type B, bValue } from './b';\nexport const a: B = bValue;\n",
      'lib/b.ts': "import { a } from './a';\nexport type B = number;\nexport const bValue = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('does NOT report a back-edge whose named specifiers are ALL type-only', () => {
    const root = fixture({
      'lib/a.ts': "import { type B } from './b';\nexport const a: B = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport type B = number;\nexport const bb = a;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('reports a side-effect-only import (`import "./b"`) — it loads the module', () => {
    const root = fixture({
      'lib/a.ts': "import './b';\nexport const a = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('reports a default import and a namespace import as value edges', () => {
    const defaultImport = fixture({
      'lib/a.ts': "import b from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport default a;\n",
    });
    expect(chains(findValueImportCycles(defaultImport))).toEqual([['lib/a.ts', 'lib/b.ts']]);

    const namespaceImport = fixture({
      'lib/a.ts': "import * as b from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(namespaceImport))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('does NOT report a dynamic `import()` — evaluated on call, not at load', () => {
    const root = fixture({
      'lib/a.ts':
        "export async function load() {\n  const { b } = await import('./b');\n  return b;\n}\n",
      'lib/b.ts': "import { load } from './a';\nexport const b = load;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });
});

describe('findValueImportCycles — `import x = require(...)`', () => {
  // Regression: the scanner used to visit only import and export DECLARATIONS, so
  // this form produced neither an edge nor an `unresolved` entry — a genuine
  // require cycle passed green with nothing anywhere to hint at the omission.
  it('reports a cycle closed through `import x = require("./y")`', () => {
    const root = fixture({
      'lib/a.ts': "import b = require('./b');\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('reports a cycle where BOTH legs are `import = require` — a pure CommonJS loop', () => {
    const root = fixture({
      'lib/a.ts': "import b = require('./b');\nexport const a = b;\n",
      'lib/b.ts': "import a = require('./a');\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('does NOT report `import type x = require("./y")` — erased like any type import', () => {
    const root = fixture({
      'lib/a.ts': "import type b = require('./b');\nexport const a: b.B = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport type B = number;\nexport const bb = a;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('does NOT treat `import x = A.B` (an entity name, not a module) as an edge', () => {
    const root = fixture({
      'lib/a.ts':
        "export namespace Outer {\n  export const inner = 1;\n}\nimport alias = Outer.inner;\nexport const a = alias;\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.edges.get('lib/a.ts')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it('records an unresolved `import x = require("./missing")` instead of dropping it', () => {
    const root = fixture({
      'lib/a.ts': "// header comment\nimport missing = require('./missing');\nexport const a = missing;\n",
    });
    expect(buildValueImportGraph(root).unresolved).toEqual([
      { file: 'lib/a.ts', specifier: './missing', line: 2 },
    ]);
  });
});

describe('findValueImportCycles — re-exports', () => {
  // Deliberate: a value re-export loads its target at require time exactly as an
  // import does, so a loop closed through one is a real runtime cycle.
  it('reports a named value re-export (`export { b } from`) as an edge', () => {
    const root = fixture({
      'lib/a.ts': "export { b } from './b';\nexport const a = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('reports a star re-export (`export * from`) as an edge', () => {
    const root = fixture({
      'lib/a.ts': "export * from './b';\nexport const a = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('does NOT report a type-only re-export (`export type { B } from`)', () => {
    const root = fixture({
      'lib/a.ts': "export type { B } from './b';\nexport const a = 1;\n",
      'lib/b.ts': "import { a } from './a';\nexport type B = number;\nexport const b = a;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('does NOT report a local re-export with no module specifier', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nconst a = b;\nexport { a };\n",
      'lib/b.ts': "export const b = 1;\n",
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });
});

describe('buildValueImportGraph — specifier resolution', () => {
  it('ignores bare/package specifiers — they are not in-package edges', () => {
    const root = fixture({
      'lib/a.ts':
        "import * as fs from 'fs';\nimport * as vscode from 'vscode';\n" +
        "import { specHash } from '@aiclarity/shared';\nexport const a = [fs, vscode, specHash];\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.edges.get('lib/a.ts')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it('resolves a directory specifier to its index.ts', () => {
    const root = fixture({
      'lib/a.ts': "import { h } from './helpers';\nexport const a = h;\n",
      'lib/helpers/index.ts': "import { a } from '../a';\nexport const h = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/helpers/index.ts']]);
  });

  it('maps an explicit `.js` specifier back to its `.ts` source', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a.js';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('scans `.tsx` modules too', () => {
    const root = fixture({
      'lib/a.ts': "import { P } from './panel';\nexport const a = P;\n",
      'lib/panel.tsx': "import { a } from './a';\nexport const P = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/panel.tsx']]);
  });

  it('never builds an edge into a `.d.ts` — declarations are erased, not runtime', () => {
    const root = fixture({
      'lib/a.ts': "import { T } from './types';\nexport const a: T = 1;\n",
      'lib/types.d.ts': "import { a } from './a';\nexport type T = typeof a;\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.files).toEqual(['lib/a.ts']);
    expect(graph.edges.get('lib/a.ts')).toEqual([]);
    // Resolved by a declaration file ⇒ external, NOT a broken import.
    expect(graph.unresolved).toEqual([]);
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('exempts src/test/** and src/__benchmarks__/** — they may import across every layer', () => {
    const root = fixture({
      'lib/a.ts':
        "import { harness } from '../test/harness';\nimport { bench } from '../__benchmarks__/perf';\n" +
        'export const a = [harness, bench];\n',
      'test/harness.ts': "import { a } from '../lib/a';\nexport const harness = a;\n",
      '__benchmarks__/perf.ts': "import { a } from '../lib/a';\nexport const bench = a;\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.files).toEqual(['lib/a.ts']);
    expect(graph.edges.get('lib/a.ts')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('records a relative specifier that resolves to nothing, with file/specifier/line', () => {
    const root = fixture({
      'lib/a.ts': "// header comment\nimport { x } from './missing';\nexport const a = x;\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.unresolved).toEqual([{ file: 'lib/a.ts', specifier: './missing', line: 2 }]);
  });

  it('treats a specifier escaping the src root as external, not a cycle or a defect', () => {
    const root = fixture({
      'lib/a.ts': "import { s } from '../../shared/src/index';\nexport const a = s;\n",
    });
    const graph = buildValueImportGraph(root);
    expect(graph.edges.get('lib/a.ts')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });
});

describe('buildValueImportGraph — relative DIRECTORY specifiers', () => {
  // Regression, all four dot-forms. `'.'`/`'..'` failed the old `startsWith('./')`
  // test and were written off as external packages before resolution was even
  // attempted; `'./'`/`'../'` got in but carried a trailing slash into the
  // candidates (`lib/.ts`, `lib//index.ts`), and `path.join` collapsed the empty
  // segment so the `existsSync` fallback MATCHED and filed them as external too.
  // Net effect either way: an edge through an `index.ts` barrel was invisible, and
  // `unresolved` stayed empty — the blind spot hid itself.
  it('reports a full a→b→a cycle closed through a bare "." / "./"', () => {
    for (const specifier of ['.', './']) {
      const root = fixture({
        'lib/index.ts': "import { b } from './b';\nexport const a = b;\n",
        'lib/b.ts': `import { a } from '${specifier}';\nexport const b = a;\n`,
      });
      expect(chains(findValueImportCycles(root))).toEqual([['lib/b.ts', 'lib/index.ts']]);
    }
  });

  it('reports a full a→b→a cycle closed through ".." / "../" from a subdirectory', () => {
    for (const specifier of ['..', '../']) {
      const root = fixture({
        'lib/index.ts': "import { b } from './deep/b';\nexport const a = b;\n",
        'lib/deep/b.ts': `import { a } from '${specifier}';\nexport const b = a;\n`,
      });
      expect(chains(findValueImportCycles(root))).toEqual([['lib/deep/b.ts', 'lib/index.ts']]);
    }
  });

  it('resolves "." at the src root itself to the root-level index barrel', () => {
    const root = fixture({
      'index.ts': "import { b } from './b';\nexport const a = b;\n",
      'b.ts': "import { a } from '.';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['b.ts', 'index.ts']]);
  });

  it('records a directory specifier no barrel answers as unresolved, never as external', () => {
    for (const specifier of ['.', './']) {
      const root = fixture({
        'lib/a.ts': `import { x } from '${specifier}';\nexport const a = x;\n`,
      });
      expect(buildValueImportGraph(root).unresolved).toEqual([
        { file: 'lib/a.ts', specifier, line: 1 },
      ]);
    }
    for (const specifier of ['..', '../']) {
      const root = fixture({
        'lib/deep/a.ts': `import { x } from '${specifier}';\nexport const a = x;\n`,
      });
      expect(buildValueImportGraph(root).unresolved).toEqual([
        { file: 'lib/deep/a.ts', specifier, line: 1 },
      ]);
    }
  });

  it('still treats ".." that escapes the src root as external', () => {
    const root = fixture({ 'a.ts': "import { x } from '..';\nexport const a = x;\n" });
    const graph = buildValueImportGraph(root);
    expect(graph.edges.get('a.ts')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });
});

describe('buildValueImportGraph — `.mts` / `.cts` modules', () => {
  // Regression: these were scanned by nothing and resolved to nothing, so a cycle
  // among them produced no node, no edge and no warning.
  it('scans `.mts` modules and maps a `.mjs` specifier back to its `.mts` source', () => {
    const root = fixture({
      'lib/a.mts': "import { b } from './b.mjs';\nexport const a = b;\n",
      'lib/b.mts': "import { a } from './a.mjs';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.mts', 'lib/b.mts']]);
  });

  it('scans `.cts` modules and maps a `.cjs` specifier back to its `.cts` source', () => {
    const root = fixture({
      'lib/a.cts': "import { b } from './b.cjs';\nexport const a = b;\n",
      'lib/b.cts': "import { a } from './a.cjs';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.cts', 'lib/b.cts']]);
  });

  it('does not cross module formats — `.mjs` never resolves to a plain `.ts`', () => {
    const root = fixture({
      'lib/a.mts': "import { b } from './b.mjs';\nexport const a = b;\n",
      'lib/b.ts': 'export const b = 1;\n',
    });
    const graph = buildValueImportGraph(root);
    expect(graph.edges.get('lib/a.mts')).toEqual([]);
    // Visible, not swallowed: `b.mts` genuinely does not exist.
    expect(graph.unresolved).toEqual([{ file: 'lib/a.mts', specifier: './b.mjs', line: 1 }]);
  });

  it('never builds an edge into a `.d.mts` — declarations are erased, not runtime', () => {
    const root = fixture({
      'lib/a.mts': "import { T } from './types.mjs';\nexport const a: T = 1;\n",
      'lib/types.d.mts': 'export type T = number;\n',
    });
    const graph = buildValueImportGraph(root);
    expect(graph.files).toEqual(['lib/a.mts']);
    expect(graph.edges.get('lib/a.mts')).toEqual([]);
    // Answered by a declaration file ⇒ external, NOT a broken import.
    expect(graph.unresolved).toEqual([]);
  });

  it('resolves an extensionless specifier onto an `.mts` module (deliberate superset)', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.mts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.mts']]);
  });
});

describe('buildValueImportGraph — symlinks', () => {
  // Regression: `readdirSync` reports a symlink as its own type, so `isDirectory()`
  // and `isFile()` were both false and a linked module — or a whole linked subtree
  // — fell through the walk with no node, no edge and no warning.
  it('scans a symlinked module file — a cycle through one is reported', () => {
    const linked = fixture({ 'pkg/b.ts': "import { a } from './a';\nexport const b = a;\n" });
    const root = fixture({ 'lib/a.ts': "import { b } from './b';\nexport const a = b;\n" });
    fs.symlinkSync(path.join(linked, 'pkg', 'b.ts'), path.join(root, 'lib', 'b.ts'));
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts']]);
  });

  it('scans a symlinked directory — the modules under it join the graph', () => {
    const linked = fixture({ 'pkg/c.ts': "import { a } from '../a';\nexport const c = a;\n" });
    const root = fixture({ 'lib/a.ts': "import { c } from './sub/c';\nexport const a = c;\n" });
    fs.symlinkSync(path.join(linked, 'pkg'), path.join(root, 'lib', 'sub'));
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/sub/c.ts']]);
  });

  it('FAILS on a dangling symlink rather than silently scanning a smaller tree', () => {
    const root = fixture({ 'lib/a.ts': 'export const a = 1;\n' });
    fs.symlinkSync(path.join(root, 'lib', 'nowhere.ts'), path.join(root, 'lib', 'b.ts'));
    expect(() => buildValueImportGraph(root)).toThrow(
      /import-cycle-check: lib\/b\.ts is a symlink the scanner cannot follow/,
    );
  });

  it('FAILS on a directory symlink that loops back up the tree, instead of spinning', () => {
    const root = fixture({ 'lib/a.ts': 'export const a = 1;\n' });
    fs.symlinkSync(path.join(root, 'lib'), path.join(root, 'lib', 'self'));
    expect(() => buildValueImportGraph(root)).toThrow(
      /import-cycle-check: lib\/self is a symlink to a directory already being scanned/,
    );
  });
});

describe('buildValueImportGraph — files the parser cannot read', () => {
  // Regression: a broken file yields a truncated `statements` array, which reads as
  // "this module imports nothing" — indistinguishable from a genuinely import-free
  // module, so every edge through it vanished and the gate still printed 0 cycles.
  it('FAILS naming the file and position, rather than treating it as edge-free', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport function broken( {\n",
    });
    expect(() => buildValueImportGraph(root)).toThrow(/import-cycle-check: lib\/b\.ts:\d+:\d+:/);
    // The message has to say WHY a parse error is fatal to a cycle gate, or the
    // next reader "fixes" it by skipping the file.
    expect(() => buildValueImportGraph(root)).toThrow(/contributes no edges/);
  });

  it('cannot be reached through `findValueImportCycles` either — no partial pass', () => {
    const root = fixture({ 'lib/b.ts': 'export function broken( {\n' });
    expect(() => findValueImportCycles(root)).toThrow(/import-cycle-check:/);
  });
});

describe('findValueImportCycles — traversal', () => {
  it('names every member of a longer chain, in traversal order, once', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { c } from './c';\nexport const b = c;\n",
      'lib/c.ts': "import { a } from './a';\nexport const c = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts', 'lib/b.ts', 'lib/c.ts']]);
  });

  it('reports two independent cycles separately and deterministically', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
      'lib/x.ts': "import { y } from './y';\nexport const x = y;\n",
      'lib/y.ts': "import { x } from './x';\nexport const y = x;\n",
    });
    const expected = [
      ['lib/a.ts', 'lib/b.ts'],
      ['lib/x.ts', 'lib/y.ts'],
    ];
    expect(chains(findValueImportCycles(root))).toEqual(expected);
    // Byte-identical across runs: sorted roots + sorted neighbours (a CI failure
    // must reproduce exactly).
    expect(chains(findValueImportCycles(root))).toEqual(expected);
  });

  it('does not mistake a diamond (shared dependency, no back-edge) for a cycle', () => {
    const root = fixture({
      'lib/root.ts': "import { l } from './left';\nimport { r } from './right';\nexport const root = [l, r];\n",
      'lib/left.ts': "import { s } from './shared';\nexport const l = s;\n",
      'lib/right.ts': "import { s } from './shared';\nexport const r = s;\n",
      'lib/shared.ts': 'export const s = 1;\n',
    });
    expect(findValueImportCycles(root)).toEqual([]);
  });

  it('reports a self-import — a module that value-imports itself', () => {
    const root = fixture({
      'lib/a.ts': "import { a } from './a';\nexport const aa = a;\n",
    });
    expect(chains(findValueImportCycles(root))).toEqual([['lib/a.ts']]);
  });
});

describe('the real packages/minspec/src tree', () => {
  it('has ZERO runtime import cycles — the gate ships green (AC-4/AC-5)', () => {
    expect(chains(findValueImportCycles(REAL_SRC_ROOT))).toEqual([]);
  });

  it('resolves every relative import — no blind spot that would fake a pass (DR-066)', () => {
    expect(buildValueImportGraph(REAL_SRC_ROOT).unresolved).toEqual([]);
  });

  it('scans the layered tree and excludes the exempt directories', () => {
    const graph = buildValueImportGraph(REAL_SRC_ROOT);
    expect(graph.files).toContain('lib/import-cycle-check.ts');
    expect(graph.files).toContain('extension.ts');
    expect(graph.files.filter((f) => f.startsWith('test/'))).toEqual([]);
    expect(graph.files.filter((f) => f.startsWith('__benchmarks__/'))).toEqual([]);
    // A scanner that silently found nothing would pass every assertion above.
    expect(graph.files.length).toBeGreaterThan(50);
    expect([...graph.edges.values()].flat().length).toBeGreaterThan(50);
  });

  it('sees the approval↔approval-store loop as the ONE-WAY value edge it is', () => {
    const graph = buildValueImportGraph(REAL_SRC_ROOT);
    // approval.ts value-imports the store; the store only `import type`s back —
    // the exact asymmetry that keeps this known cycle runtime-safe today.
    expect(graph.edges.get('lib/approval.ts')).toContain('lib/approval-store.ts');
    expect(graph.edges.get('lib/approval-store.ts')).not.toContain('lib/approval.ts');
    expect(graph.edges.get('lib/approval-store.ts')).toContain('lib/approvable.ts');
  });
});
