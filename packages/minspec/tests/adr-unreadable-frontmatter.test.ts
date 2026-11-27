/**
 * SPEC-095 FR-6 (AC-14), task 6.4 — a writer never mistakes "could not read the
 * frontmatter" for "has no frontmatter".
 *
 * Before this change `setAdrStatus` synthesized and prepended a fresh block whenever its
 * frontmatter pattern did not match. On a record that DOES open with `---` but whose block
 * the pattern cannot read (a blank line before it, a missing closing fence, a leading byte
 * order mark) that put a second block in front of the first, and the record then asserted
 * two statuses (#2467, DQ-5). The Accept and Set Decision Status path also read such a
 * record as "predates MinSpec" and offered to add frontmatter.
 *
 * The rule: decide by the record's first non-blank line, a leading U+FEFF ignored. Not
 * `---` → no frontmatter, synthesize (unchanged, #201). `---` with no readable block →
 * throw, name the file, write nothing; the command shows that error and no offer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    tabGroups: undefined as unknown,
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(() => Promise.resolve({})),
    getWorkspaceFolder: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

vi.mock('../src/lib/adr-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/adr-manager')>()),
  regenerateDrIndex: vi.fn(),
  validatePendingDrAmendments: vi.fn(() => []),
}));
vi.mock('../src/lib/approval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/approval')>()),
  gitConfigEmail: vi.fn(() => 'human@example.com'),
  canonicalSpecHash: vi.fn(() => 'hash'),
}));
vi.mock('../src/lib/approval-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/approval-store')>()),
  writeRecord: vi.fn(),
}));
vi.mock('../src/commands/commit-on-approve', () => ({
  commitApprovalIfEnabled: vi.fn(async () => ({ suffix: '' })),
  commitBornIfUntracked: vi.fn(),
}));

import * as vscode from 'vscode';
import { adrHasFrontmatter, adrFrontmatterState, setAdrStatus } from '../src/lib/adr-manager';
import { acceptAdrCommand, setAdrStatusCommand } from '../src/commands/adr';
import { commitBornIfUntracked } from '../src/commands/commit-on-approve';

const READABLE = '---\nid: DR-001\ntitle: Use PG\nstatus: proposed\ndate: 2026-01-01\n---\n\n# DR-001 - Use PG\n\nBody.\n';
/** A blank line before the block: FRONTMATTER_RE anchors at byte 0 and misses it. */
const BLANK_FIRST = `\n${READABLE}`;
/** The block never closes. */
const UNCLOSED = '---\nid: DR-001\ntitle: Use PG\nstatus: proposed\n\n# DR-001 - Use PG\n\nBody.\n';
/** A leading byte order mark in front of an otherwise readable block. */
const BOM_FIRST = `﻿${READABLE}`;
/** A hand-written record with no frontmatter (#201): still gets a block. */
const NO_FRONTMATTER = '# DR-001 - Use PG\n\n**Status:** Proposed\n\nBody.\n';
const BLANK_THEN_HEADING = `\n\n${NO_FRONTMATTER}`;

const crlf = (s: string): string => s.replace(/\n/g, '\r\n');

let root: string;
let decisions: string;

function writeDr(name: string, content: string): string {
  const p = path.join(decisions, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec095-fr6-'));
  decisions = path.join(root, 'docs', 'decisions');
  fs.mkdirSync(decisions, { recursive: true });
  const folder = { uri: { fsPath: root }, name: 'ws', index: 0 };
  (vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [folder];
  vi.mocked(vscode.workspace.getWorkspaceFolder).mockImplementation((() => folder) as never);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── T0: the classifier and the writer ──────────────────────────────────────

describe('SPEC-095 FR-6: adrFrontmatterState decides by the first non-blank line', () => {
  it.each([
    ['a readable block', 'present', READABLE],
    ['a readable CRLF block (prepared before the check)', 'present', crlf(READABLE)],
    ['a blank line before the block', 'unreadable', BLANK_FIRST],
    ['an unclosed block', 'unreadable', UNCLOSED],
    ['a leading byte order mark before the fence', 'unreadable', BOM_FIRST],
    ['no frontmatter', 'absent', NO_FRONTMATTER],
    ['blank lines, then a heading', 'absent', BLANK_THEN_HEADING],
    ['an empty file', 'absent', ''],
  ])('%s → %s', (_label, expected, content) => {
    const text = content.replace(/\r\n?/g, '\n');
    expect(adrFrontmatterState(text)).toBe(expected);
  });
});

describe('SPEC-095 FR-6: setAdrStatus refuses a record that opens with --- and has no readable block', () => {
  it.each([
    ['LF, a blank line before the block', BLANK_FIRST],
    ['CRLF, a blank line before the block', crlf(BLANK_FIRST)],
    ['LF, an unclosed block', UNCLOSED],
    ['CRLF, an unclosed block', crlf(UNCLOSED)],
    ['a leading byte order mark', BOM_FIRST],
  ])('%s: throws, names the file, and writes nothing', (_label, content) => {
    const p = writeDr('DR-001-use-pg.md', content);
    const before = fs.readFileSync(p);
    expect(() => setAdrStatus(p, 'accepted')).toThrow(/DR-001-use-pg\.md/);
    expect(fs.readFileSync(p).equals(before), 'the refused record was modified').toBe(true);
  });

  it.each([
    ['LF', NO_FRONTMATTER],
    ['CRLF', crlf(NO_FRONTMATTER)],
    ['blank lines, then a heading', BLANK_THEN_HEADING],
  ])('a record that does not open with --- still gets one block (%s)', (_label, content) => {
    const p = writeDr('DR-001-use-pg.md', content);
    expect(setAdrStatus(p, 'accepted')).toBe('accepted');
    const after = fs.readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
    expect(after.startsWith('---\n')).toBe(true);
    expect(after.match(/^status:/gm)).toHaveLength(1);
    expect(after).toMatch(/^status: accepted$/m);
  });

  it.each([
    ['LF', READABLE],
    ['CRLF', crlf(READABLE)],
  ])('a readable record has its status set in place (%s control)', (_label, content) => {
    const p = writeDr('DR-001-use-pg.md', content);
    setAdrStatus(p, 'accepted');
    const after = fs.readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
    expect(after.match(/^---$/gm)).toHaveLength(2);
    expect(after).toMatch(/^status: accepted$/m);
  });
});

describe('SPEC-095 FR-6: adrHasFrontmatter', () => {
  it('is true for a readable block and false for none or a missing file', () => {
    expect(adrHasFrontmatter(writeDr('DR-001-a.md', READABLE))).toBe(true);
    expect(adrHasFrontmatter(writeDr('DR-002-b.md', NO_FRONTMATTER))).toBe(false);
    expect(adrHasFrontmatter(path.join(decisions, 'DR-404-missing.md'))).toBe(false);
  });

  it('throws, naming the file, for a block it cannot read, so no caller offers to add one', () => {
    const p = writeDr('DR-003-c.md', UNCLOSED);
    expect(() => adrHasFrontmatter(p)).toThrow(/DR-003-c\.md/);
  });
});

// ─── T2: the two commands ───────────────────────────────────────────────────

describe('SPEC-095 FR-6: Accept and Set Decision Status on an unreadable block', () => {
  const nodeFor = (filePath: string, status = 'proposed') =>
    ({ adr: { id: 'DR-001', status, filePath } }) as never;

  it('Accept shows the error, offers no frontmatter, commits nothing and leaves the file unchanged', async () => {
    const p = writeDr('DR-001-use-pg.md', crlf(UNCLOSED));
    const before = fs.readFileSync(p);

    await acceptAdrCommand(nodeFor(p));

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(commitBornIfUntracked).not.toHaveBeenCalled();
    const err = vi.mocked(vscode.window.showErrorMessage).mock.calls[0]?.[0] as string;
    expect(err).toContain('DR-001-use-pg.md');
    expect(err).not.toMatch(/predates MinSpec/);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });

  it('Set Decision Status shows the error, offers no frontmatter and leaves the file unchanged', async () => {
    const p = writeDr('DR-001-use-pg.md', BLANK_FIRST);
    const before = fs.readFileSync(p);
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce((async (
      items: readonly { value: string }[],
    ) => items.find((i) => i.value === 'deprecated')) as never);

    await setAdrStatusCommand(nodeFor(p));

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    const err = vi.mocked(vscode.window.showErrorMessage).mock.calls[0]?.[0] as string;
    expect(err).toContain('DR-001-use-pg.md');
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });

  it('a record with no frontmatter still gets the existing "predates MinSpec" offer', async () => {
    const p = writeDr('DR-001-use-pg.md', NO_FRONTMATTER);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Add Frontmatter' as never);

    await acceptAdrCommand(nodeFor(p));

    const warn = vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[0] as string;
    expect(warn).toContain('predates MinSpec');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    const after = fs.readFileSync(p, 'utf-8');
    expect(after.match(/^status:/gm)).toHaveLength(1);
    expect(after).toMatch(/^status: accepted$/m);
  });
});
