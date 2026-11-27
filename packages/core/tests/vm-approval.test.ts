// SPEC-136 FR-7 / FR-19 / FR-20 / FR-25, task 13: `approve` in a fixture repo with a human
// git identity. One call approves; what changes on disk is exactly the spec, its sidecar and the
// .git baseline blob + refs/minspec/snapshots ref; a bot address is refused before any write.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATIONS, offeredAsTool } from '../src/operations';
import { buildBundle, runCore } from './helpers';

const SPEC = '---\nid: SPEC-920\nstatus: specifying\n---\n\n# Approve me\n\nBody text.\n';
let work: string;
let bundle: string;
let n = 0;

/** path -> content hash of every file under dir, `.git` included (symlinks and dirs skipped). */
function files(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile()) out.set(r, createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir, '');
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function fixture(email: string, spec = SPEC): string {
  const dir = join(work, `repo-${n++}`);
  mkdirSync(join(dir, '.minspec'), { recursive: true });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  writeFileSync(join(dir, 'specs', 'one.md'), spec);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', email);
  git(dir, 'config', 'user.name', 'Fixture');
  return dir;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-vmapproval-'));
  bundle = await buildBundle(join(work, 'bundle'));
}, 60_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('approve (FR-19, FR-25)', () => {
  it('one call approves; the derived status reads approved at once; only the allowed set changes', () => {
    const dir = fixture('human@example.com');
    const before = files(dir);
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.json.refusal).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.json.outcome).toBe('pass');
    expect(r.json.data.status).toBe('approved');
    expect(r.json.data.record.approvedBy).toBe('human@example.com');

    const after = files(dir);
    const delta = changed(before, after);
    expect(delta).toContain('specs/one.md');
    expect(delta.some((p) => p.startsWith('.minspec/approvals/'))).toBe(true);
    expect(delta.some((p) => p.startsWith('.git/refs/minspec/snapshots/'))).toBe(true);
    const allowed = (p: string) =>
      p === 'specs/one.md' ||
      p.startsWith('.minspec/approvals/') ||
      p.startsWith('.git/objects/') ||
      p.startsWith('.git/refs/minspec/snapshots/');
    expect(delta.filter((p) => !allowed(p))).toEqual([]);
    expect(delta.filter((p) => /session|presence|heartbeat|queue/i.test(p))).toEqual([]);

    const status = runCore(bundle, ['status', '--root', dir]);
    expect(status.json.data.specs[0].approval).toBe('approved');
    expect(status.json.data.specs[0].status).not.toBe('specifying');
    // No commit: HEAD is still unborn.
    expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir }).status).not.toBe(0);
  });

  it('resolves the spec by id as well as by path', () => {
    const dir = fixture('human@example.com');
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'SPEC-920']);
    expect(r.json.outcome).toBe('pass');
  });

  it('a bot address is refused before any write', () => {
    const dir = fixture('claude@harvest316.com');
    const bot = fixture('minspec-sdd[bot]@users.noreply.github.com');
    for (const d of [dir, bot]) {
      const before = files(d);
      const r = runCore(bundle, ['approve', '--root', d, '--spec', 'specs/one.md']);
      expect(r.status).toBe(2);
      expect(r.json.refusal.code).toBe('approver-denied');
      expect(files(d)).toEqual(before);
    }
  });

  it('MINSPEC_AGENT_IDENTITIES extends the denied set', () => {
    const dir = fixture('someone@example.com');
    const prev = process.env.MINSPEC_AGENT_IDENTITIES;
    process.env.MINSPEC_AGENT_IDENTITIES = 'someone@example.com';
    try {
      const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
      expect(r.json.refusal?.code).toBe('approver-denied');
    } finally {
      if (prev === undefined) delete process.env.MINSPEC_AGENT_IDENTITIES;
      else process.env.MINSPEC_AGENT_IDENTITIES = prev;
    }
  });

  it('a second call is refused already-approved, writing nothing', () => {
    const dir = fixture('human@example.com');
    expect(runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']).status).toBe(0);
    const before = files(dir);
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.status).toBe(2);
    expect(r.json.refusal.code).toBe('already-approved');
    expect(files(dir)).toEqual(before);
  });

  it('a terminal-status spec is refused terminal-status', () => {
    const dir = fixture('human@example.com', SPEC.replace('status: specifying', 'status: done'));
    const before = files(dir);
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.json.refusal?.code).toBe('terminal-status');
    expect(files(dir)).toEqual(before);
  });

  it('an incomplete spec is refused incomplete, with its error findings', () => {
    const dir = fixture('human@example.com', '---\nid: SPEC-921\nstatus: specifying\ntier: T4\n---\n\n# Thin\n');
    const before = files(dir);
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.json.refusal?.code).toBe('incomplete');
    expect(r.json.findings.length).toBeGreaterThan(0);
    expect(files(dir)).toEqual(before);
  });

  it('a folder without .minspec/ is refused not-a-minspec-project', () => {
    const dir = join(work, 'plain');
    mkdirSync(join(dir, 'specs'), { recursive: true });
    writeFileSync(join(dir, 'specs', 'one.md'), SPEC);
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.json.refusal.code).toBe('not-a-minspec-project');
    expect(readdirSync(dir)).toEqual(['specs']);
  });

  it('an unknown spec is refused bad-argument', () => {
    const dir = fixture('human@example.com');
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/missing.md']);
    expect(r.json.refusal.code).toBe('bad-argument');
  });

  it('control: the change detector sees a write', () => {
    const dir = fixture('human@example.com');
    const before = files(dir);
    writeFileSync(join(dir, 'specs', 'one.md'), `${SPEC}more\n`);
    expect(changed(before, files(dir))).toEqual(['specs/one.md']);
  });
});

describe('approve is never a tool (FR-20)', () => {
  it('offeredAsTool is false for approve and true for every read-only operation', () => {
    const approve = OPERATIONS.find((o) => o.name === 'approve')!;
    expect(approve.effect).toBe('approval');
    expect(offeredAsTool(approve)).toBe(false);
    for (const op of OPERATIONS.filter((o) => o.name !== 'approve')) expect(offeredAsTool(op)).toBe(true);
    // Control: the predicate reads `effect`, so a read-only entry of the same name would be offered.
    expect(offeredAsTool({ ...approve, effect: 'read-only' })).toBe(true);
  });
});

describe('no operation takes a ref or remote (FR-25)', () => {
  it('no input schema names a ref, remote, branch, url or push property', () => {
    for (const op of OPERATIONS) {
      for (const key of Object.keys(op.input.properties)) {
        expect(key, `${op.name}.${key}`).not.toMatch(/ref|remote|branch|url|push|origin/i);
      }
    }
  });

  it('control: the pattern catches a ref-bearing property', () => {
    expect('baseRef').toMatch(/ref|remote|branch|url|push|origin/i);
  });
});
