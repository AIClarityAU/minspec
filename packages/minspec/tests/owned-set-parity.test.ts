/**
 * SPEC-070 AC-7 (FR-5) - the owned-set oracle equals the spec-gate's `owned_file_set`.
 *
 * `packages/minspec/src/lib/owned-set.ts` computes the set SPEC-070 will sign into
 * every approval record (`ownedAtApproval`) and the set the gate freezes. If it
 * disagrees with the Python gate, a correct snapshot reads as permanent ownership
 * drift, or a drifted one reads as clean. Two roots, because the corpus can only
 * witness the shapes it happens to contain:
 *
 *   Run A - the live `specs/` corpus, every T3/T4 spec the gate would read.
 *   Run B - a hermetic temp tree (mkdtemp, never committed: a committed `.md` under
 *           `specs/` would join the real corpus) holding AC-7's seven named shapes
 *           plus the engine-divergence and tokenizer-quirk cases.
 *
 * Both runs use ONE Python dumper, which imports the real gate through importlib
 * (main() sits behind `__name__ == "__main__"`, so importing runs nothing) and
 * reports, per spec, `owned_file_set` (full) and `declared_impl_files` with the spec
 * directory swapped for an empty temp directory, so no `tasks.md` is found
 * (structured only). Both pairs are compared: the structured set is the one that is
 * signed, so comparing only the full pair would leave it with no Python witness.
 * Task 4.1 later adds `include_fuzzy=` to the gate; until then the empty-directory
 * call is the structured-only read, and it changes nothing in the gate.
 *
 * No assertion compares ORDER: JavaScript sorts by UTF-16 code unit, Python by code
 * point. Every comparison is on sorted copies built the same way on both sides.
 *
 * python3 absent FAILS rather than skips (INV-1: this test is the precondition for a
 * corpus-wide signed write), unless MINSPEC_OWNED_SET_PARITY_OFF=1 is set explicitly
 * for local development. canonical-parity.test.ts's whole-corpus `it.skip` is the
 * pattern deliberately not copied.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import {
  gateFmValue,
  ownedSets,
  readGateFrontmatter,
  structuredOwnedSet,
} from '../src/lib/owned-set';

// Spawns a real python3 child per root - the default 5s is a load metric, not a hang.
useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GATE_PY = path.join(REPO_ROOT, 'scripts/hooks/spec-gate.py');
const SPEC_017 = 'specs/minspec/SPEC-017-trust-dashboard/requirements.md';
const OPT_OUT = process.env.MINSPEC_OWNED_SET_PARITY_OFF === '1';

interface PyEntry {
  rel: string;
  full: string[];
  structured: string[];
}

/** One importlib subprocess: every T3/T4 spec under `root/specs`, selected as the gate selects. */
const DUMPER = [
  'import importlib.util, json, sys, os, re, glob, tempfile',
  'gate_py, root = sys.argv[1], sys.argv[2]',
  'spec = importlib.util.spec_from_file_location("spec_gate_under_test", gate_py)',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'empty = tempfile.mkdtemp()',
  'out = []',
  'for sp in glob.glob(os.path.join(root, "specs", "**", "*.md"), recursive=True):',
  '    try:',
  '        with open(sp, "r", encoding="utf-8") as fh:',
  '            head = fh.read(8000)',
  '    except Exception:',
  '        continue',
  '    fmatch = re.match(r"^---\\n(.*?)\\n---", head, re.S)',
  '    if not fmatch:',
  '        continue',
  '    fm = fmatch.group(1)',
  '    tier = (m.fm_value(fm, "tier") or "").upper()',
  '    sid = m.fm_value(fm, "id") or ""',
  '    if tier not in ("T3", "T4") or not sid:',
  '        continue',
  '    out.append({',
  '        "rel": os.path.relpath(sp, root).replace(os.sep, "/"),',
  '        "full": sorted(m.owned_file_set(root, sp, fm)),',
  '        "structured": sorted(m.declared_impl_files(root, fm, empty)),',
  '    })',
  'os.rmdir(empty)',
  'print(json.dumps(out))',
].join('\n');

function python3Available(): boolean {
  const r = spawnSync('python3', ['--version'], { encoding: 'utf-8' });
  return r.status === 0;
}

function pyDump(root: string): Map<string, PyEntry> {
  const r = spawnSync('python3', ['-c', DUMPER, GATE_PY, root], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`owned_file_set dumper failed (exit ${r.status}): ${r.stderr}`);
  const rows = JSON.parse(r.stdout) as PyEntry[];
  return new Map(rows.map((e) => [e.rel, e]));
}

/** Mirror of `glob(specs/**\/*.md, recursive=True)`: dot-entries are not matched. */
function walkMd(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, acc);
    else if (ent.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/** TypeScript side of the same selection and computation. */
function tsDump(root: string): Map<string, PyEntry> {
  const out = new Map<string, PyEntry>();
  for (const abs of walkMd(path.join(root, 'specs'))) {
    const fm = readGateFrontmatter(abs);
    if (fm === null) continue;
    const tier = (gateFmValue(fm, 'tier') ?? '').toUpperCase();
    const sid = gateFmValue(fm, 'id') ?? '';
    if ((tier !== 'T3' && tier !== 'T4') || !sid) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const sets = ownedSets(root, abs, fm);
    out.set(rel, { rel, full: [...sets.full], structured: [...sets.structured] });
  }
  return out;
}

/** Names the symmetric difference so a red run says exactly what disagrees. */
function setDiff(ts: readonly string[], py: readonly string[]): { tsOnly: string[]; pyOnly: string[] } {
  const a = new Set(ts);
  const b = new Set(py);
  return { tsOnly: [...a].filter((x) => !b.has(x)), pyOnly: [...b].filter((x) => !a.has(x)) };
}

function expectSameSet(ts: readonly string[], py: readonly string[], label: string): void {
  expect({ label, ...setDiff(ts, py) }).toEqual({ label, tsOnly: [], pyOnly: [] });
}

// ---------------------------------------------------------------------------
// Run B fixtures. Each is a spec directory under <tmp>/specs/<name>/.
// ---------------------------------------------------------------------------
interface Fixture {
  readonly name: string;
  /** Frontmatter body lines after id/tier. */
  readonly fm: string;
  readonly tasks?: string;
  /** Repo-relative files to create (for the fuzzy arm's existence filter). */
  readonly files?: readonly string[];
  readonly structured: readonly string[];
  readonly full: readonly string[];
}

const FIXTURES: readonly Fixture[] = [
  // --- AC-7's seven named shapes (design section 6, AC-7 table) ---
  {
    name: 'inline-comment',
    fm: 'implements: packages/a/src/x.ts # see packages/b/src/y.ts',
    structured: ['packages/a/src/x.ts', 'packages/b/src/y.ts'],
    full: ['packages/a/src/x.ts', 'packages/b/src/y.ts'],
  },
  { name: 'implements-none', fm: 'implements: none', structured: [], full: [] },
  {
    name: 'nonexistent-path',
    fm: 'implements: packages/ghost/src/nope.ts',
    structured: ['packages/ghost/src/nope.ts'],
    full: ['packages/ghost/src/nope.ts'],
  },
  { name: 'parent-escape', fm: 'implements: ../outside/src/x.ts', structured: [], full: [] },
  { name: 'infra-prefix', fm: 'implements: node_modules/pkg/index.js', structured: [], full: [] },
  { name: 'non-source-ext', fm: 'implements: packages/a/docs/notes.txt', structured: [], full: [] },
  {
    name: 'fuzzy-tasks',
    fm: 'status: planning',
    tasks: '- [ ] edit `packages/a/src/real.ts` and `packages/a/src/ghost.ts`\n',
    files: ['packages/a/src/real.ts'],
    structured: [],
    full: ['packages/a/src/real.ts'],
  },
  // --- The engine divergences, decided in design section 3 ---
  {
    // Python re.I folds U+017F into `s`; the TS twin widens to match.
    name: 'casefold-long-s',
    fm: 'implements: packages/a/src/x.ſh',
    structured: ['packages/a/src/x.ſh'],
    full: ['packages/a/src/x.ſh'],
  },
  {
    // Python strip() removes U+0085 and keeps U+FEFF; JS trim() does the opposite.
    name: 'py-whitespace-strip',
    fm: 'implements:\n  - packages/a/src/nel.ts\u0085\n  - ﻿packages/a/src/bom.ts',
    structured: ['packages/a/src/nel.ts', '﻿packages/a/src/bom.ts'],
    full: ['packages/a/src/nel.ts', '﻿packages/a/src/bom.ts'],
  },
  {
    // Universal newlines and a code span that crosses a line break. The gate reads
    // tasks.md in text mode, so `\r\n` inside a span becomes `\n` before the
    // existence check: only a file whose NAME holds `\n` matches (legal on Linux,
    // where CI runs), which is what makes the newline translation observable.
    name: 'fuzzy-crlf-multiline',
    fm: 'status: planning',
    tasks:
      '- [ ] `packages/c/src/crlf.ts`\r\n- [ ] `\r\npackages/c/src/span.ts\n`\r\n' +
      '- [ ] `packages/c/src/cr\r\nlf.ts`\r\n',
    files: ['packages/c/src/crlf.ts', 'packages/c/src/span.ts', 'packages/c/src/cr\nlf.ts'],
    structured: [],
    full: ['packages/c/src/cr\nlf.ts', 'packages/c/src/crlf.ts', 'packages/c/src/span.ts'],
  },
  // --- Tokenizer and normalisation steps the gate applies literally ---
  {
    name: 'block-merge-affects',
    fm:
      'implements:\n  - packages/d/src/one.ts  # trailing comment\n  - "packages/d/src/two.ts"\n\n' +
      "affects: ['packages/d/src/three.ts', ./packages/d/src/one.ts]",
    structured: ['packages/d/src/one.ts', 'packages/d/src/three.ts', 'packages/d/src/two.ts'],
    full: ['packages/d/src/one.ts', 'packages/d/src/three.ts', 'packages/d/src/two.ts'],
  },
  {
    // No normpath, one `./` only, exact-case dedup, backslash after the slash test.
    name: 'no-normalisation',
    fm:
      'implements: [packages//e/a.ts, packages/./e/b.ts, ././packages/e/c.ts, ' +
      'packages/e/D.ts, packages/e/d.ts, packages\\e\\bare.ts, packages/e\\win.ts, Node_Modules/x/y.js]',
    structured: [
      './packages/e/c.ts',
      'Node_Modules/x/y.js',
      'packages/./e/b.ts',
      'packages//e/a.ts',
      'packages/e/D.ts',
      'packages/e/d.ts',
      'packages/e/win.ts',
    ],
    full: [
      './packages/e/c.ts',
      'Node_Modules/x/y.js',
      'packages/./e/b.ts',
      'packages//e/a.ts',
      'packages/e/D.ts',
      'packages/e/d.ts',
      'packages/e/win.ts',
    ],
  },
  {
    // Gate quirk: `implements: ` with a trailing space makes fm_value return '' and
    // the block list below it is never read. Reproduced, not corrected (parity);
    // the gate fix is #3653 and flips this expectation in both twins together.
    name: 'trailing-space-block-header',
    fm: 'implements: \n  - packages/f/src/lost.ts',
    structured: [],
    full: [],
  },
];

const ACCEPTED_UNION = [
  ...new Set(FIXTURES.flatMap((f) => [...f.structured, ...f.full])),
].sort();

function buildFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-set-parity-'));
  for (const fx of FIXTURES) {
    const dir = path.join(root, 'specs', fx.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'requirements.md'),
      `---\nid: SPEC-9${FIXTURES.indexOf(fx)}0\ntier: T3\n${fx.fm}\n---\n\n# ${fx.name}\n`,
    );
    if (fx.tasks !== undefined) fs.writeFileSync(path.join(dir, 'tasks.md'), fx.tasks);
    for (const f of fx.files ?? []) {
      fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), '// fixture\n');
    }
  }
  return root;
}

const hasPython = python3Available();

describe('owned-set oracle: python3 precondition', () => {
  if (!hasPython && OPT_OUT) {
    it.skip('python3 absent and MINSPEC_OWNED_SET_PARITY_OFF=1 - parity NOT verified', () => {});
    return;
  }
  it('python3 is available (fails, never skips, without the explicit opt-out)', () => {
    expect(hasPython).toBe(true);
  });
});

describe.runIf(hasPython)('Run B - hermetic fixtures: TS equals Python on every shape (AC-7)', () => {
  // describe.runIf still COLLECTS its body when python3 is absent, so nothing here
  // may spawn python3 or create a temp tree unless the block will actually run.
  const root = hasPython ? buildFixtureRoot() : '';
  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  const py = hasPython ? pyDump(root) : new Map<string, PyEntry>();
  const ts = hasPython ? tsDump(root) : new Map<string, PyEntry>();

  it('the Python dump names every fixture (anti-vacuity 1)', () => {
    expect([...py.keys()].sort()).toEqual(
      FIXTURES.map((f) => `specs/${f.name}/requirements.md`).sort(),
    );
    expect([...ts.keys()].sort()).toEqual([...py.keys()].sort());
  });

  for (const fx of FIXTURES) {
    const rel = `specs/${fx.name}/requirements.md`;
    it(`${fx.name}: structured and full sets equal Python and the written expectation`, () => {
      const p = py.get(rel)!;
      const t = ts.get(rel)!;
      expectSameSet(t.structured, p.structured, `${fx.name} structured`);
      expectSameSet(t.full, p.full, `${fx.name} full`);
      expectSameSet(p.structured, fx.structured, `${fx.name} structured vs expectation`);
      expectSameSet(p.full, fx.full, `${fx.name} full vs expectation`);
    });
  }

  it('every filter arm both accepts and rejects something (anti-vacuity 2)', () => {
    const byName = new Map(FIXTURES.map((f) => [f.name, f]));
    // Rejections: no-slash, parent-escape, infra prefix, extension, fuzzy existence.
    for (const n of ['implements-none', 'parent-escape', 'infra-prefix', 'non-source-ext']) {
      expect(py.get(`specs/${n}/requirements.md`)!.full).toEqual([]);
      expect(byName.has(n)).toBe(true);
    }
    expect(py.get('specs/fuzzy-tasks/requirements.md')!.full).not.toContain('packages/a/src/ghost.ts');
    // Acceptances: a comment path, a non-existent structured path, an existing fuzzy path.
    expect(py.get('specs/inline-comment/requirements.md')!.structured).toContain('packages/b/src/y.ts');
    expect(py.get('specs/nonexistent-path/requirements.md')!.structured).toEqual([
      'packages/ghost/src/nope.ts',
    ]);
    expect(py.get('specs/fuzzy-tasks/requirements.md')!.full).toEqual(['packages/a/src/real.ts']);
  });

  it('the union of accepted paths is a literal set, never an all-empty pass (anti-vacuity 3)', () => {
    const pyUnion = [...new Set([...py.values()].flatMap((e) => [...e.structured, ...e.full]))].sort();
    expect(pyUnion).toEqual(ACCEPTED_UNION);
    expect(ACCEPTED_UNION.length).toBe(20);
  });

  it('structuredOwnedSet(fm) equals ownedSets(...).structured (the pure entry point)', () => {
    for (const fx of FIXTURES) {
      const abs = path.join(root, 'specs', fx.name, 'requirements.md');
      const fm = readGateFrontmatter(abs)!;
      expect(structuredOwnedSet(fm)).toEqual([...ownedSets(root, abs, fm).structured]);
    }
  });
});

describe.runIf(hasPython)('Run A - the live corpus: TS equals Python for every T3/T4 spec (AC-7, INV-5)', () => {
  const py = hasPython ? pyDump(REPO_ROOT) : new Map<string, PyEntry>();
  const ts = hasPython ? tsDump(REPO_ROOT) : new Map<string, PyEntry>();

  it('selects the same non-empty set of T3/T4 spec files as the gate', () => {
    expect(py.size).toBeGreaterThan(0);
    expect(setDiff([...ts.keys()], [...py.keys()])).toEqual({ tsOnly: [], pyOnly: [] });
  });

  it('structured and full sets agree for every spec (symmetric difference named on failure)', () => {
    const disagreements: unknown[] = [];
    for (const [rel, p] of py) {
      const t = ts.get(rel);
      if (!t) continue; // reported by the selection test above
      const s = setDiff(t.structured, p.structured);
      const f = setDiff(t.full, p.full);
      if (s.tsOnly.length || s.pyOnly.length || f.tsOnly.length || f.pyOnly.length) {
        disagreements.push({ rel, structured: s, full: f });
      }
    }
    expect(disagreements).toEqual([]);
    // Non-vacuous: the corpus does declare ownership somewhere.
    expect([...py.values()].some((e) => e.structured.length > 0)).toBe(true);
  });

  // The design measured SPEC-017 at structured 0 / full 22. Re-measured at the build
  // commit (2026-11-13): #1849 has since declared 7 structured paths, so structured is
  // 7 and full is 22. The pin's point survives - the signed set and the frozen set
  // differ on this spec, which is why snapshotting `full` would be wrong - so it is
  // asserted as a strict subset, and the empty-structured shape the design wanted is
  // pinned separately over the whole corpus rather than on one named spec.
  it('SPEC-017: structured is a strict, non-empty subset of full, both equal Python (AC-7 pin)', () => {
    const abs = path.join(REPO_ROOT, SPEC_017);
    const fm = readGateFrontmatter(abs);
    expect(fm).not.toBeNull();
    const sets = ownedSets(REPO_ROOT, abs, fm!);
    const p = py.get(SPEC_017);
    expect(p).toBeDefined();
    expectSameSet(sets.full, p!.full, 'SPEC-017 full');
    expectSameSet(sets.structured, p!.structured, 'SPEC-017 structured');
    expect(sets.structured.length).toBeGreaterThan(0);
    expect(sets.full.length).toBeGreaterThan(sets.structured.length);
    expect(sets.structured.filter((x) => !sets.full.includes(x))).toEqual([]);
  });

  it('the corpus holds a spec with an empty structured set and a non-empty full set', () => {
    const hits = [...ts.values()].filter((e) => e.structured.length === 0 && e.full.length > 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expectSameSet(h.full, py.get(h.rel)!.full, `${h.rel} full`);
  });
});
