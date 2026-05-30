/**
 * Spec Approval State — DR-012
 *
 * Approval is an explicit human act, recorded as a content hash of the spec
 * file. Editing the spec changes the hash → the approval auto-invalidates
 * ("stale"), forcing re-review.
 *
 * The hash is sha256 over the raw file bytes so the bash gate hook
 * (`sha256sum`) and this module (Node `crypto`) agree exactly.
 *
 * State lives in `.minspec/approvals.json`:
 *   { "SPEC-007": { "specHash": "ab12…", "approvedAt": "2026-05-30T…", "tier": "T3" } }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Tier } from './config';

export type ApprovalStatus = 'approved' | 'stale' | 'unapproved';

export interface ApprovalRecord {
  readonly specHash: string;
  readonly approvedAt: string;
  readonly tier: Tier;
}

export interface ApprovalStore {
  [specId: string]: ApprovalRecord;
}

const APPROVALS_FILE = 'approvals.json';

function approvalsPath(rootDir: string): string {
  return path.join(rootDir, '.minspec', APPROVALS_FILE);
}

/** sha256 hex of raw bytes. Accepts a Buffer or string. Matches `sha256sum`. */
export function hashContent(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Hash a spec file by its raw bytes. Returns null if unreadable. */
export function hashSpecFile(filePath: string): string | null {
  try {
    return hashContent(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

export function loadApprovals(rootDir: string): ApprovalStore {
  const p = approvalsPath(rootDir);
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Shallow shape validation — drop malformed records rather than throw.
    const store: ApprovalStore = {};
    for (const [id, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        rec && typeof rec === 'object' &&
        typeof (rec as ApprovalRecord).specHash === 'string' &&
        typeof (rec as ApprovalRecord).approvedAt === 'string'
      ) {
        store[id] = rec as ApprovalRecord;
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function saveApprovals(rootDir: string, store: ApprovalStore): void {
  const dir = path.join(rootDir, '.minspec');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(approvalsPath(rootDir), JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

/**
 * Resolve approval status for a spec given its current on-disk content.
 * Pure given (record, currentHash) — exported for direct unit testing.
 */
export function resolveStatus(
  record: ApprovalRecord | undefined,
  currentHash: string | null,
): ApprovalStatus {
  if (!record) return 'unapproved';
  if (currentHash === null) return 'unapproved';
  return record.specHash === currentHash ? 'approved' : 'stale';
}

/** Read approval status for a spec from disk. */
export function getApprovalStatus(
  rootDir: string,
  specId: string,
  specFilePath: string,
): ApprovalStatus {
  const store = loadApprovals(rootDir);
  return resolveStatus(store[specId], hashSpecFile(specFilePath));
}

/**
 * Record an approval binding the current file hash. Returns the new record.
 * `now` is injectable for deterministic tests.
 */
export function approveSpec(
  rootDir: string,
  specId: string,
  specFilePath: string,
  tier: Tier,
  now: () => Date = () => new Date(),
): ApprovalRecord {
  const specHash = hashSpecFile(specFilePath);
  if (specHash === null) {
    throw new Error(`Cannot read spec file to approve: ${specFilePath}`);
  }
  const record: ApprovalRecord = {
    specHash,
    approvedAt: now().toISOString(),
    tier,
  };
  const store = loadApprovals(rootDir);
  store[specId] = record;
  saveApprovals(rootDir, store);
  return record;
}

/** Remove an approval. Returns true if one existed. */
export function revokeApproval(rootDir: string, specId: string): boolean {
  const store = loadApprovals(rootDir);
  if (!(specId in store)) return false;
  delete store[specId];
  saveApprovals(rootDir, store);
  return true;
}
