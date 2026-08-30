/**
 * #1162 — classification + tidy for a permanently-dirty primary checkout.
 *
 * Real-git fixtures throughout: the whole point of `classifyPrimary` is
 * translating actual `git status` / `git cat-file` / `git show` output into a
 * REDUNDANT/ORPHAN verdict, so a mock would only restate the mapping we wrote,
 * never prove git answers the way it assumes (same rationale as
 * git-analyzer.test.ts's real-git fixtures).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// Call-through recorder for the Tier-0 no-network test below: every
// `execFileSync` invocation (from THIS file's own `runGit` fixture helper AND
// from `lib/tidy-primary.ts` itself) is appended here, then delegated to the
// real implementation unchanged — real git still runs for every test in this
// file, preserving the "real git fixtures" design above. `vi.hoisted` is
// required (not a plain top-level `const`) because `vi.mock` factories are
// hoisted above ordinary statements; a plain module-scope array read inside
// the factory would risk a temporal-dead-zone reference depending on
// transform/ordering.
const { execFileSyncCalls } = vi.hoisted(() => ({ execFileSyncCalls: [] as unknown[][] }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((...args: unknown[]) => {
      execFileSyncCalls.push(args);
      return (actual.execFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import {
  classifyPrimary,
  tidyRedundantPaths,
  parsePorcelainZ,
  otherLiveSessionsHere,
} from '../src/lib/tidy-primary';
import { SESSIONS_DIR, type SessionPresenceRecord } from '../src/lib/presence';

// ─── Fixture plumbing ────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

function initRepo(dir: string): void {
  runGit(['init', '-b', 'main'], dir);
  runGit(['config', 'user.email', 'test@minspec.test'], dir);
  runGit(['config', 'user.name', 'MinSpec Test'], dir);
  // Point hooksPath at an empty dir so a global RCDD/gitleaks hook never trips
  // these throwaway commits (matches git-analyzer.test.ts's fixture setup).
  const hooks = path.join(dir, '.nohooks');
  fs.mkdirSync(hooks, { recursive: true });
  runGit(['config', 'core.hooksPath', hooks], dir);
}

function write(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function commitAll(dir: string, message: string): void {
  runGit(['add', '-A'], dir);
  runGit(['commit', '-m', message], dir);
}

/**
 * Build the exact scenario from the issue's 2026-07-31 audit: a bare "origin",
 * a primary that pushed `v1`, then a SEPARATE clone that lands `v2` (mimicking
 * a PR merged via a worktree) and pushes it — all while the primary's HEAD
 * stays at `v1`. The caller then dirties the primary's working tree directly,
 * exactly like an extension command writing to the open workspace folder.
 */
function buildLandedElsewhereFixture(): { bare: string; primary: string } {
  // mkdtempSync already yields an empty dir, which `git init --bare` accepts
  // directly (a bare repo's git-dir IS the given directory, no .git subdir).
  const bare = makeTmpDir('minspec-tidy-bare-');
  runGit(['init', '--bare', '-b', 'main'], bare);

  const primary = makeTmpDir('minspec-tidy-primary-');
  initRepo(primary);
  runGit(['remote', 'add', 'origin', bare], primary);
  write(primary, 'a.txt', 'v1\n');
  write(primary, 'd.txt', 'd-v1\n');
  commitAll(primary, 'initial');
  runGit(['push', '-u', 'origin', 'main'], primary);

  // A second, independent clone lands more work and pushes it — the primary
  // never sees this happen locally until (if ever) it fetches.
  const lander = makeTmpDir('minspec-tidy-lander-');
  runGit(['clone', bare, lander], os.tmpdir());
  initRepo(lander); // safe to re-set user.*/hooksPath; doesn't disturb the clone
  write(lander, 'a.txt', 'v2\n'); // a.txt updated upstream
  write(lander, 'b.txt', 'new-upstream\n'); // b.txt added upstream
  write(lander, 'd.txt', 'd-upstream\n'); // d.txt ALSO changed upstream, differently
  commitAll(lander, 'landed via worktree');
  runGit(['push', 'origin', 'main'], lander);

  // The primary fetches (a human/drain action, never something classifyPrimary
  // itself does) so `origin/main` resolves locally to the new tip.
  runGit(['fetch', 'origin'], primary);

  return { bare, primary };
}

// ─── parsePorcelainZ (unit) ──────────────────────────────────────────────────

describe('parsePorcelainZ', () => {
  it('parses plain entries', () => {
    expect(parsePorcelainZ(' M a.txt\0?? b.txt\0')).toEqual(['a.txt', 'b.txt']);
  });

  it('skips the source-path token following a rename/copy entry', () => {
    // `R  new.txt\0old.txt\0` — the second token is old.txt, which must be
    // consumed and dropped, not misread as its own dirty path.
    expect(parsePorcelainZ('R  new.txt\0old.txt\0?? c.txt\0')).toEqual(['new.txt', 'c.txt']);
  });

  it('returns [] for clean output', () => {
    expect(parsePorcelainZ('')).toEqual([]);
  });
});

// ─── classifyPrimary ─────────────────────────────────────────────────────────

describe('classifyPrimary', () => {
  it('returns null for a non-git directory', () => {
    const dir = makeTmpDir('minspec-tidy-notgit-');
    expect(classifyPrimary(dir)).toBeNull();
  });

  it('classifies the audit scenario: redundant edits/adds vs. orphan edits/adds', () => {
    const { primary } = buildLandedElsewhereFixture();

    // REDUNDANT: primary's uncommitted a.txt edit exactly matches origin's v2.
    write(primary, 'a.txt', 'v2\n');
    // REDUNDANT: primary's untracked b.txt exactly matches origin's new file.
    write(primary, 'b.txt', 'new-upstream\n');
    // ORPHAN: untracked, not on origin at all.
    write(primary, 'c.txt', 'my own unlanded work\n');
    // ORPHAN: tracked edit that diverges from origin's own (different) edit.
    write(primary, 'd.txt', 'd-local-divergent\n');

    const result = classifyPrimary(primary);
    expect(result).not.toBeNull();
    expect(result!.onDefaultBranch).toBe(true);
    expect(result!.originRef).toBe('origin/main');
    expect(result!.behind).toBeGreaterThan(0); // primary's HEAD predates the landed commit

    const redundantPaths = result!.redundant.map((c) => c.path).sort();
    const orphanPaths = result!.orphans.map((c) => c.path).sort();
    expect(redundantPaths).toEqual(['a.txt', 'b.txt']);
    expect(orphanPaths).toEqual(['c.txt', 'd.txt']);
  });

  it('classifies a locally-deleted path as REDUNDANT only when origin also lacks it', () => {
    const { primary } = buildLandedElsewhereFixture();
    // e.txt exists in neither HEAD nor origin — deleting a never-tracked file
    // isn't representable via `git rm`, so instead: track e.txt, commit, then
    // delete it locally while a THIRD state (origin) never had it — simulate
    // via a path present in HEAD but absent from origin/main.
    write(primary, 'e.txt', 'local-only, never pushed\n');
    commitAll(primary, 'local-only commit that is ahead of origin');
    fs.unlinkSync(path.join(primary, 'e.txt'));

    const result = classifyPrimary(primary)!;
    const e = result.redundant.find((c) => c.path === 'e.txt') ?? result.orphans.find((c) => c.path === 'e.txt');
    expect(e?.kind).toBe('REDUNDANT'); // deleted locally, absent upstream too ⇒ consistent
    expect(e?.existsLocally).toBe(false);
    expect(e?.existsUpstream).toBe(false);
  });

  it('classifies a locally-deleted path as ORPHAN when origin still has it', () => {
    const { primary } = buildLandedElsewhereFixture();
    fs.unlinkSync(path.join(primary, 'a.txt')); // origin/main HAS a.txt (as v2)

    const result = classifyPrimary(primary)!;
    const a = result.orphans.find((c) => c.path === 'a.txt');
    expect(a?.kind).toBe('ORPHAN');
    expect(a?.existsLocally).toBe(false);
    expect(a?.existsUpstream).toBe(true);
  });

  it('reports off-default-branch and skips classification entirely', () => {
    const { primary } = buildLandedElsewhereFixture();
    runGit(['checkout', '-b', 'feature/x'], primary);
    write(primary, 'a.txt', 'v2\n'); // would be REDUNDANT on main; must be ignored here

    const result = classifyPrimary(primary)!;
    expect(result.note).toBe('off-default-branch');
    expect(result.onDefaultBranch).toBe(false);
    expect(result.redundant).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it('reports missing-origin-ref when nothing was ever fetched', () => {
    const bare = makeTmpDir('minspec-tidy-bare2-');
    runGit(['init', '--bare', '-b', 'main'], bare);
    const primary = makeTmpDir('minspec-tidy-primary2-');
    initRepo(primary);
    runGit(['remote', 'add', 'origin', bare], primary);
    write(primary, 'a.txt', 'v1\n');
    commitAll(primary, 'initial'); // never pushed/fetched ⇒ no origin/main ref locally

    const result = classifyPrimary(primary)!;
    expect(result.note).toBe('missing-origin-ref');
    expect(result.originRef).toBeNull();
  });

  it('never issues a network-shaped git subcommand (Tier-0 offline invariant #1)', () => {
    const { primary } = buildLandedElsewhereFixture();
    // buildLandedElsewhereFixture's own setup runs a legitimate `git fetch`
    // (a human/test-harness action, mirroring what a real user would do
    // before invoking classifyPrimary) — clear the recorder so this
    // assertion covers ONLY classifyPrimary's own git invocations, not the
    // fixture's.
    execFileSyncCalls.length = 0;

    const result = classifyPrimary(primary)!;

    const NETWORK_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote', 'submodule']);
    const gitInvocations = execFileSyncCalls.filter(([cmd]) => cmd === 'git') as [string, string[]][];
    // Sanity: classifyPrimary DID shell out to git — an empty list here would
    // make the loop below vacuously true (passing because nothing ran, not
    // because nothing network-shaped ran).
    expect(gitInvocations.length).toBeGreaterThan(0);
    for (const [, args] of gitInvocations) {
      expect(NETWORK_SUBCOMMANDS.has(args[0])).toBe(false);
    }

    expect(result.originRef).toBe('origin/main');
  });
});

// ─── tidyRedundantPaths ──────────────────────────────────────────────────────

describe('tidyRedundantPaths', () => {
  function dirtyPrimary(): string {
    const { primary } = buildLandedElsewhereFixture();
    write(primary, 'a.txt', 'v2\n'); // tracked, unstaged, REDUNDANT
    write(primary, 'b.txt', 'new-upstream\n'); // untracked, REDUNDANT
    write(primary, 'c.txt', 'my own unlanded work\n'); // untracked, ORPHAN
    write(primary, 'd.txt', 'd-local-divergent\n'); // tracked, ORPHAN
    return primary;
  }

  it('discards only the REDUNDANT paths: checkout for tracked, delete for untracked', () => {
    const primary = dirtyPrimary();
    const result = tidyRedundantPaths(primary, ['a.txt', 'b.txt', 'c.txt', 'd.txt']);

    expect(result.removed.sort()).toEqual(['a.txt', 'b.txt']);
    // c.txt/d.txt were never REDUNDANT — skipped, never touched.
    expect(result.skipped.map((s) => s.path).sort()).toEqual(['c.txt', 'd.txt']);

    // a.txt (tracked) is restored to HEAD's committed content (v1), NOT deleted —
    // the discarded edit's bytes are provably safe on origin, so losing the local
    // uncommitted copy loses nothing.
    expect(fs.readFileSync(path.join(primary, 'a.txt'), 'utf-8')).toBe('v1\n');
    // b.txt (untracked) is gone.
    expect(fs.existsSync(path.join(primary, 'b.txt'))).toBe(false);
    // Orphans are byte-for-byte untouched.
    expect(fs.readFileSync(path.join(primary, 'c.txt'), 'utf-8')).toBe('my own unlanded work\n');
    expect(fs.readFileSync(path.join(primary, 'd.txt'), 'utf-8')).toBe('d-local-divergent\n');
  });

  it('TOCTOU: re-classifies immediately before acting — a path edited after the scan is skipped, not force-discarded', () => {
    const primary = dirtyPrimary();
    // The caller scanned earlier and believes a.txt is REDUNDANT, but between
    // the scan and the click someone made it diverge from origin.
    write(primary, 'a.txt', 'diverged-after-scan\n');

    const result = tidyRedundantPaths(primary, ['a.txt']);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toBe('a.txt');
    // Untouched — never force-discarded just because the caller asked.
    expect(fs.readFileSync(path.join(primary, 'a.txt'), 'utf-8')).toBe('diverged-after-scan\n');
  });

  it('skips a path with staged changes, even if its worktree content is redundant', () => {
    const primary = dirtyPrimary();
    runGit(['add', 'a.txt'], primary); // now staged

    const result = tidyRedundantPaths(primary, ['a.txt']);
    expect(result.removed).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/staged/);
    // Still staged, still v2 — nothing was reset or unstaged.
    expect(runGit(['diff', '--cached', '--name-only'], primary).trim()).toBe('a.txt');
  });

  it('skips a locally-deleted redundant path rather than inventing content', () => {
    const primary = dirtyPrimary();
    write(primary, 'e.txt', 'local-only\n');
    commitAll(primary, 'ahead-of-origin commit');
    fs.unlinkSync(path.join(primary, 'e.txt'));

    const result = tidyRedundantPaths(primary, ['e.txt']);
    expect(result.removed).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ path: 'e.txt' });
    expect(result.skipped[0].reason).toMatch(/deleted/);
  });

  it('returns everything skipped for a non-git directory', () => {
    const dir = makeTmpDir('minspec-tidy-notgit2-');
    const result = tidyRedundantPaths(dir, ['a.txt']);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([{ path: 'a.txt', reason: 'not a git repo' }]);
  });

  it('returns everything skipped when the primary moved off the default branch', () => {
    const primary = dirtyPrimary();
    runGit(['checkout', '-b', 'feature/y'], primary);
    const result = tidyRedundantPaths(primary, ['a.txt']);
    expect(result.removed).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/moved off/);
  });
});

// ─── otherLiveSessionsHere ───────────────────────────────────────────────────

describe('otherLiveSessionsHere', () => {
  function record(over: Partial<SessionPresenceRecord>): SessionPresenceRecord {
    return {
      sessionId: 'sid-' + Math.random().toString(36).slice(2),
      scope: 's',
      project: 'minspec',
      type: 'feat',
      branch: 'main',
      worktreeRoot: '/PLACEHOLDER',
      specIds: [],
      fileAllowlist: [],
      pid: process.pid, // this test process's own pid ⇒ alive
      lastSeen: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      ...over,
    };
  }

  function writeRecord(rootDir: string, rec: SessionPresenceRecord): void {
    const dir = path.join(rootDir, SESSIONS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${rec.sessionId}.session.json`), JSON.stringify(rec), 'utf-8');
  }

  it('is empty when the sessions dir exists but holds no records', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    fs.mkdirSync(path.join(dir, SESSIONS_DIR), { recursive: true });
    expect(otherLiveSessionsHere(dir, dir)).toEqual([]);
  });

  // ── #1714: fail-CLOSED when the witness can't be positively read ──────────
  // otherLiveSessionsHere used to treat "the sessions dir is missing" and "a
  // session record is corrupt" as "confirmed zero peers" (returned `[]`), the
  // opposite fail-direction from presence.ts's isCheckoutOccupied (DR-065 §1),
  // which treats the same conditions as "can't rule out a peer" and refuses.
  // Constitution invariant 2: a missing or errored witness fails the gate
  // CLOSED and visibly — never silently passes.

  it('#1714 cannot confirm when the .minspec/sessions directory does not exist at all', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    // Deliberately never create `.minspec/sessions` — this is the "nobody
    // has ever heartbeated here" state, indistinguishable from "the
    // directory is unreadable": we cannot positively rule out a live peer.
    expect(otherLiveSessionsHere(dir, dir)).toBeNull();
  });

  it('#1714 cannot confirm when a session record is corrupt (unparseable JSON)', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    const sessionsDir = path.join(dir, SESSIONS_DIR);
    fs.mkdirSync(sessionsDir, { recursive: true });
    // A live, otherwise-unambiguous peer in the SAME worktree would normally
    // make this an easy "peers found" case — the corrupt record must still
    // win and force `null`, exactly like isCheckoutOccupied's "a corrupt
    // record blocks all ff (cannot attribute)".
    writeRecord(dir, record({ worktreeRoot: dir }));
    fs.writeFileSync(path.join(sessionsDir, 'junk.session.json'), '{ not valid json', 'utf-8');
    expect(otherLiveSessionsHere(dir, dir)).toBeNull();
  });

  it('#1714 cannot confirm when a session record is malformed (valid JSON, wrong shape)', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    const sessionsDir = path.join(dir, SESSIONS_DIR);
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'malformed.session.json'),
      JSON.stringify({ sessionId: 'x' }), // missing every other required FR-2 field
      'utf-8',
    );
    expect(otherLiveSessionsHere(dir, dir)).toBeNull();
  });

  it('excludes the caller itself by sessionId', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    const self = record({ worktreeRoot: dir });
    writeRecord(dir, self);
    expect(otherLiveSessionsHere(dir, dir, self.sessionId)).toEqual([]);
  });

  it('reports a live peer in the SAME worktree', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    const peer = record({ worktreeRoot: dir });
    writeRecord(dir, peer);
    const others = otherLiveSessionsHere(dir, dir, 'not-the-peer');
    expect(others).not.toBeNull();
    expect(others!.map((r) => r.sessionId)).toEqual([peer.sessionId]);
  });

  it('ignores a live session in a DIFFERENT worktree', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    writeRecord(dir, record({ worktreeRoot: '/some/other/tree' }));
    expect(otherLiveSessionsHere(dir, dir)).toEqual([]);
  });

  it('ignores a stale (dead) record', () => {
    const dir = makeTmpDir('minspec-tidy-presence-');
    writeRecord(
      dir,
      record({ worktreeRoot: dir, lastSeen: new Date(Date.now() - 10 * 60 * 1000).toISOString() }),
    );
    expect(otherLiveSessionsHere(dir, dir)).toEqual([]);
  });
});
