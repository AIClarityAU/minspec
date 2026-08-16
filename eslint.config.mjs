import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// ---------------------------------------------------------------------------
// SPEC-040 FR-1 / FR-3 — the layer-import contract, machine-enforced (DR-064).
//
// Allowed edges point DOWNWARD only:
//   lib        -> { lib, @aiclarity/shared (barrel only) }
//   views      -> { views, lib, shared, vscode }
//   commands   -> { commands, views, lib, shared, vscode }
//   extension.ts -> anything
// `src/test/**` and `src/__benchmarks__/**` are exempt — they legitimately
// import views/vscode. Loosening this set is an architectural change (a DR-064
// amendment), not a config tweak.
//
// KNOWN COVERAGE LIMIT — dynamic `import()` is NOT gated (#989). Every
// rule below keys off STATIC import specifiers: `no-restricted-imports` has no
// `ImportExpression` handler upstream, so `import('../views/x')` and
// `await import('vscode')` inside `lib/` produce ZERO diagnostics. That was
// measured against this config, not assumed. The companion FR-2 cycle checker
// (`lib/import-cycle-check.ts`) deliberately skips dynamic edges as well, so
// nothing else catches them either, and lazy `await import(...)` is a live
// idiom in this tree (`lib/git-analyzer.ts`, `commands/classify.ts`) rather
// than a hypothetical. Closing the gap is its own piece of work, tracked at
// #989 — it needs a rule that visits `ImportExpression`, not a wider
// pattern here. Until then read everything below as "the STATIC-import
// contract"; a gate that quietly under-covers is worse than one that states
// its edges (DR-066).
// ---------------------------------------------------------------------------

/** Files exempt from the layer rules (they legitimately reach into views/vscode). */
const LAYER_RULE_EXEMPT = ['**/src/test/**', '**/src/__benchmarks__/**'];

/**
 * DR-014: `@aiclarity/shared` is consumed through its barrel only. Deep imports
 * (`@aiclarity/shared/src/x`) bypass the package's public surface. Zero
 * violations today — this rule is preventive.
 */
const SHARED_BARREL_ONLY = {
  group: ['@aiclarity/shared/*', '@aiclarity/shared/**'],
  allowTypeImports: false,
  message:
    'Import from the `@aiclarity/shared` barrel, not a deep path (DR-014 — the barrel is the package boundary).',
};

/**
 * FR-1 direction rule: `lib` (Tier-0) imports NOTHING — value or type — from
 * the UI layers. `allowTypeImports: false` is deliberate (DR-064 §2 / OQ-2): a
 * type-only carve-out is a standing exception a later `type`->value edit can
 * silently exploit.
 *
 * Pattern groups use ESLint's gitignore-style matcher (the `ignore` package,
 * `allowRelativePaths: true`). The first four are the near forms named by
 * SPEC-040 FR-1; the `**` forms close the escapes those miss — verified by
 * `packages/minspec/tests/import-boundaries.test.ts`, not assumed:
 *   - deep-relative:      `../../views/x`, `../../../views/x`
 *   - alternate spelling: `../../src/views/x`
 * The `**` forms also match any non-relative specifier containing a `views/` or
 * `commands/` segment. That breadth is intentional inside `lib`, whose only
 * external specifiers are node builtins, `vscode` and `@aiclarity/shared`; a
 * future collision surfaces as a visible lint error, never a silent pass.
 *
 * The breadth reaches INSIDE `lib` too, which the "only external specifiers"
 * argument above does not cover, so state it as a decision rather than leave it
 * to be discovered: the two doubled-star `commands` forms in the group below
 * also match the RELATIVE `./commands/x`, so a `lib/commands/` subdirectory is
 * banned as well. That is wanted. Tier-0 owns no command layer — a directory of
 * that name inside `lib` would read as one and invite exactly the upward
 * coupling FR-1 exists to prevent. The patterns need a whole `commands` path
 * SEGMENT, so today's
 * `lib/slash-commands.ts` and `lib/command-references.ts` are unmatched
 * (verified against this config, not assumed) and stay legal. If a genuine
 * `lib/commands/` is ever wanted, that is a DR-064 amendment — not a pattern
 * tweak made in passing to unblock a build.
 */
const NO_UI_LAYER_FROM_LIB = {
  group: [
    '../views',
    '../views/*',
    '../commands',
    '../commands/*',
    '**/views',
    '**/views/**',
    '**/commands',
    '**/commands/**',
  ],
  allowTypeImports: false,
  message:
    'Tier-0 `lib/` must not import from `views/` or `commands/` (SPEC-040 FR-1, DR-064). Move the shared logic down into `lib/` instead of reaching up.',
};

/**
 * FR-3 vscode-purity rule, shipped at `warn` because 7 `lib/` files violate it
 * today; #830 relocates them and flips this to `error`.
 *
 * `allowTypeImports: true` here is DELIBERATE and load-bearing — it is why the
 * asserted warn count is 7 and not 8. `lib/presence.ts` imports `vscode`
 * TYPE-ONLY, which erases at compile time and therefore does not couple Tier-0
 * to the editor runtime at all; warning on it would be a false positive.
 *
 * The asymmetry vs FR-1 (`allowTypeImports: false`) is intentional, NOT an
 * oversight to be "harmonised": FR-1 bans an *architectural direction* (an
 * upward edge is wrong even when it erases, because a `type`->value flip
 * silently makes it real), while FR-3 bans a *runtime dependency* (which a
 * type-only import does not create).
 */
const NO_VSCODE_IN_LIB = {
  name: 'vscode',
  allowTypeImports: true,
  message:
    'Tier-0 `lib/` must stay vscode-free (SPEC-040 FR-3, DR-064). Type-only imports are allowed; a value import belongs in `views/` or `commands/`. Never silence this with an eslint-disable (SPEC-040 INV-4) — relocate the module (#830).',
};

/**
 * ESLint flat config REPLACES a rule's options when a later config block sets
 * the same rule name — it does not merge them. Both FR-1 (error) and FR-3
 * (warn) need `@typescript-eslint/no-restricted-imports` on the same `lib/`
 * files at DIFFERENT severities, which one rule name cannot express: the later
 * block would silently drop the earlier one (a silent gate — DR-066).
 *
 * So the identical rule implementation is registered under a second plugin key
 * for the `warn`-level FR-3 entry. Same rule, same `allowTypeImports` support,
 * distinct name — so both fire. `import-boundaries.test.ts` asserts a file that
 * violates both gets BOTH diagnostics, which is the regression test for anyone
 * who later tries to collapse these back into one rule name.
 *
 * CONSIDERED, AND REJECTED — the no-synthetic-plugin alternative. ESLint's CORE
 * `no-restricted-imports` is already a second, distinct rule name, so FR-1 could
 * ride core at `error` and leave FR-3 on the `@typescript-eslint` rule at
 * `warn`, needing no plugin object at all. That genuinely works: core reports
 * value imports, `import type` and inline `{ type X }` specifiers alike — which
 * is precisely the `allowTypeImports: false` behaviour FR-1 wants — and the
 * `@typescript-eslint` recommended set does not switch the core rule off. Both
 * facts were checked, not assumed.
 *
 * It loses on INTENT, not on behaviour. Core arrives at FR-1's semantics by
 * accident of implementation: it has no type awareness whatsoever, so "type-only
 * imports are banned too" is emergent, with no option available to pin it.
 * DR-064 §2 / OQ-2 decided that question deliberately, so the config should
 * DECLARE it — `allowTypeImports: false` is a commitment upstream has to keep
 * honouring and a test can name, whereas core's behaviour is merely what core
 * happens to do today. Splitting across two implementations would also make the
 * FR-1/FR-3 `allowTypeImports` asymmetry unreadable: a reviewer diffing the two
 * blocks could no longer tell whether they differ by policy or just because
 * they are different rules with different features.
 *
 * The price is one dependency on a plugin internal,
 * `tsPlugin.rules['no-restricted-imports']`. That risk is bounded and was
 * measured: with the key absent, ESLint throws while resolving the config
 * ("Could not find 'no-restricted-imports' in plugin 'tier0'") rather than
 * skipping the rule. It fails loudly at load, so an upstream rename can never
 * degrade FR-3 into a gate that is silently no longer there (DR-066).
 */
const tier0Plugin = {
  rules: { 'no-restricted-imports': tsPlugin.rules['no-restricted-imports'] },
};

export default [
  {
    // Flat config does NOT read .gitignore, so without this global ignore
    // `eslint .` enumerates/reads downloaded + build artifacts — notably the
    // multi-hundred-MB VS Code editor the integration tests download into
    // packages/minspec/.vscode-test/, which OOM-crashes lint (#257).
    ignores: ['**/.vscode-test/**', '**/out/**', '**/dist/**', '**/*.vsix'],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Type-aware linting (DR-064 §3). `projectService` is the stable,
        // documented form in @typescript-eslint v8 and picks up each package's
        // own tsconfig (packages/{minspec,shared}/tsconfig.json) automatically.
        // `tsconfigRootDir` pins resolution to this file's directory so lint
        // behaves identically from the repo root, a package dir, or the
        // programmatic ESLint API used by the boundary tests.
        //
        // R3 cost, measured — the number the Plan owed. `npm run lint` runs at a
        // median of 2.76s with value-only parsing vs 4.90s with
        // `projectService: true`: 3 runs each, ~1.8x, +2.1s absolute. R3's
        // escape hatch was to fall back to value-only rules if type-aware
        // parsing proved too slow to live with; two seconds is nowhere near
        // that, so type-aware stays. Re-measure before reopening this, and judge
        // on the absolute seconds rather than the multiplier: a ~1.8x ratio
        // reads alarming at any tree size, while the wait a developer actually
        // notices is the +2.1s.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // FR-1 (depth): `@aiclarity/shared` is barrel-only. Broadest scope of any
    // block here — every package's `src`, not just Tier-0 — but NOT repo-wide,
    // whatever "repo-wide" might suggest: `scripts/**` and `packages/*/tests/**`
    // match no block in this file and go unlinted entirely. Extending to them
    // needs more than a glob, since they sit outside every package tsconfig that
    // the type-aware parser resolves against; it is tracked separately.
    files: ['packages/*/src/**/*.ts'],
    ignores: LAYER_RULE_EXEMPT,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [SHARED_BARREL_ONLY] }],
    },
  },
  {
    // FR-1 (direction), Tier-0 only. This block RE-STATES the repo-wide depth
    // pattern because flat config replaces rather than merges rule options —
    // spreading the same constant keeps the two in lockstep by construction, so
    // a future repo-wide pattern cannot go missing on `lib/` alone.
    files: ['packages/minspec/src/lib/**/*.ts'],
    ignores: LAYER_RULE_EXEMPT,
    // INV-4 — "never silence a layer rule with an eslint-disable" — was, until
    // this line, only a sentence inside the rule MESSAGES. A rule that a human
    // or an agent has to remember to obey is a rule that drifts; the
    // constitution's standing answer is to enforce it rather than trust it.
    // Measured before adding this: an `// eslint-disable-next-line` naming
    // either rule, and a file-level `/* eslint-disable */`, each suppressed the
    // layer diagnostics completely, with no hook or CI check rejecting the
    // comment. `noInlineConfig` makes those directives inert, so the linter now
    // enforces INV-4 instead of asking for it.
    //
    // Note the scope: this is a FILE-level option, not a rule-level one, so no
    // inline directive works anywhere in Tier-0 now, for any rule. That breadth
    // is accepted deliberately — `grep -rn 'eslint-disable' packages/minspec/src`
    // is 0 today, so nothing regresses, and a future genuine need to suppress
    // something in `lib/` should surface as a visible edit to this config, where
    // it gets reviewed, rather than as a comment buried in a diff. Set on BOTH
    // `lib/` blocks so that deleting either one cannot quietly reopen the hatch.
    linterOptions: { noInlineConfig: true },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [SHARED_BARREL_ONLY, NO_UI_LAYER_FROM_LIB] },
      ],
    },
  },
  {
    // FR-3 — vscode purity in Tier-0, at `warn` until #830 lands.
    files: ['packages/minspec/src/lib/**/*.ts'],
    ignores: LAYER_RULE_EXEMPT,
    plugins: {
      tier0: tier0Plugin,
    },
    // INV-4 again, so this block enforces its own message rather than inheriting
    // the guarantee — the FR-3 message tells the reader not to reach for an
    // eslint-disable, and this is what makes that true. See the FR-1 direction
    // block above for the measurement and the file-level scope.
    linterOptions: { noInlineConfig: true },
    rules: {
      'tier0/no-restricted-imports': ['warn', { paths: [NO_VSCODE_IN_LIB] }],
    },
  },
  {
    // #1546 — the SPEC-025 FR-6 constitution advisory has exactly ONE emitter.
    //
    // It had two. `extension.ts` surfaced it with its offer-to-fix actions and the
    // per-workspace "Don't ask again" flag; `commands/init.ts` surfaced the same
    // string as a bare, actionless toast that structurally could not read that flag,
    // so it reinstated a dismissed nudge on every init and refresh. Nothing failed.
    //
    // Deleting the second emitter fixes the instance; this fixes the property. The
    // module is importable only where the actioned surface lives, so a third emitter
    // is a lint error rather than a thing a reviewer has to notice — the standing
    // answer of "enforce it, don't trust the model to remember it".
    //
    // Scoped to `src/**` so tests may still import the pure evaluator directly.
    files: ['packages/minspec/src/**/*.ts'],
    ignores: ['packages/minspec/src/extension.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/constitution-nudge', './lib/constitution-nudge', '../lib/constitution-nudge'],
              message:
                'The SPEC-025 FR-6 advisory has exactly one emitter: surfaceConstitutionProposeNudge in extension.ts (#1546). A second emitter cannot carry the offer actions or honour the "Don\'t ask again" flag, so it silently overrides the user. Surface it from extension.ts, or extend that function.',
            },
          ],
        },
      ],
    },
  },
];
