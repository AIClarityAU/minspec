/**
 * T0 — SPEC-034 task 0.2: the broker's decision logic, written RED before slice 1.
 *
 * These are the four rules that make the broker safe to point at other people's
 * repositories. They are pure and I/O-free on purpose: signature verification and
 * minting need a network and a key, but everything decidable from already-verified
 * claims is decidable here — so the security-critical half is testable without a
 * running Worker.
 *
 * HISTORY. These were written in slice 0 as `it.fails` — red on purpose, per task 0.2,
 * while the decision module denied everything. Slice 1 implemented the rules and every
 * marker began FAILING FOR PASSING, which is precisely why `it.fails` was chosen over
 * `skip`: it forced its own removal instead of lingering as a stale marker over
 * behaviour that had quietly started working. The markers are gone; the assertions are
 * unchanged.
 *
 * The module remains pure and I/O-free: signature verification and minting stay at the
 * edges, so these rules are exercised without a network, a key, or a running Worker.
 */
import { describe, it, expect } from 'vitest';
import {
  decide,
  resolveReviewerIdentity,
  ALLOWED_BODY_FIELDS,
  type VerifiedClaims,
} from '../../broker/src/decide';

const CLAIMS: VerifiedClaims = {
  repository: 'AIClarityAU/voip-sms-inbox',
  repository_owner: 'AIClarityAU',
};

const BODY = { repository: CLAIMS.repository, permissions_profile: 'review' as const };

describe('AC-2 — confused deputy: the claim authorises, never the body', () => {
  it('DENIES a mismatched repo — the safety property, true from slice 0 onward', () => {
    // The attack this exists to stop: a workflow legitimately running in repo A asks
    // for a token on repo B. Its OIDC token is genuine, so signature verification
    // alone would pass it. Only the claim/body cross-check catches it.
    //
    // Deliberately NOT `it.fails`. Slice 0 already denies (it denies everything), and
    // that is the property that must never regress — including while slice 1 is being
    // written. Splitting it from the code/status assertion below means the guard is
    // live today rather than parked behind a marker someone has to remember to remove.
    const d = decide(CLAIMS, { ...BODY, repository: 'AIClarityAU/some-other-repo' });
    expect(d.allow).toBe(false);
  });

  it('denies a mismatched repo with repo_claim_mismatch/403', () => {
    // The specificity is what slice 1 adds. A caller cannot tell a confused-deputy
    // rejection from an unbuilt broker today, and those need different reactions:
    // one is "you asked for the wrong repo", the other is "come back later".
    const d = decide(CLAIMS, { ...BODY, repository: 'AIClarityAU/some-other-repo' });
    expect(d.allow === false && d.denial).toBe('repo_claim_mismatch');
    expect(d.allow === false && d.status).toBe(403);
  });

  it('allows a request whose body repo matches the claim', () => {
    const d = decide(CLAIMS, BODY);
    expect(d.allow).toBe(true);
  });

  it('mints for the CLAIM repository, never a body-supplied one', () => {
    // Even on the happy path the minted repo must come from the claim, so a body that
    // agrees today cannot become the source of truth tomorrow.
    const d = decide(CLAIMS, BODY);
    expect(d.allow === true && d.repository).toBe(CLAIMS.repository);
  });
});

describe('AC-6 — request shape: only the two fields, nothing forwarded', () => {
  it('the allowed field set is exactly the normative contract', () => {
    // The JWT rides Authorization, not the body (design `## API`, marked normative
    // 2026-08-17) — so a bearer credential can never land in a request log.
    expect([...ALLOWED_BODY_FIELDS].sort()).toEqual(['permissions_profile', 'repository']);
    expect(ALLOWED_BODY_FIELDS).not.toContain('jwt');
  });

  it('rejects an unexpected field rather than ignoring it', () => {
    // Ignoring is the dangerous choice: it lets a caller smuggle content the broker
    // has promised never to receive (FR-6 — no code, diff, spec or prompt ever
    // reaches it), and a silently-dropped field is invisible in an audit.
    const d = decide(CLAIMS, { ...BODY, diff: 'user code here' });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial).toBe('unexpected_field');
  });

  it('rejects an unsupported permissions profile', () => {
    const d = decide(CLAIMS, { ...BODY, permissions_profile: 'admin' });
    expect(d.allow === false && d.denial).toBe('unsupported_profile');
  });
});

describe('AC-9 — fail closed: any error yields no token', () => {
  it.each([
    ['null body', null],
    ['a string body', 'repository=o/r'],
    ['an array body', []],
    ['an empty object', {}],
  ])('DENIES on %s — never a token', (_label, body) => {
    // Malformed input must deny, not throw: an exception escaping the decision layer
    // becomes a 500, and a 500 is a shape callers retry. Deny is terminal and honest.
    const d = decide(CLAIMS, body);
    expect(d.allow).toBe(false);
  });

  it('never returns allow with a missing repository', () => {
    // The invariant that outlives every rule above: whatever is decided, an allow
    // must always name the repo the token will be scoped to.
    const d = decide(CLAIMS, BODY);
    if (d.allow) expect(d.repository).toBeTruthy();
  });
});

describe('AC-10 — reviewer identity comes from config, never hardcoded', () => {
  it('returns the configured bot login', () => {
    // An enterprise on its own App must post as its own bot without patching MinSpec.
    expect(resolveReviewerIdentity({ botLogins: 'acme-review[bot]' })).toBe('acme-review[bot]');
  });

  it('never hardcodes minspec-sdd[bot] into the decision layer', () => {
    // The product default belongs in the scaffolded workflow (DR-054), not compiled
    // into the broker: baked in here, an enterprise override could not take effect.
    expect(resolveReviewerIdentity({ botLogins: 'acme-review[bot]' })).not.toBe('minspec-sdd[bot]');
    expect(resolveReviewerIdentity({})).not.toBe('minspec-sdd[bot]');
  });
});

describe('slice 1 — hardening the rules the T0 tests named', () => {
  it('refuses a body carrying the JWT, even alongside valid fields', () => {
    // The shape the superseded mermaid implied. Accepting it would put a bearer
    // credential in a request body, where any proxy or access log can capture it —
    // the reason the normative API block moved it to Authorization.
    const d = decide(CLAIMS, { ...BODY, jwt: 'eyJhbGciOi...' });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial).toBe('unexpected_field');
  });

  it('checks body SHAPE before comparing repos', () => {
    // Order matters: a hostile type must be refused before it reaches the comparison,
    // so no field is ever read off an object whose shape was never established.
    const d = decide(CLAIMS, { repository: { toString: () => CLAIMS.repository } });
    expect(d.allow).toBe(false);
  });

  it('treats an EMPTY claim repository as unauthorised, never a wildcard', () => {
    // An absent claim must authorise nothing. The dangerous reading is "no constraint",
    // which would mint for whatever the body asked for.
    const d = decide({ repository: '', repository_owner: '' }, BODY);
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial).toBe('oidc_invalid');
  });

  it('is case-sensitive on the repo comparison', () => {
    // GitHub treats owner/repo case-insensitively for routing but the claim is the
    // authority here; loosening the match invites a near-miss to authorise.
    const d = decide(CLAIMS, { ...BODY, repository: CLAIMS.repository.toUpperCase() });
    expect(d.allow).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    // A thrown error becomes a 500, and a 500 is a shape callers retry. Denial is
    // terminal and honest.
    const hostile: unknown[] = [undefined, null, 0, '', [], Symbol('x'), () => {}, new Date()];
    for (const body of hostile) {
      expect(() => decide(CLAIMS, body)).not.toThrow();
      expect(decide(CLAIMS, body).allow).toBe(false);
    }
  });

  it('resolveReviewerIdentity takes the first of a comma/space list', () => {
    expect(resolveReviewerIdentity({ botLogins: 'acme[bot], other[bot]' })).toBe('acme[bot]');
    expect(resolveReviewerIdentity({ botLogins: '  spaced[bot]  ' })).toBe('spaced[bot]');
    expect(resolveReviewerIdentity({ botLogins: '' })).toBeNull();
  });
});
