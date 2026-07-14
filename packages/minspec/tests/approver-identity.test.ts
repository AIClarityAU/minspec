/**
 * DR-056 — Agent-proof approver identity (Decision 2). T0 invariant tests.
 *
 * INVARIANT: MinSpec must NEVER record a spec approval under an agent/bot or
 * absent identity. `approvedBy` must be a provable human, or the approval is
 * refused — DR-012's "explicit human act" made enforceable, mirroring DR-033's
 * reviewer allowlist as an inverted denylist. The security-critical decision
 * (`checkApprover`) is pure and exhaustively tested here; the lib gate
 * (`approveSpec` → `assertHumanApprover`) is tested for the no-side-effect
 * guarantee (a denied approval writes nothing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  checkApprover,
  parseAgentIdentities,
  assertHumanApprover,
  approveSpec,
  getApprovalStatus,
  ApproverDeniedError,
  BUILTIN_AGENT_IDENTITIES,
  UNKNOWN_IDENTITY,
} from '../src/lib/approval';
import { readRecord } from '../src/lib/approval-store';

describe('checkApprover — pure agent-proof gate (DR-056 Decision 2)', () => {
  it('ALLOWS a human email', () => {
    const r = checkApprover('paul@harvest316.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe('paul@harvest316.com');
  });

  it('DENIES the claude-account email (root of the #677 ambiguity)', () => {
    const r = checkApprover('claude@harvest316.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/agent.*can't self-approve/i);
  });

  it('DENIES the minspec-sdd[bot] noreply identities', () => {
    for (const id of [
      'minspec-sdd[bot]@users.noreply.github.com',
      '299695933+minspec-sdd[bot]@users.noreply.github.com',
    ]) {
      expect(checkApprover(id).ok).toBe(false);
    }
  });

  it('DENIES every built-in agent identity', () => {
    for (const id of BUILTIN_AGENT_IDENTITIES) {
      expect(checkApprover(id).ok).toBe(false);
    }
  });

  it('DENIES an empty identity — no identity is not a provable human act', () => {
    const r = checkApprover('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no git identity/i);
  });

  it('DENIES whitespace-only and the UNKNOWN sentinel', () => {
    expect(checkApprover('   ').ok).toBe(false);
    expect(checkApprover(UNKNOWN_IDENTITY).ok).toBe(false);
    expect(checkApprover('UNKNOWN').ok).toBe(false); // case-insensitive sentinel
  });

  it('is case-insensitive and trims surrounding whitespace (git can echo a newline)', () => {
    expect(checkApprover('Claude@Harvest316.com').ok).toBe(false);
    expect(checkApprover('  claude@harvest316.com\n').ok).toBe(false);
    // a human email with stray whitespace still passes, trimmed
    const r = checkApprover('  human@example.com  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe('human@example.com');
  });

  it('extends the denylist via extraDenied (MINSPEC_AGENT_IDENTITIES)', () => {
    expect(checkApprover('ci-bot@example.com').ok).toBe(true); // not built-in
    expect(checkApprover('ci-bot@example.com', ['ci-bot@example.com']).ok).toBe(false);
    // extraDenied is matched case-insensitively too
    expect(checkApprover('CI-Bot@example.com', ['ci-bot@example.com']).ok).toBe(false);
  });
});

describe('parseAgentIdentities — mirrors DR-033 parseAllowlist grammar', () => {
  it('splits on comma/whitespace, lowercases, trims, drops empties', () => {
    expect(parseAgentIdentities('A@x.com, B@y.com  C@z.com')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ]);
  });
  it('undefined / empty → []', () => {
    expect(parseAgentIdentities(undefined)).toEqual([]);
    expect(parseAgentIdentities('')).toEqual([]);
    expect(parseAgentIdentities('   ')).toEqual([]);
  });
});

describe('assertHumanApprover — throws ApproverDeniedError, honours env denylist', () => {
  const KEY = 'MINSPEC_AGENT_IDENTITIES';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('does not throw for a human', () => {
    expect(() => assertHumanApprover('human@example.com')).not.toThrow();
  });
  it('throws ApproverDeniedError (typed) for a built-in agent identity', () => {
    expect(() => assertHumanApprover('claude@harvest316.com')).toThrow(ApproverDeniedError);
  });
  it('throws for an env-added identity', () => {
    process.env[KEY] = 'runner@ci.example.com';
    expect(() => assertHumanApprover('runner@ci.example.com')).toThrow(ApproverDeniedError);
  });
  it('the thrown error carries the offending identity', () => {
    try {
      assertHumanApprover('claude@harvest316.com');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApproverDeniedError);
      expect((e as ApproverDeniedError).identity).toBe('claude@harvest316.com');
    }
  });
});

describe('approveSpec — lib boundary is the authoritative gate (no side effects on deny)', () => {
  let tmp: string;
  let specPath: string;
  const SPEC_REL = 'specs/SPEC-007-thing.md';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-dr056-'));
    fs.mkdirSync(path.join(tmp, 'specs'));
    specPath = path.join(tmp, 'specs', 'SPEC-007-thing.md');
    fs.writeFileSync(specPath, '---\nid: SPEC-007\ntier: T3\nstatus: specifying\n---\n# Thing\n');
    try {
      execFileSync('git', ['init', '-q'], { cwd: tmp });
      execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: tmp });
    } catch {
      /* git absent — irrelevant here; approveSpec is fed the email directly */
    }
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('records an approval for a human identity', () => {
    approveSpec(tmp, specPath, 'T3', 'paul@harvest316.com');
    expect(getApprovalStatus(tmp, specPath)).toBe('approved');
  });

  it('THROWS and writes NO sidecar for an agent identity', () => {
    expect(() => approveSpec(tmp, specPath, 'T3', 'claude@harvest316.com')).toThrow(
      ApproverDeniedError,
    );
    expect(readRecord(tmp, SPEC_REL)).toBeUndefined();
    expect(getApprovalStatus(tmp, specPath)).toBe('unapproved');
  });

  it('THROWS for an empty / unknown identity', () => {
    expect(() => approveSpec(tmp, specPath, 'T3', '')).toThrow(ApproverDeniedError);
    expect(() => approveSpec(tmp, specPath, 'T3', 'unknown')).toThrow(ApproverDeniedError);
    expect(readRecord(tmp, SPEC_REL)).toBeUndefined();
  });
});
