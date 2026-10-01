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
 *      EVERY module in `CHILD_PROCESS_ALLOWLIST` (tests/invariants.test.ts) as either
 *      network-reaching or local-only. A module added to the allowlist without being
 *      classified here fails; so does a classification for a module that is no longer
 *      allowlisted.
 *   2. Every network-reaching feature name appears in the README's "What MinSpec Does on
 *      Your Network" section, under the heading that matches how it is triggered, and is
 *      a real command title, setting or button in the code.
 *   3. The retired sentences are gone from every location that carried them: the README,
 *      the walkthrough page and the site.
 *
 * WHAT THIS CANNOT PROVE (SPEC-085 DQ-4). It is a text-presence check. It proves each
 * feature is NAMED in the right part of the section; it cannot prove the sentence around
 * the name is accurate, and "local-only" is checked only against a list of literal
 * network verbs. A human still reads the section at review.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');

const README = path.join(PACKAGE_ROOT, 'README.md');
const WALKTHROUGH = path.join(PACKAGE_ROOT, 'media', 'walkthrough', 'welcome.md');
const SITE = path.join(REPO_ROOT, 'sites', 'minspec.dev', 'index.html');
const INVARIANTS_TEST = path.join(PACKAGE_ROOT, 'tests', 'invariants.test.ts');
const MANIFEST = path.join(PACKAGE_ROOT, 'package.json');

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

/** Allowlisted modules that start only local processes, with what they run. */
const LOCAL_ONLY: Readonly<Record<string, string>> = {
  'lib/build-provenance.ts': 'git rev-parse, cat-file, merge-base, rev-list against the open workspace',
  'lib/git-analyzer.ts': 'local git diff and status through the simple-git library',
  'lib/approval.ts': 'git hash-object, update-ref, cat-file, log, show, config user.email',
  'lib/approve-commit.ts': 'git add and git commit of the approval, and local ref reads; never pushes',
  'lib/scaffold.ts': 'git ls-files, git rm --cached, git config --local core.hooksPath',
  'lib/presence.ts': 'git worktree list, branch --show-current, rev-parse --show-toplevel',
  'lib/tidy-primary.ts': 'git status, rev-parse, rev-list, cat-file, show, checkout -- <path>; never fetches',
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

/** The entries of `CHILD_PROCESS_ALLOWLIST`, read from the invariants test's AST. */
function childProcessAllowlist(): string[] {
  const sf = ts.createSourceFile(INVARIANTS_TEST, read(INVARIANTS_TEST), ts.ScriptTarget.ES2022, true);
  const entries: string[] = [];
  let declarations = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'CHILD_PROCESS_ALLOWLIST'
    ) {
      declarations++;
      const init = node.initializer;
      const list = init && ts.isNewExpression(init) ? init.arguments?.[0] : undefined;
      if (list && ts.isArrayLiteralExpression(list)) {
        for (const element of list.elements) {
          if (ts.isStringLiteralLike(element)) entries.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // One declaration, read in full: anything else means this reader no longer
  // understands the file, and an empty list would make every check below pass.
  if (declarations !== 1) {
    throw new Error(`expected exactly one CHILD_PROCESS_ALLOWLIST declaration, found ${declarations}`);
  }
  return entries;
}

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

const networkSection = (): string => section(read(README), NETWORK_SECTION_HEADING);

// ─── 1. Every spawning module is classified ─────────────────────────────────

describe('every module that may start a process is classified (SPEC-085 FR-9)', () => {
  const allowlist = childProcessAllowlist();
  const networkModules = [...new Set(NETWORK_FEATURES.map(row => row.module))].sort();
  const localModules = Object.keys(LOCAL_ONLY).sort();

  it('reads the allowlist rather than an empty list', () => {
    // If the reader ever returned nothing, every "is classified" check would pass vacuously.
    expect(allowlist.length).toBeGreaterThanOrEqual(15);
    expect(allowlist).toContain('lib/backlog.ts');
    expect(allowlist).toContain('lib/tidy-primary.ts');
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });

  it('every CHILD_PROCESS_ALLOWLIST entry is classified as network-reaching or local-only', () => {
    const classified = new Set([...networkModules, ...localModules]);
    const unclassified = allowlist.filter(entry => !classified.has(entry));
    expect(
      unclassified,
      'classify each of these in NETWORK_FEATURES (and name it in the README) or in LOCAL_ONLY',
    ).toEqual([]);
  });

  it('no classification outlives its allowlist entry', () => {
    const allowed = new Set(allowlist);
    expect([...networkModules, ...localModules].filter(module => !allowed.has(module))).toEqual([]);
  });

  it('no module is classified both ways', () => {
    expect(networkModules.filter(module => module in LOCAL_ONLY)).toEqual([]);
  });

  it('every source file that imports child_process is classified', () => {
    // The allowlist is the declared inventory; this is the same question asked of the
    // code itself, so a module cannot dodge classification by also dodging the allowlist.
    const importers = sourceFiles(SRC_ROOT)
      .filter(file => /(?:from\s+|require\(\s*|import\(\s*)['"](?:node:)?child_process['"]/.test(read(file)))
      .map(relSrc);
    const classified = new Set([...networkModules, ...localModules]);

    expect(importers.length).toBeGreaterThanOrEqual(10);
    expect(importers.filter(file => !classified.has(file))).toEqual([]);
  });

  it('a module classified local-only names no network verb', () => {
    // A literal-token check, and only that: it catches `git push` or a `gh` call being
    // added to a module this file calls local, which is the edit that must also move the
    // module into NETWORK_FEATURES and into the README.
    const NETWORK_TOKENS = /['"`](?:push|fetch|pull|clone|ls-remote|gh|claude|curl|wget)['"`]/;
    const offenders = localModules.filter(module => NETWORK_TOKENS.test(read(path.join(SRC_ROOT, module))));
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
  const locations = [
    { name: 'README', file: README },
    { name: 'walkthrough page', file: WALKTHROUGH },
    { name: 'site', file: SITE },
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
      expect(visibleText(read(location.file)).length).toBeGreaterThan(100);
    });

    it.each(retired)('does not say "%s"', phrase => {
      expect(visibleText(read(location.file))).not.toContain(phrase);
    });
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
