// Test-environment credential hygiene (#1355).
//
// WHY THIS EXISTS
// Several suites run the real pipeline scripts (triage-inbox.sh, push-docs.sh,
// drain-inbox.sh) end-to-end against a stubbed `gh` on PATH. Those scripts now
// take a BOT identity before any GitHub write, via scripts/lib/gh-bot.sh.
//
// Without this file, what a suite does depends on what happens to be in the
// developer's environment:
//
//   * a machine WITH the App key mints a real token and passes;
//   * CI, which has neither the key nor the token script, aborts.
//
// That divergence is not hypothetical — it is exactly how this change first
// looked green locally while failing 30+ tests under CI conditions. A test run
// whose result depends on ambient credentials is not a test.
//
// So: pin the credential state. Point the minter at a stub that returns a fake
// token, and strip inherited tokens so every run — laptop or CI — takes the
// identical code path.
//
// This is deliberately NOT a bypass flag. The production path in gh-bot.sh runs
// unmodified; only the source of the token is stubbed, exactly as `gh` itself is
// stubbed. There is no branch in the shipped code that knows it is under test.

// The stub minter is COMMITTED, not generated here, so hermetic tests can point
// at the same file. See packages/minspec/tests/helpers/gh-bot-env.ts — a test that
// builds its env from scratch cannot see anything this file sets, and must spread
// GH_BOT_STUB_ENV instead. Two entry points, one stub.
import { fileURLToPath } from 'node:url';

if (!process.env.MINSPEC_GH_APP_TOKEN_SCRIPT) {
  process.env.MINSPEC_GH_APP_TOKEN_SCRIPT = fileURLToPath(
    new URL('./packages/minspec/tests/helpers/gh-app-token-stub.sh', import.meta.url),
  );
}

// Strip inherited credentials. With GH_TOKEN unset, gh-bot.sh takes its mint
// path and never runs the `gh api user` identity probe — which matters beyond
// hygiene: that probe would call the stubbed `gh` and add a spurious entry to
// the stub call log, breaking suites that assert on call ORDER (e.g.
// triage-verdict-record.test.ts's `calls[0] === 'view'`).
delete process.env.GH_TOKEN;
delete process.env.GITHUB_TOKEN;
