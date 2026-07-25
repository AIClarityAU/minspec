/**
 * T3 — check-supply-chain.sh scan-output retention (#915).
 *
 * check-supply-chain.sh writes a NEW timestamped NDJSON on every run
 * (`OUT_FILE="$OUT_DIR/$(date ...).ndjson"`) and, being a `bumblebee scan`
 * caller, also grows the bumblebee tool cache (scans/<date>/ per-run outputs and
 * a malicious-packages clone under sources/). NOTHING ever pruned those per-run
 * outputs, so on a persistent/local machine they accumulated without bound — the
 * cache reached ~11G and contributed to a container disk-full incident.
 *
 * Fix: after a scan completes, retain only the most-recent $SUPPLY_CHAIN_KEEP
 * (default 2) per-run outputs in the repo cache AND in the bumblebee cache's
 * scans/<date>/ dir, and `git gc --prune=now` any malicious-packages clone.
 * BUMBLEBEE_CACHE is honored so the cache can be relocated off the overlay.
 *
 * These tests stub the bumblebee binary and exercise the REAL script against
 * seeded caches, proving the growth is bounded by construction — not just
 * plausible from reading the diff. The retention pass is best-effort housekeeping
 * and must never change the gate's exit code (a finding still exits 1).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const CHECK_SCRIPT = path.resolve(__dirname, '../../../scripts/check-supply-chain.sh');

// Fake bumblebee: parse --output-file, emit records per FAKE_BB_MODE, exit 0.
// (The script itself, not the scanner, turns a finding record into exit 1.)
const FAKE_BB = `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do case "$1" in --output-file) out="$2"; shift 2;; *) shift;; esac; done
case "$FAKE_BB_MODE" in
  finding) printf '%s\\n' '{"record_type":"package","name":"x"}' '{"record_type":"finding","name":"evil"}' > "$out"; exit 0;;
  *)       printf '%s\\n' '{"record_type":"package","name":"x"}' > "$out"; exit 0;;
esac
`;

let scratch: string;
let binDir: string;
let catDir: string;
let cacheDir: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-retention-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-retention-bin-'));
  // Make scratch a git repo so `git rev-parse --show-toplevel` in the script pins
  // REPO_ROOT to scratch deterministically (no dependency on ambient git layout).
  execFileSync('git', ['init', '-q'], { cwd: scratch });
  catDir = path.join(scratch, 'catalogs');
  cacheDir = path.join(scratch, 'bb-cache');
  fs.mkdirSync(catDir, { recursive: true });
  // A catalog file must exist or check-supply-chain.sh runs inventory-only.
  fs.writeFileSync(path.join(catDir, 'cat.json'), '{"schema_version":"0.1.0"}');
  const fake = path.join(binDir, 'bumblebee');
  fs.writeFileSync(fake, FAKE_BB);
  fs.chmodSync(fake, 0o755);
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

const outDir = (): string => path.join(scratch, '.cache', 'supply-chain');

function runCheck(mode: string, extraEnv: Record<string, string> = {}): number {
  try {
    execFileSync('sh', [CHECK_SCRIPT], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BUMBLEBEE_BIN: path.join(binDir, 'bumblebee'),
        BUMBLEBEE_CATALOGS: catDir,
        BUMBLEBEE_CACHE: cacheDir,
        FAKE_BB_MODE: mode,
        ...extraEnv,
      },
      cwd: scratch,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return 0;
  } catch (e: unknown) {
    return (e as { status?: number }).status ?? -1;
  }
}

const seed = (dir: string, stamps: string[]): void => {
  fs.mkdirSync(dir, { recursive: true });
  for (const ts of stamps) fs.writeFileSync(path.join(dir, `${ts}.ndjson`), 'old\n');
};

describe('check-supply-chain.sh — scan-output retention (#915)', () => {
  it('prunes .cache/supply-chain/*.ndjson to the newest SUPPLY_CHAIN_KEEP (default 2)', () => {
    const dir = outDir();
    seed(dir, ['20200101-000001', '20200102-000002', '20200103-000003', '20200104-000004']);

    expect(runCheck('clean')).toBe(0);

    const remaining = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ndjson'))
      .sort();
    // KEEP=2 → the two lexicographically-newest survive: this run's fresh (2026…)
    // output and the newest seed (20200104). The three older seeds are pruned.
    expect(remaining.length).toBe(2);
    expect(remaining).toContain('20200104-000004.ndjson');
    for (const gone of [
      '20200101-000001.ndjson',
      '20200102-000002.ndjson',
      '20200103-000003.ndjson',
    ]) {
      expect(remaining).not.toContain(gone);
    }
    // The surviving non-seeded file is THIS run's fresh timestamped output.
    expect(remaining.filter((f) => f !== '20200104-000004.ndjson')).toHaveLength(1);
  });

  it('SUPPLY_CHAIN_KEEP=1 keeps only the single most-recent run', () => {
    const dir = outDir();
    seed(dir, ['20200101-000001', '20200102-000002']);

    expect(runCheck('clean', { SUPPLY_CHAIN_KEEP: '1' })).toBe(0);

    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe('20200101-000001.ndjson');
    expect(remaining[0]).not.toBe('20200102-000002.ndjson');
  });

  it('prunes the bumblebee cache scans/<date>/ dirs to the newest KEEP, honoring BUMBLEBEE_CACHE', () => {
    const scans = path.join(cacheDir, 'scans');
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) {
      fs.mkdirSync(path.join(scans, d), { recursive: true });
      fs.writeFileSync(path.join(scans, d, 'run.ndjson'), 'x\n');
    }

    expect(runCheck('clean')).toBe(0);

    expect(fs.readdirSync(scans).sort()).toEqual(['2020-01-02', '2020-01-03']);
  });

  it('git-gcs the malicious-packages clone without destroying it', () => {
    const clone = path.join(cacheDir, 'sources', 'malicious-packages');
    fs.mkdirSync(clone, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: clone });
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'seed'],
      { cwd: clone },
    );
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: clone,
      encoding: 'utf-8',
    }).trim();

    expect(runCheck('clean')).toBe(0);

    expect(fs.existsSync(path.join(clone, '.git'))).toBe(true);
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: clone,
      encoding: 'utf-8',
    }).trim();
    expect(headAfter).toBe(headBefore);
  });

  it('a finding still exits 1 AND still prunes — retention never masks the gate', () => {
    const dir = outDir();
    seed(dir, ['20200101-000001', '20200102-000002', '20200103-000003']);

    expect(runCheck('finding')).toBe(1);

    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'))).toHaveLength(2);
  });
});
