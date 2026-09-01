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
      get: vi.fn((key: string, def?: unknown) => {
        if (key === 'commitOnApprove') return true;
        // These tests are about COMMITTING. Pin push off so they neither hit the
        // network nor need the notification surface; the push path has its own
        // unit tests (approve-push.test.ts) and wiring test (approve-push-wiring).
        if (key === 'pushOnApprove') return 'never';
        return def;
      }),
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

/**
 * #1133 — the born-commit leg used to swallow `'protected-branch'` entirely:
 * no console line, no toast, no trace. `commitApprovalIfEnabled`'s sibling arm
 * for the SAME outcome already warned; this leg did not, even though it is the
 * step #577 exists for (turning an accept commit into a Modify instead of a
 * DR-029-violating Add). On the default branch it must never be silent.
 */
describe('#1133 — commitBornIfUntracked on the default branch is never silent', () => {
  function setDefaultBranch(dir: string, branch: string): void {
    // origin/HEAD is a LOCAL ref — this stays offline (Tier-0), same helper
    // as approve-commit.test.ts's #1064 suite.
    git(['remote', 'add', 'origin', dir], dir);
    git(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'], dir);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`], dir);
  }

  it('reports protected-branch (not undefined, not failed) and console.warns', async () => {
    initRepoWithRealHook(tmp);
    write('seed.md', 'seed\n');
    git(['add', '-A']);
    git(['commit', '-m', 'seed']);
    setDefaultBranch(tmp, 'main');

    const dr = write('docs/decisions/DR-904.md', proposedBody('DR-904'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const born = await commitBornIfUntracked(tmp, dr, 'chore(adr): add DR-904');

    expect(born?.outcome).toBe('protected-branch');
    expect(born?.paths).toEqual(['docs/decisions/DR-904.md']);
    // Never silent: this is the exact signal that was missing before #1133.
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('born commit skipped')),
    ).toBe(true);
    // Refused BEFORE staging — the DR is still untracked, HEAD unmoved.
    expect(git(['log', '--oneline']).trim().split('\n')).toHaveLength(1);
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');

    warnSpy.mockRestore();
  });
});
