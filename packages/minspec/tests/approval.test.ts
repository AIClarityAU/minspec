import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  resolveStatus,
  approveSpec,
  revokeApproval,
  getApprovalStatus,
  getApprovalRecord,
  canonicalSpecHash,
  gitConfigEmail,
  specRelPath,
  type ApprovalRecord,
} from '../src/lib/approval';
import { readRecord } from '../src/lib/approval-store';
import { setSpecStatus, parseSpec } from '../src/lib/spec';
import { specHash } from '@aiclarity/shared';

let tmp: string;
let specPath: string;
const SPEC_REL = 'specs/SPEC-007-thing.md';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approval-'));
  fs.mkdirSync(path.join(tmp, 'specs'));
  specPath = path.join(tmp, 'specs', 'SPEC-007-thing.md');
  fs.writeFileSync(specPath, '---\nid: SPEC-007\ntier: T3\nstatus: specifying\n---\n# Thing\n');
  // Give the tmp repo a git identity so gitConfigEmail returns a real value.
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: tmp });
  } catch {
    // git absent — gitConfigEmail degrades to 'unknown', asserted separately.
  }
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function record(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    specPath: SPEC_REL,
    specHash: 'abc',
    approvedAt: 't',
    approvedBy: 'paul@harvest316.com',
    tier: 'T3',
    migrated: false,
    ...overrides,
  };
}

describe('canonicalSpecHash — matches @aiclarity/shared specHash', () => {
  it('equals specHash over the file content (canonical, not raw bytes)', () => {
    const nodeHash = canonicalSpecHash(specPath);
    expect(nodeHash).toBe(specHash(fs.readFileSync(specPath, 'utf-8')));
  });

  it('returns null for an unreadable file', () => {
    expect(canonicalSpecHash(path.join(tmp, 'nope.md'))).toBeNull();
  });
});

describe('resolveStatus — pure', () => {
  it('unapproved when no record', () => {
    expect(resolveStatus(undefined, 'abc')).toBe('unapproved');
  });
  it('approved when hash matches', () => {
    expect(resolveStatus(record(), 'abc')).toBe('approved');
  });
  it('stale when hash differs', () => {
    expect(resolveStatus(record(), 'xyz')).toBe('stale');
  });
  it('unapproved when file unreadable (null hash)', () => {
    expect(resolveStatus(record(), null)).toBe('unapproved');
  });
  it('a migrated record still resolves approved when its hash matches', () => {
    expect(resolveStatus(record({ migrated: true }), 'abc')).toBe('approved');
  });
});

describe('approve / revoke lifecycle (path-keyed, committed sidecar)', () => {
  it('approveSpec then getApprovalStatus = approved', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com', () => new Date('2026-05-30T00:00:00Z'));
    expect(getApprovalStatus(tmp, specPath)).toBe('approved');
    const rec = readRecord(tmp, SPEC_REL)!;
    expect(rec.tier).toBe('T3');
    expect(rec.approvedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(rec.specPath).toBe(SPEC_REL);
  });

  it('AC-3 — the sidecar carries all six FR-2 fields', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com', () => new Date('2026-05-30T00:00:00Z'));
    const rec = getApprovalRecord(tmp, specPath)!;
    expect(rec).toMatchObject({
      specPath: SPEC_REL,
      approvedBy: 'paul@harvest316.com',
      tier: 'T3',
      migrated: false,
    });
    expect(rec.specHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.approvedAt).toBe('2026-05-30T00:00:00.000Z');
  });

  it('AC-4 — editing ONLY the status line keeps approval (lifecycle non-void)', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com');
    setSpecStatus(specPath, 'implementing'); // a lifecycle-field edit
    expect(getApprovalStatus(tmp, specPath)).toBe('approved');
    expect(parseSpec(fs.readFileSync(specPath, 'utf-8')).frontmatter.status).toBe('implementing');
  });

  it('editing the BODY after approval makes it stale', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com');
    fs.appendFileSync(specPath, '\nmore content\n');
    expect(getApprovalStatus(tmp, specPath)).toBe('stale');
  });

  it('revokeApproval removes the sidecar', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com');
    expect(revokeApproval(tmp, specPath)).toBe(true);
    expect(getApprovalStatus(tmp, specPath)).toBe('unapproved');
    expect(revokeApproval(tmp, specPath)).toBe(false);
  });

  it('AC-1 — a committed sidecar survives a fresh "clone" (copy without the source repo state)', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com');
    // Simulate a fresh clone: copy specs/ + .minspec/approvals/ into a new dir.
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-clone-'));
    fs.cpSync(path.join(tmp, 'specs'), path.join(clone, 'specs'), { recursive: true });
    fs.cpSync(path.join(tmp, '.minspec'), path.join(clone, '.minspec'), { recursive: true });
    const clonedSpec = path.join(clone, 'specs', 'SPEC-007-thing.md');
    expect(getApprovalStatus(clone, clonedSpec)).toBe('approved');
    fs.rmSync(clone, { recursive: true, force: true });
  });
});

describe('AC-3 — gitConfigEmail is offline (Tier-0)', () => {
  it('captures git config user.email with no network call', () => {
    const email = gitConfigEmail(tmp);
    // Either the configured email (git present) or the honest fallback.
    expect(['tester@example.com', 'unknown']).toContain(email);
  });

  it('degrades to "unknown" rather than throwing on a non-repo dir', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-bare-'));
    // A dir with no git identity; on a machine with a global user.email this may
    // still resolve — the contract is only that it never throws and returns a string.
    expect(typeof gitConfigEmail(bare)).toBe('string');
    fs.rmSync(bare, { recursive: true, force: true });
  });
});

describe('specRelPath', () => {
  it('produces a repo-relative POSIX path', () => {
    expect(specRelPath(tmp, specPath)).toBe(SPEC_REL);
  });
});
