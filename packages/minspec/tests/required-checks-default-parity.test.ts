/**
 * T0 — INVARIANT (#559): MinSpec must never require a status check the repo cannot
 * produce, and the SETTING's declared default must not smuggle one in.
 *
 * #559 was only half-fixed. The code constant `DEFAULT_REQUIRED_CHECK_CONTEXTS` was
 * corrected to `['MinSpec SDD validation']` on 2026-07-01, but the SETTING's default in
 * `package.json` was left as `["lint", "test"]` — and that is the value VS Code hands
 * back from `getConfiguration().get()` when the user has configured nothing.
 *
 * So `resolveRequiredChecks()` never saw `undefined`, the "user extras" branch always
 * fired, and `lint` + `test` were layered on VERBATIM for every adopter on every repo.
 * User extras are deliberately exempt from the producibility guard — the user owns that
 * trade-off — so the one path that bypasses the #559 protection was being taken by
 * default, by everyone.
 *
 * Measured on a real project: a repo with **no package.json at all** ended up with a
 * ruleset requiring `lint` and `test`. Nothing could ever report them, so every PR was
 * permanently blocked, and the ruleset had `bypass_actors: 0` — meaning `--admin` could
 * not help either. It took eliminating every user-settings file in the machine before
 * the manifest turned out to be the source, because a declared default is invisible
 * everywhere a user-set value would show up.
 *
 * The lesson this file encodes: a "default" that lives in two places is one place too
 * many. These tests bind them.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_REQUIRED_CHECK_CONTEXTS } from '../src/lib/ruleset-advisor';

const SETTING = 'minspec.ruleset.requiredChecks';

/** The setting's declared default, as VS Code would resolve it for an unconfigured user. */
function declaredDefault(): unknown {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
  );
  const contributed = manifest.contributes.configuration;
  const blocks = Array.isArray(contributed) ? contributed : [contributed];
  for (const block of blocks) {
    const props = block.properties ?? {};
    if (SETTING in props) return props[SETTING].default;
  }
  throw new Error(`${SETTING} is not declared in package.json`);
}

describe('#559 — the requiredChecks setting cannot smuggle in an unproducible check', () => {
  it('declares an EMPTY default', () => {
    // Anything non-empty here is required verbatim, with no producibility check, for
    // every adopter who never touched the setting.
    expect(declaredDefault()).toEqual([]);
  });

  it('never defaults to a check MinSpec does not itself produce', () => {
    // The specific regression: 'lint' and 'test' are producible only when the repo has
    // a runnable npm script, which `detectCodeChecks` decides at probe time. They must
    // not arrive via the extras path, which bypasses that decision entirely.
    const dflt = declaredDefault() as string[];
    for (const forbidden of ['lint', 'test', 'build', 'ready-to-merge', 'ai-review']) {
      expect(
        dflt,
        `'${forbidden}' in the setting default is required verbatim and bypasses the #559 producibility guard`,
      ).not.toContain(forbidden);
    }
  });

  it('leaves the code constant as the single source of the baseline', () => {
    // The baseline lives in ONE place. If the setting default is empty and the constant
    // holds the always-produced check, the two cannot disagree.
    expect(DEFAULT_REQUIRED_CHECK_CONTEXTS).toEqual(['MinSpec SDD validation']);
  });

  it('the manifest actually declares the setting (non-vacuity)', () => {
    // Guards the helper: a renamed or removed setting would otherwise make every
    // assertion above pass by throwing nothing and comparing nothing.
    expect(() => declaredDefault()).not.toThrow();
  });
});
