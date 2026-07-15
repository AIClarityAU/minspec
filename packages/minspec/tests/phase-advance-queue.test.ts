import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { queueRequestPath, enqueuePhaseAdvance } from '../src/lib/phase-advance-queue';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-queue-'));
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
});
