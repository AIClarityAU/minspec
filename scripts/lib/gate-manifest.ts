/**
 * SPEC-054 FR-5 / DQ-1 / DQ-3: the gate manifest — which independent signals each
 * required ruleset context rests on — and the gate-label set (FR-1's "gate-relevant"
 * label predicate).
 *
 * Data only: no IO, no imports. The types are exported so SPEC-071 can extend them.
 * Offline by construction (INV-2).
 */

export type SignalMechanism = 'status' | 'check-run' | 'label';

/** One independent signal a required context rests on. */
export interface GateWitness {
  /** e.g. '.github/workflows/ai-review.yml' */
  workflow: string;
  /** The job id key in that workflow. */
  job: string;
  /** The step name, when one step posts it. */
  step?: string;
  mechanism: SignalMechanism;
  /** The status context, check-run name or label written. */
  signal: string;
  permission: 'statuses:write' | 'checks:write' | 'pull-requests:write' | 'issues:write';
  /** Posting identity, e.g. 'github-actions[bot]', 'minspec-sdd[bot]'. */
  app: string;
}

export interface GateEntry {
  /** The required ruleset context, verbatim. */
  context: string;
  witnesses: readonly GateWitness[];
  /** FR-3 option (b): set only when the sole witness fails closed and visibly. */
  failClosed?: { reason: string; evidence: string };
}

const AI_REVIEW = '.github/workflows/ai-review.yml';
const CI = '.github/workflows/ci.yml';

const CHECK_RUN_STEP = 'Post honest `ai-review` verdict check-run as minspec-sdd[bot]';
const STATUS_STEP = 'Post verdict + apply label as minspec-sdd[bot]';

const JOB_CONTEXT_REASON =
  'a required context that never reports blocks the merge as "Expected - waiting for status", which is visible';

function ciJob(context: string, job: string): GateEntry {
  return {
    context,
    witnesses: [
      {
        workflow: CI,
        job,
        mechanism: 'check-run',
        signal: context,
        permission: 'checks:write',
        app: 'github-actions[bot]',
      },
    ],
    failClosed: { reason: JOB_CONTEXT_REASON, evidence: CI },
  };
}

export const GATE_MANIFEST: readonly GateEntry[] = [
  ciJob('lint', 'lint'),
  ciJob('test', 'test'),
  {
    context: 'MinSpec SDD validation',
    witnesses: [
      {
        workflow: '.github/workflows/minspec-validate.yml',
        job: 'validate',
        mechanism: 'check-run',
        signal: 'MinSpec SDD validation',
        permission: 'checks:write',
        app: 'github-actions[bot]',
      },
    ],
    failClosed: {
      reason:
        'the final arm exits 1 when no validator is found, so the job cannot pass without validating (#933)',
      evidence: '.github/workflows/minspec-validate.yml',
    },
  },
  {
    context: 'ai-review',
    witnesses: [
      {
        workflow: AI_REVIEW,
        job: 'runner',
        step: CHECK_RUN_STEP,
        mechanism: 'check-run',
        signal: 'ai-review',
        permission: 'checks:write',
        app: 'minspec-sdd[bot]',
      },
    ],
    failClosed: {
      reason:
        'a failed review or error posts a failing verdict via the fail-closed step; a missing check-run leaves the required context pending',
      evidence: AI_REVIEW,
    },
  },
  {
    context: 'ready-to-merge',
    witnesses: [
      {
        workflow: AI_REVIEW,
        job: 'runner',
        step: STATUS_STEP,
        mechanism: 'status',
        signal: 'ai-review/pass',
        permission: 'statuses:write',
        app: 'minspec-sdd[bot]',
      },
      {
        workflow: AI_REVIEW,
        job: 'runner',
        step: CHECK_RUN_STEP,
        mechanism: 'check-run',
        signal: 'ai-review',
        permission: 'checks:write',
        app: 'minspec-sdd[bot]',
      },
    ],
  },
  ciJob('build', 'build'),
  // The job is added by SPEC-054 group 5; the freshness test exempts it only while absent.
  ciJob('gate-witnesses', 'gate-witnesses'),
];

/**
 * Labels whose write is gate-relevant (FR-1): every label a required-check condition
 * reads. `needs-human-review` is deliberately absent — no required check reads it.
 */
export const GATE_LABEL_PATTERNS: readonly RegExp[] = [
  /^ai-review:/,
  /^ready-to-merge$/,
  /^awaiting-approval$/,
  /^blocked-by$/,
  /^hold:/,
];
