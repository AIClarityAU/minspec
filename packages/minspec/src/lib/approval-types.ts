// Type-only leaf: the approval sidecar's shapes. SPEC-040 FR-6 / #988 — re-homed from
// approval.ts so approval-store and lifecycle no longer close an import loop through it.
import type { Tier } from './config';

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
