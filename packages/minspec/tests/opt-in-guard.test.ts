/**
 * T0 - SPEC-096 FR-11: the contract of the one guard (`src/lib/opt-in.ts`).
 *
 * `.minspec/` at the root of a workspace folder is the opt-in marker (constitution
 * invariant 3, DR-074). Issue #2364 found ten writers that each did their own
 * `mkdir -p .minspec/...`, so any of them reached before opt-in manufactured the
 * marker. SPEC-096 replaces those calls with ONE operation that cannot create it.
 * This file pins that operation, on real temp directories, with no stand-in for the
 * filesystem:
 *
 *   - FR-2 (a) it creates a directory and its missing parents, and an existing
 *     directory is not an error;
 *   - FR-2 (b) it never creates a path component named `.minspec`: asked for a
 *     directory at or under a marker that does not exist, it creates NOTHING (not
 *     even the parents above the marker) and throws the refusal;
 *   - FR-2 (c) that holds under a race: the marker is removed between the look and
 *     the create, and the outcome is the refusal or a filesystem error, never a
 *     recreated `.minspec/`;
 *   - FR-2 (d) a path that is not absolute is refused, which is what an empty root
 *     (no folder open) produces;
 *   - FR-1 the module imports nothing but `fs` and `path`, there is exactly one
 *     definition of the predicate, and the two modules that exported these names
 *     before still export the SAME objects;
 *   - FR-8 the wording of the refusal.
 *
 * WHAT VARIES. Every refusal is checked against three shapes of "no marker" (an
 * empty folder, a folder with unrelated content, a marker several levels below
 * directories that do not exist either), and every success against three shapes of
 * "marker present" (an empty `.minspec/`, a populated one, and one holding only
 * `preferences.json` - the residue an earlier build left behind, issue #2365, which
 * still counts as opted in because the marker's definition does not move, INV-4).
 *
 * HOW THE RACE IS PRODUCED. `vi.spyOn(fs, ...)` cannot redefine an ESM namespace
 * export, so `fs` is mocked file-wide as a pure passthrough (the same shape
 * `merge-refresh-890.test.ts` uses). When a test arms it, the passthrough runs a
 * hook immediately before the Nth real `mkdirSync`, which is exactly "after the
 * operation has looked and before it creates the next level". Disarmed it is
 * transparent. The hook records that it fired, so a race test cannot pass because
 * the window was never opened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

const race = vi.hoisted(() => ({
  /** Run just before the Nth `mkdirSync` (1-based) reaches the real filesystem. */
  beforeMkdir: null as null | { nth: number; run: () => void },
  mkdirCalls: [] as Array<{ dir: string; recursive: boolean }>,
  fired: 0,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mkdirSync = ((dir: unknown, options?: unknown) => {
    const recursive =
      options !== null && typeof options === 'object'
        ? (options as { recursive?: unknown }).recursive === true
        : false;
    race.mkdirCalls.push({ dir: String(dir), recursive });
    const hook = race.beforeMkdir;
    if (hook && race.mkdirCalls.length === hook.nth) {
      race.fired += 1;
      hook.run();
    }
    return (actual.mkdirSync as (a: unknown, b?: unknown) => unknown)(dir, options);
  }) as typeof actual.mkdirSync;
  const patched = { ...actual, mkdirSync };
  return { ...patched, default: patched };
});

import {
  INITIALIZE_COMMAND_TITLE,
  NotOptedInError,
  assertOptedIn,
  ensureDirectory,
  hasOptInMarker,
  notOptedInMessage,
} from '../src/lib/opt-in';
import * as preferences from '../src/lib/preferences';
import * as autoBootstrap from '../src/lib/auto-bootstrap';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');
const OPT_IN_MODULE = path.join(SRC_ROOT, 'lib', 'opt-in.ts');
const MANIFEST = path.join(PACKAGE_ROOT, 'package.json');

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

/** Run `fn`, return what it threw. Fails the test when it did not throw at all. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, and it returned normally');
}

let root: string;

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is a symlink, and process.cwd() reports the target.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opt-in-guard-')));
  race.beforeMkdir = null;
  race.mkdirCalls = [];
  race.fired = 0;
});

afterEach(() => {
  race.beforeMkdir = null;
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── The fixtures that vary ─────────────────────────────────────────────────

interface FolderShape {
  readonly name: string;
  /** Prepare `root` and return the listing it starts with. */
  readonly prepare: (dir: string) => void;
}

/** Three ways a folder can have NO marker. */
const NOT_OPTED_IN: readonly FolderShape[] = [
  { name: 'an empty folder', prepare: () => undefined },
  {
    name: 'a folder with unrelated content',
    prepare: (dir) => {
      fs.writeFileSync(path.join(dir, 'README.md'), "someone else's repo\n");
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export {};\n');
      // Near misses: none of these is the marker.
      fs.mkdirSync(path.join(dir, 'minspec'));
      fs.mkdirSync(path.join(dir, '.minspecs'));
      fs.writeFileSync(path.join(dir, 'x.minspec'), '');
    },
  },
];

/** Three ways a folder can HAVE the marker. The third is the #2365 residue. */
const OPTED_IN: readonly FolderShape[] = [
  { name: 'an empty .minspec/', prepare: (dir) => fs.mkdirSync(path.join(dir, '.minspec')) },
  {
    name: 'an initialized-looking .minspec/',
    prepare: (dir) => {
      fs.mkdirSync(path.join(dir, '.minspec', 'approvals', 'specs'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.minspec', 'config.json'), '{}\n');
    },
  },
  {
    name: 'a .minspec/ holding only preferences.json (the #2365 residue)',
    prepare: (dir) => {
      fs.mkdirSync(path.join(dir, '.minspec'));
      fs.writeFileSync(
        path.join(dir, '.minspec', 'preferences.json'),
        '{\n  "skipInitPrompt": true\n}\n',
      );
    },
  },
];

// ─── FR-1: the predicate, and where it lives ────────────────────────────────

describe('SPEC-096 FR-1: one predicate, in a module that imports only fs and path', () => {
  it.each(NOT_OPTED_IN)('reads $name as not opted in', ({ prepare }) => {
    prepare(root);
    expect(hasOptInMarker(root)).toBe(false);
    expect(autoBootstrap.isMinspecInitialized(root)).toBe(false);
  });

  it.each(OPTED_IN)('reads $name as opted in (the marker is "the directory exists")', ({ prepare }) => {
    prepare(root);
    expect(hasOptInMarker(root)).toBe(true);
    expect(autoBootstrap.isMinspecInitialized(root)).toBe(true);
  });

  it('reads the empty root (no folder open) as not opted in, even inside a MinSpec project', () => {
    // `path.join('', '.minspec')` resolves against the working directory, so an
    // extension host started inside an opted-in project would otherwise answer
    // "opted in" for a window that has no folder at all.
    fs.mkdirSync(path.join(root, '.minspec'));
    const saved = process.cwd();
    process.chdir(root);
    try {
      expect(fs.existsSync('.minspec')).toBe(true); // the trap is really set
      expect(hasOptInMarker('')).toBe(false);
    } finally {
      process.chdir(saved);
    }
  });

  it('preferences.ts and auto-bootstrap.ts still export the SAME predicate and error', () => {
    // FR-1: no existing importer changes. Identity, not a look-alike: a second
    // definition that happened to agree today would pass an equality-of-behaviour test.
    expect(preferences.hasOptInMarker).toBe(hasOptInMarker);
    expect(preferences.NotOptedInError).toBe(NotOptedInError);
    expect(autoBootstrap.hasOptInMarker).toBe(hasOptInMarker);
    expect(autoBootstrap.NotOptedInError).toBe(NotOptedInError);
  });

  it('there is exactly one definition of the predicate in the source tree', () => {
    const definitions: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'test' || entry.name === '__benchmarks__') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        scanned += 1;
        const sf = ts.createSourceFile(full, fs.readFileSync(full, 'utf-8'), ts.ScriptTarget.ES2022, true);
        const visit = (node: ts.Node): void => {
          const declaresIt =
            (ts.isFunctionDeclaration(node) && node.name?.text === 'hasOptInMarker') ||
            (ts.isVariableDeclaration(node) &&
              ts.isIdentifier(node.name) &&
              node.name.text === 'hasOptInMarker');
          if (declaresIt) definitions.push(path.relative(SRC_ROOT, full));
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    };
    walk(SRC_ROOT);
    expect(scanned).toBeGreaterThan(50); // a scan that read nothing proves nothing
    expect(definitions).toEqual([path.join('lib', 'opt-in.ts')]);
  });

  it('the module imports only fs and path, and nothing by any other route', () => {
    const text = fs.readFileSync(OPT_IN_MODULE, 'utf-8');
    const sf = ts.createSourceFile(OPT_IN_MODULE, text, ts.ScriptTarget.ES2022, true);
    const specifiers: string[] = [];
    const otherRoutes: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        otherRoutes.push(`re-export from ${node.moduleSpecifier.getText(sf)}`);
      }
      if (ts.isImportEqualsDeclaration(node)) otherRoutes.push('import = require');
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) otherRoutes.push('dynamic import()');
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          otherRoutes.push('require()');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(specifiers.sort()).toEqual(['fs', 'path']);
    expect(otherRoutes).toEqual([]);
  });
});

// ─── FR-2 (a): it creates directories ───────────────────────────────────────

describe('SPEC-096 FR-2 (a): the operation creates a directory and its missing parents', () => {
  it('creates nested directories outside the marker, in any kind of folder', () => {
    for (const shape of [...NOT_OPTED_IN, ...OPTED_IN]) {
      const dir = fs.mkdtempSync(path.join(root, 'case-'));
      shape.prepare(dir);
      const before = listTree(dir);

      ensureDirectory(path.join(dir, 'docs', 'epics', 'archive'));

      expect(fs.statSync(path.join(dir, 'docs', 'epics', 'archive')).isDirectory()).toBe(true);
      expect(listTree(dir)).toEqual(
        [...before, 'docs', path.join('docs', 'epics'), path.join('docs', 'epics', 'archive')].sort(),
      );
    }
  });

  it.each(OPTED_IN)('creates nested directories below the marker in $name', ({ prepare }) => {
    prepare(root);
    const target = path.join(root, '.minspec', 'queue', 'specs', 'minspec');

    ensureDirectory(target);

    expect(fs.statSync(target).isDirectory()).toBe(true);
    // What was already under the marker is untouched.
    if (fs.existsSync(path.join(root, '.minspec', 'preferences.json'))) {
      expect(fs.readFileSync(path.join(root, '.minspec', 'preferences.json'), 'utf-8')).toBe(
        '{\n  "skipInitPrompt": true\n}\n',
      );
    }
  });

  it('an existing directory is not an error, and nothing is created for it', () => {
    fs.mkdirSync(path.join(root, '.minspec', 'sessions'), { recursive: true });
    const before = listTree(root);
    race.mkdirCalls = [];

    expect(() => ensureDirectory(path.join(root, '.minspec'))).not.toThrow();
    expect(() => ensureDirectory(path.join(root, '.minspec', 'sessions'))).not.toThrow();
    expect(() => ensureDirectory(root)).not.toThrow();

    expect(listTree(root)).toEqual(before);
    expect(race.mkdirCalls).toEqual([]);
  });

  it('a path that exists and is not a directory is an error, as it is for mkdir -p', () => {
    fs.writeFileSync(path.join(root, 'occupied'), 'a file\n');

    const err = thrownBy(() => ensureDirectory(path.join(root, 'occupied')));

    expect(err).not.toBeInstanceOf(NotOptedInError);
    expect((err as NodeJS.ErrnoException).code).toBe('EEXIST');
    expect(fs.readFileSync(path.join(root, 'occupied'), 'utf-8')).toBe('a file\n');
  });

  it('never asks the filesystem for a recursive create', () => {
    // The property behind (c): a recursive mkdir is what recreates a parent that
    // vanished. Creating one level at a time is what makes that impossible.
    fs.mkdirSync(path.join(root, '.minspec'));
    race.mkdirCalls = [];

    ensureDirectory(path.join(root, '.minspec', 'a', 'b', 'c'));
    ensureDirectory(path.join(root, 'x', 'y'));

    expect(race.mkdirCalls.map((c) => path.relative(root, c.dir))).toEqual([
      path.join('.minspec', 'a'),
      path.join('.minspec', 'a', 'b'),
      path.join('.minspec', 'a', 'b', 'c'),
      'x',
      path.join('x', 'y'),
    ]);
    expect(race.mkdirCalls.filter((c) => c.recursive)).toEqual([]);
  });
});

// ─── FR-2 (b): it cannot create the marker ──────────────────────────────────

describe('SPEC-096 FR-2 (b): the operation never creates a component named .minspec', () => {
  const UNDER_MARKER: ReadonlyArray<readonly [string, string[]]> = [
    ['the marker itself', ['.minspec']],
    ['a directory directly under it', ['.minspec', 'sessions']],
    ['a directory several levels under it', ['.minspec', 'approvals', 'specs', 'minspec', 'SPEC-001']],
  ];

  for (const shape of NOT_OPTED_IN) {
    it.each(UNDER_MARKER)(`refuses %s in ${shape.name}, and creates nothing`, (_name, segments) => {
      shape.prepare(root);
      const before = listTree(root);
      race.mkdirCalls = [];

      const err = thrownBy(() => ensureDirectory(path.join(root, ...segments)));

      expect(err).toBeInstanceOf(NotOptedInError);
      expect((err as NotOptedInError).rootDir).toBe(root);
      expect((err as NotOptedInError).message).toBe(notOptedInMessage(root));
      expect(listTree(root)).toEqual(before);
      // "Creates nothing" includes not trying: no mkdir reached the filesystem.
      expect(race.mkdirCalls).toEqual([]);
    });
  }

  it('creates none of the parents ABOVE a missing marker either', () => {
    // The refusal has to come before the first create. A walk that made `proj/`
    // and `proj/sub/` and only then noticed the marker would have written into a
    // folder that never opted in.
    const target = path.join(root, 'proj', 'sub', '.minspec', 'queue');

    const err = thrownBy(() => ensureDirectory(target));

    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe(path.join(root, 'proj', 'sub'));
    expect(listTree(root)).toEqual([]);
    expect(race.mkdirCalls).toEqual([]);
  });

  it('refuses a second marker nested inside an existing one', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    const before = listTree(root);

    const err = thrownBy(() => ensureDirectory(path.join(root, '.minspec', 'cache', '.minspec', 'x')));

    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe(path.join(root, '.minspec', 'cache'));
    expect(listTree(root)).toEqual(before);
  });

  it.each([
    ['upper case', '.MINSPEC'],
    ['mixed case', '.MinSpec'],
    ['a trailing dot', '.minspec.'],
    ['a trailing space', '.minspec '],
    ['trailing dots and spaces', '.Minspec. .'],
  ])('refuses the marker spelled with %s', (_name, spelling) => {
    // The predicate asks the FILESYSTEM whether `.minspec` exists. On a
    // case-insensitive volume (the macOS and Windows defaults) `.MINSPEC` answers
    // yes, and Windows drops trailing dots and spaces from a name, so each of
    // these spellings can BE the marker. The operation refuses all of them on
    // every platform, so the rule does not depend on which disk the folder is on.
    const err = thrownBy(() => ensureDirectory(path.join(root, spelling, 'specs')));

    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe(root);
    expect(listTree(root)).toEqual([]);
  });

  it.each([['minspec'], ['.minspecs'], ['x.minspec'], ['.minspec-old'], ['_minspec']])(
    'does not mistake %s for the marker',
    (name) => {
      ensureDirectory(path.join(root, name, 'inner'));
      expect(listTree(root)).toEqual([name, path.join(name, 'inner')]);
    },
  );

  it('does not refuse a folder merely because an EXISTING ancestor is named .minspec', () => {
    // A workspace folder may itself live below some other project's `.minspec/`.
    // The rule is about what this operation CREATES, not about the path it is given.
    const project = path.join(root, '.minspec', 'nested-project');
    fs.mkdirSync(project, { recursive: true });

    ensureDirectory(path.join(project, 'docs', 'decisions'));

    expect(fs.statSync(path.join(project, 'docs', 'decisions')).isDirectory()).toBe(true);
  });
});

// ─── FR-2 (c): the race ─────────────────────────────────────────────────────

describe('SPEC-096 FR-2 (c): removing the marker between the look and the create', () => {
  const removeMarker = (): void => fs.rmSync(path.join(root, '.minspec'), { recursive: true, force: true });

  it.each(OPTED_IN)('leaves no .minspec/ behind when $name vanishes before the first create', ({ prepare }) => {
    prepare(root);
    race.mkdirCalls = [];
    race.beforeMkdir = { nth: 1, run: removeMarker };

    const err = thrownBy(() => ensureDirectory(path.join(root, '.minspec', 'queue', 'specs')));

    expect(race.fired).toBe(1); // the window really was opened
    expect(fs.existsSync(path.join(root, '.minspec'))).toBe(false);
    expect(listTree(root)).toEqual([]);
    // The outcome is the refusal, naming the folder that is no longer opted in.
    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe(root);
  });

  it('leaves no .minspec/ behind when the marker vanishes between two levels', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    race.mkdirCalls = [];
    // Level 1 (`.minspec/a`) is created for real; the marker goes just before level 2.
    race.beforeMkdir = { nth: 2, run: removeMarker };

    const err = thrownBy(() => ensureDirectory(path.join(root, '.minspec', 'a', 'b', 'c')));

    expect(race.fired).toBe(1);
    expect(race.mkdirCalls).toHaveLength(2); // it stopped: no third attempt
    expect(fs.existsSync(path.join(root, '.minspec'))).toBe(false);
    expect(listTree(root)).toEqual([]);
    expect(err).toBeInstanceOf(NotOptedInError);
  });

  it('losing the race to another creator of the same directory is not an error', () => {
    // Two windows on one project both make `.minspec/sessions/`. The second create
    // finds it already there, which is the outcome it wanted.
    fs.mkdirSync(path.join(root, '.minspec'));
    const target = path.join(root, '.minspec', 'sessions');
    race.mkdirCalls = [];
    race.beforeMkdir = { nth: 1, run: () => fs.mkdirSync(target) };

    expect(() => ensureDirectory(target)).not.toThrow();

    expect(race.fired).toBe(1);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it('losing the race to something that is NOT a directory is an error', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    const target = path.join(root, '.minspec', 'sessions');
    race.mkdirCalls = [];
    race.beforeMkdir = { nth: 1, run: () => fs.writeFileSync(target, 'in the way\n') };

    const err = thrownBy(() => ensureDirectory(target));

    expect(race.fired).toBe(1);
    expect(err).not.toBeInstanceOf(NotOptedInError);
    expect((err as NodeJS.ErrnoException).code).toBe('EEXIST');
  });

  it('a filesystem error that is not about the marker stays a filesystem error', () => {
    // Remove an ordinary parent instead: the marker is not involved, so the caller
    // gets the real error rather than a refusal that would misdescribe it.
    fs.mkdirSync(path.join(root, 'docs'));
    race.mkdirCalls = [];
    race.beforeMkdir = {
      nth: 2,
      run: () => fs.rmSync(path.join(root, 'docs'), { recursive: true, force: true }),
    };

    const err = thrownBy(() => ensureDirectory(path.join(root, 'docs', 'a', 'b')));

    expect(race.fired).toBe(1);
    expect(err).not.toBeInstanceOf(NotOptedInError);
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
  });
});

// ─── FR-2 (d): the empty root ───────────────────────────────────────────────

describe('SPEC-096 FR-2 (d): a path that is not absolute is refused', () => {
  let savedCwd: string;

  beforeEach(() => {
    // A relative path lands in the working directory. Point that at the temp dir
    // so a stray write is observable (and never lands in this repository).
    savedCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(savedCwd);
  });

  it.each([
    ['what an empty root produces for a store', path.join('', '.minspec')],
    ['what an empty root produces for a nested store', path.join('', '.minspec', 'approvals', 'specs')],
    ['an ordinary relative directory', path.join('docs', 'epics')],
    ['the empty string', ''],
    ['the current directory', '.'],
  ])('refuses %s and writes nothing into the working directory', (_name, relative) => {
    expect(process.cwd()).toBe(root);
    race.mkdirCalls = [];

    const err = thrownBy(() => ensureDirectory(relative));

    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe('');
    expect((err as NotOptedInError).message).toBe(notOptedInMessage(''));
    expect(listTree(root)).toEqual([]);
    expect(race.mkdirCalls).toEqual([]);
  });

  it('refuses a relative path even when the working directory is itself opted in', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    const before = listTree(root);

    expect(thrownBy(() => ensureDirectory(path.join('.minspec', 'sessions')))).toBeInstanceOf(
      NotOptedInError,
    );
    expect(listTree(root)).toEqual(before);
  });
});

// ─── assertOptedIn: the same refusal, for a caller with no directory to make ──

describe('SPEC-096 FR-5: assertOptedIn refuses before a side effect that is not a mkdir', () => {
  it.each(NOT_OPTED_IN)('throws the refusal in $name', ({ prepare }) => {
    prepare(root);
    const before = listTree(root);

    const err = thrownBy(() => assertOptedIn(root));

    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe(root);
    expect(listTree(root)).toEqual(before);
  });

  it('throws the no-folder refusal for the empty root', () => {
    const err = thrownBy(() => assertOptedIn(''));
    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as NotOptedInError).rootDir).toBe('');
  });

  it.each(OPTED_IN)('returns normally in $name', ({ prepare }) => {
    prepare(root);
    expect(() => assertOptedIn(root)).not.toThrow();
  });
});

// ─── FR-8: the wording ──────────────────────────────────────────────────────

describe('SPEC-096 FR-8: the refusal names the folder, says what did not happen, and names Initialize', () => {
  it('names the command by its real palette title', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const init = manifest.contributes.commands.find((c) => c.command === 'minspec.init');
    expect(init).toBeDefined();
    // A title that drifted from the manifest would send the user looking for a
    // command the palette does not list.
    expect(INITIALIZE_COMMAND_TITLE).toBe(init!.title);
  });

  it('says the four things FR-8 requires, in one sentence pair, for a real folder', () => {
    const folder = path.join(root, 'some project');
    const message = notOptedInMessage(folder);

    expect(message).toBe(
      `MinSpec: ${folder} has no .minspec/ directory (it has not opted in), so nothing was written there. ` +
        'Run "MinSpec: Initialize SDD Structure" first.',
    );
    expect(message).toContain(folder); // names the folder
    expect(message).toContain('has no .minspec/ directory'); // says the marker is absent
    expect(message).toContain('nothing was written there'); // says nothing was written
    expect(message).toContain(`"${INITIALIZE_COMMAND_TITLE}"`); // names the command to run
  });

  it('does not mention a preference unless a preference was the write', () => {
    expect(notOptedInMessage(root)).not.toMatch(/preference/i);
    expect(notOptedInMessage('')).not.toMatch(/preference/i);
    expect(new NotOptedInError(root).message).not.toMatch(/preference/i);

    // The preference store is the one caller for which it WAS the write.
    const err = thrownBy(() => preferences.savePreferences(root, { skipInitPrompt: true }));
    expect(err).toBeInstanceOf(NotOptedInError);
    expect((err as Error).message).toBe(
      `MinSpec: ${root} has no .minspec/ directory (it has not opted in), so no preference was saved there. ` +
        'Run "MinSpec: Initialize SDD Structure" first.',
    );
    expect(listTree(root)).toEqual([]);
  });

  it('says that no folder is open for the empty root, and offers no command that needs one', () => {
    const message = notOptedInMessage('');
    expect(message).toBe('MinSpec: no folder is open, so there is no project to write to.');
    expect(message).not.toContain('.minspec');
  });

  it('the error is an ordinary Error a caller can tell apart from an I/O failure', () => {
    const err = new NotOptedInError(root);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotOptedInError');
    expect(err.rootDir).toBe(root);
    expect(err.message).toBe(notOptedInMessage(root));
    expect((err as NodeJS.ErrnoException).code).toBeUndefined();
  });
});
