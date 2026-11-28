import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { queueRequestPath, enqueuePhaseAdvance, listQueuedRequests } from '../src/lib/phase-advance-queue';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-queue-'));
  // SPEC-096: the queue lives in `.minspec/`, so a request is written only in a
  // folder that has opted in. The store used to create that directory itself.
  fs.mkdirSync(path.join(tmp, '.minspec'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('queueRequestPath() — pure function of (rootDir, repo-relative spec path)', () => {
  it('lives under .minspec/queue/ and ends with .json', () => {
    const p = queueRequestPath(tmp, 'specs/minspec/SPEC-007-foo/requirements.md');
    expect(p).toBe(
      path.join(tmp, '.minspec', 'queue', 'specs', 'minspec', 'SPEC-007-foo', 'requirements.md.json'),
    );
  });

  it('the same spec path always yields the same request path (one pending request per spec)', () => {
    const a = queueRequestPath(tmp, 'specs/minspec/SPEC-007-foo/requirements.md');
    const b = queueRequestPath(tmp, 'specs/minspec/SPEC-007-foo/requirements.md');
    expect(a).toBe(b);
  });

  it('two distinct spec paths yield two distinct request paths', () => {
    const a = queueRequestPath(tmp, 'specs/minspec/SPEC-007-foo/requirements.md');
    const b = queueRequestPath(tmp, 'specs/scrooge/SPEC-001-bar/requirements.md');
    expect(a).not.toBe(b);
  });
});

describe('enqueuePhaseAdvance() — LLM-free request write (DR-057 §2 / #733)', () => {
  const SPEC_REL = 'specs/minspec/SPEC-007-foo/requirements.md';

  it('mkdir -ps the nested queue dir and writes a JSON request file', () => {
    enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast');

    const p = queueRequestPath(tmp, SPEC_REL);
    expect(fs.existsSync(p)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(parsed.specPath).toBe(SPEC_REL);
    expect(parsed.source).toBe('alt-a-toast');
    expect(typeof parsed.requestedAt).toBe('string');
    expect(() => new Date(parsed.requestedAt).toISOString()).not.toThrow();
  });

  it('never writes elsewhere in the tree — the request lives ONLY under .minspec/queue/', () => {
    enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast');

    // No LLM invocation, no side files outside .minspec/queue/ (Tier-0 air-gap:
    // this is the ONLY filesystem effect of an enqueue).
    const queueDir = path.join(tmp, '.minspec', 'queue');
    expect(fs.existsSync(queueDir)).toBe(true);
    const entriesOutsideQueue = fs.readdirSync(path.join(tmp, '.minspec')).filter((e) => e !== 'queue');
    expect(entriesOutsideQueue).toEqual([]);
  });

  it('re-enqueuing the same spec overwrites its one request file (idempotent by construction)', () => {
    enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast');
    const p = queueRequestPath(tmp, SPEC_REL);
    const first = JSON.parse(fs.readFileSync(p, 'utf-8'));

    enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast');
    const second = JSON.parse(fs.readFileSync(p, 'utf-8'));

    // Still exactly one request file for this spec — no duplicate/second file.
    expect(fs.readdirSync(path.dirname(p))).toEqual([path.basename(p)]);
    expect(second.specPath).toBe(first.specPath);
  });

  it('normalizes a Windows-style relative path to POSIX in the stored specPath', () => {
    enqueuePhaseAdvance(tmp, 'specs\\minspec\\SPEC-009-bar\\requirements.md', 'alt-a-toast');
    const p = queueRequestPath(tmp, 'specs/minspec/SPEC-009-bar/requirements.md');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(parsed.specPath).toBe('specs/minspec/SPEC-009-bar/requirements.md');
  });

  describe('dedup by spec path + upstream specHash (#731)', () => {
    const read = () => JSON.parse(fs.readFileSync(queueRequestPath(tmp, SPEC_REL), 'utf-8'));

    it('records the upstream hash and reports "enqueued" on first write', () => {
      expect(enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-A')).toBe('enqueued');
      expect(read().upstreamHash).toBe('hash-A');
    });

    it('a request already queued for the same upstream hash is a no-op', () => {
      enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-A');
      const p = queueRequestPath(tmp, SPEC_REL);
      fs.writeFileSync(p, JSON.stringify({ ...read(), requestedAt: 'sentinel' }));
      expect(enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-A')).toBe('duplicate');
      expect(read().requestedAt).toBe('sentinel');
    });

    it('a re-approval after an edit (new hash) replaces the stale request', () => {
      enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-A');
      expect(enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-B')).toBe('enqueued');
      expect(read().upstreamHash).toBe('hash-B');
      expect(fs.readdirSync(path.dirname(queueRequestPath(tmp, SPEC_REL)))).toHaveLength(1);
    });

    it('without a hash nothing is deduped, and a corrupt file is rewritten', () => {
      enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast');
      expect(enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', null)).toBe('enqueued');
      fs.writeFileSync(queueRequestPath(tmp, SPEC_REL), '{not json');
      expect(enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'hash-A')).toBe('enqueued');
      expect(read().upstreamHash).toBe('hash-A');
    });

    it('still refuses in a folder that has not opted in', () => {
      fs.rmSync(path.join(tmp, '.minspec'), { recursive: true });
      expect(() => enqueuePhaseAdvance(tmp, SPEC_REL, 'alt-a-toast', 'h')).toThrow();
      expect(fs.existsSync(path.join(tmp, '.minspec'))).toBe(false);
    });
  });
});

describe('listQueuedRequests() — queue-depth visibility (#737)', () => {
  it('is empty when there is no queue directory, and writes nothing', () => {
    expect(listQueuedRequests(tmp)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, '.minspec', 'queue'))).toBe(false);
  });

  it('lists every enqueued spec, oldest first', () => {
    enqueuePhaseAdvance(tmp, 'specs/a/requirements.md', 'alt-a-toast');
    enqueuePhaseAdvance(tmp, 'specs/b/requirements.md', 'alt-a-toast');
    const older = queueRequestPath(tmp, 'specs/b/requirements.md');
    fs.writeFileSync(
      older,
      JSON.stringify({ specPath: 'specs/b/requirements.md', requestedAt: '2020-01-01T00:00:00.000Z', source: 'alt-a-toast' }),
    );
    const got = listQueuedRequests(tmp);
    expect(got.map((r) => r.specPath)).toEqual(['specs/b/requirements.md', 'specs/a/requirements.md']);
  });

  it('re-enqueuing the same spec keeps depth at one', () => {
    enqueuePhaseAdvance(tmp, 'specs/a/requirements.md', 'alt-a-toast');
    enqueuePhaseAdvance(tmp, 'specs/a/requirements.md', 'alt-a-toast');
    expect(listQueuedRequests(tmp)).toHaveLength(1);
  });

  it('still counts a malformed request file, recovering the spec path from its name', () => {
    const p = queueRequestPath(tmp, 'specs/c/requirements.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{not json');
    expect(listQueuedRequests(tmp)).toEqual([
      { specPath: 'specs/c/requirements.md', requestedAt: undefined },
    ]);
  });
});
