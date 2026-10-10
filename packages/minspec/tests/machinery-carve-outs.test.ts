/**
 * #2018 — T0: the machinery CARVE-OUTS, and the promises that make them safe.
 *
 * `MACHINERY_DIR_PREFIXES` includes `scripts/` wholesale, so it captures files that fail
 * the machinery module's own membership test — a read-only facts oracle, a churn report.
 * Those PRs earn no SHA-bound `ai-review:pass` witness and sit in the human queue for a
 * file that gates nothing. `MACHINERY_CARVE_OUTS` exempts them by exact path.
 *
 * ── WHY THIS SUITE IS THE POINT, NOT AN ACCESSORY ────────────────────────────
 * Deny-by-default is the safer failure direction, and the directory prefix gets it for
 * free. Each carve-out trades that away for one file, on the strength of a promise —
 * "this file will never grow a gating role" — that no reviewer two years from now will
 * have read. A promise enforced by memory is the shape the constitution names as
 * "enforce, don't trust the model". So the promise is a test:
 *
 *   ROT GUARD      fails if a carved path is referenced from a workflow, a git hook or
 *                  another script — directly, or through an `npm run` script that a
 *                  workflow or hook invokes. That is the "wired into CI later" path,
 *                  and it is the exact #1758 divergence shape arriving by another door.
 *   EXISTENCE      fails if a carved path is not in the tree, so a rename cannot leave a
 *                  dead exemption for a future, unrelated file at the same path to
 *                  inherit silently.
 *   DISJOINTNESS   fails if a carved path also matches one of dispatch's OTHER withhold
 *                  mandates. dispatch filters carve-outs once, before a combined grep, so
 *                  disjointness is what makes that single filter safe — and
 *                  `.github/workflows/deploy-sites.yml` is proof the sets can overlap.
 *
 * ── WHY IT CHECKS FOUR CONSUMERS AND NOT ONE ─────────────────────────────────
 * `isMachineryPath()` and `buildMachineryRegexSource()` had ZERO production consumers
 * when this was scoped. Every decision that actually holds a PR reads the set somewhere
 * else: ai-review.yml's `grep -qE` (a hand-copy), dispatch-issue.sh's MACHINERY_PATH_RE
 * (a second hand-copy, the invariant-2 second witness), and auto-merge-gate.ts, which
 * spreads the canonical ARRAYS rather than calling the canonical predicate — so a third
 * array is invisible to it unless imported by name. A carve-out added only to the
 * canonical module would pass its own tests and change nothing. This suite therefore
 * asserts the effect at each decision, not the declaration at the source.
 *
 * ── AND WHY IT EXECUTES THE WORKFLOW'S SHELL ─────────────────────────────────
 * POSIX ERE has no negative lookahead, so the carve-out is a `grep -vE` STAGE rather than
 * a pattern tweak, and a pattern-only assertion could not see the stage at all. The
 * workflow block is extracted between two markers and run in a scratch tree — with the
 * canonical module present (MinSpec) and absent (a scaffolded consuming repo, which must
 * inherit none of MinSpec's exemptions: invariant 3, MinSpec's blast radius is the
 * project it is installed in).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isBoundaryPath } from '../../../scripts/auto-merge-gate';
import {
  MACHINERY_CARVE_OUTS,
  MACHINERY_DIR_PREFIXES,
  MACHINERY_SINGLE_FILES,
  assertCarveOutsWellFormed,
  buildMachineryCarveOutRegexSource,
  isMachineryPath,
} from '../src/lib/machinery-paths';

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ai-review.yml');
const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');
const DOCS_CORPUS_SH = path.join(ROOT, 'scripts', 'lib', 'docs-corpus.sh');

/** The directories a carved path must never be referenced from. */
const SCANNED_DIRS = ['.github', '.githooks', 'scripts'] as const;

/** Where an `npm run <script>` indirection would actually wire a path into a gate. */
const EXECUTING_DIRS = ['.github', '.githooks'] as const;

/**
 * The declaration sites of the carve-out list itself. Their lines CONTAIN the carved
 * paths by construction, so the rot guard must skip them — and the skip is keyed on the
 * variable name, then counted, so it can never quietly widen into a blanket pass.
 */
const DECLARATION_LINE = /MACHINERY_CARVE_OUT_RE=/;
const EXPECTED_DECLARATIONS = 2; // ai-review.yml + dispatch-issue.sh

function walk(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() ? [p] : [];
  });
}

function readText(file: string): string | undefined {
  const buf = fs.readFileSync(file);
  // Skip binaries rather than pretending a NUL-bearing blob is source text.
  if (buf.includes(0)) return undefined;
  return buf.toString('utf-8');
}

/** Pull `<NAME>='<pattern>'` out of a shell/YAML source. Fails loudly, never vacuously. */
function shellVar(src: string, name: string, what: string): string {
  const m = new RegExp(`^\\s*${name}='([^']+)'`, 'm').exec(src);
  expect(m, `${name} not found (as a non-empty single-quoted literal) in ${what}`).toBeTruthy();
  return (m as RegExpExecArray)[1];
}

// ── The workflow's own shell, extracted and executable ───────────────────────

const BEGIN_MARKER = '── BEGIN machinery self-edit classification';
const END_MARKER = '── END machinery self-edit classification';

/** The run-block region between the two markers, dedented so bash can run it. */
function machineryBlock(): string {
  const lines = fs.readFileSync(WORKFLOW, 'utf-8').split('\n');
  const begin = lines.findIndex((l) => l.includes(BEGIN_MARKER));
  const end = lines.findIndex((l) => l.includes(END_MARKER));
  expect(begin, `no "${BEGIN_MARKER}" marker in ai-review.yml`).toBeGreaterThan(-1);
  expect(end, `no "${END_MARKER}" marker after the BEGIN marker in ai-review.yml`).toBeGreaterThan(
    begin,
  );
  const body = lines.slice(begin + 1, end);
  const indent = Math.min(
    ...body.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
  );
  expect(indent, 'the extracted block is not indented inside a YAML run: scalar').toBeGreaterThan(0);
  return body.map((l) => l.slice(indent)).join('\n');
}

/**
 * Run the extracted block over `changed`, in a scratch tree that either does or does not
 * contain the canonical module the workflow's repo-scope guard keys on. Returns
 * SELF_EDIT_KIND, or `none` when the block classified the change set as not-a-self-edit.
 *
 * `bash -e` and nothing else, because that is GitHub Actions' default shell for a `run:`
 * step with no `shell:` key — the conditions the block actually executes under.
 */
function classifyViaWorkflow(
  changed: readonly string[],
  opts: { canonicalModulePresent: boolean; changedOk?: boolean },
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-carveout-'));
  try {
    if (opts.canonicalModulePresent) {
      const libDir = path.join(dir, 'packages', 'minspec', 'src', 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'machinery-paths.ts'), '');
    }
    const script = [
      'CHANGED="$MINSPEC_TEST_CHANGED"',
      `CHANGED_OK=${opts.changedOk === false ? 'no' : 'yes'}`,
      machineryBlock(),
      'printf "%s\\n" "${SELF_EDIT_KIND:-none}"',
    ].join('\n');
    return execFileSync('bash', ['-e', '-c', script], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, MINSPEC_TEST_CHANGED: changed.join('\n') },
    }).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** dispatch-issue.sh's pure withhold seam: `hold` (human owns the merge) or `arm`. */
function classifyViaDispatch(changed: readonly string[]): string {
  try {
    return execFileSync('bash', [DISPATCH, '--paths-have-approvable-doc'], {
      input: changed.join('\n') + '\n',
      encoding: 'utf-8',
    }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string };
    return String(err.stdout ?? '').trim();
  }
}

// ── 1. The list itself ───────────────────────────────────────────────────────

describe('#2018 the carve-out list is well-formed and non-vacuous', () => {
  it('is non-empty, so this whole suite has a subject', () => {
    // Guards against the shape where every assertion below iterates an empty array and
    // the file reports green having checked nothing.
    expect(MACHINERY_CARVE_OUTS.length).toBeGreaterThan(0);
  });

  it('passes its own structural validation', () => {
    expect(() => assertCarveOutsWellFormed()).not.toThrow();
  });

  it('every entry lies under a machinery directory prefix', () => {
    // An exemption for a path that was never machinery is a dead line that reads as a
    // live decision.
    for (const p of MACHINERY_CARVE_OUTS) {
      expect(
        MACHINERY_DIR_PREFIXES.some((prefix) => p.startsWith(prefix)),
        `${p} is exempt from nothing`,
      ).toBe(true);
    }
  });

  it('no entry is also in MACHINERY_SINGLE_FILES', () => {
    for (const p of MACHINERY_CARVE_OUTS) {
      expect(MACHINERY_SINGLE_FILES).not.toContain(p);
    }
  });

  it('generates a fully-anchored alternative per entry', () => {
    const src = buildMachineryCarveOutRegexSource();
    expect(src.split('|')).toHaveLength(MACHINERY_CARVE_OUTS.length);
    for (const alt of src.split('|')) {
      expect(alt.startsWith('^'), `${alt} is not start-anchored`).toBe(true);
      expect(alt.endsWith('$'), `${alt} is not end-anchored`).toBe(true);
    }
    // Unanchored would be the catastrophic form: `scripts/facts.ts` as a substring rule
    // would exempt every path containing it.
    const re = new RegExp(src);
    expect(re.test('vendor/scripts/facts.ts')).toBe(false);
    expect(re.test('scripts/facts.ts.bak')).toBe(false);
  });
});

// ── 2. EXISTENCE GUARD ───────────────────────────────────────────────────────

describe('#2018 EXISTENCE GUARD — a carved path must exist in the tree', () => {
  // A rename that leaves the exemption behind is the silent-widening case: the dead line
  // reads as reviewed, and the next file to land at that path inherits an exemption
  // nobody granted it. Seeding the list only with paths that are already on `main` (and
  // leaving a not-yet-merged file's entry to the PR that introduces it) is what keeps
  // this assertion true at every commit rather than only at the tip.
  for (const p of MACHINERY_CARVE_OUTS) {
    it(`${p} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, p)), `${p} is carved out but not in the tree`).toBe(
        true,
      );
    });
  }
});

// ── 3. ROT GUARD ─────────────────────────────────────────────────────────────

describe('#2018 ROT GUARD — nothing that decides may reference a carved path', () => {
  const files = SCANNED_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it('actually scanned something (a guard over an empty file list proves nothing)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('skips exactly the declaration sites, so the skip cannot become a blanket pass', () => {
    const declarations = files.flatMap((f) => {
      const text = readText(f);
      if (text === undefined) return [];
      return text.split('\n').some((l) => DECLARATION_LINE.test(l)) ? [path.relative(ROOT, f)] : [];
    });
    expect(declarations.sort()).toEqual(
      ['.github/workflows/ai-review.yml', 'scripts/dispatch-issue.sh'].sort(),
    );
    expect(declarations).toHaveLength(EXPECTED_DECLARATIONS);
  });

  for (const carved of MACHINERY_CARVE_OUTS) {
    it(`no workflow, hook or script references ${carved}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (rel === carved) continue; // a file may name itself
        const text = readText(file);
        if (text === undefined) continue;
        text.split('\n').forEach((line, i) => {
          if (DECLARATION_LINE.test(line)) return;
          if (line.includes(carved)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(
        hits,
        `${carved} is carved out of the machinery set on the promise that nothing which ` +
          `decides reads it. These references break that promise — either remove them, or ` +
          `remove the carve-out (#2018):\n${hits.join('\n')}`,
      ).toEqual([]);
    });
  }

  it('the positive CONTROL: the same scan finds validate-frontmatter.ts consumers', () => {
    // Three empty results prove nothing on their own. `scripts/validate-frontmatter.ts` is
    // a genuine gate with genuine consumers, so if the scan cannot see THOSE it is broken
    // and every assertion above is vacuous.
    const control = 'scripts/validate-frontmatter.ts';
    expect(fs.existsSync(path.join(ROOT, control))).toBe(true);
    const consumers = files.filter((f) => {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (rel === control) return false;
      const text = readText(f);
      return text !== undefined && text.includes(control);
    });
    expect(consumers.length, 'the reference scan found no consumers of a file that has them').
      toBeGreaterThan(1);
    expect(
      consumers.map((f) => path.relative(ROOT, f).split(path.sep).join('/')),
    ).toContain('.githooks/pre-commit');
  });

  it('no npm script that runs a carved path is invoked from a workflow or a hook', () => {
    // The indirection the issue names explicitly: "a report script that later gets wired
    // into CI". `npm run facts` names no path, so the literal scan above cannot see it.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const runners = Object.entries(scripts)
      .filter(([, cmd]) => MACHINERY_CARVE_OUTS.some((p) => cmd.includes(p)))
      .map(([name]) => name);

    // Not an assertion about how many there are — just a record of what is being checked,
    // so an empty `runners` cannot silently make this test vacuous.
    expect(Array.isArray(runners)).toBe(true);

    const executing = EXECUTING_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    expect(executing.length, 'nothing to scan for npm-run indirection').toBeGreaterThan(5);

    const hits: string[] = [];
    for (const name of runners) {
      const re = new RegExp(`npm\\s+run\\s+(?:-\\S+\\s+)*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      for (const file of executing) {
        const text = readText(file);
        if (text === undefined) continue;
        text.split('\n').forEach((line, i) => {
          if (re.test(line)) {
            hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(
      hits,
      `an npm script that runs a carved-out path (${runners.join(', ')}) is invoked from CI ` +
        `or a git hook, so the path now decides something:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});

// ── 4. DISJOINTNESS from dispatch's other withhold mandates ──────────────────

describe("#2018 a carve-out must not silently exempt one of dispatch's OTHER mandates", () => {
  const dispatchSrc = fs.readFileSync(DISPATCH, 'utf-8');
  const docsSrc = fs.readFileSync(DOCS_CORPUS_SH, 'utf-8');

  const otherMandates: ReadonlyArray<[string, string]> = [
    ['DOCS_CORPUS_RE', shellVar(docsSrc, 'DOCS_CORPUS_RE', 'scripts/lib/docs-corpus.sh')],
    ['PUBLISH_PATH_RE', shellVar(dispatchSrc, 'PUBLISH_PATH_RE', 'scripts/dispatch-issue.sh')],
    ['governance', '^\\.minspec/|^\\.cursorrules$'],
  ];

  it('the mandates were really parsed (not empty strings matching nothing)', () => {
    for (const [name, re] of otherMandates) {
      expect(re.length, `${name} parsed empty`).toBeGreaterThan(3);
    }
    // Control: PUBLISH_PATH_RE genuinely covers a path that is ALSO under `.github/`,
    // which is why this disjointness check is not a formality.
    const publish = otherMandates.find(([n]) => n === 'PUBLISH_PATH_RE')![1];
    expect(new RegExp(publish).test('.github/workflows/deploy-sites.yml')).toBe(true);
  });

  for (const carved of MACHINERY_CARVE_OUTS) {
    for (const [name, re] of otherMandates) {
      it(`${carved} does not match ${name}`, () => {
        expect(
          new RegExp(re).test(carved),
          `${carved} is filtered out before dispatch's combined withhold grep, so a match ` +
            `here would silently exempt it from the ${name} mandate too`,
        ).toBe(false);
      });
    }
  }
});

// ── 5. The two hand-copies are pinned to the canonical generator ─────────────

describe('#2018 both hand-copies carry the canonical carve-out pattern', () => {
  const canonical = buildMachineryCarveOutRegexSource();

  it('scripts/dispatch-issue.sh, character for character', () => {
    expect(shellVar(fs.readFileSync(DISPATCH, 'utf-8'), 'MACHINERY_CARVE_OUT_RE', DISPATCH)).toBe(
      canonical,
    );
  });

  it('.github/workflows/ai-review.yml, character for character', () => {
    expect(shellVar(fs.readFileSync(WORKFLOW, 'utf-8'), 'MACHINERY_CARVE_OUT_RE', WORKFLOW)).toBe(
      canonical,
    );
  });
});

// ── 6. The effect, at every decision that actually holds a PR ────────────────

const SIBLING_MACHINERY = 'scripts/dispatch-issue.sh';
const ORDINARY_CODE = 'packages/minspec/src/lib/foo.ts';

describe('#2018 the carve-out is EFFECTIVE at all four consumers', () => {
  it('the sibling control is still machinery everywhere (the set did not collapse)', () => {
    expect(isMachineryPath(SIBLING_MACHINERY)).toBe(true);
    expect(isBoundaryPath(SIBLING_MACHINERY)).toBe(true);
    expect(classifyViaDispatch([SIBLING_MACHINERY])).toBe('hold');
    expect(classifyViaWorkflow([SIBLING_MACHINERY], { canonicalModulePresent: true })).toBe(
      'machinery',
    );
  });

  for (const carved of MACHINERY_CARVE_OUTS) {
    it(`${carved}: canonical predicate says not machinery`, () => {
      expect(isMachineryPath(carved)).toBe(false);
    });

    it(`${carved}: auto-merge-gate.ts does not inject high-blast manifest_changed`, () => {
      expect(isBoundaryPath(carved)).toBe(false);
      // Still boundary where it is NOT the exact repo-relative path.
      expect(isBoundaryPath('vendor/' + carved)).toBe(true);
    });

    it(`${carved}: dispatch-issue.sh arms rather than withholding`, () => {
      expect(classifyViaDispatch([carved])).toBe('arm');
    });

    it(`${carved}: ai-review.yml does not force SELF_EDIT_KIND=machinery`, () => {
      expect(classifyViaWorkflow([carved], { canonicalModulePresent: true })).toBe('none');
    });

    it(`${carved}: a PR that ALSO touches real machinery is still held everywhere`, () => {
      expect(classifyViaDispatch([carved, SIBLING_MACHINERY])).toBe('hold');
      expect(
        classifyViaWorkflow([carved, SIBLING_MACHINERY], { canonicalModulePresent: true }),
      ).toBe('machinery');
    });
  }

  it('a PR of ONLY carved paths plus ordinary code arms and is not a self-edit', () => {
    expect(classifyViaDispatch([...MACHINERY_CARVE_OUTS, ORDINARY_CODE])).toBe('arm');
    expect(
      classifyViaWorkflow([...MACHINERY_CARVE_OUTS, ORDINARY_CODE], {
        canonicalModulePresent: true,
      }),
    ).toBe('none');
  });
});

describe('#2018 the canonical module itself is now machinery (closes the #596 hole)', () => {
  const SELF = 'packages/minspec/src/lib/machinery-paths.ts';

  it('is listed in MACHINERY_SINGLE_FILES', () => {
    expect(MACHINERY_SINGLE_FILES).toContain(SELF);
  });

  it('every consumer classifies it as machinery, so a narrowing PR cannot self-certify', () => {
    expect(isMachineryPath(SELF)).toBe(true);
    expect(isBoundaryPath(SELF)).toBe(true);
    expect(classifyViaDispatch([SELF])).toBe('hold');
    expect(classifyViaWorkflow([SELF], { canonicalModulePresent: true })).toBe('machinery');
  });
});

// ── 7. Fail-closed behaviour, and the downstream blast-radius boundary ───────

describe('#2018 ai-review.yml fails closed and does not export MinSpec’s exemptions', () => {
  it('inherits NO carve-out where the canonical module is absent (invariant 3)', () => {
    // This workflow is scaffolded verbatim into every consuming repo. A consuming repo
    // with its own `scripts/facts.ts` must NOT find it silently exempted from a gate its
    // own authors rely on.
    for (const carved of MACHINERY_CARVE_OUTS) {
      expect(classifyViaWorkflow([carved], { canonicalModulePresent: false })).toBe('machinery');
    }
  });

  it('still reports indeterminate when the changed set could not be computed', () => {
    // The carve-out stage runs BEFORE the indeterminate branch, so it must not be able to
    // turn "we cannot tell" into "clean".
    expect(
      classifyViaWorkflow([], { canonicalModulePresent: true, changedOk: false }),
    ).toBe('indeterminate');
    expect(
      classifyViaWorkflow([...MACHINERY_CARVE_OUTS], {
        canonicalModulePresent: true,
        changedOk: false,
      }),
    ).toBe('indeterminate');
  });
});

describe('#2018 the generator refuses to emit a pattern that would disarm the gate', () => {
  it('an empty list is a THROW, never an empty pattern', () => {
    // `grep -vE ''` matches every line, so an empty pattern deletes the whole change set
    // and both shell consumers would classify every PR as non-machinery — a fail-OPEN on
    // a load-bearing gate. The empty list is therefore not representable as output.
    expect(() => buildMachineryCarveOutRegexSource([])).toThrow(/empty/i);
  });

  it('a path that was never machinery is a THROW (a dead exemption)', () => {
    expect(() => buildMachineryCarveOutRegexSource(['README.md'])).toThrow(
      /under no machinery directory prefix/,
    );
  });

  it('a path that is also MACHINERY_SINGLE_FILES is a THROW', () => {
    expect(() => buildMachineryCarveOutRegexSource([MACHINERY_SINGLE_FILES[0]])).toThrow(/BOTH/);
  });

  it('a duplicated entry is a THROW', () => {
    expect(() => buildMachineryCarveOutRegexSource(['scripts/x.ts', 'scripts/x.ts'])).toThrow(
      /listed twice/,
    );
  });

  it('a non-POSIX or directory-shaped path is a THROW', () => {
    expect(() => buildMachineryCarveOutRegexSource(['scripts/'])).toThrow(/FILE path/);
    expect(() => buildMachineryCarveOutRegexSource(['./scripts/x.ts'])).toThrow(/FILE path/);
  });

  it('a well-formed list IS accepted (so the throws above are not blanket refusals)', () => {
    expect(buildMachineryCarveOutRegexSource(['scripts/x.ts'])).toBe('^scripts/x\\.ts$');
  });
});

// ── 8. dispatch's filter fails CLOSED on its two degenerate inputs ───────────

describe('#2018 machinery_carve_out_filter fails closed, behaviourally', () => {
  /**
   * Extract the bash function from dispatch-issue.sh and run it standalone, so the two
   * branches that would silently disarm the second witness are EXECUTED rather than
   * read. An empty pattern is the dangerous one: `grep -vE ''` filters every line away,
   * leaving the machinery grep nothing to match and every PR classified as non-machinery.
   */
  function extractFilter(): string {
    const lines = fs.readFileSync(DISPATCH, 'utf-8').split('\n');
    const start = lines.findIndex((l) => l.startsWith('machinery_carve_out_filter() {'));
    expect(start, 'machinery_carve_out_filter() not found in dispatch-issue.sh').toBeGreaterThan(
      -1,
    );
    const end = lines.findIndex((l, i) => i > start && l === '}');
    expect(end, 'no closing brace for machinery_carve_out_filter()').toBeGreaterThan(start);
    return lines.slice(start, end + 1).join('\n');
  }

  function runFilter(pattern: string | undefined, paths: readonly string[]): string {
    const decl = pattern === undefined ? 'unset MACHINERY_CARVE_OUT_RE || true' : `MACHINERY_CARVE_OUT_RE=${JSON.stringify(pattern)}`;
    const script = [
      'set -euo pipefail',
      decl,
      extractFilter(),
      'machinery_carve_out_filter',
    ].join('\n');
    return execFileSync('bash', ['-c', script], {
      input: paths.join('\n') + '\n',
      encoding: 'utf-8',
    });
  }

  const real = buildMachineryCarveOutRegexSource();

  it('with the real pattern, it drops exactly the carved paths', () => {
    const out = runFilter(real, [...MACHINERY_CARVE_OUTS, SIBLING_MACHINERY, ORDINARY_CODE]);
    const kept = out.split('\n').filter((l) => l.trim() !== '');
    expect(kept.sort()).toEqual([SIBLING_MACHINERY, ORDINARY_CODE].sort());
  });

  it('with an EMPTY pattern it passes the list through unfiltered, never empties it', () => {
    const input = [SIBLING_MACHINERY, ...MACHINERY_CARVE_OUTS];
    const kept = runFilter('', input)
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(kept.sort()).toEqual([...input].sort());
  });

  it('with the variable UNSET it passes the list through unfiltered', () => {
    const input = [SIBLING_MACHINERY, ...MACHINERY_CARVE_OUTS];
    const kept = runFilter(undefined, input)
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(kept.sort()).toEqual([...input].sort());
  });

  it('a set of ONLY carved paths yields nothing to classify (not an error)', () => {
    const kept = runFilter(real, [...MACHINERY_CARVE_OUTS])
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(kept).toEqual([]);
  });
});
