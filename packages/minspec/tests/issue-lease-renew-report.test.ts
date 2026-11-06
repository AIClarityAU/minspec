/**
 * #2299 — the drain lease renew ticker's two reporting gaps, filed as a follow-up
 * while fixing #2298 mechanism B (lease_renew never renews):
 *
 *   1. lease_stop_renew_ticker's teardown used to leak a bare bash job-status
 *      "Terminated" line onto the drain log at EVERY dispatch, right after the
 *      dispatch's last output line — reading as "the dispatch was killed" when it
 *      is routine per-dispatch teardown.
 *   2. A real renewal failure reported only `FAILED (exit N)` — lease_renew's own
 *      internal gh/jq calls discarded their stderr, so a reader could not tell a
 *      claims-read failure from a missing claim from a refused PATCH from a
 *      gh_bot_die (no mintable bot token) without reproducing it by hand.
 *      lease_renew now prints a `lease: cannot renew the claim on #N: <reason>` line
 *      ahead of the ticker's `FAILED (exit N)` report. The reason line does not say
 *      FAILED, so the ticker's report stays the one FAILED line per failed tick.
 *
 * Every scenario here runs the REAL scripts/lib/issue-lease.sh in a bash
 * subprocess (spawnSync, so stdout and stderr are captured separately — a plain
 * execFileSync only returns stdout). Network-touching internals (lease_read_claims,
 * gh, gh_bot_init) are stubbed per-test by redefining the shell function AFTER
 * sourcing the real file, the same pattern shepherd-decide.test.ts's existing
 * renew-ticker smoke test already uses.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';

const LEASE = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const REPO_ROOT = path.resolve(__dirname, '../../..');

function run(script: string) {
  return spawnSync('bash', ['-c', script], { encoding: 'utf-8', cwd: REPO_ROOT, timeout: 15_000 });
}

describe('lease renew ticker teardown: no bare "Terminated" (#2299 gap 1)', () => {
  it('stopping a live ticker leaves no bash job-status line on stderr', () => {
    const script = `
      set -uo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      source ${JSON.stringify(LEASE)}
      LEASE_RENEW_SECS=1
      lease_renew() { :; }     # stub: no network, always "succeeds"
      lease_start_renew_ticker 999
      sleep 0.3
      lease_stop_renew_ticker
      sleep 0.3
      echo DONE
    `;
    const res = run(script);
    expect(res.stdout.trim().split('\n').pop()).toBe('DONE');
    expect(res.stderr).not.toMatch(/Terminated/);
  });

  it('a real renewal failure still reaches stderr, with no bare Terminated riding along', () => {
    const script = `
      set -uo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      source ${JSON.stringify(LEASE)}
      LEASE_RENEW_SECS=1
      lease_renew() { echo "lease: cannot renew the claim on #$1: test reason." >&2; return 1; }
      lease_start_renew_ticker 42
      sleep 1.3
      lease_stop_renew_ticker
      echo DONE
    `;
    const res = run(script);
    expect(res.stdout.trim().split('\n').pop()).toBe('DONE');
    expect(res.stderr).toMatch(/cannot renew the claim on #42: test reason\./);
    // The ticker's own report rides along, after the reason: it was written to the
    // saved stderr too, not to the fd 2 this fix silences.
    expect(res.stderr).toMatch(/test reason\.\nlease: renewal of the claim on #42 FAILED \(exit 1\)/);
    expect(res.stderr).not.toMatch(/Terminated/);
  });

  it('a gh_bot_die-style exit (exit, not return) inside one tick does not end the ticker', () => {
    // gh_bot_die is `exit 1`, not `return 1`. Un-subshelled, that would kill the
    // whole ticker loop on the first un-mintable bot token, silencing every later
    // renewal for the rest of the build.
    const script = `
      set -uo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      source ${JSON.stringify(LEASE)}
      LEASE_RENEW_SECS=1
      COUNT_FILE=$(mktemp)
      echo 0 > "$COUNT_FILE"
      lease_renew() {
        n=$(<"$COUNT_FILE"); n=$((n+1)); echo "$n" > "$COUNT_FILE"
        echo "gh-bot: simulated gh_bot_die." >&2
        exit 1
      }
      lease_start_renew_ticker 7
      sleep 2.3
      lease_stop_renew_ticker
      cat "$COUNT_FILE"
      rm -f "$COUNT_FILE"
    `;
    const res = run(script);
    const lines = res.stdout.trim().split('\n');
    const n = parseInt(lines[lines.length - 1] || '0', 10);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(res.stderr).not.toMatch(/Terminated/);
    expect(res.stderr).toMatch(/simulated gh_bot_die/);
  });

  it('a genuine sleep error (not our own teardown signal) is still visible, not swallowed by the redirect', () => {
    // The issue's named cost for silencing the ticker's own fd 2: a rejected sleep
    // interval must still surface, or the fix trades one silent failure for another.
    const script = `
      set -uo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      source ${JSON.stringify(LEASE)}
      LEASE_RENEW_SECS=not-a-number
      lease_renew() { :; }
      lease_start_renew_ticker 7
      sleep 0.5
      lease_stop_renew_ticker
      echo DONE
    `;
    const res = run(script);
    expect(res.stdout.trim().split('\n').pop()).toBe('DONE');
    expect(res.stderr).toMatch(/sleep:/);
  });
});

describe('lease_renew: failure reason on stderr, not just an exit code (#2299 gap 2)', () => {
  function renewWith(setup: string) {
    const script = `
      set -uo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      export MINSPEC_LEASE_SID=sid-test
      source ${JSON.stringify(LEASE)}
      gh_bot_init() { :; }   # stub: this unit covers lease_renew's own logic, not bot-token minting
      ${setup}
      lease_renew 55
      echo "rc=$?"
    `;
    return run(script);
  }

  it('reports "could not read claims" when the claims read itself fails', () => {
    const res = renewWith(`lease_read_claims() { return 1; }`);
    expect(res.stderr).toMatch(/could not read claims/);
    expect(res.stderr).not.toMatch(/FAILED/);
    expect(res.stdout).toMatch(/rc=1/);
  });

  it('reports "no claim ... was found" when the read succeeds but carries none of ours', () => {
    const res = renewWith(`lease_read_claims() { echo '[]'; }`);
    expect(res.stderr).toMatch(/no claim by this session was found/);
    expect(res.stderr).not.toMatch(/FAILED/);
    expect(res.stdout).toMatch(/rc=1/);
  });

  it('still reports "no claim ... was found" under errexit, as the CLI renew subcommand runs it', () => {
    // The CLI's `renew)` arm calls lease_renew bare under `set -euo pipefail`. With no
    // claim of ours jq prints nothing and the claim-id `read` returns 1 at end of input;
    // unguarded, errexit ended the script on that line, before the reason was printed.
    const res = run(`
      set -euo pipefail
      export MINSPEC_LEASE_REPO=owner/repo
      export MINSPEC_LEASE_SID=sid-test
      source ${JSON.stringify(LEASE)}
      gh_bot_init() { :; }
      lease_read_claims() { echo '[]'; }
      lease_renew 55
    `);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no claim by this session was found/);
  });

  it('reports gh\'s own refusal text when the PATCH is rejected', () => {
    const res = renewWith(`
      lease_read_claims() { echo '[{"sessionId":"sid-test","claimedAt":"2026-01-01T00:00:00.000Z","serverOrder":1}]'; }
      lease_worktree_path() { echo "/tmp/wt"; }
      gh() {
        if [[ "$1" == "api" && "$2" == "-X" && "$3" == "PATCH" ]]; then
          echo "gh: Not Found (HTTP 404)" >&2
          return 1
        fi
        return 0
      }
    `);
    expect(res.stderr).toMatch(/the PATCH was refused:.*Not Found \(HTTP 404\)/);
    expect(res.stderr).not.toMatch(/FAILED/);
    expect(res.stdout).toMatch(/rc=1/);
  });

  it('the two failure reasons are distinguishable from each other, not both "exit 1"', () => {
    const readFailed = renewWith(`lease_read_claims() { return 1; }`);
    const noClaim = renewWith(`lease_read_claims() { echo '[]'; }`);
    expect(readFailed.stderr).not.toEqual(noClaim.stderr);
  });

  it('returns 0 and prints nothing to stderr on a clean renewal', () => {
    const res = renewWith(`
      lease_read_claims() { echo '[{"sessionId":"sid-test","claimedAt":"2026-01-01T00:00:00.000Z","serverOrder":1}]'; }
      lease_worktree_path() { echo "/tmp/wt"; }
      gh() { return 0; }
    `);
    expect(res.stdout).toMatch(/rc=0/);
    expect(res.stderr.trim()).toBe('');
  });
});
