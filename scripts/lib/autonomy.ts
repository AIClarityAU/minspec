/**
 * The autonomy axis (DR-086) — may the agent act on a recommendation it has
 * already analysed, without asking first?
 *
 * This is the SECOND axis. `mode: solo | team` answers *whose consent is
 * required*; `autonomy: ask | act` answers *is the human consulted on a choice
 * the agent has already made*. They are orthogonal (DR-086 §1).
 *
 * SCOPE — this repo's own workflow only (DR-086 §5, constitution invariant 3).
 * It deliberately lives in `scripts/`, NOT in the shipped extension: an agent
 * acting unattended in an adopter's repo is a far larger claim than one scoped
 * here, and shipping this is a separate decision nobody has made.
 *
 * WHY IT IS CODE AND NOT PROSE. The stop list is the whole safety property, and
 * a rule the model is merely asked to remember is one it will eventually drift
 * from — the constitution's "enforce, don't trust the model". Encoding the list
 * makes "did this action qualify?" a function call with a testable answer
 * instead of a judgement call made under time pressure.
 */

export type Autonomy = 'ask' | 'act';

/**
 * Exact-token, deny-by-default — mirrors `resolveMode` in auto-merge-gate.ts so
 * the two settings agree byte-for-byte on what "on" means.
 *
 * Autonomy is `act` ONLY when the value is EXACTLY that token
 * (whitespace-trimmed). Anything else — absent (the DEFAULT), empty, misspelled,
 * differently-cased, `true`, `yes`, garbage — resolves to `ask`. There is no
 * fail-open path: an unrecognised value can never grant autonomy.
 */
export function resolveAutonomy(raw: string | undefined): Autonomy {
  return String(raw ?? '').trim() === 'act' ? 'act' : 'ask';
}

/**
 * The enumerated stop classes (DR-086 §2). These ALWAYS stop and ask, whatever
 * the autonomy setting says.
 *
 * "Seriously stuck" is deliberately absent. It is unenumerable and self-judged,
 * and a stop rule the agent evaluates about its own competence is the same
 * self-certification defect the machinery merge gate exists to prevent (#509).
 * A new stop class is added here by amendment, never inferred at runtime.
 */
export type StopClass =
  | 'irreversible-or-outward-facing'
  | 'approval-or-acceptance'
  | 'spend-above-threshold'
  | 'evidence-incomplete'
  | 'genuine-tie'
  | 'edits-the-autonomy-rules';

export interface StopClassSpec {
  readonly id: StopClass;
  readonly summary: string;
  /** Where this class is defined, so a reader can check the code against the DR. */
  readonly source: string;
}

export const STOP_CLASSES: readonly StopClassSpec[] = Object.freeze([
  {
    id: 'irreversible-or-outward-facing',
    summary:
      'Publish, repo visibility, deletion, or anything leaving the machine. Includes --admin and bypassing a failing check.',
    source: 'DR-086 §2.1 (DR-076 keep; constitution-level)',
  },
  {
    id: 'approval-or-acceptance',
    summary:
      'T3/T4 spec approval and DR acceptance — the read-before-build moments. The agent cannot sign these without forging the human.',
    source: 'DR-086 §2.2 (DR-076 keep, DR-029, DR-056)',
  },
  {
    id: 'spend-above-threshold',
    summary: 'Spend above the configured threshold, including paid-model failover.',
    source: 'DR-086 §2.3',
  },
  {
    id: 'evidence-incomplete',
    summary:
      'The recommendation rests on a premise the agent is still verifying. Provisional until that verification lands.',
    source: 'DR-086 §2.4 / §3',
  },
  {
    id: 'genuine-tie',
    summary:
      'No recommendation, or two materially equivalent options. A forced pick manufactures a decision nobody made.',
    source: 'DR-086 §2.5',
  },
  {
    id: 'edits-the-autonomy-rules',
    summary: 'Anything that would edit this stop list, or the autonomy setting itself.',
    source: 'DR-086 §2.6',
  },
]);

export interface ProposedAction {
  /** What the agent proposes to do, for the record. */
  readonly summary: string;
  /** Stop classes the caller has determined apply. Empty = none apply. */
  readonly stopClasses: readonly StopClass[];
  /**
   * DR-086 §3 — is the plan still gathering evidence that could refute the
   * premise this rests on? A sequencing constraint, not a confidence judgement,
   * so it can be checked rather than felt.
   */
  readonly verificationPending: boolean;
  /**
   * DR-086 §4 — the options rejected, and why. Under `act` the human is not
   * seeing them live, so this record is the ONLY way the decision can be
   * reviewed afterwards. An act-mode action with no stated alternatives is a
   * defect, not a terse success — so it is required here rather than requested.
   */
  readonly rejectedAlternatives: readonly string[];
}

export interface Verdict {
  readonly proceed: boolean;
  /** Machine-readable reason, stable enough to assert on. */
  readonly reason:
    | 'autonomy-is-ask'
    | 'stop-class-applies'
    | 'verification-pending'
    | 'no-rejected-alternatives-recorded'
    | 'proceed';
  /** Human-readable explanation naming the specific blocker. */
  readonly detail: string;
}

/**
 * The single decision point. Every consumer asks THIS, so there is one answer to
 * "may I act?" rather than a per-caller reimplementation that drifts.
 *
 * Fails closed at every branch: any doubt resolves to stopping and asking, which
 * costs one round-trip. The opposite error costs an unreviewed action.
 */
export function mayProceed(autonomy: Autonomy, action: ProposedAction): Verdict {
  if (autonomy !== 'act') {
    return {
      proceed: false,
      reason: 'autonomy-is-ask',
      detail: 'autonomy is `ask` — the human is consulted on every analysed choice.',
    };
  }

  // Stop classes outrank the setting. This ordering is load-bearing: checking
  // the setting first and the classes second would let `act` skip them.
  if (action.stopClasses.length > 0) {
    const named = action.stopClasses
      .map((id) => {
        const spec = STOP_CLASSES.find((s) => s.id === id);
        return spec ? `${spec.id} (${spec.source})` : `${id} (UNKNOWN CLASS)`;
      })
      .join('; ');
    return {
      proceed: false,
      reason: 'stop-class-applies',
      detail: `stops and asks regardless of autonomy: ${named}`,
    };
  }

  if (action.verificationPending) {
    return {
      proceed: false,
      reason: 'verification-pending',
      detail:
        'the premise is still being verified — the recommendation is provisional until it lands (DR-086 §3).',
    };
  }

  if (action.rejectedAlternatives.length === 0) {
    return {
      proceed: false,
      reason: 'no-rejected-alternatives-recorded',
      detail:
        'no rejected alternatives recorded — under `act` that record is the only way the decision can be reviewed later (DR-086 §4).',
    };
  }

  return { proceed: true, reason: 'proceed', detail: `proceeding: ${action.summary}` };
}

// ─── the single resolver (SPEC-065 FR-1) ─────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the setting from `.minspec/config.json`, which is the SOURCE — not an
 * environment variable.
 *
 * FR-1 exists because of #183: `autoMerge.native` had a config seam and
 * `MINSPEC_AUTOMERGE_MODE` did not, so the stricter policy silently reverted in
 * any session lacking the export. A profile that does not survive a fresh
 * session is not a profile. So config is authoritative and an env override can
 * only ever be read THROUGH the same exact-token resolver.
 *
 * Every failure — missing file, unreadable, malformed JSON, absent key, wrong
 * type — resolves to `ask`. A setting we could not read is not permission.
 */
export function readAutonomy(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Autonomy {
  const override = env.MINSPEC_AUTONOMY;
  if (override !== undefined) return resolveAutonomy(override);

  let raw: unknown;
  try {
    const text = fs.readFileSync(path.join(repoRoot, '.minspec', 'config.json'), 'utf8');
    raw = (JSON.parse(text) as Record<string, unknown>).autonomy;
  } catch {
    return 'ask';
  }
  return typeof raw === 'string' ? resolveAutonomy(raw) : 'ask';
}
