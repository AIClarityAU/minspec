/**
 * T3 — fetch-bumblebee-catalogs.sh version-skew regression (#848).
 *
 * check-supply-chain.sh pins the bumblebee scanner binary to BUMBLEBEE_VERSION
 * (default v0.1.2). fetch-bumblebee-catalogs.sh fetched the exposure catalogs
 * from the upstream repo's default-branch HEAD with no version pin at all, so
 * the catalog schema could (and did) advance past what the pinned reader
 * supports — the scan then failed closed with "unsupported exposure catalog
 * schema_version" on every CI run, blocking `package` entirely.
 *
 * Fix: the catalog fetch is now pinned to `ref=$BUMBLEBEE_VERSION` (the same
 * variable, same default) — bumping the scanner and the catalog ref is one
 * change, not two independent ones that can drift apart. This test stubs `gh`
 * on PATH and asserts every threat_intel API call the shipped script makes
 * carries that ref — proving the version skew is no longer possible by
 * construction, not just plausible from reading the diff.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const FETCH_SCRIPT = path.resolve(__dirname, '../../../scripts/fetch-bumblebee-catalogs.sh');

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_GH_CALLS_LOG"
case "$1 $2" in
  "api repos/perplexityai/bumblebee/contents/threat_intel?ref=$BUMBLEBEE_VERSION")
    if [[ "$3" == "--jq" ]]; then
      echo "fake-catalog.json"
    fi
    ;;
  "api repos/perplexityai/bumblebee/contents/threat_intel/fake-catalog.json?ref=$BUMBLEBEE_VERSION")
    if [[ "$3" == "--jq" ]]; then
      base64 <<< '{"schema_version":"0.1.0"}'
    fi
    ;;
  *)
    echo "fake-gh: unhandled invocation: $*" >&2
    exit 1
    ;;
esac
`;

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

let scratch: string;
let binDir: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-bumblebee-scratch-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-bumblebee-bin-'));
  writeExecutable(path.join(binDir, 'gh'), FAKE_GH);
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

function runFetch(bumblebeeVersion: string): { calls: string[]; target: string } {
  const target = path.join(scratch, 'catalogs');
  const callsLog = path.join(scratch, 'gh-calls.log');
  fs.writeFileSync(callsLog, '');

  execFileSync('bash', [FETCH_SCRIPT, target], {
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      BUMBLEBEE_VERSION: bumblebeeVersion,
      FAKE_GH_CALLS_LOG: callsLog,
    },
    encoding: 'utf-8',
  });

  const calls = fs
    .readFileSync(callsLog, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return { calls, target };
}

describe('fetch-bumblebee-catalogs.sh — pins catalog fetch to BUMBLEBEE_VERSION (#848)', () => {
  it('every threat_intel API call carries ref=$BUMBLEBEE_VERSION', () => {
    const { calls } = runFetch('v0.1.2');
    const threatIntelCalls = calls.filter((c) => c.includes('contents/threat_intel'));
    expect(threatIntelCalls.length).toBeGreaterThan(0);
    for (const call of threatIntelCalls) {
      expect(call).toContain('ref=v0.1.2');
    }
  });

  it('changing BUMBLEBEE_VERSION changes the pinned ref (no hardcoded default)', () => {
    const { calls } = runFetch('v9.9.9-different');
    const threatIntelCalls = calls.filter((c) => c.includes('contents/threat_intel'));
    expect(threatIntelCalls.length).toBeGreaterThan(0);
    for (const call of threatIntelCalls) {
      expect(call).toContain('ref=v9.9.9-different');
      expect(call).not.toContain('ref=v0.1.2');
    }
  });

  it('fetched catalog lands in the target dir', () => {
    const { target } = runFetch('v0.1.2');
    expect(fs.existsSync(path.join(target, 'fake-catalog.json'))).toBe(true);
  });

  const REPO_ROOT = path.resolve(__dirname, '../../..');
  const CHECK_SCRIPT = path.resolve(__dirname, '../../../scripts/check-supply-chain.sh');
  const CI_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/ci.yml');
  const DAILY_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/supply-chain-daily.yml');

  // Script defaults: `BUMBLEBEE_VERSION="${BUMBLEBEE_VERSION:-v0.1.2}"`
  const scriptDefaultOf = (file: string): string => {
    const m = fs
      .readFileSync(file, 'utf-8')
      .match(/BUMBLEBEE_VERSION="\$\{BUMBLEBEE_VERSION:-([^}"]+)\}"/);
    expect(m, `no BUMBLEBEE_VERSION default found in ${path.basename(file)}`).toBeTruthy();
    return m![1];
  };
  // Hardcoded workflow install literal: `go install ...bumblebee@v0.1.2` (ci.yml only).
  const workflowLiteralOf = (file: string): string | null => {
    const m = fs.readFileSync(file, 'utf-8').match(/bumblebee@(v[^\s'"$]+)/);
    return m ? m[1] : null;
  };

  // yaml env value: `KEY: value   # comment` → 'value'
  const ymlEnvOf = (file: string, key: string): string | null => {
    const m = fs.readFileSync(file, 'utf-8').match(new RegExp(`^\\s*${key}:\\s*(\\S+)`, 'm'));
    return m ? m[1] : null;
  };

  // #850 review (Security blocking + Architect): the two scans have different needs,
  // resolved by decoupling the EXECUTED binary from the fetched catalog DATA.
  //   • The scanner BINARY is pinned EVERYWHERE — ci.yml, both scripts, and the daily
  //     job — so no scan ever `go install`s a floating `bumblebee@main`; a compromised
  //     upstream cannot execute code in a job holding GITHUB_TOKEN + `issues: write` (#850).
  //   • Only the daily scan's CATALOG ref floats (BUMBLEBEE_CATALOG_REF=main) for
  //     early-warning freshness; catalog data is read, not executed, so the blast radius
  //     is bounded to false results, and a schema advance past the pinned reader fails
  //     closed and is surfaced as a bump signal (#869), never executed.
  it('the executed bumblebee binary is pinned everywhere — ci.yml, scripts, AND daily (never floated)', () => {
    const binary = {
      'fetch-bumblebee-catalogs.sh': scriptDefaultOf(FETCH_SCRIPT),
      'check-supply-chain.sh': scriptDefaultOf(CHECK_SCRIPT),
      'ci.yml': workflowLiteralOf(CI_WORKFLOW),
      'supply-chain-daily.yml': ymlEnvOf(DAILY_WORKFLOW, 'BUMBLEBEE_VERSION'),
    };
    // Every executed-binary reference must be a pinned release tag (vX...), never a branch.
    for (const [where, ref] of Object.entries(binary)) {
      expect(ref, `no pinned bumblebee binary ref in ${where}`).toBeTruthy();
      expect(
        /^v\d/.test(ref!),
        `${where} binary ref '${ref}' must be a pinned vX tag, not a floating ref`,
      ).toBe(true);
    }
    // ...and they must all agree — a single-sided bump re-opens the #836 schema break.
    const canonical = binary['check-supply-chain.sh'];
    expect(Object.values(binary).every((v) => v === canonical), JSON.stringify(binary)).toBe(true);
  });

  it('the daily scan floats ONLY the catalog data ref, never the executed binary (#850 security)', () => {
    const daily = fs.readFileSync(DAILY_WORKFLOW, 'utf-8');
    // Binary install reads the PINNED BUMBLEBEE_VERSION env, not a hardcoded/floating ref.
    expect(daily, 'daily binary install must use ${BUMBLEBEE_VERSION} (pinned)').toMatch(
      /bumblebee@\$\{BUMBLEBEE_VERSION\}/,
    );
    // Catalog ref floats independently — set on the daily job, and NOT a pinned tag.
    const catalogRef = ymlEnvOf(DAILY_WORKFLOW, 'BUMBLEBEE_CATALOG_REF');
    expect(catalogRef, 'daily must set BUMBLEBEE_CATALOG_REF to float catalogs').toBeTruthy();
    expect(
      /^v\d/.test(catalogRef!),
      `daily catalog ref '${catalogRef}' should track HEAD (a branch), not a pinned tag`,
    ).toBe(false);
    // The fetch script derives the catalog `ref=` from BUMBLEBEE_CATALOG_REF (data),
    // defaulting to BUMBLEBEE_VERSION (binary) — the decoupling that lets catalogs float
    // safely while the executed binary stays pinned.
    const fetch = fs.readFileSync(FETCH_SCRIPT, 'utf-8');
    expect(fetch, 'fetch script must default BUMBLEBEE_CATALOG_REF to BUMBLEBEE_VERSION').toMatch(
      /BUMBLEBEE_CATALOG_REF="\$\{BUMBLEBEE_CATALOG_REF:-\$BUMBLEBEE_VERSION\}"/,
    );
    expect(fetch, 'catalog fetch must use ref=${BUMBLEBEE_CATALOG_REF}').toMatch(
      /ref=\$\{BUMBLEBEE_CATALOG_REF\}/,
    );
    expect(fetch, 'catalog fetch must NOT ref off BUMBLEBEE_VERSION directly (that would re-couple)').not.toMatch(
      /ref=\$\{BUMBLEBEE_VERSION\}/,
    );
  });
});
