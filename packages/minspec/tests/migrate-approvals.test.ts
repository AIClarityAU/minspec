import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync as run } from 'child_process';
import { specHash } from '@aiclarity/shared';

// ─────────────────────────────────────────────────────────────────────────────
// AC-9 (FR-5 migration). T0 — written before running the real migration.
//
// Runs the actual scripts/migrate-approvals.ts (via tsx) against a hermetic temp
// git repo seeded with a legacy id-keyed approvals.json + specs, and asserts:
//   - legacy records become committed path-keyed sidecars with RECOMPUTED
//     canonical hashes (≠ the raw-byte hash the legacy store held)
//   - shipped implementing/done specs with no record get migrated:true sidecars
//   - the script is idempotent (a second run writes nothing new)
//   - the FR-2 shape is complete (specPath/specHash/approvedAt/approvedBy/tier/migrated)
//
// AC-10 discipline: there was NO migration / no path-keyed sidecar before this
// change, so every assertion fails against pre-change code by construction.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'migrate-approvals.ts');

let ws: string;

function gitInit(dir: string): void {
  const opts = { cwd: dir, stdio: 'ignore' as const };
  run('git', ['init', '-q'], opts);
  run('git', ['config', 'user.email', 'owner@example.com'], opts);
  run('git', ['config', 'user.name', 'owner'], opts);
}

function writeSpec(id: string, tier: string, phases: string, status = 'implementing'): string {
  const dir = path.join(ws, 'specs', `${id}-x`);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'requirements.md');
  fs.writeFileSync(
    p,
    `---\nid: ${id}\ntitle: X\ntier: ${tier}\nstatus: ${status}\ncreated: 2026-05-30\nphases:\n  ${phases}\n---\n# ${id}\nbody\n`,
  );
  return p;
}

const IMPL_PHASES = 'specify: done\n  clarify: skipped\n  plan: in-progress\n  tasks: pending\n  implement: pending';
const SPEC_PHASES = 'specify: in-progress\n  clarify: pending\n  plan: pending\n  tasks: pending\n  implement: pending';

/** Raw-byte sha256 — the LEGACY (pre-SPEC-022) hash, to prove recomputation. */
function rawByteHash(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sidecarPath(specRel: string): string {
  return path.join(ws, '.minspec', 'approvals', specRel + '.json');
}

function readSidecar(specRel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(sidecarPath(specRel), 'utf-8'));
}

function runMigration(): string {
  return run('npx', ['tsx', SCRIPT], { cwd: ws, encoding: 'utf-8' });
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-migrate-'));
  gitInit(ws);
  fs.mkdirSync(path.join(ws, '.minspec'), { recursive: true });
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

describe('AC-9 — migrate-approvals converts legacy records with recomputed canonical hashes', () => {
  it('converts an id-keyed legacy record → a committed path-keyed sidecar (migrated:false, recomputed hash)', () => {
    const sp = writeSpec('SPEC-007', 'T3', IMPL_PHASES);
    const specRel = path.relative(ws, sp).split(path.sep).join('/');
    // Legacy store: raw-byte hash (the invalid-under-FR-3 scheme).
    const legacyHash = rawByteHash(sp);
    fs.writeFileSync(
      path.join(ws, '.minspec', 'approvals.json'),
      JSON.stringify({
        'SPEC-007': { specHash: legacyHash, approvedAt: '2026-06-01T00:00:00.000Z', tier: 'T3' },
      }),
    );

    runMigration();

    expect(fs.existsSync(sidecarPath(specRel))).toBe(true);
    const rec = readSidecar(specRel);
    expect(rec.migrated).toBe(false);
    expect(rec.specPath).toBe(specRel);
    expect(rec.approvedBy).toBe('owner@example.com');
    expect(rec.tier).toBe('T3');
    expect(rec.approvedAt).toBe('2026-06-01T00:00:00.000Z'); // carried from legacy
    // The hash is RECOMPUTED canonically — NOT the legacy raw-byte hash.
    expect(rec.specHash).toBe(specHash(fs.readFileSync(sp, 'utf-8')));
    expect(rec.specHash).not.toBe(legacyHash);
  });

  it('backfills migrated:true for an unbacked implementing spec, and does NOT for a specify-phase one', () => {
    const impl = writeSpec('SPEC-010', 'T4', IMPL_PHASES); // derives implementing, no record
    const specRel = writeSpec('SPEC-011', 'T3', SPEC_PHASES, 'specifying'); // specify phase — not gated
    const implRel = path.relative(ws, impl).split(path.sep).join('/');
    const specifyingRel = path.relative(ws, specRel).split(path.sep).join('/');

    runMigration();

    expect(fs.existsSync(sidecarPath(implRel))).toBe(true);
    expect(readSidecar(implRel).migrated).toBe(true);
    // A specify-phase spec is not in implementation → no migrated sidecar.
    expect(fs.existsSync(sidecarPath(specifyingRel))).toBe(false);
  });

  it(
    'is idempotent — a second run writes no new sidecars and never flips migrated:false to true',
    () => {
      const sp = writeSpec('SPEC-007', 'T3', IMPL_PHASES);
      const specRel = path.relative(ws, sp).split(path.sep).join('/');
      fs.writeFileSync(
        path.join(ws, '.minspec', 'approvals.json'),
        JSON.stringify({ 'SPEC-007': { specHash: rawByteHash(sp), approvedAt: '2026-06-01T00:00:00.000Z', tier: 'T3' } }),
      );

      runMigration();
      const firstContent = fs.readFileSync(sidecarPath(specRel), 'utf-8');
      runMigration();
      const secondContent = fs.readFileSync(sidecarPath(specRel), 'utf-8');

      expect(secondContent).toBe(firstContent); // unchanged
      expect(readSidecar(specRel).migrated).toBe(false); // step 2 never overwrites a converted record
    },
    // Two `npx tsx` child-process spawns in one test (each real fs+git work,
    // not mocked). Under the full-suite parallel worker pool, CPU/fs
    // contention pushes this past the default 5000ms testTimeout even though
    // the idempotency behavior itself is correct (isolated runs are clean —
    // #554). Bump only this test, not the global default.
    20_000,
  );

  it('a migrated:true record leaves the corpus non-clean (promotion stays blocked)', () => {
    writeSpec('SPEC-010', 'T4', IMPL_PHASES); // no legacy record → migrated:true
    const out = runMigration();
    expect(out).toContain('migrated:true');
    expect(out).toMatch(/wrote [1-9]\d* migrated:true sidecar/);
  });

  it('#719 — a legacy record converted under an agent git identity is written migrated:true, never a genuine approval', () => {
    run('git', ['config', 'user.email', 'claude@harvest316.com'], { cwd: ws, stdio: 'ignore' });
    const sp = writeSpec('SPEC-007', 'T3', IMPL_PHASES);
    const specRel = path.relative(ws, sp).split(path.sep).join('/');
    fs.writeFileSync(
      path.join(ws, '.minspec', 'approvals.json'),
      JSON.stringify({
        'SPEC-007': { specHash: rawByteHash(sp), approvedAt: '2026-06-01T00:00:00.000Z', tier: 'T3' },
      }),
    );

    const out = runMigration();

    expect(out).toContain('step 1 records will be written migrated:true');
    const rec = readSidecar(specRel);
    expect(rec.migrated).toBe(true); // NOT false — an agent identity can't stand as a genuine human approver
    expect(rec.approvedBy).toBe('claude@harvest316.com');
  });
});
