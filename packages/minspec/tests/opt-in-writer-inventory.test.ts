/**
 * T0 - SPEC-096 FR-9: every directory the extension creates goes through one
 * operation, and this test fails when a new call is added that does not.
 *
 * WHY IT EXISTS. `.minspec/` at a workspace-folder root is the opt-in marker
 * (constitution invariant 3, DR-074). Issue #2364 listed ten writers that each ran
 * their own `mkdir -p .minspec/...`; the trace in SPEC-096 found an eleventh the list
 * had missed, plus a twelfth route through a setting. A list fixed by hand says
 * nothing about the next one, so the rule is pinned here as a property of the whole
 * source tree instead: a direct call to an API that can bring a directory into
 * existence may appear only in the five places FR-4 names, and everything else uses
 * `ensureDirectory` (`src/lib/opt-in.ts`), which cannot create the marker.
 *
 * PART 1 - THE INVENTORY (static). Every `.ts` file under `packages/minspec/src`
 * (bar `test/` and `__benchmarks__/`) and `packages/shared/src` is parsed, and every
 * call to `mkdir`, `mkdtemp`, `cp`, `rename` or `symlink` (sync, callback or promise
 * form), every use of `vscode.workspace.fs` and every workspace edit is collected
 * with the function it sits in. The result must equal {@link INVENTORY} exactly, in
 * both directions.
 *
 * PART 2 - THE CREATOR'S CALLERS (static, FR-3). The one call that may create the
 * marker lives in `scaffold()`. Who calls `scaffold()` is pinned too, so "only
 * Initialize reaches it" cannot quietly stop being true.
 *
 * PART 3 - THE WRITERS BEHIND THE INVENTORY (behavioural, FR-5). Each store that used
 * to create `.minspec/` is driven directly, on real temp folders: with no marker it
 * throws the refusal and creates nothing; with a marker it writes the bytes it wrote
 * before. Part 1 proves the call was rerouted; Part 3 proves what the rerouted writer
 * now does. The marker is varied three ways (absent; present; present but holding
 * only `preferences.json`, the #2365 residue) and so is the root (a folder; no folder
 * at all).
 *
 * WHAT THIS CANNOT SEE (FR-9 states these limits; they are not oversights).
 *   - A call made through an alias this file does not recognise. It catches the three
 *     plain ways to rename one of these functions; a computed property name or a
 *     wrapper in another package gets past it.
 *   - A directory created by a spawned process. The modules that can start one are
 *     enumerated by `SPAWN_ALLOWLIST` in `invariants.test.ts`.
 *   - A plain file write. One cannot create a directory, though a FILE written at the
 *     path `.minspec` would satisfy the predicate, which tests existence only. No code
 *     writes one, and the full directory listings in
 *     `commands-opt-in-invariant.test.ts` are what would show it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';
import { useShellTimeout } from './helpers/shell-timeout';

import { saveSession, type SessionState } from '../src/lib/session';
import { saveCalibration, recordOverride, loadCalibration } from '../src/lib/classifier';
import { appendToParkingLotFile, type ParkingLotEntry } from '../src/lib/parking-lot';
import { approveSpec, GZIP_MARKER, refKey, type ApprovalRecord } from '../src/lib/approval';
import { writeRecord, sidecarPath } from '../src/lib/approval-store';
import { enqueuePhaseAdvance, queueRequestPath } from '../src/lib/phase-advance-queue';
import { saveTraceability, type TraceabilityData } from '../src/lib/traceability';
import { saveHashes, saveTemplateBaseline, loadHashes } from '../src/lib/merge-refresh';
import { scaffold, generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';
// The refusal error is imported from the module that exported it BEFORE this spec,
// so this file loads on the pre-change tree and fails there for the real reason
// (the writers create the marker), not for a missing module.
import { NotOptedInError } from '../src/lib/preferences';

// #1285: the approveSpec cases run real `git` child processes, and Part 2 parses the
// whole source tree once per test. Under load the 5s default measures the runner, not
// a hang. At module scope, where the raise takes effect (#1399).
useShellTimeout();

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

/** The two trees FR-9 names, as repo-relative POSIX prefixes. */
const SCAN_ROOTS = ['packages/minspec/src', 'packages/shared/src'] as const;

// ─── Part 1: the inventory ──────────────────────────────────────────────────

/**
 * APIs that can bring a directory into existence. The same five names cover the
 * sync, callback and promise forms: `fs.mkdir(...)`, `fs.promises.mkdir(...)` and
 * `fsp.mkdir(...)` are all a call whose callee ends in `mkdir`.
 */
const DIRECTORY_CREATING_APIS: ReadonlySet<string> = new Set([
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
]);

/**
 * Names specific enough that a mention which is NOT a call is suspicious: it is how
 * one of these functions gets passed around under another name. `rename` and `cp`
 * are left out because they are ordinary words for a property (a quick-pick item in
 * `backfill-epics.ts` has a `rename` field).
 */
const UNAMBIGUOUS_API_NAMES: ReadonlySet<string> = new Set([
  'mkdirSync',
  'mkdtempSync',
  'cpSync',
  'renameSync',
  'symlinkSync',
  'mkdir',
  'mkdtemp',
  'symlink',
]);

interface AllowedCall {
  /** The API name, exactly as the source spells the callee's last segment. */
  readonly api: string;
  /** The nearest enclosing named function or method. */
  readonly within: string;
  /** Why this direct call is allowed to stay (FR-4). */
  readonly why: string;
}

/**
 * The ONE declared inventory: every direct directory-creating call FR-4 permits.
 * Adding a call anywhere else, or a second call in one of these files, fails
 * Part 1. The fix is almost always to call `ensureDirectory` instead, not to add a
 * row here.
 */
const INVENTORY: Readonly<Record<string, readonly AllowedCall[]>> = {
  'packages/minspec/src/lib/opt-in.ts': [
    {
      api: 'mkdirSync',
      within: 'ensureDirectory',
      why:
        'The guarded operation itself (FR-1, FR-2). One level at a time, never recursive, ' +
        'and never for a component named .minspec.',
    },
  ],
  'packages/minspec/src/lib/scaffold.ts': [
    {
      api: 'mkdirSync',
      within: 'scaffold',
      why:
        'THE creator (FR-3): the only call that may create .minspec/ under a workspace ' +
        'folder. Reached from Initialize and from nowhere else (Part 2 pins the callers).',
    },
  ],
  'packages/minspec/src/lib/approval-recover.ts': [
    {
      api: 'mkdtempSync',
      within: 'recoverProtectedBranchApproval',
      why: 'A fresh directory under the OS temp directory, to hold a git worktree.',
    },
    {
      api: 'mkdirSync',
      within: 'recoverProtectedBranchApproval',
      why:
        'Parents of the approval files copied INTO that temp worktree. Not a workspace ' +
        'folder: the guard would (rightly) refuse to create .minspec/approvals there.',
    },
  ],
  'packages/minspec/src/commands/push-docs-lane.ts': [
    {
      api: 'mkdtempSync',
      within: 'pushDocsLaneCommand',
      why: 'A fresh directory under the OS temp directory, to hold a git worktree.',
    },
    {
      api: 'mkdirSync',
      within: 'pushDocsLaneCommand',
      why: 'Parents of the docs files copied INTO that temp worktree. Not a workspace folder.',
    },
  ],
  'packages/minspec/src/lib/presence.ts': [
    {
      api: 'renameSync',
      within: 'writeHeartbeat',
      why:
        'The atomic heartbeat write: a FILE renamed inside .minspec/sessions/, which the ' +
        'guard has just made sure exists. Renaming a file cannot create a directory.',
    },
  ],
};

interface FoundCall {
  readonly api: string;
  readonly within: string;
  readonly line: number;
}

interface FileScan {
  readonly calls: FoundCall[];
  /** Non-call mentions that could carry one of the APIs off under another name. */
  readonly aliases: string[];
}

/** Strip the wrappers a callee can hide behind: `(x)`, `x!`, `x as T`, `<T>x`. */
function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e)) e = e.expression;
    else if (ts.isNonNullExpression(e)) e = e.expression;
    else if (ts.isAsExpression(e)) e = e.expression;
    else if (ts.isTypeAssertionExpression(e)) e = e.expression;
    else return e;
  }
}

/** The last segment of a callee: `fs.promises.mkdir` -> `mkdir`, `mkdirSync` -> `mkdirSync`. */
function lastName(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
    return e.argumentExpression.text;
  }
  return undefined;
}

/** `vscode.workspace.fs`, `workspace.fs`, `vscode.workspace['fs']`. */
function isWorkspaceFs(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'fs') {
    return lastName(node.expression) === 'workspace';
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === 'fs'
  ) {
    return lastName(node.expression) === 'workspace';
  }
  return false;
}

/** Scan one source text. Pure, so it can be pointed at invented inputs as well. */
function scanSource(fileName: string, text: string): FileScan {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const calls: FoundCall[] = [];
  const aliases: string[] = [];
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node, enclosing: string): void => {
    let scope = enclosing;
    if (ts.isFunctionDeclaration(node) && node.name) scope = node.name.text;
    else if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
    ) {
      scope = node.name.text;
    } else if (ts.isConstructorDeclaration(node)) scope = 'constructor';

    if (ts.isCallExpression(node)) {
      const api = lastName(node.expression);
      if (api !== undefined && DIRECTORY_CREATING_APIS.has(api)) {
        calls.push({ api, within: scope, line: lineOf(node) });
      }
      if (api === 'applyEdit') calls.push({ api: 'workspace.applyEdit', within: scope, line: lineOf(node) });
    }
    if (isWorkspaceFs(node)) calls.push({ api: 'vscode.workspace.fs', within: scope, line: lineOf(node) });
    if (ts.isIdentifier(node) && node.text === 'WorkspaceEdit' && !ts.isImportSpecifier(node.parent)) {
      calls.push({ api: 'WorkspaceEdit', within: scope, line: lineOf(node) });
    }

    // Aliases. (1) a renamed import: `import { mkdirSync as make } from 'fs'`.
    if (ts.isImportSpecifier(node) && node.propertyName && DIRECTORY_CREATING_APIS.has(node.propertyName.text)) {
      aliases.push(`line ${lineOf(node)}: import { ${node.propertyName.text} as ${node.name.text} }`);
    }
    // (2) a renamed destructure: `const { mkdirSync: make } = fs`.
    if (
      ts.isBindingElement(node) &&
      node.propertyName &&
      (ts.isIdentifier(node.propertyName) || ts.isStringLiteralLike(node.propertyName)) &&
      DIRECTORY_CREATING_APIS.has(node.propertyName.text)
    ) {
      aliases.push(`line ${lineOf(node)}: { ${node.propertyName.text}: ${node.name.getText(sf)} }`);
    }
    // (3) the function taken as a value: `const make = fs.mkdirSync`, `run(fs.mkdirSync)`.
    if (
      (ts.isPropertyAccessExpression(node) && UNAMBIGUOUS_API_NAMES.has(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        UNAMBIGUOUS_API_NAMES.has(node.argumentExpression.text))
    ) {
      let outer: ts.Node = node;
      while (
        ts.isParenthesizedExpression(outer.parent) ||
        ts.isNonNullExpression(outer.parent) ||
        ts.isAsExpression(outer.parent) ||
        ts.isTypeAssertionExpression(outer.parent)
      ) {
        outer = outer.parent;
      }
      const isCallee = ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
      if (!isCallee) aliases.push(`line ${lineOf(node)}: ${node.getText(sf)} used as a value`);
    }

    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sf, '<module>');
  return { calls, aliases };
}

/** Every `.ts` file under `dir`, skipping the two directories FR-9 excludes. */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  // No existence check and no try/catch: a root that cannot be read must fail the
  // test, never quietly contribute zero files (INV-2).
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__benchmarks__') continue;
      out.push(...tsFilesUnder(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const toRepoRel = (abs: string): string => path.relative(REPO_ROOT, abs).split(path.sep).join('/');
const describeCall = (c: { api: string; within: string }): string => `${c.api} in ${c.within}()`;

describe('SPEC-096 FR-9: the scanner sees what it claims to see (invented inputs)', () => {
  const found = (text: string): string[] => scanSource('probe.ts', text).calls.map(describeCall);

  it('finds each API in its sync, callback and promise forms', () => {
    expect(
      found(`
        import * as fs from 'fs';
        import { promises as fsp } from 'fs';
        export function a(p: string) { fs.mkdirSync(p, { recursive: true }); }
        export function b(p: string) { fs.mkdir(p, () => undefined); }
        export async function c(p: string) { await fs.promises.mkdir(p); await fsp.mkdtemp(p); }
        export function d(p: string, q: string) { fs.cpSync(p, q); fs.renameSync(p, q); fs.symlinkSync(p, q); }
        export async function e(p: string, q: string) { await fsp.cp(p, q); await fsp.rename(p, q); await fsp.symlink(p, q); }
        export function f(p: string) { return fs.mkdtempSync(p); }
      `),
    ).toEqual([
      'mkdirSync in a()',
      'mkdir in b()',
      'mkdir in c()',
      'mkdtemp in c()',
      'cpSync in d()',
      'renameSync in d()',
      'symlinkSync in d()',
      'cp in e()',
      'rename in e()',
      'symlink in e()',
      'mkdtempSync in f()',
    ]);
  });

  it('finds a call however the callee is written', () => {
    expect(
      found(`
        import { mkdirSync } from 'fs';
        import * as fs from 'fs';
        export function bare(p: string) { mkdirSync(p); }
        export function element(p: string) { fs['mkdirSync'](p); }
        export function optional(p: string) { fs?.mkdirSync?.(p); }
        export function wrapped(p: string) { (fs.mkdirSync as (x: string) => void)(p); fs.mkdirSync!(p); }
        export class Store { save(p: string) { fs.mkdirSync(p); } get dir() { fs.mkdirSync('x'); return 'x'; } }
        export const arrow = (p: string) => fs.mkdirSync(p);
        export function outer(p: string) { const inner = () => fs.mkdirSync(p); inner(); }
      `),
    ).toEqual([
      'mkdirSync in bare()',
      'mkdirSync in element()',
      'mkdirSync in optional()',
      'mkdirSync in wrapped()',
      'mkdirSync in wrapped()',
      'mkdirSync in save()',
      'mkdirSync in dir()',
      'mkdirSync in <module>()',
      'mkdirSync in outer()',
    ]);
  });

  it('finds a write through vscode.workspace.fs and a workspace edit', () => {
    expect(
      found(`
        import * as vscode from 'vscode';
        export async function a(u: vscode.Uri) { await vscode.workspace.fs.createDirectory(u); }
        export async function b(u: vscode.Uri) { await vscode.workspace.fs.writeFile(u, new Uint8Array()); }
        export async function c(u: vscode.Uri) {
          const edit = new vscode.WorkspaceEdit();
          edit.createFile(u);
          await vscode.workspace.applyEdit(edit);
        }
      `),
    ).toEqual([
      'vscode.workspace.fs in a()',
      'vscode.workspace.fs in b()',
      'WorkspaceEdit in c()',
      'workspace.applyEdit in c()',
    ]);
  });

  it('is not fooled by a comment, a string, a type or a look-alike name', () => {
    const scan = scanSource(
      'probe.ts',
      `
        // fs.mkdirSync(dir, { recursive: true }) used to live here
        /** mkdir -p its nested dir */
        const note = 'call fs.mkdirSync(x) and fs.renameSync(a, b)';
        interface Pick { rename?: 'done'; cp?: string }
        export function f(pick: Pick) { return pick.rename === 'done' ? note : pick.cp; }
        export function ensureDirectory(p: string) { return p; }
        export function g(w: { createFileSystemWatcher(p: string): void }) { w.createFileSystemWatcher('x'); }
      `,
    );
    expect(scan.calls).toEqual([]);
    expect(scan.aliases).toEqual([]);
  });

  it('reports the three plain ways to carry one of these functions off under another name', () => {
    const scan = scanSource(
      'probe.ts',
      `
        import { mkdirSync as make } from 'fs';
        import * as fs from 'fs';
        const { renameSync: move } = fs;
        const later = fs.mkdirSync;
        export function f(p: string) { make(p); move(p, p); later(p); [p].forEach(fs.mkdtempSync); }
      `,
    );
    expect(scan.aliases).toEqual([
      'line 2: import { mkdirSync as make }',
      'line 4: { renameSync: move }',
      'line 5: fs.mkdirSync used as a value',
      'line 6: fs.mkdtempSync used as a value',
    ]);
  });
});

describe('SPEC-096 FR-9: the inventory of directory-creating calls', () => {
  const scans = new Map<string, FileScan>();
  const filesPerRoot = new Map<string, number>();
  for (const scanRoot of SCAN_ROOTS) {
    const files = tsFilesUnder(path.join(REPO_ROOT, ...scanRoot.split('/')));
    filesPerRoot.set(scanRoot, files.length);
    for (const file of files) {
      scans.set(toRepoRel(file), scanSource(file, fs.readFileSync(file, 'utf-8')));
    }
  }

  it('scanned both source trees, and neither was empty', () => {
    // A scan that read nothing would report "no calls" and pass everything below.
    expect(filesPerRoot.get('packages/minspec/src') ?? 0).toBeGreaterThan(50);
    expect(filesPerRoot.get('packages/shared/src') ?? 0).toBeGreaterThan(0);
    // The exclusions are the two FR-9 names, and nothing wider.
    expect([...scans.keys()].some((f) => f.includes('/src/test/'))).toBe(false);
    expect([...scans.keys()].some((f) => f.includes('/__benchmarks__/'))).toBe(false);
  });

  it('holds exactly the entries FR-4 permits', () => {
    expect(Object.keys(INVENTORY).sort()).toEqual([
      'packages/minspec/src/commands/push-docs-lane.ts',
      'packages/minspec/src/lib/approval-recover.ts',
      'packages/minspec/src/lib/opt-in.ts',
      'packages/minspec/src/lib/presence.ts',
      'packages/minspec/src/lib/scaffold.ts',
    ]);
    for (const [file, allowed] of Object.entries(INVENTORY)) {
      expect(allowed.length, file).toBeGreaterThan(0);
      for (const call of allowed) {
        expect(DIRECTORY_CREATING_APIS.has(call.api), `${file}: ${call.api}`).toBe(true);
        expect(call.why.trim().length, `${file}: ${describeCall(call)} needs a reason`).toBeGreaterThan(20);
      }
    }
  });

  it('the creator entry is one call, in scaffold()', () => {
    expect(INVENTORY['packages/minspec/src/lib/scaffold.ts'].map(describeCall)).toEqual([
      'mkdirSync in scaffold()',
    ]);
  });

  it('every directory-creating call in the source is in the inventory, and every entry matches a call', () => {
    const actual: Record<string, string[]> = {};
    for (const [file, scan] of scans) {
      if (scan.calls.length > 0) actual[file] = scan.calls.map(describeCall).sort();
    }
    const expected: Record<string, string[]> = {};
    for (const [file, allowed] of Object.entries(INVENTORY)) {
      expected[file] = allowed.map(describeCall).sort();
    }
    // One equality covers all three failure directions FR-9 names: a file with a
    // call that is not in the inventory, a file whose calls differ in number or
    // kind, and an inventory entry with no matching call.
    expect(actual).toEqual(expected);
  });

  it('no directory-creating function is passed around under another name', () => {
    const aliased: Record<string, string[]> = {};
    for (const [file, scan] of scans) {
      if (scan.aliases.length > 0) aliased[file] = scan.aliases;
    }
    expect(aliased).toEqual({});
  });

  it('packages/shared/src creates no directory at all', () => {
    const shared = [...scans].filter(([file]) => file.startsWith('packages/shared/src/'));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.filter(([, scan]) => scan.calls.length > 0).map(([file]) => file)).toEqual([]);
  });
});

// ─── Part 2: who calls the creator (FR-3) ───────────────────────────────────

describe('SPEC-096 FR-3: scaffold() is reached from Initialize and from nowhere else', () => {
  /** Every call to `name(...)` in the minspec source, as `file @ enclosing function`. */
  function callersOf(name: string): string[] {
    const out: string[] = [];
    const files = tsFilesUnder(path.join(PACKAGE_ROOT, 'src'));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node, enclosing: string): void => {
        let scope = enclosing;
        if (ts.isFunctionDeclaration(node) && node.name) scope = node.name.text;
        else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) scope = node.name.text;
        if (ts.isCallExpression(node) && lastName(node.expression) === name) {
          out.push(`${path.relative(path.join(PACKAGE_ROOT, 'src'), file).split(path.sep).join('/')} @ ${scope}`);
        }
        ts.forEachChild(node, (child) => visit(child, scope));
      };
      visit(sf, '<module>');
    }
    return out.sort();
  }

  it('scaffold() is called by Initialize and by the harness generator Initialize runs', () => {
    // Refresh Harness Files used to begin with `scaffold(rootDir)`, which made it a
    // second, unnamed Initialize (59 files in an empty folder). It must not call the
    // creator at all: with the marker present there is nothing for the call to do,
    // and without it the call is the defect.
    expect(callersOf('scaffold')).toEqual([
      'commands/init.ts @ initCommand',
      'lib/scaffold.ts @ generateHarnessFiles',
    ]);
  });

  it('generateHarnessFiles() is called by Initialize only', () => {
    expect(callersOf('generateHarnessFiles')).toEqual(['commands/init.ts @ initCommand']);
  });
});

// ─── Part 3: the writers behind the inventory (FR-5) ────────────────────────

/** Every path under `dir`, relative, sorted - the whole observable write surface. */
function listTree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.join(rel, entry.name);
    out.push(p);
    if (entry.isDirectory()) out.push(...listTree(dir, p));
  }
  return out.sort();
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, and it returned normally');
}

const SPEC_REL = 'specs/demo/SPEC-001-sample/requirements.md';

const SESSION: SessionState = {
  scope: 'pin the opt-in guard',
  project: 'demo',
  type: 'feat',
  startedAt: '2026-10-02T00:00:00.000Z',
  specIds: ['SPEC-001'],
  fileAllowlist: ['src/app.ts'],
};

const PARKED: ParkingLotEntry = {
  title: 'Cache the spec lookups',
  body: 'Came up while tracing the writers.',
  labels: ['idea', 'inbox'],
  sessionScope: 'pin the opt-in guard (demo, feat)',
  createdAt: '2026-10-02T00:00:00.000Z',
};

const RECORD: ApprovalRecord = {
  specPath: SPEC_REL,
  specHash: 'a'.repeat(64),
  approvedAt: '2026-10-02T00:00:00.000Z',
  approvedBy: 'human@example.com',
  tier: 'T2',
  migrated: false,
  baselineBlob: '',
};

const TRACE: TraceabilityData = {
  'SPEC-001': { requirements: { 'rate-limit': { files: ['src/app.ts:1-3'], tests: [] } } },
};

interface StoreCase {
  /** The writer, by the name SPEC-096's table gives it. */
  readonly name: string;
  readonly write: (root: string) => void;
  /** The file the writer produces, as segments under the root. */
  readonly file: (root: string) => string;
  /** The exact bytes, where they do not depend on the clock. */
  readonly bytes?: string;
  /** A structural check, where they do. */
  readonly check?: (root: string) => void;
}

const STORES: readonly StoreCase[] = [
  {
    name: 'saveSession (row 1)',
    write: (root) => saveSession(root, SESSION),
    file: (root) => path.join(root, '.minspec', 'session.json'),
    bytes: JSON.stringify(SESSION, null, 2) + '\n',
  },
  {
    name: 'saveCalibration (row 2)',
    write: (root) => saveCalibration(root, { overrides: [] }),
    file: (root) => path.join(root, '.minspec', 'calibration.json'),
    bytes: '{\n  "overrides": []\n}\n',
  },
  {
    name: 'recordOverride, the caller of row 2',
    write: (root) => {
      recordOverride(root, 'T1', 'T2', ['files-changed']);
    },
    file: (root) => path.join(root, '.minspec', 'calibration.json'),
    check: (root) => {
      const { overrides } = loadCalibration(root);
      expect(overrides).toHaveLength(1);
      expect(overrides[0]).toMatchObject({
        originalTier: 'T1',
        overriddenTier: 'T2',
        signals: ['files-changed'],
      });
    },
  },
  {
    name: 'appendToParkingLotFile (row 3)',
    write: (root) => {
      appendToParkingLotFile(root, PARKED);
    },
    file: (root) => path.join(root, '.minspec', 'parking-lot.md'),
    bytes: [
      '# Parking Lot',
      '',
      'Topics parked during MinSpec sessions for later triage.',
      '',
      '## Cache the spec lookups',
      '',
      '**Date:** 2026-10-02T00:00:00.000Z',
      '**Session scope:** pin the opt-in guard (demo, feat)',
      '**Labels:** idea, inbox',
      '',
      'Came up while tracing the writers.',
      '',
      '---',
      '',
    ].join('\n'),
  },
  {
    name: 'writeRecord (row 5)',
    write: (root) => writeRecord(root, RECORD),
    file: (root) => sidecarPath(root, SPEC_REL),
    bytes: JSON.stringify(RECORD, null, 2) + '\n',
  },
  {
    name: 'enqueuePhaseAdvance (row 6)',
    write: (root) => enqueuePhaseAdvance(root, SPEC_REL, 'alt-a-toast'),
    file: (root) => queueRequestPath(root, SPEC_REL),
    check: (root) => {
      const req = JSON.parse(fs.readFileSync(queueRequestPath(root, SPEC_REL), 'utf-8')) as Record<string, unknown>;
      expect(req.specPath).toBe(SPEC_REL);
      expect(req.source).toBe('alt-a-toast');
      expect(typeof req.requestedAt).toBe('string');
    },
  },
  {
    name: 'saveTraceability (row 7)',
    write: (root) => saveTraceability(root, TRACE),
    file: (root) => path.join(root, '.minspec', 'traceability.json'),
    bytes: JSON.stringify(TRACE, null, 2) + '\n',
  },
  {
    name: 'saveHashes (row 9)',
    write: (root) => saveHashes(root, { 'CLAUDE.md': { '## Overview': 'abc123' } }),
    file: (root) => path.join(root, '.minspec', 'generated-hashes.json'),
    check: (root) => {
      expect(loadHashes(root)['CLAUDE.md']).toEqual({ '## Overview': 'abc123' });
    },
  },
  {
    name: 'saveTemplateBaseline (row 10)',
    write: (root) => saveTemplateBaseline(root, { 'CLAUDE.md': { '## Overview': 'def456' } }),
    file: (root) => path.join(root, '.minspec', 'template-baseline.json'),
    bytes: JSON.stringify({ 'CLAUDE.md': { '## Overview': 'def456' } }, null, 2) + '\n',
  },
];

/** A spec file that satisfies approveSpec's own reads; its content is not judged here. */
const SPEC_BODY = [
  '---',
  'id: SPEC-001',
  'title: Sample',
  'tier: T2',
  'status: new',
  'created: 2026-10-02',
  'phases:',
  '  specify: done',
  '  clarify: skipped',
  '  plan: pending',
  '  tasks: pending',
  '  implement: pending',
  '---',
  '',
  '# Sample',
  '',
  '## Specify',
  '',
  'A sample spec.',
  '',
].join('\n');

function writeSpec(root: string): string {
  const specFile = path.join(root, ...SPEC_REL.split('/'));
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, SPEC_BODY);
  return specFile;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepo(root: string): void {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'human@example.com');
  git(root, 'config', 'user.name', 'A Human');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial', '--no-verify');
}

describe('SPEC-096 FR-5: a .minspec/ store refuses instead of creating', () => {
  let root: string;
  let savedCwd: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opt-in-writers-')));
    savedCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe.each(STORES)('$name', (store) => {
    it('in a folder with no marker: throws the refusal and creates nothing', () => {
      fs.writeFileSync(path.join(root, 'README.md'), "someone else's repo\n");
      const before = listTree(root);

      const err = thrownBy(() => store.write(root));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect((err as Error).message).toContain(root);
      expect(listTree(root)).toEqual(before);
    });

    it('with no folder open: throws the refusal and writes nothing into the working directory', () => {
      // An empty root makes every store path relative, so it resolves against the
      // working directory - a folder nobody chose.
      process.chdir(root);

      const err = thrownBy(() => store.write(''));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect((err as Error).message).toMatch(/no folder is open/);
      expect(listTree(root)).toEqual([]);
    });

    it('in a folder that has opted in: writes the file it wrote before', () => {
      fs.mkdirSync(path.join(root, '.minspec'));

      store.write(root);

      const file = store.file(root);
      expect(fs.existsSync(file)).toBe(true);
      if (store.bytes !== undefined) expect(fs.readFileSync(file, 'utf-8')).toBe(store.bytes);
      store.check?.(root);
    });

    it('in a folder whose .minspec/ holds only preferences.json (the #2365 residue): writes, and leaves that file alone', () => {
      // The marker is "the directory exists". A folder an earlier build marked by
      // accident still counts as opted in; deciding otherwise is #2365, not this.
      fs.mkdirSync(path.join(root, '.minspec'));
      const prefs = path.join(root, '.minspec', 'preferences.json');
      fs.writeFileSync(prefs, '{\n  "skipInitPrompt": true\n}\n');

      store.write(root);

      expect(fs.existsSync(store.file(root))).toBe(true);
      expect(fs.readFileSync(prefs, 'utf-8')).toBe('{\n  "skipInitPrompt": true\n}\n');
    });
  });

  describe('approveSpec (rows 4 and 5, and the one writer that cannot raise)', () => {
    // `writeGzipFallback` returns false on any error, so a refusal inside it would
    // be swallowed. approveSpec therefore refuses itself, before its first side
    // effect - which in a git repository is a blob and a ref, not a file under
    // `.minspec/` at all.

    it('in a plain folder with no marker: refuses, and creates nothing', () => {
      const specFile = writeSpec(root);
      const before = listTree(root);
      const specBefore = fs.readFileSync(specFile, 'utf-8');

      const err = thrownBy(() => approveSpec(root, specFile, 'T2', 'human@example.com'));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect(listTree(root)).toEqual(before);
      expect(fs.readFileSync(specFile, 'utf-8')).toBe(specBefore);
    });

    it('in a git repository with no marker: refuses, and leaves no blob and no ref', () => {
      const specFile = writeSpec(root);
      initRepo(root);
      const before = listTree(root);

      const err = thrownBy(() => approveSpec(root, specFile, 'T2', 'human@example.com'));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect(git(root, 'for-each-ref', 'refs/minspec/')).toBe('');
      // The listing includes `.git/objects`, so a blob written and left unpinned
      // would show here as a new path.
      expect(listTree(root)).toEqual(before);
    });

    it('in a plain folder that has opted in: writes the record and the gzip baseline (row 4)', () => {
      const specFile = writeSpec(root);
      fs.mkdirSync(path.join(root, '.minspec'));

      const record = approveSpec(root, specFile, 'T2', 'human@example.com');

      expect(record.baselineBlob).toBe(GZIP_MARKER);
      expect(fs.existsSync(path.join(root, '.minspec', 'snapshots', `${refKey(SPEC_REL)}.json.gz`))).toBe(true);
      expect(JSON.parse(fs.readFileSync(sidecarPath(root, SPEC_REL), 'utf-8'))).toEqual(record);
    });

    it('in a git repository that has opted in: writes the record and pins the baseline blob (row 5)', () => {
      const specFile = writeSpec(root);
      fs.mkdirSync(path.join(root, '.minspec'));
      initRepo(root);

      const record = approveSpec(root, specFile, 'T2', 'human@example.com');

      expect(record.baselineBlob).toMatch(/^[0-9a-f]{40}$/);
      expect(git(root, 'for-each-ref', '--format=%(objectname)', 'refs/minspec/')).toBe(record.baselineBlob);
      expect(JSON.parse(fs.readFileSync(sidecarPath(root, SPEC_REL), 'utf-8'))).toEqual(record);
    });
  });

  describe('refreshHarnessFiles (FR-3: Refresh is not a second Initialize)', () => {
    it('in an empty folder: refuses, and creates nothing', () => {
      const err = thrownBy(() => refreshHarnessFiles(root));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect((err as Error).message).toContain(root);
      expect(listTree(root)).toEqual([]);
    });

    it('in a folder with content but no marker: refuses, and leaves it as it was', () => {
      fs.writeFileSync(path.join(root, 'README.md'), '# Not a MinSpec project\n');
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Their own instructions\n');
      const before = listTree(root);

      expect(thrownBy(() => refreshHarnessFiles(root))).toBeInstanceOf(NotOptedInError);

      expect(listTree(root)).toEqual(before);
      expect(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).toBe('# Their own instructions\n');
    });

    it('with no folder open: refuses, and writes nothing into the working directory', () => {
      process.chdir(root);

      expect(thrownBy(() => refreshHarnessFiles(''))).toBeInstanceOf(NotOptedInError);

      expect(listTree(root)).toEqual([]);
    });

    it('in a folder Initialize set up: refreshes as before', () => {
      scaffold(root);
      generateHarnessFiles(root);
      const before = listTree(root);

      expect(() => refreshHarnessFiles(root)).not.toThrow();

      expect(listTree(root)).toEqual(before);
    });

    it('in a folder that holds only the bare marker: still refreshes (the marker is the opt-in)', () => {
      fs.mkdirSync(path.join(root, '.minspec'));

      expect(() => refreshHarnessFiles(root)).not.toThrow();

      expect(fs.existsSync(path.join(root, '.minspec', 'config.json'))).toBe(true);
    });
  });

  describe('the creator (control: Initialize still opts a folder in)', () => {
    it('scaffold() creates the marker in an empty folder', () => {
      expect(fs.existsSync(path.join(root, '.minspec'))).toBe(false);

      scaffold(root);

      expect(fs.statSync(path.join(root, '.minspec')).isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(root, '.minspec', 'config.json'))).toBe(true);
    });

    it('generateHarnessFiles() writes the files that live under the marker it created', () => {
      generateHarnessFiles(root);

      const under = listTree(root).filter((p) => p.startsWith(`.minspec${path.sep}`));
      expect(under).toContain(path.join('.minspec', 'config.json'));
      expect(under).toContain(path.join('.minspec', 'constitution.md'));
      expect(under).toContain(path.join('.minspec', 'generated-hashes.json'));
      expect(under).toContain(path.join('.minspec', 'template-baseline.json'));
    });
  });
});
