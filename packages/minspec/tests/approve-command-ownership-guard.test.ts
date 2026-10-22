/**
 * #1806 — composition test for the ownership guard on the REAL `commands/approve.ts`
 * ordering, driving the actual command (not the lib functions in isolation).
 *
 * WHY THIS TEST DIDN'T EXIST. Every other ownership-guard test (ownership-guard.test.ts,
 * approve-target-status-1317.test.ts) exercises either the shared guard directly or
 * `advanceSpecToImplementing` in isolation — both pre-advance. Neither drives the actual
 * `approveSpecCommand` sequence end to end, so a defect in HOW the command composes its
 * calls (wrong function, wrong order) is invisible to them even when each half is green.
 * This test drives the real command against a spec that would introduce
 * `ownership.implements.missing` on advance, and asserts the command refuses AND leaves
 * the file — and the approval sidecar — untouched. `vi.mock` only covers `vscode` itself;
 * every MinSpec lib (`spec`, `approval`, `spec-validator`, `ownership-advance-guard`,
 * `epic-manager`, ...) is REAL, so the composition is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// ─── Mock vscode (thin — just enough surface for the real command to run) ───
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [] as { uri: { fsPath: string } }[],
    openTextDocument: vi.fn(),
    getWorkspaceFolder: vi.fn(() => undefined),
    getConfiguration: vi.fn(() => ({
      // `approverEmail` resolves to a provable human identity (DR-056) so the
      // approver gate is not what refuses this test's fixture — the ownership
      // guard is what must refuse it.
      get: (key: string, def?: unknown) => (key === 'approverEmail' ? 'paul@harvest316.com' : def),
    })),
  },
  commands: { executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import * as vscode from 'vscode';
import { approveSpecCommand } from '../src/commands/approve';
import { readRecord } from '../src/lib/approval-store';
import { parseSpec } from '../src/lib/spec';

let tmp: string;

const FULL_BODY = `## Specify
Build the thing.
- [ ] criterion one

## Plan
Steps.

## Tasks
- [ ] task a

## Implement
code.
`;

/** A pre-advance T3 spec: complete, but undeclared — arms ownership.implements.missing on advance. */
function specSource(): string {
  const frontmatter = [
    '---',
    'id: SPEC-950',
    'title: Ownership Guard Composition Fixture',
    'type: requirements',
    'tier: T3',
    'status: specifying',
    'created: 2026-08-07',
    'phases:',
    '  specify: done',
    '  clarify: done',
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${FULL_BODY}`;
}

function specRelPath(): string {
  return path.join('specs', 'SPEC-950-ownership-guard-fixture.md');
}

/** Repo-relative path, matching how `approval-store` keys its records. */
function rel(abs: string): string {
  return path.relative(tmp, abs).split(path.sep).join('/');
}

beforeEach(() => {
  vi.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approve-ownership-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: tmp });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmp });
  } catch {
    // git absent — baseline mint degrades to '' and the assertions below still hold.
  }
  fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
  // Ratchet to 'error' — the repo setting that arms `ownership.implements.missing`
  // (SPEC-038 FR-7; the default `warn` would never refuse, matching ownership-guard.test.ts).
  fs.writeFileSync(
    path.join(tmp, '.minspec', 'config.json'),
    JSON.stringify({ version: '1', ownershipDeclaration: 'error' }, null, 2),
  );
  (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
    { uri: { fsPath: tmp } },
  ];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('#1806 — approveSpecCommand refuses an undeclared spec end to end', () => {
  it('refuses BEFORE any write, and leaves the file + sidecar untouched', async () => {
    const specPath = path.join(tmp, specRelPath());
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, specSource());
    const before = fs.readFileSync(specPath, 'utf-8');

    // Tree-node invocation bypasses the quick-pick (see approve-command.test.ts) —
    // this test targets the write-ordering composition, not spec selection.
    const node = {
      spec: {
        id: 'SPEC-950',
        title: 'Ownership Guard Composition Fixture',
        tier: 'T3',
        status: 'specifying',
        currentPhase: 'specify',
        filePath: specPath,
        phasesDone: 2,
        phasesTotal: 5,
      },
    };

    // approveSpecCommand catches internally and shows a toast rather than
    // rejecting — assert on OBSERVABLE effects (file bytes, sidecar, error
    // toast), not on a thrown promise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await approveSpecCommand(node as any);

    // THE FIX: the guard must have refused — an error toast was shown naming
    // the ownership gap, not a success toast.
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    const errorCalls = (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls;
    const joined = errorCalls.map((c) => String(c[0])).join('\n');
    expect(joined).toMatch(/ownership|implements|not ready/i);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    // THE REGRESSION THIS TEST CATCHES: no half-write. Neither the phases map
    // nor the status line may have advanced, and no approval sidecar may exist.
    const after = fs.readFileSync(specPath, 'utf-8');
    expect(after, 'the spec file was mutated despite the refusal').toBe(before);
    expect(parseSpec(after).frontmatter.phases.plan).toBe('pending');
    expect(parseSpec(after).frontmatter.status).toBe('specifying');
    expect(readRecord(tmp, rel(specPath)), 'a sidecar was written despite the refusal').toBeUndefined();
  });
});
