/**
 * Ruleset advisor (#356, reworked per DR-050 Amendment 2026-07-01).
 *
 * After `MinSpec: Initialize`, advise the user about a GitHub branch *ruleset*
 * that requires CI status checks (default `MinSpec SDD validation` — the job
 * name MinSpec's own scaffolded `.github/workflows/minspec-validate.yml`
 * reports) on the repo's default branch.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TIER-0 NETWORK BOUNDARY (load-bearing)
 * ──────────────────────────────────────────────────────────────────────────
 * MinSpec core "makes zero network calls in its core path." Every function in
 * this module that touches the network does so ONLY by shelling out to the
 * *user's own* authenticated `gh` CLI. MinSpec opens no socket itself — the same
 * posture by which it already shells `git`.
 *
 * Two distinct classes of network action live here, gated differently per
 * DR-050 (Amendment 2026-07-01):
 *
 *   - READ-ONLY CONFIG PROBE (autonomous) — {@link isGhReady} (probe the *local*
 *     `gh`) and {@link hasRequiredChecksRuleset} (a `gh api .../rulesets` GET of
 *     the repo's OWN settings). These egress NO user artifacts, spec content, or
 *     telemetry — they read the repo's own configuration, the same class as
 *     MinSpec shelling `git fetch`. They run AUTONOMOUSLY on init once `gh` is
 *     ready and the repo resolves; NO prior consent toast is required.
 *
 *   - MUTATING / EGRESSING ACTION (consent-gated) — {@link
 *     createRequiredChecksRuleset} (the `gh api -X POST .../rulesets` that WRITES
 *     a ruleset to the repo). This mutates the user's repository, so it fires
 *     ONLY on the user's explicit "Create ruleset" click — that click IS the
 *     consent for the mutation. Nothing writes autonomously.
 *
 * The ONLY toast shown is the single "create one?" offer — and only when the
 * autonomous probe finds NO qualifying ruleset. If one already exists the whole
 * flow is silent. The always-available fallback ({@link RULESET_DOCS_URL}) makes
 * zero network calls.
 *
 * Every MUTATING network action is consent-gated; the read-only probe is
 * autonomous. This is ratified by DR-050 (Amendment 2026-07-01).
 *
 * Purity / testability: the detection/creation functions never import
 * `child_process` at a call site — all process execution is funnelled through
 * an injected {@link CommandRunner}, so tests mock the runner and NEVER hit the
 * real network or create a real ruleset. The single sanctioned spawn point is
 * {@link defaultCommandRunner}, wired in only behind the post-init advisory.
 */

import { execFile } from 'child_process';

/** GitHub docs page on creating rulesets — the always-available, zero-network fallback. */
export const RULESET_DOCS_URL =
  'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository';

/**
 * DEFAULT status-check contexts the created ruleset requires on the default
 * branch when the user has not overridden them.
 *
 * Deliberately just `MinSpec SDD validation` — the single check context the
 * `validate` job in MinSpec's OWN scaffolded
 * `.github/workflows/minspec-validate.yml` reports (its `name:`, see
 * `MINSPEC_VALIDATE_WORKFLOW` in `template-registry.ts`). Earlier this default
 * was `['lint', 'test']`, which no MinSpec-scaffolded CI ever reports — a
 * required-but-never-satisfied context permanently blocks every PR/push to the
 * default branch (#559). `ready-to-merge` is intentionally EXCLUDED: it is
 * asserted by MinSpec's reviewer only after it auto-labels a PR, so making it a
 * *required* status check at init time would block EVERY merge on a fresh repo
 * (no reviewer wired yet, no reviewer on a solo repo). Users who add their own
 * `lint`/`test`/`build` CI opt in via the `minspec.ruleset.requiredChecks`
 * setting (read at create time in init.ts) — see {@link resolveRequiredChecks}
 * there.
 */
export const DEFAULT_REQUIRED_CHECK_CONTEXTS: readonly string[] = ['MinSpec SDD validation'];

/** Default ruleset name MinSpec proposes. */
export const RULESET_NAME = 'MinSpec required status checks';

/** Result of running a command via the injected runner. */
export interface CommandResult {
  /** Process exit code (0 = success). */
  code: number;
  /** Captured stdout (UTF-8). */
  stdout: string;
  /** Captured stderr (UTF-8). */
  stderr: string;
}

/**
 * Injected command runner. Implementations execute `cmd` with `args` (writing
 * `stdin`, when given, to the process's standard input) and resolve with the
 * captured result. A runner MUST NOT throw on a non-zero exit — it reports the
 * exit code in {@link CommandResult.code}. It MAY reject only when the binary
 * cannot be spawned at all (e.g. `gh` not on PATH); callers here treat a
 * rejection the same as "unavailable".
 */
export type CommandRunner = (
  cmd: string,
  args: string[],
  stdin?: string,
) => Promise<CommandResult>;

/**
 * Default {@link CommandRunner} — shells out via `child_process.execFile`.
 *
 * Kept here (a `lib/` module, allowlisted for `child_process` under the Tier-0
 * invariant) and NOT at the call sites: the detection/creation functions above
 * are pure and take an injected runner, so they never import `child_process`
 * directly. This factory is the single sanctioned process-spawn point and is
 * only ever wired in behind the post-init advisory (autonomous read-only probe;
 * consent-gated create).
 *
 * Captures stdout/stderr and the exit code WITHOUT throwing on a non-zero exit
 * (so callers branch on the code), optionally writes `stdin` to the process,
 * and rejects ONLY when the binary cannot be spawned at all (so callers treat
 * a missing `gh` as "unavailable").
 */
export function defaultCommandRunner(
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: 15000, env: { ...process.env }, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        // Default encoding → string stdout/stderr.
        const out = stdout ?? '';
        const errOut = stderr ?? '';
        if (err) {
          // A real exit-code failure carries a numeric `code`; a spawn failure
          // (binary missing) does not — reject only the latter.
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          if (typeof code === 'number') {
            resolve({ code, stdout: out, stderr: errOut });
            return;
          }
          reject(err);
          return;
        }
        resolve({ code: 0, stdout: out, stderr: errOut });
      },
    );
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin);
    }
  });
}

/** Run the runner, normalising a spawn rejection into a non-zero result. */
async function runSafe(
  run: CommandRunner,
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<CommandResult> {
  try {
    return await run(cmd, args, stdin);
  } catch (err) {
    return { code: 127, stdout: '', stderr: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Detect whether the `gh` CLI is BOTH installed AND authenticated.
 *
 * `gh --version` proves the binary exists; `gh auth status` proves there is a
 * usable token. Both must pass — an installed-but-unauthed `gh` cannot read or
 * write rulesets, so for our purposes it is "unavailable" and we fall back to
 * the zero-network docs link.
 *
 * This runs the user's own local `gh` (`gh --version`, then `gh auth status`) to
 * PROBE the local CLI's readiness — a read-only capability probe in the same
 * class as MinSpec shelling `git`. It egresses no user data and needs no consent
 * toast; it runs autonomously as the first step of the post-init advisory.
 */
export async function isGhReady(run: CommandRunner): Promise<boolean> {
  const version = await runSafe(run, 'gh', ['--version']);
  if (version.code !== 0) return false;
  const auth = await runSafe(run, 'gh', ['auth', 'status']);
  return auth.code === 0;
}

/**
 * Read the repo's rulesets and report whether one already enforces required
 * status checks on the DEFAULT branch.
 *
 * Strategy: `gh api repos/{owner}/{repo}/rulesets` lists rulesets but does not
 * inline their rules, so for each `active` ruleset whose `target` is `branch`
 * we fetch its detail (`.../rulesets/{id}`) and check that it BOTH
 *   (a) targets the default branch — its `conditions.ref_name.include` contains
 *       the `~DEFAULT_BRANCH` sentinel (or an explicit `refs/heads/...` entry,
 *       which we accept as "targets a branch"), AND
 *   (b) has a `required_status_checks` rule.
 *
 * Returns `false` (offer to create) on ANY read/parse failure or non-zero exit
 * — we never want a flaky read to suppress the advisory, and a wrong "already
 * configured" is the worse error (it would silently leave the repo unprotected).
 *
 * READ-ONLY CONFIG PROBE — a `gh api .../rulesets` GET of the repo's OWN
 * settings. It egresses no user artifacts, spec content, or telemetry (the same
 * class as `git fetch`), so per DR-050 (Amendment 2026-07-01) the caller runs it
 * AUTONOMOUSLY on init — no prior consent toast. Only the subsequent CREATE
 * (which mutates the repo) is consent-gated.
 *
 * @returns whether a qualifying ruleset already exists.
 */
export async function hasRequiredChecksRuleset(
  owner: string,
  repo: string,
  run: CommandRunner,
): Promise<boolean> {
  const list = await runSafe(run, 'gh', [
    'api',
    `repos/${owner}/${repo}/rulesets`,
  ]);
  if (list.code !== 0) return false;

  let rulesets: Array<{ id?: number; target?: string; enforcement?: string }>;
  try {
    const parsed = JSON.parse(list.stdout);
    if (!Array.isArray(parsed)) return false;
    rulesets = parsed;
  } catch {
    return false;
  }

  for (const rs of rulesets) {
    if (rs.target !== 'branch') continue;
    if (rs.enforcement === 'disabled') continue;
    if (typeof rs.id !== 'number') continue;

    const detail = await runSafe(run, 'gh', [
      'api',
      `repos/${owner}/${repo}/rulesets/${rs.id}`,
    ]);
    if (detail.code !== 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(detail.stdout);
    } catch {
      continue;
    }
    if (rulesetGuardsDefaultBranchChecks(parsed)) return true;
  }

  return false;
}

/** Shape of the bits of a ruleset detail we inspect. */
interface RulesetDetail {
  conditions?: {
    ref_name?: {
      include?: unknown;
    };
  };
  rules?: Array<{ type?: string }>;
}

/**
 * Does this ruleset detail BOTH target a branch (default-branch sentinel or any
 * `refs/heads/*` include) AND carry a `required_status_checks` rule? Pure;
 * tolerant of partial / unexpected JSON.
 */
function rulesetGuardsDefaultBranchChecks(detail: unknown): boolean {
  if (typeof detail !== 'object' || detail === null) return false;
  const d = detail as RulesetDetail;

  const include = d.conditions?.ref_name?.include;
  if (!Array.isArray(include)) return false;
  const targetsBranch = include.some(
    (ref) =>
      ref === '~DEFAULT_BRANCH' ||
      ref === '~ALL' ||
      (typeof ref === 'string' && ref.startsWith('refs/heads/')),
  );
  if (!targetsBranch) return false;

  const rules = d.rules;
  if (!Array.isArray(rules)) return false;
  return rules.some((r) => r?.type === 'required_status_checks');
}

/**
 * Normalise a caller-supplied list of check contexts down to a clean,
 * de-duplicated, non-empty `string[]`, falling back to
 * {@link DEFAULT_REQUIRED_CHECK_CONTEXTS} when the input is absent, not an
 * array, or empty-after-trimming. Pure — the single place that decides which
 * contexts end up in the payload, so the fallback is honoured whether the
 * config setting is unset, malformed, or blank.
 */
export function resolveCheckContexts(checks?: readonly string[]): string[] {
  if (!Array.isArray(checks)) return [...DEFAULT_REQUIRED_CHECK_CONTEXTS];
  const cleaned = Array.from(
    new Set(
      checks
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    ),
  );
  return cleaned.length > 0 ? cleaned : [...DEFAULT_REQUIRED_CHECK_CONTEXTS];
}

// ---------------------------------------------------------------------------
// Tiered required-check resolution (#564)
//
// A required status check is safe to enforce only if the target repo can actually
// PRODUCE it — otherwise the ruleset permanently blocks every merge (the #559
// permanent-pending / #560 unsatisfiable-gate bug class; invariant "no deadlock
// gating"). #564 scaffolds the full AI-review stack (ai-review.yml +
// ready-to-merge.yml, see template-registry.ts CI_REVIEW_STACK_TEMPLATES), which
// makes MORE checks producible — but only under conditions this resolver models
// explicitly so it never writes a self-deadlocking ruleset:
//
//   TIER A — diff/spec checks (ai-review, ready-to-merge). Reviewable from commit
//     #1 (a docs-only diff is reviewable; no code maturity needed). BUT both only
//     ever go GREEN once the reviewer pipeline is operational — the workflows post
//     `ai-review` / a verified `ready-to-merge` ONLY when the reviewer secrets +
//     App are configured (issue #564 slice 3). Requiring them before that would
//     block every merge on a fresh/solo repo, exactly the case DR-050 called out
//     ("ready-to-merge must NOT be required until the reviewer is wired"). So each
//     enters the required set only when its workflow is scaffolded AND the reviewer
//     is configured — never on scaffolding alone.
//
//   TIER B — code checks (lint, test, build). Requirable ONLY when the repo has a
//     runnable `package.json` script for them (detected by {@link detectCodeChecks}).
//     Requiring `test` on a repo with a `test` script but zero tests, or `lint`
//     with no lint script, is the deadlock #559 fixed — so absence ⇒ not required.
//
// `MinSpec SDD validation` is always required (always produced by the scaffolded
// minspec-validate.yml). User-configured extras (minspec.ruleset.requiredChecks)
// are layered on top verbatim — the user owns that trade-off.
//
// PURE + offline (Tier-0): callers do the fs/secret PROBING and pass the booleans
// in; this module only decides. Wiring the probe (which workflow files exist +
// whether the reviewer secrets are set) into the init-time advisory is the
// integration step for #564 slices 2/3.
// ---------------------------------------------------------------------------

/** Tier-A check context the scaffolded `ai-review.yml` reports (its verdict check-run). */
export const AI_REVIEW_CHECK = 'ai-review';
/** Tier-A check context the scaffolded `ready-to-merge.yml` reports (commit status). */
export const READY_TO_MERGE_CHECK = 'ready-to-merge';
/** Tier-B code-maturity check contexts — requirable only when the repo produces them. */
export const TIER_B_CODE_CHECKS = ['lint', 'test', 'build'] as const;
/** One of the Tier-B code checks. */
export type CodeCheck = (typeof TIER_B_CODE_CHECKS)[number];

/** Which Tier-B code checks the repo can actually run (has a non-empty npm script for). */
export interface DetectedCodeChecks {
  lint: boolean;
  test: boolean;
  build: boolean;
}

/**
 * Detect which Tier-B code checks the repo can PRODUCE, from a parsed
 * `package.json` `scripts` map. A check is producible only when its script exists
 * and is non-blank — the first-order guard against the #559 permanent-pending
 * deadlock (requiring a check no CI job reports). Pure; tolerant of a missing/
 * malformed scripts object (⇒ none producible).
 *
 * NOTE (deeper guard, tracked as a follow-up): a script's mere presence does not
 * prove it does real work — e.g. a `test` script with zero test files still
 * "runs" but certifies nothing. Intersecting with what CI actually reports (the
 * #559 note) needs a CI-report probe beyond this pure detector.
 */
export function detectCodeChecks(scripts?: Record<string, unknown> | null): DetectedCodeChecks {
  const has = (name: CodeCheck): boolean => {
    const v = scripts?.[name];
    return typeof v === 'string' && v.trim().length > 0;
  };
  return { lint: has('lint'), test: has('test'), build: has('build') };
}

/** Inputs to {@link resolveTieredRequiredChecks}. */
export interface TieredRequiredCheckInputs {
  /** `.github/workflows/ai-review.yml` is scaffolded in the target repo. */
  readonly aiReviewWorkflowScaffolded: boolean;
  /** `.github/workflows/ready-to-merge.yml` is scaffolded in the target repo. */
  readonly readyToMergeWorkflowScaffolded: boolean;
  /**
   * The reviewer pipeline is OPERATIONAL — the required secrets (CLAUDE_CODE_OAUTH_TOKEN
   * + the App) are configured, so ai-review.yml/ready-to-merge.yml actually post their
   * checks/verdict. Defaults to FALSE (fail-safe): a Tier-A check is never made required
   * until the caller affirms the repo can produce a pass, so a naive caller can never
   * mint a deadlocking ruleset. Detecting this is issue #564 slice 3 (a consent-gated
   * `gh secret list` probe), out of the scaffolding scope.
   */
  readonly reviewerConfigured?: boolean;
  /** Tier-B checks the repo can produce (from {@link detectCodeChecks}); absent ⇒ none. */
  readonly codeChecks?: Partial<DetectedCodeChecks>;
  /** Extra user-configured contexts (minspec.ruleset.requiredChecks), layered on top. */
  readonly userChecks?: readonly string[];
}

/**
 * Resolve the full required-check context set for a repo's branch ruleset, adding
 * only checks the repo can actually PRODUCE (see the tier notes above). Always
 * includes {@link DEFAULT_REQUIRED_CHECK_CONTEXTS} (`MinSpec SDD validation`); adds
 * Tier-A (`ai-review`, `ready-to-merge`) only when their workflow is scaffolded AND
 * the reviewer is configured; adds Tier-B (`lint`/`test`/`build`) only when the repo
 * has a runnable script for each; appends de-duplicated user extras. Pure — the
 * single decision point, so the no-deadlock rule holds no matter the call site.
 */
export function resolveTieredRequiredChecks(inputs: TieredRequiredCheckInputs): string[] {
  const {
    aiReviewWorkflowScaffolded,
    readyToMergeWorkflowScaffolded,
    reviewerConfigured = false,
    codeChecks,
    userChecks,
  } = inputs;

  const contexts: string[] = [...DEFAULT_REQUIRED_CHECK_CONTEXTS];

  // Tier A — never required until BOTH scaffolded AND the reviewer can produce a pass.
  if (readyToMergeWorkflowScaffolded && reviewerConfigured) contexts.push(READY_TO_MERGE_CHECK);
  if (aiReviewWorkflowScaffolded && reviewerConfigured) contexts.push(AI_REVIEW_CHECK);

  // Tier B — require a code check only when the repo actually runs it (#559 guard).
  for (const check of TIER_B_CODE_CHECKS) {
    if (codeChecks?.[check]) contexts.push(check);
  }

  // User-configured extras (trimmed, non-blank).
  if (Array.isArray(userChecks)) {
    for (const c of userChecks) {
      if (typeof c === 'string' && c.trim().length > 0) contexts.push(c.trim());
    }
  }

  // De-duplicate, preserving first-seen order (MinSpec SDD validation stays first).
  return Array.from(new Set(contexts));
}

/**
 * Build the POST body for a ruleset that requires the given status `checks`
 * (default {@link DEFAULT_REQUIRED_CHECK_CONTEXTS} — `MinSpec SDD validation`,
 * the context MinSpec's own scaffolded CI reports) on the repo's default
 * branch.
 *
 * The check set is configurable so a user can add e.g. `build` or the opt-in
 * `ready-to-merge` via the `minspec.ruleset.requiredChecks` setting without a
 * code change; the caller (init.ts) reads that setting and threads it through
 * here. `ready-to-merge` stays OUT of the default because it would block every
 * merge on a fresh repo until MinSpec's reviewer is wired and labelling (#350).
 *
 * Targets the default branch via the `~DEFAULT_BRANCH` ref sentinel, so the
 * payload is repo-agnostic (no need to resolve the branch name first).
 */
export function createRulesetPayload(checks?: readonly string[]): Record<string, unknown> {
  const contexts = resolveCheckContexts(checks);
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: {
      ref_name: {
        include: ['~DEFAULT_BRANCH'],
        exclude: [],
      },
    },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: contexts.map((context) => ({
            context,
            // No integration_id pin — match the check by context name from any
            // app/runner (the standard GitHub Actions CI reports these).
          })),
        },
      },
    ],
  };
}

/** Outcome of an attempt to create the ruleset via `gh`. */
export interface CreateRulesetOutcome {
  /** Whether the POST succeeded (HTTP 2xx / exit 0). */
  created: boolean;
  /** True when the failure was an authorization problem (403 / missing admin scope). */
  forbidden: boolean;
  /** Captured stderr for diagnostics (empty on success). */
  detail: string;
}

/**
 * Create the ruleset by POSTing {@link createRulesetPayload} through the user's
 * `gh`. The JSON body is streamed to `gh api --input -` over stdin so we never
 * shell-interpolate it. `checks` selects which status-check contexts the ruleset
 * requires (default {@link DEFAULT_REQUIRED_CHECK_CONTEXTS}).
 *
 * MUTATING network action — the caller MUST only invoke this on the user's
 * explicit "Create ruleset" click (that click IS the consent for the mutation;
 * see DR-050 Amendment 2026-07-01). On a 403 (token lacks repo-admin) we report
 * `forbidden: true` so the caller can fall back to the docs link rather than
 * surfacing a raw error.
 */
export async function createRequiredChecksRuleset(
  owner: string,
  repo: string,
  run: CommandRunner,
  checks?: readonly string[],
): Promise<CreateRulesetOutcome> {
  const body = JSON.stringify(createRulesetPayload(checks));
  // Stream the JSON body over stdin (`--input -`) so it is never
  // shell-interpolated into the argv.
  const result = await runSafe(
    run,
    'gh',
    ['api', '-X', 'POST', `repos/${owner}/${repo}/rulesets`, '--input', '-'],
    body,
  );

  if (result.code === 0) {
    return { created: true, forbidden: false, detail: '' };
  }

  const haystack = `${result.stdout}\n${result.stderr}`;
  const forbidden =
    /\b403\b/.test(haystack) ||
    /forbidden/i.test(haystack) ||
    /must have admin/i.test(haystack) ||
    /resource not accessible/i.test(haystack);

  return { created: false, forbidden, detail: result.stderr || result.stdout };
}

// ---------------------------------------------------------------------------
// #564 slices 2/3 · SPEC-033 FR-3 — provision the FULL producible check set,
// SYMMETRICALLY (add missing checks to an existing ruleset).
//
// `hasRequiredChecksRuleset` only answered "does ANY ruleset require checks?", so
// a ruleset requiring just `MinSpec SDD validation` read as "configured" and the
// `ai-review` / `ready-to-merge` checks scaffolded later (#564) were never added —
// the sealbox gap, the same present-not-missing asymmetry as the validator class.
// These close it: read WHICH contexts a ruleset requires, and ADD any missing ones
// to the existing ruleset (not only create-if-absent).
// ---------------------------------------------------------------------------

/** Whether a `gh api` failure haystack indicates an authorization problem. */
function isForbidden(haystack: string): boolean {
  return (
    /\b403\b/.test(haystack) ||
    /forbidden/i.test(haystack) ||
    /must have admin/i.test(haystack) ||
    /resource not accessible/i.test(haystack)
  );
}

/** The default-branch ruleset that guards checks: its id + the contexts it requires. */
export interface ExistingRequiredChecks {
  readonly rulesetId: number;
  readonly contexts: string[];
}

/** Permissive view of a ruleset PUT/GET body — only the fields we read/preserve. */
interface RulesetFull {
  name?: string;
  target?: string;
  enforcement?: string;
  conditions?: unknown;
  bypass_actors?: unknown;
  rules?: Array<{
    type?: string;
    parameters?: {
      required_status_checks?: Array<{ context?: string; integration_id?: number }>;
    } & Record<string, unknown>;
  }>;
}

/** Pull the `required_status_checks` contexts out of a parsed ruleset (pure, tolerant). */
function extractRequiredContexts(detail: RulesetFull): string[] {
  const rule = Array.isArray(detail.rules)
    ? detail.rules.find((r) => r?.type === 'required_status_checks')
    : undefined;
  const checks = rule?.parameters?.required_status_checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .map((c) => c?.context)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * The default-branch ruleset's id + the status-check contexts it CURRENTLY
 * requires, or `null` when no active branch ruleset guards checks. Unlike
 * {@link hasRequiredChecksRuleset} (a bare exists-bool), this returns WHICH
 * contexts are required, so the caller can add any missing to an existing ruleset
 * (the sealbox case). Read-only config probe (DR-050). `null` on any read/parse
 * failure ⇒ the caller treats it as "none" and offers to create.
 */
export async function listRequiredCheckContexts(
  owner: string,
  repo: string,
  run: CommandRunner,
): Promise<ExistingRequiredChecks | null> {
  const list = await runSafe(run, 'gh', ['api', `repos/${owner}/${repo}/rulesets`]);
  if (list.code !== 0) return null;
  let rulesets: Array<{ id?: number; target?: string; enforcement?: string }>;
  try {
    const parsed = JSON.parse(list.stdout);
    if (!Array.isArray(parsed)) return null;
    rulesets = parsed;
  } catch {
    return null;
  }
  for (const rs of rulesets) {
    if (rs.target !== 'branch') continue;
    if (rs.enforcement === 'disabled') continue;
    if (typeof rs.id !== 'number') continue;
    const detail = await runSafe(run, 'gh', ['api', `repos/${owner}/${repo}/rulesets/${rs.id}`]);
    if (detail.code !== 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(detail.stdout);
    } catch {
      continue;
    }
    if (rulesetGuardsDefaultBranchChecks(parsed)) {
      return { rulesetId: rs.id, contexts: extractRequiredContexts(parsed as RulesetFull) };
    }
  }
  return null;
}

/**
 * Is the reviewer pipeline OPERATIONAL on the repo — are the secrets that make
 * `ai-review.yml`/`ready-to-merge.yml` actually post a pass present? Checks for
 * `CLAUDE_CODE_OAUTH_TOKEN` AND `MINSPEC_APP_ID` in the repo's Actions secrets
 * (names only — a GET of the repo's OWN secret NAMES, no values, same read-only
 * class as the rulesets probe). This is the {@link
 * TieredRequiredCheckInputs.reviewerConfigured} guard: never require a Tier-A
 * check the repo cannot yet produce (the #559 deadlock). Fail-safe: any read
 * failure ⇒ `false` ⇒ the Tier-A checks stay OUT of the required set.
 */
export async function probeReviewerConfigured(
  owner: string,
  repo: string,
  run: CommandRunner,
): Promise<boolean> {
  const res = await runSafe(run, 'gh', [
    'api',
    `repos/${owner}/${repo}/actions/secrets`,
    '--jq',
    '[.secrets[].name]',
  ]);
  if (res.code !== 0) return false;
  let names: unknown;
  try {
    names = JSON.parse(res.stdout);
  } catch {
    return false;
  }
  if (!Array.isArray(names)) return false;
  const set = new Set(names.filter((n): n is string => typeof n === 'string'));
  return set.has('CLAUDE_CODE_OAUTH_TOKEN') && set.has('MINSPEC_APP_ID');
}

/** Outcome of adding missing contexts to an existing ruleset. */
export interface UpdateRulesetOutcome {
  /** Whether the ruleset now requires all wanted contexts (PUT ok, or already satisfied). */
  updated: boolean;
  /** True on an authorization failure (403 / missing admin). */
  forbidden: boolean;
  /** Captured diagnostics (empty on success). */
  detail: string;
}

/**
 * Add `addContexts` to an existing ruleset's `required_status_checks` rule
 * (idempotent union — contexts already required are preserved, including any
 * `integration_id` pins). GETs the ruleset, merges, and PUTs the whole thing back
 * (GitHub ruleset update is a full replacement — there is no PATCH). Only the
 * `required_status_checks` context list changes; name, enforcement, conditions,
 * bypass actors, and every other rule are preserved verbatim. MUTATING — the
 * caller gates it behind explicit consent (DR-050 / SPEC-033 FR-3).
 */
export async function updateRulesetRequiredChecks(
  owner: string,
  repo: string,
  run: CommandRunner,
  rulesetId: number,
  addContexts: readonly string[],
): Promise<UpdateRulesetOutcome> {
  const got = await runSafe(run, 'gh', ['api', `repos/${owner}/${repo}/rulesets/${rulesetId}`]);
  if (got.code !== 0) {
    return { updated: false, forbidden: isForbidden(got.stdout + got.stderr), detail: got.stderr || got.stdout };
  }
  let detail: RulesetFull;
  try {
    detail = JSON.parse(got.stdout) as RulesetFull;
  } catch {
    return { updated: false, forbidden: false, detail: 'could not parse the existing ruleset' };
  }
  const rules = Array.isArray(detail.rules) ? detail.rules : [];
  const rule = rules.find((r) => r?.type === 'required_status_checks');
  if (!rule) {
    return { updated: false, forbidden: false, detail: 'ruleset has no required_status_checks rule' };
  }
  const existing = Array.isArray(rule.parameters?.required_status_checks)
    ? rule.parameters!.required_status_checks!
    : [];
  const have = new Set(existing.map((c) => c?.context));
  const missing = addContexts.filter((c) => !have.has(c));
  if (missing.length === 0) return { updated: true, forbidden: false, detail: 'already satisfied' };

  const newRules = rules.map((r) =>
    r?.type === 'required_status_checks'
      ? {
          ...r,
          parameters: {
            ...r.parameters,
            required_status_checks: [...existing, ...missing.map((context) => ({ context }))],
          },
        }
      : r,
  );
  const body = JSON.stringify({
    name: detail.name,
    target: detail.target ?? 'branch',
    enforcement: detail.enforcement ?? 'active',
    conditions: detail.conditions,
    rules: newRules,
    ...(detail.bypass_actors ? { bypass_actors: detail.bypass_actors } : {}),
  });
  const put = await runSafe(
    run,
    'gh',
    ['api', '-X', 'PUT', `repos/${owner}/${repo}/rulesets/${rulesetId}`, '--input', '-'],
    body,
  );
  if (put.code === 0) return { updated: true, forbidden: false, detail: '' };
  return { updated: false, forbidden: isForbidden(put.stdout + put.stderr), detail: put.stderr || put.stdout };
}
