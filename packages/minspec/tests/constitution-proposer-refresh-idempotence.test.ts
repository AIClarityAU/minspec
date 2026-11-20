import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { integrateProposal } from '../src/lib/constitution-proposer';
import { generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';

describe('#940 refresh idempotence over a bare scaffold', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms940-'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('generate → refresh → refresh leaves constitution.md byte-identical', () => {
    generateHarnessFiles(dir);
    const p = path.join(dir, '.minspec', 'constitution.md');
    refreshHarnessFiles(dir);
    const a = fs.readFileSync(p, 'utf8');
    refreshHarnessFiles(dir);
    const b = fs.readFileSync(p, 'utf8');
    expect(b).toBe(a);
    expect((b.match(/Honor CLAUDE\.md project instructions/g) ?? []).length).toBe(1);
  });
});

describe('#940 integrateProposal recognises the template-rendered DRAFT form', () => {
  const candidate = {
    id: 'SEED-1',
    section: 'Principles' as const,
    text: 'Honor CLAUDE.md project instructions — they override default behavior.',
    provenance: 'a CLAUDE.md instructions file is present',
    draft: true as const,
  };
  const proposal = { candidates: [candidate], notableUnwritten: [] };

  it('does not re-add a candidate present as `N. DRAFT: text > _proposed because …_`', () => {
    const existing =
      '# C\n\n## Principles\n\n1. DRAFT: Honor CLAUDE.md project instructions — they override default behavior. > _proposed because a CLAUDE.md instructions file is present_\n';
    const r = integrateProposal(existing, proposal);
    expect(r.added).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect((r.merged.match(/Honor CLAUDE\.md/g) ?? []).length).toBe(1);
  });

  it('is a fixed point across repeated integration of the bulleted form', () => {
    const once = integrateProposal('# C\n', proposal).merged;
    expect(integrateProposal(once, proposal).merged).toBe(once);
  });
});
