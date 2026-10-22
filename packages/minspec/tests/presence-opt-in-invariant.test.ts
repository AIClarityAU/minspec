/**
 * T0 - constitution invariant 3 applied to the presence heartbeat (#2328).
 *
 * MinSpec's blast radius is the project it is installed in, and the opt-in marker
 * is `.minspec/` at the workspace root. The presence heartbeat starts on every
 * activation, so it is the one writer that runs in folders that never opted in.
 * The property pinned here:
 *
 *   - no `.minspec/` at the root  => presence writes NOTHING there, ever
 *     (not on start, not on a heartbeat tick, not on stop);
 *   - no folder open (root `''`)  => presence writes nothing ANYWHERE, including
 *     the process's working directory, which `path.join('', '.minspec/sessions')`
 *     silently resolves to;
 *   - `.minspec/` already present => exactly the old behaviour.
 *
 * Real temp dirs, no fs mock: the assertion is on the directory listing itself
 * (`readdirSync`), which sees a stray temp file or a differently named directory
 * that an `existsSync('.minspec')` check alone would miss. The opted-in cases are
 * the control - they prove this same manager really does write when it is allowed
 * to, so the "nothing written" cases cannot pass because the writer is simply dead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// resolve-folder reads the live vscode API at call time. No folders, no editor:
// the "extension activated with no folder open" shape.
vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined },
  window: { activeTextEditor: undefined },
}));

import {
  HEARTBEAT_SECS,
  SESSIONS_DIR,
  SessionPresenceManager,
  type SessionPresenceRecord,
} from '../src/lib/presence';
import { resolveTargetFolderNonInteractive } from '../src/lib/resolve-folder';

const TICK_MS = HEARTBEAT_SECS * 1000;

/** Every path under `dir`, relative, sorted - the whole observable write surface. */
function listTree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.join(rel, entry.name);
    out.push(p);
    if (entry.isDirectory()) out.push(...listTree(dir, p));
  }
  return out.sort();
}

function ownFile(root: string, mgr: SessionPresenceManager): string {
  return path.join(root, SESSIONS_DIR, `${mgr.sessionId}.session.json`);
}

/** A pid that is not running, so the record that carries it is prunable. */
function deadPid(): number {
  for (let p = 4_000_000; p < 4_000_050; p++) {
    try {
      process.kill(p, 0);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'ESRCH') return p;
    }
  }
  return 3_999_999;
}

let root: string;
let mgr: SessionPresenceManager | undefined;

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is a symlink, and process.cwd() reports the target.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-opt-in-')));
  mgr = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  try {
    mgr?.stop();
  } finally {
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('presence writes nothing in a folder that never opted in (invariant 3, #2328)', () => {
  it('start, heartbeat ticks and stop leave a folder without .minspec/ byte-for-byte empty', () => {
    expect(listTree(root)).toEqual([]);

    mgr = new SessionPresenceManager(root);
    mgr.start();
    expect(listTree(root)).toEqual([]); // the immediate write on start

    vi.advanceTimersByTime(TICK_MS * 3); // three heartbeat refreshes
    expect(listTree(root)).toEqual([]);

    mgr.stop();
    expect(listTree(root)).toEqual([]);
  });

  it('leaves unrelated content in a non-opted-in folder exactly as it found it', () => {
    fs.writeFileSync(path.join(root, 'README.md'), 'someone else\'s repo\n');
    fs.mkdirSync(path.join(root, 'src'));
    const before = listTree(root);

    mgr = new SessionPresenceManager(root);
    mgr.start();
    vi.advanceTimersByTime(TICK_MS * 2);
    mgr.stop();

    expect(listTree(root)).toEqual(before);
  });

  it('reports no peers and does not throw when the folder is not opted in', () => {
    mgr = new SessionPresenceManager(root);
    mgr.start();
    expect(mgr.getActiveSessions()).toEqual([]);
    expect(listTree(root)).toEqual([]);
  });
});

describe('presence writes nothing when no folder is open (invariant 3, #2328)', () => {
  let savedCwd: string;

  beforeEach(() => {
    // With no folder open the activation root is '', and a relative
    // '.minspec/sessions' lands in the process's working directory. Point that at
    // the temp dir so a stray write is observable (and never lands in this repo).
    savedCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(savedCwd);
  });

  it('activation with no folder resolves to the empty root this guard keys on', () => {
    // The coupling the guard depends on: if the resolver ever returned something
    // other than '' for "no folder", the empty-root check would silently stop
    // covering this case.
    expect(resolveTargetFolderNonInteractive()).toBe('');
  });

  it('creates no .minspec/ in the working directory', () => {
    expect(process.cwd()).toBe(root);

    mgr = new SessionPresenceManager(resolveTargetFolderNonInteractive());
    mgr.start();
    expect(listTree(root)).toEqual([]);
    // No root can ever opt in, so no heartbeat is armed at all - unlike a real
    // but not-yet-opted-in folder, which keeps a timer so a later opt-in is seen.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(TICK_MS * 3);
    expect(listTree(root)).toEqual([]);

    mgr.stop();
    expect(listTree(root)).toEqual([]);
  });

  it('touches nothing even when the working directory is itself a MinSpec project', () => {
    // No folder open means there is no project to act on. That the editor happened
    // to be launched from inside an opted-in project is not an opt-in for THIS
    // window: it must neither add its own record nor prune that project's records.
    const sessions = path.join(root, SESSIONS_DIR);
    fs.mkdirSync(sessions, { recursive: true });
    const stale: SessionPresenceRecord = {
      sessionId: 'dead-peer',
      scope: '',
      project: '',
      type: null,
      branch: '',
      worktreeRoot: root,
      specIds: [],
      fileAllowlist: [],
      pid: deadPid(),
      lastSeen: new Date(0).toISOString(),
      startedAt: new Date(0).toISOString(),
    };
    fs.writeFileSync(path.join(sessions, 'dead-peer.session.json'), JSON.stringify(stale));
    fs.writeFileSync(
      path.join(root, '.minspec', 'session.json'),
      JSON.stringify({ sessionId: 'original-id', scope: 's', project: 'p', type: 'feat' }),
    );
    const before = listTree(root);
    const sessionJsonBefore = fs.readFileSync(path.join(root, '.minspec', 'session.json'), 'utf-8');

    mgr = new SessionPresenceManager('');
    mgr.start();
    vi.advanceTimersByTime(TICK_MS * 3);
    expect(mgr.getActiveSessions()).toEqual([]);
    mgr.stop();

    expect(listTree(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root, '.minspec', 'session.json'), 'utf-8')).toBe(
      sessionJsonBefore,
    );
  });
});

describe('presence in an opted-in folder behaves as before (control)', () => {
  it('writes its record immediately when .minspec/ exists but sessions/ does not yet', () => {
    fs.mkdirSync(path.join(root, '.minspec'));

    mgr = new SessionPresenceManager(root);
    mgr.start();

    const file = ownFile(root, mgr);
    expect(fs.existsSync(file)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionPresenceRecord;
    expect(rec.sessionId).toBe(mgr.sessionId);
    expect(rec.pid).toBe(process.pid);
    // Exactly one directory and one record: no temp file left behind.
    expect(listTree(root)).toEqual([
      '.minspec',
      path.join('.minspec', 'sessions'),
      path.join(SESSIONS_DIR, `${mgr.sessionId}.session.json`),
    ]);
  });

  it('refreshes lastSeen on the heartbeat tick and removes its record on stop', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    mgr = new SessionPresenceManager(root);
    mgr.start();
    const file = ownFile(root, mgr);
    const first = (JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionPresenceRecord).lastSeen;

    vi.advanceTimersByTime(TICK_MS);
    const second = (JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionPresenceRecord).lastSeen;
    expect(Date.parse(second) - Date.parse(first)).toBe(TICK_MS);

    mgr.stop();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('starts heartbeating on the next tick once a folder opts in after activation', () => {
    mgr = new SessionPresenceManager(root);
    mgr.start();
    expect(listTree(root)).toEqual([]);

    fs.mkdirSync(path.join(root, '.minspec')); // the user runs MinSpec: Initialize
    expect(fs.existsSync(ownFile(root, mgr))).toBe(false); // not before the tick

    vi.advanceTimersByTime(TICK_MS);
    expect(fs.existsSync(ownFile(root, mgr))).toBe(true);
  });

  it('never recreates .minspec/ if it disappears while the session is live', () => {
    fs.mkdirSync(path.join(root, '.minspec'));
    mgr = new SessionPresenceManager(root);
    mgr.start();
    expect(fs.existsSync(ownFile(root, mgr))).toBe(true);

    fs.rmSync(path.join(root, '.minspec'), { recursive: true, force: true }); // opt-out
    vi.advanceTimersByTime(TICK_MS * 2);
    mgr.stop();

    expect(listTree(root)).toEqual([]);
  });
});
