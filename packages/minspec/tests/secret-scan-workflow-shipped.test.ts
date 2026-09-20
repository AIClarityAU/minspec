/**
 * #1186 — MinSpec must SHIP the secret-scan CI witness, not just run it.
 *
 * The defect this locks: MinSpec scaffolds a gitleaks pre-commit gate into every
 * repo it initializes, and that gate is deliberately optional (a missing binary
 * warns and the commit proceeds, because a missing optional tool must never wedge
 * a commit). The independent CI witness that compensates for that - #1620's
 * `.github/workflows/secret-scan.yml` - existed only in MinSpec's own repo and was
 * never added to the template registry. So every adopter's only secret witness was
 * a single, optional, local binary: exactly the single-producer shape constitution
 * invariant 2 forbids, and the mirror image of #1583 (there, MinSpec shipped a gate
 * it did not run; here, it ran a gate it did not ship).
 *
 * Verified before the fix: none of the three MinSpec-managed repos on this machine
 * had `.github/workflows/secret-scan.yml`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { generateHarnessFiles } from '../src/lib/scaffold';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

const OUTPUT_PATH = '.github/workflows/secret-scan.yml';
/** MinSpec's own copy - the source the embedded template is generated from. */
const REPO_COPY = path.resolve(__dirname, '../../..', OUTPUT_PATH);

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-secret-scan-')));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function scaffolded(): string {
  generateHarnessFiles(tmp);
  return fs.readFileSync(path.join(tmp, OUTPUT_PATH), 'utf-8');
}

/**
 * The workflow with comment lines removed.
 *
 * The contract assertions below are about what the job DOES, and this file's header
 * explains at length what it deliberately does not do - naming `SECRET_GATE_OFF` and
 * `continue-on-error` in prose precisely to say they are absent. Asserting over the raw
 * text therefore fails on the documentation that proves the property holds, so strip
 * comments and assert against the executable YAML only.
 */
function executableYaml(): string {
  return scaffolded()
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('secret-scan workflow is shipped to adopters (#1186)', () => {
  it('REGRESSION: a freshly scaffolded repo gets the secret-scan workflow', () => {
    generateHarnessFiles(tmp);
    expect(fs.existsSync(path.join(tmp, OUTPUT_PATH))).toBe(true);
  });

  it('is registered as a managed-region template, so refresh keeps it current', () => {
    const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === OUTPUT_PATH);
    expect(tpl, `${OUTPUT_PATH} missing from MANAGED_REGION_TEMPLATES`).toBeDefined();
    expect(tpl!.commentStyle).toBe('hash');
  });

  it('the scaffolded copy is byte-identical to MinSpec’s own', () => {
    // The embedded template is generated from the repo file by
    // scripts/gen-ci-templates.mjs. If these diverge, adopters silently receive a
    // different gate from the one this repo tests against.
    const embedded = scaffolded();
    const onDisk = fs.readFileSync(REPO_COPY, 'utf-8');
    expect(embedded.includes(onDisk.trimEnd())).toBe(true);
  });

  describe('it must stay UNLIKE the hook - the witness is the fail-closed one', () => {
    it('never honours SECRET_GATE_OFF', () => {
      // That variable is a deliberate client-side escape hatch. A server-side
      // witness that honoured it would be disabled by the same config gap it
      // exists to catch, collapsing two producers back into one.
      //
      // Assert on the mechanism, not the string: a step `name:` is free to SAY the
      // workflow ignores the variable. What must not exist is a read of it - a
      // shell expansion or a GitHub expression that could reach a conditional.
      const body = executableYaml();
      expect(body).not.toMatch(/\$\{?SECRET_GATE_OFF/);
      expect(body).not.toMatch(/env\.SECRET_GATE_OFF/);
      expect(body).not.toMatch(/^\s*SECRET_GATE_OFF\s*:/m);
    });

    it('has no continue-on-error and no swallowed exit code', () => {
      // Again the key, not the word - the header comment names `continue-on-error`
      // precisely to record that it is absent.
      const body = executableYaml();
      expect(body).not.toMatch(/^\s*continue-on-error\s*:/m);
      expect(body).not.toMatch(/gitleaks[^\n]*\|\|\s*true/);
    });

    it('asks gitleaks to fail closed explicitly', () => {
      expect(executableYaml()).toContain('--exit-code=1');
    });

    it('carries no repo-specific secret, org, or path - it must be portable', () => {
      const body = executableYaml();
      expect(body).not.toContain('AIClarityAU');
      expect(body).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
    });
  });
});
