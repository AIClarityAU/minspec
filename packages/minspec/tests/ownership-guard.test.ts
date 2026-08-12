/**
 * SPEC-051 (re-scoped) — T0: the ownership pre-check is enforced in the LIB, so every
 * caller inherits it, not only the VS Code command.
 *
 * WHAT ALREADY SHIPPED. #1317 added `violationsIntroducedByApproval` and wired a refusal
 * into `commands/approve.ts`. That closed the UI path — the one a human clicks. It did NOT
 * close `approveSpec` itself (`lib/approval.ts`), so any non-UI caller — a script, a test,
 * a future command, an agent driving the lib — still approves a spec straight into a state
 * `validateSpec` rejects, which is what turned `main` red four times.
 *
 * This mirrors the DR-056 approver gate that sits three lines above it: deny at the LIB
 * boundary, before any side effect, with the command layer keeping its friendlier
 * pre-check. A guard only the UI enforces is a guard the next caller forgets.
 *
 * TWO FOUNDER DECISIONS ARE ENCODED HERE, and the tests pin both so a later change has to
 * argue with a failing assertion rather than silently reinterpret them:
 *
 *   • CONFIG-RESPECTING, not absolute. The guard reuses `violationsIntroducedByApproval`,
 *     which re-runs `validateSpec` under the caller's own config. A repo on the default
 *     `ownershipDeclaration: 'warn'` sees NO refusal (SPEC-038 FR-7 ratchet). The honest
 *     cost, accepted deliberately: the trap stays reachable for a fresh user repo until
 *     that ratchet flips. `does NOT fire on the default config` below is that cost, pinned.
 *
 *   • ONLY NEWLY-INTRODUCED violations. A spec already in the build band and already
 *     undeclared is NOT refused, so re-approving after an ordinary edit can never lock a
 *     human out. `violationsIntroducedByApproval` gives this for free by diffing
 *     before/after; the test exists so nobody "fixes" it into an absolute check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { approveSpec } from '../src/lib/approval';
import { readRecord } from '../src/lib/approval-store';

let tmp: string;

/** Absolute path of the sidecar `approveSpec` would write for `rel`. */
function sidecarPath(root: string, rel: string): string {
  return path.join(root, '.minspec', 'approvals', `${rel}.json`);
}

/** Repo-relative path — `readRecord` keys on that, not an absolute path. */
function rel(abs: string): string {
  return path.relative(tmp, abs).split(path.sep).join('/');
}

function writeSpec(frontmatter: string): string {
  const p = path.join(tmp, 'specs', 'SPEC-901-thing.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n# Thing\n\nBody.\n`);
  return p;
}

/** `ownershipDeclaration: 'error'` — this repo's ratcheted setting (SPEC-038 FR-7). */
function ratchetToError(): void {
  fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.minspec', 'config.json'),
    JSON.stringify({ version: '1', ownershipDeclaration: 'error' }, null, 2),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ownership-guard-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: tmp });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmp });
  } catch {
    // git absent — the baseline mint degrades to '' and the assertions below still hold.
  }
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const UNDECLARED_T4 = 'id: SPEC-901\ntype: requirements\ntier: T4\nstatus: specifying\nproduct: minspec';

describe('SPEC-051 — approveSpec refuses to advance a spec into a state it fails', () => {
  it('REFUSES an undeclared T4 spec when the repo has ratcheted to error', () => {
    ratchetToError();
    const p = writeSpec(UNDECLARED_T4);
    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).toThrow(/ownership|implements/i);
  });

  it('writes NO side effect when it refuses — not a half-approval', () => {
    // The whole point of guarding at the lib boundary rather than after the write: a
    // refusal must leave nothing behind. Asserting only "it threw" would pass even if the
    // sidecar had already been minted.
    ratchetToError();
    const p = writeSpec(UNDECLARED_T4);
    const before = fs.readFileSync(p, 'utf-8');

    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).toThrow();

    expect(readRecord(tmp, rel(p)), 'a sidecar was written despite the refusal').toBeUndefined();
    expect(
      fs.existsSync(sidecarPath(tmp, 'specs/SPEC-901-thing.md')),
      'sidecar file exists on disk',
    ).toBe(false);
    expect(fs.readFileSync(p, 'utf-8'), 'the spec file was mutated').toBe(before);
    // No baseline ref minted for this spec.
    let refs = '';
    try {
      refs = execFileSync('git', ['for-each-ref', '--format=%(refname)'], {
        cwd: tmp,
        encoding: 'utf8',
      });
    } catch {
      refs = '';
    }
    expect(refs).not.toMatch(/SPEC-901/);
  });

  it('does NOT fire on the DEFAULT config — the accepted cost of the config-respecting choice', () => {
    // No .minspec/config.json ⇒ ownershipDeclaration defaults to 'warn' ⇒ no error ⇒ no
    // refusal. This is deliberate (matches the shipped #1317 gate), and it means a fresh
    // user repo is still reachable by the trap until SPEC-038's ratchet flips. Pinned so
    // the trade-off is visible rather than discovered.
    const p = writeSpec(UNDECLARED_T4);
    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).not.toThrow();
    expect(readRecord(tmp, rel(p))).toBeDefined();
  });

  it('ALLOWS `implements: none` + implements_reason (the FR-4 escape, pre-approval)', () => {
    ratchetToError();
    const p = writeSpec(
      `${UNDECLARED_T4}\nimplements: none\nimplements_reason: policy spec, owns no code`,
    );
    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).not.toThrow();
    expect(readRecord(tmp, rel(p))).toBeDefined();
  });

  it('ALLOWS a declared owned path', () => {
    ratchetToError();
    const p = writeSpec(`${UNDECLARED_T4}\nimplements: [packages/minspec/src/lib/thing.ts]`);
    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).not.toThrow();
    expect(readRecord(tmp, rel(p))).toBeDefined();
  });

  it('ALLOWS a T2 spec — the rule is tier-gated, no regression for small work', () => {
    ratchetToError();
    const p = writeSpec('id: SPEC-902\ntype: requirements\ntier: T2\nstatus: specifying\nproduct: minspec');
    expect(() => approveSpec(tmp, p, 'T2', 'paul@harvest316.com')).not.toThrow();
  });

  it('does NOT refuse a spec ALREADY in the build band and already undeclared', () => {
    // Founder decision: only violations the advance INTRODUCES are refused. An
    // already-implementing undeclared spec is someone's existing mess — refusing it would
    // make re-approving after an ordinary edit impossible and lock a human out of getting
    // unstuck. `violationsIntroducedByApproval` diffs before/after, so this holds by
    // construction; the test stops a later "tightening" from silently reversing it.
    ratchetToError();
    const p = writeSpec(
      'id: SPEC-903\ntype: requirements\ntier: T4\nstatus: implementing\nproduct: minspec\nphases:\n  specify: done\n  clarify: done\n  plan: done\n  tasks: done\n  implement: in-progress',
    );
    expect(() => approveSpec(tmp, p, 'T4', 'paul@harvest316.com')).not.toThrow();
  });
});
