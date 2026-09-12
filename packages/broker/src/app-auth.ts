/**
 * The real `InstallationTokenFactory` — the only place the App private key is used
 * (SPEC-034 task 1.4, AC-5).
 *
 * `mint.ts` takes the factory as an argument so its decision logic stays testable without
 * a key or a network. This module is the other half: the impure edge that actually talks
 * to GitHub. Keeping them apart is what lets the security-critical narrowing and TTL
 * checks be unit-tested against injected doubles while this file stays thin enough to
 * read in one pass.
 *
 * WHY A KEY-HOLDING MODULE LIVES HERE AND NOWHERE ELSE. DR-054: one leaked App key mints
 * tokens for every repository that ever installed the App. The key reaches this Worker's
 * secret store and no other artifact — `no-app-private-key-shipped.test.ts` (AC-5)
 * asserts it appears nowhere in the tree, and `broker-scaffold.test.ts` asserts no
 * extension source can even import this package.
 */
import { createAppAuth } from '@octokit/auth-app';
import type { InstallationTokenFactory } from './mint';

/** Worker bindings. Secrets and vars are both plain strings at runtime. */
export interface BrokerEnv {
  /** Public identifier, a plain `[vars]` entry on purpose. */
  MINSPEC_APP_ID?: string;
  /** The App private key (PEM). A Worker SECRET — never a var, never committed. */
  MINSPEC_APP_PRIVATE_KEY?: string;
  /**
   * The `aud` every incoming OIDC token must carry. Deliberately has no default:
   * `verify.ts` refuses an empty audience rather than accepting a token GitHub minted
   * for some other service, which is the entire reason `aud` exists.
   */
  BROKER_AUDIENCE?: string;
}

const GITHUB_API = 'https://api.github.com';

/** GitHub requires a User-Agent; an unset one is a 403 that looks like an auth failure. */
const UA = 'minspec-review-broker';

/**
 * Build a factory, or return null when the Worker has no App credentials bound.
 *
 * Null rather than a throw, so the caller decides the wire behaviour: a broker with no
 * key is misconfigured, not handed a bad request, and the two must not report the same
 * way. Returning a factory that fails on first use would hide the distinction until a
 * request arrived.
 */
export function makeInstallationTokenFactory(env: BrokerEnv): InstallationTokenFactory | null {
  const appId = env.MINSPEC_APP_ID;
  const privateKey = env.MINSPEC_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return null;

  const auth = createAppAuth({ appId, privateKey });

  return async ({ repository, permissions }) => {
    const slash = repository.indexOf('/');
    if (slash <= 0 || slash === repository.length - 1) {
      throw new Error('malformed repository');
    }
    const owner = repository.slice(0, slash);
    const repo = repository.slice(slash + 1);

    // An App JWT (signed with the private key) is the only credential that can look up
    // an installation. It is never returned to the caller.
    const appJwt = await auth({ type: 'app' });

    const lookup = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/installation`, {
      headers: {
        authorization: `Bearer ${appJwt.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': UA,
      },
    });
    if (!lookup.ok) {
      // Deliberately undifferentiated for now. Turning a 404 into the "install the App"
      // 403 of AC-4 is task 2.1, which specifies its own integration test; writing that
      // mapping here would leave the behaviour present but unverified.
      throw new Error('installation lookup failed');
    }
    const installation = (await lookup.json()) as { id?: number };
    if (typeof installation.id !== 'number') throw new Error('installation lookup returned no id');

    // `repositoryNames` takes bare repo names, not `owner/repo`. Passing the full slug
    // yields a token scoped to nothing, which would fail open into a broadly-scoped
    // token if GitHub ever defaulted an empty list to "all repositories".
    const minted = await auth({
      type: 'installation',
      installationId: installation.id,
      repositoryNames: [repo],
      permissions,
    });

    return {
      token: minted.token,
      expiresAt: minted.expiresAt,
      // Report what GitHub granted. `mint.ts` compares this against the requested
      // profile and refuses anything wider, so it must be the real grant, not an echo.
      permissions: (minted.permissions ?? {}) as Record<string, string>,
    };
  };
}
