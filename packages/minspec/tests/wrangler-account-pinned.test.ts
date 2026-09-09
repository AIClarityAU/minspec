/**
 * #1869 — T0: every Worker config pins its deploy account.
 *
 * WHY THIS IS A GATE AND NOT A CONVENTION. `packages/broker/wrangler.toml` declared a name
 * and an entrypoint but no `account_id`. Wrangler then falls back to $CLOUDFLARE_ACCOUNT_ID
 * and, failing that, to a gitignored machine-local cache under `node_modules/.cache/wrangler`.
 * Its "more than one account available" error fires only when all three miss, so it does not
 * protect an unpinned config whose cache is warm. The Worker — and a `wrangler secret put`
 * carrying the GitHub App private key — deployed to an account nobody chose. Every command
 * reported success. It was found only because a human read a `workers.dev` URL and did not
 * recognise the subdomain.
 *
 * The absence of a field is invisible: there is no error to notice, no log line to grep, and
 * the wrong outcome looks exactly like the right one. Constitution invariant 2 says a missing
 * witness must fail closed and visibly, so the missing field has to be what fails the build.
 *
 * THE PROPERTY, NOT THE INSTANCE. Pinning the one file that bit us leaves the next Worker to
 * repeat it by omission. This asserts the rule over every config in the repo.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** A Cloudflare account id is 32 lowercase hex characters. */
const ACCOUNT_ID = /^\s*account_id\s*=\s*"([0-9a-f]{32})"\s*$/m;

function findWranglerConfigs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findWranglerConfigs(full, out);
    else if (/^wrangler\.(toml|jsonc?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('#1869 every Worker config pins account_id', () => {
  const configs = findWranglerConfigs(REPO_ROOT);

  it('finds at least one Worker config — otherwise this suite passes by finding nothing', () => {
    // Without this, deleting or renaming every wrangler.toml turns the gate below green,
    // which is indistinguishable from full compliance.
    expect(configs.length).toBeGreaterThan(0);
  });

  it('every Worker config declares a well-formed account_id', () => {
    const offenders = configs
      .filter((f) => !ACCOUNT_ID.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO_ROOT, f));

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These Worker configs do not pin a deploy account, so wrangler will resolve one ` +
            `from the ambient credential and can deploy to an account nobody chose — ` +
            `silently, with no error (#1869):\n` +
            offenders.map((o) => `  ${o}`).join('\n') +
            `\n\nFix: add \`account_id = "<32-hex account id>"\` to the config.`,
    ).toEqual([]);
  });

  it('the detector actually detects — guards against the pattern silently rotting', () => {
    expect(ACCOUNT_ID.test('name = "x"\nmain = "src/index.ts"\n')).toBe(false);
    expect(ACCOUNT_ID.test('account_id = ""\n')).toBe(false);
    expect(ACCOUNT_ID.test('account_id = "not-hex"\n')).toBe(false);
    expect(ACCOUNT_ID.test('account_id = "23F1DC885A85E77E0B3969B247BBF65F"\n')).toBe(false);
    expect(ACCOUNT_ID.test('# account_id = "23f1dc885a85e77e0b3969b247bbf65f"\n')).toBe(false);
    expect(ACCOUNT_ID.test('account_id = "23f1dc885a85e77e0b3969b247bbf65f"\n')).toBe(true);
  });
});
