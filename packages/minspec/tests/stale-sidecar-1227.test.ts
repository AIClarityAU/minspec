/**
 * #1227 - Rule 30: a committed approval sidecar must match the file it approves.
 * Unit cases for the pure decision, plus the CLI as a subprocess (the script calls
 * process.exit) with a clean control so a red case cannot be a vacuous scan.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findStaleSidecars } from '../../../scripts/lib/stale-sidecar';
import { specHash } from '../../shared/src/canonical';
import { runTsxCli, REPO_ROOT } from './helpers/run-tsx-cli';

const classify = (p: string) => (p.includes('/DR-') ? ('adr' as const) : p.endsWith('requirements.md') ? ('spec' as const) : undefined);

describe('findStaleSidecars (#1227)', () => {
  const recs = [{ specPath: 'specs/a/requirements.md', specHash: 'old' }];
  it('flags a spec whose hash moved as fatal', () => {
    const r = findStaleSidecars(recs, () => 'new', classify);
    expect(r).toHaveLength(1);
    expect(r[0].fatal).toBe(true);
  });
  it('passes a matching hash', () => {
    expect(findStaleSidecars(recs, () => 'old', classify)).toEqual([]);
  });
  it('downgrades a decision record to non-fatal', () => {
    const r = findStaleSidecars([{ specPath: 'docs/decisions/DR-1.md', specHash: 'a' }], () => 'b', classify);
    expect(r[0].fatal).toBe(false);
  });
  it('skips orphans and missing files', () => {
    expect(findStaleSidecars([{ specPath: 'specs/a/design.md', specHash: 'a' }], () => 'b', classify)).toEqual([]);
    expect(findStaleSidecars(recs, () => null, classify)).toEqual([]);
  });
});

describe('validate-frontmatter Rule 30 CLI (#1227)', () => {
  // Absolute, worktree-safe tsx + script (helpers/run-tsx-cli): process.cwd()-relative paths
  // made a missing binary read as empty output, so every negative assertion passed vacuously.
  const SCRIPT = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
  const SPEC = 'specs/x/SPEC-900-probe/requirements.md';
  const body = (extra: string) =>
    `---\nid: SPEC-900\nstatus: planning\ntier: T1\n${extra}---\n\n# Probe\n\nOne sentence.\n`;

  function run(content: string, recordedFor: string): { out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-1227-'));
    fs.mkdirSync(path.join(dir, '.minspec', 'approvals', path.dirname(SPEC)), { recursive: true });
    fs.mkdirSync(path.join(dir, path.dirname(SPEC)), { recursive: true });
    fs.writeFileSync(path.join(dir, SPEC), content);
    fs.writeFileSync(
      path.join(dir, '.minspec', 'approvals', `${SPEC}.json`),
      JSON.stringify({ specPath: SPEC, specHash: specHash(recordedFor), approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'h@example.com', tier: 'T1', migrated: false, baselineBlob: '' }),
    );
    const r = runTsxCli(SCRIPT, [], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    return { out: r.output };
  }

  it('control: matching sidecar raises no stale-approval finding', () => {
    const c = body('');
    const { out } = run(c, c);
    expect(out, 'the validator must have actually run').toMatch(/frontmatter|validation|FAIL|WARN/i);
    expect(out).not.toContain('stale approval (#1227)');
  });
  it('missing approved file: no stale finding and the check still runs (canonicalSpecHash returns null, not throws)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-1227-missing-'));
    fs.mkdirSync(path.join(dir, '.minspec', 'approvals', path.dirname(SPEC)), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.minspec', 'approvals', `${SPEC}.json`),
      JSON.stringify({ specPath: SPEC, specHash: specHash(body('')), approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'h@example.com', tier: 'T1', migrated: false, baselineBlob: '' }),
    );
    const r = runTsxCli(SCRIPT, [], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    const out = r.output;
    expect(out, 'the validator must have actually run').toMatch(/frontmatter|validation|FAIL|WARN/i);
    expect(out).not.toContain('stale approval (#1227)');
    expect(out).not.toContain('the stale-approval check could not run');
  });
  it('a hashed field added after approval fails the build', () => {
    const approved = body('');
    const edited = body('implements: [scripts/x.ts]\n');
    const { out } = run(edited, approved);
    expect(out).toContain('stale approval (#1227)');
    expect(out).toMatch(/FAIL specs\/x\/SPEC-900-probe\/requirements\.md/);
  });
  it('a spec on the known-debt list downgrades to a visible WARN; a fixed one is flagged for removal', () => {
    const approved = body('');
    const edited = body('implements: [scripts/x.ts]\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-1227-debt-'));
    fs.mkdirSync(path.join(dir, '.minspec', 'approvals', path.dirname(SPEC)), { recursive: true });
    fs.mkdirSync(path.join(dir, path.dirname(SPEC)), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, SPEC), edited);
    fs.writeFileSync(
      path.join(dir, '.minspec', 'approvals', `${SPEC}.json`),
      JSON.stringify({ specPath: SPEC, specHash: specHash(approved), approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'h@example.com', tier: 'T1', migrated: false, baselineBlob: '' }),
    );
    fs.writeFileSync(path.join(dir, 'scripts', 'stale-approval-exemptions.json'), JSON.stringify({ exemptions: [{ path: SPEC, reason: 'test debt' }] }));
    const r = runTsxCli(SCRIPT, [], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.output).toContain('stale approval (#1227)');
    expect(r.output).toContain('[known debt: test debt]');
    expect(r.output).not.toMatch(/FAIL specs\/x\/SPEC-900-probe\/requirements\.md: stale/);
  });
});
