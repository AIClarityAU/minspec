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

  // #848 review (Architect, blocking): the bumblebee version is declared in FOUR
  // places — the two scripts' `${BUMBLEBEE_VERSION:-vX}` defaults (catalog fetch +
  // scanner install) AND the two CI workflows' `go install ...bumblebee@vX` literals
  // (ci.yml, supply-chain-daily.yml). Neither workflow exports BUMBLEBEE_VERSION, so
  // CI reads each literal independently exactly like a local run — bumping any ONE
  // alone reintroduces the #836 schema skew (e.g. new scanner binary vs old catalog
  // ref) that #848 exists to close. The workflow literal is in fact the largest drift
  // vector, and a prose "keep these in sync" comment cannot enforce it. This gate asserts
  // all four agree, so any single-sided bump fails CI and cannot merge.
  it('all four bumblebee version references agree (scripts + CI workflows — no drift)', () => {
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
    // Workflow install literals: `go install ...bumblebee@v0.1.2`
    const workflowPinOf = (file: string): string => {
      const m = fs.readFileSync(file, 'utf-8').match(/bumblebee@(v[^\s'"]+)/);
      expect(m, `no bumblebee@<version> install pin found in ${path.basename(file)}`).toBeTruthy();
      return m![1];
    };

    const refs = {
      'fetch-bumblebee-catalogs.sh': scriptDefaultOf(FETCH_SCRIPT),
      'check-supply-chain.sh': scriptDefaultOf(CHECK_SCRIPT),
      'ci.yml': workflowPinOf(CI_WORKFLOW),
      'supply-chain-daily.yml': workflowPinOf(DAILY_WORKFLOW),
    };

    // Every reference must equal the canonical script default — a single-sided bump
    // (scanner without catalog, or workflow without script) fails here.
    const canonical = refs['check-supply-chain.sh'];
    expect(Object.values(refs).every((v) => v === canonical), JSON.stringify(refs)).toBe(true);
  });
});
