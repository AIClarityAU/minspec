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
      'T3/T4 spec approval and DR acceptance — the read-before-build moments. Never signed under the human\'s identity; once DR-108 is accepted and wired, a live delegation may clear this class (and only this class) for a bot-recorded approval.',
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

// ─── delegated approval under the bot's own name (DR-108) ───────────────────
//
// WHAT THIS SEPARATES. Two acts used to be treated as one by the
// approval-or-acceptance stop class:
//
//   - IMPERSONATION: a record naming the founder as the actor on something he did
//     not do. Banned, unconditionally, and nothing here relaxes it.
//   - DELEGATION: the bot acts, records ITSELF as the actor, and cites a
//     delegation the founder gave once in his own recorded words.
//
// `evaluateDelegation` answers "does a live delegation cover this one approval?".
// `stopClassesAfterDelegation` is the ONLY way its answer changes a stop list, and
// it can remove exactly one class. Every other class (irreversible acts and
// `--admin` above all) is untouchable by construction, not by caller discipline.
//
// INERT UNTIL ACCEPTED. A delegation names its decision record, and covers
// nothing until that record's status is `accepted` - the founder's own act
// through *MinSpec: Accept ADR*. Writing `.minspec/delegations.json` therefore
// activates nothing, and an agent can never make a delegation live by writing
// it. `.minspec/delegations.json` is also a boundary path in
// `scripts/auto-merge-gate.ts`, so no edit to it can auto-merge.
//
// CONSUMED BY (#2854). The approval record carries `actor` / `basis` (DR-012
// Amendment): `scripts/lib/approval-actor.ts` judges a bot record with this function,
// `scripts/approval-integrity.ts` runs that judgement on every approval sidecar, and
// `scripts/lib/delegated-approval.ts` is the only path that writes a bot record (after
// an independent AI review pass). The repeat-fix share comes from
// `scripts/lib/repeat-fix-share.ts`.

/** The only actor a delegation admits. Exact match: no trimming, no casing. */
export const BOT_ACTOR = 'minspec-sdd[bot]';

/** Acts a delegation may cover. Anything else in a record drops the record. */
export type DelegatedAct = 'spec-approval' | 'engineering-dr-acceptance';
const DELEGATED_ACTS: readonly DelegatedAct[] = ['spec-approval', 'engineering-dr-acceptance'];

export type Tier = 'T1' | 'T2' | 'T3' | 'T4';
const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];

export interface Delegation {
  readonly id: string;
  /** The decision record whose acceptance makes this delegation live. */
  readonly decision: string;
  /** The founder's words, verbatim. */
  readonly words: string;
  /** ISO date the words were said. */
  readonly said: string;
  /** Where the words are recorded. */
  readonly source: string;
  /** `owner/name`, exact (case-insensitive). One repo per entry. */
  readonly repo: string;
  readonly covers: readonly DelegatedAct[];
  readonly tiers: readonly Tier[];
  /** ISO date after which the delegation lapses until renewed. */
  readonly reviewBy: string;
  /** Suspends the delegation when the measured share exceeds `max`. */
  readonly tripwire: { readonly metric: 'repeat-fix-share'; readonly max: number };
}

export interface DelegationRequest {
  readonly repo: string;
  readonly act: DelegatedAct;
  readonly tier: Tier;
  /** Who will be recorded as having approved. */
  readonly actor: string;
  /** Who wrote the artifact being approved. */
  readonly author: string;
  /** Who gave the independent verdict the approval rests on. */
  readonly verdictBy: string;
  /** For a DR acceptance: the record's `kind:`. Absent reads as `direction`. */
  readonly drKind?: 'direction' | 'engineering';
  /** Current repeat-fix share (0..1). Unknown is not permission. */
  readonly repeatFixShare: number | undefined;
  /** ISO date, `YYYY-MM-DD`. */
  readonly today: string;
  /** Repo-relative paths the approval would cover. */
  readonly paths: readonly string[];
}

export interface DelegationVerdict {
  readonly covered: boolean;
  readonly reason:
    | 'covered'
    | 'repo-never-delegated'
    | 'actor-not-bot'
    | 'no-independent-verdict'
    | 'verdict-by-author'
    | 'direction-record'
    | 'no-paths'
    | 'touches-governance'
    | 'tripwire-unknown'
    | 'tripwire-tripped'
    | 'no-live-delegation';
  readonly detail: string;
  readonly delegationId?: string;
}

/**
 * Repos no delegation can ever cover, whatever a record says. memory-fabric stays
 * the founder's (queue item ctg, change 8). Matched on the repo NAME so an org
 * move cannot slip it out.
 */
const NEVER_DELEGATED_REPO_NAMES: ReadonlySet<string> = new Set(['memory-fabric']);

/**
 * Files whose approval is never delegated: the constitution, the stop list and
 * this module, the delegation records and the decision that creates them, and the
 * autonomy setting. A delegation that could approve its own widening is the
 * self-amending shape DR-086 §2.6 exists to refuse.
 */
const GOVERNANCE_PATHS: ReadonlySet<string> = new Set([
  '.minspec/constitution.md',
  '.minspec/delegations.json',
  '.minspec/config.json',
  'scripts/lib/autonomy.ts',
  'scripts/lib/autonomy.sh',
  'docs/decisions/DR-086.md',
  'docs/decisions/DR-108.md',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Does a live delegation cover this one approval? Pure. Fails closed at every
 * branch: the cost of a wrong "no" is one founder round-trip, the cost of a wrong
 * "yes" is an approval nobody gave.
 *
 * @param decisionStatus resolves a DR id to its frontmatter `status:`.
 */
export function evaluateDelegation(
  delegations: readonly Delegation[],
  decisionStatus: (drId: string) => string | undefined,
  r: DelegationRequest,
): DelegationVerdict {
  const no = (reason: DelegationVerdict['reason'], detail: string): DelegationVerdict => ({
    covered: false,
    reason,
    detail,
  });

  const repoName = r.repo.split('/').pop()?.toLowerCase() ?? '';
  if (NEVER_DELEGATED_REPO_NAMES.has(repoName)) {
    return no('repo-never-delegated', `${r.repo} is never delegated; its approvals stay the founder's.`);
  }
  if (r.actor !== BOT_ACTOR) {
    return no('actor-not-bot', `a delegated approval is recorded under ${BOT_ACTOR} only, never "${r.actor}".`);
  }
  if (r.verdictBy.trim() === '') {
    return no('no-independent-verdict', 'no independent verdict: a delegated approval rests on a second AI.');
  }
  if (r.verdictBy === r.author || r.verdictBy === r.actor) {
    return no('verdict-by-author', 'the author (or the recorder) never gives the verdict on its own work.');
  }
  if (r.act === 'engineering-dr-acceptance' && r.drKind !== 'engineering') {
    return no('direction-record', 'direction records (and records with no `kind:`) are accepted by the founder.');
  }
  if (r.paths.length === 0) {
    return no('no-paths', 'no paths stated: an approval with no stated scope cannot be checked.');
  }
  const gov = r.paths.map(normPath).filter((p) => GOVERNANCE_PATHS.has(p));
  if (gov.length > 0) {
    return no('touches-governance', `governance files are never approved on a delegation: ${gov.join(', ')}`);
  }
  if (r.repeatFixShare === undefined || !Number.isFinite(r.repeatFixShare)) {
    return no('tripwire-unknown', 'repeat-fix share unknown: the ratio tripwire cannot be checked.');
  }
  if (!ISO_DATE.test(r.today)) {
    return no('no-live-delegation', `unreadable date "${r.today}".`);
  }

  for (const d of delegations) {
    if (d.repo.toLowerCase() !== r.repo.toLowerCase()) continue;
    if (!d.covers.includes(r.act) || !d.tiers.includes(r.tier)) continue;
    if (decisionStatus(d.decision) !== 'accepted') continue;
    if (!ISO_DATE.test(d.reviewBy) || r.today > d.reviewBy) continue;
    if (r.repeatFixShare > d.tripwire.max) {
      return no(
        'tripwire-tripped',
        `${d.id} suspended: repeat-fix share ${r.repeatFixShare} exceeds ${d.tripwire.max}.`,
      );
    }
    return {
      covered: true,
      reason: 'covered',
      detail: `covered by ${d.id} (${d.decision}), recorded as ${BOT_ACTOR}.`,
      delegationId: d.id,
    };
  }
  return no('no-live-delegation', 'no accepted, unexpired delegation covers this repo, act and tier.');
}

/**
 * The only bridge from a delegation to the stop list. Removes
 * `approval-or-acceptance` when, and only when, the verdict is `covered`.
 * Every other class passes through untouched - `--admin` and every irreversible
 * act stay stops whatever any delegation says.
 */
export function stopClassesAfterDelegation(
  classes: readonly StopClass[],
  verdict: DelegationVerdict,
): StopClass[] {
  if (!verdict.covered) return [...classes];
  return classes.filter((c) => c !== 'approval-or-acceptance');
}

function isDelegation(x: unknown): x is Delegation {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  const str = (k: string) => typeof d[k] === 'string' && (d[k] as string).trim() !== '';
  if (!['id', 'decision', 'words', 'said', 'source', 'repo', 'reviewBy'].every(str)) return false;
  if (!/^DR-\d+$/.test(d.decision as string)) return false;
  if (!Array.isArray(d.covers) || d.covers.length === 0) return false;
  if (!d.covers.every((c) => DELEGATED_ACTS.includes(c as DelegatedAct))) return false;
  if (!Array.isArray(d.tiers) || d.tiers.length === 0) return false;
  if (!d.tiers.every((t) => TIERS.includes(t as Tier))) return false;
  const t = d.tripwire as Record<string, unknown> | undefined;
  if (typeof t !== 'object' || t === null) return false;
  if (t.metric !== 'repeat-fix-share') return false;
  if (typeof t.max !== 'number' || !Number.isFinite(t.max) || t.max < 0 || t.max > 1) return false;
  return true;
}

/**
 * Read `.minspec/delegations.json`. Every failure (missing file, malformed JSON,
 * unknown version) yields NO delegations, and an entry that fails validation is
 * dropped rather than repaired: an entry we cannot read is not permission, and an
 * unknown act in `covers` must never widen what an entry grants.
 */
export function readDelegations(repoRoot: string): Delegation[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, '.minspec', 'delegations.json'), 'utf8');
  } catch {
    return [];
  }
  return parseDelegations(text) ?? [];
}

/**
 * Parse the TEXT of `.minspec/delegations.json`, for callers that read it from somewhere
 * other than the working tree (the merge base, in `scripts/approval-integrity.ts`).
 *
 * Returns `undefined` when the document itself is unreadable (malformed JSON, unknown
 * version, no `delegations` array), so a caller can tell "the witness is missing" from
 * "the witness grants nothing". Entries that fail validation are dropped, as in
 * `readDelegations`.
 */
export function parseDelegations(text: string): Delegation[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const doc = raw as { version?: unknown; delegations?: unknown } | null;
  if (doc?.version !== 1 || !Array.isArray(doc.delegations)) return undefined;
  return doc.delegations.filter(isDelegation);
}

// ─── the CLI seam (#1614) ────────────────────────────────────────────────────
//
// WHY A CLI AND NOT A BASH COPY OF THE RULE. The actors that must ask "may I
// act?" before an unattended merge are bash (`scripts/dispatch-issue.sh`).
// Re-expressing `mayProceed` in bash would give this repo TWO authorities for
// the same question, and the one nobody is looking at is the one that drifts —
// the failure this file's own header names. So bash asks THIS module, through
// the seam shape the repo already uses for its other pure deciders
// (`dispatch-issue.sh --paths-have-approvable-doc`, `remediate-pr.sh
// --classify`, `dispatch-ready-check.sh --may-approve`).
//
//   npx tsx scripts/lib/autonomy.ts --may-proceed \
//     --repo-root <abs path> \
//     --summary <what the caller proposes to do> \
//     [--stop-classes <comma-separated>] \
//     [--rejected-alternatives <newline-separated>] \
//     [--verification-pending true|false]
//
// stdout: ONE line of JSON — the `Verdict`, plus the resolved `autonomy` for the
// record. Exit 0 = proceed, exit 1 = deny.
//
// FAIL-CLOSED AT EVERY EDGE, because a gate that cannot run must not admit:
// an unrecognised flag, a flag with no value, a missing `--repo-root`, a
// non-boolean `--verification-pending`, an unreadable config — every one exits 1
// with a deny verdict. `readAutonomy` already fails closed on the config side,
// and the invocation edges (no node_modules, no tsx, non-zero exit, unparseable
// stdout) are the CALLER's to fail closed on: see `scripts/lib/autonomy.sh`.

/** The CLI's answer. `line` is exactly what gets printed, verbatim. */
export interface AutonomyCliResult {
  readonly exitCode: number;
  readonly line: string;
}

/**
 * Reasons the CLI can report that `mayProceed` cannot, because they are about the
 * INVOCATION rather than the decision. Kept a named union so the bash side and the
 * tests share one vocabulary.
 */
export type AutonomyCliReason = 'cli-usage';

/**
 * Pure: argv in, `{exitCode, line}` out. No process access, no exit, so the
 * argv-edge cases are unit-testable without spawning anything.
 */
export function runAutonomyCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): AutonomyCliResult {
  const deny = (reason: AutonomyCliReason, detail: string): AutonomyCliResult => ({
    exitCode: 1,
    line: JSON.stringify({ proceed: false, reason, detail, autonomy: 'ask' as Autonomy }),
  });

  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--may-proceed') continue; // the verb; kept so the call site reads
    if (!key.startsWith('--')) return deny('cli-usage', `unexpected argument: ${key}`);
    const value = argv[i + 1];
    // A value that itself looks like a flag means the PREVIOUS flag was given no
    // value, and silently shifting would build a DIFFERENT action than the caller
    // described. Refusing is the only fail-closed reading.
    if (value === undefined || value.startsWith('--')) {
      return deny('cli-usage', `${key} needs a value`);
    }
    raw[key.slice(2)] = value;
    i++;
  }

  const repoRoot = (raw['repo-root'] ?? '').trim();
  if (repoRoot === '') {
    return deny(
      'cli-usage',
      '--repo-root is required — the setting is read from <repo-root>/.minspec/config.json, ' +
        'and guessing the root could read a DIFFERENT repo’s policy.',
    );
  }

  const summary = (raw.summary ?? '').trim();
  if (summary === '') {
    return deny(
      'cli-usage',
      '--summary is required — an act-mode decision with no stated action cannot be reviewed afterwards (DR-086 §4).',
    );
  }

  // Exact-token, like resolveAutonomy: anything that is not literally `true` or
  // `false` is a value we cannot read, and an unreadable input is not permission.
  const pendingRaw = (raw['verification-pending'] ?? 'false').trim();
  if (pendingRaw !== 'true' && pendingRaw !== 'false') {
    return deny('cli-usage', `--verification-pending must be exactly true or false, got "${pendingRaw}"`);
  }

  // Unrecognised class tokens are deliberately NOT filtered out. `mayProceed`
  // denies on any non-empty list and renders an unknown id as `(UNKNOWN CLASS)`;
  // dropping one here would silently turn a stop into a proceed.
  const stopClasses = (raw['stop-classes'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as StopClass[];

  // Newline-separated, not comma-separated: a rejected alternative is prose and
  // prose contains commas, so splitting on `,` would shred one reason into two.
  const rejectedAlternatives = (raw['rejected-alternatives'] ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const autonomy = readAutonomy(repoRoot, env);
  const verdict = mayProceed(autonomy, {
    summary,
    stopClasses,
    verificationPending: pendingRaw === 'true',
    rejectedAlternatives,
  });

  return {
    exitCode: verdict.proceed ? 0 : 1,
    line: JSON.stringify({ ...verdict, autonomy }),
  };
}

// Run ONLY when this file is the process entry point.
//
// Keyed on argv[1] rather than `import.meta.url` or `require.main`, because this
// module is loaded two ways and only the argv check is correct under both: vitest
// imports it as ESM (where `require.main` does not exist), and `npx tsx` runs it
// as CJS (the root package.json has no `"type": "module"`, where `import.meta` is
// not reliably available). Under vitest argv[1] is the vitest binary, so importing
// this file executes nothing.
if (/(^|[\\/])autonomy\.ts$/.test(process.argv[1] ?? '')) {
  const result = runAutonomyCli(process.argv.slice(2));
  console.log(result.line);
  process.exit(result.exitCode);
}
