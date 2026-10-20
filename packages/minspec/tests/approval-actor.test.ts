/**
 * T0 — who recorded an approval, on whose basis (DR-012 Amendment, DR-108, #2854 item 1).
 *
 * Invariants pinned here:
 *   1. Every record with no actor fields (every record written before #2854) stays a
 *      valid founder record. The on-disk sidecars are checked directly.
 *   2. A bot record is valid only when a live delegation covers it.
 *   3. The founder's identity is never written for a delegated act.
 *   4. No record names the artifact's author as its actor or its verdict source.
 *   5. Every missing witness DENIES, each by name, not only the negative-value cases.
 *   6. memory-fabric, the constitution, the stop list and the delegation itself are
 *      never approved on a delegation.
 *
 * Each refusal asserts the check that fired, so a refusal for an unrelated reason is
 * not mistaken for the rule working.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { specHash } from '../../shared/src/canonical';
import { BOT_ACTOR, type Delegation } from '../../../scripts/lib/autonomy';
import {
  checkApprovalActor,
  frontmatterField,
  isReviewCommentUrl,
  NO_WITNESSES,
  type DelegationWitnesses,
} from '../../../scripts/lib/approval-actor';
import { evaluateApprovalIntegrity, repoFromRemoteUrl } from '../../../scripts/approval-integrity';

const REPO = 'AIClarityAU/minspec';
const SPEC = 'specs/minspec/SPEC-900-fixture/requirements.md';
const DR = 'docs/decisions/DR-900.md';
const VERDICT = `https://github.com/${REPO}/pull/41#issuecomment-6285242248`;

const SPEC_BODY = `---
id: SPEC-900
status: planning
tier: T3
---

# Fixture

- FR-1. Enough content to hash.
`;
const drBody = (kind?: string) => `---
id: DR-900
status: proposed
tier: T3
${kind === undefined ? '' : `kind: ${kind}\n`}---

# A decision
`;

const LIVE: Delegation = {
  id: 'DLG-001',
  decision: 'DR-108',
  words: 'greenlight all future development',
  said: '2026-10-17',
  source: 'queue item in5',
  repo: REPO,
  covers: ['spec-approval', 'engineering-dr-acceptance'],
  tiers: ['T1', 'T2', 'T3', 'T4'],
  reviewBy: '2027-01-17',
  tripwire: { metric: 'repeat-fix-share', max: 0.13 },
};

const W = (over: Partial<DelegationWitnesses> = {}): DelegationWitnesses => ({
  repo: REPO,
  delegations: [LIVE],
  decisionStatus: (id) => (id === 'DR-108' ? 'accepted' : undefined),
  repeatFixShare: 0.08,
  today: '2026-10-20',
  contentPullRequest: () => 41,
  ...over,
});

const botRecord = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  specPath: SPEC,
  specHash: specHash(SPEC_BODY),
  approvedAt: '2026-10-20T10:00:00.000Z',
  approvedBy: BOT_ACTOR,
  tier: 'T3',
  migrated: false,
  baselineBlob: '',
  actor: BOT_ACTOR,
  basis: 'delegation:DLG-001',
  act: 'spec-approval',
  author: 'session:cos/spec-writer',
  verdictBy: VERDICT,
  ...over,
});

const spec = { path: SPEC, content: SPEC_BODY };

const check = (rec: Record<string, unknown>, w = W(), art: { path: string; content: string | null } = spec) =>
  checkApprovalActor(rec, art, w);
const firstCheck = (r: ReturnType<typeof check>) => r.failures[0]?.check;

describe('T0 invariant 1 — records with no actor stay valid founder records', () => {
  it('a record with no actor fields classifies as founder-legacy with no failures, whatever the witnesses', () => {
    const legacy = { specPath: SPEC, specHash: 'x', approvedAt: 'y', approvedBy: 'github@harvest316.com', tier: 'T3', migrated: false };
    for (const w of [W(), NO_WITNESSES]) {
      const r = check(legacy, w);
      expect(r.failures).toEqual([]);
      expect(r.cls).toEqual({ kind: 'founder-legacy' });
    }
  });

  it('every approval sidecar on disk classifies as founder-legacy', () => {
    const root = path.resolve(__dirname, '../../..');
    const dir = path.join(root, '.minspec', 'approvals');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.json')) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const rec = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, unknown>;
      const r = check(rec, NO_WITNESSES, { path: String(rec.specPath), content: null });
      expect({ f, kind: r.cls?.kind, failures: r.failures }).toEqual({ f, kind: 'founder-legacy', failures: [] });
    }
  });

  it('a founder record that names itself classifies as founder', () => {
    const r = check({ approvedBy: 'Founder@Example.com', actor: 'founder@example.com', basis: 'founder' });
    expect(r.failures).toEqual([]);
    expect(r.cls).toEqual({ kind: 'founder', actor: 'founder@example.com' });
  });
});

describe('T0 invariant 2 — a bot record is valid only under a covering delegation', () => {
  it('a complete bot record with every witness present is delegated', () => {
    const r = check(botRecord());
    expect(r.failures).toEqual([]);
    expect(r.cls?.kind).toBe('delegated');
    if (r.cls?.kind === 'delegated') expect(r.cls.delegationId).toBe('DLG-001');
  });

  it('an engineering DR acceptance is delegated', () => {
    const content = drBody('engineering');
    const r = check(botRecord({ specPath: DR, act: 'engineering-dr-acceptance' }), W(), { path: DR, content });
    expect(r.failures).toEqual([]);
    expect(r.cls?.kind).toBe('delegated');
  });

  it('a bot record whose basis is founder is refused', () => {
    expect(firstCheck(check(botRecord({ basis: 'founder' })))).toBe('basis-mismatch');
  });
  it('a bot record with no basis is refused', () => {
    expect(firstCheck(check(botRecord({ basis: undefined })))).toBe('basis-mismatch');
  });
  it('a basis naming a delegation that is not on file is refused', () => {
    expect(firstCheck(check(botRecord({ basis: 'delegation:DLG-999' })))).toBe('basis-unknown-delegation');
  });
  it('a decision record that is not accepted leaves the delegation inert', () => {
    expect(firstCheck(check(botRecord(), W({ decisionStatus: () => 'proposed' })))).toBe('delegation-no-live-delegation');
  });
  it('a tripped ratio suspends it', () => {
    expect(firstCheck(check(botRecord(), W({ repeatFixShare: 0.2 })))).toBe('delegation-tripwire-tripped');
  });
  it('the act is read from the path, never trusted from the record', () => {
    expect(firstCheck(check(botRecord({ act: 'engineering-dr-acceptance' })))).toBe('act-mismatch');
    expect(firstCheck(check(botRecord({ act: undefined })))).toBe('act-mismatch');
  });
  it('a tier the artifact does not declare is refused', () => {
    expect(firstCheck(check(botRecord({ tier: 'T1' })))).toBe('tier-mismatch');
    expect(firstCheck(check(botRecord({ tier: 'T9' })))).toBe('tier-shape');
  });
  it('a verdict that is not a review comment on this repo is refused', () => {
    for (const verdictBy of [
      'ai-review:panel',
      'https://github.com/AIClarityAU/sealbox/pull/1#issuecomment-1',
      `${VERDICT} `,
      'https://evil.example/AIClarityAU/minspec/pull/1#issuecomment-1',
    ]) {
      expect(firstCheck(check(botRecord({ verdictBy })))).toBe('verdict-shape');
    }
  });
  it('a verdict on a pull request other than the one that last changed the content is refused', () => {
    expect(firstCheck(check(botRecord(), W({ contentPullRequest: () => 42 })))).toBe('verdict-not-on-content-pr');
  });
  it('a non-string actor field is refused', () => {
    expect(firstCheck(check(botRecord({ author: 7 })))).toBe('actor-shape');
  });
});

describe('T0 invariant 3 — the founder\'s identity is never written for a delegated act', () => {
  for (const approvedBy of ['github@harvest316.com', 'harvest316', 'claude@harvest316.com', '', 'minspec-sdd[bot] ']) {
    it(`a bot record with approvedBy ${JSON.stringify(approvedBy)} is refused`, () => {
      expect(firstCheck(check(botRecord({ approvedBy })))).toBe('founder-identity-on-delegated-act');
    });
  }

  it('a human actor on a delegated basis is refused (impersonation shape)', () => {
    const r = check({ approvedBy: 'github@harvest316.com', actor: 'github@harvest316.com', basis: 'delegation:DLG-001' });
    expect(firstCheck(r)).toBe('basis-mismatch');
  });
  it('a human actor whose approvedBy names someone else is refused', () => {
    const r = check({ approvedBy: 'other@example.com', actor: 'github@harvest316.com', basis: 'founder' });
    expect(firstCheck(r)).toBe('actor-approvedBy-mismatch');
  });
  it('a near-miss bot name is neither the bot nor a human', () => {
    for (const actor of ['minspec-sdd[bot] ', 'Minspec-SDD[bot]', 'other-app[bot]']) {
      expect(firstCheck(check({ approvedBy: actor, actor, basis: 'founder' }))).toBe('actor-not-bot');
    }
  });
  it('a basis without an actor is refused rather than read as a founder record', () => {
    expect(firstCheck(check({ approvedBy: 'github@harvest316.com', basis: 'delegation:DLG-001' }))).toBe('actor-shape');
    expect(firstCheck(check({ approvedBy: 'github@harvest316.com', verdictBy: VERDICT }))).toBe('actor-shape');
  });
});

describe('T0 invariant 4 — the author is never the actor or the verdict source', () => {
  it('a bot record whose author is the bot itself is refused', () => {
    expect(firstCheck(check(botRecord({ author: BOT_ACTOR })))).toBe('actor-is-author');
  });
  it('a founder record whose author is the founder is refused', () => {
    const r = check({ approvedBy: 'f@example.com', actor: 'f@example.com', basis: 'founder', author: 'F@example.com' });
    expect(firstCheck(r)).toBe('actor-is-author');
  });
  it('a verdict source that is the author is refused', () => {
    expect(firstCheck(check(botRecord({ author: VERDICT })))).toBe('verdict-by-author');
  });
});

describe('T0 invariant 5 — every missing witness denies', () => {
  const cases: [string, Record<string, unknown>, DelegationWitnesses, { path: string; content: string | null }, string][] = [
    ['no witnesses at all', botRecord(), NO_WITNESSES, spec, 'witness-missing'],
    ['repo unknown', botRecord(), W({ repo: undefined }), spec, 'witness-missing'],
    ['repo empty', botRecord(), W({ repo: ' ' }), spec, 'witness-missing'],
    ['delegation file unreadable', botRecord(), W({ delegations: undefined }), spec, 'witness-missing'],
    ['delegation file grants nothing', botRecord(), W({ delegations: [] }), spec, 'basis-unknown-delegation'],
    ['artifact absent', botRecord(), W(), { path: SPEC, content: null }, 'witness-missing'],
    ['decision status unreadable', botRecord(), W({ decisionStatus: () => undefined }), spec, 'delegation-no-live-delegation'],
    ['repeat-fix share unknown', botRecord(), W({ repeatFixShare: undefined }), spec, 'delegation-tripwire-unknown'],
    ['repeat-fix share NaN', botRecord(), W({ repeatFixShare: Number.NaN }), spec, 'delegation-tripwire-unknown'],
    ['date unknown', botRecord(), W({ today: '' }), spec, 'delegation-no-live-delegation'],
    ['no review verdict', botRecord({ verdictBy: undefined }), W(), spec, 'no-independent-verdict'],
    ['empty review verdict', botRecord({ verdictBy: ' ' }), W(), spec, 'no-independent-verdict'],
    ['no author', botRecord({ author: undefined }), W(), spec, 'author-missing'],
    ['no tier', botRecord({ tier: undefined }), W(), spec, 'tier-shape'],
    ['content pull request unknown', botRecord(), W({ contentPullRequest: () => undefined }), spec, 'witness-missing'],
  ];
  for (const [name, rec, w, art, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const r = check(rec, w, art);
      expect(r.cls).toBeUndefined();
      expect(firstCheck(r)).toBe(expected);
    });
  }
});

describe('T0 invariant 6 — what a delegation never covers', () => {
  it('memory-fabric is never delegated, even when a record names it', () => {
    const repo = 'AIClarityAU/memory-fabric';
    const r = check(
      botRecord({ verdictBy: `https://github.com/${repo}/pull/41#issuecomment-1` }),
      W({ repo, delegations: [{ ...LIVE, repo }] }),
    );
    expect(firstCheck(r)).toBe('delegation-repo-never-delegated');
  });

  for (const p of ['docs/decisions/DR-108.md', 'docs/decisions/DR-086.md']) {
    it(`the governance record ${p} is never accepted on a delegation`, () => {
      const r = check(botRecord({ specPath: p, act: 'engineering-dr-acceptance' }), W(), { path: p, content: drBody('engineering') });
      expect(firstCheck(r)).toBe('delegation-touches-governance');
    });
  }
  for (const p of ['.minspec/constitution.md', '.minspec/delegations.json']) {
    it(`${p} is never approved on a delegation`, () => {
      const r = check(botRecord({ specPath: p }), W(), { path: p, content: SPEC_BODY });
      expect(firstCheck(r)).toBe('delegation-touches-governance');
    });
  }

  for (const kind of ['direction', undefined]) {
    it(`a DR with kind ${String(kind)} stays the founder's`, () => {
      const r = check(botRecord({ specPath: DR, act: 'engineering-dr-acceptance' }), W(), { path: DR, content: drBody(kind) });
      expect(firstCheck(r)).toBe('delegation-direction-record');
    });
  }
});

describe('helpers', () => {
  it('frontmatterField reads a scalar, unquoted, comment stripped', () => {
    expect(frontmatterField('---\ntier: "T3"  # x\nkind: engineering\n---\n', 'tier')).toBe('T3');
    expect(frontmatterField('---\nkind: engineering\n---\n', 'kind')).toBe('engineering');
    expect(frontmatterField('no frontmatter', 'tier')).toBeUndefined();
    expect(frontmatterField('---\nid: x\n---\nkind: engineering\n', 'kind')).toBeUndefined();
  });
  it('isReviewCommentUrl matches only this repo\'s comment URLs', () => {
    expect(isReviewCommentUrl(VERDICT, 'aiclarityau/MINSPEC')).toBe(true);
    expect(isReviewCommentUrl(`https://github.com/${REPO}/issues/2#issuecomment-3`, REPO)).toBe(true);
    expect(isReviewCommentUrl(`https://github.com/${REPO}/pull/41`, REPO)).toBe(false);
  });
  it('repoFromRemoteUrl parses https and ssh remotes', () => {
    expect(repoFromRemoteUrl('https://github.com/AIClarityAU/minspec.git\n')).toBe(REPO);
    expect(repoFromRemoteUrl('git@github.com:AIClarityAU/minspec.git')).toBe(REPO);
    expect(repoFromRemoteUrl('https://x-access-token@github.com/AIClarityAU/minspec')).toBe(REPO);
    expect(repoFromRemoteUrl('https://gitlab.com/a/b')).toBeUndefined();
  });
});

// ─── wired into the record validator ────────────────────────────────────────

describe('approval-integrity judges the actor fields of every record', () => {
  const SIDECAR = `.minspec/approvals/${SPEC}.json`;
  const fixture = (record: Record<string, unknown>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apact-'));
    const put = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    put('.minspec/config.json', JSON.stringify({ version: '1', approvers: ['founder@example.com'] }));
    put(SPEC, SPEC_BODY);
    put(SIDECAR, JSON.stringify(record));
    return root;
  };
  const noBase = () => null;
  const checks = (fs_: { check: string }[]) => fs_.map((f) => f.check);

  it('a covered bot record passes, with no human-allowlist or agent-denylist refusal', () => {
    expect(evaluateApprovalIntegrity(fixture(botRecord()), [SIDECAR], noBase, W())).toEqual([]);
  });

  it('the same bot record with no witnesses supplied is refused (default is deny)', () => {
    const f = evaluateApprovalIntegrity(fixture(botRecord()), [SIDECAR], noBase);
    expect(checks(f)).toEqual(['witness-missing']);
  });

  it('a bot record the delegation does not cover is refused', () => {
    const f = evaluateApprovalIntegrity(fixture(botRecord()), [SIDECAR], noBase, W({ repeatFixShare: undefined }));
    expect(checks(f)).toEqual(['delegation-tripwire-unknown']);
  });

  it('a bot approval with no actor fields is still refused by the human allowlist', () => {
    const legacyBot = { ...botRecord(), actor: undefined, basis: undefined, act: undefined, author: undefined, verdictBy: undefined };
    const f = evaluateApprovalIntegrity(fixture(legacyBot), [SIDECAR], noBase, W());
    expect(checks(f)).toContain('approver-allowlist');
  });

  it('a legacy founder record passes exactly as before, with or without witnesses', () => {
    const legacy = {
      specPath: SPEC,
      specHash: specHash(SPEC_BODY),
      approvedAt: '2026-10-20T10:00:00.000Z',
      approvedBy: 'founder@example.com',
      tier: 'T3',
      migrated: false,
      baselineBlob: '',
    };
    expect(evaluateApprovalIntegrity(fixture(legacy), [SIDECAR], noBase)).toEqual([]);
    expect(evaluateApprovalIntegrity(fixture(legacy), [SIDECAR], noBase, W())).toEqual([]);
  });

  it('a delegated record still fails the hash binding when the bytes differ', () => {
    const f = evaluateApprovalIntegrity(fixture(botRecord({ specHash: 'deadbeef' })), [SIDECAR], noBase, W());
    expect(checks(f)).toContain('hash-binding');
  });

  it('a JSON value that is not an object is refused as unreadable', () => {
    const root = fixture(botRecord());
    fs.writeFileSync(path.join(root, SIDECAR), 'null');
    expect(checks(evaluateApprovalIntegrity(root, [SIDECAR], noBase, W()))).toEqual(['record-readable']);
  });
});
