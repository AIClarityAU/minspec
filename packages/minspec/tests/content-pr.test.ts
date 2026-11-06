/**
 * T1 — which pull request last changed an artifact's content (#2854), the offline
 * binding between a delegated record's `verdictBy` and the artifact it approves.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { prFromSubject, readContentPullRequest } from '../../../scripts/lib/content-pr';

describe('prFromSubject', () => {
  it('reads squash and merge-commit subjects, nothing else', () => {
    expect(prFromSubject('docs(SPEC-139): requirements (#2728)')).toBe(2728);
    expect(prFromSubject('Merge pull request #2971 from AIClarityAU:cos/x')).toBe(2971);
    expect(prFromSubject('fix(#12): direct push')).toBeUndefined();
    expect(prFromSubject('see (#12) in the middle')).toBeUndefined();
  });
});

describe('readContentPullRequest over a real history', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });
  const repo = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-'));
    sh(root, 'init', '-q', '-b', 'main');
    sh(root, 'config', 'user.email', 't@example.com');
    sh(root, 'config', 'user.name', 't');
    return root;
  };
  const commit = (root: string, rel: string, text: string, msg: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    sh(root, 'add', rel);
    sh(root, 'commit', '-q', '-m', msg);
  };
  const REL = 'specs/SPEC-1/requirements.md';
  const doc = (status: string, body: string) => `---\nid: SPEC-1\nstatus: ${status}\ntier: T3\n---\n\n${body}\n`;

  it('skips a status-only flip and names the pull request that changed the content', () => {
    const root = repo();
    commit(root, REL, doc('specifying', 'first'), 'docs: first draft (#10)');
    commit(root, REL, doc('specifying', 'second'), 'docs: rewrite (#11)');
    commit(root, REL, doc('implementing', 'second'), 'chore(approve): SPEC-1 approved (#12)');
    expect(readContentPullRequest(root, 'main', REL)).toBe(11);
  });

  it('a content change pushed directly, with no pull request in its subject, is unknown', () => {
    const root = repo();
    commit(root, REL, doc('specifying', 'first'), 'docs: first draft (#10)');
    commit(root, REL, doc('specifying', 'edited'), 'docs: edited on main');
    expect(readContentPullRequest(root, 'main', REL)).toBeUndefined();
  });

  it('the first commit that adds the file counts as its content change', () => {
    const root = repo();
    commit(root, REL, doc('specifying', 'first'), 'docs: first draft (#10)');
    expect(readContentPullRequest(root, 'main', REL)).toBe(10);
  });

  it('a bad ref or an untracked path is unknown', () => {
    const root = repo();
    commit(root, REL, doc('specifying', 'first'), 'docs: first draft (#10)');
    expect(readContentPullRequest(root, 'nope', REL)).toBeUndefined();
    expect(readContentPullRequest(root, 'main', 'specs/none.md')).toBeUndefined();
  });
});
