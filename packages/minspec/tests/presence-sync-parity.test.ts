/**
 * SPEC-026 FR-14 (family) — Bash ⇔ TypeScript presence-gate parity + the gated-ff.
 *
 * Two obligations:
 *  1. PARITY: TS `isCheckoutOccupied` and the bash `drain-inbox.sh --checkout-occupied`
 *     seam MUST return the SAME occupied/dormant verdict on one shared golden-fixture
 *     set (live / stale-by-1s / dead-pid / empty-dir / corrupt-record /
 *     same-vs-different worktreeRoot / empty-allowlist). CI fails on drift.
 *  2. GATED-FF BEHAVIOUR: `sync_shared_checkouts` ff's a DORMANT, on-main, clean
 *     checkout to origin/main, and refuses (fetch-only) when the checkout is
 *     presence-OCCUPIED, dirty, off-main, or diverged. Rule #8: a live tree is never
 *     mutated.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

import { isCheckoutOccupied, STALE_SECS, type SessionPresenceRecord } from '../src/lib/presence';

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** A pid that is (almost certainly) dead. */
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

function baseRecord(over: Partial<SessionPresenceRecord>): SessionPresenceRecord {
  return {
    sessionId: 'sid-' + Math.random().toString(36).slice(2),
    scope: 's',
    project: 'minspec',
    type: 'feat',
    branch: 'main',
    worktreeRoot: '/PLACEHOLDER',
    specIds: [],
    fileAllowlist: [],
    pid: process.pid,
    lastSeen: iso(),
    startedAt: iso(),
    ...over,
  };
}

/** Run the bash seam. Exit 0 → occupied, exit 1 → dormant. */
function bashOccupied(primaryRoot: string, candidate: string): boolean {
  const r = spawnSync('bash', [DRAIN, '--checkout-occupied', candidate], {
    encoding: 'utf-8',
    env: { ...process.env, MINSPEC_DRAIN_PRIMARY_ROOT: primaryRoot },
  });
  // stdout is "occupied"/"dormant"; status mirrors it (0/1).
  const out = String(r.stdout ?? '').trim();
  if (out === 'occupied') return true;
  if (out === 'dormant') return false;
  throw new Error(`unexpected --checkout-occupied output: "${out}" (status ${r.status}, stderr ${r.stderr})`);
}

// ── The shared golden-fixture set ────────────────────────────────────────────
// Each case builds a .minspec/sessions/ dir under `root` and asks: is `candidate`
// occupied? Both engines must agree.
interface Fixture {
  name: string;
  records: (root: string) => (SessionPresenceRecord | { __corrupt: string })[];
  candidate: (root: string) => string;
  expected: boolean; // true = occupied
}

const FIXTURES: Fixture[] = [
  {
    name: 'empty dir ⇒ occupied',
    records: () => [],
    candidate: (r) => r,
    expected: true,
  },
  {
    name: 'single live record claiming this root ⇒ occupied',
    records: (r) => [baseRecord({ worktreeRoot: r })],
    candidate: (r) => r,
    expected: true,
  },
  {
    name: 'live record elsewhere, none here ⇒ dormant',
    records: () => [baseRecord({ worktreeRoot: '/other/tree' })],
    candidate: (r) => r,
    expected: false,
  },
  {
    name: 'all records stale-by-1s ⇒ occupied (no demonstrable live session)',
    records: () => [
      baseRecord({ worktreeRoot: '/other/tree', lastSeen: iso(-(STALE_SECS + 1) * 1000) }),
    ],
    candidate: (r) => r,
    expected: true,
  },
  {
    name: 'live elsewhere + dead-pid claim here ⇒ dormant for this root',
    records: (r) => [
      baseRecord({ worktreeRoot: '/other/live' }),
      baseRecord({ worktreeRoot: r, pid: deadPid() }),
    ],
    candidate: (r) => r,
    expected: false,
  },
  {
    name: 'corrupt record ⇒ occupied (cannot attribute), even with a live peer elsewhere',
    records: (r) => [baseRecord({ worktreeRoot: '/other' }), { __corrupt: '{ not json' }],
    candidate: (r) => r,
    expected: true,
  },
  {
    name: 'same worktreeRoot via trailing-slash candidate ⇒ occupied',
    records: (r) => [baseRecord({ worktreeRoot: r })],
    candidate: (r) => r + '/',
    expected: true,
  },
  {
    name: 'empty-allowlist live peer here still occupies (gate ignores allowlist)',
    records: (r) => [baseRecord({ worktreeRoot: r, fileAllowlist: [] })],
    candidate: (r) => r,
    expected: true,
  },
];

function buildFixture(fx: Fixture): { root: string; candidate: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
  const sdir = path.join(root, '.minspec', 'sessions');
  fs.mkdirSync(sdir, { recursive: true });
  let i = 0;
  for (const rec of fx.records(root)) {
    if ('__corrupt' in rec) {
      fs.writeFileSync(path.join(sdir, `corrupt-${i++}.session.json`), rec.__corrupt);
    } else {
      fs.writeFileSync(path.join(sdir, `${rec.sessionId}.session.json`), JSON.stringify(rec, null, 2) + '\n');
    }
  }
  return { root, candidate: fx.candidate(root) };
}

describe('FR-14 parity: TS isCheckoutOccupied ≡ bash --checkout-occupied', () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}`, () => {
      const { root, candidate } = buildFixture(fx);
      try {
        const ts = isCheckoutOccupied(root, candidate);
        const bash = bashOccupied(root, candidate);
        expect(ts, `TS verdict for "${fx.name}"`).toBe(fx.expected);
        expect(bash, `bash verdict for "${fx.name}"`).toBe(fx.expected);
        expect(ts, `TS≡bash for "${fx.name}"`).toBe(bash);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe('FR-3/FR-14 constant tie-back: bash mirrors presence.ts', () => {
  const src = fs.readFileSync(DRAIN, 'utf-8');
  it('declares PRESENCE_HEARTBEAT_SECS / PRESENCE_STALE_SECS with the MUST-equal tie-back', () => {
    expect(src).toMatch(/PRESENCE_HEARTBEAT_SECS=30/);
    expect(src).toMatch(/PRESENCE_STALE_SECS=120/);
    expect(src).toMatch(/MUST equal presence\.ts/);
  });
  it('the pairing (stale = 4 × heartbeat) is documented', () => {
    expect(src).toMatch(/4 × PRESENCE_HEARTBEAT_SECS|= 4 ×/);
  });
});

// ── Gated-ff behaviour (rule #8 / #168 / DR-051 §4a) ──────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

/**
 * Build: a bare origin at C2, a `primary` checkout that is the drain's root (holds
 * the presence dir) parked on a non-`main` `host` branch, and `sibling` (a linked
 * worktree ON `main`, stale at C1). Only ONE worktree of a repo can hold `main`, so
 * the primary is parked off-main — realistic (rule #8: sessions live in their own
 * worktrees) and it keeps the primary G1-skipped so the occupancy gate is what the
 * tests exercise on the sibling. The drain script is copied into primary/scripts so
 * PRIMARY_ROOT resolves to `primary` and `git worktree list` enumerates both.
 */
function buildRepo(root: string): { primary: string; sibling: string; c1: string; c2: string } {
  const origin = path.join(root, 'origin.git');
  const primary = path.join(root, 'primary');
  fs.mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'clone', origin, primary);
  fs.writeFileSync(path.join(primary, 'a.txt'), 'c1');
  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'c1');
  git(primary, 'push', 'origin', 'main');
  const c1 = git(primary, 'rev-parse', 'HEAD');

  // sibling linked worktree on main, at C1 (created BEFORE primary leaves main).
  const sibling = path.join(root, 'sibling');
  git(primary, 'checkout', '-b', 'host'); // park primary off main so sibling can hold main
  git(primary, 'worktree', 'add', sibling, 'main');

  // origin advances to C2 (a second clone), leaving primary + sibling stale.
  const other = path.join(root, 'other');
  git(root, 'clone', origin, other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'c2');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'c2');
  git(other, 'push', 'origin', 'main');
  const c2 = git(other, 'rev-parse', 'HEAD');
  expect(c2).not.toBe(c1);

  // Refresh primary's remote-tracking ref so origin/main is known locally, and copy
  // the drain script in so SCRIPT_DIR→PRIMARY_ROOT == primary.
  git(primary, 'fetch', 'origin', 'main');
  fs.mkdirSync(path.join(primary, 'scripts'), { recursive: true });
  fs.copyFileSync(DRAIN, path.join(primary, 'scripts', 'drain-inbox.sh'));
  return { primary, sibling, c1, c2 };
}

function writeLiveClaim(sessionsRoot: string, worktreeRoot: string): void {
  const sdir = path.join(sessionsRoot, '.minspec', 'sessions');
  fs.mkdirSync(sdir, { recursive: true });
  const rec = baseRecord({ worktreeRoot });
  fs.writeFileSync(path.join(sdir, `${rec.sessionId}.session.json`), JSON.stringify(rec, null, 2) + '\n');
}

/** Run one `--sync-checkouts` pass. Presence dir lives under `primary`. */
function runSync(primary: string, extraEnv: Record<string, string> = {}): void {
  execFileSync('bash', [path.join(primary, 'scripts', 'drain-inbox.sh'), '--sync-checkouts'], {
    encoding: 'utf-8',
    // Disable the run-dir self-refresh machinery — not under test here.
    env: { ...process.env, MINSPEC_DRAIN_SELF_REFRESH: '0', MINSPEC_DRAIN_RUN_DIR: path.join(primary, '..', 'norun'), ...extraEnv },
  });
}

describe('sync_shared_checkouts: gated fast-forward (rule #8 / #168)', () => {
  it('ff\'s a DORMANT, on-main, clean SIBLING worktree to origin/main; leaves the OCCUPIED primary alone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-'));
    try {
      const { primary, sibling, c1, c2 } = buildRepo(root);
      // The launching session occupies the PRIMARY (its own checkout). The sibling
      // is dormant (no live claim). Expect: sibling ff→C2, primary stays at C1.
      writeLiveClaim(primary, primary);
      runSync(primary);
      expect(git(sibling, 'rev-parse', 'HEAD'), 'dormant sibling should ff to C2').toBe(c2);
      expect(git(primary, 'rev-parse', 'HEAD'), 'occupied primary must NOT be ff\'d').toBe(c1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to ff a sibling that a LIVE session claims (occupied ⇒ fetch-only)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-occ-'));
    try {
      const { primary, sibling, c1 } = buildRepo(root);
      // A live claim on BOTH primary and sibling ⇒ both occupied ⇒ neither ff'd.
      writeLiveClaim(primary, primary);
      writeLiveClaim(primary, sibling);
      runSync(primary);
      expect(git(sibling, 'rev-parse', 'HEAD'), 'occupied sibling must stay stale').toBe(c1);
      expect(git(primary, 'rev-parse', 'HEAD')).toBe(c1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to ff a DIRTY dormant sibling (G2: content-clean required)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-dirty-'));
    try {
      const { primary, sibling, c1 } = buildRepo(root);
      writeLiveClaim(primary, primary); // primary occupied; sibling dormant but dirty
      fs.writeFileSync(path.join(sibling, 'dirty.txt'), 'uncommitted');
      runSync(primary);
      expect(git(sibling, 'rev-parse', 'HEAD'), 'dirty sibling must not be ff\'d').toBe(c1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to ff a dormant sibling that is OFF the default branch (G1)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-branch-'));
    try {
      const { primary, sibling, c1 } = buildRepo(root);
      writeLiveClaim(primary, primary);
      git(sibling, 'checkout', '-b', 'feature'); // off main
      runSync(primary);
      expect(git(sibling, 'rev-parse', 'HEAD'), 'off-main sibling must not be ff\'d').toBe(c1);
      expect(git(sibling, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('kill-switch MINSPEC_DRAIN_GATED_FF=0 disables all ff (dormant sibling stays stale)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-killswitch-'));
    try {
      const { primary, sibling, c1 } = buildRepo(root);
      writeLiveClaim(primary, primary);
      runSync(primary, { MINSPEC_DRAIN_GATED_FF: '0' });
      expect(git(sibling, 'rev-parse', 'HEAD'), 'kill-switch ⇒ no ff').toBe(c1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('with NO live session anywhere (all-empty presence), nothing is ff\'d (fail-safe)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatedff-nolive-'));
    try {
      const { primary, sibling, c1 } = buildRepo(root);
      // No presence dir at all ⇒ every checkout is "occupied" (fail-safe) ⇒ no ff.
      runSync(primary);
      expect(git(sibling, 'rev-parse', 'HEAD'), 'no live session ⇒ fail-safe, no ff').toBe(c1);
      expect(git(primary, 'rev-parse', 'HEAD')).toBe(c1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
