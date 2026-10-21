import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRecord, writeRecord } from '../src/lib/approval-store';

// #2993: the record Accept Epic writes must be readable by the store's own reader.
// Real epics carry no `tier:` frontmatter, so the command falls back to 'T1'.
describe('epic accept sidecar round-trip (#2993)', () => {
  it('a tier-less epic yields a record readRecord accepts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-rt-'));
    try {
      const epic = path.join(root, 'EPIC-001.md');
      fs.writeFileSync(epic, '---\nid: EPIC-001\nstatus: active\n---\nbody\n');
      writeRecord(root, {
        specPath: 'docs/epics/EPIC-001.md',
        specHash: 'sha256:abc',
        approvedAt: new Date().toISOString(),
        approvedBy: 'human@example.com',
        tier: 'T1',
        migrated: false,
        baselineBlob: '',
      });
      expect(readRecord(root, 'docs/epics/EPIC-001.md')?.tier).toBe('T1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
