/**
 * T1 — egress-scan.sh: pre-publish exfil/secret guard (#358).
 *
 * The dev agent runs over an UNTRUSTED issue body and, though credential-free, can
 * WRITE into the material the parent publishes (the committed diff, .agent-summary.md,
 * .review-signals.json). This scanner is the fail-closed egress guard the parent runs
 * BEFORE any push/PR/comment. A false CLEAN is the worst outcome (it publishes the
 * secret), so:
 *   • it MUST block on sk-ant / AWS key / high-entropy blob / PEM private-key content,
 *   • it MUST fail CLOSED on unreadable / no input, and
 *   • it MUST NOT false-block the high-entropy strings this repo legitimately commits
 *     (sha256/git hashes, npm-lock integrity), else every approval/dependency PR jams.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCAN = path.resolve(__dirname, '../../../scripts/egress-scan.sh');

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-scan-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a fixture file and return its absolute path. */
function fixture(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Run the scanner over paths; return { blocked, out } (blocked = non-zero exit). */
function scan(...paths: string[]): { blocked: boolean; out: string } {
  try {
    const out = execFileSync('bash', [SCAN, ...paths], { encoding: 'utf-8' });
    return { blocked: false, out: out.trim() };
  } catch (e: any) {
    return { blocked: true, out: (e.stdout ?? '').toString().trim() };
  }
}

describe('egress-scan.sh — blocks secret/exfil markers (#358)', () => {
  it('BLOCKS an Anthropic key (sk-ant-…)', () => {
    const r = scan(fixture('a.diff', '+  const key = "sk-ant-api03-AbCdEf0123456789abcdefABCDEF01";\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).toMatch(/BLOCK/);
    // The reason is redacted — the raw key value never appears in the output.
    expect(r.out).not.toContain('AbCdEf0123456789abcdefABCDEF01');
  });

  it('BLOCKS an AWS access key id (AKIA…)', () => {
    const r = scan(fixture('b.diff', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS a PEM private-key header (RSA/OPENSSH/generic)', () => {
    for (const kind of ['RSA ', 'OPENSSH ', 'EC ', '']) {
      const r = scan(fixture('pk.txt', `-----BEGIN ${kind}PRIVATE KEY-----\nMIIxxx\n`));
      expect(r.blocked, `kind=${kind}`).toBe(true);
    }
  });

  it('BLOCKS a generic high-entropy base64 blob (>=32 chars)', () => {
    const r = scan(fixture('c.diff', '+  const blob = "aGVsbG8gd29ybGQtc2VjcmV0LXZhbHVlLTEyMzQ1Njc4OTA=";\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).toContain('<redacted-high-entropy>');
  });

  it('BLOCKS a high-entropy mixed-class token (upper+lower+digit, no separators)', () => {
    const r = scan(fixture('d.diff', '+token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS a GitHub token (ghp_…)', () => {
    const r = scan(fixture('e.diff', 'GH_TOKEN=ghp_0123456789abcdefABCDEF0123456789abcdef\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS the aws_secret_access_key credential-file marker', () => {
    const r = scan(fixture('f.ini', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'));
    expect(r.blocked).toBe(true);
  });

  it('reports every offending input when several are passed', () => {
    const clean = fixture('clean.diff', '+  const x = doThing();\n');
    const dirty = fixture('dirty.diff', '+  key = "sk-ant-api03-ZZZ0123456789abcdefGHIJ";\n');
    const r = scan(clean, dirty);
    expect(r.blocked).toBe(true);
    expect(r.out).toContain('dirty.diff');
  });
});

describe('egress-scan.sh — fail CLOSED on bad input (#358)', () => {
  it('a missing/unreadable path → BLOCK (never clean)', () => {
    const r = scan(path.join(dir, 'does-not-exist.txt'));
    expect(r.blocked).toBe(true);
    expect(r.out).toMatch(/unreadable|failing closed/i);
  });

  it('no paths at all → BLOCK (cannot prove anything clean)', () => {
    const r = scan();
    expect(r.blocked).toBe(true);
  });

  it('a clean input mixed with a missing one still BLOCKS (any hit blocks)', () => {
    const clean = fixture('ok.diff', '+  return 42;\n');
    const r = scan(clean, path.join(dir, 'nope.txt'));
    expect(r.blocked).toBe(true);
  });
});

describe('egress-scan.sh — PASSES clean material, no false positives (#358)', () => {
  it('ordinary code + a sha256/git hash + a UUID → CLEAN', () => {
    const r = scan(
      fixture('clean.diff',
        '+  const result = computeThing(input);\n' +
        '+  export function foo(): string { return bar; }\n' +
        '+  // hash: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n' +
        '+  id: "550e8400-e29b-41d4-a716-446655440000"\n'),
    );
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('an approvals sidecar hash (64-hex, quoted) → CLEAN (not a secret)', () => {
    const r = scan(fixture('approval.json',
      '{ "specHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }\n'));
    expect(r.blocked).toBe(false);
  });

  it('an npm-lock integrity (sha512-…base64==) → CLEAN (not a secret)', () => {
    const r = scan(fixture('lock.diff',
      '+      "integrity": "sha512-AbCdEf0123456789+/gHiJkLmNoPqRsTuVwXyZ0123456789ABCDEFabcdef==",\n'));
    expect(r.blocked).toBe(false);
  });

  it('a normal prose summary → CLEAN', () => {
    const r = scan(fixture('.agent-summary.md',
      '# Summary\n\nFixed the off-by-one in the tier classifier and added a T3 regression test.\n'));
    expect(r.blocked).toBe(false);
  });
});

describe('egress-scan.sh — commit messages are in scope (#479 review, MAJOR)', () => {
  // run_egress_guard now dumps `git log origin/main..HEAD --format=%B` and scans it,
  // because commit messages are published by `git push` and shown on the PR — a
  // prompt-injected agent could exfiltrate via `git commit -m "<secret>"`. The
  // scanner is content-agnostic, so a secret in a commit-message dump blocks exactly
  // like one in the diff.
  it('BLOCKS a secret smuggled into a commit-message body', () => {
    const r = scan(fixture('commit-messages.txt',
      'fix: legitimate subject line\n\nexfil sk-ant-api03-QwErTy0123456789abcdefZZ via the message\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).not.toContain('QwErTy0123456789abcdefZZ');
  });

  it('a clean commit message → CLEAN', () => {
    const r = scan(fixture('commit-messages.txt',
      'fix(#302): reject nullish folder arg in the classify gate\n\nRoot cause: ...\n'));
    expect(r.blocked).toBe(false);
  });
});

describe('egress-scan.sh — documented false-positive is safe-direction (#479 review, LOW)', () => {
  // The mixed-class high-entropy rule (upper+lower+digit, >=32 chars) can flag a long
  // camelCase identifier that happens to contain a digit. This is a KNOWN false
  // positive: it fails in the SAFE direction (quarantine → human review, never a
  // silent publish) and matches the documented posture. Covered here so the behavior
  // is intentional and regression-guarded rather than surprising.
  it('a >=32-char camelCase identifier with a digit is flagged (safe direction)', () => {
    const r = scan(fixture('g.diff',
      '+  const someVeryLongDescriptiveVariableName2Value = compute();\n'));
    expect(r.blocked).toBe(true);
  });

  it('a short/ordinary identifier with a digit is NOT flagged', () => {
    const r = scan(fixture('h.diff', '+  const user2 = getUser();\n'));
    expect(r.blocked).toBe(false);
  });
});
