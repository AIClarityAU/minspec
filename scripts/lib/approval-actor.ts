/**
 * Who recorded an approval, and on whose basis (DR-012 Amendment 2026-10-17, DR-108, #2854).
 *
 * An approval sidecar (`.minspec/approvals/<path>.json`) may carry five optional fields
 * on top of the hash-locked record DR-012 defines:
 *
 *   - `actor`     who recorded the approval: the founder, or `minspec-sdd[bot]`.
 *   - `basis`     `founder`, or `delegation:<id>` naming an entry in `.minspec/delegations.json`.
 *   - `act`       `spec-approval` | `engineering-dr-acceptance` (delegated records only).
 *   - `author`    who wrote the artifact being approved.
 *   - `verdictBy` the independent AI review comment the approval rests on (a GitHub
 *                 issue-comment URL on this repo).
 *
 * A record with NONE of them is a founder record exactly as before: every sidecar written
 * before this module existed stays valid, judged by the existing allowlist and agent
 * denylist in `scripts/approval-integrity.ts`. The extension's reader
 * (`packages/minspec/src/lib/approval-store.ts`) ignores unknown keys, so the hash lock and
 * `specHash` behaviour are untouched.
 *
 * SCOPE. Lives in `scripts/`, which is not shipped (DR-086 §5). Whether it moves into the
 * shipped validator is a separate decision (#2854 item 4).
 *
 * THE RULES, each one fail-closed:
 *
 *   1. A bot record (`actor` = `minspec-sdd[bot]`) is valid ONLY when `evaluateDelegation`
 *      says the named delegation covers it. Every witness that decision needs (the repo,
 *      the delegation records, the decision record's status, the repeat-fix share, the
 *      artifact itself) is an input here, and a missing one DENIES.
 *   2. A bot record carries `approvedBy` = `minspec-sdd[bot]`. The founder's identity is
 *      never written for a delegated act; a bot record naming anyone else is refused.
 *   3. No record may name the artifact's author as its actor, or as its verdict source.
 *   4. A non-bot actor may only claim `basis: founder`. A founder named on a delegated
 *      basis is the impersonation shape DR-108 §1 bans.
 *
 * ON "AUTHOR" FOR AGENT WORK. Every agent writes through the same App, so at the GitHub
 * login level an agent-written spec's author IS `minspec-sdd[bot]`, and rule 3 read that
 * way would refuse every agent-written artifact DR-108 was accepted to clear. The
 * independence DR-108 §2.3 asks for is between SESSIONS: the one that wrote the artifact,
 * the one recording the approval, and the CI review that judged it. So the calling path
 * (`scripts/lib/delegated-approval.ts`) records `author` as the authoring session
 * (`session:<head branch>` for bot-authored PRs, the login otherwise) and refuses when the
 * recording session is the authoring one. This module still refuses the literal case: a
 * record whose `author` is the bot login itself names its actor as its author.
 */
import {
  BOT_ACTOR,
  evaluateDelegation,
  type Delegation,
  type DelegatedAct,
  type DelegationVerdict,
  type Tier,
} from './autonomy';

/** The optional fields this amendment adds to an approval record. */
export interface ApprovalActorFields {
  readonly actor?: string;
  readonly basis?: string;
  readonly act?: DelegatedAct;
  readonly author?: string;
  readonly verdictBy?: string;
}

export const ACTOR_FIELDS: readonly (keyof ApprovalActorFields)[] = [
  'actor',
  'basis',
  'act',
  'author',
  'verdictBy',
];

/** `basis` for a delegated record. The id grammar matches `.minspec/delegations.json`. */
export const DELEGATION_BASIS = /^delegation:(DLG-\d+)$/;

/** A decision record, wherever it sits. Spec approval is everything else. */
const DR_PATH = /(^|\/)DR-\d+[^/]*\.md$/;

const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];

export type ActorClass =
  /** No actor fields at all: every record written before #2854. */
  | { readonly kind: 'founder-legacy' }
  /** A non-bot actor on `basis: founder`. The approver allowlist still applies. */
  | { readonly kind: 'founder'; readonly actor: string }
  /** A bot record that a live delegation covers. */
  | {
      readonly kind: 'delegated';
      readonly delegationId: string;
      readonly act: DelegatedAct;
      readonly author: string;
      readonly verdictBy: string;
      readonly verdict: DelegationVerdict;
    };

export interface ActorFailure {
  readonly check: string;
  readonly detail: string;
}

/**
 * The facts a delegated record is judged against. Each is `undefined` when its witness
 * could not be read, and an unread witness is never permission.
 *
 * In CI these come from the MERGE BASE, never the pull request's head, so a pull request
 * cannot supply the delegation, the decision status or the history that approves it.
 */
export interface DelegationWitnesses {
  /** `owner/name` this record is for. */
  readonly repo: string | undefined;
  /** Parsed `.minspec/delegations.json`. `undefined` = the file could not be read. */
  readonly delegations: readonly Delegation[] | undefined;
  /** A decision record id to its frontmatter `status:`. */
  readonly decisionStatus: (drId: string) => string | undefined;
  /** The repeat-fix share (0..1). `undefined` = unknown, see `repeat-fix-share.ts`. */
  readonly repeatFixShare: number | undefined;
  /** `YYYY-MM-DD`, UTC. */
  readonly today: string;
  /**
   * The pull request that last changed this artifact's canonical content on the base
   * (`scripts/lib/content-pr.ts`). The cited review comment must be on it.
   */
  readonly contentPullRequest: (artifactPath: string) => number | undefined;
}

/** Witnesses that are all missing. The default for any caller that supplies none. */
export const NO_WITNESSES: DelegationWitnesses = Object.freeze({
  repo: undefined,
  delegations: undefined,
  decisionStatus: () => undefined,
  repeatFixShare: undefined,
  today: '',
  contentPullRequest: () => undefined,
});

/** The approvable the record is for, as it exists where the record is being judged. */
export interface ArtifactFacts {
  /** Repo-relative POSIX path. */
  readonly path: string;
  /** Its bytes, or `null` when it does not exist. */
  readonly content: string | null;
}

export interface ActorCheck {
  /** Set when the record classified cleanly; absent on any failure. */
  readonly cls?: ActorClass;
  readonly failures: readonly ActorFailure[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** One scalar frontmatter field, unquoted, inline comment stripped. */
export function frontmatterField(content: string, key: string): string | undefined {
  const fm = content.match(FRONTMATTER);
  if (!fm) return undefined;
  const line = fm[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  if (line === undefined) return undefined;
  const value = line
    .slice(key.length + 1)
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
  return value === '' ? undefined : value;
}

/** The act an artifact's approval is, from its PATH (never a field the record declares). */
export function actForPath(artifactPath: string): DelegatedAct {
  return DR_PATH.test(artifactPath) ? 'engineering-dr-acceptance' : 'spec-approval';
}

const REVIEW_COMMENT_URL = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(?:pull|issues)\/(\d+)#issuecomment-\d+$/;

/** `https://github.com/<repo>/(pull|issues)/<n>#issuecomment-<id>`, repo matched case-insensitively. */
export function isReviewCommentUrl(url: string, repo: string): boolean {
  const m = url.match(REVIEW_COMMENT_URL);
  return m !== null && m[1].toLowerCase() === repo.toLowerCase();
}

/** The pull request number a review comment URL is on, or undefined. */
export function reviewCommentPr(url: string): number | undefined {
  const m = url.match(REVIEW_COMMENT_URL);
  return m ? Number(m[2]) : undefined;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const sameIdentity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Judge the actor fields of one approval record. Pure.
 *
 * `failures` empty and `cls` set means the actor part of the record is sound. The hash
 * binding, file-set and approver-allowlist checks are the caller's
 * (`scripts/approval-integrity.ts`); for a `delegated` record the caller skips the human
 * allowlist and agent denylist, because this check replaces them.
 */
export function checkApprovalActor(
  record: Readonly<Record<string, unknown>>,
  artifact: ArtifactFacts,
  w: DelegationWitnesses,
): ActorCheck {
  const fail = (check: string, detail: string): ActorCheck => ({ failures: [{ check, detail }] });

  const present = ACTOR_FIELDS.filter((k) => record[k] !== undefined);
  if (present.length === 0) return { cls: { kind: 'founder-legacy' }, failures: [] };

  const actor = str(record.actor);
  if (actor === undefined || actor.trim() === '') {
    return fail(
      'actor-shape',
      `the record carries ${present.join(', ')} but no actor: a basis or verdict with nobody who acted on it cannot be attributed`,
    );
  }
  for (const k of present) {
    if (typeof record[k] !== 'string') return fail('actor-shape', `${k} must be a string`);
  }

  const approvedBy = str(record.approvedBy) ?? '';
  const basis = str(record.basis);
  const author = str(record.author);
  const verdictBy = str(record.verdictBy);

  // Rule 3, for every record: the actor never approves its own work, and the verdict
  // never comes from the author.
  if (author !== undefined && sameIdentity(author, actor)) {
    return fail('actor-is-author', `actor "${actor}" is the artifact's author: nobody approves their own work`);
  }
  if (author !== undefined && verdictBy !== undefined && sameIdentity(author, verdictBy)) {
    return fail('verdict-by-author', `the verdict source "${verdictBy}" is the artifact's author`);
  }

  if (actor !== BOT_ACTOR) {
    // A near-miss of the bot name ("minspec-sdd[bot] ", another App) is neither the
    // bot nor a human. Refuse it rather than let it reach the human path.
    if (/\[bot\]/i.test(actor)) {
      return fail('actor-not-bot', `actor "${actor}" is a bot identity but not exactly ${BOT_ACTOR}`);
    }
    if (basis !== 'founder') {
      return fail(
        'basis-mismatch',
        `a non-bot actor may only claim basis "founder", got ${JSON.stringify(basis)}: naming a human on a delegated basis is impersonation (DR-108 §1)`,
      );
    }
    if (!sameIdentity(approvedBy, actor)) {
      return fail('actor-approvedBy-mismatch', `actor "${actor}" but approvedBy "${approvedBy}"`);
    }
    return { cls: { kind: 'founder', actor }, failures: [] };
  }

  // ── a bot record ─────────────────────────────────────────────────────────
  // Rule 2: the founder's identity is never written for a delegated act.
  if (approvedBy !== BOT_ACTOR) {
    return fail(
      'founder-identity-on-delegated-act',
      `a record whose actor is ${BOT_ACTOR} must carry approvedBy "${BOT_ACTOR}", got "${approvedBy}": a delegated act is never recorded under anyone else's identity`,
    );
  }
  const basisMatch = basis === undefined ? null : basis.match(DELEGATION_BASIS);
  if (!basisMatch) {
    return fail('basis-mismatch', `a bot record needs basis "delegation:<DLG-id>", got ${JSON.stringify(basis)}`);
  }
  const delegationId = basisMatch[1];

  if (author === undefined || author.trim() === '') {
    return fail('author-missing', 'a delegated record must name the artifact\'s author, or independence cannot be checked');
  }
  if (verdictBy === undefined || verdictBy.trim() === '') {
    return fail('no-independent-verdict', 'a delegated record must cite the AI review comment it rests on (verdictBy)');
  }

  // Missing witnesses. Each one denies on its own, by name.
  if (w.repo === undefined || w.repo.trim() === '') {
    return fail('witness-missing', 'the repository could not be determined, so the delegation scope cannot be checked');
  }
  if (w.delegations === undefined) {
    return fail('witness-missing', 'the delegation records could not be read');
  }
  if (artifact.content === null) {
    return fail('witness-missing', `the approvable ${artifact.path} does not exist where the record is judged`);
  }

  if (!isReviewCommentUrl(verdictBy, w.repo)) {
    return fail('verdict-shape', `verdictBy must be an issue-comment URL on ${w.repo}, got "${verdictBy}"`);
  }

  // Offline binding of the verdict to the artifact: the cited comment must be on the pull
  // request that last changed this content, not on some other pull request.
  const contentPr = w.contentPullRequest(artifact.path);
  if (contentPr === undefined) {
    return fail('witness-missing', `the pull request that last changed ${artifact.path} could not be determined from git`);
  }
  if (reviewCommentPr(verdictBy) !== contentPr) {
    return fail(
      'verdict-not-on-content-pr',
      `verdictBy is on #${String(reviewCommentPr(verdictBy))}, but ${artifact.path} was last changed by #${contentPr}`,
    );
  }

  const expectedAct = actForPath(artifact.path);
  if (record.act !== expectedAct) {
    return fail('act-mismatch', `${artifact.path} is a ${expectedAct}, but the record says ${JSON.stringify(record.act)}`);
  }

  const tier = str(record.tier);
  if (tier === undefined || !TIERS.includes(tier as Tier)) {
    return fail('tier-shape', `a delegated record needs tier T1..T4, got ${JSON.stringify(record.tier)}`);
  }
  const declaredTier = frontmatterField(artifact.content, 'tier');
  if (declaredTier !== undefined && declaredTier !== tier) {
    return fail('tier-mismatch', `the record says ${tier} but ${artifact.path} declares ${declaredTier}`);
  }

  const named = w.delegations.filter((d) => d.id === delegationId);
  if (named.length === 0) {
    return fail('basis-unknown-delegation', `${delegationId} is not a readable entry in .minspec/delegations.json`);
  }

  const kind = frontmatterField(artifact.content, 'kind');
  const verdict = evaluateDelegation(named, w.decisionStatus, {
    repo: w.repo,
    act: expectedAct,
    tier: tier as Tier,
    actor,
    author,
    verdictBy,
    drKind: kind === 'engineering' ? 'engineering' : kind === 'direction' ? 'direction' : undefined,
    repeatFixShare: w.repeatFixShare,
    today: w.today,
    paths: [artifact.path],
  });
  if (!verdict.covered) {
    return fail(`delegation-${verdict.reason}`, `${delegationId} does not cover this approval: ${verdict.detail}`);
  }

  return {
    cls: { kind: 'delegated', delegationId, act: expectedAct, author, verdictBy, verdict },
    failures: [],
  };
}
