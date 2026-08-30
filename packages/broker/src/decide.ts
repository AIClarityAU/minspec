/**
 * Pure authorisation decisions for the OIDC review-broker (SPEC-034).
 *
 * Deliberately I/O-free: no fetch, no crypto, no clock. Signature verification and
 * minting live at the edges (slice 1); everything decidable from already-verified
 * claims is decided here, so the security-critical rules are testable without a
 * network, a key, or a running Worker.
 *
 * SLICE 0 (task 0.2): the CONTRACT exists and the decisions do not. Every function
 * below returns a deny. That is the honest starting state for a fail-closed service —
 * an unimplemented broker must refuse, never accidentally permit — and it is what
 * makes the T0 tests genuinely red rather than red-by-absence: the module loads, the
 * types are real, and each `it.fails` names the behaviour slice 1 must deliver.
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

/**
 * Decide whether to mint, from VERIFIED claims and the request body.
 *
 * The confused-deputy rule (AC-2) lives here: the token is minted from the CLAIM,
 * and the body's `repository` is only ever a cross-check. A body that disagrees is a
 * caller asking for a token on a repo it did not prove it runs in.
 */
export function decide(_claims: VerifiedClaims, _body: unknown): Decision {
  // Slice 0: refuse everything. Slice 1 implements the rules the T0 tests name.
  return { allow: false, denial: 'not_implemented', status: 501 };
}

/**
 * The reviewer identity the workflow posts as — read from config, NEVER hardcoded
 * (AC-10). An enterprise running its own App must be able to post as its own bot
 * without patching MinSpec.
 */
export function resolveReviewerIdentity(_config: { botLogins?: string }): string | null {
  return null; // slice 0
}
