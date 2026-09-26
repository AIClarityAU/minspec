/**
 * T0 — survivor reuse: which voters may be skipped on a re-run (#2142).
 *
 * WHY THIS IS NOT #1840. That issue proposed skipping the WHOLE panel when the patch
 * was unchanged; it was closed on measurement (7.3% of runs, every repeat a base move,
 * so the saving and the #1394 semantic-conflict risk were the same event). This is a
 * different claim: the head SHA is IDENTICAL, so "four voters reviewed this SHA" stays
 * literally true. Nothing about the gate's assertion weakens.
 *
 * WHY THE STRICTNESS DIFFERS FROM findReattestableVerdict. That function requires the
 * prior check-run to be `completed` + `success`, because it reuses a whole PASS. Here
 * the prior run FAILED overall - that is the case we are in, one voter silent and the
 * panel fail-closed to `changes`. Requiring `success` would make reuse impossible
 * exactly when it is needed. So the predicate is: allowlisted `app.slug` (provenance,
 * because a record in a PUBLIC repo is forgeable), the SAME patch fingerprint (the
 * voter saw the same input), and a record that round-trips its own digest.
 *
 * THE GUARD RAILS, each with a case below:
 *   - a voter that emitted NOTHING is never a survivor; it must re-run;
 *   - reuse copies the verdict verbatim, so it can never upgrade changes/blocked to pass;
 *   - an unattested or off-allowlist record is ignored;
 *   - a record whose digest does not match its payload is ignored (truncation);
 *   - no patch fingerprint means no reuse at all.
 */
import { describe, it, expect } from 'vitest';

const GUARD = require('../../../.github/scripts/ai-review-guard.js');
const { renderVoterRecord, parseVoterRecords, selectVotersToRun } = GUARD;

const ROLES = ['reviewer', 'security', 'architect', 'skeptic'];
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const ALLOW = ['minspec-sdd', 'minspec-sdd[bot]'];

const block = (verdict: string) =>
  `REVIEW_VERDICT_BEGIN\nverdict: ${verdict}\nblocking: 0\nsummary: x\nREVIEW_VERDICT_END`;

/** A check-run as the API returns it, carrying records for the given roles. */
function priorRun(
  roleBlocks: Record<string, string>,
  opts: { fp?: string; slug?: string; sha?: string } = {},
) {
  const fp = opts.fp ?? FP_A;
  const lines = [`patch-fingerprint:${fp}`];
  for (const [role, b] of Object.entries(roleBlocks)) lines.push(renderVoterRecord(role, b));
  return {
    name: 'ai-review',
    status: 'completed',
    conclusion: 'failure', // the panel failed; that is the point
    head_sha: opts.sha ?? 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    app: { slug: opts.slug ?? 'minspec-sdd' },
    output: { title: 'AI review', summary: lines.join('\n\n'), text: '' },
  };
}

const select = (checkRuns: any[], patchHash: string | null = FP_A) =>
  selectVotersToRun({ roles: ROLES, checkRuns, patchHash, allowlist: ALLOW });

describe('renderVoterRecord / parseVoterRecords round-trip', () => {
  it('round-trips a verdict block verbatim', () => {
    const b = block('changes');
    const recs = parseVoterRecords(renderVoterRecord('skeptic', b));
    expect(recs.skeptic).toBe(b);
  });

  it('survives a block containing blank lines and markdown fences', () => {
    const b = `REVIEW_VERDICT_BEGIN\nverdict: changes\n\n\`\`\`\nfenced\n\`\`\`\nREVIEW_VERDICT_END`;
    expect(parseVoterRecords(renderVoterRecord('reviewer', b)).reviewer).toBe(b);
  });

  it('refuses a hand-crafted record whose payload is only whitespace', () => {
    // renderVoterRecord cannot produce this, so the parser's own guard is the only thing
    // standing between a blank "verdict" and being counted as a survivor. Built by hand
    // with a CORRECT digest, so only the emptiness check can reject it.
    const crypto = require('crypto');
    const payload = '   \n\t  ';
    const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    const rec = `voter-record:reviewer:${digest}:${Buffer.from(payload, 'utf8').toString('base64')}`;
    expect(parseVoterRecords(rec).reviewer).toBeUndefined();
  });

  it('renderVoterRecord emits nothing for an empty block or a bad role name', () => {
    expect(renderVoterRecord('reviewer', '')).toBe('');
    expect(renderVoterRecord('reviewer', '   ')).toBe('');
    expect(renderVoterRecord('bad:role', 'REVIEW_VERDICT_BEGIN\nverdict: pass')).toBe('');
  });

  it('ignores a record whose digest does not match its payload (truncation)', () => {
    const rendered = renderVoterRecord('reviewer', block('pass'));
    const corrupted = rendered.slice(0, rendered.length - 6);
    expect(parseVoterRecords(corrupted).reviewer).toBeUndefined();
  });
});

describe('selectVotersToRun', () => {
  it('reuses the three survivors and re-runs only the silent voter', () => {
    const r = select([priorRun({ reviewer: block('pass'), security: block('pass'), architect: block('pass') })]);
    expect(r.run).toEqual(['skeptic']);
    expect(Object.keys(r.reuse).sort()).toEqual(['architect', 'reviewer', 'security']);
  });

  it('never treats a voter with no record as a survivor', () => {
    const r = select([priorRun({ reviewer: block('pass') })]);
    expect(r.run).toEqual(['security', 'architect', 'skeptic']);
  });

  it('copies the verdict verbatim, so reuse cannot upgrade changes to pass', () => {
    const r = select([priorRun({ reviewer: block('changes'), security: block('blocked') })]);
    expect(r.reuse.reviewer).toContain('verdict: changes');
    expect(r.reuse.security).toContain('verdict: blocked');
  });

  it('reuses nothing when the patch fingerprint differs', () => {
    const r = select([priorRun({ reviewer: block('pass'), security: block('pass') }, { fp: FP_B })]);
    expect(r.run).toEqual(ROLES);
    expect(r.reuse).toEqual({});
  });

  it('reuses nothing when there is no patch fingerprint to compare', () => {
    const r = select([priorRun({ reviewer: block('pass') })], null);
    expect(r.run).toEqual(ROLES);
  });

  it('ignores a record from an app outside the allowlist', () => {
    const r = select([priorRun({ reviewer: block('pass') }, { slug: 'somebody-else' })]);
    expect(r.run).toEqual(ROLES);
    expect(r.reuse).toEqual({});
  });

  it('refuses on an empty allowlist AND says that is why', () => {
    // Asserting only r.run here does not discriminate: the per-run allowlist test
    // already rejects every record, so removing the early return leaves `run`
    // unchanged (measured - that mutant survived). What the early return actually
    // buys is a TRUE reason. Without it the notes blame absent verdicts for what is
    // really a misconfigured allowlist, which is a silent-gate diagnostic failure
    // even though the gate itself still closes.
    const r = selectVotersToRun({
      roles: ROLES,
      checkRuns: [priorRun({ reviewer: block('pass') })],
      patchHash: FP_A,
      allowlist: [],
    });
    expect(r.run).toEqual(ROLES);
    expect(r.notes.join(' ')).toMatch(/allowlist/i);
    expect(r.notes.join(' ')).not.toMatch(/no usable prior verdict/i);
  });

  it('ignores check-runs that are not the ai-review check', () => {
    const foreign = priorRun({ reviewer: block('pass') });
    foreign.name = 'some-other-check';
    expect(select([foreign]).run).toEqual(ROLES);
  });

  it('prefers the most recent record when two prior runs both carry one', () => {
    const older = priorRun({ reviewer: block('blocked') }, { sha: 'a'.repeat(40) });
    const newer = priorRun({ reviewer: block('pass') }, { sha: 'b'.repeat(40) });
    const r = selectVotersToRun({
      roles: ROLES, checkRuns: [newer, older], patchHash: FP_A, allowlist: ALLOW,
    });
    expect(r.reuse.reviewer).toContain('verdict: pass');
  });

  it('names every reuse so the run is auditable, never silent', () => {
    const r = select([priorRun({ reviewer: block('pass') })]);
    expect(r.notes.join(' ')).toMatch(/reviewer/);
    expect(r.notes.join(' ')).toMatch(/reus/i);
  });

  it('with no prior runs at all, runs every voter', () => {
    const r = select([]);
    expect(r.run).toEqual(ROLES);
    expect(r.reuse).toEqual({});
  });
});
