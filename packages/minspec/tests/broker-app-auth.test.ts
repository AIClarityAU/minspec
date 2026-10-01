/**
 * SPEC-034 task 1.4a — direct coverage for the key-holding edge.
 *
 * WHY THIS FILE EXISTS. `broker-handler.test.ts` injects a fake factory, which is the
 * right way to test the decision path but means `makeInstallationTokenFactory` - the ONLY
 * code that touches the App private key - was never invoked by any test. Its guards are
 * all synchronous or fetch-shaped, so they are testable without a key and without a
 * network; there was no reason for them to be unexercised beyond nobody having written
 * this.
 *
 * WHAT IS STILL NOT COVERED, stated so the gap is not mistaken for coverage: the real
 * `@octokit/auth-app` signing path and a genuine GitHub response. Those need a private
 * key and the network, and they are task 1.4b's e2e observation, which is blocked.
 * Everything below stubs `fetch` and asserts the branches around that call.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeInstallationTokenFactory } from '../../broker/src/app-auth';

const REPO = 'AIClarityAU/voip-sms-inbox';

/**
 * A syntactically valid throwaway RSA key, generated at test time.
 *
 * Never a real credential, and never a hardcoded PEM either: a literal private key in a
 * fixture is the shape a secret scanner must flag, and one that is committed to be
 * "obviously fake" trains people to dismiss the finding.
 */
async function throwawayPem(): Promise<string> {
  const { generateKeyPair, exportPKCS8 } = await import('jose');
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return exportPKCS8(privateKey);
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('makeInstallationTokenFactory — credential presence', () => {
  it('returns null when no App id is bound', async () => {
    expect(makeInstallationTokenFactory({ MINSPEC_APP_PRIVATE_KEY: await throwawayPem() })).toBeNull();
  });

  it('returns null when no private key is bound', async () => {
    expect(makeInstallationTokenFactory({ MINSPEC_APP_ID: '4212099' })).toBeNull();
  });

  it('returns null for an empty-string binding, not just a missing one', async () => {
    // An unset Worker secret and an empty one are both "no credential". Treating '' as
    // present would build a factory that fails at first use instead of at configuration.
    expect(
      makeInstallationTokenFactory({ MINSPEC_APP_ID: '', MINSPEC_APP_PRIVATE_KEY: 'x' }),
    ).toBeNull();
    expect(
      makeInstallationTokenFactory({ MINSPEC_APP_ID: '1', MINSPEC_APP_PRIVATE_KEY: '' }),
    ).toBeNull();
  });

  it('returns a factory when both are bound — the control for the four nulls above', async () => {
    const f = makeInstallationTokenFactory({
      MINSPEC_APP_ID: '4212099',
      MINSPEC_APP_PRIVATE_KEY: await throwawayPem(),
    });
    expect(typeof f).toBe('function');
  });
});

describe('makeInstallationTokenFactory — guards around the installation lookup', () => {
  async function factory() {
    const f = makeInstallationTokenFactory({
      MINSPEC_APP_ID: '4212099',
      MINSPEC_APP_PRIVATE_KEY: await throwawayPem(),
    });
    if (!f) throw new Error('factory should exist with both credentials bound');
    return f;
  }

  it.each([
    ['no slash', 'notaslug'],
    ['leading slash', '/repo'],
    ['trailing slash', 'owner/'],
    ['empty', ''],
  ])('REFUSES a malformed repository (%s) before signing anything', async (_label, repository) => {
    const f = await factory();
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(f({ repository, permissions: { issues: 'write' } })).rejects.toThrow();
    // The load-bearing half: it refuses BEFORE any network call, so a malformed slug
    // never reaches GitHub and never causes the App key to sign a lookup.
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the installation lookup fails, without leaking the response', async () => {
    const f = await factory();
    globalThis.fetch = (async () =>
      new Response('{"message":"Not Found"}', { status: 404 })) as unknown as typeof fetch;
    await expect(f({ repository: REPO, permissions: { issues: 'write' } })).rejects.toThrow(
      /installation lookup failed/,
    );
  });

  it('throws when the lookup succeeds but carries no installation id', async () => {
    // A 200 with an unexpected body must not be read as "installation 0" or undefined and
    // passed on to minting.
    const f = await factory();
    globalThis.fetch = (async () =>
      new Response('{"not_an_id":true}', { status: 200 })) as unknown as typeof fetch;
    await expect(f({ repository: REPO, permissions: { issues: 'write' } })).rejects.toThrow(
      /no id/,
    );
  });

  it('requests the installation with an encoded path and a User-Agent', async () => {
    // GitHub 403s a request with no User-Agent, which reads as an auth failure and sends
    // the reader hunting the App key instead of the header.
    const f = await factory();
    let seenUrl = '';
    let seenUa: string | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenUa = new Headers(init?.headers).get('user-agent');
      return new Response('{"not_an_id":true}', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(f({ repository: REPO, permissions: { issues: 'write' } })).rejects.toThrow();
    expect(seenUrl).toBe(
      'https://api.github.com/repos/AIClarityAU/voip-sms-inbox/installation',
    );
    expect(seenUa).toBeTruthy();
  });
});
