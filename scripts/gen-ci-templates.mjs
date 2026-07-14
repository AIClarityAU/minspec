#!/usr/bin/env node
/**
 * gen-ci-templates.mjs — regenerates packages/minspec/src/lib/ci-review-templates.ts
 * from the repo's own working CI-review stack (AIClarityAU/minspec#564, #678).
 *
 * PROBLEM THIS CLOSES: ci-review-templates.ts base64-embeds byte-exact copies of
 * .github/workflows/ai-review.yml, scripts/review-branch.sh, scripts/roles/*, etc.
 * so a scaffolded repo gets a WORKING CI-review stack. Editing any of those source
 * files without hand-regenerating the embedded copy silently drifts it — the
 * `ci-stack-portability` vitest suite is the only gate, and it only runs on push/PR,
 * so the drift lands on main before anyone notices (3 recurrences: #453→#619,
 * #619→#635, an ai-review.yml comment edit→#675). This script — plus the sibling
 * staleness check in scripts/validate-frontmatter.ts (`npm run validate`, wired
 * into CI's `lint` job on every PR) — turns that into a commit/PR-time error with
 * a one-command fix instead of a silent main breakage.
 *
 * Usage:
 *   node scripts/gen-ci-templates.mjs           # regenerate + overwrite the .ts file
 *   node scripts/gen-ci-templates.mjs --check    # exit 1 if the committed file is stale (no write)
 *
 * Also exports `generateCiReviewTemplates(repoRoot)` (pure — no I/O side effects
 * beyond reading the source files) so scripts/validate-frontmatter.ts can run the
 * identical check without shelling out to a child process.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, '..');
const OUTPUT_PATH = 'packages/minspec/src/lib/ci-review-templates.ts';
const LINE_WIDTH = 100;

// Mirrors CI_STACK in packages/minspec/tests/managed-region-templates.test.ts —
// keep both lists in sync if the embedded stack grows (#564).
const SOURCES = [
  {
    constName: 'AI_REVIEW_WORKFLOW',
    srcPath: '.github/workflows/ai-review.yml',
    doc: 'Verbatim body of `.github/workflows/ai-review.yml`.',
    stripShebang: false,
  },
  {
    constName: 'READY_TO_MERGE_WORKFLOW',
    srcPath: '.github/workflows/ready-to-merge.yml',
    doc: 'Verbatim body of `.github/workflows/ready-to-merge.yml`.',
    stripShebang: false,
  },
  {
    constName: 'AI_REVIEW_RETRY_WORKFLOW',
    srcPath: '.github/workflows/ai-review-retry.yml',
    doc: 'Verbatim body of `.github/workflows/ai-review-retry.yml`.',
    stripShebang: false,
  },
  {
    constName: 'REVIEW_BRANCH_SH',
    srcPath: 'scripts/review-branch.sh',
    doc: 'Verbatim body of `scripts/review-branch.sh` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
  {
    constName: 'REVIEW_DECIDE_SH',
    srcPath: 'scripts/review-decide.sh',
    doc: 'Verbatim body of `scripts/review-decide.sh` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
  {
    constName: 'ROLE_REVIEWER_MD',
    srcPath: 'scripts/roles/reviewer.md',
    doc: 'Verbatim body of `scripts/roles/reviewer.md`.',
    stripShebang: false,
  },
  {
    constName: 'ROLE_SECURITY_MD',
    srcPath: 'scripts/roles/security.md',
    doc: 'Verbatim body of `scripts/roles/security.md`.',
    stripShebang: false,
  },
  {
    constName: 'ROLE_ARCHITECT_MD',
    srcPath: 'scripts/roles/architect.md',
    doc: 'Verbatim body of `scripts/roles/architect.md`.',
    stripShebang: false,
  },
  {
    constName: 'ROLE_SKEPTIC_MD',
    srcPath: 'scripts/roles/skeptic.md',
    doc: 'Verbatim body of `scripts/roles/skeptic.md`.',
    stripShebang: false,
  },
  {
    constName: 'AI_REVIEW_GUARD_JS',
    srcPath: '.github/scripts/ai-review-guard.js',
    doc: 'Verbatim body of `.github/scripts/ai-review-guard.js`.',
    stripShebang: false,
  },
];

const HEADER_LINES = [
  '/**',
  ' * ci-review-templates.ts — verbatim, byte-exact copies of the never-wrong',
  ' * required-check CI stack (AIClarityAU/minspec#564), embedded so the harness',
  ' * scaffolder can write them into ANY MinSpec-initialized repo.',
  ' *',
  ' * WHY base64 (not a template literal): the source files are dense with GitHub',
  ' * Actions `${{ … }}` expressions, backticks, shell `${VAR}` expansions and',
  ' * regex backslashes. Hand-escaping ~90 KB of that into TS template literals is a',
  ' * correctness hazard — a single missed escape silently corrupts a scaffolded file',
  ' * and breaks portability (issue #564 invariant 1). base64\'s alphabet needs zero',
  ' * escaping, so the embedded copy is guaranteed byte-identical to the repo\'s own',
  ' * working file. The `ci-stack-portability` test decodes each constant and asserts',
  ' * equality against the on-disk source, so drift is caught, and the copy is proven',
  ' * to be exactly the file the minspec repo itself runs in CI.',
  ' *',
  ' * Decoding is offline + deterministic (Buffer, no network) — Tier-0 safe (DR-004).',
  ' *',
  ' * GENERATED from the repo\'s real `.github/workflows/*` + `scripts/*` by',
  ' * scripts/gen-ci-templates.mjs (#678). Do not hand-edit the base64 blobs — run',
  ' * `node scripts/gen-ci-templates.mjs` to regenerate. `npm run validate` fails',
  ' * with a stale-file error (and the fix command) if this file drifts from that.',
  ' */',
  '',
  '/** Decode a base64-embedded template back to its exact UTF-8 source bytes. */',
  'function decode(b64: string): string {',
  "  return Buffer.from(b64, 'base64').toString('utf8');",
  '}',
  '',
  '/** Shebang line the two scaffolded review scripts carry on line 1. */',
  "export const REVIEW_SCRIPT_SHEBANG = '#!/usr/bin/env bash';",
].join('\n');

function wrapBase64(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += LINE_WIDTH) {
    lines.push(b64.slice(i, i + LINE_WIDTH));
  }
  return lines;
}

function encodeConst({ constName, srcPath, doc, stripShebang }, repoRoot) {
  let content = readFileSync(join(repoRoot, srcPath), 'utf8');
  if (stripShebang) {
    const nl = content.indexOf('\n');
    content = content.slice(nl + 1);
  }
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const lines = wrapBase64(b64);
  const body = lines
    .map((line, i) => `  '${line}'${i === lines.length - 1 ? ',' : ' +'}`)
    .join('\n');
  return `/** ${doc} */\nexport const ${constName}: string = decode(\n${body}\n);\n`;
}

/** Pure: read the repo's working CI-review stack and render the embedded-copy file. */
export function generateCiReviewTemplates(repoRoot) {
  const blocks = SOURCES.map((source) => encodeConst(source, repoRoot));
  return `${HEADER_LINES}\n\n${blocks.join('\n')}\n`;
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  const checkOnly = process.argv.includes('--check');
  const outFull = join(DEFAULT_REPO_ROOT, OUTPUT_PATH);
  const generated = generateCiReviewTemplates(DEFAULT_REPO_ROOT);

  if (checkOnly) {
    const onDisk = readFileSync(outFull, 'utf8');
    if (onDisk !== generated) {
      console.error(`STALE: ${OUTPUT_PATH} does not match the regenerated output.`);
      console.error('Run: node scripts/gen-ci-templates.mjs');
      process.exit(1);
    }
    console.log(`${OUTPUT_PATH} is up to date.`);
  } else {
    writeFileSync(outFull, generated, 'utf8');
    console.log(`Regenerated ${OUTPUT_PATH}`);
  }
}

export { OUTPUT_PATH, SOURCES };
