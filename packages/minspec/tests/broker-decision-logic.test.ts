/**
 * T0 — SPEC-034 task 0.2: the broker's decision logic, written RED before slice 1.
 *
 * These are the four rules that make the broker safe to point at other people's
 * repositories. They are pure and I/O-free on purpose: signature verification and
 * minting need a network and a key, but everything decidable from already-verified
 * claims is decidable here — so the security-critical half is testable without a
 * running Worker.
 *
 * WHY THEY ARE `it.fails`. Task 0.2 requires the tests to exist and be red; slice 1
 * turns them green. `it.fails` is this repo's idiom for "SHOULD do X — today it does
 * Y" (see git-analyzer.test.ts), and it keeps main honest in both directions: the
 * suite stays green so nobody learns to ignore a red CI, AND the moment slice 1
 * implements a rule its `it.fails` starts FAILING for passing — which forces the
 * marker to be removed rather than silently left behind. A skipped test would have
 * neither property.
 *
 * The module under test currently denies everything. That is the correct slice-0
 * state for a fail-closed service — an unimplemented broker must refuse, never
 * accidentally permit — so each assertion below is red because the ALLOW path does
 * not exist yet, not because the code is absent.
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

  it.fails('SHOULD deny with repo_claim_mismatch/403 — today it is a blanket not_implemented', () => {
    // The specificity is what slice 1 adds. A caller cannot tell a confused-deputy
    // rejection from an unbuilt broker today, and those need different reactions:
    // one is "you asked for the wrong repo", the other is "come back later".
    const d = decide(CLAIMS, { ...BODY, repository: 'AIClarityAU/some-other-repo' });
    expect(d.allow === false && d.denial).toBe('repo_claim_mismatch');
    expect(d.allow === false && d.status).toBe(403);
  });

  it.fails('SHOULD allow a matching request — today everything is denied (slice 0)', () => {
    const d = decide(CLAIMS, BODY);
    expect(d.allow).toBe(true);
  });

  it.fails('SHOULD mint for the CLAIM repository, never a body-supplied one', () => {
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

  it.fails('SHOULD reject an unexpected field rather than ignore it', () => {
    // Ignoring is the dangerous choice: it lets a caller smuggle content the broker
    // has promised never to receive (FR-6 — no code, diff, spec or prompt ever
    // reaches it), and a silently-dropped field is invisible in an audit.
    const d = decide(CLAIMS, { ...BODY, diff: 'user code here' });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial).toBe('unexpected_field');
  });

  it.fails('SHOULD reject an unsupported permissions profile', () => {
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
  it.fails('SHOULD return the configured bot login', () => {
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
