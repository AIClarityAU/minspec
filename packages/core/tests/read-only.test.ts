// SPEC-136 FR-6 / FR-7, task 9: the read-only operations leave the whole project tree
// byte-identical (including .git/config), and at most one table entry carries the approval
// effect. Task 13 adds `approve`; it then tightens the FR-7 assertion from "none" to "exactly one".
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATIONS, runOperation, type Operation } from '../src/operations';

const SPEC = (id: string) => `---\nid: ${id}\nstatus: specifying\n---\n\n# T\n\nBody.\n`;
let root: string;

/** Content hash of every entry under dir (path, kind, bytes), `.git` included. */
function snapshot(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(p);
      if (st.isDirectory()) {
        h.update(`D ${r}\n`);
        walk(p, r);
      } else if (st.isSymbolicLink()) {
        h.update(`L ${r} ${readlinkSync(p)}\n`);
      } else {
        h.update(`F ${r} ${createHash('sha256').update(readFileSync(p)).digest('hex')}\n`);
      }
    }
  };
  walk(dir, '');
  return h.digest('hex');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'minspec-core-readonly-'));
  mkdirSync(join(root, '.minspec'), { recursive: true });
  mkdirSync(join(root, 'specs'), { recursive: true });
  writeFileSync(join(root, 'specs', 'one.md'), SPEC('SPEC-901'));
  writeFileSync(join(root, 'specs', 'two.md'), SPEC('SPEC-902'));
  const init = spawnSync('git', ['init', '-q'], { cwd: root });
  if (init.status !== 0) throw new Error('git init failed');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ARGS: Record<string, Record<string, unknown>> = { hash: { spec: 'specs/one.md' } };
const READ_ONLY = ['validate', 'hash', 'status', 'next'];

describe('FR-6: read-only operations do not write', () => {
  it('the fixture tree includes .git/config', () => {
    expect(readFileSync(join(root, '.git', 'config'), 'utf8')).toContain('[core]');
  });

  for (const name of READ_ONLY) {
    it(`${name} leaves the whole tree identical`, async () => {
      const op = OPERATIONS.find((o) => o.name === name)!;
      expect(op.effect).toBe('read-only');
      const before = snapshot(root);
      const r = await runOperation(op, root, ARGS[name] ?? {});
      expect(r.outcome).not.toBe('error');
      expect(snapshot(root)).toBe(before);
    });
  }

  it('control: the snapshot detects a change to .git/config', () => {
    const before = snapshot(root);
    const cfg = join(root, '.git', 'config');
    const orig = readFileSync(cfg, 'utf8');
    writeFileSync(cfg, `${orig}[user]\n\tname = x\n`);
    try {
      expect(snapshot(root)).not.toBe(before);
    } finally {
      writeFileSync(cfg, orig);
    }
    expect(snapshot(root)).toBe(before);
  });
});

/** FR-7: the table may hold only one approval-effect entry, and it must be `approve`. */
function approvalPathProblem(table: readonly { name: string; effect: Operation["effect"] }[], expected: 0 | 1): string | null {
  const approvals = table.filter((o) => o.effect === 'approval');
  if (approvals.length !== expected) return `expected ${expected} approval entries, found ${approvals.length}`;
  if (approvals.some((o) => o.name !== 'approve')) return 'the approval entry must be named approve';
  return null;
}

describe('FR-7: one approval path', () => {
  // Task 13 adds `approve`; change this 0 to 1 there.
  const EXPECTED_APPROVAL_ENTRIES = 0;

  it('the real table has no entry beyond the expected approval path', () => {
    expect(approvalPathProblem(OPERATIONS, EXPECTED_APPROVAL_ENTRIES)).toBeNull();
  });

  it('control: a test-only table with a second approval entry fails the check', () => {
    const extra = { name: 'approve', effect: 'approval' } as const;
    const second = { name: 'approve2', effect: 'approval' } as const;
    expect(approvalPathProblem([...OPERATIONS, extra, second], 1)).not.toBeNull();
    expect(approvalPathProblem([...OPERATIONS, second], 0)).not.toBeNull();
  });

  it('control: a lone approval entry not named approve fails the check', () => {
    expect(approvalPathProblem([{ name: 'activate', effect: 'approval' }], 1)).not.toBeNull();
    expect(approvalPathProblem([{ name: 'approve', effect: 'approval' }], 1)).toBeNull();
  });
});
