/**
 * in97 (T3 regression, 2026-11-22) — re-approving a spec whose approval went stale must
 * not be refused for an advance that approval will never perform.
 *
 * Root cause: `approve.ts` advances the phase map only when the literal status is
 * `new`/`specifying` (`wasPreImpl`), but the ownership guard (`approve.ts`, and again
 * `approveSpec` in the lib) simulated that advance for EVERY spec. A spec already at
 * `planning`/`implementing` with `plan: pending` and no `implements:` (approved before
 * SPEC-038 existed: SPEC-023, SPEC-026 on main) was refused over a phase write that
 * never happens. Adding `implements:` was the only way through, and the founder hit it.
 *
 * Fixture harness copied from approve-command-ownership-guard.test.ts (#1806). Original
 * header follows.
 *
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
function specSource(status = 'specifying'): string {
  const frontmatter = [
    '---',
    'id: SPEC-950',
    'title: Ownership Guard Composition Fixture',
    'type: requirements',
    'tier: T3',
    `status: ${status}`,
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

import { approveSpec } from '../src/lib/approval';

function writeFixture(status: string): string {
  const specPath = path.join(tmp, specRelPath());
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, specSource(status));
  return specPath;
}

function nodeFor(specPath: string, status: string) {
  return {
    spec: {
      id: 'SPEC-950',
      title: 'Ownership Guard Composition Fixture',
      tier: 'T3',
      status,
      currentPhase: 'plan',
      filePath: specPath,
      phasesDone: 2,
      phasesTotal: 5,
    },
  };
}

function ownershipRefusals(): string[] {
  const calls = (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((c) => `${String(c[0])}\n${String((c[1] as { detail?: string })?.detail ?? '')}`)
    .filter((t) => /ownership|implements|not ready/i.test(t));
}

describe('in97 — re-approval of an already-advanced spec is not refused on implements:', () => {
  for (const status of ['planning', 'implementing']) {
    it(`approveSpecCommand records the approval for an undeclared T3 at status ${status}`, async () => {
      const specPath = writeFixture(status);
      await approveSpecCommand(nodeFor(specPath, status) as any);

      expect(ownershipRefusals(), 'refused over an advance approval never performs').toEqual([]);
      expect(readRecord(tmp, rel(specPath)), 'no approval sidecar was written').toBeDefined();
      // Approval of an already-advanced spec writes no phase: the state the guard
      // feared is never created.
      const after = parseSpec(fs.readFileSync(specPath, 'utf-8'));
      expect(after.frontmatter.phases.plan).toBe('pending');
      expect(after.frontmatter.status).toBe(status);
    });

    it(`approveSpec (lib) does not throw for an undeclared T3 at status ${status}`, () => {
      const specPath = writeFixture(status);
      expect(() => approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com')).not.toThrow();
    });
  }

  it('CONTROL: the same spec at status specifying is still refused (the advance is real)', async () => {
    const specPath = writeFixture('specifying');
    await approveSpecCommand(nodeFor(specPath, 'specifying') as any);
    expect(ownershipRefusals().length).toBeGreaterThan(0);
    expect(readRecord(tmp, rel(specPath))).toBeUndefined();
    expect(() => approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com')).toThrow(/implements/);
  });
});
