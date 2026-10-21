/**
 * SPEC-095 (CRLF files read the same as LF and are written back as found), FR-9: the
 * behaviour test. This file holds Slice 1 (a default Git for Windows checkout works).
 *
 * WHAT IT PINS. Every function the four Context tables of what goes wrong name (readers that
 * return a wrong answer, writers that damage a file, writers that refuse, writers that
 * succeed and leave something other than the CRLF form of their LF result) is run against
 * every row of ONE table of variants: the same content written CRLF, and written with mixed
 * CRLF and LF endings. `VARIANTS` is the single extension point; Slice 2 adds the lone-CR row
 * and the two byte-order-mark rows to it, and every listed function then meets them by name.
 *
 * WHAT IS ASSERTED is computed from the LF run and from the kind of file written (FR-5),
 * never written out per function:
 *   - a reader's result equals its LF result;
 *   - for a variant with one ending, each document a writer leaves, or the text it returns,
 *     is the LF run's converted to that ending; a new file, re-serialized JSON and a file
 *     MinSpec's own `.gitattributes` block pins to LF equal the LF run's bytes;
 *   - for the mixed variant: the writer does not throw where the LF run does not; its output
 *     equals the LF output once endings are normalized; a line whose text stands exactly once
 *     in the input and once in the output keeps its ending; a line whose text is not in the
 *     input ends in the file's ending (FR-4); and a document the LF run left unchanged comes
 *     back byte for byte.
 * Every file a writer does not declare as an output must come back untouched, in both runs.
 *
 * NO ROW PASSES BY FINDING NOTHING. Each row carries a control: a reader's LF result differs
 * from its result on a fixture with the parsed content removed, and a writer's LF run changes
 * its primary file.
 *
 * THE ORACLE IS INDEPENDENT of the helper under test. The variant writer, the line splitter,
 * the majority count and the CRLF conversion below are this file's own, so a defect in
 * `text-io.ts` cannot make its own expectation. The helper is loaded only by its own T1 tests,
 * through a dynamic import, so this file still runs row by row on code that has no helper.
 *
 * A case that needs `git` fails when git is missing, naming it (`requireTool`). It never
 * returns early and never skips (FR-9).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// The end-to-end case clones and refreshes real repositories, and the FR-8 case runs the
// Python twin over every spec: neither fits vitest's 5s default under load (#1285).
useShellTimeout();

// The spec panel's checkbox write is one of the writers in the tables, and the panel is the
// only module here that talks to the editor. This is the smallest editor surface it uses.
const panelHooks = vi.hoisted(() => ({
  onMessage: undefined as undefined | ((message: unknown) => void),
  errors: [] as string[],
}));
vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  workspace: { getWorkspaceFolder: () => undefined, workspaceFolders: undefined },
  window: {
    createWebviewPanel: () => ({
      title: '',
      webview: {
        html: '',
        onDidReceiveMessage: (cb: (message: unknown) => void) => {
          panelHooks.onMessage = cb;
          return { dispose: () => undefined };
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
      reveal: () => undefined,
      dispose: () => undefined,
    }),
    showErrorMessage: (message: string) => {
      panelHooks.errors.push(message);
      return Promise.resolve(undefined);
    },
  },
}));

import { resolveNextTask, specHash } from '@aiclarity/shared';
import {
  adrHasFrontmatter,
  createAdr,
  detectDoubledFrontmatter,
  extractExistingSummary,
  listAdrs,
  mergeDrIndex,
  regenerateDrIndex,
  setAdrStatus,
  validateDrAmendments,
  validateDrIndexStatus,
} from '../src/lib/adr-manager';
import {
  createEpic,
  listEpics,
  mergeEpicIndex,
  readArtifactEpic,
  setArtifactEpic,
  setEpicOrder,
  setEpicStatus,
  writeEpicIndex,
} from '../src/lib/epic-manager';
import { buildArtifactGraph } from '../src/lib/artifact-graph';
import { checkStatusParity, inspectAllStatusClaims } from '../src/lib/status-parity';
import { hashSection, mergeFile, parseSections, sectionHashesFromMarkdown } from '../src/lib/merge-refresh';
import { parseConstitution } from '../src/lib/constitution';
import { compactConstitution } from '../src/lib/constitution-compaction';
import { integrateProposal, type Proposal } from '../src/lib/constitution-proposer';
import {
  buildTasksMdContent,
  checkManagedRegionMarkers,
  ensureGitattributesEntries,
  ensureGitignoreEntries,
  findSpecDirsMissingTasksMd,
  generateHarnessFiles,
  isLfPinnedPath,
  refreshHarnessFiles,
  scaffoldTasksMd,
} from '../src/lib/scaffold';
import { applyBackfill, collectArtifacts, type BackfillProposal } from '../src/lib/epic-backfill';
import { advanceSpecToImplementing, setSpecPhases, setSpecStatus } from '../src/lib/spec';
import { createSpec, migrateLayout, transitionPhase } from '../src/lib/spec-manager';
import { buildLegacyBareClaudeShim, injectAgentsSlashSection } from '../src/lib/slash-commands';
import { injectContext, removeContext, type ActiveSpecContext } from '../src/lib/context-injector';
import { appendToParkingLotFile } from '../src/lib/parking-lot';
import { approveSpec, getApprovalStatus } from '../src/lib/approval';
import { detectTools } from '../src/lib/tool-detector';
import {
  MANAGED_REGION_TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_OUTPUT_PATHS,
  legacyClaudeShimOutputPath,
  managedRegionEndMarker,
  managedRegionStartMarker,
} from '../src/lib/template-registry';
import { SpecPanel } from '../src/views/spec-panel';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ─── The oracle ─────────────────────────────────────────────────────────────

type Eol = '\r\n' | '\n' | '\r';

/** A named way of writing the same content to disk. */
interface Variant {
  readonly name: string;
  /** Present when every line ends the same way: the expected output is the LF run's in it. */
  readonly single?: Eol;
  readonly write: (lf: string) => string;
}

/**
 * THE table of variants (FR-9). Slice 2 adds `lone CR` and the two byte-order-mark rows here,
 * and nowhere else.
 */
const VARIANTS: readonly Variant[] = [
  { name: 'CRLF', single: '\r\n', write: (lf) => lf.replace(/\n/g, '\r\n') },
  {
    // Alternating, starting CRLF: the first line of every fixture (a `---` fence, a heading)
    // is the CRLF one, and both endings occur throughout the file.
    name: 'mixed CRLF and LF',
    write: (lf) => {
      let i = 0;
      return lf.replace(/\n/g, () => (i++ % 2 === 0 ? '\r\n' : '\n'));
    },
  },
];

const asIs = (s: string): string => s;
const normalize = (s: string): string => s.replace(/\r\n?/g, '\n');
const convert = (lf: string, eol: Eol): string => lf.replace(/\n/g, eol);

interface Line {
  readonly text: string;
  readonly eol: string;
}

/** Every line with its terminator; the last may have none. */
function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '\r' && c !== '\n') continue;
    const eol = c === '\r' && text[i + 1] === '\n' ? '\r\n' : c;
    out.push({ text: text.slice(start, i), eol });
    i += eol.length - 1;
    start = i + 1;
  }
  if (start < text.length) out.push({ text: text.slice(start), eol: '' });
  return out;
}

/** The ending most lines end in; a tie, or no terminator at all, is LF (FR-4). */
function majorityOf(lines: readonly Line[]): Eol {
  const count: Record<Eol, number> = { '\r\n': 0, '\n': 0, '\r': 0 };
  for (const l of lines) if (l.eol) count[l.eol as Eol]++;
  const top = Math.max(count['\r\n'], count['\n'], count['\r']);
  const winners = (Object.keys(count) as Eol[]).filter((k) => count[k] === top);
  return top === 0 || winners.length > 1 ? '\n' : winners[0];
}

function tally(lines: readonly Line[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.text, (m.get(l.text) ?? 0) + 1);
  return m;
}

/**
 * FR-4 on a file with mixed endings, as FR-9 states it. `inputs` is the document (or, for a
 * layout migration, the documents) the output was written from, as they were on disk.
 */
function expectMixedRestore(inputs: readonly string[], output: string, lfOutput: string, label: string): void {
  expect(normalize(output), `${label}: the output differs from the LF run once endings are normalized`).toBe(lfOutput);
  const inLines = inputs.flatMap(linesOf);
  if (inputs.length === 1 && lfOutput === normalize(inputs[0])) {
    expect(output, `${label}: the LF run left this document unchanged, so it must come back byte for byte`).toBe(inputs[0]);
    return;
  }
  const fileEol = majorityOf(inLines);
  const inCount = tally(inLines);
  const outLines = linesOf(output);
  const outCount = tally(outLines);
  outLines.forEach((line, i) => {
    if (line.eol === '') return;
    const seen = inCount.get(line.text) ?? 0;
    if (seen === 0) {
      expect(line.eol, `${label}: line ${i + 1} ${JSON.stringify(line.text)} is new, so it takes the file's ending`).toBe(fileEol);
    } else if (seen === 1 && outCount.get(line.text) === 1) {
      const source = inLines.find((l) => l.text === line.text)!;
      if (source.eol !== '') {
        expect(line.eol, `${label}: line ${i + 1} ${JSON.stringify(line.text)} was not changed, so it keeps its ending`).toBe(source.eol);
      }
    }
  });
}

function expectRestored(inputs: readonly string[], output: string, lfOutput: string, variant: Variant, label: string): void {
  if (variant.single) {
    expect(output, `${label}: expected the ${variant.name} form of the LF run's output`).toBe(convert(lfOutput, variant.single));
  } else {
    expectMixedRestore(inputs, output, lfOutput, label);
  }
}

// ─── Fixture plumbing ───────────────────────────────────────────────────────

type Files = Record<string, string>;

function readTree(root: string): Files {
  const out: Files = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(root);
  return out;
}

/** Recreate `root` holding exactly `files`, each written through `form`. */
function writeTree(root: string, files: Files, form: (lf: string) => string): void {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, lf] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, form(lf));
  }
}

function pick(files: Files, prefixes: readonly string[]): Files {
  const out: Files = {};
  for (const [rel, content] of Object.entries(files)) {
    if (prefixes.some((p) => rel === p || rel.startsWith(p))) out[rel] = content;
  }
  return out;
}

function edit(files: Files, rel: string, change: (content: string) => string): Files {
  const before = files[rel];
  if (before === undefined) throw new Error(`fixture has no ${rel}`);
  const after = change(before);
  if (after === before) throw new Error(`fixture edit to ${rel} changed nothing`);
  return { ...files, [rel]: after };
}

/** Remove a leading `---` frontmatter block: the parsed content a frontmatter reader needs. */
const stripFrontmatter = (s: string): string => s.replace(/^---\n[\s\S]*?\n---\n?/, '');

function stripAllFrontmatter(files: Files, under: string): Files {
  const out: Files = {};
  for (const [rel, content] of Object.entries(files)) {
    out[rel] = rel.startsWith(under) && rel.endsWith('.md') && !rel.endsWith('INDEX.md') ? stripFrontmatter(content) : content;
  }
  return out;
}

type Outcome<T> = { readonly value: T } | { readonly error: string };

function capture<T>(fn: () => T): Outcome<T> {
  try {
    return { value: fn() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete env[key];
  return env;
}

/** FR-9: a case that needs a tool fails, naming it, when the tool is missing. */
function requireTool(tool: string): void {
  const probe = spawnSync(tool, ['--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    throw new Error(`${tool} is required by this SPEC-095 case and was not found on PATH (FR-9: it fails, it does not skip)`);
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}

let SCRATCH = '';
let rowSeq = 0;
function rowRoot(name: string): string {
  return path.join(SCRATCH, `${String(++rowSeq).padStart(3, '0')}-${name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}`);
}

// ─── Fixtures from the real generators, and hand-written ones where none reaches ──

const DECISIONS = 'docs/decisions/';
const EPICS = 'docs/epics/';
const DR_INDEX = 'docs/decisions/INDEX.md';
const EPIC_INDEX = 'docs/epics/INDEX.md';

// The generators name these files deterministically; `buildGeneratedProject` fails if they
// ever name them differently, so a row can never point at a file that is not there.
const DR1 = 'docs/decisions/DR-001-use-postgres-for-storage.md';
const DR2 = 'docs/decisions/DR-002-adopt-a-monorepo-layout.md';
const EPIC1 = 'docs/epics/EPIC-001-telemetry.md';

let GEN: Files = {};
let PINNED_CACHE: ReadonlySet<string> | undefined;

/**
 * A project built by the extension's own writers: Initialize, two decision records and an
 * epic, both decisions accepted and the epic active, both INDEX files regenerated, then
 * Refresh until the harness is settled (a further Refresh changes nothing).
 */
function buildGeneratedProject(): Files {
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'spec095-gen-'));
  try {
    generateHarnessFiles(g);
    const dr1 = createAdr(g, 'Use Postgres for storage');
    const dr2 = createAdr(g, 'Adopt a monorepo layout');
    // A generated record holds only placeholder comments under `## Context`; DR-001 gets a
    // sentence so its INDEX entry carries a real summary for `extractExistingSummary`.
    fs.writeFileSync(
      dr1.filePath,
      fs
        .readFileSync(dr1.filePath, 'utf-8')
        .replace(
          "<!-- What is the issue that we're seeing that is motivating this decision? -->",
          'Orders, carts and customers need one transactional store that survives restarts and serves reporting queries without a second copy of the data.',
        ),
    );
    const epic = createEpic(g, 'Telemetry', undefined, undefined, 'Measure what the product does in the field.');
    setArtifactEpic(dr1.filePath, epic.id, epic.title);
    setAdrStatus(dr1.filePath, 'accepted');
    setAdrStatus(dr2.filePath, 'accepted');
    setEpicStatus(epic.filePath, 'active');
    regenerateDrIndex(g);
    writeEpicIndex(g);
    // Two Refreshes, not one: the first seeds a constitution DRAFT after its merge has
    // already rendered `.cursorrules`, which then catches up on the second. The settled-project
    // case below asserts that a further Refresh changes nothing.
    refreshHarnessFiles(g);
    refreshHarnessFiles(g);
    const named = [dr1.filePath, dr2.filePath, epic.filePath].map((p) => path.relative(g, p).split(path.sep).join('/'));
    expect(named, 'the generators named their files differently from the constants this test uses').toEqual([DR1, DR2, EPIC1]);
    return readTree(g);
  } finally {
    fs.rmSync(g, { recursive: true, force: true });
  }
}

/** The managed files git reports as `eol: lf` on a scaffolded project (the oracle for FR-5(c)). */
function gitPinnedPaths(): ReadonlySet<string> {
  if (PINNED_CACHE) return PINNED_CACHE;
  requireTool('git');
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'spec095-attr-'));
  try {
    git(g, 'init', '-q');
    generateHarnessFiles(g);
    const candidates = [
      ...MANAGED_REGION_TEMPLATES.map((t) => t.outputPath),
      ...TEMPLATE_NAMES.map((n) => TEMPLATE_OUTPUT_PATHS[n]),
    ];
    const report = git(g, 'check-attr', 'eol', '--', ...candidates);
    const pinned = new Set<string>();
    for (const line of report.split('\n')) {
      const m = line.match(/^(.*): eol: lf$/);
      if (m) pinned.add(m[1]);
    }
    PINNED_CACHE = pinned;
    return pinned;
  } finally {
    fs.rmSync(g, { recursive: true, force: true });
  }
}

const SPEC_FLAT = 'specs/SPEC-010-checkout.md';
const SPEC_FLAT_TEXT = [
  '---',
  'id: SPEC-010',
  'title: Checkout flow',
  'tier: T2',
  'status: specifying',
  'created: 2026-09-01',
  'epic: EPIC-001  # Telemetry',
  'product: shop',
  'phases:',
  '  specify: in-progress',
  '  clarify: pending',
  '  plan: pending',
  '  tasks: pending',
  '  implement: pending',
  '---',
  '',
  '# SPEC-010: Checkout flow',
  '',
  '**Status:** Specifying - the cart and the payment step.',
  '',
  '## Specify',
  '',
  'Customers pay for the cart in one step.',
  '',
  '- [ ] Describe the cart',
  '- [x] Describe the payment step',
  '',
  '## Plan',
  '',
  'To be written.',
  '',
  '## Tasks',
  '',
  '- [ ] Build the cart',
  '- [ ] Build the payment step',
  '',
  '## Notes',
  '',
  'A section the writer has no reason to touch.',
  '',
].join('\n');

const SPEC_KIT_FILES: Files = {
  '.minspec/config.json': '{\n  "specsLayout": "spec-kit"\n}\n',
  'specs/010-checkout/spec.md': [
    '---',
    'id: SPEC-010',
    'title: Checkout flow',
    'tier: T2',
    'status: specifying',
    'created: 2026-09-01',
    'phases:',
    '  specify: in-progress',
    '  clarify: pending',
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
    '',
    '# SPEC-010: Checkout flow',
    '',
    '## Specify',
    '',
    'Customers pay for the cart in one step.',
    '',
    '## Clarify',
    '',
    'Which payment providers?',
    '',
  ].join('\n'),
  'specs/010-checkout/plan.md': ['## Plan', '', 'Two screens, one form.', ''].join('\n'),
  'specs/010-checkout/tasks.md': [
    '## Tasks',
    '',
    '- [ ] Build the cart',
    '- [ ] Build the payment step',
    '',
    '## Implement',
    '',
    'Not started.',
    '',
  ].join('\n'),
};

const REQUIREMENTS_REL = 'specs/shop/SPEC-020-search/requirements.md';
const REQUIREMENTS_TEXT = [
  '---',
  'id: SPEC-020',
  'type: requirements',
  'title: Search',
  'tier: T3',
  'status: planning',
  'product: shop',
  'epic: EPIC-001  # Telemetry',
  'phases:',
  '  specify: done',
  '  clarify: done',
  '  plan: in-progress',
  '  tasks: pending',
  '  implement: pending',
  '---',
  '',
  '# SPEC-020: Search',
  '',
  'Customers find a product by name.',
  '',
].join('\n');

/** A spec filed directly under its product's folder: the `product:` read decides its group. */
const PRODUCT_SPEC_REL = 'specs/shop/SPEC-022-cart.md';
const PRODUCT_SPEC_TEXT = [
  '---',
  'id: SPEC-022',
  'title: Cart',
  'tier: T2',
  'status: new',
  'product: shop',
  'created: 2026-09-01',
  '---',
  '',
  '# SPEC-022: Cart',
  '',
  'The cart holds what a customer intends to buy.',
  '',
].join('\n');

/** A decision whose status claim is a head callout and nothing else. */
const CALLOUT_DR = [
  '---',
  'id: DR-007',
  'title: Split the scope',
  'status: accepted',
  'date: 2026-08-01',
  '---',
  '',
  '# DR-007: Split the scope',
  '',
  '> **Status: proposed - scope-split by DR-024.**',
  '',
  '## Context',
  '',
  'Two concerns were bundled together.',
  '',
].join('\n');

const AMENDMENT_FILES: Files = {
  'docs/decisions/DR-002-old-storage.md': [
    '---',
    'id: DR-002',
    'title: Old storage',
    'status: accepted',
    'date: 2026-07-01',
    '---',
    '',
    '# DR-002: Old storage',
    '',
    '## Context',
    '',
    'Files on disk.',
    '',
  ].join('\n'),
  'docs/decisions/DR-003-new-storage.md': [
    '---',
    'id: DR-003',
    'title: New storage',
    'status: accepted',
    'date: 2026-08-01',
    'supersedes: [DR-002]',
    '---',
    '',
    '# DR-003: New storage',
    '',
    '## Context',
    '',
    'A database.',
    '',
  ].join('\n'),
};

const CONSTITUTION_RULES = [
  '# Shop - Constitution',
  '',
  '## Invariants',
  '',
  '1. Core functionality works offline.',
  '2. No silent gate - a check fails visibly,',
  '   never best-effort.',
  '',
  '## Principles',
  '',
  '- Ceremony proportional to scope.',
  '',
  '## Constraints',
  '',
  '- Node 22 only.',
  '',
].join('\n');

const CONSTITUTION_DRAFTS = [
  '# Shop - Constitution',
  '',
  '## Principles',
  '',
  '- DRAFT: Honor CLAUDE.md project instructions.',
  '  > _proposed because a CLAUDE.md instructions file is present_',
  '',
  '## Goals',
  '',
  '- DRAFT: Trace specs to their owning epic.',
  '  > _proposed because docs/epics/ epics are tracked_',
  '- Ship weekly.',
  '',
].join('\n');

const CONSTITUTION_EMPTY_GOALS = [
  '# Shop - Constitution',
  '',
  '## Invariants',
  '',
  '1. Core functionality works offline.',
  '',
  '## Goals',
  '',
  '<!-- Add goals here. -->',
  '',
].join('\n');

const PROPOSAL: Proposal = {
  candidates: [
    { id: 'SEED-1', section: 'Goals', text: 'Trace specs to their owning epic.', provenance: 'docs/epics/ epics are tracked', draft: true },
    { id: 'SEED-2', section: 'Principles', text: 'Honor CLAUDE.md project instructions.', provenance: 'a CLAUDE.md is present', draft: true },
  ],
  notableUnwritten: [],
};

const CONTEXT: ActiveSpecContext = {
  specId: 'SPEC-010',
  title: 'Checkout flow',
  tier: 'T2',
  currentPhase: 'specify',
  status: 'specifying',
  fileAllowlist: ['src/cart.ts'],
};

const INDEX_WITH_USER_CONTENT = (start: string, end: string): string =>
  [
    '# Register',
    '',
    'An introduction a person wrote.',
    '',
    start,
    'Stale generated content.',
    end,
    '',
    'Notes a person keeps below the generated block.',
    '',
  ].join('\n');

const DR_AUTO = '# Decision Register\n\n## [DR-001 — Use Postgres for storage](DR-001-use-postgres-for-storage.md)\n\n*Status: accepted*\n';
const EPIC_AUTO = '# Epic Register\n\n## [EPIC-001 — Telemetry](EPIC-001-telemetry.md)\n\n*Status: active · slug: `telemetry` · order: 1*\n';

/** Everything `refreshHarnessFiles` may write, with the kind of file each is (FR-5). */
function refreshOutputs(): Record<string, OutputClass> {
  const pinned = gitPinnedPaths();
  const out: Record<string, OutputClass> = {};
  for (const name of TEMPLATE_NAMES) out[TEMPLATE_OUTPUT_PATHS[name]] = 'restored';
  for (const tpl of MANAGED_REGION_TEMPLATES) out[tpl.outputPath] = pinned.has(tpl.outputPath) ? 'lf' : 'restored';
  out['.minspec/generated-hashes.json'] = 'lf';
  out['.minspec/template-baseline.json'] = 'lf';
  out[EPIC_INDEX] = 'restored';
  out['.gitignore'] = 'restored';
  out['.gitattributes'] = 'restored';
  return out;
}

/** Everything Initialize run again (`generateHarnessFiles` on a scaffolded folder) may write. */
function initializeAgainOutputs(): Record<string, OutputClass> {
  return {
    '.minspec/constitution.md': 'restored',
    'AGENTS.md': 'restored',
    '.gitignore': 'restored',
    '.gitattributes': 'restored',
    [EPIC_INDEX]: 'restored',
    '.minspec/generated-hashes.json': 'lf',
    '.minspec/template-baseline.json': 'lf',
  };
}

/** The handler the spec panel registered for messages from its webview. */
function panelMessageHandler(): (message: unknown) => void {
  const handler = panelHooks.onMessage;
  if (!handler) throw new Error('the spec panel did not listen for messages');
  return handler;
}

/** The last `## ` section of a document, removed: a template section the next Refresh brings back. */
function dropLastSection(s: string): string {
  const at = s.lastIndexOf('\n## ');
  if (at === -1) throw new Error('no section to drop');
  return s.slice(0, at + 1);
}

// ─── The rows ───────────────────────────────────────────────────────────────

/** `restored`: a document written back in its own endings. `lf`: a file FR-5 writes LF. */
type OutputClass = 'restored' | 'lf';

interface PathReaderRow {
  readonly fn: string;
  readonly files: () => Files;
  /** The same fixture with the content the reader parses removed (the control). */
  readonly strip: (files: Files) => Files;
  readonly read: (root: string) => unknown;
}

interface TextReaderRow {
  readonly fn: string;
  readonly input: () => string;
  readonly strip: (lf: string) => string;
  readonly read: (text: string) => unknown;
}

interface PathWriterRow {
  readonly fn: string;
  readonly files: () => Files;
  readonly run: (root: string) => unknown;
  /** The file whose LF run must change: the control. */
  readonly primary: string;
  /** Files that exist before the run and may be written by it. */
  readonly outputs: () => Record<string, OutputClass>;
  /**
   * Files the run creates: written LF (FR-5(a)), unless this names the documents whose text
   * they hold (a layout migration), in which case they take those documents' endings.
   */
  readonly createdFrom?: readonly string[];
}

interface TextWriterRow {
  readonly fn: string;
  readonly input: () => string;
  readonly run: (text: string) => { readonly text: string; readonly rest?: unknown };
}

const PATH_READERS: readonly PathReaderRow[] = [
  {
    fn: 'listAdrs',
    files: () => pick(GEN, [DECISIONS]),
    strip: (f) => stripAllFrontmatter(f, DECISIONS),
    read: (root) => listAdrs(root),
  },
  {
    fn: 'listEpics',
    files: () => pick(GEN, [EPICS]),
    strip: (f) => stripAllFrontmatter(f, EPICS),
    read: (root) => listEpics(root),
  },
  {
    fn: 'buildArtifactGraph, and the signpost it feeds',
    files: () => pick(GEN, [DECISIONS, EPICS, '.minspec/config.json', '.minspec/constitution.md']),
    strip: (f) => stripAllFrontmatter(stripAllFrontmatter(f, DECISIONS), EPICS),
    read: (root) => {
      const graph = buildArtifactGraph(root);
      return { graph, next: resolveNextTask(graph) };
    },
  },
  {
    fn: 'adrHasFrontmatter',
    files: () => pick(GEN, [DECISIONS]),
    strip: (f) => stripAllFrontmatter(f, DECISIONS),
    read: (root) => [DR1, DR2].map((rel) => adrHasFrontmatter(path.join(root, rel))),
  },
  {
    fn: 'readArtifactEpic',
    files: () => ({ ...pick(GEN, [DECISIONS]), [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    strip: (f) => ({ ...stripAllFrontmatter(f, DECISIONS), [SPEC_FLAT]: stripFrontmatter(f[SPEC_FLAT]) }),
    read: (root) => [DR1, DR2, SPEC_FLAT].map((rel) => readArtifactEpic(path.join(root, rel))),
  },
  {
    fn: 'validateDrIndexStatus',
    files: () => pick(GEN, [DECISIONS]),
    strip: (f) => stripAllFrontmatter(f, DECISIONS),
    read: (root) => validateDrIndexStatus(path.join(root, DECISIONS)),
  },
  {
    fn: 'validateDrAmendments',
    files: () => AMENDMENT_FILES,
    strip: (f) => edit(f, 'docs/decisions/DR-003-new-storage.md', (s) => s.replace('supersedes: [DR-002]\n', '')),
    read: (root) => validateDrAmendments(path.join(root, DECISIONS)),
  },
  {
    fn: 'findSpecDirsMissingTasksMd',
    files: () => ({ [REQUIREMENTS_REL]: REQUIREMENTS_TEXT }),
    strip: (f) => ({ [REQUIREMENTS_REL]: stripFrontmatter(f[REQUIREMENTS_REL]) }),
    read: (root) => findSpecDirsMissingTasksMd(root),
  },
  {
    fn: 'collectArtifacts',
    files: () => ({ ...pick(GEN, [DECISIONS, EPICS]), [PRODUCT_SPEC_REL]: PRODUCT_SPEC_TEXT }),
    strip: (f) => ({
      ...stripAllFrontmatter(f, DECISIONS),
      [PRODUCT_SPEC_REL]: f[PRODUCT_SPEC_REL].replace('product: shop\n', ''),
    }),
    read: (root) => collectArtifacts(root),
  },
  {
    fn: 'checkManagedRegionMarkers',
    // A managed file whose two marker lines were stripped, its body otherwise intact: the
    // LF copy is reported as healable (a warning).
    files: () => {
      const rel = 'scripts/roles/reviewer.md';
      const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === rel)!;
      const start = managedRegionStartMarker(tpl.name, tpl.commentStyle);
      const end = managedRegionEndMarker(tpl.name, tpl.commentStyle);
      return edit(pick(GEN, [rel]), rel, (s) =>
        s
          .split('\n')
          .filter((l) => l.trim() !== start && l.trim() !== end)
          .join('\n'),
      );
    },
    strip: () => pick(GEN, ['scripts/roles/reviewer.md']),
    read: (root) => checkManagedRegionMarkers(root, detectTools(root)),
  },
];

const TEXT_READERS: readonly TextReaderRow[] = [
  {
    fn: 'inspectAllStatusClaims',
    input: () => CALLOUT_DR,
    strip: (lf) => lf.replace('> **Status: proposed - scope-split by DR-024.**\n', ''),
    read: (text) => inspectAllStatusClaims(text, 'dr'),
  },
  {
    fn: 'checkStatusParity',
    input: () => CALLOUT_DR,
    strip: (lf) => lf.replace('> **Status: proposed - scope-split by DR-024.**\n', ''),
    read: (text) => checkStatusParity(text, 'accepted', 'dr'),
  },
  {
    fn: 'parseSections',
    input: () => GEN['CLAUDE.md'],
    strip: (lf) => lf.replace(/^## /gm, ''),
    read: (text) => parseSections(text),
  },
  {
    fn: 'hashSection',
    input: () => GEN['.minspec/constitution.md'],
    strip: () => '',
    read: (text) => hashSection(text),
  },
  {
    fn: 'parseConstitution',
    input: () => CONSTITUTION_RULES,
    strip: (lf) => lf.replace(/^\s*(?:\d+\.|-) .*$/gm, ''),
    read: (text) => parseConstitution(text),
  },
  {
    fn: 'buildTasksMdContent',
    input: () => REQUIREMENTS_TEXT,
    strip: (lf) => stripFrontmatter(lf),
    read: (text) => buildTasksMdContent(text),
  },
  {
    fn: 'extractExistingSummary',
    input: () => GEN[DR_INDEX],
    strip: (lf) => lf.replace(/<!-- \/?dr-summary:[^>]*-->\n?/g, ''),
    read: (text) => extractExistingSummary(text, 'DR-001'),
  },
];

const PATH_WRITERS: readonly PathWriterRow[] = [
  {
    fn: 'migrateLegacyClaudeSlashCommandShims (reached through refreshHarnessFiles)',
    files: () => ({ ...GEN, [legacyClaudeShimOutputPath('specify')]: buildLegacyBareClaudeShim('specify') }),
    run: (root) => refreshHarnessFiles(root).length,
    primary: legacyClaudeShimOutputPath('specify'),
    outputs: refreshOutputs,
  },
  {
    fn: 'setAdrStatus',
    files: () => edit(pick(GEN, [DECISIONS]), DR2, (s) => s.replace('status: accepted', 'status: proposed')),
    run: (root) => setAdrStatus(path.join(root, DR2), 'accepted'),
    primary: DR2,
    outputs: () => ({ [DR2]: 'restored' }),
  },
  {
    fn: 'refreshHarnessFiles (through mergeFile)',
    files: () => edit(GEN, 'CLAUDE.md', dropLastSection),
    run: (root) => refreshHarnessFiles(root).length,
    primary: 'CLAUDE.md',
    outputs: refreshOutputs,
  },
  {
    fn: 'seedConstitution (through integrateProposal), as when Initialize is run again',
    files: () =>
      edit(GEN, '.minspec/constitution.md', (s) =>
        s.replace(/- DRAFT: Trace specs[^\n]*\n {2}> _proposed because[^\n]*\n/, ''),
      ),
    run: (root) => generateHarnessFiles(root),
    primary: '.minspec/constitution.md',
    outputs: initializeAgainOutputs,
  },
  {
    fn: 'regenerateDrIndex',
    files: () =>
      edit(pick(GEN, [DECISIONS, '.minspec/config.json']), DR_INDEX, (s) => s.replace(/\*Status: accepted/g, '*Status: proposed')),
    run: (root) => regenerateDrIndex(root).count,
    primary: DR_INDEX,
    outputs: () => ({ [DR_INDEX]: 'restored' }),
  },
  {
    fn: 'writeEpicIndex',
    files: () => edit(pick(GEN, [EPICS, '.minspec/config.json']), EPIC_INDEX, (s) => s.replace('*Status: active', '*Status: proposed')),
    run: (root) => writeEpicIndex(root).count,
    primary: EPIC_INDEX,
    outputs: () => ({ [EPIC_INDEX]: 'restored' }),
  },
  {
    fn: 'applyBackfill',
    files: () => pick(GEN, [DECISIONS, EPICS, '.minspec/config.json']),
    run: (root) => {
      const mapping = (rel: string, id: string) => ({
        artifactId: id,
        kind: 'adr' as const,
        filePath: path.join(root, rel),
        epicSlug: 'storage',
        confidence: 0.9,
        rationale: 'about storage',
      });
      const proposal: BackfillProposal = {
        epics: [{ slug: 'storage', title: 'Storage', rationale: 'Where the data lives.' }],
        // DR-001 is already in an epic, so only DR-002 joins the new one.
        mappings: [mapping(DR1, 'DR-001'), mapping(DR2, 'DR-002')],
        source: 'heuristic',
      };
      return applyBackfill(root, proposal);
    },
    primary: DR2,
    outputs: () => ({ [DR2]: 'restored', [EPIC_INDEX]: 'restored' }),
  },
  {
    fn: 'setSpecStatus',
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => setSpecStatus(path.join(root, SPEC_FLAT), 'planning'),
    primary: SPEC_FLAT,
    outputs: () => ({ [SPEC_FLAT]: 'restored' }),
  },
  {
    fn: 'setSpecPhases',
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => setSpecPhases(path.join(root, SPEC_FLAT), { specify: 'done', plan: 'in-progress' }, { createIfAbsent: false }),
    primary: SPEC_FLAT,
    outputs: () => ({ [SPEC_FLAT]: 'restored' }),
  },
  {
    fn: 'advanceSpecToImplementing',
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => advanceSpecToImplementing(path.join(root, SPEC_FLAT)),
    primary: SPEC_FLAT,
    outputs: () => ({ [SPEC_FLAT]: 'restored' }),
  },
  {
    fn: 'setEpicStatus',
    files: () => edit(pick(GEN, [EPICS]), EPIC1, (s) => s.replace('status: active', 'status: proposed')),
    run: (root) => setEpicStatus(path.join(root, EPIC1), 'active'),
    primary: EPIC1,
    outputs: () => ({ [EPIC1]: 'restored' }),
  },
  {
    fn: 'setEpicOrder',
    files: () => pick(GEN, [EPICS]),
    run: (root) => setEpicOrder(path.join(root, EPIC1), 7),
    primary: EPIC1,
    outputs: () => ({ [EPIC1]: 'restored' }),
  },
  {
    fn: 'setArtifactEpic',
    files: () => pick(GEN, [DECISIONS]),
    run: (root) => setArtifactEpic(path.join(root, DR2), 'EPIC-001', 'Telemetry'),
    primary: DR2,
    outputs: () => ({ [DR2]: 'restored' }),
  },
  {
    fn: 'writeSpec, reached from writeSpecFile (a phase transition)',
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => transitionPhase(root, 'SPEC-010', 'advance'),
    primary: SPEC_FLAT,
    outputs: () => ({ [SPEC_FLAT]: 'restored' }),
  },
  {
    fn: "writeSpec, reached from the spec panel's checkbox write",
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => {
      panelHooks.onMessage = undefined;
      panelHooks.errors.length = 0;
      const panel = new SpecPanel();
      panel.show(path.join(root, SPEC_FLAT));
      panelMessageHandler()({ command: 'toggleTask', phase: 'tasks', taskIndex: 0, done: true });
      panel.dispose();
      if (panelHooks.errors.length > 0) throw new Error(panelHooks.errors.join('; '));
    },
    primary: SPEC_FLAT,
    outputs: () => ({ [SPEC_FLAT]: 'restored' }),
  },
  {
    fn: 'writeSpec, reached from writeSpecKitDir (a phase transition)',
    files: () => SPEC_KIT_FILES,
    run: (root) => transitionPhase(root, 'SPEC-010', 'advance'),
    primary: 'specs/010-checkout/spec.md',
    outputs: () => ({
      'specs/010-checkout/spec.md': 'restored',
      'specs/010-checkout/plan.md': 'restored',
      'specs/010-checkout/tasks.md': 'restored',
    }),
  },
  {
    fn: 'migrateLayout, flat to spec-kit',
    files: () => ({ [SPEC_FLAT]: SPEC_FLAT_TEXT }),
    run: (root) => migrateLayout(root, 'spec-kit'),
    primary: SPEC_FLAT,
    outputs: () => ({}),
    createdFrom: [SPEC_FLAT],
  },
  {
    fn: 'migrateLayout, spec-kit to flat',
    files: () => SPEC_KIT_FILES,
    run: (root) => migrateLayout(root, 'flat'),
    primary: 'specs/010-checkout/spec.md',
    outputs: () => ({}),
    createdFrom: ['specs/010-checkout/spec.md', 'specs/010-checkout/plan.md', 'specs/010-checkout/tasks.md'],
  },
  {
    fn: 'ensureGitignoreEntries',
    files: () => ({ '.gitignore': 'node_modules/\ndist/\n' }),
    run: (root) => ensureGitignoreEntries(root),
    primary: '.gitignore',
    outputs: () => ({ '.gitignore': 'restored' }),
  },
  {
    fn: 'ensureGitattributesEntries',
    files: () => ({ '.gitattributes': '*.png binary\n*.svg text\n' }),
    run: (root) => ensureGitattributesEntries(root),
    primary: '.gitattributes',
    outputs: () => ({ '.gitattributes': 'restored' }),
  },
  {
    fn: 'spliceManagedRegion (reached through refreshHarnessFiles)',
    // A managed file that is not pinned, with two user lines on each side of its region and
    // a region that is out of date.
    files: () =>
      edit(GEN, 'scripts/roles/reviewer.md', (s) => {
        const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === 'scripts/roles/reviewer.md')!;
        const start = managedRegionStartMarker(tpl.name, tpl.commentStyle);
        const end = managedRegionEndMarker(tpl.name, tpl.commentStyle);
        const [head, rest] = s.split(`${start}\n`);
        const [, tail] = rest.split(`${end}\n`);
        return `${head}A note a person added.\nA second one.\n\n${start}\nAn out-of-date region.\n${end}\n\nA note below the region.\nAnd one more.\n${tail}`;
      }),
    run: (root) => refreshHarnessFiles(root).length,
    primary: 'scripts/roles/reviewer.md',
    outputs: refreshOutputs,
  },
  {
    fn: 'appendToParkingLotFile',
    files: () => ({
      '.minspec/parking-lot.md': '# Parking Lot\n\nTopics parked during MinSpec sessions for later triage.\n\n## An older topic\n\nStill open.\n\n---\n',
    }),
    run: (root) =>
      path.relative(
        root,
        appendToParkingLotFile(root, {
          title: 'Dark mode',
          body: 'Someone asked for it twice.',
          labels: ['idea'],
          sessionScope: 'checkout flow',
          createdAt: '2026-10-03',
        }),
      ),
    primary: '.minspec/parking-lot.md',
    outputs: () => ({ '.minspec/parking-lot.md': 'restored' }),
  },
];

const TEXT_WRITERS: readonly TextWriterRow[] = [
  {
    fn: 'mergeFile',
    input: () => dropLastSection(GEN['CLAUDE.md']),
    run: (text) => {
      const r = mergeFile(text, GEN['CLAUDE.md'], sectionHashesFromMarkdown(GEN['CLAUDE.md']));
      return {
        text: r.merged,
        rest: {
          preservedWithoutBaseline: r.preservedWithoutBaseline,
          withheldTemplateHashes: { ...r.withheldTemplateHashes },
          unauthoredHeadings: r.unauthoredHeadings,
        },
      };
    },
  },
  {
    fn: 'integrateProposal',
    input: () => CONSTITUTION_EMPTY_GOALS,
    run: (text) => {
      const r = integrateProposal(text, PROPOSAL);
      return { text: r.merged, rest: { added: r.added.map((c) => c.id), skipped: r.skipped.map((c) => c.id) } };
    },
  },
  {
    fn: 'compactConstitution',
    input: () => CONSTITUTION_DRAFTS,
    run: (text) => {
      const r = compactConstitution(text);
      return {
        text: r.compacted,
        rest: { strippedDraftMarkers: r.strippedDraftMarkers, strippedProvenance: r.strippedProvenance, unchanged: r.unchanged },
      };
    },
  },
  {
    fn: 'injectAgentsSlashSection',
    input: () => GEN['AGENTS.md'].replace(/\n*<!-- minspec:slash-commands:start -->[\s\S]*?<!-- minspec:slash-commands:end -->\n?/, '\n'),
    run: (text) => ({ text: injectAgentsSlashSection(text) }),
  },
  {
    fn: 'injectContext',
    input: () => GEN['CLAUDE.md'],
    run: (text) => ({ text: injectContext(text, CONTEXT) }),
  },
  {
    fn: 'removeContext',
    input: () => `${injectContext(GEN['CLAUDE.md'], CONTEXT).trimEnd()}\n\n\nUser notes after the block.\n`,
    run: (text) => ({ text: removeContext(text) }),
  },
  {
    fn: 'mergeDrIndex',
    input: () => INDEX_WITH_USER_CONTENT('<!-- minspec:dr-index:start -->', '<!-- minspec:dr-index:end -->'),
    run: (text) => ({ text: mergeDrIndex(text, DR_AUTO) }),
  },
  {
    fn: 'mergeEpicIndex',
    input: () => INDEX_WITH_USER_CONTENT('<!-- minspec:epic-index:start -->', '<!-- minspec:epic-index:end -->'),
    run: (text) => ({ text: mergeEpicIndex(text, EPIC_AUTO) }),
  },
];

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'spec095-rt-'));
  GEN = buildGeneratedProject();
}, 120_000);

afterAll(() => {
  if (SCRATCH) fs.rmSync(SCRATCH, { recursive: true, force: true });
});

// ─── The variant table, applied to every listed function ──────────────────────

describe('SPEC-095 FR-9: readers given a path return their LF result', () => {
  for (const row of PATH_READERS) {
    describe(row.fn, () => {
      it('control: its LF result depends on what it parsed', () => {
        const root = rowRoot(row.fn);
        const files = row.files();
        writeTree(root, files, asIs);
        const lf = capture(() => row.read(root));
        expect('error' in lf ? lf.error : undefined, `${row.fn} failed on the LF fixture`).toBeUndefined();
        writeTree(root, row.strip(files), asIs);
        expect(capture(() => row.read(root)), `${row.fn} returned the same result with the content it reads removed`).not.toEqual(lf);
      });
      for (const variant of VARIANTS) {
        it(`${variant.name}`, () => {
          const root = rowRoot(row.fn);
          const files = row.files();
          writeTree(root, files, asIs);
          const lf = capture(() => row.read(root));
          writeTree(root, files, variant.write);
          expect(capture(() => row.read(root))).toEqual(lf);
        });
      }
    });
  }
});

describe('SPEC-095 FR-2: functions in the tables that are given text prepare it at their own entry', () => {
  for (const row of TEXT_READERS) {
    describe(row.fn, () => {
      it('control: its LF result depends on what it parsed', () => {
        const lf = row.input();
        expect(capture(() => row.read(lf)), `${row.fn} returned the same result with the content it reads removed`).not.toEqual(
          capture(() => row.read(row.strip(lf))),
        );
      });
      for (const variant of VARIANTS) {
        it(`${variant.name}`, () => {
          const lf = row.input();
          expect(capture(() => row.read(variant.write(lf)))).toEqual(capture(() => row.read(lf)));
        });
      }
    });
  }
});

describe('SPEC-095 FR-3/FR-4/FR-5: writers leave each document in the line endings they found', () => {
  for (const row of PATH_WRITERS) {
    describe(row.fn, () => {
      it(`control: its LF run changes ${row.primary}`, () => {
        const root = rowRoot(row.fn);
        const files = row.files();
        writeTree(root, files, asIs);
        const lf = capture(() => row.run(root));
        expect('error' in lf ? lf.error : undefined, `${row.fn} failed on the LF fixture`).toBeUndefined();
        expect(readTree(root)[row.primary], `${row.fn} left ${row.primary} as it was`).not.toBe(files[row.primary]);
      });
      for (const variant of VARIANTS) {
        it(`${variant.name}`, () => {
          const root = rowRoot(row.fn);
          const files = row.files();
          writeTree(root, files, asIs);
          const lfResult = capture(() => row.run(root));
          const lfAfter = readTree(root);
          writeTree(root, files, variant.write);
          const input = readTree(root);
          const result = capture(() => row.run(root));
          const after = readTree(root);

          if (!('error' in lfResult)) {
            expect('error' in result ? result.error : undefined, `${row.fn} threw on ${variant.name} where the LF run did not`).toBeUndefined();
          }
          expect(result, `${row.fn} returned something else on ${variant.name}`).toEqual(lfResult);

          // The primary file first, so a failing row names the file it is about.
          const order = [row.primary, ...Object.keys(lfAfter).filter((rel) => rel !== row.primary)];
          expect(Object.keys(after).sort(), `${row.fn}: a different set of files on ${variant.name}`).toEqual(Object.keys(lfAfter).sort());
          const outputs = row.outputs();
          for (const rel of order) {
            if (!(rel in lfAfter)) continue; // deleted in both runs (the key sets agree)
            const label = `${row.fn} → ${rel} (${variant.name})`;
            if (!(rel in files)) {
              // A file the run created.
              if (row.createdFrom) {
                expectRestored(row.createdFrom.map((src) => input[src]), after[rel], lfAfter[rel], variant, label);
              } else {
                expect(after[rel], `${label}: a file MinSpec creates is written LF (FR-5(a))`).toBe(lfAfter[rel]);
              }
              continue;
            }
            const cls = outputs[rel];
            if (cls === undefined) {
              expect(lfAfter[rel], `${label}: the LF run wrote a file this row does not declare`).toBe(files[rel]);
              expect(after[rel], `${label}: a file the writer does not write must come back untouched`).toBe(input[rel]);
            } else if (cls === 'lf') {
              expect(after[rel], `${label}: written LF, as the LF run writes it (FR-5)`).toBe(lfAfter[rel]);
            } else {
              expectRestored([input[rel]], after[rel], lfAfter[rel], variant, label);
            }
          }
        });
      }
    });
  }

  for (const row of TEXT_WRITERS) {
    describe(row.fn, () => {
      it('control: its LF run changes the text', () => {
        const lf = row.input();
        expect(row.run(lf).text, `${row.fn} returned its input unchanged`).not.toBe(lf);
      });
      for (const variant of VARIANTS) {
        it(`${variant.name}`, () => {
          const lf = row.input();
          const lfOut = capture(() => row.run(lf));
          const input = variant.write(lf);
          const out = capture(() => row.run(input));
          if ('error' in lfOut || 'error' in out) {
            expect(out, `${row.fn} threw differently on ${variant.name}`).toEqual(lfOut);
            return;
          }
          expect(out.value.rest, `${row.fn}: the result besides the text differs on ${variant.name}`).toEqual(lfOut.value.rest);
          expectRestored([input], out.value.text, lfOut.value.text, variant, `${row.fn} (${variant.name})`);
        });
      }
    });
  }
});

// ─── The three symptoms in #2397, by name (T3) ─────────────────────────────────

describe('SPEC-095 AC-2: the signpost on a CRLF copy', () => {
  it('a register in which every decision is accepted and every epic active shows nothing pending, LF or CRLF', () => {
    const files = pick(GEN, [DECISIONS, EPICS, '.minspec/config.json', '.minspec/constitution.md']);
    const root = rowRoot('signpost');
    writeTree(root, files, asIs);
    expect(listAdrs(root).map((a) => a.status)).toEqual(['accepted', 'accepted']);
    expect(resolveNextTask(buildArtifactGraph(root)), 'the LF register is not settled').toBeNull();
    // Control: the same register with its frontmatter unreadable has a decision to accept.
    writeTree(root, stripAllFrontmatter(files, DECISIONS), asIs);
    expect(resolveNextTask(buildArtifactGraph(root))).not.toBeNull();
    writeTree(root, files, VARIANTS[0].write);
    expect(resolveNextTask(buildArtifactGraph(root)), 'the CRLF register shows a task the LF one does not').toBeNull();
  });
});

describe('SPEC-095 T3: the three symptoms #2397 names', () => {
  it('Accept Decision on a CRLF record leaves one frontmatter block and one status line (AC-6)', () => {
    const files = edit(pick(GEN, [DECISIONS, '.minspec/config.json']), DR2, (s) => s.replace('status: accepted', 'status: proposed'));
    const accept = (root: string): void => {
      // What the Accept command does (commands/adr.ts `applyStatus`): the frontmatter check
      // that decides whether to show "predates MinSpec ... Add Frontmatter", then the write,
      // then the INDEX regeneration.
      expect(adrHasFrontmatter(path.join(root, DR2)), 'a record with frontmatter was read as having none').toBe(true);
      setAdrStatus(path.join(root, DR2), 'accepted');
      regenerateDrIndex(root);
    };
    const root = rowRoot('accept-decision');
    writeTree(root, files, asIs);
    accept(root);
    const lf = readTree(root);
    writeTree(root, files, VARIANTS[0].write);
    accept(root);
    const crlf = readTree(root);

    const record = crlf[DR2];
    expect(detectDoubledFrontmatter(record), 'a second frontmatter block was put in front of the record').toBeUndefined();
    expect(record.split('\r\n').filter((l) => l === '---')).toHaveLength(2);
    expect(record.split('\r\n').filter((l) => /^status:/.test(l))).toEqual(['status: accepted']);
    expect(record).toBe(convert(lf[DR2], '\r\n'));
    expect(crlf[DR_INDEX]).toBe(convert(lf[DR_INDEX], '\r\n'));
    expect(listAdrs(root).map((a) => a.status)).toEqual(['accepted', 'accepted']);
  });

  it('Refresh Harness Files on a CRLF copy of a settled project changes no byte of the five harness documents (AC-7)', () => {
    const harness = TEMPLATE_NAMES.map((n) => TEMPLATE_OUTPUT_PATHS[n]);
    expect(harness).toHaveLength(5);
    const root = rowRoot('refresh-settled');

    // Control: the project really is settled, so a Refresh on its LF copy changes none of them.
    writeTree(root, GEN, asIs);
    refreshHarnessFiles(root);
    const lfAfter = readTree(root);
    for (const rel of harness) expect(lfAfter[rel], `${rel} is not settled on LF`).toBe(GEN[rel]);

    writeTree(root, GEN, VARIANTS[0].write);
    const before = readTree(root);
    refreshHarnessFiles(root);
    const after = readTree(root);
    for (const rel of harness) {
      const headings = (s: string): string[] => s.split(/\r?\n/).filter((l) => l.startsWith('## '));
      expect(after[rel].split('\n').length, `${rel}: line count`).toBe(before[rel].split('\n').length);
      expect(headings(after[rel]), `${rel}: headings`).toEqual(headings(before[rel]));
      expect(after[rel], `${rel} changed`).toBe(before[rel]);
      expect(after[rel].replace(/\r\n/g, ''), `${rel} is not CRLF throughout`).not.toMatch(/[\r\n]/);
    }
    const constitutionHeadings = after['.minspec/constitution.md'].split('\r\n').filter((l) => l.startsWith('## '));
    expect(new Set(constitutionHeadings).size, 'a heading appears twice in the constitution').toBe(constitutionHeadings.length);
  });

  it('Approve Spec on a CRLF spec in status specifying succeeds, and the approval reads approved on CRLF and LF copies (AC-8)', () => {
    const root = rowRoot('approve-spec');
    writeTree(root, { '.minspec/config.json': '{}\n', [SPEC_FLAT]: SPEC_FLAT_TEXT }, VARIANTS[0].write);
    const file = path.join(root, SPEC_FLAT);

    // What Approve Spec does for a spec in status new or specifying (commands/approve.ts).
    advanceSpecToImplementing(file);
    approveSpec(root, file, 'T2', 'reviewer@example.com', () => new Date('2026-10-03T00:00:00Z'));

    const approvedBytes = fs.readFileSync(file, 'utf-8');
    expect(approvedBytes.replace(/\r\n/g, ''), 'the approved spec is not CRLF throughout').not.toMatch(/[\r\n]/);
    expect(getApprovalStatus(root, file)).toBe('approved');
    fs.writeFileSync(file, normalize(approvedBytes));
    expect(getApprovalStatus(root, file), 'the approval does not hold on the LF copy').toBe('approved');
    fs.writeFileSync(file, convert(normalize(approvedBytes), '\r\n'));
    expect(getApprovalStatus(root, file), 'the approval does not hold on the CRLF copy').toBe('approved');
  });
});

// ─── Named cases: FR-5, FR-7, FR-8 ──────────────────────────────────────────

describe('SPEC-095 FR-5: which writes are LF', () => {
  it('(a) a file MinSpec creates in a CRLF project is LF', () => {
    const root = rowRoot('new-files');
    writeTree(root, { ...pick(GEN, ['.minspec/', DECISIONS, EPICS]), [REQUIREMENTS_REL]: REQUIREMENTS_TEXT }, VARIANTS[0].write);
    const created = [
      createAdr(root, 'Cache the catalog').filePath,
      createEpic(root, 'Search').filePath,
      createSpec(root, 'Wishlist', 'T2').filePath,
    ];
    expect(scaffoldTasksMd(path.join(root, path.dirname(REQUIREMENTS_REL)))).toBe(true);
    created.push(path.join(root, path.dirname(REQUIREMENTS_REL), 'tasks.md'));
    for (const file of created) {
      const bytes = fs.readFileSync(file, 'utf-8');
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes, `${path.relative(root, file)} was not written LF`).not.toContain('\r');
    }
    // The scaffolded tasks.md carries the real id and the inherited fields (AC-4).
    const tasks = fs.readFileSync(created[3], 'utf-8');
    expect(tasks).toContain('id: SPEC-020');
    expect(tasks).toContain('product: shop');
    expect(tasks).toContain('epic: EPIC-001  # Telemetry');
  });

  it('(a) a spec migrated to another layout keeps its CRLF endings', () => {
    const root = rowRoot('migrate-crlf');
    writeTree(root, { [SPEC_FLAT]: SPEC_FLAT_TEXT }, VARIANTS[0].write);
    expect(migrateLayout(root, 'spec-kit').migrated).toBe(1);
    const tree = readTree(root);
    const written = Object.keys(tree);
    expect(written.length).toBeGreaterThan(1);
    for (const rel of written) {
      expect(tree[rel].replace(/\r\n/g, ''), `${rel} is not CRLF throughout`).not.toMatch(/[\r\n]/);
    }
  });

  it('(b) JSON MinSpec re-serializes is LF', () => {
    const root = rowRoot('json-lf');
    writeTree(root, GEN, VARIANTS[0].write);
    refreshHarnessFiles(root);
    for (const rel of ['.minspec/generated-hashes.json', '.minspec/template-baseline.json']) {
      expect(fs.readFileSync(path.join(root, rel), 'utf-8'), `${rel}`).not.toContain('\r');
    }
  });

  it('(c) the files written LF throughout are exactly the managed files git reports as eol: lf', () => {
    const pinned = gitPinnedPaths();
    expect(pinned.size, 'git reported no pinned file, so this comparison would be vacuous').toBeGreaterThan(0);
    const managed = [...MANAGED_REGION_TEMPLATES.map((t) => t.outputPath), ...TEMPLATE_NAMES.map((n) => TEMPLATE_OUTPUT_PATHS[n])];
    const byCode = managed.filter((rel) => isLfPinnedPath(rel)).sort();
    expect(byCode).toEqual([...pinned].sort());
  });

  it('(c) a CRLF hook with user lines on both sides of its region runs after one Refresh', () => {
    const rel = '.minspec/hooks/commit-msg';
    const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === rel)!;
    const start = managedRegionStartMarker(tpl.name, tpl.commentStyle);
    const end = managedRegionEndMarker(tpl.name, tpl.commentStyle);
    const files = edit(GEN, rel, (s) =>
      s.replace(`${start}\n`, `# A note a person added.\n# A second one.\n\n${start}\n`).replace(`${end}\n`, `${end}\n\n# A note below the region.\n# And one more.\n`),
    );
    const root = rowRoot('crlf-hook');
    writeTree(root, files, VARIANTS[0].write);
    const hook = path.join(root, rel);
    fs.chmodSync(hook, 0o755);
    const message = path.join(root, 'COMMIT_MSG');
    fs.writeFileSync(message, 'fix: a change with no diagnosis\n');
    const runHook = () => spawnSync(hook, [message], { encoding: 'utf-8' });

    // Control: as checked out CRLF, the hook does not start at all.
    const before = runHook();
    expect(before.status, `the CRLF hook ran (stderr: ${before.stderr})`).toBe(127);

    refreshHarnessFiles(root);
    const after = fs.readFileSync(hook, 'utf-8');
    expect(after, 'the pinned hook still holds a carriage return').not.toContain('\r');
    expect(after).toContain('# A note a person added.');
    expect(after).toContain('# A note below the region.');
    fs.chmodSync(hook, 0o755);
    const ran = runHook();
    // It runs, and it is the hook's own gate that answers: a fix commit with no root cause.
    expect(ran.status, `the refreshed hook did not run (stderr: ${ran.stderr})`).toBe(1);
    expect(ran.stderr).toContain('RCDD gate');
  });
});

describe('SPEC-095 FR-7: section hashes do not depend on line endings', () => {
  it('hashSection returns the hash of the LF form of any body', () => {
    for (const section of parseSections(GEN['CLAUDE.md'])) {
      for (const variant of VARIANTS) {
        expect(hashSection(variant.write(section.body)), `${section.heading} (${variant.name})`).toBe(hashSection(section.body));
      }
    }
  });

  it('a manifest recorded on the LF copy is honoured on the CRLF copy (AC-15)', () => {
    // One section MinSpec wrote and the template has since changed (its manifest hash is the
    // body on disk, so Refresh replaces it), and one section a person edited (its hash is the
    // old body, so Refresh keeps it). The manifest is the one recorded from the LF bytes.
    const sections = parseSections(GEN['CLAUDE.md']).filter((s) => s.heading !== '__preamble__');
    const replaced = sections[1];
    const edited = sections[2];
    const staleBody = `${replaced.body.trimEnd()}\n\nA paragraph an older template carried.\n`;
    const userBody = `${edited.body.trimEnd()}\n\nA paragraph a person wrote.\n`;
    let claude = GEN['CLAUDE.md'];
    claude = claude.replace(`## ${replaced.heading}\n${replaced.body}`, `## ${replaced.heading}\n${staleBody}`);
    claude = claude.replace(`## ${edited.heading}\n${edited.body}`, `## ${edited.heading}\n${userBody}`);
    expect(claude).toContain('A paragraph an older template carried.');
    expect(claude).toContain('A paragraph a person wrote.');
    const manifest = JSON.parse(GEN['.minspec/generated-hashes.json']) as Record<string, Record<string, string>>;
    manifest['CLAUDE.md'][replaced.heading] = hashSection(staleBody);
    const files = { ...GEN, 'CLAUDE.md': claude, '.minspec/generated-hashes.json': `${JSON.stringify(manifest, null, 2)}\n` };

    const root = rowRoot('manifest-lf-on-crlf');
    writeTree(root, files, asIs);
    const lfNotices = refreshHarnessFiles(root).map((w) => w.kind ?? 'managed-region');
    const lfClaude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    // Control: the LF run replaced one section and kept the other.
    expect(lfClaude).not.toContain('A paragraph an older template carried.');
    expect(lfClaude).toContain('A paragraph a person wrote.');

    // The CRLF copy, with the manifest exactly as the LF copy recorded it (it is gitignored and
    // machine-local, so it is never converted by a checkout).
    writeTree(root, files, VARIANTS[0].write);
    fs.writeFileSync(path.join(root, '.minspec/generated-hashes.json'), files['.minspec/generated-hashes.json']);
    const crlfNotices = refreshHarnessFiles(root).map((w) => w.kind ?? 'managed-region');
    const crlfClaude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(crlfNotices).toEqual(lfNotices);
    expect(crlfClaude).toBe(convert(lfClaude, '\r\n'));
  });
});

describe('SPEC-095 FR-8: the approval hash does not change between LF and CRLF, in either twin', () => {
  it('every spec in specs/ hashes the same LF and CRLF, in TypeScript and in Python', () => {
    requireTool('python3');
    const specs: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.md')) specs.push(full);
      }
    };
    walk(path.join(REPO_ROOT, 'specs'));
    expect(specs.length).toBeGreaterThan(50);

    const dir = fs.mkdtempSync(path.join(SCRATCH, 'fr8-'));
    const pairs = specs.map((file, i) => {
      const lf = normalize(fs.readFileSync(file, 'utf-8'));
      const lfPath = path.join(dir, `${i}.lf.md`);
      const crlfPath = path.join(dir, `${i}.crlf.md`);
      fs.writeFileSync(lfPath, lf);
      fs.writeFileSync(crlfPath, convert(lf, '\r\n'));
      expect(specHash(convert(lf, '\r\n')), path.relative(REPO_ROOT, file)).toBe(specHash(lf));
      return { rel: path.relative(REPO_ROOT, file), lf, lfPath, crlfPath };
    });

    // The Python twin, read both ways it is read in production: through text mode (the CLI and
    // the gate), and raw (`spec_hash` given the bytes with their carriage returns).
    const script = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'hooks'))})`,
      'import canonical',
      'out = []',
      'for p in json.load(sys.stdin):',
      "    text = open(p, 'r', encoding='utf-8').read()",
      "    raw = open(p, 'r', encoding='utf-8', newline='').read()",
      '    out.append([canonical.spec_hash(text), canonical.spec_hash(raw)])',
      'print(json.dumps(out))',
    ].join('\n');
    const paths = pairs.flatMap((p) => [p.lfPath, p.crlfPath]);
    const hashes = JSON.parse(
      execFileSync('python3', ['-c', script], { input: JSON.stringify(paths), encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }),
    ) as Array<[string, string]>;
    pairs.forEach((p, i) => {
      const ts = specHash(p.lf);
      const [lfText, lfRaw] = hashes[2 * i];
      const [crlfText, crlfRaw] = hashes[2 * i + 1];
      expect([lfText, lfRaw, crlfText, crlfRaw], p.rel).toEqual([ts, ts, ts, ts]);
    });

    // And the CLI itself, once, on a CRLF copy.
    const cli = execFileSync('python3', [path.join(REPO_ROOT, 'scripts', 'hooks', 'canonical.py'), '--hash', pairs[0].crlfPath], {
      encoding: 'utf-8',
    }).trim();
    expect(cli).toBe(specHash(pairs[0].lf));
  });
});

// ─── End to end: a core.autocrlf=true checkout ───────────────────────────────

describe('SPEC-095 FR-9: end to end on a core.autocrlf=true checkout (AC-10)', () => {
  it('writers change only the intended lines, and git add prints no line-ending warning for a document they modified', () => {
    requireTool('git');
    const base = fs.mkdtempSync(path.join(SCRATCH, 'e2e-'));
    const origin = path.join(base, 'origin');
    fs.mkdirSync(origin);
    git(origin, 'init', '-q');
    git(origin, 'config', 'user.email', 'test@example.com');
    git(origin, 'config', 'user.name', 'Test');
    git(origin, 'config', 'core.autocrlf', 'false');
    generateHarnessFiles(origin);
    createAdr(origin, 'Use Postgres for storage');
    createAdr(origin, 'Adopt a monorepo layout');
    createEpic(origin, 'Telemetry', undefined, undefined, 'Measure what the product does in the field.');
    fs.mkdirSync(path.join(origin, path.dirname(SPEC_FLAT)), { recursive: true });
    fs.writeFileSync(path.join(origin, SPEC_FLAT), SPEC_FLAT_TEXT);
    regenerateDrIndex(origin);
    writeEpicIndex(origin);
    git(origin, 'add', '-A');
    git(origin, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'a generated project');

    const lfCopy = path.join(base, 'lf');
    const crlfCopy = path.join(base, 'crlf');
    git(base, 'clone', '-q', '-c', 'core.autocrlf=false', origin, lfCopy);
    git(base, 'clone', '-q', '-c', 'core.autocrlf=true', origin, crlfCopy);
    const dr = listAdrs(lfCopy)[0];
    const drRel = path.relative(lfCopy, dr.filePath);
    expect(fs.readFileSync(path.join(crlfCopy, drRel), 'utf-8'), 'the autocrlf checkout is not CRLF').toContain('\r\n');

    const runWriters = (root: string): void => {
      setAdrStatus(path.join(root, drRel), 'accepted'); // Accept Decision
      regenerateDrIndex(root);
      const epic = listEpics(root)[0];
      setEpicStatus(epic.filePath, 'active'); // Accept Epic
      writeEpicIndex(root);
      expect(transitionPhase(root, 'SPEC-010', 'advance').success).toBe(true); // a phase transition
      refreshHarnessFiles(root); // Refresh Harness Files
    };
    runWriters(lfCopy);
    runWriters(crlfCopy);

    const numstat = (root: string): string => git(root, 'diff', '--numstat');
    const intended = numstat(lfCopy);
    expect(intended.trim().split('\n').length, 'the writers changed nothing on the LF checkout').toBeGreaterThanOrEqual(4);
    expect(numstat(crlfCopy)).toBe(intended);

    const pinned = gitPinnedPaths();
    const modified = git(crlfCopy, 'diff', '--name-only').trim().split('\n').filter(Boolean);
    const documents = modified.filter((rel) => !rel.endsWith('.json') && !pinned.has(rel));
    expect(documents.length).toBeGreaterThanOrEqual(4);
    for (const rel of documents) {
      const bytes = fs.readFileSync(path.join(crlfCopy, rel), 'utf-8');
      expect(bytes.replace(/\r\n/g, ''), `${rel} was left with more than one line ending`).not.toMatch(/[\r\n]/);
      const add = spawnSync('git', ['add', '--', rel], { cwd: crlfCopy, encoding: 'utf-8', env: gitEnv() });
      expect(add.status, `git add ${rel} failed: ${add.stderr}`).toBe(0);
      expect(add.stderr, `git add ${rel} printed a line-ending warning`).not.toMatch(/will be replaced by/);
    }
  });
});

describe('SPEC-095 FR-9: a case whose tool is missing fails, naming the tool', () => {
  it('requireTool throws, naming the tool', () => {
    expect(() => requireTool('spec095-no-such-tool')).toThrow(/spec095-no-such-tool/);
  });
});

// ─── T1: the helper's three steps ─────────────────────────────────────────────

/** Loaded at run time so the rows above still run, one by one, on code that has no helper. */
async function loadTextIo(): Promise<typeof import('../src/lib/text-io')> {
  const specifier = ['..', 'src', 'lib', 'text-io'].join('/');
  return (await import(/* @vite-ignore */ specifier)) as typeof import('../src/lib/text-io');
}

describe('SPEC-095 T1: text-io prepares, detects and restores', () => {
  it('prepareText turns every CRLF and every lone CR into LF, the rule the approval hash uses', async () => {
    const { prepareText } = await loadTextIo();
    expect(prepareText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(prepareText('a\r\r\nb')).toBe('a\n\nb');
    expect(prepareText('\r')).toBe('\n');
    const lf = 'a\nb\n';
    expect(prepareText(lf)).toBe(lf);
    expect(prepareText('')).toBe('');
  });

  it('lineEndingOf is the majority ending; a tie, or no terminator, is LF', async () => {
    const { lineEndingOf } = await loadTextIo();
    expect(lineEndingOf('a\r\nb\r\n')).toBe('\r\n');
    expect(lineEndingOf('a\nb\n')).toBe('\n');
    expect(lineEndingOf('a\rb\r')).toBe('\r');
    expect(lineEndingOf('a\r\nb\r\nc\nd')).toBe('\r\n');
    expect(lineEndingOf('a\r\nb\nc')).toBe('\n');
    expect(lineEndingOf('a\r\nb\r')).toBe('\n');
    expect(lineEndingOf('no terminator')).toBe('\n');
    expect(lineEndingOf('')).toBe('\n');
    expect(lineEndingOf(['a\r\n', 'b\r\n', 'c\n'])).toBe('\r\n');
  });

  it('restoreLineEndings gives a one-ending file back in that ending', async () => {
    const { restoreLineEndings } = await loadTextIo();
    const original = 'a\r\nb\r\n';
    expect(restoreLineEndings('a\nx\nb\ny\n', original)).toBe('a\r\nx\r\nb\r\ny\r\n');
    expect(restoreLineEndings('a\nb\n', 'a\rb\r')).toBe('a\rb\r');
  });

  it('restoreLineEndings is the identity for an LF original, byte for byte', async () => {
    const { restoreLineEndings } = await loadTextIo();
    const out = 'x\n\ny\r\nz';
    expect(restoreLineEndings(out, 'p\nq\n')).toBe(out);
    expect(restoreLineEndings(out, 'no terminator')).toBe(out);
    expect(restoreLineEndings(out, '')).toBe(out);
  });

  it('restoreLineEndings leaves an unterminated last line unterminated, and terminates a line that gained a successor', async () => {
    const { restoreLineEndings } = await loadTextIo();
    expect(restoreLineEndings('a\nb', 'a\r\nb')).toBe('a\r\nb');
    expect(restoreLineEndings('a\nb\nc', 'a\r\nb')).toBe('a\r\nb\r\nc');
  });

  it('restoreLineEndings keeps each unchanged line its own ending on a mixed file, pairing repeats in order', async () => {
    const { restoreLineEndings } = await loadTextIo();
    // Two blank lines: the first CRLF, the second LF. A new line takes the majority (CRLF).
    const original = 'h\r\n\r\nx\r\n\ny\r\n';
    expect(restoreLineEndings('h\n\nx\nnew\n\ny\n', original)).toBe('h\r\n\r\nx\r\nnew\r\n\ny\r\n');
    // A third blank line has no partner and takes the majority.
    expect(restoreLineEndings('h\n\nx\n\ny\n\n', original)).toBe('h\r\n\r\nx\r\n\ny\r\n\r\n');
    // Removing a line leaves every other line as it was.
    expect(restoreLineEndings('h\n\n\ny\n', original)).toBe('h\r\n\r\n\ny\r\n');
  });

  it('restoreLineEndings pairs lines across several originals (a layout migration)', async () => {
    const { restoreLineEndings } = await loadTextIo();
    expect(restoreLineEndings('a\nb\nc\n', ['a\r\n', 'b\n', 'c\r\n'])).toBe('a\r\nb\nc\r\n');
  });

  it('readDocument hands on LF text and the original, and restoring the edit gives a CRLF file back', async () => {
    const { readDocument, readDocumentText, restoreLineEndings } = await loadTextIo();
    const file = path.join(SCRATCH, 't1-doc.md');
    fs.writeFileSync(file, '---\r\nid: X\r\n---\r\nbody\r\n');
    const doc = readDocument(file);
    expect(doc.text).toBe('---\nid: X\n---\nbody\n');
    expect(doc.original).toBe('---\r\nid: X\r\n---\r\nbody\r\n');
    expect(readDocumentText(file)).toBe(doc.text);
    fs.writeFileSync(file, restoreLineEndings(doc.text.replace('body', 'body\nmore'), doc.original));
    expect(fs.readFileSync(file, 'utf-8')).toBe('---\r\nid: X\r\n---\r\nbody\r\nmore\r\n');
  });

  it('restoreLineEndings treats a carriage return inside the LF text as content', async () => {
    const { restoreLineEndings } = await loadTextIo();
    // CRLF original: the stray CR stays in its line, and the line still gets one ending.
    expect(restoreLineEndings('a\nb\rc\n', 'a\r\n')).toBe('a\r\nb\rc\r\n');
  });
});
