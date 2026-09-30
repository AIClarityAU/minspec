#!/usr/bin/env -S npx tsx
/**
 * Refuse to deploy a Worker unless the credential actually reaches the PINNED account.
 *
 * WHY A SECOND CHECK. #1869: `wrangler.toml` carried no `account_id`, so wrangler resolved
 * the account from whatever credential was present, and a credential that can see more
 * than one account picked silently. The Worker - and a `wrangler secret put` carrying the
 * GitHub App private key - landed in an account nobody chose. Every command reported
 * success.
 *
 * That was fixed by pinning `account_id`, and `wrangler-account-pinned.test.ts` keeps a
 * pin present. But that test asserts the pin matches `[0-9a-f]{32}` - ANY 32 hex
 * characters. Change the pinned value to a different account and it still passes: it
 * validates the shape of the value, never which value. That is the same asymmetry the
 * project has hit before (a validator that checks the references that exist, and never
 * that one should exist).
 *
 * So the static check answers "is a target declared?" and this answers the question it
 * cannot: "is the declared target the one this credential is actually for?" Only the
 * second can be asked at deploy time, because only then does a credential exist.
 *
 * FAILS CLOSED. No pin, no credential, an unreadable account list, or a pinned account the
 * credential cannot see - each refuses. A deploy that cannot prove its destination does
 * not happen.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** `account_id = "<32 hex>"` at line start, ignoring commented-out copies. */
const PINNED = /^\s*account_id\s*=\s*"([0-9a-f]{32})"\s*$/m;

/** Cloudflare account ids as they appear in `wrangler whoami` output. */
const ACCOUNT_IDS = /\b([0-9a-f]{32})\b/g;

export type Verdict =
  | { ok: true; account: string }
  | { ok: false; reason: string };

/** The pinned target, or null when the config declares none. */
export function readPinnedAccount(tomlText: string): string | null {
  const m = PINNED.exec(tomlText);
  return m ? m[1] : null;
}

/** Every account id the credential can see, per `wrangler whoami`. */
export function parseAccessibleAccounts(whoamiOutput: string): string[] {
  return [...new Set(Array.from(whoamiOutput.matchAll(ACCOUNT_IDS), (m) => m[1]))];
}

/**
 * The whole decision, pure and I/O-free so it is testable without a credential.
 *
 * Note what is NOT treated as success: an empty account list. `wrangler whoami` prints a
 * "not authenticated" message and exits 0, so "no ids found" is indistinguishable from
 * "parsed nothing" and must refuse. An empty-scan pass is how this class of check goes
 * quietly inert.
 */
export function decideDeploy(pinned: string | null, accessible: string[]): Verdict {
  if (!pinned) {
    return {
      ok: false,
      reason:
        'no account_id pinned in wrangler.toml — the deploy target would be resolved from ' +
        'the ambient credential, which is how #1869 sent the App private key to an ' +
        'unintended account',
    };
  }
  if (accessible.length === 0) {
    return {
      ok: false,
      reason:
        'could not read any account from `wrangler whoami` — either no credential is ' +
        'present or the output could not be parsed. Refusing rather than assuming the ' +
        'pinned account is reachable',
    };
  }
  if (!accessible.includes(pinned)) {
    return {
      ok: false,
      reason:
        `the pinned account ${pinned} is NOT among the accounts this credential can ` +
        `reach (${accessible.join(', ')}). Either the wrong credential is active or the ` +
        `pin names an account you do not control`,
    };
  }
  return { ok: true, account: pinned };
}

function main(): void {
  const dir = process.argv[2] ?? process.cwd();
  const tomlPath = path.join(dir, 'wrangler.toml');
  if (!fs.existsSync(tomlPath)) {
    console.error(`assert-deploy-account: no wrangler.toml at ${tomlPath} — refusing.`);
    process.exit(1);
  }

  let whoami = '';
  try {
    whoami = execFileSync('npx', ['wrangler', 'whoami'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (err) {
    // A non-zero exit still often carries the account table on stdout; use what we got
    // and let decideDeploy refuse if it is unusable.
    const e = err as { stdout?: string };
    whoami = typeof e.stdout === 'string' ? e.stdout : '';
  }

  const verdict = decideDeploy(
    readPinnedAccount(fs.readFileSync(tomlPath, 'utf-8')),
    parseAccessibleAccounts(whoami),
  );

  if (!verdict.ok) {
    console.error(`assert-deploy-account: REFUSING to deploy — ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`assert-deploy-account: OK — deploying to the pinned account ${verdict.account}.`);
}

// Only run when invoked directly, so the pure exports above stay importable in tests.
if (process.argv[1] && /assert-deploy-account\.ts$/.test(process.argv[1])) main();
