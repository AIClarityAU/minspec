/**
 * #1198 — T0/T3: `issue-lease.sh reclaim?` decision seam.
 *
 * WHY THIS FILE EXISTS. `is_claim_live` and `classify_claim` were each correct and
 * each unit-tested (issue-lease-classify.test.ts). The defect lived only in the SEAM
 * between them: `lease_reclaim_q` read line 2 of classify_claim's output (the winning
 * sessionId) and treated emptiness as "no live claim" — but classify_claim emits
 * `self_sid` on line 2 for the no-live-claim (`claim`) decision, and an EMPTY line 2
 * for the incomplete-enumeration (`stand-down`) case. Both directions were inverted:
 * a long-dead claim reported "held", and an unprovable enumeration reported
 * "reclaimable" (the exact case INV-6 forbids).
 *
 * Consequence in production: `remediate-pr.sh` maps a nonzero `reclaim?` to
 * `LIVE_NONSELF_CLAIM=yes`, so EVERY PR whose branch resolved to a work item was
 * skipped as `skip-live-owned`, forever. Agent PRs are exactly the PRs auto-remediation
 * exists to fix.
 *
 * The nearby tests in remediate-pr-classify.test.ts assert the CALL SITE's source text
 * (`expect(code).toMatch(/reclaim\?/)`). Those pass whatever the seam returns, which is
 * why the inversion shipped. These tests assert BEHAVIOUR instead.
 *
 * `--reclaim-decision` is the pure seam: the same decision `reclaim?` makes, minus the
 * gh fetch, so it is hermetic (no gh/git/claude) like `--classify-claim` and `--is-live`.
 */
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const HOST = os.hostname();
const NOW = Math.floor(Date.now() / 1000);

function iso(offsetSec = 0): string {
  return new Date((NOW + offsetSec) * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
}

/** A pid that is (almost certainly) dead — same technique as issue-lease-classify. */
function deadPid(): number {
  for (let p = 4_000_000; p < 4_000_050; p++) {
    try {
      process.kill(p, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') return p;
    }
  }
  return 3_999_999;
}

interface ClaimOpts {
  sessionId?: string;
  host?: string;
  pid?: number;
  ageSec?: number;
  serverOrder?: number;
}

function claims(...list: ClaimOpts[]): string {
  return JSON.stringify(
    list.map((c, i) => ({
      sessionId: c.sessionId ?? `sid-${i}`,
      host: c.host ?? HOST,
      worktreeRoot: `/tmp/minspec-agent/issue-1-${c.sessionId ?? `sid-${i}`}`,
      pid: c.pid ?? process.pid,
      claimedAt: iso(-(c.ageSec ?? 0)),
      lastRenewed: iso(-(c.ageSec ?? 0)),
      serverOrder: c.serverOrder ?? 1000 + i,
    })),
  );
}

/**
 * Run the pure seam. Exit 0 = reclaimable, 1 = hands off.
 *
 * ONLY 0 and 1 are verdicts. Any other status — 2 (bad usage / unknown flag), 127, a
 * signal — is a broken harness and MUST throw, never be folded into `false`. A bare
 * `catch { return false }` would make every "not reclaimable" assertion below pass
 * vacuously while the seam did not exist at all.
 */
function reclaimable(claimsJson: string, selfSid = 'me', enumComplete: '0' | '1' = '1'): boolean {
  try {
    execFileSync(
      'bash',
      [SCRIPT, '--reclaim-decision', claimsJson, selfSid, String(NOW), enumComplete],
      { stdio: 'pipe' },
    );
    return true;
  } catch (e: any) {
    if (e?.status === 1) return false;
    throw new Error(
      `--reclaim-decision exited ${e?.status ?? '?'} (not a 0/1 verdict): ${String(
        e?.stderr ?? e?.message ?? '',
      ).slice(0, 300)}`,
    );
  }
}

/** classify_claim's decision token (line 1) for the same inputs — the contract. */
function decisionToken(claimsJson: string, selfSid = 'me', enumComplete: '0' | '1' = '1'): string {
  return execFileSync(
    'bash',
    [SCRIPT, '--classify-claim', claimsJson, selfSid, String(NOW), enumComplete],
    { encoding: 'utf8' },
  )
    .split('\n')[0]
    .trim();
}

describe('#1198 T3 regression: reclaim? is not inverted', () => {
  it('an EXPIRED claim is reclaimable (the bug: reported held, forever)', () => {
    // Stale heartbeat: age well past LEASE_TTL_SECS=240.
    expect(reclaimable(claims({ ageSec: 9000, pid: deadPid() }))).toBe(true);
  });

  it('a same-machine DEAD pid inside TTL is reclaimable', () => {
    expect(reclaimable(claims({ ageSec: 10, pid: deadPid() }))).toBe(true);
  });

  it('a LIVE non-self claim is NOT reclaimable', () => {
    expect(reclaimable(claims({ ageSec: 10, pid: process.pid, sessionId: 'other' }))).toBe(false);
  });

  it('NO claims at all is reclaimable', () => {
    expect(reclaimable('[]')).toBe(true);
  });

  it('enum_complete=0 is NOT reclaimable (INV-6 — the other half of the inversion)', () => {
    // Previously returned 0/reclaimable because stand-down printed an empty line 2.
    expect(reclaimable(claims({ ageSec: 9000, pid: deadPid() }), 'me', '0')).toBe(false);
  });

  it('unparseable claims are NOT reclaimable (INV-6)', () => {
    expect(reclaimable('not json at all')).toBe(false);
  });

  it("self's OWN live claim is not 'reclaimable' — nothing to take", () => {
    expect(reclaimable(claims({ ageSec: 10, pid: process.pid, sessionId: 'me' }), 'me')).toBe(false);
  });
});

describe('#1198 T0 seam: reclaim? agrees with classify_claim for EVERY decision', () => {
  // The invariant the fix rests on: reclaim? switches on the decision TOKEN, never on
  // the emptiness of a field whose emptiness was never part of the contract. If a future
  // edit reintroduces an inference, this table diverges.
  const cases: Array<{ name: string; json: string; sid: string; enumComplete: '0' | '1' }> = [
    { name: 'no claims', json: '[]', sid: 'me', enumComplete: '1' },
    {
      name: 'expired claim',
      json: claims({ ageSec: 9000, pid: deadPid() }),
      sid: 'me',
      enumComplete: '1',
    },
    {
      name: 'live foreign claim',
      json: claims({ ageSec: 5, pid: process.pid, sessionId: 'other' }),
      sid: 'me',
      enumComplete: '1',
    },
    {
      name: 'own live claim',
      json: claims({ ageSec: 5, pid: process.pid, sessionId: 'me' }),
      sid: 'me',
      enumComplete: '1',
    },
    {
      name: 'incomplete enumeration',
      json: claims({ ageSec: 5, pid: process.pid }),
      sid: 'me',
      enumComplete: '0',
    },
  ];

  for (const c of cases) {
    it(`${c.name}: reclaimable ⟺ token is 'claim'`, () => {
      const token = decisionToken(c.json, c.sid, c.enumComplete);
      expect(reclaimable(c.json, c.sid, c.enumComplete)).toBe(token === 'claim');
    });
  }
});
