import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { scopeIndexToDr } from '../src/lib/dr-index-scope';

const entry = (n: number, status: string) =>
  `## [DR-${n} — T${n}](DR-${n}.md)\n\n*Status: ${status} · Date: 2026-10-18*\n\n<!-- dr-summary:DR-${n} auto=aaa -->\ns${n}\n<!-- /dr-summary:DR-${n} -->`;
const index = (rows: Array<[number, string]>) =>
  `<!-- minspec:dr-index:start -->\n# Decision Register\n\n_intro_\n\n${rows.map(([n, s]) => entry(n, s)).join('\n\n')}\n<!-- minspec:dr-index:end -->\n`;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' });

describe('scopeIndexToDr — #2021', () => {
  let root: string;
  let indexPath: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-idx-'));
    fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
    indexPath = path.join(root, 'docs', 'decisions', 'INDEX.md');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("drops another DR's regenerated row (DR-090 riding with DR-091)", () => {
    git(root, 'init', '-q');
    fs.writeFileSync(indexPath, index([[90, 'proposed'], [91, 'proposed']]));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    // regenerated from disk: both DRs accepted on disk, only DR-91 is being accepted
    fs.writeFileSync(indexPath, index([[90, 'accepted'], [91, 'accepted']]));
    expect(scopeIndexToDr(root, indexPath, 'DR-91')).toBe(true);
    expect(fs.readFileSync(indexPath, 'utf-8')).toBe(index([[90, 'proposed'], [91, 'accepted']]));
  });

  it('leaves the file untouched when there is no committed INDEX', () => {
    git(root, 'init', '-q');
    const work = index([[91, 'accepted']]);
    fs.writeFileSync(indexPath, work);
    expect(scopeIndexToDr(root, indexPath, 'DR-91')).toBe(false);
    expect(fs.readFileSync(indexPath, 'utf-8')).toBe(work);
  });

  it('leaves the file untouched when the INDEX lacks the id', () => {
    git(root, 'init', '-q');
    fs.writeFileSync(indexPath, index([[90, 'proposed']]));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const work = index([[90, 'accepted']]);
    fs.writeFileSync(indexPath, work);
    expect(scopeIndexToDr(root, indexPath, 'DR-91')).toBe(false);
    expect(fs.readFileSync(indexPath, 'utf-8')).toBe(work);
  });
});
