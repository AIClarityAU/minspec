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

  // #850 review (Architect, blocking): the two scans have OPPOSITE version needs.
  //   • Per-PR gate (ci.yml) must be REPRODUCIBLE → pin scanner+catalogs to v0.1.2.
  //   • Daily scan (supply-chain-daily.yml) is an EARLY-WARNING system → must read the
  //     LATEST upstream catalogs, or it runs false-green on stale threat intel.
  // Pinning the shared fetch script froze the daily scan too (it inherited the default),
  // defeating its documented purpose. Fix: the per-PR references stay pinned & MUST agree
  // (a scanner/catalog skew there re-opens the #836 schema break); the daily job drives
  // BOTH its scanner install and its catalog fetch from ONE `BUMBLEBEE_VERSION: main` job
  // env, so it tracks HEAD and stays lockstep-by-construction (never skewed within itself).
  it('per-PR references stay pinned and agree (fetch script + check script + ci.yml)', () => {
    const pinned = {
      'fetch-bumblebee-catalogs.sh': scriptDefaultOf(FETCH_SCRIPT),
      'check-supply-chain.sh': scriptDefaultOf(CHECK_SCRIPT),
      'ci.yml': workflowLiteralOf(CI_WORKFLOW),
    };
    expect(pinned['ci.yml'], 'ci.yml must keep a hardcoded bumblebee@vX pin').toBeTruthy();
    const canonical = pinned['check-supply-chain.sh'];
    // A single-sided bump (scanner without catalog, or ci.yml without the scripts)
    // fails here — that skew is exactly the #836 schema break these pins prevent.
    expect(Object.values(pinned).every((v) => v === canonical), JSON.stringify(pinned)).toBe(true);
  });

  it('daily scan tracks HEAD via a single lockstep ref (no frozen catalogs, no self-skew)', () => {
    const daily = fs.readFileSync(DAILY_WORKFLOW, 'utf-8');
    // It must NOT carry a hardcoded scanner pin — that is what froze it (the regression).
    expect(
      workflowLiteralOf(DAILY_WORKFLOW),
      'daily scan must not hardcode bumblebee@vX — it would freeze the early-warning catalogs',
    ).toBeNull();
    // Scanner install + catalog fetch derive from ONE job-level ref → lockstep.
    expect(daily, 'daily job must set a single BUMBLEBEE_VERSION ref').toMatch(
      /^\s*BUMBLEBEE_VERSION:\s*\S+/m,
    );
    expect(daily, 'daily scanner install must read that ref, not a literal').toMatch(
      /bumblebee@\$\{BUMBLEBEE_VERSION\}/,
    );
  });
});
