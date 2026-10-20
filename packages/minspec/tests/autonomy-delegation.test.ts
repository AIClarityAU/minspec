/**
 * T0 — delegated approval under the bot's own name (DR-108, queue item ctg change 8).
 *
 * The invariants this file pins, each one a rule a delegation can NEVER relax:
 *
 *   1. memory-fabric is never delegated, whatever a delegation record says.
 *   2. Nothing is recorded under the founder's identity: the only actor a delegation
 *      admits is the App bot, by exact name.
 *   3. `--admin` (and every other irreversible / outward-facing act) is never
 *      automated: a delegation clears the approval-or-acceptance stop class and
 *      NOTHING else.
 *
 * And the fail-closed edges around them: the author never gives the verdict, a
 * delegation is inert until its decision record is accepted, a tripped or unknown
 * repeat-fix share suspends it, a direction record is never delegated, and the
 * governance files (constitution, stop list, delegations, autonomy setting) are
 * never approved on a delegation.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BOT_ACTOR,
  STOP_CLASSES,
  evaluateDelegation,
  stopClassesAfterDelegation,
  readDelegations,
  mayProceed,
  type Delegation,
  type DelegationRequest,
  type StopClass,
} from '../../../scripts/lib/autonomy';

const LIVE: Delegation = {
  id: 'DLG-001',
  decision: 'DR-108',
  words: 'i\'m happy to greenlight all future development, provided you keep that ratio in mind.',
  said: '2026-10-17',
  source: 'queue item in5',
  repo: 'AIClarityAU/minspec',
  covers: ['spec-approval', 'engineering-dr-acceptance'],
  tiers: ['T1', 'T2', 'T3', 'T4'],
  reviewBy: '2027-01-17',
  tripwire: { metric: 'repeat-fix-share', max: 0.13 },
};

const accepted = () => 'accepted' as const;

const req = (over: Partial<DelegationRequest> = {}): DelegationRequest => ({
  repo: 'AIClarityAU/minspec',
  act: 'spec-approval',
  tier: 'T3',
  actor: BOT_ACTOR,
  author: 'session:spec-writer',
  verdictBy: 'ai-review:panel',
  repeatFixShare: 0.067,
  today: '2026-10-18',
  paths: ['specs/minspec/SPEC-200-x/requirements.md'],
  ...over,
});

describe('T0 invariant 1 — memory-fabric is never delegated', () => {
  for (const repo of ['harvest316/memory-fabric', 'AIClarityAU/memory-fabric', 'AIClarityAU/Memory-Fabric']) {
    it(`refuses ${repo} even when a record names it explicitly`, () => {
      const rogue: Delegation = { ...LIVE, repo };
      const v = evaluateDelegation([rogue], accepted, req({ repo }));
      expect(v.covered).toBe(false);
      expect(v.reason).toBe('repo-never-delegated');
    });
  }
});

describe('T0 invariant 2 — nothing is recorded under the founder\'s identity', () => {
  for (const actor of ['harvest316', 'github@harvest316.com', 'claude@harvest316.com', 'Paul Harvey', '', 'minspec-sdd', 'minspec-sdd[bot] ']) {
    it(`refuses actor ${JSON.stringify(actor)}`, () => {
      const v = evaluateDelegation([LIVE], accepted, req({ actor }));
      expect(v.covered).toBe(false);
      expect(v.reason).toBe('actor-not-bot');
    });
  }

  it('admits only the exact App bot name', () => {
    expect(BOT_ACTOR).toBe('minspec-sdd[bot]');
    expect(evaluateDelegation([LIVE], accepted, req()).covered).toBe(true);
  });
});

describe('T0 invariant 3 — --admin is never automated', () => {
  it('a covering delegation removes approval-or-acceptance and nothing else', () => {
    const all = STOP_CLASSES.map((s) => s.id) as StopClass[];
    const covered = evaluateDelegation([LIVE], accepted, req());
    expect(covered.covered).toBe(true);
    const left = stopClassesAfterDelegation(all, covered);
    expect(left).toEqual(all.filter((c) => c !== 'approval-or-acceptance'));
    expect(left).toContain('irreversible-or-outward-facing');
  });

  it('an --admin merge still stops under act, with a covering delegation', () => {
    const covered = evaluateDelegation([LIVE], accepted, req());
    const classes = stopClassesAfterDelegation(
      ['irreversible-or-outward-facing', 'approval-or-acceptance'],
      covered,
    );
    const v = mayProceed('act', {
      summary: 'gh pr merge --admin',
      stopClasses: classes,
      verificationPending: false,
      rejectedAlternatives: ['wait for the human'],
    });
    expect(v.proceed).toBe(false);
    expect(v.reason).toBe('stop-class-applies');
  });

  it('an uncovered request removes nothing', () => {
    const v = evaluateDelegation([], accepted, req());
    expect(stopClassesAfterDelegation(['approval-or-acceptance'], v)).toEqual(['approval-or-acceptance']);
  });
});

describe('the author never gives the verdict', () => {
  it('refuses when verdictBy equals author', () => {
    const v = evaluateDelegation([LIVE], accepted, req({ verdictBy: 'session:spec-writer' }));
    expect(v.reason).toBe('verdict-by-author');
  });
  it('refuses when there is no verdict', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ verdictBy: ' ' })).reason).toBe('no-independent-verdict');
  });
  it('refuses when the bot recording it also authored it', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ author: BOT_ACTOR, verdictBy: BOT_ACTOR })).covered).toBe(false);
  });
});

describe('a delegation is inert until its decision record is accepted', () => {
  for (const status of ['proposed', 'rejected', 'superseded', undefined]) {
    it(`status ${String(status)} → not covered`, () => {
      const v = evaluateDelegation([LIVE], () => status, req());
      expect(v.covered).toBe(false);
      expect(v.reason).toBe('no-live-delegation');
    });
  }
});

describe('the ratio tripwire suspends it, and an unknown ratio is not permission', () => {
  it('share above max → suspended', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ repeatFixShare: 0.2 })).reason).toBe('tripwire-tripped');
  });
  it('share unknown → suspended', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ repeatFixShare: undefined })).reason).toBe('tripwire-unknown');
  });
  it('share NaN → suspended', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ repeatFixShare: Number.NaN })).reason).toBe('tripwire-unknown');
  });
  it('share exactly at max → still covered', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ repeatFixShare: 0.13 })).covered).toBe(true);
  });
});

describe('scope is exact', () => {
  it('another repo is not covered', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ repo: 'AIClarityAU/sealbox' })).covered).toBe(false);
  });
  it('an act not listed is not covered', () => {
    const narrow: Delegation = { ...LIVE, covers: ['spec-approval'] };
    expect(
      evaluateDelegation([narrow], accepted, req({ act: 'engineering-dr-acceptance', drKind: 'engineering' })).covered,
    ).toBe(false);
  });
  it('a tier not listed is not covered', () => {
    const narrow: Delegation = { ...LIVE, tiers: ['T1', 'T2'] };
    expect(evaluateDelegation([narrow], accepted, req({ tier: 'T3' })).covered).toBe(false);
  });
  it('past its review date it lapses', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ today: '2027-01-18' })).reason).toBe('no-live-delegation');
  });
  it('a malformed date is not permission', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ today: 'tomorrow' })).covered).toBe(false);
  });
});

describe('direction records stay the founder\'s (change 2)', () => {
  it('engineering record → covered', () => {
    const v = evaluateDelegation(
      [LIVE],
      accepted,
      req({ act: 'engineering-dr-acceptance', drKind: 'engineering', paths: ['docs/decisions/DR-200.md'] }),
    );
    expect(v.covered).toBe(true);
  });
  for (const drKind of ['direction', undefined] as const) {
    it(`kind ${String(drKind)} → refused (absent kind reads as direction)`, () => {
      const v = evaluateDelegation(
        [LIVE],
        accepted,
        req({ act: 'engineering-dr-acceptance', drKind, paths: ['docs/decisions/DR-200.md'] }),
      );
      expect(v.reason).toBe('direction-record');
    });
  }
});

describe('governance files are never approved on a delegation', () => {
  for (const p of [
    '.minspec/constitution.md',
    '.minspec/delegations.json',
    '.minspec/config.json',
    'scripts/lib/autonomy.ts',
    'scripts/lib/autonomy.sh',
    'docs/decisions/DR-086.md',
    'docs/decisions/DR-108.md',
    './docs/decisions/DR-086.md',
  ]) {
    it(`refuses a request touching ${p}`, () => {
      const v = evaluateDelegation([LIVE], accepted, req({ paths: ['specs/x.md', p] }));
      expect(v.reason).toBe('touches-governance');
    });
  }
  it('an empty path list is not permission', () => {
    expect(evaluateDelegation([LIVE], accepted, req({ paths: [] })).reason).toBe('no-paths');
  });
});

describe('readDelegations fails closed', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-'));
  const write = (root: string, text: string) => {
    fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minspec', 'delegations.json'), text);
  };

  it('missing file → no delegations', () => {
    expect(readDelegations(dir())).toEqual([]);
  });
  it('malformed JSON → no delegations', () => {
    const r = dir();
    write(r, '{nope');
    expect(readDelegations(r)).toEqual([]);
  });
  it('drops an entry with a missing or wrongly-typed field, keeps a valid one', () => {
    const r = dir();
    write(
      r,
      JSON.stringify({
        version: 1,
        delegations: [LIVE, { ...LIVE, id: 'DLG-002', covers: 'spec-approval' }, { ...LIVE, id: 'DLG-003', tripwire: undefined }],
      }),
    );
    expect(readDelegations(r).map((d) => d.id)).toEqual(['DLG-001']);
  });
  it('an unknown act in covers drops the entry rather than widening it', () => {
    const r = dir();
    write(r, JSON.stringify({ version: 1, delegations: [{ ...LIVE, covers: ['spec-approval', 'admin-merge'] }] }));
    expect(readDelegations(r)).toEqual([]);
  });
  it('an unknown version → no delegations', () => {
    const r = dir();
    write(r, JSON.stringify({ version: 2, delegations: [LIVE] }));
    expect(readDelegations(r)).toEqual([]);
  });
});

describe('the record on disk', () => {
  const root = path.resolve(__dirname, '../../..');
  const ds = readDelegations(root);

  it('parses, and every entry survives validation', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.minspec', 'delegations.json'), 'utf-8')) as {
      delegations: unknown[];
    };
    expect(ds.length).toBe(raw.delegations.length);
    expect(ds.length).toBeGreaterThan(0);
  });

  it('names no memory-fabric repo and quotes the founder verbatim', () => {
    for (const d of ds) {
      expect(d.repo.toLowerCase()).not.toContain('memory-fabric');
      expect(d.words).toContain('greenlight all future development');
    }
  });

  it('is gated on a decision record, so writing the file activates nothing', () => {
    for (const d of ds) expect(d.decision).toMatch(/^DR-\d+$/);
  });
});
