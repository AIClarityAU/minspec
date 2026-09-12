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
 * REQUEST PATH (task 1.4). Order is load-bearing and runs cheapest-and-most-hostile
 * first: route, method, bearer present, OIDC signature/iss/aud/exp, body shape, claim
 * match, then mint. Verification precedes parsing so a request that cannot possibly be
 * authorised is never deserialised, and minting is last so no step after it can turn a
 * refusal into a success.
 *
 * EVERY FAILURE RETURNS NO TOKEN (AC-9). There is exactly one `return` that carries a
 * credential and it sits after all of the above. A 501 previously stood in for that
 * guarantee; the guarantee now has to be carried by the ordering, which is why
 * `broker-handler.test.ts` asserts the refusal at each individual step rather than
 * trusting the shape of the function.
 */

import { decide } from './decide';
import { defaultJwks, verifyOidcToken } from './verify';
import { mintScopedToken } from './mint';
import { makeInstallationTokenFactory, type BrokerEnv } from './app-auth';
import type { JWTVerifyGetKey } from 'jose';
import type { InstallationTokenFactory } from './mint';

export type { BrokerEnv };

/**
 * Error codes from the design's API contract, plus the ones reality required.
 *
 * `design.md` §API lists five: `oidc_invalid`, `repo_claim_mismatch`,
 * `app_not_installed`, `rate_limited`, `mint_failed`. Three more are unavoidable and are
 * flagged rather than smuggled in:
 *
 * - `unexpected_field` / `unsupported_profile` — `decide()` (task 1.2, already merged)
 *   emits these as 400s and `broker-decision-logic.test.ts` pins both names. The contract
 *   has no 400 member at all, so it is the contract that is incomplete.
 * - `broker_misconfigured` — a Worker deployed without an audience or App credentials is
 *   broken, not handed a bad request. Reporting it as `oidc_invalid` would blame the
 *   caller for our deployment and send an adopter hunting a token problem that does not
 *   exist.
 *
 * Tracked for the design update rather than resolved silently here.
 */
export type ErrorCode =
  | 'oidc_invalid'
  | 'repo_claim_mismatch'
  | 'app_not_installed'
  | 'rate_limited'
  | 'mint_failed'
  | 'unexpected_field'
  | 'unsupported_profile'
  | 'broker_misconfigured'
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

/** Pull the bearer credential out of `Authorization`, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/**
 * The impure edges, injectable for the same reason `mint.ts` takes its factory as an
 * argument: otherwise every test past OIDC verification needs GitHub's live JWKS, and a
 * test that needs the network is a test that does not run in CI. Production wiring is the
 * default export below; nothing else may pass these.
 */
export interface HandlerDeps {
  jwks?: () => Promise<JWTVerifyGetKey>;
  factory?: (env: BrokerEnv) => InstallationTokenFactory | null;
}

export function createFetchHandler(deps: HandlerDeps = {}) {
  const resolveJwks = deps.jwks ?? defaultJwks;
  const resolveFactory = deps.factory ?? makeInstallationTokenFactory;

  return async function fetch(request: Request, env: BrokerEnv = {}): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== TOKEN_PATH) {
      return json({ error: 'not_implemented', reason: 'no such route' } satisfies TokenError, 404);
    }

    // Method check precedes everything: a GET that fell through to the token path
    // should never reach verification logic.
    if (request.method !== 'POST') {
      return json(
        { error: 'not_implemented', reason: 'POST required' } satisfies TokenError,
        405,
      );
    }

    // The audience is required and never defaulted. An unconstrained audience accepts a
    // token GitHub minted for a different service entirely.
    const audience = env.BROKER_AUDIENCE;
    if (!audience) {
      return json(
        { error: 'broker_misconfigured', reason: 'broker audience not configured' } satisfies TokenError,
        500,
      );
    }

    const jwt = bearerToken(request.headers.get('authorization'));
    if (!jwt) {
      return json({ error: 'oidc_invalid', reason: 'invalid token' } satisfies TokenError, 401);
    }

    // Constant reason on every verification failure. jose distinguishes signature,
    // audience, issuer and expiry; echoing which one failed hands an attacker a probing
    // oracle for shaping the next attempt.
    const verified = await verifyOidcToken(jwt, audience, await resolveJwks());
    if (!verified.ok) {
      return json({ error: 'oidc_invalid', reason: 'invalid token' } satisfies TokenError, 401);
    }

    // Only now is the body worth reading. A malformed body is an unexpected shape, which
    // is the same class `decide()` refuses rather than ignores (AC-6).
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(
        { error: 'unexpected_field', reason: 'body must be JSON' } satisfies TokenError,
        400,
      );
    }

    const decision = decide(verified.claims, body);
    if (!decision.allow) {
      return json(
        { error: decision.denial, reason: 'refused' } satisfies TokenError,
        decision.status,
      );
    }

    // Credentials are resolved AFTER authorisation, so an unauthorised request never
    // touches the key path at all.
    const factory = resolveFactory(env);
    if (!factory) {
      return json(
        { error: 'broker_misconfigured', reason: 'app credentials not configured' } satisfies TokenError,
        500,
      );
    }

    // `mintScopedToken` takes the VERIFIED claims, not `decision.repository`, so the
    // confused-deputy rule is enforced by the type rather than by this call site
    // remembering to pass the right string.
    const result = await mintScopedToken(verified.claims, factory);
    if (!result.ok) {
      return json({ error: 'mint_failed', reason: 'could not mint' } satisfies TokenError, 502);
    }

    // The only response in this function that carries a credential.
    return json(result.minted, 200);
  };
}

export default { fetch: createFetchHandler() };
