/**
 * T0 — SPEC-026 Layer 1 (Presence) + the sync-gate primitive.
 *
 * Covers:
 *   • pidAlive / isRecordLive — the FR-4 liveness core (stale heartbeat, dead pid,
 *     unparseable lastSeen).
 *   • isCheckoutOccupied — the fail-safe matrix (empty / corrupt / all-stale ⇒
 *     occupied; ≥1-live-elsewhere + none-here ⇒ dormant; live-here ⇒ occupied).
 *   • SessionPresenceManager.getActiveSessions — prune dead + exclude self.
 *   • contendingLiveSessions — FR-10 overlap predicate, its `{ path, peer }[]` shape,
 *     and every golden fixture in tests/helpers/presence-fixtures.ts (FR-14 set).
 *   • isPathClaimed / isApprovableCorpusPath — the coverage rule and the D-P5 corpus.
 *   • Layer 1 invariants, tagged by id so `grep -o 'INV-[0-9]*'` over
 *     tests/presence*.test.ts lists INV-1..INV-6, INV-8 and INV-10.
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
  isPathClaimed,
  isApprovableCorpusPath,
  APPROVABLE_CORPUS_PREFIXES,
  sameCheckout,
  SessionPresenceManager,
  type SessionPresenceRecord,
} from '../src/lib/presence';
import { MINSPEC_GITIGNORE_ENTRIES } from '../src/lib/scaffold';
import { PRESENCE_FIXTURES, buildPresenceFixture, type BuiltFixture } from './helpers/presence-fixtures';

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
  it('INV-2: prunes dead records and returns only live OTHERS (excludes self)', () => {
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
  it('INV-2: a fresh-heartbeat record whose pid is dead (ESRCH) is never returned, and is pruned', () => {
    const mgr = new SessionPresenceManager(root);
    const ghost = makeRecord({ worktreeRoot: root, pid: deadPid() });
    writeRecord(ghost);
    expect(mgr.getActiveSessions().map((r) => r.sessionId)).not.toContain(ghost.sessionId);
    expect(fs.existsSync(path.join(sessionsDir, `${ghost.sessionId}.session.json`))).toBe(false);
  });

  it('INV-3: two concurrently active managers never share a sessionId, and write two records', () => {
    const a = new SessionPresenceManager(root);
    const b = new SessionPresenceManager(root);
    try {
      expect(a.sessionId).not.toBe(b.sessionId);
      a.start();
      b.start();
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.session.json'));
      expect(files.sort()).toEqual([`${a.sessionId}.session.json`, `${b.sessionId}.session.json`].sort());
      expect(a.getActiveSessions().map((r) => r.sessionId)).toEqual([b.sessionId]);
    } finally {
      a.stop();
      b.stop();
    }
  });

  it('INV-4: a solo session (only its own record) sees zero peers, the input that keeps the 👥 suffix off', () => {
    const mgr = new SessionPresenceManager(root);
    try {
      mgr.start();
      expect(fs.existsSync(path.join(sessionsDir, `${mgr.sessionId}.session.json`))).toBe(true);
      expect(mgr.getActiveSessions()).toEqual([]);
    } finally {
      mgr.stop();
    }
  });

  it('INV-6: stop() never throws, even after its sessions dir is deleted under it, and when called twice', () => {
    const mgr = new SessionPresenceManager(root);
    mgr.start();
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    expect(() => mgr.stop()).not.toThrow();
    expect(() => mgr.stop()).not.toThrow();
  });

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
  it('flags a live same-tree peer whose allowlist overlaps the edited paths, as a { path, peer } entry', () => {
    const rec = makeRecord({ worktreeRoot: root, fileAllowlist: ['specs/minspec/'], scope: 'peer' });
    writeRecord(rec);
    const p = 'specs/minspec/SPEC-026-session-presence/requirements.md';
    const hits = contendingLiveSessions(root, root, [p]);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe(p);
    expect(hits[0].peer).toEqual(rec);
  });
  it('INV-10: ignores a peer in a different worktree', () => {
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

describe('sameCheckout (#2403 — canonicalized checkout comparison)', () => {
  // These fixture paths are Windows spellings and never exist on the Linux test
  // runner's real filesystem, so `fs.realpathSync.native` would reliably throw
  // ENOENT anyway — but injecting a `realpathNative` that always throws makes
  // that fallback-to-`path.resolve` explicit and immune to CI environment
  // quirks, rather than relying on an accident of what paths happen not to exist.
  const neverResolves = (): never => {
    throw new Error('ENOENT (fixture path does not exist)');
  };
  const win32 = (a: string, b: string): boolean =>
    sameCheckout(a, b, { platform: 'win32', realpathNative: neverResolves });
  const posix = (a: string, b: string): boolean =>
    sameCheckout(a, b, { platform: 'linux', realpathNative: neverResolves });

  // Table of Windows spellings of ONE folder — the issue's reproduction: VS
  // Code's fsPath lower-cases the drive letter, git prints the OS's own
  // spelling, and a short-name/subst/junction can differ further still.
  const WIN_SPELLINGS = [
    'C:\\Users\\jason\\code\\minspec',
    'c:\\Users\\jason\\code\\minspec', // lower-case drive letter (VS Code fsPath)
    'C:/Users/jason/code/minspec', // forward slashes (git's `rev-parse --show-toplevel`)
    'c:\\USERS\\JASON\\CODE\\MINSPEC', // another case entirely
    'C:\\Users\\jason\\code\\minspec\\', // trailing separator
  ];

  it('win32: every spelling in the table names the same checkout as every other', () => {
    for (const a of WIN_SPELLINGS) {
      for (const b of WIN_SPELLINGS) {
        expect(win32(a, b)).toBe(true);
      }
    }
  });

  it('win32: a genuinely different folder is NOT the same checkout', () => {
    expect(win32('C:\\Users\\jason\\code\\minspec', 'C:\\Users\\jason\\code\\other-repo')).toBe(false);
  });

  it('posix: the SAME spellings differing only by case are DIFFERENT checkouts (case-sensitive fs)', () => {
    expect(posix('/home/jason/code/minspec', '/home/jason/code/MINSPEC')).toBe(false);
  });

  it('posix: trailing-slash / "." segment equivalence still resolves equal', () => {
    expect(posix('/home/jason/code/minspec/.', '/home/jason/code/minspec/')).toBe(true);
  });

  it('falls back to path.resolve (not an exception) when realpath cannot resolve either side', () => {
    expect(sameCheckout('/tmp/sc-2403-does-not-exist-a', '/tmp/sc-2403-does-not-exist-a')).toBe(true);
    expect(sameCheckout('/tmp/sc-2403-does-not-exist-a', '/tmp/sc-2403-does-not-exist-b')).toBe(false);
  });

  it('canonicalizes through realpath when it succeeds (e.g. a symlinked checkout)', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'samecheckout-real-'));
    const link = path.join(os.tmpdir(), `samecheckout-link-${Date.now()}`);
    try {
      fs.symlinkSync(real, link, 'dir');
      expect(sameCheckout(real, link)).toBe(true);
    } finally {
      try {
        fs.unlinkSync(link);
      } catch {
        /* best-effort cleanup */
      }
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it('isCheckoutOccupied is OCCUPIED (not falsely DORMANT) for a differently-cased live record on a simulated win32 host', () => {
    // The regression this issue reports: on Windows, the SAME checkout can be
    // recorded with different drive-letter case, and the old `path.resolve`-only
    // compare (case-preserving) would treat that as "a different tree", find
    // nobody, and let a destructive discard through (fail OPEN). Unlike the
    // `win32(...)` table test above — which calls `sameCheckout` directly — this
    // one drives `isCheckoutOccupied` itself end-to-end: a real live record is
    // written to a real temp sessions dir with a Windows-spelled `worktreeRoot`,
    // and `isCheckoutOccupied` is asked about a DIFFERENTLY-cased spelling of the
    // same folder, injecting the win32 `sameCheckoutDeps` seam so the comparison
    // runs through the win32 branch on this Linux test runner.
    const recorded = 'C:\\Users\\jason\\code\\minspec';
    const editorReported = 'c:\\Users\\jason\\code\\minspec';
    writeRecord(makeRecord({ worktreeRoot: recorded }));
    expect(isCheckoutOccupied(root, editorReported, Date.now(), { platform: 'win32', realpathNative: neverResolves })).toBe(
      true, // ⇒ same checkout ⇒ OCCUPIED, never falsely DORMANT
    );
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

describe('INV-1: presence records never reach git', () => {
  it('the scaffolded .gitignore entry is exactly SESSIONS_DIR with a trailing slash', () => {
    expect(MINSPEC_GITIGNORE_ENTRIES).toContain(`${SESSIONS_DIR}/`);
  });
});

describe('INV-5: presence.ts is offline', () => {
  it('imports no network module and calls no fetch (static check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/lib/presence.ts'), 'utf-8');
    const specifiers = [...src.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    // Control: the regex does see the module's real imports, so an empty list cannot pass vacuously.
    expect(specifiers).toEqual(expect.arrayContaining(['fs', 'path', 'crypto', 'child_process']));
    const NETWORK = /^(node:)?(http|https|http2|net|tls|dgram|dns|undici)$/;
    expect(specifiers.filter((m) => NETWORK.test(m))).toEqual([]);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});

describe('isApprovableCorpusPath / APPROVABLE_CORPUS_PREFIXES (D-P5)', () => {
  it('is exactly the four corpus directories, frozen', () => {
    expect([...APPROVABLE_CORPUS_PREFIXES]).toEqual(['specs/', 'docs/decisions/', 'docs/domain/', 'docs/epics/']);
    expect(Object.isFrozen(APPROVABLE_CORPUS_PREFIXES)).toBe(true);
  });
  it.each([
    ['specs/minspec/SPEC-026-session-presence/requirements.md', true],
    ['docs/decisions/DR-051.md', true],
    ['docs/domain/glossary.md', true],
    ['docs/epics/EPIC-009.md', true],
    ['./specs/x.md', true],
    ['specs\\minspec\\x.md', true],
    ['packages/minspec/src/lib/presence.ts', false],
    ['docs/backlog.md', false],
    ['specs-old/x.md', false],
    ['docs/decisionsX.md', false],
    ['specs', false],
    ['', false],
  ])('%s ⇒ %s', (p, want) => {
    expect(isApprovableCorpusPath(p)).toBe(want);
  });
});

describe('isPathClaimed (design.md, Coverage semantics)', () => {
  it.each([
    [['a/b.ts'], 'a/b.ts', true],
    [['a/'], 'a/b.ts', true],
    [['a/*'], 'a/b/c.ts', true],
    [['a\\'], 'a/b.ts', true],
    [['a'], 'ab/c.ts', false],
    [['a/b'], 'a/bc.ts', false],
    [[''], 'a/b.ts', false],
    [['/*'], 'a/b.ts', false],
    [[], 'a/b.ts', false],
  ])('%j covers %s ⇒ %s', (allow, p, want) => {
    expect(isPathClaimed(allow, p)).toBe(want);
  });
});

describe('contendingLiveSessions on the golden fixture set (FR-14 set, task 1.2)', () => {
  let built: BuiltFixture | undefined;
  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  const key = (c: { path: string; sessionId: string }): string => `${c.path}\t${c.sessionId}`;

  it('the set covers every case tasks.md 1.2 lists', () => {
    expect(PRESENCE_FIXTURES.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'live-exact',
        'stale-121s',
        'edge-120s-stale',
        'edge-119s-live',
        'dead-pid',
        'empty-allowlist',
        'different-tree',
        'cover-dir-slash',
        'cover-dir-glob',
        'non-covering-sibling-prefix',
        'nonCorpus',
        'corrupt-record',
      ]),
    );
    // Both verdicts occur, so a predicate that always or never contends fails the set.
    expect(PRESENCE_FIXTURES.some((f) => f.expected.length > 0)).toBe(true);
    expect(PRESENCE_FIXTURES.some((f) => f.expected.length === 0 && f.peers.length > 0)).toBe(true);
  });

  for (const fx of PRESENCE_FIXTURES) {
    const tag = fx.name === 'empty-allowlist' || fx.name === 'different-tree' ? 'INV-10 ' : fx.name === 'dead-pid' ? 'INV-8 ' : '';
    it(`${tag}${fx.name}: ${fx.why}`, () => {
      built = buildPresenceFixture(fx);
      const got = contendingLiveSessions(built.root, built.worktreeRoot, fx.paths, fx.selfSessionId, built.now).map((c) =>
        key({ path: c.path, sessionId: c.peer.sessionId }),
      );
      expect(got.sort()).toEqual(fx.expected.map(key).sort());
    });
  }

  it('live peers in the fixtures are spawned children, and cleanup() reaps them', () => {
    const fx = PRESENCE_FIXTURES.find((f) => f.name === 'live-exact')!;
    const b = buildPresenceFixture(fx);
    const pid = b.pids['p-live'];
    expect(pid).not.toBe(process.pid);
    expect(() => process.kill(pid, 0)).not.toThrow();
    b.cleanup();
    expect(fs.existsSync(b.root)).toBe(false);
  });
});
