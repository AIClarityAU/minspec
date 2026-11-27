/**
 * SPEC-026 FR-14 - the golden presence fixture set, read by BOTH engines of the
 * contention predicate: the TypeScript `contendingLiveSessions` (presence.ts) and,
 * from task 2 (the bash predicate and its parity test), the pre-commit hook's
 * `minspec_cedit_contenders`. One set, so the two can never be tested against
 * different cases.
 *
 * Each fixture declares the peer records to write, the repo-relative paths a caller
 * asks about, and the exact `(path, sessionId)` contender list `contendingLiveSessions`
 * must return. That list is liveness plus coverage only - no arbitration (FR-13) and
 * no corpus filter. The bash gate additionally drops non-corpus paths (FR-12 P4), so a
 * parity test compares the bash output against `expected` filtered through
 * `isApprovableCorpusPath`; the `nonCorpus` fixture exists to pin that difference.
 *
 * Parity covers FILE paths only. The TS coverage rule also matches an allowlist entry
 * that sits under a directory path; staged paths are always files, so the bash twin
 * does not implement that rule and no fixture exercises it (design.md, *Coverage
 * semantics*).
 *
 * Pids follow tasks.md's shared rule: a LIVE peer's pid is a child process this
 * builder spawned (killed by `cleanup()`), a DEAD peer's pid is one probed to return
 * ESRCH. Never the test runner's own pid, which a bash `kill -0` would also see but
 * which cannot be reaped to prove a dead-pid case.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

import { SESSIONS_DIR, STALE_SECS, type SessionPresenceRecord } from '../../src/lib/presence';

/** One peer record, described relative to the fixture's `now`. */
export interface PeerSpec {
  sessionId: string;
  /** `lastSeen` is this many seconds before `now`. */
  ageSecs: number;
  pid: 'live' | 'dead';
  /** `same` = the queried worktree root; `other` = a different tree. */
  tree: 'same' | 'other';
  fileAllowlist: string[];
}

export interface ExpectedContender {
  path: string;
  sessionId: string;
}

export interface PresenceFixture {
  /** Stable id, used in test titles. */
  name: string;
  /** What the fixture pins, in one line. */
  why: string;
  peers: PeerSpec[];
  /** Also write one unparseable `.session.json` file into the sessions dir. */
  corruptRecord?: boolean;
  /** Repo-relative paths asked about. */
  paths: string[];
  /** Passed as `selfSessionId`; that record must never be its own contender. */
  selfSessionId?: string;
  /** Exact contender set for `contendingLiveSessions` (order-insensitive). */
  expected: ExpectedContender[];
}

const SPEC = 'specs/minspec/SPEC-026-session-presence/requirements.md';
const FRESH = 5; // seconds old: comfortably live

function peer(sessionId: string, over: Partial<PeerSpec> = {}): PeerSpec {
  return { sessionId, ageSecs: FRESH, pid: 'live', tree: 'same', fileAllowlist: [SPEC], ...over };
}

/**
 * The FR-14 golden set. Every row in tasks.md task 1.2 has a fixture: live; stale
 * heartbeat (121 s); the 120 s edge from both sides; dead pid; empty allowlist; same
 * versus different tree; covering versus non-covering path (exact, `dir/`, `dir/*`);
 * a non-corpus path; a corrupt record. Plus self-exclusion and the FR-10 shape (one
 * entry per contended path and peer).
 */
export const PRESENCE_FIXTURES: readonly PresenceFixture[] = Object.freeze([
  {
    name: 'live-exact',
    why: 'a live same-tree peer whose allowlist names the path exactly contends',
    peers: [peer('p-live')],
    paths: [SPEC],
    expected: [{ path: SPEC, sessionId: 'p-live' }],
  },
  {
    name: 'stale-121s',
    why: 'a heartbeat 121 s old is stale even with a live pid',
    peers: [peer('p-stale', { ageSecs: STALE_SECS + 1 })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'edge-120s-stale',
    why: 'a heartbeat exactly STALE_SECS old is stale (the rule is age >= 120 s)',
    peers: [peer('p-edge', { ageSecs: STALE_SECS })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'edge-119s-live',
    why: 'one second inside the stale edge is still live',
    peers: [peer('p-inside', { ageSecs: STALE_SECS - 1 })],
    paths: [SPEC],
    expected: [{ path: SPEC, sessionId: 'p-inside' }],
  },
  {
    name: 'dead-pid',
    why: 'a fresh heartbeat with a dead (ESRCH) pid is not live',
    peers: [peer('p-dead', { pid: 'dead' })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'empty-allowlist',
    why: 'INV-10: a live same-tree peer with an empty allowlist claims nothing',
    peers: [peer('p-empty', { fileAllowlist: [] })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'different-tree',
    why: 'INV-10: a live peer in a different worktree never contends',
    peers: [peer('p-other', { tree: 'other' })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'cover-dir-slash',
    why: 'a `dir/` entry covers every file under it',
    peers: [peer('p-dir', { fileAllowlist: ['specs/minspec/'] })],
    paths: [SPEC],
    expected: [{ path: SPEC, sessionId: 'p-dir' }],
  },
  {
    name: 'cover-dir-glob',
    why: 'a `dir/*` entry covers every file under it',
    peers: [peer('p-glob', { fileAllowlist: ['specs/minspec/*'] })],
    paths: [SPEC],
    expected: [{ path: SPEC, sessionId: 'p-glob' }],
  },
  {
    name: 'non-covering-sibling-prefix',
    why: 'an entry that is a string prefix but not a directory prefix does not cover',
    peers: [peer('p-sib', { fileAllowlist: ['specs/min', 'specs/minspec/SPEC-026-session-presence/req'] })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'non-covering-other-file',
    why: 'an exact entry for a different file does not cover',
    peers: [peer('p-elsewhere', { fileAllowlist: ['specs/minspec/SPEC-027-x/requirements.md'] })],
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'nonCorpus',
    why: 'TS contends on a claimed code path; only the FR-12 gate filters to the corpus',
    peers: [peer('p-code', { fileAllowlist: ['packages/minspec/src/'] })],
    paths: ['packages/minspec/src/lib/presence.ts'],
    expected: [{ path: 'packages/minspec/src/lib/presence.ts', sessionId: 'p-code' }],
  },
  {
    name: 'corrupt-record',
    why: 'a corrupt record is skipped and does not hide a live claimant beside it',
    peers: [peer('p-beside-corrupt')],
    corruptRecord: true,
    paths: [SPEC],
    expected: [{ path: SPEC, sessionId: 'p-beside-corrupt' }],
  },
  {
    name: 'self-excluded',
    why: 'the caller never contends with its own record',
    peers: [peer('p-self')],
    selfSessionId: 'p-self',
    paths: [SPEC],
    expected: [],
  },
  {
    name: 'pairs-shape',
    why: 'FR-10 shape: one entry per contended (path, peer) pair, uncovered paths absent',
    peers: [peer('p-a', { fileAllowlist: ['specs/'] }), peer('p-b', { fileAllowlist: [SPEC] })],
    paths: [SPEC, 'specs/minspec/SPEC-027-x/requirements.md', 'docs/decisions/DR-051.md'],
    expected: [
      { path: SPEC, sessionId: 'p-a' },
      { path: SPEC, sessionId: 'p-b' },
      { path: 'specs/minspec/SPEC-027-x/requirements.md', sessionId: 'p-a' },
    ],
  },
] satisfies PresenceFixture[]);

/** A pid that `kill(pid, 0)` reports as ESRCH right now. */
export function probeDeadPid(): number {
  for (let p = 4_000_000; p < 4_000_200; p++) {
    try {
      process.kill(p, 0);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'ESRCH') return p;
    }
  }
  throw new Error('probeDeadPid: no ESRCH pid found in 4000000..4000199');
}

export interface BuiltFixture {
  /** Temp repo root holding `.minspec/sessions/`; also the "same" worktree root. */
  root: string;
  /** The worktree root to pass as the caller's own tree. */
  worktreeRoot: string;
  /** The clock the records were written against; pass it as `now`. */
  now: number;
  /** sessionId to the pid written into its record. */
  pids: Record<string, number>;
  /** Kills every spawned live pid and removes the temp root. Idempotent. */
  cleanup(): void;
}

/**
 * Write `fx`'s records into a fresh temp `.minspec/sessions/`, spawning one child
 * process per live peer. Call `cleanup()` in `afterEach` (or a `finally`).
 * `now` defaults to the wall clock so a bash reader using `date +%s` agrees; pass a
 * fixed value only for a TS-only test.
 */
export function buildPresenceFixture(fx: PresenceFixture, now: number = Date.now()): BuiltFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `presence-fx-${fx.name}-`));
  const sessionsDir = path.join(root, SESSIONS_DIR);
  fs.mkdirSync(sessionsDir, { recursive: true });
  const otherTree = path.join(root, 'elsewhere-tree');
  const children: ChildProcess[] = [];
  const pids: Record<string, number> = {};
  let cleaned = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const c of children) {
      try {
        c.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  };

  try {
    for (const spec of fx.peers) {
      let pid: number;
      if (spec.pid === 'live') {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
        children.push(child);
        if (child.pid === undefined) throw new Error(`buildPresenceFixture(${fx.name}): spawn gave no pid`);
        pid = child.pid;
      } else {
        pid = probeDeadPid();
      }
      pids[spec.sessionId] = pid;
      const lastSeen = new Date(now - spec.ageSecs * 1000).toISOString();
      const rec: SessionPresenceRecord = {
        sessionId: spec.sessionId,
        scope: `scope of ${spec.sessionId}`,
        project: 'minspec',
        type: 'feat',
        branch: `branch-${spec.sessionId}`,
        worktreeRoot: spec.tree === 'same' ? root : otherTree,
        specIds: [],
        fileAllowlist: spec.fileAllowlist,
        pid,
        lastSeen,
        startedAt: new Date(now - 600_000).toISOString(),
      };
      fs.writeFileSync(path.join(sessionsDir, `${spec.sessionId}.session.json`), JSON.stringify(rec, null, 2) + '\n');
    }
    if (fx.corruptRecord) {
      fs.writeFileSync(path.join(sessionsDir, 'corrupt.session.json'), '{ not valid json');
    }
  } catch (e) {
    cleanup();
    throw e;
  }

  return { root, worktreeRoot: root, now, pids, cleanup };
}
