/**
 * T0 — rank dispatchable issues by value, not arrival order (#2196).
 *
 * The drain used to compose its dispatch queue as `sort -un`: lowest issue number first,
 * which is arrival order with no priority term at all. Dispatch cost varies 28-fold
 * (28k to 778k billed tokens across 46 measured dispatches), so arrival order spends a
 * token budget on whatever happens to be oldest.
 *
 * The founder-approved ordering (issue comment, 2026-09-28) is lexicographic:
 *   1. how many other OPEN issues this one unblocks, transitively;
 *   2. the signpost's STRUCTURAL rank of the spec (or epic) the issue explicitly serves;
 *   3. quick wins — the triage tier, as a tiebreaker only;
 *   4. issue number ascending (the old behaviour, demoted to the last tiebreak).
 *
 * Every invariant below is written against a PLAUSIBLE broken implementation, named in
 * the test, so a green run is evidence of the property rather than of the harness. In
 * particular the arrival-order ranker the drain used to be (numeric sort) fails
 * INV-2's contrast arm, INV-4, INV-5 and INV-6.
 */

import { describe, it, expect } from 'vitest';
import { resolvePipeline, type ArtifactGraph } from '@aiclarity/shared';
import {
  rankIssues,
  parseDeclaredBlockers,
  explicitLinks,
  tierFromLabels,
  tierKey,
  structuralOrder,
  blockingGraph,
  type IssueRecord,
  type RankContext,
  type StructuralOrder,
  type Tier,
} from '../../../scripts/lib/issue-rank';

// ─── Fixture builders ────────────────────────────────────────────────────────

function issue(number: number, over: Partial<IssueRecord> = {}): IssueRecord {
  return { number, title: `issue ${number}`, body: '', labels: [], ...over };
}

/** A structural order over SPEC-001..SPEC-00n, in id order, with no epics. */
function specOrder(n: number): StructuralOrder {
  const spec = new Map<string, number>();
  for (let i = 1; i <= n; i++) spec.set(`SPEC-${String(i).padStart(3, '0')}`, i - 1);
  return { size: n, spec, epic: new Map() };
}

function ctxOf(
  issues: IssueRecord[],
  over: Partial<RankContext> = {},
): RankContext {
  return {
    open: new Set(issues.map((i) => i.number)),
    issues,
    order: specOrder(9),
    ...over,
  };
}

const numbers = (ctx: RankContext, candidates: number[]): number[] =>
  rankIssues(candidates, ctx).map((r) => r.number);

/** Deterministic PRNG so the property loops are reproducible run to run. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TIERS: (Tier | null)[] = ['T1-T2', 'T3-T4', null];

/** A random but well-formed context: random declared edges, spec links and tiers. */
function randomWorld(seed: number): { ctx: RankContext; candidates: number[] } {
  const rand = prng(seed);
  const count = 3 + Math.floor(rand() * 15);
  const nums = Array.from({ length: count }, (_, i) => 100 + i * 3);
  const issues = nums.map((n) => {
    const blockers = nums.filter((m) => m !== n && rand() < 0.15);
    const body = blockers.map((b) => `Blocked by #${b}`).join('\n') + `\nSee also #${nums[0]}.`;
    const spec = rand() < 0.5 ? `feat(SPEC-00${1 + Math.floor(rand() * 9)}): x` : 'chore: x';
    const tier = TIERS[Math.floor(rand() * TIERS.length)];
    const labels = tier === 'T1-T2' ? ['agent-ready'] : tier === 'T3-T4' ? ['agent-ready-specify'] : [];
    return issue(n, { title: spec, body, labels });
  });
  // Some candidates are absent from the fetched data entirely; some open issues are
  // not candidates (they still carry edges).
  const candidates = [...nums.filter(() => rand() < 0.7), 9000 + Math.floor(rand() * 5)];
  const open = new Set(nums.filter(() => rand() < 0.9));
  return { ctx: { open, issues, order: specOrder(9) }, candidates };
}

// ─── INV-1 Permutation ───────────────────────────────────────────────────────

describe('INV-1: the output is exactly the input candidate set', () => {
  it('keeps candidates absent from the fetched open-issue data, with a no-data reason', () => {
    // Broken implementation this catches: ranking only what the fetch returned, so a
    // candidate closed (or not returned) between the queue read and the ranker VANISHES
    // from the dispatch queue instead of being ranked.
    const ctx = ctxOf([issue(5), issue(3), issue(9)]);
    const out = rankIssues([5, 3, 9, 1000], ctx);
    expect(out.map((r) => r.number).sort((a, b) => a - b)).toEqual([3, 5, 9, 1000]);
    const absent = out.find((r) => r.number === 1000)!;
    expect(absent.hasData).toBe(false);
    expect(absent.reasons.unblocks).toMatch(/not in the fetched open issues/);
  });

  it('never duplicates: a repeated candidate appears once', () => {
    const ctx = ctxOf([issue(1), issue(2)]);
    expect(numbers(ctx, [2, 1, 2, 2, 1])).toHaveLength(2);
  });

  it('holds over randomized worlds (property)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { ctx, candidates } = randomWorld(seed);
      const out = numbers(ctx, candidates);
      const want = [...new Set(candidates)].sort((a, b) => a - b);
      expect([...out].sort((a, b) => a - b), `seed ${seed}`).toEqual(want);
    }
  });
});

// ─── INV-2 Citation is not an edge ───────────────────────────────────────────

describe('INV-2: citing #N without a declaration creates no edge', () => {
  const CITATIONS = [
    'See #10 for context.',
    'Related: #10',
    'Relates to #10 and was mentioned in #10.',
    'The deploy was blocked by a stale cache; see #10.',
    '#10 was blocked by design.',
    'Depends on the seam landing first (#10).',
    'Depends on / extends #10.',
    'Prerequisite for #10.',
    'This blocks #10 too.',
    'Blocked by AIClarityAU/sealbox#10',
    'Blocked by SPEC-010 shipping, tracked in #10',
    // A declaration must LEAD its line: mid-sentence it is narrative.
    'We were blocked by #10 for a week.',
    'This depends on #10 landing',
  ].join('\n');

  it('the parser returns no blockers for citation-only prose', () => {
    expect(parseDeclaredBlockers(CITATIONS)).toEqual([]);
  });

  it('a citing body changes no rank; the declared form does (contrast arm)', () => {
    // Broken implementation this catches: treating every `#N` in a body as an edge.
    // 75% of open issues cite another issue while 12% declare a relation, so a
    // citation-as-edge ranker manufactures an authoritative-looking wrong graph.
    // #11 has the better spec rank, so with no edge it must lead.
    const base = [issue(10), issue(11, { title: 'feat(SPEC-001): x' }), issue(20)];
    const citing = [issue(10), issue(11, { title: 'feat(SPEC-001): x' }), issue(20, { body: CITATIONS })];
    const plain = rankIssues([10, 11], ctxOf(base));
    const cited = rankIssues([10, 11], ctxOf(citing));
    expect(cited.map((r) => [r.number, r.unblocks])).toEqual(plain.map((r) => [r.number, r.unblocks]));
    expect(cited.map((r) => r.number)).toEqual([11, 10]);

    // Contrast: the same issue DECLARING the relation does create the edge, and it
    // moves #10 ahead of the better spec rank. Without this arm the test above would
    // pass against a ranker that ignores bodies entirely.
    const declared = [issue(10), issue(11, { title: 'feat(SPEC-001): x' }), issue(20, { body: 'Blocked by #10' })];
    const out = rankIssues([10, 11], ctxOf(declared));
    expect(out.map((r) => r.number)).toEqual([10, 11]);
    expect(out[0].unblocks).toBe(1);
  });

  it('a SPEC id cited in the BODY is not a spec link', () => {
    // Broken implementation this catches: reading SPEC-NNN from anywhere in the issue.
    expect(explicitLinks(issue(1, { body: 'Part of SPEC-001. Serves SPEC-002.' })).specs).toEqual([]);
    const ctx = ctxOf([issue(1, { body: 'feat(SPEC-001): serves SPEC-001' }), issue(2)]);
    const r = rankIssues([1], ctx)[0];
    expect(r.specRank).toBeNull();
  });
});

// ─── INV-3 Status-blind ──────────────────────────────────────────────────────

describe('INV-3: spec status never influences rank', () => {
  // SPEC-021, SPEC-033 and SPEC-063 all say `implementing` with no implementation.
  // A self-reported status is not evidence, so the spec term reads STRUCTURE only.
  const STATUSES = ['new', 'specifying', 'implementing', 'done', 'archived', 'superseded'] as const;

  function graph(statuses: readonly string[]) {
    return {
      epics: [
        { id: 'EPIC-001', status: 'active', order: 2 },
        { id: 'EPIC-002', status: 'done', order: 1 },
      ],
      specs: [
        { id: 'SPEC-001', status: statuses[0], epic: 'EPIC-001', approvalState: 'approved', phase: 'implement' },
        { id: 'SPEC-002', status: statuses[1], epic: 'EPIC-002', approvalState: 'stale', phase: 'plan' },
        { id: 'SPEC-003', status: statuses[2], epic: 'EPIC-001', approvalState: 'unapproved' },
        { id: 'SPEC-004', status: statuses[3], epic: 'EPIC-002', approvalState: 'approved' },
        { id: 'SPEC-005', status: statuses[4] },
        { id: 'SPEC-006', status: statuses[5], epic: 'EPIC-001' },
      ],
    };
  }

  it('permuting every spec status leaves the structural order identical', () => {
    // Broken implementation this catches: "first UNFINISHED spec" — keying on status
    // the way the signpost's severity class does. Six distinct statuses over six specs
    // means any status-sensitive key reorders at least one permutation.
    const reference = structuralOrder(graph(STATUSES));
    const rand = prng(7);
    for (let k = 0; k < 50; k++) {
      const permuted = structuralOrder(graph(shuffle(STATUSES, rand)));
      expect([...permuted.spec.entries()]).toEqual([...reference.spec.entries()]);
      expect([...permuted.epic.entries()]).toEqual([...reference.epic.entries()]);
    }
  });

  it('orders by epic `order`, then spec id — the signpost structural dials', () => {
    const o = structuralOrder(graph(STATUSES));
    // EPIC-002 (order 1) first: its specs, then its own slot; then EPIC-001 (order 2);
    // then the spec with no epic.
    const bySlot = [...o.spec.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(bySlot).toEqual(['SPEC-002', 'SPEC-004', 'SPEC-001', 'SPEC-003', 'SPEC-006', 'SPEC-005']);
    expect(o.epic.get('epic-002')!.position).toBeLessThan(o.spec.get('SPEC-001')!);
    expect(o.epic.get('epic-002')!.position).toBeGreaterThan(o.spec.get('SPEC-004')!);
  });

  it('the ranked issue list is identical under every status permutation', () => {
    const issues = [
      issue(1, { title: 'feat(SPEC-001): a' }),
      issue(2, { title: 'fix(SPEC-002): b' }),
      issue(3, { title: 'feat(SPEC-003): c' }),
      issue(4, { title: 'chore: d' }),
    ];
    const reference = numbers(ctxOf(issues, { order: structuralOrder(graph(STATUSES)) }), [1, 2, 3, 4]);
    const rand = prng(11);
    for (let k = 0; k < 50; k++) {
      const order = structuralOrder(graph(shuffle(STATUSES, rand)));
      expect(numbers(ctxOf(issues, { order }), [1, 2, 3, 4])).toEqual(reference);
    }
  });
});

// The spec term is a COPY of next-task.ts `compareRanked` minus its status-derived
// classRank (that comparator is not exported, and its lead key is exactly what INV-3
// forbids). A copy drifts silently, so these pin it to the original.
describe('structuralOrder mirrors the signpost comparator, minus status', () => {
  const order = (specs: StructuralGraphSpec[]) =>
    [...structuralOrder({ epics: [{ id: 'EPIC-001', order: 1 }], specs }).spec.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);
  type StructuralGraphSpec = { id: string; epic?: string; goalRank?: number; priority?: number };

  it('goalRank orders specs within one epic order; a present goalRank precedes an absent one', () => {
    expect(
      order([
        { id: 'SPEC-001', epic: 'EPIC-001', goalRank: 2 },
        { id: 'SPEC-002', epic: 'EPIC-001', goalRank: 1 },
        { id: 'SPEC-003', epic: 'EPIC-001' },
      ]),
    ).toEqual(['SPEC-002', 'SPEC-001', 'SPEC-003']);
  });

  it('priority orders specs sharing an epic order and goal rank', () => {
    expect(
      order([
        { id: 'SPEC-001', epic: 'EPIC-001', priority: 2 },
        { id: 'SPEC-002', epic: 'EPIC-001', priority: 1 },
        { id: 'SPEC-003', epic: 'EPIC-001' },
      ]),
    ).toEqual(['SPEC-002', 'SPEC-001', 'SPEC-003']);
  });

  it("matches resolvePipeline's spec order whenever every spec shares one severity class (property)", () => {
    // Every spec is unapproved under an ACTIVE epic, so each yields one blocked-ready
    // spec-approve task and classRank ties: the signpost then orders by exactly the
    // dials structuralOrder copies. Any dial added, dropped or reordered on either side
    // shows up here.
    const rand = prng(2196);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let k = 0; k < 200; k++) {
      const epics = ['EPIC-001', 'EPIC-002', 'EPIC-003'].map((id) => ({
        id,
        status: 'active' as const,
        order: pick([1, 2, 3, undefined]),
      }));
      const specs = Array.from({ length: 8 }, (_, i) => ({
        id: `SPEC-${String(i + 1).padStart(3, '0')}`,
        status: 'specifying' as const,
        approvalState: 'unapproved' as const,
        epic: pick(epics).id,
        goalRank: pick([1, 2, undefined]),
        priority: pick([1, 2, undefined]),
      }));
      const g: ArtifactGraph = { epics, specs, adrs: [] };
      const signpost = resolvePipeline(g)
        .filter((t) => t.kind === 'spec-approve')
        .map((t) => t.targetId);
      const mine = [...structuralOrder(g).spec.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
      expect(mine, `case ${k}`).toEqual(signpost);
    }
  });
});

// ─── INV-4 Graceful fall-through ─────────────────────────────────────────────

describe('INV-4: an issue with no declared relation falls through to terms 2-4', () => {
  it('is never penalised for being unannotated', () => {
    // #1 declares nothing; #2 declares a blocker (#50, open, not a candidate), so #2
    // unblocks 0 too. Both are zero-count, so the spec term decides — in BOTH
    // directions. Broken implementation this catches: demoting unannotated issues (e.g.
    // "unknown blocking count" sorted last), which would rank 88% of the corpus as
    // unimportant for want of a sentence.
    const make = (spec1: string, spec2: string) =>
      ctxOf([
        issue(1, { title: `feat(${spec1}): x` }),
        issue(2, { title: `feat(${spec2}): y`, body: 'Blocked by #50' }),
        issue(50),
      ]);
    expect(numbers(make('SPEC-001', 'SPEC-002'), [1, 2])).toEqual([1, 2]);
    expect(numbers(make('SPEC-002', 'SPEC-001'), [1, 2])).toEqual([2, 1]);
  });

  it('says so in its reason rather than reading as unimportant', () => {
    const r = rankIssues([1], ctxOf([issue(1)]))[0];
    expect(r.unblocks).toBe(0);
    expect(r.reasons.unblocks).toMatch(/falls through/);
  });

  it('an unannotated issue with a better tier beats an annotated zero-count one', () => {
    const ctx = ctxOf([
      issue(7, { labels: ['agent-ready'] }),
      issue(3, { labels: ['agent-ready-specify'], body: 'Depends on #60' }),
      issue(60),
    ]);
    expect(numbers(ctx, [3, 7])).toEqual([7, 3]);
  });
});

// ─── INV-5 Lexicographic order ───────────────────────────────────────────────

describe('INV-5: unblocks > spec rank > tier > issue number', () => {
  it('a higher unblocks count outranks a better spec rank, tier and number', () => {
    // Broken implementation this catches: any weighted SCORE. #900 is worse on every
    // other term, and a score that mixed them could let #1 win.
    const ctx = ctxOf([
      issue(1, { title: 'feat(SPEC-001): best spec', labels: ['agent-ready'] }),
      issue(900, { title: 'chore: no spec', labels: ['agent-ready-specify'] }),
      issue(901, { body: 'Blocked by #900' }),
    ]);
    expect(numbers(ctx, [1, 900])).toEqual([900, 1]);
  });

  it('spec rank outranks tier and number', () => {
    const ctx = ctxOf([
      issue(1, { title: 'feat(SPEC-005): later spec', labels: ['agent-ready'] }),
      issue(800, { title: 'feat(SPEC-002): earlier spec', labels: ['agent-ready-specify'] }),
    ]);
    expect(numbers(ctx, [1, 800])).toEqual([800, 1]);
  });

  it('a spec-linked issue outranks a spec-less one on term 2', () => {
    const ctx = ctxOf([
      issue(1, { labels: ['agent-ready'] }),
      issue(700, { title: 'feat(SPEC-009): last spec', labels: ['agent-ready-specify'] }),
    ]);
    expect(numbers(ctx, [1, 700])).toEqual([700, 1]);
  });

  it('tier outranks issue number', () => {
    const ctx = ctxOf([issue(1, { labels: ['agent-ready-specify'] }), issue(600, { labels: ['agent-ready'] })]);
    expect(numbers(ctx, [1, 600])).toEqual([600, 1]);
  });

  it('issue number ascending is the final tiebreak', () => {
    const ctx = ctxOf([issue(30), issue(10), issue(20)]);
    expect(numbers(ctx, [30, 20, 10])).toEqual([10, 20, 30]);
  });

  it('an unknown tier sits between the known classes: neither favoured nor buried', () => {
    // Broken implementations this catches: unknown-as-best (favoured) and
    // unknown-as-worst (pushed to the bottom).
    const ctx = ctxOf([
      issue(1, { labels: ['agent-ready-specify'] }),
      issue(2, { labels: [] }),
      issue(3, { labels: ['agent-ready'] }),
    ]);
    expect(numbers(ctx, [1, 2, 3])).toEqual([3, 2, 1]);
    expect(tierKey(null)).toBeGreaterThan(tierKey('T1-T2'));
    expect(tierKey(null)).toBeLessThan(tierKey('T3-T4'));
    expect(tierKey(null)).toBeGreaterThan(tierKey('T2'));
    expect(tierKey(null)).toBeLessThan(tierKey('T3'));
  });

  it('an explicit tier from context overrides the ready-class proxy', () => {
    const ctx = ctxOf([issue(1, { labels: ['agent-ready'] }), issue(2, { labels: ['agent-ready'] })], {
      tiers: new Map<number, Tier>([[2, 'T1'], [1, 'T2']]),
    });
    expect(numbers(ctx, [1, 2])).toEqual([2, 1]);
  });
});

// ─── INV-6 Transitive, cycle-safe, open-only ─────────────────────────────────

describe('INV-6: unblocks is transitive, cycle-safe, and counts only OPEN issues', () => {
  it('A blocks B blocks C gives A=2, B=1, C=0', () => {
    // Broken implementation this catches: direct-only counting (A=1).
    const ctx = ctxOf([issue(1), issue(2, { body: 'Blocked by #1' }), issue(3, { body: 'Blocked by #2' })]);
    const by = new Map(rankIssues([1, 2, 3], ctx).map((r) => [r.number, r.unblocks]));
    expect([by.get(1), by.get(2), by.get(3)]).toEqual([2, 1, 0]);
    expect(numbers(ctx, [3, 2, 1])).toEqual([1, 2, 3]);
  });

  it('a cycle terminates and does not count the issue itself or anything twice', () => {
    // 1 <-> 2 cycle, and 3 waits on 1. From 1: {2, 3}. From 2: {1, 3}. A naive DFS
    // without a visited set never returns (the test would time out); one that does not
    // exclude the start node reports 3.
    const ctx = ctxOf([
      issue(1, { body: 'Blocked by #2' }),
      issue(2, { body: 'Blocked by #1' }),
      issue(3, { body: 'Blocked by #1' }),
    ]);
    const by = new Map(rankIssues([1, 2, 3], ctx).map((r) => [r.number, r.unblocks]));
    expect(by.get(1)).toBe(2);
    expect(by.get(2)).toBe(2);
    expect(by.get(3)).toBe(0);
  });

  it('a diamond is not double counted', () => {
    const ctx = ctxOf([
      issue(1),
      issue(2, { body: 'Blocked by #1' }),
      issue(3, { body: 'Blocked by #1' }),
      issue(4, { body: 'Blocked by: #2, #3' }),
    ]);
    expect(rankIssues([1], ctx)[0].unblocks).toBe(3);
  });

  it('only OPEN issues count, and traversal does not pass through a closed one', () => {
    // #2 is closed (in the data but not in the open set); #3 waits on #2. #1 blocks #2.
    // #1 gets nothing: #2 is done, so #3 is no longer waiting on anything #1 controls.
    const issues = [issue(1), issue(2, { body: 'Blocked by #1' }), issue(3, { body: 'Blocked by #2' })];
    const ctx = ctxOf(issues, { open: new Set([1, 3]) });
    expect(rankIssues([1], ctx)[0].unblocks).toBe(0);
    // And a closed blocker is not an edge at all: #3 does not "wait on" the finished
    // #2, and the explain output's edge count does not include it.
    expect(rankIssues([3], ctx)[0].waitsOn).toEqual([]);
    expect(blockingGraph(ctx).edgeCount).toBe(0);
  });

  it('counts a GitHub-native blocked-by relation, without double counting a duplicate', () => {
    const ctx = ctxOf([issue(1), issue(2, { blockedBy: [1], body: 'Blocked by #1' }), issue(3, { blockedBy: [1] })]);
    const r = rankIssues([1], ctx)[0];
    expect(r.unblocks).toBe(2);
    expect(r.unblocked).toEqual([2, 3]);
    const g = blockingGraph(ctx);
    expect(g.edgeCount).toBe(2);
    expect(g.fromBody).toBe(1);
    expect(g.fromNative).toBe(2);
  });
});

// ─── INV-7 Deterministic total order ─────────────────────────────────────────

describe('INV-7: same input gives the same output, independent of input order', () => {
  it('holds over randomized worlds with shuffled candidates and shuffled data (property)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { ctx, candidates } = randomWorld(seed);
      const reference = rankIssues(candidates, ctx);
      const rand = prng(seed * 31);
      const again = rankIssues(shuffle(candidates, rand), { ...ctx, issues: shuffle(ctx.issues, rand) });
      expect(again, `seed ${seed}`).toEqual(reference);
      // And it is a genuine total order: each adjacent pair respects the key.
      for (let i = 1; i < reference.length; i++) {
        const a = reference[i - 1];
        const b = reference[i];
        const ka = [-a.unblocks, a.specRank ?? Infinity, tierKey(a.tier), a.number];
        const kb = [-b.unblocks, b.specRank ?? Infinity, tierKey(b.tier), b.number];
        const cmp = ka.findIndex((v, j) => v !== kb[j]);
        expect(cmp, `seed ${seed}: ${a.number} and ${b.number} tie on every term`).toBeGreaterThanOrEqual(0);
        expect(ka[cmp] < kb[cmp], `seed ${seed}: ${a.number} before ${b.number}`).toBe(true);
      }
    }
  });
});

// ─── The declaration grammar ─────────────────────────────────────────────────

describe('parseDeclaredBlockers: explicit declarations only', () => {
  it.each([
    ['Blocked by #1225', [1225]],
    ['Blocked by: #1225, #1179', [1179, 1225]],
    ['- **Blocked by** #53 (calibration single-writer decision).', [53]],
    ['> blocked by #7', [7]],
    ['Blocked by #1 and #2', [1, 2]],
    ['Depends on #1002 (hold reason must be machine-readable first).', [1002]],
    ['**Depends on:** #5', [5]],
  ])('line form: %j', (body, want) => {
    expect(parseDeclaredBlockers(body)).toEqual(want);
  });

  it('only the LEADING ref run counts: a trailing explanation cannot add a blocker', () => {
    expect(parseDeclaredBlockers('Blocked by #1225 — (DR-078, merged as `proposed` in #1246)')).toEqual([1225]);
  });

  it('a ref on a LATER line is not swept into an earlier declaration', () => {
    expect(parseDeclaredBlockers('Blocked by #1225\n\nAlso relates to #4242.')).toEqual([1225]);
  });

  it('heading form: list items whose first token is a ref, until the next heading', () => {
    const body = [
      '## Blocked by (all must close)',
      '- #489 — Signal-1 root cause is agent-self-reported',
      '- #490 — empty consequence-signal set',
      '* #491, #492 — audit-write failure swallowed',
      '',
      'Prose under the heading citing #999 is not a declaration.',
      '',
      '## Do when unblocked',
      '- #777 extend the init question',
    ].join('\n');
    expect(parseDeclaredBlockers(body)).toEqual([489, 490, 491, 492]);
  });

  it('heading form ends at a thematic break', () => {
    expect(parseDeclaredBlockers('### Depends on\n- #1\n---\n- #2')).toEqual([1]);
  });

  it('heading form is ONE list: a later list after a pseudo-heading or prose is not swept in', () => {
    // Broken implementation this catches: a section that runs to the next real heading,
    // so any later list item leading with #N — under **Related**, "Steps to reproduce:",
    // or "Related, not blocking:" — becomes a blocker edge. That is a citation promoted
    // to an edge, the INV-2 failure through the heading form.
    expect(parseDeclaredBlockers('## Blocked by\n- #489 root cause first\n\n**Related**\n- #500 similar symptom\n')).toEqual([489]);
    expect(parseDeclaredBlockers('## Depends on\n- #10 first\n\nSteps to reproduce:\n- #20 is an example issue\n')).toEqual([10]);
    expect(
      parseDeclaredBlockers('## Blocked by\n- #489 root cause\n\nRelated, not blocking:\n- #700 background\n\n## Plan\n- #800'),
    ).toEqual([489]);
  });

  it('heading form: blank lines and indented continuations keep the list open', () => {
    // Contrast arm: without it, a parser that closed the section on ANY non-item line
    // would pass the test above while losing real blockers.
    expect(parseDeclaredBlockers('## Blocked by\n\n- #1 a long reason that\n  continues here\n\n- #2\n')).toEqual([1, 2]);
  });

  it('nothing inside a fenced code block counts, in either form', () => {
    // Broken implementation this catches: parsing quoted text — a PR-body example, a
    // pasted log line like #1097's "BLOCKED by primary-checkout guard" — as a declaration.
    expect(parseDeclaredBlockers('```\nBlocked by #77\n```')).toEqual([]);
    expect(parseDeclaredBlockers('~~~md\n## Blocked by\n- #5\n~~~')).toEqual([]);
    expect(parseDeclaredBlockers('```\nBlocked by #9')).toEqual([]); // unclosed: runs to the end
    // A shorter run does not close a longer fence.
    expect(parseDeclaredBlockers('````\n```\nBlocked by #9\n````\nBlocked by #4')).toEqual([4]);
    // After the fence closes, declarations count again (contrast arm).
    expect(parseDeclaredBlockers('```\nx\n```\nBlocked by #3')).toEqual([3]);
    // An unindented fence ends a heading section.
    expect(parseDeclaredBlockers('## Blocked by\n- #1\n```\ncode\n```\n- #2')).toEqual([1]);
  });

  it('heading form ignores list items that do not LEAD with a ref', () => {
    expect(parseDeclaredBlockers('## Depends on\n\n- SPEC-018 shipping (#12). Do not action before then.')).toEqual([]);
    expect(parseDeclaredBlockers('## Depends on\n- White paper authored, see #27')).toEqual([]);
  });

  it('is empty for null, undefined and empty bodies', () => {
    expect(parseDeclaredBlockers(null)).toEqual([]);
    expect(parseDeclaredBlockers(undefined)).toEqual([]);
    expect(parseDeclaredBlockers('')).toEqual([]);
  });

  it('handles CRLF bodies', () => {
    expect(parseDeclaredBlockers('intro\r\nBlocked by #3\r\n## Blocked by\r\n- #4\r\n')).toEqual([3, 4]);
  });
});

// Issue bodies are public, attacker-writable input: anyone can file an issue on this
// repo, and the ranker parses EVERY open issue body. BLOCKED_BY_LINE_RE in
// .github/scripts/ai-review-guard.js carried three distinct quadratic-backtracking
// mechanisms (#2134 / PR #2135), and the lesson recorded there is to vary the INPUT
// ALPHABET, not just the code: an asterisk-only fixture could not tell "closed" from
// "one of two vectors closed". Each shape below targets one mechanism. The correct
// answer is the same either way, so only the timing assertion distinguishes a linear
// parser from a quadratic one; the budget is two orders of magnitude above a linear
// parse and far below a quadratic one at these sizes.
describe('parseDeclaredBlockers: linear time on crafted bodies (ReDoS, #2134 lesson)', () => {
  const BUDGET_MS = 300;
  const alternate = (n: number, a: string, b: string) =>
    Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b)).join('');

  it.each([
    ['leading asterisks', `pre\n${'*'.repeat(40_000)}`],
    ['leading spaces and tabs', `pre\n${alternate(60_000, ' ', '\t')}`],
    ['newlines only', '\n'.repeat(60_000)],
    ['whitespace between "blocked" and a non-"by" token', `blocked${' '.repeat(40_000)}x`],
    ['ref run then whitespace then junk', `Blocked by #1${' '.repeat(40_000)}x`],
    ['ref run then separators with no ref', `Blocked by #1${' ,'.repeat(20_000)}x`],
    ['ref run then "and" without a ref', `Blocked by #1${' and'.repeat(15_000)}`],
    ['many declaration lines', 'Blocked by #1\n'.repeat(20_000)],
    ['heading then many non-ref list items', `## Blocked by\n${'- x\n'.repeat(20_000)}`],
    ['heading then decorated whitespace lines', `## Blocked by\n${`${alternate(64, ' ', '\t')}-\n`.repeat(2_000)}`],
    // `.` does not match \r or U+2028, while `\s` does: a trailing `(.*)$` after
    // whitespace quantifiers cannot reach the end of such a line and backtracks over
    // every split of the whitespace run. Found in review of this parser's first draft.
    ['declaration, whitespace, then an embedded carriage return', `Blocked by${' '.repeat(40_000)}a\rb`],
    ['declaration, whitespace, then an embedded U+2028', `Blocked by :${' '.repeat(40_000)}a b`],
    ['list item, whitespace, then an embedded U+2028', `## Blocked by\n-${' '.repeat(40_000)}a b`],
    ['many fence lines', '```\n'.repeat(30_000)],
    ['an open fence, then a long near-closer', `\`\`\`\n${'`'.repeat(40_000)}${' '.repeat(40_000)}x`],
    ['heading, then alternating items and indented continuations', `## Blocked by\n${'- x\n  y\n'.repeat(15_000)}`],
  ])('%s', (_name, body) => {
    const start = process.hrtime.bigint();
    parseDeclaredBlockers(body);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(ms, `parseDeclaredBlockers took ${ms.toFixed(1)}ms (budget ${BUDGET_MS}ms)`).toBeLessThan(BUDGET_MS);
  });
});

// ─── Explicit links and tier proxy ───────────────────────────────────────────

describe('explicitLinks: the title and epic labels, never the body', () => {
  it.each([
    ['feat(SPEC-63): x', ['SPEC-063']],
    ['refactor(SPEC-040 FR-6): dissolve the import cycles', ['SPEC-040']],
    ['fix(SPEC-012, spec-0013): x', ['SPEC-012', 'SPEC-013']],
    ['SPEC-046: per-item auto-approval audit artifact', ['SPEC-046']],
    ['[SPEC-046] per-item', ['SPEC-046']],
    ['SPEC-070 OQ-2(d): the adopter-side basis', ['SPEC-070']],
    ['feat: SPEC-012 — add issue-triage node kind', ['SPEC-012']],
    ['feat(#912): SPEC-044 Slice 3b — grace reaper', ['SPEC-044']],
  ])('a SPEC id in a declaring position links: %j', (title, want) => {
    expect(explicitLinks(issue(1, { title })).specs).toEqual(want);
  });

  it.each([
    ['amend DR-088: three statements SPEC-070 refutes', []],
    ['fix: attribute bare DR-355 refs inside specs/ (SPEC-010 x5, SPEC-012 x1)', []],
    ['docs(DR-053): record commit-on-approve decision (realizes SPEC-022 FR-1)', []],
    ['feat(SPEC-63): x vs SPEC-0012 and spec-1', ['SPEC-063']],
  ])('a SPEC id elsewhere in the title is a citation, not a link: %j', (title, want) => {
    // Broken implementation this catches: reading every SPEC id in the title. Both
    // titles above ranked as serving the spec they merely mention, ahead of every
    // spec-less issue on term 2 (#2196 review, live --explain run).
    expect(explicitLinks(issue(1, { title })).specs).toEqual(want);
  });

  it('a title that only mentions a spec ranks as spec-less', () => {
    const ctx = ctxOf([
      issue(1, { title: 'amend DR-088: three statements SPEC-001 refutes', labels: ['agent-ready-specify'] }),
      issue(2, { title: 'chore: y', labels: ['agent-ready'] }),
    ]);
    const out = rankIssues([1, 2], ctx);
    expect(out.find((r) => r.number === 1)!.specRank).toBeNull();
    // Spec-less both, so tier decides: #2 (T1-T2) before #1 (T3-T4).
    expect(out.map((r) => r.number)).toEqual([2, 1]);
  });

  it('reads epic:<ref> labels', () => {
    expect(explicitLinks(issue(1, { labels: ['bug', 'epic:Team-Readiness'] })).epics).toEqual(['team-readiness']);
  });

  it('takes the best-ranked explicit link when several are declared', () => {
    const order: StructuralOrder = {
      size: 4,
      spec: new Map([
        ['SPEC-001', 0],
        ['SPEC-002', 2],
      ]),
      epic: new Map([['team', { position: 1, id: 'EPIC-001' }]]),
    };
    const ctx = ctxOf([issue(1, { title: 'fix(SPEC-002, SPEC-001): a', labels: ['epic:team'] })], { order });
    const r = rankIssues([1], ctx)[0];
    expect(r.specRank).toBe(0);
    expect(r.link).toBe('SPEC-001');
  });

  it('a title SPEC absent from the structural order is no link, and says so', () => {
    const r = rankIssues([1], ctxOf([issue(1, { title: 'feat(SPEC-404): x' })]))[0];
    expect(r.specRank).toBeNull();
    expect(r.reasons.spec).toMatch(/SPEC-404/);
  });
});

describe('tierFromLabels: the ready class is the quick-win proxy', () => {
  it.each([
    [['agent-ready'], 'T1-T2'],
    [['agent-ready-specify'], 'T3-T4'],
    [['agent-ready', 'agent-ready-specify'], null],
    [['bug'], null],
    [[], null],
  ])('%j -> %j', (labels, want) => {
    expect(tierFromLabels(labels as string[])).toBe(want);
  });
});
