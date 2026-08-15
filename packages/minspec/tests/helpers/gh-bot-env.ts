/**
 * Credential environment for tests that run the pipeline scripts (#1355).
 *
 * Since #1355 every script in scripts/ that writes to GitHub takes a BOT identity
 * first, via scripts/lib/gh-bot.sh. Acquiring it is lazy — sourcing costs nothing
 * and a read-only path needs no credential — but an actual write mints a token
 * and aborts loudly if it cannot.
 *
 * Tests that build a HERMETIC env (`{ PATH, HOME }` from scratch, deliberately
 * not spreading process.env, so the operator's real variables cannot leak in)
 * must therefore supply a token source, the same way they already supply a
 * stubbed `gh` on PATH. Spread GH_BOT_STUB_ENV into that env.
 *
 *     env: { PATH: ..., HOME: ..., ...GH_BOT_STUB_ENV }
 *
 * Tests that inherit process.env need nothing: vitest.setup.ts sets the same
 * variable globally.
 *
 * Omitting it does not produce a subtle wrong answer — the script aborts with
 * "gh-bot: cannot mint a bot token" on stderr. That is the intended failure, and
 * the cure is this constant, never loosening the check in gh-bot.sh.
 */
import * as path from 'path';

/** Absolute path to the stub minter. Resolved from this file, so it survives cwd changes. */
export const GH_APP_TOKEN_STUB = path.resolve(__dirname, 'gh-app-token-stub.sh');

/** Spread into any hermetic child env that runs a script capable of a GitHub write. */
export const GH_BOT_STUB_ENV: Record<string, string> = {
  MINSPEC_GH_APP_TOKEN_SCRIPT: GH_APP_TOKEN_STUB,
};
