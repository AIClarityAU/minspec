import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  hashContent,
  hashSpecFile,
  resolveStatus,
  approveSpec,
  revokeApproval,
  getApprovalStatus,
  loadApprovals,
} from '../src/lib/approval';
import { setSpecStatus, parseSpec } from '../src/lib/spec';

let tmp: string;
let specPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approval-'));
  fs.mkdirSync(path.join(tmp, 'specs'));
  specPath = path.join(tmp, 'specs', 'SPEC-007-thing.md');
  fs.writeFileSync(specPath, '---\nid: SPEC-007\ntier: T3\n---\n# Thing\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('hashContent — matches sha256sum', () => {
  it('Node crypto agrees with the shell sha256sum the gate hook uses', () => {
    const nodeHash = hashSpecFile(specPath);
    let shellHash: string;
    try {
      shellHash = execFileSync('sha256sum', [specPath]).toString().split(/\s+/)[0];
    } catch {
      return; // sha256sum unavailable on this platform — skip cross-check
    }
    expect(nodeHash).toBe(shellHash);
  });

  it('is stable for identical bytes and differs on change', () => {
    const a = hashContent('hello');
    const b = hashContent('hello');
    const c = hashContent('hello!');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('resolveStatus — pure', () => {
  it('unapproved when no record', () => {
    expect(resolveStatus(undefined, 'abc')).toBe('unapproved');
  });
  it('approved when hash matches', () => {
    expect(resolveStatus({ specHash: 'abc', approvedAt: 't', tier: 'T3' }, 'abc')).toBe('approved');
  });
  it('stale when hash differs', () => {
    expect(resolveStatus({ specHash: 'abc', approvedAt: 't', tier: 'T3' }, 'xyz')).toBe('stale');
  });
  it('unapproved when file unreadable (null hash)', () => {
    expect(resolveStatus({ specHash: 'abc', approvedAt: 't', tier: 'T3' }, null)).toBe('unapproved');
  });
});

describe('approve / revoke lifecycle', () => {
  it('approveSpec then getApprovalStatus = approved', () => {
    approveSpec(tmp, 'SPEC-007', specPath, 'T3', () => new Date('2026-05-30T00:00:00Z'));
    expect(getApprovalStatus(tmp, 'SPEC-007', specPath)).toBe('approved');
    const store = loadApprovals(tmp);
    expect(store['SPEC-007'].tier).toBe('T3');
    expect(store['SPEC-007'].approvedAt).toBe('2026-05-30T00:00:00.000Z');
  });

  it('editing the spec after approval makes it stale', () => {
    approveSpec(tmp, 'SPEC-007', specPath, 'T3');
    fs.appendFileSync(specPath, '\nmore content\n');
    expect(getApprovalStatus(tmp, 'SPEC-007', specPath)).toBe('stale');
  });

  it('revokeApproval removes the record', () => {
    approveSpec(tmp, 'SPEC-007', specPath, 'T3');
    expect(revokeApproval(tmp, 'SPEC-007')).toBe(true);
    expect(getApprovalStatus(tmp, 'SPEC-007', specPath)).toBe('unapproved');
    expect(revokeApproval(tmp, 'SPEC-007')).toBe(false);
  });

  it('approvals.json survives a malformed file (returns empty)', () => {
    fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.minspec', 'approvals.json'), '{ not json');
    expect(loadApprovals(tmp)).toEqual({});
  });
});

// Regression (T3) — DR-003 RCDD. Approval must flip the spec's `status:` line to
// `implementing` AND remain non-stale. The trap: flipping status mutates the file
// bytes, so the hash MUST be recorded AFTER the flip (flip-then-hash). If the order
// is reversed, the just-approved spec is instantly stale. This test pins the order.
describe('approval flips status and stays approved (flip-then-hash ordering)', () => {
  const SPECIFYING = '---\nid: SPEC-007\nstatus: specifying\ntier: T3\n---\n# Thing\n';

  beforeEach(() => fs.writeFileSync(specPath, SPECIFYING));

  it('flip-then-hash → status implementing AND approval is approved (not stale)', () => {
    // Replicates approveSpecCommand's order: write status first, then hash.
    setSpecStatus(specPath, 'implementing');
    approveSpec(tmp, 'SPEC-007', specPath, 'T3');

    expect(parseSpec(fs.readFileSync(specPath, 'utf-8')).frontmatter.status).toBe('implementing');
    expect(getApprovalStatus(tmp, 'SPEC-007', specPath)).toBe('approved');
  });

  it('hash-then-flip is the bug: recording before the flip leaves it stale', () => {
    // The wrong order — guards against a future refactor reintroducing it.
    approveSpec(tmp, 'SPEC-007', specPath, 'T3');
    setSpecStatus(specPath, 'implementing');
    expect(getApprovalStatus(tmp, 'SPEC-007', specPath)).toBe('stale');
  });
});
