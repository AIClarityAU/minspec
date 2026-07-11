/**
 * Ruleset integration-id pin audit (#560 harden).
 *
 * #560 root cause: a required-status-check entry in a branch ruleset can pin an
 * `integration_id` (the GitHub App allowed to satisfy that context) to the WRONG
 * app — e.g. minspec's own `ai-review` context was pinned to `15368`
 * (`github-actions`) when the check is actually posted by `minspec-sdd[bot]`
 * (`4212099`). GitHub does not validate the pin against reality at write time,
 * so a mispin is silent: the check becomes permanently unsatisfiable and every
 * merge goes through the repo-admin bypass path instead of an enforced pass.
 * Nothing previously compared a pinned `integration_id` against the app that
 * actually posts check-runs for that context — the same validator-asymmetry
 * class as the frontmatter gaps this repo has hit before (checks a value once
 * present, never checks it is the RIGHT value).
 *
 * This module is the PURE decision core of that missing gate: given a
 * ruleset's required-check pins and a sample of REAL check-runs observed on
 * the repo, it reports which pins match, which are silently wrong, and which
 * could not be verified from the sample. All I/O (fetching the ruleset detail
 * and recent check-runs via `gh api`) lives in the CLI wrapper
 * (`scripts/audit-ruleset-integration-ids.ts`); this file takes only already-
 * parsed JSON shapes so the decision logic is unit-testable without a network
 * call or a real repo.
 */

/** A single required-status-check entry as GitHub's ruleset API returns it. */
export interface RequiredCheckPin {
  /** The status-check context name (e.g. `ai-review`). */
  context: string;
  /** The GitHub App id this context is pinned to, if any. */
  integrationId?: number;
}

/** A single check-run as GitHub's `commits/{sha}/check-runs` API returns it. */
export interface ObservedCheckRun {
  /** The check-run's name — matched against a pin's `context`. */
  name: string;
  /** The app id that posted this check-run, if present. */
  appId?: number;
}

export type PinAuditStatus = 'ok' | 'mismatch' | 'unobserved' | 'unpinned';

/** The audit verdict for one required-check pin. */
export interface PinAuditFinding {
  context: string;
  pinnedIntegrationId?: number;
  /** Distinct app ids actually observed posting this context in the sample. */
  observedAppIds: number[];
  status: PinAuditStatus;
  detail: string;
}

/**
 * Pull the `required_status_checks` pins out of a parsed ruleset detail
 * (`gh api repos/{owner}/{repo}/rulesets/{id}`). Tolerant of partial/
 * unexpected JSON — returns `[]` rather than throwing, matching the defensive
 * parsing style the rest of this module family uses (see
 * `rulesetGuardsDefaultBranchChecks` in `ruleset-advisor.ts`): a malformed
 * response must never crash the audit, only yield nothing to check.
 */
export function extractRequiredCheckPins(rulesetDetail: unknown): RequiredCheckPin[] {
  if (typeof rulesetDetail !== 'object' || rulesetDetail === null) return [];
  const rules = (rulesetDetail as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];

  const pins: RequiredCheckPin[] = [];
  for (const rule of rules) {
    if (typeof rule !== 'object' || rule === null) continue;
    if ((rule as { type?: unknown }).type !== 'required_status_checks') continue;
    const params = (rule as { parameters?: unknown }).parameters;
    if (typeof params !== 'object' || params === null) continue;
    const checks = (params as { required_status_checks?: unknown }).required_status_checks;
    if (!Array.isArray(checks)) continue;

    for (const check of checks) {
      if (typeof check !== 'object' || check === null) continue;
      const context = (check as { context?: unknown }).context;
      if (typeof context !== 'string' || context.trim() === '') continue;
      const rawId = (check as { integration_id?: unknown }).integration_id;
      pins.push({
        context,
        integrationId: typeof rawId === 'number' ? rawId : undefined,
      });
    }
  }
  return pins;
}

/**
 * Flatten one or more parsed `commits/{sha}/check-runs` responses into a flat
 * list of observed check-runs. Tolerant of partial/unexpected JSON per entry —
 * a malformed sample point is skipped, not fatal to the whole audit.
 */
export function extractObservedCheckRuns(checkRunsResponses: readonly unknown[]): ObservedCheckRun[] {
  const observed: ObservedCheckRun[] = [];
  for (const response of checkRunsResponses) {
    if (typeof response !== 'object' || response === null) continue;
    const runs = (response as { check_runs?: unknown }).check_runs;
    if (!Array.isArray(runs)) continue;
    for (const run of runs) {
      if (typeof run !== 'object' || run === null) continue;
      const name = (run as { name?: unknown }).name;
      if (typeof name !== 'string' || name.trim() === '') continue;
      const app = (run as { app?: unknown }).app;
      const appId =
        typeof app === 'object' && app !== null && typeof (app as { id?: unknown }).id === 'number'
          ? (app as { id: number }).id
          : undefined;
      observed.push({ name, appId });
    }
  }
  return observed;
}

/**
 * The audit core: for each pin, compare it against the distinct app ids
 * actually observed posting that context in the sample.
 *
 *   - `unpinned`   — no `integration_id` set. Nothing to verify; GitHub matches
 *                    the context by name from any app, which is a valid,
 *                    intentionally-loose configuration (see
 *                    `createRulesetPayload` in `ruleset-advisor.ts`).
 *   - `unobserved` — pinned, but the context never appeared in the sample.
 *                    Inconclusive (the sample may simply be too small/old), NOT
 *                    a failure — reported so a caller can widen the sample.
 *   - `ok`         — pinned AND the pinned id is among the observed ids.
 *   - `mismatch`   — pinned, the context WAS observed, and the pinned id is
 *                    NOT among the observed ids. This is the exact #560 bug
 *                    shape: a required check that can never be satisfied by
 *                    construction, silently degrading every merge into bypass.
 *
 * Pure — no network, no `gh`. Order of `pins` is preserved in the output.
 */
export function auditRequiredCheckPins(
  pins: readonly RequiredCheckPin[],
  observed: readonly ObservedCheckRun[],
): PinAuditFinding[] {
  const observedByContext = new Map<string, Set<number>>();
  for (const run of observed) {
    if (run.appId === undefined) continue;
    const set = observedByContext.get(run.name) ?? new Set<number>();
    set.add(run.appId);
    observedByContext.set(run.name, set);
  }

  return pins.map((pin) => {
    const observedIds = Array.from(observedByContext.get(pin.context) ?? []).sort((a, b) => a - b);

    if (pin.integrationId === undefined) {
      return {
        context: pin.context,
        pinnedIntegrationId: undefined,
        observedAppIds: observedIds,
        status: 'unpinned',
        detail: `"${pin.context}" is not pinned to a specific app — matches by context name from any app.`,
      };
    }

    if (observedIds.length === 0) {
      return {
        context: pin.context,
        pinnedIntegrationId: pin.integrationId,
        observedAppIds: observedIds,
        status: 'unobserved',
        detail: `"${pin.context}" is pinned to app ${pin.integrationId}, but no check-run named "${pin.context}" was observed in the sample — cannot verify.`,
      };
    }

    if (observedIds.includes(pin.integrationId)) {
      return {
        context: pin.context,
        pinnedIntegrationId: pin.integrationId,
        observedAppIds: observedIds,
        status: 'ok',
        detail: `"${pin.context}" is pinned to app ${pin.integrationId}, which matches the app(s) observed posting it.`,
      };
    }

    return {
      context: pin.context,
      pinnedIntegrationId: pin.integrationId,
      observedAppIds: observedIds,
      status: 'mismatch',
      detail: `"${pin.context}" is pinned to app ${pin.integrationId}, but the real poster observed in the sample is app ${observedIds.join(', ')} — this required check can never be satisfied and permanently degrades into bypass (#560).`,
    };
  });
}

/** Do any findings carry an unsatisfiable pin — the exact #560 failure shape? */
export function hasIntegrationIdMismatch(findings: readonly PinAuditFinding[]): boolean {
  return findings.some((f) => f.status === 'mismatch');
}
