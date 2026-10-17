/**
 * T0 - SPEC-086 FR-9: MinSpec does not recommend ScroogeLLM, and what recommended it
 * cannot come back unnoticed.
 *
 * MinSpec used to show an install prompt for ScroogeLLM, a product that is shelved and is
 * not published (issue #2205). SPEC-086 removed the prompt, the probe of the user's other
 * AI tools that worded it, the conformance export built for ScroogeLLM to read, two
 * settings and a command. This file is the gate that keeps them out.
 *
 * WHAT THIS PINS
 *   1. The manifest. No key and no string anywhere in `packages/minspec/package.json`
 *      names the product, and neither of the two ids the bridge contributed without the
 *      product's name in them is used. That covers command ids and titles, setting keys
 *      and descriptions, keywords, walkthrough steps, menus and `extensionPack`.
 *   2. The listing text. No document in the package root, no file under `media/` and no
 *      file the manifest points at names the product.
 *   3. The source that is bundled into the extension. The extension id
 *      `aiclarity.scroogellm`, or a Marketplace or Open VSX address for it, appears
 *      nowhere in it, comments included. And no string the shipped code holds names the
 *      product or a retired id. A string is the only way source can put a message, a
 *      link, a setting key or a stored-state key in front of a user, so this also catches
 *      a prompt whose wording lives in code. A bundled file that is not TypeScript (a JSON
 *      asset, say) is read whole.
 *   4. The extension pack. `packages/extension-pack` names the product by design until
 *      its retirement is decided (issue #2359), so it must stay impossible to package
 *      through its scripts: `private: true`, and a `package` script that can only refuse.
 *      The refusal says the product is shelved and does not say when to lift the guard.
 *      No other extension manifest in the repository may name the product.
 *
 * WHAT THIS DOES NOT COVER (SPEC-086 DQ-5). These are text checks. Green means "the
 * product is not named on these surfaces". It never means "no mention anywhere".
 *   - Code comments are not read, apart from the extension id and store addresses in 3.
 *     The comments that name the scroogellm repository as an adopter of MinSpec, and the
 *     ones that use `scroogellm` as an example product slug, are legitimate and stay.
 *   - `packages/minspec/CHANGELOG.md` is not read. It records that the bridge was added
 *     and that it was removed, and both entries have to name the product.
 *   - A recommendation worded without the product's name passes. So does a name
 *     assembled at run time from pieces.
 *   - The repository's own documents (the root README, specs, decision records) are not
 *     the extension. SPEC-086 lists the ones that still describe the bridge and where
 *     each is tracked.
 *
 * Every check runs twice: against the real tree, and against small invented inputs that
 * contain the thing it looks for. The second run is what shows that a green on the real
 * tree is a finding, and not a reader that sees nothing.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

const MANIFEST = path.join(PACKAGE_ROOT, 'package.json');
const PACK_MANIFEST = path.join(PACKAGES_DIR, 'extension-pack', 'package.json');

/** The two trees the shipped bundle is built from. */
const SOURCE_ROOTS = [path.join(PACKAGE_ROOT, 'src'), path.join(PACKAGES_DIR, 'shared', 'src')];

/** Directories under a source root that are not bundled: the end-to-end suite and the benchmarks. */
const NOT_SHIPPED: ReadonlySet<string> = new Set(['test', '__benchmarks__']);

/** A longer limit for the checks that parse every source file or start a process. */
const SLOW = 120_000;

// ─── Rules ──────────────────────────────────────────────────────────────────

interface Rule {
  /** What is wrong with text that matches, written to finish the sentence "this ...". */
  readonly why: string;
  readonly pattern: RegExp;
}

interface Finding {
  /** A file and line, or a path into a manifest. */
  readonly where: string;
  /** Which rule it breaks, with enough of the text to recognise it. */
  readonly what: string;
}

/** The product's name in any casing or form: ScroogeLLM, scroogellm, Scrooge. */
const PRODUCT = /scrooge/i;

/**
 * What may not appear on a surface a user can see.
 *
 * The first rule is the product's name. The other two are the ids the bridge contributed
 * that do not contain that name, so the first rule cannot see them (SPEC-086 FR-9). Each
 * is matched as a whole id: a longer id that starts the same way is a different id.
 * Source reads a setting through `getConfiguration('minspec')`, without the `minspec.`
 * prefix, so the prefix is optional on the setting.
 */
const SURFACE_RULES: readonly Rule[] = [
  { why: 'names ScroogeLLM', pattern: PRODUCT },
  {
    why: 'uses the retired setting minspec.conformance.enabled',
    pattern: /(?<![A-Za-z0-9_])(?:minspec\.)?conformance\.enabled(?![A-Za-z0-9_])/,
  },
  {
    why: 'uses the retired command minspec.exportTraceability',
    pattern: /(?<![A-Za-z0-9_])minspec\.exportTraceability(?![A-Za-z0-9_])/,
  },
];

/**
 * Ways to point a user at the product so that they can install it. Unlike the rules
 * above these are looked for in comments too: FR-9 says "anywhere under the source".
 * An address on github.com is not one of them. The scroogellm repository is a real
 * adopter of MinSpec and comments cite it.
 */
const INSTALL_TARGET_RULES: readonly Rule[] = [
  { why: 'carries the extension id aiclarity.scroogellm', pattern: /aiclarity\.scroogellm/i },
  {
    why: 'carries a Marketplace address for ScroogeLLM',
    pattern: /marketplace\.visualstudio\.com[^\s'"`]*scrooge/i,
  },
  { why: 'carries an Open VSX address for ScroogeLLM', pattern: /open-vsx\.org[^\s'"`]*scrooge/i },
];

/** The part of `text` around the first match of `pattern`, on one line. */
function around(text: string, pattern: RegExp): string {
  const at = Math.max(0, text.search(pattern));
  const from = Math.max(0, at - 40);
  const to = at + 80;
  const piece = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '...' : ''}${piece}${to < text.length ? '...' : ''}`;
}

/** Every rule that `text` breaks, as findings located at `where`. */
function check(where: string, text: string, rules: readonly Rule[]): Finding[] {
  return rules
    .filter(rule => rule.pattern.test(text))
    .map(rule => ({ where, what: `${rule.why}: ${around(text, rule.pattern)}` }));
}

/** The same, line by line, so a finding in a file carries its line number. */
function checkLines(where: string, text: string, rules: readonly Rule[]): Finding[] {
  return text.split('\n').flatMap((line, index) => check(`${where}:${index + 1}`, line, rules));
}

// ─── Readers ────────────────────────────────────────────────────────────────

const read = (file: string): string => fs.readFileSync(file, 'utf-8');

/** Bytes as text, one character per byte, so an image or any other file can be searched too. */
const readAnyFile = (file: string): string => fs.readFileSync(file, 'latin1');

const rel = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Every file under `dir`, at any depth, leaving out directories named in `skip`. */
function filesUnder(dir: string, skip: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) out.push(...filesUnder(full, skip));
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

/** Every key and every string value of a JSON document, each with the path that leads to it. */
function jsonStrings(node: unknown, trail: readonly string[] = []): Array<{ where: string; text: string }> {
  if (typeof node === 'string') return [{ where: trail.join('/'), text: node }];
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => jsonStrings(child, [...trail, String(index)]));
  }
  if (isRecord(node)) {
    return Object.entries(node).flatMap(([key, value]) => [
      { where: `${[...trail, key].join('/')} (the key itself)`, text: key },
      ...jsonStrings(value, [...trail, key]),
    ]);
  }
  return [];
}

/** The text of every string and template literal in a TypeScript source. A comment is not a literal. */
function stringLiterals(file: string, source: string): Array<{ line: number; text: string }> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ line: line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// ─── The four checks ────────────────────────────────────────────────────────

/** 1. What a manifest says that it may not. */
function manifestFindings(manifest: unknown): Finding[] {
  return jsonStrings(manifest).flatMap(({ where, text }) => check(where, text, SURFACE_RULES));
}

/** A manifest string that is a path to a document or an image inside the package. */
const POINTS_AT_A_FILE = /^[^\s:$]+\.(?:md|markdown|svg|png|gif|jpe?g|webp|html?|txt)$/i;

/**
 * 2. The files a user reads on the listing or in the editor: every document in the
 * package root except the changelog, everything under `media/`, and any other file the
 * manifest points at. The last part is there so that a walkthrough page kept outside
 * `media/` is still read. A path that points at no file shows the user nothing, so it is
 * left out without comment.
 */
function listingFiles(packageRoot: string, manifest: unknown): string[] {
  const rootDocuments = fs
    .readdirSync(packageRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => (/\.md$/i.test(name) || /^LICEN[CS]E/i.test(name)) && name !== 'CHANGELOG.md')
    .map(name => path.join(packageRoot, name));
  const mediaDir = path.join(packageRoot, 'media');
  const media = fs.existsSync(mediaDir) ? filesUnder(mediaDir) : [];
  const pointedAt = jsonStrings(manifest)
    .map(({ text }) => text)
    .filter(text => POINTS_AT_A_FILE.test(text))
    .map(text => path.resolve(packageRoot, text))
    .filter(file => file.startsWith(packageRoot + path.sep))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  return [...new Set([...rootDocuments, ...media, ...pointedAt])].sort();
}

/** 3a. An install target anywhere in a source file, comments included. */
function installTargetFindings(where: string, source: string): Finding[] {
  return checkLines(where, source, INSTALL_TARGET_RULES);
}

/**
 * 3b. Text the shipped code holds that names the product or a retired id. In TypeScript
 * that is every string and template literal, and never a comment. Any other file bundled
 * from a source tree (a JSON asset, say) has no comments to leave alone, so every line of
 * it counts.
 */
function heldTextFindings(where: string, source: string): Finding[] {
  if (!where.endsWith('.ts')) return checkLines(where, source, SURFACE_RULES);
  return stringLiterals(where, source).flatMap(({ line, text }) =>
    check(`${where}:${line}`, text, SURFACE_RULES),
  );
}

/**
 * The only `package` script this gate will run: one `node -e "<program>"`, nothing before
 * or after it, and nothing inside the quotes that a shell would rewrite.
 *
 * The shape is load-bearing. npm runs a script with `node_modules/.bin` on PATH and this
 * test does not, so a script that called `vsce package` would fail here with "not found",
 * exit non-zero, and be read as a refusal. A lone `node -e` behaves the same in both.
 */
const REFUSAL_ONLY = /^node -e "([^"$`\\]*)"$/;

/** Wording that makes the guard temporary: "remove this guard", "until it ships", "once it is live". */
const LIFTS_THE_GUARD: readonly RegExp[] = [
  /remove (?:this|the) guard/i,
  /\b(?:until|once|when|after)\b[^.]*\b(?:ships?|shipped|live|published|released|launch(?:es|ed)?)\b/i,
];

/**
 * 4. Why a manifest could still be packaged through its scripts, or why its refusal
 * misleads. Empty means it cannot, and that it says why honestly.
 */
function guardFindings(where: string, manifest: unknown): Finding[] {
  if (!isRecord(manifest)) return [{ where, what: 'is not a JSON object' }];
  const findings: Finding[] = [];

  if (manifest.private !== true) {
    findings.push({
      where: `${where} private`,
      what: `is ${JSON.stringify(manifest.private)}; it must be true`,
    });
  }

  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const otherScripts = Object.keys(scripts).filter(name => name !== 'package');
  if (otherScripts.length > 0) {
    findings.push({
      where: `${where} scripts`,
      what: `has scripts besides "package" (${otherScripts.join(', ')}); any of them could package or publish`,
    });
  }

  const script = scripts.package;
  const program = typeof script === 'string' ? REFUSAL_ONLY.exec(script)?.[1] : undefined;
  if (program === undefined) {
    findings.push({
      where: `${where} scripts/package`,
      what: `is not a lone node -e "..." refusal: ${JSON.stringify(script)}`,
    });
    return findings;
  }

  const run = spawnSync(process.execPath, ['-e', program], { encoding: 'utf-8', timeout: 60_000 });
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.error !== undefined) {
    findings.push({ where: `${where} scripts/package`, what: `could not be run: ${run.error.message}` });
  } else if (typeof run.status !== 'number' || run.status === 0) {
    findings.push({
      where: `${where} scripts/package`,
      what: `must exit non-zero; it exited ${String(run.status)}`,
    });
  }
  if (!/shelved/i.test(said) || !/DR-021/.test(said)) {
    findings.push({
      where: `${where} scripts/package`,
      what: `does not say that ScroogeLLM is shelved (scroogellm DR-021): ${around(said, /\S/)}`,
    });
  }
  for (const pattern of LIFTS_THE_GUARD) {
    if (pattern.test(said)) {
      findings.push({
        where: `${where} scripts/package`,
        what: `says when to lift the guard: ${around(said, pattern)}`,
      });
    }
  }
  return findings;
}

/** Every manifest under `packages/` that declares itself a VS Code extension. */
function extensionManifests(): Array<{ file: string; manifest: unknown }> {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(PACKAGES_DIR, entry.name, 'package.json'))
    .filter(file => fs.existsSync(file))
    .map(file => ({ file, manifest: JSON.parse(read(file)) as unknown }))
    .filter(({ manifest }) => isRecord(manifest) && isRecord(manifest.engines) && typeof manifest.engines.vscode === 'string');
}

const namesTheProduct = (manifest: unknown): boolean =>
  jsonStrings(manifest).some(({ text }) => PRODUCT.test(text));

// ─── 1. The manifest ────────────────────────────────────────────────────────

describe('the manifest names neither ScroogeLLM nor a retired id (SPEC-086 FR-3, FR-4, FR-9)', () => {
  const manifest = JSON.parse(read(MANIFEST)) as unknown;

  it('reads the manifest rather than an empty document', () => {
    // If the walk ever returned nothing, "no finding" below would pass on a blind reader.
    const strings = jsonStrings(manifest);
    expect(strings.length).toBeGreaterThan(300);
    expect(strings.filter(s => /^contributes\/commands\/\d+\/title$/.test(s.where)).length).toBeGreaterThan(20);
    expect(
      strings.filter(s => /^contributes\/configuration\/properties\/[^/]+ \(the key itself\)$/.test(s.where)).length,
    ).toBeGreaterThan(5);
    expect(strings.filter(s => /^keywords\/\d+$/.test(s.where)).length).toBeGreaterThan(0);
  });

  it('no key and no string in it names the product or a retired id', () => {
    expect(manifestFindings(manifest)).toEqual([]);
  });
});

// ─── 2. The listing text ────────────────────────────────────────────────────

describe('the listing text does not name ScroogeLLM (SPEC-086 FR-9)', () => {
  const manifest = JSON.parse(read(MANIFEST)) as unknown;
  const files = listingFiles(PACKAGE_ROOT, manifest);

  it('reads the README, the media folder and the walkthrough pages rather than an empty list', () => {
    const names = files.map(rel);
    expect(names).toContain('packages/minspec/README.md');
    expect(read(path.join(PACKAGE_ROOT, 'README.md')).length).toBeGreaterThan(1000);
    expect(names.filter(name => name.startsWith('packages/minspec/media/')).length).toBeGreaterThan(5);
    expect(names.filter(name => name.startsWith('packages/minspec/media/') && name.endsWith('.md')).length).toBeGreaterThan(0);
  });

  it('leaves the changelog out, and says so', () => {
    // History: it records the bridge being added and being removed (SPEC-086 FR-10).
    expect(files.map(rel)).not.toContain('packages/minspec/CHANGELOG.md');
    expect(fs.existsSync(path.join(PACKAGE_ROOT, 'CHANGELOG.md'))).toBe(true);
  });

  it('no file in it names the product or a retired id', () => {
    expect(files.flatMap(file => checkLines(rel(file), readAnyFile(file), SURFACE_RULES))).toEqual([]);
  });
});

// ─── 3. The source ──────────────────────────────────────────────────────────

describe('the bundled source cannot put ScroogeLLM in front of a user (SPEC-086 FR-1, FR-3, FR-4, FR-9)', () => {
  const everyFile = SOURCE_ROOTS.flatMap(root => filesUnder(root));
  const shipped = SOURCE_ROOTS.flatMap(root => filesUnder(root, NOT_SHIPPED));

  it('reads the source trees rather than an empty list', () => {
    expect(everyFile.length).toBeGreaterThan(100);
    expect(shipped.length).toBeGreaterThan(100);
    expect(everyFile.length).toBeGreaterThan(shipped.length);
    expect(shipped.map(rel)).toContain('packages/minspec/src/extension.ts');
    expect(shipped.map(rel)).toContain('packages/shared/src/index.ts');
  });

  it(
    'finds string literals in it rather than none',
    () => {
      const extension = path.join(PACKAGE_ROOT, 'src', 'extension.ts');
      const literals = stringLiterals(extension, read(extension)).map(literal => literal.text);
      // The command ids are how activation is wired, so they are a stable thing to look for.
      expect(literals.filter(text => /^minspec\.[A-Za-z.]+$/.test(text)).length).toBeGreaterThan(20);
    },
    SLOW,
  );

  it('the extension id and store addresses appear nowhere, comments included', () => {
    expect(everyFile.flatMap(file => installTargetFindings(rel(file), read(file)))).toEqual([]);
  });

  it(
    'no string the shipped code holds names the product or a retired id',
    () => {
      expect(shipped.flatMap(file => heldTextFindings(rel(file), read(file)))).toEqual([]);
    },
    SLOW,
  );
});

// ─── 4. The extension pack ──────────────────────────────────────────────────

describe('the extension pack cannot be packaged, and no other manifest names ScroogeLLM (SPEC-086 FR-8, FR-9)', () => {
  const manifests = extensionManifests();
  const mustBeGuarded = manifests.filter(
    ({ file, manifest }) => file !== MANIFEST && (file === PACK_MANIFEST || namesTheProduct(manifest)),
  );

  it('finds the extension manifests rather than an empty list', () => {
    expect(manifests.map(({ file }) => rel(file))).toContain('packages/minspec/package.json');
  });

  it('exactly one manifest has to be guarded: the pack', () => {
    // A second name here is another extension manifest that names the product. An empty
    // list means the pack is gone: its retirement is issue #2359, and whoever retires it
    // deletes this expectation and the one below with it.
    expect(mustBeGuarded.map(({ file }) => rel(file))).toEqual(['packages/extension-pack/package.json']);
  });

  it(
    'it keeps both halves of its guard, and its refusal names the shelving without a way out',
    () => {
      expect(mustBeGuarded.flatMap(({ file, manifest }) => guardFindings(rel(file), manifest))).toEqual([]);
    },
    SLOW,
  );
});

// ─── The checks see what they look for ──────────────────────────────────────

interface FixtureManifest {
  keywords: string[];
  extensionPack?: string[];
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: { properties: Record<string, Record<string, unknown>> };
    menus: Record<string, Array<{ command: string; when?: string }>>;
    walkthroughs: Array<{ id: string; title: string; steps: Array<{ id: string; title: string; description: string }> }>;
  };
}

/** A manifest with one of each kind of thing a reintroduction could be attached to, and none of them. */
function cleanManifest(): FixtureManifest {
  return {
    keywords: ['sdd', 'specification'],
    contributes: {
      commands: [{ command: 'minspec.init', title: 'MinSpec: Initialize SDD Structure' }],
      configuration: {
        properties: {
          'minspec.codelens.enabled': {
            type: 'boolean',
            description: 'Show spec requirement mappings above code',
            markdownDescription: 'Show **spec requirement** mappings above code',
            enumDescriptions: ['Shown', 'Hidden'],
          },
        },
      },
      menus: { commandPalette: [{ command: 'minspec.init', when: 'workspaceFolderCount > 0' }] },
      walkthroughs: [
        {
          id: 'minspec.gettingStarted',
          title: 'Get Started with MinSpec',
          steps: [{ id: 'minspec.walkthrough.welcome', title: 'Welcome', description: 'Spec before code.' }],
        },
      ],
    },
  };
}

describe('the manifest check sees every kind of reintroduction', () => {
  it('a manifest with none of it is clean', () => {
    expect(manifestFindings(cleanManifest())).toEqual([]);
  });

  const reintroductions: Array<[string, (manifest: FixtureManifest) => void, string]> = [
    [
      'a command title that names the product',
      m => m.contributes.commands.push({ command: 'minspec.exportForReview', title: 'MinSpec: Export Traceability for ScroogeLLM' }),
      'contributes/commands/1/title',
    ],
    [
      'the export command under its old id, with a title that does not name the product',
      m => m.contributes.commands.push({ command: 'minspec.exportTraceability', title: 'MinSpec: Export Traceability' }),
      'contributes/commands/1/command',
    ],
    [
      'a setting key that contains the product name',
      m => {
        m.contributes.configuration.properties['minspec.scroogellmNudge.enabled'] = { type: 'boolean', description: 'Show a tip' };
      },
      'contributes/configuration/properties/minspec.scroogellmNudge.enabled (the key itself)',
    ],
    [
      'the conformance setting under its old key, described without the product name',
      m => {
        m.contributes.configuration.properties['minspec.conformance.enabled'] = { type: 'boolean', description: 'Export on change' };
      },
      'contributes/configuration/properties/minspec.conformance.enabled (the key itself)',
    ],
    [
      'a setting description that names the product',
      m => {
        m.contributes.configuration.properties['minspec.codelens.enabled'].description = 'Works best with ScroogeLLM';
      },
      'contributes/configuration/properties/minspec.codelens.enabled/description',
    ],
    [
      'a markdownDescription that names the product',
      m => {
        m.contributes.configuration.properties['minspec.codelens.enabled'].markdownDescription = 'See [scroogellm](https://example.test)';
      },
      'contributes/configuration/properties/minspec.codelens.enabled/markdownDescription',
    ],
    [
      'an enumDescriptions entry that names the product',
      m => {
        m.contributes.configuration.properties['minspec.codelens.enabled'].enumDescriptions = ['Shown', 'Routed through SCROOGELLM'];
      },
      'contributes/configuration/properties/minspec.codelens.enabled/enumDescriptions/1',
    ],
    ['a keyword', m => m.keywords.push('scroogellm'), 'keywords/2'],
    [
      'a walkthrough step that names the product',
      m => m.contributes.walkthroughs[0].steps.push({ id: 'minspec.walkthrough.costs', title: 'Cut your costs', description: 'Install ScroogeLLM next.' }),
      'contributes/walkthroughs/0/steps/1/description',
    ],
    [
      'the product listed as a bundled extension',
      m => {
        m.extensionPack = ['aiclarity.scroogellm'];
      },
      'extensionPack/0',
    ],
    [
      'a menu entry that reads the retired setting',
      m => m.contributes.menus.commandPalette.push({ command: 'minspec.init', when: 'config.minspec.conformance.enabled' }),
      'contributes/menus/commandPalette/1/when',
    ],
  ];

  it.each(reintroductions)('flags %s', (_name, reintroduce, where) => {
    const manifest = cleanManifest();
    reintroduce(manifest);
    expect(manifestFindings(manifest).map(finding => finding.where)).toContain(where);
  });

  it('matches a retired id whole: an id that only starts the same way is a different id', () => {
    const manifest = cleanManifest();
    manifest.contributes.commands.push({ command: 'minspec.exportTraceabilityMatrix', title: 'MinSpec: Export Traceability Matrix' });
    manifest.contributes.configuration.properties['minspec.conformanceReport.enabled'] = { type: 'boolean', description: 'Write a report' };
    expect(manifestFindings(manifest)).toEqual([]);
  });
});

describe('the listing check sees a mention in a document', () => {
  it.each([
    ['a sentence that names the product', 'MinSpec pairs well with ScroogeLLM.'],
    ['a settings table row for the retired setting', '| `minspec.conformance.enabled` | `boolean` | `false` | Export on change |'],
    ['a command table row for the retired command', '| `minspec.exportTraceability` | Export traceability data |'],
    ['the name inside an image or other binary file', 'tEXtDescription\u0000made for SCROOGELLMÿØ'],
  ])('flags %s', (_name, line) => {
    expect(checkLines('README.md', `# MinSpec\n\n${line}\n`, SURFACE_RULES).map(finding => finding.where)).toEqual(['README.md:3']);
  });

  it('a document with none of it is clean', () => {
    expect(checkLines('README.md', '# MinSpec\n\nScope-adaptive spec-driven development.\n', SURFACE_RULES)).toEqual([]);
  });

  it('reads a page the manifest points at even when it is kept outside media/', () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'spec086-listing-'));
    try {
      fs.mkdirSync(path.join(root, 'pages'));
      fs.writeFileSync(path.join(root, 'pages', 'costs.md'), 'Install ScroogeLLM next.\n');
      fs.writeFileSync(path.join(root, 'README.md'), '# A package\n');
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), 'Removed the ScroogeLLM prompt.\n');
      const manifest = { contributes: { walkthroughs: [{ steps: [{ media: { markdown: 'pages/costs.md' } }] }] } };

      const files = listingFiles(root, manifest).map(file => path.relative(root, file).split(path.sep).join('/'));
      expect(files).toEqual(['README.md', 'pages/costs.md']);
      const findings = listingFiles(root, manifest).flatMap(file => checkLines(path.basename(file), readAnyFile(file), SURFACE_RULES));
      expect(findings.map(finding => finding.where)).toEqual(['costs.md:1']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the source checks see an install target and a string, and leave the mentions that stay alone', () => {
  it.each([
    ['the extension id in code', "const ID = 'aiclarity.scroogellm';"],
    ['the extension id in a comment, in another casing', '// install it from vscode:extension/AIClarity.ScroogeLLM'],
    ['a Marketplace address under another publisher', 'see https://marketplace.visualstudio.com/items?itemName=someone.scrooge-llm'],
    ['an Open VSX address', ' * https://open-vsx.org/extension/aiclarity/scroogellm'],
  ])('flags %s', (_name, line) => {
    expect(installTargetFindings('lib/example.ts', `${line}\n`).map(finding => finding.where)).toEqual(['lib/example.ts:1']);
  });

  it.each([
    ['a prompt whose wording lives in code', "void vscode.window.showInformationMessage('ScroogeLLM cuts your LLM costs.', 'Learn More');"],
    ['the name in a template with a substitution', 'const message = `Works alongside ${tools} and ScroogeLLM.`;'],
    ['a stored-state key', 'const DISMISSED = `minspec.scroogellmNudge.dismissed`;'],
    ['a read of the retired conformance setting', "const on = config.get<boolean>('conformance.enabled', false);"],
    ['a registration of the retired command', "vscode.commands.registerCommand('minspec.exportTraceability', run);"],
  ])('flags %s', (_name, line) => {
    expect(heldTextFindings('lib/example.ts', `${line}\n`).map(finding => finding.where)).toEqual(['lib/example.ts:1']);
  });

  it('reads every line of a bundled file that is not TypeScript', () => {
    const asset = '{\n  "tip": "Install ScroogeLLM next."\n}\n';
    expect(heldTextFindings('lib/tips.json', asset).map(finding => finding.where)).toEqual(['lib/tips.json:2']);
    expect(heldTextFindings('lib/tips.json', '{\n  "tip": "Spec before code."\n}\n')).toEqual([]);
  });

  // The kinds of mention SPEC-086 lists under "Mentions that are not upsell and stay".
  const mentionsThatStay = [
    '/**',
    ' * Owning product slug (e.g. `minspec` / `scroogellm`) from the `product:` field. The H1',
    ' * title carries a redundant `MinSpec - ` / `ScroogeLLM - ` prefix that the tree strips.',
    ' * External refs use the `@namespace` convention (e.g. `SPEC-100@scroogellm`).',
    ' */',
    "export const slug = (frontmatter: { product?: string }): string => frontmatter.product ?? 'minspec';",
    "// It was caught downstream by AIClarityAU/scroogellm's own skeptic voter (scrooge#82),",
    '// see https://github.com/AIClarityAU/scroogellm/pull/46.',
    '',
  ].join('\n');

  it('does not flag a comment that names the scroogellm repository or uses it as an example slug', () => {
    expect(installTargetFindings('lib/example.ts', mentionsThatStay)).toEqual([]);
    expect(heldTextFindings('lib/example.ts', mentionsThatStay)).toEqual([]);
  });

  it('that sample really does mention the product, so the two results above are not trivially empty', () => {
    expect(checkLines('lib/example.ts', mentionsThatStay, SURFACE_RULES).length).toBeGreaterThan(3);
    expect(stringLiterals('lib/example.ts', mentionsThatStay).map(literal => literal.text)).toEqual(['minspec']);
  });
});

describe('the pack check sees a missing half of the guard and a refusal that misleads', () => {
  const refusal = (text: string, exitCode = 1): string =>
    `node -e "console.error('${text}'); process.exit(${exitCode})"`;
  const HONEST = 'Blocked: ScroogeLLM is shelved as a product (scroogellm DR-021).';
  const guarded = (): Record<string, unknown> => ({
    name: '@aiclarity/minspec-pro',
    private: true,
    extensionPack: ['aiclarity.minspec', 'aiclarity.scroogellm'],
    scripts: { package: refusal(HONEST) },
  });

  it(
    'a pack with both halves and an honest refusal is clean',
    () => {
      expect(guardFindings('pack', guarded())).toEqual([]);
    },
    SLOW,
  );

  const breakages: Array<[string, (manifest: Record<string, unknown>) => void, string]> = [
    ['private set to false', m => { m.private = false; }, 'pack private'],
    ['private removed', m => { delete m.private; }, 'pack private'],
    ['a package script that exits zero', m => { m.scripts = { package: refusal(HONEST, 0) }; }, 'pack scripts/package'],
    [
      'a package script that prints the refusal and then succeeds',
      m => { m.scripts = { package: `node -e "console.error('${HONEST}')"` }; },
      'pack scripts/package',
    ],
    [
      'a refusal whose failure is swallowed',
      m => { m.scripts = { package: `${refusal(HONEST)} || true` }; },
      'pack scripts/package',
    ],
    ['a package script that packages', m => { m.scripts = { package: 'vsce package' }; }, 'pack scripts/package'],
    ['no package script at all', m => { m.scripts = {}; }, 'pack scripts/package'],
    [
      'a second script that could publish',
      m => { m.scripts = { package: refusal(HONEST), publish: 'vsce publish' }; },
      'pack scripts',
    ],
    [
      'the old refusal, which waits for the product to ship',
      m => {
        m.scripts = {
          package: refusal(
            'MinSpec Pro extension pack is blocked from packaging until ScroogeLLM ships. Remove this guard once aiclarity.scroogellm is live on both marketplaces.',
          ),
        };
      },
      'pack scripts/package',
    ],
    [
      'an honest refusal that still says when to lift the guard',
      m => { m.scripts = { package: refusal(`${HONEST} Remove the guard once it is published.`) }; },
      'pack scripts/package',
    ],
  ];

  it.each(breakages)(
    'flags %s',
    (_name, breakIt, where) => {
      const manifest = guarded();
      breakIt(manifest);
      expect(guardFindings('pack', manifest).map(finding => finding.where)).toContain(where);
    },
    SLOW,
  );

  it(
    'the old refusal is flagged for both of its faults, not just one',
    () => {
      const manifest = guarded();
      manifest.scripts = {
        package: refusal(
          'MinSpec Pro extension pack is blocked from packaging until ScroogeLLM ships. Remove this guard once aiclarity.scroogellm is live on both marketplaces.',
        ),
      };
      const said = guardFindings('pack', manifest).map(finding => finding.what);
      expect(said.some(what => what.startsWith('does not say that ScroogeLLM is shelved'))).toBe(true);
      expect(said.filter(what => what.startsWith('says when to lift the guard')).length).toBe(2);
    },
    SLOW,
  );
});
