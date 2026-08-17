/**
 * MinSpec OIDC review-broker (SPEC-034) — Cloudflare Worker.
 *
 * Exchanges a GitHub Actions OIDC token for a short-lived, single-repository App
 * installation token, so an adopter's CI can post as `minspec-sdd[bot]` **without ever
 * holding the App private key**. DR-054: shipping a shared key is catastrophic, because
 * one key mints tokens for every repository that ever installed the App.
 *
 * VENDOR INFRASTRUCTURE, NOT PART OF THE EXTENSION. The vsix must never depend on this
 * package at build time and must never contain it. The App private key lives only in
 * this Worker's secret store — `no-app-private-key-shipped.test.ts` (AC-5) asserts it
 * appears nowhere in the tree.
 *
 * SLICE 0 (task 0.1): route scaffold only. Every request is refused with 501 and no
 * token is ever produced. That is the correct starting state for a fail-closed service:
 * the route exists and answers, and the answer is "not implemented" until the
 * verification path in Slice 1 is actually built. It must not be possible to deploy a
 * half-finished broker that mints anything.
 */

/** Error codes from the design's API contract. */
export type ErrorCode =
  | 'oidc_invalid'
  | 'repo_claim_mismatch'
  | 'app_not_installed'
  | 'rate_limited'
  | 'mint_failed'
  | 'not_implemented';

/** Fail-closed error body — never accompanied by a token. */
export interface TokenError {
  error: ErrorCode;
  reason: string;
}

/** JSON response with no-store caching, so a token can never sit in an intermediary. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A minted token is a bearer credential with a ~10 minute life. Nothing may
      // cache it, at any layer, ever.
      'cache-control': 'no-store',
    },
  });
}

/** The one route this Worker serves. */
export const TOKEN_PATH = '/installation-token';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== TOKEN_PATH) {
      return json({ error: 'not_implemented', reason: 'no such route' } satisfies TokenError, 404);
    }

    // Method check precedes everything: a GET that fell through to the token path
    // should never reach verification logic, and answering 405 here keeps the
    // not-implemented response below unambiguous about WHY it refused.
    if (request.method !== 'POST') {
      return json(
        { error: 'not_implemented', reason: 'POST required' } satisfies TokenError,
        405,
      );
    }

    // Slice 0 stops here, deliberately. Slices 1-2 add OIDC verification, claim-scoped
    // authorisation, and minting — until then the honest answer is that this cannot
    // issue a token, not a silent success or an empty 200.
    return json(
      {
        error: 'not_implemented',
        reason: 'broker scaffold — token minting lands in SPEC-034 slice 1',
      } satisfies TokenError,
      501,
    );
  },
};
