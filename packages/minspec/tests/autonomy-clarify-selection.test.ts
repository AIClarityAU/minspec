/**
 * T0 - the `clarify-selection` delegated act (DR-122, proposed).
 *
 * An agent may select the recommended answer to a T3 spec's Clarify items, recorded under
 * the bot's own name, except for SPEC-217, SPEC-227 and every T4 spec. The invariants
 * pinned here, each one a refusal no delegation record can relax:
 *
 *   1. An excluded spec (SPEC-217, SPEC-227) is refused, however its id is spelled and
 *      wherever it is named (the id or any path).
 *   2. A T4 spec is refused, and so is any tier other than T3. A spec whose tier cannot be
 *      read is refused (fail closed).
 *   3. The new act does not widen `spec-approval`, `engineering-dr-acceptance` or any other
 *      act: a delegation covering one act never covers another, and the clarify gate does
 *      not touch the other acts' answers.
 *   4. A missing or unreadable `.minspec/delegations.json` denies.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BOT_ACTOR,
  CLARIFY_SELECTION_EXCLUDED_SPECS,
  STOP_CLASSES,
  evaluateDelegation,
  readDelegations,
  stopClassesAfterDelegation,
  type Delegation,
  type DelegationRequest,
  type StopClass,
  type Tier,
} from '../../../scripts/lib/autonomy';
import { frontmatterField } from '../../../scripts/lib/approval-actor';

const CLARIFY: Delegation = {
  id: 'DLG-002',
  decision: 'DR-122',
  words: 'g',
  said: '2026-11-13',
  source: 'queue item cg1112',
  repo: 'AIClarityAU/minspec',
  covers: ['clarify-selection'],
  tiers: ['T3'],
  reviewBy: '2027-02-13',
  tripwire: { metric: 'repeat-fix-share', max: 0.13 },
};

/** A record that tries to widen the act to every tier: the code must still refuse T4. */
const ROGUE_ALL_TIERS: Delegation = { ...CLARIFY, id: 'DLG-099', tiers: ['T1', 'T2', 'T3', 'T4'] };

const APPROVAL: Delegation = {
  ...CLARIFY,
  id: 'DLG-001',
  decision: 'DR-108',
  covers: ['spec-approval', 'engineering-dr-acceptance'],
  tiers: ['T1', 'T2', 'T3', 'T4'],
  reviewBy: '2027-01-17',
};

const accepted = () => 'accepted' as const;

const specPath = (id: string) => `specs/minspec/${id}-some-title/requirements.md`;

const req = (over: Partial<DelegationRequest> = {}): DelegationRequest => ({
  repo: 'AIClarityAU/minspec',
  act: 'clarify-selection',
  tier: 'T3',
  specId: 'SPEC-300',
  actor: BOT_ACTOR,
  author: 'session:spec-writer',
  verdictBy: 'ai-review:panel',
  repeatFixShare: 0.067,
  today: '2026-11-14',
  paths: [specPath('SPEC-300')],
  ...over,
});

describe('the happy path it exists for', () => {
  it('a T3 spec, not excluded, under an accepted DLG-002 → covered, recorded as the bot', () => {
    const v = evaluateDelegation([CLARIFY], accepted, req());
    expect(v).toMatchObject({ covered: true, reason: 'covered', delegationId: 'DLG-002' });
    expect(v.detail).toContain(BOT_ACTOR);
  });

  it('is inert while DR-122 is proposed (the state this pull request lands it in)', () => {
    const v = evaluateDelegation([CLARIFY], (id) => (id === 'DR-122' ? 'proposed' : 'accepted'), req());
    expect(v).toMatchObject({ covered: false, reason: 'no-live-delegation' });
  });

  it('the author never gives the verdict, as for every delegated act', () => {
    expect(evaluateDelegation([CLARIFY], accepted, req({ verdictBy: 'session:spec-writer' })).reason).toBe(
      'verdict-by-author',
    );
    expect(evaluateDelegation([CLARIFY], accepted, req({ verdictBy: '' })).reason).toBe('no-independent-verdict');
  });
});

describe('T0 invariant 1 - an excluded spec is refused', () => {
  it('the exclusion list is exactly SPEC-217 and SPEC-227', () => {
    expect([...CLARIFY_SELECTION_EXCLUDED_SPECS]).toEqual([217, 227]);
  });

  for (const id of ['SPEC-217', 'SPEC-227', 'SPEC-0217', 'spec-227', ' SPEC-217 ']) {
    it(`refuses ${JSON.stringify(id)} even under a record covering every tier`, () => {
      const n = id.trim().toUpperCase().replace(/^SPEC-0*/, 'SPEC-');
      const v = evaluateDelegation([CLARIFY, ROGUE_ALL_TIERS], accepted, req({ specId: id, paths: [specPath(n)] }));
      expect(v).toMatchObject({ covered: false, reason: 'spec-excluded' });
    });
  }

  it('refuses when an excluded spec is named only in a path, not the id', () => {
    const v = evaluateDelegation(
      [CLARIFY],
      accepted,
      req({ specId: 'SPEC-300', paths: [specPath('SPEC-300'), specPath('SPEC-217')] }),
    );
    expect(v.covered).toBe(false);
  });

  it('refuses a path that belongs to no spec, or to a different spec', () => {
    expect(evaluateDelegation([CLARIFY], accepted, req({ paths: ['docs/notes.md'] })).reason).toBe('spec-id-mismatch');
    expect(evaluateDelegation([CLARIFY], accepted, req({ paths: [specPath('SPEC-301')] })).reason).toBe(
      'spec-id-mismatch',
    );
  });

  for (const specId of [undefined, '', 'SPEC-', '217', 'SPEC-21x', 'EPIC-217']) {
    it(`refuses an unreadable spec id ${JSON.stringify(specId)}`, () => {
      expect(evaluateDelegation([CLARIFY], accepted, req({ specId })).reason).toBe('spec-id-unreadable');
    });
  }

  it('a neighbouring id is not caught by the exclusion (exact by number)', () => {
    expect(
      evaluateDelegation([CLARIFY], accepted, req({ specId: 'SPEC-2170', paths: [specPath('SPEC-2170')] })).covered,
    ).toBe(true);
  });
});

describe('T0 invariant 2 - T4, any non-T3 tier, and an unreadable tier are refused', () => {
  it('a T4 spec is refused even when a record lists T4', () => {
    const v = evaluateDelegation([ROGUE_ALL_TIERS], accepted, req({ tier: 'T4' }));
    expect(v).toMatchObject({ covered: false, reason: 'tier-excluded' });
  });

  for (const tier of ['T1', 'T2'] as Tier[]) {
    it(`a ${tier} spec is refused (the act covers T3 only)`, () => {
      expect(evaluateDelegation([ROGUE_ALL_TIERS], accepted, req({ tier })).reason).toBe('tier-excluded');
    });
  }

  for (const tier of [undefined, '', 'T5', 't3', 'T3 ', 'tier3']) {
    it(`an unreadable tier ${JSON.stringify(tier)} is refused (fail closed)`, () => {
      const v = evaluateDelegation([ROGUE_ALL_TIERS], accepted, req({ tier: tier as Tier | undefined }));
      expect(v).toMatchObject({ covered: false, reason: 'tier-unreadable' });
    });
  }

  it('a spec whose frontmatter carries no tier reads as undefined and is refused', () => {
    const spec = '---\nid: SPEC-300\ntype: requirements\nstatus: specifying\n---\n# SPEC-300\n';
    const tier = frontmatterField(spec, 'tier') as Tier | undefined;
    expect(tier).toBeUndefined();
    expect(evaluateDelegation([CLARIFY], accepted, req({ tier })).reason).toBe('tier-unreadable');
  });

  it('a spec whose frontmatter says T3 reads as T3 and passes the tier gate', () => {
    const spec = '---\nid: SPEC-300\ntier: T3  # mechanical scope\n---\n';
    const tier = frontmatterField(spec, 'tier') as Tier | undefined;
    expect(evaluateDelegation([CLARIFY], accepted, req({ tier })).covered).toBe(true);
  });
});

describe('T0 invariant 3 - the new act widens no other act', () => {
  it('DLG-001 (approval) does not cover clarify-selection', () => {
    expect(evaluateDelegation([APPROVAL], accepted, req())).toMatchObject({
      covered: false,
      reason: 'no-live-delegation',
    });
  });

  it('DLG-002 (clarify-selection) does not cover spec approval at any tier', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as Tier[]) {
      const v = evaluateDelegation([CLARIFY, ROGUE_ALL_TIERS], accepted, req({ act: 'spec-approval', tier }));
      expect(v.covered).toBe(false);
    }
  });

  it('DLG-002 does not cover an engineering-DR acceptance', () => {
    const v = evaluateDelegation(
      [CLARIFY],
      accepted,
      req({ act: 'engineering-dr-acceptance', drKind: 'engineering', paths: ['docs/decisions/DR-200.md'] }),
    );
    expect(v.covered).toBe(false);
  });

  it('the clarify gate does not change a spec approval: SPEC-217 approval under DLG-001 is judged as before', () => {
    const v = evaluateDelegation(
      [APPROVAL],
      accepted,
      req({ act: 'spec-approval', tier: 'T4', specId: undefined, paths: [specPath('SPEC-217')] }),
    );
    expect(v).toMatchObject({ covered: true, delegationId: 'DLG-001' });
  });

  it('a covered clarify selection clears approval-or-acceptance and nothing else; --admin stays a stop', () => {
    const all = STOP_CLASSES.map((s) => s.id) as StopClass[];
    const left = stopClassesAfterDelegation(all, evaluateDelegation([CLARIFY], accepted, req()));
    expect(left).toEqual(all.filter((c) => c !== 'approval-or-acceptance'));
    expect(left).toContain('irreversible-or-outward-facing');
    expect(left).toContain('edits-the-autonomy-rules');
  });

  for (const p of ['.minspec/constitution.md', '.minspec/delegations.json', 'docs/decisions/DR-122.md', 'scripts/lib/autonomy.ts']) {
    it(`never covers a governance file: ${p}`, () => {
      expect(evaluateDelegation([CLARIFY], accepted, req({ act: 'spec-approval', paths: [p] })).covered).toBe(false);
      expect(evaluateDelegation([APPROVAL], accepted, req({ act: 'spec-approval', paths: [p] })).reason).toBe(
        'touches-governance',
      );
    });
  }

  it('memory-fabric stays never-delegated for this act too', () => {
    const v = evaluateDelegation([{ ...CLARIFY, repo: 'AIClarityAU/memory-fabric' }], accepted, req({ repo: 'AIClarityAU/memory-fabric' }));
    expect(v.reason).toBe('repo-never-delegated');
  });
});

describe('T0 invariant 4 - a missing or unreadable delegations.json denies', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-clarify-'));
  const write = (root: string, text: string) => {
    fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minspec', 'delegations.json'), text);
  };
  const judge = (root: string) => evaluateDelegation(readDelegations(root), accepted, req());

  it('missing file → not covered', () => {
    expect(judge(dir())).toMatchObject({ covered: false, reason: 'no-live-delegation' });
  });
  it('malformed JSON → not covered', () => {
    const r = dir();
    write(r, '{ "version": 1, "delegations": [');
    expect(judge(r).covered).toBe(false);
  });
  it('unknown version → not covered', () => {
    const r = dir();
    write(r, JSON.stringify({ version: 2, delegations: [CLARIFY] }));
    expect(judge(r).covered).toBe(false);
  });
  it('an unreadable file (a directory where the file should be) → not covered', () => {
    const r = dir();
    fs.mkdirSync(path.join(r, '.minspec', 'delegations.json'), { recursive: true });
    expect(judge(r).covered).toBe(false);
  });
  it('a valid file with DLG-002 → covered (control: the denials above are not vacuous)', () => {
    const r = dir();
    write(r, JSON.stringify({ version: 1, delegations: [CLARIFY] }));
    expect(judge(r).covered).toBe(true);
  });
});

describe('the record on disk', () => {
  const root = path.resolve(__dirname, '../../..');
  const ds = readDelegations(root);
  const d2 = ds.find((d) => d.id === 'DLG-002');

  it('DLG-002 survives validation, covers clarify-selection only, T3 only, gated on DR-122', () => {
    expect(d2).toBeDefined();
    expect(d2?.covers).toEqual(['clarify-selection']);
    expect(d2?.tiers).toEqual(['T3']);
    expect(d2?.decision).toBe('DR-122');
  });
});
