/**
 * #3463 — a spec citing a delegation for an act its `covers` list omits must fail CI.
 * Unit half pins the predicate; the T0 half runs the real validator on a temp corpus,
 * because that is what CI runs.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findWrongDelegationCitations,
  isCorrectedSpec,
  CORRECTED_SPECS,
} from '../../../scripts/lib/delegation-citation';

const DLG = [{ id: 'DLG-001', covers: ['spec-approval', 'engineering-dr-acceptance'] }];
const WRONG =
  'All 3 decisions are resolved: an agent session recorded each option this document already\n' +
  'recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human\n' +
  'chose them.\n';

describe('findWrongDelegationCitations', () => {
  it('flags a Clarify selection recorded under a delegation that covers approval only', () => {
    const f = findWrongDelegationCitations(`## Decisions needed (Clarify)\n\n${WRONG}`, DLG);
    expect(f).toHaveLength(1);
    expect(f[0].delegation).toBe('DLG-001');
    expect(f[0].act).toBe('resolved');
  });

  it('accepts approval under the delegation', () => {
    const t = "Ratified only by approval of this spec, the founder's or the bot's under DLG-001.\n";
    expect(findWrongDelegationCitations(t, DLG)).toEqual([]);
  });

  it('accepts a disclaimer that the delegation made no selection', () => {
    const t = 'Delegation DLG-001 (DR-108) made none of these selections and covers approval only.\n';
    expect(findWrongDelegationCitations(t, DLG)).toEqual([]);
  });

  it('ignores citations inside code fences', () => {
    expect(findWrongDelegationCitations('```\n' + WRONG + '```\n', DLG)).toEqual([]);
  });

  it('flags the citation when the delegation id is unknown', () => {
    const t = 'An agent recorded it under delegation DLG-009.\n';
    expect(findWrongDelegationCitations(t, DLG)).toHaveLength(1);
  });
});

describe('isCorrectedSpec', () => {
  it('exempts only specs the correction note lists, by id', () => {
    expect(isCorrectedSpec('specs/minspec/SPEC-204-found-by-trailer/requirements.md')).toBe(true);
    expect(isCorrectedSpec('specs/minspec/SPEC-258-new/requirements.md')).toBe(false);
    expect(isCorrectedSpec('specs/minspec/SPEC-2040-x/requirements.md')).toBe(false);
  });

  it('lists exactly the ids in the correction note', () => {
    const note = fs.readFileSync(
      path.resolve(__dirname, '../../../docs/corrections/2026-10-31-dlg-001-clarify-citation.md'),
      'utf-8',
    );
    const listed = [...note.matchAll(/^- (SPEC-\d+):/gm)].map(m => m[1]);
    expect([...CORRECTED_SPECS]).toEqual(listed);
  });
});

describe('validate (T0)', () => {
  const root = path.resolve(__dirname, '../../..');
  function run(specId: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-'));
    fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.minspec', 'delegations.json'),
      JSON.stringify({ delegations: DLG }),
    );
    const sd = path.join(dir, 'specs', 'x', `${specId}-t`);
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'requirements.md'), `# t\n\n${WRONG}`);
    const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/validate-frontmatter.ts')], {
      cwd: dir,
      encoding: 'utf-8',
    });
    return r.stdout + r.stderr;
  }

  it('fails on a new spec with a wrong citation', { timeout: 60000 }, () => {
    expect(run('SPEC-900')).toMatch(/cites DLG-001 for/);
  });

  it('does not flag a listed spec', { timeout: 60000 }, () => {
    expect(run('SPEC-204')).not.toMatch(/cites DLG-001/);
  });
});
