/**
 * #1869 — a deploy refuses unless the credential reaches the PINNED account.
 *
 * WHY THIS EXISTS ALONGSIDE `wrangler-account-pinned.test.ts`. That test asserts a pin is
 * present and matches `[0-9a-f]{32}`. It therefore accepts ANY 32 hex characters: change
 * the pinned account to a different one and it stays green, because it validates the shape
 * of the value and never which value. That is the asymmetry this project keeps meeting -
 * a check on the things that exist, with nothing asserting the right thing exists.
 *
 * The static check answers "is a target declared?". Only a deploy-time check can answer
 * "is the declared target the one this credential is for?", because only then does a
 * credential exist. These tests cover that decision, kept pure so they need no credential.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  readPinnedAccount,
  parseAccessibleAccounts,
  decideDeploy,
} from '../../../scripts/assert-deploy-account';

const MAIN = '23f1dc885a85e77e0b3969b247bbf65f';
const OTHER = 'a008107c3187559350fc81d77249e519';

/** The real shape of `wrangler whoami` output, table and all. */
const WHOAMI_ONE = `
 ⛅️ wrangler 4.131.1
Getting User settings...
👋 You are logged in with an API Token.
┌───────────────┬──────────────────────────────────┐
│ Account Name  │ Account ID                       │
├───────────────┼──────────────────────────────────┤
│ Main          │ ${MAIN} │
└───────────────┴──────────────────────────────────┘
`;

const WHOAMI_NOT_LOGGED_IN = `
 ⛅️ wrangler 4.131.1
You are not authenticated. Please run \`wrangler login\`.
`;

describe('#1869 pre-deploy account assertion', () => {
  describe('readPinnedAccount', () => {
    it('reads the pinned id', () => {
      expect(readPinnedAccount(`account_id = "${MAIN}"\nname = "x"`)).toBe(MAIN);
    });
    it('ignores a commented-out pin', () => {
      expect(readPinnedAccount(`# account_id = "${MAIN}"`)).toBeNull();
    });
    it('rejects a malformed pin rather than half-reading it', () => {
      expect(readPinnedAccount('account_id = "nope"')).toBeNull();
      expect(readPinnedAccount('account_id = ""')).toBeNull();
    });
  });

  describe('parseAccessibleAccounts', () => {
    it('finds the account in a real whoami table', () => {
      expect(parseAccessibleAccounts(WHOAMI_ONE)).toEqual([MAIN]);
    });
    it('finds nothing when not authenticated — which must not read as success', () => {
      expect(parseAccessibleAccounts(WHOAMI_NOT_LOGGED_IN)).toEqual([]);
    });
    it('de-duplicates an id repeated in the output', () => {
      expect(parseAccessibleAccounts(`${MAIN} and again ${MAIN}`)).toEqual([MAIN]);
    });
  });

  describe('decideDeploy', () => {
    it('ALLOWS when the pinned account is reachable', () => {
      // The control: without this the refusals below could pass by refusing everything.
      expect(decideDeploy(MAIN, [MAIN])).toEqual({ ok: true, account: MAIN });
    });

    it('REFUSES with no pin — the original #1869 condition', () => {
      const v = decideDeploy(null, [MAIN]);
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toMatch(/no account_id pinned/);
    });

    it('REFUSES when no account could be read, rather than assuming reachable', () => {
      // `wrangler whoami` prints "not authenticated" and exits 0, so an empty parse is
      // indistinguishable from a parse failure. Treating it as success is how a check
      // like this goes quietly inert.
      const v = decideDeploy(MAIN, []);
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toMatch(/could not read any account/);
    });

    it('REFUSES when the credential reaches a DIFFERENT account', () => {
      // The incident itself: a credential for one account, a Worker intended for another.
      const v = decideDeploy(MAIN, [OTHER]);
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toContain(MAIN);
      expect(v.ok === false && v.reason).toContain(OTHER);
    });

    it('ALLOWS when the credential reaches several accounts INCLUDING the pinned one', () => {
      // Multi-account access is not itself the fault - unpinned resolution was. A
      // credential that can see two accounts may still deploy to the pinned one.
      expect(decideDeploy(MAIN, [OTHER, MAIN])).toEqual({ ok: true, account: MAIN });
    });
  });

  it('the shipped broker config pins the intended account, not merely a well-formed one', () => {
    // Ties the pure logic to the real file. This must check the pin against MAIN — the
    // account this repo intends, known independently of the file under test — and not
    // merely against itself.
    //
    // A prior version of this test called `decideDeploy(pinned, [pinned as string])`,
    // feeding the value read from the file back in as the sole accessible account. That
    // is `ok: true` for ANY well-formed 32-hex pin, so swapping the pin for a different
    // but still-valid account (see `OTHER` above) would have stayed green — the exact
    // shape-vs-value asymmetry this file's header, and #1869, exist to close. Comparing
    // a value only to itself can never fail, no matter which value it is.
    const toml = fs.readFileSync(
      path.resolve(__dirname, '../../broker/wrangler.toml'),
      'utf-8',
    );
    const pinned = readPinnedAccount(toml);
    expect(pinned).toBe(MAIN);
    expect(decideDeploy(pinned, [MAIN]).ok).toBe(true);
  });

  it('regression: a self-referential check cannot catch a swapped pin', () => {
    // Demonstrates the flaw the test above fixes, without touching the real config: any
    // well-formed account id "passes its own assertion" when checked only against
    // itself, so that shape alone never proves it is the INTENDED account.
    expect(decideDeploy(OTHER, [OTHER])).toEqual({ ok: true, account: OTHER });
    expect(OTHER).not.toBe(MAIN);
  });
});
