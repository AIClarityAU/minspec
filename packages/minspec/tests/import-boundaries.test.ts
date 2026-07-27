/**
 * SPEC-040 FR-1 / FR-3 — the layer-import gate (AC-1, AC-2, AC-3, AC-5).
 *
 * These tests run the REAL `eslint.config.mjs` through the ESLint Node API — no
 * re-declared copy of the rules — so a config edit that weakens the boundary
 * fails here rather than passing a test of its own private fixture config.
 *
 * Two shapes of assertion, deliberately:
 *
 *   1. Fixture lints (`lintText`) pin the RULE semantics from both sides — the
 *      forbidden edge errors AND the allowed edge does not. A one-sided gate
 *      that reports everything, or nothing, is the classic silent gate (DR-066).
 *   2. A real-tree lint (`lintFiles` over `packages/minspec/src/lib/**`) pins the
 *      SHIPPED state: zero direction errors, and exactly the seven known
 *      vscode-coupled files at `warn` (AC-3/AC-5). That count is what makes the
 *      `warn` -> `error` flip at #830 a one-line, test-verified change.
 *
 * `lintText` is given the path of a REAL file under `src/lib/`. That is required,
 * not incidental: `parserOptions.projectService` resolves each linted path inside
 * the package's TypeScript project, and a path with no file behind it fails to
 * parse. `lintText` supplies the buffer content (exactly what an editor does for
 * an unsaved file), so the host file's own contents are never read — any real
 * `lib/` file would serve.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** FR-1 direction + depth rules, at `error`. */
const LAYER_RULE = '@typescript-eslint/no-restricted-imports';
/**
 * FR-3 vscode purity, at `warn`. A distinct rule name because flat config
 * replaces (never merges) options for a repeated rule name, and these two need
 * different severities on the same files — see the comment in eslint.config.mjs.
 */
const VSCODE_RULE = 'tier0/no-restricted-imports';

/**
 * Any real file under `src/lib/` works as the fixture host (its contents are
 * never read — see the file header). If this path ever moves, repoint it at
 * another `src/lib/` file; the assertion below says so on failure.
 */
const LIB_HOST = 'packages/minspec/src/lib/spec.ts';
/** A real file in the UI layer — used to prove the lib-scoped rules stay scoped. */
const VIEWS_HOST = 'packages/minspec/src/views/status-bar.ts';
/** Real files in the two exempt trees (FR-1 `ignores`). */
const TEST_TREE_HOST = 'packages/minspec/src/test/views.test.ts';
const BENCH_TREE_HOST = 'packages/minspec/src/__benchmarks__/perf.bench.ts';

/**
 * The seven `lib/` files that import `vscode` by VALUE today (DR-064 Context).
 * `lib/presence.ts` imports it TYPE-ONLY and is deliberately absent — that
 * carve-out is why this list is 7 and not 8.
 */
const EXPECTED_VSCODE_WARN_FILES = [
  'packages/minspec/src/lib/active-adr.ts',
  'packages/minspec/src/lib/active-spec.ts',
  'packages/minspec/src/lib/ai-usage-detector.ts',
  'packages/minspec/src/lib/approval-diff.ts',
  'packages/minspec/src/lib/bridge.ts',
  'packages/minspec/src/lib/diagnostics.ts',
  'packages/minspec/src/lib/resolve-folder.ts',
];

const TYPE_ONLY_VSCODE_FILE = 'packages/minspec/src/lib/presence.ts';

/** Linting the real tree with a type-aware parser is seconds, not milliseconds. */
const LINT_TIMEOUT = 120_000;

const rel = (absolute: string): string =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

/**
 * Separate instances so fixture buffers can never influence the real-tree scan.
 */
const fixtureEslint = new ESLint({ cwd: REPO_ROOT });
const treeEslint = new ESLint({ cwd: REPO_ROOT });

/**
 * Lint a synthetic module as if it were `hostFile`.
 *
 * A parse failure is raised, never returned: several assertions below are
 * "produces no diagnostics", and a fixture that failed to parse produces no
 * diagnostics too. Swallowing that would turn every negative assertion into a
 * vacuous pass — a silent gate in the gate's own test (DR-066).
 */
async function lintFixture(code: string, hostFile: string): Promise<Linter.LintMessage[]> {
  const results = await fixtureEslint.lintText(code, {
    filePath: path.join(REPO_ROOT, hostFile),
  });
  const messages = results[0]?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal);
  if (fatal.length > 0) {
    throw new Error(
      `fixture failed to parse as ${hostFile}: ${fatal.map((m) => m.message).join('; ')}`,
    );
  }
  return messages;
}

const errorsOf = (messages: Linter.LintMessage[], ruleId: string): Linter.LintMessage[] =>
  messages.filter((m) => m.severity === 2 && m.ruleId === ruleId);

const warningsOf = (messages: Linter.LintMessage[], ruleId: string): Linter.LintMessage[] =>
  messages.filter((m) => m.severity === 1 && m.ruleId === ruleId);

const describeAll = (messages: Linter.LintMessage[]): string =>
  messages.length === 0
    ? '(none)'
    : messages.map((m) => `${m.severity === 2 ? 'error' : 'warn'} ${m.ruleId}: ${m.message}`).join(' | ');

const valueImport = (specifier: string): string =>
  `import thing from '${specifier}';\nexport const used = thing;\n`;

describe('SPEC-040 — the fixture hosts these tests depend on exist', () => {
  it.each([LIB_HOST, VIEWS_HOST, TEST_TREE_HOST, BENCH_TREE_HOST])(
    '%s is a real file',
    (hostFile) => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, hostFile)),
        `${hostFile} is used as a lint fixture host and must exist (parserOptions.projectService ` +
          `cannot parse a path with no file behind it). If it moved, repoint the constant in this ` +
          `test at any other real file in the same directory.`,
      ).toBe(true);
    },
  );
});

describe('SPEC-040 FR-1 — lib must not import from views or commands (AC-1)', () => {
  it(
    'errors on a value import of ../views/*',
    async () => {
      const messages = await lintFixture(valueImport('../views/spec-tree-provider'), LIB_HOST);
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'errors on a TYPE-ONLY import of ../views/* too (OQ-2, allowTypeImports: false)',
    async () => {
      const messages = await lintFixture(
        "import type { SpecNode } from '../views/spec-tree-provider';\nexport type Alias = SpecNode;\n",
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'errors on an inline type specifier from ../views/* (import { type X })',
    async () => {
      const messages = await lintFixture(
        "import { type SpecNode } from '../views/spec-tree-provider';\nexport type Alias = SpecNode;\n",
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it.each([
    ['../views', 'the bare views directory'],
    ['../views/spec-tree-provider', 'a direct views module'],
    ['../views/nested/deep', 'a nested views module'],
    ['../commands', 'the bare commands directory'],
    ['../commands/approve', 'a direct commands module'],
    ['../../views/spec-tree-provider', 'a deep-relative escape'],
    ['../../../views/spec-tree-provider', 'a deeper-relative escape'],
    ['../../commands/approve', 'a deep-relative commands escape'],
    ['../../src/views/spec-tree-provider', 'an alternate spelling that re-enters src'],
  ])('errors on %s (%s)', async (specifier) => {
    const messages = await lintFixture(valueImport(specifier), LIB_HOST);
    expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
  }, LINT_TIMEOUT);

  it.each([
    ['./config', 'a sibling lib module'],
    ['node:fs', 'a node builtin'],
  ])('allows %s (%s)', async (specifier) => {
    const messages = await lintFixture(valueImport(specifier), LIB_HOST);
    expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(0);
  }, LINT_TIMEOUT);

  it(
    'does not apply the direction rule outside lib — views may import lib and vscode',
    async () => {
      const messages = await lintFixture(
        "import * as vscode from 'vscode';\nimport { loadConfig } from '../lib/config';\nexport const used = [vscode, loadConfig];\n",
        VIEWS_HOST,
      );
      expect(describeAll(messages)).toBe('(none)');
    },
    LINT_TIMEOUT,
  );
});

describe('SPEC-040 FR-1 — @aiclarity/shared is barrel-only (AC-2, DR-014)', () => {
  it.each([
    '@aiclarity/shared/src/next-task',
    '@aiclarity/shared/next-task',
    '@aiclarity/shared/a/b/c',
  ])('errors on the deep import %s', async (specifier) => {
    const messages = await lintFixture(valueImport(specifier), LIB_HOST);
    expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
  }, LINT_TIMEOUT);

  it(
    'errors on a deep type-only import as well',
    async () => {
      const messages = await lintFixture(
        "import type { NextTask } from '@aiclarity/shared/src/next-task';\nexport type Alias = NextTask;\n",
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'allows the bare @aiclarity/shared barrel',
    async () => {
      const messages = await lintFixture(
        "import { specHash } from '@aiclarity/shared';\nexport const used = specHash;\n",
        LIB_HOST,
      );
      expect(describeAll(messages)).toBe('(none)');
    },
    LINT_TIMEOUT,
  );

  it(
    // Named for what the fixture actually proves. The depth rule's real scope is
    // its glob, `packages/*/src/**/*.ts` — every package's `src`, inside `lib`
    // and out — and `VIEWS_HOST` sits in the "out" half. That is NOT repo-wide:
    // `scripts/**` and `packages/*/tests/**` (this file included) match no config
    // block and are never linted at all, so no fixture here can demonstrate
    // repo-wide reach. Widening the globs is real work, not a one-line edit —
    // those paths fall outside every package tsconfig, which the type-aware
    // `projectService` parser needs — so it is tracked separately rather than
    // papered over with a test name that overstates the coverage.
    'applies the depth rule outside lib, not just inside it',
    async () => {
      const messages = await lintFixture(valueImport('@aiclarity/shared/src/next-task'), VIEWS_HOST);
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it.each([TEST_TREE_HOST, BENCH_TREE_HOST])(
    'exempts %s from the layer rules',
    async (hostFile) => {
      const messages = await lintFixture(
        "import * as vscode from 'vscode';\nimport thing from '../views/spec-tree-provider';\nimport deep from '@aiclarity/shared/src/next-task';\nexport const used = [vscode, thing, deep];\n",
        hostFile,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(0);
      expect(warningsOf(messages, VSCODE_RULE), describeAll(messages)).toHaveLength(0);
    },
    LINT_TIMEOUT,
  );
});

describe('SPEC-040 FR-3 — lib stays vscode-free, at warn until #830', () => {
  it(
    'warns (not errors) on a value import of vscode',
    async () => {
      const messages = await lintFixture(
        "import * as vscode from 'vscode';\nexport const used = vscode;\n",
        LIB_HOST,
      );
      expect(warningsOf(messages, VSCODE_RULE), describeAll(messages)).toHaveLength(1);
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(0);
    },
    LINT_TIMEOUT,
  );

  it.each([
    ["import type * as vscode from 'vscode';\nexport type Alias = vscode.Uri;\n", 'namespace'],
    ["import type { Uri } from 'vscode';\nexport type Alias = Uri;\n", 'named'],
  ])(
    'does NOT warn on a type-only vscode import (%s form) — allowTypeImports: true is deliberate',
    async (code) => {
      const messages = await lintFixture(code, LIB_HOST);
      expect(describeAll(messages)).toBe('(none)');
    },
    LINT_TIMEOUT,
  );

  it(
    'reports BOTH rules on a file that violates both — proof the two severities coexist',
    async () => {
      // Regression guard for the flat-config merge trap: if these two rules are
      // ever collapsed back onto one rule name, the later block silently replaces
      // the earlier one and one of these two assertions goes to zero.
      const messages = await lintFixture(
        "import * as vscode from 'vscode';\nimport thing from '../views/spec-tree-provider';\nexport const used = [vscode, thing];\n",
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
      expect(warningsOf(messages, VSCODE_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );
});

/**
 * INV-4 says a layer violation is never silenced with an eslint-disable. Before
 * `linterOptions.noInlineConfig`, that was a sentence inside the rule messages
 * and nothing more: a disable comment suppressed the diagnostics completely, and
 * no hook or CI check rejected it. These tests pin the enforcement, because an
 * invariant that depends on everyone remembering it is the thing the repo's
 * "enforce, don't trust the model" rule exists to stop.
 */
describe('SPEC-040 INV-4 — an eslint-disable cannot silence the Tier-0 layer rules', () => {
  it(
    'does not let a targeted disable-next-line suppress the FR-1 direction error',
    async () => {
      const messages = await lintFixture(
        '// eslint-disable-next-line @typescript-eslint/no-restricted-imports\n' +
          valueImport('../views/spec-tree-provider'),
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'does not let a targeted disable-next-line suppress the FR-3 vscode warning',
    async () => {
      const messages = await lintFixture(
        "// eslint-disable-next-line tier0/no-restricted-imports\nimport * as vscode from 'vscode';\nexport const used = vscode;\n",
        LIB_HOST,
      );
      expect(warningsOf(messages, VSCODE_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'does not let a file-level eslint-disable suppress either rule',
    async () => {
      // The broadest hammer available: no rule named, whole file, both rules at
      // once. If this ever goes quiet, the escape hatch is back open.
      const messages = await lintFixture(
        "/* eslint-disable */\nimport * as vscode from 'vscode';\nimport thing from '../views/spec-tree-provider';\nexport const used = [vscode, thing];\n",
        LIB_HOST,
      );
      expect(errorsOf(messages, LAYER_RULE), describeAll(messages)).toHaveLength(1);
      expect(warningsOf(messages, VSCODE_RULE), describeAll(messages)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );

  it(
    'tells the author their disable comment is dead rather than ignoring it quietly',
    async () => {
      // Half of DR-066 is that a gate fails VISIBLY. An inert directive that
      // produced no feedback would leave the author believing the suppression
      // worked; ESLint reports the directive itself, so the config's answer is
      // legible at the point of the attempt.
      const messages = await lintFixture(
        '// eslint-disable-next-line @typescript-eslint/no-restricted-imports\n' +
          valueImport('../views/spec-tree-provider'),
        LIB_HOST,
      );
      const directiveNotices = messages.filter((m) => m.ruleId === null);
      expect(directiveNotices, describeAll(messages)).toHaveLength(1);
      expect(directiveNotices[0]!.message).toContain('noInlineConfig');
    },
    LINT_TIMEOUT,
  );

  it(
    'leaves inline directives working OUTSIDE lib — noInlineConfig is Tier-0-scoped',
    async () => {
      // `noInlineConfig` is a FILE-level option, so it is easy to widen by
      // accident to every linted file. It is set only on the two `lib/` blocks,
      // deliberately: the UI layers keep the normal escape hatch. Without this
      // assertion, someone hoisting the option to the shared block would silently
      // impose Tier-0's strictness on the whole tree and no test would object.
      const suppressed = await lintFixture(
        '// eslint-disable-next-line @typescript-eslint/no-restricted-imports\n' +
          valueImport('@aiclarity/shared/src/next-task'),
        VIEWS_HOST,
      );
      expect(describeAll(suppressed)).toBe('(none)');

      // Guard against that passing for the wrong reason — the same import with
      // no directive must still be an error, or the fixture proves nothing.
      const unsuppressed = await lintFixture(
        valueImport('@aiclarity/shared/src/next-task'),
        VIEWS_HOST,
      );
      expect(errorsOf(unsuppressed, LAYER_RULE), describeAll(unsuppressed)).toHaveLength(1);
    },
    LINT_TIMEOUT,
  );
});

describe('SPEC-040 — the shipped tree (AC-3, AC-5)', () => {
  let libResults: ESLint.LintResult[];

  beforeAll(async () => {
    libResults = await treeEslint.lintFiles(['packages/minspec/src/lib/**/*.ts']);
  }, LINT_TIMEOUT);

  it('actually linted the lib tree', () => {
    // Without this, every assertion below passes vacuously on an empty result set.
    expect(libResults.length).toBeGreaterThan(20);
    expect(libResults.map((r) => rel(r.filePath))).toContain(TYPE_ONLY_VSCODE_FILE);
  });

  it('has ZERO lib -> views/commands (or deep-shared) errors — the gate ships green', () => {
    const offenders = libResults
      .flatMap((result) =>
        errorsOf(result.messages, LAYER_RULE).map(
          (m) => `${rel(result.filePath)}:${m.line} ${m.message}`,
        ),
      )
      .sort();
    expect(
      offenders,
      'SPEC-040 FR-1 is an `error` rule that must be green on the shipped tree (AC-5). ' +
        'Fix the import direction — never an eslint-disable (INV-4).',
    ).toEqual([]);
  });

  it('warns on EXACTLY the seven known vscode-coupled lib files (AC-3)', () => {
    const warned = libResults
      .filter((result) => warningsOf(result.messages, VSCODE_RULE).length > 0)
      .map((result) => rel(result.filePath))
      .sort();
    expect(
      warned,
      'The FR-3 vscode warn set changed. If a file was relocated under #830, remove it from ' +
        'EXPECTED_VSCODE_WARN_FILES (and when the list empties, flip FR-3 to `error`). ' +
        'If a NEW file appeared, Tier-0 just gained a vscode dependency — reject it.',
    ).toEqual(EXPECTED_VSCODE_WARN_FILES);
  });

  it('does not warn on lib/presence.ts, whose vscode import is type-only', () => {
    const presence = libResults.find((r) => rel(r.filePath) === TYPE_ONLY_VSCODE_FILE);
    expect(presence, `${TYPE_ONLY_VSCODE_FILE} was not linted`).toBeDefined();
    expect(warningsOf(presence!.messages, VSCODE_RULE)).toHaveLength(0);

    // Guard against this passing for the wrong reason: it must still be the
    // type-only import that the carve-out spares, not a dropped import.
    const source = fs.readFileSync(path.join(REPO_ROOT, TYPE_ONLY_VSCODE_FILE), 'utf8');
    expect(
      /^import type .*from 'vscode';$/m.test(source),
      `${TYPE_ONLY_VSCODE_FILE} no longer type-imports vscode, so it no longer exercises the ` +
        'allowTypeImports carve-out. Point this test at another type-only vscode importer.',
    ).toBe(true);
  });
});
