/**
 * commit-on-approve.ts — T3 regression (issue #577).
 *
 * Root cause: `applyStatus` (commands/adr.ts) flips a DR's frontmatter to a
 * terminal status BEFORE the accept commit runs. If the DR was created but
 * never committed, the accept commit stages it as a brand-new ADDED file
 * already claiming e.g. `accepted` — which the DR-029 born-proposed
 * pre-commit gate (`.githooks/pre-commit`) correctly rejects (a DR must be
 * born `proposed`/`draft`; acceptance is a separate, later act).
 *
 * These tests run the REAL `.githooks/pre-commit` script (core.hooksPath
 * points straight at it) so the gate under test is the actual one, not a
 * re-implementation of its logic. The unrelated `npm run validate` half of
 * that hook is disabled via DR_INDEX_GATE_OFF=1 (this temp repo has no
 * package.json to validate against) — the DR-029 born-status check stays
 * fully active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def?: unknown) => (key === 'commitOnApprove' ? true : def)),
    })),
  },
}));

import { commitBornIfUntracked, commitApprovalIfEnabled } from '../src/commands/commit-on-approve';

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');

let tmp: string;
const ORIG_DR_INDEX_GATE_OFF = process.env.DR_INDEX_GATE_OFF;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-adr-accept-'));
  // Keep the DR-029 born-status check active; skip the unrelated `npm run
  // validate` half of the same hook (no package.json exists in this temp repo).
  process.env.DR_INDEX_GATE_OFF = '1';
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (ORIG_DR_INDEX_GATE_OFF === undefined) delete process.env.DR_INDEX_GATE_OFF;
  else process.env.DR_INDEX_GATE_OFF = ORIG_DR_INDEX_GATE_OFF;
});

function git(args: string[], cwd = tmp): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function initRepoWithRealHook(dir: string): void {
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@minspec.test'], dir);
  git(['config', 'user.name', 'MinSpec Test'], dir);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR], dir);
}

function write(rel: string, content: string): string {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

/** Name-status of a single commit's changes, root-commit-safe (--root). */
function nameStatusOfCommit(rev = 'HEAD'): string[] {
  return git(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', rev])
    .trim()
    .split('\n')
    .filter(Boolean);
}

const proposedBody = (id: string) => `---\nid: ${id}\nstatus: proposed\n---\n\n# ${id}\n`;
const acceptedBody = (id: string) => `---\nid: ${id}\nstatus: accepted\n---\n\n# ${id}\n`;

describe('DR-029 gate soundness — accepting a never-committed DR (#577)', () => {
  it('sanity: the real gate DOES reject a never-committed DR staged already-accepted (documents the bug)', () => {
    initRepoWithRealHook(tmp);
    const dr = write('docs/decisions/DR-900.md', proposedBody('DR-900'));
    // The OLD applyStatus order: flip the file BEFORE it's ever committed.
    fs.writeFileSync(dr, acceptedBody('DR-900'));

    git(['add', '--', 'docs/decisions/DR-900.md']);
    expect(() => git(['commit', '-m', 'chore(accept): DR-900 -> accepted'])).toThrow();
    // Nothing landed — the gate blocked it.
    expect(() => git(['rev-parse', 'HEAD'])).toThrow();
  });

  it('commitBornIfUntracked + the normal accept commit both pass the real gate', async () => {
    initRepoWithRealHook(tmp);
    const dr = write('docs/decisions/DR-901.md', proposedBody('DR-901'));

    // Step 1 (the fix): born commit BEFORE the flip, capturing pre-flip content.
    const born = await commitBornIfUntracked(tmp, dr, 'chore(adr): add DR-901');
    expect(born?.outcome).toBe('committed');
    expect(nameStatusOfCommit()).toEqual(['A\tdocs/decisions/DR-901.md']);

    // Step 2: the real applyStatus flip, then the normal accept commit — now a
    // Modify, which DR-029 never gates.
    fs.writeFileSync(dr, acceptedBody('DR-901'));
    const { result } = await commitApprovalIfEnabled(tmp, [dr], 'chore(accept): DR-901 -> accepted');
    expect(result?.outcome).toBe('committed');
    expect(nameStatusOfCommit()).toEqual(['M\tdocs/decisions/DR-901.md']);
  });

  it('is a no-op once the DR already has a HEAD version (normal accept path unaffected)', async () => {
    initRepoWithRealHook(tmp);
    const dr = write('docs/decisions/DR-902.md', proposedBody('DR-902'));
    git(['add', '-A']);
    git(['commit', '-m', 'init: add DR-902 proposed']);

    const born = await commitBornIfUntracked(tmp, dr, 'chore(adr): add DR-902');
    expect(born).toBeUndefined(); // already tracked — nothing to split

    fs.writeFileSync(dr, acceptedBody('DR-902'));
    const { result } = await commitApprovalIfEnabled(tmp, [dr], 'chore(accept): DR-902 -> accepted');
    expect(result?.outcome).toBe('committed');
    expect(nameStatusOfCommit()).toEqual(['M\tdocs/decisions/DR-902.md']);
  });

  it('commitBornIfUntracked itself still respects the gate — a bad born status is rejected, not laundered', async () => {
    initRepoWithRealHook(tmp);
    // Hand-authored, never committed, and already claims a terminal status —
    // there is no legitimate "proposed" content to split out.
    const dr = write('docs/decisions/DR-903.md', acceptedBody('DR-903'));

    const born = await commitBornIfUntracked(tmp, dr, 'chore(adr): add DR-903');
    expect(born?.outcome).toBe('failed');
    expect(() => git(['rev-parse', 'HEAD'])).toThrow(); // nothing landed
  });
});
