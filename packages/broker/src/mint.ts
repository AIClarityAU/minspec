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

/**
 * Ceiling on token lifetime: GitHub's fixed installation-token lifetime, one hour.
 *
 * FR-3 asks for "a TTL no longer than needed (target ≤10 min; GitHub's ceiling is 1h)".
 * The ≤10 min half is NOT ACHIEVABLE and never was. `POST /app/installations/{id}/
 * access_tokens` accepts exactly three body parameters - `repositories`,
 * `repository_ids`, `permissions` - and no lifetime field; the docs state installation
 * tokens "expire one hour from the time you create them". There is no shorter token to
 * ask for.
 *
 * This was 600, which made the broker refuse EVERY real mint: GitHub returns 3600s,
 * `clampExpiry` rejected anything above 600s, and so the live path could only ever
 * answer "auth returned an unusable expiry". The bound was written as though a
 * ten-minute credential existed to protect.
 *
 * The ceiling still earns its place at 3600: it fails closed if a future API change or a
 * misconfigured factory hands back something longer than the documented maximum. What it
 * cannot do is manufacture a shorter credential, so exposure is limited by using the
 * token immediately and never storing it - not by this number.
 */
export const MAX_TTL_SECONDS = 3600;

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
}) => Promise<{ token: string; expiresAt: string; permissions: Record<string, string> }>;

/**
 * Permission levels, least to most. `admin` is not in the `review` profile and never
 * should be; it is ranked so that a provider handing one back is DETECTED rather than
 * silently unrecognised.
 */
const LEVEL_RANK: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };

/**
 * Name the first way `granted` exceeds `requested`, or null when it does not.
 *
 * Narrower is fine — GitHub may hand back less than asked, and less is safe. WIDER is the
 * failure this exists to catch, and so is anything we cannot rank: an unrecognised level
 * is treated as a widening rather than waved through, because a scope this code does not
 * understand is exactly the one it must not vouch for (constitution invariant 2 — a
 * missing or unreadable witness fails closed, it does not silently pass).
 */
export function findWidening(
  granted: Record<string, string>,
  requested: Record<string, string> = REVIEW_PERMISSIONS,
): string | null {
  for (const [scope, level] of Object.entries(granted)) {
    const asked = requested[scope];
    if (asked === undefined) return `granted an unrequested scope (${scope})`;
    const got = LEVEL_RANK[level];
    const want = LEVEL_RANK[asked];
    if (got === undefined) return `granted an unrecognised level for ${scope}`;
    if (want === undefined || got > want) return `granted ${scope} wider than requested`;
  }
  return null;
}

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

  // A token whose scope we cannot read is a token we cannot vouch for. Refuse rather
  // than mint it and describe it with the profile we merely ASKED for — that would make
  // the response understate a scope nobody checked.
  if (!raw.permissions || typeof raw.permissions !== 'object') {
    return { ok: false, reason: 'auth did not report granted permissions' };
  }

  // The real case: a provider that hands back MORE than the review profile. Refuse it;
  // do not mint a wider credential and render it as though the broker sanctioned it.
  const widening = findWidening(raw.permissions);
  if (widening) return { ok: false, reason: `auth ${widening}` };

  return {
    ok: true,
    minted: {
      token: raw.token,
      expires_at: expiresAt,
      // Report what was ACTUALLY granted, having just proven it is not wider than the
      // review profile. Narrower is possible and legitimate, so echoing the requested
      // profile here would overstate the token's scope.
      permissions: { ...raw.permissions },
      repositories: [repository],
    },
  };
}

/**
 * Reject an expiry beyond the ceiling rather than trusting the provider.
 *
 * One hour is GitHub's documented, fixed lifetime, so the normal case sits exactly at the
 * ceiling rather than under it. This guards the case the platform does not promise: a
 * factory or API change returning something longer still. Minting that anyway would
 * silently extend the credential's life past anything the design reasoned about, and the
 * drift is invisible until a leaked token is still valid long after the run that used it.
 */
export function clampExpiry(expiresAt: unknown, now: number = Date.now()): string | null {
  if (typeof expiresAt !== 'string' || expiresAt.length === 0) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  if (t <= now) return null; // already expired — useless and a sign something is wrong
  if (t - now > MAX_TTL_SECONDS * 1000) return null;
  return new Date(t).toISOString();
}
