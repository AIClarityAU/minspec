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
 * DR-050 (Amendments 2026-07-01, 2026-07-16 and 2026-08-25):
 *
 *   - READ-ONLY CONFIG PROBE (autonomous) — {@link probeGhReadiness} (probe the *local*
 *     `gh`), {@link hasRequiredChecksRuleset} / {@link listRequiredCheckContexts}
 *     (a `gh api .../rulesets` GET of the repo's OWN settings), and
 *     {@link probeReviewerConfigured} (a `gh api .../actions/secrets` GET of the
 *     repo's OWN secret NAMES — never values). These egress NO user artifacts,
 *     spec content, secret values, or telemetry — they read the repo's own
 *     configuration, the same class as MinSpec shelling `git fetch`. They run
 *     AUTONOMOUSLY on init once `gh` is ready and the repo resolves; NO prior
 *     consent toast is required. The rulesets read is authorised by Amendment
 *     2026-07-01; the `actions/secrets` NAMES read by Amendment 2026-07-16
 *     (materialising the founder's decision on #796) — on the SAME basis: it
 *     reads the repo's OWN config and egresses nothing.
 *
 *   - READ-ONLY ACCOUNT PROBE (autonomous, BRANCH-SCOPED) — {@link
 *     probeOwnerCandidates}, which issues EXACTLY ONE endpoint: `gh api
 *     user/memberships/orgs`, for the orgs the user belongs to and in what role.
 *     Same gating class as the config probes — autonomous, egresses nothing — but
 *     NOT the same subject: it reads the user's ACCOUNT, not the repository. DR-050
 *     (Amendment 2026-08-25, #1694) records that as a genuine widening of the
 *     carve-out rather than a further enumeration inside it, and attaches two
 *     LOAD-BEARING bounds: the caller may run it ONLY in the no-GitHub-remote
 *     branch of the init advisory (a repo that already resolves a remote — the
 *     overwhelming majority of inits — must never reach it), and the result is
 *     never persisted. That amendment enumerates this ONE endpoint and no other,
 *     and per-endpoint enumeration is how this DR has always been extended
 *     (Amendment 2026-07-16 exists solely to add `actions/secrets` by name), so
 *     NOTHING here may reach for a further account endpoint — `gh api user`
 *     included. The personal account needs no name: `gh repo create <name>` with
 *     no owner prefix already creates under the signed-in account.
 *     See the section comment above {@link probeOwnerCandidates}.
 *
 *   - MUTATING / EGRESSING ACTION (consent-gated) — {@link
 *     createRequiredChecksRuleset} (the `gh api -X POST .../rulesets` that WRITES
 *     a ruleset), {@link updateRulesetRequiredChecks} (the `-X PUT` that adds
 *     missing checks to one), and {@link createGitHubRepo} (the `gh repo create`
 *     that CREATES a repository and wires it as the local `origin`). These mutate
 *     the user's GitHub account or repository, so they fire ONLY on the user's
 *     explicit "Create ruleset" / "Add checks" / "Create GitHub repo" click — that
 *     click IS the consent for the mutation. Nothing writes autonomously.
 *
 * The ONLY toasts shown are the single "create one?" / "add them?" ruleset offer —
 * and only when the autonomous probe finds a missing check — and, where the project
 * has no GitHub remote at all, the "create a GitHub repo?" offer that replaced the
 * old docs-page dead end (#1694). If the ruleset is already fully configured the
 * whole flow is silent. The always-available fallback ({@link RULESET_DOCS_URL})
 * makes zero network calls, and it is still the ENTIRE path when `gh` is missing or
 * unauthed.
 *
 * Every MUTATING network action is consent-gated; every read-only probe is
 * autonomous — the repo-config ones unconditionally, the account-scoped one only
 * inside the single branch named above. DR-050 Amendments 2026-07-01 and
 * 2026-07-16 ratify the config reads and the ruleset writes; Amendment 2026-08-25
 * governs the account read and the repository create.
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
 * GitHub docs page on creating a REPOSITORY — the zero-network fallback for the
 * create-repo offer (#1694) and for every toast inside it.
 *
 * A SECOND URL, because "Learn more" has to answer the question the toast asked.
 * The create offer fires precisely where the project has no GitHub repository at
 * all, and it used to hand that user {@link RULESET_DOCS_URL}: a page about
 * configuring rulesets on a repository they do not have. The two offers are one
 * click apart and one of them is about a repository that does not exist yet, so
 * one shared constant cannot be right for both — the ruleset docs stay correct
 * everywhere the user HAS a repository, which is every other branch of the
 * advisory.
 */
export const REPO_CREATE_DOCS_URL =
  'https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository';

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
 * What the two local `gh` probes established — WHICH one failed, not merely that
 * one did.
 *
 * ONE MEMBER PER REJECTION REASON (fifth correctness review, 2026-08-29). This
 * was a `boolean`, and the single sentence downstream of it told every user to
 * "Install/authenticate the `gh` CLI" — half of that instruction inapplicable in
 * each case, and the two halves are entirely different commands. A user who has
 * `gh` and is simply signed out was being told to install what they already have.
 */
export type GhReadiness =
  /** `gh --version` exited 0 and `gh auth status` exited 0. Usable. */
  | 'ready'
  /** `gh --version` did not answer — no binary on PATH, or it could not spawn. */
  | 'not-installed'
  /** `gh` answered its version and then reported no usable token. */
  | 'not-signed-in';

/**
 * Probe whether the `gh` CLI is BOTH installed AND authenticated, reporting WHICH
 * of the two failed.
 *
 * `gh --version` proves the binary exists; `gh auth status` proves there is a
 * usable token. Both must pass — an installed-but-unauthed `gh` cannot read or
 * write rulesets, so for our purposes it is unusable and the caller falls back to
 * the zero-network docs link. What CHANGED is that the caller can now say which
 * of the two it observed.
 *
 * SHORT-CIRCUITS. `gh auth status` is never issued once `--version` has failed:
 * there is nothing to ask, and asking would produce a second failure that says
 * nothing new.
 *
 * This runs the user's own local `gh` (`gh --version`, then `gh auth status`) to
 * PROBE the local CLI's readiness — a read-only capability probe in the same
 * class as MinSpec shelling `git`. It egresses no user data and needs no consent
 * toast; it runs autonomously as the first step of the post-init advisory.
 */
export async function probeGhReadiness(run: CommandRunner): Promise<GhReadiness> {
  const version = await runSafe(run, 'gh', ['--version']);
  if (version.code !== 0) return 'not-installed';
  const auth = await runSafe(run, 'gh', ['auth', 'status']);
  return auth.code === 0 ? 'ready' : 'not-signed-in';
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
   * The reviewer pipeline is OPERATIONAL — ALL of {@link REVIEWER_SECRETS}
   * (CLAUDE_CODE_OAUTH_TOKEN + the App's id AND private key) are configured, so
   * ai-review.yml/ready-to-merge.yml actually post their checks/verdict. Defaults to
   * FALSE (fail-safe): a Tier-A check is never made required until the caller affirms
   * the repo can produce a pass, so a naive caller can never mint a deadlocking
   * ruleset. The affirmation comes from {@link probeReviewerConfigured} (secret NAMES
   * only, all three), which the init/refresh caller runs AUTONOMOUSLY in the detection
   * path — a read-only GET of the repo's OWN config, authorised by DR-050 (Amendment
   * 2026-07-16), on the same basis as the autonomous rulesets probe.
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
  /**
   * True when the 403 is GitHub reporting the FEATURE as unavailable on this repo's
   * plan (private repo on the free plan), not a permission problem. Same status code,
   * opposite remedy — see {@link isPlanLimited}.
   */
  planLimited: boolean;
  /** GitHub's own explanation, when it returned one. Null rather than a guess. */
  reason: string | null;
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
    return { created: true, forbidden: false, planLimited: false, reason: null, detail: '' };
  }

  const haystack = `${result.stdout}\n${result.stderr}`;

  return {
    created: false,
    // ONE copy of the rule, not two. This was an inline duplicate of
    // {@link isForbidden}'s four regexes, so widening one and not the other was a
    // silent drift waiting to happen — and the caller now derives its SENTENCE
    // from {@link classifyForbidden}, which must be reading the same shapes this
    // bool was computed from.
    forbidden: isForbidden(haystack),
    planLimited: isPlanLimited(haystack),
    reason: githubReason(haystack),
    detail: result.stderr || result.stdout,
  };
}

/**
 * Is this 403 GitHub saying the FEATURE is unavailable on this repo's plan, rather
 * than the caller lacking permission?
 *
 * Rulesets are unavailable on a private repository on the free plan. GitHub answers
 * with a 403 whose body is `Upgrade to GitHub Pro or make this repository public to
 * enable this feature.` — the same status code as a genuine permission failure, and
 * the reason the two must be told apart: no amount of re-authenticating fixes a plan
 * limit, so advising a token fix here sends the user to do something that cannot work.
 */
export function isPlanLimited(haystack: string): boolean {
  return (
    /upgrade to github/i.test(haystack) || /make this repository public/i.test(haystack)
  );
}

/**
 * GitHub's own one-line explanation, pulled out of the `gh` output.
 *
 * MinSpec previously reported a CAUSE it had not established: every 403 was rendered
 * as "your gh token lacks repo-admin scope". Observed in a real project whose token
 * carried full `repo` scope and whose actual failure was a plan limit — so the message
 * was confidently wrong and pointed at a fix that could never work. That is the
 * evidence-discipline rule violated in shipped product text: a plausible inference
 * reported as an observation.
 *
 * Returns GitHub's `message` field when present, so the user reads the API's reason
 * rather than our guess at it. Null when nothing quotable was returned, in which case
 * the caller must stay vague rather than invent a cause.
 */
export function githubReason(haystack: string): string | null {
  // `gh api` prints `{"message":"…"}` on stdout and a `gh: …` line on stderr.
  const json = /"message"\s*:\s*"([^"]+)"/.exec(haystack);
  if (json) return json[1];
  const ghLine = /^gh:\s*(.+?)\s*(?:\(HTTP \d+\))?$/m.exec(haystack);
  if (ghLine) return ghLine[1];
  return null;
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

/**
 * WHICH authorization refusal a `gh api` failure haystack carries — one member
 * per shape, never a bare bool.
 *
 * The bool was fine for DECIDING; it was never enough for EXPLAINING, and the one
 * sentence downstream of it named a single speculative cause ("your gh token may
 * lack repo-admin scope") for four different observations. Two of them say
 * something specific and actionable, and saying it costs nothing once the shape
 * is carried instead of discarded.
 *
 * Order matters: the two named shapes are checked before the bare status code,
 * because GitHub's `Resource not accessible` arrives as `HTTP 403: Resource not
 * accessible` and a 403-first ladder would swallow it.
 */
export type ForbiddenShape =
  /** GitHub said the caller must be an admin of the repository. */
  | 'not-admin'
  /** GitHub said the resource is not accessible to this token/integration. */
  | 'resource-not-accessible'
  /** A STATED 403 with nothing more specific in it. The status code was observed. */
  | 'status-403'
  /**
   * The refusal is worded ("forbidden") and carries NO status code.
   *
   * SPLIT OUT OF `status-403` (sixth correctness review, 2026-08-30), which was
   * two observations under one name and whose sentence asserted the status code
   * for both. Reproduced with the body a REST error can carry on its own:
   *
   *     {"error":"Forbidden"}
   *       classifyForbidden -> 'status-403'
   *       rendered          -> "the request was refused (HTTP 403) and GitHub
   *                             gave no reason MinSpec could quote"
   *
   * No 403 appears anywhere in that output. The refusal was observed; the status
   * code was inferred from the word beside it and then reported as fact — the
   * plausible-inference-as-observation defect, in the sentence whose entire job
   * is to say what was observed.
   */
  | 'refusal-unstated';

/**
 * {@link ForbiddenShape} for this haystack, or `null` when it is not an
 * authorization refusal.
 *
 * ORDER IS THE CLASSIFICATION: the two NAMED shapes first (GitHub's `Resource
 * not accessible` arrives as `HTTP 403: Resource not accessible`, so a
 * 403-first ladder would swallow it), then the stated status code, then the
 * bare word. The SET this accepts is unchanged by the 2026-08-30 split — only
 * how finely it reports what it saw.
 */
export function classifyForbidden(haystack: string): ForbiddenShape | null {
  if (/must have admin/i.test(haystack)) return 'not-admin';
  if (/resource not accessible/i.test(haystack)) return 'resource-not-accessible';
  if (/\b403\b/.test(haystack)) return 'status-403';
  if (/forbidden/i.test(haystack)) return 'refusal-unstated';
  return null;
}

/**
 * Whether a `gh api` failure haystack indicates an authorization problem.
 *
 * The BIT form of {@link classifyForbidden}, defined in terms of it so the
 * decision and the explanation can never disagree about what counts.
 */
function isForbidden(haystack: string): boolean {
  return classifyForbidden(haystack) !== null;
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
 * The repo Actions secrets the scaffolded `ai-review.yml` requires before it will
 * run the independent reviewer and post the `ai-review` check. Its guard step
 * (`if [ -z "$OAUTH_TOKEN" ] || [ -z "$APP_ID" ] || [ -z "$APP_KEY" ]`) skips the
 * WHOLE workflow — posting a NOTICE and NO check-run — unless ALL THREE are set:
 *
 *   - `CLAUDE_CODE_OAUTH_TOKEN` — the inference credential for `claude -p`.
 *   - `MINSPEC_APP_ID`          — the GitHub App that posts/labels as the bot.
 *   - `MINSPEC_APP_PRIVATE_KEY` — the App's PEM; the token mint fails without it.
 *
 * Kept as the SINGLE SOURCE OF TRUTH so {@link probeReviewerConfigured} can never
 * drift from the workflow's guard again — the #559 deadlock this whole probe exists
 * to prevent (see the regression test). If `ai-review.yml`'s required secrets ever
 * change, change them HERE.
 */
export const REVIEWER_SECRETS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'MINSPEC_APP_ID',
  'MINSPEC_APP_PRIVATE_KEY',
] as const;

/**
 * Secrets `ai-review.yml` REFERENCES but does not GATE on — present, the reviewer
 * gains a capability; absent, it runs exactly as before.
 *
 *   - `ANTHROPIC_API_KEY` — the PAYG quota-failover credential. `review-branch.sh`
 *     retries on it only when `AI_REVIEW_FAILOVER == payg` AND the key is set; with
 *     neither, the default `wait` path is unchanged.
 *
 * Deliberately NOT part of {@link REVIEWER_SECRETS}, and the distinction is the whole
 * point of this constant. {@link probeReviewerConfigured} answers "can this repo
 * produce an `ai-review` check at all", and its answer decides whether `ai-review`
 * may be a REQUIRED check. Fold an optional secret into that set and every repo
 * without a PAYG key reports "not configured" — so the Tier-A checks are dropped from
 * the required set and un-reviewed code can merge. That is the #559 deadlock's mirror
 * image: #559 required a check the repo could not produce; this would stop requiring
 * a check the repo produces perfectly well.
 *
 * The enforcement test binds `secrets.*` references in the workflow to the UNION of
 * both constants, so a newly referenced secret still cannot appear without being
 * declared here — the anti-drift property survives the split. Adding a name to THIS
 * list is the explicit claim "the reviewer works without it".
 */
export const REVIEWER_OPTIONAL_SECRETS = ['ANTHROPIC_API_KEY'] as const;

/**
 * Is the reviewer pipeline OPERATIONAL on the repo — are the secrets that make
 * `ai-review.yml`/`ready-to-merge.yml` actually post a pass present? Checks that
 * EVERY secret in {@link REVIEWER_SECRETS} (`CLAUDE_CODE_OAUTH_TOKEN`,
 * `MINSPEC_APP_ID`, AND `MINSPEC_APP_PRIVATE_KEY`) is present in the repo's Actions
 * secrets (NAMES only — never values). This is the {@link
 * TieredRequiredCheckInputs.reviewerConfigured} guard: never require a Tier-A check
 * the repo cannot yet produce (the #559 deadlock). Fail-safe: any read failure ⇒
 * `false` ⇒ the Tier-A checks stay OUT of the required set.
 *
 * DEADLOCK NOTE (#559 regression): checking only 2 of the 3 secrets (an earlier
 * bug) reported "configured" while `MINSPEC_APP_PRIVATE_KEY` was still absent — so
 * `ai-review` was made a REQUIRED check, but the workflow's own guard skipped and
 * NEVER posted it, blocking every merge. The check set here MUST equal the
 * workflow's guard set, hence the shared {@link REVIEWER_SECRETS} constant.
 *
 * NETWORK POSTURE — AUTONOMOUS read-only config probe. This is a `gh api GET
 * repos/{owner}/{repo}/actions/secrets` read of the repo's OWN secret NAMES (never
 * values), egressing nothing — the same read-only-config class as the rulesets
 * probe ({@link hasRequiredChecksRuleset}). Per DR-050 (Amendment 2026-07-16 —
 * materialising the founder's decision on #796) the init/refresh caller runs it
 * AUTONOMOUSLY in the detection path (via {@link resolveTieredRequiredChecks}
 * inputs), with NO prior consent toast — on the same basis as the rulesets read.
 * It opens no socket (delegated to the user's `gh`) and the always-available docs
 * fallback keeps a zero-network path.
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
  // ALL THREE secrets the ai-review.yml guard requires must be present, or the
  // workflow skips (posts a NOTICE, no `ai-review` check) — see REVIEWER_SECRETS.
  return REVIEWER_SECRETS.every((name) => set.has(name));
}

/** Outcome of adding missing contexts to an existing ruleset. */
export interface UpdateRulesetOutcome {
  /** Whether the ruleset now requires all wanted contexts (PUT ok, or already satisfied). */
  updated: boolean;
  /** True on an authorization failure (403 / missing admin). */
  forbidden: boolean;
  /**
   * True when the 403 is a plan limitation rather than a permission problem —
   * same status code, opposite remedy. See {@link isPlanLimited}.
   */
  planLimited: boolean;
  /** GitHub's own explanation, when it returned one. Null rather than a guess. */
  reason: string | null;
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
    const gotAll = got.stdout + got.stderr;
    return {
      updated: false,
      forbidden: isForbidden(gotAll),
      planLimited: isPlanLimited(gotAll),
      reason: githubReason(gotAll),
      detail: got.stderr || got.stdout,
    };
  }
  let detail: RulesetFull;
  try {
    detail = JSON.parse(got.stdout) as RulesetFull;
  } catch {
    return { updated: false, forbidden: false, planLimited: false,
    reason: null,
    detail: 'could not parse the existing ruleset' };
  }
  const rules = Array.isArray(detail.rules) ? detail.rules : [];
  const rule = rules.find((r) => r?.type === 'required_status_checks');
  if (!rule) {
    return { updated: false, forbidden: false, planLimited: false,
    reason: null,
    detail: 'ruleset has no required_status_checks rule' };
  }
  const existing = Array.isArray(rule.parameters?.required_status_checks)
    ? rule.parameters!.required_status_checks!
    : [];
  const have = new Set(existing.map((c) => c?.context));
  const missing = addContexts.filter((c) => !have.has(c));
  if (missing.length === 0) return { updated: true, forbidden: false, planLimited: false,
    reason: null,
    detail: 'already satisfied' };

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
  if (put.code === 0) return { updated: true, forbidden: false, planLimited: false,
    reason: null,
    detail: '' };
  const putAll = put.stdout + put.stderr;
  return {
    updated: false,
    forbidden: isForbidden(putAll),
    planLimited: isPlanLimited(putAll),
    reason: githubReason(putAll),
    detail: put.stderr || put.stdout,
  };
}

// ---------------------------------------------------------------------------
// #1694 · DR-050 Amendment (2026-08-25) — the repo-create advisory
//
// THE DEAD END THIS REPLACES. After "MinSpec: Initialize SDD Structure" in a
// project with no GitHub remote, the ruleset advisory printed one line — "add a
// GitHub remote, then create a branch ruleset — see the GitHub docs" — and
// stopped. It named the obstacle and handed over a documentation page, inside an
// extension that already mutates GitHub config on a click. The two functions
// below let the caller (commands/init.ts) offer the work instead:
// [Create GitHub repo] [Not now] [Learn more]; on the positive click it picks a
// visibility (private by default) and an owner, creates the repository, and falls
// through into the EXISTING ruleset advisory — which now has a repo to probe.
//
// NETWORK POSTURE. The two gating classes described at the top of this file are
// unchanged. What widens is the SUBJECT of one read:
//
//   - {@link probeOwnerCandidates} is an AUTONOMOUS read (no toast in front of
//     it), but of the user's OWN ACCOUNT rather than the repository's settings —
//     every earlier autonomous probe here read repo config. It is ONE endpoint,
//     `/user/memberships/orgs`, because that is the one the amendment enumerates;
//     the personal account is represented by `login: null` rather than by a
//     second `gh api user` read, since `gh repo create <name>` already creates
//     under the signed-in account and an unenumerated endpoint bought only a
//     label. DR-050's amendment records the widening it DOES authorise and
//     attaches two bounds that are load-bearing CONDITIONS of it, not optional
//     hardening:
//
//       1. BRANCH-SCOPED (enforced by the CALLER). It may run only where `gh` is
//          ready AND no GitHub remote resolves — the single branch where the
//          answer changes what is offered. A repo that already resolves a GitHub
//          remote must never trigger it. This module cannot enforce that bound
//          itself (it has no view of the caller's branch), so it is asserted at
//          the seam by the T0 suite: tests/repo-create-advisory.test.ts pins that
//          the memberships read fires exactly once in the no-remote branch and
//          never in any other.
//       2. NO PERSISTENCE. The candidates are returned for immediate use in the
//          picker and then discarded. Nothing here writes them to VS Code
//          settings, workspace/global state, a cache file, or anything under
//          `.minspec/` — this module keeps no state at all, so there is nowhere
//          for the list to linger between calls.
//
//   - {@link createGitHubRepo} is a MUTATION and stays consent-gated exactly as
//     {@link createRequiredChecksRuleset} is: the user's click on "Create GitHub
//     repo" IS the per-action consent. Nothing creates a repository autonomously,
//     and there is no setting that could turn the click into a standing yes
//     (DR-050 bars a global consent toggle).
//
// HONESTY BOUND (never-wrong). A membership's `role: admin` is a PROXY for "an
// org where you could create a repository, and where you could install an App".
// It is NOT evidence that the MinSpec App is installed there. A Tier-0 extension
// cannot establish that at all: with a `gh` OAuth token, GET /user/installations
// answers 403 (it wants a user-to-server token from the App's own OAuth flow) and
// both /orgs/{org}/installation and /repos/{owner}/{repo}/installation answer 401
// (they want an App JWT) — measured 2026-08-25 and recorded in the amendment.
// MinSpec holds no App private key and runs no OAuth flow, so it can mint neither
// credential. Any copy claiming MinSpec DETECTED an installation would therefore
// be false; callers must present this signal as installability ("you could create
// a repo here"), never as detection. The T0 suite holds a deny-list over the
// rendered strings, because prose enforcing prose is the failure mode the
// constitution names.
// ---------------------------------------------------------------------------

/**
 * One candidate owner for a new repository — the authenticated user's personal
 * account, or one of their organisations.
 *
 * ORDER CARRIES THE DEFAULT. {@link probeOwnerCandidates} returns the candidates
 * pre-ranked and `candidates[0]` IS the default pick, so the caller can seed the
 * picker without re-deriving the rule (and cannot derive it differently).
 */
export interface RepoOwnerCandidate {
  /**
   * GitHub login the repository would be created under (`login/<name>`), or
   * `null` for the authenticated user's OWN account.
   *
   * `null` is not "unknown" — it is the positive instruction to omit the owner
   * prefix, which is how `gh repo create <name>` already creates under whichever
   * account `gh` is signed in as. MinSpec therefore never has to LEARN the
   * personal login, and DR-050's 2026-08-25 amendment authorises exactly one new
   * read (`/user/memberships/orgs`) and enumerates no other account endpoint. A
   * `gh api user` read to put a name on this row would be an unenumerated widening
   * of the boundary bought for a label; the label says "your personal account"
   * instead. See {@link createGitHubRepo}, which turns `null` into the bare name.
   */
  login: string | null;
  /** Whether this is the authenticated user's own account or one of their orgs. */
  kind: 'user' | 'org';
  /**
   * Orgs only: the user's membership `role` is `admin`, i.e. they could create a
   * repository there (and could install an App there).
   *
   * A PROXY for installability — NEVER evidence that MinSpec is installed in that
   * org, which a Tier-0 extension cannot establish at all (see the HONESTY BOUND
   * above). Absent or false means "listed and selectable, but never auto-picked".
   */
  canAdminister?: boolean;
}

/**
 * Charset a single GitHub owner or repository path segment may use.
 *
 * The same discipline as `REPO_SLUG_RE` in commands/init.ts, which asserts the
 * JOINED `owner/repo` form — this is its per-segment half, applied to values that
 * arrive from an org picker or a free-text repository-name box before they are
 * interpolated into a `gh` argument. Defense-in-depth: nothing here is
 * shell-interpolated (the runner passes argv directly, never through a shell), so
 * this is not the only thing standing between a hostile string and a shell — it is
 * the assertion made at the point the value reaches the CLI, where a traversal
 * segment (`../../etc`) or a stray `/` would otherwise silently retarget the call.
 */
const REPO_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Upper bound on one segment's length. GitHub caps repository names at 100
 * characters and logins well below that, so this rejects only values GitHub would
 * reject anyway — it exists so a pathological string never reaches `gh` at all.
 *
 * Exported because the copy that explains a `too-long` rejection must QUOTE it
 * rather than repeat the number — a second literal is how a cap and its
 * explanation drift apart.
 */
export const MAX_REPO_SEGMENT_LENGTH = 100;

/**
 * WHICH rule rejected a segment — one member per rejection, never one per
 * outcome.
 *
 * THIS UNION IS THE FIX, NOT THE SENTENCES DOWNSTREAM OF IT (fifth correctness
 * review, 2026-08-29). {@link isSafeRepoSegment} applies FIVE distinct rules and
 * used to answer with one bit, so every caller that wanted to EXPLAIN a rejection
 * had to guess which rule fired. The one sentence they all guessed with — "Use
 * letters, numbers, dots, dashes or underscores — no spaces or slashes" — was
 * false for three of the five, and captured from the live validator:
 *
 *     ""            letters and dashes are not the problem; emptiness is
 *     "-lead"       letters + a dash only, and the message permits both
 *     ".."          dots only, and the message permits dots
 *     "a" x101      letters only; the length cap is never mentioned
 *     "has space"   correct, and the only one it was ever true of
 *
 * A branch set coarser than the predicate it explains is the GENERATOR of that
 * defect class, so the branch set is what widened.
 */
export type RepoSegmentRejection =
  /** Not a string at all — the value never had a chance to be a name. */
  | 'not-text'
  /** The empty string. Nothing was typed. */
  | 'empty'
  /** Longer than {@link MAX_REPO_SEGMENT_LENGTH}, which GitHub itself refuses. */
  | 'too-long'
  /** Outside {@link REPO_SEGMENT_RE} — a slash, space, quote or shell metacharacter. */
  | 'charset'
  /** A LEADING `-`, which `gh` reads as a command-line flag. Every character is legal. */
  | 'leading-dash'
  /** Only dots (`.`, `..`) — path traversal wearing a legal charset. */
  | 'dots-only';

/**
 * Whose name is being explained. The rules are identical for both halves of an
 * `owner/repo` slug; only the noun in the sentence differs, and getting it wrong
 * ("a repository name cannot be empty" about an organisation) is a small lie in
 * the one place the user is already confused.
 */
export type RepoSegmentSubject = 'repository name' | 'account name';

/**
 * WHICH rule rejects `value` as ONE segment of an `owner/repo` slug, or `null`
 * when nothing does.
 *
 * THE single source of truth for the rule set. {@link isSafeRepoSegment} is this
 * function reduced to a bit, so the box's validator, the CLI-boundary assertion
 * and the explanation all read the SAME predicate — the shared-predicate property
 * the two callers were built around is preserved exactly, and it now carries the
 * reason with it instead of dropping it.
 *
 * Order matters and is the order a reader would apply them: existence, then
 * length, then charset, then the two rules the charset cannot express (a leading
 * `-` is made of legal characters, and so is `..`).
 */
export function checkRepoSegment(value: unknown): RepoSegmentRejection | null {
  if (typeof value !== 'string') return 'not-text';
  if (value.length === 0) return 'empty';
  if (value.length > MAX_REPO_SEGMENT_LENGTH) return 'too-long';
  if (!REPO_SEGMENT_RE.test(value)) return 'charset';
  if (value.startsWith('-')) return 'leading-dash';
  if (/^\.+$/.test(value)) return 'dots-only';
  return null;
}

/**
 * ONE SENTENCE PER REJECTION, stating the rule that actually fired and nothing
 * else.
 *
 * Every sentence is a clause, lower-case and unterminated, so a caller can set it
 * in whatever frame it needs ("MinSpec: …, so nothing was created.") without the
 * copy being written twice. The `never`-typed default is the coupling: a rejection
 * added to {@link RepoSegmentRejection} without a sentence of its own fails
 * `npm run typecheck` rather than silently inheriting one — which is exactly how
 * one sentence came to answer for five rules.
 */
export function describeRepoSegmentRejection(
  rejection: RepoSegmentRejection,
  subject: RepoSegmentSubject = 'repository name',
): string {
  switch (rejection) {
    case 'not-text':
      return `a ${subject} has to be text`;
    case 'empty':
      return `a ${subject} cannot be empty`;
    case 'too-long':
      return `a ${subject} must be ${MAX_REPO_SEGMENT_LENGTH} characters or fewer`;
    case 'charset':
      return (
        `a ${subject} may use only letters, numbers, dots, dashes and underscores — ` +
        'no spaces or slashes'
      );
    case 'leading-dash':
      return `a ${subject} cannot start with a dash, which \`gh\` would read as a command-line flag`;
    case 'dots-only':
      return `a ${subject} cannot be only dots — \`.\` and \`..\` name directories, not repositories`;
    default: {
      // EXHAUSTIVENESS. Compile time: a new rejection without copy narrows to
      // something other than `never` and fails typecheck. Runtime: it answers
      // with the only thing true of every rejection, because this is called from
      // a validator whose throw would break the input box.
      const _unhandled: never = rejection;
      void _unhandled;
      return `that is not a ${subject} MinSpec can safely hand to \`gh\``;
    }
  }
}

/**
 * Is `value` usable as ONE segment of an `owner/repo` slug — safe to hand to `gh`
 * as an argument?
 *
 * The BIT form of {@link checkRepoSegment}, kept because most callers only need
 * to decide, not to explain. It is defined in terms of that function rather than
 * repeating the rules, so the predicate the box validates with, the predicate
 * {@link createGitHubRepo} re-asserts at the CLI boundary, and the predicate the
 * EXPLANATION is derived from cannot drift apart — the failure that produced one
 * sentence for five rules.
 *
 * {@link createGitHubRepo} re-checks regardless of what the caller did, so a
 * caller that forgets cannot widen it.
 */
export function isSafeRepoSegment(value: unknown): value is string {
  return checkRepoSegment(value) === null;
}

/**
 * The organisations the user is an ACTIVE member of, each flagged with whether
 * their role is `admin`, via `gh api user/memberships/orgs`.
 *
 * `memberships` rather than `/user/orgs` because both return the same orgs on the
 * same `read:org` scope, but `memberships` also carries `role` and `state` — the
 * two fields the ordering rule needs. Preferring the weaker endpoint would buy no
 * privacy and lose the signal (DR-050 Amendment 2026-08-25).
 *
 * `per_page=100` reads a single page: pagination would need `--paginate`, which
 * concatenates one JSON array per page and so cannot be parsed as one document.
 * A user in more orgs than that gets a truncated list, which still yields a
 * working picker — the same fail-safe direction as every other failure here.
 *
 * FAIL-SAFE, AND IT SAYS SO: `null` — never `[]` — on a non-zero exit, a spawn
 * rejection, unparseable output, or output that is not an array. Never throws.
 *
 * `null` vs `[]` IS THE POINT (correctness review 2026-08-28). Folding a failed
 * read into an empty list makes "you belong to no organisations" and "MinSpec
 * could not read your organisations" the same value, and the caller then renders
 * the first sentence for both — silently removing the owner choice from a user
 * whose token merely lacks `read:org` (or who has a `GITHUB_TOKEN` inherited from
 * the environment, which `gh` prefers). That is the plausible-inference-as-
 * observation defect this codebase keeps re-finding, in the one place where it
 * costs the user the destination they actually wanted.
 *
 * A membership whose `state` is not `active` (a pending invitation) is dropped
 * ENTIRELY — it is not somewhere the user can create a repository, so listing it
 * would offer a destination that cannot work. That is a filtered ROW, not a
 * failed read, so it still answers with an array.
 */
async function readActiveOrgMemberships(run: CommandRunner): Promise<RepoOwnerCandidate[] | null> {
  const res = await runSafe(run, 'gh', ['api', 'user/memberships/orgs?per_page=100']);
  if (res.code !== 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const seen = new Set<string>();
  const orgs: RepoOwnerCandidate[] = [];
  for (const entry of parsed) {
    const membership = entry as {
      state?: unknown;
      role?: unknown;
      organization?: { login?: unknown };
    } | null;
    if (membership?.state !== 'active') continue;
    const login = membership?.organization?.login;
    if (!isSafeRepoSegment(login)) continue;
    if (seen.has(login)) continue;
    seen.add(login);
    orgs.push({ login, kind: 'org', canAdminister: membership.role === 'admin' });
  }
  return orgs;
}

/**
 * Where could this user put a new repository? Returns the personal account plus
 * every organisation they actively belong to, PRE-RANKED so that
 * `candidates[0]` is the default pick.
 *
 * THE RANKING RULE (the whole point of the read):
 *   - Exactly ONE active org with `role: admin` ⇒ that org leads. One
 *     unambiguous answer to "where would this go?" is worth defaulting to; the
 *     personal account stays in the list, one keystroke away, never replaced.
 *   - Zero, or two-or-more, admin orgs ⇒ the PERSONAL account leads, with
 *     admin-capable orgs ordered ahead of member-only ones. Ambiguity is not
 *     resolved by guessing: with two candidates equally plausible, defaulting to
 *     either one is a coin toss that creates a repository in the wrong place.
 *   - A member-only org is LISTED but never leads — the user may well have create
 *     rights there, but we have not established it, so it is offered, not assumed.
 *
 * NETWORK POSTURE — AUTONOMOUS, BRANCH-SCOPED, NON-PERSISTING. Exactly ONE GET,
 * `/user/memberships/orgs`, through the user's own `gh`, egressing nothing. That
 * single endpoint is the whole of what DR-050's 2026-08-25 amendment authorises,
 * and the amendment enumerates no other — so the personal account is represented
 * by `login: null` (an instruction to omit the owner prefix) rather than by a
 * second `gh api user` read that nothing has sanctioned. Its two bounds are
 * conditions of the amendment rather than hardening: the CALLER must invoke this
 * ONLY where `gh` is ready and no GitHub remote resolves, and the result must not
 * be persisted anywhere. See the section comment above.
 *
 * FAIL-SAFE (never throws, never blocks the init). A failure of the memberships
 * read — the common case is a token without `read:org`, but also an unauthed `gh`,
 * a rate limit, or malformed output — yields the personal account ALONE, so the
 * offer still works and simply cannot name an org. No org can ever leak out of a
 * failed read, and the personal row needs no successful read to exist: `gh repo
 * create <name>` creates under whichever account `gh` is signed in as, which
 * {@link probeGhReadiness} has already established there is one of.
 *
 * ...AND IT REPORTS WHICH FAIL-SAFE FIRED. `orgsRead` is `false` exactly when the
 * read did not complete, so the caller can say "MinSpec could not read your
 * organisations" instead of implying there are none. Reporting that the read
 * failed is not persistence and not an org name — it violates none of the
 * amendment's bounds, which are about the org LIST.
 */
export async function probeOwnerCandidates(run: CommandRunner): Promise<OwnerProbe> {
  const personal: RepoOwnerCandidate = { login: null, kind: 'user' };

  const read = await readActiveOrgMemberships(run);
  const orgs = read ?? [];
  const adminOrgs = orgs.filter((o) => o.canAdminister);
  const memberOrgs = orgs.filter((o) => !o.canAdminister);

  // Exactly one place the user could obviously mean → default to it.
  const candidates =
    adminOrgs.length === 1
      ? [adminOrgs[0], personal, ...memberOrgs]
      : // Zero or ambiguous → the personal account leads; admin-capable orgs first.
        [personal, ...adminOrgs, ...memberOrgs];

  return { candidates, orgsRead: read !== null };
}

/**
 * What {@link probeOwnerCandidates} established — the destinations AND whether the
 * org read that would have found them actually completed.
 *
 * Two fields because a one-element list has two very different causes: the user
 * belongs to no organisations, or MinSpec could not read them. The UI must be able
 * to tell them apart, since the second one is silently withholding a destination
 * the user may have been looking for.
 */
export interface OwnerProbe {
  /** Pre-ranked destinations; `candidates[0]` IS the default pick. Never empty. */
  readonly candidates: RepoOwnerCandidate[];
  /**
   * The `/user/memberships/orgs` read COMPLETED (whatever it returned).
   *
   * `false` means MinSpec knows nothing about the user's orgs — not that there are
   * none. The caller must say so rather than render a shorter list as a complete
   * one.
   */
  readonly orgsRead: boolean;
}

/**
 * Why a create did not produce a repository we can name.
 *
 * ONE MEMBER PER REJECTION REASON, NOT PER OUTCOME TYPE (fifth correctness
 * review, 2026-08-29). This union carried THREE members while the failures it
 * classifies have five shapes, and the caller derives BOTH its sentence AND
 * whether to offer a retry from it — so every shape that fell into the leftover
 * member inherited the leftover member's remedy. Reproduced with a member-only
 * org picked and the create failing:
 *
 *     GraphQL: acme has repository creation disabled for members (createRepository)
 *     gh: Resource protected by organization SAML enforcement (HTTP 403)
 *
 * Both landed on `unconfirmed`, which gets "Try another name" — so MinSpec fired
 * THREE identical `gh repo create` calls at a destination GitHub had just said it
 * could not write to, and the owner picker had PREDICTED it one step earlier
 * ("your membership role is member, so creating here may be refused").
 *
 * AND THEN THE SAME RULE APPLIED TO THE FIX (sixth correctness review,
 * 2026-08-30). The single `refused` member that replaced them was itself one
 * member for the FIVE shapes {@link classifyCreateRefusal} matches, and its
 * sentence prescribed a permission remedy — so the SAML refusal above, the one
 * whose reproduction motivated the member, was answered with "ask an owner for
 * repository-creation rights", which no owner can grant. `refused` is now three
 * members, one per remedy.
 *
 * Only `not-attempted` is a claim that NOTHING was created — because nothing ran.
 * `unconfirmed` is deliberately named for what it is: `gh repo create --source`
 * creates the repository through the API and only THEN runs `git remote add`, so
 * a non-zero exit is never evidence that the repository is absent.
 */
export type CreateRepoFailure =
  /** The segment guard refused before any command ran. Nothing was created. */
  | 'not-attempted'
  /** GitHub said a repository of that name already exists on that account. */
  | 'name-taken'
  /**
   * The DESTINATION refused because of an ORG POLICY, stated in words: this
   * member may not create repositories there. An owner of that account can lift
   * it, and a different account sidesteps it. A different NAME cannot.
   */
  | 'refused-policy'
  /**
   * The DESTINATION refused on SAML/SSO grounds: the token `gh` is using is not
   * authorised for that organisation's single sign-on.
   *
   * ITS OWN MEMBER, NOT A SHADE OF `refused-policy` (sixth correctness review,
   * 2026-08-30). The two arrived together under one member whose sentence read
   * "Ask an owner of `acme` for repository-creation rights" — advice that cannot
   * lift a SAML block no matter who grants it, because the thing that has to
   * change is the TOKEN's SSO authorisation, not the caller's role.
   */
  | 'refused-sso'
  /**
   * The DESTINATION refused and GitHub named the CALLER'S ROLE: the account `gh`
   * is signed in as must be an admin of that account and is not.
   *
   * ITS OWN MEMBER (seventh correctness review, 2026-08-30), for the same reason
   * `refused-sso` is: a role IS grantable, so "ask an owner" is the remedy that
   * fits it, and a sentence calling it "a policy on the destination" asserts a
   * policy nobody observed.
   */
  | 'refused-role'
  /**
   * The DESTINATION refused and GitHub named the TOKEN: this resource is not
   * accessible to the credential `gh` is holding.
   *
   * NO OWNER GRANT LIFTS THIS, which is the whole reason it is not
   * `refused-role` (seventh correctness review, 2026-08-30). Reproduced with the
   * shape an inherited `GITHUB_TOKEN` produces — the credential `gh` PREFERS
   * over its stored one:
   *
   *     gh: Resource not accessible by integration (HTTP 403)
   *       -> classifyCreateRefusal (before) -> 'permission'
   *       -> rendered  "Ask an owner of `acme` for repository-creation rights"
   *
   * The thing that has to change is which token `gh` is using, and no role an
   * owner can grant changes that.
   */
  | 'refused-token'
  /**
   * The DESTINATION refused, and nothing in the output said whether a policy, a
   * role or a scope did it. A different NAME still cannot change it; which
   * remedy applies is exactly what was NOT established, so the sentence names
   * the checks rather than a cause.
   */
  | 'refused-permission'
  /**
   * The destination refused on PLAN grounds — private repositories, or
   * repositories in that org at all, are not available on its plan. Neither a
   * different name nor a different owner fixes it; public visibility or a paid
   * plan does. Kept apart from the three `refused-*` members because sending a
   * user to ask an admin for permission they already have is the
   * remedy-contradicts-reason defect `describeRulesetFailure`
   * (commands/init.ts) already fixed one level up.
   */
  | 'plan-limited'
  /** The create failed and NOTHING established whether the repository exists. */
  | 'unconfirmed';

/**
 * WHICH way the DESTINATION refused this create — as opposed to the create
 * failing for a reason nobody established.
 *
 * Built on {@link isForbidden}, the predicate that already existed in this module
 * and was never consulted on the create path, so no 403 was classifiable at all.
 * It is NOT sufficient on its own, and the measured evidence is why: of the two
 * refusals reproduced against real orgs, only the SAML one carries a status code
 * (`(HTTP 403)`), while GitHub's org-policy refusal is a bare GraphQL sentence —
 *
 *     GraphQL: acme has repository creation disabled for members (createRepository)
 *
 * — with no 403, no "forbidden" and no "must have admin" anywhere in it. Matching
 * only the shapes {@link isForbidden} knows would leave that one classified as
 * `unconfirmed` and retried, which is the defect these members exist to stop.
 * So the policy phrasings are named explicitly, each one a refusal GitHub states
 * in words rather than in a status line.
 *
 * PLAN LIMITS ARE DELIBERATELY NOT HERE. {@link isPlanLimited} is checked FIRST by
 * the caller, exactly as `describeRulesetFailure` (commands/init.ts) orders them,
 * because a plan limit is usually a 403 too and the permission wording would
 * otherwise swallow it.
 *
 * ...AND `permission` WAS ITSELF A BIT (seventh correctness review, 2026-08-30).
 * Its arm read `/\bnot authorized\b/ || isForbidden(haystack)`, and
 * {@link isForbidden} is the BIT FORM of {@link classifyForbidden} — a
 * four-member union computed and discarded one line before the decision that
 * needed it. FIVE observations therefore arrived at the caller wearing one
 * member whose sentence prescribed an owner grant, and one of them cannot be
 * granted by anyone:
 *
 *     gh: Resource not accessible by integration (HTTP 403)   -> the TOKEN
 *     gh: HTTP 403: Must have admin rights to Repository.      -> the ROLE
 *
 * So the shapes {@link classifyForbidden} already names are CARRIED rather than
 * collapsed, through {@link FORBIDDEN_CREATE_REFUSAL} — a total map, so a shape
 * added there without a decision here fails `npm run typecheck`.
 */
export type CreateRefusalShape =
  /** An org policy, stated in words: this member may not create repositories here. */
  | 'org-policy'
  /** SAML / single sign-on: the token is not authorised for that organisation. */
  | 'sso'
  /** GitHub named the caller's ROLE — it must be an admin. An owner can grant that. */
  | 'role'
  /** GitHub named the TOKEN — the resource is not accessible to it. No owner grant helps. */
  | 'token'
  /** GitHub said "not authorized" in words, with no status code and nothing more specific. */
  | 'not-authorized'
  /** A STATED 403 with nothing more specific in it. The status code was observed. */
  | 'status-403'
  /** The refusal is worded ("forbidden") and carries NO status code. */
  | 'refusal-unstated';

/**
 * {@link ForbiddenShape} to the create-refusal shape that carries it.
 *
 * A TOTAL MAP rather than a ladder, so the two unions are coupled at compile
 * time: this is the seam where the fifth review's fix threw the shape away, and
 * a `Record` cannot silently lose one.
 */
const FORBIDDEN_CREATE_REFUSAL: Record<ForbiddenShape, CreateRefusalShape> = {
  'not-admin': 'role',
  'resource-not-accessible': 'token',
  'status-403': 'status-403',
  'refusal-unstated': 'refusal-unstated',
};

/**
 * WHICH refusal this `gh repo create` output carries, or `null` when it is not a
 * refusal at all.
 *
 * ONE MEMBER PER REJECTION REASON (sixth correctness review, 2026-08-30). This
 * predicate matched FIVE shapes and answered with one bit, so the caller had one
 * member and one sentence for all of them — the exact collapse
 * {@link RepoSegmentRejection} fixed one level down, re-introduced by the fix
 * for it one level up. The remedies do not overlap:
 *
 *     GraphQL: acme has repository creation disabled for members   -> an OWNER lifts it
 *     gh: Resource protected by organization SAML enforcement      -> the TOKEN's SSO does
 *
 * ORDER IS LOAD-BEARING. The SAML message carries `(HTTP 403)`, so it satisfies
 * {@link classifyForbidden} too — asking the generic permission arm first would
 * swallow it and hand a SAML block a remedy about roles. The SET this accepts is
 * exactly the set the bool accepted; only the reporting got finer.
 *
 * AND THE THIRD ARM NO LONGER DISCARDS A UNION (seventh correctness review,
 * 2026-08-30). It read `/\bnot authorized\b/ || isForbidden(haystack)` — the BIT
 * form of {@link classifyForbidden}, whose four members it had just computed —
 * so a token refusal and a role refusal left here indistinguishable. It now asks
 * {@link classifyForbidden} itself and carries the answer through
 * {@link FORBIDDEN_CREATE_REFUSAL}.
 *
 * THE ORDER OF THE LAST TWO IS THE MORE SPECIFIC ONE FIRST, and it changes no
 * decision: `not authorized` is asked only where {@link classifyForbidden} found
 * nothing, and every shape either of them can produce beyond `role`/`token` maps
 * to the same failure member. The SET is unchanged — it is the union it always
 * was.
 */
export function classifyCreateRefusal(haystack: string): CreateRefusalShape | null {
  if (/repository creation (?:is )?disabled/i.test(haystack)) return 'org-policy';
  if (/\bsaml\b/i.test(haystack) || /\bsingle sign[- ]on\b/i.test(haystack)) return 'sso';
  const forbidden = classifyForbidden(haystack);
  if (forbidden !== null) return FORBIDDEN_CREATE_REFUSAL[forbidden];
  if (/\bnot authorized\b/i.test(haystack)) return 'not-authorized';
  return null;
}

/**
 * The BIT form of {@link classifyCreateRefusal}, defined in terms of it so the
 * decision and the explanation can never disagree about what counts as a refusal
 * — the same shared-predicate discipline {@link isSafeRepoSegment} keeps with
 * {@link checkRepoSegment}.
 */
export function isCreateRefused(haystack: string): boolean {
  return classifyCreateRefusal(haystack) !== null;
}

/** Outcome of an attempt to create a repository via `gh`. */
export interface CreateRepoResult {
  /**
   * The repository EXISTS — OBSERVED, never inferred from the exit code alone.
   *
   * `true` when `gh` exited 0, and ALSO when it did not but `git remote get-url
   * origin` afterwards names a GitHub repository: `gh repo create --source`
   * creates through the API and then adds the remote, so a wired `origin` proves
   * the create already happened. This is the half that used to be assumed — see
   * {@link createGitHubRepo}'s VERIFY note.
   */
  ok: boolean;
  /**
   * `origin` was OBSERVED to name a GitHub repository after the call.
   *
   * The SECOND half of what `ok` used to claim on its own, kept separate because
   * the two can genuinely disagree: a create that succeeds and then fails to add
   * the remote leaves a repository with no `origin`, and a toast saying MinSpec
   * "set it as this project's origin remote" would then be false.
   */
  remoteWired: boolean;
  /**
   * `owner/name` of the repository, from the strongest evidence available: the
   * wired `origin` first, then what `gh` printed, then what we requested.
   *
   * Absent on failure — and ALSO absent in one success case: a create under the
   * personal account (`owner: null`, so there is no requested slug to fall back
   * on) whose output {@link parseCreatedSlug} did not recognise and whose remote
   * was not wired. `ok: true` with no `slug` therefore means "the repository
   * exists, and MinSpec cannot name it"; a caller must not read the missing slug
   * as a failed create, because saying the create failed when it succeeded is the
   * false claim this product cannot ship.
   */
  slug?: string;
  /**
   * Which failure this was, so the caller's REMEDY can match the reason it
   * quotes. Absent on success. See {@link CreateRepoFailure} — in particular,
   * only `not-attempted` licenses saying the repository was not created.
   */
  failure?: CreateRepoFailure;
  /**
   * Why it failed — GitHub's or `gh`'s OWN words wherever they said anything, and
   * our own refusal message when the call was never made. Absent on success. Never
   * a guessed cause: reporting a cause we have not established is the defect
   * {@link githubReason} exists to prevent.
   */
  error?: string;
}

/**
 * Pull `owner/name` out of what `gh repo create` printed on success. `null` when
 * nothing gh DOCUMENTS as its success output was printed.
 *
 * Preferring what `gh` REPORTED over what we requested matters because GitHub may
 * normalise a name at creation time; echoing our own request back would then name
 * a repository that does not exist — and the caller feeds this slug straight into
 * the ruleset probe, where a wrong name is a 404 blamed on the wrong thing.
 *
 * MATCHES ONLY gh's TWO DOCUMENTED SHAPES, both WHOLE-LINE, and both anchored:
 *
 *   1. interactive/TTY — `✓ Created repository OWNER/NAME on GitHub` (the leading
 *      tick is gh's own decoration and the trailing ` on GitHub` is part of the
 *      sentence, so both are matched rather than ignored);
 *   2. non-TTY — a line that is NOTHING BUT the repository URL, whose path is
 *      exactly two segments. An optional `.git`/trailing `/` is dropped: the clone
 *      URL carries the suffix and the slug must not, or every subsequent
 *      `repos/OWNER/NAME.git/...` read 404s.
 *
 * WHY IT IS THIS STRICT. The previous version took the FIRST http(s) URL anywhere
 * in stdout. Anything gh prints ahead of the repository — a `gh` release-upgrade
 * notice, an SSO/`Warning:` line, an enterprise MOTD, a proxy banner — carries a
 * URL, and the slug scraped out of it names a DIFFERENT repository, which is then
 * fed straight into the fall-through ruleset advisory as if it were the user's new
 * repo. A whole-line anchor makes prose-with-a-URL structurally unmatchable.
 *
 * REFUSES TO GUESS. If two DIFFERENT slugs both satisfy the URL form, `null` — the
 * caller falls back to the slug it requested (or, having requested none, reports
 * the create as unnameable). Picking one of two candidate repositories arbitrarily
 * is how a subsequent write lands on the wrong one, the same reason
 * `chooseRemote` declines an ambiguous remote rather than picking.
 */
function parseCreatedSlug(stdout: string): string | null {
  const lines = stdout.split('\n').map((l) => l.trim());

  const CREATED_LINE =
    /^(?:[^\w\s]\s*)?Created repository\s+([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\s+on\s+GitHub\b/;
  for (const line of lines) {
    const created = CREATED_LINE.exec(line);
    if (created) return `${created[1]}/${created[2]}`;
  }

  // A line consisting SOLELY of the repository URL — gh's non-TTY output.
  const URL_LINE = /^https?:\/\/[^\s/]+\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;
  const found = new Set<string>();
  for (const line of lines) {
    const url = URL_LINE.exec(line);
    if (url) found.add(`${url[1]}/${url[2]}`);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * A `github.com` remote URL, in the two forms `git remote add` writes, reduced to
 * `owner/name` — or `null` for anything else.
 *
 * DELIBERATELY LOCAL rather than {@link githubSlugFromUrl} from `lib/git-remotes`.
 * That module already imports `CommandRunner` from this one as a TYPE, and type
 * edges are erased; importing a VALUE back would close that cycle for real and
 * `npm run check:cycles` (SPEC-040 FR-2) would fail. The duplication is one anchored
 * regex, and it is stricter than the shared one on purpose: it must match the WHOLE
 * URL, because this value is what the success toast will NAME.
 */
const ORIGIN_GITHUB_SLUG_RE =
  /^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)github\.com[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * Read `origin`'s URL and reduce it to `owner/name`; `null` when there is no
 * `origin`, when the read fails, or when it is not a github.com URL.
 *
 * ONE LOCAL git read, through the injected runner — no network, nothing new at the
 * Tier-0 boundary. It is the witness {@link createGitHubRepo} uses instead of
 * inferring both halves of its claim from an exit code.
 */
async function readOriginSlug(folder: string, run: CommandRunner): Promise<string | null> {
  const res = await runSafe(run, 'git', ['-C', folder, 'remote', 'get-url', 'origin']);
  if (res.code !== 0) return null;
  const match = ORIGIN_GITHUB_SLUG_RE.exec(res.stdout.trim());
  if (!match) return null;
  return isSafeRepoSegment(match[1]) && isSafeRepoSegment(match[2]) ? `${match[1]}/${match[2]}` : null;
}

/**
 * Does `slug` name the repository this create ASKED for?
 *
 * The owner half is checked only when one was requested: on the personal-account
 * path `owner` is `null` — the instruction to omit the prefix — and MinSpec never
 * learns the login it would compare against, so the name half is the whole of what
 * it can honestly assert there.
 */
function originNames(slug: string, owner: string | null, name: string): boolean {
  const [slugOwner, slugName] = slug.split('/');
  return slugName === name && (owner === null || slugOwner === owner);
}

/**
 * Did GitHub refuse because a repository of that name ALREADY EXISTS on the target
 * account?
 *
 * `gh repo create` surfaces this as GitHub's own GraphQL message, `Name already
 * exists on this account`. It is the failure this flow hits most — the name box is
 * seeded with the folder's basename and does no existence check — and it is the one
 * where the generic remedy ("create it on GitHub yourself") contradicts the reason
 * printed beside it. Classifying it lets the caller answer with the remedy that can
 * actually work: a different name.
 */
function isNameTaken(haystack: string): boolean {
  return /name already exists/i.test(haystack) || /repository .{0,40}already exists/i.test(haystack);
}

/**
 * Create a repository on GitHub at the chosen visibility and wire it as this
 * folder's `origin` remote, by shelling the user's own `gh`.
 *
 * MUTATION — the caller MUST only invoke this on the user's explicit "Create
 * GitHub repo" click; that click IS the consent (DR-050, Amendment 2026-08-25).
 * Nothing here may run autonomously.
 *
 * `gh repo create <target> --private|--public --source <folder> --remote origin`
 * is one call that both creates the repository and adds the remote, so there is
 * no window where the repository exists but the working tree does not know about
 * it. It deliberately does NOT pass `--push`: creating an empty repository and
 * pointing the tree at it is the smallest act that unblocks the ruleset advisory,
 * and pushing the user's code to a newly-named remote is a separate decision they
 * have not been asked about.
 *
 * `owner` IS NULLABLE, AND THAT IS THE PERSONAL-ACCOUNT PATH. `null` sends the
 * bare `<name>`, which `gh` creates under whichever account it is signed in as.
 * That is why MinSpec never needs to read the user's login: the only account read
 * DR-050's 2026-08-25 amendment enumerates is `/user/memberships/orgs`, and a
 * `gh api user` call to learn a login MinSpec does not need would be an
 * unenumerated widening of the Tier-0 boundary. On this path there is no
 * requested slug to fall back on, so an unrecognised gh output yields
 * `{ ok: true }` with NO slug — the repository exists and we decline to name it,
 * rather than assert a name we did not read.
 *
 * VISIBILITY NEVER WIDENS SILENTLY. Anything other than an explicit `'public'`
 * yields `--private`, so a malformed or unexpected value fails CLOSED (private) —
 * the direction where a mistake is recoverable.
 *
 * CHARSET ASSERTION AT THE CLI BOUNDARY. `name`, and `owner` when one is given,
 * are re-checked with {@link isSafeRepoSegment} here, whatever the caller already
 * did, and a failure returns `{ ok: false }` having run NO command at all. Only
 * `null` — never `''` or `undefined` — means "personal account": an accidentally
 * empty owner is a bug, and treating it as consent to create somewhere else is
 * exactly the silent retarget the assertion exists to stop. `folder` is checked
 * only for the two things that would break the call — empty, or a leading `-`
 * that `gh` would read as a flag — since it is a path the editor supplied, not
 * user text.
 *
 * VERIFY, DO NOT INFER (correctness review 2026-08-28). `ok` used to be
 * `res.code === 0` while its docstring promised "created AND wired as the local
 * remote" — two claims, neither checked. `gh repo create --source` creates the
 * repository through the API and only THEN runs `git remote add`, and
 * {@link defaultCommandRunner} gives it a 15s `execFile` timeout: on the SIGTERM
 * kill Node sets `err.code = null`, the runner rejects, {@link runSafe}
 * normalises that to `{ code: 127 }` — and the user was told the create failed
 * about a repository sitting on GitHub, with a remedy ("create it yourself") that
 * answers "Name already exists on this account". So ONE local read,
 * {@link readOriginSlug}, settles both halves after the call: a wired `origin`
 * proves the create happened AND names it, and its absence is reported as an
 * unconfirmed create rather than as a failed one.
 *
 * NEVER THROWS. A non-zero exit or a spawn rejection comes back as
 * `{ ok: false, failure, error }`, quoting GitHub's own message where there is
 * one, so the caller can render a real reason and a remedy that matches it.
 */
export async function createGitHubRepo(
  folder: string,
  owner: string | null,
  name: string,
  visibility: 'private' | 'public',
  run: CommandRunner,
): Promise<CreateRepoResult> {
  const refuse = (error: string): CreateRepoResult => ({
    ok: false,
    remoteWired: false,
    failure: 'not-attempted',
    error,
  });
  // EACH REFUSAL NAMES THE RULE IT APPLIED. These strings are quoted verbatim in
  // the toast the user reads, so a message covering five rules with one sentence
  // was a message wrong three times out of five — see {@link RepoSegmentRejection}.
  const ownerRejection = owner === null ? null : checkRepoSegment(owner);
  if (ownerRejection !== null) {
    return refuse(
      `not a usable GitHub owner name: ${JSON.stringify(owner)} — ` +
        describeRepoSegmentRejection(ownerRejection, 'account name'),
    );
  }
  const nameRejection = checkRepoSegment(name);
  if (nameRejection !== null) {
    return refuse(
      `not a usable repository name: ${JSON.stringify(name)} — ` +
        describeRepoSegmentRejection(nameRejection),
    );
  }
  // The folder is a path the EDITOR supplied, not user text, so only the two
  // things that would break the call are checked — but they are two DIFFERENT
  // things, and one sentence for both is the same collapse one scale down.
  if (typeof folder !== 'string') {
    return refuse(`not a usable source folder: ${JSON.stringify(folder)} — it is not text`);
  }
  if (folder.trim().length === 0) {
    return refuse(`not a usable source folder: ${JSON.stringify(folder)} — it is empty`);
  }
  if (folder.startsWith('-')) {
    return refuse(
      `not a usable source folder: ${JSON.stringify(folder)} — a path starting with a dash ` +
        'would be read by `gh` as a command-line flag',
    );
  }

  // `owner === null` → the bare name, which `gh` creates under the signed-in
  // account. `requested` is the fallback slug, and there is deliberately none on
  // that path: we would have to invent the owner half.
  const target = owner === null ? name : `${owner}/${name}`;
  const requested = owner === null ? null : target;
  const visibilityFlag = visibility === 'public' ? '--public' : '--private';
  const res = await runSafe(run, 'gh', [
    'repo',
    'create',
    target,
    visibilityFlag,
    '--source',
    folder,
    '--remote',
    'origin',
  ]);

  // THE WITNESS. Read AFTER the call whatever it reported, because the exit code
  // is evidence about the COMMAND and this is evidence about the REPOSITORY.
  //
  // ...but only when `origin` names THE REPOSITORY WE ASKED FOR. An `origin`
  // pointing somewhere else is not evidence that this create succeeded — it is a
  // remote that was already there — and reading it as one would report a
  // stranger's repository as "created". The caller reaches this function only
  // where no remote exists, so in practice the check never rejects a real wire-up;
  // it is here because `ok` must be true only of what was actually observed.
  const observed = await readOriginSlug(folder, run);
  const originSlug = observed !== null && originNames(observed, owner, name) ? observed : null;

  if (res.code === 0 || originSlug !== null) {
    // `origin` is the strongest evidence there is — it is what this working tree
    // will actually push to — so it outranks gh's stdout, which in turn outranks
    // the name we asked for.
    const slug = originSlug ?? parseCreatedSlug(res.stdout) ?? requested;
    const wired = originSlug !== null;
    return slug ? { ok: true, remoteWired: wired, slug } : { ok: true, remoteWired: wired };
  }

  const haystack = `${res.stdout}\n${res.stderr}`;
  return {
    ok: false,
    remoteWired: false,
    // NOT "the repository was not created": nothing here established that. The
    // create may have succeeded and the process died before wiring the remote.
    //
    // ONE MEMBER PER REJECTION REASON. This used to be a two-way ternary while
    // the failures had five shapes, so a 403, a SAML block and an org policy all
    // arrived at the caller wearing `unconfirmed` — and inherited its remedy,
    // "try another name", which fired two more creates at a destination GitHub
    // had already refused.
    //
    // ORDER IS LOAD-BEARING, and it is the same order `describeRulesetFailure`
    // (commands/init.ts) uses for the same reason: a plan limit is a 403 too, so
    // {@link isPlanLimited} must be asked before {@link isCreateRefused} or the
    // permission wording swallows it and sends the user to ask an admin for
    // permission they already have.
    failure: classifyCreateFailure(haystack),
    error: githubReason(haystack) ?? ((res.stderr || res.stdout).trim() || 'gh reported no detail'),
  };
}

/**
 * Which {@link CreateRepoFailure} this `gh` output is — the whole classification
 * in one place, so the union and the test that walks every member of it read the
 * same ladder.
 *
 * `name-taken` first: GitHub reports it as a plain GraphQL sentence that carries
 * no status code, so a later arm would never see it. Then the plan limit, then
 * the permission/policy refusal, for the reason above. Anything left is
 * `unconfirmed`, and that residue is the honest answer: we did not establish why,
 * and we did not establish that the repository is absent.
 */
function classifyCreateFailure(haystack: string): CreateRepoFailure {
  if (isNameTaken(haystack)) return 'name-taken';
  if (isPlanLimited(haystack)) return 'plan-limited';
  const refusal = classifyCreateRefusal(haystack);
  if (refusal !== null) return REFUSAL_FAILURE[refusal];
  return 'unconfirmed';
}

/**
 * {@link CreateRefusalShape} to the member that carries it — a total map rather
 * than a ladder, so a shape added to the classifier without a failure member of
 * its own fails `npm run typecheck` here instead of quietly becoming
 * `unconfirmed` and earning a retry.
 */
const REFUSAL_FAILURE: Record<CreateRefusalShape, CreateRepoFailure> = {
  'org-policy': 'refused-policy',
  sso: 'refused-sso',
  // GRANTABLE vs NOT — the split the seventh review added, and the whole reason
  // these two do not share `refused-permission`: an owner can grant a role and
  // cannot grant a token.
  role: 'refused-role',
  token: 'refused-token',
  // The three that established NOTHING beyond "refused" share one member, and
  // that is a decision taken PER SHAPE here rather than a coarser predicate
  // upstream: each is listed, so a shape cannot join them by default, and their
  // sentence claims none of policy, role or scope.
  'not-authorized': 'refused-permission',
  'status-403': 'refused-permission',
  'refusal-unstated': 'refused-permission',
};
