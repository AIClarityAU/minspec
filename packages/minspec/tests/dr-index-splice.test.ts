import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spliceDrIndexEntry } from '../src/lib/dr-index-splice';
import { recoverProtectedBranchApproval, type GitRun } from '../src/lib/approval-recover';

const entry = (n: number, status: string) =>
  `## [DR-${n} — T${n}](DR-${n}.md)\n\n*Status: ${status} · Date: 2026-10-18*\n\n<!-- dr-summary:DR-${n} auto=aaa -->\ns${n}\n<!-- /dr-summary:DR-${n} -->`;
const index = (rows: Array<[number, string]>) =>
  `<!-- minspec:dr-index:start -->\n# Decision Register\n\n_intro_\n\n${rows.map(([n, s]) => entry(n, s)).join('\n\n')}\n<!-- minspec:dr-index:end -->\n`;

describe('spliceDrIndexEntry — #2912', () => {
  it('applies only the target row; other rows stay as in the base', () => {
    const base = index([[107, 'proposed'], [108, 'proposed'], [109, 'proposed']]);
    const work = index([[107, 'accepted'], [108, 'accepted'], [109, 'accepted']]);
    const out = spliceDrIndexEntry(base, work, 'DR-108')!;
    expect(out).toBe(index([[107, 'proposed'], [108, 'accepted'], [109, 'proposed']]));
  });
  it('inserts a missing row in id order', () => {
    const base = index([[107, 'accepted'], [109, 'accepted']]);
    const work = index([[107, 'accepted'], [108, 'accepted'], [109, 'accepted']]);
    expect(spliceDrIndexEntry(base, work, 'DR-108')).toBe(work);
  });
  it('returns null when the working index lacks the id', () => {
    expect(spliceDrIndexEntry(index([[1, 'accepted']]), index([[1, 'accepted']]), 'DR-2')).toBeNull();
  });
  it('preserves CRLF of the base', () => {
    const base = index([[1, 'proposed']]).replace(/\n/g, '\r\n');
    const out = spliceDrIndexEntry(base, index([[1, 'accepted']]), 'DR-1')!;
    expect(out).toBe(index([[1, 'accepted']]).replace(/\n/g, '\r\n'));
  });
});

describe('recoverProtectedBranchApproval INDEX handling — #2912', () => {
  it('commits origin/main INDEX + only the target row, not the shared checkout whole file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-idx-'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-idx-wt-'));
    const dir = path.join(root, 'docs', 'decisions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'DR-108.md'), 'x');
    fs.writeFileSync(path.join(dir, 'INDEX.md'), index([[107, 'accepted'], [108, 'accepted'], [109, 'accepted']]));
    const wtDir = path.join(tmp, 'wt');
    const run: GitRun = async (args) => {
      if (args[0] === 'remote') return 'https://github.com/O/R.git\n';
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(path.join(wtDir, 'docs', 'decisions'), { recursive: true });
        fs.writeFileSync(path.join(wtDir, 'docs', 'decisions', 'INDEX.md'), index([[107, 'proposed'], [108, 'proposed'], [109, 'proposed']]));
      }
      if (args[0] === 'diff') throw new Error('delta');
      return '';
    };
    let seen = '';
    const wrapped: GitRun = async (args, o) => {
      if (args[0] === 'commit') seen = fs.readFileSync(path.join(wtDir, 'docs', 'decisions', 'INDEX.md'), 'utf-8');
      return run(args, o);
    };
    const res = await recoverProtectedBranchApproval(
      root,
      [path.join(dir, 'DR-108.md'), path.join(dir, 'INDEX.md')],
      'chore(accept): DR-108',
      { slug: 'DR-108' },
      { run: wrapped, mkTempDir: () => tmp },
    );
    expect(res.outcome).toBe('recovered');
    expect(seen).toBe(index([[107, 'proposed'], [108, 'accepted'], [109, 'proposed']]));
  });
});
