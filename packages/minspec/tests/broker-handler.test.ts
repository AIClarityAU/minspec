/**
 * SPEC-034 task 1.4 — the broker's live request path.
 *
 * WHAT REPLACED THE 501. Slice 0 guaranteed "no token, ever" by never reaching minting
 * at all, and `broker-scaffold.test.ts` pinned that while it was trivially true. Wiring
 * the path removes that guarantee wholesale: the function now CAN return a credential,
 * and the only thing standing between a request and one is the ordering of the checks in
 * between. So the property has to be re-established step by step - each check asserted to
 * refuse on its own, rather than inferred from the shape of the function.
 *
 * REAL CRYPTO, NO NETWORK. Tokens are signed with a real RS256 keypair and verified by
 * the real `jose` path; only the JWKS lookup and the App-token factory are injected. A
 * mocked verifier would prove the mock was called.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { createFetchHandler, TOKEN_PATH, type BrokerEnv } from '../../broker/src/index';
import { GITHUB_OIDC_ISSUER } from '../../broker/src/verify';
import { REVIEW_PERMISSIONS, type InstallationTokenFactory } from '../../broker/src/mint';

const AUD = 'https://broker.minspec.dev';
const REPO = 'AIClarityAU/voip-sms-inbox';
const BASE = 'https://broker.example.invalid';

const ENV: BrokerEnv = {
  BROKER_AUDIENCE: AUD,
  MINSPEC_APP_ID: '4212099',
  MINSPEC_APP_PRIVATE_KEY: 'not-a-real-key-the-factory-is-injected',
};

async function keyring() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>, aud = AUD) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(aud)
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** A factory standing in for GitHub: grants exactly what was asked, one hour out. */
const goodFactory: InstallationTokenFactory = async ({ permissions }) => ({
  token: 'ghs_live_token',
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  permissions,
});

async function callWith(
  opts: {
    jwt?: string | null;
    body?: unknown;
    raw?: string;
    method?: string;
    path?: string;
    env?: BrokerEnv;
    jwks?: Awaited<ReturnType<typeof keyring>>['jwks'];
    factory?: InstallationTokenFactory | null;
  } = {},
): Promise<Response> {
  const handler = createFetchHandler({
    jwks: opts.jwks ? async () => opts.jwks! : async () => createLocalJWKSet({ keys: [] }),
    factory: () => (opts.factory === undefined ? goodFactory : opts.factory),
  });
  const headers: Record<string, string> = {};
  if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
  return handler(
    new Request(`${BASE}${opts.path ?? TOKEN_PATH}`, {
      method: opts.method ?? 'POST',
      headers,
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    }),
    opts.env ?? ENV,
  );
}

const VALID_BODY = { repository: REPO, permissions_profile: 'review' };

describe('SPEC-034 task 1.4 — broker live path', () => {
  it('mints for a valid token whose claim matches the body', async () => {
    const { privateKey, jwks } = await keyring();
    const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
    const res = await callWith({ jwt, body: VALID_BODY, jwks });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token).toBe('ghs_live_token');
    expect(body.repositories).toEqual([REPO]);
    expect(body.permissions).toEqual({ ...REVIEW_PERMISSIONS });
    expect(typeof body.expires_at).toBe('string');
    // The control for every refusal below: if this went red, the refusals would pass by
    // refusing everything and prove nothing.
  });

  it('marks the minted response no-store', async () => {
    const { privateKey, jwks } = await keyring();
    const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
    const res = await callWith({ jwt, body: VALID_BODY, jwks });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  describe('every refusal returns NO token (AC-9)', () => {
    const noToken = async (res: Response) => {
      const text = await res.text();
      expect(text).not.toContain('ghs_');
    };

    it('401s with no Authorization header', async () => {
      const res = await callWith({ body: VALID_BODY });
      expect(res.status).toBe(401);
      await noToken(res);
    });

    it('401s on a token signed by a key the JWKS does not trust', async () => {
      const good = await keyring();
      const evil = await keyring();
      const jwt = await sign(evil.privateKey, { repository: REPO, repository_owner: 'x' });
      const res = await callWith({ jwt, body: VALID_BODY, jwks: good.jwks });
      expect(res.status).toBe(401);
      await noToken(res);
    });

    it('401s on a token minted for a different audience', async () => {
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO }, 'https://someone-else.example');
      const res = await callWith({ jwt, body: VALID_BODY, jwks });
      expect(res.status).toBe(401);
      await noToken(res);
    });

    it('403s when the body asks for a repo the claim does not authorise', async () => {
      // The confused-deputy case: a valid token from repo A must not mint for repo B.
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
      const res = await callWith({
        jwt,
        body: { repository: 'attacker/other', permissions_profile: 'review' },
        jwks,
      });
      expect(res.status).toBe(403);
      await noToken(res);
    });

    it('400s on a field beyond the contract, rather than ignoring it', async () => {
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
      const res = await callWith({
        jwt,
        body: { ...VALID_BODY, diff: 'some artifact content' },
        jwks,
      });
      expect(res.status).toBe(400);
      await noToken(res);
    });

    it('400s on a body that is not JSON', async () => {
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
      const res = await callWith({ jwt, raw: 'not json at all', jwks });
      expect(res.status).toBe(400);
      await noToken(res);
    });

    it('502s when minting fails, without echoing provider detail', async () => {
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
      const boom: InstallationTokenFactory = async () => {
        throw new Error('App 4212099 installation 144283146 denied');
      };
      const res = await callWith({ jwt, body: VALID_BODY, jwks, factory: boom });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toContain('ghs_');
      expect(text).not.toMatch(/4212099|144283146/);
    });
  });

  describe('misconfiguration is reported as ours, not the caller\'s', () => {
    it('500s with no audience configured, rather than 401', async () => {
      // Reporting this as oidc_invalid would blame the caller for our deployment and
      // send an adopter hunting a token problem that does not exist.
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO });
      const res = await callWith({ jwt, body: VALID_BODY, jwks, env: { MINSPEC_APP_ID: '1' } });
      expect(res.status).toBe(500);
      expect((await res.json()) as { error: string }).toMatchObject({
        error: 'broker_misconfigured',
      });
    });

    it('500s when App credentials are absent', async () => {
      const { privateKey, jwks } = await keyring();
      const jwt = await sign(privateKey, { repository: REPO, repository_owner: 'AIClarityAU' });
      const res = await callWith({ jwt, body: VALID_BODY, jwks, factory: null });
      expect(res.status).toBe(500);
      expect((await res.json()) as { error: string }).toMatchObject({
        error: 'broker_misconfigured',
      });
    });
  });

  describe('verification precedes body handling', () => {
    it('refuses an unauthenticated request carrying a huge body without reading it', async () => {
      // Ordering matters beyond tidiness: an unauthorised caller must not be able to
      // make the broker deserialise arbitrary input, and no artifact content may reach
      // a code path that could store or forward it (AC-6).
      const res = await callWith({ raw: JSON.stringify({ blob: 'x'.repeat(100_000) }) });
      expect(res.status).toBe(401);
    });
  });
});
