/**
 * T0 — the `approval-integrity` gate (DR-081 §4, #1376).
 *
 * This gate is what lets an approval-record PR go green WITHOUT an LLM review, so every
 * assertion here is load-bearing: if the gate can be made to pass on a tampered record,
 * the exemption it justifies becomes a hole rather than a trade.
 *
 * Structure follows `checkApprover`'s: the security decision is a pure input-to-output
 * mapping, so it is enumerated directly against `evaluateApprovalIntegrity` with no
 * subprocess. One integration test at the end drives the real CLI over a real git history,
 * because the `git diff` wiring is the one part a pure test cannot reach — and a suite that
 * only tested the pure half would go green while the script fed it the wrong file list.
 *
 * Each refusal asserts the NAME of the check that fired. A gate that refuses for an
 * unrelated reason is indistinguishable from one that works, until the real cause appears.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { specHash } from '../../shared/src/canonical';
import { evaluateApprovalIntegrity, type ReadBase } from '../../../scripts/approval-integrity';

const SPEC_REL = 'specs/minspec/SPEC-900-fixture/requirements.md';
const SIDECAR_REL = `.minspec/approvals/${SPEC_REL}.json`;
const HUMAN = 'founder@example.com';

const SPEC_BODY = `---
id: SPEC-900
type: requirements
status: planning
tier: T3
---

# Fixture spec

## Requirements

- FR-1. A fixture body with enough content to hash.
`;

function write(root: string, rel: string, contents: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

/** A repo-shaped directory: config with an allowlist, the approvable, and its sidecar. */
function fixture(opts: { approvers?: unknown; record?: Record<string, unknown>; omitApprovable?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apint-'));
  const config: Record<string, unknown> = { version: '1', specsDir: 'specs' };
  if (opts.approvers !== undefined) config.approvers = opts.approvers;
  write(root, '.minspec/config.json', JSON.stringify(config, null, 2));
  if (!opts.omitApprovable) write(root, SPEC_REL, SPEC_BODY);
  write(
    root,
    SIDECAR_REL,
    JSON.stringify(
      {
        specPath: SPEC_REL,
        specHash: specHash(SPEC_BODY),
        approvedAt: '2026-09-18T00:00:00.000Z',
        approvedBy: HUMAN,
        tier: 'T3',
        migrated: false,
        ...(opts.record ?? {}),
      },
      null,
      2,
    ),
  );
  return root;
}

/** The changed-file set a well-formed approval PR produces. */
const PAIR = [SIDECAR_REL, SPEC_REL];

/** The merge-base view: by default the approvable is unchanged, which is the normal case. */
const BASE_UNCHANGED: ReadBase = (rel) => (rel === SPEC_REL ? SPEC_BODY : null);

/** Names of the checks that refused, for assertion. */
function checks(root: string, changed: readonly string[], readBase: ReadBase = BASE_UNCHANGED): string[] {
  return evaluateApprovalIntegrity(root, changed, readBase).map((f) => f.check);
}

describe('approval-integrity — the decision', () => {
  // Establishes the happy path is reachable at all. Without it, every refusal below could
  // be passing because the gate refuses everything, which is a useless gate.
  it('PASSES a well-formed approval pair', () => {
    expect(checks(fixture({ approvers: [HUMAN] }), PAIR)).toEqual([]);
  });

  it('PASSES the sidecar alone — the status mirror flip is hash-neutral and may land separately', () => {
    expect(checks(fixture({ approvers: [HUMAN] }), [SIDECAR_REL])).toEqual([]);
  });

  it('REFUSES a specHash that does not match the approvable at this commit', () => {
    expect(checks(fixture({ approvers: [HUMAN], record: { specHash: 'de'.repeat(32) } }), PAIR)).toContain('hash-binding');
  });

  it('REFUSES an approver absent from the allowlist', () => {
    expect(checks(fixture({ approvers: [HUMAN], record: { approvedBy: 'stranger@example.com' } }), PAIR)).toContain(
      'approver-allowlist',
    );
  });

  it('REFUSES a known agent identity even when the allowlist names it', () => {
    // The case where an allowlist edit would otherwise re-open DR-056's self-approval hole.
    const agent = 'claude@harvest316.com';
    expect(checks(fixture({ approvers: [agent], record: { approvedBy: agent } }), PAIR)).toContain('approver-not-agent');
  });

  it('REFUSES when no allowlist is configured — deny-by-default, never "anyone"', () => {
    // Asserts the ACTIONABLE detail, not just the check name. An empty allowlist also
    // fails the membership test below, so a test keyed only on the name cannot tell the
    // two apart — and the unconfigured case is the one where the reader needs to be told
    // what to add. Mutation-checked: without this, deleting the unconfigured branch
    // entirely leaves the suite green.
    const failures = evaluateApprovalIntegrity(fixture({}), PAIR, BASE_UNCHANGED);
    const allowlistFailure = failures.find((f) => f.check === 'approver-allowlist');
    expect(allowlistFailure?.detail).toContain('.minspec/config.json');
    expect(allowlistFailure?.detail).toContain('approvers');
  });

  it('REFUSES an empty allowlist for the same reason as a missing one', () => {
    expect(checks(fixture({ approvers: [] }), PAIR)).toContain('approver-allowlist');
  });

  it('REFUSES a stray file riding along inside the exempt PR', () => {
    expect(checks(fixture({ approvers: [HUMAN] }), [...PAIR, 'src/evil.ts'])).toContain('file-set');
  });

  it('REFUSES a PR that edits the allowlist it is judged by', () => {
    // The composition that makes a committed allowlist safe: widening it can never happen
    // inside the same PR the widened list would wave through.
    expect(checks(fixture({ approvers: [HUMAN] }), [...PAIR, '.minspec/config.json'])).toContain('file-set');
  });

  it('REFUSES two approval records in one PR', () => {
    const root = fixture({ approvers: [HUMAN] });
    const second = '.minspec/approvals/specs/minspec/SPEC-901-other/requirements.md.json';
    write(root, second, '{}');
    expect(checks(root, [SIDECAR_REL, second])).toContain('one-record');
  });

  it('REFUSES a record whose approvable is absent at this commit', () => {
    expect(checks(fixture({ approvers: [HUMAN], omitApprovable: true }), [SIDECAR_REL])).toContain('hash-binding');
  });

  it('REFUSES a record filed under a path it does not claim', () => {
    expect(
      checks(fixture({ approvers: [HUMAN], record: { specPath: 'specs/minspec/SPEC-999-elsewhere/requirements.md' } }), PAIR),
    ).toContain('path-agreement');
  });

  it('REFUSES an unparseable sidecar rather than skipping it', () => {
    const root = fixture({ approvers: [HUMAN] });
    write(root, SIDECAR_REL, '{ not json');
    expect(checks(root, PAIR)).toContain('record-readable');
  });

  // DR-081 §3: detection is structural, never title-based. #1376's done-when names this
  // explicitly, because a title is forgeable and a path set is not. The pure function never
  // sees a title, which IS the property — asserted here so a future refactor that starts
  // passing one in has to delete this test to do it.
  it('judges only the file set — an ordinary PR is out of scope, whatever it is called', () => {
    expect(checks(fixture({ approvers: [HUMAN] }), ['src/thing.ts'])).toEqual([]);
  });
});

describe('approval-integrity — the scope boundary (DR-081 §5)', () => {
  // The defect a panel reviewer caught on PR #1985 before it merged. Every check in the
  // suite above is self-referential: the record and the approvable arrive in the same PR,
  // so a matching hash proves only that the pusher was consistent with themselves. These
  // tests are what turn "exempts the RECORD, never the APPROVABLE" from prose into a gate.

  /** The attack: rewrite the spec body, then mint a record that matches the NEW bytes. */
  function tamperedFixture(): string {
    const rewritten = SPEC_BODY.replace('A fixture body with enough content to hash.', 'Arbitrary unreviewed content.');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apint-attack-'));
    write(root, '.minspec/config.json', JSON.stringify({ version: '1', approvers: [HUMAN] }, null, 2));
    write(root, SPEC_REL, rewritten);
    write(
      root,
      SIDECAR_REL,
      JSON.stringify({ specPath: SPEC_REL, specHash: specHash(rewritten), approvedBy: HUMAN, tier: 'T3' }, null, 2),
    );
    return root;
  }

  it('REFUSES substantive approvable content that differs from the merge base', () => {
    // Without the base comparison this passes every other check — which is precisely
    // why it is the blocking case.
    expect(checks(tamperedFixture(), PAIR)).toContain('approvable-unreviewed');
  });

  it('and that tampered PR passes every self-referential check — so the base comparison is the only thing stopping it', () => {
    // Proves the fix is load-bearing rather than redundant with an existing assertion.
    const failures = evaluateApprovalIntegrity(tamperedFixture(), PAIR, BASE_UNCHANGED);
    expect(failures.map((f) => f.check)).toEqual(['approvable-unreviewed']);
  });

  it('PASSES a hash-neutral status flip — the legitimate approve flow still works', () => {
    // canonicalizeSpec strips `status:` and `phases:`, so the approve flow's own mirror
    // write must not be mistaken for a content change. If this reddens, the gate has
    // blocked the very thing it exists to let through.
    const flipped = SPEC_BODY.replace('status: planning', 'status: implementing');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apint-flip-'));
    write(root, '.minspec/config.json', JSON.stringify({ version: '1', approvers: [HUMAN] }, null, 2));
    write(root, SPEC_REL, flipped);
    write(
      root,
      SIDECAR_REL,
      JSON.stringify({ specPath: SPEC_REL, specHash: specHash(flipped), approvedBy: HUMAN, tier: 'T3' }, null, 2),
    );
    expect(checks(root, PAIR)).toEqual([]);
  });

  it('REFUSES a PR that introduces the approvable and approves it in one go', () => {
    // No reviewed base version exists, so there is nothing the approval can attest to.
    expect(checks(fixture({ approvers: [HUMAN] }), PAIR, () => null)).toContain('approvable-unreviewed');
  });

  it('does NOT run the base comparison when the approvable is untouched', () => {
    // The sidecar alone cannot smuggle content, so a base read is neither needed nor
    // performed — asserted by handing it a reader that throws if called.
    const exploding: ReadBase = () => {
      throw new Error('base read must not happen when the approvable is unchanged');
    };
    expect(checks(fixture({ approvers: [HUMAN] }), [SIDECAR_REL], exploding)).toEqual([]);
  });

  it('REFUSES a derived path that escapes the repo', () => {
    const root = fixture({ approvers: [HUMAN] });
    expect(checks(root, ['.minspec/approvals/../../etc/passwd.json'])).toContain('path-shape');
  });
});

describe('approval-integrity — the git wiring', () => {
  // The one part the pure tests cannot reach: that the CLI derives the right changed-file
  // set from real history and exits non-zero. Kept to a single case because it costs a
  // process spawn; the decision matrix above is exhaustive and free.
  it('exits 1 and names the failing check when run over a tampered branch', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apint-git-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'fixture@example.com');
    git('config', 'user.name', 'Fixture');
    write(repo, '.minspec/config.json', JSON.stringify({ version: '1', approvers: [HUMAN] }, null, 2));
    write(repo, SPEC_REL, SPEC_BODY);
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    git('checkout', '-q', '-b', 'approve');
    write(
      repo,
      SIDECAR_REL,
      JSON.stringify({ specPath: SPEC_REL, specHash: 'de'.repeat(32), approvedBy: HUMAN, tier: 'T3' }, null, 2),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'chore(approve): SPEC-900 approved for implementation');

    const script = path.resolve(__dirname, '../../../scripts/approval-integrity.ts');
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [require.resolve('tsx/cli'), script, 'main'], {
        cwd: repo,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? -1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(code).toBe(1);
    expect(out).toContain('hash-binding');
    expect(out).toContain('REFUSED');
  }, 60_000);
});
