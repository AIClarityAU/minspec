/**
 * T0 - SPEC-085 FR-9: the published network statements stay tied to the code.
 *
 * The README said "Three opt-in commands ... Nothing else in the extension contacts a
 * network" while the Backlog panel ran `gh` unprompted and six other modules reached the
 * network through the user's own tools (issue #2329). The claim survived because nothing
 * connected the sentence to the code: a changelog entry even recorded it as "accurate".
 *
 * WHAT THIS PINS
 *   1. One declared inventory, {@link NETWORK_FEATURES} plus {@link LOCAL_ONLY}, classifies
 *      EVERY module in `SPAWN_ALLOWLIST` (tests/invariants.test.ts) as either
 *      network-reaching or local-only, and every source file that loads `child_process`
 *      or `simple-git` as well. A module that can start a process and is not classified
 *      here fails; so does a classification for a module that can no longer start one.
 *      SPEC-085 calls that list `CHILD_PROCESS_ALLOWLIST`, its name when the spec was
 *      approved; #2473 renamed it when it taught the list about `simple-git`.
 *   2. Every network-reaching feature name appears in the README's "What MinSpec Does on
 *      Your Network" section, under the heading that matches how it is triggered, and is
 *      a real command title, setting or button in the code.
 *   3. The retired sentences are gone from every location that carried them: the README,
 *      the walkthrough page and the site, and the two places issue #2457 found after
 *      SPEC-085 shipped: the manifest (a setting description read in the Settings editor
 *      and on the listing) and the messages of the commands (the consent prompt for the
 *      AI pass said "the extension makes no network calls" while asking to run `claude`).
 *   4. The allowlist entry for `lib/backlog.ts` says it reaches the network and why that
 *      is allowed (SPEC-085 FR-10).
 *   5. The AI pass says what it sends in every place it is offered or described: the
 *      consent prompt, the setting that skips the prompt, the README, and the backfill
 *      offer, whose button starts the AI pass without the prompt (issue #2568). One
 *      sentence, held here once, so the four cannot drift apart (issue #2457).
 *
 * WHAT THIS CANNOT PROVE (SPEC-085 DQ-4). It is a text-presence check. It proves each
 * feature is NAMED in the right part of the section; it cannot prove the sentence around
 * the name is accurate, and "local-only" is checked only against a list of literal
 * network verbs passed as arguments. A human still reads the section at review.
 *
 * The same holds for 3 and 5. The retired phrases are looked for in the manifest and in the
 * string literals under `src/commands`, one string at a time, so a phrase split across two
 * literals is not seen. A message built in `src/lib` or `src/views` is not read (`src/lib`
 * holds the templates of files MinSpec writes into a project, where "no network calls
 * without consent" is a rule about that project and not a claim about MinSpec). And 5 pins
 * the words, not their truth: what the AI pass sends is decided by `buildPrompt` in
 * `lib/epic-backfill.ts`, which is not exported, so a change there needs the sentence
 * changed by hand.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { BOOTSTRAP_STEPS } from '../src/lib/auto-bootstrap';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');

const README = path.join(PACKAGE_ROOT, 'README.md');
const WALKTHROUGH = path.join(PACKAGE_ROOT, 'media', 'walkthrough', 'welcome.md');
const SITE = path.join(REPO_ROOT, 'sites', 'minspec.dev', 'index.html');
const INVARIANTS_TEST = path.join(PACKAGE_ROOT, 'tests', 'invariants.test.ts');
const MANIFEST = path.join(PACKAGE_ROOT, 'package.json');
const COMMANDS_DIR = path.join(SRC_ROOT, 'commands');
const BACKFILL_COMMAND = path.join(COMMANDS_DIR, 'backfill-epics.ts');

// ─── The inventory ──────────────────────────────────────────────────────────

/** How a network-reaching feature comes to run. Each maps to one README sub-heading. */
type Consent = 'unprompted' | 'gesture' | 'setting';

/** What kind of thing the feature name is, which decides where the name is verified. */
type FeatureKind = 'command' | 'setting' | 'button';

interface NetworkFeature {
  /** Module path relative to `packages/minspec/src`, exactly as the allowlist spells it. */
  readonly module: string;
  /** The user-facing name, written exactly as the README writes it. */
  readonly feature: string;
  readonly kind: FeatureKind;
  readonly consent: Consent;
  /** What starts the network action. Prose for the reader; the README carries its own wording. */
  readonly trigger: string;
}

const REFRESH_BACKLOG = 'MinSpec: Refresh Backlog (contacts GitHub through your gh CLI)';
const PARK = 'MinSpec: Park Topic';
const PARK_FORCE = 'MinSpec: Park Topic (force)';
const SCORE = 'MinSpec: Score Issue (WSJF)';
const TRIAGE = 'MinSpec: Quick Triage Inbox Issue';
const PUSH_DOCS = 'MinSpec: Push docs via lane';
const BACKFILL = 'MinSpec: Backfill Epics (AI-assisted)';
const INIT = 'MinSpec: Initialize SDD Structure';
const REFRESH_HARNESS = 'MinSpec: Refresh Harness Files';

/**
 * The single declared inventory of network-reaching modules (SPEC-085 FR-9).
 *
 * One row per (module, feature). A module that powers several features has several rows;
 * a feature that spans several modules appears once per module, so removing a module's
 * last row is what flags it as unclassified.
 */
const NETWORK_FEATURES: readonly NetworkFeature[] = [
  // lib/github.ts - `gh auth status`, the availability check three commands start with.
  { module: 'lib/github.ts', feature: PARK, kind: 'command', consent: 'gesture', trigger: 'first step of the command the user ran' },
  { module: 'lib/github.ts', feature: SCORE, kind: 'command', consent: 'gesture', trigger: 'first step of the command the user ran' },
  { module: 'lib/github.ts', feature: TRIAGE, kind: 'command', consent: 'gesture', trigger: 'first step of the command the user ran' },

  // lib/parking-lot.ts - `gh issue list --search`, `gh issue create`, `gh issue comment`.
  { module: 'lib/parking-lot.ts', feature: PARK, kind: 'command', consent: 'gesture', trigger: 'the user runs Park Topic' },
  { module: 'lib/parking-lot.ts', feature: PARK_FORCE, kind: 'command', consent: 'gesture', trigger: 'the user runs Park Topic (force)' },
  { module: 'lib/parking-lot.ts', feature: 'Park as Issue', kind: 'button', consent: 'gesture', trigger: 'the user clicks the button on a drift warning' },

  // lib/backlog.ts - `gh issue list`, and `gh issue view/edit/comment` from the two commands.
  { module: 'lib/backlog.ts', feature: REFRESH_BACKLOG, kind: 'command', consent: 'gesture', trigger: 'the user runs Refresh Backlog or selects the not-loaded row' },
  { module: 'lib/backlog.ts', feature: SCORE, kind: 'command', consent: 'gesture', trigger: 'the user runs the command; writes follow an Apply click' },
  { module: 'lib/backlog.ts', feature: TRIAGE, kind: 'command', consent: 'gesture', trigger: 'the user runs the command' },

  // lib/epic-backfill.ts - `claude -p`.
  { module: 'lib/epic-backfill.ts', feature: BACKFILL, kind: 'command', consent: 'gesture', trigger: 'the user chooses the AI pass when asked' },
  { module: 'lib/epic-backfill.ts', feature: 'minspec.autoBackfillUseAi', kind: 'setting', consent: 'setting', trigger: 'the setting is true and the user runs Backfill Epics' },

  // lib/approve-push.ts and lib/approval-recover.ts - `git push`, `git fetch`.
  { module: 'lib/approve-push.ts', feature: 'minspec.pushOnApprove', kind: 'setting', consent: 'setting', trigger: 'the user clicks Push on the prompt, or the setting is always' },
  { module: 'lib/approval-recover.ts', feature: 'minspec.pushOnApprove', kind: 'setting', consent: 'setting', trigger: 'same consent, when the approval was made on a protected branch' },

  // lib/approval-pr.ts - `gh pr list`, `gh pr create`, `gh label create`.
  { module: 'lib/approval-pr.ts', feature: 'minspec.approvalPr', kind: 'setting', consent: 'setting', trigger: 'follows a consented approval push when the setting is auto' },
  { module: 'lib/approval-pr.ts', feature: PUSH_DOCS, kind: 'command', consent: 'gesture', trigger: 'follows the docs-lane push the user confirmed' },

  // commands/push-docs-lane.ts - `gh auth status`, `git fetch`, `git push`.
  { module: 'commands/push-docs-lane.ts', feature: PUSH_DOCS, kind: 'command', consent: 'gesture', trigger: 'the user confirms the dialog that names the push' },

  // lib/ruleset-advisor.ts - `gh --version`, `gh auth status`, `gh api` GETs; POST/PUT behind a click.
  { module: 'lib/ruleset-advisor.ts', feature: INIT, kind: 'command', consent: 'unprompted', trigger: 'read-only probes after the user runs Initialize (DR-050)' },
  { module: 'lib/ruleset-advisor.ts', feature: REFRESH_HARNESS, kind: 'command', consent: 'unprompted', trigger: 'read-only probes after the user runs Refresh Harness Files (DR-050)' },
  { module: 'lib/ruleset-advisor.ts', feature: 'Create ruleset', kind: 'button', consent: 'gesture', trigger: 'the user clicks the button on the ruleset offer' },
  { module: 'lib/ruleset-advisor.ts', feature: 'Add checks', kind: 'button', consent: 'gesture', trigger: 'the user clicks the button on the ruleset offer' },
];

/**
 * Modules that start only local processes, with what they run.
 *
 * `commands/init.ts` starts `git` through the `simple-git` library and nothing else.
 * Its GitHub probes are a different matter - they run through `lib/ruleset-advisor.ts`,
 * which is classified above.
 */
const LOCAL_ONLY: Readonly<Record<string, string>> = {
  'lib/build-provenance.ts': 'git rev-parse, cat-file, merge-base, rev-list against the open workspace',
  'lib/git-analyzer.ts': 'local git diff, status and show through the simple-git library',
  'lib/approval.ts': 'git hash-object, update-ref, cat-file, log, show, config user.email',
  'lib/approve-commit.ts': 'git add and git commit of the approval, and local ref reads; never pushes',
  'lib/scaffold.ts': 'git ls-files, git rm --cached, git config --local core.hooksPath',
  'lib/presence.ts': 'git worktree list, branch --show-current, rev-parse --show-toplevel',
  'lib/tidy-primary.ts': 'git status, rev-parse, rev-list, cat-file, show, checkout -- <path>; never fetches',
  'commands/init.ts': 'git rev-parse, check-ignore, add, commit, checkout -b, status through simple-git; never pushes',
};

/** The README sub-heading each kind of consent is listed under. */
const HEADING_FOR: Readonly<Record<Consent, string>> = {
  unprompted: 'Runs without asking first',
  gesture: 'Runs only when you ask',
  setting: 'Runs when a setting allows it',
};

const NETWORK_SECTION_HEADING = 'What MinSpec Does on Your Network';

// ─── Readers ────────────────────────────────────────────────────────────────

const read = (file: string): string => fs.readFileSync(file, 'utf-8');

interface AllowlistEntry {
  readonly module: string;
  /** The comment written directly above the entry, as one line of prose. '' when there is none. */
  readonly comment: string;
}

/** The name of the spawn allowlist in tests/invariants.test.ts (`CHILD_PROCESS_ALLOWLIST` until #2473). */
const SPAWN_ALLOWLIST_NAME = 'SPAWN_ALLOWLIST';

/** The entries of the spawn allowlist, with their comments, read from the invariants test's AST. */
function spawnAllowlistEntries(): AllowlistEntry[] {
  const text = read(INVARIANTS_TEST);
  const sf = ts.createSourceFile(INVARIANTS_TEST, text, ts.ScriptTarget.ES2022, true);
  const entries: AllowlistEntry[] = [];
  let declarations = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === SPAWN_ALLOWLIST_NAME
    ) {
      declarations++;
      const init = node.initializer;
      const list = init && ts.isNewExpression(init) ? init.arguments?.[0] : undefined;
      if (list && ts.isArrayLiteralExpression(list)) {
        for (const element of list.elements) {
          if (!ts.isStringLiteralLike(element)) continue;
          const ranges = ts.getLeadingCommentRanges(text, element.getFullStart()) ?? [];
          entries.push({
            module: element.text,
            // Comment markers dropped and whitespace collapsed, so a phrase that wraps
            // across two `//` lines still reads as one phrase.
            comment: ranges
              .map(range => text.slice(range.pos, range.end).replace(/^\s*\/\/ ?/, ''))
              .join(' ')
              .replace(/\s+/g, ' '),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // One declaration, read in full: anything else means this reader no longer
  // understands the file, and an empty list would make every check below pass.
  if (declarations !== 1) {
    throw new Error(`expected exactly one ${SPAWN_ALLOWLIST_NAME} declaration, found ${declarations}`);
  }
  return entries;
}

const spawnAllowlist = (): string[] => spawnAllowlistEntries().map(entry => entry.module);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__benchmarks__') continue;
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const relSrc = (file: string): string => path.relative(SRC_ROOT, file).split(path.sep).join('/');

/** A `## heading` section of a markdown file, up to the next `## ` heading. '' when absent. */
function section(markdown: string, heading: string, level = 2): string {
  const marker = `${'#'.repeat(level)} ${heading}`;
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => line.trim() === marker);
  if (start === -1) return '';
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^(#+) /.exec(line);
    if (match && match[1].length <= level) break;
    body.push(line);
  }
  return body.join('\n');
}

/** Text as a reader sees it: tags and emphasis removed, whitespace collapsed, lower case. */
function visibleText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A string that is not markup (a manifest value, a string literal) as a reader sees it:
 * emphasis characters removed, whitespace collapsed, lower case. Unlike
 * {@link visibleText} it drops nothing between a `<` and a `>`: in a message an angle
 * bracket is a character, and treating it as a tag would hide whatever followed it.
 */
function plainText(raw: string): string {
  return raw.replace(/[*_`]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

const networkSection = (): string => section(read(README), NETWORK_SECTION_HEADING);

/** Every string value in a parsed JSON document, at any depth. Keys are not values. */
function jsonStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(jsonStrings);
  return [];
}

/**
 * The text of every string literal in a TypeScript source: quoted strings, and the literal
 * parts of template strings. Comments are not literals and are not returned, which is the
 * point: a comment cannot be shown to a user, a string can.
 */
function stringLiterals(sourceText: string, fileName = 'source.ts'): string[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text, ...node.templateSpans.map(span => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every string literal under `src/commands`, where the extension's prompts are worded. */
const commandMessages = (): string[] =>
  sourceFiles(COMMANDS_DIR).flatMap(file => stringLiterals(read(file), file));

// ─── 1. Every spawning module is classified ─────────────────────────────────

describe('every module that may start a process is classified (SPEC-085 FR-9)', () => {
  const allowlist = spawnAllowlist();
  const networkModules = [...new Set(NETWORK_FEATURES.map(row => row.module))].sort();
  const localModules = Object.keys(LOCAL_ONLY).sort();
  const classified = new Set([...networkModules, ...localModules]);

  /**
   * Source files that load a library able to start a process: `child_process`, or
   * `simple-git`, which starts `git` on the caller's behalf. Static import, `require`
   * and dynamic `import()` all count, with or without the `node:` prefix.
   */
  const SPAWN_LIBRARY = /(?:from\s+|require\(\s*|import\(\s*)['"](?:node:)?(?:child_process|simple-git)['"]/;
  const importers = sourceFiles(SRC_ROOT)
    .filter(file => SPAWN_LIBRARY.test(read(file)))
    .map(relSrc)
    .sort();

  it('reads the allowlist rather than an empty list', () => {
    // If the reader ever returned nothing, every "is classified" check would pass vacuously.
    expect(allowlist.length).toBeGreaterThanOrEqual(15);
    expect(allowlist).toContain('lib/backlog.ts');
    expect(allowlist).toContain('lib/tidy-primary.ts');
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });

  it('finds the modules that load a spawning library rather than an empty list', () => {
    expect(importers.length).toBeGreaterThanOrEqual(12);
    expect(importers).toContain('lib/backlog.ts');
    expect(importers).toContain('commands/init.ts');
  });

  it('every SPAWN_ALLOWLIST entry is classified as network-reaching or local-only', () => {
    const unclassified = allowlist.filter(entry => !classified.has(entry));
    expect(
      unclassified,
      'classify each of these in NETWORK_FEATURES (and name it in the README) or in LOCAL_ONLY',
    ).toEqual([]);
  });

  it('every source file that loads child_process or simple-git is classified', () => {
    // The allowlist is the declared inventory; this asks the same question of the code
    // itself, so a module cannot dodge classification by also dodging the allowlist.
    expect(
      importers.filter(file => !classified.has(file)),
      'classify each of these in NETWORK_FEATURES (and name it in the README) or in LOCAL_ONLY',
    ).toEqual([]);
  });

  it('nothing is classified that cannot start a process', () => {
    // A row left behind after its module stopped spawning would keep a feature in the
    // README that no longer exists.
    const spawners = new Set([...allowlist, ...importers]);
    expect([...classified].filter(module => !spawners.has(module))).toEqual([]);
  });

  it('every classified module exists', () => {
    expect([...classified].filter(module => !fs.existsSync(path.join(SRC_ROOT, module)))).toEqual([]);
  });

  it('no module is classified both ways', () => {
    expect(networkModules.filter(module => module in LOCAL_ONLY)).toEqual([]);
  });

  it('a module classified local-only passes no network verb as an argument', () => {
    // A literal-token check, and only that: it catches a quoted `push`, `fetch` or `gh`
    // argument being added to a module this file calls local, which is the edit that must
    // also move the module into NETWORK_FEATURES and into the README. It cannot see a
    // simple-git method call such as `git.push()`; the syntax-tree check in
    // invariants.test.ts (#2473) is what refuses those outside its consent list.
    const NETWORK_ARGUMENT = /['"](?:push|fetch|pull|clone|ls-remote|gh|claude|curl|wget)['"]/;
    const offenders = localModules.filter(module => NETWORK_ARGUMENT.test(read(path.join(SRC_ROOT, module))));
    expect(offenders).toEqual([]);
  });
});

// ─── 2. Every network-reaching feature is named in the README ───────────────

describe('the README network section names every network-reaching feature (SPEC-085 FR-8, FR-9)', () => {
  const manifest = JSON.parse(read(MANIFEST)) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      configuration: { properties: Record<string, unknown> };
    };
  };
  const commandTitles = new Set(manifest.contributes.commands.map(c => c.title));
  const settings = new Set(Object.keys(manifest.contributes.configuration.properties));

  it('the section exists', () => {
    expect(networkSection().trim().length).toBeGreaterThan(0);
  });

  it.each(NETWORK_FEATURES)('$module: "$feature" is named in the section', row => {
    expect(networkSection()).toContain(row.feature);
  });

  it.each(NETWORK_FEATURES)('$module: "$feature" is listed under the heading for $consent', row => {
    const subsection = section(networkSection(), HEADING_FOR[row.consent], 3);
    expect(subsection, `README sub-heading "### ${HEADING_FOR[row.consent]}" is missing`).not.toBe('');
    expect(subsection).toContain(row.feature);
  });

  it.each(NETWORK_FEATURES)('$module: "$feature" is a real $kind', row => {
    if (row.kind === 'command') {
      expect(commandTitles.has(row.feature)).toBe(true);
    } else if (row.kind === 'setting') {
      expect(settings.has(row.feature)).toBe(true);
    } else {
      const quoted = new RegExp(`['"\`]${row.feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
      const definedIn = sourceFiles(SRC_ROOT).filter(file => quoted.test(read(file)));
      expect(definedIn.length).toBeGreaterThan(0);
    }
  });

  it('nothing that waits for a gesture or a setting is listed as running without asking', () => {
    const unprompted = section(networkSection(), HEADING_FOR.unprompted, 3);
    const unpromptedNames = new Set(NETWORK_FEATURES.filter(r => r.consent === 'unprompted').map(r => r.feature));
    const misplaced = NETWORK_FEATURES.filter(
      row => row.consent !== 'unprompted' && !unpromptedNames.has(row.feature) && unprompted.includes(row.feature),
    ).map(row => row.feature);
    expect(misplaced).toEqual([]);
  });

  it('the two things that run without asking are both named: the gh check and the settings probes', () => {
    const unprompted = section(networkSection(), HEADING_FOR.unprompted, 3);
    expect(unprompted).toContain('gh auth status');
    expect(unprompted).toMatch(/rulesets/i);
    expect(unprompted).toMatch(/secrets/i);
  });

  it('keeps the claims that are true: no socket of its own, no telemetry, no account, no backend', () => {
    const text = visibleText(networkSection());
    expect(text).toMatch(/opens no network connection of its own/);
    expect(text).toContain('no telemetry');
    expect(text).toContain('no account');
    expect(text).toContain('no backend');
  });
});

// ─── 3. The retired sentences are gone from every location ──────────────────

describe('the retired network claims are gone from every location (SPEC-085 FR-8)', () => {
  // The last two were added for issue #2457. SPEC-085 listed the five places it knew of;
  // the same claim was also in a setting description and in the consent prompt for the AI
  // pass, and stayed there because this list did not reach them.
  // Each location is a list of texts, already as a reader sees them: one for a page, and
  // one per string for the manifest and the command messages, so that nothing in one
  // string can hide a phrase in another.
  const locations: ReadonlyArray<{ name: string; texts: () => string[] }> = [
    { name: 'README', texts: () => [visibleText(read(README))] },
    { name: 'walkthrough page', texts: () => [visibleText(read(WALKTHROUGH))] },
    { name: 'site', texts: () => [visibleText(read(SITE))] },
    { name: 'manifest', texts: () => jsonStrings(JSON.parse(read(MANIFEST))).map(plainText) },
    { name: 'command messages', texts: () => commandMessages().map(plainText) },
  ];

  // FR-8 retires the first two by name. The last two are the short claim the spec's
  // Context table lists as false (the walkthrough's "No network calls.") or misleading as
  // a lead (the README's "zero network calls"): true of sockets, and read as "nothing
  // contacts the network", which the same page then contradicts.
  const retired = [
    'three opt-in commands',
    'nothing else in the extension contacts a network',
    'zero network calls',
    'no network calls',
  ];

  describe.each(locations)('$name', location => {
    it('exists and is not empty', () => {
      expect(location.texts().join(' ').length).toBeGreaterThan(100);
    });

    it.each(retired)('does not say "%s"', phrase => {
      // Compared as a list, so a failure prints the text that carries the phrase.
      expect(location.texts().filter(text => text.includes(phrase))).toEqual([]);
    });
  });

  it('the two readers added for #2457 see what they are pointed at', () => {
    // A reader that returned nothing would pass every "does not say" above. Each is shown
    // a small input holding a retired phrase, and what it must not read.
    expect(jsonStrings({ a: { b: ['x', { c: 'the extension makes no network calls' }] }, d: 1 })).toEqual([
      'x',
      'the extension makes no network calls',
    ]);
    const source = [
      '// a comment may say no network calls',
      'const quoted = "makes no network calls";',
      'const templated = `zero network calls for ${quoted} here`;',
    ].join('\n');
    expect(stringLiterals(source)).toEqual(['makes no network calls', 'zero network calls for ', ' here']);

    // An angle bracket in a message is a character and not a tag: nothing after it is lost.
    const bracketed = 'if a < b the extension makes no network calls, when b > c';
    expect(plainText(bracketed)).toContain('no network calls');
    expect(visibleText(bracketed)).not.toContain('no network calls');

    // And on the real tree: both find the text they exist to read.
    expect(jsonStrings(JSON.parse(read(MANIFEST))).some(text => text.includes('AI pass'))).toBe(true);
    expect(commandMessages().some(text => text.includes('Use AI to propose the epic taxonomy'))).toBe(true);
  });

  it('the README FAQ answer and Privacy section point at the network section', () => {
    const readme = read(README);
    const anchor = '#what-minspec-does-on-your-network';
    const faq = section(readme, 'Does MinSpec make network calls or require an account?', 3);
    const privacy = section(readme, 'Privacy');

    expect(faq).toContain(anchor);
    expect(privacy).toContain(anchor);
  });

  it('the walkthrough page and the site card point at the same section', () => {
    const anchor = 'README.md#what-minspec-does-on-your-network';
    expect(read(WALKTHROUGH)).toContain(anchor);
    expect(read(SITE)).toContain(anchor);
  });

  it('the README heading the anchor points at still exists', () => {
    // Renaming the heading would silently break every link above.
    expect(read(README).split('\n')).toContain(`## ${NETWORK_SECTION_HEADING}`);
  });
});

// ─── 4. The allowlist says why the Backlog entry is allowed ─────────────────

describe('the lib/backlog.ts allowlist entry carries a consent-clause comment (SPEC-085 FR-10)', () => {
  const entries = spawnAllowlistEntries();
  const backlog = entries.filter(entry => entry.module === 'lib/backlog.ts');

  it('is listed exactly once', () => {
    expect(backlog).toHaveLength(1);
  });

  it('says the module reaches the network, on the consent clause, and only from a gesture', () => {
    const comment = backlog[0]?.comment ?? '';
    expect(comment).toMatch(/SPEC-085/);
    expect(comment).toMatch(/reach(?:es)? the network/i);
    expect(comment).toMatch(/CONSENT clause/);
    expect(comment).toMatch(/gesture/i);
  });

  it('reads comments at all: the entries the spec cites as the model form carry theirs', () => {
    // Guards the reader, not the wording. If leading comments stopped being found, the
    // assertion above would fail for the wrong reason and this one says which.
    const withConsentClause = entries.filter(entry => /CONSENT clause/.test(entry.comment)).map(entry => entry.module);
    expect(withConsentClause).toContain('lib/approve-push.ts');
  });
});

// ─── 5. The AI pass says what it sends, wherever it is offered ──────────────

describe('the AI pass names what it sends in the prompt, the setting, the README and the offer (#2457, #2568)', () => {
  /**
   * What the AI pass hands to the user's `claude` command, as `buildPrompt` in
   * `lib/epic-backfill.ts` assembles it: the id and title of every spec, decision and epic,
   * and the first paragraph of each spec or decision that has no epic. Written the way a
   * reader sees it (lower case, no markup), because that is how it is compared.
   */
  const AI_PASS_SENDS =
    'sends the ids and titles of your specs, decisions and epics, and the first paragraph of each spec or decision that has no epic yet, to the model provider';

  const consentPrompts = (): string[] =>
    stringLiterals(read(BACKFILL_COMMAND), BACKFILL_COMMAND).filter(text =>
      text.includes('Use AI to propose the epic taxonomy'),
    );

  const settingDescription = (): string => {
    const manifest = JSON.parse(read(MANIFEST)) as {
      contributes: { configuration: { properties: Record<string, { description?: string }> } };
    };
    return manifest.contributes.configuration.properties['minspec.autoBackfillUseAi']?.description ?? '';
  };

  it('there is one consent prompt for the AI pass', () => {
    // The checks below are about this string. If it is reworded past recognition or split
    // in two, this fails first and says so.
    expect(consentPrompts()).toHaveLength(1);
  });

  it('the consent prompt says what is sent, and that your own claude command sends it', () => {
    const prompt = plainText(consentPrompts()[0] ?? '');
    expect(prompt).toContain('your own claude command');
    expect(prompt).toContain(AI_PASS_SENDS);
  });

  it('the setting that skips the prompt says the same', () => {
    const description = plainText(settingDescription());
    expect(description).toContain("your own 'claude' command");
    expect(description).toContain(AI_PASS_SENDS);
  });

  it('the README network section says the same', () => {
    expect(visibleText(networkSection())).toContain(AI_PASS_SENDS);
  });

  /**
   * The setup offers that hand AI consent to their command (#2568). Such an offer passes
   * `{ aiConsent: true }`, and the command then skips the consent prompt above (#213), so
   * the offer's own text is the only thing the user reads before `claude` runs. These are
   * the real step objects the bootstrap runner shows, not a copy of their text.
   */
  const offersThatGrantAiConsent = BOOTSTRAP_STEPS.filter(
    step => (step.commandArg as { aiConsent?: unknown } | undefined)?.aiConsent === true,
  );

  it('exactly one setup offer hands AI consent to its command: the epic backfill offer', () => {
    // Guards the selector. If no step carried the flag, the check below would pass on nothing.
    expect(offersThatGrantAiConsent.map(step => `${step.kind}:${step.commandId}`)).toEqual([
      'backfill:minspec.backfillEpics',
    ]);
  });

  it('an offer that hands AI consent says what is sent before its button is pressed', () => {
    for (const step of offersThatGrantAiConsent) {
      const message = plainText(step.message);
      // The AI pass runs only when `claude` is there; the offer must not promise it otherwise.
      expect(message).toContain('if claude code is installed');
      // It names the button that gives the consent, and then the same sentence as the prompt.
      expect(message).toContain(`${step.primaryAction.toLowerCase()} then runs your own claude command`);
      expect(message).toContain(AI_PASS_SENDS);
    }
  });
});
