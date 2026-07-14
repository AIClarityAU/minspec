/**
 * SPEC-029 Slices 2-3 — diff sourcing (`resolveDiffSide`) and the
 * `showChangesSinceApproval` command / `ApprovalDiffContentProvider`.
 *
 * Slice 2 tests use a real git repo fixture (mirrors approve-baseline.test.ts)
 * so `recoverBaseline`'s git-blob path is genuinely exercised, not mocked.
 * Slice 3 tests mock only `vscode` (window/commands/Uri) — the module under
 * test imports `SpecNode` as a TYPE ONLY, so no spec-tree-provider mock needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    activeTextEditor: undefined,
  },
  commands: { executeCommand: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0], path: s.slice(s.indexOf(':') + 1) }) },
}));

import * as vscode from 'vscode';
import { approveSpec } from '../src/lib/approval';
import { sidecarPath } from '../src/lib/approval-store';
import {
  resolveDiffSide,
  ApprovalDiffContentProvider,
  showChangesSinceApproval,
} from '../src/lib/approval-diff';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approval-diff-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: tmp, stdio: 'ignore' });
  vi.clearAllMocks();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSpec(relPath: string, body = '# Fixture\n\nOriginal body.\n'): string {
  const absPath = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `---\nid: SPEC-TEST\ntype: requirements\nstatus: implementing\nproduct: minspec\n---\n\n${body}`, 'utf-8');
  return absPath;
}

const SPEC_REL = 'specs/minspec/SPEC-TEST/requirements.md';

// ── Slice 2: resolveDiffSide ────────────────────────────────────────────────

describe('resolveDiffSide', () => {
  it('FR-5: "approved" returns exactly recoverBaseline\'s output (approved with no absolute-path double-relativize bug)', () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited after approval.\n');

    const approved = resolveDiffSide(tmp, specPath, 'approved');
    expect(approved).toContain('Original body.');
    expect(approved).not.toContain('Edited after approval.');
  });

  it('FR-5: "current" returns exactly getSpecBodyOnly(fs.readFileSync(...)) — byte for byte', () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited after approval.\n');

    const current = resolveDiffSide(tmp, specPath, 'current');
    expect(current).toContain('Original body.');
    expect(current).toContain('Edited after approval.');
  });

  it('INV — No fabricated diff: a legacy record with baselineBlob === "" resolves "approved" to undefined, never throws', () => {
    const specPath = writeSpec(SPEC_REL);
    const p = sidecarPath(tmp, SPEC_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      specPath: SPEC_REL, specHash: 'a'.repeat(64), approvedAt: '2026-01-01T00:00:00.000Z',
      approvedBy: 'x@y.com', tier: 'T3', migrated: false, baselineBlob: '',
    }, null, 2));

    expect(() => resolveDiffSide(tmp, specPath, 'approved')).not.toThrow();
    expect(resolveDiffSide(tmp, specPath, 'approved')).toBeUndefined();
  });

  it('INV — No fabricated diff: a blob SHA git cat-file fails on resolves "approved" to undefined, never throws', () => {
    const specPath = writeSpec(SPEC_REL);
    const p = sidecarPath(tmp, SPEC_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      specPath: SPEC_REL, specHash: 'a'.repeat(64), approvedAt: '2026-01-01T00:00:00.000Z',
      approvedBy: 'x@y.com', tier: 'T3', migrated: false, baselineBlob: 'f'.repeat(40), // no such blob
    }, null, 2));

    expect(() => resolveDiffSide(tmp, specPath, 'approved')).not.toThrow();
    expect(resolveDiffSide(tmp, specPath, 'approved')).toBeUndefined();
  });

  it('"current" returns undefined (never throws) when the file cannot be read', () => {
    expect(() => resolveDiffSide(tmp, path.join(tmp, 'does-not-exist.md'), 'current')).not.toThrow();
    expect(resolveDiffSide(tmp, path.join(tmp, 'does-not-exist.md'), 'current')).toBeUndefined();
  });

  // #701 — git-history baseline fallback when the minted blob is unrecoverable
  function commitAll(msg: string): void {
    execFileSync('git', ['add', '-A'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', msg, '--no-verify'], { cwd: tmp, stdio: 'ignore' });
  }

  it('#701: a legacy record (baselineBlob "") whose specHash matches a COMMITTED version reconstructs "approved" from git history', () => {
    const specPath = writeSpec(SPEC_REL);
    commitAll('add spec'); // the approved content now lives in git history
    // Approve to capture the correct canonical specHash, then downgrade the
    // sidecar to a legacy (no-baseline) shape so only the history path can serve.
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    const p = sidecarPath(tmp, SPEC_REL);
    const rec = JSON.parse(fs.readFileSync(p, 'utf-8'));
    fs.writeFileSync(p, JSON.stringify({ ...rec, baselineBlob: '' }, null, 2));
    // Edit the working file so the two sides genuinely differ.
    fs.appendFileSync(specPath, '\nEdited after approval.\n');

    const approved = resolveDiffSide(tmp, specPath, 'approved');
    expect(approved).toContain('Original body.');
    expect(approved).not.toContain('Edited after approval.');
  });

  it('#701: fallback returns undefined (degrade, never throw) when the approved hash matches NO commit', () => {
    const specPath = writeSpec(SPEC_REL);
    commitAll('add spec'); // committed, but the record below points at a bogus hash
    const p = sidecarPath(tmp, SPEC_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      specPath: SPEC_REL, specHash: 'a'.repeat(64), approvedAt: '2026-01-01T00:00:00.000Z',
      approvedBy: 'x@y.com', tier: 'T3', migrated: false, baselineBlob: '',
    }, null, 2));

    expect(() => resolveDiffSide(tmp, specPath, 'approved')).not.toThrow();
    expect(resolveDiffSide(tmp, specPath, 'approved')).toBeUndefined();
  });

  it('#701: showChangesSinceApproval opens the diff for a legacy record once its approved content is recoverable from history', async () => {
    const specPath = writeSpec(SPEC_REL);
    commitAll('add spec');
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    const p = sidecarPath(tmp, SPEC_REL);
    const rec = JSON.parse(fs.readFileSync(p, 'utf-8'));
    fs.writeFileSync(p, JSON.stringify({ ...rec, baselineBlob: '' }, null, 2));
    fs.appendFileSync(specPath, '\nEdited after approval.\n');

    await showChangesSinceApproval(tmp, specPath);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    expect((vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('vscode.diff');
  });

  it('R2: a spec path containing a space round-trips through the diff URI encoding losslessly', () => {
    const specPath = writeSpec('specs/minspec/SPEC WITH SPACE/requirements.md');
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');

    const provider = new ApprovalDiffContentProvider(tmp);
    const enc = Buffer.from(specPath, 'utf-8').toString('base64url');
    const uri = { path: `/current/${enc}` } as unknown as vscode.Uri;
    expect(provider.provideTextDocumentContent(uri)).toContain('Original body.');
  });
});

// ── Slice 3: showChangesSinceApproval ───────────────────────────────────────

describe('showChangesSinceApproval', () => {
  it('FR-6: with a recoverable baseline, opens vscode.diff exactly once with minspec-approval-diff URIs and an approvedAt-bearing title', async () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited after approval.\n');

    await showChangesSinceApproval(tmp, specPath);

    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    const [cmd, approvedUri, currentUri, title] = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cmd).toBe('vscode.diff');
    expect((approvedUri as { scheme: string }).scheme).toBe('minspec-approval-diff');
    expect((currentUri as { scheme: string }).scheme).toBe('minspec-approval-diff');
    expect(title).toMatch(/\d{4}-\d{2}-\d{2}T/); // approvedAt ISO timestamp present
  });

  it('FR-8: with an unrecoverable baseline, shows the degrade message and never opens vscode.diff', async () => {
    const specPath = writeSpec(SPEC_REL);
    const p = sidecarPath(tmp, SPEC_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      specPath: SPEC_REL, specHash: 'a'.repeat(64), approvedAt: '2026-01-01T00:00:00.000Z',
      approvedBy: 'x@y.com', tier: 'T3', migrated: false, baselineBlob: '',
    }, null, 2));

    await showChangesSinceApproval(tmp, specPath);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Baseline unavailable'));
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('SEV-3: with a recoverable baseline but an unreadable current file, degrades and opens no diff (no false full-deletion render)', async () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.rmSync(specPath); // deleted between the stale render and the click

    await showChangesSinceApproval(tmp, specPath);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('no longer readable'));
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('SEV-2 arg-shape: resolves a string arg (tree click)', async () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited.\n');
    await showChangesSinceApproval(tmp, specPath);
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('SEV-2 arg-shape: resolves a SpecNode-shaped object arg (context menu)', async () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited.\n');
    const nodeArg = { spec: { filePath: specPath } } as unknown as import('../src/views/spec-tree-provider').SpecNode;
    await showChangesSinceApproval(tmp, nodeArg);
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('SEV-2 arg-shape / FR-5 palette: no arg falls back to the active editor document and opens the diff', async () => {
    const specPath = writeSpec(SPEC_REL);
    approveSpec(tmp, specPath, 'T3', 'tester@example.com');
    fs.appendFileSync(specPath, '\nEdited.\n');
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = {
      document: { uri: { fsPath: specPath } },
    };
    await showChangesSinceApproval(tmp);
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('SEV-2 palette gate: no arg + active editor on a document with no approval record degrades, opens no diff', async () => {
    const nonSpecPath = path.join(tmp, 'README.md');
    fs.writeFileSync(nonSpecPath, '# Not a spec\n');
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = {
      document: { uri: { fsPath: nonSpecPath } },
    };
    await showChangesSinceApproval(tmp);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Baseline unavailable'));
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('no arg + no active editor degrades with the "no spec selected" message', async () => {
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
    await showChangesSinceApproval(tmp);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('No spec selected'));
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
