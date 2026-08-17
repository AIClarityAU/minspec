/**
 * SPEC-034 task 0.1 — the broker route exists, answers, and mints nothing.
 *
 * The verification the task names is "`wrangler dev` answers 501". That needs a running
 * Worker and a network listener, so it is exercised here against the exported `fetch`
 * handler instead: same code path, no daemon, and it runs in CI where `wrangler dev`
 * cannot.
 *
 * What matters at Slice 0 is not that the route works — it is that it **cannot succeed**.
 * A broker whose verification path is unbuilt must refuse every request, so that a
 * half-finished deploy can never issue a credential. These tests pin that property now,
 * while it is trivially true, because it is the property Slice 1 is most likely to
 * weaken: the moment minting is added, "returns 501" becomes "returns a token", and the
 * only thing standing between those two states is whether the OIDC verification in
 * between is complete.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import worker, { TOKEN_PATH, type TokenError } from '../../broker/src/index';

const BASE = 'https://broker.example.invalid';

async function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init));
}

describe('SPEC-034 slice 0 — broker scaffold', () => {
  it('answers 501 on the token route', async () => {
    const res = await call(TOKEN_PATH, { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('never returns a token, whatever is posted at it', async () => {
    // The load-bearing assertion of this slice. Anything resembling a credential in the
    // response would mean the unbuilt path can already succeed.
    const res = await call(TOKEN_PATH, {
      method: 'POST',
      body: JSON.stringify({ repository: 'o/r', permissions_profile: 'review' }),
    });
    const body = (await res.json()) as TokenError & { token?: string };
    expect(res.status).toBe(501);
    expect(body.token).toBeUndefined();
    expect(body.error).toBe('not_implemented');
  });

  it('refuses a non-POST before any request handling', async () => {
    const res = await call(TOKEN_PATH, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('404s an unknown route rather than falling through to the token path', async () => {
    const res = await call('/', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('is not reachable from extension source — vendor infra, never shipped', () => {
    // The boundary currently holds by accident: the vsix bundles only
    // `packages/minspec`, so a sibling package cannot be pulled in. Assert it anyway,
    // because "cannot happen by construction" is exactly the claim that stops being
    // true after one convenient import — and the thing on the other side of this
    // boundary is the code that handles an App private key.
    const src = path.join(__dirname, '..', 'src');
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          scanned += 1;
          const text = fs.readFileSync(full, 'utf-8');
          if (/@aiclarity\/broker|packages\/broker|\.\.\/\.\.\/broker/.test(text)) {
            offenders.push(path.relative(src, full));
          }
        }
      }
    };
    walk(src);
    // Non-vacuity: a walk that read nothing would report "no offenders" and mean it.
    expect(scanned, 'scanned no extension source files').toBeGreaterThan(50);
    expect(
      offenders,
      `extension source imports the broker:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('marks every response no-store', async () => {
    // A minted token is a ~10-minute bearer credential; nothing may cache it at any
    // layer. Asserted from the first commit so the header cannot be forgotten later,
    // when responses actually carry one.
    const res = await call(TOKEN_PATH, { method: 'POST' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
