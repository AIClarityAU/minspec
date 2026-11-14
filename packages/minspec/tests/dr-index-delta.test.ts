/**
 * #896 — discarding a newly created DR file must leave INDEX.md exactly as it was.
 *
 * The decisions watcher used to run a full `regenerateDrIndex` on create AND on
 * delete. A full rebuild also rewrites every other entry that drifted from its
 * file, so a create followed by a discard left those rewrites behind and INDEX.md
 * stayed modified in Source Control. The watcher now touches only the entries of
 * the decisions whose files fired (`regenerateDrIndexEntries`), driven by
 * `DrIndexDeltaTracker`, with `applyDrIndexDelta` as the pure string step.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyDrIndexDelta } from '../src/lib/dr-index-splice';
import { regenerateDrIndex, regenerateDrIndexEntries, drIdForFile } from '../src/lib/adr-manager';
import { DrIndexDeltaTracker } from '../src/lib/dr-index-delta';

const entry = (n: number, status: string) =>
  `## [DR-${n} — T${n}](DR-${n}.md)\n\n*Status: ${status} · Date: 2026-10-18*\n\n<!-- dr-summary:DR-${n} auto=aaa -->\ns${n}\n<!-- /dr-summary:DR-${n} -->`;
const index = (rows: Array<[number, string]>, tail = '') =>
  `<!-- minspec:dr-index:start -->\n# Decision Register\n\n_intro_\n\n${rows.map(([n, s]) => entry(n, s)).join('\n\n')}\n<!-- minspec:dr-index:end -->\n${tail}`;

describe('applyDrIndexDelta — #896', () => {
  it('inserting then removing the same id returns the INDEX byte for byte', () => {
    const cur = index([[1, 'proposed'], [2, 'accepted']], '\n## Notes\n\nhand-written\n');
    const fresh = index([[1, 'accepted'], [2, 'accepted'], [3, 'proposed']]);
    const added = applyDrIndexDelta(cur, fresh, ['DR-3'])!;
    // Only DR-3 arrived; DR-1's drift (proposed vs accepted on disk) is left alone.
    expect(added).toBe(index([[1, 'proposed'], [2, 'accepted'], [3, 'proposed']], '\n## Notes\n\nhand-written\n'));
    const afterDelete = index([[1, 'accepted'], [2, 'accepted']]);
    expect(applyDrIndexDelta(added, afterDelete, ['DR-3'])).toBe(cur);
  });

  it('replaces an existing entry in place', () => {
    const cur = index([[1, 'proposed'], [2, 'proposed']]);
    const fresh = index([[1, 'accepted'], [2, 'accepted']]);
    expect(applyDrIndexDelta(cur, fresh, ['DR-2'])).toBe(index([[1, 'proposed'], [2, 'accepted']]));
  });

  it('removing an id the INDEX never had is a no-op', () => {
    const cur = index([[1, 'proposed']]);
    expect(applyDrIndexDelta(cur, cur, ['DR-9'])).toBe(cur);
  });

  it('keeps CRLF line endings of the current INDEX', () => {
    const cur = index([[1, 'proposed']]).replace(/\n/g, '\r\n');
    const out = applyDrIndexDelta(cur, index([[1, 'proposed'], [2, 'proposed']]), ['DR-2'])!;
    expect(out).toBe(index([[1, 'proposed'], [2, 'proposed']]).replace(/\n/g, '\r\n'));
  });

  it('returns null when the INDEX is not a markered register', () => {
    expect(applyDrIndexDelta('# Decision Register\n\nfree text\n', index([[1, 'x']]), ['DR-1'])).toBeNull();
    expect(applyDrIndexDelta(index([[1, 'x']]), '# no markers\n', ['DR-1'])).toBeNull();
  });

  it('returns null when the register would end up empty (different header)', () => {
    const empty = '<!-- minspec:dr-index:start -->\n# Decision Register\n\n_No decisions recorded yet._\n<!-- minspec:dr-index:end -->\n';
    expect(applyDrIndexDelta(index([[1, 'proposed']]), empty, ['DR-1'])).toBeNull();
    expect(applyDrIndexDelta(empty, index([[1, 'proposed']]), ['DR-1'])).toBeNull();
  });
});

describe('regenerateDrIndexEntries — create then discard (#896)', () => {
  let root: string;
  let dir: string;
  const indexPath = () => path.join(dir, 'INDEX.md');
  const writeDr = (name: string, id: string, status: string) =>
    fs.writeFileSync(
      path.join(dir, name),
      `---\nid: ${id}\ntitle: Title ${id}\nstatus: ${status}\ndate: 2026-10-18\n---\n\n# ${id}\n\n## Context\n\nWhy ${id} exists.\n`,
      'utf-8',
    );

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-896-'));
    fs.mkdirSync(path.join(root, '.minspec'));
    fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ decisionsDir: 'docs/decisions' }));
    dir = path.join(root, 'docs', 'decisions');
    fs.mkdirSync(dir, { recursive: true });
    writeDr('DR-001-alpha.md', 'DR-001', 'proposed');
    writeDr('DR-002-beta.md', 'DR-002', 'accepted');
    regenerateDrIndex(root);
    // The committed INDEX has drifted from DR-001's file (the #220 / #2021 class):
    // the file says accepted, the INDEX still says proposed.
    writeDr('DR-001-alpha.md', 'DR-001', 'accepted');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a discard of the new DR returns INDEX.md to its committed bytes', () => {
    const committed = fs.readFileSync(indexPath(), 'utf-8');
    writeDr('DR-099-test.md', 'DR-099', 'proposed');
    regenerateDrIndexEntries(root, ['DR-099']);
    const afterCreate = fs.readFileSync(indexPath(), 'utf-8');
    expect(afterCreate).toContain('DR-099');
    expect(afterCreate).not.toBe(committed);

    fs.rmSync(path.join(dir, 'DR-099-test.md'));
    regenerateDrIndexEntries(root, ['DR-099']);
    expect(fs.readFileSync(indexPath(), 'utf-8')).toBe(committed);
  });

  it('control: the full rebuild the watcher used to run leaves residue', () => {
    const committed = fs.readFileSync(indexPath(), 'utf-8');
    writeDr('DR-099-test.md', 'DR-099', 'proposed');
    regenerateDrIndex(root);
    fs.rmSync(path.join(dir, 'DR-099-test.md'));
    regenerateDrIndex(root);
    expect(fs.readFileSync(indexPath(), 'utf-8')).not.toBe(committed);
  });

  it('does not rewrite the file when nothing changes', () => {
    const before = fs.statSync(indexPath()).mtimeMs;
    fs.utimesSync(indexPath(), new Date(1_000_000), new Date(1_000_000));
    regenerateDrIndexEntries(root, ['DR-002']);
    expect(fs.statSync(indexPath()).mtimeMs).toBe(1_000_000);
    expect(before).toBeGreaterThan(0);
  });

  it('falls back to a full rebuild when there is no INDEX yet', () => {
    fs.rmSync(indexPath());
    const result = regenerateDrIndexEntries(root, ['DR-001']);
    expect(result.count).toBe(2);
    expect(fs.readFileSync(indexPath(), 'utf-8')).toContain('DR-002');
  });
});

describe('DrIndexDeltaTracker / drIdForFile — #896', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-896-t-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('drIdForFile prefers the frontmatter id, falls back to the file name, ignores non-DR files', () => {
    const f = path.join(dir, 'DR-005-x.md');
    fs.writeFileSync(f, '---\nid: DR-050\n---\n');
    expect(drIdForFile(f)).toBe('DR-050');
    expect(drIdForFile(path.join(dir, 'DR-006-gone.md'))).toBe('DR-006');
    expect(drIdForFile(path.join(dir, 'INDEX.md'))).toBeNull();
    expect(drIdForFile(path.join(dir, 'README.md'))).toBeNull();
  });

  it('a delete names the id seen at create, not the file name', () => {
    const t = new DrIndexDeltaTracker();
    const f = path.join(dir, 'DR-005-x.md');
    fs.writeFileSync(f, '---\nid: DR-050\n---\n');
    t.note(f, false, dir);
    expect(t.take()).toEqual({ full: false, ids: ['DR-050'] });
    fs.rmSync(f);
    t.note(f, true, dir);
    expect(t.take()).toEqual({ full: false, ids: ['DR-050'] });
  });

  it('remember() seeds the id for a file that existed before activation', () => {
    const t = new DrIndexDeltaTracker();
    const f = path.join(dir, 'DR-005-x.md');
    t.remember(f, 'DR-050');
    t.note(f, true, dir);
    expect(t.take().ids).toEqual(['DR-050']);
  });

  it('an edit that changes the id touches both the old and the new entry', () => {
    const t = new DrIndexDeltaTracker();
    const f = path.join(dir, 'DR-005-x.md');
    t.remember(f, 'DR-005');
    fs.writeFileSync(f, '---\nid: DR-050\n---\n');
    t.note(f, false, dir);
    expect(t.take().ids).toEqual(['DR-005', 'DR-050']);
  });

  it('ignores sub-folders and non-DR files; an unresolvable register asks for a full rebuild', () => {
    const t = new DrIndexDeltaTracker();
    t.note(path.join(dir, 'archive', 'DR-001-old.md'), true, dir);
    t.note(path.join(dir, 'README.md'), false, dir);
    expect(t.take()).toEqual({ full: false, ids: [] });
    t.note(path.join(dir, 'DR-001-a.md'), true, null);
    expect(t.take().full).toBe(true);
    expect(t.take()).toEqual({ full: false, ids: [] });
    t.markFull();
    expect(t.take().full).toBe(true);
  });
});
