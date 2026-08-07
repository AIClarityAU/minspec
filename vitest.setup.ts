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

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A real installation token is opaque; the stub only has to be a single line so
// gh-bot.sh's "one token, no newlines" validation is genuinely exercised.
if (!process.env.MINSPEC_GH_APP_TOKEN_SCRIPT) {
  const dir = mkdtempSync(join(tmpdir(), 'minspec-gh-bot-stub-'));
  const stub = join(dir, 'gh-app-token-stub.sh');
  writeFileSync(stub, '#!/usr/bin/env bash\necho ghs_stub_installation_token\n');
  chmodSync(stub, 0o755);
  process.env.MINSPEC_GH_APP_TOKEN_SCRIPT = stub;
}

// Strip inherited credentials. With GH_TOKEN unset, gh-bot.sh takes its mint
// path and never runs the `gh api user` identity probe — which matters beyond
// hygiene: that probe would call the stubbed `gh` and add a spurious entry to
// the stub call log, breaking suites that assert on call ORDER (e.g.
// triage-verdict-record.test.ts's `calls[0] === 'view'`).
delete process.env.GH_TOKEN;
delete process.env.GITHUB_TOKEN;
