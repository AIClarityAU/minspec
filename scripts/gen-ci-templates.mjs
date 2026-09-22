#!/usr/bin/env node
/**
 * gen-ci-templates.mjs — regenerates the extension's base64-embedded copies of the
 * harness files this repo itself runs: ci-review-templates.ts from the CI-review
 * stack (AIClarityAU/minspec#564, #678), and hook-templates.ts from the Claude Code
 * hooks under .claude/hooks/ (#1093).
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
 *   node scripts/gen-ci-templates.mjs           # regenerate + overwrite the .ts files
 *   node scripts/gen-ci-templates.mjs --check    # exit 1 if a committed file is stale (no write)
 *
 * Also exports `generateAll(repoRoot)` (pure — no I/O side effects beyond reading the
 * source files) so scripts/validate-frontmatter.ts can run the identical check over
 * every generated file without shelling out to a child process.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, '..');
const OUTPUT_PATH = 'packages/minspec/src/lib/ci-review-templates.ts';
const HOOK_OUTPUT_PATH = 'packages/minspec/src/lib/hook-templates.ts';
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
    constName: 'SECRET_SCAN_WORKFLOW',
    srcPath: '.github/workflows/secret-scan.yml',
    doc: 'Verbatim body of `.github/workflows/secret-scan.yml`.',
    stripShebang: false,
  },
  {
    constName: 'DOCS_LANE_WORKFLOW',
    srcPath: '.github/workflows/docs-lane.yml',
    doc: 'Verbatim body of `.github/workflows/docs-lane.yml`.',
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
    // Registered for DRIFT GATING, not for shipping (#1502). These three are the last
    // consumers of the verdict channel outside review-branch.sh, and DR-079 requires all
    // of them to speak the structured contract. Embedding them here means
    // `gen-ci-templates.mjs --check` fails the moment a shipped script and its embedded
    // copy diverge, instead of the divergence being found later by a reader.
    //
    // Registration here does NOT scaffold them into adopter repos: what an adopter
    // receives is the separate explicit list in packages/minspec/src/lib/template-registry.ts,
    // and these are deliberately absent from it. They are dev-time dispatch for THIS
    // monorepo (see CLAUDE.md), so shipping them would widen MinSpec's blast radius past
    // the project it is installed in — constitution invariant 3.
    constName: 'REVIEW_PR_SH',
    srcPath: 'scripts/review-pr.sh',
    doc: 'Verbatim body of `scripts/review-pr.sh` (shebang stripped — supplied via preamble). Drift-gated only; not scaffolded.',
    stripShebang: true,
  },
  {
    constName: 'REVIEW_APPROVABLE_SH',
    srcPath: 'scripts/review-approvable.sh',
    doc: 'Verbatim body of `scripts/review-approvable.sh` (shebang stripped — supplied via preamble). Drift-gated only; not scaffolded.',
    stripShebang: true,
  },
  {
    constName: 'ROLE_APPROVABLE_REVIEWER_MD',
    srcPath: 'scripts/roles/approvable-reviewer.md',
    doc: 'Verbatim body of `scripts/roles/approvable-reviewer.md`. Drift-gated only; not scaffolded.',
    stripShebang: false,
  },
  {
    // review-branch.sh SOURCES this at startup. Same dependency-chain lesson as
    // APPROVAL_PROVENANCE_PY below: shipping the caller without the callee breaks
    // every consuming repo. Here it would be worse than degraded — the source is
    // deliberately unguarded (no `[[ -f ]]` fallback), so a missing lib aborts
    // review-branch.sh outright. It must ship with its dependant.
    constName: 'AGENT_CONTEXT_SH',
    srcPath: 'scripts/lib/agent-context.sh',
    doc: 'Verbatim body of `scripts/lib/agent-context.sh` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
  {
    // review-branch.sh CALLS this. Shipping the caller without the callee left every
    // consuming repo with plumbing that silently degrades to empty — the #1017
    // provenance fix was inert everywhere but this repo (AIClarityAU/sealbox#32).
    constName: 'APPROVAL_PROVENANCE_PY',
    srcPath: 'scripts/approval-provenance.py',
    doc: 'Verbatim body of `scripts/approval-provenance.py` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
  {
    // approval-provenance.py IMPORTS this (via `sys.path.insert(… 'hooks')`). Second
    // level of the same dependency chain — shipping the importer without the imported
    // module raises ModuleNotFoundError at load. stdlib-only, so it needs nothing further.
    constName: 'CANONICAL_PY',
    srcPath: 'scripts/hooks/canonical.py',
    doc: 'Verbatim body of `scripts/hooks/canonical.py` (shebang stripped — supplied via preamble).',
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
  {
    // SHIPPED with the guard above, not merely drift-gated (#871). The guard is
    // security-critical decision logic and its own header points a reader at this
    // suite — a claim that was false in every repo but this one, because the guard
    // shipped alone. An enumeration with no entry for a file holds no predicate over
    // it, so a guard change could not red any gate on a stale or absent downstream
    // test. Measured twice: scroogellm carried a 568-line copy that went stale the
    // moment the guard's most-recent-by-`created_at` reducer advanced (scrooge#82),
    // and sealbox merged the guard with NO test file at all (sealbox#18) — both green.
    // Registering it here byte-syncs the pair, so guard and test can no longer drift.
    constName: 'AI_REVIEW_GUARD_TEST_JS',
    srcPath: '.github/scripts/ai-review-guard.test.js',
    doc: 'Verbatim body of `.github/scripts/ai-review-guard.test.js`.',
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
  '',
  '/** Shebang line the scaffolded approval-provenance helper carries on line 1. */',
  "export const PY_SCRIPT_SHEBANG = '#!/usr/bin/env python3';",
].join('\n');

// Mirrors HOOK_STACK in packages/minspec/tests/managed-region-templates.test.ts —
// keep both lists in sync if the embedded hook stack grows (#1093).
const HOOK_SOURCES = [
  {
    constName: 'SESSION_TITLE_SH',
    srcPath: '.claude/hooks/session-title.sh',
    doc: 'Verbatim body of `.claude/hooks/session-title.sh` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
  {
    constName: 'SESSION_TITLE_PY',
    srcPath: '.claude/hooks/session-title.py',
    doc: 'Verbatim body of `.claude/hooks/session-title.py` (shebang stripped — supplied via preamble).',
    stripShebang: true,
  },
];

const HOOK_HEADER_LINES = [
  '/**',
  ' * hook-templates.ts — verbatim, byte-exact copies of the Claude Code hooks this',
  " * repo itself runs, embedded so the harness scaffolder can write them into any",
  ' * MinSpec-initialized project that uses Claude Code (AIClarityAU/minspec#1093).',
  ' *',
  ' * WHY base64 (not a template literal): the wrapper is dense with shell `${VAR}`',
  ' * expansions (`${BASH_SOURCE[0]}`, `${MINSPEC_SESSION_TITLE_OFF:-0}`) — every one',
  ' * of which a TS template literal would read as an interpolation — and the Python',
  ' * hook is dense with regex backslashes. Hand-escaping that is a correctness hazard:',
  ' * one missed escape silently corrupts a scaffolded hook. base64 needs zero escaping,',
  " * so the embedded copy is byte-identical to this repo's own working file.",
  ' *',
  ' * Decoding is offline + deterministic (Buffer, no network) — Tier-0 safe (DR-004).',
  ' *',
  " * GENERATED from the repo's real `.claude/hooks/*` by scripts/gen-ci-templates.mjs.",
  ' * Do not hand-edit the base64 blobs — run `node scripts/gen-ci-templates.mjs` to',
  ' * regenerate. `npm run validate` fails with a stale-file error (and the fix command)',
  ' * if this file drifts from that.',
  ' */',
  '',
  '/** Decode a base64-embedded template back to its exact UTF-8 source bytes. */',
  'function decode(b64: string): string {',
  "  return Buffer.from(b64, 'base64').toString('utf8');",
  '}',
  '',
  '/** Shebang the scaffolded session-title wrapper carries on line 1. */',
  "export const SESSION_TITLE_SH_SHEBANG = '#!/usr/bin/env bash';",
  '',
  '/** Shebang the scaffolded session-title hook carries on line 1. */',
  "export const SESSION_TITLE_PY_SHEBANG = '#!/usr/bin/env python3';",
].join('\n');

function wrapBase64(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += LINE_WIDTH) {
    lines.push(b64.slice(i, i + LINE_WIDTH));
  }
  return lines;
}

/**
 * Read one registered managed source — FAIL CLOSED (constitution invariant 2).
 *
 * Every staleness gate over the embedded copies runs through here, so an unreadable
 * source means the freshness of that copy is UNKNOWN. "Unknown" must not be spelt the
 * same as "fresh": a bare ENOENT propagating out of `readFileSync` says nothing about
 * why the file was wanted, which is how a swallowed read turns into a silent pass
 * upstream. The message names the file, the reason, and both legitimate fixes.
 */
function readRegisteredSource(srcPath, repoRoot) {
  try {
    return readFileSync(join(repoRoot, srcPath), 'utf8');
  } catch (error) {
    throw new Error(
      `gen-ci-templates: registered managed source ${srcPath} could not be read ` +
        `(${error.message}). Its embedded copy therefore cannot be verified or ` +
        `regenerated. Restore the file, or remove its entry from SOURCES/HOOK_SOURCES ` +
        `and from MANAGED_REGION_TEMPLATES if it is no longer shipped.`,
    );
  }
}

function encodeConst({ constName, srcPath, doc, stripShebang }, repoRoot) {
  let content = readRegisteredSource(srcPath, repoRoot);
  if (stripShebang) {
    const nl = content.indexOf('\n');
    content = content.slice(nl + 1);
  }
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const lines = wrapBase64(b64);
  // A JOINED ARRAY, not a `'a' + 'b' + ...` chain (#1284). A concatenation chain parses to
  // a left-nested BinaryExpression one level deep per chunk, so ESLint's recursive-descent
  // parser blows its stack once a source file gets big enough — `Parsing error: Maximum
  // call stack size exceeded`, with no hint that the cause is file SIZE. That is a scaling
  // cliff: it fires on whoever happens to push the workflow edit that crosses it, which was
  // this PR's ~13 added comment lines. An array literal is FLAT — depth 1 regardless of
  // length — so the cliff cannot return. `.join('')` is exact: no separator, no re-encoding.
  const body = lines.map((line) => `    '${line}',`).join('\n');
  return `/** ${doc} */\nexport const ${constName}: string = decode(\n  [\n${body}\n  ].join(''),\n);\n`;
}

function render({ header, sources }, repoRoot) {
  const blocks = sources.map((source) => encodeConst(source, repoRoot));
  return `${header}\n\n${blocks.join('\n')}\n`;
}

/**
 * Every generated embedded-template file this script owns. Anything added here is
 * regenerated, `--check`ed, and staleness-gated by `npm run validate` for free —
 * a second generator (and a second gate to forget) is never needed.
 */
const GENERATED_FILES = [
  { outputPath: OUTPUT_PATH, header: HEADER_LINES, sources: SOURCES },
  { outputPath: HOOK_OUTPUT_PATH, header: HOOK_HEADER_LINES, sources: HOOK_SOURCES },
];

/**
 * Every repo-relative path this generator reads, across all generated files, in
 * registration order.
 *
 * Exported so a gate can walk EXACTLY the set the embedded copies are generated from
 * rather than re-typing it (#871 — the defect being closed was precisely a hand-kept
 * enumeration that omitted a file, and nothing noticed because nothing else knew the
 * set). Derived from `GENERATED_FILES`, so it can never drift from what is generated.
 */
export const CI_TEMPLATE_SOURCE_PATHS = Object.freeze(
  GENERATED_FILES.flatMap((file) => file.sources.map((source) => source.srcPath)),
);

/**
 * Every repo-relative path this generator WRITES. Exported as the applicability test
 * for the staleness gate: the presence of a generated file is what makes the rule apply
 * to a tree at all, and once it applies an unreadable source is a failure rather than a
 * reason to go quiet. Reading the outputs (not `process.cwd()`'s name, and not whether
 * the sources happen to exist) keeps "this is not that repo" and "this repo is broken"
 * as two different answers.
 */
export const CI_TEMPLATE_OUTPUT_PATHS = Object.freeze(
  GENERATED_FILES.map((file) => file.outputPath),
);

/** Pure: read the repo's working CI-review stack and render the embedded-copy file. */
export function generateCiReviewTemplates(repoRoot) {
  return render(GENERATED_FILES[0], repoRoot);
}

/** Pure: read the repo's working Claude Code hooks and render the embedded-copy file. */
export function generateHookTemplates(repoRoot) {
  return render(GENERATED_FILES[1], repoRoot);
}

/**
 * Pure: render EVERY generated file as `{ outputPath, content }`. The staleness
 * check in scripts/validate-frontmatter.ts iterates this, so a newly-added entry
 * is gated without touching the validator.
 */
export function generateAll(repoRoot) {
  return GENERATED_FILES.map((file) => ({
    outputPath: file.outputPath,
    content: render(file, repoRoot),
  }));
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  const checkOnly = process.argv.includes('--check');
  let stale = false;

  for (const { outputPath, content } of generateAll(DEFAULT_REPO_ROOT)) {
    const outFull = join(DEFAULT_REPO_ROOT, outputPath);
    if (checkOnly) {
      const onDisk = readFileSync(outFull, 'utf8');
      if (onDisk !== content) {
        console.error(`STALE: ${outputPath} does not match the regenerated output.`);
        stale = true;
      } else {
        console.log(`${outputPath} is up to date.`);
      }
    } else {
      writeFileSync(outFull, content, 'utf8');
      console.log(`Regenerated ${outputPath}`);
    }
  }

  if (stale) {
    console.error('Run: node scripts/gen-ci-templates.mjs');
    process.exit(1);
  }
}

export { OUTPUT_PATH, SOURCES, HOOK_OUTPUT_PATH, HOOK_SOURCES };
