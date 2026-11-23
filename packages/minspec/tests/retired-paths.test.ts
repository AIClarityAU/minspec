import { describe, it, expect } from 'vitest';
import {
  RETIRED_PATHS,
  RETIRED_PATH_EXEMPT,
  RETIRED_PATH_BASELINE,
  scanRetiredPaths,
  scanRetiredPathCorpus,
  splitByBaseline,
  type RetiredPathRow,
} from '../src/lib/retired-paths';

const scan = (text: string, table?: readonly RetiredPathRow[]) => scanRetiredPaths('x.md', text, table);

describe('retired-paths (SPEC-202)', () => {
  it('AC-1: authoritative-source citation fails and names the sidecar', () => {
    const f = scan('The status is read live from the authoritative source (approvals.json + frontmatter).');
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('.minspec/approvals/<spec-path>.json');
    expect(f[0].message).toContain('x.md:1');
  });

  it('AC-2: a historical sentence passes', () => {
    expect(scan('`.minspec/approvals.json` was retired by DR-034.')).toEqual([]);
  });

  it('AC-3: a dated amendment block passes, and ends at the next same-level heading', () => {
    const doc = [
      '## Amendment (2026-07-01)',
      '',
      'The store lives in `.minspec/approvals.json` here.',
      '',
      '## Next section',
      '',
      'Read the hash from `.minspec/approvals.json`.',
    ].join('\n');
    const f = scan(doc);
    expect(f.map((x) => x.line)).toEqual([7]);
  });

  it('AC-4: ledger present-tense fails; "never created" passes', () => {
    expect(scan('A single committed `.minspec/approval-ledger.jsonl` records approvals.')).toHaveLength(1);
    expect(scan('No `approval-ledger.jsonl` was ever created and no code writes one.')).toEqual([]);
  });

  it('AC-5: a second denylist row fails with no matching-code change', () => {
    const table: RetiredPathRow[] = [
      ...RETIRED_PATHS,
      { path: /old-store\.db/, label: 'old-store.db', status: 'retired', replacement: 'new-store', since: 'DR-999', why: 'moved' },
    ];
    const f = scan('Read it from old-store.db.', table);
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('new-store');
  });

  it('AC-7: a marker in a DIFFERENT sentence does not license the match', () => {
    expect(scan('This was hard. Read the hash from `.minspec/approvals.json`.')).toHaveLength(1);
    expect(scan('- it was once different\n- hash lives in `.minspec/approvals.json`')).toHaveLength(1);
  });

  it('a blockquote or fence introduced by a marked line passes', () => {
    expect(scan('The old store was:\n\n```\n.minspec/approvals.json\n```')).toEqual([]);
    expect(scan('Formerly the store read:\n\n> hash in .minspec/approvals.json')).toEqual([]);
    expect(scan('The store reads:\n\n```\n.minspec/approvals.json\n```')).toHaveLength(1);
  });

  it('does not match the live sidecar directory or lookalike names', () => {
    expect(scan('Sidecars live under `.minspec/approvals/specs/x.md.json`.')).toEqual([]);
    expect(scan('See pending-approvals.json for the queue.')).toEqual([]);
  });

  it('AC-6 / FR-8: an unreadable file is a visible failure, not a clean scan', () => {
    const r = scanRetiredPathCorpus({
      files: ['a.md', 'b.md'],
      read: (f) => {
        if (f === 'b.md') throw new Error('EACCES');
        return 'clean';
      },
    });
    expect(r.unreadable).toEqual([{ file: 'b.md', cause: 'EACCES' }]);
    expect(r.scanned).toBe(1);
  });

  it('FR-6: exemption list is short and exact', () => {
    expect(RETIRED_PATH_EXEMPT).toEqual([
      'specs/minspec/SPEC-202-retired-path-denylist/',
      'packages/minspec/src/lib/retired-paths.ts',
      'packages/minspec/tests/retired-paths.test.ts',
    ]);
    const r = scanRetiredPathCorpus({
      files: ['packages/minspec/src/lib/retired-paths.ts'],
      read: () => 'read approvals.json now',
    });
    expect(r.scanned).toBe(0);
  });

  it('baseline ratchet: grandfathers up to the count, errors beyond or for new files', () => {
    const mk = (file: string) => scanRetiredPaths(file, 'Read approvals.json.\n\nRead approvals.json.');
    const findings = [...mk('old.md'), ...mk('new.md')];
    const { errors, grandfathered } = splitByBaseline(findings, { 'old.md': 1 });
    expect(grandfathered.map((f) => f.file)).toEqual(['old.md']);
    expect(errors.map((f) => f.file)).toEqual(['old.md', 'new.md', 'new.md']);
    expect(Object.values(RETIRED_PATH_BASELINE).every((n) => n > 0)).toBe(true);
  });
});
