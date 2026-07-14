/**
 * Spec Approval State — DR-012, amended by SPEC-022 / DR-034.
 *
 * Approval is an explicit human act, recorded as a CANONICAL content hash of the
 * spec (FR-3, `@aiclarity/shared` specHash) — NOT raw file bytes. The canonical
 * hash excludes the lifecycle fields (`status`/`phases`), so the tool's own
 * status flips and deterministic lifecycle transitions no longer void approval;
 * editing the body or any other frontmatter field still does (re-review).
 *
 * Ground truth is COMMITTED and path-keyed (FR-1): one sidecar per spec under
 * `.minspec/approvals/<repo-relative-spec-path>.json`, owned by `approval-store.ts`.
 * Records are ATTRIBUTED (FR-2): they carry who approved (`approvedBy` =
 * `git config user.email`, captured offline at approval time — Tier-0, no network).
 * The captured identity is GATED (DR-056): an agent/bot or absent identity is
 * refused (`assertHumanApprover`), so a recorded `approvedBy` is a provable human.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { specHash, getSpecBodyOnly } from '@aiclarity/shared';
import type { Tier } from './config';
import {
  readRecord,
  writeRecord,
  removeRecord,
  listRecords,
  toPosixRel,
} from './approval-store';

export type ApprovalStatus = 'approved' | 'stale' | 'unapproved';

/**
 * The FR-2 attributed approval record — the on-disk sidecar shape.
 *
 * `migrated` is `true` only for FR-5 backfilled records (an approval the human
 * never performed, flagged so the gate treats it valid-but-flagged — "re-approve
 * to clear"). A `migrated:true` record still resolves to `approved` for the
 * derive (non-blocking, warn-first), but carries its honest provenance.
 *
 * SPEC-017 adds two fields:
 *   `baselineBlob`  — FR-1 baseline pointer. One of THREE closed forms, frozen
 *                     forever (committed): a 40-hex git blob SHA | the literal
 *                     string 'gzip:fallback' (GZIP_MARKER) | '' (both mint paths
 *                     failed → no M1 datapoint). On-disk back-compat: absent in
 *                     legacy records (pre-SPEC-017) — `readRecord` normalizes
 *                     absent → '' so this required-string always holds in memory.
 *                     NEVER use a required-string validator or every legacy
 *                     approval silently drops (Costly #1, AC-1 back-compat).
 *   `reviewStart`   — RESERVED for M3 (FR-7, time-to-approve). NOT populated in
 *                     M1. Optional so M3 can backfill without a second migration.
 */
export interface ApprovalRecord {
  readonly specPath: string;       // repo-relative, POSIX, e.g. specs/minspec/SPEC-007-foo/requirements.md
  readonly specHash: string;       // canonical hash (FR-3), hex
  readonly approvedAt: string;     // ISO-8601 UTC
  readonly approvedBy: string;     // git config user.email at approval time
  readonly tier: Tier;
  readonly migrated: boolean;
  readonly baselineBlob: string;   // FR-1: 40-hex SHA | 'gzip:fallback' | '' (see above)
  readonly reviewStart?: string;   // RESERVED for M3 (FR-7) — absent in M1; ISO-8601 UTC when set
}

/** Repo-relative POSIX path for a spec file, the approval store's key. */
export function specRelPath(rootDir: string, specFilePath: string): string {
  return toPosixRel(path.relative(rootDir, specFilePath));
}

// ─── SPEC-017 Slice 3 — Baseline mint / recover (FR-1, DR-043) ──────────────

/**
 * Frozen sentinel for the gzip-fallback baseline form.
 * Non-hex, never empty, stable forever — `recoverBaseline` branches by EXACT
 * equality, so this must never change. The closed set is: 40-hex SHA |
 * 'gzip:fallback' | '' (both paths failed → no M1 datapoint).
 */
export const GZIP_MARKER = 'gzip:fallback';

/**
 * Encode a repo-relative POSIX specPath into a SINGLE, git-legal ref component.
 * Hashing sidesteps git's ref-name grammar (no '..', no '.lock' suffix, no
 * leading '.', no control chars, no trailing '/'), which a legal spec path could
 * otherwise trip — making `update-ref` reject an honest path and strand an
 * unpinned blob for gc to prune.
 */
export function refKey(specPath: string): string {
  return crypto.createHash('sha256').update(specPath).digest('hex');
}

/**
 * Write a gzip-compressed body snapshot to `.minspec/snapshots/<refKey>.json.gz`
 * as the DR-043 per-machine fallback when git blob pinning is unavailable.
 * Returns true on success, false on any error (so mintBaseline can degrade to '').
 */
function writeGzipFallback(rootDir: string, specPath: string, bodyBuf: Buffer): boolean {
  try {
    const dir = path.join(rootDir, '.minspec', 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const gz = zlib.gzipSync(bodyBuf);
    fs.writeFileSync(path.join(dir, `${refKey(specPath)}.json.gz`), gz);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mint the FR-4 body-only baseline as a pinned git blob (DR-043).
 *
 * Strategy (in order):
 *   1. `git hash-object -w --stdin` → blob SHA (content-addressed, deduped,
 *      dirty-tree-safe).
 *   2. `git update-ref refs/minspec/snapshots/<refKey(specPath)> <sha>` pins the
 *      blob so `git gc` cannot prune it.  Returns the SHA on success.
 *   3. If the pin fails (shouldn't, but defensive) → the blob is unpinned and
 *      gc-prunable; fall through to gzip fallback so nothing is left dangling.
 *   4. If `hash-object` throws (non-git dir, git absent) → gzip fallback.
 *   5. If gzip also fails → return '' (no M1 datapoint, approval still written).
 *
 * A returned 40-hex SHA means "blob written AND pinned by a ref ON THIS MACHINE."
 * The scope is PER-MACHINE, NOT cross-machine (DR-043 Risks/Follow-ups): the pin is
 * a LOCAL `refs/minspec/snapshots/*` ref, and a plain `git push origin <branch>` does
 * NOT transfer it — DR-043's default is "do not push snapshot refs." So the blob is
 * only gc-safe on the machine that minted it; on another clone the recorded SHA can be
 * unresolvable and `recoverBaseline` returns undefined. That drift is NOT silent:
 * `classifyBaseline` / `checkBaselineIntegrity` surface it as 'unrecoverable' (#404).
 * Tier-0, offline: mint NEVER pushes to a remote — no network op on the approval path.
 */
export function mintBaseline(rootDir: string, specPath: string, bodyOnly: string): string {
  const buf = Buffer.from(bodyOnly, 'utf-8');
  try {
    // DR-043 pt 1: content-addressed blob (zlib-compressed, deduped; dirty-tree-safe).
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: rootDir,
      input: buf,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    // DR-043 pt 2: pin against gc under a sanitized, always-legal ref name.
    try {
      execFileSync(
        'git',
        ['update-ref', `refs/minspec/snapshots/${refKey(specPath)}`, sha],
        { cwd: rootDir, stdio: 'ignore' },
      );
      return sha; // blob written AND pinned locally (per-machine; never pushed at approval).
    } catch {
      // Pin failed → the blob is unpinned and gc could prune it later.
      // Fall through to a pinned-somewhere fallback rather than return a fragile SHA.
      return writeGzipFallback(rootDir, specPath, buf) ? GZIP_MARKER : '';
    }
  } catch {
    // DR-043 pt 5: non-git (or git absent) → gzip sidecar, per-machine fallback.
    return writeGzipFallback(rootDir, specPath, buf) ? GZIP_MARKER : '';
  }
}

/**
 * Recover the FR-4 body-only baseline from the ledger record.
 *
 * Branches by EXACT equality of `record.baselineBlob`:
 *   ''  or absent → undefined (no datapoint, e.g. legacy record or all-paths-failed)
 *   === GZIP_MARKER → gunzip `.minspec/snapshots/<refKey>.json.gz`; any error → undefined
 *   40-hex SHA → `git cat-file blob <sha>` → body string; any error (including a
 *                gc-pruned blob that outlived the ledger SHA) → undefined, NEVER throw.
 *
 * This function NEVER throws — any error degrades to undefined (INV — Deterministic).
 */
export function recoverBaseline(rootDir: string, record: ApprovalRecord): string | undefined {
  const blob = record.baselineBlob;
  if (!blob || blob === '') return undefined;

  if (blob === GZIP_MARKER) {
    try {
      const gz = fs.readFileSync(
        path.join(rootDir, '.minspec', 'snapshots', `${refKey(record.specPath)}.json.gz`),
      );
      return zlib.gunzipSync(gz).toString('utf-8');
    } catch {
      return undefined;
    }
  }

  // 40-hex SHA → git cat-file blob
  if (/^[0-9a-f]{40}$/i.test(blob)) {
    try {
      return execFileSync('git', ['cat-file', 'blob', blob], {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString('utf-8');
    } catch {
      return undefined; // blob gone (gc-pruned or missing) → no datapoint, never throw
    }
  }

  return undefined; // unrecognized form → degrade
}

/**
 * Deterministic FALLBACK for the approved-side baseline when the SPEC-017 minted
 * blob is unrecoverable (#701). Two records reach here with `recoverBaseline`
 * returning undefined despite a real prior approval: a LEGACY record predating
 * SPEC-017 baseline minting (`baselineBlob` '' / absent), and a per-machine blob
 * that never travelled to this clone (DR-043 — `refs/minspec/snapshots/*` is not
 * pushed by a plain `git push`). In BOTH cases the approved content is still
 * recoverable from git with zero persisted state: the record's canonical
 * `specHash` matches whichever committed version the human approved.
 *
 * Walks the spec file's own history newest→oldest, canonical-hashing each
 * committed version, and returns the BODY-ONLY text (same boundary as
 * `recoverBaseline` / the diff's 'current' side) of the FIRST commit whose
 * canonical hash equals `record.specHash`. Returns undefined when no commit
 * matches — a shallow/squashed clone, or content approved but never committed —
 * so the caller degrades to the existing "baseline unavailable" path.
 *
 * Bounded (MAX_HISTORY) so a pathological history degrades to the toast rather
 * than stalling the extension-host thread; runs only on a user diff click, and
 * short-circuits at the first match (typically within a handful of commits).
 * Tier-0, offline (local object store only). NEVER throws (INV — Deterministic).
 */
const MAX_HISTORY = 500;
export function recoverBaselineFromHistory(rootDir: string, record: ApprovalRecord): string | undefined {
  let shas: string[];
  try {
    shas = execFileSync('git', ['log', '--format=%H', '--', record.specPath], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1 << 24,
    })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return undefined; // not a git repo, git absent, or path never tracked
  }
  for (const sha of shas.slice(0, MAX_HISTORY)) {
    let content: string;
    try {
      content = execFileSync('git', ['show', `${sha}:${record.specPath}`], {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1 << 24,
      }).toString('utf-8');
    } catch {
      continue; // path absent at this commit (pre-creation / a rename boundary) — skip
    }
    if (specHash(content) === record.specHash) {
      return getSpecBodyOnly(content); // the exact content the human approved
    }
  }
  return undefined; // no committed version matches the approved hash → degrade
}

/**
 * Classify a record's baseline recoverability ON THIS MACHINE (#404).
 *
 * `recoverBaseline` collapses two very different situations into one bare
 * `undefined`: (a) NO baseline was ever recorded (legacy / all-mint-paths-failed →
 * baselineBlob is '' or absent), and (b) a baseline WAS recorded (a 40-hex SHA or
 * GZIP_MARKER) but cannot be resolved here — typically because the per-machine pin
 * ref never travelled with a plain `git push` and the blob has since been gc-pruned
 * on this clone (the DR-043 per-machine scope; see `mintBaseline`).
 *
 * Collapsing (a) and (b) is exactly the silent-drift bug: a recorded-but-gone
 * baseline reads identically to never-recorded. This function separates them:
 *   'none'          — baselineBlob is '' / absent → no datapoint was ever claimed.
 *   'recovered'     — a recorded pointer that resolves to a body here.
 *   'unrecoverable' — a recorded pointer (non-empty) that does NOT resolve here.
 *
 * Tier-0, offline. Never throws (delegates to `recoverBaseline`, which never throws).
 */
export function classifyBaseline(
  rootDir: string,
  record: ApprovalRecord,
): 'none' | 'recovered' | 'unrecoverable' {
  const blob = record.baselineBlob;
  if (!blob || blob === '') return 'none';
  return recoverBaseline(rootDir, record) === undefined ? 'unrecoverable' : 'recovered';
}

/**
 * Aggregate baseline integrity across every committed approval record (#404).
 *
 * Surfaces per-machine baseline drift as a report future M1/CI tooling can act on,
 * instead of letting `recoverBaseline`'s bare `undefined` hide it. `unrecoverableSpecs`
 * lists the repo-relative spec paths whose recorded baseline cannot be resolved on
 * THIS machine — the exact set an operator would re-mint or a CI check would flag.
 *
 * Invariant: `total === recovered + unrecoverable + noBaseline`. Tier-0, offline.
 */
export interface BaselineIntegrityReport {
  readonly total: number;              // number of committed approval records
  readonly recovered: number;          // baseline resolves to a body here
  readonly unrecoverable: number;      // baseline recorded but unresolvable here (drift)
  readonly noBaseline: number;         // no baseline ever recorded ('' / legacy)
  readonly unrecoverableSpecs: string[]; // specPaths of the unrecoverable records
}

/**
 * Walk every committed approval sidecar and classify each record's baseline.
 * Reads only the local ledger + git object store — no network (Tier-0).
 */
export function checkBaselineIntegrity(rootDir: string): BaselineIntegrityReport {
  const records = listRecords(rootDir);
  let recovered = 0;
  let unrecoverable = 0;
  let noBaseline = 0;
  const unrecoverableSpecs: string[] = [];
  for (const rec of records) {
    switch (classifyBaseline(rootDir, rec)) {
      case 'recovered':
        recovered++;
        break;
      case 'unrecoverable':
        unrecoverable++;
        unrecoverableSpecs.push(rec.specPath);
        break;
      default:
        noBaseline++;
    }
  }
  return { total: records.length, recovered, unrecoverable, noBaseline, unrecoverableSpecs };
}

/**
 * Canonical hash of a spec file's current content (FR-3). Returns null if the
 * file is unreadable. Replaces the old raw-byte `hashSpecFile`.
 */
export function canonicalSpecHash(specFilePath: string): string | null {
  try {
    return specHash(fs.readFileSync(specFilePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Capture the approver's identity offline (Tier-0, no network) — `git config
 * user.email` at approval time. An empty/missing value degrades to `'unknown'`;
 * never throws, so an approval is never blocked on git config (AC-3).
 */
export function gitConfigEmail(rootDir: string): string {
  try {
    return (
      execFileSync('git', ['config', 'user.email'], { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

// ─── DR-056 — Agent-proof approver identity (Decision 2, deny-by-default) ─────

/**
 * Thrown by `approveSpec` when the captured approver identity is NOT a provable
 * human — an agent/bot identity or an absent one (DR-056 Decision 2). Typed so the
 * command layer can distinguish "refused because the approver isn't human" from a
 * genuine I/O failure and surface the DR-012 "explicit human act" message.
 */
export class ApproverDeniedError extends Error {
  constructor(
    message: string,
    /** The offending captured identity (git email or configured value), for the message. */
    readonly identity: string,
  ) {
    super(message);
    this.name = 'ApproverDeniedError';
  }
}

/**
 * Built-in agent/container identities that may NEVER be recorded as a human
 * approver (DR-056). An approval attributed to one of these is agent
 * self-approval, which DR-012's "explicit human act" forbids — the exact hole the
 * independent reviewer flagged on #677 (a repo-local `user.email=claude@…`
 * override made `approvedBy` indistinguishable between a human approving and an
 * agent running *Approve Spec*).
 *
 * This is the inverse of DR-033 §6's `AI_REVIEW_BOT_LOGINS` *allowlist* (only the
 * bot may apply `ai-review:*`): here a *denylist* (only a non-agent may approve).
 * Extend at runtime with `MINSPEC_AGENT_IDENTITIES` (same grammar as
 * `AI_REVIEW_BOT_LOGINS`). Compared case-insensitively. Deny-by-default: any new
 * agent/CI identity MUST be added here or via the env var.
 */
export const BUILTIN_AGENT_IDENTITIES: readonly string[] = [
  // The Claude-account email — the single root of the #677 ambiguity (DR-056 Context).
  'claude@harvest316.com',
  // minspec-sdd[bot] — the App automation identity (id 299695933). Agent/container
  // commits author as this (DR-056 Decision 1); it can therefore never be an approver.
  'minspec-sdd[bot]@users.noreply.github.com',
  '299695933+minspec-sdd[bot]@users.noreply.github.com',
] as const;

/**
 * The sentinel `gitConfigEmail` returns when no git identity is configured. An
 * absent identity is NOT a valid approver (you cannot prove a human act without an
 * identity), so the gate denies it exactly like a bot identity.
 */
export const UNKNOWN_IDENTITY = 'unknown';

/**
 * Parse `MINSPEC_AGENT_IDENTITIES` into a lowercased, deduped denylist. Mirrors
 * DR-033's `parseAllowlist` grammar exactly (comma/whitespace separated) so the
 * denylist and the reviewer allowlist share one mental model. Undefined/empty → [].
 */
export function parseAgentIdentities(raw: string | undefined): string[] {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Result of the agent-proof approver check (DR-056). */
export type ApproverCheck =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly email: string; readonly reason: string };

/**
 * DR-056 Decision 2 — the agent-proof approver gate. Pure, deny-by-default,
 * offline (no git/network — the caller captures the identity). Refuses when the
 * identity is:
 *   • empty / whitespace / the `UNKNOWN_IDENTITY` sentinel — no identity is not a
 *     provable human act; or
 *   • a known agent/bot identity — the built-ins plus any `extraDenied` (parsed
 *     from `MINSPEC_AGENT_IDENTITIES`).
 * A human email passes. Comparison is case-insensitive and trims surrounding
 * whitespace (git can echo a trailing newline). Exported for exhaustive unit
 * testing — the security-critical decision is a pure input→output mapping.
 */
export function checkApprover(email: string, extraDenied: string[] = []): ApproverCheck {
  const trimmed = (email ?? '').trim();
  const lower = trimmed.toLowerCase();
  if (!lower || lower === UNKNOWN_IDENTITY) {
    return {
      ok: false,
      email: trimmed,
      reason:
        'no git identity is configured (git config user.email is empty) — set your human identity before approving',
    };
  }
  const denied = new Set<string>([
    ...BUILTIN_AGENT_IDENTITIES.map((s) => s.toLowerCase()),
    ...extraDenied.map((s) => s.toLowerCase()),
  ]);
  if (denied.has(lower)) {
    return {
      ok: false,
      email: trimmed,
      reason: `"${trimmed}" is an agent/bot identity — an agent can't self-approve; approve under your human identity`,
    };
  }
  return { ok: true, email: trimmed };
}

/**
 * Assert a captured identity may record an approval, else throw `ApproverDeniedError`.
 * Reads the runtime denylist extension from `MINSPEC_AGENT_IDENTITIES` so ANY caller
 * of `approveSpec` (UI command, dispatch script, test harness) is gated identically —
 * the lib boundary is the authoritative guard, not just the UI (defense-in-depth).
 */
export function assertHumanApprover(email: string): void {
  const check = checkApprover(email, parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES));
  if (!check.ok) throw new ApproverDeniedError(check.reason, check.email);
}

/**
 * Resolve approval status given a record and the spec's current CANONICAL hash.
 * Pure — exported for direct unit testing. A `migrated` record is `approved`
 * (valid-but-flagged) when its hash matches; the `migrated` provenance is carried
 * on the record itself for the gate/validator to surface.
 */
export function resolveStatus(
  record: ApprovalRecord | undefined,
  currentHash: string | null,
): ApprovalStatus {
  if (!record) return 'unapproved';
  if (currentHash === null) return 'unapproved';
  return record.specHash === currentHash ? 'approved' : 'stale';
}

/** Read approval status for a spec from its committed sidecar. */
export function getApprovalStatus(rootDir: string, specFilePath: string): ApprovalStatus {
  const rel = specRelPath(rootDir, specFilePath);
  return resolveStatus(readRecord(rootDir, rel), canonicalSpecHash(specFilePath));
}

/** Read the raw approval record for a spec (or undefined), for callers needing `migrated`. */
export function getApprovalRecord(rootDir: string, specFilePath: string): ApprovalRecord | undefined {
  return readRecord(rootDir, specRelPath(rootDir, specFilePath));
}

/**
 * Record an approval binding the spec's current CANONICAL content hash. Writes a
 * committed, attributed, path-keyed sidecar. Returns the new record.
 *
 * `email` is the captured `git config user.email` (the caller passes
 * `gitConfigEmail(rootDir)`). `now` is injectable for deterministic tests.
 * Path-keyed — the spec `id` is no longer part of the signature.
 *
 * SPEC-017 Slice 3: reads the spec file ONCE; derives both `specHash(raw)` and
 * `bodyOnly = getSpecBodyOnly(raw)` from the SAME in-memory string (no double-read,
 * no TOCTOU skew). Mints the FR-4 body-only baseline AFTER building the record.
 * Approval NEVER fails on a mint error — any git/gzip error degrades; the record
 * is written regardless (INV — Non-destructive, AC-1).
 */
export function approveSpec(
  rootDir: string,
  specFilePath: string,
  tier: Tier,
  email: string,
  now: () => Date = () => new Date(),
): ApprovalRecord {
  // DR-056 Decision 2: agent-proof approver gate at the lib boundary — deny BEFORE
  // any side effect (status flip, baseline mint, sidecar write) so a denied identity
  // never mints, mutates, or half-writes a record. Every caller is gated here, not
  // just the UI; the command layer pre-checks too for a friendlier message.
  assertHumanApprover(email);

  // 0. Single read — hash and baseline both derive from THESE bytes (no double-read,
  //    no TOCTOU skew between specHash and baselineBlob).
  let raw: string;
  try {
    raw = fs.readFileSync(specFilePath, 'utf-8');
  } catch {
    throw new Error(`Cannot read spec file to approve: ${specFilePath}`);
  }
  const hash = specHash(raw); // canonical-hash boundary (SPEC-022)

  // 1. FR-4 body-only bytes — NOT the canonical-hash boundary. The baseline diff
  //    measures LLM prose, so frontmatter is excluded ENTIRELY (canonical keeps
  //    frontmatter-minus-lifecycle; see §Why two boundaries in design.md).
  const bodyOnly = getSpecBodyOnly(raw);
  const specPath = specRelPath(rootDir, specFilePath);

  // 2. Mint + pin the baseline (git blob → sanitized ref), gzip fallback if non-git
  //    OR if the ref pin fails — never leave a blob unpinned (gc would prune it).
  //    Any error here degrades to '' (no M1 datapoint); approval is always written.
  const baselineBlob = mintBaseline(rootDir, specPath, bodyOnly);

  const record: ApprovalRecord = {
    specPath,
    specHash: hash,
    approvedAt: now().toISOString(),
    approvedBy: email,
    tier,
    migrated: false,
    baselineBlob, // reviewStart omitted — reserved for M3 (FR-7); JSON.stringify drops undefined.
  };
  writeRecord(rootDir, record);
  return record;
}

/** Remove a spec's approval sidecar. Returns true if one existed. */
export function revokeApproval(rootDir: string, specFilePath: string): boolean {
  return removeRecord(rootDir, specRelPath(rootDir, specFilePath));
}
