#!/usr/bin/env node
//
// check-testing-panel-discovery.mjs — assert the VS Code Testing panel actually
// discovers the node:test suites we claim it does.
//
// WHY THIS EXISTS
//   Every previous statement about "what the Testing panel shows" was a claim about
//   an extension's internal glob behaviour that nothing could check. Two such claims
//   turned out to be false at once:
//
//     1. Per-folder `nodejs-testing.*` settings are INERT in a multi-root workspace.
//        The extension declares no `scope` on its properties, so VS Code registers
//        them as WINDOW scope, and a multi-root FolderConfiguration drops WINDOW-
//        scoped keys. Independently, the extension reads include/exclude via
//        `workspace.getConfiguration('nodejs-testing')` with NO resource argument,
//        so a folder value would never be consulted even if it survived. Both must
//        be true to explain it; both are.
//
//     2. picomatch is constructed WITHOUT `dot: true`, and `**/` will not traverse a
//        leading-dot path SEGMENT. So `.github/scripts/*.test.js` is undiscoverable
//        under the default include of `./` — in all three repos. (A leading-dot
//        BASENAME is fine; only a dot DIRECTORY blocks it.)
//
//   scripts/test-all.sh cannot catch either one: it invokes `node --test` with
//   explicit shell globs, so it stays green in exactly the state where the panel is
//   empty. This script closes that gap — it replicates the extension's own decision
//   and fails when a suite we expect in the panel would not appear.
//
// SCOPE
//   node:test discovery only. Vitest and Python have their own controllers with
//   different resolution rules; see EXPECTED below for what is deliberately not
//   covered here.
//
// USAGE
//   node scripts/check-testing-panel-discovery.mjs          # assert, exit 1 on gap
//   node scripts/check-testing-panel-discovery.mjs --list   # show what matched

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// picomatch is what the extension itself bundles and calls. Using the same library
// (rather than re-implementing glob semantics) is the point: a re-implementation
// would be a second thing that can drift from the extension.
const picomatch = require('picomatch');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const WORKSPACE_FILE = path.join(WORKSPACE_ROOT, 'minspecpro.code-workspace');

// The extension's default test-file specifiers, from its own bundle: Node's
// documented test-runner execution model.
const BASENAME_PATTERNS = ['test', 'test-*', '*.test', '*-test', '*_test'];
const EXTENSIONS = ['mjs', 'cjs', 'js'];

// What the Testing panel MUST show. Each entry is a workspace folder plus the
// repo-relative files that have to be discoverable. Keep this list honest: if a
// suite genuinely cannot appear, it belongs in KNOWN_GAPS with a reason, not here.
const EXPECTED = [
  { folder: 'MinSpecPro', files: ['.github/scripts/ai-review-guard.test.js'] },
  { folder: 'sealbox', files: ['.github/scripts/ai-review-guard.test.js'] },
  {
    folder: 'scroogellm',
    files: [
      '.github/scripts/ai-review-guard.test.js',
      'dogfood/tee-proxy/tests/tee.test.mjs',
      'dogfood/tee-proxy/tests/secret.test.mjs',
    ],
  },
];

// Suites with no Testing-panel controller on this editor. Listed so that "the panel
// shows everything" is never silently true-by-omission.
const KNOWN_GAPS = [
  'MinSpecPro packages/minspec/src/test/** (mocha extension-host) — needs ' +
    'ms-vscode.extension-test-runner, which is Marketplace-only and absent from Open VSX',
  'MinSpecPro .claude/hooks/test_session_title.py — outside the python controller\'s ' +
    'configured `-s scripts/hooks` discovery root',
  'MinSpecPro packages/minspec/tests/**/*.bench.ts — `vitest bench`, no controller',
];

function readJsonc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  // Strip // and /* */ comments outside strings. Sufficient for these hand-written
  // config files; not a general JSONC parser.
  let out = '';
  let inStr = false, inLine = false, inBlock = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], n = raw[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// Reproduce the extension's include -> picomatch pattern construction.
function buildMatcher(include, exclude) {
  const roots = include
    .map((p) => p.replace(/^\.\/?$/, '').replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((p) => !path.isAbsolute(p) && !p.startsWith('..'));

  const patterns = roots.flatMap((root) =>
    BASENAME_PATTERNS.map((b) =>
      // posix.join collapses '' to the bare pattern, which is what the default
      // include of './' produces.
      path.posix.join(root, `**/${b}.{${EXTENSIONS.join(',')}}`),
    ),
  );

  // dot:false is the whole point — this mirrors the extension, which does NOT pass
  // `dot: true`. Setting it here would make this checker green while the panel stays
  // empty, which is the exact failure it exists to prevent.
  return {
    patterns,
    isMatch: picomatch(patterns, { ignore: exclude, posixSlashes: true, dot: false }),
  };
}

// Resolve the config the extension would actually read, and say which one it is.
//
// There are two copies on purpose. Opened via minspecpro.code-workspace, only the
// workspace-level block is read (the folder-level keys are WINDOW-scoped and get
// dropped). Opened as a bare folder, the folder file IS the workspace config. Both
// are checked so neither can drift unverified — the earlier version only read the
// workspace copy while a comment in the folder file claimed this script verified it.
//
// A bare clone of just this repo has no parent workspace file at all. That is not a
// failure: test-all.sh promises to stay useful for someone who cloned only MinSpec,
// so a missing workspace file degrades to checking the folder copy alone.
function resolveConfigs() {
  const found = [];

  if (fs.existsSync(WORKSPACE_FILE)) {
    const ws = readJsonc(WORKSPACE_FILE);
    const s = ws.settings ?? {};
    found.push({
      label: `multi-root workspace (${path.basename(WORKSPACE_FILE)})`,
      include: s['nodejs-testing.include'] ?? ['./'],
      exclude: s['nodejs-testing.exclude'] ?? ['**/node_modules/**'],
      folders: EXPECTED.map((e) => e.folder),
    });
  } else {
    console.log(
      `note: ${path.basename(WORKSPACE_FILE)} not found beside this repo — ` +
        `checking the bare-folder config only.\n`,
    );
  }

  const folderSettings = path.join(REPO_ROOT, '.vscode', 'settings.json');
  if (fs.existsSync(folderSettings)) {
    const s = readJsonc(folderSettings);
    found.push({
      label: 'this repo opened as a bare folder (.vscode/settings.json)',
      include: s['nodejs-testing.include'] ?? ['./'],
      exclude: s['nodejs-testing.exclude'] ?? ['**/node_modules/**'],
      // A bare-folder open sees only this repo.
      folders: [path.basename(REPO_ROOT)],
    });
  }

  return found;
}

function main() {
  const listOnly = process.argv.includes('--list');
  const configs = resolveConfigs();

  if (configs.length === 0) {
    console.error('FAIL  no nodejs-testing configuration found in either location.');
    process.exit(1);
  }

  let failures = 0;
  let checked = 0;

  for (const cfg of configs) {
    console.log(`config: ${cfg.label}`);
    console.log(`  nodejs-testing.include = ${JSON.stringify(cfg.include)}`);
    console.log(`  nodejs-testing.exclude = ${JSON.stringify(cfg.exclude)}`);

    const { patterns, isMatch } = buildMatcher(cfg.include, cfg.exclude);
    console.log(`  -> ${patterns.length} picomatch pattern(s), dot:false\n`);

    for (const { folder, files } of EXPECTED) {
      if (!cfg.folders.includes(folder)) continue;
      const folderRoot = path.join(WORKSPACE_ROOT, folder);
      if (!fs.existsSync(folderRoot)) {
        console.log(`  SKIP  ${folder} — not checked out`);
        continue;
      }
      for (const rel of files) {
        checked++;
        const abs = path.join(folderRoot, rel);
        if (!fs.existsSync(abs)) {
          console.log(`  FAIL  ${folder}/${rel} — file does not exist`);
          failures++;
          continue;
        }
        const globMatched = isMatch(rel);
        // The extension also pre-checks the source for the specifier it imports; a
        // file that never imports node:test yields zero test items even if the glob
        // matches. Mirror that so a match here means a test really appears.
        const importsNodeTest = fs.readFileSync(abs, 'utf8').includes('node:test');

        if (globMatched && importsNodeTest) {
          if (listOnly) console.log(`  ok    ${folder}/${rel}`);
        } else {
          const why = !globMatched
            ? 'glob does NOT match (dot-directory? include root missing?)'
            : 'file does not import node:test';
          console.log(`  FAIL  ${folder}/${rel} — ${why}`);
          failures++;
        }
      }
    }
    console.log();
  }

  console.log(`known gaps (no Testing-panel controller):`);
  for (const g of KNOWN_GAPS) console.log(`  - ${g}`);

  console.log();
  if (failures > 0) {
    console.error(
      `FAIL  ${failures} of ${checked} expected node:test suite(s) would NOT appear in the Testing panel.`,
    );
    console.error(
      `      The usual cause is an include root that cannot reach a dot-directory:\n` +
        `      picomatch runs with dot:false, so "**/" never crosses ".github/".\n` +
        `      Fix: list ".github" explicitly in nodejs-testing.include (it REPLACES\n` +
        `      the default, so "./" must stay in the list too).`,
    );
    process.exit(1);
  }

  console.log(`PASS  all ${checked} expected node:test suite(s) are discoverable.`);
}

main();
