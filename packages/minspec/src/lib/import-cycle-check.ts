/**
 * SPEC-040 FR-2 — the in-repo VALUE-import cycle gate (DR-064 §1).
 *
 * Builds the *runtime* import graph of a TypeScript source tree and reports every
 * cycle in it. "Runtime" is the whole point: the three known cycles among MinSpec's
 * `lib` modules are each held open by exactly one `import type` edge, which the
 * compiler erases — so there are ZERO runtime cycles today and this gate ships
 * green. What it guards is the next careless `type`→value flip, which would close
 * one of those loops into a real require cycle with nothing to catch it (AC-4).
 *
 * Why in-repo rather than `madge`/`dependency-cruiser` (OQ-1, resolved in DR-064
 * §1): zero new dependencies and zero added supply-chain surface. THIS MODULE
 * makes no network call and needs nothing beyond `fs`, `path` and the `typescript`
 * compiler API already declared in the root `devDependencies` — which is a claim
 * about the module, deliberately NOT a claim about the gate as currently wired.
 * `npm run check:cycles` reaches the runner through `npx tsx`, and `tsx` is not a
 * declared devDependency, so on a cold npm cache it is fetched from the registry.
 * Declaring it belongs to #979, not here (SPEC-040's dependency budget is zero).
 * Until #979 lands, the honest sentence is the narrow one above — do not upgrade
 * it to "the gate runs offline" (constitution invariant #1 is about the shipped
 * extension; this is dev/CI tooling, and overclaiming it would make the signpost
 * lie).
 *
 * Tier-0 (DR-014): `fs` + `path` + the `typescript` compiler API only. No `vscode`,
 * no `../views`, no `../commands`, no network. Nothing in the extension's runtime
 * graph imports this module — it is dev/CI tooling reached from
 * `scripts/check-import-cycles.ts` — so the `typescript` dependency never reaches
 * the packaged VSIX (esbuild bundles only what `extension.ts` reaches).
 *
 * The cycle finder is the iterative three-color DFS ported from the artifact-graph
 * cycle pass in `packages/shared/src/next-task.ts`: an explicit stack (never
 * recursion, so a cycle can neither blow the stack nor spin), deterministic
 * neighbour order, O(V+E), and a GRAY back-edge that names the exact member chain
 * rather than merely asserting "a cycle exists". Same algorithm, different graph
 * (modules and imports, not artifacts and `depends_on`) — the INV-CONSUME guard in
 * `tests/invariants.test.ts` covers re-implementing that resolver, which this is
 * not, and its identifiers are deliberately not reused here.
 *
 * ONE STANDING RULE runs through everything below (DR-066 — no silent gate): the
 * scanner never answers a question it did not actually ask. Every way it could
 * quietly cover less of the tree — an unfollowed symlink, an unparseable file, a
 * specifier written off as external without ever being resolved — either resolves
 * properly, lands in `unresolved`, or THROWS. A gate that shrinks its own input
 * still prints "0 cycles", and that is the one failure mode worth this much care.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/** One cycle in the value-import graph. */
export interface ImportCycle {
  /**
   * The cycle's members in traversal order as srcRoot-relative POSIX paths. The
   * chain closes back onto `members[0]`: `['lib/a.ts', 'lib/b.ts']` means
   * `lib/a.ts → lib/b.ts → lib/a.ts`.
   */
  members: string[];
}

/** A relative import specifier that named no module the scanner could find. */
export interface UnresolvedImport {
  /** Importing module, srcRoot-relative POSIX path. */
  file: string;
  /** The specifier exactly as written. */
  specifier: string;
  /** 1-based line of the import/export statement. */
  line: number;
}

/** The value-import graph of a source tree. */
export interface ImportGraph {
  /** Every scanned module, srcRoot-relative POSIX paths, sorted. */
  files: string[];
  /** Adjacency: module → the modules it imports at RUNTIME, sorted. */
  edges: Map<string, string[]>;
  /**
   * Relative specifiers that resolved to nothing on disk. Not cycles and not a
   * gate failure — but reported rather than swallowed, because a resolver that
   * silently stopped resolving would turn this gate into a no-op that always
   * passes (DR-066: no silent gate). The test suite pins this at zero for the
   * real tree, so a regression in resolution fails visibly.
   */
  unresolved: UnresolvedImport[];
}

/**
 * Top-level directories under the src root that are exempt from the layering and
 * cycle rules (SPEC-040 design, "allowed-edge set"): the integration tests and the
 * benchmarks legitimately import across every layer.
 */
const EXEMPT_TOP_LEVEL_DIRS = new Set(['test', '__benchmarks__']);

/**
 * Every failure raised by the scanner carries this prefix, so a CI log line can be
 * traced to this module without guessing. These are THROWN, never collected: each
 * one means the scanner could not read some part of the tree, and a scan that
 * covered less than the whole tree has not proved that tree acyclic. Reporting
 * "0 cycles" over a silently smaller input is precisely the silent gate DR-066
 * forbids, so the honest outcome is a loud stop. `scripts/check-import-cycles.ts`
 * catches these, prints them in full, and exits non-zero.
 */
function scanFailure(message: string): Error {
  return new Error(`import-cycle-check: ${message}`);
}

/** Deterministic total order over srcRoot-relative paths. */
function compareFiles(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Extensions whose files are real modules the scanner reads. `.mts` and `.cts` are
 * ordinary TypeScript modules with their module format pinned (ESM and CommonJS
 * respectively). They were absent from this list until review caught it, which
 * made any cycle running through one invisible: no node, no edge, no warning —
 * and the tree has none today only by accident, not by rule.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

/**
 * Declaration extensions. A declaration file is erased wholesale by the compiler,
 * so its imports create no runtime edge — counting them would invent cycles that
 * cannot exist at runtime. They still appear among the resolution candidates
 * (below) so that a specifier ANSWERED by a declaration reads as resolved rather
 * than as a broken import.
 */
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts'] as const;

/**
 * A module file contributes nodes and edges; a declaration file does not. The
 * declaration test runs first because `x.d.ts` also ends with `.ts`.
 */
function isModuleFile(name: string): boolean {
  if (DECLARATION_EXTENSIONS.some((extension) => name.endsWith(extension))) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** What a directory entry turns out to be once symlinks are followed. */
type EntryKind = 'directory' | 'file' | 'ignore';

/**
 * Classify one directory entry, FOLLOWING symlinks.
 *
 * `readdirSync` reports a symlink as its own type and never as its target's:
 * `isDirectory()` and `isFile()` are both false for a link. So a symlinked module
 * — or a symlinked directory holding a dozen of them — used to fall through every
 * branch of the walk and vanish from the graph with nothing printed anywhere. That
 * is the worst shape of blind spot: the gate passes because it never looked.
 * `fs.statSync` follows the link and yields the target's kind, which is all the
 * walk needs to treat linked content exactly like real content.
 *
 * A link that answers to nothing (dangling, or unreadable) is a broken tree, and a
 * broken tree is a smaller scan. It throws rather than shrinking the module set.
 * The same goes for a socket/FIFO/device named like a module: it cannot be read as
 * TypeScript, and pretending it is not there would hide whatever it displaced. An
 * entry that is neither a module by name nor a directory is simply not this gate's
 * business and is ignored, exactly as a `.md` or a `.json` always has been.
 */
function classifyEntry(absolute: string, entry: fs.Dirent, rel: string): EntryKind {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';

  if (entry.isSymbolicLink()) {
    let target: fs.Stats;
    try {
      target = fs.statSync(absolute);
    } catch (error) {
      throw scanFailure(
        `${rel} is a symlink the scanner cannot follow (${
          error instanceof Error ? error.message : String(error)
        }). A link it cannot follow is a file or subtree it cannot scan, and an ` +
          'unscanned subtree cannot be proved acyclic — repair or remove the link.',
      );
    }
    if (target.isDirectory()) return 'directory';
    if (target.isFile()) return 'file';
  }

  if (isModuleFile(entry.name)) {
    throw scanFailure(
      `${rel} is named like a TypeScript module but is not a readable file (it is a ` +
        'socket, FIFO, device, or a link to one). The scanner cannot read it, so it ' +
        'cannot vouch for the edges it might contain — remove it or rename it.',
    );
  }
  return 'ignore';
}

/**
 * Every scannable module under `srcRoot`, as sorted srcRoot-relative POSIX paths.
 *
 * Symlinked directories are walked like real ones (see `classifyEntry`), which
 * introduces the one hazard real directories do not have: a link pointing back up
 * the tree makes the filesystem cyclic, and a naive walk would recurse until the
 * stack dies. `fs.realpathSync` de-aliases every directory before it is entered,
 * so a directory reachable twice is caught on entry and reported — a repository
 * where the same modules appear under two paths cannot be scanned coherently
 * (their srcRoot-relative names, which ARE the graph's node ids, would differ per
 * route), so this stops rather than guesses which route is canonical.
 */
function collectModules(srcRoot: string): string[] {
  const out: string[] = [];
  const visitedDirs = new Set<string>([fs.realpathSync(srcRoot)]);

  const walk = (dir: string, prefix: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const segments = [...prefix, entry.name];
      const rel = segments.join('/');
      const absolute = path.join(dir, entry.name);
      const kind = classifyEntry(absolute, entry, rel);

      if (kind === 'directory') {
        // Exemption is anchored at the src root: `src/test/**`, not any nested
        // directory that happens to be called `test`. Checked before the realpath
        // work so an exempt tree is never even stat-ed.
        if (segments.length === 1 && EXEMPT_TOP_LEVEL_DIRS.has(entry.name)) continue;
        const real = fs.realpathSync(absolute);
        if (visitedDirs.has(real)) {
          throw scanFailure(
            `${rel} is a symlink to a directory already being scanned (${real}). Following ` +
              'it would either walk forever or file the same modules under two names, so ' +
              'the graph cannot be built — remove the link, or make the shared code a real ' +
              'directory imported by both sides.',
          );
        }
        visitedDirs.add(real);
        walk(absolute, segments);
      } else if (kind === 'file' && isModuleFile(entry.name)) {
        out.push(rel);
      }
    }
  };

  walk(srcRoot, []);
  return out.sort(compareFiles);
}

/**
 * Does this `import` declaration survive to runtime?
 *
 * - `import './x'` (no clause) — a pure side-effect import. Always a runtime edge.
 * - `import type { X } from './x'` — erased. No edge.
 * - `import { type X, y } from './x'` — the `type X` specifier contributes nothing;
 *   `y` keeps the edge. An import whose specifiers are ALL type-only is erased
 *   entirely by the compiler, so it is no edge either.
 */
function importDeclarationIsValue(decl: ts.ImportDeclaration): boolean {
  const clause = decl.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

/**
 * Does this `export … from` re-export survive to runtime?
 *
 * DELIBERATE CHOICE: a value re-export IS a runtime edge and is counted. `export
 * { getHtml } from './spec-panel-html'` makes the re-exporting module load its
 * target at require time exactly as an `import` would, so a cycle closed through a
 * re-export is every bit as real as one closed through an import — excluding them
 * would be a hole in the gate. Type-only forms (`export type { X } from './y'`,
 * `export type * from './y'`) are erased and contribute nothing.
 */
function exportDeclarationIsValue(decl: ts.ExportDeclaration): boolean {
  if (decl.isTypeOnly) return false;
  const clause = decl.exportClause;
  if (!clause) return true; // `export * from './y'`
  if (ts.isNamespaceExport(clause)) return true; // `export * as ns from './y'`
  return clause.elements.some((element) => !element.isTypeOnly);
}

/**
 * The module specifier of an `import x = require('./y')`, if that form survives to
 * runtime.
 *
 * TypeScript's CommonJS-flavoured import. It compiles to a literal `require` call
 * at module scope — the very call a require cycle deadlocks on — so it is as real
 * an edge as any `import` statement, and it went uncounted here until review:
 * `valueSpecifiers` visited only import and export DECLARATIONS, so this form
 * produced neither an edge nor an `unresolved` entry and a genuine require cycle
 * through it passed green.
 *
 * `import type x = require('./y')` is erased like any other type-only import. An
 * `import x = A.B.C` names a local entity rather than a module and is no edge at
 * all — hence the `isExternalModuleReference` test, which also narrows the node so
 * its `.expression` can be read without a cast.
 */
function importEqualsSpecifier(decl: ts.ImportEqualsDeclaration): ts.Expression | undefined {
  if (decl.isTypeOnly) return undefined;
  if (!ts.isExternalModuleReference(decl.moduleReference)) return undefined;
  return decl.moduleReference.expression;
}

/** A module specifier that survives to runtime, with its source line. */
interface ValueSpecifier {
  specifier: string;
  line: number;
}

/**
 * The runtime-surviving module specifiers of one source file. Import, export and
 * `import =` declarations are top-level by language rule, so scanning `statements`
 * is both complete and cheap — no full-tree walk.
 *
 * Dynamic `import('./x')` is deliberately NOT counted: it is evaluated on call,
 * not at module load, so it cannot produce the partially-initialised-module
 * failure this gate exists to prevent.
 *
 * A bare `require('./x')` CALL is not counted either, and that one is a real,
 * DOCUMENTED dependency on another gate rather than a judgement about semantics —
 * such a call is a runtime load and would deserve an edge. It cannot occur in the
 * scanned package because `@typescript-eslint/no-require-imports` is an ERROR
 * here: it arrives with `tsPlugin.configs.recommended.rules` in
 * `eslint.config.mjs`, applied to every `.ts` file under a package's `src`.
 * Catching it directly would mean walking every expression in every file, since a
 * call can sit anywhere. Two ways that borrowed guarantee can lapse, both of which
 * oblige this function to grow that walk: the rule being relaxed or removed, and
 * the lint glob failing to cover a file this scanner does scan — note that glob
 * ends in `.ts` specifically, so a `.tsx`, `.mts` or `.cts` module is scanned here
 * but NOT linted there. There are none today; if one appears, fix this before
 * trusting the gate.
 *
 * (The glob is spelled out in prose rather than quoted verbatim on purpose: its
 * literal form contains the block-comment terminator, which silently ended this
 * comment mid-sentence and turned the rest of it into code.)
 */
function valueSpecifiers(sourceFile: ts.SourceFile): ValueSpecifier[] {
  const out: ValueSpecifier[] = [];
  const record = (moduleSpecifier: ts.Expression | undefined, node: ts.Node): void => {
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return;
    const { line } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
    out.push({ specifier: moduleSpecifier.text, line: line + 1 });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (importDeclarationIsValue(statement)) record(statement.moduleSpecifier, statement);
    } else if (ts.isExportDeclaration(statement)) {
      // No module specifier ⇒ a local re-export (`export { a }`), not an edge.
      if (statement.moduleSpecifier && exportDeclarationIsValue(statement)) {
        record(statement.moduleSpecifier, statement);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      record(importEqualsSpecifier(statement), statement);
    }
  }
  return out;
}

/**
 * Is this specifier relative — does it name something inside this tree?
 *
 * All four dot-forms count. `'.'` and `'..'` name a DIRECTORY (resolved through
 * its `index` barrel) and used to fail a bare `startsWith('./')` test, returning
 * `external` before resolution was ever attempted; `'./'` and `'../'` passed that
 * test but then carried their trailing slash into the candidate list (see
 * `normalizeBase`). Either way an edge through a barrel was invisible, with
 * nothing in `unresolved` to betray it — a blind spot that hid itself (DR-066).
 */
function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

/**
 * Normalise a joined specifier into a candidate base with NO trailing slash.
 *
 * `path.posix.normalize` preserves a trailing slash (`'lib/'` stays `'lib/'`), and
 * a trailing slash poisons every candidate built from it: `'lib/'` + `'.ts'` is
 * `'lib/.ts'`, `'lib/'` + `'/index.ts'` is `'lib//index.ts'`. The second is the
 * dangerous one — `path.join` collapses the empty segment, so the `existsSync`
 * fallback MATCHES a real `lib/index.ts` and the specifier is filed as `external`
 * rather than `unresolved`. The gate then loses the edge AND the warning that
 * would have revealed the loss. Stripping the slash here lets all four dot-forms
 * run through the ordinary candidate path instead.
 *
 * The empty result (`'./'` from a file at the root normalises to `'.'`, and
 * `'lib/'` relative to nothing could reduce further) is mapped to `'.'`, the src
 * root itself, which `resolutionCandidates` handles explicitly.
 */
function normalizeBase(joined: string): string {
  const normalized = path.posix.normalize(joined).replace(/\/+$/, '');
  return normalized === '' ? '.' : normalized;
}

/**
 * NodeNext-style specifiers name the EMITTED file; each maps back to the sources
 * that could produce it. `.js` can come from `.ts` or `.tsx`; `.mjs` comes only
 * from `.mts` and `.cjs` only from `.cts` — the format-pinned extensions do not
 * cross over, and mapping them to `.ts` would invent an edge to a different file.
 */
const EMITTED_TO_SOURCES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.mjs', ['.mts', '.d.mts']],
  ['.cjs', ['.cts', '.d.cts']],
  ['.js', ['.ts', '.tsx', '.d.ts']],
];

/** Extensions tried for an extensionless specifier, sources before declarations. */
const EXTENSIONLESS_CANDIDATES: readonly string[] = [
  ...SOURCE_EXTENSIONS,
  ...DECLARATION_EXTENSIONS,
];

/** Barrel filenames tried when a specifier names a directory. */
const BARREL_CANDIDATES: readonly string[] = EXTENSIONLESS_CANDIDATES.map(
  (extension) => `index${extension}`,
);

/**
 * The on-disk paths a specifier could name, in TypeScript's resolution order.
 * `./x` → `x.ts`, `x.tsx`, `x.mts`, `x.cts`, the declaration forms, then the
 * `x/index.*` barrels. An explicit extension maps back to its source: `./x.js` →
 * `x.ts`/`x.tsx`/`x.d.ts` (the NodeNext style), `./x.mjs` → `x.mts`, `./x.cjs` →
 * `x.cts`.
 *
 * `'.'` — the tree root itself, reached by `'.'`/`'./'` from a root-level file or
 * `'..'`/`'../'` from a subdirectory — has ONLY the barrel forms: no file is named
 * the empty string, and the old code built `'.ts'` and `'/index.ts'` candidates
 * from it.
 *
 * The declaration candidates exist so a specifier answered by a declaration file
 * is recognised as resolving — they are never scanned modules (see `isModuleFile`),
 * so they yield no edge, but they must not be mistaken for a broken import.
 *
 * The extensionless list is deliberately a SUPERSET of what `tsc` itself would try
 * (which stops at `.ts`/`.tsx`/`.d.ts`). For a cycle gate the safe direction of
 * error is seeing an edge that is not there rather than missing one that is, and
 * an extra candidate can only fire on a specifier the compiler already rejects —
 * i.e. in a tree that does not build, where a spurious cycle report is the least
 * of the problems.
 */
function resolutionCandidates(baseRel: string): string[] {
  if (baseRel === '.') return [...BARREL_CANDIDATES];
  if (SOURCE_EXTENSIONS.some((extension) => baseRel.endsWith(extension))) return [baseRel];

  const emitted = EMITTED_TO_SOURCES.find(([extension]) => baseRel.endsWith(extension));
  if (emitted) {
    const [extension, sources] = emitted;
    const stem = baseRel.slice(0, -extension.length);
    return sources.map((source) => `${stem}${source}`);
  }

  return [
    ...EXTENSIONLESS_CANDIDATES.map((extension) => `${baseRel}${extension}`),
    ...BARREL_CANDIDATES.map((barrel) => `${baseRel}/${barrel}`),
  ];
}

type Resolution =
  /** Names a scanned module — a real in-tree edge. */
  | { kind: 'module'; target: string }
  /** Names nothing in this tree (a package, an exempt file, a path above the root). */
  | { kind: 'external' }
  /** Relative, in-tree — and nothing on disk answers to it. */
  | { kind: 'unresolved' };

/**
 * Resolve one specifier against the scanned module set.
 *
 * Bare specifiers (`vscode`, `@aiclarity/shared`, `fs`) are external by
 * definition — they are not in-package edges and cannot participate in an
 * in-package cycle. A relative specifier that escapes the src root is external
 * for the same reason.
 *
 * A specifier naming a file that EXISTS but is deliberately not scanned (the
 * exempt `test/**` and `__benchmarks__/**` trees) is external, not unresolved —
 * hence the disk check before calling anything unresolved.
 */
function resolveSpecifier(
  srcRoot: string,
  fromRel: string,
  specifier: string,
  moduleSet: ReadonlySet<string>,
): Resolution {
  if (!isRelativeSpecifier(specifier)) return { kind: 'external' };
  const baseRel = normalizeBase(path.posix.join(path.posix.dirname(fromRel), specifier));
  if (baseRel === '..' || baseRel.startsWith('../')) return { kind: 'external' };

  const candidates = resolutionCandidates(baseRel);
  const target = candidates.find((candidate) => moduleSet.has(candidate));
  if (target) return { kind: 'module', target };
  const onDisk = candidates.some((candidate) =>
    fs.existsSync(path.join(srcRoot, ...candidate.split('/'))),
  );
  return onDisk ? { kind: 'external' } : { kind: 'unresolved' };
}

/**
 * The shape of the parser's own error list on a `SourceFile`.
 *
 * `parseDiagnostics` is marked `@internal` in the shipped `typescript` typings, so
 * it has to be reached through a structural cast. The alternative is building a
 * whole `ts.Program` just to call `getSyntacticDiagnostics` — which would resolve
 * every import through the real module resolver and drag in tsconfig state, far
 * heavier than this gate and squarely against its "fs + path + parser" budget.
 */
interface ParsedSourceFile {
  parseDiagnostics?: ts.DiagnosticWithLocation[];
}

/**
 * Stop unless the file parsed cleanly.
 *
 * A file the parser could not read yields an empty (or truncated) `statements`
 * array, which `valueSpecifiers` reports as "no imports" — indistinguishable from
 * a genuinely import-free module. Every edge in it, and therefore any cycle
 * through it, disappears silently. So a parse error fails the scan outright rather
 * than being treated as edge-free (DR-066); `tsc` will have plenty to say about
 * the same file, but this gate must not pass while pretending it looked.
 *
 * The missing-property branch matters as much as the diagnostics branch: if a
 * future `typescript` renames or drops this internal, `?? []` would quietly retire
 * the check and leave a gate that only appeared to run. It fails loudly instead,
 * naming the coupling that broke.
 */
function assertParsed(sourceFile: ts.SourceFile, rel: string): void {
  const diagnostics = (sourceFile as unknown as ParsedSourceFile).parseDiagnostics;
  if (!Array.isArray(diagnostics)) {
    throw scanFailure(
      'this `typescript` build does not expose the internal `SourceFile.parseDiagnostics`, ' +
        'so a file that failed to parse could not be told apart from one with no imports. ' +
        'Re-point `assertParsed` at whatever replaced it before trusting this gate again.',
    );
  }
  if (diagnostics.length === 0) return;

  const first = diagnostics[0];
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, first.start);
  throw scanFailure(
    `${rel}:${line + 1}:${character + 1}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')} ` +
      `(${diagnostics.length} parse error(s) in this file). A file the parser cannot read ` +
      'contributes no edges, so scanning on would report "0 cycles" over a graph with a ' +
      'hole in it — fix the syntax and re-run.',
  );
}

/**
 * Build the value-import graph of the TypeScript source tree rooted at `srcRoot`
 * (e.g. `packages/minspec/src`). Every node and edge key is a srcRoot-relative
 * POSIX path, so output is stable across platforms and checkout locations.
 *
 * Throws — rather than returning a partial graph — if any part of the tree cannot
 * be walked or parsed. See `scanFailure`.
 */
export function buildValueImportGraph(srcRoot: string): ImportGraph {
  const files = collectModules(srcRoot);
  const moduleSet = new Set(files);
  const edges = new Map<string, string[]>();
  const unresolved: UnresolvedImport[] = [];

  for (const rel of files) {
    const absolute = path.join(srcRoot, ...rel.split('/'));
    const sourceFile = ts.createSourceFile(
      absolute,
      fs.readFileSync(absolute, 'utf-8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    assertParsed(sourceFile, rel);
    const targets = new Set<string>();
    for (const { specifier, line } of valueSpecifiers(sourceFile)) {
      const resolution = resolveSpecifier(srcRoot, rel, specifier, moduleSet);
      if (resolution.kind === 'module') targets.add(resolution.target);
      else if (resolution.kind === 'unresolved') unresolved.push({ file: rel, specifier, line });
    }
    edges.set(rel, [...targets].sort(compareFiles));
  }

  return { files, edges, unresolved };
}

/**
 * Iterative three-color DFS over the value-import graph. WHITE unvisited, GRAY on
 * the active path, BLACK fully explored; a back-edge to a GRAY node is a cycle,
 * and the `activePath` mirror of the gray chain names its exact members. Explicit
 * stack, never recursion. Roots and neighbours are both traversed in sorted
 * order, so identical input always yields byte-identical output — a CI failure
 * reproduces exactly.
 */
export function detectImportCycles(graph: ImportGraph): ImportCycle[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const file of graph.files) color.set(file, WHITE);

  const out: ImportCycle[] = [];
  const reported = new Set<string>();

  for (const root of graph.files) {
    if (color.get(root) !== WHITE) continue;
    // Each frame tracks its own neighbour cursor; `path` mirrors the gray chain.
    const stack: Array<{ id: string; i: number }> = [{ id: root, i: 0 }];
    const activePath: string[] = [root];
    color.set(root, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = graph.edges.get(frame.id) ?? [];
      if (frame.i < neighbours.length) {
        const next = neighbours[frame.i];
        frame.i++;
        const c = color.get(next);
        if (c === GRAY) {
          // Back-edge into the active path ⇒ cycle. Members = the path slice
          // from the re-entered node onward, in traversal order.
          const members = activePath.slice(activePath.indexOf(next));
          // Dedupe on the member SET: the same loop reached from a different
          // entry point is the same defect, reported once.
          const key = [...members].sort(compareFiles).join('|');
          if (!reported.has(key)) {
            reported.add(key);
            out.push({ members });
          }
        } else if (c === WHITE) {
          color.set(next, GRAY);
          activePath.push(next);
          stack.push({ id: next, i: 0 });
        }
        // BLACK ⇒ already fully explored; nothing reachable through it is on the
        // active path, so it can close no cycle.
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
        activePath.pop();
      }
    }
  }

  return out;
}

/**
 * Every runtime (value-import) cycle among the modules under `srcRoot`. Empty
 * array ⇒ the tree is acyclic at runtime. Pure: reads the filesystem, touches
 * nothing else.
 */
export function findValueImportCycles(srcRoot: string): ImportCycle[] {
  return detectImportCycles(buildValueImportGraph(srcRoot));
}
