/**
 * Pure authorisation decisions for the OIDC review-broker (SPEC-034).
 *
 * Deliberately I/O-free: no fetch, no crypto, no clock. Signature verification and
 * minting live at the edges; everything decidable from already-verified claims is
 * decided here, so the security-critical rules are testable without a network, a key,
 * or a running Worker.
 *
 * SLICE 1 (tasks 1.2, 1.5): claim-scoped authorisation and the request-shape contract
 * are implemented. Minting (1.3) and OIDC signature verification (1.1) remain at the
 * edges — this module trusts that its `claims` argument was already verified, which is
 * exactly why the caller must never pass unverified claims into it.
 */

/** Claims the broker trusts, i.e. already verified against GitHub's JWKS. */
export interface VerifiedClaims {
  /** `owner/repo` the workflow is running in. The ONLY authorisation source. */
  repository: string;
  /** `owner` — retained for org-scoped policy later. */
  repository_owner: string;
}

/** The request body contract (the normative `## API` block; JWT rides Authorization). */
export interface TokenRequestBody {
  repository: string;
  permissions_profile: 'review';
}

export type Denial =
  | 'oidc_invalid'
  | 'repo_claim_mismatch'
  | 'unsupported_profile'
  | 'unexpected_field'
  | 'not_implemented';

export type Decision =
  | { allow: true; repository: string }
  | { allow: false; denial: Denial; status: number };

/** Fields the body may carry. Anything else is refused — never ignored (AC-6). */
export const ALLOWED_BODY_FIELDS: readonly string[] = ['repository', 'permissions_profile'];

/** The only permissions profile in v1. */
const SUPPORTED_PROFILES: readonly string[] = ['review'];

/** A plain object — not null, not an array, not a primitive. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Decide whether to mint, from VERIFIED claims and the request body.
 *
 * Order is load-bearing and deliberately shape-before-content:
 *
 *   1. body shape   — a malformed body is refused before any field is read, so a
 *                     caller cannot reach the comparison logic with a hostile type;
 *   2. extra fields — refused, NEVER ignored (AC-6/FR-6). Ignoring would let a caller
 *                     smuggle code, diff, spec or prompt content the broker has
 *                     promised never to receive, and a silently-dropped field leaves
 *                     no audit trace;
 *   3. profile      — only `review` exists in v1; an unknown profile must not fall
 *                     through to a default set of permissions;
 *   4. repo match   — the confused-deputy rule (AC-2).
 *
 * The confused-deputy rule is the reason this function exists. The token is minted
 * from the CLAIM; the body's `repository` is only ever a cross-check. A workflow
 * running legitimately in repo A carries a genuine OIDC token, so signature
 * verification alone would happily authorise it to mint for repo B — only comparing
 * the body against the claim catches that, and the claim must win.
 *
 * Never throws: a thrown error becomes a 500, and a 500 is a shape callers retry.
 * Denial is terminal and honest.
 */
export function decide(claims: VerifiedClaims, body: unknown): Decision {
  if (!isPlainObject(body)) {
    return { allow: false, denial: 'unexpected_field', status: 400 };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.includes(key)) {
      return { allow: false, denial: 'unexpected_field', status: 400 };
    }
  }

  const profile = body.permissions_profile;
  if (typeof profile !== 'string' || !SUPPORTED_PROFILES.includes(profile)) {
    return { allow: false, denial: 'unsupported_profile', status: 400 };
  }

  const requested = body.repository;
  if (typeof requested !== 'string' || requested.length === 0) {
    return { allow: false, denial: 'repo_claim_mismatch', status: 403 };
  }

  // A claim with no repository authorises nothing — fail closed rather than treat an
  // absent claim as a wildcard.
  if (typeof claims.repository !== 'string' || claims.repository.length === 0) {
    return { allow: false, denial: 'oidc_invalid', status: 401 };
  }

  if (requested !== claims.repository) {
    return { allow: false, denial: 'repo_claim_mismatch', status: 403 };
  }

  // Mint for the CLAIM, not the body — even though they are equal here, so that a
  // future edit cannot quietly make the body the source of truth.
  return { allow: true, repository: claims.repository };
}

/**
 * The reviewer identity the workflow posts as — read from config, NEVER hardcoded
 * (AC-10). An enterprise running its own App must be able to post as its own bot
 * without patching MinSpec, so the product default (`minspec-sdd[bot]`, DR-054) lives
 * in the scaffolded workflow, not compiled in here.
 */
export function resolveReviewerIdentity(config: { botLogins?: string }): string | null {
  const raw = config.botLogins;
  if (typeof raw !== 'string') return null;
  const first = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}
