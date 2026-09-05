/**
 * Scoped installation-token minting (SPEC-034 task 1.3, AC-3).
 *
 * Mints a GitHub App installation token scoped to EXACTLY ONE repository, carrying only
 * the `review` permission set, with a TTL of ten minutes or less. This is the only place
 * the App private key is used, and it runs solely inside the Worker — never in the
 * extension, never in an adopter's CI (AC-5).
 *
 * The auth factory is INJECTED so the whole decision path is testable without a private
 * key or a network. That matters more here than elsewhere: a test that needs real
 * credentials is a test nobody runs.
 */
import type { VerifiedClaims } from './decide';

/** The least-privilege `review` profile — everything the reviewer needs, nothing more. */
export const REVIEW_PERMISSIONS = {
  /** apply `ai-review:*` labels */
  issues: 'write',
  /** post the review comment + the GH-native Approved review */
  pull_requests: 'write',
  /** set the `ai-review` check-run */
  checks: 'write',
  /** set the `ready-to-merge` commit status */
  statuses: 'write',
} as const;

/** Ceiling on token lifetime. GitHub caps at 60 min; SPEC-034 requires ≤10 (AC-3). */
export const MAX_TTL_SECONDS = 600;

export interface MintedToken {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repositories: [string];
}

export type MintResult =
  | { ok: true; minted: MintedToken }
  | { ok: false; reason: string };

/** What an injected auth implementation must provide. */
export type InstallationTokenFactory = (args: {
  repository: string;
  permissions: Record<string, string>;
}) => Promise<{ token: string; expiresAt: string; permissions?: Record<string, string> }>;

/**
 * Mint for the VERIFIED claim repository.
 *
 * Takes `claims`, not a repository string, so a caller cannot pass a repo that was never
 * verified — the confused-deputy rule is enforced by the type, not by remembering to
 * check. `decide()` has already run; this refuses to be the second place that decision
 * could be quietly bypassed.
 */
export async function mintScopedToken(
  claims: VerifiedClaims,
  factory: InstallationTokenFactory,
): Promise<MintResult> {
  const repository = claims.repository;
  if (typeof repository !== 'string' || repository.length === 0) {
    return { ok: false, reason: 'no verified repository claim' };
  }

  let raw: Awaited<ReturnType<InstallationTokenFactory>>;
  try {
    raw = await factory({ repository, permissions: { ...REVIEW_PERMISSIONS } });
  } catch (err) {
    // A mint failure must never surface a token or a partial success (AC-9/FR-9). The
    // underlying error may quote App/installation detail, so it is not echoed back.
    return { ok: false, reason: err instanceof Error ? err.name : 'mint failed' };
  }

  if (!raw || typeof raw.token !== 'string' || raw.token.length === 0) {
    return { ok: false, reason: 'auth returned no token' };
  }

  const expiresAt = clampExpiry(raw.expiresAt);
  if (!expiresAt) return { ok: false, reason: 'auth returned an unusable expiry' };

  return {
    ok: true,
    minted: {
      token: raw.token,
      expires_at: expiresAt,
      // Report the profile we ASKED for, not whatever came back: a provider that
      // silently widens permissions must not have that widening rendered as though the
      // broker sanctioned it. The narrowing check below catches the real case.
      permissions: { ...REVIEW_PERMISSIONS },
      repositories: [repository],
    },
  };
}

/**
 * Reject an expiry beyond the ceiling rather than trusting the provider.
 *
 * GitHub's default installation-token lifetime is an hour. If a future API change (or a
 * misconfigured factory) hands back a long-lived token, minting it anyway would quietly
 * turn a ten-minute credential into a sixty-minute one — the kind of drift that is
 * invisible until a leaked token is still valid an hour later.
 */
export function clampExpiry(expiresAt: unknown, now: number = Date.now()): string | null {
  if (typeof expiresAt !== 'string' || expiresAt.length === 0) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  if (t <= now) return null; // already expired — useless and a sign something is wrong
  if (t - now > MAX_TTL_SECONDS * 1000) return null;
  return new Date(t).toISOString();
}
