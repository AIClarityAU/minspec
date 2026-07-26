/**
 * SPEC-026 Layer 1 — Session Presence (FR-1..7) + the sync-gate primitive.
 *
 * A lightweight, file-based heartbeat: each live extension-host activation writes
 * one `.minspec/sessions/<uuid>.session.json` record and refreshes it every 30s.
 * Other sessions read the directory to know who else is live (FR-4/FR-5), and the
 * drain's gated fast-forward (`scripts/drain-inbox.sh sync_shared_checkouts`) keys
 * on `isCheckoutOccupied` to decide whether a checkout is safe to advance.
 *
 * Tier-0 / offline (INV-5): this module imports ONLY `fs`, `path`, `crypto`,
 * `child_process` (git, local) and the `vscode` TYPE (compile-time only). It makes
 * zero network calls. The Tier-0 import-ban gate (tier0-import-ban.test.ts) forbids
 * http/https/fetch/net — none appear here.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
// TYPE-ONLY import: no vscode runtime is pulled in, so presence.ts stays a pure
// Tier-0 module that unit tests (and the bash-parity harness) can import without a
// vscode mock. `onDidChange` is still a genuine `vscode.Event<number>`.
import type * as vscode from 'vscode';

import { loadSession, saveSession, type SessionType } from './session';

// ── Paired named constants (FR-3) — the ONE place these numbers live in TS ──────
// STALE_SECS = 4 × HEARTBEAT_SECS. They are PAIRED: drift one without the other and
// you either prune a live session or surface a dead one. The bash reader in
// scripts/drain-inbox.sh duplicates these (PRESENCE_HEARTBEAT_SECS /
// PRESENCE_STALE_SECS) with a tie-back comment; a golden-fixture parity test
// (SPEC-026 FR-14 family) fails on drift.
export const HEARTBEAT_SECS = 30;
export const STALE_SECS = 120; // = 4 × HEARTBEAT_SECS (paired)
export const SESSIONS_DIR = '.minspec/sessions';
/** FR-11 frozen contract: the commit trailer key a shell agent self-identifies with. */
export const SESSION_TRAILER_KEY = 'MinSpec-Session';

/**
 * SPEC-026 FR-2 presence record. All fields required. `worktreeRoot` is the
 * sync-gate discriminator (same working tree ⇒ same `git rev-parse --show-toplevel`).
 */
export interface SessionPresenceRecord {
  sessionId: string;
  scope: string;
  project: string;
  type: SessionType | null;
  branch: string;
  worktreeRoot: string;
  specIds: string[];
  fileAllowlist: string[];
  pid: number;
  lastSeen: string; // ISO-8601 UTC
  startedAt: string; // fixed-width ISO-8601 UTC, ms precision (lexical == chronological)
}

/**
 * Canonical fixed-width ISO-8601 UTC with millisecond precision, so lexical order
 * equals chronological order — the FR-13 arbitration key. `Date.toISOString()`
 * already emits `YYYY-MM-DDTHH:mm:ss.sssZ`.
 */
export function isoMs(d: Date): string {
  return d.toISOString();
}

// ── Pure liveness (FR-4), mirrored byte-for-byte by the bash reader ─────────────

/**
 * FR-4.2 — is `pid` a live process on THIS machine? `process.kill(pid, 0)` sends no
 * signal, it only probes existence/permission. ESRCH ⇒ gone (dead); EPERM ⇒ exists
 * but owned by another user (alive). Any other error ⇒ treat as dead.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * FR-4 — a record is LIVE iff its heartbeat is fresh (< STALE_SECS old) AND its pid
 * is alive. An unparseable/absent `lastSeen` ⇒ dead. This is the single liveness
 * notion reused unchanged by the sync gate.
 */
export function isRecordLive(r: SessionPresenceRecord, now = Date.now()): boolean {
  const seen = Date.parse(r.lastSeen);
  if (!Number.isFinite(seen)) return false; // unparseable ⇒ dead
  if (now - seen >= STALE_SECS * 1000) return false; // stale heartbeat ⇒ dead
  return pidAlive(r.pid);
}

// ── THE WORK-ITEM CLAIM LEASE (SPEC-044 / DR-067) — Tier-0 primitive naming ──────
//
// The presence heartbeat above IS an expiring lease: a record is *held* while it is
// renewed within a TTL and its owner is alive, and a reaper reclaims the stale ones
// (getActiveSessions prunes on read). DR-065 gave that lease a second consumer (the
// sync gate). SPEC-044 gives it a THIRD — the work-item claim: "session S owns issue
// / PR N right now" is exactly a lease over a work item, arbitrated under contention
// and reclaimed on expiry.
//
// This section names that primitive in the offline core WITHOUT adding any network:
// the *semantics* (a renewed-within-TTL liveness predicate + a deterministic winner)
// live here as pure functions; every networked consumer — posting a GitHub claim,
// polling, merging, pushing — plus the local flock/worktree machinery lives in the
// Tier-1 `scripts/` layer (`scripts/lib/issue-lease.sh`), NEVER in this module
// (INV-3 / constitution invariant #1; the tier0-import-ban gate keeps it honest).
//
// Only the LIVENESS predicate (`isClaimLive`) is mirrored byte-for-byte by the Tier-1
// bash reader (`issue-lease.sh --is-live`) — the FR-10 parity gate, the DR-065 §4
// discipline extended to a third reader. The WINNER function (`pickClaimWinner`) is
// deliberately OUTSIDE that byte-parity: it is substrate-specific (it keys on the
// GitHub-assigned monotonic `serverOrder`, whereas presence arbitrates on `startedAt`
// and exports no winner at all), so it carries its OWN test, not a cross-reader
// byte-comparison (D2/FR-2/AC-9).

// Paired work-item lease constants (SPEC-044 D10 / OQ-2). DISTINCT from the presence
// heartbeat (HEARTBEAT_SECS=30 / STALE_SECS=120): a build/shepherd runs many minutes,
// so the work-item claim carries its OWN, longer TTL, renewed on a wall-clock timer
// independent of build progress. PAIRED as LEASE_TTL_SECS = 4 × LEASE_RENEW_SECS,
// mirroring the STALE = 4 × HEARTBEAT discipline. LEASE_TTL_SECS is the ONE value
// parity-shared with the bash reader (`scripts/lib/issue-lease.sh` LEASE_TTL_SECS) —
// change BOTH or neither; the FR-10 liveness-parity test fails on drift. The absolute
// max-claim-lifetime ceiling (FR-12) is claim-specific and lives ONLY in the Tier-1
// bash layer — it is NOT part of this core liveness predicate nor the parity set.
export const LEASE_RENEW_SECS = 60;
export const LEASE_TTL_SECS = 240; // = 4 × LEASE_RENEW_SECS (paired); mirrored by issue-lease.sh

/**
 * SPEC-044 work-item claim record. The soft-claim payload a session posts to a work
 * item (issue/PR). `serverOrder` is the GitHub-assigned monotonic comment/record id —
 * the strict total order a label cannot give, and the winner key (FR-2). `claimedAt`
 * is carried as metadata only and is NEVER a deciding key (cross-machine clock skew).
 */
export interface WorkItemClaim {
  sessionId: string;
  host: string;
  worktreeRoot: string;
  pid: number;
  claimedAt: string; // ISO-8601 UTC — METADATA only, never an arbitration key
  lastRenewed: string; // ISO-8601 UTC — the heartbeat that TTL freshness is measured against
  serverOrder: number; // server-assigned monotonic id — the winner key (FR-2)
}

/**
 * FR-8 / D3 — a work-item claim is LIVE iff its heartbeat (`lastRenewed`) is within
 * LEASE_TTL_SECS AND (foreign-host OR pid alive). Same machine: `lastRenewed` fresh
 * AND `process.kill(pid,0)` alive — the isRecordLive shape. Foreign host: TTL ALONE
 * (a foreign pid is unobservable, so a foreign claim degrades to the safe side — an
 * un-renewed foreign claim expires and becomes reclaimable). `sameMachine` is DECIDED
 * BY THE CALLER (a local os.hostname() comparison) and PASSED IN — core never resolves
 * a host, so "same host?" never reaches for the network (D7/INV-3).
 *
 * This is the ONE predicate the Tier-1 bash readers mirror byte-for-byte (FR-10). The
 * absolute-max-lifetime ceiling (FR-12) is a Tier-1-only addition and is deliberately
 * NOT applied here, so this stays exactly the liveness half the parity gate compares.
 */
export function isClaimLive(c: WorkItemClaim, now: number, sameMachine: boolean): boolean {
  const renewed = Date.parse(c.lastRenewed);
  if (!Number.isFinite(renewed)) return false; // unparseable heartbeat ⇒ dead
  if (now - renewed >= LEASE_TTL_SECS * 1000) return false; // stale heartbeat ⇒ dead
  if (sameMachine && !pidAlive(c.pid)) return false; // same-machine dead pid ⇒ dead
  return true; // foreign host ⇒ judged by TTL alone (safe degrade)
}

/**
 * FR-2 / D2 — the deterministic winner among the LIVE claims: earliest `serverOrder`,
 * with `sessionId` as the final tiebreak for the degenerate equal-id case. `claimedAt`
 * is NEVER a deciding key. Returns null when no claim is live.
 *
 * Liveness here is the cross-machine-safe degrade — TTL freshness ALONE (no pid, no
 * host): the winner ARBITRATION does not need the same-machine pid refinement (that is
 * a liveness detail the operational classify-claim seam applies), and keeping it
 * host/pid-free lets this be a pure function of the records + clock. SUBSTRATE-SPECIFIC
 * (keys on serverOrder) and pure — it has its OWN test (AC-9), deliberately NOT in the
 * byte-parity set (presence exports no winner and keys arbitration on startedAt).
 */
export function pickClaimWinner(claims: WorkItemClaim[], now: number): WorkItemClaim | null {
  const live = claims.filter((c) => {
    const renewed = Date.parse(c.lastRenewed);
    return Number.isFinite(renewed) && now - renewed < LEASE_TTL_SECS * 1000;
  });
  if (live.length === 0) return null;
  live.sort((a, b) => {
    if (a.serverOrder !== b.serverOrder) return a.serverOrder - b.serverOrder;
    // Deterministic tiebreak for the degenerate equal-serverOrder case only.
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
  return live[0];
}

/**
 * Read every `*.session.json` in `<rootDir>/.minspec/sessions/`. Each entry is
 * `{ rec, file }`; a corrupt/unparseable file yields `{ rec: null, file }` (a prune
 * candidate that the sync gate treats as "occupied"). A missing directory ⇒ `[]`.
 */
export function readAllRecords(
  rootDir: string,
): { rec: SessionPresenceRecord | null; file: string }[] {
  const dir = path.join(rootDir, SESSIONS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir) as unknown as string[];
  } catch {
    return []; // missing dir (or unreadable) ⇒ no records
  }
  if (!Array.isArray(names)) return []; // defensive (e.g. a stubbed fs in tests)
  const out: { rec: SessionPresenceRecord | null; file: string }[] = [];
  for (const name of names) {
    if (!name.endsWith('.session.json')) continue;
    const file = path.join(dir, name);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      out.push({ rec: null, file }); // unreadable ⇒ prune candidate
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      out.push({ rec: null, file }); // corrupt ⇒ prune candidate
      continue;
    }
    if (isValidRecord(parsed)) {
      out.push({ rec: parsed, file });
    } else {
      out.push({ rec: null, file }); // malformed shape ⇒ prune candidate
    }
  }
  return out;
}

/** Structural validation of a parsed record — every FR-2 field present + typed. */
function isValidRecord(v: unknown): v is SessionPresenceRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.scope === 'string' &&
    typeof r.project === 'string' &&
    (typeof r.type === 'string' || r.type === null) &&
    typeof r.branch === 'string' &&
    typeof r.worktreeRoot === 'string' &&
    Array.isArray(r.specIds) &&
    Array.isArray(r.fileAllowlist) &&
    typeof r.pid === 'number' &&
    typeof r.lastSeen === 'string' &&
    typeof r.startedAt === 'string'
  );
}

// ── THE SYNC-GATE PRIMITIVE (FR-9 family / #168 / DR-051 §4a) ────────────────────

/**
 * Every worktree root the primary's repo tracks, so the sync gate can read EACH
 * worktree's OWN `.minspec/sessions/` (that is where `SessionPresenceManager`
 * writes — `sessionsDir` is `<this worktree>/.minspec/sessions`, NOT the primary's;
 * see `writeHeartbeat`). Reading only the primary's dir would render a live session
 * in a linked on-`main` worktree invisible and let the gate ff a live tree (PR #846).
 *
 * Enumerated via `git worktree list --porcelain` run FROM `primaryRoot` (the same
 * allowlisted `child_process`/git seam the manager already uses). ALWAYS includes
 * `primaryRoot` itself; dedups by `path.resolve`. On ANY git failure (not a repo,
 * git absent, detached) falls back to `[resolve(primaryRoot)]` so single-root
 * callers and the golden-fixture parity tests keep their exact prior behaviour.
 */
export function listWorktreeRoots(primaryRoot: string): string[] {
  const roots = new Set<string>([path.resolve(primaryRoot)]);
  const out = gitOut(primaryRoot, ['worktree', 'list', '--porcelain']);
  if (out) {
    for (const line of out.split('\n')) {
      // Porcelain: each worktree block opens with `worktree <absolute-path>`.
      if (line.startsWith('worktree ')) {
        const p = line.slice('worktree '.length).trim();
        if (p) roots.add(path.resolve(p));
      }
    }
  }
  return [...roots];
}

/**
 * TRUE = occupied ⇒ caller must NOT fast-forward (fetch-only). FALSE is returned
 * ONLY on POSITIVE proof of dormancy, which requires BOTH:
 *   (a) presence is demonstrably running — ≥1 LIVE record exists ANYWHERE (across
 *       EVERY worktree's own `.minspec/sessions/`; an empty / all-stale / all-corrupt
 *       set is indistinguishable from "heartbeat not running" ⇒ occupied), AND
 *   (b) NO live record's worktreeRoot resolves to this checkout.
 *
 * Both conditions scan EVERY worktree's own sessions dir (via `listWorktreeRoots`),
 * because each session writes into its OWN worktree — a primary-only read misses a
 * live sibling and is the PR #846 corruption hole.
 *
 * FAIL-SAFE: any missing dir / read / parse / kill error ⇒ TRUE (occupied). This is
 * the OPPOSITE fail-direction from the FR-12 pre-commit backstop (which fails
 * OPEN/allow) — a false "unoccupied" mutates a live tree (unrecoverable), whereas a
 * false "occupied" only skips an ff (harmless, retried).
 */
export function isCheckoutOccupied(rootDir: string, worktreeRoot: string, now = Date.now()): boolean {
  let entries: { rec: SessionPresenceRecord | null; file: string }[];
  try {
    entries = [];
    for (const root of listWorktreeRoots(rootDir)) {
      entries.push(...readAllRecords(root)); // aggregate every worktree's OWN dir
    }
  } catch {
    return true; // any read error ⇒ occupied
  }
  const live: SessionPresenceRecord[] = [];
  for (const { rec } of entries) {
    if (!rec) return true; // corrupt/malformed ANYWHERE ⇒ can't attribute ⇒ occupied
    try {
      if (isRecordLive(rec, now)) live.push(rec);
    } catch {
      return true; // kill/parse error ⇒ occupied
    }
  }
  if (live.length === 0) return true; // no demonstrable live session ⇒ occupied
  const target = path.resolve(worktreeRoot);
  return live.some((r) => path.resolve(r.worktreeRoot) === target);
}

/**
 * FR-10 guard predicate — the live same-tree peers whose `fileAllowlist` overlaps
 * `paths` (repo-relative). Shares the FR-4 liveness core with the sync gate, so both
 * live here. Callers pass the paths about to be edited; a non-empty result is a
 * contention advisory. A peer with an empty allowlist, or a different worktreeRoot,
 * is never a contender (INV-10). `selfSessionId` (optional) excludes the caller.
 */
export function contendingLiveSessions(
  rootDir: string,
  worktreeRoot: string,
  paths: string[],
  selfSessionId?: string,
  now = Date.now(),
): SessionPresenceRecord[] {
  const target = path.resolve(worktreeRoot);
  const out: SessionPresenceRecord[] = [];
  for (const { rec } of readAllRecords(rootDir)) {
    if (!rec) continue;
    if (selfSessionId && rec.sessionId === selfSessionId) continue;
    if (!isRecordLive(rec, now)) continue;
    if (path.resolve(rec.worktreeRoot) !== target) continue; // different tree ⇒ not a contender
    if (rec.fileAllowlist.length === 0) continue; // empty allowlist ⇒ not a contender
    if (paths.some((p) => isPathClaimed(rec.fileAllowlist, p))) out.push(rec);
  }
  return out;
}

/** True if repo-relative `p` is covered by any allowlist entry (exact / dir-prefix). */
function isPathClaimed(allowlist: string[], p: string): boolean {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  for (const raw of allowlist) {
    // Normalize: unify separators, drop a trailing `/*` glob, drop trailing slashes.
    const a = raw.replace(/\\/g, '/').replace(/\/\*$/, '').replace(/\/+$/, '');
    if (a === '') continue;
    if (norm === a) return true;
    if (norm.startsWith(a + '/')) return true;
    if (a.startsWith(norm + '/')) return true; // the entry sits under the edited dir
  }
  return false;
}

// ── FR-3/4/5/6/7 manager surface ───────────────────────────────────────────────

interface EmitterLike {
  readonly event: vscode.Event<number>;
  fire(count: number): void;
  dispose(): void;
}

/**
 * Minimal event emitter satisfying the `vscode.Event<number>` shape, implemented
 * without a vscode runtime import (keeps presence.ts Tier-0-pure and mock-free in
 * tests). A listener throwing never breaks a fire.
 */
class CountEmitter implements EmitterLike {
  private readonly listeners = new Set<(count: number) => unknown>();
  readonly event: vscode.Event<number> = (listener, thisArgs?, disposables?) => {
    const bound = thisArgs ? listener.bind(thisArgs) : listener;
    this.listeners.add(bound);
    const disposable = {
      dispose: () => {
        this.listeners.delete(bound);
      },
    };
    if (Array.isArray(disposables)) disposables.push(disposable);
    return disposable;
  };
  fire(count: number): void {
    for (const l of [...this.listeners]) {
      try {
        l(count);
      } catch {
        /* a listener must never break the fire loop */
      }
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

/** Best-effort git query in `rootDir`; '' on any failure (not a repo, detached, …). */
function gitOut(rootDir: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * SPEC-026 FR-3..7 — owns this activation's presence file: writes it immediately,
 * refreshes every HEARTBEAT_SECS, watches the directory for peers, and prunes dead
 * records on read. Construct once per `activate()`, `start()` on activation,
 * `stop()` on deactivate.
 */
export class SessionPresenceManager {
  readonly sessionId = randomUUID();
  private readonly startedAt = isoMs(new Date());
  private readonly rootDir: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private watcher: fs.FSWatcher | undefined;
  private watchDebounce: ReturnType<typeof setTimeout> | undefined;
  private lastCount = -1;
  private readonly emitter = new CountEmitter();

  /** FR-5 — fires with the current OTHER-session count whenever it changes. */
  readonly onDidChange: vscode.Event<number> = this.emitter.event;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private get sessionsDir(): string {
    return path.join(this.rootDir, SESSIONS_DIR);
  }

  private get ownFile(): string {
    return path.join(this.sessionsDir, `${this.sessionId}.session.json`);
  }

  /** FR-3 — write the record immediately, then start the heartbeat + watcher. */
  start(): void {
    // 1. Persist sessionId into the singular .minspec/session.json so a shell
    //    agent's trailer + $MINSPEC_SESSION_ID resolve identically (FR-11).
    try {
      const s = loadSession(this.rootDir);
      if (s && s.sessionId !== this.sessionId) {
        saveSession(this.rootDir, { ...s, sessionId: this.sessionId });
      }
    } catch {
      /* best-effort — a missing/invalid session.json must not break activation */
    }
    // 2. Write the presence file immediately (before the interval) to shrink the
    //    live-but-unrecorded window to the activation instant.
    this.writeHeartbeat();
    // 3. Heartbeat interval — re-derive dynamic fields from the CURRENT session.json.
    //    unref() so the timer never keeps the process (or a test runner) alive.
    this.timer = setInterval(() => {
      this.writeHeartbeat();
      this.maybeFireCount();
    }, HEARTBEAT_SECS * 1000);
    this.timer.unref?.();
    // 4. fs.watch for low-latency peer detection (FR-7); fall back to the 30s poll
    //    if it throws (tmpfs quirks on some CI runners).
    try {
      this.watcher = fs.watch(this.sessionsDir, () => {
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => this.maybeFireCount(), 250);
        this.watchDebounce.unref?.();
      });
    } catch {
      this.watcher = undefined; // FR-7 fallback: heartbeat poll drives maybeFireCount
    }
    this.maybeFireCount();
  }

  /** VS Code Disposable alias so the manager can be pushed to `context.subscriptions`. */
  dispose(): void {
    this.stop();
  }

  /**
   * FR-6 — clear the interval, close the watcher, best-effort remove the own file.
   * NEVER throws (deactivate must be synchronous and cannot throw).
   */
  stop(): void {
    try {
      if (this.timer) clearInterval(this.timer);
    } catch {
      /* swallow */
    }
    this.timer = undefined;
    try {
      if (this.watchDebounce) clearTimeout(this.watchDebounce);
    } catch {
      /* swallow */
    }
    this.watchDebounce = undefined;
    try {
      this.watcher?.close();
    } catch {
      /* swallow */
    }
    this.watcher = undefined;
    try {
      fs.unlinkSync(this.ownFile);
    } catch {
      /* crash/SIGKILL leaves the file; FR-4's 120s + kill-0 evict it */
    }
    try {
      this.emitter.dispose();
    } catch {
      /* swallow */
    }
  }

  /**
   * FR-4 — prune dead records (best-effort unlink), exclude self, return the OTHER
   * live sessions. Never throws.
   */
  getActiveSessions(now = Date.now()): SessionPresenceRecord[] {
    const out: SessionPresenceRecord[] = [];
    for (const { rec, file } of readAllRecords(this.rootDir)) {
      let dead: boolean;
      try {
        dead = !rec || !isRecordLive(rec, now);
      } catch {
        dead = true;
      }
      if (dead) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* best-effort prune — must never crash the caller */
        }
        continue;
      }
      if (rec!.sessionId === this.sessionId) continue; // exclude self
      out.push(rec!);
    }
    return out;
  }

  /** Atomic heartbeat write (temp + rename) so a reader never sees a half-written record. */
  private writeHeartbeat(): void {
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    } catch {
      return; // can't create the dir ⇒ nothing to write (best-effort)
    }
    const s = loadSession(this.rootDir);
    const record: SessionPresenceRecord = {
      sessionId: this.sessionId,
      scope: s?.scope ?? '',
      project: s?.project ?? '',
      type: s?.type ?? null,
      branch: gitOut(this.rootDir, ['branch', '--show-current']),
      worktreeRoot: gitOut(this.rootDir, ['rev-parse', '--show-toplevel']) || path.resolve(this.rootDir),
      specIds: s?.specIds ?? [],
      fileAllowlist: s?.fileAllowlist ?? [],
      pid: process.pid,
      lastSeen: isoMs(new Date()),
      startedAt: this.startedAt,
    };
    const tmp = path.join(this.sessionsDir, `${this.sessionId}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmp, this.ownFile);
    } catch {
      // best-effort — a failed heartbeat just means this session looks stale to
      // peers until the next tick; try to clean up the temp file.
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* swallow */
      }
    }
  }

  /** Fire onDidChange only when the OTHER-session count actually changed (FR-5). */
  private maybeFireCount(): void {
    let count: number;
    try {
      count = this.getActiveSessions().length;
    } catch {
      return;
    }
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.emitter.fire(count);
    }
  }
}
