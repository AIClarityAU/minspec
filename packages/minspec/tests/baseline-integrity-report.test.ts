import { describe, it, expect } from 'vitest';
import { formatBaselineReport, baselineWarningAnnotation } from '../../../scripts/check-baseline-integrity';

const clean = { total: 3, recovered: 2, unrecoverable: 0, noBaseline: 1, unrecoverableSpecs: [] };
const drift = {
  total: 2,
  recovered: 0,
  unrecoverable: 2,
  noBaseline: 0,
  unrecoverableSpecs: ['specs/a/requirements.md', 'specs/b/requirements.md'],
};

describe('#435 baseline-integrity report', () => {
  it('lists counts and every unrecoverable spec when drift exists', () => {
    const out = formatBaselineReport(drift).join('\n');
    expect(out).toContain('2 unrecoverable');
    expect(out).toContain('WARNING');
    expect(out).toContain('specs/a/requirements.md');
    expect(out).toContain('specs/b/requirements.md');
  });
  it('emits no warning when nothing is unrecoverable', () => {
    expect(formatBaselineReport(clean).join('\n')).not.toContain('WARNING');
    expect(baselineWarningAnnotation(clean)).toBeUndefined();
  });
  it('annotation names the specs', () => {
    expect(baselineWarningAnnotation(drift)).toMatch(/^::warning .*specs\/a\/requirements\.md/);
  });
});

// ── main(): exit-code + annotation contract (#435; invariant 2: no silent gate) ──
import { vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '../../../scripts/check-baseline-integrity';

function fixtureWithDrift(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-integrity-'));
  const approvals = path.join(dir, '.minspec', 'approvals');
  fs.mkdirSync(approvals, { recursive: true });
  fs.writeFileSync(
    path.join(approvals, 'drift.json'),
    JSON.stringify({
      specPath: 'specs/drift/requirements.md',
      specHash: 'a'.repeat(64),
      approvedAt: '2026-01-01T00:00:00Z',
      approvedBy: 'test',
      tier: 'T1',
      migrated: false,
      baselineBlob: 'b'.repeat(40), // 40-hex blob in no git store -> unrecoverable
    }),
  );
  return dir;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((c: string) => (out.push(String(c)), true)) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((c: string) => (err.push(String(c)), true)) as never);
  return { out: () => out.join(''), err: () => err.join('') };
}

describe('#435 check-baseline-integrity main()', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const drift_ = () => {
    const d = fixtureWithDrift();
    dirs.push(d);
    return d;
  };

  it('warn-only: drift exits 0, reports it, and annotates under GitHub Actions', () => {
    const io = capture();
    const code = main(['node', 'script', drift_()], { GITHUB_ACTIONS: 'true' });
    expect(code).toBe(0);
    expect(io.out()).toContain('1 unrecoverable');
    expect(io.out()).toMatch(/::warning title=baseline-integrity::1 unrecoverable.*specs\/drift\/requirements\.md/);
  });

  it('no annotation outside GitHub Actions', () => {
    const io = capture();
    expect(main(['node', 'script', drift_()], {})).toBe(0);
    expect(io.out()).toContain('WARNING');
    expect(io.out()).not.toContain('::warning');
  });

  it('fails closed (non-zero, visible) when the check cannot run: root does not exist', () => {
    const io = capture();
    const code = main(['node', 'script', path.join(os.tmpdir(), `baseline-integrity-missing-${process.pid}`)], {});
    expect(code).not.toBe(0);
    expect(io.out()).not.toContain('0 approval record(s)');
    expect(io.err()).toContain('check could not run');
  });

  it('fails closed when the checker itself throws', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/approval', () => ({
      checkBaselineIntegrity: () => {
        throw new Error('boom');
      },
    }));
    const { main: m } = await import('../../../scripts/check-baseline-integrity');
    const io = capture();
    expect(m(['node', 'script', drift_()], {})).toBe(1);
    expect(io.err()).toContain('boom');
    vi.doUnmock('../src/lib/approval');
  });
});
