/**
 * SPEC-044 Slice 1 — the Tier-0 work-item claim primitive + the FR-10 LIVENESS parity.
 *
 * Two obligations, mirroring presence-sync-parity.test.ts:
 *  1. CORE UNIT (AC-9 / FR-2): `pickClaimWinner` picks the earliest serverOrder →
 *     sessionId among LIVE claims, and `isClaimLive` is the TTL + (foreign-host OR
 *     pid-alive) predicate. Substrate-specific winner ⇒ its OWN test (not parity).
 *  2. LIVENESS PARITY (FR-10 / AC-8): the LIVENESS half of `presence.ts isClaimLive`
 *     agrees BYTE-FOR-BYTE with the Tier-1 bash reader `issue-lease.sh --is-live` on a
 *     shared golden-fixture set. Fixtures keep `claimedAt` recent so the Tier-1-only
 *     ABS_MAX ceiling (deliberately out of the parity set) never decides.
 *  3. TIER-0 offline (INV-3): presence.ts adds NO network — asserted by the existing
 *     tier0-import-ban gate; here we tie the parity-shared TTL constant across engines.
 */
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { isClaimLive, pickClaimWinner, LEASE_TTL_SECS, type WorkItemClaim } from '../src/lib/presence';

const LEASE = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const HOST = os.hostname();
const NOW_MS = Date.now();
const NOW_S = Math.floor(NOW_MS / 1000);

function iso(offsetSec = 0): string {
  return new Date((NOW_S + offsetSec) * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
}

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

function mkClaim(over: Partial<WorkItemClaim>): WorkItemClaim {
  return {
    sessionId: 'sid-' + Math.random().toString(36).slice(2),
    host: HOST,
    worktreeRoot: '/w',
    pid: process.pid,
    claimedAt: iso(),
    lastRenewed: iso(),
    serverOrder: 1,
    ...over,
  };
}

/** Bash liveness verdict via the seam. */
function bashLive(c: WorkItemClaim, selfHost: string): boolean {
  try {
    const out = execFileSync(
      'bash',
      [LEASE, '--is-live', c.lastRenewed, c.claimedAt, String(c.pid), c.host, selfHost, String(NOW_S)],
      { encoding: 'utf-8' },
    );
    return out.trim() === 'live';
  } catch {
    return false;
  }
}

// ── Core unit: pickClaimWinner (AC-9, substrate-specific — own test) ──────────
describe('pickClaimWinner (FR-2/AC-9): earliest serverOrder → sessionId; claimedAt never a key', () => {
  it('no claims ⇒ null', () => {
    expect(pickClaimWinner([], NOW_MS)).toBeNull();
  });

  it('all stale ⇒ null', () => {
    expect(pickClaimWinner([mkClaim({ lastRenewed: iso(-10_000) })], NOW_MS)).toBeNull();
  });

  it('single live claim ⇒ that claim', () => {
    const c = mkClaim({ sessionId: 'only', serverOrder: 5 });
    expect(pickClaimWinner([c], NOW_MS)?.sessionId).toBe('only');
  });

  it('earliest serverOrder wins among live', () => {
    const claims = [mkClaim({ sessionId: 'late', serverOrder: 99 }), mkClaim({ sessionId: 'early', serverOrder: 3 })];
    expect(pickClaimWinner(claims, NOW_MS)?.sessionId).toBe('early');
  });

  it('equal serverOrder ⇒ sessionId tiebreak', () => {
    const claims = [mkClaim({ sessionId: 'sid-B', serverOrder: 7 }), mkClaim({ sessionId: 'sid-A', serverOrder: 7 })];
    expect(pickClaimWinner(claims, NOW_MS)?.sessionId).toBe('sid-A');
  });

  it('stale + live mix ⇒ earliest-serverOrder LIVE claim (stale ignored)', () => {
    const claims = [
      mkClaim({ sessionId: 'stale-first', serverOrder: 1, lastRenewed: iso(-10_000) }),
      mkClaim({ sessionId: 'live-second', serverOrder: 50 }),
    ];
    expect(pickClaimWinner(claims, NOW_MS)?.sessionId).toBe('live-second');
  });

  it('claimedAt is NOT a deciding key — earliest serverOrder wins even with a newer claimedAt', () => {
    const claims = [
      mkClaim({ sessionId: 'winner', serverOrder: 2, claimedAt: iso(0) }),
      mkClaim({ sessionId: 'older-claimedAt', serverOrder: 8, claimedAt: iso(-100) }),
    ];
    expect(pickClaimWinner(claims, NOW_MS)?.sessionId).toBe('winner');
  });
});

// ── Core unit: isClaimLive (the liveness half) ───────────────────────────────
describe('isClaimLive (FR-8): TTL fresh AND (foreign-host OR pid alive)', () => {
  it('fresh, same host, alive pid ⇒ live', () => {
    expect(isClaimLive(mkClaim({}), NOW_MS, true)).toBe(true);
  });
  it('stale heartbeat ⇒ dead', () => {
    expect(isClaimLive(mkClaim({ lastRenewed: iso(-10_000) }), NOW_MS, true)).toBe(false);
  });
  it('same machine, dead pid ⇒ dead', () => {
    expect(isClaimLive(mkClaim({ pid: deadPid() }), NOW_MS, true)).toBe(false);
  });
  it('foreign host, fresh, dead pid ⇒ live (TTL alone)', () => {
    expect(isClaimLive(mkClaim({ pid: deadPid() }), NOW_MS, false)).toBe(true);
  });
  it('unparseable heartbeat ⇒ dead', () => {
    expect(isClaimLive(mkClaim({ lastRenewed: 'nope' }), NOW_MS, true)).toBe(false);
  });
});

// ── LIVENESS PARITY: presence.ts isClaimLive ≡ issue-lease.sh --is-live (AC-8) ──
interface ParityFixture {
  name: string;
  claim: WorkItemClaim;
  expected: boolean;
}

const FIXTURES: ParityFixture[] = [
  { name: 'fresh, same host, alive pid ⇒ live', claim: mkClaim({ host: HOST, pid: process.pid }), expected: true },
  { name: 'stale-by-1s heartbeat ⇒ dead', claim: mkClaim({ host: HOST, lastRenewed: iso(-(LEASE_TTL_SECS + 1)) }), expected: false },
  { name: 'same host, dead pid ⇒ dead', claim: mkClaim({ host: HOST, pid: deadPid() }), expected: false },
  { name: 'foreign host, fresh ⇒ live (TTL alone)', claim: mkClaim({ host: 'other-host', pid: deadPid() }), expected: true },
  { name: 'foreign host, stale ⇒ dead', claim: mkClaim({ host: 'other-host', lastRenewed: iso(-(LEASE_TTL_SECS + 1)) }), expected: false },
  { name: 'boundary: exactly TTL old ⇒ dead (>=)', claim: mkClaim({ host: HOST, lastRenewed: iso(-LEASE_TTL_SECS), pid: process.pid }), expected: false },
];

describe('FR-10/AC-8 liveness parity: presence.ts isClaimLive ≡ bash --is-live', () => {
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const sameMachine = fx.claim.host === HOST;
      const ts = isClaimLive(fx.claim, NOW_MS, sameMachine);
      const bash = bashLive(fx.claim, HOST);
      expect(ts, `TS verdict for "${fx.name}"`).toBe(fx.expected);
      expect(bash, `bash verdict for "${fx.name}"`).toBe(fx.expected);
      expect(ts, `TS≡bash for "${fx.name}"`).toBe(bash);
    });
  }
});

// ── Constant tie-back: bash mirrors presence.ts LEASE_TTL_SECS (FR-10, drift gate) ──
describe('FR-10 constant tie-back: issue-lease.sh mirrors presence.ts LEASE_TTL_SECS', () => {
  const src = fs.readFileSync(LEASE, 'utf-8');
  it('presence.ts exports LEASE_TTL_SECS = 240 (= 4 × LEASE_RENEW_SECS)', () => {
    expect(LEASE_TTL_SECS).toBe(240);
  });
  it('bash declares LEASE_TTL_SECS=240 with a MUST-equal tie-back to presence.ts', () => {
    expect(src).toMatch(/LEASE_TTL_SECS=240/);
    expect(src).toMatch(/MUST equal presence\.ts LEASE_TTL_SECS/);
  });
  it('the pairing (TTL = 4 × RENEW) is documented and RENEW is declared', () => {
    expect(src).toMatch(/LEASE_RENEW_SECS=60/);
    expect(src).toMatch(/4 × LEASE_RENEW_SECS/);
  });
  it('ABS_MAX is a Tier-1-only ceiling, explicitly NOT parity-shared', () => {
    expect(src).toMatch(/LEASE_ABS_MAX_SECS=/);
    expect(src).toMatch(/NOT (in the presence parity set|parity-shared)/);
  });
});
