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

// Pin git's auto-maintenance OFF for every git subprocess a test spawns (#1532).
//
// Same class of defect as the credential pinning above, one layer down: a test
// run whose result depends on the ambient git BUILD is not a test.
//
// 38 of this suite's fixture files build a throwaway repo with mkdtempSync and
// drive it with real `git` calls. None of them opts out of maintenance, so from
// git 2.54 every `git commit` in a fixture spawns a DETACHED `git repack -d -l -a`
// whose prune step unlinks the loose objects the NEXT foreground git command is
// still reading. The trigger is far more sensitive than the old `gc.auto` = 6700
// bar suggests: 2.54's default strategy is "geometric", whose repack task fires at
// maintenance.geometric-repack.auto = 100, and the loose-object count feeding it is
// an ESTIMATE — git samples one 256th of the object store and multiplies by 256 —
// so two objects landing in the sampled shard is enough. A ten-commit fixture
// clears that bar comfortably.
//
// It surfaces as a rare, load-shaped flake rather than a hard failure because git
// self-heals: `git add -A` recomputes any cached subtree whose object has gone
// missing, so a prune only kills the run if it lands in the narrow window between
// the last `add` and a commit that walks the tree. Hence green locally on git 2.43
// (old default, bar never reached) and green on a CI re-run, with one failure in
// between: `fatal: unable to read tree (0cf06c85…)` on PR #1500.
//
// The contrast that names this as OUR omission and not git's: actions/checkout
// already runs `git config --local gc.auto 0` on the repo it checks out, in the
// same job, on the same runner. CI's own checkout is protected; our fixtures were
// not, because nothing in this repo isolates a fixture repo from git's maintenance.
//
// GIT_CONFIG_COUNT is used rather than GIT_CONFIG_GLOBAL because it ADDS these two
// keys instead of replacing the user's global config, so nothing that legitimately
// reads ambient git config changes behaviour. Appending to any pre-existing count
// keeps this composable with a suite that sets its own keys.
{
  const existing = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10);
  const base = Number.isFinite(existing) && existing > 0 ? existing : 0;
  const pins: readonly (readonly [string, string])[] = [
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
  ];
  pins.forEach(([key, value], i) => {
    process.env[`GIT_CONFIG_KEY_${base + i}`] = key;
    process.env[`GIT_CONFIG_VALUE_${base + i}`] = value;
  });
  process.env.GIT_CONFIG_COUNT = String(base + pins.length);
}
