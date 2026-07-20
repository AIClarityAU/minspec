/**
 * T0 — SPEC-026 Layer 1 (Presence) + the sync-gate primitive.
 *
 * Covers:
 *   • pidAlive / isRecordLive — the FR-4 liveness core (stale heartbeat, dead pid,
 *     unparseable lastSeen).
 *   • isCheckoutOccupied — the fail-safe matrix (empty / corrupt / all-stale ⇒
 *     occupied; ≥1-live-elsewhere + none-here ⇒ dormant; live-here ⇒ occupied).
 *   • SessionPresenceManager.getActiveSessions — prune dead + exclude self.
 *   • contendingLiveSessions — FR-10 overlap predicate.
 *
 * These use a REAL temp .minspec/sessions/ dir (no fs mock) so the reader/pruner is
 * exercised end-to-end. The manager's git-derived fields resolve to '' in a non-repo
 * temp dir, which is fine — these tests never assert on branch/worktreeRoot beyond
 * what they write directly into fixture records.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  HEARTBEAT_SECS,
  STALE_SECS,
  SESSIONS_DIR,
  pidAlive,
  isRecordLive,
  readAllRecords,
  isCheckoutOccupied,
  contendingLiveSessions,
  SessionPresenceManager,
  type SessionPresenceRecord,
} from '../src/lib/presence';

let root: string;
let sessionsDir: string;

function makeRecord(over: Partial<SessionPresenceRecord> = {}): SessionPresenceRecord {
  const now = new Date().toISOString();
  return {
    sessionId: 'rec-' + Math.random().toString(36).slice(2),
    scope: 'scope',
    project: 'minspec',
    type: 'feat',
    branch: 'main',
    worktreeRoot: root,
    specIds: [],
    fileAllowlist: [],
    pid: process.pid, // alive by default
    lastSeen: now,
    startedAt: now,
    ...over,
  };
}

function writeRecord(rec: SessionPresenceRecord): void {
  fs.writeFileSync(path.join(sessionsDir, `${rec.sessionId}.session.json`), JSON.stringify(rec, null, 2) + '\n');
}

/** A pid that is (almost certainly) dead: a large value not currently in use. */
function deadPid(): number {
  // Find an unused high pid by probing upward from a large base.
  for (let p = 4_000_000; p < 4_000_050; p++) {
    try {
      process.kill(p, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') return p;
    }
  }
  return 3_999_999;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-'));
  sessionsDir = path.join(root, SESSIONS_DIR);
  fs.mkdirSync(sessionsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('constants (FR-3 — paired)', () => {
  it('STALE_SECS is exactly 4 × HEARTBEAT_SECS', () => {
    expect(STALE_SECS).toBe(4 * HEARTBEAT_SECS);
    expect(HEARTBEAT_SECS).toBe(30);
    expect(STALE_SECS).toBe(120);
  });
});

describe('pidAlive (FR-4.2)', () => {
  it('true for the current process', () => {
    expect(pidAlive(process.pid)).toBe(true);
  });
  it('false for a dead pid (ESRCH)', () => {
    expect(pidAlive(deadPid())).toBe(false);
  });
});

describe('isRecordLive (FR-4)', () => {
  it('live: fresh heartbeat + live pid', () => {
    expect(isRecordLive(makeRecord())).toBe(true);
  });
  it('dead: stale heartbeat (>= 120s old) even with a live pid', () => {
    const old = new Date(Date.now() - (STALE_SECS + 1) * 1000).toISOString();
    expect(isRecordLive(makeRecord({ lastSeen: old }))).toBe(false);
  });
  it('live: heartbeat just under the stale threshold', () => {
    const almost = new Date(Date.now() - (STALE_SECS - 1) * 1000).toISOString();
    expect(isRecordLive(makeRecord({ lastSeen: almost }))).toBe(true);
  });
  it('dead: fresh heartbeat but a dead pid', () => {
    expect(isRecordLive(makeRecord({ pid: deadPid() }))).toBe(false);
  });
  it('dead: unparseable lastSeen', () => {
    expect(isRecordLive(makeRecord({ lastSeen: 'not-a-date' }))).toBe(false);
  });
});

describe('isCheckoutOccupied — fail-safe matrix (the sync gate)', () => {
  it('OCCUPIED: missing sessions dir', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-bare-'));
    try {
      expect(isCheckoutOccupied(bare, bare)).toBe(true);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
  it('OCCUPIED: empty sessions dir (heartbeat indistinguishable from not-running)', () => {
    expect(isCheckoutOccupied(root, root)).toBe(true);
  });
  it('OCCUPIED: all records stale (no demonstrable live session)', () => {
    const old = new Date(Date.now() - (STALE_SECS + 5) * 1000).toISOString();
    writeRecord(makeRecord({ lastSeen: old, worktreeRoot: '/elsewhere' }));
    expect(isCheckoutOccupied(root, root)).toBe(true);
  });
  it('OCCUPIED: a corrupt record blocks all ff (cannot attribute)', () => {
    // one live record elsewhere would otherwise make it dormant — the corrupt file wins
    writeRecord(makeRecord({ worktreeRoot: '/elsewhere' }));
    fs.writeFileSync(path.join(sessionsDir, 'junk.session.json'), '{ not valid json');
    expect(isCheckoutOccupied(root, root)).toBe(true);
  });
  it('OCCUPIED: a live record claims THIS checkout', () => {
    writeRecord(makeRecord({ worktreeRoot: root }));
    expect(isCheckoutOccupied(root, root)).toBe(true);
  });
  it('DORMANT: ≥1 live record exists but none claims this checkout', () => {
    writeRecord(makeRecord({ worktreeRoot: '/some/other/tree' }));
    expect(isCheckoutOccupied(root, root)).toBe(false);
  });
  it('DORMANT: live elsewhere, dead record here → still dormant for this root', () => {
    writeRecord(makeRecord({ worktreeRoot: '/other/live' }));
    writeRecord(makeRecord({ worktreeRoot: root, pid: deadPid() })); // dead claim on this root
    expect(isCheckoutOccupied(root, root)).toBe(false);
  });
  it('resolves worktreeRoot paths (trailing slash / .. equivalence)', () => {
    writeRecord(makeRecord({ worktreeRoot: root + '/.' }));
    expect(isCheckoutOccupied(root, root + '/')).toBe(true);
  });
});

describe('SessionPresenceManager.getActiveSessions (FR-4)', () => {
  it('prunes dead records and returns only live OTHERS (excludes self)', () => {
    const mgr = new SessionPresenceManager(root);
    // self record (mgr.sessionId) — must be excluded even though live
    writeRecord(makeRecord({ sessionId: mgr.sessionId, worktreeRoot: root }));
    // a live peer
    const peer = makeRecord({ worktreeRoot: root, scope: 'peer' });
    writeRecord(peer);
    // a dead peer (stale) — must be pruned from disk
    const stale = makeRecord({
      lastSeen: new Date(Date.now() - (STALE_SECS + 10) * 1000).toISOString(),
    });
    writeRecord(stale);

    const active = mgr.getActiveSessions();
    const ids = active.map((r) => r.sessionId);
    expect(ids).toContain(peer.sessionId);
    expect(ids).not.toContain(mgr.sessionId); // self excluded
    expect(ids).not.toContain(stale.sessionId); // dead excluded
    // dead file pruned from disk
    expect(fs.existsSync(path.join(sessionsDir, `${stale.sessionId}.session.json`))).toBe(false);
    // live files remain
    expect(fs.existsSync(path.join(sessionsDir, `${peer.sessionId}.session.json`))).toBe(true);
  });

  it('returns [] when the sessions dir is absent (no throw)', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-nodir-'));
    try {
      const mgr = new SessionPresenceManager(bare);
      expect(mgr.getActiveSessions()).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('SessionPresenceManager start/stop lifecycle (FR-3/FR-6)', () => {
  it('start() writes a presence file immediately; stop() removes it and never throws', () => {
    const mgr = new SessionPresenceManager(root);
    mgr.start();
    const own = path.join(sessionsDir, `${mgr.sessionId}.session.json`);
    expect(fs.existsSync(own)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(own, 'utf-8')) as SessionPresenceRecord;
    expect(rec.sessionId).toBe(mgr.sessionId);
    expect(rec.pid).toBe(process.pid);
    expect(() => mgr.stop()).not.toThrow();
    expect(fs.existsSync(own)).toBe(false);
  });

  it('onDidChange fires with the other-session count', () => {
    const mgr = new SessionPresenceManager(root);
    const counts: number[] = [];
    mgr.onDidChange((n) => counts.push(n));
    // seed a live peer, then start → maybeFireCount should report 1
    writeRecord(makeRecord({ worktreeRoot: root, scope: 'peer' }));
    mgr.start();
    mgr.stop();
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[counts.length - 1]).toBe(1);
  });
});

describe('contendingLiveSessions (FR-10)', () => {
  it('flags a live same-tree peer whose allowlist overlaps the edited paths', () => {
    writeRecord(makeRecord({ worktreeRoot: root, fileAllowlist: ['specs/minspec/'], scope: 'peer' }));
    const hits = contendingLiveSessions(root, root, ['specs/minspec/SPEC-026-session-presence/requirements.md']);
    expect(hits).toHaveLength(1);
  });
  it('ignores a peer in a different worktree', () => {
    writeRecord(makeRecord({ worktreeRoot: '/other', fileAllowlist: ['specs/'] }));
    expect(contendingLiveSessions(root, root, ['specs/x.md'])).toHaveLength(0);
  });
  it('ignores a peer with an empty allowlist (INV-10)', () => {
    writeRecord(makeRecord({ worktreeRoot: root, fileAllowlist: [] }));
    expect(contendingLiveSessions(root, root, ['specs/x.md'])).toHaveLength(0);
  });
  it('excludes self by sessionId', () => {
    const self = makeRecord({ worktreeRoot: root, fileAllowlist: ['a/'], sessionId: 'me' });
    writeRecord(self);
    expect(contendingLiveSessions(root, root, ['a/b.ts'], 'me')).toHaveLength(0);
  });
  it('ignores a dead same-tree claimant (INV-8 sequential handoff)', () => {
    writeRecord(makeRecord({ worktreeRoot: root, fileAllowlist: ['a/'], pid: deadPid() }));
    expect(contendingLiveSessions(root, root, ['a/b.ts'])).toHaveLength(0);
  });
});

describe('readAllRecords', () => {
  it('returns {rec:null} for a corrupt file (prune candidate)', () => {
    fs.writeFileSync(path.join(sessionsDir, 'bad.session.json'), 'nope');
    const entries = readAllRecords(root);
    expect(entries).toHaveLength(1);
    expect(entries[0].rec).toBeNull();
  });
  it('ignores non-.session.json files', () => {
    fs.writeFileSync(path.join(sessionsDir, 'README.txt'), 'hi');
    writeRecord(makeRecord());
    const entries = readAllRecords(root);
    expect(entries).toHaveLength(1);
  });
});
